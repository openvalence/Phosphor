// advanced-penetration -- factory plugin: the pattern card. Substitutes
// RENDERING §10 `generator-advanced` and `pattern-panel` per RFC-068
// (RENDERING §10.2), as a direct-manipulation editor after fray-d's
// OSSM-Lite; the reading is recorded on ph-e82.18.
//
// Constraints:
// - One self-contained ES module, no framework, no imports (docs/PLUGINS.md).
// - Binds by registry role only. `require` is generator-advanced's essential
//   set (RFC-081, RFC-093 advgen.running); pattern-panel's (running, select)
//   is drawn whenever both exist.
// - Advanced and Classic are two §11.4 sources: each tab starts its own, the
//   hub refuses a second with SOURCE_CONFLICT. The tabs only switch the view.
// - A handle and its numeric twin are two views of one field and read one
//   effective value: the card's draft while edited, else api.value. A drag,
//   nudge or keystroke previews; release, key-up, change or blur writes once.
// - A draft or pending value is drawn in the intent look until the echo.
// - The stroke picture always spans the plot: x is the share of one stroke's
//   time, never absolute time, so no drag can draw past the box.
// - The in/out speed link is a client rule, not a wire one. Linked, an edit
//   holds 1/in + 1/out (the stroke period at a fixed master) and moves the
//   peak; both halves go out in the same tick, one intent. Linking rescales
//   master x k, each half / k (k = min(2, max / master)) in one intent so the
//   halves have room; the hub's speed is master % x half % x the input
//   ceiling, linear in both, so the physical stroke is unchanged. Unlinking
//   writes nothing.
// - Handle shape is its drag axis, everywhere in this card: a dot moves any
//   direction, a vertical pill left-right only, a horizontal pill up-down
//   only. The accel diamond and the offset triangle are markers that move
//   left-right.
// - A label sits beside its handle, clear of the drawn lines (placeLabels).
// - A write's state moves no box and no label: the ladder's words ride a
//   one-line note slot, the look rides the host's data-shadow (style.css).
// - mod.shape is not claimed: it stays a Tier-0 field until a hub emits it.
// - Dwells (RFC-095) are optional: the trough flat leads the stroke at the
//   left, the crest flat follows the deep turn, each to scale on the stroke's
//   own clock until it would pass DWELL_CAP of the plot; past it the flat is
//   drawn at the cap with its middle dotted (cut). The picture never caps the
//   value: the field's own max bounds it.

const STORE_OP = { save: 1, load: 2, delete: 3, rename: 4 };   // registry store_ops (RFC-067)
const CBOR = { uint: 0, tstr: 4 };                 // SPEC §8.1 schema field types
const HIT = 30;                                    // px: pointer radius that picks a handle
const TANGENT = 0.7;                               // accel diamond: share of the bezier control offset
const WINDOW_KEY = 'window';                       // api.prefs: the planned-motion window, seconds
const WINDOW_S = [2, 60, 10];                      // min, max, default
const CONTROL_OWNER = 0x0004;                     // registry core channel control-owner
const LINK_KEY = 'phosphor.advpen.speedLink';     // client preference; phosphor.* rides the prefs backup
const INPUTS_KEY = 'phosphor.advpen.inputs';      // client preference: the numeric rows shown

const BASE = [
  ['depthMax', 'advgen.depth_max', 'Max depth'], ['depthMin', 'advgen.depth_min', 'Min depth'],
  ['speedIn', 'advgen.speed_in', 'In speed'], ['speedOut', 'advgen.speed_out', 'Out speed'],
  ['accelIn', 'advgen.accel_in', 'In accel'], ['accelOut', 'advgen.accel_out', 'Out accel'],
];
const MOD = [['amount', 'mod.amount', 'Amp'], ['rise', 'mod.rise', 'To min'], ['hold', 'mod.hold', 'At min'],
  ['fall', 'mod.fall', 'To max'], ['rest', 'mod.rest', 'At max'], ['phase', 'mod.phase', 'Offset']];
const CLASSIC = [['pSpeed', 'pattern.speed', 'Speed'], ['pDepth', 'pattern.depth', 'Depth'],
  ['pStroke', 'pattern.stroke', 'Stroke'], ['pSensation', 'pattern.sensation', 'Sensation']];
// RFC-095: the dwells, flats on the stroke picture when the hub carries them.
const DWELL = [['dwellCrest', 'advgen.dwell_crest', 'Crest dwell'], ['dwellTrough', 'advgen.dwell_trough', 'Trough dwell']];
export const DWELL_CAP = 0.25;                     // share of the plot a flat takes before it is drawn cut
export const DWELL_SPAWN = 0.01;                   // strokes a plus writes
const DWELL_OFF = 36;                              // viewBox units: a dwell pill sits this far off its bound
const LADDER = { pending: 'waiting', overdue: 'still waiting', fault: 'refused' };
const RANK = { pending: 1, overdue: 2, fault: 3 };
const DRAG_GAIN = 0.5;                              // handle travel per pointer travel
const DRAG_FINE = DRAG_GAIN / 10;                  // Shift (DESIGN 10.5)
const KEYS = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10, Home: 'min', End: 'max' };

// ---- geometry (pure; test/plugins.test.mjs drives it) ----------------------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Largest power of ten strictly below the field's span (100 -> 10, 1000 -> 100). */
const decadeBelow = (f) => {
  const sp = Math.abs((f.max ?? 0) - (f.min ?? 0));
  return sp > 0 && Number.isFinite(sp) ? 10 ** (Math.ceil(Math.log10(sp)) - 1) : 1;
};
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
/** Control offset / half width = 1/(2+9A); inverted. */
export const accelForEase = (e) => clamp((1 / e - 2) / 9, 0, 1);
/** The speed (units) that puts the turn at share r of the stroke time, the other half kept. */
export function speedInAt(p, r) {
  return gain(p.aIn) * (1 - r) * p.sOut / (gain(p.aOut) * r);
}
export function speedOutAt(p, r) {
  return gain(p.aOut) * r * p.sIn / (gain(p.aIn) * (1 - r));
}
/**
 * Linked: the speeds (units) that put the turn at share r while 1/sIn + 1/sOut
 * = U holds. q is (1/sIn) / (1/sOut).
 */
export function linkedInAt(p, r, U) {
  const q = r / (1 - r) * gain(p.aOut) / gain(p.aIn);
  return (1 + q) / (q * U);
}
export function linkedOutAt(p, r, U) {
  const q = r / (1 - r) * gain(p.aOut) / gain(p.aIn);
  return (1 + q) / U;
}

// The link, in whole field steps. T = 1/in + 1/out is the period at a fixed master.
/** The whole values one half may take with T held and its partner inside [lo, hi]. */
export function linkSpan(T, lo, hi) {
  const a = 1 / (T - 1 / hi);
  const b = T - 1 / lo > 0 ? 1 / (T - 1 / lo) : hi;
  return [Math.max(lo, Math.ceil(a - 1e-9)), Math.min(hi, Math.floor(b + 1e-9))];
}
/** The whole partner of v with T held: of floor and ceil, the one whose 1/x misses T - 1/v least. */
export function linkPartner(T, v, lo, hi) {
  const want = T - 1 / v;
  const x = 1 / want;
  const [a, b] = [Math.floor(x), Math.ceil(x)].map((y) => clamp(y, lo, hi));
  return Math.abs(1 / a - want) <= Math.abs(1 / b - want) ? a : b;
}
/**
 * Link on: master x k, each half / k with k = min(2, mhi / master), so the
 * physical speeds master x half stay. Null when master is 0 or at its top.
 * Rounding: of the four floor/ceil pairs of in/k and out/k, the one whose
 * 1/in' + 1/out' misses k (1/in + 1/out) least, the least period error.
 */
export function linkRescale(m, a, b, mhi, lo, hi) {
  const m2 = Math.min(2 * m, mhi);
  if (!(m > 0) || !(m2 > m)) return null;
  const k = m2 / m, T = k * (1 / a + 1 / b);
  let best = null;
  for (const x of [Math.floor(a / k), Math.ceil(a / k)]) {
    for (const y of [Math.floor(b / k), Math.ceil(b / k)]) {
      const i = clamp(x, lo, hi), o = clamp(y, lo, hi), e = Math.abs(1 / i + 1 / o - T);
      if (!best || e < best.e - 1e-12) best = { master: m2, in: i, out: o, e };
    }
  }
  return best;
}

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
 * The stroke picture. p: {lo, hi} depth shares, {sIn, sOut, aIn, aOut} units,
 * {dt, dc} trough and crest dwell in strokes (optional). L: {X0, XR, YT, YB}.
 * The stroke always spans X0..XR: trough flat, in half, crest flat, out half.
 * A dwell's clock is one stroke, the two moving halves (RFC-095).
 */
