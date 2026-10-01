<script>
  /**
   * Control.svelte: renders one placeable control (DESIGN §10.2) from a
   * settings.js placeableControls() entry, at a size in grid cells.
   *
   * Constraints:
   * - `look` is the placement's saved {pres, min, max, step, default, a, b}
   *   (grid.js setLook), applied by settings.js placementLook. A saved
   *   presentation the field no longer offers (the catalog changed) falls
   *   back to the derived widget; it never renders a presentation the field's
   *   facts do not support, and a refused config part keeps the catalog's.
   * - Orientation is the control's own aspect (orientationOf), recomputed on
   *   resize without remounting, so an in-flight write survives the flip.
   */
  import Field from '../Field.svelte';
  import ActionField from '../ActionField.svelte';
  import SafetyOp from './SafetyOp.svelte';
  import { WIDGET, orientationOf, placementLook } from '../../model/settings.js';

  let { control, look = null, w = 1, h = 1 } = $props();

  const orientation = $derived(orientationOf(w, h));
  const applied = $derived(control.kind === 'field' && control.field.widget !== WIDGET.action
    ? placementLook(control.field, look) : null);
</script>

{#if control.kind === 'field'}
  {#if !applied}
    <ActionField action={control.field} />
  {:else}
    <Field field={applied.field} presentation={applied.pres} {orientation} />
  {/if}
{:else if control.kind === 'safety'}
  <SafetyOp action={control.action} op={control.op} />
{:else}
  <control.hero.component fields={control.hero.fields} hero={control.hero} />
{/if}
