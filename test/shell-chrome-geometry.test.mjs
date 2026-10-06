/**
 * shell-chrome-geometry.test.mjs -- does the top strip stack flush (T22)?
 *
 * One strip (ui/TopStrip.svelte) holds the top bar and the strip and sits in
 * flow, sticky at top 0, so there is no reserve to double-count. The shell
 * adds no row: its window buttons end the top bar (ph-e82.17).
 *
 * Fixed heights (ph-e82.17), against a fake hub on the recorded valencesim
 * catalog, at 1440x900 and 390x844: the bar and the strip keep their height
 * with a long hub name, with a refusal in the status slot and with a long
 * fault reason; the rail row and the rail below it hold across the swap to
 * the plan strip while a pattern runs, and back; the rail panel is the rail
 * row plus the rail, no help lines (ph-i0y). ph-e82.21, same two sizes: the
 * rail row's and the strip's boxes hold still in every one of 30 frames
 * across pause, resume, pattern start and pattern stop, and the swap only
 * flips visibility (both faces stay mounted). At 1920, 1440, 1280, 1024, 800
 * and 390 every strip control's right edge is inside the viewport, nothing
 * in the strip scrolls sideways, and a collapsed Home control opens its
 * popover on screen without moving the strip (ph-b5d); the e-stop is
 * outermost, then Pause, Override, Flip and Home inward; the numeral's glow
 * box (its ink box grown by one standard deviation of the strong glow
 * layer, half its blur radius) is inside the strip and inside its clip; the
 * jog tape and the ruler share left and right edges, border and inner box
 * (ph-e82.21). At the RENDERING 12.1 floor (rclass.js FLOOR_W x FLOOR_H,
 * which tauri.conf.json's minimum window must equal) e-stop and pause sit
 * side by side at 40 px and the strip takes at most half the window
 * (ph-vdk.48). In the shell bundle the X
 * opens the close popover anchored under it, the bar keeps its height, and
 * Escape or a click outside cancels. The category page footer
 * (ph-vdk.60.12), at 1280x800 and 390x844: absent on the home, one 48 px box
 * on every category page with page controls, it and its controls hold still
 * for 30 frames across each toggle both ways, and scrolled to its end the
 * last card ends above it. The UI scale (ph-5q67) is the right end of the
 * FootStrip status row on every page, and on desktop the rail and the content
 * reach the hero panel frame on both sides.
 *
 * Then the REAL shell bundle (shell-build.mjs, stub Tauri runtime, no hub):
 * the sidebar ends in a Phosphor section holding the shell's panes, which the
 * served page never shows; first run selects Hubs; a Phosphor tab renders its
 * pane in the content area, desktop and phone; the shell chrome (row and
 * Phosphor section) is darker than the content in default, hi-vis and
 * high-contrast, its text keeps 4.5:1 (ph-e82.16).
 *
 * Deliberately NOT part of `npm run check`: that script runs inside every
 * firmware build (build_webui.py), and launching a browser there would put a
 * headless Chromium in the path of `pio run`. Run it via `npm run check:shell`
 * when chrome layout, the LinkBar, or the safe-area insets move.
 *
 * Run: node test/shell-chrome-geometry.test.mjs   (no device needed)
 */
import { DIST_HTML, EVIDENCE } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS, NACK } from '../../Valence/clients/js/frames.js';
import { CORE_CHANNEL, SAFETY_OP } from '../../Valence/clients/js/generated/registry_vocab.js';
import { FLOOR_W, FLOOR_H } from '../src/model/rclass.js';
import { compact } from '../src/model/format.js';
import { STORE_KEY } from '../src/model/grid.js';
import { settingsEntries } from '../src/shell/settingsSearch.js';

const HTML = readFileSync(DIST_HTML);
const SHELL = await buildShellPage();
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(q.url.startsWith('/shell') ? SHELL : HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.topstrip .linkbar', { timeout: 15000 });

const geom = () => page.evaluate(() => {
  const strip = document.querySelector('.topstrip').getBoundingClientRect();
  const lb = document.querySelector('.linkbar').getBoundingClientRect();
  const app = document.querySelector('.app').getBoundingClientRect();
  // The page footer is the one bar ruled onto the bottom edge (DESIGN §10.3);
  // it renders once a hub answers (a live hub on :82 makes this page live).
  const bottomFixed = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return cs.position === 'fixed' && cs.pointerEvents !== 'none' && b.height > 0 && b.bottom >= innerHeight - 1 && !el.matches('.page-foot');
  }).map((el) => el.tagName.toLowerCase() + '.' + el.className).join(' ');
  return { stripTop: strip.top, stripL: strip.left, stripW: strip.width, lbTop: lb.top,
           appH: app.height, vw: document.documentElement.clientWidth, vh: innerHeight, bottomFixed,
           scrolls: document.scrollingElement.scrollHeight > innerHeight + 2 };
});

// ---- served page: no shell row ---------------------------------------------
let g = await geom();
ok('no shell: strip flush at the viewport top', Math.abs(g.stripTop) < 1, 'top=' + g.stripTop);
ok('no shell: strip spans the window', Math.abs(g.stripL) < 1 && Math.abs(g.stripW - g.vw) < 1, g.stripL + '+' + g.stripW + ' vs ' + g.vw);
ok('no shell: LinkBar is the strip\'s first row', Math.abs(g.lbTop - g.stripTop) < 1);
ok('no shell: desktop column is exactly one viewport', Math.abs(g.appH - g.vh) < 2, g.appH + ' vs ' + g.vh);
ok('no shell: page does not scroll', !g.scrolls);
ok('nothing fixed to the bottom edge', !g.bottomFixed, g.bottomFixed || 'none');
// ph-wks: the notch inset must not depend on html.hivis.
const inset = await page.evaluate(() => [document.documentElement.classList.contains('hivis'),
  getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset-top').trim()]);
ok('--chrome-inset-top is defined without html.hivis', !inset[0] && inset[1] !== '', JSON.stringify(inset));
ok('served page: no shell chrome at all', await page.evaluate(() => !document.querySelector('.shell, .rail-sec.shell, [data-tab-id^="shell:"]')));
// ph-632: the status slot's amber text rides --warn-ink (the theme's ink for
// warn text on its chassis), never --warn itself.
const warnInk = await page.evaluate(() => {
  document.documentElement.style.setProperty('--warn-ink', 'rgb(1, 2, 3)');
  const t = document.querySelector('.strip .status[data-kind=fault] .st-text');
  const c = t && getComputedStyle(t).color;
  document.documentElement.style.removeProperty('--warn-ink');
  return c;
});
ok('status slot: warn text rides --warn-ink', warnInk === 'rgb(1, 2, 3)', warnInk);
// ph-rt1: a link value growing or shrinking moves no neighbor.
const fsMove = await page.evaluate(() => {
  const vs = [...document.querySelectorAll('.footstrip .v')];
  const x = () => vs.map((v) => Math.round(v.getBoundingClientRect().left)).join(',');
  const v = vs[2], t = v.textContent, out = [x()];
  v.textContent = '144739249 µs';
  out.push(x());
  v.textContent = '1 µs';
  out.push(x());
  v.textContent = t;
  return out;
});
ok('footstrip: a value growing or shrinking moves no neighbor', fsMove.every((s) => s === fsMove[0]), JSON.stringify(fsMove));
// ph-wt7r: the status row is one line, always. Every visible cell is on one
// top, the scale control is on it too at the right end, nothing scrolls, and
// at 1280 and up no cell has dropped.
const footRow = () => page.evaluate(() => {
  const f = document.querySelector('.footstrip'), fb = f.getBoundingClientRect();
  const shown = [...f.querySelectorAll('.fact')].filter((c) => c.offsetParent);
  const sc = f.querySelector('.foot-scale').getBoundingClientRect();
  return { h: Math.round(fb.height), shown: shown.length, tops: new Set(shown.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    out: shown.filter((c) => c.getBoundingClientRect().right > innerWidth + 0.5).length,
    scaleRight: Math.round(fb.right - sc.right), scaleMid: Math.round(sc.top + sc.height / 2 - (fb.top + fb.height / 2)),
    scrollers: [...f.querySelectorAll(':scope, :scope *')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowX)).length,
    wide: f.scrollWidth > f.clientWidth };
});
let fsH = null;
for (const [fw, fh] of [[390, 844], [1280, 800], [1440, 900], [1920, 1080]]) {
  await page.setViewportSize({ width: fw, height: fh });
  await page.waitForTimeout(250);
  const r = await footRow();
  fsH ??= r.h;
  ok('footstrip: at ' + fw + ' one row, the scale control on it at the right end, no scroller',
    r.tops === 1 && r.h === fsH && r.out === 0 && r.scrollers === 0 && !r.wide && Math.abs(r.scaleMid) <= 2 && r.scaleRight <= 14 && r.shown >= 1, JSON.stringify(r));
  if (fw >= 1280) ok('footstrip: at ' + fw + ' every cell shows', r.shown === 8, JSON.stringify(r));
}
// Compact forms, exact value in the title; UI build and catalog etag are one cell.
await page.setViewportSize({ width: 1440, height: 900 });
const cells = await page.evaluate(() => [...document.querySelectorAll('.footstrip .fact')].map((c) =>
  ({ k: c.querySelector('.k').textContent, v: c.querySelector('.v').textContent, t: c.title })));
const cell = (k) => cells.find((c) => c.k === k);
const pushes = cell('state pushes');
ok('footstrip: counters are compact with the exact count on hover', cell('reconnects').v === '0' && cell('reconnects').t === '0 reconnects'
  && /^\d+ state pushes$/.test(pushes.t) && pushes.v === compact(parseInt(pushes.t, 10)), JSON.stringify([cell('reconnects'), pushes]));
ok('footstrip: UI build and catalog etag are one cell "build:etag"', cells.filter((c) => /^ui$|etag|build/.test(c.k)).length === 1 && cell('ui')
  && /^\S+:\S+$/.test(cell('ui').v) && /^UI build \S+, catalog etag \S+$/.test(cell('ui').t), JSON.stringify(cell('ui')));
ok('footstrip: no raw microsecond or millisecond readout in a cell', cells.every((c) => !/ (µs|ms)$/.test(c.v)), JSON.stringify(cells.map((c) => c.v)));

// ---- phone: the page scrolls; the strip sticks, the tabs park under it --------
await page.setViewportSize({ width: 420, height: 800 });
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(300);
g = await geom();
const tabs = await page.evaluate(() => {
  const t = document.querySelector('nav.tabs');
  return t && getComputedStyle(t).position === 'sticky' ? t.getBoundingClientRect().top : null;
});
ok('phone scrolled: strip stays at the top', Math.abs(g.stripTop) < 1, 'top=' + g.stripTop);
const stripBottom = await page.evaluate(() => document.querySelector('.topstrip').getBoundingClientRect().bottom);
ok('phone scrolled: tab strip never slides under the strip', tabs == null || tabs >= stripBottom - 0.5,
   'tabsTop=' + tabs + ' stripBottom=' + stripBottom);
ok('phone: nothing fixed to the bottom edge', !g.bottomFixed, g.bottomFixed || 'none');
const fsPhone = await footRow();
ok('phone: the status row is still one line (ph-wt7r)', fsPhone.tops === 1 && fsPhone.h === fsH && !fsPhone.wide, JSON.stringify(fsPhone));

// ---- the real shell bundle: the sidebar's Phosphor section (ph-e82.16) ------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(TAURI_STUB);
const sp = await ctx.newPage();
await sp.goto('http://127.0.0.1:' + PORT + '/shell', { waitUntil: 'domcontentloaded' });
await sp.waitForSelector('nav.rail .rail-sec.shell [role=tab]', { timeout: 15000 });
await sp.waitForTimeout(300);
const rect = (sel) => sp.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; }, sel);
const PANES = ['Hubs', 'Buttplug', 'Settings', 'About'];

