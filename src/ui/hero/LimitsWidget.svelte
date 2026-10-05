<script>
  /**
   * LimitsWidget.svelte — the two kinematic ceilings: jog (manual) and
   * machine-driven (input). Renders each knob through Field.svelte (OG .fld2
   * compact grid, same recipe as PatternWidget) instead of a hand-rolled
   * slider — one slider aesthetic for the whole app, one home for a field's
   * description (behind its own ⓘ, not restated here).
   *
   * The input-set group is opportunistic: a machine with no machine-driven
   * motion source simply never annotates those roles, and the whole second
   * group disappears rather than showing three permanently-empty sliders.
   */
  import Field from '../Field.svelte';

  let { fields } = $props();
  // Read through the prop rather than destructuring once — heroes.js hands us
  // a fresh `fields` object whenever the catalog rebuilds.
  const jogSpeed = $derived(fields.jogSpeed);
  const jogAccel = $derived(fields.jogAccel);
  const inputSpeed = $derived(fields.inputSpeed);
  const inputAccel = $derived(fields.inputAccel);
  const inputJerk = $derived(fields.inputJerk);

  const jogKnobs = $derived([jogSpeed, jogAccel].filter((f) => f != null));
  const inputKnobs = $derived(
    [inputSpeed, inputAccel, inputJerk].filter((f) => f != null)
  );
</script>

<div class="hero limits-hero">
  <p class="hint">Ceilings, not targets</p>
  <div class="card-body">
    <h3 class="card-sub">Jog limits</h3>
    {#each jogKnobs as f (f.uid)}
      <Field field={f} />
    {/each}
    {#if inputKnobs.length}
      <h3 class="card-sub">Machine-driven limits</h3>
      {#each inputKnobs as f (f.uid)}
        <Field field={f} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .hero {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--gap);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .hint {
    margin: 0;
    color: var(--ink-dim);
    font-size: 0.78rem;
  }
</style>
