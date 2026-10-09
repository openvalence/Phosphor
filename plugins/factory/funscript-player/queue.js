// queue.js -- the play queue (ph-1qs5.9): entries, their stored form, reorder; and the Queue tab's list
// Contract: CONTRACT.md, module player-ui; design: docs/plugins/FUNSCRIPT.md, Queue and Autoplay.
//
// Constraints:
// - No DOM at import time (node imports this module); toStored, fromStored and move are pure.
// - The stored queue never holds the Stash key: a Stash scene's URLs are stored without apikey and take the key in
//   force when read back (stash.js withKey). A local file is stored by name only: a File cannot be stored, so after
//   a launch its row reads Reopen until Open video is given a file of that name.
// - The list pages, never scrolls (D19): as many rows as fit, ROW_H high (library.js's row form).
// - Reorder is a drag on the row (a mouse at once, a touch after a LONG_PRESS_MS hold so the page can scroll).

import { withKey } from './stash.js';
import { ROW_H } from './library.js';

export const COPY = Object.freeze({
  queue: 'Queue',
  add: 'Add to queue',
  playNext: 'Play next',
  remove: 'Remove',
  reopen: 'Reopen',
  empty: 'Queue empty',
  autoplay: 'Autoplay',
  autoplayTip: 'Play the next queued scene at the end',
  prev: 'Previous page',
  next: 'Next page',
  page: 'page ',
});
export const LONG_PRESS_MS = 400;

const unkey = (u) => (typeof u === 'string' ? u.replace(/([?&])apikey=[^&#]*&?/i, '$1').replace(/[?&]$/, '') : u);

/** An entry's stored form: a Stash scene without its key, a local file by name. */
export function toStored(e) {
  if (e.kind === 'file') return { kind: 'file', key: e.key, title: e.title, name: e.name, durationMs: e.durationMs ?? null };
  const s = e.scene;
  return { kind: 'stash', scene: { ...s, stream: unkey(s.stream), screenshot: unkey(s.screenshot) } };
}

/** An entry from its stored form under the Stash key in force; a file entry has no files until reopened. */
export function fromStored(s, key = '') {
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'file' && s.name) return { kind: 'file', key: String(s.key || 'file:' + s.name), title: String(s.title || s.name), name: String(s.name), durationMs: s.durationMs ?? null, files: null };
  const sc = s.kind === 'stash' && s.scene && s.scene.key && s.scene.stream ? s.scene : null;
  if (!sc) return null;
  return { kind: 'stash', key: sc.key, title: sc.title, durationMs: sc.durationMs ?? null,
    scene: { ...sc, stream: withKey(sc.stream, key), screenshot: sc.screenshot ? withKey(sc.screenshot, key) : sc.screenshot } };
}

/** The list with the item at `from` moved to `to` (both clamped). */
export function move(list, from, to) {
  const out = list.slice(), n = out.length;
  if (from < 0 || from >= n) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(n - 1, to)), 0, x);
  return out;
}

