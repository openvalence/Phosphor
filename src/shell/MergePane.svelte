<script>
  /**
   * MergePane.svelte -- Phosphor > Merge: settings staged in Virtual Valence,
   * offered to the same machine once it is live. SHELL ONLY:
   * settings-pane.js registers it with panes.js.
   *
   * Constraints:
   * - Rows only for the live hub whose key (prefs.js hubKey: hub_instance_id)
   *   the staging was made for; any other hub gets a sentence and no rows.
   * - Every row shows the hub's current value (its live STATE) beside the
   *   staged one. Pre-ticked where they differ; inert rows cannot be ticked.
   * - Nothing is sent without a tick and the Apply press; one intent per
   *   row in catalog order (merge.js applyRows), destructive and
   *   background-run rows confirm first (SPEC §8.8, RENDERING §10.1).
   * - Rows never move: an applied row stays listed with its outcome until
   *   the hub changes. The status line is one fixed slot.
   */
  import { machine, getSession } from '../model/machine.svelte.js';
  import { hubKey } from '../model/prefs.js';
  import { mergeRows, applyRows, unstage } from '../model/merge.js';
  import { formatValue, optionLabel, unitOf } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { askConfirm } from '../ui/confirm.svelte.js';
  import { staging, persistStaging } from './virtual.svelte.js';
  import '../ui/pane.css';

  const link = $derived(machine.link);
  const live = $derived(link.phase === 'live' && !link.virtual);
  const liveKey = $derived(live ? hubKey(link.hubIdentity, link.host, link.port) : null);
  const stagedKeys = $derived(Object.keys(staging));
  const stagedCount = $derived(stagedKeys.reduce((n, k) => n + Object.keys(staging[k]).length, 0));
  const fields = $derived((machine.catalog.model && machine.catalog.model.fields) || []);
  const rows = $derived(liveKey && staging[liveKey] ? mergeRows(staging[liveKey], fields, machine.samples) : []);

  // Per hub: the operator's own ticks over the default, and each sent row's
  // outcome (an applied row has left staging but stays listed).
  let shownFor = $state(null);
  let manual = $state({});
  let done = $state({});
  $effect(() => {
    if (liveKey !== shownFor) { shownFor = liveKey; manual = {}; done = {}; }
  });
  const order = $derived(new Map(fields.map((f, i) => [f.uid, i])));
  const shown = $derived.by(() => {
    // A sent row that left staging still reads the hub's live value.
    const gone = Object.values(done).map((d) => d.row).filter((r) => r.field && !rows.some((x) => x.uid === r.uid))
      .map((r) => ({ ...r, current: reportedValue(r.field, machine.samples[r.field.channelId]) }));
    const out = [...rows, ...gone];
    return out.sort((a, b) => (order.get(a.uid) ?? Infinity) - (order.get(b.uid) ?? Infinity));
  });
  const isTicked = (r) => !r.inert && !!staging[liveKey]?.[r.uid] && (r.uid in manual ? manual[r.uid] : r.differs);
  const tickedCount = $derived(rows.filter(isTicked).length);
  let busy = $state(false);

  const status = $derived.by(() => {
    if (link.virtual) return { phase: 'pending', text: 'Writes stage for ' + (link.virtual.name || 'Virtual Valence') };
    if (!live) return { phase: null, text: stagedCount ? 'Connect the machine to merge' : 'Nothing staged' };
    if (!staging[liveKey] && !Object.keys(done).length) {
      return { phase: stagedCount ? 'overdue' : null, text: stagedCount ? 'Staged for another machine' : 'Nothing staged' };
    }
    return { phase: busy ? 'pending' : null, text: busy ? 'Applying' : rows.length + ' staged · ' + tickedCount + ' ticked' };
  });

  function show(r, v) {
    if (v === undefined) return '--';
    if (!r.field) return String(v);
    if (r.field.options) return optionLabel(r.field, v);
    const u = unitOf(r.field);
    return formatValue(r.field, v) + (u && typeof v === 'number' ? ' ' + u : '');
  }

  async function apply() {
    const session = getSession();
    if (!session || !liveKey || busy) return;
    busy = true;
    const key = liveKey;
    const picked = new Set(rows.filter(isTicked).map((r) => r.uid));
    const byUid = new Map(rows.map((r) => [r.uid, r]));
    try {
      await applyRows(staging, key, rows, picked, {
        send: (r) => session.sendIntent(r.field.writeChannel, { [r.field.settingKey]: r.value }),
        confirm: (r) => askConfirm({ title: r.label, body: r.field.desc || '', confirmLabel: 'Apply' }),
        onResult: (uid, res) => { done[uid] = { row: byUid.get(uid), res }; },
      });
    } finally {
      persistStaging();
      busy = false;
    }
  }

  function discard() {
    if (!liveKey || !staging[liveKey]) return;
    for (const uid of Object.keys(staging[liveKey])) unstage(staging, liveKey, uid);
    persistStaging();
  }
