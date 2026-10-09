/**
 * kit.js -- api.ui, the plugin UI kit (docs/PLUGINS.md, The UI kit; ph-5wsk):
 * the shell's controls and layout primitives as plain-DOM factories, handed to
 * every plugin by the host (host.js deps.ui).
 *
 * Constraints:
 * - No DOM at import time: host.js and test/plugins.test.mjs import it under node.
 * - One look: an element wears the shell's global classes (style.css, the
 *   control language and the PLUGIN KIT block). Inline style here is a
 *   measured value only.
 * - A factory returns the live element; its handle is properties on it. A
 *   setter redraws in place and never calls back; callbacks fire on a user's
 *   act only. An unknown option throws.
 * - Touch never adjusts by accident (ph-5u0g peeve 14): every drag rides
 *   drag(), which starts a touch only after INTENT_PX along its axis or a
 *   HOLD_MS hold; a tap never changes a value.
 * - The outside tap that closes an overlay is swallowed, never one on the top
 *   strip or the stop pair (ph-5wsk.3): a safety control always takes its tap.
 * - A window listener whose element has left the document removes itself
 *   (winOn): a plugin never has to tear a kit element down.
 * - Every slot a state fills is reserved up front: a state change swaps text,
 *   never a box.
 */
import { NAV_ICONS } from '../ui/navIcons.js';
import { scrollshade } from '../ui/scrollshade.js';
import { modStep, dragGain, snap } from '../model/nudge.js';

export const VERSION = 1;
export const INTENT_PX = 8;
export const HOLD_MS = 400;
export const DOUBLE_MS = 250;
export const IDLE_MS = 2500;
const REPEAT_MS = 110;            // a stepper's hold-repeat, Field.svelte's
const SHEET_DRAG_CLOSE = 60;      // px down a sheet's head that closes it
const TILE_TEXT_REM = 2.625;      // a tile's title and meta rows and their gaps (style.css .ui-tile-b)
const STRIP = '.topstrip';        // the safety strip with its stop pair: never swallowed, never covered
const SVG = 'http://www.w3.org/2000/svg';

const PANES = ['machine', 'pairing', 'valence', 'log', 'display', 'plugins', 'hubs', 'server', 'settings', 'merge', 'about', 'quickRail'];
/** The shell's glyph set: [filled d, stroked d] on a 16-unit box, the stroke open at 1.5. */
export const ICONS = Object.freeze({
  ...Object.fromEntries(PANES.map((k) => [k, Object.freeze(['', NAV_ICONS[k]])])),
  play: Object.freeze(['M5 3l9 5-9 5z', '']),
  pause: Object.freeze(['M4 3h3v10H4zM9 3h3v10H9z', '']),
  prev: Object.freeze(['M13 3v10L6 8z', 'M3 3v10']),
  next: Object.freeze(['M3 3v10l7-5z', 'M13 3v10']),
  volume: Object.freeze(['M2 6h3l4-3.5v11L5 10H2z', 'M11.5 5.5a3.5 3.5 0 010 5']),
  muted: Object.freeze(['M2 6h3l4-3.5v11L5 10H2z', 'M11 6l4 4M15 6l-4 4']),
  full: Object.freeze(['', 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4']),
  unfull: Object.freeze(['', 'M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4']),
  caret: Object.freeze(['', 'M6.5 5l3 3-3 3']),
  library: Object.freeze(['', 'M2 2.5h5v5H2zM9 2.5h5v5H9zM2 9.5h5v4H2zM9 9.5h5v4H9z']),
  graph: Object.freeze(['', 'M2.5 2.5h11v11h-11zM4 8Q5 5 6 5T8 8T10 11T12 8']),
  close: Object.freeze(['', 'M4 4l8 8M12 4l-8 8']),
  gear: Object.freeze(['', 'M2 4h6.5M11.5 4H14M11.5 4a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M2 8h1.5M6.5 8H14M6.5 8a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0'
    + 'M2 12h5.5M10.5 12H14M10.5 12a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0']),
  video: Object.freeze(['', 'M1.5 4.5h9v7h-9zM10.5 7l4-2v6l-4-2']),
  script: Object.freeze(['', 'M1 11l2.5-6 2.5 6 2.5-6 2.5 6 2.5-6']),
  more: Object.freeze(['M2.5 7h2v2h-2zM7 7h2v2H7zM11.5 7h2v2h-2z', '']),
  plus: Object.freeze(['', 'M8 3v10M3 8h10']),
  minus: Object.freeze(['', 'M3 8h10']),
  up: Object.freeze(['', 'M8 13V3M4 7l4-4 4 4']),
  left: Object.freeze(['', 'M10 3L5 8l5 5']),
  right: Object.freeze(['', 'M6 3l5 5-5 5']),
});

// ---- helpers ------------------------------------------------------------------

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false && x !== ''));
  return e;
}
function check(name, o, keys) {
  if (o == null) return {};
  if (typeof o !== 'object' || Array.isArray(o)) throw new TypeError('ui.' + name + ' takes one options object');
  for (const k of Object.keys(o)) if (k !== 'class' && !keys.includes(k)) throw new Error('ui.' + name + ': unknown option "' + k + '"');
  return o;
}
const cls = (base, o) => (o.class ? base + ' ' + o.class : base);
const def = (el, props) => {
  for (const [k, d] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, enumerable: true, ...d });
  return el;
};
const setText = (e, t) => { t = t == null ? '' : String(t); if (e.textContent !== t) e.textContent = t; };
const attr = (e, k, v) => { if (v == null) e.removeAttribute(k); else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v)); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const phone = () => +(document.documentElement.dataset.bucket || 3) <= 2;
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const decimals = (step) => (Number.isFinite(step) && step > 0 ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 6);
/** v held inside [min, max] on the step grid from min, without float noise. */
const onGrid = (v, min, max, step) => {
  if (!Number.isFinite(v)) return v;
  if (step > 0 && Number.isFinite(min)) v = min + Math.round((v - min) / step) * step;
  return Math.round(clamp(v, min, max) * 1e6) / 1e6;
};
const pairOf = (x) => (typeof x === 'string' && Object.hasOwn(ICONS, x) ? ICONS[x] : ['', String(x || '')]);
// The shell's page fullscreen (phosphor-page-fullscreen-change), read by the overlays' auto form.
let pageFull = false, pageFullSeen = false;
const watchFull = () => {
  if (pageFullSeen) return;
  pageFullSeen = true;
  window.addEventListener('phosphor-page-fullscreen-change', (e) => { pageFull = !!(e.detail && e.detail.on); });
};

/**
 * A window listener that removes itself once its element has been in the
 * document and left it, so an unmounted plugin view leaves nothing behind.
 */
function winOn(el, type, fn) {
  let seen = false;
  const f = (e) => {
    if (el.isConnected) { seen = true; fn(e); } else if (seen) window.removeEventListener(type, f);
  };
  window.addEventListener(type, f);
}

/** The shell's icon: an <svg> of the named glyph, or of one stroke path `d`. */
export function icon(x) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ui-icon');
  const [f, k] = pairOf(x);
  for (const [c, d] of [['f', f], ['s', k]]) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('class', c);
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}
function setIcon(svg, x) {
  const [f, k] = pairOf(x);
  if (svg.children[0].getAttribute('d') !== f) svg.children[0].setAttribute('d', f);
  if (svg.children[1].getAttribute('d') !== k) svg.children[1].setAttribute('d', k);
}

