/**
 * motion.js — where a normalized motion input (0 = one end of the stroke,
 * 1 = the other) lands on this machine, resolved by ROLE.
 *
 * Constraints:
 * - Binds to registry roles only (`command.position`, `window.min/max`),
 *   never to a channel id or field name.
 * - Never fabricates a bound (RENDERING.md §13 law 9): a machine that
 *   publishes a window but has not reported it yet gets null, not the
 *   command field's full range.
 * - The hub still clamps every target into its own window. This mapping only
 *   decides what "halfway" means, the same way the rail tape does
 *   (RailWidget's tapeLo/tapeHi).
 * - The STREAM door finds its channel by class, direction, stream_kind and the
 *   input.target role (SPEC §9.6, RFC-071); a layout field's name is only the
 *   key the catalog itself hands back for encoding, never matched.
 */

import { ROLE } from './roles.js';
import { reportedValue } from './settings.js';
import { CHANNEL_CLASS, STREAM_KIND, UNIT_ID, LIMITS, PACKED, FIELD_ROLE } from '../../../Valence/clients/js/index.js';

const first = (byRole, role) => {
  const l = byRole && byRole.get(role);
  return l && l.length ? l[0] : null;
};

/**
 * @param {Object|null} model buildSettingsModel output
 * @param {Object} samples channelId -> decoded STATE sample
 * @param {number} norm 0..1 (clamped)
 * @returns {{field: Object, value: number}|{field: null, reason: string}}
 */
export function motionTarget(model, samples, norm) {
  if (!model || !model.byRole) return { field: null, reason: 'no catalog' };
  if (!Number.isFinite(norm)) return { field: null, reason: 'position is not a number' };
  const cmd = first(model.byRole, ROLE.commandPosition);
  if (!cmd) return { field: null, reason: 'machine publishes no command.position' };
  const n = Math.min(1, Math.max(0, norm));

  const lo = first(model.byRole, ROLE.windowMin);
  const hi = first(model.byRole, ROLE.windowMax);
  let a;
  let b;
  if (lo && hi && lo.unit === cmd.unit && hi.unit === cmd.unit) {
    a = reportedValue(lo, samples[lo.channelId]);
    b = reportedValue(hi, samples[hi.channelId]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      return { field: null, reason: 'stroke window not reported yet' };
    }
  } else {
    a = cmd.min;
    b = cmd.max;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      return { field: null, reason: 'command.position publishes no bounds' };
    }
  }
  return { field: cmd, value: a + n * (b - a) };
}

// ---- motion-input STREAM door (ph-vdk.26) ---------------------------------

// Wish for a STREAM that advertises no ceiling; the hub clamps it either way.
const FALLBACK_RATE_HZ = 50;
const SIGNED_MIN = { [PACKED.i8]: -128, [PACKED.i16]: LIMITS.segment_end_vel_unspecified, [PACKED.i32]: -(2 ** 31) };

/**
 * SPEC §5.4 (RFC-058/071): the value a sender puts in a motion-input field it
 * has no value for, in physical units. A signed integer's type minimum; an
 * unsigned or float field has no sentinel, so it rides 0.
 */
export function unspecified(f) {
  return f.type in SIGNED_MIN ? SIGNED_MIN[f.type] / (f.scale || 1) : 0;
}

/**
 * The c2h samples-kind STREAM that takes motion input: it carries
 * `input.target` in unit normalized (SPEC §9.6, RFC-071). A STREAM without
 * the role is some other input, never motion.
 * @param {Object[]} entries decoded catalog entries
 * @returns {{entry: Object, target: Object}|null}
 */
export function motionStream(entries) {
  for (const e of entries || []) {
    if (e.cls !== CHANNEL_CLASS.STREAM || e.dirName !== 'c2h' || e.streamKind !== STREAM_KIND.samples) continue;
    const target = (e.layout || []).find((f) => f.role === FIELD_ROLE.input_target);
    if (target && target.unitId === UNIT_ID.normalized) return { entry: e, target };
  }
  return null;
}

