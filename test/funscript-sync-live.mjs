/**
 * funscript-sync-live.mjs -- the funscript player's sync measurement against a live hub
 * (docs/plugins/FUNSCRIPT.md, Tests; bead ph-smvd.4). A node session with a control token
 * runs the REAL motion door (src/model/motion.js segments) and the REAL clock and
 * scheduler over a synthetic feasible script, and reads back the hub's plan strip.
 *
 *   pass A   a perfect clock
 *   pass B   30 fps frames on a 60 Hz vsync at a random phase, fed through observe()
 *   each     play, a seek, a rate change to 1.5, a pause (one hold), resume, stop
 *
 * For each observed plan: start = arrival - plan.elapsed (the least delayed sample),
 * against the commanded start (adherence) and the instant its knot is on screen (script timeline),
 * matched to a sent segment by duration (1 ms) and start (100 ms). Bars (first, recorded
 * on the epic, tightened later): adherence median <= 30 ms, spread p95 <= 5 ms around it;
 * script-timeline spread p95 <= 2 ms (A), 6 ms (B); coverage 98 % of segments >= 50 ms that
 * were neither clipped nor superseded;
 * no plan from a superseded segment after the seek, none between the hold's end and resume.
 * The same-direction run's interior speed ratio is printed; under 0.3 is WARN (G3), never FAIL.
 *
 * Constraints:
 * - Never in `npm run check`. Spare ports only (never 82/80 on this host's sim); the hub is
 *   started and stopped by the caller.
 * - Fields bind by role. --horizon writes the hub's `schedule_horizon` setting by name: the
 *   registry gives that setting no role (test-only device knowledge).
 * - Exit 0 pass, 1 fail, 2 skipped (no hub answer, no segments STREAM, no segments door).
 *
 * Run: node test/funscript-sync-live.mjs --port P --http P+7 [--host 127.0.0.1] [--horizon 250|500|1000]
 */