// ---- behavior: drag, gestures, outside ------------------------------------------

/**
 * A pointer drag along an axis that never steals a scroll. A mouse begins at
 * once; a touch or pen after INTENT_PX more along the axis than across (when
 * `intent`) or a HOLD_MS hold (when `hold`); more across first gives the
 * gesture to the page. -> off()
 */
export function drag(el, o) {
  const { axis = 'x', intent = true, hold = true, filter = null, onStart = null, onMove = null, onEnd = null } =
    check('drag', o, ['axis', 'intent', 'hold', 'filter', 'onStart', 'onMove', 'onEnd']);
  el.style.touchAction = !intent ? 'pan-x pan-y' : axis === 'y' ? 'pan-x' : 'pan-y';
  let s = null;
  const begin = (e) => {
    s.on = true;
    clearTimeout(s.t);
    try { el.setPointerCapture(s.id); } catch (err) { /* the pointer is gone */ }
    el.setAttribute('data-drag', '');
    if (onStart) onStart(s.down, e);
  };
  const end = (e, ok) => {
    if (!s) return;
    const was = s.on, d = s.down;
    clearTimeout(s.t);
    s = null;
    el.removeAttribute('data-drag');
    if (was && onEnd) onEnd(e, ok, d);
  };
  const down = (e) => {
    if (s || (e.pointerType === 'mouse' && e.button !== 0) || (filter && !filter(e))) return;
    s = { id: e.pointerId, x: e.clientX, y: e.clientY, down: e, on: false, t: 0 };
    if (e.pointerType === 'mouse') begin(e);
    else if (hold) s.t = setTimeout(() => { if (s && !s.on) begin(s.down); }, HOLD_MS);
  };
  const move = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) {
      const along = Math.abs(axis === 'y' ? dy : dx), across = Math.abs(axis === 'y' ? dx : dy);
      if (Math.max(along, across) < INTENT_PX) return;
      if (!intent || across >= along) { clearTimeout(s.t); s = null; return; }
      begin(e);
    }
    if (onMove) onMove(e, dx, dy);
  };
  const up = (e) => { if (s && e.pointerId === s.id) end(e, e.type === 'pointerup'); };
  // A drag that has begun owns its touch: the page does not scroll under it.
  const tm = (e) => { if (s && s.on && e.cancelable) e.preventDefault(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('touchmove', tm, { passive: false });
  return () => {
    end({ type: 'pointercancel' }, false);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('touchmove', tm);
  };
}

/**
 * tap (after the double window when `double` is set), double, a HOLD_MS hold,
 * and a two-finger pinch reporting its scale since the last call. -> off()
 */
export function gestures(el, o) {
  const { tap = null, double = null, hold = null, pinch = null, filter = null } = check('gestures', o, ['tap', 'double', 'hold', 'pinch', 'filter']);
  let clickT = 0, holdT = 0, held = false, start = null, spread0 = 0;
  const touches = new Map();
  const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const down = (e) => {
    held = false;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(holdT);
    if (hold && (!filter || filter(e))) holdT = setTimeout(() => { held = true; hold(e); }, HOLD_MS);
    if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2) { clearTimeout(holdT); spread0 = spread(); } }
  };
  const move = (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > INTENT_PX) clearTimeout(holdT);
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2 && spread0) { const d = spread(); pinch(d / spread0, e); spread0 = d; }
  };
  const up = (e) => { clearTimeout(holdT); touches.delete(e.pointerId); if (touches.size < 2) spread0 = 0; };
  const click = (e) => {
    if (held) { held = false; return; }
    if (filter && !filter(e)) return;
    clearTimeout(clickT);
    if (!double) { if (tap) tap(e); return; }
    if (e.detail < 2 && tap) clickT = setTimeout(() => tap(e), DOUBLE_MS);
  };
  const dbl = (e) => { if (filter && !filter(e)) return; clearTimeout(clickT); if (double) double(e); };
  const L = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['click', click], ['dblclick', dbl]];
  for (const [t, f] of L) el.addEventListener(t, f);
  return () => { clearTimeout(clickT); clearTimeout(holdT); for (const [t, f] of L) el.removeEventListener(t, f); };
}

/** The click that follows a pointerdown which closed an overlay: eaten, so the tap never reaches the page beneath. */
function swallow() {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); done(); };
  // Ends at the next pointerdown, never on a timer, so a long press cannot slip through.
  const done = () => { document.removeEventListener('click', eat, true); document.removeEventListener('pointerdown', done, true); };
  document.addEventListener('click', eat, true);
  setTimeout(() => document.addEventListener('pointerdown', done, true), 0);
}

/**
 * onOutside(e) for a pointerdown outside `el` and the `except` elements; its
 * click is swallowed unless it landed on the top strip or the stop pair. -> off()
 */
export function outside(el, onOutside, except = []) {
  const fn = (e) => {
    const t = e.target;
    if (!(t instanceof Node) || el.contains(t) || except.some((x) => x && x.contains(t))) return;
    onOutside(e);
    if (!(t instanceof Element && t.closest(STRIP))) swallow();
  };
  document.addEventListener('pointerdown', fn, true);
  return () => document.removeEventListener('pointerdown', fn, true);
}

// ---- controls ---------------------------------------------------------------------

export function button(o = {}) {
  check('button', o, ['label', 'icon', 'title', 'tone', 'pressed', 'disabled', 'onClick']);
  if (o.tone != null && !['primary', 'danger'].includes(o.tone)) throw new Error('ui.button: tone is "primary" or "danger"');
  const b = h('button', { type: 'button', class: cls('og-btn sm ui-btn' + (o.tone ? ' ' + o.tone : ''), o) });
  let ic = null, lb = null, name = null;
  // An icon-only button is named by its title.
  const sync = () => { if (lb) b.removeAttribute('aria-label'); else attr(b, 'aria-label', b.getAttribute('title') || null); };
  def(b, {
    label: {
      get: () => (lb ? lb.textContent : ''),
      set(v) {
        if (v == null || v === '') { if (lb) lb.remove(); lb = null; } else { if (!lb) b.append(lb = h('span', { class: 'ui-btn-l' })); setText(lb, v); }
        sync();
      },
    },
    icon: {
      get: () => name,
      set(v) { name = v || null; if (!v) { if (ic) ic.remove(); ic = null; } else if (!ic) b.prepend(ic = icon(v)); else setIcon(ic, v); },
    },
    title: { get: () => b.getAttribute('title') || '', set(v) { attr(b, 'title', v || null); sync(); } },
    pressed: {
      get: () => (b.hasAttribute('aria-pressed') ? b.getAttribute('aria-pressed') === 'true' : null),
      set(v) { attr(b, 'aria-pressed', v == null ? null : String(!!v)); b.classList.toggle('on', !!v); },
    },
  });
  b.icon = o.icon;
  b.label = o.label;
  b.title = o.title;
  b.pressed = o.pressed;
  b.disabled = !!o.disabled;
  // A toggle flips before onClick, so onClick reads the new state.
  b.addEventListener('click', (e) => { if (b.pressed != null) b.pressed = !b.pressed; if (o.onClick) o.onClick(e); });
  return b;
}

