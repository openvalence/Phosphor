/**
 * The page's achievable frame rate: a burst of BURST consecutive frames every
 * EVERY ms, ~16 callbacks a second, none while the page is hidden. The one
 * source for the top bar's fps chip and Health (frame-rate condition and the
 * screen's refresh); no widget keeps its own count. It measures what this
 * window can draw whether or not anything animates, so an idle rail changes
 * nothing. Not an animation: reduced motion does not apply.
 */
const BURST = 4;
const EVERY = 250;
const KEEP_MS = 120000;

/** `fps`: smoothed, whole, updated each burst; null while hidden or before the first burst. */
export const frameRate = $state({ fps: null });
/** Complete bursts' rates, unrounded: {t: performance.now(), v}. Health reads the screen's refresh from these. */
export const rates = [];

let timer = 0, gen = 0, smooth = null, running = null;

const visible = () => document.visibilityState === 'visible';

function publish(v, t) {
  smooth = smooth == null ? v : smooth + 0.5 * (v - smooth);
  frameRate.fps = Math.round(smooth);
  while (rates.length && t - rates[0].t > KEEP_MS) rates.shift();
}

function burst() {
  // A burst that has not finished in a second is a display drawing under 4 fps (or not at all): count what it got.
  if (running) {
    const t = performance.now();
    if (t - running.t0 < 1000) return;
    gen++;
    publish(running.at.length * 1000 / (t - running.t0), t);
  }
  const g = gen, at = [];
  running = { t0: performance.now(), at };
  const step = (ts) => {
    if (g !== gen) return;
    at.push(ts);
    if (at.length < BURST) { requestAnimationFrame(step); return; }
    running = null;
    const v = (BURST - 1) * 1000 / (ts - at[0]);
    rates.push({ t: performance.now(), v });
    publish(v, performance.now());
  };
  requestAnimationFrame(step);
}

function sync() {
  gen++; running = null; smooth = null; clearInterval(timer); timer = 0;
  if (visible()) { timer = setInterval(burst, EVERY); burst(); } else frameRate.fps = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', sync);
  sync();
}
