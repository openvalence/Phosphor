/**
 * graph.js -- the node graph's model: one vocabulary for hub relationships
 * (SPEC 8.11) and Phosphor's client-side mappings (Valence rfc-upv). Pure,
 * so test/graph.test.mjs runs it with no hub, no shell and no DOM.
 *
 * Constraints:
 * - The seven maps evaluate exactly as SPEC 8.11 words them. Map numbers and
 *   item keys come from the generated registry vocabulary, never restated.
 * - A hub edge's truth is the hub's relationships STORE, never this model: an
 *   edit stays pending until a store read returns it (law 4).
 * - Client edges mirror SPEC 11.6: no link, no safety word, ESTOP or PAUSE
 *   disarms every one, and disarming drives each target with a safe value to
 *   it once. A machine field target has no client-side safe value: the hub
 *   applies its own pause.
 * - Refs are stable keys (law 10): a field by its placement key, a buttplug
 *   control by the server's device key, never a device index.
 * See: docs/DESIGN.md 10.8, Valence SPEC 8.11 and 11.6
 */
import {
  RELATIONSHIP_MAP as M, RELATIONSHIP_K as K, BLOB_K, STORE_OP, LIMITS,
} from '../../../Valence/clients/js/generated/registry_vocab.js';
import {
  cbMap, cbUint, cbTstr, cbF32, cbArray, cbBool, cbBstr, cbDecodeFull,
} from '../../../Valence/clients/js/cbor.js';

export { M as MAP };
export const ITEM_KIND = 'relationship.map';
/** Client-side evaluation period: bounds every client write to 20 Hz. */
export const TICK_MS = 50;

