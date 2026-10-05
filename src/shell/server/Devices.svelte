<script>
  /**
   * Devices.svelte -- the buttplug server's devices: a timed scan, connected
   * devices (the machine first) and the ones the saved device config
   * remembers, each with its detail, sensor readings, a name override, and a
   * disconnect or forget (docs/BUTTPLUG.md).
   *
   * Constraints:
   * - Shows bp_devices and bp://devices only. The name field shows the saved
   *   override; a change is put back until the device list carries it (law 4).
   * - The machine's identity is fixed and it leaves only with the hub, so it
   *   offers no rename, disconnect or forget.
   * - A sensor reading is a fresh answer each time; a failed read keeps the
   *   last value, dimmed, with the reason (law 8). Nothing is shown before the
   *   first answer (law 9).
   */
  import { SCAN_S } from '../bp-server.js';

  let { s, bp } = $props();

  let open = $state({});
  const order = (d) => (d.kind === 'machine' ? 0 : 1);
  const live = $derived(s.devices.filter((d) => d.connected).sort((a, b) => order(a) - order(b)));
  const kept = $derived(s.devices.filter((d) => !d.connected));
  const sensors = (d) => d.controls.filter((c) => c.kind === 'sensor');
  const outputs = (d) => d.controls.filter((c) => c.kind !== 'sensor');
  const op = (kind, d) => s.ops[kind + ':' + d.key];
  const reading = (d, c) => s.reads[d.key + ':' + c.feature + ':' + c.type];

  function toggle(d) {
    open[d.key] = !open[d.key];
    if (open[d.key] && d.connected) for (const c of sensors(d)) bp.read(d, c);
  }
  function rename(e, d) {
    const v = e.currentTarget.value;
    e.currentTarget.value = d.display_name ?? '';
    bp.rename(d.key, v);
  }
</script>

