<script>
  /**
   * DashGrid.svelte -- the builder grid: square device-px cells (DESIGN §10.5),
   * items placed at {x, y, w, h} in cells, named layouts and the scale
   * control (§10.6). Math and storage: model/grid.js via
   * model/dashboard.svelte.js.
   *
   * Contract: <DashGrid viewId="cat2" items={items} bind:editing />, `items`
   * [{id, title, snippet, kind?, fields?}], `id` a STABLE string (law 10),
   * `snippet` rendered as the body (handed the placed item, which adds x, y,
   * w, h, `look` and `setLook(look)`), `fields` (or `group.fields`) counted on a
   * nest's frame while in flight. An item of `kind` 'section' is a header row:
   * its `title` as text, no card, no grip. Nests stored in the view are drawn as
   * items; an item that is a member of a nest is drawn inside it, not at the
   * top level. With `layout` (a dashboardLayout().nest(id) controller) this
   * is a nest's own subgrid: no toolbar, no nests inside.
   * Host hooks (the home passes them; a category page does not):
   * `ondelete(ids)` removes from the surface, `onduplicate(id) -> id` places a
   * second instance, `resolve(key) -> title|null` names a module member this
   * view can draw. An item may carry `min(look, orientation)`, `selfLabeled`
   * and, for a nest, `retitle(name)`. Internal: `ondragout` and `target` wire a
   * nest's subgrid to its parent; `picked` (bindable) is the selection count,
   * so a nest's bar yields its row to its subgrid's selection.
   *
   * Constraints:
   * - A drag or resize is a preview (`pin`) until pointer-up; only the commit
   *   writes the layout, so every intermediate frame is cancelable (Escape).
   *   Placements are absolute (grid.js place): the preview moves the dragged
   *   card only, and a resize stops at a neighbor rather than pushing it.
   * - An add (New nest, Insert, Duplicate) is committed at once, so the first
   *   free rect it was drawn at is where it stays.
   * - DOM order is reading order, frozen while a drag is in flight: moving the
   *   node that holds pointer capture drops the capture.
   * - Nothing on the grid transitions or animates: a layout switch or a
   *   reflow lands at once, never as motion that could read as the machine.
   * - A resize never goes below the item's floor: per dimension the larger
   *   of its `min(look, orientation)` cells (RESIZE_FLOOR without one) and
   *   its measured content (grid.js floorOf): the ghost shows the refusal and
   *   the live region says it, never a silent clamp. The measured height
   *   binds at widths no wider than it was measured at, and never above the
   *   height the resize started from.
   * - Content is measured per (id, orientation, presentation, cell edge):
   *   min-content width, never lowered in a session, with the title at zero
   *   width (it truncates) and a nest's subgrid replaced by its widest
   *   member's floor (the nested grid's `data-floor`); the height as last
   *   measured at each width the card was drawn at. A measure writes and
   *   restores inline styles in one task, so nothing paints and no observer
   *   sees a size change. A committed card under its floor grows when it is
   *   measured (load, a content, look or width change), width first (grid.js
   *   growWidth, growHeight, layout.fit, no undo step), never later because
   *   a neighbor moved away; one with no room clips at its frame. An
   *   unplaced card is drawn at its content height (pack `fit`), and an add
   *   is written once measured.
   * - Rows are one cell (ph-29r): a card's rect is its cells, so the ghost
   *   is the committed rect and a pointer maps to a row by the cell pitch.
   * - Edit mode changes no geometry (ph-wia): its chrome is out of flow (the
   *   head's tools, the status slot in the toolbar row, the palette and look
   *   popovers), so a card measures and draws the same in both modes.
   * - Under 641 CSS px every item is stacked full width (mobile is
   *   ph-e82.7's ruling); a drag there commits a reading order, never cells.
   * - `ondropkey(key, rect)` takes a palette entry dragged onto the grid in
   *   edit mode (grid.js MODULE_MIME); `rect` is the cell area the drop target
   *   showed, null when stacked. A nest's grid hands it on with the nest's id.
   * - Outside edit mode the toolbar is the layout picker and Edit layout only;
   *   scale, density and the layout and module operations sit in one popover
   *   menu (test/responsive-matrix.mjs).
   */
  import DashItem from './DashItem.svelte';
  import Nest from './Nest.svelte';
  import {
    dashboardLayout, grid, stepScale, layouts, layoutNames, undo, undoLast,
    switchLayout, saveLayoutAs, renameLayout, deleteLayout, moduleNames, deleteModule,
    layoutJson, restoreLayout, exportLayout, importLayout, density, setDensity, palette, edited,
  } from '../../model/dashboard.svelte.js';
  import { tick, untrack } from 'svelte';
  import { cellCount, placeable, resizeRect, arrangePins, nudgePin, blocker, DEFAULT_H, MODULE_MIME,
    RESIZE_FLOOR, cellsFor, floorOf, growWidth, growHeight } from '../../model/grid.js';
  import { orientationOf } from '../../model/settings.js';
  import { onTheme } from '../../model/theme.js';
  import { view } from '../../model/viewport.svelte.js';

  let { viewId = '', items, editing = $bindable(false), layout: given = null, onremove = null, ondropkey = null,
    ondragout = null, target = false, ondelete = null, onduplicate = null, resolve = null, picked = $bindable(0) } = $props();
  const menuId = 'dash-menu-' + Math.random().toString(36).slice(2, 8);

  const layout = $derived(given || dashboardLayout(viewId, view.cls));
  const nests = $derived(given ? [] : layout.nests());
  const all = $derived.by(() => {
    if (!nests.length) return items;
    const byId = new Map(items.map((it) => [it.id, it]));
    const inNest = new Set(nests.flatMap((n) => n.keys));
    return [
      ...items.filter((it) => !inNest.has(it.id)),
      ...nests.map((n) => ({ id: n.id, title: n.title, kind: 'nest', snippet: nestCard, nest: n, retitle: retitle(n.id),
        members: n.keys.map((k) => byId.get(k)).filter(Boolean) })),
    ];
  });

  let width = $state(0);
  let winW = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
  const stack = $derived(winW <= 640);
  const cols = $derived(cellCount(width, grid.cell));

  // {id, x, y, w, h, mode} while a pointer drag is in flight; `into` a nest id
  // while a move would join that nest, `out` while a member is dragged out of
  // this (nested) grid, `cx, cy` the last pointer position.
  let pin = $state(null);
  let dropRect = $state(null);   // {x, y, w, h} while a palette entry, or a member leaving a nest, is over the grid
  let paletteOver = $state(false); // a palette entry over a nest's grid: it joins the nest, so the whole nest lights
  // DOM order while any drag is in flight: live when stacked, frozen on the
  // grid, because a keyed #each that moves the node holding pointer capture
  // drops the capture and strands the drag.
  let stackOrder = $state(null);
  let announceMsg = $state('');
  let nameDraft = $state('');
  let moduleDraft = $state('');
  let sel = $state([]);          // selected ids (edit mode)
  // The active layout as it was when editing began (or it became active while
  // editing): the switch guard compares against it. Layouts save on every
  // edit, so "changes" means the user's edits since then (a grow to the
  // content floor is a repair, not one), which Discard can take back.
  let baseline = $state(null);
  let baseEdits = 0;
  let pendingSwitch = $state(null);
  let layoutText = $state('');
  $effect(() => {
    const a = layouts.active;
    const on = !given && editing;
    // untrack (T23): the snapshot reads the whole layout and must not subscribe to it.
    untrack(() => { baseline = on ? layoutJson(a) : null; baseEdits = edited(); pendingSwitch = null; });
  });
  const changed = () => baseline !== null && edited() !== baseEdits && layoutJson() !== baseline;
  let marquee = $state(null);    // {x0, y0, x1, y1, add} client px while a marquee is drawn
  let dragMoved = false;         // the grip's click after a real drag is not a selection

  /** A group move's pins: every member shifted by the dragged card's delta, clamped as one. */
  function groupPins(p) {
    const g = p.group;
    const dx = Math.min(cols - Math.max(...g.map((r) => r.x + r.w)), Math.max(-Math.min(...g.map((r) => r.x)), p.x - p.x0));
    const dy = Math.max(-Math.min(...g.map((r) => r.y)), p.y - p.y0);
    return g.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  }
  // Each placed item carries its entry's `look` (grid.js pack) and a setter
  // bound to THIS grid's map, so one control in two nests keeps two looks.
  const live = $derived(pin && pin.mode !== 'stack' && !pin.into && !pin.out ? (pin.group ? groupPins(pin) : pin) : null);
  const placed = $derived(layout.arrange(all, cols, live, fitH)
    .map((p) => ({ ...p, setLook: (look) => layout.setLook(p.id, look, p) })));
  // The drop targets: where the dragged cards or the palette entry land on release.
  const ghosts = $derived(stack ? [] : live ? placed.filter((p) => (pin.group || [pin]).some((g) => g.id === p.id))
    : dropRect ? [dropRect] : []);
  const selSet = $derived(new Set(editing ? sel.filter((id) => placed.some((p) => p.id === id)) : []));
  const selItems = $derived(placed.filter((p) => selSet.has(p.id)));
  $effect(() => { picked = selSet.size; });
  const canDup = (p) => (p.kind === 'nest' ? !given : !!onduplicate);
  const canDrop = (p) => p.kind === 'nest' || !!ondelete || !!onremove;
  const mq = $derived.by(() => {
    if (!marquee) return null;
    const g = gridEl.getBoundingClientRect();
    return { left: Math.min(marquee.x0, marquee.x1) - g.left, top: Math.min(marquee.y0, marquee.y1) - g.top,
      width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) };
  });
  const displayList = $derived.by(() => {
    if (!stackOrder) return placed;
    const byId = new Map(placed.map((p) => [p.id, p]));
    return stackOrder.map((id) => byId.get(id)).filter(Boolean);
  });
  // Card numbers in display order; a section row takes none.
  const pidx = $derived(new Map(displayList.filter((p) => p.kind !== 'section')
    .map((p, n) => [p.id, String(n + 1).padStart(2, '0')])));

  let gridEl;
  /** @type {Map<string, HTMLElement>} */
  const cellEls = new Map();
  function registerCell(node, id) {
    cellEls.set(id, node);
    return { destroy() { if (cellEls.get(id) === node) cellEls.delete(id); } };
  }

  // ---- content floor -------------------------------------------------------------
  // {[keyOf]: {w, hs}}: px needed, cell gutter included: `w` the min-content
  // width, `hs` {[width in cells]: height} the last height drawn at that width.
  let need = $state({});
  const dirty = new Set();
  const keyOf = (p, o) => p.id + '|' + o + '|' + ((p.look && p.look.pres) || '') + '|' + grid.cell;
  const padOf = (el) => { const cs = getComputedStyle(el); return [parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)]; };
  function styled(el, prop, val, read) {
    const was = el.style.getPropertyValue(prop);
    el.style.setProperty(prop, val);
    try { return read(); } finally { el.style.setProperty(prop, was); }
  }
  /** Min-content width of card `it` in CSS px; a nest's subgrid counts as its widest member floor (`data-floor`). */
  function minWidth(it) {
    const sub = it.querySelector('.dash-grid');
    const own = () => styled(it, 'width', 'min-content', () => it.getBoundingClientRect().width);
    if (!sub) return own();
    const chrome = it.getBoundingClientRect().width - sub.getBoundingClientRect().width;
    const cell = parseFloat(sub.style.getPropertyValue('--cell')) || grid.cell;
    const k = Math.max(0, ...[...sub.querySelectorAll(':scope > .dash-cell')].map((c) => Number(c.dataset.floor) || 0));
    return Math.max(styled(sub, 'display', 'none', own), chrome + k * cell);
  }
  /**
   * {w, h} px the card in `cell` needs, gutter included; null for an opened
   * card. A floated child of the body is a host's edit chrome (Home's
   * Remove), never content: it is out while the card is measured.
   */
  function measure(cell) {
    const it = cell.firstElementChild;
    if (!it || it.classList.contains('open')) return null;
    const [px, py] = padOf(cell);
    const chrome = [...(it.querySelector(':scope > .dash-body')?.children || [])].filter((c) => getComputedStyle(c).float !== 'none');
    const was = chrome.map((c) => c.style.getPropertyValue('display'));
    chrome.forEach((c) => c.style.setProperty('display', 'none'));
    try {
      return { w: minWidth(it) + px, h: styled(it, 'height', 'auto', () => it.getBoundingClientRect().height) + py };
    } finally {
      chrome.forEach((c, i) => c.style.setProperty('display', was[i]));
    }
  }
  /** Cells of content height at width `w`: the tallest drawn at `w` or wider (narrower only wraps more); 0 unmeasured. */
  function tallAt(m, w) {
    let px = 0;
    for (const k in m.hs) if (+k >= w && m.hs[k] > px) px = m.hs[k];
    return cellsFor(px, grid.cell);
  }
  /**
   * The floor function for item `p` (grid.js resizeRect `min`): its height
   * part never above `cap`, the height a resize started from.
   */
  const minOf = (p, cap = Infinity) => (w, h) => {
    const o = orientationOf(w, h);
    const fixed = (p.min && p.min(p.look, o)) || RESIZE_FLOOR;
    const m = need[keyOf(p, o)];
    return floorOf(fixed, m ? [cellsFor(m.w, grid.cell), Math.min(cap, tallAt(m, w))] : []);
  };
  /** grid.js pack `fit`: an item's floor height in cells at width `w`, null before it was drawn there. */
  function fitH(it, w, h) {
    const m = need[keyOf(it, orientationOf(w, h))];
    return m && m.hs[w] != null ? minOf(it)(w, h)[1] : null;
  }
  const short = (p) => { const [w, h] = minOf(p)(p.w, p.h); return p.w < w || p.h < h; };
  // Ids measured since their last grow check: a card grows when its content
  // is measured, never because a neighbor moved out of its way.
  const fresh = new Set();
  /**
   * Measure what changed, is new or is drawn at a new width; re-clamp a
   * resize in flight; write an add once measured; then grow one freshly
   * measured card under its floor.
   */
  function settle() {
    frame = 0;
    // Never before the grid knows its own width: a rect placed on a stale
    // column count would be measured and written there.
    if (stack || !gridEl || !width || cellCount(gridEl.clientWidth, grid.cell) !== cols) return;
    let grew = false;
    for (const p of placed) {
      const el = cellEls.get(p.id);
      const k = keyOf(p, orientationOf(p.w, p.h));
      const o = need[k];
      if (!el || (o && !dirty.has(p.id) && o.hs[p.w] != null)) continue;
      const m = measure(el);
      if (!m) continue;
      fresh.add(p.id);
      // A content change forgets the heights drawn at other widths.
      const hs = { ...(o && !dirty.has(p.id) ? o.hs : {}), [p.w]: m.h };
      const w = Math.max(m.w, o ? o.w : 0);
      if (!o || w !== o.w || JSON.stringify(hs) !== JSON.stringify(o.hs)) { need[k] = { w, hs }; grew = true; }
    }
    dirty.clear();
    if (pin) { if (grew && pin.mode === 'resize' && pin.c) resizeTo(pin.id, pin.c); return; }
    const held = layout.held();
    if (held && placed.some((p) => held.has(p.id) && fitH(p, p.w, p.h) != null)) { layout.fit(all, cols, null); return; }
    // Only stored rects stop a grow: an unplaced card (a section row) packs around the grown one.
    const fixed = placed.filter((q) => layout.saved(q.id));
    for (const p of placed) {
      if (!fresh.delete(p.id) || !layout.saved(p.id)) continue;
      const [fw, fh] = minOf(p)(p.w, p.h);
      const r = (p.w < fw && growWidth(fixed, p.id, fw, cols)) || (p.h < fh && growHeight(fixed, p.id, fh));
      if (r) { layout.fit(all, cols, r); return; }
    }
  }
  let frame = 0;
  const later = () => { if (!frame) frame = requestAnimationFrame(settle); };
  $effect(() => {
    // Any layout, scale or mode change may show a card at a size not yet measured.
    placed; grid.cell; editing; stack;
    later();
  });
  $effect(() => {
    // Home commits through its own controller: unplaced cards take these heights there too.
    const l = layout;
    l.measured(stack ? null : fitH);
    return () => l.measured(null);
  });
  // The look scale resizes every font without touching the DOM.
  $effect(() => onTheme(() => { for (const id of cellEls.keys()) dirty.add(id); later(); }));
  $effect(() => {
    // A card's content changed (catalog adoption, a presentation, an option list, a nest member's floor): measure it again.
    const top = (n) => { while (n && n.parentElement !== gridEl) n = n.parentElement; return n; };
    const mo = new MutationObserver((recs) => {
      for (const r of recs) { const c = top(r.target); if (c && c.dataset.id) dirty.add(c.dataset.id); }
      if (dirty.size) later();
    });
    mo.observe(gridEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-floor'] });
    document.fonts?.ready.then(() => { for (const id of cellEls.keys()) dirty.add(id); later(); });
    return () => { mo.disconnect(); if (frame) cancelAnimationFrame(frame); frame = 0; };
  });
  const ORIENT = { h: 'horizontal', v: 'vertical' };
  const announce = (msg) => { announceMsg = msg; };
  const retitle = (id) => (name) => { if (layout.setNest(id, { title: name })) announce('Nest renamed to ' + name.trim()); };
  // A module's members before Insert: titled when this view can draw them, else inert here.
  const titleHere = (k) => (resolve ? resolve(k) : (items.find((it) => it.id === k) || {}).title) || null;
  const preview = $derived.by(() => {
    const m = moduleDraft && layouts.modules && layouts.modules[moduleDraft];
    return m && m.members && typeof m.members === 'object' ? Object.keys(m.members).map((key) => ({ key, title: titleHere(key) })) : null;
  });
  const titleOf = (id) => (all.find((it) => it.id === id) || {}).title || id;
  const where = (p) => 'column ' + (p.x + 1) + ', row ' + (p.y + 1) + ', ' + p.w + ' by ' + p.h + ' cells';

  /** Client point -> cell: rows are one cell each, the same pitch as the columns. */
  function cellAt(clientX, clientY) {
    const r = gridEl.getBoundingClientRect();
    return { x: Math.max(0, Math.min(cols - 1, Math.floor((clientX - r.left) / grid.cell))),
      y: Math.max(0, Math.floor((clientY - r.top) / grid.cell)) };
  }

  // ---- pointer: move / resize ------------------------------------------------
  /** `cx, cy` the press: the card keeps the grabbed cell under the pointer. */
  function grabStart(id, cx, cy) {
    if (stack) { stackOrder = placed.map((p) => p.id); pin = { id, mode: 'stack' }; return; }
    const p = placed.find((q) => q.id === id);
    if (!p) return;
    dragMoved = false;
    stackOrder = displayList.map((q) => q.id);
    const c = cx == null ? { x: p.x, y: p.y } : cellAt(cx, cy);
    const group = selSet.size > 1 && selSet.has(id) ? selItems.map(({ id: i, x, y, w, h }) => ({ id: i, x, y, w, h })) : null;
    pin = { id, x: p.x, y: p.y, w: p.w, h: p.h, mode: 'move', gx: c.x - p.x, gy: c.y - p.y, ...(group ? { group, x0: p.x, y0: p.y } : {}) };
  }
  function resizeStart(id, edge = 'se') {
    const p = placed.find((q) => q.id === id);
    if (!p || stack) return;
    dragMoved = false;
    stackOrder = displayList.map((q) => q.id);
    pin = { id, x: p.x, y: p.y, w: p.w, h: p.h, mode: 'resize', edge, start: { x: p.x, y: p.y, w: p.w, h: p.h }, refused: false };
  }
  /** Resize `id` to `r` (resizeRect), announcing a refusal at the minimum and an orientation flip. */
  function resizeNote(id, from, r, wasRefused) {
    const o = orientationOf(r.w, r.h);
    if (r.refused && !wasRefused) announce(titleOf(id) + ': minimum size, ' + r.w + ' by ' + r.h + ' cells');
    else if (o !== orientationOf(from.w, from.h)) announce(titleOf(id) + ' now ' + ORIENT[o]);
  }
  function pointerMove(id, clientX, clientY) {
    if (!pin || pin.id !== id) return;
    if (pin.mode === 'stack') {
      for (const [other, el] of cellEls) {
        if (other === id) continue;
        const r = el.getBoundingClientRect();
        if (clientY < r.top || clientY > r.bottom) continue;
        const ids = stackOrder.filter((x) => x !== id);
        ids.splice(ids.indexOf(other) + (clientY < r.top + r.height / 2 ? 0 : 1), 0, id);
        stackOrder = ids;
        return;
      }
      return;
    }
    const c = cellAt(clientX, clientY);
    if (pin.mode === 'move') { moveTo(id, c, clientX, clientY); return; }
    resizeTo(id, c);
  }
  /** The resize in flight toward cell `c`: the ghost stops at the floor or at a neighbor. */
  function resizeTo(id, c) {
    const p = placed.find((q) => q.id === id);
    if (!p) return;
    const r = resizeRect(pin.start, pin.edge, c, cols, minOf(p, pin.start.h));
    if (!pin.c || pin.c.x !== c.x || pin.c.y !== c.y) pin = { ...pin, c };
    if (r.x === pin.x && r.y === pin.y && r.w === pin.w && r.h === pin.h && r.refused === pin.refused) return;
    const b = blocker(placed, r, id);
    if (b) {
      if (!pin.blocked) announce(titleOf(id) + ': blocked by ' + titleOf(b.id));
      pin = { ...pin, blocked: b.id };
      return;
    }
    if (pin.blocked) pin = { ...pin, blocked: null };
    dragMoved = true;
    resizeNote(id, pin, r, pin.refused);
    pin = { ...pin, ...r };
  }
  const inside = (p, c) => c.x >= p.x && c.x < p.x + p.w && c.y >= p.y && c.y < p.y + p.h;
  /**
   * A move to cell `c`. Over a nest (in the committed layout, so the nest does
   * not flee the pin) a placeable card is offered to the nest; a nest member
   * leaving its nest's visible region is handed to the parent grid.
   */
  function moveTo(id, c, cx, cy) {
    const it = placed.find((q) => q.id === id);
    const x = Math.max(0, Math.min(cols - pin.w, c.x - pin.gx)), y = Math.max(0, c.y - pin.gy);
    if (x !== pin.x || y !== pin.y) dragMoved = true;
    if (pin.group) { pin = { ...pin, x, y }; return; }
    if (given && ondragout) {
      const r = (gridEl.closest('.dash-body') || gridEl).getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) {
        if (!pin.out) announce('Release to move ' + titleOf(id) + ' out of the nest');
        pin = { ...pin, out: true, cx, cy };
        ondragout({ ...it, gx: pin.gx, gy: pin.gy }, cx, cy, 'move');
        return;
      }
      if (pin.out) ondragout(it, cx, cy, 'cancel');
    }
    const nest = !given && it && placeable(it.kind, true)
      && layout.arrange(all, cols).find((p) => p.kind === 'nest' && p.id !== id && inside(p, c));
    if (nest) {
      if (pin.into !== nest.id) announce('Release to move ' + titleOf(id) + ' into ' + nest.title);
      pin = { ...pin, into: nest.id, cx, cy };
      return;
    }
    pin = { ...pin, x, y, into: null, out: false, cx, cy };
  }
  /** A member dragged out of nest `nestId` (its grid's ondragout, `gx, gy` its grabbed cell): ghost while moving, top level on release. */
  function childOut(nestId, it, cx, cy, phase) {
    if (phase === 'cancel' || !it) { dropRect = null; return; }
    const c = cellAt(cx, cy);
    const w = Math.min(cols, it.w);
    const r = { x: Math.max(0, Math.min(c.x - (it.gx || 0), cols - w)), y: Math.max(0, c.y - (it.gy || 0)), w, h: it.h };
    if (phase === 'move') {
      if (!dropRect || r.x !== dropRect.x || r.y !== dropRect.y) dropRect = r;
      return;
    }
    dropRect = null;
    // Positions first, membership second: the top-level entry exists before the
    // member leaves, so a home showing its seed keeps it (one undo step).
    layout.move([...all, { id: it.id }], cols, { id: it.id, ...r });
    layout.nestOut(nestId, it.id);
    const p = layout.arrange(all, cols).find((q) => q.id === it.id);
    announce(it.title + ' moved out of ' + titleOf(nestId) + (p ? ' to ' + where(p) : ''));
  }
  function pointerEnd(id) {
    if (!pin || pin.id !== id) return;
    if (pin.out) {
      ondragout({ ...placed.find((q) => q.id === id), gx: pin.gx, gy: pin.gy }, pin.cx, pin.cy, 'end');
    } else if (pin.group) {
      layout.move(all, cols, groupPins(pin));
      announce(pin.group.length + ' cards moved');
    } else if (pin.into) {
      if (layout.nestAdd(pin.into, id)) announce(titleOf(id) + ' moved into ' + titleOf(pin.into));
    } else if (pin.mode === 'stack') {
      layout.order(all, cols, stackOrder);
      announce(titleOf(id) + ' moved to position ' + (stackOrder.indexOf(id) + 1) + ' of ' + stackOrder.length);
    } else {
      layout.move(all, cols, pin);
      const p = layout.arrange(all, cols).find((q) => q.id === id);
      const flip = p && pin.start && orientationOf(p.w, p.h) !== orientationOf(pin.start.w, pin.start.h);
      if (p) announce(titleOf(id) + ' at ' + where(p) + (pin.refused ? ', its minimum' : '') + (pin.blocked ? ', blocked by ' + titleOf(pin.blocked) : '') + (flip ? ', now ' + ORIENT[orientationOf(p.w, p.h)] : ''));
    }
    pin = null;
    stackOrder = null;
  }

  // ---- selection (edit mode): a grip click, shift/ctrl adds; a marquee on empty grid --
  function select(id, additive) {
    if (dragMoved) { dragMoved = false; return; }
    const cur = [...selSet];
    sel = additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
      : cur.length === 1 && cur[0] === id ? [] : [id];
    announce(sel.length ? sel.length + ' selected' : 'Selection cleared');
  }
  function marqueeStart(e) {
    if (!editing || stack || e.target !== gridEl || e.button !== 0) return;
    gridEl.setPointerCapture(e.pointerId);
    marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey };
  }
  function marqueeMove(e) {
    if (marquee && gridEl.hasPointerCapture(e.pointerId)) marquee = { ...marquee, x1: e.clientX, y1: e.clientY };
  }
  function marqueeEnd() {
    if (!marquee) return;
    const m = marquee;
    marquee = null;
    const l = Math.min(m.x0, m.x1), r = Math.max(m.x0, m.x1), t = Math.min(m.y0, m.y1), b = Math.max(m.y0, m.y1);
    if (r - l < 4 && b - t < 4) {
      if (!m.add && selSet.size) { sel = []; announce('Selection cleared'); }
      return;
    }
    const hit = [...cellEls].filter(([, el]) => { const q = el.getBoundingClientRect(); return q.left < r && q.right > l && q.top < b && q.bottom > t; })
      .map(([id]) => id);
    sel = m.add ? [...new Set([...selSet, ...hit])] : hit;
    announce(sel.length + ' selected');
  }
  function arrangeSel(how) {
    layout.move(all, cols, arrangePins(selItems.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })), how));
    announce(selItems.length + ' cards ' + (how === 'spread' ? 'spread across' : 'aligned ' + how));
  }
  function duplicateSel() {
    const made = [];
    for (const p of selItems.filter(canDup)) {
      const id = p.kind === 'nest' ? layout.duplicate(p.id) : onduplicate(p.id);
      if (id) made.push(id);
    }
    if (made.length) layout.move([...all, ...made.filter((id) => !all.some((it) => it.id === id)).map((id) => ({ id }))], cols, null);
    sel = made;
    announce(made.length ? 'Duplicated ' + made.length : 'Nothing here can be duplicated');
  }
  // Home deletes from the home; a nest member steps out of its nest; elsewhere a nest ungroups.
  function deleteSel(list = selItems) {
    const drop = list.filter(canDrop);
    if (!drop.length) { announce('Nothing here can be removed'); return; }
    if (ondelete) ondelete(drop.map((p) => p.id));
    else for (const p of drop) (p.kind === 'nest' ? layout.removeNest(p.id) : onremove(p.id));
    sel = [];
    announce(drop.length === 1 ? titleOf(drop[0].id) + ' removed' : drop.length + ' removed');
  }
  /** Escape: the drag in flight (pointer, marquee, or a member leaving its nest) is dropped, nothing written. */
  function cancelDrag() {
    if (pin && pin.out && ondragout) ondragout(null, 0, 0, 'cancel');
    pin = null;
    stackOrder = null;
    marquee = null;
    dropRect = null;
    announce('Drag canceled');
  }

  // ---- keyboard ------------------------------------------------------------------
  // Up/Down walk the reading order (parity with the old reorder); Left/Right
  // step one cell; shift + arrows resize.
  // A keyed #each that reorders the focused grip's node drops its focus; put it back.
  const refocus = (id) => tick().then(() => {
    const g = cellEls.get(id)?.querySelector('.handle.grab');
    if (g && document.activeElement !== g) g.focus();
  });
  function keyMove(id, dx, dy) {
    if (stack) {
      const ids = placed.map((p) => p.id);
      const i = ids.indexOf(id), to = i + dy;
      if (!dy || i < 0 || to < 0 || to >= ids.length) return;
      [ids[i], ids[to]] = [ids[to], ids[i]];
      layout.order(all, cols, ids);
      announce(titleOf(id) + ' moved to position ' + (to + 1) + ' of ' + ids.length);
      refocus(id);
      return;
    }
    const p = nudgePin(placed, id, dx, dy, cols);
    if (!p) {
      announce(titleOf(id) + (dx ? ': at the edge' : ': nothing free above'));
      return;
    }
    layout.move(all, cols, p);
    const q = layout.arrange(all, cols).find((r) => r.id === id);
    if (q) announce(titleOf(id) + ' at ' + where(q));
    refocus(id);
  }
  /** Enter on a grip with no look popover in its card (DashItem opens one where there is). */
  const keyLook = (id) => announce(titleOf(id) + ' has no presentation choices');
  /** Delete on a grip: the selection when the card is in it, else the card. */
  const keyDelete = (id) => deleteSel(selSet.has(id) ? selItems : placed.filter((p) => p.id === id));
  function keyResize(id, dw, dh) {
    const p = placed.find((q) => q.id === id);
    if (!p || stack) return;
    const r = resizeRect(p, 'se', { x: p.x + p.w - 1 + dw, y: p.y + p.h - 1 + dh }, cols, minOf(p, p.h));
    const b = blocker(placed, r, id);
    if (b) { announce(titleOf(id) + ': blocked by ' + titleOf(b.id)); return; }
    layout.move(all, cols, { id, x: r.x, y: r.y, w: r.w, h: r.h });
    const q = layout.arrange(all, cols).find((x) => x.id === id);
    if (!q) return;
    if (r.refused) announce(titleOf(id) + ': minimum size, ' + q.w + ' by ' + q.h + ' cells');
    else announce(titleOf(id) + ' resized to ' + q.w + ' by ' + q.h + ' cells'
      + (orientationOf(q.w, q.h) !== orientationOf(p.w, p.h) ? ', now ' + ORIENT[orientationOf(q.w, q.h)] : ''));
  }

  // ---- palette drag-to-place --------------------------------------------------------
  // A dropped module lands at the drop cell and fills to the row's end, at
  // least MIN_DROP_W cells wide (shifted left when the row is shorter).
  const MIN_DROP_W = 8;
  const accepts = (e) => editing && ondropkey && e.dataTransfer && [...e.dataTransfer.types].includes(MODULE_MIME);
  function dragOver(e) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (given) { paletteOver = true; return; }
    if (stack) return;
    const c = cellAt(e.clientX, e.clientY);
    const w = Math.max(cols - c.x, Math.min(cols, MIN_DROP_W));
    const r = { x: Math.min(c.x, cols - w), y: c.y, w, h: DEFAULT_H };
    if (!dropRect || r.x !== dropRect.x || r.y !== dropRect.y) dropRect = r;
  }
  function dragLeave(e) {
    if (!gridEl.contains(e.relatedTarget)) { dropRect = null; paletteOver = false; }
  }
  function drop(e) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData(MODULE_MIME);
    const r = dropRect;
    dropRect = null;
    paletteOver = false;
    if (key) ondropkey(key, r);
  }

  // ---- toolbar -------------------------------------------------------------------
  function resetLayout() {
    layout.reset();
    pin = null;
    stackOrder = null;
    announce('Layout reset to default');
  }
  function setEditing(on) {
    editing = on;
    pin = null;
    stackOrder = null;
    sel = [];
    announce('Layout edit mode ' + (on ? 'on' : 'off'));
  }
  // ---- layout switching: no motion, a guard for changes, JSON in and out ----------
  function pick(e) {
    const to = e.currentTarget.value;
    e.currentTarget.value = layouts.active;
    if (to === layouts.active) return;
    if (changed()) {
      pendingSwitch = to;
      announce(layouts.active + ' changed while editing: keep or discard');
      return;
    }
    doSwitch(to);
  }
  function doSwitch(to) {
    const from = layouts.active;
    pendingSwitch = null;
    pin = null;
    stackOrder = null;
    sel = [];
    if (switchLayout(to)) announce('Layout ' + to + (from !== to ? ', was ' + from : ''));
  }
  function resolveSwitch(how) {
    const to = pendingSwitch;
    if (how === 'stay' || !to) { pendingSwitch = null; announce('Staying on ' + layouts.active); return; }
    if (how === 'discard') restoreLayout(layouts.active, baseline);
    doSwitch(to);
  }
  function exportText() {
    layoutText = exportLayout(layouts.active);
    navigator.clipboard?.writeText(layoutText).then(() => announce('Layout ' + layouts.active + ' copied'), () => {});
    announce('Layout ' + layouts.active + ' exported');
  }
  function importText() {
    try {
      const name = importLayout(layoutText);
      layoutText = '';
      if (changed()) {
        pendingSwitch = name;
        announce('Imported layout ' + name + ': keep or discard ' + layouts.active + ' changes');
      } else {
        doSwitch(name);
        announce('Imported layout ' + name);
      }
    } catch (err) {
      announce('Not imported: ' + err.message);
    }
  }
  function nameOp(fn, ok, fail) {
    if (fn(nameDraft)) { announce(ok + ' ' + nameDraft.trim()); nameDraft = ''; } else announce(fail);
  }
  /** Fix a new unplaced entry at the first free rect it is drawn at (grid.js addNest). */
  const settleNew = (id) => {
    if (id) layout.move(all.some((it) => it.id === id) ? all : [...all, { id }], cols, null);
    return id;
  };
  function newNest() {
    if (settleNew(layout.addNest())) announce('Added an empty nest');
  }
  function insertModule() {
    const here = preview ? preview.filter((m) => m.title).length : 0;
    if (moduleDraft && settleNew(layout.insertModule(moduleDraft))) {
      announce('Placed module ' + moduleDraft + ', ' + here + ' of ' + (preview ? preview.length : 0) + ' members here');
    }
  }
  function undoOnce() {
    if (undoLast()) { pin = null; stackOrder = null; announce('Undone'); }
  }
  // Ctrl+Z (Cmd+Z) in edit mode, unless a text control owns the keystroke.
  function onKey(e) {
    if (e.key === 'Escape') {
      if (pin || marquee) { e.preventDefault(); cancelDrag(); }
      else if (editing && selSet.size && !(e.target.closest && e.target.closest('input, textarea, select, [popover]'))) {
        sel = [];
        announce('Selection cleared');
      }
      return;
    }
    if (given || !editing || e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    undoOnce();
  }
</script>

{#snippet nestCard(item)}
  <Nest {item} parent={layout} {editing} {announce} target={pin?.into === item.id}
        ondragout={(it, x, y, phase) => childOut(item.id, it, x, y, phase)}
        ondropkey={ondropkey && ((key) => ondropkey(key, null, item.id))}
        candidates={all.filter((it) => it.kind !== 'nest' && placeable(it.kind, true))} />
{/snippet}

<svelte:window onresize={() => (winW = window.innerWidth)} onkeydown={onKey} />

{#snippet selbar()}
  <div class="dash-selbar" class:over={!!given} role="group" aria-label="Selection">
    <span class="sel-n">{selSet.size} selected</span>
    <button type="button" class="og-btn sm" disabled={!selItems.some(canDup)} onclick={duplicateSel}
            title={selItems.some(canDup) ? 'Place a copy' : 'Placed once per grid'}>Duplicate</button>
    {#if selSet.size > 1}
      <button type="button" class="og-btn sm" onclick={() => arrangeSel('left')}>Align left</button>
      <button type="button" class="og-btn sm" onclick={() => arrangeSel('top')}>Align top</button>
      {#if selSet.size > 2}<button type="button" class="og-btn sm" onclick={() => arrangeSel('spread')}>Spread</button>{/if}
    {/if}
    <button type="button" class="og-btn sm" disabled={!selItems.some(canDrop)} onclick={() => deleteSel()}>Remove</button>
    <button type="button" class="og-btn sm" onclick={() => { sel = []; announce('Selection cleared'); }}>Clear</button>
  </div>
{/snippet}

<div class="dash-wrap" data-density={given ? null : density()}>
  {#if !given}
  <!-- One row in both modes: the status slot swaps the hint, the selection
       and the switch guard in place, so the grid never moves. -->
  <div class="dash-toolbar" class:stack>
    <select class="layout-pick" aria-label="Layout" title="Layout" value={layouts.active} onchange={pick}>
      {#each layoutNames() as n (n)}<option value={n}>{n}</option>{/each}
    </select>
    {#if editing}
    <div class="dash-slot">
      {#if pendingSwitch}
        <div class="dash-selbar dash-switchbar" role="group" aria-label="Switch layout">
          <span class="sel-n">{layouts.active} changed while editing</span>
          <button type="button" class="og-btn sm" onclick={() => resolveSwitch('keep')}>Keep and switch</button>
          <button type="button" class="og-btn sm" onclick={() => resolveSwitch('discard')}>Discard and switch</button>
          <button type="button" class="og-btn sm" onclick={() => resolveSwitch('stay')}>Stay</button>
        </div>
      {:else if selSet.size}
        {@render selbar()}
      {:else}
        <span class="dash-hint" title="Drag grips to move, edges to resize">Drag grips to move, edges to resize</span>
      {/if}
    </div>
      <div class="edit-ops" role="group" aria-label="Layout editing">
        <button type="button" class="og-btn sm" disabled={!undo.can} title="Undo last change (Ctrl+Z)"
                onclick={undoOnce}>Undo</button>
        <button type="button" class="og-btn sm" onclick={newNest}>New nest</button>
        {#if palette.shown}
          <button type="button" class="og-btn sm palette-toggle" aria-pressed={palette.open} title="Module palette"
                  onclick={() => (palette.open = !palette.open)}>Modules</button>
        {/if}
        <button type="button" class="og-btn sm" popovertarget={menuId} style={'anchor-name: --' + menuId}>Layout…</button>
      </div>
      <div class="dash-menu og-panel" id={menuId} popover role="group" aria-label={'Layout ' + layouts.active}
           style={'position-anchor: --' + menuId}>
        <input class="layout-name" type="text" aria-label="Layout name" placeholder="Name" bind:value={nameDraft} />
        <div class="menu-row">
          <button type="button" class="og-btn sm" disabled={!nameDraft.trim()}
                  onclick={() => nameOp(saveLayoutAs, 'Saved layout', 'That name is taken')}>Save as</button>
          <button type="button" class="og-btn sm" disabled={!nameDraft.trim()}
                  onclick={() => nameOp((n) => renameLayout(layouts.active, n), 'Renamed to', 'That name is taken')}>Rename</button>
          <button type="button" class="og-btn sm" disabled={layoutNames().length < 2}
                  onclick={() => { const n = layouts.active; if (deleteLayout(n)) announce('Deleted layout ' + n); }}>Delete</button>
          <button type="button" class="og-btn sm" onclick={resetLayout}>Reset layout</button>
        </div>
        <div class="menu-row view-row">
          <div class="scale" role="group" aria-label="Scale">
            <button type="button" class="og-btn sm" aria-label="Scale down" title="Scale down"
                    disabled={grid.scale === grid.steps[0]} onclick={() => stepScale(-1)}>−</button>
            <button type="button" class="og-btn sm" aria-label="Reset scale"
                    title="Reset scale" onclick={() => stepScale(0)}>{Math.round(grid.scale * 100)}%</button>
            <button type="button" class="og-btn sm" aria-label="Scale up" title="Scale up"
                    disabled={grid.scale === grid.steps[grid.steps.length - 1]} onclick={() => stepScale(1)}>+</button>
          </div>
          <label class="og-switch density">
            <input type="checkbox" role="switch" checked={density() === 'compact'}
                   onchange={(e) => { setDensity(e.currentTarget.checked ? 'compact' : 'comfortable'); announce('Layout ' + layouts.active + ' is ' + density()); }} />
            <span class="track"></span>Compact cards
          </label>
        </div>
        <textarea class="layout-json" rows="3" spellcheck="false" aria-label="Layout JSON"
                  placeholder="Paste layout JSON to import" bind:value={layoutText}></textarea>
        <div class="menu-row">
          <button type="button" class="og-btn sm" onclick={exportText}>Export</button>
          <button type="button" class="og-btn sm" disabled={!layoutText.trim()} onclick={importText}>Import</button>
        </div>
        {#if moduleNames().length}
          <div class="menu-row">
            <select class="layout-pick" aria-label="Module" bind:value={moduleDraft}>
              <option value="">Module…</option>
              {#each moduleNames() as n (n)}<option value={n}>{n}</option>{/each}
            </select>
            <button type="button" class="og-btn sm" disabled={!moduleDraft} onclick={insertModule}>Insert</button>
            <button type="button" class="og-btn sm" disabled={!moduleDraft}
                    onclick={() => { const n = moduleDraft; if (deleteModule(n)) { moduleDraft = ''; announce('Deleted module ' + n); } }}>Delete module</button>
          </div>
          {#if preview}
            <p class="module-sum">{preview.filter((m) => m.title).length} of {preview.length} available here</p>
            <ul class="module-preview" aria-label={'Members of ' + moduleDraft}>
              {#each preview as m (m.key)}
                <li class:inert={!m.title}>{m.title || m.key}{m.title ? '' : ' (not on this machine)'}</li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    {/if}
    <button type="button" class="og-btn sm edit-toggle" class:done-btn={editing} aria-pressed={editing}
            onclick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit layout'}</button>
  </div>
  {:else if editing && selSet.size}
    {@render selbar()}
  {/if}

  <div class="dash-grid" class:stack class:editing class:top={!given} class:into={target || paletteOver} bind:this={gridEl} bind:clientWidth={width} data-view={given ? null : view.cls + '.' + viewId}
       style={'--cell:' + grid.cell + 'px;--cols:' + cols + (!given && editing && palette.shown && palette.open ? ';--reserve:' + palette.h + 'px' : '')} role="presentation"
       ondragover={dragOver} ondragleave={dragLeave} ondrop={drop}
       onpointerdown={marqueeStart} onpointermove={marqueeMove} onpointerup={marqueeEnd} onpointercancel={() => (marquee = null)}>
    {#each displayList as item (item.id)}
      <div class="dash-cell" data-id={item.id} data-floor={given ? minOf(item)(item.w, item.h)[0] : null} use:registerCell={item.id}
           style={stack ? '' : 'grid-column:' + (item.x + 1) + ' / span ' + item.w + ';grid-row:' + (item.y + 1) + ' / span ' + item.h}>
        {#if item.kind === 'section'}
          <h2 class="dash-section" title={item.title}><span>{item.title}</span></h2>
        {:else}
          <DashItem
            {item}
            w={item.w}
            h={item.h}
            pidx={pidx.get(item.id)}
            {editing}
            {stack}
            dragging={pin?.id === item.id || !!pin?.group?.some((g) => g.id === item.id)}
            selected={selSet.has(item.id)}
            clip={!stack && !pin && short(item)}
            onselect={(additive) => select(item.id, additive)}
            ongrabstart={(x, y) => grabStart(item.id, x, y)}
            ongrabmove={(x, y) => pointerMove(item.id, x, y)}
            ongrabend={() => pointerEnd(item.id)}
            onresizestart={(edge) => resizeStart(item.id, edge)}
            onresizemove={(x, y) => pointerMove(item.id, x, y)}
            onresizeend={() => pointerEnd(item.id)}
            onkeymove={(dx, dy) => keyMove(item.id, dx, dy)}
            onkeyresize={(dw, dh) => keyResize(item.id, dw, dh)}
            onkeylook={() => keyLook(item.id)}
            onkeydelete={() => keyDelete(item.id)}
            onremove={onremove && placeable(item.kind, false) ? () => onremove(item.id) : null}
          />
        {/if}
      </div>
    {/each}
    {#each ghosts as ghost (ghost.id || 'drop')}
      <div class="drop-ghost" class:refused={pin?.refused || pin?.blocked} aria-hidden="true"
           style={'grid-column:' + (ghost.x + 1) + ' / span ' + ghost.w + ';grid-row:' + (ghost.y + 1) + ' / span ' + ghost.h}>
        <span class="ghost-size">{ghost.w} × {ghost.h}{pin?.refused ? ' · minimum' : ''}{pin?.blocked ? ' · blocked' : ''}{pin?.start
          && orientationOf(ghost.w, ghost.h) !== orientationOf(pin.start.w, pin.start.h) ? ' · ' + ORIENT[orientationOf(ghost.w, ghost.h)] : ''}</span>
      </div>
    {/each}
    {#if mq}
      <div class="marquee" aria-hidden="true" style={'left:' + mq.left + 'px;top:' + mq.top + 'px;width:' + mq.width + 'px;height:' + mq.height + 'px'}></div>
    {/if}
  </div>

  <div class="sr-only" aria-live="polite">{announceMsg}</div>
</div>

<style>
  /* Positioned so the absolute announce region is contained here: anchored to
     the initial containing block it leaks below the fold and scrolling the
     document to it carries the top strip away (law 11, ph-e82.10). */
  .dash-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* One row: the slot between the picker and the edit group swaps its
     contents in place. Only the stacked phone grid wraps (ph-e82.7 owes
     its ruling): the picker keeps the first row, the edit group follows. */
  .dash-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dash-toolbar.stack { flex-wrap: wrap; justify-content: flex-end; }
  /* ponytail: clips past ~960 px with three or more selected; a menu for
     the align ops if that width ever edits. */
  .dash-slot {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .scale { display: flex; gap: 2px; }
  .view-row { align-items: center; gap: 12px; }
  .scale button { min-width: 40px; font-variant-numeric: tabular-nums; }
  .layout-pick { width: auto; min-width: 0; max-width: 14em; padding: 5px 28px 5px 10px; margin-right: auto; }
  .edit-ops { display: flex; gap: 6px; }
  .dash-hint {
    min-width: 0;
    font-size: .72rem;
    color: var(--ink-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dash-selbar {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: .8rem;
    color: var(--ink-hi);
    white-space: nowrap;
  }
  /* A nest's selection takes its bar's edit ops' place (Nest hides them
     meanwhile): `--bleed` is how far the subgrid reaches past the nest's
     frame, 6 px the bar's gap above the subgrid. */
  .dash-selbar.over {
    position: absolute;
    z-index: 3;
    right: var(--bleed, 0px);
    bottom: calc(100% + 6px);
    max-width: calc(100% - 2 * var(--bleed, 0px));
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .sel-n { margin-right: 6px; font-variant-numeric: tabular-nums; }
  .marquee {
    position: absolute;
    z-index: 2;
    border: 1px solid var(--highlight);
    background: color-mix(in srgb, var(--highlight) 12%, transparent);
    pointer-events: none;
  }

  /* A popover in the top layer: never clipped by the pane, never widens the
     page. Without anchor positioning it opens centered (the UA default). */
  .dash-menu {
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    max-width: calc(100vw - 32px);
    color: var(--tx);
  }
  .dash-menu:popover-open { display: flex; }
  @supports (top: anchor(bottom)) {
    .dash-menu { inset: auto; top: anchor(bottom); right: anchor(right); margin: 6px 0 0; position-try-fallbacks: flip-block, flip-inline; }
  }
  .dash-menu .layout-pick { margin-right: 0; }
  .menu-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .module-sum { margin: 0; font-size: .75rem; color: var(--ink-dim); }
  .module-preview {
    margin: 0;
    padding: 0 0 0 1.2em;
    max-height: 12em;
    overflow-y: auto;
    font-size: .8rem;
    overflow-wrap: anywhere;
  }
  .module-preview .inert { color: var(--ink-faint); font-style: italic; }
  .layout-json {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font-family: var(--mono);
    font-size: .72rem;
    resize: vertical;
  }
  .layout-name {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
    font-size: .82rem;
  }
  @media (pointer: coarse) { .layout-name { min-height: 40px; } }
  .done-btn {
    color: var(--ink-hi);
    border-color: var(--line-4);
  }

  /* Tracks are exactly one cell, rows too; the spacing lives inside
     .dash-cell so the cell pitch IS the cell edge
     (test/dash-measure.test.mjs measures it). An empty grid keeps a few rows
     to drop onto, in both modes, so editing never resizes a nest. The top
     grid is the anchor the palette overlays; it reserves the palette's
     height (`--reserve`) below its top, so the page ends past the palette
     and no card moves. */
  .dash-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--cell));
    grid-auto-rows: var(--cell);
    min-width: 0;
    min-height: calc(var(--cell) * 3);
  }
  /* Top grid only: a nest's subgrid inherits --reserve and must not grow by it. */
  .dash-grid.top { anchor-name: --dash-grid; min-height: max(calc(var(--cell) * 3), var(--reserve, 0px)); }
  .dash-grid.stack { grid-template-columns: minmax(0, 1fr); grid-auto-rows: auto; }
  /* Edit mode shows the cell lattice, so a drop target reads in cells. */
  .dash-grid.editing:not(.stack) {
    background-image:
      linear-gradient(to right, var(--line-soft) 1px, transparent 1px),
      linear-gradient(to bottom, var(--line-soft) 1px, transparent 1px);
    background-size: var(--cell) var(--cell);
  }
  /* A nest about to take a drop: the whole subgrid lights, since a joining
     member flows at the nest's end rather than at a cell. */
  .dash-grid.into {
    outline: 2px dashed var(--intent);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--intent) 10%, transparent);
  }
  .drop-ghost {
    z-index: 1;
    margin: 3px;
    border: 1.5px dashed var(--intent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--intent) 8%, transparent);
    pointer-events: none;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    min-width: 0;
    overflow: hidden;
  }
  /* A layout limit, not a machine fault: the refusal reads in the chassis's
     high ink, never in a safety color (law 13 keeps those for hazards). */
  .drop-ghost.refused { border-style: solid; border-color: var(--ink-hi); }
  .ghost-size {
    margin: 4px;
    padding: 1px 6px;
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--ink-hi);
    font-family: var(--mono);
    font-size: .72rem;
    white-space: nowrap;
  }

  /* The gutter between cards; a selected card's outline sits inside it. */
  .dash-cell {
    padding: var(--dash-cell-pad, 7px);
    min-width: 0;
  }
  /* A section's header row (DESIGN §10.11): text and a hairline on the page,
     never a band or a third tint, in the card titles' type step. The label
     sits on the row's floor, over the cards it heads. */
  .dash-section {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    height: 100%;
    font-size: var(--dash-title-size, .8rem);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--ink-hi);
  }
  .dash-section > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dash-section::after {
    content: '';
    flex: 1 1 0;
    margin-bottom: .55em;
    border-bottom: 1px solid var(--line-2);
  }
  /* Density (per layout): cells keep their size; the gutter, the card padding
     and the card label shrink. Read by DashItem through the inherited tokens.
     The label stays at 11 px or more (test/responsive-matrix.mjs font floor)
     and every handle keeps its 40 px (law 12). */
  .dash-wrap[data-density='compact'] {
    --dash-cell-pad: 4px;
    --dash-body-pad: 6px;
    --dash-title-size: .7rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
