<script>
  /**
   * Palette.svelte: every module the home can place (DESIGN §10.1), grouped
   * by section, each with Add or Remove, placed at the top level or into a
   * chosen nest, by click or by dragging the entry onto a grid. Knows no
   * catalog: Home.svelte hands it [{id, title, section, kind, control?}], the
   * placed key set and the view's nests.
   *
   * Constraints:
   * - A field entry lists its offered presentations (settings.js
   *   offeredPresentations, the derived one first); each adds the field with
   *   that look. The search matches titles, sections and presentations.
   * - Safety ops are strip-bound: the top strip always carries them, a grid
   *   copy is optional and top level only (grid.js placeable).
   */
  import { placeable, MODULE_MIME } from '../model/grid.js';

  let { entries, placed, nests = [], onadd, onremove } = $props();

  let q = $state('');
  let into = $state('');
  const target = $derived(nests.some((n) => n.id === into) ? into : '');
  const sections = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map();
    for (const e of entries) {
      const hay = [e.title, e.section, ...(e.control?.presentations || [])].join(' ').toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      if (!m.has(e.section)) m.set(e.section, []);
      m.get(e.section).push(e);
    }
    return [...m];
  });
  const canAdd = (e) => !placed.has(e.id) && placeable(e.kind, !!target);
  function dragStart(e, entry) {
    e.dataTransfer.setData(MODULE_MIME, entry.id);
    e.dataTransfer.effectAllowed = 'copy';
  }
</script>

<section class="palette og-panel" aria-label="Module palette">
  <div class="palette-bar">
    <input class="palette-filter" type="search" placeholder="Search modules or looks" aria-label="Search modules" bind:value={q} />
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
          <li data-key={e.id} draggable={canAdd(e)} ondragstart={(ev) => dragStart(ev, e)} class:grabbable={canAdd(e)}>
            <span class="palette-title">{e.title}</span>
            {#if e.kind === 'safety'}
              <span class="palette-tag" title="The top strip always carries this control; a grid copy is optional and sits at the top level only">
                {target ? 'Strip and top level only' : 'Also in the strip'}</span>
            {/if}
            {#if placed.has(e.id)}
              <button type="button" class="og-btn sm" aria-label={'Remove ' + e.title} onclick={() => onremove(e.id)}>Remove</button>
            {:else}
              <button type="button" class="og-btn sm" aria-label={'Add ' + e.title}
                      disabled={!canAdd(e)} onclick={() => onadd(e.id, target)}>Add</button>
            {/if}
            {#if e.control?.presentations?.length > 1}
              <div class="palette-looks" role="group" aria-label={'Looks for ' + e.title}>
                {#each e.control.presentations as p (p)}
                  <button type="button" class="look-chip" disabled={!canAdd(e)} aria-label={'Add ' + e.title + ' as ' + p}
                          onclick={() => onadd(e.id, target, p)}>{p}</button>
                {/each}
              </div>
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
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
  }
  li.grabbable { cursor: grab; }
  .palette-title {
    flex: 1 1 0;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: .85rem;
  }
  .palette-tag {
    font-size: .72rem;
    color: var(--bad);
    border: 1px solid currentColor;
    border-radius: var(--radius);
    padding: 1px 6px;
  }
  .palette-looks {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .look-chip {
    font: inherit;
    font-size: .72rem;
    padding: 1px 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-dim);
    cursor: pointer;
  }
  .look-chip:hover:not(:disabled) { color: var(--intent); border-color: var(--intent); }
  .look-chip:disabled { opacity: .45; cursor: not-allowed; }
  @media (pointer: coarse) { .look-chip { min-height: 40px; min-width: 40px; } }
</style>
