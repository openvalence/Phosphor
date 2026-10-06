<script>
  /**
   * ToyModule.svelte: one buttplug toy as a placeable module (DESIGN §10.8),
   * one control per feature. SHELL ONLY: mounted by src/plugins/buttplug.js
   * into a plugin-hero slot.
   *
   * Constraints:
   * - Logic lives in src/plugins/buttplug-toys.js (createToy): values shown are
   *   what the server applied, the ladder is in words under each control.
   * - Not on the strip e-stop: this module's Stop is the toy's stop. Red is for
   *   hub safety only (law 13), so faults are amber text.
   */
  import { onMount, untrack } from 'svelte';
  import { blankToy, createToy, shown } from '../../plugins/buttplug-toys.js';

  let { toy, shell } = $props();
  const t0 = untrack(() => toy);
  const s = $state(blankToy(t0));
  const t = createToy(s, t0, untrack(() => shell));
  onMount(() => { t.init(); return t.dispose; });

  // Duration per linear control: the operator's input, not a reading.
  const ms = $state(Object.fromEntries(t0.controls.filter((c) => c.kind === 'linear')
    .map((c) => [c.feature, Math.min(c.ms[1], Math.max(c.ms[0], 500))])));

  const key = (c) => c.feature + ':' + c.type;
  const label = (c) => c.description || c.type;
</script>

<div class="toy">
  <div class="toy-head">
    <span class="toy-name">{toy.name}</span>
    <button type="button" class="og-btn toy-stop"
            disabled={s.stop.phase === 'pending'} onclick={t.stop}>Stop</button>
  </div>
  <p class="toy-ladder" data-phase={s.stop.phase} role="status">{s.stop.reason || 'not on the strip e-stop'}</p>

  {#each toy.controls as c (key(c))}
    {@const w = s.ctl[key(c)]}
    {@const v = shown(w)}
    <div class="toy-ctl" data-shadow={w.phase === 'pending' || w.phase === 'overdue' ? w.phase : null}>
      <div class="toy-row">
        <span class="toy-label">{label(c)}</span>
        <output class="mono" class:stale={w.stale}>{v == null ? (c.kind === 'sensor' ? 'no reading yet' : 'no value yet') : v}</output>
      </div>
      {#if c.kind !== 'sensor'}
        <div class="toy-row">
          <input type="range" min={c.range[0]} max={c.range[1]} step="1"
                 value={v ?? (c.kind === 'rotate' ? 0 : c.range[0])} aria-label={label(c)}
                 oninput={(e) => t.send(c, Number(e.currentTarget.value), ms[c.feature])} />
          {#if c.kind === 'linear'}
            <label class="toy-ms mono">ms
              <input type="number" min={c.ms[0]} max={c.ms[1]} step="1" bind:value={ms[c.feature]} />
            </label>
          {:else}
            <button type="button" class="og-btn" onclick={() => t.send(c, 0)}>Off</button>
          {/if}
        </div>
      {/if}
      <p class="toy-ladder" data-phase={w.phase} role="status">{w.reason}</p>
    </div>
  {/each}
</div>

<style>
  .toy { display: flex; flex-direction: column; gap: var(--sp-2); height: 100%; overflow: auto; }
  .toy-head, .toy-row { display: flex; align-items: center; gap: var(--sp-3); }
  .toy-name { flex: 1 1 auto; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toy-ctl { padding: var(--sp-2) var(--sp-2); border-radius: var(--radius); }
  .toy-label { flex: 1 1 auto; color: var(--ink-dim); font-size: .82rem; }
  .toy-row input[type='range'] { flex: 1 1 auto; min-height: var(--tap); }
  .toy-ms { display: flex; align-items: center; gap: var(--sp-2); font-size: .75rem; color: var(--ink-dim); }
  .toy-ms input { width: 6em; min-height: var(--tap); }
  .stale { opacity: .45; }
  .toy-ladder { margin: 0; min-height: 1.2em; font-size: 11px; color: var(--ink-dim); }
  .toy-ladder[data-phase='overdue'], .toy-ladder[data-phase='fault'] { color: var(--warn); }
</style>
