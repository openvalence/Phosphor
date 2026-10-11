/**
 * meteor-live.mjs -- the rail's comet (RailWidget) against a private valencesim running its
 * pattern at three speeds, at 4K (1920 x 1080 CSS at device scale 2).
 *
 * Per speed: the display lag (the shift that lays the painted head over the arrivals), the
 * render delay, the wire's step jitter (each sample's travel against its neighbors' mean, RMS,
 * on fast steps: an alias between two paces reads 0.5 and up, bd val-7f5), the head's judder
 * (each frame's speed against its neighbors' mean, p95, on frames in one-way motion), the head's distance off the samples at that lag (px), the tail's
 * length, the ghost against the plan, the draw cost, and a frame series of the rail
 * (evidence/meteor-<label>-<speed>-<n>.png). Reduced motion at full speed keeps a short tail
 * (meteor-<label>-still.png). Then the pattern stops: the tail collapses and
 * the rail asks for no frames.
 *
 * The probe columns past [5] (tail px, ghost x, draw ms) exist only on a build that has
 * them; a build without (PHOSPHOR_DIST pointing at an older one) is measured, not judged.
 *
 * COMMANDS MOTION: starts the sim's own pattern. SKIPS (exit 0) without the exe.
 * Run: node test/meteor-live.mjs [--label after]   (build first: npm run build:only)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE } from './dist.mjs';
import { startSim, serveBundle, SIM } from './live-sim.mjs';
import { createSession, PRIORITY } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';

const args = process.argv.slice(2);
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'after';
const SPEEDS = [15, 45, 100];
const RECORD_MS = 3000;
// One 4K frame at 240 Hz is 4.17 ms; the comet may spend a fifth of it.
const DRAW_BUDGET_MS = 0.8;
mkdirSync(EVIDENCE, { recursive: true });

const own = await startSim();
if (!own) { console.log('SKIP: no valencesim at ' + SIM); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');

// ---- the driver: starts and stops the sim's pattern ------------------------------------
const samples = {};
const drv = createSession({
  host: '127.0.0.1', port: own.port, clientKind: 'webui', clientName: 'meteor driver', autoReconnect: false,
  token: () => acquireToken('127.0.0.1:' + own.http), subscriptions: [],
});
drv.on('state', (ch, v) => { samples[ch] = v; });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('driver: no LIVE')), 8000); drv.on('live', () => { clearTimeout(t); res(); }); drv.connect(); });
const M = buildSettingsModel(drv.catalog);
const field = (r) => (M.byRole.get(r) || [])[0];
const RUN = field(ROLE.patternRunning), SPEED = field(ROLE.patternSpeed), DEPTH = field(ROLE.patternDepth), STROKE = field(ROLE.patternStroke);
const set = (f, v) => drv.sendIntent(f.writeChannel, { [f.settingKey]: v });

// ---- the page --------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(await serveBundle(own.port, own.http));
await page.waitForSelector('.spine-rail-host canvas', { timeout: 25000 });
await sleep(1500);
const rail = page.locator('.spine-rail-host');

async function record(ms) {
  await page.evaluate(() => { window.__railProbe = []; window.__railArrivals = []; });
  await sleep(ms);
  return page.evaluate(() => {
    const r = { frames: window.__railProbe, arrivals: window.__railArrivals, origin: performance.timeOrigin };
    window.__railProbe = null; window.__railArrivals = null;
    return r;
  });
}

/** The shift (0..300 ms) that best lays the painted head over the received samples. */
function lagOf(frames, arrivals, origin) {
  const W = arrivals.map((a) => [a[1], a[2]]);
  const at = (t) => {
    let lo = 0, hi = W.length - 1;
    if (W.length < 2 || t < W[0][0] || t > W[hi][0]) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (W[m][0] <= t) lo = m; else hi = m; }
    const [t0, v0] = W[lo], [t1, v1] = W[hi];
    return t1 === t0 ? v0 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  };
  const P = frames.filter((f) => f[2] != null).map((f) => [origin + f[0], f[2]]);
  let best = NaN, err = Infinity;
  for (let L = 0; L <= 300; L++) {
    let e = 0, n = 0;
    for (const [t, v] of P) { const x = at(t - L); if (x != null) { e += (v - x) ** 2; n++; } }
    if (n > P.length / 2 && e / n < err) { err = e / n; best = L; }
  }
  // Per frame, how far the painted head sits off the received samples at that lag, in px:
  // the pops and wobble a smooth lag does not explain.
  const F = frames.filter((f) => f[2] != null && f[5] != null);
  const a = F.reduce((m, f) => (Math.abs(f[2] - F[0][2]) > Math.abs(m[2] - F[0][2]) ? f : m), F[0] || [0, 0, 0, 0, 0, 0]);
  const pxPer = F.length && a[2] !== F[0][2] ? (a[5] - F[0][5]) / (a[2] - F[0][2]) : NaN;
  const off = [];
  for (const [t, v] of P) { const x = at(t - best); if (x != null) off.push(Math.abs(v - x) * Math.abs(pxPer)); }
  return { lag: best, offP95: q(off, 0.95), offMax: off.length ? Math.max(...off) : NaN };
}

