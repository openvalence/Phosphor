/**
 * keys.test.mjs -- ph-vdk.60.11: the key table, F1 key help, F3 look-for and
 * the rail's Alt-drag.
 *
 *   table    every binding in src/model/keys.js exists in the file it names
 *            (a grep-level probe per entry; an entry without a probe fails)
 *   help     F1 opens the table and keeps the browser's help shut; F1 and
 *            Escape close it; focus returns; nothing in the layout moves; the
 *            panel sits inside the viewport at full (two columns) and glance
 *   look     F3 and Ctrl+F open the palette and keep the find bar shut;
 *            typing narrows; Enter jumps to a control on another page and
 *            focuses it; the locate sweep runs on the field's ring, then is
 *            gone; Escape returns focus; nothing in the layout moves
 *   rail     a plain window drag writes as it goes; an Alt-drag writes
 *            nothing until release, then once; a cancelled one never
 *
 * The built app on a fake hub (Playwright's WebSocket route; the recorded
 * valencesim catalog pre-seeded in the etag cache). Build first
 * (`npm run build:only`).
 * Run: node test/keys.test.mjs [--shots <dir>]
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS } from '../../Valence/clients/js/frames.js';
import { catalogEtag, toHex } from '../../Valence/clients/js/sha256.js';
import { buildSettingsModel, WIDGET } from '../src/model/settings.js';
import { labelFor } from '../src/model/format.js';
import { KEYS } from '../src/model/keys.js';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const shot = (page, name, opts = {}) => (SHOTS ? page.screenshot({ path: join(SHOTS, name), ...opts }) : null);

// ---- table: one probe per entry, matched in the named file ------------------
console.log('[table] every binding in keys.js exists');
const PROBES = {
  'Global|F1': /e\.key === 'F1'/,
  'Global|F3, Ctrl+F': /key\.toLowerCase\(\) === 'f'[\s\S]*e\.key !== 'F3'/,
  'Global|Escape': /e\.key === 'Escape'/,
  'Global|Ctrl+Z': /e\.key\.toLowerCase\(\) !== 'z'[\s\S]*\(e\.shiftKey \? redo : undo\)\(\)/,
  'Global|Ctrl+Shift+Z': /e\.key\.toLowerCase\(\) !== 'z'[\s\S]*\(e\.shiftKey \? redo : undo\)\(\)/,
  'Global|F11': /e\.key === 'F11' && current\?\.page\?\.fields/,
  'Global|Escape|Fullscreen page': /e\.key === 'Escape' && full\.on/,
  'Global|Arrows': /onTablistKeydown[\s\S]*ArrowDown[\s\S]*ArrowRight/,
  'Global|Ctrl+=, Ctrl+-': /e\.key === '=' \|\| e\.key === '\+' \? 1 : e\.key === '-' \? -1/,
  'Global|Ctrl+0': /e\.key === '0' \? 0[\s\S]*setScale\(DEF\)/,
  'Global|Ctrl+wheel': /function onwheel[\s\S]*!e\.ctrlKey \|\| e\.defaultPrevented/,
  'Safety|Enter, Space': /e\.key === 'Enter' \|\| e\.key === ' '/,
  'Safety|Hold Enter, Space|Focused e-stop': /RELEASE_HOLD_MS/,
  'Safety|Hold Enter, Space|Close popover': /function start\(\) \{ holding = true; gate\.hold\(\)[\s\S]*e\.key === 'Enter' \|\| e\.key === ' '/,
  'Controls|Arrows|Slider, knob': /ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1/,
  'Controls|Page Up, Page Down': /PageUp: pageSteps, PageDown: -pageSteps/,
  'Controls|Home, End': /e\.key === 'Home' \|\| e\.key === 'End'/,
  'Controls|Alt+drag|Slider, knob, range': /deferring\(drag\)[\s\S]*dragWrite\('lo'/,
  'Controls|Shift+drag': /dragGain\(e, 1\)/,
  'Controls|Ctrl+drag': /modSnap\(snap\(knobDrag\.v\), e/,
  'Controls|Shift+Arrows': /nudge\(dir, e\)/,
  'Controls|Ctrl+Arrows': /modStep\(e, step, field\.min, field\.max\)/,
  'Controls|Wheel': /e\.shiftKey \? 1 : Math\.max\(1, Math\.round\(pageSteps \/ 10\)\)/,
  'Controls|Arrows|Option buttons': /function segKey/,
  'Controls|Hold': /function holdStart/,
  'Rail|Arrows|Jog tape': /function onTapeKey[\s\S]*ArrowRight/,
  'Rail|Page Up, Page Down': /function onTapeKey[\s\S]*PageUp/,
  'Rail|Home, End|Jog tape': /function onTapeKey[\s\S]*e\.key === 'Home'/,
  'Rail|Arrows|Stroke window': /function onBandKey[\s\S]*ArrowRight/,
  'Rail|Arrows, Page Up, Page Down': /function onHandleKey[\s\S]*PageUp/,
  'Rail|Home, End|Window, window edge': /function onBandKey[\s\S]*'Home'[\s\S]*function onHandleKey[\s\S]*'Home'/,
  'Rail|Alt+drag': /deferring\(e\)[\s\S]*moveHeld = deferring\(e\)/,
  'Grid|Ctrl+Z': /e\.key\.toLowerCase\(\) !== 'z'/,
  'Grid|Escape': /if \(pin \|\| marquee\)/,
  'Grid|Shift+drag, Ctrl+drag': /add: e\.shiftKey \|\| e\.ctrlKey/,
  'Grid|Arrows|Card handle': /function onGrabKeyDown[\s\S]*ArrowLeft/,
  'Grid|Shift+Arrows': /if \(e\.shiftKey\) onkeyresize/,
  'Grid|Enter': /key === 'Enter'.*keyLook\(\)/,
  'Grid|Delete, Backspace': /key === 'Delete' \|\| key === 'Backspace'/,
  'Grid|Shift+click, Ctrl+click': /onselect\(e\.shiftKey \|\| e\.ctrlKey/,
  'Grid|Arrows|Resize handle': /function onResizeKeyDown/,
  'Grid|F2, Double-click': /key === 'F2' && item\.retitle/,
  'Sidebar|F2, Double-click': /e\.key === 'F2'[\s\S]*startRename/,
  'Sidebar|Alt+Up, Alt+Down': /e\.altKey[\s\S]*ArrowUp[\s\S]*moveLayout/,
  'Sidebar|Hold Enter, Space': /use:hold=\{\{ ms: 1000/,
  'Phosphor panes|F2, Double-click|Hubs': /opensName/,
  'Phosphor panes|F2, Double-click|Buttplug': /e\.key === 'F2'\) nameFocus/,
  'Rail|Shift+drag': /dragGain\(e, 1\)/,
  'Rail|Ctrl+drag': /modSnap\(dragStartMin/,
  'Rail|Ctrl+Arrows': /e\.ctrlKey \? modSnap\(base, e, a, b, sgn, step\)/,
  'Funscript player|g': /k === 'g' && comp !== 'glance'/,
  'Funscript player|Up, Down': /export function split[\s\S]*ArrowUp: 1, ArrowDown: -1[\s\S]*e\.shiftKey \? 1 : 8/,
  'Funscript player|Ctrl+Arrows': /export function stepper[\s\S]*e && e\.ctrlKey \? snap\(value, e, lo, hi, dir, step\)/,
  'Node editor|Tab': /Tab reaches each node and socket/,
  'Node editor|Enter': /Enter on a socket starts or finishes a wire/,
  'Node editor|Arrows': /ArrowLeft: \[-1, 0\][\s\S]*e\.shiftKey \? 5 : 1/,
  'Node editor|Delete, Backspace': /e\.key === 'Delete' \|\| e\.key === 'Backspace'/,
  'Node editor|Ctrl+Z': /mod && k === 'z'/,
  'Node editor|Ctrl+Shift+Z, Ctrl+Y': /if \(e\.shiftKey\) R\.redo\(\)[\s\S]*mod && k === 'y'/,
  'Node editor|Ctrl+D': /mod && k === 'd'/,
  'Node editor|Ctrl+A': /mod && k === 'a'/,
  'Node editor|Shift+A, Right click': /e\.shiftKey && !mod && !e\.altKey && k === 'a'[\s\S]*oncontextmenu=\{menu\}/,
  'Node editor|Menu, Shift+F10': /e\.key === 'ContextMenu' \|\| \(e\.shiftKey && e\.key === 'F10'\)/,
  'Node editor|Drop a wire on canvas': /link-drag-search: released over empty canvas/,
  'Node editor|Type': /bind:value=\{q\}/,
  'Node editor|Up, Down': /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/,
  'Node editor|Right, Left': /e\.key === 'ArrowRight' && r\.head[\s\S]*e\.key === 'ArrowLeft'/,
  'Node editor|Enter|Add menu': /e\.key === 'Enter'\) \{ e\.preventDefault\(\); act\(r\)/,
  'Node editor|Escape|Add menu': /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); onclose\(\)/,
  'Node editor|Escape': /e\.key === 'Escape'\) \{ if \(cancel\(\)\)/,
  'Node editor|Wheel': /addEventListener\('wheel', wheel/,
};
const probeFor = (g, k) => PROBES[g.group + '|' + k.keys + '|' + k.where] || PROBES[g.group + '|' + k.keys];
for (const g of KEYS) {
  for (const k of g.items) {
    const re = probeFor(g, k);
    let src = '';
    try { src = readFileSync(new URL('../' + k.src, import.meta.url), 'utf8'); } catch (e) { /* missing file fails below */ }
    ok(g.group + ': ' + k.keys + ' (' + k.where + ') is bound in ' + k.src, !!re && re.test(src), re ? undefined : 'no probe');
  }
}
ok('keys.js wording is terse (under eight words per field)', KEYS.every((g) => g.items.every((k) =>
  [k.does, k.where].every((t) => t.split(/\s+/).length < 8 && !/\. /.test(t)))));

