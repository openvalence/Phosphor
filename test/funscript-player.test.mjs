/**
 * funscript-player.test.mjs -- the funscript player plugin (epic ph-smvd).
 *
 * Node sections (`--unit`, in `npm run check`):
 *   (a) contract   every module exports what CONTRACT.md names; the manifest
 *   (b) prefs      defaults, repair of malformed values, the backup mirror
 *   (c) hero       the spec claims on the valencesim fixture and declines
 *                  without a segments STREAM; the factory entry
 *   (c2) analyzer  the Tuning groups by catalog and role on the tuning
 *                  fixture (the recording with RFC-094 groups and RFC-099
 *                  settings-trial patched in), lagOf
 * Browser sections (default, `npm run check:funscript`; needs ffmpeg on
 * PATH): see the header of the browser half below.
 *
 * Constraints:
 * - The node sections touch no DOM: every module imports under node.
 * - The export lists below are CONTRACT.md's; change both in one commit.
 * - Channel ids appear here and in fixtures only, never in the plugin.
 *
 * Run: node test/funscript-player.test.mjs --unit   (KINETIC_WASM=<path> renders through that build, not bytes.js)
 *      node test/funscript-player.test.mjs [--shot out.png] [--webkit]
 *      node test/funscript-player.test.mjs --live --port P --http P+7
 *      node test/funscript-player.test.mjs --stash-live <file.json>
 *      node test/funscript-player.test.mjs --live-playback --port P --http P+7 [--shots <dir>]
 */
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/index.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { claimAll } from '../src/model/roles.js';
import * as CB from '../../Valence/clients/js/cbor.js';

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
  [P + 'funscript.js']: ['MAX_SPAN_MS', 'MAX_SCRIPT_MS', 'MAX_ACTIONS', 'AXES', 'parseFunscript', 'axisOf', 'pairFiles', 'posAt',
    'indexAfter', 'speedAt', 'peakSpeed', 'thin', 'heat', 'fmtTime'],
  [P + 'clock.js']: ['CLOCK_WINDOW', 'SLEW_MS_PER_S', 'STEP_MS', 'FALLBACK_AFTER_MS', 'WRAP_EARLY_MS', 'createMediaClock', 'frameSource',
    'loopSpec', 'createLoop'],
  [P + 'scheduler.js']: ['STOP_MS', 'PREROLL_MIN_MS', 'PREROLL_STROKE_MS', 'PREROLL_SKIP', 'OFFER_MAX', 'TRANSIENT',
    'HOME_MIN_MS', 'COMP_MAX_MS', 'COMP_STEP_MS', 'LAG_WINDOW', 'LAG_MIN', 'LAG_MATCH_MS', 'EXPECT_MS', 'applyT', 'knotVel', 'strokeSpeed',
    'createScheduler'],
  [P + 'stash.js']: ['SCENES_QUERY', 'SORTS', 'COPY', 'normalizeBase', 'rebase', 'withKey', 'toScene', 'createStash'],
  [P + 'library.js']: ['CSS', 'COPY', 'fitGrid', 'mountLibrary', 'mountConnect'],
  [P + 'ui.js']: ['CSS', 'COPY', 'FULL_UP', 'GLANCE_UP', 'HOVER_IDLE_MS', 'createPlayer', 'createControl', 'compositionOf', 'clampOffset',
    'windowShare', 'ceilingOf', 'localScene', 'extraNote', 'PLAY_CSS', 'mountPlay', 'pageClass'],
  [P + 'timeline.js']: ['ZOOMS', 'HEAT_BINS', 'HEAT_MID_UPS', 'HEAT_TOP_UPS', 'TRACE_MS', 'MIN_SPAN', 'CSS', 'COPY', 'curvePoints', 'dotPath', 'kinPoints',
    'seekAt', 'heatColor', 'heatStops', 'traceLines', 'clampRange', 'zoomStep', 'mountTimeline', 'PINCH_STEP', 'pinchZoom'],
  [P + 'scale.js']: ['RANGES', 'SCALE', 'cleanScale', 'mapOf', 'fitMap', 'wire', 'COPY', 'CSS', 'mountScale'],
  [P + 'prefs.js']: ['PREFS', 'readPrefs', 'writePref'],
  [P + 'analyzer.js']: ['TUNING', 'LIMIT_ROLES', 'LAG_MIN_MS', 'LAG_MAX_MS', 'LAG_STEP_MS', 'LAG_MIN_POINTS', 'LAG_EVERY_MS',
    'KIN_MAX_SAMPLES', 'WIDE_AT', 'WIDE_SPAN', 'COPY', 'CSS', 'tuningGroups', 'lagOf', 'toggled', 'fmtValue', 'wideExtent', 'kinText', 'mountAnalyzer'],
  [P + 'kinetic/kinetic.js']: ['LEAD_MS', 'PREROLL_MS', 'TAIL_MS', 'EVERY', 'FREE', 'TUNING', 'FLAGS', 'ANOMALIES', 'tuningOf',
    'segmentsOf', 'renderCore', 'instantiate', 'versionOf', 'createKinetic'],
  [P + 'index.js']: ['HERO', 'activate'],
  '../src/model/motion.js': ['SEG_FLOOR_MS', 'CLOCK_KEEP', 'CLOCK_HUNT', 'CLOCK_HUNT_GAP_MS', 'CLOCK_DRIFT', 'filteredHubNowUs', 'latchWords', 'streamGate', 'conflictWords',
    'createMotionDoor', 'bundleHead', 'motionStream'],
  '../src/model/actions.js': ['railOwners', 'railOwnerName', 'railOwned'],
  '../src/plugins/host.js': ['MOTION_HOLD_MS', 'isHubUrl', 'createPluginHost', 'validateManifest'],
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
// Ruling R-A (docs/plugins/FUNSCRIPT.md): until the host accepts net.fetch the
// manifest is invalid for that one reason, and the plugin stays out of FACTORY.
const NET_FETCH_PENDING = 'unknown permission "net.fetch"';
const problems = host && host.validateManifest ? host.validateManifest(manifest) : ['no host'];
const RA = !problems.includes(NET_FETCH_PENDING);
ok('manifest validates' + (RA ? '' : ' but for net.fetch (R-A pending)'), problems.filter((p) => p !== NET_FETCH_PENDING).length === 0,
  problems.join('; ') || undefined);
ok('manifest declares motion, net.fetch and intent (the analyzer writes tuning)',
  ['motion', 'net.fetch', 'intent'].every((p) => manifest.permissions.includes(p)));

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
    stash: { base: '', key: '' }, lib: { q: '', sort: 'date', direction: 'DESC' }, view: 'player', zoomMs: 10000, settingsOpen: false, libOpen: true, tlOpen: true, split: 0,
    interp: { scale: 1, scaleAuto: true },
    play: { loop: false, loopCount: 0, home: false, homeAfterMs: 5000, homePoint: 0.5, homeSpeed: 0.33, seekMs: 500, autoLatency: false } };
  {
    const { offsetKey, offsetDrag } = mods[P + 'ui.js'], { pillKey } = mods[P + 'timeline.js'];
    ok('modifiers: an offset key steps 5 ms, Shift the same, Ctrl the adjacent 100 ms multiple',
      offsetKey(0, 1) === 5 && offsetKey(0, 1, { shiftKey: true }) === 5 && offsetKey(0, 1, { ctrlKey: true }) === 100
      && offsetKey(100, 1, { ctrlKey: true }) === 200 && offsetKey(130, -1, { ctrlKey: true }) === 100 && offsetKey(100, -1, { ctrlKey: true }) === 0
      && offsetKey(500, 1) === 500);
    ok('modifiers: the offset drag takes 4 px per 5 ms, Shift a tenth of that, Ctrl rounds to 100',
      offsetDrag(0, 40) === 50 && offsetDrag(0, 40, { shiftKey: true }) === 5 && offsetDrag(0, 90, { ctrlKey: true }) === 100);
    ok('modifiers: a range pill key steps 1 %, Shift the same, Ctrl the adjacent 10 %',
      Math.abs(pillKey(0.5, 1) - 0.51) < 1e-9 && Math.abs(pillKey(0.5, 1, { shiftKey: true }) - 0.51) < 1e-9
      && Math.abs(pillKey(0.5, 1, { ctrlKey: true }) - 0.6) < 1e-9 && Math.abs(pillKey(0.55, -1, { ctrlKey: true }) - 0.5) < 1e-9);
  }
  {
    const { marksOf } = mods[P + 'funscript.js'];
    const ch = marksOf({ metadata: { chapters: [{ startTime: '00:01:00.500' }, { startTime: '00:00:10.000' }, { startTime: 5000 }], bookmarks: [{ time: '00:00:01.000' }] } });
    const bm = marksOf({ metadata: { bookmarks: [{ time: '00:30.250' }, { time: 'x' }, { time: '00:00:02.000' }] } });
    ok('marks: chapters win and sort; clock strings and ms numbers both read', same(ch, [5000, 10000, 60500]), ch);
    ok('marks: bookmarks are the fallback; none reads empty', same(bm, [2000, 30250]) && marksOf({}).length === 0 && marksOf(null).length === 0, bm);
  }
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
  const ip = readPrefs(fakeApi({ interp: { mode: 'makima', tension: 0.5, bias: 1, smoothMs: 120, slewMmS: 500, scale: 0.1, scaleAuto: 'yes' } })).interp;
  ok('interp: a saved curve pref migrates: scale (clamped to 0.25) and scaleAuto (a boolean, else on) kept, the retired fields dropped',
    same(ip, { scale: 0.25, scaleAuto: true }), ip);
  const io = readPrefs(fakeApi({ interp: { mode: 'makima', scaleAuto: false } })).interp;
  ok('interp: a saved Auto off stays off', same(io, { scale: 1, scaleAuto: false }), io);
  const ia = readPrefs(fakeApi({ interp: { mode: 'makima', scale: 0.9, scaleAuto: true } })).interp;
  ok('interp: Scale and Auto read back (phosphor.funscript.interp scale, scaleAuto)', ia.scale === 0.9 && ia.scaleAuto === true, ia);
  ls.set('phosphor.funscript.interp', JSON.stringify({ mode: 'pchip', smoothMs: 40, scale: 0.8, scaleAuto: false }));
  const im = readPrefs(fakeApi()).interp;
  ls.delete('phosphor.funscript.interp');
  ok('interp: a restored backup of the curve pref (mirror only) migrates the same way', same(im, { scale: 0.8, scaleAuto: false }), im);
  let crashed = '';
  for (const v of ['makima', 7, [1, 2], { scale: 'x', scaleAuto: null, map: [-9, 9] }, { scale: NaN }]) {
    try { if (!same(readPrefs(fakeApi({ interp: v })).interp, want.interp)) crashed += JSON.stringify(v) + ' '; } catch (e) { crashed += e.message + ' '; }
  }
  ok('interp: a malformed saved pref never crashes a load and reads the defaults', !crashed, crashed);
  const pl = readPrefs(fakeApi({ play: { lowLatency: true, autoLatency: true } })).play;
  ok('play: a stored lowLatency is dropped, autoLatency kept', !('lowLatency' in pl) && pl.autoLatency === true, pl);
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
// Tuning fixture, test-side ids: the recording (valencesim 0.1.7-p4hub) carries RFC-094 'Tuning / '
// groups, trial_mask (meta.trial_pending) on the kinetic-planner STATE and settings-trial (core 0x16, RFC-099).
const CH_PLANNER = 0x1122, CH_TRIAL = 0x16;
function tuningCatalog() {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
  return { bytes, etag: readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim() };
}
if (index) {
  const h = index.HERO;   // activate itself creates the <video>: the browser half drives it
  ok('one hero, id player, title, absorb false, cells', !!h && h.id === 'player' && h.title === 'Funscript player'
    && h.absorb === false && same(h.cells, { h: [16, 12], v: [8, 16] }));
  ok('spec requires input.target and input.duration', !!h && same(h.spec.require, { target: 'input.target', dur: 'input.duration' }));
  ok('spec binds the eight optional roles', !!h && same(h.spec.optional, { pos: 'telemetry.position', lo: 'window.min', hi: 'window.max',
    vmax: 'limit.input.speed', patRun: 'pattern.running', advRun: 'advgen.running', planEl: 'plan.elapsed', planDur: 'plan.duration' }));
  if (h) {
    const claim = (entries) => claimAll(buildSettingsModel(entries).byRole, [{ id: 'p', spec: h.spec, absorb: false }]);
    const w = claim(ENTRIES).widgets[0];
    ok('claims on the valencesim fixture, dur on the segments STREAM', !!w && w.fields.dur.channelId === SEG_CH);
    ok('every optional role binds there', !!w && ['pos', 'lo', 'hi', 'vmax', 'patRun', 'advRun', 'planEl', 'planDur'].every((k) => w.fields[k]));
    ok('absorb false claims nothing away', claim(ENTRIES).claimed.size === 0);
    ok('declines without a segments STREAM (D1)', claim(ENTRIES.filter((e) => e.id !== SEG_CH)).widgets.length === 0);
  }
}
{
  let factory = null;
  try { factory = await import('../src/plugins/factory.js'); } catch (e) { ok('factory.js imports', false, e.message); }
  const f = factory && factory.FACTORY.find((x) => x.manifest.name === 'funscript-player');
  if (RA) ok('listed in FACTORY with its manifest', !!f && same(f.manifest, manifest) && f.module.activate === (index && index.activate));
  else ok('not in FACTORY while net.fetch is refused (test (g) validates every entry)', !f);
}

// ---- (c2) the analyzer: Tuning groups by catalog and role, lagOf ----------------
console.log('(c2) analyzer');
const an = mods[P + 'analyzer.js'];
if (an) {
  const tg = an.tuningGroups(buildSettingsModel(decodeCatalog(tuningCatalog().bytes)));
  const names = tg.map((g) => g.name);
  const TUNED = ['Motion behavior', 'Streaming', 'Sample streams', 'Curve', 'Ceilings', 'Re-planning'];
  ok('every Tuning section with a control, then the kinetic channel\'s ceilings, then limit.input.*',
    same([...names].sort(), [...TUNED, 'Ceiling overrides', 'Machine-driven limits'].sort())
      && names.indexOf('Ceiling overrides') > Math.max(...TUNED.map((n) => names.indexOf(n))), names);
  const fs = tg.flatMap((g) => g.fields);
  ok('only writable controls, no readout', fs.length >= 14 && fs.every((f) => !f.readOnly && f.writeChannel != null
    && ['slider', 'stepper', 'toggle', 'segmented', 'select'].includes(f.widget)), fs.length);
  ok('limit.input.* by role, nothing else from its group',
    same(tg.find((g) => g.name === 'Machine-driven limits').fields.map((f) => f.role).sort(), [...an.LIMIT_ROLES].sort()));
  const untuned = buildSettingsModel(ENTRIES);
  for (const c of untuned.categories) for (const g of c.groups) g.name = String(g.name || '').replace(/^Tuning \/ /, '');
  ok('a catalog without Tuning groups offers limit.input.* only',
    same(an.tuningGroups(untuned).map((g) => g.name), ['Machine-driven limits']));
  ok('analyzer.js names no channel id', !/0x[0-9a-f]{3,}/i.test(readFileSync(new URL(P + 'analyzer.js', import.meta.url), 'utf8')));
  const { parseFunscript, posAt } = mods[P + 'funscript.js'];
  const { applyT } = mods[P + 'scheduler.js'];
  const acts = [];
  for (let at = 0, k = 0; at <= 10000; at += 300 + (k * 53) % 200, k++) acts.push({ at, pos: k % 2 ? 90 : 10 });
  const sc = parseFunscript({ actions: acts });
  const T = { offsetMs: 0, lo: 0.1, hi: 0.9, invert: false };
  const tr = [];
  for (let m = 2000; m <= 9000; m += 16) tr.push({ m, u: applyT(posAt(sc, m - 42), T), p: applyT(posAt(sc, m - 14), T), stale: false });
  ok('lagOf finds a 42 ms measured lag and a 14 ms plan lag within a step',
    Math.abs(an.lagOf(tr, sc, T, 'u') - 42) <= an.LAG_STEP_MS && Math.abs(an.lagOf(tr, sc, T, 'p') - 14) <= an.LAG_STEP_MS,
    [an.lagOf(tr, sc, T, 'u'), an.lagOf(tr, sc, T, 'p')]);
  ok('lagOf declines a flat trace, a short one and stale points',
    an.lagOf(tr.map((x) => ({ ...x, u: 0.5 })), sc, T) === null && an.lagOf(tr.slice(0, 10), sc, T) === null
      && an.lagOf(tr.map((x) => ({ ...x, stale: true })), sc, T) === null);
  const kn = mods[P + 'kinetic/kinetic.js'];
  if (kn) {
    const tuned = kn.tuningOf(fs.map((f) => [f, f.name.endsWith('_ms') ? 20 : 1]));
    ok('Kinetic: the Tuning rows bind kinetic_tuning by member name, an _ms row to its _us member times 1000',
      same(tuned.map((t) => t[0]).sort(), ['amax_ovr', 'chase_dense_us', 'handle_floor', 'jmax_ovr', 'react_us', 'smoothness', 'trim_max', 'vmax_ovr'])
        && tuned.find((t) => t[0] === 'react_us')[3] === 20000, tuned.map((t) => t[0]));
    const Tk = { offsetMs: 30, lo: 0.2, hi: 0.8, invert: true }, T0k = { offsetMs: 0, lo: 0, hi: 1, invert: false };
    const sg = kn.segmentsOf(sc, Tk);
    ok('Kinetic: a preroll to the first knot arriving at media 0, then one segment per span at its start, after T',
      sg.segs.length === sc.at.length && sg.segs[0][0] === 2 * kn.LEAD_MS && sg.segs[0][2] === kn.PREROLL_MS
        && sg.segs[1][0] === 2 * kn.LEAD_MS + kn.PREROLL_MS && sg.segs[1][1] === Math.round(applyT(sc.pos[1], Tk) * 1e4)
        && sg.t0 === 30 - 2 * kn.LEAD_MS - kn.PREROLL_MS && sg.steps === Math.ceil(2 * kn.LEAD_MS + kn.PREROLL_MS + sc.durationMs + kn.TAIL_MS),
      sg.segs.slice(0, 2));
    const k = await kn.instantiate(process.env.KINETIC_WASM ? readFileSync(process.env.KINETIC_WASM).toString('base64') : undefined);
    const it = kn.renderCore(k, { limits: { vmax: 1000, amax: 50000, jmax: 2e6, rail: 500 }, window: [100, 400], tuning: [], ...sg, every: 5 });
    let r;
    do r = it.next(); while (!r.done);
    const at = (ms) => r.value.pos[Math.round((ms - sg.t0) / 5)];
    const want = (ms) => 100 + 300 * applyT(posAt(sc, ms - 30), Tk);
    ok('Kinetic: the render lands on every knot of a feasible script within 1 mm on the media axis, the first after the preroll',
      sc.at.every((t) => Math.abs(at(t + 30) - want(t + 30)) < 1) && r.value.accepted === sg.segs.length, [kn.versionOf(k), at(5030), want(5030)]);
    // The preview submits the wire as the host does: every knot free, the rests the sender sees at 0, the hub's expectation on.
    const mono = parseFunscript({ actions: [0, 20, 40, 60, 80, 20].map((pos, i) => ({ at: i * 500, pos })) });
    const ms = kn.segmentsOf(mono, T0k);
    ok('Kinetic: same-direction knots free (segment_end_vel_unspecified), the reversal and the last a rest, the preroll at rest',
      same(ms.segs.map((x) => x[3]), [0, kn.FREE, kn.FREE, kn.FREE, 0, 0]) && kn.FREE === -32768, ms.segs.map((x) => x[3]));
    const LIM = { vmax: 1200, amax: 100000, jmax: 2e7, rail: 500 };
    const run = (sg2, expectMs, segs = sg2.segs) => {
      const it2 = kn.renderCore(k, { limits: LIM, window: [100, 400], tuning: [], ...sg2, segs, every: 1, expectMs });
      let q;
      do q = it2.next(); while (!q.done);
      return q.value;
    };
    // A staircase 20..80 by 15 and back, 400..500 ms spans, 3 laps: each same-direction knot's speed over its chords' mean.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, stair = [];
    let t = 0;
    for (let lap = 0; lap < 3; lap++) for (const pos of [20, 35, 50, 65, 80, 65, 50, 35]) { stair.push({ at: t, pos }); t += 400 + Math.round(rnd() * 100); }
    stair.push({ at: t, pos: 20 });
    const st = parseFunscript({ actions: stair }), ss = kn.segmentsOf(st, T0k);
    const shares = (v) => {
      const out = [];
      for (let j = 1; j < st.at.length - 1; j++) {
        const a = (st.pos[j] - st.pos[j - 1]) / (st.at[j] - st.at[j - 1]), b = (st.pos[j + 1] - st.pos[j]) / (st.at[j + 1] - st.at[j]);
        if (a * b > 0) out.push(Math.abs(v.vel[Math.round(st.at[j] - ss.t0)]) / (300e3 * (Math.abs(a) + Math.abs(b)) / 2));
      }
      return { mean: out.reduce((x, y) => x + y) / out.length, least: Math.min(...out), n: out.length };
    };
    const on = shares(run(ss, mods[P + 'scheduler.js'].EXPECT_MS)), off = shares(run(ss, 0));
    ok('Kinetic: all free, the expectation passes same-direction knots near the chord speed (mean >= 0.95, least >= 0.8); without it they dip',
      on.mean >= 0.95 && on.least >= 0.8 && off.mean < 0.7, JSON.stringify({ on, off }));
    // A fast same-direction run to the end, and the same run into a 1.5 s successor: both knots are rests the sender declares.
    const endS = parseFunscript({ actions: [[0, 20], [200, 50], [400, 80], [1900, 85], [2100, 20]].map(([at, pos]) => ({ at, pos })) });
    const lastS = parseFunscript({ actions: [[0, 20], [200, 50], [400, 80]].map(([at, pos]) => ({ at, pos })) });
    const knot = 100 + 300 * 0.8, past = (sg2, v, to) => {
      let m = -Infinity;
      for (let i = Math.round(400 - sg2.t0); i < Math.round(to - sg2.t0); i++) m = Math.max(m, v.pos[i] - knot);
      return m;
    };
    const ls = kn.segmentsOf(lastS, T0k), gs = kn.segmentsOf(endS, T0k);
    const lv = run(ls, 500), lf = run(ls, 500, ls.segs.map((x, i) => (i ? [x[0], x[1], x[2], kn.FREE] : x))), gv = run(gs, 500);
    const endOver = past(ls, lv, ls.steps + ls.t0), freeOver = past(ls, lf, ls.steps + ls.t0), gapV = Math.abs(gv.vel[Math.round(400 - gs.t0)]);
    ok('Kinetic: the script end rests on its last action (left free, the expectation passes it moving and brakes beyond)',
      endOver < 0.5 && freeOver > 1, JSON.stringify({ endOver: +endOver.toFixed(3), freeOver: +freeOver.toFixed(3) }));
    ok('Kinetic: a knot before a successor over EXPECT_MS away is reached at rest on its action',
      gs.segs[2][3] === 0 && gapV < 1 && Math.abs(gv.pos[Math.round(400 - gs.t0)] - knot) < 0.5, gapV.toFixed(2) + ' mm/s');
    ok('Kinetic: the readout counts the wasm flags and anomalies', an.kinText('wasm', { anomalies: [0, 2, 1], counts: [0, 1500, 250, 0] })
      === 'Kinetic: wasm  3 anomalies  clamped 250 ms  shaped 1.5 s' && an.kinText('fallback', null) === 'Kinetic: fallback'
      && an.kinText('wasm', { error: 'window refused' }) === 'Kinetic: wasm  window refused');
    // Wide shares 0.5, 0.8, 0.225 are window shares 0.5, 1.1, -0.05; the fourth sample lies past the span.
    const wr = Float32Array.from([0.5, 0.8, 0.225, 0.95]);
    const near2 = (e, w) => e.every((x, i) => Math.abs(x - w[i]) < 1e-6);
    ok('Auto: the wall-free measure reads back [min, max] through WIDE_*, the Range and invert, over the script span only',
      near2(an.wideExtent(wr, 0, 5, 0, 10, { lo: 0, hi: 1 }), [-0.05, 1.1]) && near2(an.wideExtent(wr, 0, 5, 0, 10, { lo: 0.2, hi: 0.8 }), [-0.4166667, 1.5])
      && near2(an.wideExtent(wr, 0, 5, 0, 10, { lo: 0, hi: 1, invert: true }), [-0.1, 1.05]));
  }
}

if (UNIT || fails) {
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
}

