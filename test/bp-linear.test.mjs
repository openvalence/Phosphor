/**
 * bp-linear.test.mjs -- position with duration through the node graph, no hub,
 * no shell, no DOM.
 *
 * Asserts:
 *   (a) Rate limit passes the newest value at most every N ms and holds the
 *       last passed one between; Interval is the ms between changes of its input;
 *   (b) a position-with-duration target takes a Duration link; others refuse it;
 *   (c) the target's write carries the duration: Interval wired in follows the
 *       input's own period, a wired Value overrides, an unwired Duration is the
 *       node's own default.
 *
 * Run: node test/bp-linear.test.mjs
 */

import {
  emptyGraph, addNode, addOp, planLink, addLink, evalOp, createRunner, DEFAULT_MS,
} from '../src/model/graph.js';
import { createPluginHost } from '../src/plugins/host.js';
import { manifest, graphRuntime } from '../src/plugins/graph.js';
import { createPacer, gapOf, DEFAULT_GAP_MS } from '../src/plugins/bp-pace.js';
import { createTraces, pushPoint, SPAN_MS } from '../src/model/trace.js';
import { createToy, blankToy } from '../src/plugins/buttplug-toys.js';
import { PRESETS } from '../src/model/graph-presets.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const is = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TICK = 50;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('(a) Rate limit and Interval');
{
  const rl = addOp(emptyGraph(), 'ratelimit');
  const s = {};
  const run = (v, every, dt = TICK / 1000) => evalOp(rl, { v, every }, s, dt);
  const out = [1, 2, 3, 4, 5, 6, 7].map((v) => run(v, 150));
  ok('passes the first value at once, then the newest every 150 ms (3 ticks)', is(out, [1, 1, 1, 4, 4, 4, 7]), JSON.stringify(out));
  ok('between passes it holds the last passed value, never an older one', run(8, 150) === 7);
  const fast = {};
  const out2 = [1, 2, 3].map((v) => evalOp(rl, { v, every: 10 }, fast, TICK / 1000));
  ok('a limit under the tick passes every tick', is(out2, [1, 2, 3]), JSON.stringify(out2));

  const sc = addOp(emptyGraph(), 'scope');
  const ss = {};
  const passed = [3, 3, 4, 4, 5].map((v) => evalOp(sc, { v }, ss, TICK / 1000));
  ok('Scope passes its input through and keeps a point per change on its own clock', is(passed, [3, 3, 4, 4, 5]) && is(ss.buf, [[50, 3], [150, 4], [250, 5]]) && ss.ver === 3, JSON.stringify(ss.buf));

  const iv = addOp(emptyGraph(), 'interval');
  const t = {};
  const seq = [0, 0, 1, 1, 1, 2, 3].map((v) => evalOp(iv, { v }, t, TICK / 1000));
  ok('nothing before the first change, then the ms since the previous change', is(seq, [undefined, undefined, 100, 100, 100, 150, 50]), JSON.stringify(seq));
}

console.log('(b) the Duration link');
{
  const g = emptyGraph();
  const lin = addNode(g, { kind: 'bp', device: 'ossm', feature: 0, type: 'HwPositionWithDuration', ctl: 'linear', range: [0, 100] });
  const vib = addNode(g, { kind: 'bp', device: 'toy', feature: 0, type: 'Vibrate', ctl: 'scalar', range: [0, 20] });
  const v = addOp(g, 'value');
  ok('a position-with-duration target takes a Duration link', !planLink(g, v.id, lin.id, 'ms').reason);
  ok('a vibrate target refuses it in words', /position-with-duration/.test(planLink(g, v.id, vib.id, 'ms').reason || ''));
  ok('a main input is not the Duration', !planLink(g, v.id, lin.id).reason && planLink(g, v.id, lin.id).port === undefined);
  addLink(g, planLink(g, v.id, lin.id, 'ms'));
  const p = planLink(g, v.id, lin.id);
  ok('a Duration link does not count as a driver of the target', !p.reason);
  const w = addOp(g, 'value');
  ok('a second Duration replaces the first', planLink(g, w.id, lin.id, 'ms').replace === g.links[0]);
}

