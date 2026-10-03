/**
 * page.js -- the funscript player's sidebar page (docs/PLUGINS.md, Pages):
 * the same card as the hero, full width under Plugins.
 *
 * Constraints:
 * - No second implementation: the page mounts through the player's own
 *   mount, so the card and the page are two views of one player.
 * - The spec is the hero's: a hub without a segments STREAM shows the page's
 *   empty note, never a half-bound card (D1, law 7).
 */
export const PAGE_ICON = 'M2 3.5h12v9H2zM6.5 6v4l3.5-2z';

export function registerPlayerPage(api, player, spec) {
  api.registerPage({ id: 'player', label: 'Funscript', icon: PAGE_ICON, spec, mount: (el, fields) => player.mount(el, fields) });
}
