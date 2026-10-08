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
 * - `latchWords(safety)` is the one wording of the reported latch, shared by
 *   the shadow's door and the plugin gate.
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
const TYPE_MAX = { [PACKED.u8]: 255, [PACKED.i8]: 127, [PACKED.u16]: 65535, [PACKED.i16]: 32767,
  [PACKED.u32]: 2 ** 32 - 1, [PACKED.i32]: 2 ** 31 - 1 };

/** A lookahead segment shorter than this is consumed, never packed (ph-smvd.2). */
export const SEG_FLOOR_MS = 10;

/**
 * The door's hub clock: the offset of the kept CLOCK exchange (SPEC §7.1)
 * with the least error bound, RTT/2 plus its age times CLOCK_DRIFT, never
 * the newest exchange alone.
 *
 * Constraints:
 * - An exchange's offset error is up to half its RTT's asymmetry; the session
 *   library adopts every exchange. On valencesim the error is one-sided (the
 *   hub stamps t1 when its tick reads the frame): offset = truth + RTT/2 within
 *   0.5 ms over RTT 1 to 17 ms, so a slow exchange stamps every segment up to
 *   8 ms late. The filter belongs in Valence's clients/js syncClock; this stays
 *   until it lands there.
 * - Selection is by bound, never by count: an exchange leaves only when
 *   CLOCK_KEEP newer ones arrived (32 x the 10 s resync), so a fast one
 *   stays chosen until a fresher one's bound beats its age.
 * - CLOCK_DRIFT is an assumed client-to-hub rate error (two crystals); on
 *   one host it is 0, so a fast exchange may stay chosen for minutes.
 * - First use and every 'live' fire CLOCK_HUNT exchanges at random gaps up
 *   to CLOCK_HUNT_GAP_MS: back-to-back ones phase-lock to the hub's tick
 *   (20 of 20 at 14 to 18 ms on valencesim). The door's first use is its
 *   warm call, before Play.
 * - A close voids every kept exchange (a new WELCOME may be a new boot_id);
 *   until one lands the session's own offset is used.
 * - A session without on() or syncClock() (a test fake) reads hubNowUs().
 */
export const CLOCK_KEEP = 32, CLOCK_HUNT = 16, CLOCK_HUNT_GAP_MS = 250, CLOCK_DRIFT = 50e-6;
const clocks = new WeakMap(); // session -> kept {offsetUs, rttUs, atMs}
export function filteredHubNowUs(s, nowMs = performance.now()) {
  if (typeof s.on !== 'function' || typeof s.syncClock !== 'function') return s.hubNowUs();
  let kept = clocks.get(s);
  if (!kept) {
    kept = [];
    clocks.set(s, kept);
    const gap = () => new Promise((r) => setTimeout(r, Math.random() * CLOCK_HUNT_GAP_MS));
    const hunt = async () => { for (let i = 0; i < CLOCK_HUNT; i++) { await gap(); if (!(await s.syncClock())) return; } };
    s.on('clock', (c) => { kept.push({ atMs: performance.now(), ...c }); if (kept.length > CLOCK_KEEP) kept.shift(); });
    s.on('close', () => { kept.length = 0; });
    s.on('live', () => { hunt().catch(() => {}); });
    hunt().catch(() => {});
  }
  if (!kept.length) return s.hubNowUs();
  const bound = (k) => k.rttUs / 2 + (nowMs - k.atMs) * 1000 * CLOCK_DRIFT;
  const best = kept.reduce((a, b) => (bound(b) < bound(a) ? b : a));
  return s.hubNowUs() - s.state.clockOffsetUs + best.offsetUs;
}

/** The reported latch in words, '' when motion may flow. */
export function latchWords(s) {
  return !s ? '' : s.estopLatched ? 'e-stop latched' : s.paused ? 'paused, resume to continue' : '';
}

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
 * input, never motion. `endVel` is the segments layout's `input.end_velocity`
 * field when it has one (normalized span per second, SPEC §9.6).
 * @returns {{entry: Object, target: Object, duration?: Object, endVel?: Object}|null}
 */
export function motionStream(entries, kind = STREAM_KIND.samples) {
  for (const e of entries || []) {
    if (e.cls !== CHANNEL_CLASS.STREAM || e.dirName !== 'c2h' || e.streamKind !== kind) continue;
    const layout = e.layout || [];
    const target = layout.find((f) => f.role === FIELD_ROLE.input_target);
    if (!target || target.unitId !== UNIT_ID.normalized) continue;
    if (kind !== STREAM_KIND.segments) return { entry: e, target };
    const duration = layout.find((f) => f.role === FIELD_ROLE.input_duration && f.unitId in TIME_SCALE);
    const endVel = layout.find((f) => f.role === FIELD_ROLE.input_end_velocity);
    if (duration) return { entry: e, target, duration, endVel };
  }
  return null;
}

