// merge.test.mjs -- staging and the merge diff, no browser: what stages and
// what never does, rows in live catalog order, inert rows, default ticks,
// applied rows leaving staging, NACKs and declined confirms staying.
// Run: node test/merge.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/index.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { stageEcho, mergeRows, defaultTicks, applyRows, unstage, sameValue } from '../src/model/merge.js';

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const fields = buildSettingsModel(decodeCatalog(CAT)).fields;
const K = 'feedc0de00000001';
const uid = (ch, name) => ch + ':' + name;

// Staging: setting fields only; never a source's run flag.
const staging = {};
assert.equal(stageEcho(staging, K, fields, 0x3000, { 2: 700, 1: 5 }), 2);
assert.equal(stageEcho(staging, K, fields, 0x3200, { 1: true, 3: 40 }), 1, 'pattern.running never stages');
assert.ok(!staging[K][uid(0x1200, 'running')]);
assert.equal(staging[K][uid(0x1000, 'window_max')].value, 700);
assert.equal(stageEcho(staging, K, fields, 0x3101, { 1: 1 }), 0, 'a verb stages nothing');
const secret = { uid: '7e00:passphrase', name: 'passphrase', writeChannel: 0x7e01, settingKey: 6, flagBits: { secret: true } };
assert.equal(stageEcho(staging, K, [secret], 0x7e01, { 6: true }), 0, 'a secret never stages (ph-buvu)');
stageEcho(staging, K, fields, 0x3000, { 2: 650 });
assert.equal(staging[K][uid(0x1000, 'window_max')].value, 650, 'the latest echo wins');
// A field the live hub will lack, and one whose type will change.
staging[K]['9999:ghost'] = { uid: '9999:ghost', name: 'ghost', group: '', typeName: 'f32', writeChannel: 0x9999, settingKey: 1, value: 3 };

// Rows: live catalog order, current vs staged, inert reasons.
const live = fields.map((f) => (f.uid === uid(0x1000, 'window_min') ? { ...f, typeName: 'u16' } : f));
const samples = { [0x1000]: { window_min: 5, window_max: 500 }, [0x1200]: { speed: 40 } };
const rows = mergeRows(staging[K], live, samples);
assert.deepEqual(rows.map((r) => r.uid), [uid(0x1000, 'window_min'), uid(0x1000, 'window_max'), uid(0x1200, 'speed'), '9999:ghost']);
const row = (u) => rows.find((r) => r.uid === u);
assert.equal(row(uid(0x1000, 'window_max')).current, 500);
assert.equal(row(uid(0x1000, 'window_max')).value, 650);
assert.equal(row(uid(0x1000, 'window_min')).inert, 'not on this hub', 'a changed type is inert');
assert.equal(row('9999:ghost').inert, 'not on this hub', 'a missing field is inert');
assert.equal(row(uid(0x1200, 'speed')).differs, false);
assert.deepEqual([...defaultTicks(rows)], [uid(0x1000, 'window_max')], 'pre-ticked only where it differs and applies');
assert.ok(sameValue(true, 1) && sameValue(0.1, Math.fround(0.1)) && !sameValue(1, 2));

// Apply: one intent per ticked row in order; applied leaves staging, a NACK stays.
const sent = [];
const ticked = new Set([uid(0x1000, 'window_max'), uid(0x1200, 'speed'), uid(0x1000, 'window_min'), '9999:ghost']);
const res = await applyRows(staging, K, rows, ticked, {
  send: async (r) => {
    sent.push(r.uid);
    if (r.uid === uid(0x1200, 'speed')) throw Object.assign(new Error('intent NACK INVALID_VALUE'), { code: 0x0302, name: 'INVALID_VALUE', detail: 'speed' });
    return { applied: { [r.field.settingKey]: r.value } };
  },
  confirm: async () => true,
});
assert.deepEqual(sent, [uid(0x1000, 'window_max'), uid(0x1200, 'speed')], 'inert rows are never sent');
assert.equal(res[uid(0x1000, 'window_max')].phase, 'settled');
assert.equal(res[uid(0x1200, 'speed')].text, 'INVALID_VALUE: speed', 'the hub reason rides the row');
assert.ok(!staging[K][uid(0x1000, 'window_max')], 'applied clears staging');
assert.ok(staging[K][uid(0x1200, 'speed')], 'a NACK stays staged');

// A destructive setting waits on the confirm; declined, nothing is sent.
const arm = { ...fields.find((f) => f.uid === uid(0x1000, 'window_max')), uid: 'x:arm', flagBits: { destructive: true } };
const st2 = {};
stageEcho(st2, K, [arm], 0x3000, { [arm.settingKey]: 1 });
const rows2 = mergeRows(st2[K], [arm], {});
assert.equal(rows2[0].confirm, true);
const sent2 = [];
const res2 = await applyRows(st2, K, rows2, new Set(['x:arm']), { send: async (r) => { sent2.push(r); return { applied: {} }; }, confirm: async () => false });
assert.equal(sent2.length, 0);
assert.equal(res2['x:arm'].text, 'not confirmed');

unstage(st2, K, 'x:arm');
assert.deepEqual(st2, {}, 'an emptied machine leaves staging');
console.log('merge: all passed');
