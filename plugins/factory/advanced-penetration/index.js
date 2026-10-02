// advanced-penetration -- factory plugin: the pattern card. Substitutes
// RENDERING §10 `generator-advanced` and `pattern-panel` per RFC-068
// (RENDERING §10.2), as a direct-manipulation editor after fray-d's OSSM-Lite
// and the SlopDrive-32 pattern card; the reading is recorded on ph-e82.18.
//
// Constraints:
// - One self-contained ES module, no framework, no imports (docs/PLUGINS.md).
// - Binds by registry role only. `require` is generator-advanced's base set
//   (RFC-081) and one run role (RFC-093 advgen.running, or pattern.running);
//   pattern-panel's (running, select) is drawn whenever both exist.
// - Advanced and Classic are two §11.4 sources: each tab starts its own, the
//   hub refuses a second with SOURCE_CONFLICT. The tabs only switch the view.
// - A handle and its numeric twin are two views of one field: each shows
//   api.value, a drag or nudge previews locally and writes once on release.
// - Everything shown is api.value; nothing claims a value before the echo.
// - mod.shape is not claimed: it stays a Tier-0 field until a hub emits it.

const STORE_OP = { save: 1, load: 2, delete: 3 };   // registry store_ops (RFC-067)
const CBOR = { uint: 0, tstr: 4 };                 // SPEC §8.1 schema field types
const HIT = 30;                                    // px: pointer radius that picks a handle
const TANGENT = 0.7;                               // accel diamond: share of the bezier control offset
const WAVE_MS = 6000;
const CONTROL_OWNER = 0x0004;                     // registry core channel control-owner

const BASE = [
  ['depthMax', 'advgen.depth_max', 'Max depth'], ['depthMin', 'advgen.depth_min', 'Min depth'],
  ['speedIn', 'advgen.speed_in', 'In speed'], ['speedOut', 'advgen.speed_out', 'Out speed'],
  ['accelIn', 'advgen.accel_in', 'In accel'], ['accelOut', 'advgen.accel_out', 'Out accel'],
];
const MOD = [['amount', 'mod.amount', 'Amp'], ['rise', 'mod.rise', 'To min'], ['hold', 'mod.hold', 'At min'],
  ['fall', 'mod.fall', 'To max'], ['rest', 'mod.rest', 'At max'], ['phase', 'mod.phase', 'Offset']];
const CLASSIC = [['pSpeed', 'pattern.speed', 'Speed'], ['pDepth', 'pattern.depth', 'Depth'],
  ['pStroke', 'pattern.stroke', 'Stroke'], ['pSensation', 'pattern.sensation', 'Sensation']];
const LADDER = { pending: 'waiting', overdue: 'still waiting', fault: 'refused' };
const KEYS = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10, Home: 'min', End: 'max' };

// ---- geometry (pure; test/plugins.test.mjs drives it) ----------------------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A value held to the field's bounds and step grid. */
export function snap(f, v) {
  const lo = f.min ?? -Infinity, hi = f.max ?? Infinity, st = f.step || 1;
  const base = Number.isFinite(lo) ? lo : 0;
  return clamp(+(base + Math.round((v - base) / st) * st).toFixed(6), lo, hi);
}
/** Speed or accel as a share of full scale, the picture's unit; and back. */
export const unitOf = (f, v) => (f.min >= 0 ? v / f.max : (v - f.min) / (f.max - f.min));
export const valueOf = (f, u) => (f.min >= 0 ? u * f.max : f.min + u * (f.max - f.min));
/** Depth as a share of its range, and back. */
export const fracOf = (f, v) => clamp((v - f.min) / (f.max - f.min), 0, 1);
export const fromFrac = (f, u) => f.min + clamp(u, 0, 1) * (f.max - f.min);

// fray-d calculateStroke: a trapezoid velocity profile over the window. With
// a = s^2/span * (1 + 9A), the half takes span*gain(A)/s and accelerates for
// span/(s(1+9A)); the bezier control offset is that accel time.
const gain = (a) => 1 + 1 / (1 + 9 * a);
export const halfTime = (span, s, a) => (span > 0 && s > 0 ? span * gain(a) / s : null);
export const accTime = (span, s, a) => (span > 0 && s > 0 ? span / (s * (1 + 9 * a)) : null);
export const speedForTime = (span, a, t) => span * gain(a) / t;
/** Control offset / half width = 1/(2+9A); inverted. */
export const accelForEase = (e) => clamp((1 / e - 2) / 9, 0, 1);

function bez(c, t) {
  const u = 1 - t;
  return { x: u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
    y: u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7] };
}
/** The point of a monotonic-x cubic at x, by bisection. */
export function onCurve(c, x) {
  let a = 0, b = 1;
  const up = c[6] >= c[0];
  for (let i = 0; i < 30; i++) {
    const m = (a + b) / 2;
    if ((bez(c, m).x < x) === up) a = m; else b = m;
  }
  return bez(c, (a + b) / 2);
}
/** Where a depth share u sits on a half whose y runs smoothstep from start to end. */
export function atDepth(c, u) {
  const t = 0.5 - Math.sin(Math.asin(clamp(1 - 2 * u, -1, 1)) / 3);
  return bez(c, t);
}

/**
 * The stroke picture. p: {lo, hi} depth shares, {sIn, sOut, aIn, aOut} units.
 * L: {X0, XR, YT, YB}. k (px per time) is fitted unless given (frozen in a drag).
 */
