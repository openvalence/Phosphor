/**
 * theme.test.mjs -- the theme engine with no browser (ph-vdk.64): the
 * default chassis reproduces style.css, the contrast guard holds over the
 * whole knob space, pinned overrides win and safety tokens cannot be pinned,
 * the old theme keys migrate, plugins may register either shape, every
 * :root token is themeable or named not themeable, and the backup carries
 * the new keys.
 *
 * Run: node test/theme.test.mjs
 */
import { readFileSync } from 'node:fs';

const mem = new Map();
const storage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const T = await import('../src/model/theme.js');
const { createPluginHost } = await import('../src/plugins/host.js');
const { exportBackup } = await import('../src/model/prefs.js');

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const dist = (a, b) => Math.max(...T.hexToRgb(a).map((v, i) => Math.abs(v - T.hexToRgb(b)[i])));
const block = (sel) => {
  const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2].toUpperCase()])) : {};
};

// ---- derivation: the default chassis IS style.css ----------------------------
console.log('derivation');
const D = T.deriveTokens(T.DEFAULT_THEME);
const root = block(':root');
const hexTokens = Object.keys(root).filter((k) => k in D.base && /^#/.test(D.base[k]));
ok('style.css :root carries the neutral hexes', hexTokens.length >= 16, hexTokens.length + ' tokens');
const off = hexTokens.filter((k) => dist(root[k], D.base[k]) > 2);
ok('default chassis reproduces every :root hex within 2 RGB units', off.length === 0, off.map((k) => k + ' ' + root[k] + '/' + D.base[k]).join(', '));
const sunk = T.hexToRgb(root['--bg-sunken']).map((v) => v * 0.4);
ok('--shell-bg reproduces color-mix(--bg-sunken 40%, #000)', T.hexToRgb(D.base['--shell-bg']).every((v, i) => Math.abs(v - sunk[i]) <= 2), D.base['--shell-bg']);
for (const [sel, set] of [['html.hivis', D.hivis], [':root {\n    --tx', D.more]]) {
  const want = sel === 'html.hivis' ? block('html.hivis') : Object.fromEntries([...css.match(/prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/)[1]
    .matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2].toUpperCase()]));
  const bad = Object.keys(want).filter((k) => !set[k] || dist(want[k], set[k]) > 2);
  ok((sel === 'html.hivis' ? 'hi-vis' : 'prefers-contrast') + ' set reproduces style.css', Object.keys(want).length > 0 && bad.length === 0, bad.join(', '));
}
ok('accents reproduce :root', D.base['--reality'] === root['--reality'] && D.base['--intent'] === root['--intent']);
ok('highlight defaults to reality', D.base['--highlight'] === D.base['--reality'] && D.base['--highlight-rgb'] === D.base['--reality-rgb']);
ok('default chassis is dark', D.dark === true && T.themeCss(T.DEFAULT_THEME).includes('color-scheme:dark'));
ok('OKLCH round trip is exact on the references', ['#08090B', '#ECEFF4', '#4DA6FF'].every((h) => T.fromOklch(...T.toOklch(h)) === h));
for (const t of T.THEMES.slice(0, 9)) {
  const d = T.deriveTokens(t);
  if (dist(d.base['--bg'], root['--bg']) || dist(d.base['--tx'], root['--tx'])) ok(t.id + ': default chassis', false);
}
ok('the nine original presets keep the default chassis', T.THEMES.slice(0, 9).every((t) => JSON.stringify(t.chassis) === JSON.stringify(T.DEFAULT_THEME.chassis)));