// =============================================================================
// Browser half: the shell bundle (shell-build.mjs, stub Tauri runtime) with
// the factory plugin, against a fake hub on the valencesim fixture catalog
// (CLOCK answered, PUBLISH granted at latency 1000 us, STREAM bundles decoded)
// and the fake Stash; the clip is generated at run time by ffmpeg.
//   claim      the card renders on the fixture, and nowhere without a
//              segments STREAM
//   idle       nothing is sent before Play
//   preroll    one positioning segment, the video starts at its end
//   timing     every start lies within half the horizon (250, 1000) of its arrival;
//              starts tile; each segment once; the host lands each start on
//              the instant the player asked for; the knots land on the
//              frames they belong to
//   seek       the first segment after a seek starts at now
//   offset     +50 moves every start 50 ms later
//   rate       1.5 divides every duration
//   pause      one hold, then silence
//   latch      a pushed PAUSE pauses the video within 100 ms with the latch
//              words, nothing is sent after; clearing it plays nothing
//   gates      advgen.running grays Play; a second plugin reads the busy words
//   layout     identical rects across states; 40 px targets under a coarse
//              pointer; no control outside the card, no cut label; nothing
//              wears --bad; copy within docs/COPY.md; glance at 220 px
//   stash      the connect card, tiles keyed with apikey, a pick fetching the
//              script with the ApiKey header and playing
//   settings   the page's Settings mounts the plugin settings card without
//              moving the card; a change there reads back in the Plugins
//              pane and the reverse; open/closed persists ([--shots <dir>])
//   hover      the bar over the video shows on a move and hides on idle and
//              leave; its play, pause, seek and the keys act only through
//              the controller; volume and mute persist; media fullscreen is
//              page fullscreen bare with the stage alone, Escape returns; the
//              analyzer column at 1280 and 1920 ([--shots <dir>])
// Stash live (--stash-live <file.json>, a local {base, apiKey}, never
// committed): only the stash section, against that real Stash, read-only,
// under the shell CSP's img-src and media-src: every tile's screenshot
// loads, and a picked scene's stream plays and drives the fake hub.
// Live (--live): valencesim on spare ports plays 8 s: bundles, no NACK, the
// plan strip moving, the strip's Pause pauses the video and Resume leaves it
// paused, a seek plays on from the new time, an Advanced start grays Play,
// and last the strip's E-stop pauses it with nothing sent after (the spare
// sim stays latched).
//
// The fake hub's clock is epoch microseconds (node's timeOrigin + now), so a
// segment's execution start reads directly in the page's epoch ms
// (performance.timeOrigin + now): both count the same wall clock.
// =============================================================================
const { chromium, webkit } = await import('playwright');
const { createServer } = await import('node:http');
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { cbMap, cbUint, cbF32, cbBstr, cbTstr, cbArray, cbDecodeFull } = await import('../../Valence/clients/js/cbor.js');
const { decodePacked, encodePacked } = await import('../../Valence/clients/js/catalog.js');
const { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS, NACK, NACK_NAME } = await import('../../Valence/clients/js/frames.js');
const { CORE_CHANNEL } = await import('../../Valence/clients/js/generated/registry_vocab.js');
const { toHex } = await import('../../Valence/clients/js/sha256.js');
const { buildShellPage, TAURI_STUB } = await import('./shell-build.mjs');
const { goTab } = await import('./nav.mjs');
const { advgenCatalog } = await import('./fixtures/advgen-roles-catalog.mjs');
const { startFakeStash } = await import('./fixtures/fake-stash.mjs');

const PB = args.includes('--live-playback');
const LIVE = args.includes('--live') || PB;
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const SHOT = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
const SIM_PORT = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 8882;
const SIM_HTTP = args.includes('--http') ? parseInt(args[args.indexOf('--http') + 1], 10) : SIM_PORT + 7;
const STASH_LIVE = args.includes('--stash-live') ? JSON.parse(readFileSync(args[args.indexOf('--stash-live') + 1], 'utf8')) : null;
// The shell's media directives (tauri.conf.json), served with the page under --stash-live.
const CSP_MEDIA = STASH_LIVE && JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
  .app.security.csp.split(';').map((d) => d.trim()).filter((d) => /^(img|media)-src /.test(d)).join('; ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const PAUSE_BIT = 0x08;   // registry: safety word bit3
const LAT_US = 1000;      // the fake grant's schedule_latency_us (valencesim, measured)
const HORIZON_MS = 250;
const KEY = 'test-key-1';
// Fixture channel ids, test-side only (registry.yaml / valencesim catalog).
const CH = { config: 0x1000, motion: 0x1100, advgen: 0x1210, segments: 0x2101 };
// The limits and rail the analyzer's Kinetic render needs (the tuning fixture declares no defaults).
const KIN_VALUES = { [CH.config + ':max_rail']: 500, '12288:input_speed': 1000, '12288:input_accel': 50000, '12288:input_jerk': 2000000 };

// ---- generated media: a 30 fps VP8 clip with a tone, never committed ---------
const TMP = mkdtempSync(join(tmpdir(), 'fsp-'));
const CLIP_S = PB ? 60 : 30;
let VIDEO = null, VIDEO_TALL = null;
try {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=' + CLIP_S,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + CLIP_S, '-c:v', 'libvpx', '-b:v', '200k', '-g', '15',
    '-c:a', 'libopus', '-shortest', join(TMP, 'clip.webm')], { windowsHide: true, stdio: 'pipe' });
  VIDEO = readFileSync(join(TMP, 'clip.webm'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=30:duration=3', '-c:v', 'libvpx', '-b:v', '100k',
    join(TMP, 'tall.webm')], { windowsHide: true, stdio: 'pipe' });
  VIDEO_TALL = readFileSync(join(TMP, 'tall.webm'));
} catch (e) {
  ok('ffmpeg on PATH generates the test clip', false, String(e.message).split('\n')[0]);
  process.exit(1);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

// The script: each span a distinct length (300..597 ms) between alternating
// ends, so a captured segment names its knot by its duration alone.
const ACTIONS = [];
// --live-playback: 400..697 ms spans over a staircase 20..80 and back in steps of 15 (inside the sim's speed limit,
// so plans keep their durations; a reversal only at either end) and a gap from the last action at or before 20 s
// to 34 s that plays as one span (home is a pause behavior).
const PB_POS = [20, 35, 50, 65, 80, 65, 50, 35];
if (PB) for (let at = 0, k = 0; at <= 59000; k++) { if (at > 20000 && at < 34000) at = 34000; ACTIONS.push({ at, pos: PB_POS[k % PB_POS.length] }); at += 400 + ((k * 37) % 298); }
else for (let at = 0, k = 0; at <= CLIP_S * 1000 - 600; k++) { ACTIONS.push({ at, pos: k % 2 ? 85 : 15 }); at += 300 + ((k * 37) % 298); }
const SCRIPT = { version: '1.0', inverted: false, range: 100, actions: ACTIONS };
// A real-shaped script for the heat and Scale (v): slow full strokes, flicks at the top (Makima overshoots there),
// a hold, a buzz, medium strokes, fast strokes. [until ms, span ms, positions cycled].
const REAL_ACTIONS = [];
for (let at = 0, k = 0, s = 0, SECS = [[6000, 900, [0, 100]], [10000, 260, [0, 100, 70, 100]], [12000, 1000, [50]], [15000, 110, [40, 62]],
  [21000, 420, [0, 100, 30, 100]], [25000, 190, [10, 95]], [29400, 700, [20, 80]]]; s < SECS.length; s++) {
  const [until, span, cyc] = SECS[s];
  for (let j = 0; at < until; j++, k++, at += span + ((k * 37) % Math.max(1, span >> 2))) REAL_ACTIONS.push({ at: Math.round(at), pos: cyc[j % cyc.length] });
}
const REAL_SCRIPT = { version: '1.0', inverted: false, range: 100, actions: REAL_ACTIONS };
/** The knot k whose span (k-1 -> k) lasts durMs at this rate, or -1. */
function knotOf(durMs, rate = 1) {
  let best = -1, err = Infinity;
  for (let k = 1; k < ACTIONS.length; k++) {
    const e = Math.abs((ACTIONS[k].at - ACTIONS[k - 1].at) / rate - durMs);
    if (e < err) { err = e; best = k; }
  }
  return err <= 1 ? best : -1;
}

// ---- the fake hub -----------------------------------------------------------
const hubUs = () => Math.round((performance.timeOrigin + performance.now()) * 1000);
/** The full value nearest `near` whose low 32 bits are u32. */
const unwrap = (u32, near) => near + ((u32 - (near >>> 0)) | 0);

function makeHub(cat, { horizonMs = HORIZON_MS } = {}) {
  const hub = { bundles: [], publishes: [], values: {}, latch: 0, socket: null, roles: 2, timer: null, nackStream: 0 };
  const entry = (id) => cat.entries.find((e) => e.id === id);
  hub.intents = [];
  const valuesOf = (e) => Object.fromEntries(e.layout.map((f) => [f.name,
    hub.values[e.id + ':' + f.name] ?? (f.role === 'meta.enabled_mask' ? 0xff : Number(f.default) || 0)]));
  hub.send = (type, ch, payload, seq = 0) => { try { hub.socket.send(Buffer.from(encodeFrame(type, ch, payload, seq))); } catch (e) { /* closed */ } };
  hub.state = (id) => {
    if (!hub.socket) return;
    if (id === CORE_CHANNEL.safety) { hub.send(FRAME.STATE, id, Uint8Array.of(hub.latch, 0, 0, 0, 0, 0, 0, 0, 0)); return; }
    const e = entry(id);
    if (!e || !e.layout || e.dirName === 'c2h') return;
    let bytes;
    try { bytes = encodePacked(valuesOf(e), e.layout); } catch (x) { return; }   // a string layout: never pushed here
    hub.send(FRAME.STATE, id, bytes);
  };
  hub.set = (id, name, v) => { hub.values[id + ':' + name] = v; hub.state(id); };
  hub.setLatch = (w) => { hub.latch = w; hub.state(CORE_CHANNEL.safety); };
  hub.route = (ws) => {
    hub.socket = ws;
    clearInterval(hub.timer);
    hub.timer = setInterval(() => hub.state(CH.motion), 50);   // keeps telemetry.position fresh (law 8)
    ws.onMessage((msg) => {
      if (typeof msg === 'string') return;
      for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
        const t = header.type;
        if (t === FRAME.HELLO) {
          hub.send(FRAME.WELCOME, 0, cbMap([
            [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
            [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(cat.etag, 'hex')))], [K.cfg_gen, cbUint(1)],
            [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
              [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
            [K.roles, cbUint(hub.roles)], [K.deadman_ms, cbUint(600000)],
            [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
              [IDENTITY_K.hub_name, cbTstr('FSP fixture')]])],
          ]));
        } else if (t === FRAME.SUBSCRIBE) {
          const grants = [];
          for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
            const ch = w.get(K.channel_id);
            grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
              [K.channel_id, cbUint(ch)]]));
            hub.state(ch);
          }
          hub.send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
        } else if (t === FRAME.CLOCK) {
          const now = hubUs() >>> 0;
          const out = new Uint8Array(12);
          const dv = new DataView(out.buffer);
          dv.setUint32(0, new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, true), true);
          dv.setUint32(4, now, true);
          dv.setUint32(8, now, true);
          hub.send(FRAME.CLOCK, 0, out);
        } else if (t === FRAME.PUBLISH) {
          const pubs = [];
          for (const w of cbDecodeFull(payload).get(K.publishes) || []) {
            const ch = w.get(K.channel_id);
            hub.publishes.push({ ch, rate: w.get(K.rate_hz) });
            const pairs = [[K.granted_rate_hz, cbF32(Math.min(w.get(K.rate_hz), 50))], [K.channel_id, cbUint(ch)],
              [K.schedule_latency_us, cbUint(LAT_US)]];
            if (ch === CH.segments) pairs.push([K.schedule_horizon_ms, cbUint(horizonMs)]);
            pubs.push(cbMap(pairs));
          }
          hub.send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray([])], [K.granted_publishes, cbArray(pubs)]]));
        } else if (t === FRAME.STREAM) {
          const arrival = hubUs();
          const e = entry(header.channel);
          const dv = new DataView(payload.buffer, payload.byteOffset, payload.length);
          const n = dv.getUint8(4);
          const base = unwrap(dv.getUint32(0, true), arrival);
          const size = (payload.length - 6 - 2 * n) / n;
          const tgt = e.layout.find((f) => f.role === 'input.target'), dur = e.layout.find((f) => f.role === 'input.duration');
          const segs = [];
          for (let i = 0; i < n; i++) {
            const stamp = base + dv.getUint16(6 + 2 * i, true) * LIMITS.segment_t_off_unit_us;
            const r = decodePacked(payload.subarray(6 + 2 * n + size * i, 6 + 2 * n + size * (i + 1)), e.layout);
            segs.push({ exec: stamp + LAT_US, norm: r[tgt.name], dur: r[dur.name], arrival });
          }
          hub.bundles.push({ ch: header.channel, arrival, segs, latch: hub.latch });
          if (hub.nackStream) hub.send(FRAME.NACK, header.channel, cbMap([[K.code, cbUint(hub.nackStream)]]), header.seq);
        } else if (t === FRAME.INTENT) {
          const q = cbDecodeFull(payload);
          const ch = q.get(K.channel_id), val = q.get(K.value) || new Map(), trial = q.get(K.trial) === true;
          hub.intents.push({ ch, value: Object.fromEntries(val), trial });
          const st = cat.entries.find((e) => e.settingChannel === ch && e.layout);
          if (st) for (const [k, v] of val) { const f = st.layout.find((x) => x.settingKey === k); if (f) hub.values[st.id + ':' + f.name] = v; }
          if (ch === CH_TRIAL) hub.values[CH_PLANNER + ':trial_mask'] = 0;
          else if (trial) hub.values[CH_PLANNER + ':trial_mask'] = 1;
          const enc = (v) => (typeof v === 'boolean' ? CB.cbBool(v) : Number.isInteger(v) ? (v < 0 ? CB.cbInt(v) : cbUint(v)) : cbF32(v));
          hub.send(FRAME.ECHO, ch, cbMap([[K.intent_id, cbUint(q.get(K.intent_id))],
            [K.applied, cbMap([...val].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, enc(v)]))]].sort((a, b) => a[0] - b[0])), header.seq);
          if (st) hub.state(st.id);
          if (entry(CH_PLANNER)) hub.state(CH_PLANNER);
        } else if (t === FRAME.PING) {
          hub.send(FRAME.PONG, header.channel, payload);
        }
      }
    });
  };
  /** Every segment of the bundles since index i0, flat. */
  hub.segs = (i0 = 0) => hub.bundles.slice(i0).flatMap((b) => b.segs);
  return hub;
}

// ---- the page ---------------------------------------------------------------
const SHELL = await buildShellPage();
const srv = createServer((q, s) => {
  if (LIVE && q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + SIM_HTTP + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html', ...(CSP_MEDIA ? { 'Content-Security-Policy': CSP_MEDIA } : {}) }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port;
const browser = await (args.includes('--webkit') ? webkit : chromium).launch();

// The shell's @tauri-apps/plugin-http commands, served by node's fetch (no
// CORS, as in the shell). plugins_list hands over BUSY_PROBE when asked.
function SHELL_STUB(probe) {
  const base = window.__TAURI_INTERNALS__.invoke;
  const held = new Map();
  let n = 0;
  window.__TAURI_INTERNALS__.invoke = async (cmd, a) => {
    if (cmd === 'plugins_list' && probe) return { dir: 'test', plugins: [probe] };
    if (cmd === 'plugin:http|fetch') { held.set(++n, { cfg: a.clientConfig }); return n; }
    if (cmd === 'plugin:http|fetch_send') {
      const h = held.get(a.rid);
      const r = await window.__nodeFetch(h.cfg.url, h.cfg.method, h.cfg.headers, h.cfg.data);
      h.body = r.body;
      return { status: r.status, statusText: r.statusText, url: h.cfg.url, headers: r.headers, rid: a.rid };
    }
    if (cmd === 'plugin:http|fetch_read_body') {
      const h = held.get(a.rid);
      if (h.body) { const b = h.body; h.body = null; return [...b, 0]; }
      return [1];
    }
    if (cmd.startsWith('plugin:http|')) return null;
    return base(cmd, a);
  };
}
async function nodeFetch(url, method, headers, data) {
  const r = await fetch(url, { method, headers: headers || [], body: data ? Buffer.from(data) : undefined });
  return { status: r.status, statusText: r.statusText, headers: [...r.headers], body: [...new Uint8Array(await r.arrayBuffer())] };
}

// A second motion plugin: its card shows its own gate on the segments field;
// once window.__probeSubmit is set it submits too, window.__busy its answer.
const BUSY_PROBE = {
  dir: 'busy-probe', path: 'test/busy-probe',
  manifest: { name: 'busy-probe', version: '0', api: 1, kind: 'widget', entry: 'index.js', permissions: ['motion'] },
  source: `export function activate(api) {
    api.registerHero({ id: 'p', title: 'Busy probe', absorb: false, spec: { require: { dur: 'input.duration' } },
      mount(el, f) {
        const o = document.createElement('output'); o.id = 'busy-probe'; el.append(o);
        const t = setInterval(() => {
          o.textContent = api.gate(f.dur);
          if (window.__probeSubmit) window.__busy = api.submitSegments([{ atMs: performance.now() + 50, norm: 0.5, durationMs: 100 }]);
        }, 100);
        return { update() {}, unmount() { clearInterval(t); } };
      } });
  }`,
};

async function open({ cat = advgenCatalog(), hub = null, coarse = false, width = 1440, height = 1000, probe = null, prefs = {}, onPage = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: coarse });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(SHELL_STUB, probe);
  await ctx.exposeFunction('__nodeFetch', nodeFetch);
  await ctx.addInitScript(([etag, bytes, live, port, prefs]) => {
    try {
      if (sessionStorage.getItem('fsp.seeded')) return;
      sessionStorage.setItem('fsp.seeded', '1');
      localStorage.setItem('phosphor.funscript.probe', '1');
      if (live) localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      else { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); localStorage.setItem('shell_host', '127.0.0.1'); }
      for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* none */ }
  }, [cat.etag, toHex(cat.bytes), LIVE, SIM_PORT, prefs]);
  if (hub) await ctx.routeWebSocket(/:82\//, hub.route);
  const page = await ctx.newPage();
  if (onPage) onPage(page);
  const errors = [];
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) errors.push(String(e)); });
  await page.goto(PAGE + '/');
  const up = await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  return { ctx, page, up, errors };
}

/**
 * Opens the Funscript page: the tab exists before the plugin's page registers its mount, so a click that lands
 * early opens nothing; it clicks again until the page's card is there.
 */
async function toPluginPage(page) {
  const TAB = '[data-tab-id="plugin:funscript-player:player"]';
  await page.waitForSelector(TAB, { state: 'attached', timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await goTab(page, 'plugin:funscript-player:player').catch(() => {});
    if (await page.waitForSelector('main.pane .fsp-page .fsp', { timeout: 4000 }).then(() => true, () => false)) return true;
  }
  return false;
}
/** Finds the card: home first, then each category page. */
// The cell's height follows its content now, so the card rect comparisons below hold the width only.
// The Funscript page's card is the full one; a dash hero cell is half the pane and re-composes as its box moves.
const wide = async (page, sel) => {
  const TAB = '[data-tab-id="plugin:funscript-player:player"]';
  if (!await page.evaluate((s) => { const t = document.querySelector(s); if (t) t.click(); return !!t; }, TAB)) return true;
  await page.waitForSelector('main.pane .fsp-page', { timeout: 3000 }).catch(() => {});
  return page.locator(sel).first().isVisible().catch(() => false);
};
async function toCard(page, sel = 'main.pane .fsp', full = false) {
  for (let pass = 0; pass < 6; pass++) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return full ? wide(page, sel) : true;
    for (const id of await page.$$eval('[role=tab][data-tab-id]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
      await page.click('[data-tab-id="' + id + '"]').catch(() => {});
      await page.waitForTimeout(150);
      if (await page.locator(sel).first().isVisible().catch(() => false)) return full ? wide(page, sel) : true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

const C = 'main.pane .fsp';
const statusText = (page) => page.locator(C + ' > .fsp-slot').textContent().then((t) => t.trim());
// Play is the hover bar's (the strip shows its own only at glance and beside the handheld analyzer).
const playBtn = (page) => {
  const l = page.locator(C + ' .fsp-play');
  return { click: () => l.evaluate((e) => e.click()), isDisabled: () => l.isDisabled(),
    textContent: () => l.getAttribute('aria-label').then((t) => t.replace(/ \(k\)$/, '')) };
};
async function loadClip(page, script = SCRIPT) {
  await page.setInputFiles(C + ' .fsp-filev', [
    { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO },
    { name: 'clip.funscript', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(script)) },
  ]);
  return page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 5000 }).then(() => true).catch(() => false);
}
const video = (page, fn) => page.locator(C + ' .fsp-stage video').evaluate(fn);
/**
 * Page epoch minus node epoch, ms: the two processes' timeOrigins disagree by
 * a few ms. The tightest of 20 bracketed reads.
 */
async function epochSkew(page) {
  let best = null;
  for (let i = 0; i < 20; i++) {
    const a = performance.timeOrigin + performance.now();
    const p = await page.evaluate(() => performance.timeOrigin + performance.now());
    const b = performance.timeOrigin + performance.now();
    if (!best || b - a < best.rtt) best = { rtt: b - a, skew: p - (a + b) / 2 };
  }
  return best.skew;
}
/** The probe's segments and clock observations, their instants in node epoch ms. */
const probeSegs = (page, skew) => page.evaluate((k) => (window.__funscriptProbe || []).filter((x) => x.k === 'seg')
  .flatMap((x) => x.list.map((s) => ({ ...s, at: performance.timeOrigin + s.atMs - k }))), skew);
const probeObs = (page, skew) => page.evaluate((k) => (window.__funscriptProbe || []).filter((x) => x.k === 'obs')
  .map((x) => ({ m: x.m, d: performance.timeOrigin + x.d - k })), skew);
/** The hub's schedule: each bundle supersedes what it held from its first start on (RFC-087 item 5). */
function schedule(bundles) {
  let out = [];
  for (const b of bundles) out = [...out.filter((s) => s.exec < b.segs[0].exec), ...b.segs.map((s, i) => ({ ...s, first: i === 0 }))];
  return out;
}
/**
 * A start clipped to now by the host (its duration is no longer its span's):
 * it leads its arrival by the latency alone, net of the page's hub clock
 * error once measured.
 */
let clockErrUs = 0;
const clipped = (s) => s.exec - s.arrival - clockErrUs <= LAT_US + 25000;   // CLOCK re-syncs move the error by a few ms

// PR5: the bar's order. Desktop one row; phones the scrub row over the buttons. A class the bar does not show is skipped.
const BAR_DESK = ['fsp-prev', 'fsp-play', 'fsp-next', 'fsp-el', 'fsp-ov', 'fsp-rem', 'fsp-vol', 'fsp-motion', 'fsp-rate', 'fsp-full', 'fsp-set'];
const BAR_PHONE = [['fsp-el', 'fsp-ov', 'fsp-rem'], ['fsp-prev', 'fsp-play', 'fsp-next', 'fsp-motion', 'fsp-rate', 'fsp-full', 'fsp-rail', 'fsp-set']];
/** The bar's shown items by row (top to bottom, left to right), their names the BAR_ classes. */
const barOrder = (page) => page.locator(C).evaluate((root, names) => {
  const kids = [...root.querySelector('.fsp-tr').children].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height > 0)
    .map((e) => ({ n: names.find((c) => e.classList.contains(c)) || e.className, r: e.getBoundingClientRect() }));
  const rows = [];
  for (const k of kids.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)) {
    const row = rows.find((x) => Math.abs(x.y - (k.r.top + k.r.bottom) / 2) < 6);
    if (row) row.k.push(k); else rows.push({ y: (k.r.top + k.r.bottom) / 2, k: [k] });
  }
  const small = kids.filter((k) => /fsp-(prev|play|next|motion|rate|full|rail|set)/.test(k.n) && (k.r.width < 39.5 || k.r.height < 39.5)).map((k) => k.n);
  return { comp: root.dataset.comp, cls: root.dataset.cls || '', rows: rows.map((x) => x.k.sort((a, b) => a.r.left - b.r.left).map((k) => k.n)), small };
}, [...new Set([...BAR_DESK, ...BAR_PHONE.flat()])]);

