/**
 * drawer.js -- panes siblings add to the shell drawer without editing
 * Drawer.svelte. SHELL ONLY: nothing on the hub-served page renders these.
 *
 *   registerDrawerPane({ id: 'settings', label: 'Settings', component: MySettings });
 *
 * A pane whose id matches a built-in (hubs, server, settings, about) replaces
 * it; any other id gets its own tab before About. Registering an id twice
 * keeps the last. The component mounts with no props.
 */
import { writable } from 'svelte/store';

export const drawerPanes = writable([]);

export function registerDrawerPane({ id, label, component }) {
  drawerPanes.update((ps) => [...ps.filter((p) => p.id !== id), { id, label, component }]);
}
