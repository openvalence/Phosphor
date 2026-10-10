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
   * - Window shows only where the close gate exists: never on a phone shell.
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
    note = 'Backup ready';
    phase = null;
    navigator.clipboard?.writeText(backup).then(() => { note = 'Backup copied'; phase = 'settled'; }, () => {});
  }
  function doImport() {
    if (!confirming) { confirming = true; note = 'Replaces preferences, hubs and layouts, then reloads'; phase = 'pending'; return; }
    try {
      note = 'Restored ' + importBackup(backup) + ' entries, reloading';
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
  const status = $derived(note);
  const WINDOWED = !['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM);
</script>

<div class="pane-stack set">
  <ThemePicker />

  <section class="pane-sec og-panel" aria-labelledby="set-conn">
    <div class="pane-head"><h2 id="set-conn">Connection</h2></div>
    <label class="og-switch" data-search-key="reconnect">
      <input type="checkbox" role="switch" checked={$prefs.reconnect} onchange={(e) => setPref('reconnect', e.currentTarget.checked)} />
      <span class="track"></span>Reconnect to the last hub on launch
    </label>
    <label class="og-switch" data-search-key="estop-broadcast">
      <input type="checkbox" role="switch" checked={$prefs.estopDatagram} onchange={(e) => setPref('estopDatagram', e.currentTarget.checked)} />
      <span class="track"></span>Broadcast e-stop to every hub on the LAN
    </label>
    <label class="rate" data-search-key="telemetry-rate">
      <span>Telemetry rate, Hz</span>
      <input type="number" class="og-num" min="1" step="1" placeholder="auto" value={$prefs.telemetryHz ?? ''}
             onchange={(e) => setPref('telemetryHz', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
    </label>
    <p class="pane-note">Applies on next connect, capped per channel</p>
  </section>

  {#if WINDOWED}
    <section class="pane-sec og-panel" aria-labelledby="set-win">
      <div class="pane-head"><h2 id="set-win">Window</h2></div>
      <label class="og-switch" data-search-key="close-idle">
        <input type="checkbox" role="switch" checked={$prefs.closeIdle} onchange={(e) => setPref('closeIdle', e.currentTarget.checked)} />
        <span class="track"></span>Close immediately when idle
      </label>
    </section>
  {/if}

  <section class="pane-sec og-panel" aria-labelledby="set-adv">
    <div class="pane-head"><h2 id="set-adv" data-search-key="backup">Backup</h2></div>
    <p class="pane-note">Preferences, saved hubs and layouts as text</p>
    <label class="sr-only" for="set-backup">Backup text</label>
    <textarea id="set-backup" class="mono" rows="4" bind:value={backup} spellcheck="false"></textarea>
    <div class="row">
      <button type="button" class="og-btn" onclick={doExport}>Export</button>
      <button type="button" class="og-btn" disabled={!backup.trim()} onclick={doImport}>
        {confirming ? 'Replace everything' : 'Import'}
      </button>
      <button type="button" class="og-btn" disabled={!confirming} onclick={cancel}>Cancel</button>
    </div>
    <p class="pane-status" role="status" data-phase={phase} data-tip={status}>{status}</p>
  </section>
</div>

<style>
  .row { display: flex; flex-wrap: wrap; gap: var(--sp-3); }
  .og-switch { min-height: var(--tap); align-self: flex-start; font-size: .8rem; }
  .rate { display: flex; align-items: center; gap: var(--sp-3); font-size: .8rem; color: var(--tx-mut); }
  .rate input { width: 9ch; min-height: var(--tap); }
  textarea {
    width: 100%;
    min-height: var(--tap);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-s);
    border: 1px solid var(--line-1);
    background: var(--bg-sunken);
    box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6);
    color: var(--tx-val);
    resize: vertical;
    font-size: .72rem;
  }
  textarea:focus { outline: none; border-color: var(--highlight); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
</style>