const sec = await sp.evaluate(() => {
  const secs = [...document.querySelectorAll('nav.rail .rail-sec')];
  const ph = document.querySelector('nav.rail .rail-sec.shell');
  return { last: secs.at(-1) === ph, label: ph.querySelector('.rail-lbl')?.textContent.trim(),
    tabs: [...ph.querySelectorAll('[role=tab] .rail-name')].map((t) => t.textContent.trim()),
    gap: document.querySelector('nav.rail').getBoundingClientRect().bottom - ph.getBoundingClientRect().bottom };
});
ok('shell: the sidebar ends in a Phosphor section with every shell pane', sec.last && sec.label === 'Phosphor'
   && PANES.every((p) => sec.tabs.includes(p)), JSON.stringify(sec));
ok('shell: the Phosphor section sits at the rail foot', sec.gap >= 0 && sec.gap < 12, 'gap=' + sec.gap);
ok('shell: no top drawer and no menu handle', await sp.evaluate(() => !document.querySelector('#shell-drawer, .sb-handle')));
ok('first run: Hubs is selected and its pane fills the content area',
   await sp.getAttribute('[data-tab-id="shell:hubs"]', 'aria-selected') === 'true'
   && await sp.evaluate(() => !!document.querySelector('.content main.pane .hp')));

for (const [id, sel] of [['about', 'dl.about'], ['settings', '.set'], ['server', '.sp-pane']]) {
  await sp.click('[data-tab-id="shell:' + id + '"]');
  await sp.waitForTimeout(100);
  ok('Phosphor > ' + id + ' renders in the content area', await sp.evaluate((s) => !!document.querySelector('.content main.pane ' + s), sel));
}
await sp.click('[data-tab-id="shell:about"]');
await sp.waitForTimeout(100);
const about = await sp.textContent('.content main.pane');
ok('About: hub identity, versions, UI build', /Hub/.test(about) && /Firmware/.test(about) && /UI build/.test(about), about.replace(/\s+/g, ' ').slice(0, 80));
await sp.focus('[data-tab-id="shell:hubs"]');
await sp.keyboard.press('ArrowDown');
ok('ArrowDown moves focus and selection to the next Phosphor tab', await sp.evaluate(() => document.activeElement.dataset.tabId === 'shell:server'
  && document.activeElement.getAttribute('aria-selected') === 'true'));

// Shading: the shell row and the Phosphor section are darker than every
// content surface around them, and their text keeps 4.5:1, in default, hi-vis
// and high-contrast.
const shade = () => sp.evaluate(() => {
  const ctx2d = document.createElement('canvas').getContext('2d');
  const rgb = (c) => { ctx2d.clearRect(0, 0, 1, 1); ctx2d.fillStyle = '#000'; ctx2d.fillStyle = c; ctx2d.fillRect(0, 0, 1, 1); return [...ctx2d.getImageData(0, 0, 1, 1).data]; };
  const lum = (c) => { const [r, g, b] = rgb(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bgOf = (el) => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (rgb(c)[3] === 255) return c; } return getComputedStyle(document.body).backgroundColor; };
  const roots = [...document.querySelectorAll('.shell, .rail-sec.shell')];
  const shell = roots.map((el) => lum(getComputedStyle(el).backgroundColor));
  const content = [lum(getComputedStyle(document.body).backgroundColor), lum(bgOf(document.querySelector('nav.rail'))), lum(bgOf(document.querySelector('.content')))];
  let worst = 99, at = '';
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.data.trim() || el.closest(':disabled') || !el.getBoundingClientRect().width) continue;
      const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
      const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (cr < worst) { worst = cr; at = n.data.trim().slice(0, 20); }
    }
  }
  return { shell, content, worst: Math.round(worst * 100) / 100, at };
});
for (const [label, setup] of [['default', null], ['hi-vis', () => document.documentElement.classList.add('hivis')]]) {
  if (setup) await sp.evaluate(setup);
  const s = await shade();
  ok(label + ': shell row and Phosphor section darker than the content', s.content.every((c) => s.shell.every((x) => x < c)), JSON.stringify(s));
  ok(label + ': shell text keeps 4.5:1', s.worst >= 4.5, s.worst + ' at "' + s.at + '"');
}
await sp.emulateMedia({ contrast: 'more' });
{
  const s = await shade();
  ok('high contrast: shell darker than the content, text keeps 4.5:1', s.content.every((c) => s.shell.every((x) => x < c)) && s.worst >= 4.5, JSON.stringify(s));
}
await sp.emulateMedia({ contrast: 'no-preference' });
await sp.evaluate(() => document.documentElement.classList.remove('hivis'));

