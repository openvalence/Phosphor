/**
 * graph.test.mjs -- the node graph's model (src/model/graph.js), no hub, no
 * shell, no DOM.
 *
 * Asserts:
 *   (a) the seven maps against SPEC 8.11's own definitions, including the
 *       stateful ones over time and the final clamp into the target;
 *   (b) edge homes and the refusal words; loops and second drivers refused;
 *   (c) the client interlock mirrors SPEC 11.6: no link, no safety word,
 *       ESTOP or PAUSE disarms, and disarming writes each safe value once;
 *   (d) a hub edge serializes to the relationship_keys item (inside the
 *       SPEC 8.7 store-item document) and back losslessly for all seven maps;
 *   (e) client edges round-trip localStorage and degrade when it throws;
 *   (f) the hub surfaces join by store_id against a fixture catalog, and a
 *       hub without the store is declined in words.
 *
 * Run: node test/graph.test.mjs
 */

import {
  MAP, MAPS, evalMap, SAFE, checkRel, homeOf, interlock, emptyGraph, addNode, connect,
  removeRel, freeRelId, encodeItem, decodeItem, storeItem, readStoreItem, saveLocal, loadLocal,
  createRunner, findHub, storeVerb, rosterBits, isUserSpace, addDraft, removeNode, planWire, snap,
  createHistory, preview, endRange, refuseConnect,
  OPS, MATH, COMPARE, LOGIC, evalOp, insOf, outOf, conv, valueOf, addOp, planLink, addLink, topo,
} from '../src/model/graph.js';
import { ROLE } from '../src/model/roles.js';
import { CBOR_FIELD } from '../../Valence/clients/js/frames.js';
import { STORE_OP, CORE_CHANNEL } from '../../Valence/clients/js/generated/registry_vocab.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const near = (a, b, e = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= e;
const rel = (map, params = [], b = [0, 10, 0, 100]) => ({ map, params, in_min: b[0], in_max: b[1], out_min: b[2], out_max: b[3] });

console.log('(a) the seven maps, per SPEC 8.11');
{
  const r = rel(MAP.linear_clamp);
  ok('linear_clamp: L(5) = 50', near(evalMap(r, {}, 5, 0), 50));
  ok('linear_clamp: input clamped low and high', near(evalMap(r, {}, -3, 0), 0) && near(evalMap(r, {}, 12, 0), 100));
  const i = rel(MAP.invert);
  ok('invert: in_min maps to out_max', near(evalMap(i, {}, 0, 0), 100) && near(evalMap(i, {}, 10, 0), 0));
  ok('invert: out_max + out_min - L(2.5) = 75', near(evalMap(i, {}, 2.5, 0), 75));

  const h = rel(MAP.threshold_hysteresis, [7, 3]);
  const hs = {};
  const seq = [5, 7, 5, 3.5, 3, 5].map((x) => evalMap(h, hs, x, 0.05));
  ok('threshold: starts at out_min, out_max at on_above, held between, out_min at off_below',
    JSON.stringify(seq) === JSON.stringify([0, 100, 100, 100, 0, 0]), JSON.stringify(seq));

  const s = rel(MAP.slew_limit, [10, 20]);
  const ss = {};
  evalMap(s, ss, 0, 0);
  const up1 = evalMap(s, ss, 10, 1);
  const up2 = evalMap(s, ss, 10, 1);
  const dn = evalMap(s, ss, 0, 0.5);
  ok('slew_limit: rises at rise_per_s, falls at fall_per_s', near(up1, 10) && near(up2, 20) && near(dn, 10), [up1, up2, dn].join());
  const s1 = rel(MAP.slew_limit, [10]);
  const s1s = {};
  evalMap(s1, s1s, 10, 0);
  ok('slew_limit: one value serves both directions', near(evalMap(s1, s1s, 0, 1), 90));

  const l = rel(MAP.lowpass, [1]);
  const ls = {};
  evalMap(l, ls, 0, 0);
  ok('lowpass: first order, tau 1 s, one tau later = 63.2 %', near(evalMap(l, ls, 10, 1), 100 * (1 - Math.exp(-1))));

  const g = rel(MAP.gate, [], [2, 8, 0, 100]);
  ok('gate: L(in) inside the window, bounds inclusive', near(evalMap(g, {}, 5, 0), 50) && near(evalMap(g, {}, 8, 0), 100));
  ok('gate: outside the window asks for the safe value', evalMap(g, {}, 9, 0) === SAFE && evalMap(g, {}, 1, 0) === SAFE);

  const p = rel(MAP.piecewise_table, [0, 0, 5, 50, 10, 0], [NaN, NaN, NaN, NaN]);
  const pv = [-1, 2.5, 5, 7.5, 11].map((x) => evalMap(p, {}, x, 0));
  ok('piecewise_table: linear between, held outside, bounds unused', JSON.stringify(pv) === JSON.stringify([0, 25, 50, 25, 0]), JSON.stringify(pv));

  ok('checkRel: a table with descending inputs is refused', /ascend/.test(checkRel(rel(MAP.piecewise_table, [5, 0, 1, 1]))));
  ok('checkRel: in_min == in_max is refused', /differ/.test(checkRel(rel(MAP.linear_clamp, [], [1, 1, 0, 1]))));
  ok('checkRel: off_below above on_above is refused', /off below/.test(checkRel(rel(MAP.threshold_hysteresis, [3, 7]))));
  ok('checkRel: a zero slew rate is refused', /above zero/.test(checkRel(rel(MAP.slew_limit, [0]))));
  ok('checkRel: every map has words', Object.keys(MAPS).length === 7 && Object.values(MAPS).every((m) => m.label));

  // The final clamp into the target and the step rule, through the runner.
  const g2 = emptyGraph();
  const a = addNode(g2, { kind: 'field', key: 'src' });
  const b = addNode(g2, { kind: 'field', key: 'dst' });
  connect(g2, a.id, b.id, { map: MAP.linear_clamp, in_min: 0, in_max: 10, out_min: 0, out_max: 200, home: 'client' });
  const wrote = [];
  let x = 10;
  const run = createRunner({
    read: () => x, target: () => ({ min: 0, max: 150, step: 5 }),
    write: (ref, v) => wrote.push(v), armed: () => ({ ok: true }),
  });
  run.step(g2, 1000);
  x = 7.1; run.step(g2, 1050);   // 142: moved 8, written
  x = 7.2; run.step(g2, 1100);   // 144: moved 2 < step 5, held
  ok('output clamped into the target max; written only when moved by its step', JSON.stringify(wrote) === JSON.stringify([150, 142]), JSON.stringify(wrote));
}