</script>

<div class="pane-stack mp">
  <section class="pane-sec og-panel" aria-labelledby="mp-head">
    <div class="pane-head"><h2 id="mp-head">Merge</h2><span class="mono count">{stagedCount}</span></div>
    <dl class="pane-facts">
      <dt>Live hub</dt><dd class="mono">{liveKey || '--'}</dd>
      <dt>Staged</dt><dd>{stagedCount} on {stagedKeys.length} machine{stagedKeys.length === 1 ? '' : 's'}</dd>
    </dl>
    <p class="pane-note">Layouts, plugins, theme: saved as you go</p>
    <p class="pane-status" role="status" data-phase={status.phase} title={status.text}>{status.text}</p>
  </section>

  {#if shown.length}
    <section class="pane-sec og-panel" aria-labelledby="mp-rows">
      <div class="pane-head">
        <h2 id="mp-rows">Staged settings</h2>
        <span class="acts">
          <button type="button" class="og-btn sm" disabled={busy || !tickedCount} onclick={apply}>Apply ticked</button>
          <button type="button" class="og-btn sm" disabled={busy || !rows.length} onclick={discard}>Discard</button>
        </span>
      </div>
      <ul class="pane-list mrows">
        <li class="hdr" aria-hidden="true"><span></span><span>Setting</span><span>Hub</span><span>Staged</span><span>State</span></li>
        {#each shown as r (r.uid)}
          {@const d = done[r.uid]}
          <li data-uid={r.uid} data-phase={d ? d.res.phase : null}>
            <input type="checkbox" aria-label={'Apply ' + r.label} disabled={busy || !!r.inert || !staging[liveKey]?.[r.uid]}
                   checked={isTicked(r)} onchange={(e) => { manual[r.uid] = e.currentTarget.checked; }} />
            <span class="who">
              <span class="name">{r.label}{#if r.destructive}<span class="mark warn">destructive</span>{/if}{#if r.restart}<span class="mark">restart</span>{/if}</span>
              <span class="meta">{r.group || '--'}</span>
            </span>
            <span class="val mono old" title="Hub now">{show(r, r.current)}</span>
            <span class="val mono new" title="Staged">{show(r, r.value)}</span>
            <span class="state" title={d ? d.res.text : r.inert || (r.differs ? 'Differs' : 'Same')}>{d ? d.res.text : r.inert || (r.differs ? 'differs' : 'same')}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .count { font-size: .75rem; color: var(--tx-mut); }
  .acts { display: flex; gap: var(--sp-3); margin-left: auto; }
  .mrows > li {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) minmax(0, 7rem) minmax(0, 7rem) minmax(0, 9rem);
    align-items: center;
    gap: var(--sp-3);
    min-height: 48px;
  }
  .mrows > li.hdr { min-height: 24px; border: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--tx-mut); }
  .mrows input[type=checkbox] { width: 20px; height: 20px; margin: 0 auto; }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .who > span, .val, .state { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { font-weight: 500; }
  .meta { font-size: .72rem; color: var(--tx-mut); }
  .old { color: var(--tx-mut); }
  .new { color: var(--intent); }
  .state { font-size: .75rem; color: var(--tx-mut); }
  li[data-phase='settled'] .state { color: var(--reality); }
  li[data-phase='pending'] .state { color: var(--intent); }
  li[data-phase='fault'] .state { color: var(--warn-ink, var(--warn)); }
  .mark { margin-left: var(--sp-3); padding: 0 var(--sp-3); font-size: .68rem; font-weight: 400; border: 1px solid var(--line); border-radius: var(--r-s); color: var(--tx-mut); }
  .mark.warn { border-color: var(--warn); color: var(--warn-ink, var(--warn)); }
  @media (pointer: coarse) { .mrows input[type=checkbox] { width: 28px; height: 28px; } }
  /* Phones: the state drops under the values so the tick keeps its size. */
  @media (max-width: 480px) {
    .mrows > li { grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1fr); }
    .mrows > li.hdr { display: none; }
    .mrows input[type=checkbox] { grid-row: 1 / span 3; }
    .who, .state { grid-column: 2 / span 2; }
    .old { grid-column: 2; }
    .new { grid-column: 3; }
  }
</style>