/** Rects of the card's fixed chrome: every row and every child of a row. */
const chrome = (page) => page.evaluate((c) => {
  const root = document.querySelector(c);
  const o = root.getBoundingClientRect();
  const out = {};
  for (const sel of [':scope > :not(style)', '.fsp-tr > *', '.fsp-src > *', '.fsp-tlbox > *', '.fsp-zoom > *']) {
    root.querySelectorAll(sel).forEach((e, i) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return;
      out[sel + ' ' + (e.className || e.tagName) + '#' + i] = [r.x - o.x, r.y - o.y, r.width, r.height].map((v) => Math.round(v * 2) / 2);
    });
  }
  return out;
}, C);
function sameChrome(a, b) {
  const diff = Object.keys(a).filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return { ok: diff.length === 0 && Object.keys(a).length > 4, diff: diff.map((k) => k + ' ' + a[k] + ' -> ' + b[k]) };
}

/** Controls that leave the card's box, and labels cut inside their own box. */
const spill = (page) => page.evaluate((c) => {
  const root = document.querySelector(c), o = root.getBoundingClientRect();
  const shown = [...root.querySelectorAll('button, input:not([type=file]), select, output, .fsp-slot, .fsp-stage, .fsp-tlbox')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 1);
  const name = (e) => (e.className || e.tagName) + (e.textContent ? ' "' + e.textContent.trim().slice(0, 16) + '"' : '');
  return {
    out: shown.map((e) => [e, e.getBoundingClientRect()])
      .filter(([, r]) => r.left < o.left - 0.5 || r.top < o.top - 0.5 || r.right > o.right + 0.5 || r.bottom > o.bottom + 0.5)
      .map(([e, r]) => name(e) + ' ' + [r.left - o.left, r.top - o.top, r.right - o.right, r.bottom - o.bottom].map(Math.round).join(',')),
    cut: [...shown.filter((e) => e.matches('button, output') && e.scrollWidth > e.clientWidth + 1).map(name), ...speedCut()],
  };
  // The speed reading's widest text, whatever it reads now.
  function speedCut() {
    const sp = root.querySelector('.fsp-speed');
    if (!sp || !sp.getClientRects().length) return [];
    const m = document.createElement('span');
    m.textContent = '20000 mm/s';
    m.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    sp.append(m);
    const need = m.getBoundingClientRect().width;
    m.remove();
    return sp.clientWidth + 0.5 < need ? ['fsp-speed ' + sp.clientWidth + ' < ' + Math.ceil(need)] : [];
  }
}, C);

/** Display epoch ms of media ms m, from the clock's own observations around m. */
function displayAt(obs, m, rate = 1) {
  let best = null;
  for (const o of obs) if (!best || Math.abs(o.m - m) < Math.abs(best.m - m)) best = o;
  return best && Math.abs(best.m - m) < 200 ? best.d + (m - best.m) / rate : NaN;
}
/** For each asked segment at one rate: its start minus the display time of its knot, ms. */
function intended(asked, obs, rate) {
  const out = [];
  for (const s of asked) {
    const k = knotOf(s.durationMs, rate);
    if (k < 0) continue;
    const d = displayAt(obs, ACTIONS[k - 1].at, rate);
    if (Number.isFinite(d)) out.push(s.at - d);
  }
  return out;
}

const BAD_WORDS = [/\. /, /\bso that\b/i, /\ballows you\b/i, /\bsimply\b/i, /\bjust\b/i, /\bin order to\b/i];
const copyOk = (t) => t.length <= 60 && t.split(/\s+/).filter(Boolean).length <= 8 && !BAD_WORDS.some((b) => b.test(t));

// ---- (r) the page redesign (ph-1qs5.2, .3): classes, shell cards, the stage, Open video and Open script, motion only ----
if (!LIVE && !STASH_LIVE) {
  console.log('(r) page redesign');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  const SIZES = [[1428, 900, 'desktop'], [1024, 768, 'desktop'], [420, 860, 'portrait'], [860, 420, 'landscape']];
  const EVID = SHOTS || null;
  const clip = { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO };
  const fun = (name = 'clip.funscript') => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(SCRIPT)) });
  for (const [w, hh, cls] of SIZES) {
    const hub = makeHub(cat);
    hub.values[CH.config + ':window_min'] = 0;
    hub.values[CH.config + ':window_max'] = 100;
    hub.values[CH.motion + ':pos_10um'] = 50;
    const { ctx, page, errors } = await open({ cat, hub, width: w, height: hh, coarse: cls !== 'desktop' });
    const at = w + 'x' + hh;
    const there = await toPluginPage(page);
    ok('redesign ' + at + ': the page mounts the card', there);
    if (!there) { await ctx.close(); continue; }
    await page.waitForTimeout(400);
    const look = () => page.evaluate((c) => {
      const root = document.querySelector(c), o = root.getBoundingClientRect();
      const rel = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return [r.x - o.x, r.y - o.y, r.width, r.height].map((v) => Math.round(v)); };
      return { cls: root.dataset.cls, comp: root.dataset.comp, bar: rel(root.querySelector('.fsp-tr')), vbox: rel(root.querySelector('.fsp-vbox')),
        stage: rel(root.querySelector('.fsp-stage')), status: root.querySelector('.fsp-slot').textContent };
    }, C);
    // Landscape: the card runs past the window, so a second shot scrolled to the bar.
    const shot = async (name) => {
      if (!EVID) return;
      await page.locator(C).evaluate((r) => r.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: join(EVID, name + '-' + at + '.png') });
      if (cls === 'landscape') {
        await page.locator(C + ' .fsp-tr').evaluate((e) => e.scrollIntoView({ block: 'end' }));
        await page.screenshot({ path: join(EVID, name + '-' + at + '-bar.png') });
        await page.locator(C).evaluate((r) => r.scrollIntoView({ block: 'start' }));
      }
    };
    const empty = await look();
    ok('redesign ' + at + ': the page class is ' + cls, empty.cls === cls && empty.comp === (cls === 'portrait' ? 'handheld' : 'full'), empty);
    // PR1: the shell's numbered heads on shell cards; no private box inside the Player card but the --screen plates.
    const chromeOk = await page.evaluate(([c, cls]) => {
      const root = document.querySelector(c), pg = root.closest('.fsp-page');
      const heads = [...pg.querySelectorAll('.fsp-h')].filter((e) => e.getClientRects().length)
        .map((e) => e.textContent + '|' + getComputedStyle(e).textTransform);
      const probe = document.createElement('i');
      document.body.append(probe);
      const tok = (t) => { probe.style.background = 'var(' + t + ')'; return getComputedStyle(probe).backgroundColor; };
      const screen = tok('--screen'), card = tok('--bg-card');
      probe.remove();
      const frame = root.querySelector('.fsp-pframe');
      const lib = root.querySelector('.fsp-libbox');
      const boxes = [...root.querySelectorAll('*')].filter((e) => e.getClientRects().length && !e.closest('.fsp-libbox, .fsp-pframe, .fsp-zoom, .fsp-hov, .fsp-menu, .fsp-anbox, svg'))
        .filter((e) => { const s = getComputedStyle(e); return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== screen && parseFloat(s.borderTopWidth) > 0; })
        .map((e) => e.className || e.tagName);
      return { heads, frame: !!frame && frame.classList.contains('surface-card') && getComputedStyle(frame).backgroundColor === card,
        lib: cls !== 'portrait' && lib.getClientRects().length ? getComputedStyle(lib).backgroundColor === card : true, boxes };
    }, [C, cls]);
    // 1024x768: the library shuts for the session so the bar keeps one row (BAR_ROW_MIN); the caret reopens it.
    const libShut = w === 1024;
    ok('redesign ' + at + ': the library column ' + (libShut ? 'shut for the session, the pref untouched' : 'as the pref says'),
      (await page.locator(C).evaluate((r) => r.hasAttribute('data-libshut'))) === libShut
      && (await page.evaluate(() => localStorage.getItem('phosphor.funscript.libOpen'))) !== 'false');
    const wantHeads = cls === 'portrait' || libShut ? ['01Player|uppercase'] : ['01Player|uppercase', '02Library|uppercase'];
    ok('redesign ' + at + ': heads 01 PLAYER' + (wantHeads.length === 1 ? '' : ', 02 LIBRARY') + ' on shell cards; no private box in the Player card',
      same(chromeOk.heads, wantHeads) && chromeOk.frame && chromeOk.lib && chromeOk.boxes.length === 0, chromeOk);
    if (cls === 'portrait') ok('redesign ' + at + ': the empty stage is a 120 px strip', Math.abs(empty.vbox[3] - 120) <= 1, empty.vbox);
    // PR5: the bar's order; every target 40 px under a coarse pointer (law 12).
    const bo = await barOrder(page);
    const want = cls === 'desktop' ? [BAR_DESK] : BAR_PHONE;
    ok('bar ' + at + ': ' + (cls === 'desktop' ? 'one row under the stage: prev, Play, next, elapsed, heat, remaining, volume, Motion, rate, Fullscreen, Settings'
      : 'the scrub row over prev, Play, next, Motion, rate, Fullscreen, Rail, Settings; 40 px targets'),
    same(bo.rows, want) && (cls === 'desktop' || bo.small.length === 0), bo);
    const below = await page.locator(C).evaluate((r) => { const b = r.querySelector('.fsp-tr').getBoundingClientRect(), s = r.querySelector('.fsp-stage').getBoundingClientRect(),
      t = r.querySelector('.fsp-tlh').getBoundingClientRect(); return { underStage: Math.abs(b.top - s.bottom) < 12 && b.bottom <= t.top, atBottom: b.top > t.bottom }; });
    ok('bar ' + at + ': ' + (cls === 'desktop' ? 'directly under the stage, above the timeline head' : 'at the card\'s bottom, under the timeline'),
      cls === 'desktop' ? below.underStage : below.atBottom, below);
    const sp0 = await spill(page);
    ok('bar ' + at + ': every control inside the card, no label cut', sp0.out.length === 0 && sp0.cut.length === 0, sp0);
    // PR6: Motion is the shell's on look.
    const look6 = await page.evaluate((c) => {
      const b = document.createElement('button');
      b.className = 'og-btn sm on';
      b.textContent = 'x';
      document.querySelector(c).append(b);
      const s = getComputedStyle(b), m = getComputedStyle(document.querySelector(c + ' .fsp-motion'));
      const out = { color: [m.color, s.color], border: [m.borderTopColor, s.borderTopColor], glow: [m.boxShadow, s.boxShadow] };
      b.remove();
      return out;
    }, C);
    ok('bar ' + at + ': Motion wears the shell\'s .og-btn.on (color, border, glow)', Object.values(look6).every(([a, b]) => a === b) && look6.glow[0] !== 'none', look6);
    // PR7: nothing over the wave screen but the playhead, the range pills and the speed reading at its foot.
    const over = await page.evaluate((c) => {
      const root = document.querySelector(c), dt = root.querySelector('.fsp-dt'), d = dt.getBoundingClientRect();
      return [...root.querySelectorAll('*')].filter((e) => !dt.contains(e) && !e.contains(dt) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
        && !e.closest('.fsp-pframe, svg, .fsp-menu'))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left < d.right - 0.5 && r.right > d.left + 0.5 && r.top < d.bottom - 0.5 && r.bottom > d.top + 0.5; })
        .map((e) => e.className || e.tagName);
    }, C);
    ok('head ' + at + ': no element sits over the wave screen', over.length === 0, over);
    const opens = await page.evaluate((c) => [...document.querySelectorAll(c + ' .fsp-empty button')].map((b) => b.textContent), C);
    ok('redesign ' + at + ': the empty stage offers Open video and Open script', same(opens, ['Open video', 'Open script']), opens);
    await shot('empty');
    // Script only: motion only (PR4).
    await page.setInputFiles(C + ' .fsp-files', [fun()]);
    await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const mo = await look();
    const moUi = await page.evaluate((c) => {
      const r = document.querySelector(c), f = r.querySelector('.fsp-full');
      return { mo: r.hasAttribute('data-mo'), meter: !!r.querySelector('.fsp-mo .fsp-meter').getClientRects().length,
        full: f.disabled && f.getAttribute('aria-label') === 'No video', open: !!r.querySelector('.fsp-mo .og-btn').getClientRects().length };
    }, C);
    ok('redesign ' + at + ': script only is motion only: the stroke meter, Open video, Fullscreen grayed (No video)',
      moUi.mo && moUi.meter && moUi.full && moUi.open && mo.status === 'Motion only', { moUi, status: mo.status });
    if (cls === 'portrait') ok('redesign ' + at + ': motion only keeps the 120 px strip', Math.abs(mo.vbox[3] - 120) <= 1, mo.vbox);
    if (cls === 'desktop' && w === 1428) {
      const n0 = hub.bundles.length;
      const t0 = await page.locator(C + ' .fsp-mo .fsp-tick.int').evaluate((e) => e.style.left);
      await playBtn(page).click();
      await page.waitForTimeout(2500);
      const t1 = await page.locator(C + ' .fsp-mo .fsp-tick.int').evaluate((e) => e.style.left);
      const norms = hub.segs(n0).map((s) => s.norm);
      ok('redesign: motion only, Play moves the machine on the clock (segments with changing positions), the meter moves',
        norms.length > 3 && new Set(norms).size >= 2 && t0 !== t1, { n: norms.length, t0, t1 });
      await shot('script-only-playing');
      await playBtn(page).click();
      await page.waitForTimeout(300);
    }
    await shot('script-only');
    // Then a video attaches to the loaded script (script, then video).
    await page.setInputFiles(C + ' .fsp-filev', [clip]);
    await page.waitForFunction((c) => { const v = document.querySelector(c + ' .fsp-stage video'); return v.readyState >= 1 && !document.querySelector(c + '[data-mo]'); }, C, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const loaded = await look();
    const paired = () => page.evaluate((c) => ({ src: !!document.querySelector(c + ' .fsp-stage video').getAttribute('src'),
      play: !document.querySelector(c + ' .fsp-play').disabled, mo: !!document.querySelector(c + '[data-mo]') }), C);
    const p1 = await paired();
    ok('redesign ' + at + ': script then video ends loaded and paired', p1.src && p1.play && !p1.mo, p1);
    if (cls === 'portrait') ok('redesign ' + at + ': a 16:9 video gives a stage of width x 9/16', Math.abs(loaded.vbox[3] - loaded.vbox[2] * 9 / 16) <= 1.5, loaded);
    await shot('loaded');
    // Video only, then the script (video, then script).
    await page.locator(C).evaluate((r) => { const b = r.querySelector('.fsp-src .fsp-close'); if (b.getClientRects().length) b.click(); else r.querySelector('.fsp-mclose').click(); });
    await page.waitForTimeout(200);
    await page.setInputFiles(C + ' .fsp-filev', [clip]);
    await page.waitForTimeout(600);
    const vonly = await look();
    await page.setInputFiles(C + ' .fsp-files', [fun()]);
    await page.waitForTimeout(400);
    const p2 = await paired();
    ok('redesign ' + at + ': video then script ends loaded and paired', p2.src && p2.play && !p2.mo, p2);
    ok('redesign ' + at + ': the player bar keeps its rect empty, script only, video only and loaded',
      same(empty.bar, mo.bar) && same(empty.bar, vonly.bar) && same(empty.bar, loaded.bar), { empty: empty.bar, mo: mo.bar, vonly: vonly.bar, loaded: loaded.bar });
    if (cls === 'desktop' && w === 1428) {
      await page.setInputFiles(C + ' .fsp-filev', [clip, fun()]);
      await page.waitForTimeout(500);
      const p3 = await paired();
      ok('redesign: a two-file pick in Open video ends loaded and paired', p3.src && p3.play && !p3.mo, p3);
      await page.evaluate(() => window.addEventListener('phosphor-page-fullscreen', (e) => { window.__fsAsk = e.detail; }, true));
      await page.locator(C + ' .fsp-full').click();
      await page.waitForTimeout(500);
      await page.mouse.move(700, 400);
      await page.waitForTimeout(300);
      if (EVID) await page.screenshot({ path: join(EVID, 'fullscreen-1428x900.png') });
      const ask = await page.evaluate(() => window.__fsAsk);
      ok('fullscreen: one mode, the ask bare; no mode glyph (PR8)', !!ask && ask.bare === true && await page.locator(C + ' .fsp-hb-mode').count() === 0, ask);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    if (cls === 'desktop' && w === 1428) {
      const span = () => page.locator(C + ' .fsp-zoom output').textContent();
      const s0 = await span();
      await page.locator(C + ' .fsp-zoom button[aria-label="Zoom in"]').click();
      const s1 = await span();
      await page.locator(C + ' .fsp-zoom button[aria-label="Zoom out"]').click();
      ok('head: zoom - and + step the span on the desktop', s0 === '10 s' && s1 === '5 s' && (await span()) === '10 s', [s0, s1]);
    }
    if (cls === 'portrait') {
      // PR7: the band collapses to its head on the user's tap; the bar keeps its rect; the state survives a reload.
      const bar0 = (await look()).bar;
      await page.locator(C + ' .fsp-tlcaret').click();
      await page.waitForTimeout(200);
      const shut = await look();
      const shutUi = await page.locator(C).evaluate((r) => ({ shut: r.hasAttribute('data-tlshut'), dt: !!r.querySelector('.fsp-dt').getClientRects().length }));
      await shot('timeline-collapsed');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 }).catch(() => {});
      await toPluginPage(page);
      await page.waitForTimeout(400);
      const kept = await page.locator(C).evaluate((r) => r.hasAttribute('data-tlshut'));
      ok('head ' + at + ': the caret collapses the band to its head, the bar keeps its rect, the state survives a reload',
        shutUi.shut && !shutUi.dt && same(shut.bar, bar0) && kept, { bar0, bar: shut.bar, shutUi, kept });
      await page.locator(C + ' .fsp-tab', { hasText: 'Player' }).click();
      await page.locator(C + ' .fsp-tlcaret').click();
      await page.waitForTimeout(200);
      await page.setInputFiles(C + ' .fsp-filev', [clip, fun()]);
      await page.waitForTimeout(500);
      await page.setInputFiles(C + ' .fsp-filev', [{ name: 'tall.webm', mimeType: 'video/webm', buffer: VIDEO_TALL }]);
      await page.waitForFunction((c) => document.querySelector(c + '[data-ar]') && document.querySelector(c + ' .fsp-stage video').videoHeight === 320, C, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      const tall = await look();
      ok('redesign ' + at + ': a 9:16 video stands tall up to the room its row has', tall.vbox[3] > loaded.vbox[3]
        && Math.abs(tall.vbox[3] - Math.min(tall.vbox[2] * 16 / 9, tall.stage[3])) <= 1.5, { vbox: tall.vbox, stage: tall.stage });
      await shot('loaded-tall');
      // PR17: a turn to landscape with a video is fullscreen, the turn back leaves it; an Exit in landscape holds.
      const fsNow = () => page.locator(C).evaluate((r) => r.hasAttribute('data-media'));
      await page.setViewportSize({ width: 860, height: 420 });
      await page.waitForTimeout(700);
      const turned = await fsNow();
      if (EVID) await page.screenshot({ path: join(EVID, 'fullscreen-860x420.png') });
      await page.setViewportSize({ width: 420, height: 860 });
      await page.waitForTimeout(700);
      const back = await fsNow();
      await page.setViewportSize({ width: 860, height: 420 });
      await page.waitForTimeout(700);
      await page.locator(C).focus();
      await page.keyboard.press('f');
      await page.waitForTimeout(700);
      const held = await fsNow();
      ok('rotation: landscape with a video enters fullscreen, portrait leaves it, an Exit in landscape holds (PR17)', turned && !back && !held, { turned, back, held });
      await page.setViewportSize({ width: 420, height: 860 });
      await page.waitForTimeout(500);
    }
    ok('redesign ' + at + ': no page error', errors.length === 0, errors.slice(0, 3));
    clearInterval(hub.timer);
    await ctx.close();
  }
}
// ---- (t) the theme (operator 2026-10-08): every player color follows the shell's preset ----
// The player in two presets whose chassis and accents both differ: a color that stays put is a literal, unless it is a
// locked safety token (law 13). With --shots, the page at 420x860 and 1428x900 under every preset, in <shots>/themes/.
if (!LIVE && !STASH_LIVE) {
  console.log('(t) theme tokens');
  const { THEMES } = await import('../src/model/theme.js');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  const clip = { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO };
  const fun = { name: 'clip.funscript', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(SCRIPT)) };
  async function themed(theme, w, hh, fn) {
    const hub = makeHub(cat);
    hub.values[CH.config + ':window_min'] = 0;
    hub.values[CH.config + ':window_max'] = 100;
    hub.values[CH.motion + ':pos_10um'] = 50;
    const { ctx, page } = await open({ cat, hub, width: w, height: hh, coarse: w < 860, prefs: { 'phosphor.theme': theme } });
    let out = null;
    if (await toPluginPage(page)) {
      await page.setInputFiles(C + ' .fsp-filev', [clip, fun]);
      await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      out = await fn(page);
    }
    clearInterval(hub.timer);
    await ctx.close();
    return out;
  }
  const { TOKENS } = await import('../src/model/theme.js');
  const colors = (page) => page.evaluate(([c, TOKENS]) => {
    const root = document.querySelector(c), out = {}, tok = {};
    const probe = document.createElement('i');
    document.body.append(probe);
    for (const t of TOKENS) { probe.style.color = ''; probe.style.color = 'var(' + t + ')'; tok[t] = getComputedStyle(probe).color; }
    const locked = ['--warn', '--bad', '--estop'].map((t) => tok[t]);
    probe.remove();
    const key = (e) => { const p = []; for (; e && e !== root; e = e.parentElement) p.unshift(e.tagName + [...e.parentElement.children].indexOf(e)); return p.join('/'); };
    for (const e of root.querySelectorAll('*')) {
      if (!e.getClientRects().length || e.closest('video, style') || getComputedStyle(e).visibility === 'hidden') continue;
      const s = getComputedStyle(e);
      const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const v = { ...(text ? { color: s.color } : {}), background: s.backgroundColor, border: parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : '',
        ...(e instanceof SVGGeometryElement ? { fill: s.fill, stroke: s.stroke } : {}) };
      for (const [k, x] of Object.entries(v)) {
        if (!x || x === 'none' || x === 'rgba(0, 0, 0, 0)' || /^url/.test(x) || locked.includes(x)) continue;
        out[key(e) + ' ' + (e.className.baseVal ?? e.className) + ' ' + k] = x;
      }
    }
    return { out, tok };
  }, [C, TOKENS]);
  const byId = (id) => THEMES.find((t) => t.id === id);
  // PR6 under both presets: Motion's color, border and glow are the shell's .og-btn.on.
  const onLook = (page) => page.evaluate((c) => {
    const b = document.createElement('button');
    b.className = 'og-btn sm on';
    b.textContent = 'x';
    document.querySelector(c).append(b);
    const s = getComputedStyle(b), m = getComputedStyle(document.querySelector(c + ' .fsp-motion'));
    const out = [m.color === s.color, m.borderTopColor === s.borderTopColor, m.boxShadow === s.boxShadow && m.boxShadow !== 'none'];
    b.remove();
    return out;
  }, C);
  const both = async (page) => ({ ...(await colors(page)), on: await onLook(page) });
  const a = await themed(byId('phosphor'), 1428, 900, both), b = await themed(byId('paper'), 1428, 900, both);
  ok('theme: Motion wears the shell\'s .og-btn.on under Phosphor and Paper (PR6)', !!a && !!b && [...a.on, ...b.on].every(Boolean), [a && a.on, b && b.on]);
  // A token both presets resolve to the same color (a held contrast gray) may stay put; nothing else may.
  const same2 = a && b ? new Set(Object.keys(a.tok).filter((t) => a.tok[t] === b.tok[t]).map((t) => a.tok[t])) : new Set();
  const stuck = a && b ? Object.keys(a.out).filter((k) => k in b.out && a.out[k] === b.out[k] && !same2.has(a.out[k])).map((k) => k + ' ' + a.out[k]) : ['no card'];
  ok('theme: every player color moves between Phosphor and Paper (no literal colors; tokens equal in both aside)',
    a && Object.keys(a.out).length > 30 && stuck.length === 0, stuck.slice(0, 8));
  if (SHOTS) {
    const dir = join(SHOTS, 'themes');
    mkdirSync(dir, { recursive: true });
    for (const t of THEMES) {
      for (const [w, hh] of [[420, 860], [1428, 900]]) {
        await themed(t, w, hh, (page) => page.screenshot({ path: join(dir, t.id + '-' + w + 'x' + hh + '.png') }));
      }
    }
  }
}

