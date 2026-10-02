// prefs.test.mjs — app preferences and the autorange gate, no browser.
// Run: node --conditions=browser test/prefs.test.mjs (the client svelte build,
// so the autorange switch's re-render can be observed)

import assert from 'node:assert/strict';

// A Map-backed localStorage, installed before prefs.js reads it at import.
const mem = new Map([['phosphor.prefs', JSON.stringify({ v: 1, autorange: false, units: 'imperial', telemetryHz: -3 })]]);
const storage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const {
  prefs, setPref, loadPrefs, telemetryRate, DEFAULTS, PREFS_KEY,
  savedHubs, rememberHub, renameHub, forgetHub, hubKey, hubLabel, launchTarget, HUBS_KEY,
  exportBackup, importBackup,
} = await import('../src/model/prefs.js');
const { get, toStore } = await import('svelte/store');
const { flushSync } = await import('svelte');
const { formatWithUnit, setAutorange, autorange } = await import('../src/model/format.js');
const { UNIT_ID } = await import('../../Valence/clients/js/index.js');

// Load: valid fields kept, bad ones take their default; the stored copy is stamped.
assert.deepEqual(get(prefs), { autorange: false, units: 'metric', reconnect: true, telemetryHz: null });
assert.deepEqual(loadPrefs(null), { ...DEFAULTS });
assert.deepEqual(loadPrefs('garbage'), { ...DEFAULTS });
setPref('reconnect', false);
assert.deepEqual(JSON.parse(mem.get(PREFS_KEY)), { v: 1, autorange: false, units: 'metric', reconnect: false, telemetryHz: null });
setPref('units', 'furlongs');
assert.equal(get(prefs).units, 'metric', 'only known unit systems');

// Telemetry: the preference, else the client default, never above the catalog max.
assert.equal(telemetryRate(100, 50), 50);
setPref('telemetryHz', 200);
assert.equal(telemetryRate(100, 50), 100, 'clamped to max_rate_hz');
setPref('telemetryHz', 25);
assert.equal(telemetryRate(100, 50), 25);
assert.equal(telemetryRate(0, 50), 0, 'on-change stays on-change');

// Autorange (RFC-086): display only, prefix by magnitude, bounded per unit.
const V = { unitId: UNIT_ID.v, step: 0.001 };
const ms = { unitId: UNIT_ID.ms, step: 1 };
const NB = ' ';
assert.equal(formatWithUnit(V, 0.085), '85' + NB + 'mV');
assert.equal(formatWithUnit(V, 12.5), '12.500' + NB + 'V');
assert.equal(formatWithUnit(ms, 1500), '1.500' + NB + 's');
assert.equal(formatWithUnit(ms, 0.5), '500' + NB + 'µs');
assert.equal(formatWithUnit(ms, 7200000), '7200.000' + NB + 's', 'no kiloseconds');
assert.equal(formatWithUnit({ unitId: UNIT_ID.mm, step: 1 }, 1500), '1500' + NB + 'mm', 'lengths never autorange');
assert.equal(autorange(V, 0, 'V'), null, 'zero keeps its unit');
setAutorange(false);
assert.equal(formatWithUnit(V, 0.085), '0.085' + NB + 'V', 'off: the declared unit');
setAutorange(true);
// A shown value re-renders the moment the switch flips, not on its next update.
const shown = [];
const stopShown = toStore(() => formatWithUnit(V, 0.085)).subscribe((t) => shown.push(t));
setAutorange(false);
flushSync();
setAutorange(true);
flushSync();
stopShown();
assert.deepEqual(shown, ['85' + NB + 'mV', '0.085' + NB + 'V', '85' + NB + 'mV'], 'the toggle re-renders at once');

// Saved hubs: keyed on hub_instance_id, else the dialed endpoint; port kept.
const ID = '00a1b2c3d4e5f607';
assert.equal(hubKey({ hub_instance_id: ID.toUpperCase() }, 'h', 82), ID);
assert.equal(hubKey(null, '10.0.0.5', 8282), '10.0.0.5:8282');
assert.equal(hubKey({ hub_instance_id: 'nothex' }, 'h', 82), 'h:82', 'a malformed id is no id');
rememberHub({ identity: null, host: '10.0.0.5', port: 8282, now: 1 });
renameHub('10.0.0.5:8282', '  Bench sim ');
rememberHub({ identity: { hub_instance_id: ID, hub_name: 'Nucleus' }, host: '10.0.0.5', port: 8282, now: 2 });
assert.deepEqual(get(savedHubs), [{ id: ID, host: '10.0.0.5', port: 8282, name: 'Nucleus', nickname: 'Bench sim', lastSeen: 2 }],
  'the id replaces the endpoint entry and keeps its nickname');
rememberHub({ identity: { hub_instance_id: ID }, host: '10.0.0.9', port: 82, now: 3 });
assert.equal(get(savedHubs).length, 1, 'same hub at a new address is one entry');
assert.equal(get(savedHubs)[0].host, '10.0.0.9');
rememberHub({ identity: null, host: 'sim.local', port: 8282, now: 4 });
assert.deepEqual(get(savedHubs).map(hubLabel), ['sim.local:8282', 'Bench sim'], 'most recent first');
assert.deepEqual(JSON.parse(mem.get(HUBS_KEY)), get(savedHubs), 'persisted');

// ph-dwy: the launch redial dials the saved host AND port.
const hubs = get(savedHubs);
assert.deepEqual(launchTarget({ reconnect: true, mode: 'ws', hubs }), { host: 'sim.local', port: 8282 });
assert.deepEqual(launchTarget({ reconnect: true, mode: null, hubs }), { host: 'sim.local', port: 8282 });
assert.equal(launchTarget({ reconnect: false, mode: 'ws', hubs }), null, 'preference off');
assert.equal(launchTarget({ reconnect: true, mode: 'ble', hubs }), null, 'last session was BLE');
assert.deepEqual(launchTarget({ reconnect: true, mode: 'ws', hubs: [], legacyHost: 'old' }), { host: 'old' });
forgetHub('sim.local:8282');
assert.deepEqual(get(savedHubs).map((h) => h.id), [ID]);

// Backup: client-owned keys only, both ways.
mem.set('phosphor.layouts', '{"Default":{}}');
mem.set('ui_hivis', '1');
mem.set('valence.catalog.127.0.0.1', 'not ours');
const b = JSON.parse(exportBackup());
assert.equal(b.app, 'phosphor');
assert.deepEqual(Object.keys(b.keys).sort(), ['phosphor.hubs', 'phosphor.layouts', 'phosphor.prefs', 'ui_hivis']);
mem.delete('phosphor.layouts');
b.keys['valence.catalog.127.0.0.1'] = 'forged';
b.keys['ui_terse'] = 1;
assert.equal(importBackup(JSON.stringify(b)), 4, 'foreign and non-string keys are skipped');
assert.equal(mem.get('phosphor.layouts'), '{"Default":{}}');
assert.equal(mem.get('valence.catalog.127.0.0.1'), 'not ours');
assert.throws(() => importBackup('{"keys":{}}'), /not a Phosphor backup/);
assert.throws(() => importBackup('nope'));

console.log('PASS — prefs: load/version/sanitize, telemetry clamp, autorange gate, saved hubs, launch redial, backup');
