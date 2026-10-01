/**
 * buttplug-toys.test.mjs -- toys as modules (src/plugins/buttplug-toys.js),
 * with a fake invoke/listen and no shell.
 *
 * Asserts:
 *   (a) each toy bp_devices lists registers one hero on the REAL plugin host,
 *       keyed by the server's stable key; the machine registers none;
 *   (b) toys withdraw and return with bp://devices, and deactivating the
 *       adapter withdraws them all;
 *   (c) each control's command maps to its bp_toy_* call and walks the
 *       ladder: pending (showing the request), applied on the ack, fault with
 *       the error in words, overdue on silence; latest wins while in flight;
 *   (d) bp://output from any client is the shown value; the module stop is
 *       bp_toy_stop and drops a queued command; sensors read on init and dim
 *       on a failed read.
 * The Rust half is `cargo test` in src-tauri (simulated toys).
 *
 * Run: node test/buttplug-toys.test.mjs
 */

import { createPluginHost } from '../src/plugins/host.js';
import { claimAll } from '../src/model/roles.js';
import { manifest } from '../src/plugins/buttplug.js';
import { toyModules, createToy, blankToy, shown } from '../src/plugins/buttplug-toys.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const VIBE = {
  index: 1, key: 'lovense-aa-bb', name: 'Lush', kind: 'toy', connected: true, features: ['Battery', 'Vibrate'],
  controls: [
    { feature: 0, description: 'Motor', kind: 'scalar', type: 'Vibrate', range: [0, 20] },
    { feature: 1, description: '', kind: 'sensor', type: 'Battery' },
  ],
};
const ROT = {
  index: 2, key: 'vorze-sa-cc', name: 'Cyclone', kind: 'toy', connected: true, features: ['Rotate'],
  controls: [{ feature: 0, description: '', kind: 'rotate', type: 'Rotate', range: [-100, 100] }],
};
const LIN = {
  index: 3, key: 'kiiroo-v21-dd', name: 'Onyx', kind: 'toy', connected: true, features: ['HwPositionWithDuration'],
  controls: [{ feature: 0, description: '', kind: 'linear', type: 'HwPositionWithDuration', range: [0, 99], ms: [0, 9999] }],
};
const MACHINE = { index: 0, key: 'valence-phosphor-machine', name: 'Valence Machine', kind: 'machine', connected: true, features: [], controls: [] };

/** A fake Tauri shell: listen records handlers, invoke answers from `answers` or a deferred. */
function fakeShell(answers = {}) {
  const handlers = new Map();
  const calls = [];
  const pending = [];
  let unlistened = 0;
  return {
    calls, pending, handlers,
    take: (cmd) => pending.splice(pending.findIndex((x) => x.cmd === cmd), 1)[0],
    get unlistened() { return unlistened; },
    emit: (ev, payload) => (handlers.get(ev) || []).forEach((fn) => fn({ payload })),
    listen: async (ev, fn) => {
      handlers.set(ev, [...(handlers.get(ev) || []), fn]);
      return () => { unlistened++; handlers.set(ev, (handlers.get(ev) || []).filter((f) => f !== fn)); };
    },
    invoke: (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd in answers) return Promise.resolve(answers[cmd]);
      return new Promise((resolve, reject) => pending.push({ cmd, args, resolve, reject }));
    },
  };
}

function hostWithToys(shell) {
  const logs = [];
  const host = createPluginHost({
    model: () => null, sample: () => undefined, sampleAge: () => Infinity,
    display: () => undefined, status: () => 'confirmed', write: () => {},
    submitMotion: () => ({ ok: true }), registerTheme: () => {}, listenTcp: null, prefs: null,
    log: (name, level, msg) => logs.push({ name, level, msg }),
  });
  const mounted = [];
  const render = (el, toy) => { mounted.push(toy.key); return {}; };
  host.add(manifest, { activate: (api) => toyModules(api, shell, render) });
  const ids = () => host.heroes().map((h) => h.id).sort();
  return { host, ids, mounted, logs };
}

console.log('(a) one hero per toy, keyed by the stable key');
{
  const shell = fakeShell({ bp_devices: [MACHINE, VIBE, ROT] });
  const { host, ids, mounted } = hostWithToys(shell);
  await delay(0);
  ok('the toys register, the machine does not',
    JSON.stringify(ids()) === JSON.stringify(['plugin:buttplug:lovense-aa-bb', 'plugin:buttplug:vorze-sa-cc']), JSON.stringify(ids()));
  const h = host.heroes().find((x) => x.id.endsWith('lovense-aa-bb'));
  ok('titled by the toy name, footprint per control', h.title === 'Lush' && h.cells.h[1] === 4 && h.absorb === false, JSON.stringify(h.cells));
  const { widgets } = claimAll(new Map(), host.heroes());
  ok('the claim pass places them (no catalog roles needed)', widgets.length === 2);
  host.mountHero(h, {}, {});
  ok('mount renders the toy', mounted[0] === 'lovense-aa-bb');
}

