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
  createMediaClock, frameSource, CLOCK_WINDOW, FALLBACK_AFTER_MS,
} from '../plugins/factory/funscript-player/clock.js';
import {
  createScheduler, applyT, strokeSpeed, TRANSIENT, STOP_MS, PREROLL_MIN_MS, PREROLL_STROKE_MS, OFFER_MAX,
} from '../plugins/factory/funscript-player/scheduler.js';
import { parseFunscript, posAt } from '../plugins/factory/funscript-player/funscript.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
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
  const video = { paused: false, currentTime: 0, requestVideoFrameCallback: (f) => { vfc = f; return 1; }, cancelVideoFrameCallback: () => { vfc = null; } };
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
  stop();
  ok('stop cancels both callbacks', vfc === null && raf.length === 0);
  const noVfc = { paused: false, currentTime: 1 };
  const g2 = [];
  t = 0;
  const stop2 = frameSource(noVfc, (m, d) => g2.push([m, d]), () => t);
  rafAt(300);
  ok('without rVFC, rAF reports after 250 ms', g2.length === 1 && g2[0][0] === 1000);
  stop2();
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

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
