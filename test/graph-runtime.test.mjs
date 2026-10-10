/**
 * graph-runtime.test.mjs -- the node graph's runtime (src/plugins/graph.js)
 * through the REAL plugin host, with a fake invoke/listen and a fake hub.
 *
 * Asserts:
 *   (a) the editor registers as a placeable plugin hero with its cells;
 *   (b) mapping 1: an Intiface app's vibrate drives stroke speed through
 *       api.write under the `intent` permission (the shadow ladder's door);
 *   (c) mapping 2: machine position drives a toy's vibrate through
 *       bp_toy_scalar, one command in flight, the latest queued;
 *   (d) pause disarms both: the toy gets its safe value once, the machine
 *       field gets nothing; resume re-arms;
 *   (e) hub edges: declined in words with no store; against a fixture store
 *       the save rides the writer and is confirmed only by the store read
 *       back, a NACK is a fault in words, and a loop is refused.
 * The Rust half (bp_toy_*, bp://output) is `cargo test` in src-tauri.
 *
 * Run: node test/graph-runtime.test.mjs
 */

import { createPluginHost } from '../src/plugins/host.js';
import { manifest, graphRuntime, HERO } from '../src/plugins/graph.js';
import { MAP, readStoreItem } from '../src/model/graph.js';
import { CBOR_FIELD } from '../../Valence/clients/js/frames.js';
import { CORE_CHANNEL, STORE_OP } from '../../Valence/clients/js/generated/registry_vocab.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a fixture model: telemetry position, the pattern speed setting, one accessory setting
const POS = { uid: '129:pos', channelId: 129, name: 'pos', label: 'Position', unit: 'mm', type: 2, min: 0, max: 100, readOnly: true, role: 'telemetry.position' };
const SPEED = { uid: '130:speed', channelId: 130, name: 'speed', label: 'Speed', unit: '%', type: 2, min: 0, max: 200, step: 1, readOnly: false, writeChannel: 131, settingKey: 2, role: 'pattern.speed' };
const ACC = { uid: '32802:level', channelId: 0x8022, name: 'level', label: 'Level', unit: '', type: 0, min: 0, max: 255, step: 1, readOnly: false, writeChannel: 0x8023, settingKey: 1, role: '' };
const model = { fields: [POS, SPEED, ACC], byRole: new Map([['telemetry.position', [POS]], ['pattern.speed', [SPEED]]]), actions: [], categories: [] };
const samples = { 129: { pos: 75 }, 130: { speed: 0 }, 0x8022: { level: 0 } };
const writes = [];

const host = createPluginHost({
  model: () => model,
  sample: (ch) => samples[ch],
  sampleAge: () => 0,
  display: (f, s) => (s ? s[f.name] : undefined),
  status: () => 'confirmed',
  write: (f, v) => writes.push([f.uid, v]),
  submitMotion: () => ({ ok: true }),
  registerTheme: () => {},
  prefs: null,
  log: () => {},
});

// ---- a fake shell: the machine (with the vibrate feature it does not yet advertise) and one toy
const MACHINE = { index: 0, key: 'valence-phosphor-machine', name: 'Valence Machine', kind: 'machine', connected: true,
  controls: [{ feature: 0, kind: 'linear', type: 'HwPositionWithDuration', range: [0, 10000], ms: [0, 65535] },
    { feature: 1, kind: 'scalar', type: 'Vibrate', range: [0, 100] }] };
const TOY = { index: 1, key: 'lovense-aa-bb', name: 'Lush', kind: 'toy', connected: true,
  controls: [{ feature: 0, description: 'Motor', kind: 'scalar', type: 'Vibrate', range: [0, 20] }] };
