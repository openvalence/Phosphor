/**
 * funscript-player.test.mjs -- the funscript player plugin (epic ph-smvd).
 *
 * Node sections (`--unit`, in `npm run check`):
 *   (a) contract   every module exports what CONTRACT.md names; the manifest
 *   (b) prefs      defaults, repair of malformed values, the backup mirror
 *   (c) hero       the spec claims on the valencesim fixture and declines
 *                  without a segments STREAM; the factory entry
 * Browser sections (default, `npm run check:funscript`): see the header of
 * the browser half below.
 *
 * Constraints:
 * - The node sections touch no DOM: every module imports under node.
 * - The export lists below are CONTRACT.md's; change both in one commit.
 * - Channel ids appear here and in fixtures only, never in the plugin.
 *
 * Run: node test/funscript-player.test.mjs --unit
 *      node test/funscript-player.test.mjs [--shot out.png]
 *      node test/funscript-player.test.mjs --live --port P --http P+7
 */
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/index.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { claimAll } from '../src/model/roles.js';

const args = process.argv.slice(2);
const UNIT = args.includes('--unit');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!cond) fails++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const P = '../plugins/factory/funscript-player/';
const CONTRACT = {
  [P + 'funscript.js']: ['MAX_SPAN_MS', 'AXES', 'parseFunscript', 'axisOf', 'pairFiles', 'posAt', 'indexAfter',
    'speedAt', 'thin', 'heat', 'fmtTime'],
  [P + 'clock.js']: ['CLOCK_WINDOW', 'SLEW_MS_PER_S', 'STEP_MS', 'FALLBACK_AFTER_MS', 'createMediaClock', 'frameSource'],
  [P + 'scheduler.js']: ['STOP_MS', 'PREROLL_MIN_MS', 'PREROLL_STROKE_MS', 'PREROLL_SKIP', 'OFFER_MAX', 'TRANSIENT',
    'applyT', 'strokeSpeed', 'createScheduler'],
  [P + 'stash.js']: ['SCENES_QUERY', 'SORTS', 'COPY', 'normalizeBase', 'rebase', 'withKey', 'toScene', 'createStash'],
  [P + 'library.js']: ['CSS', 'COPY', 'mountLibrary', 'mountConnect'],
  [P + 'ui.js']: ['CSS', 'COPY', 'createPlayer'],
  [P + 'timeline.js']: ['ZOOMS', 'CSS', 'COPY', 'curvePoints', 'seekAt', 'mountTimeline'],
  [P + 'prefs.js']: ['PREFS', 'readPrefs', 'writePref'],
  [P + 'index.js']: ['activate'],
  '../src/model/motion.js': ['SEG_FLOOR_MS', 'streamGate', 'createMotionDoor', 'bundleHead', 'motionStream'],
  '../src/model/actions.js': ['railOwners', 'railOwnerName'],
  '../src/plugins/host.js': ['MOTION_HOLD_MS', 'createPluginHost', 'validateManifest'],
};

// ---- (a) every module exports what CONTRACT.md names ------------------------
console.log('(a) contract exports');
const mods = {};
for (const [path, names] of Object.entries(CONTRACT)) {
  let m = null;
  try { m = await import(new URL(path, import.meta.url)); } catch (e) { ok(path + ' imports', false, e.message); continue; }
  mods[path] = m;
  const missing = names.filter((n) => !(n in m));
  ok(path.replace(P, ''), missing.length === 0, missing.length ? 'missing ' + missing.join(', ') : undefined);
}

const door = mods['../src/model/motion.js'];
if (door && door.createMotionDoor) {
  const submit = door.createMotionDoor({ session: () => null, entries: () => [], setpoint: () => ({ ok: false }), log: () => {} });
  ok('createMotionDoor(...).segments is a function', typeof submit.segments === 'function');
}

const host = mods['../src/plugins/host.js'];
const manifest = JSON.parse(readFileSync(new URL(P + 'manifest.json', import.meta.url), 'utf8'));
if (host && host.validateManifest) {
  const problems = host.validateManifest(manifest);
  ok('manifest validates', problems.length === 0, problems.join('; ') || undefined);
}
ok('manifest declares motion and net.fetch, never intent',
  manifest.permissions.includes('motion') && manifest.permissions.includes('net.fetch') && !manifest.permissions.includes('intent'));

