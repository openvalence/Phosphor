<script>
  /**
   * ChannelMap.svelte -- the 16-bit channel id space as a 256 x 256 grid (row =
   * high byte, column = low byte), and its device-defined zoom on the RFC-047
   * 0xCDSS grid (rows: class nibble then domain nibble; columns: slot byte).
   *
   * Constraints:
   * - Ranges, the grid's class nibbles and the experimental span come from the
   *   generated registry tables, never typed here (tools/registry-tables.mjs).
   * - Colors are tokens: ranges on the neutral ramp, channels by class in the
   *   two accents (blue what the hub reports, violet what clients command).
   *   Highlight marks the selection only; amber and red never appear.
   * - One focus stop: a listbox whose active option moves with the arrows.
   * - The box, the readout and the legend never change size with the view or
   *   the pointer: nothing below them moves.
   */
  import { CHANNEL_RANGES, GRID_CLASS_NIBBLE, EXPERIMENTAL_RANGE } from '../model/registry-tables.js';

  let { entries = [], grants = {}, selected = null, onselect = null } = $props();

  let view = $state('space');
  let hover = $state(null);   // {id, e}: the cell under the pointer, snapped to a channel near it
  let active = $state(null);  // the keyboard's channel id
  let box = $state(null);

  const rows = $derived(view === 'space' ? 256 : 128);
  const sorted = $derived([...entries].sort((a, b) => a.id - b.id));
  const shown = $derived(sorted.filter((e) => e.id < rows * 256));
  const hex = (n, w = 4) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
  const fmt = (n) => n.toLocaleString('en-US');
  const rangeOf = (id) => CHANNEL_RANGES.find((r) => id >= r.lo && id <= r.hi);

  // A span of ids as up to three row-aligned rects in grid units.
  function spanRects(lo, hi) {
    hi = Math.min(hi, rows * 256 - 1);
    if (lo > hi) return [];
    const [r0, c0, r1, c1] = [lo >> 8, lo & 255, hi >> 8, hi & 255];
    if (r0 === r1) return [[c0, r0, c1 - c0 + 1, 1]];
    const out = [];
    let top = r0, bot = r1;
    if (c0 > 0) { out.push([c0, r0, 256 - c0, 1]); top++; }
    if (c1 < 255) { out.push([0, r1, c1 + 1, 1]); bot--; }
    if (bot >= top) out.push([0, top, 256, bot - top + 1]);
    return out;
  }
  const bands = $derived([...CHANNEL_RANGES.map((r) => ({ name: r.name, rects: spanRects(r.lo, r.hi) })),
    { name: 'experimental', rects: spanRects(EXPERIMENTAL_RANGE.lo, EXPERIMENTAL_RANGE.hi) }]);

  const occupancy = $derived(CHANNEL_RANGES.map((r) => ({ ...r, n: entries.filter((e) => e.id >= r.lo && e.id <= r.hi).length })));
  const classCounts = $derived(Object.entries(entries.reduce((m, e) => ((m[e.clsName] = (m[e.clsName] || 0) + 1), m), {})));

  // Left gutter: hex rows in the space, class nibble bands in the grid.
  const rowLabels = $derived(view === 'space'
    ? [0, 0x40, 0x80, 0xc0].map((r) => ({ at: r / 256, text: hex(r << 8).slice(2) }))
    : Array.from({ length: 8 }, (_, c) => ({ at: c / 8, text: c + ' ' + (GRID_CLASS_NIBBLE[c] || '') })));
  const colLabels = [0, 0x40, 0x80, 0xc0].map((c) => ({ at: c / 256, text: c.toString(16).toUpperCase().padStart(2, '0') }));

  function pick(ev) {
    const r = box.getBoundingClientRect();
    const cw = r.width / 256, rh = r.height / rows;
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const col = Math.floor(x / cw), row = Math.floor(y / rh);
    if (col < 0 || col > 255 || row < 0 || row >= rows) return null;
    // A cell is a pixel or two wide: snap to the nearest channel within a fingertip.
    const reach = matchMedia('(pointer: coarse)').matches ? 22 : 8;
    let best = null, bestD = reach * reach;
    for (const e of shown) {
      const dx = ((e.id & 255) + 0.5) * cw - x, dy = ((e.id >> 8) + 0.5) * rh - y, d = dx * dx + dy * dy;
      if (d <= bestD) { best = e; bestD = d; }
    }
    return best ? { id: best.id, e: best } : { id: row * 256 + col, e: null };
  }
  function choose(id) { active = id; onselect?.(id); }
  function onkey(ev) {
    const ids = shown.map((e) => e.id);
    if (!ids.length) return;
    const i = ids.indexOf(active ?? selected);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: ids.length - 1 }[ev.key];
    if (to != null) { ev.preventDefault(); active = ids[Math.max(0, Math.min(ids.length - 1, i < 0 && ev.key.startsWith('Arrow') ? 0 : to))]; hover = null; }
    else if ((ev.key === 'Enter' || ev.key === ' ') && active != null) { ev.preventDefault(); choose(active); }
  }
  $effect(() => { if (active != null && active >= rows * 256) active = null; });

  const shownId = $derived(hover?.id ?? active ?? selected);
  const shownEntry = $derived(shownId == null ? null : entries.find((e) => e.id === shownId) || null);
  // One description for the readout and a cell's accessible name.
  function describe(e) {
    const g = grants[e.id];
    return [hex(e.id), e.name, e.clsName, e.maxRateHz ? e.maxRateHz + ' Hz' : 'on-change',
      g ? 'subscribed' + (g.rate != null ? ', ' + g.rate + ' Hz' : '') : 'not subscribed'];
  }
  const readout = $derived(shownId == null ? null
    : shownEntry ? describe(shownEntry) : [hex(shownId), rangeOf(shownId)?.name || '--', 'free']);
  const markOf = (id) => [id & 255, id >> 8];
  const PROMPT = 'Hover or arrow to a channel';