if (!LIVE) {
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  if (!STASH_LIVE) {
  console.log('(d) the card on a fake hub');
  {
    const noseg = advgenCatalog({ drop: ['input.duration'] });
    noseg.entries = decodeCatalog(noseg.bytes);
    const { ctx, page, up } = await open({ cat: noseg, hub: makeHub(noseg) });
    ok('claim: without a segments STREAM no card renders (D1)', up && !(await toCard(page)));
    await ctx.close();
  }

  const hub = makeHub(cat);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  hub.values[CH.motion + ':pos_10um'] = 80;
  const { ctx, page, up, errors } = await open({ cat, hub, probe: BUSY_PROBE });
  ok('claim: the shell adopted the fixture', up);
  ok('claim: the card renders on the fixture', await toCard(page));
  const stageH = await page.locator(C + ' .fsp-stage').evaluate((e) => Math.round(e.getBoundingClientRect().height));
  ok('claim: the video stage gets real height on its page (at least 120 px)', stageH >= 120, stageH);
  const rects = { empty: await chrome(page) };
  ok('empty: the status reads No scene loaded', (await statusText(page)) === 'No scene loaded', await statusText(page));
  ok('empty: Play is grayed', await playBtn(page).isDisabled());
  const chooser = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), page.locator(C + ' .fsp-empty .og-btn').first().click()])
    .then(([fc]) => fc.isMultiple()).catch(() => false);
  ok('open: the empty stage\'s Open video opens the picker, multiple (PR3)', chooser);
  const openWhere = await page.evaluate((c) => [...document.querySelectorAll(c + ' button')].filter((b) => /Open (video|script)|Open files/.test(b.textContent) && b.getClientRects().length)
    .map((b) => b.parentElement.className + ' ' + b.textContent), C);
  ok('open: Open video and Open script on the empty stage and in the head or its Media menu, none in the library (PR3)',
    !openWhere.some((x) => /fsp-lib|Open files/.test(x)) && openWhere.filter((x) => /fsp-empty/.test(x)).length === 2, openWhere);
  const accept = await page.evaluate((c) => [...document.querySelectorAll(c + ' input[type=file]')].map((f) => f.accept + (f.multiple ? ' *' : '')), C);
  ok('open: Open video takes video, the webview\'s audio types (never audio/*: MIDI) and .funscript; Open script only .funscript',
    accept.length === 2 && /^video\/\*,/.test(accept[0]) && !/audio\/\*/.test(accept[0]) && /\.funscript \*$/.test(accept[0]) && accept[1] === '.funscript', accept);

  ok('load: a local clip and its script enable Play', await loadClip(page));
  await page.waitForTimeout(500);
  rects.ready = await chrome(page);
  ok('dash card: the player bar and the timeline head (one code path with the page, PR5/PR7)', await page.locator(C).evaluate((e) => !e.closest('.fsp-page')
    && !!e.querySelector('.fsp-tr .fsp-motion').getClientRects().length && !!e.querySelector('.fsp-tlh .fsp-tlcaret').getClientRects().length));
  const bar = await barOrder(page);
  const ORDER = bar.comp === 'full' ? BAR_DESK.filter((c) => !/fsp-(full|set)/.test(c)) : BAR_PHONE[0].concat(BAR_PHONE[1]).filter((c) => !/fsp-(full|set)/.test(c));
  ok('bar: the dash card\'s bar in the PR5 order (no Fullscreen or Settings: page only), ' + (bar.comp === 'full' ? 'one row' : 'two rows'),
    same(bar.rows.flat(), ORDER) && bar.rows.length === (bar.comp === 'full' ? 1 : 2), bar);
  ok('bar: Graph names its key and sits in the timeline head', await page.locator(C + ' .fsp-tlh .fsp-expand').evaluate((e) => /\(g\)/.test(e.title)));
  const rt = [];
  for (let i = 0; i < 6; i++) { await page.locator(C + ' .fsp-rate').click(); rt.push(await page.locator(C + ' .fsp-rate').textContent()); }
  ok('transport: rate cycles 1.25x, 1.5x, 2x, 0.5x, 0.75x, 1x', rt.join() === '1.25x,1.5x,2x,0.5x,0.75x,1x', rt);
  ok('transport: no screenshot and no layout button', (await page.locator(C + ' .fsp-snap, ' + C + ' .fsp-layout').count()) === 0);
  ok('idle: nothing is sent before Play', hub.bundles.length === 0, hub.bundles.length);

  // ---- preroll, then play ----
  await playBtn(page).click();
  await page.waitForTimeout(150);
  const pre = hub.bundles[0];
  const preDur = 400 + 1200 * Math.abs(0.8 - 0.15);
  ok('preroll: one segment to the script start, 400 + 1200 x |delta| ms', !!pre && pre.segs.length === 1
    && Math.abs(pre.segs[0].norm - 0.15) < 0.002 && Math.abs(pre.segs[0].dur - preDur) <= 1, pre && pre.segs);
  ok('preroll: Positioning in the status, the video holds', (await statusText(page)) === 'Positioning'
    && await video(page, (v) => v.paused && v.currentTime === 0), await statusText(page));
  rects.preroll = await chrome(page);
  await page.waitForTimeout(preDur + 300);
  ok('preroll: the video starts at its end', await video(page, (v) => !v.paused && v.currentTime > 0.05));
  await page.waitForTimeout(3500);
  rects.playing = await chrome(page);
  if (SHOT) {
    await page.locator(C).screenshot({ path: SHOT });
    await page.locator(C + ' .fsp-tlbox').screenshot({ path: SHOT.replace(/[^/\\]+$/, 'timeline-heat.png') });
  }
  if (process.env.FSP_DEBUG) console.log(await page.locator(C).evaluate((e) => [e, e.parentElement, e.parentElement.parentElement, ...e.children]
    .map((x) => x.className + ' ' + JSON.stringify(x.getBoundingClientRect()) + ' ' + getComputedStyle(x).overflow)));

  // ---- timing ----
  const played = hub.segs(1);
  ok('timing: segments flow while playing', played.length > 8, played.length);
  const ahead = played.map((s) => (s.exec - s.arrival) / 1000);
  ok('timing: every start within half the horizon of its arrival', ahead.every((a) => a <= HORIZON_MS / 2 + 2), Math.max(...ahead));
  // The clock corrects by its whole median until its ring fills (clock.js), so
  // the first second may leave a hole; past it the schedule must tile.
  const sched = schedule(hub.bundles.slice(1));
  // A restart (a clock step) cuts over: its first start is clipped to now, inside the previous span.
  const gaps = sched.slice(1).map((s, i) => ({ at: (s.exec - sched[0].exec) / 1000, g: (s.exec - (sched[i].exec + sched[i].dur * 1000)) / 1000,
    cut: s.first && clipped(s) }));
  const settled = gaps.filter((x) => x.at > 1500 && !(x.cut && x.g < 0));
  ok('timing: once the clock settles (1.5 s) starts tile, each within 3 ms of the previous end',
    settled.length > 3 && settled.every((x) => Math.abs(x.g) <= 3), settled.filter((x) => Math.abs(x.g) > 3));
  console.log('  [NOTE] restarts while playing: ' + gaps.filter((x) => x.cut).length);
  console.log('  [NOTE] holes before the clock settles: ' + JSON.stringify(gaps.filter((x) => x.at <= 1500 && Math.abs(x.g) > 3)
    .map((x) => Math.round(x.g * 10) / 10)) + ' ms');
  ok('timing: each segment is sent once', new Set(played.map((s) => Math.round(s.exec / 100))).size === played.length);
  const skew = await epochSkew(page);
  const asked = await probeSegs(page, skew);
  // exec minus asked = the session's CLOCK estimate error (Playwright's routed
  // socket is asymmetric), one constant; the host's own part must not spread.
  const conv = played.filter((s) => !clipped(s)).map((s) => {
    const p = asked.find((x) => Math.abs(x.durationMs - s.dur) <= 1 && Math.abs(x.norm - s.norm) < 0.002 && Math.abs(x.at - s.exec / 1000) < 50);
    return p ? s.exec / 1000 - p.at : NaN;
  }).filter(Number.isFinite);
  const spread = Math.max(...conv) - Math.min(...conv);
  ok('timing: the host converts every start by one offset (spread within 1 ms)', conv.length > 5 && spread <= 1,
    { n: conv.length, spread, clockError: median(conv) });
  ok('timing: the hub clock estimate is within 25 ms (harness CLOCK over a routed socket)', Math.abs(median(conv)) <= 25, median(conv));
  clockErrUs = median(conv) * 1000;
  const obs0 = await probeObs(page, skew);
  const lag0 = intended(asked, obs0, 1);
  ok('sync: the player asks each knot at the instant its frame shows (median within 5 ms)', lag0.length > 5 && Math.abs(median(lag0)) <= 5,
    { n: lag0.length, median: median(lag0) });

  // ---- the second plugin ----
  await page.evaluate(() => { window.__probeSubmit = true; });
  await page.waitForTimeout(300);
  const busyGate = await page.locator('#busy-probe').first().textContent().catch(() => null);
  const busy = await page.evaluate(() => window.__busy);
  ok('gates: a second plugin reads the busy words', busyGate === 'motion input in use by funscript-player', busyGate);
  ok('gates: and its submitSegments is refused with them', !!busy && !busy.ok && busy.reason === 'motion input in use by funscript-player', busy);
  await page.evaluate(() => { window.__probeSubmit = false; });

  // ---- seek ----
  const n0 = hub.bundles.length;
  await video(page, (v) => { v.currentTime = 15; });
  await page.waitForTimeout(1500);
  const after = hub.bundles.slice(n0);
  // A tick may still go out between the seek and its 'seeking' event.
  const hi = after.findIndex((b) => b.segs.length === 1 && b.segs[0].dur <= 200 && clipped(b.segs[0]));
  const hold = after[hi];
  const resumed = after[hi + 1];
  ok('seek: one hold first', !!hold && hold.segs.length === 1 && hold.segs[0].dur <= 200);
  ok('seek: the next bundle starts at now (clipped to the earliest start)', !!resumed && clipped(resumed.segs[0]),
    resumed && (resumed.segs[0].exec - resumed.arrival) / 1000);
  // The seek transition (prefs play.seekMs, 500 by default): one glide from now to where the script will be.
  const glide = resumed && resumed.segs[0];
  const { posAt: posAtS, parseFunscript: parseS } = mods[P + 'funscript.js'];
  const sc15 = parseS(SCRIPT);
  const near = glide ? Math.min(...Array.from({ length: 81 }, (_, i) => Math.abs(posAtS(sc15, 15300 + 10 * i) - glide.norm))) : NaN;
  ok('seek: a 500 ms glide to the script 500 ms on', !!glide && Math.abs(glide.dur - 500) <= 1 && near < 0.01, glide && { dur: glide.dur, near });
  const later = after.slice(hi + 1).flatMap((b) => b.segs).filter((s) => !clipped(s));
  const knots = later.filter((s) => knotOf(s.dur) > 0);
  ok('seek: then the script: one joining span, its knots past 15 s', later.length > 2 && later.length - knots.length <= 1
    && knots.every((s) => ACTIONS[knotOf(s.dur) - 1].at >= 14000), { later: later.length, knots: knots.length });

  // ---- offset ----
  const asked1 = (await probeSegs(page, skew)).length;
  const obs1 = (await probeObs(page, skew)).length;
  const off = page.locator(C + ' .fsp-off input');
  await off.fill('50');
  await off.press('Enter');
  await off.dispatchEvent('change');
  await page.waitForTimeout(4000);
  const lag50 = intended((await probeSegs(page, skew)).slice(asked1), (await probeObs(page, skew)).slice(obs1), 1);
  ok('offset: +50 moves every start 50 ms later (median within 5 ms)', lag50.length > 5 && Math.abs(median(lag50) - median(lag0) - 50) <= 5,
    { before: median(lag0), after: median(lag50) });
  await off.fill('0');
  await off.dispatchEvent('change');

  // ---- rate ----
  const n2 = hub.bundles.length;
  await video(page, (v) => { v.playbackRate = 1.5; });
  await page.waitForTimeout(2500);
  // ratechange sends one hold, then the restart; a segment sent before the event fired is superseded.
  const rb = hub.bundles.slice(n2);
  const h = rb.findIndex((b) => b.segs.length === 1 && b.segs[0].dur <= 200);
  const fast = rb.slice(h + 1).flatMap((b) => b.segs.filter((x, i) => !(i === 0 && clipped(x))));
  ok('rate: 1.5 divides every duration', fast.length > 3 && fast.every((s) => knotOf(s.dur, 1.5) > 0),
    fast.filter((s) => knotOf(s.dur, 1.5) < 0).map((s) => s.dur));
  await video(page, (v) => { v.playbackRate = 1; });
  await page.waitForTimeout(800);

  // ---- pause ----
  const n3 = hub.bundles.length;
  await playBtn(page).click();
  await page.waitForTimeout(1200);
  const stops = hub.bundles.slice(n3);
  ok('pause: exactly one hold, then silence', stops.length === 1 && stops[0].segs.length === 1 && stops[0].segs[0].dur <= 200,
    stops.map((b) => b.segs.map((s) => s.dur)));
  ok('pause: the video is paused, Play offered', await video(page, (v) => v.paused) && (await playBtn(page).textContent()) === 'Play');
  rects.paused = await chrome(page);

  // ---- latch ----
  hub.set(CH.motion, 'pos_10um', 15);   // at the script: no preroll
  await playBtn(page).click();
  await page.waitForTimeout(1500);
  ok('latch: playing again', await video(page, (v) => !v.paused));
  const n4 = hub.bundles.length;
  const t0 = Date.now(), latchedAt = hubUs();
  hub.setLatch(PAUSE_BIT);
  const pausedIn = await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 2000, polling: 5 })
    .then(() => Date.now() - t0).catch(() => Infinity);
  ok('latch: a pushed PAUSE pauses the video within 100 ms', pausedIn <= 100, pausedIn);
  ok('latch: the latch words in the status', (await statusText(page)) === 'paused, resume to continue', await statusText(page));
  await page.waitForTimeout(800);
  const late = hub.bundles.slice(n4).filter((b) => b.arrival - latchedAt > 60000);
  ok('latch: nothing is sent once the latch is seen (60 ms for it to arrive)', late.length === 0, late.length);
  rects.held = await chrome(page);
  hub.setLatch(0);
  await page.waitForTimeout(1000);
  ok('latch: clearing it plays nothing, Play is offered', await video(page, (v) => v.paused) && !(await playBtn(page).isDisabled()));

  // ---- the generator gate, mid-play: paused, and no hold into the rail the generator now owns ----
  const holdMarks = () => page.evaluate(() => (window.__funscriptProbe || []).filter((x) => x.k === 'mark' && x.name === 'hold').length);
  await playBtn(page).click();
  await page.waitForTimeout(2500);
  ok('gates: playing before the generator starts', await video(page, (v) => !v.paused));
  const n5 = hub.bundles.length, h5 = await holdMarks(), pushedAt = hubUs();
  hub.set(CH.advgen, 'running', 1);
  const gatedIn = await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 2000, polling: 5 })
    .then(() => (hubUs() - pushedAt) / 1000).catch(() => Infinity);
  await page.waitForTimeout(400);
  const lateGen = hub.bundles.slice(n5).filter((b) => b.arrival - pushedAt > 60000);
  ok('gates: advgen.running mid-play pauses within 100 ms, sends no hold, nothing after',
    gatedIn <= 100 && (await holdMarks()) === h5 && lateGen.length === 0, { gatedIn, holds: (await holdMarks()) - h5, late: lateGen.length });
  ok('gates: advgen.running grays Play with its words', await playBtn(page).isDisabled()
    && (await statusText(page)) === 'stop the pattern first', await statusText(page));
  rects.gated = await chrome(page);
  hub.set(CH.advgen, 'running', 0);
  await page.waitForTimeout(400);

  // ---- a hub refusal: SOURCE_CONFLICT on the segments STREAM (a stream or generator the gate does not read) ----
  hub.nackStream = NACK.SOURCE_CONFLICT;
  const nRef = hub.bundles.length, hRef = await holdMarks();
  await playBtn(page).click();
  const refused = await page.waitForFunction((c) => /refused: rail owned by /.test(document.querySelector(c + ' > .fsp-slot').textContent), C, { timeout: 4000 })
    .then(() => true).catch(() => false);
  ok('refusal: a SOURCE_CONFLICT NACK reads "refused: rail owned by" its owner in the status slot', refused, await statusText(page));
  ok('refusal: the video pauses and Play is offered again', await video(page, (v) => v.paused) && !(await playBtn(page).isDisabled()));
  await page.waitForTimeout(300);
  const nAfter = hub.bundles.length;
  await page.waitForTimeout(600);
  // A STREAM has no answer: the bundle that drew the NACK went out first, and the hub dropped it.
  ok('refusal: one bundle draws it, no hold follows, nothing after', nAfter - nRef === 1 && hub.bundles.length === nAfter
    && (await holdMarks()) === hRef, { before: nAfter - nRef, after: hub.bundles.length - nAfter, holds: (await holdMarks()) - hRef });
  rects.refused = await chrome(page);
  if (SHOT) await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'refusal.png') });
  hub.nackStream = 0;

  // ---- layout ----
  for (const s of ['ready', 'preroll', 'playing', 'paused', 'held', 'gated', 'refused']) {
    const r = sameChrome(rects.empty, rects[s]);
    ok('layout: chrome rects in ' + s + ' match empty', r.ok, r.diff.slice(0, 4));
  }
  const head = await page.evaluate((c) => {
    const dt = document.querySelector(c + ' .fsp-dt');
    const probe = document.createElement('i');
    probe.style.background = 'var(--screen)';
    document.body.append(probe);
    const screen = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { head: [...document.querySelectorAll(c + ' .fsp-tlh > *')].filter((e) => e.getClientRects().length).map((e) => e.className.split(' ').find((k) => /^fsp-/.test(k) && k !== 'fsp-ic')),
      unit: document.querySelector(c + ' .fsp-off').textContent, num: document.querySelector(c + ' .fsp-off input').classList.contains('og-num'),
      dtBg: getComputedStyle(dt).backgroundColor === screen, ovBg: getComputedStyle(document.querySelector(c + ' .fsp-ov')).backgroundColor === screen,
      shadow: getComputedStyle(dt).boxShadow.includes('inset'), motionInBar: !!document.querySelector(c + ' .fsp-tr .fsp-motion') };
  }, C);
  ok('head: the timeline head holds caret, (zoom,) A-B, Offset (og-num, ms), Invert, Graph; Motion is the bar\'s (PR6/PR7)',
    same(head.head.filter((k) => k !== 'fsp-zoom'), ['fsp-tlcaret', 'fsp-tlgap', 'fsp-ab', 'fsp-off', 'fsp-inv', 'fsp-expand']) && /ms/.test(head.unit) && head.num && head.motionInBar, head);
  ok('head: the wave and the heat sit on --screen with the inset shadow', head.dtBg && head.ovBg && head.shadow, head);
  const red = await page.evaluate((c) => {
    const probe = document.createElement('i');
    for (const t of ['--bad', '--estop']) probe.style.color = 'var(' + t + ')';
    document.body.append(probe);
    const bad = ['--bad', '--estop'].map((t) => { probe.style.color = 'var(' + t + ')'; return getComputedStyle(probe).color; });
    probe.remove();
    return [...document.querySelectorAll(c + ' *')].filter((e) => {
      const cs = getComputedStyle(e);
      return [cs.color, cs.borderTopColor, cs.backgroundColor, cs.fill, cs.stroke].some((x) => bad.includes(x));
    }).length;
  }, C);
  ok('layout: nothing in the card wears --bad or --estop (law 13)', red === 0, red);
  const still = await page.evaluate((c) => {
    const bar = document.querySelector(c + ' .fsp-hb'), caret = document.querySelector(c + ' .fsp-libcaret svg');
    const d = () => [getComputedStyle(bar).transitionDuration, getComputedStyle(caret).transitionDuration];
    const was = d();
    document.documentElement.classList.add('still');
    const on = d();
    document.documentElement.classList.remove('still');
    return { was, on };
  }, C);
  ok('motion: the card transitions ride the duration tokens and stop under html.still', still.was.every((v) => v !== '0s') && still.on.every((v) => v === '0s'), still);
  // --warn is a mark, never text: Paper's white card reads it at 1.8:1.
  const warnText = await page.evaluate((c) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--warn)';
    document.body.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    const slot = document.querySelector(c + ' > .fsp-slot');
    const tone = slot.dataset.tone;
    slot.dataset.tone = 'warn';
    const speed = document.querySelector(c + ' .fsp-speed');
    speed.setAttribute('data-over', '');
    const hits = [...document.querySelectorAll(c + ' *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      && getComputedStyle(e).color === warn).map((e) => e.className || e.tagName);
    const bar = getComputedStyle(slot).borderLeftColor === warn;
    speed.removeAttribute('data-over');
    slot.dataset.tone = tone;
    return { hits, bar };
  }, C);
  ok('layout: no text wears --warn; the warn slot marks it with a --warn bar', warnText.hits.length === 0 && warnText.bar, warnText);
  const sp = await spill(page);
  ok('layout: every control lies inside the card', sp.out.length === 0, sp.out);
  ok('layout: no button or readout cuts its label', sp.cut.length === 0, sp.cut);
  const texts = await page.evaluate((c) => {
    const root = document.querySelector(c);
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (n.parentElement.tagName !== 'STYLE' && n.textContent.trim()) out.push(n.textContent.trim());
    for (const e of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
      for (const a of ['title', 'aria-label', 'placeholder']) if (e.getAttribute(a)) out.push(e.getAttribute(a));
    }
    return out;
  }, C);
  const badCopy = texts.filter((t) => !copyOk(t) && !/^[\d:.\s/]+$/.test(t));
  ok('copy: every rendered string is one short fragment (docs/COPY.md)', badCopy.length === 0, badCopy);
  const tables = Object.entries(mods).filter(([, m]) => m.COPY).flatMap(([p, m]) => Object.values(m.COPY).flatMap((t) => (typeof t === 'string' ? [t] : Object.values(t))).map((t) => [p.replace(P, ''), t]));
  const badTables = tables.filter(([, t]) => !copyOk(t.trim()));
  ok('copy: every COPY table entry is one short fragment', tables.length > 20 && badTables.length === 0, badTables);

  // ---- glance ----
  await page.locator(C).evaluate((e) => { e.parentElement.style.width = '220px'; });
  await page.waitForTimeout(300);
  const glance = await page.locator(C).evaluate((e) => ({
    comp: e.dataset.comp, video: !!e.querySelector('.fsp-stage video'),
    meter: getComputedStyle(e.querySelector('.fsp-meter')).display !== 'none',
    play: e.querySelector('.fsp-play').getBoundingClientRect().width > 0, w: e.getBoundingClientRect().width }));
  ok('glance: at 220 px the card composes glance, meter and Play shown, the video still mounted',
    glance.comp === 'glance' && glance.video && glance.meter && glance.play, glance);
  const gsp = await spill(page);
  ok('glance: every control lies inside the card, no label cut', gsp.out.length === 0 && gsp.cut.length === 0, gsp);
  if (SHOT) await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'glance.png') });
  // Handheld from its floor up, every 2 px at the default Look and at 1.4: no label or the speed
  // reading's floor is cut. At Look 1.4 the source row (two tabs and Open files) needs 304 px: the
  // floor scales with the Look, the tier thresholds stay the shell's px (rclass.js).
  const setLook = (v) => page.evaluate((x) => document.documentElement.style.setProperty('--s', x), String(v));
  const sweep = [];
  for (const [look, floor] of [[1.12, 264], [1.4, 304]]) {
    await setLook(look);
    for (let w = floor; w <= 959; w += 2) {
      await page.locator(C).evaluate((e, px) => { e.parentElement.style.width = px + 'px'; }, w);
      await page.waitForTimeout(30);
      const comp = await page.locator(C).evaluate((e) => e.dataset.comp);
      const s = await spill(page);
      sweep.push({ look, w, comp, out: s.out, cut: s.cut });
    }
  }
  const bad = sweep.filter((x) => x.out.length || x.cut.length || x.comp !== 'handheld');
  ok('handheld: to 959 px from 264 at Look 1.12 and 304 at 1.4, every control lies inside the card, no label cut (the two-row bar)',
    bad.length === 0, bad.slice(0, 6));
  await page.evaluate(() => document.documentElement.style.removeProperty('--s'));
  await page.locator(C).evaluate((e) => { e.parentElement.style.width = '420px'; });
  await page.waitForTimeout(200);
  const hh = await barOrder(page);
  ok('handheld 420: the dash card\'s bar is the scrub row over the buttons, the head row above the wave',
    hh.rows.length === 2 && same(hh.rows[0], BAR_PHONE[0]) && await page.locator(C + ' .fsp-tlh').isVisible(), hh);
  if (SHOT) {
    await page.locator(C).evaluate((e) => { e.parentElement.style.width = '326px'; });
    await page.waitForTimeout(150);
    await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'handheld-326.png') });
    await page.locator(C).evaluate((e) => { e.parentElement.style.width = '780px'; });
    await page.waitForTimeout(150);
    await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'handheld-780.png') });
  }
  await page.locator(C).evaluate((e) => { e.parentElement.style.width = ''; });
  await loadClip(page);
  await playBtn(page).click();
  await page.waitForTimeout(600);
  await page.locator(C).evaluate((r) => { const b = r.querySelector('.fsp-src .fsp-close'); if (b.getClientRects().length) b.click(); else r.querySelector('.fsp-mclose').click(); });
  await page.waitForTimeout(200);
  ok('transport: close unloads the media, the card is empty again, also while playing', (await statusText(page)) === 'No scene loaded' && await playBtn(page).isDisabled()
    && await video(page, (v) => !v.getAttribute('src') && v.paused));
  ok('no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();

  // ---- targets on a coarse pointer; a 1000 ms horizon ----
  {
    const h2 = makeHub(cat, { horizonMs: 1000 });
    h2.values[CH.config + ':window_min'] = 0;
    h2.values[CH.config + ':window_max'] = 100;
    h2.values[CH.motion + ':pos_10um'] = 15;
    const { ctx: c2, page: p2 } = await open({ cat, hub: h2, coarse: true });
    await toCard(p2);
    await loadClip(p2);
    const small = await p2.evaluate((c) => [...document.querySelectorAll(c + ' :is(button, input:not([type=file]), select, [role=slider])')]
      .map((e) => [e.className || e.getAttribute('aria-label') || e.tagName, e.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.width < 39.5 || r.height < 39.5)).map(([n, r]) => n + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)), C);
    ok('targets: every control is at least 40 px under a coarse pointer (law 12)', small.length === 0, small);
    await p2.locator(C + ' .fsp-tr').evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const stolen = await p2.evaluate((c) => [...document.querySelectorAll(c + ' .fsp-tr > button')].filter((b) => b.getClientRects().length && !b.disabled).map((b) => {
      const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + 2);
      return t && b.contains(t) ? null : b.className + ' under ' + (t ? t.className || t.tagName : 'nothing');
    }).filter(Boolean), C);
    ok('targets: nothing steals a touch from the bar\'s buttons (the split bar, the heat\'s hit band)', stolen.length === 0, stolen);
    // The box is not the target where a parent clips it: probe what a touch actually hits.
    // The hover bar's seek is a slider only while the bar shows: a pointer move shows it.
    const hits = await p2.evaluate((c) => [...document.querySelectorAll(c + ' [role=slider]')].filter((e) => e.getClientRects().length).map((e) => {
      e.scrollIntoView({ block: 'center' });
      document.querySelector(c + ' .fsp-stage').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }));
      const r = e.getBoundingClientRect();
      let n = 0, hit = 0;
      for (let y = r.top + 1; y < r.bottom; y += 2) for (let x = r.left + 1; x < r.right; x += 2) {
        n++;
        if (e.contains(document.elementFromPoint(x, y))) hit++;
      }
      return { name: e.getAttribute('aria-label'), share: Math.round((hit / n) * 100) };
    }), C);
    ok('targets: every slider takes touches over at least 85 % of its box', hits.length >= 3 && hits.every((x) => x.share >= 85), hits);
    await playBtn(p2).click();
    await p2.waitForTimeout(3000);
    await playBtn(p2).click();
    const ahead = h2.segs().filter((x) => !clipped(x)).map((x) => (x.exec - x.arrival) / 1000);
    ok('horizon 1000: every start within 500 ms of its arrival, the lead widened past 250',
      ahead.length > 3 && ahead.every((a) => a <= 502) && Math.max(...ahead) > 250, { n: ahead.length, max: Math.max(...ahead) });
    clearInterval(h2.timer);
    await c2.close();
  }

  }

  // ---- stash ----
  console.log('(e) Stash' + (STASH_LIVE ? ' live' : ''));
  {
    const stash = STASH_LIVE ? { url: STASH_LIVE.base.replace(/\/+$/, ''), seen: null, close: async () => {} }
      : await startFakeStash({ key: KEY, video: VIDEO });
    const SK = STASH_LIVE ? STASH_LIVE.apiKey : KEY;
    const hide = (t) => String(t).split(SK).join('***');
    const h3 = makeHub(cat);
    const { ctx: c3, page: p3 } = await open({ cat, hub: h3 });
    await toCard(p3);
    const libTab = p3.locator(C + ' .fsp-tab', { hasText: 'Library' });
    if (await libTab.isVisible()) await libTab.click();
    const url = p3.locator(C + ' .fsp-connect input[type=url]');
    ok('stash: with no base the connect card fills the library', await url.isVisible().catch(() => false));
    await url.fill(stash.url);
    await p3.locator(C + ' .fsp-connect input[type=password]').fill(SK);
    await p3.locator(C + ' .fsp-connect button', { hasText: 'Save' }).click();
    const tiles = await p3.waitForSelector(C + ' .fsp-tile img', { timeout: STASH_LIVE ? 15000 : 5000 }).then(() => true).catch(() => false);
    ok('stash: Save shows interactive tiles', tiles, STASH_LIVE ? await p3.locator(C + ' .fsp-n').textContent() : undefined);
    if (STASH_LIVE) {
      const shots = await p3.waitForFunction((c) => {
        const t = document.querySelectorAll(c + ' .fsp-tile');
        const imgs = [...document.querySelectorAll(c + ' .fsp-tile img')];
        return imgs.length === t.length && imgs.every((i) => i.complete && i.naturalWidth > 0) && t.length;
      }, C, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => 0);
      ok('stash live: every tile on the page shows its screenshot under the CSP', shots > 0, shots + ' tiles; ' + CSP_MEDIA);
    }
    await p3.waitForTimeout(300);
    const ssp = await spill(p3);
    ok('stash: the grid and its pager lie inside the card, no label cut', ssp.out.length === 0 && ssp.cut.length === 0, ssp);
    if (SHOT) { await p3.waitForTimeout(500); await p3.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'stash-grid.png') }); }
    const src = await p3.locator(C + ' .fsp-tile img').first().getAttribute('src').catch(() => '');
    ok('stash: tile screenshots are rebased and keyed with apikey', src.startsWith(stash.url) && src.includes('apikey=' + SK), hide(src));
    if (stash.seen) {
      const gql = stash.seen.find((r) => r.path.startsWith('/graphql'));
      ok('stash: GraphQL carries the ApiKey header', !!gql && gql.headers.apikey === KEY);
    }
    await p3.locator(C + ' .fsp-tile').first().click();
    await p3.waitForTimeout(800);
    if (stash.seen) {
      const fs = stash.seen.find((r) => /\/scene\/\d+\/funscript/.test(r.path));
      ok('stash: a pick fetches the script with the ApiKey header', !!fs && fs.headers.apikey === KEY, fs && fs.headers);
    } else {
      const ready = await p3.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 15000 })
        .then(() => true).catch(() => false);
      ok('stash live: the picked scene script loads and Play wakes', ready, await statusText(p3).catch(() => ''));
    }
    const vsrc = await p3.locator(C + ' .fsp-stage video').getAttribute('src');
    ok('stash: the video streams from the rebased URL with apikey', !!vsrc && vsrc.startsWith(stash.url) && vsrc.includes('apikey=' + SK), hide(vsrc));
    const n3 = h3.bundles.length;
    await playBtn(p3).click();
    const played3 = await video(p3, (v) => new Promise((r) => { const t0 = v.currentTime; setTimeout(() => r(!v.paused && v.currentTime > t0), 3000); }));
    ok('stash: the picked scene plays and drives the hub', played3 && h3.bundles.length > n3 + (STASH_LIVE ? 0 : 3), { played: played3, bundles: h3.bundles.length - n3 });
    if (STASH_LIVE) {
      // A real script may open on one long span; the middle carries strokes.
      const n4 = h3.bundles.length;
      const mid = await video(p3, (v) => new Promise((r) => { v.currentTime = v.duration / 2; const t0 = v.currentTime;
        setTimeout(() => r({ playing: !v.paused && v.currentTime > t0, t: Math.round(v.currentTime) }), 3000); }));
      ok('stash live: a seek to the middle plays on and keeps the hub fed', mid.playing && h3.bundles.length > n4 + 3,
        { ...mid, bundles: h3.bundles.length - n4 });
    }
    await playBtn(p3).click();
    const cur = () => p3.locator(C + ' .fsp-tile').evaluateAll((t) => t.findIndex((e) => e.getAttribute('aria-current') === 'true'));
    const i0 = await cur();
    await p3.locator(C + ' .fsp-next').evaluate((e) => e.click());
    await p3.waitForTimeout(300);
    const i1 = await cur();
    await p3.locator(C + ' .fsp-prev').evaluate((e) => e.click());
    await p3.waitForTimeout(300);
    const i2 = await cur();
    ok('transport: next and prev walk the library list', i0 === 0 && i1 === 1 && i2 === 0, [i0, i1, i2]);
    ok('stash: the key never sits in the backup prefix', !(await p3.evaluate((sk) => Object.keys(localStorage)
      .some((k) => k.startsWith('phosphor.') && localStorage.getItem(k).includes(sk)), SK)));
    clearInterval(h3.timer);
    await c3.close();
    await stash.close();
  }
}

