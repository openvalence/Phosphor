/**
 * roster.js -- the `list` archetype's slot model (RENDERING §8.4 row 9, §10
 * `roster`): one record per slot of a STORE entry, read over the blob verb
 * (SPEC §8.7). Pure, so the state rules are testable with no hub and no DOM.
 *
 * Constraints:
 * - PENDING is a state of its own and never reads as empty (§8.4 row 9).
 * - LOCKED (role below the store's access floor, or NACK ACCESS_DENIED) is
 *   never reported as empty: the slots may be full and this session cannot
 *   see them.
 * - EMPTY is only what the hub said: NACK CHUNK_UNAVAILABLE, or a slot past
 *   the roster's count (SPEC §8.7).
 * - Item payloads stay opaque (SPEC §8.7); only the item envelope is read.
 * - The slot hint orders reads and never decides a slot's state: with no
 *   roster count every slot is asked, and a stale hint costs NACKs, not items.
 *   It persists in localStorage and degrades to in-memory on a throw.
 */
import { cbDecodeFull, BLOB_K, BLOB_ERROR, NACK, FIELD_ROLE } from '../../../../Valence/clients/js/index.js';
import { STORE_OP } from '../../../../Valence/clients/js/generated/registry_vocab.js';

export const SLOT = Object.freeze({
  pending: 'pending', item: 'item', empty: 'empty', locked: 'locked', error: 'error',
});

/** @returns {boolean} the session's role cannot read this STORE entry at all */
export function storeLocked(storeEntry, role) {
  return (role | 0) < (storeEntry.access | 0);
}

/** Every slot of the store, all PENDING: the state before any answer arrives. */
export function pendingSlots(storeEntry) {
  return Array.from({ length: storeEntry.store.capacity | 0 }, (_, slot) => ({ slot, state: SLOT.pending }));
}

/** A fetchBlob outcome as one slot record. */
export function slotFrom(slot, res, err) {
  if (!err) {
    let name = '';
    try {
      const m = cbDecodeFull(res.bytes);
      name = (m instanceof Map ? m.get(BLOB_K.name) : null) ?? '';
    } catch (e) { void e; }
    return { slot, state: SLOT.item, name: String(name), generation: res.generation };
  }
  if (err.code === BLOB_ERROR.UNAVAILABLE) return { slot, state: SLOT.empty };
  if (err.code === BLOB_ERROR.REFUSED && err.nack && err.nack.code === NACK.ACCESS_DENIED) {
    return { slot, state: SLOT.locked };
  }
  return { slot, state: SLOT.error, error: err.code || String(err) };
}

/**
 * The roster's item count: field 1 of the registered layout
 * {generation u16, count u8, capacity u8} (SPEC §8.7), read by position.
 * Null while the roster has no sample.
 */
export function rosterCount(roster, sample) {
  const f = roster && roster.layout && roster.layout[1];
  const v = f && sample ? sample[f.name] : undefined;
  return Number.isInteger(v) ? v : null;
}

// Per hub and store, the slots last seen holding an item, kept across launches (ph-2tjo).
const HINT_KEY = 'phosphor.storeSlots';
let hints = null;   // 'hub:storeId' -> Set of slots

/** The slot hint for one hub's store: a Set enumerateStore and noteStoreOp keep current. */
export function slotHint(hub, storeId) {
  if (!hints) {
    let raw = null;
    try { raw = JSON.parse(globalThis.localStorage.getItem(HINT_KEY)); } catch (e) { /* in-memory only */ }
    hints = new Map(Object.entries(raw && typeof raw === 'object' ? raw : {})
      .map(([k, v]) => [k, new Set(Array.isArray(v) ? v.filter(Number.isInteger) : [])]));
  }
  const k = hub + ':' + storeId;
  if (!hints.has(k)) hints.set(k, new Set());
  return hints.get(k);
}

function saveHints() {
  try {
    globalThis.localStorage.setItem(HINT_KEY, JSON.stringify(Object.fromEntries([...hints].map(([k, s]) => [k, [...s]]))));
  } catch (e) { /* in-memory only */ }
}

/**
 * An action.store op's ECHO moves the hint: save fills its slot (the ECHO names
 * the one the hub chose), delete empties it. `args` is the sent fields with the
 * ECHO's applied keys over them; the slot is found by its RFC-089 role only.
 */
export function noteStoreOp(entries, action, op, args, hub) {
  const writer = (entries || []).find((e) => e.id === action.channelId);
  const p = (action.payload || []).find((x) => x.role === FIELD_ROLE.store_slot);
  const slot = p && args ? args[p.key] : undefined;
  if (!writer || writer.storeId == null || !Number.isInteger(slot)) return;
  if (op !== STORE_OP.save && op !== STORE_OP.delete_item) return;
  const known = slotHint(hub, writer.storeId);
  if (op === STORE_OP.save) known.add(slot); else known.delete(slot);
  saveHints();
}

/**
 * Read the slots one at a time (the hub runs one blob transfer per session).
 * `onSlot(record)` fires per answer; slots not yet answered stay PENDING in the
 * caller's array. A locked store issues no request at all. With the roster's
 * `count`, the reads stop at the count-th item and every slot not read is
 * EMPTY unasked. An empty slot asked costs the hub one NACK CHUNK_UNAVAILABLE,
 * so the slots the `known` hint names are read first and the hint follows
 * every answer.
 *
 * @param {(o: Object) => Promise<Object>} fetchBlob session.fetchBlob
 * @param {Object} storeEntry a STORE-class catalog entry (`.store`, `.access`)
 * @param {{role: number, count?: number|null, known?: Set<number>|null, signal?: AbortSignal, onSlot: Function}} o
 */
export async function enumerateStore(fetchBlob, storeEntry, { role, count = null, known = null, signal, onSlot }) {
  const n = storeEntry.store.capacity | 0;
  if (storeLocked(storeEntry, role)) {
    for (let slot = 0; slot < n; slot++) onSlot({ slot, state: SLOT.locked });
    return;
  }
  const order = [...Array(n).keys()];
  if (known) order.sort((a, b) => known.has(b) - known.has(a) || a - b);
  const read = new Set();
  let found = 0;
  for (const slot of order) {
    if (signal && signal.aborted) return;
    if (count != null && found >= count) break;
    let rec;
    try {
      rec = slotFrom(slot, await fetchBlob({ storeId: storeEntry.store.storeId, slot, signal }));
    } catch (err) {
      if (err && err.code === BLOB_ERROR.ABORTED) return;
      rec = slotFrom(slot, null, err);
    }
    if (signal && signal.aborted) return;
    if (rec.state === SLOT.item) { found++; known?.add(slot); }
    if (rec.state === SLOT.empty) known?.delete(slot);
    read.add(slot);
    onSlot(rec);
  }
  for (let slot = 0; slot < n; slot++) {
    if (read.has(slot)) continue;
    known?.delete(slot);
    onSlot({ slot, state: SLOT.empty });
  }
  if (known && hints) saveHints();
}

/**
 * The STORE entry a roster STATE entry or an `action.store` writer belongs to,
 * by RFC-070's `store_id` entry key. Null when absent or naming no store:
 * never guessed by name or id adjacency (law 6).
 */
export function storeOfRoster(entries, entry) {
  if (!entry || entry.storeId == null) return null;
  return entries.find((e) => e.store && e.store.storeId === entry.storeId) || null;
}

/** The roster STATE entry naming this STORE by `store_id`, or null. */
export function rosterOfStore(entries, storeEntry) {
  if (!storeEntry || !storeEntry.store) return null;
  return entries.find((e) => e.storeId === storeEntry.store.storeId && e.layout) || null;
}
