// scale.js -- Scale: the affine map every action takes before the wire, Manual or Auto; the settings card's row.
// Contract: CONTRACT.md, module scale; design: docs/plugins/FUNSCRIPT.md, Scale.
//
// Constraints:
// - The curve between actions is the hub's (smoothness on its Tuning card): wire() returns the actions
//   themselves, mapped, one knot each, with no velocity. At [0, 1] it returns the Script itself.
// - Every action takes p' = (p - lower) / (upper - lower): [lower, upper] is I.map when set (Auto's fit,
//   fitMap), else the symmetric gain's [0.5 - 0.5 / scale, 0.5 + 0.5 / scale].
// - Auto's extent is the twin's render of the wire at scale 1 (analyzer.js fit); scaleAuto is the
//   controller's (ui.js): it fits the map and passes it in.
// - Pure, no DOM at import time; mountScale touches the DOM only when called.

export const RANGES = Object.freeze({ scale: Object.freeze({ min: 0.25, max: 1, step: 0.01 }) });
export const SCALE = Object.freeze({ scale: 1, scaleAuto: true });
/** How far past 0..1 a fit reaches: the floor gain's. */
const REACH = 0.5 / RANGES.scale.min - 0.5;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Any value -> {scale, scaleAuto, map?}: scale clamped to RANGES, scaleAuto a boolean, map kept only when it is a fit. */
export function cleanScale(v) {
  const s = v && typeof v === 'object' ? v : {};
  const m = s.map, fit = Array.isArray(m) && m[0] <= 0 && m[0] >= -REACH && m[1] >= 1 && m[1] <= 1 + REACH;
  return { scale: typeof s.scale === 'number' && Number.isFinite(s.scale) ? clamp(s.scale, RANGES.scale.min, RANGES.scale.max) : SCALE.scale,
    scaleAuto: typeof s.scaleAuto === 'boolean' ? s.scaleAuto : SCALE.scaleAuto, ...(fit ? { map: [m[0], m[1]] } : {}) };
}

/** [lower, upper], the script values the window's 0 and 1 take: I.map, else the symmetric gain's. */
export const mapOf = (I) => I.map || [0.5 - 0.5 / I.scale, 0.5 + 0.5 / I.scale];

/**
 * An extent [min, max] at scale 1 -> the map that pulls in only the ends past 0..1, on the 0.01 grid, at most REACH
 * out. An end within 1e-4 of the grid stays on it: the planner's e4 positions and float32 shares carry that much noise.
 */
export function fitMap([lo, hi]) {
  const a = Number.isFinite(lo) ? Math.floor(Math.min(0, lo) * 100 + 0.01) / 100 : 0;
  const b = Number.isFinite(hi) ? Math.ceil(Math.max(1, hi) * 100 - 0.01) / 100 : 1;
  return [Math.max(-REACH, a), Math.min(1 + REACH, b)];
}

/** The Script the scheduler sends: the actions through mapOf(I); the script itself at [0, 1]. */
export function wire(script, I = SCALE) {
  if (!script) return script;
  const [a, b] = mapOf(cleanScale(I));
  return a === 0 && b === 1 ? script : { ...script, pos: Float32Array.from(script.pos, (p) => (p - a) / (b - a)) };
}

// ---- controls: the settings card --------------------------------------------

export const COPY = Object.freeze({
  scale: 'Scale',
  auto: 'Auto',
  autoTip: 'Fit the curve to the window',
  autoTo: '–',
});

