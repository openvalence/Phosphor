<script>
  /**
   * ValencePane.svelte -- the Link page: link health, session and identity,
   * traffic, the channels with their map, and the hub's refusals (DESIGN.md, "The Link page").
   *
   * This pane is ABOUT the protocol, so it shows channel ids and names read
   * off machine.catalog.entries at runtime; reading catalog data is not a
   * device fact hardcoded in source.
   *
   * Constraints:
   * - Every fact is a row that is always present; a value the hub did not
   *   send reads `--` or says so in words, never a guess (RENDERING law 9).
   * - Publish grants live on the session object, which is not reactive; the
   *   pane's 1 Hz clock re-reads them.
   * - One scroller, the page's: no table or list scrolls on its own, so a
   *   narrow pane drops table columns instead of scrolling sideways.
   * - Refusals come last: a new code grows the page below everything else.
   *   Code families and meanings are the registry's (registry-tables.js).
   * - logView.find is the Log page's search seam (ph-s5mu.1); the Log owns it.
   */
  import { tick } from 'svelte';
  import { machine, getSession } from '../model/machine.svelte.js';
  import { ACCESS_NAME, NACK_NAME } from '../../../Valence/clients/js/index.js';
  import { NACK_FAMILY, NACK_MEANING, CHANNEL_RANGES } from '../model/registry-tables.js';
  import { bytes, since } from '../model/format.js';
  import { logView } from './logview.svelte.js';
  import ChannelMap from './ChannelMap.svelte';
  import './pane.css';

  let { onopenlog = null } = $props();

  // A liveness pane full of "since" readouts needs its own clock, or every
  // age freezes the instant this component last happened to re-render.
  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { nowTick = Date.now(); }, 1000);
    return () => clearInterval(id);
  });
  function ageLabel(ms, _tick) { return since(ms); }

  const link = $derived(machine.link);
  const tierLabel = $derived(link.sessionId != null ? (ACCESS_NAME[link.roles] || ('tier ' + link.roles)) : '--');
  const identity = $derived(link.hubIdentity);
  const lim = $derived(link.limits || {});
  // RFC-055: 0 means the hub does not know.
  const count = (v) => (v ? String(v) : v === 0 ? 'not reported' : '--');

  // machine.svelte.js stores the etag as hex already.
  const etagHex = $derived(machine.catalog.etag || '--');

  function hexId(id) { return '0x' + id.toString(16).padStart(4, '0').toUpperCase(); }
  function categoryOf(entry) {
    if (entry.category == null) return '--';
    return entry.categoryLabel || entry.categoryName || ('category ' + entry.category);
  }
  function grantedRate(id) {
    const g = machine.grants[id];
    return g && g.rate != null ? (g.rate + ' Hz') : '--';
  }
  function offeredRate(entry) {
    return entry.maxRateHz ? (entry.maxRateHz + ' Hz') : (entry.maxRateHz === 0 ? 'on-change' : '--');
  }
  function lastSample(id, _tick) {
    const ts = machine.sampleTs[id];
    return ts ? since(ts) : '--';
  }
  const nameOf = (id) => machine.catalog.entries.find((e) => e.id === id)?.name || '--';

  const subGrants = $derived(Object.keys(machine.grants).length);
  const pubGrants = $derived((void nowTick, void link.sessionId,
    [...(getSession()?.state?.grantedPublishes?.values() || [])]));

  const estopText = $derived(!identity ? '--'
    : identity.estop_cuts_power === true ? 'yes (E-Stop)'
    : identity.estop_cuts_power === false ? 'no (Halt)'
    : 'not declared (Halt)');
  const infoText = $derived(identity && identity.info && typeof identity.info === 'object'
    ? Object.entries(identity.info).map(([k, v]) => k + '=' + v).join(', ') || '--' : '--');

  // The identity as sent, for a bug report. A u64 (BigInt) prints as decimal.
  let copied = $state('');
  let copyTimer = null;
  async function copyIdentity() {
    const text = JSON.stringify(identity, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    try { await navigator.clipboard.writeText(text); copied = 'copied'; } catch (e) { copied = 'copy failed'; }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied = ''; }, 2000);
  }

  // ---- refusals: one row per code, newest first --------------------------------
  // Channel 0 and any id outside the catalog read by their registry range.
  function causeOf(id) {
    const e = machine.catalog.entries.find((x) => x.id === id);
    if (e) return hexId(id) + ' ' + e.name;
    return (id ? hexId(id) + ' ' : '') + (CHANNEL_RANGES.find((r) => id >= r.lo && id <= r.hi)?.name || '--');
  }
  const refusals = $derived(Object.entries(machine.stats.nacks).map(([code, t]) => {
    code = Number(code);
    const causes = Object.entries(t.channels).sort((a, b) => b[1] - a[1]);
    return {
      code, n: t.n, at: t.at, detail: t.detail,
      name: NACK_NAME[code] || hexId(code),
      family: NACK_FAMILY[code >> 8] || null,
      meaning: NACK_MEANING[code] || '',
      causes: causes.slice(0, 3).map(([id, n]) => causeOf(Number(id)) + (causes.length > 1 ? ' ×' + n : ''))
        .concat(causes.length > 3 ? ['+' + (causes.length - 3) + ' more'] : []).join(', '),
    };
  }).sort((a, b) => b.at - a.at));
  const refusalTotal = $derived(refusals.reduce((a, r) => a + r.n, 0));
  function openLog(name) {
    logView.tab = 'log';
    logView.find = name;
    onopenlog?.();
  }
  const toRefusals = () => document.getElementById('vp-refusals')?.scrollIntoView({ block: 'start' });

  // ---- the map selects a list row -----------------------------------------------
  let selected = $state(null);
  async function select(id) {
    selected = id;
    await tick();
    document.querySelector('.chan-list tr[data-chan="' + id + '"]')?.scrollIntoView({ block: 'nearest' });
  }