console.log('(b) homes and refusals');
{
  const f = { kind: 'field', key: 'k' };
  const bp = { kind: 'bp', device: 'toy', feature: 0, type: 'Vibrate', ctl: 'scalar' };
  ok('a buttplug end runs in Phosphor', homeOf(bp, f, false).home === 'client' && homeOf(f, bp, false).home === 'client');
  ok('field to accessory field runs on the hub', homeOf(f, f, true).home === 'hub');
  ok('field to machine field is refused, with the reason', homeOf(f, f, false).home === null && /accessory/.test(homeOf(f, f, false).why));
  ok('user space is 0x8000-0xBFFF', isUserSpace(0x8000) && isUserSpace(0xbfff) && !isUserSpace(0x7fff) && !isUserSpace(0xc000));

  const g = emptyGraph();
  const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((k) => addNode(g, { kind: 'field', key: k }).id);
  ok('addNode returns the existing node for the same ref', addNode(g, { kind: 'field', key: 'a' }).id === A);
  const o = { map: MAP.linear_clamp, in_min: 0, in_max: 1, out_min: 0, out_max: 1, home: 'hub' };
  connect(g, A, B, o);
  connect(g, B, C, o);
  ok('a chain is allowed', g.rels.length === 2);
  ok('closing a loop is refused', /feedback loop/.test(connect(g, C, A, o).reason || ''));
  ok('a field cannot drive itself', /feedback loop/.test(connect(g, D, D, o).reason || ''));
  ok('a second enabled driver of one target is refused', /already driven/.test(connect(g, D, C, o).reason || ''));
  ok('a bad map is refused at connect', !!connect(g, D, A, { ...o, in_max: 0 }).reason);
  g.rels[0].rel_id = 0;
  g.rels[1].rel_id = 1;
  ok('freeRelId takes the lowest free slot', freeRelId(g) === 2 && freeRelId(g, 2) === -1);
  removeRel(g, g.rels[1].id);
  ok('removing a rel drops the nodes nothing touches', g.rels.length === 1 && g.nodes.length === 2);
}

