// timeline.js -- overview heat with scrub and the automation detail view
// Contract: CONTRACT.md, module player-ui (ph-smvd.5).
//
// Constraints:
// - Imports funscript.js only (CONTRACT import graph), so tf() restates
//   scheduler.js applyT; the two must agree.
// - Display only: nothing here submits motion or writes a field.
// - Intent (--intent) is the script as commanded after T; reality (--reality)
//   is telemetry.position as a window share, drawn only where reported
//   (law 9) and dimmed where stale (law 8); --highlight is the playhead, focus
//   and focus; --warn marks heat past the input speed limit. No red (law 13).
// - The heat is the funscript speed heatmap: one hard-edged color run per action span
//   of the file's actions by |dpos| / dt (units/s, pos 0..100), from the chassis dark
//   through --reality to --highlight (heatColor), mixed in oklab. Never red: RENDERING
//   law 13 keeps red for hazards.
// - The wheel is never captured: zoom is two buttons, and pinch on touch (pinchZoom).
// - Range pills preview through onRange(partial, false) and commit once,
//   onRange(partial, true), on release, key-up or blur.
// - A pill's hit box stays inside the detail (it clips) and only its drawn
//   pill rides the value to the edge; high sits one tap right of low, so two
//   close values never stack one box over the other.
// - Heat past the limit is striped, not only recolored: in Ember --intent and
//   --warn are 13.6 Delta E apart.
// - Every box has a fixed height (CSS); a state change swaps no geometry.
// - zoomMs is the starting window; onZoom(ms) persists it as the prefs key zoomMs.
// - The playhead is one bar: its grip rides the heat at the bottom and its line runs up
//   through the detail at the same x, so the detail window holds m at the share m / duration.
// - A trace point's p (plan.current as a window share) draws --intent at reduced weight:
//   the hub's own command, under the script's.

// - The intent curve is frame's kin (the twin's render of the wire, display only), moved back by the
//   offset so it runs through the actions; without it, or during a Range drag, straight lines between
//   the actions. setScript's script is the wire (scale.js wire()), its actions drawn as dots; raw is the
//   file's actions, which the heat reads.
// - Nothing sits over the detail but the playhead, the range pills and the caller's overlay (PR7): the zoom group
//   (zoom out, the span, zoom in) and A-B are returned for the caller's timeline head. The detail and the heat
//   sit on --screen with the advanced generator's inset shadow.
// - The heat is placed by the caller (`ovHost`, before `ovBefore`): it is the transport row's timeline.
//   The playhead bar lives in the detail, at the same share of the script as the heat's grip.
// - `overlay` elements ride the detail (the caller positions them), pointer-events none.
// - The A-B points are a selection: --highlight, a band on the heat and two lines in the detail.
//   One button cycles start, end, clear (onLoop); setLoop draws what the controller holds.
// - The curve, the dots, the lanes and the trace are drawn over a span SLIDE times the detail's window,
//   centered on it, and moved with a transform: playback rebuilds the first three only when the window leaves
//   that span or what they draw changes (ph-m1gy), and formats each trace point once per span (ph-jem5).
//   frame() draws nothing while the playhead, the trace and the render stand still.
// - The oscillator axes (raw Script.axes V8, V9) are thin lanes under the detail, its window and playhead,
//   0..1 bottom to top, untransformed: the hub maps them (SPEC 9.7). The detail gives up their height, so the
//   timeline's box never changes; without them there are no lanes.

import { posAt, indexAfter, fmtTime, OSC_AXES } from './funscript.js';

export const ZOOMS = [5000, 10000, 20000, 60000];
export const HEAT_BINS = 200;
// Heat speeds, units/s: --bg-sunken at rest, --reality at HEAT_MID_UPS, --highlight from HEAT_TOP_UPS up.
export const HEAT_MID_UPS = 200, HEAT_TOP_UPS = 400;
export const TRACE_MS = 8000;
export const MIN_SPAN = 0.05;
const SLIDE = 2, NONE = [];
const SEEK_KEYS = { ArrowLeft: -5000, ArrowRight: 5000 };
const T0 = { offsetMs: 0, lo: 0, hi: 1, invert: false };

