/**
 * telebuf.js — a tiny ring-buffer interpolator for smoothing ONE live scalar.
 *
 * `machine.svelte.js` stamps every decoded STATE sample
 * (`machine.sampleTs[channelId]`) in the Date.now() epoch-ms domain: by its hub
 * sample time through the CLOCK offset where the layout carries a
 * telemetry.sample_time field (RFC-113 draft; `machine.sampleRxTs` then holds
 * the arrival), else by its arrival. A caller pushes {value, tsMs} pairs as
 * they arrive off `machine.samples`/`machine.sampleTs`, with the arrival for a
 * hub-dated one.
 *
 * CLOCK-DOMAIN TRAP (bit us once, guard stays): `sampleAt(tMs)` must be
 * called with a timestamp in that SAME Date.now() epoch-ms domain. A
 * `requestAnimationFrame` callback's own argument is a DOMHighResTimeStamp —
 * ms since `performance.timeOrigin`, a much smaller number — and passing it
 * straight through makes `tMs` permanently "older" than every real sample in
 * the ring, so `sampleAt()` always takes the `tMs <= bufT[head]` branch and
 * returns the OLDEST entry still buffered: with the default 256-deep ring at
 * ~30 Hz that reads as the display lagging live position by ~8-9 SECONDS,
 * constantly, which is exactly the "incredibly laggy" field report this
 * comment exists to prevent a repeat of. Callers driven by rAF must convert
 * with `performance.timeOrigin + rafTimestamp` before calling `sampleAt()` —
 * see RailWidget.svelte's `draw()`.
 *
 * What is kept, because it is still true at ~20-30 Hz STATE cadence rendered
 * at 60 fps rAF: samples arrive slower than frames are drawn, so a caller
 * wanting a smooth line needs to interpolate BETWEEN real samples and briefly
 * extrapolate PAST the newest one along its last secant rather than
 * snapping/holding (the hero numerals read the newest sample instead, ph-6vh).
 * Between samples the curve is the monotone cubic of src/model/interp.js: it
 * passes through every sample and never overshoots one. `sampleAt()`
 * never fabricates a value out of nothing: with zero samples it reports
 * `fresh:false` and a null value, which callers must treat as "withhold",
 * not "draw at zero" (Ground Truth Doctrine).
 *
 * Deliberately NOT a Svelte store / `.svelte.js` — this is called from inside
 * a rAF loop up to 60 times a second, and routing that through reactive state
 * would fire the whole reactivity graph for no reason. Callers push the
 * handful of *derived* display numbers they actually render into `$state`.
 *
 * ── The render delay (jitter regressions #3 and #4, measured) ────────────────
 *
 * Sampling at raw "now" outruns the newest sample whenever a push lands late,
 * and the display freezes then snaps (regression #3). So callers sample at
 * `now - delay` from `createRenderClock`, a jitter buffer and the whole of the
 * comet's display lag, so it is sized to what it buffers and no more: push()
 * returns how far its arrival ran past the newest STORED sample (`lateness`),
 * and the delay is the p95 of that over the last 32 arrivals plus a small
 * margin. That is exactly the run the render instant would otherwise make past
 * the newest sample, measured on the reconstructed timeline below, so a
 * schedule that leads arrival buys back its lead. Do not size it from the
 * arrival GAP: that counts the schedule's lead twice, and on a clumped feed
 * (three samples per 90 ms) pegs the delay at its 120 ms ceiling.
 *
 * Past the newest sample, sampleAt() extrapolates along the last secant for at
 * most EXTRAPOLATE_MS (80 ms covers one >100 ms hub-pacing straggler, regression
 * #4), never past `limit` (the caller's planned end), then holds. SLEW 4 ms per
 * frame acquires a burst's delay within about a second. Do not lower either
 * without re-measuring the on-device gap distribution.
 *
 * ── jitter regression #5: arrival-time stamping (TRAPS T18, measured) ─────
 *
 * The pushed `tsMs` is Date.now() AT DECODE TIME — and STATE frames arrive in
 * TCP clumps. Measured on-device during real motion (rail-probe.mjs,
 * 2026-07-28): 71 of 393 arrivals in 12s carried an IDENTICAL stamp to their
 * predecessor and p95 arrival gap was 90ms against a ~30ms true period. Under
 * arrival-time stamping the old push() dropped every duplicate outright
 * (~18% of all motion samples discarded), then interpolated across the hole:
 * 107 of 719 rendered frames were snaps and 17 were multi-frame freezes.
 * No interpolation, however smooth, can survive garbage timestamps.
 *
 * The pre-refactor rail never trusted arrival time: `railFeed` re-spaced
 * every batch by the known sample period and anchored it slightly in the
 * FUTURE of "now", so the interpolator always saw an even timeline. push()
 * now restores that mechanism: `tsMs` is treated as an arrival HINT, and the
 * STORED timestamp is reconstructed as max(arrival, prev + trimmed period),
 * capped at arrival + SCHEDULE_MAX_LEAD_MS, where `period` is an EMA of
 * arrival gaps (bursts average out: 0,0,90,0,0,85… means ~30). Steady state stores
 * perfectly even spans; a burst after a gap lands as N even spans that
 * exactly absorb the gap; a genuine stall (arrival far past the schedule)
 * resyncs forward through the max(). The render clock keeps measuring RAW
 * arrival gaps, so its delay stays sized to the real burstiness and the
 * sampled instant stays safely inside the reconstructed, future-extended
 * ring. Do not "simplify" this back to storing arrival time — that IS
 * regression #5.
 */

