<script>
  /**
   * Nest.svelte -- a control holding a fixed subgrid (DESIGN §10.6). Rendered
   * by DashGrid as a nest item's body; its members are a nested DashGrid over
   * the nest's own placement map. The nest's title is edited inline in its
   * card head (DashItem `retitle`).
   *
   * Constraints:
   * - Never scrolls and never folds (operator ruling 2026-10-02): the nest
   *   grows to fit every member (DashGrid's content floor), so nothing in it
   *   is out of view.
   * - The bar still carries the in-flight count of every present member, the
   *   way a card head counts its own (DashItem; RENDERING §9, law 9): pending
   *   and overdue writes, overdue in amber, never a refused one (ph-sbu). It
   *   is always drawn, so the count appearing never shifts the layout (law 5).
   * - A member's fields for the count: `fields`, else `group.fields`.
   * - Members the catalog lacks are inert: never drawn, never deleted, counted
   *   in edit mode only.
   * - The bar is one row in both modes: its edit ops sit out of flow at its
   *   right end and yield their place to a member selection (ph-wia).
   * - The subgrid's columns are the nest's own `w` (ph-nnl): it reaches over
   *   the frame's padding and gutter (`--bleed`) so a member sits at its
   *   stored cells, under the top grid's columns.
   */
  import DashGrid from './DashGrid.svelte';
  import { inFlight } from './DashItem.svelte';

  let { item, parent, editing = false, candidates = [], announce = () => {}, ondropkey = null,
    ondragout = null, target = false } = $props();

  const n = $derived(item.nest);
  const sub = $derived(parent.nest(item.id));
  const inert = $derived(n.keys.length - item.members.length);
  const busy = $derived(inFlight(item.members.flatMap((m) => m.fields || (m.group && m.group.fields) || [])));
  let picked = $state(0);

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
    {#if busy.n}<span class="nest-busy" class:overdue={busy.overdue}>{busy.n} in flight</span>{/if}
    {#if editing}
      <div class="nest-ops" class:yield={picked}>
        {#if inert}<span class="nest-inert">{inert} not on this machine</span>{/if}
        <select class="og-btn sm" aria-label={'Add to ' + n.title} onchange={add}>
          <option value="">Add…</option>
          {#each candidates as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
        </select>
        <button type="button" class="og-btn sm"
                onclick={() => announce(parent.saveModule(item.id, n.title) ? 'Saved module ' + n.title : 'Module name taken: ' + n.title)}>Save module</button>
        <button type="button" class="og-btn sm"
                onclick={() => parent.removeNest(item.id) && announce('Ungrouped ' + n.title)}>Ungroup</button>
      </div>
    {/if}
  </div>
  <div class="nest-body">
    {#if !item.members.length}
      <p class="nest-empty">{editing ? 'Drop controls here' : 'Empty nest'}</p>
    {/if}
    <DashGrid items={item.members} layout={sub} {editing} {ondropkey} {ondragout} {target} bind:picked
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px 12px;
    height: 30px;
    font-size: .8rem;
    color: var(--ink-dim);
    white-space: nowrap;
  }
  @media (pointer: coarse) { .nest-bar { height: 40px; } }
  /* Words and color only (ph-sbu): intent while in flight, amber once overdue. */
  .nest-busy { color: var(--intent); }
  .nest-busy.overdue { color: var(--warn); }
  /* Out of flow at the bar's right end, wrapping downward over the subgrid
     on a nest narrower than they are. */
  .nest-ops {
    position: absolute;
    z-index: 3;
    top: 0;
    right: 0;
    max-width: 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px 12px;
  }
  .nest-ops.yield { visibility: hidden; }
  .nest-body {
    position: relative;
    --bleed: calc(var(--dash-cell-pad, 7px) + 1px + var(--dash-body-pad, var(--gap)));
    margin-inline: calc(-1 * var(--bleed));
  }
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
