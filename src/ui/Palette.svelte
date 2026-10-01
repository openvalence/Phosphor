<script>
  /**
   * Palette.svelte: every module the home can place (DESIGN §10.1), grouped
   * by section, each with Add or Remove, placed at the top level or into a
   * chosen nest. Knows no catalog: Home.svelte hands it [{id, title, section,
   * kind}], the placed key set and the view's nests.
   */
  import { placeable } from '../model/grid.js';

  let { entries, placed, nests = [], onadd, onremove } = $props();

  let q = $state('');
  let into = $state('');
  const target = $derived(nests.some((n) => n.id === into) ? into : '');
  const sections = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map();
    for (const e of entries) {
      if (needle && !e.title.toLowerCase().includes(needle)) continue;
      if (!m.has(e.section)) m.set(e.section, []);
      m.get(e.section).push(e);
    }
    return [...m];
  });
</script>

<section class="palette og-panel" aria-label="Module palette">
  <div class="palette-bar">
    <input class="palette-filter" type="search" placeholder="Filter modules" aria-label="Filter modules" bind:value={q} />
    {#if nests.length}
      <select class="og-btn sm" aria-label="Place into" bind:value={into}>
        <option value="">Top level</option>
        {#each nests as n (n.id)}<option value={n.id}>{n.title}</option>{/each}
      </select>
    {/if}
  </div>
  {#each sections as [name, list] (name)}
    <details open={!!q.trim()}>
      <summary>{name} <span class="palette-n">{list.length}</span></summary>
      <ul>
        {#each list as e (e.id)}
          <li data-key={e.id}>
            <span class="palette-title">{e.title}</span>
            {#if placed.has(e.id)}
              <button type="button" class="og-btn sm" aria-label={'Remove ' + e.title} onclick={() => onremove(e.id)}>Remove</button>
            {:else}
              <button type="button" class="og-btn sm" aria-label={'Add ' + e.title}
                      disabled={!placeable(e.kind, !!target)} onclick={() => onadd(e.id, target)}>Add</button>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/each}
</section>

<style>
  .palette {
    max-height: 40vh;
    overflow-y: auto;
    padding: 8px 12px;
  }
  .palette-bar {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .palette-filter {
    flex: 1 1 auto;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
    font-size: .85rem;
  }
  summary {
    cursor: pointer;
    padding: 6px 0;
    font-size: .8rem;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--ink-dim);
  }
  .palette-n { color: var(--ink-faint); font-family: var(--mono); }
  ul {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    gap: 4px 12px;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .palette-title {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: .85rem;
  }
</style>
