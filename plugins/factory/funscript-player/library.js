// library.js -- Stash library grid and connect card; the grid pages, never scrolls
// Contract: CONTRACT.md, module stash (ph-smvd.3).
//
// Constraints:
// - No DOM at import time (node imports this module); fitGrid is pure.
// - Fixed geometry: head, body and foot keep their boxes in every state; loading, empty, error and
//   the connect card render inside the body box. Per page is the tiles that fit, never a scroll.
// - Tokens only: highlight is the picked tile and focus, warn an error; no red (law 13).
// - getStash() is read on every refresh and must return the same client until base or key change
//   (the client holds the caches), and a client once a Save stored a base.
// - mountLibrary takes an optional `fetch` (api.net.fetch) for the Test of the connect card it shows
//   in its place. Without it, that Test stores the fields and tests getStash().
// - mountConnect takes an optional `client(v)` that builds the client its Test asks.
// - fitGrid(W, H) is exported for the node test.

import { COPY as STASH_COPY, SORTS, normalizeBase, createStash } from './stash.js';

export const COPY = Object.freeze({
  search: 'Search scenes',
  sort: 'Sort',
  asc: 'Ascending',
  desc: 'Descending',
  open: 'Open files',
  prev: 'Previous page',
  next: 'Next page',
  page: 'page ',
  scenes: ' scenes',
  scene: ' scene',
  loading: 'Loading scenes',
  empty: 'No interactive scenes',
  noMatch: 'No scenes match',
  url: 'Stash URL',
  urlHint: 'http://host:9999',
  key: 'API key',
  keyHint: 'Stash Settings, Security',
  save: 'Save',
  test: 'Test',
  testing: 'Testing',
  saved: 'Saved',
  badUrl: 'not a Stash URL',
  version: 'Stash ',
});

const LIB = { q: '', sort: 'date', direction: 'DESC' };
const GAP = 8;
const TILE_TEXT = 44;   // px under the 16:9 shot: title 20 + meta 18 + two 3 px gaps (CSS .fsp-tile)
const TILE_MIN = 150, TILE_MAX = 300;

export const CSS = `
.fsp-lib { display: grid; grid-template-rows: var(--tap) minmax(0, 1fr) var(--tap); gap: ${GAP}px; height: 100%; min-height: 0; overflow: hidden; }
.fsp-lib [hidden], .fsp-connect [hidden] { display: none !important; }
.fsp-lib-head, .fsp-lib-foot, .fsp-row { display: flex; gap: ${GAP}px; align-items: stretch; min-width: 0; }
.fsp-lib .og-btn, .fsp-connect .og-btn { flex: none; }
.fsp-in { min-width: 0; min-height: var(--tap); box-sizing: border-box; padding: 0 10px; border: 1px solid var(--line-2); border-radius: var(--radius);
  background: var(--bg); color: var(--tx); font: .8rem var(--mono); }
.fsp-in:focus { outline: none; border-color: var(--highlight); }
.fsp-lib-head .fsp-in { flex: 1 1 120px; }
.fsp-lib-open { padding: 0 8px; font-size: .8rem; }
.fsp-lib-head select { flex: 0 1 72px; width: auto; min-height: var(--tap); }
.fsp-dir, .fsp-pg { width: var(--tap); padding: 0; }
.fsp-lib-body { position: relative; min-height: 0; overflow: hidden; }
.fsp-grid { display: grid; gap: ${GAP}px; align-content: start; height: 100%; }
.fsp-grid.busy { opacity: .5; }
.fsp-tile { display: grid; grid-template-rows: auto 20px 18px; gap: 3px; min-width: 0; padding: 0; text-align: left; color: var(--tx); }
.fsp-shot { aspect-ratio: 16 / 9; overflow: hidden; background: var(--bg-sunken); border: 1px solid var(--line); border-radius: var(--radius); box-sizing: border-box; }
.fsp-shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.fsp-tile:hover .fsp-shot { border-color: var(--line-4); }
.fsp-tile[aria-current=true] .fsp-shot { border-color: var(--highlight); box-shadow: 0 0 0 1px var(--highlight); }
.fsp-tile:focus-visible { outline: 2px solid var(--highlight); outline-offset: 2px; }
.fsp-t { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .82rem; line-height: 20px; }
.fsp-m { overflow: hidden; white-space: nowrap; font: .7rem/18px var(--mono); color: var(--tx-mut); }
.fsp-note { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 0 12px; text-align: center;
  font-size: .82rem; color: var(--tx-mut); pointer-events: none; }
.fsp-note[data-tone=warn], .fsp-status[data-tone=warn] { color: var(--warn); }
.fsp-lib-foot output { flex: 1 1 auto; display: grid; place-items: center; font: .74rem var(--mono); color: var(--tx-val); white-space: nowrap; }
.fsp-lib-foot .fsp-n { flex: 0 0 auto; min-width: 9ch; }
.fsp-lib-body .fsp-connect { position: absolute; inset: 0; overflow: hidden; }
.fsp-connect { display: grid; gap: ${GAP}px; align-content: start; max-width: var(--measure); }
.fsp-connect label { display: grid; gap: 4px; font-size: .78rem; color: var(--tx-mut); }
.fsp-status { margin: 0; height: 20px; line-height: 20px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .78rem; color: var(--tx-val); }
.fsp-status[data-tone=ok] { color: var(--reality); }
`;

