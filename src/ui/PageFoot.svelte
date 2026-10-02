<script>
  /**
   * PageFoot.svelte -- the page footer (operator rulings 2026-10-02, DESIGN
   * §10.3): the page's own controls left, the UI scale right, on every page.
   *
   * Constraints:
   * - ONE fixed height at every renderer class and pointer. It never wraps;
   *   page controls too wide for the window scroll sideways in their own
   *   slot, and the scale group never moves.
   * - Desktop: sticky at bottom 0 as the last child of a page at least as
   *   tall as `.content` (App.svelte `.pane`), so it sits at the bottom edge
   *   and the scroll area ends above it.
   * - `page` (the page itself scrolls): fixed to the viewport's bottom, and
   *   `.app` reserves its height so the last card and FootStrip end above it.
   * - Owns env(safe-area-inset-bottom) as padding under the row; never the
   *   top inset (webui.md T22).
   * - Every label is one width in both states, so a flip moves nothing; the
   *   scale Reset keeps its slot while hidden.
   * - The scale is theme.js's look.scale, one value with the Display pane's
   *   slider, persisted with the theme. The readout is relative to the
   *   knob's default, which reads 100%. Ctrl+wheel over a surface that
   *   takes the wheel itself (it prevented the default, a range, a canvas)
   *   never scales, and never zooms the webview either.
   */
  import { KNOBS, currentTheme, onTheme, setScale } from '../model/theme.js';

  let { page = false, children } = $props();

  const [MIN, MAX, , DEF] = KNOBS.look.scale;
  let scale = $state(currentTheme().look.scale);
  $effect(() => onTheme((t) => { scale = t.look.scale; }));
  const pct = $derived(Math.round(scale / DEF * 100));

  /** One 10% step of the default, snapped to the decade, inside the knob's range. */
  function target(dir) {
    const p = dir > 0 ? Math.floor(pct / 10) * 10 + 10 : Math.ceil(pct / 10) * 10 - 10;
    const v = DEF * p / 100;
    return v < MIN - 1e-9 || v > MAX + 1e-9 ? null : v;
  }
  function step(dir) {
    const v = target(dir);
    if (v != null) setScale(v);
  }

  function onkeydown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const dir = e.key === '=' || e.key === '+' ? 1 : e.key === '-' ? -1 : e.key === '0' ? 0 : null;
    if (dir == null) return;
    e.preventDefault();
    if (dir) step(dir); else setScale(DEF);
  }
  let acc = 0;
  function onwheel(e) {
    if (!e.ctrlKey || e.defaultPrevented) return;
    e.preventDefault();
    if (e.target.closest?.('input[type=range], canvas')) return;
    acc += e.deltaMode ? e.deltaY * 40 : e.deltaY;
    if (Math.abs(acc) < 100) return;
    step(acc < 0 ? 1 : -1);
    acc = 0;
  }
  $effect(() => {
    window.addEventListener('wheel', onwheel, { passive: false });
    return () => window.removeEventListener('wheel', onwheel);
  });
</script>

<svelte:window {onkeydown} />

<footer class="page-foot" class:page aria-label="Page controls">
  <div class="foot-page">{@render children?.()}</div>
  <div class="foot-scale" role="group" aria-label="UI scale">
    <button type="button" class="og-btn sm" aria-label="Smaller" title="Smaller, Ctrl+-"
            disabled={target(-1) == null} onclick={() => step(-1)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>
    </button>
    <output class="mono" title="UI scale">{pct}%</output>
    <button type="button" class="og-btn sm" aria-label="Larger" title="Larger, Ctrl+="
            disabled={target(1) == null} onclick={() => step(1)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg>
    </button>
    <button type="button" class="og-btn sm reset" class:off={pct === 100} aria-label="Reset scale"
            title="Reset scale, Ctrl+0" onclick={() => setScale(DEF)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6.5A5 5 0 1 1 3 9"/><path d="M3 3v3.5h3.5"/></svg>
    </button>
  </div>
</footer>

<style>
  :global(:root) { --page-foot-h: 48px; }
  .page-foot {
    position: sticky;
    bottom: 0;
    z-index: 15;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: calc(var(--page-foot-h) + env(safe-area-inset-bottom, 0px));
    margin-top: var(--gap);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--bg);
    border-top: 1px solid var(--line-0);
    /* Never the scroll anchor: below the cards, it would turn a card-set
       change above it into a scroll jump. */
    overflow-anchor: none;
  }
  .page-foot.page {
    position: fixed;
    left: 0;
    right: 0;
    margin: 0;
    padding-left: var(--gap);
    padding-right: var(--gap);
  }
  :global(.app:has(.page-foot.page)) { padding-bottom: calc(var(--page-foot-h) + env(safe-area-inset-bottom, 0px)); }
  .foot-page {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .foot-page::-webkit-scrollbar { display: none; }
  .foot-page :global(button) { flex: none; color: var(--ink-dim); }
  .foot-page :global(.adv-toggle[aria-expanded='true']) { color: var(--ink); border-color: var(--line-3); }
  /* Reserved width, so the count appearing never moves the controls. */
  .foot-page :global(.cat-busy) {
    flex: none;
    margin-left: auto;
    min-width: 11ch;
    text-align: right;
    font-size: .76rem;
    color: var(--intent);
  }

  .foot-scale { flex: none; display: flex; align-items: center; gap: 4px; }
  .foot-scale button { min-width: 30px; padding: 0; color: var(--ink-dim); }
  .foot-scale svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .foot-scale output { min-width: 4ch; text-align: center; font-size: .76rem; color: var(--ink-dim); }
  .reset.off { visibility: hidden; }
  @media (pointer: coarse) {
    .foot-scale button { min-width: 40px; }
  }
</style>
