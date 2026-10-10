/**
 * funscript-core.test.mjs -- the funscript player's pure core (ph-smvd.1,
 * plugins/factory/funscript-player/funscript.js against CONTRACT.md "core").
 *
 * Fails if parsing stops sorting, deduping (last wins), clamping, dropping
 * non-finite actions, applying `inverted`, noting `range`, listing an `axes`
 * array, or refusing garbage in words; if a span over MAX_SPAN_MS survives;
 * if axis naming, file pairing, interpolation, the binary search, thinning,
 * heat bins or the time format drift; if Scale's wire stops being the Script
 * itself at scale 1, moves an action off its map, or a saved pref's retired
 * curve fields survive cleanScale (scale.js). Multi-axis (ph-6dr6): fails if the
 * funlib 1.1 axes[] or 2.0 channels{} oscillator axes (V8, V9) stop loading, a
 * channels-only 2.0 file stops playing its stroke, a sibling <base>.v8 file stops
 * pairing by base name (axes.js), or the resampler (osc.js oscSamples) and the
 * publisher's pacing (createOsc) drift.
 *
 * Run: node test/funscript-core.test.mjs
 */
import {
  MAX_SPAN_MS, MAX_ACTIONS, AXES, OSC_AXES, parseFunscript, axisOf, pairFiles, posAt, indexAfter, speedAt, peakSpeed, thin, heat, fmtTime,
} from '../plugins/factory/funscript-player/funscript.js';
import { oscFiles, withAxes } from '../plugins/factory/funscript-player/axes.js';
import { oscSamples, createOsc, hasOsc, OSC_LEAD_MS, NO_STREAM } from '../plugins/factory/funscript-player/osc.js';
import { SCALE, cleanScale, wire, fitMap, mapOf } from '../plugins/factory/funscript-player/scale.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const throws = (fn, words) => { try { fn(); return false; } catch (e) { return e.message === words; } };
const acts = (...pairs) => ({ actions: pairs.map(([at, pos]) => ({ at, pos })) });

