/**
 * soak-player.test.mjs -- the funscript player over a long session (ph-1qs5.10): a synthesized script
 * looped against the native valencesim with Motion on, sampled every 10 s.
 *
 * Per sample: JS heap after a forced GC, DOM nodes and listeners (CDP Memory.getDOMCounters), the
 * renderer's and GPU process's working set (CDP SystemInfo.getProcessInfo pids, tasklist), canvases and contexts,
 * event-loop lag p95 (setTimeout drift), rAF fps, twin renders (posts to the Kinetic worker),
 * workers alive, segments sent/s and their lead (last start minus send time), STREAM bundles/s
 * at the socket, WS messages/s with their queue delay p95 and handler time.
 * Pass: the last minute against the first full minute stays within the bounds in BOUNDS.
 *
 * The default clip (120 s, looped) wraps twice in 5 minutes on purpose: a per-frame cost that grows
 * per lap (ph-1qs5.10, the player's trace) fails the lag and lead bounds within minutes.
 * Slow (not in test:browser): needs ../Nucleus/sim/valencesim/build/valencesim.exe and ffmpeg.
 * Run: node test/soak-player.test.mjs [--minutes 5] [--clip 120] [--port P]
 *      [--churn N]  N page switches and plugin Reloads first, the worker count after each
 *      [--snap]     heap census (object counts by constructor) at minute 2 and at the end, the growth
 *      [--profile]  5 s of renderer CPU at the end, the top self times
 * Constraints: the sim and the page run on private ports; the sim is killed on every exit path.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseFrames, FRAME } from '../../Valence/clients/js/frames.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';

const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const MINUTES = Number(argOf('--minutes', 5));
const CLIP_S = Number(argOf('--clip', 120));
const PORT = Number(argOf('--port', 20000 + Math.floor(Math.random() * 20000)));
const HTTP = PORT + 1;
const EVERY_MS = 10000;
const SIM = fileURLToPath(new URL('../../Nucleus/sim/valencesim/build/valencesim.exe', import.meta.url));
// The last minute against the first full minute (minute 1..2; minute 0 is warm-up).
const BOUNDS = { heapMB: 8, nodes: 500, listeners: 200, lagP95: 25, renders: 3, leadMin: 60 };

const MB = (b) => +(b / 1048576).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
if (!existsSync(SIM)) { console.log('SKIP: no valencesim at ' + SIM); process.exit(0); }

// ---- the clip and the script ----
const TMP = mkdtempSync(join(tmpdir(), 'soak-'));
let sim = null, browser = null, srv = null;
const cleanup = () => { try { sim && sim.kill(); } catch (e) { /* gone */ } rmSync(TMP, { recursive: true, force: true }); };
process.on('exit', cleanup);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15:duration=' + CLIP_S,
  '-c:v', 'libvpx', '-b:v', '40k', '-g', '30', '-deadline', 'realtime', '-cpu-used', '8', '-an', join(TMP, 'clip.webm')],
{ windowsHide: true, stdio: 'pipe' });
const VIDEO = readFileSync(join(TMP, 'clip.webm'));
// Strokes 150..700 ms between varied ends, a slow section every minute: a real-shaped script.
const actions = [];
for (let at = 0, k = 0; at < CLIP_S * 1000 - 500; k++) {
  const slow = Math.floor(at / 30000) % 2 === 1;
  actions.push({ at, pos: k % 2 ? 60 + ((k * 13) % 40) : (k * 7) % 40 });
  at += slow ? 500 + ((k * 37) % 200) : 150 + ((k * 37) % 300);
}
const SCRIPT = JSON.stringify({ version: '1.0', inverted: false, range: 100, actions });

// ---- the sim ----
sim = spawn(SIM, ['machine', '--homed', '--headless', '--no-mdns', '--no-discovery', '--no-estop-udp',
  '--duration', String(MINUTES * 60 + 300), '--port', String(PORT), '--http', String(HTTP), '--state', join(TMP, 'sim')],
{ stdio: 'ignore', windowsHide: true });
await sleep(2500);

