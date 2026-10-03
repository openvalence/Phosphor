/**
 * funscript-core.test.mjs -- the funscript player's pure core (ph-smvd.1,
 * plugins/factory/funscript-player/funscript.js against CONTRACT.md "core").
 *
 * Fails if parsing stops sorting, deduping (last wins), clamping, dropping
 * non-finite actions, applying `inverted`, noting `range`, listing an `axes`
 * array, or refusing garbage in words; if a span over MAX_SPAN_MS survives;
 * if axis naming, file pairing, interpolation, the binary search, thinning,
 * heat bins or the time format drift; if an interpolation mode leaves its
 * actions, a monotone mode overshoots, step stops holding, PCHIP or makima
 * drift from MultiFunPlayer, linear stops being the Script itself, or the
 * slew limit or smoothing window misbehave (interp.js, ph-smvd.10).
 *
 * Run: node test/funscript-core.test.mjs
 */
import {
  MAX_SPAN_MS, MAX_ACTIONS, AXES, parseFunscript, axisOf, pairFiles, posAt, indexAfter, speedAt, peakSpeed, thin, heat, fmtTime,
} from '../plugins/factory/funscript-player/funscript.js';
import { INTERP, MODES, STEP_MS, cleanInterp, sample, shape } from '../plugins/factory/funscript-player/interp.js';

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

