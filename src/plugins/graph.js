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
  storeItem, readStoreItem, rosterBits, removeNode, addDraft, planWire, createHistory, snap, endRange,
} from '../model/graph.js';
import { ROLE } from '../model/roles.js';
import { controlKey, WIDGET } from '../model/settings.js';
import { PACKED, CORE_CHANNEL, STORE_OP } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { CBOR_FIELD } from '../../../Valence/clients/js/frames.js';

export const manifest = {
  name: 'graph',
  version: '0.1.0',
  api: 1,
  kind: 'adapter',
  description: 'Hub relationships and client mappings as nodes',
  roles: [],
  channels: [],
  permissions: ['intent'],
};

export const HERO = { id: 'editor', title: 'Node graph', cells: { h: [16, 10], v: [10, 16] } };
export const SENSOR_MS = 1000;
const CMD = { scalar: 'bp_toy_scalar', rotate: 'bp_toy_rotate', linear: 'bp_toy_linear' };
const msg = (e) => String(e?.message ?? e);
/** Canvas units between a map node and the field nodes an edge places for it. */
const SPREAD = 260;

const numeric = (f) => (f.isIntentField
  ? typeof f.min === 'number' && typeof f.max === 'number'
  : f.type <= PACKED.f32 && !f.options);

/**
 * @param {Object} api the plugin API
 * @param {{invoke: Function, listen: Function}|null} shell the Tauri bridge; null leaves buttplug refs absent
 * @param {Object} env {live(), safety(), storage, entries(), sample(ch), fetchBlob(o)?, runAction(act, op, extra)?, shadow(f)?}
 */
