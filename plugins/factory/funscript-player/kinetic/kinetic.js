// kinetic.js -- the machine's own planner (Nucleus tools/kinetic-wasm, pinned in kinetic.pin) in a Worker
// Contract: CONTRACT.md, module kinetic (ph-ge35); design: docs/plugins/FUNSCRIPT.md (Kinetic).
//
// Constraints:
// - The wasm is bytes.js, base64 in a module, never a fetched file: an override copy of the plugin is one
//   file (ruling R-C) and connect-src refuses a plugin's fetch. Compiling it needs 'wasm-unsafe-eval'.
// - renderCore, instantiate and versionOf are stringified into the worker: each may reference nothing
//   outside its own body (the shell build renames module bindings).
// - Segments are submitted as the host sends them, LEAD_MS before their start (half the 250 ms horizon),
//   and the clock steps at stepMs (the board ticks at 1 ms). Same calls in, same bits out (kinetic-trace test).
// - A newer render supersedes: the older one resolves null and its handle is destroyed at its next chunk.
// - Kinetic² only: the worker refuses a module whose kinetic_version() does not name kinetic2.
// - TUNING mirrors kinetic_tuning (64 B) by member name; a catalog field binds by that name, and a
//   name ending _ms binds its _us member times 1000. A member no field names keeps the factory value.
//   Members Kinetic² ignores (chase_*, handoff_k, ...) stay bound so the struct is written whole.

import { applyT, knotSlope, wireVel, dwellMerge } from '../scheduler.js';
import { WASM } from './bytes.js';

export const LEAD_MS = 125, PREROLL_MS = 1200, TAIL_MS = 1000, EVERY = 5;
export const TUNING = Object.freeze([['jmax_ovr', 0, 'f'], ['vmax_ovr', 4, 'f'], ['amax_ovr', 8, 'f'], ['chase_gain', 12, 'f'],
  ['chase_lookahead', 16, 'f'], ['handoff_k', 20, 'f'], ['smooth_budget', 24, 'f'], ['amplitude_budget', 28, 'f'],
  ['overshoot_guard', 32, 'f'], ['chase_dense_us', 36, 'u'], ['settle_grace_us', 40, 'u'], ['chase_ff', 44, 'b'],
  ['chase_accel_ff', 45, 'b'], ['chase_aim_extrap', 46, 'b'], ['curve_policy', 47, 'b'], ['infeasible_policy', 48, 'b'],
  ['blend_steps', 49, 'b'], ['lookahead_us', 52, 'u'], ['corner', 56, 'b'], ['react_us', 60, 'u']]);
export const FLAGS = Object.freeze(['busy', 'shaped', 'fallback', 'clamped', 'refused']);
// kinetic2::AnomalyKind by bit; reserved kinds are blank. 'piece over ceiling' renders: never a drop.
export const ANOMALIES = Object.freeze(['', 'plan failed', 'settle', 'end velocity clamped', 'deadline stretched',
  '', 'waveform scaled', '', '', '', 'dwell zeroed', 'knot refused', 'piece over ceiling']);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** [[member, offset, type, value]] from [field, value] pairs: by member name, an _ms field to its _us member. */
export function tuningOf(pairs) {
  const out = [];
  for (const [f, v] of pairs) {
    const n = f && f.name, x = Number(v);
    if (!n || v == null || v === '' || !Number.isFinite(x)) continue;
    const t = TUNING.find((m) => m[0] === n) || (n.endsWith('_ms') && TUNING.find((m) => m[0] === n.slice(0, -3) + '_us'));
    if (t) out.push([...t, t[0] === n ? x : x * 1000]);
  }
  return out;
}

/**
 * The script as the render's segments [startMs, pos_e4, durMs, endVelE3, family] on the engine clock, and
 * t0, the media ms of engine 0: a preroll to the first knot arriving at media 0, then one segment per span.
 * The scheduler's knots (dwellMerge); each span ends at its endVel at rate 1 (knotSlope, wireVel), packed as the host packs it.
 * The preroll is submitted LEAD_MS in: the window set parks and reseeds on the first tick, dropping
 * anything queued before it.
 */
