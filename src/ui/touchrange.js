/**
 * touchrange.js -- the touch-intent rule (DESIGN 10.13, Touch) on every native
 * range input in the document, the shell's and the plugins' alike. A touch or
 * pen adjusts a range only through kit.js drag(): after INTENT_PX along the
 * range's axis, or a HOLD_MS hold, and then from the value it had (no jump).
 * A tap never moves it; a swipe across its axis scrolls the page.
 *
 * Constraints:
 * - The engine's own touch path still moves the thumb (Chromium does it on
 *   touchstart, which cannot be cancelled without losing the scroll): while a
 *   touch or pen is down on a range, its trusted input and change events are
 *   stopped at window capture and the value put back. The drag's writes are
 *   untrusted input and change events, so every listener the range already
 *   has works unchanged.
 * - pointerdown is cancelled for touch and pen: no compatibility mousedown
 *   reaches the native mouse path (which jumps the thumb too). A tap focuses.
 * - Mouse and keyboard are never touched. A range that takes no pointer (the
 *   kit slider, style.css) is never the target and keeps its own drag().
 * - Vertical means a vertical writing mode with the minimum at the bottom
 *   (Field's data-orient='v').
 */
import { drag } from '../plugins/kit.js';
import { dragGain, snap } from '../model/nudge.js';

const bound = new WeakMap();   // input -> { axis, off }
let g = null;                  // the touch in flight: { input, id, v, began }

const rangeOf = (e) => {
  const t = e.composedPath ? e.composedPath()[0] : e.target;
  return t instanceof HTMLInputElement && t.type === 'range' ? t : null;
};
const num = (s, d) => { const n = parseFloat(s); return Number.isFinite(n) ? n : d; };

function set(input, v) {
  const was = input.value;
  input.value = String(v);
  if (input.value === was) return;
  if (g && g.input === input) g.v = input.value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function bind(input, axis) {
  let rel = null, v0 = '';
  const off = drag(input, {
    axis,
    filter: (e) => e.pointerType !== 'mouse' && !input.disabled,
    onStart(_d, e) {
      if (g && g.input === input) g.began = true;
      v0 = input.value;
      rel = { v: +input.value, x: e.clientX, y: e.clientY, r: input.getBoundingClientRect() };
    },
    onMove(e) {
      if (!rel || input.disabled) return;
      const min = num(input.min, 0), max = num(input.max, 100), step = input.step === 'any' ? 0 : num(input.step, 1);
      const len = (axis === 'y' ? rel.r.height : rel.r.width) || 1;
      const along = axis === 'y' ? rel.y - e.clientY : e.clientX - rel.x;
      rel.v = Math.min(max, Math.max(min, rel.v + (along / len) * (max - min) * dragGain(e, 1)));
      rel.x = e.clientX;
      rel.y = e.clientY;
      set(input, snap(rel.v, e, min, max, 0, step));
    },
    onEnd(_e, ok) {
      rel = null;
      if (ok && input.value !== v0) input.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
  // CSS owns touch-action (style.css input[type=range], Field's vertical slider): drag()'s inline value would outlive a re-orientation.
  input.style.touchAction = '';
  bound.set(input, { axis, off });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    const input = rangeOf(e);
    if (!input || e.pointerType === 'mouse' || input.disabled) return;
    e.preventDefault();
    g = { input, id: e.pointerId, v: input.value, began: false };
    const axis = getComputedStyle(input).writingMode.startsWith('vertical') ? 'y' : 'x';
    const b = bound.get(input);
    if (b && b.axis === axis) return;
    if (b) b.off();
    bind(input, axis);
  }, true);
  const stop = (e) => {
    if (!g || !e.isTrusted || rangeOf(e) !== g.input) return;
    e.stopImmediatePropagation();
    g.input.value = g.v;
  };
  window.addEventListener('input', stop, true);
  window.addEventListener('change', stop, true);
  // Cleared a task later: the engine's touchend may still send a change.
  const up = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const was = g;
    if (e.type === 'pointerup' && !was.began) was.input.focus({ preventScroll: true });
    setTimeout(() => { if (g === was) g = null; }, 0);
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}
