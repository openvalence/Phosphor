<script module>
  // The strip's numerals (TopStrip) read this rail's rAF instant through it,
  // so the big numeral and the comet never disagree about "now". Null while
  // no rail is mounted; one rail publishes at a time.
  let readout = $state.raw(null);
  export function railReadout() { return readout; }
</script>

<script>
  /**
   * RailWidget.svelte — the flagship instrument: travel rail + stroke-window
   * band + input tape + comet trail + hero numerals.
   *
   * A FAITHFUL PORT of the pre-refactor rail (tag `webui-prerefactor`,
   * `src/features/rail.js` + the hero-strip markup in `index.html`), rebound
   * from hardcoded field names/channel ids to ROLES (roles.js) so it draws on
   * any conforming Valence hub, not just this one. `pos`/`vel` are optional —
   * a machine with no telemetry roles still gets a correct window editor, just
   * without the comet/numerals.
   *
   * ── What did NOT survive the port, and why ─────────────────────────────────
   *
   * 1. THE INPUT TAPE COMMANDS A MOVE ONLY WHEN THE CATALOG SAYS IT CAN.
   *    RFC-032 gave the wire a role for exactly this — `command.position` on
   *    an INTENT schema field is a SETPOINT, not a verb, so (unlike an
   *    `action.*` field) it renders as a positional control rather than a
   *    button. When the hero claim resolves `fields.move`, the tape is live:
   *    tap or drag calls `shadow.svelte.js`'s `sendCommand(move, value)` —
   *    the THIRD of its three write entry points (settings / actions /
   *    commands), NOT writeSetting (this is not an RFC-009 setting, there is
   *    no settingKey/settingChannel for it) and never `session.sendIntent`
   *    directly (nothing outside shadow.svelte.js may call that). Routing
   *    through sendCommand also means the tape is throttled at the MOVE
   *    channel's own catalog-advertised rate instead of a hand-rolled
   *    client-side guess, and a refusal (this device: NACK NOT_HOMED while
   *    unhomed) is no longer silent: the tape's own data-shadow and
   *    ui/TopStrip.svelte's status slot say it. When a machine has not
   *    annotated its move channel this way, the tape correctly declines —
   *    spans the window, disabled, with a reason — exactly like a
   *    Field.svelte control the session cannot write. That decline path is
   *    the honest fallback per hard rule 3, not a placeholder waiting on a
   *    role that does not exist.
   *
   * 2. THE "TARGET" AND "LAG" hero numerals ride RFC-032's
   *    `telemetry.target` (the machine's live setpoint, as opposed to
   *    `telemetry.position`). Lag is not its own role: it is
   *    target - position, computed client-side in HeroNumerals.
   *
   * ── THE COMET IS THE POSITION FIELD, WHATEVER ITS PROVENANCE ──────────────
   *
   * The comet trail and the primary numeral both draw `telemetry.position`.
   * That field is NOT necessarily a measurement: a hub whose planner renders
   * position publishes it with provenance `planned` (RFC-048 key 22), and on
   * this machine it is exactly that. So nothing here may call it actual or
   * measured — the word is composed onto the label by labelFor(). If a hub
   * ALSO grants a second, `actual`-provenance position (an encoder audit on
   * its own channel), that is a SEPARATE role claim and would get its own
   * marker; none is claimed today, so the rail draws one trace and says
   * nothing about a second.
   *
   * 3. Manual mode is OVERRIDE now (SPEC §11.1, RFC-085): the top strip's
   *    override/return control latches it on the hub, and only then does the
   *    tape span the full travel as a jog. The Set-Min/Max-here buttons are
   *    not ported.
   *
   * Everything else is a real port: the ruler, the hazard keep-out ribbons,
   * the draggable/resizable band, the tapered-gradient comet trail, and the
   * hero numerals' exact typographic treatment (huge clamp() numeral, reticle
   * glyph, reality glow) all come straight off the original, generalized to
   * work off whatever `[lo, hi]` and unit the catalog reports instead of an
   * assumed 0-999mm rail.
   */
  import { untrack } from 'svelte';
  import { machine, getSession, freshness } from '../../model/machine.svelte.js';
  import { railOwned } from '../../model/actions.js';
  import { isFieldEnabled, reportedValue } from '../../model/settings.js';
  import { askConfirm } from '../confirm.svelte.js';
  import { writeSetting, sendCommand, displayValue, statusOf, shadowOf, STATUS } from '../../model/shadow.svelte.js';
  import { formatValue, unitOf, labelFor } from '../../model/format.js';
  import { ACCENT, ac } from '../../model/theme.js';
  import { norm, travelBounds } from '../../model/bounds.js';
  import { createTelebuf, createTrail, createRenderClock } from './telebuf.js';
  import { deferring } from '../defer.js';
  import PlanStrip from '../widgets/PlanStrip.svelte';
  import { CH_CONTROL_OWNER } from '../../../../Valence/clients/js/index.js';

  let { fields } = $props();
  // Read through the prop rather than destructuring once — heroes.js hands us
  // a fresh `fields` object whenever the catalog rebuilds, and a plain
  // destructure would freeze on the first machine we ever saw.
  const min = $derived(fields.min);
  const max = $derived(fields.max);
  const pos = $derived(fields.pos);
  const vel = $derived(fields.vel);
  // RFC-032 optional claims. `move` is an INTENT schema field (isIntentField:
  // true from settings.js pass 2) — it has channelId/key/access but no
  // settingKey/writeChannel, so it is written via sendIntent, never
  // writeSetting. `target` is an ordinary STATE field like pos/vel.
  const move = $derived(fields.move);
  const target = $derived(fields.target);
  // RFC-041 optional claims: the machine's ACTUAL travel extent, as opposed
  // to `min`/`max`'s own static catalog bounds. Both null on a hub that does
  // not tag these roles; bounds.js owns what happens then.
  const extentMeasured = $derived(fields.extentMeasured);
  const extentMax = $derived(fields.extentMax);

  function sampleOf(f) { return f ? machine.samples[f.channelId] : undefined; }

  /** Mirrors Field.svelte's three independent gates: mask, link, access tier. */
  function enabledOf(f) {
    if (!f || f.readOnly) return false;
    if (!isFieldEnabled(f, sampleOf(f))) return false;
    if (machine.link.phase !== 'live') return false;
    const e = machine.catalog.entries.find((x) => x.id === f.writeChannel);
    if (!e) return false;
    return (machine.link.roles | 0) >= (e.access | 0);
  }

  // A Shift-drag of the window holds its edges here (defer.js) until release.
  let pend = $state(null); // null | {min?, max?}
  const minVal = $derived(pend && pend.min != null ? pend.min : displayValue(min, sampleOf(min)));
  const maxVal = $derived(pend && pend.max != null ? pend.max : displayValue(max, sampleOf(max)));

  const minEnabled = $derived(enabledOf(min));
  const maxEnabled = $derived(enabledOf(max));
  const bandEnabled = $derived(minEnabled && maxEnabled);

  /**
   * May THIS session command a move? `move` has no enabled_mask (it is not a
   * RFC-009 setting) and no writeChannel/settingKey — its own `access` is the
   * whole gate, checked the same way TopStrip checks an option's access:
   * against the catalog's own data, so this can never disagree with what the
   * hub will actually accept. Reads machine.link.roles/phase explicitly
   * because the session object lives outside Svelte's reactivity.
   */
  const moveAllowed = $derived.by(() => {
    void machine.link.roles; void machine.link.phase;
    if (!move) return false;
    if (machine.link.phase !== 'live') return false;
    const session = getSession();
    return !!session && session.isLive && session.canUse(move.channelId, move.key, 0);
  });

  const latch = $derived(machine.safety);
  const override = $derived(!!latch && latch.override);
  // The hub's jog gate, mirrored (SPEC §11.1, §11.4): an e-stop refuses all
  // motion, a pause without override refuses it INTERLOCK, override makes the
  // tape a jog over the whole travel. An idle, unpaused rail takes a plain
  // point move; a source owning the rail is the hub's SOURCE_CONFLICT to say.
  const jogBlock = $derived(!latch ? '' : latch.estopLatched ? 'E-stop latched'
    : latch.paused && !latch.override ? 'Paused: Override to jog' : '');
  const moveEnabled = $derived(moveAllowed && !jogBlock);

  // The rail row shows the plan strip over the tape while a generator or a
  // stream owns the rail: a jog never takes it from a source (SPEC §11.4), and
  // override is the one way in, so override brings the tape back. Both stay
  // mounted.
  const sourceOwns = $derived(railOwned(machine.catalog.model?.byRole, machine.samples,
    machine.samples[CH_CONTROL_OWNER]));
  const planShown = $derived(sourceOwns && !override);
  // Another session holds a control-owner slot: the full-width plan strip.
  // Else the planned segment, at the window's own width (ph-ryi7).
  const foreign = $derived.by(() => {
    const o = machine.samples[CH_CONTROL_OWNER];
    for (let i = 0; o && o['owner' + i] !== undefined; i++) {
      if (o['owner' + i] && o['owner' + i] !== machine.link.sessionId) return true;
    }
    return false;
  });

  // Flip (SPEC §9.6, RFC-088): the axis.flipped setting, a bool or two-option
  // select where 1 is flipped. Drawn in the top strip beside Override
  // (ph-e82.21) through the readout. Confirmed on every class (reversing a
  // rail under a person is a real act). Never pre-gated beyond the field's
  // own write gate: the hub's SOURCE_CONFLICT, NOT_HOMED and INTERLOCK are
  // shown as it says them. The state is the REPORTED value, never the request.
  const flip = $derived(fields.flip);
  const flipped = $derived(!!Number(reportedValue(flip, sampleOf(flip))));
  const flipEnabled = $derived(enabledOf(flip));
  const flipStatus = $derived(statusOf(flip));
  const flipText = $derived.by(() => {
    const sh = shadowOf(flip);
    if (flipStatus === STATUS.fault) return (sh && sh.error) || 'Refused';
    if (flipStatus === STATUS.pending || flipStatus === STATUS.overdue) return 'Waiting';
    if (!flipEnabled) return machine.link.phase !== 'live' ? 'no hub link' : 'Not writable now';
    return flipped ? 'Flipped: home at right' : 'Normal: home at left';
  });
  // The chip's afterglow, lit per echo as Field.svelte lights its own.
  let flipGlow = $state(0);
  $effect(() => {
    const sh = shadowOf(flip);
    if (flipStatus !== STATUS.confirmed) flipGlow = 0;
    else if (sh && sh.settled) flipGlow = untrack(() => flipGlow) === 1 ? 2 : 1;
  });
  const flipCtl = {
    get on() { return flipped; }, get enabled() { return flipEnabled; }, get status() { return flipStatus; },
    get text() { return flipText; }, get glow() { return flipGlow; }, glowEnd: () => { flipGlow = 0; },
    toggle: () => toggleFlip(),
  };
  // The tooltips carry what the rail's help line used to say (ph-i0y).
  const HINT = 'Tap or scrub to jog';
  const windowDesc = $derived(min.desc || max.desc || '');

  async function toggleFlip() {
    if (!flipEnabled) return;
    const on = !flipped;
    const ok = await askConfirm({
      title: on ? 'Flip the rail' : 'Unflip the rail',
      body: 'Home moves to the ' + (on ? 'right' : 'left') + ' end',
      confirmLabel: on ? 'Flip' : 'Unflip',
    });
    if (ok) writeSetting(flip, on ? 1 : 0);
  }
  const moveReason = $derived.by(() => {
    if (!move) return '';
    if (machine.link.phase !== 'live') return 'no hub link';
    if (!moveAllowed) return 'session not authorized';
    return jogBlock;
  });

  function worstStatus(a, b) {
    const order = [STATUS.fault, STATUS.overdue, STATUS.pending, STATUS.confirmed];
    for (const s of order) if (a === s || b === s) return s;
    return STATUS.confirmed;
  }

  // Rail extent: the whole travel, not the current window — the rail must
  // show the full extent even when the window is small. `lo` is the window
  // fields' own catalog `min` (the legal FLOOR a window edge may be set to);
  // the preference order behind `hi` lives in model/bounds.js, which is its
  // one home. Using `max.max` when a travel role is available draws a rail
  // four times too long on this device (window.max caps at 2000mm, the rail
  // is ~500mm) and a successful home never changes it.
  const measuredTravel = $derived(
    extentMeasured ? displayValue(extentMeasured, sampleOf(extentMeasured)) : null);
  const maxTravel = $derived(
    extentMax ? displayValue(extentMax, sampleOf(extentMax)) : null);
  const extent = $derived(travelBounds(min.min ?? 0, measuredTravel, maxTravel, max.max));
  const lo = $derived(extent.lo);
  const hi = $derived(extent.hi);
  const span = $derived(extent.span);

  // FLIPPED AXIS (operator 2026-10-02): a flipped hub reports every position
  // as travel minus position (RFC-088), so the rail draws its axis reversed,
  // hi on the left. The carriage keeps its screen x across a flip and every
  // number reads the hub's mirrored truth. pct() is the one value-to-screen
  // map; pointer and arrow-key input go back through `dir`.
  const dir = $derived(flipped ? -1 : 1);
  function pct(v) {
    const n = norm(v, lo, hi);
    return n == null || !flipped ? n : 1 - n;
  }

  const minPct = $derived(pct(minVal));
  const maxPct = $derived(pct(maxVal));
  const haveWindow = $derived(minPct != null && maxPct != null);
  // The window's screen edges, whichever value sits on the left.
  const bandL = $derived(haveWindow ? Math.min(minPct, maxPct) : 0);
  const bandR = $derived(haveWindow ? Math.max(minPct, maxPct) : 1);
  /** "a–b" in screen order, left to right. */
  const ends = (fa, a, fb, b) => (flipped ? formatValue(fb, b) + '–' + formatValue(fa, a) : formatValue(fa, a) + '–' + formatValue(fb, b));
  /** A value as a fraction of the window, plan.* units (0 at window.min). */
  const winFrac = (v) => (v == null || !haveWindow || maxVal === minVal ? null : (v - minVal) / (maxVal - minVal));

  function clamp(v, a, b) {
    const lo2 = Math.min(a, b), hi2 = Math.max(a, b);
    return Math.min(hi2, Math.max(lo2, v));
  }

  function snap(v, field) {
    let out = v;
    if (field.step) out = Math.round(out / field.step) * field.step;
    if (field.min != null) out = Math.max(out, field.min);
    if (field.max != null) out = Math.min(out, field.max);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Ruler ticks: one line per WHOLE UNIT of the reported span, major every
  // 10 units, mid every 5, coarsened only when the host is physically too
  // narrow to draw one line per unit without smearing. Nothing here
  // hardcodes a unit; the span comes from the catalog's own bounds, and the
  // density check measures the WIDGET's pixel width (`railWidthPx` below).
  //
  // FAT TICKS BUG: this widget used to render into `viewBox="0 0 100 100"`
  // with `preserveAspectRatio="none"`. That viewBox is square, but the host
  // is not (it is short and wide), so "none" scaled x and y by DIFFERENT
  // factors to fill it — e.g. a 700px-wide, 72px-tall host scaled x by 7x
  // and y by 1x. A vertical tick's stroke-width is a horizontal thickness,
  // so it rode the x scale: `stroke-width="1"` came out ~7px wide, i.e. a
  // gray block, not a hairline. The original avoided this by giving the SVG
  // a viewBox of the host's REAL pixel size (`0 0 w h`), so the CTM is 1:1
  // and `stroke-width="1"` is a literal 1px line regardless of host aspect.
  // Ported back here via `railWidthPx`/`railHeightPx` below.
  // ---------------------------------------------------------------------------
  // BASE_H: the OG host's reference height (px) that its tick geometry was
  // authored against. Every tick dimension below is a fraction of BASE_H,
  // rescaled to the ACTUAL host height (`h`) so a differently sized host
  // still gets correctly proportioned ticks instead of the OG's fixed pixel
  // constants.
  const BASE_H = 72;

  function buildTicks(loV, hiV, w, h) {
    const out = [];
    const spanV = hiV - loV;
    if (!(spanV > 0)) return out;
    const railUnits = Math.max(Math.round(spanV), 1);
    // Before the ResizeObserver below has fired, w is 0 — default to "dense
    // enough for 1-unit ticks" rather than falling back to the coarsest
    // step, so the very first paint already looks right.
    const pxPerUnit = w > 0 ? w / railUnits : 2;
    let minorStep = 1;
    if (pxPerUnit < 2) minorStep = 2;
    if (pxPerUnit < 1) minorStep = 5;
    // Hard tick-count cap: however dense the span, never emit more than 600
    // ticks — without this a huge span with a 1-unit minorStep would flood
    // the SVG with thousands of <line> nodes.
    if (railUnits / minorStep > 600) minorStep = Math.ceil(railUnits / 600);
    // Nothing to position ticks against yet (host not measured/laid out) —
    // the step-count math above still ran so a later call has nothing to
    // redo, but there is no real pixel space to place a tick in.
    if (!(w > 0) || !(h > 0)) return out;
    const tickTop = (26 / BASE_H) * h;
    const majorLen = (14 / BASE_H) * h;
    const midLen = (10 / BASE_H) * h;
    const minorLen = (7 / BASE_H) * h;
    for (let u = 0; u <= railUnits; u += minorStep) {
      const major = u % 10 === 0;
      const mid = !major && u % 5 === 0;
      const x = (flipped ? 1 - u / railUnits : u / railUnits) * w;
      const len = major ? majorLen : (mid ? midLen : minorLen);
      out.push({ x, y1: tickTop, y2: tickTop + len, major, mid });
    }
    return out;
  }

  // Actual pixel size of the rail host — the ruler's density check needs a
  // real width measurement (percentages alone can't tell "1mm tick" from "1px
  // smear"), and the SVG viewBox needs the real width AND height to stay 1:1
  // with the CTM (see FAT TICKS above). Tracked independently of the canvas
  // sizing effect below so the ruler doesn't depend on the canvas mounting.
  let railWidthPx = $state(0);
  let railHeightPx = $state(0);
  $effect(() => {
    if (!hostEl) return;
    function measure() { railWidthPx = hostEl.clientWidth; railHeightPx = hostEl.clientHeight; }
    measure();
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(hostEl);
    return () => { if (ro) ro.disconnect(); };
  });

  const ticks = $derived(buildTicks(lo, hi, railWidthPx, railHeightPx));
  const baselineY = $derived(railHeightPx > 0 ? (33 / BASE_H) * railHeightPx : 0);

  // ---------------------------------------------------------------------------
  // Telemetry smoothing — one telebuf per available role, fed on every real
  // STATE push, sampled every rendered frame. Never fabricates: `fresh` is
  // false (and callers must withhold) until a real sample has landed and stays
  // that way once samples stop arriving.
  // ---------------------------------------------------------------------------
  const posTele = createTelebuf();
  const velTele = createTelebuf();
  let posTeleChannel = null;
  let velTeleChannel = null;

  // ONE render-delay clock shared by pos/vel/target (see telebuf.js's header
  // for why raw "now" jitters against irregular arrival). Fed from `pos`'s
  // arrivals — pos is the primary telemetry role every one of these three
  // rides alongside (vel/target are optional companions on the same
  // machine), so its arrival cadence is the right thing to buffer against.
  const renderClock = createRenderClock();

  $effect(() => {
    const f = pos;
    if (!f) return;
    if (posTeleChannel !== f.channelId) { posTele.reset(); posTeleChannel = f.channelId; renderClock.reset(); }
    const ts = machine.sampleTs[f.channelId];
    const s = machine.samples[f.channelId];
    if (ts && s) {
      const v = displayValue(f, s);
      if (typeof v === 'number' && isFinite(v)) { posTele.push(v, ts); renderClock.noteArrival(ts); }
    }
  });

  $effect(() => {
    const f = vel;
    if (!f) return;
    if (velTeleChannel !== f.channelId) { velTele.reset(); velTeleChannel = f.channelId; }
    const ts = machine.sampleTs[f.channelId];
    const s = machine.samples[f.channelId];
    if (ts && s) {
      const v = displayValue(f, s);
      if (typeof v === 'number' && isFinite(v)) velTele.push(v, ts);
    }
  });

  // Same treatment for the setpoint, so the target numeral and the tape's own
  // live cursor never disagree about "now" with each other or with the
  // position comet — all three are sampled from the same rAF instant below.
  const targetTele = createTelebuf();
  let targetTeleChannel = null;

  $effect(() => {
    const f = target;
    if (!f) return;
    if (targetTeleChannel !== f.channelId) { targetTele.reset(); targetTeleChannel = f.channelId; }
    const ts = machine.sampleTs[f.channelId];
    const s = machine.samples[f.channelId];
    if (ts && s) {
      const v = displayValue(f, s);
      if (typeof v === 'number' && isFinite(v)) targetTele.push(v, ts);
    }
  });

  // ---------------------------------------------------------------------------
  // rAF render loop — drives the canvas AND the hero numerals from the SAME
  // interpolated instant, so the phosphor dot and the big numeral never
  // disagree about "now" (the whole reason the strip's HeroNumerals reads
  // this rail's readout rather than telemetry of its own).
  // ---------------------------------------------------------------------------
  let posDisplay = $state(null);
  let speedDisplay = $state(null);
  let moving = $state(false);
  let fresh = $state(false);
  let targetDisplay = $state(null);
  let targetFresh = $state(false);
  // Getters, not values: TopStrip's reads subscribe to these same signals.
  $effect(() => {
    readout = {
      get posField() { return pos; }, get velField() { return vel; }, get targetField() { return target; },
      get posVal() { return posDisplay; }, get speedVal() { return speedDisplay; },
      get targetVal() { return targetDisplay; }, get moving() { return moving; }, get fresh() { return fresh; },
      get targetFresh() { return targetFresh; }, get extentHi() { return hi; },
      get flip() { return flip ? flipCtl : null; }, get playing() { return planShown; }, jog,
    };
    return () => { readout = null; };
  });

  let hostEl = $state(null);
  let canvasEl = $state(null);

  // Reactive, not a one-time read: a preference toggled mid-session (T25 —
  // motion must honor a LIVE change, no reload) must reach the rAF loop
  // below, which reads this on every frame.
  let reducedMotion = $state((typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false);
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => { reducedMotion = mq.matches; };
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });

  $effect(() => {
    if (!hostEl || !canvasEl) return;

    let ctx = canvasEl.getContext('2d');
    let dpr = 1, rectW = 0, rectH = 0;
    let rafId = 0;
    let lastFrameTs = 0;
    let lastMoveAt = 0;
    let speedEma = 0;
    let velSmoothPxPerMs = 0;
    let prevPx = null;
    // Render-health census, published to machine.stats.render once a second.
    // Which half is ragged is not guessable: a low or lumpy fps means the
    // WEBVIEW's frame cadence (the Tauri shell has its own), a high held
    // percentage at a healthy fps means ARRIVALS outran the buffer. One
    // second is a T27 rate limit, not a display preference.
    let censusStart = 0;
    let censusFrames = 0;
    let censusHeld = 0;
    const trail = createTrail();

    function sizeCanvas() {
      const w = hostEl.clientWidth, h = hostEl.clientHeight;
      dpr = window.devicePixelRatio || 1;
      const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (canvasEl.width !== cw || canvasEl.height !== ch) { canvasEl.width = cw; canvasEl.height = ch; }
      rectW = w; rectH = h;
    }

    function flushRibbon(ctx2, pts, startI, endI, midY) {
      const nPts = endI - startI + 1;
      if (nPts < 2) return;
      const headX = pts.x[startI], tailX = pts.x[endI];
      const g = ctx2.createLinearGradient(headX, 0, tailX, 0);
      g.addColorStop(0, ac('r', 0.55));
      g.addColorStop(1, ac('r', 0));
      ctx2.fillStyle = g;
      ctx2.beginPath();
      ctx2.moveTo(pts.x[startI], midY - pts.w[startI]);
      for (let i = startI + 1; i <= endI; i++) ctx2.lineTo(pts.x[i], midY - pts.w[i]);
      for (let j = endI; j >= startI; j--) ctx2.lineTo(pts.x[j], midY + pts.w[j]);
      ctx2.closePath();
      ctx2.fill();
    }

    function drawComet(nowMs, midY, headHalf, glowActive) {
      const capacity = 320;
      const px = new Float64Array(capacity);
      const pw = new Float64Array(capacity);
      let m = 0, runStart = 0, runDir = 0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]);
      ctx.shadowColor = ac('r', 0.6);
      ctx.shadowBlur = glowActive ? 8 : 5;

      trail.forEachRecent(nowMs, 850, (x, t, age) => {
        if (m >= capacity) return;
        const f = Math.max(0, 1 - age / 850);
        const taper = f * f;
        if (m > 0) {
          const dx = x - px[m - 1];
          const dir = dx > 0.001 ? 1 : (dx < -0.001 ? -1 : runDir);
          if (runDir !== 0 && dir !== 0 && dir !== runDir) {
            flushRibbon(ctx, { x: px, w: pw }, runStart, m - 1, midY);
            runStart = m - 1;
            runDir = dir;
          } else if (runDir === 0) {
            runDir = dir;
          }
        }
        px[m] = x;
        pw[m] = Math.max(headHalf * taper, 0.15);
        m++;
      });
      if (m - 1 > runStart) flushRibbon(ctx, { x: px, w: pw }, runStart, m - 1, midY);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    function drawReducedTrail(nowMs, midY) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = ACCENT.reality;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      trail.forEachRecent(nowMs, 850, (x) => {
        if (!started) { ctx.moveTo(x, midY); started = true; }
        else ctx.lineTo(x, midY);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const isFresh = (f) => { const fr = freshness(f.channelId); return !!fr && !fr.stale; };

    function draw(nowMs) {
      let dtMs = nowMs - lastFrameTs;
      if (dtMs <= 0 || dtMs > 500) dtMs = 16.667;
      lastFrameTs = nowMs;

      // rAF hands us a DOMHighResTimeStamp — ms since performance.timeOrigin,
      // NOT since the Unix epoch. machine.sampleTs (and therefore every
      // timestamp the telebufs were pushed with) is Date.now() epoch ms, off
      // session.js's `emit('state', ..., Date.now())`. performance.timeOrigin
      // IS the epoch time of navigation start, so adding it converts the rAF
      // clock into the same domain the samples are stamped in — see
      // telebuf.js's header for what silently comparing the two raw produces
      // (spoiler: sampleAt() never sees "now" as newer than any real sample,
      // and always returns the OLDEST entry still in the ring).
      const nowEpochMs = performance.timeOrigin + nowMs;

      // Render at nowEpochMs MINUS an adaptively-slewed delay (telebuf.js's
      // createRenderClock), not raw "now" — see telebuf.js's header for why
      // sampling at raw "now" against ~20-30 Hz, irregularly-spaced STATE
      // pushes produces exactly the freeze-then-snap stutter this widget was
      // reported buggy for. update() must run every frame (it slews toward
      // the target delay), even on a frame with no fresh pos field.
      renderClock.update(dtMs);
      const tRender = renderClock.stableRenderTime(nowEpochMs);

      // Pull ground truth through the telebufs at THIS instant.
      censusFrames++;
      if (!censusStart) censusStart = nowMs;
      if (nowMs - censusStart >= 1000) {
        const secs = (nowMs - censusStart) / 1000;
        machine.stats.render = {
          fps: Math.round(censusFrames / secs),
          delayMs: Math.round(renderClock.getDelayMs()),
          heldPct: Math.round((censusHeld / Math.max(1, censusFrames)) * 100),
          // The rAF clock converted into the sample-stamp epoch, minus that
          // epoch. Zero on a browser that agrees with itself; a webview whose
          // two clocks disagree renders at an instant no sample was ever
          // stamped at, which reads as constant lag or constant snapping.
          skewMs: Math.round(nowEpochMs - Date.now()),
        };
        censusStart = nowMs; censusFrames = 0; censusHeld = 0;
      }

      if (pos) {
        const r = posTele.sampleAt(tRender);
        posDisplay = r.value;
        // The model's one freshness rule, not the telebuf's own hold window:
        // a parked machine's position is silent and still true (SPEC Â§9.1).
        fresh = r.value != null && isFresh(pos);
        if (r.holding) censusHeld++;
        let speedPerSec = null;
        if (vel) {
          const rv = velTele.sampleAt(tRender);
          if (rv.value != null) speedPerSec = Math.abs(rv.value);
        } else if (r.value != null) {
          speedPerSec = Math.abs(r.velPerMs) * 1000;
        }
        speedEma += 0.2 * ((speedPerSec ?? 0) - speedEma);
        speedDisplay = fresh ? speedEma : null;
        const movingThreshold = span * 0.002; // 0.2%-of-span/s reads as "moving"
        if (fresh && speedEma > movingThreshold) lastMoveAt = nowMs;
        moving = (nowMs - lastMoveAt) < 300;
      } else {
        posDisplay = null; speedDisplay = null; moving = false; fresh = false;
      }

      if (target) {
        const rt = targetTele.sampleAt(tRender);
        targetDisplay = rt.value;
        targetFresh = rt.value != null && isFresh(target);
      } else {
        targetDisplay = null; targetFresh = false;
      }

      // Jitter probe: test/rail-probe.mjs sets window.__railProbe = [] and
      // harvests it, so marker smoothness is MEASURED per frame instead of
      // eyeballed. Zero cost when the flag is unset (the normal case).
      if (window.__railProbe) {
        window.__railProbe.push([nowMs, tRender, posDisplay, targetDisplay, fresh ? 1 : 0,
          pos && posDisplay != null && rectW > 0 ? pct(posDisplay) * rectW : null]);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rectW, rectH);

      if (pos && posDisplay != null && fresh && rectW > 0) {
        const frac = pct(posDisplay);
        const px2 = frac * rectW;
        const midY = rectH * 0.5;
        trail.record(px2, nowMs);

        const instVel = prevPx != null ? Math.abs(px2 - prevPx) / Math.max(dtMs, 1) : 0;
        velSmoothPxPerMs += 0.2 * (instVel - velSmoothPxPerMs);

        const H = rectH * 0.5;
        if (reducedMotion) {
          drawReducedTrail(nowMs, midY);
        } else {
          // Reference speed: crossing the FULL span in ~2s reads as "fast".
          // Scale/unit independent — see niceStep's comment for why this
          // beats the original's device-specific max-speed lookup.
          const refPxPerMs = rectW / 2000;
          const speedNorm = Math.min(1, Math.max(0, velSmoothPxPerMs / Math.max(refPxPerMs, 1e-6)));
          const headHalf = Math.max(1, 1 + (0.25 * H - 1) * speedNorm);
          drawComet(nowMs, midY, headHalf, moving);
        }

        ctx.strokeStyle = ACCENT.reality;
        ctx.lineWidth = 1;
        ctx.shadowColor = ac('r', 0.55);
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(px2, rectH * 0.22);
        ctx.lineTo(px2, rectH * 0.72);
        ctx.stroke();

        ctx.shadowColor = ac('r', 0.9);
        ctx.shadowBlur = moving ? 12 : 8;
        ctx.fillStyle = ACCENT.core;
        ctx.beginPath();
        ctx.arc(px2, midY, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        prevPx = px2;
      } else {
        prevPx = null;
        velSmoothPxPerMs = 0;
      }

      rafId = requestAnimationFrame(draw);
    }

    sizeCanvas();
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(sizeCanvas) : null;
    if (ro) ro.observe(hostEl);
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
    };
  });

  // ---- drag state -----------------------------------------------------------

  let dragMode = $state(null); // null | 'min' | 'max' | 'band'
  let dragStartX = 0;
  let dragStartMin = 0;
  let dragStartMax = 0;

  /** The gate for one drag mode. Asked at grab AND on every move: a handle the
      machine disables mid-gesture (mask, link loss, tier change) must stop
      writing, the same re-check onBandKey/onHandleKey/requestMove already do. */
  function dragAllowed(mode) {
    return mode === 'min' ? minEnabled : mode === 'max' ? maxEnabled : bandEnabled;
  }

  function startDrag(mode, e) {
    if (!dragAllowed(mode)) return;
    dragMode = mode;
    dragStartX = e.clientX;
    dragStartMin = minVal ?? lo;
    dragStartMax = maxVal ?? hi;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* unsupported: still works via window fallback */ }
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragMode || !hostEl) return;
    // Ending the drag rather than merely skipping the write: a gesture resumed
    // from a stale dragStartX would jump the window on re-enable.
    if (!dragAllowed(dragMode)) { dragMode = null; pend = null; return; }
    const rect = hostEl.getBoundingClientRect();
    if (!rect.width) return;
    const dv = dir * ((e.clientX - dragStartX) / rect.width) * span;
    const out = {};
    if (dragMode === 'min') {
      out.min = snap(clamp(dragStartMin + dv, lo, dragStartMax), min);
    } else if (dragMode === 'max') {
      out.max = snap(clamp(dragStartMax + dv, dragStartMin, hi), max);
    } else if (dragMode === 'band') {
      const width = dragStartMax - dragStartMin;
      const newMin = clamp(dragStartMin + dv, lo, hi - width);
      out.min = snap(newMin, min);
      out.max = snap(newMin + width, max);
    }
    if (deferring(e)) { pend = out; return; }
    pend = null;
    writeEdges(out);
  }
  function writeEdges(out) {
    if (out.min != null) writeSetting(min, out.min);
    if (out.max != null) writeSetting(max, out.max);
  }

  // A held Shift-drag writes on release only; a cancelled pointer writes nothing.
  function endDrag(e) {
    const p = pend, mode = dragMode;
    pend = null;
    dragMode = null;
    if (p && mode && e.type === 'pointerup' && dragAllowed(mode)) writeEdges(p);
  }

  function onBandKey(e) {
    if (!bandEnabled) return;
    const width = (maxVal ?? hi) - (minVal ?? lo);
    const step = min.step || max.step || Math.max(span / 100, 1e-6);
    let dv = 0;
    if (e.key === 'ArrowRight') dv = dir * step;
    else if (e.key === 'ArrowLeft') dv = -dir * step;
    else if (e.key === 'ArrowUp') dv = step;
    else if (e.key === 'ArrowDown') dv = -step;
    else if (e.key === 'Home') dv = lo - (minVal ?? lo);
    else if (e.key === 'End') dv = hi - (maxVal ?? hi);
    else return;
    e.preventDefault();
    const newMin = clamp((minVal ?? lo) + dv, lo, hi - width);
    writeSetting(min, snap(newMin, min));
    writeSetting(max, snap(newMin + width, max));
  }

  function onHandleKey(e, which) {
    const field = which === 'min' ? min : max;
    const ok = which === 'min' ? minEnabled : maxEnabled;
    if (!ok) return;
    const step = field.step || Math.max(span / 100, 1e-6);
    let target;
    const cur = which === 'min' ? (minVal ?? lo) : (maxVal ?? hi);
    if (e.key === 'ArrowRight') target = cur + dir * step;
    else if (e.key === 'ArrowLeft') target = cur - dir * step;
    else if (e.key === 'ArrowUp') target = cur + step;
    else if (e.key === 'ArrowDown') target = cur - step;
    else if (e.key === 'Home') target = lo;
    else if (e.key === 'End') target = hi;
    else if (e.key === 'PageUp') target = cur + step * 10;
    else if (e.key === 'PageDown') target = cur - step * 10;
    else return;
    e.preventDefault();
    const lower = which === 'min' ? lo : (minVal ?? lo);
    const upper = which === 'min' ? (maxVal ?? hi) : hi;
    writeSetting(field, snap(clamp(target, lower, upper), field));
  }

  // The pill carries the span alone; the edges' values sit on the axis row and
  // an axis mark yields where a window value would land on it.
  const spanLabel = $derived(
    haveWindow ? formatValue(min, (maxVal ?? hi) - (minVal ?? lo)) + (unitOf(min) ? ' ' + unitOf(min) : '') : ''
  );
  const AXIS_CLEAR = 44;
  const loPx = $derived(bandL * railWidthPx);
  const hiPx = $derived(bandR * railWidthPx);
  const narrow = $derived(hiPx - loPx < 2 * AXIS_CLEAR);
  const yieldLo = $derived(haveWindow && loPx < AXIS_CLEAR);
  const yieldHi = $derived(haveWindow && railWidthPx - hiPx < AXIS_CLEAR);
  const yieldMid = $derived(haveWindow && (Math.abs(loPx - railWidthPx / 2) < AXIS_CLEAR || Math.abs(hiPx - railWidthPx / 2) < AXIS_CLEAR));

  const bandLabel = $derived(
    haveWindow
      ? ends(min, minVal, max, maxVal) + ' · ' + formatValue(min, (maxVal ?? hi) - (minVal ?? lo)) + (unitOf(min) ? ' ' + unitOf(min) : '')
      : ''
  );

  // ---------------------------------------------------------------------------
  // Input tape — commands a move (RFC-032 command.position), when the catalog
  // gave us `move`. Not a Field.svelte control and not writeSetting: there is
  // no settingKey/settingChannel for an INTENT command field. `sendCommand`
  // (shadow.svelte.js) gives it the SAME pending/ECHO/NACK lifecycle a setting
  // gets, coalesced at the move channel's own catalog-advertised rate — so
  // dragging no longer needs a hand-rolled client-side throttle, and a refusal
  // (this device, unhomed: NACK NOT_HOMED) is recorded in the shared shadow
  // instead of vanishing. Ground truth is still preserved by NOT inventing a
  // local "confirmed" value: while dragging the cursor tracks the operator's
  // hand (clearly a live drag, not a claim about the machine); once released
  // it falls straight back to `telemetry.target`, the same ground-truth
  // setpoint the "commanded" hero numeral shows, so the tape and the numeral
  // can never disagree.
  //
  // DOMAIN — this is bug #1 from the pre-refactor rail report: the tape's
  // command surface is the reported STROKE WINDOW ([minVal, maxVal]), exactly
  // like the original's "normal mode" (`core/range.js`'s `winMin`/`winMax`,
  // ported here as this widget's own `minVal`/`maxVal`). It is NOT the move
  // field's own static catalog [min,max] annotation (0100 `position` declares
  // 0-2000mm — the full mechanical ceiling, not the operator's chosen
  // sub-range) and NOT the rail's full [lo,hi] extent either. Binding to the
  // window makes it geometrically impossible to command outside it, and the
  // original's "manual mode" (tape spans full travel) is deliberately not
  // reproduced — see this file's top-of-file note #3, unchanged by this fix.
  // ---------------------------------------------------------------------------
  let moveDragging = $state(false);
  let moveDragValue = $state(null);
  let moveHeld = $state(false); // a Shift-drag holding its jog until release (defer.js)
  let tapeBarEl = $state(null);

  // BUG FIX (tap/scrub not registering): the pointer handlers used to live on
  // `.rail-tape.live` — the highlighted sub-strip, sized to exactly the
  // reported window (see tapeStripLoPct/Hi below), which on this device's
  // window (32-183mm of a 269mm rail) covers only the middle ~56% of the
  // full-width track. `.rail-tape-track` (the dashed-guide wrapper) visually
  // reads as "the tape" to a human or a script hit-testing "90% across the
  // strip" — but it had NO listeners of its own, so a pointer landing in the
  // dead zone outside the highlighted strip (elementFromPoint confirmed:
  // `.rail-tape-track`, not `.rail-tape.live`) produced neither a command nor
  // a refusal, because no handler ever ran. That is bug #3's actual root
  // cause: a DOM hit-testing gap between the element that LOOKS interactive
  // (the full track) and the smaller element that WAS. Fix: the track itself
  // is now the event target (bound here as `tapeTrackEl`); the highlighted
  // strip stays purely visual. `moveValueFromClientX` still maps/clamps
  // against the STRIP's own rect (`tapeBarEl`), unchanged — so a tap inside
  // the strip behaves exactly as before, and a tap ANYWHERE ELSE on the
  // track (before its left edge or past its right edge) clamps to
  // tapeLo/tapeHi instead of doing nothing, which is what "clamps rather
  // than escaping the window" requires of a tap outside the window's span.
  let tapeTrackEl = $state(null);

  // Under override the jog may leave the window (SPEC §11.1): full travel.
  const tapeLo = $derived(haveWindow && !override ? (minVal ?? lo) : lo);
  const tapeHi = $derived(haveWindow && !override ? (maxVal ?? hi) : hi);
  const tapeSpan = $derived(Math.max(tapeHi - tapeLo, 1e-9));
  // Where the tape's own highlighted/draggable strip sits ON THE RAIL — the
  // SAME fraction-of-full-extent the window band below uses, so the strip you
  // touch is drawn directly above the window it commands (the visual half of
  // "geometrically impossible to command outside the window"; the original's
  // `positionTape()` did the identical alignment).
  const tapeStripLoPct = $derived(haveWindow && !override ? bandL : 0);
  const tapeStripHiPct = $derived(haveWindow && !override ? bandR : 1);

  /** clientX -> commandable value, mapped against the STRIP's own width (not the whole assembly) so a short window strip still reads its full drag travel as [tapeLo,tapeHi]. */
  function moveValueFromClientX(clientX) {
    if (!tapeBarEl) return null;
    const rect = tapeBarEl.getBoundingClientRect();
    if (!rect.width) return null;
    const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
    return flipped ? tapeHi - frac * tapeSpan : tapeLo + frac * tapeSpan;
  }

  function requestMove(value) {
    if (value == null || !move || !moveEnabled) return;
    sendCommand(move, clamp(value, tapeLo, tapeHi));
  }
  // The one jog handle: the strip's typed target (HeroNumerals) moves only
  // through the tape's own send, gate and domain.
  const jog = {
    send: requestMove,
    get enabled() { return moveEnabled; }, get reason() { return moveReason; },
    get lo() { return tapeLo; }, get hi() { return tapeHi; }, get windowed() { return haveWindow && !override; },
  };

  function onTapePointerDown(e) {
    if (!moveEnabled) return;
    moveDragging = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* unsupported: still works via window fallback */ }
    onTapePointerMove(e);
    e.preventDefault();
  }
  function onTapePointerMove(e) {
    if (!moveDragging) return;
    const v = moveValueFromClientX(e.clientX);
    moveDragValue = v;
    moveHeld = deferring(e);
    if (!moveHeld) requestMove(v);
  }
  function onTapePointerUp(e) {
    if (!moveDragging) return;
    moveDragging = false;
    const held = moveHeld;
    moveHeld = false;
    // A cancelled live drag still requeues; a cancelled held one sends nothing.
    if (e.type === 'pointerup' || !held) requestMove(moveDragValue); // guarantee the released position is (re)queued, even mid-coalesce
  }

  // Keyboard reach for the tape — the original had none (pointer/touch only);
  // this control already announces itself to assistive tech as role="slider"
  // (below), and a slider that ignores every key it claims to support is a
  // worse a11y defect than not claiming the role at all, so this is a genuine
  // fix (operator-blessed category: "a control that is keyboard-unreachable"),
  // not a reproduction of anything the original did.
  function onTapeKey(e) {
    if (!moveEnabled) return;
    const step = (move && move.step) || Math.max(tapeSpan / 100, 1e-6);
    const cur = tapeVal ?? tapeLo;
    let v;
    if (e.key === 'ArrowRight') v = cur + dir * step;
    else if (e.key === 'ArrowLeft') v = cur - dir * step;
    else if (e.key === 'ArrowUp') v = cur + step;
    else if (e.key === 'ArrowDown') v = cur - step;
    else if (e.key === 'PageUp') v = cur + step * 10;
    else if (e.key === 'PageDown') v = cur - step * 10;
    else if (e.key === 'Home') v = tapeLo;
    else if (e.key === 'End') v = tapeHi;
    else return;
    e.preventDefault();
    requestMove(v);
  }

  // Cursor position: the live drag value while dragging, else the machine's
  // own reported setpoint (never a locally-remembered request once released).
  const tapeVal = $derived(
    moveDragging ? moveDragValue : (target && targetFresh && targetDisplay != null ? targetDisplay : null)
  );
  // Fraction WITHIN the strip's own local width (0..1) — the pip rides under
  // the pointer/setpoint the same way the original's did, in the strip's own
  // coordinate space, not the full rail's.
  const tapeDotFrac = $derived.by(() => {
    if (tapeVal == null) return null;
    const f = clamp((tapeVal - tapeLo) / tapeSpan, 0, 1);
    return flipped ? 1 - f : f;
  });
