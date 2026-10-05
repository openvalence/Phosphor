/**
 * rclass.js — renderer class selection and §11 drill-in promotion, pure.
 *
 * RFC-062 draft (Valence RFC-QUEUE, rfc-l8p): class is re-derived whenever
 * the usable viewport or the primary pointer changes, with a hysteresis band
 * on each boundary. Coded to the DRAFT by operator ruling 2026-09-25; every
 * seam that depends on it is marked `// RFC-062 draft`.
 *
 * Constraints:
 * - Widths are CSS px (device-independent), never device pixels.
 * - The handheld/full band sits entirely BELOW 960px on purpose: the
 *   composition media queries (style.css .app, App.svelte's rail/tab split,
 *   LinkBar) switch at 960. So `handheld` always means width < 960 and the
 *   CSS agrees with it; inside the band a `full` page keeps its rail but
 *   scrolls as a page under the sticky top strip.
 * - The e-stop and pause pair lives in the top strip at every width and class (law 1),
 *   so no class choice here can strand it.
 * - The class chooses projection only. Input primitives follow the pointer
 *   through CSS `(pointer: coarse)` rules (RFC-062 item 3), not through this.
 */

export const CLASSES = ['glance', 'handheld', 'full'];

// RFC-062 draft item 5: boundary 872 +/- 88 (10.1 %), glance 240 +/- 24 (10 %).
export const FULL_UP = 960;
export const FULL_DOWN = 784;
export const GLANCE_DOWN = 216;
export const GLANCE_UP = 264;

// RENDERING §12.1 item 3 floor, in CSS px: the strip holds e-stop and pause
// side by side at law 12's 40 px there (DESIGN §10.3). src-tauri/tauri.conf.json
// windows[0].minWidth/minHeight MUST equal these (shell-chrome-geometry).
export const FLOOR_W = 200;
export const FLOOR_H = 390;

// RENDERING §11: handheld promotes a subgroup to a drill-in page past
// roughly eight controls; glance promotes every subgroup; full never does.
export const DRILL_AFTER = 8;

// Layout columns (DESIGN 10.12): one column = 2 rem, so buckets follow the UI
// scale and the browser text size, never DPR. A field floor is 8 columns and
// each bucket doubles the count: 1 watch, 2 phone, 3 tablet, 4 desk, 5 wide.
export const FIELD_FLOOR_COLS = 8;
const BUCKET_EDGES = [1, 2, 4, 8].map((k) => FIELD_FLOOR_COLS * k);

/** Whole 2 rem columns across `widthCss` at a root font size of `remPx`. */
export function layoutCols(widthCss, remPx) {
  return Math.floor(widthCss / (2 * remPx));
}

/** 1..5: 1 plus the count of 8/16/32/64 at or below `cols`. */
export function bucketOf(cols) {
  return 1 + BUCKET_EDGES.filter((e) => cols >= e).length;
}

/**
 * The next class, given the current one (null on first derivation), the
 * usable viewport width and the primary pointer ('none' | 'coarse' | 'fine').
 */
export function nextClass(prev, width, pointer) {
  let c = prev;
  if (!CLASSES.includes(c)) c = width >= FULL_UP ? 'full' : width < (GLANCE_DOWN + GLANCE_UP) / 2 ? 'glance' : 'handheld';
  else {
    if (c === 'full' && width < FULL_DOWN) c = 'handheld';
    if (c !== 'full' && width >= FULL_UP) c = 'full';
    if (c === 'handheld' && width < GLANCE_DOWN) c = 'glance';
    if (c === 'glance' && width >= GLANCE_UP) c = 'handheld';
  }
  // RFC-062 draft item 2: no pointer selects glance, at any width.
  if (pointer === 'none') c = 'glance';
  return c;
}

/** Does this class promote a subgroup of `n` controls to its own page? */
export function promotes(cls, n) {
  return cls === 'glance' || (cls === 'handheld' && n > DRILL_AFTER);
}

/**
 * One category's page tree under a class: every group, in catalog order, as
 * an inline section or a promoted drill-in page. Reachable content is the
 * same set of fields for every class (RENDERING §12); only the flag moves.
 * A group's `total` (every field, shown or not) decides, when given, so the
 * advanced toggle never promotes or demotes a group under the reader.
 */
export function projectGroups(groups, cls) {
  return groups.map((g) => ({ group: g, drill: promotes(cls, g.total ?? g.fields.length) }));
}
