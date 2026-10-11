// changes.js -- plain change sequences a per-frame reader compares instead of reading $state (ph-uve3).
// Plugins read them through api.changed and are told through api.onChanged (docs/PLUGINS.md).
//
// Constraints:
// - Never $state: a read is a Map lookup, no proxy, no allocation.
// - seq(ch) moves whenever a STATE for ch lands (bump, machine.svelte.js) and whenever anything a gate, a
//   write status, a shadow value, a freshness reason or a write refusal reads beyond the channel's own samples
//   changes (bumpAll, plugins.svelte.js); it never moves backward.
// - A watcher is told on a microtask after a move it accepts, then at most once a frame while moves keep
//   coming (the next call waits for the frame after the last one); idle, nothing runs per frame.

const per = new Map();
let all = 0;

const subs = new Set();
let queued = false, held = false;
const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

function mark(ch) {
  for (const w of subs) if (!w.pending && (ch === undefined || w.test(ch))) { w.pending = true; queue(); }
}
function queue() {
  if (queued) return;
  queued = true;
  if (!held) queueMicrotask(flush);   // else release() flushes on the next frame
}
function flush() {
  queued = false;
  held = true;
  nextFrame(release);
  for (const w of subs) {
    if (!w.pending) continue;
    w.pending = false;
    try { w.fn(); } catch (e) { console.error(e); }
  }
}
function release() { held = false; if (queued) flush(); }

export const bump = (ch) => { per.set(ch, (per.get(ch) || 0) + 1); if (subs.size) mark(ch); };
export const bumpAll = () => { all++; if (subs.size) mark(undefined); };
/** fn() after a move of a channel test(ch) accepts, or of every channel (bumpAll). Returns the unwatch. */
export function watch(test, fn) {
  const w = { test, fn, pending: false };
  subs.add(w);
  return () => { subs.delete(w); };
}
/** The sequence of one channel, or of several summed (every one of them moves it). */
export const seq = (chs) => {
  if (!Array.isArray(chs)) return (per.get(chs) || 0) + all;
  let s = all;
  for (const c of chs) s += per.get(c) || 0;
  return s;
};
