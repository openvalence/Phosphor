<script>
  /**
   * Nest.svelte -- a control holding a subgrid, scrolling or fixed (DESIGN
   * §10.6). Rendered by DashGrid as a nest item's body; its members are a
   * nested DashGrid over the nest's own placement map.
   *
   * Constraints:
   * - The bar sits outside the scroll region and always carries the in-flight
   *   count of every present member, the way drillCard does: a scrolling nest
   *   never hides pending or degraded state (RENDERING §9). The bar is always
   *   drawn, so the count appearing never shifts the layout (law 5).
   * - A member's fields for the count: `fields`, else `group.fields`.
   * - Stacked (phone width) a nest never scrolls by itself, so it can never
   *   trap the page scroll (test/responsive-matrix.mjs).
   * - Members the catalog lacks are inert: never drawn, never deleted, counted
   *   in edit mode only.
   */
  import DashGrid from './DashGrid.svelte';
  import { statusOf, STATUS } from '../../model/shadow.svelte.js';

  let { item, parent, editing = false, stack = false, candidates = [], announce = () => {} } = $props();

  const n = $derived(item.nest);
  const sub = $derived(parent.nest(item.id));
  const inert = $derived(n.keys.length - item.members.length);
  const busy = $derived(item.members.reduce((c, m) =>
    c + (m.fields || (m.group && m.group.fields) || []).filter((f) => statusOf(f) !== STATUS.confirmed).length, 0));
  let titleDraft = $state('');

  function add(e) {
    const key = e.currentTarget.value;
    e.currentTarget.value = '';
    const c = candidates.find((x) => x.id === key);
    if (c && parent.nestAdd(item.id, key)) announce(c.title + ' moved into ' + n.title);
  }
  function toggleScroll() {
    const on = !n.scroll;
    if (parent.setNest(item.id, { scroll: on })) announce(n.title + (on ? ' scrolls' : ' is fixed'));
  }
  function rename() {
    if (titleDraft.trim() && parent.setNest(item.id, { title: titleDraft })) announce('Nest renamed to ' + titleDraft.trim());
    titleDraft = '';
  }
</script>

<div class="nest" class:scrolls={n.scroll && !stack}>
  <div class="nest-bar">
    <span>{item.members.length} control{item.members.length === 1 ? '' : 's'}</span>
    {#if busy}<span class="nest-busy" data-shadow="pending">{busy} in flight</span>{/if}
    {#if editing}
      {#if inert}<span class="nest-inert">{inert} not on this machine</span>{/if}
      <select class="og-btn sm" aria-label={'Add to ' + n.title} onchange={add}>
        <option value="">Add…</option>
        {#each candidates as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
      </select>
      <button type="button" class="og-btn sm" title="Switch between scrolling and fixed"
              onclick={toggleScroll}>{n.scroll ? 'Scrolling' : 'Fixed'}</button>
      <input class="nest-name" type="text" aria-label="Nest name" placeholder={n.title}
             bind:value={titleDraft} onchange={rename} />
      <button type="button" class="og-btn sm"
              onclick={() => announce(parent.saveModule(item.id, n.title) ? 'Saved module ' + n.title : 'A module named ' + n.title + ' exists')}>Save module</button>
      <button type="button" class="og-btn sm"
              onclick={() => parent.removeNest(item.id) && announce('Ungrouped ' + n.title)}>Ungroup</button>
    {/if}
  </div>
  <div class="nest-body">
    <DashGrid items={item.members} layout={sub} {editing}
              onremove={(id) => parent.nestRemove(item.id, id) && announce('Moved out of ' + n.title)} />
  </div>
</div>

<style>
  .nest {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 0;
  }
  .nest-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    font-size: .8rem;
    color: var(--ink-dim);
  }
  .nest-busy { color: var(--intent); }
  .nest-name {
    width: 9em;
    padding: 6px 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
  }
  /* contain: size zeroes the region's intrinsic height, so the nest fills the
     cells it was given instead of growing its rows to fit every member. */
  .nest.scrolls .nest-body {
    flex: 1 1 0;
    min-height: var(--tap);
    overflow-y: auto;
    contain: size;
  }
</style>