// ---- the page ----
const SHELL = await buildShellPage();
srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + HTTP + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(TAURI_STUB);
await ctx.addInitScript(([port]) => {
  try {
    if (!sessionStorage.getItem('soak.seeded')) {
      sessionStorage.setItem('soak.seeded', '1');
      localStorage.setItem('phosphor.funscript.probe', '1');
      localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      localStorage.setItem('phosphor.funscript.play', JSON.stringify({ loop: true, loopCount: 0, home: false, homeAfterMs: 5000,
        homePoint: 0.5, homeSpeed: 0.33, seekMs: 500, autoLatency: true }));
    }
  } catch (e) { /* none */ }
  // Test-side meters: everything lands on window.__soak, nothing in the product changes.
  const S = window.__soak = { lag: [], raf: 0, wsN: 0, wsMs: 0, wsQ: [], posts: 0, workers: 0, ctx2d: 0, ctxGl: 0, bitmaps: 0, sockets: [] };
  let due = performance.now() + 20;
  const tick = () => { const n = performance.now(); S.lag.push(Math.max(0, n - due)); due = n + 20; setTimeout(tick, 20); };
  setTimeout(tick, 20);
  const raf = () => { S.raf++; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) { super(...a); S.workers++; }
    postMessage(m, ...r) { if (m && m.segs) S.posts++; return super.postMessage(m, ...r); }
    terminate() { S.workers--; return super.terminate(); }
  };
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...r) { if (/gl/.test(t)) S.ctxGl++; else S.ctx2d++; return gc.call(this, t, ...r); };
  const cib = window.createImageBitmap;
  window.createImageBitmap = (...a) => { S.bitmaps++; return cib(...a); };
  const d = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, enumerable: true, get: d.get,
    set(fn) {
      if (!S.sockets.includes(this)) S.sockets.push(this);
      d.set.call(this, fn && function (ev) {
        const t = performance.now();
        S.wsQ.push(t - ev.timeStamp);
        try { return fn.call(this, ev); } finally { S.wsN++; S.wsMs += performance.now() - t; }
      });
    } });
}, [PORT]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) errors.push(String(e)); });
const sock = { bundles: 0 };
page.on('websocket', (ws) => ws.on('framesent', ({ payload }) => {
  if (typeof payload === 'string') return;
  for (const { header } of parseFrames(new Uint8Array(payload))) if (header.type === FRAME.STREAM) sock.bundles++;
}));
const cdp = await ctx.newCDPSession(page);
const bcdp = await browser.newBrowserCDPSession();
await page.goto('http://127.0.0.1:' + srv.address().port + '/');
await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });

const C = 'main.pane .fsp';
const TAB = '[data-tab-id="plugin:funscript-player:player"]';
await page.waitForSelector(TAB, { timeout: 15000 });
await page.click(TAB);
await page.waitForSelector(C + ' .fsp-filev', { state: 'attached', timeout: 10000 });
await page.setInputFiles(C + ' .fsp-filev', [
  { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO },
  { name: 'clip.funscript', mimeType: 'application/json', buffer: Buffer.from(SCRIPT) },
]);
await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 15000 });
await page.locator(C + ' .fsp-expand').evaluate((e) => e.click());
await page.waitForTimeout(500);
await page.locator(C + ' .fsp-play').evaluate((e) => e.click());
await page.waitForTimeout(1000);

// ---- churn probe (--churn N): page switches and plugin reloads, workers counted ----
const CHURN = Number(argOf('--churn', 0));
const workerTargets = async () => (await bcdp.send('Target.getTargets')).targetInfos.filter((t) => /worker/.test(t.type)).length;
if (CHURN) {
  const reloadBtn = () => page.evaluate(() => {
    for (const sec of document.querySelectorAll('section')) if (/funscript/i.test(sec.textContent) && sec.querySelector('button')) {
      const b = [...sec.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Reload');
      if (b) { b.click(); return true; }
    }
    return false;
  });
  const tabs = await page.$$eval('[role=tab][data-tab-id]', (els) => [...new Set(els.map((e) => e.dataset.tabId))]);
  console.log('tabs: ' + tabs.join(' '));
  for (let i = 0; i < CHURN; i++) {
    await page.click('[data-tab-id="' + tabs[0] + '"]'); await page.waitForTimeout(400);
    await page.click(TAB); await page.waitForTimeout(400);
    await page.click('[data-tab-id="plugins"]'); await page.waitForTimeout(400);
    const rl = await reloadBtn(); await page.waitForTimeout(400);
    await page.click(TAB); await page.waitForTimeout(800);
    await cdp.send('HeapProfiler.collectGarbage');
    const dc = await cdp.send('Memory.getDOMCounters');
    console.log('churn ' + i + ': reload ' + rl + ', worker targets ' + await workerTargets() + ', live Worker objects ' + await page.evaluate(() => window.__soak.workers)
      + ', heapMB ' + MB((await cdp.send('Runtime.getHeapUsage')).usedSize) + ', nodes ' + dc.nodes + ', listeners ' + dc.jsEventListeners + ', documents ' + dc.documents);
  }
  await page.setInputFiles(C + ' .fsp-filev', [
    { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO },
    { name: 'clip.funscript', mimeType: 'application/json', buffer: Buffer.from(SCRIPT) },
  ]);
  await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 15000 });
  await page.locator(C + ' .fsp-play').evaluate((e) => e.click());
}

