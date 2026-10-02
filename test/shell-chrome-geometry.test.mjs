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
 * Escape or a click outside cancels.
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
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS, NACK } from '../../Valence/clients/js/frames.js';
import { CORE_CHANNEL, SAFETY_OP } from '../../Valence/clients/js/generated/registry_vocab.js';
import { FLOOR_W, FLOOR_H } from '../src/model/rclass.js';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
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
  const bottomFixed = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return cs.position === 'fixed' && cs.pointerEvents !== 'none' && b.height > 0 && b.bottom >= innerHeight - 1;
  }).length;
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
ok('nothing fixed to the bottom edge', g.bottomFixed === 0, g.bottomFixed + ' element(s)');
// ph-wks: the notch inset must not depend on html.hivis.
const inset = await page.evaluate(() => [document.documentElement.classList.contains('hivis'),
  getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset-top').trim()]);
ok('--chrome-inset-top is defined without html.hivis', !inset[0] && inset[1] !== '', JSON.stringify(inset));
ok('served page: no shell chrome at all', await page.evaluate(() => !document.querySelector('.shell, .rail-sec.shell, [data-tab-id^="shell:"]')));

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
ok('phone: nothing fixed to the bottom edge', g.bottomFixed === 0, g.bottomFixed + ' element(s)');

// ---- the real shell bundle: the sidebar's Phosphor section (ph-e82.16) ------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(TAURI_STUB);
const sp = await ctx.newPage();
await sp.goto('http://127.0.0.1:' + PORT + '/shell', { waitUntil: 'domcontentloaded' });
await sp.waitForSelector('nav.rail .rail-sec.shell [role=tab]', { timeout: 15000 });
await sp.waitForTimeout(300);
const rect = (sel) => sp.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; }, sel);
const PANES = ['Hubs', 'Server', 'Settings', 'About'];

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
  const up = await hp.waitForSelector('.rail-tape-track[aria-disabled=false]', { timeout: 15000 }).then(() => true).catch(() => false);
  ok(tag + ': the fixture hub is adopted and the tape is live', up);
  if (!up) { await hctx.close(); continue; }
  await hp.waitForTimeout(300);
  const idle = await heights(hp);
  ok(tag + ': a long hub name ellipsizes in one bar row', idle.nameClipped, JSON.stringify(idle));
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
  ok(tag + ': pattern start flips visibility, both faces stay mounted', await faces() === 'visible:plan hidden:tape', await faces());
  await still('pattern stop', () => wire.send(FRAME.STATE, RUN.id, patternState(false)));
  ok(tag + ': pattern stop flips it back', await faces() === 'hidden:plan visible:tape', await faces());

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
    await bp.click('.strip .dock button.home-btn');
    const m = await bp.evaluate(() => {
      const pop = document.querySelector('.strip .menu-pop');
      const r = pop && pop.getBoundingClientRect();
      return { open: !!pop, inside: !!r && r.left >= -0.5 && r.right <= innerWidth + 0.5, items: pop ? pop.querySelectorAll('button').length : 0,
        strip: document.querySelector('.strip').getBoundingClientRect().height };
    });
    ok(tag + ': the Home control opens its popover on screen, the strip does not move', m.open && m.inside && m.items >= 2
      && m.strip === g2.strip, JSON.stringify(m));
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

// ---- the shell's close popover (ph-e82.17) -----------------------------------
{
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await cctx.addInitScript(TAURI_STUB);
  const cp = await cctx.newPage();
  await cp.goto('http://127.0.0.1:' + PORT + '/shell', { waitUntil: 'domcontentloaded' });
  await cp.waitForSelector('.linkbar.shell .sb-wbtn[aria-label=Close]', { timeout: 15000 });
  const box = (sel) => cp.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right, h: r.height }; }, sel);
  const bar0 = await box('.linkbar'), strip0 = await box('.strip');
  ok('shell: the window buttons sit inside the one-row bar', !!bar0 && Math.abs((await box('.sb-win')).h - bar0.h) < 0.5, JSON.stringify(bar0));
  await cp.click('.sb-wbtn[aria-label=Close]');
  const pop = await box('.sb-pop'), x = await box('.sb-wbtn[aria-label=Close]'), bar1 = await box('.linkbar'), strip1 = await box('.strip');
  ok('close: the popover opens anchored under the X', !!pop && Math.abs(pop.top - x.bottom) < 1.5 && Math.abs(pop.right - x.right) < 1.5,
    JSON.stringify([pop, x]));
  ok('close: the bar and the strip do not move', bar1.h === bar0.h && strip1.top === strip0.top, JSON.stringify([bar0, bar1, strip0, strip1]));
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
