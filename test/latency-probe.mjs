/**
 * latency-probe.mjs -- display latency from the hub's telemetry to the hero
 * numeral's paint (ph-6vh), measured against a live hub.
 *
 * Method:
 * - A driver session streams a sine through the real motion door
 *   (src/model/motion.js) every 20 ms: the window's center, +-AMP mm, FREQ Hz.
 * - The same session subscribes telemetry.position at the channel's ceiling
 *   and stamps each STATE frame on arrival. STATE frames carry no hub time,
 *   so this arrival is the hub's timeline as near as the wire gives it.
 * - The page samples `.hn-primary .hn-val` once per frame: its rAF posts a
 *   message, and the message handler reads the text and stamps it. That task
 *   runs after the frame's style, layout and paint, so the stamp is the paint
 *   of the value read (scan-out adds up to one display refresh, not seen here).
 * - Node and page stamps are both moved onto Date.now() (each process's
 *   timeOrigin + now() minus Date.now(), averaged), the one system clock.
 * - Sine fits at the known frequency (Nucleus tools/lag_probe.py's method)
 *   give the mean lag of sent -> wire (hub and engine), wire -> paint (the
 *   client) and sent -> paint (end to end). Per frame on the steep half of
 *   the sine, the painted value is inverted through the wire fit to the
 *   instant the hub reported it: median and p95 of paint minus that instant.
 * - The first 2 s of every run are dropped (positioning move, render clock).
 *
 * Variants (one page build each): `after` is the tree as built; `before` is
 * the same tree with 5e7b206's three changes put back (TELEMETRY_HZ 25, the
 * schedule leads arrival by 30 ms at the untrimmed period, cap 150 ms). A
 * replacement that no longer matches fails the run instead of measuring the
 * wrong thing. `--cdp <url>` measures a page already open in a WebView2 or
 * Chromium started with --remote-debugging-port (the Tauri shell:
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222).
 *
 * COMMANDS MOTION inside the reported window. Never writes a setting, never
 * resumes a latch: a paused or halted hub fails the run.
 *
 * `--watch` commands nothing and takes no token: whatever already moves the
 * machine (another session's stream) is the signal. Client lag is the shift
 * that best lays the painted series over the wire's; per frame, the time
 * since the wire crossed the painted value (the crossing nearest that shift,
 * on segments steeper than 20 mm/s). No hub term.
 *
 * Run: node test/latency-probe.mjs --host 127.0.0.1 --port 8782 --http 8789
 *        [--seconds 30] [--amp 20] [--freq 0.8] [--variants before,after] [--out run.json]
 *        [--force-home 250]   (RFC-025 bench op first, as lag_probe.py; moves nothing)
 *      node test/latency-probe.mjs --host H --port P --http N --cdp http://127.0.0.1:9222
 *      node test/latency-probe.mjs --host H --port P --watch [--variants after]
 */
import { chromium } from 'playwright';
import { build } from 'vite';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, PRIORITY } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { CORE_CHANNEL } from '../../Valence/clients/js/generated/registry_vocab.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';
import { createMotionDoor } from '../src/model/motion.js';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const HOST = argOf('--host', '127.0.0.1');
const PORT = Number(argOf('--port', 82));
const HTTP = Number(argOf('--http', 80));
const SECONDS = Number(argOf('--seconds', 30));
const AMP = Number(argOf('--amp', 20));
const FREQ = Number(argOf('--freq', 0.8));
const CDP = argOf('--cdp', null);
const FORCE_HOME = argOf('--force-home', null);
const WATCH = args.includes('--watch');
const VARIANTS = CDP ? ['shell'] : argOf('--variants', 'before,after').split(',');
const OUT = argOf('--out', null);
const WARM_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the A/B build ------------------------------------------------------------------
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REVERT_5E7B206 = {
  'src/model/wishes.js': [['export const TELEMETRY_HZ = 50;', 'export const TELEMETRY_HZ = 25;']],
  'src/ui/hero/telebuf.js': [
    ['const SCHEDULE_MAX_LEAD_MS = 60;', 'const SCHEDULE_MAX_LEAD_MS = 150;'],
    ['ts = Math.max(tsMs, bufT[newestIdx] + Math.max(1, periodMs * SCHEDULE_PERIOD_TRIM));',
      'ts = Math.max(tsMs + 30, bufT[newestIdx] + Math.max(1, periodMs));'],
  ],
};
async function bundle(variant) {
  const done = new Set();
  const revert = {
    name: 'revert-5e7b206', enforce: 'pre',
    transform(code, id) {
      const key = Object.keys(REVERT_5E7B206).find((k) => id.replace(/\\/g, '/').endsWith(k));
      if (!key) return null;
      for (const [a, b] of REVERT_5E7B206[key]) {
        if (code.split(a).length !== 2) throw new Error('before variant: "' + a + '" is not in ' + key + ' exactly once');
        code = code.replace(a, b);
      }
      done.add(key);
      return code;
    },
  };
  const out = mkdtempSync(join(tmpdir(), 'latency-' + variant + '-'));
  await build({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'error',
    plugins: variant === 'before' ? [revert] : [], build: { outDir: out, emptyOutDir: true } });
  if (variant === 'before' && done.size !== Object.keys(REVERT_5E7B206).length) throw new Error('before variant: reverted ' + [...done]);
  const html = readFileSync(join(out, 'index.html'));
  rmSync(out, { recursive: true, force: true });
  return html;
}