// ---- sampling ----
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
async function procMem() {
  try {
    const { processInfo } = await bcdp.send('SystemInfo.getProcessInfo');
    const of = (t) => processInfo.filter((p) => p.type === t);
    const cpuOf = (t) => of(t).reduce((n, p) => n + (p.cpuTime || 0), 0);
    // Working sets from the OS (tasklist), KB.
    const ws = (t) => of(t).reduce((n, p) => {
      try {
        const line = execFileSync('tasklist', ['/FI', 'PID eq ' + p.id, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
        return n + Number((line.split('","')[4] || '').replace(/\D/g, '')) * 1024;
      } catch (e) { return n; }
    }, 0);
    return { rendererCpu: cpuOf('renderer'), gpuCpu: cpuOf('GPU'), rendererWs: ws('renderer'), gpuWs: ws('GPU') };
  } catch (e) { return { rendererCpu: NaN, gpuCpu: NaN, rendererWs: NaN, gpuWs: NaN }; }
}
/** --snap: object counts by constructor from a heap snapshot (after GC), for a diff at the end. */
async function census() {
  let chunks = '';
  const on = (e) => { chunks += e.chunk; };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  const h = JSON.parse(chunks), f = h.snapshot.meta.node_fields, types = h.snapshot.meta.node_types[0], N = f.length;
  const it = f.indexOf('type'), iname = f.indexOf('name'), isz = f.indexOf('self_size'), out = new Map();
  for (let i = 0; i < h.nodes.length; i += N) {
    const k = types[h.nodes[i + it]] + ' ' + h.strings[h.nodes[i + iname]].slice(0, 60);
    const o = out.get(k) || [0, 0]; o[0]++; o[1] += h.nodes[i + isz]; out.set(k, o);
  }
  return out;
}
const SNAP = argv.includes('--snap');
let snap0 = null;
let lastT = 0, lastProbe = 0, lastBundles = 0, cpu0 = await procMem();
const rows = [];
const t0 = Date.now();
console.log('soak: ' + MINUTES + ' min, clip ' + CLIP_S + ' s, ' + actions.length + ' actions, sim :' + PORT);
console.log('  min  heapMB  nodes  lsnrs canv  lagP95 fps  renders wrk  seg/s  leadP50 leadMin bun/s  ws/s  wsQp95 wsMs/s  rendMB  gpuMB  rCpu%  gCpu%');
while (Date.now() - t0 < MINUTES * 60000) {
  await sleep(EVERY_MS - ((Date.now() - t0) % EVERY_MS));
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const s = await page.evaluate(([since]) => {
    const S = window.__soak;
    const out = { lag: S.lag, raf: S.raf, wsN: S.wsN, wsMs: S.wsMs, wsQ: S.wsQ, posts: S.posts, workers: S.workers,
      ctx: S.ctx2d + S.ctxGl, bitmaps: S.bitmaps, now: performance.now(), canvases: document.querySelectorAll('canvas').length,
      buffered: Math.max(0, ...S.sockets.map((w) => w.bufferedAmount)), probe: (window.__funscriptProbe || []).filter((x) => x.k === 'seg' && x.t > since) };
    S.lag = []; S.raf = 0; S.wsN = 0; S.wsMs = 0; S.wsQ = []; S.posts = 0;
    return out;
  }, [lastProbe]);
  const dt = (s.now - (lastT || s.now - EVERY_MS)) / 1000;
  lastT = s.now;
  if (s.probe.length) lastProbe = s.probe.at(-1).t;
  const leads = s.probe.filter((x) => x.list.length).map((x) => x.list.at(-1).atMs - x.t);
  const cpu = await procMem();
  const r = { min: +((Date.now() - t0) / 60000).toFixed(2), heapMB: MB(usedSize), nodes: dom.nodes, listeners: dom.jsEventListeners,
    canvases: s.canvases, ctx: s.ctx, lagP95: +q(s.lag, 0.95).toFixed(1), fps: +(s.raf / dt).toFixed(1), renders: s.posts, workers: s.workers,
    segPerS: +(s.probe.reduce((n, x) => n + x.list.length, 0) / dt).toFixed(1), leadP50: +q(leads, 0.5).toFixed(0), leadMin: +Math.min(...leads).toFixed(0),
    bunPerS: +((sock.bundles - lastBundles) / dt).toFixed(1), wsPerS: +(s.wsN / dt).toFixed(1), wsQp95: +q(s.wsQ, 0.95).toFixed(1),
    wsMsPerS: +(s.wsMs / dt).toFixed(1), buffered: s.buffered,
    rMB: MB(cpu.rendererWs), gMB: MB(cpu.gpuWs), rCpu: +((cpu.rendererCpu - cpu0.rendererCpu) / dt * 100).toFixed(0), gCpu: +((cpu.gpuCpu - cpu0.gpuCpu) / dt * 100).toFixed(0) };
  lastBundles = sock.bundles; cpu0 = cpu;
  rows.push(r);
  if (SNAP && !snap0 && r.min >= 2) snap0 = await census();
  console.log('  ' + [r.min.toFixed(2).padStart(5), String(r.heapMB).padStart(6), String(r.nodes).padStart(6), String(r.listeners).padStart(6),
    String(r.canvases + '/' + r.ctx).padStart(4), String(r.lagP95).padStart(7), String(r.fps).padStart(5), String(r.renders).padStart(7),
    String(r.workers).padStart(4), String(r.segPerS).padStart(6), String(r.leadP50).padStart(8), String(r.leadMin).padStart(7),
    String(r.bunPerS).padStart(5), String(r.wsPerS).padStart(5), String(r.wsQp95).padStart(7), String(r.wsMsPerS).padStart(6),
    String(r.rMB).padStart(7), String(r.gMB).padStart(6), String(r.rCpu).padStart(6), String(r.gCpu).padStart(6)].join(' '));
}

if (SNAP && snap0) {
  const snap1 = await census();
  const diff = [...snap1].map(([k, [n, b]]) => [k, n - ((snap0.get(k) || [0])[0]), b - ((snap0.get(k) || [0, 0])[1])]).sort((a, b) => b[1] - a[1]);
  console.log('heap census growth since minute 2 (count, bytes):');
  for (const [k, n, b] of diff.slice(0, 30)) console.log('  ' + String(n).padStart(8) + ' ' + String(b).padStart(10) + '  ' + k);
}

// ---- --profile: 5 s of renderer CPU, the top self times ----
if (argv.includes('--profile')) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await sleep(5000);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), dts = profile.timeDeltas, ids = profile.samples, byId = new Map(profile.nodes.map((n) => [n.id, n]));
  ids.forEach((id, i) => { const f = byId.get(id).callFrame; const k = (f.functionName || '(anon)') + ' ' + f.url.split('/').pop() + ':' + f.lineNumber; self.set(k, (self.get(k) || 0) + (dts[i] || 0)); });
  const total = dts.reduce((a, b) => a + b, 0);
  console.log('profile: top self time of ' + (total / 1000).toFixed(0) + ' ms');
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('  ' + (us / total * 100).toFixed(1).padStart(5) + '%  ' + k);
}

