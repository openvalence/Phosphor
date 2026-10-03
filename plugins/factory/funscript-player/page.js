/**
 * page.js -- the funscript player's sidebar page (docs/PLUGINS.md, Pages):
 * the same card as the hero, full width under Plugins, and the plugin's
 * settings card in a section below it.
 *
 * Constraints:
 * - No second implementation: the page mounts through the player's own
 *   mount, so the card and the page are two views of one player.
 * - The spec is the hero's: a hub without a segments STREAM shows the page's
 *   empty note, never a half-bound card (D1, law 7).
 * - The section mounts the registerSettings function itself, on open, so it
 *   reads the prefs the Plugins pane wrote; closed, it is unmounted.
 * - The card keeps its height when the section opens: below the card in the
 *   page's flow, and in fullscreen the card fills all but the Settings row,
 *   the section scrolling below it. In media fullscreen (ui.js, data-media)
 *   the card takes the whole page and the section is hidden.
 */
import { readPrefs, writePref } from './prefs.js';

export const PAGE_ICON = 'M2 3.5h12v9H2zM6.5 6v4l3.5-2z';

const CSS = `
.fsp-page { height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.fsp-page > .fsp-pcard { flex: none; height: calc(100% - var(--tap) - 4px); }
.fsp-page > details > summary { display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 10px; list-style: none;
  border: 1px solid var(--line-2); border-radius: var(--r-s); color: var(--tx); cursor: pointer; }
.fsp-page > details > summary::-webkit-details-marker { display: none; }
.fsp-page > details > summary:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
.fsp-page > details[open] > summary { color: var(--highlight); border-color: var(--highlight); }
.fsp-page > details > div { max-width: 640px; padding: 8px 0; }
.fsp-page:has(.fsp[data-media]) { overflow: hidden; }
.fsp-page:has(.fsp[data-media]) > .fsp-pcard { height: 100%; }
.fsp-page:has(.fsp[data-media]) > details { display: none; }
`;

export function registerPlayerPage(api, player, spec, settings) {
  api.registerPage({ id: 'player', label: 'Funscript', icon: PAGE_ICON, spec, mount(el, fields) {
    const style = Object.assign(document.createElement('style'), { textContent: CSS });
    const card = Object.assign(document.createElement('div'), { className: 'fsp-pcard' });
    const sum = Object.assign(document.createElement('summary'), { textContent: 'Settings', title: 'Settings' });
    const body = document.createElement('div');
    const det = document.createElement('details');
    det.append(sum, body);
    const root = Object.assign(document.createElement('div'), { className: 'fsp-page' });
    root.append(style, card, det);
    el.append(root);
    let off = null;
    const sync = () => {
      if (det.open && !off) off = settings(body);
      else if (!det.open && off) { off(); off = null; }
    };
    det.open = readPrefs(api).settingsOpen;
    sync();
    det.addEventListener('toggle', () => { writePref(api, 'settingsOpen', det.open); sync(); });
    const inst = player.mount(card, fields, { fullscreen: true });
    return {
      update: () => inst.update(),
      unmount() { inst.unmount(); if (off) off(); root.remove(); },
    };
  } });
}
