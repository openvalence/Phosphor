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
 *             theme's hazard stripe and size; no rule of the sheet paints them or their
 *             ancestors (only its :root tokens reach them), nothing is drawn over them, and
 *             Windows High Contrast keeps their colors (forced-color-adjust: none)
 *   strip-btn Home required, Flip on and Override latched keep their safety borders under
 *             the Theme's face
 *   scrollbars the scrollbar preference shows and hides them under the Theme
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
import { THEMES, STYLES, deriveTokens, fromOklch, inkFloor, contrast, nearSafety, toOklch } from '../src/model/theme.js';
import { paletteTheme } from '../src/model/dynamicColor.js';
import { ICON_NAMES } from '../src/ui/navIcons.js';

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const only = flag('--theme') || flag('--only');
const PERF_ONLY = args.includes('--perf');
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
// The safety inks: 4.5:1 everywhere, or the Theme's own inkFloor (docs/THEMES.md, Safety).
const inkBad = THEMES.filter((t) => { const d = deriveTokens(t); return d.inkOn.some((s) => Object.values(d.ink).some((c) => contrast(c, s) < inkFloor(t.style))); })
  .map((t) => t.id + ' (' + inkFloor(t.style) + ':1)');
ok('every variant\'s safety inks clear its Theme\'s floor on every surface', inkBad.length === 0, inkBad.join(','));
// The Neutrino badge: the highlight on a dark chassis; on a light one a pink that reads 4.5:1 on every surface, clear of the safety hues.
const nuBad = THEMES.filter((t) => { const d = deriveTokens(t), v = d.base['--neutrino'];
  return d.dark ? v !== 'var(--highlight)' : !(d.inkOn.every((s) => contrast(v, s) >= 4.5) && !nearSafety(v) && Math.abs(((toOklch(v)[2] + 540) % 360) - 180) < 10); }).map((t) => t.id);
