<script>
  /**
   * RailLayouts.svelte -- the saved dash layouts as the Dash tab's sub-items
   * in the expanded rail (DESIGN §10.11): Default first and pinned, the rest
   * in the store's order, `+ Add layout` last, and a wrench on the selected
   * one that flips dashEdit.
   *
   * Constraints:
   * - The rows are plain buttons inside App.svelte's tablist: Tab reaches them,
   *   the tablist's arrow keys skip them. Selecting one is `onpick(name)`.
   * - Reorder: the grip drags (pointer) or Alt+Up/Down on the row moves it;
   *   delete is the x held 1 s (pointer, or Enter/Space held). Default has
   *   neither and never moves (grid.js pins it).
   * - F2 or a double-click renames in place (Enter or blur keeps, Escape
   *   reverts); Default is not renamable.
   * - A layout's name is a storage key (dashboard.svelte.js); every change
   *   goes through its exported edits, never the store directly.
   */
  import { flip } from 'svelte/animate';
  import { layouts, orderedLayoutNames, addLayout, moveLayout, deleteLayout, renameLayout, dashEdit } from '../model/dashboard.svelte.js';
  import { isStill } from '../ui/still.svelte.js';

  let { dashActive = false, onpick } = $props();

  const HOLD_MS = 1000;
  const stored = $derived(orderedLayoutNames());
  // While a grip is dragged the list previews the drop.
  let drag = $state(null);
  const names = $derived.by(() => {
    if (!drag) return stored;
    const rest = stored.filter((n) => n !== drag.name);
    rest.splice(drag.to, 0, drag.name);
    return rest;
  });
  let adding = $state(false);
  let draft = $state('');

  function startAdd() { draft = ''; adding = true; }
  function commitAdd() {
    const n = draft.trim();
    if (!n) { adding = false; return; }
    if (addLayout(n)) { adding = false; onpick(n, true); }
  }
  function focusOn(node) { node.focus(); }

  let renaming = $state(null);
  let name = $state('');
  function startRename(n) { if (n === 'Default') return; name = n; renaming = n; }
  function keepRename() {
    const from = renaming, to = name.trim();
    renaming = null;
    if (from && to && to !== from) renameLayout(from, to);
  }
  function selectOn(node) { node.focus(); node.select(); }

  let listEl;
  function gripDown(e, name) {
    if (e.button !== 0) return;
    e.preventDefault();
    const mids = [...listEl.querySelectorAll('[data-layout]')].filter((b) => b.dataset.layout !== name)
      .map((b) => { const r = b.getBoundingClientRect(); return r.top + r.height / 2; });
    drag = { name, to: stored.indexOf(name) };
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev) => { drag.to = Math.max(1, mids.filter((m) => m < ev.clientY).length); };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      if (drag.to !== stored.indexOf(name)) moveLayout(name, drag.to);
      drag = null;
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }
  function rowKey(e, n) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || n === 'Default') return;
    e.preventDefault();
    moveLayout(n, Math.max(1, stored.indexOf(n) + (e.key === 'ArrowUp' ? -1 : 1)));
    queueMicrotask(() => listEl.querySelector('[data-layout="' + CSS.escape(n) + '"]')?.focus());
  }

  // A hold fires once, after HOLD_MS; any release or leave before that is nothing.
  let holding = $state(null);
  let timer = 0;
  function holdStart(n) {
    holdStop();
    holding = n;
    timer = setTimeout(() => { holding = null; deleteLayout(n); }, HOLD_MS);
  }
  function holdStop() { clearTimeout(timer); holding = null; }
</script>