/** Field f's largest magnitude in physical units; Infinity for a type without one. */
const topOf = (f) => (f.type in TYPE_MAX ? TYPE_MAX[f.type] / (f.scale || 1) : Infinity);

/**
 * One motion-input record: every field at its sentinel, then the ones we have.
 * `endVel` (norm/s) is clamped to the field's range, so it never packs as the
 * sentinel; absent (null or undefined) it stays `unspecified`.
 */
function record(st, norm, durationMs, endVel) {
  const out = {};
  for (const f of st.entry.layout) out[f.name] = unspecified(f);
  out[st.target.name] = Math.min(1, Math.max(0, norm));
  if (st.duration) out[st.duration.name] = Math.min(topOf(st.duration), Math.max(0, durationMs || 0) * TIME_SCALE[st.duration.unitId]);
  if (st.endVel && endVel != null) out[st.endVel.name] = Math.min(topOf(st.endVel), Math.max(-topOf(st.endVel), endVel));
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
 *   halted?() -> reason string, '' when motion may flow, lastNack?(ch) ->
 *   the newest NACK record {name} the link saw on ch, or null}
 * @returns {(norm: number, durationMs?: number) => {ok: boolean, reason?: string}}
 */
export function createMotionDoor(deps) {
  const asked = new Map(); // sessionId:channel -> 'pending' | 'granted' | 'refused'
  const now = deps.now || (() => performance.now());
  let path = '';
  let lastCode = '';
  const nackSeen = new Map(); // channel -> the newest NACK record already accounted for
  const note = (p, msg) => { if (p !== path) { path = p; deps.log('info', msg); } };
  const noteSegments = (ch, grant) => note('segments:' + ch, 'motion input: segments STREAM 0x' + ch.toString(16)
    + ', horizon ' + grant.scheduleHorizonMs + ' ms, lead ' + (grant.scheduleLatencyUs || 0) + ' us');

  /** The channel's grant, asked for once per session: a grant, 'pending' or 'refused'. */
  function grantFor(s, st) {
    const ch = st.entry.id;
    const grant = s.state.grantedPublishes.get(ch);
    if (grant) return grant;
    const id = s.state.sessionId + ':' + ch;
    const a = asked.get(id);
    if (a === 'refused') return 'refused';
    if (a !== 'pending') {
      asked.set(id, 'pending');
      // No curve family: a free knot is shaped by the hub's smoothness (RFC-108).
      s.publish([[ch, st.entry.maxRateHz || FALLBACK_RATE_HZ]]).then(
        (g) => asked.set(id, g.find((x) => x.channel === ch) ? 'granted' : 'refused'),
        (e) => { asked.set(id, 'refused'); deps.log('warn', 'motion input: ' + e.message); },
      );
    }
    return 'pending';
  }

  function refused(e) {
    const code = e.code || e.message;
    if (code !== lastCode) deps.log('warn', 'motion input refused: ' + e.message);
    lastCode = code;
    return code;
  }

  function setpoint(norm, why) {
    note('setpoint:' + why, 'motion input: command.position setpoint (' + why + '), duration dropped');
    return deps.setpoint(norm);
  }

  function send(s, st, grant, norm, durationMs) {
    const ch = st.entry.id;
    if (st.duration) {
      const lead = grant.scheduleLatencyUs || 0;
      noteSegments(ch, grant);
      const now = filteredHubNowUs(s);
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
    s.publishSamples(ch, record(st, norm), { anchor: (filteredHubNowUs(s) + leadMs * 1000) >>> 0 });
  }

  function submit(norm, durationMs) {
    if (!Number.isFinite(norm)) return { ok: false, reason: 'position is not a number' };
    const held = deps.halted ? deps.halted() : '';
    if (held) return { ok: false, reason: held };
    const seg = motionStream(deps.entries(), STREAM_KIND.segments);
    const smp = motionStream(deps.entries(), STREAM_KIND.samples);
    const st = durationMs > 0 ? seg || smp : smp || seg;
    if (!st) return setpoint(norm, 'hub has no motion STREAM');
    const s = deps.session();
    if (!s) return { ok: false, reason: 'not connected' };
    const grant = grantFor(s, st);
    if (grant === 'refused') return setpoint(norm, 'publish refused');
    if (grant === 'pending') return { ok: false, reason: 'waiting for the stream grant' };

    try {
      send(s, st, grant, norm, durationMs);
      lastCode = '';
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: refused(e) };
    }
  }

  /**
   * The RFC-087 lookahead door: `list` is [{atMs, norm, durationMs, endVel?}],
   * atMs the now() instant the machine STARTS executing each, ascending, endVel
   * the velocity at its end in norm/s (absent: `unspecified`). Sends what
   * starts within half the granted horizon in one bundle; `sent` counts the
   * leading items through the last one packed (an item before it may have been
   * consumed as too short or colliding), so the caller advances by it.
   *
   * Constraints:
   * - Segments STREAM only: never a samples or setpoint fallback.
   * - Execution = stamp + schedule_latency_us (RFC-059): the stamp is the
   *   execution start minus the grant's latency, never a constant.
   * - A late start is clipped to the earliest executable instant keeping its
   *   end and its end velocity. `unspecified` leaves the knot to the hub,
   *   which resolves it to rest without a successor (SPEC §9.6, RFC-058).
   * - A STREAM bundle has no answer: the hub's NACK on the channel (e.g.
   *   SOURCE_CONFLICT while a generator owns the rail) arrives later through
   *   `deps.lastNack(ch)`, and the next call refuses once with its name. The
   *   first call per channel only takes the baseline.
   * @returns {{ok: boolean, sent: number, rateHz?: number, reason?: string}}
   */
  submit.segments = function segments(list) {
    const held = deps.halted ? deps.halted() : '';
    if (held) return { ok: false, sent: 0, reason: held };
    const st = motionStream(deps.entries(), STREAM_KIND.segments);
    if (!st) return { ok: false, sent: 0, reason: 'hub has no segments STREAM' };
    const nk = deps.lastNack ? deps.lastNack(st.entry.id) : null;
    if (!nackSeen.has(st.entry.id)) nackSeen.set(st.entry.id, nk);
    else if (nk && nk !== nackSeen.get(st.entry.id)) {
      nackSeen.set(st.entry.id, nk);
      return { ok: false, sent: 0, reason: nk.name || 'refused by the hub' };
    }
    const s = deps.session();
    if (!s) return { ok: false, sent: 0, reason: 'not connected' };
    const grant = grantFor(s, st);
    if (grant === 'refused') return { ok: false, sent: 0, reason: 'publish refused' };
    if (grant === 'pending') return { ok: false, sent: 0, reason: 'waiting for the stream grant' };
    const rateHz = grant.rate;
    const hubNow = filteredHubNowUs(s);
    const p = now();
    if (!list || !list.length) return { ok: true, sent: 0, rateHz };
    let prev = -Infinity;
    for (const x of list) {
      if (!x || !Number.isFinite(x.atMs) || !Number.isFinite(x.norm) || !Number.isFinite(x.durationMs)
        || x.durationMs <= 0 || x.atMs < prev || (x.endVel != null && !Number.isFinite(x.endVel))) return { ok: false, sent: 0, reason: 'bad segment', rateHz };
      prev = x.atMs;
    }

    const lat = grant.scheduleLatencyUs || 0;
    const unit = LIMITS.segment_t_off_unit_us;
    const packed = []; // {atUs: stamp, rec, i: list index}
    let s0 = null;
    let lastOff = -1;
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      let e = hubNow + (x.atMs - p) * 1000;
      const end = e + x.durationMs * 1000;
      if (e < hubNow + lat) e = hubNow + lat;
      if (end - e < SEG_FLOOR_MS * 1000) continue;
      const stamp = e - lat;
      if (s0 === null) s0 = Math.round(stamp);
      const off = Math.round((stamp - s0) / unit) * unit;
      if (off <= lastOff) continue;
      lastOff = off;
      packed.push({ atUs: s0 + off, rec: record(st, x.norm, (end - e) / 1000, x.endVel), i });
    }
    const { head } = bundleHead(packed, hubNow, grant.scheduleHorizonMs / 2, recordBytes(st.entry.layout));
    if (!head.length) return { ok: true, sent: 0, rateHz };

    noteSegments(st.entry.id, grant);
    try {
      s.publishSegment(st.entry.id, head.map((x) => x.rec), { anchor: s0 >>> 0, offsetsUs: head.map((x) => x.atUs - s0) });
    } catch (e) {
      return { ok: false, sent: 0, reason: refused(e), rateHz };
    }
    lastCode = '';
    return { ok: true, sent: head[head.length - 1].i + 1, rateHz };
  };

  return submit;
}

/**
 * Why a motion-input STREAM field cannot take input now (law 3), first that
 * applies, or ''. `running` is railOwned (a generator); `busy` the host's
 * producer-lock words. Reported values only. A foreign stream holding the
 * rail is the hub's SOURCE_CONFLICT to say (conflictWords names it).
 */
export function streamGate({ live, roles, access, halted, running, busy }) {
  if (!live) return 'no hub link';
  if ((roles | 0) < (access | 0)) return 'session not authorized';
  if (halted) return halted;
  if (running) return 'stop the pattern first';
  return busy || '';
}

/**
 * A segments refusal in the operator's words: SOURCE_CONFLICT names the first
 * labeled owner whose session is not `self` (`owners` is railOwners output);
 * any other reason passes through.
 */
export function conflictWords(reason, owners, self) {
  if (reason !== 'SOURCE_CONFLICT') return reason;
  const o = (owners || []).find((x) => x.session !== self && x.name);
  return 'refused: rail owned by ' + (o ? o.name : 'another source');
}
