<script>
  /**
   * SettingsPane.svelte -- Phosphor > Settings (ph-vdk.53). SHELL ONLY:
   * settings-pane.js registers it with panes.js.
   *
   * Constraints:
   * - Browser preferences only; nothing here writes to the hub, so there is
   *   no write ladder to show (RENDERING law 5 binds hub writes).
   * - Theme, legibility, units and the class readout are ThemePicker's
   *   (the console Display pane); saved hubs are the Hubs pane's. This pane
   *   only hosts the one and points at the other.
   * - The telemetry rate drives wishes.js subscriptionWishes, which reads it
   *   on the next catalog adoption: say so, never imply it applies live.
   * - Every target is at least --tap (RENDERING law 12); the backup's status
   *   line is a fixed slot and Cancel always renders.
   */
  import ThemePicker from '../ui/ThemePicker.svelte';
  import { prefs, setPref, exportBackup, importBackup } from '../model/prefs.js';
  import '../ui/pane.css';

  let backup = $state('');
  let note = $state('');
  let phase = $state(null);
  let confirming = $state(false);

  function doExport() {
    backup = exportBackup();
    confirming = false;
    note = 'Copy this text somewhere safe.';
    phase = null;
    navigator.clipboard?.writeText(backup).then(() => { note = 'Copied to the clipboard.'; phase = 'settled'; }, () => {});
  }
  function doImport() {
    if (!confirming) { confirming = true; note = 'Import replaces every preference, saved hub and layout, then reloads. Press again to confirm.'; phase = 'pending'; return; }
    try {
      note = 'Restored ' + importBackup(backup) + ' entries; reloading.';
      phase = 'settled';
      location.reload();
    } catch (e) {
      note = 'Not restored: ' + e.message;
      phase = 'fault';
    }
    confirming = false;
  }
  function cancel() {
    confirming = false;
    note = '';
    phase = null;
  }
  const status = $derived(note || 'Export copies a backup to the clipboard; paste one above and Import to restore it.');
</script>

<div class="pane-stack set">
  <ThemePicker />

  <section class="pane-sec og-panel" aria-labelledby="set-conn">
    <div class="pane-head"><h2 id="set-conn">Connection</h2></div>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={$prefs.reconnect} onchange={(e) => setPref('reconnect', e.currentTarget.checked)} />
      <span class="track"></span>Reconnect to the last hub on launch
    </label>
    <label class="rate">
      <span>Telemetry rate, Hz</span>
      <input type="number" class="og-num" min="1" step="1" placeholder="auto" value={$prefs.telemetryHz ?? ''}
             onchange={(e) => setPref('telemetryHz', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
    </label>
    <p class="pane-note">Position and speed subscriptions; empty is the client default. Never above what each channel advertises. Applies on the next connect.</p>
    <p class="pane-note">Saved hubs, their nicknames and forgetting one live in Phosphor, Hubs.</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="set-adv">
    <div class="pane-head"><h2 id="set-adv">Backup</h2></div>
    <p class="pane-note">Preferences, saved hubs and layouts as text. Restoring replaces them and reloads.</p>
    <label class="sr-only" for="set-backup">Backup text</label>
    <textarea id="set-backup" class="mono" rows="4" bind:value={backup} spellcheck="false"></textarea>
    <div class="row">
      <button type="button" class="og-btn" onclick={doExport}>Export</button>
      <button type="button" class="og-btn" disabled={!backup.trim()} onclick={doImport}>
        {confirming ? 'Replace everything' : 'Import'}
      </button>
      <button type="button" class="og-btn" disabled={!confirming} onclick={cancel}>Cancel</button>
    </div>
    <p class="pane-status" role="status" data-phase={phase} title={status}>{status}</p>
  </section>
</div>

<style>
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .og-switch { min-height: var(--tap); align-self: flex-start; font-size: .8rem; }
  .rate { display: flex; align-items: center; gap: 10px; font-size: .8rem; color: var(--tx-mut); }
  .rate input { width: 9ch; min-height: var(--tap); }
  textarea {
    width: 100%;
    min-height: var(--tap);
    padding: 6px 8px;
    border-radius: var(--r-s);
    border: 1px solid var(--line-1);
    background: var(--bg-sunken);
    box-shadow: inset 0 2px 5px rgba(0,0,0,.6);
    color: var(--tx-val);
    resize: vertical;
    font-size: .72rem;
  }
  textarea:focus { outline: none; border-color: var(--reality); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
</style>
