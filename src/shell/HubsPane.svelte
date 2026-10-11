<script>
  /**
   * HubsPane.svelte -- Phosphor > Hubs: the link, saved hubs, discovery, the
   * BLE scan and a typed address. SHELL ONLY: settings-pane.js registers it
   * with panes.js. Renders hubs.svelte.js (transport) and prefs.js (saved
   * hubs); owns no state of its own beyond a clock.
   *
   * Constraints:
   * - The link ladder reads machine.link only: connecting and handshaking
   *   are pending, retrying is overdue, failed is the fault, live settles.
   *   Text always rides the color (RENDERING law 5); faults read amber.
   * - Scan is UDP first, Bluetooth fallback (hubs.svelte.js). Found rows are
   *   one list, one row per hub (found.js), marked LAN or BLE by the path that
   *   found it; a row with both connects over LAN.
   * - Rows never move: found rows keep first-seen order and their last-seen
   *   time; status lines are fixed slots.
   * - Saved hubs are prefs.js's; a hub is saved once it is live over WiFi.
   * - The built-in machine (virtual.svelte.js) is always the last row; its
   *   Connect boots it and offers Stop. Sim on a saved hub opens the replay
   *   of its vault record.
   */
  import HostEntry from '../ui/HostEntry.svelte';
  import { advFlags } from './ble-adv.js';
  import { hubs, scanHubs, scan, pickBle, connectWs, upgrade } from './hubs.svelte.js';
  import { foundVia } from './found.js';
  import { machine, disconnect, retryNow } from '../model/machine.svelte.js';
  import { savedHubs, renameHub, forgetHub, hubLabel } from '../model/prefs.js';
  import { nameInput, opensName } from './rename.js';
  import { since, endpointLabel } from '../model/format.js';
  import { hasMachine } from '../model/vault.js';
  import { BUILTIN_MACHINE_NAME, BUILTIN_MACHINE_BADGE } from '../model/builtin.js';
  import { openVirtual, sim, onSim } from './virtual.svelte.js';
  import '../ui/pane.css';

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  const ago = (ms, _now) => (ms ? since(ms) + ' ago' : '--');

  const link = $derived(machine.link);
  const idle = $derived(link.phase === 'idle' || !link.host);
  const ladder = $derived.by(() => {
    const who = link.dialed || link.host || 'the hub';
    switch (link.phase) {
      case 'connecting': return { phase: 'pending', text: 'Connecting to ' + who };
      case 'handshaking': return { phase: 'pending', text: 'Handshaking with ' + who };
      case 'retrying': return { phase: 'overdue', text: 'Retrying ' + who
        + (link.retryAt ? ' in ' + Math.max(0, Math.ceil((link.retryAt - now) / 1000)) + ' s' : '')
        + (link.closeReason ? ': ' + link.closeReason : '') };
      case 'failed': return { phase: 'fault', text: 'Failed: ' + (link.error || link.closeReason || 'the hub closed the link') };
      case 'live': return link.virtual ? { phase: 'settled', text: 'Virtual: nothing moves' }
        : { phase: 'settled', text: 'Live on ' + who + (hubs.mode === 'ble' ? ' over Bluetooth (watch tier)' : '') };
      default: return { phase: null, text: 'Not connected' };
    }
  });
  const dialedWs = (host, port) => link.phase !== 'idle' && link.dialed === endpointLabel(host, port, null);
  const onVirtual = (key) => link.phase !== 'idle' && !!link.virtual && link.virtual.key === key;
  const builtinMeta = $derived(sim.info ? 'Nucleus ' + sim.info.version : 'The hub as software');
  const discoveryText = $derived(hubs.finding ? 'Searching LAN'
    : hubs.scanning ? 'Scanning Bluetooth'
      : hubs.note);
</script>

