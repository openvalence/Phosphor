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

/// ---- motion-input STREAM door (ph-vdk.26, ph-vdk.49, ph-vdk.50) -----------

// Wish for a STREAM that advertises no ceiling; the hub clamps it either way.
const FALLBACK_RATE_HZ = 50;
// SPEC §5.4: bundle = t_base u32 + n u8 + pad, then per record a u16 t_off and the packed struct.
const BUNDLE_HEAD = 6;
const SIGNED_MIN = { [PACKED.i8]: -128, [PACKED.i16]: LIMITS.segment_end_vel_unspecified, [PACKED.i32]: -(2 ** 31) };
const TIME_SCALE = { [UNIT_ID.ms]: 1, [UNIT_ID.s]: 1e-3, [UNIT_ID.us]: 1e3 };
const PACKED_BYTES = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1 };

/**
 * SPEC §5.4 (RFC-058/071): the value a sender puts in a motion-input field it
 * has no value for, in physical units. A signed integer's type minimum; an
 * unsigned or float field has no sentinel, so it rides 0.
 */
export function unspecified(f) {
  return f.type in SIGNED_MIN ? SIGNED_MIN[f.type] / (f.scale || 1) : 0;
}

/**
 * The c2h STREAM of `kind` that takes motion input: it carries `input.target`
 * in unit normalized (SPEC §9.6, RFC-071), and a segments STREAM also
 * `input.duration` in a time unit. A STREAM without the role is some other
 * input, never motion.
 * @returns {{entry: Object, target: Object, duration?: Object}|null}
 */
export function motionStream(entries, kind = STREAM_KIND.samples) {
  for (const e of entries || []) {
    if (e.cls !== CHANNEL_CLASS.STREAM || e.dirName !== 'c2h' || e.streamKind !== kind) continue;
    const layout = e.layout || [];
    const target = layout.find((f) => f.role === FIELD_ROLE.input_target);
    if (!target || target.unitId !== UNIT_ID.normalized) continue;
    if (kind !== STREAM_KIND.segments) return { entry: e, target };
    const duration = layout.find((f) => f.role === FIELD_ROLE.input_duration && f.unitId in TIME_SCALE);
    if (duration) return { entry: e, target, duration };
  }
  return null;
}

/** One motion-input record: every field at its sentinel, then the ones we have. */
function record(st, norm, durationMs) {
  const out = {};
  for (const f of st.entry.layout) out[f.name] = unspecified(f);
  out[st.target.name] = Math.min(1, Math.max(0, norm));
  if (st.duration) out[st.duration.name] = Math.max(0, durationMs || 0) * TIME_SCALE[st.duration.unitId];
  return out;
}

/** Packed bytes of one record of this layout. */
export const recordBytes = (layout) => layout.reduce((n, f) => n + (f.size || PACKED_BYTES[f.type] || 0), 0);

/**
 * RFC-087: the head of a timed segment list one bundle may carry. Every start
 * (`atUs`, hub time, ascending) lies within the grant's horizon of `nowUs`,
 * at most bundle_max_samples records, and the payload fits one
 * min_transport_payload. The caller sends `head` and keeps `rest` for later.
 * @param {Array<{atUs: number}>} segs
 * @returns {{head: Array, rest: Array}}
 */
export function bundleHead(segs, nowUs, horizonMs, bytesPerRecord) {
  const maxN = Math.min(LIMITS.bundle_max_samples,
    Math.floor((LIMITS.min_transport_payload - BUNDLE_HEAD) / (2 + bytesPerRecord)));
  const until = nowUs + horizonMs * 1000;
  let n = 0;
  while (n < segs.length && n < maxN && segs[n].atUs <= until) n++;
  return { head: segs.slice(0, n), rest: segs.slice(n) };
}

