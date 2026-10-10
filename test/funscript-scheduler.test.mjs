/**
 * funscript-scheduler.test.mjs -- the funscript player's media clock and scheduler
 * (plugins/factory/funscript-player/clock.js, scheduler.js; bead ph-smvd.4). Node only,
 * no network: a synthetic frame stream stands in for the <video> element, a fake
 * submitSegments for the host (it packs what starts within half a 250 ms horizon).
 *
 * Constraints:
 * - Seeded randomness only: a failure reproduces.
 * - The bars are CONTRACT.md's, module scheduler.
 *
 * Run: node test/funscript-scheduler.test.mjs
 */
import {
  createMediaClock, frameSource, CLOCK_WINDOW, FALLBACK_AFTER_MS, createLoop, loopSpec, WRAP_EARLY_MS,
} from '../plugins/factory/funscript-player/clock.js';
import {
  createScheduler, applyT, strokeSpeed, TRANSIENT, STOP_MS, PREROLL_MIN_MS, PREROLL_STROKE_MS, OFFER_MAX,
  HOME_MIN_MS, LAG_MIN, COMP_STEP_MS, EXPECT_MS, knotVel,
} from '../plugins/factory/funscript-player/scheduler.js';
import { PREFS, readPrefs } from '../plugins/factory/funscript-player/prefs.js';
import { parseFunscript, posAt } from '../plugins/factory/funscript-player/funscript.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const VSYNC = 1000 / 60;
// Frame i of a `fps` stream: PTS, and the vsync it is shown on (the first at or after the
// frame's due time; `drift` is the media clock's error against the display clock).
function frames(fps, seconds, phase, drift = 0, late = () => false) {
  const out = [];
  for (let i = 0; i < fps * seconds; i++) {
    const m = (i * 1000) / fps;
    const due = 1000 + phase + m * (1 + drift);
    const shown = Math.ceil(due / VSYNC) * VSYNC + (late(i) ? VSYNC : 0);
    out.push({ m, shown, nominal: Math.ceil(due / VSYNC) * VSYNC });
  }
  return out;
}

// ---- (a) clock ---------------------------------------------------------------
console.log('(a) media clock');
{
  const err = [];
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const f = frames(30000 / 1001, 3, r() * VSYNC, 0, () => r() < 0.02);
    const c = createMediaClock();
    c.anchor(f[0].m, f[0].shown - 25, 1);   // a currentTime-style anchor, 25 ms early
    for (const x of f) {
      c.observe(x.m, x.shown);
      if (x.shown - f[0].shown >= 1000) err.push(Math.abs(c.displayAt(x.m) - x.nominal));
    }
  }
  ok('29.97 fps on 60 Hz, random phase, 2 % late frames: median |displayAt error| <= 4 ms after 1 s (20 phases)',
    quantile(err, 0.5) <= 4, 'median ' + quantile(err, 0.5).toFixed(2) + ' ms, p95 ' + quantile(err, 0.95).toFixed(2));
}
{
  // 29.97 on 60 Hz holds one frame for 3 vsyncs every 16.7 s: the shown cadence slips one
  // vsync. Phase 14.67 puts that slip at about 2 s; past the fill it is slewed, never stepped.
  const f = frames(30000 / 1001, 8, VSYNC - 2);
  const c = createMediaClock();
  c.anchor(f[0].m, f[0].shown, 1);
  let steps = 0;
  const err = f.map((x) => { steps += c.observe(x.m, x.shown) === 'step'; return { t: x.shown - f[0].shown, e: Math.abs(c.displayAt(x.m) - x.shown) }; });
  const peak = err.reduce((a, b) => (b.e > a.e ? b : a));
  const at = (dt) => err.find((x) => x.t >= peak.t + dt);
  ok('a one-vsync cadence slip is slewed (5 ms/s plus the 1 ms/s cadence), never stepped, gone 4 s later',
    peak.e > 10 && !steps && at(1000).e >= peak.e - 6.1 && at(4000).e <= 1,
    'slip ' + peak.e.toFixed(1) + ' ms at ' + (peak.t / 1000).toFixed(1) + ' s, ' + at(1000).e.toFixed(1) + ' ms 1 s on, ' + at(4000).e.toFixed(2) + ' ms 4 s on');
}
{
  // 100 ppm between the media and display clocks, presented within +-1 ms (no vsync grid:
  // the grid is the case above).
  const r = rng(7);
  const c = createMediaClock();
  c.anchor(0, 1000, 1);
  const err = [];
  for (let i = 0; i < 30 * 120; i++) {
    const m = (i * 1000) / 30;
    const due = 1000 + m * (1 + 1e-4);
    c.observe(m, due + (r() * 2 - 1));
    if (m >= 1000) err.push(Math.abs(c.displayAt(m) - due));
  }
  const mx = Math.max(...err);
  ok('100 ppm drift tracked within 3 ms over 120 s', mx <= 3, 'max ' + mx.toFixed(2) + ' ms over 12 ms of drift');
}
{
  const f = frames(30, 4, 3);
  const c = createMediaClock();
  c.anchor(f[0].m, f[0].shown, 1);
  let i = 0;
  for (; f[i].m < 2000; i++) c.observe(f[i].m, f[i].shown);
  let n = 0, step = '';
  for (; i < f.length && !step; i++) { n++; step = c.observe(f[i].m, f[i].shown + 60); }
  ok('a 60 ms jump returns step within 8 observations', step === 'step' && n <= 8, n + ' observations');
  ok('the step re-anchors at the jump', near(c.displayAt(f[i - 1].m), f[i - 1].shown + 60, 1e-9));
  const fresh = createMediaClock();
  ok('before the first anchor: not ready, NaN maps, observe ignored',
    !fresh.ready && Number.isNaN(fresh.displayAt(0)) && Number.isNaN(fresh.mediaAt(0)) && fresh.observe(0, 0) === '' && !fresh.ready);
  c.anchor(1000, 5000, 2);
  ok('rate 2 map: displayAt and mediaAt invert', c.displayAt(1200) === 5100 && c.mediaAt(5100) === 1200 && c.rate === 2);
  c.reset();
  ok('reset clears ready', !c.ready && Number.isNaN(c.displayAt(0)));
  const s = createMediaClock();
  s.anchor(0, 0, 1);
  for (let k = 1; k <= CLOCK_WINDOW; k++) s.observe(k * 33, k * 33);
  s.observe(33 * 33, 33 * 33 + 30);   // one outlier, ring full: the median does not move
  s.observe(34 * 33, 34 * 33);
  ok('a settled clock ignores one 30 ms outlier', near(s.displayAt(34 * 33), 34 * 33, 1e-9));
  const e = createMediaClock();
  e.anchor(0, 0, 1);   // the anchor frame, 70 ms ahead of the frames that follow
  const early = [1, 2, 3].map((k) => e.observe(k * 33, k * 33 + 70));
  ok('a 70 ms settling correction returns step once and moves the map',
    early.join() === 'step,,' && near(e.displayAt(99), 99 + 70, 1e-9), early.join());
}

