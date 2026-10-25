// vault.test.mjs -- the per-machine vault, no browser: a recorder's capture,
// one record per machine key, store reads and empties, the built-in machine
// replayed through createLocalHub, and the backup prefix.
// Run: node test/vault.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = new Map();
const storage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const { recorder, loadMachine, hasMachine, hubOptions, catalogStoreFor, migrateVault, VAULT_PREFIX } =
  await import('../src/model/vault.js');
const { createCatalogCache } = await import('../src/model/catalog-cache.js');
const { exportBackup } = await import('../src/model/prefs.js');
const { createLocalHub, createSession, encodeFrame, FRAME, catalogEtag, LIMITS, toHex } =
  await import('../../Valence/clients/js/index.js');

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
const frame = (type, ch, bytes) => { const f = encodeFrame(type, ch, bytes); return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength); };
const ID = 'feedc0de00000001';

// Capture: identity, catalog, raw STATE bytes, store items; throttled, flushed.
const r = recorder({ throttleMs: 60000 });
r.welcome({ hub_instance_id: ID, hub_name: 'Bench', product: 'ossm', fw_version: '1.2.3', estop_cuts_power: true }, '10.0.0.5', 82);
r.catalog(CAT);
r.frame(frame(FRAME.STATE, 0x1000, Uint8Array.of(1, 2, 3)));
r.frame(frame(FRAME.ECHO, 0x3000, Uint8Array.of(9)));
r.frame(frame(FRAME.STATE, 0x1000, Uint8Array.of(4, 5, 6)));
r.item({ storeId: 2, slot: 3, bytes: Uint8Array.of(7, 7) });
r.item({ storeId: 2, slot: 4, bytes: Uint8Array.of(8) });
r.item({ storeId: 2, slot: 4, bytes: null });
assert.equal(JSON.parse(mem.get(VAULT_PREFIX + ID)).snaps[0x1000], undefined, 'snapshots are throttled, not written per frame');
r.flush();
assert.equal(r.key, ID, 'keyed by hub_instance_id');
const m = loadMachine(ID);
assert.equal(m.name, 'Bench');
assert.equal(m.identity.estop_cuts_power, true);
assert.equal(toHex(m.catalogBytes), toHex(CAT));
assert.deepEqual([...m.snapshots[0x1000]], [4, 5, 6], 'the last raw STATE bytes, never an ECHO');
assert.deepEqual(m.items.map((i) => [i.storeId, i.slot, [...i.bytes]]), [[2, 3, [7, 7]]], 'an emptied slot leaves the vault');
assert.ok(hasMachine(ID));

// A second machine without an id keys on host:port and leaves the first alone.
const r2 = recorder({ throttleMs: 60000 });
r2.welcome({ hub_name: 'Spare' }, '10.0.0.9', 8282);
r2.catalog(CAT);
r2.flush();
assert.equal(r2.key, '10.0.0.9:8282');
assert.equal(loadMachine('10.0.0.9:8282').name, 'Spare');
assert.deepEqual([...loadMachine(ID).snapshots[0x1000]], [4, 5, 6]);

// A reconnect to the same machine keeps what it had.
const r3 = recorder({ throttleMs: 60000 });
r3.welcome({ hub_instance_id: ID, hub_name: 'Bench' }, '10.0.0.5', 82);
r3.flush();
assert.deepEqual([...loadMachine(ID).snapshots[0x1000]], [4, 5, 6], 'a new session does not wipe the snapshot');
assert.equal(loadMachine('nope'), null);
assert.equal(hasMachine('nope'), false);

// A recorded machine replays through createLocalHub and the etag fast path.
const b = loadMachine(ID);
const cs = catalogStoreFor(b);
assert.equal(toHex(cs.load().etag), toHex(catalogEtag(CAT, LIMITS.etag_bytes)));
const hub = createLocalHub(hubOptions(b));
const s = createSession({ host: 'virtual.' + ID, autoReconnect: false, catalogStore: cs, WebSocketImpl: hub.WebSocket,
  subscriptions: [[0x0003, 0, 3]] });
let cached = null;
s.on('catalog', (_e, _m, meta) => { cached = meta.cached; });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no LIVE')), 3000); s.on('live', () => { clearTimeout(t); res(); }); s.connect(); });
assert.equal(cached, true, 'the vault catalog is the etag fast path');
assert.equal(s.identity.hub_name, 'Bench (virtual)');
assert.equal(s.identity.hub_instance_id, null, 'a replay never claims the machine id');
s.close();

// Every vault key rides the settings backup (prefs.js BACKUP_KEY).
const backup = JSON.parse(exportBackup(storage)).keys;
assert.ok(Object.keys(backup).some((k) => k === VAULT_PREFIX + ID + '.catalog'), 'vault keys are backed up');

// The catalog bytes live in the catalog cache, pinned by machine key; the vault entry is the etag alone.
assert.deepEqual(JSON.parse(mem.get(VAULT_PREFIX + ID + '.catalog')), { etag: toHex(catalogEtag(CAT, LIMITS.etag_bytes)) }, 'the vault entry holds no bytes');