export function strokeGeom(p, L) {
  const y = (u) => L.YB - u * (L.YB - L.YT);
  const g = { p, L, ylo: y(p.lo), yhi: y(p.hi), span: p.hi - p.lo };
  const tIn = halfTime(g.span, p.sIn, p.aIn), tOut = halfTime(g.span, p.sOut, p.aOut);
  g.ok = !!(tIn && tOut);
  if (!g.ok) return g;
  const M = tIn + tOut, W = L.XR - L.X0, cap = DWELL_CAP * W;
  const t = { trough: Math.max(0, p.dt || 0) * M, crest: Math.max(0, p.dc || 0) * M };
  // A cut flat takes the cap and the rest share what is left; cutting one only
  // widens the others, so a flat once cut stays cut.
  const cut = { trough: false, crest: false };
  let k = 0;
  for (let i = 0; i < 3; i++) {
    k = (W - (cut.trough + cut.crest) * cap) / (M + (cut.trough ? 0 : t.trough) + (cut.crest ? 0 : t.crest));
    const more = ['trough', 'crest'].filter((f) => !cut[f] && t[f] * k > cap);
    if (!more.length) break;
    for (const f of more) cut[f] = true;
  }
  const w = (f) => (cut[f] ? cap : t[f] * k);
  Object.assign(g, { k, M, tIn, tOut, cut });
  g.xt = L.X0;
  g.x0 = g.xt + w('trough');
  g.x1 = g.x0 + k * tIn;
  g.xc = g.x1 + w('crest');
  g.x2 = g.xc + k * tOut;
  g.mw = k * M;
  const dIn = k * accTime(g.span, p.sIn, p.aIn), dOut = k * accTime(g.span, p.sOut, p.aOut);
  g.inC = [g.x0, g.ylo, g.x0 + dIn, g.ylo, g.x1 - dIn, g.yhi, g.x1, g.yhi];
  g.outC = [g.xc, g.yhi, g.xc + dOut, g.yhi, g.x2 - dOut, g.ylo, g.x2, g.ylo];
  const mid = (g.ylo + g.yhi) / 2;
  g.deep = { x: g.x1, y: g.yhi };
  g.shallow = { x: g.x2, y: g.ylo };
  g.vIn = { x: (g.x0 + g.x1) / 2, y: mid };
  g.vOut = { x: (g.xc + g.x2) / 2, y: mid };
  g.aIn = onCurve(g.inC, g.x0 + TANGENT * dIn);
  g.aOut = onCurve(g.outC, g.x2 - TANGENT * dOut);
  // Flats [x from, x to, y]; a dwell pill rides its guide off the bound, toward
  // the other bound, else the other way when that would leave the plot.
  g.flat = { trough: [g.xt, g.x0, g.ylo], crest: [g.x1, g.xc, g.yhi] };
  const off = (y0, d) => (y0 + d * DWELL_OFF >= L.YT && y0 + d * DWELL_OFF <= L.YB ? y0 + d * DWELL_OFF : y0 - d * DWELL_OFF);
  g.pill = { trough: { x: g.x0, y: off(g.ylo, -1) }, crest: { x: g.xc, y: off(g.yhi, 1) } };
  return g;
}

/**
 * The dwell (strokes) whose flat end sits at x: drawn to scale against
 * drag-start g with this flat uncut, so the pill tracks the pointer and the
 * value grows without bound toward the plot's right edge. A cut flat maps the
 * pointer piecewise so the grab point keeps its value and the flat's start is 0.
 */
export function dwellAt(which, g, x) {
  const W = g.L.XR - g.L.X0, cap = DWELL_CAP * W, M = g.M;
  const other = which === 'crest' ? 'trough' : 'crest';
  const oT = Math.max(0, (which === 'crest' ? g.p.dt : g.p.dc) || 0) * M;
  const F = g.cut[other] ? cap : 0, Tf = M + (g.cut[other] ? 0 : oT);
  // Before this flat: px held by a cut trough, time otherwise.
  const Apx = which === 'crest' && g.cut.trough ? cap : 0;
  const At = which === 'crest' ? g.tIn + (g.cut.trough ? 0 : oT) : 0;
  const share = (xx) => (xx - g.L.X0 - Apx) / (W - F);
  const u0 = Math.max(0, (which === 'crest' ? g.p.dc : g.p.dt) || 0) * M;
  const r0 = (At + u0) / (Tf + u0), rs = At / Tf, rh = share(g.pill[which].x);
  let r = share(x);
  if (rh < r0 - 1e-9) r = r <= rh ? rs + (r - rs) * (r0 - rs) / (rh - rs) : r0 + (r - rh) * (1 - r0) / (1 - rh);
  return r >= 1 ? Infinity : Math.max(0, (r * Tf - At) / (1 - r)) / M;
}

// The in half's share of the moving time, from the half's width at the pill.
const inShare = (g, wIn) => clamp(wIn / g.mw, 0.01, 0.99);

/** A handle at (x, y) of drag-start geometry g, as its field's raw value. */
export const strokeValue = {
  depth: (f, g, x, y) => fromFrac(f, (g.L.YB - y) / (g.L.YB - g.L.YT)),
  // A speed pill sits mid-half, so its half is 2 (x - x0) wide (in) or 2 (x2 - x) (out).
  // U: linked, 1/sIn + 1/sOut held (units); 0, unlinked.
  speedIn: (f, g, x, y, U) => {
    const r = inShare(g, 2 * (x - g.x0));
    return valueOf(f, U ? linkedInAt(g.p, r, U) : speedInAt(g.p, r));
  },
  speedOut: (f, g, x, y, U) => {
    const r = 1 - inShare(g, 2 * (g.x2 - x));
    return valueOf(f, U ? linkedOutAt(g.p, r, U) : speedOutAt(g.p, r));
  },
  accelIn: (f, g, x) => valueOf(f, accelForEase(Math.max(x - g.x0, 1e-3) / (TANGENT * (g.x1 - g.x0)))),
  accelOut: (f, g, x) => valueOf(f, accelForEase(Math.max(g.x2 - x, 1e-3) / (TANGENT * (g.x2 - g.xc)))),
  dwellCrest: (f, g, x) => dwellAt('crest', g, x),
  dwellTrough: (f, g, x) => dwellAt('trough', g, x),
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

const MIN_TRAVEL_MM = 0.25, REST_S = 0.05;           // Nucleus PatternEngine kMinTravelMm, kRestUs

/**
 * The planned motion over windowS seconds, as [[t, position share]], the way
 * AdvancedGenerator runs it: half-strokes count up from 0 (even in toward max
 * depth, odd out), each from where the last landed. A half takes the
 * trapezoid d/v + v/a (v = master x half x ceiling, floor 1; a = v^2/d x
 * (1 + 9 knob)) and holds its dwell x (this half + the one before; the run's
 * first counts twice). A half under 0.25 mm is a 50 ms rest and owes no dwell.
 * p: {master, dMin, dMax, speedIn, speedOut, accelIn, accelOut, dwellCrest,
 * dwellTrough} shares and strokes; span (mm), ceiling (mm/s); refs: the
 * modulator's pull-to value per key, default 0; mods: per key {amount (ratio),
 * rise, hold, fall, rest, phase}. Every control takes BaseControl::modifiedValue
 * = v - (v - ref) x amount x dropAt(cycle); ref is the other depth for the
 * depth pair. px: the strip's width, which caps the samples per half.
 */
export function planMotion(p, windowS, px = 600) {
  const out = [];
  const { span, ceiling } = p;
  if (!(span > 0 && ceiling > 0 && p.master > 0 && windowS > 0)) return out;
  const mv = (key, base, ref, i) => {
    const m = p.mods && p.mods[key], n = m ? m.rise + m.hold + m.fall + m.rest : 0;
    if (!(m && m.amount > 0 && n > 0)) return base;
    return base - (base - ref) * m.amount * dropAt((((i >> 1) + m.phase) % n + n) % n, m);
  };
  const ref = (key) => (p.refs && p.refs[key]) || 0;
  let t = 0, y = p.dMin, done = false;
  const add = (tt, yy) => {
    if (done) return;
    if (tt >= windowS) {
      out.push([windowS, y + (yy - y) * (tt > t ? (windowS - t) / (tt - t) : 1)]);
      done = true;
      return;
    }
    out.push([tt, yy]);
    t = tt;
    y = yy;
  };
  add(0, p.dMin);
  let prev = 0;
  for (let i = 0; !done && i < 20000; i++) {
    const inH = i % 2 === 0;
    const tgt = clamp(inH ? mv('dMax', p.dMax, p.dMin, i) : mv('dMin', p.dMin, p.dMax, i), 0, 1);
    const d = Math.abs(tgt - y) * span;
    if (d < MIN_TRAVEL_MM) { prev = 0; add(t + REST_S, y); continue; }
    const sk = inH ? 'speedIn' : 'speedOut', ak = inH ? 'accelIn' : 'accelOut', dk = inH ? 'dwellCrest' : 'dwellTrough';
    const v = Math.max(1, p.master * Math.max(0, mv(sk, p[sk], ref(sk), i)) * ceiling), A = clamp(mv(ak, p[ak], ref(ak), i), 0, 1);
    const T = halfTime(d, v, A), ta = accTime(d, v, A), y0 = y, t0 = t;
    const N = clamp(Math.ceil(T / windowS * px / 3), 2, 24);
    for (let k = 1; k <= N; k++) {
      const u = T * k / N;
      const sh = u < ta ? u * u / (2 * ta * (T - ta)) : u > T - ta ? 1 - (T - u) ** 2 / (2 * ta * (T - ta)) : (ta / 2 + u - ta) / (T - ta);
      add(t0 + u, y0 + (tgt - y0) * sh);
    }
    add(t + Math.max(0, mv(dk, p[dk] || 0, ref(dk), i)) * (T + (prev || T)), tgt);
    prev = T;
  }
  return out;
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

// ---- labels: beside the handle, clear of the line (pure, px) ----------------

const COMPASS = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
const away = (pts, r) => pts.reduce((m, p) => Math.min(m, Math.hypot(
  Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h))), Infinity);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** A polyline with no gap over step px, so a point test cannot slip between samples. */
export function densify(poly, step = 2) {
  const out = [];
  poly.forEach((p, i) => {
    const q = poly[i + 1];
    out.push(p);
    if (!q) return;
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step);
    for (let j = 1; j < n; j++) out.push([p[0] + (q[0] - p[0]) * j / n, p[1] + (q[1] - p[1]) * j / n]);
  });
  return out;
}
function normalAt(lines, x, y) {
  let best = null, bd = Infinity;
  for (const l of lines) l.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = [l, i]; } });
  if (!best) return [0, 1];
  const [l, i] = best, a = l[Math.max(0, i - 3)], b = l[Math.min(l.length - 1, i + 3)];
  const tx = b[0] - a[0], ty = b[1] - a[1], n = Math.hypot(tx, ty) || 1;
  return [-ty / n, tx / n];
}
/**
 * Labels in px. items: {x, y, w, h} (handle center, label size); lines:
 * densified polylines; marks: [x, y, clearance px (default 8)], the handles
 * and any control on the plot. A label tries the eight sides of its handle,
 * squarest to the line's local tangent first, at gap G, then the eight again
 * one to four label heights further out; it takes the first inside the box,
 * clear of the lines, of the marks and of labels already placed, then of the
 * plot's own text (fixed, {x, y, w, h}), which yields first. The label with
 * the fewest open sides places first. None clear: the clearest, with a
 * backing (bg), preferring one clear of the hard marks (m[3]: a plus button) first, then of the lines, then of the handles.
 */
