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
 * - The store is never written while a card is red (DESIGN §10.6, grid.js
 *   faults): edits stay in memory until the red clears, and ending edit mode
 *   red goes back to the last write. A saved layout is valid by construction.
 */

import * as G from './grid.js';
import { onTheme } from './theme.js';

const hasWindow = typeof window !== 'undefined';
const storage = hasWindow ? (() => { try { return window.localStorage; } catch (e) { return null; } })() : null;
const mem = { length: 0, key: () => null, getItem: () => null, setItem() {} };
const ls = storage || mem;

/** The named layouts store: { active, layouts, modules } (grid.js). */
export const layouts = $state(G.loadStore(ls));

// Edit-mode grids (DashGrid editGrid): their red counts gate every write, and a
// write waits for their next measure, so a floor measured after a commit counts.
const grids = $state({});
let gridSeq = 0;
let unsaved = false;
let refused = false;
let kept = $state.snapshot(layouts);
/** Red cards across the mounted edit-mode grids; Done and every store write wait while any. */
export const redCount = () => Object.values(grids).reduce((n, g) => n + (g ? g.red() : 0), 0);
/** The blocked-save hint naming the count, or '' when the layout can be saved. */
export const redHint = () => { const n = redCount(); return n ? n + (n === 1 ? ' card' : ' cards') + ' red, not saved' : ''; };
function persist() {
  unsaved = true;
  const live = Object.values(grids).filter(Boolean);
  if (live.length) for (const g of live) g.later();
  else flush();
}
/** Write the store unless a card is red; an edit-mode grid calls it after each measure. */
export function flush() {
  if (!unsaved) return;
  refused = redCount() > 0;
  if (refused) return;
  unsaved = false;
  kept = $state.snapshot(layouts);
  G.saveStore(ls, kept);
}
/**
 * Register an edit-mode grid: `red()` its red card count, `later()` its next
 * measure pass. The returned call unregisters; `leave` true when editing ends
 * there, which drops red edits back to the last write (the active layout kept).
 */
export function editGrid(red, later) {
  const k = ++gridSeq;
  grids[k] = { red, later };
  return (leave = false) => {
    delete grids[k];
    if (leave && unsaved && refused) {
      const s = JSON.parse(JSON.stringify(kept));
      layouts.layouts = s.layouts;
      layouts.modules = s.modules;
      layouts.order = s.order;
      if (!Object.prototype.hasOwnProperty.call(s.layouts, layouts.active)) layouts.active = s.active;
    }
    flush();
  };
}

// One level of undo over the whole store. Every edit in one synchronous burst
// (Home's remove is a delete plus a commit) is one step: the snapshot is taken
// at the burst's first edit and kept only if the burst changed the store, so a
// click on a grip that moves nothing never costs the real last change.
let burst = null;
let last = null;
let edits = 0;
/** `can` is true while there is a change to undo. */
export const undo = $state({ can: false });
/** Count of the user's edits this page load; a repair (a controller's `fit`) is none. */
export const edited = () => edits;
/** Call before writing the store directly; the edit helpers below call it themselves. */
export function checkpoint() {
  if (burst) return;
  burst = JSON.stringify($state.snapshot(layouts));
  queueMicrotask(() => { burst = null; });
}
const saved = (r) => {
  if (!r) return r;
  if (burst && JSON.stringify($state.snapshot(layouts)) !== burst) { last = burst; undo.can = true; edits++; }
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
  layouts.order = s.order;
  last = null;
  undo.can = false;
  persist();
  return true;
}

export const layoutNames = () => Object.keys(layouts.layouts);
/** Layout names in sidebar order, Default first and pinned (grid.js layoutOrder). */
export const orderedLayoutNames = () => G.layoutOrder(layouts);
/** True while the Dash page is in edit mode; the sidebar wrench flips it. */
export const dashEdit = $state({ on: false });
/** A new empty layout (rank seed) made active; false for a taken or invalid name. */
export const addLayout = edit((n) => G.addLayout(layouts, n));
/** Default refuses; `index` counts Default as 0. */
export const moveLayout = edit((n, i) => G.moveLayout(layouts, n, i));
export const switchLayout = (n) => saved(G.switchLayout(layouts, n));
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

/**
 * The module palette (Palette.svelte, a host's edit chrome over the grid):
 * `shown` while one is mounted, `open` the toolbar's Modules toggle, so a
 * card under the palette is one click from reach; `h` its drawn height, which
 * the grid reserves below its own top so the page ends past the palette.
 */
export const palette = $state({ shown: false, open: true, h: 0 });

/** Saved nests (modules), shared by every layout and view. */
export const moduleNames = () => Object.keys(layouts.modules || {});
export const deleteModule = edit((n) => G.deleteModule(layouts, n));

