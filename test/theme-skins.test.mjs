/**
 * theme-skins.test.mjs -- the skins (docs/THEMES.md, Skins) on the shell bundle
 * against a fake hub: every skin on the Dash, a category page, the funscript
 * player, the Log, the Link page and Settings, at 1428x900, 1024x768 and 420x860.
 *
 *   lint      the skin sheets never name the stop pair, the safety edge, the
 *             write ladder, the stale states or a safety token; load nothing
 *             remote; animate only transform and opacity, only under
 *             :not(.still); and every manifest icon name exists
 *   fit       no horizontal page scroll, no page error
 *   text      no text under WCAG AA that the default theme does not also have
 *   stop pair Pause and Halt are visible, at least 40 px, in AA text, with the
 *             default theme's hazard stripe and size
 *   reach     decoration never covers a control: the point at the center of
 *             every visible button hits that button
 *   motion    under reduced motion no skin animation runs
 *   picker    the Display pane lists the skin with its swatch
 *
 * Build first (`npm run build:only` is not needed: this builds the shell bundle).
 * Run: node test/theme-skins.test.mjs [--only <skin>] [--shots <dir>] [--no-shots]
 *   Shots (the Dash and the funscript page at 1428x900, the Dash at 420x860) land in
 *   test/evidence/themes/ unless --shots names another directory.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { EVIDENCE } from './dist.mjs';
import { goTab } from './nav.mjs';
import { lowContrast, lowContrastOver } from './audit.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { THEMES, deriveTokens, contrast } from '../src/model/theme.js';
import { SKINS } from '../src/themes/manifest.js';
import { ICON_NAMES } from '../src/ui/navIcons.js';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const SHOTS = args.includes('--no-shots') ? null : (args.includes('--shots') ? args[args.indexOf('--shots') + 1] : join(EVIDENCE, 'themes'));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const skins = SKINS.filter((s) => !only || s.id === only);

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

// ---- lint: the sheets are text, no browser ---------------------------------------
console.log('\n--- skin sheets ---');
const DIR = fileURLToPath(new URL('../src/themes/', import.meta.url));
const sheets = readdirSync(DIR).filter((f) => f.endsWith('.css'));
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** A selector list split at its top-level commas: :is(a, b) stays whole. */
const topLevel = (s) => {
  const out = [];
  let d = 0, cur = '';
  for (const c of s) {
    if (c === '(') d++;
    if (c === ')') d--;
    if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
};
const FORBID = ['.safety-op', '.btn-estop', '.btn-pause', '.btn-override', '.latched', '[data-shadow', '.stale', '.field::after', '.hazard',
  '.evline', '.evtag', '.recovery', '.st-dismiss', '.run-btn', '.hold', '.fx-', '--warn', '--bad', '--estop', '--glow-warn', 'danger', '.running',
  'unconfirmed', '.cat-busy', '.dash-busy'];
for (const f of sheets) {
  const css = strip(readFileSync(join(DIR, f), 'utf8'));
  const hit = FORBID.filter((w) => css.replace(/:not\(\.(running|danger)\)/g, '').includes(w));
  ok(f + ': never names a stop, safety, ladder or stale surface', hit.length === 0, hit.join(', '));
  ok(f + ': loads nothing remote', !/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(css.replace(/xmlns=['"]http:\/\/www\.w3\.org\/2000\/svg['"]/g, '')) && !/@import\s+url\(\s*['"]?https?:/.test(css));
  if (f === 'skins.css' || f === 'fonts.css') continue;
  const id = f.replace(/\.css$/, '');
  const flat = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  ok(f + ': every rule is scoped to its own skin', [...flat.matchAll(/(^|\})\s*([^{}@]+)\{/g)].every((m) => topLevel(m[2]).every((sel) => sel.trim().startsWith(':root[data-skin="' + id + '"]')
    || sel.trim().startsWith('html:root[data-skin="' + id + '"]'))), id);
  const kf = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
  ok(f + ': keyframes are named skin-' + id + '-* and move only transform and opacity', kf.every((m) => m[1].startsWith('skin-' + id + '-')
    && [...m[2].matchAll(/\{([^}]*)\}/g)].every((b) => b[1].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean)
      .every((p) => ['transform', 'opacity', 'translate', 'scale', 'rotate'].includes(p)))));
  const anim = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation(-name)?\s*:/g)].map((m) => m[1].trim());
  ok(f + ': every animation sits under :not(.still)', anim.every((s) => topLevel(s).every((x) => x.includes(':not(.still)') || x.includes(':not(.hivis)'))), anim.join(' | '));
}
const names = new Set(ICON_NAMES);
ok('every manifest icon is a known name', SKINS.every((s) => Object.keys(s.icons || {}).every((n) => names.has(n))),
  SKINS.flatMap((s) => Object.keys(s.icons || {}).filter((n) => !names.has(n)).map((n) => s.id + '.' + n)).join(', '));
