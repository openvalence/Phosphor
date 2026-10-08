// interp.js -- the curve between actions: ten modes, a smoothing window and a slew limit; shape() turns a
// Script into the dense knots the scheduler and timeline already run on.
// Contract: CONTRACT.md, module interp (ph-smvd.10); design: docs/plugins/FUNSCRIPT.md, Interpolation.
//
// Portions ported from MultiFunPlayer (https://github.com/Yoooi0/MultiFunPlayer),
// Source/MultiFunPlayer/Common/Utils/MathUtils.cs (CubicHermite, PchipSlopes, MakimaSlopes),
// commit 36c08fbb99ac9398a63ff1cca1bbf68cd2228a94.
// Copyright (c) 2020 Yoooi. MIT License:
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Constraints:
// - wire() is what the scheduler sends: one knot per action, never the resampled curve (SPEC 9.6 item 5,
//   intent not pre-chewed motion: the hub draws between knots from their end velocities). Linear with
//   smoothing and slew off returns the Script itself, so the scheduler runs byte-identical.
// - shape() is display only (timeline, heat, speed meter, the over-limit check): each span resampled into
//   pieces of at most STEP_MS (original knots kept), collinear knots merged back (spans <= MAX_SPAN_MS).
// - Cubic modes start and end the script at rest (MFP's flat phantom knots). Makima uses the symmetric
//   phantom for its second chord, not MFP's pm2 quirk (FUNSCRIPT-MFP-NOTES.md), so it matches MFP on every
//   span from the third on and rests at the first knot.
// - Values are clamped to 0..1 after each mode; monotone, PCHIP, smoothstep, cosine and step never leave
//   their two knots.
// - Order: mode, then smoothing (a centered box over the piecewise-linear curve, no lag), then slew (causal:
//   a reversal past the limit arrives late and short). Slew needs the rail length; without it slew is off.
// - wire() carries `vel`, the mode's slope at each action (pos per ms; 0 for step, smoothstep and cosine;
//   null for linear), only while no filter is on. With smoothing or slew each action takes the filtered
//   curve's value there and vel is null: the scheduler reads the knots' chords.
// - Every action takes the affine map p' = (p - lower) / (upper - lower) before the mode: [lower, upper] is
//   interp.map when set (Auto's fit, fitMap), else the symmetric gain's [0.5 - 0.5 / scale, 0.5 + 0.5 / scale].
//   shape() and wire() both run on the mapped actions, so the drawn curve, the wire and the Kinetic preview
//   agree; sample() is unmapped. scaleAuto is the controller's (ui.js): it fits the map and passes it in.
// - Pure, no DOM at import time; mountInterp touches the DOM only when called.

import { posAt, indexAfter, MAX_SPAN_MS } from './funscript.js';

export const STEP_MS = 40;
const MERGE_EPS = 1e-4;

/** Mode id -> its one parameter key, or null. Order is the menu order. */
export const MODES = Object.freeze({
  linear: null, step: null, smoothstep: null, cosine: null, catmull: 'tension', hermite: 'bias',
  monotone: null, pchip: null, akima: null, makima: null,
});
export const RANGES = Object.freeze({
  tension: Object.freeze({ min: 0, max: 1, step: 0.05 }),
  bias: Object.freeze({ min: -1, max: 1, step: 0.05 }),
  smoothMs: Object.freeze({ min: 0, max: 500, step: 10 }),
  slewMmS: Object.freeze({ min: 0, max: 2000, step: 10 }),
  scale: Object.freeze({ min: 0.25, max: 1, step: 0.01 }),
});
export const INTERP = Object.freeze({ mode: 'linear', tension: 0, bias: 0, smoothMs: 0, slewMmS: 0, scale: 1, scaleAuto: true });
/** How far past 0..1 a fit reaches: the floor gain's. */
const REACH = 0.5 / RANGES.scale.min - 0.5;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Any value -> a well-formed interp: an unknown mode is linear, numbers are clamped to RANGES, map kept only when it is a fit. */
export function cleanInterp(v) {
  const s = v && typeof v === 'object' ? v : {};
  const num = (k) => (typeof s[k] === 'number' && Number.isFinite(s[k]) ? clamp(s[k], RANGES[k].min, RANGES[k].max) : INTERP[k]);
  const m = s.map, fit = Array.isArray(m) && m[0] <= 0 && m[0] >= -REACH && m[1] >= 1 && m[1] <= 1 + REACH;
  return { mode: Object.hasOwn(MODES, s.mode) ? s.mode : 'linear',
    tension: num('tension'), bias: num('bias'), smoothMs: num('smoothMs'), slewMmS: num('slewMmS'), scale: num('scale'),
    scaleAuto: typeof s.scaleAuto === 'boolean' ? s.scaleAuto : INTERP.scaleAuto, ...(fit ? { map: [m[0], m[1]] } : {}) };
}

