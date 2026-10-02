/**
 * buttplug-estop-sim.mjs — the strip e-stop wins over a live buttplug stream.
 *
 * The app's door refuses input while the REPORTED latch shows PAUSE or ESTOP
 * (shadow.svelte.js `halted`); this test builds its door without that, so it
 * proves the hub latch alone gates the buttplug path: the
 * REAL plugin host, the REAL buttplug adapter (src/plugins/buttplug.js) and
 * the REAL motion door (src/model/motion.js) stream bp://motion payloads into
 * valencesim; the machine moves; an e-stop is asserted while the stream keeps
 * coming; the machine stops moving anyway. Fields are found by role, never by
 * name.
 *
 * Starts its own valencesim on free ports with a throwaway state prefix.
 * Run: node test/buttplug-estop-sim.mjs [--sim <path to valencesim.exe>]
 * Exit 2 = skipped (no sim binary).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, CH, PRIORITY } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';
import { createMotionDoor } from '../src/model/motion.js';
import { createPluginHost } from '../src/plugins/host.js';
import * as bp from '../src/plugins/buttplug.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};

const argv = process.argv.slice(2);
const simIdx = argv.indexOf('--sim');
const SIM_EXE = simIdx >= 0
  ? argv[simIdx + 1]
  : new URL('../../Nucleus/sim/valencesim/build/valencesim.exe', import.meta.url).pathname.replace(/^\//, '');
if (!existsSync(SIM_EXE)) {
  console.log('[SKIP] buttplug-estop-sim: no device twin at ' + SIM_EXE);
  process.exit(2);
}

const freePort = () => new Promise((resolve) => {
  const srv = createServer().listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
});
const WS = await freePort();
const HTTP = await freePort();
const state = join(mkdtempSync(join(tmpdir(), 'bp-estop-')), 'sim');
const sim = spawn(SIM_EXE,
  ['machine', '--homed', '--headless', '--duration', '90', '--port', String(WS), '--http', String(HTTP), '--state', state],
  { stdio: 'ignore' });
await sleep(2500);

const samples = {};
let safety = null;
const s = createSession({
  host: '127.0.0.1', port: WS, clientKind: 'webui', clientName: 'buttplug-estop', autoReconnect: false,
  // Motion input needs control: mint a single-use /uitoken, as the shell does.
  token: () => acquireToken('127.0.0.1:' + HTTP),
  subscriptions: [[CH.SAFETY, 0, PRIORITY.critical], [CH.MACHINE_CONFIG, 0, PRIORITY.elevated], [CH.MOTION, 50, PRIORITY.elevated]],
});
s.on('state', (ch, sm) => { samples[ch] = sm; if (ch === CH.SAFETY) safety = sm; });
const live = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('no LIVE in 8 s')), 8000);
  s.on('live', () => { clearTimeout(t); resolve(); });
});

try {
  s.connect();
  await live;
  for (let i = 0; i < 40 && !samples[CH.MOTION]; i++) await sleep(50);
  const model = buildSettingsModel(s.catalog);
  const posField = model.byRole.get(ROLE.telemetryPosition)[0];
  const pos = () => reportedValue(posField, samples[posField.channelId]);

  const door = createMotionDoor({
    session: () => s,
    entries: () => s.catalog,
    setpoint: () => ({ ok: false, reason: 'setpoint path is not under test' }),
    log: (level, msg) => console.log('        motion: ' + msg),
  });
  const host = createPluginHost({
    model: () => model, sample: (ch) => samples[ch], sampleAge: () => 0,
    display: reportedValue, status: () => 'confirmed', write: () => {},
    submitMotion: door, registerTheme: () => {}, listenTcp: null, prefs: null, log: () => {},
  });
  let api = null;
  host.add(bp.manifest, { activate: (a) => { api = a; } });

  // An Intiface-style stroke: alternate ends every 600 ms, payloads at 30 ms.
  async function stream(ms) {
    const seen = [];
    const t0 = Date.now();
    let accepted = 0;
    let lastWhy = '';
    while (Date.now() - t0 < ms) {
      const position = Math.floor((Date.now() - t0) / 600) % 2 ? 0.8 : 0.2;
      const r = bp.onMotion(api, { position, ms: 300 });
      if (r && r.ok) accepted++; else if (r && r.reason !== lastWhy) console.log('        refused: ' + (lastWhy = r.reason));
      seen.push(pos());
      await sleep(30);
    }
    const v = seen.filter(Number.isFinite);
    return { spread: v.length ? Math.max(...v) - Math.min(...v) : 0, accepted };
  }

  console.log('buttplug stream before the e-stop');
  const before = await stream(3000);
  ok('the stream is accepted on the motion door', before.accepted > 0, before.accepted + ' payloads');
  ok('the machine follows the stream', before.spread > 5, 'spread ' + before.spread.toFixed(2));

  console.log('strip e-stop while the stream keeps coming');
  await s.assertEstop();
  for (let i = 0; i < 40 && !(safety && safety.word_bits && safety.word_bits.estop); i++) await sleep(50);
  ok('the hub latched the e-stop', !!(safety && safety.word_bits && safety.word_bits.estop));
  await sleep(500);
  const after = await stream(3000);
  ok('the machine does not move under a live stream', after.spread < 0.5,
    'spread ' + after.spread.toFixed(2) + ', payloads still submitted ' + after.accepted);
} catch (e) {
  ok('run', false, e.message);
} finally {
  try { s.close && s.close(); } catch (e) { /* already closed */ }
  sim.kill();
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
