// queue.js -- the play queue (ph-1qs5.9): entries, their stored form, reorder; and the Queue tab's list
// Contract: CONTRACT.md, module player-ui; design: docs/plugins/FUNSCRIPT.md, Queue and Autoplay.
//
// Constraints:
// - No DOM at import time (node imports this module); toStored, fromStored and move are pure.
// - The stored queue never holds the Stash key: a Stash scene's URLs are stored without apikey and take the key in
//   force when read back (stash.js withKey). A local file is stored by name only: a File cannot be stored, so after
//   a launch its row reads Reopen until Open video is given a file of that name.
// - The kit draws the list, its pager, its rows and their buttons (api.ui list, tile): the list pages, never scrolls
//   (D19), and a row drags to reorder (a mouse at once, a touch after the kit's hold, so the page can scroll).

import { withKey } from './stash.js';

export const COPY = Object.freeze({
  queue: 'Queue',
  add: 'Add to queue',
  playNext: 'Play next',
  remove: 'Remove',
  top: 'Move to top',
  first: 'already first',
  reopen: 'Reopen',
  empty: 'Queue empty',
  autoplay: 'Autoplay',
  autoplayTip: 'Play the next queued scene at the end',
});

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

const two = (n) => String(n).padStart(2, '0');
const clockText = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + two(s % 60); };

/**
 * The Queue tab's list (a kit list in its row form). q: {list() -> entries, onPlay(i), onNext(i), onRemove(i),
 * onMove(from, to), onReopen(i)}; ui: api.ui. -> {render(), unmount()}
 */
export function mountQueue(el, q, ui) {
  const lst = ui.list({ form: 'rows', class: 'fsp-q', onPage: () => render(), onMove: (a, b) => q.onMove(a, b) });
  lst.setAttribute('aria-label', COPY.queue);
  el.append(lst);
  function row(e, i) {
    const meta = e.kind === 'file' && !e.files ? COPY.reopen : e.durationMs != null ? clockText(e.durationMs) : '';
    const up = ui.button({ icon: 'up', title: COPY.playNext, class: 'fsp-q-next', onClick: () => q.onNext(i) });
    up.disabled = i === 0;
    const rm = ui.button({ icon: 'close', title: COPY.remove, class: 'fsp-q-rm', onClick: () => q.onRemove(i) });
    const t = ui.tile({ image: e.scene && e.scene.screenshot, title: e.title, meta, actions: [up, rm], class: 'fsp-q-row',
      onClick: () => (e.kind === 'file' && !e.files ? q.onReopen(i) : q.onPlay(i)) });
    if (ui.menu) ui.menu(t, [{ label: COPY.remove, run: () => q.onRemove(i) },
      { label: COPY.top, disabled: i === 0 ? COPY.first : '', run: () => q.onNext(i) }], { title: e.title });
    return t;
  }
  function render() {
    const items = q.list(), per = lst.perPage;
    if (!(per > 0)) return;
    const pages = Math.max(1, Math.ceil(items.length / per));
    if (lst.page > pages) lst.page = pages;
    const from = (lst.page - 1) * per;
    lst.show(items.slice(from, from + per).map((e, k) => row(e, from + k)), items.length);
    lst.note(items.length ? '' : COPY.empty);
  }
  return { render, unmount() { lst.remove(); } };
}
