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
// - frameSource never anchors on expectedDisplayTime's origin: WebKit reports it on another
//   time base. It is used only within EDT_MS of the callback's now (itself within one frame of
//   performance.now()), else the frame is stamped at that now; a mediaTime outside currentTime
//   +-MEDIA_MS or [0, duration] is replaced by currentTime. mediaAt() never leads the last
//   observed frame by more than FRAME_MS: no drift accumulates past it whatever its source.
//   displayAt() is not capped: a clamped span would break the tiling above.
// - frameSource's rAF fallback runs only while the video is not paused: a paused
//   currentTime against a running now() would read as a step on every frame, and a paused
//   video costs no display frames. 'play' starts it again.
// - A loop runs the clock in unrolled media time (createLoop): lap L adds L x (b - a), so the
//   map stays one affine line across the wrap and the landing frame's seek delay is a residual.
//   A wrap counts only after wrap() and only on a frame in the section's first half: wrap() is
//   due within WRAP_EARLY_MS of b, so that frame has landed. It needs no frame before the wrap
//   (a loop set at the playhead wraps at once). A user seek is the caller's seeked().

export const CLOCK_WINDOW = 32, SLEW_MS_PER_S = 5, STEP_MS = 25, FALLBACK_AFTER_MS = 250;
export const WRAP_EARLY_MS = 34;   // one 30 fps frame: a whole-media loop wraps before 'ended'
const STEP_WINDOW = 8;
const FRAME_MS = 34;    // one 30 fps frame
const EDT_MS = 100;     // an expectedDisplayTime farther than this from the callback's now is on another origin
const MEDIA_MS = 1000;  // a mediaTime farther than this from currentTime is in another unit

const warn = (what, raw) => console.warn('funscript clock guard, ' + what + ': ' + Object.entries(raw).map(([k, v]) => k + '=' + v).join(' '));

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function createMediaClock({ window: win = CLOCK_WINDOW, slew = SLEW_MS_PER_S } = {}) {
  let m0 = 0, c0 = 0, ring = [], lastAt = 0, lastM = 0, filled = false, cAnchor = 0, warned = false;
  const clock = {
    ready: false,
    rate: 1,
    anchor(mediaMs, displayMs, rate = clock.rate) {
      m0 = mediaMs; c0 = displayMs; clock.rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
      ring = []; filled = false; lastAt = cAnchor = displayMs; lastM = mediaMs; clock.ready = true;
    },
    reset() { clock.ready = false; ring = []; filled = false; },
    observe(mediaMs, displayMs) {
      if (!clock.ready || !Number.isFinite(mediaMs) || !Number.isFinite(displayMs)) return '';
      ring.push(displayMs - clock.displayAt(mediaMs));
      if (ring.length > win) ring.shift();
      if (ring.length === win) filled = true;
      const dt = Math.max(0, displayMs - lastAt) / 1000;
      lastAt = displayMs; lastM = mediaMs;
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
    mediaAt(displayMs) {
      if (!clock.ready) return NaN;
      const m = m0 + (displayMs - c0) * clock.rate, cap = lastM + (displayMs - lastAt) * clock.rate + FRAME_MS;
      if (!(m > cap)) return m;
      if (!warned) {
        warned = true;
        warn('the map ran ahead of the last frame', { at: displayMs, m, lastM, lastAt, m0, c0, rate: clock.rate, corrSinceAnchor: c0 - cAnchor, ring: ring.length });
      }
      return cap;
    },
  };
  return clock;
}

/** Without an rVFC frame for FALLBACK_AFTER_MS, rAF reports currentTime. */
export function frameSource(video, onFrame, now = () => performance.now()) {
  let stopped = false, lastFrame = now(), vfcId = 0, rafId = 0, warned = false, prev = null;
  const vfc = typeof video.requestVideoFrameCallback === 'function';
  const onVfc = (t, md) => {
    if (stopped) return;
    const pn = now(), edt = md.expectedDisplayTime, raw = md.mediaTime * 1000, ct = video.currentTime * 1000;
    lastFrame = pn;
    const wall = Math.abs(t - pn) <= FRAME_MS ? t : pn;
    const disp = Math.abs(edt - wall) < EDT_MS ? edt : wall;
    const m = Math.abs(raw - ct) <= MEDIA_MS && raw >= 0 && !(raw > video.duration * 1000) ? raw : ct;
    if (!warned && (wall !== t || disp !== edt || m !== raw)) {
      warned = true;
      warn('a frame callback reported off-origin or off-unit times', { now: t, perfNow: pn, expectedDisplayTime: edt,
        presentationTime: md.presentationTime, mediaTime: md.mediaTime, currentTime: video.currentTime, duration: video.duration,
        playbackRate: video.playbackRate, readyState: video.readyState, dNow: prev && t - prev.t, dEdt: prev && edt - prev.edt,
        dMedia: prev && raw - prev.raw, userAgent: globalThis.navigator && navigator.userAgent });
    }
    prev = { t, edt, raw };
    onFrame(m, disp);
    vfcId = video.requestVideoFrameCallback(onVfc);
  };
  const onRaf = () => {
    rafId = 0;
    if (stopped || video.paused) return;
    const t = now();
    if (t - lastFrame >= FALLBACK_AFTER_MS) onFrame(video.currentTime * 1000, t);
    rafId = requestAnimationFrame(onRaf);
  };
  const start = () => { if (!stopped && !rafId) rafId = requestAnimationFrame(onRaf); };
  video.addEventListener('play', start);
  if (vfc) vfcId = video.requestVideoFrameCallback(onVfc);
  start();
  return () => {
    stopped = true;
    video.removeEventListener('play', start);
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
