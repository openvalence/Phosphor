/**
 * motion-probe.mjs -- the motion system's proof (DESIGN §10.13 Motion) on the
 * shell bundle against a fake hub. Per transition: a filmstrip (animations
 * slowed 10x by CDP, a screenshot every slowed 25 ms), frame pacing under a
 * 4x CPU throttle, the strip and stop pair's boxes sampled every frame (they
 * must not move), and the same trigger under Motion: Reduced (no animation
 * may run). --idle measures main-thread busy time on resting pages.
 *
 * Run: node test/motion-probe.mjs [--idle] [--shots <dir>] [--only <name>]   (npm run check:motion)
 * Exit 1 on a moved strip box, a press mid-transition that misses the e-stop, or an animation under
 * Reduced. Frame pacing and idle time are reported for a before/after read, not asserted.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { THEMES } from '../src/model/theme.js';
import { goTab } from './nav.mjs';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const SHOTS = arg('--shots');
const ONLY = arg('--only');
const IDLE = args.includes('--idle');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/neutrino-catalog.etag', import.meta.url), 'utf8').trim();
const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';
const PAPER = THEMES.find((t) => t.id === 'paper');

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

function fakeHub(ws) {
  const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  ws.onMessage((msg) => {
    if (typeof msg === 'string') return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('motion fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = (cbDecodeFull(payload).get(K.subscriptions) || []).map((w) => cbMap([[K.priority, cbUint(w.get(K.priority) || 0)],
          [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)], [K.channel_id, cbUint(w.get(K.channel_id))]]));
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

const browser = await chromium.launch();
async function boot(viewport, { theme = null, motion = 'full' } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(([etag, bytes, th, mo]) => {
    try {
      if (sessionStorage.getItem('booted')) return;
      sessionStorage.setItem('booted', '1'); localStorage.clear();
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'motion fixture', nickname: '', lastSeen: Date.now() }]));
      localStorage.setItem('phosphor.prefs', JSON.stringify({ motion: mo }));
      if (th) localStorage.setItem('phosphor.theme', th);
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme ? JSON.stringify(theme) : null, motion]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-tab-id="plugins"]') || (document.querySelector('.menu-btn') && document.querySelector('.hero-strip')), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

// Every frame: the boxes that must never move, and the frame time. Started before a trigger, read after.
const SAMPLER = () => {
  const sel = '.linkbar, .topstrip, .topstrip button[data-part=strip-btn], [data-part=stop-frame] button, .menu-btn';
  const boxes = () => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); }).join('|');
  const s = { base: boxes(), moved: 0, frames: [], last: performance.now(), stop: false };
  const tick = (t) => { s.frames.push(t - s.last); s.last = t; if (boxes() !== s.base) s.moved++; if (!s.stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__motionSample = s;
};
const READ = () => { const s = window.__motionSample; s.stop = true; return { moved: s.moved, frames: s.frames.slice(1) }; };

// Scenarios: where they start, what fires the change, and an optional reverse fired mid-way.
const adv = async (p) => { await goTab(p, 'shell:settings'); await p.locator('details.adv > summary').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); };
const SCENARIOS = [
  { name: 'page', desc: 'page switch Dash to a category page (the page fade), reversed mid-way', go: async (p) => goTab(p, 'cat2'), back: async (p) => goTab(p, 'machine'), input: true },
  { name: 'drawer', phone: true, desc: 'phone menu drawer opens, closed mid-way', go: async (p) => p.click('.menu-btn'), back: async (p) => p.keyboard.press('Escape') },
  { name: 'details', desc: 'Settings > Advanced opens (FLIP), closed mid-way', setup: adv, go: async (p) => p.click('details.adv > summary'), back: async (p) => p.click('details.adv > summary') },
  { name: 'keyhelp', desc: 'F1 key help rises in, dismissed mid-way', go: async (p) => p.keyboard.press('F1'), back: async (p) => p.keyboard.press('Escape') },
  { name: 'hubrow', desc: 'Hubs: Forget a saved hub (the row goes at once, rows after it in the list slide up)', setup: async (p) => { await goTab(p, 'shell:hubs'); await p.waitForTimeout(300); },
    go: async (p) => p.getByRole('button', { name: /^Forget / }).first().click() },
  { name: 'menu', desk: true, desc: 'context menu opens (popover rise), dismissed mid-way', setup: async (p) => { await goTab(p, 'cat2'); await p.waitForTimeout(300); },
    go: async (p) => p.mouse.click(700, 420, { button: 'right' }), back: async (p) => p.keyboard.press('Escape') },
  { name: 'dashedit', desk: true, desc: 'Dash edit mode enters (tools and toolbar fade), left mid-way', go: async (p) => p.getByRole('button', { name: 'Edit layout' }).first().click(),
    back: async (p) => p.getByRole('button', { name: 'Done editing' }).first().click() },
];

async function filmstrip(s, vp, tag, theme) {
  const { ctx, page, cdp } = await boot(vp, { theme });
  if (s.setup) { await s.setup(page); await page.waitForTimeout(600); }
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.04 });
  const go = s.go(page);
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: join(SHOTS, `${s.name}-${tag}-${String(i).padStart(2, '0')}.png`) });
    // In flight: a finite, non-ambient animation running at this frame.
    if (await page.evaluate(() => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity
        && !a.effect?.target?.closest?.('[data-ambient]')))) seen.add(i);
    await page.waitForTimeout(150);
  }
  await go;
  await ctx.close();
  // The frame diff: a snap shows 2 distinct frames (before, after); a transition shows the states between.
  const strip = join(SHOTS, `${s.name}-${tag}-strip.png`);
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(SHOTS, `${s.name}-${tag}-%02d.png`), '-vf', 'scale=iw/2:-1,tile=6x2:padding=4:color=gray', '-frames:v', '1', strip]);
  } catch (e) { /* no ffmpeg: the frames stay */ }
  console.log(`    filmstrip ${s.name} ${tag}: ${seen.size} of 12 frames caught mid-transition at 0.04x  -> ${strip}`);
}

