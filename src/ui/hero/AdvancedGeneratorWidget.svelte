<script>
  /**
   * AdvancedGeneratorWidget.svelte -- RENDERING §10 `generator-advanced`:
   * master run/stop with `source.background_run` beside it (§10.1 rule 1),
   * the seven base controls and any claimed dwell, then one block of
   * modulators, each naming the base control its mod_target rides (RFC-066),
   * and the preset store.
   *
   * Constraints:
   * - Every binding is a role (roles.js ADVGEN_SPEC); a missing essential role
   *   declines the whole widget (law 7). Modulator count is the catalog's.
   * - A modulator riding a field outside the base set is still drawn, naming
   *   what it rides; one whose target this catalog lacks says so instead of
   *   guessing a home.
   * - A claimed preset op is always drawn here (claimed fields leave Tier 0);
   *   its slot list only when the op's store_id names a STORE (RFC-070).
   */
  import { machine } from '../../model/machine.svelte.js';
  import { modTargetUid, reportedValue } from '../../model/settings.js';
  import { labelFor } from '../../model/format.js';
  import Field from '../Field.svelte';
  import { chipalign } from '../chipalign.js';
  import ActionField from '../ActionField.svelte';
  import Roster from '../widgets/Roster.svelte';
  import { storeOfRoster, rosterOfStore } from '../widgets/roster.js';

  let { fields } = $props();

  // The dwells (RFC-095) are optional bindings: drawn, with their modulators, only when claimed.
  const BASE = $derived(['master', 'depthMax', 'depthMin', 'speedIn', 'speedOut', 'accelIn', 'accelOut',
    'dwellCrest', 'dwellTrough'].filter((k) => fields[k]));
  const MOD_KEYS = ['amount', 'rise', 'hold', 'fall', 'rest', 'phase'];

  // uid of the base control -> its modulators; anything else is `loose`.
  const grouped = $derived.by(() => {
    const entries = machine.catalog.entries || [];
    const under = new Map(BASE.map((k) => [fields[k].uid, []]));
    const loose = [];
    for (const m of fields.mods || []) {
      const t = modTargetUid(entries, m.channelId);
      if (under.has(t)) under.get(t).push(m); else loose.push({ m, t });
    }
    return { under, loose };
  });

  const ridesLabel = (uid) => {
    const f = uid && (machine.catalog.model?.fields || []).find((x) => x.uid === uid);
    return f ? labelFor(f) : 'missing field';
  };
  // mod.amount 0 = no modulation (SPEC §8.8).
  const isOff = (m) => reportedValue(m.amount, machine.samples[m.amount.channelId]) === 0;
  // Base order first, then the loose ones, each with what it rides.
  const modRows = $derived([
    ...BASE.flatMap((k) => (grouped.under.get(fields[k].uid) || []).map((m) => ({ m, rides: labelFor(fields[k]) }))),
    ...grouped.loose.map(({ m, t }) => ({ m, rides: ridesLabel(t) })),
  ]);
  // A block advanced as a whole carries one tag, not one per field (ph-55r).
  const modsAdv = $derived(modRows.length > 0 && modRows.every(({ m }) => MOD_KEYS.every((k) => m[k].advanced)));

  // RFC-070: the writer, its STORE and the roster join by store_id only.
  const presets = $derived.by(() => {
    const op = fields.presetOp;
    if (!op) return null;
    const entries = machine.catalog.entries || [];
    const store = storeOfRoster(entries, entries.find((e) => e.id === op.channelId));
    return store ? { store, roster: rosterOfStore(entries, store) } : null;
  });
</script>

{#snippet modulator(m, rides)}
  <h4 class="card-sub">{m.amount.group || 'Modulator'} (rides {rides}){isOff(m) ? ': off' : ''}</h4>
  {#each MOD_KEYS as k (k)}<Field field={m[k]} />{/each}
{/snippet}

<div class="hero advgen">
  <div class="card-body" use:chipalign>
    <Field field={fields.running} />
    {#if fields.bgRun}<Field field={fields.bgRun} />{/if}
    {#if fields.mode}<Field field={fields.mode} />{/if}
    {#each BASE as k (k)}<Field field={fields[k]} />{/each}
  </div>

  {#if modRows.length}
    <section class="block mods" class:adv={modsAdv}>
      <div class="card-body" use:chipalign>
        <h4 class="card-sub">Modulators{#if modsAdv}<span class="tag">adv</span>{/if}</h4>
        {#each modRows as { m, rides } (m.channelId)}{@render modulator(m, rides)}{/each}
      </div>
    </section>
  {/if}

  {#if fields.presetOp}
    <section class="block">
      <h4 class="card-sub">Presets</h4>
      <ActionField action={fields.presetOp} titled />
      {#if presets}<Roster store={presets.store} roster={presets.roster} />{/if}
    </section>
  {/if}
</div>

<style>
  .hero {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: var(--gap);
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  .block {
    border-top: 1px solid var(--line);
    padding-top: var(--gap);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .mods.adv :global(.field .tag.adv) { display: none; }
  .tag {
    margin-left: var(--sp-2);
    padding: 1px var(--sp-2);
    font-size: .62rem;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--tx-mut);
    background: var(--bg-sunken);
    box-shadow: inset 0 0 0 1px var(--line-2);
    border-radius: var(--r-s);
  }
</style>