export const CSS = `
.fsp-q { display: grid; grid-template-rows: minmax(0, 1fr) var(--tap); gap: var(--sp-3); height: 100%; min-height: 0; overflow: hidden; }
.fsp-q-list { display: grid; align-content: start; gap: var(--sp-3); min-height: 0; overflow: hidden; }
.fsp-q-row { display: grid; grid-template-columns: calc(var(--fsp-row-h, 56px) * 16 / 9) minmax(0, 1fr) auto auto; grid-template-rows: 1fr 20px 18px 1fr;
  column-gap: var(--sp-3); height: var(--fsp-row-h, 56px); align-items: center; cursor: grab; touch-action: pan-y; user-select: none; }
.fsp-q-row[data-drag] { opacity: .6; cursor: grabbing; }
.fsp-q-row[data-over] { box-shadow: 0 -2px 0 var(--highlight); }
.fsp-q-row .fsp-shot { grid-area: 1 / 1 / 5 / 2; height: var(--fsp-row-h, 56px); }
.fsp-q-row .fsp-t { grid-area: 2 / 2; }
.fsp-q-row .fsp-m { grid-area: 3 / 2; }
.fsp-q-row .og-btn { grid-row: 1 / 5; }
.fsp-q-note { margin: 0; padding: var(--sp-3) 0; color: var(--tx-mut); font-size: .82rem; }
.fsp-q-foot { display: flex; align-items: center; gap: var(--sp-3); }
.fsp-q-foot output { flex: 1 1 auto; text-align: center; font: .74rem var(--mono); color: var(--tx-val); }
.fsp-q-foot .og-btn { width: var(--tap); padding: 0; }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  e.append(...kids);
  return e;
};
const two = (n) => String(n).padStart(2, '0');
const clockText = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + two(s % 60); };

/**
 * The Queue tab's list. q: {list() -> entries, onPlay(i), onNext(i), onRemove(i), onMove(from, to), onReopen(i)}.
 * -> {render(), unmount()}
 */
export function mountQueue(el, q) {
  const list = h('div', { class: 'fsp-q-list', role: 'list', 'aria-label': COPY.queue });
  const prev = h('button', { type: 'button', class: 'og-btn sm', text: '←', title: COPY.prev, 'aria-label': COPY.prev });
  const next = h('button', { type: 'button', class: 'og-btn sm', text: '→', title: COPY.next, 'aria-label': COPY.next });
  const pageOut = h('output');
  const root = h('div', { class: 'fsp-q' }, h('style', { text: CSS }), list, h('div', { class: 'fsp-q-foot' }, prev, pageOut, next));
  el.append(root);
  let page = 1, per = 1, drag = null;
  prev.addEventListener('click', () => { page--; render(); });
  next.addEventListener('click', () => { page++; render(); });

  function row(e, i) {
    const shot = h('div', { class: 'fsp-shot' });
    if (e.scene && e.scene.screenshot) {
      const img = h('img', { src: e.scene.screenshot, alt: '', loading: 'lazy', decoding: 'async' });
      img.onerror = () => img.remove();
      shot.append(img);
    }
    const meta = e.kind === 'file' && !e.files ? COPY.reopen : e.durationMs != null ? clockText(e.durationMs) : '';
    const up = h('button', { type: 'button', class: 'og-btn sm fsp-q-next', text: '↑', title: COPY.playNext, 'aria-label': COPY.playNext });
    const rm = h('button', { type: 'button', class: 'og-btn sm fsp-q-rm', text: '×', title: COPY.remove, 'aria-label': COPY.remove });
    up.disabled = i === 0;
    up.addEventListener('click', () => q.onNext(i));
    rm.addEventListener('click', () => q.onRemove(i));
    const r = h('div', { class: 'fsp-q-row', role: 'listitem', tabindex: '0', title: e.title, 'data-i': String(i) },
      shot, h('div', { class: 'fsp-t', text: e.title }), h('div', { class: 'fsp-m', text: meta }), up, rm);
    r.addEventListener('click', (ev) => { if (ev.target.closest('button') || r.hasAttribute('data-moved')) return; if (e.kind === 'file' && !e.files) q.onReopen(i); else q.onPlay(i); });
    r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') r.click(); });
    // Drag to reorder: a mouse at once, a touch after a long press.
    r.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      const start = () => { drag = { id: ev.pointerId, from: i, to: i, row: r }; r.setAttribute('data-drag', ''); r.setPointerCapture(ev.pointerId); };
      if (ev.pointerType === 'mouse') start();
      else { const t = setTimeout(start, LONG_PRESS_MS); const off = () => clearTimeout(t); r.addEventListener('pointerup', off, { once: true }); r.addEventListener('pointercancel', off, { once: true }); }
    });
    r.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const rows = [...list.children];
      const to = rows.findIndex((x) => ev.clientY < x.getBoundingClientRect().bottom);
      const at = (to < 0 ? rows.length - 1 : to) + (page - 1) * per;
      if (at !== drag.to) { rows.forEach((x) => x.toggleAttribute('data-over', +x.dataset.i === at && at !== drag.from)); drag.to = at; }
    });
    const end = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      r.removeAttribute('data-drag');
      if (d.to !== d.from) { r.setAttribute('data-moved', ''); setTimeout(() => r.removeAttribute('data-moved'), 0); q.onMove(d.from, d.to); }
      else [...list.children].forEach((x) => x.removeAttribute('data-over'));
    };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    return r;
  }

  function render() {
    const items = q.list();
    const gap = parseFloat(getComputedStyle(list).rowGap) || 8;
    per = Math.max(1, Math.floor((list.clientHeight + gap) / (ROW_H + gap)));
    const pages = Math.max(1, Math.ceil(items.length / per));
    page = Math.min(Math.max(1, page), pages);
    const from = (page - 1) * per;
    list.replaceChildren(...(items.length ? items.slice(from, from + per).map((e, k) => row(e, from + k)) : [h('p', { class: 'fsp-q-note', text: COPY.empty })]));
    pageOut.textContent = COPY.page + page + ' / ' + pages;
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
  }
  const ro = new ResizeObserver(() => render());
  ro.observe(list);
  render();
  return { render, unmount() { ro.disconnect(); root.remove(); } };
}
