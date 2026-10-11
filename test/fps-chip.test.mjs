/**
 * fps-chip.test.mjs -- the top bar's fps chip and the shared frame-rate sampler
 * (framerate.svelte.js): the chip follows a frame-rate change inside 500 ms, with
 * no rail on screen at all; no frame callback runs while the page is hidden;
 * Health reads the same sampler (its Frame rate line, and slow-display opening).
 * rAF is replaced by a timer of settable period (window.__raf.ms; 0 = the real one).
 * Run: node test/fps-chip.test.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { goTab } from './nav.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const RAF = () => {
  const real = window.requestAnimationFrame.bind(window);
  window.__raf = { ms: 0, calls: 0 };
  window.requestAnimationFrame = (cb) => {
    window.__raf.calls++;
    return window.__raf.ms ? setTimeout(() => cb(performance.now()), window.__raf.ms) : real(cb);
  };
};
const SIM = fileURLToPath(new URL('../../Nucleus/sim/valencesim/build/valencesim.exe', import.meta.url));
const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1428, height: 900 } });
await ctx.addInitScript(TAURI_STUB);
await ctx.addInitScript(() => { delete globalThis.PressureObserver; });
await ctx.addInitScript(RAF);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) errors.push(String(e)); });
await page.goto('http://127.0.0.1:' + srv.address().port + '/');
await page.waitForSelector('[role=tab][data-tab-id]', { state: 'attached', timeout: 20000 });
const chip = () => page.evaluate(() => {
  const t = document.querySelector('.linkbar .fps')?.textContent.trim() || '';
  return { n: /^\d+ fps$/.test(t) ? parseInt(t, 10) : null, tip: document.querySelector('.linkbar .fps')?.closest('.chip').getAttribute('data-tip') };
});
const setRaf = (ms) => page.evaluate((m) => { window.__raf.ms = m; }, ms);
const sleep = (ms) => page.waitForTimeout(ms);

console.log('\n--- the chip ---');
await sleep(1500);
const base = await chip();
ok('the chip reads N fps with no rail on screen', base.n != null && base.n >= 30, base);
ok('its tooltip is "Frames per second this window can draw"', base.tip === 'Frames per second this window can draw', base.tip);

await setRaf(50); // ~20 fps
const t0 = Date.now();
let moved = null;
while (Date.now() - t0 < 500) { const c = await chip(); if (c.n != null && c.n < base.n * 0.8) { moved = [c.n, Date.now() - t0]; break; } await sleep(25); }
ok('a drop to ~20 fps shows on the chip within 500 ms', moved != null, { base: base.n, moved });
await sleep(1500);
const slow = await chip();
ok('...and it settles near the new rate', slow.n >= 10 && slow.n <= 26, slow);
await setRaf(0);
await sleep(1500);
const back = await chip();
ok('...and climbs back when the frames return', back.n > 35, back);

console.log('\n--- hidden ---');
const vis = (v) => page.evaluate((v) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);
await vis('hidden');
await sleep(200);
await page.evaluate(() => { window.__raf.calls = 0; });
await sleep(1500);
const calls = await page.evaluate(() => window.__raf.calls);
ok('no frame callbacks are requested while the page is hidden', calls === 0, calls);
ok('the chip reads -- fps while hidden', (await chip()).n === null);
await vis('visible');
await sleep(600);
ok('the chip is back within 600 ms of showing again', (await chip()).n != null);

console.log('\n--- Health reads the same sampler ---');
// Health's Log feed needs a catalog, so this part runs a page against the sim; SKIPs without it.
if (!existsSync(SIM)) console.log('  SKIP: no valencesim at ' + SIM);
else {
  const PORT = 20000 + Math.floor(Math.random() * 20000);
  const tmp = mkdtempSync(join(tmpdir(), 'fps-'));
  const sim = spawn(SIM, ['machine', '--homed', '--headless', '--no-mdns', '--no-discovery', '--no-estop-udp', '--duration', '300',
    '--port', String(PORT), '--http', String(PORT + 1), '--state', join(tmp, 'sim')], { stdio: 'ignore', windowsHide: true });
  const done = () => { try { sim.kill(); } catch (e) { /* gone */ } rmSync(tmp, { recursive: true, force: true }); };
  process.on('exit', done);
  await sleep(2500);
  const hsrv = createServer((q, s) => {
    if (q.url.startsWith('/uitoken')) {
      fetch('http://127.0.0.1:' + (PORT + 1) + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
        .catch(() => { s.writeHead(502); s.end('{}'); });
      return;
    }
    s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
  });
  await new Promise((r) => hsrv.listen(0, '127.0.0.1', r));
  const hctx = await browser.newContext({ viewport: { width: 1428, height: 900 } });
  await hctx.addInitScript(TAURI_STUB);
  await hctx.addInitScript(() => { delete globalThis.PressureObserver; });
  await hctx.addInitScript(RAF);
  await hctx.addInitScript((port) => {
    try { localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }])); } catch (e) { /* none */ }
  }, PORT);
  const hp = await hctx.newPage();
  await hp.goto('http://127.0.0.1:' + hsrv.address().port + '/');
  await hp.waitForSelector('[role=tab][data-tab-id]', { state: 'attached', timeout: 20000 });
  await hp.evaluate(() => { window.__raf.ms = 60; }); // ~16 fps, under the 30 fps line
  await goTab(hp, 'log');
  await hp.click('[data-feed="health"]');
  await hp.waitForSelector('.health', { timeout: 5000 });
  await hp.waitForTimeout(3000);
  const line = await hp.evaluate(() => [...document.querySelectorAll('.health dt')].filter((e) => e.textContent.trim() === 'Frame rate')
    .map((e) => e.nextElementSibling.textContent.trim())[0] || null);
  const hn = line && /^(\d+) fps$/.test(line) ? parseInt(line, 10) : null;
  ok('the Health card reads the sampler\'s rate', hn != null && hn >= 8 && hn <= 24, line);
  let opened = false;
  for (let t = Date.now(); !opened && Date.now() - t < 45000; ) {
    opened = await hp.evaluate(() => !!document.querySelector('.incs > li[data-cond="slow-display"]'));
    if (!opened) await hp.waitForTimeout(1000);
  }
  ok('slow-display opens off the shared sampler once the 30 s hold passes', opened);
  hsrv.close();
  done();
}

ok('no page errors', errors.length === 0, errors);
await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