// ---- fits (every time in ms from the run's start) ---------------------------------------
/** Least squares y = a cos(wt) + b sin(wt) + c at a known w: {amp, ph, dc, w}, y = amp cos(wt + ph) + dc. */
function fitSine(ts, ys, w) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (let i = 0; i < ts.length; i++) {
    const r = [Math.cos(w * ts[i]), Math.sin(w * ts[i]), 1];
    for (let a = 0; a < 3; a++) { v[a] += r[a] * ys[i]; for (let b = 0; b < 3; b++) m[a][b] += r[a] * r[b]; }
  }
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]]; [v[i], v[p]] = [v[p], v[i]];
    for (let r = i + 1; r < 3; r++) { const k = m[r][i] / m[i][i]; for (let c = i; c < 3; c++) m[r][c] -= k * m[i][c]; v[r] -= k * v[i]; }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let acc = v[i];
    for (let c = i + 1; c < 3; c++) acc -= m[i][c] * x[c];
    x[i] = acc / m[i][i];
  }
  return { amp: Math.hypot(x[0], x[1]), ph: Math.atan2(-x[1], x[0]), dc: x[2], w };
}
const at = (F, t) => F.amp * Math.cos(F.w * t + F.ph) + F.dc;
/** Mean lag of `sig` behind `ref`, ms: a trailing signal has the more negative phase. */
function lagMs(ref, sig) {
  const d = sig.ph - ref.ph;
  return -(Math.atan2(Math.sin(d), Math.cos(d))) / ref.w;
}
/** Per sample on the steep half of the fit: t minus the instant `ref` had that value, the root nearest t - guess. */
function perSampleLag(ref, ts, vs, guess) {
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const r = (vs[i] - ref.dc) / ref.amp;
    if (!(Math.abs(r) < 0.7)) continue;
    const want = ts[i] - guess;
    let best = null;
    for (const a of [Math.acos(r), -Math.acos(r)]) {
      const k = Math.round((ref.w * want + ref.ph - a) / (2 * Math.PI));
      const t = (a + 2 * Math.PI * k - ref.ph) / ref.w;
      if (best == null || Math.abs(t - want) < Math.abs(best - want)) best = t;
    }
    out.push(ts[i] - best);
  }
  return out.sort((a, b) => a - b);
}
/** Watch mode: wire value at t, linear between arrivals (null outside). */
function wireAt(W, t) {
  let lo = 0, hi = W.length - 1;
  if (!W.length || t < W[0][0] || t > W[hi][0]) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (W[m][0] <= t) lo = m; else hi = m; }
  const [t0, v0] = W[lo], [t1, v1] = W[hi];
  return t1 === t0 ? v0 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
}
/** Watch mode: the shift (0..500 ms) that best lays P over W, least squares. */
function bestShift(W, P) {
  let best = NaN, bestErr = Infinity;
  for (let L = 0; L <= 500; L++) {
    let e = 0, n = 0;
    for (const [t, v] of P) { const x = wireAt(W, t - L); if (x != null) { e += (v - x) ** 2; n++; } }
    if (n > P.length / 2 && e / n < bestErr) { bestErr = e / n; best = L; }
  }
  return best;
}
/** Watch mode: per frame, t minus the wire's crossing of v nearest t - guess, on segments steeper than 20 mm/s. */
function perFrameCrossing(W, P, guess) {
  const out = [];
  let i = 0;
  for (const [t, v] of P) {
    while (i < W.length - 1 && W[i + 1][0] < t - guess - 300) i++;
    let best = null;
    for (let k = i; k < W.length - 1 && W[k + 1][0] <= t; k++) {
      const [t0, v0] = W[k], [t1, v1] = W[k + 1];
      if (t1 <= t0 || Math.abs(v1 - v0) / (t1 - t0) < 0.02 || (v - v0) * (v - v1) > 0) continue;
      const tc = t0 + (t1 - t0) * (v - v0) / (v1 - v0);
      if (best == null || Math.abs(tc - (t - guess)) < Math.abs(best - (t - guess))) best = tc;
    }
    if (best != null) out.push(t - best);
  }
  return out.sort((a, b) => a - b);
}
const pct = (s, q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : NaN);
{
  // The instrument checks itself: a copy 100 ms late reads 100 ms both ways.
  const w = 2 * Math.PI * FREQ / 1000, ts = Array.from({ length: 3000 }, (_, i) => i * 16.7);
  const ref = fitSine(ts, ts.map((t) => 5 + 20 * Math.sin(w * t)), w), late = ts.map((t) => 5 + 20 * Math.sin(w * (t - 100)));
  const per = perSampleLag(ref, ts, late, 90);
  if (Math.abs(lagMs(ref, fitSine(ts, late, w)) - 100) > 0.1 || Math.abs(pct(per, 0.5) - 100) > 0.1) throw new Error('latency math self-check failed');
}
function corr(ref, ts, vs, lag) {
  const a = ts.map((t) => at(ref, t - lag)), n = vs.length;
  const ma = a.reduce((x, y) => x + y, 0) / n, mv = vs.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, svv = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (vs[i] - mv); saa += (a[i] - ma) ** 2; svv += (vs[i] - mv) ** 2; }
  return sab / Math.sqrt(saa * svv);
}
const nodeOffset = () => { let s = 0; for (let i = 0; i < 200; i++) s += performance.timeOrigin + performance.now() - Date.now(); return s / 200; };
const NODE_OFF = nodeOffset();
const now = () => performance.timeOrigin + performance.now() - NODE_OFF;

