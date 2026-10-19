/**
 * motion.js -- the motion primitives (DESIGN §10.13 Motion). CSS motion reads
 * the tokens in style.css; script motion goes through these.
 *
 * Constraints:
 * - Durations are the style.css tokens read live, so html.still makes every
 *   one 0 ms and Svelte and WAAPI skip.
 * - Transform and opacity only. Nothing here animates a box's size or its
 *   place in flow; flipFollowers moves boxes that already moved, by transform.
 * - Reversible changes use `transition:` (Svelte reverses it from where it
 *   is) or a CSS transition; an arrival that is dismissed at once uses `in:`.
 * - No view transitions: in Chromium 151 every form, document or scoped,
 *   takes the pointer events in its scope for its length (measured;
 *   pointer-events: none on the pseudo-elements does not pass them).
 */
// No imports: the plugin kit loads this file as a raw module in the browser suites (no bundler, no bare specifiers).

/** A duration token in ms: 'quick' 120, 'move' 200, 'slow' 320; 0 under html.still. */
export function ms(k = 'move') {
  // html.still, not isStill(): the plugin kit imports this file in plain Node tests, where runes do not compile.
  if (typeof document === 'undefined' || document.documentElement.classList.contains('still')) return 0;
  // The minifier writes 200ms as .2s: read the unit.
  const v = getComputedStyle(document.documentElement).getPropertyValue('--t-' + k).trim();
  return (parseFloat(v) || 0) * (v.endsWith('ms') ? 1 : 1000);
}

// --ease-out, cubic-bezier(.2, .7, .2, 1), for Svelte's JS easing (Newton on x, then y).
function bezier(x1, y1, x2, y2) {
  const c = (a, b, t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const d = (a, b, t) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x) => {
    let t = x;
    for (let i = 0; i < 6; i++) { const s = d(x1, x2, t); if (Math.abs(s) < 1e-6) break; t -= (c(x1, x2, t) - x) / s; }
    return c(y1, y2, Math.min(1, Math.max(0, t)));
  };
}
export const easeOut = bezier(0.2, 0.7, 0.2, 1);
/** --ease-settle: a critically damped spring (no overshoot), 1 - (1 + wt) e^-wt, w = 9.2 so it lands by t = 1. */
export const easeSettle = (t) => (t >= 1 ? 1 : 1 - (1 + 9.2 * t) * Math.exp(-9.2 * t));
// The same two curves for WAAPI, which takes no var().
const EASE_OUT = 'cubic-bezier(.2, .7, .2, 1)';
const SETTLE = 'linear(' + Array.from({ length: 21 }, (_, i) => easeSettle(i / 20).toFixed(3)).join(', ') + ')';

/** Opacity. */
export function fade(node, { k = 'move' } = {}) {
  return { duration: ms(k), easing: easeOut, css: (t) => `opacity: ${t}` };
}
/** Opacity and a short travel: menus, dialogs, toolbars, list rows. `y` in px, positive rises from below. */
export function rise(node, { k = 'move', y = 6 } = {}) {
  return { duration: ms(k), easing: easeOut, css: (t, u) => `opacity: ${t}; translate: 0 ${u * y}px` };
}
/** A drawer from its edge: 'left' | 'right' | 'bottom', its own extent, on the settle curve. */
export function drawer(node, { from = 'left', k = 'move' } = {}) {
  const r = node.getBoundingClientRect();
  const [ax, ay] = from === 'left' ? [-r.right, 0] : from === 'right' ? [innerWidth - r.left, 0] : [0, innerHeight - r.top];
  return { duration: ms(k), easing: easeSettle, css: (t, u) => `translate: ${u * ax}px ${u * ay}px` };
}
/** animate:flipMove on a keyed each: the rows that stay slide to their new place (svelte/animate's flip, translate only). */
export function flipMove(node, { from, to }) {
  const dx = from.left - to.left, dy = from.top - to.top;
  return { duration: ms('move'), easing: easeSettle, css: (t, u) => `translate: ${u * dx}px ${u * dy}px` };
}

const flying = new WeakMap();
/**
 * Run `mutate` (it changes `el`'s height: a card or a <details> opening), then
 * slide every box after it, up to the page's scroller, from where it was to
 * where it is now. A second call mid-way starts from where the boxes are.
 */
export function flipFollowers(el, mutate) {
  const dur = ms('move');
  if (!dur || !el?.isConnected) { mutate(); return; }
  const boxes = [];
  for (let n = el; n && n !== document.body && boxes.length < 60; n = n.parentElement) {
    if (n.matches?.('.content, main.pane')) break;
    for (let s = n.nextElementSibling; s && boxes.length < 60; s = s.nextElementSibling) boxes.push(s);
  }
  const first = boxes.map((b) => b.getBoundingClientRect());
  for (const b of boxes) flying.get(b)?.cancel();
  mutate();
  boxes.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    const dx = first[i].left - r.left, dy = first[i].top - r.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const a = b.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: dur, easing: SETTLE });
    flying.set(b, a);
    a.onfinish = a.oncancel = () => flying.get(b) === a && flying.delete(b);
  });
}

/** A body just shown: it rises 4 px into place as the boxes after it slide (WAAPI, so it is never left held). */
export function riseIn(el) {
  const dur = ms('move');
  if (dur) el.animate([{ opacity: 0, translate: '0 -4px' }, { opacity: 1, translate: '0 0' }], { duration: dur, easing: EASE_OUT });
}

/** A panel opened from the window's 'right' or 'left' edge slides in from it (WAAPI). The Animation, or null under html.still. */
export function slideIn(el, from = 'right') {
  const dur = ms('move');
  if (!dur) return null;
  const r = el.getBoundingClientRect();
  const dx = from === 'right' ? innerWidth - r.left : -r.right;
  return el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: dur, easing: SETTLE });
}

// <details> everywhere: the boxes after it slide by flipFollowers and the body rises in.
// The click lands before the toggle, so the boxes are measured where they were.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const s = e.target.closest?.('summary');
    const d = s?.parentElement;
    if (!d || d.tagName !== 'DETAILS' || s !== d.querySelector(':scope > summary') || e.defaultPrevented) return;
    e.preventDefault();
    flipFollowers(d, () => { d.open = !d.open; });
    if (d.open) for (const c of d.children) if (c !== s) riseIn(c);
  });
}
