/**
 * settings-pane.js -- saved-hub upkeep, the launch redial, and the Settings
 * pane's drawer registration. SHELL ONLY: main.js imports it from the shell
 * branch.
 *
 * Constraints:
 * - A hub is recorded only on a LIVE WS session; a BLE address is not a
 *   dialable endpoint, and a BLE session that hops to WS is recorded then.
 * - The redial dials the saved host AND port exactly (ph-dwy).
 */
import { get, toStore } from 'svelte/store';
import { connect, machine } from '../model/machine.svelte.js';
import { endpointLabel, setAutorange } from '../model/format.js';
import { prefs, savedHubs, rememberHub, launchTarget } from '../model/prefs.js';
import SettingsPane from './SettingsPane.svelte';

prefs.subscribe((p) => setAutorange(p.autorange));

// ShellStrip's keys, read only: the transport last chosen, and the port-less
// host saved before this file existed.
const shellKey = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const target = launchTarget({ ...get(prefs), mode: shellKey('shell_mode'), hubs: get(savedHubs), legacyHost: shellKey('shell_host') });
if (target) connect(target);

toStore(() => machine.link.phase).subscribe((phase) => {
  const l = machine.link;
  if (phase === 'live' && l.dialed === endpointLabel(l.host, l.port, null)) {
    rememberHub({ identity: l.hubIdentity, host: l.host, port: l.port });
  }
});

// The drawer is a sibling's file: absent, the pane mounts nowhere (glob, not
// import(), so a missing file is not a build error).
const drawer = import.meta.glob('./drawer.js')['./drawer.js'];
if (drawer) {
  drawer().then((m) => m.registerDrawerPane({ id: 'settings', label: 'Settings', component: SettingsPane }));
} else {
  console.info('settings: no shell drawer (src/shell/drawer.js), the Settings pane is not mounted');
}
