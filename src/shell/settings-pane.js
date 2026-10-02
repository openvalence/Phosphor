/**
 * settings-pane.js -- saved-hub upkeep, the launch redial, and the shell's
 * Server, Settings and About panes (panes.js; ShellStrip registers Hubs).
 * SHELL ONLY: main.js imports it from the shell branch.
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
import { registerPane } from './panes.js';
import SettingsPane from './SettingsPane.svelte';
import ServerPane from './ServerPane.svelte';
import AboutPane from './AboutPane.svelte';

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

registerPane({ id: 'server', label: 'Server', component: ServerPane });
registerPane({ id: 'settings', label: 'Settings', component: SettingsPane });
registerPane({ id: 'about', label: 'About', component: AboutPane });