/** [lower, upper], the script values the window's 0 and 1 take: interp.map, else the symmetric gain's. */
export const mapOf = (I) => I.map || [0.5 - 0.5 / I.scale, 0.5 + 0.5 / I.scale];

/** The actions through mapOf(I); the script itself at [0, 1]. */
function scaled(script, I) {
  const [a, b] = mapOf(I);
  return a === 0 && b === 1 ? script : { ...script, pos: Float32Array.from(script.pos, (p) => (p - a) / (b - a)) };
}

/**
 * An extent [min, max] at scale 1 -> the map that pulls in only the ends past 0..1, on the 0.01 grid, at most REACH
 * out. An end within 1e-4 of the grid stays on it: the planner's e4 positions and float32 shares carry that much noise.
 */
export function fitMap([lo, hi]) {
  const a = Number.isFinite(lo) ? Math.floor(Math.min(0, lo) * 100 + 0.01) / 100 : 0;
  const b = Number.isFinite(hi) ? Math.ceil(Math.max(1, hi) * 100 - 0.01) / 100 : 1;
  return [Math.max(-REACH, a), Math.min(1 + REACH, b)];
}

// ---- slopes, pos per ms, one per knot -----------------------------------------

function slopes(at, pos, I) {
  const n = at.length, m = new Float64Array(n);
  const D = (i) => (i < 0 || i >= n - 1 ? 0 : (pos[i + 1] - pos[i]) / (at[i + 1] - at[i]));
  const mode = I.mode;
  for (let k = 1; k < n - 1; k++) {
    const a = D(k - 1), b = D(k);
    let s;
    if (mode === 'catmull') s = (1 - I.tension) * (pos[k + 1] - pos[k - 1]) / (at[k + 1] - at[k - 1]);
    else if (mode === 'hermite') s = ((1 + I.bias) * a + (1 - I.bias) * b) / 2;
    else if (mode === 'monotone') s = a * b <= 0 ? 0 : (a + b) / 2;
    else if (mode === 'pchip') {
      // MFP PchipSlopes
      const h0 = at[k] - at[k - 1], h1 = at[k + 1] - at[k];
      const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
      s = (w1 + w2) / (w1 / a + w2 / b);
      if (!Number.isFinite(s) || a * b < 0) s = 0;
    } else if (mode === 'akima') {
      const m0 = D(k - 2), m3 = D(k + 1), w1 = Math.abs(m3 - b), w2 = Math.abs(a - m0);
      s = w1 + w2 > 0 ? (w1 * a + w2 * b) / (w1 + w2) : (a + b) / 2;
    } else {
      // MFP MakimaSlopes
      const m0 = D(k - 2), m3 = D(k + 1);
      const w1 = Math.abs(m3 - b) + Math.abs(m3 + b) / 2, w2 = Math.abs(a - m0) + Math.abs(a + m0) / 2;
      s = (w1 * a + w2 * b) / (w1 + w2);
      if (!Number.isFinite(s)) s = 0;
    }
    m[k] = s;
  }
  if (mode === 'monotone') {
    // Fritsch-Carlson: a flat span rests at both ends; alpha^2 + beta^2 <= 9 keeps each span monotone.
    for (let i = 0; i < n - 1; i++) {
      const d = D(i);
      if (d === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d, b = m[i + 1] / d, r = a * a + b * b;
      if (r > 9) { const t = 3 / Math.sqrt(r); m[i] = t * a * d; m[i + 1] = t * b * d; }
    }
  }
  return m;
}

// MFP Interpolation.CubicHermite
function hermite(x0, y0, x1, y1, s0, s1, x) {
  const d = x1 - x0, dx = x - x0, t = dx / d, r = 1 - t;
  return r * r * (y0 * (1 + 2 * t) + s0 * dx) + t * t * (y1 * (3 - 2 * t) - d * s1 * r);
}

const CUBIC = new Set(['catmull', 'hermite', 'monotone', 'pchip', 'akima', 'makima']);
/** The modes that reach past their two actions. */
const OVER = new Set(['catmull', 'hermite', 'akima', 'makima']);

/** (script, interp) -> t => 0..1; slopes computed once. Holds outside the script like posAt. */
function curveOf(script, I) {
  const { at, pos } = script, n = at.length;
  if (I.mode === 'linear') return (t) => posAt(script, t);
  const m = CUBIC.has(I.mode) ? slopes(at, pos, I) : null;
  return (t) => {
    if (!(t > at[0])) return pos[0];
    if (t >= at[n - 1]) return pos[n - 1];
    const i = indexAfter(script, t), x0 = at[i - 1], x1 = at[i], y0 = pos[i - 1], y1 = pos[i];
    const u = (t - x0) / (x1 - x0);
    let y;
    if (I.mode === 'step') y = y0;
    else if (I.mode === 'smoothstep') y = y0 + (y1 - y0) * u * u * (3 - 2 * u);
    else if (I.mode === 'cosine') y = y0 + (y1 - y0) * (1 - Math.cos(Math.PI * u)) / 2;
    else y = hermite(x0, y0, x1, y1, m[i - 1], m[i], t);
    return clamp(y, 0, 1);
  };
}

/** [min, max] of the mode's curve before its 0..1 clamp and the filters, 16 samples a span: Auto's measure without a render. */
export function curveExtent(script, interp) {
  const I = cleanInterp(interp), { at, pos } = script, m = CUBIC.has(I.mode) ? slopes(at, pos, I) : null;
  let lo = Infinity, hi = -Infinity;
  const see = (y) => { lo = Math.min(lo, y); hi = Math.max(hi, y); };
  for (let i = 0; i < at.length; i++) {
    see(pos[i]);
    for (let j = 1; m && i && j < 16; j++) see(hermite(at[i - 1], pos[i - 1], at[i], pos[i], m[i - 1], m[i], at[i - 1] + (at[i] - at[i - 1]) * j / 16));
  }
  return [lo, hi];
}

const cache = new WeakMap();

/** The seam: the chosen mode's value at tMs, 0..1, before smoothing and slew. Linear is posAt exactly. */
export function sample(script, interp, tMs) {
  const I = cleanInterp(interp), key = JSON.stringify(I);
  let c = cache.get(script);
  if (!c || c.key !== key) cache.set(script, (c = { key, f: curveOf(script, I) }));
  return c.f(tMs);
}

// ---- filters on the piecewise-linear knots ------------------------------------

/** Centered box average of width w over the piecewise-linear (at, y), the window clipped at the ends. */
function smooth(at, y, w) {
  const n = at.length, cum = new Float64Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + (y[k] + y[k - 1]) * (at[k] - at[k - 1]) / 2;
  const integ = (t) => {
    if (t <= at[0]) return 0;
    if (t >= at[n - 1]) return cum[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (at[mid] <= t) lo = mid; else hi = mid; }
    const u = (t - at[lo]) / (at[hi] - at[lo]), yt = y[lo] + (y[hi] - y[lo]) * u;
    return cum[lo] + (y[lo] + yt) * (t - at[lo]) / 2;
  };
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(at[0], at[k] - w / 2), b = Math.min(at[n - 1], at[k] + w / 2);
    out[k] = b > a ? (integ(b) - integ(a)) / (b - a) : y[k];
  }
  return out;
}

