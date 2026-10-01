<script>
  /**
   * Control.svelte: renders one placeable control (DESIGN §10.2) from a
   * settings.js placeableControls() entry, at a size in grid cells.
   *
   * Constraints:
   * - A saved presentation the field no longer offers (the catalog changed)
   *   falls back to the derived widget; it never renders a presentation the
   *   field's facts do not support.
   * - Orientation is the control's own aspect (orientationOf), recomputed on
   *   resize without remounting, so an in-flight write survives the flip.
   */
  import Field from '../Field.svelte';
  import ActionField from '../ActionField.svelte';
  import SafetyOp from './SafetyOp.svelte';
  import { WIDGET, orientationOf } from '../../model/settings.js';

  let { control, presentation = null, w = 1, h = 1 } = $props();

  const orientation = $derived(orientationOf(w, h));
  const pres = $derived(control.presentations && control.presentations.includes(presentation)
    ? presentation : control.presentations && control.presentations[0]);
</script>

{#if control.kind === 'field'}
  {#if control.field.widget === WIDGET.action}
    <ActionField action={control.field} />
  {:else}
    <Field field={control.field} presentation={pres} {orientation} />
  {/if}
{:else if control.kind === 'safety'}
  <SafetyOp action={control.action} op={control.op} />
{:else}
  <control.hero.component fields={control.hero.fields} hero={control.hero} />
{/if}
