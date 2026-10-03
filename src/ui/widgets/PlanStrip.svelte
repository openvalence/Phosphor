<script>
  /**
   * PlanStrip.svelte — in-flight motion-plan visualizer, bound by ROLE.
   *
   * Reproduces the character of the pre-refactor features/planstrip.js (a
   * glowing span between the plan's start/end, a sweep head at the live
   * setpoint, a fading trail of recently-completed segments) with a cleaner
   * execution: no bespoke render-clock module, no wire-specific state
   * machine — it just redraws from whatever the catalog's own decoded
   * snapshot says, at whatever rate the hub is granting the channel(s).
   *
   * ── RFC-035, and ROLE-ONLY discipline ────────────────────────────────────
   *
   * The registry names `plan.start/end/current/velocity/elapsed/duration/
   * style` (the Valence repo's registry.yaml, field_roles), so this binds
   * like every other hero/widget: claimRoles() against
   * machine.catalog.model.byRole, same as RailWidget. That claim resolves
   * per-FIELD, not per-channel — each resolved field carries its own
   * channelId — so a hub is free to spread plan telemetry across more than
   * one channel and this still draws correctly.
   *
   * NEVER add a name/prose heuristic for a hub that has not tagged plan.*:
   * this is the reference Valence client, and a name-guessing example
   * teaches every third-party client the technique the role catalog exists to
   * make unnecessary. An untagged hub renders nothing here; its fields still
   * show up as ordinary generic controls elsewhere on the page.
   *
   * "Is a plan actually running right now" also has no role (a device-
   * specific status bitfield is not something a DIFFERENT machine's planner
   * would necessarily share, so it fails the registry's own inclusion test)
   * — see `isActive` below for the role-agnostic substitute this uses instead
   * of reading a bit by name.
   *
   * ── WHAT THE ROLES DO NOT PROMISE ─────────────────────────────────────
   *
   * A hub may rebuild plan.* from plan-adoption EVENTS rather than sampling a
   * planner it owns, and then:
   *   1. `plan.start` is a position sampled when the plan was adopted, not a
   *      replayable curve endpoint.
   *   2. `plan.elapsed` runs against the plan's ANCHOR, so it can sit before
   *      the start of a scheduled plan or past `plan.duration` on an overrun.
   *      See `progressFrac` for why the bar declines rather than clamps.
   *   3. A plan can be in flight while the NEXT one is already adopted and
   *      parked, so the span may jump ahead of the sweep head. That is drawn
   *      as it arrives: the head is placed from `plan.current` alone and is
   *      never constrained to the span, and the superseded span becomes a
   *      ghost.
   * None of that is device knowledge. It is the shape of the roles once you
   * stop assuming one planner ticking one curve. Do not add a heuristic that
   * "corrects" any of it; the numbers on screen are the hub's to state.
   *
   * `plan.style` renders through optionLabel() off the catalog's own option
   * list, so a planner that gains or retires a style needs no change here.
   */
  import { machine } from '../../model/machine.svelte.js';
  import { formatParts, optionLabel, labelFor } from '../../model/format.js';
  import { ROLE, claimRoles } from '../../model/roles.js';
  import { norm } from '../../model/bounds.js';
  import { railOwnerName } from '../../model/actions.js';
  import { CH_CONTROL_OWNER, LIMITS, UNIT_ID } from '../../../../Valence/clients/js/index.js';
  import { onTheme } from '../../model/theme.js';

  // shown: RailWidget keeps this mounted under the jog tape and flips
  // visibility (ph-e82.21); hidden, the draw loop stops.
  let { shown = true } = $props();

  /** Per-field sample lookup — every role-claimed field carries its own
      channelId, so a claim spread across multiple channels still reads the
      right sample for each piece. */
  function fieldSample(f) { return f ? machine.samples[f.channelId] : undefined; }
  function fieldValue(f) {
    const s = fieldSample(f);
    return (f && s) ? s[f.name] : undefined;
  }

  /** Normalized 0..1 position: the field's own [min,max] if annotated, else assume the value is already normalized (matches every "_norm" style field seen on this and similarly-shaped channels). */
  function pct(f) {
    if (!f) return null;
    const v = fieldValue(f);
    if (f.min != null && f.max != null && f.max > f.min) return norm(v, f.min, f.max);
    return norm(v, 0, 1);
  }

  // ---- discovery: ROLE, and ONLY role — see this file's header --------------
  const fields = $derived.by(() => {
    const byRole = machine.catalog.model && machine.catalog.model.byRole;
    if (!byRole) return null;
    const claim = claimRoles(byRole, {
      optional: {
        start: ROLE.planStart, end: ROLE.planEnd, position: ROLE.planCurrent,
        velocity: ROLE.planVelocity, elapsed: ROLE.planElapsed, duration: ROLE.planDuration,
        style: ROLE.planStyle,
      },
    });
    // None of the span/position roles resolved: this hub has not annotated
    // plan.* — decline entirely (opportunities, never requirements) rather
    // than rendering an empty strip off a "successful" but useless claim.
    if (!claim || !(claim.start || claim.end || claim.position)) return null;
    return claim;
  });

  const startPct = $derived(fields ? pct(fields.start) : null);
  const endPct = $derived(fields ? pct(fields.end) : null);
  const curPct = $derived(fields ? pct(fields.position) : null);
  const haveSpan = $derived(startPct != null && endPct != null);
  const haveAnyPosition = $derived(haveSpan || curPct != null);

  const velVal = $derived(fields && fields.velocity ? fieldValue(fields.velocity) : undefined);
  const durVal = $derived(fields && fields.duration ? fieldValue(fields.duration) : undefined);
  const elapsedVal = $derived(fields && fields.elapsed ? fieldValue(fields.elapsed) : undefined);
  /**
   * Elapsed over duration, ONLY while that ratio is a progress fraction.
   *
   * `plan.elapsed` is measured against the plan's own ANCHOR, and a hub is
   * free to adopt a plan whose anchor has not arrived yet (a scheduled
   * successor parked behind the plan in flight) or to run one past its
   * nominal duration. Both land outside 0..1, and neither of them means
   * "complete". Clamping either into a full bar would put a progress on
   * screen that the device never reported, which is the optimistic-UI lie in
   * miniature. So the bar declines outside the range and the raw
   * elapsed/duration numerals, the device's own words, stand alone. A zero or
   * absent duration (a hold) declines the same way, for the same reason.
   */
  const progressFrac = $derived.by(() => {
    if (durVal == null || elapsedVal == null || !isFinite(durVal) || durVal <= 0) return null;
    if (!isFinite(elapsedVal)) return null;
    const f = elapsedVal / durVal;
    return f >= 0 && f <= 1 ? f : null;
  });
  /** Both numerals stay reportable even when the ratio between them is not. */
  const haveTiming = $derived(
    !!(fields && fields.elapsed && fields.duration) && elapsedVal != null && durVal != null);

  const styleVal = $derived(fields && fields.style ? fieldValue(fields.style) : undefined);
  // The source holding the rail, in the hub's own words; '' reads "plan".
  const owner = $derived(railOwnerName(machine.catalog.entries.find((e) => e.id === CH_CONTROL_OWNER),
    machine.samples[CH_CONTROL_OWNER]));

  // ---------------------------------------------------------------------------
  // "Is a plan actually streaming right now": dims the lane when not. When
  // the strip shows at all is RailWidget's call (a source owns the rail).
  // No role names a "plan active" concept (see
  // this file's header), so this reads the one signal every role-claimed
  // channel already gives for free, generically: how recently it last
  // pushed. This device's plan-strip publisher only republishes while a plan
  // is live (an idle machine costs a subscriber nothing after one baseline
  // snapshot) — the exact behavior the original's own "is the 0x04 frame
  // still arriving" check depended on, just read off the generic per-channel
  // sample clock instead of a wire-specific staleness field. FRESH_MS mirrors
  // the original's 250ms recency window; HIDE_GRACE_MS mirrors its 1000ms
  // post-stream grace so a brief gap between segments doesn't flicker the
  // lane dim and straight back.
  // ---------------------------------------------------------------------------
  const FRESH_MS = 250;
  const HIDE_GRACE_MS = 1000;
  let isActive = $state(false);
  let hideTimer = null;

  function claimedChannelIds() {
    if (!fields) return [];
    const ids = new Set();
    for (const k of ['start', 'end', 'position', 'velocity', 'elapsed', 'duration', 'style']) {
      if (fields[k]) ids.add(fields[k].channelId);
    }
    return [...ids];
  }

  // A timed hold (SPEC §9.6: span within segment_dwell_span, duration live)
  // may publish nothing new while it holds: it counts as streaming until its
  // own remaining time has run out, so a long dwell never reads as a stall.
  const MS_PER = { [UNIT_ID.us]: 1e-3, [UNIT_ID.ms]: 1, [UNIT_ID.s]: 1e3 };
  function holding(now) {
    const d = fields && fields.duration, e = fields && fields.elapsed;
    const k = d && e && d.unitId === e.unitId ? MS_PER[d.unitId] : null;
    if (!k || !haveSpan || Math.abs(endPct - startPct) > LIMITS.segment_dwell_span) return false;
    if (!(durVal > 0) || !(elapsedVal < durVal)) return false;
    return now - (machine.sampleTs[d.channelId] || 0) < (durVal - elapsedVal) * k;
  }

  function pollActivity() {
    const ids = claimedChannelIds();
    const now = Date.now();
    const fresh = ids.some((id) => (now - (machine.sampleTs[id] || 0)) < FRESH_MS) || holding(now);
    if (fresh) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      isActive = true;
    } else if (isActive && !hideTimer) {
      hideTimer = setTimeout(() => { isActive = false; hideTimer = null; }, HIDE_GRACE_MS);
    }
  }

  // ---- canvas: span + sweep head + fading segment ghosts ---------------------
  let canvasEl = $state(null);
  const GHOST_N = 5;
  const GHOST_FADE_MS = 1200;

  $effect(() => {
    if (!canvasEl || !haveAnyPosition || !shown) return;
    const ctx = canvasEl.getContext('2d');
    const root = document.documentElement;
    const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    let cIntent, cWarn, cLine;
    const readTokens = () => { cIntent = cssVar('--reality'); cWarn = cssVar('--warn'); cLine = cssVar('--line'); };
    readTokens();
    const offTheme = onTheme(readTokens);

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

    let dispFrom = null, dispTo = null;
    let lastKey = '';
    const gFrom = new Float64Array(GHOST_N);
    const gTo = new Float64Array(GHOST_N);
    const gBorn = new Float64Array(GHOST_N);
    let gHead = 0, gLen = 0;
    function pushGhost(from, to, now) {
      gHead = (gHead + 1) % GHOST_N;
      gFrom[gHead] = from; gTo[gHead] = to; gBorn[gHead] = now;
      if (gLen < GHOST_N) gLen++;
    }

    function draw() {
      pollActivity();
      if (!sizeIfNeeded()) return;
      ctx.clearRect(0, 0, cssW, cssH);
      const h = cssH;
      const now = performance.now();

      // Track baseline + faint window ticks.
      ctx.strokeStyle = cLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, cssW - 1, h - 1);

      const from = startPct != null ? startPct : curPct;
      const to = endPct != null ? endPct : curPct;
      if (from == null || to == null) return;

      const key = from.toFixed(4) + ':' + to.toFixed(4);
      if (dispFrom == null) { dispFrom = from; dispTo = to; lastKey = key; }
      else if (key !== lastKey) {
        pushGhost(dispFrom, dispTo, now);
        lastKey = key;
      }
      const ease = reduced ? 1 : 0.3;
      dispFrom += (from - dispFrom) * ease;
      dispTo += (to - dispTo) * ease;

      // Ghost trail of recently-superseded spans.
      for (let g = 0; g < gLen; g++) {
        const gi = (gHead - g + GHOST_N) % GHOST_N;
        const age = now - gBorn[gi];
        if (age > GHOST_FADE_MS) continue;
        const f2 = 1 - age / GHOST_FADE_MS;
        const ga = gFrom[gi] * cssW, gb = gTo[gi] * cssW;
        ctx.fillStyle = `color-mix(in srgb, ${cIntent} ${Math.round(16 * f2 * f2)}%, transparent)`;
        ctx.fillRect(Math.min(ga, gb), h * 0.5 - 1.5, Math.max(1, Math.abs(gb - ga)), 3);
      }

      // Current span, glowing gradient toward the "to" end.
      const x0 = dispFrom * cssW, x1 = dispTo * cssW;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, `color-mix(in srgb, ${cIntent} 12%, transparent)`);
      grad.addColorStop(1, `color-mix(in srgb, ${cIntent} 55%, transparent)`);
      ctx.fillStyle = grad;
      ctx.fillRect(lo, 1, Math.max(2, hi - lo), h - 2);

      // Sweep head at the live setpoint, if the channel reports one.
      if (curPct != null) {
        const hx = curPct * cssW;
        ctx.save();
        ctx.shadowColor = cIntent;
        ctx.shadowBlur = reduced ? 0 : 7;
        ctx.fillStyle = cIntent;
        ctx.fillRect(hx - 0.75, 0, 1.5, h);
        ctx.restore();
      }

      // Caret at the "to" end, warn-toned once isActive (above) goes false:
      // cosmetic, not a second source of truth for "is it running".
      ctx.save();
      ctx.shadowColor = isActive ? cIntent : cWarn;
      ctx.shadowBlur = reduced ? 0 : 6;
      ctx.fillStyle = isActive ? cIntent : cWarn;
      ctx.fillRect(x1 - 1, -1, 2, h + 2);
      ctx.restore();
    }

    let raf = null, timer = null;
    function frame() { draw(); raf = requestAnimationFrame(frame); }
    if (reduced) { draw(); timer = setInterval(draw, 1000); }
    else raf = requestAnimationFrame(frame);

    return () => {
      offTheme();
      mq.removeEventListener('change', onMqChange);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    };
  });
