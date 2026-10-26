/**
 * theme.js -- the theme engine. One theme object derives every themeable
 * :root token; applyTheme() writes them as one <style> block.
 *
 *   { id, name,
 *     accents:  { reality, intent, highlight },      highlight null = reality
 *     chassis:  { hue, tint, brightness, contrast },  the whole neutral ramp
 *     look:     { glow, radius, scale, numWeight, motion },
 *     overrides: { '--token': 'css value' } }        pinned, wins over derived
 *
 * Constraints:
 * - Safety colors are never themeable (RENDERING law 13). LOCKED names them;
 *   no preset, knob, override, import or plugin theme can reach them. Their
 *   text inks (--warn-ink, --bad-ink) keep the locked hue and only take the
 *   lightness the chassis needs to read; they are LOCKED too.
 * - The default chassis reproduces style.css's :root neutrals
 *   (test/theme.test.mjs); style.css stays the paint before this file runs.
 * - Pure until applyTheme(): node tests import it with no DOM.
 * - Canvases read ACCENT/ac() or re-read computed tokens in onTheme().
 * - Browser preference only: nothing here reaches the hub.
 * - A Theme (themes/<id>/) is a shipped style: a stylesheet layer, an icon set and one or
 *   more Variants (palettes). `theme.style` names it; the layer is scoped by
 *   html[data-style], and only a shipped Theme id reaches it, so an import or a plugin
 *   never carries CSS.
 * Model, knobs and the light-chassis finding: docs/THEMES.md.
 */
import { THEME_LIST } from '../themes/registry.js';

