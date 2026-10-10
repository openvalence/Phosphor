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
   *   words and on the ring (style.css GROUND TRUTH); "confirmed" means the
   *   hub's ECHO, never the tap, and lasts as long as its afterglow.
   * - Payload inputs are the operator's draft for the NEXT press, not device
   *   state; an empty input omits its key and the hub decides.
   */
  import { untrack } from 'svelte';
  import { machine, getSession } from '../model/machine.svelte.js';
  import { runAction, statusOf, shadowOf } from '../model/shadow.svelte.js';
  import { labelFor, optionLabel } from '../model/format.js';
  import { needsConfirm, confirmCopy } from '../model/actions.js';
  import { askConfirm } from './confirm.svelte.js';
  import { CBOR_FIELD } from '../../../Valence/clients/js/frames.js';

  let { action, titled = false } = $props();   // titled: the composite supplies the heading

  const opLabel = (i) => optionLabel(action, i).replace(/_/g, ' ');
  const ops = $derived(action.options
    ? action.options.map((_, i) => ({ value: i, label: opLabel(i) })).slice(1)
    : [{ value: action.type === CBOR_FIELD.bool_t ? true : 1, label: labelFor(action) }]);

  const status = $derived(statusOf(action));
  const sh = $derived(shadowOf(action));
  // A virtual hub measured nothing: its echo is not reality (DESIGN §10.10).
  const virtual = $derived(!!machine.link.virtual);

  let draft = $state({});

  // The afterglow, as Field.svelte lights it: alternating per echo, out on the
  // next press, ended (with the word) by its own animationend.
  let glow = $state(0);
  $effect(() => {
    if (status !== 'confirmed') glow = 0;
    else if (sh && sh.settled) glow = untrack(() => glow) === 1 ? 2 : 1;
  });
  const glowEnd = (e) => { if (e.target === e.currentTarget && e.animationName.startsWith('fx-glow')) glow = 0; };

  function reasonFor(v) {
    void machine.link.roles; void machine.catalog.ready;
    if (machine.link.phase !== 'live') return 'no hub link';
    const s = getSession();
    if (!s || !s.canUse(action.channelId, action.key, v)) return 'session not authorized';
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
    : glow ? (virtual ? 'virtual' : 'confirmed') + (action.options && sh.applied != null ? ': ' + opLabel(sh.applied) : '')
    : ''
  );
</script>

<div class="field action" data-uid={action.uid} data-shadow={status} data-glow={glow || undefined}
     data-virtual={virtual || undefined} onanimationend={glowEnd}>
  <!-- One fixed line in the head row for the ladder, else the gate (laws 3,
       5), as Field carries it: no state changes the card's height. -->
  <div class="field-head">
    {#if !titled}<span class="field-label">{labelFor(action)}</span>{/if}
    <span class="state" class:why={!statusText} role="status"
          title={statusText || reasons.join('; ') || undefined}>{statusText || reasons.join('; ')}</span>
  </div>
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
              title={reasonFor(op.value) || undefined} onclick={() => press(op.value)}>{op.label}</button>
    {/each}
  </div>
</div>

<style>
  .action { display: flex; flex-direction: column; gap: var(--sp-2); }
  .field-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
  /* The label's voice is style.css's .field-label; here one line that ellipsizes (a block, not its inline-flex). */
  .field-label {
    display: block;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ops { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
  /* Hub labels render as sent (COPY rule 8). */
  .ops button { min-height: var(--tap); padding: 0 var(--sp-4); }
  .payload { display: flex; flex-direction: column; gap: var(--sp-2); font-size: .8rem; color: var(--ink-dim); }
  /* The recess without .og-num: a draft is not the action's state, so no state frame. */
  .payload input[type='number'], .payload input[type='text'], .payload input[type='password'] {
    min-height: var(--tap); width: 100%; padding: 0 var(--sp-3);
    border: 1px solid var(--line-1); border-radius: var(--radius); background: var(--screen);
    box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6); color: var(--tx-val);
    font-family: var(--mono); font-size: .9rem;
  }
  .payload input:focus { outline: none; border-color: var(--highlight); }
  .hint { margin: 0; color: var(--ink-dim); font-size: .78rem; }
  /* The status slot: one clipped 14 px line, as Field's .ladder; basis 0, so its words never widen the row. */
  .state {
    flex: 1 1 0;
    min-width: 0;
    height: 14px;
    line-height: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: 11px;
    color: color-mix(in srgb, var(--reality) calc(var(--ga) * 100%), var(--tx-mut));
  }
  .why { color: var(--tx-ghost); }
  .action[data-shadow='pending'] .state { color: var(--intent); }
  .action[data-shadow='fault'] .state { color: var(--warn-ink); }
  .action[data-shadow='overdue'] .state { color: var(--warn-ink); }
  /* Virtual (DESIGN §10.10): the afterglow in the intent family. */
  .action[data-virtual] { --reality: var(--intent); --reality-rgb: var(--intent-rgb); }
</style>
