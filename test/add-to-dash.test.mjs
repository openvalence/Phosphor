/**
 * add-to-dash.test.mjs -- Add to Dash in the shell context menu (ph-hi4i.1,
 * DESIGN §10.1 and §10.13): a submenu over the named layouts (the Dashes),
 * on the built app (dist/index.html) against a fake hub on the recorded
 * valencesim catalog. Asserts:
 *   seed       an add to the unbuilt Default keeps every seed card where it was
 *              drawn and appends the field at the first free rect; the page stays
 *   check      a Dash that holds the item is checked (a mark: every row stays a
 *              menuitem); choosing it opens the Dash, taller than the window, on
 *              that layout scrolled to the card with its first control focused
 *   new        New Dash... asks for a name in place (a taken one is marked), makes
 *              the layout holding only the item, and leaves the active one alone
 *   module     a Dash card's own menu adds it to another Dash
 *   keys       ArrowRight or Enter opens the submenu on its first item, ArrowLeft
 *              or Escape closes it back to the opener; Enter picks
 *   focus      a pointer wandering off keeps a flyout holding focus (the typed
 *              New Dash name stays); a flyout closed with focus inside hands it
 *              to the opener; Escape walks out to the control, never to body
 *   rename     the submenu follows a rename and a delete in the sidebar
 *   persist    every add survives a reload; adds to a Dash never drawn, renamed
 *              after a reload, are still written once that Dash measures them
 *   touch      1024x768 with touch: a tap opens the submenu inline, a second closes
 *              it; opened low, the menu stays inside the window; a height-only
 *              resize (the touch keyboard) keeps the New Dash field open
 *   classes    420x860 (not the full class): no Add to Dash
 * Screenshots: 1428x900, 1024x768 and 420x860, dark and Paper (test/evidence or --shots <dir>).
 *
 * Build first (`npm run build:only`). Run: node test/add-to-dash.test.mjs [--shots <dir>]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS } from '../../Valence/clients/js/frames.js';
import { catalogEtag, toHex } from '../../Valence/clients/js/sha256.js';
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
const ETAG = toHex(catalogEtag(CAT, LIMITS.etag_bytes));
const ENTRIES = decodeCatalog(CAT);
const PAPER = THEMES.find((t) => t.id === 'paper');
const STORE = 'phosphor.layouts';
// The Motion page's Oscillator card: two role-less settings, placed by uid.
const FREQ = '4416:frequency', DWELL = '4416:dwell_crest';
const FREQ_KEY = 'uid:' + FREQ, DWELL_KEY = 'uid:' + DWELL;
const F = (uid) => '.field[data-uid="' + uid + '"] .field-label';

// ---- HTTP and the fake hub: STATE from catalog defaults; nothing here writes ----
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4, [PACKED.i32]: 4, [PACKED.f32]: 4,
  [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
function packed(e) {
  const out = new Uint8Array(e.layout.reduce((a, f) => a + (SIZE[f.type] ?? 0), 0));
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of e.layout) {
    const v = f.role === 'meta.enabled_mask' ? 0xff : f.default != null ? Number(f.default) : 0;
    const raw = f.type === PACKED.f32 ? v : Math.round(v * (f.scale || 1));
    if (f.type === PACKED.u8 || f.type === PACKED.bitfield8) dv.setUint8(off, raw);
    else if (f.type === PACKED.i8) dv.setInt8(off, raw);
    else if (f.type === PACKED.u16) dv.setUint16(off, raw, true);
    else if (f.type === PACKED.i16) dv.setInt16(off, raw, true);
    else if (f.type === PACKED.u32) dv.setUint32(off, raw >>> 0, true);
    else if (f.type === PACKED.i32) dv.setInt32(off, raw, true);
    else if (f.type === PACKED.f32) dv.setFloat32(off, v, true);
    off += SIZE[f.type] ?? 0;
  }
  return out;
}
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
            [IDENTITY_K.hub_name, cbTstr('dash fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = [];
        for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
          const ch = w.get(K.channel_id), e = ENTRIES.find((x) => x.id === ch);
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)], [K.channel_id, cbUint(ch)]]));
          if (e && e.layout) send(FRAME.STATE, ch, packed(e));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

const browser = await chromium.launch();
async function boot(viewport, { touch = false, theme = null } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 960 });
  await ctx.addInitScript(([etag, hex, th]) => {
    try {
      if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); localStorage.clear(); }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: hex }));
      if (th) localStorage.setItem('phosphor.theme', th);
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme ? JSON.stringify(theme) : null]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.hero-strip') && (document.querySelector('nav.rail [data-tab-id="cat2"]') || document.querySelector('.menu-btn')), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

/** Right-click `sel` by a dispatched contextmenu, as the webview sends it (a long press on touch). */
const rclick = async (page, sel) => {
  await page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + Math.min(20, r.width / 2), clientY: r.top + Math.min(10, r.height / 2) }));
  });
  await page.waitForTimeout(100);
};
const MENU = 'body > .ui-menu:popover-open', OPENER = MENU + ' > .ui-menu-i[aria-haspopup]', FLY = '.ui-menu-sub:popover-open';
const subState = (page) => page.evaluate(([MENU, FLY]) => {
  const m = document.querySelector(MENU), f = document.querySelector(FLY), inl = m && m.querySelector('.ui-menu-in');
  const box = f || inl;
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
  return { menu: !!m, fly: !!f, inline: !!inl, rect: f ? r(f) : null, menuRect: m ? r(m) : null,
    opener: m?.querySelector(':scope > .ui-menu-i[aria-haspopup]')?.getAttribute('aria-expanded') ?? null,
    items: box ? [...box.querySelectorAll('.ui-menu-i')].map((b) => (b.hasAttribute('data-checked') ? '+' : '') + b.textContent) : [],
    roles: box ? [...new Set([...box.querySelectorAll('.ui-menu-i')].map((b) => b.getAttribute('role')))] : [],
    focus: document.activeElement?.textContent || document.activeElement?.tagName || '' };
}, [MENU, FLY]);
const subItem = (page, label) => page.locator(FLY + ' .ui-menu-i, ' + MENU + ' .ui-menu-in .ui-menu-i').filter({ hasText: new RegExp('^' + label + '$') }).first();
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORE);
const homeCells = (page) => page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell', (els) => Object.fromEntries(els.map((e) => {
  const r = e.getBoundingClientRect();
  return [e.dataset.id, [r.left, r.top, r.width].map(Math.round).join(',')];
})));
const status = (page) => page.locator('.topstrip').innerText();
const tabOn = (page, id) => page.locator('[data-tab-id="' + id + '"][aria-selected="true"]').count().then((n) => n === 1);
const rows = (page) => page.$$eval('nav.rail .rail-sub [data-layout]', (e) => e.map((b) => b.dataset.layout + (b.hasAttribute('aria-current') ? '*' : '')));
const inView = (page, sel) => page.locator(sel).first().evaluate((e) => {
  const r = e.getBoundingClientRect(), c = e.closest('.content')?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
  return r.top >= c.top - 1 && r.top < c.bottom - 20;
});
const shot = async (page, name) => { await page.waitForTimeout(250); return page.screenshot({ path: join(SHOTS, 'add-to-dash-' + name + '.png') }); };

