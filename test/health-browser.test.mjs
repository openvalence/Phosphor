/**
 * health-browser.test.mjs -- the health system end to end (ph-9t5l, ph-9t5l.1):
 * the funscript player streams a script to the native valencesim and each
 * cutout cause is injected and must come back classified in the Log and on the
 * Health view; then the report review, Hold to send and its URL.
 *
 *   client stall: a 300 ms busy loop in the page, then 11 s later a 700 ms
 *     one -> cutout-client twice (the strokes are 150 to 200 ms, so the
 *     hub's buffered moves run out inside either stall)
 *   network delay: page.routeWebSocket holds every client-to-hub frame 300 ms
 *     for 2 s -> cutout-network (likely, from the CLOCK uplink delay)
 *   page hidden while streaming -> background (D7)
 *   hub late: a second sim with --plan-delay-ms 300 -> cutout-hub (likely);
 *     SKIPPED on a sim built before the flag
 *
 * Screenshots with --shots [dir] (default test/evidence/health): the Health
 * view and the review at 1428x900 and 420x860, dark and Paper.
 * Needs ../Nucleus/sim/valencesim/build/valencesim.exe; SKIPs without it.
 * Run: node test/health-browser.test.mjs [--shots [dir]]
 * Constraints: the sim and the page run on private ports; the sim is killed on every exit path.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { EVIDENCE } from './dist.mjs';
import { goTab } from './nav.mjs';

const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SHOT = argv.includes('--shots');
const SHOTS = (SHOT && argOf('--shots') && !argOf('--shots').startsWith('-') && argOf('--shots')) || join(EVIDENCE, 'health');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const HTTP = PORT + 1;
const SIM = fileURLToPath(new URL('../../Nucleus/sim/valencesim/build/valencesim.exe', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const failed = [];
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) { fails++; failed.push(name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 600) : '')); }
};
if (!existsSync(SIM)) { console.log('SKIP: no valencesim at ' + SIM); process.exit(0); }
// An unknown flag prints the usage line: it names --plan-delay-ms once the sim has it.
const PLAN_DELAY = /--plan-delay-ms/.test(spawnSync(SIM, ['--usage'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stderr || '');
mkdirSync(SHOTS, { recursive: true });

// Strokes 150..200 ms over 0..100, two minutes long: short enough that a 300 ms stall outruns the hub's buffer.
const actions = [];
for (let at = 0, k = 0; at < 120000; k++) {
  actions.push({ at, pos: k % 2 ? 60 + ((k * 13) % 40) : (k * 7) % 40 });
  at += 150 + ((k * 37) % 50);
}
const SCRIPT = Buffer.from(JSON.stringify({ version: '1.0', inverted: false, range: 100, actions }));
// The same timing over 45..55: under the input speed limit, so the player's page warning stays out of the slot ranking below.
const GENTLE = Buffer.from(JSON.stringify({ version: '1.0', inverted: false, range: 100, actions: actions.map((a) => ({ at: a.at, pos: 45 + a.pos / 10 })) }));

const TMP = mkdtempSync(join(tmpdir(), 'health-'));
const sims = [];
const cleanup = () => { for (const s of sims) try { s.kill(); } catch (e) { /* gone */ } rmSync(TMP, { recursive: true, force: true }); };
process.on('exit', cleanup);
/** A sim on port (its HTTP on port + 1); /uitoken below mints from the one the last page opened. */
let tokenFrom = HTTP;
async function startSim(port, extra = []) {
  sims.push(spawn(SIM, ['machine', '--homed', '--headless', '--no-mdns', '--no-discovery', '--no-estop-udp',
    '--duration', '900', '--port', String(port), '--http', String(port + 1), '--state', join(TMP, 'sim' + port), ...extra],
  { stdio: 'ignore', windowsHide: true }));
  tokenFrom = port + 1;
  await sleep(2500);
}
await startSim(PORT);

const SHELL = await buildShellPage();
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + tokenFrom + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });

