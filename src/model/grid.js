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
 * - Placements are absolute (operator ruling 2026-10-02): a card keeps the
 *   rect the user gave it, nothing compacts, a removed card leaves a hole,
 *   and an unplaced card takes the first free rect without moving anyone.
 *   `pack` is the first-run seed's flow only.
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

/** One old 12-column span in cells, for the migration only: a full 12-span card fills the row. */
export const SPAN_CELLS = 4;
const SPAN_ROW = 12 * SPAN_CELLS;
export const DEFAULT_H = 1;
// A bound on stored garbage only, never on a card: rows are cells (ph-29r),
// and a tall module (the advanced generator) at 12 CSS px cells is hundreds.
const MAX_H = 2000;

export const STORE_KEY = 'phosphor.layouts';
export const SCALE_KEY = 'phosphor.scale';
export const DEFAULT_NAME = 'Default';
/** The drag type a palette entry carries onto a grid; its data is the module's stable key. */
export const MODULE_MIME = 'application/x-phosphor-module';

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

/** A map entry with a stored rect; any other item is drawn where pack() puts it. */
export const positioned = (e) => !!(e && typeof e === 'object' && e.y != null);
const sizeOf = (e, cols) => ({ w: int(e && e.w, 1, cols, cols), h: int(e && e.h, 1, MAX_H, DEFAULT_H) });
const lookOf = (e) => (e && typeof e === 'object' && e.look ? { look: e.look } : {});
const hits = (placed, r) => placed.some((p) => overlaps(r, p));
const byReading = (a, b) => a.y - b.y || a.x - b.x;

/**
 * The first-run seed: `items` flow in order (rank), each at the first free
 * rect of its own size around `placed`. An entry with no `w`, or no entry,
 * takes the item's floor width `fit.w(item)` (cells, null before it was
 * measured) and fills the row without one; `h` defaults to DEFAULT_H. place()
 * puts an unplaced item the same way.
 * `fit(item, w, h)` is the item's content height in cells at width `w`, or
 * null before it was ever measured; an unplaced item is never drawn shorter.
 */
// ponytail: O(n^2 x rows) collision scan, fine for dozens of items; an
// occupancy bitmap if a layout ever holds hundreds.
export function pack(items, map, cols, placed = [], fit = null) {
  const seeded = [], fresh = [];
  let from = 0;   // rank order: no card lands in a row above the one before it, or a section header would trail its cards
  for (const it of items) {
    const e = map[it.id];
    const { w: w0, h: h0 } = sizeOf(e, cols);
    const fw = fit && fit.w && !(e && e.w != null) ? fit.w({ ...it, ...lookOf(e) }) : 0;
    const w = fw > 0 ? int(fw, 1, cols, cols) : w0;
    const h = Math.min(MAX_H, Math.max(h0, (fit && fit({ ...it, ...lookOf(e) }, w, h0)) || 0));
    let r = null;
    for (let y = from; !r; y++) {
      for (let x = 0; x + w <= cols && !r; x++) if (!hits(placed, { x, y, w, h })) r = { ...it, x, y, w, h, ...lookOf(e) };
    }
    placed.push(r);
    from = r.y;
    fresh.push(r);
    if (fw > 0) seeded.push(r);
  }
  // No seeded row ends in a gutter (DESIGN §10.5): the card at a row's end stretches to the edge and
  // takes the height of its content at that width (`fit` with the 4th argument true: a measurement made
  // at that width, null until made, then the seed-width height stands). Then the packed cards fall upward
  // in reading order, x and width untouched. `fit` is only ever asked at seed widths or with the flag, so
  // the result never depends on how a card happened to be drawn.
  for (const r of seeded.sort((a, b) => b.x - a.x)) {
    const w = cols - r.x;
    if (w === r.w || hits(placed.filter((q) => q !== r), { x: r.x, y: r.y, w, h: r.h })) continue;
    const e = map[r.id];
    const f = fit && fit({ ...r, ...lookOf(e) }, w, sizeOf(e, cols).h, true);
    const h = f ? Math.min(MAX_H, Math.max(sizeOf(e, cols).h, f)) : r.h;
    if (!hits(placed.filter((q) => q !== r), { x: r.x, y: r.y, w, h: Math.max(h, r.h) })) { r.w = w; r.h = h; }
  }
  for (const r of fresh.sort(byReading)) {
    const others = placed.filter((q) => q !== r);
    while (r.y > 0 && !hits(others, { x: r.x, y: r.y - 1, w: r.w, h: r.h })) r.y--;
  }
  return placed.sort(byReading);
}

