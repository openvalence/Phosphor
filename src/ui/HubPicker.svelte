<script>
  /**
   * HubPicker.svelte — where the link stands, and what the operator can do
   * about it. Never a silent spinner.
   *
   *   mode 'boot'  no catalog yet, the connecting page (DESIGN §10.20): the
   *                status, the countdown, Retry now and Stop, Troubleshooting,
   *                and the ways out (the shell's bootPane; outside the shell
   *                the hub field and remembered hubs). file:// and a failed
   *                first connect land here instead of on a blank page.
   *   mode 'tier'  live at watch: why, and the way to control (Pairing).
   *
   * Constraints:
   * - Renders link state only; never machine values, never a write.
   * - Never a dead end: every way out is on this page, none behind the menu.
   * - The status block is fixed lines and the buttons fixed slots, so a phase
   *   change moves nothing (RENDERING law 5).
   */
  import HostEntry from './HostEntry.svelte';
  import MarkSpinner from './MarkSpinner.svelte';
  import { machine, retryNow, switchHub, hostLabel, disconnect } from '../model/machine.svelte.js';
  import { bootPane } from '../shell/panes.js';
  import { ACCESS } from '../../../Valence/clients/js/index.js';

  let { mode = 'boot', onpair = null } = $props();

  const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
  // The web builds reach Neutrino only (web/web.js): no hub field.
  const WEB = import.meta.env.MODE === 'web' || import.meta.env.MODE === 'mini';
  const link = $derived(machine.link);
  const hub = $derived(link.host ? hostLabel(link.host, link.port) : '');
  // Same-origin is the only page that can mint a control credential.
  const crossOrigin = $derived(typeof location !== 'undefined' && link.host !== location.hostname);

  // A 4 Hz clock while a countdown OR the catalog-receive elapsed time is on
  // screen (ph-vdk.37: this component only renders pre-catalog, so 'live'
  // always means "waiting on the catalog transfer" here).
  let now = $state(Date.now());
  $effect(() => {
    if (!((link.phase === 'retrying' && link.retryAt) || link.phase === 'live')) return;
    const t = setInterval(() => { now = Date.now(); }, 250);
    return () => clearInterval(t);
  });
  const waitS = $derived(link.retryAt ? Math.max(0, Math.ceil((link.retryAt - now) / 1000)) : null);
  // clients/js emits no BLOB progress event for the catalog transfer (ph-vdk.37
  // note), so there is no byte count to show. Elapsed time is the honest
  // substitute; a fake percentage is worse than none at all.
  const receiveS = $derived(link.since ? Math.max(0, Math.floor((now - link.since) / 1000)) : 0);

  const down = $derived(link.phase === 'retrying' || link.phase === 'failed');
  const dialing = $derived(!!hub && link.phase !== 'idle' && link.phase !== 'failed');
  // the link is on its way: dialing, handshaking, or receiving the catalog (this view is pre-catalog)
  const loading = $derived(!!hub && (link.phase === 'connecting' || link.phase === 'handshaking' || link.phase === 'live'));
  const status = $derived.by(() => {
    if (!hub) return 'No hub chosen';
    switch (link.phase) {
      case 'live': return 'Receiving catalog from ' + hub + (receiveS ? ' (' + receiveS + ' s)' : '') + '…';
      case 'handshaking': return 'Handshaking with ' + hub + '…';
      case 'retrying': return 'Redialing ' + hub;
      case 'failed': return 'Link to ' + hub + ' closed';
      // Hidden, the session also pauses as idle, but nobody sees this page then.
      case 'idle': return 'Stopped: ' + hub;
      default: return 'Connecting to ' + hub + '…';
    }
  });
  const countdown = $derived(link.phase !== 'retrying' ? ''
    : (waitS != null ? 'Next try in ' + waitS + ' s' : 'Next try soon') + (link.attempts > 1 ? ' · attempt ' + link.attempts : ''));
  const reason = $derived(down && link.closeReason ? link.closeReason : '');
  // The bar drains over the wait the library chose; keyed on retryAt, so each new wait starts it full.
  const drainMs = $derived(link.phase === 'retrying' && link.retryAt ? Math.max(0, link.retryAt - Date.now()) : 0);

  const DOCS = 'https://openvalence.org/phosphor/docs/troubleshooting/#s-find';
  let docsNote = $state('');
  // The shell opens the system browser (desktop); where it cannot (Android today) the address is copied instead.
  function openDocs(e) {
    if (!SHELL) return;
    e.preventDefault();
    const core = import('@tauri-apps/api/core');
    core.then(({ invoke }) => invoke('plugin_open_url', { url: DOCS }))
      .catch(() => core.then(({ invoke }) => invoke('plugin:clipboard-manager|write_text', { text: DOCS }))
        .then(() => { docsNote = 'Link copied'; }, () => { docsNote = DOCS; }));
  }
