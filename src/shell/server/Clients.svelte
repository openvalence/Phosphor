<script>
  /**
   * Clients.svelte -- the apps connected to the buttplug server (bp_clients,
   * bp://clients; docs/BUTTPLUG.md), each with a disconnect.
   *
   * Constraints:
   * - Shows the server's list only: name from the handshake, peer address,
   *   connected since (the server's clock), message rate counted per whole
   *   second. A disconnect is pending until the client leaves the list.
   * - One client at a time, as Intiface: the listener takes the next app once
   *   this one leaves, so an app that reconnects by itself comes straight back.
   */
  let { s, bp } = $props();

  const since = (ms) => new Date(ms).toLocaleTimeString();
</script>

<ul class="cl-list">
  {#each s.conns as c (c.id)}
    {@const o = s.ops['kick:' + c.id]}
    <li class="cl">
      <span class="cl-name">{c.name ?? 'handshaking…'}</span>
      <span class="mono cl-fact">{c.address}</span>
      <span class="cl-fact">since {since(c.since)}</span>
      <span class="mono cl-fact">{c.rate} msg/s, {c.messages} in all</span>
      <button class="og-btn sm sp-btn" disabled={o?.phase === 'pending'} onclick={() => bp.kick(c)}>Disconnect</button>
      {#if o?.reason}<span class="sp-ladder" data-phase={o.phase}>{o.reason}</span>{/if}
    </li>
  {:else}
    <li class="sp-note">{s.running ? 'no app connected' : 'server stopped'}</li>
  {/each}
</ul>
<p class="sp-note">one app at a time</p>

<style>
  .cl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
  .cl { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); }
  .cl-name { font-weight: 600; }
  .cl-fact { color: var(--ink-dim); font-size: .72rem; }
</style>