// Per view key: the content height a mounted grid measured (grid.js pack `fit`).
// Per layout and view key: the ids a commit left unplaced until its grid has measured them.
const fits = new Map();
const held = new Map();
const heldAt = (key) => layouts.active + '\n' + key;
// An add (appendTo) is a plain entry with no rect, read from the map, so it waits through a
// reload or a rename until its own layout is drawn. A nest is never read as one: Reset leaves
// nests unplaced on purpose, to grow with their members until the next commit.
const pending = (map) => Object.keys(map).filter((k) => map[k] && typeof map[k] === 'object' && !G.isNest(map[k]) && !G.positioned(map[k]));

// Reads never write: arrange and nests run inside $derived, where a state write throws.
function controller(key, read, write, members) {
  const fit = () => fits.get(key) || null;
  const hold = (ids) => { if (ids.length) held.set(heldAt(key), new Set([...(held.get(heldAt(key)) || []), ...ids])); };
  return {
    // `f` defaults to the registered one; a $derived passes its own, since the registry is not reactive.
    arrange: (items, cols, pin = null, f = fit()) => G.place(items, read(), cols, pin, f),
    move: edit((items, cols, pin) => (hold(G.commitPin(write(), items, cols, pin, fit())), true)),
    // A repair the user did not make (an add written once measured): saved, never an undo step.
    fit: (items, cols) => {
      held.delete(heldAt(key));
      hold(G.commitPin(write(), items, cols, null, fit()));
      persist();
    },
    order: edit((items, cols, ids) => (G.commitOrder(write(), items, cols, ids), true)),
    setLook: edit((id, look, at) => G.setLook(write(), id, look, at)),
    // An emptied map, not a deleted key: the migration can never resurrect it.
    reset: edit(() => (G.resetMap(write(), members), true)),
    /** The mounted grid's content height `fn(item, w, h) -> cells | null`; null unregisters. */
    measured: (fn) => { if (fn) fits.set(key, fn); else fits.delete(key); },
    /** Ids an add left unplaced until measured; the grid fixes them with fit(). */
    held: () => new Set([...(held.get(heldAt(key)) || []), ...pending(read())]),
    /** True when `id` has a stored rect; an unplaced card follows its content. */
    saved: (id) => G.positioned(read()[id]),
  };
}

/**
 * Add `ids` to view `viewId` of layout `n`, active or not, unplaced: each is
 * drawn at the first free rect (grid.js place) and written there once a grid
 * has measured it. Ids the view already holds are left as they are.
 */
export const appendTo = edit((n, cls, viewId, ids) => {
  if (!layoutNames().includes(n)) return false;
  const m = G.viewMap(layouts, cls, viewId, true, n);
  for (const id of ids) if (m[id] === undefined) m[id] = {};
  return true;
});

/**
 * Placement controller for one view under one renderer class, always reading
 * the ACTIVE layout, so a switch re-places every mounted grid.
 *   arrange(items, cols, pin?) -> [{...item, x, y, w, h}] in reading order; with
 *                                 `pin`, where the dragged item lands (grid.js place)
 *   move(items, cols, pin)     -> commit a drag/resize/keyboard step
 *   fit(items, cols)           -> write the adds held until measured; no undo step
 *   order(items, cols, ids)    -> commit a reading order
 *   measured(fn) / held()      -> the grid's content heights; adds waiting for them
 *   saved(id)                  -> whether `id` has a stored rect
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
  const key = cls + '.' + viewId;
  const read = () => G.viewMap(layouts, cls, viewId, false);
  const map = () => G.viewMap(layouts, cls, viewId);
  const sub = (id) => () => (G.isNest(read()[id]) ? read()[id].nest.map : {});
  const inMap = (fn) => edit((...a) => fn(map(), ...a));
  return {
    ...controller(key, read, map, false),
    nests: () => G.nestsIn(read()),
    nest: (id) => controller(key + ' ' + id, sub(id), sub(id), true),
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
  // A write waiting for its grid's next measure still lands when the page goes away (red still holds it).
  window.addEventListener('pagehide', flush);
  // After the module graph, so style.css (imported after App in main.js) is live.
  queueMicrotask(refresh);
  // The theme's scale is the base --s this module multiplies.
  onTheme(() => { baseS = NaN; refresh(); });
  window.addEventListener('resize', refresh);
  window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', refresh);
  // A DPR change (monitor move, browser zoom) does not always fire resize.
  const watchDpr = () => window.matchMedia?.('(resolution: ' + window.devicePixelRatio + 'dppx)')
    .addEventListener?.('change', () => { refresh(); watchDpr(); }, { once: true });
  watchDpr();
}
