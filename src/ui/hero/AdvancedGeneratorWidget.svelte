<script>
  /**
   * AdvancedGeneratorWidget.svelte -- RENDERING §10 `generator-advanced`:
   * master run/stop with `source.background_run` beside it (§10.1 rule 1),
   * the master controls, one group per declared lane, and the preset store.
   *
   * Constraints:
   * - Every binding is a role (heroes.js); a missing essential role declines
   *   the whole widget (law 7). Lane count is the catalog's, never a constant.
   * - A claimed preset op is always drawn here (claimed fields leave Tier 0);
   *   its slot list only when a roster linked to a store resolves.
   */
  import { machine } from '../../model/machine.svelte.js';
  import Field from '../Field.svelte';
  import ActionField from '../ActionField.svelte';
  import Roster from '../widgets/Roster.svelte';
  import { storeOfRoster } from '../widgets/roster.js';

  let { fields } = $props();

  const masters = $derived([fields.mode, fields.master, fields.depthMax, fields.depthMin,
    fields.speedIn, fields.speedOut, fields.accelIn, fields.accelOut].filter(Boolean));
  const LANE_KEYS = ['amplitude', 'inStep', 'inWait', 'outStep', 'outWait', 'offset'];

  // The CRUD op's channel is the roster's setting_channel (RFC-067 open
  // question 2); the roster names its store by RFC-070's store_id.
  const presets = $derived.by(() => {
    const op = fields.presetOp;
    if (!op) return null;
    const entries = machine.catalog.entries || [];
    for (const roster of entries) {
      if (roster.settingChannel !== op.channelId) continue;
      const store = storeOfRoster(entries, roster);
      if (store) return { roster, store };
    }
    return null;
  });
</script>

<div class="hero advgen">
  <div class="head">
    <Field field={fields.running} />
    {#if fields.bgRun}<Field field={fields.bgRun} />{/if}
  </div>

  <div class="grid">
    {#each masters as f (f.uid)}<Field field={f} />{/each}
  </div>

  {#each fields.lanes as lane (lane.channelId)}
    <section class="lane">
      <h4>{lane.amplitude.group || 'Lane'}</h4>
      <div class="grid">
        {#each LANE_KEYS as k (k)}<Field field={lane[k]} />{/each}
      </div>
    </section>
  {/each}

  {#if fields.presetOp}
    <section class="lane">
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
  .lane {
    border-top: 1px solid var(--line);
    padding-top: var(--gap);
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
