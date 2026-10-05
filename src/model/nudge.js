/**
 * nudge.js -- the Blender modifier rule for every numeric control (DESIGN
 * 10.5): Shift = fine, Ctrl = snap to the decade below the range's magnitude.
 *
 * Constraints:
 * - Pure: reads only the event's shiftKey and ctrlKey. Plugins inline the same
 *   rule; they do not import app modules.
 * - A key never steps below the field's declared step (an off-grid value is
 *   NACKed): Shift on a key is the smallest step. Only drags get a finer gain.
 */

/** Largest power of ten strictly below the range's span (1000 -> 100, 50 -> 10, 1e6 -> 1e5). */
export function decadeBelow(lo, hi) {
  const span = Math.abs(hi - lo);
  if (!isFinite(span) || span <= 0) return 1;
  return Math.pow(10, Math.ceil(Math.log10(span)) - 1);
}

/** The step a key or nudge takes: Ctrl the decade (never below `step`), else `step` (Shift included). */
export function modStep(e, step, lo, hi) {
  if (e && e.ctrlKey) return Math.max(step, decadeBelow(lo, hi));
  return step;
}

/** A relative drag's gain: a tenth with Shift. */
export const dragGain = (e, base) => (e && e.shiftKey ? base * 0.1 : base);

/** While Ctrl is held: round to a decade multiple, or with `dir` the adjacent multiple that way. */
export function snap(v, e, lo, hi, dir = 0) {
  if (!e || !e.ctrlKey) return v;
  const d = decadeBelow(lo, hi), q = v / d;
  if (dir > 0) return (Math.floor(q + 1e-9) + 1) * d;
  if (dir < 0) return (Math.ceil(q - 1e-9) - 1) * d;
  return Math.round(q) * d;
}
