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
import { ROLE } from './roles.js';

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

/** Hysteresis: on at `on` and above, off at `off` and below, held between. State `s.on`. */
export function hysteresis(s, x, on, off) {
  if (!s.on && x >= on) s.on = true;
  else if (s.on && x <= off) s.on = false;
  return !!s.on;
}

/** One slew-limited step toward `want`; state `s.y`, starts at `want`. */
export function slewStep(s, want, rise, fall, dt) {
  if (s.y == null) return (s.y = want);
  const d = want - s.y;
  s.y += d > 0 ? Math.min(d, rise * dt) : Math.max(d, -fall * dt);
  return s.y;
}

/** One first-order low-pass step toward `want`; state `s.y`. A tau of 0 or less passes through. */
export function lowpassStep(s, want, tau, dt) {
  if (s.y == null || !(tau > 0)) return (s.y = want);
  s.y += (want - s.y) * (1 - Math.exp(-dt / tau));
  return s.y;
}

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
    case M.threshold_hysteresis: return hysteresis(s, x, p[0], p[1]) ? r.out_max : r.out_min;
    case M.slew_limit: return slewStep(s, line(r, x), p[0], p.length > 1 ? p[1] : p[0], dt);
    case M.lowpass: return lowpassStep(s, line(r, x), p[0], dt);
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

const RAIL = new Set([ROLE.telemetryPosition, ROLE.telemetryTarget, ROLE.commandPosition]);

/**
 * [lo, hi] a new map starts with at one end (ph-9m9): the field's declared
 * bounds, else for a rail position the stroke window it moves in, else 0..1.
 */
export function endRange(lo, hi, role, window) {
  const span = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a !== b;
  if (span(lo, hi)) return [lo, hi];
  if (RAIL.has(role) && window && span(window[0], window[1])) return [window[0], window[1]];
  return [0, 1];
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
    return { home: 'client', why: 'runs in Phosphor (buttplug end)' };
  }
  if (toAccessory) {
    return { home: 'hub', why: 'runs on the hub' };
  }
  return { home: null, why: 'the hub maps only onto accessory fields (SPEC 8.11)' };
}

