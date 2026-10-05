<script module>
  let seq = 0;
</script>

<script>
  /**
   * LookEditor.svelte: one placed field control's presentation and its
   * per-placement config (DESIGN §10.2): min, max, step and default for a
   * range presentation, the two values a toggle writes. Home edit mode only.
   *
   * Constraints:
   * - Writes the placement's look only (grid.js setLook), never the machine.
   * - settings.js placementLook is the one rule: a refused part is named here
   *   in words, in one fixed warn line, on the inputs it names
   *   (aria-invalid); the control keeps the catalog's value for it.
   * - An emptied input clears that part back to the catalog's.
   * - A popover, never inline (ph-wia): it takes no room in the card, so
   *   edit mode measures and draws the card as it runs. DashItem opens it
   *   (its head's look tool, Enter on the grip) and anchors it to the card
   *   through the inherited `--card` anchor name.
   */
  import { placementLook, WIDGET } from '../model/settings.js';
  import { labelFor } from '../model/format.js';

  let { control, look = null, onchange } = $props();

  const id = 'look-' + ++seq;
  const f = $derived(control.field);
  const cur = $derived(placementLook(f, look));
  const set = (patch) => onchange({ ...(look || {}), ...patch });
  const val = (e) => (e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value));
  const RANGE_PARTS = [['min', 'Min', 'min'], ['max', 'Max', 'max'], ['step', 'Step', 'step'], ['default', 'Default', 'dflt']];
  // The parts each refusal names, by its first word (placementLook's errors).
  const NAMES = { range: ['min', 'max'], step: ['step'], default: ['default'], toggle: ['a', 'b'] };
  const bad = $derived(new Set(cur.errors.flatMap((e) => NAMES[e.split(' ')[0]] || [])));
  const warn = $derived(cur.errors.join('; '));
</script>

{#if f.widget !== WIDGET.action && (control.presentations.length > 1 || cur.kind)}
  <div class="look og-panel" {id} popover role="group" aria-label={'Look of ' + labelFor(f)}>
    {#if control.presentations.length > 1}
      <select class="og-btn sm look-pres" aria-label={'Presentation of ' + labelFor(f)} value={cur.pres}
              onchange={(e) => set({ pres: e.currentTarget.value })}>
        {#each control.presentations as p (p)}<option value={p}>{p}</option>{/each}
      </select>
    {/if}
    {#if cur.kind === 'range'}
      {#each RANGE_PARTS as [k, label, own] (k)}
        <label>{label}
          <input type="number" step="any" value={look?.[k] ?? ''} placeholder={f[own] ?? ''}
                 aria-label={label + ' of ' + labelFor(f)} aria-invalid={bad.has(k)} aria-describedby={id + '-warn'}
                 onchange={(e) => set({ [k]: val(e) })} />
        </label>
      {/each}
    {:else if cur.kind === 'toggle'}
      {#each [['a', 'Off writes'], ['b', 'On writes']] as [k, label] (k)}
        <label>{label}
          <input type="number" step="any" value={look?.[k] ?? ''} placeholder={cur.toggle[k]}
                 aria-label={label + ', ' + labelFor(f)} aria-invalid={bad.has(k)} aria-describedby={id + '-warn'}
                 onchange={(e) => set({ [k]: val(e) })} />
        </label>
      {/each}
    {/if}
    {#if cur.kind}
      <p class="look-warn" id={id + '-warn'} title={warn}>{warn}</p>
    {/if}
  </div>
{/if}

<style>
  /* Anchored under the card's head where anchor positioning exists; the
     popover's centered default elsewhere. */
  .look {
    position: fixed;
    grid-template-columns: auto auto;
    align-items: center;
    gap: var(--sp-2) var(--sp-4);
    padding: var(--sp-3);
    max-width: calc(100vw - 32px);
    font-size: .8rem;
    color: var(--ink-dim);
  }
  .look:popover-open { display: grid; }
  @keyframes fade-in { from { opacity: 0; } }
  :global(html:not(.still)) .look:popover-open { animation: fade-in var(--t-quick, 120ms) var(--ease-out, ease-out); }
  @supports (top: anchor(top)) {
    .look {
      position-anchor: var(--card);
      inset: auto;
      top: calc(anchor(top) + var(--sp-5) + var(--sp-3));
      left: anchor(left);
      margin: 0;
      position-try-fallbacks: flip-block, flip-inline;
    }
  }
  .look-pres { grid-column: 1 / -1; justify-self: start; }
  .look label { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
  .look input {
    width: 6em;
    padding: var(--sp-2) var(--sp-2);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
  }
  /* A refusal is the fault color on the part it names; amber, never red (law 13). */
  .look input[aria-invalid='true'] { border-color: var(--warn); }
  /* One line, always there, never widening the panel: a refusal appearing
     moves nothing. */
  .look-warn {
    grid-column: 1 / -1;
    width: 0;
    min-width: 100%;
    height: 1.4em;
    margin: 0;
    color: var(--warn);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (pointer: coarse) { .look input { min-height: 40px; } }
</style>
