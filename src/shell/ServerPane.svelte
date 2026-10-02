<script>
  /**
   * ServerPane.svelte -- the embedded buttplug server's pane (DESIGN §10.8):
   * a status row (on/off, port, clients, devices, stop all toys) over tabs for
   * devices, clients, the log and the saved settings. SHELL ONLY: never in the
   * served bundle. Self-contained: it owns its controller and its listeners,
   * so a host mounts it with no props.
   *
   * Constraints:
   * - Shows what bp_status, bp_settings and the bp:// events report, never
   *   what was asked for (bp-server.js owns the ladder). A missing command
   *   disables the pane with the reason as text.
   * - The listener is loopback only until ph-vdk.28 rules otherwise; the note
   *   below states that and must change with it.
   * - Red is for safety only (RENDERING law 13): log levels and faults are
   *   text plus amber, never red. Stop all toys is not hub safety and stays
   *   neutral. Hit targets are 40 px (law 12).
   */
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { blank, createBp } from './bp-server.js';
  import Devices from './server/Devices.svelte';
  import Settings from './server/Settings.svelte';

  const s = $state(blank());
  const bp = createBp(s, { invoke, listen });
  onMount(() => { bp.init(); return bp.dispose; });

  const TABS = ['devices', 'log', 'settings'];
  let open = $state(false);
  let tab = $state('devices');
  const summary = $derived(!s.ready ? 'unavailable'
    : s.running ? 'on :' + s.port + ' · ' + s.clients + (s.clients === 1 ? ' client' : ' clients')
    : 'off');
</script>

<button class="sp-entry mono" aria-expanded={open} onclick={() => (open = !open)}>
  server <span class="sp-sum" data-on={s.running}>{summary}</span>
</button>

{#if open}
  <div class="sp-pane" role="region" aria-label="buttplug server">
    {#if !s.ready}
      <p class="sp-reason">{s.reason}</p>
    {/if}
    <div class="sp-row">
      {#if s.running}
        <button class="sp-btn" disabled={!s.ready || s.run.phase === 'pending'} onclick={bp.stop}>stop server</button>
      {:else}
        <button class="sp-btn" disabled={!s.ready || !s.settings || s.run.phase === 'pending'}
                onclick={() => bp.start()}>start server</button>
      {/if}
      <span class="sp-note mono">{s.running ? 'on 127.0.0.1:' + s.port : 'off'}</span>
      <span class="sp-note">loopback only: apps on this computer can connect, nothing on the LAN</span>
      {#if s.running}<span class="sp-note mono">{s.clients} {s.clients === 1 ? 'client' : 'clients'}</span>{/if}
      {#if s.run.reason}<span class="sp-ladder" data-phase={s.run.phase}>{s.run.reason}</span>{/if}
    </div>

    <div class="sp-row">
      <button class="sp-btn" disabled={!s.ready || !s.running || s.stopAll.phase === 'pending'}
              onclick={bp.stopAll}>stop all toys</button>
      {#if s.stopAll.reason}<span class="sp-ladder" data-phase={s.stopAll.phase}>{s.stopAll.reason}</span>{/if}
      <span class="sp-note">toys only: this is not the machine e-stop, which stays in the top strip</span>
    </div>

    {#if s.ready}
      <div class="sp-tabs" role="tablist" aria-label="server sections">
        {#each TABS as t}
          <button role="tab" class="sp-tab" aria-selected={tab === t} onclick={() => (tab = t)}>{t}</button>
        {/each}
      </div>

      <div role="tabpanel" aria-label={tab}>
        {#if tab === 'devices'}
          <Devices {s} {bp} />
        {:else if tab === 'log'}
          {#if s.log.length}
            <ol class="sp-log mono">
              {#each s.log as l}<li><span class="sp-lvl">{l.level}</span> {l.msg}</li>{/each}
            </ol>
          {:else}
            <p class="sp-note">nothing logged yet</p>
          {/if}
        {:else}
          <Settings {s} {bp} />
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* :global under .sp-pane: the tab components in ./server share these. */
  .sp-entry, .sp-pane :global(.sp-btn) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 40px;
    padding: 0 12px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 12.5px;
  }
  .sp-entry:hover, .sp-pane :global(.sp-btn:hover:not(:disabled)) { border-color: var(--line-4); }
  .sp-pane :global(.sp-btn:disabled) { opacity: .5; }
  .sp-sum { color: var(--ink-dim); }
  .sp-sum[data-on='true'] { color: var(--reality); }
  /* Takes its own line in a wrapping host row. */
  .sp-pane {
    flex: 1 0 100%;
    display: grid;
    gap: 6px;
    padding: 6px 0;
    min-width: 0;
  }
  .sp-pane :global(.sp-row) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .sp-pane :global(.sp-field) { display: inline-flex; align-items: center; gap: 6px; }
  .sp-pane :global(.sp-field input), .sp-pane :global(.sp-field select) {
    min-height: 40px;
    padding: 0 6px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
  }
  .sp-pane :global(.sp-field input[type='number']) { width: 8ch; }
  .sp-pane :global(.sp-check) { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; }
  .sp-pane :global(.sp-check input) { width: 18px; height: 18px; margin: 0; }
  .sp-pane :global(.sp-note) { margin: 0; color: var(--ink-faint); font-style: italic; font-size: 11px; }
  .sp-reason { margin: 0; color: var(--ink-dim); }
  .sp-pane :global(.sp-ladder) { font-size: 11px; color: var(--ink-dim); }
  .sp-pane :global(.sp-ladder[data-phase='pending']) { color: var(--intent); }
  .sp-pane :global(.sp-ladder[data-phase='overdue']), .sp-pane :global(.sp-ladder[data-phase='fault']) { color: var(--warn); }
  .sp-tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--line); }
  .sp-tab {
    min-height: 40px;
    padding: 0 14px;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--ink-dim);
    font-size: 12.5px;
  }
  .sp-tab[aria-selected='true'] { color: var(--ink); border-bottom-color: var(--intent); }
  .sp-log { list-style: none; margin: 0; padding: 0; }
  .sp-log {
    max-height: 16em;
    overflow-y: auto;
    font-size: 10.5px;
    color: var(--ink-dim);
  }
  .sp-lvl { color: var(--ink-faint); text-transform: uppercase; }
</style>
