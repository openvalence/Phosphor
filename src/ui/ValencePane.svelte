<script>
  /**
   * ValencePane.svelte -- protocol observability: the session's facts, the
   * catalog, every channel's offered vs granted rate, link counters, NACKs.
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
   */
  import { machine, getSession } from '../model/machine.svelte.js';
  import { ACCESS_NAME, toHex } from '../../../Valence/clients/js/index.js';
  import { bytes, since } from '../model/format.js';
  import './pane.css';

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

  const etagHex = $derived(machine.catalog.etag && machine.catalog.etag.length ? toHex(machine.catalog.etag) : '--');

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
    : identity.estop_cuts_power === true ? 'yes: the strip reads E-Stop'
    : identity.estop_cuts_power === false ? 'no: the strip reads Halt'
    : 'not declared: the strip reads Halt');
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

  const nacks = $derived([...machine.events.nacks].reverse());
</script>

<div class="pane">
  <section class="pane-sec og-screen" aria-labelledby="vp-session">
    <div class="pane-head"><h2 id="vp-session">Session</h2></div>
    <dl class="pane-facts">
      <dt>session id</dt><dd class="mono">{link.sessionId ?? '--'}</dd>
      <dt>link phase</dt><dd>{link.phase}</dd>
      <dt>access tier</dt><dd>{tierLabel}</dd>
      <dt>deadman window</dt><dd class="mono">{link.deadmanMs ? link.deadmanMs + ' ms' : '--'}</dd>
      <dt>config generation</dt><dd class="mono">{link.cfgGen ?? '--'}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-identity">
    <div class="pane-head">
      <h2 id="vp-identity">Hub identity</h2>
      <span class="flash" role="status">{copied}</span>
      <button type="button" class="og-btn sm" disabled={!identity} onclick={copyIdentity}>Copy</button>
    </div>
    <dl class="pane-facts">
      <dt>hub name</dt><dd>{identity?.hub_name || '--'}</dd>
      <dt>product</dt><dd>{identity?.product || '--'}</dd>
      <dt>firmware</dt><dd class="mono">{identity?.fw_version || '--'}</dd>
      <dt>instance id</dt><dd class="mono">{identity?.hub_instance_id ?? '--'}</dd>
      <dt>e-stop cuts power</dt><dd>{estopText}</dd>
      <dt>info</dt><dd class="mono">{infoText}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-limits">
    <div class="pane-head"><h2 id="vp-limits">Limits</h2></div>
    <dl class="pane-facts">
      <dt>max frame</dt><dd class="mono">{lim.max_frame ? bytes(lim.max_frame) : '--'}</dd>
      <dt>max subscriptions</dt><dd class="mono">{lim.max_subscriptions ?? '--'}</dd>
      <dt>per frame</dt><dd class="mono">{lim.max_subscriptions_per_frame ?? '--'}</dd>
      <dt>max sessions</dt><dd class="mono">{count(lim.max_sessions)}</dd>
      <dt>sessions in use</dt><dd class="mono">{count(lim.sessions_in_use)}</dd>
      <dt>channels shed</dt><dd class="mono">{link.subsDropped || 0}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-grants">
    <div class="pane-head"><h2 id="vp-grants">Grants</h2></div>
    <dl class="pane-facts">
      <dt>subscriptions</dt><dd>{subGrants} channel{subGrants === 1 ? '' : 's'}; rates in the channel table</dd>
      <dt>publishes</dt><dd class="mono">{pubGrants.length}</dd>
    </dl>
    {#if pubGrants.length}
      <div class="table-wrap">
        <table>
          <thead><tr><th>id</th><th>name</th><th>rate</th><th>burst</th><th>schedule horizon</th><th>schedule latency</th></tr></thead>
          <tbody>
            {#each pubGrants as g (g.channel)}
              <tr>
                <td class="mono">{hexId(g.channel)}</td>
                <td>{nameOf(g.channel)}</td>
                <td class="mono">{g.rate != null ? g.rate + ' Hz' : '--'}</td>
                <td class="mono">{g.burst ?? '--'}</td>
                <td class="mono">{g.scheduleHorizonMs != null ? g.scheduleHorizonMs + ' ms' : '--'}</td>
                <td class="mono">{g.scheduleLatencyUs != null ? g.scheduleLatencyUs + ' µs' : 'unspecified'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="pane-empty">No publish grants. One appears when this client starts sending stream input, such as a buttplug app driving the machine.</p>
    {/if}
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-catalog">
    <div class="pane-head"><h2 id="vp-catalog">Catalog</h2></div>
    <dl class="pane-facts">
      <dt>state</dt><dd>{machine.catalog.ready ? 'ready' : 'not loaded'}</dd>
      <dt>etag</dt><dd class="mono">{etagHex}</dd>
      <dt>size</dt><dd class="mono">{bytes(machine.catalog.bytes)}</dd>
      <dt>source</dt><dd>{machine.catalog.ready ? (machine.catalog.cached ? 'cached' : 'fetched') : '--'}</dd>
      <dt>entries</dt><dd class="mono">{machine.catalog.entries.length}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-counters">
    <div class="pane-head"><h2 id="vp-counters">Link counters</h2></div>
    <dl class="pane-facts">
      <dt>raw frames</dt><dd class="mono">{machine.stats.framesIn} in, {machine.stats.framesOut} out</dd>
      <dt>state pushes</dt><dd class="mono">{machine.stats.statePushes}</dd>
      <dt>bytes in</dt><dd class="mono">{bytes(machine.stats.bytesIn)}</dd>
      <dt>last rx</dt><dd class="mono">{ageLabel(machine.stats.lastRxMs, nowTick)}</dd>
      <dt>clock offset</dt><dd class="mono">{machine.stats.clockOffsetUs != null ? machine.stats.clockOffsetUs + ' µs' : '--'}</dd>
      <dt>clock rtt</dt><dd class="mono">{machine.stats.clockRttUs != null ? machine.stats.clockRttUs + ' µs' : '--'}</dd>
      <dt>reconnects</dt><dd class="mono">{machine.stats.reconnects}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-channels">
    <div class="pane-head"><h2 id="vp-channels">Channels</h2></div>
    {#if !machine.catalog.entries.length}
      <p class="pane-empty">No catalog yet. Once a hub connects, its channels list here.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>id</th><th>name</th><th>class</th><th>dir</th><th>category</th>
              <th>offered</th><th>granted</th><th>last sample</th>
            </tr>
          </thead>
          <tbody>
            {#each machine.catalog.entries as e (e.id)}
              <tr>
                <td class="mono">{hexId(e.id)}</td>
                <td>{e.name}</td>
                <td>{e.clsName}</td>
                <td>{e.dirName}</td>
                <td>{categoryOf(e)}</td>
                <td class="mono">{offeredRate(e)}</td>
                <td class="mono" class:mismatch={machine.grants[e.id] && e.maxRateHz && machine.grants[e.id].rate !== e.maxRateHz}>
                  {grantedRate(e.id)}
                </td>
                <td class="mono">{lastSample(e.id, nowTick)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="pane-sec og-screen" aria-labelledby="vp-nacks">
    <div class="pane-head"><h2 id="vp-nacks">Recent NACKs</h2></div>
    {#if !nacks.length}
      <p class="pane-empty">None this session. A refused frame lists here with its code and reason.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>when</th><th>code</th><th>channel</th><th>detail</th></tr>
          </thead>
          <tbody>
            {#each nacks as n (n.at + ':' + n.code + ':' + n.channel)}
              <tr>
                <td class="mono">{ageLabel(n.at, nowTick)} ago</td>
                <td class="mono">{n.name}</td>
                <td class="mono">{n.channel != null ? hexId(n.channel) : '--'}</td>
                <td>{n.detail || '--'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  /* Fixed width: "copied" appearing never moves the Copy button. */
  .flash { min-width: 11ch; text-align: right; font-size: .75rem; color: var(--reality); }

  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 620px;
    font-size: .78rem;
  }
  th, td {
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1px solid var(--line-soft);
    white-space: nowrap;
  }
  th {
    color: var(--tx-mut);
    text-transform: uppercase;
    font-size: .68rem;
    letter-spacing: .06em;
    font-weight: 500;
  }
  td.mismatch { color: var(--warn); font-weight: 600; }
</style>
