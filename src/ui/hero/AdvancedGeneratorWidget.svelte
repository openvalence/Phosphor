<script>
  /**
   * AdvancedGeneratorWidget.svelte -- RENDERING §10 `generator-advanced`:
   * master run/stop with `source.background_run` beside it (§10.1 rule 1),
   * the seven base controls, each with the modulators whose mod_target names
   * it grouped under it (RFC-066), and the preset store.
   *
   * Constraints:
   * - Every binding is a role (roles.js ADVGEN_SPEC); a missing essential role
   *   declines the whole widget (law 7). Modulator count is the catalog's.
   * - A modulator riding a field outside the base set is still drawn, under
   *   "Other modulators" naming what it rides; one whose target this catalog
   *   lacks says so instead of guessing a home.
   * - A claimed preset op is always drawn here (claimed fields leave Tier 0);
   *   its slot list only when the op's store_id names a STORE (RFC-070).
   */
  import { machine } from '../../model/machine.svelte.js';
  import { modTargetUid, reportedValue } from '../../model/settings.js';
  import { labelFor } from '../../model/format.js';
  import Field from '../Field.svelte';
  import ActionField from '../ActionField.svelte';
  import Roster from '../widgets/Roster.svelte';
  import { storeOfRoster, rosterOfStore } from '../widgets/roster.js';

  let { fields } = $props();

  const BASE = ['master', 'depthMax', 'depthMin', 'speedIn', 'speedOut', 'accelIn', 'accelOut'];
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
    return f ? labelFor(f) : 'a field this catalog does not have';
  };
  // mod.amount 0 = no modulation (SPEC §8.8).
  const isOff = (m) => reportedValue(m.amount, machine.samples[m.amount.channelId]) === 0;

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
  <section class="mod">
    <h4>{m.amount.group || 'Modulator'}{rides ? ' (rides ' + rides + ')' : ''}{isOff(m) ? ': off' : ''}</h4>
    <div class="grid">
      {#each MOD_KEYS as k (k)}<Field field={m[k]} />{/each}
    </div>
  </section>
{/snippet}

<div class="hero advgen">
  <div class="head">
    <Field field={fields.running} />
    {#if fields.bgRun}<Field field={fields.bgRun} />{/if}
    {#if fields.mode}<Field field={fields.mode} />{/if}
  </div>

  <div class="grid">
    {#each BASE as k (k)}
      <div class="base">
        <Field field={fields[k]} />
        {#each grouped.under.get(fields[k].uid) || [] as m (m.channelId)}{@render modulator(m)}{/each}
      </div>
    {/each}
  </div>

  {#if grouped.loose.length}
    <section class="block">
      <h4>Other modulators</h4>
      {#each grouped.loose as { m, t } (m.channelId)}{@render modulator(m, ridesLabel(t))}{/each}
    </section>
  {/if}

  {#if fields.presetOp}
    <section class="block">
      <ActionField action={fields.presetOp} />
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
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .head > :global(*) { flex: 1 1 180px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 12px 16px;
  }
  .block {
    border-top: 1px solid var(--line);
    padding-top: var(--gap);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .base { display: flex; flex-direction: column; gap: 8px; }
  .mod {
    margin-left: 12px;
    border-left: 2px solid var(--line);
    padding-left: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-size: .72rem;
    letter-spacing: .04em;
    color: var(--tx-mut);
  }
</style>