export function segmentsOf(script, T) {
  script = dwellMerge(script, T);
  const pad = 2 * LEAD_MS + PREROLL_MS, { at, pos } = script;
  const e4 = (n) => Math.round(clamp(applyT(n, T), 0, 1) * 10000);
  const t = (j) => at[j], p = (j) => pos[j], vel = script.vel ? (j) => script.vel[j] : null;
  const e3 = (k) => { const v = clamp(wireVel(knotSlope(t, p, k, at.length, vel), T) * 1000, -32767, 32767); return Math.sign(v) * Math.round(Math.abs(v)); };
  const segs = [[2 * LEAD_MS, e4(pos[0]), PREROLL_MS, 0, 0]];
  for (let k = 1; k < at.length; k++) if (at[k] > at[k - 1]) segs.push([pad + at[k - 1], e4(pos[k]), at[k] - at[k - 1], e3(k), 0]);
  return { segs, t0: (T.offsetMs || 0) - pad, steps: Math.ceil(pad + at[at.length - 1] + TAIL_MS) };
}

/**
 * q: {limits: {vmax, amax, jmax, rail, horizonMs}, window: [lo, hi] mm, tuning: tuningOf(), segs,
 * steps, stepMs = 1, every = 1, leadMs = LEAD_MS}. Yields between chunks; returns position_mm,
 * velocity_mm_s, accel_mm_s2 and raw (the plan's p, a window share before the window clamp: overshoot
 * included) every `every` steps, the flags ORed over each, and counts over every step.
 */
export function* renderCore(k, q) {
  const L = q.limits, h = k.kinetic_create(L.vmax, L.amax, L.jmax, L.rail, L.horizonMs || 0);
  if (!h) throw new Error('limits refused');
  const out = k.malloc(64), tb = k.malloc(64);
  try {
    if (q.window && k.kinetic_set_window(h, q.window[0], q.window[1]) !== 1) throw new Error('window refused');
    const dv = new DataView(k.memory.buffer);
    k.kinetic_default_tuning(tb);
    for (const [, off, type, v] of q.tuning || []) {
      if (type === 'f') dv.setFloat32(tb + off, v, true);
      else if (type === 'u') dv.setUint32(tb + off, Math.max(0, Math.round(v)), true);
      else dv.setUint8(tb + off, Math.max(0, Math.min(255, Math.round(v))));
    }
    k.kinetic_set_tuning(h, tb);
    const step = q.stepMs || 1, every = Math.max(1, q.every | 0), lead = q.leadMs ?? 125, n = Math.ceil(q.steps / every);
    const pos = new Float32Array(n), vel = new Float32Array(n), acc = new Float32Array(n), raw = new Float32Array(n), flags = new Uint8Array(n);
    const anomalies = new Uint32Array(32), counts = new Uint32Array(5), segs = q.segs;
    let next = 0, accepted = 0, refused = 0;
    for (let i = 0; i < q.steps; i++) {
      for (; next < segs.length && segs[next][0] - lead <= i * step; next++) {
        const s = segs[next], r = k.kinetic_submit_segment(h, s[1], s[2], s[3], Math.round(s[0] * 1000), s[4]);
        if (r === 1) accepted++; else if (r === 0) refused++;
      }
      k.kinetic_step(h, step / 1000, out);
      const j = (i / every) | 0, f = dv.getUint8(out + 58);
      if (i % every === 0) {
        pos[j] = dv.getFloat32(out + 44, true); vel[j] = dv.getFloat32(out + 36, true); acc[j] = dv.getFloat32(out + 40, true);
        raw[j] = dv.getFloat64(out + 8, true);
      }
      flags[j] |= f;
      for (let b = 0; b < 5; b++) if ((f >> b) & 1) counts[b]++;
      for (let a = dv.getUint32(out + 52, true); a; a &= a - 1) anomalies[31 - Math.clz32(a & -a)]++;
      if ((i & 8191) === 8191) yield i;
    }
    return { pos, vel, acc, raw, flags, anomalies, counts, accepted, refused, plans: dv.getUint32(out + 60, true) };
  } finally {
    k.free(out);
    k.free(tb);
    k.kinetic_destroy(h);
  }
}

