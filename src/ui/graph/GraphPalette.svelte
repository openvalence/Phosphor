<script>
  /**
   * GraphPalette.svelte: the node graph's add menu, Blender's Shift+A.
   * Categories listed collapsed under a header each; typing searches every
   * category and flattens the results; picking an item places it where the
   * menu was opened. See docs/GRAPH.md.
   *
   * Constraints:
   * - Lives inside the editor's own box (RENDERING section 9) and is clamped
   *   into it by its MEASURED size, re-clamped whenever its content resizes;
   *   never by an assumed size.
   * - Keyboard complete: focus stays in the search box; the arrow keys walk
   *   headers and items, Right and Left open and close a header, Enter
   *   places an item or toggles a header, Escape closes.
   */
  import { onMount, tick } from 'svelte';

  /**
   * groups: [{name, items: [{key, label, value}]}]; x, y: the anchor in the
   * editor box; vw, vh: that box's size; flat: every item listed at once
   * (link-drag-search); onpick(value); onclose().
   */
  let { groups, x, y, vw, vh, flat = false, onpick, onclose } = $props();
  let q = $state('');
  let open = $state(new Set());
  let box = $state(null);
  let input = $state(null);
  let w = $state(0);
  let h = $state(0);
  let cur = $state(0);

  const rows = $derived.by(() => {
    const s = q.trim().toLowerCase();
    const out = [];
    if (s || flat) {
      for (const g of groups) {
        for (const it of g.items) {
          if (!s || (g.name + ' ' + it.label).toLowerCase().includes(s)) out.push({ head: false, key: g.name + '/' + it.key, it, group: g.name });
        }
      }
      return out;
    }
    for (const g of groups) {
      out.push({ head: true, key: 'h/' + g.name, g });
      if (open.has(g.name)) for (const it of g.items) out.push({ head: false, key: g.name + '/' + it.key, it, group: g.name, nested: true });
    }
    return out;
  });

  const left = $derived(Math.max(8, Math.min(x, vw - w - 8)));
  const top = $derived(Math.max(8, Math.min(y, vh - h - 8)));

  onMount(() => {
    w = box.offsetWidth;
    h = box.offsetHeight;
    input.focus({ preventScroll: true });
  });

  async function toggle(name, on = !open.has(name)) {
    const next = new Set(open);
    if (on) next.add(name); else next.delete(name);
    open = next;
    if (!on) return;
    // An opened category scrolls into view, its header kept on screen.
    await tick();
    const rows = box ? box.querySelectorAll('[data-group="' + CSS.escape(name) + '"]') : [];
    rows[rows.length - 1]?.scrollIntoView({ block: 'nearest' });
    rows[0]?.scrollIntoView({ block: 'nearest' });
  }

  async function show() {
    await tick();
    box?.querySelector('[data-cur]')?.scrollIntoView({ block: 'nearest' });
  }

  function act(r) {
    if (!r) return;
    if (r.head) toggle(r.g.name);
    else onpick(r.it.value);
  }

  function key(e) {
    const r = rows[cur];
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); act(r); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      show();
      return;
    }
    if (q || !r) return;
    if (e.key === 'ArrowRight' && r.head) { e.preventDefault(); toggle(r.g.name, true); }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      toggle(r.group || r.g.name, false);
      cur = rows.findIndex((x) => x.head && x.g.name === (r.group || r.g.name));
    }
  }
</script>

<div class="gpal" role="dialog" tabindex="-1" aria-label="Add a node" bind:this={box}
     bind:offsetWidth={w} bind:offsetHeight={h} style:left={left + 'px'} style:top={top + 'px'} onkeydown={key}>
  <input bind:this={input} bind:value={q} oninput={() => { cur = 0; }} type="search" placeholder="Search nodes" aria-label="Search"
         aria-controls="gpal-list" aria-activedescendant={rows[cur] ? 'gpal-r' + cur : null} />
  <div class="gpal-list" id="gpal-list" role="tree" aria-label="Nodes">
    {#each rows as r, i (r.key)}
      {#if r.head}
        <button type="button" id={'gpal-r' + i} class="gpal-head" role="treeitem" aria-level="1" aria-selected={i === cur} aria-expanded={open.has(r.g.name)}
                data-group={r.g.name} data-cur={i === cur ? '' : null} onclick={() => { cur = i; toggle(r.g.name); }}>
          <span class="gpal-caret" aria-hidden="true">{open.has(r.g.name) ? '▾' : '▸'}</span>{r.g.name}
          <span class="gpal-count">{r.g.items.length}</span>
        </button>
      {:else}
        <button type="button" id={'gpal-r' + i} class="gpal-item" role="treeitem" aria-level={r.nested ? 2 : 1} aria-selected={i === cur} data-nested={r.nested ? '' : null} data-group={r.group}
                data-cur={i === cur ? '' : null} onclick={() => onpick(r.it.value)}>
          {r.it.label}{#if !r.nested}<span class="gpal-count">{r.group}</span>{/if}
        </button>
      {/if}
    {:else}
      <p class="gpal-none">Nothing matches</p>
    {/each}
  </div>
</div>

<style>
  .gpal { position: absolute; z-index: 5; width: 280px; max-width: calc(100% - 16px); max-height: min(420px, calc(100% - 16px));
    box-sizing: border-box; display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3);
    background: var(--bg-raised); border: 1px solid var(--line-3); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(var(--shade-rgb), .5); }
  .gpal input { min-height: 32px; font-size: .9rem; }
  .gpal-list { overflow-y: auto; min-height: 0; }
  .gpal-head, .gpal-item { display: flex; align-items: center; gap: var(--sp-3); width: 100%; min-height: 28px; padding: var(--sp-1) var(--sp-3); text-align: left;
    background: none; border: 0; border-radius: var(--radius); color: var(--ink); font: inherit; font-size: .8rem; cursor: pointer; }
  .gpal-head { color: var(--tx-val); }
  .gpal-item[data-nested] { padding-left: calc(var(--sp-5) * 1.333); }
  .gpal-caret { width: 10px; }
  .gpal-count { margin-left: auto; font-size: 11px; color: var(--ink-dim); }
  .gpal-head:hover, .gpal-item:hover, [data-cur] { background: var(--bg-card); color: var(--ink-hi); }
  .gpal-none { margin: var(--sp-3) var(--sp-3); font-size: .8rem; color: var(--ink-dim); }
  @media (pointer: coarse) {
    .gpal input, .gpal-head, .gpal-item { min-height: var(--tap); }
  }
</style>
