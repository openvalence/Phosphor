/**
 * boot.js -- the Temple theme's always-loaded half (docs/THEMES.md, Behavior and Hidden themes).
 *
 * Constraints:
 * - Runs at startup whatever theme is applied, so it holds only listeners: no timer, no frame.
 * - The unlock: typing "temple" in F3's box finds the theme, applies it and lists it from then on.
 * - The escape hatch: Escape three times within 1.5 s puts back the theme from before Temple
 *   (else the default). It never prevents Escape's own work.
 * - behavior.js (the overlay, the bar readouts, the oracle) loads and starts only while Temple is
 *   applied, and is stopped the moment another theme is.
 */
import { applyTheme, currentTheme, onTheme, unlockTheme, normalizeTheme, DEFAULT_THEME, THEMES } from '../../model/theme.js';

const ID = 'temple';
const PREV_KEY = 'phosphor.temple.prev';
const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* in-memory only */ } };

let last = null;      // the theme applied before Temple, kept to leave by
let running = null;   // behavior.js's stop(), while it runs
let gen = 0;

export function enter() {
  unlockTheme(ID);
  if (currentTheme().style !== ID) applyTheme(THEMES.find((t) => t.id === ID));
}

export function leave() {
  const prev = get(PREV_KEY);
  applyTheme(prev && normalizeTheme(prev).style !== ID ? prev : DEFAULT_THEME);
}

function follow(t) {
  if (t.style !== ID) {
    last = t;
    if (running) { running(); running = null; }
    gen++;
    return;
  }
  if (last) { set(PREV_KEY, last); last = null; }
  if (running || typeof document === 'undefined') return;
  const mine = ++gen;
  import('./behavior.js').then((m) => { if (mine === gen && !running) running = m.start({ leave }); })
    .catch((e) => console.error('temple behavior failed to load', e));
}

if (typeof window !== 'undefined') {
  onTheme(follow);
  // F3's box: the word finds the shrine. Read on input, never polled.
  window.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.classList && el.classList.contains('lf-q') && el.value.trim().toLowerCase() === ID) enter();
  }, true);
  let escs = [];
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.repeat || currentTheme().style !== ID) return;
    const now = performance.now();
    escs = [...escs.filter((t) => now - t < 1500), now];
    if (escs.length >= 3) { escs = []; leave(); }
  }, true);
}
