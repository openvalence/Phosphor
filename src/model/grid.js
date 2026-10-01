/**
 * grid.js -- the builder grid model (DESIGN §10.5, §10.6), pure and
 * device-free. Reactivity and the DOM live in dashboard.svelte.js; this file
 * is plain data so test/grid-model.test.mjs runs it under node.
 *
 * Constraints:
 * - Cells are square and sized in DEVICE px; the CSS edge is device px over
 *   devicePixelRatio. Renderer-class selection (rclass.js) stays in CSS px and
 *   never reads this file.
 * - Placements are keyed on stable item ids (RENDERING §13 law 10), never on
 *   indices. An id the current items lack is never visited and never
 *   deleted: it stays inert in storage and survives every round trip.
 * - The legacy `sd32.dash.*` keys and today's `phosphor.dash.*` maps are
 *   READ to seed the layout named Default, never written or deleted.
 * - Every storage access degrades to in-memory on a throw (private mode,
 *   quota, storage disabled).
 */

/** Default cell edge in device px: the 32 to 40 band of DESIGN §10.5. */
export const CELL_DEVICE_PX = 36;
/** Browser-style scale steps; the control walks these. */
export const SCALE_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** Narrowest viewport the app is laid out for (test/responsive-matrix.mjs). */
export const MIN_VIEWPORT_PX = 320;

/** One old 12-column span in cells: 12 spans = 48 cells, a 1920 px DPR 1 pane. */
export const SPAN_CELLS = 4;
export const DEFAULT_W = 12 * SPAN_CELLS;
export const DEFAULT_H = 1;
const MAX_H = 100;

export const STORE_KEY = 'phosphor.layouts';
export const SCALE_KEY = 'phosphor.scale';
export const DEFAULT_NAME = 'Default';

// ---- cells and scale ---------------------------------------------------------

/** CSS px edge of one cell; device px rounded so edges land on whole pixels. */
export function cellCssPx(devicePx, dpr, scale = 1) {
  return Math.max(1, Math.round(devicePx * scale)) / (dpr > 0 ? dpr : 1);
}

/** Whole cells across `widthCss`; never fewer than one. */
export function cellCount(widthCss, cellCss) {
  return Math.max(1, Math.floor(widthCss / cellCss + 1e-6));
}

/**
 * The scale steps this client may use. A coarse pointer never goes below 1:
 * rem-sized targets (the chip number inputs, about 42 px) sit within 10% of
 * the law-12 floor, which test/responsive-matrix.mjs proves at scale 1 only.
 * Every pointer drops steps that would leave the scaled layout narrower than
 * MIN_VIEWPORT_PX. Scale 1 is always allowed.
 */
export function allowedSteps({ coarse = false, viewportPx = Infinity } = {}) {
  const min = coarse ? 1 : 0;
  const max = viewportPx / MIN_VIEWPORT_PX;
  return SCALE_STEPS.filter((s) => s === 1 || (s >= min && s <= max));
}

/** The allowed step nearest the wanted scale. */
export function clampScale(wanted, steps) {
  const w = Number(wanted);
  if (!Number.isFinite(w)) return 1;
  return steps.reduce((a, s) => (Math.abs(s - w) < Math.abs(a - w) ? s : a), 1);
}

/** The next step up (dir 1) or down (dir -1) from `cur`, or `cur` at an end. */
export function stepScale(cur, dir, steps) {
  const i = steps.indexOf(cur);
  return steps[Math.min(steps.length - 1, Math.max(0, (i < 0 ? steps.indexOf(1) : i) + dir))];
}

// ---- placement -----------------------------------------------------------------