const handlers = new Map();
const calls = [];
let hold = null;   // a pending bp_toy_scalar resolver, to prove one-in-flight
const shell = {
  listen: (ev, fn) => { handlers.set(ev, fn); return Promise.resolve(() => handlers.delete(ev)); },
  invoke: (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'bp_devices') return Promise.resolve([MACHINE, TOY]);
    if (cmd === 'bp_toy_scalar' && hold === 'arm') return new Promise((r) => { hold = r; });
    return Promise.resolve(null);
  },
};
const emit = (ev, payload) => handlers.get(ev)({ payload });

// ---- a fake hub: the relationships STORE as a slot map
let safety = { estopLatched: false, paused: false };
let entries = [];
const slots = new Map();
let nack = null;
const env = {
  live: () => true,
  safety: () => safety,
  storage: { getItem: () => null, setItem() {} },
  entries: () => entries,
  sample: (ch) => samples[ch],
  fetchBlob: async ({ slot }) => {
    if (!slots.has(slot)) { const e = new Error('empty'); e.code = 'UNAVAILABLE'; throw e; }
    return { bytes: slots.get(slot) };
  },
  runAction: async (act, op, extra) => {
    if (nack) return { ok: false, error: nack };
    if (op === STORE_OP.save) slots.set(extra[2], extra[4]);
    if (op === STORE_OP.delete_item) slots.delete(extra[2]);
    return { ok: true };
  },
};

let rt = null;
host.add(manifest, {
  activate(api) {
    rt = graphRuntime(api, shell, env);
    api.registerHero({ ...HERO, spec: {}, absorb: false, mount: () => ({}) });
    return rt.dispose;
  },
}, { source: 'built-in' });
await delay(10);

console.log('(a) the editor is a placeable module');
{
  const h = host.heroes().find((x) => x.id === 'plugin:graph:editor' || (x.def && x.def.id === 'editor') || x.id === 'editor');
  ok('the graph registers one hero with its cells', !!h && JSON.stringify((h.def || h).cells || h.cells) === JSON.stringify(HERO.cells), h && JSON.stringify(Object.keys(h)));
  ok('the manifest asks for intent only', JSON.stringify(manifest.permissions) === '["intent"]');
}

const src = (pred) => rt.sources().find((s) => pred(s.ref));
const dst = (pred) => rt.targets().find((s) => pred(s.ref));

console.log('(b) an app\'s vibrate drives stroke speed');
{
  const vib = src((r) => r.kind === 'bp' && r.device === MACHINE.key && r.type === 'Vibrate');
  const speed = dst((r) => r.kind === 'field' && r.key === 'role:pattern.speed');
  ok('the machine vibrate is offered as a source, pattern speed as a target', !!vib && !!speed);
  ok('the machine is never offered as a toy target', !rt.targets().some((t) => t.ref.device === MACHINE.key));
  ok('the edge would run in Phosphor, and says why', /Phosphor/.test(rt.home(vib.ref, speed.ref).why));
  const why = rt.add(vib.ref, speed.ref, MAP.linear_clamp, { in_min: 0, in_max: 100, out_min: 0, out_max: 200 });
  ok('added', why === '', why);
  emit('bp://output', { index: MACHINE.index, feature: 1, type: 'Vibrate', value: 50 });
  rt.tick();
  ok('vibrate 50 of 100 writes speed 100 of 200 through api.write', JSON.stringify(writes.at(-1)) === JSON.stringify(['130:speed', 100]), JSON.stringify(writes));
  const n = writes.length;
  rt.tick();
  ok('an unchanged output writes nothing', writes.length === n);
  emit('bp://output', { index: MACHINE.index, feature: 1, type: 'Vibrate', value: 80 });
  rt.tick();
  ok('a new intensity follows', JSON.stringify(writes.at(-1)) === JSON.stringify(['130:speed', 160]));
}

