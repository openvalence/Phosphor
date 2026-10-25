// catalog-cache.test.mjs -- the etag-keyed catalog cache (SPEC §8.6, RFC-121), no browser: a config-mode
// catalog never overwrites the machine's, the same address in both modes, the pre-RFC-121 localStorage
// migration, the IndexedDB write-through and hydration, and real sessions taking the etag fast path.
// Run: node test/catalog-cache.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const memStorage = () => {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    m,
  };
};
const ls = memStorage();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });

const { createCatalogCache, POINTERS } = await import('../src/model/catalog-cache.js');
const { createLocalHub, createSession, catalogEtag, LIMITS, toHex, decodeCatalog } =
  await import('../../Valence/clients/js/index.js');
const { cbDecode, head, concatBytes } = await import('../../Valence/clients/js/cbor.js');

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
// The provisioning catalog (SPEC §13.4.1): the full catalog's entries, byte-identical, for the setup ids only.
const SETUP_IDS = new Set([0x0001, 0x0003, 0x0005, 0x000e, 0x000f, 0x0017, 0x0018, 0x0019, 0x001a]);
const PROV = (() => {
  const ids = decodeCatalog(CAT).map((e) => e.id);
  let pos = head(4, ids.length).length;
  const keep = [];
  for (const id of ids) {
    const [, next] = cbDecode(CAT, pos);
    if (SETUP_IDS.has(id)) keep.push(CAT.slice(pos, next));
    pos = next;
  }
  return concatBytes([head(4, keep.length), ...keep]);
})();
const etag = (b) => catalogEtag(b, LIMITS.etag_bytes);
const hex = (b) => toHex(etag(b));
assert.notEqual(hex(PROV), hex(CAT), 'membership alone moves the etag');

const HUB = 'feedc0de00000001';
const ctx = (configMode, hub = HUB) => ({ configMode: () => configMode, hubKey: () => hub });

// ---- keying: a config-mode catalog never overwrites the machine catalog ------------------------------
{
  const c = createCatalogCache({ storage: memStorage(), idb: null });
  const ws = c.sessionStore(ctx(false));
  const ble = c.sessionStore(ctx(true));
  assert.equal(ws.load('10.0.0.5'), null, 'nothing cached yet');
  ws.save('10.0.0.5', etag(CAT), CAT);
  assert.equal(toHex(ws.load('10.0.0.5').etag), hex(CAT));

  // The same address in config mode: a provisioning catalog adopted there lands under setup only.
  assert.equal(ble.load('10.0.0.5'), null, 'config mode never presents the machine etag');
  ble.save('10.0.0.5', etag(PROV), PROV);
  assert.equal(toHex(ble.load('10.0.0.5').etag), hex(PROV), 'config mode presents the last provisioning etag');
  assert.equal(toHex(ws.load('10.0.0.5').etag), hex(CAT), 'the machine catalog survives a config-mode adoption');

  // A config-mode etag mismatch clears the setup pointer only.
  ble.clear('10.0.0.5');
  assert.equal(ble.load('10.0.0.5'), null);
  assert.equal(toHex(ws.load('10.0.0.5').etag), hex(CAT), 'a config-mode clear never drops the machine catalog');

  // A BLE address learns the hub in config mode; it never re-points a host already known.
  ble.save('AA:BB:CC:DD:EE:FF', etag(PROV), PROV);
  assert.equal(toHex(ble.load('AA:BB:CC:DD:EE:FF').etag), hex(PROV));
  const other = c.sessionStore(ctx(true, 'aaaaaaaaaaaaaaaa'));
  other.save('10.0.0.5', etag(PROV), PROV);
  assert.equal(toHex(ws.load('10.0.0.5').etag), hex(CAT), 'a config-mode session never re-points a known host');

  // WELCOME in config mode never makes a held catalog the machine's.
  const c2 = createCatalogCache({ storage: memStorage(), idb: null });
  c2.sessionStore(ctx(true)).save('h', etag(CAT), CAT);
  c2.welcome('h', HUB, etag(CAT), true);
  assert.equal(c2.sessionStore(ctx(false)).load('h'), null, 'config mode never sets the machine etag');
  c2.welcome('h', HUB, etag(CAT), false);
  assert.equal(toHex(c2.sessionStore(ctx(false)).load('h').etag), hex(CAT), 'a normal WELCOME under a held etag sets it');

  // Bytes that do not hash to the etag are never stored.
  const c3 = createCatalogCache({ storage: memStorage(), idb: null });
  c3.sessionStore(ctx(false)).save('h', etag(CAT), PROV);
  assert.equal(c3.sessionStore(ctx(false)).load('h'), null, 'a mismatched etag is refused');

  // A normal-mode clear (new firmware) drops the machine pointer; the unreferenced bytes go with it.
  ws.clear('10.0.0.5');
  assert.equal(ws.load('10.0.0.5'), null);
}

