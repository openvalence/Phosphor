// analyzer.js -- the expanded heat: lag readout and the hub's Tuning controls, Live or Preview
// Contract: CONTRACT.md, module player-ui (ph-smvd.11); design: docs/plugins/FUNSCRIPT.md (Analyzer).
//
// Constraints:
// - Binds by the catalog only: writable fields of every group whose first
//   segment is the registry's Tuning subgroup (RFC-094), writable fields that
//   share a write channel with those, and limit.input.* by role. Never a
//   channel id, never a field name; a hub without them shows the empty words.
// - Every value reaches the machine through api.write (Live) or
//   api.writeTrial (Preview); Apply is api.commitTrial, Discard
//   api.revertTrial. A mode switch writes nothing.
// - A slider writes once on release; a drag previews in the intent look. Without a
//   catalog step it moves in hundredths of its range.
// - A segmented field of more than two options takes the select presentation:
//   three 40 px buttons do not fit the control column of a panel at its 320 px floor.
// - The ladder is a 3 px bar per row: --intent pending, --warn overdue or
//   fault; the reason and the gate ride the row tooltip. No red (law 13).
// - Rows are var(--tap) high and the head rows fixed; the list scrolls inside
//   its own box, so a state change moves nothing.
// - lagOf is a scope, not a measurement: telemetry arrives on its own cadence.
// - The motion preview is the machine's own planner (kinetic/kinetic.js), fed the wire Script (scale.js
//   wire(), one segment per action), the limits and window by role and the Tuning rows as shown (a drag's
//   draft included); every change re-renders and a newer render supersedes. When the worker fails the line
//   reads 'Kinetic: fallback' and the timeline draws straight lines between the actions.
// - The readouts are the wasm sample flags and anomaly bits, counted over every 1 ms step; the readout's
//   --intent swatch is the legend of the timeline's intent curve, the render itself.
// - kinetic is the latest render of the current script() only: a render of another script is never drawn.
// - fit() (Auto Scale): once the preview is current, one more render of that Script measures the planner's
//   own min and max with the walls out of reach: the same mm geometry in the middle half of a window twice as
//   wide, so the window guards (end velocity cut, clamp) never bend it. Without the rail room for that window
//   the measure is null and the controller keeps its curve estimate.

import { posAt } from './funscript.js';
import { applyT } from './scheduler.js';
import { createKinetic, segmentsOf, tuningOf, ANOMALIES, EVERY, FREE } from './kinetic/kinetic.js';

export const TUNING = 'Tuning';
export const LIMIT_ROLES = Object.freeze(['limit.input.speed', 'limit.input.accel', 'limit.input.jerk']);
export const LAG_MIN_MS = -100, LAG_MAX_MS = 400, LAG_STEP_MS = 2, LAG_MIN_POINTS = 30, LAG_EVERY_MS = 500;
export const KIN_MAX_SAMPLES = 200000;
/** A wall-free measure render puts the window's share p at WIDE_AT + p x WIDE_SPAN of a window twice as wide. */
export const WIDE_AT = 0.25, WIDE_SPAN = 0.5;
const CONTROLS = new Set(['slider', 'stepper', 'toggle', 'segmented', 'select']);
const TRIAL_ROLE = 'action.trial';

