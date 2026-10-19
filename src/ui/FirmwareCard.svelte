<script>
  /**
   * FirmwareCard -- Upload firmware, on the machine's System page (DESIGN §10.19).
   *
   * Constraints:
   * - Every row, the status slot and the bar render in every phase, one line
   *   each: no step changes the card's height (§10.12).
   * - The status slot changes on the frame; nothing here animates (§10.13).
   * - The flow and its state are flasher.svelte.js's; this card draws them.
   */
  import { untrack } from 'svelte';
  import { flash, flasher } from '../model/flasher.svelte.js';
  import { machine, linkKind } from '../model/machine.svelte.js';
  import './pane.css';

  const kind = $derived((machine.link.dialed, machine.link.host, linkKind()));
  const host = $derived(kind === 'ws' ? machine.link.host : '');
  const busy = $derived(['checking', 'arming', 'waiting', 'uploading', 'restarting'].includes(flash.phase));
  const imageOk = $derived(!!flash.image && !flash.image.error);
  const pct = $derived(flash.total ? Math.round((100 * flash.sent) / flash.total) : 0);
  const status = $derived(kind === 'ble' ? 'Needs a Wi-Fi link: connect by address' : flash.status);
  const run = $derived(flash.running);
  const img = $derived(imageOk ? [flash.image.version || 'version unknown', flash.image.project, flash.image.date].join(' · ') : '--');
  const file = $derived(flash.file ? flash.file.name + ' · ' + (flash.file.size / 1048576).toFixed(2) + ' MB' : '--');

  // What the machine runs: read on arrival and on every return to live (the restart drops the link).
  $effect(() => {
    if (host && machine.link.phase === 'live') untrack(() => flasher.peek(host));
  });

  let input;
  function chosen(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (f) flasher.pick(f);
  }
</script>

<div class="fw">
  <dl class="pane-facts">
    <dt>Running</dt><dd class="mono" title={run ? run.version + ' · ' + run.slot : null}>{run ? run.version + ' · ' + run.slot : '--'}</dd>
    <dt>File</dt><dd class="mono" title={flash.file?.name}>{file}</dd>
    <dt>Image</dt><dd class="mono" title={imageOk ? img : null}>{img}</dd>
    <dt>Origin</dt><dd data-kind={flash.origin?.kind} title={flash.hash || null}>{flash.origin?.label || '--'}</dd>
  </dl>
  <p class="pane-status" data-phase={kind === 'ble' ? 'fault' : flash.tone} title={status || null} aria-live="polite">{status}</p>
  <div class="bar" role="progressbar" aria-label="Upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}
       class:on={flash.phase === 'uploading' || flash.phase === 'restarting'}><span style:width={pct + '%'}></span></div>
  <div class="acts">
    <input type="file" accept=".bin,application/octet-stream" hidden bind:this={input} onchange={chosen} />
    <button type="button" class="og-btn sm" disabled={busy || kind !== 'ws'} data-tip="A Nucleus .bin" onclick={() => input.click()}>Choose .bin</button>
    {#if flash.phase === 'arming' || flash.phase === 'waiting'}
      <button type="button" class="og-btn sm" onclick={flasher.cancel}>Cancel</button>
    {:else}
      <button type="button" class="og-btn sm primary" disabled={!imageOk || busy || !host}
              data-tip="Then double-press PAIR on the machine" onclick={() => flasher.update(host)}>Update</button>
    {/if}
  </div>
</div>

<style>
  /* The grid seeds a card at its min-content width; the rows ellipsize, so the floor is set here. */
  .fw { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 24rem; padding: var(--sp-3) var(--sp-4); }
  :global(html[data-bucket='1']) .fw { min-width: 0; }
  .fw dd { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fw dd[data-kind='official'] { color: var(--reality); }
  .fw dd[data-kind='unknown'], .fw dd[data-kind='checking'] { color: var(--tx-mut); }
  .bar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; visibility: hidden; }
  .bar.on { visibility: visible; }
  .bar span { display: block; height: 100%; background: var(--intent); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
</style>