import { pchipSlope, hermite } from '../../model/interp.js';

// Client display latency on a steady stream is the render delay plus however
// far the push() schedule leads arrival. The knobs for both are here.

/**
 * Ceiling on how far the push() schedule may lead arrival. A schedule riding
 * this cap stores arrival time plus a constant, which is regression #5 with an
 * offset, so keep it near one clump's spread, not a latency budget.
 */
const SCHEDULE_MAX_LEAD_MS = 60;

/**
 * push() respaces at this fraction of the EMA period. Must stay below 1: the
 * schedule is a max(), so at exactly 1 any EMA noise ratchets it forward and
 * it never comes back until it sits on SCHEDULE_MAX_LEAD_MS.
 */
const SCHEDULE_PERIOD_TRIM = 0.98;

/** createRenderClock's clamp on the p95 lateness plus RENDER_DELAY_MARGIN_MS. */
const RENDER_DELAY_MIN_MS = 5;
const RENDER_DELAY_MAX_MS = 120;
const RENDER_DELAY_MARGIN_MS = 3;

/**
 * @param {{capacity?: number, holdMs?: number, extrapolateMs?: number, reschedule?: boolean}} [opts]
 *   capacity: ring depth. holdMs: how long a value is considered "fresh" once
 *   no newer sample has arrived. extrapolateMs: how far past the newest real
 *   sample to project along its last secant before holding flat.
 */
