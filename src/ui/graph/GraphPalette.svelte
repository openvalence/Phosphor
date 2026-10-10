<script>
  /**
   * GraphPalette.svelte: the node graph's add menu (Blender's Shift+A) and its
   * F3 search. Groups nest as the pages draw them (hub, category, section,
   * card), then plugin modules, ButtplugIO and the node families, each
   * collapsed under a header; typing ranks every item with the shell's F3
   * matcher (model/fuzzy.js) on its label, then its path, and flattens the
   * results. Picking an item places it where the menu was opened; Shift+Enter
   * or a row's show button shows the node already on the canvas instead. See
   * docs/GRAPH.md.
   *
   * Constraints:
   * - Lives inside the editor's own box (RENDERING section 9) and is clamped
   *   into it by its MEASURED size, re-clamped whenever its content resizes;
   *   never by an assumed size.
   * - Keyboard complete: focus stays in the search box; the arrow keys walk
   *   headers and items, Right and Left open and close a header, Enter
   *   places an item or toggles a header, Shift+Enter shows an item's node,
   *   Escape and F3 close.
   * - One matcher: search ranks through fuzzy.js rank(), as F3 does; never a
   *   second matcher here.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { rank } from '../../model/fuzzy.js';

  /**
   * groups: [{name, items: [{key, label, value, on}], groups?, open?}], nested;
   * `on`: how many of the item's nodes the canvas holds. x, y: the anchor in
   * the editor box; vw, vh: that box's size; flat: every item listed at once
   * (link-drag-search, F3); label: the dialog's name; onpick(value),
   * onfind(value), onclose().
   */
  let { groups, x, y, vw, vh, flat = false, label = 'Add a node', onpick, onfind, onclose } = $props();
  const SEP = ' › ';
  const idOf = (path, name) => (path ? path + SEP + name : name);
  let q = $state('');
  // Groups marked open start open: the hub, so its categories show at once.
  let open = $state(untrack(() => {
    const s = new Set();
    const walk = (gs, path) => { for (const g of gs) { const id = idOf(path, g.name); if (g.open) s.add(id); walk(g.groups || [], id); } };
    walk(groups, '');
    return s;
  }));
  let box = $state(null);
  let input = $state(null);
  let w = $state(0);
  let h = $state(0);
  let cur = $state(0);

  const total = (g) => (g.items || []).length + (g.groups || []).reduce((n, s) => n + total(s), 0);
  /** Every item with its path, depth first: a group's own items, then its subgroups. */
  const all = $derived.by(() => {
    const out = [];
    const walk = (gs, path) => {
      for (const g of gs) {
        const id = idOf(path, g.name);
        for (const it of g.items || []) out.push({ head: false, key: id + '/' + it.key, it, group: id, label: it.label, path: id });
        walk(g.groups || [], id);
      }
    };
    walk(groups, '');
    return out;
  });

  /** A flat list names each source once, under its first path: its card, never a module that claims it. */
  const once = $derived.by(() => { const seen = new Set(); return all.filter((r) => !seen.has(r.it.key) && seen.add(r.it.key)); });
  const rows = $derived.by(() => {
    if (q.trim()) return rank(q, once);
    if (flat) return once;
    const out = [];
    const walk = (gs, path, level) => {
      for (const g of gs) {
        const id = idOf(path, g.name);
        out.push({ head: true, key: 'h/' + id, g, id, parent: path, level });
        if (!open.has(id)) continue;
        for (const it of g.items || []) out.push({ head: false, key: id + '/' + it.key, it, group: id, level: level + 1 });
        walk(g.groups || [], id, level + 1);
      }
    };
    walk(groups, '', 1);
    return out;
  });

  const left = $derived(Math.max(8, Math.min(x, vw - w - 8)));
  const top = $derived(Math.max(8, Math.min(y, vh - h - 8)));

  onMount(() => {
    w = box.offsetWidth;
    h = box.offsetHeight;
    input.focus({ preventScroll: true });
  });

  async function toggle(id, on = !open.has(id)) {
    const next = new Set(open);
    if (on) next.add(id); else next.delete(id);
    open = next;
    if (!on) return;
    // An opened group scrolls into view, its header kept on screen.
    await tick();
    const els = box ? box.querySelectorAll('[data-group="' + CSS.escape(id) + '"]') : [];
    els[els.length - 1]?.scrollIntoView({ block: 'nearest' });
    els[0]?.scrollIntoView({ block: 'nearest' });
  }

  async function show() {
    await tick();
    box?.querySelector('[data-cur]')?.scrollIntoView({ block: 'nearest' });
  }

  function key(e) {
    const r = rows[cur];
    if (e.key === 'Escape' || e.key === 'F3') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!r) return;
      if (r.head) toggle(r.id);
      else if (e.shiftKey) onfind(r.it.value);
      else onpick(r.it.value);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      show();
      return;
    }
    if (q || flat || !r) return;
    if (e.key === 'ArrowRight' && r.head) { e.preventDefault(); toggle(r.id, true); }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      // An open header closes; anything else closes the group holding it.
      const id = r.head && open.has(r.id) ? r.id : r.head ? r.parent : r.group;
      if (!id) return;
      toggle(id, false);
      cur = Math.max(0, rows.findIndex((x) => x.head && x.id === id));
    }
  }
