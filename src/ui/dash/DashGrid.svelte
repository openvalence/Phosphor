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
   * nest's frame while in flight. Nests stored in the view are drawn as
   * items; an item that is a member of a nest is drawn inside it, not at the
   * top level. With `layout` (a dashboardLayout().nest(id) controller) this
   * is a nest's own subgrid: no toolbar, no nests inside.
   * Host hooks (the home passes them; a category page does not):
   * `ondelete(ids)` removes from the surface, `onduplicate(id) -> id` places a
   * second instance, `resolve(key) -> title|null` names a module member this
   * view can draw. An item may carry `min(look, orientation)`, `selfLabeled`
   * and, for a nest, `retitle(name)`. Internal: `ondragout` and `target` wire a
   * nest's subgrid to its parent.
   *
   * Constraints:
   * - A drag or resize is a preview (`pin`) until pointer-up; only the commit
   *   writes the layout, so every intermediate frame is cancelable (Escape).
   *   The preview is the commit's own result (grid.js settle).
   * - DOM order is reading order, frozen while a drag is in flight: moving the
   *   node that holds pointer capture drops the capture.
   * - Nothing on the grid transitions or animates: a layout switch or a
   *   reflow lands at once, never as motion that could read as the machine.
   * - A resize never goes below the item's `min(look, orientation)` cells
   *   (grid.js resizeRect, RESIZE_FLOOR without one): the ghost shows the
   *   refusal and the live region says it, never a silent clamp.
   * - Rows are minmax(cell, auto): `h` is a floor, and a card whose content
   *   is taller grows its rows rather than clipping a control.
   * - Under 641 CSS px every item is stacked full width (mobile is
   *   ph-e82.7's ruling); a drag there commits a reading order, never cells.
   * - `ondropkey(key, rect)` takes a palette entry dragged onto the grid in
   *   edit mode (grid.js MODULE_MIME); `rect` is the cell area the drop target
   *   showed, null when stacked. A nest's grid hands it on with the nest's id.
   * - The toolbar holds one row at 1280 CSS px: the rarely used layout and
   *   module operations sit in one popover menu (test/responsive-matrix.mjs).
   */
  import DashItem from './DashItem.svelte';
  import Nest from './Nest.svelte';
  import {
    dashboardLayout, grid, stepScale, layouts, layoutNames, undo, undoLast,
    switchLayout, saveLayoutAs, renameLayout, deleteLayout, moduleNames, deleteModule,
    layoutJson, restoreLayout, exportLayout, importLayout, density, setDensity,
  } from '../../model/dashboard.svelte.js';
  import { tick, untrack } from 'svelte';
  import { cellCount, placeable, resizeRect, arrangePins, nudgePin, DEFAULT_H, MODULE_MIME } from '../../model/grid.js';
  import { orientationOf } from '../../model/settings.js';
  import { view } from '../../model/viewport.svelte.js';

  let { viewId = '', items, editing = $bindable(false), layout: given = null, onremove = null, ondropkey = null,
    ondragout = null, target = false, ondelete = null, onduplicate = null, resolve = null } = $props();
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
  // edit, so "changes" means changes since then, which Discard can take back.
  let baseline = $state(null);
  let pendingSwitch = $state(null);
  let layoutText = $state('');
  $effect(() => {
    const a = layouts.active;
    const on = !given && editing;
    // untrack (T23): the snapshot reads the whole layout and must not subscribe to it.
    untrack(() => { baseline = on ? layoutJson(a) : null; pendingSwitch = null; });
  });
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
  const placed = $derived(layout.arrange(all, cols, live)
    .map((p) => ({ ...p, setLook: (look) => layout.setLook(p.id, look, p) })));
  // The drop targets: where the dragged cards or the palette entry land on release.
  const ghosts = $derived(stack ? [] : live ? placed.filter((p) => (pin.group || [pin]).some((g) => g.id === p.id))
    : dropRect ? [dropRect] : []);
  const selSet = $derived(new Set(editing ? sel.filter((id) => placed.some((p) => p.id === id)) : []));
  const selItems = $derived(placed.filter((p) => selSet.has(p.id)));
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

  let gridEl;
  /** @type {Map<string, HTMLElement>} */
  const cellEls = new Map();
  function registerCell(node, id) {
    cellEls.set(id, node);
    return { destroy() { if (cellEls.get(id) === node) cellEls.delete(id); } };
  }

  // An item may carry `min(look, orientation) -> [w, h]` in cells (Home's controls do).
  const minOf = (p) => p && p.min ? (w, h) => p.min(p.look, orientationOf(w, h)) : null;
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

  /** Client point -> cell; rows past the grid's end are cell-sized. */
  function cellAt(clientX, clientY) {
    const r = gridEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(cols - 1, Math.floor((clientX - r.left) / grid.cell)));
    const tracks = getComputedStyle(gridEl).gridTemplateRows.split(' ').map(parseFloat).filter(Number.isFinite);
    let y = 0, top = r.top;
    for (; y < tracks.length && clientY >= top + tracks[y]; y++) top += tracks[y];
    if (y === tracks.length) y += Math.max(0, Math.floor((clientY - top) / grid.cell));
    return { x, y };
  }

  // ---- pointer: move / resize ------------------------------------------------
  function grabStart(id) {
    if (stack) { stackOrder = placed.map((p) => p.id); pin = { id, mode: 'stack' }; return; }
    const p = placed.find((q) => q.id === id);
    if (!p) return;
    dragMoved = false;
    stackOrder = displayList.map((q) => q.id);
    const group = selSet.size > 1 && selSet.has(id) ? selItems.map(({ id: i, x, y, w, h }) => ({ id: i, x, y, w, h })) : null;
    pin = { id, x: p.x, y: p.y, w: p.w, h: p.h, mode: 'move', ...(group ? { group, x0: p.x, y0: p.y } : {}) };
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
    const r = resizeRect(pin.start, pin.edge, c, cols, minOf(placed.find((q) => q.id === id)));
    if (r.x === pin.x && r.y === pin.y && r.w === pin.w && r.h === pin.h && r.refused === pin.refused) return;
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
    if (c.x !== pin.x || c.y !== pin.y) dragMoved = true;
    if (pin.group) { pin = { ...pin, x: c.x, y: c.y }; return; }
    if (given && ondragout) {
      const r = (gridEl.closest('.nest-body') || gridEl).getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) {
        if (!pin.out) announce('Release to move ' + titleOf(id) + ' out of the nest');
        pin = { ...pin, out: true, cx, cy };
        ondragout(it, cx, cy, 'move');
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
    pin = { ...pin, x: c.x, y: c.y, into: null, out: false, cx, cy };
  }
  /** A member dragged out of nest `nestId` (its grid's ondragout): ghost while moving, top level on release. */
  function childOut(nestId, it, cx, cy, phase) {
    if (phase === 'cancel' || !it) { dropRect = null; return; }
    const c = cellAt(cx, cy);
    const w = Math.min(cols, it.w);
    const r = { x: Math.min(c.x, cols - w), y: c.y, w, h: it.h };
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
      ondragout(placed.find((q) => q.id === id), pin.cx, pin.cy, 'end');
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
      if (p) announce(titleOf(id) + ' at ' + where(p) + (pin.refused ? ', its minimum' : '') + (flip ? ', now ' + ORIENT[orientationOf(p.w, p.h)] : ''));
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
    sel = made;
    announce(made.length ? 'Duplicated ' + made.length + ', placed below' : 'Nothing here can be duplicated');
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
      announce(titleOf(id) + (dx ? ' is at the edge' : dy < 0 ? ' is at the top of its columns' : ' is at the bottom of its columns'));
      return;
    }
    layout.move(all, cols, p);
    const q = layout.arrange(all, cols).find((r) => r.id === id);
    if (q) announce(titleOf(id) + ' at ' + where(q));
    refocus(id);
  }
  /** Enter on a grip: the card's presentation picker (a [data-look] select its body draws), else say there is none. */
  function keyLook(id) {
    const s = cellEls.get(id)?.querySelector('[data-look] select');
    if (!s) { announce(titleOf(id) + ' has no presentation choices'); return; }
    s.focus();
    try { s.showPicker(); } catch (e) { /* focused is enough where showPicker is missing */ }
  }
  /** Delete on a grip: the selection when the card is in it, else the card. */
  const keyDelete = (id) => deleteSel(selSet.has(id) ? selItems : placed.filter((p) => p.id === id));
  function keyResize(id, dw, dh) {
    const p = placed.find((q) => q.id === id);
    if (!p || stack) return;
    const r = resizeRect(p, 'se', { x: p.x + p.w - 1 + dw, y: p.y + p.h - 1 + dh }, cols, minOf(p));
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
    if (baseline !== null && layoutJson() !== baseline) {
      pendingSwitch = to;
      announce(layouts.active + ' has changes since editing began; keep or discard them before switching');
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
    navigator.clipboard?.writeText(layoutText).then(() => announce('Layout ' + layouts.active + ' copied as JSON'), () => {});
    announce('Layout ' + layouts.active + ' exported below');
  }
  function importText() {
    try {
      const name = importLayout(layoutText);
      layoutText = '';
      if (baseline !== null && layoutJson() !== baseline) {
        pendingSwitch = name;
        announce('Imported layout ' + name + '; keep or discard the changes to ' + layouts.active + ' to switch to it');
      } else {
        doSwitch(name);
        announce('Imported layout ' + name + ' and switched to it');
      }
    } catch (err) {
      announce('Not imported: ' + err.message);
    }
  }
  function nameOp(fn, ok, fail) {
    if (fn(nameDraft)) { announce(ok + ' ' + nameDraft.trim()); nameDraft = ''; } else announce(fail);
  }
  function newNest() {
    const id = layout.addNest();
    if (id) announce('Added an empty nest');
  }
  function insertModule() {
    const here = preview ? preview.filter((m) => m.title).length : 0;
    if (moduleDraft && layout.insertModule(moduleDraft)) {
      announce('Placed module ' + moduleDraft + ', ' + here + ' of ' + (preview ? preview.length : 0) + ' members available here');
    }
  }
  function undoOnce() {
    if (undoLast()) { pin = null; stackOrder = null; announce('Undid the last layout change'); }
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
  <Nest {item} parent={layout} {editing} {stack} {announce} target={pin?.into === item.id}
        ondragout={(it, x, y, phase) => childOut(item.id, it, x, y, phase)}
        ondropkey={ondropkey && ((key) => ondropkey(key, null, item.id))}
        candidates={all.filter((it) => it.kind !== 'nest' && placeable(it.kind, true))} />
{/snippet}

<svelte:window onresize={() => (winW = window.innerWidth)} onkeydown={onKey} />

<div class="dash-wrap" data-density={given ? null : density()}>
  {#if !given}
  <div class="dash-toolbar">
    <div class="scale" role="group" aria-label="Scale">
      <button type="button" class="og-btn sm" aria-label="Scale down"
              disabled={grid.scale === grid.steps[0]} onclick={() => stepScale(-1)}>−</button>
      <button type="button" class="og-btn sm" aria-label="Reset scale"
              title="Reset scale" onclick={() => stepScale(0)}>{Math.round(grid.scale * 100)}%</button>
      <button type="button" class="og-btn sm" aria-label="Scale up"
              disabled={grid.scale === grid.steps[grid.steps.length - 1]} onclick={() => stepScale(1)}>+</button>
    </div>
    <select class="layout-pick" aria-label="Layout" title="Layout" value={layouts.active} onchange={pick}>
      {#each layoutNames() as n (n)}<option value={n}>{n}</option>{/each}
    </select>
    {#if editing}
      <div class="edit-ops" role="group" aria-label="Layout editing">
        <button type="button" class="og-btn sm" disabled={!undo.can} title="Undo the last layout change (Ctrl+Z)"
                onclick={undoOnce}>Undo</button>
        <button type="button" class="og-btn sm" onclick={newNest}>New nest</button>
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
        <label class="og-switch density">
          <input type="checkbox" role="switch" checked={density() === 'compact'}
                 onchange={(e) => { setDensity(e.currentTarget.checked ? 'compact' : 'comfortable'); announce('Layout ' + layouts.active + ' is ' + density()); }} />
          <span class="track"></span>Compact cards in {layouts.active}
        </label>
        <textarea class="layout-json" rows="3" spellcheck="false" aria-label="Layout JSON"
                  placeholder="Export fills this; paste a layout here to import" bind:value={layoutText}></textarea>
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
            <p class="module-sum">{preview.filter((m) => m.title).length} of {preview.length} available here{preview.some((m) => !m.title)
              ? '; the rest stay inert until a catalog has them' : ''}</p>
            <ul class="module-preview" aria-label={'Members of ' + moduleDraft}>
              {#each preview as m (m.key)}
                <li class:inert={!m.title}>{m.title || m.key}{m.title ? '' : ' (not available here)'}</li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    {/if}
    <button type="button" class="og-btn sm edit-toggle" class:done-btn={editing} aria-pressed={editing}
            onclick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit layout'}</button>
  </div>
  {#if pendingSwitch}
    <div class="dash-selbar dash-switchbar" role="group" aria-label="Switch layout">
      <span class="sel-n">{layouts.active} changed since editing began.</span>
      <button type="button" class="og-btn sm" onclick={() => resolveSwitch('keep')}>Keep and switch</button>
      <button type="button" class="og-btn sm" onclick={() => resolveSwitch('discard')}>Discard and switch</button>
      <button type="button" class="og-btn sm" onclick={() => resolveSwitch('stay')}>Stay</button>
    </div>
  {:else if editing && !selSet.size}
    <p class="dash-hint">Drag a card by its grip, resize it by any edge or corner, or drag a palette entry onto the grid.
      Click grips to select (Shift adds) or drag across empty grid. Keyboard: focus a grip; arrows move, Shift+arrows
      resize, Space selects, Enter picks a look, Delete removes, Esc cancels a drag. Ctrl+Z undoes the last change.</p>
  {/if}
  {/if}
  {#if editing && selSet.size}
    <div class="dash-selbar" role="group" aria-label="Selection">
      <span class="sel-n">{selSet.size} selected</span>
      <button type="button" class="og-btn sm" disabled={!selItems.some(canDup)} onclick={duplicateSel}
              title={selItems.some(canDup) ? 'Copy below' : 'A control is placed once per grid; a nest can hold it twice'}>Duplicate</button>
      {#if selSet.size > 1}
        <button type="button" class="og-btn sm" onclick={() => arrangeSel('left')}>Align left</button>
        <button type="button" class="og-btn sm" onclick={() => arrangeSel('top')}>Align top</button>
        {#if selSet.size > 2}<button type="button" class="og-btn sm" onclick={() => arrangeSel('spread')}>Spread</button>{/if}
      {/if}
      <button type="button" class="og-btn sm" disabled={!selItems.some(canDrop)} onclick={() => deleteSel()}>Remove</button>
      <button type="button" class="og-btn sm" onclick={() => { sel = []; announce('Selection cleared'); }}>Clear</button>
    </div>
  {/if}

  <div class="dash-grid" class:stack class:editing class:into={target || paletteOver} bind:this={gridEl} bind:clientWidth={width} data-view={given ? null : view.cls + '.' + viewId}
       style={'--cell:' + grid.cell + 'px;--cols:' + cols} role="presentation"
       ondragover={dragOver} ondragleave={dragLeave} ondrop={drop}
       onpointerdown={marqueeStart} onpointermove={marqueeMove} onpointerup={marqueeEnd} onpointercancel={() => (marquee = null)}>
    {#each displayList as item, i (item.id)}
      <div class="dash-cell" data-id={item.id} use:registerCell={item.id}
           style={stack ? '' : 'grid-column:' + (item.x + 1) + ' / span ' + item.w + ';grid-row:' + (item.y + 1) + ' / span ' + item.h}>
        <DashItem
          {item}
          w={item.w}
          h={item.h}
          pidx={String(i + 1).padStart(2, '0')}
          {editing}
          {stack}
          dragging={pin?.id === item.id || !!pin?.group?.some((g) => g.id === item.id)}
          selected={selSet.has(item.id)}
          onselect={(additive) => select(item.id, additive)}
          ongrabstart={() => grabStart(item.id)}
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
      </div>
    {/each}
    {#each ghosts as ghost (ghost.id || 'drop')}
      <div class="drop-ghost" class:refused={pin?.refused} aria-hidden="true"
           style={'grid-column:' + (ghost.x + 1) + ' / span ' + ghost.w + ';grid-row:' + (ghost.y + 1) + ' / span ' + ghost.h}>
        <span class="ghost-size">{ghost.w} × {ghost.h}{pin?.refused ? ' · minimum' : ''}{pin?.start
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

  /* Wraps only below the width the whole bar needs (phone): the scale and the
     picker keep the first row, the edit group and the toggle follow. */
  .dash-toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
  }
  .scale { display: flex; gap: 2px; }
  .scale button { min-width: 40px; font-variant-numeric: tabular-nums; }
  .layout-pick { width: auto; min-width: 0; max-width: 14em; padding: 5px 28px 5px 10px; margin-right: auto; }
  .edit-ops { display: flex; gap: 6px; }
  .dash-hint {
    margin: 0;
    font-size: .72rem;
    color: var(--ink-faint);
  }
  .dash-selbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: .8rem;
    color: var(--ink-hi);
  }
  .sel-n { margin-right: 6px; font-variant-numeric: tabular-nums; }
  .marquee {
    position: absolute;
    z-index: 2;
    border: 1px solid var(--intent);
    background: color-mix(in srgb, var(--intent) 12%, transparent);
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

  /* Tracks are exactly one cell; the spacing lives inside .dash-cell so the
     cell pitch IS the cell edge (test/dash-measure.test.mjs measures it). */
  .dash-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--cell));
    grid-auto-rows: minmax(var(--cell), auto);
    min-width: 0;
  }
  .dash-grid.stack { grid-template-columns: minmax(0, 1fr); }
  /* Edit mode shows the cell lattice, so a drop target reads in cells; an
     empty grid keeps a few rows to drop onto. */
  .dash-grid.editing { min-height: calc(var(--cell) * 3); }
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

  /* .og-panel's outline paints 4px outside each card's border box; 7px of
     padding keeps neighboring outlines apart and off the grid's edge. */
  .dash-cell {
    padding: var(--dash-cell-pad, 7px);
    min-width: 0;
  }
  /* Density (per layout): cells keep their size; the gutter, the card padding
     and the card label shrink. Read by DashItem through the inherited tokens.
     The label stays at 11 px or more (test/responsive-matrix.mjs font floor)
     and every handle keeps its 40 px (law 12). */
  .dash-wrap[data-density='compact'] {
    --dash-cell-pad: 4px;
    --dash-outline-offset: 2px;
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
