<script>
  /**
   * Field.svelte — renders ONE catalog field, whatever it is.
   *
   * This component has never heard of a Nucleus. It is handed a field
   * descriptor produced by buildSettingsModel() and picks a control from the
   * field's TYPE and its RFC-009 constraints. A machine that ships a setting we
   * have never seen renders here correctly, with the right bounds, the right
   * step, the right unit and the right option labels, because all of those came
   * off the wire.
   *
   * GROUND TRUTH: the displayed value comes from shadow.displayValue(), which
   * returns the device's reported value except while a write of OUR OWN is in
   * flight. The `data-shadow` attribute carries the write's lifecycle so CSS can
   * show unconfirmed state without this component knowing what amber means.
   */
  import { untrack } from 'svelte';
  import { machine, freshness, staleReason } from '../model/machine.svelte.js';
  import { WIDGET, READ_ONLY_PRESENTATIONS, isFieldEnabled, reportedValue, resetsToDefault } from '../model/settings.js';
  import { writeSetting, displayValue, statusOf, shadowOf, partsOf } from '../model/shadow.svelte.js';
  import { settingNeedsConfirm, confirmCopy } from '../model/actions.js';
  import { sameValue } from '../model/merge.js';
  import { askConfirm } from './confirm.svelte.js';
  import { deferring } from './defer.js';
  import { modStep, dragGain, snap as modSnap } from '../model/nudge.js';
  import { PACKED } from '../../../Valence/clients/js/index.js';
  import {
    formatParts, formatWithUnit, unitOf, optionLabel, precisionFor, labelFor, statTag,
    hubClockNow, hubSecToWallMs, wallMsToHubSec, armMoment, staleMoment,
  } from '../model/format.js';

  // `presentation`: one of settings.js offeredPresentations(field), chosen by
  // the user (DESIGN §10.2); absent means the derived widget. `orientation`
  // follows the placement's own aspect (settings.js orientationOf).
  let { field, presentation = null, orientation = 'h' } = $props();
  const pres = $derived(presentation || field.widget);
  // A read-only presentation of a writable field writes nothing (RFC-080 draft item 3).
  const displayOnly = $derived(!field.readOnly && READ_ONLY_PRESENTATIONS.has(pres));

  // DOM ids are per INSTANCE: one control may be placed twice (a duplicate, or
  // one field in two nests), and an id shared by two elements points a label
  // at the wrong input. field.uid stays on data-uid for anything that needs it.
  const iid = $props.id();
  const domId = $derived(field.uid + '~' + iid);
  const labelId = $derived(domId + '-label');
  // Presentations whose element carrying domId a <label for> may name.
  const LABELABLE = new Set([WIDGET.slider, WIDGET.stepper, WIDGET.text, WIDGET.secret, WIDGET.select,
    WIDGET.toggle, WIDGET.datetime, WIDGET.color, WIDGET.numeral]);

  // ⓘ affordance state (OG density doctrine — a description is NOT printed
  // inline by default, it lives behind a per-field toggle). Local, default
  // closed; resets whenever this component instance changes field.
  let descOpen = $state(false);
  const descId = $derived(domId + '-desc');

  const sample = $derived(machine.samples[field.channelId]);
  const value = $derived(displayValue(field, sample));
  // A range field has no shadow key of its own (settings.js's merge invents
  // no writeChannel/settingKey) — the ladder reads the WORSE of its two
  // real fields' statuses, so a write still in flight on either thumb keeps
  // the whole control's ladder alive (Ground Truth: never show settled
  // while a request is outstanding).
  const STATUS_RANK = { fault: 3, overdue: 2, pending: 1, confirmed: 0 };
  const worstStatus = (a, b) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);
  const parts = $derived(partsOf(field));
  const status = $derived(parts.map(statusOf).reduce(worstStatus));
  const fresh = $derived(freshness(field.channelId));
  // A composite's echo is either part's echo; its fault words are the faulted part's.
  const shs = $derived(parts.map(shadowOf).filter(Boolean));
  const settled = $derived(shs.some((s) => s.settled));
  const faultWhy = $derived((shs.find((s) => s.status === 'fault') || {}).error);
  // A virtual hub measured nothing: its echo is not reality (DESIGN §10.10).
  const virtual = $derived(!!machine.link.virtual);

  // Three independent reasons a control may be unusable, and they are NOT
  // interchangeable — the operator needs to know which one applies.
  const maskOn = $derived(isFieldEnabled(field, sample));
  const linkUp = $derived(machine.link.phase === 'live');
  const tierOk = $derived(canWrite(field));
  const enabled = $derived(!field.readOnly && !displayOnly && maskOn && linkUp && tierOk);

  // The gate in words (law 3). A composite (range, color) names the first
  // closed gate among its own fields.
  const gateOf = (f) => (!linkUp ? 'no hub link'
    : !canWrite(f) ? 'session not authorized'
    : !isFieldEnabled(f, machine.samples[f.channelId]) ? 'disabled by the machine'
    : '');
  const reason = $derived(
    displayOnly || field.readOnly ? ''
    : field.widget === WIDGET.range ? [field.lo, field.hi].map(gateOf).find(Boolean) || ''
    : field.widget === WIDGET.color ? [field.r, field.g, field.b].map(gateOf).find(Boolean) || ''
    : gateOf(field)
  );

  /**
   * Does this session's access tier permit writing here? The INTENT channel
   * advertises its own required access; we compare rather than assume, so a
   * watch-tier viewer grays the write plane instead of discovering it by NACK.
   */
  function canWrite(f) {
    if (f.readOnly) return false;
    const e = machine.catalog.entries.find((x) => x.id === f.writeChannel);
    if (!e) return false;
    return (machine.link.roles | 0) >= (e.access | 0);
  }

  function commit(v) {
    if (!enabled) return;
    writeSetting(field, v);
  }

  // A placement's two-valued toggle (settings.js placementLook, RFC-080 draft
  // item 5): on means the machine reports B; a press writes the other value.
  const tog = $derived(field.toggle || null);
  const toggleOn = $derived(tog ? Number(value) === tog.b : !!value);

  // RENDERING §10.1 rule 2: a background_run enable confirms first; a cancel
  // puts the switch back to what the machine reports.
  async function commitToggle(el) {
    const to = tog ? (el.checked ? tog.b : tog.a) : el.checked ? 1 : 0;
    if (settingNeedsConfirm(field, value, to) && !(await askConfirm(confirmCopy(field, to)))) {
      el.checked = toggleOn;
      return;
    }
    commit(to);
  }

  // RFC-080 draft item 4: ground truth wins over a placement's narrowing. A
  // reported value outside it is shown as it is and marked, never pinned.
  const outOfRange = $derived.by(() => {
    const n = Number(value);
    return !!field.narrowed && value != null && isFinite(n) && (n < field.min || n > field.max);
  });

  /**
   * Write a number the operator produced, held inside the published bounds and
   * rounded off the float grid — repeated 0.1 nudges otherwise drift into
   * 0.30000000000000004 and write THAT to the machine. Sole path for both the
   * stepper's nudges and a typed value, so neither can clamp differently.
   */
  function commitNumber(n) {
    if (!isFinite(n)) return;
    if (field.min != null) n = Math.max(field.min, n);
    if (field.max != null) n = Math.min(field.max, n);
    commit(Math.round(n * 1e6) / 1e6);
  }

  // A number input shows the value at the field's precision, never the f32 noise.
  const inputNum = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(precisionFor(field)) : v ?? '');
  // An emptied box writes nothing and shows the value again.
  function commitTyped(el) {
    if (el.value.trim() === '') el.value = inputNum(shown);
    else commitNumber(Number(el.value));
  }

  // ---- RENDERING §11: dual-thumb range (a merged min/max role pair) -------
  //
  // WIDGET.range wraps TWO ordinary fields (settings.js's `lo`/`hi`), each
  // with its own channel, sample and shadow — the generic single-field
  // derivations above (sample/value/status/enabled/reason) do not apply and
  // are recomputed per side here. Each thumb writes through the SAME
  // writeSetting() path an independent slider would use, so the shadow
  // lifecycle and Ground Truth echo are unchanged; this is one control drawn
  // over two fields, not a new write mechanism.
  const isRange = $derived(field.widget === WIDGET.range);
  const loSample = $derived(isRange ? machine.samples[field.lo.channelId] : null);
  const hiSample = $derived(isRange ? machine.samples[field.hi.channelId] : null);
  const loValue = $derived(isRange ? displayValue(field.lo, loSample) : null);
  const hiValue = $derived(isRange ? displayValue(field.hi, hiSample) : null);
  const loEnabled = $derived(isRange && !field.lo.readOnly && isFieldEnabled(field.lo, loSample)
    && machine.link.phase === 'live' && canWrite(field.lo));
  const hiEnabled = $derived(isRange && !field.hi.readOnly && isFieldEnabled(field.hi, hiSample)
    && machine.link.phase === 'live' && canWrite(field.hi));
  const loFrac = $derived.by(() => {
    if (!isRange) return 0;
    const n = Number(shownLo);
    if (!isFinite(n) || field.lo.max <= field.lo.min) return 0;
    return Math.max(0, Math.min(1, (n - field.lo.min) / (field.lo.max - field.lo.min)));
  });
  const hiFrac = $derived.by(() => {
    if (!isRange) return 1;
    const n = Number(shownHi);
    if (!isFinite(n) || field.hi.max <= field.hi.min) return 1;
    return Math.max(0, Math.min(1, (n - field.hi.min) / (field.hi.max - field.hi.min)));
  });
  function clampField(f, n) {
    let v = n;
    if (f.min != null) v = Math.max(f.min, v);
    if (f.max != null) v = Math.min(f.max, v);
    return Math.round(v * 1e6) / 1e6;
  }
  // Each thumb is also held inside the OTHER thumb's live value, so the pair
  // can never cross on screen (a min past its own max reads as a lie about
  // which end of the window is which).
  function commitLo(n) {
    if (!loEnabled || !isFinite(n)) return;
    const ceiling = isFinite(Number(hiValue)) ? Number(hiValue) : field.lo.max;
    writeSetting(field.lo, clampField(field.lo, Math.min(n, ceiling)));
  }
  function commitHi(n) {
    if (!hiEnabled || !isFinite(n)) return;
    const floor = isFinite(Number(loValue)) ? Number(loValue) : field.hi.min;
    writeSetting(field.hi, clampField(field.hi, Math.max(n, floor)));
  }
  const rangeStep = (f) => f.step || 1;

  // ---- Alt-drag (defer.js): one write, on release -------------------------
  // `held` is the value a deferred drag will write ({side: 'v'|'lo'|'hi', n});
  // the control draws it, the ring wears pending without pulses, and a
  // cancelled pointer drops it unwritten.
  let held = $state(null);
  let drag = null;
  const WRITE = { v: (n) => commitNumber(n), lo: (n) => commitLo(n), hi: (n) => commitHi(n) };
  function dragStart(e) {
    drag = { id: e.pointerId, pointerType: e.pointerType };
    held = null;
    rel = null;
    window.addEventListener('pointerup', dragEnd);
    window.addEventListener('pointercancel', dragEnd);
  }
  function dragWrite(side, n) {
    if (drag && deferring(drag)) { held = { side, n }; return; }
    held = null;
    WRITE[side](n);
  }
  function dragEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointerup', dragEnd);
    window.removeEventListener('pointercancel', dragEnd);
    const h = held;
    drag = null;
    held = null;
    rel = null;
    knobDrag = null;
    if (h && e.type === 'pointerup') WRITE[h.side](h.n);
  }
  // Shift or Ctrl at pointerdown on a native range: the thumb does not jump to
  // the pointer; the drag moves the value relative to where it started
  // (nudge.js dragGain, snap), modifiers read at every move.
  let rel = null;
  function relDown(e, side) {
    dragStart(e);
    if (!e.shiftKey && !e.ctrlKey) return;
    const f = side === 'v' ? field : field[side];
    const el = e.currentTarget;
    const raw = side === 'v' ? value : side === 'lo' ? loValue : hiValue;
    const n = raw == null ? NaN : Number(raw);
    el.setPointerCapture(e.pointerId);
    rel = { side, f, el, x: e.clientX, v: isFinite(n) ? n : f.min, last: n, w: el.getBoundingClientRect().width || 1 };
  }
  // Incremental like the knob: a modifier change mid-drag never jumps the value.
  function relMove(e) {
    if (!rel) return;
    const { f, side } = rel, st = side === 'v' ? step : rangeStep(f);
    rel.v = Math.max(f.min, Math.min(f.max, rel.v + ((e.clientX - rel.x) / rel.w) * (f.max - f.min) * dragGain(e, 1)));
    rel.x = e.clientX;
    let n = f.min + Math.round((modSnap(rel.v, e, f.min, f.max, 0, st) - f.min) / st) * st;
    n = Math.max(f.min, Math.min(f.max, n));
    rel.el.value = n;
    if (n !== rel.last) { rel.last = n; dragWrite(side, n); }
  }
  // Mouse default drags the native thumb; with a modifier the relative path owns the drag.
  const relGuard = (e) => { if (e.shiftKey || e.ctrlKey) { e.preventDefault(); e.currentTarget.focus(); } };
  // Shift+Arrow is the native one step; Ctrl+Arrow goes to the adjacent decade multiple.
  function sliderKey(e, side) {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!dir || !e.ctrlKey || !enabled) return;
    e.preventDefault();
    if (side === 'v') return nudge(dir, e);
    const f = field[side], b = Number(side === 'lo' ? loValue : hiValue);
    (side === 'lo' ? commitLo : commitHi)(modSnap(isFinite(b) ? b : f.min, e, f.min, f.max, dir, rangeStep(f)));
  }
  $effect(() => () => { if (drag) dragEnd({ pointerId: drag.id, type: 'pointercancel' }); });
  const heldOf = (side, v) => (held && held.side === side ? held.n : v);
  const shown = $derived(heldOf('v', value));
  const shownLo = $derived(heldOf('lo', loValue));
  const shownHi = $derived(heldOf('hi', hiValue));

  // ---- RENDERING §8.2 row 16 (RFC-083): one picker over a group's RGB -------
  // Each channel maps its own published [min, max] onto 0..255. The three
  // writes leave in one tick, so on a shared write channel they coalesce into
  // one intent (shadow.svelte.js flush).
  const isColor = $derived(field.widget === WIDGET.color);
  const rgbFields = $derived(isColor ? [field.r, field.g, field.b] : []);
  const colorEnabled = $derived(isColor && machine.link.phase === 'live' && rgbFields.every((f) =>
    isFieldEnabled(f, machine.samples[f.channelId]) && canWrite(f)));
  const colorHex = $derived.by(() => {
    const v = rgbFields.map((f) => Number(displayValue(f, machine.samples[f.channelId])));
    if (!isColor || !v.every(isFinite)) return null;
    return '#' + v.map((x, i) => {
      const f = rgbFields[i];
      return Math.round(Math.max(0, Math.min(255, 255 * (x - f.min) / (f.max - f.min)))).toString(16).padStart(2, '0');
    }).join('');
  });
  function commitColor(hex) {
    if (!colorEnabled) return;
    rgbFields.forEach((f, i) => {
      const v = f.min + (parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255) * (f.max - f.min);
      writeSetting(f, clampField(f, f.type === PACKED.f32 ? v : Math.round(v)));
    });
  }

  // ---- RENDERING §8.2 row 17 (RFC-083): a hub-time moment as wall time ------
  // The wire carries whole hub seconds; the input shows local wall time and
  // converts back on commit. No hub clock (no uptime yet) means no input.
  const isDatetime = $derived(pres === WIDGET.datetime);
  const clockRef = $derived(isDatetime ? hubClockNow() : null);
  const localIso = (ms) => {
    const d = new Date(ms);
    return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  };
  const datetimeLocal = $derived.by(() => {
    const ms = isDatetime && typeof value === 'number' ? hubSecToWallMs(value, clockRef) : null;
    return ms == null ? '' : localIso(ms);
  });
  const stale = $derived(isDatetime ? staleMoment(field.uid, machine.link.bootId, value) : null);
  function commitWall(wallMs) {
    const sec = wallMsToHubSec(wallMs, hubClockNow());
    if (sec == null || !enabled) return;
    armMoment(field.uid, machine.link.bootId, sec, wallMs);
    commitNumber(sec);
  }

  // Stepper long-press: held past HOLD_MS the nudge repeats every REPEAT_MS
  // until release. The click that ends a repeat is swallowed, so a hold never
  // adds one more tick; a plain click or a key press nudges once.
  const HOLD_MS = 450, REPEAT_MS = 110;
  let hold = null, repeated = false;
  function holdStart(dir) {
    holdEnd();
    repeated = false;
    if (!enabled) return;
    hold = setTimeout(function tick() {
      const n = Number(value);
      if (!enabled || (dir > 0 ? n >= field.max : n <= field.min)) return holdEnd();
      repeated = true;
      nudge(dir);
      hold = setTimeout(tick, REPEAT_MS);
    }, HOLD_MS);
  }
  function holdEnd() { clearTimeout(hold); hold = null; }
  function stepClick(dir, e) {
    if (repeated) { repeated = false; return; }
    nudge(dir, e);
  }
  $effect(() => () => holdEnd());

  /** Move one step-sized tick from wherever the value currently sits. */
  // With Shift or Ctrl held one key or notch is one modifier step, whatever dir says.
  function nudge(dir, e) {
    const b = Number(value), base = isFinite(b) ? b : (field.min ?? 0);
    if (e && (e.shiftKey || e.ctrlKey)) dir = Math.sign(dir);
    commitNumber(e && e.ctrlKey ? modSnap(base, e, field.min, field.max, dir, step) : base + dir * modStep(e, step, field.min, field.max));
  }

  const step = $derived(field.step || (precisionFor(field) === 0 ? 1 : 0.01));

  // Reset-to-default writes the catalog's OWN declared default, or the one the
  // user set on this placement (RFC-080 draft item 4, `ownDefault`), as an
  // ordinary intent and waits for the echo, so the machine still decides.
  // Never a client-side guess at what a default should be, never offered
  // when neither published one, and never on a field Page Reset skips (a
  // motion start). A catalog default may be a bool over a u8 (ph-hyu7).
  const hasDefault = $derived(resetsToDefault(field) && !displayOnly);
  const atDefault = $derived(hasDefault && sameValue(value, field.dflt));

  // A control that prints its own value owns the whole row; a chip repeating it
  // is the duplicate-truth the density pass killed. So the chip is a WHITELIST,
  // not an exclusion list — it has to earn the row by carrying something the
  // control cannot: a slider has no numerals, a readout has no control at all,
  // and a bare number input has nowhere to put a unit.
  const showValueChip = $derived(
    pres === WIDGET.slider || pres === WIDGET.readout || pres === WIDGET.bar || pres === WIDGET.graph
    || (pres === WIDGET.stepper && unitOf(field) !== '')
  );

  // ---- the ladder's line (style.css GROUND TRUTH) ---------------------------
  // Where the handle sits, as a fraction of the published range: the track's
  // state and afterglow center on it. Anything without a handle uses its middle.
  const fxF = $derived.by(() => {
    if (pres !== WIDGET.slider && pres !== WIDGET.knob) return 0.5;
    const n = Number(shown);
    if (!isFinite(n) || field.min == null || field.max == null || field.max <= field.min) return 0.5;
    return Math.max(0, Math.min(1, (n - field.min) / (field.max - field.min)));
  });

  // The afterglow: lit by each echo (1 and 2 alternate, so the CSS animation
  // restarts even inside one frame), put out by the next write, and ended by
  // its own animationend, which also ends the word. The decay is style.css's.
  let glow = $state(0);
  $effect(() => {
    if (status !== 'confirmed') glow = 0;
    else if (settled) glow = untrack(() => glow) === 1 ? 2 : 1;
  });
  const glowEnd = (e) => { if (e.target === e.currentTarget && e.animationName.startsWith('fx-glow')) glow = 0; };

  // F3 locate (LookFor.svelte dispatches 'locate' on this root): one clockwise
  // sweep on the ring. Any write state wins at once, as a write puts out the glow.
  let locating = $state(0);
  $effect(() => { if (status !== 'confirmed' || held) locating = 0; });
  function locate() { if (status === 'confirmed' && !held) locating = locating === 1 ? 2 : 1; }

  // The slider is the one writable numeric with no numerals of its own, so its
  // chip carries the typing. A readout must never become typeable (no
  // setting_key at all), and the stepper/text/secret controls already type.
  const typeableChip = $derived(showValueChip && pres === WIDGET.slider && !field.options);

  // Size the box from the field's OWN published bounds, so a 0..1 budget knob
  // does not reserve room for six digits. Falls back wide, never narrow: a
  // clipped numeral is a misread setting.
  const chipChars = $derived.by(() => {
    const p = precisionFor(field);
    const widest = Math.max(Math.abs(field.min ?? 0), Math.abs(field.max ?? 9999));
    return String(Math.round(widest)).length + (p > 0 ? p + 1 : 0) + ((field.min ?? 0) < 0 ? 1 : 0) + 1;
  });

  // Readout archetype (OG "Power card" bar recipe): a read-only numeric with
  // published bounds gets a thin proportional bar under the value, same as
  // every bounded live measurement in the OG right-hand instrument column.
  // A readout with no bounds (a status string, an unbounded counter) gets no
  // bar — there is no range to show it against.
  const hasBounds = $derived(
    (pres === WIDGET.readout || pres === WIDGET.bar) && field.min != null && field.max != null && field.max > field.min
  );
  const boundedFrac = $derived.by(() => {
    if (!hasBounds) return 0;
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(1, (n - field.min) / (field.max - field.min)));
  });

  // RENDERING §5.4: a peak companion (settings.js) is a marker on this live
  // readout, always tagged as a peak, never shown as the live value.
  const peakValue = $derived(field.peak
    ? reportedValue(field.peak, machine.samples[field.peak.channelId]) : undefined);
  const peakFrac = $derived.by(() => {
    const n = Number(peakValue);
    if (!hasBounds || peakValue == null || !isFinite(n)) return null;
    return Math.max(0, Math.min(1, (n - field.min) / (field.max - field.min)));
  });

  // ---- the status slot: one fixed home for every transient (laws 3, 5) -------
  // The ladder in words, then a ground-truth mark, then the gate. One line in
  // the head row, clipped, so no state can change the field's height; the
  // full text rides in the title.
  const slot = $derived(
    held ? { kind: 'pending', text: 'sends on release' }
    : status === 'fault' ? { kind: 'fault', text: faultWhy || 'refused' }
    : status === 'pending' ? { kind: 'pending', text: 'waiting for the machine' }
    : status === 'overdue' ? { kind: 'overdue', text: 'still waiting for the machine' }
    : outOfRange ? { kind: 'range', text: 'out of range ('
        + formatWithUnit(field, field.min) + ' to ' + formatWithUnit(field, field.max) + ')' }
    : reason ? { kind: 'gate', text: reason }
    : glow ? (virtual ? { kind: 'virtual', text: 'virtual' } : { kind: 'confirmed', text: 'confirmed' })
    : { kind: '', text: '' }
  );

  // ---- secret: the typed value leaves the input once its write lands ---------
  // Confirmed or refused, the input empties and its placeholder says what the
  // machine reports (RFC-009.4, ph-buvu). Typing after the send keeps the input.
  let secretEl = $state(null);
  let secretSent = false;
  $effect(() => {
    const landed = status === 'fault' || settled;
    if (!landed || !secretSent || !secretEl) return;
    secretSent = false;
    secretEl.value = '';
  });

  // ---- numeral: fixed-width columns, the hero numerals' recipe --------------
  // The integer part is zero-padded to the widest bound's digits (a grouped or
  // unbounded value is not), and the digit box never narrows below the widest
  // text it has shown, so a changing value never jiggles. No value stays '--'.
  let numeralW = 0;
  const numeral = $derived.by(() => {
    if (pres !== WIDGET.numeral || field.options) return null;
    const [t, u] = formatParts(field, value);
    const m = /^(-?)(\d+)(\.\d+)?$/.exec(t);
    const widest = Math.max(Math.abs(field.min ?? 0), Math.abs(field.max ?? 0));
    const digits = widest >= 1 && widest < 1e4 ? Math.floor(Math.log10(widest)) + 1 : 0;
    const text = m && digits ? m[1] + m[2].padStart(Math.max(digits - (m[1] ? 1 : 0), 1), '0') + (m[3] || '') : t;
    numeralW = Math.max(numeralW, text.length);
    return { text, unit: u, ch: numeralW };
  });

  // ---- segmented: one tab stop, at the reported option (else the first) ------
  let segFocus = $state(0);
  $effect(() => { const n = Number(value); segFocus = Number.isInteger(n) && field.options && n >= 0 && n < field.options.length ? n : 0; });
  function segKey(e) {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const n = field.options.length;
    const to = d ? (segFocus + d + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    segFocus = to;
    e.currentTarget.querySelectorAll('[role=radio]')[to].focus();
  }

  // ---- knob: a bounded numeric as a rotary control ---------------------------
  // 270 degrees of sweep; a vertical drag of KNOB_DRAG_PX covers the full
  // range, a tenth of that with Shift held (fine); Ctrl snaps to the decade. Every change snaps to the step and
  // is an ordinary echo-confirmed write through commitNumber().
  let knobEl = $state(null);
  const KNOB_DRAG_PX = 320;
  const KNOB_CIRC = 2 * Math.PI * 40;
  const KNOB_ARC = 0.75 * KNOB_CIRC;
  const knobFrac = $derived.by(() => {
    const n = Number(shown);
    if (!isFinite(n) || field.min == null || field.max == null || field.max <= field.min) return 0;
    return Math.max(0, Math.min(1, (n - field.min) / (field.max - field.min)));
  });
  const snap = (n) => field.min + Math.round((n - field.min) / step) * step;
  // A page is a tenth of the range, never less than ten steps.
  const pageSteps = $derived(Math.max(10, Math.round((field.max - field.min) / 10 / step)));
  let knobDrag = null;
  function knobDown(e) {
    if (!enabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const n = Number(value);
    knobDrag = { y: e.clientY, v: isFinite(n) ? n : field.min, last: n };
    dragStart(e);
  }
  function knobMove(e) {
    if (!knobDrag) return;
    const span = (field.max - field.min) * dragGain(e, 1);
    knobDrag.v = Math.max(field.min, Math.min(field.max, knobDrag.v + ((knobDrag.y - e.clientY) / KNOB_DRAG_PX) * span));
    knobDrag.y = e.clientY;
    const n = modSnap(snap(knobDrag.v), e, field.min, field.max, 0, step);
    if (n !== knobDrag.last) { knobDrag.last = n; dragWrite('v', n); }
  }
  function knobKey(e) {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: pageSteps, PageDown: -pageSteps }[e.key];
    if (dir) { e.preventDefault(); nudge(dir, e); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); commitNumber(e.key === 'Home' ? field.min : field.max); }
  }
  // The wheel turns the knob only while it holds focus (a click or Tab gives
  // it), so scrolling a page past a knob never writes to the machine. A notch
  // is a page/10 of the range, one step with Shift. Non-passive, to keep the
  // page from scrolling under a focused knob.
  $effect(() => {
    const el = knobEl;
    if (pres !== WIDGET.knob || !el) return;
    const onWheel = (e) => {
      if (!enabled || document.activeElement !== el) return;
      const d = e.deltaY || e.deltaX;
      if (!d) return;
      e.preventDefault();
      nudge((d < 0 ? 1 : -1) * (e.shiftKey ? 1 : Math.max(1, Math.round(pageSteps / 10))), e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---- graph: reported values only, held as steps, broken where the link was
  // stale (laws 8, 9). STATE is pushed on change, so a quiet channel is a held
  // value, drawn on to now; only link silence is missing data, drawn as a gap.
  // The ring is plain state the template never reads (T23).
  const GRAPH_MS = 30000;
  const ring = [];
  let graphStale = false;
  let graphD = $state('');
  $effect(() => {
    if (pres !== WIDGET.graph) return;
    const t = machine.sampleTs[field.channelId];
    const v = Number(reportedValue(field, sample));
    const stale = !!(fresh && fresh.stale);
    untrack(() => {
      const last = ring[ring.length - 1];
      graphStale = stale;
      if (stale) { if (last && last.v != null) ring.push({ t: Date.now(), v: null }); }
      else if (t && isFinite(v) && (!last || t > last.t)) ring.push({ t, v });
      redrawGraph();
    });
  });
  // Time moves while values hold: redraw on a clock, not only on a sample.
  $effect(() => {
    if (pres !== WIDGET.graph) return;
    const id = setInterval(redrawGraph, 250);
    return () => clearInterval(id);
  });
  function redrawGraph() {
    while (ring.length && ring[0].t < Date.now() - GRAPH_MS && ring[1] && ring[1].t < Date.now() - GRAPH_MS) ring.shift();
    graphD = graphPath(ring);
  }
  function graphPath(pts) {
    const vals = pts.filter((p) => p.v != null).map((p) => p.v);
    if (!vals.length) return '';
    let lo = field.min, hi = field.max;
    if (lo == null || hi == null || hi <= lo) {
      lo = Math.min(...vals); hi = Math.max(...vals);
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    }
    const now = Date.now();
    const x = (t) => Math.max(0, 100 - ((now - t) / GRAPH_MS) * 100).toFixed(2);
    const y = (v) => (38 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 36).toFixed(2);
    let d = '', open = false;
    for (const p of pts) {
      if (p.v == null) { if (open) d += ' H' + x(p.t); open = false; continue; }
      d += open ? ' H' + x(p.t) + ' V' + y(p.v) : ' M' + x(p.t) + ' ' + y(p.v);
      open = true;
    }
    if (open && !graphStale) d += ' H100';
    return d.trim();
  }
</script>

<!-- One value formatter (format.js formatParts): hub time, autorange, plain. -->
{#snippet vu(f, v)}{@const p = formatParts(f, v)}{p[0]}<span class="unit">{p[1]}</span>{/snippet}

<div class="field" data-uid={field.uid} data-shadow={held ? 'pending' : status} data-defer={held ? '' : undefined}
     data-widget={pres} data-orient={orientation}
     data-glow={glow || undefined} data-virtual={virtual || undefined} onanimationend={glowEnd} onlocate={locate}
     style="--fx-f: {fxF}"
     class:disabled={!enabled && !field.readOnly}
     class:readonly={field.readOnly || displayOnly}
     class:stale={!!(fresh && fresh.stale)}>

  <div class="field-head">
    <span class="field-label-group">
      <label class="field-label" id={labelId} for={LABELABLE.has(pres) ? domId : undefined} data-uid={field.uid}>
        <span class="field-label-text" title={labelFor(field)}>{labelFor(field)}</span>
        {#if field.advanced}<span class="tag adv" title="Advanced setting">adv</span>{/if}
        {#if field.flagBits.restart_required}<span class="tag warn" title="Takes effect after restart">restart</span>{/if}
      </label>
      {#if field.desc}
        <!-- Hover reveals the description; the click toggle stays because
             touch has no hover and :focus-visible covers the keyboard. The
             tip is a SIBLING of the button, not a child — inside it, its text
             would join the button's accessible name. -->
        <span class="info-wrap">
          <button type="button" class="info" aria-expanded={descOpen} aria-controls={descId}
                  onclick={() => (descOpen = !descOpen)}>
            <span class="glyph" aria-hidden="true">i</span>
            <span class="sr-only">{descOpen ? 'Hide' : 'Show'} description</span>
          </button>
          <span class="tip" id={descId} role="tooltip">{field.desc}</span>
        </span>
      {/if}
      {#if hasDefault}
        <button type="button" class="info reset" disabled={!enabled || atDefault}
                title={(atDefault ? 'At ' : 'Reset to ') + (field.ownDefault ? 'control default' : 'machine default')
                       + (atDefault ? '' : ' (' + formatWithUnit(field, field.dflt) + ')')}
                onclick={() => commit(field.dflt)}>
          <span class="glyph" aria-hidden="true">&#8635;</span>
          <span class="sr-only">Reset {labelFor(field)} to default</span>
        </button>
      {/if}
    </span>
    <span class="ladder" class:out-of-range={slot.kind === 'range'} data-slot={slot.kind}
          role="status" title={slot.text || undefined}>{slot.text}</span>
    {#if typeableChip}
      <!-- A slider publishes no numerals of its own, so this chip is the only
           place an exact value can be entered. Editable values must LOOK
           editable, so it wears the same recess as the chip it replaces rather
           than hiding as a click-to-reveal. Commits on change, never on input:
           writing a setting per keystroke would spray the machine. -->
      <span class="field-value typeable" class:disabled={!enabled} class:held={!!held}>
        <input type="number" class="chip-num"
               min={field.min} max={field.max} step={step}
               value={inputNum(shown)} disabled={!enabled}
               data-chars={chipChars} style="--w: {chipChars}ch"
               aria-label={'exact value for ' + labelFor(field)}
               onchange={(e) => commitTyped(e.currentTarget)} />
        <span class="unit">{unitOf(field)}</span>
      </span>
    {:else if isRange}
      <output class="field-value" class:held={!!held}>
        {formatWithUnit(field.lo, shownLo)} &ndash; {formatWithUnit(field.hi, shownHi)}
      </output>
    {:else if showValueChip}
      <output class="field-value" class:readout={READ_ONLY_PRESENTATIONS.has(pres)} for={domId}
              class:stale={fresh && fresh.stale} title={staleReason(fresh)}>
        {#if field.options}
          {optionLabel(field, value)}
        {:else}
          {@render vu(field, value)}
          {#if field.peak}<span class="peak-tag">{statTag(field.peak)} {formatWithUnit(field.peak, peakValue)}</span>{/if}
        {/if}
      </output>
    {/if}
  </div>

  {#if pres === WIDGET.readout}
    <!-- No control at all. A field with no setting_key is effective truth and
         must never render as something you can push. -->
    {#if hasBounds}
      <div class="readout-bar" aria-hidden="true">
        <div class="readout-bar-fill" style="width: {boundedFrac * 100}%"></div>
        {#if peakFrac != null}<div class="readout-bar-peak" style="left: {peakFrac * 100}%"></div>{/if}
      </div>
    {/if}

  {:else if pres === WIDGET.indicator}
    <!-- §8.4 indicator: a status lamp is NEVER the sole carrier of the fact,
         so every lamp is paired with its state in words (§13). Read-only by
         construction — this branch draws no control at all. -->
    <div class="lamps" id={domId} role="group" aria-labelledby={labelId}>
      {#if field.bits}
        {#each field.bits as bitName, b}
          {#if bitName}
            <span class="lamp" class:lit={((value | 0) & (1 << b)) !== 0}>
              <i aria-hidden="true"></i>{bitName}
            </span>
          {/if}
        {/each}
      {:else}
        <span class="lamp" class:lit={!!value}>
          <i aria-hidden="true"></i>{field.options ? optionLabel(field, value) : (value ? 'on' : 'off')}
        </span>
      {/if}
    </div>

  {:else if pres === WIDGET.toggle}
    <div class="toggle-row">
      <label class="og-switch" class:is-disabled={!enabled}>
        <input type="checkbox" id={domId}
               role="switch" aria-checked={toggleOn} checked={toggleOn} disabled={!enabled}
               onchange={(e) => commitToggle(e.currentTarget)} />
        <span class="track"></span>
      </label>
      <span class="toggle-text">{field.options ? optionLabel(field, value)
        : tog ? formatWithUnit(field, value) : (value ? 'on' : 'off')}</span>
    </div>

  {:else if pres === WIDGET.segmented}
    <!-- Every option is a real value, index 0 included (RFC-064: only an op
         select's index 0 is filler, and those are ActionField's). Roving
         focus: Tab enters at the reported option, the arrows move focus,
         Space or Enter writes, so arrowing past options sends nothing. -->
    <div class="og-seg" role="radiogroup" aria-labelledby={labelId} id={domId} onkeydown={segKey}>
      {#each field.options as opt, i}
        <button type="button" role="radio" aria-checked={Number(value) === i}
                tabindex={i === segFocus ? 0 : -1}
                class:active={Number(value) === i} disabled={!enabled}
                onclick={() => commit(i)}>{opt || i}</button>
      {/each}
    </div>

  {:else if pres === WIDGET.select}
    <!-- The value is set on the select, never as option `selected`: once the
         operator has picked, the selected attribute no longer moves the
         selection, and the control would keep the pick after a refusal. -->
    <select id={domId} disabled={!enabled} value={Number(value)}
            onchange={(e) => commit(Number(e.currentTarget.value))}>
      {#each field.options as opt, i}
        <option value={i}>{opt || i}</option>
      {/each}
    </select>

  {:else if pres === WIDGET.bitfield}
    <div class="bitfield" id={domId} role="group" aria-labelledby={labelId}>
      {#each field.bits as bitName, b}
        {#if bitName}
          <label class="bit">
            <input type="checkbox" disabled={!enabled}
                   checked={((value | 0) & (1 << b)) !== 0}
                   onchange={(e) => commit(e.currentTarget.checked
                     ? ((value | 0) | (1 << b))
                     : ((value | 0) & ~(1 << b)))} />
            <span>{bitName}</span>
          </label>
        {/if}
      {/each}
    </div>

  {:else if pres === WIDGET.slider}
    <input id={domId} type="range"
           min={field.min} max={field.max} step={step}
           value={shown ?? field.min} disabled={!enabled} onpointerdown={(e) => relDown(e, 'v')} onpointermove={relMove} onmousedown={relGuard} onkeydown={(e) => sliderKey(e, 'v')}
           oninput={(e) => dragWrite('v', Number(e.currentTarget.value))} />
    <!-- No printed min…max caption (OG density doctrine — the slider's own
         extent plus the value chip already carry the bounds; a bounds line
         under every slider is exactly the "flat wall of gray text" the OG
         never had). -->

  {:else if pres === WIDGET.range}
    <!-- RENDERING §11: one dual-thumb control over the merged min/max pair.
         Two overlapping range inputs, transparent tracks, pointer-events
         live on the thumb only (style.css's pseudo-elements) so either thumb
         is grabbable without the other's invisible track stealing the hit.
         Both keep the global 40px touch box (T24: --range-hit). -->
    <div class="range-dual">
      <div class="range-track" aria-hidden="true"></div>
      <div class="range-fill" aria-hidden="true"
           style="left: {loFrac * 100}%; right: {(1 - hiFrac) * 100}%"></div>
      <input type="range" class="range-lo" class:on-top={loFrac >= hiFrac}
             min={field.lo.min} max={field.lo.max} step={rangeStep(field.lo)}
             value={shownLo ?? field.lo.min} disabled={!loEnabled} onpointerdown={(e) => relDown(e, 'lo')} onpointermove={relMove} onmousedown={relGuard} onkeydown={(e) => sliderKey(e, 'lo')}
             aria-label={'minimum ' + field.label}
             oninput={(e) => dragWrite('lo', Number(e.currentTarget.value))} />
      <input type="range" class="range-hi"
             min={field.hi.min} max={field.hi.max} step={rangeStep(field.hi)}
             value={shownHi ?? field.hi.max} disabled={!hiEnabled} onpointerdown={(e) => relDown(e, 'hi')} onpointermove={relMove} onmousedown={relGuard} onkeydown={(e) => sliderKey(e, 'hi')}
             aria-label={'maximum ' + field.label}
             oninput={(e) => dragWrite('hi', Number(e.currentTarget.value))} />
    </div>

  {:else if pres === WIDGET.color}
    <div class="color-row">
      <!-- A native color input always holds some color; with no reported
           value it is disabled and blanked, never a black the wire never sent. -->
      <input id={domId} type="color" value={colorHex || '#000000'} disabled={!colorEnabled || !colorHex}
             class:unknown={!colorHex}
             onchange={(e) => commitColor(e.currentTarget.value)} />
      <output class="field-value mono">{colorHex || '--'}</output>
    </div>

  {:else if pres === WIDGET.datetime}
    <input id={domId} type="datetime-local" step="1" class="value-input"
           value={datetimeLocal} disabled={!enabled || !clockRef}
           onchange={(e) => commitWall(new Date(e.currentTarget.value).getTime())} />
    {#if !clockRef}
      <p class="field-reason">hub clock unknown: no uptime reported</p>
    {:else if stale}
      <p class="field-reason" role="status">stale: set before the hub restarted
        <button type="button" class="og-btn" disabled={!enabled} onclick={() => commitWall(stale.wallMs)}>Re-arm</button></p>
    {/if}

  {:else if pres === WIDGET.stepper}
    <!-- §8.4 stepper: typeable, and increments in step-sized ticks. The typing
         half is the native input; the increment half CANNOT be, because the
         global sheet strips native spinners on purpose. Hence the flanking
         nudges — without them this archetype is just a text box. -->
    <div class="stepper">
      <button type="button" disabled={!enabled} aria-label="decrease {labelFor(field)}"
              onclick={(e) => stepClick(-1, e)} onpointerdown={() => holdStart(-1)} onpointerup={holdEnd}
              onpointerleave={holdEnd} onpointercancel={holdEnd} oncontextmenu={(e) => e.preventDefault()}>&minus;</button>
      <input id={domId} type="number" class="og-num"
             min={field.min} max={field.max} step={step}
             value={inputNum(value)} disabled={!enabled}
             onchange={(e) => commitTyped(e.currentTarget)} />
      <button type="button" disabled={!enabled} aria-label="increase {labelFor(field)}"
              onclick={(e) => stepClick(1, e)} onpointerdown={() => holdStart(1)} onpointerup={holdEnd}
              onpointerleave={holdEnd} onpointercancel={holdEnd} oncontextmenu={(e) => e.preventDefault()}>+</button>
    </div>

  {:else if pres === WIDGET.text}
    <input id={domId} type="text" class="value-input"
           value={value ?? ''} disabled={!enabled}
           onchange={(e) => commit(e.currentTarget.value)} />

  {:else if pres === WIDGET.secret}
    <!-- RFC-009.4: a secret's value NEVER appears in STATE. We can say whether
         one is set, and we can replace it. We can never show it. -->
    <input id={domId} type="password" class="value-input" placeholder={value ? '•••••• (set)' : 'not set'}
           autocomplete="new-password" bind:this={secretEl} disabled={!enabled}
           oninput={() => (secretSent = false)}
           onchange={(e) => { secretSent = enabled; commit(e.currentTarget.value); }} />

  {:else if pres === WIDGET.knob}
    <!-- Drag up or down, or use the keys; every change is an ordinary
         echo-confirmed write through commitNumber(). -->
    <div class="knob" id={domId} bind:this={knobEl} role="slider" style="--kl: {KNOB_ARC * knobFrac}" tabindex={enabled ? 0 : -1}
         aria-labelledby={labelId} aria-valuemin={field.min} aria-valuemax={field.max}
         aria-valuenow={Number(shown)} aria-valuetext={formatWithUnit(field, shown)} aria-disabled={!enabled}
         class:is-disabled={!enabled}
         onpointerdown={knobDown} onpointermove={knobMove}
         onkeydown={knobKey}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="knob-track" cx="50" cy="50" r="40"
                stroke-dasharray="{KNOB_ARC} {KNOB_CIRC}" transform="rotate(135 50 50)" />
        <circle class="knob-glow" cx="50" cy="50" r="40"
                stroke-dasharray="{KNOB_ARC * knobFrac} {KNOB_CIRC}" transform="rotate(135 50 50)" />
        <circle class="knob-fill" cx="50" cy="50" r="40"
                stroke-dasharray="{KNOB_ARC * knobFrac} {KNOB_CIRC}" transform="rotate(135 50 50)" />
        <circle class="knob-run" cx="50" cy="50" r="40" transform="rotate(135 50 50)" />
        <line class="knob-hand" x1="50" y1="50" x2="50" y2="18"
              transform="rotate({-135 + 270 * knobFrac} 50 50)" />
      </svg>
      <span class="knob-val" class:held={!!held}>{@render vu(field, shown)}</span>
    </div>

  {:else if pres === WIDGET.bar}
    <div class="meter" aria-hidden="true">
      <div class="meter-fill" style="--f: {boundedFrac}"></div>
      {#if peakFrac != null}<div class="meter-peak" style="--f: {peakFrac}"></div>{/if}
    </div>

  {:else if pres === WIDGET.numeral}
    <output class="numeral" id={domId} title={staleReason(fresh)}>
      {#if numeral}<span class="numeral-digits" style="min-width: {numeral.ch}ch">{numeral.text}</span><span class="unit">{numeral.unit}</span>
      {:else}{optionLabel(field, value)}<span class="unit">{unitOf(field)}</span>{/if}
      {#if field.peak}<span class="peak-tag">{statTag(field.peak)} {formatWithUnit(field.peak, peakValue)}</span>{/if}
    </output>

  {:else if pres === WIDGET.graph}
    <svg class="graph" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={graphD} />
    </svg>
  {/if}

  {#if field.desc}<p class="field-desc" id={descId + '-inline'}>{field.desc}</p>{/if}
  {#if locating}
    {#key locating}
      <svg class="locate" aria-hidden="true" onanimationend={(e) => { if (e.target === e.currentTarget) locating = 0; }}>
        <rect class="loc-base" pathLength="100" />
        <rect class="loc-arc a" pathLength="100" />
        <rect class="loc-arc b" pathLength="100" />
        <rect class="loc-arc c" pathLength="100" />
      </svg>
    {/key}
  {/if}
</div>

<style>
  /* Layout only below — track/thumb/chevron chrome for input[type=range] and
     select, plus .og-seg/.og-switch/.og-num visuals, are owned globally
     (style.css) so every instrument control reads identically. This block
     places things and dresses the parts the global sheet does not own:
     the ground-truth value readout, free-text/secret inputs, labels, tags,
     bitfield rows and the toggle's paired text. */

  /* OG .fld cadence: label/chip/slider read as ONE instrument row — tightened
     from .5rem so the control sits close under its head instead of floating
     in its own paragraph-sized band. */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    container-type: inline-size;
  }

  /* Label, status words, value chip. The chip takes its width and the words
     theirs from what is left; the label yields to them down to its 3em. Where
     that no longer fits, the compact rung below takes over (law 5, ph-4j5f).
     One line each, so no state wraps the head. */
  .field-head {
    display: grid;
    grid-template-columns: minmax(min-content, 1fr) minmax(auto, max-content) auto;
    align-items: baseline;
    gap: var(--sp-3);
  }
  .field-head > .field-value { white-space: nowrap; }
  /* No chip: the words end at the field's edge. */
  .field-head > :where(.ladder:last-child) { grid-column: 2 / -1; }

  /* The label with its tags and its info and reset buttons: the head's first column. */
  .field-label-group {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: min-content;
  }
  /* One line that keeps 3em of its text whatever the status slot holds: the
     text shortens first, then a tag that does not fit wraps onto a second line
     this one-line box hides, so tags drop whole (ph-4j5f). The line height is
     pinned so the box is one line without the lh unit. */
  .field-label { overflow: hidden; flex-wrap: wrap; align-content: flex-start; line-height: 1.45; height: 1.45em; }
  .field-label-text { flex: 1 1 0; min-width: 3em; }

  /* Slider row tightened to the OG's compact cadence (.fld2 input[type=range]
     margin, verified against og-ref/style.css) instead of the global 12px 0 —
     part of reading as one instrument row with its label/chip. */
  .field input[type='range'] {
    margin: var(--sp-3) 0 var(--sp-1);
  }
  /* The thumb overhangs the 2 px track by half its height: the hint below clears it. */
  .field input[type='range']:has(+ .field-desc) { margin-bottom: var(--sp-3); }

  /* RENDERING §11 dual-thumb range: two overlapping input[type=range], each
     stripped to a transparent hit-only layer (pointer-events live on the
     thumb pseudo-element alone) over one shared visual track/fill pair. The
     wrapper's own height reproduces the plain slider's box exactly
     (2px track + the same touch padding, style.css's --range-hit) so a range
     field takes no more vertical room than a single slider did. */
  .range-dual {
    position: relative;
    height: calc(2px + 2 * var(--range-hit));
    margin: var(--sp-3) 0 var(--sp-1);
  }
  .range-dual input[type='range'] {
    position: absolute;
    inset: 0;
    margin: 0;
    background: transparent;
    pointer-events: none;
  }
  .range-dual input[type='range']::-webkit-slider-thumb { pointer-events: auto; }
  .range-dual input[type='range']::-moz-range-thumb { pointer-events: auto; }
  /* Equal z-index by default; the low thumb lifts above the high one only
     once they meet, so it stays reachable instead of being permanently
     buried under the thumb it just caught up to. */
  .range-dual .range-lo { z-index: 2; }
  .range-dual .range-hi { z-index: 2; }
  .range-dual .range-lo.on-top { z-index: 3; }
  .range-track, .range-fill {
    position: absolute;
    top: 50%;
    height: 2px;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .range-track { left: 0; right: 0; background: var(--line-2); }
  .range-fill { background: var(--reality); box-shadow: 0 0 6px rgba(var(--reality-rgb), .35); }

  /* The label voice (.field-label, .field-label-text) and the value chip's
     base (.field-value, its .unit) are style.css's: the plugin kit wears them too. */

  .tag {
    display: inline-block;
    flex: none;
    margin-left: var(--sp-2);
    padding: 1px var(--sp-2);
    font-size: .62rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .04em;
    border-radius: var(--r-s);
    vertical-align: middle;
  }
  .tag.adv {
    color: var(--tx-mut);
    background: var(--bg-sunken);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .tag.warn {
    color: var(--warn-ink);
    background: rgba(var(--warn-rgb), .12);
    box-shadow: inset 0 0 0 1px rgba(var(--warn-rgb), .4);
  }

  /* ⓘ description affordance — the OG .info box at its .label-row in-field
     size (18px), since this button rides beside a field label rather than a
     card-head. The glyph is a letter in the instrument typeface, not a drawn
     icon. The border-brightens-on-hover idiom is the one every other outlined
     icon button in this sheet already uses (.og-btn:hover, .og-seg button:hover). */
  /* The button only has a job in TERSE mode. Verbose already prints the
     description inline under the control, so an affordance whose whole
     purpose is revealing text that is already on screen is noise. */
  .info-wrap {
    position: relative;
    display: none;
    flex: 0 0 auto;
  }
  :global(html.terse) .info-wrap {
    display: inline-flex;
  }

  .info {
    position: relative;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    display: inline-grid;
    /* MUST stay 0. The UA gives a button `padding: 1px 6px`, and under
       border-box that leaves this 18px control a 4px-wide content box — too
       narrow for the glyph, so `place-items: center` cannot center an item
       wider than its own track and pins it to the content edge instead.
       Measured result: the glyph sat 3.5px right of the button's center. */
    padding: 0;
    place-items: center;
    border-radius: var(--r-s);
    border: 1px solid var(--line-2);
    background: transparent;
    color: var(--tx-mut);
    line-height: 1;
    cursor: pointer;
    transition: border-color var(--t-quick), color var(--t-quick);
  }
  .info:hover {
    border-color: var(--line-4);
    color: var(--tx);
  }
  .info[aria-expanded='true'] {
    border-color: var(--reality);
    color: var(--reality);
  }

  /* The reset affordance shares the ⓘ box so the two never disagree about
     size or alignment, but it is NOT terse-gated: a default is a value the
     operator may want back at any density. Disabled while the field already
     sits at its default, which is also how the control says so. */
  .reset { display: inline-grid; }
  .reset:disabled {
    opacity: .35;
    cursor: default;
    border-color: var(--line-1);
  }

  /* A lowercase Martian Mono `i` — the typeface this UI already uses for
     values and readouts, so the mark reads as instrument, not as prose. At
     11px/line-height 1 the ink lands centered in the box on its own; no
     optical nudge is applied. Re-check that if the size or family changes,
     because the grid centers the LINE BOX, not the ink inside it. */
  .info .glyph {
    display: block;
    font-family: var(--mono);
    font-weight: 400;
    font-size: 11px;
    line-height: 1;
  }

  /* Floating description. OG .tip recipe, re-sourced to this palette: the OG
     set `background: var(--ink)` when --ink was the page color, but here
     --ink IS the text color (style.css names the collision), so a raised
     surface + the nested-frame outline carries it instead. */
  .tip {
    position: absolute;
    left: 0;
    top: calc(100% + 6px);
    z-index: 30;
    width: max-content;
    max-width: 240px;
    padding: var(--sp-3) var(--sp-3);
    background: var(--bg-card);
    border: 1px solid var(--line-1);
    outline: 1px solid var(--line-0);
    outline-offset: 2px;
    border-radius: var(--r-s);
    font-size: .72rem;
    line-height: 1.5;
    color: var(--tx);
    text-align: left;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: opacity var(--t-quick), transform var(--t-quick), visibility var(--t-quick);
    pointer-events: none;
  }
  :global(html.terse) .info-wrap:hover .tip,
  :global(html.terse) .info:focus-visible ~ .tip,
  :global(html.terse) .info[aria-expanded='true'] ~ .tip {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  /* Terse is the switch between the two ways a description can reach the
     operator, and only ONE is ever live: verbose prints it inline under the
     field, terse holds it back until hover/focus. Never both — that is the
     duplicate truth the density pass exists to prevent. */
  .field-desc {
    font-size: .72rem;
    color: var(--tx-mut);
  }
  :global(html.terse) .field-desc {
    display: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* The value chip. A read value is bare digits; only a typeable chip wears
     the recess, so editable looks editable and read-only does not (ph-5y6).
     The transparent border keeps both the same height. */

  /* Read-only bounded numeric (readout archetype) — the OG "Power card"
     instrument voice: the value glows reality-blue like a live measurement
     instead of sitting quiet like a settings chip. */
  .field-value.readout {
    color: var(--reality);
    text-shadow: 0 0 8px rgba(var(--reality-rgb), .35);
  }
  /* Stale (law 8): the HeroNumerals stale voice; the title carries the age. */
  .field-value.stale {
    color: var(--tx-ghost);
    text-shadow: none;
  }

  /* Typeable chip (slider archetype): the recess (OG .num, inset 0 2px 5px);
     the input inside carries no chrome of its own. Two rules it MUST win against:
     the full-width control rule further down, which is written for controls
     that own their whole row, and the design system's deliberate removal of
     native spinners (style.css: nudge/trim buttons cover the increment
     use-case) — a chip that grew spinners would break that on this one
     control. Width is set inline from the field's published bounds. */
  .field-value.typeable {
    padding: 0 var(--sp-2) 0 var(--sp-2);
    background: var(--screen);
    box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6);
    border-color: var(--line-1);
  }
  .field-value .chip-num {
    display: inline-block;
    appearance: textfield;
    min-width: 0;
    padding: 1px 0;
    border: 0;
    background: none;
    box-shadow: none;
    color: var(--tx-val);
    font-family: var(--mono);
    font-variation-settings: 'wdth' 90;
    font-weight: var(--num-wght);
    font-size: .76rem;
    text-align: right;
  }
  /* mm/s and mm/s² take the same room, so a card's chips share one left edge. */
  .field-value.typeable .unit:not(:empty) { min-width: 5ch; }
  /* Beats the full-width control rule; the card's widest chip sets the width. */
  .field .field-value input.chip-num { width: max(var(--chip-w, 0ch), var(--w)); }
  /* Touch: the 18px info/reset box keeps its look and gains an invisible
     40px hit area; the typeable chip grows to the fingertip floor. */
  @media (pointer: coarse) {
    /* The button box is the 40 px hit target and its negative margin keeps
       the 18 px footprint in the head row; the visible square is ::before. */
    .info { width: 40px; height: 40px; margin: -11px 0; border: 0; }
    .info::before { content: ''; position: absolute; inset: 11px; border: 1px solid var(--line-2); border-radius: var(--r-s); }
    .info:hover::before { border-color: var(--line-4); }
    .info[aria-expanded='true']::before { border-color: var(--reality); }
    .reset:disabled::before { border-color: var(--line-1); }
    .bitfield .bit { min-height: 40px; }
    .field-value .chip-num { padding: 10px 0; min-width: 40px; }
  }
  .field-value .chip-num::-webkit-inner-spin-button,
  .field-value .chip-num::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .field-value .chip-num:focus-visible {
    outline: 1px solid var(--highlight);
    outline-offset: 1px;
  }
  .field-value.typeable.disabled {
    opacity: .45;
  }

  /* Thin proportional bar under a bounded readout — OG Power-card meter
     recipe (core/meter.js's .mtr-track/.mtr-fill), simplified to the plain
     no-hazard case: this is a generic reading, not a bus-voltage instrument. */
  .readout-bar {
    height: 2px;
    margin-top: var(--sp-1);
    background: var(--line-2);
    border-radius: 1px;
    overflow: hidden;
  }
  .readout-bar-fill {
    height: 100%;
    width: 0%;
    background: var(--reality);
    box-shadow: 0 0 6px rgba(var(--reality-rgb), .4);
    transition: width var(--t-slow) cubic-bezier(.3, .7, .3, 1);
  }
  .readout-bar { position: relative; }
  .readout-bar-peak {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--ink);
  }
  .peak-tag {
    margin-left: var(--sp-2);
    font-size: 11px;
    color: var(--ink-dim);
  }

  /* .value-input (free text, secrets) is style.css's: the plugin kit wears it too. */

  /* Layout-only: full-width controls, chrome untouched. */
  .field :is(input[type='range'], input[type='number'], input[type='text'],
              input[type='password'], select, .og-num, .value-input) {
    width: 100%;
    display: block;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .toggle-text {
    font-family: var(--mono);
    font-size: .85rem;
    color: var(--tx-val);
  }
  /* Fallback dimming in case the global .og-switch does not itself gate on
     the checkbox's disabled state; harmless if it already does. */
  .og-switch.is-disabled {
    opacity: .45;
    cursor: not-allowed;
  }

  /* The stepper (.stepper and its nudges) is style.css's: the plugin kit wears it too. */

  /* Status lamps (indicator archetype). Same wrap cadence as .bitfield so a
     read-only status byte and a writable one read as the same kind of thing;
     the lamp is a dot rather than a checkbox because nothing here is pushable.
     The lit dot borrows the Power-card instrument glow — a lamp is a live
     measurement, not a settings chip. */
  .lamps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-4);
  }
  .lamp {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: .78rem;
    color: var(--tx-mut);
  }
  .lamp i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--line-2);
    box-shadow: inset 0 1px 2px rgba(var(--shade-rgb), .6);
  }
  .lamp.lit {
    color: var(--tx-val);
  }
  .lamp.lit i {
    background: var(--reality);
    box-shadow: 0 0 6px rgba(var(--reality-rgb), .55);
  }

  .bitfield {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3) var(--sp-5);
  }
  .bitfield .bit {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: .85rem;
    color: var(--tx);
  }
  .bitfield input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: var(--reality);
  }

  /* Density rungs (DESIGN §10.12): compact under 24rem (about 11 cells), normal
     above, where label, ⓘ, reset, a tag, a chip with its unit and the longest
     words fit one row at every UI scale. Compact is a fixed two-row head in
     every state: the label with its tags and info/reset and the value chip,
     then the status words on a line of their own, whole at every width (law 5,
     ph-4j5f). Under 13rem the chip takes a line of its own between them and
     the label may shorten under 3em. Heights follow the width alone, never a
     state or a value. */
  @container (max-width: 24rem) {
    .field-head {
      display: grid;
      grid-template-columns: minmax(min-content, 1fr) auto;
      grid-template-rows: minmax(20px, auto) 18px;
      gap: var(--sp-1) var(--sp-2);
      align-items: center;
    }
    .field-label-group { grid-column: 1; grid-row: 1; gap: var(--sp-2); }
    /* No intrinsic width: its words never size the label's or the chip's column. */
    .field-head .ladder { grid-column: 1 / -1; grid-row: 2; min-width: 0; contain: inline-size; text-align: left; }
    .field-head > :is(.field-value, .field-value.typeable) { grid-column: 2; grid-row: 1; justify-self: end; min-width: 0; max-width: 100%; }
    .field-head .chip-num { flex: none; }
    .field-head .field-value .unit:not(:empty) { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .field > input[type='range'] { margin: var(--sp-2) 0 0; }
    .field > input[type='range']:has(+ .field-desc) { margin-bottom: var(--sp-3); }
    .range-dual { margin: var(--sp-2) 0 0; }
    .bitfield { gap: var(--sp-2) var(--sp-3); }
    .lamps { gap: var(--sp-2) var(--sp-3); }
  }
  /* A pair's two values need the room of two chips beside the words: under
     28rem the pair takes a line of its own between the label and the words. */
  @container (max-width: 28rem) {
    .field[data-widget='range'] .field-head {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 18px minmax(20px, auto) 18px;
      column-gap: var(--sp-2);
      row-gap: var(--sp-1);
      align-items: center;
    }
    .field[data-widget='range'] .field-label-group { grid-column: 1; grid-row: 1; }
    .field[data-widget='range'] .field-head > .field-value { grid-column: 1; grid-row: 2; justify-self: end; min-width: 0; max-width: 100%; }
    .field[data-widget='range'] .field-head .ladder { grid-column: 1; grid-row: 3; min-width: 0; contain: inline-size; text-align: left; }
  }
  /* Every chip rule here sits behind :has(), so an engine without it keeps the
     chip on the label's line rather than stacking it over the words. */
  @container (max-width: 13rem) {
    .field-head { grid-template-columns: minmax(0, 1fr) auto; }
    .field-label-group { min-width: 0; }
    .field-head:has(> .field-value) { grid-template-rows: 18px minmax(20px, auto) 18px; }
    .field-head:has(> .field-value) .field-label-group { grid-column: 1 / -1; }
    .field-head:has(> .field-value) > :is(.field-value, .field-value.typeable) { grid-column: 1 / -1; grid-row: 2; }
    .field-head:has(> .field-value) .ladder { grid-row: 3; }
  }
  /* Hit-box geometry (40 px box, 11 px reach): px on purpose, not spacing. */
  @media (pointer: coarse) {
    @container (max-width: 24rem) { .field-head { row-gap: 11px; } }
    @container (max-width: 28rem) { .field[data-widget='range'] .field-head { row-gap: 11px; } }
  }

  /* ---- the status slot (laws 3, 5): in the head row, one clipped line ------ */
  .ladder {
    /* 'still waiting' at 11px is 7em: held at rest once the field holds label,
       chip and words (ph-46yw), so a short write's words move nothing. */
    min-width: clamp(0px, 100cqi - 11rem, 7em);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: 11px;
    /* Its own fixed line, centered rather than baseline-aligned, so the
       words can never move the head row or the control under it. */
    line-height: 14px;
    height: 14px;
    align-self: center;
    color: var(--tx-mut);
  }
  .ladder[data-slot='pending'] { color: var(--intent); }
  .ladder[data-slot='overdue'] { color: var(--warn-ink); }
  .ladder[data-slot='fault'] { color: var(--warn-ink); }
  .ladder[data-slot='gate'] { color: var(--tx-ghost); }
  /* The word fades with the afterglow (style.css --ga). */
  .ladder:is([data-slot='confirmed'], [data-slot='virtual']) { color: color-mix(in srgb, var(--reality) calc(var(--ga) * 100%), var(--tx-mut)); }

  /* Virtual (DESIGN §10.10): nothing was measured, so the field's reality
     accents, afterglow included, speak in the intent family (ph-6n0). */
  .field[data-virtual] { --reality: var(--intent); --reality-rgb: var(--intent-rgb); }

  /* The chosen option: a plain reality border at rest, intent while its write
     is out; the glow is the echo's alone (ph-ufb). */
  .og-seg button.active { box-shadow: none; }
  .field:is([data-shadow='pending'], [data-shadow='overdue']) .og-seg button.active { color: var(--intent); }

  /* ---- builder presentations (DESIGN §10.2) -------------------------------- */
  .knob {
    position: relative;
    align-self: center;
    width: 100%;
    max-width: 160px;
    aspect-ratio: 1;
    touch-action: none;
    cursor: ns-resize;
  }
  .knob.is-disabled { opacity: .45; cursor: not-allowed; }
  .knob:focus-visible { outline: 1px solid var(--highlight); outline-offset: 2px; }
  .knob svg { width: 100%; height: 100%; display: block; }
  .knob circle { fill: none; stroke-width: 6; }
  .knob-track { stroke: var(--line-2); }
  .knob-fill { stroke: var(--reality); }
  .knob-hand { stroke: var(--tx-val); stroke-width: 3; }
  .knob-val {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--mono);
    font-size: .85rem;
    color: var(--tx-val);
    pointer-events: none;
  }

  .meter {
    position: relative;
    height: 8px;
    background: var(--line-2);
    border-radius: var(--r-s);
    overflow: hidden;
  }
  .meter-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--f) * 100%);
    background: var(--reality);
    box-shadow: 0 0 6px rgba(var(--reality-rgb), .4);
  }
  .meter-peak {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--f) * 100%);
    width: 2px;
    background: var(--ink);
  }

  .numeral {
    font-family: var(--mono);
    font-weight: var(--num-wght);
    font-size: 1.6rem;
    line-height: 1.1;
    color: var(--tx-val);
  }
  .numeral-digits {
    display: inline-block;
    text-align: right;
    white-space: pre;
  }
  .numeral .unit, .knob-val .unit {
    margin-left: var(--sp-1);
    font-family: var(--font);
    font-size: .7rem;
    color: var(--tx-ghost);
  }

  .graph {
    width: 100%;
    flex: 1 1 auto;
    min-height: 40px;
  }
  .graph path {
    fill: none;
    stroke: var(--reality);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  /* Stale (law 8): every value surface dims, the control and its chip; the
     label and the status slot stay legible. */
  .field.stale > :not(.field-head, .field-desc),
  .field.stale .field-value {
    opacity: .5;
  }
  .field.stale .numeral { color: var(--tx-ghost); }

  /* ---- vertical orientation (w < h): the control runs along the long side -- */
  .field[data-orient='v'] { height: 100%; }
  .field[data-orient='v'][data-widget='slider'] input[type='range'] {
    writing-mode: vertical-lr;
    direction: rtl;
    width: calc(2px + 2 * var(--range-hit));
    height: auto;
    flex: 1 1 auto;
    min-height: 96px;
    padding: 0 var(--range-hit);
    margin: 0 auto;
    touch-action: pan-x;
  }
  .field[data-orient='v'] .meter {
    flex: 1 1 auto;
    width: 8px;
    height: auto;
    align-self: center;
  }
  .field[data-orient='v'] .meter-fill { inset: auto 0 0 0; width: auto; height: calc(var(--f) * 100%); }
  .field[data-orient='v'] .meter-peak { left: 0; right: 0; top: auto; bottom: calc(var(--f) * 100%); width: auto; height: 2px; }
  .field[data-orient='v'] .stepper { flex-direction: column-reverse; }
  .field[data-orient='v'] .og-seg { flex-direction: column; }

  .color-row { display: flex; align-items: center; gap: var(--sp-3); }
  .color-row input.unknown { opacity: 0; }

  /* Alt-drag (defer.js): the held number in intent; the ring stays pending
     but runs no pulses, since nothing is in flight. !important outranks the
     running animation. */
  .field[data-defer] { --fx-run: 0 !important; }
  .held, .held .chip-num { color: var(--intent); }

  /* F3 locate: drawn on the ring's own line (style.css .field::after: 3 px out,
     1 px wide), lit dim in intent while one soft arc runs once clockwise. The
     arc is three centered dashes of one path, so its ends feather. */
  .field { --loc-ms: 2s; }
  .locate {
    position: absolute;
    /* Ring geometry, px on purpose: 3 px out plus the 1 px line, both sides. */
    inset: -4px;
    width: calc(100% + 8px);
    height: calc(100% + 8px);
    overflow: visible;
    pointer-events: none;
    fill: none;
    animation: loc-fade var(--loc-ms) linear both;
  }
  .locate rect {
    x: .5px;
    y: .5px;
    width: calc(100% - 1px);
    height: calc(100% - 1px);
    rx: calc(var(--radius) + .5px);
    stroke: rgb(var(--intent-rgb));
    stroke-width: 1px;
  }
  .loc-base { stroke-opacity: .35; }
  .loc-arc {
    stroke-linecap: round;
    filter: drop-shadow(0 0 3px rgb(var(--intent-rgb)));
    animation: loc-run var(--loc-ms) ease-in-out both;
  }
  .loc-arc.a { stroke-dasharray: 0 0 24 76; stroke-opacity: .3; stroke-width: 2px; }
  .loc-arc.b { stroke-dasharray: 0 4 16 80; stroke-opacity: .6; stroke-width: 1.5px; }
  .loc-arc.c { stroke-dasharray: 0 8 8 84; }
  @keyframes loc-run { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; } }
  @keyframes loc-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes loc-hold { from { opacity: 1; } to { opacity: 0; } }
  :global(html.still) .loc-arc { display: none; }
  :global(html.still) .locate { animation: loc-hold var(--loc-ms) steps(1, jump-end) both; }

  /* Forced colors (Windows high contrast) repaint backgrounds as Canvas,
     which would erase a meter's fill: value marks take the system highlight. */
  @media (forced-colors: active) {
    .meter-fill, .readout-bar-fill, .range-fill, .lamp.lit i { forced-color-adjust: none; background: Highlight; }
    .knob-fill, .graph path { stroke: Highlight; }
  }
  .color-row input[type='color'] { width: var(--tap); height: var(--tap); padding: 0; border: 1px solid var(--line); border-radius: var(--r-s); background: none; }
</style>
