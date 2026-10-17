/**
 * theme-temple.test.mjs -- the hidden Temple theme's own behavior (src/themes/temple/, docs/THEMES.md,
 * Hidden themes and Behavior), in the shell bundle against a fake hub. The kit
 * (`node test/theme-skins.test.mjs --theme temple`) covers its sheet, fit, text and stop pair; this covers
 * what the sheet cannot:
 *
 *   unlock    hidden from the picker; "temple" typed in F3 applies it, and the find persists
 *   escape    Escape twice stays, three times within 1.5 s returns to the theme from before
 *   occlusion sprites pinned at 50 random places, over the stop pair too: the pair still takes the
 *             point (even with the overlay taking pointer events) and the overlay draws nothing on it
 *   hidden    no animation frame is requested while the page is hidden; frames resume when shown
 *   still     under reduced motion no frame runs and the overlay still holds the static look
 *   oracle    F7 opens a window of twelve words below the top strip; Escape closes it
 *   leave     another theme removes the overlay, the oracle and the readout
 *
 * Screenshots and a run of frames land in test/evidence/themes/temple/ (git-ignored).
 * Run: node test/theme-temple.test.mjs [--no-shots]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { EVIDENCE } from './dist.mjs';
import { goTab } from './nav.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { THEMES } from '../src/model/theme.js';

const SHOTS = process.argv.includes('--no-shots') ? null : join(EVIDENCE, 'themes', 'temple');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/neutrino-catalog.etag', import.meta.url), 'utf8').trim();
const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';

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
            [IDENTITY_K.hub_name, cbTstr('temple fixture')]])],
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
const byId = (id) => THEMES.find((t) => t.id === id);
async function boot(theme, { w = 1428, h = 900, reduce = false, unlocked = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(([etag, bytes, theme, unlocked]) => {
    try {
      if (!sessionStorage.getItem('booted')) {
        sessionStorage.setItem('booted', '1');
        localStorage.clear();
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'temple fixture', nickname: '', lastSeen: Date.now() }]));
        localStorage.setItem('phosphor.theme', JSON.stringify(theme));
        if (unlocked.length) localStorage.setItem('phosphor.theme.unlocked', JSON.stringify(unlocked));
      }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme, unlocked]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-tab-id="machine"]') || document.querySelector('.menu-btn'), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
const style = (page) => page.evaluate(() => [document.documentElement.dataset.style, document.documentElement.dataset.theme]);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };

// ---- unlock --------------------------------------------------------------------------------------
console.log('\n--- unlock ---');
{
  const { ctx, page, errors } = await boot(byId('paper'));
  await goTab(page, 'shell:settings');
  await page.waitForTimeout(300);
  ok('hidden: the picker has no Temple chip before it is found', !(await page.$('[data-style-id="temple"]')));
  await page.keyboard.press('F3');
  await page.fill('.lf-q', 'Templ');
  ok('F3 lists no Temple entry before it is found (the word itself is the key)', !(await page.$$eval('.lf-list li', (ls) => ls.some((l) => l.textContent.includes('Theme: Temple')))));
  await page.fill('.lf-q', '');
  await page.locator('.lf-q').pressSequentially('temple', { delay: 30 });
  await page.waitForTimeout(500);
  ok('typing "temple" in F3 applies it', (await style(page)).join('/') === 'temple/temple', (await style(page)).join('/'));
  ok('the find persists', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.theme.unlocked') || '[]').includes('temple')));
  ok('the theme before it is kept to leave by', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.temple.prev') || '{}').id) === 'paper');
  await page.keyboard.press('Escape');   // closes F3: one of three
  await page.waitForTimeout(1600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-tab-id="machine"]'), null, { timeout: 20000 });
  await goTab(page, 'shell:settings');
  await page.waitForTimeout(400);
  ok('after a reload the picker lists it', !!(await page.$('[data-style-id="temple"]')));
  await page.keyboard.press('F3');
  await page.fill('.lf-q', 'Theme Temple');
  ok('and F3 finds it', await page.$$eval('.lf-list li', (ls) => ls.some((l) => l.textContent.includes('Theme: Temple'))));
  await page.keyboard.press('Escape');
  ok('unlock: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- escape hatch --------------------------------------------------------------------------------
console.log('\n--- escape ---');
{
  const { ctx, page, errors } = await boot(byId('slate'), { unlocked: ['temple'] });
  await goTab(page, 'shell:settings');
  await page.waitForTimeout(300);
  await page.click('[data-style-id="temple"]');
  await page.waitForTimeout(300);
  ok('the picker applies it once found', (await style(page))[0] === 'temple');
  await page.mouse.click(700, 880);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape twice stays', (await style(page))[0] === 'temple');
  await page.waitForTimeout(1600);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  ok('two more, after a pause, still stay (the three must fall within 1.5 s)', (await style(page))[0] === 'temple');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Escape three times returns to the theme from before', (await style(page)).join('/') === 'phosphor/slate', (await style(page)).join('/'));
  const gone = await page.evaluate(() => [!!document.querySelector('.temple-fx'), !!window.__temple, document.documentElement.style.getPropertyValue('--temple-wm')]);
  ok('leaving removes the overlay, the hooks and the readout', !gone[0] && !gone[1] && !gone[2], JSON.stringify(gone));
  ok('escape: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- the stop pair under the overlay ---------------------------------------------------------------
console.log('\n--- occlusion ---');
for (const [w, h] of [[1428, 900], [420, 860]]) {
  const { ctx, page, errors } = await boot(byId('temple'), { w, h });
  await page.waitForFunction(() => window.__temple && window.__temple.frames > 2, null, { timeout: 5000 });
  const r = await page.evaluate(() => {
    const pair = [...document.querySelectorAll('[data-part="stop-frame"] button')];
    const fx = document.querySelector('.temple-fx');
    const rects = pair.map((b) => b.getBoundingClientRect());
    const pts = (r) => [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
    const bad = [];
    let painted = 0;
    const T = window.__temple;
    for (let i = 0; i < 50; i++) {
      // Every fifth lands right on a stop button; the rest anywhere on the screen.
      const target = i % 5 === 0 ? rects[i % rects.length] : null;
      const x = target ? target.left + Math.random() * target.width : Math.random() * innerWidth;
      const y = target ? target.top + Math.random() * target.height : Math.random() * innerHeight;
      T.place(i, x, y);
      for (const pe of ['none', 'auto']) {
        fx.style.pointerEvents = pe;
        pair.forEach((b, k) => pts(rects[k]).forEach(([px, py]) => {
          const hit = document.elementFromPoint(px, py);
          if (!hit || !b.contains(hit)) bad.push(i + ' ' + pe + ' ' + b.textContent.trim() + ' <- ' + (hit ? hit.className || hit.tagName : 'none'));
        }));
      }
      fx.style.pointerEvents = '';
      // The overlay itself: nothing painted over either button.
      const g = fx.getContext('2d');
      for (const r of rects) {
        const d = g.getImageData(Math.floor(r.left / 2), Math.floor(r.top / 2), Math.ceil(r.width / 2), Math.ceil(r.height / 2)).data;
        for (let k = 3; k < d.length; k += 4) if (d[k]) painted++;
      }
    }
    const z = [getComputedStyle(fx).zIndex, getComputedStyle(document.querySelector('[data-part="top"]')).zIndex, getComputedStyle(fx).pointerEvents];
    return { bad, painted, z, n: pair.length };
  });
  ok(w + ': the stop pair takes every point at 50 sprite positions, overlay passive or not', r.n === 2 && r.bad.length === 0, r.bad.slice(0, 3).join(' | '));
  ok(w + ': the overlay paints nothing on the stop pair', r.painted === 0, r.painted + ' pixels');
  ok(w + ': the overlay passes pointer events and sits under the top strip', r.z[2] === 'none' && Number(r.z[0]) < Number(r.z[1]), r.z.join(','));
  ok(w + ' occlusion: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- hidden: no frames ---------------------------------------------------------------------------------
console.log('\n--- hidden ---');
{
  const { ctx, page, errors } = await boot(byId('temple'));
  await page.waitForFunction(() => window.__temple && window.__temple.frames > 2, null, { timeout: 5000 });
  const setVis = (v) => page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);
  await setVis('hidden');
  await page.waitForTimeout(100);
  const a = await page.evaluate(() => window.__temple.calls);
  await page.waitForTimeout(1200);
  const b = await page.evaluate(() => window.__temple.calls);
  ok('hidden: no animation frame is requested', a === b, a + ' -> ' + b);
  await setVis('visible');
  await page.waitForTimeout(500);
  const c = await page.evaluate(() => window.__temple.frames);
  await page.waitForTimeout(500);
  ok('shown again: frames resume', (await page.evaluate(() => window.__temple.frames)) > c);
  ok('hidden: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- still: the static look ------------------------------------------------------------------------------
console.log('\n--- still ---');
{
  const { ctx, page, errors } = await boot(byId('temple'), { reduce: true });
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => [window.__temple.frames, window.__temple.calls]);
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => [window.__temple.frames, window.__temple.calls]);
  ok('reduced motion: no frame runs', a[0] === 0 && b[0] === 0 && a[1] === b[1], a.join(',') + ' -> ' + b.join(','));
  const lit = await page.evaluate(() => { const c = document.querySelector('.temple-fx'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k]) n++; return n; });
  ok('reduced motion: the overlay holds a static frame', lit > 100, lit + ' pixels');
  ok('reduced motion: no CSS animation of the theme runs', (await page.evaluate(() => document.getAnimations().filter((x) => x.animationName?.startsWith('theme-')).length)) === 0);
  await shot(page, 'still-dash');
  ok('still: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- the oracle -------------------------------------------------------------------------------------------
console.log('\n--- oracle ---');
{
  const { ctx, page, errors } = await boot(byId('temple'));
  await page.waitForTimeout(800);
  await page.keyboard.press('F7');
  await page.waitForTimeout(200);
  const o = await page.evaluate(() => {
    const w = document.querySelector('.temple-oracle');
    return w && { words: w.querySelector('.temple-words').textContent.trim().split(/\s+/).length, top: w.getBoundingClientRect().top,
      strip: Math.max(...[...document.querySelectorAll('[data-part="top"], [data-part="hero"]')].map((e) => e.getBoundingClientRect().bottom)), sound: w.querySelector('[data-do="sound"]').textContent };
  });
  ok('F7 opens the oracle with twelve words', o && o.words === 12, JSON.stringify(o));
  ok('the oracle opens below the top strip and the rail scope', o && o.top >= o.strip, JSON.stringify(o));
  ok('sound starts off', o && o.sound === 'Sound: Off');
  await shot(page, 'oracle');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  ok('Escape closes it', !(await page.$('.temple-oracle')));
  ok('oracle: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- the arcade (plugins/factory/arcade): its tab lives only under Temple; the games play with no machine ----
console.log('\n--- arcade ---');
{
  const { ctx, page, errors } = await boot(byId('phosphor'));
  ok('no Temple, no Arcade tab', !(await page.$('[data-tab-id="plugin:arcade:arcade"]')));
  await ctx.close();
}
{
  const { ctx, page, errors } = await boot(byId('temple'));
  await page.waitForSelector('[data-tab-id="plugin:arcade:arcade"]', { timeout: 5000 }).catch(() => {});
  ok('under Temple the Arcade tab is there', !!(await page.$('[data-tab-id="plugin:arcade:arcade"]')));
  await goTab(page, 'plugin:arcade:arcade');
  await page.waitForSelector('.arc-page canvas', { timeout: 5000 });
  const sig = () => page.evaluate(() => { const c = document.querySelector('.arc-page canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });
  for (const name of ['Road', 'Bat', 'Song']) {
    await page.click('.arc-page .og-seg button:has-text("' + name + '")');
    await page.waitForTimeout(200);
    await shot(page, 'arcade-' + name.toLowerCase() + '-intro');
    await page.click('.arc-page canvas');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const a = await sig();
    for (let i = 0; i < 6; i++) { await page.keyboard.press(name === 'Road' ? 'ArrowLeft' : name === 'Bat' ? 'Space' : 'ArrowUp'); await page.waitForTimeout(120); }
    const b = await sig();
    ok(name + ': plays with no motion allowed (the screen moves)', a !== b);
    await shot(page, 'arcade-' + name.toLowerCase());
    await page.click('.arc-page .og-btn:has-text("Stop"), .arc-page .og-btn:has-text("Play")');
  }
  // The fixture reports no position: Allow motion is refused, in words, and the switch stays off.
  await page.click('.arc-page .og-switch');
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => [document.querySelector('.arc-page .og-switch input').checked, document.querySelector('.arc-page .arc-note').textContent]);
  ok('Allow motion without a reported position is refused and stays off', st[0] === false && /^Not allowed: /.test(st[1]), JSON.stringify(st));
  ok('the warning line is shown beside it', /Pause or Halt stops it/.test(await page.textContent('.arc-page .arc-warn')));
  // Leaving the theme withdraws the tab.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('leaving Temple withdraws the Arcade tab', !(await page.$('[data-tab-id="plugin:arcade:arcade"]')));
  ok('arcade: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- the arcade on the built-in machine (the Nucleus twin in wasm): consent, limits, Pause ----------------
console.log('\n--- arcade on the built-in machine ---');
{
  const { ctx, page, errors } = await boot(byId('temple'));
  await goTab(page, 'shell:hubs');
  await page.waitForTimeout(400);
  await page.locator('.pane-list.rows').first().locator('li.virtual').getByRole('button', { name: 'Connect' }).click();
  let live = false;
  for (let i = 0; i < 40 && !live; i++) { await page.waitForTimeout(500); live = /\blive\b/.test(await page.evaluate(() => document.querySelector('.linkdot')?.className || '')); }
  ok('the built-in machine is live', live);
  await page.waitForTimeout(1500);
  const read = () => page.evaluate(() => {
    const t = [...document.querySelectorAll('[data-part="numerals"]')].map((e) => e.innerText.replace(/\s+/g, ' ')).join(' ');
    const m = /planned position · mm (-?[\d.]+)/.exec(t), v = /speed (-?\d+) mm\/s/.exec(t);
    return { pos: m ? Number(m[1]) : NaN, speed: v ? Math.abs(Number(v[1])) : NaN };
  });
  await goTab(page, 'plugin:arcade:arcade');
  await page.waitForSelector('.arc-page canvas');
  const steer = async (ms, onSample) => {
    for (let i = 0; i < ms / 250; i++) {
      const k = Math.floor(i / 4) % 2 ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.down(k); await page.waitForTimeout(250); await page.keyboard.up(k);
      if (onSample) onSample(await read());
    }
  };
  // No consent: a whole round of steering moves nothing.
  const p0 = await read();
  await page.click('.arc-page canvas');
  await page.keyboard.press('Space');
  await steer(2000);
  const p1 = await read();
  ok('without Allow motion the game moves nothing', p0.pos === p1.pos && p1.speed === 0, JSON.stringify([p0, p1]));
  await page.click('.arc-page .og-btn:has-text("Stop")');
  // Consent: it drives, inside its cap.
  await page.click('.arc-page .og-switch');
  await page.waitForTimeout(200);
  const note = await page.textContent('.arc-page .arc-note');
  const cap = Number((/at most (\d+) mm\/s/.exec(note) || [])[1]);
  ok('Allow motion is granted and names its cap', /^Motion allowed, at most \d+ mm\/s\.$/.test(note) && cap > 0, note);
  await page.click('.arc-page canvas');
  await page.keyboard.press('Space');
  let peak = 0, moved = 0;
  await steer(4000, (r) => { peak = Math.max(peak, r.speed); moved = Math.max(moved, Math.abs(r.pos - p1.pos)); });
  ok('with Allow motion the car drives the carriage', moved > 20, moved.toFixed(1) + ' mm');
  ok('the planned speed stays at the cap (planner overshoot under 5 %)', peak <= cap * 1.05, peak + ' mm/s against ' + cap);
  await shot(page, 'arcade-live');
  // Pause: the game's motion stops at once and the consent is gone.
  await page.click('[data-part="stop-frame"] button >> nth=0');
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => [document.querySelector('.arc-page .og-switch input').checked, document.querySelector('.arc-page .arc-note').textContent]);
  ok('Pause drops Allow motion and says why', st[0] === false && /^Motion stopped: paused/.test(st[1]), JSON.stringify(st));
  const a = await read();
  await page.click('.arc-page canvas');
  await page.keyboard.press('Space');
  await steer(1500);
  const b = await read();
  ok('after Pause the game moves nothing, even played again', a.pos === b.pos && b.speed === 0, JSON.stringify([a, b]));
  await goTab(page, 'shell:hubs');
  await page.locator('.pane-list.rows').first().locator('li.virtual').getByRole('button', { name: 'Stop' }).click().catch(() => {});
  ok('arcade live: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---- screenshots: every page, both variants, a context menu, a run of frames ---------------------------------
if (SHOTS) {
  console.log('\n--- screenshots ---');
  for (const id of ['temple', 'temple-doc']) {
    const { ctx, page, errors } = await boot(byId(id));
    for (const [name, tab] of [['dash', 'machine'], ['funscript', 'plugin:funscript-player:player'], ['settings', 'shell:settings'], ['log', 'log'], ['link', 'valence']]) {
      await goTab(page, tab);
      await page.waitForTimeout(700);
      await shot(page, id + '-' + name);
    }
    await goTab(page, 'machine');
    await page.waitForTimeout(500);
    const card = page.locator('[data-part="card-head"]').first();
    await card.click({ button: 'right' });
    await page.waitForTimeout(400);
    await shot(page, id + '-menu');
    await page.keyboard.press('Escape');
    if (id === 'temple') for (let i = 0; i < 8; i++) { await page.waitForTimeout(160); await shot(page, 'frame-' + i); }
    ok(id + ' screenshots: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
    const phone = await boot(byId(id), { w: 420, h: 860 });
    await phone.page.waitForTimeout(1500);
    await shot(phone.page, id + '-phone');
    await phone.ctx.close();
  }
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