ok('every skin has a stylesheet', SKINS.every((s) => sheets.includes(s.id + '.css')), SKINS.filter((s) => !sheets.includes(s.id + '.css')).map((s) => s.id).join(', '));
ok('every skin is a preset with its own skin id', SKINS.every((s) => { const p = THEMES.find((t) => t.id === s.id); return p && p.skin === s.id && p.name === s.name; }));
ok('no skin sets a safety hue as an accent', SKINS.every((s) => deriveTokens(THEMES.find((t) => t.id === s.id)).near.reality === undefined
  && deriveTokens(THEMES.find((t) => t.id === s.id)).near.intent === undefined));
const light = (s) => !deriveTokens(THEMES.find((t) => t.id === s.id)).dark;
ok('every skin chassis clears 4.5:1 for text and reality on every surface', SKINS.every((s) => {
  const d = deriveTokens(THEMES.find((t) => t.id === s.id));
  return d.ratios.text >= 4.5 && d.ratios.reality >= 4.5 && d.ratios.labels >= 3;
}), SKINS.map((s) => s.id + ' ' + JSON.stringify(deriveTokens(THEMES.find((t) => t.id === s.id)).ratios)).join('; '));
void light; void contrast;

// ---- the fake hub and the shell bundle ---------------------------------------------
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
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
            [IDENTITY_K.hub_name, cbTstr('skins fixture')]])],
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
async function boot(viewport, theme, { reduce = false, material = null } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(TAURI_STUB);
  // A shell whose Rust half has the material: window_material answers what was asked, and every call is kept.
  if (material) {
    await ctx.addInitScript((granted) => {
      const inner = window.__TAURI_INTERNALS__.invoke;
      window.__materialCalls = [];
      window.__TAURI_INTERNALS__.invoke = (cmd, a) => (cmd === 'window_material'
        ? (window.__materialCalls.push(a.kind), Promise.resolve(a.kind === 'none' ? 'none' : granted)) : inner(cmd, a));
    }, material);
  }
  await ctx.addInitScript(([etag, bytes, theme]) => {
    try {
      if (!sessionStorage.getItem('booted')) {
        sessionStorage.setItem('booted', '1');
        localStorage.clear();
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'skins fixture', nickname: '', lastSeen: Date.now() }]));
        localStorage.setItem('phosphor.theme', JSON.stringify(theme));
      }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-tab-id="machine"]') || document.querySelector('.menu-btn'), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

const VIEWPORTS = [[1428, 900], [1024, 768], [420, 860]];
const PAGES = [
  ['dash', 'machine'], ['category', 'cat1'], ['funscript', 'plugin:funscript-player:player'],
  ['log', 'log'], ['link', 'valence'], ['settings', 'shell:settings'],
];

