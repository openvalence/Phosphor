// library.js -- the Stash library (a kit list of scene rows or tiles, paged) and the connect card
// Contract: CONTRACT.md, module stash (ph-smvd.3); the browser: docs/plugins/FUNSCRIPT.md, Library (ph-0hvq).
//
// Constraints:
// - No DOM at import time (node imports this module).
// - The kit draws every control, the list, its pager and its rows (api.ui, docs/PLUGINS.md The UI kit); this file
//   holds the Stash wiring, the head row's layout, the form choice and the badges in a row's title and meta slots.
// - Fixed geometry: head, list and pager keep their boxes in every state; loading, empty, error and the connect
//   card render inside the list's box. Per page is the rows or tiles that fit, never a scroll (D19).
// - Rows (side by side in columns once the box is wide) unless a tile grid fits three or more across and pages at
//   least GRID_MIN scenes (ph-0hvq). The form follows the list's box only (a resize), never a load, so a page
//   arriving never moves the view.
// - A row is 2.5rem (44.8 px at the default Look); under a coarse pointer the rows, the head row, the pager and the
//   buttons are never under 44 px at any Look (law 12's 40 px floor, and the 44 px the library was ruled).
// - Badges: the scene's state (loaded, queued) beside the title, which yields to it; what the scene carries (V8 V9,
//   Script) after the meta, each whole or not at all.
// - mark() runs on every player render: it touches a row only when that row's badges change.
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
  play: 'Play',
  playNext: 'Play next',
  openStash: 'Open in Stash',
  sort: 'Sort',
  asc: 'Ascending',
  desc: 'Descending',
  scripted: 'Scripted only',
  script: 'Script',
  playing: 'Playing',
  loaded: 'Loaded',
  queued: 'Queued',

  scenes: ' scenes',
  scene: ' scene',
  loading: 'Loading scenes',
  empty: 'No interactive scenes',
  none: 'No scenes',
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

const LIB = { q: '', sort: 'date', direction: 'DESC', scripted: true };
const ROW_MIN_REM = 14, GRID_MIN = 6;
const TILE_MIN = 150, TILE_TEXT_REM = 2.625;   // the kit list's grid defaults (src/plugins/kit.js fitGrid)