// ---- (b) frameSource ---------------------------------------------------------
console.log('(b) frame source');
{
  let t = 0, raf = [], vfc = null;
  globalThis.requestAnimationFrame = (f) => { raf.push(f); return raf.length; };
  globalThis.cancelAnimationFrame = () => { raf = []; };
  const on = {};
  const events = { addEventListener: (k, f) => { on[k] = f; }, removeEventListener: (k) => { delete on[k]; } };
  const video = { ...events, paused: false, currentTime: 0, requestVideoFrameCallback: (f) => { vfc = f; return 1; }, cancelVideoFrameCallback: () => { vfc = null; } };
  const got = [];
  const stop = frameSource(video, (m, d) => got.push([m, d]), () => t);
  const frameAt = (ms, mt, disp) => { t = ms; const f = vfc; vfc = null; f(t, { mediaTime: mt, expectedDisplayTime: disp }); };
  const rafAt = (ms) => { t = ms; const q = raf; raf = []; q.forEach((f) => f(t)); };
  frameAt(10, 0.5, 26);
  rafAt(16);
  ok('rVFC frames report (mediaTime x 1000, expectedDisplayTime)', got.length === 1 && got[0][0] === 500 && got[0][1] === 26);
  video.currentTime = 0.8;
  rafAt(10 + FALLBACK_AFTER_MS - 1);
  ok('no rAF report while rVFC is fresh', got.length === 1);
  rafAt(10 + FALLBACK_AFTER_MS);
  ok('rAF reports currentTime after 250 ms without frames', got.length === 2 && got[1][0] === 800 && got[1][1] === 10 + FALLBACK_AFTER_MS);
  video.paused = true;
  rafAt(400);
  ok('no rAF report while paused', got.length === 2);
  ok('paused: the rAF fallback stops asking for frames', raf.length === 0);
  video.paused = false;
  video.currentTime = 1;
  on.play();
  rafAt(500);
  ok('play starts it again', raf.length === 1 && got.length === 3 && got[2][0] === 1000);
  stop();
  ok('stop cancels both callbacks and the play listener', vfc === null && raf.length === 0 && !on.play);
  const noVfc = { ...events, paused: false, currentTime: 1 };
  const g2 = [];
  t = 0;
  const stop2 = frameSource(noVfc, (m, d) => g2.push([m, d]), () => t);
  rafAt(300);
  ok('without rVFC, rAF reports after 250 ms', g2.length === 1 && g2[0][0] === 1000);
  stop2();
}
{
  // WebKit's rVFC metadata, shaped like each suspect: the guards fall back to the callback's now
  // and currentTime, and warn once with the raw fields.
  const warns = [], warn0 = console.warn;
  console.warn = (m) => warns.push(m);
  let t = 0, vfc = null;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const src = (video) => {
    const got = [];
    const stop = frameSource(video, (m, d) => got.push([m, d]), () => t);
    const at = (pn, cb, md) => { t = pn; const f = vfc; vfc = null; f(cb, md); };
    return { got, at, stop };
  };
  const vid = (o) => ({ addEventListener() {}, removeEventListener() {}, paused: false, currentTime: 10, duration: 37, playbackRate: 1, readyState: 4,
    requestVideoFrameCallback: (f) => { vfc = f; return 1; }, cancelVideoFrameCallback: () => {}, ...o });
  const a = src(vid());
  a.at(5000, 5000, { mediaTime: 10.01, expectedDisplayTime: 5016 });
  ok('sane metadata: (mediaTime x 1000, expectedDisplayTime), no warning', a.got[0][0] === 10010 && a.got[0][1] === 5016 && !warns.length);
  a.at(5033, 5033, { mediaTime: 10.043, expectedDisplayTime: 5033 + 9e6 });
  ok('expectedDisplayTime 9e6 ms off the document origin: stamped at the callback\'s now', a.got[1][0] === 10043 && a.got[1][1] === 5033);
  ok('the first trip warns once with the raw fields and the frame deltas',
    warns.length === 1 && ['now=5033', 'perfNow=5033', 'expectedDisplayTime=9005033', 'mediaTime=10.043', 'currentTime=10', 'duration=37',
      'playbackRate=1', 'readyState=4', 'dNow=33', 'dEdt=9000017', 'userAgent='].every((k) => warns[0].includes(k)), warns[0]);
  a.at(5066, 5066, { mediaTime: 10.076, expectedDisplayTime: 5066 + 9e6 });
  ok('later trips stay quiet', warns.length === 1);
  a.stop();
  const b = src(vid());
  b.at(600000, 600000, { mediaTime: 10.01, expectedDisplayTime: 600.016 });
  ok('expectedDisplayTime in seconds: stamped at the callback\'s now', b.got[0][1] === 600000);
  b.at(600033, 600033 + 9e6, { mediaTime: 10.043, expectedDisplayTime: 600049 + 9e6 });
  ok('the callback\'s now on another origin: stamped at performance.now()', b.got[1][1] === 600033);
  b.stop();
  const c = src(vid());
  c.at(1000, 1000, { mediaTime: NaN, expectedDisplayTime: 1016 });
  c.at(1033, 1033, { mediaTime: 10043, expectedDisplayTime: 1049 });
  c.at(1066, 1066, { mediaTime: 40, expectedDisplayTime: 1082 });
  ok('NaN mediaTime, mediaTime in ms, mediaTime past the duration: currentTime instead',
    c.got.every(([m]) => m === 10000), JSON.stringify(c.got));
  c.stop();
  const d = src(vid({ duration: Infinity, currentTime: 5 }));
  d.at(1000, 1000, { mediaTime: 5010, expectedDisplayTime: 1016 });
  ok('mediaTime in ms with an Infinity duration: currentTime instead', d.got[0][0] === 5000);
  d.stop();

  // The runaway end to end: off-origin frames into the clock, read at performance.now().
  const ev = vid({ currentTime: 0 }), clock = createMediaClock(), e = src(ev);
  for (let k = 0; k < 600; k++) {
    const pn = 1000 + k * 33.367, mt = k * 33.367 / 1000;
    ev.currentTime = mt;
    e.at(pn, pn, { mediaTime: mt, expectedDisplayTime: pn + 9e6 + 16 });
    const [m, ds] = e.got[k];
    if (!clock.ready) clock.anchor(m, ds, NaN); else clock.observe(m, ds);
  }
  const end = 1000 + 599 * 33.367;
  ok('a 9e6 ms origin offset no longer runs the clock away: mediaAt(now) within one frame of the media',
    Math.abs(clock.mediaAt(end) - 599 * 33.367) <= 34 && clock.rate === 1, clock.mediaAt(end).toFixed(1) + ' ms');
  e.stop();

  warns.length = 0;
  const f = createMediaClock();
  f.anchor(0, 0, Infinity);
  ok('an Infinity playbackRate anchors at rate 1', f.rate === 1);
  for (let k = 1; k <= CLOCK_WINDOW; k++) f.observe(k * 33, k * 33);
  f.observe(33 * 33, 33 * 33 + 200);   // one frame 200 ms late: the settled map leads it
  const lead = f.mediaAt(33 * 33 + 200 + 100) - (33 * 33 + 100);
  ok('mediaAt never leads the last frame by more than one frame, and warns once', lead <= 34 && warns.length === 1, lead.toFixed(1) + ' ms; ' + warns[0]);
  console.warn = warn0;
}

