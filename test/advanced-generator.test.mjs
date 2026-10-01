/**
 * advanced-generator.test.mjs -- RENDERING §10 `generator-advanced` claim and
 * the §8.4 `list` slot model, against synthetic catalogs (no hub).
 *
 * Fails if the lane count comes from a constant (several counts are claimed
 * and each must come back exactly), if a partial lane is counted, if a missing
 * essential role does not decline (law 7), or if a pending slot reads as
 * empty, or a locked store as empty (§8.4 row 9).
 *
 * Run: node test/advanced-generator.test.mjs
 */

import { buildSettingsModel } from '../src/model/settings.js';
import { claimRoles, ROLE, DRAFT_ROLE, ADVGEN_SPEC } from '../src/model/roles.js';
import { SLOT, pendingSlots, enumerateStore, storeOfRoster } from '../src/ui/widgets/roster.js';
import {
  PACKED, CHANNEL_CLASS, UI_RANK, VALUE_ASPECT, VALUE_SCOPE, ACCESS, NACK,
  BLOB_K, BlobError, BLOB_ERROR, cbMap, cbTstr, cbUint, decodeCatalog,
} from '../../Valence/clients/js/index.js';
import { readFileSync } from 'node:fs';

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
const state = (id, layout) => ({
  id, name: 'ch' + id, cls: CHANNEL_CLASS.STATE, dir: 0, access: ACCESS.watch,
  maxRateHz: 0, priority: 2, category: 1, settingChannel: 0x7700, layout,
});

const MASTER_ROLES = [DRAFT_ROLE.advgenMaster, DRAFT_ROLE.advgenDepthMax, DRAFT_ROLE.advgenDepthMin,
  DRAFT_ROLE.advgenSpeedIn, DRAFT_ROLE.advgenSpeedOut, DRAFT_ROLE.advgenAccelIn, DRAFT_ROLE.advgenAccelOut];
const LANE_ROLES = [DRAFT_ROLE.laneAmplitude, DRAFT_ROLE.laneInStep, DRAFT_ROLE.laneInWait,
  DRAFT_ROLE.laneOutStep, DRAFT_ROLE.laneOutWait, DRAFT_ROLE.laneOffset];

// Lanes are declared in DESCENDING id order so the claim must sort them.
function catalog(laneCount, { dropMaster = null, decoy = false } = {}) {
  const out = [
    state(0x7710, [lf('go', ROLE.patternRunning, 1, { max: 1 }), lf('stay', ROLE.sourceBackgroundRun, 2, { max: 1 })]),
    state(0x7720, MASTER_ROLES.filter((r) => r !== dropMaster).map((r, i) => lf('m' + i, r, 3 + i))),
  ];
  for (let i = laneCount - 1; i >= 0; i--) {
    out.push(state(0x7740 + i, LANE_ROLES.map((r, j) => lf('l' + j, r, 20 + j, { group: 'Lane ' + i }))));
  }
  if (decoy) out.push(state(0x7790, LANE_ROLES.slice(0, 5).map((r, j) => lf('d' + j, r, 60 + j))));
  return out;
}
const claim = (entries) => claimRoles(buildSettingsModel(entries).byRole, ADVGEN_SPEC);

console.log('generator-advanced claim');
for (const n of [1, 2, 5, 9]) {
  const c = claim(catalog(n));
  ok('claims exactly ' + n + ' declared lane(s)', !!c && c.lanes.length === n, c ? 'got ' + c.lanes.length : 'declined');
}
{
  const c = claim(catalog(3));
  const ids = c.lanes.map((l) => l.channelId);
  ok('lanes in ascending channel id', ids.join() === [...ids].sort((a, b) => a - b).join(), ids.join());
  ok('each lane carries its six fields', c.lanes.every((l) => l.amplitude && l.inStep && l.inWait
    && l.outStep && l.outWait && l.offset));
  ok('run/stop and background_run bound by role', !!c.running && !!c.bgRun);
}
{
  const c = claim(catalog(2, { decoy: true }));
  ok('a channel with five of six lane roles is not a lane', c.lanes.length === 2);
  ok('the decoy stays unclaimed (Tier 0)', ![...c.claimed].some((u) => u.startsWith(String(0x7790) + ':')));
}
ok('zero complete lanes declines', claim(catalog(0)) === null);
for (const r of MASTER_ROLES) {
  ok('missing ' + r + ' declines', claim(catalog(3, { dropMaster: r })) === null);
}
{
  // The reference hub carries no draft roles yet: the widget must decline and
  // no roster may link a store (no store_id on the wire).
  const real = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
  ok('the reference catalog declines (no advgen/lane roles yet)', claim(real) === null);
  ok('no reference roster links a store yet (RFC-070 unadopted)', real.every((e) => storeOfRoster(real, e) === null));
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
