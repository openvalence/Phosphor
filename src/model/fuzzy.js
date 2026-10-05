/**
 * fuzzy.js -- F3 matching: every query word must hit, in any order.
 *
 * Constraints:
 * - A word hits as a contiguous substring (better, earlier is better) or, failing
 *   that, as a subsequence (worse, tighter is better). No hit on any word is null.
 * - Higher is better. rank() puts every label hit before any path hit.
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

/** Items ({label, path}) matching `query`: label hits first, then path hits (scored on path + label), each tightest first. */
export function rank(query, items) {
  const out = [];
  for (const it of items) {
    const l = score(query, it.label);
    const p = l == null ? score(query, (it.path || '') + ' ' + it.label) : null;
    if (l != null) out.push([0, l, it]);
    else if (p != null) out.push([1, p, it]);
  }
  return out.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2].label.localeCompare(b[2].label)).map((x) => x[2]);
}
