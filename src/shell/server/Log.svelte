<script>
  /**
   * Log.svelte -- the buttplug server's log tail (bp://log; docs/BUTTPLUG.md)
   * with a level filter and a copy to the clipboard.
   *
   * Constraints:
   * - The filter is this view's only: what the server sends is set by the
   *   log level setting. Warn and error read amber, never red (law 13).
   * - Times are the server's stamps, shown in this host's local time.
   */
  import { LEVELS, logAt } from '../bp-server.js';

  let { s, bp } = $props();

  let level = $state('info');
  const shown = $derived(logAt(s.log, level));
  const at = (l) => (l.time != null ? new Date(l.time).toLocaleTimeString() : '');
</script>

<div class="sp-row">
  <label class="sp-field">show
    <select bind:value={level}>
      {#each LEVELS as l}<option value={l}>{l} and above</option>{/each}
    </select>
  </label>
  <button class="og-btn sm sp-btn" disabled={!shown.length || s.copy.phase === 'pending'}
          onclick={() => bp.copyLog(level)}>Copy</button>
  {#if s.copy.reason}<span class="sp-ladder" data-phase={s.copy.phase}>{s.copy.reason}</span>{/if}
  <span class="sp-note">{shown.length} of {s.log.length} lines, server level {s.settings?.log_level ?? '--'}</span>
</div>

{#if shown.length}
  <ol class="lg mono">
    {#each shown as l}
      <li data-level={l.level}><span class="lg-t">{at(l)}</span> <span class="lg-lvl">{l.level}</span> {l.msg}</li>
    {/each}
  </ol>
{:else}
  <p class="sp-note">nothing logged at this level yet</p>
{/if}

<style>
  .lg {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 22em;
    overflow-y: auto;
    font-size: .72rem;
    color: var(--ink-dim);
    overflow-wrap: anywhere;
  }
  .lg-t, .lg-lvl { color: var(--ink-faint); }
  .lg-lvl { text-transform: uppercase; }
  .lg li[data-level='warn'] .lg-lvl, .lg li[data-level='error'] .lg-lvl { color: var(--warn-ink); }
  .lg li[data-level='error'] { color: var(--ink); }
</style>
