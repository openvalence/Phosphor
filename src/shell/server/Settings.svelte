<script>
  /**
   * Settings.svelte -- the buttplug server's saved settings (bp_settings,
   * docs/BUTTPLUG.md).
   *
   * Constraints:
   * - Every input shows what bp_settings_set saved. A change is put back in
   *   the DOM at once and arrives only with the saved answer (law 4); the
   *   ladder says what is being saved.
   * - The port and the managers lock while the server runs (the server
   *   refuses them), so the saved settings always describe the running one.
   */
  let { s, bp } = $props();

  const MANAGERS = [
    ['ble', 'Bluetooth LE'],
    ['serial', 'serial port'],
    ['hid', 'HID'],
    ['machine', 'the machine (hub live)'],
  ];
  const LEVELS = ['error', 'warn', 'info', 'debug'];

  const st = $derived(s.settings);
  const busy = $derived(!s.ready || !st || s.set.phase === 'pending');

  function flip(e, k) {
    e.preventDefault();
    bp.saveSettings({ [k]: !st[k] });
  }
  function commit(e, k, parse = (v) => v) {
    const v = parse(e.currentTarget.value);
    e.currentTarget.value = String(st[k]);
    bp.saveSettings({ [k]: v });
  }
</script>

{#if !st}
  <p class="sp-note">{s.set.reason || 'reading settings…'}</p>
{:else}
  <div class="sp-form">
    <label class="sp-field">port
      <input class="mono" type="number" min="1" max="65535" value={st.port}
             disabled={busy || s.running} onchange={(e) => commit(e, 'port', Number)} />
    </label>
    <label class="sp-check">
      <input type="checkbox" checked={st.start_on_launch} disabled={busy}
             onclick={(e) => flip(e, 'start_on_launch')} />
      start the server when Phosphor opens
    </label>
    <fieldset class="sp-group" disabled={busy || s.running}>
      <legend>find devices over</legend>
      {#each MANAGERS as [k, label]}
        <label class="sp-check">
          <input type="checkbox" checked={st[k]} onclick={(e) => flip(e, k)} />
          {label}
        </label>
      {/each}
    </fieldset>
    {#if s.running}<p class="sp-note">stop the server to edit</p>{/if}
    <label class="sp-field">log level
      <select value={st.log_level} disabled={busy} onchange={(e) => commit(e, 'log_level')}>
        {#each LEVELS as l}<option value={l}>{l}</option>{/each}
      </select>
    </label>
    <p class="sp-note">raw device messages: not in spec v4</p>
    {#if s.set.reason}<span class="sp-ladder" data-phase={s.set.phase}>{s.set.reason}</span>{/if}
  </div>
{/if}

<style>
  .sp-form { display: grid; gap: var(--sp-3); justify-items: start; }
  .sp-group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-4);
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .sp-group legend { color: var(--ink-dim); font-size: .72rem; padding: 0 var(--sp-2); }
</style>
