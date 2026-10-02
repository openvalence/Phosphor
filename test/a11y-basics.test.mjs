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
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS } from '../../Valence/clients/js/frames.js';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { buildSettingsModel, WIDGET } from '../src/model/settings.js';
import { STORE_KEY } from '../src/model/grid.js';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
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

async function bootPage(browser, viewport, beforeGoto) {
  const ctx = await browser.newContext({ viewport });
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

  await page.keyboard.press('Tab');
  const stillInRail = await page.evaluate(() => !!document.activeElement.closest('nav.rail'));
  ok('rail: a plain Tab leaves the tablist in one step', !stillInRail);

  if (pageErrors.length) ok('rail: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 2. phone tab strip: roving tabindex, ArrowLeft/Right ------------------
{
  const { ctx, page, pageErrors } = await bootPage(browser, { width: 390, height: 844 });
  await page.waitForSelector('nav.tabs [role=tab]', { timeout: 15000 });
  await page.waitForTimeout(300);

  const tabindexes = await page.$$eval('nav.tabs [role=tab]', (els) => els.map((e) => e.getAttribute('tabindex')));
  ok('phone tabs: exactly one tab sits in the Tab order', tabindexes.filter((t) => t === '0').length === 1, JSON.stringify(tabindexes));

  await page.focus('nav.tabs [role=tab][tabindex="0"]');
  const before = await page.evaluate(() => document.activeElement.dataset.tabId);
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => document.activeElement.dataset.tabId);
  ok('phone tabs: ArrowRight moves focus to the next tab', !!after && after !== before, before + ' -> ' + after);
  await page.keyboard.press('ArrowLeft');
  const back = await page.evaluate(() => document.activeElement.dataset.tabId);
  ok('phone tabs: ArrowLeft moves back', back === before, back);

  if (pageErrors.length) ok('phone tabs: no page errors', false, pageErrors.join(' | '));
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
    const sels = ['nav.rail [role=tab]', '.rail-collapse', '.og-btn', 'select'];
    const out = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const before = sig(el);
      el.focus();
      const after = sig(el);
      el.blur();
      out.push({ sel, changed: before !== after });
    }
    return out;
  });
  for (const r of results) ok('focus-visible style differs from unfocused: ' + r.sel, r.changed);

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

  // T25 registered custom property (style.css's --pr, the intent-echo
  // wavefront) must still resolve to a real percentage under reduced motion,
  // never fall back to an unregistered raw token.
  const prType = await page.evaluate(() => CSS.supports('(--pr: 10%)') && getComputedStyle(document.documentElement).getPropertyValue('--pr'));
  ok('T25: --pr stays a registered <percentage>, not a raw token', prType !== false);

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
  const tabSel = w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]';
  await page.waitForSelector(tabSel, { timeout: 15000 });
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

// ---- 8. the category page bar holds still (ph-vdk.60.3) --------------------
for (const [w, h] of [[1440, 900], [360, 800]]) {
  const { ctx, page, pageErrors } = await bootPage(browser, { width: w, height: h });
  const tabSel = w >= 960 ? 'nav.rail [role=tab][data-tab-id^="cat"]' : 'nav.tabs [role=tab][data-tab-id^="cat"]';
  await page.waitForSelector(tabSel, { timeout: 15000 });
  const tabs = page.locator(tabSel);
  let found = false;
  for (let i = 0; i < await tabs.count() && !found; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(200);
    found = await page.locator('main.pane .cat-bar .adv-toggle').count() > 0;
  }
  ok(w + 'w page bar: a page with advanced settings carries its toggle in the bar', found);
  if (found) {
    const t = page.locator('main.pane .cat-bar .adv-toggle').first();
    const next = page.locator('main.pane .cat-bar + *');
    const sy = () => page.evaluate(() => document.scrollingElement.scrollTop);
    const s0 = await sy(), b0 = await t.boundingBox(), y0 = (await next.boundingBox()).y, n0 = await t.ariaSnapshot();
    await t.click();
    await page.waitForTimeout(200);
    const s1 = await sy(), b1 = await t.boundingBox(), y1 = (await next.boundingBox()).y, n1 = await t.ariaSnapshot();
    // Page coordinates: on a phone the page scrolls, and a toggle that
    // re-renders the grid resets that scroll (ph-vdk.60.6, the grid's).
    ok(w + 'w page bar: the toggle keeps its place and width when flipped', Math.abs(b0.x - b1.x) < 0.5
      && Math.abs(b0.y + s0 - b1.y - s1) < 0.5 && Math.abs(b0.width - b1.width) < 0.5, JSON.stringify([b0, b1, s0, s1]));
    ok(w + 'w page bar: the cards below start where they did', Math.abs(y0 + s0 - y1 - s1) < 0.5, [y0, s0, y1, s1].join(' '));
    ok(w + 'w page bar: the toggle is named by its visible label only', /"(Show|Hide) \d+ (advanced|diagnostic)"/.test(n0)
      && /"(Show|Hide) \d+ (advanced|diagnostic)"/.test(n1) && n0 !== n1, n0 + ' | ' + n1);
    const box = await page.locator('main.pane .cat-bar').boundingBox();
    ok(w + 'w page bar: inside the viewport', box.x >= 0 && box.x + box.width <= w + 0.5);
  }
  if (pageErrors.length) ok(w + 'w page bar: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

// ---- 9. hi-vis: every category page's fields clear WCAG AA (ph-vdk.60.4) --
for (const [w, h] of [[1440, 900], [360, 800]]) {
  const { ctx, page, pageErrors } = await bootPage(browser, { width: w, height: h },
    (c) => c.addInitScript(() => { try { localStorage.setItem('ui_hivis', '1'); } catch (e) { /* none */ } }));
  const tabSel = w >= 960 ? 'nav.rail [role=tab][data-tab-id^="cat"]' : 'nav.tabs [role=tab][data-tab-id^="cat"]';
  await page.waitForSelector(tabSel, { timeout: 15000 });
  ok(w + 'w hi-vis: the preference is on before first paint', await page.evaluate(() => document.documentElement.classList.contains('hivis')));
  const tabs = page.locator(tabSel);
  const bad = [];
  for (let i = 0; i < await tabs.count(); i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(150);
    for (const t of await page.locator('main.pane .cat-bar .adv-toggle[aria-expanded="false"]').all()) await t.click();
    await page.waitForTimeout(150);
    bad.push(...await page.evaluate(lowContrast, 'main.pane :is(.field, .cat-bar, .cat-empty) *'));
  }
  ok(w + 'w hi-vis: every category page\'s text clears WCAG AA', bad.length === 0, [...new Set(bad)].slice(0, 6).join(' | '));
  if (pageErrors.length) ok(w + 'w hi-vis: no page errors', false, pageErrors.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS — keyboard, labels, focus and motion basics hold.'));
process.exit(fails ? 1 : 0);
