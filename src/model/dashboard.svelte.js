/**
 * dashboard.svelte.js -- reactive half of the builder grid: the named layouts
 * store, the live cell metrics, and the scale control. The math and the
 * storage rules are in grid.js (device-free, tested by
 * test/grid-model.test.mjs); this file only adds runes and the DOM.
 *
 * Constraints:
 * - Knows nothing of channels or fields: items are caller-supplied stable ids
 *   (test/check-device-knowledge.mjs).
 * - Scale is applied as the `--s` token on <html> and the cell edge, never as
 *   CSS `zoom`: RailWidget maps clientX through getBoundingClientRect, and
 *   zoom on a subtree holding it is unproven (ph-gf8).
 * - One placement map per (renderer class, view) inside each named layout, so
 *   a desktop arrangement is never applied to the phone projection.
 */

import * as G from './grid.js';

const hasWindow = typeof window !== 'undefined';
const storage = hasWindow ? (() => { try { return window.localStorage; } catch (e) { return null; } })() : null;
const mem = { length: 0, key: () => null, getItem: () => null, setItem() {} };
const ls = storage || mem;

/** The named layouts store: { active, layouts, modules } (grid.js). */
export const layouts = $state(G.loadStore(ls));
const persist = () => G.saveStore(ls, $state.snapshot(layouts));
const saved = (r) => (r && persist(), r);

export const layoutNames = () => Object.keys(layouts.layouts);
export const switchLayout = (n) => saved(G.switchLayout(layouts, n));
export const saveLayoutAs = (n) => saved(G.saveLayoutAs(layouts, n));
export const renameLayout = (a, b) => saved(G.renameLayout(layouts, a, b));
export const deleteLayout = (n) => saved(G.deleteLayout(layouts, n));

/** Saved nests (modules), shared by every layout and view. */
export const moduleNames = () => Object.keys(layouts.modules || {});
export const deleteModule = (n) => saved(G.deleteModule(layouts, n));

// Reads never write: arrange and nests run inside $derived, where a state write throws.
function controller(read, write, members) {
  return {
    arrange: (items, cols, pin = null) => G.pack(items, read(), cols, pin),
    move(items, cols, pin) { G.commitPin(write(), items, cols, pin); persist(); },
    order(items, cols, ids) { G.commitOrder(write(), items, cols, ids); persist(); },
    setLook(id, look, at) { G.setLook(write(), id, look, at); persist(); },
    // An emptied map, not a deleted key: the migration can never resurrect it.
    reset() { G.resetMap(write(), members); persist(); },
  };
}

/**
 * Placement controller for one view under one renderer class, always reading
 * the ACTIVE layout, so a switch re-places every mounted grid.
 *   arrange(items, cols, pin?) -> [{...item, x, y, w, h}] in reading order
 *   move(items, cols, pin)     -> commit a drag/resize/keyboard step
 *   order(items, cols, ids)    -> commit a reading order
 *   setLook(id, look, at?)     -> a placement's presentation and config (grid.js setLook)
 *   reset()                    -> forget this view's placements (nests stay)
 * Nests (DESIGN §10.6):
 *   nests()                    -> [{id, title, scroll, keys}] in this view
 *   nest(id)                   -> the same controller over nest `id`'s subgrid
 *   addNest({title, scroll, w, h}?) -> new nest id
 *   nestAdd(id, key) / nestRemove(id, key) / setNest(id, {title, scroll}) / removeNest(id)
 *   saveModule(id, name)       -> save nest `id` as a module; a taken name is refused
 *   insertModule(name)         -> place a module as a new nest; returns its id or null
 */
export function dashboardLayout(viewId, cls = 'full') {
  const read = () => G.viewMap(layouts, cls, viewId, false);
  const map = () => G.viewMap(layouts, cls, viewId);
  const sub = (id) => () => (G.isNest(read()[id]) ? read()[id].nest.map : {});
  const edit = (fn) => (...a) => saved(fn(map(), ...a));
  return {
    ...controller(read, map, false),
    nests: () => G.nestsIn(read()),
    nest: (id) => controller(sub(id), sub(id), true),
    addNest: edit(G.addNest),
    nestAdd: edit(G.nestAdd),
    nestRemove: edit(G.nestRemove),
    setNest: edit(G.setNest),
    removeNest: edit(G.removeNest),
    saveModule: (id, name) => saved(G.saveModule(layouts, read(), id, name)),
    insertModule: (name) => saved(G.insertModule(layouts, map(), name)),
  };
}

// ---- cell metrics and scale ---------------------------------------------------

let wanted = G.loadScale(ls);

/** Live metrics: `cell` is the CSS px edge, `scale` the applied step, `steps` the allowed ones. */
export const grid = $state({ cell: G.CELL_DEVICE_PX, scale: 1, steps: [1] });

let baseS = NaN;
function refresh() {
  const root = document.documentElement;
  if (!Number.isFinite(baseS)) {
    root.style.removeProperty('--s');
    baseS = parseFloat(getComputedStyle(root).getPropertyValue('--s'));
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const steps = G.allowedSteps({ coarse, viewportPx: window.innerWidth });
  const s = G.clampScale(wanted, steps);
  if (s === 1 || !Number.isFinite(baseS)) root.style.removeProperty('--s');
  else root.style.setProperty('--s', String(baseS * s));
  grid.steps = steps;
  grid.scale = s;
  grid.cell = G.cellCssPx(G.CELL_DEVICE_PX, window.devicePixelRatio || 1, s);
}

/** Step the scale up (1) or down (-1), or reset it (0). Persisted as the wish; the clamp re-applies per window. */
export function stepScale(dir) {
  wanted = dir === 0 ? 1 : G.stepScale(grid.scale, dir, grid.steps);
  G.saveScale(ls, wanted);
  refresh();
}

if (hasWindow) {
  // After the module graph, so style.css (imported after App in main.js) is live.
  queueMicrotask(refresh);
  window.addEventListener('resize', refresh);
  window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', refresh);
  // A DPR change (monitor move, browser zoom) does not always fire resize.
  const watchDpr = () => window.matchMedia?.('(resolution: ' + window.devicePixelRatio + 'dppx)')
    .addEventListener?.('change', () => { refresh(); watchDpr(); }, { once: true });
  watchDpr();
}