console.log('(c) machine position drives a toy\'s vibrate');
{
  const pos = src((r) => r.kind === 'field' && r.key === 'role:telemetry.position');
  const vib = dst((r) => r.kind === 'bp' && r.device === TOY.key);
  const why = rt.add(pos.ref, vib.ref, MAP.linear_clamp, { in_min: 0, in_max: 100, out_min: 0, out_max: 20 });
  ok('added', why === '', why);
  calls.length = 0;
  rt.tick();
  await delay(0);
  ok('position 75 of 100 sends bp_toy_scalar 15 of 20 to the toy\'s index and feature',
    JSON.stringify(calls.at(-1)) === JSON.stringify(['bp_toy_scalar', { index: 1, feature: 0, value: 15 }]), JSON.stringify(calls));
  hold = 'arm';
  samples[129].pos = 50;
  rt.tick();
  samples[129].pos = 40;
  rt.tick();
  samples[129].pos = 30;
  rt.tick();
  const sent = calls.filter((c) => c[0] === 'bp_toy_scalar').map((c) => c[1].value);
  ok('one command in flight, later values queued, not sent', JSON.stringify(sent) === JSON.stringify([15, 10]), JSON.stringify(sent));
  const r = hold;
  hold = null;
  r(null);
  await delay(0);
  await delay(0);
  const after = calls.filter((c) => c[0] === 'bp_toy_scalar').map((c) => c[1].value);
  ok('the latest queued value goes next; the stale one is dropped', JSON.stringify(after) === JSON.stringify([15, 10, 6]), JSON.stringify(after));
}

console.log('(d) the interlock');
{
  calls.length = 0;
  const w = writes.length;
  safety = { estopLatched: false, paused: true };
  rt.tick();
  await delay(0);
  rt.tick();
  await delay(0);
  const toy = calls.filter((c) => c[0] === 'bp_toy_scalar').map((c) => c[1].value);
  ok('pause sends the toy its safe value once', JSON.stringify(toy) === '[0]', JSON.stringify(toy));
  ok('pause writes nothing to the machine field (the hub pauses it)', writes.length === w);
  ok('the runtime says why', /paused/.test(rt.armed.why));
  emit('bp://output', { index: MACHINE.index, feature: 1, type: 'Vibrate', value: 20 });
  rt.tick();
  ok('a disarmed edge ignores new input', writes.length === w);
  safety = { estopLatched: false, paused: false };
  rt.tick();
  await delay(0);
  ok('resume re-arms both', JSON.stringify(writes.at(-1)) === JSON.stringify(['130:speed', 40])
    && calls.some((c) => c[0] === 'bp_toy_scalar' && c[1].value === 6));
  safety = { estopLatched: true, paused: true };
  rt.tick();
  ok('e-stop disarms', /e-stop/.test(rt.armed.why));
  safety = { estopLatched: false, paused: false };
}