/** A hidden file input; open() shows the picker, onFiles gets the chosen files as an array. */
export function files(o = {}) {
  check('files', o, ['accept', 'multiple', 'onFiles']);
  const f = h('input', { type: 'file', class: cls('ui-files', o), accept: o.accept || null, multiple: !!o.multiple, hidden: true, tabindex: '-1' });
  f.addEventListener('change', () => { const list = [...(f.files || [])]; f.value = ''; if (list.length && o.onFiles) o.onFiles(list); });
  return def(f, { open: { value: () => f.click() } });
}

export function segmented(o = {}) {
  check('segmented', o, ['options', 'value', 'tabs', 'disabled', 'onChange']);
  const tabs = !!o.tabs;
  const el = h('div', { class: cls('og-seg ui-seg', o), role: tabs ? 'tablist' : 'radiogroup' });
  let value = o.value, btns = [], off = false;
  const draw = () => {
    const any = btns.some((b) => b._v === value);
    btns.forEach((b, i) => {
      const on = b._v === value;
      b.classList.toggle('active', on && !tabs);
      attr(b, tabs ? 'aria-selected' : 'aria-checked', String(on));
      b.tabIndex = on || (!any && i === 0) ? 0 : -1;
      b.disabled = off;
    });
  };
  const pick = (v, e) => { if (v === value) return; value = v; draw(); if (o.onChange) o.onChange(v, e); };
  const build = (list) => {
    btns = (list || []).map((x) => {
      const b = h('button', { type: 'button', role: tabs ? 'tab' : 'radio', title: x.title || null }, x.icon ? icon(x.icon) : null,
        x.label ? h('span', { text: x.label }) : null);
      if (!x.label && x.title) b.setAttribute('aria-label', x.title);
      b._v = x.value;
      b.addEventListener('click', (e) => pick(x.value, e));
      return b;
    });
    el.replaceChildren(...btns);
    draw();
  };
  el.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const i = btns.indexOf(document.activeElement);
    if (!d || i < 0) return;
    e.preventDefault();
    const b = btns[(i + d + btns.length) % btns.length];
    b.focus();
    pick(b._v, e);
  });
  def(el, {
    value: { get: () => value, set(v) { value = v; draw(); } },
    disabled: { get: () => off, set(v) { off = !!v; draw(); } },
    options: { get: () => btns.map((b) => b._v), set: build },
  });
  off = !!o.disabled;
  build(o.options);
  return el;
}

export { switchCtl as switch };
function switchCtl(o = {}) {
  check('switch', o, ['label', 'value', 'disabled', 'onChange']);
  const input = h('input', { type: 'checkbox', role: 'switch' });
  const lab = h('span', { class: 'ui-switch-l' });
  const el = h('label', { class: cls('og-switch ui-switch', o) }, input, h('span', { class: 'track' }), lab);
  input.addEventListener('change', (e) => { if (o.onChange) o.onChange(input.checked, e); });
  def(el, {
    value: { get: () => input.checked, set(v) { input.checked = !!v; } },
    disabled: { get: () => input.disabled, set(v) { input.disabled = !!v; el.classList.toggle('is-disabled', !!v); } },
    label: { get: () => lab.textContent, set(v) { setText(lab, v); attr(input, 'aria-label', v ? null : el.title || null); } },
    input: { value: input },
  });
  el.value = o.value;
  el.disabled = o.disabled;
  el.label = o.label;
  return el;
}

export function slider(o = {}) {
  check('slider', o, ['min', 'max', 'step', 'value', 'label', 'format', 'disabled', 'onInput', 'onChange']);
  const min = o.min == null ? 0 : +o.min, max = o.max == null ? 1 : +o.max, step = o.step == null ? 0 : +o.step;
  const input = h('input', { type: 'range', min, max, step: step || 'any', 'aria-label': o.label || null });
  const el = h('div', { class: cls('ui-slider', o) }, input);
  const fmt = o.format || ((v) => v.toFixed(decimals(step || (max - min) / 100)));
  const chip = h('output', { class: 'field-value ui-chip' });
  // The chip's width is the widest it can read, reserved: a value change never moves the row.
  chip.style.minWidth = Math.max(String(fmt(min)).length, String(fmt(max)).length) + 1 + 'ch';
  const show = () => setText(chip, fmt(+input.value));
  const live = (v, e) => { v = onGrid(v, min, max, step); if (+input.value === v) return; input.value = String(v); show(); if (o.onInput) o.onInput(v, e); };
  input.addEventListener('input', (e) => { show(); if (o.onInput) o.onInput(+input.value, e); });
  input.addEventListener('change', (e) => { if (o.onChange) o.onChange(+input.value, e); });
  // Ctrl+Arrow: the adjacent decade multiple (DESIGN 10.5); Shift+Arrow is the native step.
  input.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d || !e.ctrlKey) return;
    e.preventDefault();
    live(snap(+input.value, e, min, max, d, step), e);
    if (o.onChange) o.onChange(+input.value, e);
  });
  // The input takes no pointer (style.css): every press comes here. A plain mouse jumps the thumb and drags it;
  // a touch drags from where it was (no jump) once it means it; a modifier makes a mouse drag relative too.
  let rel = null;
  const jump = (x) => { const r = input.getBoundingClientRect(); live(min + (r.width ? clamp((x - r.left) / r.width, 0, 1) : 0) * (max - min)); };
  drag(el, {
    filter: () => !input.disabled,
    onStart(d, e) {
      input.focus({ preventScroll: true });
      if (d.pointerType === 'mouse' && !d.shiftKey && !d.ctrlKey) { rel = null; jump(d.clientX); return; }
      rel = { v: +input.value, x: e.clientX, w: input.getBoundingClientRect().width || 1 };
    },
    onMove(e) {
      if (!rel) { jump(e.clientX); return; }
      rel.v = clamp(rel.v + ((e.clientX - rel.x) / rel.w) * (max - min) * dragGain(e, 1), min, max);
      rel.x = e.clientX;
      live(snap(rel.v, e, min, max, 0, step), e);
    },
    onEnd(e, ok) { rel = null; if (ok && o.onChange) o.onChange(+input.value, e); },
  });
  el.addEventListener('click', () => { if (document.activeElement !== input) input.focus({ preventScroll: true }); });
  def(el, {
    value: { get: () => +input.value, set(v) { input.value = String(v); show(); } },
    disabled: { get: () => input.disabled, set(v) { input.disabled = !!v; } },
    chip: { value: chip },
    input: { value: input },
  });
  el.value = o.value ?? min;
  el.disabled = o.disabled;
  return el;
}

