/**
 * buttplug-bridge.test.mjs — the webview half of the embedded buttplug server
 * (src/plugins/buttplug.js), with no shell and no device.
 *
 * Asserts, through the REAL plugin host (src/plugins/host.js):
 *   (a) a bp://motion payload reaches submitMotion exactly as the TCode
 *       adapter's mapping of the same input does;
 *   (b) it is gated by the same `motion` permission;
 *   (c) a client stop submits nothing;
 *   (d) hub connect/disconnect drive bp_machine_present, and deactivation
 *       withdraws the machine.
 * The Rust half is `cargo test` in src-tauri; the hub latch beating a live
 * stream is test/buttplug-estop-sim.mjs.
 *
 * Run: node test/buttplug-bridge.test.mjs
 */

import { createPluginHost } from '../src/plugins/host.js';
import * as bp from '../src/plugins/buttplug.js';
import * as tcode from '../plugins/examples/tcode-adapter/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function hostWith(manifest) {
  const motion = [];
  const logs = [];
  const host = createPluginHost({
    model: () => null, sample: () => undefined, sampleAge: () => Infinity,
    display: () => undefined, status: () => 'confirmed', write: () => {},
    submitMotion: (n, d) => { motion.push([n, d]); return { ok: true }; },
    registerTheme: () => {}, listenTcp: null, prefs: null,
    log: (name, level, msg) => logs.push({ name, level, msg }),
  });
  let api = null;
  host.add(manifest, { activate: (a) => { api = a; } });
  return { host, api, motion, logs };
}

console.log('(a) bp://motion maps like the TCode adapter');
{
  const viaTcode = hostWith({ ...bp.manifest, name: 'tcode-twin' });
  const viaBp = hostWith(bp.manifest);
  for (const [line, payload] of [
    ['L0500I100', { position: 0.5, ms: 100 }],
    ['L025I40', { position: 0.25, ms: 40 }],
    ['L09999I1000', { position: 0.9999, ms: 1000 }],
  ]) {
    for (const s of tcode.parseL0(line)) viaTcode.api.submitMotion(s.pos, s.durationMs);
    bp.onMotion(viaBp.api, payload);
  }
  ok('one submitMotion per payload, same (position, duration) as TCode',
    JSON.stringify(viaBp.motion) === JSON.stringify(viaTcode.motion), JSON.stringify(viaBp.motion));
}

console.log('(b) the same motion permission');
{
  const { api, motion } = hostWith({ ...bp.manifest, permissions: [] });
  let err = null;
  try { bp.onMotion(api, { position: 0.5, ms: 100 }); } catch (e) { err = e; }
  ok('undeclared motion is refused by the host', err && err.name === 'PermissionError' && motion.length === 0);
  ok('the adapter manifest declares exactly motion', JSON.stringify(bp.manifest.permissions) === '["motion"]');
}

console.log('(c) a client stop submits nothing');
{
  const { api, motion } = hostWith(bp.manifest);
  ok('stop returns null and never reaches submitMotion', bp.onMotion(api, { stop: true }) === null && motion.length === 0);
}

console.log('(d) hub presence');
{
  const handlers = new Map();
  const calls = [];
  let live = false;
  const shell = {
    listen: (ev, fn) => { handlers.set(ev, fn); return Promise.resolve(() => handlers.delete(ev)); },
    invoke: (cmd, args) => { calls.push([cmd, args.present]); return Promise.resolve(); },
    live: () => live,
  };
  const { api, motion, logs } = hostWith(bp.manifest);
  const off = bp.bridge(api, shell);
  await delay(0);
  handlers.get('bp://motion')({ payload: { position: 0.3, ms: 50 } });
  ok('a bp://motion event reaches submitMotion', JSON.stringify(motion) === '[[0.3,50]]');
  handlers.get('bp://log')({ payload: { level: 'warn', msg: 'hello' } });
  ok('bp://log lands in the log pane under the adapter', logs.some((l) => l.name === 'buttplug' && l.msg === 'hello'));
  ok('no hub: the machine is never announced', calls.length === 0);
  live = true; await delay(600);
  ok('hub live: bp_machine_present(true) once', JSON.stringify(calls) === '[["bp_machine_present",true]]');
  live = false; await delay(600);
  ok('hub lost: bp_machine_present(false)', JSON.stringify(calls.at(-1)) === '["bp_machine_present",false]');
  live = true; await delay(600);
  off();
  ok('deactivate withdraws the machine and the listeners',
    JSON.stringify(calls.at(-1)) === '["bp_machine_present",false]' && handlers.size === 0);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