// The client-to-hub leg through a FIFO: `delay.ms` holds each frame that long, order kept.
const delay = { ms: 0, hold: false };
async function routeLink(ctx, port) {
  await ctx.routeWebSocket(new RegExp(':' + port + '/'), (ws) => {
    const server = ws.connectToServer();
    let last = 0;
    ws.onMessage((m) => {
      const at = Math.max(last, Date.now() + delay.ms);
      last = at;
      const go = () => { try { server.send(m); } catch (e) { /* closed */ } };
      if (at <= Date.now()) go(); else setTimeout(go, at - Date.now());
    });
    server.onMessage((m) => { try { ws.send(m); } catch (e) { /* closed */ } });
    ws.onClose((c, r) => server.close({ code: c, reason: r }));
    server.onClose((c, r) => ws.close({ code: c, reason: r }));
  });
}

// The two OS acts a report needs, captured: open_report_url resolves, save_report answers a path.
function REPORT_STUB() {
  const base = window.__TAURI_INTERNALS__.invoke;
  window.__opened = [];
  window.__saved = [];
  window.__TAURI_INTERNALS__.invoke = (cmd, a) => {
    if (cmd === 'open_report_url') { window.__opened.push(a.url); return Promise.resolve(); }
    if (cmd === 'save_report') { window.__saved.push(a); return Promise.resolve('C:/Downloads/' + a.name); }
    return base(cmd, a);
  };
}

async function open({ width = 1428, height = 900, theme = null, port = PORT } = {}) {
  tokenFrom = port + 1;
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(REPORT_STUB);
  // The host's own CPU pressure (a busy test machine reads critical) would raise "overloaded" over the injected causes.
  await ctx.addInitScript(() => { delete globalThis.PressureObserver; });
  await ctx.addInitScript(([port, theme]) => {
    try {
      if (sessionStorage.getItem('health.seeded')) return;
      sessionStorage.setItem('health.seeded', '1');
      localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      if (theme) localStorage.setItem('sd32.theme', theme);
    } catch (e) { /* none */ }
  }, [port, theme]);
  await routeLink(ctx, port);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) errors.push(String(e)); });
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.waitForSelector('[role=tab][data-tab-id]', { state: 'attached', timeout: 20000 });
  return { ctx, page, errors };
}

const C = 'main.pane .fsp';
async function play(page, script = SCRIPT) {
  const TAB = 'plugin:funscript-player:player';
  await page.waitForSelector('[data-tab-id="' + TAB + '"]', { state: 'attached', timeout: 20000 });
  for (let i = 0; i < 4 && !await page.locator(C).first().isVisible().catch(() => false); i++) {
    await goTab(page, TAB).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.setInputFiles(C + ' .fsp-files', [{ name: 'clip.funscript', mimeType: 'application/json', buffer: script }]);
  await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 15000 });
  await page.locator(C + ' .fsp-play').evaluate((e) => e.click());
}
const incidents = (page) => page.evaluate(() => [...document.querySelectorAll('.incs > li')].map((li) => ({
  cond: li.dataset.cond, cause: li.dataset.cause, sev: li.dataset.sev, at: +li.dataset.at, text: li.querySelector('.text').textContent })));
const logLines = (page) => page.evaluate(() => [...document.querySelectorAll('#lp-feed-log .line')]
  .filter((l) => /health/.test(l.textContent)).map((l) => l.querySelector('.text').textContent));
async function toHealth(page) {
  await goTab(page, 'log');
  await page.click('[data-feed="health"]');
  await page.waitForSelector('.health', { timeout: 5000 });
}
async function waitFor(page, cond, ms) {
  const t = Date.now();
  for (;;) {
    const hit = (await incidents(page)).find((i) => i.cond === cond);
    if (hit || Date.now() - t > ms) return hit || null;
    await page.waitForTimeout(250);
  }
}

// ---- 1. the causes (injected on the player page, read on Health after) ---------
console.log('\n--- causes, against valencesim ---');
const { ctx, page, errors } = await open();
await play(page);
await page.waitForTimeout(4000);
await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 300) { /* busy */ } });
await page.waitForTimeout(11000);
await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 700) { /* busy */ } });
await page.waitForTimeout(3000);
const delayAt = Date.now();
delay.ms = 300;
await page.waitForTimeout(2000);
delay.ms = 0;
await page.waitForTimeout(2500);
// Background while streaming (D7): the page reports hidden, then visible again.
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1500);
await toHealth(page);
const all = await incidents(page);
const client = all.find((i) => i.cond === 'cutout-client');
const net = all.find((i) => i.cond === 'cutout-network');
ok('client stalls of 300 and 700 ms: classified CLIENT, twice', client && client.cause === 'client' && /×2/.test(client.text), all);
ok('client stall: a freeze line besides', all.some((i) => i.cond === 'freeze'), all);
ok('network delay: classified NETWORK (likely), not blamed on this device', net && net.cause === 'network' && /likely/.test(net.text), all);
ok('a stall here is never WiFi: no delay spike or WiFi cutout opened before the injected delay',
  !all.some((i) => (i.cond === 'delay-spike' || i.cond === 'cutout-network') && i.at < delayAt), all.map((i) => [i.cond, i.at - delayAt]));