console.log('parse');
{
  const s = parseFunscript(acts([0, 0], [500, 100], [1000, 50]), 'a.funscript');
  ok('object input: typed arrays', s.at instanceof Float64Array && s.pos instanceof Float32Array);
  ok('object input: values', [...s.at].join() === '0,500,1000' && near(s.pos[1], 1) && near(s.pos[2], 0.5));
  ok('shape', s.name === 'a.funscript' && s.axis === 'L0' && s.durationMs === 1000 && s.title === null
    && s.metadata === null && s.ignored.length === 0 && s.notes.length === 0);
  const t = parseFunscript(JSON.stringify({ version: '1.0', actions: [{ at: 10, pos: 20 }] }));
  ok('text input', t.at.length === 1 && near(t.pos[0], 0.2) && t.durationMs === 10 && t.name === '');
  const u = parseFunscript(acts([300, 30], [100, 10], [200, 20]));
  ok('unsorted is sorted and noted', [...u.at].join() === '100,200,300' && near(u.pos[0], 0.1) && near(u.pos[2], 0.3)
    && u.notes.join() === 'actions sorted', u.notes.join('; '));
  const d = parseFunscript(acts([100, 10], [0, 0], [100, 90], [100, 70]));
  ok('duplicate at keeps the last', [...u.at].length === 3 && [...d.at].join() === '0,100' && near(d.pos[1], 0.7));
  ok('duplicates noted', d.notes.includes('2 duplicates dropped'), d.notes.join('; '));
  const c = parseFunscript(acts([0, -5], [1, 150], [2, 50]));
  ok('clamped', near(c.pos[0], 0) && near(c.pos[1], 1) && c.notes.includes('2 positions clamped'));
  const nf = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: NaN, pos: 1 }, { at: 5, pos: Infinity }, null,
    { at: -1, pos: 3 }, { at: '7', pos: 3 }, { at: 9, pos: 90 }] });
  ok('non-finite and negative dropped', [...nf.at].join() === '0,9' && nf.notes.includes('5 invalid actions dropped'),
    nf.notes.join('; '));
  const inv = parseFunscript({ inverted: true, actions: [{ at: 0, pos: 0 }, { at: 1, pos: 25 }] });
  ok('inverted applied', near(inv.pos[0], 1) && near(inv.pos[1], 0.75));
  ok('inverted false ignored', near(parseFunscript({ inverted: false, actions: [{ at: 0, pos: 0 }] }).pos[0], 0));
  const r = parseFunscript({ range: 90, actions: [{ at: 0, pos: 90 }] });
  ok('range ignored and noted', near(r.pos[0], 0.9) && r.notes.includes('range ignored'));
  ok('range 100 is no note', parseFunscript({ range: 100, actions: [{ at: 0, pos: 1 }] }).notes.length === 0);
  const ax = parseFunscript({ actions: [{ at: 0, pos: 0 }], axes: [{ id: 'R0', actions: [{ at: 0, pos: 1 }] },
    { id: 'R1', actions: [] }, null] });
  ok('axes array listed, never driven', ax.ignored.join() === 'R0,R1' && ax.at.length === 1 && ax.axis === 'L0');
  const md = parseFunscript({ metadata: { title: ' Scene ', creator: 'x' }, actions: [{ at: 0, pos: 0 }] });
  ok('metadata untouched, title read', md.title === 'Scene' && md.metadata.creator === 'x');
  ok('bad JSON', throws(() => parseFunscript('{oops'), 'not a funscript'));
  ok('no actions array', throws(() => parseFunscript({ version: 1 }), 'not a funscript'));
  ok('non-object', throws(() => parseFunscript(42), 'not a funscript') && throws(() => parseFunscript('null'), 'not a funscript'));
  ok('empty actions', throws(() => parseFunscript({ actions: [] }), 'no actions'));
  ok('nothing survives', throws(() => parseFunscript({ actions: [{ at: -1, pos: 0 }] }), 'no actions'));
  const t0 = Date.now();
  ok('a 1e12 ms gap is refused in words before any split', throws(() => parseFunscript(acts([0, 0], [1e12, 100])), 'script longer than 24 hours')
    && throws(() => parseFunscript(acts([0, 0], [1e13, 100])), 'script longer than 24 hours') && Date.now() - t0 < 100, (Date.now() - t0) + ' ms');
  ok('24 hours exactly is kept', parseFunscript(acts([0, 0], [86400000, 100])).at.length === 1441);
  ok('more than MAX_ACTIONS is refused in words', throws(() => parseFunscript({ actions: new Array(MAX_ACTIONS + 1) }),
    'more than a million actions'));
}

console.log('60 s split');
{
  const s = parseFunscript(acts([0, 0], [150000, 100], [150500, 0]));
  let maxGap = 0;
  for (let i = 1; i < s.at.length; i++) maxGap = Math.max(maxGap, s.at[i] - s.at[i - 1]);
  ok('no span over MAX_SPAN_MS', maxGap <= MAX_SPAN_MS && MAX_SPAN_MS === 60000, 'max ' + maxGap);
  ok('split into 3 equal pieces', [...s.at].join() === '0,50000,100000,150000,150500');
  ok('split along the line', near(s.pos[1], 1 / 3) && near(s.pos[2], 2 / 3) && near(posAt(s, 75000), 0.5));
  ok('split noted', s.notes.includes('1 long span split'));
  ok('exactly 60 s is kept whole', parseFunscript(acts([0, 0], [60000, 100])).at.length === 2);
}

console.log('axisOf');
{
  const cases = [
    ['Scene.funscript', 'Scene', 'L0'], ['Scene.stroke.funscript', 'Scene', 'L0'],
    ['Scene.surge.funscript', 'Scene', 'L1'], ['Scene.sway.funscript', 'Scene', 'L2'],
    ['Scene.twist.funscript', 'Scene', 'R0'], ['Scene.ROLL.funscript', 'Scene', 'R1'],
    ['Scene.pitch.funscript', 'Scene', 'R2'], ['Scene.vib.funscript', 'Scene', 'V0'],
    ['Scene.valve.funscript', 'Scene', 'A0'], ['Scene.suck.funscript', 'Scene', 'A1'],
    ['Scene.lube.funscript', 'Scene', 'A2'], ['Scene.R0.funscript', 'Scene', 'R0'],
    ['Scene.l1.funscript', 'Scene', 'L1'], ['My.Scene.v2.FUNSCRIPT', 'My.Scene.v2', 'L0'],
    ['C:\\vids\\a.roll.funscript', 'a', 'R1'],
  ];
  for (const [name, base, axis] of cases) {
    const r = axisOf(name);
    ok(name + ' -> ' + axis, r && r.base === base && r.axis === axis, JSON.stringify(r));
  }
  ok('not a funscript -> null', axisOf('Scene.mp4') === null && axisOf('funscript') === null);
  ok('AXES frozen', Object.isFrozen(AXES) && AXES[''] === 'L0' && AXES.stroke === 'L0');
}

