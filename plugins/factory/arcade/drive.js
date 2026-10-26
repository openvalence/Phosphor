/**
 * drive.js -- the one way an arcade game moves the machine: a game says where it wants the carriage
 * (0..1 across the stroke window) every frame; this turns that into short segments through
 * api.submitSegments, the plugin motion door, rate- and acceleration-limited.
 *
 * Constraints (operator 2026-10-10; docs/PLUGINS.md, Factory plugins, arcade):
 * - Nothing moves until allow(true), the user's "Allow motion". It is refused while the gate speaks
 *   (no link, not authorized, paused, e-stop latched, a pattern running, another producer) and while
 *   the machine reports no position: the first segment starts from where the carriage is.
 * - Speed and acceleration stay at CAPS (0.5 and 2 of the window a second) and at most FRAC (40 %) of
 *   the machine's own ceilings when it reports them in mm: well under the user's limits.
 * - Any gate words or refusal at a send drops the consent: a Pause or a Halt stops the game's motion and
 *   it never resumes on its own; the user allows motion again. A refused send sends no hold.
 * - Segments are SEG_MS long, back to back, sent when under LEAD_MS is left queued: at most LEAD + SEG
 *   (160 ms) is ever ahead, so when the game stops ticking (input lost, window hidden, page left) the
 *   machine runs out of segments within that quiet window and stops.
 * - stop() is the game's own stop: one decelerating hold (end velocity 0), then no more segments.
 * - Never writes a setting. Pure but for the api it is handed: test/arcade.test.mjs drives it with a stub.
 */
export const CAPS = Object.freeze({ v: 0.5, a: 2, frac: 0.4, lo: 0.05, hi: 0.95, segMs: 100, leadMs: 60, minLeadMs: 15, aheadMs: 160, warmMs: 3000, gain: 4 });
export const ROLES = Object.freeze({ target: 'input.target', pos: 'telemetry.position', lo: 'window.min', hi: 'window.max',
  vmax: 'limit.input.speed', amax: 'limit.input.accel' });

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (api, f) => (f ? Number(api.value(f)) : NaN);
const unit = (f, id, text) => !!f && (f.unitId === id || f.unit === text);

/** The fields the drive binds by role, each null when the hub has none. The input role binds in the segments STREAM entry it sends on (RFC-123). */
export function bindFields(api) {
  return Object.fromEntries(Object.entries(ROLES).map(([k, role]) => [k, api.field(role, 'segments') || null]));
}

export function createDrive(api, { fields = null, now = () => performance.now(), onStop = () => {} } = {}) {
  let f = fields;
  let allowed = false, reason = '';
  let pos = 0, vel = 0, lastEnd = 0, warmUntil = 0;

  const span = () => {
    const lo = num(api, f.lo), hi = num(api, f.hi);
    return unit(f.lo, 0, 'mm') && unit(f.hi, 0, 'mm') && hi > lo ? hi - lo : null;
  };
  /** The effective limits in window fractions a second: the game's own, or 40 % of the machine's, the lower. */
  const caps = () => {
    let v = CAPS.v, a = CAPS.a;
    const s = f && span();
    if (s) {
      const vm = num(api, f.vmax), am = num(api, f.amax);
      if (unit(f.vmax, 1, 'mm/s') && vm > 0) v = Math.min(v, CAPS.frac * vm / s);
      if (unit(f.amax, 2, 'mm/s²') && am > 0) a = Math.min(a, CAPS.frac * am / s);
    }
    return { v, a };
  };
  const here = () => {
    const p = num(api, f.pos), lo = num(api, f.lo), hi = num(api, f.hi);
    return Number.isFinite(p) && hi > lo ? (p - lo) / (hi - lo) : null;
  };
  const drop = (why, hold) => {
    if (!allowed) return;
    allowed = false;
    reason = why || '';
    if (hold) {
      // Brake at the allowed deceleration from the last knot, then hold.
      const { a } = caps();
      const s = vel * vel / (2 * a);
      const end = clamp(pos + Math.sign(vel) * s, 0, 1);
      const durationMs = Math.max(CAPS.segMs, Math.abs(vel) > 1e-6 ? 2 * s / Math.abs(vel) * 1000 : 0);
      const t = now();
      if (!api.gate(f.target)) api.submitSegments([{ atMs: Math.max(t + CAPS.leadMs, lastEnd), norm: end, durationMs, endVel: 0 }]);
      pos = end;
    }
    vel = 0;
    onStop(reason);
  };

  return {
    get allowed() { return allowed; },
    get reason() { return reason; },
    get pos() { return pos; },
    caps,
    /** The cap in mm/s when the window is in mm, else null: the page says it in the user's units. */
    mmPerS() { const sp = f && span(); return sp ? caps().v * sp : null; },
    /** The user's consent. On: '' when granted, else why not. Off: the game's own stop. */
    allow(on) {
      if (!on) { drop('', true); return ''; }
      if (allowed) return '';
      f = f || bindFields(api);
      if (!f.target) return (reason = 'this machine takes no motion input');
      const g = api.gate(f.target);
      if (g) return (reason = g);
      const p = here();
      if (p == null) return (reason = 'the machine reports no position');
      pos = p; vel = 0; lastEnd = 0; warmUntil = now() + CAPS.warmMs;
      reason = '';
      allowed = true;
      api.submitSegments([]);   // warms the grant
      return '';
    },
    /** A frame: `want` is where the game wants the carriage, 0..1. Sends one segment when under LEAD is left queued. */
    tick(want) {
      if (!allowed) return;
      const t = now();
      if (lastEnd - t >= CAPS.leadMs) return;
      const g = api.gate(f.target);
      if (g) { drop(g, false); return; }
      // Contiguous while the last segment still has MIN_LEAD to run; else a fresh start LEAD out.
      const start = lastEnd >= t + CAPS.minLeadMs ? lastEnd : t + CAPS.leadMs;
      if (start > t + CAPS.aheadMs) return;
      const { v, a } = caps();
      const d = clamp(Number.isFinite(want) ? want : pos, CAPS.lo, CAPS.hi);
      const vt = clamp((d - pos) * CAPS.gain, -v, v);
      // Segments run back to back, SEG_MS each: the speed changes by at most a x SEG_MS between two.
      // After a gap the carriage has come to rest at the last knot.
      if (start > lastEnd) vel = 0;
      const step = CAPS.segMs / 1000;
      const nv = vel + clamp(vt - vel, -a * step, a * step);
      const next = clamp(pos + nv * step, 0, 1);
      const r = api.submitSegments([{ atMs: start, norm: next, durationMs: CAPS.segMs }]);
      if (r && r.ok) {
        if (r.sent > 0) { vel = (next - pos) / step; pos = next; lastEnd = start + CAPS.segMs; }
      } else if (r && r.reason === 'waiting for the stream grant' && t < warmUntil) {
        vel = 0;
      } else {
        drop((r && r.reason) || 'refused', false);
      }
    },
    /** A latch, link or producer change while allowed: gate words drop the consent, idle or not. */
    check() { if (allowed && f && f.target) { const g = api.gate(f.target); if (g) drop(g, false); } },
    /** The game's own stop (game over, page left, window hidden or blurred): one hold, consent dropped. */
    stop(why = '') { drop(why, true); },
  };
}
