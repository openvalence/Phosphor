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
// Ambient animations being stepped: [origin, endTime], taken from the elements their start events named.
// Never document.getAnimations() in the step: it flushes style and layout and walks every animation in the page;
// getAnimations() runs only on a tick that has new starts, once for all of them.
const ambient = new Map();
const started = new Set();
let ambientTimer = 0;
function stepAmbient() {
  const now = document.timeline.currentTime;
  for (const el of started) {
    for (const a of el.getAnimations({ subtree: true })) {
      if (ambient.has(a) || a.playState !== 'running') continue;
      ambient.set(a, [now - (a.currentTime ?? 0), a.effect.getComputedTiming().endTime]);
      a.pause();
      // A style change or a removed element cancels it. A step between that and this event set its time and
      // brought it back as a script animation; the event comes before the next frame's style, so cancel it again.
      a.addEventListener('cancel', () => { ambient.delete(a); a.cancel(); }, { once: true });
    }
  }
  started.clear();
  for (const [a, [t0, end]] of ambient) {
    const at = now - t0;
    if (at >= end) { ambient.delete(a); a.finish(); } else a.currentTime = at;
  }
  if (!ambient.size) { clearInterval(ambientTimer); ambientTimer = 0; }
}
function wakeAmbient(e) {
  if (!e.target.closest?.('[data-ambient]')) return;
  started.add(e.target);
  if (!ambientTimer) ambientTimer = setInterval(stepAmbient, 1000 / AMBIENT_FPS);
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