// ---- desktop 1428x900 ---------------------------------------------------------------------
for (const theme of [null, PAPER]) {
  const t = '1428x900 ' + (theme ? 'Paper' : 'dark');
  console.log('\n--- ' + t + ' ---');
  const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, { theme });
  await goTab(page, 'machine');
  await page.waitForSelector('.home .dash-cell');
  await page.waitForTimeout(500);
  const seed = await homeCells(page);
  ok(t + ': a fresh client shows the unbuilt Default (its seed), nothing stored for it', Object.keys(seed).length >= 2
    && !Object.keys((await store(page))?.layouts?.Default?.['full.machine'] || {}).length, seed);

  // seed: an add to the unbuilt Default from a category page
  await goTab(page, 'cat2');
  await page.waitForSelector(F(FREQ));
  await rclick(page, F(FREQ));
  ok(t + ': the field menu offers Add to Dash as a submenu opener', await page.locator(OPENER).count() === 1
    && (await page.locator(OPENER).textContent()) === 'Add to Dash' && await page.locator(OPENER).getAttribute('aria-expanded') === 'false');
  await page.hover(OPENER);
  await page.waitForTimeout(100);
  const s1 = await subState(page);
  const strip = await page.locator('.topstrip').boundingBox();
  ok(t + ': hover opens the flyout beside the menu, below the strip, inside the window: every Dash, then New Dash…',
    s1.fly && s1.opener === 'true' && JSON.stringify(s1.items) === JSON.stringify(['Default', 'New Dash…'])
    && (s1.rect[0] >= s1.menuRect[2] - 1 || s1.rect[2] <= s1.menuRect[0] + 1) && s1.rect[1] >= strip.y + strip.height && s1.rect[2] <= 1428 && s1.rect[3] <= 900, s1);
  if (!theme) await shot(page, '1428x900-dark-flyout');
  await subItem(page, 'Default').click();
  await page.waitForTimeout(200);
  ok(t + ': choosing a Dash closes the menu, says so in the status slot, and the page stays', !(await subState(page)).menu
    && /Added to Default/.test(await status(page)) && await tabOn(page, 'cat2'));
  const m1 = (await store(page)).layouts.Default['full.machine'];
  ok(t + ': the unbuilt Default took its seed first, then the field', !!m1['home:built'] && Object.keys(seed).every((id) => id in m1) && FREQ_KEY in m1
    && Object.keys(m1).indexOf(FREQ_KEY) === Object.keys(m1).length - 1, Object.keys(m1));
  await goTab(page, 'machine');
  await page.waitForSelector('.home .dash-cell[data-id="' + FREQ_KEY + '"]');
  await page.waitForTimeout(600);
  const after = await homeCells(page);
  ok(t + ': on the Dash every seed card is still where it was drawn and the field is appended', Object.keys(seed).every((id) => after[id] === seed[id])
    && Object.keys(after).length === Object.keys(seed).length + 1 && FREQ_KEY in after, { seed, after });
  const placed = (await store(page)).layouts.Default['full.machine'][FREQ_KEY];
  ok(t + ': once measured the add is written at the rect it was drawn at', placed && placed.y != null && placed.w > 0, placed);

  // A Dash taller than the window: the card moved far below the fold, so opening it there must scroll.
  await page.evaluate(([k, id]) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.layouts.Default['full.machine'][id] = { ...s.layouts.Default['full.machine'][id], x: 0, y: 60 };
    localStorage.setItem(k, JSON.stringify(s));
  }, [STORE, FREQ_KEY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav.rail [data-tab-id="cat2"]', { timeout: 15000 });
  await goTab(page, 'machine');
  await page.waitForSelector('.home .dash-cell[data-id="' + FREQ_KEY + '"]');
  await page.waitForTimeout(400);
  const below = await page.locator('.home .dash-cell[data-id="' + FREQ_KEY + '"]').evaluate((e) => e.getBoundingClientRect().top - innerHeight);
  ok(t + ': setup: the card sits below the fold of a Dash taller than the window', below > 0, below);

  // check: the Dash that holds it is checked and opens on it
  await goTab(page, 'cat2');
  await page.waitForSelector(F(FREQ));
  await rclick(page, F(FREQ));
  await page.hover(OPENER);
  await page.waitForTimeout(100);
  const c1 = await subState(page);
  ok(t + ': a Dash that holds the item is checked, a mark on a menuitem (it runs)', JSON.stringify(c1.items) === JSON.stringify(['+Default', 'New Dash…'])
    && JSON.stringify(c1.roles) === JSON.stringify(['menuitem']), c1);
  await subItem(page, 'Default').click();
  await page.waitForTimeout(500);
  const scrolled = await page.evaluate(() => document.querySelector('.content')?.scrollTop || 0);
  const focusIn = await page.locator('.home .dash-cell[data-id="' + FREQ_KEY + '"]').evaluate((e) => e.contains(document.activeElement)
    || [document.activeElement?.tagName, document.activeElement?.className].join(' '));
  ok(t + ': choosing it opens the Dash on that layout, scrolled to the card, its first control focused', await tabOn(page, 'machine')
    && (await rows(page)).includes('Default*') && scrolled > 0 && focusIn === true && await inView(page, '.home .dash-cell[data-id="' + FREQ_KEY + '"]'),
    { rows: await rows(page), scrolled, focusIn });

  // new: New Dash… asks for a name in place; a taken one is marked
  await goTab(page, 'cat2');
  await page.waitForSelector(F(DWELL));
  await rclick(page, F(DWELL));
  await page.hover(OPENER);
  await subItem(page, 'New Dash…').click();
  const ask = page.locator(FLY + ' input.ui-menu-ask');
  ok(t + ': New Dash… turns into a focused name field in place', await ask.count() === 1 && await ask.evaluate((e) => e === document.activeElement)
    && await ask.getAttribute('placeholder') === 'Dash name');
  await page.keyboard.type('Default');
  await page.keyboard.press('Enter');
  ok(t + ': a taken name is marked and the menu stays', await ask.getAttribute('aria-invalid') === 'true'
    && (await page.locator(FLY + ' .ui-menu-hint').textContent()) === 'Name taken' && (await subState(page)).menu);
  if (!theme) await shot(page, '1428x900-dark-taken');
  await ask.fill('Workout');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const st = await store(page);
  ok(t + ': Enter makes the Dash holding only the item, the page and the active layout stay', !(await subState(page)).menu
    && /Added to Workout/.test(await status(page)) && await tabOn(page, 'cat2') && st.active === 'Default'
    && JSON.stringify(Object.keys(st.layouts.Workout['full.machine'])) === JSON.stringify(['home:built', DWELL_KEY]), st.layouts.Workout);
  ok(t + ': the sidebar lists it under Dash', JSON.stringify((await rows(page)).map((r) => r.replace('*', ''))) === JSON.stringify(['Default', 'Workout']), await rows(page));

  // keys: focus a control, Shift+F10, walk to the opener
  await page.locator('.field[data-uid="' + FREQ + '"] input[type=range]').focus();
  await page.keyboard.press('Shift+F10');
  for (let i = 0; i < 12 && (await subState(page)).focus !== 'Add to Dash'; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const k1 = await subState(page);
  await page.keyboard.press('ArrowLeft');
  const k2 = await subState(page);
  await page.keyboard.press('Enter');
  const k3 = await subState(page);
  await page.keyboard.press('Escape');
  const k4 = await subState(page);
  ok(t + ': keys: ArrowRight opens on the first item, ArrowLeft closes to the opener, Enter opens, Escape closes the submenu only',
    k1.fly && k1.focus === 'Default' && !k2.fly && k2.menu && k2.focus === 'Add to Dash' && k3.fly && k3.focus === 'Default'
    && !k4.fly && k4.menu && k4.focus === 'Add to Dash', { k1, k2, k3, k4 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  const k5 = await subState(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ok(t + ': keys: ArrowDown moves in the submenu and Enter adds', k5.focus === 'Workout' && !(await subState(page)).menu
    && FREQ_KEY in (await store(page)).layouts.Workout['full.machine'], k5);

  // focus: a flyout holding focus outlives the pointer; Escape walks out to the control
  const range = '.field[data-uid="' + DWELL + '"] input[type=range]';
  await page.locator(range).focus();
  await page.keyboard.press('Shift+F10');
  for (let i = 0; i < 12 && (await subState(page)).focus !== 'Add to Dash'; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Half');
  await page.hover(MENU + ' > .ui-menu-i >> nth=0');
  await page.waitForTimeout(450);
  const f1 = await page.evaluate(() => ({ value: document.activeElement?.value, fly: !!document.querySelector('.ui-menu-sub:popover-open') }));
  ok(t + ': focus: a pointer wandering off keeps the flyout and the typed name while focus is inside', f1.fly && f1.value === 'Half', f1);
  await page.keyboard.press('Escape');
  const f2 = await subState(page);
  await page.keyboard.press('Escape');
  const f3 = await subState(page);
  await page.keyboard.press('Escape');
  const f4 = await page.evaluate((sel) => ({ menu: !!document.querySelector('body > .ui-menu:popover-open'), back: document.activeElement === document.querySelector(sel) }), range);
  ok(t + ': focus: Escape puts New Dash… back, then closes the flyout to its opener, then the menu to the control', f2.fly && f2.focus === 'New Dash…'
    && !f3.fly && f3.menu && f3.focus === 'Add to Dash' && !f4.menu && f4.back, { f2, f3, f4 });
  await page.locator(range).focus();
  await page.keyboard.press('Shift+F10');
  for (let i = 0; i < 12 && (await subState(page)).focus !== 'Add to Dash'; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.locator(MENU).evaluate((m) => m.dispatchEvent(new Event('scroll')));
  const f5 = await subState(page);
  ok(t + ': focus: a flyout closed with focus inside (a menu scroll) hands focus to its opener', !f5.fly && f5.menu && f5.focus === 'Add to Dash', f5);
  await page.keyboard.press('Escape');

  // module: a Dash card's own menu
  await goTab(page, 'machine');
  await page.waitForSelector('.home .dash-cell[data-id="widget:telemetry"]');
  await rclick(page, '.home .dash-cell[data-id="widget:telemetry"] .dash-title');
  await page.hover(OPENER);
  await page.waitForTimeout(100);
  ok(t + ': a Dash card offers Add to Dash, checked where it is', JSON.stringify((await subState(page)).items) === JSON.stringify(['+Default', 'Workout', 'New Dash…']), await subState(page));
  await subItem(page, 'Workout').click();
  await page.waitForTimeout(200);
  ok(t + ': the card joins the other Dash; this one stays on screen', 'widget:telemetry' in (await store(page)).layouts.Workout['full.machine']
    && (await rows(page)).includes('Default*'));

  // persist; Workout was never drawn: renamed after a reload, its adds are still written once measured
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav.rail [data-tab-id="cat2"]', { timeout: 15000 });
  await goTab(page, 'machine');
  await page.waitForSelector('.home .dash-cell');
  await page.waitForTimeout(400);
  const d1 = Object.keys(await homeCells(page));
  // F2, and Tab to keep it: Enter's keypress lands on the row it refocuses and opens that layout.
  await page.locator('nav.rail [data-layout="Workout"]').focus();
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Gym');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  const WANT = [DWELL_KEY, FREQ_KEY, 'widget:telemetry'];
  const pend = (await store(page)).layouts.Gym?.['full.machine'] || {};
  await page.click('nav.rail [data-layout="Gym"]');
  await page.waitForTimeout(600);
  const d2 = Object.keys(await homeCells(page));
  const gym = (await store(page)).layouts.Gym['full.machine'];
  ok(t + ': persist: both Dashes hold their adds across a reload', d1.includes(FREQ_KEY) && Object.keys(seed).every((id) => d1.includes(id))
    && JSON.stringify(d2.sort()) === JSON.stringify([...WANT].sort()), { d1, d2 });
  ok(t + ': adds to a Dash never drawn, renamed after a reload, are written once it measures them', WANT.every((k) => pend[k] && pend[k].y == null && gym[k] && gym[k].y != null),
    { pend, gym });
  await goTab(page, 'cat2');
  await page.waitForSelector(F(DWELL));
  await rclick(page, F(DWELL));
  await page.hover(OPENER);
  await page.waitForTimeout(100);
  ok(t + ': rename: the submenu lists the new name, still checked', JSON.stringify((await subState(page)).items) === JSON.stringify(['Default', '+Gym', 'New Dash…']), await subState(page));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const row = 'nav.rail .sub-row:has([data-layout="Gym"])';
  await page.hover(row);
  const x = await page.locator(row + ' .sub-x').boundingBox();
  await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1250); await page.mouse.up();
  await page.waitForTimeout(200);
  await rclick(page, F(DWELL));
  await page.hover(OPENER);
  await page.waitForTimeout(100);
  ok(t + ': delete: the submenu drops it', JSON.stringify((await subState(page)).items) === JSON.stringify(['Default', 'New Dash…']), await subState(page));
  await shot(page, '1428x900-' + (theme ? 'paper' : 'dark'));
  await page.keyboard.press('Escape');
  ok(t + ': no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---- 1024x768 with touch: the inline submenu ----------------------------------------------
for (const theme of [null, PAPER]) {
  const t = '1024x768 ' + (theme ? 'Paper' : 'dark');
  console.log('\n--- ' + t + ' ---');
  const { ctx, page, errors } = await boot({ width: 1024, height: 768 }, { touch: true, theme });
  await goTab(page, 'cat2');
  await page.waitForSelector(F(FREQ));
  await rclick(page, F(FREQ));
  await page.locator(OPENER).tap();
  await page.waitForTimeout(150);
  const s = await subState(page);
  ok(t + ': a tap opens the submenu inline under its opener, no flyout', s.inline && !s.fly && s.opener === 'true'
    && JSON.stringify(s.items) === JSON.stringify(['Default', 'New Dash…'])
    && await page.locator(OPENER).evaluate((o) => o.nextElementSibling?.classList.contains('ui-menu-in')), s);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(t + ': the menu stays inside the window, nothing overflows', s.menuRect[2] <= 1024 && s.menuRect[3] <= 768 && over <= 0, { s, over });
  await shot(page, '1024x768-' + (theme ? 'paper' : 'dark') + '-inline');
  await page.locator(OPENER).tap();
  await page.waitForTimeout(100);
  ok(t + ': a second tap closes it', !(await subState(page)).inline && (await subState(page)).opener === 'false');
  await page.locator(OPENER).tap();
  await subItem(page, 'Default').tap();
  await page.waitForTimeout(200);
  ok(t + ': a tap on a Dash adds the item', !(await subState(page)).menu && FREQ_KEY in ((await store(page))?.layouts?.Default?.['full.machine'] || {}));

  // A long press low in the window: the menu opens above the finger, and the inline submenu never pushes it past the bottom.
  await page.locator(F(FREQ)).first().evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 700 })));
  await page.waitForTimeout(100);
  const low0 = await subState(page);
  await page.locator(OPENER).tap();
  await page.waitForTimeout(150);
  const low1 = await subState(page);
  await page.locator(OPENER).tap();
  await page.waitForTimeout(100);
  const low2 = await subState(page);
  ok(t + ': opened low, the menu stays inside the window with the submenu open and goes back where it was when it closes', low1.inline
    && low0.menuRect[3] <= 768 && low1.menuRect[3] <= 768 && low1.menuRect[1] >= 0 && !low2.inline && low2.menuRect[1] === low0.menuRect[1], { low0, low1, low2 });

  // The touch keyboard resizes the window's height: the New Dash field stays open; a width change still closes the menu.
  await page.locator(OPENER).tap();
  await subItem(page, 'New Dash…').tap();
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 1024, height: 480 });
  await page.waitForTimeout(150);
  const kb = await page.evaluate(() => ({ field: document.activeElement?.classList.contains('ui-menu-ask'), bottom: document.querySelector('body > .ui-menu:popover-open')?.getBoundingClientRect().bottom }));
  ok(t + ': a height-only resize while naming keeps the field focused, the menu inside the shorter window', kb.field && kb.bottom <= 480, kb);
  await page.setViewportSize({ width: 1000, height: 480 });
  await page.waitForTimeout(150);
  ok(t + ': a width change closes the menu', !(await subState(page)).menu);
  await page.setViewportSize({ width: 1024, height: 768 });
  ok(t + ': no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---- 420x860: no full class, no Add to Dash -------------------------------------------------
for (const theme of [null, PAPER]) {
  const t = '420x860 ' + (theme ? 'Paper' : 'dark');
  console.log('\n--- ' + t + ' ---');
  const { ctx, page, errors } = await boot({ width: 420, height: 860 }, { touch: true, theme });
  await goTab(page, 'cat2');
  // On a phone the Oscillator card (18 settings with the drives) is a drill-in.
  await page.click('main.pane .dash-cell[data-id$=":Oscillator"] .drill-open');
  await page.waitForSelector(F(FREQ));
  await rclick(page, F(FREQ));
  const items = await page.$$eval(MENU + ' .ui-menu-i', (b) => b.map((x) => x.textContent));
  ok(t + ': the field menu opens without Add to Dash (every Dash draws its seed here)', items.includes('Copy path') && !items.includes('Add to Dash'), items);
  await shot(page, '420x860-' + (theme ? 'paper' : 'dark'));
  await page.keyboard.press('Escape');
  ok(t + ': no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\nFAIL -- ' + fails + ' assertion(s)' : '\nPASS -- add to dash');
process.exit(fails ? 1 : 0);
