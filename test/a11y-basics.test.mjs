/**
 * a11y-basics.test.mjs -- keyboard/roving-focus, focus visibility, labels,
 * live reduced-motion, and root-font-scale checks (ph-vdk.17).
 *
 * Boots the real app against the same fake-hub harness responsive-matrix.mjs
 * uses (a stubbed WebSocket plus a pre-seeded catalog cache, the warm-
 * reconnect path -- no sim and no hardware needed) and drives it with real
 * keyboard events and Playwright's media emulation.
 *
 * Build first (`npm run build:only`).
 * Run: node test/a11y-basics.test.mjs
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS } from '../../Valence/clients/js/frames.js';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { buildSettingsModel, WIDGET } from '../src/model/settings.js';
import { STORE_KEY } from '../src/model/grid.js';
import { goTab, tabIds } from './nav.mjs';

const HTML = readFileSync(DIST_HTML);
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const toHex = (b) => Buffer.from(b).toString('hex');

// ---- HTTP: the bundle, plus a /uitoken mint so the session is control tier --
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- the fake hub: HELLO/WELCOME + GRANT-whatever-is-asked, no telemetry ---
// needed -- this instrument only checks rendered chrome, not live values.
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
            [IDENTITY_K.hub_name, cbTstr('a11y fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const m = cbDecodeFull(payload);
        const grants = [];
        for (const w of m.get(K.subscriptions) || []) {
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
            [K.channel_id, cbUint(w.get(K.channel_id))]]));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

/**
 * In-page WCAG audit: every element with its own text under `sel`, its color
 * blended by its ancestors' opacity over the first opaque background behind
 * it. Inactive controls are exempt (WCAG 1.4.3), and so is a stale value,
 * dimmed on purpose (law 8). Returns the failures in words.
 */
const lowContrast = (sel) => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor);
    if (c && c[3] > 0.5) return c; } return parse(getComputedStyle(document.documentElement).backgroundColor) || [0, 0, 0, 1]; };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[disabled], .is-disabled, [aria-disabled="true"], .typeable.disabled, .sr-only, .stale')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || !el.getClientRects().length) continue;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    if (o < 0.05) continue;
    const fg = parse(cs.color), bg = bgOf(el), a = fg[3] * o;
    const l1 = lum([0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const need = px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66) ? 3 : 4.5;
    if (ratio < need) out.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2));
  }
  return out;
};

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  — ' + extra : '')); if (!c) fails++; };

async function bootPage(browser, viewport, beforeGoto, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); }
    catch (e) { /* no storage: the harness will report a missing catalog */ }
  }, [ETAG, toHex(CAT)]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  if (beforeGoto) await beforeGoto(ctx, page);
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  return { ctx, page, pageErrors };
}

const browser = await chromium.launch();

