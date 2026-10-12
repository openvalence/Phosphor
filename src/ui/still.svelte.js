/**
 * still.svelte.js -- the one switch for app-wide motion (DESIGN §10.13).
 * Imported once from main.js; sets html.still and exports the same state.
 *
 * Constraints:
 * - html.still = theme look.motion 0, OR pref motion 'reduced', OR pref
 *   motion 'system' with prefers-reduced-motion: reduce, OR a minimized shell
 *   window (setMinimized, main.js: WebView2 keeps drawing while minimized).
 *   Pref 'full' beats the media query, not the theme's motion 0.
 * - This is the only file that reads the prefers-reduced-motion media query.
 *   CSS keys off html.still, JS off `still.on` or isStill().
 * - Ambient loops (a CSS animation or transition on or inside [data-ambient])
 *   step at AMBIENT_FPS, never the display's rate: each is paused and its time
 *   set by one timer, so a 240 Hz screen composites 30 frames a second for
 *   them, not 240. The timer runs only while one exists. Never mark motion
 *   that answers input: it would answer at 30 fps.
 */
import { prefs } from '../model/prefs.js';
import { currentTheme, onTheme } from '../model/theme.js';

export const still = $state({ on: false });
export const isStill = () => still.on;
let minimized = false, apply = () => {};
export const setMinimized = (on) => { minimized = !!on; apply(); };

const AMBIENT_FPS = 30;
const origin = new WeakMap();
let ambientTimer = 0;
function stepAmbient() {
  const now = document.timeline.currentTime;
  let any = false;
  for (const a of document.getAnimations()) {
    if (!a.effect?.target?.closest('[data-ambient]')) continue;
    any = true;
    if (!origin.has(a)) { origin.set(a, now - (a.currentTime ?? 0)); a.pause(); }
    const at = now - origin.get(a);
    if (at >= a.effect.getComputedTiming().endTime) a.finish(); else a.currentTime = at;
  }
  if (!any) { clearInterval(ambientTimer); ambientTimer = 0; }
}
function wakeAmbient(e) {
  if (!ambientTimer && e.target.closest?.('[data-ambient]')) ambientTimer = setInterval(stepAmbient, 1000 / AMBIENT_FPS);
}

if (typeof window !== 'undefined') {
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let mode = 'system';
  apply = () => {
    still.on = minimized || currentTheme().look.motion === 0 || mode === 'reduced' || (mode === 'system' && !!mq?.matches);
    document.documentElement.classList.toggle('still', still.on);
  };
  prefs.subscribe((p) => { mode = p.motion; apply(); });
  onTheme(apply);
  mq?.addEventListener?.('change', apply);
  document.addEventListener('animationstart', wakeAmbient, true);
  document.addEventListener('transitionrun', wakeAmbient, true);
}