console.log('pairFiles');
{
  const f = (name, type = '') => ({ name, type });
  const v = f('Scene.mp4', 'video/mp4'), main = f('scene.funscript'), roll = f('Scene.roll.funscript');
  const other = f('Other.funscript'), txt = f('notes.txt', 'text/plain');
  let p = pairFiles([other, roll, txt, main, v]);
  ok('same base, case-insensitive', p.video === v && p.script === main);
  ok('every other script is extra', p.extra.length === 2 && p.extra.includes(roll) && p.extra.includes(other));
  p = pairFiles([f('clip.webm'), f('x.funscript'), f('x.twist.funscript')]);
  ok('no same base: first L0; video by extension', p.video.name === 'clip.webm' && p.script.name === 'x.funscript'
    && p.extra.length === 1);
  p = pairFiles([f('song.mp3', 'audio/mpeg'), f('second.mp4', 'video/mp4')]);
  ok('first video or audio; no script', p.video.name === 'song.mp3' && p.script === null && p.extra.length === 0);
  p = pairFiles([f('a.roll.funscript')]);
  ok('only extra axes: no script', p.video === null && p.script === null && p.extra.length === 1);
  ok('empty', pairFiles([]).video === null && pairFiles(null).extra.length === 0);
}

console.log('posAt, indexAfter, speedAt');
{
  const s = parseFunscript(acts([100, 0], [200, 100], [400, 0]));
  ok('at knots', near(posAt(s, 100), 0) && near(posAt(s, 200), 1) && near(posAt(s, 400), 0));
  ok('between knots, linear', near(posAt(s, 150), 0.5) && near(posAt(s, 300), 0.5) && near(posAt(s, 250), 0.75));
  ok('holds outside', near(posAt(s, 0), 0) && near(posAt(s, 1e9), 0) && near(posAt(s, -5), 0));
  ok('indexAfter edges', indexAfter(s, -1) === 0 && indexAfter(s, 100) === 1 && indexAfter(s, 199.9) === 1
    && indexAfter(s, 200) === 2 && indexAfter(s, 399) === 2 && indexAfter(s, 400) === 3 && indexAfter(s, 1e9) === 3);
  const big = parseFunscript({ actions: Array.from({ length: 50000 }, (_, i) => ({ at: i * 7, pos: i % 2 * 100 })) });
  let good = true;
  for (const t of [0, 3, 7, 349993, 349999.5, 123456]) {
    let lin = 0;
    while (lin < big.at.length && !(big.at[lin] > t)) lin++;
    good &&= indexAfter(big, t) === lin;
  }
  ok('indexAfter matches a linear scan on 50k', good);
  ok('speedAt chord norm/s', near(speedAt(s, 150), 10) && near(speedAt(s, 300), 5) && near(speedAt(s, 200), 5));
  ok('speedAt 0 outside', speedAt(s, 50) === 0 && speedAt(s, 400) === 0 && speedAt(s, 500) === 0);
  ok('peakSpeed is the fastest chord', near(peakSpeed(s), 10) && peakSpeed(parseFunscript(acts([0, 50]))) === 0);
}