/** Words and parameter names per map, in the order SPEC 8.11 lists them. */
export const MAPS = {
  [M.linear_clamp]: { label: 'linear clamp', params: [] },
  [M.invert]: { label: 'invert', params: [] },
  [M.threshold_hysteresis]: { label: 'threshold with hysteresis', params: ['on above', 'off below'] },
  [M.slew_limit]: { label: 'slew limit', params: ['rise per s', 'fall per s'] },
  [M.lowpass]: { label: 'low-pass', params: ['tau (s)'] },
  [M.gate]: { label: 'gate', params: [] },
  [M.piecewise_table]: { label: 'piecewise table', params: null },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** SPEC 8.11 L(in). A reversed input window (in_min > in_max) clamps to the same span. */
export function line(r, x) {
  const c = clamp(x, Math.min(r.in_min, r.in_max), Math.max(r.in_min, r.in_max));
  return r.out_min + (c - r.in_min) * (r.out_max - r.out_min) / (r.in_max - r.in_min);
}

/** `gate` outside its window: the caller substitutes the target's safe value. */
export const SAFE = Symbol('safe');

/**
 * One evaluation of a relationship's map. `s` is that edge's state ({} when
 * armed), `dt` the seconds since its previous evaluation (0 on the first).
 * @returns {number|typeof SAFE|undefined}
 */
export function evalMap(r, s, x, dt) {
  const p = r.params || [];
  switch (r.map) {
    case M.linear_clamp: return line(r, x);
    case M.invert: return r.out_max + r.out_min - line(r, x);
    case M.threshold_hysteresis:
      if (!s.on && x >= p[0]) s.on = true;
      else if (s.on && x <= p[1]) s.on = false;
      return s.on ? r.out_max : r.out_min;
    case M.slew_limit: {
      const want = line(r, x);
      if (s.y == null) return (s.y = want);
      const d = want - s.y;
      s.y += d > 0 ? Math.min(d, p[0] * dt) : Math.max(d, -(p.length > 1 ? p[1] : p[0]) * dt);
      return s.y;
    }
    case M.lowpass: {
      const want = line(r, x);
      if (s.y == null || !(p[0] > 0)) return (s.y = want);
      s.y += (want - s.y) * (1 - Math.exp(-dt / p[0]));
      return s.y;
    }
    case M.gate:
      return x >= Math.min(r.in_min, r.in_max) && x <= Math.max(r.in_min, r.in_max) ? line(r, x) : SAFE;
    case M.piecewise_table: {
      const n = p.length >> 1;
      if (!n) return undefined;
      if (x <= p[0]) return p[1];
      for (let i = 1; i < n; i++) {
        const x0 = p[2 * i - 2], y0 = p[2 * i - 1], x1 = p[2 * i], y1 = p[2 * i + 1];
        if (x <= x1) return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
      }
      return p[2 * n - 1];
    }
    default: return undefined;
  }
}

/** What is wrong with a relationship's map and numbers, in words; '' when nothing. */
export function checkRel(r) {
  const spec = MAPS[r.map];
  if (!spec) return 'unknown map ' + r.map;
  const p = r.params || [];
  if (p.length > 16 || !p.every(Number.isFinite)) return 'parameters must be up to 16 numbers';
  if (r.map === M.piecewise_table) {
    if (p.length < 2 || p.length > 16 || p.length % 2) return 'a table needs 1 to 8 (in, out) points';
    for (let i = 2; i < p.length; i += 2) if (!(p[i] > p[i - 2])) return 'table inputs must strictly ascend';
    return '';
  }
  if (![r.in_min, r.in_max, r.out_min, r.out_max].every(Number.isFinite)) return 'all four bounds must be numbers';
  if (r.in_min === r.in_max) return 'in min and in max must differ';
  if (p.length < spec.params.length - (r.map === M.slew_limit ? 1 : 0)) return 'missing ' + spec.params[p.length];
  if (r.map === M.threshold_hysteresis && p[1] > p[0]) return 'off below must not exceed on above';
  if (r.map === M.slew_limit && !(p[0] > 0 && (p.length < 2 || p[1] > 0))) return 'rates must be above zero';
  if (r.map === M.lowpass && !(p[0] >= 0)) return 'tau must not be negative';
  return '';
}

/** Parameters a new edge starts with, from its source and target bounds. */
export function defaultParams(map, inLo, inHi, outLo, outHi) {
  const at = (f) => inLo + (inHi - inLo) * f;
  switch (map) {
    case M.threshold_hysteresis: return [at(0.6), at(0.4)];
    case M.slew_limit: return [Math.abs(outHi - outLo)];
    case M.lowpass: return [0.5];
    case M.piecewise_table: return [inLo, outLo, inHi, outHi];
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Refs and homes
// ---------------------------------------------------------------------------

/**
 * Ref kinds: {kind: 'field', key} a catalog field by placement key;
 * {kind: 'bp', device, feature, type, ctl, range} one control of a device the
 * embedded buttplug server lists (ctl scalar, rotate or linear as a target or
 * as an app's applied output; sensor as a reading).
 */
export const refKey = (ref) => (ref.kind === 'bp'
  ? 'bp:' + ref.device + ':' + ref.feature + ':' + ref.type
  : 'field:' + ref.key);

/** SPEC 8.10: 0x8000-0xBFFF (registry channel_id_ranges `user`) is the accessory space. */
export const isUserSpace = (ch) => ch >= 0x8000 && ch <= 0xbfff;

/**
 * Where an edge runs, and why, in words. `toAccessory`: the target is an
 * accessory field. A null home is a refusal.
 */
export function homeOf(from, to, toAccessory) {
  if (from.kind === 'bp' || to.kind === 'bp') {
    return { home: 'client', why: 'runs in Phosphor: a buttplug end is connected here, not to the hub, so it stops when Phosphor closes' };
  }
  if (toAccessory) {
    return { home: 'hub', why: 'runs on the hub: both ends are hub fields, so it keeps running with no client open' };
  }
  return { home: null, why: 'the hub maps only onto accessory fields (SPEC 8.11), and a field-to-field mapping kept in Phosphor would stop when Phosphor closes' };
}

/** SPEC 11.6, mirrored for client edges: armed only with a live link, a safety word, no ESTOP and no PAUSE. */
export function interlock(live, safety) {
  if (!live) return { ok: false, why: 'disarmed: no hub link, so pause and e-stop are unknown' };
  if (!safety) return { ok: false, why: 'disarmed: no safety word from the hub yet' };
  if (safety.estopLatched) return { ok: false, why: 'disarmed: e-stop latched' };
  if (safety.paused) return { ok: false, why: 'disarmed: paused' };
  return { ok: true, why: 'armed' };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

/**
 * {v, nodes: [{id, ref, x, y}], rels: [rel]}; rel = {id, name, from, to (node
 * ids), map, in_min, in_max, out_min, out_max, params, enabled, home, x, y}.
 * A hub rel also carries `rel_id`, its store slot.
 */
export const emptyGraph = () => ({ v: 1, nodes: [], rels: [] });

let seq = 0;
const newId = (p) => p + Date.now().toString(36) + (seq++).toString(36);

/** The node for a ref, added at (x, y) when the graph has none. */
export function addNode(g, ref, x = 0, y = 0) {
  const k = refKey(ref);
  let n = g.nodes.find((m) => refKey(m.ref) === k);
  if (!n) g.nodes.push((n = { id: newId('n'), ref, x, y }));
  return n;
}

/** True when `to` already reaches `from` through enabled-or-not rels: a new from->to would close a loop. */
export function wouldLoop(g, from, to) {
  if (from === to) return true;
  const seen = new Set([to]);
  const stack = [to];
  while (stack.length) {
    const at = stack.pop();
    for (const r of g.rels) {
      if (r.from !== at || seen.has(r.to)) continue;
      if (r.to === from) return true;
      seen.add(r.to);
      stack.push(r.to);
    }
  }
  return false;
}

/** Why a rel from->to cannot be added, in words; '' when it can. */
export function refuseConnect(g, from, to, except = null) {
  if (wouldLoop(g, from, to)) return 'refused: this edge would close a feedback loop (the hub refuses it too, SPEC 8.11)';
  const other = g.rels.find((r) => r !== except && r.to === to && r.enabled);
  if (other) return 'refused: that target is already driven by "' + other.name + '"; one target has at most one enabled edge';
  return '';
}

/**
 * Add a rel. `o`: {map, in_min, in_max, out_min, out_max, params?, name?,
 * home, rel_id?, x?, y?}. Returns {rel} or {reason}.
 */
export function connect(g, from, to, o) {
  const reason = refuseConnect(g, from, to);
  if (reason) return { reason };
  const rel = {
    id: newId('r'), name: o.name || MAPS[o.map].label, from, to, map: o.map,
    in_min: o.in_min, in_max: o.in_max, out_min: o.out_min, out_max: o.out_max,
    params: o.params || defaultParams(o.map, o.in_min, o.in_max, o.out_min, o.out_max),
    enabled: true, home: o.home, x: o.x || 0, y: o.y || 0,
  };
  if (o.rel_id != null) rel.rel_id = o.rel_id;
  const bad = checkRel(rel);
  if (bad) return { reason: bad };
  g.rels.push(rel);
  return { rel };
}

/** Drop a rel, then any node no rel touches. */
export function removeRel(g, id) {
  g.rels = g.rels.filter((r) => r.id !== id);
  g.nodes = g.nodes.filter((n) => g.rels.some((r) => r.from === n.id || r.to === n.id));
}

/** Lowest free hub slot, or -1 when every one of `capacity` is taken. */
export function freeRelId(g, capacity = LIMITS.relationships_max) {
  const used = new Set(g.rels.filter((r) => r.home === 'hub').map((r) => r.rel_id));
  for (let i = 0; i < capacity; i++) if (!used.has(i)) return i;
  return -1;
}

// ---------------------------------------------------------------------------
// Local storage: client edges, and where every node sits
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'phosphor.graph';

/** The graph as stored: nodes, client rels, and hub rels' positions by rel_id. Hub rels' truth is the hub. */
export function saveLocal(storage, g) {
  const pos = {};
  for (const r of g.rels) if (r.home === 'hub') pos[r.rel_id] = [r.x, r.y];
  const out = { v: 1, nodes: g.nodes, rels: g.rels.filter((r) => r.home === 'client'), hubPos: pos };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch (e) { /* private mode: the graph lives for this run */ }
}

export function loadLocal(storage) {
  try {
    const o = JSON.parse(storage.getItem(STORAGE_KEY));
    if (o && o.v === 1 && Array.isArray(o.nodes) && Array.isArray(o.rels)) {
      return { v: 1, nodes: o.nodes, rels: o.rels.filter((r) => r.home === 'client' && MAPS[r.map]), hubPos: o.hubPos || {} };
    }
  } catch (e) { /* absent or unreadable: start empty */ }
  return { ...emptyGraph(), hubPos: {} };
}

// ---------------------------------------------------------------------------
// The hub half: SPEC 8.11's relationships STORE, item grammar relationship_keys
// ---------------------------------------------------------------------------

/**
 * A hub rel as its relationship_keys item. `src` {channel, field}: the source
 * channel and layout index; `dst` {channel, field}: the target channel and
 * schema key. Floats ride as f32 (the deterministic profile has no f64).
 */
export function encodeItem(r, src, dst) {
  const f = (v) => cbF32(v);
  return cbMap([
    [K.rel_id, cbUint(r.rel_id)],
    [K.name, cbTstr(r.name || '')],
    [K.source_channel, cbUint(src.channel)],
    [K.source_field, cbUint(src.field)],
    [K.target_channel, cbUint(dst.channel)],
    [K.target_field, cbUint(dst.field)],
    [K.map, cbUint(r.map)],
    [K.in_min, f(r.in_min ?? 0)],
    [K.in_max, f(r.in_max ?? 0)],
    [K.out_min, f(r.out_min ?? 0)],
    [K.out_max, f(r.out_max ?? 0)],
    [K.params, cbArray((r.params || []).map(f))],
    [K.enabled, cbBool(!!r.enabled)],
  ]);
}

/** A relationship_keys item back to {rel_id, name, src, dst, map, bounds, params, enabled}; null when malformed. */
export function decodeItem(bytes) {
  let m;
  try { m = cbDecodeFull(bytes); } catch (e) { return null; }
  if (!(m instanceof Map) || !MAPS[m.get(K.map)]) return null;
  const params = m.get(K.params);
  return {
    rel_id: m.get(K.rel_id), name: m.get(K.name) ?? '',
    src: { channel: m.get(K.source_channel), field: m.get(K.source_field) },
    dst: { channel: m.get(K.target_channel), field: m.get(K.target_field) },
    map: m.get(K.map), in_min: m.get(K.in_min), in_max: m.get(K.in_max),
    out_min: m.get(K.out_min), out_max: m.get(K.out_max),
    params: Array.isArray(params) ? params : [], enabled: m.get(K.enabled) === true,
  };
}

/** The SPEC 8.7 store-item document (blob_keys) carrying one relationship item as its payload. */
export const storeItem = (r, src, dst) => cbMap([
  [BLOB_K.slot, cbUint(r.rel_id)],
  [BLOB_K.name, cbTstr(r.name || '')],
  [BLOB_K.kind, cbTstr(ITEM_KIND)],
  [BLOB_K.payload, cbBstr(encodeItem(r, src, dst))],
]);

/** A store-item document to its relationship, or null. */
export function readStoreItem(bytes) {
  try {
    const m = cbDecodeFull(bytes);
    const p = m instanceof Map ? m.get(BLOB_K.payload) : null;
    return p instanceof Uint8Array ? decodeItem(p) : null;
  } catch (e) { return null; }
}

/**
 * The hub's relationships surfaces, joined by RFC-070 store_id: {store,
 * roster, writer, op, slot, name, item} or a reason in words. `coreId` is the
 * registry's relationships channel. The writer's slot, name and item fields
 * carry no registered role, so they are found by type: the one unroled uint,
 * tstr and bstr beside the action.store op select.
 */
export function findHub(entries, coreId, CBOR) {
  const store = entries.find((e) => e.id === coreId && e.store);
  if (!store) return { reason: 'this hub has no relationships store yet, so hub edges cannot be saved' };
  const sid = store.store.storeId;
  const roster = entries.find((e) => e.storeId === sid && e.layout) || null;
  const writer = entries.find((e) => e.storeId === sid && e.schema && e.schema.some((f) => f.role === 'action.store'));
  if (!writer) return { reason: 'this hub stores relationships but declares no writer for them' };
  const plain = writer.schema.filter((f) => !f.role);
  const one = (t) => { const hit = plain.filter((f) => f.type === t); return hit.length === 1 ? hit[0] : null; };
  const op = writer.schema.find((f) => f.role === 'action.store');
  const item = one(CBOR.bstr_t);
  if (!item) return { reason: "this hub's relationships writer has no item field this client can fill" };
  return { store, roster, writer, op, slot: one(CBOR.uint_t), name: one(CBOR.tstr_t), item };
}

/** The `fields` of one store verb on the writer: an object keyed by schema key. */
export function storeVerb(hub, op, r, bytes) {
  const out = { [hub.op.key]: op };
  if (hub.slot) out[hub.slot.key] = r.rel_id;
  if (hub.name && op !== STORE_OP.delete_item) out[hub.name.key] = r.name || '';
  if (bytes && op === STORE_OP.save) out[hub.item.key] = bytes;
  return out;
}

/** Armed and faulted bits by rel_id from a relationships-roster sample, read by layout position (SPEC 8.11 order). */
export function rosterBits(roster, sample) {
  const L = roster && roster.layout;
  if (!sample || !L || L.length !== 7) return null;
  const v = (i) => (sample[L[i].name] | 0);
  return { armed: v(3) | (v(4) << 8), faulted: v(5) | (v(6) << 8) };
}

// ---------------------------------------------------------------------------
// The client-side evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates every enabled client rel each `step`. `io`:
 *   read(ref)   -> source value in its physical units, or undefined
 *   target(ref) -> {min?, max?, step?, integer?, safe?} or null when absent
 *   write(ref, value)
 *   armed()     -> {ok, why} (interlock())
 * Writes a target only when the output moved by its step (any change when it
 * declares none), as SPEC 8.11 evaluation does.
 */
export function createRunner(io) {
  const st = new Map();
  let was = false;
  let last = 0;

  function step(g, now) {
    const a = io.armed();
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const mine = g.rels.filter((r) => r.home === 'client' && r.enabled && byId.has(r.from) && byId.has(r.to));
    if (!a.ok) {
      if (was) {
        for (const r of mine) {
          const t = io.target(byId.get(r.to).ref);
          if (t && t.safe != null) io.write(byId.get(r.to).ref, t.safe);
        }
      }
      was = false;
      st.clear();
      return a;
    }
    was = true;
    for (const r of mine) {
      const to = byId.get(r.to).ref;
      const t = io.target(to);
      const x = io.read(byId.get(r.from).ref);
      if (!t || typeof x !== 'number' || !Number.isFinite(x)) continue;
      let s = st.get(r.id);
      if (!s || s.map !== r.map) st.set(r.id, (s = { map: r.map, m: {}, last: undefined }));
      let out = evalMap(r, s.m, x, dt);
      if (out === SAFE) out = t.safe;
      if (typeof out !== 'number' || !Number.isFinite(out)) continue;
      if (t.min != null) out = Math.max(t.min, out);
      if (t.max != null) out = Math.min(t.max, out);
      if (t.integer) out = Math.round(out);
      if (s.last !== undefined && (t.step ? Math.abs(out - s.last) < t.step : out === s.last)) continue;
      s.last = out;
      io.write(to, out);
    }
    return a;
  }

  return { step, reset: () => { st.clear(); was = false; last = 0; } };
}
