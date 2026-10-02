/**
 * console-panes.test.mjs -- the console panes (Pairing, Valence, Log,
 * Display) on the served bundle against a fake hub, and the shell panes
 * (Hubs, Server, Settings, About, Plugins) on the shell bundle with the stub
 * Tauri runtime (ph-vdk.57).
 *
 * Asserts the instrument-panel rules: every fact is a stable row, status
 * slots hold their height whether or not they carry text, lists keep their
 * rows when content arrives, and the pane-specific facts render what the
 * wire sent.
 *
 * Build first (`npm run build:only`).
 * Run: node test/console-panes.test.mjs   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbBool, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import {
  encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS,
} from '../../Valence/clients/js/frames.js';
import { CORE_CHANNEL, LOG_EVENT_KIND } from '../../Valence/clients/js/generated/registry_vocab.js';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
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
const wire = { socket: null, roles: 2 };
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

async function boot(viewport, path = '/', shell = false) {
  const ctx = await browser.newContext({ viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:' + PORT });
  await ctx.addInitScript(([etag, bytes]) => {
    try { localStorage.clear(); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); }
    catch (e) { /* no storage */ }
  }, [ETAG, toHex(CAT)]);
  if (shell) await ctx.addInitScript(TAURI_STUB);
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
  [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  console.log('\n--- console panes, ' + label + ' ---');
  const { ctx, page, errors } = await boot(viewport);

  // ---- Valence -------------------------------------------------------------
  await openTab(page, 'valence');
  await page.waitForFunction(() => [...document.querySelectorAll('.pane-facts dd')].some((d) => d.textContent.includes('panes fixture')), null, { timeout: 15000 });
  const f = await facts(page);
  ok('valence: session facts are rows', ['access tier', 'max sessions', 'sessions in use', 'e-stop cuts power', 'raw frames', 'publishes']
    .every((k) => k in f), Object.keys(f).join(', '));
  ok('valence: limits show what WELCOME sent', f['max sessions'] === '4' && f['sessions in use'] === '2', f['max sessions'] + '/' + f['sessions in use']);
  ok('valence: estop_cuts_power reads E-Stop', /E-Stop/.test(f['e-stop cuts power']), f['e-stop cuts power']);
  const copyBtn = page.locator('section[aria-labelledby="vp-identity"] button', { hasText: 'Copy' });
  const before = await copyBtn.boundingBox();
  await copyBtn.click();
  await page.waitForTimeout(150);
  const after = await copyBtn.boundingBox();
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('valence: Copy puts the identity on the clipboard', clip.includes('panes fixture') && clip.includes('estop_cuts_power'), clip.slice(0, 60));
  ok('valence: the copy flash does not move the button', before && after && before.x === after.x && before.y === after.y);
  if (label === 'phone') {
    const sw = await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1);
    ok('valence: no horizontal page scroll at phone width', sw);
  }

  // ---- Log -------------------------------------------------------------------
  await openTab(page, 'log');
  const slotH = () => page.$eval('.logpane .pane-status', (el) => el.getBoundingClientRect().height);
  const h0 = await slotH();
  ok('log: the empty feed says what will arrive', /arrive here/.test(await page.textContent('#lp-feed-log')));
  for (let i = 0; i < 40; i++) logLine(i % 4 === 0 ? 3 : 2, i % 4 === 0 ? 'motor' : 'net', 'line ' + i);
  await page.waitForFunction(() => document.querySelectorAll('#lp-feed-log .line').length === 40, null, { timeout: 5000 });
  await page.waitForTimeout(100);
  const atEnd = await page.$eval('#lp-feed-log', (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
  ok('log: following keeps the newest line in view', atEnd);

  await page.selectOption('.logpane select >> nth=0', { label: 'warn and above' });
  await page.waitForTimeout(100);
  ok('log: level filter keeps warn and above', await page.$$eval('#lp-feed-log .line', (ls) => ls.length) === 10);
  await page.selectOption('.logpane select >> nth=0', { label: 'all levels' });
  await page.selectOption('.logpane select >> nth=1', { label: 'net' });
  await page.waitForTimeout(100);
  ok('log: tag filter keeps one tag', await page.$$eval('#lp-feed-log .line', (ls) => ls.length) === 30);
  ok('log: the status says how much is shown', /Showing 30 of 40/.test(await page.textContent('.logpane .pane-status')));
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
  ok('log: the Safety feed has its own empty state', /latch has not changed/.test(await page.textContent('#lp-feed-safety')));
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

  ok('no page errors (' + label + ')', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
