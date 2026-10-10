/**
 * dynamic-color.test.mjs -- the Material skin's system palette (src/model/dynamicColor.js,
 * MainActivity.kt) with no browser: a fake wallpaper palette in, a theme out, and for every
 * palette the text guard, 4.5:1 accents on every surface, no accent on a safety hue, safety
 * inks that read, and the on-color of a filled button. The browser half (the page applying
 * it, the stop pair under it) is in theme-skins.test.mjs.
 *
 * Run: node test/dynamic-color.test.mjs
 */
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null, clear: () => mem.clear(),
}, configurable: true });
const T = await import('../src/model/theme.js');
const { paletteTheme } = await import('../src/model/dynamicColor.js');

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

const TONES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
/** A tone ramp the way Android makes one: lightness falls with the tone, chroma peaks in the middle. */
const ramp = (hue, chroma) => Object.fromEntries(TONES.map((t) => [t, T.fromOklch(1 - t / 1000 * 0.97, chroma * Math.sin(Math.PI * Math.min(1, Math.max(0.05, 1 - t / 1000))) ** 0.7, hue)]));
const palette = (h1, c1, night, h2 = h1 + 30, h3 = h1 + 60, cn = 0.012) => ({
  accent1: ramp(h1, c1), accent2: ramp(h2, c1 * 0.4), accent3: ramp(h3, c1 * 0.8), neutral1: ramp(h1, cn), neutral2: ramp(h1, cn * 2), night,
});

const base = T.THEMES.find((t) => t.id === 'material');
ok('the Material preset is in the list and is its own Theme', base && base.style === 'material');

let n = 0, worstAcc = Infinity, worstText = Infinity, worstLabel = Infinity, worstOn = Infinity, near = 0, inkLow = 0, nulls = 0;
const hues = [0, 25, 60, 80, 95, 130, 170, 210, 250, 290, 330];
const chromas = [0, 0.02, 0.06, 0.12, 0.2, 0.3];
for (const night of [true, false]) {
  for (const h of hues) {
    for (const c of chromas) {
      const p = palette(h, c, night, h + 40, h + 80, c ? 0.012 : 0);
      const r = paletteTheme(base, p);
      if (!r) { nulls++; continue; }
      const d = T.deriveTokens(r.theme);
      const surf = ['--bg', '--bg-raised', '--bg-card', '--bg-sunken'].map((k) => d.base[k]);
      const w = (hex) => Math.min(...surf.map((s) => T.contrast(hex, s)));
      for (const k of ['reality', 'intent', 'highlight']) {
        const hex = r.theme.accents[k];
        worstAcc = Math.min(worstAcc, w(hex));
        if (T.nearSafety(hex)) near++;
      }
      worstText = Math.min(worstText, d.ratios.text);
      worstLabel = Math.min(worstLabel, d.ratios.labels);
      for (const ink of Object.values(d.ink)) if (w(ink) < 4.5) inkLow++;
      // The filled primary button: its on-color is the sunken surface in the dark scheme, white in the light one.
      const on = r.light ? '#FFFFFF' : d.base['--bg-sunken'];
      worstOn = Math.min(worstOn, T.contrast(r.theme.accents.reality, on));
      if (r.light !== !night) fails++;
      n++;
    }
  }
}
console.log('derivation: ' + n + ' palettes, light and dark');
ok('every palette derives', nulls === 0, nulls + ' refused');
ok('accents read 4.5:1 on every surface, however the wallpaper is colored', worstAcc >= 4.5, worstAcc.toFixed(2));
ok('no derived accent sits on a safety hue', near === 0, near + ' did');
ok('text clears 4.5:1 and labels 3:1 (the engine\'s guard)', worstText >= 4.5 && worstLabel >= 3, worstText.toFixed(2) + ' / ' + worstLabel.toFixed(2));
ok('the safety inks read 4.5:1', inkLow === 0, inkLow + ' under');
ok('a filled primary button reads 4.5:1 in its on-color', worstOn >= 4.5, worstOn.toFixed(2));

ok('an incomplete palette is refused, the baseline stays', paletteTheme(base, { accent1: { 0: '#FFFFFF' } }) === null && paletteTheme(base, null) === null);
const r = paletteTheme(base, palette(300, 0.12, true));
ok('the preset\'s id, name, Theme and look survive', r.theme.id === 'material' && r.theme.style === 'material' && r.theme.look.radius === base.look.radius);
ok('the derived chassis is dark for a night palette and light for a day one', !T.deriveTokens(r.theme).dark === false
  && T.deriveTokens(paletteTheme(base, palette(300, 0.12, false)).theme).dark === false);
ok('nothing in the derived theme can reach a safety token', !Object.keys(r.theme.overrides).some((k) => k in T.LOCKED) && !/--(warn|bad|estop)/.test(T.themeCss(r.theme).replace(/--(warn|bad)-ink/g, '')));

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