</script>

<div class="hero rail-hero">
  <!-- The numerals, override/return and Flip live in the top strip
       (TopStrip.svelte, reading railReadout()); this panel is the rail row
       and the rail. -->
  <div class="rail-panel">
  <!-- THE RAIL ROW, one fixed height, the rail's full width: the jog tape
       and the plan strip share one cell, both mounted, and planShown picks
       the visible one, so a swap remounts and moves nothing. A reason
       renders inside the tape, never as a line of its own. -->
  <div class="rail-row">
    <div class="rail-swap">
    <div class="swap-face" class:off={!planShown}>
      {#if foreign}
        <PlanStrip shown={planShown} edge0={haveWindow ? minPct : 0} edge1={haveWindow ? maxPct : 1} />
      {:else}
        <PlanStrip shown={planShown} segment lane={[bandL, bandR]} edge0={minPct > maxPct ? 1 : 0} edge1={minPct > maxPct ? 0 : 1}
                   pos={fresh ? winFrac(posDisplay) : null} target={targetFresh ? winFrac(targetDisplay) : null} />
      {/if}
    </div>
    <div class="swap-face" class:off={planShown}>
    {#if move}
      <!-- Input tape — a live command surface. In the original this was
           two layers: a full-width TRACK (dashed guides marking full travel)
           with a highlighted, draggable STRIP inside it sized/positioned to
           EXACTLY the reported window — so the strip you touch sits directly
           above the window band on the rail below, and dragging anywhere on
           it can only ever produce a value inside that window. Tap or drag it
           to send a move INTENT; the hub clamps (window, limits) and the
           post-clamp ECHO plus telemetry.target are what the cursor shows once
           the drag ends — never an optimistic local guess. -->
      <div class="rail-tape-assembly" class:drag-live={moveDragging} class:disabled={!moveEnabled}
           data-shadow={moveHeld ? STATUS.pending : statusOf(move)}>
        <!-- The TRACK is the hit-test surface now (bug #3 fix, see the note by
             tapeTrackEl above) — the whole dashed-guide width is tappable, not
             just the highlighted strip nested inside it. The strip
             (`.rail-tape.live`) stays purely visual: it still shows exactly
             where the window sits, still carries the pip, but no longer owns
             any listeners of its own (pointer events on it bubble to the
             track same as anywhere else). -->
        <div class="rail-tape-track" bind:this={tapeTrackEl} title={moveEnabled || !moveReason ? HINT : moveReason}
             role="slider" tabindex={moveEnabled ? 0 : -1}
             aria-label={'Jog: ' + labelFor(move)} aria-orientation="horizontal"
             aria-valuemin={tapeLo} aria-valuemax={tapeHi} aria-valuenow={tapeVal ?? tapeLo}
             aria-disabled={!moveEnabled}
             class:live={moveEnabled}
             onpointerdown={onTapePointerDown}
             onpointermove={onTapePointerMove}
             onpointerup={onTapePointerUp}
             onpointercancel={onTapePointerUp}
             onkeydown={onTapeKey}>
          <div class="rail-tape live" bind:this={tapeBarEl}
               style="left:{tapeStripLoPct * 100}%; width:{Math.max(0, (tapeStripHiPct - tapeStripLoPct) * 100)}%">
            {#if !moveEnabled && moveReason}
              <span class="rail-tape-micro rail-reason">{moveReason}</span>
            {:else}
              <span class="rail-tape-micro">tap &middot; scrub</span>
            {/if}
            {#if tapeDotFrac != null}
              <div class="rail-tape-pip" class:on={moveDragging} style="left:{tapeDotFrac * 100}%"></div>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <!-- A catalog with no role-tagged move INTENT: the window extent keeps
           the rhythm, commands nothing, and says why. -->
      <div class="rail-tape-assembly disabled" aria-disabled="true" title="No move intent on this catalog">
        <div class="rail-tape-track" title={HINT}>
          <div class="rail-tape"
               style="left:{bandL * 100}%; width:{(bandR - bandL) * 100}%"><span class="rail-tape-micro rail-reason">no move intent on this catalog</span></div>
        </div>
      </div>
    {/if}
    </div>
    </div>
  </div>

  <div class="spine-rail-host" class:drag-live={dragMode !== null} bind:this={hostEl}>
    <!-- Tick geometry mirrors the original's 72px-tall host ratios (tickTop
         26px, majorLen 14px, midLen 10px, minorLen 7px, baseline 33px),
         rescaled to the host's ACTUAL height (see BASE_H above) — minor
         ticks land exactly on the baseline from above; mid/major poke a bit
         past it, which is what reads as "ruler" rather than "tally marks".
         viewBox is the host's REAL pixel size (not an abstract 0-100 box),
         so the CTM is 1:1 and stroke-width="1" stays a true hairline instead
         of stretching into a block on a wide-short host. -->
    <div class="rail-clip">
    <svg class="rail-ruler-svg" viewBox="0 0 {Math.max(railWidthPx, 1)} {Math.max(railHeightPx, 1)}"
         preserveAspectRatio="none" aria-hidden="true">
      {#each ticks as t}
        <line x1={t.x} x2={t.x} y1={t.y1} y2={t.y2}
              stroke={t.major ? 'var(--line-3)' : 'var(--line-1)'} stroke-width="1"
              opacity={t.major ? 1 : (t.mid ? 0.85 : 0.5)} />
      {/each}
      <line x1="0" y1={baselineY} x2={railWidthPx} y2={baselineY} stroke="var(--line-1)" stroke-width="1" />
    </svg>
    <span class="rail-endcap lo mono" class:yield={yieldLo}>{flipped ? formatValue(max, hi) : formatValue(min, lo)}</span>
    <span class="rail-endcap hi mono" class:yield={yieldHi}>{flipped ? formatValue(min, lo) : formatValue(max, hi)}</span>
    <span class="rail-ghost mono" class:yield={yieldMid}>{formatValue(max, (lo + hi) / 2)}</span>
    <span class="rail-tri lo" aria-hidden="true"></span>
    <span class="rail-tri hi" aria-hidden="true"></span>

    <div class="rail-hz lo" style="clip-path: inset(0 {haveWindow ? (100 - bandL * 100) : 100}% 0 0)"></div>
    <div class="rail-hz hi" style="clip-path: inset(0 0 0 {haveWindow ? (bandR * 100) : 100}%)"></div>

    <canvas class="rail-canvas" bind:this={canvasEl}></canvas>
    </div>

    {#if haveWindow}
      <!-- The window's catalog description rides the band's own tooltip. -->
      <div class="rail-band" title={(windowDesc ? windowDesc + '\n' : '') + 'Drag the window or its edges'}
           class:disabled={!bandEnabled}
           class:pending={!!pend || statusOf(min) !== STATUS.confirmed || statusOf(max) !== STATUS.confirmed}
           role="slider" tabindex={bandEnabled ? 0 : -1}
           aria-label="Stroke window" aria-orientation="horizontal"
           aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={minVal ?? lo}
           aria-valuetext={bandLabel}
           aria-disabled={!bandEnabled}
           data-shadow={pend ? STATUS.pending : worstStatus(statusOf(min), statusOf(max))}
           style="left:{bandL * 100}%; width:{(bandR - bandL) * 100}%"
           onpointerdown={(e) => startDrag('band', e)}
           onpointermove={onDragMove}
           onpointerup={endDrag}
           onpointercancel={endDrag}
           onkeydown={onBandKey}>
        <span class="rail-band-label mono">{spanLabel}</span>
      </div>
      <span class="rail-win lo mono" class:flank={narrow} style="--at:{bandL * 100}%">{flipped ? formatValue(max, maxVal) : formatValue(min, minVal)}</span>
      <span class="rail-win hi mono" class:flank={narrow} style="--at:{bandR * 100}%">{flipped ? formatValue(min, minVal) : formatValue(max, maxVal)}</span>

      <div class="rail-band-handle lo"
           class:disabled={!minEnabled}
           role="slider" tabindex={minEnabled ? 0 : -1}
           aria-label={labelFor(min)} aria-orientation="horizontal"
           aria-valuemin={lo} aria-valuemax={maxVal ?? hi} aria-valuenow={minVal ?? lo}
           aria-valuetext={formatValue(min, minVal) + (unitOf(min) ? ' ' + unitOf(min) : '')}
           aria-disabled={!minEnabled}
           data-shadow={pend && pend.min != null ? STATUS.pending : statusOf(min)}
           style="left:{minPct * 100}%"
           onpointerdown={(e) => startDrag('min', e)}
           onpointermove={onDragMove}
           onpointerup={endDrag}
           onpointercancel={endDrag}
           onkeydown={(e) => onHandleKey(e, 'min')}></div>

      <div class="rail-band-handle hi"
           class:disabled={!maxEnabled}
           role="slider" tabindex={maxEnabled ? 0 : -1}
           aria-label={labelFor(max)} aria-orientation="horizontal"
           aria-valuemin={minVal ?? lo} aria-valuemax={hi} aria-valuenow={maxVal ?? hi}
           aria-valuetext={formatValue(max, maxVal) + (unitOf(max) ? ' ' + unitOf(max) : '')}
           aria-disabled={!maxEnabled}
           data-shadow={pend && pend.max != null ? STATUS.pending : statusOf(max)}
           style="left:{maxPct * 100}%"
           onpointerdown={(e) => startDrag('max', e)}
           onpointermove={onDragMove}
           onpointerup={endDrag}
           onpointercancel={endDrag}
           onkeydown={(e) => onHandleKey(e, 'max')}></div>
    {:else}
      <p class="rail-waiting">waiting for device&hellip;</p>
    {/if}
  </div>

  </div>
</div>

<style>
  /* FLAT, deliberately — the OG hero strip carried no card chrome; the
     outlined panel below (.rail-panel) is where the instrument frame lives.
     One card around both was never the OG look. */
  .hero {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* The rail row: the track's own height whatever fills it, the rail's
     own width, one grid cell for the tape and the plan strip, so the swap
     never moves the rail below it. */
  .rail-row {
    display: flex;
    height: calc(var(--s) * 26px);
  }
  @media (pointer: coarse) {
    .rail-row { height: 40px; }
  }
  .rail-swap {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }
  .swap-face { grid-area: 1 / 1; min-width: 0; }
  .swap-face.off { visibility: hidden; }

  /* No frame of its own: HeroStrip is the bar's surface (DESIGN §10.3). */
  .rail-panel {
    display: flex;
    flex-direction: column;
    gap: calc(var(--s) * 4px);
  }

  /* ---- input tape (disabled command surface) ------------------------------ */
  .rail-tape-assembly { width: 100%; }
  .rail-tape-assembly.disabled { opacity: 0.7; }
  /* Track spans the full assembly width with dashed top/bottom guides — the
     original's "shows where full travel is even when the strip only covers
     the window" landmark. The STRIP (.rail-tape) is what actually commands;
     it is positioned/sized to the window fraction of that same width, in the
     markup above. */
  /* The transparent sides mirror the rail host's 1px border, so the tape's
     percentages land on the ruler's pixels. */
  .rail-tape-track {
    position: relative;
    width: 100%;
    height: calc(var(--s) * 26px);
    border-top: 1px dashed var(--line-1);
    border-bottom: 1px dashed var(--line-1);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    touch-action: none;
    cursor: not-allowed;
  }
  /* The TRACK is the hit-test surface (bug #3 fix) — the whole dashed-guide
     width is tappable, not just the highlighted strip nested inside it, so
     crosshair/focus belong here now rather than on `.rail-tape.live`. */
  .rail-tape-track.live { cursor: crosshair; }
  .rail-tape-track:focus-visible {
    outline: 2px solid var(--intent);
    outline-offset: 2px;
  }
  .rail-tape {
    position: absolute;
    top: 0; bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-s);
    overflow: hidden;
    transition: left .25s ease, width .25s ease;
  }
  /* Disabled (fallback: no move role, or this session may not command) —
     inert gray strip, same shape as the live one so the rhythm survives. */
  .rail-tape:not(.live) {
    background:
      repeating-linear-gradient(90deg, var(--line-2) 0 1px, transparent 1px 7px),
      var(--bg-sunken);
    border: 1px solid var(--line-2);
  }
  /* Live command strip — purely visual now (shows exactly where the window
     sits + carries the pip); the track around it owns the actual pointer
     handling, see tapeTrackEl's note above. Intent-tinted so it visually
     pairs with the window band on the rail below it. */
  .rail-tape.live {
    background:
      repeating-linear-gradient(90deg, rgba(var(--intent-rgb), .10) 0 1px, transparent 1px 7px),
      var(--screen);
    border: 1px solid rgba(var(--intent-rgb), .45);
    box-shadow: inset 0 2px 6px rgba(var(--shade-rgb), .6);
  }
  .rail-tape-assembly.drag-live .rail-tape { transition: none; }
  .rail-tape-micro {
    font-size: max(11px, calc(var(--s) * 9px));
    letter-spacing: 0.18em;
    color: var(--tx-ghost);
    white-space: nowrap;
    text-transform: uppercase;
    pointer-events: none;
  }
  /* A reason reads as the hub's words, whole, in the strip's center. */
  .rail-tape-micro.rail-reason {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: normal;
    text-transform: none;
    color: var(--tx-mut);
  }
  /* Scrub pip — rides under the pointer/setpoint, inside the strip's own
     local coordinate space (matches the original's tapeMm()). */
  .rail-tape-pip {
    position: absolute;
    top: 0; bottom: 0;
    width: 2px;
    transform: translateX(-1px);
    background: var(--intent);
    box-shadow: 0 0 10px rgba(var(--intent-rgb), .7);
    opacity: 0;
    pointer-events: none;
    transition: opacity .1s ease, left .12s ease;
  }
  .rail-tape-pip.on { opacity: 1; }
  .rail-tape-assembly.drag-live .rail-tape-pip { transition: opacity .1s ease; }
  /* ---- rail host ----------------------------------------------------------- */
  .spine-rail-host {
    position: relative;
    height: max(calc(var(--s) * 63px), 66px);
    background: var(--bg-sunken);
    border: 1px solid var(--line-1);
    border-radius: var(--r-s);
    box-shadow: inset 0 2px 8px rgba(var(--shade-rgb), .6);
    touch-action: none;
    cursor: crosshair;
  }
  /* Do not clip the host: the window handles straddle its ends and stay whole
     only outside this layer (ph-n8vs). */
  .rail-clip { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }

  .rail-ruler-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .rail-endcap {
    position: absolute;
    bottom: 2px;
    font-size: max(11px, 0.56rem);
    color: var(--tx-ghost);
    pointer-events: none;
  }
  .rail-endcap.lo { left: 4px; }
  .rail-endcap.hi { right: 4px; }
  .rail-endcap.yield, .rail-ghost.yield { visibility: hidden; }
  /* The mid label rides the endcaps' line, clear of the tick row (ph-hjo). */
  .rail-ghost {
    position: absolute;
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%);
    font-size: max(11px, 0.56rem);
    color: var(--tx-ghost);
    opacity: 0.5;
    pointer-events: none;
  }

  /* Endcap arrows — pure CSS border-triangles, no glyph/asset. */
  .rail-tri {
    position: absolute;
    width: 0; height: 0;
    border-style: solid;
    top: 50%;
    pointer-events: none;
  }
  .rail-tri.lo {
    left: 0;
    transform: translateY(-50%);
    border-width: 4px 0 4px 6px;
    border-color: transparent transparent transparent var(--line-3);
  }
  .rail-tri.hi {
    right: 0;
    transform: translateY(-50%);
    border-width: 4px 6px 4px 0;
    border-color: transparent var(--line-3) transparent transparent;
  }

  /* Hazard keep-out ribbons — whisper-level red hatch outside the window,
     full-track boxes revealed only via clip-path so the hatch never slides
     when a window edge is dragged (matches the original's fix for that).
     Centered on the ruler baseline (45.83% — same 33/72 fraction the ticks'
     baseline line uses above), not dead-center on the host. */
  .rail-hz {
    position: absolute;
    left: 0; right: 0;
    top: 45.83%;
    height: calc(var(--s) * 9px);
    transform: translateY(-50%);
    pointer-events: none;
    background: repeating-linear-gradient(135deg, rgba(var(--bad-rgb), .22) 0 3px, rgba(var(--bad-rgb), .03) 3px 7px);
    transition: clip-path .25s ease;
    z-index: 1;
  }

  .rail-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

  .rail-band {
    position: absolute;
    top: calc(var(--s) * 18px);
    height: calc(var(--s) * 30px);
    background: rgba(var(--intent-deep-rgb), .08);
    border-left: 1px solid var(--intent);
    border-right: 1px solid var(--intent);
    box-shadow: 0 0 14px rgba(var(--intent-deep-rgb), .16), inset 0 0 18px rgba(var(--intent-deep-rgb), .07);
    cursor: grab;
    touch-action: none;
    transition: left .12s ease, width .12s ease;
  }
  .rail-band:active { cursor: grabbing; }
  .rail-band.pending { border-left-style: dashed; border-right-style: dashed; }
  .rail-band.disabled { cursor: not-allowed; opacity: 0.55; }
  /* Programmatic window changes (echo/adoption) ease in; a LIVE drag must
     track the pointer 1:1 with zero lag, so drag-live kills the transition
     on the band and its handles for as long as a drag is in flight (mirrors
     the original's "instant during drag" rule). The move tape's own cursor
     gets the identical treatment via .rail-tape-assembly.drag-live above. */
  .drag-live .rail-band,
  .drag-live .rail-band-handle { transition: none; }

  /* The span pill: a plate in the band's center, gone when the band is
     narrower than the plate. */
  .rail-band { container-type: inline-size; }
  .rail-band-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 1px 6px;
    border-radius: var(--r-s);
    background: var(--bg-sunken);
    font-size: max(11px, 0.6rem);
    color: var(--intent);
    white-space: nowrap;
    pointer-events: none;
  }
  @container (max-width: 84px) { .rail-band-label { display: none; } }
  /* The window's edge values on the axis row; a narrow band flanks them
     outward so they never overlap. */
  .rail-win {
    position: absolute;
    bottom: 2px;
    left: clamp(2.2em, var(--at), calc(100% - 2.2em));
    transform: translateX(-50%);
    font-size: max(11px, 0.56rem);
    color: var(--intent);
    pointer-events: none;
  }
  .rail-win.flank.lo { left: max(var(--at), 3.2em); transform: translateX(-100%); }
  .rail-win.flank.hi { left: min(var(--at), calc(100% - 3.2em)); transform: none; }
  /* Handles are siblings of the band (not nested — each positions from its own
     independent pct so a keyboard nudge on one never has to touch the other's
     DOM), so top/height are set here in the SAME host-relative units as the
     band's own (18px top, 30px height, both scaled by --s) plus the OG's
     2px/4px overshoot — a 12px-wide hit zone straddling the band edge,
     centered horizontally on `left` (set inline per handle from minPct/
     maxPct) via translateX. */
  .rail-band-handle {
    position: absolute;
    top: calc(var(--s) * 16px);
    height: calc(var(--s) * 34px);
    width: calc(var(--s) * 12px);
    transform: translateX(-50%);
    cursor: ew-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: left .12s ease;
  }
  /* The OG 12px zone is a mouse-era number. On a touch screen the INVISIBLE
     hit area widens to the tap floor — the 3px visible bar is unchanged, so
     1:1 fidelity holds while a fingertip can still find the edge. Band,
     handles and scrub track also reach the 40px floor, grown about the
     band's own center line (--s * 33px) so nothing visible shifts. */
  @media (pointer: coarse) {
    .rail-band-handle { width: var(--tap); top: calc(var(--s) * 33px - 21px); height: 42px; }
    .rail-band { top: calc(var(--s) * 33px - 20px); height: 40px; }
    .rail-tape-track { height: 40px; }
  }
  .rail-band-handle::before {
    content: '';
    width: 3px;
    height: calc(var(--s) * 16px);
    background: var(--intent);
    box-shadow: 0 0 8px rgba(var(--intent-rgb), .65);
  }
  .rail-band-handle.disabled::before { background: var(--tx-ghost); box-shadow: none; }

  .rail-waiting {
    position: absolute;
    inset: 0;
    max-width: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tx-ghost);
    font-size: 0.8rem;
    margin: 0;
  }

</style>
