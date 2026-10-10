/**
 * linkbar.js -- the top bar's readings as plain functions (src/ui/LinkBar.svelte): the hub session's
 * data rate, number formats, and the link dot's state. No DOM, no Svelte; test/linkbar.test.mjs.
 *
 * Constraints:
 * - The rate counts only the bytes activity.js saw on the hub session's socket (`totals`), never Stash
 *   or any other traffic.
 * - A sample is a point in time, not a tick count: the average is bytes over the real time between
 *   the oldest kept point and the newest, so a late timer tick never inflates the rate.
 * - The meter owns no timer. LinkBar runs one 250 ms interval, only while the link is live.
 */

export const SAMPLE_MS = 250;
const WINDOW = 4;   // intervals averaged: 4 x 250 ms = 1 s
const LERP = 0.5;   // the shown number's step toward the average, per sample

/** A fresh meter per live session. sample(t, rxBytes, txBytes) -> {rx, tx, avg: {rx, tx}} in bytes/s. */
export function rateMeter() {
  const pts = [];
  const shown = { rx: 0, tx: 0 };
  return {
    sample(t, rx, tx) {
      pts.push({ t, rx, tx });
      if (pts.length > WINDOW + 1) pts.shift();
      const a = pts[0], dt = (t - a.t) / 1000;
      const avg = dt > 0 ? { rx: (rx - a.rx) / dt, tx: (tx - a.tx) / dt } : { rx: 0, tx: 0 };
      if (dt > 0) {
        shown.rx += (avg.rx - shown.rx) * LERP;
        shown.tx += (avg.tx - shown.tx) * LERP;
      }
      return { rx: shown.rx, tx: shown.tx, avg };
    },
  };
}

/** One decimal under 10, whole above; '--' for no reading. Never a number the source did not give. */
export function fmtNum(v) {
  if (v == null || !isFinite(v)) return '--';
  const r = Math.round(v * 10) / 10;
  return r < 10 ? r.toFixed(1) : String(Math.round(v));
}

/** Bytes/s as the KB/s number (1 KB = 1000 B), three characters at most; '--' with no reading. */
export function fmtRate(bytesPerSec) {
  if (bytesPerSec == null) return '--';
  const kb = bytesPerSec / 1000;
  return kb >= 999.5 ? '999+' : fmtNum(kb);
}

/** Link phase -> the dot's state: live, connecting, stale (live but silent), offline. */
export function dotState(phase, stale) {
  if (phase === 'live') return stale ? 'stale' : 'live';
  return phase === 'connecting' || phase === 'handshaking' || phase === 'retrying' ? 'connecting' : 'offline';
}