// ---- the driver: one session streams and watches ----------------------------------
const samples = {};
const wire = [];
const drv = createSession({
  host: HOST, port: PORT, clientKind: 'webui', clientName: 'latency-probe driver', autoReconnect: false,
  ...(WATCH ? {} : { token: () => acquireToken(HOST + ':' + HTTP) }),
  subscriptions: [[CORE_CHANNEL.safety, 0, PRIORITY.critical]],
});
let POS = null;
drv.on('state', (ch, v) => {
  samples[ch] = v;
  if (POS && ch === POS.channelId) wire.push([now(), reportedValue(POS, v)]);
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('driver: no LIVE in 8 s')), 8000);
  drv.on('live', () => { clearTimeout(t); resolve(); });
  drv.connect();
});
const M = buildSettingsModel(drv.catalog);
const first = (r) => (M.byRole.get(r) || [])[0];
POS = first(ROLE.telemetryPosition);
const WMIN = first(ROLE.windowMin), WMAX = first(ROLE.windowMax);
const posEntry = drv.catalog.find((e) => e.id === POS.channelId);
drv.subscribe([...new Set([POS.channelId, WMIN.channelId])].map((ch) => [ch, ch === POS.channelId ? posEntry.maxRateHz : 0, PRIORITY.elevated]));
for (let i = 0; i < 80 && !(samples[WMIN.channelId] && samples[POS.channelId]); i++) await sleep(50);
if (FORCE_HOME) {
  // RFC-025's bench op, as lag_probe.py --force-home: asserts home here, moves nothing.
  const home = M.actions.find((a) => a.role === 'action.home');
  await drv.sendIntent(home.channelId, { [home.key]: home.options.indexOf('force_home'), [home.payload[0].key]: Number(FORCE_HOME) });
  await sleep(500);
}
const lo = reportedValue(WMIN, samples[WMIN.channelId]), hi = reportedValue(WMAX, samples[WMAX.channelId]);
const word = (samples[CORE_CHANNEL.safety] || {}).word_bits || {};
if (!WATCH && (word.estop || word.pause || !(hi - lo > 2 * AMP))) {
  console.log('FAIL: hub not ready to stream: ' + JSON.stringify({ word, window: [lo, hi], amp: AMP }));
  drv.close();
  process.exit(1);
}
const door = createMotionDoor({ session: () => drv, entries: () => drv.catalog, setpoint: () => ({ ok: false, reason: 'off' }),
  log: (l, m) => console.log('    door: ' + m) });
