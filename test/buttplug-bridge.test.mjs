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
 *       withdraws the machine;
 *   (e) ph-vdk.42: while the hub reports PAUSE, buttplug and TCode input is
 *       refused with 'paused, resume to continue' (logged once), nothing
 *       reaches the wire, and input flows again only once the latch clears
 *       (the door has no resume path of its own);
 *   (f) a shell without the event plugin degrades: one log line, no throw.
 * The Rust half is `cargo test` in src-tauri; the hub latch beating a live
 * stream is test/buttplug-estop-sim.mjs.
 *
 * Run: node test/buttplug-bridge.test.mjs
 */

import { createPluginHost } from '../src/plugins/host.js';
import * as bp from '../src/plugins/buttplug.js';
import * as tcode from '../plugins/examples/tcode-adapter/index.js';
import { createMotionDoor } from '../src/model/motion.js';
import { readFileSync } from 'node:fs';

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

console.log('(e) paused: refused with a reason, resumed only by the operator');
{
  let held = 'paused, resume to continue';
  const wire = [];
  const door = createMotionDoor({
    session: () => null, entries: () => [], log: () => {}, halted: () => held,
    setpoint: (n) => { wire.push(n); return { ok: true }; },
  });
  const logs = [];
  let onLine = null;
  const host = createPluginHost({
    model: () => null, sample: () => undefined, sampleAge: () => Infinity,
    display: () => undefined, status: () => 'confirmed', write: () => {},
    submitMotion: door, registerTheme: () => {}, prefs: null,
    listenTcp: async (port, fn) => { onLine = fn; return () => {}; },
    log: (name, level, msg) => logs.push({ name, level, msg }),
  });
  const handlers = new Map();
  const shell = {
    listen: (ev, fn) => { handlers.set(ev, fn); return Promise.resolve(() => handlers.delete(ev)); },
    invoke: () => Promise.resolve(), live: () => false,
  };
  host.add(bp.manifest, { activate: (a) => bp.bridge(a, shell) });
  host.add(JSON.parse(readFileSync(new URL('../plugins/examples/tcode-adapter/manifest.json', import.meta.url), 'utf8')), tcode);
  await delay(0);
  for (const p of [0.2, 0.4, 0.6]) handlers.get('bp://motion')({ payload: { position: p, ms: 50 } });
  for (const l of ['L020I50', 'L040I50']) onLine(l);
  const refused = (name) => logs.filter((l) => l.name === name && l.msg === 'motion refused: paused, resume to continue');
  ok('buttplug: refused with the reason, logged once', refused('buttplug').length === 1);
  ok('TCode: refused with the reason, logged once', refused('tcode-adapter').length === 1);
  ok('nothing reached the wire while paused', wire.length === 0);
  held = '';
  handlers.get('bp://motion')({ payload: { position: 0.5, ms: 50 } });
  onLine('L075I50');
  ok('after the operator resumes, both flow', JSON.stringify(wire) === '[0.5,0.75]', JSON.stringify(wire));
}

console.log('(f) no event plugin: degraded, logged once, never thrown');
{
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const shell = {
    listen: () => Promise.reject(new Error('plugin event not found')),
    invoke: () => Promise.resolve(), live: () => false,
  };
  const { api, logs } = hostWith(bp.manifest);
  const off = bp.bridge(api, shell);
  await delay(10);
  off();
  process.off('unhandledRejection', onUnhandled);
  ok('no unhandled rejection', unhandled.length === 0, String(unhandled[0] || ''));
  ok('one error line in the adapter log', logs.filter((l) => l.level === 'error').length === 1, JSON.stringify(logs));
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