console.log('(e) hub edges through the relationships store');
{
  const pos = src((r) => r.kind === 'field' && r.key === 'role:telemetry.position');
  const acc = dst((r) => r.kind === 'field' && r.key === 'uid:' + ACC.uid);
  const speed = dst((r) => r.kind === 'field' && r.key === 'role:pattern.speed');
  ok('field to accessory field would run on the hub', rt.home(pos.ref, acc.ref).home === 'hub');
  ok('field to machine field is refused with the reason', /accessory fields/.test(rt.add(pos.ref, speed.ref, MAP.linear_clamp, { in_min: 0, in_max: 1, out_min: 0, out_max: 1 })));
  ok('no store: declined in words', /no relationships store/.test(rt.add(pos.ref, acc.ref, MAP.gate, { in_min: 0, in_max: 100, out_min: 0, out_max: 255 })));

  const SID = 4;
  entries = [
    { id: 129, layout: [{ name: 'pos' }] },
    { id: 0x8022, layout: [{ name: 'level' }] },
    { id: CORE_CHANNEL.relationships, store: { storeId: SID, kind: 'relationship.map', capacity: 16 } },
    { id: CORE_CHANNEL.relationships_write, storeId: SID, schema: [
      { key: 1, role: 'action.store', type: CBOR_FIELD.uint_t }, { key: 2, type: CBOR_FIELD.uint_t },
      { key: 3, type: CBOR_FIELD.tstr_t }, { key: 4, type: CBOR_FIELD.bstr_t }] },
  ];
  await rt.refreshHub();
  const why = rt.add(pos.ref, acc.ref, MAP.gate, { in_min: 10, in_max: 90, out_min: 0, out_max: 255 });
  ok('added', why === '', why);
  const r = rt.graph.rels.find((x) => x.home === 'hub');
  ok('pending until the store answers', rt.hubState(r).phase === 'pending', rt.hubState(r).reason);
  await delay(10);
  const back = rt.graph.rels.find((x) => x.home === 'hub');
  ok('confirmed by the store read back, at slot 0', slots.has(0) && back && back.rel_id === 0 && rt.hubState(back).phase === 'confirmed',
    back && rt.hubState(back).reason);
  ok('the read-back edge has the saved map and bounds', back && back.map === MAP.gate && back.in_min === 10 && back.out_max === 255);
  ok('the hub edge is never evaluated here', !writes.some((x) => x[0] === ACC.uid));
  ok('armed state is the roster\'s, unknown without one', /unknown/.test(rt.hubArmed(back).why));

  nack = 'INVALID_VALUE';
  rt.edit(back.id, { out_max: 128 });
  await delay(10);
  const f = rt.graph.rels.find((x) => x.home === 'hub');
  ok('a NACK is a fault, in words', rt.hubState(f).phase === 'fault' && /INVALID_VALUE/.test(rt.hubState(f).reason), rt.hubState(f).reason);
  ok('after the NACK the edge shows what the hub holds, not the draft', f.out_max === 255, String(f.out_max));
  nack = null;

  const accSrc = src((x) => x.kind === 'field' && x.key === 'uid:' + ACC.uid);
  const posAsTarget = { kind: 'field', key: 'role:telemetry.position' };
  ok('a read-only field is never offered as a target', !dst((x) => x.key === posAsTarget.key));
  ok('an accessory field driving itself is refused as a loop', /feedback loop/.test(rt.add(accSrc.ref, acc.ref, MAP.linear_clamp, { in_min: 0, in_max: 1, out_min: 0, out_max: 1 })));

  rt.remove(back.id);
  await delay(10);
  ok('delete removes the item from the store and the graph', !slots.has(0) && !rt.graph.rels.some((x) => x.home === 'hub'));

  // ph-2tjo: the roster's count bounds the read, as for every store; an empty slot asked costs a NACK.
  const RID = CORE_CHANNEL.relationships_roster;
  const asked = [];
  const fb = env.fetchBlob;
  env.fetchBlob = (o) => { asked.push(o.slot); return fb(o); };
  entries.push({ id: RID, storeId: SID, layout: ['generation', 'count', 'capacity', 'a0', 'a1', 'f0', 'f1'].map((name) => ({ name })) });
  samples[RID] = { generation: 3, count: 0, capacity: 16, a0: 0, a1: 0, f0: 0, f1: 0 };
  await rt.refreshHub();
  ok('an empty relationships roster: the store read asks no slot', asked.length === 0, JSON.stringify(asked));
  entries.pop();
  delete samples[RID];
  env.fetchBlob = fb;
}

