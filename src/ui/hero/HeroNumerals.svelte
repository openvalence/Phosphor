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
   * own to claim. TopStrip composes it from RailWidget's readout.
   *
   * Every number is `posVal`/`speedVal`/`targetVal` as the readout hands it:
   * the newest sample itself (a speed with no velocity field is the rail's
   * telebuf derivative), never interpolated, never fabricated. This
   * component does no ground-truth reading of its own.
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
   * Enter goes through `jog`, RailWidget's one jog handle: the tape's own
   * send, clamped to the tape's own domain; the tape's gate disables it with
   * the tape's words. Never a second wire path, never a wider domain.
   */
  import { tick } from 'svelte';
  import { unitOf, precisionFor, labelFor } from '../../model/format.js';
  import { machine, freshness, staleReason } from '../../model/machine.svelte.js';

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
    // RailWidget's jog handle {send, enabled, reason, lo, hi, windowed}; null: no rail.
    jog = null,
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

  const jogWhy = $derived(jog?.enabled ? '' : jog?.reason || 'no move intent on this catalog');

  let editing = $state(false);
  let editEl = $state(null);
  let btnEl = $state(null);
  let noteT = null;
  let editW = $state(0);

  async function openEdit() {
    if (jogWhy) return;
    editW = btnEl.getBoundingClientRect().width;
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
      const v = Math.min(Math.max(jog.lo, jog.hi), Math.max(Math.min(jog.lo, jog.hi), typed));
      jog.send(v);
      clearTimeout(noteT);
      onnote?.(v !== typed ? 'clamped to ' + (jog.windowed ? 'window' : 'travel') : '');
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

  <div class="hn-col">
  {#if targetField}
    <div class="hn-item hn-secondary">
      <span class="hn-label">{labelFor(targetField).toLowerCase()}</span>
      {#if editing}
        <input class="hn-val mono hn-intent hn-entry" type="number" step="any" bind:this={editEl}
               style="width:{editW}px" aria-label={'Jog target, ' + (unitOf(targetField) || 'position')}
               onkeydown={onEditKey} onblur={() => closeEdit(false)} />
      {:else}
        <button type="button" class="hn-val mono hn-intent hn-entry" bind:this={btnEl}
                aria-disabled={!!jogWhy} title={jogWhy || 'Click to type a target'} onclick={openEdit}>{commandedText}</button>
      {/if}
      <span class="hn-unit">{unitOf(targetField)}</span>
    </div>

    <!-- "lag" has no role of its own (roles.js: it is target - position,
         computed client-side) — there is no field to resolve a label from,
         so this stays a plain string rather than a fabricated ROLE_LABEL
         entry. -->
    <div class="hn-item hn-secondary">
      <span class="hn-label">lag</span>
      <span class="hn-val mono">{lagText}</span>
      <span class="hn-unit">{unitOf(targetField)}</span>
    </div>
  {/if}

  <div class="hn-item hn-secondary">
    <!-- Same treatment as the speed VALUE above: labeled from velField when
         the machine annotated telemetry.velocity, else the plain fallback
         (this number is client-derived from position, not its own field). -->
    <span class="hn-label">{velField ? labelFor(velField).toLowerCase() : 'speed'}</span>
    <span class="hn-val mono">{speedText}</span>
    <span class="hn-unit">{speedUnit}</span>
  </div>
  </div>
</div>

<style>
  .hero-numerals {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-5);
  }

  /* Planned target, lag, speed: one column of "label value unit" rows beside
     the big numeral, at every width. The rows share three grid columns; their
     height is the primary numeral's box (the strip's --num-h less its label
     line), so the column never grows the strip and clears the plan readback
     on the label line. */
  .hn-col {
    display: grid;
    grid-template-columns: max-content max-content max-content;
    align-items: baseline;
    column-gap: var(--sp-2);
    align-self: flex-end;
  }
  .hn-col .hn-secondary { display: contents; }
  .hn-col .hn-val { font-size: min(1.35rem, calc((var(--num-h, 96px) - 20px) / 3.4)); line-height: 1; }
  .hn-col .hn-label, .hn-col .hn-unit { line-height: 1; }
  .hn-col .hn-entry { height: 1em; }
  /* The touch target reaches 40 px without growing its row. */
  @media (pointer: coarse) { .hn-col .hn-entry { margin: calc((1em - 40px) / 2) 0; } }

  .hn-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-1);
  }

  .hn-label {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
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
    font-size: min(clamp(54px, 6.2vw, 80px), calc((var(--num-h, 999px) - 20px) / .95));
    line-height: 0.95;
    color: var(--reality);
    text-shadow: var(--glow-reality);
    font-variation-settings: 'wght' 500;
  }
  @media (max-width: 1023px) {
    .hn-primary .hn-val { font-size: min(clamp(42px, 8.5vw, 54px), calc((var(--num-h, 999px) - 20px) / .95)); }
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

  /* The typeable target looks like the plain intent numeral: a hidden
     feature (operator 2026-10-03, ph-akeq). No recess, border or hover box;
     the open input keeps the numeral's box and shows only a caret and an
     underline. */
  .hn-entry {
    box-sizing: content-box;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    line-height: inherit;
    text-align: left;
    cursor: text;
    appearance: textfield;
  }
  .hn-entry:focus-visible { outline: 1px solid var(--highlight); outline-offset: 1px; }
  input.hn-entry:focus { outline: none; box-shadow: 0 1px 0 var(--highlight); }
  .hn-entry[aria-disabled='true'] { cursor: default; }
  /* Touch: the button itself reaches 40 px (the strip is sticky chrome, so a
     pseudo-element hit extension does not count); the primary numeral sets
     the row height, so the row does not grow. */
  @media (pointer: coarse) { .hn-entry { min-height: 40px; } }
  .hn-entry::-webkit-inner-spin-button, .hn-entry::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

  /* Virtual (DESIGN §10.10): a frozen snapshot measured nothing, so the
     reality voice becomes the intent family, unlit (ph-6n0). */
  .hero-numerals.virtual { --reality: var(--intent); --reality-rgb: var(--intent-rgb); --glow-reality: none; }

  .hero-numerals.stale .hn-primary .hn-val {
    color: var(--tx-ghost);
    text-shadow: none;
  }

  /* The rows carry their unit beside the value; the primary carries its
     unit once, in its label. */
  .hn-unit {
    font-family: var(--font);
    font-size: .68rem;
    color: var(--tx-mut);
  }

  :global(html.still) {
    .hn-val { transition: none; }
  }
</style>
