<script>
  /**
   * LinkBar.svelte -- the top bar: ONE row of fixed height (operator
   * 2026-10-02). Left: the channel heatmap, the hub name and the link dot.
   * Right: the chips (auth, data rate, loss, fps), then the shell's window
   * buttons at the far end, shell only. The bar is the Tauri
   * drag region. A reading nobody checks when something goes wrong lives in
   * the Health view instead (the address, the firmware, the control list;
   * DESIGN §10.3, operator 2026-10-10).
   *
   * Constraints:
   * - Never claims a healthier link than machine.link.phase reports (Ground
   *   Truth Doctrine). The dot is the one live indicator; a dead link
   *   and a link error are said in words by TopStrip's status slot, never as
   *   a line added here. The dot's state is also its tooltip and its status
   *   text, never color alone.
   * - The dot and the auth chip never shed; the rest shed from the tail.
   * - The dot's ripple is a decoration behind the row: out of flow, vertically
   *   clipped to the row, motion off under html.still. No timer runs while the
   *   link is down: the one 250 ms interval is the data rate's, live only.
   * - Shell shading (--shell-*) applies only when `shell` is set; the served
   *   page has no shell chrome.
   * - The ends clear the screen's rounded corners, and beside a top cutout
   *   the row takes the band and lays out left and right of it (style.css,
   *   the inset vars); nothing in the row may overlap the cutout.
   * - Reads machine.* and the catalog's own role-tagged fields, never a
   *   device fact the machine did not send.
   * - Every chip value is mono; only the rate chip, which reports measured
   *   liveness, may wear the reality tone. No tooltip repeats its text
   *   (docs/COPY.md rule 4): the name carries one only while ellipsized.
   * - The rate reads the hub session's socket only (activity.js totals); a
   *   loss value the machine has not reported reads '--', never a guess.
   */
  import { machine } from '../model/machine.svelte.js';
  import { ACCESS_NAME } from '../../../Valence/clients/js/index.js';
  import { hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import { phoneMenu } from './PhoneMenu.svelte';
  import ChannelHeat from './ChannelHeat.svelte';
  import { totals } from '../model/activity.js';
  import { SAMPLE_MS, rateMeter, fmtRate, fmtNum, dotState } from '../model/linkbar.js';

  // shell: the shell's window buttons (src/shell/ShellStrip.svelte), or null.
  // onheat(key): a heatmap block was clicked (ChannelHeat's onopen).
  let { shell: Shell = null, onheat = null } = $props();

  /** The dot's words, one per machine.link.phase. */
  const PHASE_WORD = {
    idle: 'Not connected',
    connecting: 'Connecting',
    handshaking: 'Connecting',
    live: 'Live',
    retrying: 'Reconnecting',
    failed: 'No link',
  };

  const isLive = $derived(machine.link.phase === 'live');
  const hasSession = $derived(machine.link.sessionId != null);
  const authLabel = $derived(hasSession
    ? (ACCESS_NAME[machine.link.roles] || ('tier ' + machine.link.roles))
    : '--');

  const identity = $derived(machine.link.hubIdentity);
  const nameField = $derived(machine.catalog.model?.byRole?.get(ROLE.identityName)?.[0]);
  const title = $derived(hubTitle(identity,
    nameField ? reportedValue(nameField, machine.samples[nameField.channelId]) : '', machine.link.virtual));

  // The data rate's clock, and the only timer in this bar: 250 ms, live only. It also ages the
  // rx tone and the tooltips, which nothing else re-renders on a schedule.
  let nowTick = $state(Date.now());
  let rate = $state(null);
  $effect(() => {
    if (!isLive) { rate = null; return; }
    const meter = rateMeter();
    // A local clock: reading nowTick here would make this effect depend on it and restart the meter every tick.
    const tick = () => { const t = Date.now(); nowTick = t; rate = meter.sample(t, totals.rx, totals.tx); };
    tick();
    const id = setInterval(tick, SAMPLE_MS);
    return () => clearInterval(id);
  });
  const rxTone = $derived.by(() => {
    if (!isLive || !machine.stats.lastRxMs) return 'dim';
    const age = nowTick - machine.stats.lastRxMs;
    if (age < 1500) return 'good';
    if (age < 3000) return 'warn';
    return 'bad';
  });
  const ago = (ms) => { const s = Math.max(0, nowTick - ms) / 1000; return s < 60 ? s.toFixed(1) + ' s' : Math.round(s / 60) + ' min'; };
  const down = $derived(rate ? fmtRate(rate.rx) : '--');
  const up = $derived(rate ? fmtRate(rate.tx) : '--');
  const rateName = $derived(rate ? 'Data rate: down ' + down + ' kilobytes per second, up ' + up + ' kilobytes per second' : 'Data rate: no link');
  const rateTip = $derived(rate ? [
    'Down ' + down + ' KB/s: from the machine',
    'Up ' + up + ' KB/s: to the machine',
    'This session only, averaged over 1 s',
    machine.stats.lastRxMs ? 'Last frame ' + ago(machine.stats.lastRxMs) + ' ago' : 'No frame yet',
  ].join('\n') : 'No link');

  // The link dot: the state in words for the tooltip and the status text.
  const dotCls = $derived(dotState(machine.link.phase, machine.link.stale));
  const dotWord = $derived(machine.link.virtual && dotCls === 'live' ? 'Virtual'
    : dotCls === 'stale' ? 'Stale' : PHASE_WORD[machine.link.phase] || String(machine.link.phase));
  const dotTip = $derived(dotCls === 'live' ? (machine.link.virtual ? 'Virtual: a simulated machine' : 'Live: frames arriving')
    : dotCls === 'stale' ? 'Stale: no frames for ' + ago(machine.stats.lastRxMs) : dotWord);

  // The loss readout (machine.stats.link, the link-loss model): a value not reported reads '--'.
  const loss = $derived(machine.stats.link);
  const lossClient = $derived(loss?.clientLossPct ?? null);
  const lossMachine = $derived(loss?.machine?.lossPct ?? null);
  const pct = (v) => (v == null ? 'no reading' : fmtNum(v) + '%');
  const lossName = $derived('Loss: this app ' + pct(lossClient) + ', machine ' + pct(lossMachine));
  const lossTip = $derived([
    'This app: ' + pct(lossClient) + ' of the machine\'s frames lost',
    'Machine: ' + pct(lossMachine) + ' of this app\'s frames lost',
    'Machine retries: ' + pct(loss?.machine?.retryPct ?? null) + ' of its sends',
    'Machine Wi-Fi: ' + (loss?.machine?.rssiDbm == null ? 'no reading' : loss.machine.rssiDbm + ' dBm'),
  ].join('\n'));

  // Render health, published by whichever widget owns the rAF loop. This is
  // the instrument for "position telemetry jitters in one shell but not the
  // other": fps is the WEBVIEW's frame cadence. A rail that stalls for want of
  // a newer sample and a drifting frame clock are Health conditions
  // (rail-stalled, clock-drift) read in the status slot; this chip never
  // carries them. `--` until a rail is on screen and drawing.
  const render = $derived(machine.stats.render);
  const renderTip = $derived(render.fps == null ? undefined : [
    'Frame rate ' + render.fps + ' fps',
    'Rail draws ' + render.delayMs + ' ms behind, to smooth arrivals',
  ].join('\n'));
  // The client's own frame health, never the reality tone, which is the
  // machine's liveness (ph-51k).
  const fpsTone = $derived(render.fps != null && render.fps < 30 ? 'warn' : 'dim');

  // Beside a top cutout the row rises into its band only while the auth
  // chip fits right of it, clear of the top right corner's arc; short of
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
    <!-- The link dot: state by class (live, connecting, stale, offline), words by tooltip and status text.
         The ripple's clip is a row-high band behind the row's content (see .rclip). -->
    <span class="linkdot {dotCls}" class:virtual={!!machine.link.virtual} role="status" data-tip={dotTip}>
      <span class="rclip" aria-hidden="true"><span class="ripple"></span></span>
      <span class="core" aria-hidden="true"></span>
      <span class="sr">Link: {dotWord}</span>
    </span>
  </div>

  <!-- ONE flat row of equal chips (OG). Auth leads it and never sheds: it is the
       safety-relevant read. The rest shed from the tail, before the hub name ellipsizes. -->
  <div class="chips pinned" bind:this={pinnedEl}>
    <span class="chip">
      <span class="chip-lbl">auth:</span><span class="mono auth">{authLabel}</span>
    </span>
  </div>
  <div class="chips opt">
    <!-- Zero wide and first on the line, so every chip after it wraps away whole. -->
    <span class="opt-lead"></span>
    <span class="chip chip-opt-last tone-{rxTone}" role="img" aria-label={rateName} data-tip={rateTip}>
      <svg class="arrow" viewBox="0 0 8 10" aria-hidden="true"><path d="M4 1v8M1 6l3 3 3-3" /></svg>
      <span class="mono rv">{down}</span>
      <svg class="arrow" viewBox="0 0 8 10" aria-hidden="true"><path d="M4 9V1M1 4l3-3 3 3" /></svg>
      <span class="mono rv">{up}</span>
      <span class="chip-lbl unit">KB/s</span>
    </span>
    <span class="chip chip-opt" role="img" aria-label={lossName} data-tip={lossTip}>
      <span class="chip-lbl">loss</span>
      <span class="mono lv">{fmtNum(lossClient)}</span><span class="mono sep">/</span><span class="mono lv">{fmtNum(lossMachine)}</span><span class="chip-lbl unit">%</span>
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
    --wm: 1rem;   /* the hub name's size; the dot's ripple is sized in it */
    --pl: max(var(--gap), var(--corner-tl, 0px) - var(--it));
    --pr: max(var(--gap), var(--corner-tr, 0px) - var(--it));
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    height: calc(var(--row) + var(--it));
    padding: var(--it) var(--pr) 0 var(--pl);
    background: var(--bg-raised);
    box-shadow: inset 0 -1px 0 var(--line);
    /* The ripple sits at z-index -1 in this context: over the bar's background, under its content. */
    isolation: isolate;
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
    font-size: var(--wm);
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
  /* Fixed slots: a reading that changes moves no neighbor (DESIGN §10.3). A rate or a loss value
     and the auth value fill a slot of their widest reading, right-aligned for numbers; fps is at most 7 characters. */
  .rv, .lv { display: inline-block; text-align: right; font-variant-numeric: tabular-nums; }
  .rv { width: 3ch; }
  .lv { width: 3ch; }
  .auth { min-width: 9ch; }   /* "configure", the longest tier name */
  .unit { text-transform: none; }
  /* Arrows a step larger than the digits beside them; each rides close to its number. */
  .arrow { flex: none; width: 1em; height: 1.25em; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  .chip-opt-last { gap: var(--sp-1); }
  .rv + .arrow { margin-left: var(--sp-2); }
  .fps { width: 7ch; text-align: right; }
  /* The gap after it cancelled: the lead takes no room at all. */
  .opt-lead { flex: none; width: 0; margin-right: calc(var(--sp-2) * -1); }

  /* ---- the link dot ----
     State is a class (live, connecting, stale, offline), never only color: the tooltip and the status
     text say it, offline is a hollow ring, stale only dims. The beat and the ripple are the write-ack
     ring's language (style.css, Ground Truth): the same glow ease, the same ease-out, intent for
     "awaiting", warn for "unconfirmed". Only transform and opacity animate. The box is a fixed 16 px
     hover target; nothing here moves a neighbor. */
  .linkdot {
    --lc: var(--reality-rgb);
    --beat: 2s;
    /* The ripple reaches about the width of "nucleus-p4" in the hub name (measured: test/responsive-matrix.mjs). */
    --rip-r: calc(var(--wm) * 4.6);
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
  }
  .linkdot.connecting { --lc: var(--intent-rgb); --beat: 1s; }
  .linkdot.stale, .linkdot.virtual { --lc: var(--warn-rgb); }
  .core {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(var(--lc));
    box-shadow: 0 0 6px rgba(var(--lc), .6);
    animation: dot-beat var(--beat) infinite;
  }
  .linkdot.stale .core { animation: dot-dim 3s ease-in-out infinite; }
  .linkdot.offline .core { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ink-faint); animation: none; }
  /* A row-high band centered on the dot, unbounded left and right: the ripple spreads along the bar
     and never bleeds above or below it. */
  .rclip {
    position: absolute;
    left: 0;
    top: 50%;
    width: 100%;
    height: var(--row);
    margin-top: calc(var(--row) / -2);
    z-index: -1;
    pointer-events: none;
    clip-path: inset(0 -100vmax);
  }
  .ripple {
    position: absolute;
    left: 50%;
    top: 50%;
    width: calc(var(--rip-r) * 2);
    height: calc(var(--rip-r) * 2);
    margin: calc(var(--rip-r) * -1) 0 0 calc(var(--rip-r) * -1);
    border-radius: 50%;
    opacity: 0;
    background: radial-gradient(circle closest-side, rgba(var(--lc), 0) 58%, rgba(var(--lc), .16) 80%,
      rgba(var(--lc), .75) 95%, rgba(var(--lc), 0) 100%);
    animation: ripple-grow var(--beat) var(--ease-out) infinite, ripple-fade var(--beat) var(--fx-glow-ease) infinite;
  }
  .linkdot:is(.stale, .offline) .rclip { display: none; }
  /* The swell: 36 % up on the beat, a quick rise and a slow settle. */
  @keyframes dot-beat {
    0% { transform: scale(1); animation-timing-function: var(--ease-out); }
    14% { transform: scale(1.36); animation-timing-function: ease-in-out; }
    46%, 100% { transform: scale(1); }
  }
  @keyframes dot-dim { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
  @keyframes ripple-grow { from { transform: scale(.08); } to { transform: scale(1); } }
  @keyframes ripple-fade { from { opacity: .7; } to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .core, .ripple { animation: none; }
  }
  :global(html.still) .core, :global(html.still) .ripple { animation: none; }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
    /* The rate keeps its place on a phone by dropping its unit; the tooltip and the name say KB/s. */
    .chip-opt-last .unit { display: none; }
    .chips.pinned .chip { gap: var(--sp-1); }
    .rv + .arrow { margin-left: 0; }
  }
  @media (max-width: 400px) {
    .chip-opt-last { display: none; }
    .chips.opt { display: none; }
    .linkbar { --wm: .82rem; }
    .header-left { min-width: 0; }
  }
</style>