console.log('interp');
{
  const I = (mode, x = {}) => ({ ...INTERP, mode, ...x });
  // Uneven spacing, reversals, a plateau, a same-direction run.
  const s = parseFunscript(acts([0, 10], [180, 90], [260, 20], [700, 20], [760, 60], [1000, 75], [1100, 100],
    [1500, 0], [1530, 40], [2200, 35], [2600, 80]));
  const n = s.at.length;
  const grid = (fn) => { for (let i = 1; i < n; i++) for (let j = 1; j < 20; j++) fn(i, s.at[i - 1] + (s.at[i] - s.at[i - 1]) * j / 20); };

  ok('linear: shape returns the same Script (scheduler byte-identical)', shape(s, I('linear')) === s && shape(s, undefined) === s);
  let same = true;
  grid((i, t) => { if (sample(s, I('linear'), t) !== posAt(s, t)) same = false; });
  ok('linear: sample is posAt exactly', same && sample(s, I('linear'), -5) === s.pos[0] && sample(s, I('linear'), 9e9) === s.pos[n - 1]);

  let hold = true;
  grid((i, t) => { if (sample(s, I('step'), t) !== s.pos[i - 1]) hold = false; });
  ok('step holds until the next action', hold && sample(s, I('step'), s.at[3]) === s.pos[3]);

  for (const mode of Object.keys(MODES)) {
    let knots = true;
    for (let i = 0; i < n; i++) if (!near(sample(s, I(mode), s.at[i]), s.pos[i], 1e-6)) knots = false;
    let inUnit = true;
    grid((i, t) => { const y = sample(s, I(mode), t); if (!(y >= 0 && y <= 1)) inUnit = false; });
    ok(mode + ': passes through every action, stays in 0..1', knots && inUnit);
  }

  for (const mode of ['step', 'smoothstep', 'cosine', 'monotone', 'pchip']) {
    let worst = 0;
    grid((i, t) => {
      const y = sample(s, I(mode), t), lo = Math.min(s.pos[i - 1], s.pos[i]), hi = Math.max(s.pos[i - 1], s.pos[i]);
      worst = Math.max(worst, lo - y, y - hi);
    });
    ok(mode + ': never overshoots its two actions', worst <= 1e-9, 'worst ' + worst);
  }
  let over = 0;
  grid((i, t) => { const y = sample(s, I('catmull'), t); over = Math.max(over, y - Math.max(s.pos[i - 1], s.pos[i])); });
  ok('catmull overshoots on this set (the monotone checks have teeth)', over > 1e-3, 'overshoot ' + over);

  const mid = (mode, x) => sample(s, I(mode, x), (s.at[1] + s.at[2]) / 2);
  ok('smoothstep and cosine: half way at the span middle', near(mid('smoothstep'), (s.pos[1] + s.pos[2]) / 2, 1e-6)
    && near(mid('cosine'), (s.pos[1] + s.pos[2]) / 2, 1e-6));
  let tens = true;
  grid((i, t) => { if (!near(sample(s, I('catmull', { tension: 1 }), t), sample(s, I('smoothstep'), t), 1e-6)) tens = false; });
  ok('catmull tension 1 is smoothstep (zero slopes)', tens);
  ok('catmull tension changes the curve', !near(mid('catmull', { tension: 0 }), mid('catmull', { tension: 0.5 }), 1e-4));
  ok('hermite bias changes the curve', !near(mid('hermite', { bias: -1 }), mid('hermite', { bias: 1 }), 1e-4));

  for (const mode of ['catmull', 'hermite', 'monotone', 'pchip', 'akima', 'makima']) {
    const d0 = (sample(s, I(mode), s.at[0] + 0.01) - s.pos[0]) / 0.01;
    const d1 = (s.pos[n - 1] - sample(s, I(mode), s.at[n - 1] - 0.01)) / 0.01;
    ok(mode + ': the script starts and ends at rest', Math.abs(d0) < 1e-4 && Math.abs(d1) < 1e-4, d0 + ' ' + d1);
  }

  // MultiFunPlayer reference, transcribed from MathUtils.cs and KeyframeCollection.cs at 36c08fb (pm2 quirk kept).
  const mfp = (type, x) => {
    const K = Array.from(s.at, (a, i) => ({ x: a, y: s.pos[i] }));
    let i = 0;
    while (i + 1 < K.length - 1 && K[i + 1].x <= x) i++;
    const take = (j, a, b) => (j >= 0 && j < K.length ? K[j] : { x: 3 * b.x - 2 * a.x, y: b.y });
    const herm = (x0, y0, x1, y1, s0, s1) => {
      const d = x1 - x0, dx = x - x0, t = dx / d, r = 1 - t;
      return r * r * (y0 * (1 + 2 * t) + s0 * dx) + t * t * (y1 * (3 - 2 * t) - d * s1 * r);
    };
    const p0 = K[i], p1 = K[i + 1], pm1 = take(i - 1, p1, p0), pp1 = take(i + 2, p0, p1);
    const ch = (a, b) => (b.y - a.y) / (b.x - a.x);
    if (type === 'pchip') {
      const sl = (a, b, c) => {
        const h0 = b.x - a.x, d0 = ch(a, b), h1 = c.x - b.x, d1 = ch(b, c), w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
        const v = (w1 + w2) / (w1 / d0 + w2 / d1);
        return !Number.isFinite(v) || d0 * d1 < 0 ? 0 : v;
      };
      return herm(p0.x, p0.y, p1.x, p1.y, sl(pm1, p0, p1), sl(p0, p1, pp1));
    }
    const pm2 = take(i - 2, pm1, p1), pp2 = take(i + 3, p1, pp1);
    const m = [ch(pm2, pm1), ch(pm1, p0), ch(p0, p1), ch(p1, pp1), ch(pp1, pp2)];
    const sl = (a, b, c, d) => {
      const w1 = Math.abs(d - c) + Math.abs(d + c) / 2, w2 = Math.abs(b - a) + Math.abs(b + a) / 2;
      const v = (w1 * b + w2 * c) / (w1 + w2);
      return Number.isFinite(v) ? v : 0;
    };
    return herm(p0.x, p0.y, p1.x, p1.y, sl(m[0], m[1], m[2], m[3]), sl(m[1], m[2], m[3], m[4]));
  };
  const unit = (y) => Math.min(1, Math.max(0, y));
  let pw = 0, mw = 0, mq = 0;
  grid((i, t) => {
    pw = Math.max(pw, Math.abs(sample(s, I('pchip'), t) - unit(mfp('pchip', t))));
    const d = Math.abs(sample(s, I('makima'), t) - unit(mfp('makima', t)));
    if (i >= 3) mw = Math.max(mw, d); else mq = Math.max(mq, d);
  });
  ok('pchip matches MultiFunPlayer on every span', pw < 1e-9, 'worst ' + pw);
  ok('makima matches MultiFunPlayer from the third span on', mw < 1e-9, 'worst ' + mw);
  ok('makima: the first two spans differ only by the pm2 fix', mq > 1e-4 && mq < 0.1, 'diff ' + mq);

  const cat = shape(s, I('catmull'));
  const kept = [...s.at].every((a) => cat.at.includes(a));
  let err = 0;
  for (let i = 0; i < cat.at.length; i++) err = Math.max(err, Math.abs(cat.pos[i] - sample(s, I('catmull'), cat.at[i])));
  let piece = 0;
  for (let i = 1; i < cat.at.length; i++) piece = Math.max(piece, cat.at[i] - cat.at[i - 1]);
  ok('shape: every action kept', kept);
  ok('shape: every knot on the curve', err < 1e-6, 'err ' + err);
  ok('shape: about one knot per STEP_MS on a curve', cat.at.length >= s.durationMs / STEP_MS / 2 && piece < 200,
    cat.at.length + ' knots, longest ' + piece);
  ok('shape: a new Script, the source untouched', cat !== s && cat.at.length > n && s.at.length === n
    && cat.durationMs === s.durationMs);

  const gap = parseFunscript(acts([0, 0], [100, 50], [120100, 50], [120200, 100]));
  const g = shape(gap, I('pchip'));
  let longest = 0;
  for (let i = 1; i < g.at.length; i++) longest = Math.max(longest, g.at[i] - g.at[i - 1]);
  ok('shape: a flat hold merges back, spans <= MAX_SPAN_MS', g.at.length < 20 && longest <= MAX_SPAN_MS,
    g.at.length + ' knots, ' + longest);

  const fast = parseFunscript(acts([0, 0], [100, 100], [200, 0], [300, 100], [400, 0], [1400, 0]));
  const ctx = { spanMm: 100, lo: 0, hi: 1 };
  const sl = shape(fast, I('linear', { slewMmS: 500 }), ctx);
  let v = 0;
  for (let i = 1; i < sl.at.length; i++) v = Math.max(v, Math.abs(sl.pos[i] - sl.pos[i - 1]) * 100 * 1000 / (sl.at[i] - sl.at[i - 1]));
  ok('slew: no chord past the limit in mm/s', v <= 500 * (1 + 1e-6) && v > 400, v.toFixed(3) + ' mm/s');
  ok('slew: the limit scales with Range',
    Math.max(...shape(fast, I('linear', { slewMmS: 500 }), { spanMm: 100, lo: 0, hi: 0.5 }).pos) > Math.max(...sl.pos));
  ok('slew: catches up before a long hold ends', near(posAt(sl, 1400), 0, 1e-6));
  ok('slew: off without the rail length', shape(fast, I('linear', { slewMmS: 500 }), {}) === fast);
  const mk = shape(fast, I('makima', { slewMmS: 500 }), ctx);
  let vm = 0;
  for (let i = 1; i < mk.at.length; i++) vm = Math.max(vm, Math.abs(mk.pos[i] - mk.pos[i - 1]) * 100 * 1000 / (mk.at[i] - mk.at[i - 1]));
  ok('slew applies after a curved mode', vm <= 500 * (1 + 1e-6), vm.toFixed(3) + ' mm/s');

  const sq = parseFunscript(acts([0, 0], [1000, 0], [1001, 100], [2000, 100]));
  const sm = shape(sq, I('linear', { smoothMs: 200 }));
  ok('smoothing: an edge becomes a ramp the window wide', near(posAt(sm, 880), 0, 1e-3) && near(posAt(sm, 1121), 1, 1e-3)
    && near(posAt(sm, 1000.5), 0.5, 0.01), [880, 1000.5, 1121].map((t) => posAt(sm, t).toFixed(3)).join());
  const tri = parseFunscript(acts([0, 0], [500, 100], [1000, 0]));
  const st = shape(tri, I('linear', { smoothMs: 300 }));
  let peakAt = 0;
  for (let i = 1; i < st.at.length; i++) if (st.pos[i] > st.pos[peakAt]) peakAt = i;
  ok('smoothing: centered, no lag', near(st.at[peakAt], 500, STEP_MS / 2) && st.pos[peakAt] < 1, st.at[peakAt] + ' ' + st.pos[peakAt]);
  const flat = parseFunscript(acts([0, 40], [800, 40]));
  ok('smoothing: a constant stays constant', [...shape(flat, I('cosine', { smoothMs: 500 })).pos].every((p) => near(p, 0.4, 1e-6)));

  const c = cleanInterp({ mode: 'bogus', tension: 9, bias: -9, smoothMs: NaN, slewMmS: '5' });
  ok('cleanInterp repairs', c.mode === 'linear' && c.tension === 1 && c.bias === -1 && c.smoothMs === 0 && c.slewMmS === 0
    && cleanInterp(null).mode === 'linear' && cleanInterp({ mode: 'makima' }).mode === 'makima');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
