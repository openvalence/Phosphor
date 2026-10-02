/**
 * advanced-generator.test.mjs -- RENDERING §10 `generator-advanced` claim
 * (RFC-081 masters, RFC-066 modulators grouped by mod_target) and the §8.4
 * `list` slot model, against synthetic catalogs (no hub).
 *
 * Fails if the modulator count comes from a constant, if a partial modulator
 * is claimed, if a modulator lands under any field but the one its mod_target
 * names, if a missing essential role does not decline (law 7), if the
 * built-in binds differently from the factory substitute, or if a pending
 * slot reads as empty, or a locked store as empty (§8.4 row 9).
 *
 * Run: node test/advanced-generator.test.mjs
 */

import { buildSettingsModel, modTargetUid } from '../src/model/settings.js';
import { claimRoles, ROLE, ADVGEN_SPEC } from '../src/model/roles.js';
import { SLOT, pendingSlots, enumerateStore, storeOfRoster } from '../src/ui/widgets/roster.js';
import {
  PACKED, CHANNEL_CLASS, UI_RANK, VALUE_ASPECT, VALUE_SCOPE, ACCESS, NACK,
  BLOB_K, BlobError, BLOB_ERROR, cbMap, cbTstr, cbUint, decodeCatalog,
} from '../../Valence/clients/js/index.js';
import { readFileSync } from 'node:fs';
import { advgenCatalog } from './fixtures/advgen-roles-catalog.mjs';
import * as advPen from '../plugins/factory/advanced-penetration/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const lf = (name, role, settingKey, extra = {}) => ({
  name, role, settingKey, type: PACKED.u8, typeName: 'u8', unit: '%', scale: 1, min: 0, max: 100,
  provenanceName: 'actual', rank: UI_RANK.control, aspect: VALUE_ASPECT.live,
  scope: VALUE_SCOPE.session, scopeName: 'session', unitId: null, ...extra,
});
const state = (id, layout, extra = {}) => ({
  id, name: 'ch' + id, cls: CHANNEL_CLASS.STATE, dir: 0, access: ACCESS.watch,
  maxRateHz: 0, priority: 2, category: 1, settingChannel: 0x7700, layout, ...extra,
});

const BASE = 0x7720;
const MASTER_ROLES = [ROLE.advgenMaster, ROLE.advgenDepthMax, ROLE.advgenDepthMin,
  ROLE.advgenSpeedIn, ROLE.advgenSpeedOut, ROLE.advgenAccelIn, ROLE.advgenAccelOut];
const MOD_ROLES = [ROLE.modAmount, ROLE.modRise, ROLE.modHold, ROLE.modFall, ROLE.modRest, ROLE.modPhase];
const MOD_KEYS = ['amount', 'rise', 'hold', 'fall', 'rest', 'phase'];

// Modulators are declared in DESCENDING id order so the claim must sort them;
// modulator i rides base field i % 7, `orphan` adds one naming no field.
function catalog(modCount, { dropMaster = null, decoy = false, orphan = false, select = false, mode = false } = {}) {
  const out = [
    state(0x7710, [lf('go', ROLE.patternRunning, 1, { max: 1 }), lf('stay', ROLE.sourceBackgroundRun, 2, { max: 1 }),
      ...(select ? [lf('pick', ROLE.patternSelect, 9, { options: ['a', 'b'] })] : []),
      ...(mode ? [lf('adv', ROLE.advgenMode, 10, { max: 1 })] : [])]),
    state(BASE, MASTER_ROLES.filter((r) => r !== dropMaster).map((r, i) => lf('m' + i, r, 3 + i))),
  ];
  for (let i = modCount - 1; i >= 0; i--) {
    out.push(state(0x7740 + i, MOD_ROLES.map((r, j) => lf('l' + j, r, 20 + j, { group: 'Mod ' + i })),
      { modTarget: { channel: BASE, field: i % 7 } }));
  }
  if (decoy) out.push(state(0x7790, MOD_ROLES.slice(0, 5).map((r, j) => lf('d' + j, r, 60 + j)),
    { modTarget: { channel: BASE, field: 0 } }));
  if (orphan) out.push(state(0x77a0, MOD_ROLES.map((r, j) => lf('o' + j, r, 70 + j)),
    { modTarget: { channel: 0x7fff, field: 0 } }));
  return out;
}
const claim = (entries) => claimRoles(buildSettingsModel(entries).byRole, ADVGEN_SPEC);

