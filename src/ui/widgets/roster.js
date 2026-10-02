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
 * - EMPTY is only what the hub said: NACK CHUNK_UNAVAILABLE (SPEC §8.7).
 * - Item payloads stay opaque (SPEC §8.7); only the item envelope is read.
 */
import { cbDecodeFull, BLOB_K, BLOB_ERROR, NACK } from '../../../../Valence/clients/js/index.js';

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
 * Read every slot, one at a time (the hub runs one blob transfer per session).
 * `onSlot(record)` fires per answer; slots not yet answered stay PENDING in the
 * caller's array. A locked store issues no request at all.
 *
 * @param {(o: Object) => Promise<Object>} fetchBlob session.fetchBlob
 * @param {Object} storeEntry a STORE-class catalog entry (`.store`, `.access`)
 * @param {{role: number, signal?: AbortSignal, onSlot: Function}} o
 */
export async function enumerateStore(fetchBlob, storeEntry, { role, signal, onSlot }) {
  const n = storeEntry.store.capacity | 0;
  if (storeLocked(storeEntry, role)) {
    for (let slot = 0; slot < n; slot++) onSlot({ slot, state: SLOT.locked });
    return;
  }
  for (let slot = 0; slot < n; slot++) {
    if (signal && signal.aborted) return;
    let rec;
    try {
      rec = slotFrom(slot, await fetchBlob({ storeId: storeEntry.store.storeId, slot, signal }));
    } catch (err) {
      if (err && err.code === BLOB_ERROR.ABORTED) return;
      rec = slotFrom(slot, null, err);
    }
    if (signal && signal.aborted) return;
    onSlot(rec);
  }
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