function slew(at, y, perMs) {
  for (let k = 1; k < at.length; k++) {
    const d = perMs * (at[k] - at[k - 1]);
    y[k] = clamp(y[k], y[k - 1] - d, y[k - 1] + d);
  }
}

/** The slew limit in pos per ms over the rail length times the Range share; 0 without the length. */
function slewOf(I, ctx) {
  const span = ctx.spanMm > 0 ? ctx.spanMm * ((ctx.hi ?? 1) - (ctx.lo ?? 0)) : 0;
  return I.slewMmS > 0 && span > 0 ? I.slewMmS / span / 1000 : 0;
}

/**
 * Script -> Script with the curve as knots. ctx: {spanMm, lo, hi} (the rail length and the Range share,
 * for the slew limit in mm/s). Linear with both filters off returns `script` itself.
 */
export function shape(script, interp, ctx = {}) {
  if (!script) return script;
  const I = cleanInterp(interp), perMs = slewOf(I, ctx);
  script = scaled(script, I);
  if (I.mode === 'linear' && !I.smoothMs && !perMs) return script;
  const f = curveOf(script, I), { at, pos } = script, n = at.length;
  const T = [at[0]];
  for (let i = 1; i < n; i++) {
    const h = at[i] - at[i - 1], k = Math.ceil(h / STEP_MS);
    for (let j = 1; j < k; j++) T.push(at[i - 1] + (h * j) / k);
    T.push(at[i]);
  }
  const tt = Float64Array.from(T);
  let y = Float64Array.from(tt, (t, j) => (j === tt.length - 1 ? pos[n - 1] : f(t)));
  if (I.smoothMs) y = smooth(tt, y, I.smoothMs);
  if (perMs) slew(tt, y, perMs);
  // Merge: a knot is dropped only while one line from the last kept knot passes within MERGE_EPS of
  // every dropped knot (the slope cone of each one, intersected).
  const keep = [0];
  let a = 0, lo = -Infinity, hi = Infinity;
  for (let k = 1; k < tt.length; k++) {
    const s = (y[k] - y[a]) / (tt[k] - tt[a]);
    if (s < lo || s > hi || tt[k] - tt[a] > MAX_SPAN_MS) { a = k - 1; keep.push(a); lo = -Infinity; hi = Infinity; }
    const dt = tt[k] - tt[a];
    lo = Math.max(lo, (y[k] - MERGE_EPS - y[a]) / dt);
    hi = Math.min(hi, (y[k] + MERGE_EPS - y[a]) / dt);
  }
  if (tt.length > 1) keep.push(tt.length - 1);
  const A = Float64Array.from(keep, (k) => tt[k]);
  return { ...script, at: A, pos: Float32Array.from(keep, (k) => clamp(y[k], 0, 1)), durationMs: A[A.length - 1],
    ignored: [...script.ignored], notes: [...script.notes] };
}

