<script>
  /**
   * HealthPane.svelte -- the Health view (ph-9t5l): Link, This device and
   * Machine cards, the Link card's 2-minute strip, the incident list with
   * Send report, and on the served page the Sent reports list. The address,
   * the control list and the firmware live here, not in the top bar (DESIGN
   * §10.3, operator 2026-10-10).
   *
   * Constraints:
   * - One fact per line, plain words left, the number right; a value the
   *   machine has no role for reads "not reported by this machine", one this
   *   engine cannot measure "not measured here", one not seen yet `--`.
   * - Every row is always present, so a value arriving never moves a line
   *   (no page shifting from non-user input).
   * - Warn and act read amber, never red: red is the hazard color.
   */
  import { health } from '../../model/health/health.svelte.js';
  import { machine } from '../../model/machine.svelte.js';
  import { bytes } from '../../model/format.js';
  import { CONDITIONS, evidenceText, secs } from '../../model/health/core.js';
  import ReportReview from './ReportReview.svelte';
  import SentReports from './SentReports.svelte';
  import '../pane.css';

  const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
  const NR = 'not reported by this machine';
  const NM = 'not measured here';
  const L = $derived(health.link);
  const D = $derived(health.device);
  const M = $derived(health.machine);
  const ms = (v) => (v == null ? '--' : Math.round(v) + ' ms');
  const B = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
  const controlList = $derived(machine.catalog.ready
    ? bytes(machine.catalog.bytes) + (machine.catalog.cached ? ' · saved copy on this device' : ' · read from the machine') : 'not loaded');

  // The strip: x over the last 120 s, y over 0..yMax ms.
  const W = 240, H = 64;
  const yMax = $derived(Math.max(250, ...health.strip.map((p) => Math.max(p.rtt || 0, p.lead || 0))));
  const x = (s) => ((s + 120) / 120) * W;
  const y = (v) => H - (Math.max(0, v) / yMax) * H;
  const line = (key) => health.strip.filter((p) => p[key] != null).map((p) => x(p.s).toFixed(1) + ',' + y(p[key]).toFixed(1)).join(' ');
  const cuts = $derived(health.strip.filter((p) => p.cut));

  const when = (ms) => new Date(ms).toLocaleTimeString();
  // The incident the status slot opened, in view.
  let list = $state();
  $effect(() => {
    if (health.focus && list) list.querySelector('[data-id="' + health.focus + '"]')?.scrollIntoView({ block: 'nearest' });
  });
</script>

