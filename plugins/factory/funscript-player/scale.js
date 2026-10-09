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

import { rowsBox, sub, sliderRow, switchRow } from './rows.js';

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
  fit: 'Fit to window',
  autoTip: 'Fit the curve to the window',
  autoTo: '–',
});

export const CSS = `
.fsp-scale { min-width: 0; }
`;

/**
 * The settings card's Scale rows (PR18): fit to window, a switch (Auto), and the scale slider with its value chip, which
 * reads where 0 and 1 land under Auto; -> unmount(). gain() -> the map in force, [lower, upper] (the player's), polled at 4 Hz.
 */
export function mountScale(el, { value, onChange, gain = () => null }) {
  let v = cleanScale(value);
  const r = RANGES.scale;
  const box = rowsBox(COPY.scale);
  box.classList.add('fsp-scale');
  box.prepend(Object.assign(document.createElement('style'), { textContent: CSS }));
  box.append(sub(COPY.scale));
  const auto = switchRow(box, COPY.fit, { tip: COPY.autoTip });
  auto.setAttribute('aria-label', COPY.auto);
  const { input: sc, out: gainOut } = sliderRow(box, COPY.scale, { min: r.min, max: r.max, step: r.step });
  gainOut.classList.add('fsp-gain');
  el.append(box);

  function drawGain() {
    if (!v.scaleAuto) return;
    const [a, b] = gain() ?? [0, 1], w = b - a;
    gainOut.value = (-a / w).toFixed(2) + COPY.autoTo + ((1 - a) / w).toFixed(2);
    sc.value = String(1 / w);
  }
  function draw() {
    auto.checked = v.scaleAuto;
    sc.disabled = v.scaleAuto;
    if (!v.scaleAuto) sc.value = gainOut.value = v.scale.toFixed(2);
    drawGain();
  }
  const commit = (partial) => { v = cleanScale({ ...v, ...partial }); draw(); onChange(v); };
  auto.addEventListener('change', () => commit({ scaleAuto: auto.checked }));
  sc.addEventListener('input', () => { gainOut.value = (+sc.value).toFixed(2); });
  sc.addEventListener('change', () => commit({ scale: +sc.value }));
  draw();
  // ponytail: polls the player's gain at 4 Hz; a player change event when a second readout needs one.
  const poll = setInterval(drawGain, 250);
  return () => { clearInterval(poll); box.remove(); };
}