ok('no cause guessed: no hub or unknown cutout', !all.some((i) => i.cond === 'cutout-hub' || i.cond === 'cutout-unknown'), all);
ok('page hidden while streaming: "Phosphor is in the background"', all.some((i) => i.cond === 'background'), all);
ok('the Link card shows how far ahead moves left', /\d+ ms/.test(await page.textContent('.health dl.pane-facts dd:nth-of-type(3)')));
// Operator 2026-10-10: the address, the control list and the firmware are Health rows, not top bar chips.
const moved = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.health dl.pane-facts dt')]
  .filter((d) => /^(Address|Control list|Firmware)$/.test(d.textContent)).map((d) => [d.textContent, d.nextElementSibling.textContent.trim()])));
ok('Health holds the address, the control list and the firmware', !!moved.Address && moved.Address !== '--'
  && / B|KB|MB/.test(moved['Control list'] || '') && !!moved.Firmware, moved);

if (!PLAN_DELAY) console.log('  [SKIP] hub late: valencesim has no --plan-delay-ms yet');
else {
  // Hub late: every solve on a second sim lands 300 ms after it starts, past the stream's lead; the moves left and arrived on time.
  await startSim(PORT + 2, ['--plan-delay-ms', '300']);
  const o = await open({ port: PORT + 2 });
  await play(o.page);
  await o.page.waitForTimeout(8000);
  await toHealth(o.page);
  const h = await o.page.evaluate(() => [...document.querySelectorAll('.incs > li')].map((li) => ({
    cond: li.dataset.cond, cause: li.dataset.cause, text: li.querySelector('.text').textContent })));
  ok('hub late (--plan-delay-ms 300): classified HUB (likely), never this device or the WiFi',
    h.some((i) => i.cond === 'cutout-hub' && /machine fell behind \(likely\)/.test(i.text))
    && !h.some((i) => i.cond === 'cutout-client' || i.cond === 'cutout-network'), h);
  await o.ctx.close();
}

// The Log carries one line per incident, tagged health.
await goTab(page, 'log');
await page.click('[data-feed="log"]');
const lines = await logLines(page);
ok('Log: a health line per cause, the pause and its measured cause', lines.some((l) => /Motion paused .* · this device stalled \d+ ms/.test(l))
  && lines.some((l) => /Motion paused .* · (WiFi delay|no updates for) \d+ ms \(likely\)/.test(l)), lines);

ok('no page error', errors.length === 0, errors);
// ---- 2. the report ------------------------------------------------------------
console.log('\n--- report ---');
await toHealth(page);
await page.click('.incs > li[data-cond="cutout-client"] summary');
await page.click('.incs > li[data-cond="cutout-client"] .more button');
await page.waitForSelector('.review', { timeout: 5000 });
const rows = await page.$$eval('.review .row', (rs) => rs.map((r) => r.dataset.path));
ok('review: one row per field, raw JSON under each', rows.length >= 50 && await page.$$eval('.review .row .raw code', (c) => c.length) === rows.length, rows.length);
ok('review: the privacy text and Not included', /Nothing is sent until you press Submit there/.test(await page.textContent('.review .priv'))
  && (await page.$$eval('.review .not li', (l) => l.length)) === 8);
const send = page.locator('.review .send');
await send.hover();
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(1200);
ok('Hold to send: a 0.7 s hold opens nothing', (await page.evaluate(() => window.__opened.length)) === 0);
await send.focus();
await page.keyboard.down('Enter');
await page.waitForTimeout(1700);
await page.keyboard.up('Enter');
await page.waitForTimeout(500);
const opened = await page.evaluate(() => window.__opened);
const u = opened[0] ? new URL(opened[0]) : null;
const id = await page.textContent('.review .top .mono');
const b = u ? JSON.parse(u.searchParams.get('bundle')) : null;
ok('Hold to send: 1.5 s by keyboard opens the new-issue URL', u && u.origin + u.pathname === 'https://github.com/openvalence/Phosphor/issues/new'
  && u.searchParams.get('template') === 'diag-report.yml' && u.searchParams.get('title') === 'Diagnostic report ' + id, opened);
