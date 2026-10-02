<script>
  /**
   * GraphEditor.svelte: the node graph as a node editor (DESIGN 10.2, 10.8).
   * A pannable, zoomable canvas of typed nodes: field and buttplug nodes with
   * input and output sockets, map nodes between them, bezier wires dragged
   * socket to socket. Mounted by src/plugins/graph.js into a plugin-hero slot.
   *
   * Constraints:
   * - Renders src/plugins/graph.js's runtime and nothing else: every edit
   *   goes through it (refusals come back in words), so undo, the store
   *   ladder and the local store stay in one place.
   * - Hub edges show the store's answer, never local belief (law 4); the
   *   ladder text rides the map node (law 5). Red is hub safety only (law
   *   13): refusals, faults and disarmed reasons are amber.
   * - Everything has a keyboard path: Tab reaches each node and socket in
   *   reading order; Enter on a socket starts or finishes a wire; the arrow
   *   keys move the selection; Delete, Ctrl+Z, Ctrl+Shift+Z, Ctrl+D act on
   *   it. Under a coarse pointer every socket is 40 px (law 12) and zoom
   *   never goes below 1 (DESIGN 10.5), so no target shrinks under the floor.
   * - The add menu and refusals live inside this box; full size stays below
   *   the top strip (RENDERING section 9).
   */
  import { onMount, untrack, tick } from 'svelte';
  import { machine } from '../../model/machine.svelte.js';
  import { refKey, preview, snap, GRID, MAPS } from '../../model/graph.js';
  import GraphPalette from './GraphPalette.svelte';

  let { rt } = $props();
  const R = untrack(() => rt);

  const NODE_W = 200;
  const MAP_W = 220;
  const SOCK_Y = 20;   // socket centers sit on the header's midline
  const K_MAX = 2;

  // ---- runtime state ---------------------------------------------------------
  let gen = $state(0);
  let beat = $state(0);   // buttplug readings and runner outputs are not reactive: redraw them at 10 Hz
  onMount(() => {
    const off = R.onChange(() => gen++);
    const t = setInterval(() => beat++, 100);
    return () => { off(); clearInterval(t); };
  });

  // ponytail: a JSON snapshot per change; the graph is tens of nodes.
  const g = $derived.by(() => { void gen; return JSON.parse(JSON.stringify(R.graph)); });
  const info = $derived.by(() => {
    void gen; void machine.catalog.etag;
    return new Map(g.nodes.map((n) => [n.id, { label: R.label(n.ref), ports: R.ports(n.ref), unit: R.unit(n.ref) }]));
  });
  const rosterId = $derived.by(() => { void gen; return R.hub.roster ? R.hub.roster.id : null; });
  $effect(() => { void machine.catalog.etag; void machine.link.phase; untrack(() => R.refreshHub()); });
  $effect(() => { if (rosterId == null) return; void machine.samples[rosterId]; untrack(() => R.refreshHub()); });

  /** Every box on the canvas in reading order, which is also the Tab order. */
  const boxes = $derived([
    ...g.nodes.map((o) => ({ kind: 'node', id: o.id, o, w: NODE_W })),
    ...g.rels.map((o) => ({ kind: 'rel', id: o.id, o, w: MAP_W })),
    ...g.drafts.map((o) => ({ kind: 'draft', id: o.id, o, w: MAP_W })),
  ].sort((a, b) => a.o.y - b.o.y || a.o.x - b.o.x));
  const byId = $derived(new Map(boxes.map((b) => [b.id, b])));

  const wires = $derived.by(() => {
    const out = [];
    for (const r of g.rels) {
      out.push({ id: r.id + ':in', map: r.id, side: 'in', a: r.from, b: r.id, home: r.home, rel: r });
      out.push({ id: r.id + ':out', map: r.id, side: 'out', a: r.id, b: r.to, home: r.home, rel: r });
    }
    for (const d of g.drafts) {
      if (d.from) out.push({ id: d.id + ':in', map: d.id, side: 'in', a: d.from, b: d.id, home: 'draft' });
      if (d.to) out.push({ id: d.id + ':out', map: d.id, side: 'out', a: d.id, b: d.to, home: 'draft' });
    }
    return out;
  });

  /** Armed or not, and why, per rel: client edges from the interlock, hub edges from the hub's roster only. */
  const armed = $derived.by(() => {
    void gen; void beat;
    return new Map(g.rels.map((r) => {
      if (r.home === 'client') return [r.id, { on: R.armed.ok, why: R.armed.why }];
      const h = R.hubArmed(r);
      return [r.id, { on: h.known ? h.armed : null, why: h.why }];
    }));
  });

  const note = $derived.by(() => { void gen; return { ok: R.armed.ok, why: R.armed.why, hub: R.hub.reason }; });
  const refOf = (id) => byId.get(id)?.o.ref;
  const fmt = (v) => (typeof v !== 'number' || !Number.isFinite(v) ? '' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  function liveIn(r) { void beat; const ref = refOf(r.from); return ref ? R.value(ref) : undefined; }
  function liveOut(r) {
    void beat;
    if (r.home === 'client') return R.out(r.id);
    const ref = refOf(r.to);
    return ref ? R.echo(ref).value : undefined;
  }

  function ladder(r) {
    if (r.home === 'client') return { phase: R.armed.ok ? 'armed' : 'disarmed', text: R.armed.why };
    const s = R.hubState(r);
    if (s.phase !== 'confirmed') return { phase: s.phase, text: s.reason };
    return { phase: 'confirmed', text: armed.get(r.id)?.why || '' };
  }

  // ---- view ------------------------------------------------------------------
  let vp = $state(null);
  let layer = $state(null);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const kMin = coarse ? 1 : 0.25;
  const clampK = (k) => Math.min(K_MAX, Math.max(kMin, k));
  let view = $state(R.view ? { ...R.view, k: clampK(R.view.k) } : { x: 40, y: 40, k: 1 });
  let viewT = 0;
  function saveView() {
    clearTimeout(viewT);
    viewT = setTimeout(() => R.setView({ ...view }), 300);
  }
  function zoomAt(px, py, f) {
    const k = clampK(view.k * f);
    view = { x: px - (px - view.x) * k / view.k, y: py - (py - view.y) * k / view.k, k };
    saveView();
  }
  function zoomBy(f) { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); }
  function reset() { view = { x: 40, y: 40, k: clampK(1) }; saveView(); }
  function fit() {
    const els = layer ? [...layer.querySelectorAll('[data-gid]')] : [];
    if (!els.length) { reset(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      const b = byId.get(el.dataset.gid);
      if (!b) continue;
      x0 = Math.min(x0, b.o.x); y0 = Math.min(y0, b.o.y);
      x1 = Math.max(x1, b.o.x + el.offsetWidth); y1 = Math.max(y1, b.o.y + el.offsetHeight);
    }
    const r = vp.getBoundingClientRect();
    const pad = 32;
    const k = clampK(Math.min(1.5, (r.width - 2 * pad) / (x1 - x0), (r.height - 2 * pad) / (y1 - y0)));
    view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
    saveView();
  }
  onMount(() => { if (!R.view && R.graph.nodes.length) tick().then(fit); });

  // The wheel must be a non-passive listener to keep the page from scrolling.
  $effect(() => {
    const el = vp;
    if (!el) return;
    const wheel = (e) => {
      if (e.target.closest('.gpal')) return;   // the add menu scrolls its own list
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const toWorld = (cx, cy) => {
    const r = vp.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k];
  };

  // ---- selection, messages -------------------------------------------------------
  let sel = $state(new Set());
  let selWire = $state(null);
  let flash = $state(null);   // {text, x, y} in viewport px: a refusal at the cursor
  let said = $state('');
  let flashT = 0;
  function refuse(text, cx, cy) {
    const r = vp.getBoundingClientRect();
    flash = { text, x: Math.min(cx - r.left, r.width - 240), y: cy - r.top + 14 };
    said = text;
    clearTimeout(flashT);
    flashT = setTimeout(() => { flash = null; }, 4000);
  }
  function refuseAt(text, el) {
    const b = el ? el.getBoundingClientRect() : vp.getBoundingClientRect();
    refuse(text, b.left + b.width / 2, b.top + b.height / 2);
  }
  async function focusBox(id) {
    await tick();
    const el = layer && layer.querySelector('[data-gid="' + id + '"]');
    if (el) el.focus();
  }

  // ---- pointer gestures ----------------------------------------------------------
  let drag = $state({});        // id -> [x, y] while a selection moves
  let wiring = $state(null);    // {id, side, x, y, over, why}: a wire following the pointer
  let kwire = $state(null);     // {id, side}: a wire started by Enter or a tap, waiting for its other end
  let box = $state(null);       // {x0, y0, x1, y1} viewport px: the marquee
  let boxMode = $state(false);
  let pal = $state(null);       // {x, y, wx, wy}: the add menu
  let full = $state(false);
  let gest = null;
  const touches = new Map();

  const at = (b) => drag[b.id] || [b.o.x, b.o.y];
  function sockXY(id, side) {
    const b = byId.get(id);
    if (!b) return null;
    const [x, y] = at(b);
    return [side === 'out' ? x + b.w : x, y + SOCK_Y];
  }
  function curve([x1, y1], [x2, y2]) {
    const c = Math.max(40, Math.abs(x2 - x1) / 2);
    return 'M' + x1 + ' ' + y1 + ' C' + (x1 + c) + ' ' + y1 + ' ' + (x2 - c) + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }

  function down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = e.target;
    if (t.closest('.gpal, .gtool')) return;
    if (pal) pal = null;
    const sock = t.closest('[data-sock]');
    if (sock) {
      gest = { kind: 'wire', id: sock.dataset.owner, side: sock.dataset.side, px: e.clientX, py: e.clientY, moved: false, pid: e.pointerId };
      return;
    }
    if (t.closest('.gwire-hit')) return;
    const node = t.closest('[data-gid]');
    if (node) {
      if (t.closest('input, select, textarea, button, label')) return;
      const id = node.dataset.gid;
      const was = sel.has(id);
      if (!was) sel = e.shiftKey ? new Set([...sel, id]) : new Set([id]);
      selWire = null;
      const start = new Map();
      for (const i of sel) { const b = byId.get(i); if (b) start.set(i, [b.o.x, b.o.y]); }
      gest = { kind: 'move', id, was, shift: e.shiftKey, px: e.clientX, py: e.clientY, start, moved: false };
      vp.setPointerCapture(e.pointerId);
      return;
    }
    vp.setPointerCapture(e.pointerId);
    vp.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) {
        const [[ax, ay], [bx, by]] = [...touches.values()];
        gest = { kind: 'pinch', d: Math.hypot(bx - ax, by - ay) || 1, mx: (ax + bx) / 2, my: (ay + by) / 2, v: { ...view } };
        return;
      }
    }
    const r = vp.getBoundingClientRect();
    if (boxMode || e.shiftKey) {
      gest = { kind: 'box', shift: e.shiftKey, x: e.clientX - r.left, y: e.clientY - r.top, moved: false };
    } else {
      gest = { kind: 'pan', px: e.clientX, py: e.clientY, v: { ...view }, moved: false, shift: e.shiftKey };
    }
  }

  function move(e) {
    if (!gest) return;
    const dx = e.clientX - (gest.px ?? 0);
    const dy = e.clientY - (gest.py ?? 0);
    const far = Math.abs(dx) + Math.abs(dy) > 4;
    if (gest.kind === 'pinch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      const [[ax, ay], [bx, by]] = [...touches.values()];
      const r = vp.getBoundingClientRect();
      const k = clampK(gest.v.k * Math.hypot(bx - ax, by - ay) / gest.d);
      const wx = (gest.mx - r.left - gest.v.x) / gest.v.k;
      const wy = (gest.my - r.top - gest.v.y) / gest.v.k;
      view = { k, x: (ax + bx) / 2 - r.left - wx * k, y: (ay + by) / 2 - r.top - wy * k };
    } else if (gest.kind === 'pan') {
      if (far) gest.moved = true;
      view = { ...gest.v, x: gest.v.x + dx, y: gest.v.y + dy };
    } else if (gest.kind === 'box') {
      const r = vp.getBoundingClientRect();
      gest.moved = true;
      box = { x0: gest.x, y0: gest.y, x1: e.clientX - r.left, y1: e.clientY - r.top };
    } else if (gest.kind === 'move') {
      if (!gest.moved && !far) return;
      gest.moved = true;
      const next = {};
      for (const [i, [x, y]] of gest.start) next[i] = [x + dx / view.k, y + dy / view.k];
      drag = next;
    } else if (gest.kind === 'wire') {
      if (!gest.moved && !far) return;
      if (!gest.moved) { gest.moved = true; vp.setPointerCapture(e.pointerId); }
      const [x, y] = toWorld(e.clientX, e.clientY);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sock]');
      let over = null;
      let why = '';
      if (hit && hit.dataset.side !== gest.side && hit.dataset.owner !== gest.id) {
        over = { id: hit.dataset.owner, side: hit.dataset.side };
        why = gest.side === 'out' ? R.why(gest.id, over.id) : R.why(over.id, gest.id);
      }
      wiring = { id: gest.id, side: gest.side, x, y, over, why };
    }
  }

  function up(e) {
    touches.delete(e.pointerId);
    const g0 = gest;
    gest = null;
    if (!g0) return;
    if (g0.kind === 'pinch' || g0.kind === 'pan') {
      saveView();
      if (g0.kind === 'pan' && !g0.moved && !g0.shift) { sel = new Set(); selWire = null; }
    } else if (g0.kind === 'box') {
      if (box) {
        const r = vp.getBoundingClientRect();
        const [l, rr] = [Math.min(box.x0, box.x1) + r.left, Math.max(box.x0, box.x1) + r.left];
        const [tp, bt] = [Math.min(box.y0, box.y1) + r.top, Math.max(box.y0, box.y1) + r.top];
        const hit = [...layer.querySelectorAll('[data-gid]')].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.right > l && b.left < rr && b.bottom > tp && b.top < bt;
        }).map((el) => el.dataset.gid);
        sel = new Set(g0.shift ? [...sel, ...hit] : hit);
        said = hit.length + ' selected';
      }
      box = null;
    } else if (g0.kind === 'move') {
      if (g0.moved) {
        const dx = (e.clientX - g0.px) / view.k;
        const dy = (e.clientY - g0.py) / view.k;
        R.moveMany([...g0.start].map(([id, [x, y]]) => ({ id, x: snap(x + dx), y: snap(y + dy) })));
        drag = {};
      } else if (g0.shift && g0.was) {
        sel = new Set([...sel].filter((i) => i !== g0.id));
      } else if (!g0.shift) {
        sel = new Set([g0.id]);
      }
    } else if (g0.kind === 'wire' && g0.moved) {
      const w = wiring;
      wiring = null;
      if (w && w.over) {
        const why = w.side === 'out' ? R.wire(w.id, w.over.id) : R.wire(w.over.id, w.id);
        if (why) refuse(why, e.clientX, e.clientY);
        else said = 'connected';
      }
    }
  }

  function menu(e) {
    if (e.target.closest('input, select, textarea, .gpal')) return;
    e.preventDefault();
    openPalette(e.clientX, e.clientY);
  }
  function openPalette(cx, cy) {
    const r = vp.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 3; }
    const [wx, wy] = toWorld(cx, cy);
    pal = { x: Math.max(8, Math.min(cx - r.left, r.width - 308)), y: Math.max(8, Math.min(cy - r.top, r.height - 200)), wx, wy };
  }

  // ---- sockets: tap or Enter to wire ---------------------------------------------
  function sockName(id, side) {
    const b = byId.get(id);
    const name = b ? (b.kind === 'node' ? info.get(id)?.label : b.o.name) : id;
    return (side === 'out' ? 'output of ' : 'input of ') + name;
  }
  function sockClick(e, id, side) {
    if (kwire && kwire.side !== side && kwire.id !== id) {
      const why = side === 'in' ? R.wire(kwire.id, id) : R.wire(id, kwire.id);
      kwire = null;
      if (why) refuseAt(why, e.currentTarget);
      else said = 'connected';
      return;
    }
    kwire = kwire && kwire.id === id && kwire.side === side ? null : { id, side };
    said = kwire ? 'Wiring from the ' + sockName(id, side) + ': choose an ' + (side === 'out' ? 'input' : 'output') + ' socket, Escape cancels' : 'wiring cancelled';
  }
  function sockFocus(id, side) {
    if (!kwire || kwire.side === side) return;
    const why = side === 'in' ? R.why(kwire.id, id) : R.why(id, kwire.id);
    said = why || 'Enter connects the ' + sockName(kwire.id, kwire.side) + ' to the ' + sockName(id, side);
  }

  // ---- keyboard and toolbar --------------------------------------------------------
  function del(e) {
    const sock = e && e.target.closest && e.target.closest('[data-sock]');
    if (sock) { R.unwire(sock.dataset.owner, sock.dataset.side); said = 'wire removed'; return; }
    if (selWire) {
      const w = wires.find((x) => x.id === selWire);
      selWire = null;
      if (w) { R.unwire(w.map, w.side); said = 'wire removed'; }
      return;
    }
    if (!sel.size) return;
    R.removeMany([...sel]);
    said = sel.size + ' removed';
    sel = new Set();
    vp.focus({ preventScroll: true });   // the focused node is gone; keep the keys here
  }
  function dup() {
    const made = R.duplicate([...sel]);
    if (!made.length) { said = 'nothing to duplicate: fields appear once on the canvas'; return; }
    sel = new Set(made);
    said = made.length + ' duplicated';
    focusBox(made[0]);
  }
  function cancel() {
    if (pal) { pal = null; return true; }
    if (wiring || kwire) { wiring = null; kwire = null; gest = null; said = 'wiring cancelled'; return true; }
    if (box) { box = null; gest = null; return true; }
    if (sel.size || selWire) { sel = new Set(); selWire = null; return true; }
    if (full) { full = false; return true; }
    return false;
  }

  function key(e) {
    if (e.key === 'Escape') { if (cancel()) e.preventDefault(); return; }
    if (e.target.closest('input, select, textarea, .gpal')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) R.redo(); else R.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); R.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); dup(); return; }
    if (mod && k === 'a') { e.preventDefault(); sel = new Set(boxes.map((b) => b.id)); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(e); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openPalette(); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d && sel.size && e.target.closest('[data-gid]') && !e.target.closest('[data-sock]')) {
      e.preventDefault();
      const s = GRID * (e.shiftKey ? 5 : 1);
      R.moveMany([...sel].map((id) => byId.get(id)).filter(Boolean).map((b) => ({ id: b.id, x: b.o.x + d[0] * s, y: b.o.y + d[1] * s })));
    }
  }

  // ---- the add menu ------------------------------------------------------------------
  const groups = $derived.by(() => {
    void gen; void machine.catalog.etag;
    if (!pal) return [];
    const p = R.palette();
    const by = (list, head) => {
      const m = new Map();
      for (const it of list) {
        const name = head + ': ' + it.group;
        if (!m.has(name)) m.set(name, { name, items: [] });
        m.get(name).items.push({ key: refKey(it.ref), label: it.label, value: { ref: it.ref } });
      }
      return [...m.values()];
    };
    return [
      ...by(p.sources, 'Sources'),
      { name: 'Maps', items: Object.entries(MAPS).map(([id, m]) => ({ key: 'map' + id, label: m.label, value: { map: Number(id) } })) },
      ...by(p.targets, 'Targets'),
    ];
  });
  function pick(v) {
    const { wx, wy } = pal;
    pal = null;
    let id;
    if (v.map != null) {
      id = R.placeMap(v.map, wx, wy);
      said = MAPS[v.map].label + ' placed: wire a source into its left socket and a target out of its right';
    } else {
      const r = R.place(v.ref, wx, wy);
      id = r.id;
      said = r.already ? 'already on the canvas: selected' : 'placed';
    }
    sel = new Set([id]);
    focusBox(id);
  }

  // ---- map nodes ------------------------------------------------------------------------
  const BOUNDS = [['in_min', 'In min'], ['in_max', 'In max'], ['out_min', 'Out min'], ['out_max', 'Out max']];
  const parse = (s) => s.split(/[\s,]+/).filter(Boolean).map(Number);
  function set(e, r, patch) {
    const why = R.edit(r.id, patch);
    if (why) refuseAt(why, e.currentTarget);
  }
  function pathOf(pv, w, h) {
    const sx = (x) => 4 + (w - 8) * (x - pv.x0) / ((pv.x1 - pv.x0) || 1);
    const sy = (y) => h - 4 - (h - 8) * (y - pv.y0) / ((pv.y1 - pv.y0) || 1);
    let d = '';
    let pen = false;
    for (const p of pv.pts) {
      if (!p) { pen = false; continue; }
      d += (pen ? ' L' : ' M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1);
      pen = true;
    }
    return { d, sx, sy };
  }
</script>

{#snippet socket(id, side, type, title)}
  <button type="button" class="gsock" data-sock data-owner={id} data-side={side} data-type={type}
          data-armed={kwire && kwire.id === id && kwire.side === side ? '' : null}
          aria-label={(side === 'in' ? 'Input' : 'Output') + ' socket, ' + title}
          title={(side === 'in' ? 'Input: ' : 'Output: ') + title}
          onclick={(e) => sockClick(e, id, side)} onfocus={() => sockFocus(id, side)}></button>
{/snippet}

{#snippet fieldNode(b)}
  {@const n = b.o}
  {@const nf = info.get(n.id) || { label: n.id, ports: {}, unit: '' }}
  {@const bp = n.ref.kind === 'bp'}
  {@const drivers = g.rels.filter((r) => r.to === n.id)}
  {@const stale = !bp && nf.ports.out ? (void beat, R.stale(n.ref)) : ''}
  <span class="ghead">
    <span class="gicon" aria-hidden="true">{bp ? '◎' : '◆'}</span>
    <span class="gname">{nf.label}</span>
    <span class="gbadge" data-home={bp ? 'client' : 'hub'}
          title={bp ? 'a buttplug device connected to Phosphor: edges with it run in Phosphor' : 'a catalog field: it lives on the hub'}>{bp ? 'client' : 'hub'}</span>
  </span>
  {#if nf.ports.out}
    {@const v = (void beat, R.value(n.ref))}
    <p class="gline" data-stale={stale ? '' : null} title={stale || null}>
      <span class="gnum">{fmt(v) || 'no value yet'}</span> {fmt(v) ? nf.unit : ''}{stale ? ' (' + stale + ')' : ''}
    </p>
  {/if}
  {#if nf.ports.in && drivers.length}
    {@const ec = (void beat, R.echo(n.ref))}
    {@const d = drivers.find((r) => r.enabled) || drivers[0]}
    {#if d.home === 'client'}<p class="gline">mapped <span class="gnum">{fmt((void beat, R.out(d.id))) || 'nothing yet'}</span></p>{/if}
    <p class="gline">reads <span class="gnum">{fmt(ec.value) || 'no value yet'}</span> {fmt(ec.value) ? nf.unit : ''}</p>
    {#if ec.status === 'fault'}<p class="gline" data-phase="fault" role="status">refused: {ec.reason || 'no echo'}</p>
    {:else if ec.status === 'pending' || ec.status === 'overdue'}<p class="gline" data-phase="pending">{ec.status}: waiting for the hub's echo</p>{/if}
  {/if}
  {#if nf.ports.in}{@render socket(n.id, 'in', nf.ports.in, nf.label)}{/if}
  {#if nf.ports.out}{@render socket(n.id, 'out', nf.ports.out, nf.label)}{/if}
{/snippet}

{#snippet mapNode(b)}
  {@const r = b.o}
  {@const isRel = b.kind === 'rel'}
  {@const why = isRel && refOf(r.from) && refOf(r.to) ? R.home(refOf(r.from), refOf(r.to)).why : 'a draft: wire a source into the left socket and a target out of the right'}
  <span class="ghead">
    <span class="gicon" aria-hidden="true">ƒ</span>
    <span class="gname">{r.name}</span>
    <span class="gbadge" data-home={isRel ? r.home : 'draft'} title={why}>{isRel ? r.home : 'draft'}</span>
  </span>
  {#if isRel}
    {@const st = ladder(r)}
    {@const a = armed.get(r.id)}
    <p class="gline" data-phase={st.phase} role="status">{st.text}</p>
    {#if a && a.on === false && st.phase !== 'disarmed'}<p class="gline" data-phase="disarmed">{a.why}</p>{/if}
    {@const pv = preview(r)}
    {@const P = pathOf(pv, 196, 44)}
    {@const xin = liveIn(r)}
    {@const yout = liveOut(r)}
    <svg class="gcurve" viewBox="0 0 196 44" aria-hidden="true" data-time={pv.time ? '' : null}>
      <path d={P.d} />
      {#if typeof yout === 'number' && (pv.time || typeof xin === 'number')}
        <circle r="3" cx={P.sx(pv.time ? pv.x1 : Math.min(pv.x1, Math.max(pv.x0, xin)))} cy={P.sy(Math.min(pv.y1, Math.max(pv.y0, yout)))} />
      {/if}
    </svg>
    <div class="gparams">
      <label class="wide">Name <input value={r.name} onchange={(e) => set(e, r, { name: e.currentTarget.value })} /></label>
      {#if MAPS[r.map].params}
        {#each BOUNDS as [k, label] (k)}
          <label>{label} <input type="number" step="any" value={r[k]} onchange={(e) => set(e, r, { [k]: Number(e.currentTarget.value) })} /></label>
        {/each}
        {#each MAPS[r.map].params as label, i (label)}
          <label>{label} <input type="number" step="any" value={r.params[i] ?? ''}
                 onchange={(e) => { const p = [...r.params]; p[i] = Number(e.currentTarget.value); set(e, r, { params: p }); }} /></label>
        {/each}
      {:else}
        <label class="wide">Points (in out, in out, ...)
          <input value={r.params.join(' ')} onchange={(e) => set(e, r, { params: parse(e.currentTarget.value) })} /></label>
      {/if}
      <label class="check"><input type="checkbox" checked={r.enabled} onchange={(e) => set(e, r, { enabled: e.currentTarget.checked })} /> Enabled</label>
    </div>
  {:else}
    <p class="gline">{r.from ? 'source wired' : 'needs a source (left socket)'}; {r.to ? 'target wired' : 'needs a target (right socket)'}</p>
  {/if}
  {@render socket(r.id, 'in', 'map', r.name)}
  {@render socket(r.id, 'out', 'map', r.name)}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="graph" class:full role="application" aria-label="Node graph editor" onkeydown={key}>
  <div class="gtool" role="toolbar" aria-label="Graph tools">
    <button type="button" class="og-btn" onclick={() => openPalette()} title="Add a node (right-click the canvas, or Shift+F10)">+ Add</button>
    <button type="button" class="og-btn" onclick={() => R.undo()} disabled={(void gen, !R.canUndo)} title="Undo (Ctrl+Z)">Undo</button>
    <button type="button" class="og-btn" onclick={() => R.redo()} disabled={(void gen, !R.canRedo)} title="Redo (Ctrl+Shift+Z)">Redo</button>
    <button type="button" class="og-btn" onclick={dup} disabled={!sel.size} title="Duplicate the selected maps (Ctrl+D)">Duplicate</button>
    <button type="button" class="og-btn" onclick={() => del()} disabled={!sel.size && !selWire} title="Delete the selection (Delete)">Delete</button>
    <button type="button" class="og-btn" aria-pressed={boxMode} onclick={() => { boxMode = !boxMode; }} title="Drag on the canvas selects a box instead of panning (Shift+drag does it once)">Box select</button>
    <button type="button" class="og-btn" onclick={fit} title="Fit everything in view">Fit</button>
    <button type="button" class="og-btn" onclick={reset} title="Reset the view">Reset view</button>
    <button type="button" class="og-btn" onclick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
    <button type="button" class="og-btn" onclick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
    <button type="button" class="og-btn" aria-pressed={full} onclick={() => { full = !full; }} title="Use the whole window below the top strip (Escape returns)">Full size</button>
  </div>
  <p class="gnote">
    Client edges: <span data-phase={note.ok ? 'armed' : 'disarmed'}>{note.why || 'not evaluated yet'}</span>.
    {#if note.hub}Hub edges: {note.hub}.{/if}
  </p>

  <div class="gview" bind:this={vp} role="group" aria-label="Canvas" tabindex="-1"
       style:background-size={Array(2).fill((GRID * view.k < 10 ? GRID * 5 : GRID) * view.k + 'px').join(' ')}
       style:background-position={view.x + 'px ' + view.y + 'px'}
       data-mode={boxMode ? 'box' : 'pan'}
       onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} oncontextmenu={menu}>
    <div class="glayer" bind:this={layer} style:transform={'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'}
         style:--k={view.k}>
      <svg class="gwires" aria-hidden="true">
        {#each wires as w (w.id)}
          {@const p1 = sockXY(w.a, 'out')}
          {@const p2 = sockXY(w.b, 'in')}
          {#if p1 && p2}
            {@const d = curve(p1, p2)}
            {@const a = w.rel ? armed.get(w.rel.id) : null}
            {@const v = w.rel ? (w.side === 'in' ? liveIn(w.rel) : liveOut(w.rel)) : undefined}
            <path class="gwire" {d} data-home={w.home} data-wire={w.id}
                  data-off={a && a.on === false ? '' : null} data-live={a && a.on && typeof v === 'number' ? '' : null}
                  data-sel={selWire === w.id ? '' : null} />
            <path class="gwire-hit" {d} role="presentation"
                  onpointerdown={(e) => { e.stopPropagation(); selWire = w.id; sel = new Set(); }} />
            {#if typeof v === 'number'}
              <text class="gval" x={(p1[0] + p2[0]) / 2} y={(p1[1] + p2[1]) / 2 - 6} text-anchor="middle">{fmt(v)}</text>
            {/if}
          {/if}
        {/each}
        {#if wiring}
          {@const p = sockXY(wiring.id, wiring.side)}
          {#if p}
            <path class="gwire" data-home="pending" data-refused={wiring.why ? '' : null}
                  d={wiring.side === 'out' ? curve(p, [wiring.x, wiring.y]) : curve([wiring.x, wiring.y], p)} />
          {/if}
        {/if}
      </svg>

      {#each boxes as b (b.id)}
        {@const [x, y] = at(b)}
        {@const a = b.kind === 'rel' ? armed.get(b.id) : null}
        {@const st = b.kind === 'rel' ? ladder(b.o) : null}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="gnode" data-gid={b.id} data-kind={b.kind} data-home={b.kind === 'rel' ? b.o.home : null}
             data-sel={sel.has(b.id) ? '' : null} data-off={a && a.on === false ? '' : null}
             data-shadow={st && st.phase === 'pending' ? 'pending' : null}
             style:left={x + 'px'} style:top={y + 'px'} style:width={b.w + 'px'}
             tabindex="0" role="group"
             aria-label={(b.kind === 'node' ? (info.get(b.id)?.label || '') : b.o.name + ' map') + (sel.has(b.id) ? ', selected' : '')}
             onfocus={(e) => { if (e.target === e.currentTarget && !sel.has(b.id)) { sel = new Set([b.id]); selWire = null; } }}>
          {#if b.kind === 'node'}{@render fieldNode(b)}{:else}{@render mapNode(b)}{/if}
        </div>
      {/each}
    </div>

    {#if !boxes.length}
      <p class="gempty">Right-click, or press + Add, to place a source, a map and a target. Drag from a socket to wire them.</p>
    {/if}
    {#if box}
      <div class="gbox" style:left={Math.min(box.x0, box.x1) + 'px'} style:top={Math.min(box.y0, box.y1) + 'px'}
           style:width={Math.abs(box.x1 - box.x0) + 'px'} style:height={Math.abs(box.y1 - box.y0) + 'px'}></div>
    {/if}
    {#if wiring && wiring.over}
      <p class="gcursor" data-phase={wiring.why ? 'fault' : 'ok'}
         style:left={wiring.x * view.k + view.x + 14 + 'px'} style:top={wiring.y * view.k + view.y + 14 + 'px'}>{wiring.why || 'release to connect'}</p>
    {/if}
    {#if flash}
      <p class="gcursor gflash" data-phase="fault" style:left={Math.max(4, flash.x) + 'px'} style:top={flash.y + 'px'}>{flash.text}</p>
    {/if}
    {#if pal}
      <GraphPalette {groups} x={pal.x} y={pal.y} onpick={pick} onclose={() => { pal = null; vp.focus(); }} />
    {/if}
  </div>
  <p class="gsr" role="status" aria-live="polite">{said}</p>
</div>

<style>
  .graph { position: relative; display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
  .graph.full { position: fixed; top: var(--strip-h, 0px); left: 0; right: 0; bottom: 0; z-index: 20; padding: 8px; background: var(--bg); }
  .gtool { display: flex; flex-wrap: wrap; gap: 4px; }
  .gtool .og-btn { width: auto; min-height: 30px; padding: 2px 10px; }
  .gtool .og-btn[aria-pressed='true'] { border-color: var(--intent); color: var(--ink-hi); }
  .gnote { margin: 0; font-size: 11px; color: var(--ink-dim); }
  [data-phase='disarmed'], [data-phase='fault'] { color: var(--warn); }
  [data-phase='pending'], [data-phase='overdue'] { color: var(--intent); }
  .gsr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); margin: 0; }

  .gview { position: relative; flex: 1 1 auto; min-height: 320px; overflow: hidden; touch-action: none; cursor: grab;
    background-color: var(--bg-sunken); border: 1px solid var(--line); border-radius: var(--radius);
    background-image: radial-gradient(circle, var(--line-3) 1px, transparent 1.5px); }
  .gview[data-mode='box'] { cursor: crosshair; }
  .gview:focus-visible { outline: 1px solid var(--intent); }
  .glayer { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
  .gwires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }

  .gwire { fill: none; stroke: var(--line-4); stroke-width: 2; }
  .gwire[data-home='hub'] { stroke: var(--reality); }
  .gwire[data-home='client'] { stroke: var(--intent); stroke-dasharray: 6 4; }
  .gwire[data-home='draft'], .gwire[data-home='pending'] { stroke: var(--line-4); stroke-dasharray: 3 4; }
  .gwire[data-refused] { stroke: var(--warn); }
  .gwire[data-off] { opacity: .35; }
  .gwire[data-sel] { stroke-width: 4; }
  .gwire[data-live] { animation: gflow .8s linear infinite; }
  .gwire[data-home='hub'][data-live] { stroke-dasharray: 14 4; }
  @keyframes gflow { to { stroke-dashoffset: -18; } }
  .gwire-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
  .gval { font-size: 10px; fill: var(--ink-hi); paint-order: stroke; stroke: var(--bg-sunken); stroke-width: 3px; font-family: var(--mono); }

  .gnode { position: absolute; box-sizing: border-box; padding: 0 8px 6px; touch-action: none; cursor: grab;
    background: var(--bg-card); color: var(--ink); border: 1px solid var(--line-3); border-radius: var(--radius); }
  .gnode[data-kind='rel'][data-home='hub'] { border-color: var(--reality); }
  .gnode[data-kind='rel'][data-home='client'] { border-color: var(--intent); }
  .gnode[data-kind='draft'] { border-style: dashed; }
  .gnode[data-sel] { box-shadow: 0 0 0 2px var(--ink-hi); }
  .gnode[data-off] { filter: saturate(.5) brightness(.85); }
  .gnode:focus-visible { outline: 2px solid var(--intent); outline-offset: 2px; }
  .ghead { display: flex; align-items: center; gap: 6px; height: 40px; }
  .gicon { color: var(--ink-dim); width: 1em; text-align: center; }
  .gname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; color: var(--ink-hi); }
  .gbadge { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; padding: 1px 4px; border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--ink-dim); cursor: help; }
  .gbadge[data-home='hub'] { color: var(--reality); border-color: var(--reality); }
  .gbadge[data-home='client'] { color: var(--intent); border-color: var(--intent); }
  .gline { margin: 0 0 2px; font-size: 10px; color: var(--ink-dim); overflow-wrap: anywhere; }
  .gline[data-stale] { opacity: .5; }
  .gnum { font-family: var(--mono); font-size: 11px; color: var(--tx-val); }
  .gcurve { display: block; width: 100%; height: 44px; margin: 2px 0 4px; background: var(--bg-sunken); border-radius: var(--radius); }
  .gcurve path { fill: none; stroke: var(--ink); stroke-width: 1.5; }
  .gcurve circle { fill: var(--reality); }
  .gparams { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 6px; }
  .gparams label { display: flex; flex-direction: column; font-size: 9px; color: var(--ink-dim); min-width: 0; }
  .gparams .wide { grid-column: 1 / -1; }
  .gparams .check { flex-direction: row; align-items: center; gap: 4px; }
  .gparams input:not([type='checkbox']) { min-height: 24px; min-width: 0; width: 100%; font-size: .75rem; }

  /* Offsets are from the padding box: the node's 1px border is subtracted so the center sits on SOCK_Y and the edge. */
  .gsock { --hit: 22px; position: absolute; top: calc(19px - var(--hit) / 2); width: var(--hit); height: var(--hit); padding: 0;
    background: none; border: 0; cursor: crosshair; touch-action: none; display: grid; place-items: center; }
  .gsock[data-side='in'] { left: calc(var(--hit) / -2 - 1px); }
  .gsock[data-side='out'] { right: calc(var(--hit) / -2 - 1px); }
  .gsock::before { content: ''; width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%;
    background: var(--bg-card); border: 2px solid var(--ink-dim); }
  .gsock[data-type='app']::before, .gsock[data-type='toy']::before { border-radius: 2px; border-color: var(--intent); }
  .gsock[data-type='sensor']::before { border-radius: 2px; transform: rotate(45deg); border-color: var(--intent); }
  .gsock[data-type='field']::before { border-color: var(--reality); }
  .gsock[data-armed]::before { background: var(--intent); }
  .gsock:hover::before, .gsock:focus-visible::before { background: var(--ink-hi); }
  .gsock:focus-visible { outline: 2px solid var(--intent); border-radius: 50%; }

  .gempty { position: absolute; inset: 40% 0 auto; margin: 0; text-align: center; font-size: .8rem; color: var(--ink-dim); pointer-events: none; }
  .gbox { position: absolute; border: 1px dashed var(--intent); background: rgba(var(--intent-rgb), .08); pointer-events: none; }
  .gcursor { position: absolute; z-index: 4; max-width: 240px; margin: 0; padding: 3px 6px; font-size: 11px; pointer-events: none;
    background: var(--bg-raised); border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--ink); }
  .gcursor[data-phase='fault'] { color: var(--warn); border-color: var(--warn); }

  @media (pointer: coarse) {
    .gsock { --hit: 40px; }
    .gtool .og-btn, .gparams input:not([type='checkbox']) { min-height: var(--tap); }
  }
  @media (prefers-reduced-motion: reduce) {
    .gwire[data-live] { animation: none; }
  }
</style>
