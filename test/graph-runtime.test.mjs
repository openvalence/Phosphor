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
import { MAP } from '../src/model/graph.js';
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
}

host.setEnabled('graph', false);
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
