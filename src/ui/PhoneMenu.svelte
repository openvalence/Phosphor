<script module>
  /** `shown`: App's phone menu applies (buckets 1 and 2, not `full`); `open`: the drawer. The hamburger (LinkBar) and App write it. */
  export const phoneMenu = $state({ shown: false, open: false });
</script>

<script>
  /**
   * PhoneMenu.svelte -- the phone menu's drawer (DESIGN §10.12): the
   * sidebar's content from the left edge, under the top strip, over the
   * page. App renders the content; this file is the box.
   *
   * Constraints:
   * - Overlays: nothing beneath moves, and it starts under the top strip, so
   *   it never covers the stop pair or the hamburger.
   * - Closed by a pick (App), a tap outside or Escape; focus moves to the
   *   selected entry on open and back to the hamburger on close.
   * - Mounted only while open: a closed drawer holds no tab stops.
   */
  import { tick } from 'svelte';

  let { children } = $props();
  let box = $state(null);

  $effect(() => {
    if (!phoneMenu.open) return;
    tick().then(() => (box?.querySelector('[role=tab][tabindex="0"], [role=tab]'))?.focus());
    return () => document.querySelector('.menu-btn')?.focus();
  });
  function onKey(e) {
    if (e.key === 'Escape' && phoneMenu.open) { e.preventDefault(); phoneMenu.open = false; }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if phoneMenu.open}
  <div class="scrim" aria-hidden="true" onpointerdown={() => (phoneMenu.open = false)}></div>
  <div class="phone-menu" role="dialog" aria-modal="true" aria-label="Menu" bind:this={box}>
    {@render children?.()}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: var(--strip-h, 0px) 0 0 0;
    z-index: 34;
    background: rgba(var(--shade-rgb), .5);
  }
  .phone-menu {
    position: fixed;
    top: var(--strip-h, 0px);
    bottom: 0;
    left: 0;
    z-index: 35;
    width: min(20rem, 85vw);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--bg-raised);
    border-right: 1px solid var(--line-2);
    box-shadow: 8px 0 24px rgba(var(--shade-rgb), .6);
  }
</style>
