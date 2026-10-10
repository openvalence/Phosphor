<script>
  /**
   * HealthLine.svelte -- under a health Log line (ph-9t5l): the plain detail,
   * what was measured, the threshold, the one action, the evidence and Send
   * report, folded until asked.
   * Renders nothing once the incident is no longer kept.
   */
  import { health } from '../../model/health/health.svelte.js';
  import { CONDITIONS, evidenceText } from '../../model/health/core.js';
  import { logView } from '../logview.svelte.js';

  let { id } = $props();
  const inc = $derived(health.incidents.find((i) => i.id === id));
  const d = $derived(inc && CONDITIONS[inc.cond]);
</script>

{#if inc}
  <details class="hl">
    <summary>Details</summary>
    {#if d.detail}<p>{d.detail}</p>{/if}
    {#each inc.tip || [] as l, k (k)}<p class:act={l === d.action}>{l}</p>{/each}
    <p class="ev mono">{[inc.why, evidenceText(inc.evidence)].filter(Boolean).join(' · ')}</p>
    <button type="button" class="og-btn sm" onclick={() => { health.review = id; logView.tab = 'health'; }}>Send report</button>
  </details>
{/if}

<style>
  .hl { flex: 1 1 100%; font-size: .75rem; color: var(--ink-dim); }
  .hl summary { cursor: pointer; color: var(--tx-mut); font-size: .7rem; }
  .hl p { margin: var(--sp-1) 0; }
  .hl .act { color: var(--ink); }
  .hl .ev { color: var(--tx-mut); font-size: .68rem; overflow-wrap: anywhere; }
</style>
