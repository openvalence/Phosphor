/**
 * console-panes.test.mjs -- the console panes (Pairing, Valence, Log,
 * Display) on the served bundle against a fake hub, and the shell panes
 * (Hubs, Server, Settings, About, Plugins) on the shell bundle with the stub
 * Tauri runtime (ph-vdk.57).
 *
 * Asserts the instrument-panel rules: every fact is a stable row, status
 * slots hold their height whether or not they carry text, lists keep their
 * rows when content arrives, and the pane-specific facts render what the
 * wire sent. The knock prompt stays off the Pairing pane and rises anywhere
 * else.
 *
 * Build first (`npm run build:only`).
 * Run: node test/console-panes.test.mjs   (no device needed)
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbBool, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import {
  encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS,
} from '../../Valence/clients/js/frames.js';
import { CORE_CHANNEL, LOG_EVENT_KIND, PAIRING_EVENT_KIND } from '../../Valence/clients/js/generated/registry_vocab.js';

const HTML = readFileSync(DIST_HTML);
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const toHex = (b) => Buffer.from(b).toString('hex');
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

// ---- packed STATE for the spec-core entries the panes read ------------------
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
function encodePacked(e, values) {
  const size = (f) => SIZE[f.type] ?? f.declaredSize ?? 0;
  const out = new Uint8Array(e.layout.reduce((a, f) => a + size(f), 0));
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of e.layout) {
    const v = values[f.name] ?? 0;
    switch (f.type) {
      case PACKED.u8: case PACKED.bitfield8: dv.setUint8(off, v); break;
      case PACKED.u16: dv.setUint16(off, v, true); break;
      case PACKED.u32: dv.setUint32(off, v >>> 0, true); break;
      case PACKED.str16: case PACKED.str32: case PACKED.str64: out.set(new TextEncoder().encode(String(v)).slice(0, size(f) - 1), off); break;
      default: break;
    }
    off += size(f);
  }
  return out;
}
const entry = (id) => ENTRIES.find((e) => e.id === id);

// ---- the fake hub ------------------------------------------------------------
const wire = { socket: null, roles: 2, intents: [], hold: false, answer: null };
function fakeHub(ws) {
  wire.socket = ws;
  const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  wire.send = send;
  ws.onMessage((msg) => {
    if (typeof msg === 'string') return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)],
            [WELCOME_LIMITS_K.max_sessions, cbUint(4)], [WELCOME_LIMITS_K.sessions_in_use, cbUint(2)]])],
          [K.roles, cbUint(wire.roles)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('panes fixture')], [IDENTITY_K.estop_cuts_power, cbBool(true)]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const m = cbDecodeFull(payload);
        const grants = [];
        for (const w of m.get(K.subscriptions) || []) {
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
            [K.channel_id, cbUint(w.get(K.channel_id))]]));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.INTENT) {
        const m = cbDecodeFull(payload);
        const ch = m.get(K.channel_id), id = m.get(K.intent_id), val = m.get(K.value);
        wire.intents.push({ ch, val });
        const op = [...val].find(([, v]) => typeof v === 'number');
        wire.answer = () => send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)],
          [K.applied, cbMap(op ? [[op[0], cbUint(op[1])]] : [])]]));
        if (!wire.hold) wire.answer();
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

const LOG = entry(CORE_CHANNEL.log);
const logKey = (name) => LOG.schema.find((f) => f.name === name).key;
function logLine(level, tag, message) {
  wire.send(FRAME.EVENT, CORE_CHANNEL.log, cbMap([[K.event_kind, cbUint(LOG_EVENT_KIND.entry)],
    [K.body, cbMap([[logKey('level'), cbUint(level)], [logKey('tag'), cbTstr(tag)], [logKey('message'), cbTstr(message)]])]]));
}

const browser = await chromium.launch();

async function boot(viewport, path = '/', shell = false, init = null) {
  const ctx = await browser.newContext({ viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:' + PORT });
  await ctx.addInitScript(([etag, bytes]) => {
    // First load only: a reload keeps what the page stored.
    try { if (!sessionStorage.getItem('booted')) { sessionStorage.setItem('booted', '1'); localStorage.clear(); } localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); }
    catch (e) { /* no storage */ }
  }, [ETAG, toHex(CAT)]);
  if (shell) await ctx.addInitScript(TAURI_STUB);
  if (init) await init(ctx);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + path, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}
