/**
 * trial-host.test.mjs -- the host API's trial writes (Valence RFC-099) through
 * the REAL plugin host against a fake hub that keeps the stored value, the
 * baseline and the meta.trial_pending mark the way a trial-capable hub does.
 *
 * Asserts: writeTrial, commitTrial and revertTrial need `intent`; a trial is
 * live and marked while the stored value stays; revert puts the stored value
 * back; commit stores the trial value; a hub without settings-trial and a
 * field that is not a setting are refused in words before the shadow;
 * trialPending is a read-only property; a trial NACKed UNSUPPORTED_OP marks its
 * channel:key for the session (RFC-107 draft): no trial retry, the next write
 * goes durable, a new session starts the mark over.
 *
 * Run: node test/trial-host.test.mjs
 */

import { createPluginHost } from '../src/plugins/host.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const SPEED = { uid: '130:speed', channelId: 130, name: 'speed', label: 'Speed', type: 2, readOnly: false,
  writeChannel: 131, settingKey: 2, role: 'limit.input.speed' };
const POS = { uid: '129:pos', channelId: 129, name: 'pos', label: 'Position', type: 2, readOnly: true,
  role: 'telemetry.position' };
const model = { fields: [SPEED, POS], byRole: new Map([['limit.input.speed', [SPEED]]]), actions: [], categories: [] };

// ---- the fake hub: one setting, its stored value, one trial baseline, the mark
const hub = { capable: true, stored: 500, baseline: null, sample: { speed: 500, trial_mask: 0 }, writes: 0,
  sid: 1, refuse: new Set(), trials: [], durable: [] };
const deps = {
  model: () => model,
  sample: (ch) => (ch === 130 ? hub.sample : undefined),
  sampleAge: () => 0,
  display: (f, s) => (s ? s[f.name] : undefined),
  status: () => 'confirmed',
  write: (f, v) => { hub.writes++; hub.durable.push([f.uid, v]); return Promise.resolve({ ok: true }); },
  session: () => hub.sid,
  trialCapable: () => hub.capable,
  writeTrial: (f, v, noTrial) => {
    hub.trials.push([f.uid, v]);
    // The shadow's answer to an UNSUPPORTED_OP NACK arrives after the call returns.
    if (hub.refuse.has(f.writeChannel + ':' + f.settingKey)) { Promise.resolve().then(noTrial); return; }
    if (hub.baseline == null) hub.baseline = hub.sample.speed;
    hub.sample.speed = v;
    hub.sample.trial_mask = 1;
  },
  trialOp: async (op) => {
    if (op === 'commit') hub.stored = hub.sample.speed;
    else if (hub.baseline != null) hub.sample.speed = hub.baseline;
    hub.baseline = null;
    hub.sample.trial_mask = 0;
    return { ok: true };
  },
  trialPending: () => hub.sample.trial_mask !== 0,
  registerTheme: () => {},
  prefs: null,
  log: () => {},
};
const host = createPluginHost(deps);

let api = null;
let bare = null;
host.add({ name: 'tuner', version: '1', api: 1, kind: 'widget', permissions: ['intent'] },
  { activate(a) { api = a; } }, { source: 'test' });
host.add({ name: 'viewer', version: '1', api: 1, kind: 'widget', permissions: [] },
  { activate(a) { bare = a; } }, { source: 'test' });

console.log('(a) the permission');
for (const [what, fn] of [['writeTrial', () => bare.writeTrial(SPEED, 600)], ['commitTrial', () => bare.commitTrial()],
  ['revertTrial', () => bare.revertTrial()]]) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  ok(what + ' without intent throws PermissionError', threw && threw.name === 'PermissionError');
}

console.log('(b) live, marked, not stored; revert puts it back');
api.writeTrial(SPEED, 650);
ok('the trial value is what the machine reports', api.value(SPEED) === 650);
ok('trialPending reads the machine mark', api.trialPending === true);
ok('the stored value stays', hub.stored === 500);
api.writeTrial(SPEED, 700);
let r = await api.revertTrial();
ok('revert resolves ok', r && r.ok);
ok('revert puts the stored value back, first baseline', api.value(SPEED) === 500, api.value(SPEED));
ok('no trial pending after revert', api.trialPending === false);

console.log('(c) commit stores it');
api.writeTrial(SPEED, 720);
r = await api.commitTrial();
ok('commit resolves ok', r && r.ok);
ok('the committed value is stored and live', hub.stored === 720 && api.value(SPEED) === 720);
ok('no trial pending after commit', api.trialPending === false);
ok('no durable write went out', hub.writes === 0);

console.log('(d) refusals in words, before the shadow');
const nonSetting = api.writeTrial(POS, 1);
ok('a read-only field is not a setting', nonSetting && nonSetting.ok === false && nonSetting.error === 'not a setting');
hub.capable = false;
const before = hub.sample.speed;
const noHub = api.writeTrial(SPEED, 800);
ok('a hub without settings-trial refuses', noHub && noHub.ok === false && noHub.error === 'hub has no trial writes');
ok('and nothing reached the hub', hub.sample.speed === before);
r = await api.commitTrial();
ok('commit on such a hub refuses', r && r.ok === false && r.error === 'hub has no trial writes');
hub.capable = true;

console.log('(e) trialPending is read-only');
let threw = null;
try { api.trialPending = true; } catch (e) { threw = e; }
ok('assigning it throws', threw instanceof TypeError);

console.log('(f) a trial NACKed UNSUPPORTED_OP marks its key: no retry, the next write is durable');
const CHASE = { uid: '12576:chase_dense_ms', channelId: 12576, name: 'chase_dense_ms', label: 'Chase dense ms', type: 2,
  readOnly: false, writeChannel: 12576, settingKey: 10, role: 'tuning.chase_dense_ms' };
const OTHER = { ...CHASE, uid: '4000:other', writeChannel: 4000 };   // same key, another channel
hub.refuse.add('12576:10');
hub.trials.length = 0;
api.writeTrial(CHASE, 30);
await Promise.resolve();
ok('the first edit goes out as a trial', hub.trials.length === 1 && hub.trials[0][1] === 30, JSON.stringify(hub.trials));
await api.writeTrial(CHASE, 40);
ok('the next edit is a durable write of the new value', hub.durable.length === 1 && hub.durable[0][0] === CHASE.uid && hub.durable[0][1] === 40,
  JSON.stringify(hub.durable));
ok('and the trial is not retried', hub.trials.length === 1, hub.trials.length);
api.writeTrial(OTHER, 50);
ok('the mark is channel:key, not the key alone', hub.trials.length === 2 && hub.durable.length === 1);
api.writeTrial(SPEED, 660);
ok('another key still goes as a trial', hub.trials.length === 3 && hub.sample.speed === 660);
hub.sid = 2;
api.writeTrial(CHASE, 60);
ok('a new session starts the mark over: the key is tried again', hub.trials.length === 4 && hub.durable.length === 1);
await api.revertTrial();

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