const report = { label: LABEL, speeds: {} };
console.log('\n--- ' + LABEL + ': pattern at ' + SPEEDS.join(', ') + ' % ---');
await set(DEPTH, 80);
await set(STROKE, 60);
await set(SPEED, SPEEDS[0]);
await set(RUN, 1);
for (const sp of SPEEDS) {
  await set(SPEED, sp);
  await sleep(2500);
  const { frames, arrivals, origin } = await record(RECORD_MS);
  const shots = [];
  // A frame series: the whole rail once, then four close-ups 480 px wide around the head.
  const box = await rail.boundingBox();
  await rail.screenshot({ path: join(EVIDENCE, 'meteor-' + LABEL + '-' + sp + '-rail.png') });
  for (let i = 0; i < 4; i++) {
    const path = join(EVIDENCE, 'meteor-' + LABEL + '-' + sp + '-' + i + '.png');
    const hx = await page.evaluate(() => new Promise((res) => {
      window.__railProbe = [];
      requestAnimationFrame(() => requestAnimationFrame(() => { const p = window.__railProbe; window.__railProbe = null; res(p.length ? p[p.length - 1][5] : null); }));
    }));
    const x = Math.max(box.x, Math.min(box.x + box.width - 480, box.x + (hx ?? box.width / 2) - 240));
    await page.screenshot({ path, clip: { x, y: box.y, width: 480, height: box.height } });
    shots.push(path);
    await sleep(90);
  }
  const has = frames.length && frames[0].length > 8;
  // Frames whose last 150 ms (9 frames at 60 Hz) ran one way.
  const moving = [];
  for (let i = 9; has && i < frames.length; i++) {
    const w = frames.slice(i - 9, i + 1).map((f) => f[5]);
    if (w.some((x) => x == null) || frames[i][0] - frames[i - 9][0] > 160) continue;
    const d = w.slice(1).map((x, k) => x - w[k]);
    if (d.every((x) => x > 1) || d.every((x) => x < -1)) moving.push(i);
  }
  const gaps = [];
  for (let i = 1; i < arrivals.length; i++) gaps.push(arrivals[i][1] - arrivals[i - 1][1]);
  const steps = arrivals.slice(1).map((a, i) => Math.abs(a[2] - arrivals[i][2]));
  const fast = 0.5 * q(steps, 0.95), stepDev = [];
  for (let i = 1; i + 1 < steps.length; i++) {
    if (steps[i - 1] > fast && steps[i] > fast && steps[i + 1] > fast) stepDev.push((steps[i] / ((steps[i - 1] + steps[i + 1]) / 2) - 1) ** 2);
  }
  const judder = [];
  const speedAt = (i) => (frames[i][5] - frames[i - 1][5]) / (frames[i][0] - frames[i - 1][0]);
  for (const i of moving) {
    if (i < 2 || i + 1 >= frames.length || !moving.includes(i - 1) || !moving.includes(i + 1)) continue;
    const [a, b, c] = [speedAt(i - 1), speedAt(i), speedAt(i + 1)];
    if (![a, b, c].every(Number.isFinite)) continue;
    judder.push(Math.abs(b - (a + c) / 2) / ((Math.abs(a) + Math.abs(c)) / 2));
  }
  const r = {
    frames: frames.length, arrivals: arrivals.length,
    arrivalGapP50: q(gaps, 0.5), arrivalGapP95: q(gaps, 0.95),
    stepJitter: stepDev.length ? Math.sqrt(stepDev.reduce((x, y) => x + y, 0) / stepDev.length) : NaN,
    judderP50: q(judder, 0.5), judderP95: q(judder, 0.95),
    delayP50: q(frames.map((f) => origin + f[0] - f[1]), 0.5),
    ...(({ lag, offP95, offMax }) => ({ lagMs: lag, offP95, offMax }))(lagOf(frames, arrivals, origin)),
    tailP90: has ? q(frames.map((f) => f[6]), 0.9) : NaN,
    // Tail over the path the head covered in the same 150 ms, on frames in steady motion.
    tailVsPath: has ? q(moving.map((i) => frames[i][6] / Math.abs(frames[i][5] - frames[i - 9][5])), 0.5) : NaN,
    ghostShare: has ? moving.filter((i) => frames[i][7] != null).length / Math.max(1, moving.length) : NaN,
    drawP50: has ? q(frames.map((f) => f[8]), 0.5) : NaN, drawP95: has ? q(frames.map((f) => f[8]), 0.95) : NaN,
    shots,
  };
  // The ghost points where the head goes next: at each reversal of the head, the ghost's end
  // a few frames earlier sat at that reversal.
  if (has) {
    let hits = 0, n = 0;
    for (let i = 8; i < frames.length - 1; i++) {
      const [a, b, c] = [frames[i - 1][5], frames[i][5], frames[i + 1][5]];
      if (a == null || b == null || c == null || !((b - a) * (c - b) < 0) || Math.abs(c - a) < 0.5) continue;
      const g = frames[i - 6][7];
      if (g == null) continue;
      n++;
      if (Math.abs(g - b) < 6) hits++;
    }
    r.ghostAtReversal = n ? hits / n : NaN;
    r.reversals = n;
  }
  report.speeds[sp] = r;
  console.log('  ' + sp + '%: lag ' + r.lagMs + ' ms, delay ' + f1(r.delayP50) + ' ms, arrivals p50/p95 ' + f1(r.arrivalGapP50) + '/' + f1(r.arrivalGapP95)
    + ' ms, step jitter ' + r.stepJitter.toFixed(3) + ', head judder p50/p95 ' + r.judderP50.toFixed(3) + '/' + r.judderP95.toFixed(3)
    + ', head off-sample p95/max ' + f1(r.offP95) + '/' + f1(r.offMax) + ' px, tail p90 ' + f1(r.tailP90) + ' px, tail/path ' + (r.tailVsPath ?? NaN).toFixed?.(2) + ', ghost ' + f1(r.ghostShare * 100)
    + '% (at reversal ' + f1(r.ghostAtReversal * 100) + '% of ' + r.reversals + '), draw p50/p95 ' + (r.drawP50 ?? NaN).toFixed?.(3) + '/' + (r.drawP95 ?? NaN).toFixed?.(3) + ' ms');
}

