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
 * - `data-rc` on <html> mirrors the class for CSS (style.css glance menu stack).
 * - `view.bucket` (1..5) and `view.cols` are the only width reads a layout may
 *   make; they mirror to html[data-bucket] and --cols. Measured in 2 rem
 *   columns, so they re-derive when the root font size moves (theme scale).
 */

import { nextClass, layoutCols, bucketOf, phoneClamp } from './rclass.js';
import { onTheme } from './theme.js';

const hasWindow = typeof window !== 'undefined';

function primaryPointer() {
  if (!hasWindow || !window.matchMedia) return 'fine';
  if (window.matchMedia('(pointer: coarse)').matches) return 'coarse';
  if (window.matchMedia('(pointer: none)').matches) return 'none';
  return 'fine';
}

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const colsNow = () => (hasWindow ? layoutCols(window.innerWidth, remPx()) : 40);

const derive = (prev, pointer) => {
  if (!hasWindow) return { phone: false, cls: 'full', bucket: bucketOf(colsNow()) };
  return phoneClamp(nextClass(prev, window.innerWidth, pointer), bucketOf(colsNow()), pointer, window.innerWidth, window.innerHeight);
};
// phone: the phone class (rclass.js phoneClamp), mirrored to html[data-phone].
export const view = $state({ cols: colsNow(), pointer: primaryPointer(), ...derive(null, primaryPointer()) });

if (hasWindow) {
  const down = new Set();
  const publish = () => {
    const d = document.documentElement;
    d.dataset.rc = view.cls;
    d.dataset.bucket = String(view.bucket);
    d.toggleAttribute('data-phone', view.phone);
    // Guarded: the style observer below would otherwise re-enter on its own write.
    if (d.style.getPropertyValue('--cols') !== String(view.cols)) d.style.setProperty('--cols', String(view.cols));
  };
  const apply = () => {
    if (down.size) return;
    view.pointer = primaryPointer();
    view.cols = colsNow();
    Object.assign(view, derive(view.cls, view.pointer));
    publish();
  };
  const release = (e) => { down.delete(e.pointerId); apply(); };
  window.addEventListener('pointerdown', (e) => down.add(e.pointerId), true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // A pointerup lost to another window must not freeze the class forever.
  window.addEventListener('blur', () => { down.clear(); apply(); });
  window.addEventListener('resize', apply);
  onTheme(apply);
  // --s changes land as an inline style on <html> without a theme event.
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  for (const q of ['(pointer: coarse)', '(pointer: none)']) {
    window.matchMedia?.(q).addEventListener?.('change', apply);
  }
  publish();
}
