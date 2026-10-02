// prefs.test.mjs — app preferences and the autorange gate, no browser.
// Run: node test/prefs.test.mjs

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

const { prefs, setPref, loadPrefs, telemetryRate, DEFAULTS, PREFS_KEY } = await import('../src/model/prefs.js');
const { get } = await import('svelte/store');
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

console.log('PASS — prefs: load/version/sanitize, telemetry clamp, autorange gate');
