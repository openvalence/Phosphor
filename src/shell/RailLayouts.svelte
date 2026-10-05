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
   * - A layout's name is a storage key (dashboard.svelte.js); every change
   *   goes through its exported edits, never the store directly.
   */
  import { layouts, orderedLayoutNames, addLayout, dashEdit } from '../model/dashboard.svelte.js';

  let { dashActive = false, onpick } = $props();

  const names = $derived(orderedLayoutNames());
  let adding = $state(false);
  let draft = $state('');

  function startAdd() { draft = ''; adding = true; }
  function commitAdd() {
    const n = draft.trim();
    if (!n) { adding = false; return; }
    if (addLayout(n)) { adding = false; onpick(n, true); }
  }
  function focusOn(node) { node.focus(); }
</script>

<div class="rail-sub" role="none">
  {#each names as n (n)}
    {@const on = dashActive && layouts.active === n}
    <div class="sub-row" role="none">
      <button type="button" class="rail-tab sub-layout" class:on data-layout={n}
              aria-current={on ? 'page' : undefined} title={n} onclick={() => onpick(n)}>
        <span class="rail-name">{n}</span>
      </button>
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
