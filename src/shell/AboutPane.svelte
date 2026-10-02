<script>
  /**
   * AboutPane.svelte -- what this window is talking to and what it is built
   * from. SHELL ONLY: settings-pane.js registers it with panes.js.
   *
   * Constraints:
   * - Shows what the hub sent and `--` for anything it did not.
   * - The generated vocab carries no registry version, only the protocol
   *   major and the WS subprotocol; those are what is shown.
   */
  import { getVersion } from '@tauri-apps/api/app';
  import { machine } from '../model/machine.svelte.js';
  import { hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import { PROTO_VER, WS_SUBPROTOCOL } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import '../ui/pane.css';

  const identity = $derived(machine.link.hubIdentity);
  const nameField = $derived(machine.catalog.model?.byRole?.get(ROLE.identityName)?.[0]);
  const hubName = $derived(hubTitle(identity,
    nameField ? reportedValue(nameField, machine.samples[nameField.channelId]) : ''));
  const etag = $derived(machine.catalog.etag || '--');
  let shellVersion = $state('--');
  getVersion().then((v) => { shellVersion = v; }).catch(() => {});
  const uiBuild = typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : '--';
</script>

<div class="pane-stack">
  <section class="pane-sec og-screen" aria-labelledby="ab-hub">
    <div class="pane-head"><h2 id="ab-hub">Hub</h2></div>
    <dl class="pane-facts about">
      <dt>Hub</dt><dd>{hubName}</dd>
      <dt>Product</dt><dd>{identity?.product || '--'}</dd>
      <dt>Firmware</dt><dd class="mono">{identity?.fw_version || '--'}</dd>
      <dt>Endpoint</dt><dd class="mono">{machine.link.dialed || '--'}</dd>
      <dt>Catalog etag</dt><dd class="mono">{etag}</dd>
    </dl>
  </section>
  <section class="pane-sec og-screen" aria-labelledby="ab-build">
    <div class="pane-head"><h2 id="ab-build">Phosphor</h2></div>
    <dl class="pane-facts">
      <dt>Shell</dt><dd class="mono">{shellVersion}</dd>
      <dt>UI build</dt><dd class="mono">{uiBuild}</dd>
      <dt>Protocol</dt><dd class="mono">v{PROTO_VER} ({WS_SUBPROTOCOL})</dd>
    </dl>
  </section>
</div>
