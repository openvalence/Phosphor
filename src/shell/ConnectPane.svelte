<script>
  /**
   * ConnectPane.svelte -- the connecting page's ways out in the shell (DESIGN
   * §10.19): the address, the saved hubs with Neutrino last, and what a scan
   * finds. SHELL ONLY: settings-pane.js hands it to HubPicker through
   * panes.js `bootPane`. Renders hubs.svelte.js and prefs.js; owns no state.
   *
   * Constraints:
   * - Every way out is here, none behind the menu: the page shows while no
   *   catalog is in (a redial included).
   * - Found rows come last, so a scan appending one moves nothing above it.
   * - One LAN scan on arrival (UDP, no permission prompt); Bluetooth only on
   *   Scan, which asks for the permission.
   * - The rows are HubsPane's look and motion (DESIGN §10.13: a row rises in,
   *   rows that stay slide) without its upkeep (rename, Sim, Forget, setup):
   *   that pane stays the place to manage hubs. The status lines change on
   *   the frame (a degradation is never animated).
   */
  import { onMount, untrack } from 'svelte';
  import HostEntry from '../ui/HostEntry.svelte';
  import { hubs, scanHubs, pickBle, connectWs } from './hubs.svelte.js';
  import { foundVia } from './found.js';
  import { machine, hostLabel } from '../model/machine.svelte.js';
  import { savedHubs, hubLabel } from '../model/prefs.js';
  import { endpointLabel } from '../model/format.js';
  import { BUILTIN_MACHINE_NAME, BUILTIN_MACHINE_BADGE, BUILTIN_MACHINE_BADGE_TIP } from '../model/builtin.js';
  import { openVirtual, onSim } from './virtual.svelte.js';
  import { flipMove, rise } from '../ui/motion.js';
  import '../ui/pane.css';

  const link = $derived(machine.link);
  // The address field starts on what is being dialed (a typed or saved WS endpoint); a Bluetooth or virtual link has none.
  const dialing = untrack(() => (link.host && !link.virtual && hubs.mode !== 'ble' && link.host !== 'builtin' ? hostLabel(link.host, link.port) : hubs.manualHost || ''));
  const dialedWs = (host, port) => link.phase !== 'idle' && link.dialed === endpointLabel(host, port, null);
  const scanText = $derived(hubs.finding ? 'Searching LAN' : hubs.scanning ? 'Scanning Bluetooth' : hubs.note);

  onMount(() => { scanHubs({ ble: false }); });
</script>

<div class="cp">
  <HostEntry value={dialing} onpick={connectWs} recent={false} />

  <h3 class="cp-head">Machines</h3>
  <ul class="pane-list cp-rows">
    {#each $savedHubs as h (h.id)}
      {@const on = dialedWs(h.host, h.port)}
      <li animate:flipMove in:rise>
        <span class="who"><span class="name">{hubLabel(h)}</span><span class="meta mono">{h.host}:{h.port}</span></span>
        <button type="button" class="og-btn sm" disabled={on} aria-label={'Connect ' + hubLabel(h)}
                onclick={() => connectWs(h.host, h.port)}>{on ? 'Dialing' : 'Connect'}</button>
      </li>
    {/each}
    <li>
      <span class="who">
        <span class="name">{BUILTIN_MACHINE_NAME}<span class="mark virt" role="img" tabindex="0" data-glyph={BUILTIN_MACHINE_BADGE} data-tip={BUILTIN_MACHINE_BADGE_TIP} aria-label={BUILTIN_MACHINE_BADGE_TIP}></span></span>
        <span class="meta">The hub as software</span>
      </span>
      <button type="button" class="og-btn sm" disabled={onSim()} aria-label={'Connect ' + BUILTIN_MACHINE_NAME}
              onclick={() => openVirtual()}>Connect</button>
    </li>
  </ul>

  <div class="cp-find">
    <h3 class="cp-head">Found</h3>
    <button type="button" class="og-btn sm" disabled={hubs.finding || hubs.scanning} data-tip="LAN first, then Bluetooth" onclick={() => scanHubs()}>Scan</button>
    <span class="pane-status" role="status" data-phase={hubs.finding || hubs.scanning ? 'pending' : null}>{scanText}</span>
  </div>
  {#if hubs.found.length}
    <ul class="pane-list cp-rows">
      {#each hubs.found as f (f.key)}
        {@const on = !!f.lan && dialedWs(f.lan.ip, f.lan.ws_port)}
        <li animate:flipMove in:rise>
          <span class="who">
            <span class="name">{f.lan?.hub_name || f.ble?.name || 'hub'}{#each foundVia(f) as v (v)}<span class="mark">{v}</span>{/each}</span>
            <span class="meta mono">{f.lan ? f.lan.ip + ':' + f.lan.ws_port : f.ble.address}</span>
          </span>
          <button type="button" class="og-btn sm" disabled={on}
                  onclick={() => (f.lan ? connectWs(f.lan.ip, f.lan.ws_port) : pickBle(f.ble))}>{on ? 'Dialing' : 'Connect'}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cp { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
  .cp-head { margin: var(--sp-2) 0 0; font-size: .72rem; font-weight: 500; text-transform: uppercase; letter-spacing: .12em; color: var(--tx-mut); }
  .cp-find { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
  .cp-find .cp-head { margin: 0; }
  .cp-find .pane-status { flex: 1; min-width: 0; }
  .cp-rows > li { flex-wrap: nowrap; justify-content: space-between; }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .who > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { font-weight: 500; }
  .meta { font-size: .72rem; color: var(--tx-mut); }
  .mark { margin-left: var(--sp-3); padding: 0 var(--sp-2); font-size: .68rem; font-weight: 400; border: 1px solid var(--line); border-radius: var(--r-s); color: var(--tx-mut); }
  /* Its own token, never warn: amber means caution (§10.10). */
  .mark.virt { border-color: var(--neutrino); color: var(--neutrino); }
  .mark.virt::before { content: attr(data-glyph); }
</style>
