/**
 * plugin-ui-kit.test.mjs -- api.ui, the plugin UI kit (docs/PLUGINS.md, The UI
 * kit; ph-5wsk), on the shell bundle with the stub Tauri runtime and a fake
 * hub on the recorded valencesim catalog. A probe plugin builds one of every
 * factory on a page; the kit-demo example loads beside it. Asserts:
 *   one look   the shared looks have one copy (style.css), no component restates them;
 *              every factory renders the shell's class markup
 *   values     each handle's value round-trips; a user's act calls back, a setter never does
 *   shifting   a state change moves no kit box
 *   touch      a vertical touch drag over a slider or a scrub scrolls and changes
 *              nothing; a tap changes nothing; a horizontal drag does (peeve 14)
 *   overlays   a sheet's and a popover's outside tap closes it and never reaches the
 *              page; a tap on the stop pair still fires (ph-5wsk.3)
 *   status     the footer slot at 420x860, its own row at 1428x900
 *   corners    with a 48 px corner radius, no sheet or fullscreen overlay content
 *              sits in a rounded-off corner
 *   bar        one row on the desktop; at 420 the center takes its own row, no
 *              horizontal overflow, 40 px targets
 * Screenshots: 1428x900 and 420x860, dark and Paper (test/evidence or --shots <dir>).
 *
 * Run: node test/plugin-ui-kit.test.mjs [--shots <dir>]   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { THEMES } from '../src/model/theme.js';
import { goTab } from './nav.mjs';
import { EVIDENCE } from './dist.mjs';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : EVIDENCE;
mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined && !c ? '  -- ' + JSON.stringify(extra) : '')); if (!c) fails++; };

// ---- one look: the shared looks have one copy ----------------------------------
console.log('\n--- one look ---');
{
  const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const css = src('src/style.css');
  const base = (sel) => new RegExp('(^|\\n)\\s*' + sel.replace(/[.[\]]/g, '\\$&') + '\\s*\\{');
  const SHARED = ['.field-label', '.field-label-text', '.field-value', '.value-input', '.stepper', '.stepper button', '.dash-title', '.foot-status'];
  ok('style.css holds the one base rule of each shared look', SHARED.every((s) => base(s).test(css)), SHARED.filter((s) => !base(s).test(css)));
  const comp = { 'src/ui/Field.svelte': ['.field-label', '.field-label-text', '.field-value', '.value-input', '.stepper', '.stepper button'],
    'src/ui/dash/DashItem.svelte': ['.dash-title'] };
  // A component's own state rules nest deeper (a container query); its base rules sit at the style block's first level.
  const esc = (sel) => sel.replace(/[.[\]]/g, '\\$&');
  const top = (sel) => new RegExp('\n  ' + esc(sel) + ' \\{');
  const restated = Object.entries(comp).flatMap(([f, sels]) => sels.filter((s) => top(s).test(src(f).replace(/\r/g, ''))).map((s) => f + ' ' + s));
  ok('no component restates a shared base look (Field, DashItem)', restated.length === 0, restated);
  ok('App.svelte keeps only the footer slot\'s flex on .foot-status', /\.foot-status \{ flex: 1 1 0; \}/.test(src('src/App.svelte'))
    && !/\.foot-status \{\s*\n\s*flex: 1 1 0;\s*\n\s*min-width/.test(src('src/App.svelte')));
}

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
            [IDENTITY_K.hub_name, cbTstr('kit fixture')]])],
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

// The probe: one of every factory on a page, every element on window.__k, every callback in window.__log.
const PROBE_SRC = `export function activate(api) {
  const ui = api.ui, log = window.__log = [];
  const on = (n) => (v) => log.push([n, v]);
  api.registerPage({ id: 'kit', label: 'Kit probe', status: true, mount(el) {
    const K = window.__k = {};
    K.btn = ui.button({ label: 'Go', icon: 'play', class: 'p-btn', onClick: () => log.push(['btn']) });
    K.tog = ui.button({ icon: 'graph', title: 'Graph', pressed: false, onClick: () => log.push(['tog', K.tog.pressed]) });
    K.seg = ui.segmented({ options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], value: 'a', onChange: on('seg') });
    K.tabs = ui.segmented({ tabs: true, options: [{ value: 'p', label: 'Player' }, { value: 'l', label: 'Library' }], value: 'p', onChange: on('tabs') });
    K.sw = ui.switch({ value: false, onChange: on('sw') });
    K.sl = ui.slider({ min: 0, max: 100, step: 1, value: 40, format: (v) => v + ' %', onChange: on('sl') });
    K.st = ui.stepper({ min: 0, max: 10, value: 3, onChange: on('st') });
    K.num = ui.stepper({ min: -500, max: 500, step: 5, value: 0, unit: 'ms', buttons: false, drag: true, label: 'Offset', onChange: on('num') });
    K.sel = ui.select({ options: [{ value: 'x', label: 'Ex' }, { value: 'y', label: 'Why' }], value: 'x', onChange: on('sel') });
    K.txt = ui.text({ type: 'search', placeholder: 'Search', label: 'Search', onChange: on('txt') });
    K.files = ui.files({ accept: '.json', onFiles: (f) => log.push(['files', f.length]) });
    K.rows = ui.rows({ title: 'Rows' });
    K.rows.append(ui.row({ label: 'Enabled', control: K.sw }), ui.row({ label: 'Speed', control: K.sl }),
      ui.row({ label: 'Count', control: K.st }), ui.row({ label: 'Mode', control: K.sel }));
    K.status = ui.status();
    K.sheet = ui.sheet({ title: 'Settings', onClose: () => { K.gear.pressed = false; log.push(['close']); } });
    K.gear = ui.button({ icon: 'gear', title: 'Settings', pressed: false, onClick: () => { K.sheet.open = K.gear.pressed; } });
    K.sheet.body.append(ui.button({ label: 'In sheet' }), ui.rows({ title: 'More' }));
    K.menuB = ui.button({ icon: 'more', title: 'Media', onClick: () => { K.menu.open = !K.menu.open; } });
    K.menu = ui.sheet({ form: 'popover', anchor: K.menuB });
    K.menu.body.append(ui.button({ label: 'Open video', icon: 'video', onClick: () => log.push(['menu']) }));
    K.scrub = ui.scrub({ max: 1000, value: 250, label: 'Seek', onSeek: (v, p) => log.push(['scrub', p, Math.round(v)]) });
    K.split = ui.split({ min: 40, max: 300, label: 'Resize', size: () => 100, onChange: (px, c) => log.push(['split', px, c]) });
    K.stage = ui.stage({ onTap: () => log.push(['tap']) });
    K.stage.empty.append(ui.button({ label: 'Open video', icon: 'video' }));
    K.stage.overlay.append(ui.bar({ left: [ui.button({ icon: 'play', title: 'Play', class: 'p-ovplay' })], right: [ui.button({ icon: 'unfull', title: 'Exit', class: 'p-ovexit' })] }));
    K.qr = ui.quickRail();
    K.bar = ui.bar({ left: [K.btn, K.tog], center: [K.scrub], right: [K.num, K.seg, K.qr, K.gear], drop: [K.seg, K.num] });
    const items = (p, per, n, form) => Array.from({ length: Math.max(0, Math.min(per, n - (p - 1) * per)) }, (_, i) =>
      ui.tile({ title: 'Item ' + ((p - 1) * per + i + 1), meta: '1:00', onClick: () => log.push([form, (p - 1) * per + i]) }));
    K.list = ui.list({ form: 'grid', count: (n) => n + ' items', onPage: (p, per) => K.list.show(items(p, per, 23, 'tile'), 23) });
    K.rlist = ui.list({ form: 'rows', onPage: (p, per) => K.rlist.show(items(p, per, 5, 'row'), 5), onMove: (a, b) => log.push(['move', a, b]) });
    const box = (l) => { const d = document.createElement('div'); d.style.height = '360px'; d.append(l); return d; };
    K.card = ui.card({ index: '01', title: 'Probe', actions: [K.menuB] });
    K.card.body.append(K.stage, K.bar, K.rows, K.tabs, K.txt, K.split, K.status);
    K.card2 = ui.card({ index: '02', title: 'List', caret: true });
    K.card2.body.append(box(K.list), box(K.rlist));
    K.slot = document.createElement('div');
    K.slotSheet = ui.sheet({ title: 'Slot', index: '03', slot: K.slot, class: 'p-slot', onClose: () => log.push(['slotclose']) });
    K.slotSheet.body.append(ui.button({ label: 'In slot' }));
    K.card2.body.append(K.slot);
    el.append(ui.page({ main: [K.card, K.card2] }), K.sheet, K.menu, K.files);
    K.status.set({ text: 'Ready' });
    return { update() {}, unmount() {} };
  } });
}`;
const PROBE = { dir: 'kit-probe', path: 'test/kit-probe', manifest: { name: 'kit-probe', version: '0', api: 1, kind: 'widget', entry: 'index.js', permissions: [] }, source: PROBE_SRC };
const DEMO = { dir: 'kit-demo', path: 'plugins/examples/kit-demo',
  manifest: JSON.parse(readFileSync(new URL('../plugins/examples/kit-demo/manifest.json', import.meta.url), 'utf8')),
  source: readFileSync(new URL('../plugins/examples/kit-demo/index.js', import.meta.url), 'utf8') };
const PROBE_ID = 'plugin:kit-probe:kit', DEMO_ID = 'plugin:kit-demo:demo';
const PAPER = THEMES.find((t) => t.id === 'paper');

const browser = await chromium.launch();
async function boot(viewport, { touch = false, theme = null } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript((list) => {
    const inner = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, a) => (cmd === 'plugins_list' ? Promise.resolve({ dir: 'test', plugins: list }) : inner(cmd, a));
  }, [PROBE, DEMO]);
  await ctx.addInitScript(([etag, bytes, th]) => {
    try {
      if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); localStorage.clear(); }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'kit fixture', nickname: '', lastSeen: Date.now() }]));
      localStorage.setItem('phosphor.plugins.pages.kit-probe', '1');
      localStorage.setItem('phosphor.plugins.pages.kit-demo', '1');
      if (th) localStorage.setItem('phosphor.theme', th);
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), theme ? JSON.stringify(theme) : null]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-tab-id="plugins"]') || (document.querySelector('.menu-btn') && document.querySelector('.hero-strip')), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await goTab(page, PROBE_ID);
  await page.waitForFunction(() => window.__k && window.__k.list.perPage > 0, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

const center = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, top: r.top, left: r.left }; });
const k = (page, fn, arg) => page.evaluate(fn, arg);
const log = (page) => page.evaluate(() => window.__log.slice());
const clearLog = (page) => page.evaluate(() => { window.__log.length = 0; });
// Every visible kit box by a stamped id: {id: 'x,y,w,h class'}; a value's own fill (the scrub's spans) is the value, not a box.
const RECTS = `(() => { window.__kid = window.__kid || 0; const out = {};
  for (const e of document.querySelectorAll('main.pane .ui-page [class*="ui-"], main.pane .ui-page .og-btn, main.pane .ui-page .field-label')) {
    if (e.className.baseVal !== undefined || !e.getClientRects().length || e.matches('.ui-scrub-track > i')) continue;
    if (!e.dataset.kid) e.dataset.kid = String(++window.__kid);
    const r = e.getBoundingClientRect();
    out[e.dataset.kid] = [r.x, r.y, r.width, r.height].map(Math.round).join(',') + ' ' + e.className;
  }
  return out; })()`;
/** Is any corner of rect r inside the rounded-off corner of a vw x vh screen with radius R? */
const inCorner = (r, vw, vh, R) => [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].some(([x, y]) => {
  const cx = x < R ? R : x > vw - R ? vw - R : null, cy = y < R ? R : y > vh - R ? vh - R : null;
  return cx != null && cy != null && Math.hypot(x - cx, y - cy) > R + 0.5;
});
async function touchDrag(page, from, to, steps = 8, holdMs = 0) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  await cdp.detach();
}

