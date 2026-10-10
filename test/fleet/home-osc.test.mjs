/**
 * home-osc.test.mjs -- the hub's answer to a home cycle while the oscillator is enabled, on Neutrino
 * (operator ruling 2026-10-09: the oscillator shares the jog slot and blocks nothing except a home cycle,
 * which the hub refuses while the oscillator is enabled; Nucleus val-dzf).
 *
 *   node test/fleet/home-osc.test.mjs
 *
 * Cases: a home with the oscillator off completes (the control); with it enabled, a jog, a window write,
 * a limits write, pause and resume, an oscillator change and a pattern start and stop are all answered ECHO;
 * a home on the idle rail and a home under PAUSE are refused with a NACK. Until val-dzf lands
 * (REFUSAL_LANDED false) an accepted home is XFAIL and a refusal XPASS; flip the constant when it lands.
 * Exit 1 on any FAIL.
 */
import { bootNeutrino, wasmBytes } from './neutrino.mjs';
import { createSession, CH, PRIORITY, SAFETY_OP } from '../../../Valence/clients/js/index.js';

const REFUSAL_LANDED = true;
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const expectRefusal = (name, res) => {
  const refused = res !== 'ok';
  const tag = REFUSAL_LANDED ? (refused ? 'PASS' : 'FAIL') : refused ? 'XPASS' : 'XFAIL';
  console.log('  [' + tag + '] ' + name + '  -- ' + res + (REFUSAL_LANDED ? '' : ' (val-dzf)'));
  if (tag === 'FAIL') fails++;
};

const n = await bootNeutrino(new WebAssembly.Module(wasmBytes()), { homed: true, home_sense_at_mm: -120, rail_end_at_mm: 380 });
const epoch = Number(process.hrtime.bigint() / 1000n) - 1e6;
let running = true;
(function loop() { if (!running) return; n.tick(Number(process.hrtime.bigint() / 1000n) - epoch); n.drain(); setImmediate(loop); })();

const twin = new Map();
const cache = new Map();
const s = createSession({ host: 'neutrino', port: 1, clientKind: 'webui', clientName: 'home-osc', autoReconnect: false,
  WebSocketImpl: n.WebSocket, token: n.token,
  catalogStore: { load: (h) => cache.get(h) || null, save: (h, e, b) => cache.set(h, { etag: e, bytes: b }), clear: (h) => cache.delete(h) },
  subscriptions: [[CH.SAFETY, 0, PRIORITY.critical], [CH.MOTION, 60, PRIORITY.elevated], [CH.MACHINE_CONFIG, 0, PRIORITY.elevated]] });
s.on('state', (ch, v) => twin.set(ch, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(10); } return false; };
s.connect();
ok('session LIVE at control', await until(() => s.state.phase === 'LIVE', 8000) && s.state.roles >= 1, s.state.roles);

const byRole = (role) => s.catalog.find((e) => (e.schema || []).some((f) => f.role === role));
const keyOf = (e, role) => e.schema.find((f) => f.role === role).key;
const OSC = byRole('osc.enabled'), HOME = byRole('action.home'), MOVE = byRole('command.position'), SAFE = byRole('action.safety');
const oscTwin = s.catalog.find((e) => e.settingChannel === OSC.id);
const patCmd = s.catalog.find((e) => e.name === 'pattern-cmd');
s.subscribe([[oscTwin.id, 0, PRIORITY.normal]]);
const send = (ch, v) => s.sendIntent(ch, v).then(() => 'ok', (e) => (e.code != null ? e.name + (e.detail ? ': ' + e.detail : '') : e.message));
const flags = () => (twin.get(CH.MOTION) || {}).flags_bits || {};
const osc = () => twin.get(oscTwin.id) || {};
const homeOp = HOME.schema.find((f) => f.role === 'action.home').options.indexOf('home');