const openTab = async (page, id) => {
  await page.waitForSelector('[data-tab-id="' + id + '"]', { timeout: 15000 });
  await page.click('[data-tab-id="' + id + '"]');
  await page.waitForTimeout(250);
};
const facts = (page) => page.$$eval('.pane-facts dt', (dts) => Object.fromEntries(dts.map((dt) =>
  [dt.textContent.trim().toLowerCase(), dt.nextElementSibling.textContent.trim()])));

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  console.log('\n--- console panes, ' + label + ' ---');
  const { ctx, page, errors } = await boot(viewport);

  // ---- Pairing -------------------------------------------------------------
  await openTab(page, 'pairing');
  await page.waitForFunction(() => /configure/.test(document.querySelector('.pane-facts dd')?.textContent || ''), null, { timeout: 15000 });
  // ph-09o: every section title sits on the page above its card, flush with
  // the card's edge; an empty status slot is one line, not a hole.
  const titles = await page.$$eval('main.pane .pane-sec', (ss) => ss.filter((s) => s.querySelector(':scope > .pane-head:first-child'))
    .map((s) => { const h = s.querySelector(':scope > .pane-head').getBoundingClientRect(), r = s.getBoundingClientRect();
      return { above: h.bottom <= r.top - 4, flush: Math.abs(h.left - r.left) < 0.5 }; }));
  const slots = await page.$$eval('main.pane .pane-status', (ps) => ps.map((p) => p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)));
  ok('pairing: section titles sit above their cards, flush with the edge', titles.length >= 3 && titles.every((t) => t.above && t.flush), JSON.stringify(titles));
  ok('pairing: a status slot is one line', slots.length > 0 && slots.every((n) => Math.abs(n - 1) < 0.05), JSON.stringify(slots));
  const knockRows = () => page.$$eval('.knocks > li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  const knocksBox = () => page.$eval('.knocks', (el) => el.getBoundingClientRect().height);
  const k0 = await knockRows();
  ok('pairing: the pending list holds pairing_pending_max rows while empty', k0.length === LIMITS.pairing_pending_max && k0.every((t) => /free/.test(t)), k0.join(' | '));
  const listH = await knocksBox();
  const statusTop = await page.$eval('section[aria-labelledby="pp-knocks"] .pane-status', (el) => el.getBoundingClientRect().top);
  const PEND = entry(CORE_CHANNEL.pending_pairing);
  wire.send(FRAME.STATE, PEND.id, encodePacked(PEND, { generation: 1, count: 1, inst_lo0: 0x11223344, inst_hi0: 0x55667788,
    kind0: 1, expires_s0: 90, name0: 'tablet' }));
  await page.waitForFunction(() => /tablet/.test(document.querySelector('.knocks')?.textContent || ''), null, { timeout: 5000 });
  const k1 = await knockRows();
  ok('pairing: no knock prompt over the pane that already shows the knock', await page.$$('.overlay').then((a) => a.length === 0));
  ok('pairing: a knock fills the first row, the rest stay', k1.length === LIMITS.pairing_pending_max && /tablet/.test(k1[0]) && /expires in \d+ s/.test(k1[0]), k1[0]);
  ok('pairing: the list does not grow or shift when a knock arrives',
    Math.abs(await knocksBox() - listH) < 1.5 && statusTop === await page.$eval('section[aria-labelledby="pp-knocks"] .pane-status', (el) => el.getBoundingClientRect().top),
    listH + ' -> ' + await knocksBox());
  wire.hold = true;
  wire.intents.length = 0;
  await page.click('.knocks > li >> nth=0 >> button:has-text("Approve")');
  await page.waitForTimeout(150);
  const pend = await page.textContent('section[aria-labelledby="pp-knocks"] .pane-status');
  ok('pairing: approve shows the pending rung with its reason', /Approving tablet: waiting for the hub/.test(pend), pend);
  const sent = wire.intents[0];
  ok('pairing: approve sends one admin intent on session-admin', sent && sent.ch === CORE_CHANNEL.session_admin && [...sent.val.values()].some((v) => v instanceof Uint8Array && v.length === 8));
  await page.waitForTimeout(700);
  const od = await page.$eval('section[aria-labelledby="pp-knocks"] .pane-status', (el) => [el.dataset.phase, el.textContent]);
  ok('pairing: a slow hub escalates to overdue', od[0] === 'overdue' && /still waiting/.test(od[1]), od.join(': '));
  wire.hold = false;
  wire.answer();
  await page.waitForTimeout(200);
  const done = await page.$eval('section[aria-labelledby="pp-knocks"] .pane-status', (el) => [el.dataset.phase, el.textContent]);
  ok('pairing: the echo settles the ladder', done[0] === 'settled' && /Approved tablet/.test(done[1]), done.join(': '));
  wire.send(FRAME.STATE, PEND.id, encodePacked(PEND, { generation: 2, count: 0 }));
  await page.waitForFunction(() => !/tablet/.test(document.querySelector('.knocks')?.textContent || ''), null, { timeout: 5000 });
  ok('pairing: the hub clearing the knock frees its row in place', (await knockRows()).length === LIMITS.pairing_pending_max && Math.abs(await knocksBox() - listH) < 1.5);
  wire.send(FRAME.EVENT, CORE_CHANNEL.pairing_events, cbMap([[K.event_kind, cbUint(PAIRING_EVENT_KIND.window_opened)]]));
  await page.waitForTimeout(1200);
  const pw = (await facts(page))['pairing window'];
  ok('pairing: the window state and countdown sit in their row', /open, about 1(19|20) s left/.test(pw), pw);
  const ledger = await page.$$eval('section[aria-labelledby="pp-ledger"] li', (ls) => ls.length);
  ok('pairing: the trust ledger lists every slot through Roster', ledger === entry(CORE_CHANNEL.paired_devices).store.capacity, String(ledger));

  // ---- Valence -------------------------------------------------------------
  await openTab(page, 'valence');
  await page.waitForFunction(() => [...document.querySelectorAll('.pane-facts dd')].some((d) => d.textContent.includes('panes fixture')), null, { timeout: 15000 });
  const f = await facts(page);
  ok('valence: session facts are rows', ['access tier', 'max sessions', 'sessions in use', 'e-stop cuts power', 'raw frames', 'publishes']
    .every((k) => k in f), Object.keys(f).join(', '));
  ok('valence: limits show what WELCOME sent', f['max sessions'] === '4' && f['sessions in use'] === '2', f['max sessions'] + '/' + f['sessions in use']);
  ok('valence: the catalog etag reads as the hub declared it', f.etag === ETAG.toLowerCase(), f.etag);
  ok('valence: estop_cuts_power reads E-Stop', /E-Stop/.test(f['e-stop cuts power']), f['e-stop cuts power']);
  const copyBtn = page.locator('section[aria-labelledby="vp-identity"] button', { hasText: 'Copy' });
  // Page coordinates: the click may scroll the button out from under the sticky chrome.
  const pageBox = () => copyBtn.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY }; });
  const before = await pageBox();
  await copyBtn.click();
  await page.waitForTimeout(150);
  const after = await pageBox();
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('valence: Copy puts the identity on the clipboard', clip.includes('panes fixture') && clip.includes('estop_cuts_power'), clip.slice(0, 60));
  ok('valence: the copy flash does not move the button', before && after && before.x === after.x && before.y === after.y);
  wire.send(FRAME.STATE, PEND.id, encodePacked(PEND, { generation: 3, count: 1, inst_lo0: 1, inst_hi0: 2, kind0: 1, expires_s0: 90, name0: 'phone' }));
  ok('pairing: off the Pairing pane a knock raises the prompt', await page.waitForSelector('.overlay:has-text("phone")', { timeout: 5000 }).then(() => true).catch(() => false));
  wire.send(FRAME.STATE, PEND.id, encodePacked(PEND, { generation: 4, count: 0 }));
  ok('pairing: the prompt leaves with the knock', await page.waitForSelector('.overlay', { state: 'detached', timeout: 5000 }).then(() => true).catch(() => false));
  if (label === 'phone') {
    const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !el.closest('.table-wrap');
    }).map((el) => el.tagName + '.' + el.className));
    ok('valence: no horizontal page scroll at phone width', await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), wide.slice(0, 4).join(' | '));
  }

  // ---- Log -------------------------------------------------------------------
  await openTab(page, 'log');
  const slotH = () => page.$eval('.logpane .pane-status', (el) => el.getBoundingClientRect().height);
  const h0 = await slotH();
  ok('log: the empty feed has its empty state', /No log lines yet/.test(await page.textContent('#lp-feed-log')));
  for (let i = 0; i < 40; i++) logLine(i % 4 === 0 ? 3 : 2, i % 4 === 0 ? 'motor' : 'net', 'line ' + i);
  await page.waitForFunction(() => document.querySelectorAll('#lp-feed-log .line').length === 40, null, { timeout: 5000 });
  await page.waitForTimeout(100);
  const atEnd = await page.$eval('#lp-feed-log', (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
  ok('log: following keeps the newest line in view', atEnd);
  ok('log: following is said once, on its toggle (ph-0gp)', !/Following/.test(await page.textContent('.logpane .pane-status')));
  if (label !== 'phone') {
    const tw = await page.$$eval('.logpane [role=tab]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width * 10) / 10));
    ok('log: the source tabs are one width (ph-0gp)', Math.max(...tw) - Math.min(...tw) < 1, tw.join(' '));
  }
  // ph-632: warn text rides --warn-ink, the theme's ink for amber text.
  const ink = await page.evaluate(() => {
    document.documentElement.style.setProperty('--warn-ink', 'rgb(1, 2, 3)');
    const c = getComputedStyle(document.querySelector('#lp-feed-log .line.lvl-warn .text')).color;
    document.documentElement.style.removeProperty('--warn-ink');
    return c;
  });
  ok('log: a warn line\'s text rides --warn-ink (ph-632)', ink === 'rgb(1, 2, 3)', ink);

  await page.selectOption('.logpane select >> nth=0', { label: 'warn and above' });
  await page.waitForTimeout(100);
  ok('log: level filter keeps warn and above', await page.$$eval('#lp-feed-log .line', (ls) => ls.length) === 10);
  await page.selectOption('.logpane select >> nth=0', { label: 'all levels' });
  await page.selectOption('.logpane select >> nth=1', { label: 'net' });
  await page.waitForTimeout(100);
  ok('log: tag filter keeps one tag', await page.$$eval('#lp-feed-log .line', (ls) => ls.length) === 30);
  ok('log: the status says how much is shown', /30 of 40 shown/.test(await page.textContent('.logpane .pane-status')));
  await page.selectOption('.logpane select >> nth=1', { label: 'all tags' });
  await page.waitForTimeout(100);

  await page.$eval('#lp-feed-log', (el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(100);
  for (let i = 0; i < 5; i++) logLine(2, 'net', 'late ' + i);
  await page.waitForTimeout(200);
  const st = await page.textContent('.logpane .pane-status');
  ok('log: scrolling up pauses the feed and counts what arrived', /Paused: 5 new lines/.test(st), st);
  ok('log: a paused feed holds its rows', await page.$$eval('#lp-feed-log .line', (ls) => ls.length) === 40);
  const rowH = await page.$eval('#lp-feed-log .line', (el) => el.getBoundingClientRect().height);
  await page.hover('#lp-feed-log .line >> nth=0');
  ok('log: hovering a row does not change its height', rowH === await page.$eval('#lp-feed-log .line', (el) => el.getBoundingClientRect().height));

  await page.$eval('#lp-feed-log', (el) => { el.scrollTop = 120; el.dispatchEvent(new Event('scroll')); });
  await page.click('[data-feed="safety"]');
  await page.waitForTimeout(100);
  ok('log: the Safety feed has its own empty state', /No safety events/.test(await page.textContent('#lp-feed-safety')));
  await page.click('[data-feed="log"]');
  await page.waitForTimeout(100);
  ok('log: a tab switch keeps the feed scroll position', await page.$eval('#lp-feed-log', (el) => el.scrollTop) === 120);

  await page.click('.logpane .tools button:has-text("Copy")');
  await page.waitForTimeout(150);
  const logClip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('log: Copy puts the shown lines on the clipboard', logClip.split('\n').length === 40 && /\[warn\] \[motor\] line 0/.test(logClip), logClip.split('\n')[0]);
  await page.click('.logpane .tools button:has-text("Follow")');
  await page.waitForTimeout(150);
  ok('log: Follow resumes with the new lines', await page.$$eval('#lp-feed-log .line', (ls) => ls.length) === 45);
  ok('log: the status slot never changes height', h0 > 0 && h0 === await slotH(), h0 + 'px');

  // ---- Display ---------------------------------------------------------------
  await openTab(page, 'display');
  const d = await facts(page);
  const wantCls = label === 'phone' ? 'handheld' : 'full';
  ok('display: the class readout is measured', d.class === wantCls && d.viewport.startsWith(viewport.width + ' × ' + viewport.height), d.class + ', ' + d.viewport);
  ok('display: the pointer is named', /fine|coarse|none/.test(d.pointer), d.pointer);
  ok('display: units read as a fact, not a one-choice selector', /metric/.test(d.system) && !(await page.$('.theme-picker select')));
  await page.click('.theme-picker label.og-switch:has-text("Autorange")');
  const ar = await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.prefs')).autorange);
  ok('display: autorange persists through prefs.js', ar === false);
  await page.click('.theme-picker label.og-switch:has-text("High legibility")');
  ok('display: hi-vis flips the html class and persists', await page.evaluate(() =>
    document.documentElement.classList.contains('hivis') && localStorage.getItem('ui_hivis') === '1'));

  ok('no page errors (' + label + ')', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---- shell bundle: the saved hub redials on launch, so the console tabs and
// Plugins exist beside the Phosphor panes ----------------------------------------
async function bootShell(viewport, extra) {
  return boot(viewport, '/shell', true, (ctx) => ctx.addInitScript((x) => {
    try {
      if (!localStorage.getItem('phosphor.hubs')) {
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:82', host: '127.0.0.1', port: 82, name: 'panes fixture', nickname: '', lastSeen: Date.now() - 60000 }]));
      }
      for (const [k, v] of Object.entries(x || {})) localStorage.setItem(k, v);
    } catch (e) { /* no storage */ }
    // The one Rust command these panes need answered: discovery.
    // The Rust commands these panes need answered: discovery and the buttplug server.
    const stub = window.__TAURI_INTERNALS__.invoke;
    const bp = { running: false, port: 12345, clients: 0, scanning: false };
    const answers = {
      discover_hubs: () => [{ hub_name: 'bench hub', ip: '10.0.0.5', ws_port: 82, fw_version: '1.2.3',
        hub_instance_id: '00112233aabbccdd', pairing_window_open: true }],
      bp_status: () => ({ ...bp }),
      bp_devices: () => [],
      bp_clients: () => [],
      bp_settings: () => ({ port: 12345, start_on_launch: false, ble: true, serial: false, hid: false, machine: true, log_level: 'info' }),
      bp_start: () => { bp.running = true; return null; },
      bp_stop: () => { bp.running = false; return null; },
      bp_stop_all: () => null,
    };
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => (cmd in answers ? Promise.resolve(answers[cmd](args)) : stub(cmd, args));
  }, extra));
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  console.log('\n--- shell panes, ' + label + ' ---');
  const { ctx, page, errors } = await bootShell(viewport);

  // ---- Plugins -----------------------------------------------------------------
  await openTab(page, 'plugins');
  await page.waitForSelector('.plugins .plugin', { timeout: 15000 });
  const plugins = () => page.$$eval('.plugins .plugin', (ss) => ss.map((s) => ({
    name: s.getAttribute('aria-label'),
    chips: [...s.querySelectorAll('.pane-head .chip')].map((c) => c.textContent.trim()),
    on: s.querySelector('.og-switch input')?.checked,
    slot: s.querySelector('.pane-status')?.getBoundingClientRect().height,
  })));
  const p0 = await plugins();
  const bp = p0.find((p) => p.name === 'buttplug');
  ok('plugins: bundled plugins are marked factory or built-in', bp && bp.chips.includes('built-in') && p0.some((p) => p.chips.includes('factory')), JSON.stringify(p0.map((p) => p.name + ':' + p.chips.join('/'))));
  ok('plugins: every plugin has its error slot', p0.every((p) => p.slot > 0), p0.map((p) => p.slot).join(','));
  const credit = await page.$eval('.plugins .plugin[aria-label="advanced-penetration"]', (s) => s.textContent.replace(/\s+/g, ' '));
  ok('plugins: advanced-penetration credits fray-d, OSSM-Lite with its license', /after fray-d, OSSM-Lite · CERN-OHL-S-2\.0 Copy link/.test(credit), credit);
  await page.click('.plugins .plugin[aria-label="buttplug"] label.og-switch');
  await page.waitForTimeout(200);
  ok('plugins: disabling persists in the disabled set', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.plugins.disabled') || '[]').includes('buttplug')));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openTab(page, 'plugins');
  await page.waitForSelector('.plugins .plugin[aria-label="buttplug"]', { timeout: 15000 });
  const bp2 = (await plugins()).find((p) => p.name === 'buttplug');
  ok('plugins: the buttplug adapter stays disabled across a launch', bp2 && bp2.on === false && bp2.chips.includes('disabled'), JSON.stringify(bp2));
  await page.click('.plugins .plugin[aria-label="buttplug"] label.og-switch');
  await page.waitForTimeout(200);

  // ---- About (while the hub is still connected) ----------------------------------
  await openTab(page, 'shell:about');
  const ab = await facts(page);
  ok('about: UI build, protocol and the catalog etag', ab['ui build'] && ab['ui build'] !== '--' && ab.protocol === 'v1 (valence.v1)' && ab['catalog etag'] === ETAG.toLowerCase(), JSON.stringify(ab));
  const notices = await page.$eval('section[aria-labelledby="ab-notices"]', (s) => s.innerText.replace(/\s+/g, ' '));
  ok('about: Notices list Phosphor and the plugin credit', /Phosphor Phosphor · Apache-2\.0/.test(notices) && /advanced-penetration after fray-d, OSSM-Lite · CERN-OHL-S-2\.0/.test(notices), notices);
  // ph-7mw: an absent value is one glyph in the body face, never mono.
  const nilFaces = () => page.$$eval('main.pane dl.pane-facts dd', (ds) => [...new Set(ds.filter((d) => d.textContent.trim() === '--')
    .map((d) => getComputedStyle(d).fontFamily + ' ' + getComputedStyle(d).fontWeight))]);
  const nilAbout = await nilFaces();
  ok('about: every absent value is one glyph in one face, never mono', nilAbout.length <= 1 && !nilAbout.some((f) => /Mono/.test(f)), JSON.stringify(nilAbout));

  // ---- Hubs ------------------------------------------------------------------------
  await openTab(page, 'shell:hubs');
  const hubStatus = () => page.$eval('section[aria-labelledby="hp-link"] .pane-status', (el) => [el.dataset.phase, el.textContent.trim(), el.getBoundingClientRect().height]);
  const live = await hubStatus();
  ok('hubs: the link ladder settles on live', live[0] === 'settled' && /Live on 127\.0\.0\.1:82/.test(live[1]), live.join(' / '));
  const nilHubs = await nilFaces();
  ok('hubs: every absent value is one glyph in one face, never mono (ph-7mw)', nilHubs.length <= 1 && !nilHubs.some((f) => /Mono/.test(f)), JSON.stringify(nilHubs));
  const saved = await page.$$eval('section[aria-labelledby="hp-saved"] li:not(.virtual)', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ')));
  ok('hubs: saved hubs list here with the connected one marked', saved.length === 1 && /connected/.test(saved[0]), saved.join(' | '));
  await page.fill('section[aria-labelledby="hp-saved"] .nick input', 'bench');
  await page.press('section[aria-labelledby="hp-saved"] .nick input', 'Enter');
  await page.$eval('section[aria-labelledby="hp-saved"] .nick input', (el) => el.dispatchEvent(new Event('change')));
  ok('hubs: a nickname saves to prefs.js', await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.hubs'))[0].nickname === 'bench'));
  await page.click('section[aria-labelledby="hp-find"] button:text-is("Scan")');
  await page.waitForSelector('section[aria-labelledby="hp-find"] .rows li', { timeout: 5000 });
  const found = await page.$eval('section[aria-labelledby="hp-find"] .rows li', (l) => l.textContent.replace(/\s+/g, ' '));
  ok('hubs: a discovery row carries name, endpoint, identity, pairing mark and last seen',
    /bench hub/.test(found) && /10\.0\.0\.5:82/.test(found) && /fw 1\.2\.3/.test(found) && /id 00112233aabbccdd/.test(found) && /pairing open/.test(found) && /seen \d+s ago/.test(found), found);
  const findBox = await page.$eval('section[aria-labelledby="hp-find"]', (el) => el.getBoundingClientRect().height);
  await page.click('section[aria-labelledby="hp-find"] button:text-is("Scan")');
  await page.waitForTimeout(300);
  ok('hubs: finding again keeps the row in place', await page.$$eval('section[aria-labelledby="hp-find"] .rows li', (ls) => ls.length) === 1
    && findBox === await page.$eval('section[aria-labelledby="hp-find"]', (el) => el.getBoundingClientRect().height));
  await page.click('section[aria-labelledby="hp-link"] button:has-text("Disconnect")');
  await page.waitForTimeout(200);
  const off = await hubStatus();
  ok('hubs: disconnect reads as not connected in the same slot', off[0] === undefined && /Not connected/.test(off[1]) && off[2] === live[2], off.join(' / '));
  if (label === 'phone') ok('hubs: no horizontal page scroll at phone width', await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1));

  // ---- Server ------------------------------------------------------------------------
  await openTab(page, 'shell:server');
  await page.waitForSelector('.sp-pane [role=tablist]', { timeout: 5000 });
  const stopAllBtn = page.locator('.sp-pane button:has-text("Stop all toys")');
  // Relative to the pane: the page above it is not this pane's to hold still.
  const stopAt = () => page.$eval('.sp-pane', (pane) => { const b = [...pane.querySelectorAll('button')].find((x) => /Stop all toys/.test(x.textContent)).getBoundingClientRect(); const r = pane.getBoundingClientRect(); return { x: b.x - r.x, y: b.y - r.y }; });
  const slots = () => page.$$eval('.sp-pane > section:first-child .pane-status', (ps) => ps.map((p) => [p.dataset.phase, p.textContent.trim(), p.getBoundingClientRect().height]));
  const s0 = await slots();
  const b0 = await stopAt();
  ok('server: stop all sits in its slot, disabled with a reason while stopped', await stopAllBtn.isDisabled() && s0.length === 2 && /Not the machine e-stop/.test(s0[1][1]), JSON.stringify(s0));
  await page.click('.sp-pane button:has-text("Start server")');
  await page.waitForFunction(() => /Running/.test(document.querySelector('.sp-pane .pane-status')?.textContent || ''), null, { timeout: 5000 });
  const b1 = await stopAt();
  ok('server: starting moves nothing; stop all keeps its place', b0 && b1 && b0.x === b1.x && b0.y === b1.y && !(await stopAllBtn.isDisabled()), JSON.stringify([b0, b1]));
  await stopAllBtn.click();
  await page.waitForTimeout(200);
  const s1 = await slots();
  ok('server: the stop-all ladder settles in its own line at the same height', s1[1][0] === 'settled' && /all toys stopped/.test(s1[1][1]) && s1[1][2] === s0[1][2], JSON.stringify(s1[1]));
  await page.focus('.sp-pane [role=tab][aria-selected=true]');
  await page.keyboard.press('ArrowRight');
  ok('server: arrow keys move between the tabs', await page.evaluate(() => document.activeElement.dataset.tab === 'clients'));
  await page.click('.sp-pane [data-tab="log"]');
  await page.waitForTimeout(100);
  const sel = await page.$eval('.sp-pane select', (el) => el.getBoundingClientRect().height);
  ok('server: the log level select meets the 40 px floor (ph-3cl)', sel >= 40, sel + 'px');
  await page.click('.sp-pane button:has-text("Stop server")');
  await page.waitForTimeout(200);

  // ---- Settings and About ---------------------------------------------------------
  await openTab(page, 'shell:settings');
  const setSlot = () => page.$eval('section[aria-labelledby="set-adv"] .pane-status', (el) => el.getBoundingClientRect().height);
  const st0 = await setSlot();
  ok('settings: Cancel always renders, disabled until a restore is pending', await page.isDisabled('section[aria-labelledby="set-adv"] button:has-text("Cancel")'));
  ok('settings: saved hubs are not duplicated here', !(await page.$('.set .nick')));
  await page.fill('#set-backup', '{"app":"other"}');
  await page.click('section[aria-labelledby="set-adv"] button:has-text("Import")');
  await page.click('section[aria-labelledby="set-adv"] button:has-text("Replace everything")');
  const bad = await page.textContent('section[aria-labelledby="set-adv"] .pane-status');
  ok('settings: a refused restore reads in the fixed slot', /Not restored/.test(bad) && st0 === await setSlot(), bad);

  ok('no page errors (shell ' + label + ')', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
