<script>
  /**
   * SetupFlow.svelte -- Set up a machine: pick a Valence hub over Bluetooth,
   * ask configure, then the setup category wizard, then the WiFi handover.
   * SHELL ONLY: renders hubs.svelte.js's setup state (ble-setup.js is the
   * state machine); owns no state of its own.
   *
   * Constraints:
   * - The WiFi step is the network picker (the saved-networks plugin's module,
   *   mounted here with this session's credential binding: Join) where the hub
   *   lists networks (RFC-118 draft); elsewhere ProvisionWizard over the
   *   catalog's setup category. Never a hub-specific screen. This file draws
   *   the steps around it: the list, the Pair prompt, the handover.
   * - The status slot is one fixed line; a state change never moves a button.
   * - Needs-setup hubs sort first; every row still connects.
   */
  import { advFlags } from './ble-adv.js';
  import { needsSetup, SETUP } from './ble-setup.js';
  import { hubs, scan, setup, startSetup, retrySetup, backToList, closeSetup, setupAct } from './hubs.svelte.js';
  import { machine } from '../model/machine.svelte.js';
  import { provisionCategory } from '../ui/wizard/steps.js';
  import ProvisionWizard from '../ui/ProvisionWizard.svelte';
  import PluginSlot from '../plugins/PluginSlot.svelte';
  import { shellApi } from '../plugins/plugins.svelte.js';
  import { mountNetworkPicker, networkPickerReady, NETWORK_PICKER_SPEC } from '../plugins/factory.js';
  import { claimRoles } from '../model/roles.js';
  import '../ui/pane.css';
  import { rise } from '../ui/motion.js';

  const st = $derived(setup.st);
  const cat = $derived(provisionCategory(machine.catalog.model));
  // The wizard owns the card from the grant until the join is answered; a
  // refused join returns to it with the reason as its note.
  const inWizard = $derived(st.step === SETUP.granted || st.step === SETUP.provisioning
    || (st.step === SETUP.failed && st.retry === 'join'));
  const picked = $derived(machine.catalog.model ? claimRoles(machine.catalog.model.byRole, NETWORK_PICKER_SPEC) : null);
  const picker = $derived(!!picked && networkPickerReady(shellApi, picked));
  // PluginSlot's host surface over the shell-mounted picker; its join presses drive the flow (setupAct).
  const PICKER = { host: {
    mountHero: (h, node, f) => mountNetworkPicker(shellApi, node, f, { join: setupAct }),
    updateHero: (i) => i && i.update(),
    unmountHero: (i) => i && i.unmount(),
  } };
  const note = $derived(st.text ? { phase: st.phase, text: st.text } : null);
  const listing = $derived(st.step === SETUP.scanning);
  const again = $derived(st.step === SETUP.failed ? { ask: 'Ask again', handover: 'Try again', connect: 'Reconnect' }[st.retry] : null);
</script>

{#if inWizard && picker}
  <div class="su" role="dialog" aria-labelledby="su-title" in:rise>
    <header><h2 id="su-title">Wi-Fi</h2></header>
    <PluginSlot hero={PICKER} fields={picked} />
    <div class="acts"><button type="button" class="og-btn" onclick={closeSetup}>Close</button></div>
  </div>
{:else if inWizard && cat}
  <ProvisionWizard category={cat} onclose={closeSetup} onact={setupAct} {note} />
{:else}
  <div class="su" role="dialog" aria-labelledby="su-title" in:rise>
    <header><h2 id="su-title">Set up a machine</h2></header>

    {#if listing}
      {#if !setup.devs.length}
        <p class="pane-empty">{hubs.scanning ? 'Scanning Bluetooth' : 'No hub on Bluetooth'}</p>
      {:else}
        <ul class="pane-list">
          {#each setup.devs as d (d.address)}
            {@const adv = advFlags(d)}
            <li>
              <span class="who">
                <span class="name">{d.name || 'hub'}{#if needsSetup(adv)}<span class="mark">needs setup</span>{/if}</span>
                <span class="meta mono">{d.address}{d.rssi ? ' · ' + d.rssi + ' dBm' : ''}</span>
              </span>
              <button type="button" class="og-btn sm" onclick={() => startSetup(d)}>Set up</button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if st.step === SETUP.granted || st.step === SETUP.provisioning}
      <p class="pane-empty">{machine.catalog.ready ? 'No setup settings on this hub' : 'Loading the hub catalog'}</p>
    {/if}

    <p class="pane-status" role="status" data-phase={listing ? (hubs.scanning ? 'pending' : null) : st.phase}
       data-tip={st.text}>{listing ? '' : st.text}</p>

    <div class="acts">
      {#if listing}
        <button type="button" class="og-btn" class:on={hubs.scanning} aria-pressed={hubs.scanning} onclick={scan}>
          {hubs.scanning ? 'Stop scan' : 'Scan'}
        </button>
      {:else if st.step === SETUP.failed}
        <button type="button" class="og-btn" onclick={backToList}>Hub list</button>
        {#if again}<button type="button" class="og-btn primary" onclick={retrySetup}>{again}</button>{/if}
      {/if}
      <button type="button" class="og-btn" class:primary={st.step === SETUP.done} onclick={closeSetup}>
        {st.step === SETUP.done ? 'Done' : 'Close'}
      </button>
    </div>
  </div>
{/if}

<style>
  /* ProvisionWizard's band: below the top strip (z 30), so its stop stays reachable. */
  .su {
    position: fixed;
    z-index: 28;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(calc(100vw - 2 * var(--gap)), 560px);
    max-height: 60dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(0, 0, 0, .6);
  }
  h2 { margin: 0; font-size: 1rem; color: var(--ink-hi); }
  .who { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; }
  .who > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { font-weight: 500; }
  .meta { font-size: .72rem; color: var(--tx-mut); }
  .mark { margin-left: var(--sp-3); padding: 0 var(--sp-2); font-size: .68rem; font-weight: 400; border: 1px solid var(--intent); border-radius: var(--r-s); color: var(--intent); }
  .acts { display: flex; gap: var(--sp-3); justify-content: flex-end; }
  .acts button { min-height: var(--tap); min-width: var(--tap); padding: 0 var(--sp-5); }
  .pane-list button { min-height: var(--tap); }
</style>
