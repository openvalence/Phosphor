/**
 * theme-browser.test.mjs -- the theme engine in the served bundle against a
 * fake hub (ph-vdk.64): a chassis change moves computed --bg, a canvas that
 * paints neutrals repaints, the editor's fixed slots hold still, a pinned
 * token wins, the safety colors never move, and the Look scale applies live
 * under a grid scale step (ph-vdk.66). Review 2026-10-02: the readout names
 * an accent on a safety hue in its fixed slot and never wraps at 390 px,
 * Advanced rows hold one height, every Display section is one surface, knob
 * units follow format.js, safety text reads on the light chassis, and chrome
 * keys clear 3:1.
 *
 * Build first (`npm run build:only`).
 * Run: node test/theme-browser.test.mjs [shots-dir]
 *   With a directory, also saves the Display pane and the home page under
 *   the default, a chassis-varied and the light preset.
 */
import { goTab } from './nav.mjs';
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS } from '../../Valence/clients/js/frames.js';
import { deriveTokens, THEMES, contrast } from '../src/model/theme.js';
import { formatWithUnit } from '../src/model/format.js';

const SHOTS = process.argv[2] || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const HTML = readFileSync(DIST_HTML);
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const toHex = (b) => Buffer.from(b).toString('hex');

const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

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
            [IDENTITY_K.hub_name, cbTstr('theme fixture')]])],
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

// Same audit as a11y-basics.test.mjs section 9, the repo's text floor.
/**
 * In-page WCAG audit: every element with its own text under `sel`, its color
 * blended by its ancestors' opacity over the first opaque background behind
 * it. Inactive controls are exempt (WCAG 1.4.3), and so is a stale value,
 * dimmed on purpose (law 8). Returns the failures in words. `[sel, floor]`
 * holds every match to one floor instead (3 for chrome keys).
 */
const lowContrast = (arg) => {
  const [sel, floor] = Array.isArray(arg) ? arg : [arg, 0];
  const parse = (c) => { const s = /color\(srgb ([^)]+)\)/.exec(c); const m = s || /rgba?\(([^)]+)\)/.exec(c); if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); const k = s ? 255 : 1;
    return [p[0] * k, p[1] * k, p[2] * k, p.length > 3 ? p[3] : 1]; };
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
    const need = floor || (px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66) ? 3 : 4.5);
    if (ratio < need) out.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2));
  }
  return out;
};

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };
/** Chrome keys: the top bar's chip labels, the foot strip's keys, the rail tape's words and end numerals. */
const KEYS = '.linkbar .chip-lbl, .footstrip .k, .footstrip .fs-label, .rail-tape-micro, .rail-endcap';
const spread = (a) => Math.max(...a) - Math.min(...a);
/** Advanced rows as [top within the list, height]: a scroll moves none of them. */
const rows = (page) => page.$$eval('.tokens li', (ls) => ls.map((l) => {
  const r = l.getBoundingClientRect();
  return [r.top - l.parentElement.getBoundingClientRect().top, r.height];
}));

const browser = await chromium.launch();
async function boot(viewport, seed = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:' + PORT });
  await ctx.addInitScript(([etag, bytes, seed]) => {
    try {
      if (!sessionStorage.getItem('booted')) {
        sessionStorage.setItem('booted', '1');
        localStorage.clear();
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
    } catch (e) { /* no storage */ }
  }, [ETAG, toHex(CAT), seed]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}
// The rail, the tab strip, or the phone menu's drawer (nav.mjs).
const openTab = async (page, id) => {
  await page.waitForSelector('[data-tab-id="' + id + '"], .menu-btn', { timeout: 15000 });
  await goTab(page, id);
  await page.waitForTimeout(250);
};
const css = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
/** A token resolved through var() to the painted color, as #RRGGBB. */
const hexOf = (page, name) => page.evaluate((n) => {
  const el = document.createElement('i');
  el.style.color = 'var(' + n + ')';
  document.body.appendChild(el);
  const m = getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number);
  el.remove();
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}, name);
const setKnob = (page, knob, v) => page.$eval('[data-knob="' + knob + '"]', (el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
/** The whole Display pane: the window grows until the pane stops scrolling. */
async function paneShot(page, file) {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: 2600 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, file) });
  await page.setViewportSize(vp);
  await page.waitForTimeout(200);
}
const canvasSums = (page) => page.$$eval('canvas', (cs) => cs.map((c) => {
  if (!c.width || !c.height) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s = (s + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + d[i + 3]) % 1e9;
  return s;
}));