// Phone: the Phosphor tabs ride the same tab strip; the e-stop stays put.
await sp.setViewportSize({ width: 360, height: 640 });
await sp.waitForSelector('nav.tabs [data-tab-id="shell:settings"]');
const esBefore = await rect('.topstrip .btn-estop');
const phoneTabs = await sp.$$eval('nav.tabs [data-tab-id^="shell:"]', (els) => els.map((e) => e.textContent.trim()));
ok('phone: the Phosphor tabs ride the tab strip', PANES.every((p) => phoneTabs.includes(p)), JSON.stringify(phoneTabs));
await sp.click('nav.tabs [data-tab-id="shell:settings"]');
await sp.waitForTimeout(150);
ok('phone: Phosphor > Settings renders in the page', await sp.evaluate(() => !!document.querySelector('main.pane .set')));
await sp.evaluate(() => window.scrollTo(0, 0));
await sp.waitForTimeout(100);
const esAfter = await rect('.topstrip .btn-estop');
ok('phone: the e-stop does not move', Math.abs(esAfter.top - esBefore.top) < 0.5, esBefore.top + ' -> ' + esAfter.top);
await ctx.close();

// ---- ph-e82.17: fixed heights against a fake hub ------------------------------
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const RUN = ENTRIES.find((e) => (e.layout || []).some((f) => f.role === 'pattern.running'));
const PLAN = ENTRIES.find((e) => (e.layout || []).some((f) => f.role === 'plan.current'));
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
// A zeroed snapshot of a channel, the pattern's `running` set as asked.
function patternState(on, e = RUN) {
  const out = new Uint8Array(e.layout.reduce((a, f) => a + (SIZE[f.type] ?? f.declaredSize ?? 0), 0));
  let off = 0;
  for (const f of e.layout) {
    if (f.role === 'pattern.running') out[off] = on ? 1 : 0;
    off += SIZE[f.type] ?? f.declaredSize ?? 0;
  }
  return out;
}
const LONG_NAME = 'A hub with a deliberately long name that would wrap any bar that let it';
function hub(wire) {
  return (ws) => {
    wire.ws = ws;
    wire.send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
    ws.onMessage((msg) => {
      if (typeof msg === 'string') return;
      for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
        if (header.type === FRAME.HELLO) {
          wire.send(FRAME.WELCOME, 0, cbMap([
            [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
            [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
            [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
              [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
            [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
            [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
              [IDENTITY_K.hub_name, cbTstr(LONG_NAME)]])],
          ]));
        } else if (header.type === FRAME.SUBSCRIBE) {
          const grants = (cbDecodeFull(payload).get(K.subscriptions) || []).map((w) => cbMap([[K.priority, cbUint(w.get(K.priority) || 0)],
            [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)], [K.channel_id, cbUint(w.get(K.channel_id))]]));
          wire.send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
          wire.send(FRAME.STATE, RUN.id, patternState(false));
          wire.send(FRAME.STATE, PLAN.id, patternState(false, PLAN));
        } else if (header.type === FRAME.INTENT && header.channel === CORE_CHANNEL.safety_intents) {
          // Pause and resume land as the hub's latch (SPEC §11.1 snapshot,
          // bit3 PAUSE at byte 0), so the pair really changes state.
          const m = cbDecodeFull(payload);
          const op = m.get(K.value).get(1);
          wire.send(FRAME.ECHO, header.channel, cbMap([[K.cfg_gen, cbUint(1)], [K.intent_id, cbUint(m.get(K.intent_id))],
            [K.applied, cbMap([[1, cbUint(op)]])]]));
          const paused = op === SAFETY_OP.pause ? 0x08 : 0;
          wire.send(FRAME.STATE, CORE_CHANNEL.safety, Uint8Array.of(paused, 0, 0, 0, 0, 0, 0, 0, 0));
        } else if (header.type === FRAME.INTENT) {
          // Every other write is refused, with a reason long enough to wrap.
          wire.send(FRAME.NACK, header.channel, cbMap([[K.code, cbUint(NACK.SOURCE_CONFLICT)],
            [K.detail, cbTstr('a source owns the rail and this reason is long on purpose, to wrap any line that let it')],
            [K.intent_id, cbUint(cbDecodeFull(payload).get(K.intent_id))]]));
        } else if (header.type === FRAME.PING) {
          wire.send(FRAME.PONG, header.channel, payload);
        }
      }
    });
  };
}
const heights = (p) => p.evaluate(() => {
  const h = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null; };
  const word = document.querySelector('.linkbar .wordmark');
  return { bar: h('.linkbar'), strip: h('.strip'), row: h('.rail-row'), panel: h('.rail-panel'),
    railTop: Math.round((document.querySelector('.spine-rail-host')?.getBoundingClientRect().top ?? -1) * 10) / 10,
    nameClipped: !!word && word.scrollWidth > word.clientWidth,
    slot: document.querySelector('.strip .status')?.dataset.kind };
});
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const tag = w + 'x' + h;
  const wire = {};
  const hctx = await browser.newContext({ viewport: { width: w, height: h } });
  await hctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await hctx.routeWebSocket(/:82\//, hub(wire));
  const hp = await hctx.newPage();
  await hp.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  // The tape stays mounted when the hero bar shows its mini rail (phones), so it is awaited attached, not visible.
  const up = await hp.waitForSelector('.rail-tape-track[aria-disabled=false]', { state: 'attached', timeout: 15000 }).then(() => true).catch(() => false);
  ok(tag + ': the fixture hub is adopted and the tape is live', up);
  if (up && await hp.locator('.topstrip .mini').count()) {
    ok(tag + ': the mini rail shows and the popup is closed', await hp.locator('.topstrip .mini').isVisible() && await hp.locator('.hero-inner.popup').count() === 0);
    await hp.locator('.topstrip .mini').click();
    ok(tag + ': tapping the mini opens the rail', await hp.locator('.hero-inner.popup .rail-tape-track[aria-disabled=false]').isVisible());
    await hp.keyboard.press('Escape');
  }
  if (!up) { await hctx.close(); continue; }
  await hp.waitForTimeout(300);
  const idle = await heights(hp);
  ok(tag + ': a long hub name ellipsizes in one bar row', idle.nameClipped, JSON.stringify(idle));
  // ph-51k: one value face across the chips, the reality tone only on a
  // chip that reports liveness, and no tooltip that repeats its text.
  const chips = await hp.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--reality)';
    document.body.append(probe);
    const real = getComputedStyle(probe).color;
    probe.remove();
    const cs = [...document.querySelectorAll('.linkbar .chip')].filter((c) => c.getBoundingClientRect().width > 0);
    const faces = new Set(cs.flatMap((c) => [...c.querySelectorAll(':scope > span:not(.chip-lbl):not(.chip-dot)')]
      .map((v) => getComputedStyle(v).fontFamily)));
    const word = document.querySelector('.linkbar .wordmark');
    return { faces: [...faces], real: cs.filter((c) => getComputedStyle(c).color === real).map((c) => c.textContent.trim().split(/\s+/)[0]),
      word: word.title === word.textContent, titles: cs.map((c) => c.title).filter(Boolean) };
  });
  ok(tag + ': chip values share one face; reality only on liveness chips; no repeated tooltip', chips.faces.length === 1
    && chips.real.every((t) => /^(live|rx)$/i.test(t)) && chips.word && !chips.titles.some((t) => /firmware|0\.0\.0-fixture/.test(t)),
    JSON.stringify(chips));
  ok(tag + ': the tape carries the jog hint as its tooltip', await hp.locator('.rail-tape-track[title*="scrub"]').count() === 1);

  // ph-e82.21: nothing moves for 30 frames across each safety and pattern
  // edge. The sampler starts first, then the edge fires, so the press, its
  // pending frame and the echo all land inside the window.
  const still = async (what, act) => {
    await hp.evaluate(() => {
      window.__frames = [];
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); };
      const tick = () => {
        window.__frames.push(['.rail-row', '.spine-rail-host', '.strip', '.strip .status', '.topstrip .btn-pause',
          '.topstrip .btn-estop'].map(box).join(' | '));
        if (window.__frames.length < 30) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await act();
    await hp.waitForFunction(() => window.__frames.length >= 30, null, { timeout: 5000 }).catch(() => {});
    const f = await hp.evaluate(() => window.__frames);
    const moved = f.filter((x) => x !== f[0]);
    ok(tag + ': ' + what + ': rail row, strip, status slot and pair hold still for 30 frames', f.length >= 30 && moved.length === 0,
      f.length + ' frames, ' + moved.length + ' moved' + (moved.length ? ': ' + f[0] + ' -> ' + moved[0] : ''));
  };
  const faces = () => hp.evaluate(() => [...document.querySelectorAll('.rail-swap .swap-face')]
    .map((el) => getComputedStyle(el).visibility + ':' + (el.querySelector('.plan-strip') ? 'plan' : 'tape')).join(' '));
  const pauseLbl = () => hp.locator('.topstrip .btn-pause .lbl').textContent();
  await still('pause', () => hp.locator('.topstrip .btn-pause').click());
  ok(tag + ': the hub latched pause (reads Resume)', (await pauseLbl()).trim() === 'Resume');
  await still('resume', () => hp.locator('.topstrip .btn-pause').click());
  ok(tag + ': the hub released pause (reads Pause)', (await pauseLbl()).trim() === 'Pause');
  await still('pattern start', () => wire.send(FRAME.STATE, RUN.id, patternState(true)));
  // The phone's mini rail hides both faces; the swap is the pop-up's business there.
  const mini = await hp.locator('.topstrip .mini').count() > 0;
  ok(tag + ': pattern start flips visibility, both faces stay mounted', mini ? (await faces()).split(' ').length === 2 : await faces() === 'visible:plan hidden:tape', await faces());
  await still('pattern stop', () => wire.send(FRAME.STATE, RUN.id, patternState(false)));
  ok(tag + ': pattern stop flips it back', mini ? (await faces()).split(' ').length === 2 : await faces() === 'hidden:plan visible:tape', await faces());
  // The rest drives the tape itself, which the phone's mini rail keeps behind its pop-up.
  if (mini) { await hctx.close(); continue; }

  await hp.locator('.rail-tape-track').click();
  await hp.waitForSelector('.strip .status[data-kind=refusal]', { timeout: 3000 }).catch(() => {});
  const refused = await heights(hp);
  ok(tag + ': a refusal lands in the status slot', refused.slot === 'refusal', refused.slot);
  ok(tag + ': bar and strip heights hold with the refusal showing', refused.bar === idle.bar && refused.strip === idle.strip,
    JSON.stringify([idle, refused]));

  wire.send(FRAME.STATE, RUN.id, patternState(true));
  await hp.waitForSelector('.rail-swap .plan-strip', { state: 'visible', timeout: 3000 }).catch(() => {});
  const plan = await heights(hp);
  ok(tag + ': a running pattern swaps the plan strip into the rail row',
    await hp.locator('.rail-swap .plan-strip').isVisible() && !await hp.locator('.rail-swap .rail-tape-track').isVisible());
  ok(tag + ': the rail panel is the rail row and the rail, no help lines', await hp.evaluate(() =>
    [...document.querySelector('.rail-panel').children].every((c) => c.matches('.rail-row, .spine-rail-host'))
));
  ok(tag + ': rail row, rail and panel hold across the swap', plan.row === idle.row && plan.railTop === idle.railTop
    && plan.panel === idle.panel,
    JSON.stringify([idle, plan]));
  wire.send(FRAME.STATE, RUN.id, patternState(false));
  await hp.waitForSelector('.rail-swap .rail-tape-track', { state: 'visible', timeout: 3000 }).catch(() => {});
  const back = await heights(hp);
  ok(tag + ': the tape swaps back when the source releases', back.row === idle.row && back.railTop === idle.railTop
    && await hp.locator('.rail-swap .rail-tape-track').isVisible(), JSON.stringify(back));

  await wire.ws.close({ code: 4000, reason: 'r'.repeat(100) });
  await hp.waitForSelector('.strip .status[data-kind=fault]', { timeout: 3000 }).catch(() => {});
  const fault = await heights(hp);
  ok(tag + ': bar and strip heights hold with a long fault reason', fault.slot === 'fault' && fault.bar === idle.bar
    && fault.strip === idle.strip, JSON.stringify(fault));
  await hctx.close();
}