<div class="pane-stack hp">
  <section class="pane-sec og-panel" aria-labelledby="hp-link">
    <div class="pane-head"><h2 id="hp-link">Connection</h2></div>
    <dl class="pane-facts">
      <dt>Hub</dt><dd class:mono={!!link.dialed}>{link.dialed || '--'}</dd>
      <dt>Transport</dt><dd>{idle ? '--' : link.virtual ? 'Virtual (in page)' : onSim() ? 'In app' : hubs.mode === 'ble' ? 'Bluetooth' : 'WiFi (WebSocket)'}</dd>
      <dt>Link</dt><dd>{link.phase}</dd>
      <dt>Bluetooth wire</dt><dd class:mono={!!hubs.stats}>{hubs.stats || '--'}</dd>
    </dl>
    <div class="row">
      <button type="button" class="og-btn" disabled={idle} onclick={disconnect}>Disconnect</button>
      <button type="button" class="og-btn" disabled={link.phase !== 'retrying' && link.phase !== 'failed'} onclick={retryNow}>Retry now</button>
      <button type="button" class="og-btn" disabled={!hubs.target}
              data-tip={hubs.target ? '' : 'No WiFi endpoint known'}
              onclick={upgrade}>Upgrade to WiFi{hubs.target ? ' (' + hubs.target.host + ':' + hubs.target.port + ')' : ''}</button>
    </div>
    <p class="pane-status" role="status" data-phase={ladder.phase} data-tip={ladder.text}>{ladder.text}</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="hp-saved">
    <div class="pane-head"><h2 id="hp-saved">Saved hubs</h2><span class="mono count">{$savedHubs.length}</span></div>
    {#if !$savedHubs.length}
      <p class="pane-empty">No saved hubs yet</p>
    {/if}
      <ul class="pane-list rows">
        {#each $savedHubs as h (h.id)}
          <li use:opensName={(li) => li.querySelector('.nick input')}>
            <span class="who">
              <label class="nick">
                <span class="sr-only">Nickname for {hubLabel(h)}</span>
                <input type="text" use:nameInput value={h.nickname} placeholder={h.name || 'Nickname'} maxlength="40"
                       onchange={(e) => renameHub(h.id, e.currentTarget.value)} />
              </label>
              <span class="meta mono" data-tip={h.host + ':' + h.port}>{h.host}:{h.port}{h.name && h.nickname ? ' · ' + h.name : ''}</span>
            </span>
            <span class="seen mono">{dialedWs(h.host, h.port) ? 'connected' : onVirtual(h.id) ? 'virtual' : 'seen ' + ago(h.lastSeen, now)}</span>
            <span class="acts">
              <button type="button" class="og-btn sm" disabled={dialedWs(h.host, h.port)} onclick={() => connectWs(h.host, h.port)}>Connect</button>
              <button type="button" class="og-btn sm" disabled={onVirtual(h.id) || !hasMachine(h.id)}
                      data-tip={hasMachine(h.id) ? 'Virtual, from its last catalog' : 'No cached catalog'}
                      aria-label={'Sim ' + hubLabel(h)} onclick={() => openVirtual(h.id, hubLabel(h))}>Sim</button>
              <button type="button" class="og-btn sm" onclick={() => forgetHub(h.id)} aria-label={'Forget ' + hubLabel(h)}>Forget</button>
            </span>
          </li>
        {/each}
        <li class="virtual">
          <span class="who">
            <span class="name">{BUILTIN_MACHINE_NAME}<span class="mark virt">{BUILTIN_MACHINE_BADGE}</span></span>
            <span class="meta mono" data-tip={builtinMeta}>{builtinMeta}</span>
          </span>
          <span class="seen mono">{onSim() ? 'connected' : 'built in'}</span>
          <span class="acts">
            {#if sim.info}
              <button type="button" class="og-btn sm" onclick={disconnect}>Stop</button>
            {:else}
              <button type="button" class="og-btn sm" onclick={() => openVirtual()}>Connect</button>
            {/if}
          </span>
        </li>
      </ul>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="hp-find">
    <div class="pane-head"><h2 id="hp-find">Find a hub</h2></div>
    <div class="row">
      <button type="button" class="og-btn" disabled={hubs.finding || hubs.scanning} data-tip="LAN first, then Bluetooth" onclick={() => scanHubs()}>Scan</button>
      <button type="button" class="og-btn" class:on={hubs.scanning} aria-pressed={hubs.scanning} onclick={scan}>
        {hubs.scanning ? 'Stop Bluetooth scan' : 'Scan Bluetooth'}
      </button>
    </div>
    <HostEntry value={hubs.manualHost} onpick={connectWs} recent={false} />
    <p class="pane-status" role="status" data-phase={hubs.finding || hubs.scanning ? 'pending' : null} data-tip={discoveryText}>{discoveryText}</p>

    {#if !hubs.found.length}
      <p class="pane-empty">None found yet</p>
    {:else}
      <ul class="pane-list rows">
        {#each hubs.found as f (f.key)}
          {@const adv = f.ble && advFlags(f.ble)}
          {@const live = !!f.lan && dialedWs(f.lan.ip, f.lan.ws_port)}
          <li>
            <span class="who">
              <span class="name">{f.lan?.hub_name || f.ble?.name || 'hub'}{#each foundVia(f) as v (v)}<span class="mark via">{v}</span>{/each}{#if adv?.configMode}<span class="mark setup">needs setup</span>{/if}{#if f.lan?.pairing_window_open || adv?.pairing}<span class="mark">pairing open</span>{/if}</span>
              {#if f.lan}
                <span class="meta mono" data-tip={f.lan.ip + ':' + f.lan.ws_port}>{f.lan.ip}:{f.lan.ws_port} · fw {f.lan.fw_version || '?'}{f.lan.hub_instance_id ? ' · id ' + f.lan.hub_instance_id : ''}</span>
              {:else}
                <span class="meta mono" data-tip={f.ble.address}>{f.ble.address}{f.ble.rssi ? ' · ' + f.ble.rssi + ' dBm' : ''}{adv?.ws ? ' · WiFi offered' : ''}</span>
              {/if}
            </span>
            <span class="seen mono">{live ? 'connected' : 'seen ' + ago(f.seenAt, now)}</span>
            <span class="acts">
              <button type="button" class="og-btn sm" disabled={live}
                      onclick={() => (f.lan ? connectWs(f.lan.ip, f.lan.ws_port) : pickBle(f.ble))}>Connect</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .row { display: flex; flex-wrap: wrap; gap: var(--sp-3); }
  .count { font-size: .75rem; color: var(--tx-mut); }
  /* Every row is the same two-line box: who on the left, last seen and the
     actions on the right. */
  .rows > li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; min-height: 58px; }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .who > span, .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { font-weight: 500; }
  .meta { font-size: .72rem; color: var(--tx-mut); }
  .seen { font-size: .72rem; color: var(--tx-mut); text-align: right; }
  .acts { display: flex; gap: var(--sp-2); }
  .mark { margin-left: var(--sp-3); padding: 0 var(--sp-2); font-size: .68rem; font-weight: 400; border: 1px solid var(--reality); border-radius: var(--r-s); color: var(--reality); }
  .mark.setup { border-color: var(--intent); color: var(--intent); }
  .mark.virt { border-color: var(--warn); color: var(--warn-ink, var(--warn)); }
  .mark.via { border-color: var(--line); color: var(--tx-mut); }
  .nick input {
    width: 100%;
    min-height: 30px;
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-s);
    border: 1px solid var(--line);
    background: var(--bg-sunken);
    color: var(--ink-hi);
    font: inherit;
    font-size: .8rem;
  }
  @media (pointer: coarse) { .nick input { min-height: 40px; } }
  /* Phones: last seen drops under the name so the actions keep their size. */
  @media (max-width: 480px) {
    .rows > li { grid-template-columns: minmax(0, 1fr) auto; }
    .seen { grid-column: 1; grid-row: 2; text-align: left; }
    .acts { grid-column: 2; grid-row: 1 / span 2; }
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
</style>