{#if health.review}
  <ReportReview id={health.review} onback={() => (health.review = null)} />
{:else}
<div class="pane-stack health">
  <section class="pane-sec og-screen" aria-labelledby="hp-link">
    <div class="pane-head"><h2 id="hp-link">Link</h2></div>
    <dl class="pane-facts">
      <dt>Status</dt><dd class="st" data-sev={L.status?.sev}>{L.status?.text ?? '--'}</dd>
      <dt>Round trip</dt><dd class="mono">{ms(L.rttMs)}{L.rttSlowMs != null ? ' · slowest ' + Math.round(L.rttSlowMs) + ' ms' : ''}</dd>
      <dt>Sent ahead (least)</dt><dd class="mono">{ms(L.leadMinMs)}</dd>
      <dt>Arrived ahead (least)</dt><dd class="nr">{NR}</dd>
      <dt>Update gaps (2 min)</dt><dd class="mono">{L.gaps ?? '--'}{L.longestGapMs != null ? ' · longest ' + Math.round(L.longestGapMs) + ' ms' : ''}</dd>
      <dt>Data waiting</dt><dd class="mono">{L.backlog != null ? B(L.backlog) : '--'}</dd>
      <dt>Updates per second</dt><dd class="mono">{L.inPerS ?? '--'} from it · {L.outPerS ?? '--'} to it</dd>
      <dt>Machine signal</dt><dd class="nr">{NR}</dd>
      <dt>Machine WiFi drops</dt><dd class="nr">{NR}</dd>
      <dt>Reconnects</dt><dd class="mono">{L.reconnects ?? '--'}</dd>
      <dt>Times it sent fewer updates</dt><dd class="mono">{L.cuts ?? '--'}</dd>
      <dt>Address</dt><dd class="mono">{machine.link.dialed || '--'}</dd>
      <dt>Control list</dt><dd class="mono">{controlList}</dd>
    </dl>
    <figure class="strip" aria-label="Round trip and sent ahead, last 2 minutes">
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" aria-hidden="true">
        {#each cuts as c (c.s)}<line class="cut" data-cause={c.cut} x1={x(c.s)} x2={x(c.s)} y1="0" y2={H} />{/each}
        <polyline class="rtt" points={line('rtt')} />
        <polyline class="lead" points={line('lead')} />
      </svg>
      <figcaption><span class="k rtt">Round trip</span><span class="k lead">Sent ahead</span><span class="k cut">Pause</span><span class="mono">{Math.round(yMax)} ms · 2 min</span></figcaption>
    </figure>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="hp-device">
    <div class="pane-head"><h2 id="hp-device">This device</h2></div>
    <dl class="pane-facts">
      <dt>Status</dt><dd class="st" data-sev={D.status?.sev}>{D.status?.text ?? '--'}</dd>
      <dt>Responsiveness</dt><dd class="mono">{D.lagP95Ms != null ? 'waits up to ' + Math.round(D.lagP95Ms) + ' ms' : '--'}</dd>
      <dt>Frame rate</dt><dd class="mono">{D.fps != null ? D.fps + ' fps' : D.visible === false ? 'not measured while hidden' : '--'}</dd>
      <dt>Memory</dt><dd class:mono={D.heapMb != null} class:nr={D.heapMb == null}>{D.heapMb != null ? Math.round(D.heapMb) + ' MB' + (D.heapTrendMb != null ? ' · ' + (D.heapTrendMb >= 0 ? '+' : '') + D.heapTrendMb.toFixed(1) + ' MB in 10 min' : '') : NM}</dd>
      <dt>Processor load</dt><dd class:nr={!D.pressure}>{D.pressure ?? NM}</dd>
      <dt>Background tasks</dt><dd class="mono">{D.workers ?? '--'}</dd>
      <dt>Memory growth</dt><dd class="st" data-sev={D.growth ? 'warn' : null}>{D.growth ?? 'none'}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="hp-machine">
    <div class="pane-head"><h2 id="hp-machine">Machine</h2></div>
    <dl class="pane-facts">
      <dt>Status</dt><dd class="st" data-sev={M.status?.sev}>{M.live === false ? 'no link' : M.status?.text ?? '--'}</dd>
      <dt>Late plans</dt><dd class="nr">{NR}</dd>
      <dt>Plan time</dt><dd class="nr">{NR}</dd>
      <dt>Faults</dt><dd class="nr">{NR}</dd>
      <dt>Machine memory</dt><dd class="nr">{NR}</dd>
      {#each M.temps?.length ? M.temps : [null] as t, i (i)}
        <dt>{t ? t.label : 'Temperature'}</dt><dd class:mono={t?.text} class:nr={!t} class="st" data-sev={t?.hot ? 'warn' : null}>{t ? t.text ?? '--' : NR}</dd>
      {/each}
      {#each M.bus?.length ? M.bus : [null] as p, i (i)}
        <dt>{p ? p.label : 'Power'}</dt><dd class:mono={p?.text} class:nr={!p}>{p ? p.text ?? '--' : NR}</dd>
      {/each}
      <dt>Warnings in its log</dt><dd class="mono">{M.warnPerMin ?? '--'} per min</dd>
      <dt>Motion anomalies</dt><dd class="mono">{M.anomaliesPerMin ?? '--'} per min</dd>
      <dt>Log lines skipped</dt><dd class="nr">{NR}</dd>
      <dt>Restarts seen</dt><dd class="mono">{M.restarts ?? '--'}</dd>
      <dt>Firmware</dt><dd class="mono">{machine.link.hubIdentity?.fw_version || '--'}</dd>
    </dl>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="hp-inc">
    <div class="pane-head"><h2 id="hp-inc">Incidents</h2><span class="pane-note">kept on this device</span></div>
    {#if !health.incidents.length}
      <p class="pane-empty">No incidents</p>
    {:else}
      <ul class="pane-list incs" bind:this={list}>
        {#each health.incidents as inc (inc.id)}
          <li data-sev={inc.sev} data-cond={inc.cond} data-cause={inc.cause} data-at={inc.wallAt} data-id={inc.id}>
            <details open={health.focus === inc.id}>
              <summary>
                <time class="mono">{when(inc.wallAt)}</time>
                <span class="text">{inc.text}</span>
                {#if !inc.closed}<span class="chip">now</span>{/if}
              </summary>
              <div class="more">
                {#if CONDITIONS[inc.cond].detail}<p>{CONDITIONS[inc.cond].detail}</p>{/if}
                {#each inc.tip || [] as l, k (k)}<p class:act={l === CONDITIONS[inc.cond].action}>{l}</p>{/each}
                <p class="ev mono">{[inc.why, evidenceText(inc.evidence), inc.durationMs ? 'total ' + secs(inc.durationMs) : ''].filter(Boolean).join(' · ')}</p>
                <button type="button" class="og-btn sm" onclick={() => (health.review = inc.id)}>Send report</button>
              </div>
            </details>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if !SHELL}<SentReports />{/if}
</div>
{/if}

<style>
  .st[data-sev='warn'], .st[data-sev='act'] { color: var(--warn-ink, var(--warn)); }
  .nr { color: var(--tx-mut); }
  .strip { margin: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
  .strip svg { width: 100%; height: 64px; display: block; background: var(--bg-sunken); border-radius: var(--r-s); }
  .strip polyline { fill: none; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .strip .rtt { stroke: var(--intent); }
  .strip .lead { stroke: var(--reality); }
  .strip line.cut { stroke: var(--ink-faint); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .strip line.cut[data-cause='client'] { stroke: var(--warn); }
  .strip line.cut[data-cause='network'] { stroke: var(--highlight); }
  figcaption { display: flex; flex-wrap: wrap; gap: var(--sp-3); font-size: .68rem; color: var(--tx-mut); }
  figcaption .mono { margin-left: auto; }
  .k::before { content: ''; display: inline-block; width: 10px; height: 2px; margin-right: var(--sp-1); vertical-align: middle; background: currentColor; }
  .k.rtt::before { background: var(--intent); }
  .k.lead::before { background: var(--reality); }
  .k.cut::before { background: var(--warn); }
  .incs > li { display: block; padding: 0; }
  .incs summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2) var(--sp-3); min-height: var(--tap); padding: var(--sp-2) var(--sp-3); cursor: pointer; font-size: .8rem; align-content: center; }
  .incs time { color: var(--ink-faint); font-size: .68rem; }
  .incs li[data-sev='warn'] .text, .incs li[data-sev='act'] .text { color: var(--warn-ink, var(--warn)); }
  .chip { font-size: .68rem; padding: 0 var(--sp-2); border: 1px solid var(--line); border-radius: var(--r-s); color: var(--ink-dim); }
  .more { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); padding: 0 var(--sp-3) var(--sp-3); font-size: .78rem; }
  .more p { margin: 0; }
  .more .act { color: var(--ink); font-weight: 500; }
  .more .ev { color: var(--tx-mut); font-size: .68rem; overflow-wrap: anywhere; }
</style>