// ---- ph-vdk.60.12: the category page footer ----------------------------------
// One fixed box on every page with page controls, none on the home; 30
// still frames across each toggle, both ways; scrolled to its end, the last
// card ends above it. Then the UI scale, which lives in the FootStrip status
// row (1280 only): right-aligned there, the row's height unchanged by it, the readout is the
// theme's, +/- step it, Reset shows only off 100% and moves nothing, and
// Ctrl+=, Ctrl+0 and Ctrl+wheel scale --s without zooming the page, except
// over a surface that takes the wheel itself.
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const tag = w + 'x' + h + ' footer';
  const fctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 960 });
  await fctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await fctx.routeWebSocket(/:82\//, hub({}));
  const fp = await fctx.newPage();
  await fp.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  const tabSel = (w >= 960 ? 'nav.rail' : 'nav.tabs') + ' [role=tab][data-tab-id^="cat"]';
  const up = await fp.waitForSelector(tabSel, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(tag + ': the category pages render', up);
  if (!up) { await fctx.close(); continue; }
  const footBox = () => fp.evaluate(() => { const r = document.querySelector('main.pane .page-foot')?.getBoundingClientRect();
    return r ? [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',') : null; });
  const homeBox = await footBox();
  ok(tag + ': the home has no page footer; the UI scale is in the status row', (!homeBox || homeBox.endsWith(',0'))
    && await fp.locator('.footstrip .foot-scale output').count() === 1 && await fp.locator('.page-foot .foot-scale').count() === 0, homeBox);
  const sbox = () => fp.evaluate(() => { const f = document.querySelector('.footstrip').getBoundingClientRect(), s = document.querySelector('.footstrip .foot-scale').getBoundingClientRect();
    return { strip: [f.left, f.width, f.height].map(Math.round).join(','), right: Math.round(f.right - s.right), within: s.top >= f.top - 0.5 && s.bottom <= f.bottom + 0.5 }; });
  const sb0 = await sbox();
  ok(tag + ': the scale sits at the status row end, inside it', sb0.right === 12 && sb0.within, JSON.stringify(sb0));
  // ph-p43h: the top bar and the status row are full bleed; the status text keeps a --gap inset at both ends.
  const bleed = await fp.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), t = r('.topstrip'), f = r('.footstrip');
    return { t: [t.left, t.width], f: [f.left, f.width], iw: innerWidth, ow: document.documentElement.scrollWidth }; });
  ok(tag + ': the top bar and the status row span the window edge to edge, no overflow',
    bleed.t[0] === 0 && bleed.f[0] === 0 && Math.abs(bleed.t[1] - bleed.iw) < 0.5 && Math.abs(bleed.f[1] - bleed.iw) < 0.5 && bleed.ow <= bleed.iw, JSON.stringify(bleed));
  if (w >= 960) {
    // The sidebar is flush on the window's left edge; the gaps are rail | gap | content | gap. Scrollbars off (default):
    // the content ends one --gap from the window edge; on, the reserved 4 px track sits inside that gap (DESIGN §10.3).
    const hb = await fp.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(), h = r('.hero-strip'), t = r('.topstrip'), k = r('.spine-rail-host');
      const pr = document.createElement('i'); pr.style.paddingLeft = 'var(--gap)'; document.body.append(pr); const gap = parseFloat(getComputedStyle(pr).paddingLeft); pr.remove();
      return { hl: h.left, hr: h.right, ht: h.top - t.bottom, iw: innerWidth, kl: k.left - h.left - gap, kr: h.right - k.right - gap }; });
    ok(tag + ': the hero bar spans the window under the top bar; the rail host is inset one gap each side',
      hb.hl === 0 && Math.abs(hb.hr - hb.iw) < 0.5 && Math.abs(hb.ht) < 0.5 && Math.abs(hb.kl) <= 0.5 && Math.abs(hb.kr) <= 0.5, JSON.stringify(hb));
    for (const on of [false, true]) {
      const edges = await fp.evaluate((on) => { document.documentElement.toggleAttribute('data-scrollbars', on);
        const a = document.querySelector('nav.rail').getBoundingClientRect(), c = document.querySelector('.content'), cb = c.getBoundingClientRect();
        const pr = document.createElement('i'); pr.style.paddingLeft = 'var(--gap)'; document.body.append(pr); const gap = parseFloat(getComputedStyle(pr).paddingLeft); pr.remove();
        const out = [a.left, cb.left - a.right - gap, innerWidth - (cb.left + c.clientWidth) - gap, c.offsetWidth - c.clientWidth].map((v) => Math.round(v * 10) / 10);
        document.documentElement.removeAttribute('data-scrollbars');
        return out; }, on);
      const st = on ? ' (scrollbars on)' : ' (scrollbars off)';
      ok(tag + ': the rail is flush left, one gap to the content, one gap on its right edge' + st, edges[0] === 0 && Math.abs(edges[1]) <= 0.5 && Math.abs(edges[2]) <= 0.5, edges.join(' / '));
      ok(tag + (on ? ': the content reserves its 4 px track inside the right gap' : ': no track') + st, on ? edges[3] === 4 : edges[3] === 0, edges.join(' / '));
    }
  }
  if (w >= 960) {
    // ph-mdqo.2: the rail's recess spans its scrollport (no padding on the rail), takes no room, tints from the theme
    // surface, and holds its state through the last 2 px.
    await fp.setViewportSize({ width: w, height: 560 });
    await fp.waitForTimeout(200);
    const rs = await fp.evaluate(async () => {
      const rail = document.querySelector('nav.rail'), frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const max = rail.scrollHeight - rail.clientHeight, cs = getComputedStyle(rail);
      const tabs = () => [...rail.querySelectorAll('.rail-tab')].map((t) => { const r = t.getBoundingClientRect(); return [r.top, r.left, r.width, r.height].join(','); }).join('|');
      const at = async (y) => { rail.scrollTop = y; await frames(); return [rail.hasAttribute('data-shade-top'), rail.hasAttribute('data-shade-bottom')]; };
      const mid = await at(max / 2);
      const bef = getComputedStyle(rail, '::before'), aft = getComputedStyle(rail, '::after');
      const geo = { pad: cs.paddingLeft + cs.paddingTop + cs.paddingBottom, bw: parseFloat(bef.width) - rail.clientWidth, aw: parseFloat(aft.width) - rail.clientWidth,
        ink: bef.backgroundImage + aft.backgroundImage };
      const withOn = tabs(); rail.removeAttribute('data-shade-bottom'); const withOff = tabs(); rail.setAttribute('data-shade-bottom', '');
      const flips = []; let last = mid[1];
      for (const y of [max - 1, max - 0.2, max - 1, max - 1.5, max - 0.2, max - 3]) { const b = (await at(y))[1]; if (b !== last) flips.push(b); last = b; }
      return { max, mid, geo, same: withOn === withOff, flips };
    });
    ok(tag + ': the rail scrolls and shades both edges mid-way', rs.max > 20 && rs.mid[0] && rs.mid[1], JSON.stringify(rs.mid));
    ok(tag + ': the rail has no padding; both shades span its scrollport', rs.geo.pad === '0px0px0px' && Math.abs(rs.geo.bw) < 0.5 && Math.abs(rs.geo.aw) < 0.5, JSON.stringify(rs.geo).slice(0, 120));
    ok(tag + ': the shade ink comes from the theme surface, not black', !/rgba?\(0, 0, 0/.test(rs.geo.ink), rs.geo.ink.slice(0, 160));
    ok(tag + ': a shade moves no rail tab', rs.same);
    ok(tag + ': the bottom shade holds through the last 2 px (off once, back on only past 2 px)', JSON.stringify(rs.flips) === '[false,true]', JSON.stringify(rs.flips));
    await fp.screenshot({ path: process.env.RAIL_SHOT || EVIDENCE + '/responsive/rail-shade.png' });
    await fp.setViewportSize({ width: w, height: h });
    await fp.waitForTimeout(200);
  }
  if (w >= 960) {
    // ph-lxea: saved layouts are Dash sub-items; the wrench on the selected one flips edit mode; Add layout is last.
    await fp.click('nav.rail [data-tab-id="machine"]');
    const rows = () => fp.$$eval('nav.rail .rail-sub [data-layout]', (e) => e.map((b) => b.dataset.layout + (b.hasAttribute('aria-current') ? '*' : '')));
    ok(tag + ': Dash selects Default, listed first, with Add layout last', JSON.stringify(await rows()) === '["Default*"]'
      && await fp.$eval('nav.rail .rail-sub', (e) => e.lastElementChild.textContent.trim()) === '+ Add layout', JSON.stringify(await rows()));
    const wr = fp.locator('nav.rail .rail-wrench');
    await wr.click();
    const pressed = await wr.getAttribute('aria-pressed');
    await wr.click();
    ok(tag + ': the wrench toggles edit mode', pressed === 'true' && await wr.getAttribute('aria-pressed') === 'false', pressed);
    await fp.click('nav.rail .sub-layout.add');
    await fp.keyboard.type('Bench');
    await fp.keyboard.press('Enter');
    ok(tag + ': Add layout creates and selects a named layout', JSON.stringify(await rows()) === '["Default","Bench*"]', JSON.stringify(await rows()));
    await fp.click('nav.rail .sub-layout.add');
    await fp.keyboard.type('Couch');
    await fp.keyboard.press('Enter');
    // Drag Couch's grip above Bench: the order persists across a reload.
    const center = async (q) => { const b = await fp.locator(q).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const rowSel = (n) => 'nav.rail .sub-row:has([data-layout="' + n + '"])';
    await fp.hover(rowSel('Couch'));
    const [gx, gy] = await center(rowSel('Couch') + ' .sub-grip'), [, by] = await center('nav.rail [data-layout="Bench"]');
    await fp.mouse.move(gx, gy); await fp.mouse.down(); await fp.mouse.move(gx, by - 4, { steps: 6 }); await fp.mouse.up();
    ok(tag + ': dragging a grip reorders the layouts', JSON.stringify(await rows()) === '["Default","Couch*","Bench"]', JSON.stringify(await rows()));
    const stored = await fp.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').order, STORE_KEY);
    ok(tag + ': the order is stored', JSON.stringify(stored) === '["Default","Couch","Bench"]', JSON.stringify(stored));
    // Hold the x: 0.5 s deletes nothing, 1 s does; Default has neither grip nor x.
    ok(tag + ': Default has no grip and no x', await fp.locator(rowSel('Default') + ' :is(.sub-grip, .sub-x)').count() === 0);
    await fp.waitForTimeout(350);
    await fp.hover(rowSel('Bench'));
    if (process.env.LAYOUT_SHOT) await fp.screenshot({ path: process.env.LAYOUT_SHOT, clip: { x: 0, y: 0, width: 420, height: 800 } });
    const [xx, xy] = await center(rowSel('Bench') + ' .sub-x');
    await fp.mouse.move(xx, xy); await fp.mouse.down(); await fp.waitForTimeout(500); await fp.mouse.up();
    const half = (await rows()).length;
    await fp.mouse.down(); await fp.waitForTimeout(1250); await fp.mouse.up();
    ok(tag + ': the x held 0.5 s deletes nothing, held 1 s deletes', half === 3 && (await rows()).map((r) => r.replace('*', '')).join() === 'Default,Couch', half + ' / ' + JSON.stringify(await rows()));
    // ph-mdqo.10: F2 and double-click rename; Escape reverts; Default refuses.
    await fp.dblclick('nav.rail [data-layout="Couch"]');
    const live = () => fp.evaluate(() => { const a = document.activeElement; return a.matches('.sub-input') ? [a.selectionStart, a.selectionEnd, a.value] : null; });
    ok(tag + ': a double-click opens the layout name with its text selected', JSON.stringify(await live()) === '[0,5,"Couch"]', JSON.stringify(await live()));
    await fp.keyboard.type('Sofa');
    await fp.keyboard.press('Enter');
    ok(tag + ': Enter keeps the new layout name', (await rows()).join() === 'Default,Sofa*', JSON.stringify(await rows()));
    await fp.focus('nav.rail [data-layout="Sofa"]');
    await fp.keyboard.press('F2');
    await fp.keyboard.type('Zed');
    await fp.keyboard.press('Escape');
    ok(tag + ': F2 then Escape reverts', (await rows()).join() === 'Default,Sofa*', JSON.stringify(await rows()));
    await fp.dblclick('nav.rail [data-layout="Default"]');
    ok(tag + ': Default refuses to rename', await fp.locator('nav.rail .sub-input').count() === 0);
    await fp.click('nav.rail [data-tab-id="machine"]');
    ok(tag + ': Dash selects Default again', (await rows()).join() === 'Default*,Sofa', JSON.stringify(await rows()));
    await fp.click('nav.rail .sub-layout.add');
    await fp.keyboard.type('Sofa');
    await fp.keyboard.press('Enter');
    ok(tag + ': a taken name stays open, marked invalid', await fp.locator('nav.rail .sub-input[aria-invalid="true"]').count() === 1);
    await fp.keyboard.press('Escape');
    // Deleting the active layout with the wrench on turns edit mode off and moves focus to a neighbor.
    await fp.click('nav.rail [data-layout="Sofa"]');
    await fp.click('nav.rail .rail-wrench');
    await fp.hover(rowSel('Sofa'));
    const [dx, dy] = await center(rowSel('Sofa') + ' .sub-x');
    await fp.mouse.move(dx, dy); await fp.mouse.down(); await fp.waitForTimeout(1250); await fp.mouse.up(); await fp.waitForTimeout(350);
    ok(tag + ': deleting the active layout ends edit mode', (await rows()).join() === 'Default*' && await fp.locator('nav.rail .rail-wrench').getAttribute('aria-pressed') === 'false', JSON.stringify(await rows()));
  }
  if (w >= 960) {
    // ph-mdqo.12: F3 lists the Display entries and Enter lands on the row.
    for (const [q, key] of [['scrollbars', 'scrollbars'], ['rail hide', 'railhide'], ['motion reduced', 'motion']]) {
      await fp.keyboard.press('F3');
      await fp.keyboard.type(q);
      const first = await fp.locator('.lf-list [role=option]').first().textContent();
      await fp.keyboard.press('Enter');
      await fp.waitForTimeout(250);
      const landed = await fp.evaluate((k) => { const e = document.querySelector('[data-search-key="' + k + '"]'); const r = e && e.getBoundingClientRect(); return !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }, key);
      ok(tag + ': F3 "' + q + '" lands on its Display row', landed, first.replace(/\s+/g, ' ').trim());
    }
  }
  if (w >= 960) {
    // Drift: every data-search-key on the Display pane has an F3 entry, and every entry resolves to a row.
    const dom = await fp.evaluate(() => ({ keys: [...document.querySelectorAll('main.pane [data-search-key]')].map((e) => e.dataset.searchKey),
      presets: [...document.querySelectorAll('[data-theme-id]')].map((e) => ({ id: e.dataset.themeId, name: e.querySelector('.name').textContent.trim() })) }));
    const want = settingsEntries(dom.presets).filter((e) => !e.shell).map((e) => e.key);
    const lost = dom.keys.filter((k) => !want.includes(k)), dead = want.filter((k) => !dom.keys.includes(k));
    ok(tag + ': every Display row has an F3 entry and every entry has a row', dom.keys.length > 20 && !lost.length && !dead.length, 'rows without entry: ' + lost + ' entries without row: ' + dead);
    await fp.keyboard.press('F3');
    await fp.keyboard.type('afterglow');
    const hit = await fp.locator('.lf-list [role=option]').first().textContent();
    await fp.keyboard.press('Enter');
    ok(tag + ': F3 finds a knob by its name', /Afterglow/.test(hit), hit.replace(/\s+/g, ' ').trim());
  }
  if (w >= 960) {
    // ph-lxea: the selected page's pill holds [n diag] [n adv] [reset]; no page footer on the expanded rail; reset is a 1 s hold.
    let hit = null;
    for (const id of await fp.$$eval(tabSel, (els) => els.map((e) => e.dataset.tabId))) {
      await fp.click('[data-tab-id="' + id + '"]');
      await fp.waitForTimeout(150);
      if (await fp.locator('.rail-tab.on + .rail-ops .reset').count()) { hit = id; break; }
    }
    ok(tag + ': a category page grows its pill with the operations strip', !!hit, String(hit));
    if (hit) {
      const strip = await fp.evaluate(() => { const o = document.querySelector('.rail-tab.on + .rail-ops'), p = o.parentElement, t = o.previousElementSibling;
        return { inside: p.contains(o), labels: [...o.querySelectorAll('button')].map((b) => b.textContent.trim().replace(/^\d+/, '#')), cols: getComputedStyle(o).gridTemplateColumns.split(' ').length,
          foot: getComputedStyle(document.querySelector('main.pane .page-foot')).display, pills: document.querySelectorAll('.rail-ops').length,
          inset: o.getBoundingClientRect().left - t.getBoundingClientRect().left }; });
      ok(tag + ': the strip sits inside the pill, one pill, no page footer', strip.pills === 1 && strip.foot === 'none' && strip.cols === strip.labels.length && strip.labels.at(-1) === 'reset', JSON.stringify(strip));
    }
    await fp.click('nav.rail .rail-collapse');
    await fp.waitForTimeout(150);
  }
  const rowMoved = [], boxes = new Set(homeBox && !homeBox.endsWith(',0') ? [homeBox] : []), shifts = [], under = [], clipped = [], onState = [];
  let pages = 0, flips = 0;
  for (const id of await fp.$$eval(tabSel, (els) => els.map((e) => e.dataset.tabId))) {
    await fp.click('[data-tab-id="' + id + '"]');
    await fp.waitForTimeout(250);
    const box = await fp.evaluate(() => {
      const f = document.querySelector('main.pane .page-foot');
      return f && [...[f, ...f.children].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); })];
    });
    if (!box) continue;
    if (box[0].endsWith(',0')) { if ((await sbox()).strip !== sb0.strip) rowMoved.push(id); continue; }
    if ((await sbox()).strip !== sb0.strip) rowMoved.push(id);
    pages++;
    boxes.add(box[0]);
    // ph-dj9: nothing in the footer scrolls; every shown control is whole
    // inside the footer and the window.
    const clip = await fp.evaluate(() => {
      const f = document.querySelector('main.pane .page-foot'), fr = f.getBoundingClientRect();
      const scrollers = [f, ...f.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowX)).length;
      const out = [...f.querySelectorAll('button, output, .cat-busy')].filter((e) => getComputedStyle(e).visibility === 'visible')
        .filter((e) => { const r = e.getBoundingClientRect(); return r.left < fr.left - 0.5 || r.right > fr.right + 0.5 || r.top < fr.top - 0.5
          || r.bottom > fr.bottom + 0.5 || r.right > innerWidth + 0.5; })
        .map((e) => e.textContent.trim() || e.getAttribute('aria-label'));
      return { scrollers, out };
    });
    if (clip.scrollers || clip.out.length) clipped.push(id + ' ' + JSON.stringify(clip));
    for (let i = 0; i < await fp.locator('main.pane .page-foot .adv-toggle').count(); i++) {
      for (let k = 0; k < 2; k++) {
        flips++;
        const f = await fp.evaluate(async (i) => {
          const foot = document.querySelector('main.pane .page-foot');
          const frame = () => [foot, ...foot.querySelectorAll('button, output, .cat-busy')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); }).join(' | ');
          const out = [frame()];
          foot.querySelectorAll('.adv-toggle')[i].click();
          for (let n = 0; n < 30; n++) { await new Promise((r) => requestAnimationFrame(r)); out.push(frame()); }
          return out;
        }, i);
        const moved = f.filter((x) => x !== f[0]);
        if (moved.length) shifts.push(id + ' toggle ' + i + ': ' + f[0] + ' -> ' + moved[0]);
        // ph-eo0: on wears the reality on-state, off does not.
        const st = await fp.evaluate((i) => {
          const t = document.querySelectorAll('main.pane .page-foot .adv-toggle')[i];
          const probe = document.createElement('i');
          probe.style.color = 'var(--reality)';
          document.body.append(probe);
          const real = getComputedStyle(probe).color;
          probe.remove();
          return [t.getAttribute('aria-expanded'), getComputedStyle(t).borderTopColor === real && getComputedStyle(t).color === real];
        }, i);
        if ((st[0] === 'true') !== st[1]) onState.push(id + ' toggle ' + i + ' ' + JSON.stringify(st));
      }
    }
    const end = await fp.evaluate(async () => {
      const se = document.querySelector('.content') || document.scrollingElement;
      se.scrollTop = se.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cards = [...document.querySelectorAll('main.pane :is(.dash-cell, .drill-page, .cat-empty)')];
      const last = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
      const top = document.querySelector('main.pane .page-foot').getBoundingClientRect().top;
      se.scrollTop = 0;
      return { last, top };
    });
    if (!(end.last <= end.top + 0.5)) under.push(id + ' ' + JSON.stringify(end));
  }
  const [, , , fh] = [...boxes][0]?.split(',').map(Number) || [];
  ok(tag + ': the status row is one box on every page', rowMoved.length === 0, rowMoved.join(' '));
  ok(tag + ': pages with page controls carry the footer', pages > 1, pages + ' pages');
  if (w >= 960) ok(tag + ': one footer box on every page with page controls, 48 px tall', boxes.size === 1 && fh === 48, [...boxes].join(' / '));
  else ok(tag + ': a page\'s footer is whole 48 px rows', fh === 48
    && [...boxes].every((b) => +b.split(',')[3] >= 48), [...boxes].join(' / '));
  ok(tag + ': nothing in the footer scrolls; every control whole inside it and the window (ph-dj9)', clipped.length === 0,
    clipped.slice(0, 2).join(' / '));
  ok(tag + ': an on toggle wears the reality on-state, an off one does not (ph-eo0)', flips > 0 && onState.length === 0,
    onState.slice(0, 2).join(' / '));
  ok(tag + ': footer and its controls hold still for 30 frames across every toggle', flips > 0 && shifts.length === 0,
    flips + ' flips; ' + shifts.slice(0, 2).join(' / '));
  ok(tag + ': scrolled to its end, the last card ends above the footer', under.length === 0, under.join(' / '));
  if (w >= 960) {
    const look = () => fp.evaluate(() => ({ s: getComputedStyle(document.documentElement).getPropertyValue('--s').trim(),
      out: document.querySelector('.footstrip .foot-scale output').textContent.trim(),
      reset: getComputedStyle(document.querySelector('.footstrip .reset')).visibility,
      theme: JSON.parse(localStorage.getItem('phosphor.theme') || '{}').look?.scale,
      dpr: devicePixelRatio, zoom: visualViewport.scale }));
    const s0 = await look();
    ok(tag + ': the readout is the theme default at 100%, no Reset', s0.out === '100%' && s0.reset === 'hidden', JSON.stringify(s0));
    // A step rescales every rem on the page; the status row's box and the
    // scale group's right edge hold.
    const frames = await fp.evaluate(async () => {
      const box = () => [document.querySelector('.footstrip').getBoundingClientRect(), document.querySelector('.footstrip .foot-scale').getBoundingClientRect()]
        .map((r, i) => (i ? [r.right] : [r.left, r.top, r.width, r.height]).map((v) => Math.round(v)).join(',')).join(' | ');
      const out = [box()];
      document.querySelector('.footstrip [aria-label=Larger]').click();
      for (let n = 0; n < 30; n++) { await new Promise((r) => requestAnimationFrame(r)); out.push(box()); }
      return out;
    });
    const s1 = await look();
    ok(tag + ': + steps 10% and persists in the theme', s1.out === '110%' && Math.abs(s1.theme - 1.12 * 1.1) < 1e-9, JSON.stringify(s1));
    ok(tag + ': Reset shows off 100%; the status row and the scale group hold still for 30 frames', s1.reset === 'visible'
      && frames.every((f) => f === frames[0]), frames[0] + ' -> ' + (frames.find((f) => f !== frames[0]) || ''));
    // At one scale, Reset's slot is the same hidden or shown.
    const flip = await fp.evaluate(() => {
      const r = document.querySelector('.footstrip .reset');
      const box = () => [...document.querySelectorAll('.footstrip .foot-scale > *')]
        .map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.width].map(Math.round).join(','); }).join(' | ');
      const a = box();
      r.classList.add('off');
      const b = box();
      r.classList.remove('off');
      return [a, b, getComputedStyle(r).visibility];
    });
    ok(tag + ': Reset showing or hidden moves nothing', flip[0] === flip[1] && flip[2] === 'visible', JSON.stringify(flip));
    await fp.locator('.footstrip [aria-label=Smaller]').click();
    await fp.locator('.footstrip [aria-label=Smaller]').click();
    ok(tag + ': - steps down', (await look()).out === '90%', (await look()).out);
    await fp.locator('.footstrip .reset').click();
    const s2 = await look();
    ok(tag + ': Reset restores 100% and the default --s, and hides', s2.out === '100%' && s2.reset === 'hidden' && s2.s === s0.s,
      JSON.stringify(s2));
    // The wheel lands on the status row's readout: a fixed point the page's
    // cards (ranges, charts) never cover, whatever the strip above measures.
    await fp.locator('.footstrip .foot-scale output').hover();
    await fp.keyboard.press('Control+Equal');
    const k1 = await look();
    await fp.keyboard.press('Control+0');
    const k0 = await look();
    ok(tag + ': Ctrl+= scales --s, Ctrl+0 resets, the page never zooms', k1.out === '110%' && k1.s !== s0.s && k0.out === '100%'
      && k1.dpr === s0.dpr && k1.zoom === s0.zoom, JSON.stringify([k1, k0]));
    await fp.keyboard.down('Control');
    await fp.mouse.wheel(0, -100);
    await fp.keyboard.up('Control');
    await fp.waitForTimeout(100);
    const w1 = await look();
    ok(tag + ': Ctrl+wheel up scales --s, the page never zooms', w1.out === '110%' && w1.s !== s0.s && w1.dpr === s0.dpr
      && w1.zoom === s0.zoom, JSON.stringify(w1));
    // A surface that takes the wheel itself (as the node editor's canvas
    // does: non-passive, default prevented), a range and a canvas.
    await fp.evaluate(() => {
      const mk = (tag, css) => { const el = document.createElement(tag); el.className = 'wheel-probe'; el.style.cssText = 'position:fixed;width:120px;height:60px;z-index:99;' + css; document.body.append(el); return el; };
      mk('div', 'left:20px;top:200px;background:#333').addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
      const r = mk('input', 'left:160px;top:200px'); r.type = 'range';
      mk('canvas', 'left:300px;top:200px');
    });
    for (const [x, what] of [[80, 'a wheel-taking surface'], [220, 'a range'], [360, 'a canvas']]) {
      await fp.mouse.move(x, 230);
      await fp.keyboard.down('Control');
      await fp.mouse.wheel(0, -100);
      await fp.keyboard.up('Control');
      await fp.waitForTimeout(100);
      const o = await look();
      ok(tag + ': Ctrl+wheel over ' + what + ' leaves --s alone and the page unzoomed', o.s === w1.s && o.out === '110%'
        && o.dpr === s0.dpr && o.zoom === s0.zoom, JSON.stringify(o));
    }
    await fp.evaluate(() => document.querySelectorAll('.wheel-probe').forEach((e) => e.remove()));
  }
  await fctx.close();
}