export function stepper(o = {}) {
  check('stepper', o, ['min', 'max', 'step', 'value', 'unit', 'label', 'buttons', 'drag', 'disabled', 'onChange']);
  const min = o.min == null ? -Infinity : +o.min, max = o.max == null ? Infinity : +o.max, step = +o.step || 1;
  const lo = Number.isFinite(min) ? min : -100 * step, hi = Number.isFinite(max) ? max : 100 * step;
  const input = h('input', { type: 'number', class: 'og-num', min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null,
    step, inputmode: 'decimal', 'aria-label': o.label || null });
  const el = h('div', { class: cls('stepper ui-stepper', o) });
  const dp = decimals(step);
  // The box is as wide as its widest value, so it never squeezes and never stretches a bar.
  input.style.setProperty('--ui-num-w', Math.max(String(lo.toFixed(dp)).length, String(hi.toFixed(dp)).length) + 3 + 'ch');
  let value = onGrid(o.value == null ? clamp(0, min, max) : +o.value, min, max, step);
  const show = () => { if (document.activeElement !== input || dragging) input.value = value.toFixed(dp); };
  const commit = (v, e) => {
    v = onGrid(+v, min, max, step);
    if (!Number.isFinite(v)) { input.value = value.toFixed(dp); return; }
    const was = value;
    value = v;
    input.value = v.toFixed(dp);
    if (v !== was && o.onChange) o.onChange(v, e);
  };
  const nudge = (dir, e) => commit(e && e.ctrlKey ? snap(value, e, lo, hi, dir, step) : value + dir * modStep(e, step, lo, hi), e);
  input.addEventListener('change', (e) => commit(input.value.trim() === '' ? value : input.value, e));
  input.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    nudge(d, e);
  });
  if (o.buttons !== false) {
    // Held past HOLD_MS the nudge repeats every REPEAT_MS; the click ending a repeat adds no tick; a move stops it.
    const side = (dir, glyph, title) => {
      const b = h('button', { type: 'button', class: 'ui-step', title, 'aria-label': title, text: glyph });
      let t = 0, repeated = false, at = null;
      const stop = () => { clearTimeout(t); t = 0; };
      b.addEventListener('pointerdown', (e) => {
        stop(); repeated = false; at = { x: e.clientX, y: e.clientY };
        t = setTimeout(function tick() { if (b.disabled || (dir > 0 ? value >= max : value <= min)) return stop(); repeated = true; nudge(dir); t = setTimeout(tick, REPEAT_MS); }, HOLD_MS + 50);
      });
      b.addEventListener('pointermove', (e) => { if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > INTENT_PX) stop(); });
      for (const t2 of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t2, stop);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('click', (e) => { if (repeated) { repeated = false; return; } nudge(dir, e); });
      return b;
    };
    el.append(side(-1, '−', 'Decrease'), input, side(1, '+', 'Increase'));
  } else el.append(input);
  if (o.unit) el.append(h('span', { class: 'unit', text: o.unit }));
  // The box drags sideways: one step per 4 px, a tenth with Shift, Ctrl the decade; a press without a drag types.
  let dragging = false;
  if (o.drag) {
    let r = null;
    input.classList.add('ui-dragnum');
    drag(input, {
      filter: (e) => !input.disabled && document.activeElement !== input,
      onStart(d) { r = { v: value, x: d.clientX, moved: false }; dragging = true; if (d.pointerType === 'mouse') d.preventDefault(); },
      onMove(e) {
        if (Math.abs(e.clientX - r.x) < 3 && !r.moved) return;
        r.moved = true;
        const raw = r.v + ((e.clientX - r.x) / 4) * step * dragGain(e, 1);
        commit(e.ctrlKey ? snap(raw, e, lo, hi, 0, step) : raw, e);
      },
      onEnd() { dragging = false; if (r && !r.moved) { input.focus(); input.select(); } r = null; },
    });
    input.addEventListener('mousedown', (e) => { if (document.activeElement !== input) e.preventDefault(); });
  }
  def(el, {
    value: { get: () => value, set(v) { value = onGrid(+v, min, max, step); show(); } },
    disabled: { get: () => input.disabled, set(v) { input.disabled = !!v; el.querySelectorAll('.ui-step').forEach((b) => { b.disabled = !!v; }); } },
    input: { value: input },
  });
  input.value = value.toFixed(dp);
  el.disabled = o.disabled;
  return el;
}

export function select(o = {}) {
  check('select', o, ['options', 'value', 'label', 'disabled', 'onChange']);
  const el = h('select', { class: cls('ui-select', o), 'aria-label': o.label || null });
  const build = (list) => el.replaceChildren(...(list || []).map((x) => h('option', { value: x.value, text: x.label ?? x.value })));
  build(o.options);
  el.addEventListener('change', (e) => { if (o.onChange) o.onChange(el.value, e); });
  def(el, { options: { get: () => [...el.options].map((x) => x.value), set: build } });
  if (o.value != null) el.value = String(o.value);
  el.disabled = !!o.disabled;
  return el;
}

export function text(o = {}) {
  check('text', o, ['type', 'value', 'placeholder', 'label', 'disabled', 'onInput', 'onChange']);
  const type = o.type || 'text';
  if (!['text', 'search', 'url', 'password'].includes(type)) throw new Error('ui.text: type is text, search, url or password');
  const el = h('input', { type, class: cls('value-input ui-text', o), placeholder: o.placeholder || null, 'aria-label': o.label || null,
    spellcheck: type === 'text' ? null : 'false', autocomplete: 'off' });
  el.value = o.value == null ? '' : String(o.value);
  el.disabled = !!o.disabled;
  el.addEventListener('input', (e) => { if (o.onInput) o.onInput(el.value, e); });
  el.addEventListener('change', (e) => { if (o.onChange) o.onChange(el.value, e); });
  return el;
}

// ---- layout ------------------------------------------------------------------------

/**
 * The page root (data-layout: the host leaves its layout alone). `fill`: it
 * fills to the window's bottom on the phone class too, where the host fills
 * nothing (docs/PLUGINS.md, fill), the shell's pinned footer included.
 */
export function page(o = {}) {
  check('page', o, ['main', 'aside', 'fill']);
  const main = h('div', { class: 'ui-page-main' }, o.main || []);
  const aside = h('div', { class: 'ui-page-aside' }, o.aside || []);
  const el = h('div', { class: cls('ui-page', o), 'data-layout': '', 'data-fill': !!o.fill }, main, o.aside ? aside : null);
  if (o.fill) {
    watchFull();
    let fit = () => {
      if (!el.isConnected) return;
      // The shell sizes a page in its fullscreen; the host fills the desktop (docs/PLUGINS.md, fill).
      if (!phone() || pageFull) { el.style.height = ''; return; }
      let top = el.getBoundingClientRect().top;
      for (let e = el.parentElement; e; e = e.parentElement) top += e.scrollTop;
      const room = innerHeight - top - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--foot-strip-h')) || 0)
        - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-foot-reserve')) || 0);
      el.style.height = Math.max(remPx() * 20, room) + 'px';
    };
    let seen = false;
    const ro = new ResizeObserver(() => { if (el.isConnected) { seen = true; fit(); } else if (seen) ro.disconnect(); });
    const fit0 = fit;
    // What the pane's padding and the pinned footer still push past the window comes off once more.
    fit = () => {
      fit0();
      const s = document.scrollingElement, over = el.style.height && s ? s.scrollHeight - s.clientHeight : 0;
      if (over > 0) el.style.height = Math.max(remPx() * 20, parseFloat(el.style.height) - over) + 'px';
    };
    ro.observe(document.documentElement);
    winOn(el, 'resize', fit);
    winOn(el, 'phosphor-page-fullscreen-change', () => requestAnimationFrame(fit));
    requestAnimationFrame(() => { seen = el.isConnected; fit(); });
  }
  return def(el, {
    main: { value: main },
    aside: { value: aside },
    asideOpen: { get: () => !el.hasAttribute('data-aside-shut'), set(v) { el.toggleAttribute('data-aside-shut', !v); } },
  });
}