</script>

{#snippet vu(f, v)}{@const p = formatParts(f, v)}{p[0]}{#if p[1]}{' '}<span class="unit">{p[1]}</span>{/if}{/snippet}

{#if fields && haveAnyPosition}
  <!-- Mounted by RailWidget in the rail row's fixed box, shown over the jog
       tape while a source owns the rail: a labels line over the lane, the
       tape's own geometry, so the swap never moves anything. `.on` follows
       isActive (a plan streaming right now); off, the lane dims (law 8). -->
  <div class="plan-strip" class:on={isActive}>
    <div class="plan-labels">
      <!-- The style rides its own label, so a style named "idle" never reads
           as the run state (ph-kts). -->
      <span class="plan-mode">{#if owner}<span class="plan-owner">{owner}</span>{:else}plan{/if}{#if fields.style}{' · ' + labelFor(fields.style) + ' ' + optionLabel(fields.style, styleVal)}{/if}</span>
      <span class="plan-meta mono">
        {#if fields.velocity}
          <output>{@render vu(fields.velocity, velVal)}</output>
        {/if}
        {#if haveTiming}
          {#if progressFrac != null}
            <span class="progress-track"><span class="progress-fill" style="width:{progressFrac * 100}%"></span></span>
          {/if}
          <output>{@render vu(fields.elapsed, elapsedVal)} / {@render vu(fields.duration, durVal)}</output>
        {:else if fields.elapsed}
          <output>{@render vu(fields.elapsed, elapsedVal)}</output>
        {:else if fields.duration}
          <output>{@render vu(fields.duration, durVal)}</output>
        {/if}
      </span>
    </div>
    <div class="plan-lane">
      <canvas bind:this={canvasEl} role="img" aria-label="In-flight motion plan"></canvas>
    </div>
  </div>
{/if}

<style>
  .plan-strip {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  /* 14px + 4px, the same line RailWidget's tape labels hold. */
  .plan-labels {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    height: 14px;
    line-height: 14px;
    margin-bottom: 4px;
    white-space: nowrap;
    font-size: calc(var(--s) * 10px);
  }
  .plan-mode {
    letter-spacing: 0.14em;
    text-transform: lowercase;
    color: color-mix(in srgb, var(--reality) 78%, var(--tx-mut));
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Hub text renders as sent (docs/COPY.md rule 8). */
  .plan-owner { text-transform: none; }
  .plan-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    color: var(--ink);
  }
  .unit { color: var(--ink-dim); font-size: 0.9em; }

  .plan-lane {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: var(--bg-sunken);
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    box-shadow: inset 0 1px 4px rgba(var(--shade-rgb), .5);
  }
  .plan-strip:not(.on) .plan-lane { opacity: .55; }
  .plan-lane canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .progress-track {
    width: 48px;
    height: 4px;
    border-radius: 2px;
    background: var(--line-soft);
    overflow: hidden;
    flex: 0 0 auto;
  }
  .progress-fill {
    display: block;
    height: 100%;
    background: var(--reality);
  }
</style>