console.log('thin');
{
  const fast = parseFunscript({ actions: Array.from({ length: 41 }, (_, i) => ({ at: i * 50, pos: (i % 2) * 100 })) });
  const t = thin(fast, 100);
  let minGap = Infinity;
  for (let i = 1; i < t.at.length; i++) minGap = Math.min(minGap, t.at[i] - t.at[i - 1]);
  ok('gaps at least minGap', minGap >= 100, 'min ' + minGap);
  ok('first and last kept', t.at[0] === 0 && t.at[t.at.length - 1] === 2000 && t.durationMs === 2000);
  ok('fast reversals keep their stroke', Math.min(...t.pos) === 0 && Math.max(...t.pos) === 1
    && [...t.pos].slice(0, -1).every((p, i) => i === 0 || p !== t.pos[i - 1]), [...t.pos].join());
  ok('thinned noted, source untouched', t.notes.at(-1) === (41 - t.at.length) + ' actions thinned' && fast.at.length === 41
    && fast.notes.length === 0);
  const ramp = parseFunscript(acts([0, 0], [100, 25], [200, 50], [300, 100], [400, 100], [1000, 100], [1100, 20], [1500, 0]));
  const r = thin(ramp, 50);
  ok('slow reversals and hold corners kept, ramp knots dropped', [...r.at].join() === '0,300,1000,1500', [...r.at].join());
  const tiny = thin(parseFunscript(acts([0, 0], [10, 100], [20, 0])), 100);
  ok('shorter than minGap: first and last', [...tiny.at].join() === '0,20');
}

console.log('heat');
{
  const s = parseFunscript(acts([0, 0], [1000, 100], [2000, 100], [2500, 0]));
  const h = heat(s, 5);
  ok('Float32Array of bins', h instanceof Float32Array && h.length === 5);
  ok('bins are time-weighted norm/s', near(h[0], 1) && near(h[1], 1) && near(h[2], 0) && near(h[3], 0)
    && near(h[4], 2), [...h].join());
  const w = heat(s, 2, 500, 1500);
  ok('window', near(w[0], 1) && near(w[1], 0), [...w].join());
  const out = heat(s, 2, -1000, 0);
  ok('before the first action is zero', out[0] === 0 && out[1] === 0);
  ok('degenerate', heat(s, 0).length === 0 && heat(s, 3, 10, 10).every((x) => x === 0));
}

console.log('fmtTime');
{
  const cases = [[0, '0:00.0'], [1234, '0:01.2'], [61999, '1:01.9'], [3599999, '59:59.9'], [3600000, '1:00:00'],
    [3725000, '1:02:05'], [-5, '0:00.0'], [NaN, '0:00.0']];
  for (const [ms, s] of cases) ok(ms + ' -> ' + s, fmtTime(ms) === s, fmtTime(ms));
}

console.log('scale');
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const I = (x = {}) => ({ ...SCALE, ...x });
  const s = parseFunscript(acts([0, 10], [180, 90], [260, 20], [700, 20], [760, 60], [1000, 75], [1100, 100], [1500, 0]));
  const n = s.at.length;
  ok('wire: at scale 1 the Script itself (scheduler byte-identical), no velocity', wire(s, I()) === s && wire(s) === s && !('vel' in s));
  const cs = [cleanScale({ scale: 3, scaleAuto: 1 }), cleanScale({ scale: 0.1, scaleAuto: false }), cleanScale({}), cleanScale(null), cleanScale('x')];
  ok('cleanScale: scale clamps to 0.25..1, scaleAuto a boolean (a saved false stays), defaults 1 and on; garbage is the default',
    cs[0].scale === 1 && cs[0].scaleAuto === true && cs[1].scale === 0.25 && cs[1].scaleAuto === false && eq(cs[2], SCALE) && eq(cs[3], SCALE) && eq(cs[4], SCALE));
  ok('cleanScale: the retired curve fields are dropped', eq(cleanScale({ mode: 'makima', tension: 0.5, bias: 1, smoothMs: 120, slewMmS: 500, scale: 0.9, scaleAuto: false }),
    { scale: 0.9, scaleAuto: false }));
  ok('cleanScale: map kept only as a fit (lower <= 0, upper >= 1, within the floor gain reach)',
    eq(cleanScale({ map: [-0.1, 1.2] }).map, [-0.1, 1.2]) && !('map' in cleanScale({ map: [0.1, 1] })) && !('map' in cleanScale({ map: [-2, 1] }))
    && !('map' in cleanScale({ map: 'x' })) && !('map' in cleanScale({})));

  const ws = wire(s, I({ scale: 0.5 }));
  ok('scale: the wire is still one knot per action, each moved about the center', ws.at === s.at && ws.pos.length === n
    && [...s.pos].every((p, i) => near(ws.pos[i], 0.5 + (p - 0.5) * 0.5, 1e-6)));
  const wm = wire(s, I({ map: [-0.1, 1.03] }));
  ok('scale: a map moves each end on its own', [...s.pos].every((p, i) => near(wm.pos[i], (p + 0.1) / 1.13, 1e-6)));
  ok('mapOf: the manual gain is the symmetric map; a map wins', eq(mapOf(I({ scale: 0.5 })), [-0.5, 1.5]) && eq(mapOf(I()), [0, 1])
    && eq(mapOf(I({ scale: 0.5, map: [-0.1, 1] })), [-0.1, 1]));
  ok('fitMap: inside the window is [0, 1]; each end past it on the 0.01 grid outward, on its own; at most the 0.25 gain reach; planner noise under 1e-4 stays on the grid',
    eq(fitMap([0, 1]), [0, 1]) && eq(fitMap([0.2, 0.7]), [0, 1]) && eq(fitMap([0.1, 1.234]), [0, 1.24]) && eq(fitMap([-0.031, 0.9]), [-0.04, 1])
    && eq(fitMap([-0.03, 1.03]), [-0.03, 1.03]) && eq(fitMap([-9, 9]), [-1.5, 2.5]) && eq(fitMap([NaN, NaN]), [0, 1]) && eq(fitMap([-5e-5, 1 + 5e-5]), [0, 1]));
  const top = parseFunscript(acts([0, 0], [260, 100], [520, 70], [780, 100]));
  const m = fitMap([0, 1.05]), mt = wire(top, I({ map: m }));
  ok('Auto, top only: the bottom actions stay where they are, the top comes in', mt.pos[0] === 0 && mt.pos[1] < 1 && mt.pos[1] > 0.95, [...mt.pos]);
}