/**
 * Place `items` ([{id, ...}]) on a `cols`-wide grid from the saved `map`
 * ({[id]: {x, y, w, h}}). Pure: never writes `map`. Nothing has gravity:
 * - A saved item keeps its rect (x clamped to fit). Only a narrower window
 *   makes two saved rects clash; the later in reading order is drawn at the
 *   first free row below, and its saved rect waits for the wider window.
 * - An unplaced item (no entry, or no position yet) takes the first free rect
 *   of its size (pack).
 * - `pin` ({id, x, y, w, h}, or an array for a group) is the item under a
 *   drag: laid first, exactly where asked (below an earlier pin it clashes
 *   with). Every other item keeps its rect or moves to the first free row
 *   below; only the cards that moved fall back upward, never above their saved
 *   row. Untouched cards keep their rects and the pin's old slot stays a hole.
 * - `fit` sizes an unplaced item's height (pack).
 * Returns [{...item, x, y, w, h}] in reading order (y, then x).
 */
export function place(items, map, cols, pin = null, fit = null) {
  const at = (e, k) => int(e[k], 0, Infinity, 0);
  const byId = new Map(items.map((it) => [it.id, it]));
  const pins = (pin == null ? [] : [].concat(pin)).filter((p) => p && byId.has(p.id));
  const pinned = new Set(pins.map((p) => p.id));
  const saved = items.filter((it) => positioned(map[it.id]))
    .sort((a, b) => at(map[a.id], 'y') - at(map[b.id], 'y') || at(map[a.id], 'x') - at(map[b.id], 'x') || (a.id < b.id ? -1 : 1));
  const flat = [];
  for (const it of saved) {
    const e = map[it.id];
    const { w, h } = sizeOf(e, cols);
    const r = { ...it, x: Math.min(at(e, 'x'), cols - w), y: at(e, 'y'), w, h, ...lookOf(e) };
    while (hits(flat, r)) r.y++;
    flat.push(r);
  }
  pack(items.filter((it) => !positioned(map[it.id])), map, cols, flat, fit);
  if (!pins.length) return flat;
  // The unpinned cards are drawn as they are without the pin; a pin lands on the ones it covers.
  const placed = [];
  for (const p of pins) {
    const { w, h } = sizeOf(p, cols);
    const r = { ...byId.get(p.id), x: int(p.x, 0, cols - w, 0), y: int(p.y, 0, Infinity, 0), w, h, ...lookOf(map[p.id]) };
    while (hits(placed, r)) r.y++;
    placed.push(r);
  }
  const moved = [];
  for (const q of flat.filter((p) => !pinned.has(p.id))) {
    const r = { ...q };
    while (hits(placed, r)) r.y++;
    placed.push(r);
    if (r.y > q.y) moved.push([r, q.y]);
  }
  for (const [r, y0] of moved.sort((a, b) => byReading(a[0], b[0]))) {
    const others = placed.filter((q) => q !== r);
    while (r.y > y0 && !hits(others, { x: r.x, y: r.y - 1, w: r.w, h: r.h })) r.y--;
  }
  return placed.sort(byReading);
}

/** The first item of `placed` other than `id` that rect `r` overlaps, or null: what stops a resize. */
export const blocker = (placed, r, id) => placed.find((q) => q.id !== id && overlaps(r, q)) || null;