ok('the bundle: schema, cause and the client evidence', b && b.schema === 'phosphor.health-report/1' && b.incident.cause === 'client'
  && b.incident.condition === 'cutout' && b.window.series.rtt_ms.length === 46, b && b.incident);
ok('the URL stays under the budget', opened[0] && opened[0].split('?')[1].length < 7500, opened[0] && opened[0].length);
ok('Sent reports: the row is kept (shell: About)', await page.evaluate((i) => JSON.parse(localStorage.getItem('phosphor.reports.v1') || '[]').some((r) => r.id === i), id));
await page.click('.review .acts .og-btn:not(.send)');
await page.waitForTimeout(300);
ok('Save report: the same JSON to a file', await page.evaluate(() => window.__saved.length === 1 && /^diag-report-[A-Z2-7]{8}\.json$/.test(window.__saved[0].name)));
await ctx.close();

// ---- 2b. the status slot (DESIGN 10.14): latch notice > act health > safety edge > warn health ----
console.log('\n--- the status slot ---');
{
  const o = await open();
  const slot = () => o.page.evaluate(() => {
    const s = document.querySelector('.topstrip .status');
    const b = s && s.querySelector('.st-dismiss');
    return { kind: s && s.dataset.kind, text: s ? s.textContent.trim() : '', title: b ? b.title : '' };
  });
  const pause = o.page.locator('.topstrip .btn-pause');
  const waitKind = async (kind, ms = 4000) => {
    const t = Date.now();
    for (;;) { const s = await slot(); if (s.kind === kind || Date.now() - t > ms) return s; await o.page.waitForTimeout(150); }
  };
  const stall = () => o.page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 700) { /* busy */ } });
  await play(o.page, GENTLE);
  await o.page.waitForTimeout(2000);
  // A safety edge first: pause, then resume (the player stops on the latch and plays again after).
  await pause.click();
  const paused = await waitKind('notice');
  await pause.click();
  const edge = await waitKind('edge');
  ok('slot: the latch notice, then the safety edge it leaves', paused.kind === 'notice' && /Paused/.test(paused.text) && edge.kind === 'edge', [paused, edge]);
  await play(o.page, GENTLE);
  await o.page.waitForTimeout(2500);
  await stall();
  await o.page.waitForTimeout(1500);
  const warn = await slot();
  ok('slot: a warn health condition yields to the safety edge', warn.kind === 'edge', warn);
  await o.page.waitForTimeout(9500);
  await stall();
  await o.page.waitForTimeout(11000);
  await stall();
  const act = await waitKind('health');
  ok('slot: the third cutout in 60 s is act and takes the slot over the edge', act.kind === 'health' && /this device stalled \d+ ms/.test(act.text), act);
  const tip = act.title.split('\n');
  ok('slot: the tooltip is the detail, never the line: measured, since, threshold, action, the click', tip.length >= 4 && !tip.includes(act.text)
    && /^Measured: /.test(tip[0]) && /^Since /.test(tip[1]) && tip[tip.length - 1] === 'Click to open this incident', act.title);
  await pause.click();
  const over = await waitKind('notice');
  ok('slot: a latch notice still outranks an act health condition', over.kind === 'notice' && /Paused/.test(over.text), over);
  await pause.click();
  await waitKind('health');
  await o.page.click('.topstrip .status[data-kind="health"] .st-dismiss');
  ok('slot: the health line opens the Log page on its Health view', await o.page.waitForSelector('.health', { timeout: 5000 }).then(() => true, () => false)
    && await o.page.getAttribute('[data-feed="health"]', 'aria-selected') === 'true');
  ok('slot: ...with its incident open', await o.page.evaluate(() => [...document.querySelectorAll('.incs > li')]
    .filter((li) => li.querySelector('details').open).map((li) => li.dataset.cond).join() === 'cutout-client'));
  await o.ctx.close();
}