ok('every variant\'s Neutrino badge reads 4.5:1, pink on a light chassis', nuBad.length === 0, nuBad.join(','));
// html::before and ::after and body::before and ::after are the Themes' (docs/THEMES.md, Chrome hooks): the shell never draws there.
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ROOT_PSEUDO = /(^|[\s,}(>])(html|:root|body)(\[[^\]]*\]|\.[\w-]+|:not\([^)]*\))*::?(before|after)\b/;
const shellPseudo = readdirSync(SRC, { recursive: true }).map(String).filter((f) => /\.(svelte|css)$/.test(f) && !/^themes[\\/]/.test(f))
  .filter((f) => ROOT_PSEUDO.test(readFileSync(join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
ok('the shell leaves html::before/::after and body::before/::after to the Themes', shellPseudo.length === 0, shellPseudo.join(', '));
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
  '.evline', '.evtag', '.recovery', '.st-dismiss', '.run-btn', '.hold', '.holding', '.fx-', '--warn', '--bad', '--estop', '--glow-warn', 'danger', '.running',
  'unconfirmed', '.cat-busy', '.dash-busy'];
// A class is matched as a whole name (.hold is not .holder); the close prompt's own hold button may show its press.
const forbidden = (css) => {
  const c = css.replace(/:not\(\.(running|danger)\)/g, '').replace(/\.sb-hold\.holding/g, '');
  return FORBID.filter((w) => (/^\.[\w-]*\w$/.test(w) ? new RegExp('\\' + w + '(?![\\w-])').test(c) : c.includes(w)));
};
for (const s of STYLES.filter((x) => !only || x.id === only)) {
  const f = s.id + '/theme.css', id = s.id;
  const css = strip(readFileSync(join(DIR, f), 'utf8'));
  const hit = forbidden(css);
  ok(f + ': never names a stop, safety, ladder or stale surface', hit.length === 0, hit.join(', '));
  // Flip is a field: its ring is its ::after, and the strip-btn states win by !important (docs/THEMES.md, Parts).
  const sb = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes('strip-btn') && (/!important/.test(m[2]) || /::?after\b/.test(m[1])));
  ok(f + ': a strip-btn rule takes no ::after and no !important', sb.length === 0, sb.map((m) => m[1].trim().slice(0, 70)).join(' | '));
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

// Scrollbars drawn, as on the desktop: Playwright hides them by default, and a Theme may shape them (docs/THEMES.md, Chrome hooks).
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
async function boot(viewport, theme, { reduce = false, material = null, unlocked = [], on = browser, scrollbars = false } = {}) {
  const ctx = await on.newContext({ viewport, reducedMotion: reduce ? 'reduce' : 'no-preference' });
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
  await ctx.addInitScript(([etag, bytes, theme, unlocked, scrollbars]) => {
    try {
      if (!sessionStorage.getItem('booted')) {
        sessionStorage.setItem('booted', '1');
        localStorage.clear();
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'skins fixture', nickname: '', lastSeen: Date.now() }]));
        localStorage.setItem('phosphor.theme', JSON.stringify(theme));
        if (unlocked.length) localStorage.setItem('phosphor.theme.unlocked', JSON.stringify(unlocked));
        if (scrollbars) localStorage.setItem('phosphor.prefs', JSON.stringify({ scrollbars: true }));
      }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme, unlocked, scrollbars]);
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
  // The viewport inside the page's own scrollbars (the kit draws them).
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  for (const el of document.querySelectorAll('button:not([disabled]), a[href], input:not([type=hidden]), select, [role=tab]')) {
    if (!vis(el) || el.closest('.sr, .sr-only, [inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Scrolled out of an ancestor's box is not covered, it is clipped; the page's own pinned chrome is layout, not decoration.
    let clipped = false;
    for (let a = el.parentElement; a && !clipped; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      const b = a.getBoundingClientRect();
      clipped = x < b.left || x > b.right || y < b.top || y > b.bottom;
    }
    if (clipped || x < 0 || y < 0 || x > vw || y > vh) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit.closest('.footstrip, .page-foot, .topstrip, .hero-inner.popup, .hero-inner.quick, [popover]')) continue;
    if (!hit || !(el.contains(hit) || hit.contains(el) || (hit.closest('label') && hit.closest('label').contains(el)))) {
      covered.push((el.className || el.tagName) + ' <- ' + (hit ? (hit.className || hit.tagName) : 'nothing'));
    }
  }
  return { overflow: document.documentElement.scrollWidth - vw, pair, covered,
    chrome: ['.topstrip', '.strip', '.footstrip'].map((q) => Math.round(document.querySelector(q)?.getBoundingClientRect().height || 0)),
    // A Theme's --slider-fill on a field slider rides under the write ladder's four gradient layers, never instead of them.
    ladder: [...document.querySelectorAll('.field input[type=range]')].filter(vis).slice(0, 4).map((e) => {
      const cs = getComputedStyle(e);
      return cs.getPropertyValue('--slider-fill').trim() ? (cs.backgroundImage.match(/linear-gradient\(/g) || []).length : 4;
    }),
    // The scrollbar width of every scrolled [data-shade] box: 0 while the preference hides them.
    bars: [...document.querySelectorAll('[data-shade]')].filter((e) => e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1).map((e) => {
      const cs = getComputedStyle(e);
      return Math.round(e.offsetWidth - e.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth));
    }) };
};

/**
 * The stop pair against the shell's own paint (docs/THEMES.md, Safety): every paint property of Pause and Halt and
 * their insides, and every ancestor's opacity, filter and transform, read with the Theme's sheet and again with only
 * its :root rules (its tokens); any difference is a rule of the sheet reaching the pair. Then, with every element
 * hit-testable, what sits on top at five points of each: anything but the button is drawn over it.
 */
