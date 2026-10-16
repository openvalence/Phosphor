/**
 * ring.js -- the 1 ms samples off the dev tool channel: time (us), position (mm), velocity (mm/s), oldest first.
 * Plain typed arrays, read by the canvases' rAF loops; never reactive state.
 */
export function createRing(cap) {
  return { t: new Float64Array(cap), p: new Float32Array(cap), v: new Float32Array(cap), head: 0, n: 0, cap };
}

export function push(r, t, p, v) {
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

/** A CSS custom property of the applied Theme. */
export const token = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
