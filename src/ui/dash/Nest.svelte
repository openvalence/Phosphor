<script>
  /**
   * Nest.svelte -- a control holding a fixed subgrid (DESIGN §10.6). Rendered
   * by DashGrid as a nest item's body; its members are a nested DashGrid over
   * the nest's own placement map. The nest's title is edited inline in its
   * card head (DashItem `retitle`).
   *
   * Constraints:
   * - Never scrolls and never folds (operator ruling 2026-10-02): the subgrid
   *   grows its rows to fit every member, so nothing in it is out of view.
   * - The bar still carries the in-flight count of every present member, the
   *   way a card head counts its own (DashItem; RENDERING §9, law 9). It is always drawn, so the
   *   count appearing never shifts the layout (law 5).
   * - A member's fields for the count: `fields`, else `group.fields`.
   * - Members the catalog lacks are inert: never drawn, never deleted, counted
   *   in edit mode only.
   */
  import DashGrid from './DashGrid.svelte';
  import { statusOf, STATUS } from '../../model/shadow.svelte.js';

  let { item, parent, editing = false, candidates = [], announce = () => {}, ondropkey = null,
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
</script>

<div class="nest">
  <div class="nest-bar">
    <span>{item.members.length} control{item.members.length === 1 ? '' : 's'}</span>
    {#if busy}<span class="nest-busy" data-shadow="pending">{busy} in flight</span>{/if}
    {#if editing}
      {#if inert}<span class="nest-inert">{inert} not on this machine</span>{/if}
      <select class="og-btn sm" aria-label={'Add to ' + n.title} onchange={add}>
        <option value="">Add…</option>
        {#each candidates as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
      </select>
      <button type="button" class="og-btn sm"
              onclick={() => announce(parent.saveModule(item.id, n.title) ? 'Saved module ' + n.title : 'Module name taken: ' + n.title)}>Save module</button>
      <button type="button" class="og-btn sm"
              onclick={() => parent.removeNest(item.id) && announce('Ungrouped ' + n.title)}>Ungroup</button>
    {/if}
  </div>
  <div class="nest-body">
    {#if !item.members.length}
      <p class="nest-empty">{editing ? 'Drop controls here' : 'Empty nest'}</p>
    {/if}
    <DashGrid items={item.members} layout={sub} {editing} {ondropkey} {ondragout} {target}
              onremove={(id) => parent.nestOut(item.id, id) && announce('Moved out of ' + n.title)} />
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
    min-height: 30px;
    font-size: .8rem;
    color: var(--ink-dim);
  }
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
</style>