const pairGuard = () => {
  const OWN = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'box-shadow', 'outline-style',
    'outline-width', 'opacity', 'visibility', 'display', 'filter', 'transform', 'clip-path', 'mask-image', 'mix-blend-mode', 'text-shadow',
    'forced-color-adjust', 'fill', 'stroke', 'z-index'];
  const UP = ['opacity', 'filter', 'visibility', 'mix-blend-mode', 'transform', 'clip-path', 'mask-image'];
  const tag = (e) => e.tagName.toLowerCase() + '.' + String(e.className.baseVal ?? e.className).split(' ')[0];
  const btns = [...document.querySelectorAll('[data-part="stop-frame"] .safety-op .btn')];
  const name = (b) => (b.querySelector('.lbl')?.textContent || '').trim();
  const snap = () => {
    const out = [];
    for (const b of btns) {
      for (const e of [b, ...b.querySelectorAll('*')]) { const cs = getComputedStyle(e); for (const p of OWN) out.push([name(b) + ' ' + tag(e) + ' ' + p, cs.getPropertyValue(p)]); }
      for (let a = b.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); for (const p of UP) out.push([name(b) + ' under ' + tag(a) + ' ' + p, cs.getPropertyValue(p)]); }
    }
    return out;
  };
  const sheet = document.getElementById('themeSheet');
  const ROOT = /^(html)?:root(\[[^\]]+\]|:not\([^)]*\)|\.[\w-]+)*$/;
  const keep = (rules) => [...rules].map((r) => (r instanceof CSSStyleRule ? (r.selectorText.split(',').every((s) => ROOT.test(s.trim())) ? r.cssText : '')
    : r instanceof CSSMediaRule ? '@media ' + r.conditionText + '{' + keep(r.cssRules) + '}'
      : r instanceof CSSSupportsRule ? '@supports ' + r.conditionText + '{' + keep(r.cssRules) + '}' : '')).join('\n');
  const now = snap();
  const tmp = document.createElement('style');
  tmp.textContent = '*, *::before, *::after { transition: none !important; }\n' + (sheet && sheet.sheet ? keep(sheet.sheet.cssRules) : '');
  document.head.append(tmp);
  if (sheet) sheet.disabled = true;
  const shell = snap();
  if (sheet) sheet.disabled = false;
  // Back on, the sheet restarts its animations (a fade-in on the body): end the finite ones, as visit() does.
  for (const a of document.getAnimations()) if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish();
  tmp.remove();
  const paint = now.map(([k, v], i) => (shell[i][1] === v ? null : k + ' ' + v + ' (shell: ' + shell[i][1] + ')')).filter(Boolean);
  const pe = document.createElement('style');
  pe.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
  document.head.append(pe);
  const covered = [];
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    for (const [fx, fy] of [[.5, .5], [.25, .3], [.75, .3], [.25, .7], [.75, .7]]) {
      const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (!hit || !b.contains(hit)) covered.push(name(b) + ' at ' + fx + ',' + fy + ' <- ' + (hit ? tag(hit) : 'nothing'));
      // An ancestor on top is one of its pseudo-elements; anything else is an element of its own.
      if (hit && !b.contains(hit)) hit.dataset.kitCover = hit.contains(b) ? 'pseudo' : 'el';
    }
  }
  pe.remove();
  const rs = btns.map((b) => b.getBoundingClientRect());
  const box = rs.length ? { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)) } : null;
  if (box) Object.assign(box, { width: Math.max(...rs.map((r) => r.right)) - box.x, height: Math.max(...rs.map((r) => r.bottom)) - box.y });
  return { paint, covered, fca: btns.map((b) => getComputedStyle(b).forcedColorAdjust), n: btns.length, box };
};

/**
 * Hit-testing sees a box, not paint: a frame's transparent middle is on top without hiding anything. What it found
 * on top is hidden (an ancestor's pseudo-elements, or the element) and the pair's pixels compared, CSS animations
 * paused: the same pixels mean nothing visible was drawn over the pair.
 */
async function drawnOver(page, box) {
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const before = await page.screenshot({ clip: box });
  await page.evaluate(() => document.head.append(Object.assign(document.createElement('style'), { id: 'kit-hide',
    textContent: '[data-kit-cover="pseudo"]::before, [data-kit-cover="pseudo"]::after, [data-kit-cover="el"] { visibility: hidden !important; }' })));
  const after = await page.screenshot({ clip: box });
  await page.evaluate(() => {
    document.getElementById('kit-hide').remove();
    document.querySelectorAll('[data-kit-cover]').forEach((e) => e.removeAttribute('data-kit-cover'));
    document.getAnimations().forEach((a) => a.play());
  });
  return !before.equals(after);
};

