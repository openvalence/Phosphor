<script>
  /**
   * SettingsPane.svelte -- the shell drawer's Settings pane (ph-vdk.53).
   * SHELL ONLY: settings-pane.js registers it with drawer.js.
   *
   * Constraints:
   * - Browser preferences only; nothing here writes to the hub, so there is
   *   no write ladder to show (RENDERING law 5 binds hub writes).
   * - Theme, legibility, units and the class readout are ThemePicker's
   *   (the console Display pane); this pane only hosts it.
   * - The telemetry rate drives wishes.js subscriptionWishes, which reads it
   *   on the next catalog adoption: say so, never imply it applies live.
   * - Every target is at least --tap (RENDERING law 12).
   */
  import ThemePicker from '../ui/ThemePicker.svelte';
  import {
    prefs, setPref, exportBackup, importBackup,
  } from '../model/prefs.js';

  let backup = $state('');
  let note = $state('');
  let confirming = $state(false);

  function doExport() {
    backup = exportBackup();
    confirming = false;
    note = 'Copy this text somewhere safe.';
    navigator.clipboard?.writeText(backup).then(() => { note = 'Copied to the clipboard.'; }, () => {});
  }
  function doImport() {
    if (!confirming) { confirming = true; note = ''; return; }
    try {
      note = 'Restored ' + importBackup(backup) + ' entries; reloading.';
      location.reload();
    } catch (e) {
      note = 'Not restored: ' + e.message;
    }
    confirming = false;
  }
</script>

<div class="set">
  <ThemePicker />

  <section aria-labelledby="set-conn">
    <h3 id="set-conn">Connection</h3>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={$prefs.reconnect} onchange={(e) => setPref('reconnect', e.currentTarget.checked)} />
      <span class="track"></span>Reconnect to the last hub on launch
    </label>
    <label class="rate">
      <span>Telemetry rate, Hz</span>
      <input type="number" class="og-num" min="1" step="1" placeholder="auto" value={$prefs.telemetryHz ?? ''}
             onchange={(e) => setPref('telemetryHz', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
    </label>
    <p class="hint">Position and speed subscriptions; empty is the client default. Never above what each channel advertises. Applies on the next connect.</p>
    <p class="hint">Saved hubs, their nicknames and forgetting one: Phosphor, Hubs.</p>
  </section>

  <section aria-labelledby="set-adv">
    <h3 id="set-adv">Advanced</h3>
    <p class="hint">Backup of preferences, saved hubs and layouts as text. Restoring replaces them and reloads.</p>
    <label class="sr-only" for="set-backup">Backup text</label>
    <textarea id="set-backup" class="mono" rows="4" bind:value={backup} spellcheck="false"></textarea>
    <div class="row">
      <button type="button" class="og-btn" onclick={doExport}>Export</button>
      <button type="button" class="og-btn" disabled={!backup.trim()} onclick={doImport}>
        {confirming ? 'Replace everything?' : 'Import'}
      </button>
      {#if confirming}<button type="button" class="og-btn" onclick={() => (confirming = false)}>Cancel</button>{/if}
    </div>
    {#if note}<p class="hint" role="status">{note}</p>{/if}
  </section>
</div>

<style>
  .set { display: grid; gap: 14px; padding: 8px 10px; }
  section { display: grid; gap: 8px; min-width: 0; }
  h3 { margin: 0; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-dim); }
  .hint { margin: 0; font-size: 11.5px; color: var(--ink-faint); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .og-switch { min-height: var(--tap); justify-self: start; font-size: 12.5px; }
  .hubs { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .hubs li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .nick { flex: 1 1 12ch; min-width: 0; }
  .rate { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
  .rate input { width: 9ch; min-height: var(--tap); }
  input[type="text"], textarea {
    width: 100%;
    min-height: var(--tap);
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: var(--r-s);
    border: 1px solid var(--line);
    background: var(--bg-card);
    color: var(--ink-hi);
  }
  input[type="text"] { font: inherit; font-size: 12.5px; }
  textarea { resize: vertical; font-size: 11px; }
  .meta { flex: 1 1 auto; font-size: 11px; color: var(--ink-faint); overflow-wrap: anywhere; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
</style>