// Reduced motion, at full speed: a short tail, the glow fixed at rest.
await page.emulateMedia({ reducedMotion: 'reduce' });
await sleep(300);
const still = await record(1500);
await rail.screenshot({ path: join(EVIDENCE, 'meteor-' + LABEL + '-still.png') });
await page.emulateMedia({ reducedMotion: 'no-preference' });
report.stillTailP90 = still.frames.length && still.frames[0].length > 8 ? q(still.frames.map((f) => f[6]), 0.9) : NaN;

await set(RUN, 0);
const rest = await record(3000);
const idle = await record(1500);
report.idleFrames = idle.frames.length;
await rail.screenshot({ path: join(EVIDENCE, 'meteor-' + LABEL + '-rest.png') });

const S = report.speeds;
if (S[SPEEDS[0]].tailP90 === S[SPEEDS[0]].tailP90) {
  console.log('\n--- checks ---');
  ok('the tail grows with speed', S[15].tailP90 < S[45].tailP90 && S[45].tailP90 < S[100].tailP90,
    SPEEDS.map((s) => f1(S[s].tailP90)).join(' < ') + ' px, p90');
  ok('the tail is the last 150 ms of path', SPEEDS.every((s) => Math.abs(S[s].tailVsPath - 1) < 0.25),
    SPEEDS.map((s) => S[s].tailVsPath.toFixed(2)).join(', ') + ' (tail / path the head covered)');
  ok('the ghost shows while the carriage runs', SPEEDS.every((s) => S[s].ghostShare > 0.8), SPEEDS.map((s) => f1(S[s].ghostShare * 100) + '%').join(', '));
  ok('the ghost ends where the head turns', SPEEDS.every((s) => !(S[s].reversals > 2) || S[s].ghostAtReversal >= 0.7),
    SPEEDS.map((s) => f1(S[s].ghostAtReversal * 100) + '%').join(', '));
  ok('the draw fits a 240 Hz 4K frame', SPEEDS.every((s) => S[s].drawP95 < DRAW_BUDGET_MS),
    SPEEDS.map((s) => S[s].drawP95.toFixed(3)).join(', ') + ' ms p95, budget ' + DRAW_BUDGET_MS);
  ok('reduced motion keeps a short tail (60 of 150 ms)', report.stillTailP90 > 0 && Math.abs(report.stillTailP90 / S[100].tailP90 - 0.4) < 0.15,
    f1(report.stillTailP90) + ' px against ' + f1(S[100].tailP90) + ' px');
  const last = rest.frames.length ? rest.frames[rest.frames.length - 1] : null;
  ok('at rest the tail collapses to the head, then the rail sleeps', last && last[6] < 0.5 && last[0] - rest.frames[0][0] < 2600,
    last ? f1(last[6]) + ' px, last frame ' + Math.round(last[0] - rest.frames[0][0]) + ' ms after the stop' : 'no frames');
  ok('idle: the rail draws no frames', idle.frames.length === 0, idle.frames.length + ' frames in 1.5 s');
}
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
writeFileSync(join(EVIDENCE, 'meteor-' + LABEL + '.json'), JSON.stringify(report, null, 1));
drv.close();
await browser.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
