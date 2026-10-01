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

/** The named layouts store: { active, layouts }. */
export const layouts = $state(G.loadStore(ls));
const persist = () => G.saveStore(ls, $state.snapshot(layouts));

export const layoutNames = () => Object.keys(layouts.layouts);
export const switchLayout = (n) => G.switchLayout(layouts, n) && (persist(), true);
export const saveLayoutAs = (n) => G.saveLayoutAs(layouts, n) && (persist(), true);
export const renameLayout = (a, b) => G.renameLayout(layouts, a, b) && (persist(), true);
export const deleteLayout = (n) => G.deleteLayout(layouts, n) && (persist(), true);

/**
 * Placement controller for one view under one renderer class, always reading
 * the ACTIVE layout, so a switch re-places every mounted grid.
 *   arrange(items, cols, pin?) -> [{...item, x, y, w, h}] in reading order
 *   move(items, cols, pin)     -> commit a drag/resize/keyboard step
 *   order(items, cols, ids)    -> commit a reading order
 *   reset()                    -> forget this view's placements
 */
export function dashboardLayout(viewId, cls = 'full') {
  const map = () => G.viewMap(layouts, cls, viewId);
  return {
    // Read-only: arrange runs inside $derived, where a state write throws.
    arrange: (items, cols, pin = null) => G.pack(items, G.viewMap(layouts, cls, viewId, false), cols, pin),
    move(items, cols, pin) { G.commitPin(map(), items, cols, pin); persist(); },
    order(items, cols, ids) { G.commitOrder(map(), items, cols, ids); persist(); },
    // An empty map, not a deleted key: the migration can never resurrect it.
    reset() { const m = map(); for (const k of Object.keys(m)) delete m[k]; persist(); },
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
