// estop-udp.test.mjs -- the shell's RFC-053 datagram e-stop, no Tauri, no hub.
// The pref (default on, a bad value takes the default), which presses fire,
// and the exact arguments src-tauri/src/estop_udp.rs receives.
// Run: node test/estop-udp.test.mjs

import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';

const { DEFAULTS, loadPrefs, prefs, setPref } = await import('../src/model/prefs.js');
const { noteEstopPress, setEstopPressHook } = await import('../src/model/actions.js');
const { createEstopDatagram, installEstopDatagram, estopArgs, ESTOP_COMMAND } = await import('../src/shell/estop-udp.js');
const { broadcastEstop, SAFETY_OP, SAFETY_CAUSE, ACCESS, LIMITS, CH_SAFETY_INTENTS } =
  await import('../../Valence/clients/js/index.js');

// ---- the pref: opt-out, default on (RFC-053 item 3) ----------------------------
assert.equal(DEFAULTS.estopDatagram, true);
assert.equal(loadPrefs({}).estopDatagram, true);
assert.equal(loadPrefs({ estopDatagram: false }).estopDatagram, false);
assert.equal(loadPrefs({ estopDatagram: 'no' }).estopDatagram, true, 'a bad value takes the default');

// ---- the command's arguments ---------------------------------------------------
const calls = [];
const invoke = async (cmd, args) => { calls.push([cmd, args]); return 1; };
const fast = (o) => broadcastEstop({ ...o, sleep: async () => {} });
let virtual = false;
let enabled = true;
const fire = createEstopDatagram({
  invoke, isVirtual: () => virtual, origin: () => ACCESS.control, enabled: () => enabled, broadcast: fast,
});

const r = await fire();
assert.equal(calls.length, LIMITS.estop_repeat_max, 'the whole §11.2 budget');
assert.equal(r.sent, LIMITS.estop_repeat_max);
for (const [cmd, args] of calls) {
  assert.equal(cmd, ESTOP_COMMAND);
  assert.equal(cmd, 'estop_broadcast', 'the name lib.rs registers');
  assert.deepEqual(Object.keys(args), ['datagram'], 'estop_broadcast(datagram: Vec<u8>)');
  assert.ok(Array.isArray(args.datagram), 'JSON IPC: a number array, never a Uint8Array');
  assert.equal(args.datagram.length, 12);
  assert.ok(args.datagram.every((b) => Number.isInteger(b) && b >= 0 && b <= 255));
}
const d = Buffer.from(calls[0][1].datagram);
assert.equal(d.readUInt32LE(0), 0xe5e5e5e5, 'the §5.5 magic');
assert.equal(d[4], SAFETY_CAUSE.user);
assert.equal(d[5], ACCESS.control, 'the session tier as origin');
assert.equal(d.readUInt16LE(6), r.seq);
assert.equal(crc32(d.subarray(0, 8)), d.readUInt32LE(8), 'a CRC the hub accepts');
assert.ok(calls.every(([, a]) => Buffer.from(a.datagram).equals(d)), 'every repeat is one initiation');
assert.deepEqual(estopArgs(Uint8Array.of(1, 2, 3)), { datagram: [1, 2, 3] });

// Off, or virtual: nothing leaves.
calls.length = 0;
enabled = false;
assert.equal(fire(), null);
enabled = true;
virtual = true;
assert.equal(fire(), null);
virtual = false;
assert.equal(calls.length, 0);

// The default reads the live pref at each press.
const byPref = createEstopDatagram({ invoke, isVirtual: () => false, broadcast: fast });
setPref('estopDatagram', false);
assert.equal(byPref(), null, 'pref off: no broadcast');
setPref('estopDatagram', true);
const r2 = await byPref();
assert.equal(Buffer.from(calls.at(-1)[1].datagram)[5], ACCESS.watch, 'no origin given: watch');
assert.notEqual(r2.seq, r.seq, 'each press is a new initiation');

// A native failure is reported, never thrown.
const failing = createEstopDatagram({
  invoke: async () => { throw new Error('no IPv4 interface took the datagram'); },
  isVirtual: () => false, enabled: () => true, broadcast: fast,
});
const warn = console.warn;
let warned = '';
console.warn = (m) => { warned = m; };
const r3 = await failing();
console.warn = warn;
assert.equal(r3.sent, 0);
assert.equal(r3.failed, LIMITS.estop_repeat_max);
assert.match(warned, /no interface/, 'sent 0 is said out loud');

// ---- which presses fire (actions.js) -----------------------------------------------
const estopAction = { channelId: CH_SAFETY_INTENTS, key: 1 };
let fired = 0;
setEstopPressHook(() => { fired++; });
noteEstopPress(estopAction, SAFETY_OP.estop);
assert.equal(fired, 1, 'estop on safety-intents fires');
noteEstopPress(estopAction, SAFETY_OP.pause);
noteEstopPress(estopAction, SAFETY_OP.release);
noteEstopPress({ channelId: 0x2000, key: 1 }, SAFETY_OP.estop);
noteEstopPress(null, SAFETY_OP.estop);
assert.equal(fired, 1, 'only the estop op on safety-intents (law 2: identity, never a label)');
setEstopPressHook(() => { throw new Error('boom'); });
const quiet = console.error;
console.error = () => {};
assert.doesNotThrow(() => noteEstopPress(estopAction, SAFETY_OP.estop), 'the session estop must still leave');
console.error = quiet;

// installEstopDatagram is the hook runAction reaches.
calls.length = 0;
installEstopDatagram({ invoke, isVirtual: () => false, origin: () => ACCESS.configure });
noteEstopPress(estopAction, SAFETY_OP.estop);
for (let i = 0; i < 100 && calls.length < 1; i++) await new Promise((res) => setTimeout(res, 5));
assert.ok(calls.length >= 1, 'the installed hook invokes the command');
assert.equal(Buffer.from(calls[0][1].datagram)[5], ACCESS.configure);
setEstopPressHook(null);

console.log('estop-udp: pref, presses and command arguments OK');
// The installed hook's real 50 ms repeats would hold the loop open.
process.exit(0);