export function card(o = {}) {
  check('card', o, ['index', 'title', 'actions', 'caret', 'open', 'onToggle']);
  const t = h('h3', { class: 'dash-title ui-card-t' });
  const act = h('span', { class: 'ui-card-act' }, o.actions || []);
  let lead = t, caret = null;
  if (o.caret) {
    caret = h('button', { type: 'button', class: 'ui-caret', 'aria-expanded': 'true' }, icon('caret'), t);
    lead = caret;
  }
  const head = h('div', { class: 'ui-card-head' }, lead, act);
  const body = h('div', { class: 'ui-card-body' });
  const el = h('section', { class: cls('surface-card ui-card', o) }, head, body);
  const setOpen = (v) => { el.toggleAttribute('data-shut', !v); if (caret) caret.setAttribute('aria-expanded', String(!!v)); };
  if (caret) caret.addEventListener('click', (e) => { const v = el.hasAttribute('data-shut'); setOpen(v); if (o.onToggle) o.onToggle(v, e); });
  // `title` is the card's heading here, never a tooltip.
  def(el, {
    body: { value: body },
    head: { value: head },
    actions: { value: act },
    title: { get: () => t.textContent, set(v) { setText(t, v); attr(el, 'aria-label', v || null); } },
    index: { get: () => t.dataset.pidx || '', set(v) { if (v == null || v === '') delete t.dataset.pidx; else t.dataset.pidx = String(v); } },
    open: { get: () => !el.hasAttribute('data-shut'), set: setOpen },
  });
  el.title = o.title || '';
  el.index = o.index;
  setOpen(o.open !== false);
  return el;
}

/** The settings rows' grid: label | control | chip. */
export function rows(o = {}) {
  check('rows', o, ['title']);
  return h('div', { class: cls('ui-rows', o), role: 'group', 'aria-label': o.title || null }, o.title ? h('h4', { class: 'card-sub', text: o.title }) : null);
}

let rowSeq = 0;
export function row(o = {}) {
  check('row', o, ['label', 'control', 'chip', 'tip']);
  const lab = h('label', { class: 'field-label', title: o.tip || null }, h('span', { class: 'field-label-text', text: o.label || '' }));
  const c = o.control;
  const target = c && (c.matches('input, select, textarea') ? c : c.querySelector('input:not([type=file]), select, textarea'));
  if (target) {
    if (!target.id) target.id = 'ui-f' + ++rowSeq;
    lab.htmlFor = target.id;
    if (!target.getAttribute('aria-label')) target.setAttribute('aria-label', o.label || '');
  }
  const chip = o.chip === undefined ? (c && c.chip) || null : o.chip;
  return h('div', { class: cls('ui-row', o), title: o.tip || null }, lab, c, chip);
}

/**
 * left | center | right in one row while it fits; else center takes its own row
 * above; else the `drop` elements leave in order. A target never shrinks.
 */
export function bar(o = {}) {
  check('bar', o, ['left', 'center', 'right', 'drop']);
  const L = h('div', { class: 'ui-bar-l' }, o.left || []);
  const C = h('div', { class: 'ui-bar-c' }, o.center || []);
  const R = h('div', { class: 'ui-bar-r' }, o.right || []);
  const el = h('div', { class: cls('ui-bar', o), 'data-rows': '1' }, L, C, R);
  const drop = [...(o.drop || [])];
  let lastW = -1;
  const fit = (force) => {
    const W = el.clientWidth;
    if (!W || (W === lastW && force !== true)) return;
    lastW = W;
    for (const d of drop) d.classList.remove('ui-dropped');
    el.dataset.rows = '1';
    const cs = getComputedStyle(el), gap = parseFloat(cs.columnGap) || 0;
    const cMin = C.childElementCount ? parseFloat(cs.getPropertyValue('--bar-center-min')) * (cs.getPropertyValue('--bar-center-min').trim().endsWith('rem') ? remPx() : 1) || 0 : 0;
    if (L.scrollWidth + R.scrollWidth + cMin + 2 * gap <= W) return;
    if (C.childElementCount) el.dataset.rows = '2';
    for (const d of drop) {
      if (L.scrollWidth + R.scrollWidth + gap <= W) break;
      d.classList.add('ui-dropped');
    }
  };
  const ro = new ResizeObserver(() => fit());
  ro.observe(el);
  return def(el, { left: { value: L }, center: { value: C }, right: { value: R }, refit: { value: () => fit(true) } });
}

/**
 * The media region: a letterboxed box at the content's aspect, a media slot, an
 * empty slot, the center glyph, an overlay that hides when idle, a dock shown
 * while it hides, and the shell's bare page fullscreen.
 */
export function stage(o = {}) {
  check('stage', o, ['aspect', 'overlay', 'rotate', 'onTap', 'onDouble', 'onFullscreen']);
  if (o.overlay != null && !['fullscreen', 'always'].includes(o.overlay)) throw new Error('ui.stage: overlay is "fullscreen" or "always"');
  const media = h('div', { class: 'ui-stage-media' });
  const empty = h('div', { class: 'ui-stage-empty' });
  const center = h('div', { class: 'ui-stage-center', 'aria-hidden': 'true' }, icon('play'));
  const dock = h('div', { class: 'ui-stage-dock' });
  const overlay = h('div', { class: 'ui-stage-overlay' });
  const box = h('div', { class: 'ui-stage-box' }, media, empty, center, dock, overlay);
  const el = h('div', { class: cls('ui-stage', o), 'data-overlay': o.overlay || 'fullscreen' }, box);
  let aspect = null, full = false, idle = 0, tapShow = false;
  const live = () => full || el.dataset.overlay === 'always';
  const hide = () => { if (!overlay.matches(':hover, :focus-within') && !overlay.querySelector('[data-drag]')) el.removeAttribute('data-show'); };
  const poke = () => { el.setAttribute('data-show', ''); clearTimeout(idle); idle = setTimeout(hide, IDLE_MS); };
  el.addEventListener('pointermove', poke);
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !overlay.querySelector('[data-drag]')) { clearTimeout(idle); el.removeAttribute('data-show'); } });
  // A touch on a hidden overlay only wakes it: no tap.
  el.addEventListener('pointerdown', (e) => { tapShow = live() && e.pointerType !== 'mouse' && !el.hasAttribute('data-show'); poke(); }, true);
  const own = (e) => box.contains(e.target) && !overlay.contains(e.target) && !e.target.closest('button, input, select, textarea, a, [role=slider], [role=separator]');
  gestures(el, {
    filter: (e) => { const ok = own(e) && !(e.type === 'click' && tapShow); if (e.type === 'click') tapShow = false; return ok; },
    tap: (e) => { if (o.onTap) o.onTap(e); },
    double: (e) => { if (o.onDouble) o.onDouble(e); else el.fullscreen = !full; },
  });
  const setFull = (on) => {
    if (on === full) return;
    full = on;
    el.toggleAttribute('data-full', on);
    if (!on) el.removeAttribute('data-show');
    if (o.onFullscreen) o.onFullscreen(on);
  };
  const ask = (on) => {
    const ev = new CustomEvent('phosphor-page-fullscreen', { bubbles: true, cancelable: true, detail: { on, bare: true } });
    if (!el.dispatchEvent(ev)) setFull(on);
  };
  winOn(el, 'phosphor-page-fullscreen-change', (e) => { if (full && !(e.detail && e.detail.on)) setFull(false); });
  if (o.rotate) {
    // The phone class: a turn to landscape with content enters fullscreen, the turn back leaves; only a turn does.
    const orient = () => (innerWidth > innerHeight ? 'land' : 'port');
    let was = orient();
    winOn(el, 'resize', () => {
      const now = orient();
      if (now === was) return;
      was = now;
      if (!phone()) return;
      if (now === 'land' && !full && aspect) ask(true);
      else if (now === 'port' && full) ask(false);
    });
  }
  center.addEventListener('animationend', () => center.removeAttribute('data-flash'));
  return def(el, {
    box: { value: box },
    media: { value: media },
    empty: { value: empty },
    overlay: { value: overlay },
    dock: { value: dock },
    aspect: {
      get: () => aspect,
      set(a) { aspect = a > 0 ? +a : null; el.toggleAttribute('data-ar', !!aspect); if (aspect) el.style.setProperty('--ui-ar', String(aspect)); else el.style.removeProperty('--ui-ar'); },
    },
    fullscreen: { get: () => full, set(v) { if (!!v !== full) ask(!!v); } },
    // A flash in flight keeps its glyph; the resting one takes over when it ends.
    center: { value: (x) => { el.toggleAttribute('data-center', !!x); if (x && !center.hasAttribute('data-flash')) setIcon(center.firstChild, x); } },
    flash: {
      value: (x) => {
        setIcon(center.firstChild, x);
        center.removeAttribute('data-flash');
        void center.offsetWidth;
        center.setAttribute('data-flash', '');
      },
    },
    poke: { value: poke },
  });
}