// ---- (c) scheduler -----------------------------------------------------------
console.log('(c) scheduler');
const T0 = { offsetMs: 0, lo: 0, hi: 1, invert: false };
ok('applyT: range and invert', applyT(0.25, T0) === 0.25 && near(applyT(0.25, { ...T0, lo: 0.2, hi: 0.6 }), 0.3, 1e-12)
  && near(applyT(0.25, { ...T0, lo: 0.2, hi: 0.6, invert: true }), 0.5, 1e-12));
ok('TRANSIENT names the retryable reasons', ['waiting for the stream grant', 'NO_CLOCK', 'NOT_SENT', 'RATE_EXCEEDED'].every((r) => TRANSIENT.has(r)) && TRANSIENT.size === 4);

// A stroke script: 0..100 every 150..450 ms over 30 s, seeded.
function strokes(seed, seconds = 30, gap = [150, 450]) {
  const r = rng(seed);
  const actions = [];
  for (let at = 0, up = true; at <= seconds * 1000; at += gap[0] + Math.round(r() * (gap[1] - gap[0])), up = !up) {
    actions.push({ at, pos: up ? 90 - Math.round(r() * 20) : 10 + Math.round(r() * 20) });
  }
  return parseFunscript({ actions }, 'strokes');
}
// The host's packing, reduced: leading items starting within half the horizon, at most 32.
function fakeHost(now, horizonMs = 250) {
  const sent = [];
  const calls = [];
  const submit = (list) => {
    calls.push(list);
    let n = 0;
    while (n < list.length && n < 32 && list[n].atMs <= now() + horizonMs / 2) n++;
    sent.push(...list.slice(0, n));
    return { ok: true, sent: n, rateHz: 50 };
  };
  return { submit, sent, calls };
}
function play(script, { rate = 1, offsetMs = 0, fromMs = 0, toMs = script.durationMs } = {}) {
  let t = 5000;
  const now = () => t;
  const host = fakeHost(now);
  const sch = createScheduler({ submit: host.submit, now });
  const clock = createMediaClock();
  clock.anchor(fromMs, t, rate);
  sch.load(script);
  sch.setTransform({ ...T0, offsetMs });
  sch.restart(clock);
  while (clock.mediaAt(t) <= toMs + 500) { sch.tick(clock); t += VSYNC; }
  return { sch, host, clock, now };
}
{
  const s = strokes(3);
  const { sch, host } = play(s);
  const gaps = host.sent.slice(1).map((g, i) => Math.abs(host.sent[i].atMs + host.sent[i].durationMs - g.atMs));
  ok('spans tile within 0.001 ms', Math.max(...gaps) <= 0.001, 'max ' + Math.max(...gaps).toExponential(1));
  ok('each span sent once, every span sent', host.sent.length === s.at.length - 1
    && new Set(host.sent.map((g) => g.atMs)).size === host.sent.length, host.sent.length + ' of ' + (s.at.length - 1));
  ok('nothing skipped on a steady clock', sch.skipped === 0);
  ok('span k is pos[k] over (at[k] - at[k-1])', host.sent.every((g, i) => near(g.norm, s.pos[i + 1], 1e-6)
    && near(g.durationMs, s.at[i + 1] - s.at[i], 1e-9)));
  ok('at most OFFER_MAX offered per tick', host.calls.every((l) => l.length <= OFFER_MAX));
  const r15 = play(s, { rate: 1.5 });
  ok('rate 1.5 divides durations', r15.host.sent.every((g, i) => near(g.durationMs, (s.at[i + 1] - s.at[i]) / 1.5, 1e-9)));
}
{
  const s = strokes(4);
  const a = play(s, { toMs: 3000 });
  const b = play(s, { toMs: 3000, offsetMs: 40 });
  const byNorm = new Map(a.host.sent.map((g) => [g.norm + ':' + g.durationMs, g.atMs]));
  const shifts = b.host.sent.filter((g) => byNorm.has(g.norm + ':' + g.durationMs)).map((g) => g.atMs - byNorm.get(g.norm + ':' + g.durationMs));
  ok('offset +40 shifts every atMs by exactly 40', shifts.length > 5 && shifts.every((d) => near(d, 40, 1e-9)), shifts.length + ' spans');
}
{
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 0 }, { at: 3000, pos: 100 }] });
  let t = 1000;
  const now = () => t;
  const host = fakeHost(now);
  const sch = createScheduler({ submit: host.submit, now });
  const clock = createMediaClock();
  sch.load(s);
  clock.anchor(1400, t, 1);   // a seek into span 2 (1000 -> 2000)
  sch.restart(clock);
  const cursor = sch.cursor;
  sch.tick(clock);
  const first = host.calls[0][0];
  ok('restart puts the in-progress span first, its start in the past', cursor === 2 && first.atMs === t - 400 && first.durationMs === 1000 && first.norm === 0);
  t += 2000;   // no ticks for 2 s: span 3 (2000 -> 3000) ends unsent
  sch.tick(clock);
  ok('a span whose end passed is skipped and counted', sch.skipped === 1 && sch.cursor === 4, 'skipped ' + sch.skipped);
  const off = createScheduler({ submit: host.submit, now });
  off.load(s);
  off.setTransform({ ...T0, offsetMs: 500 });
  clock.anchor(1400, t, 1);
  off.restart(clock);
  ok('restart reads script time at now - offset', off.cursor === 1);
}
{
  // stop: one hold of min(200, to the next action) along the script.
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 1050, pos: 0 }] });
  let t = 100;
  const now = () => t;
  const host = fakeHost(now);
  const sch = createScheduler({ submit: host.submit, now });
  const clock = createMediaClock();
  sch.load(s);
  sch.setTransform({ ...T0, lo: 0.2, hi: 0.8 });
  sch.restart(clock);
  clock.anchor(500, t, 1);
  sch.stop(clock);
  let h = host.calls.at(-1);
  ok('stop sends one hold of STOP_MS along the script', h.length === 1 && h[0].atMs === t && h[0].durationMs === STOP_MS
    && near(h[0].norm, applyT(posAt(s, 700), { ...T0, lo: 0.2, hi: 0.8 }), 1e-9));
  clock.anchor(960, t, 2);
  sch.stop(clock);
  h = host.calls.at(-1);
  ok('stop ends at the next action when it is nearer (rate 2)', h[0].durationMs === 20 && near(h[0].norm, 0.8, 1e-6));
  clock.anchor(5000, t, 1);
  sch.stop(clock);
  ok('stop past the end holds at the last action', host.calls.at(-1)[0].durationMs === STOP_MS && near(host.calls.at(-1)[0].norm, 0.2, 1e-9));
}
{
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }] });
  const t = 50;
  const sch = createScheduler({ submit: () => ({ ok: true, sent: 1 }), now: () => t });
  sch.load(s);
  ok('preroll: null within 5 % of the target', sch.preroll(500, 0.53) === null);
  const p = sch.preroll(500, 0.1);
  ok('preroll: 400 + 1200 x |delta| ms to the target', p.atMs === t && near(p.norm, 0.5, 1e-9) && near(p.durationMs, PREROLL_MIN_MS + PREROLL_STROKE_MS * 0.4, 1e-9));
  sch.setTransform({ ...T0, invert: true });
  const q = sch.preroll(250, null);
  ok('preroll: unknown position is delta 1, pending T applied', near(q.norm, 0.75, 1e-9) && q.durationMs === PREROLL_MIN_MS + PREROLL_STROKE_MS);
  sch.load(null);
  const clock = createMediaClock();
  clock.anchor(0, 0, 1);
  const r = sch.tick(clock);
  ok('load(null): tick and stop are ok and send nothing, preroll is null',
    r.ok && r.sent === 0 && sch.stop(clock).ok && sch.preroll(0, 0) === null);
  const sp = strokeSpeed(s, 500, { ...T0, lo: 0.25, hi: 0.75 }, 200);
  const pc = strokeSpeed(s, 500, T0, null);
  ok('strokeSpeed: mm/s with a span, else %/s', sp.unit === 'mm/s' && near(sp.v, 100, 1e-6) && pc.unit === '%/s' && near(pc.v, 100, 1e-6));
}
{
  // Refusal classes.
  const s = strokes(5, 5);
  let t = 0, reply = { ok: false, sent: 0, reason: 'waiting for the stream grant' };
  const logs = [];
  const sch = createScheduler({ submit: () => reply, now: () => t, log: (m, l) => logs.push([m, l]) });
  const clock = createMediaClock();
  sch.load(s);
  ok('no clock: NO_CLOCK, not fatal', (({ ok: o, reason, fatal }) => !o && reason === 'NO_CLOCK' && !fatal)(sch.tick(clock)));
  clock.anchor(0, 0, 1);
  sch.restart(clock);
  const a = sch.tick(clock);
  sch.tick(clock);
  ok('a TRANSIENT reason retries: not fatal, cursor kept, logged once', !a.ok && !a.fatal && sch.cursor === 1
    && logs.filter((l) => /grant/.test(l[0])).length === 1);
  reply = { ok: false, sent: 0, reason: 'e-stop latched' };
  const b = sch.tick(clock);
  ok('any other reason is fatal with the host words', !b.ok && b.fatal && b.reason === 'e-stop latched');
}
{
  // RATE_EXCEEDED: a 10 ms dense run is re-thinned once at the grant rate.
  const actions = [];
  for (let at = 0, i = 0; at <= 2000; at += 10, i++) actions.push({ at, pos: 50 + 40 * Math.sin(i / 3) });
  const s = parseFunscript({ actions });
  let t = 0, refuse = 2;
  const offered = [];
  const logs = [];
  const sch = createScheduler({
    now: () => t, log: (m) => logs.push(m),
    submit: (list) => { offered.push(list); return refuse-- > 0 ? { ok: false, sent: 0, reason: 'RATE_EXCEEDED', rateHz: 50 } : { ok: true, sent: 1, rateHz: 50 }; },
  });
  const clock = createMediaClock();
  clock.anchor(0, 0, 1);
  sch.load(s);
  sch.restart(clock);
  const r1 = sch.tick(clock);
  sch.tick(clock);
  sch.tick(clock);
  const after = offered[1];
  const minDur = Math.min(...after.slice(0, -1).map((g) => g.durationMs));
  ok('RATE_EXCEEDED is transient and thins the unsent tail at 1000 / rateHz', !r1.ok && !r1.fatal && minDur >= 20 && after[0].atMs === 0,
    'shortest ' + minDur + ' ms');
  ok('thinned once per rate', logs.filter((m) => /thinned/.test(m)).length === 1);
  ok('the thinned spans still tile', after.slice(1).every((g, i) => near(after[i].atMs + after[i].durationMs, g.atMs, 1e-9)));
}

