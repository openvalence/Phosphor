/**
 * pages.test.mjs -- plugin pages (docs/PLUGINS.md, Pages) on the shell bundle
 * with the stub Tauri runtime and a fake hub on the recorded valencesim
 * catalog. Asserts:
 *   sidebar  the funscript player's page sits indented right under Plugins
 *            with its own icon, collapses to its glyph, selects like a tab
 *   mount    the page mounts the player card full width; the dash hero still
 *            mounts the same card
 *   switch   Show tab (default on, factory) hides and shows the tab live,
 *            persists under phosphor.plugins.pages.<name>, and moves nothing
 *            in the top strip or the Plugins pane
 *   look     F3 finds it as "Funscript · Phosphor › Plugins" and goes there
 *   phone    the tab strip carries it after Plugins and it mounts the card
 *
 * Run: node test/pages.test.mjs [--shots <dir>]   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { PAGE_ICON } from '../plugins/factory/funscript-player/page.js';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

// The fake hub: WELCOME on the fixture's etag, every subscription granted.
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
            [IDENTITY_K.hub_name, cbTstr('pages fixture')]])],
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
async function boot(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(([etag, bytes]) => {
    try {
      if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); localStorage.clear(); }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      if (!localStorage.getItem('phosphor.hubs')) {
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'pages fixture', nickname: '', lastSeen: Date.now() }]));
      }
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tab-id="plugins"]', { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

const ID = 'plugin:funscript-player:player';
const TAB = '[data-tab-id="' + ID + '"]';
const KEY = 'phosphor.plugins.pages.funscript-player';
const box = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); });
const shot = (page, name, opts = {}) => (SHOTS ? page.screenshot({ path: join(SHOTS, name), ...opts }) : null);

// ---- desktop ---------------------------------------------------------------
console.log('\n--- desktop 1280x800 ---');
{
  const { ctx, page, errors } = await boot({ width: 1280, height: 800 });
  const rail = await page.$$eval('nav.rail .rail-sec.shell [role=tab]', (ts) => ts.map((t) => ({
    id: t.dataset.tabId, sub: t.classList.contains('sub'), d: t.querySelector('path')?.getAttribute('d'),
    nameX: t.querySelector('.rail-name')?.getBoundingClientRect().x, label: t.textContent.trim() })));
  const at = rail.findIndex((t) => t.id === 'plugins');
  const pg = rail[at + 1];
  ok('sidebar: the page sits right under Plugins in the Phosphor section', at >= 0 && pg && pg.id === ID && pg.label === 'Funscript', JSON.stringify(rail.map((t) => t.id)));
  ok('sidebar: indented, with the plugin icon', pg && pg.sub && pg.nameX > rail[at].nameX + 8 && pg.d === PAGE_ICON, pg && pg.nameX + ' vs ' + rail[at].nameX);

  await page.click(TAB);
  await page.waitForSelector('main.pane .fsp', { timeout: 5000 });
  ok('sidebar: selectable like any tab', await page.$eval(TAB, (t) => t.getAttribute('aria-selected') === 'true'));
  const widths = await page.evaluate(() => [document.querySelector('main.pane .fsp').getBoundingClientRect().width,
    document.querySelector('main.pane .pane-main').getBoundingClientRect().width]);
  ok('mount: the page mounts the player card full width', widths[1] > 0 && widths[0] >= widths[1] - 2, widths.map(Math.round).join(' of '));
  await shot(page, 'sidebar-page-1280x800.png');

  // F3 finds it by label and path.
  await page.click('[data-tab-id="machine"]');
  await page.keyboard.press('F3');
  await page.fill('.lf-q', 'Funscript');
  const hits = await page.$$eval('.lf-list li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  ok('look: F3 lists "Funscript · Phosphor › Plugins"', hits.includes('Funscript · Phosphor › Plugins'), hits.join(' | '));
  await page.locator('.lf-list li', { hasText: 'Phosphor › Plugins' }).first().click();
  await page.waitForTimeout(200);
  ok('look: choosing it opens the page', await page.$eval(TAB, (t) => t.getAttribute('aria-selected') === 'true')
    && await page.locator('main.pane .fsp').isVisible());

  // The dash hero still mounts the same card (home first, then each category page).
  let hero = false;
  for (const id of await page.$$eval('nav.rail [role=tab]', (ts) => ts.map((t) => t.dataset.tabId).filter((x) => x === 'machine' || x.startsWith('cat')))) {
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(150);
    if (await page.locator('main.pane .dash-cell .fsp').first().isVisible().catch(() => false)) { hero = true; break; }
  }
  ok('mount: the dash hero keeps rendering the card', hero);

  // Show tab: default on; off hides the tab live, on brings it back; nothing else moves.
  await page.click('[data-tab-id="plugins"]');
  const row = 'section.plugin[aria-label="funscript-player"]';
  const sw = row + ' .page-row .og-switch';
  await page.waitForSelector(sw, { timeout: 5000 });
  await page.$eval(sw, (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  ok('switch: Show tab is on by default for the factory plugin', await page.$eval(sw + ' input', (i) => i.checked));
  await shot(page, 'plugins-pane-switch-1280x800.png');
  const before = [await box(page, '.topstrip'), await box(page, 'main.pane'), await box(page, sw)];
  await page.click(sw);
  await page.waitForTimeout(200);
  const off = [await box(page, '.topstrip'), await box(page, 'main.pane'), await box(page, sw)];
  ok('switch: off hides the tab live', (await page.$(TAB)) === null);
  ok('switch: off persists as "0"', await page.evaluate((k) => localStorage.getItem(k) === '0', KEY));
  ok('switch: the top strip, the page and the switch stay put', off.join('|') === before.join('|'), before.join('|') + ' -> ' + off.join('|'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tab-id="plugins"]', { timeout: 15000 });
  await page.waitForTimeout(300);
  ok('switch: off survives a launch', (await page.$(TAB)) === null);
  await page.click('[data-tab-id="plugins"]');
  await page.waitForSelector(sw, { timeout: 5000 });
  await page.$eval(sw, (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const b2 = [await box(page, '.topstrip'), await box(page, 'main.pane'), await box(page, sw)];
  await page.click(sw);
  await page.waitForTimeout(200);
  const on = [await box(page, '.topstrip'), await box(page, 'main.pane'), await box(page, sw)];
  ok('switch: on shows the tab again, under Plugins', (await page.$(TAB)) !== null
    && await page.evaluate((id) => document.querySelector('[data-tab-id="plugins"]').nextElementSibling?.dataset.tabId === id, ID));
  ok('switch: on moves nothing either', on.join('|') === b2.join('|'), b2.join('|') + ' -> ' + on.join('|'));
  ok('switch: on persists as "1"', await page.evaluate((k) => localStorage.getItem(k) === '1', KEY));

  // Collapsed rail: the glyph stays, the name goes.
  await page.click('.rail-collapse');
  await page.waitForTimeout(150);
  ok('sidebar: collapsed, the page keeps its glyph and drops its name',
    await page.$eval(TAB, (t) => !!t.querySelector('svg path') && !t.querySelector('.rail-name')));
  await shot(page, 'sidebar-collapsed-1280x800.png');
  await page.click('.rail-collapse');
  ok('no page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- phone -----------------------------------------------------------------
console.log('\n--- phone 390x844 ---');
{
  const { ctx, page, errors } = await boot({ width: 390, height: 844 });
  const ids = await page.$$eval('nav.tabs [role=tab]', (ts) => ts.map((t) => t.dataset.tabId));
  ok('phone: the strip carries the page right after Plugins', ids[ids.indexOf('plugins') + 1] === ID, ids.join(','));
  await page.$eval(TAB, (t) => t.scrollIntoView({ inline: 'center' }));
  await page.click(TAB);
  await page.waitForSelector('main.pane .fsp', { timeout: 5000 });
  ok('phone: the page mounts the card', await page.locator('main.pane .fsp').isVisible());
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, 'glance-menu-390x844.png');
  ok('phone: no horizontal page scroll', await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1));
  ok('no page errors (phone)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\nFAIL -- ' + fails + ' assertion(s)' : '\nPASS -- plugin pages');
process.exit(fails ? 1 : 0);