// ---- (g) the analyzer on the tuning fixture: playhead, expand, Live and Preview writes, the notice ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(g) analyzer');
  const tc = tuningCatalog();
  tc.entries = decodeCatalog(tc.bytes);
  const groups = mods[P + 'analyzer.js'].tuningGroups(buildSettingsModel(tc.entries));
  const hub = makeHub(tc);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  hub.values[CH.motion + ':pos_10um'] = 15;
  Object.assign(hub.values, KIN_VALUES);
  const { ctx, page, up, errors } = await open({ cat: tc, hub, coarse: true });
  ok('analyzer: the shell adopts the tuning fixture and the card renders', up && await toCard(page, 'main.pane .fsp', true));
  ok('analyzer: the clip loads', await loadClip(page));
  // ---- playhead ----
  await video(page, (v) => { v.currentTime = 15; });
  await page.waitForTimeout(400);
  const bar = await page.evaluate((c) => {
    const q = (s) => document.querySelector(c + ' ' + s).getBoundingClientRect();
    const ph = q('.fsp-ph'), dt = q('.fsp-dt'), ov = q('.fsp-ov'), sc = q('.fsp-scrub');
    const tr = q('.fsp-tr');
    return { top: ph.top - dt.top, bottom: ph.bottom - dt.bottom, share: (ph.left + ph.width / 2 - dt.left) / dt.width,
      grip: (sc.left + sc.width / 2 - ov.left) / ov.width, heatInRow: ov.top >= tr.top - 1 && ov.bottom <= tr.bottom + 1 };
  }, C);
  ok('playhead: one bar through the detail\'s height, the heat in the transport row', Math.abs(bar.top) <= 2 && Math.abs(bar.bottom) <= 2 && bar.heatInRow, bar);
  ok('playhead: at 15 s the bar and the heat\'s grip sit at that share of the script',
    Math.abs(bar.share - 15000 / ACTIONS[ACTIONS.length - 1].at) < 0.01 && Math.abs(bar.grip - bar.share) < 0.01, bar);
  // ---- expand ----
  // Rects relative to the card: a click or a scrollIntoView may scroll the page.
  const look = () => page.locator(C).evaluate((e) => {
    const o = e.getBoundingClientRect();
    const r = (s) => { const x = e.querySelector(s); if (!x || !x.getClientRects().length) return null;
      const b = x.getBoundingClientRect(); return { x: b.x - o.x, y: b.y - o.y, width: b.width, height: b.height }; };
    return { card: o.width + 'x' + o.height, stage: r('.fsp-stage'), an: r('.fsa'), lib: r('.fsp-libbox'),
      video: !!e.querySelector('.fsp-stage video'), dt: r('.fsp-dt') };
  });
  const before = await look();
  const expandBtn = page.locator(C + ' .fsp-expand');
  await expandBtn.click();
  await page.waitForTimeout(300);
  const open1 = await look();
  ok('expand: the outer card rect is identical', open1.card === before.card, [before.card, open1.card]);
  ok('expand: the video moves to a thumbnail over the analyzer column (two fifths of the card), the analyzer in, the library out, the detail taller',
    open1.video && open1.stage.width >= 319 && Math.abs(open1.stage.width - open1.an.width) <= 1 && open1.an.width >= Math.min(559, 0.38 * parseFloat(open1.card))
      && open1.stage.height <= 181 && !!open1.an && open1.an.height > 150 && !open1.lib
      && open1.dt.height > before.dt.height, open1);
  ok('expand: the button reads pressed', (await expandBtn.getAttribute('aria-pressed')) === 'true');
  await page.locator(C).focus();
  await page.keyboard.press('g');
  await page.waitForTimeout(300);
  const gOff = await page.locator(C + '[data-an]').count();
  await page.keyboard.press('g');
  await page.waitForTimeout(300);
  ok('expand: g toggles the analyzer both ways', gOff === 0 && (await page.locator(C + '[data-an]').count()) === 1, gOff);
  await page.locator(C + ' .fsp-off input').focus();
  await page.keyboard.press('g');
  await page.waitForTimeout(200);
  ok('expand: g typed in the Offset field is ignored', (await page.locator(C + '[data-an]').count()) === 1);
  if (SHOT) await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'analyzer.png') });
  const labels = await page.$$eval(C + ' .fsa-row .fsa-k', (els) => els.map((e) => e.textContent));
  ok('analyzer: one row per tuning control the catalog groups', labels.length === groups.flatMap((g) => g.fields).length,
    { rows: labels.length, fields: groups.flatMap((g) => g.fields).length });
  const small = await page.evaluate((c) => [...document.querySelectorAll(c + ' .fsa :is(button, input, select), ' + c + ' .fsp-expand')]
    .map((e) => [e.textContent || e.getAttribute('aria-label') || e.tagName, e.getBoundingClientRect()])
    .filter(([, r]) => r.width > 0 && (r.width < 39.5 || r.height < 39.5)).map(([n, r]) => n + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)), C);
  ok('analyzer: every control is at least 40 px under a coarse pointer (law 12)', small.length === 0, small);
  const outside = await page.evaluate((c) => {
    const card = document.querySelector(c).getBoundingClientRect(), list = document.querySelector(c + ' .fsa-list').getBoundingClientRect();
    return [...document.querySelectorAll(c + ' .fsa :is(button, input, select, output)')].filter((e) => {
      const r = e.getBoundingClientRect(), box = e.closest('.fsa-list') ? list : card;
      return r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5 || (box === card && (r.top < card.top - 0.5 || r.bottom > card.bottom + 0.5)));
    }).map((e) => e.textContent || e.getAttribute('aria-label'));
  }, C);
  ok('analyzer: every control lies inside the card, rows inside their list', outside.length === 0, outside);
  // ---- writes ----
  const slider = groups.flatMap((g) => g.fields).find((f) => f.widget === 'slider');
  const nudge = async () => {
    const i = page.locator(C + ' .fsa-row input[type=range]').first();
    await i.scrollIntoViewIfNeeded();
    await i.focus();
    await i.press('ArrowRight');
    await page.waitForTimeout(400);
    return hub.intents.filter((x) => x.ch !== CH_TRIAL).at(-1);
  };
  const modeBtn = (t) => page.locator(C + ' .fsa-head .fsp-btn', { hasText: new RegExp('^' + t + '$') });
  const aRects = () => page.evaluate((c) => [...document.querySelectorAll(c + ' .fsa > *, ' + c + ' .fsa-head > *, ' + c + ' > :not(style)')]
    .filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(), o = document.querySelector(c).getBoundingClientRect();
      return [r.x - o.x, r.y - o.y, r.width, r.height].map(Math.round).join(','); }), C);
  ok('modes: Preview is the default on a trial-capable hub', (await modeBtn('Preview').getAttribute('aria-pressed')) === 'true');
  await modeBtn('Live').click();
  const r0 = await aRects();
  const live = await nudge();
  ok('Live: a tuning write reaches api.write: a durable INTENT on the field\'s write channel',
    !!live && live.ch === slider.writeChannel && live.trial === false && slider.settingKey in live.value, live);
  await modeBtn('Preview').click();
  const n0 = hub.intents.length;
  const prev = await nudge();
  ok('Preview: a tuning write reaches writeTrial: the same INTENT with trial', hub.intents.length > n0 && !!prev
    && prev.ch === slider.writeChannel && prev.trial === true, prev);
  const notice = await page.waitForFunction((c) => document.querySelector(c + ' > .fsp-slot').textContent === 'Preview: not saved', C, { timeout: 2000 })
    .then(() => true).catch(() => false);
  ok('Preview: the notice stands in the status slot while trialPending', notice, await statusText(page));
  ok('Preview: Apply and Discard are offered', !(await modeBtn('Apply').isDisabled()) && !(await modeBtn('Discard').isDisabled()));
  const r1 = await aRects();
  ok('layout: Live, Preview and a pending trial share every rect', JSON.stringify(r0) === JSON.stringify(r1), r0.filter((x, i) => x !== r1[i]));
  await modeBtn('Apply').click();
  await page.waitForTimeout(400);
  const commit = hub.intents.at(-1);
  ok('Apply commits: settings-trial op 1', !!commit && commit.ch === CH_TRIAL && commit.value[1] === 1, commit);
  ok('Apply: the notice clears with the mark', (await statusText(page)) !== 'Preview: not saved', await statusText(page));
  await nudge();
  await page.waitForTimeout(300);
  ok('Preview: a second trial raises the notice again', (await statusText(page)) === 'Preview: not saved', await statusText(page));
  await modeBtn('Discard').click();
  await page.waitForTimeout(400);
  const revert = hub.intents.at(-1);
  ok('Discard reverts: settings-trial op 2, the notice clears', !!revert && revert.ch === CH_TRIAL && revert.value[1] === 2
    && (await statusText(page)) !== 'Preview: not saved', { revert, slot: await statusText(page) });
  // ---- Kinetic: the machine's own planner renders the preview in a worker ----
  const kinRead = () => page.evaluate((c) => { const o = document.querySelector(c + ' .fsa-kin');
    return { text: o.textContent, tip: o.title, pts: document.querySelector(c + ' .fsp-dt .int[data-kin]')?.getAttribute('points') || '' }; }, C);
  const kinUp = await page.waitForFunction((c) => /^Kinetic: wasm {2}\d+ anomalies/.test(document.querySelector(c + ' .fsa-kin').textContent)
    && (document.querySelector(c + ' .fsp-dt .int[data-kin]')?.getAttribute('points') || '').split(' ').length > 50, C, { timeout: 10000 }).then(() => true, () => false);
  const k0 = await kinRead();
  ok('Kinetic: the analyzer renders through kinetic.wasm in a worker: the status word, the flag readouts, the intent curve in the detail',
    kinUp && /^nucleus [0-9a-f]{12} kinetic2 /.test(k0.tip), k0.text + ' | ' + k0.tip.replace(/\n/g, ', '));
  const shot = async (name) => {
    if (!SHOT) return;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator(C).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT.replace(/[^/\\]+$/, name) });
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  await shot('analyzer-kinetic.png');
  const nK = hub.intents.length;
  const speedIn = (v, ev) => page.evaluate(([c, v, ev]) => {
    const row = [...document.querySelectorAll(c + ' .fsa-row')].find((r) => r.querySelector('.fsa-k').textContent === 'Input speed');
    const i = row.querySelector('input[type=range]');
    const was = i.value;
    i.value = String(v);
    for (const e of ev) i.dispatchEvent(new Event(e, { bubbles: true }));
    return was;
  }, [C, v, ev]);
  const speedWas = await speedIn(100, ['input']);
  const kinRe = await page.waitForFunction(([c, p]) => (document.querySelector(c + ' .fsp-dt .int').getAttribute('points') || '') !== p, [C, k0.pts], { timeout: 10000 })
    .then(() => true, () => false);
  await page.waitForTimeout(300);
  const k1 = await kinRead();
  ok('Kinetic: a tuning drag (Input speed 100 mm/s, nothing written yet) re-renders through the planner',
    kinRe && k1.text !== k0.text && hub.intents.length === nK, [k0.text, k1.text, hub.intents.length - nK]);
  await shot('analyzer-kinetic-retuned.png');
  await speedIn(speedWas, ['input', 'change']);
  await page.waitForTimeout(300);
  await modeBtn('Discard').click();
  await page.waitForTimeout(400);
  // ---- handheld: the same card rect open or shut, the thumbnail in the source row ----
  // The page composes by the window's class (PR1): a portrait phone window gives it the handheld card.
  // The class change remounts the page (viewport.svelte.js), so the analyzer starts shut there.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForTimeout(600);
  const hShut = await look();
  await expandBtn.click();
  await page.waitForTimeout(300);
  const hOpen = await look();
  await expandBtn.click();
  await page.waitForTimeout(300);
  ok('handheld: the outer card rect is identical open or shut, the thumbnail one tap high, the analyzer in',
    hOpen.card === hShut.card && hOpen.stage.height <= 50 && !!hOpen.an && hOpen.an.height > 100 && hOpen.dt.height > 40, { hOpen, hShut });
  if (SHOT) await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'analyzer-handheld.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(600);
  // ---- collapse ----
  if (await page.locator(C + '[data-an]').count()) await expandBtn.click();
  await page.waitForTimeout(300);
  const shut = await look();
  ok('collapse: the card, the stage and the library come back as they were',
    shut.card === before.card && JSON.stringify(shut.stage) === JSON.stringify(before.stage) && !shut.an && !!shut.lib, shut);
  ok('analyzer: no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (k) Kinetic under the shell's CSP: the worker, a 60 s render at 1 ms, supersede, the fallback ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(k) Kinetic and the CSP');
  const scriptSrc = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
    .app.security.csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
  const PLUG = new URL('../plugins/factory/funscript-player/', import.meta.url);
  const PROBE = `import { createKinetic, segmentsOf } from '/p/kinetic/kinetic.js';
    import { parseFunscript } from '/p/funscript.js';
    const actions = [];
    for (let at = 0, k = 0; at <= 60000; at += 250 + (k * 37) % 300, k++) actions.push({ at, pos: k % 2 ? 90 : 10 });
    const sg = segmentsOf(parseFunscript({ actions }), { offsetMs: 0, lo: 0, hi: 1, invert: false });
    const q = { limits: { vmax: 1000, amax: 50000, jmax: 2e6, rail: 500 }, window: [100, 400], tuning: [], segs: sg.segs, steps: 60000, stepMs: 1, every: 1 };
    try {
      const kin = createKinetic();
      const version = await kin.ready;
      const first = kin.render(q), t = performance.now(), r = await kin.render(q);
      window.__k = { version, superseded: (await first) === null, wall: performance.now() - t, ms: r.ms, n: r.pos.length, plans: r.plans };
    } catch (e) { window.__k = { error: String(e && e.message || e) }; }`;
  const probe = async (src) => {
    const ctx = await browser.newContext();
    await ctx.route('http://kinetic.test/**', (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/') return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': src },
        body: '<!doctype html><script type="module" src="/probe.js"></script>' });
      if (p === '/probe.js') return route.fulfill({ contentType: 'text/javascript', body: PROBE });
      return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL(p.slice(3), PLUG)) });
    });
    const page = await ctx.newPage();
    await page.goto('http://kinetic.test/');
    const r = await page.waitForFunction(() => window.__k, null, { timeout: 30000 }).then((h) => h.jsonValue(), () => null);
    await ctx.close();
    return r;
  };
  const allowed = await probe(scriptSrc);
  ok('CSP: under the shell\'s script-src the blob worker compiles kinetic.wasm and renders 60 s at 1 ms, a newer render superseding',
    !!allowed && !allowed.error && allowed.n === 60000 && allowed.superseded && allowed.plans > 100, allowed);
  if (allowed && allowed.ms != null) console.log('  [NOTE] 60 s at 1 ms in the worker: ' + allowed.ms.toFixed(1) + ' ms (' + allowed.wall.toFixed(1) + ' ms to the page)');
  const refused = await probe(scriptSrc.replace(" 'wasm-unsafe-eval'", ''));
  ok('CSP: without \'wasm-unsafe-eval\' the compile is refused (the source is load-bearing)', !!refused && !!refused.error, refused);
  // The shell's inline module script stands in for Tauri's hashed one with 'unsafe-inline'.
  const tc = tuningCatalog();
  tc.entries = decodeCatalog(tc.bytes);
  const hub = makeHub(tc);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  Object.assign(hub.values, KIN_VALUES);
  const csp = "script-src 'self' 'unsafe-inline' blob:";
  const { ctx, page, up, errors } = await open({ cat: tc, hub, onPage: (p) => p.route(PAGE + '/', (r) => r.fulfill({ status: 200,
    contentType: 'text/html', headers: { 'Content-Security-Policy': csp }, body: SHELL })) });
  ok('fallback: the shell loads under a CSP without \'wasm-unsafe-eval\'', up && await toCard(page) && await loadClip(page));
  await page.locator(C + ' .fsp-expand').click();
  const fb = await page.waitForFunction((c) => document.querySelector(c + ' .fsa-kin').textContent === 'Kinetic: fallback', C, { timeout: 10000 })
    .then(() => true, () => false);
  const fbPts = await page.locator(C + ' .fsp-dt .int[data-kin]').count();
  const fbInt = await page.locator(C + ' .fsp-dt .int').getAttribute('points');
  ok('fallback: the analyzer says Kinetic: fallback; the intent curve is straight lines between the actions, no render', fb && !fbPts && !!fbInt, { fb, fbPts });
  ok('fallback: no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (v) the planner's curve, the speed heat and Scale (ph-rsb5, ph-6e36, ph-1qs5.1): the real-shaped script ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(v) planner curve, speed heat, Scale');
  const tc = tuningCatalog();
  tc.entries = decodeCatalog(tc.bytes);
  const hub = makeHub(tc);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  Object.assign(hub.values, KIN_VALUES);
  const { ctx, page, up, errors } = await open({ cat: tc, hub, width: 1280, prefs: { 'phosphor.funscript.interp': { mode: 'makima', scaleAuto: false } } });
  await page.setViewportSize({ width: 1280, height: 800 });
  const onPage = up && await page.click('[data-tab-id="plugin:funscript-player:player"]').then(() => page.waitForSelector(C, { timeout: 5000 }))
    .then(() => true, () => false);
  ok('visuals: the page mounts the card and the real-shaped clip loads', onPage && await loadClip(page, REAL_SCRIPT));
  await page.locator(C + ' .fsp-expand').click();
  const kinText = () => page.evaluate((c) => document.querySelector(c + ' .fsa-kin').textContent, C);
  const rendered = await page.waitForFunction((c) => /^Kinetic: wasm {2}\d+ anomalies/.test(document.querySelector(c + ' .fsa-kin').textContent)
    && (document.querySelector(c + ' .fsp-dt .int[data-kin]')?.getAttribute('points') || '').split(' ').length > 50, C, { timeout: 10000 }).then(() => true, () => false);
  await video(page, (v) => { v.currentTime = 7.5; });
  await page.waitForTimeout(600);
  if (SHOT) {
    await page.screenshot({ path: SHOT.replace(/[^/\\]+$/, 'v-analyzer-1280x800.png') });
    await page.locator(C + ' .fsp-tlbox').screenshot({ path: SHOT.replace(/[^/\\]+$/, 'v-timeline.png') });
  }
  // ---- A: the planner's render is the intent curve (--intent), the actions its dots, the readout carries the swatch ----
  const col = await page.evaluate((c) => {
    const q = (s) => document.querySelector(c + ' ' + s);
    const tok = (v) => { const i = document.createElement('i'); i.style.color = v; document.body.append(i); const x = getComputedStyle(i).color; i.remove(); return x; };
    return { int: getComputedStyle(q('.fsp-dt .int[data-kin]')).stroke, dots: getComputedStyle(q('.fsp-dt .dots')).stroke,
      nDots: (q('.fsp-dt .dots').getAttribute('d').match(/M/g) || []).length,
      swatch: getComputedStyle(q('.fsa-kin'), '::before').backgroundColor, intent: tok('var(--intent)') };
  }, C);
  ok('A: the Kinetic render is the intent curve (--intent), the actions are --intent dots, the Kinetic readout carries the --intent swatch (the legend)',
    rendered && col.int === col.intent && col.dots === col.intent && col.nDots > 5 && col.swatch === col.intent, col);
  // ---- B: one hard-edged color run per action span, dark to --reality to --highlight, no red ----
  const fsm = mods[P + 'funscript.js'], tlm = mods[P + 'timeline.js'];
  const want = tlm.heatStops ? tlm.heatStops(fsm.parseFunscript(REAL_SCRIPT), { offsetMs: 0, lo: 0, hi: 1, invert: false }) : [];
  const band = await page.evaluate((c) => {
    const px = (v) => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d');
      x.fillStyle = v; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const tok = (v) => { const i = document.createElement('i'); i.style.color = v; document.body.append(i); const x = getComputedStyle(i).color; i.remove(); return px(x); };
    return { stops: [...document.querySelectorAll(c + ' .fsp-ov linearGradient stop')].map((s) => [+s.getAttribute('offset'), px(getComputedStyle(s).stopColor)]),
      highlight: tok('var(--highlight)') };
  }, C);
  const st = band.stops, pairs = st.length / 2;
  const hard = st.every((s, i) => (i % 2 ? i + 1 >= st.length || Math.abs(st[i + 1][0] - s[0]) < 1e-6 : same(st[i + 1] && st[i + 1][1], s[1])));
  const top = want.length ? want.reduce((a, b, i) => (b.ups > want[a].ups ? i : a), 0) : -1;
  const topRgb = top >= 0 && st[2 * top] ? st[2 * top][1] : [255, 0, 0];
  ok('B: the heat is one gradient run per action span (consecutive equal colors merged), hard edges, no blur across actions',
    want.length > 20 && pairs === want.length && hard, { pairs, want: want.length, hard });
  // Law 13 reserves the red HUE (about 345..15 degrees) for hazards; a pink or
  // magenta highlight has a dominant red channel and is not red.
  const hue = ([r, g, b]) => { const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m; if (!d) return -1;
    const h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; return ((h * 60) + 360) % 360; };
  const topHue = hue(topRgb);
  ok('B: the fastest span reads --highlight and its hue is never the hazard red (law 13)',
    !(topHue >= 345 || (topHue >= 0 && topHue <= 15)) && topRgb.every((v, i) => Math.abs(v - band.highlight[i]) <= 2), { top: topRgb, hue: topHue, highlight: band.highlight, ups: want[top] && want[top].ups });
  // ---- C: Auto measures the planner's own render of the knots; the saved curve pref loaded as Scale only ----
  // Reversals and hold edges go at rest (FUNSCRIPT.md I8, ph-hcof), so 0 and 1 land exactly.
  await page.click(C + ' .fsp-set');
  await page.waitForTimeout(200);
  const autoBtn = page.locator('main.pane .fsp-psec .fsp-scale button[aria-label="Auto"]');
  await autoBtn.click({ timeout: 3000 }).catch(() => {});
  const fit = await page.waitForFunction((c) => {
    const o = document.querySelector('main.pane .fsp-psec .fsp-scale .fsp-gain'), t = document.querySelector(c + ' .fsa-kin').textContent;
    return o && /^0\.00–1\.00$/.test(o.textContent) && /^Kinetic: wasm {2}\d+ anomalies/.test(t) && !/ clamped [1-9]\d+ ms/.test(t);
  }, C, { timeout: 15000 }).then(() => true, () => false);
  const readout = await page.locator('main.pane .fsp-psec .fsp-scale .fsp-gain').textContent({ timeout: 1000 }).catch(() => '');
  console.log('  [NOTE] Auto on the real-shaped script: ' + readout + ' (' + await kinText() + ')');
  // A rest landing on the window edge reads f32 noise (1e-7) as clamped for a few ms.
  ok('C: Auto reads where 0 and 1 land from the planner render exactly, clamped under 10 ms (reversals at rest, the twin smoothness)', fit, readout);
  const fits = await page.evaluate(() => { const o = document.querySelector('main.pane .fsp-psec .fsp-scale .fsp-gain'), r = o.getBoundingClientRect(),
    g = o.closest('.fsp-scale').getBoundingClientRect(); return { sw: o.scrollWidth, cw: o.clientWidth, right: r.right, gr: g.right }; });
  ok('C: the Auto readout fits its cell', fits.sw <= fits.cw + 1 && fits.right <= fits.gr + 0.5, fits);
  ok('C: the card carries no curve controls', await page.locator('main.pane .fsp-psec select, main.pane .fsp-psec input[aria-label="Smoothing"]').count() === 0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.funscript.interp') || '{}'));
  ok('C: a saved curve pref (mode makima) loaded; Auto persists as Scale only (phosphor.funscript.interp)', same(stored, { scale: 1, scaleAuto: true }), stored);
  if (SHOT) {
    await page.screenshot({ path: SHOT.replace(/[^/\\]+$/, 'v-auto-1280x800.png') });
    await page.locator('main.pane .fsp-psec .fsp-scale').screenshot({ path: SHOT.replace(/[^/\\]+$/, 'v-scale-row.png') }).catch(() => {});
  }
  // ---- D: the hub's smoothness reaches the twin: smoothness at the analyzer row's top (a drag: rendered, never written) re-renders ----
  // Kinetic² renders a reversal flat at every smoothness, so a top-only tease no longer overshoots; Auto stays 0.00–1.00 there.
  const pts = () => page.evaluate((c) => document.querySelector(c + ' .fsp-dt .int[data-kin]')?.getAttribute('points') || '', C);
  const p0 = await pts(), nW = hub.intents.length;
  const smoothed = await page.evaluate((c) => {
    const row = [...document.querySelectorAll(c + ' .fsa-row')].find((r) => r.querySelector('.fsa-k').textContent === 'Smoothness');
    const i = row && row.querySelector('input[type=range]');
    if (!i) return null;
    const was = i.value;
    i.value = i.max;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return [was, i.value];
  }, C);
  const reSmooth = await page.waitForFunction(([c, p]) => (document.querySelector(c + ' .fsp-dt .int[data-kin]')?.getAttribute('points') || '') !== p, [C, p0], { timeout: 10000 })
    .then(() => true, () => false);
  // ponytail: >= 0.95: the f32 step (0.05000000074) snaps the range's top to 0.95 (bd ph-y3mg note).
  ok('D: smoothness at its top re-renders the twin, nothing written', !!smoothed && +smoothed[1] >= 0.95 && reSmooth && hub.intents.length === nW, smoothed);
  ok('visuals: no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (h) playback wiring: the A-B loop wraps with no hold and the schedule tiles across the seam ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(h) playback');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  const hub = makeHub(cat);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  hub.values[CH.motion + ':pos_10um'] = 15;
  Object.assign(hub.values, KIN_VALUES);
  const { ctx, page, up, errors } = await open({ cat, hub });
  ok('playback: the card renders and the clip loads', up && await toCard(page) && await loadClip(page));
  await playBtn(page).click();
  await page.waitForTimeout(2500);
  const ab = page.locator(C + ' .fsp-ab');
  ok('A-B: the first press reads Set loop start', (await ab.getAttribute('title')) === 'Set loop start');
  await ab.click();
  await page.waitForTimeout(3000);
  await ab.click();
  const n0 = hub.bundles.length;

  ok('A-B: the second press starts the loop, the button pressed and reading Clear loop',
    (await ab.getAttribute('aria-pressed')) === 'true' && (await ab.getAttribute('title')) === 'Clear loop');
  const band = await page.locator(C + ' .fsp-ov rect.ab').evaluate((r) => +r.getAttribute('width'));
  ok('A-B: the section is a band on the heat', band > 0, band);
  await page.waitForTimeout(7000);
  const wraps = await page.evaluate(() => (window.__funscriptProbe || []).filter((x) => x.k === 'mark' && x.name === 'wrap').length);
  const vt = await video(page, (v) => ({ t: v.currentTime, paused: v.paused }));
  ok('loop: the video wrapped at least twice and plays inside the section', wraps >= 2 && !vt.paused && vt.t >= 2 && vt.t <= 6, { wraps, vt });
  const after = hub.bundles.slice(n0 + 2);
  const holds = after.filter((b) => b.segs.length === 1 && b.segs[0].dur <= 200 && clipped(b.segs[0]));
  ok('loop: no hold at a wrap', holds.length === 0, holds.length);
  const sched = schedule(after).filter((x) => x.exec < hubUs() - 300000);
  // A clock step on a wrap's landing frame restarts: its first start is clipped to now, inside the previous span (a cut, not a hole).
  const d = sched.slice(1).map((x, i) => (x.exec - (sched[i].exec + sched[i].dur * 1000)) / 1000);
  const holes = d.filter((g) => g > 30);
  ok('loop: no hole in the schedule across any seam (none past 30 ms)', sched.length > 10 && holes.length === 0,
    { n: sched.length, holes, cuts: d.filter((g) => g < -2).map(Math.round) });
  if (SHOT) await page.locator(C + ' .fsp-tlbox').screenshot({ path: SHOT.replace(/[^/\\]+$/, 'timeline-ab.png') });
  await ab.click();
  await page.waitForTimeout(300);
  ok('A-B: the third press clears it', (await ab.getAttribute('aria-pressed')) === 'false' && (await ab.getAttribute('title')) === 'Set loop start'
    && await page.locator(C + ' .fsp-ov rect.ab').evaluate((r) => +r.getAttribute('width')) === 0);
  ok('playback: no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (s) the page's Settings section: the registerSettings card, prefs shared with the Plugins pane, open remembered ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(s) page settings');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  const hub = makeHub(cat);
  const { ctx, page, up, errors } = await open({ cat, hub, width: 1280 });
  await page.setViewportSize({ width: 1280, height: 800 });
  const TAB = '[data-tab-id="plugin:funscript-player:player"]', SUM = C + ' .fsp-set';
  const toPage = () => page.click(TAB).then(() => page.waitForSelector(C, { timeout: 5000 })).then(() => true).catch(() => false);
  const rows = () => page.evaluate(() => ['.fsp-connect', '.fsp-scale', '.fsp-pset'].map((s) => document.querySelectorAll('main.pane .fsp-page > .fsp-psec ' + s).length));
  const cardBox = () => page.locator(C).evaluate((e) => { const r = e.getBoundingClientRect(); return [r.top - e.closest('.pane-main').getBoundingClientRect().top, r.height].map(Math.round); });
  // The viewport, and the whole page region (card and section) on a viewport tall enough to hold it.
  const pageShot = async (name) => {
    if (!SHOTS) return;
    await page.screenshot({ path: join(SHOTS, name + '.png') });
    const vp = page.viewportSize();
    const tall = await page.locator('main.pane .fsp-page').evaluate((e) => Math.ceil(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: vp.width, height: vp.height + tall });
    await page.waitForTimeout(300);
    await page.locator('main.pane .fsp-page').screenshot({ path: join(SHOTS, name + '-region.png') });
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);
  };
  ok('page settings: the page mounts the card', up && await toPage());
  await page.waitForSelector(C + ' [data-search-key="openVideo"]', { state: 'attached', timeout: 5000 }).catch(() => {});
  const skeys = await page.$$eval(C + ' [data-search-key]', (els) => els.map((e) => e.dataset.searchKey).sort());
  ok('search: the page lists motion, offset, invert, Open video, Open script, graph and split, each on a control',
    skeys.join() === 'graph,invert,motion,offset,openScript,openVideo,split', skeys);
  await page.keyboard.press('F3');
  await page.keyboard.type('Offset');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  ok('search: F3 Offset lands on the Offset field, focused', await page.evaluate((c) => document.activeElement === document.querySelector(c + ' .fsp-off input'), C));
  for (const [label, k] of [['Invert', 'invert'], ['Split', 'split'], ['Graph', 'graph'], ['Funscript Motion', 'motion'], ['Open video', 'openVideo'], ['Open script', 'openScript']]) {
    await page.keyboard.press('F3');
    await page.keyboard.type(label);
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    ok('search: F3 ' + k + ' then Enter, focus lands on that control (not BODY)', await page.evaluate(([c, key]) => { const a = document.activeElement, t = document.querySelector(c + ' [data-search-key="' + key + '"]'); return !!t && a !== document.body && (a === t || t.contains(a)); }, [C, k]), await page.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className));
  }
  ok('page settings: closed by default, one Settings button, nothing mounted',
    (await page.locator(SUM).getAttribute('title')) === 'Settings' && same(await rows(), [0, 0, 0]), await rows());
  await pageShot('page-settings-closed-1280x800');
  const before = await cardBox();
  const stageH = () => page.locator(C + ' .fsp-stage').evaluate((e) => Math.round(e.getBoundingClientRect().height));
  const stage0 = await stageH();
  await page.click(SUM);
  await page.waitForTimeout(200);
  ok('page settings: Settings mounts the plugin settings card (connect, curve, playback)', same(await rows(), [1, 1, 1]), await rows());
  const after = await cardBox();
  const sec = await page.evaluate((c) => { const s = document.querySelector('main.pane .fsp-psec'), k = document.querySelector(c).getBoundingClientRect(), r = s.getBoundingClientRect();
    return { beside: r.left >= k.right - 330 && r.right <= k.right + 1 && r.width <= 330, comp: document.querySelector(c).dataset.comp, h: s.clientHeight, page: s.parentElement.clientHeight, scrolls: s.scrollHeight > s.clientHeight + 1 }; }, C);
  ok('page settings: the card keeps its top, height and composition; the section overlays the library column, scrolling within (fill)',
    after[0] === before[0] && after[1] >= before[1] && sec.beside && sec.comp === 'full' && sec.scrolls, { before, after, sec });
  ok('page settings: opening Settings never shrinks the stage', (await stageH()) >= stage0, [stage0, await stageH()]);
  const covered = () => page.evaluate((c) => [...document.querySelector(c).querySelectorAll('button, input:not([type=file]), select, [role=slider]')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.fsp-libbox, .fsp-anbox, .fsp-hov, [hidden]'))
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.top >= 0 && r.bottom <= innerHeight; })
    .filter((e) => { const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(t && (e === t || e.contains(t) || t.contains(e))); })
    .map((e) => e.className || e.getAttribute('aria-label') || e.tagName), C);
  ok('page settings: with the library open no card control is covered', same(await covered(), []), await covered());
  await page.click(C + ' .fsp-expand');
  await page.waitForTimeout(400);
  ok('page settings: with the analyzer open the section sits on its column, above the transport; no card control is covered', same(await covered(), []), await covered());
  await page.click(C + ' .fsp-expand');
  await page.waitForTimeout(300);
  await page.click(C + ' .fsp-libcaret');
  await page.waitForTimeout(300);
  ok('page settings: with the library collapsed the section goes below the card; no card control is covered', same(await covered(), []), await covered());
  await page.click(C + ' .fsp-libcaret');
  await page.waitForTimeout(300);
  ok('page settings: open persists as phosphor.funscript.settingsOpen', await page.evaluate(() => localStorage.getItem('phosphor.funscript.settingsOpen')) === 'true');
  await page.locator(SUM).evaluate((e) => e.scrollIntoView());
  await pageShot('page-settings-open-1280x800');
  await page.click('main.pane .fsp-psec .fsp-pset button[aria-label="Loop"]');
  await page.waitForTimeout(100);
  ok('page settings: a change there reaches the store', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.funscript.play') || '{}').loop) === true);
  await page.click('[data-tab-id="plugins"]');
  await page.waitForSelector('.fsp-pset', { timeout: 5000 });
  ok('page settings: the Plugins pane card reads it back', (await page.locator('.fsp-pset button[aria-label="Loop"]').getAttribute('aria-pressed')) === 'true');
  await page.locator('.fsp-pset button[aria-label="Loop"]').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await toPage();
  ok('page settings: open is remembered across a launch, and the pane change reads back here', same(await rows(), [1, 1, 1])
    && (await page.locator('main.pane .fsp-psec .fsp-pset button[aria-label="Loop"]').getAttribute('aria-pressed')) === 'false');
  if (SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await page.locator(SUM).evaluate((e) => e.scrollIntoView());
    await pageShot('page-settings-open-390x844');
    await page.locator(SUM).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => scrollTo(0, 0));
    await pageShot('page-settings-closed-390x844');
  }
  await page.locator(SUM).evaluate((e) => { if (e.getAttribute('aria-pressed') === 'true') e.click(); });
  await page.waitForTimeout(100);
  ok('page settings: closed persists and unmounts the card', same(await rows(), [0, 0, 0])
    && await page.evaluate(() => localStorage.getItem('phosphor.funscript.settingsOpen')) === 'false');
  ok('page settings: no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (u) handheld sizes on a coarse pointer: no horizontal overflow, 40 px targets (ph-cqz6) ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(u) handheld viewports');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  for (const [w, hh] of [[200, 390], [390, 844], [412, 915], [844, 390], [1024, 768]]) {
    const hub = makeHub(cat);
    hub.values[CH.config + ':window_min'] = 0;
    hub.values[CH.config + ':window_max'] = 100;
    const { ctx, page } = await open({ cat, hub, coarse: true, width: w, height: hh });
    const there = await toPluginPage(page);
    ok('handheld ' + w + 'x' + hh + ': the page mounts the card', there);
    if (!there && SHOTS) await page.screenshot({ path: join(SHOTS, 'fail-' + w + 'x' + hh + '.png') });
    if (there) {
      await loadClip(page);
      await page.waitForTimeout(500);
      const m = await page.evaluate((c) => {
        const root = document.querySelector(c), o = root.getBoundingClientRect();
        const hits = [...root.querySelectorAll('button, input:not([type=file]), select, [role=slider]')].filter((e) => e.getClientRects().length
          && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'));
        const small = hits.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 39.5 || r.height < 39.5); })
          .map((e) => (e.className || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
        const wide = [...root.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > o.right + 0.5 || r.left < o.left - 0.5)
          && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.fsp-hov, .fsp-libbox, .fsp-anbox'); }).map((e) => e.className || e.tagName);
        const pg = root.closest('.fsp-page'), de = document.documentElement;
        return { comp: root.dataset.comp, small, wide: wide.slice(0, 5), pageOverflow: pg.scrollWidth - pg.clientWidth, shellOverflow: de.scrollWidth - de.clientWidth, card: [Math.round(o.width), Math.round(o.height)],
          stage: Math.round(root.querySelector('.fsp-stage').getBoundingClientRect().height),
          timeClip: (t => (t && t.getClientRects().length ? t.scrollWidth - t.clientWidth : 0))(root.querySelector('.fsp-time')) };
      }, C);
      ok('handheld ' + w + 'x' + hh + ': no horizontal overflow, in the card or its page', m.wide.length === 0 && m.pageOverflow <= 0 && m.timeClip <= 1, m);
      if (m.comp !== 'glance') ok('handheld ' + w + 'x' + hh + ': the stage keeps 120 px', m.stage >= 119, m);
      ok('handheld ' + w + 'x' + hh + ': every control is at least 40 px', m.small.length === 0, m);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, 'bucket-' + w + 'x' + hh + '.png') });
    }
    clearInterval(hub.timer);
    await ctx.close();
  }
}

