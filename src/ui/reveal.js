/**
 * reveal.js -- the pointer reveal (docs/THEMES.md, Chrome hooks): `--mx` and `--my`, the pointer's
 * place inside the hovered control in px, for a Theme whose manifest says `reveal: true`.
 *
 * Constraints:
 * - The listener exists only while such a Theme is applied: every other Theme pays nothing.
 * - A write happens only on a mouse's pointermove (the browser coalesces those to one a frame):
 *   no timer, no frame of its own, nothing while the pointer rests.
 * - Browser preference only: nothing here reaches the hub.
 */
import { onTheme, themeMeta } from '../model/theme.js';

const SEL = 'button, [role=tab], select, a[href]';

/** One pointermove: the hovered control's --mx and --my. Exported for test/reveal.test.mjs. */
export function move(e) {
  if (e.pointerType !== 'mouse') return;
  const el = e.target && e.target.closest ? e.target.closest(SEL) : null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
  el.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
}

let on = false;
export function installReveal(doc = document) {
  onTheme((t) => {
    const want = !!themeMeta(t.style)?.reveal;
    if (want === on) return;
    on = want;
    if (on) doc.addEventListener('pointermove', move, { passive: true }); else doc.removeEventListener('pointermove', move);
  });
}