/** Smallest card any resize may leave, in cells, when the item declares no minimum of its own. */
export const RESIZE_FLOOR = [2, 1];

/** Whole cells that hold `px` CSS px of measured content; 0 for no measurement. */
export const cellsFor = (px, cell) => (px > 0 ? Math.ceil(px / cell - 1e-6) : 0);

/** The resize floor [w, h]: per dimension, the larger of the static floor and the measured cells. */
export const floorOf = (fixed, measured) => [Math.max(fixed[0], measured[0] || 0), Math.max(fixed[1], measured[1] || 0)];

/**
 * The rect item `id` of `placed` grows to so it is `need` cells wide: east
 * first, then west, one cell at a time, stopping at a neighbor or the grid's
 * edge (a resize never pushes). Null when it is wide enough or cannot grow.
 */
export function growWidth(placed, id, need, cols) {
  const p = placed.find((q) => q.id === id);
  if (!p || p.w >= need) return null;
  const others = placed.filter((q) => q.id !== id);
  let x = p.x, w = p.w;
  while (w < need && x + w < cols && !hits(others, { x, y: p.y, w: w + 1, h: p.h })) w++;
  while (w < need && x > 0 && !hits(others, { x: x - 1, y: p.y, w: w + 1, h: p.h })) { x--; w++; }
  return w > p.w ? { id, x, y: p.y, w, h: p.h } : null;
}

/** growWidth's twin for height: south first, then north, never past a neighbor. */
export function growHeight(placed, id, need) {
  const p = placed.find((q) => q.id === id);
  if (!p || p.h >= need) return null;
  const others = placed.filter((q) => q.id !== id);
  let y = p.y, h = p.h;
  while (h < need && h < MAX_H && !hits(others, { x: p.x, y, w: p.w, h: h + 1 })) h++;
  while (h < need && h < MAX_H && y > 0 && !hits(others, { x: p.x, y: y - 1, w: p.w, h: h + 1 })) { y--; h++; }
  return h > p.h ? { id, x: p.x, y, w: p.w, h } : null;
}

/**
 * Resize `start` ({x, y, w, h}) by dragging `edge` (n, s, e, w or a corner
 * such as 'se') so the cell `c` ({x, y}) becomes that edge's outermost cell.
 * The opposite edges stay put, and an edge drag changes only its own
 * dimension: it stops at the nearest size the floor allows. `min(w, h)`
 * returns the [w, h] floor for a candidate size (it may differ by
 * orientation); RESIZE_FLOOR when absent. Returns {x, y, w, h, refused}:
 * `refused` is true when the floor stopped the drag, so the caller can show
 * the refusal rather than silently clamp.
 */