// A quota storage (a per-origin cap in UTF-16 bytes, like a browser's): three 1 MiB catalogs fit because only etags are stored.
function quotaStorage(capBytes) {
  const m = new Map();
  const used = () => [...m].reduce((n, [k, v]) => n + 2 * (k.length + v.length), 0);
  return { m, used, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (used() - 2 * (m.has(k) ? k.length + m.get(k).length : 0) + 2 * (k.length + String(v).length) > capBytes) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k) };
}
const big = (seed) => Uint8Array.from({ length: 1 << 20 }, (_, i) => (i * 2654435761 + seed * 40503) >>> 24);
{
  const q = quotaStorage(4 * 1024 * 1024);
  const cache = createCatalogCache({ storage: q, idb: null });
  const bigs = [1, 2, 3].map(big);
  assert.throws(() => q.setItem('probe', toHex(bigs[0]) + toHex(bigs[1])), /Quota/, 'two hex copies of a 1 MiB catalog overflow this quota');
  bigs.forEach((bytes, i) => {
    const rr = recorder({ storage: q, cache, throttleMs: 60000 });
    rr.welcome({ hub_instance_id: 'cafe00000000000' + i, hub_name: 'M' + i }, '10.0.1.' + i, 82);
    rr.catalog(bytes);
    rr.flush();
  });
  bigs.forEach((bytes, i) => assert.equal(toHex(loadMachine('cafe00000000000' + i, q, cache).catalogBytes), toHex(bytes), 'machine ' + i + ': its 1 MiB catalog comes back'));
  assert.ok(q.used() < 64 * 1024, 'the vault writes no catalog bytes to localStorage: ' + q.used() + ' bytes held');
}

// Migration: a pre-cache entry ({etag, bytes: hex}) moves into the cache once IndexedDB is open, and only then.
function fakeIdb() {
  const data = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const req = (fn) => { const r = {}; later(() => { r.result = fn(); r.onsuccess?.(); }); return r; };
  const db = { transaction: () => ({ objectStore: () => ({
    put: (v, k) => req(() => { data.set(k, v.slice()); }), delete: (k) => req(() => { data.delete(k); }),
    getAllKeys: () => req(() => [...data.keys()]), getAll: () => req(() => [...data.values()]) }) }) };
  return { data, open: () => { const r = {}; later(() => { r.result = db; r.onupgradeneeded?.(); r.onsuccess?.(); }); db.createObjectStore = () => {}; return r; } };
}
{
  const etag = toHex(catalogEtag(CAT, LIMITS.etag_bytes));
  const seed = () => {
    const s = quotaStorage(1 << 30);
    s.setItem(VAULT_PREFIX + ID, JSON.stringify({ name: 'Old', identity: {}, snaps: {}, items: {}, savedAt: 1 }));
    s.setItem(VAULT_PREFIX + ID + '.catalog', JSON.stringify({ etag, bytes: toHex(CAT) }));
    s.setItem(VAULT_PREFIX + 'bad.catalog', JSON.stringify({ etag, bytes: '00ff' }));
    return s;
  };
  // No IndexedDB: nothing moves, the hex entry still replays.
  const s0 = seed();
  const c0 = createCatalogCache({ storage: s0, idb: null });
  assert.equal(await migrateVault(s0, c0), 0, 'a memory-only cache moves nothing');
  assert.equal(JSON.parse(s0.getItem(VAULT_PREFIX + ID + '.catalog')).bytes, toHex(CAT), 'the hex entry stays');
  assert.equal(toHex(loadMachine(ID, s0, c0).catalogBytes), toHex(CAT), 'and still replays');
  // IndexedDB open: the entry becomes the etag, the bytes are in IndexedDB, a fresh start replays from there.
  const s1 = seed(), idb = fakeIdb();
  const c1 = createCatalogCache({ storage: s1, idb });
  assert.equal(await migrateVault(s1, c1), 1, 'one entry moved (the bad one is skipped)');
  assert.deepEqual(JSON.parse(s1.getItem(VAULT_PREFIX + ID + '.catalog')), { etag }, 'the entry is the etag alone');
  assert.equal(JSON.parse(s1.getItem(VAULT_PREFIX + 'bad.catalog')).bytes, '00ff', 'an entry that misses its etag is left as it is');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...idb.data.keys()], [etag], 'the bytes are in IndexedDB, keyed by etag');
  assert.equal(await migrateVault(s1, c1), 0, 'once: a second run finds nothing to move');
  const c2 = createCatalogCache({ storage: s1, idb });
  assert.equal(loadMachine(ID, s1, c2), null, 'not before hydration');
  await c2.ready;
  assert.equal(toHex(loadMachine(ID, s1, c2).catalogBytes), toHex(CAT), 'after a restart the catalog comes from the cache');
  assert.ok(hasMachine(ID, s1));
}

console.log('vault: all passed');
