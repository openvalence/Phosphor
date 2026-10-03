// timeline.js -- overview heat with scrub and the automation detail view
// Contract: CONTRACT.md, module player-ui (ph-smvd.5).
//
// Constraints:
// - Imports funscript.js only (CONTRACT import graph), so tf() restates
//   scheduler.js applyT; the two must agree.
// - Display only: nothing here submits motion or writes a field.
// - Intent (--intent) is the script as commanded after T; reality (--reality)
//   is telemetry.position as a window share, drawn only where reported
//   (law 9) and dimmed where stale (law 8); --highlight is the playhead and
//   focus; --warn marks heat past the input speed limit. No red (law 13).
// - The wheel is never captured: zoom is two buttons.
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
// - onExpand(on) asks for the analyzer; setExpanded(on) shows the answer on its button.
// - setScript's script is the shaped one (interp.js): the intent curve and the heat are what is
//   commanded. raw, when it is another Script, is the file's actions, drawn muted under it.

import { posAt, indexAfter, heat, fmtTime } from './funscript.js';

export const ZOOMS = [5000, 10000, 20000, 60000];
export const HEAT_BINS = 200;
export const TRACE_MS = 8000;
export const MIN_SPAN = 0.05;
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
  zoomInGlyph: '+',
  zoomOutGlyph: '−',
  analyzer: 'Analyzer',
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
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

/** Media ms at x across a W wide overview. */
export function seekAt(x, W, durationMs) {
  return W > 0 && durationMs > 0 ? clamp(x / W, 0, 1) * durationMs : 0;
}

/**
 * The reality trace inside [fromMs, toMs] as polylines: a null u breaks the
 * line (law 9: a gap, never a zero), a stale change starts a new one.
 */
export function traceLines(trace, fromMs, toMs, W, H) {
  const out = [];
  let cur = null;
  for (const p of trace || []) {
    if (p.u == null || p.m < fromMs || p.m > toMs) { cur = null; continue; }
    if (!cur || cur.stale !== !!p.stale) {
      const prev = cur && cur.pts[cur.pts.length - 1];
      cur = { stale: !!p.stale, pts: prev ? [prev] : [] };
      out.push(cur);
    }
    cur.pts.push(((p.m - fromMs) / (toMs - fromMs) * W).toFixed(1) + ',' + (H - clamp(p.u, 0, 1) * H).toFixed(1));
  }
  return out.filter((l) => l.pts.length > 1).map((l) => ({ points: l.pts.join(' '), stale: l.stale }));
}

/**
 * Heat bins (norm/s) as 0..1 levels. With a ceiling {vmax mm/s, spanMm} a
 * level is the bin's mm/s over vmax and `over` marks a bin past it; without
 * one, levels scale to the loudest bin and nothing is over.
 */