// ---- 1. desktop rail: roving tabindex, ArrowUp/Down, Tab leaves -----------
{
  const { ctx, page, pageErrors } = await bootPage(browser, { width: 1440, height: 900 });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(300);

  const tabindexes = await page.$$eval('nav.rail [role=tab]', (els) => els.map((e) => e.getAttribute('tabindex')));
  ok('rail: exactly one tab sits in the Tab order (roving tabindex)',
     tabindexes.filter((t) => t === '0').length === 1, JSON.stringify(tabindexes));

  await page.focus('nav.rail [role=tab][tabindex="0"]');
  const before = await page.evaluate(() => document.activeElement.dataset.tabId);
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => document.activeElement.dataset.tabId);
  ok('rail: ArrowDown moves focus to the next tab', !!after && after !== before, before + ' -> ' + after);

  const selected = await page.evaluate(() =>
    document.querySelector('nav.rail [role=tab][aria-selected="true"]')?.dataset.tabId);
  ok('rail: the arrow-focused tab is also the selected one (automatic activation)', selected === after);

  // One Tab leaves the tabs: to the selected page's operations pill (inside the rail) or past the rail.
  await page.keyboard.press('Tab');
  const onTab = await page.evaluate(() => document.activeElement.matches('[role=tab]')
    || !!(document.activeElement.closest('nav.rail') && !document.activeElement.closest('.rail-ops')));
  ok('rail: a plain Tab leaves the tabs in one step', !onTab);

  // ph-8yga: the channel heatmap is a labeled toolbar, one tab stop, every block named; hover shows its tip.
  const heat = await page.$eval('.linkbar .heat', (h) => ({ role: h.getAttribute('role'), label: h.getAttribute('aria-label'),
    blocks: h.querySelectorAll('.blk').length, named: [...h.querySelectorAll('.blk')].every((b) => /\S, \S/.test(b.getAttribute('aria-label') || '')),
    stops: h.querySelectorAll('.blk[tabindex="0"]').length }));
  ok('heatmap: a labeled toolbar, every block named, one tab stop (ph-8yga)', heat.role === 'toolbar' && heat.label === 'Channel activity'
    && heat.blocks > 5 && heat.named && heat.stops === 1, JSON.stringify(heat));
  await page.hover('.linkbar .heat .blk');
  const tipRef = await page.$eval('.linkbar .heat .blk', (b) => {
    const t = document.getElementById(b.getAttribute('aria-describedby') || '');
    return t && t.getAttribute('role') === 'tooltip' && t.textContent.startsWith(b.getAttribute('aria-label').split(',')[0]);
  });
  ok('heatmap: hover shows a block tooltip that describes it', tipRef);
  await page.mouse.move(0, 400);

  if (pageErrors.length) ok('rail: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 2. phone menu (DESIGN §10.12): the hamburger, the drawer's roving tabindex, focus out and back ----
{
  const { ctx, page, pageErrors } = await bootPage(browser, { width: 390, height: 844 });
  await page.waitForSelector('.menu-btn', { timeout: 15000 });
  await page.waitForTimeout(300);
  const btn = await page.$eval('.menu-btn', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, t: b.dataset.tip, x: b.getAttribute('aria-expanded'), n: b.getAttribute('aria-label') }; });
  ok('phone menu: the hamburger is a named 40 px target with aria-expanded', btn.w >= 40 && btn.h >= 40 && btn.t === 'Menu' && btn.n === 'Menu' && btn.x === 'false', JSON.stringify(btn));
  await page.focus('.menu-btn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.phone-menu [role=tab]', { timeout: 5000 });
  await page.waitForTimeout(100);
  const tabindexes = await page.$$eval('.phone-menu [role=tab]', (els) => els.map((e) => e.getAttribute('tabindex')));
  ok('phone menu: exactly one tab sits in the Tab order', tabindexes.filter((t) => t === '0').length === 1, JSON.stringify(tabindexes));
  const before = await page.evaluate(() => document.activeElement.dataset.tabId);
  ok('phone menu: opening moves focus to the selected tab', before === 'machine', before);
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => document.activeElement.dataset.tabId);
  ok('phone menu: ArrowDown moves focus to the next tab', !!after && after !== before, before + ' -> ' + after);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('phone menu: Escape closes it and focus returns to the hamburger', await page.locator('.phone-menu').count() === 0
    && await page.evaluate(() => document.activeElement.classList.contains('menu-btn')));
  if (pageErrors.length) ok('phone menu: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 3. every button has an accessible name --------------------------------
{
  const { ctx, page } = await bootPage(browser, { width: 1440, height: 900 });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(300);

  for (const id of ['machine', 'log', 'pairing', 'display', 'valence']) {
    const present = await page.evaluate((id) => !!document.querySelector('[data-tab-id="' + id + '"]'), id);
    if (!present) continue;
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(250);
    const unnamed = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('button').forEach((b) => {
        const cs = getComputedStyle(b);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = b.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
        if (!name) bad.push((b.className || b.outerHTML.slice(0, 80)));
      });
      return bad;
    });
    ok('every visible button on "' + id + '" has an accessible name', unnamed.length === 0, unnamed.join(' | '));
  }
  await ctx.close();
}