console.log('(c) the client interlock (SPEC 11.6 mirrored)');
{
  ok('no link disarms', !interlock(false, { estopLatched: false, paused: false }).ok);
  ok('no safety word disarms', !interlock(true, null).ok);
  ok('ESTOP disarms', /e-stop/.test(interlock(true, { estopLatched: true, paused: false }).why));
  ok('PAUSE disarms', /paused/.test(interlock(true, { estopLatched: false, paused: true }).why));
  ok('clear and live arms', interlock(true, { estopLatched: false, paused: false }).ok);

  const g = emptyGraph();
  const a = addNode(g, { kind: 'field', key: 'pos' });
  const t = addNode(g, { kind: 'bp', device: 'toy', feature: 0, type: 'Vibrate', ctl: 'scalar' });
  connect(g, a.id, t.id, { map: MAP.linear_clamp, in_min: 0, in_max: 100, out_min: 0, out_max: 20, home: 'client' });
  let safety = { estopLatched: false, paused: false };
  const wrote = [];
  const run = createRunner({
    read: () => 50, target: () => ({ min: 0, max: 20, step: 1, integer: true, safe: 0 }),
    write: (ref, v) => wrote.push(v), armed: () => interlock(true, safety),
  });
  run.step(g, 0);
  safety = { estopLatched: false, paused: true };
  run.step(g, 50);
  run.step(g, 100);
  ok('pause writes the safe value once, then nothing', JSON.stringify(wrote) === JSON.stringify([10, 0]), JSON.stringify(wrote));
  safety = { estopLatched: false, paused: false };
  run.step(g, 150);
  ok('resume re-arms from fresh state', JSON.stringify(wrote) === JSON.stringify([10, 0, 10]), JSON.stringify(wrote));
  const hub = emptyGraph();
  const h1 = addNode(hub, { kind: 'field', key: 'x' });
  const h2 = addNode(hub, { kind: 'field', key: 'y' });
  connect(hub, h1.id, h2.id, { map: MAP.linear_clamp, in_min: 0, in_max: 1, out_min: 0, out_max: 1, home: 'hub' });
  const before = wrote.length;
  run.step(hub, 200);
  ok('hub edges are never evaluated client-side', wrote.length === before);
}

console.log('(d) hub item round trip, all seven maps');
{
  const params = {
    [MAP.linear_clamp]: [], [MAP.invert]: [], [MAP.threshold_hysteresis]: [7.5, 2.25],
    [MAP.slew_limit]: [12.5, 25], [MAP.lowpass]: [0.25], [MAP.gate]: [],
    [MAP.piecewise_table]: [0, 0, 5, 50, 10, 0],
  };
  for (const map of Object.keys(MAPS).map(Number)) {
    const r = { rel_id: map, name: 'edge ' + map, map, in_min: -2.5, in_max: 40, out_min: 0, out_max: 255, params: params[map], enabled: map % 2 === 1 };
    const src = { channel: 0x8021, field: 3 };
    const dst = { channel: 0x8042, field: 2 };
    const back = decodeItem(encodeItem(r, src, dst));
    const want = { ...r, src, dst };
    const got = back && { ...back };
    ok(MAPS[map].label + ': item decodes to what was encoded', JSON.stringify(got) === JSON.stringify({
      rel_id: want.rel_id, name: want.name, src, dst, map, in_min: r.in_min, in_max: r.in_max,
      out_min: r.out_min, out_max: r.out_max, params: r.params, enabled: r.enabled,
    }), JSON.stringify(got));
    ok(MAPS[map].label + ': through the store-item document too', JSON.stringify(readStoreItem(storeItem(r, src, dst))) === JSON.stringify(got));
  }
  ok('a malformed item decodes to null', decodeItem(Uint8Array.of(0xff)) === null && readStoreItem(Uint8Array.of(0xa0)) === null);
}

console.log('(e) local storage');
{
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const g = emptyGraph();
  const a = addNode(g, { kind: 'field', key: 'pos' }, 10, 20);
  const t = addNode(g, { kind: 'bp', device: 'toy', feature: 0, type: 'Vibrate', ctl: 'scalar', range: [0, 20] }, 300, 20);
  const h = addNode(g, { kind: 'field', key: 'acc' }, 300, 120);
  connect(g, a.id, t.id, { map: MAP.lowpass, in_min: 0, in_max: 100, out_min: 0, out_max: 20, home: 'client' });
  connect(g, a.id, h.id, { map: MAP.gate, in_min: 0, in_max: 100, out_min: 0, out_max: 1, home: 'hub', rel_id: 3, x: 5, y: 6 });
  saveLocal(storage, g);
  const back = loadLocal(storage);
  ok('client edges come back; hub edges keep only a position', back.rels.length === 1 && back.rels[0].home === 'client'
    && back.nodes.length === 3 && JSON.stringify(back.hubPos) === JSON.stringify({ 3: [5, 6] }));
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  let threw = false;
  try { saveLocal(broken, g); } catch (e) { threw = true; }
  ok('a throwing storage degrades to an empty graph, never a throw', !threw && loadLocal(broken).rels.length === 0);
}

