<script>
  /**
   * PageFoot.svelte -- the page footer (operator rulings 2026-10-02, DESIGN
   * §10.3): the page's own controls. A page with none has no footer; the UI
   * scale lives in the status row (ScaleControl, FootStrip).
   *
   * Constraints:
   * - Rows of one fixed height. Nothing in it scrolls (ph-dj9): page controls
   *   wrap within it where the window is narrow. A page's rows never
   *   change with a state change: every label is one width in both states
   *   and the count holds a fixed slot.
   * - Desktop: sticky at bottom 0 as the last child of a page at least as
   *   tall as `.content` (App.svelte `.pane`), so it sits at the bottom edge
   *   and the scroll area ends above it.
   * - `page` (the page itself scrolls): fixed to the viewport's bottom, and
   *   `.app` reserves its measured height so the last card and FootStrip end
   *   above it.
   * - Owns env(safe-area-inset-bottom) as padding under the row; never the
   *   top inset (webui.md T22).
   * - Every label is one width in both states, so a flip moves nothing.
   */
  let { page = false, children } = $props();

  let footH = $state(0);
  $effect(() => {
    if (!page || !footH) return;
    document.documentElement.style.setProperty('--page-foot-reserve', footH + 'px');
    return () => document.documentElement.style.removeProperty('--page-foot-reserve');
  });
</script>

<footer class="page-foot" class:page bind:offsetHeight={footH} aria-label="Page controls">
  <div class="foot-page">{@render children?.()}</div>
</footer>

<style>
  :global(:root) { --page-foot-h: 48px; }
  .page-foot {
    position: sticky;
    bottom: 0;
    z-index: 15;
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: var(--sp-2);
    min-height: calc(var(--page-foot-h) + env(safe-area-inset-bottom, 0px));
    margin-top: var(--gap);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--bg);
    /* An inset rule, not a border: each row is exactly --page-foot-h. */
    box-shadow: inset 0 1px 0 var(--line-0);
    /* Never the scroll anchor: below the cards, it would turn a card-set
       change above it into a scroll jump. */
    overflow-anchor: none;
  }
  /* No page controls, no footer. */
  .page-foot:not(:has(.foot-page > *)) { display: none; }
  .page-foot.page {
    position: fixed;
    left: 0;
    right: 0;
    margin: 0;
    padding-left: var(--gap);
    padding-right: var(--gap);
  }
  :global(.app:has(.page-foot.page .foot-page > *)) {
    padding-bottom: var(--page-foot-reserve, calc(var(--page-foot-h) + env(safe-area-inset-bottom, 0px)));
  }
  .foot-page {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--page-foot-h);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-content: center;
    gap: var(--sp-2) var(--sp-2);
  }
  .foot-page :global(button) { flex: none; color: var(--ink-dim); }
  /* On is the reality on-state an active control wears (style.css .og-btn.on). */
  .foot-page :global(.adv-toggle[aria-expanded='true']) {
    color: var(--reality);
    border-color: var(--reality);
    box-shadow: var(--glow-reality);
  }
  /* A fixed slot ("100 in flight"), so a count appearing or growing never
     moves the controls or adds a row. */
  .foot-page :global(.cat-busy) {
    flex: none;
    margin-left: auto;
    width: 13ch;
    overflow: hidden;
    white-space: nowrap;
    text-align: right;
    font-size: .76rem;
    color: var(--intent);
  }
</style>
