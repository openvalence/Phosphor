<script module>
  import { inFlight } from '../../model/shadow.svelte.js';

  let seq = 0;
</script>

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
   * window below the top strip. A click in the body engages it in place
   * (ph-n18c, ui/engage.js); until then the wheel scrolls the page.
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
   *
   * Edit mode changes no geometry (ph-wia): the head is one fixed height in
   * both modes, its edit tools sit out of flow at its right end (the title
   * never moves, only yields), a bare card's head overlays its body, and the
   * resize handle overlays the corner. A look popover in the body
   * (`[data-look] [popover]`, LookEditor) opens from the head's look tool or
   * Enter on the grip, anchored to this card (`--card`).
   */
  import { untrack } from 'svelte';
  import { engage } from '../engage.js';

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
    // Set on a nest member: edit mode offers Out (back to the top level).
    onremove = null,
    // Edit-mode selection: a click on the grip selects; Shift, Ctrl or Cmd adds.
    selected = false,
    onselect = null,
    // Under its content floor with no room to grow (DashGrid): the surface clips.
    clip = false,
  } = $props();

  const anchor = '--dash-card-' + ++seq;
  // A self-labeled control (item.selfLabeled: it names itself, as a field or a
  // safety op does) is bare by default (ph-w4r): its card label shows only
  // when the look opts in (look.label true).
  const bare = $derived(!!item.selfLabeled && !(item.look && item.look.label === true));
  // Writes in flight among the card's fields (`fields`, else `group.fields`), as a nest's bar counts its members (law 5).
  const busy = $derived(inFlight(item.fields || (item.group && item.group.fields) || []));

  // ---- application region and look popover, found in the body ---------------
  let itemEl;
  let bodyEl;
  let app = $state(null);
  let look = $state(null);
  $effect(() => {
    const own = (sel) => [...bodyEl.querySelectorAll(sel)].find((e) => e.closest('.dash-item') === itemEl) || null;
    // untrack (T23): the reads of `app` and `look` inside find() must not subscribe this effect.
    const find = () => untrack(() => {
      const a = own('[role=application]'), l = own('[data-look] [popover]');
      if (a !== app) app = a;
      if (l !== look) look = l;
    });
    find();
    const mo = new MutationObserver(find);
    mo.observe(bodyEl, { childList: true, subtree: true });
    return () => mo.disconnect();
  });
  let open = $state(false);
  let engaged = $state(false);
  $effect(() => { if (app) return engage(bodyEl, (v) => (engaged = v)); });
  // data-preview: the region is in the grid, not opened (it hides its own tools).
  $effect(() => { if (app) { app.inert = !(open || engaged); app.toggleAttribute('data-preview', !open); } });
  const closeOnEscape = (e) => { if (open && e.key === 'Escape' && !e.defaultPrevented) open = false; };
  // Tools in the head's right end, the grip last: the title yields this much.
  const tools = $derived((look ? 1 : 0) + (item.selfLabeled && item.setLook ? 1 : 0) + (onremove ? 1 : 0));
  function toggleLabel() {
    const { label, ...rest } = item.look || {};
    item.setLook(bare ? { ...rest, label: true } : rest);
  }
  /** Enter on the grip: the look popover with its first choice focused, else DashGrid says there is none. */
  function keyLook() {
    if (!look) { onkeylook && onkeylook(); return; }
    look.showPopover();
    const s = look.querySelector('select, input');
    if (!s) return;
    s.focus();
    try { if (s.tagName === 'SELECT') s.showPicker(); } catch (e) { /* focused is enough where showPicker is missing */ }
  }

  // ---- grab handle: drag to reorder --------------------------------------
  function onGrabPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ongrabstart && ongrabstart(e.clientX, e.clientY);
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
  // Rename (DESIGN §10.6): F2 or a double-click opens the title's input outside edit mode; in edit mode it is always there.
  let renaming = $state(false);
  const renameFocus = (el) => { if (renaming) { el.focus(); el.select(); } };
  function onGrabKeyDown(e) {
    const key = e.key;
    if (key === 'F2' && item.retitle) { e.preventDefault(); const t = itemEl.querySelector('.dash-title-edit'); t?.focus(); t?.select(); return; }
    // Enter would also click (select); it opens the look popover instead.
    if (key === 'Enter') { e.preventDefault(); keyLook(); return; }
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

<div class="dash-item" class:dragging class:editing class:selected class:bare class:open class:clip class:engaged bind:this={itemEl}
     style={'anchor-name:' + anchor + ';--card:' + anchor + ';--tools:' + tools}>
  {#if editing || !bare}
  <div class="dash-head card-head" class:over={bare}>
    {#if !bare}
      {#if (editing || renaming) && item.retitle}
        <input class="dash-title dash-title-edit" type="text" value={item.title} aria-label={'Name of ' + item.title}
               use:renameFocus onblur={() => (renaming = false)}
               onchange={(e) => (e.currentTarget.value.trim() ? item.retitle(e.currentTarget.value) : (e.currentTarget.value = item.title))}
               onkeydown={(e) => {
                 if (e.key === 'Enter') e.currentTarget.blur();
                 else if (e.key === 'Escape') { e.currentTarget.value = item.title; e.currentTarget.blur(); }
               }} />
      {:else}
        <!-- The title attribute is the full form of a title cut by its ellipsis;
             the count follows the title and the title yields to it. -->
        <div class="dash-name">
          <h3 class="dash-title" data-pidx={pidx} title={item.title} tabindex={item.retitle ? 0 : null}
              ondblclick={item.retitle ? () => (renaming = true) : null}
              onkeydown={item.retitle ? (e) => { if (e.key === 'F2') { e.preventDefault(); renaming = true; } } : null}>{item.title}</h3>
          {#if busy.n}<span class="dash-busy" class:overdue={busy.overdue}>{busy.n} in flight</span>{/if}
        </div>
      {/if}
    {/if}
    {#if app}
      <button type="button" class="og-btn sm dash-open" aria-expanded={open} title={open ? 'Back to the grid (Esc)' : 'Open full size'}
              onclick={() => (open = !open)}>{open ? 'Close' : 'Open'}</button>
    {/if}
    <!-- Tools are edit-mode-only: the reading surface stays quiet and a
         card's own controls never compete with layout chrome. -->
    {#if editing}
      <div class="tools">
        {#if look}
          <button type="button" class="ico look-btn" popovertarget={look.id} aria-label={'Look of ' + item.title} title="Look">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M2 4h12M2 8h12M2 12h12" /><circle cx="5" cy="4" r="1.7" /><circle cx="11" cy="8" r="1.7" /><circle cx="7" cy="12" r="1.7" />
            </svg>
          </button>
        {/if}
        {#if item.selfLabeled && item.setLook}
          <button type="button" class="ico label-btn" aria-pressed={!bare}
                  aria-label={(bare ? 'Show' : 'Hide') + ' label of ' + item.title}
                  title={bare ? 'Show label' : 'Hide label'} onclick={toggleLabel}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3.5h10M8 3.5V13" /></svg>
          </button>
        {/if}
        {#if onremove}
          <button type="button" class="ico out" aria-label={'Move ' + item.title + ' out of the nest'} title="Out of the nest"
                  onclick={onremove}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9 2.5h4.5V7M13.5 2.5 7 9M12 10v3.5H2.5V4H6" /></svg>
          </button>
        {/if}
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
            <circle cx="5" cy="4" r="1.3" /><circle cx="11" cy="4" r="1.3" />
            <circle cx="5" cy="8" r="1.3" /><circle cx="11" cy="8" r="1.3" />
            <circle cx="5" cy="12" r="1.3" /><circle cx="11" cy="12" r="1.3" />
          </svg>
        </button>
      </div>
    {/if}
  </div>
  {/if}

  <div class={'dash-body ' + (item.kind === 'nest' ? 'surface-nest' : 'surface-card')} bind:this={bodyEl}
       title={app && !open && !engaged ? 'Click to edit here; click outside to leave' : null}>
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
    /* The head's height and its tools: --ico an icon tool, --handle the grip
       and the resize handle, at least 40 CSS px at every scale (law 12).
       The title yields the tools' glyphs (--tools-w; the grip's transparent
       hit box may lie over its tail), a control the tools' whole boxes. */
    --head-h: 20px;
    --ico: 22px;
    --handle: max(40px, var(--tap));
    --tools-w: calc(var(--tools) * (var(--ico) + 2px) + 30px);
    --tools-box: calc(var(--tools) * (var(--ico) + 2px) + var(--handle) - 4px);
  }
  @media (pointer: coarse) { .dash-item { --ico: 40px; } }
  /* Opened: the whole window below the top strip, which stays on top (law 1). */
  .dash-item.open {
    position: fixed;
    inset: var(--strip-h, 0px) 0 0 0;
    z-index: 20;
    height: auto;
    padding: 8px;
    background: var(--bg);
  }
  /* Opened: the body hands its full height down to the application region
     through every element holding it, and the region's own height yields to
     the frame (a fixed full-size region then spans strip to window bottom). */
  .dash-item.open > .dash-body {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    padding-bottom: var(--dash-body-pad, var(--gap));
  }
  .dash-item.open > .dash-body :global(:has([role='application'])) { display: flex; flex-direction: column; }
  .dash-item.open > .dash-body :global(:is(:has([role='application']), [role='application'])) {
    flex: 1 1 auto;
    align-self: stretch;
    height: auto;
    min-height: 0;
  }
  .dash-open { margin-left: auto; }
  .editing .dash-open { margin-right: var(--tools-box); }
  .dash-item.dragging {
    /* intent purple already means "commanded, not yet settled" everywhere
       else in this instrument -- a card mid-move is exactly that. Lifted by a
       shadow and a static offset, never a transition (reduced motion). */
    box-shadow: inset 0 0 0 1.5px var(--intent), 0 10px 28px rgba(0, 0, 0, .6);
    transform: translateY(-3px);
    opacity: 0.92;
  }

  /* Engaged in place: the focus ring, tapering out. Static, no transition. */
  .dash-item.engaged:not(.open) {
    outline: 2px solid var(--highlight);
    box-shadow: 0 0 18px 4px rgba(var(--highlight-rgb), .35);
  }
  /* Selection is highlight; intent means commanded (THEMES). */
  .dash-item.selected { outline: 2px solid var(--highlight); }
  /* An item with `retitle` (a nest) names itself in place, in edit mode, at
     the head's height (the coarse target reaches past it). */
  .dash-title-edit {
    flex: 1 1 auto;
    width: 0;
    height: var(--head-h);
    padding: 0 6px;
    border: 1px dashed var(--line-3);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
  }
  @media (pointer: coarse) { .dash-title-edit { height: 40px; margin-block: calc((var(--head-h) - 40px) / 2); } }

  /* One height in both modes; the tools never widen it (out of flow), and
     the title's zero width keeps the head out of the card's content floor. */
  .dash-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--head-h);
    padding: 0 0 4px;
    min-width: 0;
  }
  /* A bare card has no head outside edit mode; in it the tools overlay the
     card's top border, so the card measures as it runs and the body's own
     top row stays clear. */
  .dash-head.over {
    position: absolute;
    z-index: 2;
    top: calc(var(--head-h) / -2);
    left: 0;
    right: 0;
    padding: 0;
    pointer-events: none;
  }
  .dash-head.over .tools { pointer-events: auto; }
  .editing .dash-name, .editing .dash-title-edit { max-width: calc(100% - var(--tools-w)); }
  .dash-item { outline-offset: 2px; }
  .dash-title {
    font-family: var(--font);
    font-size: var(--dash-title-size, .8rem);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--tx-val);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* One line at any width: zero width keeps the title and its count out of
     the card's measured content floor (DashGrid), so a count appearing never
     raises the floor or moves a control; the pair grows into what is left. */
  .dash-name {
    flex: 1 1 auto;
    width: 0;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    overflow: hidden;
  }
  /* Words and color only: the ring box is the controls' language (ph-sbu). */
  .dash-busy {
    flex: none;
    font-size: .7rem;
    white-space: nowrap;
    color: var(--intent);
  }
  .dash-busy.overdue { color: var(--warn); }
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
  /* Clip, never scroll: content past the frame stays inside it. The margin
     keeps the grip's overhang. */
  .clip > .dash-body { overflow: clip; }
  /* Edit mode clips a card at its frame too: a host's in-body chrome that
     squeezes the control (Home's Remove) never spills onto a neighbor. The
     margin is the cell gutter: a control's hit extension past the body's
     edge still reaches, as it does running. */
  .editing > .dash-body.surface-card { overflow: clip; overflow-clip-margin: var(--dash-cell-pad, 7px); }
  .clip > .dash-head { overflow: clip; overflow-clip-margin: 10px; }

  /* ---- tools and handles ----
     Near-invisible until hover/focus -- the frame should read as quiet
     instrument chassis, not a toy with visible chrome everywhere. The grip
     and the resize handle are at least 40 CSS px (law 12) at every scale
     step, however small the glyph or a scaled-down --tap; an icon tool is
     40 px under a coarse pointer. Out of flow at the head's right end,
     wrapping downward on a card narrower than they are. */
  .tools {
    position: absolute;
    top: calc(var(--head-h) / 2);
    right: -4px;
    transform: translateY(-50%);
    max-width: calc(100% + 4px);
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
  }
  .handle, .ico {
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--ink-faint);
    border-radius: var(--radius);
    -webkit-user-select: none;
    user-select: none;
  }
  .handle { touch-action: none; }
  .ico { width: var(--ico); height: var(--ico); }
  .handle:hover, .handle:focus-visible, .ico:hover, .ico:focus-visible {
    color: var(--ink);
    background: var(--line-soft);
  }
  .ico[aria-pressed='true'] { color: var(--ink-hi); }
  .handle svg, .ico svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
  .ico svg path { fill: none; }

  .handle.grab {
    flex: 0 0 auto;
    width: var(--handle);
    height: var(--handle);
    cursor: grab;
  }
  .handle.grab:active { cursor: grabbing; }

  .handle.resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--handle);
    height: var(--handle);
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