/** A seek bar: buffered and played spans, the hover readout, a drag, the arrows. */
export function scrub(o = {}) {
  check('scrub', o, ['max', 'value', 'buffered', 'label', 'format', 'step', 'onSeek']);
  const buf = h('i', { class: 'ui-scrub-buf' }), played = h('i', { class: 'ui-scrub-played' });
  const track = h('div', { class: 'ui-scrub-track' }, buf, played);
  const tip = h('span', { class: 'ui-scrub-tip', hidden: true });
  const el = h('div', { class: cls('ui-scrub', o), role: 'slider', tabindex: '0', 'aria-label': o.label || null, 'aria-valuemin': '0' }, track, tip);
  const fmt = o.format || ((v) => String(Math.round(v)));
  let max = +o.max || 0, value = +o.value || 0, buffered = +o.buffered || 0;
  const pct = (v) => (max > 0 ? clamp(v / max, 0, 1) * 100 : 0) + '%';
  const draw = () => {
    played.style.width = pct(value);
    buf.style.width = pct(buffered);
    attr(el, 'aria-valuemax', String(Math.round(max)));
    attr(el, 'aria-valuenow', String(Math.round(value)));
    attr(el, 'aria-valuetext', fmt(value));
  };
  const at = (x) => { const r = track.getBoundingClientRect(); return r.width ? clamp((x - r.left) / r.width, 0, 1) * max : 0; };
  const seek = (v, phase, e) => { value = clamp(v, 0, max); draw(); if (o.onSeek) o.onSeek(value, phase, e); };
  drag(el, {
    filter: () => max > 0,
    onStart(d, e) { el.focus({ preventScroll: true }); seek(at(e.clientX), 'start', e); },
    onMove(e) { seek(at(e.clientX), 'move', e); },
    onEnd(e, ok) { if (ok) seek(value, 'end', e); },
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !max) return;
    const r = track.getBoundingClientRect();
    tip.hidden = false;
    setText(tip, fmt(at(e.clientX)));
    const w2 = tip.offsetWidth / 2;
    tip.style.left = clamp(e.clientX - r.left, w2, r.width - w2) + 'px';
  });
  el.addEventListener('pointerleave', () => { if (!el.hasAttribute('data-drag')) tip.hidden = true; });
  el.addEventListener('keydown', (e) => {
    const st = +o.step || max / 100;
    const v = { ArrowLeft: value - st, ArrowRight: value + st, Home: 0, End: max }[e.key];
    if (v == null || !max) return;
    e.preventDefault();
    seek(v, 'end', e);
  });
  def(el, {
    value: { get: () => value, set(v) { if (!el.hasAttribute('data-drag')) { value = +v || 0; draw(); } } },
    max: { get: () => max, set(v) { max = +v || 0; draw(); } },
    buffered: { get: () => buffered, set(v) { buffered = +v || 0; draw(); } },
    track: { value: track },
  });
  draw();
  return el;
}

/** A horizontal resize bar for the region after it: onChange(px, commit); a double-click asks for null. */
export function split(o = {}) {
  check('split', o, ['min', 'max', 'value', 'label', 'size', 'onChange']);
  const min = +o.min || 0, max = +o.max || Infinity;
  const el = h('div', { class: cls('ui-split', o), role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', 'aria-label': o.label || null,
    'aria-valuemin': min, 'aria-valuemax': Number.isFinite(max) ? max : null });
  let value = o.value ?? null, d0 = null;
  const size = () => (value != null ? value : o.size ? o.size() : min);
  const set = (px, commit) => { value = Math.round(clamp(px, min, max)); attr(el, 'aria-valuenow', String(value)); if (o.onChange) o.onChange(value, commit); };
  drag(el, {
    axis: 'y',
    onStart(d) { d0 = { y: d.clientY, v: size() }; },
    onMove(e) { set(d0.v - (e.clientY - d0.y), false); },
    onEnd(e, ok) { if (ok && value != null) set(value, true); },
  });
  el.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    set(size() + d * (e.shiftKey ? 1 : 8), true);
  });
  el.addEventListener('dblclick', () => { value = null; el.removeAttribute('aria-valuenow'); if (o.onChange) o.onChange(null, true); });
  return def(el, { value: { get: () => value, set(v) { value = v == null ? null : +v; attr(el, 'aria-valuenow', value == null ? null : String(value)); } } });
}

/**
 * The settings surface: an overlay in the top layer (the bottom sheet, the
 * right drawer, a popover under its anchor) or a card in the plugin's slot.
 * Auto: the drawer in page fullscreen, the sheet on a phone upright, else the
 * slot when one is given, else the drawer; it follows a turn or a fullscreen
 * while open. An overlay closes on Escape, its close button, a drag down (the
 * sheet) and a tap outside, which is swallowed (outside()); the slot card on
 * its close button.
 */
