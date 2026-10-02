<script>
  /**
   * GraphPalette.svelte: the node graph's add menu. A search box over
   * grouped items; picking one places it where the menu was opened.
   *
   * Constraints:
   * - Lives inside the editor's own box (RENDERING section 9: never over the
   *   persistent region, never on the overlay layer).
   * - Keyboard complete: typing filters, Enter takes the first match, the
   *   arrow keys walk the list, Escape closes.
   */
  import { onMount } from 'svelte';

  /** groups: [{name, items: [{key, label, value}]}]; onpick(value); onclose(). */
  let { groups, x, y, onpick, onclose } = $props();
  let q = $state('');
  let box = $state(null);
  let input = $state(null);

  const shown = $derived.by(() => {
    const s = q.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, items: s ? g.items.filter((it) => (g.name + ' ' + it.label).toLowerCase().includes(s)) : g.items }))
      .filter((g) => g.items.length);
  });

  onMount(() => input && input.focus());

  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      const first = shown[0] && shown[0].items[0];
      if (first) onpick(first.value);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...box.querySelectorAll('input, button')];
    const i = list.indexOf(document.activeElement);
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) next.focus();
  }
</script>

<div class="gpal" role="dialog" tabindex="-1" aria-label="Add a node" bind:this={box} style:left={x + 'px'} style:top={y + 'px'}
     onkeydown={key}>
  <input bind:this={input} bind:value={q} type="search" placeholder="Search sources, maps, targets" aria-label="Search" />
  <div class="gpal-list">
    {#each shown as g (g.name)}
      <div class="gpal-group" role="group" aria-label={g.name}>
        <p class="gpal-name">{g.name}</p>
        {#each g.items as it (it.key)}
          <button type="button" class="gpal-item" onclick={() => onpick(it.value)}>{it.label}</button>
        {/each}
      </div>
    {:else}
      <p class="gpal-name">Nothing matches.</p>
    {/each}
  </div>
</div>

<style>
  .gpal { position: absolute; z-index: 5; width: 300px; max-width: calc(100% - 16px); max-height: min(420px, calc(100% - 16px));
    display: flex; flex-direction: column; gap: 6px; padding: 6px;
    background: var(--bg-raised); border: 1px solid var(--line-3); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
  .gpal input { min-height: 32px; }
  .gpal-list { overflow-y: auto; min-height: 0; }
  .gpal-name { margin: 6px 0 2px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-dim); }
  .gpal-item { display: block; width: 100%; min-height: 30px; padding: 4px 8px; text-align: left;
    background: none; border: 0; border-radius: var(--radius); color: var(--ink); font: inherit; font-size: .8rem; cursor: pointer; }
  .gpal-item:hover, .gpal-item:focus-visible { background: var(--bg-card); color: var(--ink-hi); }
  @media (pointer: coarse) {
    .gpal input, .gpal-item { min-height: var(--tap); }
  }
</style>