/**
 * submitMotion's router: the samples STREAM when this session holds a publish
 * grant for it, else the command.position setpoint. The grant is asked for
 * LAZILY on first use, so a watch-only session never reserves a publish slot,
 * and so the channel is chosen from the catalog rather than wished by id in
 * HELLO before any catalog exists.
 *
 * Constraints:
 * - Never silent: every path change and every PublishError goes to `log`,
 *   a repeated refusal code only once.
 * - One source per session: while the grant is in flight the input is
 *   refused, never sent down the setpoint path, so the hub's arbiter never
 *   sees the move channel and the stream interleaved.
 * - `halted()` (optional) reads the hub's REPORTED latch: while it returns a
 *   reason every input is refused with it and nothing is sent. Under PAUSE
 *   the hub drops stream bundles without a NACK (SPEC §11.1), so this is
 *   where the refusal becomes visible. The door never resumes: resume is
 *   the operator's own act (SPEC §11.1), never a side effect of input.
 *
 * @param {Object} deps {session() -> session|null, entries() -> catalog
 *   entries, setpoint(norm) -> {ok, reason}, log(level, msg),
 *   halted?() -> reason string, '' when motion may flow}
 * @returns {(norm: number, durationMs?: number) => {ok: boolean, reason?: string}}
 */
export function createMotionDoor(deps) {
  const asked = new Map(); // sessionId -> 'pending' | 'granted' | 'refused'
  let path = '';
  let lastCode = '';
  const note = (p, msg) => { if (p !== path) { path = p; deps.log('info', msg); } };

  function setpoint(norm, why) {
    note('setpoint:' + why, 'motion input: command.position setpoint (' + why + '), duration dropped');
    return deps.setpoint(norm);
  }

  return function submit(norm, durationMs) {
    if (!Number.isFinite(norm)) return { ok: false, reason: 'position is not a number' };
    const held = deps.halted ? deps.halted() : '';
    if (held) return { ok: false, reason: held };
    const st = motionStream(deps.entries());
    if (!st) return setpoint(norm, 'hub has no motion STREAM');
    const s = deps.session();
    if (!s) return { ok: false, reason: 'not connected' };
    const ch = st.entry.id;
    const grant = s.state.grantedPublishes.get(ch);

    if (!grant) {
      const id = s.state.sessionId;
      const a = asked.get(id);
      if (a === 'refused') return setpoint(norm, 'publish refused');
      if (a !== 'pending') {
        asked.set(id, 'pending');
        s.publish([[ch, st.entry.maxRateHz || FALLBACK_RATE_HZ]]).then(
          (g) => asked.set(id, g.some((r) => r.channel === ch) ? 'granted' : 'refused'),
          (e) => { asked.set(id, 'refused'); deps.log('warn', 'motion input: ' + e.message); },
        );
      }
      return { ok: false, reason: 'waiting for the stream grant' };
    }

    note('stream:' + ch, 'motion input: samples STREAM 0x' + ch.toString(16) + ' at ' + grant.rate + ' Hz');
    // SPEC §5.4: a samples-kind t_base is the instant the sample DESCRIBES, and
    // "reach X over I ms" describes now + I. Capped at max_future_schedule_ms,
    // §5.4's only scheduling-lead bound; the spec states none for samples.
    const leadMs = durationMs > 0 ? Math.min(durationMs, LIMITS.max_future_schedule_ms) : 0;
    // Every field we have no value for (input.velocity included) rides its
    // unspecified sentinel (RFC-071), never a guessed zero.
    const sample = {};
    for (const f of st.entry.layout) sample[f.name] = unspecified(f);
    sample[st.target.name] = Math.min(1, Math.max(0, norm));
    try {
      s.publishSamples(ch, sample, { anchor: (s.hubNowUs() + leadMs * 1000) >>> 0 });
      lastCode = '';
      return { ok: true };
    } catch (e) {
      const code = e.code || e.message;
      if (code !== lastCode) deps.log('warn', 'motion input refused: ' + e.message);
      lastCode = code;
      return { ok: false, reason: code };
    }
  };
}
