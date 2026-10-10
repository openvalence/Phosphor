/**
 * activity.js -- per-channel traffic rates for the channel heatmap (src/ui/ChannelHeat.svelte, DESIGN §10.3).
 * Fed at the socket (machine.svelte.js stampingSocket), where every frame passes in both directions.
 *
 * Constraints:
 * - Plain data, never $state: counting a socket message is a header walk and a Map lookup per frame.
 * - Idle, nothing runs: the TICK_MS timer runs only while a watcher exists and something arrived in the
 *   last IDLE_MS, and stops after the tick that finds everything quiet.
 * - A rate is the smoothed frames per arrival over the smoothed interval between arrivals, held until the
 *   next arrival is late, then falling as 1 / the silence. A steady channel reads one level through its
 *   arrivals, and frames sharing one socket message or one millisecond are one arrival, so a bundle of
 *   channels never lights them in step (operator 2026-10-10: "lerp pls, no need for flashing").
 * - A channel counts its data-plane frames (STATE, STREAM, INTENT, ECHO, EVENT) by header channel; a NACK
 *   is a refusal, never traffic. LINK counts every frame, control included.
 */
import { FRAME } from '../../../Valence/clients/js/index.js';

/** The pseudo-channel every frame counts toward. */
export const LINK = -1;
export const TICK_MS = 500;
const IDLE_MS = 10000;   // silence past this ends a run: the rate reads 0 and the next arrival starts afresh
const LONE_MS = 1000;    // the interval a lone arrival is held for, until a second one measures it
const PEAK_MS = 30000;   // the time constant a channel's recent peak decays with
const A = 0.3;           // smoothing weight of each new arrival
const DATA = new Set([FRAME.STATE, FRAME.STREAM, FRAME.INTENT, FRAME.ECHO, FRAME.EVENT]);

const chans = new Map(); // id -> {rx, tx}
const blank = () => ({ last: 0, n: 0, ivl: LONE_MS, k: 0, b: 0, ck: 0, cb: 0, peak: 0, peakAt: 0 });
function dirOf(id, dir) {
  let c = chans.get(id);
  if (!c) chans.set(id, (c = { rx: blank(), tx: blank() }));
  return c[dir];
}
const peakAt = (d, t) => d.peak * Math.exp(-(t - d.peakAt) / PEAK_MS);

// d.ck/d.cb: the arrival in progress; it folds into the averages when the next one starts.
function hit(d, t, k, bytes) {
  const dt = t - d.last;
  if (d.last && dt < 1) { d.ck += k; d.cb += bytes; return; }
  if (d.last && dt <= IDLE_MS) {
    if (d.n) { d.k += A * (d.ck - d.k); d.b += A * (d.cb - d.b); d.ivl += A * (dt - d.ivl); }
    else { d.k = d.ck; d.b = d.cb; d.ivl = dt; }
    d.n++;
    d.peak = Math.max(peakAt(d, t), 1000 * d.k / d.ivl);
    d.peakAt = t;
  } else d.n = 0;
  d.last = t;
  d.ck = k;
  d.cb = bytes;
}

/** {hz, bps, held}: frames and bytes a second now, and the rate held before any silence. */
function rateOf(d, t) {
  const since = t - d.last;
  if (!d.last || since > IDLE_MS) return { hz: 0, bps: 0, held: 0 };
  const k = d.n ? d.k : d.ck, b = d.n ? d.b : d.cb, ivl = d.n ? d.ivl : LONE_MS;
  const per = 1000 / Math.max(ivl, since);
  return { hz: k * per, bps: b * per, held: 1000 * k / ivl };
}

// ---- the coarse tick ------------------------------------------------------------------------
const watchers = new Set();
let timer = null, liveUntil = 0;
function tick() {
  const t = Date.now();
  for (const fn of watchers) { try { fn(t); } catch (e) { console.error(e); } }
  if (t > liveUntil) { clearInterval(timer); timer = null; }
}
const start = () => { if (!timer && watchers.size) timer = setInterval(tick, TICK_MS); };

/** fn(t) every TICK_MS while anything is active, once more when it all goes quiet. Returns the unwatch. */
export function watch(fn) {
  watchers.add(fn);
  if (Date.now() <= liveUntil) start();
  return () => {
    watchers.delete(fn);
    if (!watchers.size && timer) { clearInterval(timer); timer = null; }
  };
}

// ---- counting ---------------------------------------------------------------------------------
const batch = new Map(); // channel -> [frames, bytes] within one socket message

/** One socket message, `dir` 'rx' or 'tx': each frame by its 8-byte header (SPEC §5.1). */
export function countFrames(dir, data, t = Date.now()) {
  const u = data instanceof ArrayBuffer ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!u || u.length < 8) return;
  // The SPEC §5.5 ESTOP frame has no header.
  if (u[0] === 0xe5 && u[1] === 0xe5 && u[2] === 0xe5 && u[3] === 0xe5) return;
  batch.clear();
  let frames = 0, o = 0;
  while (o + 8 <= u.length) {
    const len = 8 + (u[o + 6] | (u[o + 7] << 8));
    if (o + len > u.length) break;
    frames++;
    if (DATA.has(u[o])) {
      const ch = u[o + 2] | (u[o + 3] << 8);
      const s = batch.get(ch);
      if (s) { s[0]++; s[1] += len; } else batch.set(ch, [1, len]);
    }
    o += len;
  }
  if (!frames) return;
  hit(dirOf(LINK, dir), t, frames, o);
  for (const [ch, s] of batch) hit(dirOf(ch, dir), t, s[0], s[1]);
  liveUntil = t + IDLE_MS;
  start();
}

// ---- reading ------------------------------------------------------------------------------------
const NONE = { hz: 0, bps: 0, held: 0 };

/** {rx: {hz, bps}, tx: {hz, bps}, last}: rates now and the newest arrival's wall ms (0 = never). */
export function read(id, t = Date.now()) {
  const c = chans.get(id);
  if (!c) return { rx: NONE, tx: NONE, last: 0 };
  return { rx: rateOf(c.rx, t), tx: rateOf(c.tx, t), last: Math.max(c.rx.last, c.tx.last) };
}

/**
 * 0..1: the busier direction's rate over its own recent peak, the peak capped at `capHz` when one is
 * known (the grant), so a channel at its own steady rate reads full whatever that rate is.
 */
export function level(id, t = Date.now(), capHz = 0) {
  const c = chans.get(id);
  if (!c) return 0;
  let best = 0;
  for (const d of [c.rx, c.tx]) {
    const r = rateOf(d, t);
    if (!r.hz) continue;
    let ceil = Math.max(d.n ? peakAt(d, t) : 0, r.held);
    if (capHz > 0) ceil = Math.min(ceil, capHz);
    best = Math.max(best, Math.min(1, r.hz / ceil));
  }
  return best;
}
