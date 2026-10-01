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
 * - The handheld/full band sits entirely BELOW 960px on purpose: every
 *   composition media query in the tree (style.css .app, TopStrip and
 *   TransportBar's e-stop split, LinkBar) switches at 960. So `handheld`
 *   always means width < 960 and the CSS agrees with it; inside the band a
 *   `full` page keeps its rail but scrolls as a page with the sticky top strip,
 *   which those queries already render correctly. Moving FULL_UP off 960
 *   without first keying those queries on `data-rc` puts the e-stop on a
 *   bar that scrolls away.
 * - The class chooses projection only. Input primitives follow the pointer
 *   through CSS `(pointer: coarse)` rules (RFC-062 item 3), not through this.
 */

export const CLASSES = ['glance', 'handheld', 'full'];

// RFC-062 draft item 5: boundary 872 +/- 88 (10.1 %), glance 240 +/- 24 (10 %).
export const FULL_UP = 960;
export const FULL_DOWN = 784;
export const GLANCE_DOWN = 216;
export const GLANCE_UP = 264;

// RENDERING §11: handheld promotes a subgroup to a drill-in page past
// roughly eight controls; glance promotes every subgroup; full never does.
export const DRILL_AFTER = 8;

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
  // RFC-062 draft item 2: no pointer selects glance. Held to < FULL_UP for
  // the reason in the header: a glance page at 960+ would lose its e-stop.
  // TODO(ph-vdk.5): drop the width guard once the e-stop split keys on data-rc.
  if (pointer === 'none' && width < FULL_UP) c = 'glance';
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
 */
export function projectGroups(groups, cls) {
  return groups.map((g) => ({ group: g, drill: promotes(cls, g.fields.length) }));
}
