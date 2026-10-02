<script>
  /**
   * DashItem.svelte -- one dashboard widget's frame: a header with a grab
   * handle, the widget's own snippet as the body, and a resize handle.
   *
   * Surfaces (operator ruling 2026-10-02, style.css): the header is text on
   * whatever holds the card, never a band; the body is the card's ONE surface
   * (a nest's body is the sunken one). A body holding an application region
   * (role=application: it takes its own pointer and wheel, as the node editor
   * does) is a still preview in the grid, inert, with Open showing it full
   * window below the top strip; nothing in a grid scrolls or zooms on its own.
   *
   * Purely presentational + interaction capture. It knows nothing about
   * other items, ordering, or persistence -- that all lives in DashGrid,
   * which alone sees the whole arrangement. This component only reports what
   * the operator did (pointer positions, key presses) through callback
   * props, bound per-item by the parent's #each loop.
   *
   * The grab handle is the ONLY draggable surface -- dashboard cards hold
   * sliders, buttons and toggles, and a draggable card body would steal
   * pointer gestures from every control inside it. `touch-action: none` is
   * scoped to the two handles alone so the page still scrolls normally on a
   * phone when you touch anywhere else on a card.
   *
   * Both handles report raw client positions; DashGrid alone maps them to
   * cells, because only it knows the grid's tracks.
   */
  import { untrack } from 'svelte';

  let {
    item,
    w,
    h,
    // 1-based display-order position, zero-padded ("01", "02"...), supplied
    // by DashGrid from the arranged list -- absent for any caller that omits
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
    onkeylook = null,
    onkeydelete = null,
    // Set on a nest member: edit mode offers "Out" (back to the top level).
    onremove = null,
    // Edit-mode selection: a click on the grip selects; Shift, Ctrl or Cmd adds.
    selected = false,
    onselect = null,
  } = $props();

  // A self-labeled control (item.selfLabeled: it names itself, as a field or a
  // safety op does) may hide the card label (look.label false). The head stays
  // in edit mode, so the card can still be grabbed and the label brought back.
  const bare = $derived(!!item.selfLabeled && !!item.look && item.look.label === false);

  // ---- application region: a still preview until opened --------------------
  let itemEl;
  let bodyEl;
  let app = $state(null);
  let open = $state(false);
  $effect(() => {
    // untrack (T23): the read of `app` inside find() must not subscribe this effect.
    const find = () => untrack(() => {
      const el = [...bodyEl.querySelectorAll('[role=application]')].find((e) => e.closest('.dash-item') === itemEl) || null;
      if (el !== app) app = el;
    });
    find();
    const mo = new MutationObserver(find);
    mo.observe(bodyEl, { childList: true, subtree: true });
    return () => mo.disconnect();
  });
  $effect(() => { if (app) app.inert = !open; });
  const closeOnEscape = (e) => { if (open && e.key === 'Escape' && !e.defaultPrevented) open = false; };
  function toggleLabel() {
    const { label, ...rest } = item.look || {};
    item.setLook(bare ? rest : { ...rest, label: false });
  }

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
    // Enter would also click (select); it opens the look picker instead.
    if (key === 'Enter') { e.preventDefault(); onkeylook && onkeylook(); return; }
    if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); onkeydelete && onkeydelete(); return; }
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
    e.preventDefault();
    const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const horiz = key === 'ArrowLeft' || key === 'ArrowRight';
    if (e.shiftKey) onkeyresize && onkeyresize(horiz ? d : 0, horiz ? 0 : d);
    else onkeymove && onkeymove(horiz ? d : 0, horiz ? 0 : d);
  }

  // ---- resize: the corner handle, plus edge and corner zones -------------
  // The zones are fine-pointer extras straddling the card's border; the 40 px
  // corner handle (law 12) and the keyboard stay the universal path.
  const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'sw'];
  function onResizePointerDown(e, edge = 'se') {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onresizestart && onresizestart(edge);
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

<svelte:window onkeydown={closeOnEscape} />

<div class="dash-item" class:dragging class:editing class:selected class:bare class:open bind:this={itemEl}>
  {#if editing || !bare}
  <div class="dash-head card-head">
    <!-- Handles are edit-mode-only: the reading surface stays quiet and a
         card's own controls never compete with layout chrome. -->
    {#if editing}
      <button type="button" class="handle grab"
              aria-label={'Move ' + item.title}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowRight Shift+ArrowDown Enter Delete"
              title="Drag to move, click to select"
              aria-pressed={selected}
              onclick={(e) => onselect && onselect(e.shiftKey || e.ctrlKey || e.metaKey)}
              onpointerdown={onGrabPointerDown}
              onpointermove={onGrabPointerMove}
              onpointerup={onGrabPointerUp}
              onpointercancel={onGrabPointerUp}
              onlostpointercapture={() => ongrabend && ongrabend()}
              onkeydown={onGrabKeyDown}>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="4" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" />
          <circle cx="4" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" />
          <circle cx="4" cy="12" r="1.3" /><circle cx="10" cy="12" r="1.3" />
        </svg>
      </button>
    {/if}
    {#if editing && item.retitle}
      <input class="dash-title dash-title-edit" type="text" value={item.title} aria-label={'Name of ' + item.title}
             onchange={(e) => (e.currentTarget.value.trim() ? item.retitle(e.currentTarget.value) : (e.currentTarget.value = item.title))}
             onkeydown={(e) => {
               if (e.key === 'Enter') e.currentTarget.blur();
               else if (e.key === 'Escape') { e.currentTarget.value = item.title; e.currentTarget.blur(); }
             }} />
    {:else}
      <h3 class="dash-title" data-pidx={pidx}>{item.title}</h3>
    {/if}
    {#if editing && item.selfLabeled && item.setLook}
      <button type="button" class="og-btn sm label-btn" aria-pressed={!bare}
              aria-label={(bare ? 'Show' : 'Hide') + ' label of ' + item.title}
              title={bare ? 'Hidden outside edit mode' : 'Hide label (control names itself)'}
              onclick={toggleLabel}>Label</button>
    {/if}
    {#if editing && onremove}
      <button type="button" class="og-btn sm out" aria-label={'Move ' + item.title + ' out of the nest'}
              onclick={onremove}>Out</button>
    {/if}
    {#if app}
      <button type="button" class="og-btn sm dash-open" aria-expanded={open} title={open ? 'Back to the grid (Esc)' : 'Open full size'}
              onclick={() => (open = !open)}>{open ? 'Close' : 'Open'}</button>
    {/if}
  </div>
  {/if}

  <div class={'dash-body ' + (item.kind === 'nest' ? 'surface-nest' : 'surface-card')} bind:this={bodyEl}>
    <!-- The item is passed back to its own snippet so a CALLER can share one
         snippet across many items and switch on the item's payload. Snippets
         are declared statically in a template and cannot be manufactured per
         element in script, so without this argument every distinct card would
         need its own hand-written snippet -- which defeats rendering a machine's
         settings generically. -->
    {@render item.snippet(item)}
  </div>

  {#if editing && !stack && !open}
    {#each EDGES as edge (edge)}
      <div class={'edge edge-' + edge} role="presentation"
           onpointerdown={(e) => onResizePointerDown(e, edge)}
           onpointermove={onResizePointerMove}
           onpointerup={onResizePointerUp}
           onpointercancel={onResizePointerUp}
           onlostpointercapture={() => onresizeend && onresizeend()}></div>
    {/each}
    <button type="button" class="handle resize"
            aria-label={'Resize ' + item.title + ', ' + w + ' by ' + h + ' cells'}
            title="Drag or arrow keys to resize"
            onpointerdown={onResizePointerDown}
            onpointermove={onResizePointerMove}
            onpointerup={onResizePointerUp}
            onpointercancel={onResizePointerUp}
            onlostpointercapture={() => onresizeend && onresizeend()}
            onkeydown={onResizeKeyDown}>
      <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" />
      </svg>
    </button>
  {/if}
</div>

<style>
  /* Paints nothing itself: the body carries the one surface (style.css
     .surface-card, .surface-nest). Fills its grid area, so a resize in cells
     is a visible resize. */
  .dash-item {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }
  /* Opened: the whole window below the top strip, which stays on top (law 1). */
  .dash-item.open {
    position: fixed;
    inset: var(--strip-h, 0px) 0 0 0;
    z-index: 20;
    height: auto;
    padding: 8px;
    background: var(--bg);
  }
  .dash-open { margin-left: auto; }
  .out + .dash-open, .label-btn + .dash-open { margin-left: 0; }
  .dash-item.dragging {
    /* intent purple already means "commanded, not yet settled" everywhere
       else in this instrument -- a card mid-move is exactly that. Lifted by a
       shadow and a static offset, never a transition (reduced motion). */
    box-shadow: inset 0 0 0 1.5px var(--intent), 0 10px 28px rgba(0, 0, 0, .6);
    transform: translateY(-3px);
    opacity: 0.92;
  }

  .dash-item.selected { outline: 2px solid var(--intent); }
  /* An item with `retitle` (a nest) names itself in place, in edit mode. */
  .dash-title-edit {
    flex: 1 1 auto;
    width: 0;
    min-height: 30px;
    padding: 2px 6px;
    border: 1px dashed var(--line-3);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
  }
  @media (pointer: coarse) { .dash-title-edit { min-height: 40px; } }

  .dash-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 0 4px;
    min-width: 0;
  }
  .dash-item { outline-offset: 2px; }
  .bare .dash-title { opacity: .5; }
  .label-btn { margin-left: auto; }
  .label-btn + .out { margin-left: 0; }
  .dash-title {
    font-family: var(--font);
    font-size: var(--dash-title-size, .8rem);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--tx-val);
    overflow-wrap: anywhere;
    min-width: 0;
  }
  /* Runtime index, not a CSS counter: mirrors the OG's renumberPanels() --
     a counter renumbers by DOM order and breaks across hidden/filtered
     panes, so DashGrid computes the 1-based position and stamps it here. */
  .dash-title[data-pidx]::before {
    content: attr(data-pidx) "\2002\25B8\2002";
    font-family: var(--mono);
    font-size: .62rem;
    /* weight/width axis pinned rather than inherited from .dash-title's 500 --
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

  /* Fills the rest of the frame, so a resize in cells shows on the surface. */
  .dash-body {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--dash-body-pad, var(--gap));
    min-width: 0;
  }
  /* The resize handle sits over the body's bottom-right corner: reserve its
     height so it never covers a short module's own Remove or control. */
  .editing .dash-body { padding-bottom: var(--handle); }
  .out { margin-left: auto; }

  /* ---- handles ----
     Near-invisible until hover/focus -- the frame should read as quiet
     instrument chassis, not a toy with visible chrome everywhere. Both are
     at least 40 CSS px (law 12) at every scale step, however small the glyph
     or a scaled-down --tap. */
  .dash-item { --handle: max(40px, var(--tap)); }
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
    width: var(--handle);
    height: var(--handle);
    padding: 0;
    margin: -4px 0 -4px -4px;
    cursor: grab;
  }
  .handle.grab:active { cursor: grabbing; }

  .handle.resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--handle);
    height: var(--handle);
    padding: 0;
    background: transparent;
    cursor: nwse-resize;
  }
  .handle.resize svg {
    width: 9px;
    height: 9px;
  }

  /* Mostly in the cell's 7px gutter, so a card's own controls keep their pointer. */
  .edge {
    position: absolute;
    z-index: 1;
    touch-action: none;
  }
  .edge-n, .edge-s { left: 8px; right: 8px; height: 8px; cursor: ns-resize; }
  .edge-e, .edge-w { top: 8px; bottom: 8px; width: 8px; cursor: ew-resize; }
  .edge-n { top: -7px; }
  .edge-s { bottom: -7px; }
  .edge-e { right: -7px; }
  .edge-w { left: -7px; }
  .edge-ne, .edge-nw, .edge-sw { width: 14px; height: 14px; }
  .edge-ne { top: -7px; right: -7px; cursor: nesw-resize; }
  .edge-sw { bottom: -7px; left: -7px; cursor: nesw-resize; }
  .edge-nw { top: -7px; left: -7px; cursor: nwse-resize; }
  .edge:hover { background: color-mix(in srgb, var(--intent) 25%, transparent); }
  @media (pointer: coarse) { .edge { display: none; } }
</style>