// ---- (v) prev and next step the script's chapters; close returns to the library ----
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(v) chapters');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  const hub = makeHub(cat);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  const { ctx, page } = await open({ cat, hub });
  const TAB = '[data-tab-id="plugin:funscript-player:player"]';
  await page.waitForSelector(TAB, { state: 'attached', timeout: 8000 }).catch(() => {});
  await page.evaluate((s) => document.querySelectorAll(s).forEach((e) => e.click()), TAB);
  await page.waitForSelector('main.pane .fsp-page ' + C.replace('main.pane ', ''), { timeout: 5000 }).catch(() => {});
  const chapters = { ...SCRIPT, metadata: { chapters: [{ name: 'a', startTime: '00:00:10.000', endTime: '00:00:20.000' }, { name: 'b', startTime: '00:00:20.000', endTime: '00:00:30.000' }] } };
  ok('chapters: the clip with chapters loads', await loadClip(page, chapters));
  const at = () => video(page, (v) => Math.round(v.currentTime));
  const click = async (cls) => { await page.locator(C + ' .' + cls).evaluate((e) => e.click()); await page.waitForTimeout(500); };
  await click('fsp-next');
  const n1 = await at();
  await click('fsp-next');
  const n2 = await at();
  const nextOff = await page.locator(C + ' .fsp-next').isDisabled();
  await click('fsp-prev');
  const p1 = await at();
  ok('chapters: next goes to 10 s then 20 s, prev back to 10 s; next is off past the last chapter', n1 === 10 && n2 === 20 && p1 === 10 && nextOff, [n1, n2, p1, nextOff]);
  await click('fsp-close');
  ok('chapters: close unloads the media and shows the library', (await statusText(page)) === 'No scene loaded'
    && (await page.locator(C).getAttribute('data-view')) === 'library');
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (m) the hover bar over the video, media fullscreen, the analyzer column (ph-mcfe, ph-tz5t) ----
// The bar acts through the controller: every play(), pause() and currentTime set the video takes
// follows the controller's own probe mark (play, stop, seek; wrap for a loop), never a bar handler.
if (!LIVE && !args.includes('--stash-live')) {
  console.log('(m) hover bar, media fullscreen, analyzer column');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  const hub = makeHub(cat);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  hub.values[CH.motion + ':pos_10um'] = 80;
  const { ctx, page, up, errors } = await open({ cat, hub, width: 1280 });
  await page.setViewportSize({ width: 1280, height: 800 });
  const IDLE = mods[P + 'ui.js'].HOVER_IDLE_MS;
  const TAB = '[data-tab-id="plugin:funscript-player:player"]';
  const toPage = () => page.click(TAB).then(() => page.waitForSelector(C, { timeout: 5000 })).then(() => true).catch(() => false);
  const HOV = C + ' .fsp-hov', HB = C + ' .fsp-hb';
  const shown = () => page.evaluate((s) => document.querySelector(s).hasAttribute('data-show'), HOV);
  const opacity = () => page.evaluate((s) => +getComputedStyle(document.querySelector(s)).opacity, HB);
  const stageBox = () => page.locator(C + ' .fsp-stage').boundingBox();
  const overVideo = async (dx = 0) => { const b = await stageBox(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 3); };
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };
  // Every video call that does not follow the controller's matching mark.
  const direct = () => page.evaluate(() => {
    const r = window.__funscriptProbe || [], want = { play: ['play'], pause: ['stop'], seek: ['seek', 'wrap'] };
    return r.map((x, i) => (x.k === 'vid' && !(r[i - 1] && r[i - 1].k === 'mark' && want[x.what].includes(r[i - 1].name)) ? x.what + '@' + i : null)).filter(Boolean);
  });
  const vids = (what) => page.evaluate((w) => (window.__funscriptProbe || []).filter((x) => x.k === 'vid' && x.what === w).length, what);
  ok('hover: the page mounts the card and the clip loads', up && await toPage() && await loadClip(page));
  await page.evaluate((c) => {
    const v = document.querySelector(c + ' .fsp-stage video'), ring = window.__funscriptProbe;
    const log = (what) => ring.push({ k: 'vid', what });
    const play = v.play.bind(v), pause = v.pause.bind(v);
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    v.play = () => { log('play'); return play(); };
    v.pause = () => { log('pause'); return pause(); };
    Object.defineProperty(v, 'currentTime', { configurable: true, get() { return d.get.call(v); }, set(x) { log('seek'); d.set.call(v, x); } });
  }, C);
  // PR9: inline there is no overlay at all; the hover bar is fullscreen's.
  await overVideo();
  await page.waitForTimeout(350);
  ok('hover: no hover bar inline, even under the pointer (PR9)', await page.locator(HOV).evaluate((e) => !e.getClientRects().length));
  await page.locator(C + ' .fsp-full').click();
  await page.waitForTimeout(500);
  ok('hover: the bar\'s Fullscreen enters media fullscreen', await page.locator(C + '[data-media]').count() === 1);
  await page.mouse.move(2, 400);
  await page.waitForTimeout(IDLE + 400);
  ok('hover: hidden at rest', !(await shown()) && (await opacity()) === 0);
  await overVideo();
  await page.waitForTimeout(350);
  ok('hover: a pointer move over the video shows the bar', await shown() && (await opacity()) === 1);
  await shot('hover-1280x800');
  const hbRow = await page.locator(C + ' .fsp-hb-row').evaluate((r) => [...r.children].filter((e) => e.getClientRects().length)
    .map((e) => e.className.split(' ').find((k) => /^fsp-(prev|play|next|hb-time|motion|rate|tltog|rail|set|full)$/.test(k))).filter(Boolean));
  ok('hover: its row is the player bar: prev, Play, next, time, Motion, rate, timeline, (rail,) Settings, Exit fullscreen',
    same(hbRow.filter((k) => k !== 'fsp-rail'), ['fsp-prev', 'fsp-play', 'fsp-next', 'fsp-hb-time', 'fsp-motion', 'fsp-rate', 'fsp-tltog', 'fsp-set', 'fsp-full']), hbRow);
  await page.locator(C + ' .fsp-tltog').click();
  await page.waitForTimeout(200);
  const wave = await page.locator(C).evaluate((r) => { const d = r.querySelector('.fsp-hb .fsp-dt'), s = r.querySelector('.fsp-hb-seek');
    return { h: d ? Math.round(d.getBoundingClientRect().height) : 0, above: !!d && d.getBoundingClientRect().bottom <= s.getBoundingClientRect().top + 1 }; });
  ok('hover: the timeline toggle draws a 72 px wave over the video, above the scrub (PR9)', Math.abs(wave.h - 72) <= 1 && wave.above, wave);
  await shot('fullscreen-wave-1280x800');
  await page.locator(C + ' .fsp-tltog').click();
  await overVideo();
  ok('hover: no floating chevrons in the card (PR10)', await page.locator(C).evaluate((r) => !r.querySelector('[class*=chevron], [class*=caret]:not(.fsp-libcaret):not(.fsp-tlcaret)')));
  await page.waitForTimeout(IDLE + 400);
  ok('hover: hidden after ' + IDLE + ' ms idle', !(await shown()));
  await overVideo(10);
  await page.mouse.move(2, 400);
  await page.waitForTimeout(100);
  ok('hover: hidden on pointer leave', !(await shown()));

  // Play and pause through the fullscreen bar: the controller's preroll first, one hold after.
  const n0 = hub.bundles.length;
  await overVideo();
  await page.click(C + ' .fsp-hb .fsp-play');
  await page.waitForTimeout(150);
  const pre = hub.bundles[n0];
  ok('hover play: the controller prerolls first (one positioning segment), the video still paused', !!pre && pre.segs.length === 1
    && await video(page, (v) => v.paused), pre && pre.segs);
  await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  ok('hover play: the video plays after the preroll, started by the controller', await video(page, (v) => !v.paused) && await vids('play') === 1);
  await overVideo(-10);
  await page.click(C + ' .fsp-hb .fsp-play');
  await page.waitForTimeout(200);
  ok('hover pause: paused by the controller', await video(page, (v) => v.paused) && await vids('pause') >= 1
    && await playBtn(page).textContent() === 'Play');
  // Seek: a press at 50 % of the bar, its tooltip reading that time first.
  await overVideo();
  const sk = await page.locator(C + ' .fsp-hb-seek').boundingBox();
  await page.mouse.move(sk.x + sk.width / 2, sk.y + sk.height / 2);
  await page.waitForTimeout(100);
  const tip = await page.locator(C + ' .fsp-hb-tip').evaluate((e) => ({ hidden: e.hidden, text: e.textContent }));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const at = await video(page, (v) => v.currentTime);
  ok('hover seek: the tooltip reads the time under the pointer', !tip.hidden && /^0:1[45]\.\d$/.test(tip.text), tip);
  ok('hover seek: a press at half the bar lands at half the clip', Math.abs(at - CLIP_S / 2) < 0.5 && await vids('seek') >= 1, at);
  ok('hover: the video is never driven around the controller', (await direct()).length === 0, await direct());
  await overVideo();
  await page.click(C + ' .fsp-hb .fsp-full');
  await page.waitForTimeout(400);
  ok('hover: Exit fullscreen puts the bar back as it was', await page.locator(C + '[data-media]').count() === 0 && same((await barOrder(page)).rows, [BAR_DESK]));
  // Keys while the player has focus: k plays (through the preroll), m mutes, j seeks back 10 s, k pauses.
  await page.locator(C).focus();
  const kAt = await page.evaluate(() => document.activeElement.className + ' | ' + (window.__funscriptProbe || []).filter((x) => x.k === 'mark').slice(-3).map((x) => x.name).join());
  await page.keyboard.press('k');
  await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 3000 }).catch(() => {});
  const kPlay = await video(page, (v) => !v.paused);
  if (!kPlay) console.log('  [NOTE] k did not play: ' + kAt + ' | ' + await statusText(page) + ' | ' + await page.evaluate(() => (window.__funscriptProbe || []).filter((x) => x.k === 'mark').slice(-3).map((x) => x.name).join()));
  await page.keyboard.press('j');
  await page.waitForTimeout(300);
  const tJ = await video(page, (v) => v.currentTime);
  await page.keyboard.press('k');
  await page.waitForTimeout(200);
  ok('keys: k plays and pauses, j seeks back 10 s, all through the controller', kPlay && tJ < CLIP_S / 2 - 8
    && await video(page, (v) => v.paused) && (await direct()).length === 0, { kPlay, tJ, direct: await direct() });
  // The split bar: drag moves the wave card's height against the stage's, remembered.
  const dims = () => page.locator(C).evaluate((e) => ({ dt: Math.round(e.querySelector('.fsp-dt').getBoundingClientRect().height),
    stage: Math.round(e.querySelector('.fsp-stage').getBoundingClientRect().height) }));
  const d0 = await dims();
  const sb = await page.locator(C + ' .fsp-split').boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 - 40, { steps: 4 });
  await page.mouse.up();
  const d1 = await dims();
  ok('split: dragging the bar up 40 px grows the wave card by 40 and shrinks the stage by as much', Math.abs(d1.dt - d0.dt - 40) <= 2
    && Math.abs(d0.stage - d1.stage - 40) <= 2, [d0, d1]);
  await page.locator(C + ' .fsp-split').focus();
  await page.keyboard.press('ArrowDown');
  const d2 = await dims();
  await page.keyboard.press('Shift+ArrowDown');
  const d3 = await dims();
  ok('split: ArrowDown shrinks the wave card 8 px, Shift 1 px', d1.dt - d2.dt === 8 && d2.dt - d3.dt === 1, [d1, d2, d3]);
  const splitSaved = d3.dt;
  ok('split: the height is stored as the pref split', Math.abs(await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.funscript.split'))) - d3.dt) <= 1);
  // Volume and mute: the video's own, kept in prefs audio across a launch; the bar's slider and m.
  await page.locator(C + ' .fsp-vol').evaluate((e) => { e.value = '0.4'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator(C).focus();
  await page.keyboard.press('m');
  await page.waitForTimeout(100);
  const audio = await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.funscript.audio') || '{}'));
  ok('volume: the bar\'s slider sets the video volume, m mutes, both stored', await video(page, (v) => Math.abs(v.volume - 0.4) < 0.01 && v.muted)
    && Math.abs(audio.vol - 0.4) < 0.01 && audio.muted === true, audio);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await toPage();
  ok('split: the height comes back after a launch', Math.abs((await page.locator(C + ' .fsp-dt').evaluate((e) => Math.round(e.getBoundingClientRect().height))) - splitSaved) <= 2, splitSaved);
  // The stage floor holds on resize: the stored height is clamped when applied, never rewritten.
  const vp0 = page.viewportSize();
  const sb2 = await page.locator(C + ' .fsp-split').boundingBox();
  await page.mouse.move(sb2.x + sb2.width / 2, sb2.y + sb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb2.x + sb2.width / 2, sb2.y + sb2.height / 2 - 900, { steps: 6 });
  await page.mouse.up();
  const big = await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.funscript.split')));
  const floors = [];
  for (const [vw, vh] of [[1280, 720], [1024, 768], [1280, 600]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.waitForTimeout(400);
    floors.push(await page.locator(C).evaluate((e) => ({ stage: Math.round(e.querySelector('.fsp-stage').getBoundingClientRect().height),
      past: Math.round(Math.max(...[...e.children].map((c) => c.getBoundingClientRect().bottom)) - e.getBoundingClientRect().bottom) })));
  }
  ok('split: dragged to the top, then 1280x720, 1024x768 and 1280x600: the stage keeps 120 px, nothing runs past the card, the stored height stays',
    floors.every((x) => x.stage >= 119 && x.past <= 1) && await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.funscript.split'))) === big, { big, floors });
  await page.locator(C + ' .fsp-split').dblclick();
  await page.setViewportSize(vp0);
  await page.waitForTimeout(300);
  ok('volume: volume and mute come back after a launch', await video(page, (v) => Math.abs(v.volume - 0.4) < 0.01 && v.muted));
  await page.locator(C).focus();
  await page.keyboard.press('m');
  ok('volume: m unmutes', await video(page, (v) => !v.muted));
  ok('hover: Fullscreen is offered on the page, in the bar', await page.locator(C + ' .fsp-tr .fsp-full').evaluate((e) => !e.hidden));
  await loadClip(page);
  // Media fullscreen: the shell's page fullscreen, bare, the video alone, the stop pair over it.
  const fsLook = () => page.evaluate((c) => {
    const r = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect();
      return [b.x, b.y, b.width, b.height].map(Math.round); };
    return { full: !!document.querySelector('main.pane.full'), bare: !!document.querySelector('main.pane.full.bare'),
      media: !!document.querySelector(c + '[data-media]'), stage: r(c + ' .fsp-stage'), tl: r(c + ' .fsp-tlbox'), tr: r(c + ' .fsp-tr'),
      settings: r(c + ' .fsp-set'), estop: r('.topstrip .btn-estop'), pause: r('.topstrip .btn-pause'), vw: innerWidth, vh: innerHeight };
  }, C);
  await overVideo();
  await page.click(C + ' .fsp-full');
  await page.waitForTimeout(400);
  const fs = await fsLook();
  ok('media fullscreen: Borderless is page fullscreen, bare, with the media flag', fs.full && fs.bare && fs.media, fs);
  ok('media fullscreen: the video alone fills the window; the timeline and the inline bar hidden, Settings in the hover bar (PR9)',
    !!fs.stage && fs.stage[2] >= fs.vw - 40 && fs.stage[3] >= fs.vh - 40 && !fs.tl && !fs.tr
    && await page.locator(C + ' .fsp-hb .fsp-set').count() === 1, fs);
  ok('media fullscreen: the stop pair stays on screen (RENDERING §8.4 row 11)', !!fs.estop && !!fs.pause
    && fs.estop[0] >= 0 && fs.estop[0] + fs.estop[2] <= fs.vw && fs.estop[1] >= 0, fs);
  await overVideo();
  await page.waitForTimeout(300);
  await shot('media-1280x800');
  ok('media fullscreen: the bar offers the way out', (await page.locator(C + ' .fsp-hb .fsp-full').getAttribute('aria-label')) === 'Exit fullscreen (f)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const off = await fsLook();
  ok('media fullscreen: Escape returns the page as it was', !off.full && !off.media && !!off.tl && !!off.tr && !!off.settings, off);
  await page.locator(C).focus();
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const fKey = await fsLook();
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  ok('media fullscreen: f enters and leaves, bare (one mode, PR8)', fKey.media && fKey.full && fKey.bare && !(await fsLook()).full, fKey);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.addEventListener('phosphor-page-fullscreen', (e) => { window.__fsAsk = e.detail; }, true));
  const paused0 = await video(page, (v) => v.paused);
  await page.locator(C + ' .fsp-stage').dblclick();
  await page.waitForTimeout(500);
  const dbl = await fsLook();
  ok('media fullscreen: a double-click on the stage enters it (the ask carries bare: one mode) and never toggles Play',
    dbl.media && dbl.bare && (await page.evaluate(() => window.__fsAsk.bare === true)) && (await video(page, (v) => v.paused)) === paused0, { dbl, ask: await page.evaluate(() => window.__fsAsk), paused0, now: await video(page, (v) => v.paused) });
  await page.locator(C + ' .fsp-stage').dblclick();
  await page.waitForTimeout(500);
  ok('media fullscreen: a second double-click leaves it', !(await fsLook()).media);
  ok('foot: the page owns its fullscreen, the foot offers none', await page.locator('main.pane .page-foot button').count() === 0);
  await page.keyboard.press('F11');
  await page.waitForTimeout(300);
  const footFull = await fsLook();
  ok('page fullscreen by F11 stays the whole page, no media flag', footFull.full && !footFull.media && !!footFull.tl, footFull);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // The library caret: the column closes, the stage takes the width, remembered.
  const libW = () => page.locator(C).evaluate((e) => ({ lib: e.querySelector('.fsp-libbox').getClientRects().length > 0,
    stage: Math.round(e.querySelector('.fsp-stage').getBoundingClientRect().width), card: Math.round(e.querySelector('.fsp-src').getBoundingClientRect().width),
    stageH: Math.round(e.querySelector('.fsp-stage').getBoundingClientRect().height) }));
  const open0 = await libW();
  await page.click(C + ' .fsp-libcaret');
  await page.waitForTimeout(200);
  const shut = await libW();
  ok('library: the caret closes the column and the stage takes the card width, remembered', !shut.lib && shut.stage === shut.card
    && await page.evaluate(() => localStorage.getItem('phosphor.funscript.libOpen')) === 'false', shut);
  ok('library: closing the column never shrinks the stage height', shut.stageH >= open0.stageH, [open0.stageH, shut.stageH]);
  await page.click(C + ' .fsp-libcaret');
  await page.waitForTimeout(200);
  ok('library: the caret opens it again', (await libW()).lib);

  // The analyzer column (ph-tz5t): two fifths of the card at desktop widths, 320 to 560 px.
  const col = async () => page.locator(C).evaluate((e) => {
    const w = (s) => Math.round(e.querySelector(s).getBoundingClientRect().width);
    return { card: Math.round(e.getBoundingClientRect().width), an: w('.fsp-anbox'), stage: w('.fsp-stage'),
      cut: [...e.querySelectorAll('.fsa-k')].filter((k) => k.scrollWidth > k.clientWidth + 1).map((k) => k.textContent) };
  });
  await page.click(C + ' .fsp-expand');
  await page.waitForTimeout(400);
  const c1280 = await col();
  const split = (c) => Math.abs(c.an - Math.min(560, Math.max(320, 0.4 * c.card))) <= 2 && Math.abs(c.stage - c.an) <= 1 && c.cut.length === 0;
  ok('analyzer 1280: the panel takes two fifths of the card, the thumbnail its width, no label cut', split(c1280), c1280);
  await shot('analyzer-1280x800');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  const c1920 = await col();
  ok('analyzer 1920: the panel stops at 560 px, the graph takes the rest', split(c1920) && c1920.an === 560, c1920);
  await shot('analyzer-1920x1080');
  await page.click(C + ' .fsp-expand');
  await page.waitForTimeout(300);
  if (SHOTS) {
    await overVideo();
    await page.waitForTimeout(300);
    await page.click(C + ' .fsp-full');
    await page.waitForTimeout(400);
    await overVideo();
    await page.waitForTimeout(300);
    await shot('media-1920x1080');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await page.evaluate(() => scrollTo(0, 0));
    await overVideo();
    await page.waitForTimeout(300);
    await page.click(C + ' .fsp-full').catch(() => {});
    await page.waitForTimeout(400);
    await overVideo();
    await page.waitForTimeout(300);
    await shot('media-390x844');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.click(C + ' .fsp-expand').catch(() => {});
    await page.waitForTimeout(400);
    await shot('analyzer-390x844');
  }
  // A phone: the bar fits the stage, the time readout whole (the volume slider yields first).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.evaluate(() => scrollTo(0, 0));
  if (await page.locator(C + '[data-an]').count()) await page.click(C + ' .fsp-expand');
  await page.locator(C + ' .fsp-full').click();
  await page.waitForTimeout(400);
  await overVideo();
  await page.waitForTimeout(300);
  const phone = await page.locator(C).evaluate((e) => {
    const s = e.querySelector('.fsp-stage').getBoundingClientRect(), t = e.querySelector('.fsp-hb-time');
    const out = [...e.querySelectorAll('.fsp-hb-row > *')].filter((x) => x.getClientRects().length)
      .filter((x) => { const r = x.getBoundingClientRect(); return r.left < s.left - 0.5 || r.right > s.right + 0.5 || r.bottom > s.bottom + 0.5; });
    return { cut: t.scrollWidth > t.clientWidth + 1, text: t.textContent, out: out.map((x) => x.className) };
  });
  ok('hover 390: the bar lies inside the stage, the time readout uncut', !phone.cut && phone.out.length === 0, phone);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('hover: no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();
}

// ---- (p) live playback (--live-playback): valencesim plays the 60 s script with a 14 s gap ----
// Auto latency on from the start; a seek with the glide; the gap held as one span, then a pause
// that homes after the delay; an A-B loop; a Preview tuning write the sim marks, then Discard. Prints the numbers as
// one 'PB-RESULT' JSON line; the stored-value recheck after a sim restart is the caller's.
if (PB) {
  console.log('(p) live playback: valencesim on ' + SIM_PORT + ' (http ' + SIM_HTTP + ')');
  const { createSession, PRIORITY } = await import('../../Valence/clients/js/index.js');
  const { tuningGroups } = mods[P + 'analyzer.js'];
  const { parseFunscript: parseS, posAt: posS } = mods[P + 'funscript.js'];
  const sc = parseS(SCRIPT);
  const probeSess = createSession({ host: '127.0.0.1', port: SIM_PORT, clientKind: 'webui', clientName: 'fsp pb probe',
    autoReconnect: false, catalogStore: { load: () => null, save() {}, clear() {} } });
  await new Promise((res) => { setTimeout(res, 5000); probeSess.on('live', res); probeSess.connect(); });
  for (let i = 0; i < 50 && !probeSess.catalog; i++) await sleep(100);
  const cat0 = probeSess.catalog || [];
  try { probeSess.close(); } catch (e) { /* gone */ }
  const segEntry = cat0.find((e) => e.dirName === 'c2h' && (e.layout || []).some((f) => f.role === 'input.duration'));
  if (!segEntry) { console.log('SKIP: no valencesim with a segments STREAM on 127.0.0.1:' + SIM_PORT); process.exit(0); }
  const byRole = (r) => { for (const e of cat0) for (const f of e.layout || []) if (f.role === r && e.dirName !== 'c2h') return { e, f }; return null; };
  const posR = byRole('telemetry.position'), loR = byRole('window.min'), hiR = byRole('window.max');
  const slider = tuningGroups(buildSettingsModel(cat0)).flatMap((g) => g.fields).find((f) => f.widget === 'slider');
  const slEntry = cat0.find((e) => e.id === slider.channelId);
  const markF = slEntry.layout.find((f) => f.role === 'meta.trial_pending');
  const bit = slEntry.layout.filter((f) => f.settingKey != null).findIndex((f) => f.name === slider.name);
  // The plan's velocity at each knot (plan.velocity, plan.elapsed, plan.duration on one channel).
  const pm = buildSettingsModel(cat0), pf = (r) => (pm.byRole.get(r) || [])[0] || null;
  const planF0 = { vel: pf('plan.velocity'), el: pf('plan.elapsed'), dur: pf('plan.duration') };
  const planF = Object.values(planF0).every((f) => f && f.channelId === planF0.vel.channelId) ? planF0 : null;
  const planMs = (f, smp) => smp[f.name] * ({ us: 1e-3, ms: 1, s: 1000 }[f.unit] || 1);
  const obs = createSession({ host: '127.0.0.1', port: SIM_PORT, clientKind: 'webui', clientName: 'fsp pb observer', autoReconnect: false,
    catalogStore: { load: () => null, save() {}, clear() {} },
    subscriptions: [...new Set([posR.e.id, loR.e.id, hiR.e.id, slEntry.id, ...(planF ? [planF.vel.channelId] : [])])]
      .map((ch) => [ch, ch === posR.e.id || (planF && ch === planF.vel.channelId) ? 50 : 0, PRIORITY.normal]) });
  const last = {}, posLog = [], planLog = [];
  obs.on('state', (ch, smp) => {
    last[ch] = smp;
    if (planF && ch === planF.vel.channelId) {
      const at = performance.timeOrigin + performance.now(), el = planMs(planF.el, smp), dur = planMs(planF.dur, smp);
      if (dur > 0 && Number.isFinite(el)) planLog.push({ at, start: at - el, dur, v: Math.abs(smp[planF.vel.name]) });
    }
    if (ch === posR.e.id && last[loR.e.id] && last[hiR.e.id]) {
      const lo = last[loR.e.id][loR.f.name], hi = last[hiR.e.id][hiR.f.name];
      posLog.push({ at: performance.timeOrigin + performance.now(), u: (smp[posR.f.name] - lo) / (hi - lo) });   // samples arrive in their units
    }
  });
  await new Promise((res) => { setTimeout(res, 5000); obs.on('live', res); obs.connect(); });
  await sleep(500);

  const frames = { bundles: 0, nacks: [] };
  const PLAY = { loop: false, loopCount: 0, home: true, homeAfterMs: 5000, homePoint: 0.5, homeSpeed: 0.33, seekMs: 500, autoLatency: true };
  const { ctx, page, up, errors } = await open({ width: 1280, prefs: { 'phosphor.funscript.play': PLAY }, onPage: (pg) => pg.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      for (const { header } of parseFrames(new Uint8Array(payload))) if (header.type === FRAME.STREAM) frames.bundles++;
    });
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      for (const { header, payload: p } of parseFrames(new Uint8Array(payload))) {
        if (header.type === FRAME.NACK) frames.nacks.push({ ch: header.channel, code: cbDecodeFull(p).get(K.code) });
      }
    });
  }) });
  await page.setViewportSize({ width: 1280, height: 800 });
  const R = { sim: { etag: cat0.etag || null } };
  const shot = async (name, el = null) => { if (SHOTS) await (el ? page.locator(el).first() : page).screenshot({ path: join(SHOTS, name) }); };
  /** The viewport with the card's top at the top, and the card alone. */
  const cardShot = async (name) => {
    if (!SHOTS) return;
    await page.locator(C).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    await shot(name + '.png');
    await shot(name + '-card.png', C);
  };
  ok('pb: the shell adopted the sim, the card renders, the 60 s clip loads', up && await toCard(page) && await loadClip(page));
  const skew = await epochSkew(page);
  const origin = await page.evaluate(() => performance.timeOrigin);
  const nodeAt = (atMs) => origin + atMs - skew;   // a page performance.now() instant in node epoch ms
  /** The largest change between consecutive position samples over [a, b) node epoch ms. */
  const maxStep = (a, b) => { const p = posLog.filter((x) => x.at >= a && x.at < b); return p.length > 1 ? Math.max(...p.slice(1).map((x, i) => Math.abs(x.u - p[i].u))) : NaN; };
  /**
   * Over [a, b) node epoch ms: each knot between two whole plans (named by duration, knotOf), its least |plan.velocity|
   * within 25 ms of the second plan's start as a share of the first plan's peak. Under 5 % counts as at rest.
   */
  function knotVel(a, b) {
    const s = planLog.filter((x) => x.at >= a && x.at < b), plans = [], out = [];
    for (const x of s) {
      const p = plans.at(-1);
      if (p && Math.abs(p.dur - x.dur) < 0.5 && Math.abs(p.start - x.start) < 15) p.v.push(x.v);
      else plans.push({ start: x.start, dur: x.dur, v: [x.v] });
    }
    for (let i = 1; i < plans.length; i++) {
      const k = knotOf(plans[i].dur), j = k - 1;
      if (k < 2 || knotOf(plans[i - 1].dur) !== j) continue;
      const peak = Math.max(...plans[i - 1].v), near = s.filter((x) => Math.abs(x.at - plans[i].start) <= 25).map((x) => x.v);
      if (!near.length || !(peak > 0)) continue;
      out.push({ rev: (ACTIONS[j].pos - ACTIONS[j - 1].pos) * (ACTIONS[k].pos - ACTIONS[j].pos) <= 0, frac: Math.min(...near) / peak });
    }
    const nr = out.filter((x) => !x.rev);
    return { knots: out.length, nonReversal: nr.length, medianFrac: +median(nr.map((x) => x.frac)).toFixed(3),
      restNonReversal: nr.filter((x) => x.frac < 0.05).length, reversalsAtRest: out.filter((x) => x.rev && x.frac < 0.05).length };
  }
  /**
   * Over [a, b) node epoch ms: the holds, runs of |plan.velocity| under 2 % of their plan's peak lasting over
   * 40 ms (each sample stands for one strip period) that come within 25 ms of no reversal knot. Plans are named
   * by duration (knotOf); a run touching an unnamed plan (a clipped or joined span) is not judged.
   */
  function holdsOf(a, b) {
    const s = planLog.filter((x) => x.at >= a && x.at < b), plans = [];
    const period = median(s.slice(1).map((x, i) => x.at - s[i].at));
    for (const x of s) {
      const p = plans.at(-1);
      if (p && Math.abs(p.dur - x.dur) < 0.5 && Math.abs(p.start - x.start) < 15) { p.xs.push(x); p.peak = Math.max(p.peak, x.v); }
      else plans.push({ start: x.start, dur: x.dur, k: knotOf(x.dur), xs: [x], peak: x.v });
    }
    const rev = (j) => j <= 0 || j >= ACTIONS.length - 1 || (ACTIONS[j].pos - ACTIONS[j - 1].pos) * (ACTIONS[j + 1].pos - ACTIONS[j].pos) <= 0;
    const out = [];
    let run = null;
    const close = () => {
      if (run && !run.unnamed && !run.rev && run.b - run.a + period > 40) out.push({ ms: Math.round(run.b - run.a + period), knot: run.k });
      run = null;
    };
    for (const p of plans) {
      for (const x of p.xs) {
        if (!(x.v < 0.02 * p.peak)) { close(); continue; }
        run = run || { a: x.at, unnamed: false, rev: false, k: p.k };
        run.b = x.at;
        run.unnamed ||= p.k < 1;
        run.rev ||= p.k >= 1 && ((x.at - p.start < 25 && rev(p.k - 1)) || (p.start + p.dur - x.at < 25 && rev(p.k)));
      }
    }
    close();
    return { holds: out.length, longestMs: Math.max(0, ...out.map((h) => h.ms)), totalMs: out.reduce((n, h) => n + h.ms, 0), at: out.slice(0, 8) };
  }
  const tStart = performance.timeOrigin + performance.now();
  const pnow = () => page.evaluate(() => performance.now());
  const since = (t0, k) => page.evaluate(([a, b]) => (window.__funscriptProbe || []).filter((x) => x.k === b && x.t >= a), [t0, k]);
  const media = () => video(page, (v) => v.currentTime * 1000);
  const lead = (segs) => Math.max(...segs.flatMap((x) => x.list.map((s) => s.atMs - x.t)));
  /** The client schedule after supersedes: each send drops what it held from its first start on. */
  const sched = (segs) => { let out = []; for (const x of segs) if (x.ok && x.list.length) out = [...out.filter((s) => s.atMs < x.list[0].atMs), ...x.list]; return out; };
  const holes = (s) => s.slice(1).map((x, i) => x.atMs - (s[i].atMs + s[i].durationMs)).filter((d) => d > 30).map(Math.round);
  const latOf = async (t0) => {
    const l = await since(t0, 'lat');
    const lagged = l.filter((x) => Number.isFinite(x.lag));
    const conv = lagged.find((x) => Math.abs(Math.max(0, Math.min(100, x.lag)) - x.comp) < 2);
    return { samples: l.length, firstLagS: lagged.length ? +((lagged[0].t - t0) / 1000).toFixed(1) : null,
      convergedS: conv ? +((conv.t - t0) / 1000).toFixed(1) : null, lag: lagged.length ? +lagged.at(-1).lag.toFixed(2) : null,
      comp: l.length ? +l.at(-1).comp.toFixed(2) : null, comps: [...new Set(l.map((x) => +x.comp.toFixed(1)))] };
  };

  // ---- 1: play, auto compensation ----
  let t0 = await pnow();
  await playBtn(page).click();
  await page.waitForTimeout(13000);
  await cardShot('player-1280x800');
  let segs = await since(t0, 'seg');
  const segNacks = () => frames.nacks.filter((n) => n.ch === segEntry.id).length;
  const us = posLog.map((p) => p.u);
  R.normal = { bundles: frames.bundles, maxLeadMs: +lead(segs).toFixed(1), holes: holes(sched(segs)), lat: await latOf(t0), segNacks: segNacks(),
    measured: [+Math.min(...us).toFixed(3), +Math.max(...us).toFixed(3)], maxStep: +maxStep(tStart + 2000, Infinity).toFixed(4) };
  ok('pb normal: bundles flow, the lead within half the horizon, no NACK on the segments STREAM, the machine strokes',
    frames.bundles > 20 && R.normal.maxLeadMs <= 127 && segNacks() === 0 && R.normal.measured[1] - R.normal.measured[0] > 0.3, R.normal);
  ok('pb normal: auto compensation measures a lag and converges on it, never below 0', R.normal.lat.lag != null && R.normal.lat.convergedS != null
    && R.normal.lat.comps.every((c) => c >= 0), R.normal.lat);
  if (R.normal.lat.lag < 0) console.log('  [NOTE] the plan strip read a plan starting ' + -R.normal.lat.lag + ' ms before its stamp (Nucleus val-0ep); compensation held at 0');
  R.knots = knotVel(tStart + 2000, performance.timeOrigin + performance.now());
  ok('pb knots: the plan carries its velocity through every knot that is not a reversal (end velocity on the wire)',
    R.knots.nonReversal >= 5 && R.knots.restNonReversal === 0, R.knots);
  R.holds = holdsOf(tStart + 2000, performance.timeOrigin + performance.now());
  ok('pb holds: on the staircase no plan holds over 40 ms outside a reversal (the hub dwell rule never fires)', !!planF && R.holds.holds === 0, R.holds);

  // ---- 2: a seek with the glide ----
  t0 = await pnow();
  await video(page, (v) => { v.currentTime = 16; });
  await page.waitForTimeout(1500);
  segs = await since(t0, 'seg');
  const marks = await since(t0, 'mark');
  const glideX = segs.find((x) => x.list.length && Math.abs(x.list[0].durationMs - 500) <= 1);
  const g = glideX && glideX.list[0];
  const near = g ? Math.min(...Array.from({ length: 61 }, (_, i) => Math.abs(posS(sc, 16300 + 10 * i) - g.norm))) : NaN;
  R.seek = { hold: marks.some((m) => m.name === 'hold'), glideMs: g ? +g.durationMs.toFixed(1) : null, glideSentAfterMs: glideX ? Math.round(glideX.t - t0) : null,
    normErr: +near.toFixed(4), joinMs: glideX && glideX.list[1] ? +(glideX.list[1].atMs - (g.atMs + g.durationMs)).toFixed(3) : null };
  ok('pb seek: one hold, then a 500 ms glide to the script 500 ms on, the next span joins its end', R.seek.hold && R.seek.glideMs === 500
    && near < 0.01 && (R.seek.joinMs == null || Math.abs(R.seek.joinMs) < 0.01), R.seek);

  // ---- 3: the 14 s gap plays as its one authored span; a pause homes once after the delay ----
  const gapA = SCRIPT.actions.filter((a) => a.at <= 20000).at(-1).at, gapB = 34000;
  await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').currentTime > 35.5, C, { timeout: 30000 }).catch(() => {});
  segs = await since(t0, 'seg');
  const gapSegs = segs.flatMap((x) => x.list);
  const gapSpan = gapSegs.find((s) => Math.abs(s.durationMs - (gapB - gapA)) < 1);
  R.gap = { gapMs: [gapA, gapB], spanMs: gapSpan ? Math.round(gapSpan.durationMs) : null, homeSegs: gapSegs.filter((s) => Math.abs(s.norm - 0.5) < 0.002).length };
  ok('pb gap: while playing the gap is one authored span, nothing goes home', !!gapSpan && R.gap.homeSegs === 0, R.gap);
  t0 = await pnow();
  await playBtn(page).click();
  await page.waitForTimeout(PLAY.homeAfterMs + 3500);
  const homeSeg = (await since(t0, 'seg')).flatMap((x) => x.list).find((s) => Math.abs(s.norm - 0.5) < 0.002);
  const homeMark = (await since(t0, 'mark')).find((m) => m.name === 'home');
  const atHome = homeSeg ? posLog.filter((p) => p.at > nodeAt(homeSeg.atMs + homeSeg.durationMs) + 300).map((p) => p.u) : [];
  R.home = { afterPauseMs: homeMark ? Math.round(homeMark.t - t0) : null, moveMs: homeSeg ? Math.round(homeSeg.durationMs) : null,
    measured: atHome.length ? +median(atHome).toFixed(4) : null, samples: atHome.length,
    worst: atHome.length ? +Math.max(...atHome.map((u) => Math.abs(u - 0.5))).toFixed(4) : null };
  ok('pb home: one move home once the pause lasts homeAfterMs, the machine measured at the point', !!homeSeg
    && R.home.afterPauseMs >= PLAY.homeAfterMs && R.home.afterPauseMs < PLAY.homeAfterMs + 300 && atHome.length > 10
    && Math.abs(median(atHome) - 0.5) < 0.01, R.home);
  await playBtn(page).click();
  await page.waitForTimeout(2500);

  // ---- 4: an A-B loop ----
  const ab = page.locator(C + ' .fsp-ab');
  await ab.click();
  const a0 = await media();
  await page.waitForTimeout(4000);
  t0 = await pnow();
  const n0 = segNacks(), tLoop = performance.timeOrigin + performance.now();
  await ab.click();
  const b0 = await media();
  await page.waitForTimeout(13000);
  segs = await since(t0, 'seg');
  const wrapT = (await since(t0, 'mark')).filter((m) => m.name === 'wrap').map((m) => m.t);
  const wraps = wrapT.length;

  const sc2 = sched(segs.filter((x) => x.t > t0 + 300));
  // A wrap's seek lands late by more than STEP_MS: the clock steps and the restart re-sends the seam span later by that much.
  const shifts = [];
  segs.filter((x) => x.t > t0 + 300 && x.list.length).forEach((x, i, all) => {
    const q = x.list[0];
    const prev = all.slice(0, i).flatMap((y) => y.list).filter((p) => Math.abs(p.durationMs - q.durationMs) < 0.5 && Math.abs(p.norm - q.norm) < 1e-4 && p.atMs !== q.atMs && Math.abs(p.atMs - q.atMs) < 200);
    if (prev.length && q.atMs < x.t - 2) shifts.push(+(q.atMs - prev.at(-1).atMs).toFixed(1));
  });
  const tEnd = await media();
  R.loop = { a: Math.round(a0), b: Math.round(b0), wraps, holes: holes(sc2), cuts: sc2.slice(1).map((x, i) => x.atMs - (sc2[i].atMs + sc2[i].durationMs)).filter((d) => d < -2).map(Math.round),
    stepMs: shifts, segNacks: segNacks() - n0, maxStep: +maxStep(tLoop, performance.timeOrigin + performance.now()).toFixed(4), maxStepPlaying: R.normal.maxStep, t: Math.round(tEnd) };
  ok('pb loop: wraps at least twice, no hole in the schedule, no NACK, the rail never jumps', wraps >= 2 && R.loop.holes.length === 0 && R.loop.segNacks === 0
    && R.loop.maxStep <= R.normal.maxStep * 1.5 + 0.01 && tEnd >= a0 - 100 && tEnd <= b0 + 100, R.loop);
  await ab.click();

  const setRow = async (fn) => {
    await page.click('[data-tab-id="plugins"]');
    await page.waitForSelector('.fsp-pset', { timeout: 5000 });
    await fn(page.locator('.fsp-pset'));
    await page.waitForTimeout(200);
  };

  // ---- 5: a Preview tuning write the sim marks, then Discard ----
  await page.locator(C + ' .fsp-expand').click();
  await page.waitForTimeout(600);
  await cardShot('analyzer-1280x800');
  await page.locator(C + ' .fsa-head .fsp-btn', { hasText: /^Preview$/ }).click();
  const stored = last[slEntry.id][slider.name];
  const sl = page.locator(C + ' .fsa-row input[type=range]').first();
  await sl.scrollIntoViewIfNeeded();
  await sl.focus();
  await sl.press('ArrowRight');
  await page.waitForTimeout(800);
  const trialV = last[slEntry.id][slider.name], trialMark = (last[slEntry.id][markF.name] >> bit) & 1;
  const notice = (await statusText(page)) === 'Preview: not saved';
  await page.locator(C + ' .fsa-head .fsp-btn', { hasText: /^Discard$/ }).click();
  await page.waitForTimeout(800);
  const backV = last[slEntry.id][slider.name], backMark = (last[slEntry.id][markF.name] >> bit) & 1;
  R.preview = { channel: '0x' + slEntry.id.toString(16), field: slider.name, label: slider.label, stored, trial: trialV, trialMark, notice, reverted: backV, markAfter: backMark };
  ok('pb preview: the sim STATE shows the trial value and its mark, then the stored value and no mark after Discard',
    trialV !== stored && trialMark === 1 && notice && backV === stored && backMark === 0, R.preview);
  await playBtn(page).click();
  await page.locator(C + ' .fsp-expand').click();

  // ---- screenshots: the settings card and the hub's curve, then the phone width ----
  if (SHOTS) {
    await setRow(async () => {});
    await page.locator('.fsp-scale').evaluate((e) => e.scrollIntoView());
    await shot('settings-1280x800.png');
    await toCard(page);
    await video(page, (v) => { v.currentTime = 9; });
    await page.waitForTimeout(800);
    await cardShot('curve-1280x800');
    await shot('curve-timeline-1280.png', C + ' .fsp-tlbox');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await toCard(page);
    await page.waitForTimeout(500);
    await cardShot('player-390x844');
    await page.locator(C + ' .fsp-expand').click();
    await page.waitForTimeout(600);
    await cardShot('analyzer-390x844');
    await page.locator(C + ' .fsp-expand').click();
    await page.waitForTimeout(300);
    await shot('curve-timeline-390.png', C + ' .fsp-tlbox');
    await setRow(async () => {});
    await page.locator('.fsp-scale').evaluate((e) => e.scrollIntoView());
    await shot('settings-390x844.png');
  }
  ok('pb: no page error', errors.length === 0, errors.slice(0, 3));
  R.nacks = Object.entries(frames.nacks.reduce((o, n) => { const k = '0x' + n.ch.toString(16) + ' ' + (NACK_NAME[n.code] || n.code); o[k] = (o[k] || 0) + 1; return o; }, {}));
  console.log('PB-RESULT ' + JSON.stringify(R));
  try { obs.close(); } catch (e) { /* gone */ }
  await ctx.close();
}