/** Columns and rows of tiles that fit a W x H box without scrolling; at least one tile. */
export function fitGrid(W, H) {
  let best = { cols: 1, rows: 1, perPage: 1 };
  for (let cols = 1; cols <= 64; cols++) {
    const tw = (W - GAP * (cols - 1)) / cols;
    if (cols > 1 && tw < TILE_MIN) break;
    if (tw > TILE_MAX && (W - GAP * cols) / (cols + 1) >= TILE_MIN) continue;
    const rows = Math.max(1, Math.floor((H + GAP) / (tw * 9 / 16 + TILE_TEXT + GAP)));
    if (cols * rows > best.perPage) best = { cols, rows, perPage: cols * rows };
  }
  return best;
}

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};

// The column scrolls where the card is shorter than the connect form needs; the shell's style.css
// draws the recess from these attributes and hides the scrollbar (src/ui/scrollshade.js is the contract).
function shade(node) {
  const mark = () => {
    node.toggleAttribute('data-shade-top', node.scrollTop > 0);
    node.toggleAttribute('data-shade-bottom', node.scrollTop + node.clientHeight < node.scrollHeight - 1);
  };
  const ro = new ResizeObserver(mark);
  ro.observe(node);
  ro.observe(node.firstElementChild);
  node.setAttribute('data-shade', '');
  node.addEventListener('scroll', mark, { passive: true });
  return () => {
    ro.disconnect();
    node.removeEventListener('scroll', mark);
    for (const a of ['data-shade', 'data-shade-top', 'data-shade-bottom']) node.removeAttribute(a);
  };
}

const two = (n) => String(n).padStart(2, '0');
function clockText(ms) {
  const s = Math.round(ms / 1000), hr = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (hr ? hr + ':' + two(m) : m) + ':' + two(s % 60);
}

/**
 * @param {HTMLElement} el
 * @param {{getStash: () => Object|null, prefs: {get(k), set(k, v)}, onPick(scene), onLocal(files), fetch?: Function}} o
 * @returns {{refresh(): void, step(dir: number): void, canStep(dir: number): boolean, unmount(): void}}
 */