// ---- color math: sRGB <-> OKLCH (Ottosson), WCAG contrast -----------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const HEX = /^#[0-9a-f]{6}$/i;

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export function rgbToHex(a) {
  return '#' + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function toOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A) * 180 / Math.PI];
}
function oklchToLinear(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
/** Out of gamut, chroma gives way and lightness and hue hold. */
export function fromOklch(L, C, h) {
  const inGamut = (c) => oklchToLinear(L, c, h).every((v) => v >= -0.0005 && v <= 1.0005);
  if (!inGamut(C)) {
    let lo = 0, hi = C;
    for (let n = 0; n < 16; n++) { const mid = (lo + hi) / 2; if (inGamut(mid)) lo = mid; else hi = mid; }
    C = lo;
  }
  return rgbToHex(oklchToLinear(L, C, h).map(gam));
}
export function contrast(h1, h2) {
  const Y = (h) => { const [r, g, b] = hexToRgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = Y(h1), b = Y(h2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const rgbStr = (a) => a.map(Math.round).join(',');
const mix = (a, t, f) => a.map((v) => v + (t - v) * f);

// ---- the neutral references: style.css's :root values -----------------------
// Surfaces move by a lightness offset from --bg; lines and text sit at a
// fraction of the way from --bg to the far extreme (white on a dark chassis,
// black on a light one), so the ramp flips with the chassis.
const SURF = { '--bg': '#08090B', '--bg-raised': '#0D0F13', '--bg-card': '#111318', '--bg-sunken': '#040507', '--shell-bg': '#020203' };
const RAMP = {
  '--line-0': '#121419', '--line-1': '#1D2026', '--line-2': '#272B31', '--line-3': '#33373E', '--line-4': '#454A54',
  '--tx-hi': '#ECEFF4', '--tx': '#C3C8D1', '--tx-val': '#A8AEB9', '--tx-mut': '#666C78', '--tx-ghost': '#5C626C', '--tx-faint': '#2C3037',
};
const HIVIS = { '--tx': '#E4E8EF', '--tx-val': '#C9CFD9', '--tx-mut': '#8A919D', '--tx-ghost': '#7A808C' };
const MORE = { ...HIVIS, '--line-1': '#2A2F36' };
const REF = {};
for (const h of [...Object.values(SURF), ...Object.values(RAMP), ...Object.values(MORE)]) REF[h] = toOklch(h);
const BG = REF[SURF['--bg']];

/** Knob ranges: [min, max, step, default]. The default chassis IS style.css. */
export const KNOBS = {
  chassis: {
    hue: [0, 360, 1, 263],
    tint: [0, 4, 0.05, 1],
    brightness: [0, 1, 0.01, 0.14],
    contrast: [0.5, 2, 0.05, 1],
  },
  look: {
    glow: [0, 2, 0.05, 1],
    radius: [0, 12, 1, 2],
    scale: [0.8, 1.6, 0.02, 1.12],
    numWeight: [300, 700, 10, 400],
    motion: [0, 10, 0.5, 5],
  },
};
const def = (group) => Object.fromEntries(Object.entries(KNOBS[group]).map(([k, r]) => [k, r[3]]));

/**
 * The funscript player's Color by speed: a turbo-like ramp, deep blue at rest through cyan, green, yellow and orange to
 * red at the machine's speed limit, and a magenta for past it (never in the ramp). Per chassis, then moved along its own
 * hue to 3:1 against the surfaces it sits on (derive). Not themeable: a recolored ramp stops reading as speed.
 */
export const SPEED_RAMP = {
  dark: ['#3D5AFE', '#2E8BFF', '#1FD0F0', '#1FE59A', '#6BF03D', '#D6EA28', '#FFC21F', '#FF7A1A', '#F0301E'],
  light: ['#1F2FC8', '#1565D0', '#0A8EA8', '#0E9460', '#3A9A10', '#8A9400', '#B88200', '#CC5400', '#B81414'],
  over: { dark: '#FF3DF2', light: '#B0009F' },
};
export const SPEED_RAMP_FLOOR = 3;

/** Never part of a theme, with the reason the editor shows. */
export const LOCKED = {
  '--warn': 'safety color',
  '--bad': 'safety color',
  '--warn-rgb': 'safety color',
  '--bad-rgb': 'safety color',
  '--estop': 'safety color',
  '--glow-warn': 'safety color',
  '--warn-ink': 'safety color',
  '--bad-ink': 'safety color',
  ...Object.fromEntries([...SPEED_RAMP.dark.map((_, i) => '--spd-' + i), '--spd-over'].map((k) => [k, 'speed ramp (the Color by speed ramp)'])),
  '--tap': 'touch floor (law 12)',
  '--range-hit': 'touch floor (law 12)',
  '--slider-thumb-w': 'touch floor (law 12)',
  '--slider-thumb-h': 'touch floor (law 12)',
  '--fx-glow-ease': 'ladder curve',
  '--fx-follow': 'ladder curve',
  '--fx-breath': 'ladder curve',
  '--fx-breath-slow': 'ladder curve',
  '--fx-run-ms': 'ladder curve',
  '--fx-run-delay': 'ladder curve',
  '--t-quick': 'motion token (html.still)',
  '--t-move': 'motion token (html.still)',
  '--t-slow': 'motion token (html.still)',
  '--ease-out': 'motion token (html.still)',
  '--ease-settle': 'motion token (html.still)',
  '--chrome-inset-top': 'safe-area owner',
  '--font': 'bundled font',
  '--mono': 'bundled font',
  '--og-brackets': 'derived from the lines',
  '--corner-r': 'published by the Android activity (MainActivity, inline on <html>)',
  '--corner-inset': 'derived from the display corner',
  '--bar-h': 'touch floor (law 12)',
  '--ui-btn-h': 'touch floor (law 12)',
  '--ui-row-h': 'plugin kit row height',
  '--font-head': 'theme hook (docs/THEMES.md, Tokens)',
  '--tex-page': 'theme hook (docs/THEMES.md, Tokens)',
  '--tex-page-size': 'theme hook (docs/THEMES.md, Tokens)',
  '--tex-card': 'theme hook (docs/THEMES.md, Tokens)',
  '--tex-card-size': 'theme hook (docs/THEMES.md, Tokens)',
  '--frame-w': 'theme hook (docs/THEMES.md, Tokens)',
};
/** The safety swatches the editor shows locked. */
export const SAFETY = ['--warn', '--bad', '--estop'];
/** style.css's locked values; test/theme.test.mjs holds them equal. */
const SAFETY_HEX = { amber: '#F5B94D', red: '#FF4757' };
/** The Neutrino badge's pink on a light chassis; safetyInk darkens it to read. Its hue stays 20 degrees clear of the safety red. */
const NEUTRINO_LIGHT = '#B0306A';

/**
 * 'amber' or 'red' when an accent's OKLCH hue sits within 20 degrees of that
 * safety color, else null. A near-gray has no hue to confuse.
 */
export function nearSafety(hex) {
  const [, C, h] = toOklch(hex);
  if (C < 0.05) return null;
  for (const [name, s] of Object.entries(SAFETY_HEX)) {
    const d = Math.abs(h - toOklch(s)[2]) % 360;
    if (Math.min(d, 360 - d) < 20) return name;
  }
  return null;
}

/** A safety color as text: its own hue at the nearest lightness that reads `floor` (4.5:1, or a Theme's inkFloor) on every surface. */
function safetyInk(hex, surfaces, dark, floor = 4.5) {
  const worst = (c) => Math.min(...surfaces.map((s) => contrast(c, s)));
  if (worst(hex) >= floor) return hex;
  const [L, C, h] = toOklch(hex);
  let lo = L, hi = dark ? 1 : 0;
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (worst(fromOklch(mid, C, h)) >= floor) hi = mid; else lo = mid;
  }
  return fromOklch(hi, C, h);
}

/** The speed ramp tokens for a chassis: each stop at its own hue, lightness moved only as far as SPEED_RAMP_FLOOR needs. */
function speedInk(surfaces, dark) {
  const k = dark ? 'dark' : 'light';
  return Object.fromEntries([...SPEED_RAMP[k].map((c, i) => ['--spd-' + i, c]), ['--spd-over', SPEED_RAMP.over[k]]]
    .map(([n, c]) => [n, safetyInk(c, surfaces, dark, SPEED_RAMP_FLOOR)]));
}

/** The safety inks' contrast floor for a Theme: 4.5:1, raised by its manifest's `inkFloor` (docs/THEMES.md, Safety). */
export function inkFloor(styleId) { return Math.max(4.5, Number(STYLE_BY_ID.get(styleId)?.inkFloor) || 0); }

// ---- themes and their variants --------------------------------------------------
// A Theme is a whole style (themes/<id>/: chrome, controls, type, icons, textures); a Variant
// is one palette of it. The flat list below holds every (theme, variant) pair as the engine's
// theme object: its id is the variant's, `style` names the Theme, so the old preset ids
// ('slate', 'ember') keep meaning the Phosphor Theme with that variant.
const asTheme = (th, v) => ({
  id: v.id, name: v.name, style: th.id, variant: v.id,
  accents: { reality: v.accents.reality, intent: v.accents.intent, highlight: v.accents.highlight || null },
  chassis: { ...def('chassis'), ...(v.chassis || {}) },
  look: { ...def('look'), ...(v.look || {}) },
  overrides: { ...(v.overrides || {}) },
});

export const THEMES = THEME_LIST.flatMap((th) => th.variants.map((v) => asTheme(th, v)));
export const DEFAULT_THEME = THEMES[0];
const STYLE_BY_ID = new Map(THEME_LIST.map((s) => [s.id, s]));
/** The registered Themes, the default first: id, name, pitch, swatch, note, variants. */
export const STYLES = THEME_LIST;
/** Where an unlocked hidden Theme's id is kept (docs/THEMES.md, Hidden themes). */
export const UNLOCK_KEY = 'phosphor.theme.unlocked';
/** Ids of the hidden Themes this browser has unlocked. */
export function unlockedThemes(st = globalThis.localStorage) {
  try { const a = JSON.parse(st.getItem(UNLOCK_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
/** Records a hidden Theme as found, so the picker and F3 list it from now on. */
export function unlockTheme(id, st = globalThis.localStorage) {
  const a = unlockedThemes(st);
  if (!a.includes(id)) try { st.setItem(UNLOCK_KEY, JSON.stringify([...a, id])); } catch (e) { /* in-memory only: found for this session */ }
}
/** The Themes the picker lists: a `hidden` one only once unlocked, or while it is the one applied. */
export function pickableStyles(t = current) {
  const open = unlockedThemes();
  return STYLES.filter((s) => !s.hidden || open.includes(s.id) || t.style === s.id);
}
/** The Theme manifest for an id, or null. */
export function themeMeta(id) { return STYLE_BY_ID.get(id) || null; }
/** The (theme, variant) objects of one Theme, its own palette first. */
export function variantsOf(styleId) { return THEMES.filter((t) => t.style === styleId); }
/** The preset chips the Display pane shows for a theme: its variants (when it has more than one) and the saved presets. */
export function shownPresets(t = current) {
  const v = variantsOf(t.style);
  return [...(v.length > 1 ? v : []), ...savedPresets()];
}
/** The presets this build ships; plugin themes join THEMES later. */
const SHIPPED = new Set(THEMES.map((t) => t.id));

// ---- derivation -----------------------------------------------------------------
/** `dark`: the comet core lightens on a dark chassis and darkens on a light one. */
function accentPalette(a, dark = true) {
  const r = hexToRgb(a.reality), i = hexToRgb(a.intent), h = hexToRgb(a.highlight || a.reality);
  return {
    reality: a.reality, realityRgb: rgbStr(r), realityArr: r,
    intent: a.intent, intentRgb: rgbStr(i),
    intentDeepRgb: rgbStr(mix(i, 0, 0.15)),
    highlight: a.highlight || a.reality, highlightRgb: rgbStr(h),
    core: rgbToHex(dark ? mix(r, 255, 0.65) : mix(r, 0, 0.45)),
    intentBright: rgbToHex(mix(i, 255, 0.45)),
  };
}

/**
 * The neutral ramp for one chassis over one reference set, contrast-guarded.
 * Text runs toward whichever extreme reads stronger on the weakest surface
 * text sits on (--bg, --bg-card, --bg-sunken; --bg-raised lies between); a
 * mid-gray chassis where neither clears the floor is moved away from the
 * middle until one does.
 */
function neutrals(ch, refs) {
  const dh = ch.hue - KNOBS.chassis.hue[3];
  const color = (hex, L) => fromOklch(clamp(L, 0, 1), REF[hex][1] * ch.tint, REF[hex][2] + dh);
  const attempt = (Lb) => {
    const out = {}, g = {};
    for (const [k, hex] of Object.entries(SURF)) out[k] = color(hex, Lb + (REF[hex][0] - BG[0]) * ch.contrast);
    const worst = (hex) => Math.min(contrast(hex, out['--bg']), contrast(hex, out['--bg-card']), contrast(hex, out['--bg-sunken']));
    const ext = worst('#FFFFFF') >= worst('#000000') ? 1 : 0;
    const rampL = (k) => Lb + g[k] * (ext - Lb);
    for (const [k, hex] of Object.entries(refs)) {
      if (k in SURF) continue;
      const f = (REF[hex][0] - BG[0]) / (1 - BG[0]);
      g[k] = 1 - (1 - f) ** ch.contrast;
    }
    const passes = (k, need) => !(k in g) || worst(color(refs[k], rampL(k))) >= need;
    const guard = (k, need) => {
      if (passes(k, need)) return;
      let lo = g[k], hi = 1;
      for (let n = 0; n < 24; n++) {
        g[k] = (lo + hi) / 2;
        if (passes(k, need)) hi = g[k]; else lo = g[k];
      }
      g[k] = hi;
    };
    guard('--tx', 4.5);
    guard('--tx-mut', 3);
    // Ghost is the quietest step that still labels chrome; --tx-faint is never text.
    guard('--tx-ghost', 3);
    // The ramp keeps its order after the guard moved a step.
    if ('--tx-hi' in g) g['--tx-hi'] = Math.max(g['--tx-hi'], g['--tx']);
    if ('--tx-mut' in g) g['--tx-mut'] = Math.max(g['--tx-mut'], g['--tx-ghost']);
    if ('--tx-val' in g) g['--tx-val'] = Math.max(g['--tx-val'], g['--tx-mut']);
    guard('--tx-hi', 4.5);
    for (const k of Object.keys(g)) out[k] = color(refs[k], rampL(k));
    // Recess shadows: black on a dark chassis, a tinted gray on a light one.
    out['--shade-rgb'] = ext ? '0,0,0' : hexToRgb(fromOklch(Lb * 0.55, BG[1] * ch.tint, BG[2] + dh)).join(',');
    return { out, dark: ext === 1, ok: passes('--tx', 4.5) && passes('--tx-mut', 3) && passes('--tx-ghost', 3) };
  };
  let Lb = clamp(BG[0] + ch.brightness - KNOBS.chassis.brightness[3], 0, 1);
  for (let n = 0; ; n++) {
    const r = attempt(Lb);
    if (r.ok || n >= 100) return r;
    Lb = clamp(Lb + (r.dark ? -0.01 : 0.01), 0, 1);
  }
}

const brackets = (n) => [
  ['M8 0L0 0L0 8', n['--line-4']], ['M0 0L8 0L8 8', n['--line-2']],
  ['M8 8L0 8L0 0', n['--line-2']], ['M0 8L8 8L8 0', n['--line-3']],
].map(([d, c]) => 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 8 8\'%3E%3Cpath d=\'' + d
  + '\' stroke=\'%23' + c.slice(1) + '\' stroke-width=\'1\' fill=\'none\'/%3E%3C/svg%3E")').join(',');

const ALIASES = {
  '--screen': 'var(--bg-sunken)', '--chip': 'var(--bg-card)', '--chip-line': 'var(--line-1)',
  '--shell-fg': 'var(--ink)', '--shell-border': 'var(--line-3)',
  '--line': 'var(--line-1)', '--line-soft': 'var(--line-0)',
  '--ink': 'var(--tx)', '--ink-hi': 'var(--tx-hi)', '--ink-dim': 'var(--tx-mut)', '--ink-faint': 'var(--tx-ghost)',
  '--good': 'var(--reality)', '--r': 'var(--radius)', '--r-s': 'var(--radius)',
  '--sp-1': '.125rem', '--sp-2': '.25rem', '--sp-3': '.5rem', '--sp-4': '.667rem', '--sp-5': '1rem',
  '--gap': 'var(--sp-4)', '--field-floor': '16rem', '--app-pad': '0px', '--measure': '48ch',
};

/**
 * Every derived token for a theme: `base` (the :root set), `hivis` and `more`
 * (the high-legibility and prefers-contrast sets), `ink` (the safety text
 * colors), `palette` for canvases, `dark`, and, with overrides applied, the
 * live text `ratios` and `near` (accent -> the safety color it reads as).
 */
export function deriveTokens(theme) { return derive(normalizeTheme(theme)); }

function derive(t) {
  const { out: n, dark } = neutrals(t.chassis, RAMP);
  const p = accentPalette(t.accents, dark);
  const L = t.look;
  const ga = (a) => +Math.min(1, a * L.glow).toFixed(3);
  const base = {
    ...n,
    '--reality': p.reality, '--reality-rgb': p.realityRgb,
    '--intent': p.intent, '--intent-rgb': p.intentRgb, '--intent-deep-rgb': p.intentDeepRgb,
    '--highlight': p.highlight, '--highlight-rgb': p.highlightRgb,
    '--glow-reality': L.glow ? '0 0 18px rgba(var(--reality-rgb),' + ga(0.5) + '),0 0 42px rgba(var(--reality-rgb),' + ga(0.16) + ')' : 'none',
    '--glow-intent': L.glow ? '0 0 14px rgba(var(--intent-deep-rgb),' + ga(0.16) + ')' : 'none',
    // The echo never fades to nothing: it is a ladder state (law 5).
    '--fx-g-peak': String(+clamp(L.glow, 0.25, 1).toFixed(3)),
    '--fx-glow': (L.motion || KNOBS.look.motion[3]) + 's',
    '--radius': L.radius + 'px',
    '--s': String(L.scale),
    '--num-wght': String(L.numWeight),
    ...ALIASES,
  };
  const wght = String(Math.min(700, L.numWeight + 80));
  const hivis = { ...neutrals(t.chassis, { ...RAMP, ...HIVIS }).out, '--num-wght': wght };
  const more = { ...neutrals(t.chassis, { ...RAMP, ...MORE }).out, '--num-wght': wght };
  for (const k of [...Object.keys(SURF), '--shade-rgb']) { delete hivis[k]; delete more[k]; }
  for (const k of Object.keys(RAMP)) {
    if (!(k in HIVIS)) delete hivis[k];
    if (!(k in MORE)) delete more[k];
  }
  const fin = { ...base, ...t.overrides };
  const hex = (k) => (HEX.test(fin[k]) ? fin[k] : null);
  // Against the worst of the three surfaces text sits on.
  const surf = ['--bg', '--bg-card', '--bg-sunken'].map(hex).filter(Boolean);
  const ratio = (k) => (hex(k) && surf.length ? +Math.min(...surf.map((b) => contrast(hex(k), b))).toFixed(2) : null);
  const inkOn = ['--bg', '--bg-raised', '--bg-card', '--bg-sunken'].map((k) => hex(k) || n[k]);
  // A dark chassis keeps the highlight; a light one gets the pink, darkened to read 4.5:1 on its surfaces.
  base['--neutrino'] = dark ? 'var(--highlight)' : safetyInk(NEUTRINO_LIGHT, inkOn, false);
  const near = {};
  for (const k of ['reality', 'intent', 'highlight']) {
    const v = hex('--' + k);
    const s = v && !(k === 'highlight' && v === hex('--reality')) && nearSafety(v);
    if (s) near[k] = s;
  }
  return {
    base, hivis, more, palette: p, dark, near,
    speed: speedInk(inkOn, dark),
    ink: { '--warn-ink': safetyInk(SAFETY_HEX.amber, inkOn, dark, inkFloor(t.style)), '--bad-ink': safetyInk(SAFETY_HEX.red, inkOn, dark, inkFloor(t.style)) },
    inkOn,
    ratios: { text: ratio('--tx'), labels: ratio('--tx-mut'), reality: ratio('--reality') },
    brackets: brackets({ ...n, ...Object.fromEntries(Object.entries(t.overrides).filter(([, v]) => HEX.test(v))) }),
  };
}

/** Every themeable token, in emission order: the Advanced table's rows. */
export const TOKENS = Object.keys(derive(DEFAULT_THEME).base);

// ---- normalize: any stored, imported or plugin shape -> a complete theme ------
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALUE_RE = /^[^;{}<>\\\r\n]{1,200}$/;
function knob(v, r) {
  const n = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, r[0], r[1]) : r[3];
}
/** An override is kept only for a themeable token and a value that cannot leave its declaration. */
export function validOverride(k, v) {
  return TOKENS.includes(k) && !(k in LOCKED) && typeof v === 'string' && VALUE_RE.test(v.trim());
}

/** Accepts the full object or the old {id, name, reality, intent} accent pair. */
export function normalizeTheme(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const a = t.accents && typeof t.accents === 'object' ? t.accents : t;
  const d = DEFAULT_THEME.accents || { reality: '#4DA6FF', intent: '#A78BFA' };
  const pick = (v, fb) => (HEX.test(v) ? v.toUpperCase() : fb);
  const group = (name) => Object.fromEntries(Object.entries(KNOBS[name]).map(([k, r]) => [k, knob((t[name] || {})[k], r)]));
  const overrides = {};
  if (t.overrides && typeof t.overrides === 'object') {
    for (const [k, v] of Object.entries(t.overrides)) if (validOverride(k, v)) overrides[k] = v.trim();
  }
  const id = ID_RE.test(t.id || '') ? t.id : 'custom';
  return {
    id,
    // The Theme: its own field, else the old `skin`, else the one the id names, else the default style.
    style: STYLE_BY_ID.has(t.style) ? t.style : STYLE_BY_ID.has(t.skin) ? t.skin : (THEMES.find((x) => x.id === t.id) || DEFAULT_THEME).style,
    // A variant is a shipped palette by id; an edited theme is Custom and has none.
    variant: (THEMES.find((x) => x.id === t.id) || {}).variant || null,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40) : id,
    accents: { reality: pick(a.reality, d.reality), intent: pick(a.intent, d.intent), highlight: pick(a.highlight, null) },
    chassis: group('chassis'),
    look: group('look'),
    overrides,
  };
}

// ---- persistence ------------------------------------------------------------------
export const THEME_KEY = 'phosphor.theme';
export const PRESETS_KEY = 'phosphor.theme.presets';
const LEGACY_ID = 'sd32.theme';
const LEGACY_CUSTOM = 'sd32.theme.customColors';
const store = () => globalThis.localStorage;
function read(k, st = store()) { try { return JSON.parse(st.getItem(k)); } catch (e) { return null; } }
function write(k, v, st = store()) { try { st.setItem(k, JSON.stringify(v)); } catch (e) { /* in-memory only */ } }

let legacyPending = null;

/**
 * The stored theme; on first load, the old sd32.theme id and custom pair
 * migrate into it. Legacy keys are read, never written or deleted.
 */
export function loadTheme(st = store()) {
  const raw = read(THEME_KEY, st);
  if (raw && typeof raw === 'object') {
    // A stored shipped id is an unedited preset (an edit makes it Custom), so it
    // follows this build's preset, keeping its look (the footer scale keeps the id).
    const p = SHIPPED.has(raw.id) && THEMES.find((x) => x.id === raw.id);
    return normalizeTheme(p ? { ...p, look: raw.look } : raw);
  }
  let id = null;
  try { id = st.getItem(LEGACY_ID); } catch (e) { /* none */ }
  if (id === 'custom') {
    const c = read(LEGACY_CUSTOM, st) || {};
    return normalizeTheme({ id: 'custom', name: 'Custom', reality: c.reality, intent: c.intent });
  }
  const p = id && presetList(st).find((x) => x.id === id);
  if (p) return normalizeTheme(p);
  // A plugin theme chosen last session: applied once its plugin registers it.
  if (id) legacyPending = id;
  return normalizeTheme(DEFAULT_THEME);
}

export function savedPresets(st = store()) {
  const a = read(PRESETS_KEY, st);
  return Array.isArray(a) ? a.map(normalizeTheme) : [];
}
export function presetList(st = store()) { return [...THEMES, ...savedPresets(st)]; }

// ---- live state ---------------------------------------------------------------------
let current = normalizeTheme(DEFAULT_THEME);
export function currentTheme() { return current; }

// Live accent view for the canvas renderers: mutated in place on apply, so
// importers can hold the reference forever.
export const ACCENT = Object.assign({}, accentPalette(DEFAULT_THEME.accents));
let _cache = {};
/** rgba() for canvas draws: 'r' reality, 'i' intent, 'd' deep intent, 'h' highlight. */
export function ac(kind, alpha) {
  const k = kind + alpha;
  let s = _cache[k];
  if (s) return s;
  const rgb = kind === 'r' ? ACCENT.realityRgb : kind === 'i' ? ACCENT.intentRgb : kind === 'h' ? ACCENT.highlightRgb : ACCENT.intentDeepRgb;
  s = 'rgba(' + rgb + ',' + alpha + ')';
  _cache[k] = s;
  return s;
}

const subs = new Set();
/** Runs after every apply; returns the unsubscribe. */
export function onTheme(fn) { subs.add(fn); return () => subs.delete(fn); }

const decl = (m) => Object.entries(m).map(([k, v]) => k + ':' + v + ';').join('');
const svgUrl = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
/** A Theme's icon set as CSS: the glyph's own <svg> hides and a mask (or a colored image) takes its place. */
export function iconCss(styleId) {
  const s = STYLE_BY_ID.get(styleId);
  if (!s) return '';
  const root = ':root[data-style="' + s.id + '"] [data-icon="';
  return Object.entries(s.icons || {}).map(([name, v]) => {
    const mask = typeof v === 'string';
    const url = svgUrl(mask
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + v + '</svg>'
      : v.svg);
    return root + name + '"]>svg{display:none}' + root + name + '"]::before{content:"";display:block;width:16px;height:16px;'
      + (mask ? 'background:currentColor;-webkit-mask:' + url + ' center/contain no-repeat;mask:' + url + ' center/contain no-repeat}'
        : 'background:' + url + ' center/contain no-repeat}');
  }).join('');
}

/** The CSS for one theme: base, prefers-contrast, hi-vis, then pinned overrides, then the Theme's icon set. */
export function themeCss(theme) {
  const t = normalizeTheme(theme);
  const d = derive(t);
  return ':root:root{' + decl(d.base) + decl(d.ink) + decl(d.speed) + '--og-brackets:' + d.brackets + ';color-scheme:' + (d.dark ? 'dark' : 'light') + '}'
    + '@media (prefers-contrast: more){:root:root{' + decl(d.more) + '}}'
    + ':root:root.hivis{' + decl(d.hivis) + '}'
    + (Object.keys(t.overrides).length ? ':root:root:root{' + decl(t.overrides) + '}' : '')
    + iconCss(t.style);
}

/** First paint: the stored (or migrated) theme. A pending plugin id is not written over. */
export function applyStoredTheme() {
  const t = loadTheme();
  return applyTheme(t, { persist: !legacyPending });
}

/** Apply a preset id or a theme object; persists it unless `persist` is false. */
export function applyTheme(idOrTheme, { persist = true } = {}) {
  const t = typeof idOrTheme === 'string'
    ? normalizeTheme(presetList().find((x) => x.id === idOrTheme) || DEFAULT_THEME)
    : normalizeTheme(idOrTheme);
  current = t;
  const d = derive(t);
  Object.assign(ACCENT, d.palette);
  _cache = {};
  if (persist) { legacyPending = null; write(THEME_KEY, t); }
  if (typeof document !== 'undefined') {
    let el = document.getElementById('themeCss');
    if (!el) {
      el = document.createElement('style');
      el.id = 'themeCss';
      document.head.appendChild(el);
    }
    el.textContent = themeCss(t);
    const root = document.documentElement;
    root.dataset.theme = t.id;
    root.dataset.style = t.style;
    if (t.variant) root.dataset.variant = t.variant; else delete root.dataset.variant;
  }
  for (const fn of subs) { try { fn(t); } catch (e) { console.error('theme subscriber', e); } }
  return t;
}

/** An edit from the Display pane: the result is the Custom theme. */
export function editTheme(fn) {
  const t = normalizeTheme(current);
  fn(t);
  t.id = 'custom';
  t.name = 'Custom';
  return applyTheme(t);
}

/** The look's scale alone (footer, Ctrl shortcuts): the theme keeps its id and name. */
export function setScale(v) {
  return applyTheme({ ...current, look: { ...current.look, scale: v } });
}

export function saveAsPreset(name) {
  const t = { ...normalizeTheme(current), id: 'user-' + Date.now().toString(36), name: String(name || '').trim().slice(0, 40) || 'Saved' };
  write(PRESETS_KEY, [...savedPresets(), t]);
  return applyTheme(t);
}
export function deletePreset(id) {
  write(PRESETS_KEY, savedPresets().filter((p) => p.id !== id));
}

export function exportTheme(t = current) { return JSON.stringify(normalizeTheme(t), null, 2); }
/** Throws on text that is not a theme; an imported theme is applied as Custom under its own name. */
export function importTheme(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !(raw.accents || raw.reality)) throw new Error('not a theme');
  const t = normalizeTheme(raw);
  const named = typeof raw.name === 'string' && raw.name.trim();
  return applyTheme({ ...t, id: 'custom', name: named ? t.name : 'Custom' });
}

/**
 * A theme from a plugin (plugins/host.js validates and namespaces it). Takes
 * the full object or the old accent pair; LOCKED tokens stay unreachable.
 */
export function registerTheme(raw) {
  const t = normalizeTheme(raw);
  if (THEMES.some((x) => x.id === t.id)) return;
  THEMES.push(t);
  if (legacyPending === t.id) applyTheme(t);
}
