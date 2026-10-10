<script>
  /**
   * LinkBar.svelte -- the top bar: ONE row of fixed height (operator
   * 2026-10-02). Left: the activity heatmap and the hub name. Right: the
   * chips (phase, tier, the render warning's held slot, fps, rx), then the
   * shell's window buttons at the far end, shell only. The bar is the Tauri
   * drag region. A reading nobody checks when something goes wrong lives in
   * the Health view instead (the address, the firmware, the control list;
   * DESIGN §10.3, operator 2026-10-10).
   *
   * Constraints:
   * - Never claims a healthier link than machine.link.phase reports (Ground
   *   Truth Doctrine). The phase chip is the one live indicator; a dead link
   *   and a link error are said in words by TopStrip's status slot, never as
   *   a line added here.
   * - Phase and tier are the last chips to shed at any width.
   * - Shell shading (--shell-*) applies only when `shell` is set; the served
   *   page has no shell chrome.
   * - The ends clear the screen's rounded corners, and beside a top cutout
   *   the row takes the band and lays out left and right of it (style.css,
   *   the inset vars); nothing in the row may overlap the cutout.
   * - Reads machine.* and the catalog's own role-tagged fields, never a
   *   device fact the machine did not send.
   * - Every chip value is mono; only a chip that reports measured liveness
   *   (phase, rx) may wear the reality tone. No tooltip repeats its text
   *   (docs/COPY.md rule 4): the name carries one only while ellipsized.
   */
  import { untrack } from 'svelte';
  import { isStill } from './still.svelte.js';
  import { machine } from '../model/machine.svelte.js';
  import { ACCESS_NAME } from '../../../Valence/clients/js/index.js';
  import { since, hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import { ac } from '../model/theme.js';
  import { phoneMenu } from './PhoneMenu.svelte';

  // shell: the shell's window buttons (src/shell/ShellStrip.svelte), or null.
  let { shell: Shell = null } = $props();

  /** Presentation only — every phase machine.link.phase can actually be. */
  const PHASE = {
    idle: { label: 'idle', tone: 'dim' },
    connecting: { label: 'connecting…', tone: 'warn' },
    handshaking: { label: 'handshaking…', tone: 'warn' },
    live: { label: 'live', tone: 'good' },
    retrying: { label: 'reconnecting…', tone: 'warn' },
    failed: { label: 'no link', tone: 'bad' },
  };

  // A virtual session never reads as a live machine.
  const phaseInfo = $derived(machine.link.virtual && machine.link.phase === 'live' ? { label: 'virtual', tone: 'warn' }
    : PHASE[machine.link.phase] || { label: String(machine.link.phase), tone: 'dim' });
  const isLive = $derived(machine.link.phase === 'live');
  const hasSession = $derived(machine.link.sessionId != null);
  const tierLabel = $derived(hasSession
    ? (ACCESS_NAME[machine.link.roles] || ('tier ' + machine.link.roles))
    : '--');

  const identity = $derived(machine.link.hubIdentity);
  const nameField = $derived(machine.catalog.model?.byRole?.get(ROLE.identityName)?.[0]);
  const title = $derived(hubTitle(identity,
    nameField ? reportedValue(nameField, machine.samples[nameField.channelId]) : '', machine.link.virtual));

  // A liveness readout needs a clock of its own — nothing else in this bar
  // re-renders on a schedule, so without a tick "since(...)" would freeze the
  // instant a frame stops arriving, which is exactly the moment it matters most.
  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { nowTick = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  function ageLabel(ms, _tick) { return since(ms); }
  const rxAge = $derived(ageLabel(machine.stats.lastRxMs, nowTick));
  const rxTone = $derived.by(() => {
    if (!isLive || !machine.stats.lastRxMs) return 'dim';
    const age = nowTick - machine.stats.lastRxMs;
    if (age < 1500) return 'good';
    if (age < 3000) return 'warn';
    return 'bad';
  });
  const rxToneLabel = $derived(
    rxTone === 'good' ? 'flowing' : rxTone === 'warn' ? 'gapping' : rxTone === 'bad' ? 'stalled' : 'no data'
  );

  // Render health, published by whichever widget owns the rAF loop. This is
  // the instrument for "position telemetry jitters in one shell but not the
  // other": fps is the WEBVIEW's frame cadence, held% is how often the render
  // instant outran the newest sample. Low fps blames the shell, a high held%
  // at a healthy fps blames arrivals, which the position-rate heatmap row
  // then shows directly. `--` until a rail is on screen and drawing. The bar
  // says fps; the held share and the clock skew show only when bad (held
  // over 10 %, skew over 2 ms), in a slot held for them; the rest is the tooltip.
  const render = $derived(machine.stats.render);
  const heldBad = $derived(render.fps != null && render.heldPct > 10);
  const skewBad = $derived(render.fps != null && Math.abs(render.skewMs || 0) > 2);
  const renderWarn = $derived([heldBad ? render.heldPct + '% held' : '', skewBad ? 'skew ' + render.skewMs + ' ms' : ''].filter(Boolean).join(' · '));
  const renderTip = $derived(render.fps == null ? undefined : [
    'Smoothing delay ' + render.delayMs + ' ms',
    'No newer sample to draw: ' + render.heldPct + '% of frames',
    'Frame clock off wall clock by ' + Math.abs(render.skewMs || 0) + ' ms',
  ].join('\n'));
  // The client's own frame health: warn when degraded, never the reality
  // tone, which is the machine's liveness (ph-51k).
  const fpsTone = $derived(render.fps != null && render.fps < 30 ? 'warn' : 'dim');

  // Beside a top cutout the row rises into its band only while the phase and
  // tier chips fit right of it, clear of the top right corner's arc; short of
  // that the bar pads under the inset as without one, until the next resize
  // or cutout change (style.css).
  let barEl = $state(null), pinnedEl = $state(null), besideCut = $state(true);
  $effect(() => {
    if (!barEl || !pinnedEl) return;
    const root = document.documentElement;
    const check = () => {
      if (!besideCut || !root.hasAttribute('data-cutout-top')) return;
      const p = pinnedEl.getBoundingClientRect(), R = parseFloat(getComputedStyle(root).getPropertyValue('--corner-tr')) || 0;
      const dx = p.right - (innerWidth - R), dy = R - p.top;
      if (p.right > innerWidth || (dx > 0 && dy > 0 && Math.hypot(dx, dy) > R)) besideCut = false;
    };
    const retry = () => { besideCut = true; requestAnimationFrame(check); };
    const ro = new ResizeObserver(check);
    ro.observe(barEl);
    ro.observe(pinnedEl);
    const mo = new MutationObserver(retry);
    mo.observe(document.documentElement, { attributeFilter: ['data-cutout-top'] });
    addEventListener('resize', retry);
    requestAnimationFrame(check);
    return () => { ro.disconnect(); mo.disconnect(); removeEventListener('resize', retry); };
  });

  /** The full text as a tooltip only while the bar ellipsizes it; a new `text` re-runs it. */
  const fullTitle = (text) => (el) => {
    void text;
    const set = () => { el.title = el.scrollWidth > el.clientWidth + 0.5 ? el.textContent : ''; };
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => ro.disconnect();
  };

  // ===========================================================================
  // Activity heatmap — rows = live telemetry series discovered by ROLE, plus a
  // link-activity row derived from protocol stats (never device knowledge:
  // the roles are registry vocabulary and machine.stats is protocol-level).
  // A machine that publishes none of the telemetry roles simply gets the one
  // link-activity row — never a fabricated series.
  // ===========================================================================
  const heatRows = $derived.by(() => {
    const rows = [];
    const byRole = machine.catalog.model && machine.catalog.model.byRole;
    if (byRole) {
      // Two RATE rows before the magnitude rows: telemetry cadence is per
      // channel, and "position stutters" is answered by seeing the position
      // channel's own arrival rate next to another live channel's. Both
      // decline when the machine does not publish the role.
      const pos = byRole.get(ROLE.telemetryPosition);
      if (pos && pos.length) rows.push({ key: 'pos-rate', kind: 'rate', label: 'position rate', field: pos[0] });
      const plan = byRole.get(ROLE.planCurrent) || byRole.get(ROLE.planStart);
      if (plan && plan.length) rows.push({ key: 'plan-rate', kind: 'rate', label: 'plan rate', field: plan[0] });
      const vel = byRole.get(ROLE.telemetryVelocity);
      if (vel && vel.length) rows.push({ key: 'vel', label: 'velocity', field: vel[0] });
      const cur = byRole.get(ROLE.telemetryCurrent);
      if (cur && cur.length) rows.push({ key: 'cur', label: 'current', field: cur[0] });
      const pwr = byRole.get(ROLE.telemetryPowerBus);
      if (pwr && pwr.length) rows.push({ key: 'pwr', label: 'bus power', field: pwr[0] });
    }
    rows.push({ key: 'link', kind: 'rate', label: 'link activity', field: null });
    return rows;
  });

  const heatmapAriaLabel = $derived(
    'Activity heatmap, last ~3 seconds. Rows: ' + heatRows.map((r) => r.label).join(', ') + '.'
  );

  const AG_COLS = 14, AG_CELL = 4, AG_GAP = 1;
  let heatCanvas = $state(null);
  // The tooltip names the row under the pointer.
  let heatRow = $state(0);
  const heatTip = $derived.by(() => {
    const l = (heatRows[heatRow] || heatRows[0]).label;
    return l[0].toUpperCase() + l.slice(1) + ', last 3 s: brighter is busier';
  });

  $effect(() => {
    const rows = heatRows;             // establishes the reactive dependency
    const canvas = heatCanvas;
    if (!canvas || typeof window === 'undefined') return;

    // A `let`, not a one-time const: this effect only re-runs when heatRows
    // changes (rare, catalog-driven), so a mid-session preference flip must
    // reach `tick()` (below, on its own setInterval) some other way — the
    // media-query listener updates this closure variable live (T25).

    const dpr = window.devicePixelRatio || 1;
    const cssW = AG_COLS * (AG_CELL + AG_GAP);
    const cssH = rows.length * (AG_CELL + AG_GAP + 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Bounded history buffer, newest column last.
    let data = [];
    for (let c = 0; c < AG_COLS; c++) data.push(rows.map(() => 0));

    // Adaptive per-row ceilings: a field with a catalog-declared max scales
    // against that (ground truth); a field with none — or the link-activity
    // row, which has no "max" at all — scales against a slowly-decaying
    // observed peak, so "fully lit" always means "near this row's own recent
    // peak" rather than a guessed, device-specific number.
    const peaks = {};
    // untrack: see the note on the first paint below. This seed read is in the
    // effect body itself, so tracking it re-runs the whole effect on every
    // telemetry frame and the history buffer above never survives a tick.
    const lastCount = untrack(() => {
      const seed = {};
      for (const r of rows) {
        seed[r.key] = r.field
          ? (machine.stats.pushesByChannel[r.field.channelId] || 0)
          : machine.stats.statePushes;
      }
      return seed;
    });

    function sampleFrac(row) {
      if (row.kind === 'rate') {
        const cur = row.field
          ? (machine.stats.pushesByChannel[row.field.channelId] || 0)
          : machine.stats.statePushes;
        const delta = Math.max(0, cur - (lastCount[row.key] || 0));
        lastCount[row.key] = cur;
        const ceiling = Math.max((peaks[row.key] || 1) * 0.995, delta, 1);
        peaks[row.key] = ceiling;
        return Math.min(1, delta / ceiling);
      }
      const sample = machine.samples[row.field.channelId];
      const raw = sample ? sample[row.field.name] : null;
      if (typeof raw !== 'number' || !isFinite(raw)) return 0;
      const abs = Math.abs(raw);
      let ceiling;
      if (isFinite(row.field.max) && row.field.max > 0) {
        ceiling = Math.abs(row.field.max);
      } else {
        ceiling = Math.max((peaks[row.key] || 0) * 0.995, abs, 1e-6);
        peaks[row.key] = ceiling;
      }
      return Math.min(1, abs / ceiling);
    }

    function draw() {
      ctx.clearRect(0, 0, cssW, cssH);
      for (let c = 0; c < AG_COLS; c++) {
        for (let r = 0; r < rows.length; r++) {
          const v = data[c][r];
          const a = Number((0.06 + v * 0.85).toFixed(2));
          ctx.fillStyle = ac('r', a);
          ctx.fillRect(c * (AG_CELL + AG_GAP), r * (AG_CELL + AG_GAP + 1), AG_CELL, AG_CELL);
        }
      }
    }

    function tick() {
      const frame = rows.map(sampleFrac);
      if (isStill()) {
        // Freeze the scroll animation but keep painting current values: every
        // column shows the same live reading instead of a moving history, so
        // the grid holds still while still being honest about "now".
        data = data.map(() => frame.slice());
      } else {
        data.shift();
        data.push(frame);
      }
      draw();
    }

    // The first paint MUST be untracked. sampleFrac() reads machine.stats and
    // machine.samples, and a read made synchronously inside an effect becomes
    // that effect's dependency — so a tracked first tick re-runs this whole
    // body on every telemetry frame, re-declaring `data` and refilling it with
    // zeros ~25x a second. The grid still scrolls; it just has no history left
    // to scroll, so every column but the newest reads empty. The interval's
    // own ticks are untracked by construction (async, outside the scope).
    untrack(tick);
    const id = setInterval(tick, 220);
    return () => { clearInterval(id); };
  });
</script>

<!-- "deep": empty bar space drags the undecorated shell window; buttons and
     other clickables opt out on their own (Tauri drag.js). -->
<header class="linkbar" class:shell={!!Shell} class:cut={besideCut} data-tauri-drag-region="deep" bind:this={barEl}>
  <div class="header-left">
    <!-- The phone menu (DESIGN §10.12): the sidebar as a drawer, buckets 1 and 2. -->
    {#if phoneMenu.shown}
      <button type="button" class="menu-btn" aria-label="Menu" title="Menu" aria-expanded={phoneMenu.open}
              onclick={() => (phoneMenu.open = !phoneMenu.open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
      </button>
    {/if}
    <canvas bind:this={heatCanvas} class="act-grid" role="img" aria-label={heatmapAriaLabel} title={heatTip}
            onpointermove={(e) => (heatRow = Math.min(heatRows.length - 1, Math.floor(e.offsetY / (AG_CELL + AG_GAP + 1))))}></canvas>
    <span class="wordmark" {@attach fullTitle(title)}>{title}</span>
  </div>

  <!-- ONE flat row of equal chips (OG). Phase and tier lead it and never
       shed: they are the two safety-relevant reads. The rest shed from the
       tail, before the hub name ellipsizes. -->
  <div class="chips pinned" bind:this={pinnedEl}>
    <span class="chip tone-{phaseInfo.tone}" role="status" aria-live="polite">
      <span class="chip-dot"></span><span class="mono">{phaseInfo.label}</span>
    </span>
    <span class="chip">
      <span class="chip-lbl">tier</span><span class="mono">{tierLabel}</span>
    </span>
  </div>
  <div class="chips opt">
    <span class="render-warn">
      {#if renderWarn}<span class="chip tone-warn" title={renderTip}><span class="mono">{renderWarn}</span></span>{/if}
    </span>
    <span class="chip chip-opt tone-{fpsTone}" title={renderTip}>
      <span class="mono fps">{render.fps == null ? '-- fps' : render.fps + ' fps'}</span>
    </span>
    <span class="chip chip-opt-last tone-{rxTone}" aria-label={'telemetry: ' + rxToneLabel}>
      <span class="chip-lbl">rx</span>
      <span class="mono rx-age">{rxAge}</span>
    </span>
  </div>
  {#if Shell}<Shell />{/if}
</header>

<style>
  /* Positioned by its parent, TopStrip.svelte; never sticky on its own.
     ONE row, fixed height: nothing in it may add a line. It owns the notch
     inset (--chrome-inset-top, style.css), the one bar that does. */
  /* The rule under the bar is an inset shadow, not a border, so the window
     buttons get the bar's full height. */
  .linkbar {
    /* --it: the row's distance from the screen's top edge. The ends clear the
       screen's rounded corners: R - it bounds the arc for a row that far down. */
    --it: var(--chrome-inset-top, 0px);
    --row: 32px;
    --pl: max(var(--gap), var(--corner-tl, 0px) - var(--it));
    --pr: max(var(--gap), var(--corner-tr, 0px) - var(--it));
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: calc(var(--row) + var(--it));
    padding: var(--it) var(--pr) 0 var(--pl);
    background: var(--bg-raised);
    box-shadow: inset 0 -1px 0 var(--line);
  }
  @media (pointer: coarse) {
    .linkbar { --row: 40px; }
  }
  /* A top cutout (style.css): the row rises into the band beside it, the
     left group ending short of it and the chips starting past it. */
  :global(:root[data-cutout-top]) .linkbar.cut { --it: 0px; height: max(var(--row), var(--cutout-h, 0px)); }
  :global(:root[data-cutout-top]) .cut .header-left {
    flex: none;
    width: calc(var(--cutout-l, 0px) - var(--pl) - var(--sp-3));
    margin-right: calc(var(--cutout-w, 0px) + var(--sp-3));
  }
  /* Shell chrome: the operator's window, not the machine's UI. The window
     buttons sit flush at the right edge; a phone shell has none. */
  .linkbar.shell {
    background: var(--shell-bg);
    color: var(--shell-fg);
    box-shadow: inset 0 -1px 0 var(--shell-border);
  }
  .linkbar.shell:has(:global(.sb-win)) { padding-right: 0; }

  /* A 40 px target in a 32 or 40 px bar: it overhangs the bar's box, never grows it. */
  .menu-btn {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-block: calc(var(--sp-2) * -1);
    margin-inline: calc(var(--gap) * -1 + var(--sp-1)) calc(var(--sp-2) * -1);
    color: var(--ink);
    border-radius: var(--r-s);
  }
  .menu-btn[aria-expanded='true'] { color: var(--highlight); }
  /* At the screen's top edge beside a cutout: the ring stays inside the target. */
  .menu-btn:focus-visible { outline-offset: -2px; }
  .menu-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }

  /* Shrinks after the optional chips have shed; the name ellipsizes on its
     own. Never a clipping box: the hamburger overhangs it to keep its full
     40 px target. */
  .header-left {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex: 0 1 auto;
    min-width: 6ch;
  }

  .act-grid {
    image-rendering: pixelated;
    flex: 0 0 auto;
    border-radius: 1px;
  }

  /* OG .wordmark: Chakra Petch 500 at 1rem, NOT mono/700. The
     letter-spacing is --s-scaled so the mark tracks the global control scale
     rather than the font size. */
  .wordmark {
    font-family: var(--font);
    font-weight: 500;
    font-size: 1rem;
    letter-spacing: calc(var(--s) * 1px);
    color: var(--ink-hi);
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---- chips: ONE flat right-justified row ---- */
  .chips {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .chips.pinned { flex: none; margin-left: auto; }
  /* Whatever does not fit on the one line wraps below a clipped edge, so the
     optional chips shed from their tail at ANY width, first in the bar. */
  .chips.opt {
    gap: 2em var(--sp-2);
    min-width: 0;
    flex: 0 1000 auto;
    flex-wrap: wrap;
    max-height: 1.5em;
    overflow: hidden;
  }
  .chips.opt:empty { display: none; }

  /* OG .chip (.62rem/400/3px 6px/--chip/--chip-line/--tx-val). Every chip
     wears these exact metrics; a chip that matters more says so with its tone
     and its position in the row, never by being bolder. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: .62rem;
    font-weight: 400;
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--radius);
    background: var(--chip);
    border: 1px solid var(--chip-line);
    color: var(--tx-val);
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .chip-lbl {
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: .04em;
    font-size: .62rem;
  }
  /* Shell chrome keeps 4.5:1 text (style.css --shell-*). */
  .linkbar.shell .chip-lbl { color: var(--tx-val); }
  /* Fixed slots: a reading that changes moves no neighbor (DESIGN §10.3). The
     render warning's slot is held while empty; two warnings ellipsize, the
     tooltip has both. */
  .rx-age { min-width: 3ch; }
  .fps { width: 7ch; text-align: right; }
  /* First on the line, it cannot wrap away: squeezed (a narrow window), it narrows and its chip ellipsizes.
     Where the optional chips shed it stays, empty and zero wide, so rx after it wraps away whole. */
  .render-warn { flex: 0 1 auto; min-width: 0; display: flex; justify-content: flex-end; width: calc(11ch + 2 * var(--sp-2) + 2px); font: .62rem var(--mono); }
  .render-warn .chip { min-width: 0; max-width: 100%; }
  .render-warn .mono { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex: 0 0 auto;
  }

  /* Tone rides the text color plus a tinted border: the border tint is the
     second, non-color-dependent channel. */
  .chip.tone-good { border-color: color-mix(in srgb, var(--good) 45%, var(--chip-line)); color: var(--good); }
  .chip.tone-warn { border-color: color-mix(in srgb, var(--warn) 45%, var(--chip-line)); color: var(--warn-ink, var(--warn)); }
  .chip.tone-bad  { border-color: color-mix(in srgb, var(--bad) 45%, var(--chip-line)); color: var(--bad-ink); }
  .chip.tone-good .mono { color: var(--good); }
  .chip.tone-warn .mono { color: var(--warn-ink, var(--warn)); }
  .chip.tone-bad  .mono { color: var(--bad-ink); }

  /* Narrow viewports shed chips from the tail. Marked by class, not
     :nth-child: a positional selector retargets when a chip turns conditional. */
  @media (max-width: 560px) {
    .chip-opt { display: none; }
    .render-warn { width: 0; }
    .render-warn > * { display: none; }
  }
  /* Handheld: the heatmap (decor) goes before the name ellipsizes. */
  @media (max-width: 479px) { .act-grid { display: none; } }
  @media (max-width: 400px) {
    .chip-opt-last { display: none; }
    .chips.opt { display: none; }
    .wordmark { font-size: .82rem; }
    .header-left { min-width: 0; }
  }
</style>
