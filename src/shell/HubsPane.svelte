<script>
  /**
   * HubsPane.svelte -- Phosphor > Hubs: discovery, BLE scan, a typed address
   * and the WS upgrade. SHELL ONLY: settings-pane.js registers it with
   * panes.js. Renders hubs.svelte.js, which owns the state.
   */
  import HostEntry from '../ui/HostEntry.svelte';
  import { advFlags } from './ble-adv.js';
  import { hubs, findHubs, scan, pickBle, connectWs, upgrade } from './hubs.svelte.js';
</script>

<div class="hp">
  <div class="hp-row">
    <button class="sb-btn" onclick={findHubs} disabled={hubs.finding}>
      {hubs.finding ? 'finding…' : 'find hubs'}
    </button>
    {#each hubs.found as f (f.hub_instance_id)}
      <button class="sb-hub ws mono" onclick={() => connectWs(f.ip, f.ws_port)}>
        <span class="hub-name">{f.hub_name || 'hub'}</span>
        <span>{f.ip}:{f.ws_port}</span>
        <span>{f.fw_version || '?'}</span>
        {#if f.pairing_window_open}<span class="hub-pair">pairing</span>{/if}
      </button>
    {/each}
  </div>
  <div class="hp-row">
    <button class="sb-btn" onclick={scan}>{hubs.scanning ? 'stop' : 'scan BLE'}</button>
    {#each hubs.ble as h (h.address)}
      {@const adv = advFlags(h)}
      <button class="sb-hub mono" onclick={() => pickBle(h)}>
        <span class="hub-name">{h.name || 'hub'}</span>
        <span>{h.address}</span>
        {#if h.rssi}<span>{h.rssi} dBm</span>{/if}
        {#if adv?.pairing}<span class="hub-pair">pairing</span>{/if}
        {#if adv?.ws}<span class="hub-pair">WS</span>{/if}
      </button>
    {/each}
    {#if hubs.scanning && hubs.ble.length === 0}<span class="sb-note">scanning…</span>{/if}
  </div>
  <HostEntry value={hubs.manualHost} onpick={connectWs} />
  {#if hubs.target}
    <button class="sb-btn sb-upgrade" onclick={upgrade}>↑ WS {hubs.target.host}:{hubs.target.port}</button>
  {/if}
  {#if hubs.note}<p class="sb-note">{hubs.note}</p>{/if}
  {#if hubs.stats}<p class="sb-note mono">{hubs.stats}</p>{/if}
</div>

<style>
  .hp { display: flex; flex-direction: column; gap: 10px; max-width: 720px; }
  .hp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .sb-btn, .sb-hub {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 40px;
    padding: 0 12px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 12.5px;
  }
  .sb-btn:hover { border-color: var(--line-4); }
  .sb-upgrade {
    align-self: flex-start;
    border-color: color-mix(in srgb, var(--reality) 45%, var(--line));
    background: color-mix(in srgb, var(--reality) 12%, var(--bg-card));
    color: var(--reality);
  }
  .sb-hub { border: 1px dashed color-mix(in srgb, var(--intent) 55%, var(--line)); }
  .sb-hub .hub-name { font-weight: 600; color: var(--intent); }
  .sb-hub .hub-pair { color: var(--reality); font-weight: 600; }
  /* Solid border: a WS candidate from UDP discovery, not a BLE scan hit. */
  .sb-hub.ws { border-style: solid; }
  .sb-note { color: var(--ink-dim); font-style: italic; font-size: 11px; }
</style>