// ---- (b) prefs ----------------------------------------------------------------
console.log('(b) prefs');
const prefs = mods[P + 'prefs.js'];
if (prefs) {
  const { PREFS, readPrefs, writePref } = prefs;
  const ls = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) } });
  const fakeApi = (seed = {}) => {
    const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
    return { m, prefs: { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) } };
  };
  const want = { T: { offsetMs: 0, lo: 0, hi: 1, invert: false }, motion: true, audio: { vol: 1, muted: false },
    stash: { base: '', key: '' }, lib: { q: '', sort: 'date', direction: 'DESC' }, view: 'player', zoomMs: 10000 };
  ok('PREFS is the contract shape', same(PREFS, want));
  ok('PREFS is frozen to the leaves', Object.isFrozen(PREFS) && Object.isFrozen(PREFS.T) && Object.isFrozen(PREFS.lib));
  ok('an empty store reads the defaults', same(readPrefs(fakeApi()), want));
  const bad = readPrefs(fakeApi({ T: { offsetMs: 'x', lo: 0.9, hi: 0.92, invert: 1 }, motion: 'yes', audio: { vol: 3 },
    stash: { base: 'http://s:9999' }, lib: { direction: 'up', sort: '' }, view: 'grid', zoomMs: -4 }));
  ok('malformed values are replaced, partial objects filled', same(bad, { ...want,
    stash: { base: 'http://s:9999', key: '' } }), bad);
  const t = readPrefs(fakeApi({ T: { offsetMs: 512, lo: 0.2, hi: 0.8, invert: true } })).T;
  ok('offset clamps to 500, a valid range and invert survive', same(t, { offsetMs: 500, lo: 0.2, hi: 0.8, invert: true }), t);
  ok('offset rounds to its 5 ms step', readPrefs(fakeApi({ T: { offsetMs: -12 } })).T.offsetMs === -10);
  ok('an array is not an object pref', same(readPrefs(fakeApi({ audio: [1, 2] })).audio, want.audio));
  const a = fakeApi();
  writePref(a, 'T', { offsetMs: 45, lo: 0.1, hi: 0.9, invert: false });
  writePref(a, 'stash', { base: 'http://s:9999', key: 'secret' });
  ok('writePref stores through api.prefs', same(a.prefs.get('T'), { offsetMs: 45, lo: 0.1, hi: 0.9, invert: false }));
  ok('every key but stash is mirrored under phosphor.funscript.*', ls.has('phosphor.funscript.T') && !ls.has('phosphor.funscript.stash')
    && ![...ls.values()].some((v) => v.includes('secret')));
  ok('a restored backup (mirror only) reads back', readPrefs(fakeApi()).T.offsetMs === 45);
  writePref(a, 'audio', { vol: 7, muted: true });
  ok('writePref stores the repaired value', same(a.prefs.get('audio'), { vol: 1, muted: true }));
  let threw = false;
  try { writePref(a, 'volume', 1); } catch (e) { threw = true; }
  ok('an unknown key throws', threw);
  delete globalThis.localStorage;
  ok('no localStorage: reads still work', same(readPrefs(fakeApi()), want));
}

// ---- (c) the hero spec: claims with a segments STREAM, declines without ------
console.log('(c) hero spec');
const index = mods[P + 'index.js'];
const ENTRIES = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
const SEG_CH = 0x2101;   // valencesim motion-segment (registry 0x2101), test-side only
if (index) {
  const heroes = [];
  let settings = null;
  const api = {
    registerHero: (d) => heroes.push(d), registerSettings: (m) => { settings = m; },
    prefs: { get: () => null, set() {} }, gate: () => '', field: () => null, value: () => undefined, log() {},
  };
  let deact = null;
  try { deact = index.activate(api); } catch (e) { ok('activate under node (no DOM touched at create)', false, e.message); }
  const h = heroes[0];
  ok('one hero, id player, title, absorb false, cells', heroes.length === 1 && h.id === 'player' && h.title === 'Funscript player'
    && h.absorb === false && same(h.cells, { h: [16, 12], v: [8, 16] }));
  ok('spec requires input.target and input.duration', !!h && same(h.spec.require, { target: 'input.target', dur: 'input.duration' }));
  ok('spec binds the six optional roles', !!h && same(h.spec.optional, { pos: 'telemetry.position', lo: 'window.min', hi: 'window.max',
    vmax: 'limit.input.speed', patRun: 'pattern.running', advRun: 'advgen.running' }));
  ok('a settings card is registered', typeof settings === 'function');
  ok('activate returns deactivate', typeof deact === 'function');
  if (h) {
    const claim = (entries) => claimAll(buildSettingsModel(entries).byRole, [{ id: 'p', spec: h.spec, absorb: false }]);
    const w = claim(ENTRIES).widgets[0];
    ok('claims on the valencesim fixture, dur on the segments STREAM', !!w && w.fields.dur.channelId === SEG_CH);
    ok('every optional role binds there', !!w && ['pos', 'lo', 'hi', 'vmax', 'patRun', 'advRun'].every((k) => w.fields[k]));
    ok('absorb false claims nothing away', claim(ENTRIES).claimed.size === 0);
    ok('declines without a segments STREAM (D1)', claim(ENTRIES.filter((e) => e.id !== SEG_CH)).widgets.length === 0);
  }
}
{
  let factory = null;
  try { factory = await import('../src/plugins/factory.js'); } catch (e) { ok('factory.js imports', false, e.message); }
  const f = factory && factory.FACTORY.find((x) => x.manifest.name === 'funscript-player');
  ok('listed in FACTORY with its manifest', !!f && same(f.manifest, manifest) && f.module.activate === (index && index.activate));
}

if (UNIT || fails) {
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
}