</script>

<div class="gpal" role="dialog" tabindex="-1" aria-label={label} bind:this={box}
     bind:offsetWidth={w} bind:offsetHeight={h} style:left={left + 'px'} style:top={top + 'px'} onkeydown={key}>
  <input bind:this={input} bind:value={q} oninput={() => { cur = 0; }} type="search" placeholder="Search nodes" aria-label="Search"
         aria-controls="gpal-list" aria-activedescendant={rows[cur] ? 'gpal-r' + cur : null} />
  <div class="gpal-list" id="gpal-list" role="tree" aria-label="Nodes">
    {#each rows as r, i (r.key)}
      {#if r.head}
        <button type="button" id={'gpal-r' + i} class="gpal-head" role="treeitem" aria-level={r.level} aria-selected={i === cur} aria-expanded={open.has(r.id)}
                data-group={r.id} data-cur={i === cur ? '' : null} style:--lv={r.level - 1} onclick={() => { cur = i; toggle(r.id); }}>
          <span class="gpal-caret" aria-hidden="true">{open.has(r.id) ? '▾' : '▸'}</span><span class="gpal-label">{r.g.name}</span>
          <span class="gpal-count">{total(r.g)}</span>
        </button>
      {:else}
        <div class="gpal-row">
          <button type="button" id={'gpal-r' + i} class="gpal-item" role="treeitem" aria-level={r.level || 1} aria-selected={i === cur}
                  data-nested={r.level ? '' : null} data-group={r.group} data-cur={i === cur ? '' : null} style:--lv={(r.level || 1) - 1}
                  onclick={() => onpick(r.it.value)}>
            <span class="gpal-label">{r.it.label}</span>{#if !r.level}<span class="gpal-count">{r.group}</span>{/if}
          </button>
          {#if r.it.on}
            <button type="button" class="gpal-go" title="Show on the canvas (Shift+Enter)" aria-label={'Show ' + r.it.label + ' on the canvas'}
                    onclick={() => onfind(r.it.value)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>
            </button>
          {/if}
        </div>
      {/if}
    {:else}
      <p class="gpal-none">Nothing matches</p>
    {/each}
  </div>
</div>

<style>
  .gpal { position: absolute; z-index: 5; width: 360px; max-width: calc(100% - 16px); max-height: min(420px, calc(100% - 16px));
    box-sizing: border-box; display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3);
    background: var(--bg-raised); border: 1px solid var(--line-3); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(var(--shade-rgb), .5); }
  .gpal input { min-height: 32px; font-size: .9rem; }
  .gpal-list { overflow-y: auto; min-height: 0; }
  .gpal-row { display: flex; align-items: center; }
  .gpal-head, .gpal-item { display: flex; align-items: center; gap: var(--sp-3); width: 100%; min-width: 0; min-height: 28px;
    padding: var(--sp-1) var(--sp-3) var(--sp-1) calc(var(--sp-3) + var(--lv, 0) * var(--sp-4)); text-align: left;
    background: none; border: 0; border-radius: var(--radius); color: var(--ink); font: inherit; font-size: .8rem; cursor: pointer; }
  .gpal-head { color: var(--tx-val); }
  /* A nested item's name lines up with its sibling headers' names: past the caret and its gap. */
  .gpal-item[data-nested] { padding-left: calc(var(--sp-3) * 2 + (var(--lv, 0) + 1) * var(--sp-4)); }
  .gpal-caret { flex: none; width: var(--sp-4); }
  .gpal-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A flat row: the name first, its path takes what is left. */
  .gpal-item:not([data-nested]) .gpal-label { flex: none; max-width: 60%; }
  .gpal-count { flex: 0 1 auto; min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ink-dim); }
  .gpal-head:hover, .gpal-item:hover, [data-cur] { background: var(--bg-card); color: var(--ink-hi); }
  .gpal-go { flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; background: none; border: 0; border-radius: var(--radius);
    color: var(--ink-dim); cursor: pointer; }
  .gpal-go svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
  .gpal-go:hover, .gpal-go:focus-visible { background: var(--bg-card); color: var(--ink-hi); }
  .gpal-none { margin: var(--sp-3) var(--sp-3); font-size: .8rem; color: var(--ink-dim); }
  @media (pointer: coarse) {
    .gpal input, .gpal-head, .gpal-item { min-height: var(--tap); }
    .gpal-go { width: var(--tap); height: var(--tap); }
  }
</style>
