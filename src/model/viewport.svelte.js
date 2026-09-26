/**
 * viewport.svelte.js — the live renderer class (RENDERING §12). RFC-062 draft.
 *
 * `view.cls` is the one place a composition decision reads the viewport:
 * nav model (rail vs tab strip), §11 drill-in promotion, and the layout
 * namespace in dashboard.svelte.js. Selection rules live in rclass.js.
 *
 * Constraints:
 * - A class change is DEFERRED while any pointer is down (RFC-062 item 5): a
 *   switch remounts the hero and the pane, and a rail drag or slider
 *   released on a different component than it started on is a gesture that
 *   was never committed. Applied on the last pointerup/pointercancel.
 * - Nothing here may touch machine state or the write plane. Pending writes
 *   live in shadow.svelte.js at module scope, so a remount cannot drop them.
 * - `data-rc` on <html> mirrors the class for CSS; no rule keys on it yet.
 */

import { nextClass } from './rclass.js';

const hasWindow = typeof window !== 'undefined';

function primaryPointer() {
  if (!hasWindow || !window.matchMedia) return 'fine';
  if (window.matchMedia('(pointer: coarse)').matches) return 'coarse';
  if (window.matchMedia('(pointer: none)').matches) return 'none';
  return 'fine';
}

export const view = $state({
  cls: hasWindow ? nextClass(null, window.innerWidth, primaryPointer()) : 'full',
  pointer: primaryPointer(),
});

if (hasWindow) {
  const down = new Set();
  const publish = () => { document.documentElement.dataset.rc = view.cls; };
  const apply = () => {
    if (down.size) return;
    view.pointer = primaryPointer();
    view.cls = nextClass(view.cls, window.innerWidth, view.pointer);
    publish();
  };
  const release = (e) => { down.delete(e.pointerId); apply(); };
  window.addEventListener('pointerdown', (e) => down.add(e.pointerId), true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // A pointerup lost to another window must not freeze the class forever.
  window.addEventListener('blur', () => { down.clear(); apply(); });
  window.addEventListener('resize', apply);
  for (const q of ['(pointer: coarse)', '(pointer: none)']) {
    window.matchMedia?.(q).addEventListener?.('change', apply);
  }
  publish();
}
