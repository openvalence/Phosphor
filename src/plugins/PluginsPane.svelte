<script>
  /**
   * PluginsPane.svelte — installed tier-2 plugins: manifest, declared
   * permissions, status, errors, the enable toggle, and each plugin's own
   * settings card.
   *
   * Constraints:
   * - Permissions are DISPLAYED before and after enabling; that display is
   *   the permission model (docs/PLUGINS.md). Never hide one.
   * - An error is never silent: it stays on the plugin's row until it is
   *   reloaded, and the host has already logged it under the plugin's name.
   */
  import { pluginsUi, setPluginEnabled, host } from './plugins.svelte.js';

  const PERM_TEXT = {
    intent: 'write settings, actions and commands through the shadow',
    motion: 'submit motion input (drives the carriage)',
  };
  function permText(p) {
    if (PERM_TEXT[p]) return PERM_TEXT[p];
    const m = /^net\.listen:(\d+)$/.exec(p);
    return m ? 'listen for TCP connections on 127.0.0.1:' + m[1] : p;
  }

  function settingsCard(node, name) {
    const off = host.mountSettings(name, node);
    return { destroy() { off(); } };
  }
</script>

<div class="plugins">
  {#if !pluginsUi.active}
    <p class="empty">Plugins load in the Phosphor app (or a dev build with <code>?plugin=</code>). This page came from a hub, which serves one file.</p>
  {:else if !pluginsUi.list.length}
    <p class="empty">No plugins installed.{#if pluginsUi.dir} Drop a plugin folder into <code>{pluginsUi.dir}</code> and restart.{/if}</p>
  {:else}
    {#if pluginsUi.dir}<p class="dir">Plugins folder: <code>{pluginsUi.dir}</code></p>{/if}
    {#each pluginsUi.list as p (p.key)}
      <section class="plugin og-screen" class:bad={p.error}>
        <header>
          <strong>{p.name}</strong>
          {#if p.version}<span class="mono">{p.version}</span>{/if}
          {#if p.kind}<span class="chip">{p.kind}</span>{/if}
          <span class="chip status-{p.status}">{p.status}</span>
          {#if p.status !== 'invalid'}
            <span class="toggle">
              <label class="og-switch">
                <input type="checkbox" role="switch" aria-checked={p.status === 'active'} checked={p.status === 'active'}
                       onchange={(e) => setPluginEnabled(p.name, e.currentTarget.checked)} />
                <span class="track"></span>
              </label>
              enabled
            </span>
          {/if}
        </header>
        {#if p.description}<p>{p.description}</p>{/if}
        {#if p.error}<p class="err">{p.error}</p>{/if}
        <dl>
          <dt>Permissions</dt>
          <dd>
            {#if p.permissions.length}
              <ul>{#each p.permissions as perm}<li><code>{perm}</code> {permText(perm)}</li>{/each}</ul>
            {:else}read-only{/if}
          </dd>
          {#if p.roles.length}<dt>Roles</dt><dd>{p.roles.join(', ')}</dd>{/if}
          {#if p.channels.length}<dt>Channels</dt><dd class="mono">{p.channels.join(', ')}</dd>{/if}
          {#if p.heroes.length}
            <dt>Cards</dt>
            <dd>{#each p.heroes as h}<span class="chip" class:failed={h.failed}>{h.id}{h.failed ? ' (failed)' : ''}</span>{/each}</dd>
          {/if}
          {#if p.source}<dt>Source</dt><dd class="mono src">{p.source}</dd>{/if}
        </dl>
        {#if p.status === 'active' && p.hasSettings}
          {#key pluginsUi.gen}
            <div class="settings" use:settingsCard={p.name}></div>
          {/key}
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .plugins { display: flex; flex-direction: column; gap: 10px; }
  .plugin { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .plugin.bad { box-shadow: inset 0 0 0 1px var(--bad); }
  header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .toggle { margin-left: auto; display: flex; gap: 6px; align-items: center; min-height: 32px; }
  .chip { font-family: var(--mono); font-size: 11px; padding: 1px 6px; border: 1px solid var(--line-2); margin-right: 4px; }
  .chip.failed, .status-error, .status-invalid { color: var(--bad); border-color: var(--bad); }
  .err { color: var(--bad); font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
  .empty, .dir { color: var(--ink-faint); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; font-size: 13px; }
  dt { color: var(--ink-faint); }
  dd { margin: 0; overflow-wrap: anywhere; }
  ul { margin: 0; padding-left: 16px; }
  .src { font-size: 11px; color: var(--ink-faint); }
</style>