<div class="sp-row">
  <button class="og-btn sm sp-btn" disabled={!s.running || s.scan.phase === 'pending'}
          onclick={() => bp.scan(!s.scanning)}>{s.scanning ? 'Stop scan' : 'Scan for toys'}</button>
  {#if s.scanning}<span class="sp-note">scanning; stops by itself after {SCAN_S} s</span>{/if}
  {#if !s.running}<span class="sp-note">server stopped</span>{/if}
  {#if s.scan.reason}<span class="sp-ladder" data-phase={s.scan.phase}>{s.scan.reason}</span>{/if}
</div>

{#snippet device(d)}
  {@const fixed = d.kind === 'machine'}
  <li class="dv" data-kind={d.kind} data-on={d.connected}>
    <button class="dv-head" aria-expanded={!!open[d.key]} onclick={() => toggle(d)}>
      <span class="dv-kind mono">{d.kind}</span>
      <span class="dv-name">{d.name}</span>
      <span class="dv-conn">{d.connected ? 'connected' : 'not connected'}</span>
    </button>
    {#if open[d.key]}
      <div class="dv-body">
        <dl class="dv-facts mono">
          <dt>protocol</dt><dd>{d.protocol}</dd>
          <dt>address</dt><dd>{d.address}</dd>
          <dt>key</dt><dd>{d.key}</dd>
        </dl>
        {#if fixed}
          <p class="sp-note">follows the hub link</p>
        {:else}
          <div class="sp-row">
            <label class="sp-field">name
              <input value={d.display_name ?? ''} placeholder={d.device_name}
                     disabled={op('rename', d)?.phase === 'pending'} onchange={(e) => rename(e, d)} />
            </label>
            {#if op('rename', d)?.reason}<span class="sp-ladder" data-phase={op('rename', d).phase}>{op('rename', d).reason}</span>{/if}
          </div>
          <p class="sp-note">applies on the toy's next connection</p>
        {/if}
        {#if d.connected}
          {#if outputs(d).length}
            <table class="dv-table">
              <thead><tr><th>feature</th><th>output</th><th>range</th></tr></thead>
              <tbody>
                {#each outputs(d) as c (c.feature + c.type)}
                  <tr>
                    <td>{c.feature}{c.description ? ' ' + c.description : ''}</td>
                    <td class="mono">{c.type}</td>
                    <td class="mono">{c.range ? c.range[0] + ' to ' + c.range[1] : 'none'}{c.ms ? ', ' + c.ms[0] + ' to ' + c.ms[1] + ' ms' : ''}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#each sensors(d) as c (c.feature + c.type)}
            {@const r = reading(d, c)}
            <div class="sp-row">
              <span class="dv-sensor">{c.type}</span>
              <span class="mono" class:dv-stale={r?.phase === 'fault'}>{r?.value ?? 'not read yet'}</span>
              <button class="og-btn sm sp-btn" disabled={r?.phase === 'pending'} onclick={() => bp.read(d, c)}>Read</button>
              {#if r?.reason}<span class="sp-ladder" data-phase={r.phase}>{r.reason}</span>{/if}
            </div>
          {/each}
          {#if !d.controls.length}<p class="sp-note">no outputs or readable inputs</p>{/if}
          {#if !fixed}
            <div class="sp-row">
              <button class="og-btn sm sp-btn" disabled={op('disconnect', d)?.phase === 'pending'}
                      onclick={() => bp.disconnect(d)}>Disconnect</button>
              {#if op('disconnect', d)?.reason}<span class="sp-ladder" data-phase={op('disconnect', d).phase}>{op('disconnect', d).reason}</span>{/if}
            </div>
          {/if}
        {:else if !fixed}
          <div class="sp-row">
            <button class="og-btn sm sp-btn" disabled={op('forget', d)?.phase === 'pending'}
                    onclick={() => bp.forget(d.key)}>Forget</button>
            {#if op('forget', d)?.reason}<span class="sp-ladder" data-phase={op('forget', d).phase}>{op('forget', d).reason}</span>{/if}
          </div>
        {/if}
      </div>
    {/if}
  </li>
{/snippet}

<ul class="dv-list">
  {#each live as d (d.key)}{@render device(d)}{:else}<li class="sp-note">no devices connected</li>{/each}
</ul>
{#if kept.length}
  <p class="dv-sub">remembered, not connected</p>
  <ul class="dv-list">
    {#each kept as d (d.key)}{@render device(d)}{/each}
  </ul>
{/if}

<style>
  .dv-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-1); }
  .dv-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    min-height: 40px;
    padding: 0 var(--sp-3);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--ink);
    text-align: left;
  }
  .dv-head:hover { border-color: var(--line); }
  .dv-kind { color: var(--ink-faint); text-transform: uppercase; font-size: .68rem; min-width: 7ch; }
  .dv[data-kind='machine'] .dv-kind { color: var(--reality); }
  .dv-name { font-weight: 600; }
  .dv-conn { color: var(--ink-faint); font-size: .72rem; }
  .dv[data-on='true'] .dv-conn { color: var(--reality); }
  .dv[data-on='false'] .dv-name { color: var(--ink-dim); }
  .dv-body { display: grid; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-3); border-left: 2px solid var(--line); margin-left: var(--sp-3); }
  .dv-facts { display: grid; grid-template-columns: auto 1fr; gap: var(--sp-1) var(--sp-3); margin: 0; font-size: .72rem; }
  .dv-facts dt { color: var(--ink-faint); }
  .dv-facts dd { margin: 0; overflow-wrap: anywhere; }
  .dv-table { border-collapse: collapse; font-size: .72rem; }
  .dv-table th { color: var(--ink-faint); font-weight: normal; text-align: left; padding: var(--sp-1) var(--sp-3) var(--sp-1) 0; }
  .dv-table td { padding: var(--sp-1) var(--sp-3) var(--sp-1) 0; }
  .dv-sensor { min-width: 9ch; color: var(--ink-dim); }
  .dv-stale { opacity: .5; }
  .dv-sub { margin: var(--sp-2) 0 0; color: var(--ink-dim); font-size: .72rem; }
</style>