/** The Script the scheduler sends: the actions' own knots with the mode's slope (vel); ctx as shape(). */
export function wire(script, interp, ctx = {}) {
  if (!script) return script;
  const I = cleanInterp(interp);
  if (I.smoothMs || slewOf(I, ctx)) {
    const d = shape(script, I, ctx);
    return { ...script, pos: Float32Array.from(script.at, (t) => posAt(d, t)), vel: null };
  }
  script = scaled(script, I);
  if (I.mode === 'linear') return script;
  const vel = CUBIC.has(I.mode) ? slopes(script.at, script.pos, I) : new Float64Array(script.at.length);
  return { ...script, vel };
}

// ---- controls: the settings card --------------------------------------------

export const COPY = Object.freeze({
  heading: 'Motion curve',
  mode: 'Curve',
  modeTip: 'Curve between actions',
  overTip: 'Reaches past the actions, so Auto shrinks it',
  tension: 'Tension',
  bias: 'Bias',
  none: 'No setting',
  smoothMs: 'Smoothing',
  slewMmS: 'Slew limit',
  slewTip: 'Needs the rail length',
  off: 'off',
  scale: 'Scale',
  auto: 'Auto',
  autoTip: 'Fit the curve to the window',
  autoTo: '–',
  labels: Object.freeze({ linear: 'Linear', step: 'Step', smoothstep: 'Smoothstep', cosine: 'Cosine', catmull: 'Catmull-Rom',
    hermite: 'Hermite', monotone: 'Monotone', pchip: 'PCHIP', akima: 'Akima', makima: 'Makima' }),
});