export function placeLabels(items, lines, marks, W, H, fixed = [], G = 8) {
  const pts = lines.flat(), placed = [], out = [];
  const all = items.map((it) => {
    const n = normalAt(lines, it.x, it.y);
    const ring = (gap) => COMPASS.map(([ux, uy]) => {
      const r = { x: it.x + ux * (gap + it.w / 2) - it.w / 2, y: it.y + uy * (gap + it.h / 2) - it.h / 2, w: it.w, h: it.h };
      return { r, pref: Math.abs(ux * n[0] + uy * n[1]) / Math.hypot(ux, uy), line: away(pts, r),
        mark: marks.every((m) => (m[0] === it.x && m[1] === it.y) || away([m], r) > (m[2] || 8)),
        hard: marks.every((m) => !m[3] || away([m], r) > m[2]),
        text: !fixed.some((q) => overlaps(r, q)), inside: r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H };
    }).sort((a, b) => b.pref - a.pref);
    return [...ring(G), ...ring(G + it.h), ...ring(G + 2 * it.h), ...ring(G + 3 * it.h), ...ring(G + 4 * it.h)];
  });
  const open = (c) => c.inside && c.line > 1.5 && c.mark;
  // The label with the fewest open sides picks first (a stable sort: ties keep handle order).
  for (const [i] of all.map((c, i) => [i, c.filter(open).length]).sort((a, b) => a[1] - b[1])) {
    const cands = all[i].map((c) => ({ ...c, free: !placed.some((q) => overlaps(c.r, q)) }));
    const clear = (c) => open(c) && c.free;
    let pick = cands.find((c) => clear(c) && c.text) || cands.find(clear);
    const bg = !pick;
    if (!pick) pick = [...cands].sort((a, b) => (b.free - a.free) || (b.inside - a.inside) || (b.hard - a.hard) || ((b.line > 1.5) - (a.line > 1.5)) || (b.mark - a.mark) || (b.line - a.line))[0];
    placed.push(pick.r);
    out[i] = { dx: pick.r.x - items[i].x, dy: pick.r.y - items[i].y, bg };
  }
  return out;
}

// ---- DOM helpers -----------------------------------------------------------

