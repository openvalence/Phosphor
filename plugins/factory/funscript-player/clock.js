// clock.js -- media clock: rVFC display times to performance.now(); pure except frameSource
// Contract: CONTRACT.md, module scheduler (ph-smvd.4); design: docs/plugins/FUNSCRIPT.md, Sync.
//
// Constraints:
// - One affine map per anchor, displayAt(m) = c0 + (m - m0) / rate. Corrections move c0 only,
//   so every span stamped from the map tiles with its neighbors.
// - A correction is subtracted from every residual in the ring, so the ring always holds
//   residuals against the current map and one offset is never corrected twice.
// - The step test reads the median of the LAST 8 residuals (the contract's "within 8
//   observations"); the 32-wide median would need 17 frames to see a jump.
// - observe() before the first anchor does nothing: only the caller anchors.
// - frameSource's rAF fallback reports only while the video is not paused: a paused
//   currentTime against a running now() would read as a step on every frame.

export const CLOCK_WINDOW = 32, SLEW_MS_PER_S = 5, STEP_MS = 40, FALLBACK_AFTER_MS = 250;
const STEP_WINDOW = 8;

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function createMediaClock() {
  let m0 = 0, c0 = 0, ring = [], lastAt = 0, filled = false;
  const clock = {
    ready: false,
    rate: 1,
    anchor(mediaMs, displayMs, rate = clock.rate) {
      m0 = mediaMs; c0 = displayMs; clock.rate = rate > 0 ? rate : 1;
      ring = []; filled = false; lastAt = displayMs; clock.ready = true;
    },
    reset() { clock.ready = false; ring = []; filled = false; },
    observe(mediaMs, displayMs) {
      if (!clock.ready || !Number.isFinite(mediaMs) || !Number.isFinite(displayMs)) return '';
      ring.push(displayMs - clock.displayAt(mediaMs));
      if (ring.length > CLOCK_WINDOW) ring.shift();
      if (ring.length === CLOCK_WINDOW) filled = true;
      const dt = Math.max(0, displayMs - lastAt) / 1000;
      lastAt = displayMs;
      if (ring.length >= STEP_WINDOW && Math.abs(median(ring.slice(-STEP_WINDOW))) > STEP_MS) {
        clock.anchor(mediaMs, displayMs, clock.rate);
        return 'step';
      }
      const r = median(ring);
      const lim = SLEW_MS_PER_S * dt;
      const corr = filled ? Math.max(-lim, Math.min(lim, r)) : r;
      c0 += corr;
      for (let i = 0; i < ring.length; i++) ring[i] -= corr;
      return '';
    },
    displayAt(mediaMs) { return clock.ready ? c0 + (mediaMs - m0) / clock.rate : NaN; },
    mediaAt(displayMs) { return clock.ready ? m0 + (displayMs - c0) * clock.rate : NaN; },
  };
  return clock;
}

export function frameSource(video, onFrame, now = () => performance.now()) {
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
    if (t - lastFrame >= FALLBACK_AFTER_MS && !video.paused) onFrame(video.currentTime * 1000, t);
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