if (LIVE && !PB) {
  console.log('(f) live: valencesim on ' + SIM_PORT + ' (http ' + SIM_HTTP + ')');
  const { createSession } = await import('../../Valence/clients/js/index.js');
  const sess = createSession({ host: '127.0.0.1', port: SIM_PORT, clientKind: 'webui', clientName: 'fsp probe',
    autoReconnect: false, catalogStore: { load: () => null, save() {}, clear() {} } });
  const live = await new Promise((res) => { setTimeout(() => res(false), 5000); sess.on('live', () => res(true)); sess.connect(); });
  for (let i = 0; i < 50 && live && !sess.catalog; i++) await sleep(100);
  const segEntry = live && (sess.catalog || []).find((e) => e.dirName === 'c2h' && (e.layout || []).some((f) => f.role === 'input.duration'));
  const seg = !!segEntry;
  try { sess.close(); } catch (e) { /* gone */ }
  if (!seg) { console.log('SKIP: no valencesim with a segments STREAM on 127.0.0.1:' + SIM_PORT); process.exit(0); }

  const frames = { bundles: 0, nacks: [] };
  const { ctx, page, up, errors } = await open({ onPage: (page) => page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      for (const { header } of parseFrames(new Uint8Array(payload))) if (header.type === FRAME.STREAM) frames.bundles++;
    });
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      for (const { header, payload: p } of parseFrames(new Uint8Array(payload))) {
        if (header.type === FRAME.NACK && header.channel === segEntry.id) frames.nacks.push(cbDecodeFull(p).get(K.code));
      }
    });
  }) });
  ok('live: the shell adopted the sim', up);
  ok('live: the card renders', await toCard(page));
  ok('live: the clip loads', await loadClip(page));
  await playBtn(page).click();
  await page.waitForTimeout(2500);
  const plan = async () => page.evaluate(() => document.querySelector('.topstrip .hn-primary .hn-val')?.textContent || '');
  const p1 = await plan();
  await page.waitForTimeout(5500);
  const p2 = await plan();
  ok('live: segments bundles flow', frames.bundles > 8, frames.bundles);
  const heatOver = await page.locator(C + ' .fsp-ov').evaluate((e) => [...e.querySelectorAll('rect.bin.over')].map((r) => r.getAttribute('height')));
  ok('live: heat past limit.input.speed is striped, not only recolored', heatOver.length > 0 && heatOver.every((h) => h === '3'),
    heatOver.length + ' stripes');
  ok('live: the status names a script past the limit', (await statusText(page)) === 'Script past the input speed limit', await statusText(page));
  ok('live: no NACK on the segments STREAM', frames.nacks.length === 0, frames.nacks);
  ok('live: the planned position moves', !!p1 && p1 !== p2, [p1, p2]);
  const pauseBtn = page.locator('.topstrip .btn-pause');
  await pauseBtn.click();
  const paused = await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 2000 })
    .then(() => true).catch(() => false);
  ok('live: the strip Pause pauses the video', paused, await statusText(page));
  ok('live: the strip offers Resume', /Resume/.test(await pauseBtn.textContent()), await pauseBtn.textContent());
  await pauseBtn.click();
  await page.waitForTimeout(1500);
  ok('live: Resume leaves it paused', await video(page, (v) => v.paused));
  // Play again (the operator's act), then a seek on the overview: the stream re-stamps from the new time.
  await playBtn(page).click();
  await page.waitForTimeout(2500);
  const nSeek = frames.bundles;
  const ovBox = await page.locator(C + ' .fsp-ov').boundingBox();
  await page.mouse.click(ovBox.x + ovBox.width * 0.6, ovBox.y + ovBox.height / 2);
  await page.waitForTimeout(2500);
  const afterSeek = await video(page, (v) => ({ t: v.currentTime, paused: v.paused, d: v.duration }));
  ok('live: a seek re-schedules: the video plays on from the new time and bundles flow, no NACK',
    !afterSeek.paused && afterSeek.t > afterSeek.d * 0.6 && afterSeek.t < afterSeek.d * 0.6 + 4 && frames.bundles > nSeek + 5
      && frames.nacks.length === 0, { ...afterSeek, bundles: frames.bundles - nSeek, nacks: frames.nacks });
  await playBtn(page).click();
  await page.waitForTimeout(600);
  // An Advanced start (the pattern card's Start) grays Play with the generator words.
  const run = page.locator('main.pane .ap .ap-run:visible');
  const toAp = async () => { if (await run.count()) return true; return toCard(page, 'main.pane .ap'); };
  if (await toAp()) {
    const adv = page.locator('main.pane .ap-tabs button', { hasText: 'Advanced' });
    if (await adv.count()) await adv.click();
    await run.click();
    await page.waitForTimeout(800);
    await toCard(page);
    await page.waitForTimeout(400);
    ok('live: an Advanced start grays Play', await playBtn(page).isDisabled() && (await statusText(page)) === 'stop the pattern first',
      await statusText(page));
    await toCard(page, 'main.pane .ap');
    if (await adv.count()) await adv.click();
    await run.click();
    await page.waitForTimeout(500);
  } else ok('live: the pattern card renders', false);
  // The analyzer on the sim's own Tuning groups: a Preview write is a trial the hub marks, Discard puts it back.
  await toCard(page);
  await page.locator(C + ' .fsp-expand').click();
  await page.waitForTimeout(400);
  const liveRows = await page.locator(C + ' .fsa-row').count();
  ok('live: the analyzer lists the sim\'s tuning controls', liveRows > 10, liveRows);
  await page.locator(C + ' .fsa-head .fsp-btn', { hasText: /^Preview$/ }).click();
  const sl = page.locator(C + ' .fsa-row input[type=range]').first();
  const v0 = await sl.inputValue();
  await sl.scrollIntoViewIfNeeded();
  await sl.focus();
  await sl.press('ArrowRight');
  const marked = await page.waitForFunction((c) => document.querySelector(c + ' > .fsp-slot').textContent === 'Preview: not saved', C, { timeout: 3000 })
    .then(() => true).catch(() => false);
  ok('live: a Preview write is a trial the sim marks: the notice stands', marked, await statusText(page));
  await page.locator(C + ' .fsa-head .fsp-btn', { hasText: /^Discard$/ }).click();
  const cleared = await page.waitForFunction((c) => document.querySelector(c + ' > .fsp-slot').textContent !== 'Preview: not saved', C, { timeout: 3000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  ok('live: Discard reverts: the notice clears and the stored value returns', cleared && (await sl.inputValue()) === v0,
    { cleared, v0, now: await sl.inputValue() });
  await page.locator(C + ' .fsp-expand').click();
  await page.waitForTimeout(300);
  // Last: the strip's E-stop latches the spare sim until its operator release, so nothing runs after it.
  await toCard(page);
  await playBtn(page).click();
  await page.waitForTimeout(2500);
  await page.locator('.topstrip .btn-estop').click();
  const stopped = await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 1000 })
    .then(() => true).catch(() => false);
  ok('live: the strip E-stop pauses the video with the latch words', stopped && /e-stop|halt/i.test(await statusText(page)), await statusText(page));
  await page.waitForTimeout(300);
  const nEstop = frames.bundles;
  await page.waitForTimeout(1500);
  ok('live: after the E-stop nothing is sent, the video stays paused, Play is grayed',
    frames.bundles === nEstop && await video(page, (v) => v.paused) && await playBtn(page).isDisabled(), frames.bundles - nEstop);
  ok('live: no page error', errors.length === 0, errors.slice(0, 3));
  if (SHOT) await page.locator(C).screenshot({ path: SHOT });
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