<div class="rail-sub" role="none" bind:this={listEl}>
  {#each names as n (n)}
    {@const on = dashActive && layouts.active === n}
    <div class="sub-row" role="none" class:dragging={drag?.name === n} animate:flip={{ duration: isStill() ? 0 : 200 }}>
      {#if renaming === n}
        <input class="sub-input" aria-label={'Rename ' + n} bind:value={name} use:selectOn
               onkeydown={(e) => { if (e.key === 'Enter') keepRename(); else if (e.key === 'Escape') renaming = null; }}
               onblur={keepRename} />
      {:else}
        <button type="button" class="rail-tab sub-layout" class:on data-layout={n}
                aria-current={on ? 'page' : undefined} title={n} onclick={() => onpick(n)}
                ondblclick={() => startRename(n)}
                onkeydown={(e) => { rowKey(e, n); if (e.key === 'F2') { e.preventDefault(); startRename(n); } }}>
          <span class="rail-name">{n}</span>
        </button>
      {/if}
      {#if n !== 'Default'}
        <span class="sub-grip" aria-hidden="true" title="Drag to reorder, Alt+Up or Down" onpointerdown={(e) => gripDown(e, n)}>
          <svg viewBox="0 0 8 12"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></svg>
        </span>
        <button type="button" class="sub-x" class:holding={holding === n} class:withwrench={on} aria-label={'Delete ' + n + ', hold 1 s'}
                title="Hold 1 s to delete" onpointerdown={() => holdStart(n)} onpointerup={holdStop} onpointerleave={holdStop}
                onpointercancel={holdStop} onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); holdStart(n); } }}
                onkeyup={holdStop} onblur={holdStop}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8"/></svg>
        </button>
      {/if}
      {#if on}
        <button type="button" class="rail-wrench" aria-pressed={dashEdit.on}
                title={dashEdit.on ? 'Done editing' : 'Edit layout'} aria-label={dashEdit.on ? 'Done editing' : 'Edit layout'}
                onclick={() => (dashEdit.on = !dashEdit.on)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 1.5a4 4 0 0 0-4.6 5.2L1.5 11.1a1.5 1.5 0 0 0 2.1 2.1l4.4-4.4A4 4 0 0 0 13.3 4.2L11 6.5 9.5 5l2.3-2.3a4 4 0 0 0-1.3-1.2z"/></svg>
        </button>
      {/if}
    </div>
  {/each}
  {#if adding}
    <div class="sub-row" role="none">
      <input class="sub-input" aria-label="New layout name" placeholder="Layout name" bind:value={draft} use:focusOn
             onkeydown={(e) => { if (e.key === 'Enter') commitAdd(); else if (e.key === 'Escape') adding = false; }}
             onblur={() => (adding = false)} />
    </div>
  {:else}
    <button type="button" class="rail-tab sub-layout add" onclick={startAdd}>
      <span class="rail-name">+ Add layout</span>
    </button>
  {/if}
</div>

<style>
  /* The sub-list's pill edge sits one step in from the Dash pill's; the text
     indent stays where a sub-item's always was. */
  .rail-sub { display: flex; flex-direction: column; gap: var(--sp-1); margin-left: var(--sp-3); }
  .sub-row { position: relative; display: flex; }
  .sub-row .sub-layout { flex: 1 1 auto; min-width: 0; }
  .rail-tab.sub-layout {
    min-height: 30px;
    padding-left: calc(var(--sp-5) + var(--sp-2) - var(--sp-3));
  }
  .sub-grip, .sub-x {
    position: absolute;
    top: 50%;
    translate: 0 -50%;
    display: none;
    place-items: center;
    padding: 0;
    color: var(--ink-faint);
  }
  .sub-grip { left: var(--sp-1); width: 10px; height: 20px; cursor: grab; touch-action: none; }
  .sub-grip svg { width: 8px; height: 12px; fill: currentColor; }
  .sub-x { right: var(--sp-1); width: 22px; height: 22px; border-radius: var(--radius); overflow: hidden; }
  .sub-x.withwrench { right: 30px; }
  .sub-x svg { position: relative; width: 9px; height: 9px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
  .sub-x::before { content: ''; position: absolute; inset: 0; width: 0; background: color-mix(in srgb, var(--warn) 45%, transparent); }
  .sub-x.holding::before { width: 100%; transition: width 1s linear; }
  .sub-x:hover, .sub-x:focus-visible, .sub-x.holding { color: var(--warn-ink); }
  .sub-row:hover .sub-grip, .sub-row:hover .sub-x, .sub-row:focus-within .sub-grip, .sub-row:focus-within .sub-x { display: grid; }
  .sub-row.dragging { opacity: .6; }
  @media (hover: none) { .sub-grip, .sub-x { display: grid; } }
  .sub-layout.add { color: var(--ink-faint); }
  .sub-layout.add:hover { color: var(--highlight); }
  .rail-wrench {
    position: absolute;
    right: var(--sp-1);
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--ink-dim);
    border-radius: var(--radius);
  }
  .rail-wrench svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .rail-wrench:hover, .rail-wrench[aria-pressed='true'] { color: var(--highlight); background: color-mix(in srgb, var(--highlight) 10%, transparent); }
  .sub-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 30px;
    padding: 0 var(--sp-3);
    background: var(--bg-sunken);
    border: 1px solid var(--highlight);
    border-radius: var(--radius);
    color: var(--ink);
    font: inherit;
    outline: none;
  }
  @media (pointer: coarse) {
    .rail-tab.sub-layout, .sub-input { min-height: 40px; }
    .rail-wrench { width: 40px; height: 40px; }
  }
</style>