// ---- verdict: the last minute against the first full minute ----
const win = (a, b) => rows.filter((r) => r.min > a && r.min <= b);
const med = (rs, k) => q(rs.map((r) => r[k]), 0.5);
const first = win(1, 2), last = win(MINUTES - 1, MINUTES);
const d = (k) => +(med(last, k) - med(first, k)).toFixed(1);
const R = { rendMB: [med(first, 'rMB'), med(last, 'rMB')], gpuMB: [med(first, 'gMB'), med(last, 'gMB')], heapMB: [med(first, 'heapMB'), med(last, 'heapMB')], nodes: [med(first, 'nodes'), med(last, 'nodes')],
  listeners: [med(first, 'listeners'), med(last, 'listeners')], lagP95: [med(first, 'lagP95'), med(last, 'lagP95')],
  rendersLastMin: last.reduce((n, r) => n + r.renders, 0), leadMinLast: Math.min(...last.map((r) => r.leadMin)), workers: rows.at(-1).workers };
console.log('SOAK-RESULT ' + JSON.stringify(R));
ok('heap flat: last minute within ' + BOUNDS.heapMB + ' MB of the first', d('heapMB') <= BOUNDS.heapMB, R.heapMB);
ok('DOM nodes flat', d('nodes') <= BOUNDS.nodes, R.nodes);
ok('listeners flat', d('listeners') <= BOUNDS.listeners, R.listeners);
ok('event-loop lag p95 under ' + BOUNDS.lagP95 + ' ms in the last minute', med(last, 'lagP95') <= BOUNDS.lagP95, R.lagP95);
ok('the twin re-renders at most ' + BOUNDS.renders + ' times in the last minute (a wrap may re-render)', R.rendersLastMin <= BOUNDS.renders, R.rendersLastMin);
ok('one Kinetic worker alive', R.workers === 1, R.workers);
ok('segments still sent ahead: lead min over ' + BOUNDS.leadMin + ' ms in the last minute', R.leadMinLast >= BOUNDS.leadMin, R.leadMinLast);
ok('segments flow in the last minute', last.every((r) => r.segPerS > 0), last.map((r) => r.segPerS));
ok('no page error', errors.length === 0, errors.slice(0, 3));

await browser.close();
srv.close();
cleanup();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
