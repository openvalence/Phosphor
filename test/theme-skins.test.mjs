/**
 * theme-skins.test.mjs -- the per-theme kit (docs/THEMES.md, The test kit). One Theme is
 * checked against the shell bundle and a fake hub on the Dash, a category page, the funscript
 * player, the Log, the Link page and Settings, at 1428x900, 1024x768 and 420x860:
 *
 *   registry  every folder in src/themes/ is one registry line, ids and variants are well
 *             formed, every variant clears the engine's contrast floor
 *   lint      the theme's sheet never names the stop pair, the safety edge, the write ladder
 *             or the stale states, never a safety token; loads nothing remote; is scoped by
 *             html[data-style]; animates only transform and opacity, only under :not(.still)
 *   fit       no horizontal page scroll, no page error
 *   shift     the safety strip, the bar and the status row keep the default theme's heights,
 *             and hovering and focusing controls moves no box
 *   text      no text under WCAG AA that the shipped presets do not also have
 *   stop pair Pause and Halt are visible, at least 40 px, in AA text, with the default
 *             theme's hazard stripe and size
 *   reach     decoration never covers a control: the point at the center of every visible
 *             button hits that button
 *   motion    under reduced motion no theme animation runs
 *   picker    the Display pane lists the Theme with its swatch and its variants; F3 finds it
 *   material  (a Theme that asks the window for a material) the see-through look on the
 *             worst backdrops, an opaque body where the OS has none, fullscreen opaque
 *   dynamic   (the Material Theme) a fake system palette: contrast and the stop pair
 *
 * Run: node test/theme-skins.test.mjs --theme <id> [--shots <dir>] [--no-shots]
 *      node test/theme-skins.test.mjs             (every theme: the whole kit, minutes)
 *   Shots (the Dash and the funscript page at 1428x900, the Dash at 420x860) land in
 *   test/evidence/themes/ unless --shots names another directory.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { EVIDENCE } from './dist.mjs';
import { goTab } from './nav.mjs';
import { lowContrast, lowContrastOver } from './audit.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { THEMES, STYLES, deriveTokens, fromOklch } from '../src/model/theme.js';
import { paletteTheme } from '../src/model/dynamicColor.js';
import { ICON_NAMES } from '../src/ui/navIcons.js';

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const only = flag('--theme') || flag('--only');
const SHOTS = args.includes('--no-shots') ? null : (flag('--shots') || join(EVIDENCE, 'themes'));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (only && !STYLES.some((s) => s.id === only)) { console.error('no theme "' + only + '"; registered: ' + STYLES.map((s) => s.id).join(', ')); process.exit(2); }
// The Themes this run drives in a browser: the default style has no layer of its own.
const skins = STYLES.filter((s) => s.id !== 'phosphor' && (!only || s.id === only));

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

// ---- the registry and the sheets: text, no browser ----------------------------------
console.log('\n--- registry ---');
const DIR = fileURLToPath(new URL('../src/themes/', import.meta.url));
const folders = readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(DIR, e.name, 'manifest.js'))).map((e) => e.name);
const indexSrc = readFileSync(join(DIR, 'index.js'), 'utf8');
ok('every theme folder is one line of the registry, and no line is without a folder', folders.every((f) => new RegExp("^export \\{ default as \\w+ \\} from './" + f + "/manifest.js';$", 'm').test(indexSrc))
  && [...indexSrc.matchAll(/from '\.\/([\w-]+)\/manifest\.js'/g)].every((m) => folders.includes(m[1])) && STYLES.length === folders.length, folders.join(','));
ok('a folder holds a manifest, a stylesheet and an icon module', folders.every((f) => ['theme.css', 'icons.js'].every((x) => existsSync(join(DIR, f, x)))));
ok('theme ids are their folder names, once each', STYLES.every((s) => folders.includes(s.id)) && new Set(STYLES.map((s) => s.id)).size === STYLES.length);
ok('every Theme has a name, a pitch, a swatch and a first variant carrying its own id', STYLES.every((s) => s.name && s.pitch && s.swatch && s.variants.length >= 1
  && s.variants[0].id === s.id), STYLES.filter((s) => !(s.name && s.pitch && s.swatch && s.variants[0]?.id === s.id)).map((s) => s.id).join(','));
ok('variant ids are unique and a Theme\'s other variants are prefixed by its id', new Set(THEMES.map((t) => t.id)).size === THEMES.length
  && STYLES.every((s) => s.id === 'phosphor' || s.variants.slice(1).every((v) => v.id.startsWith(s.id + '-'))));
const names = new Set(ICON_NAMES);
ok('every icon a theme draws is a known registry name', STYLES.every((s) => Object.keys(s.icons || {}).every((n) => names.has(n))),
  STYLES.flatMap((s) => Object.keys(s.icons || {}).filter((n) => !names.has(n)).map((n) => s.id + '.' + n)).join(', '));
ok('no variant\'s accents sit on a safety hue', THEMES.every((t) => { const d = deriveTokens(t); return d.near.reality === undefined && d.near.intent === undefined; }),
  THEMES.filter((t) => { const d = deriveTokens(t); return d.near.reality || d.near.intent; }).map((t) => t.id).join(','));
const floorBad = THEMES.filter((t) => { const d = deriveTokens(t); return !(d.ratios.text >= 4.5 && d.ratios.reality >= 4.5 && d.ratios.labels >= 3); }).map((t) => t.id);
ok('every variant clears 4.5:1 for text and for reality on every surface, 3:1 for labels', floorBad.length === 0, floorBad.join(','));
// The old preset ids keep meaning the Phosphor Theme with that variant (the stored preference migrates by id).
ok('the old preset ids are Phosphor variants', ['phosphor', 'tracer', 'synth', 'ember', 'arctic', 'vapor', 'ultra', 'sakura', 'stealth', 'slate', 'ink', 'paper']
  .every((id) => THEMES.find((t) => t.id === id)?.style === 'phosphor'));

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
for (const s of STYLES.filter((x) => !only || x.id === only)) {
  const f = s.id + '/theme.css', id = s.id;
  const css = strip(readFileSync(join(DIR, f), 'utf8'));
  const hit = FORBID.filter((w) => css.replace(/:not\(\.(running|danger)\)/g, '').includes(w));
  ok(f + ': never names a stop, safety, ladder or stale surface', hit.length === 0, hit.join(', '));
  ok(f + ': loads nothing remote', !/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(css.replace(/xmlns=['"]http:\/\/www\.w3\.org\/2000\/svg['"]/g, '')) && !/@import\s+url\(\s*['"]?https?:/.test(css));
  if (id === 'phosphor') continue;
  const flat = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
  ok(f + ': every rule is scoped to its own theme', [...flat.matchAll(/(^|\})\s*([^{}@]+)\{/g)].every((m) => topLevel(m[2]).every((sel) => sel.trim().startsWith(':root[data-style="' + id + '"]')
    || sel.trim().startsWith('html:root[data-style="' + id + '"]'))), id);
  const kf = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
  ok(f + ': keyframes are named theme-' + id + '-* and move only transform and opacity', kf.every((m) => m[1].startsWith('theme-' + id + '-')
    && [...m[2].matchAll(/\{([^}]*)\}/g)].every((b) => b[1].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean)
      .every((p) => ['transform', 'opacity', 'translate', 'scale', 'rotate'].includes(p)))));
  const anim = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation(-name)?\s*:/g)].map((m) => m[1].trim());
  ok(f + ': every animation sits under :not(.still)', anim.every((x) => topLevel(x).every((y) => y.includes(':not(.still)') || y.includes(':not(.hivis)'))), anim.join(' | '));
  const fonts = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  ok(f + ': a font of its own is a file in its folder', fonts.every((b) => /url\(['"]?\.\/[^)'"]+\.woff2['"]?\)/.test(b) && !/url\(['"]?(https?:|\/\/)/.test(b)));
}

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
  return { overflow: document.documentElement.scrollWidth - innerWidth, pair, covered,
    chrome: ['.topstrip', '.strip', '.footstrip'].map((q) => Math.round(document.querySelector(q)?.getBoundingClientRect().height || 0)) };
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
      baseline.set(base + w + name, { low: new Set(r.low.map(sig)), pair: r.p.pair, covered: new Set(r.p.covered), overflow: r.p.overflow, chrome: r.p.chrome });
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
    const root = await page.evaluate(() => [document.documentElement.dataset.style, document.documentElement.dataset.theme]);
    ok(skin.id + ' ' + w + ': the root wears its theme', root[0] === skin.id && root[1] === skin.id, root.join('/'));
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
    // Shift: the bar, the strip and the status row keep the shipped heights, and hovering or
    // focusing a control moves no box.
    await goTab(page, 'machine');
    await page.waitForTimeout(450);
    const chrome = await page.evaluate(() => ['.topstrip', '.strip', '.footstrip'].map((s) => Math.round(document.querySelector(s)?.getBoundingClientRect().height || 0)));
    const bchrome = baseline.get((deriveTokens(theme).dark ? 'phosphor' : 'paper') + w + 'dash').chrome;
    ok(skin.id + ' ' + w + ': the top strip, the safety strip and the status row keep their heights', chrome.every((v, i) => Math.abs(v - bchrome[i]) <= 2), chrome.join('/') + ' vs ' + bchrome.join('/'));
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('.og-btn, [role=tab], .og-seg button, .stepper button, select, input')].filter((e) => e.getClientRects().length && !e.closest('.sr, [inert], .measure'));
      window.__els = els;
      window.__snap = () => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
      window.__before = window.__snap();
    });
    const centers = await page.evaluate(() => window.__els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })
      .filter(([x, y]) => x > 0 && y > 0 && x < innerWidth && y < innerHeight).filter((_, i) => i % 3 === 0).slice(0, 12));
    for (const [x, y] of centers) { await page.mouse.move(x, y); await page.waitForTimeout(50); }
    await page.mouse.move(2, 2);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    const moved = await page.evaluate(() => window.__snap().map((s, i) => (s.every((v, k) => Math.abs(v - window.__before[i][k]) <= 1) ? null : i + ':' + s.join(',') + ' was ' + window.__before[i].join(','))).filter(Boolean));
    ok(skin.id + ' ' + w + ': hovering and focusing move no box', moved.length === 0, moved.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // Motion: reduced, no skin animation runs; the page is otherwise the same.
  {
    const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, theme, { reduce: true });
    await page.waitForTimeout(600);
    const running = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter((n) => n && n.startsWith('theme-')));
    ok(skin.id + ': reduced motion runs no skin animation', running.length === 0, running.join(','));
    ok(skin.id + ' reduced: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // Picker: the Display pane lists it, with a swatch and its pitch.
  {
    const { ctx, page } = await boot({ width: 1428, height: 900 }, THEMES[0]);
    await goTab(page, 'shell:settings');
    await page.waitForTimeout(400);
    const sw = await page.$eval('[data-style-id="' + skin.id + '"]', (b) => ({ name: b.querySelector('.name').textContent.trim(), bg: getComputedStyle(b.querySelector('.chassis')).backgroundImage, tip: b.dataset.tip || '' }));
    ok(skin.id + ': the picker shows it with a swatch and its pitch', sw.name.toLowerCase() === skin.name.toLowerCase() && sw.bg !== 'none' && sw.tip.length > 8, JSON.stringify(sw));
    await page.keyboard.press('F3');
    await page.fill('.lf-q', skin.name);
    const hits = await page.$$eval('.lf-list li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
    ok(skin.id + ': F3 finds it', hits.some((t) => t.includes('Theme: ' + skin.name)), hits.slice(0, 4).join(' | '));
    await ctx.close();
  }
  // Variants: each other palette of the Theme reads as well as its own.
  for (const v of skin.variants.slice(1)) {
    const vt = THEMES.find((t) => t.id === v.id);
    const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, vt);
    const bad = [];
    for (const [name, id] of PAGES.filter(([n]) => ['dash', 'category', 'log'].includes(n))) {
      const r = await visit(page, id, name === 'dash' && SHOTS ? v.id + '-dash' : null);
      const base = baseline.get((deriveTokens(vt).dark ? 'phosphor' : 'paper') + 1428 + name);
      const worse = r.low.filter((s) => !base.low.has(sig(s)));
      if (worse.length) bad.push(name + ': ' + worse.slice(0, 3).join(' | '));
      if (name === 'dash') {
        const stop = await page.evaluate(lowContrast, '.safety-op .btn, .safety-op .btn *');
        if (stop.length || r.p.pair.some((b) => b.w < 40 || b.h < 40 || b.op !== '1')) bad.push('stop pair ' + stop.join(' | '));
      }
    }
    ok(v.id + ': the variant\'s text clears AA and its stop pair reads', bad.length === 0, bad.join(' || '));
    ok(v.id + ': no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // The picker shows the Theme's variants once it is active.
  if (skin.variants.length > 1) {
    const { ctx, page } = await boot({ width: 1428, height: 900 }, theme);
    await goTab(page, 'shell:settings');
    await page.waitForTimeout(400);
    const have = await page.$$eval('[data-theme-id]', (bs) => bs.map((b) => b.dataset.themeId));
    ok(skin.id + ': the Display pane lists its variants under it', skin.variants.every((v) => have.includes(v.id)), have.join(','));
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

// ---- dynamic: the Material Theme under a system palette (Android 12+, here a fake one) --------------
/** A tone ramp the way Android makes one: lightness falls with the tone, chroma peaks in the middle. */
const ramp = (hue, chroma) => Object.fromEntries([0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
  .map((t) => [t, fromOklch(1 - t / 1000 * 0.97, chroma * Math.sin(Math.PI * Math.min(1, Math.max(0.05, 1 - t / 1000))) ** 0.7, hue)]));
const fakePalette = (hue, chroma, night) => ({ accent1: ramp(hue, chroma), accent2: ramp(hue + 40, chroma * 0.4), accent3: ramp(hue + 80, chroma * 0.8),
  neutral1: ramp(hue, 0.012), neutral2: ramp(hue, 0.024), night });
for (const skin of skins.filter((s) => s.id === 'material')) {
  console.log('\n--- ' + skin.name + ': a system palette ---');
  for (const [hue, chroma, night] of [[300, 0.12, true], [150, 0.14, false], [25, 0.25, true], [80, 0.2, false]]) {
    const label = 'hue ' + hue + (night ? ' night' : ' day');
    const base = THEMES.find((t) => t.id === skin.id);
    const want = paletteTheme(base, fakePalette(hue, chroma, night));
    const ctx = await browser.newContext({ viewport: { width: 1428, height: 900 } });
    await ctx.addInitScript(TAURI_STUB);
    await ctx.addInitScript(([etag, bytes, theme, palette]) => {
      try {
        if (!sessionStorage.getItem('booted')) {
          sessionStorage.setItem('booted', '1');
          localStorage.clear();
          localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'skins fixture', nickname: '', lastSeen: Date.now() }]));
          localStorage.setItem('phosphor.theme', JSON.stringify(theme));
        }
        localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      } catch (e) { /* no storage */ }
      window.__phosphorSystemPalette = palette;
    }, [ETAG, Buffer.from(CAT).toString('hex'), base, fakePalette(hue, chroma, night)]);
    await ctx.routeWebSocket(/:82\//, fakeHub);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-tab-id="machine"]'), null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const got = await page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--reality').trim().toUpperCase(), document.documentElement.dataset.mdScheme || 'dark']);
    ok(label + ': the page takes the palette\'s primary', got[0] === want.theme.accents.reality.toUpperCase() && got[1] === (night ? 'dark' : 'light'), got.join(' ') + ' want ' + want.theme.accents.reality);
    const bad = [], pairs = [];
    for (const [name, id] of PAGES.filter(([n]) => ['dash', 'category', 'settings', 'log'].includes(n))) {
      const r = await visit(page, id, null);
      const b = baseline.get((night ? 'phosphor' : 'paper') + 1428 + name);
      const worse = r.low.filter((s) => !b.low.has(sig(s)));
      if (worse.length) bad.push(name + ': ' + worse.slice(0, 3).join(' | '));
      if (name === 'dash') {
        const stop = await page.evaluate(lowContrast, '.safety-op .btn, .safety-op .btn *');
        if (stop.length) pairs.push(stop.join(' | '));
        for (const [i, p] of r.p.pair.entries()) if (p.w < 40 || p.h < 40 || p.op !== '1' || p.bgi !== b.pair[i].bgi) pairs.push(p.label + ' changed');
      }
    }
    ok(label + ': text clears AA', bad.length === 0, bad.join(' || '));
    ok(label + ': the stop pair keeps its size, its stripe and its text', pairs.length === 0 && true, pairs.join(' | '));
    ok(label + ': no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
