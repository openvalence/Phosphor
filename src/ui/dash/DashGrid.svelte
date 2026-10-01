<script>
  /**
   * DashGrid.svelte -- the builder grid: square device-px cells (DESIGN §10.5),
   * items placed at {x, y, w, h} in cells, named layouts and the scale
   * control (§10.6). Math and storage: model/grid.js via
   * model/dashboard.svelte.js.
   *
   * Contract: <DashGrid viewId="cat2" items={items} bind:editing />, `items`
   * [{id, title, snippet, kind?, fields?}], `id` a STABLE string (law 10),
   * `snippet` rendered as the body, `fields` (or `group.fields`) counted on a
   * nest's frame while in flight. Nests stored in the view are drawn as
   * items; an item that is a member of a nest is drawn inside it, not at the
   * top level. With `layout` (a dashboardLayout().nest(id) controller) this
   * is a nest's own subgrid: no toolbar, no nests inside.
   *
   * Constraints:
   * - A drag or resize is a preview (`pin`) until pointer-up; only the commit
   *   writes the layout, so every intermediate frame is cancelable.
   * - Rows are minmax(cell, auto): `h` is a floor, and a card whose content
   *   is taller grows its rows rather than clipping a control.
   * - Under 641 CSS px every item is stacked full width (mobile is
   *   ph-e82.7's ruling); a drag there commits a reading order, never cells.
   */
  import DashItem from './DashItem.svelte';
  import Nest from './Nest.svelte';
  import {
    dashboardLayout, grid, stepScale, layouts, layoutNames,
    switchLayout, saveLayoutAs, renameLayout, deleteLayout, moduleNames, deleteModule,
  } from '../../model/dashboard.svelte.js';
  import { cellCount, placeable } from '../../model/grid.js';
  import { view } from '../../model/viewport.svelte.js';

  let { viewId = '', items, editing = $bindable(false), layout: given = null, onremove = null } = $props();

  const layout = $derived(given || dashboardLayout(viewId, view.cls));
  const nests = $derived(given ? [] : layout.nests());
  const all = $derived.by(() => {
    if (!nests.length) return items;
    const byId = new Map(items.map((it) => [it.id, it]));
    const inNest = new Set(nests.flatMap((n) => n.keys));
    return [
      ...items.filter((it) => !inNest.has(it.id)),
      ...nests.map((n) => ({ id: n.id, title: n.title, kind: 'nest', snippet: nestCard, nest: n,
        members: n.keys.map((k) => byId.get(k)).filter(Boolean) })),
    ];
  });

  let width = $state(0);
  let winW = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
  const stack = $derived(winW <= 640);
  const cols = $derived(cellCount(width, grid.cell));

  let pin = $state(null);        // {id, x, y, w, h, mode} while a pointer drag is in flight
  let stackOrder = $state(null); // ids while a stacked drag is in flight
  let announceMsg = $state('');
  let nameDraft = $state('');
  let moduleDraft = $state('');

  const placed = $derived(layout.arrange(all, cols, pin && pin.mode !== 'stack' ? pin : null));
  const displayList = $derived.by(() => {
    if (!stackOrder) return placed;
    const byId = new Map(placed.map((p) => [p.id, p]));
    return stackOrder.map((id) => byId.get(id)).filter(Boolean);
  });

  let gridEl;
  /** @type {Map<string, HTMLElement>} */
  const cellEls = new Map();
  function registerCell(node, id) {
    cellEls.set(id, node);
    return { destroy() { if (cellEls.get(id) === node) cellEls.delete(id); } };
  }

  const announce = (msg) => { announceMsg = msg; };
  const titleOf = (id) => (all.find((it) => it.id === id) || {}).title || id;
  const where = (p) => 'column ' + (p.x + 1) + ', row ' + (p.y + 1) + ', ' + p.w + ' by ' + p.h + ' cells';

  /** Client point -> cell; rows past the grid's end are cell-sized. */
  function cellAt(clientX, clientY) {
    const r = gridEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(cols - 1, Math.floor((clientX - r.left) / grid.cell)));
    const tracks = getComputedStyle(gridEl).gridTemplateRows.split(' ').map(parseFloat).filter(Number.isFinite);
    let y = 0, top = r.top;
    for (; y < tracks.length && clientY >= top + tracks[y]; y++) top += tracks[y];
    if (y === tracks.length) y += Math.max(0, Math.floor((clientY - top) / grid.cell));
    return { x, y };
  }

  // ---- pointer: move / resize ------------------------------------------------
  function grabStart(id) {
    if (stack) { stackOrder = placed.map((p) => p.id); pin = { id, mode: 'stack' }; return; }
    const p = placed.find((q) => q.id === id);
    if (p) pin = { id, x: p.x, y: p.y, w: p.w, h: p.h, mode: 'move' };
  }
  function resizeStart(id) {
    const p = placed.find((q) => q.id === id);
    if (p && !stack) pin = { id, x: p.x, y: p.y, w: p.w, h: p.h, mode: 'resize' };
  }
  function pointerMove(id, clientX, clientY) {
    if (!pin || pin.id !== id) return;
    if (pin.mode === 'stack') {
      for (const [other, el] of cellEls) {
        if (other === id) continue;
        const r = el.getBoundingClientRect();
        if (clientY < r.top || clientY > r.bottom) continue;
        const ids = stackOrder.filter((x) => x !== id);
        ids.splice(ids.indexOf(other) + (clientY < r.top + r.height / 2 ? 0 : 1), 0, id);
        stackOrder = ids;
        return;
      }
      return;
    }
    const c = cellAt(clientX, clientY);
    pin = pin.mode === 'move'
      ? { ...pin, x: c.x, y: c.y }
      : { ...pin, w: Math.max(1, c.x - pin.x + 1), h: Math.max(1, c.y - pin.y + 1) };
  }
  function pointerEnd(id) {
    if (!pin || pin.id !== id) return;
    if (pin.mode === 'stack') {
      layout.order(all, cols, stackOrder);
      announce(titleOf(id) + ' moved to position ' + (stackOrder.indexOf(id) + 1) + ' of ' + stackOrder.length);
    } else {
      layout.move(all, cols, pin);
      const p = layout.arrange(all, cols).find((q) => q.id === id);
      if (p) announce(titleOf(id) + ' at ' + where(p));
    }
    pin = null;
    stackOrder = null;
  }

  // ---- keyboard ------------------------------------------------------------------
  // Up/Down walk the reading order (parity with the old reorder); Left/Right
  // step one cell; shift + arrows resize.
  function keyMove(id, dx, dy) {
    const ids = placed.map((p) => p.id);
    const i = ids.indexOf(id);
    if (i < 0) return;
    if (dy) {
      const to = i + dy;
      if (to < 0 || to >= ids.length) return;
      [ids[i], ids[to]] = [ids[to], ids[i]];
      layout.order(all, cols, ids);
      announce(titleOf(id) + ' moved to position ' + (to + 1) + ' of ' + ids.length);
    } else if (!stack) {
      const p = placed[i];
      layout.move(all, cols, { id, x: p.x + dx, y: p.y, w: p.w, h: p.h });
      const q = layout.arrange(all, cols).find((r) => r.id === id);
      if (q) announce(titleOf(id) + ' at ' + where(q));
    }
  }
  function keyResize(id, dw, dh) {
    const p = placed.find((q) => q.id === id);
    if (!p || stack) return;
    layout.move(all, cols, { id, x: p.x, y: p.y, w: Math.max(1, p.w + dw), h: Math.max(1, p.h + dh) });
    const q = layout.arrange(all, cols).find((r) => r.id === id);
    if (q) announce(titleOf(id) + ' resized to ' + q.w + ' by ' + q.h + ' cells');
  }

  // ---- toolbar -------------------------------------------------------------------
  function resetLayout() {
    layout.reset();
    pin = null;
    stackOrder = null;
    announce('Layout reset to default');
  }
  function setEditing(on) {
    editing = on;
    pin = null;
    stackOrder = null;
    announce('Layout edit mode ' + (on ? 'on' : 'off'));
  }
  function nameOp(fn, ok, fail) {
    if (fn(nameDraft)) { announce(ok + ' ' + nameDraft.trim()); nameDraft = ''; } else announce(fail);
  }
  function newNest() {
    const id = layout.addNest();
    if (id) announce('Added an empty nest');
  }
  function insertModule() {
    if (moduleDraft && layout.insertModule(moduleDraft)) announce('Placed module ' + moduleDraft);
  }