// ---- ph-b5d: every strip control inside the viewport, nothing scrolls -------
for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [800, 600], [390, 844]]) {
  const tag = w + 'x' + h;
  const bctx = await browser.newContext({ viewport: { width: w, height: h } });
  await bctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await bctx.routeWebSocket(/:82\//, hub({}));
  const bp = await bctx.newPage();
  await bp.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await bp.waitForSelector('.strip .btn-override', { timeout: 15000 }).catch(() => {});
  await bp.waitForTimeout(400);
  const g2 = await bp.evaluate(() => {
    const ctl = [...document.querySelectorAll('.strip button')].filter((b) => b.getBoundingClientRect().width > 0
      && !b.closest('.status'));
    const out = ctl.filter((b) => b.getBoundingClientRect().right > innerWidth + 0.5 || b.getBoundingClientRect().left < -0.5)
      .map((b) => b.textContent.trim().replace(/\s+/g, ' '));
    const scrollers = [...document.querySelectorAll('.strip, .strip *')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX))
      .map((el) => el.className);
    return { n: ctl.length, out, scrollers, menu: !!document.querySelector('.strip .dock button.home-btn'),
      pair: document.querySelectorAll('.strip .btn-estop, .strip .btn-pause').length, strip: document.querySelector('.strip').getBoundingClientRect().height };
  });
  ok(tag + ': every strip control ends inside the viewport', g2.n >= 3 && g2.pair === 2 && g2.out.length === 0, JSON.stringify(g2));
  ok(tag + ': nothing in the strip scrolls sideways', g2.scrollers.length === 0, JSON.stringify(g2.scrollers));

  // ph-e82.21: mirrored, the e-stop outermost; inward Pause, Override,
  // Flip, Home (each only where it is inline at this width).
  const order = await bp.evaluate(() => {
    const x = (s) => { const e = document.querySelector('.strip .dock ' + s); const r = e && e.getBoundingClientRect(); return r && r.width ? r.left : null; };
    return ['.home-btn, .ops button', '.rw-flip', '.btn-override', '.btn-pause', '.btn-estop'].map(x);
  });
  const inline = order.filter((v) => v != null);
  ok(tag + ': the e-stop is outermost, then Pause, Override, Flip, Home inward',
    order[3] != null && order[4] != null && inline.every((v, i) => i === 0 || v > inline[i - 1]), JSON.stringify(order));

  // ph-e82.21: the numeral's glow paints inside the strip and is never cut
  // short of it. CSS blurs a shadow with a standard deviation of half its
  // blur radius; the box is the ink grown by that, for the strong layer.
  const glow = await bp.evaluate(() => {
    const v = document.querySelector('.strip .hn-primary .hn-val');
    if (!v) return null;
    // This hub streams no position, so the numeral reads stale ('--', no
    // glow). Light it the way a fresh sample does, at the padded width.
    v.closest('.hero-numerals').classList.remove('stale');
    v.textContent = '000.0';
    const nums = document.querySelector('.strip .nums');
    const strip = document.querySelector('.strip').getBoundingClientRect();
    const r = v.getBoundingClientRect(), n = nums.getBoundingClientRect();
    const cs = getComputedStyle(v);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const m = c.measureText(v.textContent);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    v.appendChild(probe);
    const base = probe.getBoundingClientRect().top;
    probe.remove();
    const blur = parseFloat((cs.textShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/) || [])[3] || 0);
    const sd = blur / 2;
    const box = { l: r.left - m.actualBoundingBoxLeft - sd, r: r.left + m.actualBoundingBoxRight + sd,
      t: base - m.actualBoundingBoxAscent - sd, b: base + m.actualBoundingBoxDescent + sd };
    const ins = (getComputedStyle(nums).clipPath.match(/inset\(([^)]*)\)/) || [, '0px'])[1].split(/\s+/).map(parseFloat);
    const [it, ir = it, ib = it, il = ir] = ins;
    const clip = { l: n.left + il, r: n.right - ir, t: n.top + it, b: n.bottom - ib };
    const inStrip = box.l >= strip.left - 0.5 && box.r <= strip.right + 0.5 && box.t >= strip.top - 0.5 && box.b <= strip.bottom + 0.5;
    const inClip = box.l >= clip.l - 0.5 && box.r <= clip.r + 0.5 && box.t >= clip.t - 0.5 && box.b <= clip.b + 0.5;
    const rnd = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Math.round(x)]));
    return { blur, inStrip, inClip, box: rnd(box), clip: rnd(clip), strip: rnd({ l: strip.left, r: strip.right, t: strip.top, b: strip.bottom }) };
  });
  ok(tag + ': the numeral glow box is inside the strip and inside its clip', !!glow && glow.blur > 0 && glow.inStrip && glow.inClip,
    JSON.stringify(glow));

  // ph-e82.21: the tape spans the rail, edge for edge, so its pixels are the
  // ruler's: border boxes and the inner boxes its percentages resolve in.
  const edges = await bp.evaluate(() => {
    const t = document.querySelector('.rail-tape-track'), h = document.querySelector('.spine-rail-host');
    if (!t || !h) return null;
    const a = t.getBoundingClientRect(), b = h.getBoundingClientRect();
    return { tape: [a.left, a.right, a.left + t.clientLeft, a.left + t.clientLeft + t.clientWidth],
      ruler: [b.left, b.right, b.left + h.clientLeft, b.left + h.clientLeft + h.clientWidth] };
  });
  ok(tag + ': the tape and the ruler share left and right edges', !!edges
    && edges.tape.every((v, i) => Math.abs(v - edges.ruler[i]) < 0.5), JSON.stringify(edges));
  if (g2.menu) {
    await bp.waitForSelector('.strip .hn-col', { timeout: 5000 }).catch(() => {});
    await bp.waitForTimeout(500);   // the rail's numerals move the one-row budget
    const before = await bp.evaluate(() => document.querySelector('.strip').getBoundingClientRect().height);
    await bp.click('.strip .dock button.home-btn');
    const m = await bp.evaluate(() => {
      const pop = document.querySelector('.strip .menu-pop');
      const r = pop && pop.getBoundingClientRect();
      return { open: !!pop, inside: !!r && r.left >= -0.5 && r.right <= innerWidth + 0.5, items: pop ? pop.querySelectorAll('button').length : 0,
        strip: document.querySelector('.strip').getBoundingClientRect().height };
    });
    ok(tag + ': the Home control opens its popover on screen, the strip does not move', m.open && m.inside && m.items >= 2
      && m.strip === before, JSON.stringify([m, before]));
    await bp.keyboard.press('Escape');
  }
  await bctx.close();
}

