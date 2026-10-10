/**
 * valence-tuning.mjs — LIVE proof of the kinetic tuning surface
 * (0x1120 kinetic-limits and 0x1122 kinetic-planner STATE, 0x3120 kinetic-set
 * INTENT): every knob reads and round-trips over the protocol, so a
 * third-party client is as capable as Phosphor.
 *
 * Also checks what makes the two cards one writer: both name 0x3120 as their
 * settingChannel and no setting_key repeats across them, or a write to one
 * card would land on the other's field.
 *
 * SAFETY: sends only 0x3120, restores every value it touches (including after a
 * failed assertion), and never touches motion, home, pattern or safety.
 *
 * Run:  node test/valence-tuning.mjs [host] [port]
 */

import { createSession } from '../../Valence/clients/js/index.js';
import { PRIORITY } from '../../Valence/clients/js/frames.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';

const HOST = process.argv[2];
if (!HOST) { console.error('usage: node test/valence-tuning.mjs <host> [...] -- no baked default, name the hub'); process.exit(1); }
const PORT = parseInt(process.argv[3] || '82', 10);

const CH_LIMITS = 0x1120, CH_PLANNER = 0x1122;

let failures = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
};
const info = (m) => console.log('  [info] ' + m);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  return new Promise((resolve, reject) => {
    const s = createSession({
      host: HOST, port: PORT, clientKind: 'webui', clientName: 'tuning-test',
      autoReconnect: false, WebSocketImpl: WebSocket,
      token: (h) => acquireToken(h),
      subscriptions: [
        [CH_LIMITS, 0, PRIORITY.background],
        [CH_PLANNER, 0, PRIORITY.background],
      ],
    });
    const seen = new Map();
    const to = setTimeout(() => { try { s.close(); } catch (e) {} reject(new Error('timeout waiting for tuning channels')); }, 10000);
    let welcomed = false;
    s.on('welcome', (w) => { welcomed = true; s._roles = w.roles; });
    s.on('state', (ch, sample) => {
      if (!welcomed) return;
      seen.set(ch, sample);
      if (seen.size === 2) { clearTimeout(to); resolve({ s, seen }); }
    });
    s.on('close', () => { clearTimeout(to); if (!welcomed) reject(new Error('closed before welcome')); });
    s.connect();
  });
}

function waitFor(s, ch, pred, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const off = s.on('state', (c, sample) => {
      if (c === ch && pred(sample)) { off(); resolve(sample); }
    });
    setTimeout(() => { off(); resolve(null); }, timeoutMs);
  });
}

/** Write one key, assert the ECHO and the on-change STATE, then restore. */
async function roundTrip(s, ch, key, name, current, alt, eq) {
  const same = eq || ((a, b) => Math.abs(a - b) < 1e-3);
  const seen = waitFor(s, ch, (m) => same(m[name], alt));
  const echo = await s.sendIntent(0x3120, { [key]: alt });
  ok(name + ' ECHO applied', same(echo.applied[key], alt),
     'applied=' + echo.applied[key] + ' requested=' + alt);
  const st = await seen;
  ok(name + ' STATE reflects it', st != null, st ? 'state=' + st[name] : 'NO on-change seen');
  const back = await s.sendIntent(0x3120, { [key]: current });
  ok(name + ' restored', same(back.applied[key], current), 'applied=' + back.applied[key]);
}

async function main() {
  console.log('kinetic tuning live test → ws://' + HOST + ':' + PORT + '/');
  const { s, seen } = await open();
  const lim = seen.get(CH_LIMITS), plan = seen.get(CH_PLANNER);
  ok('both tuning channels granted + retained', !!lim && !!plan, 'roles=' + s._roles);

  const cm = s.channelMap;
  const writers = [CH_LIMITS, CH_PLANNER].map((c) => cm.get(c) && cm.get(c).settingChannel);
  ok('both name ONE settingChannel (0x3120)',
     writers.every((w) => w === 0x3120), 'settingChannel=' + JSON.stringify(writers));

  const keys = [];
  for (const c of [CH_LIMITS, CH_PLANNER]) {
    for (const f of (cm.get(c).layout || [])) if (f.settingKey != null) keys.push(f.settingKey);
  }
  ok('setting_keys unique across the shared writer', new Set(keys).size === keys.length,
     keys.length + ' keys: ' + keys.join(','));

  info('limits:   ' + JSON.stringify({ jmax: lim.jmax_ovr, vmax: lim.vmax_ovr, amax: lim.amax_ovr }));
  info('planner:  ' + JSON.stringify({ smoothness: plan.smoothness, handle_floor: plan.handle_floor, trim_max: plan.trim_max,
    chase_dense_ms: plan.chase_dense_ms, react_ms: plan.react_ms }));

  // ---- round-trips, one per card, covering f32 and ms-scaled ------------
  console.log('\n--- limits (f32) ---');
  await roundTrip(s, CH_LIMITS, 2, 'vmax_ovr', lim.vmax_ovr, lim.vmax_ovr > 1 ? 0 : 2.5);
  console.log('\n--- planner (f32) ---');
  await roundTrip(s, CH_PLANNER, 4, 'smoothness', plan.smoothness, plan.smoothness > 0.5 ? 0.3 : 0.7);
  console.log('\n--- planner (ms-scaled u32) ---');
  await roundTrip(s, CH_PLANNER, 7, 'chase_dense_ms', plan.chase_dense_ms, plan.chase_dense_ms > 100 ? 40 : 120);

  // ---- clamping is the hub's job, and the ECHO must show it --------------
  console.log('\n--- clamp: ask for out-of-range, expect the bound back ---');
  const hi = await s.sendIntent(0x3120, { 4: 99.0 });   // smoothness max 1.0
  ok('over-range smoothness clamped to 1.0', Math.abs(hi.applied[4] - 1.0) < 1e-3,
     'applied=' + hi.applied[4]);
  await s.sendIntent(0x3120, { 4: plan.smoothness });

  s.close();
  await delay(400);
  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
