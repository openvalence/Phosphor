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
   * - Rows never move: discovery and scan results keep first-seen order and
   *   their last-seen time (hubs.svelte.js upsert); status lines are fixed
   *   slots.
   * - Saved hubs are prefs.js's; a hub is saved once it is live over WiFi.
   * - Virtual Valence (virtual.svelte.js) is always the last row, marked
   *   virtual; Sim opens it on a saved hub's vault record.
   */
  import HostEntry from '../ui/HostEntry.svelte';
  import { advFlags } from './ble-adv.js';
  import { hubs, findHubs, scan, pickBle, connectWs, upgrade } from './hubs.svelte.js';
  import { machine, disconnect, retryNow } from '../model/machine.svelte.js';
  import { savedHubs, renameHub, forgetHub, hubLabel } from '../model/prefs.js';
  import { since, endpointLabel } from '../model/format.js';
  import { hasMachine, BUILTIN_KEY } from '../model/vault.js';
  import { openVirtual } from './virtual.svelte.js';
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
  const discoveryText = $derived(hubs.finding ? 'Searching WiFi'
    : hubs.scanning ? 'Scanning Bluetooth'
      : hubs.note);
</script>

<div class="pane-stack hp">
  <section class="pane-sec og-panel" aria-labelledby="hp-link">
    <div class="pane-head"><h2 id="hp-link">Connection</h2></div>
    <dl class="pane-facts">
      <dt>Hub</dt><dd class="mono">{link.dialed || '--'}</dd>
      <dt>Transport</dt><dd>{idle ? '--' : link.virtual ? 'Virtual (in page)' : hubs.mode === 'ble' ? 'Bluetooth' : 'WiFi (WebSocket)'}</dd>
      <dt>Link</dt><dd>{link.phase}</dd>
      <dt>Bluetooth wire</dt><dd class="mono">{hubs.stats || '--'}</dd>
    </dl>
    <div class="row">
      <button type="button" class="og-btn" disabled={idle} onclick={disconnect}>Disconnect</button>
      <button type="button" class="og-btn" disabled={link.phase !== 'retrying' && link.phase !== 'failed'} onclick={retryNow}>Retry now</button>
      <button type="button" class="og-btn" disabled={!hubs.target}
              title={hubs.target ? '' : 'No WiFi endpoint known'}
              onclick={upgrade}>Upgrade to WiFi{hubs.target ? ' (' + hubs.target.host + ':' + hubs.target.port + ')' : ''}</button>
    </div>
    <p class="pane-status" role="status" data-phase={ladder.phase} title={ladder.text}>{ladder.text}</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="hp-saved">
    <div class="pane-head"><h2 id="hp-saved">Saved hubs</h2><span class="mono count">{$savedHubs.length}</span></div>
    {#if !$savedHubs.length}
      <p class="pane-empty">No saved hubs yet</p>
    {/if}
      <ul class="pane-list rows">
        {#each $savedHubs as h (h.id)}
          <li>
            <span class="who">
              <label class="nick">
                <span class="sr-only">Nickname for {hubLabel(h)}</span>
                <input type="text" value={h.nickname} placeholder={h.name || 'Nickname'} maxlength="40"
                       onchange={(e) => renameHub(h.id, e.currentTarget.value)} />
              </label>
              <span class="meta mono" title={h.host + ':' + h.port}>{h.host}:{h.port}{h.name && h.nickname ? ' · ' + h.name : ''}</span>
            </span>
            <span class="seen mono">{dialedWs(h.host, h.port) ? 'connected' : onVirtual(h.id) ? 'virtual' : 'seen ' + ago(h.lastSeen, now)}</span>
            <span class="acts">
              <button type="button" class="og-btn sm" disabled={dialedWs(h.host, h.port)} onclick={() => connectWs(h.host, h.port)}>Connect</button>
              <button type="button" class="og-btn sm" disabled={onVirtual(h.id) || !hasMachine(h.id)}
                      title={hasMachine(h.id) ? 'Virtual, from its last catalog' : 'No cached catalog'}
                      aria-label={'Sim ' + hubLabel(h)} onclick={() => openVirtual(h.id, hubLabel(h))}>Sim</button>
              <button type="button" class="og-btn sm" onclick={() => forgetHub(h.id)} aria-label={'Forget ' + hubLabel(h)}>Forget</button>
            </span>
          </li>
        {/each}
        <li class="virtual">
          <span class="who">
            <span class="name">Virtual Valence<span class="mark virt">virtual</span></span>
            <span class="meta mono" title="built-in machine · nothing moves">built-in machine · nothing moves</span>
          </span>
          <span class="seen mono">{onVirtual(BUILTIN_KEY) ? 'connected' : 'in page'}</span>
          <span class="acts">
            <button type="button" class="og-btn sm" disabled={onVirtual(BUILTIN_KEY)} onclick={() => openVirtual()}>Connect</button>
          </span>
        </li>
      </ul>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="hp-find">
    <div class="pane-head"><h2 id="hp-find">Find a hub</h2></div>
    <div class="row">
      <button type="button" class="og-btn" disabled={hubs.finding} onclick={findHubs}>Find on WiFi</button>
      <button type="button" class="og-btn" class:on={hubs.scanning} aria-pressed={hubs.scanning} onclick={scan}>
        {hubs.scanning ? 'Stop Bluetooth scan' : 'Scan Bluetooth'}
      </button>
    </div>
    <HostEntry value={hubs.manualHost} onpick={connectWs} recent={false} />
    <p class="pane-status" role="status" data-phase={hubs.finding || hubs.scanning ? 'pending' : null} title={discoveryText}>{discoveryText}</p>

    <h3 class="sub">On WiFi</h3>
    {#if !hubs.found.length}
      <p class="pane-empty">None found yet</p>
    {:else}
      <ul class="pane-list rows">
        {#each hubs.found as f (f.hub_instance_id || f.ip + ':' + f.ws_port)}
          <li>
            <span class="who">
              <span class="name">{f.hub_name || 'hub'}{#if f.pairing_window_open}<span class="mark">pairing open</span>{/if}</span>
              <span class="meta mono" title={f.ip + ':' + f.ws_port}>{f.ip}:{f.ws_port} · fw {f.fw_version || '?'}{f.hub_instance_id ? ' · id ' + f.hub_instance_id : ''}</span>
            </span>
            <span class="seen mono">{dialedWs(f.ip, f.ws_port) ? 'connected' : 'seen ' + ago(f.seenAt, now)}</span>
            <span class="acts">
              <button type="button" class="og-btn sm" disabled={dialedWs(f.ip, f.ws_port)} onclick={() => connectWs(f.ip, f.ws_port)}>Connect</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <h3 class="sub">On Bluetooth</h3>
    {#if !hubs.ble.length}
      <p class="pane-empty">None found yet</p>
    {:else}
      <ul class="pane-list rows">
        {#each hubs.ble as h (h.address)}
          {@const adv = advFlags(h)}
          <li>
            <span class="who">
              <span class="name">{h.name || 'hub'}{#if adv?.configMode}<span class="mark setup">needs setup</span>{/if}{#if adv?.pairing}<span class="mark">pairing open</span>{/if}</span>
              <span class="meta mono" title={h.address}>{h.address}{h.rssi ? ' · ' + h.rssi + ' dBm' : ''}{adv?.ws ? ' · WiFi offered' : ''}</span>
            </span>
            <span class="seen mono">{'seen ' + ago(h.seenAt, now)}</span>
            <span class="acts">
              <button type="button" class="og-btn sm" onclick={() => pickBle(h)}>Connect</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .count { font-size: .75rem; color: var(--tx-mut); }
  .sub { margin: 4px 0 0; font-size: .7rem; font-weight: 500; text-transform: uppercase; letter-spacing: .1em; color: var(--tx-mut); }
  /* Every row is the same two-line box: who on the left, last seen and the
     actions on the right. */
  .rows > li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; min-height: 58px; }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .who > span, .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { font-weight: 500; }
  .meta { font-size: .72rem; color: var(--tx-mut); }
  .seen { font-size: .72rem; color: var(--tx-mut); text-align: right; }
  .acts { display: flex; gap: 6px; }
  .mark { margin-left: 8px; padding: 0 6px; font-size: .68rem; font-weight: 400; border: 1px solid var(--reality); border-radius: var(--r-s); color: var(--reality); }
  .mark.setup { border-color: var(--intent); color: var(--intent); }
  .mark.virt { border-color: var(--warn); color: var(--warn); }
  .nick input {
    width: 100%;
    min-height: 30px;
    padding: 2px 8px;
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
