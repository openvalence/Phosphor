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
 *   fill     the player page (registered `fill`) fills the content pane to
 *            its bottom with nothing scrolling; other pages keep their flow
 *   full     page fullscreen (ph-wb4j): the page takes the window below the
 *            top strip; the caret hides the bar and strip, leaving only the
 *            stop pair top right, uncovered, half opacity at rest and full on
 *            pointer movement (RENDERING §8.4 row 11); F11 enters, F1's Escape
 *            stays, Escape leaves; Borderless persists and sets the window's
 *            fullscreen on enter and clears it on leave (stub IPC only)
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
import { THEMES } from '../src/model/theme.js';

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

// A test page through the shell's plugins_list (an installed plugin): the
// seam's flags (status, compactHero), a tall body so the page scrolls, and
// the host's quick-rail glyph exposed for the assertions.
const PROBE = {
  dir: 'probe', path: 'test/probe',
  manifest: { name: 'probe', version: '0', api: 1, kind: 'widget', entry: 'index.js', permissions: [] },
  source: `export function activate(api) {
    window.__probeIcon = api.icons && api.icons.quickRail;
    api.registerPage({ id: 'probe', label: 'Probe', status: true, compactHero: true, mount(el) {
      const d = document.createElement('div'); d.className = 'probe'; d.style.height = '1400px'; d.textContent = 'probe';
      el.append(d);
      window.__probeEl = d;
      return { update() {}, unmount() {} };
    } });
  }`,
};
const PROBE_ID = 'plugin:probe:probe';