export function createTelebuf(opts = {}) {
  const CAP = opts.capacity || 256;
  const HOLD_MS = opts.holdMs != null ? opts.holdMs : 1200;
  const EXTRAPOLATE_MS = opts.extrapolateMs != null ? opts.extrapolateMs : 80;

  const bufT = new Float64Array(CAP);
  const bufV = new Float64Array(CAP);
  let head = 0;
  let len = 0;
  let lastVelPerMs = 0;      // value units per ms: the newest secant, on the stored timeline
  let lastPushTs = 0;

  // Timestamp reconstruction (jitter regression #5, header): arrival time is
  // a HINT; stored time is an even, future-anchored schedule. Callers with
  // TRUSTED timestamps (a device-stamped batched-telemetry frame, or a test
  // exercising pure interpolation math) pass `reschedule: false` and their
  // stamps are stored as-is.
  const RESCHEDULE = opts.reschedule !== false;
  let periodMs = 40;         // EMA of arrival gaps — zero-gap bursts average out
  let lastArrivalTs = 0;

  /**
   * Push one ground-truth sample. `tsMs` is the ARRIVAL hint (see header), or
   * with `arrivalMs` the instant the sample was TAKEN (a hub-dated sample,
   * machine.sampleRxTs), stored as is: no reschedule, since its spacing is the
   * truth. Returns the lateness: how far this arrival ran past the newest
   * stored sample (negative while the schedule leads), NaN for the first
   * sample, a stall or a dwell. Feed it to createRenderClock's noteLate().
   */
  function push(value, tsMs, arrivalMs) {
    if (value == null || !isFinite(value) || !isFinite(tsMs)) return NaN;

    const newestIdx = len ? (head + len - 1) % CAP : -1;
    const trusted = !RESCHEDULE || arrivalMs != null;
    let ts;
    let late = NaN;
    if (trusted) {
      if (newestIdx >= 0 && tsMs <= bufT[newestIdx]) return NaN; // trusted stamps: not newer, drop
      ts = tsMs;
      if (newestIdx >= 0) late = (arrivalMs ?? tsMs) - bufT[newestIdx];
      lastArrivalTs = arrivalMs ?? tsMs;
    } else {
      const gapSinceLast = lastArrivalTs > 0 ? tsMs - lastArrivalTs : -1;
      // Only plausible STREAMING gaps teach the period. Idle/dwell gaps (the
      // hub sheds an unchanging channel; a pattern dwells at a stroke end)
      // are MODE SWITCHES, not cadence — letting one 600ms gap into the EMA
      // ballooned the period and made the first spans after motion resumed
      // garbage: the operator-reported "random position for one tick on
      // first movement / direction change."
      const streaming = gapSinceLast >= 0 && gapSinceLast < Math.min(4 * periodMs, 200);
      if (streaming) periodMs += 0.05 * (gapSinceLast - periodMs);
      lastArrivalTs = tsMs;

      if (newestIdx < 0) {
        ts = tsMs;
      } else if (gapSinceLast > 500) {
        // Stream resumed after a genuine stall: resync the schedule to the
        // arrival instead of extending the old cadence across the hole.
        ts = Math.max(tsMs, bufT[newestIdx] + 1);
      } else {
        if (streaming) late = tsMs - bufT[newestIdx];
        ts = Math.max(tsMs, bufT[newestIdx] + Math.max(1, periodMs * SCHEDULE_PERIOD_TRIM));
        // Cap schedule-ahead-of-arrival drift, but NEVER drop a sample for
        // it — monotonic +1ms is always available (dropping data was the
        // original regression-#5 sin).
        ts = Math.max(Math.min(ts, tsMs + SCHEDULE_MAX_LEAD_MS), bufT[newestIdx] + 1);
      }
    }

    const idx = (head + len) % CAP;
    if (len === CAP) { head = (head + 1) % CAP; len--; }
    bufT[idx] = ts;
    bufV[idx] = value;
    len++;
    // Against the RECONSTRUCTED schedule, never the arrival stamps: a clump
    // shares one arrival, so an arrival-delta slope is undefined inside it (T18).
    if (newestIdx >= 0) lastVelPerMs = (value - bufV[newestIdx]) / (ts - bufT[newestIdx]);
    lastPushTs = arrivalMs ?? tsMs;
    return late;
  }

  const at = (k) => (head + k) % CAP; // the k-th stored sample, oldest first

  /**
   * Interpolate/extrapolate the display value at client time `tMs`, into `out`
   * when given (no allocation). `limit`: a value extrapolation never passes,
   * and holds at the newest sample when the secant runs away from it (the
   * plan's end). `span`: the length of the bracketing sample span, 0 outside.
   * @returns {{value: number|null, velPerMs: number, fresh: boolean, extrapolating: boolean, holding: boolean, span: number}}
   */
  function sampleAt(tMs, out = {}, limit = null) {
    out.velPerMs = 0; out.extrapolating = false; out.holding = false; out.span = 0;
    if (len === 0) { out.value = null; out.fresh = false; return out; }

    out.fresh = (tMs - lastPushTs) < HOLD_MS;
    const newestIdx = at(len - 1);
    const newestT = bufT[newestIdx];

    if (len === 1 || tMs <= bufT[head]) { out.value = bufV[head]; return out; }

    if (tMs >= newestT) {
      const pastMs = tMs - newestT, vN = bufV[newestIdx];
      if (pastMs <= EXTRAPOLATE_MS) {
        let v = vN + lastVelPerMs * pastMs;
        if (limit != null && isFinite(limit)) {
          if ((limit - vN) * lastVelPerMs <= 0) v = vN;
          else if ((v - limit) * lastVelPerMs > 0) v = limit;
        }
        out.value = v; out.velPerMs = lastVelPerMs; out.extrapolating = true;
        return out;
      }
      // `holding` IS the stutter: the render instant has outrun the newest
      // sample past the extrapolate window, so this frame repeats the last
      // value and the next arrival snaps forward. Counted, never smoothed
      // over: a rising hold rate is the measurement, not a symptom to hide.
      out.value = vN; out.holding = true;
      return out;
    }

    // The render instant sits a sample or two behind the newest: search back.
    let k = len - 1;
    while (k > 1 && bufT[at(k - 1)] > tMs) k--;
    const lo = at(k - 1), hi = at(k);
    const span = bufT[hi] - bufT[lo];
    const p0 = bufV[lo], p1 = bufV[hi], d = (p1 - p0) / span;
    let m0 = d, m1 = d;
    if (k >= 2) { const pv = at(k - 2), h0 = bufT[lo] - bufT[pv]; m0 = pchipSlope(h0, (p0 - bufV[pv]) / h0, span, d); }
    if (k <= len - 2) { const nx = at(k + 1), h1 = bufT[nx] - bufT[hi]; m1 = pchipSlope(span, d, h1, (bufV[nx] - p1) / h1); }
    // Monotone in exact arithmetic; the clamp stops rounding from moving a
    // flat span by an ulp per frame, which would keep the on-demand loop awake.
    const h = hermite(p0, p1, m0 * span, m1 * span, (tMs - bufT[lo]) / span);
    out.value = Math.min(Math.max(h, Math.min(p0, p1)), Math.max(p0, p1));
    out.velPerMs = lastVelPerMs;
    out.span = span;
    return out;
  }

  /** Reset to empty — call when the bound field's channel/uid changes identity. */
  function reset() {
    head = 0; len = 0; lastVelPerMs = 0; lastPushTs = 0;
    lastArrivalTs = 0; periodMs = 40;
  }

  /** Visit stored samples oldest first, at their RECONSTRUCTED times. */
  function forEach(fn) {
    for (let i = 0; i < len; i++) {
      const idx = (head + i) % CAP;
      fn(bufT[idx], bufV[idx]);
    }
  }

  return { push, sampleAt, reset, forEach, get length() { return len; } };
}