import { createSession, PRIORITY } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';
import { createMotionDoor } from '../src/model/motion.js';
import { createMediaClock } from '../plugins/factory/funscript-player/clock.js';
import { createScheduler } from '../plugins/factory/funscript-player/scheduler.js';
import { parseFunscript } from '../plugins/factory/funscript-player/funscript.js';

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const HOST = arg('--host', '127.0.0.1');
const PORT = +arg('--port', 0);
const HTTP = +arg('--http', PORT + 7);
const HORIZON = arg('--horizon', null);
if (!PORT) { console.log('usage: node test/funscript-sync-live.mjs --port P --http P+7 [--horizon 250|500|1000]'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const skip = (why) => { console.log('[SKIP] funscript-sync-live: ' + why); process.exit(2); };
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- the script: strokes, a fast section, a five-knot same-direction run, a 2 s hold, random.
// Every chord is held to `vmax` norm/s, half the hub's input speed limit, so the hub's
// planner (peak 1.875 x chord for a quintic) never stretches a segment.
const RUN = [10000, 10300, 10600, 10900, 11200];   // the same-direction run's knots (ms)
function script(vmax) {
  const r = rng(11);
  const a = [];
  const amp = (gapMs, want) => Math.min(want, (vmax * gapMs) / 1000);
  let t = 0, up = true;
  for (let g; t < 8000; t += g, up = !up) { g = 400 + Math.round(r() * 200); a.push({ at: t, pos: 50 + (up ? 50 : -50) * amp(400, 0.6) }); }
  for (; t < 9850; t += 150, up = !up) a.push({ at: t, pos: 50 + (up ? 50 : -50) * amp(150, 0.3) });
  const run = amp(300, 0.2);
  RUN.forEach((at, i) => a.push({ at, pos: 100 * (0.5 - 2 * run + run * i) }));
  a.push({ at: 13200, pos: 100 * (0.5 + 2 * run) });
  let p = 0.5;
  for (t = 13600; t < 45000;) {
    const g = 200 + Math.round(r() * 500);
    const d = (r() * 2 - 1) * amp(g, 0.8);
    p = Math.min(0.9, Math.max(0.1, p + d));
    a.push({ at: (t += g), pos: 100 * p });
  }
  return { script: parseFunscript({ actions: a }, 'sync-live'), runChord: run / 0.3 };
}

// ---- session ------------------------------------------------------------------------
const s = createSession({
  host: HOST, port: PORT, clientKind: 'test', clientName: 'funscript-sync-live', autoReconnect: false,
  token: () => acquireToken(HOST + ':' + HTTP), subscriptions: [],
});
const live = new Promise((resolve) => { s.on('live', () => resolve(true)); setTimeout(() => resolve(false), 8000); });
s.on('close', () => {});
s.connect();
if (!(await live)) skip('no hub answered on ' + HOST + ':' + PORT);
console.log('hub ' + (s.state.identity && s.state.identity.hub_instance_id) + ' ' + (s.state.identity && s.state.identity.fw_version)
  + ' on ' + HOST + ':' + PORT);

const model = buildSettingsModel(s.catalog);
const field = (role) => (model.byRole.get(role) || [])[0] || null;
const plan = { elapsed: field(ROLE.planElapsed), duration: field(ROLE.planDuration), velocity: field(ROLE.planVelocity) };
if (!plan.elapsed || !plan.duration) skip('hub tags no plan.elapsed and plan.duration');
const US = { us: 1e-3, ms: 1, s: 1000 };
const ms = (f, sm) => reportedValue(f, sm) * (US[f.unit] || 1);
const nacks = [];
s.on('nack', (...x) => nacks.push(x));

if (HORIZON) {
  const f = model.fields.find((x) => x.name === 'schedule_horizon');
  if (!f) skip('hub has no schedule_horizon setting');
  await s.sendIntent(f.writeChannel, { [f.settingKey]: [250, 500, 1000].indexOf(+HORIZON) });
}

const planCh = plan.elapsed.channelId;
const obs = [];   // {at: arrival ms, start, dur, vel}
const samples = {};
s.on('state', (ch, sm) => {
  samples[ch] = sm;
  if (ch !== planCh) return;
  const at = performance.now();
  const dur = ms(plan.duration, sm), el = ms(plan.elapsed, sm);
  if (Number.isFinite(dur) && Number.isFinite(el) && dur > 0) {
    obs.push({ at, start: at - el, dur, vel: plan.velocity ? reportedValue(plan.velocity, sm) : NaN });
  }
});
const planEntry = s.catalog.find((e) => e.id === planCh);
const lim = { v: field(ROLE.limitInputSpeed), lo: field(ROLE.windowMin), hi: field(ROLE.windowMax) };
s.subscribe([[planCh, (planEntry && planEntry.maxRateHz) || 50, PRIORITY.elevated],
  ...[...new Set(Object.values(lim).filter(Boolean).map((f) => f.channelId))].map((c) => [c, 0, PRIORITY.background])]);

const door = createMotionDoor({
  session: () => s, entries: () => s.catalog, setpoint: () => ({ ok: false, reason: 'setpoint is not under test' }),
  log: (level, msg) => console.log('        door: ' + msg), now: () => performance.now(),
});
if (typeof door.segments !== 'function') skip('the host door has no segments member yet');
let warm;
for (let i = 0; i < 60; i++) { warm = door.segments([]); if (warm.ok || warm.reason !== 'waiting for the stream grant') break; await sleep(50); }
if (!warm.ok) skip(warm.reason);
const st = [...s.state.grantedPublishes.values()].find((g) => g.scheduleHorizonMs);
const LAT = ((st && st.scheduleLatencyUs) || 0) / 1000;
console.log('grant: rate ' + warm.rateHz + ' Hz, latency ' + LAT + ' ms, horizon ' + (st && st.scheduleHorizonMs) + ' ms');
if (HORIZON) ok('the grant carries the asked horizon', st && st.scheduleHorizonMs === +HORIZON);

// ---- one pass -------------------------------------------------------------------------
const val = (f) => (f ? reportedValue(f, samples[f.channelId]) : NaN);
for (let i = 0; i < 40 && lim.v && !Number.isFinite(val(lim.v)); i++) await sleep(50);
const vmax = 0.5 * val(lim.v) / (val(lim.hi) - val(lim.lo));
const { script: S, runChord } = script(vmax > 0 ? vmax : 0.5);
console.log('script: ' + S.at.length + ' actions, chords held to ' + (vmax > 0 ? vmax.toFixed(2) : '0.50 (no limit reported)') + ' norm/s');

const VSYNC = 1000 / 60;

async function pass(name, frames) {
  const sent = [];
  let truth = null, clock = createMediaClock(), steps = 0;
  const submit = (list) => {
    const r = door.segments(list);
    const t = performance.now();
    if (r.ok) {
      for (const g of list.slice(0, r.sent)) {
        const m = clock.mediaAt(g.atMs);
        sent.push({ ...g, sentAt: t, clipped: g.atMs < t + LAT, truth: onScreen(m), m });
      }
    }
    return r;
  };
  const sch = createScheduler({ submit, log: (msg) => console.log('        scheduler: ' + msg) });
  sch.load(S);
  const vphase = Math.random() * VSYNC;
  let k = 0, waitAnchor = false;
  // The script timeline: the line through the shown frames (their median offset from the
  // event's ideal line), the map a perfect clock would hold. Per-frame vsync placement (up to
  // a vsync at rate 1.5) is the display's, not the clock's.
  const shownOf = (pts) => Math.ceil((truth.T0 + (pts - truth.m0) / truth.rate - vphase) / VSYNC) * VSYNC + vphase;
  const onScreen = (m) => truth.T0 + truth.q + (m - truth.m0) / truth.rate;
  const mediaNow = () => truth.m0 + (performance.now() - truth.T0) * truth.rate;
  // A restart or a hold supersedes every sent segment not started yet (RFC-087 item 5).
  const supersede = () => { const t = performance.now(); for (const g of sent) if (g.atMs >= t) g.superseded = true; };
  function begin(m0, rate) {
    supersede();
    truth = { T0: performance.now(), m0, rate, q: 0 };
    if (frames) {
      const k0 = Math.ceil(m0 / (1000 / 30));
      const r = Array.from({ length: 60 }, (_, j) => { const pts = ((k0 + j) * 1000) / 30; return shownOf(pts) - truth.T0 - (pts - m0) / rate; });
      truth.q = q(r, 0.5);
    }
    if (!frames) { clock.anchor(m0, truth.T0, rate); sch.restart(clock); return; }
    k = Math.ceil(m0 / (1000 / 30));
    waitAnchor = true;
  }
  function feed() {
    const t = performance.now();
    for (;;) {
      const pts = (k * 1000) / 30;
      const shown = shownOf(pts);
      if (shown > t) return;
      k++;
      if (waitAnchor) { clock.anchor(pts, shown, truth.rate); sch.restart(clock); waitAnchor = false; continue; }
      if (clock.observe(pts, shown) === 'step') { steps++; sch.restart(clock); }
    }
  }
  async function play(untilMs) {
    const end = performance.now() + untilMs;
    while (performance.now() < end) {
      if (frames) feed();
      if (!waitAnchor) {
        const r = sch.tick(clock);
        if (!r.ok && r.fatal) { ok(name + ': tick refused', false, r.reason); return; }
      }
      await sleep(4);
    }
  }
  const marks = {};
  begin(0, 1);
  await play(16000);
  begin(25000, 1);
  await play(5000);
  begin(mediaNow(), 1.5);
  await play(5000);
  const mp = mediaNow();
  supersede();
  const hold = sch.stop(clock);
  const holdSeg = sent[sent.length - 1];
  marks.holdEnd = holdSeg ? Math.max(holdSeg.atMs, holdSeg.sentAt + LAT) + holdSeg.durationMs : performance.now();
  await sleep(1500);
  marks.resume = performance.now();
  begin(mp, 1.5);
  await play(3000);
  supersede();
  sch.stop(clock);
  await sleep(600);
  return { sent, marks, hold, steps, skipped: sch.skipped };
}

function judge(name, r, from, to, spreadBar) {
  // Plans: consecutive samples of one duration and start.
  const plans = [];
  for (const o of obs.filter((x) => x.at >= from && x.at <= to)) {
    const p = plans[plans.length - 1];
    if (p && Math.abs(p.dur - o.dur) < 0.01 && Math.abs(p.start - o.start) < 15) { p.start = Math.min(p.start, o.start); p.n++; }
    else plans.push({ dur: o.dur, start: o.start, n: 1 });
  }
  const used = new Set();
  const matched = [];
  for (const p of plans) {
    let best = -1, bd = 100;
    r.sent.forEach((g, i) => {
      if (used.has(i) || g.clipped || g.superseded || Math.abs(g.durationMs - p.dur) > 1) return;
      const d = Math.abs(p.start - g.atMs);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { used.add(best); matched.push({ p, g: r.sent[best], i: best }); } else p.unmatched = true;
  }
  const adh = matched.map((x) => x.p.start - x.g.atMs);
  const med = q(adh, 0.5);
  const spread = q(adh.map((x) => Math.abs(x - med)), 0.95);
  const tl = matched.map((x) => x.p.start - x.g.truth);
  const tlMed = q(tl, 0.5);
  const tlSpread = q(tl.map((x) => Math.abs(x - tlMed)), 0.95);
  const due = r.sent.filter((g) => !g.clipped && !g.superseded && g.durationMs >= 50);
  const cov = due.filter((g) => used.has(r.sent.indexOf(g))).length / Math.max(1, due.length);
  if (process.env.SYNC_DEBUG) {
    console.log('    adherence ' + adh.map((x) => x.toFixed(1)).sort((a, b) => a - b).join(' '));
    console.log('    samples per plan ' + matched.map((x) => x.p.n).join(' '));
    for (const g of due.filter((x) => !used.has(r.sent.indexOf(x)))) {
      const near = plans.filter((p) => Math.abs(p.start - g.atMs) < 300).map((p) => (p.start - g.atMs).toFixed(1) + '/' + p.dur.toFixed(1) + (p.unmatched ? 'U' : ''));
      console.log('    missing m ' + g.m.toFixed(1) + ' dur ' + g.durationMs.toFixed(2) + ' norm ' + g.norm.toFixed(2) + ' near: ' + near.join(' '));
    }
  }
  console.log(name + ': ' + r.sent.length + ' sent, ' + plans.length + ' plans, ' + matched.length + ' matched, '
    + plans.filter((p) => p.unmatched).length + ' unmatched, skipped ' + r.skipped + ', clock steps ' + r.steps);
  ok(name + ': hub adherence median <= 30 ms', med <= 30, 'median ' + med.toFixed(2) + ' ms');
  ok(name + ': hub adherence spread p95 <= 5 ms', spread <= 5, 'p95 ' + spread.toFixed(2) + ' ms');
  ok(name + ': script-timeline spread p95 <= ' + spreadBar + ' ms', tlSpread <= spreadBar,
    'p95 ' + tlSpread.toFixed(2) + ' ms around ' + tlMed.toFixed(2));
  ok(name + ': coverage >= 98 % of segments >= 50 ms', cov >= 0.98, (cov * 100).toFixed(1) + ' % of ' + due.length);
  const stale = r.sent.filter((g) => g.superseded
    && plans.some((p) => Math.abs(p.dur - g.durationMs) <= 1 && Math.abs(p.start - g.atMs - med) <= 10));
  ok(name + ': seek, rate change and pause clean (no superseded segment plays)', stale.length === 0,
    stale.length + ' of ' + r.sent.filter((g) => g.superseded).length + ' superseded played');
  ok(name + ': pause sends one hold', r.hold.ok && r.hold.sent === 1, r.hold.reason);
  const during = plans.filter((p) => p.start > r.marks.holdEnd + 2 && p.start < r.marks.resume);
  ok(name + ': pause clean (nothing between the hold\'s end and resume)', during.length === 0, during.length + ' plans');
  // G3: |velocity| at the run's interior knots against the run's chord speed.
  const ivals = [];
  for (const knot of RUN.slice(1, -1)) {
    const g = r.sent.find((x) => Math.abs(x.m - knot) < 0.5);
    if (!g) continue;
    const near = obs.filter((o) => Math.abs(o.at - g.atMs) <= 25 && Number.isFinite(o.vel)).map((o) => Math.abs(o.vel));
    if (near.length) ivals.push(Math.min(...near));
  }
  if (ivals.length) {
    const ratio = Math.min(...ivals) / runChord;
    console.log('  [' + (ratio < 0.3 ? 'WARN' : 'INFO') + '] ' + name + ': same-direction run interior speed ratio '
      + ratio.toFixed(2) + (ratio < 0.3 ? ' (G3: the hub rests at each knot)' : ''));
  } else console.log('  [INFO] ' + name + ': same-direction run: no velocity sample near an interior knot');
}

try {
  let t = performance.now();
  const a = await pass('A', false);
  judge('pass A (perfect clock)', a, t, performance.now(), 2);
  await sleep(1000);
  t = performance.now();
  const b = await pass('B', true);
  judge('pass B (30 fps on 60 Hz)', b, t, performance.now(), 6);
  ok('no NACK', nacks.length === 0, nacks.length ? JSON.stringify(nacks[0]).slice(0, 80) : '');
} finally {
  s.close();
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
