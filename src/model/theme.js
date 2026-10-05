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
 * Model, knobs and the light-chassis finding: docs/THEMES.md.
 */

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

/** Never part of a theme, with the reason the editor shows. */
export const LOCKED = {
  '--warn': 'safety color (law 13)',
  '--bad': 'safety color (law 13)',
  '--warn-rgb': 'safety color (law 13)',
  '--bad-rgb': 'safety color (law 13)',
  '--estop': 'safety color (law 13)',
  '--glow-warn': 'safety color (law 13)',
  '--warn-ink': 'safety color (law 13)',
  '--bad-ink': 'safety color (law 13)',
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
  '--chrome-inset-top': 'safe-area owner',
  '--font': 'bundled font',
  '--mono': 'bundled font',
  '--og-brackets': 'derived from the lines',
};
/** The safety swatches the editor shows locked. */
export const SAFETY = ['--warn', '--bad', '--estop'];
/** style.css's locked values; test/theme.test.mjs holds them equal. */
const SAFETY_HEX = { amber: '#F5B94D', red: '#FF4757' };

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

/** A safety color as text: its own hue at the nearest lightness that reads 4.5:1 on every surface. */
function safetyInk(hex, surfaces, dark) {
  const worst = (c) => Math.min(...surfaces.map((s) => contrast(c, s)));
  if (worst(hex) >= 4.5) return hex;
  const [L, C, h] = toOklch(hex);
  let lo = L, hi = dark ? 1 : 0;
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (worst(fromOklch(mid, C, h)) >= 4.5) hi = mid; else lo = mid;
  }
  return fromOklch(hi, C, h);
}

// ---- presets ------------------------------------------------------------------
const preset = (id, name, reality, intent, chassis = {}, extra = {}) => ({
  id, name,
  accents: { reality, intent, highlight: extra.highlight || null },
  chassis: { ...def('chassis'), ...chassis },
  look: def('look'),
  overrides: {},
});

export const THEMES = [
  // A highlight of its own (2026-10-04): with the reality fallback the planner line and the heat ramp's top read as the position trace.
  preset('phosphor', 'Phosphor', '#4DA6FF', '#A78BFA', {}, { highlight: '#FF5CB3' }),
  preset('tracer', 'Tracer', '#52E88C', '#E85CFF'),
  preset('synth', 'Synth', '#FF5CA8', '#5CE8FF'),
  preset('ember', 'Ember', '#FF8A4D', '#4CCEFE'),
  preset('arctic', 'Arctic', '#7DE8FF', '#C4B5FD'),
  preset('vapor', 'Vapor', '#B78BFF', '#FF8BD1'),
  preset('ultra', 'Ultra', '#8B7BFF', '#4DFFC4'),
  preset('sakura', 'Sakura', '#FFA8C5', '#A8D8FF'),
  preset('stealth', 'Stealth', '#D8DEE8', '#8A93A6'),
  preset('slate', 'Slate', '#5CC8FF', '#9D8BFA', { hue: 245, tint: 2.4, brightness: 0.2, contrast: 1 }),
  preset('ink', 'Warm ink', '#66D5BA', '#E8A0FF', { hue: 60, tint: 1.8, brightness: 0.15, contrast: 1.05 }),
  preset('paper', 'Paper', '#1A66C8', '#6A3FC8', { hue: 263, tint: 1, brightness: 0.97, contrast: 1 }),
];
export const DEFAULT_THEME = THEMES[0];

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
  '--gap': 'var(--sp-4)', '--field-floor': '16rem', '--measure': '48ch',
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
  const near = {};
  for (const k of ['reality', 'intent', 'highlight']) {
    const v = hex('--' + k);
    const s = v && !(k === 'highlight' && v === hex('--reality')) && nearSafety(v);
    if (s) near[k] = s;
  }
  return {
    base, hivis, more, palette: p, dark, near,
    ink: { '--warn-ink': safetyInk(SAFETY_HEX.amber, inkOn, dark), '--bad-ink': safetyInk(SAFETY_HEX.red, inkOn, dark) },
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
  if (raw && typeof raw === 'object') return normalizeTheme(raw);
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
/** The CSS for one theme: base, prefers-contrast, hi-vis, then pinned overrides. */
export function themeCss(theme) {
  const t = normalizeTheme(theme);
  const d = derive(t);
  return ':root:root{' + decl(d.base) + decl(d.ink) + '--og-brackets:' + d.brackets + ';color-scheme:' + (d.dark ? 'dark' : 'light') + '}'
    + '@media (prefers-contrast: more){:root:root{' + decl(d.more) + '}}'
    + ':root:root.hivis{' + decl(d.hivis) + '}'
    + (Object.keys(t.overrides).length ? ':root:root:root{' + decl(t.overrides) + '}' : '');
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