export const COPY = Object.freeze({
  overview: 'Script overview',
  detail: 'Script detail',
  scrub: 'Playhead',
  lo: 'Range low',
  hi: 'Range high',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  span: 'Detail span',
  zoomInGlyph: '+',
  zoomOutGlyph: '−',
  abGlyph: 'A-B',
  abStart: 'Set loop start',
  abEnd: 'Set loop end',
  abClear: 'Clear loop',
  V8: 'Oscillation amplitude',
  V9: 'Oscillation frequency',
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// The modifier rule (DESIGN 10.5), inlined: a key takes the 1 % step (Shift included), Ctrl the adjacent 10 % multiple.
export function pillKey(v, dir, e = {}) {
  if (!e.ctrlKey) return v + dir * 0.01;
  const q = v / 0.1;
  return (dir > 0 ? Math.floor(q + 1e-9) + 1 : Math.ceil(q - 1e-9) - 1) * 0.1;
}
const tf = (n, T) => T.lo + (T.invert ? 1 - n : n) * (T.hi - T.lo);

/** The intent curve over [fromMs, toMs] as SVG polyline points in a W x H box; 1 at the top. */
export function curvePoints(script, fromMs, toMs, W, H, T = T0) {
  if (!script || !(toMs > fromMs)) return '';
  const x = (t) => ((t - fromMs) / (toMs - fromMs) * W).toFixed(1);
  const y = (n) => (H - tf(n, T) * H).toFixed(1);
  const pts = [x(fromMs) + ',' + y(posAt(script, fromMs))];
  for (let i = indexAfter(script, fromMs); i < script.at.length && script.at[i] < toMs; i++) {
    pts.push(x(script.at[i]) + ',' + y(script.pos[i]));
  }
  pts.push(x(toMs) + ',' + y(posAt(script, toMs)));
  return pts.join(' ');
}

/** The actions in [fromMs, toMs] as an SVG path of dots (zero-length round-capped strokes) in a W x H box. */
export function dotPath(script, fromMs, toMs, W, H, T = T0) {
  if (!script || !(toMs > fromMs)) return '';
  let d = '';
  for (let i = indexAfter(script, fromMs); i < script.at.length && script.at[i] <= toMs; i++) {
    d += 'M' + ((script.at[i] - fromMs) / (toMs - fromMs) * W).toFixed(1) + ',' + (H - tf(script.pos[i], T) * H).toFixed(1) + 'h0';
  }
  return d;
}

/** A Kinetic render ({t0, dtMs, pos mm, lo, hi}) as polyline points from fromMs to toMs, at most max. */
export function kinPoints(r, fromMs, toMs, W, H, max = 2000) {
  if (!r || !r.pos || !(toMs > fromMs) || !(r.hi > r.lo)) return '';
  const n = r.pos.length, j0 = clamp(Math.floor((fromMs - r.t0) / r.dtMs), 0, n), j1 = clamp(Math.ceil((toMs - r.t0) / r.dtMs) + 1, 0, n);
  const stride = Math.max(1, Math.ceil((j1 - j0) / max)), pts = [];
  for (let j = j0; j < j1; j += stride) {
    pts.push(((r.t0 + j * r.dtMs - fromMs) / (toMs - fromMs) * W).toFixed(1) + ',' + (H - (r.pos[j] - r.lo) / (r.hi - r.lo) * H).toFixed(1));
  }
  return pts.join(' ');
}

/** Media ms at x across a W wide overview. */
export function seekAt(x, W, durationMs) {
  return W > 0 && durationMs > 0 ? clamp(x / W, 0, 1) * durationMs : 0;
}

/**
 * The reality trace inside [clipFrom, clipTo] (default [fromMs, toMs]) as polylines over [fromMs, toMs] in a W x H
 * box: a null u breaks the line (law 9: a gap, never a zero), a stale change starts a new one. key: the share drawn
 * ('u', or 'p' the plan).
 */
export function traceLines(trace, fromMs, toMs, W, H, key = 'u', clipFrom = fromMs, clipTo = toMs) {
  const out = [];
  const isP = key === 'p', bufs = isP ? planBufs : realBufs;
  let stale = false, n = 0, buf = bufs[0] || (bufs[0] = []);   // n: the open line's points, 0 with none open
  const close = () => {
    if (n < 2) return;
    buf.length = n;
    out.push({ points: buf.join(' '), stale });
    buf = bufs[out.length] || (bufs[out.length] = []);
  };
  for (const p of trace || []) {
    const u = isP ? p.p : p.u;
    if (u == null || p.m < clipFrom || p.m > clipTo) { close(); n = 0; continue; }
    if (!n || stale !== !!p.stale) {
      const prev = n ? buf[n - 1] : null;
      close();
      n = 0;
      if (prev) buf[n++] = prev;
      stale = !!p.stale;
    }
    let c = ptText.get(p);
    if (!c || c.f !== fromMs || c.t !== toMs || c.W !== W || c.H !== H) ptText.set(p, (c = { f: fromMs, t: toMs, W, H, u: null, p: null }));
    let t = isP ? c.p : c.u;
    if (t == null) {
      t = ((p.m - fromMs) / (toMs - fromMs) * W).toFixed(1) + ',' + (H - clamp(u, 0, 1) * H).toFixed(1);
      if (isP) c.p = t; else c.u = t;
    }
    buf[n++] = t;
  }
  close();
  return out;
}
// A point's text per frame of reference (the timeline's span holds for many frames), and a join buffer per key and
// line index, filled by index, so a line keeps about its size frame to frame and its buffer is not regrown: a frame
// formats only the points new to the span (ph-jem5).
const ptText = new WeakMap(), realBufs = [], planBufs = [];

/** A speed in units/s as a CSS color: --bg-sunken at rest, through --reality to --highlight, mixed in oklab. */
export function heatColor(ups) {
  const mix = (a, b, u) => 'color-mix(in oklab, var(' + b + ') ' + Math.round(u * 100) + '%, var(' + a + '))';
  return !(ups > 0) ? 'var(--bg-sunken)' : ups < HEAT_MID_UPS ? mix('--bg-sunken', '--reality', ups / HEAT_MID_UPS)
    : ups < HEAT_TOP_UPS ? mix('--reality', '--highlight', (ups - HEAT_MID_UPS) / (HEAT_TOP_UPS - HEAT_MID_UPS)) : 'var(--highlight)';
}

/**
 * The heat as color runs [{from, to (ms), ups, color, over}]: one per action span, equal neighbors merged (ups
 * their fastest), the lead-in before the first action at rest. With a ceiling {vmax mm/s, spanMm} a span is
 * over when its chord speed through T's Range passes vmax.
 */
export function heatStops(script, T = T0, ceiling = null) {
  const { at, pos } = script, out = [];
  const cap = ceiling && ceiling.vmax > 0 && ceiling.spanMm > 0 ? ceiling.vmax / (ceiling.spanMm * (T.hi - T.lo)) * 100 : Infinity;
  const put = (from, to, ups) => {
    const color = heatColor(ups), over = ups > cap, last = out[out.length - 1];
    if (last && last.color === color && last.over === over) { last.to = to; last.ups = Math.max(last.ups, ups); } else out.push({ from, to, ups, color, over });
  };
  if (at.length && at[0] > 0) put(0, at[0], 0);
  for (let k = 1; k < at.length; k++) put(at[k - 1], at[k], Math.abs(pos[k] - pos[k - 1]) * 1e5 / (at[k] - at[k - 1]));
  return out;
}

/** T with key ('lo' | 'hi') moved to v, kept in 0..1 and MIN_SPAN from its partner. */
export function clampRange(T, key, v) {
  return key === 'lo' ? { lo: clamp(v, 0, T.hi - MIN_SPAN) } : { hi: clamp(v, T.lo + MIN_SPAN, 1) };
}

/** The next zoom in ZOOMS from ms, dir +1 wider, -1 narrower; ms when at the end. */
export function zoomStep(ms, dir) {
  const i = ZOOMS.indexOf(ms);
  return ZOOMS[clamp((i < 0 ? 1 : i) + dir, 0, ZOOMS.length - 1)];
}

export const PINCH_STEP = 1.25;
/** The zoom after a pinch whose finger distance moved by `scale` since the last step: apart narrows, together widens. */
export function pinchZoom(ms, scale) {
  return scale >= PINCH_STEP ? zoomStep(ms, -1) : scale <= 1 / PINCH_STEP ? zoomStep(ms, 1) : ms;
}

export const CSS = `
.fsp-tl { position: relative; display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
.fsp-ph { position: absolute; top: 0; bottom: 0; width: 2px; translate: -1px 0; background: var(--highlight); pointer-events: none; z-index: 1; }
.fsp-tl > * { box-sizing: border-box; }
.fsp-ov, .fsp-dt { background: var(--screen); box-shadow: inset 0 2px 8px rgba(var(--shade-rgb), .7); }
.fsp-ov { position: relative; height: 24px; flex: none; border: 1px solid var(--line); border-radius: var(--r-s); user-select: none; cursor: pointer; }
.fsp-ov::before { content: ''; position: absolute; inset: -8px 0; }
.fsp-ov svg, .fsp-dt svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.fsp-ov rect.bin.over { fill: var(--warn); }
.fsp-ov rect.ab { fill: rgba(var(--highlight-rgb), .22); }
.fsp-dt line.ab { stroke: var(--highlight); stroke-width: 1; stroke-dasharray: 3 3; }
.fsp-ov rect.win { fill: rgba(var(--highlight-rgb), .08); stroke: var(--highlight); stroke-width: 1; vector-effect: non-scaling-stroke; }
.fsp-scrub { position: absolute; top: 50%; width: var(--tap); height: var(--tap); margin: calc(var(--tap) / -2) 0 0 calc(var(--tap) / -2); outline: none; z-index: 1; }
.fsp-scrub::after, .fsp-rh::after { content: ''; position: absolute; left: 50%; top: 50%; box-sizing: border-box; background: var(--bg-card); }
.fsp-scrub::after { width: 9px; height: 20px; translate: -4.5px -10px; border-radius: 4.5px; border: 2px solid var(--highlight); }
.fsp-dt { position: relative; height: var(--fsp-detail, 96px); flex: none; border: 1px solid var(--line); border-radius: var(--r-s); overflow: hidden;
  container-type: size; touch-action: pan-x pan-y; }
.fsp-dt polyline, .fsp-dt line { fill: none; vector-effect: non-scaling-stroke; }
.fsp-dt .dots { fill: none; stroke: var(--intent); stroke-width: 5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.fsp-dt .int { stroke: var(--intent); stroke-width: 2; }
.fsp-dt .int.draft { stroke-dasharray: 6 4; }
.fsp-dt .real { stroke: var(--reality); stroke-width: 1.5; }
.fsp-dt .real.stale { opacity: .4; }
.fsp-dt .plan { stroke: var(--intent); stroke-width: 1; opacity: .55; }
.fsp-dt .rg { stroke: var(--line-2); stroke-dasharray: 4 4; }
.fsp-rh { position: absolute; left: 0; width: var(--tap); height: var(--tap); margin-top: calc(var(--tap) / -2); outline: none; touch-action: none; cursor: ns-resize; z-index: 1;
  top: clamp(calc(var(--tap) / 2), calc(var(--y, 0) * 1cqh), calc(100cqh - var(--tap) / 2)); }
.fsp-rh[data-key=hi] { left: var(--tap); }
.fsp-rh::after { width: 20px; height: 9px; border-radius: 4.5px; border: 2px solid var(--intent);
  translate: -10px calc(-4.5px + clamp(5px, calc(var(--y, 0) * 1cqh), calc(100cqh - 5px)) - clamp(calc(var(--tap) / 2), calc(var(--y, 0) * 1cqh), calc(100cqh - var(--tap) / 2))); }
.fsp-rh[data-draft]::after { border-style: dashed; }
.fsp-scrub:focus-visible::after, .fsp-rh:focus-visible::after { box-shadow: 0 0 0 3px rgba(var(--highlight-rgb), .45); }
.fsp-zoom { display: flex; align-items: center; gap: var(--sp-2); flex: none; }
.fsp-zoom output { min-width: 4ch; font: .76rem var(--mono); color: var(--tx-val); text-align: right; white-space: nowrap; }
.fsp-zoom .og-btn, .fsp-ab { min-width: 30px; padding-inline: var(--sp-2); }
@media (pointer: coarse) { .fsp-zoom .og-btn, .fsp-ab { min-width: var(--tap); } }
.fsp-tl[data-lanes='1'] { --fsp-lanes: 10px; }
.fsp-tl[data-lanes='2'] { --fsp-lanes: calc(20px + var(--sp-1)); }
.fsp-tl[data-lanes] > .fsp-dt { height: calc(var(--fsp-detail, 96px) - var(--fsp-lanes) - var(--sp-2)); }
.fsp-lanes { position: relative; display: grid; grid-auto-rows: 1fr; gap: var(--sp-1); height: var(--fsp-lanes); flex: none; }
.fsp-tl:not([data-lanes]) > .fsp-lanes { display: none; }
.fsp-lane { position: relative; background: var(--screen); border: 1px solid var(--line); border-radius: var(--r-s); overflow: hidden; }
.fsp-lane svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.fsp-lane polyline { fill: none; stroke: var(--intent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
`;

const SVGNS = 'http://www.w3.org/2000/svg';
let heatIds = 0;
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const s = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export function mountTimeline(el, { ui, onSeek, onScrub, onRange, onZoom = () => {}, zoomMs = 10000, ovHost = null, ovBefore = null, overlay = [], onLoop = null }) {
  let script = null, raw = null, T = T0, ceiling = null, preview = null, m = 0, trace = [], ab = { a: null, b: null }, kin = null;
  let traceN = 0, traceLast = null, span = null;
  let zoom = ZOOMS.includes(zoomMs) ? zoomMs : 10000;
  const dur = () => (script ? script.durationMs : 0);

  // ---- overview: heat, window box, vertical-pill scrub (left-right)
  const ovSvg = s('svg', { viewBox: '0 0 ' + HEAT_BINS + ' 24', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const gid = 'fsp-heat-' + ++heatIds;
  const grad = s('linearGradient', { id: gid, x1: '0', x2: '1', y1: '0', y2: '0' });
  const defs = s('defs');
  defs.append(grad);
  const band = s('rect', { class: 'heat', width: String(HEAT_BINS), height: '24', fill: 'url(#' + gid + ')' });
  const bins = s('g');
  const win = s('rect', { class: 'win', y: '0', height: '24' });
  const abBand = s('rect', { class: 'ab', y: '0', height: '24' });
  ovSvg.append(defs, band, bins, abBand, win);
  const scrub = h('div', { class: 'fsp-scrub', role: 'slider', tabindex: '0', 'aria-label': COPY.scrub,
    'aria-orientation': 'horizontal', 'aria-valuemin': '0' });
  const ov = h('div', { class: 'fsp-ov', role: 'group', 'aria-label': COPY.overview }, ovSvg, scrub);
  const at = (e) => {
    const r = ov.getBoundingClientRect();
    return seekAt(e.clientX - r.left, r.width, dur());
  };
  // The kit's drag (ph-5u0g peeve 14): a touch scrubs only after horizontal intent or a hold, so a vertical swipe scrolls.
  ui.drag(ov, {
    filter: () => !!script,
    onStart(d, e) { scrub.focus({ preventScroll: true }); onScrub('start', at(e)); },
    onMove(e) { onScrub('move', at(e)); },
    onEnd(e, ok) { if (ok) onScrub('end', at(e)); },
  });
  scrub.addEventListener('keydown', (e) => {
    if (!script) return;
    const d = SEEK_KEYS[e.key];
    const to = d != null ? m + d * (e.shiftKey ? 6 : 1) : e.key === 'Home' ? 0 : e.key === 'End' ? dur() : null;
    if (to == null) return;
    e.preventDefault();
    onSeek(clamp(to, 0, dur()));
  });

  // ---- detail: intent curve, reality trace, fixed center playhead, range pills, zoom
  const dtSvg = s('svg', { viewBox: '0 0 1000 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const rgLo = s('line', { class: 'rg', x1: '0', x2: '1000' });
  const rgHi = s('line', { class: 'rg', x1: '0', x2: '1000' });
  const curve = s('polyline', { class: 'int' });
  const dots = s('path', { class: 'dots' });
  const real = s('g');
  const abA = s('line', { class: 'ab', y1: '0', y2: '100' }), abB = s('line', { class: 'ab', y1: '0', y2: '100' });
  dtSvg.append(rgLo, rgHi, abA, abB, curve, dots, real);
  const zOut = h('button', { type: 'button', class: 'og-btn sm', title: COPY.zoomOut, 'aria-label': COPY.zoomOut, text: COPY.zoomOutGlyph });
  const zIn = h('button', { type: 'button', class: 'og-btn sm', title: COPY.zoomIn, 'aria-label': COPY.zoomIn, text: COPY.zoomInGlyph });
  const zSpan = h('output', { title: COPY.span });
  const setZoom = (z) => { zoom = z; onZoom(z); draw(); };
  zOut.addEventListener('click', () => setZoom(zoomStep(zoom, 1)));
  zIn.addEventListener('click', () => setZoom(zoomStep(zoom, -1)));
  const zAB = h('button', { type: 'button', class: 'og-btn sm fsp-ab', text: COPY.abGlyph, 'aria-pressed': 'false' });
  zAB.hidden = !onLoop;
  zAB.addEventListener('click', () => onLoop && onLoop());
  const pills = ['lo', 'hi'].map((key) => {
    const p = h('div', { class: 'fsp-rh', role: 'slider', tabindex: '0', 'aria-label': COPY[key],
      'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '100', 'data-key': key });
    let id = null;
    const move = (v) => { preview = { ...(preview || {}), ...clampRange(eff(), key, v) }; onRange(preview, false); draw(); };
    const commit = () => {
      if (!preview) return;
      const done = preview;
      preview = null;
      onRange(done, true);
      draw();
    };
    p.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      p.setPointerCapture(e.pointerId);
      p.focus({ preventScroll: true });
      id = e.pointerId;
    });
    p.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const r = dt.getBoundingClientRect();
      move(1 - (e.clientY - r.top) / r.height);
    });
    const up = (e) => { if (e.pointerId === id) { id = null; commit(); } };
    p.addEventListener('pointerup', up);
    p.addEventListener('pointercancel', up);
    p.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      move(pillKey(eff()[key], d, e));
    });
    p.addEventListener('keyup', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') commit(); });
    p.addEventListener('blur', commit);
    return p;
  });
  const dt = h('div', { class: 'fsp-dt', role: 'group', 'aria-label': COPY.detail }, dtSvg, ...pills, ...overlay);
  // Pinch on touch: two fingers on the detail step the zoom once per PINCH_STEP of distance.
  const touch = new Map();
  let pinch0 = 0;
  const spread = () => { const [a, b] = [...touch.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  dt.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touch.size === 2) pinch0 = spread();
  });
  dt.addEventListener('pointermove', (e) => {
    if (!touch.has(e.pointerId)) return;
    touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touch.size !== 2 || !pinch0) return;
    const d = spread(), z = pinchZoom(zoom, d / pinch0);
    if (z !== zoom) { setZoom(z); pinch0 = d; }
  });
  const unTouch = (e) => { touch.delete(e.pointerId); if (touch.size < 2) pinch0 = 0; };
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) dt.addEventListener(t, unTouch);
  const ph = h('i', { class: 'fsp-ph', 'aria-hidden': 'true' });
  dt.append(ph);
  const lanes = OSC_AXES.map((id) => {
    const line = s('polyline');
    const svg = s('svg', { viewBox: '0 0 1000 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    svg.append(line);
    return { id, line, el: h('div', { class: 'fsp-lane', role: 'img', 'aria-label': COPY[id], title: COPY[id], 'data-axis': id }, svg) };
  });
  const lph = h('i', { class: 'fsp-ph', 'aria-hidden': 'true' });
  const laneBox = h('div', { class: 'fsp-lanes' }, ...lanes.map((l) => l.el), lph);
  const slid = [curve, dots, ...lanes.map((l) => l.line), real];
  let axes = {};
  const root = h('div', { class: 'fsp-tl' }, dt, laneBox, ...(ovHost ? [] : [ov]));
  el.append(root);
  if (ovHost) ovHost.insertBefore(ov, ovBefore);

  const eff = () => (preview ? { ...T, ...preview } : T);

  function drawHeat() {
    const d = dur(), runs = script && d > 0 ? heatStops(raw || script, T, ceiling) : [];
    grad.replaceChildren(...runs.flatMap((b) => [b.from, b.to].map((t) => s('stop', { offset: String(t / d), style: 'stop-color: ' + b.color }))));
    bins.replaceChildren(...runs.filter((b) => b.over).flatMap((b) => [0, 6, 12, 18].map((y) => s('rect', { class: 'bin over',
      x: String(b.from / d * HEAT_BINS), y: String(y), width: String((b.to - b.from) / d * HEAT_BINS), height: '3' }))));
  }

  function draw() {
    const d = dur(), Te = eff();
    const from = m - (d ? clamp(m / d, 0, 1) : 0.5) * zoom, to = from + zoom;
    const kk = kin && !preview ? kin : null;
    if (!span || from < span.a || to > span.b || span.zoom !== zoom || span.script !== script || span.kin !== kk || span.T !== Te
      || span.axes !== axes) {
      const a = from - (SLIDE - 1) / 2 * zoom, b = to + (SLIDE - 1) / 2 * zoom, W = 1000 * SLIDE;
      const k = kk ? { ...kk, t0: kk.t0 - (Te.offsetMs || 0) } : null;
      curve.setAttribute('points', k ? kinPoints(k, a, b, W, 100, 2000 * SLIDE) : curvePoints(script, a, b, W, 100, Te));
      curve.toggleAttribute('data-kin', !!k);
      curve.classList.toggle('draft', !!preview);
      dots.setAttribute('d', dotPath(script, a, b, W, 100, Te));
      for (const l of lanes) if (axes[l.id]) l.line.setAttribute('points', curvePoints(axes[l.id], a, b, W, 100));
      span = { a, b, zoom, script, kin: kk, T: Te, axes };
    }
    const tx = 'translate(' + ((span.a - from) / zoom * 1000).toFixed(2) + ' 0)';
    for (const e of slid) e.setAttribute('transform', tx);
    // The trace's polylines are reused frame to frame: plan under reality.
    let n = 0;
    const put = (cls, pts) => {
      const p = real.children[n++] || real.appendChild(s('polyline'));
      if (p.getAttribute('class') !== cls) p.setAttribute('class', cls);
      p.setAttribute('points', pts);
    };
    for (const l of traceLines(trace, span.a, span.b, 1000 * SLIDE, 100, 'p', from, to)) put('plan', l.points);
    for (const l of traceLines(trace, span.a, span.b, 1000 * SLIDE, 100, 'u', from, to)) put(l.stale ? 'real stale' : 'real', l.points);
    while (real.children.length > n) real.lastChild.remove();
    for (const [line, v] of [[rgLo, Te.lo], [rgHi, Te.hi]]) {
      line.setAttribute('y1', String(100 - v * 100));
      line.setAttribute('y2', String(100 - v * 100));
    }
    for (const p of pills) {
      const v = Te[p.dataset.key];
      p.style.setProperty('--y', String(100 - v * 100));
      p.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      p.toggleAttribute('data-draft', !!preview && p.dataset.key in preview);
    }
    zOut.disabled = zoom === ZOOMS[ZOOMS.length - 1];
    zIn.disabled = zoom === ZOOMS[0];
    const zt = zoom / 1000 + ' s';
    if (zSpan.textContent !== zt) zSpan.textContent = zt;
    win.setAttribute('x', String(d ? from / d * HEAT_BINS : 0));
    win.setAttribute('width', String(d ? zoom / d * HEAT_BINS : 0));
    scrub.style.left = (d ? clamp(m / d, 0, 1) * 100 : 0) + '%';
    scrub.setAttribute('aria-valuemax', String(Math.round(d)));
    scrub.setAttribute('aria-valuenow', String(Math.round(m)));
    scrub.setAttribute('aria-valuetext', fmtTime(m));
    scrub.hidden = !script;
    ph.style.left = scrub.style.left;
    ph.hidden = !script;
    lph.style.left = scrub.style.left;
    const ax = (t) => String(((t - from) / zoom) * 1000);
    abBand.setAttribute('x', String(d && ab.b != null ? ab.a / d * HEAT_BINS : 0));
    abBand.setAttribute('width', String(d && ab.b != null ? (ab.b - ab.a) / d * HEAT_BINS : 0));
    for (const [line, t] of [[abA, ab.a], [abB, ab.b]]) {
      line.style.display = t == null ? 'none' : '';
      if (t != null) { line.setAttribute('x1', ax(t)); line.setAttribute('x2', ax(t)); }
    }
    const tip = ab.a == null ? COPY.abStart : ab.b == null ? COPY.abEnd : COPY.abClear;
    if (zAB.title !== tip) { zAB.title = tip; zAB.setAttribute('aria-label', tip); }
    zAB.setAttribute('aria-pressed', String(ab.b != null));
    zAB.classList.toggle('on', ab.b != null);
  }

  return {
    /** The timeline head's controls, for the caller to place (PR7): the zoom group and A-B. */
    zoomEl: h('span', { class: 'fsp-zoom' }, zOut, zSpan, zIn),
    abEl: zAB,
    setScript(sc, t, ceil, rawSc) {
      script = sc || null;
      raw = rawSc || null;
      axes = ((raw || script) && (raw || script).axes) || {};
      for (const l of lanes) l.el.hidden = !axes[l.id];
      const n = lanes.filter((l) => axes[l.id]).length;
      if (n) root.dataset.lanes = String(n); else delete root.dataset.lanes;
      T = t || T0;
      ceiling = ceil || null;
      drawHeat();
      draw();
    },
    frame(mediaMs, tr, kr) {
      const m2 = Number.isFinite(mediaMs) ? mediaMs : 0, t2 = tr || NONE, n = t2.length, last = n ? t2[n - 1] : null;
      if (m2 === m && t2 === trace && n === traceN && last === traceLast && (kr || null) === kin) return;
      m = m2; trace = t2; traceN = n; traceLast = last; kin = kr || null;
      draw();
    },
    /** {a, b} media ms, either null: what the A-B button has set. */
    setLoop(x) { if (x && (x.a !== ab.a || x.b !== ab.b)) { ab = { a: x.a, b: x.b }; draw(); } },
    /** The timeline's own elements (the context menu's): the detail with its lanes, and the overview. */
    menuEls: [root, ov],
    /** The media ms under clientX x on the overview or the detail holding `node`; null without a script. */
    timeAt(x, node) {
      const d = dur();
      if (!script || !(d > 0)) return null;
      if (ov.contains(node)) { const r = ov.getBoundingClientRect(); return seekAt(x - r.left, r.width, d); }
      const r = dt.getBoundingClientRect(), from = m - clamp(m / d, 0, 1) * zoom;
      return r.width > 0 ? clamp(from + (x - r.left) / r.width * zoom, 0, d) : null;
    },
    unmount() { root.remove(); ov.remove(); },
  };
}
