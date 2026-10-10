// axes.js -- a script's oscillator axes from sibling files (<base>.v8.funscript, <base>.v9.funscript)
// Contract: CONTRACT.md, module axes (ph-6dr6); design: docs/plugins/FUNSCRIPT.md, Multi-axis.
//
// Constraints:
// - A sibling pairs with the main script by base name, case-insensitive (funscript.js axisOf), never by order.
// - A sibling file overrides the same axis embedded in the main script. One that fails to read or parse is
//   a note on the script, never a failed load.
// - Only OSC_AXES are read: every other sibling stays in `rest`, the extra-axes note's list.

import { axisOf, OSC_AXES } from './funscript.js';

/** Split extra files into the main script's oscillator siblings and the rest. */
export function oscFiles(main, extra = []) {
  const ax = main && axisOf(main.name), base = ax ? ax.base.toLowerCase() : null;
  const osc = [], rest = [];
  for (const f of extra) {
    const a = axisOf(f.name);
    (base != null && a && OSC_AXES.includes(a.axis) && a.base.toLowerCase() === base ? osc : rest).push(f);
  }
  return { osc, rest };
}

/** The main Script with each sibling's actions in Script.axes; read(file) -> Promise<Script> (parseFunscript). */
export async function withAxes(main, files, read) {
  const [s, ...got] = await Promise.all([main, ...files.map((f) => Promise.resolve().then(() => read(f)).then((x) => x, (e) => e))]);
  const axes = { ...(s.axes || {}) }, notes = [...s.notes];
  files.forEach((f, i) => {
    const id = axisOf(f.name).axis, x = got[i];
    if (x instanceof Error || !x) notes.push(id + ' file dropped: ' + ((x && x.message) || 'unreadable'));
    else axes[id] = { at: x.at, pos: x.pos };
  });
  return { ...s, axes, notes };
}
