/**
 * player-osc.test.mjs -- the funscript player's oscillator axes (V8, V9) against Neutrino in process: the
 * player's own osc.js and the app's motion door (src/model/motion.js submit.samples) publish to the hub's
 * osc.drive STREAM over valence-js (SPEC 9.7, Valence RFC-110; Nucleus val-o9r).
 *
 *   node test/cluster/player-osc.test.mjs
 *
 * Cases: the card is written square with osc.enabled false, the carriage parked mid-window; while the script
 * plays, the hub reports the oscillator rendering, driven (shape sine), osc.enabled still false, and every point
 * arrives at least the grant's schedule latency (156 ms) ahead of its stamp; once the player stops, after the
 * quiet window the hub hands back to the hand state: not rendering, square again.
 * Exit 1 on any FAIL.
 */
import { bootNeutrino, wasmBytes } from './neutrino.mjs';
import { createSession, CH, PRIORITY } from '../../../Valence/clients/js/index.js';
import { createMotionDoor } from '../../src/model/motion.js';
import { createOsc, OSC_ROLE } from '../../plugins/factory/funscript-player/osc.js';
import { parseFunscript } from '../../plugins/factory/funscript-player/funscript.js';

const OSC_LAT_MS = 156;   // the osc-drive grant's schedule latency: Nucleus kOscDriveLeadUs (RFC-110 item 4)
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const n = await bootNeutrino(new WebAssembly.Module(wasmBytes()), { homed: true });
const epoch = Number(process.hrtime.bigint() / 1000n) - 1e6;
const hubUs = () => Number(process.hrtime.bigint() / 1000n) - epoch;   // the clock Neutrino ticks on
let running = true;
(function loop() { if (!running) return; n.tick(hubUs()); n.drain(); setImmediate(loop); })();

const twin = new Map();
const cache = new Map();
const s = createSession({ host: 'neutrino', port: 1, clientKind: 'webui', clientName: 'player-osc', autoReconnect: false,
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
const OSC = byRole('osc.enabled'), MOVE = byRole('command.position');
const oscTwin = s.catalog.find((e) => e.settingChannel === OSC.id);
s.subscribe([[oscTwin.id, 0, PRIORITY.normal]]);
const send = (ch, v) => s.sendIntent(ch, v).then(() => 'ok', (e) => (e.code != null ? e.name + (e.detail ? ': ' + e.detail : '') : e.message));
const osc = () => twin.get(oscTwin.id) || {};
const shapes = OSC.schema.find((f) => f.role === 'osc.shape').options;
const SQUARE = shapes.indexOf('square'), SINE = shapes.indexOf('sine');
ok('the card offers square and sine', SQUARE >= 0 && SINE >= 0, shapes);

// The carriage mid-window: at a window edge the oscillation has no room and renders 0.
await until(() => twin.has(CH.MACHINE_CONFIG), 3000);
const cfg = twin.get(CH.MACHINE_CONFIG) || {};
const lo = cfg.window_min ?? 0, hi = cfg.window_max ?? 100;
let r = await send(MOVE.id, { [keyOf(MOVE, 'command.position')]: (lo + hi) / 2 });
ok('jog to mid-window: ECHO', r === 'ok', r);
await until(() => (twin.get(CH.MOTION) || {}).speed === 0 && Math.abs((twin.get(CH.MOTION) || {}).pos_10um - (lo + hi) / 2) < 2, 20000);
r = await send(OSC.id, { [keyOf(OSC, 'osc.enabled')]: false, [keyOf(OSC, 'osc.shape')]: SQUARE });
ok('the card by hand: square, osc.enabled false: ECHO', r === 'ok', r);
ok('  ... at rest, reported square', await until(() => osc().shape === SQUARE && !osc().enabled && !osc().active, 3000), osc());

// The player's half: osc.js through the app's motion door, as the plugin host wires api.submitSamples.
const door = createMotionDoor({ session: () => s, entries: () => s.catalog, setpoint: () => ({ ok: false, reason: 'unused' }),
  log: () => {}, halted: () => '' });
const leads = [];
const publish = s.publishSamples;
s.publishSamples = (ch, recs, o) => {
  const now = hubUs();
  if (o && Array.isArray(o.offsetsUs)) for (const off of o.offsetsUs) leads.push(((o.anchor + off) >>> 0) - (now >>> 0));
  return publish(ch, recs, o);
};
let lastSubmit = null;
const player = createOsc({ submit: (list) => (lastSubmit = door.samples(OSC_ROLE, list)) });
const doc = (pos) => JSON.stringify({ version: '1.0', actions: [{ at: 0, pos }, { at: 60000, pos }] });
const script = { ...parseFunscript(doc(50), 'clip.funscript'),
  axes: { V8: parseFunscript(doc(10), 'clip.v8.funscript'), V9: parseFunscript(doc(4), 'clip.v9.funscript') } };

let playing = true;
const t0 = performance.now();
const frame = setInterval(() => player.tick(script, playing ? (w) => w - t0 : null), 16);
ok('the grant: osc-drive at its catalog rate, 156 ms latency', await until(() => lastSubmit && lastSubmit.ok && lastSubmit.rateHz > 0, 3000)
  && lastSubmit.latencyMs === OSC_LAT_MS, lastSubmit);
ok('while the stream is live the hub renders it', await until(() => !!osc().active && osc().amplitude_effective > 0, 3000), osc());
await sleep(1500);
const live = osc();
ok('  ... driven: reported sine with no dwells, osc.enabled still false',
  live.active && live.shape === SINE && live.dwell_crest === 0 && live.dwell_trough === 0 && !live.enabled, live);
ok('every point sent at least the grant\'s 156 ms ahead of its stamp', leads.length >= 50 && Math.min(...leads) >= OSC_LAT_MS * 1000,
  { n: leads.length, min_ms: Math.round(Math.min(...leads) / 1000), max_ms: Math.round(Math.max(...leads) / 1000) });

// Stop: nothing more is sent; past the quiet window the hub hands back to the card.
playing = false;
const sentAtStop = leads.length;
const tStop = Date.now();
ok('after the quiet window the hub hands back to the hand state: not rendering, square, osc.enabled false',
  await until(() => !osc().active && osc().shape === SQUARE && !osc().enabled, 5000), { ...osc(), s: (Date.now() - tStop) / 1000 });
ok('the player sent nothing after it stopped', leads.length === sentAtStop, leads.length - sentAtStop);
clearInterval(frame);
ok('Neutrino did not trap', !n.trap, n.trap && n.trap.message);

running = false;
s.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
