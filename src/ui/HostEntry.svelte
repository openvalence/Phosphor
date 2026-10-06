<script>
  /**
   * HostEntry.svelte — type a hub address, or pick one this browser reached
   * before. Shared by the hosted page's HubPicker and the shell's ShellStrip,
   * so there is one host field in the codebase.
   *
   * Constraints:
   * - Picks only: `onpick(host, port)` decides what connecting means (the
   *   shell also records its transport mode). Never touches machine state.
   * - `port` is undefined unless typed as host:port; callers default it.
   */
  import { untrack } from 'svelte';
  import { parseHost, recentHubs } from '../model/machine.svelte.js';

  let { onpick, value = '', label = 'Connect', recent = true, dense = false } = $props();

  // Seeded once from `value`; after that the field is the operator's.
  let text = $state(untrack(() => value));
  const hubs = $derived(recent ? recentHubs() : []);

  function pick(t) {
    const { host, port } = parseHost(t);
    if (host) onpick(host, port);
  }
</script>

<form class="hostentry" class:dense onsubmit={(e) => { e.preventDefault(); pick(text); }}>
  <input class="he-host mono" bind:value={text} placeholder="hub address"
         aria-label="Hub address" autocapitalize="off" autocomplete="off"
         spellcheck="false" inputmode="url" />
  <button class="og-btn he-go" type="submit" disabled={!text.trim()}>{label}</button>
  {#if hubs.length}
    <div class="he-recent" role="group" aria-label="Recent hubs">
      {#each hubs as h (h)}
        <button type="button" class="og-btn he-hub mono" onclick={() => pick(h)}>{h}</button>
      {/each}
    </div>
  {/if}
</form>

<style>
  .hostentry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
  }
  .he-host {
    flex: 1 1 14ch;
    min-width: 0;
    min-height: var(--tap);
    padding: var(--sp-1) var(--sp-3);
    background: var(--bg-sunken);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: .9rem;
  }
  .he-recent {
    flex: 1 0 100%;
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
  }
  .he-hub { color: var(--intent); }
  /* Shell bar: one compact row, sized like its neighbors. */
  .dense { flex-wrap: nowrap; gap: var(--sp-3); }
  .dense .he-host { flex: 0 0 130px; min-height: 36px; font-size: 0.72rem; }
  .dense .he-go { min-height: 36px; font-size: 12.5px; }
</style>
