/**
 * graph.js -- the node graph as a built-in plugin: its editor is a placeable
 * module (hero:plugin:graph:editor) and its client edges run here, through the
 * plugin API's write door and the embedded buttplug server's commands.
 *
 * Constraints:
 * - Plain JS with injected shell and env: test/graph-runtime.test.mjs drives
 *   it with a fake invoke/listen, a fake hub and the real plugin host. The
 *   Svelte half (src/ui/graph/GraphEditor.svelte) only renders this.
 * - Field targets are written through api.write (the `intent` permission), so
 *   every client-edge write gets the shadow ladder and the refusal banner.
 * - Toy outputs ride bp_toy_* (docs/BUTTPLUG.md). One command per target in
 *   flight, the latest queued, so a 20 Hz evaluator never floods the server.
 * - Hub edges are written through the relationships writer and confirmed
 *   only by reading the store back (law 4); this module never claims a hub
 *   edge is saved because the write was acked.
 * See: src/model/graph.js, docs/DESIGN.md 10.8
 */
import {
  MAP, MAPS, TICK_MS, refKey, homeOf, interlock, isUserSpace, addNode, connect, removeRel,
  refuseConnect, checkRel, freeRelId, loadLocal, saveLocal, createRunner, findHub, storeVerb,
  storeItem, readStoreItem, rosterBits,
} from '../model/graph.js';
import { controlKey, WIDGET } from '../model/settings.js';
import { PACKED, CORE_CHANNEL, STORE_OP } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { CBOR_FIELD } from '../../../Valence/clients/js/frames.js';

export const manifest = {
  name: 'graph',
  version: '0.1.0',
  api: 1,
  kind: 'adapter',
  description: 'Node graph: hub relationships and client-side mappings, one map vocabulary',
  roles: [],
  channels: [],
  permissions: ['intent'],
};

export const HERO = { id: 'editor', title: 'Node graph', cells: { h: [16, 10], v: [10, 16] } };
export const SENSOR_MS = 1000;
const CMD = { scalar: 'bp_toy_scalar', rotate: 'bp_toy_rotate', linear: 'bp_toy_linear' };
const msg = (e) => String(e?.message ?? e);

const numeric = (f) => (f.isIntentField
  ? typeof f.min === 'number' && typeof f.max === 'number'
  : f.type <= PACKED.f32 && !f.options);

/**
 * @param {Object} api the plugin API
 * @param {{invoke: Function, listen: Function}|null} shell the Tauri bridge; null leaves buttplug refs absent
 * @param {Object} env {live(), safety(), storage, entries(), sample(ch), fetchBlob(o)?, runAction(act, op, extra)?}
 */
