<script>
  /**
   * ServerPane.svelte -- the embedded buttplug server's pane (DESIGN §10.8):
   * on/off and port, client count, toy scan, device list, log tail. SHELL
   * ONLY: an entry in ShellStrip's row, never in the served bundle.
   *
   * Constraints:
   * - Shows what bp_status and the bp:// events report, never what was asked
   *   for (bp-server.js owns the ladder). A missing command disables the pane
   *   with the reason as text.
   * - The listener is loopback only until ph-vdk.28 rules otherwise; the note
   *   below states that and must change with it.
   * - Red is for safety only (RENDERING law 13): log levels and faults are
   *   text plus amber, never red.
   */
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { blank, createBp, BP_PORT } from './bp-server.js';

  const s = $state(blank());
  const bp = createBp(s, { invoke, listen });
  onMount(() => { bp.init(); return bp.dispose; });

  let open = $state(false);
  let port = $state(BP_PORT);
  const portOk = $derived(Number.isInteger(port) && port >= 1 && port <= 65535);
  const devices = $derived([...s.devices].sort((a, b) => (a.kind === 'machine' ? -1 : 0) - (b.kind === 'machine' ? -1 : 0)));
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
        <button class="sp-btn" disabled={!s.ready || s.run.phase === 'pending' || !portOk}
                onclick={() => bp.start(port)}>start server</button>
      {/if}
      <label class="sp-port">port
        <input class="mono" type="number" min="1" max="65535" bind:value={port}
               disabled={!s.ready || s.running || s.run.phase === 'pending'} />
      </label>
      <span class="sp-note">loopback only: apps on this computer can connect, nothing on the LAN</span>
      {#if s.running}<span class="sp-note mono">{s.clients} {s.clients === 1 ? 'client' : 'clients'}</span>{/if}
      {#if s.run.reason}<span class="sp-ladder" data-phase={s.run.phase}>{s.run.reason}</span>{/if}
    </div>

    <div class="sp-row">
      <button class="sp-btn" disabled={!s.ready || s.scan.phase === 'pending'}
              onclick={() => bp.scan(!s.scanning)}>{s.scanning ? 'stop scan' : 'scan for toys'}</button>
      {#if s.scanning}<span class="sp-note">scanning…</span>{/if}
      {#if s.scan.reason}<span class="sp-ladder" data-phase={s.scan.phase}>{s.scan.reason}</span>{/if}
    </div>

    {#if s.ready}
      <ul class="sp-devs">
        {#each devices as d (d.index)}
          <li class="sp-dev" data-kind={d.kind}>
            <span class="sp-kind mono">{d.kind}</span>
            <span class="sp-name">{d.name}</span>
            <span class="sp-conn" data-on={d.connected}>{d.connected ? 'connected' : 'disconnected'}</span>
            {#each d.features as f}<span class="sp-chip mono">{f}</span>{/each}
          </li>
        {:else}
          <li class="sp-note">no devices</li>
        {/each}
      </ul>
      {#if s.log.length}
        <ol class="sp-log mono">
          {#each s.log.slice(-8) as l}<li><span class="sp-lvl">{l.level}</span> {l.msg}</li>{/each}
        </ol>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .sp-entry, .sp-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 36px;
    padding: 0 12px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 12.5px;
  }
  .sp-entry:hover, .sp-btn:hover:not(:disabled) { border-color: var(--line-4); }
  .sp-btn:disabled { opacity: .5; }
  @media (pointer: coarse) {
    .sp-entry, .sp-btn, .sp-port input { min-height: 40px; }
  }
  .sp-sum { color: var(--ink-dim); }
  .sp-sum[data-on='true'] { color: var(--reality); }
  /* Takes its own line in ShellStrip's wrapping row. */
  .sp-pane {
    flex: 1 0 100%;
    display: grid;
    gap: 6px;
    padding: 6px 0;
  }
  .sp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .sp-port { display: inline-flex; align-items: center; gap: 6px; }
  .sp-port input {
    width: 7ch;
    min-height: 36px;
    padding: 0 6px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
  }
  .sp-note { color: var(--ink-faint); font-style: italic; font-size: 11px; }
  .sp-reason { margin: 0; color: var(--ink-dim); }
  .sp-ladder { font-size: 11px; color: var(--ink-dim); }
  .sp-ladder[data-phase='pending'] { color: var(--intent); }
  .sp-ladder[data-phase='overdue'], .sp-ladder[data-phase='fault'] { color: var(--warn); }
  .sp-devs, .sp-log { list-style: none; margin: 0; padding: 0; }
  .sp-dev { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; padding: 3px 0; }
  .sp-kind { color: var(--ink-faint); text-transform: uppercase; font-size: 10px; min-width: 7ch; }
  .sp-dev[data-kind='machine'] .sp-kind { color: var(--reality); }
  .sp-name { color: var(--ink); font-weight: 600; }
  .sp-conn { color: var(--ink-faint); }
  .sp-conn[data-on='true'] { color: var(--reality); }
  .sp-chip {
    padding: 1px 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-size: 10.5px;
  }
  .sp-log {
    max-height: 9em;
    overflow-y: auto;
    font-size: 10.5px;
    color: var(--ink-dim);
  }
  .sp-lvl { color: var(--ink-faint); text-transform: uppercase; }
</style>