/** Home required, Flip on and Override latched, forced by hand: each keeps its safety border under the Theme's face. */
const stripStates = () => {
  const want = (v) => { const p = document.createElement('i'); p.style.color = 'var(' + v + ')'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const cases = [
    ['Home required', '.dock [data-part="strip-btn"].btn:not(.btn-override)', 'class', 'hazard', '--bad'],
    ['Flip on', '.dock .rw-flip[data-part="strip-btn"]', 'aria-pressed', 'true', '--warn'],
    ['Override latched', '.dock .btn-override[data-part="strip-btn"]', 'class', 'latched', '--warn'],
  ];
  const bad = [], seen = [];
  for (const [label, sel, how, val, token] of cases) {
    for (const b of document.querySelectorAll(sel)) {
      if (!b.getClientRects().length) continue;
      const was = b.getAttribute('aria-pressed'), tr = b.style.transition;
      b.style.transition = 'none';
      if (how === 'class') b.classList.add(val); else b.setAttribute(how, val);
      const got = getComputedStyle(b).borderTopColor;
      if (how === 'class') b.classList.remove(val); else if (was == null) b.removeAttribute(how); else b.setAttribute(how, was);
      b.style.transition = tr;
      seen.push(label);
      if (got !== want(token)) bad.push(label + ' ' + got + ' not ' + token);
    }
  }
  return { bad, seen: [...new Set(seen)] };
};
const AUDIT = 'body :is(h1, h2, h3, p, span, label, button, a, li, td, th, output, summary, small, b, i, em, strong, div:not(#ph-tip), input, select, textarea)';

const baseline = new Map();   // viewport+page -> {fails:Set, pair}
const SCROLL_PAGES = ['dash', 'log', 'settings'];
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
for (const base of PERF_ONLY ? [] : ['phosphor', 'paper']) {
  for (const [w, h] of VIEWPORTS) {
    const { ctx, page, errors } = await boot({ width: w, height: h }, THEMES.find((t) => t.id === base));
    for (const [name, id] of PAGES) {
      const r = await visit(page, id);
      const guard = name === 'dash' ? await page.evaluate(pairGuard) : null;
      baseline.set(base + w + name, { low: new Set(r.low.map(sig)), pair: r.p.pair, covered: new Set(r.p.covered), overflow: r.p.overflow, chrome: r.p.chrome,
        pairCover: new Set(guard ? guard.covered : []) });
    }
    ok('baseline ' + base + ' ' + w + ': no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // The scrollbar preference on: what a Theme's scrollbars may not make worse.
  const { ctx, page } = await boot({ width: 1428, height: 900 }, THEMES.find((t) => t.id === base), { scrollbars: true });
  for (const [name, id] of PAGES.filter(([n]) => SCROLL_PAGES.includes(n))) baseline.set(base + 'bars' + name, (await visit(page, id)).p);
  await ctx.close();
}

for (const skin of PERF_ONLY ? [] : skins) {
  const theme = THEMES.find((t) => t.id === skin.id);
  console.log('\n--- ' + skin.name + ' (' + skin.id + ') ---');
  for (const [w, h] of VIEWPORTS) {
    const { ctx, page, errors } = await boot({ width: w, height: h }, theme);
    const root = await page.evaluate(() => [document.documentElement.dataset.style, document.documentElement.dataset.theme]);
    ok(skin.id + ' ' + w + ': the root wears its theme', root[0] === skin.id && root[1] === skin.id, root.join('/'));
    const fitBad = [], textBad = [], pairBad = [], coverBad = [], ladderBad = [], barBad = [];
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
        const g = await page.evaluate(pairGuard);
        if (!g.n) pairBad.push('no stop pair in the stop-frame');
        if (g.paint.length) pairBad.push('painted by the sheet: ' + g.paint.slice(0, 3).join(' | '));
        const over = g.covered.filter((c) => !base.pairCover.has(c));
        if (over.length && await drawnOver(page, g.box)) pairBad.push('drawn over: ' + over.slice(0, 3).join(' | '));
        else await page.evaluate(() => document.querySelectorAll('[data-kit-cover]').forEach((e) => e.removeAttribute('data-kit-cover')));
        if (g.fca.some((v) => v !== 'none')) pairBad.push('forced-color-adjust ' + g.fca.join(','));
        // Windows High Contrast: the pair keeps its stripe and its text reads.
        await page.emulateMedia({ forcedColors: 'active' });
        const hc = await page.evaluate(() => [...document.querySelectorAll('[data-part="stop-frame"] .safety-op .btn')].map((b) => getComputedStyle(b).backgroundImage));
        const hcLow = await page.evaluate(lowContrast, '[data-part="stop-frame"] .safety-op .btn, [data-part="stop-frame"] .safety-op .btn *');
        await page.emulateMedia({ forcedColors: 'none' });
        const halt = r.p.pair.at(-1);
        if (hc.at(-1) !== halt.bgi) pairBad.push('high contrast drops the stripe');
        if (hcLow.length) pairBad.push('high contrast text ' + hcLow.slice(0, 2).join(' | '));
        if (w === 1428) {
          const s = await page.evaluate(stripStates);
          ok(skin.id + ': the strip buttons keep their safety borders (' + (s.seen.join(', ') || 'none in the fixture') + ')', s.bad.length === 0, s.bad.join(' | '));
        }
      }
      if (r.p.ladder.some((n) => n < 4)) ladderBad.push(name + ' ' + r.p.ladder.join(','));
      if (r.p.bars.some((v) => v > 0)) barBad.push(name + ' ' + r.p.bars.join(','));
      const newCover = r.p.covered.filter((c) => !base.covered.has(c));
      if (newCover.length) coverBad.push(name + ': ' + newCover.slice(0, 3).join(' | '));
    }
    ok(skin.id + ' ' + w + ': no horizontal scroll on any page', fitBad.length === 0, fitBad.join(', '));
    ok(skin.id + ' ' + w + ': no text under AA the default theme lacks', textBad.length === 0, textBad.join(' || '));
    ok(skin.id + ' ' + w + ': the stop pair is visible, 40 px, AA, with its hazard stripe', pairBad.length === 0, pairBad.join(', '));
    ok(skin.id + ' ' + w + ': decoration covers no control', coverBad.length === 0, coverBad.join(' || '));
    ok(skin.id + ' ' + w + ': a slider fill keeps the write ladder\'s line', ladderBad.length === 0, ladderBad.join(' | '));
    ok(skin.id + ' ' + w + ': scrollbars stay hidden while the preference is off', barBad.length === 0, barBad.join(' | '));
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
  // Scrollbars: the preference on shows them, shaped by the Theme, and they push nothing across.
  {
    const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, theme, { scrollbars: true });
    const bad = [];
    for (const [name, id] of PAGES.filter(([n]) => SCROLL_PAGES.includes(n))) {
      const r = await visit(page, id, SHOTS && name === 'log' ? skin.id + '-scrollbars' : null);
      const base = baseline.get((deriveTokens(theme).dark ? 'phosphor' : 'paper') + 'bars' + name);
      if (r.p.overflow > Math.max(1, base.overflow + 1)) bad.push(name + ' +' + r.p.overflow + ' px across');
      if (r.p.bars.length && !r.p.bars.some((v) => v > 0)) bad.push(name + ' shows no scrollbar');
    }
    ok(skin.id + ': the scrollbar preference shows them and they push nothing across', bad.length === 0, bad.join(' | '));
    ok(skin.id + ' scrollbars: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
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
  // Picker: the Display pane lists it, with a swatch and its pitch. A hidden Theme is absent until found
  // (docs/THEMES.md, Hidden themes), then listed like any other.
  if (skin.hidden) {
    const { ctx, page } = await boot({ width: 1428, height: 900 }, THEMES[0]);
    await goTab(page, 'shell:settings');
    await page.waitForTimeout(400);
    ok(skin.id + ': hidden, the picker leaves it out until it is found', !(await page.$('[data-style-id="' + skin.id + '"]')));
    await ctx.close();
  }
  {
    const { ctx, page } = await boot({ width: 1428, height: 900 }, THEMES[0], { unlocked: skin.hidden ? [skin.id] : [] });
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
for (const skin of (PERF_ONLY ? [] : skins).filter((s) => s.material)) {
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
for (const skin of (PERF_ONLY ? [] : skins).filter((s) => s.id === 'material')) {
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

// ---- perf: the operator's two stress cases in a 4K window, against Phosphor in the same run ---------------
// Frame times are requestAnimationFrame intervals in a GPU-composited Chromium window; the budget is relative,
// so the host's speed cancels. A p95 floor of one 60 Hz frame keeps a single missed vsync at a high refresh rate
// from failing a Theme. docs/THEMES.md, Performance.
const PERF = { w: 3840, h: 2160, ms: 2000, ratio: 1.5, floor: 1000 / 60, layers: 3 };
const gpuArgs = ['--ignore-gpu-blocklist', '--window-size=' + PERF.w + ',' + PERF.h];
const gpu = args.includes('--no-perf') ? null : await chromium.launch({ channel: 'chromium', args: gpuArgs }).catch(() => chromium.launch({ args: gpuArgs }));
/** One Theme: drag a Dash card in edit mode (a CDP press on its grip, then one pointermove per frame), then resize the window. */
async function perfRun(theme, unlocked) {
  const { ctx, page } = await boot(null, theme, { on: gpu, unlocked });
  const p95 = (run) => page.evaluate(() => { window.__f = []; const t = (ts) => { window.__f.push(ts); window.__raf = requestAnimationFrame(t); }; window.__raf = requestAnimationFrame(t); })
    .then(run).then(() => page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__f; }))
    .then((ts) => { const d = ts.slice(3).map((t, i) => t - ts[i + 2]).sort((a, b) => a - b); return { p95: +d[Math.floor(d.length * .95)].toFixed(1), fps: +(d.length * 1000 / (ts.at(-1) - ts[2])).toFixed(1) }; });
  await page.locator('button[data-tip="Edit layout"]:visible').first().click();
  await page.waitForSelector('.dash-toolbar');
  await page.locator('.dash-toolbar .palette-toggle').click().catch(() => {});
  await page.waitForTimeout(400);
  const b = await page.locator('.home > .dash-wrap > .dash-grid > .dash-cell .handle.grab').first().boundingBox();
  const g = await page.locator('.home > .dash-wrap > .dash-grid').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const drag = await p95(() => page.evaluate(([gx, gy, gw, gh, ms]) => new Promise((done) => {
    const grip = document.querySelector('.dash-item.dragging .handle.grab');
    let i = 0;
    const end = performance.now() + ms;
    const step = (ts) => {
      if (ts > end || !grip) return done();
      const t = i++ / 40;
      grip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, isPrimary: true, pointerType: 'mouse', buttons: 1, bubbles: true,
        clientX: gx + gw * (0.45 + 0.3 * Math.sin(t)), clientY: gy + 60 + Math.min(gh, 1200) * 0.3 * (1 - Math.cos(t * 0.7)) }));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), [g.x, g.y, g.width, g.height, PERF.ms]));
  const cdp = await ctx.newCDPSession(page);
  const tree = new Promise((r) => cdp.on('LayerTree.layerTreeDidChange', (e) => e.layers && r(e.layers.length)));
  await cdp.send('LayerTree.enable');
  await page.evaluate(() => { document.body.style.outlineOffset = '0.01px'; });
  const layers = await Promise.race([tree, new Promise((r) => setTimeout(() => r(-1), 3000))]);
  await cdp.send('LayerTree.disable');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(300);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  const resize = await p95(async () => {
    for (let i = 0, end = Date.now() + PERF.ms; Date.now() < end; i++) {
      const j = 20 - Math.abs(20 - (i % 40));
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: PERF.w - 12 * j, height: PERF.h - 6 * j } });
      await new Promise((r) => setTimeout(r, 4));
    }
  });
  await ctx.close();
  return { drag, resize, layers };
}
if (gpu) {
  console.log('\n--- perf: drag and resize at ' + PERF.w + 'x' + PERF.h + ' ---');
  const row = (id, r) => console.log('  ' + id.padEnd(12) + ' drag ' + String(r.drag.fps).padStart(6) + ' fps p95 ' + String(r.drag.p95).padStart(5)
    + ' ms | resize ' + String(r.resize.fps).padStart(6) + ' fps p95 ' + String(r.resize.p95).padStart(5) + ' ms | ' + r.layers + ' layers');
  const phos = THEMES.find((t) => t.id === 'phosphor');
  const base = [await perfRun(phos)];
  row('phosphor', base[0]);
  const runs = [];
  for (const skin of skins) {
    const run = () => perfRun(THEMES.find((t) => t.id === skin.id), skin.hidden ? [skin.id] : []);
    runs.push([skin, await run(), run]);
    row(skin.id, runs.at(-1)[1]);
  }
  // Phosphor again at the end: the slower of the two readings is the baseline, so a host that warms or throttles mid-run fails nothing.
  base.push(await perfRun(phos));
  row('phosphor', base[1]);
  const cap = (k) => Math.max(PERF.floor, PERF.ratio * Math.max(...base.map((b) => b[k].p95)));
  const layerCap = Math.round(PERF.layers * Math.max(...base.map((b) => b.layers)));
  const over = (r) => r.drag.p95 > cap('drag') || r.resize.p95 > cap('resize');
  for (let [skin, r, run] of runs) {
    // One retry: a p95 over 2 s is a handful of frames, and a background hiccup is not the Theme's.
    if (over(r)) { const again = await run(); if (!over(again)) r = again; }
    ok(skin.id + ': dragging a card holds p95 within ' + PERF.ratio + 'x Phosphor', r.drag.p95 <= cap('drag'), r.drag.p95 + ' ms vs ' + cap('drag').toFixed(1));
    ok(skin.id + ': resizing the window holds p95 within ' + PERF.ratio + 'x Phosphor', r.resize.p95 <= cap('resize'), r.resize.p95 + ' ms vs ' + cap('resize').toFixed(1));
    ok(skin.id + ': at most ' + layerCap + ' composited layers', r.layers > 0 && r.layers <= layerCap, String(r.layers));
  }
  await gpu.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
