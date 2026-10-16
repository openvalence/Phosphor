/**
 * ring.js -- the 1 ms samples off the dev tool channel: time (us), position (mm), velocity (mm/s), oldest first,
 * and the playhead that plays them back on the display's own frames.
 * Plain typed arrays, read by the canvases' rAF loop; never reactive state.
 */
import { createRenderClock } from '../src/ui/hero/telebuf.js';

export function createRing(cap) {
  return { t: new Float64Array(cap), p: new Float32Array(cap), v: new Float32Array(cap), head: 0, n: 0, cap, moved: -Infinity };
}

export function push(r, t, p, v) {
  if (r.n) {
    const k = idx(r, r.n - 1);
    if (t < r.t[k]) r.n = 0;   // the twin restarted its clock (a reboot): a new run
    else if (Math.fround(p) !== r.p[k] || Math.fround(v) !== r.v[k]) r.moved = t;   // as stored: float32
  }
  r.t[r.head] = t; r.p[r.head] = p; r.v[r.head] = v;
  r.head = (r.head + 1) % r.cap;
  if (r.n < r.cap) r.n++;
}

/** Storage index of the i-th sample, 0 the oldest kept. */
export const idx = (r, i) => (r.head - r.n + i + r.cap) % r.cap;

/** The i of the newest sample at or before `t`, or -1. */
export function before(r, t) {
  let lo = 0, hi = r.n - 1;
  if (hi < 0 || r.t[idx(r, 0)] > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.t[idx(r, mid)] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Position and velocity at `t` (us) into `out`: linear between the two samples around it, held past either end.
 * Linear is exact enough at 1 ms spacing (a 50 m/s^2 reversal bends the chord by 6 um), so no cubic here.
 */
export function sampleAt(r, t, out) {
  const i = before(r, t);
  const a = idx(r, Math.max(0, i));
  if (i < 0 || i === r.n - 1) { out.p = r.p[a]; out.v = r.v[a]; return out; }
  const b = idx(r, i + 1), u = (t - r.t[a]) / (r.t[b] - r.t[a]);
  out.p = r.p[a] + (r.p[b] - r.p[a]) * u;
  out.v = r.v[a] + (r.v[b] - r.v[a]) * u;
  return out;
}

const LEAK_MS = 0.02;    // per arrival: the offset follows a sample clock that runs slow by up to 0.6 ms/s
const RESYNC_MS = 500;   // an arrival this far behind the quickest one is a stall: resync, never stretch

/**
 * The playhead: every frame draws the samples at one render instant, the display's time minus a jitter buffer
 * sized by Phosphor's render clock (telebuf.js createRenderClock: the p95 of how far each arrival ran past the
 * newest sample already held, plus 3 ms). Sample time maps to performance.now() by the quickest arrival seen.
 * One rAF loop serves every drawer and stops when none asks for another frame; an arrival restarts it.
 */
export function createPlayhead(r) {
  const clock = createRenderClock({ maxDelayMs: 150 });
  const drawers = new Set();
  let base = NaN, raf = 0, last = 0, frameMs = 1000 / 60;

  function tick(ms) {
    raf = 0;
    const dt = last ? ms - last : 0;
    last = ms;
    if (dt > 0 && dt < 100) frameMs += 0.1 * (dt - frameMs);
    clock.update(dt);
    const t = Number.isNaN(base) ? NaN : clock.stableRenderTime(ms - base) * 1000;
    let more = false;
    for (const d of drawers) more = d(t, frameMs) || more;
    if (more) wake(); else last = 0;
  }
  function wake() { if (!raf) raf = requestAnimationFrame(tick); }

  return {
    /** After a snapshot's samples were pushed; `prevUs` the newest sample before them (NaN for none). */
    arrive(prevUs) {
      if (r.n) {
        const now = performance.now(), x = now - r.t[idx(r, r.n - 1)] / 1000;
        if (Number.isNaN(base) || x - base > RESYNC_MS || !(prevUs <= r.t[idx(r, r.n - 1)])) { base = x; clock.reset(); }
        else {
          base = Math.min(x, base + LEAK_MS);
          clock.noteLate(now - (prevUs / 1000 + base));
        }
      }
      wake();
    },
    /** `d(tUs, frameMs)` draws the frame at render instant tUs (NaN before any sample); true asks for the next. */
    onFrame(d) { drawers.add(d); wake(); return () => drawers.delete(d); },
    wake,
    get delayMs() { return clock.getDelayMs(); },
  };
}

/** A CSS custom property of the applied Theme. */
export const token = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
