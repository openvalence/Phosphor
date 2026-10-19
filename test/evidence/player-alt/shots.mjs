// shots.mjs -- screenshots of the alt fullscreen player against the built-in Neutrino (no device).
// Run: node test/evidence/player-alt/shots.mjs   (writes PNGs next to this file)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShellPage, TAURI_STUB } from '../../shell-build.mjs';
import { goTab } from '../../nav.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'fsp-alt-'));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=40',
  '-c:v', 'libvpx', '-b:v', '600k', '-g', '30', join(TMP, 'clip.webm')], { windowsHide: true, stdio: 'pipe' });
const VIDEO = readFileSync(join(TMP, 'clip.webm'));
// Strokes from 4 s to 34 s of the 40 s clip, slow to fast and back, so the heat and the hatch both show.
const actions = [];
for (let t = 4000, i = 0; t <= 34000; i++) {
  const p = Math.min(1, Math.abs(t - 19000) / 15000), dt = 180 + 520 * p;
  actions.push({ at: Math.round(t), pos: i % 2 ? 90 : 10 });
  t += dt;
}
const SCRIPT = Buffer.from(JSON.stringify({ version: '1.0', actions }));

const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch();
const C = 'main.pane .fsp';

async function session(name, { width, height, touch = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(() => { delete globalThis.PressureObserver; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) console.log('pageerror', name, String(e)); });
  await page.goto(URL0);
  // The built-in machine: the Neutrino row's Connect (the first screen with no saved hub), then LIVE.
  const row = page.locator('li.virtual').first();
  await row.waitFor({ timeout: 20000 });
  await row.getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => /live/i.test(document.querySelector('.linkbar .linkdot .sr')?.textContent || ''), null, { timeout: 20000 }).catch(() => console.log(name, 'not live'));
  for (let i = 0; i < 4; i++) {
    await goTab(page, 'plugin:funscript-player:player').catch(() => {});
    if (await page.waitForSelector(C, { timeout: 4000 }).then(() => true, () => false)) break;
  }
  await page.setInputFiles(C + ' .fsp-filev', [
    { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO },
    { name: 'clip.funscript', mimeType: 'application/json', buffer: SCRIPT },
  ]);
  await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play')?.disabled, C, { timeout: 8000 }).catch(() => console.log(name, 'Play stays grayed'));
  // Seek into the script so the wave has strokes either side of the playhead.
  await page.locator(C + ' video').evaluate((v) => { v.currentTime = 6; });
  await page.locator(C + ' .fsp-full').evaluate((b) => b.click());
  await page.waitForSelector(C + '[data-media]', { timeout: 5000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}
const shot = (page, n) => page.screenshot({ path: join(OUT, n + '.png') });
const play = (page) => page.locator(C + ' .fsp-play').evaluate((b) => b.click());

// Desktop, a mouse: paused (the bar kept), the stack hovered, then playing and idle (bar gone, the ghost).
{
  const { ctx, page } = await session('desktop', { width: 1440, height: 900 });
  await page.mouse.move(720, 300);
  await page.waitForTimeout(400);
  await shot(page, 'desktop-paused-bar');
  const sb = await page.locator(C + ' .fsp-stack').boundingBox();
  if (sb) { await page.mouse.move(sb.x + sb.width * 0.3, sb.y + 20); await page.waitForTimeout(400); await shot(page, 'desktop-paused-stack-hover'); }
  await play(page);
  await page.mouse.move(720, 300);
  await page.waitForTimeout(3500);
  await shot(page, 'desktop-playing-idle');
  await page.mouse.move(700, 320);
  await page.waitForTimeout(500);
  await shot(page, 'desktop-playing-bar');
  await ctx.close();
}
// A phone on its side, touch: paused (everything up), playing and idle (the ghost), then a tap brings the controls.
{
  const { ctx, page } = await session('landscape', { width: 844, height: 390, touch: true });
  // A first tap makes the stage a touch one (it hides the kept controls), a second brings them back.
  await page.touchscreen.tap(120, 120);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(120, 120);
  await page.waitForTimeout(600);
  await shot(page, 'phone-landscape-paused');
  await play(page);
  await page.waitForTimeout(3500);
  await shot(page, 'phone-landscape-playing-idle');
  await page.touchscreen.tap(120, 120);
  await page.waitForTimeout(600);
  await shot(page, 'phone-landscape-playing-bar');
  await ctx.close();
}
// A phone upright, touch, paused.
{
  const { ctx, page } = await session('portrait', { width: 390, height: 844, touch: true });
  await shot(page, 'phone-portrait-paused');
  await ctx.close();
}
await browser.close();
srv.close();
console.log('shots in', OUT);
