// library.js -- the Stash library (a kit list of scene tiles, paged) and the connect card
// Contract: CONTRACT.md, module stash (ph-smvd.3).
//
// Constraints:
// - No DOM at import time (node imports this module).
// - The kit draws every control, the list, its pager and its tiles (api.ui, docs/PLUGINS.md The UI kit); this
//   file holds the Stash wiring and the head row's layout only.
// - Fixed geometry: head, list and pager keep their boxes in every state; loading, empty, error and the connect
//   card render inside the list's box. Per page is the tiles that fit, never a scroll (D19).
// - getStash() is read on every refresh and must return the same client until base or key change (the client
//   holds the caches), and a client once a Save stored a base.
// - mountLibrary takes an optional `fetch` (api.net.fetch) for the Test of the connect card it shows in its
//   place. Without it, that Test stores the fields and tests getStash().
// - mountConnect takes an optional `client(v)` that builds the client its Test asks.

import { COPY as STASH_COPY, SORTS, normalizeBase, createStash } from './stash.js';

export const COPY = Object.freeze({
  search: 'Search',
  stash: 'Stash',
  addQueue: 'Add to queue',
  sort: 'Sort',
  asc: 'Ascending',
  desc: 'Descending',

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

export const CSS = `
.fsp-libv { display: grid; grid-template-rows: var(--tap) minmax(0, 1fr); gap: var(--sp-3); height: 100%; min-height: 0; overflow: hidden; }
.fsp-libv [hidden] { display: none !important; }
.fsp-lib-head { --ui-btn-h: var(--tap); display: flex; gap: var(--sp-2); align-items: stretch; min-width: 0; }
.fsp-lib-head > .ui-text { flex: 1 1 120px; min-width: 9ch; }
.fsp-lib-head > :is(.ui-select, .og-btn) { flex: none; min-height: var(--tap); }
.fsp-libv[data-off] .ui-list-foot { visibility: hidden; }
.fsp-libbody { position: relative; min-height: 0; }
.fsp-libbody > .fsp-connectbox { position: absolute; inset: 0; overflow: hidden; }
.fsp-connect { display: grid; gap: var(--sp-3); align-content: start; max-width: var(--measure); }
.fsp-connect .ui-rows { grid-template-columns: minmax(0, 70px) minmax(0, 1fr) max-content; }
.fsp-row { display: flex; gap: var(--sp-3); }
.fsp-status { margin: 0; height: 20px; line-height: 20px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .78rem; color: var(--tx-val); }
.fsp-status[data-tone=warn] { color: var(--warn-ink); }
.fsp-status[data-tone=ok] { color: var(--reality); }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};

const two = (n) => String(n).padStart(2, '0');
function clockText(ms) {
  const s = Math.round(ms / 1000), hr = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (hr ? hr + ':' + two(m) : m) + ':' + two(s % 60);
}

/**
 * @param {HTMLElement} el
 * @param {{ui, getStash: () => Object|null, prefs: {get(k), set(k, v)}, onPick(scene), fetch?: Function, rows?: () => boolean, onQueue?: Function}} o
 * @returns {{refresh(): void, step(dir: number): void, canStep(dir: number): boolean, fit(): void, unmount(): void}}
 */
export function mountLibrary(el, { ui, getStash, prefs, onPick, fetch: netFetch = null, rows = () => false, onQueue = null }) {
  const lib = { ...LIB, ...(prefs.get('lib') || {}) };
  let seq = 0, picked = null, list = [], want = 0, typing = 0, connectOff = null;

  const requery = () => { grid.page = 1; save(); load(); };
  const search = ui.text({ type: 'search', placeholder: COPY.search, label: COPY.search, value: lib.q,
    onInput: () => { clearTimeout(typing); typing = setTimeout(() => { lib.q = search.value.trim(); requery(); }, 300); } });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(typing); lib.q = search.value.trim(); requery(); } });
  const sort = ui.select({ label: COPY.sort, options: SORTS.map(([value, label]) => ({ value, label })), value: lib.sort,
    onChange: (v) => { lib.sort = v; requery(); } });
  const dir = ui.button({ class: 'fsp-dir', onClick: () => { lib.direction = lib.direction === 'ASC' ? 'DESC' : 'ASC'; showDir(); requery(); } });
  const grid = ui.list({ form: rows() ? 'rows' : 'grid', class: 'fsp-lib', count: (n) => n + (n === 1 ? COPY.scene : COPY.scenes), onPage: () => load() });
  const next = grid.querySelector('.ui-list-next'), prev = grid.querySelector('.ui-list-prev');
  const connectBox = h('div', { class: 'fsp-connectbox', hidden: '' });
  const root = h('div', { class: 'fsp-libv' }, h('style', { text: CSS }), h('div', { class: 'fsp-lib-head' }, search, sort, dir),
    h('div', { class: 'fsp-libbody' }, grid, connectBox));
  el.append(root);
  const unshade = ui.shade(el);

  const save = () => prefs.set('lib', { ...lib });
  function showDir() {
    const asc = lib.direction === 'ASC';
    dir.icon = asc ? 'up' : 'down';
    dir.title = asc ? COPY.asc : COPY.desc;
  }
  function setControls(on) {
    root.toggleAttribute('data-off', !on);
    for (const c of [search, sort, dir]) c.disabled = !on;
  }

  function tile(s) {
    const meta = [s.durationMs != null ? clockText(s.durationMs) : '', s.speed != null ? String(s.speed) : ''].filter(Boolean).join(' · ');
    // ph-1qs5.9: Add to queue, over the tile's shot.
    const add = onQueue ? [ui.button({ label: '+', title: COPY.addQueue, class: 'fsp-qadd', onClick: () => onQueue(s) })] : [];
    const t = ui.tile({ image: s.screenshot, title: s.title, meta, current: s.key === picked, actions: add, class: 'fsp-cell', onClick: () => pickScene(s) });
    t.button.classList.add('fsp-tile');
    return t;
  }
  function pickScene(s) {
    picked = s.key;
    grid.querySelectorAll('.ui-tile').forEach((t, i) => { t.current = list[i] === s; });
    onPick(s);
  }
  /** The scene dir (+1 next, -1 previous) from the picked one on the loaded page, else across the page buttons. */
  function canStep(d) {
    const i = list.findIndex((s) => s.key === picked), j = i < 0 ? (d > 0 ? 0 : list.length - 1) : i + d;
    return !!list[j] || !(d > 0 ? next : prev).disabled;
  }
  function step(d) {
    const i = list.findIndex((s) => s.key === picked), j = i < 0 ? (d > 0 ? 0 : list.length - 1) : i + d;
    if (list[j]) pickScene(list[j]);
    else if (!(d > 0 ? next : prev).disabled) { want = d; (d > 0 ? next : prev).click(); }
  }

  function load() {
    const stash = getStash(), perPage = grid.perPage, page = grid.page;
    if (!stash || !(perPage > 0)) return;
    const my = ++seq;
    grid.busy = true;
    if (!list.length) grid.note(COPY.loading);
    stash.scenes({ q: lib.q, page, perPage, sort: lib.sort, direction: lib.direction }).then((pg) => {
      if (my !== seq) return;
      grid.busy = false;
      list = pg.scenes;
      grid.show(list.map(tile), pg.count);
      if (want && list.length) { const s = list[want > 0 ? 0 : list.length - 1]; want = 0; pickScene(s); }
      grid.note(pg.scenes.length ? '' : lib.q ? COPY.noMatch : COPY.empty);
    }, (e) => {
      if (my !== seq) return;
      grid.busy = false;
      list = [];
      want = 0;
      grid.show([], 0);
      grid.note(e.message, 'warn');
    });
  }

  function refresh() {
    const stash = getStash();
    if (!stash) {
      seq++;
      list = [];
      grid.show([], 0);
      grid.note('');
      grid.hidden = true;
      setControls(false);
      if (!connectOff) {
        connectBox.hidden = false;
        connectOff = mountConnect(connectBox, {
          ui, api: { prefs }, onSaved: refresh,
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

  /** The phone's row form (PR13) or tiles, by the caller's rows(). */
  function fit() { grid.form = rows() ? 'rows' : 'grid'; }

  showDir();
  refresh();

  return {
    refresh, step, canStep, fit,
    unmount() {
      seq++;
      clearTimeout(typing);
      unshade();
      if (connectOff) connectOff();
      root.remove();
    },
  };
}

/**
 * The Stash URL and API key card (the settings rows' form), stored in prefs 'stash'.
 * @param {HTMLElement} el
 * @param {{ui, api: {prefs, net?}, onSaved?: (v) => void, client?: (v) => Object}} o
 * @returns {() => void} unmount
 */
export function mountConnect(el, { ui, api, onSaved, client }) {
  const cur = api.prefs.get('stash') || {};
  const url = ui.text({ type: 'url', placeholder: COPY.urlHint, label: COPY.url, value: cur.base || '' });
  const key = ui.text({ type: 'password', placeholder: COPY.keyHint, label: COPY.key, value: cur.key || '' });
  const saveBtn = ui.button({ label: COPY.save }), testBtn = ui.button({ label: COPY.test });
  const status = h('p', { class: 'fsp-status', role: 'status', 'aria-live': 'polite' });
  const rowsEl = ui.rows({ title: COPY.stash });
  rowsEl.append(ui.row({ label: COPY.url, control: url }), ui.row({ label: COPY.key, control: key }),
    ui.row({ label: '', control: h('div', { class: 'fsp-row' }, saveBtn, testBtn) }));
  const root = h('div', { class: 'fsp-connect' }, h('style', { text: CSS }), rowsEl, status);
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
