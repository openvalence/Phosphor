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
   * - An overlay on the top grid's top right corner, never in the page flow
   *   (ph-wia): edit mode draws the grid where it runs. It grows with its
   *   open sections and the page scrolls, never the palette; the grid
   *   toolbar's Modules toggle (dashboard.svelte.js `palette`) puts it away
   *   so the cards under it can be reached.
   */
  import { placeable, MODULE_MIME } from '../model/grid.js';
  import { palette } from '../model/dashboard.svelte.js';

  let { entries, placed, nests = [], onadd, onremove } = $props();

  let q = $state('');
  let into = $state('');
  $effect(() => {
    palette.shown = true;
    return () => { palette.shown = false; };
  });
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

{#if palette.open}
<section class="palette surface-card" aria-label="Module palette" bind:offsetHeight={palette.h}>
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
              <span class="palette-tag" title="A grid copy of a strip control">
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
{/if}

<style>
  /* Over the grid, out of flow: anchored to the top grid's top right
     (DashGrid's --dash-grid) where anchor positioning exists, else just
     under the grid's toolbar row. */
  .palette {
    position: absolute;
    z-index: 4;
    right: var(--gap);
    width: min(320px, calc(100% - 2 * var(--gap)));
    margin-top: 40px;
    padding: 8px 12px;
    box-shadow: 0 10px 28px rgba(var(--shade-rgb), .6);
  }
  @supports (top: anchor(top)) {
    .palette { position-anchor: --dash-grid; top: anchor(top); right: anchor(right); margin: 0; }
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
  /* Information, not a hazard: red stays the e-stop's (law 13). */
  .palette-tag {
    font-size: .72rem;
    color: var(--tx-mut);
    border: 1px solid var(--line-2);
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