export function mountLibrary(el, { getStash, prefs, onPick, onLocal, fetch: netFetch = null }) {
  const lib = { ...LIB, ...(prefs.get('lib') || {}) };
  let page = 1, perPage = 0, seq = 0, picked = null, list = [], want = 0, typing = 0, sizing = 0, connectOff = null;

  const search = h('input', { class: 'fsp-in', type: 'search', placeholder: COPY.search, 'aria-label': COPY.search });
  search.value = lib.q;
  const sort = h('select', { 'aria-label': COPY.sort }, ...SORTS.map(([v, t]) => h('option', { value: v, text: t })));
  sort.value = lib.sort;
  const dir = h('button', { class: 'og-btn fsp-dir', type: 'button' });
  const file = h('input', { type: 'file', multiple: '', accept: 'video/*,audio/*,.funscript', hidden: '' });
  const open = h('button', { class: 'og-btn fsp-lib-open', type: 'button', text: COPY.open });
  const grid = h('div', { class: 'fsp-grid' });
  const note = h('p', { class: 'fsp-note', role: 'status', 'aria-live': 'polite' });
  const connectBox = h('div', { hidden: '' });
  const body = h('div', { class: 'fsp-lib-body' }, grid, note, connectBox);
  const prev = h('button', { class: 'og-btn fsp-pg', type: 'button', text: '←', title: COPY.prev, 'aria-label': COPY.prev });
  const next = h('button', { class: 'og-btn fsp-pg', type: 'button', text: '→', title: COPY.next, 'aria-label': COPY.next });
  const pageOut = h('output');
  const countOut = h('output', { class: 'fsp-n' });
  const root = h('div', { class: 'fsp-lib' }, h('style', { text: CSS }),
    h('div', { class: 'fsp-lib-head' }, search, sort, dir, open, file),
    body,
    h('div', { class: 'fsp-lib-foot' }, prev, pageOut, next, countOut));
  el.append(root);
  const unshade = shade(el);

  const save = () => prefs.set('lib', { ...lib });
  const say = (text, tone = '') => { note.textContent = text; note.dataset.tone = tone; };
  function showDir() {
    const asc = lib.direction === 'ASC';
    dir.textContent = asc ? '↑' : '↓';
    dir.setAttribute('aria-label', asc ? COPY.asc : COPY.desc);
    dir.title = asc ? COPY.asc : COPY.desc;
  }
  function setControls(on) {
    for (const c of [search, sort, dir]) c.disabled = !on;
    if (!on) { prev.disabled = next.disabled = true; pageOut.textContent = ''; countOut.textContent = ''; }
  }

  function tile(s) {
    const shot = h('div', { class: 'fsp-shot' });
    if (s.screenshot) {
      const img = h('img', { src: s.screenshot, alt: '', loading: 'lazy', decoding: 'async' });
      img.onerror = () => img.remove();
      shot.append(img);
    }
    const meta = [s.durationMs != null ? clockText(s.durationMs) : '', s.speed != null ? String(s.speed) : ''].filter(Boolean).join(' · ');
    const b = h('button', { class: 'fsp-tile', type: 'button', title: s.title, 'aria-current': String(s.key === picked) },
      shot, h('div', { class: 'fsp-t', text: s.title }), h('div', { class: 'fsp-m', text: meta }));
    b.addEventListener('click', () => pickScene(s));
    return b;
  }
  function pickScene(s) {
    picked = s.key;
    [...grid.children].forEach((t, i) => t.setAttribute('aria-current', String(list[i] === s)));
    onPick(s);
  }
  /** The scene dir (+1 next, -1 previous) from the picked one on the loaded page, else across the page buttons. */
  function canStep(dir) {
    const i = list.findIndex((s) => s.key === picked), j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    return !!list[j] || !(dir > 0 ? next : prev).disabled;
  }
  function step(dir) {
    const i = list.findIndex((s) => s.key === picked), j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    if (list[j]) pickScene(list[j]);
    else if (!(dir > 0 ? next : prev).disabled) { want = dir; (dir > 0 ? next : prev).click(); }
  }

  function load() {
    const stash = getStash();
    if (!stash || !perPage) return;
    const my = ++seq;
    grid.classList.add('busy');
    if (!grid.children.length) say(COPY.loading);
    stash.scenes({ q: lib.q, page, perPage, sort: lib.sort, direction: lib.direction }).then((pg) => {
      if (my !== seq) return;
      const pages = Math.max(1, Math.ceil(pg.count / perPage));
      if (page > pages) { page = pages; load(); return; }
      grid.classList.remove('busy');
      list = pg.scenes;
      grid.replaceChildren(...list.map(tile));
      if (want && list.length) { const s = list[want > 0 ? 0 : list.length - 1]; want = 0; pickScene(s); }
      say(pg.scenes.length ? '' : lib.q ? COPY.noMatch : COPY.empty);
      pageOut.textContent = COPY.page + page + ' / ' + pages;
      countOut.textContent = pg.count + (pg.count === 1 ? COPY.scene : COPY.scenes);
      prev.disabled = page <= 1;
      next.disabled = page >= pages;
    }, (e) => {
      if (my !== seq) return;
      grid.classList.remove('busy');
      grid.replaceChildren();
      list = [];
      want = 0;
      say(e.message, 'warn');
      prev.disabled = page <= 1;
      next.disabled = true;
    });
  }

  function refresh() {
    const stash = getStash();
    if (!stash) {
      seq++;
      grid.replaceChildren();
      grid.hidden = true;
      say('');
      setControls(false);
      if (!connectOff) {
        connectBox.hidden = false;
        connectOff = mountConnect(connectBox, {
          api: { prefs }, onSaved: refresh,
          client: (v) => {
            if (netFetch) return createStash({ fetch: netFetch, ...v });
            prefs.set('stash', v);
            return getStash() || createStash({ fetch: null, base: '' });
          },
        });
      }
      return;
    }
    if (connectOff) { connectOff(); connectOff = null; connectBox.replaceChildren(); connectBox.hidden = true; }
    grid.hidden = false;
    setControls(true);
    load();
  }

  function fit() {
    const f = fitGrid(body.clientWidth, body.clientHeight);
    grid.style.gridTemplateColumns = 'repeat(' + f.cols + ', minmax(0, 1fr))';
    if (f.perPage === perPage) return;
    const first = (page - 1) * perPage;
    perPage = f.perPage;
    page = Math.floor(first / perPage) + 1;
    load();
  }
  const ro = new ResizeObserver(() => { clearTimeout(sizing); sizing = setTimeout(fit, perPage ? 120 : 0); });
  ro.observe(body);

  const requery = () => { page = 1; save(); load(); };
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { lib.q = search.value.trim(); requery(); }, 300);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(typing);
    lib.q = search.value.trim();
    requery();
  });
  sort.addEventListener('change', () => { lib.sort = sort.value; requery(); });
  dir.addEventListener('click', () => { lib.direction = lib.direction === 'ASC' ? 'DESC' : 'ASC'; showDir(); requery(); });
  open.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files && file.files.length) onLocal(file.files); file.value = ''; });
  prev.addEventListener('click', () => { if (page > 1) { page--; load(); } });
  next.addEventListener('click', () => { page++; load(); });
  grid.addEventListener('keydown', (e) => {
    if (e.key === 'PageDown' && !next.disabled) { e.preventDefault(); next.click(); }
    if (e.key === 'PageUp' && !prev.disabled) { e.preventDefault(); prev.click(); }
  });

  showDir();
  prev.disabled = next.disabled = true;
  refresh();

  return {
    refresh, step, canStep,
    unmount() {
      seq++;
      clearTimeout(typing);
      clearTimeout(sizing);
      ro.disconnect();
      unshade();
      if (connectOff) connectOff();
      root.remove();
    },
  };
}

