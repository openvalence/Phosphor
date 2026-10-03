<script>
  // One field in each requested presentation, plus one Control (the placeable
  // wrapper) whose size the test drives through window.__size, plus one
  // ActionField whose text payloads are marked secret (ph-vic).
  import Field from '../../src/ui/Field.svelte';
  import ActionField from '../../src/ui/ActionField.svelte';
  import Control from '../../src/ui/widgets/Control.svelte';
  import ConfirmLayer from '../../src/ui/ConfirmLayer.svelte';
  import { machine, specSafetyAction } from '../../src/model/machine.svelte.js';
  import { placeableControls } from '../../src/model/settings.js';
  import { CBOR_FIELD } from '../../../Valence/clients/js/frames.js';

  let { uid, pres, action, more = [] } = $props();

  const model = $derived(machine.catalog.model);
  const field = $derived(model && model.fields.find((f) => f.uid === uid));
  // `more`: extra cells, each one presentation of another field ('pres@uid'),
  // or a placement with a look ('pres@uid@min=1;max=9' or '...@a=1;b=2'),
  // drawn through Control as the home draws it.
  const extra = $derived(model ? more.map((m) => {
    const [p, u, l] = m.split('@');
    const look = l ? { pres: p, ...Object.fromEntries(l.split(';').map((kv) => kv.split('='))) } : null;
    return { key: m, pres: p, look, field: model.fields.find((f) => f.uid === u) };
  }).filter((x) => x.field) : []);
  const control = $derived(model && placeableControls(model).find((c) => c.field && c.field.uid === uid));
  const act = $derived.by(() => {
    const a = model && action && model.actions.find((x) => x.uid === action);
    return a && { ...a, payload: a.payload.map((p) => (p.type === CBOR_FIELD.tstr_t ? { ...p, secret: true } : p)) };
  });

  const stop = $derived(model && placeableControls(model, { safety: specSafetyAction() })
    .find((c) => c.key === 'safety:pause'));

  let size = $state({ w: 4, h: 4 });
  window.__size = (w, h) => { size = { w, h }; };
</script>

{#if field}
  <div class="row">
    {#each pres as p (p)}
      <div class="cell" data-pres={p}><Field {field} presentation={p} /></div>
    {/each}
  </div>
  {#if control}
    <div class="cell sized" data-pres="control" style="width: {size.w * 48}px; height: {size.h * 48}px">
      <Control {control} look={{ pres: 'slider' }} w={size.w} h={size.h} />
    </div>
  {/if}
{/if}
{#if extra.length}
  <div class="row">
    {#each extra as x (x.key)}
      <div class="cell" data-pres={x.key}>
        {#if x.look}<Control control={{ kind: 'field', field: x.field }} look={x.look} />
        {:else}<Field field={x.field} presentation={x.pres} />{/if}
      </div>
    {/each}
  </div>
{/if}
<ConfirmLayer />
{#if stop}
  <div class="cell" data-pres="safety"><Control control={stop} w={3} h={2} /></div>
{/if}
{#if act}
  <div class="cell" data-pres="action"><ActionField action={act} /></div>
{/if}

<style>
  .row { display: flex; flex-wrap: wrap; gap: 16px; padding: 16px; }
  .cell { width: 280px; padding: 8px; }
  .cell.sized { width: auto; margin: 16px; }
</style>
