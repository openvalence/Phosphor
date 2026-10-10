<script>
  /**
   * ChannelHeat.svelte -- the channel heatmap (DESIGN §10.3, ph-8yga): a block per catalog channel in
   * catalog order, grouped by class with a hairline between groups, then the link blocks. A block's
   * brightness is its share of its own budget: a channel's rate over its recent peak, capped at its grant
   * (src/model/activity.js); a link block's reading over the limit that raises its health condition.
   *
   * Constraints:
   * - Size reads the catalog and view.bucket only, never activity (no page shifting). Buckets 1 and 2, or
   *   a catalog wider than MAX_COLS columns, take the compact form: a block per class and one for the link.
   * - Levels move on activity.js's tick and glide by a CSS transition of the tick's length; nothing runs
   *   per frame, and idle nothing runs at all. html.still drops the glide.
   * - A refused channel (its newest word a NACK) or a link block whose health condition is open wears the
   *   warn tint and the slash, and the details line says why; never color alone.
   * - Hover or focus opens ONE panel in the top layer (a popover): the same blocks, grouped the same way,
   *   each larger and labeled, live. A block there highlights and fills the details line at the panel's foot;
   *   no second tooltip is ever drawn. The panel sits below the top strip, so it never covers the safety
   *   controls. The pointer gets a grace period to cross into it.
   * - One tab stop: a toolbar whose arrows move among the bar's blocks (roving tabindex), the panel's
   *   blocks follow the focused one; Enter opens, Escape closes the panel.
   *   Under a coarse pointer the whole map is one 40 px button to the Link page, its blocks drawn only.
   */
  import { untrack } from 'svelte';
  import { machine } from '../model/machine.svelte.js';
  import { health } from '../model/health/health.svelte.js';
  import { view } from '../model/viewport.svelte.js';
  import { bytes, since, labelFor, formatWithUnit } from '../model/format.js';
  import { reportedReading } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import { watch, read, level, LINK, TICK_MS } from '../model/activity.js';
  import { secs } from '../model/health/core.js';
  import { CHANNEL_CLASS, CHANNEL_CLASS_NAME } from '../../../Valence/clients/js/index.js';

  // onopen(key): a block was clicked; key is a channel id, a link block's key, or null for a compact block.
  let { onopen = null } = $props();
  const uid = $props.id();

  const ROWS = 4, MAX_COLS = 32, GRACE_MS = 350;
  // A silence this long is a real gap in the machine's updates; shorter ones are jitter.
  const GAP_MS = 1000;
  const CLASSES = [CHANNEL_CLASS.STATE, CHANNEL_CLASS.STREAM, CHANNEL_CLASS.INTENT, CHANNEL_CLASS.EVENT, CHANNEL_CLASS.STORE];
  // full: the reading that raises the block's health condition (src/model/health/health.svelte.js).
  const LINKS = [
    { key: 'traffic', name: 'Link traffic', conds: ['backlog', 'drops'] },
    { key: 'rtt', name: 'Round trip', full: 50, conds: ['slow-link'] },
    { key: 'late', name: 'Late samples', full: 10, conds: ['rail-stalled', 'updates-stalled', 'cutout-client', 'cutout-network', 'cutout-hub', 'cutout-unknown'] },
    { key: 'budget', name: 'Frame budget', full: 25, conds: ['busy', 'slow-display', 'clock-drift', 'overloaded'] },
    { key: 'health', name: 'Health', conds: [] },
  ];

  // The tick's clock: activity.js calls back only while something is active.
  let t = $state(Date.now());
  $effect(() => watch((now) => { t = now; }));

  const groups = $derived.by(() => {
    const entries = machine.catalog.entries || [];
    return CLASSES.map((cls) => ({ key: 'c' + cls, name: CHANNEL_CLASS_NAME[cls], ids: entries.filter((e) => e.cls === cls).map((e) => e.id) }))
      .filter((g) => g.ids.length);
  });
  const compact = $derived(view.bucket <= 2
    || groups.reduce((a, g) => a + Math.ceil(g.ids.length / ROWS), 0) + Math.ceil(LINKS.length / ROWS) > MAX_COLS);

  const clamp = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  const hz = (r) => (r.hz ? (r.hz < 10 ? r.hz.toFixed(1) : Math.round(r.hz)) + '/s · ' + bytes(Math.round(r.bps)) + '/s' : '--');
  const ms = (v) => Math.round(v) + ' ms';
  const hex = (id) => '0x' + id.toString(16).padStart(4, '0').toUpperCase();

  /** key -> {key, name, cls, open, lv 0..1, warn, lines, why}: every channel and link block, at this tick. */
  const leaves = $derived.by(() => {
    const now = t, out = new Map();
    const refused = new Map();
    for (const n of machine.events.nacks) refused.set(n.channel, n);
    for (const e of machine.catalog.entries || []) {
      const r = read(e.id, now), n = refused.get(e.id);
      const warn = !!n && n.at > r.last;
      out.set(e.id, {
        key: e.id, name: e.name || hex(e.id), cls: e.clsName, open: e.id, warn, hz: r.rx.hz + r.tx.hz,
        lv: level(e.id, now, (machine.grants[e.id] && machine.grants[e.id].rate) || e.maxRateHz || 0),
        lines: [e.clsName + ' · ' + hex(e.id), 'rx ' + hz(r.rx), 'tx ' + hz(r.tx), r.last ? 'seen ' + since(r.last) + ' ago' : 'never seen'],
        why: warn ? ['refused: ' + (n.name || n.code)] : [],
      });
    }
    const open = new Map(health.incidents.filter((i) => !i.closed).map((i) => [i.cond, i]));
    // The stalled-updates incident outlives its gap (its hold); it speaks and warns only while a gap past
    // GAP_MS is really there, in the gap's own length.
    const gap = machine.stats.lastRxMs ? Date.now() - machine.stats.lastRxMs : 0;
    const stalled = open.get('updates-stalled');
    if (stalled) {
      if (gap > GAP_MS) open.set('updates-stalled', { ...stalled, text: 'No machine updates for ' + secs(gap) });
      else open.delete('updates-stalled');
    }
    const render = machine.stats.render, hl = health.link, dv = health.device, link = read(LINK, now);
    const reading = {
      traffic: [level(LINK, now), ['rx ' + hz(link.rx), 'tx ' + hz(link.tx), hl.backlog ? 'backlog ' + bytes(hl.backlog) : null]],
      rtt: [hl.rttMs / 50, [hl.rttMs != null ? 'typical ' + ms(hl.rttMs) + (hl.rttSlowMs != null ? ' · worst ' + ms(hl.rttSlowMs) : '') : 'not measured']],
      late: [render.heldPct / 10, [render.heldPct != null ? render.heldPct + '% of frames stalled' : 'not measured',
        hl.gaps ? hl.gaps + ' gaps, longest ' + ms(hl.longestGapMs) : null]],
      budget: [dv.lagP95Ms / 25, [dv.lagP95Ms != null ? 'lag ' + ms(dv.lagP95Ms) : 'lag not measured', dv.fps != null ? dv.fps + ' fps' : null]],
      health: [health.slot ? (health.slot.sev === 'act' ? 1 : 0.5) : 0, [health.slot ? health.slot.text : 'Good']],
    };
    for (const L of LINKS) {
      const inc = L.conds.map((c) => open.get(c)).find(Boolean);
      const warn = L.key === 'health' ? !!health.slot : !!inc;
      out.set(L.key, {
        key: L.key, name: L.name, cls: 'link', open: L.key, warn, lv: clamp(reading[L.key][0]),
        lines: reading[L.key][1].filter(Boolean), why: inc && L.key !== 'health' ? [inc.text] : [],
      });
    }
    return out;
  });

  /** The drawn groups: per channel, or per class in the compact form. */
  const shown = $derived.by(() => {
    if (!compact) return [...groups.map((g) => ({ key: g.key, name: g.name, blocks: g.ids.map((id) => leaves.get(id)) })),
      { key: 'link', name: 'Link', blocks: LINKS.map((L) => leaves.get(L.key)) }];
    // A compact block reads its highest member; its tip names the most traffic and the members at fault.
    const agg = (key, name, cls, members, lines) => {
      const top = members.reduce((a, m) => ((m.hz || 0) > (a.hz || 0) ? m : a), members[0]);
      const bad = members.filter((m) => m.warn);
      return { key, name, cls, open: null, lv: Math.max(...members.map((m) => m.lv)), warn: bad.length > 0,
        lines: lines(top), why: bad.slice(0, 3).map((m) => m.name + ': ' + (m.why[0] || m.lines[0])) };
    };
    return [
      ...(groups.length ? [{ key: 'classes', name: 'Classes', blocks: groups.map((g) => agg(g.key, g.name, g.name, g.ids.map((id) => leaves.get(id)),
        (top) => [g.ids.length + (g.ids.length === 1 ? ' channel' : ' channels'), top.hz > 0 ? 'busiest: ' + top.name : 'quiet'])) }] : []),
      { key: 'link', name: 'Link', blocks: [agg('link', 'Link', 'link', LINKS.map((L) => leaves.get(L.key)),
        () => LINKS.map((L) => L.name + ': ' + leaves.get(L.key).lines[0]))] },
    ];
  });
  const flat = $derived(shown.flatMap((g) => g.blocks));
  const coarse = $derived(view.pointer === 'coarse');
  const warnings = $derived(flat.filter((b) => b.warn).length);
  const pct = (lv) => Math.round(lv * 20) * 5;

  // ---- the panel: hover or keyboard focus -----------------------------------------------------------
  let hovering = $state(false), hoverKey = $state(null), focusKey = $state(null), focused = $state(false), dismissed = $state(false);
  let box = $state(null), panel = $state(null), leaveTimer = 0;
  const rover = $derived(flat.some((b) => b.key === focusKey) ? focusKey : flat[0] && flat[0].key);
  const open = $derived(!dismissed && (hovering || focused));
  const activeKey = $derived(open ? hoverKey ?? (focused ? rover : null) : null);
  const detail = $derived.by(() => {
    const b = activeKey == null ? null : flat.find((x) => x.key === activeKey);
    return b && typeof b.key === 'number' ? { ...b, lines: [...b.lines, ...readings(b.key)] } : b || null;
  });
  // The magnitudes the bar's old activity rows drew, now in their channel's tip (DESIGN §10.3).
  const READS = [ROLE.telemetryVelocity, ROLE.telemetryCurrent, ROLE.telemetryPowerBus, ROLE.telemetryPowerDraw];
  /** A channel's role-bound readings, on the tip's clock: the sample is read untracked, never per arrival. */
  function readings(id) {
    const byRole = machine.catalog.model && machine.catalog.model.byRole;
    if (!byRole) return [];
    const sample = untrack(() => machine.samples[id]);
    return READS.flatMap((r) => (byRole.get(r) || []).filter((f) => f.channelId === id)).map((f) => {
      const v = reportedReading(f, sample);
      return labelFor(f) + ' ' + (v != null ? formatWithUnit(f, v) : '--');
    });
  }
  // Ages in an open panel keep moving while the tick is quiet.
  $effect(() => {
    if (!open) return;
    const id = setInterval(() => { t = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  function enter() { clearTimeout(leaveTimer); leaveTimer = 0; hovering = true; dismissed = false; }
  function leave() {
    if (leaveTimer) return;
    leaveTimer = setTimeout(() => { leaveTimer = 0; hovering = false; hoverKey = null; }, GRACE_MS);
  }
  // A bar that is hidden under the pointer never sends pointerleave: while hovering, the pointer's own
  // position is the truth.
  $effect(() => {
    if (!hovering) return;
    const move = (e) => { if (box && !box.contains(e.target)) leave(); };
    addEventListener('pointermove', move, { passive: true });
    return () => removeEventListener('pointermove', move);
  });
  function onfocus(b) { focusKey = b.key; focused = true; dismissed = false; }
  function pick(b) { dismissed = true; if (onopen) onopen(b.open); }
  $effect(() => () => clearTimeout(leaveTimer));

  // The panel hangs from the top strip's lower edge, left-aligned to the map, inside the window.
  function place() {
    const r = box.getBoundingClientRect();
    const strip = box.closest('.topstrip')?.querySelector(':scope > .strip');
    const top = Math.max(box.closest('header')?.getBoundingClientRect().bottom ?? r.bottom, strip?.getBoundingClientRect().bottom ?? 0) + 4;
    panel.style.top = top + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.setProperty('--ptop', top + 'px');
  }
  $effect(() => {
    if (!panel) return;
    if (open) {
      if (!panel.matches(':popover-open')) panel.showPopover();
      place();
    } else if (panel.matches(':popover-open')) panel.hidePopover();
  });

  function onkey(e) {
    if (e.key === 'Escape') { if (open) { dismissed = true; e.stopPropagation(); } return; }
    const i = flat.findIndex((b) => b.key === rover);
    const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: flat.length - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    box.querySelectorAll('.bar .blk')[Math.max(0, Math.min(flat.length - 1, j))]?.focus();
  }
</script>

{#if flat.length && coarse}
  <!-- A finger cannot pick a 5 px block: one 40 px target that opens the Link page. -->
  <button type="button" class="heat one" class:compact style="--tick: {TICK_MS}ms" onclick={() => onopen && onopen(null)}
          aria-label={'Channel activity' + (warnings ? ', ' + warnings + (warnings === 1 ? ' warning' : ' warnings') : '')}>
    {#each shown as g (g.key)}
      <span class="grp">{#each g.blocks as b (b.key)}<span class="blk" class:warn={b.warn} style="--lv: {pct(b.lv)}%"></span>{/each}</span>
    {/each}
  </button>
{:else if flat.length}
  <div class="heat" class:compact role="toolbar" tabindex="-1" aria-label="Channel activity" bind:this={box} style="--tick: {TICK_MS}ms"
       onkeydown={onkey} onpointerenter={enter} onpointerleave={leave}
       onfocusout={(e) => { if (!box.contains(e.relatedTarget)) focused = false; }}>
    {#each shown as g (g.key)}
      <span class="grp bar">
        {#each g.blocks as b (b.key)}
          <button type="button" class="blk" class:warn={b.warn} class:on={activeKey === b.key}
                  style="--lv: {pct(b.lv)}%" tabindex={b.key === rover ? 0 : -1}
                  aria-label={b.name + ', ' + b.cls + (b.warn ? ', warning' : '')}
                  aria-describedby={activeKey === b.key ? uid : undefined}
                  onpointerenter={() => (hoverKey = b.key)}
                  onfocus={() => onfocus(b)}
                  onclick={() => pick(b)}></button>
        {/each}
      </span>
    {/each}
    <div class="panel og-panel" popover="manual" role="group" aria-label="Channel activity detail" bind:this={panel}>
      {#if open}
        {#each shown as g (g.key)}
          <div class="pg">
            <span class="cap">{g.name}</span>
            <span class="tiles">
              {#each g.blocks as b (b.key)}
                <button type="button" class="tile" class:warn={b.warn} class:on={activeKey === b.key} tabindex="-1"
                        aria-label={b.name + ', ' + b.cls + (b.warn ? ', warning' : '')}
                        onpointerenter={() => (hoverKey = b.key)} onclick={() => pick(b)}>
                  <span class="blk sw" class:warn={b.warn} style="--lv: {pct(b.lv)}%"></span><span class="lbl">{b.name}</span>
                </button>
              {/each}
            </span>
          </div>
        {/each}
        <div class="detail" id={uid}>
          {#if detail}
            <span class="dn">{detail.name}</span>
            <span class="dl">{detail.lines.join(' · ')}</span>
            {#each detail.why as line, i (i)}<span class="dl why">{line}</span>{/each}
          {:else}
            <span class="dl">Pick a block</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Never taller than the bar's row (LinkBar --row, 32 px): four 5 px rows. */
  .heat {
    --cold: var(--line-2);
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }
  .grp {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(4, 5px);
    grid-auto-columns: 5px;
    gap: 1px;
  }
  .grp + .grp { border-left: 1px solid var(--line-3); padding-left: var(--sp-1); }
  /* Compact: the class blocks in two rows, the link block centered beside them. */
  .compact .grp { grid-template-rows: repeat(2, 9px); grid-auto-columns: 9px; gap: var(--sp-1); }
  .compact .grp:last-child { grid-template-rows: 9px; }
  /* The bar's coarse row is 40 px (LinkBar): the one target fills it. */
  .heat.one { min-width: 40px; min-height: 40px; padding: 0; }

  .blk {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border-radius: 1px;
    background-color: color-mix(in oklab, var(--reality) var(--lv), var(--cold));
    transition: background-color var(--tick) linear;
  }
  /* Warn: the tint plus a slash, a shape that holds without color. */
  .blk.warn {
    background-color: color-mix(in oklab, var(--warn) calc(40% + var(--lv) * .6), var(--cold));
    background-image: linear-gradient(135deg, transparent 38%, var(--bg-raised) 38% 62%, transparent 62%);
  }
  :global(html.still) .blk { transition: none; }
  .blk.on, .blk:focus-visible { outline: 1px solid var(--highlight); outline-offset: 1px; }

  /* The panel: top layer (popover), out of flow, placed by place(). Tiles flow in rows per group; a tile is
     a swatch about 3.6x the bar's block, plus the block's name. */
  .panel {
    position: fixed;
    inset: auto;
    margin: 0;
    width: min(46rem, calc(100vw - 16px));
    max-height: calc(100dvh - var(--ptop, 0px) - 8px);
    overflow: auto;
    padding: var(--sp-3) var(--sp-4);
    box-sizing: border-box;
    background: var(--bg-card);
    color: var(--tx);
    font-size: .72rem;
    line-height: 1.4;
  }
  .pg { display: grid; grid-template-columns: 4.2rem 1fr; gap: var(--sp-2); align-items: start; padding: var(--sp-1) 0; }
  .pg + .pg { border-top: 1px solid var(--line-3); }
  .cap { color: var(--ink-faint); letter-spacing: .06em; text-transform: uppercase; font-size: .62rem; padding-top: var(--sp-2); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.6rem, 1fr)); gap: var(--sp-1) var(--sp-2); }
  .tile {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    padding: 1px var(--sp-1);
    text-align: left;
    color: var(--ink-dim);
    border-radius: var(--r-s);
  }
  .tile.on { color: var(--ink-hi); outline: 1px solid var(--highlight); }
  .tile.warn { color: var(--warn-ink, var(--warn)); }
  .sw { flex: none; width: 18px; height: 18px; border-radius: 2px; }
  .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--sp-3);
    min-height: 2.8em;
    margin-top: var(--sp-2);
    padding-top: var(--sp-2);
    border-top: 1px solid var(--line-1);
    color: var(--tx);
  }
  .dn { color: var(--ink-hi); }
  .dl.why { color: var(--warn-ink, var(--warn)); flex-basis: 100%; }
</style>
