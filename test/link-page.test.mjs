/**
 * link-page.test.mjs -- the Link page (DESIGN.md "The Link page", ph-bszw) on the built app
 * against a fake hub on the recorded valencesim catalog. Asserts:
 *   refusals  grouped by code, newest first, with the registry's family and
 *             meaning (registry-tables.js), the count past the 60-deep ring,
 *             the last time, the causing channel or range, the hub's detail;
 *             safety refusals render distinctly (amber, never red); Log opens
 *             the Log page on that code's refusal rows (ph-s5mu.1); the Link
 *             health row counts them and jumps there. Channel 0's refusal is
 *             FRAME_TOO_LARGE: a SPEC 8.6 CHUNK_UNAVAILABLE is a restart in the
 *             Session feed, never a refusal (ph-2tjo)
 *   map       every registry range is a band in its own token color, every
 *             catalog channel a cell in its class color, the occupancy numbers
 *             are the fixture's, the device grid holds the device-range cells
 *   select    hovering a channel reads id, name, class, rate and subscribed;
 *             hovering a free id reads its range; a click selects the list row
 *             and scrolls it into view; arrows and Enter do the same
 *   fit       at 1428x900, 1024x768 and 420x860: no horizontal overflow, no
 *             scroller inside the page, nothing moves on hover or a view
 *             switch, every button 44 px under a coarse pointer
 * Screenshots: the three sizes, dark and Paper, top and map (test/evidence or --shots <dir>).
 *
 * Build first (`npm run build:only`). Run: node test/link-page.test.mjs [--shots <dir>]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbBool, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS, NACK, NACK_NAME } from '../../Valence/clients/js/frames.js';
import { CHANNEL_RANGES, NACK_FAMILY, NACK_MEANING, EXPERIMENTAL_RANGE } from '../src/model/registry-tables.js';
import { THEMES } from '../src/model/theme.js';
import { goTab } from './nav.mjs';
import { DIST_HTML, EVIDENCE } from './dist.mjs';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : EVIDENCE;
mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined && !c ? '  -- ' + JSON.stringify(extra) : '')); if (!c) fails++; };

const HTML = readFileSync(DIST_HTML);
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const PAPER = THEMES.find((t) => t.id === 'paper');
const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(4, '0');
const fmt = (n) => n.toLocaleString('en-US');

const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';

const wire = {};
function fakeHub(ws) {
  const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  wire.send = send;
  ws.onMessage((msg) => {
    if (typeof msg === 'string') return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)],
            [WELCOME_LIMITS_K.max_sessions, cbUint(4)], [WELCOME_LIMITS_K.sessions_in_use, cbUint(2)]])],
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('link fixture')], [IDENTITY_K.estop_cuts_power, cbBool(true)]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = [];
        for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)], [K.channel_id, cbUint(w.get(K.channel_id))]]));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}
const nack = (ch, code, detail) => wire.send(FRAME.NACK, ch, cbMap([[K.code, cbUint(code)], ...(detail ? [[K.detail, cbTstr(detail)]] : [])]));

const browser = await chromium.launch();
async function boot(viewport, { theme = null, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(([etag, h, th]) => {
    try {
      if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); localStorage.clear(); }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: h }));
      if (th) localStorage.setItem('phosphor.theme', th);
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme ? JSON.stringify(theme) : null]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tab-id="valence"], .menu-btn', { timeout: 15000 });
  await goTab(page, 'valence');
  await page.waitForSelector('.link-page .cmap rect.ch', { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const shot = async (page, name) => { await page.waitForTimeout(200); await page.screenshot({ path: join(SHOTS, 'link-page-' + name + '.png') }); };
// The cell center of a channel id in the current view, in client px.
const cellAt = (page, id) => page.$eval('.cmap', (el, id) => {
  const r = el.getBoundingClientRect(), rows = el.querySelector('svg').viewBox.baseVal.height;
  return { x: r.left + ((id & 255) + 0.5) * r.width / 256, y: r.top + ((id >> 8) + 0.5) * r.height / rows };
}, id);
const readout = (page) => page.$eval('.cmap-read', (el) => (el.children.length ? [...el.children].map((s) => s.textContent).join(' ') : el.textContent).replace(/\s+/g, ' ').trim());
const colorOf = (page, token) => page.evaluate((t) => {
  const d = document.createElement('div'); d.style.color = 'var(' + t + ')'; document.body.append(d);
  const c = getComputedStyle(d).color; d.remove(); return c;
}, token);
// Top in document space, whichever element scrolls.
const docTop = (page, sel) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().top + (el.closest('.content')?.scrollTop || 0) + scrollY));

// ---- refusals, the map, selection: 1428x900 dark -----------------------------------
{
  console.log('\n--- refusals, map, selection (1428x900) ---');
  const { ctx, page, errors } = await boot({ width: 1428, height: 900 });
  ok('refusals: empty state before any NACK', /None from this hub/.test(await page.textContent('section[aria-labelledby="vp-refusals"]')));
  const chTop0 = await docTop(page, '#vp-channels');
  const INTENT_CH = ENTRIES.find((e) => e.clsName === 'INTENT' && e.id >= 0x100).id;
  const HOME_CH = ENTRIES.filter((e) => e.clsName === 'INTENT' && e.id >= 0x100)[1].id;
  for (let i = 0; i < 70; i++) nack(0, NACK.FRAME_TOO_LARGE);
  await page.waitForTimeout(1100);
  nack(HOME_CH, NACK.NOT_HOMED);
  await page.waitForTimeout(1100);
  nack(INTENT_CH, NACK.INVALID_VALUE, 'key 3 out of range');
  nack(INTENT_CH, NACK.INVALID_VALUE);
  nack(HOME_CH, NACK.INVALID_VALUE);
  await page.waitForTimeout(300);
  const groups = await page.$$eval('.refusals > li', (ls) => ls.map((l) => ({
    code: Number(l.dataset.code), name: l.querySelector('.r-head b').textContent.trim(),
    n: l.querySelector('.r-n').textContent.trim(), at: l.querySelector('.r-at').textContent.trim(),
    fam: l.querySelector('.r-fam').textContent.trim(), mean: l.querySelector('.r-mean').textContent.replace(/\s+/g, ' ').trim(),
    cause: l.querySelector('.r-cause').textContent.replace(/\s+/g, ' ').trim(), distinct: l.classList.contains('distinct'),
    border: getComputedStyle(l).borderTopColor, ink: getComputedStyle(l.querySelector('.r-head b')).color })));
  ok('refusals: one row per code, newest first', groups.map((g) => g.code).join() === [NACK.INVALID_VALUE, NACK.NOT_HOMED, NACK.FRAME_TOO_LARGE].join(), groups.map((g) => g.name));
  ok('refusals: names are the registry\'s', groups.every((g) => g.name === NACK_NAME[g.code]), groups.map((g) => g.name));
  ok('refusals: each reads its family and the registry meaning',
    groups.every((g) => g.fam === NACK_FAMILY[g.code >> 8].name && g.mean === g.fam + ' ' + NACK_MEANING[g.code] && NACK_MEANING[g.code].length > 8), groups.map((g) => g.mean));
  ok('refusals: counts past the 60-deep ring', groups.map((g) => g.n).join() === '×3,×1,×70', groups.map((g) => g.n));
  ok('refusals: last time ages per code', /^[01]s ago$/.test(groups[0].at) && /^[23]s ago$/.test(groups[2].at), groups.map((g) => g.at));
  const nameOf = (id) => ENTRIES.find((e) => e.id === id).name;
  ok('refusals: causes by channel, most first, with the hub\'s detail',
    groups[0].cause === hex(INTENT_CH) + ' ' + nameOf(INTENT_CH) + ' ×2, ' + hex(HOME_CH) + ' ' + nameOf(HOME_CH) + ' ×1 · key 3 out of range', groups[0].cause);
  ok('refusals: channel 0 reads as its registry range', groups[2].cause === CHANNEL_RANGES.find((r) => r.lo === 0).name, groups[2].cause);
  ok('refusals: only the safety family is distinct, amber not red', groups.map((g) => g.distinct).join() === 'false,true,false'
    && groups[1].border === await colorOf(page, '--warn') && groups[1].ink === await colorOf(page, '--warn-ink') && groups[1].border !== await colorOf(page, '--bad'), groups[1]);
  const facts = await page.$$eval('.pane-facts dt', (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim().toLowerCase(), dt.nextElementSibling.textContent.trim()])));
  ok('link health: refusals counted', facts.refusals === '3 codes, 74 total', facts.refusals);
  ok('link health: the first refusal moves nothing below it', await docTop(page, '#vp-channels') === chTop0, [chTop0, await docTop(page, '#vp-channels')]);
  await page.click('.health .jump');
  await page.waitForTimeout(300);
  ok('link health: the count jumps to Refusals', await page.$eval('#vp-refusals', (h) => {
    const r = h.getBoundingClientRect(), c = h.closest('.content')?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
    return r.top >= c.top && r.bottom <= c.bottom;
  }));

  // ---- the map ----
  const bands = await page.$$eval('.cmap rect.band', (rs) => rs.map((r) => ({ name: r.dataset.range, fill: getComputedStyle(r).fill })));
  const fillOf = Object.fromEntries(bands.map((b) => [b.name, b.fill]));
  ok('map: every registry range is a band', CHANNEL_RANGES.every((r) => r.name in fillOf), Object.keys(fillOf));
  const WANT = { SESSION: '--tx-mut', 'spec-core': '--line-4', 'device-defined': '--line-2', user: '--line-3', reserved: '--line-0', experimental: '--line-1' };
  const tokenMiss = [];
  for (const [name, tok] of Object.entries(WANT)) if (fillOf[name] !== await colorOf(page, tok)) tokenMiss.push(name + ' ' + fillOf[name]);
  ok('map: range colors are their tokens', tokenMiss.length === 0, tokenMiss);
  ok('map: the five ranges read apart', new Set(CHANNEL_RANGES.map((r) => fillOf[r.name])).size === CHANNEL_RANGES.length, fillOf);
  const cells = await page.$$eval('.cmap rect.ch', (rs) => rs.map((r) => ({ id: Number(r.dataset.id), cls: r.dataset.cls, fill: getComputedStyle(r).fill })));
  ok('map: every catalog channel is a cell', cells.length === ENTRIES.length && ENTRIES.every((e) => cells.some((c) => c.id === e.id && c.cls === e.clsName)), cells.length);
  const byCls = Object.fromEntries(cells.map((c) => [c.cls, c.fill]));
  ok('map: STATE reads --reality, INTENT --intent', byCls.STATE === await colorOf(page, '--reality') && byCls.INTENT === await colorOf(page, '--intent'), byCls);
  ok('map: EVENT, STREAM and STORE are each their own color', new Set(Object.values(byCls)).size === Object.keys(byCls).length, byCls);
  const hazard = [await colorOf(page, '--warn'), await colorOf(page, '--bad')];
  ok('map: no channel in a hazard color', cells.every((c) => !hazard.includes(c.fill)));
  const occ = await page.$$eval('.occ tbody tr', (trs) => trs.map((t) => [t.dataset.row || 'all', t.lastElementChild.textContent.trim()]));
  const wantOcc = CHANNEL_RANGES.map((r) => [r.name, fmt(ENTRIES.filter((e) => e.id >= r.lo && e.id <= r.hi).length) + ' / ' + fmt(r.hi - r.lo + 1)])
    .concat([['all', fmt(ENTRIES.length) + ' / ' + fmt(65536)]]);
  ok('map: occupancy is allocated over range size, per range and whole', JSON.stringify(occ) === JSON.stringify(wantOcc), occ);
  console.log('    occupancy: ' + occ.map(([n, v]) => n + ' ' + v).join(', '));

  // ---- hover, click, keys ----
  await page.$eval('.cmap', (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const target = ENTRIES.find((e) => e.id === INTENT_CH);
  const c0 = await cellAt(page, target.id);
  await page.mouse.move(c0.x, c0.y);
  await page.waitForTimeout(100);
  const r0 = await readout(page);
  ok('select: hover reads id, name, class, rate and subscribed',
    r0 === [hex(target.id), target.name, target.clsName, target.maxRateHz ? target.maxRateHz + ' Hz' : 'on-change', 'not subscribed'].join(' '), r0);
  const sub = ENTRIES.find((e) => e.clsName === 'STATE' && e.maxRateHz > 1 && e.id >= 0x100);
  const cs = await cellAt(page, sub.id);
  await page.mouse.move(cs.x, cs.y);
  await page.waitForTimeout(100);
  ok('select: a subscribed channel says so with its granted rate', /subscribed, \d+ Hz$/.test(await readout(page)) && !/not subscribed/.test(await readout(page)), await readout(page));
  const user = CHANNEL_RANGES.find((r) => r.name === 'user');
  const freeId = user.lo + 0x1234;
  const cf = await cellAt(page, freeId);
  await page.mouse.move(cf.x, cf.y);
  await page.waitForTimeout(100);
  ok('select: a free id reads its range', await readout(page) === hex(freeId) + ' user free', await readout(page));
  const pageH = () => page.$eval('.link-page', (el) => el.getBoundingClientRect().height);
  const h0 = await pageH();
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.click(c0.x + 2, c0.y + 1);
  await page.waitForTimeout(300);
  const row = await page.$eval('tr[data-chan="' + target.id + '"]', (tr) => {
    const r = tr.getBoundingClientRect(), c = tr.closest('.content')?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
    return { sel: tr.classList.contains('sel'), seen: r.top >= c.top && r.bottom <= c.bottom, n: document.querySelectorAll('tr.sel').length };
  });
  ok('select: a click selects the list row and brings it into view', row.sel && row.seen && row.n === 1, row);
  ok('select: the map rings the selection', await page.$$eval('.cmap rect.ring.sel', (r) => r.length) === 1);
  ok('select: hovering never changes the page height', Math.abs(await pageH() - h0) < 0.5);
  await page.$eval('.cmap', (el) => el.scrollIntoView({ block: 'center' }));
  await page.focus('.cmap');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const second = [...ENTRIES].sort((a, b) => a.id - b.id)[1];
  ok('keys: arrows move the active channel', await page.$eval('.cmap', (el) => el.getAttribute('aria-activedescendant')) === 'cm-' + second.id
    && (await readout(page)).startsWith(hex(second.id)));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  ok('keys: Enter selects its row', await page.$eval('tr[data-chan="' + second.id + '"]', (tr) => tr.classList.contains('sel')));

  // ---- the device grid ----
  const mapBox = () => page.$eval('.cmap', (el) => { const r = el.getBoundingClientRect(); return [r.width, r.height].map(Math.round).join('x'); });
  const listTop = () => page.$eval('.chan-list', (el) => Math.round(el.getBoundingClientRect().top + (el.closest('.content')?.scrollTop || scrollY)));
  const [b0, t0] = [await mapBox(), await listTop()];
  await page.click('.cmap-views button:has-text("Device grid")');
  await page.waitForTimeout(150);
  const gridCells = await page.$$eval('.cmap rect.ch', (rs) => rs.map((r) => Number(r.dataset.id)));
  const devHi = CHANNEL_RANGES.find((r) => r.name === 'device-defined').hi;
  ok('grid: holds every channel up to the device range\'s top', gridCells.length === ENTRIES.filter((e) => e.id <= devHi).length && gridCells.every((id) => id <= devHi));
  ok('grid: rows are the class and domain nibbles', await page.$eval('.cmap svg', (s) => s.viewBox.baseVal.height) === (devHi + 1) / 256
    && /1 STATE/.test(await page.textContent('.cmap-side')));
  ok('grid: the experimental span is drawn', await page.$$eval('.cmap rect.band[data-range="experimental"]', (r) => r.length) > 0 && EXPERIMENTAL_RANGE.hi === devHi);
  const cg = await cellAt(page, target.id);
  await page.mouse.move(cg.x, cg.y);
  await page.waitForTimeout(100);
  ok('grid: hover finds the same channel', (await readout(page)).startsWith(hex(target.id) + ' ' + target.name), await readout(page));
  ok('grid: the view switch moves nothing', await mapBox() === b0 && await listTop() === t0, [b0, await mapBox(), t0, await listTop()]);

  await page.click('.refusals > li >> nth=0 >> button:has-text("Log")');
  await page.waitForTimeout(300);
  ok('refusals: Log opens the Log page', await page.$('.logpane') !== null && await page.$('.link-page') === null);
  // ph-s5mu.1: on the Log feed, searched for the code's name, its refusal rows and nothing else.
  const found = await page.$$eval('#lp-feed-log > .line', (ls) => ls.map((l) => [l.querySelector('.chip.tag')?.textContent, l.querySelector('.text').textContent,
    l.querySelector('.kv')?.textContent || '']));
  ok('refusals: Log lands on the rows of that code in the Log feed', await page.inputValue('.logpane .q') === 'INVALID_VALUE'
    && await page.getAttribute('[data-feed="log"]', 'aria-selected') === 'true'
    && found.length === 3 && found.every(([tag, text, kv]) => tag === 'refusal' && text === 'INVALID_VALUE' && kv.includes('code=' + hex(NACK.INVALID_VALUE))),
    JSON.stringify(found));
  ok('refusals: a row names the channel and the detail the hub sent', found.some(([, , kv]) => kv.includes('channel=' + hex(INTENT_CH) + ' ' + nameOf(INTENT_CH)) && kv.includes('detail=key 3 out of range')),
    JSON.stringify(found));
  await goTab(page, 'valence');
  await goTab(page, 'log');
  await page.waitForSelector('.logpane');
  ok('refusals: the next visit to the Log starts with no search', await page.inputValue('.logpane .q') === '');
  ok('no page errors', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

// ---- fit, coarse targets, screenshots --------------------------------------------------
// The three named sizes, dark and Paper, plus two just past the map-beside-list breakpoint.
for (const [w, h] of [[1428, 900], [1024, 768], [420, 860], [1300, 900], [1360, 900]]) {
  for (const theme of (w === 1300 || w === 1360 ? [null] : [null, PAPER])) {
    const label = w + 'x' + h + '-' + (theme ? 'paper' : 'dark');
    console.log('\n--- fit ' + label + ' ---');
    const { ctx, page, errors } = await boot({ width: w, height: h }, { theme });
    nack(ENTRIES.find((e) => e.clsName === 'INTENT' && e.id >= 0x100).id, NACK.INVALID_VALUE, 'key 3 out of range');
    nack(ENTRIES.find((e) => e.clsName === 'INTENT' && e.id >= 0x100).id, NACK.NOT_HOMED);
    nack(0, NACK.FRAME_TOO_LARGE);
    await page.waitForTimeout(300);
    const fit = await page.evaluate(() => {
      const lp = document.querySelector('.link-page'), pr = lp.getBoundingClientRect();
      const inner = [...lp.querySelectorAll('*')].filter((el) => {
        const cs = getComputedStyle(el);
        return (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1);
      }).map((el) => el.className);
      const wide = [...lp.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > pr.right + 1.5; })
        .map((el) => el.tagName + '.' + el.className);
      return { page: document.scrollingElement.scrollWidth <= innerWidth + 1, inner, wide: wide.slice(0, 4) };
    });
    ok(label + ': no horizontal overflow', fit.page && fit.wide.length === 0, fit.wide);
    ok(label + ': one scroll area, nothing scrolls inside it', fit.inner.length === 0, fit.inner);
    await shot(page, label);
    await page.$eval('#vp-channels', (el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, label + '-map');
    ok(label + ': no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
}
{
  console.log('\n--- coarse pointer 420x860 ---');
  const { ctx, page } = await boot({ width: 420, height: 860 }, { touch: true });
  const top0 = await docTop(page, '#vp-channels');
  nack(0, NACK.FRAME_TOO_LARGE);
  await page.waitForTimeout(300);
  ok('coarse: the first refusal moves nothing below it', await docTop(page, '#vp-channels') === top0, [top0, await docTop(page, '#vp-channels')]);
  const small = await page.$$eval('.link-page button', (bs) => bs.filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 44)
    .map((b) => b.textContent.trim() + ' ' + b.getBoundingClientRect().height));
  ok('coarse: every button is at least 44 px', small.length === 0, small);
  const t = ENTRIES.find((e) => e.clsName === 'STORE' && e.id >= 0x100);
  await page.$eval('.cmap', (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const c = await cellAt(page, t.id);
  await page.touchscreen.tap(c.x + 10, c.y + 8);
  await page.waitForTimeout(300);
  ok('coarse: a tap within a fingertip selects the channel', await page.$eval('tr[data-chan="' + t.id + '"]', (tr) => tr.classList.contains('sel')));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