console.log('(f) the canvas: place, wire through drafts, refuse, undo and redo');
{
  const pos = src((r) => r.kind === 'field' && r.key === 'role:telemetry.position').ref;
  const acc = dst((r) => r.kind === 'field' && r.key === 'uid:' + ACC.uid).ref;
  const toy = dst((r) => r.kind === 'bp' && r.device === TOY.key).ref;
  const P = rt.place(pos, 0, 0);
  ok('placing a ref already on the canvas returns its node, not a second one', P.already
    && rt.graph.nodes.filter((n) => n.ref.key === pos.key).length === 1);
  const A = rt.place(acc, 613, 207);
  ok('a placed node snaps to the grid and is pinned', !A.already && (() => {
    const n = rt.graph.nodes.find((x) => x.id === A.id);
    return n.x === 620 && n.y === 200 && n.pinned;
  })());
  ok('an accessory field offers an input and an output socket', JSON.stringify(rt.ports(acc)) === '{"out":"field","in":"field","vt":"int"}');
  ok('a toy control is an app command out and a toy control in', JSON.stringify(rt.ports(toy)) === '{"out":"app","in":"toy","vt":"float"}');

  const d = rt.placeMap(MAP.invert, 300, 200);
  ok('a placed map is a draft until both ends are wired', rt.graph.drafts.some((x) => x.id === d));
  ok('source to draft wires one end', rt.wire(P.id, d) === '' && rt.graph.drafts.find((x) => x.id === d).from === P.id);
  const nRels = rt.graph.rels.length;
  ok('draft to accessory target makes a hub edge, no refusal', rt.wire(d, A.id) === '', rt.hubState({ rel_id: 0 }).reason);
  const hubRel = rt.graph.rels.find((x) => x.home === 'hub');
  ok('the draft became the edge, at the draft\'s place, id h<slot>', rt.graph.rels.length === nRels + 1 && !rt.graph.drafts.some((x) => x.id === d)
    && hubRel && hubRel.id === 'h' + hubRel.rel_id && hubRel.x === 300 && hubRel.map === MAP.invert);
  await delay(10);
  ok('the hub edge is confirmed by the store, still where the draft was', slots.has(hubRel.rel_id) && rt.hubState(hubRel).phase === 'confirmed'
    && rt.graph.rels.find((x) => x.id === hubRel.id).x === 300);

  ok('undo is offered', rt.canUndo);
  rt.undo();
  ok('undo puts the draft back, wired at its source', rt.graph.drafts.some((x) => x.id === d && x.from === P.id && x.to === null));
  await delay(10);
  ok('undo of a hub edge deletes it from the store (the ladder, never local only)', !slots.has(hubRel.rel_id) && !rt.graph.rels.some((x) => x.home === 'hub'));
  rt.redo();
  await delay(10);
  ok('redo saves it again and the store confirms', slots.has(hubRel.rel_id) && rt.graph.rels.some((x) => x.id === hubRel.id) && rt.hubState(hubRel).phase === 'confirmed');

  const T = rt.place(toy, 0, 400);
  const d2 = rt.placeMap(MAP.linear_clamp, 200, 400);
  rt.wire(T.id, d2);
  ok('a toy driving itself through a map is refused as a loop, before the drop', /feedback loop/.test(rt.why(d2, T.id)));
  ok('...and on the drop, with no step left behind', /feedback loop/.test(rt.wire(d2, T.id)) && rt.graph.drafts.find((x) => x.id === d2).to === null);
  ok('a map cannot feed a map', /do not chain/.test(rt.why(d2, rt.placeMap(MAP.gate, 400, 400))));
  const speedRel = rt.graph.rels.find((x) => rt.graph.nodes.find((n) => n.id === x.to)?.ref.key === 'role:pattern.speed');
  const S = rt.graph.nodes.find((n) => n.id === speedRel.to);
  ok('a second driver for a driven target is refused at the socket', /already driven/.test(rt.why(P.id, S.id)));
  rt.edit(speedRel.id, { enabled: false });
  ok('field to machine field is a home mismatch, in words', /accessory fields/.test(rt.why(P.id, S.id)));
  rt.undo();
  ok('undo of an edit restores it', rt.graph.rels.find((x) => x.id === speedRel.id).enabled === true);

  const beforeX = rt.graph.nodes.find((n) => n.id === A.id).x;
  rt.moveMany([{ id: A.id, x: 800, y: 0 }, { id: hubRel.id, x: 500, y: 0 }]);
  ok('a multi-move is one step', rt.graph.nodes.find((n) => n.id === A.id).x === 800 && rt.graph.rels.find((x) => x.id === hubRel.id).x === 500);
  const saves = [...slots.keys()].length;
  rt.undo();
  ok('undo of a move restores every position and writes nothing to the hub',
    rt.graph.nodes.find((n) => n.id === A.id).x === beforeX && rt.graph.rels.find((x) => x.id === hubRel.id).x === 300 && slots.size === saves,
    JSON.stringify([rt.graph.nodes.find((n) => n.id === A.id).x, beforeX, rt.graph.rels.find((x) => x.id === hubRel.id).x, slots.size, saves]));
  rt.redo();
  rt.undo();

  const clientRel = rt.graph.rels.find((x) => x.home === 'client' && x.enabled);
  const dup = rt.duplicate([clientRel.id, A.id]);
  ok('duplicate copies maps only, unwired, with their numbers', dup.length === 1 && (() => {
    const x = rt.graph.drafts.find((q) => q.id === dup[0]);
    return x.from === null && x.to === null && x.map === clientRel.map && x.cfg.out_max === clientRel.out_max;
  })());
  rt.undo();
  ok('undo of a duplicate removes the copy', !rt.graph.drafts.some((q) => q.id === dup[0]));

  rt.unwire(clientRel.id, 'out');
  const loose = rt.graph.drafts.find((x) => x.from === clientRel.from && x.to === null);
  ok('cutting a client edge\'s output leaves its map as a draft wired at the source', !rt.graph.rels.some((x) => x.id === clientRel.id) && !!loose);
  rt.undo();
  ok('undo rewires it as it was', rt.graph.rels.some((x) => x.id === clientRel.id) && !rt.graph.drafts.includes(loose));

  rt.removeMany([A.id]);
  await delay(10);
  ok('deleting a target node unwires its maps: the hub edge leaves the store, its map stays as a draft',
    !rt.graph.nodes.some((n) => n.id === A.id) && !slots.has(hubRel.rel_id)
    && rt.graph.drafts.some((x) => x.from === hubRel.from && x.to === null && x.map === MAP.invert));
  rt.undo();
  await delay(10);
  ok('undo brings the node and the hub edge back through the store', rt.graph.nodes.some((n) => n.id === A.id) && slots.has(hubRel.rel_id));

  const e = rt.echo(acc);
  ok('a target node reads its write status and value from the host', typeof e.status === 'string' && 'value' in e);
  ok('a source shows its live value and unit', rt.value(pos) === samples[129].pos && rt.unit(pos) === 'mm');

  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const fakeApi = { catalog: () => model, value: () => undefined, status: () => 'confirmed', stale: () => '', write() {}, log() {} };
  const r1 = graphRuntime(fakeApi, null, { ...env, storage });
  r1.setView({ x: 12, y: -8, k: 0.75 });
  r1.placeMap(MAP.lowpass, 0, 0);
  r1.dispose();
  const r2 = graphRuntime(fakeApi, null, { ...env, storage });
  ok('the view and the drafts persist in the local graph store', JSON.stringify(r2.view) === '{"x":12,"y":-8,"k":0.75}' && r2.graph.drafts.length === 1);
  r2.dispose();
}