// ---- the app on a fake hub ---------------------------------------------------
const HTML = readFileSync(DIST_HTML);
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = toHex(catalogEtag(CAT, LIMITS.etag_bytes));
const ENTRIES = decodeCatalog(CAT);
const MODEL = buildSettingsModel(ENTRIES);

const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const hub = { values: {}, log: [], echoDelay: 0 };
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
function fieldValue(e, f) {
  const k = e.id + ':' + f.name;
  if (k in hub.values) return hub.values[k];
  if (f.role === 'meta.enabled_mask') return 0xff;
  if (f.default != null) return f.default;
  if (f.min != null && f.max != null) return f.min + (f.max - f.min) * 0.4;
  return 0;
}
function encodePacked(e) {
  const out = new Uint8Array(e.layout.reduce((a, f) => a + (SIZE[f.type] ?? f.declaredSize ?? 0), 0));
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of e.layout) {
    const v = fieldValue(e, f);
    const raw = f.type === PACKED.f32 || f.type === PACKED.bitfield8 ? v : Math.round(v * (f.scale || 1));
    switch (f.type) {
      case PACKED.u8: case PACKED.bitfield8: dv.setUint8(off, raw); break;
      case PACKED.i8: dv.setInt8(off, raw); break;
      case PACKED.u16: dv.setUint16(off, raw, true); break;
      case PACKED.i16: dv.setInt16(off, raw, true); break;
      case PACKED.u32: dv.setUint32(off, raw, true); break;
      case PACKED.i32: dv.setInt32(off, raw, true); break;
      case PACKED.f32: dv.setFloat32(off, v, true); break;
      default: break;
    }
    off += SIZE[f.type] ?? f.declaredSize ?? 0;
  }
  return out;
}
const cbAny = (v) => (typeof v === 'string' ? cbTstr(v) : typeof v === 'boolean' ? cbBool(v)
  : !Number.isInteger(v) ? cbF32(v) : v < 0 ? cbInt(v) : cbUint(v));