// ---- the pre-RFC-121 cache: hex in localStorage keyed by host, moved once ---------------------------
{
  const s = memStorage();
  s.setItem('valence.catalog.192.168.1.40', JSON.stringify({ etag: hex(CAT), bytes: toHex(CAT) }));
  s.setItem('valence.catalog.bad', JSON.stringify({ etag: hex(CAT), bytes: toHex(PROV) }));
  s.setItem('valence.catalog.junk', '{');
  s.setItem('phosphor.keep', 'x');
  const c = createCatalogCache({ storage: s, idb: null });
  assert.equal([...s.m.keys()].filter((k) => k.startsWith('valence.catalog.')).length, 0, 'legacy keys are removed');
  assert.equal(s.getItem('phosphor.keep'), 'x', 'other keys untouched');
  const ws = c.sessionStore(ctx(false, null));
  assert.equal(toHex(ws.load('192.168.1.40').etag), hex(CAT), 'a legacy catalog is the fast path at its host');
  assert.equal(ws.load('bad'), null, 'a legacy entry whose bytes miss its etag is dropped');
  assert.equal(c.sessionStore(ctx(true, null)).load('192.168.1.40'), null, 'a legacy catalog is never a setup catalog');
  // The first WELCOME re-points the host by hub; the bare-host pointer goes.
  c.welcome('192.168.1.40', HUB, etag(CAT), false);
  const p = JSON.parse(s.getItem(POINTERS));
  assert.deepEqual(p.machine, { [HUB]: hex(CAT) });
  assert.equal(p.hosts['192.168.1.40'], HUB);
  // One-time: a second start finds nothing to move and keeps the pointers.
  const again = createCatalogCache({ storage: s, idb: null });
  assert.equal(JSON.parse(s.getItem(POINTERS)).machine[HUB], hex(CAT));
  assert.equal(again.sessionStore(ctx(false)).load('192.168.1.40'), null, 'bytes were memory-only with no IndexedDB');
}

// ---- IndexedDB: write-through, then a fresh start hydrates from it -----------------------------------
function fakeIdb() {
  const data = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const req = (fn) => { const r = {}; later(() => { r.result = fn(); r.onsuccess?.(); }); return r; };
  const db = {
    transaction: () => ({ objectStore: () => ({
      put: (v, k) => req(() => { data.set(k, v.slice()); }),
      delete: (k) => req(() => { data.delete(k); }),
      getAllKeys: () => req(() => [...data.keys()]),
      getAll: () => req(() => [...data.values()]),
    }) }),
  };
  return { data, open: () => { const r = {}; later(() => { r.result = db; r.onupgradeneeded?.(); r.onsuccess?.(); }); db.createObjectStore = () => {}; return r; } };
}
{
  const s = memStorage();
  const idb = fakeIdb();
  const c = createCatalogCache({ storage: s, idb });
  c.sessionStore(ctx(false)).save('h', etag(CAT), CAT);   // before the database opens: queued
  await c.ready;
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...idb.data.keys()], [hex(CAT)], 'bytes are written through to IndexedDB, keyed by etag');
  c.sessionStore(ctx(true)).save('h', etag(PROV), PROV);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(idb.data.size, 2);
  const fresh = createCatalogCache({ storage: s, idb });
  assert.equal(fresh.sessionStore(ctx(false)).load('h'), null, 'not before hydration');
  await fresh.ready;
  assert.equal(toHex(fresh.sessionStore(ctx(false)).load('h').etag), hex(CAT), 'hydrated machine catalog');
  assert.equal(toHex(fresh.sessionStore(ctx(true)).load('h').etag), hex(PROV), 'hydrated provisioning catalog');
  fresh.sessionStore(ctx(true)).clear('h');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...idb.data.keys()], [hex(CAT)], 'unreferenced bytes leave IndexedDB');
}

// ---- pins: the vault's catalog for a machine the hub is away from -------------------------------------
{
  const s = memStorage();
  const idb = fakeIdb();
  const c = createCatalogCache({ storage: s, idb });
  assert.equal(c.durable, false, 'not durable before IndexedDB opens');
  await c.ready;
  assert.equal(c.durable, true);
  assert.equal(c.pin('m1', CAT), hex(CAT));
  c.sessionStore(ctx(false)).save('h', etag(PROV), PROV);
  c.sessionStore(ctx(false)).clear('h');   // the hub's own pointer goes; the pin keeps CAT, PROV (unpinned) goes
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...idb.data.keys()], [hex(CAT)], 'a pinned catalog survives the hub pointers dropping; the unreferenced one leaves');
  const fresh = createCatalogCache({ storage: s, idb });
  assert.equal(fresh.pinned('m1'), null, 'not before hydration');
  await fresh.ready;
  assert.equal(toHex(catalogEtag(fresh.pinned('m1'), LIMITS.etag_bytes)), hex(CAT), 'hydrated pin');
  assert.equal(fresh.pinned('nope'), null);
}

// ---- real sessions: machine, then config mode at the same address, then the machine's fast path -------
{
  const c = createCatalogCache({ storage: memStorage(), idb: null });
  let configMode = false;
  let key = null;
  const store = c.sessionStore({ configMode: () => configMode, hubKey: () => key });
  async function run(bytes) {
    const hub = createLocalHub({ catalogBytes: bytes, identity: { hub_name: 'Bench' } });
    const s = createSession({ host: '10.0.0.9', autoReconnect: false, catalogStore: store, WebSocketImpl: hub.WebSocket,
      subscriptions: [[0x0003, 0, 3]] });
    s.on('welcome', () => { key = '10.0.0.9:82'; });
    let cached = null;
    s.on('catalog', (_e, _m, meta) => { cached = meta.cached; });
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no LIVE')), 3000); s.on('live', () => { clearTimeout(t); res(); }); s.connect(); });
    s.close();
    return cached;
  }
  assert.equal(await run(CAT), false, 'first contact fetches');
  configMode = true;
  assert.equal(await run(PROV), false, 'config mode fetches its own catalog');
  configMode = false;
  assert.equal(await run(CAT), true, 'the machine catalog is still the fast path after a config-mode session');
  configMode = true;
  assert.equal(await run(PROV), true, 'and the provisioning catalog is the fast path in config mode');
}

console.log('catalog-cache: all passed');
