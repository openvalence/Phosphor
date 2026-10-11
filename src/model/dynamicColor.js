/**
 * dynamicColor.js -- Material You for the Material Theme: the system's wallpaper-derived
 * tone ramps (Android 12+, published by MainActivity.kt as window.__phosphorSystemPalette)
 * become the Theme's accents and chassis.
 *
 * Constraints:
 * - Pure until installDynamicColor(): node tests import paletteTheme with no DOM.
 * - Every Variant of the Theme 'material' is derived (keyed by style, not id); an edited theme
 *   (Custom, no variant) is the user's and is left alone, without a stale data-md-scheme.
 *   The derived theme is applied without persisting, so the stored theme stays the shipped
 *   Variant and a phone without a palette (below Android 12, the browser, any desktop) keeps it.
 * - Contrast is the theme engine's (text, labels, safety inks) plus this file's clamp:
 *   an accent that would read under 4.5:1 on any surface is moved along its lightness until
 *   it does, and one that lands on the safety amber or red hue is turned away from it.
 *   The stop pair and every safety token are not here and cannot be reached from here.
 */
import { toOklch, fromOklch, contrast, nearSafety, deriveTokens, normalizeTheme, onTheme, currentTheme, applyTheme } from './theme.js';

const TONES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
const SURFACES = ['--bg', '--bg-raised', '--bg-card', '--bg-sunken'];
// The default chassis reference (model/theme.js): lightness of #08090B and its chroma.
const REF_L = 0.1796, REF_C = 0.0105;

const tone = (ramp, t) => (ramp && ramp[t]) || null;
const valid = (p) => !!p && ['accent1', 'accent2', 'accent3', 'neutral1'].every((k) => p[k] && TONES.every((t) => /^#[0-9a-f]{6}$/i.test(p[k][t] || '')));

/** The worst contrast of `hex` over every surface of a theme. */
const worst = (hex, base) => Math.min(...SURFACES.map((k) => contrast(hex, base[k])));

/** Move `hex` along its lightness until it reads 4.5:1 on every surface, turn it off a safety hue first. */
function clampAccent(hex, base, dark) {
  let [L, C, h] = toOklch(hex);
  const hue = (x) => (((x % 360) + 360) % 360);
  let out = hex;
  // The lightness move can change what the gamut leaves of the chroma, so the safety hue is
  // checked on the result, and a hit turns the hue 24 degrees and clamps again.
  for (let turn = 0; turn < 8; turn++) {
    out = fromOklch(L, C, h);
    for (let n = 0; n < 80 && worst(out, base) < 4.5; n++) {
      L = Math.min(1, Math.max(0, L + (dark ? 0.012 : -0.012)));
      out = fromOklch(L, C, h);
    }
    if (!nearSafety(out)) return out;
    h = hue(h + 24);
  }
  return out;
}

/**
 * The Material theme for one palette: `base` is the shipped preset (its look and id stay),
 * `pal` is {accent1, accent2, accent3, neutral1, night}. Returns { theme, light } or null
 * for a palette that is not whole.
 */
export function paletteTheme(base, pal) {
  if (!valid(pal)) return null;
  const dark = pal.night !== false;
  // Dark: surface from neutral tone 900, accents at tone 200; light: tone 10 and 600.
  const surf = tone(pal.neutral1, dark ? 900 : 10);
  const [sL, sC, sH] = toOklch(surf);
  const chassis = {
    hue: Math.round(sH),
    tint: Math.min(4, Math.max(0, +(sC / REF_C).toFixed(2))),
    brightness: Math.min(1, Math.max(0, +(sL - REF_L + 0.14).toFixed(3))),
    contrast: 1,
  };
  const staged = normalizeTheme({ ...base, chassis });
  const surfaces = deriveTokens(staged).base;
  const at = dark ? 200 : 600;
  const reality = clampAccent(tone(pal.accent1, at), surfaces, dark);
  let intent = clampAccent(tone(pal.accent3, at), surfaces, dark);
  // Tertiary and primary can be one hue on a monochrome wallpaper: take the secondary then.
  if (Math.abs(toOklch(intent)[2] - toOklch(reality)[2]) < 8) intent = clampAccent(tone(pal.accent2, at), surfaces, dark);
  const highlight = clampAccent(tone(pal.accent2, dark ? 100 : 700), surfaces, dark);
  const theme = normalizeTheme({ ...base, chassis, accents: { reality, intent, highlight } });
  return { theme, light: !dark };
}

let installed = false;
let lastKey = '';

/** The page side: derive on a theme change and on a palette event. Idempotent. */
export function installDynamicColor() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const palette = () => window.__phosphorSystemPalette || null;
  const sync = () => {
    const t = currentTheme();
    const root = document.documentElement;
    if (t.style !== 'material' || !t.variant) { root.removeAttribute('data-md-scheme'); lastKey = ''; return; }
    const r = paletteTheme(t, palette());
    if (!r) { root.removeAttribute('data-md-scheme'); return; }
    const key = JSON.stringify([r.theme.accents, r.theme.chassis]);
    if (key === lastKey && JSON.stringify([t.accents, t.chassis]) === key) return;
    lastKey = key;
    root.dataset.mdScheme = r.light ? 'light' : 'dark';
    applyTheme(r.theme, { persist: false });
  };
  onTheme(sync);
  window.addEventListener('phosphor-system-palette', sync);
  sync();
}