/** SPEC 11.6, mirrored for client edges: armed only with a live link, a safety word, no ESTOP and no PAUSE. */
export function interlock(live, safety) {
  if (!live) return { ok: false, why: 'disarmed: no hub link' };
  if (!safety) return { ok: false, why: 'disarmed: safety state unknown' };
  if (safety.estopLatched) return { ok: false, why: 'disarmed: e-stop latched' };
  if (safety.paused) return { ok: false, why: 'disarmed: paused' };
  return { ok: true, why: 'armed' };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

/**
 * {v, nodes: [{id, ref, x, y, pinned?}], rels: [rel], drafts: [draft], ops: [op],
 * links: [link]}; rel =
 * {id, name, from, to (node ids), map, in_min, in_max, out_min, out_max,
 * params, enabled, home, x, y}. A hub rel also carries `rel_id`, its store
 * slot. A draft is a map node the editor holds until both ends are wired:
 * {id, map, name, x, y, from, to (node id or null)}. Positions are a node's
 * top-left in canvas units. A pinned node was placed by the editor and stays
 * when no edge touches it. Ops and links are the client-side node chains
 * (see "Typed nodes" below); they never reach the hub.
 */
export const emptyGraph = () => ({ v: 2, nodes: [], rels: [], drafts: [], ops: [], links: [] });

let seq = 0;
const newId = (p) => p + Date.now().toString(36) + (seq++).toString(36);

/** The node for a ref, added at (x, y) when the graph has none. */
export function addNode(g, ref, x = 0, y = 0) {
  const k = refKey(ref);
  let n = g.nodes.find((m) => refKey(m.ref) === k);
  if (!n) g.nodes.push((n = { id: newId('n'), ref, x, y }));
  return n;
}

/** True when `to` already reaches `from` through rels or links, enabled or not: a new from->to would close a loop. */
export function wouldLoop(g, from, to) {
  if (from === to) return true;
  const seen = new Set([to]);
  const stack = [to];
  const edges = [...g.rels, ...(g.links || [])];
  while (stack.length) {
    const at = stack.pop();
    for (const r of edges) {
      if (r.from !== at || seen.has(r.to)) continue;
      if (r.to === from) return true;
      seen.add(r.to);
      stack.push(r.to);
    }
  }
  return false;
}

/** The enabled rel or the link driving node `to`, as a name; '' when none. */
export function driverName(g, to, except = null) {
  const r = g.rels.find((x) => x !== except && x.to === to && x.enabled);
  if (r) return r.name;
  const l = (g.links || []).find((x) => x !== except && x.to === to);
  if (!l) return '';
  const o = (g.ops || []).find((x) => x.id === l.from);
  return o ? opLabel(o) : 'a node';
}

/** Why a rel from->to cannot be added, in words; '' when it can. */
export function refuseConnect(g, from, to, except = null) {
  if (wouldLoop(g, from, to)) return 'refused: feedback loop (SPEC 8.11)';
  const other = driverName(g, to, except);
  if (other) return 'refused: target already driven by "' + other + '"';
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
    id: o.id || newId('r'), name: o.name || MAPS[o.map].label, from, to, map: o.map,
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

/** Drop a rel, then every unpinned node no rel or draft touches. */
export function removeRel(g, id) {
  g.rels = g.rels.filter((r) => r.id !== id);
  const used = new Set();
  for (const x of [...g.rels, ...(g.drafts || []), ...(g.links || [])]) used.add(x.from).add(x.to);
  g.nodes = g.nodes.filter((n) => n.pinned || used.has(n.id));
}

/** Drop a node; a draft wired to it loses that end. Rels touching it are the caller's (a hub rel needs the store). */
export function removeNode(g, id) {
  g.nodes = g.nodes.filter((n) => n.id !== id);
  g.ops = (g.ops || []).filter((o) => o.id !== id);
  g.links = (g.links || []).filter((l) => l.from !== id && l.to !== id);
  for (const d of g.drafts || []) {
    if (d.from === id) d.from = null;
    if (d.to === id) d.to = null;
  }
}

/** A map node with no rel yet, at (x, y). `o`: {name?, from?, to?}. */
export function addDraft(g, map, x, y, o = {}) {
  const d = { id: newId('d'), map, name: o.name || MAPS[map].label, x, y, from: o.from ?? null, to: o.to ?? null };
  (g.drafts || (g.drafts = [])).push(d);
  return d;
}

/**
 * What wiring output socket `a` to input socket `b` does, or why it cannot:
 * {reason} or {from, to, draft, partial}. `a` and `b` are node, draft or rel
 * ids; `homeFor(fromNode, toNode)` is homeOf's answer for two nodes. A
 * partial plan sets one end of a draft; a full one makes a rel (from the
 * draft when there is one, else a linear clamp between the two nodes).
 */
export function planWire(g, a, b, homeFor) {
  const node = (id) => g.nodes.find((n) => n.id === id);
  const draft = (id) => (g.drafts || []).find((d) => d.id === id);
  if (g.rels.some((r) => r.id === a)) return { reason: 'refused: map already drives a target' };
  if (g.rels.some((r) => r.id === b)) return { reason: 'refused: map already reads a source' };
  const da = draft(a);
  const db = draft(b);
  if (da && db) return { reason: 'refused: maps do not chain (SPEC 8.11)' };
  if (!da && !node(a)) return { reason: 'refused: that output is gone' };
  if (!db && !node(b)) return { reason: 'refused: that input is gone' };
  const from = da ? da.from : a;
  const to = db ? db.to : b;
  const d = da || db || null;
  if (from == null || to == null) {
    const other = to != null && driverName(g, to);
    if (other) return { reason: 'refused: target already driven by "' + other + '"' };
    return { from, to, draft: d, partial: true };
  }
  const reason = refuseConnect(g, from, to);
  if (reason) return { reason };
  const h = homeFor(node(from), node(to));
  if (!h.home) return { reason: 'refused: ' + h.why };
  return { from, to, draft: d, partial: false };
}

/** Canvas grid pitch, in canvas units. Node positions snap to it. */
export const GRID = 20;
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

/**
 * One undo stack of opaque entries, pushed before each edit. undo and redo
 * pop an entry and keep `swap(entry)`, the current state, for the way back.
 */
export function createHistory(limit = 100) {
  const back = [];
  const fwd = [];
  const trade = (from, to, swap) => { if (!from.length) return null; const e = from.pop(); to.push(swap(e)); return e; };
  return {
    push(e) { back.push(e); if (back.length > limit) back.shift(); fwd.length = 0; },
    undo: (swap) => trade(back, fwd, swap),
    redo: (swap) => trade(fwd, back, swap),
    get canUndo() { return back.length > 0; },
    get canRedo() { return fwd.length > 0; },
  };
}

/**
 * A map's shape for its node preview: {pts: [[x, y] | null], time, x0, x1, y0, y1}.
 * A curve map's x is the input in physical units over x0..x1; a time map's
 * (slew limit, low-pass) is seconds of its response to a full step. y is the
 * output over y0..y1. A null point is a gap: a gate outside its window, where
 * the target gets its safe value.
 */
export function preview(r) {
  const p = r.params || [];
  const lo = r.out_min;
  const hi = r.out_max;
  if (r.map === M.slew_limit) {
    const span = Math.abs(hi - lo) || 1;
    const up = span / (p[0] || 1);
    const dn = span / ((p.length > 1 ? p[1] : p[0]) || 1);
    const hold = (up + dn) / 2;
    return { pts: [[0, lo], [up, hi], [up + hold, hi], [up + hold + dn, lo]], time: true, x0: 0, x1: up + hold + dn, y0: lo, y1: hi };
  }
  if (r.map === M.lowpass) {
    const tau = p[0] > 0 ? p[0] : 1;
    const pts = [];
    for (let i = 0; i <= 24; i++) pts.push([i * tau / 4.8, lo + (hi - lo) * (1 - Math.exp(-i / 4.8))]);
    return { pts, time: true, x0: 0, x1: 5 * tau, y0: lo, y1: hi };
  }
  if (r.map === M.threshold_hysteresis) {
    const a = Math.min(r.in_min, r.in_max);
    const b = Math.max(r.in_min, r.in_max);
    return { pts: [[a, lo], [p[0], lo], [p[0], hi], [b, hi], [p[1], hi], [p[1], lo]], time: false, x0: a, x1: b, y0: lo, y1: hi };
  }
  if (r.map === M.piecewise_table) {
    const pts = [];
    for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
    if (!pts.length) return { pts, time: false, x0: 0, x1: 1, y0: 0, y1: 1 };
    const ys = pts.map((q) => q[1]);
    return { pts, time: false, x0: pts[0][0], x1: pts[pts.length - 1][0], y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  let a = Math.min(r.in_min, r.in_max);
  let b = Math.max(r.in_min, r.in_max);
  if (r.map === M.gate) { const w = (b - a) / 4; a -= w; b += w; }
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const x = a + (b - a) * i / 24;
    const y = evalMap(r, {}, x, 0);
    pts.push(typeof y === 'number' ? [x, y] : null);
  }
  return { pts, time: false, x0: a, x1: b, y0: lo, y1: hi };
}

/** Lowest free hub slot, or -1 when every one of `capacity` is taken. */
export function freeRelId(g, capacity = LIMITS.relationships_max) {
  const used = new Set(g.rels.filter((r) => r.home === 'hub').map((r) => r.rel_id));
  for (let i = 0; i < capacity; i++) if (!used.has(i)) return i;
  return -1;
}

// ---------------------------------------------------------------------------
// Typed nodes: client-side chains (SPEC 11.6 client-edge rules, docs/GRAPH.md)
// ---------------------------------------------------------------------------

/**
 * Socket value types. Every value rides as a number; a bool is 0 or 1.
 * Arrays are deliberately absent (operator, 2026-10-02).
 */
export const TYPES = ['float', 'int', 'bool'];

/** Blender's implicit conversions: int to float exact, float to int rounds, bool to number 0/1, number to bool nonzero. */
export function conv(v, from, to) {
  if (typeof v !== 'number' || from === to) return v;
  if (to === 'bool') return v !== 0 ? 1 : 0;
  if (to === 'int') return Math.round(v);
  return v;
}

/** Blender's safe math: an undefined result (NaN, infinity) is 0. */
const fin = (y) => (Number.isFinite(y) ? y : 0);
const fn = (label, n, f) => ({ label, n, f });

/** Math operations: label, inputs used, function. */
export const MATH = {
  add: fn('Add', 2, (a, b) => a + b),
  subtract: fn('Subtract', 2, (a, b) => a - b),
  multiply: fn('Multiply', 2, (a, b) => a * b),
  divide: fn('Divide', 2, (a, b) => (b === 0 ? 0 : a / b)),
  power: fn('Power', 2, (a, b) => a ** b),
  minimum: fn('Minimum', 2, Math.min),
  maximum: fn('Maximum', 2, Math.max),
  absolute: fn('Absolute', 1, Math.abs),
  round: fn('Round', 1, (a) => Math.floor(a + 0.5)),
  floor: fn('Floor', 1, Math.floor),
  ceil: fn('Ceil', 1, Math.ceil),
  modulo: fn('Modulo', 2, (a, b) => (b === 0 ? 0 : a % b)),
  sqrt: fn('Square root', 1, (a) => (a > 0 ? Math.sqrt(a) : 0)),
  sine: fn('Sine', 1, Math.sin),
  cosine: fn('Cosine', 1, Math.cos),
};

/** Compare operations; equal and not equal take the epsilon input. */
export const COMPARE = {
  lt: fn('Less than', 2, (a, b) => a < b),
  le: fn('Less or equal', 2, (a, b) => a <= b),
  eq: fn('Equal', 3, (a, b, e) => Math.abs(a - b) <= e),
  ne: fn('Not equal', 3, (a, b, e) => Math.abs(a - b) > e),
  ge: fn('Greater or equal', 2, (a, b) => a >= b),
  gt: fn('Greater than', 2, (a, b) => a > b),
};

/** Boolean Math operations, on booleans. */
export const LOGIC = {
  and: fn('And', 2, (a, b) => a && b),
  or: fn('Or', 2, (a, b) => a || b),
  not: fn('Not', 1, (a) => !a),
  xor: fn('Xor', 2, (a, b) => a !== b),
  nand: fn('Nand', 2, (a, b) => !(a && b)),
  nor: fn('Nor', 2, (a, b) => !(a || b)),
};

const pin = (name, label, type, def, fixed = false) => ({ name, label, type, def, fixed });
/** A Switch arm: typed by the node's own `type`. */
const arm = (name, label, def) => ({ ...pin(name, label, 'float', def), arm: true });
const V = (def = 0) => pin('v', 'Value', 'float', def);

/**
 * Node kinds, one per family with an operation dropdown (`fns`). `ins` are
 * input sockets with editable defaults; a `fixed` input is a value with no
 * socket (the Input nodes). `cat` is the add menu's category.
 */
export const OPS = {
  value: { label: 'Value', cat: 'Input', out: 'float', ins: [pin('v', 'Value', 'float', 0.5, true)] },
  integer: { label: 'Integer', cat: 'Input', out: 'int', ins: [pin('v', 'Integer', 'int', 1, true)] },
  boolean: { label: 'Boolean', cat: 'Input', out: 'bool', ins: [pin('v', 'Boolean', 'bool', 1, true)] },
  math: { label: 'Math', cat: 'Math', out: 'float', fns: MATH, fn: 'add', ins: [pin('a', 'A', 'float', 0), pin('b', 'B', 'float', 0)] },
  clamp: { label: 'Clamp', cat: 'Math', out: 'float', ins: [V(), pin('min', 'Min', 'float', 0), pin('max', 'Max', 'float', 1)] },
  map_range: { label: 'Map Range', cat: 'Math', out: 'float', ins: [V(), pin('from_min', 'From min', 'float', 0),
    pin('from_max', 'From max', 'float', 1), pin('to_min', 'To min', 'float', 0), pin('to_max', 'To max', 'float', 1)] },
  compare: { label: 'Compare', cat: 'Logic', out: 'bool', fns: COMPARE, fn: 'gt',
    ins: [pin('a', 'A', 'float', 0), pin('b', 'B', 'float', 0), pin('eps', 'Epsilon', 'float', 0.001)] },
  bool_math: { label: 'Boolean Math', cat: 'Logic', out: 'bool', fns: LOGIC, fn: 'and', ins: [pin('a', 'A', 'bool', 0), pin('b', 'B', 'bool', 0)] },
  switch: { label: 'Switch', cat: 'Logic', out: 'float', ins: [pin('s', 'Switch', 'bool', 0), arm('f', 'False', 0), arm('t', 'True', 1)] },
  gate: { label: 'Gate', cat: 'Logic', out: 'float', ins: [V(), pin('open', 'Open', 'bool', 1)] },
  threshold: { label: 'Threshold', cat: 'Converter', out: 'bool', ins: [V(), pin('on', 'On above', 'float', 0.6), pin('off', 'Off below', 'float', 0.4)] },
  slew: { label: 'Slew', cat: 'Converter', out: 'float', ins: [V(), pin('rise', 'Rise per s', 'float', 1), pin('fall', 'Fall per s', 'float', 1)] },
  lowpass: { label: 'Low-pass', cat: 'Converter', out: 'float', ins: [V(), pin('tau', 'Tau (s)', 'float', 0.5)] },
};

/** An op node's output type: a Switch carries its own `type`. */
export const outOf = (o) => (o.kind === 'switch' ? o.type || 'float' : OPS[o.kind].out);

/** An op node's live input sockets: those its operation uses, typed for a Switch. */
export function insOf(o) {
  const spec = OPS[o.kind];
  let ins = spec.fns ? spec.ins.slice(0, (spec.fns[o.fn] || spec.fns[spec.fn]).n) : spec.ins;
  if (o.kind === 'switch') ins = ins.map((p) => (p.arm ? { ...p, type: outOf(o) } : p));
  return ins;
}

/** A node's title: its operation where it has one, as Blender titles a Math node "Add". */
export const opLabel = (o) => (OPS[o.kind].fns ? (OPS[o.kind].fns[o.fn] || {}).label || OPS[o.kind].label : OPS[o.kind].label);

/** An unlinked input's value: the node's own, else the default, as its socket's type. */
export const valueOf = (o, p) => conv(Number(o.vals?.[p.name] ?? p.def), 'float', p.type);

/** Add an op node of `kind` at (x, y). */
export function addOp(g, kind, x = 0, y = 0) {
  const spec = OPS[kind];
  const o = { id: newId('o'), kind, x, y, vals: {} };
  if (spec.fns) o.fn = spec.fn;
  if (kind === 'map_range') o.clamp = true;
  if (kind === 'switch') o.type = 'float';
  (g.ops || (g.ops = [])).push(o);
  return o;
}

/**
 * What linking output `from` to input `to` (port `port` on an op, none on a
 * target node) does, or why it cannot: {reason} or {from, to, port, replace}.
 * The caller checks a node end is a source or a target.
 */
export function planLink(g, from, to, port) {
  const op = (id) => (g.ops || []).find((o) => o.id === id);
  const map = (id) => g.rels.some((r) => r.id === id) || (g.drafts || []).some((d) => d.id === id);
  if (map(from) || map(to)) return { reason: 'refused: maps join two fields (SPEC 8.11)' };
  const t = op(to);
  if (t && !insOf(t).some((p) => p.name === port && !p.fixed)) return { reason: 'refused: no such input' };
  if (!op(from) && !g.nodes.some((n) => n.id === from)) return { reason: 'refused: that output is gone' };
  if (!t && !g.nodes.some((n) => n.id === to)) return { reason: 'refused: that input is gone' };
  if (wouldLoop(g, from, to)) return { reason: 'refused: would loop' };
  const key = t ? port : undefined;
  if (!t) {
    const r = g.rels.find((x) => x.to === to && x.enabled);
    if (r) return { reason: 'refused: target already driven by "' + r.name + '"' };
  }
  const replace = (g.links || []).find((l) => l.to === to && l.port === key) || null;
  return { from, to, port: key, replace };
}

/** Apply a planLink plan: the link it replaces goes. */
export function addLink(g, p) {
  g.links = (g.links || []).filter((l) => l !== p.replace);
  const l = { id: newId('l'), from: p.from, to: p.to };
  if (p.port != null) l.port = p.port;
  g.links.push(l);
  return l;
}

/** The ops in evaluation order (Kahn); an op on a cycle is left out. */
export function topo(g) {
  const ops = g.ops || [];
  const deg = new Map(ops.map((o) => [o.id, 0]));
  const next = new Map(ops.map((o) => [o.id, []]));
  for (const l of g.links || []) {
    if (!deg.has(l.from) || !deg.has(l.to)) continue;
    deg.set(l.to, deg.get(l.to) + 1);
    next.get(l.from).push(l.to);
  }
  const ready = ops.filter((o) => deg.get(o.id) === 0).map((o) => o.id);
  const out = [];
  while (ready.length) {
    const id = ready.shift();
    out.push(id);
    for (const t of next.get(id)) { deg.set(t, deg.get(t) - 1); if (!deg.get(t)) ready.push(t); }
  }
  const byId = new Map(ops.map((o) => [o.id, o]));
  return out.map((id) => byId.get(id));
}

/** One op's output from its inputs `x` (by name). `s` is its state, `dt` seconds since the last tick. */
export function evalOp(o, x, s, dt) {
  switch (o.kind) {
    case 'value': case 'integer': case 'boolean': return x.v;
    case 'math': return fin((MATH[o.fn] || MATH.add).f(x.a, x.b));
    case 'clamp': return Math.min(Math.max(x.v, x.min), x.max);
    case 'map_range': {
      const f = x.from_max !== x.from_min ? (x.v - x.from_min) / (x.from_max - x.from_min) : 0;
      const y = x.to_min + f * (x.to_max - x.to_min);
      return o.clamp === false ? y : clamp(y, Math.min(x.to_min, x.to_max), Math.max(x.to_min, x.to_max));
    }
    case 'compare': return (COMPARE[o.fn] || COMPARE.gt).f(x.a, x.b, x.eps) ? 1 : 0;
    case 'bool_math': return (LOGIC[o.fn] || LOGIC.and).f(x.a !== 0, x.b !== 0) ? 1 : 0;
    case 'switch': return x.s ? x.t : x.f;
    case 'gate': return x.open ? x.v : SAFE;
    case 'threshold': return hysteresis(s, x.v, x.on, x.off) ? 1 : 0;
    case 'slew': return slewStep(s, x.v, Math.max(0, x.rise), Math.max(0, x.fall), dt);
    case 'lowpass': return lowpassStep(s, x.v, x.tau, dt);
    default: return undefined;
  }
}

/**
 * Every op's output this tick, in topological order. `io.read(ref)` and
 * `io.type(ref)` answer for field and buttplug nodes; `state(id, kind)` is an
 * op's own state object. Returns {val, why}: an op whose linked input has no
 * value outputs nothing (undefined), with the reason in `why`. A Gate's
 * closed output (SAFE) passes through every op downstream but a Switch's
 * unchosen arm.
 */
export function evalChains(g, io, state, dt) {
  const val = new Map();
  const why = new Map();
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const ops = new Map((g.ops || []).map((o) => [o.id, o]));
  const into = new Map();
  for (const l of g.links || []) into.set(l.to + ':' + l.port, l);
  for (const o of topo(g)) {
    const x = {};
    let miss = '';
    let safe = false;
    for (const p of insOf(o)) {
      const l = !p.fixed && into.get(o.id + ':' + p.name);
      if (!l) { x[p.name] = valueOf(o, p); continue; }
      const up = ops.get(l.from);
      const n = !up && nodes.get(l.from);
      let v = up ? val.get(up.id) : n ? io.read(n.ref) : undefined;
      if (v === SAFE) { x[p.name] = SAFE; safe = true; continue; }
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        miss = (up && why.get(up.id)) || 'disarmed: ' + opLabel(o) + ' has no ' + p.label.toLowerCase();
        break;
      }
      x[p.name] = conv(v, up ? outOf(up) : io.type(n.ref), p.type);
    }
    if (miss) { why.set(o.id, miss); continue; }
    if (o.kind === 'switch') { val.set(o.id, x.s === SAFE ? SAFE : x.s ? x.t : x.f); continue; }
    if (safe) { val.set(o.id, SAFE); continue; }
    val.set(o.id, evalOp(o, x, state(o.id, o.kind), dt));
  }
  return { val, why };
}

// ---------------------------------------------------------------------------
// Local storage: client edges, and where every node sits
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'phosphor.graph';

/**
 * The graph as stored: nodes, drafts, client rels, ops and links, hub rels'
 * positions by rel_id, and the editor's view {x, y, k}. Hub rels' truth is
 * the hub. Version 2 added ops and links; a version 1 graph loads with none.
 */
export function saveLocal(storage, g, view = null) {
  const pos = {};
  for (const r of g.rels) if (r.home === 'hub') pos[r.rel_id] = [r.x, r.y];
  const out = { v: 2, nodes: g.nodes, rels: g.rels.filter((r) => r.home === 'client'), drafts: g.drafts || [],
    ops: g.ops || [], links: g.links || [], hubPos: pos, view };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch (e) { /* private mode: the graph lives for this run */ }
}

export function loadLocal(storage) {
  try {
    const o = JSON.parse(storage.getItem(STORAGE_KEY));
    if (o && (o.v === 1 || o.v === 2) && Array.isArray(o.nodes) && Array.isArray(o.rels)) {
      const v = o.view;
      const ops = Array.isArray(o.ops) ? o.ops.filter((x) => OPS[x.kind]) : [];
      const ids = new Set([...o.nodes, ...ops].map((x) => x.id));
      return {
        v: 2, nodes: o.nodes, rels: o.rels.filter((r) => r.home === 'client' && MAPS[r.map]),
        drafts: Array.isArray(o.drafts) ? o.drafts.filter((d) => MAPS[d.map]) : [],
        ops, links: Array.isArray(o.links) ? o.links.filter((l) => ids.has(l.from) && ids.has(l.to)) : [],
        hubPos: o.hubPos || {}, view: v && [v.x, v.y, v.k].every(Number.isFinite) && v.k > 0 ? v : null,
      };
    }
  } catch (e) { /* absent or unreadable: start empty */ }
  return { ...emptyGraph(), hubPos: {}, view: null };
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
 * are found by their RFC-089 roles (store.slot, store.name, store.item), or on
 * a writer without them by type: the one unroled uint, tstr and bstr beside the
 * action.store op select.
 */
export function findHub(entries, coreId, CBOR) {
  const store = entries.find((e) => e.id === coreId && e.store);
  if (!store) return { reason: 'no relationships store on this hub' };
  const sid = store.store.storeId;
  const roster = entries.find((e) => e.storeId === sid && e.layout) || null;
  const writer = entries.find((e) => e.storeId === sid && e.schema && e.schema.some((f) => f.role === 'action.store'));
  if (!writer) return { reason: 'no writer for the relationships store' };
  const plain = writer.schema.filter((f) => !f.role);
  const one = (role, t) => {
    const hit = writer.schema.find((f) => f.role === role);
    if (hit) return hit;
    const typed = plain.filter((f) => f.type === t);
    return typed.length === 1 ? typed[0] : null;
  };
  const op = writer.schema.find((f) => f.role === 'action.store');
  const item = one('store.item', CBOR.bstr_t);
  if (!item) return { reason: 'relationships writer has no fillable item field' };
  return { store, roster, writer, op, slot: one('store.slot', CBOR.uint_t), name: one('store.name', CBOR.tstr_t), item };
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
 * Evaluates every enabled client rel and every node chain each `step`. `io`:
 *   read(ref)   -> source value in its physical units, or undefined
 *   type(ref)   -> 'float' | 'int' | 'bool' (absent: float)
 *   target(ref) -> {min?, max?, step?, integer?, safe?} or null when absent
 *   write(ref, value)
 *   armed()     -> {ok, why} (interlock())
 * Writes a target only when the output moved by its step (any change when it
 * declares none), as SPEC 8.11 evaluation does. A chain whose input has no
 * value disarms its target: the safe value once, and the reason.
 */
export function createRunner(io) {
  const st = new Map();
  let was = false;
  let last = 0;
  let vals = new Map();
  const typeOf = (ref) => (io.type ? io.type(ref) : 'float');

  /** Clamp into the target and write when moved by its step. */
  function drive(ref, t, s, out) {
    if (out === SAFE) out = t.safe;
    if (typeof out !== 'number' || !Number.isFinite(out)) return;
    if (t.min != null) out = Math.max(t.min, out);
    if (t.max != null) out = Math.min(t.max, out);
    if (t.integer) out = Math.round(out);
    if (s.last !== undefined && (t.step ? Math.abs(out - s.last) < t.step : out === s.last)) return;
    s.last = out;
    io.write(ref, out);
  }

  function step(g, now) {
    const a = io.armed();
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const ops = new Map((g.ops || []).map((o) => [o.id, o]));
    const mine = g.rels.filter((r) => r.home === 'client' && r.enabled && byId.has(r.from) && byId.has(r.to));
    const chains = (g.links || []).filter((l) => byId.has(l.to) && ops.has(l.from));
    if (!a.ok) {
      if (was) {
        for (const id of new Set([...mine.map((r) => r.to), ...chains.map((l) => l.to)])) {
          const t = io.target(byId.get(id).ref);
          if (t && t.safe != null) io.write(byId.get(id).ref, t.safe);
        }
      }
      was = false;
      st.clear();
      vals = new Map();
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
      drive(to, t, s, evalMap(r, s.m, x, dt));
    }
    const state = (id, kind) => {
      let s = st.get('o:' + id);
      if (!s || s.kind !== kind) st.set('o:' + id, (s = { kind, m: {} }));
      return s.m;
    };
    const ch = evalChains(g, { read: io.read, type: typeOf }, state, dt);
    vals = ch.val;
    for (const l of chains) {
      const n = byId.get(l.to);
      const t = io.target(n.ref);
      const k = 'c:' + n.id;
      if (!st.has(k)) st.set(k, { last: undefined, why: '' });
      const s = st.get(k);
      const v = ch.val.get(l.from);
      if (v === undefined) {
        s.why = ch.why.get(l.from) || 'disarmed: no input';
        if (s.last !== undefined && t && t.safe != null) io.write(n.ref, t.safe);
        s.last = undefined;
        continue;
      }
      s.why = '';
      if (t) drive(n.ref, t, s, conv(v, outOf(ops.get(l.from)), typeOf(n.ref)));
    }
    return a;
  }

  return {
    step,
    /** The output last written for rel `id`, or for chain target node `id`, while armed; undefined otherwise. */
    out: (id) => (st.get(id) || st.get('c:' + id))?.last,
    /** An op's output this tick, while armed (SAFE while a Gate is closed). */
    val: (id) => vals.get(id),
    /** Why a chain's target node is not driven, in words; '' when it is. */
    why: (id) => st.get('c:' + id)?.why || '',
    reset: () => { st.clear(); was = false; last = 0; vals = new Map(); },
  };
}
