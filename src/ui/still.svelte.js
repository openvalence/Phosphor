/**
 * still.svelte.js -- the one switch for app-wide motion (DESIGN §10.13).
 * Imported once from main.js; sets html.still and exports the same state.
 *
 * Constraints:
 * - html.still = theme look.motion 0, OR pref motion 'reduced', OR pref
 *   motion 'system' with prefers-reduced-motion: reduce. Pref 'full' beats
 *   the media query, not the theme's motion 0.
 * - This is the only file that reads the prefers-reduced-motion media query.
 *   CSS keys off html.still, JS off `still.on` or isStill().
 */
import { prefs } from '../model/prefs.js';
import { currentTheme, onTheme } from '../model/theme.js';

export const still = $state({ on: false });
export const isStill = () => still.on;

if (typeof window !== 'undefined') {
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let mode = 'system';
  const apply = () => {
    still.on = currentTheme().look.motion === 0 || mode === 'reduced' || (mode === 'system' && !!mq?.matches);
    document.documentElement.classList.toggle('still', still.on);
  };
  prefs.subscribe((p) => { mode = p.motion; apply(); });
  onTheme(apply);
  mq?.addEventListener?.('change', apply);
}