console.log('(c) the write carries the duration');
{
  const mk = (wire) => {
    const g = emptyGraph();
    const src = addNode(g, { kind: 'field', key: 'pos' });
    const dst = addNode(g, { kind: 'bp', device: 'ossm', feature: 0, type: 'HwPositionWithDuration', ctl: 'linear', range: [0, 100] });
    const map = addOp(g, 'map_range');
    map.vals = { from_max: 100, to_max: 100 };
    const link = (a, b, port) => addLink(g, planLink(g, a, b, port));
    link(src.id, map.id, 'v');
    link(map.id, dst.id);
    wire(g, src, dst, link);
    return { g, dst };
  };
  const drive = (g, steps) => {
    const writes = [];
    let x = 0;
    const run = createRunner({
      read: () => x, target: () => ({ min: 0, max: 100, step: 1, integer: true }),
      write: (ref, v, ms) => writes.push([v, ms]), armed: () => ({ ok: true }),
    });
    steps.forEach(([pos], i) => { x = pos; run.step(g, 1000 + i * TICK); });
    return writes;
  };
  // Position moves every other tick: the period is 100 ms.
  const steps = [[10], [10], [20], [20], [30], [30], [40]];

  const a = mk((g, src, dst, link) => { const iv = addOp(g, 'interval'); link(src.id, iv.id, 'v'); link(iv.id, dst.id, 'ms'); });
  const wa = drive(a.g, steps);
  ok('Interval wired in: the duration is the period of the incoming position', is(wa.map((w) => w[1]), [100, 100, 100, 100]), JSON.stringify(wa));

  const b = mk((g, src, dst, link) => { const v = addOp(g, 'value'); v.vals = { v: 300 }; link(v.id, dst.id, 'ms'); });
  ok('a wired Value overrides', is(drive(b.g, steps).map((w) => w[1]), [300, 300, 300, 300]));

  const c = mk(() => {});
  ok('an unwired Duration is the default', is(drive(c.g, steps).map((w) => w[1]), [DEFAULT_MS, DEFAULT_MS, DEFAULT_MS, DEFAULT_MS]));
  c.dst.ms = 250;
  ok('the node own value, once edited', is(drive(c.g, steps).map((w) => w[1]), [250, 250, 250, 250]));
}

console.log('(d) the device update rate: newest wins, the window respected');
{
  let t = 0;
  const timers = [];
  const pacer = createPacer({ now: () => t, later: (fn, ms) => { timers.push([t + ms, fn]); return timers.length; } });
  const sent = [];
  let newest = null;
  const ask = (v) => { const fresh = newest === null; newest = v; if (fresh) pacer.when('d', 50, () => { sent.push([t, newest]); newest = null; }); };
  ask(1);
  ok('an open window sends at once', is(sent, [[0, 1]]));
  t = 10; ask(2); t = 20; ask(3); t = 30; ask(4);
  ok('inside the window nothing goes out', sent.length === 1 && timers.length === 1);
  t = timers[0][0]; timers[0][1]();
  ok('at the window the newest goes, once, no sooner than the gap', is(sent, [[0, 1], [50, 4]]), JSON.stringify(sent));
  t = 120; ask(5);
  ok('after a quiet gap the next value is immediate again', sent.at(-1)[0] === 120 && sent.at(-1)[1] === 5);
  ok('the gap is the device config, else the BLE default', gapOf({ message_gap_ms: 40 }) === 40 && gapOf({}) === DEFAULT_GAP_MS && gapOf(null) === DEFAULT_GAP_MS);
}