export const CSS = `
.fsp-interp { display: grid; grid-template-columns: 10ch minmax(0, 1fr) 9ch; grid-auto-rows: var(--tap); gap: var(--sp-2) var(--sp-3); align-items: center; }
.fsp-interp h4 { grid-column: 1 / -1; margin: 0; font-size: .85rem; color: var(--tx-mut); font-weight: 600; }
.fsp-interp label { color: var(--tx-mut); font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsp-interp select, .fsp-interp input { min-height: var(--tap); margin: 0; min-width: 0; font: inherit; }
.fsp-interp select { grid-column: 2 / -1; background: var(--bg-card); color: var(--tx); border: 1px solid var(--line-2); border-radius: var(--r-s); padding: 0 var(--sp-2); }
.fsp-interp select:focus-visible, .fsp-interp input:focus-visible, .fsp-interp button:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
.fsp-interp .fsp-grow { display: flex; gap: var(--sp-2); align-items: center; min-width: 0; }
.fsp-interp .fsp-grow input { flex: 1 1 0; min-width: 0; }
.fsp-interp button { flex: none; min-height: var(--tap); min-width: var(--tap); padding: 0 var(--sp-3); background: none; color: var(--tx);
  border: 1px solid var(--line-2); border-radius: var(--r-s); cursor: pointer; font: inherit; }
.fsp-interp button[aria-pressed=true] { color: var(--highlight); border-color: var(--highlight); }
.fsp-interp .fsp-gcell { display: grid; align-items: center; min-width: 0; }
.fsp-interp .fsp-gcell input { width: 100%; box-sizing: border-box; background: var(--bg-card); color: var(--tx); border: 1px solid var(--line-2);
  border-radius: var(--r-s); padding: 0 var(--sp-2); font: .8rem var(--mono); text-align: right; }
.fsp-interp output { font: .8rem var(--mono); color: var(--tx-val); text-align: right; white-space: nowrap; }
.fsp-interp input:disabled { opacity: .4; }
.fsp-interp input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: var(--tap); background: none; cursor: ew-resize; }
.fsp-interp input[type=range]::-webkit-slider-runnable-track { height: 2px; background: var(--line-2); }
.fsp-interp input[type=range]::-moz-range-track { height: 2px; background: var(--line-2); }
.fsp-interp input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 20px; margin-top: -9px; border-radius: 4.5px;
  border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
.fsp-interp input[type=range]::-moz-range-thumb { width: 9px; height: 20px; border-radius: 4.5px; border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
`;

const fmt = { tension: (v) => v.toFixed(2), bias: (v) => (v > 0 ? '+' : '') + v.toFixed(2),
  smoothMs: (v) => (v ? v + ' ms' : COPY.off), slewMmS: (v) => (v ? v + ' mm/s' : COPY.off) };

/**
 * Settings card rows: mode, its parameter, smoothing, slew, Scale; -> unmount(). A mode swap relabels, never reflows.
 * gain() -> the map in force, [lower, upper] (the player's); Auto reads out where 0 and 1 land, polled at 4 Hz.
 */
