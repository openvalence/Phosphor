<script>
  /**
   * GraphEditor.svelte: the node graph as a module (DESIGN 10.2, 10.8). Source
   * and target nodes, one map node per edge, each edge labeled with where it
   * runs and why. Mounted by src/plugins/graph.js into a plugin-hero slot.
   *
   * Constraints:
   * - Renders src/plugins/graph.js's runtime and nothing else: no edit lands
   *   here first. Hub edges show the store's answer (pending, confirmed,
   *   fault in words); client edges apply at once.
   * - Every action has a keyboard path: the add form, a focused node moves
   *   with the arrow keys, a map node opens its parameters with Enter.
   * - Red is for hub safety only (law 13): refusals and faults are amber.
   */
  import { onMount, untrack } from 'svelte';
  import { machine } from '../../model/machine.svelte.js';
  import { refKey } from '../../model/graph.js';

  let { rt } = $props();
  const R = untrack(() => rt);

  let gen = $state(0);
  onMount(() => R.onChange(() => gen++));

  // ponytail: a JSON snapshot per change; the graph is tens of nodes.
  const g = $derived.by(() => { void gen; return JSON.parse(JSON.stringify(R.graph)); });
  const sources = $derived.by(() => { void gen; void machine.catalog.etag; return R.sources(); });
  const targets = $derived.by(() => { void gen; void machine.catalog.etag; return R.targets(); });
  const nodeBy = $derived(new Map(g.nodes.map((n) => [n.id, n])));
  const rosterId = $derived.by(() => { void gen; return R.hub.roster ? R.hub.roster.id : null; });

  $effect(() => { void machine.catalog.etag; void machine.link.phase; untrack(() => R.refreshHub()); });
  $effect(() => { if (rosterId == null) return; void machine.samples[rosterId]; untrack(() => R.refreshHub()); });

  // ---- add -------------------------------------------------------------------
  let srcI = $state(-1);
  let mapId = $state(R.MAP.linear_clamp);
  let dstI = $state(-1);
  let addMsg = $state('');
  const pick = $derived(srcI >= 0 && dstI >= 0 && sources[srcI] && targets[dstI] ? R.home(sources[srcI].ref, targets[dstI].ref) : null);
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  function add() {
    const a = sources[srcI];
    const b = targets[dstI];
    if (!a || !b) { addMsg = 'pick a source and a target'; return; }
    const bounds = { in_min: num(a.lo, 0), in_max: num(a.hi, 1), out_min: num(b.lo, 0), out_max: num(b.hi, 1) };
    if (bounds.in_min === bounds.in_max) bounds.in_max = bounds.in_min + 1;
    addMsg = R.add(a.ref, b.ref, Number(mapId), bounds, { x: 0, y: 90 * g.rels.length });
  }

  // ---- move ------------------------------------------------------------------
  const OX = 260;
  const OY = 40;
  let drag = $state(null);

  function down(e, id, x, y) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { id, x, y, px: e.clientX, py: e.clientY, moved: false };
  }
  function moveDrag(e) {
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag = { ...drag, nx: drag.x + dx, ny: drag.y + dy };
  }
  let dragged = false;   // the click that ends a drag does not toggle a map node
  function up() {
    dragged = !!(drag && drag.moved);
    if (dragged) R.move(drag.id, drag.nx, drag.ny);
    drag = null;
  }
  function key(e, id, x, y) {
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    R.move(id, x + d[0], y + d[1]);
  }
  const at = (o) => (drag && drag.id === o.id && drag.moved ? [drag.nx, drag.ny] : [o.x, o.y]);

  // ---- edit ------------------------------------------------------------------
  let open = $state(null);
  let editMsg = $state('');
  const parse = (s) => s.split(/[\s,]+/).filter(Boolean).map(Number);
  function set(id, patch) { editMsg = R.edit(id, patch); }

  function status(r) {
    if (r.home === 'client') return { phase: R.armed.ok ? 'armed' : 'disarmed', text: R.armed.why };
    const s = R.hubState(r);
    if (s.phase !== 'confirmed') return { phase: s.phase, text: s.reason };
    return { phase: 'confirmed', text: R.hubArmed(r).why };
  }