/** The instantiated exports from bytes.js (node and tests; the worker decodes its own copy). */
export async function instantiate(b64 = WASM) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const k = (await WebAssembly.instantiate(bytes, {})).instance.exports;
  k._initialize();
  return k;
}

/** kinetic_version() of an instance. */
export function versionOf(k) {
  const m = new Uint8Array(k.memory.buffer), p = k.kinetic_version();
  let e = p;
  while (m[e]) e++;
  return new TextDecoder().decode(m.subarray(p, e));
}

const SRC = `'use strict';
const renderCore = ${renderCore};
const instantiate = ${instantiate};
const versionOf = ${versionOf};
let k = null, latest = 0;
onmessage = async (e) => {
  const q = e.data;
  if (q.wasm) {
    try {
      const m = await instantiate(q.wasm), v = versionOf(m);
      if (!/ kinetic2 /.test(v)) throw new Error('not a Kinetic² build: ' + v);
      k = m;
      postMessage({ ready: v });
    } catch (err) { postMessage({ error: String(err && err.message || err) }); }
    return;
  }
  latest = q.id;
  if (!k) { postMessage({ id: q.id, error: 'Kinetic not ready' }); return; }
  const t = performance.now(), it = renderCore(k, q);
  try {
    for (;;) {
      const r = it.next();
      if (r.done) {
        const v = r.value;
        postMessage({ id: q.id, ms: performance.now() - t, ...v }, [v.pos.buffer, v.vel.buffer, v.acc.buffer, v.raw.buffer, v.flags.buffer]);
        return;
      }
      await new Promise((go) => setTimeout(go));
      if (latest !== q.id) { it.return(); return; }
    }
  } catch (err) { postMessage({ id: q.id, error: String(err && err.message || err) }); }
};`;

/**
 * -> {ready: Promise<version>, render(q) -> Promise<result | {error} when refused | null when superseded>,
 * close()}. Rejects (ready and every render) when the worker cannot start or the wasm does not compile.
 * A render is posted only after ready: the worker's onmessage is async, so a render sent during the
 * init's await would run against no instance.
 */
export function createKinetic() {
  const url = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  let seq = 0, pending = null, dead = null, onReady, onFail;
  const ready = new Promise((res, rej) => { onReady = res; onFail = rej; });
  ready.catch(() => {});
  const die = (msg) => {
    dead = new Error(msg);
    onFail(dead);
    if (pending) { pending.rej(dead); pending = null; }
  };
  w.onerror = (e) => { e.preventDefault(); die(e.message || 'worker failed'); };
  w.onmessage = (e) => {
    const r = e.data;
    if ('ready' in r) return onReady(r.ready);
    if (r.error && r.id == null) return die(r.error);
    if (!pending || r.id !== pending.id) return;
    const p = pending;
    pending = null;
    p.res(r);
  };
  w.postMessage({ wasm: WASM });
  return {
    ready,
    render(q) {
      if (dead) return Promise.reject(dead);
      if (pending) pending.res(null);
      const id = ++seq;
      return new Promise((res, rej) => {
        pending = { id, res, rej };
        ready.then(() => { if (pending && pending.id === id) w.postMessage({ ...q, id }); }, () => {});
      });
    },
    close() { w.terminate(); if (pending) pending.res(null); pending = null; dead = dead || new Error('closed'); },
  };
}