console.log('(f) the hub surfaces, against a fixture catalog');
{
  const SID = 9;
  const store = { id: CORE_CHANNEL.relationships, store: { storeId: SID, kind: 'relationship.map', capacity: 16 } };
  const roster = { id: CORE_CHANNEL.relationships_roster, storeId: SID,
    layout: ['generation', 'count', 'capacity', 'armed_lo', 'armed_hi', 'faulted_lo', 'faulted_hi'].map((name) => ({ name })) };
  const writer = { id: CORE_CHANNEL.relationships_write, storeId: SID, schema: [
    { key: 1, role: 'action.store', type: CBOR_FIELD.uint_t },
    { key: 2, type: CBOR_FIELD.uint_t }, { key: 3, type: CBOR_FIELD.tstr_t }, { key: 4, type: CBOR_FIELD.bstr_t },
  ] };
  ok('a hub without the store is declined in words', /no relationships store/.test(findHub([], CORE_CHANNEL.relationships, CBOR_FIELD).reason));
  ok('a store without a writer is declined in words', /no writer/.test(findHub([store], CORE_CHANNEL.relationships, CBOR_FIELD).reason));
  const hub = findHub([store, roster, writer], CORE_CHANNEL.relationships, CBOR_FIELD);
  ok('store, roster and writer join by store_id', hub.store === store && hub.roster === roster && hub.writer === writer
    && hub.slot.key === 2 && hub.name.key === 3 && hub.item.key === 4);
  const bytes = Uint8Array.of(1, 2);
  const save = storeVerb(hub, STORE_OP.save, { rel_id: 5, name: 'n' }, bytes);
  ok('save carries op, slot, name and the item', save[1] === STORE_OP.save && save[2] === 5 && save[3] === 'n' && save[4] === bytes);
  const del = storeVerb(hub, STORE_OP.delete_item, { rel_id: 5, name: 'n' });
  ok('delete carries op and slot only', JSON.stringify(del) === JSON.stringify({ 1: STORE_OP.delete_item, 2: 5 }));
  const bits = rosterBits(roster, { armed_lo: 0b101, armed_hi: 1, faulted_lo: 0, faulted_hi: 0x80 });
  ok('roster bits by rel_id', bits.armed === (0b101 | 256) && bits.faulted === 0x8000);
}

