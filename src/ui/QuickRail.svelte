<script>
  /**
   * QuickRail.svelte -- the quick rail's icon on a native page's footer
   * (DESIGN §10.3). It opens the hero's own rail (heroBar.svelte.js
   * openQuick), never a second copy; App decides where it exists.
   *
   * Constraints:
   * - data-quick-rail-toggle: the pop-ups' outside-tap close skips it, so a
   *   tap toggles instead of closing and reopening.
   * - One per screen: hidden while the page draws its own (a shown
   *   [data-quick-rail-toggle] in a plugin page, docs/PLUGINS.md).
   */
  import { NAV_ICONS } from './navIcons.js';

  let { open = false, onclick } = $props();
</script>

<button type="button" class="og-btn sm quick-rail" data-quick-rail-toggle aria-expanded={open} aria-label="Rail" data-tip="Rail" {onclick}>
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d={NAV_ICONS.quickRail} /></svg>
</button>

<style>
  .quick-rail { display: grid; place-items: center; min-width: var(--tap); padding: 0; }
  :global(main.pane:has(> .pane-main.plugin [data-quick-rail-toggle]:not([hidden]))) .quick-rail { display: none; }
  .quick-rail[aria-expanded='true'] { color: var(--reality); border-color: var(--reality); }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
</style>