// The control: a home cycle with the oscillator off runs and completes.
let r = await send(HOME.id, { [keyOf(HOME, 'action.home')]: homeOp });
ok('home with the oscillator off: ECHO', r === 'ok', r);
ok('  ... and the cycle starts', await until(() => flags().homing === true, 3000), flags());
const t0 = Date.now();
ok('  ... and completes homed', await until(() => flags().homing === false && flags().homed === true, 60000), { ...flags(), s: (Date.now() - t0) / 1000 });
await sleep(300);

// The oscillator on an idle rail, the carriage mid-window: at a window edge it has no room and renders 0.
const cfg = twin.get(CH.MACHINE_CONFIG) || {};
const lo = cfg.window_min ?? 0, hi = cfg.window_max ?? 100;
ok('jog to mid-window: ECHO', (r = await send(MOVE.id, { [keyOf(MOVE, 'command.position')]: lo + (hi - lo) * 0.5 })) === 'ok', r);
await until(() => (twin.get(CH.MOTION) || {}).speed === 0 && Math.abs((twin.get(CH.MOTION) || {}).pos_10um - (lo + hi) / 2) < 2, 20000);
r = await send(OSC.id, { [keyOf(OSC, 'osc.enabled')]: true, [keyOf(OSC, 'osc.frequency')]: 2, [keyOf(OSC, 'osc.amplitude')]: 0.1, [keyOf(OSC, 'osc.shape')]: 0 });
ok('oscillator enabled: ECHO', r === 'ok', r);
ok('  ... and active on the idle rail', await until(() => !!osc().active, 3000), osc());

// Everything else stays allowed while it oscillates.
ok('jog inside the window: ECHO', (r = await send(MOVE.id, { [keyOf(MOVE, 'command.position')]: lo + (hi - lo) * 0.6 })) === 'ok', r);
await sleep(1500);
ok('window write: ECHO', (r = await send(CH.CONFIG_SET, { 1: lo + 1, 2: hi - 1 })) === 'ok', r);
ok('limits write: ECHO', (r = await send(CH.CONFIG_SET, { 5: 300 })) === 'ok', r);
ok('oscillator change: ECHO', (r = await send(OSC.id, { [keyOf(OSC, 'osc.frequency')]: 3 })) === 'ok', r);
ok('pause: ECHO', (r = await send(SAFE.id, { 1: SAFETY_OP.pause })) === 'ok', r);
ok('resume: ECHO', (r = await send(SAFE.id, { 1: SAFETY_OP.resume })) === 'ok', r);
if (patCmd) {
  ok('pattern start: ECHO', (r = await send(patCmd.id, { 1: true })) === 'ok', r);
  await sleep(800);
  ok('pattern stop: ECHO', (r = await send(patCmd.id, { 1: false })) === 'ok', r);
  await until(() => !flags().gen_running, 5000);
}
await sleep(1500);
ok('oscillating on the idle rail before the home', !!osc().active, osc());

// The ruling: a home cycle is refused while the oscillator is enabled.
ok('oscillator still enabled', !!osc().enabled, osc());
r = await send(HOME.id, { [keyOf(HOME, 'action.home')]: homeOp });
expectRefusal('home on the idle rail with the oscillator enabled is refused', r);
if (r === 'ok') {
  const seen = { homingWithOsc: false };
  await until(() => flags().homing, 3000);
  await until(() => { if (flags().homing && osc().enabled) seen.homingWithOsc = true; return !flags().homing; }, 60000);
  console.log('        the hub ran the cycle with the oscillator enabled: homing seen ' + seen.homingWithOsc + ', homed ' + flags().homed + ', osc active after ' + osc().active);
}
await sleep(500);
ok('pause: ECHO', (r = await send(SAFE.id, { 1: SAFETY_OP.pause })) === 'ok', r);
r = await send(HOME.id, { [keyOf(HOME, 'action.home')]: homeOp });
expectRefusal('home under PAUSE with the oscillator enabled is refused', r);
if (r === 'ok') { await until(() => flags().homing, 3000); await until(() => !flags().homing, 60000); }

running = false;
s.close();
console.log(fails ? fails + ' FAILED' : 'all passed' + (REFUSAL_LANDED ? '' : ' (XFAIL is the pending val-dzf refusal)'));
process.exit(fails ? 1 : 0);
