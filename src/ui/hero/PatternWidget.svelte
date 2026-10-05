<script>
  /**
   * PatternWidget.svelte — the built-in pattern generator, as a start/stop
   * control plus a pattern-tile grid plus whichever knobs the machine publishes.
   *
   * `running` and `select` are guaranteed by the claim spec in heroes.js; the
   * four knobs (speed/depth/stroke/sensation) are opportunistic — a machine
   * that only publishes speed still gets a clean card with one slider.
   */
  import { machine } from '../../model/machine.svelte.js';
  import { isFieldEnabled } from '../../model/settings.js';
  import { writeSetting, displayValue, statusOf } from '../../model/shadow.svelte.js';
  import { optionLabel, labelFor } from '../../model/format.js';
  import Field from '../Field.svelte';

  let { fields } = $props();
  // Read through the prop rather than destructuring once — heroes.js hands us
  // a fresh `fields` object whenever the catalog rebuilds.
  const running = $derived(fields.running);
  const select = $derived(fields.select);
  const speed = $derived(fields.speed);
  const depth = $derived(fields.depth);
  const stroke = $derived(fields.stroke);
  const sensation = $derived(fields.sensation);
  const bgRun = $derived(fields.bgRun);

  function sampleOf(f) { return f ? machine.samples[f.channelId] : undefined; }

  // Why a control is gray, in words (law 3); '' when usable. Same reasons,
  // same order, as Field.svelte.
  function reasonOf(f) {
    if (!f || f.readOnly) return 'read-only';
    if (machine.link.phase !== 'live') return 'no hub link';
    const e = machine.catalog.entries.find((x) => x.id === f.writeChannel);
    if (!e || (machine.link.roles | 0) < (e.access | 0)) return 'session not authorized';
    if (!isFieldEnabled(f, sampleOf(f))) return 'disabled by the machine';
    return '';
  }
  const enabledOf = (f) => !reasonOf(f);

  const runningVal = $derived(displayValue(running, sampleOf(running)));
  const isRunning = $derived(!!runningVal);
  const runningEnabled = $derived(enabledOf(running));

  const headReason = $derived(reasonOf(running));

  const selectVal = $derived(displayValue(select, sampleOf(select)));
  const selectEnabled = $derived(enabledOf(select));

  const knobs = $derived(
    [speed, depth, stroke, sensation].filter((f) => f != null)
  );

  // Card-head status sub-label (OG §2.1f, .card-state): "standby" or
  // "running · <pattern name>". The title bar itself belongs to DashItem
  // (this component only owns the card BODY), so this line rides at the top
  // of the body as the closest in-scope stand-in for the OG's title-row chip.
  const patternStateText = $derived(
    isRunning ? 'running · ' + optionLabel(select, Number(selectVal)).toLowerCase() : 'standby'
  );

  function toggleRunning() {
    if (!runningEnabled) return;
    writeSetting(running, isRunning ? 0 : 1);
  }

  function chooseOption(i) {
    if (!selectEnabled || Number(selectVal) === i) return;
    writeSetting(select, i);
  }
</script>