async function pacing(s, vp) {
  const { ctx, page, cdp } = await boot(vp);
  if (s.setup) { await s.setup(page); await page.waitForTimeout(600); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(SAMPLER);
  await page.waitForTimeout(100);
  await s.go(page);
  await page.waitForTimeout(400);
  const r = await page.evaluate(READ);
  // The longest frame is the new content's mount (script, not motion); the budget is on the frames around it.
  const sorted = [...r.frames].sort((a, b) => b - a);
  const long = sorted.slice(1).filter((f) => f > 1000 / 60 * 1.5).length;
  ok(`${s.name} ${vp.width}x${vp.height}: strip and stop pair hold their boxes every frame`, r.moved === 0, r.moved + ' frames moved');
  // Reported, not asserted: a throttled headless frame budget reads the host's load as much as the change.
  console.log(`    pacing ${s.name} ${vp.width}x${vp.height} at 4x throttle: ${r.frames.length} frames, mount ${sorted[0].toFixed(0)} ms,`
    + ` ${long} other frames over 25 ms, next worst ${(sorted[1] ?? 0).toFixed(1)} ms`);
  if (s.back) {
    // Reversed mid-way: the same boxes hold and nothing throws.
    await page.evaluate(SAMPLER);
    await page.evaluate(() => {}); await s.back(page); await page.waitForTimeout(60); await s.go(page); await page.waitForTimeout(60); await s.back(page);
    await page.waitForTimeout(500);
    const q = await page.evaluate(READ);
    ok(`${s.name} ${vp.width}x${vp.height}: reversed mid-way twice, strip holds`, q.moved === 0, q.moved + ' frames moved');
  }
  await ctx.close();
}

// Mid-transition, a press on the e-stop reaches the live button.
async function input(s, vp) {
  const { ctx, page, cdp } = await boot(vp);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
  const btn = page.locator('[data-part=stop-frame] button').last(); const b = await btn.boundingBox(); console.log('    stop pair button: ' + (await btn.textContent()).trim());
  await page.evaluate(() => { window.__hit = null; addEventListener('pointerdown', (e) => (window.__hit = e.target.closest('[data-part=stop-frame] button') ? 'stop pair' : e.target.tagName), true); });
  const seen = [];
  for (const wait of [0, 30, 120, 400]) {
    await s.go(page);
    await page.waitForTimeout(wait);
    const st = await page.evaluate(() => { window.__hit = null; return document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity) ? 'moving' : 'settled'; });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.mouse.up();
    seen.push(wait + 'ms:' + st + '>' + (await page.evaluate(() => window.__hit)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3000);
    await s.back(page); await page.waitForTimeout(3000);
  }
  ok(`${s.name} ${vp.width}x${vp.height}: a press mid-transition reaches the stop pair`, seen.every((x) => x.endsWith('stop pair')), seen.join(' '));
  await ctx.close();
}

async function reduced(s, vp) {
  const { ctx, page } = await boot(vp, { motion: 'reduced' });
  if (s.setup) { await s.setup(page); await page.waitForTimeout(600); }
  await page.evaluate(() => { window.__anims = 0; const o = Element.prototype.animate; Element.prototype.animate = function (...a) { window.__anims++; return o.apply(this, a); }; });
  await s.go(page);
  await page.waitForTimeout(30);
  const n = await page.evaluate(() => window.__anims + document.getAnimations().filter((a) => a.playState === 'running' && !a.effect?.target?.closest?.('[data-ambient]')).length);
  ok(`${s.name} reduced: no animation runs`, n === 0, n + ' running');
  await ctx.close();
}

async function idle() {
  for (const [label, id] of [['dash', null], ['category', 'cat2'], ['settings', 'shell:settings']]) {
    const { ctx, page, cdp } = await boot({ width: 1280, height: 800 });
    if (id) await goTab(page, id);
    await page.waitForTimeout(1500);
    await cdp.send('Performance.enable');
    const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const a = await m(); const t0 = Date.now();
    await page.waitForTimeout(10000);
    const b = await m(); const dt = (Date.now() - t0) / 1000;
    const pct = (k) => ((b[k] - a[k]) / dt * 100).toFixed(2);
    console.log(`  idle ${label}: task ${pct('TaskDuration')}% script ${pct('ScriptDuration')}% style ${pct('RecalcStyleDuration')}% layout ${pct('LayoutDuration')}%`
      + ` layouts/s ${((b.LayoutCount - a.LayoutCount) / dt).toFixed(1)} recalcs/s ${((b.RecalcStyleCount - a.RecalcStyleCount) / dt).toFixed(1)}`);
    await ctx.close();
  }
}

if (IDLE) await idle();
for (const s of SCENARIOS.filter((x) => !ONLY || x.name === ONLY)) {
  const vps = s.phone ? [{ width: 390, height: 844 }] : s.desk ? [{ width: 1280, height: 800 }] : [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
  console.log(s.name + ': ' + s.desc);
  for (const vp of vps) {
    await pacing(s, vp);
    if (s.input) await input(s, vp);
    if (SHOTS) for (const [t, th] of [['dark', null], ['light', PAPER]]) await filmstrip(s, vp, `${vp.width}-${t}`, th);
  }
  await reduced(s, vps[0]);
}
await browser.close();
srv.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
