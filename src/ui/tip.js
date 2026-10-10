/**
 * tip.js -- the one tooltip (docs/PLUGINS.md, Tooltips): an element's `data-tip` is
 * its tooltip, drawn by one popover this module owns. A native `title` never shows.
 *
 * Constraints:
 * - No `title` attribute is ever left on an element: the first pointerover, pointermove
 *   or focusin that reaches one moves it to `data-tip` and removes it (SVG <title>
 *   children likewise). Markup in Phosphor sets `data-tip` itself; this is the net for
 *   plugin and third-party markup. No MutationObserver walks the tree.
 * - A tip that repeats what the element already says is never shown: its visible text,
 *   or its aria-label while visible text exists. An icon-only element keeps its tip, the
 *   only visible name it has. A tip equal to text that the element clips stays: it is
 *   the full text.
 * - The tip is hover- and keyboard-focus-driven only. A title that was an element's only
 *   name becomes its aria-label; a shown tip is its aria-describedby.
 * No DOM at import time: node tests import `norm`.
 */

const DELAY = 450;              // ms of rest before the first tip; a second one inside WARM is instant
const WARM = 400;
const POP_ID = 'ph-tip';
const NAMED = 'button,a[href],input,select,textarea,summary,[role],[tabindex],svg,img';

// A trailing key hint ("Fullscreen, F11", "Undo (Ctrl+Z)", "Close [Esc]") is not part of what a tip says.
const HINT = /(?:\s*[,·]\s*|\s*[([]\s*)(?:ctrl|shift|alt|cmd|meta|esc|enter|space|tab|f\d{1,2}|[⌘⌥⇧])[^)\]]*[)\]]?\s*$|\s*[([]\s*[a-z0-9]\s*[)\]]\s*$/i;

/** A tip or a name, compared: case, spacing, a trailing key hint and trailing punctuation do not count. */
export const norm = (s) => String(s ?? '').replace(HINT, '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s….:]+$/, '').trim();

let pop = null, owner = null, pend = null, timer = 0, lastShown = 0, px = 0, py = 0, byKey = false;

const textOf = (el) => (el instanceof HTMLElement ? el.innerText : el.textContent) || '';

function labelText(el) {
  const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  return ids.map((i) => document.getElementById(i)?.textContent || '').join(' ') || el.getAttribute('aria-label') || '';
}

/** Does the element, or something in it, clip its text (ellipsis, line clamp, hidden overflow)? */
function clipped(el) {
  const cut = (e, strict) => {
    const cs = getComputedStyle(e);
    if (strict) return cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 || cs.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 1;
    return e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible' || e.scrollHeight > e.clientHeight + 1 && cs.overflowY !== 'visible';
  };
  let n = 0;
  for (const e of [el, ...el.querySelectorAll('*')]) if (++n <= 24 && cut(e, false)) return true;
  // An inline element clips through the block around it.
  for (let e = el.parentElement, i = 0; e && i < 3; e = e.parentElement, i++) if (cut(e, true)) return true;
  return false;
}

/** True when the tip adds nothing to what the element shows or is named. */
export function redundant(el, tip) {
  const t = norm(tip);
  if (!t) return true;
  const vis = norm(textOf(el));
  if (!vis) return false;
  if (t === vis) return !clipped(el);
  return t === norm(labelText(el));
}

const hasName = (el) => !!(labelText(el) || el.textContent.trim() || el.getAttribute('alt') || el.value || el.labels?.length);

/** Moves a `title` (or an SVG <title> child) to `data-tip`; where it was the only name, to aria-label. */
function convert(el) {
  let t = el.getAttribute('title');
  if (t != null) el.removeAttribute('title');
  else if (el instanceof SVGElement) {
    const c = el.querySelector(':scope > title');
    if (!c) return;
    t = c.textContent;
    c.remove();
  } else return;
  if (!t) return;
  if (!el.hasAttribute('data-tip')) el.setAttribute('data-tip', t);
  if (el.matches(NAMED) && !hasName(el)) el.setAttribute('aria-label', t);
}

function popover() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = POP_ID;
  pop.setAttribute('role', 'tooltip');
  pop.setAttribute('popover', 'manual');
  document.body.append(pop);
  return pop;
}

function hide() {
  clearTimeout(timer);
  timer = 0;
  pend = null;
  if (!owner) return;
  const d = (owner.getAttribute('aria-describedby') || '').split(/\s+/).filter((i) => i && i !== POP_ID).join(' ');
  if (d) owner.setAttribute('aria-describedby', d); else owner.removeAttribute('aria-describedby');
  owner = null;
  if (pop?.matches(':popover-open')) pop.hidePopover();
}

function place(el) {
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight, vw = innerWidth, vh = innerHeight;
  // A pointer tip hangs under the pointer, a keyboard tip under the element; either flips above at the window's edge.
  let x = byKey ? r.left : px, y = byKey ? r.bottom + 6 : py + 18;
  if (y + h > vh - 4) y = (byKey ? r.top - 6 : py - 10) - h;
  pop.style.left = Math.max(4, Math.min(x, vw - w - 4)) + 'px';
  pop.style.top = Math.max(4, y) + 'px';
}

function show(el) {
  timer = 0;
  if (!el.isConnected) return;
  const t = el.getAttribute('data-tip') || '';
  if (redundant(el, t)) return;
  const p = popover();
  p.textContent = t;
  if (!p.matches(':popover-open')) p.showPopover();
  owner = el;
  el.setAttribute('aria-describedby', [...(el.getAttribute('aria-describedby') || '').split(/\s+/).filter((i) => i && i !== POP_ID), POP_ID].join(' '));
  lastShown = performance.now();
  place(el);
}

/** The element a tip would show for: the nearest with a title or a data-tip, its title converted. */
function consider(target, key) {
  const el = target instanceof Element ? target.closest('[title],[data-tip]') : null;
  const svg = !el && target instanceof SVGElement && target.querySelector(':scope > title') ? target : null;
  const e = el || svg;
  if (e) convert(e);
  if (e && e === owner) {
    const t = e.getAttribute('data-tip') || '';
    if (t !== pop.textContent) { if (redundant(e, t)) hide(); else { pop.textContent = t; place(e); } }
    return;
  }
  if (e && e === pend) return;
  hide();
  if (!e || !e.getAttribute('data-tip')) return;
  byKey = key;
  pend = e;
  timer = setTimeout(() => show(e), key || performance.now() - lastShown < WARM ? 0 : DELAY);
}

/** Installs the document-level handlers once. */
export function installTips() {
  if (window.__phTips) return;
  window.__phTips = true;
  const mouse = (e) => e.pointerType !== 'touch';
  document.addEventListener('pointerover', (e) => { if (mouse(e)) { px = e.clientX; py = e.clientY; consider(e.target, false); } }, true);
  // A disabled control is not an event target in every engine; the element left for it still names it.
  document.addEventListener('pointerout', (e) => { if (mouse(e)) { px = e.clientX; py = e.clientY; if (e.relatedTarget) consider(e.relatedTarget, false); else hide(); } }, true);
  document.addEventListener('pointermove', (e) => {
    if (!mouse(e)) return;
    px = e.clientX; py = e.clientY;
    // A title or a tip set while the pointer rests (a time that works out its age on hover) is met here.
    if (e.target instanceof Element && e.target.closest('[title],[data-tip]')) consider(e.target, false);
  }, true);
  document.addEventListener('focusin', (e) => { if (e.target instanceof Element && e.target.matches(':focus-visible')) consider(e.target, true); else hide(); }, true);
  document.addEventListener('focusout', hide, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  document.addEventListener('scroll', hide, true);
}
