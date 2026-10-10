/**
 * page.js -- the funscript player's sidebar page (docs/PLUGINS.md, Pages):
 * the same card as the hero in a kit page that fills the window, and the
 * plugin's settings in a kit sheet.
 *
 * Constraints:
 * - No second implementation: the page mounts through the player's own
 *   mount, so the card and the page are two views of one player.
 * - The spec is the hero's: a hub without a segments STREAM shows the page's
 *   empty note, never a half-bound card (D1, law 7).
 * - The settings mount the registerSettings function itself, on open, so they
 *   read the prefs the Plugins pane wrote; closed, they are unmounted. Their
 *   button is the bar's (ui.js opts.settings), open kept in settingsOpen.
 * - Three shell cards (PR1): Player 01 and Library 02 (ui.js, opts.page) and Settings 03, the sheet.
 * - The sheet's forms are the kit's (PR12): the bottom sheet on a phone upright, stopping under the stage so
 *   the stage stays in view; the drawer in fullscreen; else the slot, a card that never changes the Player
 *   card's size and never covers a card control: over the library column (or the analyzer column, above the
 *   transport row) of a full card, else below the card, reached by scrolling.
 * - mediaFullscreen: the hover bar offers fullscreen, so the shell's footer does not.
 */
import { readPrefs, writePref } from './prefs.js';
import { COPY } from './ui.js';

// F3 entries: each key is a [data-search-key] on the card (ui.js, library.js); the shell scrolls to it and focuses its first control.
export const SEARCH = [
  { label: 'Motion', key: 'motion' }, { label: 'Offset', key: 'offset' }, { label: 'Invert', key: 'invert' },
  { label: 'Open video', key: 'openVideo' }, { label: 'Open script', key: 'openScript' }, { label: 'Graph', key: 'graph' },
  { label: 'Split', key: 'split' },
];

const FIT_MIN = 360;
export const PAGE_ICON = 'M2 3.5h12v9H2zM6.5 6v4l3.5-2z';

const CSS = `
.fsp-page { display: block; position: relative; overflow-y: auto; --pg-bot: calc(30px + var(--sp-2) + var(--sp-3)); }
@media (pointer: coarse) { .fsp-page { --pg-bot: calc(var(--tap) + var(--sp-2) + var(--sp-3)); } }
.fsp-page > .ui-page-main { display: block; height: 100%; }
.fsp-page .fsp-pcard { height: 100%; min-height: min-content; }
.fsp-page > .fsp-psec[data-form=slot] { margin-top: var(--gap); }
.fsp-page:has(.fsp[data-comp=full]:not([data-libshut], [data-an])) > .fsp-psec[data-form=slot] { position: absolute; top: 0; right: 0; bottom: 0; width: 320px; z-index: 2;
  margin: 0; overflow-y: auto; }
.fsp-page:has(.fsp[data-comp=full][data-an]) > .fsp-psec[data-form=slot] { position: absolute; top: 0; right: 0; bottom: var(--pg-bot); width: clamp(320px, 40%, 560px); z-index: 2;
  margin: 0; overflow-y: auto; }
.fsp-page:has(.fsp[data-media]) .fsp-pcard { min-height: 0; }
`;

export function registerPlayerPage(api, player, spec, settings) {
  api.registerPage({ id: 'player', label: 'Funscript', icon: PAGE_ICON, spec, fill: true, mediaFullscreen: true, compactHero: true, status: true, search: SEARCH, mount(el, fields) {
    const ui = api.ui;
    const card = Object.assign(document.createElement('div'), { className: 'fsp-pcard' });
    const root = ui.page({ main: [card], fill: true, class: 'fsp-page' });
    root.prepend(Object.assign(document.createElement('style'), { textContent: CSS }));
    let off = null;
    const sheet = ui.sheet({ title: COPY.settings, index: '03', slot: root, class: 'fsp-psec', onClose: () => toggle(false) });
    root.append(sheet);
    const setOpen = (on) => {
      if (on) {
        // The sheet stops under the stage, so the stage stays in view above it.
        const vb = root.querySelector('.fsp-vbox');
        if (vb) sheet.style.setProperty('--ui-sheet-max', Math.max(FIT_MIN / 2, innerHeight - vb.getBoundingClientRect().bottom - 8) + 'px');
        if (!off) off = settings(sheet.body);
        sheet.open = true;
      } else {
        sheet.open = false;
        if (off) { off(); off = null; }
      }
    };
    // In flow (the library collapsed) the slot opens below the card: bring it into view.
    const toggle = (on) => {
      writePref(api, 'settingsOpen', on);
      setOpen(on);
      if (inst) inst.update();
      if (on && sheet.form === 'slot' && getComputedStyle(sheet).position === 'static') sheet.scrollIntoView({ block: 'nearest' });
    };
    el.append(root);
    const inst = player.mount(card, fields, { fullscreen: true, page: true,
      settings: { get open() { return sheet.open; }, toggle } });
    // The bar's Settings toggles itself: a tap on it is no outside tap.
    sheet.anchor = card.querySelector('.fsp-set');
    setOpen(readPrefs(api).settingsOpen);
    return {
      update: () => inst.update(),
      unmount() { inst.unmount(); setOpen(false); root.remove(); },
    };
  } });
}
