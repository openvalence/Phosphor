<script>
  /**
   * FootStrip.svelte — the persistent footer link/diagnostic strip.
   *
   * Restores the pre-refactor page's full-width "▶ LINK" footer identity, but
   * carries only what this refactor's contracts actually have: link-quality
   * counters from machine.stats, the catalog's own identity, the deadman
   * window the hub granted this session, and the shipped UI build id. There
   * is no WiFi RSSI/BSSID/heap surface here — that lived in the retired HTTP
   * plane (docs/http-plane-retirement.md) and machine.stats does not carry it,
   * so showing it would mean fabricating a number nobody sent.
   *
   * ONE ROW, ALWAYS (operator 2026-10-03, ph-wt7r): the row never wraps. Every
   * value holds a fixed slot (--w, ch of the mono face) and shows a compact
   * form; the exact reading is the cell's title. Below the width where every
   * cell fits, whole cells drop in this fixed order, first to go first
   * (the @media rules below, breakpoints measured): clock offset, clock rtt,
   * deadman, state pushes, session, reconnects, last rx; under 442 px the
   * "LINK" label goes too. The scale control and "UI build:etag" (screenshot
   * debugging) never drop.
   *
   * Read-only and quiet on purpose: the one control is the UI scale at the
   * right end (ScaleControl) and the session clock toggle; the rest only
   * tells the operator what the Valence link is doing. Ground truth applies
   * here too — every value is `--` until the machine (or the session itself)
   * has actually produced it.
   *
   * Reads the one machine spine directly. `pinned` (App's scrolling layout):
   * fixed to the viewport's bottom above the page footer (DESIGN §10.3).
   *
   * Constraints:
   * - Pinned, one height whatever the scroll; it owns the bottom inset only
   *   while no page footer is under it, and publishes --foot-strip-h, which
   *   `.app` reserves (style.css).
   * - A live value never moves its neighbors: each holds a fixed slot (--w,
   *   in ch of the mono face) and clips with an ellipsis (ph-rt1).
   */
  import { machine } from '../model/machine.svelte.js';
  import { since, clock, compact, seconds } from '../model/format.js';
  import ScaleControl from './ScaleControl.svelte';

  let { pinned = false } = $props();
  let fsH = $state(0);
  $effect(() => {
    if (!pinned || !fsH) return;
    document.documentElement.style.setProperty('--foot-strip-h', fsH + 'px');
    return () => document.documentElement.style.removeProperty('--foot-strip-h');
  });

  // A page full of "since" readouts needs its own clock, or the age freezes
  // the instant this component last happened to re-render.
  let sessionMs = $state(false);
  let nowTick = $state(Date.now());
  $effect(() => {
    // Reading sessionMs here is deliberate: it makes this effect re-run on
    // the toggle and re-install the interval. A millisecond digit stepping
    // once a second would be a readout that lies about its own resolution.
    const id = setInterval(() => { nowTick = Date.now(); }, sessionMs ? 50 : 1000);
    return () => clearInterval(id);
  });
  function ageLabel(ms, _tick) { return since(ms); }

  const etag = $derived(machine.catalog.etag || '');
  const deadmanMs = $derived(machine.link.deadmanMs);
  const deadman = $derived(deadmanMs ? deadmanMs / 1000 + ' s' : '--');
  const offsetUs = $derived(machine.stats.clockOffsetUs);
  const rttUs = $derived(machine.stats.clockRttUs);
  const usTitle = (us) => (us != null ? us + ' µs' : undefined);
  const rxAge = $derived(ageLabel(machine.stats.lastRxMs, nowTick));

  // Session age off machine.link.since, which the link sets when the phase
  // last changed. Milliseconds are behind a click: the digit changes 1000x a
  // second and is only wanted when someone is timing something.
  const sessionAge = $derived(
    machine.link.phase === 'live' && machine.link.since
      ? clock(nowTick - machine.link.since, sessionMs)
      : '--'
  );

  // Vite global (vite.config.js `define`) — short git hash, or a UTC build
  // timestamp in a repo-less checkout. Never a hand-maintained literal.
  const buildId = typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : '--';
</script>