console.log('(b) withdraw and return with bp://devices; deactivation withdraws all');
{
  const shell = fakeShell({ bp_devices: [VIBE, ROT] });
  const { host, ids } = hostWithToys(shell);
  await delay(0);
  shell.emit('bp://devices', [MACHINE, ROT]);
  ok('a toy that left is withdrawn', JSON.stringify(ids()) === JSON.stringify(['plugin:buttplug:vorze-sa-cc']), JSON.stringify(ids()));
  shell.emit('bp://devices', [ROT, VIBE]);
  ok('it returns under the same key', ids().length === 2 && ids().includes('plugin:buttplug:lovense-aa-bb'));
  const before = host.heroes().find((x) => x.id.endsWith('vorze-sa-cc')).slot;
  shell.emit('bp://devices', [{ ...ROT, index: 7 }, VIBE]);
  const after = host.heroes().find((x) => x.id.endsWith('vorze-sa-cc')).slot;
  ok('a changed listing re-registers (new index reaches the module)', before !== after && after.def.id === 'vorze-sa-cc');
  shell.emit('bp://devices', []);
  ok('a stopped server withdraws every toy', ids().length === 0);
  shell.emit('bp://devices', [VIBE]);
  host.setEnabled('buttplug', false);
  ok('deactivating the adapter withdraws them and stops listening', ids().length === 0 && shell.unlistened === 1);
}

console.log('(c) commands and the ladder');
{
  const shell = fakeShell();
  const s = blankToy(VIBE);
  const t = createToy(s, VIBE, shell, { echoMs: 30, readMs: 60000 });
  const c = VIBE.controls[0];
  const w = s.ctl['0:Vibrate'];
  ok('no value before the server reports one (law 9)', shown(w) === null);
  t.send(c, 12);
  ok('bp_toy_scalar(index, feature, value)', JSON.stringify(shell.calls.at(-1)) === JSON.stringify(['bp_toy_scalar', { index: 1, feature: 0, value: 12 }]));
  ok('pending, showing the request', w.phase === 'pending' && shown(w) === 12 && /waiting/.test(w.reason));
  t.send(c, 15);
  t.send(c, 18);
  ok('latest wins: nothing more sent while in flight', shell.calls.filter((x) => x[0] === 'bp_toy_scalar').length === 1 && shown(w) === 18);
  shell.pending.shift().resolve();
  await delay(0);
  ok('the ack sends the queued latest', JSON.stringify(shell.calls.at(-1)[1]) === JSON.stringify({ index: 1, feature: 0, value: 18 }) && w.value === 12);
  shell.pending.shift().resolve();
  await delay(0);
  ok('applied on the ack, in words', w.phase === 'settled' && w.value === 18 && w.reason === 'applied');

  t.send(c, 25);
  shell.pending.shift().reject('device 1 feature 0: value 25 out of range');
  await delay(0);
  ok('fault with the error in words, applied value kept', w.phase === 'fault' && /out of range/.test(w.reason) && shown(w) === 18);

  t.send(c, 5);
  await delay(50);
  ok('overdue on silence, in words', w.phase === 'overdue' && /no answer/.test(w.reason));
  shell.pending.shift().resolve();
  await delay(0);

  const r = createToy(blankToy(ROT), ROT, shell);
  r.send(ROT.controls[0], -40);
  ok('bp_toy_rotate(index, feature, speed), signed', JSON.stringify(shell.calls.at(-1)) === JSON.stringify(['bp_toy_rotate', { index: 2, feature: 0, speed: -40 }]));
  const l = createToy(blankToy(LIN), LIN, shell);
  l.send(LIN.controls[0], 50, 300);
  ok('bp_toy_linear(index, feature, position, ms)', JSON.stringify(shell.calls.at(-1)) === JSON.stringify(['bp_toy_linear', { index: 3, feature: 0, position: 50, ms: 300 }]));
  for (const p of shell.pending.splice(0)) p.resolve();
  t.dispose(); r.dispose(); l.dispose();
}

console.log('(d) echoes from any client, the module stop, sensors');
{
  const shell = fakeShell();
  const s = blankToy(VIBE);
  const t = createToy(s, VIBE, shell, { echoMs: 1000, readMs: 60000 });
  await t.init();
  const read = shell.take('bp_toy_read');
  ok('sensors read on init: bp_toy_read(index, feature, input)', !!read && JSON.stringify(read.args) === JSON.stringify({ index: 1, feature: 1, input: 'Battery' }));
  read.resolve(87);
  await delay(0);
  ok('the reading is shown', shown(s.ctl['1:Battery']) === 87 && !s.ctl['1:Battery'].stale);

  shell.emit('bp://output', { index: 1, feature: 0, type: 'Vibrate', value: 9 });
  shell.emit('bp://output', { index: 2, feature: 0, type: 'Vibrate', value: 3 });
  ok('an app\'s applied output is the shown value; another toy\'s is not', shown(s.ctl['0:Vibrate']) === 9);

  const c = VIBE.controls[0];
  t.send(c, 14);
  t.send(c, 16);
  const sent = shell.calls.filter((x) => x[0] === 'bp_toy_scalar').length;
  t.stop();
  ok('Stop is bp_toy_stop(index)', JSON.stringify(shell.calls.at(-1)) === JSON.stringify(['bp_toy_stop', { index: 1 }]) && s.stop.phase === 'pending');
  shell.take('bp_toy_scalar').resolve();
  shell.take('bp_toy_stop').resolve();
  await delay(0);
  ok('a stop drops the queued command', shell.calls.filter((x) => x[0] === 'bp_toy_scalar').length === sent && s.stop.reason === 'stopped');
  shell.emit('bp://output', { index: 1, feature: 0, type: 'Vibrate', value: 0 });
  ok('the stop\'s applied zero is shown', s.ctl['0:Vibrate'].value === 0);

  t.read(VIBE.controls[1]);
  shell.take('bp_toy_read').reject('device disconnected');
  await delay(0);
  const b = s.ctl['1:Battery'];
  ok('a failed read keeps the last reading, dimmed, with the reason', b.value === 87 && b.stale && /disconnected/.test(b.reason));
  t.dispose();
  ok('dispose stops listening', shell.unlistened === 1);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
