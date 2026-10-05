/**
 * nudge.js -- the Blender modifier rule for every numeric control (DESIGN
 * 10.5): Shift = fine, Ctrl = snap to the decade below the range's magnitude.
 *
 * Constraints:
 * - Pure: reads only the event's shiftKey and ctrlKey. Plugins inline the same
 *   rule; they do not import app modules.
 * - A step never goes below the field's own step grid unless it is fractional:
 *   Shift on an integer step is one step.
 */

/** Largest power of ten strictly below the range's span (1000 -> 100, 50 -> 10, 1e6 -> 1e5). */
export function decadeBelow(lo, hi) {
  const span = Math.abs(hi - lo);
  if (!isFinite(span) || span <= 0) return 1;
  return Math.pow(10, Math.ceil(Math.log10(span)) - 1);
}

/** The step a key or nudge takes: Shift fine, Ctrl the decade (never below `step`), else `step`. */
export function modStep(e, step, lo, hi) {
  if (e && e.ctrlKey) return Math.max(step, decadeBelow(lo, hi));
  if (e && e.shiftKey) return Number.isInteger(step) ? step : step / 10;
  return step;
}

/** A relative drag's gain: a tenth with Shift. */
export const dragGain = (e, base) => (e && e.shiftKey ? base * 0.1 : base);

/** Round to a multiple of the decade while Ctrl is held. */
export function snap(v, e, lo, hi) {
  if (!e || !e.ctrlKey) return v;
  const d = decadeBelow(lo, hi);
  return Math.round(v / d) * d;
}