const browser = await chromium.launch();
async function boot(viewport, { probe = false, store = {}, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript((pr) => {
    const inner = window.__TAURI_INTERNALS__.invoke;
    window.__fs = [];
    window.__TAURI_INTERNALS__.invoke = (cmd, a) => (cmd === 'plugin:window|set_fullscreen'
      ? (window.__fs.push(a.value), Promise.resolve())
      : cmd === 'plugins_list' && pr ? Promise.resolve({ dir: 'test', plugins: [pr] }) : inner(cmd, a));
  }, probe ? PROBE : null);
  await ctx.addInitScript(([etag, bytes]) => {
    try {
      if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); localStorage.clear(); }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      if (!localStorage.getItem('phosphor.hubs')) {
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'pages fixture', nickname: '', lastSeen: Date.now() }]));
      }
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  // Once per context, after the first boot's clear: a reload keeps what the page changed.
  await ctx.addInitScript((kv) => { try { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } catch (e) { /* no storage */ } },
    probe ? { 'phosphor.plugins.pages.probe': '1', ...store } : store);
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
  // fill (ph-yuce): the page's column reaches the content pane's bottom and right, nothing scrolls.
  const fill = await page.evaluate(() => {
    const ct = document.querySelector('.content'), c = ct.getBoundingClientRect(), f = document.querySelector('main.pane .fsp').getBoundingClientRect();
    return [c.bottom - f.bottom, c.right - f.right, ct.scrollHeight - ct.clientHeight].map(Math.round);
  });
  ok('fill: the page fills the content pane, nothing scrolls', fill.every((v) => Math.abs(v) <= 1), fill.join(','));
  await shot(page, 'sidebar-page-1280x800.png');

  // F3 finds it by label and path.
  await page.click('[data-tab-id="machine"]');
  ok('fill: other pages keep their flow', await page.locator('main.pane.fill').count() === 0);
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

  // Page fullscreen.
  await page.click(TAB);
  await page.waitForSelector('main.pane .fsp', { timeout: 5000 });
  // The player owns its fullscreen (mediaFullscreen): no foot button; F11 enters.
  ok('full: a page owning its fullscreen has no foot button', await page.locator('main.pane .page-foot button').count() === 0);
  await page.keyboard.press('F11');
  await page.waitForTimeout(200);
  const geo = await page.evaluate(() => {
    const p = document.querySelector('main.pane').getBoundingClientRect();
    return [p.top, (document.querySelector('.hero-strip') || document.querySelector('.topstrip')).getBoundingClientRect().bottom, p.left, p.right, p.bottom, innerWidth, innerHeight].map(Math.round);
  });
  ok('full: in window the page takes the window below the hero bar', geo[0] === geo[1] && geo[2] === 0 && geo[3] === geo[5] && geo[4] === geo[6], geo.join(','));
  ok('full: in window by default, the window untouched', (await page.evaluate(() => window.__fs.length)) === 0);
  await shot(page, 'full-1280x800.png');
  await page.click('.full-caret');
  await page.waitForTimeout(300);
  const bareState = () => page.evaluate(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0);
    const pair = document.querySelector('.topstrip .pair');
    const r = pair.getBoundingClientRect();
    const ops = [...pair.querySelectorAll('.safety-op button')];
    const hit = ops.every((b) => { const q = b.getBoundingClientRect(); return pair.contains(document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)); });
    return { bar: shown('.linkbar'), rest: shown('.topstrip :is(.nums, .status, .ops, .home-menu, .ovr)'), foot: shown('main.pane .page-foot'),
      ops: ops.length, hit, tap: ops.every((b) => b.getBoundingClientRect().height >= 40), right: Math.round(innerWidth - r.right), top: Math.round(r.top),
      paneTop: Math.round(document.querySelector('main.pane').getBoundingClientRect().top), opacity: getComputedStyle(pair).opacity };
  });
  const b1 = await bareState();
  ok('full: the caret hides the bar, the strip and the footer', !b1.bar && !b1.rest && !b1.foot && b1.paneTop === 0, JSON.stringify(b1));
  ok('full: the stop pair alone stays, top right, uncovered, full size', b1.ops === 2 && b1.hit && b1.tap && b1.right < 16 && b1.top < 16, JSON.stringify(b1));
  ok('full: the pair rests at half opacity', b1.opacity === '0.5', b1.opacity);
  await shot(page, 'full-bare-1280x800.png');
  await page.mouse.move(300, 400);
  await page.mouse.move(320, 420);
  await page.waitForTimeout(300);
  ok('full: pointer movement brings it to full opacity', (await bareState()).opacity === '1');
  await page.waitForTimeout(1800);
  ok('full: and back to half at rest', (await bareState()).opacity === '0.5');
  await page.click('.full-caret');
  await page.waitForTimeout(200);
  ok('full: the caret brings the bar back', await page.locator('.linkbar').isVisible() && await page.locator('main.pane.full').count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('full: Escape leaves', await page.locator('main.pane.full').count() === 0 && await page.locator('nav.rail').isVisible());
  await page.keyboard.press('F11');
  await page.waitForTimeout(150);
  ok('full: F11 enters', await page.locator('main.pane.full').count() === 1);
  await page.keyboard.press('F1');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('full: Escape closing F1 help stays', await page.locator('main.pane.full').count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('full: Escape leaves after F1 closed', await page.locator('main.pane.full').count() === 0);
  await page.locator('main.pane .fsp-hb-mode').evaluate((e) => e.click());
  await page.waitForTimeout(150);
  await page.keyboard.press('F11');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('full: Borderless sets the window fullscreen and clears it on leave', (await page.evaluate(() => window.__fs.join(','))) === 'true,false',
    await page.evaluate(() => window.__fs.join(',')));
  ok('full: the mode persists', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.prefs')).fullscreen === 'borderless'));
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

// ---- the footer status slot (ph-5u0g.3) -------------------------------------
const PTAB = '[data-tab-id="' + PROBE_ID + '"]';
const send = (page, ev, detail) => page.evaluate(([ev, d]) => window.__probeEl.dispatchEvent(new CustomEvent(ev, { bubbles: true, cancelable: true, detail: d })), [ev, detail]);
async function openProbe(page) {
  await page.waitForSelector(PTAB, { timeout: 15000 });
  await page.$eval(PTAB, (t) => t.click());
  await page.waitForSelector('main.pane .probe', { timeout: 5000 });
  await page.waitForTimeout(150);
}
const PAPER = THEMES.find((t) => t.id === 'paper');
for (const [name, theme, vp] of [['420x860 dark', null, [420, 860]], ['420x860 paper', PAPER, [420, 860]], ['860x420 dark', null, [860, 420]]]) {
  console.log('\n--- status slot ' + name + ' ---');
  const { ctx, page, errors } = await boot({ width: vp[0], height: vp[1] }, { probe: true, store: theme ? { 'phosphor.theme': JSON.stringify(theme) } : {} });
  await openProbe(page);
  const SLOT = 'main.pane .page-foot .foot-status';
  ok(name + ': a page registered status has a footer with the slot', await page.locator(SLOT).isVisible());
  const rects = () => page.evaluate(() => ['main.pane .page-foot', 'main.pane .page-foot .foot-status', '.footstrip']
    .map((q) => { const b = document.querySelector(q).getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); }).join(' | '));
  const r0 = await rects();
  const moved = [], seen = [];
  for (const d of [{ text: 'Loaded scene.mp4', tone: 'ok' }, { text: 'A long status line '.repeat(8), tone: 'warn', title: 'the full text' },
    { text: 'refused', tone: 'bad' }, { text: '', tone: null }]) {
    await send(page, 'phosphor-page-status', d);
    await page.waitForTimeout(60);
    const r = await rects();
    if (r !== r0) moved.push(r);
    seen.push(await page.evaluate(() => {
      const e = document.querySelector('main.pane .page-foot .foot-status'), t = e.firstElementChild;
      const probe = document.createElement('i');
      probe.style.color = 'var(--tx)';
      document.body.append(probe);
      const tx = getComputedStyle(probe).color;
      probe.remove();
      return { text: e.textContent.trim().slice(0, 20), tone: e.dataset.tone || null, tx: getComputedStyle(e).color === tx, bar: getComputedStyle(e).borderLeftWidth,
        title: e.title, ellipsis: t.scrollWidth <= e.clientWidth || getComputedStyle(t).textOverflow === 'ellipsis' };
    }));
  }
  ok(name + ': the slot shows each status and tone', seen[0].text === 'Loaded scene.mp4' && seen[0].tone === 'ok' && seen[1].tone === 'warn'
    && seen[2].tone === 'bad' && seen[3].tone === null && seen[3].text === '', JSON.stringify(seen));
  ok(name + ': the text is --tx in every tone, with the 3 px tone bar', seen.every((x) => x.tx && x.bar === '3px'), JSON.stringify(seen));
  ok(name + ': a long text ellipsizes with its full form in title', seen[1].title === 'the full text' && seen[1].ellipsis, JSON.stringify(seen[1]));
  ok(name + ': a status or tone change moves no rect', moved.length === 0, r0 + ' -> ' + moved[0]);
  await send(page, 'phosphor-page-status', { text: 'Loaded scene.mp4', tone: 'ok' });
  await shot(page, 'status-slot-' + name.replace(' ', '-') + '.png');
  ok('no page errors (status ' + name + ')', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
for (const vp of [{ width: 1428, height: 900 }, { width: 1024, height: 768 }]) {
  const { ctx, page, errors } = await boot(vp, { probe: true });
  await openProbe(page);
  await send(page, 'phosphor-page-status', { text: 'Loaded', tone: 'ok' });
  await page.waitForTimeout(60);
  ok(vp.width + 'x' + vp.height + ': outside buckets 1 and 2 the shell draws no slot', await page.locator('main.pane .foot-status').count() === 0
    && await page.evaluate(() => +document.documentElement.dataset.bucket >= 3));
  await shot(page, 'status-page-' + vp.width + 'x' + vp.height + '.png');
  ok('no page errors (' + vp.width + ')', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\nFAIL -- ' + fails + ' assertion(s)' : '\nPASS -- plugin pages');
process.exit(fails ? 1 : 0);