function int(v, lo, hi, dflt) {
  const n = v == null || v === '' ? NaN : Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place `items` ([{id, ...}]) on a `cols`-wide grid from the saved `map`
 * ({[id]: {x, y, w, h}}). Pure: never writes `map`.
 *
 * - `pin` ({id, x, y, w, h}) is placed first, exactly where asked (clamped):
 *   the item under a drag. Everything else yields to it.
 * - Saved items keep their column (clamped to fit), are pushed down past any
 *   collision, then rise while the cell above is free (vertical compaction).
 * - Unsaved items get DEFAULT_W x DEFAULT_H and flow left to right, top to
 *   bottom, below every saved item.
 * Returns [{...item, x, y, w, h}] in reading order (y, then x).
 */
// ponytail: O(n^2 x rows) collision scan, fine for dozens of items; an
// occupancy bitmap if a layout ever holds hundreds.
export function pack(items, map, cols, pin = null) {
  const placed = [];
  const fits = (r) => !placed.some((p) => overlaps(r, p));
  const size = (e) => {
    const w = int(e && e.w, 1, cols, Math.min(DEFAULT_W, cols));
    return { w, h: int(e && e.h, 1, MAX_H, DEFAULT_H) };
  };
  const byId = new Map(items.map((it) => [it.id, it]));

  if (pin && byId.has(pin.id)) {
    const { w, h } = size(pin);
    placed.push({ ...byId.get(pin.id), x: int(pin.x, 0, cols - w, 0), y: int(pin.y, 0, Infinity, 0), w, h });
  }

  const saved = [], fresh = [];
  for (const it of items) {
    if (pin && it.id === pin.id) continue;
    const e = map[it.id];
    if (e && typeof e === 'object') saved.push({ it, e, y: int(e.y, 0, Infinity, 0), x: int(e.x, 0, Infinity, 0) });
    else fresh.push(it);
  }
  saved.sort((a, b) => a.y - b.y || a.x - b.x || (a.it.id < b.it.id ? -1 : 1));
  for (const { it, e, x, y } of saved) {
    const { w, h } = size(e);
    const r = { ...it, x: Math.min(x, cols - w), y, w, h };
    while (!fits(r)) r.y++;
    while (r.y > 0 && fits({ ...r, y: r.y - 1 })) r.y--;
    placed.push(r);
  }

  const floor = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  for (const it of fresh) {
    const { w, h } = size(null);
    let r = null;
    for (let y = floor; !r; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (fits({ x, y, w, h })) { r = { ...it, x, y, w, h }; break; }
      }
    }
    placed.push(r);
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Write placements into `map`; ids not in `placed` are left untouched. */
function write(map, placed) {
  for (const p of placed) map[p.id] = { x: p.x, y: p.y, w: p.w, h: p.h };
}

/** Commit a drag or resize: place with `pin`, compact, write every present item. */
export function commitPin(map, items, cols, pin) {
  const placed = pack(items, map, cols, pin);
  const tmp = {};
  write(tmp, placed);
  write(map, pack(items, tmp, cols));
}

/**
 * Commit a reading order (keyboard reorder, the stacked phone drag): the
 * i-th id takes the i-th current slot's origin, keeping its own size, then the
 * result is compacted. Ids not in `orderedIds` keep their places.
 */
export function commitOrder(map, items, cols, orderedIds) {
  const cur = pack(items, map, cols);
  const own = new Map(cur.map((p) => [p.id, p]));
  const tmp = {};
  for (const p of cur) tmp[p.id] = { x: p.x, y: p.y, w: p.w, h: p.h };
  orderedIds.forEach((id, i) => {
    const o = own.get(id);
    if (o && cur[i]) tmp[id] = { x: cur[i].x, y: cur[i].y, w: o.w, h: o.h };
  });
  write(map, pack(items, tmp, cols));
}

// ---- named layouts ---------------------------------------------------------------

/** Store shape: { active, layouts: { [name]: { [cls + '.' + viewId]: map } } }. */
function emptyStore() {
  return { active: DEFAULT_NAME, layouts: { [DEFAULT_NAME]: {} } };
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const validName = (n) => typeof n === 'string' && n.trim() !== '' && !(n.trim() in Object.prototype);

/** Old {[id]: {span, order}} map -> placements, reading order kept. */
export function migrateSpans(old) {
  const rows = Object.entries(old && typeof old === 'object' ? old : {})
    .filter(([, e]) => e && typeof e === 'object')
    .map(([id, e]) => ({ id, w: int(e.span, 1, 12, 12) * SPAN_CELLS, order: Number.isFinite(e.order) ? e.order : Infinity }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const out = {};
  let x = 0, y = 0;
  for (const r of rows) {
    if (x + r.w > DEFAULT_W) { x = 0; y++; }
    out[r.id] = { x, y, w: r.w, h: DEFAULT_H };
    x += r.w;
  }
  return out;
}

function readJson(storage, key) {
  const raw = storage.getItem(key);
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * Load the layout store, seeding Default from today's `phosphor.dash.<cls>.<view>`
 * maps and the legacy `sd32.dash.<view>` keys when no store exists yet. The
 * legacy key is the `full` class's fallback only, and an existing
 * `phosphor.dash.full.<view>` (even an empty, reset one) wins over it.
 * Nothing is written here.
 */
export function loadStore(storage) {
  try {
    const s = readJson(storage, STORE_KEY);
    if (s && typeof s === 'object' && s.layouts && typeof s.layouts === 'object') {
      const names = Object.keys(s.layouts).filter((n) => validName(n) && s.layouts[n] && typeof s.layouts[n] === 'object');
      if (names.length) return { active: names.includes(s.active) ? s.active : names[0], layouts: s.layouts };
    }
    const seed = {};
    const legacy = {};
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('phosphor.dash.')) {
        const rest = k.slice('phosphor.dash.'.length);
        const dot = rest.indexOf('.');
        if (dot > 0) seed[rest] = migrateSpans(readJson(storage, k));
      } else if (k && k.startsWith('sd32.dash.')) {
        legacy['full.' + k.slice('sd32.dash.'.length)] = k;
      }
    }
    for (const [view, k] of Object.entries(legacy)) if (!own(seed, view)) seed[view] = migrateSpans(readJson(storage, k));
    return { active: DEFAULT_NAME, layouts: { [DEFAULT_NAME]: seed } };
  } catch (e) {
    return emptyStore();
  }
}

export function saveStore(storage, store) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    // The in-memory store still works for this page load.
  }
}

/** The placement map for one view in the active layout; `create` false reads without writing. */
export function viewMap(store, cls, viewId, create = true) {
  const l = store.layouts[store.active];
  const k = cls + '.' + viewId;
  if (own(l, k)) return l[k];
  return create ? (l[k] = {}) : {};
}

export function switchLayout(store, name) {
  if (!own(store.layouts, name)) return false;
  store.active = name;
  return true;
}

/** Copy the active layout under a new name and make it active. */
export function saveLayoutAs(store, name) {
  const n = validName(name) && name.trim();
  if (!n || own(store.layouts, n)) return false;
  store.layouts[n] = JSON.parse(JSON.stringify(store.layouts[store.active]));
  store.active = n;
  return true;
}

export function renameLayout(store, from, to) {
  const n = validName(to) && to.trim();
  if (!n || !own(store.layouts, from) || own(store.layouts, n)) return false;
  store.layouts[n] = store.layouts[from];
  delete store.layouts[from];
  if (store.active === from) store.active = n;
  return true;
}

/** Delete a layout; the last one cannot go. */
export function deleteLayout(store, name) {
  const names = Object.keys(store.layouts);
  if (!own(store.layouts, name) || names.length < 2) return false;
  delete store.layouts[name];
  if (store.active === name) store.active = Object.keys(store.layouts)[0];
  return true;
}

export function loadScale(storage) {
  try {
    const v = Number(storage.getItem(SCALE_KEY));
    return SCALE_STEPS.includes(v) ? v : 1;
  } catch (e) {
    return 1;
  }
}

export function saveScale(storage, scale) {
  try { storage.setItem(SCALE_KEY, String(scale)); } catch (e) { /* in-memory only */ }
}
