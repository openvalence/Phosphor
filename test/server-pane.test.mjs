// server-pane.test.mjs -- the buttplug server pane's controller (src/shell/
// bp-server.js) against a fake Tauri invoke/listen; no shell, no browser.
// Run: node test/server-pane.test.mjs

import assert from 'node:assert/strict';
import { blank, createBp, BP_PORT, SCAN_S, logAt, logText, statusLine } from '../src/shell/bp-server.js';

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
  assert.deepEqual(Object.keys(sh.handlers).sort(), ['bp://clients', 'bp://devices', 'bp://log', 'bp://status']);

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
  for (let i = 0; i < 510; i++) sh.emit('bp://log', { level: 'info', msg: 'line ' + i });
  assert.equal(s.log.length, 500, 'log tail is bounded');
  assert.equal(s.log.at(-1).msg, 'line 509');

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

// --- settings: shown as saved, the saved answer is the echo, refusals are text
{
  const DEFAULTS = { port: BP_PORT, start_on_launch: false, ble: true, serial: true, hid: true, machine: true, log_level: 'info' };
  let saved = { ...DEFAULTS };
  let running = false;
  let gate = null;
  const sh = fakeShell({
    bp_status: () => ({ running, port: saved.port, clients: 0, scanning: false }),
    bp_settings: () => ({ ...saved }),
    bp_settings_set: async ({ settings }) => {
      if (gate) await gate;
      if (running && settings.ble !== saved.ble) throw 'stop the server to change the port or the hardware managers';
      if (settings.log_level === 'loud') throw 'unknown log level "loud"';
      saved = { ...settings };
      return { ...saved };
    },
    bp_start: ({ port }) => { running = true; saved.port = port; },
  });
  const s = blank();
  const bp = createBp(s, sh.api, { echoMs: 20 });
  await bp.init();
  assert.deepEqual(s.settings, DEFAULTS, 'read on init');

  let open;
  gate = new Promise((r) => { open = r; });
  const p = bp.saveSettings({ port: 23456, ble: false });
  assert.equal(s.set.phase, 'pending');
  assert.match(s.set.reason, /saving port, ble/);
  assert.equal(s.settings.port, BP_PORT, 'nothing shown before the answer');
  await tick(40);
  assert.equal(s.set.phase, 'overdue');
  open();
  await p;
  gate = null;
  assert.deepEqual(sh.calls.find((c) => c[0] === 'bp_settings_set')[1],
    { settings: { ...DEFAULTS, port: 23456, ble: false } }, 'the whole record goes over');
  assert.equal(s.settings.port, 23456);
  assert.equal(s.set.phase, 'settled');

  await bp.saveSettings({ log_level: 'loud' });
  assert.equal(s.set.phase, 'fault');
  assert.match(s.set.reason, /not saved: unknown log level/);
  assert.equal(s.settings.log_level, 'info', 'a refusal leaves the saved value');

  sh.calls.length = 0;
  await bp.start();
  assert.deepEqual(sh.calls[0], ['bp_start', { port: 23456 }], 'start uses the saved port');
  await bp.saveSettings({ ble: true });
  assert.match(s.set.reason, /stop the server/);
  assert.equal(s.settings.ble, false);
  bp.dispose();
}
// Settings missing from the Rust side: the pane still runs, settings say why.
{
  const sh = fakeShell({ bp_status: () => ({ running: false, port: BP_PORT, clients: 0, scanning: false }) });
  const s = blank();
  const bp = createBp(s, sh.api);
  await bp.init();
  assert.equal(s.ready, true);
  assert.equal(s.settings, null);
  assert.match(s.set.reason, /settings unavailable: command bp_settings not found/);
  await bp.saveSettings({ ble: false });
  assert.ok(!sh.calls.some((c) => c[0] === 'bp_settings_set'), 'nothing to save against');
  bp.dispose();
}