</script>

{#if mode === 'boot'}
  <section class="picker og-panel" aria-labelledby="picker-title">
    <div class="pk-head">
      <h2 id="picker-title" class="pk-title">Hub</h2>
      {#if !WEB}<a class="pk-docs" href={DOCS} target="_blank" rel="noopener" onclick={openDocs}>{docsNote || 'Troubleshooting'}</a>{/if}
    </div>
    <div class="pk-block" data-phase={link.phase}>
      <p class="pk-status" role="status">{#if loading}<MarkSpinner />{/if}<span>{status}</span></p>
      <p class="pk-count">{countdown}</p>
      <span class="pk-bar" aria-hidden="true">{#key link.retryAt}{#if drainMs}<i style:animation-duration={drainMs + 'ms'}></i>{/if}{/key}</span>
      <p class="pk-reason" data-tip={reason}>{reason}</p>
    </div>
    {#if hub}
      <div class="pk-acts">
        <button type="button" class="og-btn primary" disabled={!down} onclick={retryNow}>Retry now</button>
        <button type="button" class="og-btn" disabled={!dialing} onclick={disconnect}>Stop</button>
      </div>
    {/if}
    {#if SHELL}
      {#if $bootPane}{@const Ways = $bootPane}<Ways />{/if}
    {:else if !WEB}
      <HostEntry onpick={switchHub} value={link.host ? hub : ''} />
      <p class="pk-note">Enter an address, or add <code>?hub=&lt;address&gt;</code> to the URL</p>
      <p class="pk-note">Pages not served by the hub join at <b>watch</b></p>
    {/if}
  </section>
{:else if mode === 'tier' && link.phase === 'live' && link.roles === ACCESS.watch}
  <div class="pk-line tier" role="note">
    <span>
      Watch tier: observe and stop only{crossOrigin ? ' (page not served by the hub)' : ''}
    </span>
    {#if onpair}<button type="button" class="og-btn sm" onclick={onpair}>Pair for control</button>{/if}
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    width: min(100%, 52ch);
    margin: var(--gap) auto;
    padding: var(--sp-5);
  }
  .pk-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
  .pk-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--ink-faint);
  }
  /* A whole tap target (law 12), its ink the link's. */
  .pk-docs { display: inline-flex; align-items: center; min-height: var(--tap); font-size: .8rem; color: var(--intent); }
  /* Fixed lines and the bar's row: a phase change swaps text, never height. */
  .pk-block { display: grid; grid-template-rows: auto 1.4em 3px 1.4em; gap: var(--sp-1); }
  .pk-block p { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pk-status { display: flex; align-items: center; gap: var(--sp-3); color: var(--ink); }
  .pk-block:is([data-phase='retrying'], [data-phase='failed']) .pk-status { color: var(--warn-ink); }
  .pk-count { font: .85rem var(--mono); color: var(--ink); }
  .pk-reason { font-size: .8rem; color: var(--ink-dim); }
  .pk-bar { position: relative; overflow: hidden; border-radius: 1.5px; background: var(--line); }
  .pk-bar > i { position: absolute; inset: 0; background: var(--warn); transform-origin: left; animation: pk-drain linear forwards; }
  @keyframes pk-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  :global(html.still) .pk-bar > i { animation: none; }
  .pk-acts { display: flex; flex-wrap: wrap; gap: var(--sp-3); }
  .pk-note { color: var(--ink-dim); font-size: .85rem; }
  .pk-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3) var(--sp-4);
    margin-top: var(--sp-3);
    padding: var(--sp-3) var(--sp-3);
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: .85rem;
  }
  .pk-line > span { flex: 1 1 24ch; }
  .pk-line.tier { border-color: var(--line-2); color: var(--ink-dim); }
</style>