const tailRes = {};
/**
 * The recent path for the comet's tail: out[k] is the value at
 * tEnd - k * spanMs / (out.length - 1), newest first, off the same curve as
 * sampleAt() (so the tail ends exactly at the head). Stops at the first point
 * with no value or inside a sample span longer than `gapMs` (a dropout is a
 * gap, never a guessed curve). Returns how many points it wrote. No allocation.
 */
export function sampleTail(tele, tEnd, spanMs, out, limit = null, gapMs = 250) {
  const n = out.length - 1;
  for (let k = 0; k <= n; k++) {
    const r = tele.sampleAt(tEnd - (k * spanMs) / n, tailRes, limit);
    if (r.value == null || r.span > gapMs) return k;
    out[k] = r.value;
  }
  return n + 1;
}

/**
 * Strip-chart path over REAL samples only (RENDERING Â§13 law 9): no point is
 * synthesized and nothing is drawn across link silence.
 *
 * Constraints:
 * - `gaps` are link-stale spans ({from, to}, `to` null while still stale) from
 *   the model's one freshness rule. A span between two samples starts a new
 *   segment with a move; the newest sample holds only up to the first span
 *   after it, and is returned as `marker` so the caller can dim it.
 * - Between two samples with no span, the value was unchanged until the later
 *   one arrived (STATE pushes on change, SPEC Â§9.1), so spacing beyond `joinMs`
 *   draws as hold-then-step, never as an invented slope.
 *
 * @param {Array<{t: number, v: number}>} points oldest first
 * @param {Array<{from: number, to: number|null}>} gaps
 * @returns {{ops: Array<{t: number, v: number, pen: 'M'|'L'}>, marker: {t: number, v: number}|null}}
 */