export function resizeRect(start, edge, c, cols, min = null) {
  const right = start.x + start.w, bottom = start.y + start.h;
  let x = start.x, y = start.y, w = start.w, h = start.h;
  if (edge.includes('e')) w = c.x - x + 1;
  if (edge.includes('w')) w = right - Math.max(0, c.x);
  if (edge.includes('s')) h = c.y - y + 1;
  if (edge.includes('n')) h = bottom - Math.max(0, c.y);
  const floor = (a, b) => (min && min(a, b)) || RESIZE_FLOOR;
  const legal = (a, b) => { const [mw, mh] = floor(a, b); return a >= mw && b >= mh; };
  const capW = edge.includes('w') ? right : cols - x;
  let W = Math.min(capW, Math.max(1, w)), H = Math.min(MAX_H, Math.max(1, h));
  if (!/[ns]/.test(edge)) while (W < capW && !legal(W, H)) W++;
  else if (!/[ew]/.test(edge)) while (H < MAX_H && !legal(W, H)) H++;
  else if (!legal(W, H)) {
    const [mw, mh] = floor(W, H);
    W = Math.min(capW, Math.max(W, mw));
    H = Math.min(MAX_H, Math.max(H, mh));
  }
  if (edge.includes('w')) x = right - W;
  if (edge.includes('n')) y = bottom - H;
  return { x, y, w: W, h: H, refused: W > w || H > h };
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

/**
 * Pins that align or spread the rects of a selection ([{id, x, y, w, h}]):
 * 'left' and 'top' move every edge to the selection's smallest; 'spread'
 * keeps the outermost two and spaces the rest evenly across, in x order.
 * A pin landing on another card moves down (place).
 */
export function arrangePins(rects, how) {
  if (how === 'left') { const x = Math.min(...rects.map((r) => r.x)); return rects.map((r) => ({ ...r, x })); }
  if (how === 'top') { const y = Math.min(...rects.map((r) => r.y)); return rects.map((r) => ({ ...r, y })); }
  const s = [...rects].sort((a, b) => a.x - b.x);
  if (s.length < 3) return s;
  const x0 = s[0].x, end = s[s.length - 1].x + s[s.length - 1].w;
  const gap = (end - x0 - s.reduce((a, r) => a + r.w, 0)) / (s.length - 1);
  let x = x0;
  return s.map((r) => { const o = { ...r, x: Math.round(x) }; x += r.w + gap; return o; });
}

/** The first free instance key for a second placement of `base` (`base#2`, `base#3`...). */
export function instanceKey(taken, base) {
  let n = 2;
  while (taken.has(base + '#' + n)) n++;
  return base + '#' + n;
}
/** The stable id an instance key places (law 10): `base#n` is a second placement of `base`. */
export const baseKey = (k) => k.replace(/#\d+$/, '');

/**
 * Copy entry `from` as `to`, unplaced (the first free rect), size and
 * look kept. A nest is copied whole under the next free nest id when `to` is
 * omitted. Returns the new id, or null.
 */
export function duplicate(map, from, to = null) {
  const e = map[from];
  if (!e || typeof e !== 'object') return null;
  if (!to && isNest(e)) { let i = 1; while (own(map, 'nest:' + i)) i++; to = 'nest:' + i; }
  if (!to || own(map, to)) return null;
  const c = clone(e);
  delete c.x;
  delete c.y;
  if (isNest(c)) c.nest.title = c.nest.title + ' copy';
  map[to] = c;
  return to;
}

/**
 * The pin for a keyboard nudge of `id` within `placed` (a place result): one
 * cell in (dx, dy), or the first free rect past whatever sits there. Null when
 * an edge comes first.
 */
export function nudgePin(placed, id, dx, dy, cols) {
  const p = placed.find((q) => q.id === id);
  if (!p) return null;
  const others = placed.filter((q) => q.id !== id);
  for (let x = p.x + dx, y = p.y + dy; x >= 0 && x + p.w <= cols && y >= 0; x += dx, y += dy) {
    if (!hits(others, { x, y, w: p.w, h: p.h })) return { id, x, y, w: p.w, h: p.h };
  }
  return null;
}

/**
 * Commit a drag or resize: write the pinned items, every card the pin moved
 * and every unplaced item at the rect it is drawn at now, so the commit equals
 * the preview and nothing the user did not touch moves later.
 * With `fit`, an unplaced item never measured is held: entered with no rect
 * (so a host that lists its map's keys still draws it) until its height is
 * known; returns the held ids.
 */
export function commitPin(map, items, cols, pin, fit = null) {
  const ids = new Set([].concat(pin || []).map((p) => p && p.id));
  const held = [];
  const base = ids.size ? new Map(place(items, map, cols, null, fit).map((p) => [p.id, p])) : null;
  write(map, place(items, map, cols, pin, fit).filter((p) => {
    if (ids.has(p.id)) return true;
    if (positioned(map[p.id])) { const b = base && base.get(p.id); return !!b && (b.x !== p.x || b.y !== p.y); }
    if (fit && fit(p, p.w, p.h) == null) { held.push(p.id); map[p.id] = map[p.id] || {}; return false; }
    return true;
  }));
  return held;
}

/**
 * Commit a reading order (the stacked phone drag): the i-th id takes the i-th
 * current slot's origin, keeping its own size; a clash moves the later one
 * down. Ids not in `orderedIds` keep their places.
 */
export function commitOrder(map, items, cols, orderedIds) {
  const cur = place(items, map, cols);
  const own = new Map(cur.map((p) => [p.id, p]));
  const tmp = {};
  for (const p of cur) tmp[p.id] = { x: p.x, y: p.y, w: p.w, h: p.h };
  orderedIds.forEach((id, i) => {
    const o = own.get(id);
    if (o && cur[i]) tmp[id] = { x: cur[i].x, y: cur[i].y, w: o.w, h: o.h };
  });
  write(map, place(items, tmp, cols));
}

// ---- named layouts ---------------------------------------------------------------

/**
 * Store shape: { active, layouts: { [name]: { [cls + '.' + viewId]: map, opts? } }, modules: { [name]: module }, order: [name] }.
 * `order` is the sidebar order; read it only through layoutOrder(), which
 * heals it (Default first and pinned, unknown names dropped, new ones last).
 * Modules (saved nests) belong to no layout and no view. A layout's `opts`
 * ({density}) has no dot, so it never collides with a view key.
 */
function emptyStore() {
  return { active: DEFAULT_NAME, layouts: { [DEFAULT_NAME]: {} }, modules: {}, order: [DEFAULT_NAME] };
}
const modulesOf = (s) => (s && s.modules && typeof s.modules === 'object' && !Array.isArray(s.modules) ? s.modules : {});

// A key deleted from a Svelte $state proxy stays an own property whose value
// reads undefined (svelte 5.56 proxy.js deleteProperty), so presence needs both.
// The value read goes FIRST: on a proxy it subscribes to a missing key, which
// hasOwnProperty does not, so a derived reading a map that does not exist yet
// re-runs when it is created (ph-e82.10).
const own = (o, k) => o[k] !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const validName = (n) => typeof n === 'string' && n.trim() !== '' && !(n.trim() in Object.prototype);

/** Old {[id]: {span, order}} map -> placements, reading order kept; a full-span card gets no `w`, so it fills the row at any DPR. */
export function migrateSpans(old) {
  const rows = Object.entries(old && typeof old === 'object' ? old : {})
    .filter(([, e]) => e && typeof e === 'object')
    .map(([id, e]) => ({ id, w: int(e.span, 1, 12, 12) * SPAN_CELLS, order: Number.isFinite(e.order) ? e.order : Infinity }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const out = {};
  let x = 0, y = 0;
  for (const r of rows) {
    if (x + r.w > SPAN_ROW) { x = 0; y++; }
    out[r.id] = r.w === SPAN_ROW ? { x, y, h: DEFAULT_H } : { x, y, w: r.w, h: DEFAULT_H };
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
      if (names.length) {
        if (!own(s.layouts, DEFAULT_NAME) || typeof s.layouts[DEFAULT_NAME] !== 'object') s.layouts[DEFAULT_NAME] = {};
        return { active: names.includes(s.active) ? s.active : names[0], layouts: s.layouts, modules: modulesOf(s), order: Array.isArray(s.order) ? s.order : [] };
      }
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
    return { active: DEFAULT_NAME, layouts: { [DEFAULT_NAME]: seed }, modules: {}, order: [DEFAULT_NAME] };
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

/** Layout names in sidebar order: Default first, then `store.order`, then any layout it does not list. */
export function layoutOrder(store) {
  const names = Object.keys(store.layouts);
  const want = [DEFAULT_NAME, ...(Array.isArray(store.order) ? store.order : []), ...names];
  return [...new Set(want)].filter((n) => names.includes(n));
}

/** Add an empty layout (every view lays out from the rank seed) and make it active. */
export function addLayout(store, name) {
  const n = validName(name) && name.trim();
  if (!n || own(store.layouts, n)) return false;
  store.layouts[n] = {};
  store.order = layoutOrder(store);
  store.active = n;
  return true;
}

/** Move `name` to position `index` of layoutOrder(); Default neither moves nor yields slot 0. */
export function moveLayout(store, name, index) {
  if (name === DEFAULT_NAME || !own(store.layouts, name)) return false;
  const o = layoutOrder(store).filter((n) => n !== name);
  o.splice(int(index, 1, o.length, o.length), 0, name);
  store.order = o;
  return true;
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
  if (from === DEFAULT_NAME || !n || !own(store.layouts, from) || own(store.layouts, n)) return false;
  store.order = layoutOrder(store).map((m) => (m === from ? n : m));
  store.layouts[n] = store.layouts[from];
  delete store.layouts[from];
  if (store.active === from) store.active = n;
  return true;
}

/**
 * One named layout as JSON text, shaped like the prefs backup
 * (prefs.js exportBackup): {app: 'phosphor', layout, views: {[cls.view]: map}}.
 * Modules are not included; a nest carries its own members.
 */
export function exportLayout(store, name = store.active) {
  return JSON.stringify({ app: 'phosphor', layout: name, views: own(store.layouts, name) ? store.layouts[name] : {} }, null, 2);
}

/**
 * Add the layout in `text` (exportLayout's shape) under its own name, or that
 * name with a number when taken; an existing layout is never overwritten.
 * Returns the name it was stored under. Throws, naming why, on anything else.
 */
export function importLayout(store, text) {
  let b;
  try { b = JSON.parse(text); } catch (e) { throw new Error('not JSON'); }
  if (!b || b.app !== 'phosphor' || !b.views || typeof b.views !== 'object' || Array.isArray(b.views)) throw new Error('not a Phosphor layout');
  const views = {};
  for (const [k, m] of Object.entries(b.views)) if (m && typeof m === 'object' && !Array.isArray(m) && (k.includes('.') || k === 'opts')) views[k] = m;
  const base = validName(b.layout) ? b.layout.trim() : 'Imported';
  let name = base;
  for (let i = 2; own(store.layouts, name); i++) name = base + ' ' + i;
  store.layouts[name] = clone(views);
  return name;
}

/** Density steps (DESIGN §10.5 cells stay the same size; cell padding and label size shrink). */
export const DENSITY = ['comfortable', 'compact'];

/** A layout's options: {density}, defaulted. */
export function layoutOpts(store, name = store.active) {
  const o = own(store.layouts, name) && store.layouts[name].opts;
  return { density: o && DENSITY.includes(o.density) ? o.density : DENSITY[0] };
}

/** Set the active layout's density; the default is stored as no option at all. */
export function setDensity(store, density) {
  if (!DENSITY.includes(density)) return false;
  const l = store.layouts[store.active];
  if (density === DENSITY[0]) delete l.opts;
  else l.opts = { density };
  return true;
}

/** Delete a layout; Default cannot go. */
export function deleteLayout(store, name) {
  const names = layoutOrder(store);
  if (name === DEFAULT_NAME || !own(store.layouts, name) || names.length < 2) return false;
  store.order = names.filter((n) => n !== name);
  delete store.layouts[name];
  if (store.active === name) store.active = store.order[0];
  return true;
}

// ---- nests and modules (DESIGN §10.6) ---------------------------------------------
//
// A nest is a placement entry that also carries a subgrid:
//   map['nest:<n>'] = { x, y, w, h, nest: { title, map: { [memberId]: {x, y, w, h} | null } } }
// A nest is a fixed subgrid that grows to fit its members: it never scrolls
// and never folds, so every member is always in view (operator ruling
// 2026-10-02). A stored `scroll` or `collapsed` from an older build is inert.
// The member map's keys ARE the membership; null is a member not yet placed.
// A member the current items lack is inert, exactly as at the top level.

/**
 * ph-e82.1 item 4: single fields placeable anywhere (false) or only inside
 * nests (true). Anywhere by operator ruling 2026-10-01 (DESIGN §10.2): the
 * RFC-080 draft leaves it open (its open question 3), so the builder keeps
 * anywhere until that RFC rules.
 */
export const FIELDS_NESTS_ONLY = false;

/**
 * May a control of `kind` sit at the top level or in a nest? A nest never
 * nests. A safety op is top level only: the strip's own copy is the one that
 * cannot go, and a grid copy stays where the eye finds it. A section header
 * row (DESIGN §10.11) heads the page's cards, so it stays top level too.
 */
export function placeable(kind, inNest, nestsOnly = FIELDS_NESTS_ONLY) {
  if (kind === 'nest' || kind === 'safety' || kind === 'section') return !inNest;
  return inNest || !nestsOnly || kind !== 'field';
}

export const NEST_W = 16;
export const NEST_H = 6;

const clone = (o) => JSON.parse(JSON.stringify(o));

export function isNest(e) {
  return !!(e && typeof e === 'object' && e.nest && typeof e.nest === 'object'
    && e.nest.map && typeof e.nest.map === 'object' && !Array.isArray(e.nest.map));
}

/** The nests in one placement map: [{id, title, keys}], `keys` present or inert. */
export function nestsIn(map) {
  return Object.keys(map).filter((id) => isNest(map[id])).map((id) => {
    const n = map[id].nest;
    return { id, title: typeof n.title === 'string' && n.title.trim() ? n.title : 'Nest', keys: Object.keys(n.map) };
  });
}

/**
 * Add an unplaced nest to `map` (drawn at the first free rect; the caller's
 * next commit fixes it there); `members` is copied. Returns the new id.
 */
export function addNest(map, { title = 'Nest', w = NEST_W, h = NEST_H, members = {} } = {}) {
  let i = 1;
  while (own(map, 'nest:' + i)) i++;
  const id = 'nest:' + i;
  map[id] = { w: int(w, 1, 1000, NEST_W), h: int(h, 1, MAX_H, NEST_H),
    nest: { title: String(title), map: clone(members && typeof members === 'object' ? members : {}) } };
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

/**
 * Move member `key` of nest `id` to the top level of `map`, keeping its look
 * and size. A top-level entry it already has keeps its place (a drag-out
 * writes it first); otherwise it is unplaced (the first free rect). Returns false when `key`
 * is not a member.
 */
export function nestOut(map, id, key) {
  if (!isNest(map[id]) || !own(map[id].nest.map, key)) return false;
  const m = map[id].nest.map[key];
  const prev = own(map, key) && map[key] && typeof map[key] === 'object' ? map[key] : null;
  const e = prev ? { ...prev } : m && typeof m === 'object' && m.w ? { w: m.w, h: m.h } : {};
  if (m && typeof m === 'object' && m.look) e.look = m.look;
  map[key] = e;
  delete map[id].nest.map[key];
  return true;
}

export function setNest(map, id, { title } = {}) {
  if (!isNest(map[id])) return false;
  if (typeof title === 'string' && title.trim()) map[id].nest.title = title.trim();
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
  store.modules[n] = { title: n, w: e.w, h: e.h, members: clone(e.nest.map) };
  return true;
}

/** Place module `name` as a new nest in `map`; members `map`'s view lacks stay inert. Returns the id or null. */
export function insertModule(store, map, name) {
  const m = store.modules && own(store.modules, name) ? store.modules[name] : null;
  if (!m || typeof m !== 'object') return null;
  return addNest(map, { title: m.title, w: m.w, h: m.h, members: m.members });
}

/**
 * Forget the arrangement in `map`, never its content: a nest keeps its size and
 * members and is placed again; in a nest's own map (`members` true) every
 * member stays, unplaced.
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
