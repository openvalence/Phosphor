/**
 * catalog-cache.js -- the session catalog cache (SPEC §8.6, RFC-121): catalog bytes keyed by etag, and per hub
 * the etag of the machine's catalog and of its provisioning catalog. machine.svelte.js hands each session a
 * view of it (sessionStore) in the createSession catalogStore shape.
 *
 * Constraints:
 * - Pure: no runes, no DOM, so test/catalog-cache.test.mjs runs it under node.
 * - A config-mode session (sessionStore ctx.configMode) writes only its hub's setup pointer: it never sets,
 *   clears or presents the machine's etag, and never re-points a host already known.
 * - load() is synchronous (the session reads it before HELLO): bytes live in a memory mirror, written through
 *   to IndexedDB and hydrated from it by `ready`. No IndexedDB in the mini build (web/storage.js) or under node:
 *   bytes stay in memory there.
 * - Pointers are small JSON in localStorage (POINTERS): hosts (dialed host -> hub key), machine and setup
 *   (hub key -> etag hex), vault (vault.js machine key -> etag hex: pin() keeps a machine's last catalog for
 *   Virtual Valence while the hub is away). Bytes no pointer names are dropped.
 * - The pre-RFC-121 cache (`valence.catalog.<host>`, hex in localStorage) is moved in once and removed.
 * - Every storage access degrades to a no-op on a throw: the cache is a fast path, never a requirement.
 */
import { catalogEtag, toHex, fromHex, LIMITS } from '../../../Valence/clients/js/index.js';

export const POINTERS = 'phosphor.catalogs';
const LEGACY = 'valence.catalog.';
const DB = 'phosphor-catalogs';
const STORE = 'catalogs';

const etagOf = (bytes) => toHex(catalogEtag(bytes, LIMITS.etag_bytes));

function openIdb(idb) {
  return new Promise((resolve, reject) => {
    const rq = idb.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('blocked'));
  });
}

/**
 * @param {{storage?: Storage|null, idb?: IDBFactory|null}} [o] defaults: globalThis.localStorage, and
 *   globalThis.indexedDB outside the mini build
 */
export function createCatalogCache(o = {}) {
  const storage = o.storage !== undefined ? o.storage : (() => { try { return globalThis.localStorage || null; } catch (e) { return null; } })();
  const idb = o.idb !== undefined ? o.idb : (import.meta.env?.MODE !== 'mini' && globalThis.indexedDB) || null;
  const mem = new Map();
  let p = { hosts: {}, machine: {}, setup: {}, vault: {} };
  try {
    const raw = JSON.parse(storage?.getItem(POINTERS) || 'null');
    if (raw && typeof raw === 'object') for (const k of Object.keys(p)) if (raw[k] && typeof raw[k] === 'object') p[k] = raw[k];
  } catch (e) { /* corrupt: start empty */ }

  let db = null;
  const pending = [];
  const tx = (fn) => {
    if (!idb) return;
    if (!db) { pending.push(fn); return; }
    try { fn(db.transaction(STORE, 'readwrite').objectStore(STORE)); } catch (e) { /* closed or quota */ }
  };

  function persist() {
    try { storage?.setItem(POINTERS, JSON.stringify(p)); } catch (e) { /* quota or private mode */ }
  }
  function prune() {
    const used = new Set([...Object.values(p.machine), ...Object.values(p.setup), ...Object.values(p.vault)]);
    for (const e of [...mem.keys()]) if (!used.has(e)) { mem.delete(e); tx((s) => s.delete(e)); }
  }
  function put(e, bytes) {
    if (mem.has(e)) return;
    mem.set(e, bytes);
    tx((s) => s.put(bytes, e));
  }
  function point(host, hub, e, setup) {
    if (!hub) return;
    if (!setup || !p.hosts[host]) p.hosts[host] = hub;
    if (setup) p.setup[hub] = e;
    else { p.machine[hub] = e; if (hub !== host) delete p.machine[host]; }
  }

  // The pre-RFC-121 cache: a machine catalog keyed by the dialed host. The first WELCOME re-points it by hub.
  try {
    const legacy = [];
    for (let i = 0; i < (storage?.length || 0); i++) { const k = storage.key(i); if (k && k.startsWith(LEGACY)) legacy.push(k); }
    for (const k of legacy) {
      try {
        const v = JSON.parse(storage.getItem(k));
        const bytes = fromHex(v.bytes);
        const e = etagOf(bytes);
        if (bytes.length && e === String(v.etag).toLowerCase()) {
          const host = k.slice(LEGACY.length);
          put(e, bytes);
          p.hosts[host] = host;
          p.machine[host] = e;
        }
      } catch (e) { /* unreadable: dropped */ }
      storage.removeItem(k);
    }
    if (legacy.length) { prune(); persist(); }
  } catch (e) { /* storage unreadable */ }

  const ready = !idb ? Promise.resolve() : openIdb(idb).then((d) => new Promise((resolve) => {
    db = d;
    const s = d.transaction(STORE, 'readonly').objectStore(STORE);
    const keys = s.getAllKeys(), vals = s.getAll();
    vals.onsuccess = () => {
      keys.result.forEach((k, i) => { if (!mem.has(k)) mem.set(k, vals.result[i]); });
      for (const fn of pending.splice(0)) tx(fn);
      prune();
      resolve();
    };
    vals.onerror = () => resolve();
  })).catch(() => { db = null; pending.length = 0; });

  return {
    ready,

    /** True once IndexedDB is open: bytes written now outlive the page. False under node, in the mini build or after a failure. */
    get durable() { return !!db; },

    /** vault.js: keep `bytes` as the catalog of vault machine `key`, whatever the hub's own pointers do. Returns the etag hex. */
    pin(key, bytes) {
      const e = etagOf(bytes);
      put(e, bytes);
      if (p.vault[key] !== e) { p.vault[key] = e; prune(); persist(); }
      return e;
    },

    /** The bytes pinned for vault machine `key`, or null (not pinned, or not yet hydrated from IndexedDB). */
    pinned(key) {
      const e = p.vault[key];
      return (e && mem.get(e)) || null;
    },

    /**
     * One session's catalogStore. ctx.configMode(): this session is in config mode (a BLE link, or WELCOME
     * identity config_mode); ctx.hubKey(): prefs.js hubKey from this session's WELCOME, null before it.
     */
    sessionStore(ctx) {
      const which = () => (ctx.configMode() ? p.setup : p.machine);
      return {
        load(host) {
          const hub = p.hosts[host];
          const e = hub && which()[hub];
          const bytes = e && mem.get(e);
          return bytes ? { etag: fromHex(e), bytes } : null;
        },
        save(host, etag, bytes) {
          const e = toHex(etag);
          if (etagOf(bytes) !== e) return;
          put(e, bytes);
          point(host, ctx.hubKey(), e, ctx.configMode());
          prune();
          persist();
        },
        clear(host) {
          const hub = p.hosts[host];
          if (!hub) return;
          delete which()[hub];
          prune();
          persist();
        },
      };
    },

    /** A WELCOME: in normal mode, a held catalog under the hub's etag is that hub's machine catalog. */
    welcome(host, hub, etag, configMode) {
      const e = etag ? toHex(etag) : '';
      if (!hub || !e || !mem.has(e)) return;
      point(host, hub, e, configMode);
      prune();
      persist();
    },
  };
}

export const catalogCache = createCatalogCache();