</script>

<div class="cmap-wrap">
<div class="cmap-in">
  <div class="cmap-views" role="group" aria-label="Map view">
    <button type="button" class="og-btn sm" class:on={view === 'space'} aria-pressed={view === 'space'} onclick={() => (view = 'space')}>All ids</button>
    <button type="button" class="og-btn sm" class:on={view === 'grid'} aria-pressed={view === 'grid'} onclick={() => (view = 'grid')}>Device grid</button>
    <span class="cmap-cap">{view === 'space' ? 'row high byte · column low byte' : '0xCDSS · class, domain, slot'}</span>
  </div>

  <div class="cmap-main">
    <div class="cmap-frame">
      <div class="cmap-top" aria-hidden="true">
        {#each colLabels as l (l.text)}<span style:left={l.at * 100 + '%'}>{l.text}</span>{/each}
      </div>
      <div class="cmap-side" aria-hidden="true">
        {#each rowLabels as l (l.text)}<span style:top={l.at * 100 + '%'}>{l.text}</span>{/each}
      </div>
      <div class="cmap" bind:this={box} role="listbox" tabindex="0" aria-label="Channel map"
           aria-activedescendant={active != null && active < rows * 256 ? 'cm-' + active : undefined}
           onkeydown={onkey} onpointermove={(ev) => (hover = pick(ev))} onpointerleave={() => (hover = null)}
           onclick={(ev) => { const h = pick(ev); if (h?.e) choose(h.id); }}>
        <svg viewBox="0 0 256 {rows}" preserveAspectRatio="none" role="none">
          {#each bands as b (b.name)}
            {#each b.rects as [x, y, w, h], i (i)}<rect class="band" data-range={b.name} {x} {y} width={w} height={h} />{/each}
          {/each}
          {#if view === 'grid'}
            {#each Array.from({ length: 7 }, (_, c) => (c + 1) * 16) as y (y)}<line class="rule" x1="0" x2="256" y1={y} y2={y} />{/each}
            {#each Array.from({ length: 15 }, (_, f) => (f + 1) * 16) as x (x)}<line class="rule faint" x1={x} x2={x} y1="0" y2={rows} />{/each}
          {/if}
          {#each shown as e (e.id)}
            {@const [x, y] = markOf(e.id)}
            <rect class="ch" id={'cm-' + e.id} role="option" aria-selected={selected === e.id}
                  aria-label={describe(e).join(', ')} data-cls={e.clsName} data-id={e.id} {x} {y} width="1" height="1" />
          {/each}
          {#if shownId != null && shownId < rows * 256 && shownId !== selected}
            {@const [x, y] = markOf(shownId)}<rect class="ring" x={x - 1} y={y - 1} width="3" height="3" />
          {/if}
          {#if selected != null && selected < rows * 256}
            {@const [x, y] = markOf(selected)}<rect class="ring sel" x={x - 1} y={y - 1} width="3" height="3" />
          {/if}
        </svg>
      </div>
    </div>

    <p class="cmap-read mono" data-empty={!readout} title={readout ? readout.join(' · ') : PROMPT}>
      {#if readout}{#each readout as part, i (i)}<span>{part}</span>{/each}{:else}{PROMPT}{/if}
    </p>
  </div>

  <div class="cmap-legend">
    <table class="occ">
      <thead><tr><th>range</th><th class="ids">ids</th><th class="num">used</th></tr></thead>
      <tbody>
        {#each occupancy as r (r.name)}
          <tr data-row={r.name}>
            <td><i class="sw" data-range={r.name}></i>{r.name}</td>
            <td class="ids mono">{hex(r.lo)}{r.hi > r.lo ? '–' + hex(r.hi) : ''}</td>
            <td class="mono num">{fmt(r.n)} / {fmt(r.hi - r.lo + 1)}</td>
          </tr>
        {/each}
        <tr class="all"><td>all</td><td class="ids mono">{hex(0)}–{hex(0xffff)}</td><td class="mono num">{fmt(entries.length)} / {fmt(0x10000)}</td></tr>
      </tbody>
    </table>
    <ul class="cls">
      {#each classCounts as [c, n] (c)}<li><i class="sw" data-cls={c}></i>{c} <b class="mono">{n}</b></li>{/each}
      <li><i class="sw" data-range="experimental"></i>experimental</li>
    </ul>
  </div>
</div>
</div>

<style>
  .cmap-wrap { min-width: 0; container-type: inline-size; }
  .cmap-in { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3) var(--sp-5); align-items: start; min-width: 0; }
  .cmap-main { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; max-width: 30rem; }
  /* Wide and alone (a stacked page): the legend sits beside a map that stops growing. */
  @container (min-width: 40rem) {
    .cmap-in { grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); }
    .cmap-views { grid-column: 1 / -1; }
  }
  .cmap-views { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-3); }
  .cmap-cap { margin-left: auto; font-size: .72rem; color: var(--tx-mut); }

  .cmap-frame {
    display: grid;
    grid-template-columns: 9ch minmax(0, 1fr);
    grid-template-rows: 1.2rem auto;
    font-family: var(--mono);
    font-size: .62rem;
    color: var(--tx-mut);
  }
  .cmap-top { grid-column: 2; position: relative; }
  .cmap-side { grid-row: 2; position: relative; }
  .cmap-top span, .cmap-side span { position: absolute; white-space: nowrap; }
  .cmap-side span { left: 0; transform: translateY(-.1em); }

  .cmap { grid-column: 2; grid-row: 2; aspect-ratio: 1; cursor: crosshair; touch-action: manipulation; border: 1px solid var(--line-1); }
  .cmap:focus-visible { outline-offset: 1px; }
  svg { display: block; width: 100%; height: 100%; }

  .band { fill: var(--line-1); }
  [data-range='SESSION'] { fill: var(--tx-mut); background: var(--tx-mut); }
  [data-range='spec-core'] { fill: var(--line-4); background: var(--line-4); }
  [data-range='device-defined'] { fill: var(--line-2); background: var(--line-2); }
  [data-range='experimental'] { fill: var(--line-1); background: var(--line-1); }
  [data-range='user'] { fill: var(--line-3); background: var(--line-3); }
  [data-range='reserved'] { fill: var(--line-0); background: var(--line-0); }
  .rule { stroke: var(--bg-sunken); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
  .rule.faint { stroke-width: 1px; opacity: .6; }

  /* Blue: what the hub reports. Violet: what clients command. */
  [data-cls='STATE'] { --c: var(--reality); }
  [data-cls='EVENT'] { --c: color-mix(in srgb, var(--reality) 50%, var(--tx-hi)); }
  [data-cls='INTENT'] { --c: var(--intent); }
  [data-cls='STREAM'] { --c: color-mix(in srgb, var(--intent) 50%, var(--tx-hi)); }
  [data-cls='STORE'] { --c: var(--tx-val); }
  .ch { fill: var(--c); stroke: var(--c); stroke-width: 2px; vector-effect: non-scaling-stroke; }
  .ring { fill: none; stroke: var(--ink-hi); stroke-width: 1.5px; vector-effect: non-scaling-stroke; pointer-events: none; }
  .ring.sel { stroke: var(--highlight); stroke-width: 2px; }

  /* One line, always: a long name ellipsizes, the empty prompt holds the line. */
  .cmap-read {
    display: flex; gap: var(--sp-3); margin: 0; max-width: none;
    height: 1.45em; overflow: hidden; white-space: nowrap;
    font-size: .74rem; line-height: 1.45; color: var(--ink);
  }
  .cmap-read span:nth-child(2) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .cmap-read[data-empty='true'] { font-family: var(--font); color: var(--ink-dim); }

  .cmap-legend { display: flex; flex-wrap: wrap; gap: var(--sp-3) var(--sp-5); align-items: flex-start; font-size: .74rem; }
  .occ { border-collapse: collapse; }
  .occ th { text-align: left; font-weight: 500; font-size: .66rem; text-transform: uppercase; letter-spacing: .06em; color: var(--tx-mut); padding: 0 var(--sp-3) var(--sp-1) 0; }
  .occ td { padding: var(--sp-1) var(--sp-3) var(--sp-1) 0; }
  .occ .num { text-align: right; padding-right: 0; }
  @container (max-width: 20rem) { .occ .ids { display: none; } }
  .occ tr.all td { border-top: 1px solid var(--line-1); color: var(--ink-hi); }
  .cls { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-1); }
  .cls li { display: flex; align-items: center; gap: var(--sp-2); white-space: nowrap; }
  .cls b { font-weight: var(--num-wght); color: var(--tx-mut); }
  .sw { display: inline-block; width: .7rem; height: .7rem; margin-right: var(--sp-2); vertical-align: -.05rem; border: 1px solid var(--line-2); }
  .sw[data-cls] { background: var(--c); border-color: var(--c); margin-right: 0; }

  @media (pointer: coarse) {
    .cmap-views .og-btn { min-height: var(--tap); }
  }
</style>