{
  // One segment per action, a 1 point step included (Kinetic² zeroes no repeated target). Every knot is free (the hub
  // expects successors and carries the tangent) except the rests the sender sees: a successor over EXPECT_MS away, the end,
  // a reversal and a hold edge (ph-hcof: a free reversal was rendered moving on before its successor arrived).
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 500, pos: 40 }, { at: 1000, pos: 85 }, { at: 1500, pos: 100 },
    { at: 2000, pos: 20 }, { at: 2400, pos: 20 }, { at: 2700, pos: 21 }, { at: 3000, pos: 80 }, { at: 3800, pos: 90 }, { at: 4000, pos: 50 }] });
  const ev = (o) => play(s, o).host.sent.map((g) => g.endVel);
  const sent = play(s).host.sent, lin = ev();
  ok('one segment per action at its position, the 1 point step kept', sent.length === 9 && sent.every((g, i) => near(g.norm, s.pos[i + 1], 1e-6)),
    sent.map((g) => g.norm.toFixed(2)).join());
  ok('same-direction knots free; rests at a reversal, both hold edges, before an ' + EXPECT_MS + '+ ms successor and the last',
    same(lin, [null, null, 0, 0, 0, null, 0, 0, 0]), lin.join());
  const tr = ev({ rate: 2 });
  ok('the window is wall time: at rate 2 the 800 ms successor is 400 ms away, free', tr[6] === null && tr[8] === 0, tr.join());
  const kv = (ps, j) => knotVel((k) => k * 300, (k) => k, j, ps.length, 1, (k) => ps[k]);
  ok('knotVel: a reversal is a rest (0), a same-direction knot free (null), without positions free',
    kv([0, 100, 0], 1) === 0 && kv([0, 50, 100], 1) === null && knotVel((k) => k * 300, (k) => k, 1, 3) === null);
}
{
  // A restart that changes only timing keeps what the hub holds: re-sending the in-progress span repeats its target.
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 400, pos: 30 }, { at: 800, pos: 60 }, { at: 1200, pos: 90 }, { at: 1600, pos: 50 }] });
  let t = 1000;
  const host = fakeHost(() => t);
  const sch = createScheduler({ submit: host.submit, now: () => t });
  const clock = createMediaClock();
  clock.anchor(0, t, 1);
  sch.load(s); sch.restart(clock);
  while (clock.mediaAt(t) < 700) { sch.tick(clock); t += VSYNC; }
  const before = host.sent.length, lastEnd = host.sent.at(-1).atMs + host.sent.at(-1).durationMs;
  clock.anchor(clock.mediaAt(t), t + 30, 1);   // a 30 ms clock step
  sch.restart(clock);
  while (host.sent.length === before && clock.mediaAt(t) < 1200) { sch.tick(clock); t += VSYNC; }
  const j = host.sent[before];
  ok('timing-only restart: nothing re-sent, the next span joins the old end and absorbs the step', before === 3 && j && j.atMs === lastEnd
    && near(j.durationMs, 400 + 30, 1e-9) && near(j.norm, 0.5, 1e-6), j && j.atMs - lastEnd + ' / ' + (j && j.durationMs));
  const re = createScheduler({ submit: host.submit, now: () => t });
  re.load(s); re.restart(clock);
  while (clock.mediaAt(t) < 1000) { re.tick(clock); t += VSYNC; }
  const n0 = host.sent.length;
  re.setTransform({ ...T0, lo: 0.1 });
  re.restart(clock);
  re.tick(clock);
  ok('a restart that changes the knots re-sends the in-progress span', host.sent[n0] && near(host.sent[n0].norm, applyT(0.9, { ...T0, lo: 0.1 }), 1e-6)
    && host.sent[n0].atMs < t);
}

