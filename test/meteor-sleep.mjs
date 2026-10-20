/**
 * meteor-sleep.mjs -- the rail's comet after the device slept (ph-owiz).
 *
 * Android's performance.now() stops while the phone sleeps and Date.now() does not, so
 * performance.timeOrigin + performance.now() falls behind Date.now() by every sleep since the
 * page loaded (measured on the operator's Pixel: -162 s after 11 minutes). Samples are stamped
 * in Date.now() ms; the comet must render in that domain however far the two clocks part.
 *
 * The page's Date.now() is stubbed to jump ahead (a sleep the monotonic clock missed). The lag
 * is how far the comet's render instant sits behind the newest sample that had arrived (the
 * numerals). It must stay under LAG_MAX_MS after a 2 s and a 10 min sleep.
 *
 * COMMANDS MOTION: starts the sim's own pattern. SKIPS (exit 0) without the exe.
 * Run: node test/meteor-sleep.mjs   (build first: npm run build:only)
 */
import { chromium } from 'playwright';
import { startSim, serveBundle, SIM } from './live-sim.mjs';
import { createSession } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';

const LAG_MAX_MS = 300;
const own = await startSim();
if (!own) { console.log('SKIP: no neutrino-sim at ' + SIM); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };

const drv = createSession({
  host: '127.0.0.1', port: own.port, clientKind: 'webui', clientName: 'meteor-sleep driver', autoReconnect: false,
  token: () => acquireToken('127.0.0.1:' + own.http), subscriptions: [],
});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('driver: no LIVE')), 8000); drv.on('live', () => { clearTimeout(t); res(); }); drv.connect(); });
const M = buildSettingsModel(drv.catalog);
const field = (r) => (M.byRole.get(r) || [])[0];
const set = (f, v) => drv.sendIntent(f.writeChannel, { [f.settingKey]: v });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// The sleep: Date.now() runs ahead of the monotonic clock by __slept ms.
await page.addInitScript(() => {
  const real = Date.now.bind(Date);
  window.__slept = 0;
  Date.now = () => real() + window.__slept;
});
await page.goto(await serveBundle(own.port, own.http));
await page.waitForSelector('.spine-rail-host canvas', { timeout: 25000 });

await set(field(ROLE.patternDepth), 80);
await set(field(ROLE.patternStroke), 60);
await set(field(ROLE.patternSpeed), 45);
await set(field(ROLE.patternRunning), 1);
await sleep(2500);

async function lagMs() {
  await page.evaluate(() => { window.__railProbe = []; window.__railArrivals = []; });
  await sleep(2500);
  const { frames, arrivals, origin } = await page.evaluate(() => {
    const r = { frames: window.__railProbe, arrivals: window.__railArrivals, origin: performance.timeOrigin };
    window.__railProbe = null; window.__railArrivals = null;
    return r;
  });
  // Arrivals [stamp, monotonic epoch ms, value]; frames [rAF ms, render instant, head value, ...]. Per frame, how far
  // the render instant sits behind the newest sample that had arrived: the comet's lag behind the numerals. A curve fit
  // against the arrivals would alias on the periodic pattern.
  const behind = [];
  let k = -1;
  for (const f of frames) {
    while (k + 1 < arrivals.length && arrivals[k + 1][1] <= origin + f[0]) k++;
    if (k >= 0 && f[2] != null) behind.push(arrivals[k][0] - f[1]);
  }
  behind.sort((x, y) => x - y);
  const best = behind.length ? Math.round(behind[behind.length >> 1]) : NaN;
  return { lag: best, frames: frames.length, painted: behind.length };
}

const base = await lagMs();
ok('awake: the comet lags the arrivals under ' + LAG_MAX_MS + ' ms', base.lag < LAG_MAX_MS, base.lag + ' ms over ' + base.painted + '/' + base.frames + ' frames');
for (const [name, ms] of [['a 2 s sleep', 2000], ['a 10 min sleep', 600000]]) {
  await page.evaluate((d) => { window.__slept += d; }, ms);
  await sleep(3000);
  const r = await lagMs();
  ok('after ' + name + ': the comet lags the arrivals under ' + LAG_MAX_MS + ' ms', r.lag < LAG_MAX_MS,
    (Number.isNaN(r.lag) ? 'no head drawn' : r.lag + ' ms') + ' over ' + r.painted + '/' + r.frames + ' frames');
}

await set(field(ROLE.patternRunning), 0);
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
drv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
