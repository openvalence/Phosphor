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

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const is = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TICK = 50;

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

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