// ---- desktop 1428x900 ------------------------------------------------------------
console.log('\n--- desktop 1428x900 dark ---');
{
  const { ctx, page, errors } = await boot({ width: 1428, height: 900 });
  const marks = await k(page, () => {
    const K = window.__k, cls = (e, c) => e.classList.contains(c);
    return {
      btn: cls(K.btn, 'og-btn') && !!K.btn.querySelector('svg.ui-icon') && K.btn.querySelector('.ui-btn-l').textContent === 'Go',
      tog: K.tog.getAttribute('aria-pressed') === 'false' && K.tog.getAttribute('aria-label') === 'Graph',
      seg: cls(K.seg, 'og-seg') && K.seg.querySelector('button.active').textContent === 'Alpha' && K.seg.getAttribute('role') === 'radiogroup',
      tabs: K.tabs.getAttribute('role') === 'tablist' && K.tabs.querySelector('[aria-selected=true]').textContent === 'Player',
      sw: cls(K.sw, 'og-switch') && !!K.sw.querySelector('input[type=checkbox][role=switch] + .track'),
      sl: !!K.sl.querySelector('input[type=range]') && cls(K.sl.chip, 'field-value') && K.sl.chip.textContent === '40 %',
      st: cls(K.st, 'stepper') && !!K.st.querySelector('input.og-num') && K.st.querySelectorAll('button').length === 2,
      num: !K.num.querySelector('button') && K.num.querySelector('.unit').textContent === 'ms',
      sel: K.sel.tagName === 'SELECT' && K.sel.value === 'x',
      txt: cls(K.txt, 'value-input') && K.txt.type === 'search',
      files: K.files.type === 'file' && K.files.hidden && typeof K.files.open === 'function',
      rows: cls(K.rows, 'ui-rows') && K.rows.querySelectorAll('.ui-row > label.field-label').length === 4 && !!K.rows.querySelector('.card-sub'),
      rowFor: K.rows.querySelector('.ui-row label').htmlFor === K.sw.querySelector('input').id,
      card: cls(K.card, 'surface-card') && K.card.querySelector('.dash-title').dataset.pidx === '01' && K.card.querySelector('.dash-title').textContent === 'Probe',
      caret: !!K.card2.querySelector('.ui-caret[aria-expanded=true]'),
      sheet: cls(K.sheet, 'surface-card') && K.sheet.getAttribute('popover') === 'manual',
      status: cls(K.status, 'foot-status') && K.status.textContent === 'Ready',
      qr: K.qr.hasAttribute('data-quick-rail-toggle'),
      list: K.list.querySelectorAll('.ui-tile').length === K.list.perPage && K.list.querySelector('.ui-list-count').textContent === '23 items',
      rlist: K.rlist.dataset.form === 'rows' && K.rlist.querySelectorAll('.ui-tile').length === Math.min(5, K.rlist.perPage),
      stage: !!K.stage.querySelector('.ui-stage-box .ui-stage-media') && !K.stage.hasAttribute('data-full'),
    };
  });
  const bad = Object.entries(marks).filter(([, v]) => !v).map(([n]) => n);
  ok('render: every factory draws the shell control markup (og-btn, og-seg, og-switch, range + field-value chip, stepper, select, value-input, rows of field-label, surface-card + dash-title index, popover sheet, foot-status, quick rail, list tiles, stage)', bad.length === 0, bad);
  const look = await k(page, () => {
    const lab = getComputedStyle(document.querySelector('main.pane .ui-row .field-label'));
    const t = document.createElement('i'); t.style.color = 'var(--tx-mut)'; document.body.append(t); const mut = getComputedStyle(t).color; t.remove();
    return { tt: lab.textTransform, color: lab.color === mut, size: lab.fontSize };
  });
  ok('look: a row label is the shell field label (lowercase, --tx-mut)', look.tt === 'lowercase' && look.color, look);

  // values: setters redraw and never call back; a user's act calls back
  await clearLog(page);
  const set = await k(page, () => {
    const K = window.__k;
    K.sl.value = 70; K.sw.value = true; K.st.value = 7; K.seg.value = 'b'; K.sel.value = 'y'; K.tog.pressed = true; K.scrub.value = 500; K.num.value = 15;
    return { sl: K.sl.value === 70 && K.sl.chip.textContent === '70 %', sw: K.sw.value === true && K.sw.querySelector('input').checked,
      st: K.st.value === 7 && K.st.querySelector('input').value === '7', seg: K.seg.value === 'b' && K.seg.querySelector('.active').textContent === 'Beta',
      sel: K.sel.value === 'y', tog: K.tog.pressed === true && K.tog.classList.contains('on'), scrub: K.scrub.value === 500 && K.scrub.getAttribute('aria-valuenow') === '500',
      num: K.num.value === 15 && K.num.querySelector('input').value === '15', calls: window.__log.length };
  });
  ok('values: each setter round-trips and redraws, and none calls back', Object.values(set).slice(0, -1).every(Boolean) && set.calls === 0, set);
  await page.locator('main.pane .ui-row .og-switch').first().click();
  await page.locator('main.pane .ui-stepper:not(:has(.unit)) button[aria-label=Increase]').click();
  await page.locator('main.pane .og-seg:not([role=tablist]) button', { hasText: 'Alpha' }).click();
  await page.selectOption('main.pane .ui-row select', 'x');
  await page.locator('main.pane [role=tablist] button', { hasText: 'Library' }).click();
  await page.fill('main.pane .ui-text', 'query');
  await page.keyboard.press('Enter');
  await page.locator('main.pane .ui-text').blur();
  const sl = await center(page, 'main.pane .ui-row .ui-slider');
  await page.mouse.click(sl.left + sl.w * 0.25, sl.y);
  const nb = await center(page, 'main.pane .ui-dragnum');
  await page.mouse.move(nb.x, nb.y);
  await page.mouse.down();
  await page.mouse.move(nb.x + 40, nb.y, { steps: 5 });
  await page.mouse.up();
  const sc = await center(page, 'main.pane .ui-bar .ui-scrub');
  await page.mouse.click(sc.left + sc.w / 2, sc.y);
  await page.waitForTimeout(100);
  const L = await log(page);
  const has = (n, f = () => true) => L.some((e) => e[0] === n && f(e));
  ok('values: user acts call back with the new value (switch, stepper, segmented, select, tabs, text, slider click at 25 %, number drag 40 px = +50, scrub click)',
    has('sw', (e) => e[1] === false) && has('st', (e) => e[1] === 8) && has('seg', (e) => e[1] === 'a') && has('sel', (e) => e[1] === 'x')
    && has('tabs', (e) => e[1] === 'l') && has('txt', (e) => e[1] === 'query') && has('sl', (e) => Math.abs(e[1] - 25) <= 2)
    && has('num', (e) => e[1] === 65) && has('scrub', (e) => e[1] === 'start' && Math.abs(e[2] - 500) <= 20), L);
  await clearLog(page);
  await page.locator('main.pane .ui-btn[aria-label=Graph]').click();
  await page.locator('main.pane .ui-dragnum').focus();
  await page.keyboard.press('Control+ArrowUp');
  ok('values: a toggle flips before onClick; Ctrl+Arrow on a number snaps to the decade (DESIGN 10.5)',
    (await log(page)).some((e) => e[0] === 'tog' && e[1] === false) && await k(page, () => window.__k.num.value) === 100, await log(page));

  // no page shifting: every state change at once, every kit box measured before and after
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await page.mouse.move(1, 899);
  await page.waitForTimeout(200);
  const before = await page.evaluate(RECTS);
  await k(page, () => {
    const K = window.__k;
    K.status.set({ text: 'A very long status line that runs on past the end of the row and keeps going much further than the card', tone: 'warn' });
    K.tog.pressed = !K.tog.pressed; K.sl.value = 100; K.sl.value = 0; K.st.value = 10; K.seg.value = 'b'; K.sw.value = !K.sw.value;
    K.stage.center('pause'); K.list.note('Loading'); K.btn.disabled = true; K.scrub.buffered = 900; K.num.value = -500; K.tabs.value = 'p';
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(RECTS);
  // A box a state shows (the center glyph, the list note) is new, not moved; a box it hides would be a shift.
  const geo = (s) => s && s.split(' ')[0];
  const ids = Object.keys(before), moved = ids.filter((id) => geo(before[id]) !== geo(after[id]));
  ok('shifting: a state change moves or hides no kit box (' + ids.length + ' boxes)', ids.length > 20 && moved.length === 0,
    moved.slice(0, 4).map((id) => before[id] + ' -> ' + after[id]));
  await k(page, () => { const K = window.__k; K.btn.disabled = false; K.stage.center(null); K.list.note(''); K.status.set({ text: 'Ready' }); });

  // bar: one row here
  ok('bar: one row on the desktop, nothing dropped', await k(page, () => window.__k.bar.dataset.rows === '1' && !window.__k.bar.querySelector('.ui-dropped')));

  // status: its own row on the desktop, no footer slot
  ok('status: its own row at 1428x900, nothing in a footer slot', await k(page, () => {
    const s = window.__k.status; return !s.hasAttribute('data-routed') && s.getClientRects().length > 0 && !document.querySelector('.page-foot .foot-status');
  }));

  // the sheet: a drawer here; an outside tap closes it and never reaches the page; the stop pair still takes its tap
  await clearLog(page);
  await page.locator('main.pane .ui-btn[aria-label=Settings]').click();
  await page.waitForTimeout(200);
  const dr = await k(page, () => {
    const s = window.__k.sheet, r = s.getBoundingClientRect(), strip = document.querySelector('.topstrip').getBoundingClientRect();
    return { open: s.matches(':popover-open'), form: s.dataset.form, top: Math.round(r.top), strip: Math.round(strip.bottom), right: Math.round(innerWidth - r.right), pressed: window.__k.gear.pressed };
  });
  ok('sheet: the gear opens the right drawer below the top strip, the gear pressed', dr.open && dr.form === 'drawer' && dr.top >= dr.strip && dr.right === 0 && dr.pressed, dr);
  await shot(page, 'ui-kit-1428x900-dark-sheet.png');
  const go = await center(page, 'main.pane .p-btn');
  await page.mouse.click(go.x, go.y);
  await page.waitForTimeout(150);
  const shut = await k(page, () => ({ open: window.__k.sheet.matches(':popover-open'), pressed: window.__k.gear.pressed, log: window.__log.slice() }));
  ok('sheet: a tap outside closes it (onClose, the gear released) and never reaches the page beneath', !shut.open && !shut.pressed
    && shut.log.some((e) => e[0] === 'close') && !shut.log.some((e) => e[0] === 'btn'), shut);
  await page.locator('main.pane .ui-btn[aria-label=Settings]').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__pz = 0; document.querySelector('.topstrip .btn-pause').addEventListener('click', (e) => { window.__pz++; e.stopPropagation(); }); });
  const pz = await center(page, '.topstrip .btn-pause');
  await page.mouse.click(pz.x, pz.y);
  await page.waitForTimeout(150);
  ok('sheet: with it open, a tap on the stop pair\'s Pause reaches Pause (never swallowed, ph-5wsk.3)', await page.evaluate(() => window.__pz) === 1);
  await page.keyboard.press('Escape');
  await k(page, () => { window.__k.sheet.open = false; });

  // the popover menu: under its anchor; a pick closes it; an outside tap on the stage is no stage tap
  await clearLog(page);
  await page.locator('main.pane .ui-btn[aria-label=Media]').click();
  await page.waitForTimeout(150);
  const mp = await k(page, () => { const m = window.__k.menu, r = m.getBoundingClientRect(), a = window.__k.menuB.getBoundingClientRect(); return { open: m.matches(':popover-open'), below: r.top >= a.bottom - 1, expanded: window.__k.menuB.getAttribute('aria-expanded') }; });
  const stc = await center(page, 'main.pane .ui-stage');
  await page.mouse.click(stc.x, stc.top + 10);
  await page.waitForTimeout(400);
  const mo = await k(page, () => ({ open: window.__k.menu.matches(':popover-open'), log: window.__log.slice() }));
  ok('popover: opens under its anchor (aria-expanded); a tap on the stage closes it and is no stage tap', mp.open && mp.below && mp.expanded === 'true'
    && !mo.open && !mo.log.some((e) => e[0] === 'tap'), { mp, mo });
  await page.locator('main.pane .ui-btn[aria-label=Media]').click();
  await page.locator('.ui-sheet[data-form=popover] .og-btn', { hasText: 'Open video' }).click();
  await page.waitForTimeout(150);
  ok('popover: a pick acts and closes it', (await log(page)).some((e) => e[0] === 'menu') && !(await k(page, () => window.__k.menu.matches(':popover-open'))));

  // the stage: a tap after the double window; a double asks the shell's bare page fullscreen; Escape leaves
  await clearLog(page);
  await page.mouse.click(stc.x, stc.top + 10);
  await page.waitForTimeout(400);
  ok('stage: a single tap calls onTap once the double window passes', (await log(page)).filter((e) => e[0] === 'tap').length === 1, await log(page));
  await page.mouse.dblclick(stc.x, stc.top + 10);
  await page.waitForTimeout(400);
  const fs = await k(page, () => { const s = window.__k.stage, r = s.getBoundingClientRect(); return { full: s.hasAttribute('data-full'), bare: !!document.querySelector('main.pane.full.bare'), w: Math.round(r.width), h: Math.round(r.height), taps: window.__log.filter((e) => e[0] === 'tap').length }; });
  ok('stage: a double tap enters the shell\'s bare page fullscreen, the stage fills the window, no tap', fs.full && fs.bare && fs.w === 1428 && fs.h === 900 && fs.taps === 1, fs);
  await page.mouse.move(stc.x + 5, 400);
  await page.waitForTimeout(350);
  const ov = await k(page, () => { const o = window.__k.stage.overlay; return { show: window.__k.stage.hasAttribute('data-show'), op: getComputedStyle(o).opacity }; });
  await page.waitForTimeout(2800);
  const ov2 = await k(page, () => ({ show: window.__k.stage.hasAttribute('data-show') }));
  ok('stage: in fullscreen the overlay shows on pointer movement and hides after 2.5 s idle', ov.show && ov.op === '1' && !ov2.show, { ov, ov2 });
  await shot(page, 'ui-kit-1428x900-dark-fullscreen.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('stage: Escape leaves the fullscreen', !(await k(page, () => window.__k.stage.hasAttribute('data-full'))));

  // list paging and reorder
  const pg = await k(page, () => ({ per: window.__k.list.perPage, page: window.__k.list.querySelector('.ui-list-page').textContent }));
  await page.locator('main.pane .ui-list[data-form=grid] .ui-list-next').click();
  await page.waitForTimeout(100);
  const pg2 = await k(page, () => ({ page: window.__k.list.page, first: window.__k.list.querySelector('.ui-tile-t').textContent }));
  ok('list: pages fit whole tiles; next shows the next page', pg.per > 1 && /^page 1 \/ \d+$/.test(pg.page) && pg2.page === 2 && pg2.first === 'Item ' + (pg.per + 1), { pg, pg2 });
  await clearLog(page);
  const r1 = await center(page, 'main.pane .ui-list[data-form=rows] .ui-tile >> nth=0');
  const r3 = await center(page, 'main.pane .ui-list[data-form=rows] .ui-tile >> nth=2');
  await page.mouse.move(r1.x, r1.y);
  await page.mouse.down();
  await page.mouse.move(r1.x, r3.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const mv = await log(page);
  ok('list: a row drags to reorder (onMove 0 -> 2), and the drag is no pick', mv.some((e) => e[0] === 'move' && e[1] === 0 && e[2] === 2) && !mv.some((e) => e[0] === 'row'), mv);
  const fm = await k(page, async () => { const l = window.__k.list, per0 = l.perPage; l.form = 'rows'; await new Promise((r) => setTimeout(r, 50));
    const r = { form: l.dataset.form, per: l.perPage, rows: l.querySelectorAll('.ui-tile').length }; l.form = 'grid'; await new Promise((x) => setTimeout(x, 50)); return { ...r, per0, back: l.perPage }; });
  ok('list: the form switches live (grid to rows and back), the page refitted', fm.form === 'rows' && fm.per > 0 && fm.per !== fm.per0 && fm.rows === fm.per && fm.back === fm.per0, fm);

  // the slot form: a card in the plugin's slot on the desktop, in flow, no shadow, never in the top layer
  await clearLog(page);
  await k(page, () => { window.__k.slotSheet.open = true; });
  await page.waitForTimeout(150);
  const sl0 = await k(page, () => { const s = window.__k.slotSheet; return { form: s.form, inSlot: s.parentElement === window.__k.slot, top: s.matches(':popover-open'),
    shown: s.getClientRects().length > 0, shadow: getComputedStyle(s).boxShadow, pidx: s.querySelector('.dash-title').dataset.pidx }; });
  await page.locator('main.pane .p-slot .ui-sheet-x').click();
  await page.waitForTimeout(100);
  const sl1 = await k(page, () => ({ open: window.__k.slotSheet.open, shown: window.__k.slotSheet.getClientRects().length > 0, log: window.__log.slice() }));
  ok('sheet: auto with a slot is a card in the slot on the desktop (in flow, no shadow, not the top layer); its close button closes it',
    sl0.form === 'slot' && sl0.inSlot && !sl0.top && sl0.shown && sl0.shadow === 'none' && sl0.pidx === '03' && !sl1.open && !sl1.shown
    && sl1.log.some((e) => e[0] === 'slotclose'), { sl0, sl1 });

  // the example plugin mounts and its sheet holds its settings rows
  await goTab(page, DEMO_ID);
  await page.waitForTimeout(300);
  await page.locator('main.pane .ui-btn[aria-label=Settings]').click();
  await page.waitForTimeout(200);
  const demo = await k(page, () => ({ card: !!document.querySelector('main.pane .ui-card .dash-title[data-pidx="01"]'), bar: !!document.querySelector('main.pane .ui-bar'),
    status: document.querySelector('main.pane .ui-status')?.textContent, rows: document.querySelectorAll('.ui-sheet:popover-open .ui-row').length }));
  ok('kit-demo: the example page mounts its card, bar and status; its sheet holds the three settings rows', demo.card && demo.bar && demo.status === 'Ready' && demo.rows === 3, demo);
  await page.keyboard.press('Escape');
  ok('desktop: no page error', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

// ---- phone 420x860 ------------------------------------------------------------------
console.log('\n--- phone 420x860 dark (touch) ---');
{
  const { ctx, page, errors } = await boot({ width: 420, height: 860 }, { touch: true });
  const st = await k(page, () => ({ routed: window.__k.status.hasAttribute('data-routed'), hidden: !window.__k.status.getClientRects().length,
    foot: document.querySelector('.page-foot .foot-status')?.textContent }));
  ok('status: the footer slot at 420x860, nothing in place', st.routed && st.hidden && st.foot === 'Ready', st);
  await k(page, () => window.__k.status.set({ text: 'Moved on', tone: 'warn' }));
  await page.waitForTimeout(100);
  ok('status: a change reaches the footer slot with its tone', await page.evaluate(() => { const f = document.querySelector('.page-foot .foot-status'); return f && f.textContent === 'Moved on' && f.dataset.tone === 'warn'; }));

  const bar = await k(page, () => {
    const b = window.__k.bar, btns = [...b.querySelectorAll('.og-btn')].filter((e) => e.getClientRects().length);
    return { rows: b.dataset.rows, over: b.scrollWidth - b.clientWidth, minH: Math.min(...btns.map((e) => e.getBoundingClientRect().height)), dropped: b.querySelectorAll('.ui-dropped').length,
      docOver: document.documentElement.scrollWidth - innerWidth };
  });
  ok('bar: at 420 the center takes its own row, nothing overflows, targets stay at least 40 px', bar.rows === '2' && bar.over <= 0 && bar.minH >= 40 && bar.docOver <= 0, bar);
  const qr = await k(page, () => ({ mine: !window.__k.qr.hidden, foot: [...document.querySelectorAll('.page-foot .quick-rail')].filter((e) => e.getClientRects().length).length }));
  ok('quick rail: the page\'s Rail button shows on the phone class and the footer\'s own icon hides (one per screen)', qr.mine && qr.foot === 0, qr);

  // touch: a vertical drag scrolls and changes nothing; a tap changes nothing; a horizontal drag does
  await clearLog(page);
  await page.locator('main.pane .ui-row .ui-slider').scrollIntoViewIfNeeded();
  const s0 = await k(page, () => window.__k.sl.value);
  const a = await center(page, 'main.pane .ui-row .ui-slider');
  const y0 = await page.evaluate(() => scrollY);
  await touchDrag(page, { x: a.x, y: a.y }, { x: a.x + 12, y: a.y - 160 });
  const v1 = await k(page, () => ({ v: window.__k.sl.value, y: scrollY }));
  const a2 = await center(page, 'main.pane .ui-row .ui-slider');
  await touchDrag(page, { x: a2.x, y: a2.y }, { x: a2.x, y: a2.y }, 1);
  const v2 = await k(page, () => window.__k.sl.value);
  await touchDrag(page, { x: a2.x, y: a2.y }, { x: a2.x + 120, y: a2.y + 4 });
  const v3 = await k(page, () => window.__k.sl.value);
  ok('touch: a vertical swipe over a slider scrolls the page and leaves the value; a tap leaves it; a horizontal drag moves it',
    v1.v === s0 && v1.y > y0 && v2 === s0 && v3 > s0, { s0, v1, y0, v2, v3 });
  await page.locator('main.pane .ui-bar .ui-scrub').scrollIntoViewIfNeeded();
  const b = await center(page, 'main.pane .ui-bar .ui-scrub');
  await clearLog(page);
  await touchDrag(page, { x: b.x, y: b.y }, { x: b.x + 10, y: b.y - 160 });
  const sc1 = (await log(page)).filter((e) => e[0] === 'scrub').length;
  const b2 = await center(page, 'main.pane .ui-bar .ui-scrub');
  await touchDrag(page, { x: b2.x, y: b2.y }, { x: b2.x + 80, y: b2.y });
  const sc2 = (await log(page)).filter((e) => e[0] === 'scrub').length;
  ok('touch: a vertical swipe over a scrub never seeks; a horizontal drag does', sc1 === 0 && sc2 > 0, { sc1, sc2 });
  const st0 = await k(page, () => window.__k.st.value);
  await page.locator('main.pane .ui-stepper:not(:has(.unit)) button[aria-label=Increase]').scrollIntoViewIfNeeded();
  const p = await center(page, 'main.pane .ui-stepper:not(:has(.unit)) button[aria-label=Increase]');
  await touchDrag(page, { x: p.x, y: p.y }, { x: p.x, y: p.y - 140 }, 6);
  await page.waitForTimeout(700);
  ok('touch: a swipe that starts on a stepper button never nudges or repeats', await k(page, () => window.__k.st.value) === st0);

  // corners: a 48 px radius; the sheet's content and the fullscreen overlay's stay out of every rounded corner
  await page.evaluate(() => document.documentElement.style.setProperty('--corner-r', '48px'));
  await k(page, () => { window.__k.gear.pressed = true; window.__k.sheet.open = true; });
  await page.waitForTimeout(300);
  const sh = await k(page, () => {
    const s = window.__k.sheet, kids = [...s.querySelectorAll('button, .dash-title, .card-sub, .ui-sheet-grab')].filter((e) => e.getClientRects().length);
    return { form: s.dataset.form, rects: kids.map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, c: e.className }; }), vw: innerWidth, vh: innerHeight };
  });
  const shIn = sh.rects.filter((r) => inCorner(r, sh.vw, sh.vh, 48));
  ok('corners: the bottom sheet (auto on a phone upright) keeps its content out of a 48 px corner', sh.form === 'sheet' && sh.rects.length >= 3 && shIn.length === 0, { form: sh.form, shIn });
  ok('sheet: auto with a slot is the bottom sheet on a phone upright (the top layer)', await k(page, () => {
    const s = window.__k.slotSheet; s.open = true; const r = s.form === 'sheet' && s.matches(':popover-open'); s.open = false; return r; }));
  await shot(page, 'ui-kit-420x860-dark-sheet.png');
  // an outside tap on the stage: the sheet closes, no stage tap
  await clearLog(page);
  await page.locator('main.pane .ui-stage').scrollIntoViewIfNeeded().catch(() => {});
  const sg = await center(page, 'main.pane .ui-stage');
  await page.touchscreen.tap(sg.x, Math.max(sg.top + 8, 140));
  await page.waitForTimeout(400);
  const after = await k(page, () => ({ open: window.__k.sheet.matches(':popover-open'), log: window.__log.slice() }));
  ok('sheet: on the phone a tap outside closes it and is no stage tap', !after.open && !after.log.some((e) => e[0] === 'tap'), after);
  await k(page, () => { window.__k.stage.fullscreen = true; });
  await page.waitForTimeout(400);
  await page.mouse.move(200, 400);
  await k(page, () => window.__k.stage.poke());
  await page.waitForTimeout(250);
  const fo = await k(page, () => {
    const s = window.__k.stage, kids = [...s.querySelectorAll('.ui-stage-overlay .og-btn')].filter((e) => e.getClientRects().length);
    return { full: s.hasAttribute('data-full'), rects: kids.map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), vw: innerWidth, vh: innerHeight };
  });
  const foIn = fo.rects.filter((r) => inCorner(r, fo.vw, fo.vh, 48));
  ok('corners: the fullscreen overlay\'s buttons stay out of a 48 px corner', fo.full && fo.rects.length === 2 && foIn.length === 0, fo);
  await shot(page, 'ui-kit-420x860-dark-fullscreen.png');
  await k(page, () => { window.__k.stage.fullscreen = false; });
  await page.waitForTimeout(300);
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, 'ui-kit-420x860-dark.png', { fullPage: true });
  ok('phone: no page error', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

// ---- screenshots: Paper and the desktop dark page --------------------------------------
console.log('\n--- screenshots ---');
for (const [name, vp, theme, touch] of [['1428x900-dark', [1428, 900], null, false], ['1428x900-paper', [1428, 900], PAPER, false], ['420x860-paper', [420, 860], PAPER, true]]) {
  const { ctx, page, errors } = await boot({ width: vp[0], height: vp[1] }, { theme, touch });
  await shot(page, 'ui-kit-' + name + '.png', { fullPage: vp[0] < 600 });
  ok(name + ': renders with no page error', errors.length === 0 && !!(await page.$('main.pane .ui-page')), errors.slice(0, 3));
  await ctx.close();
}

async function shot(page, name, opts = {}) { await page.screenshot({ path: join(SHOTS, name), ...opts }); }

await browser.close();
srv.close();
console.log(fails ? '\nFAILURES: ' + fails : '\nall passed');
process.exit(fails ? 1 : 0);
