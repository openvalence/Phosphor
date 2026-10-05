/**
 * fuzzy.js -- F3 matching: every query word must hit, in any order.
 *
 * Constraints:
 * - A word hits as a contiguous substring (better, earlier is better) or, failing
 *   that, as a subsequence (worse, tighter is better). No hit on any word is null.
 * - Higher is better. Callers rank label hits above path hits themselves.
 */
function word(w, t) {
  const i = t.indexOf(w);
  if (i >= 0) return 100 - Math.min(i, 50) + (i === 0 || t[i - 1] === ' ' ? 10 : 0);
  let from = -1, first = -1;
  for (const c of w) {
    from = t.indexOf(c, from + 1);
    if (from < 0) return null;
    if (first < 0) first = from;
  }
  return Math.max(1, 50 - (from - first + 1 - w.length));
}

/** Score `text` against `query`; null when any word is missing. */
export function score(query, text) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const t = text.toLowerCase();
  let sum = 0;
  for (const w of words) {
    const s = word(w, t);
    if (s == null) return null;
    sum += s;
  }
  return sum;
}