</script>

<div class="link-page">
  <div class="link-top">
    <section class="pane-sec og-screen health" aria-labelledby="vp-health">
      <div class="pane-head"><h2 id="vp-health">Link health</h2></div>
      <dl class="pane-facts">
        <dt>Link phase</dt><dd>{link.phase}</dd>
        <dt>Last rx</dt><dd class="mono">{ageLabel(machine.stats.lastRxMs, nowTick)}</dd>
        <dt>Clock rtt</dt><dd class="mono">{machine.stats.clockRttUs != null ? machine.stats.clockRttUs + ' µs' : '--'}</dd>
        <dt>Clock offset</dt><dd class="mono">{machine.stats.clockOffsetUs != null ? machine.stats.clockOffsetUs + ' µs' : '--'}</dd>
        <dt>Reconnects</dt><dd class="mono">{machine.stats.reconnects}</dd>
        <dt>Deadman window</dt><dd class="mono">{link.deadmanMs ? link.deadmanMs + ' ms' : '--'}</dd>
        <dt>Channels shed</dt><dd class="mono">{link.subsDropped || 0}</dd>
        <dt>Refusals</dt>
        <dd class="ref">{#if refusals.length}<button type="button" class="jump" onclick={toRefusals}>{refusals.length} code{refusals.length === 1 ? '' : 's'}, {refusalTotal} total</button>{:else}none{/if}</dd>
      </dl>
    </section>

    <section class="pane-sec og-screen ident" aria-labelledby="vp-identity">
      <div class="pane-head"><h2 id="vp-identity">Session and identity</h2></div>
      <dl class="pane-facts">
        <dt>Session id</dt><dd class="mono">{link.sessionId ?? '--'}</dd>
        <dt>Access tier</dt><dd>{tierLabel}</dd>
        <dt>Config generation</dt><dd class="mono">{link.cfgGen ?? '--'}</dd>
        <dt>Sessions in use</dt><dd class="mono">{count(lim.sessions_in_use)}</dd>
        <dt>Max sessions</dt><dd class="mono">{count(lim.max_sessions)}</dd>
        <dt>Hub name</dt><dd>{identity?.hub_name || '--'}</dd>
        <dt>Product</dt><dd>{identity?.product || '--'}</dd>
        <dt>Firmware</dt><dd class="mono">{identity?.fw_version || '--'}</dd>
        <dt>Instance id</dt><dd class="mono">{identity?.hub_instance_id ?? '--'}</dd>
        <dt>E-stop cuts power</dt><dd>{estopText}</dd>
        <dt>Info</dt><dd class="mono">{infoText}</dd>
      </dl>
      <div class="copy-row">
        <span class="flash" role="status">{copied}</span>
        <button type="button" class="og-btn sm" disabled={!identity} onclick={copyIdentity}>Copy identity</button>
      </div>
    </section>

    <section class="pane-sec og-screen traffic" aria-labelledby="vp-traffic">
      <div class="pane-head"><h2 id="vp-traffic">Traffic</h2></div>
      <dl class="pane-facts">
        <dt>Raw frames</dt><dd class="mono">{machine.stats.framesIn} in, {machine.stats.framesOut} out</dd>
        <dt>State pushes</dt><dd class="mono">{machine.stats.statePushes}</dd>
        <dt>Bytes in</dt><dd class="mono">{bytes(machine.stats.bytesIn)}</dd>
        <dt>Subscriptions</dt><dd class="mono">{subGrants}{lim.max_subscriptions ? ' of ' + lim.max_subscriptions : ''}</dd>
        <dt>Per frame</dt><dd class="mono">{lim.max_subscriptions_per_frame ?? '--'}</dd>
        <dt>Max frame</dt><dd class="mono">{lim.max_frame ? bytes(lim.max_frame) : '--'}</dd>
        <dt>Publishes</dt><dd class="mono">{pubGrants.length}</dd>
      </dl>
      {#if pubGrants.length}
        <ul class="pane-list pubs">
          {#each pubGrants as g (g.channel)}
            <li class="mono">
              <span>{hexId(g.channel)} {nameOf(g.channel)}</span>
              <span>{g.rate != null ? g.rate + ' Hz' : '--'}</span>
              <span>burst {g.burst ?? '--'}</span>
              <span>horizon {g.scheduleHorizonMs != null ? g.scheduleHorizonMs + ' ms' : '--'}</span>
              <span>latency {g.scheduleLatencyUs != null ? g.scheduleLatencyUs + ' µs' : 'unspecified'}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <section class="pane-sec og-screen" aria-labelledby="vp-channels">
    <div class="pane-head"><h2 id="vp-channels">Channels and map</h2></div>
    <div class="chan-cols">
      <div class="chan-side">
        <ChannelMap entries={machine.catalog.entries} grants={machine.grants} {selected} onselect={select} />
        <dl class="pane-facts">
          <dt>Catalog</dt><dd>{machine.catalog.ready ? 'ready' : 'not loaded'}</dd>
          <dt>Etag</dt><dd class="mono">{etagHex}</dd>
          <dt>Size</dt><dd class="mono">{bytes(machine.catalog.bytes)}</dd>
          <dt>Source</dt><dd>{machine.catalog.ready ? (machine.catalog.cached ? 'cached' : 'fetched') : '--'}</dd>
        </dl>
      </div>
      {#if !machine.catalog.entries.length}
        <p class="pane-empty">No catalog yet</p>
      {:else}
        <div class="chan-list-box">
          <table class="chan-list">
            <thead>
              <tr>
                <th>id</th><th>name</th><th class="opt2">class</th><th class="opt">dir</th><th class="opt">category</th>
                <th class="opt">offered</th><th>granted</th><th class="opt2">last</th>
              </tr>
            </thead>
            <tbody>
              {#each machine.catalog.entries as e (e.id)}
                <tr data-chan={e.id} class:sel={selected === e.id}>
                  <td class="mono">{hexId(e.id)}</td>
                  <td class="name">{e.name}</td>
                  <td class="opt2">{e.clsName}</td>
                  <td class="opt">{e.dirName}</td>
                  <td class="opt">{categoryOf(e)}</td>
                  <td class="opt mono">{offeredRate(e)}</td>
                  <td class="mono" class:mismatch={machine.grants[e.id] && e.maxRateHz && machine.grants[e.id].rate !== e.maxRateHz}>
                    {grantedRate(e.id)}
                  </td>
                  <td class="opt2 mono">{lastSample(e.id, nowTick)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-refusals">
    <div class="pane-head"><h2 id="vp-refusals">Refusals</h2></div>
    {#if !refusals.length}
      <p class="pane-empty">None from this hub</p>
    {:else}
      <ul class="pane-list refusals">
        {#each refusals as r (r.code)}
          <li data-code={r.code} class:distinct={r.family?.distinct}>
            <div class="r-head">
              <b class="mono">{r.name}</b>
              <span class="r-n mono">×{r.n}</span>
              <span class="r-at mono">{ageLabel(r.at, nowTick)} ago</span>
              <button type="button" class="og-btn sm" aria-label={'Show ' + r.name + ' in the Log'} onclick={() => openLog(r.name)}>Log</button>
            </div>
            <p class="r-mean"><span class="r-fam">{r.family?.name || 'unknown'}</span> {r.meaning || 'not in this registry'}</p>
            <p class="r-cause">{r.causes}{#if r.detail}<span class="r-detail">{' · ' + r.detail}</span>{/if}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .link-page { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; container-type: inline-size; }
  .link-top { display: grid; gap: var(--gap); grid-template-areas: "health" "ident" "traffic"; }
  .health { grid-area: health; }
  .ident { grid-area: ident; }
  .traffic { grid-area: traffic; }
  @container (min-width: 36rem) {
    .link-top { grid-template-columns: 1fr 1fr; grid-template-areas: "health ident" "traffic ident"; }
  }
  @container (min-width: 60rem) {
    .link-top { grid-template-columns: 1fr 1fr 1fr; grid-template-areas: "health ident traffic"; }
  }

  /* Fixed width: "copied" appearing never moves the Copy button. */
  .copy-row { display: flex; align-items: center; justify-content: flex-end; gap: var(--sp-3); margin-top: auto; }
  .flash { min-width: 11ch; text-align: right; font-size: .75rem; color: var(--reality); }
  /* The row holds one height whether it reads "none" or carries the button. */
  .jump { padding: 0; line-height: inherit; color: var(--reality); text-decoration: underline; text-underline-offset: 2px; }

  .pubs > li { gap: var(--sp-1) var(--sp-4); font-size: .74rem; }

  .chan-cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-5); align-items: start; min-width: 0; }
  .chan-side { display: flex; flex-direction: column; gap: var(--sp-4); min-width: 0; }
  @container (min-width: 62rem) {
    .chan-cols { grid-template-columns: minmax(18rem, 26rem) minmax(0, 1fr); }
  }

  table { border-collapse: collapse; width: 100%; font-size: .78rem; }
  th, td { text-align: left; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--line-soft); white-space: nowrap; }
  td.name { white-space: normal; overflow-wrap: anywhere; }
  th { color: var(--tx-mut); text-transform: uppercase; font-size: .68rem; letter-spacing: .06em; font-weight: 500; }
  /* A grant under the offer is QoS, not a hazard: emphasis, never amber. */
  td.mismatch { color: var(--ink-hi); font-weight: 600; }
  tr.sel td { background: rgba(var(--highlight-rgb), .12); }
  tr.sel td:first-child { box-shadow: inset 2px 0 var(--highlight); }
  /* The list measures itself: beside the map it is narrower than the page. */
  .chan-list-box { container-type: inline-size; min-width: 0; }
  @container (max-width: 40rem) {
    .opt { display: none; }
    th, td { padding: var(--sp-2); }
  }
  @container (max-width: 24rem) {
    .opt2 { display: none; }
    th, td { padding: var(--sp-2) var(--sp-1); }
  }

  .refusals > li { flex-direction: column; align-items: stretch; gap: var(--sp-1); }
  .r-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); }
  .r-head b { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; font-size: .82rem; font-weight: 500; color: var(--ink-hi); }
  .r-fam { margin-right: var(--sp-2); font-size: .72rem; color: var(--tx-mut); }
  .r-n, .r-at { font-size: .74rem; }
  .r-at { color: var(--tx-mut); min-width: 9ch; text-align: right; }
  .r-mean { font-size: .8rem; color: var(--ink); }
  .r-cause { font-size: .74rem; color: var(--tx-mut); overflow-wrap: anywhere; }
  .r-detail { color: var(--ink-dim); }
  /* Registry: UIs SHOULD render safety refusals distinctly. Amber, never red. */
  .refusals > li.distinct { border-color: var(--warn); }
  .refusals > li.distinct .r-head b { color: var(--warn-ink, var(--warn)); }

  @media (pointer: coarse) {
    .link-page .og-btn, .jump { min-height: var(--tap); }
    .health dd.ref { display: flex; align-items: center; min-height: var(--tap); }
  }
</style>