// --- devices: timed scan, rename / disconnect / forget settle on the list, reads
{
  const vib = { index: 1, key: 'lovense-aa', name: 'Lush', device_name: 'Lush', display_name: null, kind: 'toy', connected: true,
    protocol: 'lovense', address: 'AA', features: ['Battery', 'Vibrate'],
    controls: [{ feature: 0, kind: 'scalar', type: 'Vibrate', range: [0, 20] }, { feature: 1, kind: 'sensor', type: 'Battery' }] };
  const machine = { index: 0, key: 'valence-phosphor-machine', name: 'Valence Machine', kind: 'machine', connected: true, controls: [] };
  let list = [machine, { ...vib }];
  let battery = 80;
  let quiet = false;   // the Rust side answers Ok but the list never changes
  const sh = fakeShell({
    bp_status: () => ({ running: true, port: BP_PORT, clients: 0, scanning: false }),
    bp_devices: () => list.map((d) => ({ ...d })),
    bp_scan_start: () => {},
    bp_device_rename: ({ key, name }) => {
      if (quiet) return;
      list = list.map((d) => (d.key === key ? { ...d, display_name: name, name: name ?? d.device_name } : d));
    },
    bp_device_disconnect: ({ index }) => {
      if (index === 0) throw "device 0 is the machine; it leaves with the hub";
      list = list.map((d) => (d.index === index ? { ...d, connected: false, controls: [] } : d));
    },
    bp_device_forget: ({ key }) => {
      if (list.find((d) => d.key === key)?.connected) throw key + ' is connected; disconnect it first';
      list = list.filter((d) => d.key !== key);
    },
    bp_toy_read: ({ input }) => { if (battery == null) throw 'device 1 is gone'; return battery; },
  });
  const s = blank();
  const bp = createBp(s, sh.api, { echoMs: 20 });
  await bp.init();

  await bp.scan(true);
  assert.deepEqual(sh.calls.find((c) => c[0] === 'bp_scan_start')[1], { seconds: SCAN_S }, 'the pane scan is timed');

  // Rename: pending until the list carries the name, then settled; blank resets.
  const p = bp.rename('lovense-aa', '  Bedside ');
  assert.equal(s.ops['rename:lovense-aa'].phase, 'pending');
  assert.match(s.ops['rename:lovense-aa'].reason, /saving the name Bedside/);
  await p;
  assert.deepEqual(sh.calls.find((c) => c[0] === 'bp_device_rename')[1], { key: 'lovense-aa', name: 'Bedside' });
  assert.equal(s.ops['rename:lovense-aa'].phase, 'settled');
  assert.equal(s.devices.find((d) => d.key === 'lovense-aa').name, 'Bedside');
  await bp.rename('lovense-aa', ' ');
  assert.equal(sh.calls.filter((c) => c[0] === 'bp_device_rename').at(-1)[1].name, null, 'blank sends null');
  assert.equal(s.devices.find((d) => d.key === 'lovense-aa').display_name, null);

  // An Ok with no list change stays pending, goes overdue, and a late event settles it.
  quiet = true;
  await bp.rename('lovense-aa', 'Late');
  assert.equal(s.ops['rename:lovense-aa'].phase, 'pending', 'Ok alone is not the echo');
  await tick(40);
  assert.equal(s.ops['rename:lovense-aa'].phase, 'overdue');
  sh.emit('bp://devices', list.map((d) => (d.key === 'lovense-aa' ? { ...d, display_name: 'Late' } : d)));
  assert.equal(s.ops['rename:lovense-aa'].phase, 'settled', 'the event confirms');
  quiet = false;

  // Reads: the answer is the value; a failure keeps it, with the reason.
  const bat = vib.controls[1];
  await bp.read(vib, bat);
  assert.deepEqual(sh.calls.find((c) => c[0] === 'bp_toy_read')[1], { index: 1, feature: 1, input: 'Battery' });
  assert.equal(s.reads['lovense-aa:1:Battery'].value, 80);
  battery = null;
  await bp.read(vib, bat);
  assert.equal(s.reads['lovense-aa:1:Battery'].phase, 'fault');
  assert.match(s.reads['lovense-aa:1:Battery'].reason, /read failed: device 1 is gone/);
  assert.equal(s.reads['lovense-aa:1:Battery'].value, 80, 'the last value stays');

  // Forget refuses a connected toy; disconnect, then forget.
  await bp.forget('lovense-aa');
  assert.equal(s.ops['forget:lovense-aa'].phase, 'fault');
  assert.match(s.ops['forget:lovense-aa'].reason, /disconnect it first/);
  await bp.disconnect(machine);
  assert.match(s.ops['disconnect:valence-phosphor-machine'].reason, /disconnect failed: .*machine/);
  await bp.disconnect(s.devices.find((d) => d.key === 'lovense-aa'));
  assert.equal(s.ops['disconnect:lovense-aa'].phase, 'settled');
  assert.equal(s.devices.find((d) => d.key === 'lovense-aa').connected, false);
  await bp.forget('lovense-aa');
  assert.equal(s.ops['forget:lovense-aa'].phase, 'settled');
  assert.ok(!s.devices.some((d) => d.key === 'lovense-aa'), 'gone from the list');

  // Nothing is sent while the server is off.
  sh.emit('bp://status', { running: false, port: BP_PORT, clients: 0, scanning: false });
  sh.calls.length = 0;
  await bp.rename('x', 'y');
  await bp.read(vib, bat);
  assert.deepEqual(sh.calls, [], 'device commands need a running server');
  bp.dispose();
}