// ---- ph-vdk.48: the RENDERING §12.1 floor is the shell's minimum window -------
{
  const win = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).app.windows[0];
  ok('floor: the shell\'s minimum window is the derived floor', win.minWidth === FLOOR_W && win.minHeight === FLOOR_H,
    JSON.stringify([win.minWidth, win.minHeight, FLOOR_W, FLOOR_H]));
  const fctx = await browser.newContext({ viewport: { width: FLOOR_W, height: FLOOR_H } });
  await fctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await fctx.routeWebSocket(/:82\//, hub({}));
  const fp = await fctx.newPage();
  await fp.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('.strip .pair .btn-estop', { timeout: 15000 }).catch(() => {});
  await fp.waitForTimeout(400);
  const f = await fp.evaluate(() => ({
    pair: [...document.querySelectorAll('.strip .pair button')].map((b) => { const r = b.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, w: r.width, h: r.height }; }),
    strip: document.querySelector('.strip').getBoundingClientRect().height,
  }));
  ok('floor: e-stop and pause sit side by side at the 40 px target, on screen', f.pair.length === 2
    && f.pair.every((b) => b.w >= 40 && b.h >= 40 && b.l >= -0.5 && b.r <= FLOOR_W + 0.5)
    && Math.abs(f.pair[0].t - f.pair[1].t) < 0.5, JSON.stringify(f.pair));
  ok('floor: the strip takes at most half the window', f.strip <= FLOOR_H / 2, String(f.strip));
  await fctx.close();
}