/**
 * The Stash URL and API key card, stored in prefs 'stash'.
 * @param {HTMLElement} el
 * @param {{api: {prefs, net?}, onSaved?: (v) => void, client?: (v) => Object}} o
 * @returns {() => void} unmount
 */
export function mountConnect(el, { api, onSaved, client }) {
  const cur = api.prefs.get('stash') || {};
  const url = h('input', { class: 'fsp-in', type: 'url', placeholder: COPY.urlHint, spellcheck: 'false', autocomplete: 'off' });
  url.value = cur.base || '';
  const key = h('input', { class: 'fsp-in', type: 'password', placeholder: COPY.keyHint, autocomplete: 'off' });
  key.value = cur.key || '';
  const saveBtn = h('button', { class: 'og-btn', type: 'button', text: COPY.save });
  const testBtn = h('button', { class: 'og-btn', type: 'button', text: COPY.test });
  const status = h('p', { class: 'fsp-status', role: 'status', 'aria-live': 'polite' });
  const root = h('div', { class: 'fsp-connect' }, h('style', { text: CSS }),
    h('label', {}, COPY.url, url), h('label', {}, COPY.key, key), h('div', { class: 'fsp-row' }, saveBtn, testBtn), status);
  el.append(root);

  let seq = 0;
  const say = (text, tone = '') => { status.textContent = text; status.dataset.tone = tone; };
  const read = () => ({ base: normalizeBase(url.value), key: key.value.trim() });

  saveBtn.addEventListener('click', () => {
    seq++;
    const v = read();
    if (url.value.trim() && !v.base) { say(COPY.badUrl, 'warn'); return; }
    api.prefs.set('stash', v);
    url.value = v.base;
    say(COPY.saved);
    if (onSaved) onSaved(v);
  });
  testBtn.addEventListener('click', () => {
    const v = read();
    if (!v.base) { say(url.value.trim() ? COPY.badUrl : STASH_COPY.notSet, 'warn'); return; }
    const my = ++seq;
    say(COPY.testing);
    let c;
    try { c = client ? client(v) : createStash({ fetch: (u, i) => api.net.fetch(u, i), ...v }); } catch (e) { say(e.message, 'warn'); return; }
    c.version().then(
      (ver) => { if (my === seq) say(COPY.version + (/^v/i.test(ver) ? ver : 'v' + ver), 'ok'); },
      (e) => { if (my === seq) say(e.message, 'warn'); });
  });

  return () => { seq++; root.remove(); };
}
