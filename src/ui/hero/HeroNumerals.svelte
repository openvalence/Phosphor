<script>
  /**
   * HeroNumerals.svelte — the big glowing readout row above the rail.
   *
   * A faithful port of the pre-refactor rail's hero numerals (position /
   * target / lag / speed). `targetVal` is RFC-032 `telemetry.target`, the
   * machine's own reported setpoint; `lag` is target - position, computed
   * client-side here because that subtraction has no role of its own (see
   * roles.js on `telemetry.target`). Never render a setpoint off window
   * bounds or a locally-remembered request: that is the optimistic-UI lie.
   *
   * EVERY LABEL COMES FROM labelFor(), WHICH CARRIES THE FIELD'S PROVENANCE.
   * The reference read "actual" over the big numeral; that word is now the
   * catalog's to choose, because a machine whose planner renders position
   * publishes it as `planned` and the numeral must say so. Never restate a
   * provenance word as a literal here.
   *
   * NOT a hero registered in heroes.js — HeroStrip only knows {id, component,
   * fields} entries from that registry, and this widget has no roles of its
   * own to claim. RailWidget composes it directly, feeding it the SAME
   * interpolated numbers driving its canvas, so the numerals and the phosphor
   * dot never disagree about where "now" is.
   *
   * Every number is either `posVal`/`speedVal`/`targetVal` (already smoothed
   * from real telemetry samples in RailWidget's telebuf, never fabricated) —
   * this component does no ground-truth reading of its own.
   *
   * ── Zero-padded fixed-width numerals (OG parity) ────────────────────────
   * The pre-refactor rail's pad()/setVV() (`webui-prerefactor`'s core/ui.js)
   * always rendered e.g. "000.0", never "0.0" — a bare digit reflows the
   * whole hero row's width as the value's digit count changes; padding
   * reserves the full column up front so nothing shifts. Reimplemented
   * locally (`padNumeral` below) rather than in model/format.js: formatValue()
   * is the catalog-honest presentation used EVERYWHERE ELSE in the app
   * (settings, the generic Field control, ...) — fixed-width zero-padding is
   * a look specific to this one hero row, not a change to what "correct
   * precision" means anywhere else. Leading zeros are plain text (no
   * per-character opacity trick) so they read as one solid numeral, exactly
   * like the reference — do not split them into dimmed spans.
   *
   * THE TARGET NUMERAL TAKES A TYPED JOG (operator 2026-10-03, ph-9kjh).
   * Enter sends `sendCommand(move, v)`, the rail tape's own call, clamped to
   * the tape's own domain; the tape's gate disables it with the tape's words.
   * Never a second wire path, never a wider domain than the tape's.
   */
  import { tick } from 'svelte';
  import { unitOf, precisionFor, labelFor } from '../../model/format.js';
  import { machine, freshness, staleReason, getSession } from '../../model/machine.svelte.js';
  import { sendCommand, displayValue } from '../../model/shadow.svelte.js';
  import { claimRoles, AXIS_HERO_SPEC } from '../../model/roles.js';

  let {
    posField = null,
    velField = null,
    targetField = null,
    posVal = null,
    speedVal = null,
    targetVal = null,
    moving = false,
    fresh = false,
    targetFresh = false,
    // The widget's own travel extent (upper bound, same physical domain as
    // posField): sizes the zero-pad width below. RailWidget forwards its
    // derived `hi`; absent, pad width falls back to 3 integer digits.
    extentHi = null,
    // (text) => void: the strip's status slot takes the clamp note; '' clears.
    onnote = null,
  } = $props();

  /** Integer-part pad width derived from the widget's own extent, e.g.
   *  hi=268 -> 3, hi=1500 -> 4. Defaults to 3 (OG's 0-999mm assumption)
   *  when no extent was handed down. */
  const padIntDigits = $derived.by(() => {
    if (extentHi != null && isFinite(extentHi) && Math.abs(extentHi) >= 1) {
      return Math.floor(Math.log10(Math.abs(extentHi))) + 1;
    }
    return 3;
  });

  /** Zero-pad `value` to `intDigits` integer digits + `fracDigits` decimals,
   *  e.g. (4.2, 3, 1) -> "004.2". `null`/non-finite passes through as '--'
   *  unchanged — absence of a value is never rendered as a padded zero. */
  function padNumeral(value, intDigits, fracDigits) {
    if (value == null || !isFinite(value)) return '--';
    const neg = value < 0;
    const fixed = Math.abs(value).toFixed(fracDigits);
    const [intPart, fracPart] = fixed.split('.');
    const intStr = intPart.padStart(Math.max(intDigits - (neg ? 1 : 0), 1), '0');
    return (neg ? '-' : '') + intStr + (fracPart != null ? '.' + fracPart : '');
  }

  const posUnit = $derived(posField ? unitOf(posField) : '');
  // Reference floor of one decimal place (OG hardcoded fracDigits=1 for this
  // numeral) — Math.max rather than a bare literal so a catalog that
  // publishes FINER precision (smaller step) is never truncated back down to
  // match the reference; it only ever raises the floor, never lowers real
  // precision.
  const posPrecision = $derived(Math.max(1, precisionFor(posField)));
  // A stale position stays on screen, dimmed, with its age on hover (law 8).
  const posText = $derived(padNumeral(posVal, padIntDigits, posPrecision));
  const staleTitle = $derived(fresh || !posField ? undefined : staleReason(freshness(posField.channelId)));
  // The label carries the unit once ("actual · mm", matching the reference) —
  // no separate unit span rides next to the numeral itself.
  const posLabel = $derived(
    posField ? labelFor(posField).toLowerCase() + (posUnit ? ' · ' + posUnit : '') : 'position'
  );

  // Speed has no field descriptor of its own when derived (no telemetry.velocity
  // role); reuse the position field's precision/unit-with-per-second as the
  // closest honest presentation, still entirely off the catalog's own metadata.
  const speedPrecision = $derived(velField ? precisionFor(velField) : (posField ? Math.max(0, precisionFor(posField) - 1) : 0));
  const speedText = $derived(
    padNumeral(fresh && speedVal != null && isFinite(speedVal) ? speedVal : null, padIntDigits, speedPrecision)
  );
  const speedUnit = $derived(velField ? unitOf(velField) : (posField && unitOf(posField) ? unitOf(posField) + '/s' : ''));

  const commandedPrecision = $derived(targetField ? Math.max(1, precisionFor(targetField)) : 1);
  const commandedText = $derived(padNumeral(targetField && targetFresh ? targetVal : null, padIntDigits, commandedPrecision));

  // lag = target - position (RFC-032: deliberately not its own role). Only
  // meaningful when BOTH sides are fresh ground truth this instant.
  const lagVal = $derived(
    (fresh && targetFresh && posVal != null && targetVal != null) ? (targetVal - posVal) : null
  );
  const lagPrecision = $derived(targetField ? Math.max(1, precisionFor(targetField)) : Math.max(1, precisionFor(posField)));
  const lagText = $derived(padNumeral(lagVal, padIntDigits, lagPrecision));

  // ---- typed jog: RailWidget's moveReason/jogBlock and tapeLo/tapeHi, restated.
  // ponytail: restated, not shared; change both together until RailWidget exports its jog.
  const axis = $derived(machine.catalog.model?.byRole ? claimRoles(machine.catalog.model.byRole, AXIS_HERO_SPEC) : null);
  const move = $derived(axis && axis.move);
  const jogWhy = $derived.by(() => {
    void machine.link.roles;
    if (!move) return 'no move intent on this catalog';
    if (machine.link.phase !== 'live') return 'no hub link';
    const session = getSession();
    if (!session || !session.isLive || !session.canUse(move.channelId, move.key, 0)) return 'session not authorized';
    const latch = machine.safety;
    return !latch ? '' : latch.estopLatched ? 'E-stop latched' : latch.paused && !latch.override ? 'Paused: Override to jog' : '';
  });
  const jogSpan = $derived.by(() => {
    const lo = axis?.min?.min ?? 0, hi = extentHi ?? lo;
    const a = axis && displayValue(axis.min, machine.samples[axis.min.channelId]);
    const b = axis && displayValue(axis.max, machine.samples[axis.max.channelId]);
    const win = !machine.safety?.override && Number.isFinite(a) && Number.isFinite(b) && hi > lo;
    return win ? { lo: Math.min(a, b), hi: Math.max(a, b), word: 'window' } : { lo, hi, word: 'travel' };
  });

  let editing = $state(false);
  let editEl = $state(null);
  let btnEl = $state(null);
  let noteT = null;
  const editW = $derived(Math.max(commandedText.length, 4));

  async function openEdit() {
    if (jogWhy) return;
    editing = true;
    await tick();
    editEl.value = targetFresh && targetVal != null && isFinite(targetVal) ? targetVal.toFixed(commandedPrecision) : '';
    editEl.select();
  }
  async function closeEdit(refocus) {
    editing = false;
    if (refocus) { await tick(); btnEl?.focus(); }
  }
  function onEditKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeEdit(true); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const typed = parseFloat(editEl.value);
    if (isFinite(typed) && !jogWhy) {
      const v = Math.min(jogSpan.hi, Math.max(jogSpan.lo, typed));
      sendCommand(move, v);
      clearTimeout(noteT);
      onnote?.(v !== typed ? 'clamped to ' + jogSpan.word : '');
      if (v !== typed) noteT = setTimeout(() => onnote?.(''), 4000);
    }
    closeEdit(true);
  }