export function mountInterp(el, { value, onChange, gain = () => null }) {
  let v = cleanInterp(value);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, x] of Object.entries(attrs)) if (k === 'text') e.textContent = x; else e.setAttribute(k, x);
    e.append(...kids);
    return e;
  };
  const sel = h('select', { 'aria-label': COPY.mode, title: COPY.modeTip },
    ...Object.keys(MODES).map((id) => h('option', { value: id, text: COPY.labels[id] })));
  const slider = (key) => {
    const r = RANGES[key];
    const input = h('input', { type: 'range', 'aria-label': COPY[key], min: String(r.min), max: String(r.max), step: String(r.step) });
    return { input, out: h('output') };
  };
  const par = slider('tension'), sm = slider('smoothMs'), sl = slider('slewMmS'), sc = slider('scale');
  sc.input.setAttribute('title', COPY.scale);
  const auto = h('button', { type: 'button', 'aria-label': COPY.auto, title: COPY.autoTip, text: COPY.auto });
  const typed = h('input', { type: 'number', min: String(RANGES.scale.min), max: String(RANGES.scale.max), step: String(RANGES.scale.step),
    'aria-label': COPY.scale, title: COPY.scale });
  const gainOut = h('output', { class: 'fsp-gain' });
  const parLabel = h('label');
  const root = h('div', { class: 'fsp-interp', role: 'group', 'aria-label': COPY.heading }, h('style', { text: CSS }),
    h('h4', { text: COPY.heading }),
    h('label', { text: COPY.mode }), sel,
    parLabel, par.input, par.out,
    h('label', { text: COPY.smoothMs }), sm.input, sm.out,
    h('label', { text: COPY.slewMmS, title: COPY.slewTip }), sl.input, sl.out,
    h('label', { text: COPY.scale, title: COPY.scale }), h('span', { class: 'fsp-grow' }, auto, sc.input), h('span', { class: 'fsp-gcell' }, typed, gainOut));
  el.append(root);

  function drawGain() {
    if (!v.scaleAuto) return;
    const [a, b] = gain() ?? [0, 1], w = b - a;
    gainOut.value = (-a / w).toFixed(2) + COPY.autoTo + ((1 - a) / w).toFixed(2);
    sc.input.value = String(1 / w);
  }

  function draw() {
    const key = MODES[v.mode];
    sel.value = v.mode;
    sel.title = OVER.has(v.mode) ? COPY.overTip : COPY.modeTip;
    parLabel.textContent = key ? COPY[key] : COPY.none;
    par.input.setAttribute('aria-label', parLabel.textContent);
    par.input.disabled = !key;
    if (key) {
      const r = RANGES[key];
      Object.assign(par.input, { min: String(r.min), max: String(r.max), step: String(r.step), value: String(v[key]) });
    }
    par.out.value = key ? fmt[key](v[key]) : '';
    sm.input.value = String(v.smoothMs);
    sm.out.value = fmt.smoothMs(v.smoothMs);
    sl.input.value = String(v.slewMmS);
    sl.out.value = fmt.slewMmS(v.slewMmS);
    auto.setAttribute('aria-pressed', String(v.scaleAuto));
    sc.input.disabled = typed.hidden = v.scaleAuto;
    gainOut.hidden = !v.scaleAuto;
    if (!v.scaleAuto) sc.input.value = typed.value = v.scale.toFixed(2);
    drawGain();
  }
  const commit = (partial) => { v = cleanInterp({ ...v, ...partial }); draw(); onChange(v); };
  sel.addEventListener('change', () => commit({ mode: sel.value }));
  par.input.addEventListener('input', () => { const k = MODES[v.mode]; if (k) par.out.value = fmt[k](+par.input.value); });
  par.input.addEventListener('change', () => { const k = MODES[v.mode]; if (k) commit({ [k]: +par.input.value }); });
  for (const [s, k] of [[sm, 'smoothMs'], [sl, 'slewMmS']]) {
    s.input.addEventListener('input', () => { s.out.value = fmt[k](+s.input.value); });
    s.input.addEventListener('change', () => commit({ [k]: +s.input.value }));
  }
  auto.addEventListener('click', () => commit({ scaleAuto: !v.scaleAuto }));
  sc.input.addEventListener('input', () => { typed.value = (+sc.input.value).toFixed(2); });
  sc.input.addEventListener('change', () => commit({ scale: +sc.input.value }));
  typed.addEventListener('change', () => { if (typed.value !== '' && Number.isFinite(+typed.value)) commit({ scale: +typed.value }); else draw(); });
  draw();
  // ponytail: polls the player's gain at 4 Hz; a player change event when a second readout needs one.
  const poll = setInterval(drawGain, 250);
  return () => { clearInterval(poll); root.remove(); };
}
