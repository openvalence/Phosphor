<script>
  /**
   * Drawer.svelte -- the shell's menu, dropping from the shell row.
   * SHELL ONLY. ShellStrip owns open/close; this owns the panes.
   *
   * Constraints:
   * - Never covers the e-stop and pause pair (RENDERING §9, law 11). Desktop:
   *   in flow inside the top strip, above the LinkBar, so it pushes the pair
   *   down and its max-height keeps the pair on screen. Phone: below the
   *   whole strip, over the content. Either way it scrolls within itself,
   *   with no overscroll containment: at its end a wheel or swipe goes on to
   *   the page.
   * - About shows what the hub sent and `--` for anything it did not.
   * - Siblings add panes through panes.js, never by editing this file.
   */
  import { getVersion } from '@tauri-apps/api/app';
  import { machine } from '../model/machine.svelte.js';
  import { hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import ServerPane from './ServerPane.svelte';
  import { panes as drawerPanes } from './panes.js';

  // hubs: ShellStrip's discovery and transport, a snippet because that state
  // must outlive the drawer closing (BLE upgrade, wire counters).
  let { hubs } = $props();

  const BUILTIN = [
    { id: 'hubs', label: 'Hubs' },
    { id: 'server', label: 'Server', component: ServerPane },
    { id: 'settings', label: 'Settings' },
    { id: 'about', label: 'About' },
  ];
  const panes = $derived.by(() => {
    const reg = $drawerPanes;
    const out = BUILTIN.map((b) => reg.find((p) => p.id === b.id) || b);
    out.splice(-1, 0, ...reg.filter((p) => !BUILTIN.some((b) => b.id === p.id)));
    return out;
  });

  const KEY = 'shell_drawer_pane';
  let active = $state(stored());
  function stored() {
    try { return localStorage.getItem(KEY) || 'hubs'; } catch (e) { return 'hubs'; }
  }
  const current = $derived(panes.find((p) => p.id === active) || panes[0]);
  function pick(id) {
    active = id;
    try { localStorage.setItem(KEY, id); } catch (e) { /* private mode: the pane is a convenience */ }
  }
  // WAI-ARIA tabs: roving tabindex, arrows move focus and selection.
  function onkey(e) {
    const i = panes.indexOf(current);
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: panes.length - 1 }[e.key];
    if (n == null) return;
    e.preventDefault();
    const p = panes[(n + panes.length) % panes.length];
    pick(p.id);
    document.getElementById('dt-' + p.id)?.focus();
  }

  const identity = $derived(machine.link.hubIdentity);
  const nameField = $derived(machine.catalog.model?.byRole?.get(ROLE.identityName)?.[0]);
  const hubName = $derived(hubTitle(identity,
    nameField ? reportedValue(nameField, machine.samples[nameField.channelId]) : ''));
  let shellVersion = $state('--');
  getVersion().then((v) => { shellVersion = v; }).catch(() => {});
  const uiBuild = typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : '--';
</script>

<div class="drawer" id="shell-drawer">
  <div class="dr-tabs" role="tablist" aria-label="Shell menu" tabindex="-1" onkeydown={onkey}>
    {#each panes as p (p.id)}
      <button type="button" role="tab" id={'dt-' + p.id} aria-selected={p === current}
              aria-controls="dr-panel" tabindex={p === current ? 0 : -1}
              onclick={() => pick(p.id)}>{p.label}</button>
    {/each}
  </div>
  <div class="dr-panel" id="dr-panel" role="tabpanel" aria-labelledby={'dt-' + current.id}>
    {#if current.component}
      <current.component />
    {:else if current.id === 'hubs'}
      {@render hubs?.()}
    {:else if current.id === 'about'}
      <dl class="dr-about">
        <dt>Hub</dt><dd>{hubName}</dd>
        <dt>Product</dt><dd>{identity?.product || '--'}</dd>
        <dt>Firmware</dt><dd class="mono">{identity?.fw_version || '--'}</dd>
        <dt>Endpoint</dt><dd class="mono">{machine.link.dialed || '--'}</dd>
        <dt>Shell</dt><dd class="mono">{shellVersion}</dd>
        <dt>UI build</dt><dd class="mono">{uiBuild}</dd>
      </dl>
    {:else}
      <p class="dr-empty">Nothing here yet.</p>
    {/if}
  </div>
</div>

<style>
  .drawer {
    display: flex;
    flex-direction: column;
    max-height: min(40vh, 480px);
    max-height: min(40dvh, 480px);
    background: var(--shell-bg);
    color: var(--shell-fg);
    border-bottom: 1px solid var(--shell-border);
    font-size: 0.8rem;
  }
  .dr-tabs {
    flex: none;
    display: flex;
    gap: 4px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .dr-tabs::-webkit-scrollbar { display: none; }
  .dr-tabs button {
    flex: 0 0 auto;
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--shell-fg);
    font-weight: 500;
    white-space: nowrap;
  }
  .dr-tabs button[aria-selected='true'] {
    color: var(--ink-hi);
    background: var(--bg-card);
    border-color: var(--line-3);
  }
  .dr-panel {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 10px;
  }
  .dr-about {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 16px;
    margin: 0;
  }
  .dr-about dd { margin: 0; overflow-wrap: anywhere; }
  .dr-empty { color: var(--shell-fg); }
  /* Phone: below the whole strip, over the content, so the safety pair never
     moves; the sticky strip (the containing block) carries the drawer with
     it. One tap band stays uncovered to tap out. Breakpoint matches
     App.svelte's isDesktop. */
  @media (max-width: 959px) {
    .drawer {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: calc(100vh - var(--strip-h, 0px) - var(--tap));
      max-height: calc(100dvh - var(--strip-h, 0px) - var(--tap));
    }
    .dr-tabs button { flex: 1 0 auto; }
    .dr-panel { padding: 10px var(--gap); }
  }
</style>