const center = (lo + hi) / 2;
const norm = (mm) => (mm - lo) / (hi - lo);
console.log('hub ' + HOST + ':' + PORT + ' ' + JSON.stringify(drv.state.identity && drv.state.identity.fw_version)
  + ', window ' + lo + '..' + hi + ' mm, ' + (WATCH ? 'watch only' : 'sine ' + center + ' +-' + AMP + ' mm at ' + FREQ + ' Hz') + ', '
  + POS.name + ' wished at ' + posEntry.maxRateHz + ' Hz, ' + SECONDS + ' s per run');

// ---- the page ---------------------------------------------------------------------------
const SAMPLER = () => {
  let s = 0;
  for (let i = 0; i < 200; i++) s += performance.timeOrigin + performance.now() - Date.now();
  const off = s / 200;
  const lat = window.__lat = { t: [], v: [], on: false, off };
  const mc = new MessageChannel();
  mc.port1.onmessage = () => {
    const el = document.querySelector('.hn-primary .hn-val');
    const x = el ? parseFloat(el.textContent) : NaN;
    if (lat.on && Number.isFinite(x)) { lat.t.push(performance.timeOrigin + performance.now() - off); lat.v.push(x); }
  };
  const tick = () => { mc.port2.postMessage(0); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
let html = null;
const srv = createServer((q, r) => {
  // The page watches only: no /uitoken here, so it never takes control.
  if (q.url.startsWith('/uitoken')) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(html);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = CDP ? await chromium.connectOverCDP(CDP) : await chromium.launch();

async function measure(variant) {
  let page, ctx;
  if (CDP) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools:'));
    await page.evaluate(SAMPLER);
  } else {
    html = await bundle(variant);
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(SAMPLER);
    page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + srv.address().port + '/?hub=' + HOST + ':' + PORT);
  }
  await page.waitForFunction(() => Number.isFinite(parseFloat(document.querySelector('.hn-primary .hn-val')?.textContent)), null, { timeout: 20000 });
  await sleep(3000);
  wire.length = 0;
  const sent = [];
  const delays = [];
  let streaming = !WATCH;
  const t0 = now();
  const stream = (async () => {
    let next = t0;
    while (streaming) {
      const t = now();
      const mm = center + AMP * Math.sin(2 * Math.PI * FREQ * (t - t0) / 1000);
      const r = door(norm(mm));
      if (r.ok) sent.push([t, mm]);
      next += 20;
      await sleep(Math.max(0, next - now()));
    }
  })();
  await page.evaluate(() => { window.__lat.on = true; });
  const chip = setInterval(async () => {
    const m = /(\d+) ms/.exec(await page.locator('.chip:has(.chip-lbl:text-is("render")) .mono').textContent().catch(() => ''));
    if (m) delays.push(Number(m[1]));
  }, 500);
  await sleep(SECONDS * 1000);
  clearInterval(chip);
  const paint = await page.evaluate(() => { window.__lat.on = false; return { t: window.__lat.t, v: window.__lat.v, off: window.__lat.off }; });
  streaming = false;
  await stream;
  if (ctx) { await page.goto('about:blank').catch(() => {}); await ctx.close(); }

  // From here on every time is ms after the stream started.
  const rel = (xs) => xs.map(([t, v]) => [t - t0, v]).filter((x) => x[0] >= WARM_MS && Number.isFinite(x[1]));
  const S = rel(sent), W = rel(wire), P = rel(paint.t.map((t, i) => [t, paint.v[i]]));
  if (WATCH) {
    const L = bestShift(W, P), per = perFrameCrossing(W, P, L), vs = W.map((x) => x[1]);
    const gaps = W.slice(1).map((x, i) => x[0] - W[i][0]).sort((a, b) => a - b);
    return {
      variant, wire: W.length, frames: P.length, steepFrames: per.length, wireSpanMm: Math.max(...vs) - Math.min(...vs),
      wireGapMs: { p50: pct(gaps, 0.5), p95: pct(gaps, 0.95) }, renderDelayMs: { p50: pct(delays.sort((a, b) => a - b), 0.5) },
      clientMs: L, clientPerFrameMs: { p50: pct(per, 0.5), p95: pct(per, 0.95) },
      ...(OUT ? { series: { wire: W, paint: P } } : {}),
    };
  }
  const w = 2 * Math.PI * FREQ / 1000;
  const fS = fitSine(S.map((x) => x[0]), S.map((x) => x[1]), w);
  const fW = fitSine(W.map((x) => x[0]), W.map((x) => x[1]), w);
  const fP = fitSine(P.map((x) => x[0]), P.map((x) => x[1]), w);
  const client = lagMs(fW, fP);
  const per = perSampleLag(fW, P.map((x) => x[0]), P.map((x) => x[1]), client);
  const perEnd = perSampleLag(fS, P.map((x) => x[0]), P.map((x) => x[1]), lagMs(fS, fP));
  const gaps = W.slice(1).map((x, i) => x[0] - W[i][0]).sort((a, b) => a - b);
  const frames = P.slice(1).map((x, i) => x[0] - P[i][0]).sort((a, b) => a - b);
  const r = {
    variant, sent: S.length, wire: W.length, frames: P.length, steepFrames: per.length,
    wireGapMs: { p50: pct(gaps, 0.5), p95: pct(gaps, 0.95) }, frameMs: { p50: pct(frames, 0.5), p95: pct(frames, 0.95) },
    renderDelayMs: { p50: pct(delays.sort((a, b) => a - b), 0.5) },
    hubMs: lagMs(fS, fW), clientMs: client, endToEndMs: lagMs(fS, fP),
    clientPerFrameMs: { p50: pct(per, 0.5), p95: pct(per, 0.95) },
    endToEndPerFrameMs: { p50: pct(perEnd, 0.5), p95: pct(perEnd, 0.95) },
    wireAmpMm: fW.amp, ampRatio: fP.amp / fW.amp, corr: corr(fW, P.map((x) => x[0]), P.map((x) => x[1]), client),
    clockOffsetsMs: { node: NODE_OFF, page: paint.off },
  };
  if (OUT) r.series = { sent: S, wire: W, paint: P };
  return r;
}

const runs = [];
try {
  for (const v of VARIANTS) {
    const r = await measure(v);
    runs.push(r);
    const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : '--');
    if (WATCH) {
      console.log(v.padEnd(7) + ' client ' + f(r.clientMs) + ' ms (per frame p50 ' + f(r.clientPerFrameMs.p50) + ', p95 '
        + f(r.clientPerFrameMs.p95) + ') | render delay ' + f(r.renderDelayMs.p50) + ' ms | wire gap p50 ' + f(r.wireGapMs.p50)
        + ' p95 ' + f(r.wireGapMs.p95) + ' | ' + r.steepFrames + '/' + r.frames + ' frames, wire span ' + f(r.wireSpanMm) + ' mm');
      continue;
    }
    console.log(v.padEnd(7) + ' hub ' + f(r.hubMs) + ' ms | client ' + f(r.clientMs) + ' ms (per frame p50 ' + f(r.clientPerFrameMs.p50)
      + ', p95 ' + f(r.clientPerFrameMs.p95) + ') | end to end ' + f(r.endToEndMs) + ' ms (p50 ' + f(r.endToEndPerFrameMs.p50) + ', p95 '
      + f(r.endToEndPerFrameMs.p95) + ') | render delay ' + f(r.renderDelayMs.p50) + ' ms | wire gap p50 ' + f(r.wireGapMs.p50) + ' p95 '
      + f(r.wireGapMs.p95) + ' | ' + r.steepFrames + '/' + r.frames + ' frames, wire amp ' + f(r.wireAmpMm) + ' mm, ratio ' + r.ampRatio.toFixed(3) + ', corr ' + r.corr.toFixed(3));
  }
} finally {
  if (OUT) writeFileSync(OUT, JSON.stringify({ host: HOST + ':' + PORT, amp: AMP, freq: FREQ, seconds: SECONDS, runs }, null, 1));
  // A CDP browser is someone else's window: leave it open.
  if (!CDP) await browser.close();
  srv.close();
  drv.close();
}
process.exit(0);
