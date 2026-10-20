/**
 * docs.js -- the docs page for what is on screen: F1 twice (DESIGN §10.13)
 * and the phone menu's Docs.
 *
 * Constraints:
 * - The one map from a page to openvalence.org/phosphor/docs; an anchor is a
 *   section id the site has (openvalence.github.io/phosphor/docs/).
 * - The second F1 inside the window is the confirm: it opens without
 *   `Open link?`. Never over a pending confirm (it must stay visible).
 */
import { say, history } from '../model/history.svelte.js';
import { confirmUi } from './confirm.svelte.js';
import { openExternal } from './external.js';

const BASE = 'https://openvalence.org/phosphor/docs/';
const BY_TAB = {
  'plugin:funscript-player:player': 'funscript-player/',
  plugins: 'plugins/',
  'shell:hubs': 'connecting/#s-find',
  pairing: 'connecting/#s-pairing',
  log: 'troubleshooting/#s-log',
};

/** The docs URL for tab `id`; the node graph when it has focus or the screen. */
export function docsUrl(id) {
  if (document.activeElement?.closest('.graph') || document.querySelector('.graph.full')) return BASE + 'node-editor/';
  return BASE + (BY_TAB[id] ?? (id?.startsWith('plugin:') ? 'plugins/' : ''));
}

export const DOCS_ARM_MS = 3000;
export const DOCS_NOTE = 'F1 again: docs for this page · Esc to cancel';
let armed = 0;
let timer = null;
function disarm() {
  armed = 0;
  clearTimeout(timer);
  if (history.msg === DOCS_NOTE) say('');
}

/** The window keydown: F1 arms (the note), F1 again inside the window opens, Escape disarms. */
export function docsKey(e, id) {
  if (e.key === 'F1') {
    e.preventDefault();
    if (confirmUi.req) return;
    if (armed && Date.now() - armed < DOCS_ARM_MS) { disarm(); openExternal(docsUrl(id), '_blank', { ask: false }); return; }
    armed = Date.now();
    say(DOCS_NOTE);
    clearTimeout(timer);
    timer = setTimeout(disarm, DOCS_ARM_MS);
  } else if (e.key === 'Escape' && armed) {
    // Only the note: a fullscreen page stays (App reads defaultPrevented).
    e.preventDefault();
    disarm();
  }
}