export function heatLevels(bins, T = T0, ceiling = null) {
  const cap = ceiling && ceiling.vmax > 0 && ceiling.spanMm > 0 ? ceiling.vmax / (ceiling.spanMm * (T.hi - T.lo)) : 0;
  let max = 0;
  for (const v of bins) max = Math.max(max, v);
  const den = cap || max || 1;
  return Array.from(bins, (v) => ({ level: clamp(v / den, 0, 1), over: !!cap && v > cap }));
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

export const CSS = `
.fsp-tl { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fsp-ph { position: absolute; top: 0; bottom: 12px; width: 2px; margin-left: -1px; background: var(--highlight); pointer-events: none; z-index: 1; }
.fsp-tl > * { box-sizing: border-box; }
.fsp-ov { position: relative; height: 24px; flex: none; border: 1px solid var(--line); border-radius: var(--r-s); touch-action: none; user-select: none; cursor: pointer; }
.fsp-ov::before { content: ''; position: absolute; inset: -8px 0; }
.fsp-ov svg, .fsp-dt svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.fsp-ov rect.bin { fill: var(--intent); }
.fsp-ov rect.bin.over { fill: var(--warn); }
.fsp-ov rect.win { fill: rgba(var(--highlight-rgb), .08); stroke: var(--highlight); stroke-width: 1; vector-effect: non-scaling-stroke; }
.fsp-scrub { position: absolute; top: 50%; width: var(--tap); height: var(--tap); margin: calc(var(--tap) / -2) 0 0 calc(var(--tap) / -2); outline: none; z-index: 1; }
.fsp-scrub::after, .fsp-rh::after { content: ''; position: absolute; left: 50%; top: 50%; box-sizing: border-box; background: var(--bg-card); }
.fsp-scrub::after { width: 9px; height: 20px; margin: -10px -4.5px; border-radius: 4.5px; border: 2px solid var(--highlight); }
.fsp-dt { position: relative; height: var(--fsp-detail, 96px); flex: none; border: 1px solid var(--line); border-radius: var(--r-s); overflow: hidden;
  container-type: size; }
.fsp-dt polyline, .fsp-dt line { fill: none; vector-effect: non-scaling-stroke; }
.fsp-dt .raw { stroke: var(--line-4); stroke-width: 1; }
.fsp-dt .int { stroke: var(--intent); stroke-width: 2; }
.fsp-dt .int.draft { stroke-dasharray: 6 4; }
.fsp-dt .real { stroke: var(--reality); stroke-width: 1.5; }
.fsp-dt .real.stale { opacity: .4; }
.fsp-dt .plan { stroke: var(--intent); stroke-width: 1; opacity: .55; }
.fsp-dt .rg { stroke: var(--line-2); stroke-dasharray: 4 4; }
.fsp-rh { position: absolute; left: 0; width: var(--tap); height: var(--tap); margin-top: calc(var(--tap) / -2); outline: none; touch-action: none; cursor: ns-resize; z-index: 1;
  top: clamp(calc(var(--tap) / 2), calc(var(--y, 0) * 1cqh), calc(100cqh - var(--tap) / 2)); }
.fsp-rh[data-key=hi] { left: var(--tap); }
.fsp-rh::after { width: 20px; height: 9px; margin: -4.5px -10px; border-radius: 4.5px; border: 2px solid var(--intent);
  translate: 0 calc(clamp(5px, calc(var(--y, 0) * 1cqh), calc(100cqh - 5px)) - clamp(calc(var(--tap) / 2), calc(var(--y, 0) * 1cqh), calc(100cqh - var(--tap) / 2))); }
.fsp-rh[data-draft]::after { border-style: dashed; }
.fsp-scrub:focus-visible::after, .fsp-rh:focus-visible::after { box-shadow: 0 0 0 3px rgba(var(--highlight-rgb), .45); }
.fsp-zoom { position: absolute; right: 0; top: 0; display: flex; z-index: 1; }
.fsp-zoom button { width: var(--tap); height: var(--tap); padding: 0; background: none; border: 0; color: var(--tx-mut); font: 600 1rem/1 var(--mono); cursor: pointer; }
.fsp-zoom button:hover, .fsp-zoom button:focus-visible { color: var(--highlight); outline: none; }
.fsp-zoom button:disabled { opacity: .35; cursor: default; }
.fsp-zoom button[aria-pressed=true] { color: var(--highlight); }
.fsp-zoom svg { position: static; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; vertical-align: middle; }
`;

const SVGNS = 'http://www.w3.org/2000/svg';
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

export function mountTimeline(el, { onSeek, onScrub, onRange, onZoom = () => {}, zoomMs = 10000, onExpand = null }) {
  let script = null, raw = null, T = T0, ceiling = null, preview = null, m = 0, trace = [];
  let zoom = ZOOMS.includes(zoomMs) ? zoomMs : 10000;
  const dur = () => (script ? script.durationMs : 0);

  // ---- overview: heat, window box, vertical-pill scrub (left-right)
  const ovSvg = s('svg', { viewBox: '0 0 ' + HEAT_BINS + ' 24', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const bins = s('g');
  const win = s('rect', { class: 'win', y: '0', height: '24' });
  ovSvg.append(bins, win);
  const scrub = h('div', { class: 'fsp-scrub', role: 'slider', tabindex: '0', 'aria-label': COPY.scrub,
    'aria-orientation': 'horizontal', 'aria-valuemin': '0' });
  const ov = h('div', { class: 'fsp-ov', role: 'group', 'aria-label': COPY.overview }, ovSvg, scrub);
  const at = (e) => {
    const r = ov.getBoundingClientRect();
    return seekAt(e.clientX - r.left, r.width, dur());
  };
  let scrubId = null;
  ov.addEventListener('pointerdown', (e) => {
    if (!script) return;
    e.preventDefault();
    ov.setPointerCapture(e.pointerId);
    scrubId = e.pointerId;
    scrub.focus({ preventScroll: true });
    onScrub('start', at(e));
  });
  ov.addEventListener('pointermove', (e) => { if (e.pointerId === scrubId) onScrub('move', at(e)); });
  const scrubEnd = (e) => {
    if (e.pointerId !== scrubId) return;
    scrubId = null;
    onScrub('end', at(e));
  };
  ov.addEventListener('pointerup', scrubEnd);
  ov.addEventListener('pointercancel', scrubEnd);
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
  const rawLine = s('polyline', { class: 'raw' });
  const curve = s('polyline', { class: 'int' });
  const real = s('g');
  dtSvg.append(rgLo, rgHi, rawLine, curve, real);
  const zOut = h('button', { type: 'button', title: COPY.zoomOut, 'aria-label': COPY.zoomOut, text: COPY.zoomOutGlyph });
  const zIn = h('button', { type: 'button', title: COPY.zoomIn, 'aria-label': COPY.zoomIn, text: COPY.zoomInGlyph });
  const setZoom = (z) => { zoom = z; onZoom(z); draw(); };
  zOut.addEventListener('click', () => setZoom(zoomStep(zoom, 1)));
  zIn.addEventListener('click', () => setZoom(zoomStep(zoom, -1)));
  const zAn = h('button', { type: 'button', class: 'fsp-expand', title: COPY.analyzer, 'aria-label': COPY.analyzer, 'aria-pressed': 'false' });
  const icon = s('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  icon.append(s('path', { d: 'M9.5 2.5h4v4M13.5 2.5l-5 5M6.5 13.5h-4v-4M2.5 13.5l5-5' }));
  zAn.append(icon);
  zAn.hidden = !onExpand;
  zAn.addEventListener('click', () => onExpand && onExpand(zAn.getAttribute('aria-pressed') !== 'true'));
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
      move(eff()[key] + d * (e.shiftKey ? 0.1 : 0.01));
    });
    p.addEventListener('keyup', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') commit(); });
    p.addEventListener('blur', commit);
    return p;
  });
  const dt = h('div', { class: 'fsp-dt', role: 'group', 'aria-label': COPY.detail }, dtSvg, ...pills,
    h('div', { class: 'fsp-zoom' }, zOut, zIn, zAn));
  const ph = h('i', { class: 'fsp-ph', 'aria-hidden': 'true' });
  const root = h('div', { class: 'fsp-tl' }, dt, ov, ph);
  el.append(root);

  const eff = () => (preview ? { ...T, ...preview } : T);

  function drawHeat() {
    bins.replaceChildren(...(script ? heatLevels(heat(script, HEAT_BINS), T, ceiling) : []).flatMap((b, i) => (b.over
      ? [0, 6, 12, 18].map((y) => s('rect', { class: 'bin over', x: String(i), y: String(y), width: '1', height: '3' }))
      : [s('rect', { class: 'bin', x: String(i), y: '0', width: '1', height: '24', 'fill-opacity': (0.08 + 0.92 * b.level).toFixed(3) })])));
  }

  function draw() {
    const d = dur(), Te = eff();
    const from = m - (d ? clamp(m / d, 0, 1) : 0.5) * zoom, to = from + zoom;
    curve.setAttribute('points', curvePoints(script, from, to, 1000, 100, Te));
    rawLine.setAttribute('points', raw && raw !== script ? curvePoints(raw, from, to, 1000, 100, Te) : '');
    curve.classList.toggle('draft', !!preview);
    real.replaceChildren(...traceLines(trace.map((x) => ({ m: x.m, u: x.p })), from, to, 1000, 100).map((l) => s('polyline', {
      class: 'plan', points: l.points })), ...traceLines(trace, from, to, 1000, 100).map((l) => s('polyline', {
      class: 'real' + (l.stale ? ' stale' : ''), points: l.points })));
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
    win.setAttribute('x', String(d ? from / d * HEAT_BINS : 0));
    win.setAttribute('width', String(d ? zoom / d * HEAT_BINS : 0));
    scrub.style.left = (d ? clamp(m / d, 0, 1) * 100 : 0) + '%';
    scrub.setAttribute('aria-valuemax', String(Math.round(d)));
    scrub.setAttribute('aria-valuenow', String(Math.round(m)));
    scrub.setAttribute('aria-valuetext', fmtTime(m));
    scrub.hidden = !script;
    ph.style.left = scrub.style.left;
    ph.hidden = !script;
  }

  return {
    setScript(sc, t, ceil, rawSc) {
      script = sc || null;
      raw = rawSc || null;
      T = t || T0;
      ceiling = ceil || null;
      drawHeat();
      draw();
    },
    frame(mediaMs, tr) {
      m = Number.isFinite(mediaMs) ? mediaMs : 0;
      trace = tr || [];
      draw();
    },
    setExpanded(on) { zAn.setAttribute('aria-pressed', String(!!on)); },
    unmount() { root.remove(); },
  };
}
