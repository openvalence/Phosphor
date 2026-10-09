/**
 * navIcons.js -- the sidebar's one icon table (DESIGN §10.11).
 *
 * Constraints:
 * - Keyed by registry `ui_categories` id (RENDERING §3) and by Phosphor's own
 *   pane ids; never by a device's channel or label. An untaught or vendor
 *   category id, and an unknown pane, draws the `other` icon.
 * - Each value is one SVG path `d` on a 16-unit viewBox, drawn open (no fill)
 *   at a 1.5 stroke in currentColor with round caps and joins: the flip and
 *   override glyphs' style (TopStrip.svelte).
 */
import { UI_CATEGORY } from '../../../Valence/clients/js/generated/registry_vocab.js';

const CIRCLE = (cx, cy, r) => `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0 ${-2 * r}z`;

export const NAV_ICONS = {
  // ---- registry categories (tiers 1 and 2) ----
  [UI_CATEGORY.generator]: 'M1.5 8q2.15-6 4.3 0t4.3 0t4.3 0',
  [UI_CATEGORY.motion]: 'M2 8h12M5 5L2 8l3 3M11 5l3 3-3 3',
  [UI_CATEGORY.safety]: 'M8 1.75l5 2v4c0 3.2-2.2 5.4-5 6.5-2.8-1.1-5-3.3-5-6.5v-4z',
  [UI_CATEGORY.limits]: 'M2.75 3v10M13.25 3v10M5.5 8h5M7 6.5L5.5 8 7 9.5M9 6.5l1.5 1.5L9 9.5',
  [UI_CATEGORY.playback]: 'M5 3.5v9l7-4.5z',
  [UI_CATEGORY.auxiliary]: 'M8 2.25c2.5 3 4 5.1 4 7a4 4 0 0 1-8 0c0-1.9 1.5-4 4-7z',
  [UI_CATEGORY.automation]: CIRCLE(8, 8, 5.75) + 'M8 5v3.25l2.25 1.5',
  [UI_CATEGORY.hardware]: 'M4.5 4.5h7v7h-7zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14',
  [UI_CATEGORY.network]: 'M2 6.5a8.5 8.5 0 0 1 12 0M4.25 9a5.25 5.25 0 0 1 7.5 0M6.5 11.5a2 2 0 0 1 3 0',
  [UI_CATEGORY.session]: CIRCLE(8, 5, 2.5) + 'M3 13.5c.5-2.6 2.5-4 5-4s4.5 1.4 5 4',
  [UI_CATEGORY.system]: 'M1.5 8.5h3L6 4.5l3 7 1.5-3h4',
  [UI_CATEGORY.other]: 'M2.5 2.5h4.5V7H2.5zM9 2.5h4.5V7H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  [UI_CATEGORY.setup]: 'M2.5 4l1.25 1.25L6 3M2.5 10l1.25 1.25L6 9M8.5 4.25h5M8.5 10.25h5',
  // ---- Phosphor's own panes (tiers 1 to 3) ----
  machine: 'M2.5 2.5h4.5v6H2.5zM9 2.5h4.5V6H9zM9 8h4.5v5.5H9zM2.5 10.5h4.5v3H2.5z',
  pairing: CIRCLE(5, 8, 2.75) + 'M7.75 8H14M11.5 8v2.25M13.75 8v1.75',
  valence: 'M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5',
  log: 'M2.5 4h11M2.5 8h11M2.5 12h7',
  display: 'M2 3.5h12v8H2zM6 14h4M8 11.5V14',
  plugins: 'M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 0 1-7 0zM8 11.5V14',
  hubs: 'M2.5 2.75h11v4h-11zM2.5 9.25h11v4h-11zM4.75 4.75h2M4.75 11.25h2',
  server: 'M8 1.75C6.3 4.2 5.3 6.8 5.6 9c.2 1.2.8 1.9 1 2.4v.4c-1.6.4-2.8.8-3 1.5Q8 14.4 12.4 13.3c-.2-.7-1.4-1.1-3-1.5v-.4c.2-.5.8-1.2 1-2.4.3-2.2-.7-4.8-2.4-7.25zM1.6 9.5A6.6 2 -15 0 0 14.4 6.1M14.4 6.1A6.6 2 -15 0 0 10.45 5.3M5.55 6.5A6.6 2 -15 0 0 1.6 9.5',
  settings: 'M3 2.5v11M8 2.5v11M13 2.5v11M1.5 5h3M6.5 10h3M11.5 7h3',
  merge: 'M4 2.5V6c0 2 4 2 4 4v3.5M12 2.5V6c0 2-4 2-4 4',
  about: CIRCLE(8, 8, 5.75) + 'M8 7.25V11M8 5h.01',
  // The quick rail (DESIGN §10.3): the mini's plate, its band and the position tick.
  quickRail: 'M1.5 5.5h13v5h-13zM5 7.5v1M11 7.5v1M8 3.5v9',
};

/** The icon for an App.svelte tab: a plugin page's own or Plugins', its category's, else its pane's, else `other`. */
export function navIcon(tab) {
  if (tab.page) return tab.page.icon || NAV_ICONS.plugins;
  const key = tab.cat ? (tab.cat.known ? tab.cat.id : UI_CATEGORY.other) : tab.pane ? tab.pane.id : tab.id;
  return NAV_ICONS[key] ?? NAV_ICONS[UI_CATEGORY.other];
}