/**
 * submitMotion's router. A timed input ("reach X over I ms", I > 0) rides the
 * hub's segments STREAM; an untimed point the samples STREAM; either kind
 * missing, the other; neither, the command.position setpoint. The grant is
 * asked for LAZILY per channel, so a watch-only session never reserves a
 * publish slot and the channel comes from the catalog, never a HELLO id.
 *
 * Constraints:
 * - Never silent: every path change and every PublishError goes to `log`,
 *   a repeated refusal code only once.
 * - One source per session: while a grant is in flight the input is refused,
 *   never sent down the setpoint path, so the hub's arbiter never sees the
 *   move channel and the stream interleaved.
 * - `halted()` (optional) reads the hub's REPORTED latch: while it returns a
 *   reason every input is refused with it and nothing is sent. Under PAUSE
 *   the hub drops stream bundles without a NACK (SPEC §11.1), so this is
 *   where the refusal becomes visible. The door never resumes: resume is
 *   the operator's own act (SPEC §11.1), never a side effect of input.
 * - A segment starts at hub now plus the grant's schedule_latency_us
 *   (RFC-059: never a constant here). Each new bundle supersedes the
 *   not-yet-started tail (RFC-087 item 5), so a newer line or a seek needs
 *   no flush of its own.
 *
 * @param {Object} deps {session() -> session|null, entries() -> catalog
 *   entries, setpoint(norm) -> {ok, reason}, log(level, msg),
 *   halted?() -> reason string, '' when motion may flow}
 * @returns {(norm: number, durationMs?: number) => {ok: boolean, reason?: string}}
 */
export function createMotionDoor(deps) {
  const asked = new Map(); // sessionId:channel -> 'pending' | 'granted' | 'refused'
  let path = '';
  let lastCode = '';
  const note = (p, msg) => { if (p !== path) { path = p; deps.log('info', msg); } };

  function setpoint(norm, why) {
    note('setpoint:' + why, 'motion input: command.position setpoint (' + why + '), duration dropped');
    return deps.setpoint(norm);
  }

  function send(s, st, grant, norm, durationMs) {
    const ch = st.entry.id;
    if (st.duration) {
      const lead = grant.scheduleLatencyUs || 0;
      note('segments:' + ch, 'motion input: segments STREAM 0x' + ch.toString(16) + ', horizon '
        + grant.scheduleHorizonMs + ' ms, lead ' + lead + ' us');
      const now = s.hubNowUs();
      const { head } = bundleHead([{ atUs: now + lead, rec: record(st, norm, durationMs) }],
        now, grant.scheduleHorizonMs, recordBytes(st.entry.layout));
      if (!head.length) throw new Error('schedule_latency_us ' + lead + ' lies past the ' + grant.scheduleHorizonMs + ' ms horizon');
      s.publishSegment(ch, head.map((x) => x.rec), { anchor: head[0].atUs >>> 0 });
      return;
    }
    note('stream:' + ch, 'motion input: samples STREAM 0x' + ch.toString(16) + ' at ' + grant.rate + ' Hz');
    // SPEC §5.4: a samples-kind t_base is the instant the sample DESCRIBES, and
    // "reach X over I ms" describes now + I, capped at max_future_schedule_ms.
    const leadMs = durationMs > 0 ? Math.min(durationMs, LIMITS.max_future_schedule_ms) : 0;
    s.publishSamples(ch, record(st, norm), { anchor: (s.hubNowUs() + leadMs * 1000) >>> 0 });
  }

  return function submit(norm, durationMs) {
    if (!Number.isFinite(norm)) return { ok: false, reason: 'position is not a number' };
    const held = deps.halted ? deps.halted() : '';
    if (held) return { ok: false, reason: held };
    const seg = motionStream(deps.entries(), STREAM_KIND.segments);
    const smp = motionStream(deps.entries(), STREAM_KIND.samples);
    const st = durationMs > 0 ? seg || smp : smp || seg;
    if (!st) return setpoint(norm, 'hub has no motion STREAM');
    const s = deps.session();
    if (!s) return { ok: false, reason: 'not connected' };
    const ch = st.entry.id;
    const grant = s.state.grantedPublishes.get(ch);

    if (!grant) {
      const id = s.state.sessionId + ':' + ch;
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

    try {
      send(s, st, grant, norm, durationMs);
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