export function sheet(o = {}) {
  check('sheet', o, ['title', 'index', 'form', 'anchor', 'slot', 'onClose']);
  if (o.form != null && !['auto', 'sheet', 'drawer', 'popover', 'slot'].includes(o.form)) throw new Error('ui.sheet: form is auto, sheet, drawer, popover or slot');
  if (o.form === 'popover' && !o.anchor) throw new Error('ui.sheet: a popover needs its anchor');
  if (o.form === 'slot' && !o.slot) throw new Error('ui.sheet: the slot form needs its slot');
  watchFull();
  let anchor = o.anchor || null;
  const t = h('h3', { class: 'dash-title ui-sheet-t', text: o.title || '' });
  if (o.index) t.dataset.pidx = String(o.index);
  const x = button({ icon: 'close', title: 'Close', class: 'ui-sheet-x' });
  const head = h('div', { class: 'ui-sheet-head' }, t, x);
  const grab = h('div', { class: 'ui-sheet-grab', 'aria-hidden': 'true' });
  const body = h('div', { class: 'ui-sheet-body' });
  const el = h('div', { class: cls('ui-sheet surface-card', o), popover: 'manual', role: o.form === 'popover' ? 'menu' : 'dialog', 'aria-label': o.title || null },
    grab, head, body);
  let form = '', open = false, off = null, borrowed = false;
  const isOpen = () => open;
  const resolve = () => (o.form && o.form !== 'auto' ? o.form
    : pageFull ? 'drawer' : phone() && innerHeight >= innerWidth ? 'sheet' : o.slot ? 'slot' : 'drawer');
  const place = () => {
    if (form !== 'popover') { el.style.top = el.style.left = ''; return; }
    const r = anchor.getBoundingClientRect(), top0 = Math.max(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 0, 0);
    const room = innerHeight - r.bottom, up = room < el.offsetHeight + 8 && r.top - top0 > room;
    el.style.top = Math.max(top0 + 4, up ? r.top - el.offsetHeight - 4 : r.bottom + 4) + 'px';
    el.style.left = clamp(r.right - el.offsetWidth, 8, innerWidth - el.offsetWidth - 8) + 'px';
  };
  const onKey = (e) => { if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); close(e); } };
  const show = () => {
    if (open) return;
    open = true;
    form = resolve();
    el.dataset.form = form;
    el.setAttribute('data-open', '');
    if (form === 'slot') {
      el.removeAttribute('popover');
      el.setAttribute('role', 'region');
      if (el.parentElement !== o.slot) o.slot.append(el);
    } else {
      if (!el.isConnected) { document.body.append(el); borrowed = true; }
      el.setAttribute('popover', 'manual');
      el.setAttribute('role', form === 'popover' ? 'menu' : 'dialog');
      if (el.showPopover && !el.matches(':popover-open')) el.showPopover();
      place();
      off = outside(el, (e) => close(e), anchor ? [anchor] : []);
      document.addEventListener('keydown', onKey, true);
    }
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
  };
  const hide = () => {
    if (!open) return;
    open = false;
    if (off) off();
    off = null;
    document.removeEventListener('keydown', onKey, true);
    if (el.hidePopover && el.matches(':popover-open')) el.hidePopover();
    el.removeAttribute('data-open');
    el.style.translate = '';
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    if (borrowed) { el.remove(); borrowed = false; }
  };
  // Auto follows a turn or a fullscreen while open: the content moves with the element, nothing remounts.
  const follow = () => { if (open && (!o.form || o.form === 'auto') && resolve() !== form) { hide(); show(); } };
  winOn(el, 'resize', follow);
  winOn(el, 'phosphor-page-fullscreen-change', () => requestAnimationFrame(follow));
  const close = (e) => { if (!isOpen()) return; hide(); if (o.onClose) o.onClose(e); };
  x.addEventListener('click', (e) => close(e));
  // A popover menu closes on a pick.
  body.addEventListener('click', (e) => { if (form === 'popover' && e.target.closest('button')) close(e); });
  drag(head, {
    axis: 'y',
    filter: (e) => form === 'sheet' && !e.target.closest('button'),
    onMove(e, dx, dy) { el.style.translate = '0 ' + Math.max(0, dy) + 'px'; if (dy > SHEET_DRAG_CLOSE) close(e); },
    onEnd() { el.style.translate = ''; },
  });
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  return def(el, {
    body: { value: body },
    open: { get: isOpen, set(v) { if (v) show(); else hide(); } },
    form: { get: () => form || resolve() },
    anchor: { get: () => anchor, set(v) { anchor = v || null; if (anchor) anchor.setAttribute('aria-expanded', String(open)); } },
    title: { get: () => t.textContent, set(v) { setText(t, v); attr(el, 'aria-label', v || null); } },
  });
}

/**
 * The page's status: on the phone class, inside a page, the footer's slot
 * (phosphor-page-status, sent on change) and nothing in place; elsewhere a
 * one-line row where the plugin placed it.
 */
export function status(o = {}) {
  check('status', o, []);
  const txt = h('span');
  const el = h('div', { class: cls('foot-status ui-status', o), role: 'status', 'aria-live': 'polite' }, txt);
  let cur = { text: '', tone: null, title: '' }, sent = '', retry = false;
  const draw = () => {
    if (!el.isConnected && !retry) { retry = true; requestAnimationFrame(() => { retry = false; if (el.isConnected) draw(); }); }
    const routed = phone() && !!el.closest('.pane-main.plugin');
    el.toggleAttribute('data-routed', routed);
    setText(txt, cur.text);
    attr(el, 'data-tone', cur.tone || null);
    attr(el, 'title', cur.title || cur.text || null);
    if (!routed) { sent = ''; return; }
    const k = cur.text + '\n' + cur.tone + '\n' + cur.title;
    if (k === sent) return;
    sent = k;
    el.dispatchEvent(new CustomEvent('phosphor-page-status', { bubbles: true,
      detail: { text: cur.text, tone: cur.tone === 'intent' ? null : cur.tone, title: cur.title || cur.text } }));
  };
  winOn(el, 'resize', draw);
  return def(el, {
    set: {
      value: (s = {}) => {
        const tone = ['ok', 'warn', 'intent'].includes(s.tone) ? s.tone : null;
        cur = { text: String(s.text ?? ''), tone, title: s.title == null ? '' : String(s.title) };
        draw();
      },
    },
    text: { get: () => cur.text },
    tone: { get: () => cur.tone },
  });
}

/** The Rail button: shown only while the host offers the quick rail (docs/PLUGINS.md, The quick rail). */
export function quickRail(o = {}) {
  check('quickRail', o, []);
  const b = button({ icon: 'quickRail', title: 'Rail', class: 'ui-quick' + (o.class ? ' ' + o.class : '') });
  b.setAttribute('data-quick-rail-toggle', '');
  b.setAttribute('aria-expanded', 'false');
  b.hidden = !document.documentElement.dataset.quickRail;
  b.addEventListener('click', () => b.dispatchEvent(new CustomEvent('phosphor-quick-rail', { bubbles: true, cancelable: true, detail: { open: 'toggle' } })));
  winOn(b, 'phosphor-quick-rail-change', (e) => {
    const d = e.detail || {};
    b.hidden = !d.available;
    b.setAttribute('aria-expanded', String(!!d.open));
    b.classList.toggle('on', !!d.open);
  });
  return b;
}

/** Columns and rows of W-wide tiles (min..max px) that fit W x H without scrolling, gap px apart; at least one. */
export function fitGrid(W, H, gap = 8, min = 150, max = 300, text = 44) {
  let best = { cols: 1, rows: 1, perPage: 1 };
  for (let cols = 1; cols <= 64; cols++) {
    const tw = (W - gap * (cols - 1)) / cols;
    if (cols > 1 && tw < min) break;
    if (tw > max && (W - gap * cols) / (cols + 1) >= min) continue;
    const rowsN = Math.max(1, Math.floor((H + gap) / (tw * 9 / 16 + text + gap)));
    if (cols * rowsN > best.perPage) best = { cols, rows: rowsN, perPage: cols * rowsN };
  }
  return best;
}