// ---- 1. desktop: default paint, chassis edit, pinned token, canvas repaint ------
{
  console.log('\n--- theme, desktop ---');
  const { ctx, page, errors } = await boot({ width: 1440, height: 900 });
  await page.waitForSelector('[data-tab-id="display"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const def = deriveTokens(THEMES[0]).base;
  ok('default: computed --bg is the default chassis', await hexOf(page, '--bg') === def['--bg'], await hexOf(page, '--bg'));
  ok('default: computed --tx is the default chassis', await hexOf(page, '--tx') === def['--tx']);
  const warn0 = await css(page, '--warn'), bad0 = await css(page, '--bad');
  const keyLow = await page.evaluate(lowContrast, [KEYS, 3]);
  ok('chrome keys clear 3:1 (ph-7tt)', keyLow.length === 0 && await page.$$eval(KEYS, (els) => els.length) > 5, keyLow.slice(0, 4).join(' | '));
  ok('a dark chassis draws safety text in the raw colors (ph-632)',
    await hexOf(page, '--warn-ink') === await hexOf(page, '--warn') && await hexOf(page, '--bad-ink') === await hexOf(page, '--bad'));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'home-phosphor.png') });
  const before = await canvasSums(page);
  ok('home: a canvas is painting', before.some((s) => s > 0), before.length + ' canvases');

  await openTab(page, 'display');
  if (SHOTS) await paneShot(page, 'display-default.png');
  ok('display: every section is one surface, og-panel (ph-cpg)', await page.$$eval('.theme-picker > section',
    (ss) => ss.length > 5 && ss.every((s) => s.classList.contains('og-panel') && !s.classList.contains('og-screen'))));
  const outs = await page.$$eval('.theme-picker .knob-row output', (os) => os.map((o) => o.textContent.trim()));
  const host = (unit, v) => formatWithUnit({ unit, step: 1 }, v);
  ok('display: knob readouts join value and unit as format.js does (ph-e31)', outs.includes(host('%', 100)) && outs.includes(host('px', 2))
    && outs.includes(host('°', 263)) && !outs.some((t) => /\d[^\d\s.]/.test(t)), outs.join(', '));
  const box = () => page.$eval('[data-testid="theme-ratios"]', (el) => { const r = el.getBoundingClientRect(); return [r.top, r.height]; });
  const near = async () => (await page.textContent('[data-testid="theme-near"]')).trim();
  const [top0, h0] = await box();
  ok('readout: no safety note on the default accents', await near() === '');
  await setKnob(page, 'chassis.brightness', 0.3);
  await setKnob(page, 'chassis.hue', 200);
  await setKnob(page, 'chassis.tint', 3);
  await page.waitForTimeout(150);
  const bg1 = await hexOf(page, '--bg');
  const want = deriveTokens({ ...THEMES[0], chassis: { hue: 200, tint: 3, brightness: 0.3, contrast: 1 } }).base['--bg'];
  ok('chassis: computed --bg changed', bg1 !== def['--bg'], def['--bg'] + ' -> ' + bg1);
  ok('chassis: computed --bg is the derived value', bg1 === want, want);
  ok('chassis: the page background follows', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== 'rgb(8, 9, 11)');
  ok('chassis: an edit is the Custom theme, persisted', await page.textContent('[data-testid="theme-active"]') === 'Custom'
    && await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.theme')).chassis.hue === 200));
  const [top1, h1] = await box();
  ok('chassis: the ratio readout holds its slot', Math.abs(top1 - top0) < 0.5 && Math.abs(h1 - h0) < 0.5, top0 + '/' + h0 + ' -> ' + top1 + '/' + h1);
  ok('chassis: the ratio readout reads a live ratio', /Text \d+\.\d:1/.test(await page.textContent('[data-testid="theme-ratios"]')));
  await page.$eval('input[aria-label="Intent color"]', (el) => { el.value = '#ffd24d'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);
  ok('readout: an accent on the safety amber is named (ph-76i)', await near() === 'Intent near safety amber', await near());
  const [top2, h2] = await box();
  ok('readout: the note lands in the fixed slot', Math.abs(top2 - top0) < 0.5 && Math.abs(h2 - h0) < 0.5, top0 + '/' + h0 + ' -> ' + top2 + '/' + h2);
  await page.click('[data-theme-id="ember"]');
  await page.waitForTimeout(100);
  ok('readout: Ember reads no safety note (ph-76i)', await near() === '', await near());
  ok('safety: --warn and --bad never move', await css(page, '--warn') === warn0 && await css(page, '--bad') === bad0);

  await page.click('.adv summary');
  await page.waitForTimeout(100);
  if (SHOTS) await paneShot(page, 'display-custom-advanced.png');
  const r0 = await rows(page);
  ok('advanced: every row is one height (ph-l6t)', spread(r0.map((r) => r[1])) < 0.5, r0.map((r) => r[1]).join(','));
  const gap = await page.evaluate(() => document.querySelector('.tokens li').getBoundingClientRect().top
    - document.querySelector('.adv summary').getBoundingClientRect().bottom);
  ok('advanced: no blank gap under the header', gap >= 0 && gap < 8, gap.toFixed(1) + ' px');
  const cell = (k) => page.$eval('#tp-v' + k, (el) => [el.getBoundingClientRect().height, el.scrollWidth > el.clientWidth, el.title]);
  const [glowH, cut, glowTitle] = await cell('--glow-reality');
  ok('advanced: a long value is one line, whole in its title', glowH === (await cell('--bg'))[0] && cut && glowTitle.startsWith('0 0 18px'), glowH + ' ' + glowTitle);
  await page.fill('input[aria-label="Pin --radius"]', '1px;color:red');
  await page.press('input[aria-label="Pin --radius"]', 'Enter');
  await page.waitForTimeout(100);
  ok('advanced: a refused pin speaks in its own row', /Not a single CSS value/.test(await page.textContent('#tp-v--radius'))
    && await page.getAttribute('input[aria-label="Pin --radius"]', 'aria-invalid') === 'true');
  const r1 = await rows(page);
  ok('advanced: the refusal moves no row', r1.every((r, i) => Math.abs(r[0] - r0[i][0]) < 0.5 && Math.abs(r[1] - r0[i][1]) < 0.5));
  await page.fill('input[aria-label="Pin --bg-card"]', '#203040');
  await page.press('input[aria-label="Pin --bg-card"]', 'Enter');
  await page.waitForTimeout(100);
  ok('advanced: a pinned token wins', await hexOf(page, '--bg-card') === '#203040');
  ok('advanced: no row for a safety token', !(await page.$('input[aria-label="Pin --warn"]')) && !(await page.$('input[aria-label="Pin --bad"]')));
  await page.click('button[aria-label="Reset --bg-card"]');
  await page.waitForTimeout(100);
  ok('advanced: reset returns the derived value', await hexOf(page, '--bg-card') !== '#203040');
  await page.click('.adv summary');

  await page.click('[data-theme-id="slate"]');
  await page.waitForTimeout(150);
  ok('preset: Slate applies its chassis', await hexOf(page, '--bg') === deriveTokens(THEMES.find((t) => t.id === 'slate')).base['--bg']);
  await openTab(page, 'machine');
  await page.waitForTimeout(800);
  const after = await canvasSums(page);
  ok('home: a canvas repainted under the new theme', after.some((s, i) => s !== before[i]), before.join(',') + ' -> ' + after.join(','));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'home-slate.png') });

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- 1b. phones and the 200 px floor: the readout never wraps or clips, ---------
// Advanced rows keep one height
for (const [width, height] of [[200, 390], [320, 568], [390, 844]]) {
  console.log('\n--- theme, ' + width + 'x' + height + ' ---');
  const { ctx, page, errors } = await boot({ width, height });
  await openTab(page, 'display');
  const rd = await page.$eval('[data-testid="theme-ratios"]', (el) => {
    const box = el.getBoundingClientRect();
    const tops = [...el.querySelectorAll('.ratio')].map((c) => c.getBoundingClientRect().top);
    const whole = [...el.querySelectorAll('.ratio > span')].every((s) => s.scrollWidth <= s.clientWidth + 0.5
      && s.getBoundingClientRect().right <= box.right + 0.5);
    return { tops, whole, lines: Math.round(box.height / parseFloat(getComputedStyle(el).lineHeight)),
      sideways: document.documentElement.scrollWidth > innerWidth };
  });
  if (width < 264) {
    ok(width + ': the ratios take one line each, nothing clips or scrolls sideways (ph-eqs)', rd.whole && rd.lines === 4 && !rd.sideways,
      JSON.stringify(rd));
  } else {
    ok(width + ': the three ratios share one row, every word and number whole (ph-eqs)', spread(rd.tops) < 0.5 && rd.whole
      && rd.lines === 3 && !rd.sideways, JSON.stringify(rd));
  }
  await page.click('.adv summary');
  await page.waitForTimeout(100);
  const r = await rows(page);
  ok(width + ': every Advanced row is one height (ph-l6t)', spread(r.map((x) => x[1])) < 0.5,
    Math.min(...r.map((x) => x[1])) + '..' + Math.max(...r.map((x) => x[1])));
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- 2. migration: the old custom pair survives the first load ------------------
{
  console.log('\n--- theme, migration ---');
  const { ctx, page, errors } = await boot({ width: 1024, height: 768 },
    { 'sd32.theme': 'custom', 'sd32.theme.customColors': JSON.stringify({ reality: '#12AB34', intent: '#AB12CD' }) });
  await page.waitForSelector('[data-tab-id="display"]', { timeout: 15000 });
  ok('migration: the old custom reality is live', await hexOf(page, '--reality') === '#12AB34');
  ok('migration: written into the new key', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.theme')).accents.intent) === '#AB12CD');
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- 2b. the Look scale applies live under a grid scale step (ph-vdk.66) -------
{
  console.log('\n--- theme, live scale ---');
  const { ctx, page, errors } = await boot({ width: 1440, height: 900 }, { 'phosphor.scale': '1.25' });
  await openTab(page, 'display');
  const s = async () => Number(await css(page, '--s'));
  const s0 = await s();
  ok('scale: the grid step multiplies the theme base', Math.abs(s0 - 1.12 * 1.25) < 1e-6, s0);
  await setKnob(page, 'look.scale', 1.4);
  await page.waitForTimeout(150);
  const s1 = await s();
  ok('scale: the Look knob applies live through the grid step', Math.abs(s1 - 1.4 * 1.25) < 1e-6, s0 + ' -> ' + s1);
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- 3. chassis-varied and light presets: color-scheme follows, and under
// hi-vis every category page clears the same WCAG floor the default does ------
for (const id of ['slate', 'ink', 'paper']) {
  const t = THEMES.find((x) => x.id === id);
  if (!t) continue;
  console.log('\n--- theme, ' + id + ' ---');
  const { ctx, page, errors } = await boot({ width: 1440, height: 900 }, { 'phosphor.theme': JSON.stringify(t) });
  await page.waitForSelector('[data-tab-id="display"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  ok(id + ': color-scheme matches the chassis', scheme === (deriveTokens(t).dark ? 'dark' : 'light'), scheme);
  const keyLow = await page.evaluate(lowContrast, [KEYS, 3]);
  ok(id + ': chrome keys clear 3:1 (ph-7tt)', keyLow.length === 0, keyLow.slice(0, 4).join(' | '));
  const inkLow = [];
  for (const ink of ['--warn-ink', '--bad-ink']) {
    for (const s of ['--bg', '--bg-raised', '--bg-card', '--bg-sunken']) {
      const r = contrast(await hexOf(page, ink), await hexOf(page, s));
      if (r < 4.5) inkLow.push(ink + ' on ' + s + ' ' + r.toFixed(2));
    }
  }
  ok(id + ': safety text reads 4.5:1 on every surface (ph-632)', inkLow.length === 0, inkLow.join(' | '));
  const btn = await page.evaluate(() => Object.fromEntries(['running', 'danger'].map((c) => {
    const b = document.createElement('button');
    b.className = 'og-btn ' + c;
    document.body.appendChild(b);
    const v = getComputedStyle(b).color;
    b.remove();
    return [c, v];
  })));
  const inkRgb = async (k) => 'rgb(' + (await hexOf(page, k)).slice(1).match(/../g).map((x) => parseInt(x, 16)).join(', ') + ')';
  ok(id + ': running and danger buttons write in the inks', btn.running === await inkRgb('--warn-ink') && btn.danger === await inkRgb('--bad-ink'), JSON.stringify(btn));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'home-' + id + '.png') });
  await openTab(page, 'display');
  if (SHOTS) await paneShot(page, 'display-' + id + '.png');
  await page.evaluate(() => document.documentElement.classList.add('hivis'));
  const tabs = page.locator('nav.rail [role=tab][data-tab-id^="cat"]');
  const bad = [];
  for (let i = 0; i < await tabs.count(); i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(150);
    // Each click shrinks the match set, so click the first until none is left.
    const shut = page.locator('main.pane .page-foot .adv-toggle[aria-expanded="false"]');
    for (let k = 0; k < 40 && await shut.count(); k++) await shut.first().click();
    await page.waitForTimeout(150);
    bad.push(...await page.evaluate(lowContrast, 'main.pane :is(.field, .page-foot, .cat-empty) *'));
  }
  ok(id + ' hi-vis: every category page clears WCAG AA', tabs && bad.length === 0, [...new Set(bad)].slice(0, 6).join(' | '));
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- 3b. every preset: safety text reads 4.5:1 on every surface (ph-632) -----
for (const t of THEMES) {
  const { ctx, page, errors } = await boot({ width: 1440, height: 900 }, { 'phosphor.theme': JSON.stringify(t) });
  await page.waitForSelector('nav.rail .rail-name', { timeout: 15000 });
  await page.waitForTimeout(300);
  const inkLow = [];
  for (const ink of ['--warn-ink', '--bad-ink']) {
    for (const s of ['--bg', '--bg-raised', '--bg-card', '--bg-sunken']) {
      const r = contrast(await hexOf(page, ink), await hexOf(page, s));
      if (r < 4.5) inkLow.push(ink + ' on ' + s + ' ' + r.toFixed(2));
    }
  }
  ok(t.id + ': safety text reads 4.5:1 on every surface (ph-632)', inkLow.length === 0, inkLow.join(' | '));
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- 4. motion: html.still from theme motion 0, the Motion pref and the OS ---
{
  console.log('\n--- motion ---');
  const hover = async (page) => {
    await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
    await page.hover('nav.rail [role=tab] >> nth=1');
    return page.$eval('nav.rail [role=tab] >> nth=1', (e) => parseFloat(getComputedStyle(e).transitionDuration));
  };
  const motionCase = async (name, { pref, media, theme }, wantStill, wantHover) => {
    const seed = {};
    if (pref) seed['phosphor.prefs'] = JSON.stringify({ v: 1, motion: pref });
    if (theme) seed['phosphor.theme'] = JSON.stringify(theme);
    const { ctx, page, errors } = await boot({ width: 1440, height: 900 }, seed);
    if (media) await page.emulateMedia({ reducedMotion: media });
    const dur = await hover(page);
    await page.click('nav.rail [role=tab] >> nth=2');
    const fade = await page.evaluate(() => getComputedStyle(document.querySelector('.pane-main > *')).animationName);
    await page.waitForTimeout(300);
    const still = await page.evaluate(() => document.documentElement.classList.contains('still'));
    ok(name + ': html.still is ' + wantStill, still === wantStill);
    ok(name + ': rail-tab hover transition ' + (wantHover ? 'runs' : 'is instant'), wantHover ? dur > 0 : dur === 0, String(dur));
    ok(name + ': a page switch ' + (wantHover ? 'fades in' : 'is instant'), wantHover ? fade === 'page-in' : fade === 'none', fade);
    ok(name + ': nothing keeps running after the page fade', (await page.evaluate(() => document.getAnimations().filter((x) => x.animationName === 'page-in').length)) === 0);
    ok(name + ': no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  };
  await motionCase('OS reduce + pref Full', { pref: 'full', media: 'reduce' }, false, true);
  await motionCase('OS reduce + pref System', { media: 'reduce' }, true, false);
  await motionCase('no OS preference + pref Reduced', { pref: 'reduced', media: 'no-preference' }, true, false);
  await motionCase('no OS preference + pref System', { media: 'no-preference' }, false, true);
  const noMotion = { ...THEMES[0], look: { ...THEMES[0].look, motion: 0 } };
  await motionCase('theme motion 0 + pref Full', { pref: 'full', media: 'no-preference', theme: noMotion }, true, false);

  // The Settings toggle drives it live.
  const { ctx, page } = await boot({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openTab(page, 'display');
  const radio = (label) => page.locator('[role=radiogroup][aria-labelledby=tp-motion] >> role=radio[name="' + label + '"]');
  await radio('Reduced').click();
  ok('Settings: Reduced sets html.still', await page.evaluate(() => document.documentElement.classList.contains('still')));
  ok('Settings: Reduced zeroes --t-move', (await css(page, '--t-move')) === '0ms', await css(page, '--t-move'));
  await radio('Full').click();
  ok('Settings: Full clears html.still', !(await page.evaluate(() => document.documentElement.classList.contains('still'))));
  ok('Settings: Full restores --t-move', ['200ms', '.2s'].includes(await css(page, '--t-move')), await css(page, '--t-move'));
  ok('Settings: the Rail hide tab switch is on by default', await page.isChecked('label:has-text("Rail hide tab") input'));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