/** The things a page is checked for, read in-page. */
const probe = () => {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility === 'visible' && cs.display !== 'none' && r.width > 0 && r.height > 0; };
  const pair = [...document.querySelectorAll('.safety-op .btn')].filter(vis).map((b) => {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { label: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 14), w: Math.round(r.width), h: Math.round(r.height), op: cs.opacity, bgi: cs.backgroundImage };
  });
  const covered = [];
  for (const el of document.querySelectorAll('button:not([disabled]), a[href], input:not([type=hidden]), select, [role=tab]')) {
    if (!vis(el) || el.closest('.sr, .sr-only, [inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Scrolled out of an ancestor's box is not covered, it is clipped; the page's own pinned chrome is layout, not decoration.
    let clipped = false;
    for (let a = el.parentElement; a && !clipped; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      clipped = x < b.left || x > b.right || y < b.top || y > b.bottom;
    }
    if (clipped || x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit.closest('.footstrip, .page-foot, .topstrip, .hero-inner.popup, .hero-inner.quick, [popover]')) continue;
    if (!hit || !(el.contains(hit) || hit.contains(el) || (hit.closest('label') && hit.closest('label').contains(el)))) {
      covered.push((el.className || el.tagName) + ' <- ' + (hit ? (hit.className || hit.tagName) : 'nothing'));
    }
  }
  return { overflow: document.documentElement.scrollWidth - innerWidth, pair, covered };
};
const AUDIT = 'body :is(h1, h2, h3, p, span, label, button, a, li, td, th, output, summary, small, b, i, em, strong, div:not(#ph-tip), input, select, textarea)';

const baseline = new Map();   // viewport+page -> {fails:Set, pair}
async function visit(page, id, shot) {
  await goTab(page, id);
  await page.waitForTimeout(450);
  // A row fading in or a pane sliding is mid-flight, not a color: let every finite animation end before reading.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(100);
  const p = await page.evaluate(probe);
  const low = await page.evaluate(lowContrast, AUDIT);
  if (shot && SHOTS) await page.screenshot({ path: join(SHOTS, shot + '.png') });
  return { p, low };
}
// A failure's identity is its element class: a label under AA in the shipped presets (a dim chip name, a hex readout) stays exempt whatever its text.
const sig = (s) => s.replace(/ ".*$/, '');

// The shipped presets' reading of every page, Phosphor for a dark chassis and Paper for a light one:
// what a skin may not make worse.
console.log('\n--- baseline: Phosphor and Paper ---');
for (const base of ['phosphor', 'paper']) {
  for (const [w, h] of VIEWPORTS) {
    const { ctx, page, errors } = await boot({ width: w, height: h }, THEMES.find((t) => t.id === base));
    for (const [name, id] of PAGES) {
      const r = await visit(page, id);
      baseline.set(base + w + name, { low: new Set(r.low.map(sig)), pair: r.p.pair, covered: new Set(r.p.covered), overflow: r.p.overflow });
    }
    ok('baseline ' + base + ' ' + w + ': no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

for (const skin of skins) {
  const theme = THEMES.find((t) => t.id === skin.id);
  console.log('\n--- ' + skin.name + ' (' + skin.id + ') ---');
  for (const [w, h] of VIEWPORTS) {
    const { ctx, page, errors } = await boot({ width: w, height: h }, theme);
    const root = await page.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.theme]);
    ok(skin.id + ' ' + w + ': the root wears its skin', root[0] === skin.id && root[1] === skin.id, root.join('/'));
    const fitBad = [], textBad = [], pairBad = [], coverBad = [];
    for (const [name, id] of PAGES) {
      const shot = SHOTS && w === 1428 && ['dash', 'funscript'].includes(name) ? skin.id + '-' + name
        : SHOTS && w === 420 && name === 'dash' ? skin.id + '-phone' : null;
      const r = await visit(page, id, shot);
      const base = baseline.get((deriveTokens(theme).dark ? 'phosphor' : 'paper') + w + name);
      // The shipped presets overshoot 2 px on the Dash at 420 (the depth tag of the Pattern card); a skin may not add to it.
      if (r.p.overflow > Math.max(1, base.overflow + 1)) fitBad.push(name + ' +' + r.p.overflow);
      const worse = r.low.filter((s) => !base.low.has(sig(s)));
      if (worse.length) textBad.push(name + ': ' + worse.slice(0, 3).join(' | '));
      if (name === 'dash') {
        const labels = r.p.pair.map((b) => b.label).join(',');
        if (labels !== base.pair.map((b) => b.label).join(',') || !r.p.pair.length) pairBad.push('labels ' + labels);
        for (const [i, b] of r.p.pair.entries()) {
          const d = base.pair[i];
          if (b.w < 40 || b.h < 40 || Math.abs(b.w - d.w) > 2 || Math.abs(b.h - d.h) > 2 || b.op !== '1') pairBad.push(b.label + ' ' + b.w + 'x' + b.h + ' op ' + b.op);
          if (b.bgi !== d.bgi) pairBad.push(b.label + ' hazard stripe changed');
        }
        const stop = await page.evaluate(lowContrast, '.safety-op .btn, .safety-op .btn *');
        if (stop.length) pairBad.push('text ' + stop.join(' | '));
      }
      const newCover = r.p.covered.filter((c) => !base.covered.has(c));
      if (newCover.length) coverBad.push(name + ': ' + newCover.slice(0, 3).join(' | '));
    }
    ok(skin.id + ' ' + w + ': no horizontal scroll on any page', fitBad.length === 0, fitBad.join(', '));
    ok(skin.id + ' ' + w + ': no text under AA the default theme lacks', textBad.length === 0, textBad.join(' || '));
    ok(skin.id + ' ' + w + ': the stop pair is visible, 40 px, AA, with its hazard stripe', pairBad.length === 0, pairBad.join(', '));
    ok(skin.id + ' ' + w + ': decoration covers no control', coverBad.length === 0, coverBad.join(' || '));
    ok(skin.id + ' ' + w + ': no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // Motion: reduced, no skin animation runs; the page is otherwise the same.
  {
    const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, theme, { reduce: true });
    await page.waitForTimeout(600);
    const running = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter((n) => n && n.startsWith('skin-')));
    ok(skin.id + ': reduced motion runs no skin animation', running.length === 0, running.join(','));
    ok(skin.id + ' reduced: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // Picker: the Display pane lists it, with a swatch and its pitch.
  {
    const { ctx, page } = await boot({ width: 1428, height: 900 }, THEMES[0]);
    await goTab(page, 'shell:settings');
    await page.waitForTimeout(400);
    const sw = await page.$eval('[data-theme-id="' + skin.id + '"]', (b) => ({ name: b.querySelector('.name').textContent.trim(), bg: getComputedStyle(b.querySelector('.chassis')).backgroundImage, tip: b.dataset.tip || '' }));
    ok(skin.id + ': the picker shows it with a swatch and its pitch', sw.name.toLowerCase() === skin.name.toLowerCase() && sw.bg !== 'none' && sw.tip.length > 8, JSON.stringify(sw));
    await page.keyboard.press('F3');
    await page.fill('.lf-q', skin.name);
    const hits = await page.$$eval('.lf-list li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
    ok(skin.id + ': F3 finds it', hits.some((t) => t.includes('Theme: ' + skin.name)), hits.slice(0, 4).join(' | '));
    await ctx.close();
  }
}

// ---- materials: the see-through look on the worst backdrops, and what takes it away --------------
for (const skin of skins.filter((s) => s.material)) {
  console.log('\n--- ' + skin.name + ': materials ---');
  const theme = THEMES.find((t) => t.id === skin.id);
  // Windows 10, Linux, Android, the browser: the Rust half answers none, and the look stays opaque.
  {
    const { ctx, page } = await boot({ width: 1428, height: 900 }, theme);
    await page.waitForTimeout(500);
    const o = await page.evaluate(() => [document.documentElement.dataset.material || null, getComputedStyle(document.body).backgroundColor]);
    ok(skin.id + ': no OS material (the stub refuses) keeps an opaque body', o[0] === null && /^rgb\(/.test(o[1]), JSON.stringify(o));
    await ctx.close();
  }
  const granted = skin.material === 'mica' ? 'mica' : 'acrylic';
  const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, theme, { material: granted });
  await page.waitForTimeout(600);
  ok(skin.id + ': the page asked the window for ' + skin.material, await page.evaluate((k) => window.__materialCalls.includes(k), skin.material));
  ok(skin.id + ': the root says what it got', await page.evaluate(() => document.documentElement.dataset.material) === granted);
  ok(skin.id + ': the page and body are clear for the material', await page.evaluate(() => /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(document.body).backgroundColor)
    && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(document.documentElement).backgroundColor)));
  // Text over the worst backdrops: Mica forced dark never reads lighter than #3A3A3A; glass takes white too.
  const backdrops = skin.material === 'mica' ? [[0, 0, 0], [58, 58, 58]] : [[0, 0, 0], [255, 255, 255]];
  for (const bd of backdrops) {
    await page.evaluate((c) => document.documentElement.style.setProperty('background', 'rgb(' + c.join(',') + ')', 'important'), bd);
    const bad = [];
    for (const [name, id] of PAGES.filter(([n]) => ['dash', 'category', 'settings', 'log', 'link'].includes(n))) {
      await goTab(page, id);
      await page.waitForTimeout(450);
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
      const low = await page.evaluate(lowContrastOver, [AUDIT, bd]);
      const exempt = baseline.get('phosphor1428' + name).low;
      const worse = low.filter((s) => !exempt.has(sig(s)));
      if (worse.length) bad.push(name + ': ' + worse.slice(0, 3).join(' | '));
    }
    ok(skin.id + ': text clears AA over rgb(' + bd.join(',') + ') on every page', bad.length === 0, bad.join(' || '));
    if (SHOTS) { await goTab(page, 'machine'); await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, skin.id + '-over-' + bd.join('-') + '.png') }); }
  }
  await page.evaluate(() => document.documentElement.style.removeProperty('background'));
  await goTab(page, 'machine');
  await page.waitForTimeout(300);
  const pairOpaque = await page.evaluate(() => {
    const f = document.querySelector('[data-part="stop-frame"]');
    const a = (c) => { const m = /(?:rgba?|color\(srgb)\(?([^)]+)\)/.exec(c); const p = m[1].split(/[\s,/]+/).map(Number); return p.length > 3 ? p[3] : 1; };
    return [a(getComputedStyle(f).backgroundColor), ...[...f.querySelectorAll('.safety-op .btn')].map((b) => Number(getComputedStyle(b).opacity))];
  });
  ok(skin.id + ': the stop pair sits on an opaque plate and is itself opaque', pairOpaque.length === 3 && pairOpaque.every((v) => v === 1), pairOpaque.join(','));
  // A fullscreen page takes the material away and gives it back.
  await goTab(page, 'plugin:funscript-player:player');
  await page.waitForTimeout(400);
  await page.keyboard.press('F11');
  await page.waitForTimeout(500);
  const inFull = await page.evaluate(() => [document.documentElement.hasAttribute('data-page-full'), document.documentElement.dataset.material || null, window.__materialCalls.at(-1)]);
  ok(skin.id + ': a fullscreen page drops the material for an opaque window', inFull[0] && inFull[1] === null && inFull[2] === 'none', JSON.stringify(inFull));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => [document.documentElement.hasAttribute('data-page-full'), document.documentElement.dataset.material || null]);
  ok(skin.id + ': leaving fullscreen brings it back', !out[0] && out[1] === granted, JSON.stringify(out));
  ok(skin.id + ' materials: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