export const CSS = `
.fsp-scale { display: grid; grid-template-columns: 10ch minmax(0, 1fr) 9ch; grid-auto-rows: var(--tap); gap: var(--sp-2) var(--sp-3); align-items: center; }
.fsp-scale label { color: var(--tx-mut); font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsp-scale input { min-height: var(--tap); margin: 0; min-width: 0; font: inherit; }
.fsp-scale input:focus-visible, .fsp-scale button:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
.fsp-scale .fsp-grow { display: flex; gap: var(--sp-2); align-items: center; min-width: 0; }
.fsp-scale .fsp-grow input { flex: 1 1 0; min-width: 0; }
.fsp-scale button { flex: none; min-height: var(--tap); min-width: var(--tap); padding: 0 var(--sp-3); background: none; color: var(--tx);
  border: 1px solid var(--line-2); border-radius: var(--r-s); cursor: pointer; font: inherit; }
.fsp-scale button[aria-pressed=true] { color: var(--highlight); border-color: var(--highlight); }
.fsp-scale .fsp-gcell { display: grid; align-items: center; min-width: 0; }
.fsp-scale .fsp-gcell input { width: 100%; box-sizing: border-box; background: var(--bg-card); color: var(--tx); border: 1px solid var(--line-2);
  border-radius: var(--r-s); padding: 0 var(--sp-2); font: .8rem var(--mono); text-align: right; }
.fsp-scale output { font: .8rem var(--mono); color: var(--tx-val); text-align: right; white-space: nowrap; }
.fsp-scale input:disabled { opacity: .4; }
.fsp-scale input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: var(--tap); background: none; cursor: ew-resize; }
.fsp-scale input[type=range]::-webkit-slider-runnable-track { height: 2px; background: var(--line-2); }
.fsp-scale input[type=range]::-moz-range-track { height: 2px; background: var(--line-2); }
.fsp-scale input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 20px; margin-top: -9px; border-radius: 4.5px;
  border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
.fsp-scale input[type=range]::-moz-range-thumb { width: 9px; height: 20px; border-radius: 4.5px; border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
`;

/**
 * The settings card's Scale row: Auto, the slider, a typed value; -> unmount(). gain() -> the map in force,
 * [lower, upper] (the player's); Auto reads out where 0 and 1 land, polled at 4 Hz.
 */
export function mountScale(el, { value, onChange, gain = () => null }) {
  let v = cleanScale(value);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, x] of Object.entries(attrs)) if (k === 'text') e.textContent = x; else e.setAttribute(k, x);
    e.append(...kids);
    return e;
  };
  const r = RANGES.scale;
  const sc = h('input', { type: 'range', 'aria-label': COPY.scale, title: COPY.scale, min: String(r.min), max: String(r.max), step: String(r.step) });
  const auto = h('button', { type: 'button', 'aria-label': COPY.auto, title: COPY.autoTip, text: COPY.auto });
  const typed = h('input', { type: 'number', min: String(r.min), max: String(r.max), step: String(r.step), 'aria-label': COPY.scale, title: COPY.scale });
  const gainOut = h('output', { class: 'fsp-gain' });
  const root = h('div', { class: 'fsp-scale', role: 'group', 'aria-label': COPY.scale }, h('style', { text: CSS }),
    h('label', { text: COPY.scale, title: COPY.scale }), h('span', { class: 'fsp-grow' }, auto, sc), h('span', { class: 'fsp-gcell' }, typed, gainOut));
  el.append(root);

  function drawGain() {
    if (!v.scaleAuto) return;
    const [a, b] = gain() ?? [0, 1], w = b - a;
    gainOut.value = (-a / w).toFixed(2) + COPY.autoTo + ((1 - a) / w).toFixed(2);
    sc.value = String(1 / w);
  }
  function draw() {
    auto.setAttribute('aria-pressed', String(v.scaleAuto));
    sc.disabled = typed.hidden = v.scaleAuto;
    gainOut.hidden = !v.scaleAuto;
    if (!v.scaleAuto) sc.value = typed.value = v.scale.toFixed(2);
    drawGain();
  }
  const commit = (partial) => { v = cleanScale({ ...v, ...partial }); draw(); onChange(v); };
  auto.addEventListener('click', () => commit({ scaleAuto: !v.scaleAuto }));
  sc.addEventListener('input', () => { typed.value = (+sc.value).toFixed(2); });
  sc.addEventListener('change', () => commit({ scale: +sc.value }));
  typed.addEventListener('change', () => { if (typed.value !== '' && Number.isFinite(+typed.value)) commit({ scale: +typed.value }); else draw(); });
  draw();
  // ponytail: polls the player's gain at 4 Hz; a player change event when a second readout needs one.
  const poll = setInterval(drawGain, 250);
  return () => { clearInterval(poll); root.remove(); };
}