console.log('generator-advanced claim');
for (const n of [0, 1, 6, 9]) {
  const c = claim(catalog(n));
  ok('claims exactly ' + n + ' declared modulator(s), no minimum', !!c && c.mods.length === n, c ? 'got ' + c.mods.length : 'declined');
}
{
  const c = claim(catalog(3));
  const ids = c.mods.map((m) => m.channelId);
  ok('modulators in ascending channel id', ids.join() === [...ids].sort((a, b) => a - b).join(), ids.join());
  ok('each modulator carries its six fields', c.mods.every((m) => MOD_KEYS.every((k) => m[k])));
  ok('run/stop and background_run bound by role', !!c.running && !!c.bgRun);
}
{
  const entries = catalog(9, { orphan: true });
  const c = claim(entries);
  const masters = MASTER_ROLES.map((_, i) => BASE + ':m' + i);
  const target = (m) => modTargetUid(entries, m.channelId);
  ok('every modulator groups under the base field its mod_target names', c.mods.filter((m) => m.channelId !== 0x77a0)
    .every((m) => target(m) === masters[(m.channelId - 0x7740) % 7]));
  ok('two modulators may ride one base field', c.mods.filter((m) => target(m) === masters[0]).length === 2);
  ok('a modulator whose target is absent groups under nothing', target(c.mods.find((m) => m.channelId === 0x77a0)) === null);
  const intent = [{ id: 0x3000, cls: CHANNEL_CLASS.INTENT, schema: [{ key: 4, name: 'x' }] },
    { id: 1, modTarget: { channel: 0x3000, field: 4 } }, { id: 2, modTarget: { channel: 0x3000, field: 5 } }];
  ok('an INTENT target is a schema key', modTargetUid(intent, 1) === '12288:4' && modTargetUid(intent, 2) === null);
}
{
  const c = claim(catalog(2, { decoy: true }));
  ok('an entry with five of six mod roles is not a modulator', c.mods.length === 2);
  ok('the decoy stays unclaimed (Tier 0)', ![...c.claimed].some((u) => u.startsWith(String(0x7790) + ':')));
}
for (const r of MASTER_ROLES) {
  ok('missing ' + r + ' declines', claim(catalog(3, { dropMaster: r })) === null);
}
ok('advgen.mode absent beside pattern.select declines', claim(catalog(1, { select: true })) === null);
ok('advgen.mode present beside pattern.select claims', !!claim(catalog(1, { select: true, mode: true })));
ok('no pattern.select: advgen.mode is optional', !!claim(catalog(1)));
{
  let spec = null;
  advPen.activate({ registerHero: (h) => { spec = h.spec; } });
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  ok('binds exactly what the factory substitute binds', !!spec && same(spec.require, ADVGEN_SPEC.require)
    && same(spec.optional, ADVGEN_SPEC.optional) && same(spec.instances.mods.roles, ADVGEN_SPEC.instances.mods.roles));
}
{
  const entries = decodeCatalog(advgenCatalog().bytes);
  const c = claim(entries);
  const base = new Set(['master', 'depthMax', 'depthMin', 'speedIn', 'speedOut', 'accelIn', 'accelOut'].map((k) => c && c[k].uid));
  ok('the reference catalog with its due roles claims six modulators', !!c && c.mods.length === 6);
  ok('... each riding a base control', !!c && c.mods.every((m) => base.has(modTargetUid(entries, m.channelId))));
  // The recorded catalog predates the roles: the widget must decline there.
  const real = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
  ok('the recorded catalog declines (no advgen/mod roles)', claim(real) === null);
}

console.log('\nroster slot model');
const STORE = { id: 0x7800, cls: CHANNEL_CLASS.STORE, access: ACCESS.control,
  store: { storeId: 9, kind: 'example.kind', capacity: 4, perItemMax: 40, nameMax: 16 } };
const itemBytes = (slot, name) => cbMap([[BLOB_K.slot, cbUint(slot)], [BLOB_K.name, cbTstr(name)]]);
const tick = () => new Promise((r) => setTimeout(r, 0));

{
  // slot 0 named, slot 1 empty, slot 2 never answers, slot 3 never asked.
  const slots = pendingSlots(STORE);
  const fetch = ({ slot }) => slot === 0 ? Promise.resolve({ slot, generation: 3, bytes: itemBytes(0, 'Alpha') })
    : slot === 1 ? Promise.reject(new BlobError(BLOB_ERROR.UNAVAILABLE, { ns: 1, storeId: 9, slot }, 'NACK'))
    : new Promise(() => {});
  enumerateStore(fetch, STORE, { role: ACCESS.control, onSlot: (r) => { slots[r.slot] = r; } });
  await tick(); await tick();
  ok('an answered item carries its name', slots[0].state === SLOT.item && slots[0].name === 'Alpha');
  ok('CHUNK_UNAVAILABLE reads as empty', slots[1].state === SLOT.empty);
  ok('an unanswered slot stays PENDING, not empty', slots[2].state === SLOT.pending);
  ok('a not-yet-asked slot stays PENDING, not empty', slots[3].state === SLOT.pending);
}
{
  let calls = 0;
  const seen = [];
  await enumerateStore(() => { calls++; return Promise.resolve(); }, STORE,
    { role: ACCESS.watch, onSlot: (r) => seen.push(r.state) });
  ok('role below the store floor: every slot LOCKED, not empty', seen.length === 4 && seen.every((s) => s === SLOT.locked));
  ok('role below the store floor: no request sent', calls === 0);
}
{
  const seen = [];
  const deny = ({ slot }) => Promise.reject(new BlobError(BLOB_ERROR.REFUSED, { ns: 1, storeId: 9, slot }, 'NACK',
    { nack: { code: slot === 0 ? NACK.ACCESS_DENIED : NACK.BUSY } }));
  await enumerateStore(deny, STORE, { role: ACCESS.control, onSlot: (r) => seen.push(r.state) });
  ok('NACK ACCESS_DENIED reads as locked', seen[0] === SLOT.locked);
  ok('any other refusal reads as an error, never empty', seen.slice(1).every((s) => s === SLOT.error));
}
{
  const roster = { id: 0x7801, cls: CHANNEL_CLASS.STATE, storeId: 9 };
  ok('a roster naming store_id finds its store', storeOfRoster([STORE, roster], roster) === STORE);
  ok('a roster without store_id links nothing (no adjacency guess)',
     storeOfRoster([STORE, { ...roster, storeId: undefined }], { ...roster, storeId: undefined }) === null);
}

console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS');
process.exit(fails ? 1 : 0);
