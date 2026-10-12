/**
 * trace.js -- rolling value history for scopes and buttplug outputs. Pure:
 * test/bp-linear.test.mjs runs it with a fake clock. Drawing is
 * src/ui/graph/Trace.svelte.
 *
 * Constraints:
 * - A point is [t, v], t in ms on the caller's clock; only a value that
 *   arrives is stored, so an idle trace costs nothing and draws nothing.
 * - A per-output trace records nothing until it is switched on (off by default).
 */

export const SPAN_MS = 10000;
const CAP = 512;

/** Append [t, v], dropping points older than `span` before t (and the oldest past the cap). */
export function pushPoint(buf, t, v, span = SPAN_MS) {
  buf.push([t, v]);
  let i = 0;
  while (i < buf.length - 1 && buf[i][0] < t - span) i++;
  if (buf.length - i > CAP) i = buf.length - CAP;
  if (i) buf.splice(0, i);
  return buf;
}

const KEY = 'phosphor.bp.trace';

/**
 * Per-output traces keyed by refKey: which are on (stored, a per-viewer
 * convenience), their points, and a version that moves on every new point.
 */
export function createTraces({ now = () => performance.now(), storage = null } = {}) {
  const on = new Set();
  const bufs = new Map();
  const ver = new Map();
  const subs = new Set();
  try { for (const k of JSON.parse(storage?.getItem(KEY)) || []) on.add(k); } catch (e) { /* none saved */ }
  const save = () => { try { storage?.setItem(KEY, JSON.stringify([...on])); } catch (e) { /* private mode */ } };
  return {
    on: (k) => on.has(k),
    set(k, v) {
      if (v) on.add(k); else { on.delete(k); bufs.delete(k); }
      save();
      ver.set(k, (ver.get(k) || 0) + 1);
      for (const f of subs) f(k);
    },
    /** Record a value that was sent, if this output's trace is on. */
    push(k, v) {
      if (!on.has(k)) return;
      pushPoint(bufs.get(k) || bufs.set(k, []).get(k), now(), v);
      ver.set(k, (ver.get(k) || 0) + 1);
      for (const f of subs) f(k);
    },
    points: (k) => bufs.get(k) || [],
    version: (k) => ver.get(k) || 0,
    now,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
