<script>
  /**
   * HubPicker.svelte — where the link stands, and what the operator can do
   * about it. Never a silent spinner.
   *
   *   mode 'boot'  no catalog yet: status, retry, and (outside the shell) the
   *                hub field and remembered hubs. file:// and a failed first
   *                connect land here instead of on a blank page.
   *   mode 'link'  catalog adopted but the link is down: one status line and
   *                Retry now. The page below stays, dimmed stale (law 8), and
   *                re-adopts whatever the hub pushes when it returns.
   *   mode 'tier'  live at watch: why, and the way to control (Pairing).
   *
   * Constraints:
   * - Renders link state only; never machine values, never a write.
   * - In the shell the hub field lives in ShellStrip (same HostEntry). Showing
   *   a second one here would be two doors to one room.
   */
  import HostEntry from './HostEntry.svelte';
  import { machine, retryNow, switchHub, hostLabel } from '../model/machine.svelte.js';
  import { ACCESS } from '../../../Valence/clients/js/index.js';

  let { mode = 'boot', onpair = null } = $props();

  const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
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
  const status = $derived.by(() => {
    if (!hub) return 'No hub chosen. This page was opened without one.';
    switch (link.phase) {
      case 'live': return 'Connected to ' + hub + '. Receiving catalog' + (receiveS ? ' (' + receiveS + ' s)' : '') + '…';
      case 'handshaking': return 'Reached ' + hub + '. Handshaking…';
      case 'retrying':
        return 'No link to ' + hub + (link.closeReason ? ' (' + link.closeReason + ')' : '') + '. '
          + (waitS != null ? 'Retrying in ' + waitS + ' s' : 'Retrying')
          + (link.attempts > 1 ? ', attempt ' + link.attempts : '') + '.';
      case 'failed': return 'Link to ' + hub + ' closed' + (link.closeReason ? ': ' + link.closeReason : '') + '.';
      case 'idle': return 'Paused while this page is hidden.';
      default: return 'Connecting to ' + hub + '…';
    }
  });
</script>

{#if mode === 'boot'}
  <section class="picker og-panel" aria-labelledby="picker-title">
    <h2 id="picker-title" class="pk-title">Hub</h2>
    <p class="pk-status" role="status" data-phase={link.phase}>{status}</p>
    {#if down}
      <button type="button" class="og-btn primary" onclick={retryNow}>Retry now</button>
    {/if}
    {#if SHELL}
      <p class="pk-note">Find or enter a hub under Phosphor &gt; Hubs.</p>
    {:else}
      <HostEntry onpick={switchHub} value={link.host ? hub : ''} />
      <p class="pk-note">
        A page served by the hub itself needs nothing here. Anywhere else, add
        <code>?hub=&lt;address&gt;</code> to this page's URL, or enter the address
        above; the page remembers the hubs it reached.
      </p>
      <p class="pk-note">
        A page that did not come from the hub cannot fetch a control credential
        (<code>/uitoken</code> answers its own origin only), so it joins at
        <b>watch</b>: it sees everything and can stop the machine, but cannot command
        it. Once connected, pair from the Pairing tab to gain control.
      </p>
    {/if}
  </section>
{:else if mode === 'link' && down}
  <div class="pk-line" role="status" data-phase={link.phase}>
    <span>{status} Values below are the last the hub reported.</span>
    <button type="button" class="og-btn sm" onclick={retryNow}>Retry now</button>
  </div>
{:else if mode === 'tier' && link.phase === 'live' && link.roles === ACCESS.watch}
  <div class="pk-line tier" role="note">
    <span>
      Watch tier: this session can observe and stop, not command.
      {crossOrigin ? 'This page did not come from the hub, so it had no control credential.' : 'The hub granted watch to this session.'}
    </span>
    {#if onpair}<button type="button" class="og-btn sm" onclick={onpair}>Pair for control</button>{/if}
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(100%, 52ch);
    margin: var(--gap) auto;
    padding: 18px;
  }
  .pk-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--ink-faint);
  }
  .pk-status { color: var(--ink); }
  .pk-status[data-phase='retrying'],
  .pk-status[data-phase='failed'] { color: var(--warn); }
  .picker > .og-btn { align-self: flex-start; }
  .pk-note { color: var(--ink-dim); font-size: .85rem; }
  .pk-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-top: 6px;
    padding: 6px 10px;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: .85rem;
  }
  .pk-line > span { flex: 1 1 24ch; }
  .pk-line.tier { border-color: var(--line-2); color: var(--ink-dim); }
</style>