export const COPY = Object.freeze({
  live: 'Live',
  liveTip: 'Writes are stored',
  preview: 'Preview',
  previewTip: 'Writes apply live, unstored',
  apply: 'Apply',
  applyTip: 'Store the preview values',
  discard: 'Discard',
  discardTip: 'Put the stored values back',
  lag: 'Lag',
  plan: 'Plan',
  none: '--',
  empty: 'No tuning controls on this hub',
  trial: 'Preview: not saved',
  noTrial: 'hub has no trial writes',
  kinWasm: 'Kinetic: wasm',
  kinFallback: 'Kinetic: fallback',
  noLimits: 'no limits, window or rail',
  anomalies: 'anomalies',
  clamped: 'clamped',
  stretched: 'stretched',
  shaped: 'shaped',
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const segs = (name) => String(name || '').split(' / ');

/** [{name, fields}]: the hub's Tuning groups, then their write channels' other groups, then limit.input.*. */
export function tuningGroups(model) {
  if (!model || !model.categories) return [];
  const all = model.categories.flatMap((c) => c.groups.map((g) => ({ g, cat: c.label })));
  const editable = (f) => !f.readOnly && f.writeChannel != null && CONTROLS.has(f.widget);
  const isTuning = (g) => segs(g.name)[0] === TUNING;
  const tuned = all.filter(({ g }) => isTuning(g))
    .map(({ g }) => ({ name: segs(g.name).slice(1).join(' / ') || TUNING, fields: g.fields.filter(editable) }));
  const chans = new Set(tuned.flatMap((g) => g.fields.map((f) => f.writeChannel)));
  const extra = all.filter(({ g }) => !isTuning(g))
    .map(({ g, cat }) => ({ name: g.name || cat, fields: g.fields.filter((f) => editable(f)
      && (chans.has(f.writeChannel) || LIMIT_ROLES.includes(f.role))) }));
  return [...tuned, ...extra].filter((g) => g.fields.length);
}

/**
 * The shift d (ms) that best lays trace[key] over the script commanded d ms
 * earlier, both as window shares after T; null with too few points or too
 * little motion to tell. trace: [{m, u, p, stale}] on the media axis.
 */
export function lagOf(trace, script, T, key = 'u') {
  if (!script) return null;
  const pts = (trace || []).filter((x) => x[key] != null && !x.stale && Number.isFinite(x[key]));
  if (pts.length < LAG_MIN_POINTS) return null;
  let lo = Infinity, hi = -Infinity;
  for (const x of pts) { lo = Math.min(lo, x[key]); hi = Math.max(hi, x[key]); }
  if (hi - lo < 0.1) return null;
  let best = null, err = Infinity;
  for (let d = LAG_MIN_MS; d <= LAG_MAX_MS; d += LAG_STEP_MS) {
    let e = 0;
    for (const x of pts) e += Math.abs(x[key] - applyT(posAt(script, x.m - d), T));
    if (e < err) { err = e; best = d; }
  }
  return best;
}

/** The value one press of a toggle sends: the other end. */
export function toggled(f, v) {
  return Number(v) ? (f.options && f.options.length ? 0 : (f.min ?? 0)) : (f.options && f.options.length ? 1 : (f.max ?? 1));
}

/** A value as the row shows it: four significant figures, the unit, or the option name. */
export function fmtValue(f, v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return COPY.none;
  if (f.options && f.options.length && f.widget !== 'toggle') return String(f.options[Number(v)] ?? v);
  if (f.widget === 'toggle') return f.options && f.options[Number(v)] ? String(f.options[Number(v)]) : String(v);
  const n = Number(v);
  const t = Math.abs(n) >= 1000 ? String(Math.round(n)) : String(Number(n.toPrecision(4)));
  return f.unit ? t + ' ' + f.unit : t;
}

export const CSS = `
.fsa { height: 100%; min-height: 0; display: grid; gap: var(--sp-2); grid-template-rows: var(--tap) 20px 20px minmax(0, 1fr); }
.fsa-head { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.fsa-head .fsp-btn { padding: 0 var(--sp-3); }
.fsa-head .fsa-gap { flex: 1 1 0; }
.fsa-lag { height: 20px; line-height: 20px; font: .75rem var(--mono); color: var(--tx-mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsa-kin::before { content: ''; display: inline-block; width: 12px; height: 2px; margin-right: var(--sp-2); vertical-align: middle; background: var(--intent); }
.fsa-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--line); border-radius: var(--r-s); }
.fsa-g { height: 20px; line-height: 20px; padding: 0 var(--sp-2); font-size: .72rem; color: var(--tx-mut); background: var(--bg-sunken); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsa-row { position: relative; height: var(--tap); display: grid; align-items: center; gap: var(--sp-2); padding: 0 var(--sp-2) 0 var(--sp-3);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) 9ch; }
.fsa-row::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 1.5px; background: transparent; }
.fsa-row[data-st=pending]::before { background: var(--intent); }
.fsa-row[data-st=overdue]::before, .fsa-row[data-st=fault]::before { background: var(--warn); }
.fsa-k { font-size: .78rem; color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsa-v { font: .72rem var(--mono); color: var(--tx-val); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsa-row[data-draft] .fsa-v { color: var(--intent); }
.fsa-c { min-width: 0; display: flex; gap: var(--sp-1); align-items: center; height: var(--tap); }
.fsa-c > * { min-width: 0; }
.fsa-c .fsp-btn { flex: 1 1 0; padding: 0 var(--sp-2); overflow: hidden; text-overflow: ellipsis; font-size: .75rem; }
.fsa-c select, .fsa-c input[type=number] { width: 100%; min-height: var(--tap); font: .75rem var(--mono); }
.fsa-c input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: var(--tap); margin: 0; background: none; cursor: ew-resize; }
.fsa-c input[type=range]::-webkit-slider-runnable-track { height: 2px; background: var(--line-2); }
.fsa-c input[type=range]::-moz-range-track { height: 2px; background: var(--line-2); }
.fsa-c input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 20px; margin-top: -9px; border-radius: 4.5px;
  border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
.fsa-c input[type=range]::-moz-range-thumb { width: 9px; height: 20px; border-radius: 4.5px; border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
.fsa-c input[type=range]:focus-visible { outline: 2px solid var(--highlight); outline-offset: -2px; }
.fsa-c :disabled { opacity: .4; cursor: default; }
.fsa-empty { padding: var(--sp-3) var(--sp-2); font-size: .78rem; color: var(--tx-mut); }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const setText = (e, t) => { if (e.textContent !== t) e.textContent = t; };
const setAttr = (e, k, v) => { if (e.getAttribute(k) !== v) e.setAttribute(k, v); };

/**
 * A wall-free render's [min, max], script units: raw (window shares of the wide window, one every dtMs from
 * media t0) over [fromMs, toMs], back through WIDE_* and T's Range and invert.
 */
export function wideExtent(raw, t0, dtMs, fromMs, toMs, T) {
  const span = T.hi - T.lo, j0 = Math.max(0, Math.ceil((fromMs - t0) / dtMs)), j1 = Math.min(raw.length, Math.floor((toMs - t0) / dtMs) + 1);
  let lo = Infinity, hi = -Infinity;
  for (let j = j0; j < j1; j++) {
    const n = ((raw[j] - WIDE_AT) / WIDE_SPAN - T.lo) / span, p = T.invert ? 1 - n : n;
    lo = Math.min(lo, p); hi = Math.max(hi, p);
  }
  return [lo, hi];
}

/** The Kinetic readout: the status word, the anomaly count and each flag's nonzero time, or the refusal. */
export function kinText(state, r) {
  if (state !== 'wasm') return COPY.kinFallback;
  if (!r) return COPY.kinWasm;
  if (r.error) return COPY.kinWasm + '  ' + r.error;
  const s = (n) => (n < 1000 ? n + ' ms' : (n / 1000).toFixed(1) + ' s');
  const a = r.anomalies.reduce((x, y) => x + y, 0);
  return [COPY.kinWasm, a + ' ' + COPY.anomalies, ...[[COPY.clamped, 3], [COPY.stretched, 2], [COPY.shaped, 1]]
    .filter(([, b]) => r.counts[b]).map(([w, b]) => w + ' ' + s(r.counts[b]))].join('  ');
}

/**
 * deps: api; trace() -> the player's trace [{m, u, p, stale}]; script() -> Script | null; T() -> the transform;
 * fit() -> the Script to measure for Auto Scale (the wire at scale 1) or null.
 * -> { frame(), get mode(), get kinetic() (the latest render or null), get fit() ({sc, extent} | null), unmount() }
 */
export function mountAnalyzer(el, { api, trace = () => [], script = () => null, T = () => ({ offsetMs: 0, lo: 0, hi: 1, invert: false }),
  fit = () => null }) {
  const capable = () => !!api.field(TRIAL_ROLE);
  let mode = capable() ? 'preview' : 'live';
  let note = '', lagAt = -Infinity, lagText = '', model = null, rows = [];
  const btn = (text, tip) => h('button', { type: 'button', class: 'fsp-btn', text, title: tip });
  const bLive = btn(COPY.live, COPY.liveTip);
  const bPrev = btn(COPY.preview, COPY.previewTip);
  const bApply = btn(COPY.apply, COPY.applyTip);
  const bDiscard = btn(COPY.discard, COPY.discardTip);
  const modes = h('span', { class: 'fsa-head', role: 'group', 'aria-label': COPY.preview }, bLive, bPrev);
  const head = h('div', { class: 'fsa-head' }, modes, h('span', { class: 'fsa-gap' }), bApply, bDiscard);
  const lag = h('output', { class: 'fsa-lag' });
  const kinEl = h('output', { class: 'fsa-lag fsa-kin' });
  const list = h('div', { class: 'fsa-list' });
  const root = h('div', { class: 'fsa' }, head, lag, kinEl, list);
  el.append(root);

  let kin = null, kinState = 'wasm', kinKey = '', kinSc = null, kinR = null, version = '', busy = 0, seq = 0, fitR = null;
  // The fallback's tooltip is the failure, where the version would be.
  const kinFail = (e) => { kinState = 'fallback'; kinR = null; version = String((e && e.message) || e || 'Kinetic failed'); };
  try {
    kin = createKinetic();
    kin.ready.then((v) => { version = v; }, kinFail);
  } catch (e) { kinFail(e); }
  const shown = (it) => Number(it.draft != null ? it.draft : api.value(it.f));
  /** Re-render through the worker when the script, T, a limit, the window or a shown Tuning value changed. */
  function kinetic() {
    const sc = script(), t = T();
    if (kinState !== 'wasm' || !sc || !sc.at.length) return;
    const v = (role) => { const it = rows.find((x) => x.f.role === role); return it ? shown(it) : Number(api.value(api.field(role))); };
    const limits = { vmax: v('limit.input.speed'), amax: v('limit.input.accel'), jmax: v('limit.input.jerk'), rail: v('geometry.max_travel'), horizonMs: 0 };
    const win = [v('window.min'), v('window.max')];
    if (!Object.values(limits).slice(0, 4).every((x) => x > 0) || !(win[1] > win[0])) { kinR = { error: COPY.noLimits }; kinSc = null; return; }
    const tuning = tuningOf(rows.map((it) => [it.f, shown(it)]));
    const key = JSON.stringify([limits, win, tuning, t]);
    const run = (s, w, map, done) => {
      const id = busy = ++seq, { segs, t0, steps } = segmentsOf(s, t), every = Math.max(EVERY, Math.ceil(steps / KIN_MAX_SAMPLES));
      kin.render({ limits, window: w, tuning, segs: map ? segs.map(map) : segs, steps, stepMs: 1, every }).then((r) => {
        if (busy === id) busy = 0;
        if (r) done(r, t0, every);
      }, kinFail);
    };
    if (sc !== kinSc || key !== kinKey) {
      kinSc = sc; kinKey = key;
      run(sc, win, null, (r, t0, every) => { kinR = r.error ? { error: r.error } : { ...r, t0, dtMs: every, lo: win[0], hi: win[1], sc }; });
      return;
    }
    const f = fit();
    if (busy || !f || (fitR && fitR.sc === f && fitR.key === key)) return;
    const w = win[1] - win[0], c = clamp((win[0] + win[1]) / 2, w, limits.rail - w);
    if (!(limits.rail >= 2 * w)) { fitR = { sc: f, key, extent: null }; return; }
    run(f, [c - w, c + w], ([a, p, d, v, fam]) => [a, Math.round(WIDE_AT * 10000 + p * WIDE_SPAN), d, v === FREE ? v : Math.round(v * WIDE_SPAN), fam], (r, t0, every) => {
      fitR = { sc: f, key, extent: r.error ? null : wideExtent(r.raw, t0, every, f.at[0] + (t.offsetMs || 0), f.at[f.at.length - 1] + (t.offsetMs || 0), t) };
    });
  }

  const fail = (r) => { if (r && r.ok === false) note = r.error || ''; };
  const setMode = (m) => { mode = m; note = ''; frame(); };
  bLive.addEventListener('click', () => setMode('live'));
  bPrev.addEventListener('click', () => { if (capable()) setMode('preview'); });
  const op = (fn) => () => { note = ''; Promise.resolve(fn()).then(fail, (e) => { note = (e && e.message) || String(e); }); };
  bApply.addEventListener('click', op(() => api.commitTrial()));
  bDiscard.addEventListener('click', op(() => api.revertTrial()));

  function send(f, v) {
    note = '';
    if (mode === 'preview' && capable()) fail(api.writeTrial(f, v));
    else api.write(f, v);
  }

  function row(f) {
    const v = h('output', { class: 'fsa-v' });
    const c = h('span', { class: 'fsa-c' });
    const r = h('div', { class: 'fsa-row' }, h('span', { class: 'fsa-k', text: f.label || f.name }), c, v);
    const it = { f, r, v, c, draft: null, inputs: [], paint: null };
    if (f.widget === 'slider') {
      const i = h('input', { type: 'range', min: String(f.min), max: String(f.max), step: String(f.step || (f.max - f.min) / 100), 'aria-label': f.label || f.name });
      i.addEventListener('input', () => { it.draft = +i.value; paint(it); });
      i.addEventListener('change', () => { const x = it.draft; it.draft = null; if (x != null) send(f, x); paint(it); });
      c.append(i);
      it.inputs = [i];
      it.paint = (val) => { if (it.draft == null && document.activeElement !== i) i.value = String(val ?? f.min); };
    } else if (f.widget === 'stepper') {
      const i = h('input', { type: 'number', step: String(f.step || 'any'), 'aria-label': f.label || f.name });
      if (f.min != null) i.min = String(f.min);
      if (f.max != null) i.max = String(f.max);
      i.addEventListener('change', () => {
        const x = Number(i.value);
        if (i.value === '' || !Number.isFinite(x)) return;
        send(f, clamp(x, f.min ?? -Infinity, f.max ?? Infinity));
      });
      c.append(i);
      it.inputs = [i];
      it.paint = (val) => { if (document.activeElement !== i) i.value = val == null ? '' : String(val); };
    } else if (f.widget === 'toggle') {
      const b = h('button', { type: 'button', class: 'fsp-btn', text: f.options && f.options[1] ? String(f.options[1]) : COPY.live, 'aria-label': f.label || f.name });
      b.addEventListener('click', () => send(f, toggled(f, api.value(f))));
      c.append(b);
      it.inputs = [b];
      it.paint = (val) => setAttr(b, 'aria-pressed', String(!!Number(val)));
    } else if (f.widget === 'segmented' && f.options.length <= 2) {
      it.inputs = f.options.map((o, k) => {
        const b = h('button', { type: 'button', class: 'fsp-btn', text: String(o) });
        b.addEventListener('click', () => send(f, k));
        c.append(b);
        return b;
      });
      it.paint = (val) => it.inputs.forEach((b, k) => setAttr(b, 'aria-pressed', String(Number(val) === k)));
    } else {
      const s = h('select', { 'aria-label': f.label || f.name }, ...f.options.map((o, k) => h('option', { value: String(k), text: String(o) })));
      s.addEventListener('change', () => send(f, Number(s.value)));
      c.append(s);
      it.inputs = [s];
      it.paint = (val) => { if (document.activeElement !== s) s.value = String(val); };
    }
    return it;
  }

  function build() {
    model = api.catalog();
    const groups = tuningGroups(model);
    rows = [];
    list.replaceChildren(...(groups.length ? groups.flatMap((g) => {
      const its = g.fields.map(row);
      rows.push(...its);
      return [h('div', { class: 'fsa-g', text: g.name }), ...its.map((x) => x.r)];
    }) : [h('div', { class: 'fsa-empty', text: COPY.empty })]));
  }

  function paint(it) {
    const val = api.value(it.f);
    it.paint(val);
    setText(it.v, fmtValue(it.f, it.draft != null ? it.draft : val));
    it.r.toggleAttribute('data-draft', it.draft != null);
    setAttr(it.r, 'data-st', api.status(it.f));
    const gate = api.gate(it.f) || '';
    const tip = gate || api.reason(it.f) || api.stale(it.f) || it.f.desc || '';
    if (it.r.title !== tip) it.r.title = tip;
    for (const i of it.inputs) if (i.disabled !== !!gate) i.disabled = !!gate;
  }

  function frame() {
    if (api.catalog() !== model) build();
    const cap = capable();
    if (!cap && mode === 'preview') mode = 'live';
    setAttr(bLive, 'aria-pressed', String(mode === 'live'));
    setAttr(bPrev, 'aria-pressed', String(mode === 'preview'));
    bPrev.disabled = !cap;
    bPrev.title = cap ? COPY.previewTip : COPY.noTrial;
    const pending = !!api.trialPending;
    bApply.disabled = bDiscard.disabled = !cap || !pending;
    for (const it of rows) paint(it);
    const now = performance.now();
    if (now - lagAt >= LAG_EVERY_MS) {
      lagAt = now;
      const tr = trace(), sc = script(), t = T();
      const fmt = (d) => (d == null ? COPY.none : d + ' ms');
      lagText = COPY.lag + ' ' + fmt(lagOf(tr, sc, t, 'u')) + '  ' + COPY.plan + ' ' + fmt(lagOf(tr, sc, t, 'p'));
    }
    setText(lag, note || lagText);
    kinetic();
    setText(kinEl, kinText(kinState, kinR));
    const tip = kinR && kinR.anomalies ? [version, Math.round(kinR.ms) + ' ms', ...[...kinR.anomalies].map((n, b) => (n && ANOMALIES[b] ? ANOMALIES[b] + ' ' + n : ''))
      .filter(Boolean)].join('\n') : version;
    if (kinEl.title !== tip) kinEl.title = tip;
  }

  frame();
  return {
    frame,
    get mode() { return mode; },
    get kinetic() { return kinR && kinR.pos && kinR.sc === script() ? kinR : null; },
    get fit() { return fitR; },
    unmount() { if (kin) kin.close(); root.remove(); },
  };
}