export function chartPath(points, gaps, nowMs, joinMs) {
  const cut = (t0, t1) => gaps.some((g) => g.from < t1 && (g.to == null || g.to > t0));
  const ops = [];
  let prev = null;
  for (const p of points) {
    if (!prev || cut(prev.t, p.t)) {
      ops.push({ t: p.t, v: p.v, pen: 'M' });
    } else {
      if (p.t - prev.t > joinMs) ops.push({ t: p.t, v: prev.v, pen: 'L' });
      ops.push({ t: p.t, v: p.v, pen: 'L' });
    }
    prev = p;
  }
  if (!prev) return { ops, marker: null };
  const after = gaps.filter((g) => g.to == null || g.to > prev.t);
  const end = after.length ? Math.max(prev.t, Math.min(...after.map((g) => g.from))) : nowMs;
  if (end > prev.t) ops.push({ t: end, v: prev.v, pen: 'L' });
  return { ops, marker: after.length ? prev : null };
}

/**
 * A single render-delay clock, SHARED across every telebuf that must agree
 * about "now" (position/velocity/target — see RailWidget.svelte, which reads
 * all three at the one instant this produces so the comet and the tape cursor
 * never disagree). See this file's header for what the delay buffers.
 *
 * Usage: pass every primary sample's push() lateness to `noteLate(ms)`, call
 * `update(frameDtMs)` once per rendered frame, then read `renderTime(t)` (or
 * `stableRenderTime(t)`, which additionally never rewinds more than one frame —
 * a delay that grows because arrivals just got later must not make the display
 * visibly jump backward). No allocation per frame or per arrival.
 *
 * @param {{minDelayMs?: number, maxDelayMs?: number, slewMsPerFrame?: number, lateCapacity?: number}} [opts]
 */
export function createRenderClock(opts = {}) {
  const MIN_DELAY_MS = opts.minDelayMs != null ? opts.minDelayMs : RENDER_DELAY_MIN_MS;
  const MAX_DELAY_MS = opts.maxDelayMs != null ? opts.maxDelayMs : RENDER_DELAY_MAX_MS;
  const SLEW_MS_PER_FRAME = opts.slewMsPerFrame != null ? opts.slewMsPerFrame : 4;
  const CAP = opts.lateCapacity || 32; // ~1 s of arrivals at 30 Hz: plenty for a p95

  const late = new Float64Array(CAP);
  const sorted = new Float64Array(CAP);
  let lateHead = 0, lateLen = 0;

  let delayMs = (MIN_DELAY_MS + MAX_DELAY_MS) / 2; // sane mid-point before any data
  let targetMs = delayMs;
  let frameDtMs = 16.667;
  let lastRenderT = 0;

  /** One arrival's lateness (push()'s return); NaN is ignored. Re-targets the delay at the p95. */
  function noteLate(ms) {
    if (!isFinite(ms)) return;
    late[lateHead] = ms;
    lateHead = (lateHead + 1) % CAP;
    if (lateLen < CAP) lateLen++;
    sorted.set(late);
    if (lateLen < CAP) sorted.fill(Infinity, lateLen);
    sorted.sort();
    const p95 = sorted[Math.floor(0.95 * (lateLen - 1))];
    targetMs = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, p95 + RENDER_DELAY_MARGIN_MS));
  }

  /** Slew the delay toward its target. Call once per rendered frame. */
  function update(dtMs) {
    if (dtMs > 0 && dtMs < 200) frameDtMs = dtMs;
    delayMs += Math.max(-SLEW_MS_PER_FRAME, Math.min(SLEW_MS_PER_FRAME, targetMs - delayMs));
  }

  function getDelayMs() { return delayMs; }

  /** t_render = t - delay. */
  function renderTime(tMs) { return tMs - delayMs; }

  /** Same, but never rewinds more than one frame versus the last call — avoids a visible backward jump when the delay grows. */
  function stableRenderTime(tMs) {
    let t = renderTime(tMs);
    if (lastRenderT > 0 && t < lastRenderT - frameDtMs) t = lastRenderT - frameDtMs;
    lastRenderT = t;
    return t;
  }

  function reset() {
    lateHead = 0; lateLen = 0; lastRenderT = 0;
    delayMs = targetMs = (MIN_DELAY_MS + MAX_DELAY_MS) / 2;
  }

  return { noteLate, update, getDelayMs, renderTime, stableRenderTime, reset };
}