</script>

<div class="hero-numerals" class:stale={!fresh} class:virtual={!!machine.link.virtual} title={staleTitle}>
  <div class="hn-item hn-primary">
    <span class="hn-label">
      <svg class="hn-reticle" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1"/>
        <line x1="6" y1="0" x2="6" y2="2.6" stroke="currentColor" stroke-width="1"/>
        <line x1="6" y1="9.4" x2="6" y2="12" stroke="currentColor" stroke-width="1"/>
        <line x1="0" y1="6" x2="2.6" y2="6" stroke="currentColor" stroke-width="1"/>
        <line x1="9.4" y1="6" x2="12" y2="6" stroke="currentColor" stroke-width="1"/>
        <circle cx="6" cy="6" r="0.9" fill="currentColor"/>
      </svg>
      {posLabel}
    </span>
    <span class="hn-val mono" class:glow={moving && fresh}>{posText}</span>
  </div>

  {#if targetField}
    <div class="hn-item hn-secondary">
      <span class="hn-label">{labelFor(targetField).toLowerCase()}</span>
      {#if editing}
        <input class="hn-val mono hn-intent hn-entry" type="number" step="any" bind:this={editEl}
               style="width:{editW}ch" aria-label={'Jog target, ' + (unitOf(targetField) || 'position')}
               onkeydown={onEditKey} onblur={() => closeEdit(false)} />
      {:else}
        <button type="button" class="hn-val mono hn-intent hn-entry" bind:this={btnEl} style="width:{editW}ch"
                aria-disabled={!!jogWhy} title={jogWhy || 'Click to type a target'} onclick={openEdit}>{commandedText}</button>
      {/if}
    </div>

    <!-- "lag" has no role of its own (roles.js: it is target - position,
         computed client-side) — there is no field to resolve a label from,
         so this stays a plain string rather than a fabricated ROLE_LABEL
         entry. -->
    <div class="hn-item hn-secondary">
      <span class="hn-label">lag</span>
      <span class="hn-val mono">{lagText}</span>
    </div>
  {/if}

  <div class="hn-item hn-secondary">
    <!-- Same treatment as the speed VALUE above: labeled from velField when
         the machine annotated telemetry.velocity, else the plain fallback
         (this number is client-derived from position, not its own field). -->
    <span class="hn-label">{velField ? labelFor(velField).toLowerCase() : 'speed'}</span>
    <span class="hn-val mono">{speedText}<span class="hn-unit">{speedUnit}</span></span>
  </div>
</div>

<style>
  .hero-numerals {
    display: flex;
    align-items: flex-end;
    gap: 18px;
    flex-wrap: wrap;
  }

  .hn-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .hn-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font);
    font-size: .68rem;
    color: var(--tx-mut);
    font-weight: 500;
    text-transform: lowercase;
    letter-spacing: .06em;
  }
  .hn-primary .hn-label { color: var(--reality); }
  .hn-reticle { flex: 0 0 auto; filter: drop-shadow(0 0 3px rgba(var(--reality-rgb), .5)); }

  .hn-val { font-size: 1.35rem; color: var(--tx-val); }

  /* The flagship numeral — OG sizing: clamp(54px, 6.2vw, 80px) desktop,
     dropping to a tighter clamp under 1024px so the hero row never wraps on
     a tablet (`webui-prerefactor` .hero-val breakpoints). */
  .hn-primary .hn-val {
    font-size: clamp(54px, 6.2vw, 80px);
    line-height: 0.95;
    color: var(--reality);
    text-shadow: var(--glow-reality);
    font-variation-settings: 'wght' 500;
  }
  @media (max-width: 1023px) {
    .hn-primary .hn-val { font-size: clamp(42px, 8.5vw, 54px); }
  }
  .hn-val.glow {
    color: var(--reality);
    text-shadow: var(--glow-reality);
  }

  /* Commanded/desired value: intent purple, no bloom (OG #heroCmd). */
  .hn-intent {
    color: var(--intent);
    text-shadow: none;
  }

  /* The typeable target wears Field.svelte's typeable-chip recess at rest and
     while typing, one box for both, so editable looks editable and the swap
     moves nothing. */
  .hn-entry {
    box-sizing: content-box;
    margin: 0;
    padding: 0 6px 0 5px;
    font-size: 1.35rem;
    line-height: 1.2;
    text-align: left;
    background: var(--screen);
    box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6);
    border: 1px solid var(--line-1);
    border-radius: var(--r-s);
    cursor: text;
    appearance: textfield;
  }
  .hn-entry:hover:not([aria-disabled='true'], :focus) { border-color: var(--line-4); }
  .hn-entry:focus-visible, input.hn-entry:focus { outline: none; border-color: var(--highlight); }
  .hn-entry[aria-disabled='true'] { opacity: .45; cursor: default; }
  .hn-entry::-webkit-inner-spin-button, .hn-entry::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

  /* Virtual (DESIGN §10.10): a frozen snapshot measured nothing, so the
     reality voice becomes the intent family, unlit (ph-6n0). */
  .hero-numerals.virtual { --reality: var(--intent); --reality-rgb: var(--intent-rgb); --glow-reality: none; }

  .hero-numerals.stale .hn-primary .hn-val {
    color: var(--tx-ghost);
    text-shadow: none;
  }

  /* Speed is the only numeral with its unit still riding beside the value
     (OG: unit baked directly into the padded string) — primary/commanded/lag
     carry their unit once, in the label above, per the reference. */
  .hn-unit {
    font-family: var(--font);
    font-size: .5em;
    color: var(--tx-mut);
    margin-left: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    .hn-val { transition: none; }
  }
</style>