export function strokeGeom(p, L, k) {
  const y = (u) => L.YB - u * (L.YB - L.YT);
  const g = { p, L, ylo: y(p.lo), yhi: y(p.hi), span: p.hi - p.lo };
  const tIn = halfTime(g.span, p.sIn, p.aIn), tOut = halfTime(g.span, p.sOut, p.aOut);
  g.ok = !!(tIn && tOut);
  if (!g.ok) return g;
  g.k = k || (L.XR - L.X0) / (tIn + tOut);
  g.x0 = L.X0;
  g.x1 = g.x0 + g.k * tIn;
  g.x2 = g.x1 + g.k * tOut;
  const dIn = g.k * accTime(g.span, p.sIn, p.aIn), dOut = g.k * accTime(g.span, p.sOut, p.aOut);
  g.inC = [g.x0, g.ylo, g.x0 + dIn, g.ylo, g.x1 - dIn, g.yhi, g.x1, g.yhi];
  g.outC = [g.x1, g.yhi, g.x1 + dOut, g.yhi, g.x2 - dOut, g.ylo, g.x2, g.ylo];
  const mid = (g.ylo + g.yhi) / 2;
  g.deep = { x: g.x1, y: g.yhi };
  g.shallow = { x: g.x2, y: g.ylo };
  g.vIn = { x: (g.x0 + g.x1) / 2, y: mid };
  g.vOut = { x: (g.x1 + g.x2) / 2, y: mid };
  g.aIn = onCurve(g.inC, g.x0 + TANGENT * dIn);
  g.aOut = onCurve(g.outC, g.x2 - TANGENT * dOut);
  return g;
}

/** A handle at (x, y) of drag-start geometry g, as its field's raw value. */
export const strokeValue = {
  depth: (f, g, x, y) => fromFrac(f, (g.L.YB - y) / (g.L.YB - g.L.YT)),
  speedIn: (f, g, x) => valueOf(f, speedForTime(g.span, g.p.aIn, 2 * Math.max(x - g.x0, 1e-3) / g.k)),
  speedOut: (f, g, x) => valueOf(f, speedForTime(g.span, g.p.aOut, 2 * Math.max(x - g.x1, 1e-3) / g.k)),
  accelIn: (f, g, x) => valueOf(f, accelForEase(Math.max(x - g.x0, 1e-3) / (TANGENT * (g.x1 - g.x0)))),
  accelOut: (f, g, x) => valueOf(f, accelForEase(Math.max(g.x2 - x, 1e-3) / (TANGENT * (g.x2 - g.x1)))),
};

/** fray-d getModification as a drop share per stroke of the cycle (0 = base, 1 = full swing). */
export function dropAt(i, c) {
  if (i < c.rise) return (i + 1) / c.rise;
  i -= c.rise;
  if (i < c.hold) return 1;
  i -= c.hold;
  if (i < c.fall) return 1 - (i + 1) / c.fall;
  return 0;
}

/**
 * The rhythm staircase: one bar per stroke, height following amount. c:
 * {amount, rise, hold, fall, rest, phase} in field units; L: {X0, XR, YT, YB, AX, TRACK}.
 */
export function stairGeom(c, amax, L, k) {
  const total = Math.max(0, c.rise + c.hold + c.fall + c.rest);
  // At least eight strokes of room, so a short cycle has somewhere to grow.
  k = k || (L.XR - L.X0) / Math.max(total, 8);
  const depth = clamp(c.amount / amax, 0, 1) * (L.YB - L.YT);
  const xs = (n) => L.X0 + k * n;
  const bars = [];
  for (let i = 0; i < total; i++) bars.push(L.YT + dropAt(i, c) * depth);
  const low = L.YT + depth;
  return {
    c, L, k, total, bars, low,
    rise: { x: xs(c.rise), y: low }, hold: { x: xs(c.rise + c.hold), y: low },
    fall: { x: xs(c.rise + c.hold + c.fall), y: L.YT }, rest: { x: xs(total), y: L.YT },
    amp: { x: L.AX, y: low },
    phase: { x: xs(total ? ((c.phase % total) + total) % total : 0), y: L.TRACK },
  };
}
export const stairValue = {
  amount: (f, g, x, y) => (clamp(y, g.L.YT, g.L.YB) - g.L.YT) / (g.L.YB - g.L.YT) * f.max,
  rise: (f, g, x) => (x - g.L.X0) / g.k,
  hold: (f, g, x) => (x - g.rise.x) / g.k,
  fall: (f, g, x) => (x - g.hold.x) / g.k,
  rest: (f, g, x) => (x - g.fall.x) / g.k,
  phase: (f, g, x) => (x - g.L.X0) / g.k,
};

// ---- DOM helpers -----------------------------------------------------------