<footer class="footstrip" class:pinned bind:offsetHeight={fsH} aria-label="Link diagnostics">
  <span class="fs-label" aria-hidden="true">&#9656; LINK</span>

  <div class="facts">
    <span class="fact d6" title="{machine.stats.reconnects} reconnects"><span class="k">reconnects</span><span class="v mono" style="--w: 3ch">{compact(machine.stats.reconnects)}</span></span>
    <span class="fact d4" title="{machine.stats.statePushes} state pushes"><span class="k">state pushes</span><span class="v mono" style="--w: 5ch">{compact(machine.stats.statePushes)}</span></span>
    <span class="fact d1" title={usTitle(offsetUs)}><span class="k">clock offset</span><span class="v mono" style="--w: 11ch">{offsetUs != null ? seconds(offsetUs) : '--'}</span></span>
    <span class="fact d2" title={usTitle(rttUs)}><span class="k">clock rtt</span><span class="v mono" style="--w: 7ch">{rttUs != null ? seconds(rttUs) : '--'}</span></span>
    <span class="fact d3" title={deadmanMs ? deadmanMs + ' ms' : undefined}><span class="k">deadman</span><span class="v mono" style="--w: 5ch">{deadman}</span></span>
    <span class="fact d7"><span class="k">last rx</span><span class="v mono" style="--w: 6ch">{rxAge}</span></span>
    <span class="fact" title="UI build {buildId}, catalog etag {etag || '--'}"><span class="k">ui</span><span class="v mono" style="--w: 18ch">{buildId}:{etag ? etag.slice(0, 10) : '--'}</span></span>
    <button type="button" class="fact fact-btn d5" onclick={() => (sessionMs = !sessionMs)}
            title={sessionMs ? 'Hide milliseconds' : 'Show milliseconds'}>
      <span class="k">session</span><span class="v mono" style="--w: {sessionMs ? 11 : 7}ch">{sessionAge}</span>
    </button>
  </div>
  <ScaleControl />
</footer>

<style>
  .footstrip {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    overflow: hidden;
    white-space: nowrap;
    gap: var(--sp-4);
    /* em of the fixed 11 px type, not rem: the row's box and the scale group's edge hold while the UI scale steps. */
    margin: 0 calc(var(--app-pad) * -1);
    padding: .727em 1.09em;
    background: var(--bg-raised);
    border-top: 1px solid var(--line);
    color: var(--ink-faint);
    font-size: 11px;
  }

  .footstrip.pinned {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--page-foot-reserve, 0px);
    z-index: 15;
    margin: 0;
    padding-bottom: calc(.727em + env(safe-area-inset-bottom, 0px));
  }
  :global(.app:has(.page-foot.page .foot-page > *)) .footstrip.pinned { padding-bottom: .727em; }
  /* The phone class (DESIGN §10.12): one line at the tap height, its 40 px
     targets inside it; the inset under it only with no page footer below. */
  :global(:root[data-phone]) .footstrip { box-sizing: content-box; height: max(var(--tap), 40px); padding-block: 0; }
  :global(:root[data-phone]) .footstrip.pinned { padding-bottom: env(safe-area-inset-bottom, 0px); }
  :global(:root[data-phone] .app:has(.page-foot.page .foot-page > *)) .footstrip.pinned { padding-bottom: 0; }

  .fs-label {
    flex: 0 0 auto;
    color: var(--ink-faint);
    letter-spacing: .08em;
    font-weight: 600;
  }

  .facts {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--sp-3);
    min-width: 0;
    overflow: hidden;
    flex: 1 1 auto;
  }

  .fact {
    flex: none;
    display: inline-flex;
    align-items: baseline;
    gap: var(--sp-2);
    white-space: nowrap;
  }
  /* A fact that happens to be clickable stays a fact: same metrics, no button
     chrome, so the strip does not grow a control that looks like a control. */
  .fact-btn {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
  }
  .fact-btn:hover .v { color: var(--ink); }

  .k {
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: .05em;
    font-size: 11px;
  }
  .v {
    flex: none;
    width: var(--w, auto);
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ink-dim);
    font-size: 11px;
    white-space: nowrap;
  }

  /* Touch: a clickable fact grows a real 40px hit box. An invisible
     pseudo-element extension (the usual T24 preference) does not survive
     here: FootStrip sits flush against the bottom of the desktop `.app`
     shell (style.css: a fixed-height flex column, `overflow: hidden`), so
     anything the pseudo-element grows downward is clipped away before it
     reaches the floor. */
  @media (pointer: coarse) {
    .fact-btn { min-height: 40px; align-items: center; }
  }

  /* The drop order (header): d1 goes first, d7 last. */
  /* Breakpoints = measured width where the cells left still fit, plus 7 px;
     coarse pointers carry the 40 px scale buttons, so they drop earlier. */
  @media (max-width: 1271px) { .d1 { display: none; } }
  @media (pointer: coarse) and (max-width: 1319px) { .d1 { display: none; } }
  @media (max-width: 1091px) { .d2 { display: none; } }
  @media (pointer: coarse) and (max-width: 1139px) { .d2 { display: none; } }
  @media (max-width: 962px) { .d3 { display: none; } }
  @media (pointer: coarse) and (max-width: 1010px) { .d3 { display: none; } }
  @media (max-width: 855px) { .d4 { display: none; } }
  @media (pointer: coarse) and (max-width: 903px) { .d4 { display: none; } }
  @media (max-width: 722px) { .d5 { display: none; } }
  @media (pointer: coarse) and (max-width: 770px) { .d5 { display: none; } }
  @media (max-width: 606px) { .d6 { display: none; } }
  @media (pointer: coarse) and (max-width: 654px) { .d6 { display: none; } }
  @media (max-width: 494px) { .d7 { display: none; } }
  @media (pointer: coarse) and (max-width: 542px) { .d7 { display: none; } }
  @media (max-width: 441px) { .fs-label { display: none; } }
</style>