// --- clients: the list from bp_clients and bp://clients; a disconnect settles when it leaves
{
  const app = { id: 3, name: 'Game', address: '127.0.0.1:50000', since: 1, messages: 40, rate: 12 };
  let conns = [app];
  let stuck = false;
  const sh = fakeShell({
    bp_status: () => ({ running: true, port: BP_PORT, clients: conns.length, scanning: false }),
    bp_clients: () => conns.map((c) => ({ ...c })),
    bp_client_disconnect: ({ id }) => {
      if (!conns.some((c) => c.id === id)) throw 'client ' + id + ' is not connected';
      if (!stuck) conns = conns.filter((c) => c.id !== id);
    },
  });
  const s = blank();
  const bp = createBp(s, sh.api, { echoMs: 20 });
  await bp.init();
  assert.deepEqual(s.conns, [app], 'read on init');
  sh.emit('bp://clients', [{ ...app, rate: 30, messages: 70 }]);
  assert.equal(s.conns[0].rate, 30, 'the event updates the list');

  stuck = true;
  await bp.kick(s.conns[0]);
  assert.deepEqual(sh.calls.find((c) => c[0] === 'bp_client_disconnect')[1], { id: 3 });
  assert.equal(s.ops['kick:3'].phase, 'pending', 'still listed: not yet confirmed');
  assert.match(s.ops['kick:3'].reason, /disconnecting Game/);
  await tick(40);
  assert.equal(s.ops['kick:3'].phase, 'overdue');
  conns = [];
  sh.emit('bp://clients', []);
  assert.equal(s.ops['kick:3'].phase, 'settled', 'leaving the list confirms');

  await bp.kick(app);
  assert.equal(s.ops['kick:3'].phase, 'fault');
  assert.match(s.ops['kick:3'].reason, /disconnect failed: client 3 is not connected/);
  bp.dispose();
}

// --- log: level filter, copy as text, the latest error as the pane's reason
{
  const lines = [
    { level: 'debug', msg: 'd', time: 0 },
    { level: 'info', msg: 'i' },
    { level: 'warn', msg: 'w' },
    { level: 'error', msg: 'e' },
  ];
  assert.deepEqual(logAt(lines, 'warn').map((l) => l.msg), ['w', 'e'], 'at warn: warn and error');
  assert.deepEqual(logAt(lines, 'debug').length, 4);
  assert.equal(logText(lines.slice(0, 2)), '1970-01-01T00:00:00.000Z DEBUG d\nINFO i');

  const sh = fakeShell({
    bp_status: () => ({ running: false, port: BP_PORT, clients: 0, scanning: false }),
    bp_start: () => {},
  });
  const s = blank();
  const bp = createBp(s, sh.api);
  await bp.init();
  for (const l of lines) sh.emit('bp://log', l);
  assert.equal(s.fault, 'e', 'an error line becomes the pane reason');
  sh.emit('bp://log', { level: 'warn', msg: 'later warning' });
  assert.equal(s.fault, 'e', 'only errors replace it');

  let copied = null;
  await bp.copyLog('warn', { writeText: async (x) => { copied = x; } });
  assert.equal(copied, 'WARN w\nERROR e\nWARN later warning');
  assert.equal(s.copy.phase, 'settled');
  assert.match(s.copy.reason, /copied 3 lines/);
  await bp.copyLog('warn', { writeText: async () => { throw new Error('denied'); } });
  assert.equal(s.copy.phase, 'fault');
  assert.match(s.copy.reason, /copy failed: denied/);
  await bp.copyLog('warn', null);
  assert.match(s.copy.reason, /no clipboard/);

  await bp.start();
  assert.equal(s.fault, '', 'a start request clears it');
  bp.dispose();
}

// --- status line: state, port, clients, connected devices
{
  const s = blank();
  assert.equal(statusLine(s), 'unavailable');
  Object.assign(s, { ready: true });
  assert.equal(statusLine(s), 'off');
  Object.assign(s, { running: true, port: 23456, clients: 1,
    devices: [{ connected: true }, { connected: true }, { connected: false }] });
  assert.equal(statusLine(s), 'on 127.0.0.1:23456 · 1 client · 2 devices', 'remembered devices are not counted');
  Object.assign(s, { clients: 0, devices: [{ connected: true }] });
  assert.equal(statusLine(s), 'on 127.0.0.1:23456 · 0 clients · 1 device');
}

console.log('server-pane: ok');
