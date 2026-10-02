/**
 * panes.js -- the shell's panes, shown as the sidebar's Phosphor tabs
 * (App.svelte). SHELL ONLY: nothing on the hub-served page registers here.
 *
 *   registerPane({ id: 'settings', label: 'Settings', component: MySettings });
 *   registerPane({ id: 'hubs', label: 'Hubs', snippet: hubsPane });
 *
 * Built-ins sort as hubs, server, settings, about; any other id sits before
 * About in registration order. Registering an id twice keeps the last. A
 * component mounts with no props; a snippet renders with no arguments, so
 * state it closes over outlives the pane.
 */
import { writable } from 'svelte/store';

const ORDER = ['hubs', 'server', 'settings', 'about'];
const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length - 1.5);

export const panes = writable([]);

export function registerPane({ id, label, component, snippet }) {
  panes.update((ps) => [...ps.filter((p) => p.id !== id), { id, label, component, snippet }]
    .sort((a, b) => rank(a.id) - rank(b.id)));
}

// Deprecated alias for the drawer era; planned removal one release after
// ph-e82.16 lands.
export const registerDrawerPane = registerPane;
