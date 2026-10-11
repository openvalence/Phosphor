/**
 * interp.js -- the monotone cubic (PCHIP, Fritsch-Butland weights) through measured samples.
 *
 * Constraints:
 * - The curve passes through every sample and never leaves the range of the two samples
 *   either side of a span: no overshoot, no motion the samples did not show.
 * - Shared by the rail's comet (src/ui/hero/telebuf.js) and the funscript timeline's trace;
 *   one formula, so the two never disagree about a curve.
 */

/**
 * The slope at a sample between two spans: h0, h1 the spans' lengths, d0, d1 their secant
 * slopes. 0 at an extreme (the secants disagree in sign or one is flat), else their weighted
 * harmonic mean, which stays under 3 times either secant. An end sample takes its one secant.
 */
export function pchipSlope(h0, d0, h1, d1) {
  return d0 * d1 <= 0 ? 0 : (3 * h0 + 3 * h1) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
}

/** The cubic Hermite at t in [0, 1] between p0 and p1, slopes m0, m1 already scaled by the span. */
export function hermite(p0, p1, m0, m1, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
}
