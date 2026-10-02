<script>
  /**
   * AboutPane.svelte -- what this window is talking to and what it is built
   * from. SHELL ONLY: settings-pane.js registers it with panes.js.
   *
   * Constraints:
   * - Shows what the hub sent and `--` for anything it did not.
   */
  import { getVersion } from '@tauri-apps/api/app';
  import { machine } from '../model/machine.svelte.js';
  import { hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';

  const identity = $derived(machine.link.hubIdentity);
  const nameField = $derived(machine.catalog.model?.byRole?.get(ROLE.identityName)?.[0]);
  const hubName = $derived(hubTitle(identity,
    nameField ? reportedValue(nameField, machine.samples[nameField.channelId]) : ''));
  let shellVersion = $state('--');
  getVersion().then((v) => { shellVersion = v; }).catch(() => {});
  const uiBuild = typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : '--';
</script>

<dl class="about">
  <dt>Hub</dt><dd>{hubName}</dd>
  <dt>Product</dt><dd>{identity?.product || '--'}</dd>
  <dt>Firmware</dt><dd class="mono">{identity?.fw_version || '--'}</dd>
  <dt>Endpoint</dt><dd class="mono">{machine.link.dialed || '--'}</dd>
  <dt>Shell</dt><dd class="mono">{shellVersion}</dd>
  <dt>UI build</dt><dd class="mono">{uiBuild}</dd>
</dl>

<style>
  .about {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 16px;
    margin: 0;
  }
  .about dd { margin: 0; overflow-wrap: anywhere; }
</style>