export function graphRuntime(api, shell, env) {
  const local = loadLocal(env.storage);
  const hubPos = local.hubPos;
  let g = { v: 1, nodes: local.nodes, rels: local.rels };
  const devices = new Map();          // device key -> bp_devices record
  const outputs = new Map();          // refKey -> last applied output or reading
  const inflight = new Map();         // refKey -> queued value or null
  const hubState = new Map();         // rel_id -> {phase, reason}
  const listeners = new Set();
  const offs = [];
  let hub = { reason: 'not read yet', rels: [] };
  let armedNow = { ok: false, why: '' };
  let closed = false;

  const changed = () => { for (const fn of listeners) fn(); };
  const persist = () => saveLocal(env.storage, g);

  // ---- fields --------------------------------------------------------------
  function allFields() {
    const m = api.catalog();
    if (!m) return [];
    const seen = new Set();
    const out = [];
    for (const f of [...m.fields, ...[...m.byRole.values()].flat()]) {
      if (seen.has(f.uid) || f.widget === WIDGET.action || !numeric(f)) continue;
      seen.add(f.uid);
      out.push({ f, key: controlKey(f, m.byRole) });
    }
    return out;
  }
  const fieldFor = (key) => (allFields().find((x) => x.key === key) || {}).f || null;
  const writable = (f) => f.isIntentField || !f.readOnly;
  const toAccessory = (f) => !!f && isUserSpace(f.isIntentField ? f.channelId : f.writeChannel);

  // ---- buttplug ------------------------------------------------------------
  const ctlOf = (ref) => {
    const d = devices.get(ref.device);
    return d && d.controls.find((c) => c.feature === ref.feature && c.type === ref.type);
  };
  const bpRef = (d, c) => ({ kind: 'bp', device: d.key, feature: c.feature, type: c.type, ctl: c.kind, range: c.range || null });

  function setDevices(list) {
    devices.clear();
    for (const d of list || []) if (d.key && d.connected !== false) devices.set(d.key, d);
    changed();
  }

  function onOutput(p) {
    if (!p) return;
    for (const d of devices.values()) {
      if (d.index === p.index) outputs.set(refKey({ kind: 'bp', device: d.key, feature: p.feature, type: p.type }), p.value);
    }
  }

  // The machine's own linear axis is never on bp://output: an app's LinearCmd
  // arrives as bp://motion, a fraction of the stroke (docs/BUTTPLUG.md).
  function onMotion(p) {
    if (!p || p.stop) return;
    for (const d of devices.values()) {
      if (d.kind !== 'machine') continue;
      for (const c of d.controls) {
        if (c.kind === 'linear') outputs.set(refKey(bpRef(d, c)), c.range[0] + p.position * (c.range[1] - c.range[0]));
      }
    }
  }

  function bpWrite(ref, value) {
    const d = devices.get(ref.device);
    const c = ctlOf(ref);
    if (!d || !c || !CMD[c.kind] || !shell) return;
    const k = refKey(ref);
    if (inflight.has(k)) { inflight.set(k, value); return; }
    inflight.set(k, null);
    const a = { index: d.index, feature: c.feature };
    if (c.kind === 'rotate') a.speed = value;
    else if (c.kind === 'linear') Object.assign(a, { position: value, ms: 2 * TICK_MS });
    else a.value = value;
    shell.invoke(CMD[c.kind], a)
      .catch((e) => api.log(d.name + ': ' + msg(e), 'warn'))
      .finally(() => {
        const next = inflight.get(k);
        inflight.delete(k);
        if (next != null && !closed) bpWrite(ref, next);
      });
  }

  function readSensors() {
    if (!shell) return;
    for (const r of g.rels) {
      const n = g.nodes.find((m) => m.id === r.from);
      if (!n || n.ref.kind !== 'bp' || n.ref.ctl !== 'sensor') continue;
      const d = devices.get(n.ref.device);
      if (!d) continue;
      shell.invoke('bp_toy_read', { index: d.index, feature: n.ref.feature, input: n.ref.type })
        .then((v) => outputs.set(refKey(n.ref), v), () => outputs.delete(refKey(n.ref)));
    }
  }

  // ---- the evaluator's io --------------------------------------------------
  const io = {
    read(ref) {
      if (ref.kind === 'bp') return outputs.get(refKey(ref));
      const f = fieldFor(ref.key);
      return f ? api.value(f) : undefined;
    },
    target(ref) {
      if (ref.kind === 'bp') {
        const c = ctlOf(ref);
        if (!c || !CMD[c.kind] || devices.get(ref.device).kind !== 'toy') return null;
        return { min: c.range[0], max: c.range[1], step: 1, integer: true, safe: c.kind === 'linear' ? undefined : 0 };
      }
      const f = fieldFor(ref.key);
      return f && writable(f) ? { min: f.min, max: f.max, step: f.step } : null;
    },
    write(ref, v) {
      if (ref.kind === 'bp') return bpWrite(ref, v);
      const f = fieldFor(ref.key);
      if (f) api.write(f, v);
    },
    armed: () => interlock(env.live(), env.safety()),
  };
  const runner = createRunner(io);

  function tick() {
    const was = armedNow;
    armedNow = runner.step(g, Date.now());
    if (was.why !== armedNow.why) changed();
  }

  // ---- what the editor offers ----------------------------------------------
  function sources() {
    const out = allFields().filter(({ f }) => !f.isIntentField).map(({ f, key }) => ({ ref: { kind: 'field', key }, label: f.label + (f.unit ? ' (' + f.unit + ')' : ''), lo: f.min, hi: f.max }));
    for (const d of devices.values()) {
      for (const c of d.controls) {
        out.push({ ref: bpRef(d, c), label: d.name + ': ' + (c.description || c.type) + (c.kind === 'sensor' ? ' reading' : ', as an app sets it'), lo: c.range?.[0], hi: c.range?.[1] });
      }
    }
    return out;
  }
  function targets() {
    const out = allFields().filter(({ f }) => writable(f))
      .map(({ f, key }) => ({ ref: { kind: 'field', key }, label: f.label + (toAccessory(f) ? ' (accessory)' : ''), lo: f.min, hi: f.max }));
    for (const d of devices.values()) {
      if (d.kind !== 'toy') continue;
      for (const c of d.controls) if (CMD[c.kind]) out.push({ ref: bpRef(d, c), label: d.name + ': ' + (c.description || c.type), lo: c.range[0], hi: c.range[1] });
    }
    return out;
  }

  /** Where an edge from a to b would run, and why. */
  function home(a, b) {
    return homeOf(a, b, b.kind === 'field' && toAccessory(fieldFor(b.key)));
  }

  // ---- the hub half ----------------------------------------------------------
  function hubLoc(ref, asTarget) {
    const f = ref.kind === 'field' && fieldFor(ref.key);
    if (!f) return null;
    if (asTarget) return f.isIntentField ? { channel: f.channelId, field: f.key } : { channel: f.writeChannel, field: f.settingKey };
    const e = env.entries().find((x) => x.id === f.channelId);
    const i = e && e.layout ? e.layout.findIndex((l) => l.name === f.name) : -1;
    return i < 0 ? null : { channel: f.channelId, field: i };
  }

  function refAt(loc, asTarget) {
    if (asTarget) {
      const hit = allFields().find(({ f }) => (f.isIntentField
        ? f.channelId === loc.channel && f.key === loc.field
        : f.writeChannel === loc.channel && f.settingKey === loc.field));
      return hit ? { kind: 'field', key: hit.key } : null;
    }
    const e = env.entries().find((x) => x.id === loc.channel);
    const l = e && e.layout && e.layout[loc.field];
    const hit = l && allFields().find(({ f }) => f.channelId === loc.channel && f.name === l.name);
    return hit ? { kind: 'field', key: hit.key } : null;
  }

  function surfaces() {
    const h = findHub(env.entries() || [], CORE_CHANNEL.relationships, CBOR_FIELD);
    if (!h.reason && !(env.fetchBlob && env.runAction)) return { reason: 'hub edges need a live session' };
    return h;
  }

  /** Re-read every slot of the relationships store; pending hub edges keep their draft. */
  async function refreshHub() {
    const h = surfaces();
    if (h.reason) { hub = { reason: h.reason, rels: [] }; mergeHub([]); return; }
    hub = { ...h, reason: '', rels: hub.rels };
    const found = [];
    for (let slot = 0; slot < (h.store.store.capacity | 0); slot++) {
      try {
        const res = await env.fetchBlob({ storeId: h.store.store.storeId, slot });
        const it = readStoreItem(res.bytes);
        if (it) found.push(it);
      } catch (e) {
        if (e && e.code !== 'UNAVAILABLE') { hub.reason = 'store read failed: ' + (e.code || msg(e)); break; }
      }
      if (closed) return;
    }
    hub.rels = found;
    mergeHub(found);
  }

  function mergeHub(items) {
    // A pending draft stays as sent; a refused new edge stays, faulted, until deleted.
    const held = new Set(items.map((it) => it.rel_id));
    const keep = g.rels.filter((r) => r.home === 'client' || hubState.get(r.rel_id)?.phase === 'pending'
      || (hubState.get(r.rel_id)?.phase === 'fault' && !held.has(r.rel_id)));
    const pend = new Set(keep.filter((r) => r.home === 'hub').map((r) => r.rel_id));
    g = { ...g, rels: keep };
    for (const it of items) {
      if (pend.has(it.rel_id)) continue;
      const a = refAt(it.src, false);
      const b = refAt(it.dst, true);
      if (!a || !b) continue;
      const [x, y] = hubPos[it.rel_id] || [0, 0];
      const from = addNode(g, a, x - 160, y).id;
      const to = addNode(g, b, x + 160, y).id;
      const { src, dst, ...rest } = it;
      g.rels.push({ ...rest, id: 'h' + it.rel_id, from, to, home: 'hub', x, y });
      if (!hubState.has(it.rel_id)) hubState.set(it.rel_id, { phase: 'confirmed', reason: 'stored on the hub' });
    }
    removeRel(g, null);
    changed();
  }

  async function saveHub(r, op = STORE_OP.save) {
    const h = surfaces();
    if (h.reason) { hubState.set(r.rel_id, { phase: 'fault', reason: h.reason }); changed(); return; }
    const nodes = new Map(g.nodes.map((n) => [n.id, n]));
    const src = hubLoc(nodes.get(r.from).ref, false);
    const dst = hubLoc(nodes.get(r.to).ref, true);
    if (op === STORE_OP.save && (!src || !dst)) { hubState.set(r.rel_id, { phase: 'fault', reason: 'an end is missing from this catalog' }); changed(); return; }
    hubState.set(r.rel_id, { phase: 'pending', reason: op === STORE_OP.save ? 'sent, waiting for the store to return it' : 'deleting' });
    changed();
    const bytes = op === STORE_OP.save ? storeItem(r, src, dst) : null;
    const act = { channelId: h.writer.id, key: h.op.key, label: 'relationships' };
    const extra = storeVerb(h, op, r, bytes);
    delete extra[h.op.key];
    const res = await env.runAction(act, op, extra);
    if (!res || !res.ok) {
      hubState.set(r.rel_id, { phase: 'fault', reason: 'refused: ' + ((res && res.error) || 'no answer') });
      await refreshHub();   // back to what the hub holds (law 4)
      return;
    }
    hubState.delete(r.rel_id);
    await refreshHub();
    const back = hub.rels.find((it) => it.rel_id === r.rel_id);
    if (op !== STORE_OP.save) {
      if (back) hubState.set(r.rel_id, { phase: 'fault', reason: 'the hub still holds it' });
    } else if (!back) {
      hubState.set(r.rel_id, { phase: 'fault', reason: 'acked, but the store does not hold it' });
    } else {
      hubState.set(r.rel_id, { phase: 'confirmed', reason: 'stored on the hub' });
    }
    changed();
  }

  /** Armed and faulted for a hub edge, from the hub's roster only (never local belief). */
  function hubArmed(r) {
    const bits = hub.roster && rosterBits(hub.roster, env.sample(hub.roster.id));
    if (!bits) return { known: false, why: 'armed state unknown: no roster from the hub' };
    const b = 1 << r.rel_id;
    if (bits.faulted & b) return { known: true, armed: false, why: 'faulted on the hub' };
    return bits.armed & b ? { known: true, armed: true, why: 'armed on the hub' } : { known: true, armed: false, why: 'disarmed on the hub; resume arms it' };
  }

  // ---- edits -----------------------------------------------------------------
  /** Add an edge from source ref a to target ref b. Returns '' or the refusal in words. */
  function add(a, b, map, bounds, at = { x: 0, y: 0 }) {
    const h = home(a, b);
    if (!h.home) return h.why;
    if (h.home === 'hub') {
      const s = surfaces();
      if (s.reason) return s.reason;
      if (!hubLoc(a, false)) return 'the hub maps from STATE or STREAM fields only';
    }
    const from = addNode(g, a, at.x - 160, at.y).id;
    const to = addNode(g, b, at.x + 160, at.y).id;
    const o = { map, ...bounds, home: h.home, x: at.x, y: at.y };
    if (h.home === 'hub') {
      o.rel_id = freeRelId(g, hub.store ? hub.store.store.capacity : undefined);
      if (o.rel_id < 0) return 'the hub stores no more relationships';
    }
    const res = connect(g, from, to, o);
    if (res.reason) { removeRel(g, null); return res.reason; }   // drops the nodes just added
    if (h.home === 'hub') saveHub(res.rel);
    persist();
    changed();
    return '';
  }

  /** Change a rel's numbers, name or enabled. Client: applied now. Hub: saved, pending until read back. */
  function edit(id, patch) {
    const r = g.rels.find((x) => x.id === id);
    if (!r) return '';
    const next = { ...r, ...patch };
    const bad = checkRel(next) || (patch.enabled && !r.enabled ? refuseConnect(g, r.from, r.to, r) : '');
    if (bad) return bad;
    Object.assign(r, patch);
    if (r.home === 'hub') saveHub(r);
    persist();
    changed();
    return '';
  }

  function remove(id) {
    const r = g.rels.find((x) => x.id === id);
    if (!r) return;
    if (r.home === 'hub' && hub.rels.some((it) => it.rel_id === r.rel_id)) { saveHub(r, STORE_OP.delete_item); return; }
    hubState.delete(r.rel_id);
    removeRel(g, id);
    persist();
    changed();
  }

  /** Move a node or a rel's map node; positions are local. */
  function move(id, x, y) {
    const n = g.nodes.find((m) => m.id === id) || g.rels.find((r) => r.id === id);
    if (!n) return;
    n.x = x;
    n.y = y;
    if (n.rel_id != null && n.home === 'hub') hubPos[n.rel_id] = [x, y];
    persist();
    changed();
  }

  // ---- lifecycle ---------------------------------------------------------------
  if (shell) {
    const on = (ev, fn) => shell.listen(ev, (e) => fn(e.payload))
      .then((off) => (closed ? off() : offs.push(off)))
      .catch((e) => api.log(ev + ': ' + msg(e), 'warn'));
    on('bp://devices', setDevices);
    on('bp://output', onOutput);
    on('bp://motion', onMotion);
    shell.invoke('bp_devices').then((d) => { if (!devices.size) setDevices(d); })
      .catch((e) => api.log('bp_devices: ' + msg(e), 'warn'));
  }
  const timers = [setInterval(tick, TICK_MS), setInterval(readSensors, SENSOR_MS)];

  return {
    get graph() { return g; },
    get hub() { return hub; },
    get armed() { return armedNow; },
    hubState: (r) => hubState.get(r.rel_id) || { phase: 'confirmed', reason: '' },
    hubArmed, home, sources, targets, add, edit, remove, move, refreshHub, tick,
    maps: MAPS, MAP,
    label(ref) {
      const s = [...sources(), ...targets()].find((x) => refKey(x.ref) === refKey(ref));
      return s ? s.label : (ref.kind === 'bp' ? ref.device + ' (absent)' : ref.key + ' (absent)');
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() {
      closed = true;
      timers.forEach(clearInterval);
      offs.splice(0).forEach((off) => off());
      runner.reset();
    },
  };
}

/** Add the graph to the app's plugin host. Its editor mounts GraphEditor.svelte. */
export async function loadGraph(host) {
  const [{ machine, getSession }, { runAction }, { mount, unmount }, { default: GraphEditor }] = await Promise.all([
    import('../model/machine.svelte.js'),
    import('../model/shadow.svelte.js'),
    import('svelte'),
    import('../ui/graph/GraphEditor.svelte'),
  ]);
  let shell = null;
  if (import.meta.env && import.meta.env.TAURI_ENV_PLATFORM) {
    const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
    shell = { invoke, listen };
  }
  const env = {
    live: () => machine.link.phase === 'live',
    safety: () => machine.safety,
    storage: typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem() {} },
    entries: () => machine.catalog.entries,
    sample: (ch) => machine.samples[ch],
    fetchBlob: (o) => { const s = getSession(); return s ? s.fetchBlob(o) : Promise.reject(new Error('no session')); },
    runAction,
  };
  host.add(manifest, {
    activate(api) {
      const rt = graphRuntime(api, shell, env);
      api.registerHero({
        id: HERO.id, title: HERO.title, spec: {}, absorb: false, cells: HERO.cells,
        mount(el) {
          const c = mount(GraphEditor, { target: el, props: { rt } });
          return { unmount: () => unmount(c) };
        },
      });
      return rt.dispose;
    },
  }, { source: 'built-in' });
}
