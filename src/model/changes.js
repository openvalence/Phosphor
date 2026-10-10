// changes.js -- plain change sequences a per-frame reader compares instead of reading $state (ph-uve3).
// Plugins read them through api.changed (docs/PLUGINS.md).
//
// Constraints:
// - Never $state: a read is a Map lookup, no proxy, no allocation.
// - seq(ch) moves whenever a STATE for ch lands (bump, machine.svelte.js) and whenever anything a gate, a
//   write status, a shadow value, a freshness reason or a write refusal reads beyond the channel's own samples
//   changes (bumpAll, plugins.svelte.js); it never moves backward.

const per = new Map();
let all = 0;

export const bump = (ch) => { per.set(ch, (per.get(ch) || 0) + 1); };
export const bumpAll = () => { all++; };
/** The sequence of one channel, or of several summed (every one of them moves it). */
export const seq = (chs) => {
  if (!Array.isArray(chs)) return (per.get(chs) || 0) + all;
  let s = all;
  for (const c of chs) s += per.get(c) || 0;
  return s;
};