console.log('(g) typed node chains: place, wire by port, evaluate, undo; the hub lowering stays');
{
  const pos = src((r) => r.kind === 'field' && r.key === 'role:telemetry.position').ref;
  const acc = dst((r) => r.kind === 'field' && r.key === 'uid:' + ACC.uid).ref;
  const toy = dst((r) => r.kind === 'bp' && r.device === TOY.key).ref;
  const P = rt.place(pos, 0, 0);
  const T = rt.place(toy, 0, 400);
  // The toy's existing driver (section c) goes, so the chain can drive it.
  rt.unwire(T.id, 'in');
  ok('field sockets are typed from the field: an integer setting is int, a toy float',
    rt.ports(acc).vt === 'int' && rt.ports(toy).vt === 'float' && rt.ports(pos).vt === 'int');
  const m = rt.placeOp('math', 200, 600);
  const th = rt.placeOp('threshold', 400, 600);
  const sw = rt.placeOp('switch', 600, 600);
  ok('op nodes are placed, snapped, one undo step each', rt.graph.ops.length === 3 && rt.graph.ops[0].x === 200 && rt.canUndo);
  ok('a field output wires to an op input by port', rt.wire(P.id, m, 'a') === '' && rt.graph.links.some((l) => l.from === P.id && l.to === m && l.port === 'a'));
  rt.editOp(m, { fn: 'multiply', vals: { b: 0.01 } });
  ok('the op\'s operation and values edit', rt.graph.ops.find((o) => o.id === m).fn === 'multiply');
  rt.wire(m, th, 'v');
  rt.editOp(th, { vals: { on: 0.5, off: 0.3 } });
  rt.wire(th, sw, 's');
  rt.editOp(sw, { vals: { f: 2, t: 18 } });
  ok('an op output wires to a toy target', rt.wire(sw, T.id) === '');
  ok('the target says its chain runs in Phosphor, in one word', rt.runs(T.id).home === 'client' && /Phosphor/.test(rt.runs(T.id).why));
  ok('a link closing a loop is refused in words', /would loop/.test(rt.why(sw, m, 'b')));
  ok('a map cannot join a chain', /maps join two fields/.test(rt.why(m, rt.placeMap(MAP.gate, 0, 800))));
  calls.length = 0;
  samples[129].pos = 60;   // 60 * 0.01 = 0.6, above 0.5: the switch picks True
  rt.tick();
  await delay(0);
  const sent = () => calls.filter((c) => c[0] === 'bp_toy_scalar').map((c) => c[1].value);
  ok('the chain evaluates per tick and drives the toy through bp_toy_scalar', JSON.stringify(sent()) === '[18]', JSON.stringify(sent()));
  ok('each op\'s value is readable for the canvas', rt.val(m) === 0.6 && rt.val(th) === 1 && rt.val(sw) === 18);
  samples[129].pos = 40;   // 0.4: held on (hysteresis)
  rt.tick();
  samples[129].pos = 20;   // 0.2: off, the switch picks False
  rt.tick();
  await delay(0);
  ok('threshold holds between its edges, then drops', JSON.stringify(sent()) === '[18,2]', JSON.stringify(sent()));

  rt.editOp(m, { fn: 'sine' });
  ok('an operation with fewer inputs cuts the links into the ones it lost', !rt.graph.links.some((l) => l.to === m && l.port === 'b')
    && rt.graph.links.some((l) => l.to === m && l.port === 'a'));
  rt.undo();
  ok('undo restores the operation', rt.graph.ops.find((o) => o.id === m).fn === 'multiply');
  rt.unwire(th, 'in', 'v');
  ok('cutting one op input leaves its other links', !rt.graph.links.some((l) => l.to === th) && rt.graph.links.some((l) => l.to === sw));
  rt.undo();
  ok('undo rewires it', rt.graph.links.some((l) => l.to === th && l.port === 'v'));
  const dup = rt.duplicate([sw]);
  ok('duplicate copies an op with its values, unwired', dup.length === 1 && rt.graph.ops.find((o) => o.id === dup[0]).vals.t === 18
    && !rt.graph.links.some((l) => l.from === dup[0] || l.to === dup[0]));
  rt.undo();
  rt.removeMany([th]);
  ok('deleting an op takes its links', !rt.graph.ops.some((o) => o.id === th) && !rt.graph.links.some((l) => l.from === th || l.to === th));
  rt.undo();
  ok('undo brings the op and its links back', rt.graph.ops.some((o) => o.id === th) && rt.graph.links.filter((l) => l.from === th || l.to === th).length === 2);

  const n0 = rt.graph.ops.length;
  let wired = '';
  rt.batch(() => { const id = rt.placeOp('clamp', 0, 1000); wired = rt.wire(P.id, id, 'v'); });
  ok('a place and its wire can be one step (link-drag-search)', wired === '' && rt.graph.ops.length === n0 + 1);
  rt.undo();
  ok('...which one undo takes back whole', rt.graph.ops.length === n0 && !rt.graph.links.some((l) => l.port === 'v' && l.from === P.id && !rt.graph.ops.some((o) => o.id === l.to)));

  // With chains on the canvas, a plain source-map-target to an accessory field still goes to the hub's STORE.
  const A = rt.place(acc, 800, 0);
  rt.unwire(A.id, 'in');
  await delay(10);
  const before = slots.size;
  const d = rt.placeMap(MAP.linear_clamp, 400, 0);
  rt.wire(P.id, d);
  ok('field, one map, accessory field: still a hub edge', rt.wire(d, A.id) === '' && rt.graph.rels.some((r) => r.home === 'hub' && r.to === A.id));
  await delay(10);
  ok('...saved through the relationships STORE and confirmed', slots.size === before + 1);
  ok('...and that target says hub', rt.runs(A.id).home === 'hub');
  ok('a chain cannot drive a hub-driven target', /already driven/.test(rt.why(sw, A.id)));
  ok('no chain value ever rides to the hub: the store holds only relationship items', [...slots.values()].every((b) => readStoreItem(b)));
}