// ---- 2c. the rail's own census: clock drift in the slot, the bar untouched ----
console.log('\n--- clock drift in the status slot ---');
{
  const o = await open();
  const bar = () => o.page.evaluate(() => ({ rects: [...document.querySelectorAll('.linkbar .wordmark, .linkbar .chip')]
    .map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round).join(','); }).join(' | '),
    fps: document.querySelector('.linkbar .fps')?.textContent.trim() || null }));
  const slot = () => o.page.evaluate(() => {
    const s = document.querySelector('.topstrip .status');
    return { kind: s && s.dataset.kind, text: s ? s.textContent.trim() : '', title: s ? (s.querySelector('.st-dismiss')?.title || s.title || '') : '' };
  });
  await play(o.page, GENTLE);
  await o.page.waitForTimeout(2500);
  const b0 = await bar();
  await o.page.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() - 40; });
  let s = await slot();
  for (let t = Date.now(); !/^Clock drift \d+ ms$/.test(s.text) && Date.now() - t < 20000; ) { await o.page.waitForTimeout(500); s = await slot(); }
  ok('clock drift: the status slot reads "Clock drift N ms" once it holds 10 s', /^Clock drift \d+ ms$/.test(s.text) && s.kind === 'health', s);
  const tipL = s.title.split('\n');
  ok('clock drift: its tooltip is the detail: why, since, threshold, action, the click', tipL.length >= 4 && /clocks disagree/.test(tipL[0]) && /^Since /.test(tipL[1])
    && /2 ms/.test(tipL[2]) && tipL[tipL.length - 1] === 'Click to open this incident' && !/held|skew/i.test(s.title + s.text), s.title);
  const b1 = await bar();
  ok('clock drift: the top bar moves nothing and the fps chip still reads N fps', b0.rects === b1.rects && /^\d+ fps$/.test(b1.fps || ''), [b0, b1]);
  await o.ctx.close();
}

// ---- 3. screenshots ---------------------------------------------------------------
if (SHOT) console.log('\n--- screenshots ---');
// One session per theme: the incidents are made at 1428x900, then the same page is resized to 420x860.
for (const theme of SHOT ? [null, 'paper'] : []) {
  const o = await open({ theme, port: PORT });
  await play(o.page);
  await o.page.waitForTimeout(3000);
  delay.ms = 300;
  await o.page.waitForTimeout(2000);
  delay.ms = 0;
  await o.page.waitForTimeout(3000);
  await o.page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 700) { /* busy */ } });
  await o.page.waitForTimeout(2500);
  for (const [w, h] of [[1428, 900], [420, 860]]) {
    await o.page.setViewportSize({ width: w, height: h });
    await o.page.waitForTimeout(1000);
    await toHealth(o.page);
    const top = (sel) => o.page.evaluate((q) => { const r = document.querySelector(q); if (r) r.scrollIntoView({ block: 'start' }); }, sel);
    await top('.health');
    await o.page.waitForTimeout(1200);
    if (process.env.HEALTH_DUMP) console.log(JSON.stringify(await o.page.evaluate(() => [...document.querySelectorAll('.incs > li')].map((li) => li.dataset.cond + ' | ' + li.querySelector('.text').textContent + ' | ' + li.querySelector('.ev').textContent)), null, 1));
    const tag = (theme || 'dark') + '-' + w + 'x' + h;
    await o.page.screenshot({ path: join(SHOTS, 'health-' + tag + '.png') });
    const first = o.page.locator('.incs > li[data-cond^="cutout"]').first();
    await first.locator('summary').click();
    await top('#hp-inc');
    await o.page.screenshot({ path: join(SHOTS, 'incident-' + tag + '.png') });
    await first.locator('.more button').click();
    await o.page.waitForSelector('.review', { timeout: 5000 });
    await top('.review');
    await o.page.screenshot({ path: join(SHOTS, 'review-' + tag + '.png') });
    await top('#rr-priv');
    await o.page.screenshot({ path: join(SHOTS, 'review-send-' + tag + '.png') });
    await o.page.click('.review .top .og-btn');
    ok('screenshots ' + tag, true);
  }
  await o.ctx.close();
}

await browser.close();
srv.close();
// The failures again at the end: the parallel runner shows only the last lines.
for (const f of failed) console.log('  [FAIL] ' + f);
console.log('\n' + (fails ? 'FAIL -- ' + fails : 'PASS -- health end to end') + '  (shots: ' + SHOTS + ')');
process.exit(fails ? 1 : 0);
