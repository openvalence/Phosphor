<script>
  /**
   * ProvisionWizard.svelte: the `wizard` pattern (RENDERING §10) over the
   * provisioning category, in the overlay region (§9).
   *
   * Constraints:
   * - Steps come from wizard/steps.js, never a per-hub page (§11).
   * - Every control is Field or ActionField, so each keeps the §8.1 ladder
   *   and its gray reasons. This file never writes and never holds a value.
   * - No scrim, no inert, no focus trap: the top strip's stop stays reachable
   *   by pointer and by Tab mid-ceremony (§8.4 stop row).
   * - Closing hands back to the normal UI; the same fields live on their
   *   category page, and writes still in flight stay visible there.
   */
  import { tick } from 'svelte';
  import Field from './Field.svelte';
  import ActionField from './ActionField.svelte';
  import { WIDGET } from '../model/settings.js';
  import { statusOf, STATUS } from '../model/shadow.svelte.js';
  import { wizardSteps } from './wizard/steps.js';
  import { confirmUi } from './confirm.svelte.js';

  let { category, onclose } = $props();

  const steps = $derived(wizardSteps(category));
  let at = $state(0);
  const idx = $derived(Math.min(at, Math.max(0, steps.length - 1)));
  const step = $derived(steps[idx] || null);
  const last = $derived(idx === steps.length - 1);

  const REASON = {
    [STATUS.fault]: 'a write here was refused or never answered; the field says why',
    [STATUS.overdue]: 'still waiting on the machine to confirm a write',
    [STATUS.pending]: 'waiting on the machine to confirm a write',
  };
  function stepStatus(s) {
    const all = s.fields.flatMap((f) => (f.widget === WIDGET.range ? [f.lo, f.hi] : [f])).map(statusOf);
    return [STATUS.fault, STATUS.overdue, STATUS.pending].find((x) => all.includes(x)) || STATUS.confirmed;
  }
  const status = $derived(step ? stepStatus(step) : STATUS.confirmed);

  let card = $state(null);
  $effect(() => {
    const opener = document.activeElement;
    return () => { if (opener && opener.isConnected) opener.focus(); };
  });
  $effect(() => {
    void idx;
    tick().then(() => card?.focus());
  });

  function go(d) { at = idx + d; }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !confirmUi.req) onclose(); }} />

<div class="wizard" bind:this={card} role="dialog" tabindex="-1" aria-labelledby="wz-title">
  <header>
    <h2 id="wz-title">{category.label}</h2>
    {#if step}<span class="count mono">Step {idx + 1} of {steps.length}</span>{/if}
  </header>

  {#if !step}
    <p class="note">This hub no longer advertises anything to set up here.</p>
  {:else}
    <ol class="rail">
      {#each steps as s, i (s.id)}
        <li class:on={i === idx}>
          <button type="button" class="og-btn sm" data-shadow={stepStatus(s)} aria-current={i === idx ? 'step' : undefined}
                  onclick={() => (at = i)}>{s.title}</button>
        </li>
      {/each}
    </ol>
    <h3>{step.title}</h3>
    <div class="body">
      {#each step.fields as f (f.uid)}
        {#if f.widget === WIDGET.action}<ActionField action={f} />{:else}<Field field={f} />{/if}
      {/each}
    </div>
    {#if REASON[status]}<p class="status" role="status">This step is {REASON[status]}.</p>{/if}
  {/if}

  <div class="acts">
    <button type="button" class="og-btn" onclick={onclose}>Close</button>
    {#if step && idx > 0}<button type="button" class="og-btn" onclick={() => go(-1)}>Back</button>{/if}
    {#if step && !last}
      <button type="button" class="og-btn primary" onclick={() => go(1)}>Next</button>
    {:else if step}
      <button type="button" class="og-btn primary" onclick={onclose}>Done</button>
    {/if}
  </div>
</div>

<style>
  /* ConfirmLayer's band, one layer under it so a confirm raised from a step
     sits on top; below the top strip (z 30), so its stop is never covered. */
  .wizard {
    position: fixed;
    z-index: 28;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(calc(100vw - 2 * var(--gap)), 560px);
    max-height: 60dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(0, 0, 0, .6);
  }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h2 { margin: 0; font-size: 1rem; color: var(--ink-hi); }
  h3 { margin: 0; font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-dim); }
  .count { color: var(--ink-faint); font-size: .8rem; }
  .note, .status { margin: 0; color: var(--ink-dim); font-size: .875rem; }
  .rail { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .rail li.on .og-btn { color: var(--ink-hi); border-color: var(--line-3); }
  .body { display: grid; gap: 14px; }
  .acts { display: flex; gap: 8px; justify-content: flex-end; }
  .acts button { min-height: var(--tap); min-width: var(--tap); padding: 0 16px; }
</style>