/**
 * Tiles or rows. Paged: as many whole items as fit, onPage(page, perPage) when
 * that changes, and a page foot; else the body scrolls with the recess shades.
 * onMove(from, to): rows drag to reorder (a mouse at once, a touch after a hold).
 */
export function list(o = {}) {
  check('list', o, ['form', 'paged', 'tile', 'count', 'onPage', 'onMove']);
  if (!['grid', 'rows'].includes(o.form || 'grid')) throw new Error('ui.list: form is grid or rows');
  const paged = o.paged !== false;
  const items = h('div', { class: 'ui-list-items', role: 'list' });
  const note = h('p', { class: 'ui-list-note', role: 'status', 'aria-live': 'polite' });
  const body = h('div', { class: 'ui-list-body' }, items, note);
  const prev = button({ icon: 'left', title: 'Previous page', class: 'ui-list-prev' });
  const next = button({ icon: 'right', title: 'Next page', class: 'ui-list-next' });
  const pageOut = h('output', { class: 'ui-list-page' }), countOut = h('output', { class: 'ui-list-count' });
  let form = o.form || 'grid';
  const el = h('div', { class: cls('ui-list', o), 'data-form': form, 'data-paged': paged }, body, h('div', { class: 'ui-list-foot' }, prev, pageOut, next, countOut));
  let page = 1, per = paged ? 0 : Infinity, total = 0, sizing = 0;
  const ask = () => { if (o.onPage && per > 0) o.onPage(page, per); };
  const foot = () => {
    const pages = Math.max(1, Math.ceil(total / (Number.isFinite(per) && per > 0 ? per : Math.max(1, total))));
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    setText(pageOut, paged ? 'page ' + page + ' / ' + pages : '');
    setText(countOut, o.count ? o.count(total) : '');
    return pages;
  };
  const fit = () => {
    if (!paged) return;
    const W = body.clientWidth, H = body.clientHeight;
    if (!W || !H) return;
    const gap = parseFloat(getComputedStyle(items).rowGap) || 0, rem = remPx();
    let f;
    if (form === 'rows') {
      const v = getComputedStyle(el).getPropertyValue('--ui-row-h').trim(), rh = parseFloat(v) * (v.endsWith('rem') ? rem : 1) || 56;
      const n = Math.max(1, Math.floor((H + gap) / (rh + gap)));
      f = { cols: 1, perPage: n };
    } else f = fitGrid(W, H, gap, (o.tile && o.tile.min) || 150, (o.tile && o.tile.max) || 300, TILE_TEXT_REM * rem);
    items.style.gridTemplateColumns = 'repeat(' + f.cols + ', minmax(0, 1fr))';
    if (f.perPage === per) return;
    const first = (page - 1) * (per || f.perPage);
    per = f.perPage;
    page = Math.floor(first / per) + 1;
    ask();
  };
  if (paged) {
    const ro = new ResizeObserver(() => { clearTimeout(sizing); sizing = setTimeout(fit, per ? 120 : 0); });
    ro.observe(body);
  } else {
    scrollshade(body);
    queueMicrotask(ask);
  }
  prev.addEventListener('click', () => { if (page > 1) { page--; foot(); ask(); } });
  next.addEventListener('click', () => { page++; foot(); ask(); });
  items.addEventListener('keydown', (e) => {
    if (e.key === 'PageDown' && !next.disabled) { e.preventDefault(); next.click(); }
    if (e.key === 'PageUp' && !prev.disabled) { e.preventDefault(); prev.click(); }
  });
  const reorder = (it, i) => {
    let to = i;
    const off = Number.isFinite(per) ? (page - 1) * per : 0;
    drag(it, {
      axis: 'y',
      intent: false,
      filter: (e) => !e.target.closest('.ui-tile-act, .ui-tile-act *'),
      onMove(e) {
        const kids = [...items.children];
        const k = kids.findIndex((x) => e.clientY < x.getBoundingClientRect().bottom);
        const at = k < 0 ? kids.length - 1 : k;
        if (at !== to) { kids.forEach((x, j) => x.toggleAttribute('data-over', j === at && at !== i)); to = at; }
      },
      onEnd(e, ok) {
        [...items.children].forEach((x) => x.removeAttribute('data-over'));
        if (!ok || to === i) { to = i; return; }
        // The click a drag ends with is not a pick.
        it.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
        setTimeout(() => o.onMove(off + i, off + to), 0);
      },
    });
  };
  return def(el, {
    show: {
      value: (nodes, t) => {
        total = t == null ? nodes.length : +t;
        items.removeAttribute('aria-busy');
        items.replaceChildren(...nodes);
        if (o.onMove && form === 'rows') nodes.forEach(reorder);
        if (paged && page > foot()) { page = foot(); ask(); }
        foot();
      },
    },
    note: { value: (t, tone = null) => { setText(note, t); attr(note, 'data-tone', tone); } },
    busy: { get: () => items.getAttribute('aria-busy') === 'true', set(v) { attr(items, 'aria-busy', v ? 'true' : null); } },
    page: { get: () => page, set(v) { page = Math.max(1, v | 0); foot(); } },
    perPage: { get: () => per },
    form: {
      get: () => form,
      set(v) {
        if (!['grid', 'rows'].includes(v) || v === form) return;
        form = v;
        el.dataset.form = v;
        if (!paged) return;
        if (v === 'rows') items.style.gridTemplateColumns = '';
        const was = per;
        per = 0;
        fit();
        if (per === 0) per = was;
      },
    },
    refit: { value: () => { per = 0; fit(); } },
  });
}

export function tile(o = {}) {
  check('tile', o, ['image', 'title', 'meta', 'current', 'actions', 'onClick']);
  const shot = h('div', { class: 'ui-tile-shot' });
  if (o.image) {
    const img = h('img', { src: o.image, alt: '', loading: 'lazy', decoding: 'async' });
    img.onerror = () => img.remove();
    shot.append(img);
  }
  const b = h('button', { type: 'button', class: 'ui-tile-b', title: o.title || null }, shot,
    h('div', { class: 'ui-tile-t', text: o.title || '' }), h('div', { class: 'ui-tile-m', text: o.meta || '' }));
  const el = h('div', { class: cls('ui-tile', o), role: 'listitem' }, b, o.actions && o.actions.length ? h('span', { class: 'ui-tile-act' }, o.actions) : null);
  b.addEventListener('click', (e) => { if (o.onClick) o.onClick(e); });
  def(el, {
    current: { get: () => b.getAttribute('aria-current') === 'true', set(v) { b.setAttribute('aria-current', String(!!v)); } },
    button: { value: b },
  });
  el.current = o.current;
  return el;
}

/** The shell's recess shades on a scroller of the plugin's own (DESIGN 10.3). -> off() */
export function shade(el) {
  return scrollshade(el).destroy;
}

/** api.ui: one frozen object, shared by every plugin. */
export const KIT = Object.freeze({
  version: VERSION, icons: ICONS, icon,
  button, files, segmented, switch: switchCtl, slider, stepper, select, text,
  page, card, rows, row, bar, stage, scrub, split, sheet, status, quickRail, list, tile,
  outside, gestures, drag, shade,
});