console.log('(g) the editor\'s model: drafts, wiring plans, snap, history, preview, stored view');
{
  const g = emptyGraph();
  const field = (k, x = 0) => addNode(g, { kind: 'field', key: k }, x, 0);
  const [S, T, U] = [field('s'), field('t', 400), field('u', 800)];
  S.pinned = true;
  const homeFor = (a, b) => homeOf(a.ref, b.ref, b.ref.key !== 'machine');
  const d = addDraft(g, MAP.invert, 200, 0);
  const d2 = addDraft(g, MAP.gate, 200, 100);
  ok('a map cannot feed a map', /do not chain/.test(planWire(g, d.id, d2.id, homeFor).reason || ''));
  const p1 = planWire(g, S.id, d.id, homeFor);
  ok('source to an empty draft is a partial plan', p1.partial && p1.from === S.id && p1.to == null && p1.draft === d);
  d.from = S.id;
  const p2 = planWire(g, d.id, T.id, homeFor);
  ok('draft with a source to a target is a full plan', !p2.partial && p2.from === S.id && p2.to === T.id && p2.draft === d);
  const p3 = planWire(g, S.id, U.id, homeFor);
  ok('field to field with no draft is a full plan with no draft', !p3.partial && p3.draft === null);
  connect(g, S.id, T.id, { map: MAP.invert, in_min: 0, in_max: 1, out_min: 0, out_max: 1, home: 'hub', id: 'h0', rel_id: 0 });
  ok('connect keeps a given id', g.rels[0].id === 'h0');
  ok('a rel\'s sockets are full: its output refuses a second target', /already drives/.test(planWire(g, 'h0', U.id, homeFor).reason || ''));
  ok('...and its input a second source', /already reads/.test(planWire(g, U.id, 'h0', homeFor).reason || ''));
  ok('a draft aimed at a driven target is refused before its source is wired', /already driven/.test(planWire(g, d2.id, T.id, homeFor).reason || ''));
  ok('closing a loop through a draft is refused', /feedback loop/.test((d.from = T.id, planWire(g, d.id, S.id, homeFor).reason) || ''));
  const M = addNode(g, { kind: 'field', key: 'machine' }, 0, 300);
  ok('a home mismatch is refused in words', /refused: .*accessory/.test(planWire(g, U.id, M.id, homeFor).reason || ''));

  removeRel(g, 'h0');
  ok('removing a rel keeps pinned nodes and nodes a draft holds, drops the rest',
    g.nodes.some((n) => n.id === S.id) && g.nodes.some((n) => n.id === T.id) && !g.nodes.some((n) => n.id === U.id));
  removeNode(g, T.id);
  ok('removing a node clears the draft end that held it', d.from === null && !g.nodes.some((n) => n.id === T.id));

  ok('snap rounds to the grid', snap(29) === 20 && snap(31) === 40 && snap(-11) === -20 && snap(7, 5) === 5);

  const h = createHistory(2);
  ok('an empty history has nothing to undo', !h.canUndo && h.undo(() => 'x') === null);
  h.push('a'); h.push('b'); h.push('c');
  const u1 = h.undo((e) => 'now<' + e);
  ok('undo returns the latest entry and stores the current state', u1 === 'c' && h.canRedo);
  ok('redo returns what undo stored', h.redo(() => 'cur') === 'now<c');
  h.undo(() => 'y'); h.undo(() => 'z');
  ok('the stack is bounded: the oldest entry fell off', !h.canUndo);
  h.push('d');
  ok('a new edit clears redo', !h.canRedo);

  const lin = preview({ map: MAP.linear_clamp, in_min: 0, in_max: 10, out_min: 0, out_max: 100, params: [] });
  ok('preview: a curve over the input window, ends at the bounds', !lin.time && lin.pts[0][1] === 0 && lin.pts.at(-1)[1] === 100 && lin.x0 === 0 && lin.x1 === 10);
  const gate = preview({ map: MAP.gate, in_min: 2, in_max: 8, out_min: 0, out_max: 100, params: [] });
  ok('preview: a gate shows gaps outside its window', gate.pts[0] === null && gate.pts.at(-1) === null && gate.pts[12] !== null);
  const hy = preview({ map: MAP.threshold_hysteresis, in_min: 0, in_max: 10, out_min: 0, out_max: 1, params: [7, 3] });
  ok('preview: hysteresis is its loop', JSON.stringify(hy.pts) === '[[0,0],[7,0],[7,1],[10,1],[3,1],[3,0]]', JSON.stringify(hy.pts));
  const sl = preview({ map: MAP.slew_limit, in_min: 0, in_max: 1, out_min: 0, out_max: 100, params: [50, 25] });
  ok('preview: slew is a trapezoid, 2 s up and 4 s down for 100 at 50/s and 25/s',
    sl.time && sl.pts.length === 4 && near(sl.pts[1][0], 2) && near(sl.pts[3][0] - sl.pts[2][0], 4));
  const lp = preview({ map: MAP.lowpass, in_min: 0, in_max: 1, out_min: 0, out_max: 100, params: [2] });
  ok('preview: low-pass is its step response over five tau', lp.time && near(lp.x1, 10) && near(lp.pts.at(-1)[1], 100 * (1 - Math.exp(-5))));
  const pw = preview({ map: MAP.piecewise_table, params: [0, 5, 10, 50] });
  ok('preview: a table is its points', JSON.stringify(pw.pts) === '[[0,5],[10,50]]' && pw.y0 === 5 && pw.y1 === 50);

  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  saveLocal(storage, g, { x: -40, y: 20, k: 1.5 });
  const back = loadLocal(storage);
  ok('drafts, pinned nodes and the view round-trip the store', back.drafts.length === 2 && back.nodes.find((n) => n.id === S.id)?.pinned === true
    && JSON.stringify(back.view) === '{"x":-40,"y":20,"k":1.5}');
  saveLocal(storage, g, { x: 0, y: 0, k: 0 });
  ok('a degenerate view loads as none', loadLocal(storage).view === null);

  const g3 = emptyGraph();
  const a = addNode(g3, { kind: 'field', key: 'a' });
  const b = addNode(g3, { kind: 'field', key: 'b' });
  const r = connect(g3, a.id, b.id, { map: MAP.linear_clamp, in_min: 0, in_max: 10, out_min: 0, out_max: 100, home: 'client' }).rel;
  const run = createRunner({ read: () => 5, target: () => ({}), write() {}, armed: () => ({ ok: true }) });
  ok('the runner reports nothing for an edge it has not run', run.out(r.id) === undefined);
  run.step(g3, 0);
  ok('the runner reports the output it last wrote', run.out(r.id) === 50);
}