export const CSS = `
.fsp-libv { display: grid; grid-template-rows: var(--ui-btn-h) minmax(0, 1fr); gap: var(--sp-3); height: 100%; min-height: 0; overflow: hidden; }
@media (pointer: coarse) { .fsp-libv { --ui-btn-h: max(44px, 2.5rem); } }
.fsp-libv [hidden] { display: none !important; }
.fsp-lib-head { display: flex; gap: var(--sp-2); align-items: stretch; min-width: 0; }
.fsp-lib-head > .ui-text { flex: 1 1 120px; min-width: 6ch; }
.fsp-lib-head > :is(.ui-select, .og-btn) { flex: none; min-height: var(--ui-btn-h); }
.fsp-lib-head > .ui-select { padding-block: 0; }
.fsp-libv .og-btn.sm { min-height: var(--ui-btn-h); }
.fsp-libv[data-off] .ui-list-foot { visibility: hidden; }
.fsp-libbody { position: relative; min-height: 0; }
.fsp-libbody > .fsp-connectbox { position: absolute; inset: 0; overflow: hidden; }
.fsp-lib { --ui-row-h: 2.5rem; }
@media (pointer: coarse) { .fsp-lib { --ui-row-h: max(44px, 2.5rem); } }
.fsp-lib[data-form=rows] .ui-list-items { gap: var(--sp-2) var(--sp-4); }
/* The title and meta lines fill a 2.5rem row only without the kit's row gaps. */
.fsp-lib[data-form=rows] .ui-tile-b { row-gap: 0; }
.fsp-lib :is(.ui-tile-t, .ui-tile-m) { display: flex; align-items: center; gap: var(--sp-2); }
.fsp-tt { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fsp-mt { flex: none; }
.fsp-bdgs { display: flex; gap: var(--sp-1); }
.fsp-st { flex: none; }
/* The zero-width, full-height first item sends a pill that does not fit whole to the hidden second line. */
.fsp-cap { flex: 1 1 0; min-width: 0; flex-wrap: wrap; height: calc(.875rem + 2px); overflow: hidden; }
.fsp-cap::before { content: ''; height: 100%; }
.fsp-bdg { flex: none; padding: 0 var(--sp-2); border: 1px solid var(--line-3); border-radius: var(--r-s); font: 500 .6rem/.875rem var(--font);
  letter-spacing: .04em; text-transform: uppercase; color: var(--tx-val); }
.fsp-bdg[data-k=now] { color: var(--reality); border-color: var(--reality); }
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

/** The list's form for a W x H px body at root font rem px: 'grid' where tiles fit three across and page GRID_MIN. */
export function formFor(W, H, rem = 16) {
  const g = rem / 2, cols = Math.floor((W + g) / (TILE_MIN + g));
  if (cols < 3) return 'rows';
  const tw = (W - g * (cols - 1)) / cols;
  return cols * Math.floor((H + g) / (tw * 9 / 16 + TILE_TEXT_REM * rem + g)) >= GRID_MIN ? 'grid' : 'rows';
}

/**
 * @param {HTMLElement} el
 * @param {{ui, getStash: () => Object|null, prefs: {get(k), set(k, v)}, onPick(scene), fetch?: Function, onQueue?: Function,
 *   onNext?: Function, onOpen?: (scene) => Function|null}} o
 * @returns {{refresh(): void, step(dir: number): void, canStep(dir: number): boolean, mark(m): void, unmount(): void}}
 */
export function mountLibrary(el, { ui, getStash, prefs, onPick, fetch: netFetch = null, onQueue = null, onNext = null, onOpen = null }) {
  const lib = { ...LIB, ...(prefs.get('lib') || {}) };
  let seq = 0, picked = null, list = [], sigs = [], want = 0, typing = 0, connectOff = null;
  let marks = { now: null, playing: false, queued: [] };

  const requery = () => { grid.page = 1; save(); load(); };
  const search = ui.text({ type: 'search', placeholder: COPY.search, label: COPY.search, value: lib.q,
    onInput: () => { clearTimeout(typing); typing = setTimeout(() => { lib.q = search.value.trim(); requery(); }, 300); } });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(typing); lib.q = search.value.trim(); requery(); } });
  const sort = ui.select({ label: COPY.sort, options: SORTS.map(([value, label]) => ({ value, label })), value: lib.sort,
    onChange: (v) => { lib.sort = v; requery(); } });
  const dir = ui.button({ class: 'fsp-dir', onClick: () => { lib.direction = lib.direction === 'ASC' ? 'DESC' : 'ASC'; showDir(); requery(); } });
  const only = ui.button({ icon: 'script', title: COPY.scripted, pressed: lib.scripted !== false, class: 'fsp-only',
    onClick: () => { lib.scripted = only.pressed; requery(); } });
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // row.min is read at each fit: a Look change moves the rem.
  const grid = ui.list({ form: 'rows', row: { get min() { return ROW_MIN_REM * rem(); } }, class: 'fsp-lib', count: (n) => n + (n === 1 ? COPY.scene : COPY.scenes),
    onPage: () => load() });
  const next = grid.querySelector('.ui-list-next'), prev = grid.querySelector('.ui-list-prev');
  const body = grid.querySelector('.ui-list-body');
  const connectBox = h('div', { class: 'fsp-connectbox', hidden: '' });
  const root = h('div', { class: 'fsp-libv' }, h('style', { text: CSS }), h('div', { class: 'fsp-lib-head' }, search, sort, dir, only),
    h('div', { class: 'fsp-libbody' }, grid, connectBox));
  el.append(root);
  const unshade = ui.shade(el);
  // Observed after the kit list's own observer, whose first fit waits a task: the form is set before any page is asked.
  const ro = new ResizeObserver(() => { if (body.clientWidth && body.clientHeight) grid.form = formFor(body.clientWidth, body.clientHeight, rem()); });
  ro.observe(body);

  const save = () => prefs.set('lib', { ...lib });
  function showDir() {
    const asc = lib.direction === 'ASC';
    dir.icon = asc ? 'up' : 'down';
    dir.title = asc ? COPY.asc : COPY.desc;
  }
  function setControls(on) {
    root.toggleAttribute('data-off', !on);
    for (const c of [search, sort, dir, only]) c.disabled = !on;
  }

  function tile(s) {
    // ph-1qs5.9: Add to queue, at the row's end or over the tile's shot.
    const add = onQueue ? [ui.button({ icon: 'plus', title: COPY.addQueue, class: 'fsp-qadd', onClick: () => onQueue(s) })] : [];
    const t = ui.tile({ image: s.screenshot, title: s.title, actions: add, class: 'fsp-cell', onClick: () => pickScene(s) });
    t.button.classList.add('fsp-tile');
    const meta = [s.durationMs != null ? clockText(s.durationMs) : '', s.speed != null ? String(s.speed) : ''].filter(Boolean).join(' · ');
    t.querySelector('.ui-tile-t').replaceChildren(h('span', { class: 'fsp-tt', text: s.title }), h('span', { class: 'fsp-bdgs fsp-st' }));
    t.querySelector('.ui-tile-m').replaceChildren(h('span', { class: 'fsp-mt', text: meta }), h('span', { class: 'fsp-bdgs fsp-cap' }));
    if (ui.menu) ui.menu(t, () => {
      const open = onOpen && onOpen(s);
      return [{ label: COPY.play, run: () => pickScene(s) },
        ...(onNext ? [{ label: COPY.playNext, run: () => onNext(s) }] : []),
        ...(onQueue ? [{ label: COPY.addQueue, run: () => onQueue(s) }] : []),
        ...(open ? [{ label: COPY.openStash, run: open }] : [])];
    }, { title: s.title });
    return t;
  }
  /** [state, carries]: the loaded scene and queued; its oscillator axes and a script. */
  function badges(s) {
    const stash = getStash(), osc = stash && stash.oscOf ? stash.oscOf(s) : null, st = [], cap = [];
    if (s.key === marks.now) st.push(['now', marks.playing ? COPY.playing : COPY.loaded]);
    if (marks.queued.includes(s.key)) st.push(['q', COPY.queued]);
    if (osc && osc.length) cap.push(['osc', osc.join(' ')]);
    if (s.funscript) cap.push(['fs', COPY.script]);
    return [st, cap];
  }
  const pills = (b) => b.map(([k, text]) => h('span', { class: 'fsp-bdg', 'data-k': k, text }));
  function paint() {
    grid.querySelectorAll('.ui-list-items > .ui-tile').forEach((t, i) => {
      const s = list[i];
      if (!s) return;
      const [st, cap] = badges(s), sig = JSON.stringify([st, cap]);
      t.current = s.key === marks.now;
      if (sigs[i] === sig) return;
      sigs[i] = sig;
      t.querySelector('.fsp-st').replaceChildren(...pills(st));
      t.querySelector('.fsp-cap').replaceChildren(...pills(cap));
    });
  }
  function pickScene(s) {
    picked = s.key;
    marks = { ...marks, now: s.key };
    paint();
    onPick(s);
  }
  /** The loaded scene (the player's), the queue's keys and whether it plays: the rows' current look and badges. */
  function mark({ now = null, playing = false, queued = [] } = {}) {
    marks = { now, playing: !!playing, queued };
    if (now && now.startsWith('stash:')) picked = now;
    paint();
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
    stash.scenes({ q: lib.q, page, perPage, sort: lib.sort, direction: lib.direction, scripted: lib.scripted !== false }).then((pg) => {
      if (my !== seq) return;
      grid.busy = false;
      list = pg.scenes;
      sigs = [];
      grid.show(list.map(tile), pg.count);
      paint();
      if (want && list.length) { const s = list[want > 0 ? 0 : list.length - 1]; want = 0; pickScene(s); }
      grid.note(pg.scenes.length ? '' : lib.q ? COPY.noMatch : lib.scripted !== false ? COPY.empty : COPY.none);
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

  showDir();
  refresh();

  return {
    refresh, step, canStep, mark,
    unmount() {
      seq++;
      clearTimeout(typing);
      ro.disconnect();
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
