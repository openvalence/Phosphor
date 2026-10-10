<script module>
  const KEY = 'phosphor.dock';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } })();
  /**
   * The right dock's state, read by LinkBar's toggle. `shown`: a plugin docks
   * something; `form`: 'column' (desktop) or 'drawer' (else); `open` the
   * column's state, persisted; `drawer` the drawer's, never persisted.
   */
  export const dock = $state({ shown: false, form: 'column', label: '', open: !!saved.open, id: String(saved.id || ''), drawer: false });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ open: dock.open, id: dock.id })); } catch (e) { /* private mode */ } };
  export function toggleDock() {
    if (dock.form === 'drawer') dock.drawer = !dock.drawer;
    else { dock.open = !dock.open; save(); }
  }
  export const dockOpen = () => (dock.form === 'drawer' ? dock.drawer : dock.open);
</script>

<script>
  /**
   * Dock.svelte -- the right dock region plugins register (docs/PLUGINS.md,
   * The dock; ph-kyjd), closed until the user opens it from the top bar.
   *
   * Constraints:
   * - Opening is the user's act. On the desktop the dock is a column beside
   *   the content and narrows it (DESIGN 10.3: no shifting from non-user
   *   input); closed, it takes no space at all.
   * - Elsewhere it is a drawer from the right edge under the top strip, over
   *   the page, so it never covers the stop pair; a tap outside or Escape
   *   closes it, and the quick rail's pop-up and toggles stay usable over it.
   * - One panel at a time; tabs only when more than one plugin docks.
   */
  import { pluginsUi, pluginDocks } from '../plugins/plugins.svelte.js';
  import { icon, outside } from '../plugins/kit.js';
  import { scrollshade } from './scrollshade.js';

  let { drawer = false } = $props();
  const docks = $derived((pluginsUi.gen, pluginsUi.docks, pluginDocks()));
  const cur = $derived(docks.find((d) => d.id === dock.id) || docks[0] || null);
  $effect(() => {
    dock.shown = !!cur;
    dock.form = drawer ? 'drawer' : 'column';
    dock.label = cur ? cur.label : '';
  });
  const isOpen = $derived(!!cur && (drawer ? dock.drawer : dock.open));
  function close() {
    if (drawer) dock.drawer = false;
    else toggleDock();
  }
  function pick(id) {
    dock.id = id;
    try { localStorage.setItem(KEY, JSON.stringify({ open: dock.open, id })); } catch (e) { /* private mode */ }
  }

  let box = $state(null);
  // The drawer closes on Escape and on a tap outside, swallowed like a kit overlay's (the strip's never is);
  // the quick rail, a menu and the top bar's toggle count as inside.
  $effect(() => {
    if (!drawer || !isOpen || !box) return;
    const off = outside(box, () => { dock.drawer = false; }, ['.dock-btn', '.hero-inner.popup', '.mini', '[data-quick-rail-toggle]', '.ui-menu', '.topstrip']);
    const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); dock.drawer = false; } };
    window.addEventListener('keydown', key);
    return () => { off(); window.removeEventListener('keydown', key); };
  });
  const closeIcon = (n) => { n.replaceChildren(icon('close')); };
</script>

{#if isOpen}
  <aside class="side-dock" class:drawer aria-label={cur.label} bind:this={box}>
    <div class="dock-head">
      {#if docks.length > 1}
        <div class="og-seg ui-seg dock-tabs" role="tablist">
          {#each docks as d (d.id)}
            <button type="button" role="tab" aria-selected={d.id === cur.id} onclick={() => pick(d.id)}>{d.label}</button>
          {/each}
        </div>
      {:else}
        <h3 class="dash-title">{cur.label}</h3>
      {/if}
      <button type="button" class="og-btn sm ui-btn dock-x" title="Close" aria-label="Close" onclick={close} {@attach closeIcon}></button>
    </div>
    <div class="dock-body" use:scrollshade>
      {#key cur.id}<cur.component fields={{}} hero={cur} />{/key}
    </div>
  </aside>
{/if}

<style>
  .side-dock {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    width: 21rem;
    min-height: 0;
    padding: var(--sp-3) var(--sp-3) 0;
    background: var(--bg-raised);
    border: 1px solid var(--line-0);
    border-radius: var(--radius);
  }
  /* The phone's form: from the right edge under the top strip, over the page, clear of the bottom corner. */
  .side-dock.drawer {
    position: fixed;
    top: var(--strip-h, 0px);
    right: 0;
    z-index: 33;
    width: min(21rem, 88vw);
    max-height: calc(100dvh - var(--strip-h, 0px) - max(var(--corner-br, 0px), env(safe-area-inset-bottom, 0px)));
    padding-right: max(var(--sp-3), var(--corner-inset, 0px));
    border-right: 0;
    border-radius: 0 0 0 var(--r-s);
    box-shadow: -8px 0 24px rgba(var(--shade-rgb), .6);
  }
  .dock-head { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--bar-h); }
  .dock-head > :first-child { flex: 1 1 auto; min-width: 0; }
  .dock-tabs { overflow-x: auto; }
  .dock-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-bottom: var(--sp-3); }
</style>
