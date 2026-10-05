<script>
  /**
   * KeyHelp.svelte -- F1: the key table (model/keys.js) in one fixed panel.
   *
   * Constraints:
   * - F1 is bound here, on the window, with preventDefault so the browser's
   *   own help never opens. F1 or Escape closes; focus returns to the opener.
   * - An overlay in ConfirmLayer's band (RENDERING §9): no scrim, no inert,
   *   below the top strip, so the stop stays reachable. Fixed size whatever
   *   the class; only the panel's list scrolls.
   * - One overlay at a time: opening announces 'phosphor-overlay', which
   *   closes this one; a pending confirm blocks F1 (it must stay visible).
   * - Two columns on `full`, one otherwise.
   * - A shell-only binding (its `src` under src/shell) is listed in the shell
   *   only; the served page has no such control.
   */
  import { tick } from 'svelte';
  import { KEYS } from '../model/keys.js';
  import { view } from '../model/viewport.svelte.js';
  import { confirmUi } from './confirm.svelte.js';

  const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
  const GROUPS = KEYS.map((g) => ({ ...g, items: g.items.filter((k) => SHELL || !k.src.startsWith('src/shell/')) }))
    .filter((g) => g.items.length);

  let open = $state(false);
  let panel = $state(null);
  let opener = null;

  let top = $state(0);
  async function show() {
    if (confirmUi.req) return;
    window.dispatchEvent(new CustomEvent('phosphor-overlay', { detail: 'help' }));
    opener = document.activeElement;
    top = document.querySelector('.topstrip')?.getBoundingClientRect().bottom ?? 0;
    open = true;
    await tick();
    panel?.querySelector('.kh-close')?.focus();
  }
  function hide(restore = true) {
    open = false;
    if (restore && opener && opener.isConnected) opener.focus();
    opener = null;
  }
  const yield_ = (e) => { if (open && e.detail !== 'help') hide(); };

  function onkeydown(e) {
    if (e.key === 'F1') {
      e.preventDefault();
      if (open) hide(); else show();
    } else if (open && e.key === 'Escape') {
      e.preventDefault();
      hide();
    } else if (open && e.key === 'Tab' && panel) {
      const f = [...panel.querySelectorAll('button, [tabindex="0"]')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
</script>

<svelte:window {onkeydown} onphosphor-overlay={yield_} />

{#if open}
  <div class="ov-band" style="--ov-top: {top}px">
    <div class="kh" bind:this={panel} role="dialog" aria-labelledby="kh-title" tabindex="-1">
      <div class="kh-head">
        <h2 id="kh-title">Keys</h2>
        <button type="button" class="og-btn sm kh-close" onclick={hide}>Close</button>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="kh-list" class:two={view.cls === 'full'} tabindex="0" aria-label="Key table">
        {#each GROUPS as g (g.group)}
          <section>
            <h3>{g.group}</h3>
            <dl>
              {#each g.items as k, i (i)}
                <dt><kbd>{k.keys}</kbd></dt>
                <dd>{k.does}<span class="kh-where">{k.where}</span></dd>
              {/each}
            </dl>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* The band under the top strip (z 30, measured at open): the stop stays
     reachable. The panel is centered in it, fixed size; the band itself
     takes no pointer. */
  .ov-band {
    position: fixed;
    inset: var(--ov-top) 0 0 0;
    z-index: 29;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
    padding: var(--gap);
    pointer-events: none;
  }
  .kh {
    pointer-events: auto;
    width: min(100%, 760px);
    height: min(100%, 560px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(var(--shade-rgb), .6);
  }
  .kh-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  /* The panes' heading face (pane.css .pane-head h2). */
  h2 { margin: 0; font-size: .8rem; font-weight: 500; text-transform: uppercase; letter-spacing: .12em; color: var(--tx-val); }
  .kh-close { min-height: var(--tap); padding: 0 16px; }
  .kh-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .kh-list.two { columns: 2; column-gap: calc(var(--gap) * 2); }
  section { break-inside: avoid; margin-bottom: var(--gap); }
  h3 {
    margin: 0 0 4px;
    font-size: .7rem;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 3px 10px;
    margin: 0;
    font-size: .8rem;
  }
  dt, dd { margin: 0; min-width: 0; }
  /* Key names are text, never a state color: intent means commanded (ph-gz8). */
  kbd { font-family: var(--mono); font-size: .74rem; color: var(--tx-hi); white-space: nowrap; }
  dd { color: var(--ink); }
  .kh-where { display: block; font-size: .7rem; color: var(--ink-dim); }
  .kh { animation: kh-rise var(--t-quick) ease-out; }
  @keyframes kh-rise { from { opacity: 0; } to { opacity: 1; } }
</style>