console.log('(h) a new map\'s ranges come from its ends (ph-9m9)');
{
  const win = [0, 500];
  const is = (got, want) => JSON.stringify(got) === JSON.stringify(want);
  ok('a rail position with no bounds takes the stroke window', is(endRange(undefined, undefined, ROLE.telemetryPosition, win), [0, 500]));
  ok('a declared range wins over the window', is(endRange(0, 20, ROLE.telemetryPosition, win), [0, 20]));
  ok('an unbounded field that is not the rail falls back to 0..1', is(endRange(undefined, undefined, '', win), [0, 1]));
  ok('a rail with no window reported yet falls back to 0..1', is(endRange(undefined, undefined, ROLE.telemetryPosition, [undefined, undefined]), [0, 1]));
  const g = emptyGraph();
  const a = addNode(g, { kind: 'field', key: 'pos' });
  const b = addNode(g, { kind: 'field', key: 'motor' });
  const [in_min, in_max] = endRange(undefined, undefined, ROLE.telemetryPosition, win);
  const [out_min, out_max] = endRange(0, 20, undefined, win);
  const r = connect(g, a.id, b.id, { map: MAP.linear_clamp, in_min, in_max, out_min, out_max, home: 'client' }).rel;
  ok('position 250 of a 0..500 window drives a 0..20 motor to 10, not a saturated 20', near(evalMap(r, {}, 250, 0), 10));
  r.in_max = 400;
  ok('the seeded bounds stay editable', checkRel(r) === '' && near(evalMap(r, {}, 200, 0), 10));
}