console.log('multi-axis');
{
  const A = (...pairs) => pairs.map(([at, pos]) => ({ at, pos }));
  ok('V8 and V9 are the oscillator axes; .v8/.V9 name them', OSC_AXES.join() === 'V8,V9' && axisOf('Clip.v8.funscript').axis === 'V8'
    && axisOf('Clip.V9.funscript').base === 'Clip');
  const v11 = parseFunscript({ version: '1.1', actions: A([0, 0], [100, 100]),
    axes: [{ id: 'R0', actions: A([0, 50]) }, { id: 'V8', actions: A([0, 0], [1000, 100]) }, { id: 'V9', actions: A([0, 40]) }, { id: 'L0', actions: A([0, 1]) }] });
  ok('1.1 axes[]: V8 and V9 load, others listed ignored, L0 stays the main', Object.keys(v11.axes).join() === 'V8,V9'
    && near(posAt(v11.axes.V8, 500), 0.5) && near(v11.axes.V9.pos[0], 0.4) && v11.ignored.join() === 'R0' && v11.at.length === 2);
  const v20 = parseFunscript({ version: '2.0', actions: A([0, 10]),
    channels: { stroke: { actions: A([0, 90]) }, twist: { actions: A([0, 1]) }, v8: { actions: A([0, 70]) } } });
  ok('2.0 channels{}: actions win over channels.stroke (single-axis device), v8 loads, twist ignored',
    near(v20.pos[0], 0.1) && near(v20.axes.V8.pos[0], 0.7) && v20.ignored.join() === 'twist');
  const only = parseFunscript({ version: '2.0', channels: { stroke: { actions: A([0, 30], [50, 60]) }, V9: { actions: A([0, 20]) } } });
  ok('2.0 without actions: channels.stroke is the main axis', only.at.length === 2 && near(only.pos[1], 0.6) && near(only.axes.V9.pos[0], 0.2));
  ok('no actions and no channels.stroke: not a funscript', throws(() => parseFunscript({ channels: { roll: { actions: A([0, 1]) } } }), 'not a funscript'));
  const bad = parseFunscript({ actions: A([0, 0]), axes: [{ id: 'V8', actions: [] }] });
  ok('a broken oscillator axis is noted and dropped, never fatal', !bad.axes.V8 && bad.notes.includes('V8 axis dropped: no actions'), bad.notes.join('; '));
  ok('hasOsc: a script with either axis', hasOsc(v11) && hasOsc(only) && !hasOsc(bad) && !hasOsc(null));

  const f = (name, text) => ({ name, text });
  const main = f('Scene.funscript'), v8 = f('scene.V8.funscript'), v9 = f('Scene.v9.funscript'), roll = f('Scene.roll.funscript'), other = f('Other.v8.funscript');
  const sp = oscFiles(main, [roll, v8, other, v9]);
  ok('oscFiles: siblings by base name, case-insensitive; the rest stays', sp.osc.join() === [v8, v9].join() && sp.osc.length === 2
    && sp.rest.length === 2 && sp.rest.includes(roll) && sp.rest.includes(other));
  ok('oscFiles: no main, nothing pairs', oscFiles(null, [v8]).osc.length === 0);
  const read = (x) => (x.text === 'boom' ? Promise.reject(new Error('not a funscript')) : parseFunscript(x.text, x.name));
  const s = await withAxes(parseFunscript({ actions: A([0, 0]), axes: [{ id: 'V8', actions: A([0, 10]) }] }),
    [f('a.v8.funscript', JSON.stringify({ actions: A([0, 80]) })), f('a.v9.funscript', 'boom')], read);
  ok('withAxes: a sibling file overrides the embedded axis; a bad one is a note', near(s.axes.V8.pos[0], 0.8) && !s.axes.V9
    && s.notes.includes('V9 file dropped: not a funscript'), s.notes.join('; '));

  const axes = { V8: { at: Float64Array.of(0, 1000), pos: Float32Array.of(0, 1) } };
  const sm = oscSamples(axes, 0, 20, 100, (w) => 500 + w);
  ok('resample: a step of 20 ms over 100 ms is six samples, inclusive', sm.length === 6 && sm[5].atMs === 100);
  ok('resample: linear between actions at the mapped script time; a missing V9 rides 0',
    sm.every((x) => near(x.values[0], (500 + x.atMs) / 1000, 1e-6) && x.values[1] === 0));
  const half = oscSamples(axes, 0, 10, 50, (w) => w * 2);
  ok('resample: the map carries the rate (2x)', near(half[5].values[0], 0.1, 1e-6));
  ok('resample: held flat outside the actions; stops where the map has no time',
    oscSamples(axes, 0, 10, 10, () => 5000)[0].values[0] === 1 && oscSamples(axes, 0, 10, 50, (w) => (w < 25 ? w : NaN)).length === 3);

  let now = 1000, calls = [];
  const hub = { rate: 50, missing: false, n: 4 };
  const submit = (list) => {
    if (hub.missing) { calls.push(list); return { ok: false, sent: 0, reason: NO_STREAM }; }
    const n = Math.min(list.length, hub.n);
    calls.push(list.slice(0, n));
    return { ok: true, sent: n, rateHz: hub.rate };
  };
  const o = createOsc({ submit, now: () => now });
  const sc = { axes };
  o.tick(sc, (w) => w);
  const sent = calls.filter((l) => l.length).flat();
  ok('playing: the lead (' + OSC_LEAD_MS + ' ms) at the granted rate, in bundles of what the host takes',
    sent.length === OSC_LEAD_MS / 20 + 1 && sent[0].atMs === 1000 && sent[sent.length - 1].atMs === 1100 && calls.filter((l) => l.length).length === 2);
  calls = []; now += 20;
  o.tick(sc, (w) => w);
  ok('refilled only under half the lead: nothing at 20 ms', calls.length === 0);
  now += 60;
  o.tick(sc, (w) => w);
  const more = calls.filter((l) => l.length).flat();
  ok('then it continues the cursor, never resending', more[0].atMs === 1120 && more[more.length - 1].atMs <= now + OSC_LEAD_MS);
  calls = []; now += 1000;
  o.tick(sc, null);
  ok('paused: only the empty probe, nothing sent', calls.length === 1 && calls[0].length === 0);
  calls = [];
  o.tick(sc, (w) => w);
  ok('a restart after the tail ran out begins at now', calls.filter((l) => l.length).flat()[0].atMs === now);
  hub.missing = true;
  o.tick(sc, null);
  ok('the hub offers no osc.drive: absent', o.absent);
  calls = [];
  o.tick({ axes: {} }, (w) => w);
  ok('no oscillator axes: nothing asked, not absent', calls.length === 0 && !o.absent);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