<div class="hero pattern-hero">
  <div class="pattern-topline">
    <span class="pattern-state" data-shadow={statusOf(running)} title={headReason || undefined}>{headReason || patternStateText}</span>
  </div>

  <div class="pattern-head">
    <button type="button" class="run-btn og-btn" class:primary={!isRunning} class:running={isRunning}
            role="switch" aria-checked={isRunning} disabled={!runningEnabled}
            data-shadow={statusOf(running)}
            onclick={toggleRunning}>
      <span class="run-dot" aria-hidden="true"></span>
      <span class="run-text">{isRunning ? 'Stop pattern' : 'Start pattern'}</span>
    </button>
  </div>
  <!-- RENDERING §10.1: co-located with run/stop, the shared switch (Field
       confirms false -> true first). -->
  {#if bgRun}<Field field={bgRun} />{/if}

  {#if select.options && select.options.length}
    <!-- OG .pat-grid/.pat-tile, label-only: a waveform glyph is a catalog/RFC
         candidate (a `glyph` field on the pattern registry entry), never a
         client-invented shape. -->
    <div class="pattern-grid card-body" role="radiogroup" aria-label={labelFor(select)}
         data-shadow={statusOf(select)}>
      {#each select.options as _opt, i}
        <button type="button" class="pat-tile" role="radio" aria-checked={Number(selectVal) === i}
                class:on={Number(selectVal) === i}
                disabled={!selectEnabled}
                onclick={() => chooseOption(i)}>
          <span class="pat-tile-label">{optionLabel(select, i)}</span>
        </button>
      {/each}
    </div>
    {#if select.desc}<p class="hint">{select.desc}</p>{/if}
  {/if}

  {#if knobs.length}
    <div class="card-body">
      {#each knobs as f (f.uid)}
        <Field field={f} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .hero {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--gap);
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  /* Card-state chip — OG .card-state: mono, small, ghost-gray ALWAYS (the
     text itself carries "standby" vs "running", the color does not). */
  .pattern-topline {
    display: flex;
    justify-content: flex-end;
  }
  .pattern-state {
    min-height: 1em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--mono);
    font-weight: var(--num-wght);
    font-variation-settings: 'wdth' 90;
    font-size: .64rem;
    letter-spacing: .04em;
    color: var(--tx-ghost);
    white-space: nowrap;
  }

  .pattern-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
  }

  /* Chrome (border/color/disabled/hover) comes from the global .og-btn /
     .og-btn.primary / .og-btn.running utilities — restating those here would
     fork the recipe. This only opts back into full width (og-btn is
     width:auto by design) and matches the OG's #patStartBtn letter-spacing +
     padding, which apply unconditionally, running or not. */
  .run-btn {
    width: 100%;
    justify-content: center;
    gap: var(--sp-3);
    padding: var(--sp-4);
    letter-spacing: .14em;
    text-transform: uppercase;
  }

  .run-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--ink-faint);
  }
  /* .primary (idle) glows reality, .running glows warn — currentColor picks
     up whichever the button is currently wearing, so the dot never drifts
     out of sync with the border/text. */
  .run-btn.primary .run-dot,
  .run-btn.running .run-dot {
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
  }
  :global(html:not(.still)) .run-btn.running .run-dot { animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  /* OG .pat-grid/.pat-tile — bordered label tiles, responsive rather than
     the OG's fixed 4-column grid (dashboard cards here are user-resizable,
     the OG's Pattern card was not). */
  /* Tiles are two layout columns wide and share row height. */
  .pattern-grid {
    --field-floor: 4rem;
    grid-auto-rows: 1fr;
  }
  .pat-tile {
    min-height: var(--tap);
    padding: var(--sp-3) var(--sp-2);
    border-radius: var(--r-s);
    border: 1px solid var(--line-2);
    background: transparent;
    text-align: center;
    transition: border-color var(--t-quick), box-shadow var(--t-move);
  }
  .pat-tile-label {
    display: block;
    font-family: var(--font);
    font-size: 11px;
    letter-spacing: .04em;
    color: var(--tx-mut);
  }
  /* The hub's current pattern in reality, as the segmented control marks its
     option; intent only while a pick is out (ph-zri). */
  .pat-tile.on { border-color: var(--reality); }
  .pat-tile.on .pat-tile-label { color: var(--reality); }
  .pattern-grid:is([data-shadow='pending'], [data-shadow='overdue']) .pat-tile.on { border-color: var(--intent); }
  .pattern-grid:is([data-shadow='pending'], [data-shadow='overdue']) .pat-tile.on .pat-tile-label { color: var(--intent); }
  .pat-tile:disabled { opacity: 0.5; cursor: not-allowed; }


  .hint {
    margin: 0;
    color: var(--ink-dim);
    font-size: 0.78rem;
  }
</style>