// ---- 4. focus-visible on every sampled control -----------------------------
{
  const { ctx, page } = await bootPage(browser, { width: 1440, height: 900 });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('[data-tab-id="machine"]');
  await page.waitForTimeout(250);

  // Chromium's :focus-visible heuristic keys off the page's last INPUT
  // MODALITY, not the focus call itself -- a script .focus() on a page that
  // has never seen a real key event does not match :focus-visible. One real
  // keypress establishes "keyboard" modality for the rest of this check.
  await page.keyboard.press('Tab');

  const results = await page.evaluate(() => {
    const sig = (el) => {
      const cs = getComputedStyle(el);
      return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor].join('|');
    };
    const sels = ['nav.rail [role=tab]', '.rail-collapse', '.og-btn:not(:disabled)', 'select'];
    const out = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const before = sig(el);
      el.focus();
      const after = sig(el);
      el.blur();
      out.push({ sel, changed: before !== after, who: el.className + ' ' + el.textContent.trim().slice(0, 20), before });
    }
    return out;
  });
  for (const r of results) ok('focus-visible style differs from unfocused: ' + r.sel, r.changed, r.changed ? '' : r.who + ' | ' + r.before);

  // input[type=range]'s own box is a 2px hairline (T24) -- its focus ring
  // lives on the ::-webkit-slider-thumb pseudo-element, which getComputedStyle
  // cannot read back (it is a UA shadow pseudo, not a CSS-defined one), so
  // this checks the built stylesheet has the rule rather than measuring it.
  const hasRangeFocusRule = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (/input\[type=("|')?range("|')?\]:focus-visible::-webkit-slider-thumb/.test(rule.cssText || '')) return true;
        }
      } catch (e) { /* cross-origin sheet: none here */ }
    }
    return false;
  });
  ok('focus-visible rule exists for input[type=range]::-webkit-slider-thumb', hasRangeFocusRule);

  await ctx.close();
}

// ---- 5. reduced motion takes effect LIVE, no reload ------------------------
{
  const { ctx, page } = await bootPage(browser, { width: 1440, height: 900 });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(300);

  // The ground-truth ladder (style.css) is the one CSS-driven animation every
  // page can reach without a live write in flight: exercise it on a
  // throwaway probe rather than the real controls, so the check does not
  // depend on a pending/overdue write actually happening.
  const before = await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'a11y-probe';
    el.setAttribute('data-shadow', 'overdue');
    el.style.cssText = 'position:fixed;top:-100px;left:-100px;width:4px;height:4px;';
    document.body.appendChild(el);
    return getComputedStyle(el).animationName;
  });
  ok('sanity: the overdue-shadow animation runs under normal motion', before !== 'none', before);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => getComputedStyle(document.getElementById('a11y-probe')).animationName);
  ok('reduced motion applies LIVE (no reload): the animation stops', after === 'none', after);

  // T25: the effect variables stay registered under reduced motion. An
  // unregistered property computes to '' where a registered one has its
  // initial value.
  const fxG = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fx-g').trim());
  ok('T25: --fx-g stays a registered <number>, not a raw token', fxG === '0', fxG);

  // The mechanism RailWidget.svelte and LinkBar.svelte subscribe to
  // (mq.addEventListener('change', ...)) for their canvas-driven motion:
  // prove a fresh MediaQueryList actually fires on this same emulated
  // toggle, live, with no reload anywhere in this test.
  const changeFiredPromise = page.evaluate(() => new Promise((resolve) => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = setTimeout(() => resolve(false), 1500);
    mq.addEventListener('change', () => { clearTimeout(timer); resolve(true); }, { once: true });
  }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const changeFired = await changeFiredPromise;
  ok('matchMedia "change" fires live on a reduced-motion toggle (no reload)', changeFired);

  await ctx.close();
}

// ---- 6. root font honors a 20px browser default, --s still applies --------
async function checkRootFontAt(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* ignore */ }
  }, [ETAG, toHex(CAT)]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  let cdpOk = true;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 20, fixed: 20 } });
  } catch (e) {
    cdpOk = false;
  }
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(w >= 960 ? 'nav.rail [role=tab]' : '.menu-btn', { timeout: 15000 });
  await page.waitForTimeout(400);

  if (!cdpOk) {
    ok(w + 'w: root font honors a 20px default (CDP Page.setFontSizes)', true, 'SKIPPED -- CDP method unsupported on this Chromium');
  } else {
    const rootFs = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    // want --s(1.12) * 20px = 22.4px; a wide tolerance covers rounding.
    ok(w + 'w: root font honors a 20px default (--s still applies on top)',
       rootFs > 20.5 && rootFs < 24, 'computed html font-size=' + rootFs.toFixed(2) + 'px, want ~22.4');
  }
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 0.5);
  ok(w + 'w: no horizontal overflow at a 20px default', !overflow);
  await ctx.close();
}
await checkRootFontAt(360, 800);
await checkRootFontAt(1280, 720);

