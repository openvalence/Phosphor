/**
 * quick-access.test.mjs -- the shell context menu, the right dock, field-bound
 * kit controls and the quick-access factory plugin (ph-kyjd, ph-5wsk.6), on
 * the shell bundle with the stub Tauri runtime and a fake hub that echoes,
 * holds or refuses writes on the recorded valencesim catalog. Asserts:
 *   native     a right-click outside text entry is prevented and opens the shell
 *              menu; in a text input it is left to the webview (cut, copy, paste)
 *   field      the description heads it; Copy path, Copy value, Paste value (a
 *              fitting clipboard value only), Reset to default, Send to node
 *              editor (phosphor-node-add, else the queue), Show in history
 *   keys       Shift+F10 opens it on the focused control, arrows and End move,
 *              Escape closes and returns focus
 *   page       Edit layout on the Dash, Show advanced on a category page
 *   plugin     Pin to quick access in module and field menus; the dock appears
 *              closed (nothing moves), opens on the user's act beside the
 *              content, never over the stop pair; pins persist per hub
 *              across a reload, reorder by keys and drag, unpin by menu and x,
 *              a vanished control is a quiet row; the rail pins as the mini
 *   laws       a pinned field: pending while held, the refusal, the gate words
 *              at watch tier, stale dims on a silent link
 *   phone      420x860: a drawer under the strip, the stop pair clear, nothing
 *              shifted, the quick rail pop-up over it, an outside tap closes it
 * Screenshots: 1428x900, 1024x768, 420x860, dark and Paper (test/evidence or --shots <dir>).
 *
 * Run: node test/quick-access.test.mjs [--shots <dir>]   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, NACK } from '../../Valence/clients/js/frames.js';
import { THEMES } from '../src/model/theme.js';
import { goTab } from './nav.mjs';
import { EVIDENCE } from './dist.mjs';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : EVIDENCE;
mkdirSync(SHOTS, { recursive: true });
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';   // desk | gate | mid | phone
const run = (name) => !ONLY || ONLY === name;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined && !c ? '  -- ' + JSON.stringify(extra) : '')); if (!c) fails++; };

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const HUB = '127.0.0.1:82';
// The Motion page's Oscillator card: role-less settings (uid keys) and a role readout.
const FREQ = '4416:frequency', DWELL = '4416:dwell_crest', ACTIVE = '4416:active';   // 0..20 (10), 0..4 (0), osc.active
const FREQ_KEY = 'uid:' + FREQ, DWELL_KEY = 'uid:' + DWELL, ACTIVE_KEY = 'role:osc.active', OSC = 'group:2:Oscillator';
const F = (uid) => '.field[data-uid="' + uid + '"]';
const PIN_PREF = 'plugin.quick-access.pins';

// ---- the fake hub: STATE from catalog defaults, writes echoed, held or refused ----
const hub = { mode: 'echo', held: [], values: {}, intents: [], roles: 2, silent: false };
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4, [PACKED.i32]: 4, [PACKED.f32]: 4,
  [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
const valueOf = (e, f) => { const k = e.id + ':' + f.name; return k in hub.values ? hub.values[k] : f.role === 'meta.enabled_mask' ? 0xff : f.default != null ? Number(f.default) : 0; };
function packed(e) {
  const out = new Uint8Array(e.layout.reduce((a, f) => a + (SIZE[f.type] ?? 0), 0));
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of e.layout) {
    const v = valueOf(e, f), raw = f.type === PACKED.f32 ? v : Math.round(v * (f.scale || 1));
    if (f.type === PACKED.u8 || f.type === PACKED.bitfield8) dv.setUint8(off, raw);
    else if (f.type === PACKED.i8) dv.setInt8(off, raw);
    else if (f.type === PACKED.u16) dv.setUint16(off, raw, true);
    else if (f.type === PACKED.i16) dv.setInt16(off, raw, true);
    else if (f.type === PACKED.u32) dv.setUint32(off, raw >>> 0, true);
    else if (f.type === PACKED.i32) dv.setInt32(off, raw, true);
    else if (f.type === PACKED.f32) dv.setFloat32(off, v, true);
    off += SIZE[f.type] ?? 0;
  }
  return out;
}
const cbAny = (v) => (typeof v === 'string' ? cbTstr(v) : typeof v === 'boolean' ? cbBool(v) : !Number.isInteger(v) ? cbF32(v) : v < 0 ? cbInt(v) : cbUint(v));
const sorted = (pairs) => cbMap(pairs.sort((a, b) => a[0] - b[0]));
function fakeHub(ws) {
  const send = (type, ch, payload) => { if (!hub.silent) try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  const push = (id) => { const e = ENTRIES.find((x) => x.id === id); if (e && e.layout) send(FRAME.STATE, id, packed(e)); };
  ws.onMessage((msg) => {
    if (typeof msg === 'string' || hub.silent) return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
          [K.roles, cbUint(hub.roles)], [K.deadman_ms, cbUint(1500)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('qa fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = [];
        for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)], [K.channel_id, cbUint(w.get(K.channel_id))]]));
          push(w.get(K.channel_id));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.INTENT) {
        const m = cbDecodeFull(payload), ch = m.get(K.channel_id), id = m.get(K.intent_id);
        const val = [...m.get(K.value)].sort((a, b) => a[0] - b[0]);
        hub.intents.push({ ch, val: Object.fromEntries(val) });
        const answer = () => {
          const touched = new Set();
          for (const [k, v] of val) {
            for (const st of ENTRIES.filter((e) => e.settingChannel === ch && e.layout)) {
              const f = st.layout.find((x) => x.settingKey === k);
              if (f) { hub.values[st.id + ':' + f.name] = v; touched.add(st.id); }
            }
          }
          send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)], [K.applied, cbMap(val.map(([k, v]) => [k, cbAny(v)]))]]));
          for (const t of touched) push(t);
        };
        if (hub.mode === 'hold') hub.held.push(answer);
        else if (hub.mode === 'nack') send(FRAME.NACK, ch, sorted([[K.code, cbUint(NACK.INVALID_VALUE)], [K.intent_seq, cbUint(header.seq)]]));
        else answer();
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}
// The written value of `uid` in the last intent on its channel.
const settingOf = (uid) => { const [ch, name] = uid.split(':'); const e = ENTRIES.find((x) => String(x.id) === ch); const f = e.layout.find((x) => x.name === name); return { ch: e.settingChannel, key: f.settingKey }; };
const lastWrite = (uid) => { const s = settingOf(uid); const w = [...hub.intents].reverse().find((i) => i.ch === s.ch && s.key in i.val); return w ? w.val[s.key] : undefined; };

const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';
const PAPER = THEMES.find((t) => t.id === 'paper');
const browser = await chromium.launch();

async function boot(viewport, { touch = false, theme = null, pins = null, keep = null } = {}) {
  const ctx = keep || await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  if (!keep) {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PAGE.slice(0, -1) });
    await ctx.addInitScript(TAURI_STUB);
    await ctx.addInitScript(([etag, bytes, th, pinsJson]) => {
      try {
        if (!sessionStorage.getItem('booted')) {
          sessionStorage.setItem('booted', '1');
          localStorage.clear();
          if (pinsJson) localStorage.setItem('plugin.quick-access.pins', pinsJson);
        }
        localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'qa fixture', nickname: '', lastSeen: Date.now() }]));
        if (th) localStorage.setItem('phosphor.theme', th);
      } catch (e) { /* no storage */ }
    }, [ETAG, Buffer.from(CAT).toString('hex'), theme ? JSON.stringify(theme) : null, pins ? JSON.stringify(pins) : null]);
    await ctx.routeWebSocket(/:82\//, fakeHub);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.hero-strip') && (document.querySelector('[data-tab-id="cat15"]') || document.querySelector('.menu-btn')), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

/** Right-click `sel` by a dispatched contextmenu (as the webview sends it): -> {prevented, menu} */
const rclick = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + Math.min(20, r.width / 2), clientY: r.top + Math.min(10, r.height / 2) });
  el.dispatchEvent(ev);
  const m = document.querySelector('.ui-menu:popover-open');
  return { prevented: ev.defaultPrevented, menu: !!m };
});
const menuState = (page) => page.evaluate(() => {
  const m = document.querySelector('.ui-menu:popover-open');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { title: m.querySelector('.ui-menu-t')?.textContent || '', desc: m.querySelector('.ui-menu-d')?.textContent || '',
    items: [...m.querySelectorAll('.ui-menu-i')].map((b) => (b.disabled ? '-' : '') + b.textContent),
    sections: [...m.querySelectorAll('.ui-menu-sec')].map((s) => s.textContent), rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
    focus: document.activeElement?.textContent || '' };
});
const pick = async (page, label) => { await page.locator('.ui-menu:popover-open .ui-menu-i', { hasText: label }).first().click(); await page.waitForTimeout(150); };
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const rect = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width) }; });
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const pins = (page) => page.evaluate((k) => (JSON.parse(localStorage.getItem(k) || 'null') || {})['127.0.0.1:82'] || [], PIN_PREF);
const shot = async (page, name) => { await page.waitForTimeout(300); return page.screenshot({ path: join(SHOTS, 'quick-access-' + name + '.png') }); };

