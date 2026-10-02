<script>
  /**
   * ActionField.svelte — the generic `trigger` archetype (RENDERING §8.2 row
   * 6): one button per op of an `action.*` field, from the catalog alone.
   *
   * Constraints:
   * - Index 0 of an op table is never an operation (SPEC §8.9): not drawn.
   * - Gated ops gray with their reason in words (law 3), never hidden.
   * - Confirm posture is actions.js's, routed through the overlay layer.
   * - The press shows the shadow ladder (pending/overdue/fault/confirmed) in
   *   words; "confirmed" means the hub's ECHO, never the tap.
   * - Payload inputs are the operator's draft for the NEXT press, not device
   *   state; an empty input omits its key and the hub decides.
   */
  import { machine, getSession } from '../model/machine.svelte.js';
  import { runAction, statusOf, shadowOf } from '../model/shadow.svelte.js';
  import { labelFor, optionLabel } from '../model/format.js';
  import { needsConfirm, confirmCopy } from '../model/actions.js';
  import { askConfirm } from './confirm.svelte.js';
  import { CBOR_FIELD } from '../../../Valence/clients/js/frames.js';

  let { action } = $props();

  const opLabel = (i) => optionLabel(action, i).replace(/_/g, ' ');
  const ops = $derived(action.options
    ? action.options.map((_, i) => ({ value: i, label: opLabel(i) })).slice(1)
    : [{ value: action.type === CBOR_FIELD.bool_t ? true : 1, label: labelFor(action) }]);

  const status = $derived(statusOf(action));
  const sh = $derived(shadowOf(action));

  let draft = $state({});

  function reasonFor(v) {
    void machine.link.roles; void machine.catalog.ready;
    if (machine.link.phase !== 'live') return 'no hub link';
    const s = getSession();
    if (!s || !s.canUse(action.channelId, action.key, v)) return 'this session is not authorized for this op';
    return '';
  }
  const reasons = $derived([...new Set(ops.map((o) => reasonFor(o.value)).filter(Boolean))]);

  function payloadFields() {
    const out = {};
    for (const p of action.payload || []) {
      const raw = draft[p.key];
      if (raw === undefined || raw === '') continue;
      out[p.key] = p.type === CBOR_FIELD.tstr_t ? String(raw)
        : p.type === CBOR_FIELD.bool_t ? !!raw : Number(raw);
    }
    return Object.keys(out).length ? out : null;
  }

  async function press(v) {
    if (reasonFor(v)) return;
    if (needsConfirm(action, v) && !(await askConfirm(confirmCopy(action, v)))) return;
    const fields = payloadFields();
    // A secret is sent once and never kept on screen (RFC-009.4).
    for (const p of action.payload || []) if (p.secret) delete draft[p.key];
    runAction(action, v, fields);
  }

  const statusText = $derived(
    status === 'pending' ? 'waiting for the machine'
    : status === 'overdue' ? 'still waiting for the machine'
    : status === 'fault' ? sh && sh.error
    : sh && sh.settled ? 'confirmed' + (action.options && sh.applied != null ? ': ' + opLabel(sh.applied) : '')
    : ''
  );
</script>

<div class="field action" data-shadow={status}>
  <span class="field-label">{labelFor(action)}</span>
  {#if action.desc}<p class="hint">{action.desc}</p>{/if}

  {#each (action.payload || []).filter((p) => p.type !== CBOR_FIELD.bstr_t) as p (p.key)}
    <label class="payload">
      <span>{p.label}{p.unit ? ' (' + p.unit + ')' : ''}</span>
      {#if p.type === CBOR_FIELD.bool_t}
        <input type="checkbox" checked={!!draft[p.key]}
               onchange={(e) => (draft[p.key] = e.currentTarget.checked)} />
      {:else if p.type === CBOR_FIELD.tstr_t}
        <!-- RFC-009.4: a secret payload masks like Field's secret widget. -->
        <input type={p.secret ? 'password' : 'text'} autocomplete={p.secret ? 'new-password' : undefined}
               value={draft[p.key] ?? ''}
               oninput={(e) => (draft[p.key] = e.currentTarget.value)} />
      {:else}
        <input type="number" min={p.min} max={p.max}
               step={p.type === CBOR_FIELD.f32_t ? 'any' : 1} value={draft[p.key] ?? ''}
               oninput={(e) => (draft[p.key] = e.currentTarget.value)} />
      {/if}
    </label>
  {/each}

  <div class="ops">
    {#each ops as op (op.value)}
      <button type="button" class="og-btn" disabled={!!reasonFor(op.value)}
              title={reasonFor(op.value) || op.label} onclick={() => press(op.value)}>{op.label}</button>
    {/each}
  </div>
  <!-- One fixed line for the ladder, else the gate (laws 3, 5): no state
       changes the card's height. -->
  <p class="hint state" class:why={!statusText} role="status"
     title={statusText || reasons.join('; ') || undefined}>{statusText || reasons.join('; ')}</p>
</div>

<style>
  .action { display: flex; flex-direction: column; gap: 6px; }
  .field-label { color: var(--ink); font-size: .85rem; }
  .ops { display: flex; flex-wrap: wrap; gap: 6px; }
  .ops button { min-height: var(--tap); padding: 0 14px; text-transform: capitalize; }
  .payload { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .8rem; color: var(--ink-dim); }
  .payload input[type='number'], .payload input[type='text'], .payload input[type='password'] { min-height: var(--tap); width: 12ch; }
  .hint { margin: 0; color: var(--ink-dim); font-size: .78rem; }
  .state { min-height: 1.45em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .why { color: var(--ink-faint); }
  .action[data-shadow='fault'] .state { color: var(--warn); }
  .action[data-shadow='overdue'] .state { color: var(--warn); }
</style>
