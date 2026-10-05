<script>
  /**
   * AboutPane.svelte -- what this window is talking to and what it is built
   * from. SHELL ONLY: settings-pane.js registers it with panes.js.
   *
   * Constraints:
   * - Shows what the hub sent and `--` for anything it did not, always in
   *   the body face: mono is for a value, never for its absence (ph-7mw).
   * - The generated vocab carries no registry version, only the protocol
   *   major and the WS subprotocol; those are what is shown.
   */
  import { getVersion } from '@tauri-apps/api/app';
  import { machine } from '../model/machine.svelte.js';
  import { hubTitle } from '../model/format.js';
  import { reportedValue } from '../model/settings.js';
  import { ROLE } from '../model/roles.js';
  import { PROTO_VER, WS_SUBPROTOCOL } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import { pluginsUi } from '../plugins/plugins.svelte.js';
  import CreditLine from '../plugins/CreditLine.svelte';
  import '../ui/pane.css';
  import BP_LICENSE from '../../../ButtplugIO/LICENSE?raw';

  const identity = $derived(machine.link.hubIdentity);
  const nameField = $derived(machine.catalog.model?.byRole?.get(ROLE.identityName)?.[0]);
  const hubName = $derived(hubTitle(identity,
    nameField ? reportedValue(nameField, machine.samples[nameField.channelId]) : '', machine.link.virtual));
  const etag = $derived(machine.catalog.etag || '--');
  let shellVersion = $state('--');
  getVersion().then((v) => { shellVersion = v; }).catch(() => {});
  const PHOSPHOR = { name: 'Phosphor', url: 'https://github.com/openvalence/Phosphor/blob/main/LICENSE', license: 'Apache-2.0' };
  // BSD-3-Clause: binaries must carry the copyright, conditions and disclaimer.
  // The embedded ButtplugIO server ships in every build, so its license text ships here.
  const BUTTPLUG = { name: 'ButtplugIO (buttplug, Nonpolynomial Labs, LLC)', url: 'https://github.com/buttplugio/buttplug/blob/master/LICENSE', license: 'BSD-3-Clause' };
  const notices = $derived(pluginsUi.list.flatMap((p) => p.credits.map((c) => ({ key: p.key + c.name, plugin: p.name, c }))));
  const uiBuild = typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : '--';
</script>

<div class="pane-stack">
  <section class="pane-sec og-screen" aria-labelledby="ab-hub">
    <div class="pane-head"><h2 id="ab-hub">Hub</h2></div>
    <dl class="pane-facts about">
      <dt>Hub</dt><dd>{hubName}</dd>
      <dt>Product</dt><dd>{identity?.product || '--'}</dd>
      <dt>Firmware</dt><dd class:mono={!!identity?.fw_version}>{identity?.fw_version || '--'}</dd>
      <dt>Endpoint</dt><dd class:mono={!!machine.link.dialed}>{machine.link.dialed || '--'}</dd>
      <dt>Catalog etag</dt><dd class:mono={etag !== '--'}>{etag}</dd>
    </dl>
  </section>
  <section class="pane-sec og-screen" aria-labelledby="ab-build">
    <div class="pane-head"><h2 id="ab-build">Phosphor</h2></div>
    <dl class="pane-facts">
      <dt>Shell</dt><dd class:mono={shellVersion !== '--'}>{shellVersion}</dd>
      <dt>UI build</dt><dd class="mono">{uiBuild}</dd>
      <dt>Protocol</dt><dd class="mono">v{PROTO_VER} ({WS_SUBPROTOCOL})</dd>
    </dl>
  </section>
  <section class="pane-sec og-screen" aria-labelledby="ab-notices">
    <div class="pane-head"><h2 id="ab-notices">Notices</h2></div>
    <dl class="pane-facts">
      <dt>Phosphor</dt><dd><CreditLine credit={PHOSPHOR} /></dd>
      <dt>ButtplugIO</dt><dd><CreditLine credit={BUTTPLUG} /><details class="lic"><summary>License text</summary><pre>{BP_LICENSE}</pre></details></dd>
      {#each notices as n (n.key)}<dt>{n.plugin}</dt><dd><CreditLine credit={n.c} lead="after " /></dd>{/each}
    </dl>
  </section>
</div>

<style>
  .lic { margin-top: var(--sp-3); }
  .lic pre { white-space: pre-wrap; font-size: 0.8em; opacity: 0.8; }
</style>