console.log('(i) typed nodes: every op, every conversion, order, loops, missing inputs (docs/GRAPH.md)');
{
  const is = (got, want) => JSON.stringify(got) === JSON.stringify(want);
  const run = (kind, x, o = {}) => evalOp({ kind, ...o }, x, o.s || {}, o.dt || 0);
  const math = (fn, a, b) => run('math', { a, b }, { fn });
  const M2 = { add: [3, 2, 5], subtract: [3, 2, 1], multiply: [3, 2, 6], divide: [3, 2, 1.5], power: [3, 2, 9],
    minimum: [3, 2, 2], maximum: [3, 2, 3], modulo: [7, 3, 1] };
  for (const [fn, [a, b, want]] of Object.entries(M2)) ok('Math ' + MATH[fn].label + ': ' + a + ', ' + b + ' -> ' + want, near(math(fn, a, b), want));
  const M1 = { absolute: [-2.5, 2.5], round: [2.5, 3], floor: [-1.5, -2], ceil: [1.2, 2], sqrt: [9, 3], sine: [Math.PI / 2, 1], cosine: [0, 1] };
  for (const [fn, [a, want]] of Object.entries(M1)) ok('Math ' + MATH[fn].label + ': ' + a + ' -> ' + want, near(math(fn, a, 0), want));
  ok('every Math op is tested', Object.keys(MATH).every((k) => k in M2 || k in M1) && Object.keys(MATH).length === 15);
  ok('divide by zero yields 0 (Blender)', math('divide', 5, 0) === 0);
  ok('modulo by zero yields 0; modulo keeps the sign of A', math('modulo', 5, 0) === 0 && near(math('modulo', -7, 3), -1));
  ok('square root of a negative yields 0', math('sqrt', -4, 0) === 0);
  ok('an undefined power yields 0', math('power', -8, 1 / 3) === 0);
  ok('round halves up, as Blender', math('round', -2.5, 0) === -2 && math('round', 0.49, 0) === 0);
  ok('unary ops take one input, binary two', insOf({ kind: 'math', fn: 'sine' }).length === 1 && insOf({ kind: 'math', fn: 'add' }).length === 2);

  const C = { lt: [[1, 2, 1], [2, 2, 0]], le: [[2, 2, 1], [3, 2, 0]], eq: [[1, 1.0005, 1], [1, 1.01, 0]],
    ne: [[1, 1.01, 1], [1, 1.0005, 0]], ge: [[2, 2, 1], [1, 2, 0]], gt: [[3, 2, 1], [2, 2, 0]] };
  for (const [fn, cases] of Object.entries(C)) {
    ok('Compare ' + COMPARE[fn].label + ' outputs bool', cases.every(([a, b, want]) => run('compare', { a, b, eps: 0.001 }, { fn }) === want));
  }
  ok('equal and not equal show the epsilon input; the rest do not', insOf({ kind: 'compare', fn: 'eq' }).length === 3 && insOf({ kind: 'compare', fn: 'lt' }).length === 2);

  const truth = (fn) => [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => run('bool_math', { a, b }, { fn }));
  const T = { and: [0, 0, 0, 1], or: [0, 1, 1, 1], not: [1, 1, 0, 0], xor: [0, 1, 1, 0], nand: [1, 1, 1, 0], nor: [1, 0, 0, 0] };
  for (const [fn, want] of Object.entries(T)) ok('Boolean Math ' + LOGIC[fn].label + ': truth table', is(truth(fn), want), JSON.stringify(truth(fn)));

  ok('Clamp: min and max', run('clamp', { v: 5, min: 0, max: 2 }) === 2 && run('clamp', { v: -1, min: 0, max: 2 }) === 0);
  const mr = { v: 15, from_min: 0, from_max: 10, to_min: 0, to_max: 100 };
  ok('Map Range: clamped by default', run('map_range', mr, { clamp: true }) === 100 && run('map_range', { ...mr, v: 2.5 }, { clamp: true }) === 25);
  ok('Map Range: clamp off extrapolates', run('map_range', mr, { clamp: false }) === 150);
  ok('Map Range: a zero-width from range yields to min', run('map_range', { ...mr, from_max: 0 }, { clamp: true }) === 0);
  ok('Switch: picks True or False', run('switch', { s: 1, f: 2, t: 7 }) === 7 && run('switch', { s: 0, f: 2, t: 7 }) === 2);
  ok('Switch: its type types both arms and the output', outOf({ kind: 'switch', type: 'bool' }) === 'bool'
    && insOf({ kind: 'switch', type: 'int' }).map((p) => p.type).join() === 'bool,int,int');
  ok('Gate: passes while open, asks for the safe value while shut', run('gate', { v: 4, open: 1 }) === 4 && run('gate', { v: 4, open: 0 }) === SAFE);
  const hs = {};
  const hy = [0.5, 0.7, 0.5, 0.41, 0.4, 0.5].map((v) => run('threshold', { v, on: 0.6, off: 0.4 }, { s: hs }));
  ok('Threshold: on above, held between, off below (hysteresis, outputs bool)', is(hy, [0, 1, 1, 1, 0, 0]), JSON.stringify(hy));
  const ss = {};
  run('slew', { v: 0, rise: 10, fall: 20 }, { s: ss });
  const sl = [[10, 0.5], [10, 0.5], [0, 0.25]].map(([v, dt]) => run('slew', { v, rise: 10, fall: 20 }, { s: ss, dt }));
  ok('Slew: rises at rise per s, falls at fall per s', is(sl, [5, 10, 5]), JSON.stringify(sl));
  const ls = {};
  run('lowpass', { v: 0, tau: 1 }, { s: ls });
  ok('Low-pass: one tau later is 63.2 %', near(run('lowpass', { v: 10, tau: 1 }, { s: ls, dt: 1 }), 10 * (1 - Math.exp(-1))));
  ok('Input nodes output their own value', run('value', { v: 0.25 }) === 0.25 && run('integer', { v: 3 }) === 3 && run('boolean', { v: 1 }) === 1);
  ok('every node kind evaluates', Object.keys(OPS).every((k) => evalOp(addOp(emptyGraph(), k), Object.fromEntries(insOf(addOp(emptyGraph(), k)).map((p) => [p.name, p.def])), {}, 0) !== undefined));

  ok('int to float is exact', conv(3, 'int', 'float') === 3);
  ok('float to int rounds', conv(2.6, 'float', 'int') === 3 && conv(2.4, 'float', 'int') === 2);
  ok('bool to number is 0 or 1', conv(1, 'bool', 'float') === 1 && conv(0, 'bool', 'int') === 0);
  ok('number to bool is nonzero', conv(0.01, 'float', 'bool') === 1 && conv(0, 'float', 'bool') === 0 && conv(-3, 'int', 'bool') === 1);
  ok('a Gate\'s safe request passes conversion untouched', conv(SAFE, 'float', 'bool') === SAFE);
  ok('an unlinked input is the node\'s own value as its type', valueOf({ vals: { v: 2.7 } }, { name: 'v', type: 'int', def: 0 }) === 3
    && valueOf({ vals: {} }, { name: 'v', type: 'bool', def: 0.2 }) === 1);

  // A chain: field -> Math (multiply) -> Compare (> 1) -> Switch (bool) -> toy, ops added downstream first.
  const g = emptyGraph();
  const src = addNode(g, { kind: 'field', key: 'src' });
  const dst = addNode(g, { kind: 'bp', device: 'toy', feature: 0, type: 'Vibrate', ctl: 'scalar' });
  const sw = addOp(g, 'switch');
  sw.vals = { f: 2, t: 9 };
  const cmp = addOp(g, 'compare');
  cmp.vals = { b: 1 };
  const mul = addOp(g, 'math');
  mul.fn = 'multiply';
  mul.vals = { b: 2 };
  ok('topological order runs upstream first, whatever the add order', is(topo(g).map((o) => o.kind), ['switch', 'compare', 'math']));
  const link = (from, to, port) => { const p = planLink(g, from, to, port); return p.reason || addLink(g, p); };
  link(src.id, mul.id, 'a');
  link(mul.id, cmp.id, 'a');
  link(cmp.id, sw.id, 's');
  link(sw.id, dst.id);
  ok('after linking, upstream evaluates first', is(topo(g).map((o) => o.kind), ['math', 'compare', 'switch']));
  ok('a link closing a cycle is refused in words', /would loop/.test(planLink(g, sw.id, mul.id, 'b').reason || ''));
  ok('a target cannot drive its own source through a chain', /would loop/.test(planLink(g, mul.id, src.id).reason || ''));
  ok('a node chain\'s target refuses a second driver from a map', /already driven/.test(refuseConnect(g, src.id, dst.id)));
  ok('a map cannot sit in a chain', /maps join two fields/.test(planLink(g, addDraft(g, MAP.invert, 0, 0).id, mul.id, 'a').reason || ''));
  const before = g.links.length;
  link(src.id, mul.id, 'a');
  ok('a second link into one input replaces the first', g.links.length === before);

  let x = 0.7;
  let safety = { estopLatched: false, paused: false };
  const wrote = [];
  const io = {
    read: (ref) => (ref.key === 'src' ? x : undefined), type: () => 'float',
    target: () => ({ min: 0, max: 20, step: 1, integer: true, safe: 0 }), write: (ref, v) => wrote.push(v),
    armed: () => interlock(true, safety),
  };
  const r = createRunner(io);
  r.step(g, 0);
  x = 0.4; r.step(g, 50);
  ok('the chain drives its target each tick: 0.7*2 > 1 picks 9, 0.4*2 picks 2', is(wrote, [9, 2]), JSON.stringify(wrote));
  ok('every op\'s value is readable while armed', r.val(mul.id) === 0.8 && r.val(cmp.id) === 0 && r.out(dst.id) === 2);
  x = undefined; r.step(g, 100);
  ok('a missing input outputs nothing downstream: the target gets its safe value once, with the reason',
    is(wrote, [9, 2, 0]) && /Add has no a|Multiply has no a/.test(r.why(dst.id)), r.why(dst.id));
  r.step(g, 150);
  ok('...and nothing more while the input stays missing', wrote.length === 3);
  x = 0.7; r.step(g, 200);
  ok('the value back re-drives it', is(wrote, [9, 2, 0, 9]) && r.why(dst.id) === '');
  safety = { estopLatched: false, paused: true };
  r.step(g, 250); r.step(g, 300);
  ok('pause disarms the chain: the safe value once (SPEC 11.6 mirrored)', is(wrote, [9, 2, 0, 9, 0]) && r.val(mul.id) === undefined);

  const gate = addOp(g, 'gate');
  const gx = emptyGraph();
  gx.nodes = g.nodes; gx.ops = [mul, gate]; gx.links = [];
  const lg = (from, to, port) => addLink(gx, planLink(gx, from, to, port));
  lg(src.id, mul.id, 'a');
  lg(mul.id, gate.id, 'v');
  lg(gate.id, dst.id);
  gate.vals = { open: 0 };
  const w2 = [];
  const r2 = createRunner({ ...io, armed: () => ({ ok: true }), write: (ref, v) => w2.push(v), target: () => ({ min: 0, max: 20, safe: 0.5 }) });
  r2.step(gx, 0);
  ok('a shut Gate drives its target to the safe value', is(w2, [0.5]), JSON.stringify(w2));

  const ib = emptyGraph();
  const bt = addNode(ib, { kind: 'field', key: 'flag' });
  const iv = addOp(ib, 'value');
  iv.vals = { v: 0.4 };
  addLink(ib, planLink(ib, iv.id, bt.id));
  const w3 = [];
  createRunner({ read: () => 0, type: () => 'bool', target: () => ({}), write: (ref, v) => w3.push(v), armed: () => ({ ok: true }) }).step(ib, 0);
  ok('a float into a bool target is converted on the link: 0.4 writes 1', is(w3, [1]), JSON.stringify(w3));

  // Old graphs.
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  mem.set('phosphor.graph', JSON.stringify({ v: 1, nodes: [{ id: 'n1', ref: { kind: 'field', key: 'a' }, x: 0, y: 0 }],
    rels: [{ id: 'r1', name: 'x', from: 'n1', to: 'n1', map: MAP.invert, in_min: 0, in_max: 1, out_min: 0, out_max: 1, params: [], enabled: true, home: 'client' }],
    drafts: [], hubPos: {}, view: null }));
  const old = loadLocal(storage);
  ok('a version 1 graph loads unchanged, with no ops and no links', old.nodes.length === 1 && old.rels.length === 1 && is(old.ops, []) && is(old.links, []));
  saveLocal(storage, g);
  const back = loadLocal(storage);
  ok('ops and links round-trip at version 2', JSON.parse(mem.get('phosphor.graph')).v === 2 && back.ops.length === g.ops.length
    && back.links.length === g.links.length && back.ops.find((o) => o.id === mul.id).fn === 'multiply');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
