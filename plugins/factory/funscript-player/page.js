/**
 * page.js -- the funscript player's sidebar page (docs/PLUGINS.md, Pages):
 * the same card as the hero, filling the content pane (`fill`), and the
 * plugin's settings card in a section below it.
 *
 * Constraints:
 * - No second implementation: the page mounts through the player's own
 *   mount, so the card and the page are two views of one player.
 * - The spec is the hero's: a hub without a segments STREAM shows the page's
 *   empty note, never a half-bound card (D1, law 7).
 * - The section mounts the registerSettings function itself, on open, so it
 *   reads the prefs the Plugins pane wrote; closed, it is unmounted. Its
 *   button is the timeline's (ui.js opts.settings), open kept in settingsOpen.
 * - The card never changes size for the section: at 960 px of page width and up the
 *   section overlays the card's library column (320 px, the analyzer column's width
 *   beside the analyzer), so the card stays full; under 960 it sits below the card,
 *   reached by scrolling. The card keeps 340 px of height (a 120 px stage over the
 *   fixed rows); a shorter page scrolls. In media fullscreen
 *   (ui.js, data-media) the card takes the whole page and the section is hidden.
 * - mediaFullscreen: the hover bar offers fullscreen and its mode, so the
 *   shell's footer offers neither.
 */
import { readPrefs, writePref } from './prefs.js';

export const PAGE_ICON = 'M2 3.5h12v9H2zM6.5 6v4l3.5-2z';

const CSS = `
.fsp-page { position: relative; height: 100%; overflow-y: auto; container-type: inline-size; }
.fsp-page > .fsp-pcard { height: 100%; min-height: min(100%, 340px); }
.fsp-page > .fsp-psec { position: absolute; top: 0; right: 0; bottom: 0; width: 320px; z-index: 2; overflow-y: auto; padding: 8px;
  background: var(--bg-card); box-shadow: -4px 0 12px rgba(var(--shade-rgb), .5); }
.fsp-page:has(.fsp[data-an]) > .fsp-psec { width: clamp(320px, 40%, 560px); }
@container (max-width: 959px) { .fsp-page > .fsp-psec { position: static; width: auto; max-height: none; padding: 8px 0; box-shadow: none; background: none; } }
.fsp-page:has(.fsp[data-media]) > .fsp-psec { display: none; }
`;

export function registerPlayerPage(api, player, spec, settings) {
  api.registerPage({ id: 'player', label: 'Funscript', icon: PAGE_ICON, spec, fill: true, mediaFullscreen: true, mount(el, fields) {
    const style = Object.assign(document.createElement('style'), { textContent: CSS });
    const card = Object.assign(document.createElement('div'), { className: 'fsp-pcard' });
    const sec = Object.assign(document.createElement('div'), { className: 'fsp-psec' });
    const root = Object.assign(document.createElement('div'), { className: 'fsp-page' });
    root.append(style, card, sec);
    el.append(root);
    let off = null;
    const setOpen = (on) => {
      sec.hidden = !on;
      if (on && !off) off = settings(sec);
      else if (!on && off) { off(); off = null; }
    };
    setOpen(readPrefs(api).settingsOpen);
    const inst = player.mount(card, fields, { fullscreen: true,
      settings: { open: !sec.hidden, toggle(on) { writePref(api, 'settingsOpen', on); setOpen(on); } } });
    return {
      update: () => inst.update(),
      unmount() { inst.unmount(); if (off) off(); root.remove(); },
    };
  } });
}
