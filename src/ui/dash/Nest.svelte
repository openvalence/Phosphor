<script>
  /**
   * Nest.svelte -- a control holding a subgrid, scrolling or fixed (DESIGN
   * §10.6). Rendered by DashGrid as a nest item's body; its members are a
   * nested DashGrid over the nest's own placement map. The nest's title is
   * edited inline in its card head (DashItem `retitle`).
   *
   * Constraints:
   * - The bar sits outside the scroll region and always carries the in-flight
   *   count of every present member, the way drillCard does: a scrolling or
   *   collapsed nest never hides pending or degraded state (RENDERING §9). The
   *   bar is always drawn, so the count appearing never shifts the layout
   *   (law 5). Collapsing hides the members, never the bar.
   * - A member's fields for the count: `fields`, else `group.fields`.
   * - Stacked (phone width) a nest never scrolls by itself, so it can never
   *   trap the page scroll (test/responsive-matrix.mjs).
   * - Members the catalog lacks are inert: never drawn, never deleted, counted
   *   in edit mode only.
   */
  import DashGrid from './DashGrid.svelte';
  import { statusOf, STATUS } from '../../model/shadow.svelte.js';

  let { item, parent, editing = false, stack = false, candidates = [], announce = () => {}, ondropkey = null,
    ondragout = null, target = false } = $props();

  const n = $derived(item.nest);
  const sub = $derived(parent.nest(item.id));
  const inert = $derived(n.keys.length - item.members.length);
  const busy = $derived(item.members.reduce((c, m) =>
    c + (m.fields || (m.group && m.group.fields) || []).filter((f) => statusOf(f) !== STATUS.confirmed).length, 0));

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
  function fold() {
    const on = !n.collapsed;
    if (parent.setNest(item.id, { collapsed: on })) announce(n.title + (on ? ' collapsed' : ' expanded'));
  }
</script>

<div class="nest" class:scrolls={n.scroll && !stack} class:collapsed={n.collapsed}>
  <div class="nest-bar">
    <button type="button" class="og-btn sm nest-fold" aria-expanded={!n.collapsed}
            aria-label={(n.collapsed ? 'Expand ' : 'Collapse ') + n.title} title={n.collapsed ? 'Expand' : 'Collapse'}
            onclick={fold}><span aria-hidden="true">{n.collapsed ? '▸' : '▾'}</span></button>
    <span>{item.members.length} control{item.members.length === 1 ? '' : 's'}</span>
    {#if busy}<span class="nest-busy" data-shadow="pending">{busy} in flight</span>{/if}
    {#if editing}
      {#if inert}<span class="nest-inert">{inert} not on this machine</span>{/if}
      <select class="og-btn sm" aria-label={'Add to ' + n.title} onchange={add}>
        <option value="">Add…</option>
        {#each candidates as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
      </select>
      <button type="button" class="og-btn sm" aria-pressed={n.scroll} title="Switch between scrolling and fixed"
              onclick={toggleScroll}>{n.scroll ? 'Scrolling' : 'Fixed'}</button>
      <button type="button" class="og-btn sm"
              onclick={() => announce(parent.saveModule(item.id, n.title) ? 'Saved module ' + n.title : 'A module named ' + n.title + ' exists; rename the nest first')}>Save module</button>
      <button type="button" class="og-btn sm"
              onclick={() => parent.removeNest(item.id) && announce('Ungrouped ' + n.title)}>Ungroup</button>
    {/if}
  </div>
  {#if !n.collapsed}
    <div class="nest-body">
      {#if !item.members.length}
        <p class="nest-empty">{editing ? 'Drop controls here' : 'Empty nest'}</p>
      {/if}
      <DashGrid items={item.members} layout={sub} {editing} {ondropkey} {ondragout} {target}
                onremove={(id) => parent.nestOut(item.id, id) && announce('Moved out of ' + n.title)} />
    </div>
  {/if}
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
  .nest-fold { min-width: 40px; min-height: 40px; padding: 0; font-size: .9rem; }
  .nest-busy { color: var(--intent); }
  .nest-body { position: relative; }
  /* Over the subgrid, never in its way: a drop still lands on the grid below. */
  .nest-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    font-size: .8rem;
    color: var(--ink-faint);
    pointer-events: none;
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
