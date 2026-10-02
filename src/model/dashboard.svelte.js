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

// One level of undo over the whole store. Every edit in one synchronous burst
// (Home's remove is a delete plus a commit) is one step: the snapshot is taken
// at the burst's first edit and kept only if the burst changed the store, so a
// click on a grip that moves nothing never costs the real last change.
let burst = null;
let last = null;
/** `can` is true while there is a change to undo. */
export const undo = $state({ can: false });
/** Call before writing the store directly; the edit helpers below call it themselves. */
export function checkpoint() {
  if (burst) return;
  burst = JSON.stringify($state.snapshot(layouts));
  queueMicrotask(() => { burst = null; });
}
const saved = (r) => {
  if (!r) return r;
  if (burst && JSON.stringify($state.snapshot(layouts)) !== burst) { last = burst; undo.can = true; }
  persist();
  return r;
};
const edit = (fn) => (...a) => { checkpoint(); return saved(fn(...a)); };
/** Restore the store as it was before the last change; one level. */
export function undoLast() {
  if (!last) return false;
  const s = JSON.parse(last);
  layouts.active = s.active;
  layouts.layouts = s.layouts;
  layouts.modules = s.modules;
  last = null;
  undo.can = false;
  persist();
  return true;
}

export const layoutNames = () => Object.keys(layouts.layouts);
export const switchLayout = (n) => saved(G.switchLayout(layouts, n));
export const saveLayoutAs = edit((n) => G.saveLayoutAs(layouts, n));
export const renameLayout = edit((a, b) => G.renameLayout(layouts, a, b));
export const deleteLayout = edit((n) => G.deleteLayout(layouts, n));
/** Layout `n` (default: the active one) as comparable JSON: the switch guard's baseline. */
export const layoutJson = (n = layouts.active) => JSON.stringify($state.snapshot(layouts.layouts[n]) ?? null);
/** Put layout `n` back to a layoutJson() text; one undo step. */
export const restoreLayout = edit((n, json) => {
  if (!Object.prototype.hasOwnProperty.call(layouts.layouts, n) || json == null) return false;
  layouts.layouts[n] = JSON.parse(json);
  return true;
});
export const exportLayout = (n) => G.exportLayout($state.snapshot(layouts), n);
/** The active layout's density (grid.js DENSITY) and its setter. */
export const density = () => G.layoutOpts(layouts).density;
export const setDensity = edit((d) => G.setDensity(layouts, d));
/** Add the layout in `text` (grid.js importLayout); returns its name, throws naming why not. */
export const importLayout = edit((text) => G.importLayout(layouts, text));

/** Saved nests (modules), shared by every layout and view. */
export const moduleNames = () => Object.keys(layouts.modules || {});
export const deleteModule = edit((n) => G.deleteModule(layouts, n));

// Reads never write: arrange and nests run inside $derived, where a state write throws.
function controller(read, write, members) {
  return {
    arrange: (items, cols, pin = null) => G.place(items, read(), cols, pin),
    move: edit((items, cols, pin) => (G.commitPin(write(), items, cols, pin), true)),
    // A repair the user did not make (DashGrid's grow to a measured floor): saved, never an undo step.
    fit: (items, cols, pin) => { G.commitPin(write(), items, cols, pin); persist(); },
    order: edit((items, cols, ids) => (G.commitOrder(write(), items, cols, ids), true)),
    setLook: edit((id, look, at) => G.setLook(write(), id, look, at)),
    // An emptied map, not a deleted key: the migration can never resurrect it.
    reset: edit(() => (G.resetMap(write(), members), true)),
  };
}

/**
 * Placement controller for one view under one renderer class, always reading
 * the ACTIVE layout, so a switch re-places every mounted grid.
 *   arrange(items, cols, pin?) -> [{...item, x, y, w, h}] in reading order; with
 *                                 `pin`, where the dragged item lands (grid.js place)
 *   move(items, cols, pin)     -> commit a drag/resize/keyboard step
 *   fit(items, cols, pin)      -> commit a repair (a grow to the content floor); no undo step
 *   order(items, cols, ids)    -> commit a reading order
 *   setLook(id, look, at?)     -> a placement's presentation and config (grid.js setLook)
 *   reset()                    -> forget this view's placements (nests stay)
 * Nests (DESIGN §10.6):
 *   nests()                    -> [{id, title, keys}] in this view
 *   nest(id)                   -> the same controller over nest `id`'s subgrid
 *   addNest({title, w, h}?)    -> new nest id, unplaced until the next move commits it
 *   nestAdd(id, key) / nestRemove(id, key) / setNest(id, {title}) / removeNest(id)
 *   nestOut(id, key)           -> member `key` to the top level, look and size kept
 *   duplicate(id, to?)         -> copy entry `id` as `to` (a nest: whole, next nest id); returns the id
 *   saveModule(id, name)       -> save nest `id` as a module; a taken name is refused
 *   insertModule(name)         -> place a module as a new nest; returns its id or null
 */
export function dashboardLayout(viewId, cls = 'full') {
  const read = () => G.viewMap(layouts, cls, viewId, false);
  const map = () => G.viewMap(layouts, cls, viewId);
  const sub = (id) => () => (G.isNest(read()[id]) ? read()[id].nest.map : {});
  const inMap = (fn) => edit((...a) => fn(map(), ...a));
  return {
    ...controller(read, map, false),
    nests: () => G.nestsIn(read()),
    nest: (id) => controller(sub(id), sub(id), true),
    addNest: inMap(G.addNest),
    nestAdd: inMap(G.nestAdd),
    nestRemove: inMap(G.nestRemove),
    nestOut: inMap(G.nestOut),
    duplicate: inMap(G.duplicate),
    setNest: inMap(G.setNest),
    removeNest: inMap(G.removeNest),
    saveModule: edit((id, name) => G.saveModule(layouts, read(), id, name)),
    insertModule: inMap((m, name) => G.insertModule(layouts, m, name)),
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
