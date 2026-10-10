<script>
  /**
   * LinkBar.svelte -- the top bar: ONE row of fixed height (operator
   * 2026-10-02). Left: the channel heatmap and the hub name. Right: the
   * chips (phase, tier, rx, the render warning's held slot, fps), then the
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
  import { machine } from '../model/machine.svelte.js';
  import { ACCESS_NAME } from '../../../Valence/clients/js/index.js';
  import { sinceShort, hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import { phoneMenu } from './PhoneMenu.svelte';
  import ChannelHeat from './ChannelHeat.svelte';

  // shell: the shell's window buttons (src/shell/ShellStrip.svelte), or null.
  // onheat(key): a heatmap block was clicked (ChannelHeat's onopen).
  let { shell: Shell = null, onheat = null } = $props();

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
  // re-renders on a schedule, so without a tick "sinceShort(...)" would freeze the
  // instant a frame stops arriving, which is exactly the moment it matters most.
  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { nowTick = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  function ageLabel(ms, _tick) { return sinceShort(ms); }
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
  // at a healthy fps blames arrivals, which the heatmap's channel blocks
  // then show directly. `--` until a rail is on screen and drawing. The bar
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
  // The client's own frame health: warn when any reading is degraded, never
  // the reality tone, which is the machine's liveness (ph-51k).
  const fpsTone = $derived(render.fps != null && (render.fps < 30 || heldBad || skewBad) ? 'warn' : 'dim');

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
</script>

<!-- "deep": empty bar space drags the undecorated shell window; buttons and
     other clickables opt out on their own (Tauri drag.js). -->
<header class="linkbar" class:shell={!!Shell} class:cut={besideCut} data-tauri-drag-region="deep" bind:this={barEl}>
  <div class="header-left">
    <!-- The phone menu (DESIGN §10.12): the sidebar as a drawer, buckets 1 and 2. -->
    {#if phoneMenu.shown}
      <button type="button" class="menu-btn" aria-label="Menu" data-tip="Menu" aria-expanded={phoneMenu.open}
              onclick={() => (phoneMenu.open = !phoneMenu.open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
      </button>
    {/if}
    <ChannelHeat onopen={onheat} />
    <span class="wordmark" data-tip={title}>{title}</span>
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
    <!-- Zero wide and first on the line, so every chip after it wraps away whole. -->
    <span class="opt-lead"></span>
    <span class="chip chip-opt-last tone-{rxTone}" aria-label={'telemetry: ' + rxToneLabel}>
      <span class="chip-lbl">rx</span>
      <span class="mono rx-age">{rxAge}</span>
    </span>
    <span class="render-warn chip-opt">
      {#if renderWarn}<span class="chip tone-warn" data-tip={renderTip}><span class="mono">{renderWarn}</span></span>{/if}
    </span>
    <span class="chip chip-opt tone-{fpsTone}" data-tip={renderTip}>
      <span class="mono fps">{render.fps == null ? '-- fps' : render.fps + ' fps'}</span>
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
  /* Fixed slots: a reading that changes moves no neighbor (DESIGN §10.3). rx
     is at most 3 characters (sinceShort); the render warning's slot is held
     while empty; two warnings ellipsize, the tooltip has both. */
  .rx-age { width: 3ch; }
  .fps { width: 7ch; text-align: right; }
  /* The gap after it cancelled: the lead takes no room at all. */
  .opt-lead { flex: none; width: 0; margin-right: calc(var(--sp-2) * -1); }
  .render-warn { flex: none; display: flex; justify-content: flex-end; width: calc(11ch + 2 * var(--sp-2) + 2px); font: .62rem var(--mono); }
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
  }
  @media (max-width: 400px) {
    .chip-opt-last { display: none; }
    .chips.opt { display: none; }
    .wordmark { font-size: .82rem; }
    .header-left { min-width: 0; }
  }
</style>
