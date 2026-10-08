/**
 * vault.js -- the last known picture of every machine this client met: its
 * catalog, identity, retained STATE and the store items it read. Virtual
 * Valence (shell/virtual.js) replays a machine from it with no machine there.
 *
 * Constraints:
 * - Pure: no runes, no DOM, so test/vault.test.mjs runs it under node.
 * - Keyed per machine by prefs.js hubKey: hub_instance_id, else host:port.
 *   One machine is two keys, `<prefix><key>` (identity, snapshots, items;
 *   rewritten throttled) and `<prefix><key>.catalog` (etag and bytes; written
 *   on adoption only).
 * - Raw STATE bytes as the wire sent them, never re-encoded from decoded
 *   values: a replay must not invent a value the machine never reported.
 * - A virtual session records nothing: a replay is not evidence.
 * - Every storage access degrades to a no-op on a throw (private mode, quota).
 */

import { FRAME, parseFrames, toHex, fromHex, catalogEtag, LIMITS } from '../../../Valence/clients/js/index.js';
import { hubKey } from './prefs.js';

export const VAULT_PREFIX = 'phosphor.vault.';
const THROTTLE_MS = 2000;

const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };
function read(storage, k) {
  try { return JSON.parse(storage.getItem(k)); } catch (e) { return null; }
}
function write(storage, k, v) {
  try { storage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota or private mode: the vault is a convenience */ }
}

/** The stored picture of one machine, or null. Bytes come back as Uint8Array. */
export function loadMachine(key, storage = store()) {
  if (!storage || !key) return null;
  const m = read(storage, VAULT_PREFIX + key);
  const c = read(storage, VAULT_PREFIX + key + '.catalog');
  if (!m || !c || typeof c.bytes !== 'string') return null;
  try {
    const catalogBytes = fromHex(c.bytes);
    const snapshots = {};
    for (const [ch, hex] of Object.entries(m.snaps || {})) snapshots[ch] = fromHex(hex);
    const items = Object.entries(m.items || {}).map(([k, hex]) => {
      const [storeId, slot] = k.split(':').map(Number);
      return { storeId, slot, bytes: fromHex(hex) };
    });
    return { key, name: m.name || '', identity: m.identity || {}, catalogBytes, snapshots, items, savedAt: m.savedAt || 0 };
  } catch (e) {
    return null;
  }
}

/** Does this machine have a replayable picture? */
export function hasMachine(key, storage = store()) {
  try { return !!(storage && key && storage.getItem(VAULT_PREFIX + key + '.catalog')); } catch (e) { return false; }
}

/** The createLocalHub options for a stored machine. */
export function hubOptions(m) {
  return { catalogBytes: m.catalogBytes, identity: m.identity, snapshots: m.snapshots, items: m.items };
}

/**
 * A session catalogStore holding exactly this machine's catalog, so a virtual
 * session takes the etag fast path and nothing is copied into the session
 * cache.
 */
export function catalogStoreFor(m) {
  const held = { etag: catalogEtag(m.catalogBytes, LIMITS.etag_bytes), bytes: m.catalogBytes };
  return { load: () => held, save() {}, clear() {} };
}

/**
 * One live session's recorder. machine.svelte.js feeds it the WELCOME, the
 * adopted catalog, every inbound socket message and every store item read.
 * @param {{storage?: Storage, throttleMs?: number}} [o]
 */
export function recorder(o = {}) {
  const storage = o.storage !== undefined ? o.storage : store();
  const throttleMs = o.throttleMs ?? THROTTLE_MS;
  let rec = null;
  let timer = null;

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (rec && storage) write(storage, VAULT_PREFIX + rec.key, rec.meta);
  }
  function dirty() {
    if (!timer) timer = setTimeout(flush, throttleMs);
  }

  return {
    welcome(identity, host, port) {
      flush();
      const key = hubKey(identity, host, port);
      const old = (storage && read(storage, VAULT_PREFIX + key)) || {};
      const id = identity || {};
      rec = { key, meta: {
        name: id.hub_name || old.name || '',
        identity: { product: id.product || null, fw_version: id.fw_version || null, hub_name: id.hub_name || null,
          estop_cuts_power: id.estop_cuts_power === true },
        snaps: old.snaps || {}, items: old.items || {}, savedAt: Date.now(),
      } };
      flush();
    },
    catalog(bytes) {
      if (!rec || !bytes || !storage) return;
      write(storage, VAULT_PREFIX + rec.key + '.catalog', { etag: toHex(catalogEtag(bytes, LIMITS.etag_bytes)), bytes: toHex(bytes) });
    },
    frame(data) {
      if (!rec || !(data instanceof ArrayBuffer)) return;
      for (const { header, payload } of parseFrames(new Uint8Array(data))) {
        if (header.type !== FRAME.STATE) continue;
        rec.meta.snaps[header.channel] = toHex(payload);
        rec.meta.savedAt = Date.now();
        dirty();
      }
    },
    /** A store read: {storeId, slot, bytes}; bytes null = the hub said the slot is empty. */
    item(r) {
      if (!rec || !r) return;
      const k = r.storeId + ':' + r.slot;
      if (r.bytes) rec.meta.items[k] = toHex(r.bytes); else delete rec.meta.items[k];
      dirty();
    },
    flush,
    get key() { return rec && rec.key; },
  };
}