function fakeHub(ws) {
  const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  const pushState = (id) => {
    const e = ENTRIES.find((x) => x.id === id);
    if (e && e.layout) send(FRAME.STATE, id, encodePacked(e));
  };
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
            [IDENTITY_K.hub_name, cbTstr('Keys fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = [];
        for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
          const ch = w.get(K.channel_id);
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
            [K.channel_id, cbUint(ch)]]));
          pushState(ch);
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.INTENT) {
        const m = cbDecodeFull(payload);
        const ch = m.get(K.channel_id), id = m.get(K.intent_id);
        const val = [...m.get(K.value)].sort((a, b) => a[0] - b[0]);
        hub.log.push({ ch, val });
        const sts = ENTRIES.filter((e) => e.settingChannel === ch && e.layout);
        for (const [k, v] of val) {
          for (const st of sts) {
            const f = st.layout.find((x) => x.settingKey === k);
            if (f) hub.values[st.id + ':' + f.name] = v;
          }
        }
        const reply = () => {
          send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)],
            [K.applied, cbMap(val.map(([k, v]) => [k, cbAny(v)]))]]));
          for (const st of sts) pushState(st.id);
        };
        if (hub.echoDelay) setTimeout(reply, hub.echoDelay); else reply();
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

const browser = await chromium.launch();
async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([etag, hex]) => {
    try {
      if (sessionStorage.getItem('keys.seeded')) return;
      localStorage.clear();
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: hex }));
      sessionStorage.setItem('keys.seeded', '1');
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok('no page error', false, String(e)));
  page.on('console', (m) => { if (m.text().startsWith('[')) console.log('    page: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + PORT + '/');
  const up = await page.waitForSelector('[role=tab]', { timeout: 15000 }).then(() => true).catch(() => false);
  await sleep(600);
  // Recorded after the app's own window handlers, so it sees their preventDefault.
  await page.evaluate(() => addEventListener('keydown', (e) => {
    if (['F1', 'F3'].includes(e.key) || (e.ctrlKey && e.key === 'f')) (window.__prevented ||= {})[e.key] = e.defaultPrevented;
  }));
  return { ctx, page, up };
}
/** Every top-level box of the app, so an overlay that pushed anything shows. */
const layout = (page) => page.evaluate(() => [...document.querySelectorAll('.app > *, main.pane, nav')]
  .filter((e) => !e.matches('.ov-band')).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); }).join(' '));
