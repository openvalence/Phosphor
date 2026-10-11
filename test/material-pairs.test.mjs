/**
 * material-pairs.test.mjs -- the contrast of every text-on-surface pair the Material theme.css builds, under the three
 * Variants and under 132 fake system palettes (the grid of test/dynamic-color.test.mjs), read from
 * the computed tokens in a bare page: no shell, no hub. The containers and tiers are CSS (relative
 * colors), so only a browser can say what they come to.
 *
 * Run: node test/material-pairs.test.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null, clear: () => mem.clear(),
}, configurable: true });
const { THEMES, themeCss, fromOklch } = await import('../src/model/theme.js');
const { paletteTheme } = await import('../src/model/dynamicColor.js');
const CSS = readFileSync(new URL('../src/themes/material/theme.css', import.meta.url), 'utf8').replace(/url\('\.\/fonts\/[^']+'\)/g, 'local(none)');

// [name, text token, surface token, floor]: the pairs the Theme builds, from the rules that name them.
const PAIRS = [
  ['filled button', '--md-on-p', '--reality'], ['primary container', '--md-on-pc', '--md-pc'], ['tonal button, rail pill', '--md-on-sc', '--md-sc'],
  ['tertiary badge', '--md-on-tc', '--md-tc'], ['outlined button on a bar', '--reality', '--md-s1'], ['outlined button on a card', '--reality', '--md-s2'],
  ['text button on a menu', '--reality', '--md-s3'], ['active tab on the secondary container', '--reality', '--md-sc'], ['text on a card', '--tx', '--md-s2'],
  ['heading on a menu', '--tx-hi', '--md-s3'], ['value text on a bar', '--tx-val', '--md-s1'], ['value text on a card', '--tx-val', '--md-s2'],
  ['label on a card', '--tx-mut', '--md-s2', 3], ['label on a menu', '--tx-mut', '--md-s3', 3], ['chrome key on a bar', '--tx-ghost', '--md-s1', 3],
  ['title on the primary container', '--tx-hi', '--md-pc'], ['tooltip', '--bg', '--tx'], ['focus ring on a card', '--highlight', '--md-s2', 3],
];

const ramp = (hue, chroma) => Object.fromEntries([0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
  .map((t) => [t, fromOklch(1 - t / 1000 * 0.97, chroma * Math.sin(Math.PI * Math.min(1, Math.max(0.05, 1 - t / 1000))) ** 0.7, hue)]));
const fake = (hue, chroma, night) => ({ accent1: ramp(hue, chroma), accent2: ramp(hue + 40, chroma * 0.4), accent3: ramp(hue + 80, chroma * 0.8),
  neutral1: ramp(hue, chroma ? 0.012 : 0), neutral2: ramp(hue, 0.024), night });

const subjects = THEMES.filter((t) => t.style === 'material').map((t) => ({ name: t.id, theme: t, scheme: null }));
const base = THEMES.find((t) => t.id === 'material');
for (const night of [true, false]) for (const h of [0, 25, 60, 80, 95, 130, 170, 210, 250, 290, 330]) for (const c of [0, 0.02, 0.06, 0.12, 0.2, 0.3]) {
  const r = paletteTheme(base, fake(h, c, night));
  subjects.push({ name: (night ? 'night ' : 'day ') + h + '/' + c, theme: r.theme, scheme: r.light ? 'light' : 'dark' });
}

const browser = await chromium.launch();
const page = await browser.newPage();
const worst = new Map();
for (const s of subjects) {
  const variant = s.theme.id;
  await page.setContent('<!doctype html><html data-style="material" data-variant="' + variant + '"' + (s.scheme ? ' data-md-scheme="' + s.scheme + '"' : '')
    + '><head><style>' + themeCss(s.theme) + CSS + '</style></head><body><i id="p"></i></body></html>');
  const got = await page.evaluate((pairs) => {
    const probe = document.getElementById('p');
    const rgb = (v) => { probe.style.color = ''; probe.style.color = 'var(' + v + ')'; const m = /color\(srgb ([^)]+)\)|rgba?\(([^)]+)\)/.exec(getComputedStyle(probe).color);
      const p = (m[1] || m[2]).split(/[\s,/]+/).filter(Boolean).map(Number); return m[1] ? p.slice(0, 3).map((x) => x * 255) : p.slice(0, 3); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    return pairs.map(([n, a, b]) => { const l1 = lum(rgb(a)), l2 = lum(rgb(b)); return [n, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)]; });
  }, PAIRS);
  for (const [n, v] of got) { const w = worst.get(n); if (!w || v < w.v) worst.set(n, { v, at: s.name }); }
}
await browser.close();
let low = 0;
console.log(subjects.length + ' subjects (' + subjects.filter((s) => !s.scheme).length + ' variants, the rest system palettes)');
for (const [n, w] of worst) {
  const need = PAIRS.find((p) => p[0] === n)[3] || 4.5;
  if (w.v < need) low++;
  console.log((w.v >= need ? 'ok   ' : 'LOW  ') + n.padEnd(40) + w.v.toFixed(2) + ' (floor ' + need + ') worst: ' + w.at);
}
process.exit(low ? 1 : 0);
