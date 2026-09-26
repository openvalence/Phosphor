/**
 * dashboard.svelte.js — Home-Assistant-style dashboard layout: state + persistence.
 *
 * Pure layout math over caller-supplied items — {id, title, snippet}. This
 * file has never heard of a channel, a field, or a machine; it only knows
 * "some string id wants a span and a position." That is deliberate: the
 * device-knowledge checker (test/check-device-knowledge.mjs) enforces zero
 * wire vocabulary above the Valence protocol client, and a dashboard-layout engine has no
 * business needing any.
 *
 * ── STABILITY ACROSS MACHINES IS THE KEY REQUIREMENT ────────────────────────
 * The saved layout is a MAP keyed by item id — { [id]: {span, order} } — never
 * an array. That is the whole reason ids are stable strings and not indices:
 * an array position means nothing once the set of widgets changes, but a map
 * entry either matches an id or it doesn't.
 *   - An id present in storage but ABSENT from the current `items` (a
 *     different machine, a hidden feature) is simply never visited by
 *     arrange() below — it stays in storage, inert, in case that machine
 *     comes back, but it can never crash or misplace anything live.
 *   - An id present in `items` but ABSENT from storage (a new machine, a
 *     freshly added widget) gets DEFAULT_SPAN and appends after every item
 *     storage does know about, in the order `items` was handed to us.
 * Connecting to a different machine therefore never scrambles a saved layout
 * and never throws — worst case, some items you don't recognize sit unused in
 * localStorage and some items you do have land at the end with a default span.
 *
 * All localStorage access is wrapped in try/catch: private browsing, a full
 * quota, or storage disabled outright must degrade to "layout doesn't
 * persist," never to a broken page.
 *
 * ── ONE LAYOUT PER RENDERER CLASS (RFC-062 draft item 7) ────────────────────
 * Keyed on (class, viewId): a card order arranged on a desktop is never
 * applied to the phone projection, and each class gets its own back.
 * Before classes existed every layout lived under `sd32.dash.<viewId>`; that
 * key is READ as the `full` class's fallback and never written or deleted,
 * because renaming the legacy `sd32.*` keys is an operator decision.
 */

const DEFAULT_SPAN = 12;
const MIN_SPAN = 1;
const MAX_SPAN = 12;

function storageKey(cls, viewId) {
  return 'phosphor.dash.' + cls + '.' + viewId;
}

function loadLayout(cls, viewId) {
  try {
    let raw = localStorage.getItem(storageKey(cls, viewId));
    if (raw == null && cls === 'full') raw = localStorage.getItem('sd32.dash.' + viewId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveLayout(cls, viewId, map) {
  try {
    localStorage.setItem(storageKey(cls, viewId), JSON.stringify(map));
  } catch (e) {
    // Private mode / quota exceeded / storage disabled. The in-memory layout
    // still works for this page load; it just won't survive a reload.
  }
}

function clampSpan(span) {
  const n = Math.round(Number(span));
  if (!Number.isFinite(n)) return DEFAULT_SPAN;
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, n));
}

// One reactive layout store per (class, viewId), cached so switching tabs and
// coming back keeps in-memory edits and doesn't re-read localStorage every time.
const registry = new Map();

/**
 * Get (or lazily create) the reactive layout controller for one dashboard
 * view under one renderer class. `viewId` namespaces persistence, e.g. "cat2"
 * for the machine's second settings category — each view keeps its own
 * arrangement, per class.
 */
export function dashboardLayout(viewId, cls = 'full') {
  const key = cls + '|' + viewId;
  let l = registry.get(key);
  if (!l) {
    l = createLayout(cls, viewId);
    registry.set(key, l);
  }
  return l;
}

function createLayout(cls, viewId) {
  /** @type {Record<string, {span:number, order:number}>} */
  const map = $state(loadLayout(cls, viewId));

  function persist() {
    saveLayout(cls, viewId, { ...map });
  }

  function nextOrder() {
    let max = -1;
    for (const k in map) {
      if (map[k] && Number.isFinite(map[k].order) && map[k].order > max) max = map[k].order;
    }
    return max + 1;
  }

  /**
   * Merge the caller's live `items` with the saved map into a sorted,
   * fully-specified render list: [{id, title, snippet, span, order}, ...].
   *
   * PURE — never writes to `map`. Safe to call from a $derived on every
   * render; the "give unknown ids a default and append them" behavior
   * described above happens here at read time rather than by mutating
   * storage, so merely *looking* at a layout never persists anything.
   */
  function arrange(items) {
    let maxOrder = -1;
    for (const it of items) {
      const e = map[it.id];
      if (e && Number.isFinite(e.order) && e.order > maxOrder) maxOrder = e.order;
    }
    const out = items.map((it) => {
      const e = map[it.id];
      if (e) return { ...it, span: clampSpan(e.span ?? DEFAULT_SPAN), order: e.order };
      maxOrder += 1;
      return { ...it, span: DEFAULT_SPAN, order: maxOrder };
    });
    out.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    return out;
  }

  /** Set one item's column span (clamped 1..12), persisted immediately. */
  function setSpan(id, span) {
    const cur = map[id];
    map[id] = { span: clampSpan(span), order: cur ? cur.order : nextOrder() };
    persist();
  }

  /**
   * Commit a full new ordering: an array of item ids, first = position 0.
   * Spans are preserved for ids already in the map; ids seen for the first
   * time (still on their default position) get DEFAULT_SPAN. Used by both
   * pointer-drag drop and keyboard reorder — the only two places an order
   * actually changes.
   */
  function commitOrder(orderedIds) {
    orderedIds.forEach((id, i) => {
      const cur = map[id];
      map[id] = { span: cur ? cur.span : DEFAULT_SPAN, order: i };
    });
    persist();
  }

  /**
   * Clear this view's saved layout — the "reset layout" affordance. Persists
   * an EMPTY map rather than removing the key, so the legacy fallback above
   * cannot resurrect the layout the operator just reset.
   */
  function reset() {
    for (const k of Object.keys(map)) delete map[k];
    persist();
  }

  return { arrange, setSpan, commitOrder, reset };
}