console.log('(e) the history buffer');
{
  const buf = [];
  for (let t = 0; t <= 12000; t += 1000) pushPoint(buf, t, t / 1000);
  ok('points older than the span are dropped', buf[0][0] >= 12000 - SPAN_MS - 1000 && buf.at(-1)[0] === 12000 && buf.length <= 12, buf.length);
  const big = [];
  for (let i = 0; i < 2000; i++) pushPoint(big, i, i);
  ok('and the buffer is capped', big.length <= 512);
  let t = 0;
  const store = new Map();
  const tr = createTraces({ now: () => t, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
  tr.push('k', 1);
  ok('off by default: nothing is recorded', tr.points('k').length === 0 && tr.version('k') === 0);
  let heard = 0;
  tr.subscribe(() => { heard++; });
  tr.set('k', true);
  t = 5; tr.push('k', 7);
  ok('switched on, it records each value with its time and says so', is(tr.points('k'), [[5, 7]]) && heard === 2 && tr.version('k') === 2);
  ok('the switch is remembered per viewer', createTraces({ storage: { getItem: (k) => store.get(k) ?? null } }).on('k'));
  tr.set('k', false);
  ok('switched off, it forgets', tr.points('k').length === 0);
}

console.log('(f) a toy module sends position and duration intact, at the device rate');
{
  const LIN = { index: 3, key: 'ossm-aa', name: 'OSSM', kind: 'toy', connected: true, message_gap_ms: 50,
    controls: [{ feature: 0, description: 'Stroke', kind: 'linear', type: 'HwPositionWithDuration', range: [0, 100], ms: [0, 100000] }] };
  const calls = [];
  const shell = { invoke: async (cmd, a) => { calls.push([cmd, a]); return null; }, listen: async () => () => {} };
  let t = 0;
  const timers = [];
  const pacer = createPacer({ now: () => t, later: (fn, ms) => { timers.push([t + ms, fn]); return 1; } });
  const st = blankToy(LIN);
  const toy = createToy(st, LIN, shell, { pace: pacer, traces: createTraces({ now: () => t }) });
  toy.send(LIN.controls[0], 40, 250);
  await Promise.resolve();
  ok('bp_toy_linear carries the position and the duration as sent', is(calls, [['bp_toy_linear', { index: 3, feature: 0, position: 40, ms: 250 }]]), JSON.stringify(calls));
  await delay(5);
  t = 10; toy.send(LIN.controls[0], 60, 300);
  t = 20; toy.send(LIN.controls[0], 80, 90);
  await Promise.resolve();
  ok('inside the window the module waits', calls.length === 1);
  t = timers[0][0]; timers[0][1]();
  await Promise.resolve();
  ok('at the window the newest position goes with its own duration', is(calls.at(-1), ['bp_toy_linear', { index: 3, feature: 0, position: 80, ms: 90 }]) && calls.length === 2, JSON.stringify(calls));
  toy.dispose();
}

console.log('(g) the starting graphs load and run');
{
  const num = (name, role, unit, min, max, ch) => ({ uid: ch + ':' + name, channelId: ch, name, label: name, unit, type: 2, min, max, readOnly: true, role });
  const F = {
    target: num('target', 'telemetry.target', 'mm', 0, 100, 129),
    wmin: num('wmin', 'window.min', 'mm', 0, 100, 130),
    wmax: num('wmax', 'window.max', 'mm', 0, 100, 130),
    end: num('end', 'plan.end', '', 0, 1, 131),
    dur: num('dur', 'plan.duration', 'us', 0, 1e9, 131),
    el: num('el', 'plan.elapsed', 'us', 0, 1e9, 131),
  };
  const fields = Object.values(F);
  const byRole = new Map(fields.map((f) => [f.role, [f]]));
  const model = { fields, byRole, actions: [], categories: [] };
  const samples = { 129: { target: 40 }, 130: { wmin: 20, wmax: 60 }, 131: { end: 0.5, dur: 400000, el: 150000 } };
  const host = createPluginHost({
    model: () => model, sample: (ch) => samples[ch], sampleAge: () => 0, display: (f, sm) => (sm ? sm[f.name] : undefined),
    status: () => 'confirmed', write: () => {}, submitMotion: () => ({ ok: true }), registerTheme: () => {}, prefs: null, log: () => {},
  });
  const OSSM = { index: 5, key: 'ossm-aa', name: 'OSSM', kind: 'toy', connected: true,
    controls: [{ feature: 0, description: 'Stroke', kind: 'linear', type: 'HwPositionWithDuration', range: [0, 100], ms: [0, 100000] }] };
  let devices = [];
  const calls = [];
  const handlers = new Map();
  const shell = {
    listen: (ev, fn) => { handlers.set(ev, fn); return Promise.resolve(() => handlers.delete(ev)); },
    invoke: async (cmd, a) => { if (cmd === 'bp_devices') return devices; calls.push([cmd, a]); return null; },
  };
  const env = { live: () => true, safety: () => ({ estopLatched: false, paused: false }), storage: { getItem: () => null, setItem() {} },
    entries: () => [], sample: (ch) => samples[ch], pace: { when: (k, g, fn) => fn() } };
  let rt = null;
  host.add(manifest, { activate(api) { rt = graphRuntime(api, shell, env); return rt.dispose; } }, { source: 'built-in' });
  await delay(10);
  ok('with no position-with-duration toy a preset says so', /no toy/.test(rt.applyPreset('mirror-position')));
  devices = [OSSM];
  handlers.get('bp://devices')({ payload: devices });
  ok('both presets are offered', is(rt.presets.map((p) => p.id), ['mirror-position', 'mirror-plan']) && PRESETS.length === 2);

  ok('Mirror machine position loads', rt.applyPreset('mirror-position') === '');
  const g = rt.graph;
  const kinds = g.ops.map((o) => o.kind).sort();
  ok('it is Target and the window into Map range into the Stroke node, with Target through Interval into its Duration',
    is(kinds, ['interval', 'map_range']) && g.nodes.length === 4 && g.links.length === 6 && g.links.filter((l) => l.port === 'ms').length === 1
    && g.ops.find((o) => o.kind === 'map_range').vals.to_max === 100, JSON.stringify(g.links));
  ok('the same preset again is refused while the node is driven', /already driven/.test(rt.applyPreset('mirror-position')));
  rt.tick();
  await delay(60);
  samples[129].target = 50;
  rt.tick();
  await delay(5);
  const lin = calls.filter((c) => c[0] === 'bp_toy_linear');
  ok('the window 20..60 maps target 40 to 50 and 50 to 75', is(lin.map((c) => c[1].position), [50, 75]), JSON.stringify(lin));
  ok('the duration is the period of the incoming position, to the tick', lin.length === 2 && lin[1][1].ms >= 40 && lin[1][1].ms <= 250, JSON.stringify(lin.at(-1)));

  // The plan preset on a fresh graph.
  rt.undo();
  calls.length = 0;
  ok('Mirror machine plan loads', rt.applyPreset('mirror-plan') === '');
  rt.tick();
  await delay(5);
  const p = calls.filter((c) => c[0] === 'bp_toy_linear').at(-1);
  ok('plan end 0.5 sends position 50 over the plan remaining, 250 ms', !!p && p[1].position === 50 && p[1].ms === 250, JSON.stringify(p));
  rt.dispose();
}


console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
