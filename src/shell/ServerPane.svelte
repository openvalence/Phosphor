<script>
  /**
   * ServerPane.svelte -- the embedded buttplug server's pane (DESIGN §10.8):
   * a status section (state, start/stop, stop all toys, each with its ladder
   * line) over tabs for devices, clients, the log and the saved settings.
   * SHELL ONLY: never in the served bundle. Self-contained: it owns its
   * controller and its listeners, so a host mounts it with no props.
   *
   * Constraints:
   * - Shows what bp_status, bp_settings and the bp:// events report, never
   *   what was asked for (bp-server.js owns the ladder). A missing command
   *   disables the pane with the reason as text.
   * - The listener is loopback only until ph-vdk.28 rules otherwise; the note
   *   below states that and must change with it.
   * - Stop all toys sits in a fixed slot whether or not the server runs, with
   *   its own ladder line: it is not hub safety and stays neutral.
   * - Faults read amber, never red (red is the hazard color). Hit targets
   *   are 40 px (law 12).
   */
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { blank, createBp, statusLine } from './bp-server.js';
  import Clients from './server/Clients.svelte';
  import Devices from './server/Devices.svelte';
  import Log from './server/Log.svelte';
  import Settings from './server/Settings.svelte';
  import '../ui/pane.css';

  const s = $state(blank());
  const bp = createBp(s, { invoke, listen });
  onMount(() => { bp.init(); return bp.dispose; });

  const TABS = [['devices', 'Devices'], ['clients', 'Clients'], ['log', 'Log'], ['settings', 'Settings']];
  let tab = $state('devices');
  const summary = $derived(statusLine(s));
  const runText = $derived(!s.ready ? s.reason
    : s.fault ? 'Server error: ' + s.fault
      : s.run.reason || (s.running ? 'Running on ws://127.0.0.1:' + s.port : 'Stopped'));
  const runPhase = $derived(!s.ready ? 'fault' : s.fault ? 'fault' : s.run.reason ? s.run.phase : s.running ? 'settled' : null);
  const stopText = $derived(s.stopAll.reason || 'Not the machine e-stop');

  function onTabKey(e) {
    const i = TABS.findIndex(([id]) => id === tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    tab = TABS[(i + step + TABS.length) % TABS.length][0];
    e.currentTarget.querySelector('[data-tab="' + tab + '"]')?.focus();
  }
</script>

<div class="pane-stack sp-pane">
  <section class="pane-sec og-panel" aria-labelledby="sp-title">
    <div class="pane-head">
      <h2 id="sp-title">ButtplugIO</h2>
      <span class="sp-state mono" data-on={s.running} title={summary}>{summary}</span>
    </div>
    <div class="sp-row">
      {#if s.running}
        <button type="button" class="og-btn run" disabled={!s.ready || s.run.phase === 'pending'} onclick={bp.stop}>Stop server</button>
      {:else}
        <button type="button" class="og-btn primary run" disabled={!s.ready || !s.settings || s.run.phase === 'pending'}
                onclick={() => bp.start()}>Start server</button>
      {/if}
      <button type="button" class="og-btn" disabled={!s.ready || !s.running || s.stopAll.phase === 'pending'}
              title={s.running ? '' : 'Server stopped'} onclick={bp.stopAll}>Stop all toys</button>
    </div>
    <p class="pane-status" role="status" data-phase={runPhase} title={runText}>{runText}</p>
    <p class="pane-status" role="status" data-phase={s.stopAll.reason ? s.stopAll.phase : null} title={stopText}>{stopText}</p>
    <p class="pane-note">Loopback only, no LAN access</p>
  </section>

  {#if s.ready}
    <section class="pane-sec og-panel" aria-label="Server sections">
      <div class="og-seg" role="tablist" aria-label="Server sections" tabindex="-1" onkeydown={onTabKey}>
        {#each TABS as [id, label] (id)}
          <button type="button" role="tab" data-tab={id} aria-selected={tab === id} tabindex={tab === id ? 0 : -1}
                  class:active={tab === id} onclick={() => (tab = id)}>{label}</button>
        {/each}
      </div>
      <div role="tabpanel" aria-label={tab} class="sp-panel">
        {#if tab === 'devices'}
          <Devices {s} {bp} />
        {:else if tab === 'clients'}
          <Clients {s} {bp} />
        {:else if tab === 'log'}
          <Log {s} {bp} />
        {:else}
          <Settings {s} {bp} />
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  /* One line, ellipsized: the summary growing never wraps the header. */
  .sp-pane .pane-head { flex-wrap: nowrap; }
  .sp-pane .pane-head h2 { flex: 0 0 auto; white-space: nowrap; }
  .sp-state { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .75rem; color: var(--tx-mut); }
  .sp-state[data-on='true'] { color: var(--reality); }
  .sp-panel { display: grid; gap: var(--sp-3); min-width: 0; }
  /* One width for Start and Stop, so Stop all toys never moves. */
  .run { min-width: 9.5em; }
  .og-seg button { flex: 1 0 auto; }

  /* :global under .sp-pane: the tab components in ./server share these.
     Their buttons are .og-btn; these are the shared row, field and ladder. */
  .sp-pane :global(.sp-btn) { min-height: 40px; }
  .sp-pane :global(.sp-row) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
  .sp-pane :global(.sp-field) { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: .78rem; color: var(--tx-mut); }
  .sp-pane :global(.sp-field input), .sp-pane :global(.sp-field select) {
    min-height: 40px;
    padding: 0 var(--sp-3);
    background: var(--bg-sunken);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    color: var(--ink);
  }
  .sp-pane :global(.sp-field select) { width: auto; padding-right: calc(var(--sp-5) + var(--sp-4)); }
  .sp-pane :global(.sp-field input[type='number']) { width: 8ch; }
  .sp-pane :global(.sp-check) { display: inline-flex; align-items: center; gap: var(--sp-3); min-height: 40px; font-size: .8rem; }
  .sp-pane :global(.sp-check input) { width: 18px; height: 18px; margin: 0; }
  .sp-pane :global(.sp-note) { margin: 0; color: var(--tx-mut); font-size: .75rem; }
  .sp-pane :global(.sp-ladder) { margin: 0; font-size: .75rem; color: var(--ink-dim); }
  .sp-pane :global(.sp-ladder[data-phase='pending']) { color: var(--intent); }
  .sp-pane :global(.sp-ladder[data-phase='overdue']), .sp-pane :global(.sp-ladder[data-phase='fault']) { color: var(--warn-ink, var(--warn)); }
</style>