// ---- the shell's close popover (ph-e82.17, ph-i7e) ---------------------------
// Below the whole top strip at the X's edge: it never covers the e-stop or
// pause (laws 1, 11), at desktop and phone width.
for (const [w, h] of [[1280, 800], [390, 844], [1440, 900]]) {
  const tag = 'close ' + w + 'x' + h;
  const cctx = await browser.newContext({ viewport: { width: w, height: h } });
  await cctx.addInitScript(TAURI_STUB);
  const cp = await cctx.newPage();
  await cp.goto('http://127.0.0.1:' + PORT + '/shell', { waitUntil: 'domcontentloaded' });
  await cp.waitForSelector('.linkbar.shell .sb-wbtn[aria-label=Close]', { timeout: 15000 });
  const box = (sel) => cp.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; }, sel);
  const bar0 = await box('.linkbar'), strip0 = await box('.strip');
  ok(tag + ': the window buttons sit inside the one-row bar', !!bar0 && Math.abs((await box('.sb-win')).h - bar0.h) < 0.5, JSON.stringify(bar0));
  await cp.click('.sb-wbtn[aria-label=Close]');
  const pop = await box('.sb-pop'), x = await box('.sb-wbtn[aria-label=Close]'), bar1 = await box('.linkbar'), strip1 = await box('.strip');
  const top = await box('.topstrip');
  ok(tag + ': the popover opens below the strip at the X\'s edge', !!pop && pop.top >= top.bottom - 0.5 && Math.abs(pop.right - x.right) < 1.5,
    JSON.stringify([pop, x, top]));
  const clear = await cp.evaluate(() => ['.topstrip .btn-estop', '.topstrip .btn-pause'].map((s) => {
    const b = document.querySelector(s).getBoundingClientRect(), p = document.querySelector('.sb-pop').getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !(p.left < b.right && p.right > b.left && p.top < b.bottom && p.bottom > b.top) && !!hit && !!hit.closest(s);
  }));
  ok(tag + ': the e-stop and pause stay uncovered', clear.every(Boolean), JSON.stringify(clear));
  ok(tag + ': the bar and the strip do not move', bar1.h === bar0.h && strip1.top === strip0.top, JSON.stringify([bar0, bar1, strip0, strip1]));
  if (w !== 1440) { await cctx.close(); continue; }
  ok('close: the hold button has focus, reads Close, never red', await cp.evaluate(() => {
    const b = document.activeElement;
    return b.classList.contains('sb-hold') && /close/i.test(b.textContent) && !/255, 71, 87/.test(getComputedStyle(b).color + getComputedStyle(b).borderColor);
  }));
  await cp.keyboard.press('Escape');
  ok('close: Escape cancels and returns focus to the X', await cp.evaluate(() => !document.querySelector('.sb-pop')
    && document.activeElement.getAttribute('aria-label') === 'Close'));
  await cp.click('.sb-wbtn[aria-label=Close]');
  await cp.mouse.click(720, 600);
  ok('close: a click outside cancels', await cp.evaluate(() => !document.querySelector('.sb-pop')));
  await cctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the top strip stacks.'));
process.exit(fails ? 1 : 0);