// ---- contrast guard over the knob space ----------------------------------------
console.log('contrast guard');
const worst = (d, k) => Math.min(T.contrast(d.base[k], d.base['--bg']), T.contrast(d.base[k], d.base['--bg-card']));
let floor = { tx: Infinity, mut: Infinity, at: '' }, order = 0, n = 0;
for (let b = 0; b <= 1.0001; b += 0.05) {
  for (const c of [0.5, 0.75, 1, 1.5, 2]) {
    for (const [hue, tint] of [[263, 1], [30, 4], [140, 4], [300, 0]]) {
      const d = T.deriveTokens({ ...T.DEFAULT_THEME, chassis: { hue, tint, brightness: b, contrast: c } });
      const tx = worst(d, '--tx'), mut = worst(d, '--tx-mut');
      if (tx < floor.tx) floor = { ...floor, tx, at: [b.toFixed(2), c, hue].join('/') };
      if (mut < floor.mut) floor.mut = mut;
      const hi = worst(d, '--tx-hi');
      if (hi < 4.5 || hi < tx * 0.99) order++;
      n++;
    }
  }
}
ok('--tx never under 4.5:1 on --bg or --bg-card (' + n + ' chassis)', floor.tx >= 4.5, floor.tx.toFixed(2) + ' at ' + floor.at);
ok('--tx-mut never under 3:1', floor.mut >= 3, floor.mut.toFixed(2));
ok('--tx-hi clears 4.5:1 and never reads weaker than --tx', order === 0, order + ' inversions');
const light = T.deriveTokens(T.THEMES.find((t) => t.id === 'paper'));
ok('the light preset is light and says so', light.dark === false && T.themeCss(T.THEMES.find((t) => t.id === 'paper')).includes('color-scheme:light'));
ok('the light preset clears 4.5:1 for text and reality on every surface', light.ratios.text >= 4.5 && light.ratios.reality >= 4.5,
  JSON.stringify(light.ratios));

// ---- overrides ------------------------------------------------------------------
console.log('overrides');
const pinned = T.normalizeTheme({ ...T.DEFAULT_THEME, overrides: { '--bg': '#123456', '--warn': '#00FF00', '--bad-rgb': '0,255,0', '--estop': 'blue', '--tx': 'red;}body{x:y', '--nope': '1px' } });
ok('a themeable token may be pinned', pinned.overrides['--bg'] === '#123456');
ok('safety tokens cannot be pinned', !('--warn' in pinned.overrides) && !('--bad-rgb' in pinned.overrides) && !('--estop' in pinned.overrides));
ok('a value that could leave its declaration is dropped', !('--tx' in pinned.overrides));
ok('an unknown token is dropped', !('--nope' in pinned.overrides));
const pcss = T.themeCss(pinned);
ok('the pinned block comes last at the highest specificity', pcss.lastIndexOf(':root:root:root{--bg:#123456;}') === pcss.length - ':root:root:root{--bg:#123456;}'.length
  && pcss.indexOf(':root:root.hivis{') < pcss.indexOf(':root:root:root{'));
ok('the ratio readout follows a pinned value', T.deriveTokens(pinned).ratios.text !== D.ratios.text);
ok('no theme CSS names a safety token', !/--warn|--bad|--estop/.test(T.themeCss({ ...T.DEFAULT_THEME, overrides: { '--warn': '#000000' } })));

// ---- token set coverage ------------------------------------------------------------
console.log('token set');
const declared = new Set();
for (const m of css.matchAll(/:root\s*\{([^}]*)\}/g)) for (const x of m[1].matchAll(/(--[\w-]+)\s*:/g)) declared.add(x[1]);
const loose = [...declared].filter((k) => !T.TOKENS.includes(k) && !(k in T.LOCKED));
ok('every :root custom property is themeable or named not themeable', loose.length === 0, loose.join(', '));
ok('no token is both themeable and locked', T.TOKENS.every((k) => !(k in T.LOCKED)));
ok('the safety set is locked', ['--warn', '--bad', '--warn-rgb', '--bad-rgb', '--estop'].every((k) => k in T.LOCKED));