</script>

{#snippet nestCard(item)}
  <Nest {item} parent={layout} {editing} {stack} {announce}
        candidates={all.filter((it) => it.kind !== 'nest' && placeable(it.kind, true))} />
{/snippet}

<svelte:window onresize={() => (winW = window.innerWidth)} />

<div class="dash-wrap">
  {#if !given}
  <div class="dash-toolbar">
    <div class="scale" role="group" aria-label="Scale">
      <button type="button" class="og-btn sm" aria-label="Scale down"
              disabled={grid.scale === grid.steps[0]} onclick={() => stepScale(-1)}>−</button>
      <button type="button" class="og-btn sm" aria-label="Reset scale"
              title="Reset scale" onclick={() => stepScale(0)}>{Math.round(grid.scale * 100)}%</button>
      <button type="button" class="og-btn sm" aria-label="Scale up"
              disabled={grid.scale === grid.steps[grid.steps.length - 1]} onclick={() => stepScale(1)}>+</button>
    </div>
    {#if editing}
      <select class="layout-pick" aria-label="Layout" value={layouts.active}
              onchange={(e) => switchLayout(e.currentTarget.value) && announce('Layout ' + layouts.active)}>
        {#each layoutNames() as n (n)}<option value={n}>{n}</option>{/each}
      </select>
      <input class="layout-name" type="text" aria-label="Layout name" placeholder="Layout name" bind:value={nameDraft} />
      <button type="button" class="og-btn sm" disabled={!nameDraft.trim()}
              onclick={() => nameOp(saveLayoutAs, 'Saved layout', 'That name is taken')}>Save as</button>
      <button type="button" class="og-btn sm" disabled={!nameDraft.trim()}
              onclick={() => nameOp((n) => renameLayout(layouts.active, n), 'Renamed to', 'That name is taken')}>Rename</button>
      <button type="button" class="og-btn sm" disabled={layoutNames().length < 2}
              onclick={() => { const n = layouts.active; if (deleteLayout(n)) announce('Deleted layout ' + n); }}>Delete</button>
      <button type="button" class="og-btn sm" onclick={resetLayout}>Reset layout</button>
      <button type="button" class="og-btn sm" onclick={newNest}>New nest</button>
      {#if moduleNames().length}
        <select class="layout-pick" aria-label="Module" bind:value={moduleDraft}>
          <option value="">Module…</option>
          {#each moduleNames() as n (n)}<option value={n}>{n}</option>{/each}
        </select>
        <button type="button" class="og-btn sm" disabled={!moduleDraft} onclick={insertModule}>Insert</button>
        <button type="button" class="og-btn sm" disabled={!moduleDraft}
                onclick={() => { const n = moduleDraft; if (deleteModule(n)) { moduleDraft = ''; announce('Deleted module ' + n); } }}>Delete module</button>
      {/if}
      <button type="button" class="done-btn og-btn sm" onclick={() => setEditing(false)}>Done</button>
    {:else}
      <button type="button" class="og-btn sm" onclick={() => setEditing(true)}>Edit layout</button>
    {/if}
  </div>
  {/if}

  <div class="dash-grid" class:stack bind:this={gridEl} bind:clientWidth={width} data-view={given ? null : view.cls + '.' + viewId}
       style={'--cell:' + grid.cell + 'px;--cols:' + cols}>
    {#each displayList as item, i (item.id)}
      <div class="dash-cell" data-id={item.id} use:registerCell={item.id}
           style={stack ? '' : 'grid-column:' + (item.x + 1) + ' / span ' + item.w + ';grid-row:' + (item.y + 1) + ' / span ' + item.h}>
        <DashItem
          {item}
          w={item.w}
          h={item.h}
          pidx={String(i + 1).padStart(2, '0')}
          {editing}
          {stack}
          dragging={pin?.id === item.id}
          ongrabstart={() => grabStart(item.id)}
          ongrabmove={(x, y) => pointerMove(item.id, x, y)}
          ongrabend={() => pointerEnd(item.id)}
          onresizestart={() => resizeStart(item.id)}
          onresizemove={(x, y) => pointerMove(item.id, x, y)}
          onresizeend={() => pointerEnd(item.id)}
          onkeymove={(dx, dy) => keyMove(item.id, dx, dy)}
          onkeyresize={(dw, dh) => keyResize(item.id, dw, dh)}
          onremove={onremove && placeable(item.kind, false) ? () => onremove(item.id) : null}
        />
      </div>
    {/each}
  </div>

  <div class="sr-only" aria-live="polite">{announceMsg}</div>
</div>

<style>
  .dash-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dash-toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }
  .scale { display: flex; gap: 2px; margin-right: auto; }
  .scale button { min-width: 40px; font-variant-numeric: tabular-nums; }
  .layout-pick { width: auto; }
  .layout-name {
    width: 12em;
    padding: 6px 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
    font-size: .82rem;
  }
  .done-btn {
    color: var(--ink-hi);
    border-color: var(--line-4);
  }

  /* Tracks are exactly one cell; the spacing lives inside .dash-cell so the
     cell pitch IS the cell edge (test/dash-measure.test.mjs measures it). */
  .dash-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--cell));
    grid-auto-rows: minmax(var(--cell), auto);
    min-width: 0;
  }
  .dash-grid.stack { grid-template-columns: minmax(0, 1fr); }

  /* .og-panel's outline paints 4px outside each card's border box; 7px of
     padding keeps neighboring outlines apart and off the grid's edge. */
  .dash-cell {
    padding: 7px;
    min-width: 0;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
