<script>
  /**
   * PluginsPane.svelte -- installed tier-2 plugins: where each came from, its
   * declared permissions, status, last error, the enable switch, a reload,
   * and its own settings card.
   *
   * Constraints:
   * - Permissions are DISPLAYED before and after enabling; that display is
   *   the permission model (docs/PLUGINS.md). Never hide one.
   * - An error is never silent: it holds the plugin's error slot until the
   *   plugin is reloaded, and the host has already logged it under its name.
   *   The slot is always rendered, so an error arriving moves nothing.
   * - The switch shows the operator's choice (plugins.svelte.js's disabled
   *   set, persisted); the status chip shows what the host made of it.
   * - Plugin faults read amber: red is the hazard color.
   * - Show tab is the host's per-plugin page pref (PAGES_KEY); the sidebar
   *   follows it on the host's change event.
   */
  import { pluginsUi, setPluginEnabled, isPluginDisabled, host } from './plugins.svelte.js';
  import CreditLine from './CreditLine.svelte';
  import '../ui/pane.css';

  const PERM_TEXT = {
    intent: 'write settings, actions and commands',
    motion: 'submit motion input',
  };
  function permText(p) {
    if (PERM_TEXT[p]) return PERM_TEXT[p];
    const m = /^net\.listen:(\d+)$/.exec(p);
    return m ? 'listen on TCP 127.0.0.1:' + m[1] : p;
  }
  // Where a plugin came from: bundled with Phosphor, or a folder on disk.
  const ORIGIN = { factory: 'factory', 'built-in': 'built-in' };

  function settingsCard(node, name) {
    const off = host.mountSettings(name, node);
    return { destroy() { off(); } };
  }

  // Re-runs activate() on the loaded module: the error slot clears.
  function reload(name) {
    host.setEnabled(name, false);
    host.setEnabled(name, true);
  }
  const enabled = (name, _gen) => !isPluginDisabled(name);
</script>

<div class="pane-stack plugins">
  {#if !pluginsUi.active}
    <p class="pane-empty">Plugins load in the Phosphor app</p>
  {:else}
    <section class="pane-sec og-screen" aria-labelledby="pl-folder">
      <div class="pane-head"><h2 id="pl-folder">Installed</h2><span class="mono count">{pluginsUi.list.length}</span></div>
      <dl class="pane-facts">
        <dt>Plugins folder</dt><dd class="mono">{pluginsUi.dir || '--'}</dd>
      </dl>
      <p class="pane-note">Drop a plugin folder here and restart</p>
    </section>

    {#each pluginsUi.list as p (p.key)}
      {@const origin = ORIGIN[p.source]}
      <section class="pane-sec og-panel plugin" aria-label={p.name}>
        <div class="pane-head">
          <h3>{p.name}</h3>
          {#if p.version}<span class="mono ver">{p.version}</span>{/if}
          <span class="chip">{origin || 'folder'}</span>
          <span class="chip status" data-status={p.status}>{p.status}</span>
          {#if p.status !== 'invalid'}
            <label class="og-switch">
              <input type="checkbox" role="switch" checked={enabled(p.name, pluginsUi.gen)}
                     onchange={(e) => setPluginEnabled(p.name, e.currentTarget.checked)} />
              <span class="track"></span>enabled
            </label>
          {/if}
        </div>
        {#if p.description}<p class="pane-note">{p.description}</p>{/if}
        {#each p.credits as c}<p class="pane-note"><CreditLine credit={c} lead="after " /></p>{/each}
        <dl class="pane-facts">
          {#if p.kind}<dt>Kind</dt><dd>{p.kind}</dd>{/if}
          <dt>Permissions</dt>
          <dd>
            {#if p.permissions.length}
              <ul class="perms">{#each p.permissions as perm}<li><code>{perm}</code> {permText(perm)}</li>{/each}</ul>
            {:else}read-only{/if}
          </dd>
          {#if p.roles.length}<dt>Roles</dt><dd>{p.roles.join(', ')}</dd>{/if}
          {#if p.channels.length}<dt>Channels</dt><dd class="mono">{p.channels.join(', ')}</dd>{/if}
          {#if p.heroes.length}
            <dt>Cards</dt>
            <dd>{#each p.heroes as h}<span class="chip" class:failed={h.failed}>{h.id}{h.failed ? ' (failed)' : ''}</span>{/each}</dd>
          {/if}
          {#if p.pages.length}
            <dt>Page</dt>
            <dd class="page-row">
              {#each p.pages as pg}<span class="chip" class:failed={pg.failed}>{pg.label}{pg.failed ? ' (failed)' : ''}</span>{/each}
              <label class="og-switch">
                <input type="checkbox" role="switch" checked={p.pageShown}
                       onchange={(e) => host.setPageShown(p.key, e.currentTarget.checked)} />
                <span class="track"></span>Show tab
              </label>
            </dd>
          {/if}
          {#if !origin && p.source}<dt>Source</dt><dd class="mono src">{p.source}</dd>{/if}
        </dl>
        <div class="err-row">
          <p class="pane-status" role="status" data-phase={p.error ? 'fault' : null} title={p.error || ''}>
            {p.error ? 'Last error: ' + p.error : 'No errors'}
          </p>
          <button type="button" class="og-btn sm" disabled={p.status === 'invalid' || !enabled(p.name, pluginsUi.gen)}
                  title={p.status === 'invalid' ? 'Invalid manifest' : !enabled(p.name, pluginsUi.gen) ? 'Plugin disabled' : ''}
                  onclick={() => reload(p.name)}>Reload</button>
        </div>
        {#if p.status === 'active' && p.hasSettings}
          {#key pluginsUi.gen}
            <div class="settings" use:settingsCard={p.name}></div>
          {/key}
        {/if}
      </section>
    {:else}
      <p class="pane-empty">No plugins installed</p>
    {/each}
  {/if}
</div>

<style>
  .count, .ver { font-size: .75rem; color: var(--tx-mut); }
  .chip { font-family: var(--mono); font-size: .68rem; padding: 1px 6px; border: 1px solid var(--line-2); border-radius: var(--r-s); color: var(--ink-dim); }
  /* Fixed width: active, disabled and error swap in place. */
  .chip.status { min-width: 10ch; text-align: center; }
  .chip.status[data-status='active'] { color: var(--reality); border-color: var(--reality); }
  .chip.failed, .chip.status[data-status='error'], .chip.status[data-status='invalid'] { color: var(--warn); border-color: var(--warn); }
  .og-switch { font-size: .78rem; min-height: 30px; }
  .page-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .perms { margin: 0; padding-left: 16px; }
  .src { font-size: .7rem; color: var(--tx-mut); }
  .err-row { display: flex; align-items: flex-start; gap: 8px; }
  .err-row .pane-status { flex: 1; min-width: 0; font-family: var(--mono); }
  code { font-family: var(--mono); font-size: .85em; }
  @media (pointer: coarse) { .og-switch { min-height: 40px; } }
</style>