const CSS = `
.ap { display: flex; flex-direction: column; gap: var(--gap); }
.ap [hidden] { display: none !important; }
.ap-tabs { display: grid; grid-template-columns: 1fr 1fr; }
.ap-tabs button, .ap-mtab { min-height: var(--tap); background: none; border: 1px solid var(--line); color: var(--tx-mut);
  font: 500 .82rem/1.2 var(--font); }
.ap-tabs button { cursor: pointer; }
.ap-tabs button:hover, .ap-mtab:hover { border-color: var(--line-4); color: var(--tx); }
.ap-tabs button[aria-selected=true], .ap-mtab:has([aria-selected=true]) { color: var(--highlight); border-color: var(--highlight); }
.ap-mtab { display: flex; align-items: stretch; min-width: 0; }
.ap-mtab > button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 0 6px; }
.ap-mtab [role=tab] { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; }
.ap-mtab [role=tab] > span { min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow-wrap: anywhere; text-align: center; }
.ap-mon { flex: none; padding: 0 6px; gap: 0; }
.ap-mon .track { width: 28px; height: 16px; }
.ap-mon .track::after { width: 10px; height: 10px; }
.ap-mon input:checked + .track::after { transform: translateX(12px); }
.ap-mon:has(input:disabled) { cursor: default; opacity: .4; }
.ap-mtrash { flex: none; display: grid; place-items: center; color: var(--tx-mut); }
.ap-mtrash svg, .ap-tool svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ap-mtab button:disabled { cursor: default; opacity: .4; }
.ap-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ap-row > select, .ap-row > input { flex: 1 1 180px; min-height: var(--tap); }
.ap-row .og-btn, .ap-run { min-height: var(--tap); }
.ap-run { flex: 1 1 200px; }
.ap-ctl { display: flex; flex-direction: column; }
.ap-ctl label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
:is(.ap-ctl label, .ap-num) > span { font: 500 .76rem var(--font); color: var(--tx-mut); text-transform: lowercase; letter-spacing: .04em; }
.ap-ctl output { display: inline-flex; align-items: center; padding: 1px 6px; font: var(--num-wght) .76rem var(--mono); font-variation-settings: 'wdth' 90;
  color: var(--tx-val); background: var(--screen); box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6);
  border: 1px solid var(--line-1); border-radius: var(--r-s); }
.ap-ctl .unit { margin-left: 3px; font: 500 .64rem var(--font); color: var(--tx-ghost); }
.ap-ctl input[type=range] { margin: 6px 0; }
.ap-note { margin: 0; height: 1.45em; line-height: 1.45; font-size: .74rem; color: var(--ink-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ap-note[data-slot=pending] { color: var(--intent); }
.ap-note:is([data-slot=overdue], [data-slot=fault]) { color: var(--warn); }
.ap-note[data-slot=confirmed] { color: color-mix(in srgb, var(--reality) calc(var(--ga, 0) * 100%), var(--tx-mut)); }
.ap-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px 10px; }
.ap-num { display: flex; flex-direction: column; gap: 2px; }
.ap .ap-num input { font-family: var(--mono); background: var(--screen); box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6); }
.ap-num:is([data-status=draft], [data-status=pending]) input { border-style: dashed; border-color: var(--intent); }
.ap-num:is([data-status=overdue], [data-status=fault]) input { border-color: var(--warn); }
.ap-row .ap-tool { flex: none; width: var(--tap); padding: 0; display: grid; place-items: center; color: var(--tx-mut); }
.ap-row .ap-tool[aria-pressed=true] { color: var(--highlight); border-color: var(--highlight); }
.ap-cap { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-family: var(--mono); font-size: .7rem; color: var(--tx-mut); }
.ap-ed { position: relative; width: 100%; background: var(--screen); box-shadow: inset 0 2px 6px rgba(var(--shade-rgb), .65);
  border: 1px solid var(--line-1); border-radius: var(--r-s); touch-action: none; user-select: none; }
.ap-ed svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ap-stroke { height: 240px; }
.ap-stair { height: 180px; }
.ap-plan { display: flex; gap: 8px; align-items: stretch; }
.ap-plan > .ap-ed { flex: 1 1 auto; min-width: 0; height: 120px; touch-action: auto; }
.ap-win { flex: none; width: var(--tap); display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; }
.ap-win button { flex: none; width: 100%; height: var(--tap); padding: 0; display: grid; place-items: center; color: var(--tx-mut); }
.ap-win output { text-align: center; font: var(--num-wght) .76rem var(--mono); color: var(--tx-val); }
.ap-gl { position: absolute; bottom: 2px; transform: translateX(-50%); font: .62rem var(--mono); color: var(--tx-ghost); pointer-events: none; }
.ap-ed path, .ap-ed line, .ap-ed polyline { fill: none; vector-effect: non-scaling-stroke; }
.ap-ed .curve { stroke: var(--reality); stroke-width: 2; }
.ap-ed .curve.intent { stroke: var(--intent); }
.ap-ed .guide { stroke: var(--line-2); stroke-dasharray: 4 4; }
.ap-ed .grid { stroke: var(--line); }
.ap-ed .vguide { stroke: var(--tx-ghost); stroke-width: 1.5; }
.ap-ed .vguide.thin { stroke-width: 1; }
.ap-ed .cut { stroke: var(--reality); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 0 6; }
.ap-ed .cut.intent { stroke: var(--intent); }
.ap-plus { position: absolute; width: var(--tap); height: var(--tap); margin: calc(var(--tap) / -2) 0 0 calc(var(--tap) / -2); padding: 0;
  display: grid; place-items: center; background: none; border: 0; cursor: pointer; color: var(--tx-mut); z-index: 2; }
.ap-stair .ap-plus { margin: 0; padding: 4px; place-items: start; transform: translate(6px, 8px); }   /* off its corner handle: never over it */
.ap-plus > i { width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid var(--line-2); border-radius: 50%;
  background: var(--screen); box-shadow: inset 0 1px 3px rgba(var(--shade-rgb), .65); font: 600 14px/1 var(--mono); pointer-events: none; }
.ap-plus:is(:hover, :focus-visible) { color: var(--highlight); outline: none; }
.ap-plus:hover > i { border-color: var(--highlight); }
.ap-plus:focus-visible > i { outline: 2px solid var(--highlight); outline-offset: 2px; }
.ap-ed .fill { fill: var(--intent); opacity: .12; }
.ap-ax { position: absolute; left: 4px; transform: translateY(-50%); font: .66rem var(--mono); color: var(--tx-ghost); pointer-events: none; }
.ap-seg { position: absolute; bottom: 30px; transform: translateX(-50%); font: .66rem var(--mono); color: var(--tx-mut); pointer-events: none; white-space: nowrap; }
.ap-h { position: absolute; width: var(--tap); height: var(--tap); margin: calc(var(--tap) / -2) 0 0 calc(var(--tap) / -2); outline: none; }
.ap-h::after { content: ''; position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px;
  border-radius: 50%; border: 2px solid var(--hc, var(--reality)); background: var(--screen); box-shadow: inset 0 1px 3px rgba(var(--shade-rgb), .65);
  box-sizing: border-box; }
.ap-h[data-shape=vpill]::after { width: 9px; height: 20px; margin: -10px -4.5px; border-radius: 4.5px; }
.ap-h[data-shape=hpill]::after { width: 20px; height: 9px; margin: -4.5px -10px; border-radius: 4.5px; }
.ap-h[data-shape=diamond]::after { border-radius: 2px; transform: rotate(45deg); }
.ap-h[data-shape=tri]::after { border-radius: 0; width: 0; height: 0; border-width: 0 7px 12px; border-color: transparent transparent var(--hc, var(--reality)); background: none; }
.ap-h:not(.off):hover::after { outline: 1px solid var(--highlight); outline-offset: 2px; }
.ap-h:focus-visible::after { outline: 2px solid var(--highlight); outline-offset: 2px; }
.ap-h:is([data-status=draft], [data-status=pending]) { --hc: var(--intent); }
.ap-h:is([data-status=draft], [data-status=pending]):not([data-shape=tri])::after { border-style: dashed; }
.ap-h:is([data-status=overdue], [data-status=fault]) { --hc: var(--warn); }
.ap-h[data-status=fault] .ap-tag { color: var(--warn); }
.ap-h.off { opacity: .4; }
.ap-tag { position: absolute; left: calc(50% + 12px); top: calc(50% + 4px); white-space: nowrap; font: .7rem/1.3 var(--mono); color: var(--reality);
  pointer-events: none; padding: 0 3px; border-radius: 4px; }
.ap-tag.bg { background: color-mix(in srgb, var(--screen) 85%, transparent); }
.ap-tag:empty { display: none; }
.ap-play { position: absolute; width: 14px; height: 14px; margin: -7px; border-radius: 50%; background: var(--intent); border: 2px solid var(--screen); box-sizing: border-box; pointer-events: none; z-index: 1; }
.ap h4 { margin: 0; font: 500 .8rem var(--font); text-transform: uppercase; letter-spacing: .12em; color: var(--tx-val); white-space: nowrap; }
.ap-hint { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ap-mtabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 4px; }
.ap-mtabs [role=tab]::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--line-2); }
.ap-mtabs [role=tab][data-on=true]::before { background: var(--reality); }
.ap-narrow :is(.ap-hint, .ap-ax) { display: none; }
.ap-narrow .ap-mtabs { grid-template-columns: 1fr 1fr; }
.ap-narrow .ap-mtabs [role=tab]::before { display: none; }
@media (pointer: coarse) { .ap-mon, .ap-mtrash { min-width: var(--tap); } }
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
/** A plus that spawns a hold: a touch-sized button around an 18 px dot, the dot a label keeps off. */
function plusBtn(label, spawn) {
  const b = h('button', { type: 'button', class: 'ap-plus', 'aria-label': label, title: label }, h('i', { text: '+', 'aria-hidden': 'true' }));
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', spawn);
  return b;
}
const on = (v) => v === true || Number(v) === 1;
const num = (v) => String(+Number(v).toFixed(2));
/** A one-line note slot: the gate, else the words (the ladder's by default), styled by its state. */
function say(note, gate, st, words = LADDER[st]) {
  note.textContent = note.title = gate || words || '';
  note.dataset.slot = gate ? 'gate' : words ? st : '';
}
const cpath = (c) => 'M' + c[0] + ' ' + c[1] + ' C' + c.slice(2).join(' ');

export function activate(api) {
  api.registerHero({
    id: 'advanced',
    title: 'Pattern',
    replaces: ['advanced-generator', 'pattern'],
    cells: { h: [12, 16], v: [8, 24] },
    spec: {
      // RFC-093: the advanced generator runs on its own advgen.running.
      require: { advRun: 'advgen.running', master: 'advgen.master', ...Object.fromEntries(BASE.map(([k, r]) => [k, r])) },
      optional: {
        running: 'pattern.running', bgRun: 'source.background_run', presetOp: 'action.store',
        select: 'pattern.select', ...Object.fromEntries([...CLASSIC, ...DWELL].map(([k, r]) => [k, r])),
      },
      // A modulator is one entry carrying all six roles (RFC-066); no minimum.
      instances: { mods: { min: 0, roles: Object.fromEntries(MOD.map(([k, r]) => [k, r])) } },
    },
    mount: (el, fields) => mountCard(api, el, fields),
  });
}

// ---- the editor shell: handles over an SVG, drag and keys, one write per release

// ed: the card's one edit path {val, has, preview, commit} (mountCard).
function makeEditor(api, o, ed) {
  const svg = s('svg', { viewBox: '0 0 ' + o.W + ' ' + o.H, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const box = h('div', { class: 'ap-ed ' + o.cls }, svg);
  const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
  let drag = null;
  const { val } = ed;
  const geom = () => o.geom(val, drag ? drag.g0 : null, box);
  // axis: 'x' (default) left-right, 'y' up-down, 'xy' any; the shape says which (header).
  const hs = o.handles.filter((d) => d.field).map((d) => {
    const shape = d.shape || (d.axis === 'y' ? 'hpill' : d.axis === 'xy' ? 'dot' : 'vpill');
    const el = h('div', { class: 'ap-h', role: 'slider', tabindex: '0', 'aria-label': d.label,
      'data-key': d.key, 'data-shape': shape, 'aria-orientation': d.axis === 'y' ? 'vertical' : 'horizontal' });
    const tag = h('span', { class: 'ap-tag' });
    el.append(tag);
    const hd = { ...d, el, tag };
    el.addEventListener('blur', () => ed.commit(hd.field));
    el.addEventListener('keydown', (e) => nudge(hd, e));
    el.addEventListener('keyup', (e) => { if (e.key in KEYS) ed.commit(hd.field); });
    return hd;
  });
  box.append(...(o.decor || []), ...hs.map((hd) => hd.el));
  if (o.svgKids) svg.append(...o.svgKids);

  function nudge(hd, e) {
    const f = hd.field;
    const k = KEYS[e.key];
    if (k === undefined || api.gate(f)) return;
    e.preventDefault();
    // DESIGN 10.5, inlined: Shift on a key is the declared step (never finer: an off-grid value is NACKed);
    // Ctrl is the adjacent decade multiple that way, one notch per press.
    const st = f.step || 1, cur = val(f);
    let v;
    if (k === 'min') v = f.min;
    else if (k === 'max') v = f.max;
    else if (e.ctrlKey) {
      const d = Math.max(st, decadeBelow(f)), q = cur / d;
      v = (k > 0 ? Math.floor(q + 1e-9) + 1 : Math.ceil(q - 1e-9) - 1) * d;
    } else v = cur + (e.shiftKey ? Math.sign(k) : k) * st;
    ed.preview(f, v);
  }
  const local = (e) => {
    const r = box.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * o.W, y: (e.clientY - r.top) / r.height * o.H };   // unclamped: half gain must travel past the edge
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
    const h0 = best.at(g), p0 = local(e);
    drag = { hd: best, g0: g, id: e.pointerId, h0, p0, gain: e.shiftKey ? DRAG_FINE : DRAG_GAIN };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = local(e), f = drag.hd.field;
    // Relative to the grab, scaled; a gain change (Shift) re-anchors so the handle never jumps.
    const gain = e.shiftKey ? DRAG_FINE : DRAG_GAIN;
    const at = () => ({ x: clamp(drag.h0.x + (p.x - drag.p0.x) * drag.gain, 0, o.W), y: clamp(drag.h0.y + (p.y - drag.p0.y) * drag.gain, 0, o.H) });
    if (gain !== drag.gain) { drag.h0 = at(); drag.p0 = p; drag.gain = gain; }
    const q = at();
    let v = drag.hd.value(f, drag.g0, q.x, q.y);
    if (e.ctrlKey && Number.isFinite(v)) { const d = Math.max(f.step || 1, decadeBelow(f)); v = Math.round(v / d) * d; }
    if (Number.isFinite(v)) ed.preview(f, v);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const f = drag.hd.field;
    drag = null;
    ed.commit(f);
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  function render() {
    const g = geom();
    o.draw(g, val, box);
    let gate = '', worst = '';
    const who = [];
    for (const hd of hs) {
      const f = hd.field;
      const p = hd.at(g);
      hd.el.hidden = !p;
      const fg = api.gate(f);
      gate = gate || fg;
      const st = ed.has(f) ? 'draft' : api.status(f);
      const v = val(f);
      if ((RANK[st] || 0) > (RANK[worst] || 0)) { worst = st; who.length = 0; }
      if (st === worst) who.push(hd.text(v) || hd.label.toLowerCase() + ' ' + num(v));
      if (!p) continue;
      hd.el.style.left = (p.x / o.W * 100) + '%';
      hd.el.style.top = (p.y / o.H * 100) + '%';
      hd.el.dataset.status = st;
      hd.el.classList.toggle('off', !!fg);
      hd.el.setAttribute('aria-disabled', String(!!fg));
      hd.el.setAttribute('aria-valuenow', String(v));
      hd.el.setAttribute('aria-valuemin', String(f.min));
      hd.el.setAttribute('aria-valuemax', String(f.max));
      hd.tag.textContent = hd.text(v);
    }
    // The ladder in words rides the note, never a tag, so no state change can move a label.
    say(note, gate, worst, worst && who.join(', ') + ' · ' + LADDER[worst]);
    box.classList.toggle('ap-stale', hs.some((hd) => api.stale(hd.field)));
    labels(g);
  }
  // Labels in px: the plot stretches, so they are placed against the box as laid out.
  function labels(g) {
    const bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    const px = ([x, y]) => [x / o.W * bw, y / o.H * bh];
    const shown = hs.filter((hd) => !hd.el.hidden);
    const marks = shown.map((hd) => px([hd.at(g).x, hd.at(g).y]));
    const tagged = shown.filter((hd) => hd.tag.textContent);
    const lines = o.lines(g).map((l) => densify(l.map(px)));
    const measure = () => tagged.map((hd) => {
      const [x, y] = px([hd.at(g).x, hd.at(g).y]);
      return { x, y, w: hd.tag.offsetWidth, h: hd.tag.offsetHeight };
    });
    // Client rects in layout px: a UI scale (zoom or transform) divides out.
    const b0 = box.getBoundingClientRect(), z = b0.width / bw || 1;
    const rel = (e) => {
      const r = e.getBoundingClientRect();
      return { x: (r.left - b0.left) / z, y: (r.top - b0.top) / z, w: r.width / z, h: r.height / z };
    };
    box.querySelectorAll(':scope > .ap-cap[hidden]').forEach((e) => { e.hidden = false; });   // a caption a label covered returns on the next clear render
    const fixed = [...box.querySelectorAll(':scope > :is(.ap-seg, .ap-cap, .ap-ax):not([hidden])')].map(rel);
    // A plus is a control: a label keeps off its dot like off a handle.
    const dots = [...box.querySelectorAll(':scope > .ap-plus:not([hidden]) > i')].map(rel).map((q) => [q.x + q.w / 2, q.y + q.h / 2, q.w / 2 + 2, true]);
    let items = measure(), res = placeLabels(items, lines, [...marks, ...dots], bw, bh, fixed);
    // No clear side: a three-word label drops its first word (the side, which its half shows) and all place again.
    if (res.some((r, i) => r.bg && /^\S+ \S+ \S+$/.test(tagged[i].tag.textContent))) {
      res.forEach((r, i) => { if (r.bg) tagged[i].tag.textContent = tagged[i].tag.textContent.replace(/^\S+ (?=\S+ \S+$)/, ''); });
      items = measure();
      res = placeLabels(items, lines, [...marks, ...dots], bw, bh, fixed);
    }
    const placed = res.map((r, i) => {
      const t = tagged[i].tag;
      t.style.left = 'calc(50% + ' + r.dx.toFixed(1) + 'px)';
      t.style.top = 'calc(50% + ' + r.dy.toFixed(1) + 'px)';
      t.classList.toggle('bg', r.bg);
      return { x: items[i].x + r.dx, y: items[i].y + r.dy, w: items[i].w, h: items[i].h };
    });
    for (const e of box.querySelectorAll(':scope > .ap-cap')) e.hidden = placed.some((q) => overlaps(q, rel(e)));
    // A segment caption a label could not avoid yields: its word first, then itself.
    for (const e of box.querySelectorAll(':scope > .ap-seg:not([hidden])')) {
      if (!placed.some((q) => overlaps(q, rel(e)))) continue;
      e.textContent = e.dataset.n;
      e.hidden = placed.some((q) => overlaps(q, rel(e)));
    }
  }
  const ro = new ResizeObserver(() => render());
  ro.observe(box);
  ed.loops.push(() => ro.disconnect());
  return { box, note, render };
}

// ---- the card --------------------------------------------------------------

function mountCard(api, el, fields) {
  const F = fields;
  const updaters = [];
  const loops = [];

  // ---- the one edit path: every handle and every numeric twin reads val()
  const draft = new Map();
  const val = (f) => (draft.has(f.uid) ? draft.get(f.uid) : Number(api.value(f)));
  let linked = false;
  try { linked = localStorage.getItem(LINK_KEY) === '1'; } catch (e) { /* private mode */ }
  const partner = (f) => (!linked ? null : f === F.speedIn ? F.speedOut : f === F.speedOut ? F.speedIn : null);
  // T from the written values, never drafts, so rounding cannot walk it mid-edit.
  const period = () => 1 / Number(api.value(F.speedIn)) + 1 / Number(api.value(F.speedOut));
  // Linked, f stays where its partner keeps inside its bounds, and the partner holds T.
  function preview(f, v) {
    const o = partner(f), T = period();
    if (o && Number.isFinite(T)) {
      const [lo, hi] = linkSpan(T, o.min, o.max);
      v = clamp(Math.round(v), Math.max(lo, f.min), Math.min(hi, f.max));
      draft.set(f.uid, v);
      draft.set(o.uid, linkPartner(T, v, o.min, o.max));
    } else draft.set(f.uid, snap(f, v));
    update();
  }
  // Both halves in the same tick: the shadow sends one channel's writes as one intent.
  function commit(f) {
    for (const x of [f, partner(f)]) {
      if (!x || !draft.has(x.uid)) continue;
      const v = draft.get(x.uid);
      draft.delete(x.uid);
      if (v !== Number(api.value(x))) api.write(x, v);
    }
    update();
  }
  const ed = { val, has: (f) => draft.has(f.uid), preview, commit, loops };

  // A field as a number input: the numeric twin of a handle.
  function numCtl(f, label) {
    const input = h('input', { type: 'number', class: 'og-num', min: f.min ?? '', max: f.max ?? '', step: f.step || 1, 'aria-label': label });
    const box = h('label', { class: 'ap-num' }, h('span', { text: label + (f.unit ? ' (' + f.unit + ')' : '') }), input);
    input.addEventListener('input', () => { if (input.value !== '' && Number.isFinite(+input.value)) preview(f, +input.value); });
    input.addEventListener('change', () => commit(f));
    input.addEventListener('blur', () => commit(f));
    updaters.push(() => {
      const st = draft.has(f.uid) ? 'draft' : api.status(f), gate = api.gate(f);
      box.dataset.status = st;
      box.title = gate || LADDER[st] || '';
      input.disabled = !!gate;
      if (document.activeElement !== input) input.value = num(val(f));
    });
    return box;
  }
  // The in/out speed link: on rescales once (linkRescale, one intent), off writes nothing.
  function linkBtn() {
    const btn = h('button', { type: 'button', class: 'og-btn ap-tool ap-link' });
    const draw = () => {
      if (btn.getAttribute('aria-pressed') !== String(linked)) {
        btn.setAttribute('aria-pressed', String(linked));
        btn.setAttribute('aria-label', linked ? 'Unlink in and out speed' : 'Link in and out speed');
        btn.innerHTML = linked
          ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="5.25" width="8" height="5.5" rx="2.75"/><rect x="7" y="5.25" width="8" height="5.5" rx="2.75"/></svg>'
          : '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x=".75" y="5.25" width="6" height="5.5" rx="2.75"/><rect x="9.25" y="5.25" width="6" height="5.5" rx="2.75"/></svg>';
      }
      const [lo, hi] = linkSpan(period(), F.speedOut.min, F.speedOut.max);
      const room = hi > Math.max(lo, F.speedIn.min);
      const m = Number(api.value(F.master));
      btn.title = !linked ? 'Link: shift the peak, keep the period'
        : room ? 'Linked: the peak shifts, the period holds'
          : m >= F.master.max ? 'Lower master to shift the peak' : m > 0 ? 'Relink to make room' : 'Set master, then relink';
    };
    btn.addEventListener('click', () => {
      linked = !linked;
      try { localStorage.setItem(LINK_KEY, linked ? '1' : '0'); } catch (e) { /* private mode */ }
      const r = linked && linkRescale(Number(api.value(F.master)), Number(api.value(F.speedIn)), Number(api.value(F.speedOut)),
        F.master.max, F.speedIn.min, F.speedIn.max);
      // Same tick, one channel: the shadow sends the three keys as one intent.
      if (r && ![F.master, F.speedIn, F.speedOut].some((f) => api.gate(f))) {
        api.write(F.master, r.master);
        api.write(F.speedIn, r.in);
        api.write(F.speedOut, r.out);
      }
      draw();
    });
    updaters.push(draw);
    return btn;
  }
  // The numeric rows: shown on request, default hidden; the handles carry the keys.
  let inputs = false;
  try { inputs = localStorage.getItem(INPUTS_KEY) === '1'; } catch (e) { /* private mode */ }
  const numRows = [];
  function inputsBtn() {
    const btn = h('button', { type: 'button', class: 'og-btn ap-tool ap-inputs', 'aria-label': 'Inputs' });
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';
    const draw = () => {
      btn.setAttribute('aria-pressed', String(inputs));
      btn.title = inputs ? 'Hide inputs' : 'Show inputs';
      for (const r of numRows) r.hidden = !inputs;
    };
    btn.addEventListener('click', () => {
      inputs = !inputs;
      try { localStorage.setItem(INPUTS_KEY, inputs ? '1' : '0'); } catch (e) { /* private mode */ }
      draw();
    });
    updaters.push(draw);
    return btn;
  }
  // A full-width slider (master, the classic knobs): the host's field ring and line
  // (style.css .field, data-shadow), the value chip, the ladder in words under it.
  function slider(f, label) {
    const out = h('output');
    const input = h('input', { type: 'range', min: f.min ?? 0, max: f.max ?? 100, step: f.step || 1, 'aria-label': label });
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    const box = h('div', { class: 'ap-ctl field' }, h('label', {}, h('span', { text: label }), out), input, note);
    // Value then unit, the host's Field chip (format.js formatParts).
    const show = (v) => out.replaceChildren(num(v), ...(f.unit ? [h('span', { class: 'unit', text: f.unit })] : []));
    let held = false, last = 'confirmed', glow = 0;
    input.addEventListener('input', () => { held = true; show(input.value); });
    input.addEventListener('change', () => { held = false; api.write(f, Number(input.value)); });
    // The afterglow: lit by each echo (1 and 2 alternate, so it restarts), ended by its own animation.
    const paint = () => {
      const st = api.status(f), gate = api.gate(f);
      box.dataset.shadow = st;
      if (glow) box.dataset.glow = String(glow); else delete box.dataset.glow;
      say(note, gate, st, glow ? 'confirmed' : LADDER[st]);
    };
    box.addEventListener('animationend', (e) => { if (e.target === box && /^fx-glow/.test(e.animationName)) { glow = 0; paint(); } });
    updaters.push(() => {
      const v = api.value(f), st = api.status(f), stale = api.stale(f);
      glow = st !== 'confirmed' || stale ? 0 : RANK[last] ? (glow === 1 ? 2 : 1) : glow;
      last = st;
      box.classList.toggle('ap-stale', !!stale);
      input.disabled = !!api.gate(f);
      if (!held) { input.value = Number(v); show(v); }
      box.style.setProperty('--fx-f', String(clamp((Number(input.value) - input.min) / (input.max - input.min || 1), 0, 1)));
      paint();
    });
    return box;
  }
  function choice(f, label) {
    const sel = h('select', { 'aria-label': label });
    (f.options || []).forEach((o, i) => sel.append(h('option', { value: String(i), text: String(o).replace(/_/g, ' ') })));
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    const box = h('div', { class: 'ap-ctl field' }, h('label', {}, h('span', { text: label })), sel, note);
    sel.addEventListener('change', () => api.write(f, Number(sel.value)));
    updaters.push(() => {
      const st = api.status(f), gate = api.gate(f);
      box.dataset.shadow = st;
      sel.disabled = !!gate;
      sel.value = String(Number(api.value(f)));
      say(note, gate, st);
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
  const dw = (f) => (f ? Math.max(0, val(f)) : 0);
  const strokeNow = () => strokeGeom({
    lo: fracOf(F.depthMin, val(F.depthMin)), hi: fracOf(F.depthMax, val(F.depthMax)),
    sIn: unitOf(F.speedIn, val(F.speedIn)), sOut: unitOf(F.speedOut, val(F.speedOut)),
    aIn: unitOf(F.accelIn, val(F.accelIn)), aOut: unitOf(F.accelOut, val(F.accelOut)),
    dt: dw(F.dwellTrough), dc: dw(F.dwellCrest),
  }, SL);
  const DRIVEN = [...BASE, ...DWELL].filter(([k]) => F[k]);
  // A dwell: its flat (solid ends, a dotted middle fading out and back in when cut), a
  // thin guide at its end, and a plus at its bound while it is 0.
  const FADE = [0.8, 0.5, 0.2, 0.2, 0.5, 0.8];
  const dwells = [['trough', F.dwellTrough, 'Add trough dwell'], ['crest', F.dwellCrest, 'Add crest dwell']]
    .filter(([, f]) => f).map(([which, f, l]) => {
      const path = s('path', { class: 'curve', 'data-dwell': which });
      const dots = FADE.map((o) => s('line', { class: 'cut', 'data-dwell': which, 'stroke-opacity': o }));
      const guide = s('line', { class: 'vguide thin', 'data-dwell': which, y1: SL.YT, y2: SL.YB });
      const plus = plusBtn(l, () => { ed.preview(f, DWELL_SPAWN); ed.commit(f); });
      return { which, f, path, dots, guide, plus };
    });
  // The plot's 0 and 100 guides: lines a label keeps off, like the stroke.
  const rails = [SL.YT, SL.YB].map((y) => [[SL.X0, y], [SL.XR, y]]);
  const stroke = makeEditor(api, {
    W: 1000, H: 240, cls: 'ap-stroke',
    decor: [...ticks, h('span', { class: 'ap-cap', style: 'position:absolute;right:8px;top:4px', text: 'stroke · shape' }),
      ...dwells.map((d) => d.plus), play],
    svgKids: [
      s('line', { class: 'guide', x1: SL.X0, x2: SL.XR, y1: SL.YT, y2: SL.YT }),
      s('line', { class: 'guide', x1: SL.X0, x2: SL.XR, y1: SL.YB, y2: SL.YB }), pIn, pOut,
      ...dwells.flatMap((d) => [d.guide, d.path, ...d.dots])],
    geom: strokeNow,
    lines: (g) => [...rails, ...(g.ok ? [...[g.inC, g.outC].map((c) => Array.from({ length: 49 }, (_, i) => { const p = bez(c, i / 48); return [p.x, p.y]; })),
      ...dwells.map((d) => g.flat[d.which]).filter(([a, b]) => b > a).map(([a, b, y]) => [[a, y], [b, y]]),
      ...dwells.filter((d) => val(d.f) > 0).map((d) => g.pill[d.which].x).map((x) => [[x, SL.YT], [x, SL.YB]])] : [])],
    draw(g) {
      const intent = DRIVEN.some(([k]) => draft.has(F[k].uid) || /^(pending|overdue)$/.test(api.status(F[k])));
      for (const [p, c] of [[pIn, g.inC], [pOut, g.outC]]) {
        p.setAttribute('d', g.ok ? cpath(c) : '');
        p.classList.toggle('intent', intent);
      }
      for (const d of dwells) {
        const [a, b, y] = g.ok ? g.flat[d.which] : [0, 0, 0];
        const cut = g.ok && g.cut[d.which], wd = b - a;
        // Cut: solid over the outer 30 % each side, the middle 40 % in six dotted runs fading out and in.
        d.path.setAttribute('d', wd <= 0 ? '' : cut ? 'M' + a + ' ' + y + ' H' + (a + 0.3 * wd) + ' M' + (b - 0.3 * wd) + ' ' + y + ' H' + b
          : 'M' + a + ' ' + y + ' H' + b);
        d.path.classList.toggle('intent', intent);
        d.dots.forEach((l, i) => {
          l.toggleAttribute('hidden', !cut);
          for (const [k, v] of [['x1', a + (0.3 + i * 0.4 / 6) * wd], ['x2', a + (0.3 + (i + 1) * 0.4 / 6) * wd], ['y1', y], ['y2', y]]) l.setAttribute(k, v);
          l.classList.toggle('intent', intent);
        });
        const p = g.ok ? g.pill[d.which] : null;
        d.guide.toggleAttribute('hidden', !p);
        if (p) { d.guide.setAttribute('x1', p.x); d.guide.setAttribute('x2', p.x); }
        d.plus.hidden = !p || val(d.f) > 0;
        d.plus.disabled = !!api.gate(d.f);
        if (p) { d.plus.style.left = (p.x / 10) + '%'; d.plus.style.top = (p.y / 240 * 100) + '%'; }
      }
    },
    handles: [
      { key: 'deep', field: F.depthMax, label: 'Max depth', axis: 'y', at: (g) => (g.ok ? g.deep : { x: SL.X0, y: g.yhi }),
        value: SV.depth, text: (v) => 'deep ' + num(v) },
      { key: 'shallow', field: F.depthMin, label: 'Min depth', axis: 'y', at: (g) => (g.ok ? g.shallow : { x: SL.XR, y: g.ylo }),
        value: SV.depth, text: (v) => 'shallow ' + num(v) },
      { key: 'vin', field: F.speedIn, label: 'In speed', at: (g) => g.ok && g.vIn,
        value: (f, g, x, y) => SV.speedIn(f, g, x, y, linked && f.max * period()), text: (v) => 'in ' + num(v) },
      { key: 'vout', field: F.speedOut, label: 'Out speed', at: (g) => g.ok && g.vOut,
        value: (f, g, x, y) => SV.speedOut(f, g, x, y, linked && f.max * period()), text: (v) => 'out ' + num(v) },
      { key: 'ain', field: F.accelIn, label: 'In accel', shape: 'diamond', at: (g) => g.ok && g.aIn, value: SV.accelIn, text: (v) => 'in accel ' + num(v) },
      { key: 'aout', field: F.accelOut, label: 'Out accel', shape: 'diamond', at: (g) => g.ok && g.aOut, value: SV.accelOut, text: (v) => 'out accel ' + num(v) },
      { key: 'trough', field: F.dwellTrough, label: 'Trough dwell', at: (g) => g.ok && g.p.dt > 0 && g.pill.trough,
        value: SV.dwellTrough, text: (v) => 'dwell ' + num(v) },
      { key: 'crest', field: F.dwellCrest, label: 'Crest dwell', at: (g) => g.ok && g.p.dc > 0 && g.pill.crest,
        value: SV.dwellCrest, text: (v) => 'dwell ' + num(v) },
    ],
  }, ed);
  updaters.push(stroke.render);

  // ---- rhythm modifier: one tab per modulator, ordered by the control it rides
  const order = new Map(DRIVEN.map(([k], i) => [F[k].uid, i]));
  const labelOf = new Map([[F.master.uid, 'Speed'], ...DRIVEN.map(([k, , l]) => [F[k].uid, l])]);
  const mods = (F.mods || []).map((m) => ({ m, t: api.modTarget(m.amount) }))
    .sort((a, b) => (order.get(a.t) ?? 99) - (order.get(b.t) ?? 99));
  let rhythm = null;
  if (mods.length) {
    const ML = { X0: 90, XR: 970, YT: 28, YB: 120, AX: 40, TRACK: 152, H: 180 };   // H - TRACK = YT: room under the track for the offset label
    let cur = 0;
    const kept = new Map();
    const tabs = h('div', { class: 'ap-mtabs', role: 'tablist' });
    const host = h('div');
    const TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4M6.75 6.5v4.5M9.25 6.5v4.5"/></svg>';
    // The amp handle's touch box stays inside the plot: the axis half a handle in, the stair half a handle and a gap past it.
    const stairL = (box) => {
      const bw = box.clientWidth, t = (box.querySelector('.ap-h') || {}).offsetWidth || 0;
      if (!bw) return ML;
      const u = 1000 / bw, AX = Math.max(ML.AX, (t / 2 + 1) * u);
      return { ...ML, AX, X0: Math.max(ML.X0, AX + (t / 2 + 8) * u) };
    };
    const views = mods.map(({ m, t }, i) => {
      const name = labelOf.get(t) || m.amount.group || 'Modulator';
      const btn = h('button', { type: 'button', role: 'tab' }, h('span', { text: name }));
      btn.addEventListener('click', () => { cur = i; show(); });
      // Enable: off writes amount 0 (RFC-066: no modulation) and keeps the amount here to restore.
      const cb = h('input', { type: 'checkbox', role: 'switch', 'aria-label': name + ' modifier' });
      const sw = h('label', { class: 'og-switch ap-mon' }, cb, h('span', { class: 'track' }));
      cb.addEventListener('change', () => {
        const a = Number(api.value(m.amount));
        if (a > 0) { kept.set(m.amount.uid, a); api.write(m.amount, 0); } else api.write(m.amount, kept.get(m.amount.uid) ?? Math.min(100, m.amount.max ?? 100));
        update();
      });
      // Reset: all six to the catalog defaults, one tick, one intent; a preset recovers it.
      const trash = h('button', { type: 'button', class: 'ap-mtrash', 'aria-label': 'Reset ' + name + ' modifier', title: 'Reset to defaults' });
      trash.innerHTML = TRASH;
      trash.addEventListener('click', () => { for (const [k] of MOD) if (m[k].dflt != null) api.write(m[k], Number(m[k].dflt)); });
      tabs.append(h('div', { class: 'ap-mtab', role: 'presentation' }, sw, btn, trash));
      const stair = s('path', { class: 'curve' });
      const fill = s('path', { class: 'fill' });
      const segs = ['to min', 'at min', 'to max', 'at max'].map((w) => h('span', { class: 'ap-seg', 'data-w': w }));
      // A hold (at min, at max) is reached on the graph: a guide at its end, a plus at its corner while it is 0.
      const vg = [0, 1].map(() => s('line', { class: 'vguide', y1: ML.H - ML.TRACK, y2: ML.TRACK }));
      const plus = [[m.hold, 'Add at min'], [m.rest, 'Add at max']].map(([f, l]) => plusBtn(l, () => { ed.preview(f, 1); ed.commit(f); }));
      const top = s('line', { class: 'guide', y1: ML.YT, y2: ML.YT });
      const axis = s('line', { class: 'grid', y1: ML.YT, y2: ML.YB });
      const track = s('line', { class: 'grid', y1: ML.TRACK, y2: ML.TRACK });
      const cyc = makeEditor(api, {
        W: 1000, H: ML.H, cls: 'ap-stair',
        decor: [...segs, ...plus, h('span', { class: 'ap-cap', style: 'position:absolute;right:8px;top:4px', text: 'modifier · cycle' })],
        svgKids: [...vg, top, axis, track, fill, stair],
        // A value not yet reported reads 0, never NaN geometry.
        geom: (val, g0, box) => stairGeom(Object.fromEntries(MOD.map(([k]) => [k, Math.max(0, val(m[k]) || 0)])),
          m.amount.max || 100, g0 ? g0.L : stairL(box), g0 && g0.k),
        // The staircase, its top guide, the amp axis and the offset track: lines a label keeps off.
        lines: (g) => [[[g.L.X0, g.L.YT], ...g.bars.flatMap((y, i) => [[g.L.X0 + g.k * i, y], [g.L.X0 + g.k * (i + 1), y]])],
          [[g.L.X0, g.L.YT], [g.L.XR, g.L.YT]], [[g.L.AX, g.L.YT], [g.L.AX, g.L.YB]], [[g.L.X0, g.L.TRACK], [g.L.XR, g.L.TRACK]]],
        draw(g, val, box) {
          const L = g.L, px = box.clientWidth / 1000;
          let d = 'M' + L.X0 + ' ' + L.YT;
          g.bars.forEach((y, i) => { d += ' V' + y + ' H' + (L.X0 + g.k * (i + 1)); });
          stair.setAttribute('d', d);
          fill.setAttribute('d', g.bars.length ? 'M' + g.rise.x + ' ' + L.YT + ' H' + g.hold.x + ' V' + g.low + ' H' + g.rise.x + ' Z' : '');
          for (const [e, a, b] of [[top, L.X0, L.XR], [axis, L.AX, L.AX], [track, L.X0, L.XR]]) { e.setAttribute('x1', a); e.setAttribute('x2', b); }
          const xs = [L.X0, g.rise.x, g.hold.x, g.fall.x, g.rest.x];
          const n = [m.rise, m.hold, m.fall, m.rest].map((f) => num(val(f)));
          // A caption wider than its segment drops its word, then itself.
          segs.forEach((e, j) => {
            const w = (xs[j + 1] - xs[j]) * px;
            e.style.left = ((xs[j] + xs[j + 1]) / 2 / 10) + '%';
            e.dataset.n = n[j];
            e.textContent = e.dataset.w + ' ' + n[j];
            e.hidden = !Number(n[j]);
            if (!e.hidden && e.offsetWidth > w) e.textContent = n[j];
            if (!e.hidden) e.hidden = e.offsetWidth > w;
          });
          [g.hold, g.rest].forEach((p, j) => { vg[j].setAttribute('x1', p.x); vg[j].setAttribute('x2', p.x); });
          [[m.hold, g.hold], [m.rest, g.rest]].forEach(([f, p], j) => {
            plus[j].hidden = val(f) > 0;
            plus[j].disabled = !!api.gate(f);
            plus[j].style.left = (p.x / 10) + '%';
            plus[j].style.top = (p.y / ML.H * 100) + '%';
          });
        },
        handles: [
          { key: 'amp', field: m.amount, label: 'Amp', axis: 'y', at: (g) => g.amp, value: stairValue.amount, text: (v) => 'amp ' + num(v) },
          { key: 'rise', field: m.rise, label: 'To min', at: (g) => g.rise, value: stairValue.rise, text: () => '' },
          { key: 'hold', field: m.hold, label: 'At min', at: (g) => g.c.hold > 0 && g.hold, value: stairValue.hold, text: () => '' },
          { key: 'fall', field: m.fall, label: 'To max', at: (g) => g.fall, value: stairValue.fall, text: () => '' },
          { key: 'rest', field: m.rest, label: 'At max', at: (g) => g.c.rest > 0 && g.rest, value: stairValue.rest, text: () => '' },
          { key: 'phase', field: m.phase, label: 'Offset', shape: 'tri', at: (g) => g.phase, value: stairValue.phase, text: (v) => 'offset ' + num(v) },
        ],
      }, ed);
      const nums = h('div', { class: 'ap-nums' }, ...MOD.map(([k, , l]) => numCtl(m[k], l)));
      numRows.push(nums);
      const view = h('div', { class: 'ap-mview', role: 'tabpanel', 'aria-label': name }, cyc.box, cyc.note, nums);
      updaters.push(() => {
        const a = Number(api.value(m.amount)), gate = api.gate(m.amount);
        btn.dataset.on = String(a > 0);
        cb.checked = a > 0;
        sw.title = a > 0 ? 'Modifier on' : 'Modifier off';
        cb.disabled = !!gate;
        const dirty = MOD.some(([k]) => m[k].dflt != null && val(m[k]) !== Number(m[k].dflt));
        trash.style.visibility = dirty ? '' : 'hidden';
        trash.disabled = MOD.some(([k]) => api.gate(m[k]));
        cyc.render();
      });
      return { btn, view };
    });
    const show = () => {
      views.forEach((v, i) => v.btn.setAttribute('aria-selected', String(i === cur)));
      host.replaceChildren(views[cur].view);
    };
    show();
    rhythm = h('section', { class: 'ap-rhythm' },
      h('div', { class: 'ap-cap' }, h('h4', { text: 'Rhythm modifier' }), h('span', { class: 'ap-hint explain', text: 'vary a control across strokes' })),
      tabs, host);
  }

  // ---- planned motion: the current parameters to scale over a fixed window (planMotion)
  const limit = api.field('limit.input.speed');
  const wlo = api.field('window.min'), whi = api.field('window.max');
  let plan = null;
  // Without the ceiling or the window nothing is to scale: no strip.
  if (limit && wlo && whi) {
    let winS = Number(api.prefs.get(WINDOW_KEY));
    if (!(winS >= WINDOW_S[0] && winS <= WINDOW_S[1])) winS = WINDOW_S[2];
    const planPath = s('path', { class: 'curve' });
    const planGrid = s('g');
    const planSvg = s('svg', { viewBox: '0 0 1000 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    planSvg.append(planGrid, planPath);
    const planBox = h('div', { class: 'ap-ed ap-planbox' }, planSvg);
    const winOut = h('output', { title: 'Window, seconds' });
    const winBtn = (dir, label, d) => {
      const b = h('button', { type: 'button', class: 'og-btn ap-tool', 'aria-label': label, title: label });
      b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + d + '"/></svg>';
      b.addEventListener('click', () => {
        const step = dir > 0 ? (winS < 10 ? 1 : winS < 30 ? 5 : 10) : (winS <= 10 ? 1 : winS <= 30 ? 5 : 10);
        winS = clamp(winS + dir * step, WINDOW_S[0], WINDOW_S[1]);
        api.prefs.set(WINDOW_KEY, winS);
        drawPlan();
      });
      return b;
    };
    const upB = winBtn(1, 'Longer window', 'M3.5 10.5 8 6l4.5 4.5'), downB = winBtn(-1, 'Shorter window', 'M3.5 5.5 8 10l4.5-4.5');
    plan = h('div', { class: 'ap-plan' }, planBox, h('div', { class: 'ap-win' }, upB, winOut, downB));
    // Plot y 4..80 of the box; the grid labels own the band under it.
    const PY = (v) => (80 - v * 76).toFixed(1);
    const keyOf = new Map(DRIVEN.map(([k]) => [F[k].uid, k]));
    const speedRef = (f) => unitOf(f, f.min);
    let gridKey = '', planKey = '';
    function drawPlan() {
      winOut.textContent = String(winS);
      upB.disabled = winS >= WINDOW_S[1];
      downB.disabled = winS <= WINDOW_S[0];
      const w = planBox.clientWidth || 300, gk = winS + ':' + w;
      if (gridKey !== gk) {
        gridKey = gk;
        planGrid.replaceChildren(...Array.from({ length: winS + 1 }, (_, i) => s('line', { class: 'grid', x1: i * 1000 / winS, x2: i * 1000 / winS, y1: 0, y2: 80 })));
        // One label per whole step of 1, 2, 5, 10, 30 or 60 s that clears 28 px.
        const step = [1, 2, 5, 10, 30, 60].find((n) => n * w / winS >= 28) || 60;
        planBox.querySelectorAll('.ap-gl').forEach((e) => e.remove());
        for (let t = 0; t <= winS; t += step) planBox.append(h('span', { class: 'ap-gl', style: 'left:' + (t / winS * 100) + '%' + (t === 0 ? ';transform:none;margin-left:3px' : t === winS ? ';transform:translateX(-100%);margin-left:-3px' : ''), text: String(t) }));
      }
      const mm = {};
      for (const { m, t } of mods) {
        const k = keyOf.get(t), a = val(m.amount);
        if (k && a > 0) mm[k] = { amount: a / (m.amount.max || 100), ...Object.fromEntries(MOD.slice(1).map(([n]) => [n, Math.max(0, Math.round(val(m[n]) || 0))])) };
      }
      const inp = {
        master: unitOf(F.master, val(F.master)), speedIn: unitOf(F.speedIn, val(F.speedIn)), speedOut: unitOf(F.speedOut, val(F.speedOut)),
        accelIn: unitOf(F.accelIn, val(F.accelIn)), accelOut: unitOf(F.accelOut, val(F.accelOut)),
        dMin: fracOf(F.depthMin, val(F.depthMin)), dMax: fracOf(F.depthMax, val(F.depthMax)),
        dwellCrest: dw(F.dwellCrest), dwellTrough: dw(F.dwellTrough),
        span: Number(api.value(whi)) - Number(api.value(wlo)), ceiling: Number(api.value(limit)),
        refs: { speedIn: speedRef(F.speedIn), speedOut: speedRef(F.speedOut), dwellCrest: F.dwellCrest ? F.dwellCrest.min || 0 : 0, dwellTrough: F.dwellTrough ? F.dwellTrough.min || 0 : 0 },
        mods: mm,
      };
      const key = JSON.stringify([inp, w, winS]);
      if (key === planKey) return;
      planKey = key;
      planPath.setAttribute('d', planMotion(inp, winS, w).map(([t, y], i) => (i ? 'L' : 'M') + (t / winS * 1000).toFixed(1) + ' ' + PY(y)).join(''));
    }
    const planRo = new ResizeObserver(() => drawPlan());
    planRo.observe(planBox);
    loops.push(() => planRo.disconnect());
    updaters.push(drawPlan);
  }

  const tgt = api.field('telemetry.target') || api.field('telemetry.position');
  const pos = api.field('telemetry.position');
  const share = (f) => {
    const a = Number(api.value(wlo)), b = Number(api.value(whi)), v = Number(api.value(f));
    return f && wlo && whi && b > a && Number.isFinite(v) ? clamp((v - a) / (b - a), 0, 1) : null;
  };
  let lastU = null, dir = 1;
  function frame() {
    // Playhead: the live position on the half it is travelling (depth window shares).
    // The half is the told target's side (no target role: the position's own
    // direction), and it holds while the position sits at a bound, so a hold parks
    // there through settle jitter and an early successor.
    const p = share(pos);
    const g = strokeNow();
    if (p != null && g.ok && g.span > 0) {
      const u2 = clamp((p - g.p.lo) / g.span, 0, 1);
      const t = tgt !== pos ? share(tgt) : null;
      if (u2 > 0.02 && u2 < 0.98) {
        if (t != null) dir = t >= (g.p.lo + g.p.hi) / 2 ? 1 : -1;
        else if (lastU != null && p !== lastU) dir = p > lastU ? 1 : -1;
      }
      lastU = p;
      const pt = atDepth(dir > 0 ? g.inC : g.outC, dir > 0 ? u2 : 1 - u2);
      play.hidden = false;
      play.style.left = (pt.x / 10) + '%';
      play.style.top = (pt.y / 240 * 100) + '%';
    } else play.hidden = true;
  }
  let raf = 0;
  // Only the advanced source plays this curve; Classic running is not drawn on it.
  const running = () => on(api.value(F.advRun));
  const tick = () => {
    frame();
    raf = running() ? requestAnimationFrame(tick) : 0;
    if (!raf) play.hidden = true;
  };
  loops.push(() => cancelAnimationFrame(raf));
  updaters.push(() => {
    if (!raf && running()) raf = requestAnimationFrame(tick);
  });

  // ---- presets: a dropdown over the store (RFC-070) and its ops (RFC-067)
  const baseNums = h('div', { class: 'ap-nums' }, ...DRIVEN.map(([k, , l]) => numCtl(F[k], l)));
  numRows.push(baseNums);
  const tools = [inputsBtn(), linkBtn()];
  const presets = F.presetOp ? presetRow(api, F, updaters, tools) : h('div', { class: 'ap-row' }, ...tools);

  // ---- the card: two sources (SPEC §11.4), one panel each, each with its own Start
  const runRow = (f, other) => {
    const run = h('button', { type: 'button', class: 'og-btn ap-run' });
    const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
    run.addEventListener('click', () => api.write(f, on(api.value(f)) ? 0 : 1));
    const row = h('div', { class: 'ap-row' }, run);
    if (F.bgRun) row.append(bgSwitch());
    updaters.push(() => {
      const r = on(api.value(f)), st = api.status(f), gate = api.gate(f);
      run.textContent = r ? 'Stop pattern' : 'Start pattern';
      run.setAttribute('aria-pressed', String(r));
      run.dataset.shadow = st;
      run.disabled = !!gate;
      const why = api.reason(f);
      say(note, gate, st, (st === 'fault' && /SOURCE_CONFLICT/.test(why) ? ownerText(other) : st === 'fault' ? why : LADDER[st])
        || api.stale(f));
    });
    return h('div', {}, row, note);
  };
  // §10.1 rule 1: background_run sits beside each run/stop; one field, two views.
  function bgSwitch() {
    const cb = h('input', { type: 'checkbox' });
    const track = h('span', { class: 'track' });
    const sw = h('label', { class: 'og-switch ap-sw' }, cb, track, h('span', { text: 'Run in background' }));
    cb.addEventListener('change', () => { Promise.resolve(api.write(F.bgRun, cb.checked ? 1 : 0)).finally(() => update()); });
    updaters.push(() => {
      track.dataset.shadow = api.status(F.bgRun);
      cb.checked = on(api.value(F.bgRun));
      cb.disabled = !!api.gate(F.bgRun);
    });
    return sw;
  }
  // SOURCE_CONFLICT names the owner by id: an owned slot's source id indexes
  // its field's options (control-owner labels). Unlabeled: no name.
  // ponytail: a slot is a labeled source field and the owner field after it; the
  // control-owner shape has no roles to pair them by (registry note only).
  function ownerText(other) {
    const co = (api.catalog().fields || []).filter((f) => f.channelId === CONTROL_OWNER);
    const owned = co.filter((f, i) => f.options && co[i + 1] && !co[i + 1].options && Number(api.value(co[i + 1])))
      .map((f) => f.options[Number(api.value(f))]).filter(Boolean);
    if (!owned.length) return 'stop the other source first';
    return on(api.value(other)) ? 'stop ' + owned[0] + ' first' : 'rail owned by ' + owned[0];
  }

  const adv = h('div', { class: 'ap' },
    slider(F.master, 'Speed'),
    ...(presets ? [presets] : []),
    stroke.box, stroke.note,
    ...(plan ? [plan] : []),
    baseNums,
    ...(rhythm ? [rhythm] : []),
    runRow(F.advRun, F.running));
  const classic = F.select && F.running ? h('div', { class: 'ap' }, choice(F.select, 'Pattern'),
    ...CLASSIC.filter(([k]) => F[k]).map(([k, , l]) => slider(F[k], l)),
    runRow(F.running, F.advRun)) : null;

  const root = h('div', { class: 'ap' }, h('style', { text: CSS }));
  // Narrow (a phone, a two-cell placement): the hint drops, the modifier tabs pair up.
  // The class flips a frame later, so its own reflow never re-enters this observer.
  const fit = new ResizeObserver(() => requestAnimationFrame(() => root.classList.toggle('ap-narrow', root.clientWidth < 480)));
  fit.observe(root);
  loops.push(() => fit.disconnect());
  if (classic) {
    // A view switch, never a write: the running source opens first.
    let view = on(api.value(F.running)) && !on(api.value(F.advRun)) ? 'classic' : 'advanced';
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

function presetRow(api, F, updaters, tools) {
  const op = F.presetOp;
  // The registry names no role for the op's slot and name: told apart by type (ph-e82.18).
  const slotKey = ((op.payload || []).find((p) => p.type === CBOR.uint) || {}).key;
  const nameKey = ((op.payload || []).find((p) => p.type === CBOR.tstr) || {}).key;
  let slots = null, reading = false, again = false, asking = false, renaming = null;   // renaming: the slot whose name is edited
  const sel = h('select', { 'aria-label': 'Preset' });
  const save = h('button', { type: 'button', class: 'og-btn', text: 'Save' });
  const reset = h('button', { type: 'button', class: 'og-btn', text: 'Reset' });
  const del = h('button', { type: 'button', class: 'og-btn', text: 'Delete' });
  const name = h('input', { type: 'text', placeholder: 'Preset name', 'aria-label': 'Preset name', hidden: '' });
  const ok = h('button', { type: 'button', class: 'og-btn', text: 'Save as', hidden: '' });
  const note = h('p', { class: 'ap-note', 'aria-live': 'polite' });
  const box = h('div', {}, h('div', { class: 'ap-row' }, sel, ...tools, save, reset, del), h('div', { class: 'ap-row' }, name, ok), note);

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
  // F2 or a double-click on the chosen preset renames it in place, only where the op list carries a rename.
  const rename = () => {
    const r = (slots || []).find((x) => x.slot === pick());
    if ((op.options || [])[STORE_OP.rename] !== 'rename' || !r || sel.disabled) return;
    asking = false;
    renaming = r.slot;
    name.value = r.name || '';
    draw();
    name.focus();
    name.select();
  };
  sel.addEventListener('dblclick', rename);
  sel.addEventListener('keydown', (e) => { if (e.key === 'F2') { e.preventDefault(); rename(); } });
  // Enter keeps, Escape reverts, blur keeps (an empty name reverts); a click on Rename commits itself.
  name.addEventListener('blur', (e) => {
    if (renaming == null || e.relatedTarget === ok) return;
    if (name.value && !ok.disabled) ok.click(); else { renaming = null; draw(); }
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !ok.disabled) ok.click();
    else if (e.key === 'Escape') { asking = false; renaming = null; name.value = ''; draw(); sel.focus(); }
  });
  ok.addEventListener('click', async () => {
    if (renaming != null) {
      const slot = renaming;
      renaming = null;
      await run(STORE_OP.rename, slot, name.value);
      name.value = '';
      draw();
      return;
    }
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
    const fs = [...[...BASE, ...DWELL].map(([k]) => F[k]).filter(Boolean), ...(F.mods || []).flatMap((m) => MOD.map(([k]) => m[k]))];
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
    name.hidden = ok.hidden = !(asking || renaming != null);
    ok.textContent = renaming != null ? 'Rename' : 'Save as';
    gateRow();
  }
  function gateRow() {
    const gate = api.gate(op), st = api.status(op);
    const live = slots && !slots.some((r) => r.state === 'pending' || r.state === 'locked');
    sel.disabled = !!gate || !live;
    save.disabled = reset.disabled = !!gate || !live;
    del.disabled = !!gate || !live || pick() == null;
    ok.disabled = !!gate || !name.value || (renaming == null && !(slots || []).some((r) => r.state === 'empty'));
    sel.dataset.shadow = st;
    say(note, gate, st, LADDER[st] || (asking && !(slots || []).some((r) => r.state === 'empty') ? 'store full' : ''));
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
