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

const { recorder, loadMachine, hasMachine, hubOptions, catalogStoreFor, VAULT_PREFIX } =
  await import('../src/model/vault.js');
const { exportBackup } = await import('../src/model/prefs.js');
const { createLocalHub, createSession, encodeFrame, FRAME, catalogEtag, LIMITS, toHex } =
  await import('../../Valence/clients/js/index.js');

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
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

console.log('vault: all passed');
