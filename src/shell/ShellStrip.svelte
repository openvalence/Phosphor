<script>
  /**
   * ShellStrip.svelte -- the shell's end of the top bar (ui/LinkBar.svelte):
   * a BLE chip while the session rides BLE, then the window buttons, and the
   * close gate's popover under the X. SHELL ONLY: main.js hands it to App,
   * App to TopStrip, TopStrip to LinkBar; never in the embedded bundle.
   * Discovery and transport live in hubs.svelte.js, the panes in the
   * sidebar's Phosphor section (panes.js).
   *
   * Constraints:
   * - Shell chrome, not kernel UI: it never touches machine state.
   * - decorations:false applies to desktop only; a phone shell has no frame
   *   to replace, so it gets no window buttons.
   * - The bar around it is the drag region; these buttons opt out on their
   *   own (Tauri drag.js).
   * - Close: the X and every OS close request open ONE popover (RENDERING §9
   *   overlay: it covers, never shifts) below the whole top strip, never over
   *   the e-stop or pause (laws 1, 11); only a held Close quits
   *   (close-confirm.js). Never red: law 13 keeps red for hazards.
   */
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { hubs } from './hubs.svelte.js';
  import { machine } from '../model/machine.svelte.js';
  import { runsOnAlone } from '../model/actions.js';
  import { CH_CONTROL_OWNER } from '../../../Valence/clients/js/index.js';
  import { createCloseGate, closeConsequences, HOLD_MS } from './close-confirm.js';

  const win = ['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM) ? null : getCurrentWindow();
  // macOS: the maximize button is the true fullscreen (its own Space), the
  // operator's ruling 2026-10-04; elsewhere it stays the OS maximize.
  const MAC = import.meta.env.TAURI_ENV_PLATFORM === 'darwin';
  const maximize = async () => (MAC ? win.setFullscreen(!(await win.isFullscreen())) : win.toggleMaximize());

  let asking = $state(false);
  let holding = $state(false);
  let serverRunning = $state(false);
  let winEl = $state(null);
  let xEl = $state(null);
  let holdEl = $state(null);

  function ask() {
    asking = true;
    // App un-hides a fullscreen page's bar so the popover is visible.
    window.dispatchEvent(new CustomEvent('phosphor-close-ask'));
    serverRunning = false;
    invoke('bp_status').then((st) => { serverRunning = !!(st && st.running); }).catch(() => {});
  }
  const gate = win ? createCloseGate(win, ask) : null;
  $effect(() => () => gate && gate.dispose());
  $effect(() => { if (asking && holdEl) holdEl.focus(); });

  function dismiss(refocus) {
    if (gate) gate.release();
    holding = false;
    asking = false;
    if (refocus && xEl) xEl.focus();
  }

  const ownsSource = $derived.by(() => {
    const o = machine.samples[CH_CONTROL_OWNER];
    for (let i = 0; o && o['owner' + i] !== undefined; i++) {
      if (o['owner' + i] && o['owner' + i] === machine.link.sessionId) return true;
    }
    return false;
  });
  const lines = $derived(closeConsequences({
    runsOnAlone: runsOnAlone(machine.catalog.model && machine.catalog.model.byRole, machine.samples),
    ownsSource, serverRunning,
  }));

  function start() { holding = true; gate.hold(); }
  function stop() { holding = false; gate.release(); }
  function onkeydown(e) {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); }
  }
  function onkeyup(e) {
    if (e.key === 'Enter' || e.key === ' ') stop();
  }
  function onWindowKey(e) {
    if (e.key === 'Escape' && asking) dismiss(winEl.contains(document.activeElement));
  }
  // composedPath, not contains(): a re-rendered target is already detached.
  function onDocClick(e) {
    if (asking && !e.composedPath().includes(winEl)) dismiss(false);
  }
</script>

<svelte:window onkeydown={onWindowKey} />
<svelte:document onclick={onDocClick} />

{#if hubs.mode === 'ble'}<span class="sb-ble mono">BLE</span>{/if}
{#if win}
  <span class="sb-win" bind:this={winEl}>
    <button class="sb-wbtn" aria-label="Minimize" title="Minimize" onclick={() => win.minimize()}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8"/></svg>
    </button>
    <button class="sb-wbtn" aria-label="Maximize" title="Maximize" onclick={maximize}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7"/></svg>
    </button>
    <button class="sb-wbtn" bind:this={xEl} aria-label="Close" title="Close" aria-haspopup="dialog"
            aria-expanded={asking} onclick={() => (asking ? dismiss(false) : ask())}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
    </button>
    {#if asking}
      <div class="sb-pop" role="dialog" aria-label="Close Phosphor">
        <p class="sb-pop-t">Close Phosphor?</p>
        {#each lines as l (l)}<p class="sb-pop-c">{l}</p>{/each}
        <button class="sb-hold" bind:this={holdEl} class:holding
                onpointerdown={start} onpointerup={stop} onpointerleave={stop} onpointercancel={stop}
                {onkeydown} {onkeyup} oncontextmenu={(e) => e.preventDefault()}>
          <span>{holding ? 'Keep holding' : 'Hold to close'}</span>
          {#if holding}<span class="sb-fill" aria-hidden="true" style="--hold-ms: {HOLD_MS}ms"></span>{/if}
        </button>
        <p class="sb-pop-k">Esc to cancel</p>
      </div>
    {/if}
  </span>
{/if}

<style>
  .sb-ble {
    flex: none;
    padding: 3px 6px;
    font-size: .62rem;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--intent) 45%, var(--line));
    color: var(--intent);
  }
  /* Flush at the bar's right edge, the bar's full height. */
  .sb-win { flex: none; display: flex; align-self: stretch; }
  .sb-wbtn {
    display: grid;
    place-items: center;
    width: 46px;
    padding: 0;
    color: var(--shell-fg);
  }
  @media (max-width: 480px) {
    .sb-wbtn { width: 40px; }
  }
  .sb-wbtn:hover, .sb-wbtn[aria-expanded='true'] { color: var(--ink-hi); background: var(--line-soft); }
  .sb-wbtn svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.2; }

  /* Overlay: out of flow at the X's edge, under the strip (TopStrip's
     --strip-h), so the safety pair stays uncovered; moves nothing. */
  .sb-pop {
    position: fixed;
    top: var(--strip-h);
    right: 0;
    z-index: 40;
    width: max-content;
    max-width: min(320px, calc(100vw - 16px));
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--shell-bg);
    color: var(--shell-fg);
    border: 1px solid var(--shell-border);
    border-radius: var(--r-s);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .6);
  }
  .sb-pop p { margin: 0; }
  .sb-pop-t { font-weight: 600; font-size: .85rem; }
  .sb-pop-c { font-size: 12px; color: var(--ink-dim); }
  .sb-pop-k { font-size: 11px; color: var(--ink-dim); }
  .sb-hold {
    position: relative;
    overflow: hidden;
    min-height: var(--tap);
    padding: 0 14px;
    border: 1px solid var(--line-3);
    border-radius: var(--r-s);
    color: var(--ink-hi);
    font-weight: 600;
    user-select: none;
    -webkit-touch-callout: none;
  }
  .sb-hold:hover, .sb-hold.holding { border-color: var(--intent); }
  .sb-fill {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 100%;
    background: var(--intent);
    transform-origin: left;
    animation: sb-fill var(--hold-ms) linear forwards;
  }
  @keyframes sb-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  :global(html.still) .sb-fill { animation: none; }
</style>