</script>

<div class="graph">
  <form class="graph-add" onsubmit={(e) => { e.preventDefault(); add(); }}>
    <label>Source
      <select bind:value={srcI}>
        <option value={-1}>pick one</option>
        {#each sources as s, i (refKey(s.ref))}<option value={i}>{s.label}</option>{/each}
      </select>
    </label>
    <label>Map
      <select bind:value={mapId}>
        {#each Object.entries(R.maps) as [id, m] (id)}<option value={Number(id)}>{m.label}</option>{/each}
      </select>
    </label>
    <label>Target
      <select bind:value={dstI}>
        <option value={-1}>pick one</option>
        {#each targets as t, i (refKey(t.ref))}<option value={i}>{t.label}</option>{/each}
      </select>
    </label>
    <button type="submit" class="og-btn" disabled={!pick || !pick.home}>Add edge</button>
  </form>
  <p class="graph-note" class:warn={!!addMsg || (pick && !pick.home)} role="status">
    {addMsg || (pick ? pick.why : 'Hub edges run on the hub with no client open; buttplug edges run here.')}
  </p>
  {#if R.hub.reason}<p class="graph-note">Hub edges: {R.hub.reason}</p>{/if}

  <div class="graph-canvas" role="group" aria-label="Node graph" onpointermove={moveDrag} onpointerup={up} onpointercancel={up}>
    <svg class="graph-wires" aria-hidden="true">
      {#each g.rels as r (r.id)}
        {@const a = nodeBy.get(r.from)}
        {@const b = nodeBy.get(r.to)}
        {#if a && b}
          {@const [ax, ay] = at(a)}
          {@const [bx, by] = at(b)}
          {@const [mx, my] = at(r)}
          <path class="wire" data-home={r.home}
                d={'M' + (OX + ax + 80) + ' ' + (OY + ay + 20) + ' L' + (OX + mx) + ' ' + (OY + my + 30) + ' L' + (OX + bx - 80) + ' ' + (OY + by + 20)} />
        {/if}
      {/each}
    </svg>

    {#each g.nodes as n (n.id)}
      {@const [x, y] = at(n)}
      <button type="button" class="node" style:left={OX + x - 80 + 'px'} style:top={OY + y + 'px'}
              title="Drag, or focus and use the arrow keys, to move"
              onpointerdown={(e) => down(e, n.id, n.x, n.y)} onkeydown={(e) => key(e, n.id, n.x, n.y)}>
        <span class="node-kind">{n.ref.kind === 'bp' ? 'buttplug' : 'field'}</span>
        <span class="node-label">{R.label(n.ref)}</span>
      </button>
    {/each}

    {#each g.rels as r (r.id)}
      {@const [x, y] = at(r)}
      {@const st = status(r)}
      <div class="map" style:left={OX + x - 110 + 'px'} style:top={OY + y + 'px'} data-home={r.home}
           data-shadow={st.phase === 'pending' ? 'pending' : null}>
        <button type="button" class="map-head" aria-expanded={open === r.id}
                onpointerdown={(e) => down(e, r.id, r.x, r.y)}
                onkeydown={(e) => key(e, r.id, r.x, r.y)}
                onclick={() => { if (dragged) { dragged = false; return; } open = open === r.id ? null : r.id; editMsg = ''; }}>
          <span class="map-name">{r.name}</span>
          <span class="map-home">{r.home === 'hub' ? 'runs on the hub' : 'runs in Phosphor'}{r.enabled ? '' : ', disabled'}</span>
        </button>
        <p class="map-why">{R.home(nodeBy.get(r.from)?.ref ?? { kind: 'field' }, nodeBy.get(r.to)?.ref ?? { kind: 'field' }).why}</p>
        <p class="map-state" data-phase={st.phase} role="status">{st.text}</p>
        {#if open === r.id}
          <div class="map-edit">
            <label>Name <input value={r.name} onchange={(e) => set(r.id, { name: e.currentTarget.value })} /></label>
            {#if R.maps[r.map].params}
              {#each [['in_min', 'In min'], ['in_max', 'In max'], ['out_min', 'Out min'], ['out_max', 'Out max']] as [k, label] (k)}
                <label>{label} <input type="number" step="any" value={r[k]} onchange={(e) => set(r.id, { [k]: Number(e.currentTarget.value) })} /></label>
              {/each}
              {#each R.maps[r.map].params as label, i (label)}
                <label>{label} <input type="number" step="any" value={r.params[i] ?? ''}
                       onchange={(e) => { const p = [...r.params]; p[i] = Number(e.currentTarget.value); set(r.id, { params: p }); }} /></label>
              {/each}
            {:else}
              <label class="wide">Points (in out, in out, ...)
                <input value={r.params.join(' ')} onchange={(e) => set(r.id, { params: parse(e.currentTarget.value) })} /></label>
            {/if}
            <label class="check"><input type="checkbox" checked={r.enabled} onchange={(e) => set(r.id, { enabled: e.currentTarget.checked })} /> Enabled</label>
            <button type="button" class="og-btn" onclick={() => { R.remove(r.id); open = null; }}>Delete edge</button>
            {#if editMsg}<p class="map-state" data-phase="fault" role="status">{editMsg}</p>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .graph { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
  .graph-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
  .graph-add label, .map-edit label { display: flex; flex-direction: column; gap: 2px; font-size: .75rem; color: var(--ink-dim); }
  .graph-add select, .map-edit input:not([type='checkbox']) { min-height: var(--tap); max-width: 16em; }
  .graph-add .og-btn, .map-edit .og-btn { min-height: var(--tap); }
  .graph-note { margin: 0; font-size: 11px; color: var(--ink-dim); }
  .warn { color: var(--warn); }
  .graph-canvas { position: relative; flex: 1 1 auto; min-height: 240px; overflow: auto; background: var(--bg-sunken); border: 1px solid var(--line); border-radius: var(--radius); }
  .graph-wires { position: absolute; left: 0; top: 0; width: 2400px; height: 1600px; pointer-events: none; }
  .wire { fill: none; stroke: var(--line-4); stroke-width: 2; }
  .wire[data-home='hub'] { stroke: var(--reality); }
  .wire[data-home='client'] { stroke: var(--intent); stroke-dasharray: 6 4; }
  .node, .map { position: absolute; touch-action: none; }
  .node { width: 160px; min-height: var(--tap); display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    padding: 4px 8px; background: var(--bg-card); color: var(--ink); border: 1px solid var(--line-3); border-radius: var(--radius); text-align: left; cursor: grab; }
  .node-kind, .map-home { font-size: 10px; color: var(--ink-dim); text-transform: lowercase; }
  .node-label { font-size: .8rem; overflow: hidden; text-overflow: ellipsis; max-width: 100%; white-space: nowrap; }
  .map { width: 220px; padding: 4px 6px; background: var(--bg-card); border: 1px solid var(--line-3); border-radius: var(--radius); }
  .map[data-home='hub'] { border-color: var(--reality); }
  .map[data-home='client'] { border-color: var(--intent); }
  .map-head { width: 100%; min-height: var(--tap); display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    background: none; border: 0; color: var(--ink); padding: 0; text-align: left; cursor: grab; }
  .map-name { font-weight: 500; }
  .map-why, .map-state { margin: 0; font-size: 10px; color: var(--ink-dim); }
  .map-state[data-phase='fault'], .map-state[data-phase='disarmed'] { color: var(--warn); }
  .map-edit { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .map-edit .wide { flex: 1 1 100%; }
  .map-edit .check { flex-direction: row; align-items: center; min-height: var(--tap); }
</style>