// ---- desktop 1428x900 ---------------------------------------------------------------
console.log('\n--- desktop 1428x900 dark ---');
if (run('desk')) {
  const { ctx, page, errors } = await boot({ width: 1428, height: 900 });
  await goTab(page, 'cat2');
  await page.waitForSelector(F(FREQ));
  ok('no dock toggle and no dock before anything is pinned (hidden by default)', await page.locator('.dock-btn').count() === 0 && await page.locator('.side-dock').count() === 0,
    await page.evaluate(() => [document.querySelectorAll('.dock-btn').length, document.querySelectorAll('.side-dock').length, document.querySelector('.side-dock')?.outerHTML.slice(0, 200)]));

  // native
  const onLabel = await rclick(page, F(FREQ) + ' .field-label');
  ok('native: a right-click on a field is prevented and opens the shell menu', onLabel.prevented && onLabel.menu, onLabel);
  const m1 = await menuState(page);
  const label = (await page.locator(F(FREQ) + ' .field-label-text').textContent()).trim();
  ok('field: the menu heads with the field (its label, the hub description), Copy path, Copy value, Paste value, Reset to default, Send to node editor, Pin to quick access',
    !!m1 && m1.title === label && !!m1.desc && ['Copy path', 'Copy value', 'Send to node editor', 'Pin to quick access'].every((l) => m1.items.includes(l))
    && m1.items.some((l) => /Paste value/.test(l)) && m1.items.some((l) => /Reset to default/.test(l)), m1);
  ok('field: the card and the page follow as captioned sections (Oscillator, Motion)', !!m1 && m1.sections.includes('Oscillator') && m1.sections.includes('Motion'), m1 && m1.sections);
  ok('menu: the first item takes focus; it sits below the top strip and inside the window', !!m1 && m1.focus === 'Copy path'
    && m1.rect[1] >= (await rect(page, '.topstrip')).b && m1.rect[2] <= 1428 && m1.rect[3] <= 900, m1);
  await shot(page, '1428x900-dark-menu');
  await page.keyboard.press('Escape');
  const TXT = '.field input.chip-num, .field input[type=number], .field input[type=text]';
  if (await page.locator(TXT).count()) {
    const inText = await rclick(page, TXT);
    ok('native: in a text input the webview keeps its own menu (cut, copy, paste)', !inText.prevented && !inText.menu, inText);
  } else ok('native: a text input exists to check', false);

  // Copy path (uid and role identities), Copy value, Paste value only when it fits, Reset to default
  await rclick(page, F(FREQ) + ' .field-label');
  await pick(page, 'Copy path');
  ok('Copy path: valence://<hub>/<identity>, a role-less field by uid', await clip(page) === 'valence://' + HUB + '/' + FREQ_KEY, await clip(page));
  ok('Copy path says so in the status slot', /Path copied/.test(await page.locator('.topstrip').innerText()));
  await rclick(page, F(ACTIVE) + ' .field-label');
  await pick(page, 'Copy path');
  ok('Copy path: a field with a role by its role', await clip(page) === 'valence://' + HUB + '/' + ACTIVE_KEY, await clip(page));
  await rclick(page, F(FREQ) + ' .field-label');
  await pick(page, 'Copy value');
  ok('Copy value: the reported value', await clip(page) === '10', await clip(page));
  await rclick(page, F(DWELL) + ' .field-label');
  await page.waitForTimeout(500);
  ok('Paste value: a value past the field\'s bounds leaves it disabled with the reason', (await menuState(page)).items.includes('-Paste value')
    && await page.locator('.ui-menu-i', { hasText: 'Paste value' }).getAttribute('title') === 'no fitting value on the clipboard', await menuState(page));
  await page.keyboard.press('Escape');
  await page.evaluate(() => navigator.clipboard.writeText('3'));
  await rclick(page, F(DWELL) + ' .field-label');
  await page.waitForTimeout(500);
  ok('Paste value: enabled once the clipboard holds a fitting value', (await menuState(page)).items.includes('Paste value'), await menuState(page));
  await pick(page, 'Paste value');
  await page.waitForTimeout(400);
  ok('Paste value: writes it through the normal path (an intent of 3, echoed)', lastWrite(DWELL) === 3
    && await page.locator(F(DWELL)).getAttribute('data-shadow') === 'confirmed', hub.intents.slice(-2));
  await page.waitForTimeout(1100);
  await rclick(page, F(DWELL) + ' .field-label');
  await pick(page, 'Show in history');
  ok('Show in history: offered once the field has a write this session; the Log page opens on its Changes feed',
    await page.locator('[data-tab-id="log"][aria-selected="true"]').count() === 1 && /changes/i.test(await page.locator('main.pane [aria-selected="true"], main.pane .on').allInnerTexts().then((a) => a.join(' '))));
  await goTab(page, 'cat2');
  await page.waitForSelector(F(DWELL));
  await rclick(page, F(DWELL) + ' .field-label');
  await pick(page, 'Reset to default');
  await page.waitForTimeout(300);
  ok('Reset to default: writes the catalog default (0)', lastWrite(DWELL) === 0, hub.intents.slice(-1));
  await rclick(page, F(DWELL) + ' .field-label');
  ok('Reset to default: disabled at default', (await menuState(page)).items.includes('-Reset to default'), await menuState(page));

  // node editor: the event, then the queue
  await page.evaluate(() => { window.__nodes = []; window.addEventListener('phosphor-node-add', (e) => window.__nodes.push(e.detail.refs)); });
  await pick(page, 'Send to node editor');
  ok('Send to node editor: phosphor-node-add carries the field identity; untaken, it is queued', JSON.stringify(await page.evaluate(() => window.__nodes))
    === JSON.stringify([[{ kind: 'field', key: DWELL_KEY }]]) && /Queued for the node editor/.test(await page.locator('.topstrip').innerText()));
  await page.evaluate(() => window.addEventListener('phosphor-node-add', (e) => e.preventDefault()));
  await rclick(page, '.dash-cell[data-id="' + OSC + '"] .dash-title');
  await pick(page, 'Send fields to node editor');
  const sent = (await page.evaluate(() => window.__nodes)).at(-1).map((r) => r.key);
  ok('Send fields to node editor: the card\'s fields; a mounted editor takes them', /Sent to the node editor/.test(await page.locator('.topstrip').innerText())
    && sent.includes(FREQ_KEY) && sent.includes(DWELL_KEY) && sent.includes(ACTIVE_KEY), sent);

  // keys
  await page.locator(F(FREQ) + ' input[type=range]').focus();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(100);
  const k0 = await menuState(page);
  await page.keyboard.press('ArrowDown');
  const k1 = (await menuState(page))?.focus;
  await page.keyboard.press('End');
  const k2 = (await menuState(page))?.focus;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const back = await page.evaluate(() => document.activeElement?.closest('.field')?.dataset.uid || '');
  ok('keys: Shift+F10 opens it on the focused control; ArrowDown and End move; Escape closes and returns focus',
    !!k0 && k0.focus === 'Copy path' && k1 === 'Copy value' && k2 === k0.items.filter((l) => !l.startsWith('-')).at(-1) && !(await menuState(page)) && back === FREQ, { k0, k1, k2, back });

  // the page's own items
  await rclick(page, 'main.pane .pane-main');
  const pg = await menuState(page);
  ok('page: a category page offers Show advanced and Reset page to defaults', !!pg && pg.items.includes('Show advanced') && pg.items.some((l) => /Reset page to defaults/.test(l)), pg);
  await page.keyboard.press('Escape');
  await goTab(page, 'machine');
  await page.waitForTimeout(300);
  await rclick(page, 'main.pane .pane-main');
  ok('page: the Dash offers Edit layout', (await menuState(page))?.items.includes('Edit layout'), await menuState(page));
  await page.keyboard.press('Escape');

  // pin a card (module) and a field; the dock appears closed, nothing moves
  await goTab(page, 'cat2');
  await page.waitForSelector(F(FREQ));
  const content0 = await rect(page, '.content');
  await rclick(page, '.dash-cell[data-id="' + OSC + '"] .dash-title');
  ok('plugin: Pin to quick access in a card\'s menu', (await menuState(page))?.items.includes('Pin to quick access'), await menuState(page));
  await pick(page, 'Pin to quick access');
  await page.waitForTimeout(200);
  ok('plugin: the pin lands in prefs by identity, per hub', JSON.stringify(await pins(page)) === JSON.stringify([{ key: OSC, kind: 'module', title: 'Oscillator' }]), await pins(page));
  ok('dock: the toggle appears, the dock stays closed and the content does not move', await page.locator('.dock-btn').count() === 1
    && await page.locator('.side-dock').count() === 0 && JSON.stringify(await rect(page, '.content')) === JSON.stringify(content0));
  await rclick(page, F(FREQ) + ' .field-label');
  await pick(page, 'Pin to quick access');
  const pair0 = await rect(page, '.topstrip .pair');
  await page.click('.dock-btn');
  await page.waitForSelector('.side-dock .qa-pin');
  const dk = await rect(page, '.side-dock');
  ok('dock: opening narrows the content (the user\'s act), sits beside it, never over the stop pair', (await rect(page, '.content')).w < content0.w
    && dk.l >= (await rect(page, '.content')).r && !overlap(dk, await rect(page, '.topstrip .pair')) && JSON.stringify(pair0) === JSON.stringify(await rect(page, '.topstrip .pair')), { dk, pair0 });
  const tray = await page.evaluate(() => [...document.querySelectorAll('.side-dock .qa-pin')].map((c) => c.dataset.pin + '|' + (c.querySelector('.field') ? 'live' : 'none')));
  ok('tray: one column of the pinned modules, live, in pin order', JSON.stringify(tray) === JSON.stringify([OSC + '|live', FREQ_KEY + '|live']), tray);
  await shot(page, '1428x900-dark-dock');

  // laws on a pinned field
  const tf = '.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .field';
  hub.mode = 'hold';
  await page.locator(tf + ' input[type=range]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  ok('laws: a pinned field write is pending while the hub holds it', await page.locator(tf).getAttribute('data-shadow') === 'pending'
    && /waiting/.test(await page.locator(tf + ' .ladder').innerText()), await page.locator(tf).getAttribute('data-shadow'));
  hub.mode = 'echo';
  for (const a of hub.held.splice(0)) a();
  await page.waitForTimeout(300);
  ok('laws: the echo confirms it, and the page copy agrees', await page.locator(tf).getAttribute('data-shadow') === 'confirmed'
    && lastWrite(FREQ) !== undefined && lastWrite(FREQ) !== 10
    && await page.locator('main.pane ' + F(FREQ) + ' input[type=range]').inputValue() === await page.locator(tf + ' input[type=range]').inputValue());
  hub.mode = 'nack';
  await page.locator(tf + ' input[type=range]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  ok('laws: a refusal reads on the pinned field in words', await page.locator(tf).getAttribute('data-shadow') === 'fault'
    && /refused|INVALID/i.test(await page.locator(tf + ' .ladder').innerText()), await page.locator(tf + ' .ladder').innerText());
  hub.mode = 'echo';

  // reorder: keys on the grip, then a drag
  await page.locator('.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .qa-grip').focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(150);
  ok('reorder: ArrowUp on the grip moves the pin, in prefs and on screen', (await pins(page))[0].key === FREQ_KEY
    && await page.evaluate(() => document.querySelector('.side-dock .qa-pin').dataset.pin) === FREQ_KEY, await pins(page));
  const g = await rect(page, '.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .qa-grip');
  const last = await rect(page, '.side-dock .qa-pin:last-child');
  await page.mouse.move((g.l + g.r) / 2, (g.t + g.b) / 2);
  await page.mouse.down();
  await page.mouse.move((g.l + g.r) / 2, last.b - 4, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  ok('reorder: a drag on the grip drops it where the pointer is', (await pins(page)).at(-1).key === FREQ_KEY, await pins(page));

  // the rail pins as the mini, never a second rail
  const rails0 = await page.locator('.hero-slot').count();
  await rclick(page, '.hero-slot[data-hero="rail"]');
  await pick(page, 'Pin to quick access');
  await page.waitForTimeout(200);
  ok('rail: pinnable; the tray draws the mini rail, never a second rail', await page.locator('.side-dock .qa-pin[data-pin="hero:rail"] .mini').count() === 1
    && await page.locator('.hero-slot').count() === rails0);

  // persistence across a reload, then unpin by menu and by x
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.side-dock .qa-pin', { timeout: 15000 });
  await page.waitForTimeout(300);
  ok('persist: pins and the open dock survive a reload', (await page.locator('.side-dock .qa-pin').count()) === 3);
  await rclick(page, '.side-dock .qa-pin[data-pin="hero:rail"] .mini');
  ok('unpin: a pinned module\'s menu offers Unpin from quick access', (await menuState(page))?.items.includes('Unpin from quick access'), await menuState(page));
  await pick(page, 'Unpin from quick access');
  await page.locator('.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .qa-unpin').click();
  await page.waitForTimeout(150);
  ok('unpin: the menu and the x each remove one', JSON.stringify((await pins(page)).map((p) => p.key)) === JSON.stringify([OSC]), await pins(page));
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---- a vanished control, watch tier, a silent link ----------------------------------
console.log('\n--- missing source, gate, stale ---');
if (run('gate')) {
  hub.roles = 0;   // watch
  const { ctx, page, errors } = await boot({ width: 1428, height: 900 }, { pins: { [HUB]: [
    { key: FREQ_KEY, kind: 'field', title: 'Frequency' }, { key: 'role:nope.gone', kind: 'module', title: 'Old knob' }] } });
  await page.click('.dock-btn');
  await page.waitForSelector('.side-dock .qa-pin');
  ok('missing: a pin whose control is gone is one quiet row, unpinnable', await page.locator('.side-dock .qa-pin[data-pin="role:nope.gone"] [data-missing] .bound-missing').innerText()
    === 'Old knob · not on this machine' && await page.locator('.side-dock .qa-pin[data-pin="role:nope.gone"] .qa-unpin').count() === 1);
  const tf = '.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .field';
  ok('gate: at watch tier the pinned field is disabled and says why', await page.locator(tf).evaluate((e) => e.classList.contains('disabled'))
    && /not authorized/.test(await page.locator(tf + ' .ladder').textContent()),
    await page.locator(tf).evaluate((e) => [e.className, e.querySelector('.ladder')?.textContent, e.querySelector('.ladder')?.dataset.slot]));
  hub.silent = true;
  await page.waitForFunction((s) => document.querySelector(s)?.classList.contains('stale'), tf, { timeout: 8000 }).catch(() => {});
  ok('stale: a silent link dims the pinned field', await page.locator(tf).evaluate((e) => e.classList.contains('stale')));
  hub.silent = false;
  hub.roles = 2;
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---- 1024x768 and Paper ---------------------------------------------------------------
console.log('\n--- 1024x768 ---');
for (const theme of run('mid') ? [null, PAPER] : []) {
  const { ctx, page, errors } = await boot({ width: 1024, height: 768 }, { theme, pins: { [HUB]: [
    { key: 'group:2:Oscillator', kind: 'module', title: 'Oscillator' }, { key: FREQ_KEY, kind: 'field', title: 'Frequency' }, { key: 'hero:rail', kind: 'module', title: 'Rail' }] } });
  const pair0 = await rect(page, '.topstrip .pair');
  await page.click('.dock-btn');
  await page.waitForSelector('.side-dock .qa-pin');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok('1024x768' + (theme ? ' Paper' : '') + ': the dock opens beside the content, no horizontal overflow, the stop pair unmoved and clear',
    over <= 0 && !overlap(await rect(page, '.side-dock'), pair0) && JSON.stringify(pair0) === JSON.stringify(await rect(page, '.topstrip .pair')), { over });
  await rclick(page, '.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .field-label');
  await shot(page, '1024x768-' + (theme ? 'paper' : 'dark'));
  await page.keyboard.press('Escape');
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---- phone 420x860 ----------------------------------------------------------------------
console.log('\n--- phone 420x860 ---');
for (const theme of run('phone') ? [null, PAPER] : []) {
  const { ctx, page, errors } = await boot({ width: 420, height: 860 }, { touch: true, theme, pins: { [HUB]: [
    { key: FREQ_KEY, kind: 'field', title: 'Frequency' }, { key: 'hero:rail', kind: 'module', title: 'Rail' }] } });
  const t = (theme ? 'Paper' : 'dark');
  const pair0 = await rect(page, '.topstrip .pair'), main0 = await rect(page, 'main.pane');
  ok(t + ': the toggle sits in the top bar, the drawer closed', await page.locator('.linkbar .dock-btn').count() === 1 && await page.locator('.side-dock').count() === 0);
  await page.locator('.dock-btn').tap();
  await page.waitForSelector('.side-dock.drawer .qa-pin');
  const dk = await rect(page, '.side-dock.drawer'), strip = await rect(page, '.topstrip');
  ok(t + ': a drawer from the right edge under the strip; the stop pair clear and unmoved; the page not shifted', dk.r === 420 && dk.t >= strip.b - 1
    && !overlap(dk, pair0) && JSON.stringify(pair0) === JSON.stringify(await rect(page, '.topstrip .pair'))
    && JSON.stringify(main0) === JSON.stringify(await rect(page, 'main.pane')), { dk, strip, pair0 });
  ok(t + ': 40 px targets in the drawer', await page.evaluate(() => [...document.querySelectorAll('.side-dock .og-btn, .side-dock .qa-grip, .side-dock .qa-unpin')]
    .every((b) => { const r = b.getBoundingClientRect(); return r.height >= 39.5 && r.width >= 39.5; })));
  await page.locator('.side-dock .qa-pin[data-pin="hero:rail"] .mini').tap();
  await page.waitForTimeout(300);
  ok(t + ': the pinned mini opens the hero rail pop-up over the drawer, which stays open', await page.locator('.hero-inner.popup').count() === 1
    && await page.locator('.side-dock.drawer').count() === 1);
  await shot(page, '420x860-' + t.toLowerCase());
  await page.locator('.side-dock .qa-pin[data-pin="hero:rail"] .mini').tap();
  await page.waitForTimeout(200);
  await rclick(page, '.side-dock .qa-pin[data-pin="' + FREQ_KEY + '"] .field-label');
  const pm = await menuState(page);
  ok(t + ': the field menu opens over the drawer inside the window', !!pm && pm.rect[0] >= 0 && pm.rect[2] <= 420 && pm.items.includes('Unpin from quick access'), pm);
  await shot(page, '420x860-' + t.toLowerCase() + '-menu');
  await page.keyboard.press('Escape');
  await page.mouse.click(40, 700);
  await page.waitForTimeout(200);
  ok(t + ': a tap outside closes the drawer', await page.locator('.side-dock').count() === 0);
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\nFAIL -- ' + fails + ' assertion(s)' : '\nPASS -- quick access');
process.exit(fails ? 1 : 0);
