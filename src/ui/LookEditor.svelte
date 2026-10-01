<script>
  /**
   * LookEditor.svelte: one placed field control's presentation and its
   * per-placement config (DESIGN §10.2): min, max, step and default for a
   * range presentation, the two values a toggle writes. Home edit mode only.
   *
   * Constraints:
   * - Writes the placement's look only (grid.js setLook), never the machine.
   * - settings.js placementLook is the one rule: a refused part is named here
   *   in words and the control keeps the catalog's value for it.
   * - An emptied input clears that part back to the catalog's.
   */
  import { placementLook, WIDGET } from '../model/settings.js';
  import { labelFor } from '../model/format.js';

  let { control, look = null, onchange } = $props();

  const f = $derived(control.field);
  const cur = $derived(placementLook(f, look));
  const set = (patch) => onchange({ ...(look || {}), ...patch });
  const val = (e) => (e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value));
  const RANGE_PARTS = [['min', 'Min', 'min'], ['max', 'Max', 'max'], ['step', 'Step', 'step'], ['default', 'Default', 'dflt']];
</script>

{#if f.widget !== WIDGET.action && (control.presentations.length > 1 || cur.kind)}
  <div class="look" role="group" aria-label={'Look of ' + labelFor(f)}>
    {#if control.presentations.length > 1}
      <select class="og-btn sm" aria-label={'Presentation of ' + labelFor(f)} value={cur.pres}
              onchange={(e) => set({ pres: e.currentTarget.value })}>
        {#each control.presentations as p (p)}<option value={p}>{p}</option>{/each}
      </select>
    {/if}
    {#if cur.kind === 'range'}
      {#each RANGE_PARTS as [k, label, own] (k)}
        <label>{label}
          <input type="number" step="any" value={look?.[k] ?? ''} placeholder={f[own] ?? ''}
                 aria-label={label + ' of ' + labelFor(f)} onchange={(e) => set({ [k]: val(e) })} />
        </label>
      {/each}
    {:else if cur.kind === 'toggle'}
      {#each [['a', 'Off writes'], ['b', 'On writes']] as [k, label] (k)}
        <label>{label}
          <input type="number" step="any" value={look?.[k] ?? ''} placeholder={cur.toggle[k]}
                 aria-label={label + ', ' + labelFor(f)} onchange={(e) => set({ [k]: val(e) })} />
        </label>
      {/each}
    {/if}
    {#each cur.errors as err (err)}<p class="field-reason">{err}</p>{/each}
  </div>
{/if}

<style>
  .look {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-bottom: 8px;
    font-size: .8rem;
    color: var(--ink-dim);
  }
  .look label { display: flex; align-items: center; gap: 4px; }
  .look input {
    width: 6em;
    padding: 4px 6px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
  }
  .look .field-reason { flex-basis: 100%; margin: 0; }
</style>
