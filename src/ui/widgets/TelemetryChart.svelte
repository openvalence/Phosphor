<script>
  /**
   * TelemetryChart.svelte — scrolling live strip chart, lanes discovered by ROLE.
   *
   * Reproduces the character of the pre-refactor features/diag.js graph (a
   * scrolling multi-lane scope with gridlines, per-lane auto-scale and a live
   * numeric readout) but knows nothing about Nucleus: it never binds to a
   * channel id or a wire field name. Its lane candidates are every numeric
   * field the catalog tags with a `telemetry.*` role or `aspect: rate`
   * (RENDERING §8.2 row 15), resolved through `machine.catalog.model.byRole`.
   * The operator picks which to plot; the `roles` prop is only the default.
   *
   * GROUND TRUTH (RENDERING §13 laws 8, 9): a lane plots REAL samples only,
   * pushed when a STATE arrives and stored at the source cadence telebuf.js
   * reconstructs (webui.md T18), never re-sampled on the render clock. Link
   * silence (the model's one freshness rule) cuts the line: the last real
   * sample stays as a dimmed marker and the next arrival starts a new segment.
   * Lane labels go through labelFor(), so a `planned` or `demand` field says
   * so in the legend instead of reading as a measurement.
   *
   * Sampling and drawing are plain closures, not runes: imperative animation
   * machinery the template never reads.
   */
  import { untrack } from 'svelte';
  import { machine, freshness, staleReason } from '../../model/machine.svelte.js';
  import { ROLE } from '../../model/roles.js';
  import { reportedValue, NUMERIC_TYPES } from '../../model/settings.js';
  import { formatValue, unitOf, labelFor } from '../../model/format.js';
  import { norm } from '../../model/bounds.js';
  import { VALUE_ASPECT } from '../../../../Valence/clients/js/index.js';
  import { createTelebuf, chartPath } from '../hero/telebuf.js';

  let { roles = [ROLE.telemetryPosition, ROLE.telemetryVelocity] } = $props();

  // ---- lane candidates and selection ------------------------------------

  // Declaration order, which fixes each lane's color across reconnects
  // (RENDERING §8.4 scope row). First-authored field wins a role, per roles.js.
  const candidates = $derived.by(() => {
    const byRole = machine.catalog.model && machine.catalog.model.byRole;
    if (!byRole) return [];
    const out = [];
    for (const [role, list] of byRole) {
      const f = list[0];
      if (f && NUMERIC_TYPES.has(f.type)
          && (role.startsWith('telemetry.') || f.aspect === VALUE_ASPECT.rate)) out.push(f);
    }
    return out;
  });

  // Persisted by role, a registry id that survives firmware updates (law 10).
  const LANES_KEY = 'phosphor.chart.lanes';
  let selected = $state(loadLanes());
  function loadLanes() {
    try {
      const v = JSON.parse(localStorage.getItem(LANES_KEY));
      if (Array.isArray(v)) return v;
    } catch (e) { /* private mode or never saved */ }
    return [...untrack(() => roles)];
  }
  function toggleLane(role) {
    selected = selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role];
    try { localStorage.setItem(LANES_KEY, JSON.stringify(selected)); } catch (e) { /* private mode */ }
  }

  const resolvedSeries = $derived(candidates.filter((f) => selected.includes(f.role)));

  // Accent/neutral tokens from style.css, not an invented categorical ramp:
  // the hard rule is "invent no colors". --warn and --bad are hazard-only
  // (webui.md: identical in every theme, never decorative) and never belong
  // in a lane cycle, however many candidates a catalog advertises.
  const PALETTE_VARS = ['--reality', '--intent', '--tx-hi', '--line-4'];
  function paletteVarFor(f) {
    return PALETTE_VARS[Math.max(0, candidates.indexOf(f)) % PALETTE_VARS.length];
  }

  // ---- sample capture: one telebuf per candidate, fed on STATE arrival ----
  const RING_N = 420;          // 16.8 s at 25 Hz, past the visible window
  const WINDOW_MS = 10000;     // 10 s visible span
  const lanes = new Map();     // field.uid -> { tele, lastTs }

  $effect(() => {
    const live = new Set();
    for (const f of candidates) {
      live.add(f.uid);
      let lane = lanes.get(f.uid);
      if (!lane) { lane = { tele: createTelebuf({ capacity: RING_N }), lastTs: 0 }; lanes.set(f.uid, lane); }
      const ts = machine.sampleTs[f.channelId];
      if (!ts || ts === lane.lastTs) continue;
      lane.lastTs = ts;
      const v = reportedValue(f, machine.samples[f.channelId]);
      if (typeof v === 'number' && isFinite(v)) lane.tele.push(v, ts);
    }
    for (const uid of lanes.keys()) if (!live.has(uid)) lanes.delete(uid);
  });

  // Link-stale spans in the sampleTs clock domain. A span opens at the last
  // proof of life, so a line holds exactly as long as the link vouched for it.
  // ponytail: capped, not pruned against each ring's horizon; 256 outages
  // outlive any session worth charting.
  const gaps = [];
  $effect(() => {
    const stale = machine.link.stale;
    const last = gaps[gaps.length - 1];
    const open = last && last.to == null;
    if (stale && !open) gaps.push({ from: untrack(() => machine.stats.lastRxMs) || Date.now(), to: null });
    else if (!stale && open) last.to = Date.now();
    if (gaps.length > 256) gaps.shift();
  });

  let canvasEl = $state(null);

  $effect(() => {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    const root = document.documentElement;
    const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    const paletteColors = PALETTE_VARS.map(cssVar);
    const inkFaint = cssVar('--ink-faint');
    // Hairline color only, matched to the OG DIAG graph's gridline token
    // (--line-1); --line-soft reads as near-invisible against --bg.
    const line = cssVar('--line-1');
    const colorFor = (f) => paletteColors[Math.max(0, candidates.indexOf(f)) % paletteColors.length];

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;
    const onMqChange = (e) => { reduced = e.matches; };
    mq.addEventListener('change', onMqChange);

    let cssW = 0, cssH = 0;
    function sizeIfNeeded() {
      const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
      if (!w || !h) return false;
      if (w !== cssW || h !== cssH) {
        const dpr = window.devicePixelRatio || 1;
        canvasEl.width = Math.round(w * dpr);
        canvasEl.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cssW = w; cssH = h;
      }
      return true;
    }

    // The visible window's samples plus the one before it, so a line enters
    // from the left edge instead of starting mid-lane.
    function windowPoints(tele, now) {
      const pts = [];
      let before = null;
      tele.forEach((t, v) => {
        if (now - t > WINDOW_MS) before = { t, v };
        else pts.push({ t, v });
      });
      if (before) pts.unshift(before);
      return pts;
    }

    // Bounds: the field's own annotated [min,max] when the catalog gives one
    // (ground truth about the SENSOR's range, not a guess), else auto-scaled
    // from the samples actually in view.
    function laneScale(f, pts) {
      if (f.min != null && f.max != null && f.max > f.min) return [f.min, f.max];
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
      if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.12;
      return [lo - pad, hi + pad];
    }

    function draw() {
      if (!sizeIfNeeded()) return;
      ctx.clearRect(0, 0, cssW, cssH);
      const series = resolvedSeries;
      const n = series.length;
      if (!n) return;
      const now = Date.now();   // the sampleTs domain, not the rAF clock
      const laneH = cssH / n;
      const padL = 4, padR = 4;
      const x0 = padL, x1 = cssW - padR;
      const xOf = (t) => x1 - ((now - t) / WINDOW_MS) * (x1 - x0);

      // shared time gridlines every 2s, spanning the full height
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let sBack = 0; sBack <= WINDOW_MS / 1000; sBack += 2) {
        const x = x1 - (sBack * 1000 / WINDOW_MS) * (x1 - x0);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke();
      }

      series.forEach((f, i) => {
        const lane = lanes.get(f.uid);
        if (!lane) return;
        const pts = windowPoints(lane.tele, now);
        const laneY = i * laneH;
        const [lo, hi] = laneScale(f, pts);
        const y = (v) => laneY + (1 - norm(v, lo, hi)) * (laneH - 4) + 2;

        ctx.strokeStyle = line;
        ctx.strokeRect(x0, laneY + 1, x1 - x0, laneH - 2);

        // Samples farther apart than 4 grant periods draw as hold-then-step,
        // the same plausibility bound telebuf.js puts on a streaming gap. The
        // grant is the hub's GRANT reply in machine.grants (SPEC §9.1: a
        // ceiling); an on-change grant (rate 0) always steps.
        const grant = machine.grants[f.channelId];
        const joinMs = grant && grant.rate > 0 ? 4000 / grant.rate : 0;
        const { ops, marker } = chartPath(pts, gaps, now, joinMs);
        const color = colorFor(f);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, laneY + 1, x1 - x0, laneH - 2);
        ctx.clip();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const o of ops) {
          if (o.pen === 'M') ctx.moveTo(xOf(o.t), y(o.v));
          else ctx.lineTo(xOf(o.t), y(o.v));
        }
        ctx.stroke();
        if (marker) {
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(xOf(marker.t), y(marker.v), 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // faint scale caption so the auto-scaled lanes are not a mystery
        ctx.fillStyle = inkFaint;
        ctx.font = '9px "Martian Mono", monospace';
        ctx.fillText(formatValue(f, hi), x0 + 3, laneY + 9);
        ctx.fillText(formatValue(f, lo), x0 + 3, laneY + laneH - 3);
      });
    }

    let raf = null;
    let timer = null;
    function frame() {
      draw();
      raf = requestAnimationFrame(frame);
    }

    // prefers-reduced-motion: no continuous scroll, a discrete 1 s redraw.
    // Capture is independent of this (the arrival effect above), and the HTML
    // legend is plain reactive markup, live either way. untrack: a synchronous
    // draw here would subscribe this effect to telemetry (webui.md T23).
    if (reduced) {
      untrack(draw);
      timer = setInterval(draw, 1000);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      mq.removeEventListener('change', onMqChange);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  });
