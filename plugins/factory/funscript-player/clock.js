// clock.js -- media clock: rVFC display times to performance.now(); pure except frameSource
// Contract: CONTRACT.md, module scheduler (ph-smvd.4); design: docs/plugins/FUNSCRIPT.md, Sync.
//
// Constraints:
// - One affine map per anchor, displayAt(m) = c0 + (m - m0) / rate. Corrections move c0 only,
//   so every span stamped from the map tiles with its neighbors.
// - A correction is subtracted from every residual in the ring, so the ring always holds
//   residuals against the current map and one offset is never corrected twice.
// - The step test reads the median of the LAST 8 residuals: the 32-wide median would need 17
//   frames to see a jump.
// - observe() before the first anchor does nothing: only the caller anchors.
// - A whole-median correction before the ring fills that moves the map more than STEP_MS
//   also returns 'step': the first frames after play() often land tens of ms off the anchor
//   frame, and segments already stamped from the old map would leave a hole.
// - STEP_MS sits between one 60 Hz vsync (16.7 ms, slewed) and one dropped 30 fps frame
//   (33 ms, stepped): slewing a dropped frame out at 5 ms/s lagged the video for 6 s.
// - frameSource's rAF fallback reports only while the video is not paused: a paused
//   currentTime against a running now() would read as a step on every frame.
// - LOW (the low latency setting) narrows the ring and raises the slew: the map follows a
//   display-latency change in a quarter second instead of six, and passes more vsync jitter
//   into the stamps. STEP_MS stays: below one vsync it would step on every cadence slip.
// - A loop runs the clock in unrolled media time (createLoop): lap L adds L x (b - a), so the
//   map stays one affine line across the wrap and the landing frame's seek delay is a residual.
//   A wrap counts only after wrap() and only on a frame in the section's first half: wrap() is
//   due within WRAP_EARLY_MS of b, so that frame has landed. It needs no frame before the wrap
//   (a loop set at the playhead wraps at once). A user seek is the caller's seeked().

export const CLOCK_WINDOW = 32, SLEW_MS_PER_S = 5, STEP_MS = 25, FALLBACK_AFTER_MS = 250;
export const LOW = Object.freeze({ window: 8, slew: 15, fallbackMs: 100 });
export const WRAP_EARLY_MS = 34;   // one 30 fps frame: a whole-media loop wraps before 'ended'
const STEP_WINDOW = 8;

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function createMediaClock({ window: win = CLOCK_WINDOW, slew = SLEW_MS_PER_S } = {}) {
  let m0 = 0, c0 = 0, ring = [], lastAt = 0, filled = false;
  const clock = {
    ready: false,
    rate: 1,
    /** {window, slew}: LOW or the defaults; takes effect at once, the ring trimmed to fit. */
    tune(o = {}) {
      win = o.window || CLOCK_WINDOW; slew = o.slew || SLEW_MS_PER_S;
      if (ring.length >= win) { ring = ring.slice(-win); filled = true; }
    },
    anchor(mediaMs, displayMs, rate = clock.rate) {
      m0 = mediaMs; c0 = displayMs; clock.rate = rate > 0 ? rate : 1;
      ring = []; filled = false; lastAt = displayMs; clock.ready = true;
    },
    reset() { clock.ready = false; ring = []; filled = false; },
    observe(mediaMs, displayMs) {
      if (!clock.ready || !Number.isFinite(mediaMs) || !Number.isFinite(displayMs)) return '';
      ring.push(displayMs - clock.displayAt(mediaMs));
      if (ring.length > win) ring.shift();
      if (ring.length === win) filled = true;
      const dt = Math.max(0, displayMs - lastAt) / 1000;
      lastAt = displayMs;
      if (ring.length >= STEP_WINDOW && Math.abs(median(ring.slice(-STEP_WINDOW))) > STEP_MS) {
        clock.anchor(mediaMs, displayMs, clock.rate);
        return 'step';
      }
      const r = median(ring);
      const lim = slew * dt;
      const corr = filled ? Math.max(-lim, Math.min(lim, r)) : r;
      c0 += corr;
      for (let i = 0; i < ring.length; i++) ring[i] -= corr;
      return !filled && Math.abs(corr) > STEP_MS ? 'step' : '';
    },
    displayAt(mediaMs) { return clock.ready ? c0 + (mediaMs - m0) / clock.rate : NaN; },
    mediaAt(displayMs) { return clock.ready ? m0 + (displayMs - c0) * clock.rate : NaN; },
  };
  return clock;
}

/** fallbackMs: () => ms without an rVFC frame before rAF reports currentTime (LOW.fallbackMs or the default). */
export function frameSource(video, onFrame, now = () => performance.now(), fallbackMs = () => FALLBACK_AFTER_MS) {
  let stopped = false, lastFrame = now(), vfcId = 0, rafId = 0;
  const vfc = typeof video.requestVideoFrameCallback === 'function';
  const onVfc = (_t, md) => {
    if (stopped) return;
    lastFrame = now();
    onFrame(md.mediaTime * 1000, md.expectedDisplayTime);
    vfcId = video.requestVideoFrameCallback(onVfc);
  };
  const onRaf = () => {
    if (stopped) return;
    const t = now();
    if (t - lastFrame >= fallbackMs() && !video.paused) onFrame(video.currentTime * 1000, t);
    rafId = requestAnimationFrame(onRaf);
  };
  if (vfc) vfcId = video.requestVideoFrameCallback(onVfc);
  rafId = requestAnimationFrame(onRaf);
  return () => {
    stopped = true;
    if (vfc && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(vfcId);
    cancelAnimationFrame(rafId);
  };
}

/** {a, b, count} in media ms, or null when the loop cannot hold a span: b - a >= 1000 and count >= 0
 *  (0 plays forever, N plays the a..b section N times in all, then plays on). durationMs bounds b. */
export function loopSpec(a, b, count = 0, durationMs = Infinity) {
  a = Math.max(0, +a || 0);
  b = Math.min(Number.isFinite(+b) ? +b : durationMs, durationMs);
  count = Math.max(0, Math.round(+count || 0));
  return b - a >= 1000 && count !== 1 ? { a, b, count } : null;
}

/**
 * The video side of a loop: when to send the video back to a, and media time unrolled across laps.
 * The caller seeks to wrap()'s ms when due(mediaMs) and feeds the clock unroll(mediaMs).
 */
export function createLoop() {
  let spec = null, pending = false;
  const loop = {
    lap: 0,
    get spec() { return spec; },
    set(s) { spec = s || null; loop.reset(); },
    reset() { loop.lap = 0; pending = false; },
    /** The section still repeats after this lap. */
    more() { return !!spec && (spec.count === 0 || loop.lap < spec.count - 1); },
    due(mediaMs) { return !pending && loop.more() && mediaMs >= spec.b - WRAP_EARLY_MS && mediaMs < spec.b + 1000; },
    wrap() { pending = true; return spec.a; },
    /** After a user seek: lap 0 again; a landing at or past b clears the loop. Returns the spec in force. */
    seeked(mediaMs) { loop.reset(); if (spec && mediaMs >= spec.b) spec = null; return spec; },
    /** Wrap pending: true while the seek it started has not landed (the caller skips its stop on it). */
    get wrapping() { return pending; },
    unroll(mediaMs) {
      if (pending && spec && mediaMs < spec.b - (spec.b - spec.a) / 2) { loop.lap++; pending = false; }
      return spec ? mediaMs + loop.lap * (spec.b - spec.a) : mediaMs;
    },
  };
  return loop;
}