// ---- (d) playback: loop, home, seek transition, latency ----------------------
console.log('(d) playback');
const tiles = (sent) => Math.max(0, ...sent.slice(1).map((g, i) => Math.abs(sent[i].atMs + sent[i].durationMs - g.atMs)));
{
  // A-B loop over 1000..3000 played 3 times: the clock runs in unrolled media time. The seam (60 -> 50 -> 40) keeps its
  // direction, so its knot stays free; a reversal there would be a rest (knotVel).
  const POS = [10, 90, 50, 40, 70, 60, 20, 80];
  const s = parseFunscript({ actions: [0, 500, 1200, 1700, 2400, 2900, 3500, 4000].map((at, i) => ({ at, pos: POS[i] })) });
  const L = loopSpec(1000, 3000, 3, s.durationMs);
  let t = 0;
  const now = () => t;
  const host = fakeHost(now);
  const sch = createScheduler({ submit: host.submit, now });
  const clock = createMediaClock();
  clock.anchor(0, t, 1);
  sch.load(s); sch.setLoop(L); sch.restart(clock);
  while (clock.mediaAt(t) <= 4000 + 2 * 2000 + 500) { sch.tick(clock); t += VSYNC; }
  const ends = host.sent.map((g) => clock.mediaAt(g.atMs + g.durationMs));
  ok('loop: spans tile across both seams within 0.001 ms', tiles(host.sent) <= 0.001, 'max ' + tiles(host.sent).toExponential(1));
  const seams = host.sent.filter((g) => near(g.durationMs, 1200 - 2900 + 2000, 1e-9));
  ok('loop: each seam is one span, last knot before b to the first after a (no jump, no gap)', seams.length === 2
    && seams.every((g) => near(g.norm, s.pos[2], 1e-6)), seams.length + ' seams');
  const wraps = seams.map((g) => host.sent[host.sent.indexOf(g) - 1]);
  ok('loop: the last knot before each wrap is a rest (endVel 0), the seam knot free',
    wraps.every((g) => g.endVel === 0) && seams.every((g) => g.endVel === null), wraps.map((g) => g.endVel).join());
  ok('loop: three plays of a..b, then the tail to the last action', host.sent.length === 5 + 4 + 6 && near(ends.at(-1), 4000 + 4000, 1e-6),
    host.sent.length + ' spans, last end ' + ends.at(-1).toFixed(1));
  const fh = fakeHost(now);
  const fe = createScheduler({ submit: fh.submit, now });
  const fc = createMediaClock();
  t = 0;
  fe.load(s); fe.setLoop(loopSpec(1000, 3000, 0, s.durationMs));
  fc.anchor(1000 + 2000 * 7 + 300, t, 1);   // lap 7, 300 ms into the section
  fe.restart(fc);
  fe.tick(fc);
  const g0 = fh.sent[0];
  ok('loop forever: a restart 300 ms into lap 7 sends its in-progress span 1200 -> 1700 first, its start 100 ms back',
    g0 && near(g0.atMs, -100, 1e-9) && near(g0.durationMs, 500, 1e-9) && near(g0.norm, s.pos[3], 1e-6), JSON.stringify(g0));
  ok('loopSpec: under 1 s or a count of 1 is no loop, b bounded by the duration', loopSpec(0, 900) === null
    && loopSpec(0, 5000, 1) === null && loopSpec(0, 9e9, 0, 4000).b === 4000);
  const lp = createLoop();
  lp.set(L);
  ok('createLoop: due near b, not past b + 1 s, wrap returns a', !lp.due(2000) && lp.due(3000 - WRAP_EARLY_MS) && !lp.due(4100) && lp.wrap() === 1000 && lp.wrapping);
  const u = [2990, 1010, 1040].map((m) => lp.unroll(m));
  ok('createLoop: the landing frame after wrap() counts a lap; unrolled time continues', lp.lap === 1 && u[1] === 3010 && u[2] === 3040 && !lp.wrapping);
  lp.wrap(); lp.unroll(2990); lp.unroll(1000);
  ok('createLoop: count 3 stops repeating after lap 2', lp.lap === 2 && !lp.more() && !lp.due(2990));
  ok('createLoop: a user seek past b clears the loop, before b keeps it at lap 0', lp.seeked(1500) === L && lp.lap === 0 && lp.seeked(3200) === null && !lp.more());
  const l2 = createLoop();
  l2.set(L);
  l2.wrap();
  ok('createLoop: a loop set at the playhead wraps before any frame; the landing still counts a lap',
    l2.unroll(1020) === 3020 && l2.lap === 1 && !l2.wrapping);
}
{
  // Pause home (prefs play.home): a 20 s gap while playing follows the authored line, no home knot.
  const s = parseFunscript({ actions: [{ at: 0, pos: 10 }, { at: 1000, pos: 90 }, { at: 21000, pos: 30 }, { at: 21400, pos: 80 }] });
  const H = { point: 0.5, speed: 0.25 };
  let t = 0;
  const host = fakeHost(() => t);
  const sch = createScheduler({ submit: host.submit, now: () => t });
  const clock = createMediaClock();
  clock.anchor(0, 0, 1);
  sch.load(s); sch.setHome(H); sch.restart(clock);
  while (t < 28000) { sch.tick(clock); t += VSYNC; }
  ok('home: never inside a gap while playing; the gap is the one authored span', host.sent.length === 3 && tiles(host.sent) <= 0.001
    && near(host.sent[1].durationMs, 20000, 1e-6) && near(host.sent[1].norm, 0.3, 1e-6), host.sent.length + ' spans');
  ok('home: preroll reads the script, not the home point', near(sch.preroll(11000, null).norm, posAt(s, 11000), 1e-6));
  const g = sch.home(0.9);
  ok('home: one move to the point at speed, from here', g.atMs === t && near(g.norm, 0.5, 1e-6) && near(g.durationMs, 0.4 * 4000, 1e-6), g);
  ok('home: at least HOME_MIN_MS; none when already there; a whole stroke without a reading',
    near(sch.home(0.42).durationMs, HOME_MIN_MS, 1e-9) && sch.home(0.51) === null && near(sch.home(null).durationMs, 4000, 1e-6));
  sch.setTransform({ lo: 0.2, hi: 0.6 });
  ok('home: the point goes through the pending range', near(sch.home(0.9).norm, 0.4, 1e-6));
  sch.setHome(null);
  ok('home: off sends nothing', sch.home(0.9) === null);
}
{
  // Seek transition: a restart at media 1400 with 500 ms moves to the script's position at 1900.
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 1600, pos: 0 }, { at: 2000, pos: 100 }, { at: 3000, pos: 0 }] });
  let t = 7000;
  const host = fakeHost(() => t);
  const sch = createScheduler({ submit: host.submit, now: () => t });
  const clock = createMediaClock();
  sch.load(s);
  clock.anchor(1400, t, 1);
  sch.restart(clock, 500);
  sch.tick(clock);
  const [a, b] = host.calls[0];
  ok('seek: one segment from now over the delay to the script position delay ahead', a.atMs === 7000 && a.durationMs === 500 && near(a.norm, posAt(s, 1900), 1e-6));
  ok('seek: the landing is a rest the sender declares (endVel 0)', a.endVel === 0);
  ok('seek: the next span starts at its end and keeps its knot', b.atMs === 7500 && near(b.atMs + b.durationMs, clock.displayAt(2000), 1e-9) && near(b.norm, 1, 1e-6));
  while (t < 10000) { sch.tick(clock); t += VSYNC; }
  ok('seek: the knots inside the delay are passed over, the rest tile', tiles(host.sent) <= 0.001 && host.sent.length === 3, host.sent.length + ' sent');
  const plain = createScheduler({ submit: fakeHost(() => t).submit, now: () => t });
  plain.load(s); clock.anchor(1400, t, 1); plain.restart(clock, 0);
  ok('seek: delay 0 is the plain restart (the in-progress span first)', plain.cursor === 2);
  const r2 = createScheduler({ submit: fakeHost(() => t).submit, now: () => t });
  r2.load(s); clock.anchor(1400, t, 2); r2.restart(clock, 500);
  ok('seek: the delay is wall ms, so rate 2 aims 1000 media ms ahead', r2.cursor === 4);
}
{
  // Stop, preroll and home declare rest: nothing is scheduled after them.
  const s = parseFunscript({ actions: [{ at: 0, pos: 0 }, { at: 500, pos: 40 }, { at: 1000, pos: 85 }] });
  const t = 50, o = createScheduler({ submit: () => ({ ok: true, sent: 1 }), now: () => t });
  o.load(s); o.setHome({ point: 0.5, speed: 0.3 });
  ok('preroll and home end at rest', o.preroll(700, 0).endVel === 0 && o.home(0).endVel === 0);
}
{
  // Latency: a hub that starts every plan 14 ms late (+-1.5 ms) is compensated once 8 plans match.
  const s = strokes(9, 20);
  let t = 1000;
  const r = rng(11);
  const host = fakeHost(() => t);
  const logs = [];
  const sch = createScheduler({ submit: host.submit, now: () => t, log: (m) => logs.push(m) });
  const clock = createMediaClock();
  clock.anchor(0, t, 1);
  sch.load(s); sch.setLatency({ auto: true }); sch.restart(clock);
  const LAG = 14;
  const late = new Map();
  let nextSample = t;
  while (clock.mediaAt(t) < 20000) {
    sch.tick(clock);
    if (t >= nextSample) {
      // The plan strip every 50 ms: the running plan's elapsed, arriving 0..6 ms after the hub read it.
      nextSample += 50;
      const g = host.sent.findLast((x) => { if (!late.has(x)) late.set(x, LAG + (r() * 3 - 1.5)); return x.atMs + late.get(x) <= t; });
      if (g && g.atMs + late.get(g) + g.durationMs > t) sch.observePlan(t + r() * 6, t - (g.atMs + late.get(g)), g.durationMs);
    }
    t += VSYNC;
  }
  ok('compensation: the median lag converges on the synthetic 14 ms (plus the least transport)', near(sch.lagMs, LAG, 2.5)
    && near(sch.compMs, sch.lagMs, COMP_STEP_MS), 'lag ' + sch.lagMs.toFixed(2) + ' ms, comp ' + sch.compMs.toFixed(2));
  const a = host.sent.at(-1), m = clock.mediaAt(a.atMs + sch.compMs);
  ok('compensation: sends lead their knot by the applied amount', s.at.some((x) => near(x, m, 1e-6)), 'media ' + m.toFixed(3));
  ok('compensation: applied by restart, logged', logs.some((x) => /compensation/.test(x)));
  sch.setLatency({ auto: false });
  sch.tick(clock);
  ok('compensation: off returns the offset to the trim alone', sch.compMs === 0);
  const fresh = createScheduler({ submit: () => ({ ok: true, sent: 0 }), now: () => 0 });
  for (let i = 0; i < LAG_MIN - 1; i++) fresh.observePlan(i * 100, 0, 50);
  ok('compensation: no lag reads before ' + LAG_MIN + ' plans match', Number.isNaN(fresh.lagMs));
}
{
  // A plan strip that reads every plan 20 ms before its stamp (Nucleus val-0ep): the lag reads negative, nothing is applied.
  const s = strokes(9, 20);
  let t = 1000;
  const host = fakeHost(() => t);
  const sch = createScheduler({ submit: host.submit, now: () => t });
  const clock = createMediaClock();
  clock.anchor(0, t, 1);
  sch.load(s); sch.setLatency({ auto: true }); sch.restart(clock);
  let nextSample = t;
  while (clock.mediaAt(t) < 10000) {
    sch.tick(clock);
    if (t >= nextSample) {
      nextSample += 50;
      const g = host.sent.findLast((x) => x.atMs - 20 <= t);
      if (g && g.atMs - 20 + g.durationMs > t) sch.observePlan(t, t - (g.atMs - 20), g.durationMs);
    }
    t += VSYNC;
  }
  ok('compensation: a negative lag (an early plan strip) is never applied', sch.lagMs < -15 && sch.compMs === 0, 'lag ' + sch.lagMs.toFixed(2) + ', comp ' + sch.compMs);
}
{
  // The one clock filter (Low latency retired 2026-10-08, FUNSCRIPT.md Playback): 30 fps on 60 Hz with +-2 ms
  // compositor jitter keeps the map within 1 ms p95; a 12 ms display change is followed to 11 ms within 3 s.
  const r = rng(7), c = createMediaClock(), errs = [];
  c.anchor(0, 0, 1);
  for (let i = 1; i < 1800; i++) {
    const m = i * 1000 / 30;
    c.observe(m, Math.round(m / VSYNC) * VSYNC + (r() - 0.5) * 4);
    if (i > 60) errs.push(Math.abs(c.displayAt(m) - m));
  }
  ok('clock: the map stays within 1 ms p95 under vsync jitter', quantile(errs, 0.95) <= 1, quantile(errs, 0.95).toFixed(2) + ' ms');
  const d = createMediaClock();
  d.anchor(0, 0, 1);
  let k = 1;
  for (; k <= 64; k++) d.observe(k * 33, k * 33);
  const from = k * 33;
  for (; d.displayAt(k * 33) - k * 33 < 11 && k < 2000; k++) d.observe(k * 33, k * 33 + 12);
  ok('clock: a 12 ms display change is followed within 3 s, slewed', k * 33 - from <= 3000, k * 33 - from + ' ms');
}
{
  const fake = (seed = {}) => ({ prefs: { get: (k) => seed[k] ?? null, set: () => {} } });
  ok('prefs: play defaults (loop off, home off, seek 500 ms, latency off)', JSON.stringify(readPrefs(fake()).play) === JSON.stringify(PREFS.play)
    && PREFS.play.seekMs === 500 && !PREFS.play.home && !PREFS.play.autoLatency && Object.isFrozen(PREFS.play));
  const p = readPrefs(fake({ play: { loopCount: 3.6, homeAfterMs: 120000, homePoint: 2, homeSpeed: 0, seekMs: 777, lowLatency: true } })).play;
  ok('prefs: play values repaired to their ranges, a stored lowLatency dropped', p.loopCount === 4 && p.homeAfterMs === 60000 && p.homePoint === 1 && p.homeSpeed === 0.05
    && p.seekMs === 800 && !('lowLatency' in p), JSON.stringify(p));
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