// ---- persistence and migration ----------------------------------------------------
console.log('migration');
mem.clear();
mem.set('sd32.theme', 'custom');
mem.set('sd32.theme.customColors', JSON.stringify({ reality: '#12ab34', intent: '#AB12CD' }));
let t = T.loadTheme();
ok('the old custom pair migrates', t.accents.reality === '#12AB34' && t.accents.intent === '#AB12CD' && t.accents.highlight === null);
mem.clear();
mem.set('sd32.theme', 'ember');
ok('an old preset id migrates', T.loadTheme().id === 'ember' && T.loadTheme().accents.reality === '#FF8A4D');
mem.set('phosphor.theme', JSON.stringify({ ...T.THEMES.find((x) => x.id === 'slate') }));
ok('the new key wins over the legacy ones', T.loadTheme().id === 'slate');
mem.clear();
mem.set('sd32.theme', 'mytheme-neon');
T.applyStoredTheme();
ok('a plugin theme id is not written over before its plugin loads', !mem.has('phosphor.theme') && mem.get('sd32.theme') === 'mytheme-neon');
T.registerTheme({ id: 'mytheme-neon', name: 'Neon', reality: '#00FFAA', intent: '#FF00AA' });
ok('...and applies once it registers', T.currentTheme().id === 'mytheme-neon' && JSON.parse(mem.get('phosphor.theme')).accents.reality === '#00FFAA');
ok('legacy keys are never deleted', mem.get('sd32.theme') === 'mytheme-neon');
ok('garbage storage falls back to the default', (mem.set('phosphor.theme', '{"chassis":{"hue":"x","tint":99}}'), T.loadTheme().chassis.hue === 263 && T.loadTheme().chassis.tint === 4));

// ---- presets, edits, export/import ---------------------------------------------------
console.log('presets');
mem.clear();
T.applyTheme('ember');
T.editTheme((x) => { x.chassis.brightness = 0.3; });
ok('an edit is the Custom theme', T.currentTheme().id === 'custom' && T.currentTheme().accents.reality === '#FF8A4D');
const saved = T.saveAsPreset('Mine');
ok('save as preset stores and selects it', saved.id.startsWith('user-') && T.presetList().some((p) => p.id === saved.id && p.name === 'Mine'));
T.deletePreset(saved.id);
ok('a saved preset deletes', !T.presetList().some((p) => p.id === saved.id));
const json = T.exportTheme();
T.applyTheme('phosphor');
T.importTheme(json);
ok('export then import round-trips the knobs', T.currentTheme().chassis.brightness === 0.3 && T.currentTheme().accents.reality === '#FF8A4D');
let threw = false;
try { T.importTheme('{"hello":1}'); } catch (e) { threw = true; }
ok('import refuses a non-theme', threw);
ok('a motion of 0 is kept (still)', T.normalizeTheme({ look: { motion: 0 } }).look.motion === 0);
ok('the backup carries the theme and presets keys', (T.saveAsPreset('B'), /phosphor\.theme"/.test(exportBackup()) && /phosphor\.theme\.presets/.test(exportBackup())));

// ---- plugin shapes ----------------------------------------------------------------------
console.log('plugins');
const got = [];
const host = createPluginHost({ model: () => null, sample: () => undefined, sampleAge: () => Infinity, display: () => undefined,
  status: () => 'confirmed', write: () => {}, submitMotion: () => ({ ok: true }), registerTheme: (x) => got.push(x),
  listenTcp: null, prefs: null, log: () => {} });
const manifest = { name: 'skins', version: '1', api: 1, kind: 'theme', entry: 'index.js', description: 'Skins', roles: [], channels: [], permissions: [] };
const rec = host.add(manifest, { activate(api) {
  api.registerTheme({ id: 'old', name: 'Old', reality: '#112233', intent: '#445566' });
  api.registerTheme({ id: 'full', name: 'Full', accents: { reality: '#112233', intent: '#445566', highlight: '#FFFFFF' },
    chassis: { hue: 30, tint: 2, brightness: 0.2, contrast: 1.2 }, overrides: { '--warn': '#000000', '--radius': '6px' } });
} }, {});
ok('a theme plugin activates', rec.status === 'active' && !rec.error, rec.error || '');
ok('the old accent pair is accepted', got.some((x) => x.id === 'skins-old' && x.reality === '#112233'));
for (const x of got) T.registerTheme(x);
const full = T.THEMES.find((x) => x.id === 'skins-full');
ok('the full object is accepted, namespaced', full && full.chassis.hue === 30 && full.accents.highlight === '#FFFFFF');
ok('a plugin cannot pin a safety token', full && !('--warn' in full.overrides) && full.overrides['--radius'] === '6px');

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
