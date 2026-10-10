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
   * - F3 with focus in the editor is the node search, never the shell's
   *   look-for: it stops the key before the window sees it.
   * - A field or toy node says what it is and where it comes from: its card
   *   (its device after it once the graph holds two), desc, range, what each socket
   *   does, and its live state (RENDERING laws 3, 5, 8). Nodes of one card
   *   share its label and accent stripe.
   * - Op nodes (typed math and logic, docs/GRAPH.md) run in Phosphor only;
   *   their input rows are ROW_H tall, which the CSS --grow must match, so
   *   wire ends land on their sockets without measuring.
   */
  import { onMount, untrack, tick } from 'svelte';
  import { machine } from '../../model/machine.svelte.js';
  import { refKey, preview, snap, GRID, MAPS, OPS, SAFE, valueOf, TYPES } from '../../model/graph.js';
  import GraphPalette from './GraphPalette.svelte';

  let { rt } = $props();
  const R = untrack(() => rt);

  const NODE_W = 200;
  const MAP_W = 220;
  const OP_W = 180;
  const SOCK_Y = 20;   // socket centers sit on the header's midline
  const HEAD = 40;
  const K_MAX = 2;
  const CATS = ['Input', 'Math', 'Logic', 'Converter'];
  // Node head icons: a 16 px grid, stroked by .gicon.
  const ICON = {
    Input: '<path d="M2 8h12"/><circle cx="6" cy="8" r="2"/>',
    Math: '<path d="M12 3H4l4.5 5L4 13h8"/>',
    Logic: '<path d="M3.5 3h4a5 5 0 0 1 0 10h-4z"/><path d="M1 6h2.5M1 10h2.5M12.5 8H15"/>',
    Converter: '<path d="M2 12h4l4-8h4"/>',
    field: '<path d="M8 2.5L13.5 8 8 13.5 2.5 8z"/>',
    toy: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5"/>',
    map: '<path d="M2.5 13.5C7 13.5 9 2.5 13.5 2.5"/>',
  };
  /** Fit never zooms node text (11 px floor) below 9 px on screen. */
  const FIT_K = 9 / 11;
  /** Phosphor's own names (ops, maps) in sentence case; hub labels render as sent. */
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  /** Card stripes, in order of each card's first node; never a safety color (law 13). */
  const ACCENT = ['var(--reality)', 'var(--intent)', 'color-mix(in srgb, var(--reality) 50%, var(--intent))', 'var(--tx-hi)', 'var(--line-4)'];
  /** What a socket does, by its type: an input's verb, an output's. */
  const DOES = { in: { field: 'sets', toy: 'drives' }, out: { field: 'reads', app: 'from apps', sensor: 'reads' } };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(+v.toPrecision(4)) : null);
  /** "0 to 20 Hz", the unit alone, or '' when the source states neither. */
  function rangeOf(a) {
    const lo = num(a.lo), hi = num(a.hi);
    return [lo != null && hi != null ? lo + ' to ' + hi : '', a.unit].filter(Boolean).join(' ');
  }

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
    // The device follows the card once the graph draws from two (the hub and a toy, say).
    const many = new Set(g.nodes.map((n) => (n.ref.kind === 'bp' ? n.ref.device : ''))).size > 1;
    const cards = [];
    return new Map(g.nodes.map((n) => {
      const a = R.about(n.ref);
      const ports = R.ports(n.ref);
      const last = a.path[a.path.length - 1] || '';
      const cardKey = a.path.join('/');
      if (cardKey && !cards.includes(cardKey)) cards.push(cardKey);
      const does = [ports.in && 'in ' + DOES.in[ports.in], ports.out && 'out ' + DOES.out[ports.out]].filter(Boolean).join(', ');
      return [n.id, {
        label: R.label(n.ref), name: a.name, ports, unit: a.unit, desc: a.desc,
        card: many && a.path.length > 1 ? last + ' · ' + a.path[0] : last, path: a.path.join(' › '), cardKey,
        accent: cardKey ? ACCENT[cards.indexOf(cardKey) % ACCENT.length] : null,
        spec: [rangeOf(a), does].filter(Boolean).join(' · '),
        verb: { in: DOES.in[ports.in], out: DOES.out[ports.out] },
      }];
    }));
  });
  const rosterId = $derived.by(() => { void gen; return R.hub.roster ? R.hub.roster.id : null; });
  $effect(() => { void machine.catalog.etag; void machine.link.phase; untrack(() => R.refreshHub()); });
  $effect(() => { if (rosterId == null) return; void machine.samples[rosterId]; untrack(() => R.refreshHub()); });

  /** Every box on the canvas in reading order, which is also the Tab order. */
  const boxes = $derived([
    ...g.nodes.map((o) => ({ kind: 'node', id: o.id, o, w: NODE_W })),
    ...g.rels.map((o) => ({ kind: 'rel', id: o.id, o, w: MAP_W })),
    ...g.drafts.map((o) => ({ kind: 'draft', id: o.id, o, w: MAP_W })),
    ...g.ops.map((o) => ({ kind: 'op', id: o.id, o, w: OP_W })),
  ].sort((a, b) => a.o.y - b.o.y || a.o.x - b.o.x));
  const byId = $derived(new Map(boxes.map((b) => [b.id, b])));

  /** An op node has an option row: an operation, a Switch's type, a Map Range's clamp. */
  const hasOpt = (o) => !!OPS[o.kind].fns || o.kind === 'switch' || o.kind === 'map_range';
  /** The value type at an output, and at an input (port on an op). */
  function typeAt(id, side, port) {
    const b = byId.get(id);
    if (!b) return 'float';
    if (b.kind === 'op') return side === 'out' ? R.outOf(b.o) : (R.insOf(b.o).find((p) => p.name === port) || {}).type || 'float';
    if (b.kind === 'node') return info.get(id)?.ports.vt || 'float';
    return 'float';
  }

  const wires = $derived.by(() => {
    const out = [];
    for (const l of g.links) {
      const conv = typeAt(l.from, 'out') !== typeAt(l.to, 'in', l.port);
      out.push({ id: l.id, link: l, a: l.from, b: l.to, port: l.port, home: 'client', conv });
    }
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
  /** A typed value as text: a bool as true or false, a Gate's closed output as safe. */
  const fmtT = (v, t) => (v === SAFE ? 'safe' : typeof v !== 'number' ? '' : t === 'bool' ? (v ? 'true' : 'false') : t === 'int' ? String(Math.round(v)) : fmt(v));
  /** The value leaving an output: an op's this tick, a field's or toy's live value. */
  function liveAt(id) {
    void beat;
    const b = byId.get(id);
    if (!b) return undefined;
    return b.kind === 'op' ? R.val(id) : b.kind === 'node' ? R.value(b.o.ref) : undefined;
  }
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
    const k = clampK(Math.max(FIT_K, Math.min(1.5, (r.width - 2 * pad) / (x1 - x0), (r.height - 2 * pad) / (y1 - y0))));
    // An axis that fits is centered; one that does not starts at the graph's top-left, never its empty middle.
    const axis = (size, lo, hi) => ((hi - lo) * k <= size - 2 * pad ? (size - (hi - lo) * k) / 2 : pad) - lo * k;
    view = { k, x: axis(r.width, x0, x1), y: axis(r.height, y0, y1) };
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
  let pal = $state(null);       // {x, y, wx, wy, from?, find?}: the add menu; `from` is a link-drag-search's socket, `find` the F3 search
  let more = $state(false);     // the compact toolbar's overflow
  let full = $state(false);
  let vpW = $state(0);
  let vpH = $state(0);
  let lastPt = null;            // the pointer's last client position over the canvas, for Shift+A
  let gest = null;
  const touches = new Map();
  const ROW_H = coarse ? 40 : 28;

  const at = (b) => drag[b.id] || [b.o.x, b.o.y];
  /** A socket's center below its node's top: the header midline, or an op input's row. */
  function sockY(b, side, port) {
    if (b.kind !== 'op' || side === 'out' || port == null) return SOCK_Y;
    const i = R.insOf(b.o).findIndex((p) => p.name === port);
    return HEAD + (hasOpt(b.o) ? ROW_H : 0) + Math.max(0, i) * ROW_H + ROW_H / 2;
  }
  function sockXY(id, side, port) {
    const b = byId.get(id);
    if (!b) return null;
    const [x, y] = at(b);
    return [side === 'out' ? x + b.w : x, y + sockY(b, side, port)];
  }
  function curve([x1, y1], [x2, y2]) {
    // A link running backward exits right and re-enters left: its handles grow with the rise, clear of both nodes.
    const back = Math.min(1, Math.max(0, (x1 + 80 - x2) / 80));
    const c = Math.max(40, Math.abs(x2 - x1) / 2, back * Math.abs(y2 - y1) / 2);
    return 'M' + x1 + ' ' + y1 + ' C' + (x1 + c) + ' ' + y1 + ' ' + (x2 - c) + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }

  function down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = e.target;
    if (t.closest('.gpal, .gtool')) return;
    if (pal) pal = null;
    more = false;
    const sock = t.closest('[data-sock]');
    if (sock) {
      gest = { kind: 'wire', id: sock.dataset.owner, side: sock.dataset.side, port: sock.dataset.port, px: e.clientX, py: e.clientY, moved: false, pid: e.pointerId };
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
    lastPt = [e.clientX, e.clientY];
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
        over = { id: hit.dataset.owner, side: hit.dataset.side, port: hit.dataset.port };
        why = gest.side === 'out' ? R.why(gest.id, over.id, over.port) : R.why(over.id, gest.id, gest.port);
      }
      wiring = { id: gest.id, side: gest.side, port: gest.port, x, y, over, why };
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
        const why = w.side === 'out' ? R.wire(w.id, w.over.id, w.over.port) : R.wire(w.over.id, w.id, w.port);
        if (why) refuse(why, e.clientX, e.clientY);
        else said = 'connected';
      } else if (w && !document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-gid], .gtool')) {
        // Blender's link-drag-search: released over empty canvas.
        openPalette(e.clientX, e.clientY, { id: w.id, side: w.side, port: w.port, vt: typeAt(w.id, w.side, w.port) });
      }
    }
  }

  function menu(e) {
    if (e.target.closest('input, select, textarea, .gpal')) return;
    e.preventDefault();
    openPalette(e.clientX, e.clientY);
  }
  /** Open the add menu at a client point (the canvas' upper third when none); `from` filters it to that socket's partners. */
  function openPalette(cx, cy, from = null, find = false) {
    const r = vp.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 3; }
    const [wx, wy] = toWorld(cx, cy);
    pal = { x: cx - r.left, y: cy - r.top, wx, wy, from, find };
  }
  /** Open it at the pointer when the pointer is over the canvas, else in the canvas (Shift+A, F3). */
  function openAtPointer(find = false) {
    const r = vp.getBoundingClientRect();
    const inside = lastPt && lastPt[0] >= r.left && lastPt[0] <= r.right && lastPt[1] >= r.top && lastPt[1] <= r.bottom;
    if (inside) openPalette(lastPt[0], lastPt[1], null, find); else openPalette(null, null, null, find);
  }

  // ---- sockets: tap or Enter to wire ---------------------------------------------
  function sockName(id, side, port) {
    const b = byId.get(id);
    const name = !b ? id : b.kind === 'node' ? info.get(id)?.label : b.kind === 'op' ? cap(R.opLabel(b.o)) : b.o.name;
    const p = b && b.kind === 'op' && port ? (R.insOf(b.o).find((x) => x.name === port) || {}).label : '';
    return (side === 'out' ? 'output of ' : (p ? p + ' input of ' : 'input of ')) + name;
  }
  function sockClick(e, id, side, port) {
    if (kwire && kwire.side !== side && kwire.id !== id) {
      const why = side === 'in' ? R.wire(kwire.id, id, port) : R.wire(id, kwire.id, kwire.port);
      kwire = null;
      if (why) refuseAt(why, e.currentTarget);
      else said = 'connected';
      return;
    }
    kwire = kwire && kwire.id === id && kwire.side === side && kwire.port === port ? null : { id, side, port };
    said = kwire ? 'Wiring from the ' + sockName(id, side, port) + ', Escape cancels' : 'wiring cancelled';
  }
  function sockFocus(id, side, port) {
    if (!kwire || kwire.side === side) return;
    const why = side === 'in' ? R.why(kwire.id, id, port) : R.why(id, kwire.id, kwire.port);
    said = why || 'Enter connects the ' + sockName(kwire.id, kwire.side, kwire.port) + ' to the ' + sockName(id, side, port);
  }

  // ---- keyboard and toolbar --------------------------------------------------------
  function del(e) {
    const sock = e && e.target.closest && e.target.closest('[data-sock]');
    if (sock) { R.unwire(sock.dataset.owner, sock.dataset.side, sock.dataset.port); said = 'wire removed'; return; }
    if (selWire) {
      const w = wires.find((x) => x.id === selWire);
      selWire = null;
      if (w) { if (w.link) R.unwire(w.b, 'in', w.port); else R.unwire(w.map, w.side); said = 'wire removed'; }
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
    if (!made.length) { said = 'nothing to duplicate'; return; }
    sel = new Set(made);
    said = made.length + ' duplicated';
    focusBox(made[0]);
  }
  function cancel() {
    if (more) { more = false; return true; }
    if (pal) { pal = null; return true; }
    if (wiring || kwire) { wiring = null; kwire = null; gest = null; said = 'wiring cancelled'; return true; }
    if (box) { box = null; gest = null; return true; }
    if (sel.size || selWire) { sel = new Set(); selWire = null; return true; }
    if (full) { full = false; return true; }
    return false;
  }

  function key(e) {
    if (e.key === 'Escape') { if (cancel()) e.preventDefault(); return; }
    if (e.key === 'F3' && !e.target.closest('.gpal')) { e.preventDefault(); e.stopPropagation(); openAtPointer(true); return; }
    if (e.target.closest('input, select, textarea, .gpal')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) R.redo(); else R.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); R.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); dup(); return; }
    if (mod && k === 'a') { e.preventDefault(); sel = new Set(boxes.map((b) => b.id)); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(e); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openPalette(); return; }
    if (e.shiftKey && !mod && !e.altKey && k === 'a') { e.preventDefault(); openAtPointer(); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d && sel.size && e.target.closest('[data-gid]') && !e.target.closest('[data-sock]')) {
      e.preventDefault();
      const s = GRID * (e.shiftKey ? 5 : 1);
      R.moveMany([...sel].map((id) => byId.get(id)).filter(Boolean).map((b) => ({ id: b.id, x: b.o.x + d[0] * s, y: b.o.y + d[1] * s })));
    }
  }

  // ---- the add menu ------------------------------------------------------------------
  /** The ids of the nodes a menu item would place: its field or toy node, every op of its kind, every map of its curve. */
  function nodesOf(v) {
    if (v.ref) return g.nodes.filter((n) => refKey(n.ref) === refKey(v.ref)).map((n) => n.id);
    if (v.op) return g.ops.filter((o) => o.kind === v.op).map((o) => o.id);
    return [...g.rels, ...g.drafts].filter((m) => m.map === v.map).map((m) => m.id);
  }

  /** Items into nested groups by their paths, in first-seen order. */
  function nest(list) {
    const root = { groups: [] };
    for (const { path, item } of list) {
      let at = root;
      for (const name of path) {
        let next = at.groups.find((x) => x.name === name);
        if (!next) at.groups.push(next = { name, items: [], groups: [] });
        at = next;
      }
      at.items.push(item);
    }
    return root.groups;
  }

  /**
   * The menu's groups (Blender's Shift+A) as the pages draw them: the hub's
   * categories, sections and cards (open), plugin modules, ButtplugIO, then
   * the node families and the hub maps. A link-drag-search (`pal.from`) keeps
   * only what has a socket on the other side that the dragged one can join.
   */
  const groups = $derived.by(() => {
    void gen; void machine.catalog.etag;
    if (!pal) return [];
    const f = pal.from;
    const fb = f && byId.get(f.id);
    const fromKind = fb ? fb.kind : null;
    const fromMap = fromKind === 'rel' || fromKind === 'draft';
    const side = !f ? null : f.side === 'out' ? 'dst' : 'src';
    const item = (key, label, value) => ({ key, label, value, on: nodesOf(value).length });
    const sources = nest(R.palette().filter((s) => !side || s[side])
      .map((s) => ({ path: s.path, item: item(refKey(s.ref), s.label, { ref: s.ref, w: NODE_W }) })));
    const hub = sources.find((x) => x.name === R.hubName());
    if (hub) hub.open = true;
    const ops = CATS.map((cat) => ({
      name: cat,
      items: Object.entries(OPS).filter(([, o]) => o.cat === cat && !(f && f.side === 'out' && o.ins.every((q) => q.fixed)))
        .map(([kind, o]) => item('op:' + kind, cap(o.label), { op: kind, w: OP_W })),
    }));
    const maps = { name: 'Maps', items: Object.entries(MAPS).map(([id, m]) => item('map' + id, cap(m.label), { map: Number(id), w: MAP_W })) };
    const out = fromMap ? sources : [...sources, ...ops, ...(!f || fromKind === 'node' ? [maps] : [])];
    return out.filter((x) => x.items.length || x.groups?.length);
  });

  /** Show a menu item's node already on the canvas: the next one after the selection, centered and focused. */
  function reveal(v) {
    pal = null;
    const ids = nodesOf(v);
    if (!ids.length) { said = 'not on the canvas'; vp.focus({ preventScroll: true }); return; }
    const id = ids[(ids.indexOf([...sel][0]) + 1) % ids.length];
    const b = byId.get(id);
    const el = layer && layer.querySelector('[data-gid="' + CSS.escape(id) + '"]');
    view = { ...view, x: vpW / 2 - (b.o.x + b.w / 2) * view.k, y: vpH / 2 - (b.o.y + (el ? el.offsetHeight : HEAD) / 2) * view.k };
    saveView();
    sel = new Set([id]);
    selWire = null;
    said = 'shown on the canvas';
    el?.focus({ preventScroll: true });
  }

  /** Place what the menu picked; after a link-drag-search, wire it to the dragged socket (one undo step). */
  function pick(v) {
    const { wx, wy, from } = pal;
    // A field or toy appears once: picking one already placed shows it.
    if (v.ref && !from && nodesOf(v).length) { reveal(v); return; }
    pal = null;
    const x = from && from.side === 'in' ? wx - v.w : wx;
    let id;
    let why = '';
    R.batch(() => {
      if (v.op) {
        id = R.placeOp(v.op, x, wy);
        said = cap(OPS[v.op].label) + ' placed';
      } else if (v.map != null) {
        id = R.placeMap(v.map, x, wy);
        said = cap(MAPS[v.map].label) + ' placed';
      } else {
        const r = R.place(v.ref, x, wy);
        id = r.id;
        said = r.already ? 'already on the canvas: selected' : 'placed';
      }
      if (!from) return;
      if (from.side === 'out') {
        const op = v.op && R.graph.ops.find((o) => o.id === id);
        const ins = op ? R.insOf(op).filter((q) => !q.fixed) : [];
        const port = (ins.find((q) => q.type === from.vt) || ins[0] || {}).name;
        why = R.wire(from.id, id, port);
      } else {
        why = R.wire(id, from.id, from.port);
      }
      if (!why) said += ', connected';
    });
    if (why) refuseAt(why, null);
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
  function setOp(e, o, patch) {
    if (patch.vals && Object.values(patch.vals).some((v) => !Number.isFinite(v))) { refuseAt('refused: not a number', e.currentTarget); return; }
    const why = R.editOp(o.id, patch);
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

{#snippet socket(id, side, type, title, vt = 'float', port = undefined, sy = SOCK_Y)}
  <button type="button" class="gsock" data-sock data-owner={id} data-side={side} data-type={type} data-vt={vt} data-port={port}
          data-armed={kwire && kwire.id === id && kwire.side === side && kwire.port === port ? '' : null}
          style:--sy={sy + 'px'}
          aria-label={(side === 'in' ? 'Input' : 'Output') + ' socket, ' + title + ', ' + vt}
          title={(side === 'in' ? 'Input: ' : 'Output: ') + title + ' (' + vt + ')'}
          onclick={(e) => sockClick(e, id, side, port)} onfocus={() => sockFocus(id, side, port)}></button>
{/snippet}

{#snippet fieldNode(b)}
  {@const n = b.o}
  {@const nf = info.get(n.id) || { label: n.id, name: n.id, ports: {}, unit: '', verb: {} }}
  {@const bp = n.ref.kind === 'bp'}
  {@const drivers = g.rels.filter((r) => r.to === n.id)}
  {@const chain = g.links.some((l) => l.to === n.id)}
  {@const run = (void gen, R.runs(n.id))}
  {@const st = bp ? { stale: '', gate: '' } : (void beat, R.state(n.ref))}
  {@const stale = nf.ports.out ? st.stale : ''}
  {@const ec = (void beat, R.echo(n.ref))}
  <span class="ghead">
    <svg class="gicon" viewBox="0 0 16 16" aria-hidden="true">{@html ICON[bp ? 'toy' : 'field']}</svg>
    <span class="gtitle">
      {#if nf.card}<span class="gcard" title={nf.path}>{nf.card}</span>{/if}
      <span class="gname">{nf.name}</span>
    </span>
    {#if run}
      <span class="gbadge" data-home={run.home} data-runs title={run.why}>{run.home}</span>
    {:else}
      <span class="gbadge" data-home={bp ? 'client' : 'hub'}
            title={bp ? 'Buttplug device: edges run in Phosphor' : 'Catalog field on the hub'}>{bp ? 'client' : 'hub'}</span>
    {/if}
  </span>
  {#if nf.desc}<p class="gline gdesc" title={nf.desc}>{nf.desc}</p>{/if}
  {#if nf.spec}<p class="gline gspec">{nf.spec}</p>{/if}
  {#if nf.ports.out}
    {@const v = (void beat, R.value(n.ref))}
    <p class="gline" data-stale={stale ? '' : null} title={stale || null}>
      <span class="gnum">{fmt(v) || 'no value yet'}</span> {fmt(v) ? nf.unit : ''}{stale ? ' (' + stale + ')' : ''}
    </p>
  {/if}
  {#if nf.ports.in && (drivers.length || chain)}
    {@const d = drivers.find((r) => r.enabled) || drivers[0]}
    {@const cw = chain ? (void beat, R.chainWhy(n.id)) : ''}
    {#if chain || d.home === 'client'}<p class="gline">mapped <span class="gnum">{fmtT((void beat, R.out(chain ? n.id : d.id)), nf.ports.vt) || 'nothing yet'}</span></p>{/if}
    {#if cw}<p class="gline" data-phase="disarmed" role="status">{cw}</p>{/if}
    <p class="gline">reads <span class="gnum">{fmt(ec.value) || 'no value yet'}</span> {fmt(ec.value) ? nf.unit : ''}</p>
  {/if}
  {#if ec.status === 'fault'}<p class="gline" data-phase="fault" role="status">{ec.reason || 'no answer from the hub'}</p>
  {:else if ec.status === 'pending' || ec.status === 'overdue'}<p class="gline" data-phase="pending">{ec.status}: waiting for the hub</p>{/if}
  {#if st.gate}<p class="gline" data-phase="gated">gated: {st.gate}</p>{/if}
  {#if nf.ports.in}{@render socket(n.id, 'in', nf.ports.in, nf.verb.in + ' ' + nf.label, nf.ports.vt)}{/if}
  {#if nf.ports.out}{@render socket(n.id, 'out', nf.ports.out, nf.verb.out + ' ' + nf.label, nf.ports.vt)}{/if}
{/snippet}

{#snippet opNode(b)}
  {@const o = b.o}
  {@const spec = OPS[o.kind]}
  {@const ins = R.insOf(o)}
  {@const ot = R.outOf(o)}
  {@const v = liveAt(o.id)}
  <span class="ghead">
    <svg class="gicon" viewBox="0 0 16 16" aria-hidden="true">{@html ICON[spec.cat]}</svg>
    <span class="gname">{cap(R.opLabel(o))}</span>
    <span class="gnum gout" title="Output this tick">{fmtT(v, ot)}</span>
  </span>
  {#if hasOpt(o)}
    <div class="grow">
      {#if spec.fns}
        <select aria-label="Operation" value={o.fn} onchange={(e) => setOp(e, o, { fn: e.currentTarget.value })}>
          {#each Object.entries(spec.fns) as [k, f] (k)}<option value={k}>{f.label}</option>{/each}
        </select>
      {:else if o.kind === 'switch'}
        <select aria-label="Type" value={o.type} onchange={(e) => setOp(e, o, { type: e.currentTarget.value })}>
          {#each TYPES as t (t)}<option value={t}>{t}</option>{/each}
        </select>
      {:else}
        <label class="check"><input type="checkbox" checked={o.clamp !== false} onchange={(e) => setOp(e, o, { clamp: e.currentTarget.checked })} /> Clamp</label>
      {/if}
    </div>
  {/if}
  {#each ins as p, i (p.name)}
    {@const linked = g.links.some((l) => l.to === o.id && l.port === p.name)}
    <div class="grow" data-port={p.name}>
      {#if linked}
        <span class="glabel">{p.label}</span>
      {:else if p.type === 'bool'}
        <label class="check"><input type="checkbox" checked={valueOf(o, p) !== 0}
               onchange={(e) => setOp(e, o, { vals: { [p.name]: e.currentTarget.checked ? 1 : 0 } })} /> {p.label}</label>
      {:else}
        <label class="gfield"><span>{p.label}</span><input type="number" step={p.type === 'int' ? 1 : 'any'} value={valueOf(o, p)}
               onchange={(e) => setOp(e, o, { vals: { [p.name]: Number(e.currentTarget.value) } })} /></label>
      {/if}
    </div>
    {#if !p.fixed}{@render socket(o.id, 'in', 'op', p.label, p.type, p.name, HEAD + (hasOpt(o) ? ROW_H : 0) + i * ROW_H + ROW_H / 2)}{/if}
  {/each}
  {@render socket(o.id, 'out', 'op', cap(R.opLabel(o)), ot)}
{/snippet}

{#snippet mapNode(b)}
  {@const r = b.o}
  {@const isRel = b.kind === 'rel'}
  {@const why = isRel && refOf(r.from) && refOf(r.to) ? R.home(refOf(r.from), refOf(r.to)).why : 'draft: wire a source and a target'}
  <span class="ghead">
    <svg class="gicon" viewBox="0 0 16 16" aria-hidden="true">{@html ICON.map}</svg>
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
    <button type="button" class="og-btn" onclick={() => openPalette()} title="Add node (Shift+A), search (F3)">+ Add</button>
    <button type="button" class="og-btn" onclick={fit} title="Frame the nodes">Fit</button>
    <button type="button" class="og-btn gmore-btn" aria-expanded={more} onclick={() => { more = !more; }}>More</button>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="gmore" data-open={more ? '' : null} onclick={() => { more = false; }}>
      <button type="button" class="og-btn" onclick={() => R.undo()} disabled={(void gen, !R.canUndo)} title="Undo (Ctrl+Z)">Undo</button>
      <button type="button" class="og-btn" onclick={() => R.redo()} disabled={(void gen, !R.canRedo)} title="Redo (Ctrl+Shift+Z)">Redo</button>
      <button type="button" class="og-btn" onclick={dup} disabled={!sel.size} title="Duplicate selected maps (Ctrl+D)">Duplicate</button>
      <button type="button" class="og-btn" onclick={() => del()} disabled={!sel.size && !selWire} title="Delete selection (Delete)">Delete</button>
      <button type="button" class="og-btn" aria-pressed={boxMode} onclick={() => { boxMode = !boxMode; }} title="Drag to box-select (Shift+drag)">Box select</button>
      <button type="button" class="og-btn" onclick={reset}>Reset view</button>
      <button type="button" class="og-btn" onclick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
      <button type="button" class="og-btn" onclick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
      <button type="button" class="og-btn" aria-pressed={full} onclick={() => { full = !full; }} title="Fill the window (Escape exits)">Full size</button>
    </div>
  </div>
  <p class="gnote">
    Client edges: <span data-phase={note.ok ? 'armed' : 'disarmed'}>{note.why || 'not evaluated yet'}</span>
    {#if note.hub}Hub edges: {note.hub}.{/if}
  </p>

  <div class="gview" bind:this={vp} bind:clientWidth={vpW} bind:clientHeight={vpH} role="group" aria-label="Canvas" tabindex="-1"
       style:background-size={Array(2).fill((GRID * view.k < 10 ? GRID * 5 : GRID) * view.k + 'px').join(' ')}
       style:background-position={view.x + 'px ' + view.y + 'px'}
       data-mode={boxMode ? 'box' : 'pan'}
       onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} oncontextmenu={menu}>
    <div class="glayer" bind:this={layer} style:transform={'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'}
         style:--k={view.k}>
      <svg class="gwires" aria-hidden="true">
        {#each wires as w (w.id)}
          {@const p1 = sockXY(w.a, 'out')}
          {@const p2 = sockXY(w.b, 'in', w.port)}
          {#if p1 && p2}
            {@const d = curve(p1, p2)}
            {@const a = w.rel ? armed.get(w.rel.id) : w.link ? { on: (void gen, R.armed.ok) } : null}
            {@const v = w.rel ? (w.side === 'in' ? liveIn(w.rel) : liveOut(w.rel)) : w.link ? liveAt(w.a) : undefined}
            <path class="gwire" {d} data-home={w.home} data-wire={w.id} data-link={w.link ? '' : null}
                  data-off={a && a.on === false ? '' : null} data-live={a && a.on && typeof v === 'number' ? '' : null}
                  data-sel={selWire === w.id ? '' : null} />
            <path class="gwire-hit" {d} role="presentation"
                  onpointerdown={(e) => { e.stopPropagation(); selWire = w.id; sel = new Set(); vp.focus({ preventScroll: true }); }} />
            {#if w.conv}
              <circle class="gconv" data-conv={w.id} r="3.5" cx={(p1[0] + p2[0]) / 2} cy={(p1[1] + p2[1]) / 2}>
                <title>{typeAt(w.a, 'out') + ' to ' + typeAt(w.b, 'in', w.port)}</title>
              </circle>
            {/if}
            {#if typeof v === 'number' || v === SAFE}
              <text class="gval" x={(p1[0] + p2[0]) / 2} y={(p1[1] + p2[1]) / 2 - 6} text-anchor="middle">{w.link ? fmtT(v, typeAt(w.a, 'out')) : fmt(v)}</text>
            {/if}
          {/if}
        {/each}
        {#if pal && pal.from}
          {@const p = sockXY(pal.from.id, pal.from.side, pal.from.port)}
          {#if p}
            <path class="gwire" data-home="pending" d={pal.from.side === 'out' ? curve(p, [pal.wx, pal.wy]) : curve([pal.wx, pal.wy], p)} />
          {/if}
        {/if}
        {#if wiring}
          {@const p = sockXY(wiring.id, wiring.side, wiring.port)}
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
        {@const nf = b.kind === 'node' ? info.get(b.id) : null}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="gnode" data-gid={b.id} data-kind={b.kind} data-home={b.kind === 'rel' ? b.o.home : null}
             data-sel={sel.has(b.id) ? '' : null} data-off={a && a.on === false ? '' : null}
             data-shadow={st && st.phase === 'pending' ? 'pending' : null}
             data-card={nf?.cardKey || null} style:--acc={nf?.accent}
             style:left={x + 'px'} style:top={y + 'px'} style:width={b.w + 'px'}
             tabindex="0" role="group"
             aria-label={(nf ? nf.label + (nf.card ? ', ' + nf.card : '') : b.kind === 'op' ? cap(R.opLabel(b.o)) + ' node' : b.o.name + ' map') + (sel.has(b.id) ? ', selected' : '')}
             onfocus={(e) => { if (e.target === e.currentTarget && !sel.has(b.id)) { sel = new Set([b.id]); selWire = null; } }}>
          {#if b.kind === 'node'}{@render fieldNode(b)}{:else if b.kind === 'op'}{@render opNode(b)}{:else}{@render mapNode(b)}{/if}
        </div>
      {/each}
    </div>

    {#if !boxes.length}
      <p class="gempty">Right-click or Shift+A to add nodes</p>
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
      <GraphPalette {groups} x={pal.x} y={pal.y} vw={vpW} vh={vpH} flat={!!pal.from || pal.find} label={pal.find ? 'Find a node' : 'Add a node'}
                    onpick={pick} onfind={reveal} onclose={() => { pal = null; vp.focus(); }} />
    {/if}
  </div>
  <p class="gsr" role="status" aria-live="polite">{said}</p>
</div>

<style>
  /* Node rows below are px on purpose: JS places the sockets by fixed row heights. */
  .graph { position: relative; display: flex; flex-direction: column; gap: var(--sp-2); height: 100%; min-height: 0; }
  .graph.full { position: fixed; top: var(--strip-h, 0px); left: 0; right: 0; bottom: 0; z-index: 20; padding: var(--sp-3); background: var(--bg); }
  .gtool { position: relative; container-type: inline-size; display: flex; flex-wrap: wrap; gap: var(--sp-2); }
  .gtool .og-btn { width: auto; min-height: 30px; padding: var(--sp-1) var(--sp-3); }
  .gtool .og-btn[aria-pressed='true'] { border-color: var(--highlight); color: var(--ink-hi); }
  .gmore { display: contents; }
  .gmore-btn { display: none; }
  /* Under 44rem the toolbar holds one row: + Add, Fit, More. */
  @container (max-width: 44rem) {
    .gmore-btn { display: inline-flex; }
    .gmore { display: none; position: absolute; z-index: 6; top: calc(100% + var(--sp-2)); left: 0; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2);
      background: var(--bg-raised); border: 1px solid var(--line-3); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(var(--shade-rgb), .5); }
    .gmore[data-open] { display: flex; }
  }
  /* In a grid card (DashItem) the tools wait for Open, engaged or not: the canvas never jumps. */
  .graph:global([data-preview]) .gtool, .graph:global([data-preview]) .gnote { display: none; }
  .gnote { margin: 0; font-size: 11px; color: var(--ink-dim); }
  .gsr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); margin: 0; }

  .gview { position: relative; flex: 1 1 auto; min-height: 320px; overflow: hidden; touch-action: none; cursor: grab;
    background-color: var(--bg-sunken); border: 1px solid var(--line); border-radius: var(--radius);
    background-image: radial-gradient(circle, var(--line-3) 1px, transparent 1.5px); }
  .gview[data-mode='box'] { cursor: crosshair; }
  .glayer { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
  .gwires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }

  .gwire { fill: none; stroke: var(--line-4); stroke-width: 2; }
  .gwire[data-home='hub'] { stroke: var(--reality); }
  .gwire[data-home='client'] { stroke: var(--intent); stroke-dasharray: 6 4; }
  .gwire[data-home='draft'], .gwire[data-home='pending'] { stroke: var(--line-4); stroke-dasharray: 3 4; }
  .gwire[data-refused] { stroke: var(--warn); }
  .gwire[data-off] { opacity: .35; }
  .gwire[data-sel] { stroke: var(--highlight); stroke-width: 4; }
  .gwire[data-live] { animation: gflow .8s linear infinite; }
  .gwire[data-home='hub'][data-live] { stroke-dasharray: 14 4; }
  @keyframes gflow { to { stroke-dashoffset: -18; } }
  .gwire-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
  .gval { font-size: 11px; fill: var(--ink-hi); paint-order: stroke; stroke: var(--bg-sunken); stroke-width: 3px; font-family: var(--mono); }

  .gnode { position: absolute; box-sizing: border-box; padding: 0 var(--sp-3) var(--sp-3); touch-action: none; cursor: grab;
    background: var(--bg-card); color: var(--ink); border: 1px solid var(--line-3); border-radius: var(--radius); }
  .gnode[data-kind='rel'][data-home='hub'] { border-color: var(--reality); }
  .gnode[data-kind='rel'][data-home='client'] { border-color: var(--intent); }
  .gnode[data-kind='draft'] { border-style: dashed; }
  .gnode[data-sel] { box-shadow: 0 0 0 2px var(--highlight); }
  .gnode[data-off] { filter: saturate(.5) brightness(.85); }
  .ghead { display: flex; align-items: center; gap: var(--sp-3); height: 40px; }
  .gicon { flex: none; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; color: var(--ink-dim); }
  .gname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; color: var(--ink-hi); }
  /* A source node's head: its card above its name, inside the 40 px the sockets sit on. */
  .gtitle { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
  .gtitle .gname { flex: none; }
  .gcard { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ink-dim); }
  /* One card, one stripe: the node's top edge in its card's accent. */
  .gnode[data-card]::before { content: ''; position: absolute; inset: -1px -1px auto; height: 3px; background: var(--acc);
    border-radius: var(--radius) var(--radius) 0 0; pointer-events: none; }
  .gdesc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gbadge { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 1px var(--sp-2); border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--ink-dim); cursor: help; }
  .gbadge[data-home='hub'] { color: var(--reality); border-color: var(--reality); }
  .gbadge[data-home='client'] { color: var(--intent); border-color: var(--intent); }
  .gline { margin: 0 0 var(--sp-1); font-size: 11px; color: var(--ink-dim); overflow-wrap: anywhere; }
  .gline[data-stale] { opacity: .5; }
  /* After .gline: a ladder line wears its phase (law 5); refusals, faults, disarmed reasons amber (law 13). */
  [data-phase='disarmed'], [data-phase='fault'] { color: var(--warn); }
  [data-phase='pending'], [data-phase='overdue'] { color: var(--intent); }
  [data-phase='gated'] { font-style: italic; }
  .gnum { font-family: var(--mono); font-size: 11px; color: var(--tx-val); }
  .gcurve { display: block; width: 100%; height: 44px; margin: var(--sp-1) 0 var(--sp-2); background: var(--bg-sunken); border-radius: var(--radius); }
  .gcurve path { fill: none; stroke: var(--ink); stroke-width: 1.5; }
  .gcurve circle { fill: var(--reality); }
  .gparams { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-1) var(--sp-3); }
  .gparams label { display: flex; flex-direction: column; font-size: 11px; color: var(--ink-dim); min-width: 0; }
  .gparams .wide { grid-column: 1 / -1; }
  .gparams .check { flex-direction: row; align-items: center; gap: var(--sp-2); }
  .gparams input:not([type='checkbox']) { min-height: 24px; min-width: 0; width: 100%; font-size: .75rem; }
  /* A live field reads as a value, never as a disabled placeholder. */
  .grow input, .gparams input { color: var(--tx-val); }

  /* Op input rows: ROW_H in the script must equal --grow. */
  .graph { --grow: 28px; --vt-float: var(--reality); --vt-bool: var(--intent);
    --vt-int: color-mix(in srgb, var(--reality) 50%, var(--intent)); }
  .grow { display: flex; align-items: center; gap: var(--sp-3); height: var(--grow); font-size: 11px; color: var(--ink-dim); }
  .grow select { flex: 1 1 auto; min-width: 0; min-height: 22px; font-size: .75rem; }
  .grow .check { display: flex; align-items: center; gap: var(--sp-2); }
  .gfield { display: flex; align-items: center; gap: var(--sp-3); width: 100%; min-width: 0; }
  .gfield span { flex: 0 0 auto; }
  .gfield input { flex: 1 1 auto; min-width: 0; width: 100%; min-height: 22px; font-size: .75rem; }
  .glabel { padding-left: var(--sp-1); }
  .gout { margin-left: auto; }
  .gnode[data-kind='op'] { border-color: color-mix(in srgb, var(--intent) 60%, var(--line-3)); }

  /* Offsets are from the padding box: the node's 1px border is subtracted so the center sits on --sy and the edge. */
  .gsock { --hit: 22px; position: absolute; top: calc(var(--sy, 20px) - 1px - var(--hit) / 2); width: var(--hit); height: var(--hit); padding: 0;
    background: none; border: 0; cursor: crosshair; touch-action: none; display: grid; place-items: center; }
  .gsock[data-side='in'] { left: calc(var(--hit) / -2 - 1px); }
  .gsock[data-side='out'] { right: calc(var(--hit) / -2 - 1px); }
  .gsock::before { content: ''; width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%;
    background: var(--bg-card); border: 2px solid var(--vt-float); }
  .gsock[data-vt='int']::before { border-color: var(--vt-int); }
  .gsock[data-vt='bool']::before { border-color: var(--vt-bool); }
  .gsock[data-type='app']::before, .gsock[data-type='toy']::before { border-radius: 2px; }
  .gsock[data-type='sensor']::before { border-radius: 2px; transform: rotate(45deg); }
  .gsock[data-armed]::before { background: var(--intent); }
  .gconv { fill: var(--bg-sunken); stroke: var(--ink-hi); stroke-width: 1.5; }
  .gsock:hover::before, .gsock:focus-visible::before { background: var(--ink-hi); }
  .gsock:focus-visible { border-radius: 50%; }

  .gempty { position: absolute; inset: 40% 0 auto; max-width: none; margin: 0; text-align: center; font-size: .8rem; color: var(--ink-dim); pointer-events: none; }
  .gbox { position: absolute; border: 1px dashed var(--highlight); background: rgba(var(--highlight-rgb), .08); pointer-events: none; }
  .gcursor { position: absolute; z-index: 4; max-width: 240px; margin: 0; padding: var(--sp-1) var(--sp-2); font-size: 11px; pointer-events: none;
    background: var(--bg-raised); border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--ink); }
  .gcursor[data-phase='fault'] { color: var(--warn); border-color: var(--warn); }

  @media (pointer: coarse) {
    .graph { --grow: 40px; }
    .grow select, .gfield input { min-height: 36px; }
    .gsock { --hit: 40px; }
    .gtool .og-btn, .gparams input:not([type='checkbox']) { min-height: var(--tap); }
  }
  :global(html.still) .gwire[data-live] { animation: none; }
</style>