// ---- 7. one control placed twice keeps every DOM id unique (ph-4cz) -------
{
  const MODEL = buildSettingsModel(decodeCatalog(CAT));
  const dup = MODEL.fields.find((f) => !f.readOnly && !f.role && f.widget === WIDGET.slider);
  const key = 'uid:' + dup.uid;
  const store = JSON.stringify({ active: 'Default', modules: {}, layouts: { Default: { 'full.machine': {
    [key]: { x: 0, y: 0, w: 12, h: 2 }, [key + '#2']: { x: 0, y: 2, w: 12, h: 2 }, 'home:built': { x: 0, y: 9, w: 1, h: 1 } } } } });
  const { ctx, page, pageErrors } = await bootPage(browser, { width: 1440, height: 900 },
    (c) => c.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) { /* none */ } }, [STORE_KEY, store]));
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  const twice = await page.waitForFunction((u) => document.querySelectorAll('.field[data-uid="' + u + '"]').length === 2,
    dup.uid, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('duplicate: one control placed twice renders twice', twice);
  const r = await page.evaluate((u) => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const fields = [...document.querySelectorAll('.field[data-uid="' + u + '"]')];
    return {
      dupIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      own: fields.map((f) => {
        const l = f.querySelector('label.field-label[for]');
        const t = l && document.getElementById(l.getAttribute('for'));
        return !!t && f.contains(t);
      }),
    };
  }, dup.uid);
  ok('duplicate: no id appears twice on the page', r.dupIds.length === 0, r.dupIds.slice(0, 4).join(', '));
  ok('duplicate: each label names the input in its own placement', r.own.length === 2 && r.own.every(Boolean), JSON.stringify(r.own));
  if (pageErrors.length) ok('duplicate: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 8. the category page footer holds still (ph-vdk.60.3, ph-vdk.60.12) --
for (const [w, h, touch] of [[1440, 900, false], [420, 860, true], [390, 844, true], [360, 800, true]]) {
  const tag = w + 'w' + (touch ? ' touch' : '') + ' footer: ';
  const { ctx, page, pageErrors } = await bootPage(browser, { width: w, height: h }, null, { hasTouch: touch });
  await page.waitForSelector(w >= 960 ? 'nav.rail [role=tab][data-tab-id^="cat"]' : '.menu-btn', { timeout: 15000 });
  await page.waitForTimeout(300);
  // The expanded rail carries the page operations in its pill; the mini rail keeps them in the footer.
  if (w >= 960) await page.click('nav.rail .rail-collapse');
  const cats = await tabIds(page, 'cat');
  // The page with an advanced toggle; it moves the most cards.
  let found = false;
  for (let i = 0; i < cats.length && !found; i++) {
    await goTab(page, cats[i]);
    await page.waitForTimeout(200);
    found = await page.locator('main.pane .page-foot .adv-toggle[aria-label$=" advanced"]').count() > 0;
  }
  ok(tag + 'a page with advanced settings carries its toggle in the footer', found);
  if (found) {
    const t = page.locator('main.pane .page-foot .adv-toggle[aria-label$=" advanced"]').first();
    const foot = page.locator('main.pane .page-foot');
    const main = page.locator('main.pane .pane-main');
    // From the page top: a reveal above a scrolled view is the scroll anchor's to hold (the flip-keeps-the-scroll checks).
    await page.evaluate(() => { for (const e of [document.scrollingElement, ...document.querySelectorAll('main.pane, main.pane *')]) if (e && e.scrollTop) e.scrollTop = 0; });
    await page.waitForTimeout(100);
    const b0 = await t.boundingBox(), f0 = await foot.boundingBox(), y0 = (await main.boundingBox()).y, n0 = await t.ariaSnapshot();
    const e0 = await t.getAttribute('aria-expanded');
    await t.click();
    await page.waitForTimeout(200);
    const b1 = await t.boundingBox(), f1 = await foot.boundingBox(), y1 = (await main.boundingBox()).y, n1 = await t.ariaSnapshot();
    ok(tag + 'the toggle keeps its place and width when flipped', Math.abs(b0.x - b1.x) < 0.5
      && Math.abs(b0.y - b1.y) < 0.5 && Math.abs(b0.width - b1.width) < 0.5, JSON.stringify([b0, b1]));
    ok(tag + 'the footer keeps its box when flipped', JSON.stringify(f0) === JSON.stringify(f1), JSON.stringify([f0, f1]));
    ok(tag + 'the cards start where they did', Math.abs(y0 - y1) < 0.5, [y0, y1].join(' '));
    const label = (n) => (/button "([^"]*)"/.exec(n) || [])[1];
    ok(tag + 'the toggle is named by its visible label, its state by aria-expanded',
      /^\d+ advanced$/.test(label(n0)) && label(n0) === label(n1) && e0 !== await t.getAttribute('aria-expanded'), n0 + ' | ' + n1);
    ok(tag + 'inside the viewport, at its bottom', f1.x >= 0 && f1.x + f1.width <= w + 0.5 && f1.y + f1.height <= h + 0.5
      && f1.y + f1.height > h - (w >= 960 ? 60 : 1), JSON.stringify(f1));
    // Reachable: nothing covers a shown control's center (a disabled one
    // passes the pointer to the footer), and a fingertip gets 40 px.
    const ctl = await page.$$eval('main.pane .page-foot button', (els) => els.filter((el) => getComputedStyle(el).visibility === 'visible').map((el) => {
      const r = el.getBoundingClientRect();
      return { t: el.textContent.trim() || el.getAttribute('aria-label'), h: r.height, w: r.width,
        own: el.closest('.page-foot').contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
    }));
    ok(tag + 'every control is uncovered at its center', ctl.length > 0 && ctl.every((c) => c.own), JSON.stringify(ctl));
    if (touch) ok(tag + 'every control is 40 px under a coarse pointer', ctl.every((c) => c.h >= 39.5 && c.w >= 39.5), JSON.stringify(ctl));
    // Scrolled until the cards meet the sticky chrome, a flip keeps the
    // scroll every frame (only a shorter page may clamp it, to its own new
    // end) and the footer's box. Clicked in-page: Playwright's click would
    // scroll its target first. Mid-page, scroll anchoring holds the card in
    // view instead, which moves scrollTop on purpose.
    const flipScrolled = () => t.evaluate(async (el) => {
      const content = document.querySelector('.content');
      const se = content || document.scrollingElement;
      const chrome = content ? content.getBoundingClientRect().top
        : Math.max(...[...document.querySelectorAll('.topstrip, nav.tabs')].map((n) => n.getBoundingClientRect().bottom));
      se.scrollTop += document.querySelector('main.pane .pane-main').getBoundingClientRect().top - chrome;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const foot = () => { const r = el.closest('.page-foot').getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(); };
      const s0 = se.scrollTop, f0 = foot(), track = [];
      el.click();
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        track.push([se.scrollTop, se.scrollHeight - se.clientHeight, foot() === f0]);
      }
      return { s0, track };
    });
    for (const dir of ['flip', 'flip back']) {
      const r = await flipScrolled();
      ok(tag + dir + ' keeps the scroll and the footer every frame', r.track.length === 30 && (w >= 960 || r.s0 > 0)
        && r.track.every(([s, max, still]) => still && s >= Math.min(r.s0, max) - 1), JSON.stringify(r));
    }
    // ph-dj9: the in-flight count appearing moves nothing (this hub never answers a write), on a page
    // with a footer and a control this hub leaves enabled. On a phone a big card is a drill-in page.
    const live = page.locator('main.pane .field :is(input[type=range], input[role=switch]):not(:disabled)');
    for (let i = 0; i < cats.length && !(await live.count() && await page.locator('main.pane .page-foot .cat-busy').count()); i++) {
      await goTab(page, cats[i]);
      await page.waitForTimeout(200);
      for (let j = 0; !(await live.count()) && j < await page.locator('main.pane .drill-open').count(); j++) {
        await page.locator('main.pane .drill-open').nth(j).click();
        await page.waitForTimeout(200);
        if (!(await live.count())) { await page.click('main.pane .drill-back'); await page.waitForTimeout(150); }
      }
    }
    const boxes = () => page.$$eval('main.pane .page-foot, main.pane .page-foot button', (els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round).join();
    }).join(' '));
    const footH = () => page.$eval('main.pane .page-foot', (f) => f.getBoundingClientRect().height);
    const k0 = await boxes(), h0 = await footH();
    const range = await live.first().getAttribute('type') === 'range';
    await live.first().focus();
    await page.keyboard.press(range ? 'ArrowRight' : 'Space');
    await page.waitForTimeout(300);
    const busy = (await page.textContent('main.pane .page-foot .cat-busy')).trim();
    ok(tag + 'the in-flight count appears in its slot and moves nothing (ph-dj9)', /^\d+ in flight$/.test(busy) && await boxes() === k0, busy + ' | ' + k0);
    // DESIGN 10.3: on the phone the footer is one 48 px row, with or without a count.
    if (w < 960) ok(tag + 'one 48 px row at rest and with a count (ph-dj9)', h0 === 48 && await footH() === 48, h0 + ' -> ' + await footH());
  }
  if (pageErrors.length) ok(tag + 'no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 9. hi-vis: every category page's fields clear WCAG AA (ph-vdk.60.4) --
for (const [w, h] of [[1440, 900], [360, 800]]) {
  const { ctx, page, pageErrors } = await bootPage(browser, { width: w, height: h },
    (c) => c.addInitScript(() => { try { localStorage.setItem('ui_hivis', '1'); } catch (e) { /* none */ } }));
  await page.waitForSelector(w >= 960 ? 'nav.rail [role=tab][data-tab-id^="cat"]' : '.menu-btn', { timeout: 15000 });
  await page.waitForTimeout(300);
  ok(w + 'w hi-vis: the preference is on before first paint', await page.evaluate(() => document.documentElement.classList.contains('hivis')));
  const cats = await tabIds(page, 'cat');
  const bad = [];
  for (let i = 0; i < cats.length; i++) {
    await goTab(page, cats[i]);
    await page.waitForTimeout(150);
    // Each click shrinks the match set, so click the first until none is left.
    const shut = page.locator('main.pane .page-foot .adv-toggle[aria-expanded="false"]');
    for (let k = 0; k < 40 && await shut.count(); k++) await shut.first().click();
    await page.waitForTimeout(150);
    bad.push(...await page.evaluate(lowContrast, 'main.pane :is(.field, .page-foot, .cat-empty) *'));
  }
  ok(w + 'w hi-vis: every category page\'s text clears WCAG AA', bad.length === 0, [...new Set(bad)].slice(0, 6).join(' | '));
  if (pageErrors.length) ok(w + 'w hi-vis: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 10. tooltips (ui/tip.js): never a native title, redundant tips dropped, informative ones shown --
{
  const { ctx, page, pageErrors } = await bootPage(browser, { width: 1428, height: 900 });
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(300);
  const POP = '#ph-tip:popover-open';
  const titled = () => page.$$eval('[title]', (els) => els.map((e) => e.tagName.toLowerCase() + '.' + e.className + '[' + e.getAttribute('title') + ']'));
  // Interactive elements whose tooltip is all they say: each needs a name of its own.
  const unnamed = () => page.$$eval('[data-tip]', (els) => els.filter((e) => e.matches('button,a[href],input,select,textarea,summary,[role=tab],[role=button],[role=switch],[role=slider]')
    && e.getClientRects().length && !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent.trim() || e.labels?.length
    || e.getAttribute('alt') || e.closest('label')?.textContent.trim())).map((e) => e.className || e.tagName));
  const tabs = await tabIds(page);
  const seen = new Set();
  const bad = [], noName = [];
  for (const id of tabs) {
    await goTab(page, id);
    await page.waitForTimeout(250);
    // Hover every tipped element on the page and Tab through its first stops: no title may appear or survive.
    const at = await page.$$eval('[data-tip]', (els) => els.filter((e) => e.getClientRects().length).map((e) => {
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }));
    for (const [x, y] of at.slice(0, 60)) await page.mouse.move(x, y);
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    bad.push(...(await titled()).map((t) => id + ': ' + t));
    noName.push(...(await unnamed()).map((t) => id + ': ' + t));
    for (const [x, y] of at) seen.add(id + x + ',' + y);
    await page.mouse.move(0, 400);
  }
  ok('sweep: ' + tabs.length + ' pages at 1428x900, hovered and tabbed, leave no title attribute', bad.length === 0, bad.slice(0, 5).join(' | '));
  ok('sweep: ' + seen.size + ' tipped elements, none of them without a name of its own', noName.length === 0, [...new Set(noName)].slice(0, 6).join(' | '));
  ok('sweep: the pages carry tooltips at all (data-tip)', seen.size > 20, String(seen.size));

  // The collapsed rail is icon-only: the tab's tip is its name.
  await page.click('nav.rail .rail-collapse');
  await page.waitForTimeout(250);
  const mini = await page.$$eval('nav.rail [role=tab]', (ts) => ts.map((t) => t.getAttribute('aria-label') || t.textContent.trim()));
  ok('collapsed rail: every tab keeps its name', mini.length > 3 && mini.every(Boolean), JSON.stringify(mini));
  await page.click('nav.rail .rail-collapse');

  // A probe element, placed fixed and hovered; the tip is open or it is not.
  const probe = async (html, how = 'hover') => {
    await page.mouse.move(0, 400);
    await page.evaluate((h) => {
      document.getElementById('probe')?.remove();
      const d = document.createElement('div');
      d.id = 'probe';
      d.style.cssText = 'position:fixed;left:400px;top:300px;z-index:9;background:#222;padding:6px';
      d.innerHTML = h;
      document.body.append(d);
    }, html);
    const el = page.locator('#probe > :first-child');
    if (how === 'hover') await el.hover({ force: true }); else { await page.keyboard.press('Tab'); await el.focus(); }
    await page.waitForTimeout(how === 'hover' ? 750 : 150);
    const open = await page.locator(POP).count() === 1;
    return { open, text: open ? await page.locator('#ph-tip').textContent() : null, el };
  };
  let r = await probe('<button title="Writes the file to disk">Save</button>');
  ok('probe: an informative tip shows', r.open && r.text === 'Writes the file to disk', r.text);
  ok('probe: a title injected at runtime is gone the moment it is hovered', await r.el.getAttribute('title') === null
    && await r.el.getAttribute('data-tip') === 'Writes the file to disk' && (await titled()).length === 0);
  ok('probe: the shown tip describes its element', (await r.el.getAttribute('aria-describedby') || '').split(' ').includes('ph-tip')
    && await page.locator('#ph-tip').getAttribute('role') === 'tooltip');
  await page.mouse.move(0, 400);
  await page.waitForTimeout(100);
  ok('probe: leaving hides it and drops the description', await page.locator(POP).count() === 0 && await r.el.getAttribute('aria-describedby') === null);
  for (const [name, html] of [
    ['text, case and spacing', '<button title="  save ">Save</button>'],
    ['text and a trailing shortcut hint', '<button title="Save (Ctrl+S)">Save</button>'],
    ['text and a comma shortcut', '<button title="Save, Ctrl+S">Save</button>'],
    ['aria-label while it has visible text', '<button aria-label="Save changes" title="Save changes">Save</button>'],
  ]) {
    r = await probe(html);
    ok('probe: a tip equal to the ' + name + ' is suppressed', !r.open && await r.el.getAttribute('title') === null, r.text);
  }
  r = await probe('<button title="Close"><svg width="12" height="12"></svg></button>');
  ok('probe: an icon-only button keeps its tip, its only visible name', r.open && r.text === 'Close');
  ok('probe: a title that was the only name becomes the aria-label', await r.el.getAttribute('aria-label') === 'Close');
  r = await probe('<button disabled title="Paused: Override to jog">Jog</button>');
  ok('probe: a disabled control still shows its reason', r.open && r.text === 'Paused: Override to jog', r.text);
  r = await probe('<span style="display:block;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="A long scene name that is cut">A long scene name that is cut</span>');
  ok('probe: truncated text keeps its tip, the full content', r.open && r.text === 'A long scene name that is cut', r.text);
  r = await probe('<span style="display:block;width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="A short name">A short name</span>');
  ok('probe: the same text fully shown has no tip', !r.open, r.text);
  r = await probe('<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"><title>Float to int</title></circle></svg>');
  await page.locator('#probe circle').hover({ force: true });
  await page.waitForTimeout(750);
  ok('probe: an SVG title child moves to our tip too', await page.locator('#probe title').count() === 0 && await page.locator(POP).count() === 1
    && await page.locator('#ph-tip').textContent() === 'Float to int');
  r = await probe('<button data-tip="Opens the log">Log</button>', 'focus');
  ok('probe: keyboard focus shows the tip', r.open && r.text === 'Opens the log', r.text);
  await page.keyboard.press('Escape');
  ok('probe: Escape hides it', await page.locator(POP).count() === 0);
  if (pageErrors.length) ok('tooltips: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS — keyboard, labels, focus and motion basics hold.'));
process.exit(fails ? 1 : 0);