const CSS = `
.ap { display: flex; flex-direction: column; gap: var(--gap); }
.ap [hidden] { display: none !important; }
.ap-tabs { display: grid; grid-template-columns: 1fr 1fr; }
.ap-tabs button, .ap-mtabs button { min-height: var(--tap); background: none; border: 1px solid var(--line); color: var(--tx-mut);
  font: inherit; font-size: .8rem; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.ap-tabs button[aria-selected=true], .ap-mtabs button[aria-selected=true] { color: var(--reality); border-color: var(--reality); }
.ap [data-status=pending] { border-style: dashed; }
.ap [data-status=overdue], .ap [data-status=fault] { border-color: var(--warn); }
.ap-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ap-row > select, .ap-row > input { flex: 1 1 180px; min-height: var(--tap); }
.ap-row .og-btn, .ap-run { min-height: var(--tap); }
.ap-run { flex: 1 1 200px; letter-spacing: .08em; text-transform: uppercase; }
.ap-ctl { display: flex; flex-direction: column; }
.ap-ctl label { display: flex; justify-content: space-between; gap: 8px; color: var(--tx); font-size: .85rem; }
.ap-ctl output { font-family: var(--mono); color: var(--tx-val); }
.ap-ctl input[type=range] { margin: 6px 0; }
.ap-note { margin: 0; min-height: 1.1em; font-size: .74rem; color: var(--ink-dim); }
.ap [data-status=fault] > .ap-note, .ap-ed + .ap-note:not(:empty) { color: var(--warn); }
.ap-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px 10px; }
.ap-num { display: flex; flex-direction: column; gap: 2px; font-size: .72rem; color: var(--tx-mut); }
.ap-num input { font-family: var(--mono); }
.ap-num[data-status=pending] input { border-style: dashed; }
.ap-num[data-status=overdue] input, .ap-num[data-status=fault] input { border-color: var(--warn); }
.ap-cap { display: flex; justify-content: space-between; font-family: var(--mono); font-size: .7rem; color: var(--tx-mut); }
.ap-ed { position: relative; width: 100%; border: 1px solid var(--line); border-radius: var(--r-s); touch-action: none; user-select: none; }
.ap-ed svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ap-stroke { height: 240px; }
.ap-stair { height: 170px; }
.ap-wave { height: 64px; touch-action: auto; }
.ap-ed path, .ap-ed line, .ap-ed polyline { fill: none; vector-effect: non-scaling-stroke; }
.ap-ed .curve { stroke: var(--reality); stroke-width: 2; }
.ap-ed .guide { stroke: var(--line-2); stroke-dasharray: 4 4; }
.ap-ed .grid { stroke: var(--line); }
.ap-ed .fill { fill: var(--intent); opacity: .12; }
.ap-ed .told { stroke: var(--intent); stroke-width: 1.5; }
.ap-ax { position: absolute; left: 4px; transform: translateY(-50%); font: .66rem var(--mono); color: var(--tx-ghost); pointer-events: none; }
.ap-seg { position: absolute; bottom: 20px; transform: translateX(-50%); font: .66rem var(--mono); color: var(--tx-mut); pointer-events: none; white-space: nowrap; }
.ap-h { position: absolute; width: var(--tap); height: var(--tap); margin: calc(var(--tap) / -2) 0 0 calc(var(--tap) / -2); outline: none; }
.ap-h::after { content: ''; position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px;
  border-radius: 50%; border: 2px solid var(--reality); background: var(--bg-card); box-sizing: border-box; }
.ap-h[data-shape=diamond]::after { border-radius: 2px; transform: rotate(45deg); }
.ap-h[data-shape=tri]::after { border-radius: 0; width: 0; height: 0; border-width: 0 7px 12px; border-color: transparent transparent var(--reality); background: none; }
.ap-h:focus-visible::after { box-shadow: 0 0 0 3px rgba(var(--reality-rgb), .35); }
.ap-h[data-status=pending]::after { border-style: dashed; }
.ap-h[data-status=overdue]::after, .ap-h[data-status=fault]::after { border-color: var(--warn); }
.ap-h[data-status=fault] .ap-tag { color: var(--warn); }
.ap-h.off { opacity: .4; }
.ap-h[aria-orientation=vertical] .ap-tag { top: auto; bottom: calc(50% + 8px); }
.ap-h.left .ap-tag { left: auto; right: calc(50% + 12px); }
.ap-tag { position: absolute; left: calc(50% + 12px); top: calc(50% + 4px); white-space: nowrap; font: .7rem var(--mono); color: var(--reality); pointer-events: none; }
.ap-play { position: absolute; width: 10px; height: 10px; margin: -5px; border-radius: 50%; background: var(--intent); pointer-events: none; }
.ap h4 { margin: 0; font-size: .85rem; color: var(--tx); font-weight: 600; }
.ap-sub { margin: 0; font-size: .72rem; color: var(--tx-mut); }
.ap-mtabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 4px; }
.ap-mtabs button::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; background: var(--line-2); vertical-align: middle; }
.ap-mtabs button[data-on=true]::before { background: var(--reality); }
.ap .ap-stale { opacity: .55; }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const on = (v) => v === true || Number(v) === 1;
const num = (v) => String(+Number(v).toFixed(2));
const cpath = (c) => 'M' + c[0] + ' ' + c[1] + ' C' + c.slice(2).join(' ');

export function activate(api) {
  api.registerHero({
    id: 'advanced',
    title: 'Pattern',
    replaces: ['advanced-generator', 'pattern'],
    cells: { h: [12, 16], v: [8, 24] },
    spec: {
      require: { master: 'advgen.master', ...Object.fromEntries(BASE.map(([k, r]) => [k, r])) },
      // RFC-093: the advanced generator runs on its own advgen.running; a hub
      // without it yet still gets the editor, its Start says what is missing.
      optional: {
        running: 'pattern.running', advRun: 'advgen.running',
        bgRun: 'source.background_run', presetOp: 'action.store',
        select: 'pattern.select', ...Object.fromEntries(CLASSIC.map(([k, r]) => [k, r])),
      },
      requireOne: [['running', 'advRun']],
      // A modulator is one entry carrying all six roles (RFC-066); no minimum.
      instances: { mods: { min: 0, roles: Object.fromEntries(MOD.map(([k, r]) => [k, r])) } },
    },
    mount: (el, fields) => mountCard(api, el, fields),
  });
}

// ---- the editor shell: handles over an SVG, drag and keys, one write per release

function makeEditor(api, o) {
  const svg = s('svg', { viewBox: '0 0 ' + o.W + ' ' + o.H, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const box = h('div', { class: 'ap-ed ' + o.cls }, svg);
  const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
  const draft = new Map();
  let drag = null;
  const val = (f) => (draft.has(f.uid) ? draft.get(f.uid) : Number(api.value(f)));
  const geom = () => o.geom(val, drag ? drag.g0 : null);
  const hs = o.handles.filter((d) => d.field).map((d) => {
    const el = h('div', { class: 'ap-h', role: 'slider', tabindex: '0', 'aria-label': d.label,
      'data-key': d.key, 'data-shape': d.shape || 'dot', 'aria-orientation': d.axis === 'y' ? 'vertical' : 'horizontal' });
    const tag = h('span', { class: 'ap-tag' });
    el.append(tag);
    const hd = { ...d, el, tag };
    el.addEventListener('blur', () => commit(hd));
    el.addEventListener('keydown', (e) => nudge(hd, e));
    el.addEventListener('keyup', (e) => { if (e.key in KEYS) commit(hd); });
    return hd;
  });
  box.append(...(o.decor || []), ...hs.map((hd) => hd.el));
  if (o.svgKids) svg.append(...o.svgKids);

  function nudge(hd, e) {
    const f = hd.field;
    const k = KEYS[e.key];
    if (k === undefined || api.gate(f)) return;
    e.preventDefault();
    const v = k === 'min' ? f.min : k === 'max' ? f.max : val(f) + k * (f.step || 1) * (e.shiftKey ? 10 : 1);
    draft.set(f.uid, snap(f, v));
    render();
  }
  function commit(hd) {
    const f = hd.field;
    if (!draft.has(f.uid)) return;
    const v = draft.get(f.uid);
    draft.delete(f.uid);
    if (v !== Number(api.value(f))) api.write(f, v);
    render();
  }
  const local = (e) => {
    const r = box.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * o.W, 0, o.W), y: clamp((e.clientY - r.top) / r.height * o.H, 0, o.H) };
  };
  box.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect();
    const g = geom();
    let best = null, bd = HIT;
    for (const hd of hs) {
      const p = hd.at(g);
      if (!p || api.gate(hd.field)) continue;
      const d = Math.hypot(r.left + p.x / o.W * r.width - e.clientX, r.top + p.y / o.H * r.height - e.clientY);
      if (d < bd) { bd = d; best = hd; }
    }
    if (!best) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    best.el.focus({ preventScroll: true });
    drag = { hd: best, g0: g, id: e.pointerId };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = local(e);
    const f = drag.hd.field;
    const v = drag.hd.value(f, drag.g0, p.x, p.y);
    if (Number.isFinite(v)) draft.set(f.uid, snap(f, v));
    render();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const hd = drag.hd;
    drag = null;
    commit(hd);
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  function render() {
    const g = geom();
    o.draw(g, val);
    let gate = '';
    for (const hd of hs) {
      const f = hd.field;
      const p = hd.at(g);
      hd.el.hidden = !p;
      const fg = api.gate(f);
      gate = gate || fg;
      if (!p) continue;
      hd.el.style.left = (p.x / o.W * 100) + '%';
      hd.el.style.top = (p.y / o.H * 100) + '%';
      hd.el.classList.toggle('left', p.x > o.W * 0.85);
      const st = draft.has(f.uid) ? 'draft' : api.status(f);
      hd.el.dataset.status = st;
      hd.el.classList.toggle('off', !!fg);
      hd.el.setAttribute('aria-disabled', String(!!fg));
      const v = val(f);
      hd.el.setAttribute('aria-valuenow', String(v));
      hd.el.setAttribute('aria-valuemin', String(f.min));
      hd.el.setAttribute('aria-valuemax', String(f.max));
      hd.tag.textContent = hd.text(v) + (LADDER[st] ? ' · ' + LADDER[st] : '');
    }
    note.textContent = gate;
    box.classList.toggle('ap-stale', hs.some((hd) => api.stale(hd.field)));
  }
  return { box, note, render, val };
}

// ---- the card --------------------------------------------------------------

function mountCard(api, el, fields) {
  const F = fields;
  const updaters = [];
  const loops = [];

  // A field as a number input: the numeric twin of a handle.
  function numCtl(f, label) {
    const input = h('input', { type: 'number', class: 'og-num', min: f.min ?? '', max: f.max ?? '', step: f.step || 1, 'aria-label': label });
    const box = h('label', { class: 'ap-num' }, h('span', { text: label + (f.unit ? ' (' + f.unit + ')' : '') }), input);
    input.addEventListener('change', () => { if (input.value !== '') api.write(f, snap(f, Number(input.value))); });
    updaters.push(() => {
      const st = api.status(f), gate = api.gate(f);
      box.dataset.status = st;
      box.title = gate || LADDER[st] || '';
      input.disabled = !!gate;
      if (document.activeElement !== input) input.value = num(api.value(f));
    });
    return box;
  }
  // A full-width slider (master, the classic knobs), the ladder in words under it.
  function slider(f, label) {
    const out = h('output');
    const input = h('input', { type: 'range', min: f.min ?? 0, max: f.max ?? 100, step: f.step || 1, 'aria-label': label });
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    const box = h('div', { class: 'ap-ctl' }, h('label', {}, h('span', { text: label }), out), input, note);
    let held = false;
    input.addEventListener('input', () => { held = true; out.textContent = num(input.value); });
    input.addEventListener('change', () => { held = false; api.write(f, Number(input.value)); });
    updaters.push(() => {
      const v = api.value(f), st = api.status(f), gate = api.gate(f), stale = api.stale(f);
      box.dataset.status = st;
      box.classList.toggle('ap-stale', !!stale);
      input.disabled = !!gate;
      if (!held) { input.value = Number(v); out.textContent = num(v) + (f.unit ? ' ' + f.unit : ''); }
      note.textContent = gate || LADDER[st] || '';
    });
    return box;
  }
  function choice(f, label) {
    const sel = h('select', { 'aria-label': label });
    (f.options || []).forEach((o, i) => sel.append(h('option', { value: String(i), text: String(o).replace(/_/g, ' ') })));
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    const box = h('div', { class: 'ap-ctl' }, h('label', {}, h('span', { text: label })), sel, note);
    sel.addEventListener('change', () => api.write(f, Number(sel.value)));
    updaters.push(() => {
      const st = api.status(f), gate = api.gate(f);
      box.dataset.status = st;
      sel.disabled = !!gate;
      sel.value = String(Number(api.value(f)));
      note.textContent = gate || LADDER[st] || '';
    });
    return box;
  }

  // ---- stroke · shape
  const SL = { X0: 70, XR: 960, YT: 30, YB: 210 };
  const ticks = [0, 25, 50, 75, 100].map((t) => h('span', { class: 'ap-ax', text: String(t),
    style: 'top:' + ((SL.YB - t / 100 * (SL.YB - SL.YT)) / 240 * 100) + '%' }));
  const pIn = s('path', { class: 'curve' }), pOut = s('path', { class: 'curve' });
  const play = h('div', { class: 'ap-play', hidden: '' });
  const SV = strokeValue;
  const stroke = makeEditor(api, {
    W: 1000, H: 240, cls: 'ap-stroke',
    decor: [...ticks, h('span', { class: 'ap-cap', style: 'position:absolute;right:8px;top:4px', text: 'stroke · shape' }), play],
    svgKids: [
      s('line', { class: 'guide', x1: SL.X0, x2: SL.XR, y1: SL.YT, y2: SL.YT }),
      s('line', { class: 'guide', x1: SL.X0, x2: SL.XR, y1: SL.YB, y2: SL.YB }), pIn, pOut],
    geom: (val, g0) => strokeGeom({
      lo: fracOf(F.depthMin, val(F.depthMin)), hi: fracOf(F.depthMax, val(F.depthMax)),
      sIn: unitOf(F.speedIn, val(F.speedIn)), sOut: unitOf(F.speedOut, val(F.speedOut)),
      aIn: unitOf(F.accelIn, val(F.accelIn)), aOut: unitOf(F.accelOut, val(F.accelOut)),
    }, SL, g0 && g0.k),
    draw(g) {
      pIn.setAttribute('d', g.ok ? cpath(g.inC) : '');
      pOut.setAttribute('d', g.ok ? cpath(g.outC) : '');
    },
    handles: [
      { key: 'deep', field: F.depthMax, label: 'Max depth', axis: 'y', at: (g) => (g.ok ? g.deep : { x: SL.X0, y: g.yhi }),
        value: SV.depth, text: (v) => 'deep ' + num(v) },
      { key: 'shallow', field: F.depthMin, label: 'Min depth', axis: 'y', at: (g) => (g.ok ? g.shallow : { x: SL.XR, y: g.ylo }),
        value: SV.depth, text: (v) => 'shallow ' + num(v) },
      { key: 'vin', field: F.speedIn, label: 'In speed', at: (g) => g.ok && g.vIn, value: SV.speedIn, text: (v) => 'in v' + num(v) },
      { key: 'vout', field: F.speedOut, label: 'Out speed', at: (g) => g.ok && g.vOut, value: SV.speedOut, text: (v) => 'out v' + num(v) },
      { key: 'ain', field: F.accelIn, label: 'In accel', shape: 'diamond', at: (g) => g.ok && g.aIn, value: SV.accelIn, text: (v) => 'a' + num(v) },
      { key: 'aout', field: F.accelOut, label: 'Out accel', shape: 'diamond', at: (g) => g.ok && g.aOut, value: SV.accelOut, text: (v) => 'a' + num(v) },
    ],
  });
  updaters.push(stroke.render);

  // ---- rhythm modifier: one tab per modulator, ordered by the control it rides
  const order = new Map(BASE.map(([k], i) => [F[k].uid, i]));
  const labelOf = new Map([[F.master.uid, 'Speed'], ...BASE.map(([k, , l]) => [F[k].uid, l])]);
  const mods = (F.mods || []).map((m) => ({ m, t: api.modTarget(m.amount) }))
    .sort((a, b) => (order.get(a.t) ?? 99) - (order.get(b.t) ?? 99));
  let rhythm = null;
  if (mods.length) {
    const ML = { X0: 90, XR: 970, YT: 28, YB: 120, AX: 40, TRACK: 152 };
    let cur = 0;
    const tabs = h('div', { class: 'ap-mtabs', role: 'tablist' });
    const host = h('div');
    const views = mods.map(({ m, t }, i) => {
      const name = labelOf.get(t) || m.amount.group || 'Modulator';
      const btn = h('button', { type: 'button', role: 'tab', text: name });
      btn.addEventListener('click', () => { cur = i; show(); });
      tabs.append(btn);
      const stair = s('path', { class: 'curve' });
      const fill = s('path', { class: 'fill' });
      const segs = ['to min', 'at min', 'to max', 'at max'].map((w) => h('span', { class: 'ap-seg', 'data-w': w }));
      const ed = makeEditor(api, {
        W: 1000, H: 170, cls: 'ap-stair',
        decor: [...segs, h('span', { class: 'ap-cap', style: 'position:absolute;right:8px;top:4px', text: 'modifier · cycle' })],
        svgKids: [s('line', { class: 'guide', x1: ML.X0, x2: ML.XR, y1: ML.YT, y2: ML.YT }),
          s('line', { class: 'grid', x1: ML.AX, x2: ML.AX, y1: ML.YT, y2: ML.YB }),
          s('line', { class: 'grid', x1: ML.X0, x2: ML.XR, y1: ML.TRACK, y2: ML.TRACK }), fill, stair],
        geom: (val, g0) => stairGeom(Object.fromEntries(MOD.map(([k]) => [k, Math.max(0, val(m[k]))])),
          m.amount.max || 100, ML, g0 && g0.k),
        draw(g, val) {
          let d = 'M' + ML.X0 + ' ' + ML.YT;
          g.bars.forEach((y, i) => { d += ' V' + y + ' H' + (ML.X0 + g.k * (i + 1)); });
          stair.setAttribute('d', d);
          fill.setAttribute('d', g.bars.length ? 'M' + g.rise.x + ' ' + ML.YT + ' H' + g.hold.x + ' V' + g.low + ' H' + g.rise.x + ' Z' : '');
          const xs = [ML.X0, g.rise.x, g.hold.x, g.fall.x, g.rest.x];
          const n = [m.rise, m.hold, m.fall, m.rest].map((f) => num(val(f)));
          segs.forEach((e, j) => {
            e.style.left = ((xs[j] + xs[j + 1]) / 2 / 10) + '%';
            e.textContent = e.dataset.w + ' ' + n[j];
            e.hidden = !Number(n[j]);
          });
        },
        handles: [
          { key: 'amp', field: m.amount, label: 'Amp', axis: 'y', at: (g) => g.amp, value: stairValue.amount, text: (v) => 'amp ' + num(v) },
          { key: 'rise', field: m.rise, label: 'To min', at: (g) => g.rise, value: stairValue.rise, text: () => '' },
          { key: 'hold', field: m.hold, label: 'At min', at: (g) => g.hold, value: stairValue.hold, text: () => '' },
          { key: 'fall', field: m.fall, label: 'To max', at: (g) => g.fall, value: stairValue.fall, text: () => '' },
          { key: 'rest', field: m.rest, label: 'At max', at: (g) => g.rest, value: stairValue.rest, text: () => '' },
          { key: 'phase', field: m.phase, label: 'Offset', shape: 'tri', at: (g) => g.phase, value: stairValue.phase, text: (v) => 'offset ' + num(v) },
        ],
      });
      const nums = h('div', { class: 'ap-nums' }, ...MOD.map(([k, , l]) => numCtl(m[k], l)));
      const view = h('div', { class: 'ap-mview', role: 'tabpanel', 'aria-label': name }, ed.box, ed.note, nums);
      updaters.push(() => { btn.dataset.on = String(Number(api.value(m.amount)) > 0); ed.render(); });
      return { btn, view };
    });
    const show = () => {
      views.forEach((v, i) => v.btn.setAttribute('aria-selected', String(i === cur)));
      host.replaceChildren(views[cur].view);
    };
    show();
    rhythm = h('section', { class: 'ap-rhythm' },
      h('div', { class: 'ap-cap' }, h('h4', { text: 'Rhythm modifier' }), h('span', { text: 'vary a control across strokes' })),
      tabs, host);
  }

  // ---- wave · told: the commanded target while running, from the shadow
  // ponytail: sampled per frame from api.value, not the source timeline (webui T18); a scope, not a measurement.
  const waveLine = s('polyline', { class: 'told' });
  const wave = h('div', { class: 'ap-ed ap-wave' }, h('span', { class: 'ap-cap', style: 'position:absolute;right:8px;top:4px', text: 'wave · told' }));
  const waveSvg = s('svg', { viewBox: '0 0 1000 64', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  waveSvg.append(waveLine);
  wave.prepend(waveSvg);
  const tgt = api.field('telemetry.target') || api.field('telemetry.position');
  const pos = api.field('telemetry.position');
  const wlo = api.field('window.min'), whi = api.field('window.max');
  const share = (f) => {
    const a = Number(api.value(wlo)), b = Number(api.value(whi)), v = Number(api.value(f));
    return f && wlo && whi && b > a && Number.isFinite(v) ? clamp((v - a) / (b - a), 0, 1) : null;
  };
  const trace = [];
  let lastU = null, dir = 1;
  function frame() {
    const now = performance.now();
    const u = share(tgt);
    if (u != null) trace.push([now, u]);
    while (trace.length && trace[0][0] < now - WAVE_MS) trace.shift();
    waveLine.setAttribute('points', trace.map(([t, v]) => ((t - now + WAVE_MS) / WAVE_MS * 1000).toFixed(1) + ',' + (60 - v * 56).toFixed(1)).join(' '));
    // Playhead: the live position on the half it is travelling (depth window shares).
    const p = share(pos);
    const g = strokeGeom({
      lo: fracOf(F.depthMin, stroke.val(F.depthMin)), hi: fracOf(F.depthMax, stroke.val(F.depthMax)),
      sIn: unitOf(F.speedIn, stroke.val(F.speedIn)), sOut: unitOf(F.speedOut, stroke.val(F.speedOut)),
      aIn: unitOf(F.accelIn, stroke.val(F.accelIn)), aOut: unitOf(F.accelOut, stroke.val(F.accelOut)),
    }, SL);
    if (p != null && g.ok && g.span > 0) {
      if (lastU != null && p !== lastU) dir = p > lastU ? 1 : -1;
      lastU = p;
      const u2 = clamp((p - g.p.lo) / g.span, 0, 1);
      const pt = atDepth(dir > 0 ? g.inC : g.outC, dir > 0 ? u2 : 1 - u2);
      play.hidden = false;
      play.style.left = (pt.x / 10) + '%';
      play.style.top = (pt.y / 240 * 100) + '%';
    } else play.hidden = true;
  }
  let raf = 0;
  // Only the advanced source plays this curve; Classic running is not drawn on it.
  const running = () => !!F.advRun && on(api.value(F.advRun));
  const tick = () => { frame(); raf = running() ? requestAnimationFrame(tick) : 0; if (!raf) { play.hidden = true; trace.length = 0; } };
  loops.push(() => cancelAnimationFrame(raf));
  updaters.push(() => { if (!raf && running()) raf = requestAnimationFrame(tick); });

  // ---- presets: a dropdown over the store (RFC-070) and its ops (RFC-067)
  const presets = F.presetOp ? presetRow(api, F, updaters) : null;

  // ---- the card: two sources (SPEC §11.4), one panel each, each with its own Start
  const runRow = (f, other, need) => {
    const run = h('button', { type: 'button', class: 'og-btn ap-run' });
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    if (f) run.addEventListener('click', () => api.write(f, on(api.value(f)) ? 0 : 1));
    const row = h('div', { class: 'ap-row' }, run);
    if (F.bgRun) row.append(bgSwitch());
    updaters.push(() => {
      if (!f) { run.textContent = 'Start pattern'; run.disabled = true; note.textContent = 'needs ' + need; return; }
      const r = on(api.value(f)), st = api.status(f), gate = api.gate(f);
      run.textContent = r ? 'Stop pattern' : 'Start pattern';
      run.setAttribute('aria-pressed', String(r));
      run.dataset.status = st;
      run.disabled = !!gate;
      const why = api.reason(f);
      note.textContent = gate || (st === 'fault' && /SOURCE_CONFLICT/.test(why) ? ownerText(other) : st === 'fault' ? why : LADDER[st])
        || api.stale(f) || '';
    });
    return h('div', {}, row, note);
  };
  // §10.1 rule 1: background_run sits beside each run/stop; one field, two views.
  function bgSwitch() {
    const cb = h('input', { type: 'checkbox' });
    const sw = h('label', { class: 'og-switch ap-sw' }, cb, h('span', { class: 'track' }), h('span', { text: 'Run in background' }));
    cb.addEventListener('change', () => { Promise.resolve(api.write(F.bgRun, cb.checked ? 1 : 0)).finally(() => update()); });
    updaters.push(() => {
      sw.dataset.status = api.status(F.bgRun);
      cb.checked = on(api.value(F.bgRun));
      cb.disabled = !!api.gate(F.bgRun);
    });
    return sw;
  }
  // SOURCE_CONFLICT names the owner by id through the control-owner source
  // labels (options, index-aligned to the source id); never by name.
  function ownerText(other) {
    const co = (api.catalog().fields || []).filter((f) => f.channelId === CONTROL_OWNER && f.options);
    for (const f of co) {
      const label = f.options[Number(api.value(f))];
      if (label && label !== '-' && label !== 'none') {
        return other && String(label).toLowerCase() === other.toLowerCase() ? 'stop ' + label + ' first' : 'rail owned by ' + label;
      }
    }
    return 'stop the other source first';
  }

  const adv = h('div', { class: 'ap' },
    slider(F.master, 'Speed'),
    ...(presets ? [presets] : []),
    stroke.box, stroke.note,
    h('div', { class: 'ap-nums' }, ...BASE.map(([k, , l]) => numCtl(F[k], l))),
    ...(rhythm ? [rhythm] : []),
    wave,
    runRow(F.advRun, 'Classic', 'advgen.running'));
  const classic = F.select && F.running ? h('div', { class: 'ap' }, choice(F.select, 'Pattern'),
    ...CLASSIC.filter(([k]) => F[k]).map(([k, , l]) => slider(F[k], l)),
    runRow(F.running, 'Advanced', 'pattern.running')) : null;

  const root = h('div', { class: 'ap' }, h('style', { text: CSS }));
  if (classic) {
    // A view switch, never a write: the running source opens first.
    let view = on(api.value(F.running)) && !(F.advRun && on(api.value(F.advRun))) ? 'classic' : 'advanced';
    const tAdv = h('button', { type: 'button', role: 'tab', text: 'Advanced' });
    const tCls = h('button', { type: 'button', role: 'tab', text: 'Classic' });
    const body = h('div');
    const show = () => {
      tAdv.setAttribute('aria-selected', String(view === 'advanced'));
      tCls.setAttribute('aria-selected', String(view === 'classic'));
      body.replaceChildren(view === 'advanced' ? adv : classic);
    };
    tAdv.addEventListener('click', () => { view = 'advanced'; show(); });
    tCls.addEventListener('click', () => { view = 'classic'; show(); });
    root.append(h('div', { class: 'ap-tabs', role: 'tablist' }, tAdv, tCls), body);
    show();
  } else root.append(adv);

  el.append(root);
  function update() { for (const u of updaters) u(); }
  update();
  return { update, unmount() { for (const l of loops) l(); el.replaceChildren(); } };
}

function presetRow(api, F, updaters) {
  const op = F.presetOp;
  // The registry names no role for the op's slot and name: told apart by type (ph-e82.18).
  const slotKey = ((op.payload || []).find((p) => p.type === CBOR.uint) || {}).key;
  const nameKey = ((op.payload || []).find((p) => p.type === CBOR.tstr) || {}).key;
  let slots = null, reading = false, again = false, asking = false;
  const sel = h('select', { 'aria-label': 'Preset' });
  const save = h('button', { type: 'button', class: 'og-btn', text: 'Save' });
  const reset = h('button', { type: 'button', class: 'og-btn', text: 'Reset' });
  const del = h('button', { type: 'button', class: 'og-btn', text: 'Delete' });
  const name = h('input', { type: 'text', placeholder: 'Preset name', 'aria-label': 'Preset name', hidden: '' });
  const ok = h('button', { type: 'button', class: 'og-btn', text: 'Save as', hidden: '' });
  const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
  const box = h('div', {}, h('div', { class: 'ap-row' }, sel, save, reset, del), h('div', { class: 'ap-row' }, name, ok), note);

  const pick = () => (sel.value === '' ? null : Number(sel.value));
  const payload = (slot, nm) => {
    const p = {};
    if (slotKey != null) p[slotKey] = slot;
    if (nameKey != null && nm) p[nameKey] = nm;
    return p;
  };
  async function run(opv, slot, nm) {
    const r = await api.write(op, opv, payload(slot, nm));
    if (r && r.ok && opv !== STORE_OP.load) read();
    return r;
  }
  sel.addEventListener('change', () => { if (pick() != null) run(STORE_OP.load, pick()); draw(); });
  save.addEventListener('click', () => {
    if (pick() != null) { run(STORE_OP.save, pick(), (slots[pick()] || {}).name); return; }
    asking = !asking;
    draw();
    if (asking) name.focus();
  });
  ok.addEventListener('click', async () => {
    const free = (slots || []).find((r) => r.state === 'empty');
    if (!free || !name.value) return;
    asking = false;
    const r = await run(STORE_OP.save, free.slot, name.value);
    if (r && r.ok) { name.value = ''; sel.value = String(free.slot); }
    draw();
  });
  del.addEventListener('click', () => { if (pick() != null) run(STORE_OP.delete, pick()).then(() => { sel.value = ''; draw(); }); });
  // Reset: every driven control and modulator to its catalog default. Master, run and mode stay.
  reset.addEventListener('click', () => {
    const fs = [...BASE.map(([k]) => F[k]), ...(F.mods || []).flatMap((m) => MOD.map(([k]) => m[k]))];
    for (const f of fs) if (f.dflt != null && Number(f.dflt) !== Number(api.value(f))) api.write(f, Number(f.dflt));
  });

  // A read asked for while one runs (an op confirmed mid-read) runs once more after it.
  async function read() {
    if (reading) { again = true; return; }
    reading = true;
    try {
      do { again = false; slots = await api.storeSlots(op); } while (again);
    } finally { reading = false; }
    draw();
  }
  function draw() {
    const keep = sel.value;
    const items = (slots || []).filter((r) => r.state === 'item');
    const head = slots === null ? 'No preset store' : slots.some((r) => r.state === 'pending') ? 'Reading presets'
      : slots.some((r) => r.state === 'locked') ? 'Presets locked' : 'Apply a preset';
    sel.replaceChildren(h('option', { value: '', text: head }),
      ...items.map((r) => h('option', { value: String(r.slot), text: r.name || 'Unnamed ' + r.slot })));
    sel.value = items.some((r) => String(r.slot) === keep) ? keep : '';
    name.hidden = ok.hidden = !asking;
    gateRow();
  }
  function gateRow() {
    const gate = api.gate(op), st = api.status(op);
    const live = slots && !slots.some((r) => r.state === 'pending' || r.state === 'locked');
    sel.disabled = !!gate || !live;
    save.disabled = reset.disabled = !!gate || !live;
    del.disabled = !!gate || !live || pick() == null;
    ok.disabled = !!gate || !name.value || !(slots || []).some((r) => r.state === 'empty');
    box.dataset.status = st;
    note.textContent = gate || LADDER[st] || (asking && !(slots || []).some((r) => r.state === 'empty') ? 'store full' : '');
  }
  name.addEventListener('input', gateRow);
  // A first read before the link was live came back all pending: read again once it is.
  updaters.push(() => {
    if (!reading && slots && slots.every((r) => r.state === 'pending') && !api.gate(op)) read();
    gateRow();
  });
  read();
  return box;
}
