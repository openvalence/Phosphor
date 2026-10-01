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
 * - A placement entry is {x, y, w, h}, plus `nest` on a nest and an optional
 *   `look` (the control's presentation and per-placement config, DESIGN
 *   §10.2). An entry without `look` is valid and means the derived
 *   presentation on the catalog's bounds, so entries saved before `look`
 *   existed need no migration.
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

  const lookOf = (e) => (e && typeof e === 'object' && e.look ? { look: e.look } : {});
  if (pin && byId.has(pin.id)) {
    const { w, h } = size(pin);
    placed.push({ ...byId.get(pin.id), x: int(pin.x, 0, cols - w, 0), y: int(pin.y, 0, Infinity, 0), w, h, ...lookOf(map[pin.id]) });
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
    const r = { ...it, x: Math.min(x, cols - w), y, w, h, ...lookOf(e) };
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

/** Write placements into `map`; ids not in `placed` are left untouched, a nest keeps its contents, a look stays. */
function write(map, placed) {
  for (const p of placed) {
    const prev = map[p.id];
    const e = { x: p.x, y: p.y, w: p.w, h: p.h };
    if (isNest(prev)) e.nest = prev.nest;
    if (prev && typeof prev === 'object' && prev.look) e.look = prev.look;
    map[p.id] = e;
  }
}

/**
 * Set placement `id`'s look ({pres, min, max, step, default, a, b}, settings.js
 * placementLook), or clear it with null or {}. An id with no entry yet is
 * written at `at` ({x, y, w, h}, where it is drawn now) so it does not move.
 */
export function setLook(map, id, look, at = null) {
  const prev = map[id] && typeof map[id] === 'object' ? map[id]
    : at ? { x: at.x, y: at.y, w: at.w, h: at.h } : {};
  const e = { ...prev };
  const l = look && typeof look === 'object' ? clone(look) : {};
  if (Object.keys(l).length) e.look = l; else delete e.look;
  map[id] = e;
  return true;
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

/**
 * Store shape: { active, layouts: { [name]: { [cls + '.' + viewId]: map } }, modules: { [name]: module } }.
 * Modules (saved nests) belong to no layout and no view.
 */
function emptyStore() {
  return { active: DEFAULT_NAME, layouts: { [DEFAULT_NAME]: {} }, modules: {} };
}
const modulesOf = (s) => (s && s.modules && typeof s.modules === 'object' && !Array.isArray(s.modules) ? s.modules : {});

// A key deleted from a Svelte $state proxy stays an own property whose value
// reads undefined (svelte 5.56 proxy.js deleteProperty), so presence needs both.
// The value read goes FIRST: on a proxy it subscribes to a missing key, which
// hasOwnProperty does not, so a derived reading a map that does not exist yet
// re-runs when it is created (ph-e82.10).
const own = (o, k) => o[k] !== undefined && Object.prototype.hasOwnProperty.call(o, k);
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
      if (names.length) return { active: names.includes(s.active) ? s.active : names[0], layouts: s.layouts, modules: modulesOf(s) };
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
    return { active: DEFAULT_NAME, layouts: { [DEFAULT_NAME]: seed }, modules: {} };
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

// ---- nests and modules (DESIGN §10.6) ---------------------------------------------
//
// A nest is a placement entry that also carries a subgrid:
//   map['nest:<n>'] = { x, y, w, h, nest: { title, scroll, map: { [memberId]: {x, y, w, h} | null } } }
// The member map's keys ARE the membership; null is a member not yet placed.
// A member the current items lack is inert, exactly as at the top level.

/**
 * ph-e82.1 item 4: single fields placeable anywhere (false) or only inside
 * nests (true). Anywhere by operator ruling 2026-10-01 (DESIGN §10.2): the
 * RFC-080 draft leaves it open (its open question 3), so the builder keeps
 * anywhere until that RFC rules.
 */
export const FIELDS_NESTS_ONLY = false;

/** May a control of `kind` sit at the top level or in a nest? A nest never nests. */
export function placeable(kind, inNest, nestsOnly = FIELDS_NESTS_ONLY) {
  if (kind === 'nest') return !inNest;
  return inNest || !nestsOnly || kind !== 'field';
}

export const NEST_W = 16;
export const NEST_H = 6;

const clone = (o) => JSON.parse(JSON.stringify(o));

export function isNest(e) {
  return !!(e && typeof e === 'object' && e.nest && typeof e.nest === 'object'
    && e.nest.map && typeof e.nest.map === 'object' && !Array.isArray(e.nest.map));
}

/** The nests in one placement map: [{id, title, scroll, keys}], `keys` present or inert. */
export function nestsIn(map) {
  return Object.keys(map).filter((id) => isNest(map[id])).map((id) => {
    const n = map[id].nest;
    return { id, title: typeof n.title === 'string' && n.title.trim() ? n.title : 'Nest', scroll: n.scroll !== false, keys: Object.keys(n.map) };
  });
}

/** Add a nest below everything in `map`; `members` is copied. Returns the new id. */
export function addNest(map, { title = 'Nest', scroll = true, w = NEST_W, h = NEST_H, members = {} } = {}) {
  let i = 1;
  while (own(map, 'nest:' + i)) i++;
  const id = 'nest:' + i;
  const y = Object.values(map).reduce((m, e) => (e && Number.isFinite(e.y) && Number.isFinite(e.h) ? Math.max(m, e.y + e.h) : m), 0);
  map[id] = { x: 0, y, w: int(w, 1, 1000, NEST_W), h: int(h, 1, MAX_H, NEST_H),
    nest: { title: String(title), scroll: scroll !== false, map: clone(members && typeof members === 'object' ? members : {}) } };
  return id;
}

/** Make `key` a member of nest `id`, unplaced. A nest never joins a nest. */
export function nestAdd(map, id, key) {
  if (!isNest(map[id]) || own(map[id].nest.map, key) || /^nest:/.test(key)) return false;
  map[id].nest.map[key] = null;
  return true;
}

/** Drop `key` from nest `id`; a present item returns to the top level. */
export function nestRemove(map, id, key) {
  if (!isNest(map[id]) || !own(map[id].nest.map, key)) return false;
  delete map[id].nest.map[key];
  return true;
}

export function setNest(map, id, { title, scroll } = {}) {
  if (!isNest(map[id])) return false;
  if (typeof title === 'string' && title.trim()) map[id].nest.title = title.trim();
  if (typeof scroll === 'boolean') map[id].nest.scroll = scroll;
  return true;
}

/** Ungroup: present members return to the top level; inert members go with the nest. */
export function removeNest(map, id) {
  if (!isNest(map[id])) return false;
  delete map[id];
  return true;
}

/** Save nest `id` of `map` as a module named `name`; a taken name is refused. */
export function saveModule(store, map, id, name) {
  const n = validName(name) && name.trim();
  if (!store.modules) store.modules = {};
  if (!n || !isNest(map[id]) || own(store.modules, n)) return false;
  const e = map[id];
  store.modules[n] = { title: n, scroll: e.nest.scroll !== false, w: e.w, h: e.h, members: clone(e.nest.map) };
  return true;
}

/** Place module `name` as a new nest in `map`; members `map`'s view lacks stay inert. Returns the id or null. */
export function insertModule(store, map, name) {
  const m = store.modules && own(store.modules, name) ? store.modules[name] : null;
  if (!m || typeof m !== 'object') return null;
  return addNest(map, { title: m.title, scroll: m.scroll, w: m.w, h: m.h, members: m.members });
}

/**
 * Forget the arrangement in `map`, never its content: a nest keeps its size and
 * members and reflows; in a nest's own map (`members` true) every member stays,
 * unplaced.
 */
export function resetMap(map, members = false) {
  for (const k of Object.keys(map)) {
    if (isNest(map[k])) map[k] = { w: map[k].w, h: map[k].h, nest: map[k].nest };
    else if (members) map[k] = null;
    else delete map[k];
  }
}

export function deleteModule(store, name) {
  if (!store.modules || !own(store.modules, name)) return false;
  delete store.modules[name];
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