/** Inside the viewport and clear of the top strip, so the stop stays reachable. */
const inView = (page, sel) => page.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  const strip = document.querySelector('.topstrip').getBoundingClientRect().bottom;
  const ok = r.left >= 0 && r.top >= strip && r.right <= innerWidth && r.bottom <= innerHeight;
  if (!ok) console.log(JSON.stringify([r.left, r.top, r.right, r.bottom, strip, innerWidth, innerHeight]));
  return ok;
}, sel);

// ---- help ---------------------------------------------------------------------
console.log('\n[help] F1 key help');
{
  const { ctx, page, up } = await open(1400, 900);
  ok('the app came up', up);
  const tab = page.locator('[role=tab][aria-selected=true]').first();
  await tab.focus();
  const before = await layout(page);
  await page.keyboard.press('F1');
  ok('F1 opens the key table', await page.locator('.kh').isVisible());
  ok('F1 keeps the browser help shut (default prevented)', await page.evaluate(() => window.__prevented?.F1 === true));
  ok('nothing in the layout moves', await layout(page) === before);
  ok('full: the panel is inside the viewport, below the top strip', await inView(page, '.kh'));
  ok('full: two columns', await page.locator('.kh-cols').evaluate((el) => getComputedStyle(el).columnCount) === '2');
  ok('full: every group is reachable by vertical scroll', await page.locator('.kh-list').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  ok('focus moves into the panel', await page.evaluate(() => !!document.activeElement.closest('.kh')));
  ok('the panel lists every group', (await page.locator('.kh h3').allTextContents()).join() === KEYS.filter((g) => g.items.some((k) => !k.src.startsWith('src/shell/'))).map((g) => g.group).join());
  // ph-gz8, ph-0wf: key names in text ink (never intent), each on one line;
  // no shell-only row on the served page; the panes' heading face.
  const kh = await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--tx-hi)';
    document.body.append(probe);
    const hi = getComputedStyle(probe).color;
    probe.remove();
    const kbds = [...document.querySelectorAll('.kh kbd')];
    const h2 = getComputedStyle(document.querySelector('.kh h2'));
    return { ink: kbds.every((k) => getComputedStyle(k).color === hi), wrapped: kbds.filter((k) => k.getClientRects().length > 1
      || k.getBoundingClientRect().height > parseFloat(getComputedStyle(k).lineHeight || '0') * 1.5).map((k) => k.textContent),
      shellRow: /Close Phosphor/.test(document.querySelector('.kh').textContent), head: h2.fontWeight + ' ' + h2.textTransform };
  });
  ok('key names in text ink, each on one line', kh.ink && kh.wrapped.length === 0, JSON.stringify(kh));
  ok('no shell-only row on the served page; the panes\' heading face', !kh.shellRow && kh.head === '500 uppercase', JSON.stringify(kh));
  const list = page.locator('.kh-list');
  const panelBox = await page.locator('.kh').boundingBox();
  ok('only the panel scrolls; the panel keeps its size',
    await list.evaluate((el) => getComputedStyle(el).overflowY === 'auto'), panelBox);
  await sleep(300);
  await shot(page, 'f1-full.png');
  await page.keyboard.press('F1');
  ok('F1 closes it', await page.locator('.kh').count() === 0);
  ok('focus returns to the opener', await page.evaluate(() => document.activeElement.getAttribute('role') === 'tab'
    && document.activeElement.getAttribute('aria-selected') === 'true'));
  await page.keyboard.press('F1');
  await page.keyboard.press('Escape');
  ok('Escape closes it', await page.locator('.kh').count() === 0);
  await ctx.close();
}
{
  const { ctx, page } = await open(230, 480);
  await page.keyboard.press('F1');
  ok('glance: the panel is inside the viewport, below the top strip', await page.locator('.kh').isVisible() && await inView(page, '.kh'));
  ok('glance: one column', await page.locator('.kh-list').evaluate((el) => getComputedStyle(el).columnCount) !== '2');
  ok('glance: the page itself does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await sleep(300);
  await shot(page, 'f1-glance.png');
  await ctx.close();
}

// ---- look ---------------------------------------------------------------------
console.log('\n[look] F3 look for a control');
{
  // A writable slider on a category page with a label no other field shares.
  const labels = MODEL.fields.map((f) => labelFor(f));
  let target = null;
  for (const c of MODEL.categories) {
    for (const g of c.groups) {
      if (g.diagnostic) continue;
      const f = g.fields.find((x) => !x.role && !x.readOnly && !x.advanced && x.widget === WIDGET.slider
        && labels.filter((l) => l.toLowerCase().includes(labelFor(x).toLowerCase())).length === 1);
      if (f) { target = { c, g, f, label: labelFor(f) }; break; }
    }
    if (target) break;
  }
  ok('the fixture has a uniquely named slider on a category page', !!target, target && target.label);
  const { ctx, page } = await open(1400, 900);
  const home = page.locator('[role=tab][data-tab-id=machine]');
  await home.focus();
  const before = await layout(page);
  await page.keyboard.press('F3');
  ok('F3 opens the palette', await page.locator('.lf').isVisible());
  ok('F3 keeps the find bar shut (default prevented)', await page.evaluate(() => window.__prevented?.F3 === true));
  ok('nothing in the layout moves', await layout(page) === before);
  ok('the palette is inside the viewport, its input focused', await inView(page, '.lf')
    && await page.evaluate(() => document.activeElement.classList.contains('lf-q')));
  const all = await page.locator('.lf-list [role=option]').count();
  await page.keyboard.type(target.label.slice(0, Math.max(3, Math.ceil(target.label.length / 2))));
  await sleep(100);
  const some = await page.locator('.lf-list [role=option]').count();
  ok('typing narrows the list', some > 0 && some < all, [all, some]);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(target.label);
  await sleep(100);
  const first = await page.locator('.lf-list [role=option]').first().textContent();
  ok('the match ranks first, label then path', first.startsWith(target.label) && first.includes(target.c.label), first);
  await shot(page, 'f3-palette.png');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  ok('Enter closes the palette', await page.locator('.lf').count() === 0);
  const sel = '.field[data-uid="' + target.f.uid + '"]';
  await page.waitForSelector(sel, { timeout: 3000 }).catch(() => {});
  ok('the jump switched to the control\'s page', await page.locator('[role=tab][aria-selected=true]').first().textContent()
    .then((t) => t.includes(target.c.label)));
  ok('the control holds focus', await page.evaluate((sel) => !!document.activeElement.closest(sel + ' input[type=range]'), sel),
    await page.evaluate(() => document.activeElement.outerHTML.slice(0, 120)));
  const sweep = page.locator(sel + ' svg.locate');
  ok('the locate sweep runs on the field\'s ring', await sweep.count() === 1);
  const geo = await page.evaluate((sel) => {
    const f = document.querySelector(sel).getBoundingClientRect(), s = document.querySelector(sel + ' svg.locate').getBoundingClientRect();
    return [s.left - f.left, s.top - f.top, s.right - f.right, s.bottom - f.bottom].map((v) => Math.round(v * 2) / 2);
  }, sel);
  ok('the sweep sits on the ring\'s line (4 px outside the box)', geo.join() === '-4,-4,4,4', geo);
  await sleep(700);
  if (SHOTS) {
    const b = await page.locator(sel).boundingBox();
    await page.screenshot({ path: join(SHOTS, 'f3-locate-sweep.png'), clip: { x: b.x - 24, y: b.y - 24, width: b.width + 48, height: b.height + 48 } });
  }
  ok('the sweep is still running at 0.7 s', await sweep.count() === 1);
  await sleep(1800);
  ok('...and gone after about 2 s', await sweep.count() === 0);

  await home.click();
  await sleep(300);
  await home.focus();
  await page.keyboard.press('Control+f');
  ok('Ctrl+F opens it too, default prevented', await page.locator('.lf').isVisible()
    && await page.evaluate(() => window.__prevented?.f === true));
  await page.keyboard.press('Escape');
  ok('Escape closes it and returns focus', await page.locator('.lf').count() === 0
    && await page.evaluate(() => document.activeElement.dataset.tabId === 'machine'));
  await ctx.close();
}

// ---- full index (ph-mdqo.12) ----------------------------------------------------
console.log('\n[index] F3 indexes every page and every layout, and rebuilds on change');
{
  const { ctx, page } = await open(1400, 900);
  const find = async (q) => {
    await page.keyboard.press('F3');
    await page.keyboard.type(q);
    await sleep(120);
    return page.locator('.lf-list [role=option]').allTextContents();
  };
  for (const name of ['Pairing', 'Log']) {
    const rows = await find(name);
    ok('a page is listed: ' + name, rows.some((r) => r.startsWith(name)), rows.slice(0, 3));
    await page.keyboard.press('Escape');
  }
  // A page whose search key sits on the control itself (funscript's buttons): F3 must focus it, not BODY.
  const onSelf = (await find('Invert')).findIndex((r) => /funscript/i.test(r));
  if (onSelf >= 0) {
    for (let i = 0; i < onSelf; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await sleep(500);
    ok('F3 focuses a control that carries the search key itself', await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
  } else console.log('  (no indexed page with a key on the control in this build; the check waits for funscript)');
  await page.keyboard.press('Escape');
  const before = await find('Zed layout');
  ok('a layout not yet saved is not listed', !before.some((r) => r.startsWith('Zed layout')), before.slice(0, 3));
  await page.keyboard.press('Escape');
  await page.locator('.sub-layout.add').click();
  await page.locator('input[aria-label="New layout name"]').fill('Zed layout');
  await page.keyboard.press('Enter');
  await sleep(300);
  const after = await find('Zed layout');
  ok('a layout saved while the app runs is listed without a reload', after.some((r) => r.startsWith('Zed layout')), after.slice(0, 3));
  await page.keyboard.press('Enter');
  await sleep(300);
  ok('Enter on a layout makes it the active one', await page.locator('.sub-layout.on').first().getAttribute('data-layout') === 'Zed layout');
  await ctx.close();
}

// ---- exclusive overlays (ph-ubwk) ---------------------------------------------
console.log('\n[overlays] F1, F3 and a confirm are one overlay at a time');
{
  const { ctx, page } = await open(1400, 900);
  const dialogs = () => page.locator('.kh, .lf, .overlay').count();
  await page.locator('[role=tab][aria-selected=true]').first().focus();
  await page.keyboard.press('F1');
  await page.keyboard.press('F3');
  ok('F1 then F3 leaves the look-for alone', await page.locator('.kh').count() === 0 && await page.locator('.lf').count() === 1, await dialogs());
  await page.keyboard.press('F1');
  ok('...and F1 then replaces it', await page.locator('.kh').count() === 1 && await page.locator('.lf').count() === 0);
  await page.keyboard.press('Escape');
  const flip = page.locator('.topstrip .rw-flip');
  if (await flip.count()) {
    await flip.click();
    await sleep(200);
    ok('a flip asks for a confirm', await page.locator('.overlay.hazard').count() === 1);
    await page.keyboard.press('F1');
    await page.keyboard.press('F3');
    ok('F1 and F3 do not open over a pending confirm', await page.locator('.kh, .lf').count() === 0 && await page.locator('.overlay.hazard').count() === 1);
    await page.keyboard.press('Escape');
    ok('one Escape closes the confirm', await dialogs() === 0);
    await page.keyboard.press('F3');
    await flip.click();
    await sleep(200);
    ok('a confirm opening closes an open look-for', await page.locator('.lf').count() === 0 && await page.locator('.overlay.hazard').count() === 1);
    await page.keyboard.press('Escape');
  } else console.log('  (no flip control in this fixture; confirm cases skipped)');
  await ctx.close();
}

// ---- history (ph-mdqo.11) -------------------------------------------------------
console.log('\n[history] the Changes feed, Undo, Revert changes and Ctrl+Z');
{
  const motion = MODEL.categories.find((c) => c.label === 'Motion');
  const sliders = motion.groups.flatMap((g) => (g.diagnostic ? [] : g.fields))
    .filter((f) => !f.readOnly && !f.role && f.widget === WIDGET.slider).slice(0, 3);
  const gen = MODEL.categories.find((c) => c.label === 'Generator');
  const { ctx, page } = await open(1400, 900);
  const sel = (f) => '.field[data-uid="' + f.uid + '"]';
  const valueOf = (f) => hub.values[f.channelId + ':' + f.name];
  const setTo = async (f, frac) => {
    const v = f.min + Math.round((f.max - f.min) * frac / (f.step || 1)) * (f.step || 1);
    await page.locator(sel(f) + ' input[type=range]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await page.waitForFunction((s) => document.querySelector(s)?.dataset.shadow === 'confirmed', sel(f), { timeout: 4000 }).catch(() => {});
    await sleep(1100);
    return v;
  };
  const start = sliders.map((f) => valueOf(f) ?? f.dflt);
  await page.locator('[role=tab]', { hasText: 'Motion' }).first().click();
  if (sliders.some((f) => f.advanced)) await page.locator('button[data-tip="Show advanced"]').first().click();
  await page.waitForSelector(sel(sliders[0]), { timeout: 5000 });
  const set = [];
  for (const [i, f] of sliders.entries()) set.push(await setTo(f, [0.15, 0.6, 0.85][i]));
  const feed = async () => {
    await page.locator('[role=tab][data-tab-id=log]').first().click();
    await page.locator('[data-feed=changes]').click();
    return page.locator('#lp-feed-changes .line.change');
  };
  const rows = await feed();
  await sleep(200);
  await shot(page, 'changes-feed.png');
  ok('the Changes feed lists three rows', await rows.count() === 3, await rows.count());
  const texts = await rows.allTextContents();
  ok('...newest first, before to after', texts[0].includes(labelFor(sliders[2])) && texts[2].includes(labelFor(sliders[0])) && texts.every((t) => t.includes('\u2192')), texts);
  await rows.first().locator('.undo').click();
  await page.waitForFunction(() => document.querySelectorAll('#lp-feed-changes .line.change').length === 2, null, { timeout: 4000 }).catch(() => {});
  ok('Undo writes the before value and the row leaves', await page.locator('#lp-feed-changes .line.change').count() === 2
    && Math.abs(valueOf(sliders[2]) - start[2]) < 1e-3, [valueOf(sliders[2]), start[2]]);
  await page.locator('[role=tab]', { hasText: 'Generator' }).first().click();
  const run = page.locator('.run-btn');
  if (await run.count()) {
    await run.first().click();
    await sleep(500);
    await page.locator('[role=tab][data-tab-id=log]').first().click();
    await page.locator('[data-feed=changes]').click();
    await sleep(100);
    await page.locator('button', { hasText: 'Revert changes' }).click();
    await page.waitForSelector('.overlay.hazard', { timeout: 3000 });
    ok('Revert asks first, with the count', /Writes 2 settings/.test(await page.locator('.overlay.hazard').textContent()));
    await page.locator('.overlay.hazard .og-btn.confirm').click();
    await sleep(1500);
    ok('Revert restores the remaining settings', Math.abs(valueOf(sliders[0]) - start[0]) < 1e-3 && Math.abs(valueOf(sliders[1]) - start[1]) < 1e-3,
      [valueOf(sliders[0]), start[0], valueOf(sliders[1]), start[1]]);
    ok('...and says in one line that the run switch was skipped', /Skipped.*running/i.test(await page.locator('.pane-status').textContent()),
      await page.locator('.pane-status').textContent());
  } else console.log('  (no run button in this fixture; the revert cases are skipped)');
  // Ctrl+Z outside a text field undoes; inside one it does not.
  const before = hub.log.length;
  await page.locator('[role=tab]', { hasText: 'Motion' }).first().click();
  await page.waitForSelector(sel(sliders[0]), { timeout: 5000 });
  const v9 = await setTo(sliders[0], 0.9);
  const n0 = hub.log.length;
  await page.locator(sel(sliders[0]) + ' input.chip-num').focus();
  await page.keyboard.press('Control+z');
  await sleep(600);
  ok('Ctrl+Z in a text input does not undo', hub.log.length === n0, [hub.log.length, n0]);
  await page.locator('[role=tab][aria-selected=true]').first().focus();
  await page.keyboard.press('Control+z');
  await sleep(900);
  ok('Ctrl+Z elsewhere undoes the latest write', hub.log.length > n0 && Math.abs(valueOf(sliders[0]) - start[0]) < 1e-3, [valueOf(sliders[0]), start[0]]);
  await page.keyboard.press('Control+Shift+z');
  await sleep(900);
  ok('Ctrl+Shift+Z redoes it', Math.abs(valueOf(sliders[0]) - v9) < 1e-3 && hub.log.length > n0 + 1, [valueOf(sliders[0]), v9]);
  void before;
  // A drag whose echoes lag: the first write's echo lands after newer writes took the shadow.
  hub.echoDelay = 350;
  await page.locator('[role=tab][data-tab-id=log]').first().click();
  await page.locator('[data-feed=changes]').click();
  const nBefore = await page.locator('#lp-feed-changes .line.change').count();
  await page.locator('[role=tab]', { hasText: 'Motion' }).first().click();
  await page.waitForSelector(sel(sliders[1]), { timeout: 5000 });
  const from = valueOf(sliders[1]);
  const lo = sliders[1].min, hi = sliders[1].max, stp = sliders[1].step || 1;
  const pts = [0.2, 0.4, 0.7].map((fr) => lo + Math.round((hi - lo) * fr / stp) * stp);
  for (const v of pts) {
    await page.locator(sel(sliders[1]) + ' input[type=range]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await sleep(120);
  }
  await sleep(1200);
  hub.echoDelay = 0;
  await page.locator('[role=tab][data-tab-id=log]').first().click();
  await page.locator('[data-feed=changes]').click();
  const texts2 = await page.locator('#lp-feed-changes .line.change').allTextContents();
  ok('a drag with delayed echoes is one entry', texts2.length === nBefore + 1, [texts2.length, nBefore]);
  const beforeNums = texts2[0].split('→')[0].match(/-?\d+(?:\.\d+)?/g) || [];
  ok('...from the value before the first write', Math.abs(parseFloat(beforeNums.at(-1)) - from) < 0.01, [texts2[0], from]);
  await ctx.close();
}

// ---- rail ---------------------------------------------------------------------
console.log('\n[rail] Alt-drag on the stroke window');
{
  const { ctx, page } = await open(1400, 900);
  const band = page.locator('.rail-band');
  const have = await band.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  ok('the rail shows its window', have);
  if (have) {
    await page.waitForFunction(() => document.querySelector('.rail-band')?.getAttribute('aria-disabled') === 'false', null,
      { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => addEventListener('pointerdown', (e) => { window.__pid = e.pointerId; }, true));
    const b = await band.boundingBox();
    const y = b.y + b.height / 2, x0 = b.x + b.width / 2;
    const drag = async (alt, dx, cancel = false) => {
      const n0 = hub.log.length;
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(x0, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(x0 + dx * i / 6, y); await sleep(80); }
      const mid = { n: hub.log.length - n0, shadow: await band.getAttribute('data-shadow') };
      if (cancel) await band.evaluate((el) => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__pid, bubbles: true })));
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
      await sleep(600);
      return { mid, after: hub.log.length - n0 };
    };
    const plain = await drag(false, 40);
    ok('a plain window drag writes as it goes', plain.after > 1, plain);
    const held = await drag(true, -40);
    ok('an Alt-drag writes nothing while held, and shows pending', held.mid.n === 0 && held.mid.shadow === 'pending', held);
    ok('...then writes once on release', held.after >= 1 && held.after <= 2, held);
    const gone = await drag(true, 40, true);
    ok('a cancelled Alt-drag writes nothing', gone.after === 0, gone);
  }
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS -- keys');
process.exit(fails ? 1 : 0);
