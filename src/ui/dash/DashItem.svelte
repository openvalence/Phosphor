<script>
  /**
   * DashItem.svelte — one dashboard widget's frame: a header with a grab
   * handle, the widget's own snippet as the body, and a resize handle.
   *
   * Purely presentational + interaction capture. It knows nothing about
   * other items, ordering, or persistence — that all lives in DashGrid,
   * which alone sees the whole arrangement. This component only reports what
   * the operator did (pointer positions, key presses) through callback
   * props, bound per-item by the parent's #each loop.
   *
   * The grab handle is the ONLY draggable surface — dashboard cards hold
   * sliders, buttons and toggles, and a draggable card body would steal
   * pointer gestures from every control inside it. `touch-action: none` is
   * scoped to the two handles alone so the page still scrolls normally on a
   * phone when you touch anywhere else on a card.
   *
   * Both handles report raw client positions; DashGrid alone maps them to
   * cells, because only it knows the grid's tracks.
   */
  let {
    item,
    w,
    h,
    // 1-based display-order position, zero-padded ("01", "02"...), supplied
    // by DashGrid from the arranged list — absent for any caller that omits
    // it, which renders the plain unnumbered prefix instead.
    pidx = null,
    dragging = false,
    editing = false,
    stack = false,
    ongrabstart,
    ongrabmove,
    ongrabend,
    onresizestart,
    onresizemove,
    onresizeend,
    onkeymove,
    onkeyresize,
  } = $props();

  // ---- grab handle: drag to reorder --------------------------------------
  function onGrabPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ongrabstart && ongrabstart();
  }
  function onGrabPointerMove(e) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    ongrabmove && ongrabmove(e.clientX, e.clientY);
  }
  function onGrabPointerUp(e) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    ongrabend && ongrabend();
  }
  function onGrabKeyDown(e) {
    const key = e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
    e.preventDefault();
    const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const horiz = key === 'ArrowLeft' || key === 'ArrowRight';
    if (e.shiftKey) onkeyresize && onkeyresize(horiz ? d : 0, horiz ? 0 : d);
    else onkeymove && onkeymove(horiz ? d : 0, horiz ? 0 : d);
  }

  // ---- resize handle: drag the corner to change w x h -------------------
  function onResizePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onresizestart && onresizestart();
  }
  function onResizePointerMove(e) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onresizemove && onresizemove(e.clientX, e.clientY);
  }
  function onResizePointerUp(e) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onresizeend && onresizeend();
  }
  function onResizeKeyDown(e) {
    const key = e.key;
    if (!key.startsWith('Arrow')) return;
    e.preventDefault();
    const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const horiz = key === 'ArrowLeft' || key === 'ArrowRight';
    onkeyresize && onkeyresize(horiz ? d : 0, horiz ? 0 : d);
  }
</script>

<div class="dash-item og-panel" class:dragging class:editing>
  <div class="dash-head card-head">
    <!-- Handles are edit-mode-only: the reading surface stays quiet and a
         card's own controls never compete with layout chrome. -->
    {#if editing}
      <button type="button" class="handle grab"
              aria-label={'Drag to reorder ' + item.title + '. Arrow keys move it; shift plus arrow keys resize it.'}
              title="Drag to reorder — arrow keys move, shift+arrow resizes"
              onpointerdown={onGrabPointerDown}
              onpointermove={onGrabPointerMove}
              onpointerup={onGrabPointerUp}
              onpointercancel={onGrabPointerUp}
              onkeydown={onGrabKeyDown}>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="4" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" />
          <circle cx="4" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" />
          <circle cx="4" cy="12" r="1.3" /><circle cx="10" cy="12" r="1.3" />
        </svg>
      </button>
    {/if}
    <h3 class="dash-title" data-pidx={pidx}>{item.title}</h3>
  </div>

  <div class="dash-body">
    <!-- The item is passed back to its own snippet so a CALLER can share one
         snippet across many items and switch on the item's payload. Snippets
         are declared statically in a template and cannot be manufactured per
         element in script, so without this argument every distinct card would
         need its own hand-written snippet — which defeats rendering a machine's
         settings generically. -->
    {@render item.snippet(item)}
  </div>

  {#if editing && !stack}
    <button type="button" class="handle resize"
            aria-label={'Resize ' + item.title + ', currently ' + w + ' by ' + h + ' cells. Arrow keys shrink or grow it.'}
            title="Drag to resize — arrow keys shrink/grow"
            onpointerdown={onResizePointerDown}
            onpointermove={onResizePointerMove}
            onpointerup={onResizePointerUp}
            onpointercancel={onResizePointerUp}
            onkeydown={onResizeKeyDown}>
      <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" />
      </svg>
    </button>
  {/if}
</div>

<style>
  /* Chrome (background, inner border, outer bracket outline) comes from the
     .og-panel utility in style.css — restating it here would fork the recipe. */
  /* Fills its grid area, so a resize in cells is a visible resize. */
  .dash-item {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  .dash-item.dragging {
    /* intent purple already means "commanded, not yet settled" everywhere
       else in this instrument — a card mid-move is exactly that. */
    box-shadow: inset 0 0 0 1.5px var(--intent);
    opacity: 0.9;
  }

  .dash-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 4px;
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  /* Without the grab handle, the header loses its leading element — restore
     the tucked-in 4px of the handle's negative margin as plain padding. */
  .dash-item:not(.editing) .dash-head {
    padding-left: 8px;
  }
  .dash-title {
    font-family: var(--font);
    font-size: .8rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--tx-val);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  /* Runtime index, not a CSS counter: mirrors the OG's renumberPanels() —
     a counter renumbers by DOM order and breaks across hidden/filtered
     panes, so DashGrid computes the 1-based position and stamps it here. */
  .dash-title[data-pidx]::before {
    content: attr(data-pidx) "\2002\25B8\2002";
    font-family: var(--mono);
    font-size: .62rem;
    /* weight/width axis pinned rather than inherited from .dash-title's 500 —
       OG's card-head h2[data-pidx]::before verbatim (og-ref/style.css). */
    font-weight: 400;
    font-variation-settings: 'wght' var(--num-wght), 'wdth' 90;
    letter-spacing: normal;
    text-transform: none;
    color: var(--tx-faint);
    vertical-align: 1px;
  }
  .dash-title:not([data-pidx])::before {
    content: "\25B8 ";
    letter-spacing: normal;
    color: var(--line-3);
  }

  .dash-body {
    padding: var(--gap);
    min-width: 0;
  }

  /* ---- handles ----
     Near-invisible until hover/focus — the frame should read as quiet
     instrument chassis, not a toy with visible chrome everywhere. Both meet
     --tap as a hit target even though the glyph inside is small. */
  .handle {
    display: grid;
    place-items: center;
    color: var(--ink-faint);
    border-radius: var(--radius);
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .handle:hover,
  .handle:focus-visible {
    color: var(--ink);
    background: var(--line-soft);
  }
  .handle svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .handle.grab {
    flex: 0 0 auto;
    width: var(--tap);
    height: var(--tap);
    margin: -4px 0 -4px -4px;
    cursor: grab;
  }
  .handle.grab:active { cursor: grabbing; }

  .handle.resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--tap);
    height: var(--tap);
    background: transparent;
    cursor: nwse-resize;
  }
  .handle.resize svg {
    width: 9px;
    height: 9px;
  }
</style>