</script>

{#if candidates.length}
  <div class="tchart">
    <!-- OG DIAG strip legend (.diag-key): label and value stay neutral
         (tx-mut / tx-val); only the line swatch carries the series color.
         Each entry is also its lane's on/off toggle. -->
    <div class="tchart-legend">
      {#each candidates as f (f.uid)}
        {@const on = selected.includes(f.role)}
        {@const fr = on ? freshness(f.channelId) : null}
        <button type="button" class="leg" class:off={!on} aria-pressed={on}
                title={on ? 'Hide this lane' : 'Plot this lane'}
                onclick={() => toggleLane(f.role)}>
          <i class="swatch" style="background: var({paletteVarFor(f)})" aria-hidden="true"></i>
          <span class="leg-label">{labelFor(f)}</span>
          {#if on}
            <output class="mono leg-val" class:stale={fr && fr.stale} title={staleReason(fr)}>{formatValue(f, reportedValue(f, machine.samples[f.channelId]))}<span class="unit">{unitOf(f)}</span></output>
          {/if}
        </button>
      {/each}
    </div>
    {#if resolvedSeries.length}
      <div class="tchart-canvas-wrap og-screen" style="height: {Math.max(56, resolvedSeries.length * 56)}px">
        <canvas bind:this={canvasEl} role="img" aria-label="Live telemetry strip chart"></canvas>
      </div>
    {/if}
  </div>
{:else}
  <!-- ph-vdk.37: this card is unconditional in App.svelte's Overview list
       (machineItems), so a hub with no telemetry-role fields must say so
       rather than leaving a titled card with nothing under it. -->
  <p class="empty">No telemetry-role fields on this hub.</p>
{/if}

<style>
  .tchart {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--gap);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty {
    color: var(--ink-faint);
    font-size: 12.5px;
    margin: 0;
  }

  .tchart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
  }

  /* Sizes/colors verified against the OG's .diag-key (style.css): Chakra
     Petch label + mono value, both .68rem, neither tinted by series. */
  .leg {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font);
    font-size: .68rem;
    color: var(--tx-mut);
    background: none;
    border: 0;
    padding: 2px 0;
    cursor: pointer;
  }
  .leg.off { opacity: .45; }
  @media (pointer: coarse) {
    .leg { min-height: var(--tap); }
  }

  /* A short line, not a dot — reads as "this is what the plotted line looks
     like", matching the OG's .diag-key i. */
  .swatch {
    width: 10px;
    height: 2px;
    flex: 0 0 auto;
  }

  .leg-label { white-space: nowrap; }

  .leg-val {
    font-weight: var(--num-wght);
    font-size: .68rem;
    color: var(--tx-val);
  }
  /* Stale (law 8): the HeroNumerals stale voice; the title carries the age. */
  .leg-val.stale { color: var(--tx-ghost); }

  .unit {
    color: var(--tx-ghost);
    font-size: max(11px, 0.85em);
    margin-left: 2px;
  }

  /* Surface (background/border/inset shadow) comes from the global
     .og-screen utility — restating it here would fork the recipe. */
  .tchart-canvas-wrap {
    position: relative;
    width: 100%;
    overflow: hidden;
  }

  .tchart-canvas-wrap canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