export function graphRuntime(api, shell, env) {
  const local = loadLocal(env.storage);
  const hubPos = local.hubPos;
  let view = local.view;
  let g = { v: 1, nodes: local.nodes, rels: local.rels, drafts: local.drafts };
  const history = createHistory();
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
  const persist = () => saveLocal(env.storage, g, view);

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
    const out = allFields().filter(({ f }) => !f.isIntentField).map(({ f, key }) => ({ ref: { kind: 'field', key }, label: f.label + (f.unit ? ' (' + f.unit + ')' : ''), lo: f.min, hi: f.max, role: f.role }));
    for (const d of devices.values()) {
      for (const c of d.controls) {
        out.push({ ref: bpRef(d, c), label: d.name + ': ' + (c.description || c.type) + (c.kind === 'sensor' ? ' reading' : ' (app)'), lo: c.range?.[0], hi: c.range?.[1] });
      }
    }
    return out;
  }
  function targets() {
    const out = allFields().filter(({ f }) => writable(f))
      .map(({ f, key }) => ({ ref: { kind: 'field', key }, label: f.label + (toAccessory(f) ? ' (accessory)' : ''), lo: f.min, hi: f.max, role: f.role }));
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
      const from = addNode(g, a, x - SPREAD, y).id;
      const to = addNode(g, b, x + SPREAD, y).id;
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
    hubState.set(r.rel_id, { phase: 'pending', reason: op === STORE_OP.save ? 'waiting for the store' : 'deleting' });
    changed();
    const bytes = op === STORE_OP.save ? storeItem(r, src, dst) : null;
    const act = { channelId: h.writer.id, key: h.op.key, label: 'relationships' };
    const extra = storeVerb(h, op, r, bytes);
    delete extra[h.op.key];
    const res = await env.runAction(act, op, extra);
    if (!res || !res.ok) {
      hubState.set(r.rel_id, { phase: 'fault', reason: (res && res.error) || 'no answer from the hub' });
      await refreshHub();   // back to what the hub holds (law 4)
      return;
    }
    hubState.delete(r.rel_id);
    await refreshHub();
    const back = hub.rels.find((it) => it.rel_id === r.rel_id);
    if (op !== STORE_OP.save) {
      if (back) hubState.set(r.rel_id, { phase: 'fault', reason: 'the hub still holds it' });
    } else if (!back) {
      hubState.set(r.rel_id, { phase: 'fault', reason: 'acked, not stored' });
    } else {
      hubState.set(r.rel_id, { phase: 'confirmed', reason: 'stored on the hub' });
    }
    changed();
  }

  /** Armed and faulted for a hub edge, from the hub's roster only (never local belief). */
  function hubArmed(r) {
    const bits = hub.roster && rosterBits(hub.roster, env.sample(hub.roster.id));
    if (!bits) return { known: false, why: 'armed state unknown' };
    const b = 1 << r.rel_id;
    if (bits.faulted & b) return { known: true, armed: false, why: 'faulted on the hub' };
    return bits.armed & b ? { known: true, armed: true, why: 'armed on the hub' } : { known: true, armed: false, why: 'disarmed on the hub' };
  }

  // ---- edits -----------------------------------------------------------------
  /** Why the hub cannot hold an edge from source ref a, in words; '' when it can. */
  function hubRefusal(a) {
    const s = surfaces();
    if (s.reason) return s.reason;
    if (!hubLoc(a, false)) return 'the hub maps from STATE or STREAM fields only';
    if (freeRelId(g, hub.store ? hub.store.store.capacity : undefined) < 0) return 'the hub stores no more relationships';
    return '';
  }

  /**
   * Add an edge from source ref a to target ref b. `extra`: {name?, params?}.
   * Returns '' or the refusal in words.
   */
  function add(a, b, map, bounds, at = { x: 0, y: 0 }, extra = {}) {
    const h = home(a, b);
    if (!h.home) return h.why;
    if (h.home === 'hub') {
      const why = hubRefusal(a);
      if (why) return why;
    }
    const from = addNode(g, a, at.x - SPREAD, at.y).id;
    const to = addNode(g, b, at.x + SPREAD, at.y).id;
    const o = { map, ...bounds, home: h.home, x: at.x, y: at.y, name: extra.name, params: extra.params };
    if (h.home === 'hub') {
      o.rel_id = freeRelId(g, hub.store ? hub.store.store.capacity : undefined);
      o.id = 'h' + o.rel_id;
      hubPos[o.rel_id] = [at.x, at.y];
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
    return step(() => {
      const r = g.rels.find((x) => x.id === id);
      if (!r) return 'that map is gone';
      const next = { ...r, ...patch };
      const bad = checkRel(next) || (patch.enabled && !r.enabled ? refuseConnect(g, r.from, r.to, r) : '');
      if (bad) return bad;
      Object.assign(r, patch);
      if (r.home === 'hub') saveHub(r);
      return '';
    });
  }

  /** Delete a map node and its edge. A hub edge stays, pending, until the store drops it. */
  function remove(id) {
    step(() => { const r = g.rels.find((x) => x.id === id); if (r) dropRel(r); return ''; });
  }

  function dropRel(r) {
    if (r.home === 'hub' && hub.rels.some((it) => it.rel_id === r.rel_id)) { saveHub(r, STORE_OP.delete_item); return; }
    hubState.delete(r.rel_id);
    removeRel(g, r.id);
  }

  // ---- the canvas: nodes, drafts, wires, undo ----------------------------------
  const nodeOf = (id) => g.nodes.find((n) => n.id === id);
  const draftOf = (id) => g.drafts.find((d) => d.id === id);
  const homeNodes = (a, b) => home(a.ref, b.ref);
  const snapshot = () => JSON.parse(JSON.stringify({ nodes: g.nodes, rels: g.rels, drafts: g.drafts }));
  // What a hub slot holds, positions aside: a change here is a store write.
  const hubKey = (r, nodes) => {
    if (!r) return '';
    const ref = (id) => { const n = nodes.find((m) => m.id === id); return n ? refKey(n.ref) : id; };
    return JSON.stringify([r.name, r.map, r.in_min, r.in_max, r.out_min, r.out_max, r.params, r.enabled, ref(r.from), ref(r.to)]);
  };
  const hubSlots = (s) => new Map(s.rels.filter((r) => r.home === 'hub').map((r) => [r.rel_id, r]));

  /**
   * One user edit as one undo step: `fn` mutates g and returns '' or a refusal
   * in words; a refusal leaves no step. The step remembers which hub slots the
   * edit touched, so undo writes those and leaves every other slot as it is.
   */
  function step(fn) {
    const before = snapshot();
    const why = fn();
    if (why) return why;
    const a = hubSlots(before);
    const b = hubSlots(g);
    const slots = new Set();
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      if (hubKey(a.get(id), before.nodes) !== hubKey(b.get(id), g.nodes)) slots.add(id);
    }
    history.push({ snap: before, slots });
    persist();
    changed();
    return '';
  }

  /** Back to a stored state: local parts at once, each touched hub slot through the store (law 4). */
  function restore(e) {
    const want = e.snap;
    const cur = hubSlots(g);
    const wantHub = hubSlots(want);
    const rels = want.rels.filter((r) => r.home === 'client');
    const saves = [];
    const deletes = [];
    for (const [id, r] of cur) {
      if (e.slots.has(id)) continue;
      const w = wantHub.get(id);
      rels.push(w ? { ...r, x: w.x, y: w.y } : r);
    }
    for (const id of e.slots) {
      const w = wantHub.get(id);
      const c = cur.get(id);
      if (w) {
        rels.push(w);
        if (hubKey(w, want.nodes) !== hubKey(c, g.nodes)) saves.push(w);
      } else if (c) {
        rels.push(c);   // stays until the store drops it
        deletes.push(c);
      }
    }
    const nodes = [...want.nodes];
    for (const r of rels) {
      for (const id of [r.from, r.to]) {
        if (!nodes.some((n) => n.id === id)) { const n = nodeOf(id); if (n) nodes.push(n); }
      }
    }
    g = { v: 1, nodes, rels, drafts: want.drafts };
    for (const r of rels) if (r.home === 'hub') hubPos[r.rel_id] = [r.x, r.y];
    for (const r of saves) saveHub(r);
    for (const r of deletes) saveHub(r, STORE_OP.delete_item);
    persist();
    changed();
  }

  const travel = (pop) => {
    const e = pop((x) => ({ snap: snapshot(), slots: x.slots }));
    if (e) restore(e);
    return !!e;
  };

  /** Bounds and parameters for an edge between two nodes; a draft's own carry over where its ends are the same. */
  function configFor(fromId, toId, cfg) {
    const a = nodeOf(fromId).ref;
    const b = nodeOf(toId).ref;
    const s = sources().find((x) => refKey(x.ref) === refKey(a));
    const t = targets().find((x) => refKey(x.ref) === refKey(b));
    const sameIn = cfg && cfg.src === fromId;
    const sameOut = cfg && cfg.dst === toId;
    const win = [api.value(api.field(ROLE.windowMin)), api.value(api.field(ROLE.windowMax))];
    const [ilo, ihi] = endRange(s && s.lo, s && s.hi, s && s.role, win);
    const [olo, ohi] = endRange(t && t.lo, t && t.hi, t && t.role, win);
    const o = {
      in_min: sameIn ? cfg.in_min : ilo, in_max: sameIn ? cfg.in_max : ihi,
      out_min: sameOut ? cfg.out_min : olo, out_max: sameOut ? cfg.out_max : ohi,
    };
    if (o.in_min === o.in_max) o.in_max = o.in_min + 1;
    return { bounds: o, params: sameIn && sameOut ? cfg.params : undefined };
  }

  /** A rel back to a draft map node, keeping one end ('from', 'to' or null) and its numbers. */
  function toDraft(r, keep) {
    const d = addDraft(g, r.map, r.x, r.y, { name: r.name, from: keep === 'from' ? r.from : null, to: keep === 'to' ? r.to : null });
    d.cfg = { src: r.from, dst: r.to, in_min: r.in_min, in_max: r.in_max, out_min: r.out_min, out_max: r.out_max, params: r.params };
    dropRel(r);
    return d;
  }

  /** Why output socket a cannot be wired to input socket b, in words; '' when it can. Changes nothing. */
  function why(a, b) {
    const p = planWire(g, a, b, homeNodes);
    if (p.reason || p.partial) return p.reason || '';
    const h = homeNodes(nodeOf(p.from), nodeOf(p.to));
    return h.home === 'hub' ? hubRefusal(nodeOf(p.from).ref) : '';
  }

  /** Wire output socket a to input socket b (node, draft or rel ids). '' or the refusal in words. */
  function wire(a, b) {
    return step(() => {
      const p = planWire(g, a, b, homeNodes);
      if (p.reason) return p.reason;
      if (p.partial) {
        p.draft.from = p.from;
        p.draft.to = p.to;
      } else {
        const A = nodeOf(p.from);
        const B = nodeOf(p.to);
        const d = p.draft;
        const at = d ? { x: d.x, y: d.y } : { x: snap((A.x + B.x) / 2), y: snap((A.y + B.y) / 2) };
        const { bounds, params } = configFor(p.from, p.to, d && d.cfg);
        let res = add(A.ref, B.ref, d ? d.map : MAP.linear_clamp, bounds, at, { name: d && d.name, params });
        if (res && params) res = add(A.ref, B.ref, d.map, bounds, at, { name: d.name });
        if (res) return res;
        if (d) g.drafts = g.drafts.filter((x) => x !== d);
      }
      for (const id of [p.from, p.to]) { const n = id != null && nodeOf(id); if (n) n.pinned = true; }
      return '';
    });
  }

  /** Cut the wire at one socket: a map's in or out, or every wire at a field node's in or out. */
  function unwire(id, side) {
    return step(() => {
      const end = side === 'in' ? 'from' : 'to';
      const d = draftOf(id);
      if (d) { d[end] = null; return ''; }
      const r = g.rels.find((x) => x.id === id);
      if (r) { toDraft(r, side === 'in' ? 'to' : 'from'); return ''; }
      const at = side === 'in' ? 'to' : 'from';
      for (const x of g.drafts) if (x[at] === id) x[at] = null;
      for (const x of g.rels.filter((q) => q[at] === id)) toDraft(x, side === 'in' ? 'from' : 'to');
      return '';
    });
  }

  /** Put a node for a ref on the canvas at (x, y); a ref already there is returned, not doubled. */
  function place(ref, x, y) {
    const had = g.nodes.find((n) => refKey(n.ref) === refKey(ref));
    if (had) return { id: had.id, already: true };
    let id = null;
    step(() => { const n = addNode(g, ref, snap(x), snap(y)); n.pinned = true; id = n.id; return ''; });
    return { id, already: false };
  }

  /** Put a map node (a draft until both ends are wired) at (x, y). */
  function placeMap(map, x, y) {
    let id = null;
    step(() => { id = addDraft(g, map, snap(x), snap(y)).id; return ''; });
    return id;
  }

  /** Delete nodes, drafts and map nodes by id as one step. A field node's maps stay, unwired at that end. */
  function removeMany(ids) {
    return step(() => {
      for (const id of ids) {
        const r = g.rels.find((x) => x.id === id);
        if (r) { dropRel(r); continue; }
        if (draftOf(id)) { g.drafts = g.drafts.filter((x) => x.id !== id); continue; }
        if (!nodeOf(id)) continue;
        for (const x of g.rels.filter((q) => q.from === id || q.to === id)) toDraft(x, x.from === id ? 'to' : 'from');
        removeNode(g, id);
      }
      return '';
    });
  }

  /** Unwired copies of the map nodes among ids, one grid step pair down and right. Fields appear once, so they are skipped. */
  function duplicate(ids) {
    const made = [];
    step(() => {
      for (const id of ids) {
        const m = g.rels.find((x) => x.id === id) || draftOf(id);
        if (!m) continue;
        const d = addDraft(g, m.map, m.x + 40, m.y + 40, { name: m.name });
        if (m.cfg) d.cfg = JSON.parse(JSON.stringify(m.cfg));
        else d.cfg = { src: m.from, dst: m.to, in_min: m.in_min, in_max: m.in_max, out_min: m.out_min, out_max: m.out_max, params: [...m.params] };
        made.push(d.id);
      }
      return made.length ? '' : 'nothing to duplicate';
    });
    return made;
  }

  /** Move several things at once, one step: [{id, x, y}]. Positions are local. */
  function moveMany(list) {
    return step(() => {
      for (const { id, x, y } of list) {
        const n = nodeOf(id) || g.rels.find((r) => r.id === id) || draftOf(id);
        if (!n) continue;
        n.x = x;
        n.y = y;
        if (n.ref) n.pinned = true;
        if (n.rel_id != null && n.home === 'hub') hubPos[n.rel_id] = [x, y];
      }
      return '';
    });
  }

  // ---- what a node shows -------------------------------------------------------
  /** Socket types by what they carry: field (a numeric catalog field), app (an app's command), sensor (a toy reading), toy (a toy control). */
  function ports(ref) {
    const k = refKey(ref);
    const wired = (end) => g.rels.some((r) => { const n = nodeOf(r[end]); return n && refKey(n.ref) === k; });
    const asSrc = sources().some((s) => refKey(s.ref) === k) || wired('from');
    const asDst = targets().some((t) => refKey(t.ref) === k) || wired('to');
    const bp = ref.kind === 'bp';
    return {
      out: asSrc ? (bp ? (ref.ctl === 'sensor' ? 'sensor' : 'app') : 'field') : null,
      in: asDst ? (bp ? 'toy' : 'field') : null,
    };
  }

  /** A target's own answer: a field's write status and NACK reason, a toy's last applied output. */
  function echo(ref) {
    if (ref.kind === 'bp') return { status: 'confirmed', reason: '', value: outputs.get(refKey(ref)) };
    const f = fieldFor(ref.key);
    if (!f) return { status: 'fault', reason: 'absent from this catalog', value: undefined };
    const sh = env.shadow ? env.shadow(f) : null;
    return { status: api.status(f), reason: (sh && sh.error) || '', value: api.value(f) };
  }

  /** The palette: sources by category plus toy inputs and app commands; targets by where they live. */
  function palette() {
    const m = api.catalog();
    const cat = new Map();
    for (const c of (m && m.categories) || []) {
      for (const gr of c.groups) for (const f of gr.fields) for (const x of [f, f.lo, f.hi]) if (x) cat.set(x.uid, c.label);
    }
    const srcGroup = (s) => {
      if (s.ref.kind === 'bp') return s.ref.ctl === 'sensor' ? 'Toy inputs' : 'App commands';
      const f = fieldFor(s.ref.key);
      return (f && cat.get(f.uid)) || 'Other';
    };
    const dstGroup = (t) => {
      if (t.ref.kind === 'bp') return 'Toy outputs';
      return toAccessory(fieldFor(t.ref.key)) ? 'Accessory fields' : 'Machine fields';
    };
    return {
      sources: sources().map((s) => ({ ...s, group: srcGroup(s) })),
      targets: targets().map((t) => ({ ...t, group: dstGroup(t) })),
    };
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
    hubArmed, home, sources, targets, add, edit, remove, refreshHub, tick,
    why, wire, unwire, place, placeMap, removeMany, duplicate, moveMany, ports, echo, palette,
    undo: () => travel((swap) => history.undo(swap)),
    redo: () => travel((swap) => history.redo(swap)),
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
    get view() { return view; },
    setView(v) { view = v; persist(); },
    value: (ref) => io.read(ref),
    unit: (ref) => (ref.kind === 'field' && fieldFor(ref.key)?.unit) || '',
    stale: (ref) => (ref.kind === 'field' && fieldFor(ref.key) ? api.stale(fieldFor(ref.key)) : ''),
    out: (id) => runner.out(id),
    maps: MAPS, MAP,
    label(ref) {
      // A toy control is both; its target label names it without the app's role.
      const all = ref.kind === 'bp' ? [...targets(), ...sources()] : [...sources(), ...targets()];
      const s = all.find((x) => refKey(x.ref) === refKey(ref));
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
  const [{ machine, getSession }, { runAction, shadowOf }, { mount, unmount }, { default: GraphEditor }] = await Promise.all([
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
    shadow: shadowOf,
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