console.log('(h) where a node comes from: the add menu as the pages group it (ph-5wo6)');
{
  // Session (tier 2) comes first in the catalog; the pages put it after Motion (tier 1).
  model.categories = [
    { id: 12, known: true, label: 'Session', groups: [{ section: '', title: 'Clients', fields: [ACC] }] },
    { id: 2, known: true, label: 'Motion', groups: [{ section: '', title: 'Live', fields: [POS] }, { section: 'Tuning', title: 'Planner', fields: [SPEED] }] },
  ];
  env.hubName = () => 'Bench';
  env.modules = () => [{ title: 'Stroker', spec: { require: { speed: 'pattern.speed' } } }];
  const items = rt.palette();
  const paths = items.map((it) => (it.ref.kind === 'bp' ? it.ref.device + ':' + it.label : it.ref.key) + ' @ ' + it.path.join(' › '));
  const want = ['role:telemetry.position @ Bench › Motion › Live', 'role:pattern.speed @ Bench › Motion › Tuning › Planner',
    'role:pattern.speed @ Plugin modules › Stroker'];
  ok('fields in page order: tiers, then catalog order; card, then section and card', paths[0] === want[0] && paths[1] === want[1], JSON.stringify(paths.slice(0, 4)));
  ok('...a tier-2 category after the tier-1 ones', paths.findIndex((p) => p.endsWith('Bench › Session › Clients')) > paths.indexOf(want[1]), JSON.stringify(paths));
  ok('...a plugin module lists the fields it claims', paths.includes(want[2]));
  ok('...a toy control under ButtplugIO and its device', paths.includes(TOY.key + ':Motor @ ButtplugIO › Lush'));
  const sp = items.find((it) => it.ref.key === 'role:pattern.speed');
  const pos = items.find((it) => it.ref.key === 'role:telemetry.position');
  ok('...each says which sockets it has', sp.src && sp.dst && pos.src && !pos.dst);
  const a = rt.about(pos.ref);
  ok('about(): path from the device, unit and range', a.path.join(' › ') === 'Bench › Motion › Live' && a.unit === 'mm' && a.lo === 0 && a.hi === 100, JSON.stringify(a));
  ok('a toy names itself with its device', rt.label(dst((r) => r.kind === 'bp' && r.device === TOY.key).ref) === 'Lush: Motor');
  const st = rt.state(sp.ref);
  ok('state(): stale and gate reasons, empty when the host has none', st.stale === '' && st.gate === '', JSON.stringify(st));
  model.categories = [];
}

host.setEnabled('graph', false);
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
