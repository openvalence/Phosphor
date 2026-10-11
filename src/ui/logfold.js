/**
 * logfold.js -- the Log page's folded feeds (DESIGN Amendments 2026-10-10,
 * `ph-s5mu`): repeated events fold into one row with a count.
 *
 * Constraints:
 * - A repeat is the same source, level, tag, identity (p.id: a channel, a
 *   NACK code) and text once every number and id reads '#'. A digit inside
 *   a name (axis1, E12, v1.2) is part of the name. The newest repeat
 *   replaces its row (count, last time, newest instance) and moves it to the
 *   tail; it never adds a row.
 * - Rows are immutable: an update is a new object, so a paused view keeps
 *   exactly what it showed.
 * - Plain data, no runes: LogPane owns the reactive tick.
 */
// ponytail: past ROW_MAX distinct rows the oldest drops; a row keeps its newest KEEP instances, the count keeps going.
export const ROW_MAX = 5000;
export const KEEP = 20;

// After a non-name character: a uuid, 0x hex, a hex run of six or more with
// a letter and a digit, or a number (sign, U+202F or comma grouping, decimals).
const ID = /(^|[^\w.])-?(?:[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}|0x[\da-f]+|(?=\d*[a-f])(?=[a-f]*\d)[\da-f]{6,}\b|\d+(?:[,\u202f]\d{3})*(?:\.\d+)?)/gi;
export const shape = (s) => String(s).replace(ID, '$1#');
// JSON, not a joined string: no tag or text runs into the next part.
export const keyOf = (p) => JSON.stringify([p.src, p.lvl, p.tag, p.id ?? null, shape(p.text), shape(p.kvText)]);

/** `rings` are the event rings the fold reads; new rings (a new session) start the fold over. */
export function createFold() {
  return { rows: [], byKey: new Map(), rings: [], lasts: [], total: 0, counts: {}, seq: 0 };
}

export function clearFold(f) {
  f.rows = [];
  f.byKey.clear();
  f.total = 0;
  f.counts = {};
}

/** Fold one event; `p` is its decoded parts ({src, bucket, lvl, tag, id, text, kvText, ...}). */
export function addTo(f, evt, p) {
  const key = keyOf(p);
  f.total++;
  f.counts[p.bucket] = (f.counts[p.bucket] || 0) + 1;
  const old = f.byKey.get(key);
  const row = old
    ? { ...old, n: old.n + 1, last: evt.at, evt, p, items: [...old.items.slice(1 - KEEP), evt] }
    : { key, id: ++f.seq, n: 1, first: evt.at, last: evt.at, evt, p, items: [evt] };
  if (old) f.rows.splice(f.rows.lastIndexOf(old), 1);
  else if (f.rows.length >= ROW_MAX) f.byKey.delete(f.rows.shift().key);
  f.rows.push(row);
  f.byKey.set(key, row);
}

/**
 * Fold what `rings` gained since the last call, oldest first across them
 * (`decode(evt, k)` gets the event's ring index). A ring is a sliding window:
 * the last event folded from it is found again by identity, and when it has
 * been pushed out, everything in the ring is newer. True when the rows changed.
 */
export function ingest(f, rings, decode) {
  const fresh = rings.length !== f.rings.length || rings.some((r, k) => r !== f.rings[k]);
  if (fresh) { clearFold(f); f.rings = rings; f.lasts = rings.map(() => null); }
  const add = [];
  rings.forEach((ring, k) => {
    const n = ring.length, last = f.lasts[k];
    if (!n || ring[n - 1] === last) return;
    for (let i = last ? ring.lastIndexOf(last) + 1 : 0; i < n; i++) add.push([ring[i], k]);
    f.lasts[k] = ring[n - 1];
  });
  // A stable sort: events of one millisecond keep their ring order.
  add.sort((a, b) => a[0].at - b[0].at);
  for (const [e, k] of add) addTo(f, e, decode(e, k));
  return fresh || add.length > 0;
}

export const folds = { log: createFold(), anomaly: createFold() };
