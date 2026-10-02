<script>
  /**
   * SettingsPane.svelte -- the shell drawer's Settings pane (ph-vdk.53).
   * SHELL ONLY: settings-pane.js registers it with drawer.js.
   *
   * Constraints:
   * - Browser preferences only; nothing here writes to the hub, so there is
   *   no write ladder to show (RENDERING law 5 binds hub writes).
   * - Theme, hi-vis and terse are ThemePicker's; this pane only hosts it.
   * - No control that drives nothing: the telemetry rate preference stays
   *   hidden until machine.svelte.js reads telemetryRate() (prefs.js).
   * - Every target is at least --tap (RENDERING law 12).
   */
  import ThemePicker from '../ui/ThemePicker.svelte';
  import { since } from '../model/format.js';
  import {
    prefs, setPref, savedHubs, renameHub, forgetHub, hubLabel, exportBackup, importBackup,
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
  <section aria-labelledby="set-app">
    <h3 id="set-app">Appearance</h3>
    <ThemePicker />
  </section>

  <section aria-labelledby="set-disp">
    <h3 id="set-disp">Display</h3>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={$prefs.autorange} onchange={(e) => setPref('autorange', e.currentTarget.checked)} />
      <span class="track"></span>Autorange units
    </label>
    <p class="hint">Shows 85 mV for a reading of 0.085 V. Display only; what is sent to the machine never changes.</p>
    <p class="hint">Units: metric, the only system today.</p>
  </section>

  <section aria-labelledby="set-conn">
    <h3 id="set-conn">Connection</h3>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={$prefs.reconnect} onchange={(e) => setPref('reconnect', e.currentTarget.checked)} />
      <span class="track"></span>Reconnect to the last hub on launch
    </label>
    {#if $savedHubs.length === 0}
      <p class="hint">No saved hubs yet. A hub is saved once it connects over WiFi.</p>
    {:else}
      <ul class="hubs">
        {#each $savedHubs as h (h.id)}
          <li>
            <label class="nick">
              <span class="sr-only">Nickname for {hubLabel(h)}</span>
              <input type="text" value={h.nickname} placeholder={h.name || 'Nickname'} maxlength="40"
                     onchange={(e) => renameHub(h.id, e.currentTarget.value)} />
            </label>
            <span class="meta mono">{h.host}:{h.port} · {since(h.lastSeen)} ago</span>
            <button type="button" class="og-btn" onclick={() => forgetHub(h.id)} aria-label={'Forget ' + hubLabel(h)}>Forget</button>
          </li>
        {/each}
      </ul>
    {/if}
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
