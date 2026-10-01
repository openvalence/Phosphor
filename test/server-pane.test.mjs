// server-pane.test.mjs -- the buttplug server pane's controller (src/shell/
// bp-server.js) against a fake Tauri invoke/listen; no shell, no browser.
// Run: node test/server-pane.test.mjs

import assert from 'node:assert/strict';
import { blank, createBp, BP_PORT } from '../src/shell/bp-server.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// A fake Rust side: `cmds` answers invoke, `emit` fires a registered event.
function fakeShell(cmds) {
  const calls = [];
  const handlers = {};
  return {
    calls,
    emit: (ev, payload) => handlers[ev]?.({ payload }),
    handlers,
    api: {
      invoke: async (cmd, args) => {
        calls.push([cmd, args]);
        if (!(cmd in cmds)) throw 'command ' + cmd + ' not found';
        return cmds[cmd](args);
      },
      listen: async (ev, fn) => { handlers[ev] = fn; return () => { delete handlers[ev]; }; },
    },
  };
}

// --- degraded: the Rust half is missing --------------------------------------
{
  const s = blank();
  const sh = fakeShell({});
  const bp = createBp(s, sh.api);
  await bp.init();
  assert.equal(s.ready, false);
  assert.match(s.reason, /not available.*bp_status not found/);
  await bp.start(BP_PORT);
  assert.deepEqual(sh.calls.map((c) => c[0]), ['bp_status'], 'a degraded pane sends nothing');
  assert.deepEqual(Object.keys(sh.handlers), [], 'and subscribes to nothing');
}
// No Tauri at all: invoke rejects with a TypeError, as on the served page.
{
  const s = blank();
  const bp = createBp(s, { invoke: async () => { throw new TypeError('__TAURI_INTERNALS__ is undefined'); }, listen: async () => {} });
  await bp.init();
  assert.equal(s.ready, false);
  assert.match(s.reason, /__TAURI_INTERNALS__/);
}

// --- live: events update status and devices, start/stop call the right commands
{
  let status = { running: false, port: BP_PORT, clients: 0, scanning: false };
  const machine = { index: 0, name: 'Machine', kind: 'machine', connected: true, features: ['Linear'] };
  const sh = fakeShell({
    bp_status: () => ({ ...status }),
    bp_devices: () => [machine],
    bp_start: ({ port }) => { status = { ...status, running: true, port }; },
    bp_stop: () => { status = { ...status, running: false, clients: 0 }; },
    bp_scan_start: () => { status = { ...status, scanning: true }; },
    bp_scan_stop: () => { status = { ...status, scanning: false }; },
  });
  const s = blank();
  const bp = createBp(s, sh.api);
  await bp.init();
  assert.equal(s.ready, true);
  assert.deepEqual(s.devices, [machine]);
  assert.deepEqual(Object.keys(sh.handlers).sort(), ['bp://devices', 'bp://log', 'bp://status']);

  sh.calls.length = 0;
  const p = bp.start(23456);
  assert.equal(s.run.phase, 'pending', 'pending until the echo');
  assert.equal(s.running, false, 'no optimistic running');
  await p;
  assert.deepEqual(sh.calls, [['bp_start', { port: 23456 }], ['bp_status', undefined]]);
  assert.equal(s.running, true);
  assert.equal(s.port, 23456);
  assert.equal(s.run.phase, 'settled');

  sh.emit('bp://status', { running: true, port: 23456, clients: 2, scanning: false });
  assert.equal(s.clients, 2);

  const toy = { index: 1, name: 'Lovense Lush', kind: 'toy', connected: true, features: ['Vibrate'] };
  sh.emit('bp://devices', [machine, toy]);
  assert.equal(s.devices.length, 2);
  for (let i = 0; i < 60; i++) sh.emit('bp://log', { level: 'info', msg: 'line ' + i });
  assert.equal(s.log.length, 50, 'log tail is bounded');
  assert.equal(s.log.at(-1).msg, 'line 59');

  sh.calls.length = 0;
  await bp.scan(true);
  await bp.scan(false);
  await bp.stop();
  assert.deepEqual(sh.calls.map((c) => c[0]),
    ['bp_scan_start', 'bp_status', 'bp_scan_stop', 'bp_status', 'bp_stop', 'bp_status']);
  assert.equal(s.running, false);
  assert.equal(s.clients, 0);

  bp.dispose();
  assert.deepEqual(Object.keys(sh.handlers), [], 'dispose unlistens');
}

// --- fault and overdue rungs ---------------------------------------------------
{
  const sh = fakeShell({
    bp_status: () => ({ running: false, port: BP_PORT, clients: 0, scanning: false }),
    bp_start: () => { throw 'address in use'; },
    bp_scan_start: () => {}, // accepted, never confirmed
  });
  const s = blank();
  const bp = createBp(s, sh.api, { echoMs: 20 });
  await bp.init();
  await bp.start(BP_PORT);
  assert.equal(s.run.phase, 'fault');
  assert.match(s.run.reason, /bp_start failed: address in use/);
  assert.equal(s.running, false);

  await bp.scan(true);
  assert.equal(s.scan.phase, 'pending');
  await tick(40);
  assert.equal(s.scan.phase, 'overdue');
  assert.match(s.scan.reason, /no confirmation/);
  sh.emit('bp://status', { running: false, port: BP_PORT, clients: 0, scanning: true });
  assert.equal(s.scan.phase, 'settled', 'a late echo still settles');
  bp.dispose();
}

// --- stop all toys: enabled only while running, ack settles, error text surfaces
{
  let running = false;
  let ack = null;
  const sh = fakeShell({
    bp_status: () => ({ running, port: BP_PORT, clients: 0, scanning: false }),
    bp_stop_all: () => { if (ack instanceof Error) throw ack.message; return ack; },
  });
  const s = blank();
  const bp = createBp(s, sh.api);
  await bp.init();
  await bp.stopAll();
  assert.ok(!sh.calls.some((c) => c[0] === 'bp_stop_all'), 'not sent while the server is off');

  running = true;
  sh.emit('bp://status', { running: true, port: BP_PORT, clients: 1, scanning: false });
  const p = bp.stopAll();
  assert.equal(s.stopAll.phase, 'pending');
  await p;
  assert.equal(sh.calls.at(-1)[0], 'bp_stop_all');
  assert.equal(s.stopAll.phase, 'settled');

  ack = new Error('buttplug server is not running');
  await bp.stopAll();
  assert.equal(s.stopAll.phase, 'fault');
  assert.match(s.stopAll.reason, /stop all failed: buttplug server is not running/);

  ack = 'device 2 did not acknowledge';
  await bp.stopAll();
  assert.equal(s.stopAll.phase, 'fault', 'a resolved error string is a fault too');
  assert.match(s.stopAll.reason, /device 2 did not acknowledge/);
  bp.dispose();
}

console.log('server-pane: ok');
