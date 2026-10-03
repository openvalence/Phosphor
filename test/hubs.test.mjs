/**
 * hubs.test.mjs -- the Hubs pane's Scan and endpoints: found.js under node,
 * then the shell bundle with the stub Tauri runtime.
 *
 * - The Scan is UDP first, Bluetooth fallback (operator ruling 2026-10-02 on
 *   RFC-046): two LAN replies list as two LAN rows and no BLE scan starts; an
 *   empty LAN result starts the BLE scan exactly once and its hit lists BLE.
 * - A hub found both ways is one row, connecting over LAN (found.js).
 * - ph-dwy: a remembered hub on 8282 redials 8282 at launch; the host field
 *   keeps the dialed port; a LAN reply moves a saved hub, port included, and
 *   its Connect then dials the new port.
 *
 * Run: node test/hubs.test.mjs   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { mergeFound, learnBleId, foundVia } from '../src/shell/found.js';
import { BLE_SERVICE } from '../src/shell/ble-ws.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbBool, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };

const ID_A = 'aabbccddeeff0011';
const LAN_A = { hub_name: 'bench', ip: '127.0.0.1', ws_port: 8282, hub_instance_id: ID_A, fw_version: '1.0.0', pairing_window_open: false };
const LAN_B = { hub_name: 'shop', ip: '10.0.0.7', ws_port: 82, hub_instance_id: '1122334455667788', fw_version: '1.0.0', pairing_window_open: true };
const DEV = { address: 'AA:BB:CC:DD:EE:01', name: 'nucleus-p4', rssi: -60, services: [BLE_SERVICE], manufacturerData: { 65535: [1] } };

// ---- found.js -------------------------------------------------------------------
console.log('\n--- found.js ---');
let rows = mergeFound([], [LAN_A, LAN_B], 'LAN', { now: 1 });
ok('two LAN replies are two LAN rows in reply order', rows.map((r) => r.key).join() === ID_A + ',' + LAN_B.hub_instance_id
  && rows.every((r) => foundVia(r).join() === 'LAN'));
rows = mergeFound(rows, [{ ...LAN_A, fw_version: '1.0.1' }], 'LAN', { now: 2 });
ok('a repeat reply updates its row in place', rows[0].lan.fw_version === '1.0.1' && rows[0].seenAt === 2 && rows.length === 2);
rows = mergeFound(rows, [DEV], 'BLE', { now: 3 });
ok('a BLE hit with no known id is its own row', rows.length === 3 && rows[2].key === 'ble:' + DEV.address && foundVia(rows[2]).join() === 'BLE');
rows = learnBleId(rows, DEV.address, ID_A);
ok('a BLE session teaching the id folds the row into the LAN row', rows.length === 2 && foundVia(rows[0]).join() === 'LAN,BLE'
  && rows[0].lan.ws_port === 8282, rows.map((r) => r.key).join());
const bleIds = new Map([[DEV.address, ID_A]]);
const again = mergeFound(mergeFound([], [DEV], 'BLE', { bleIds }), [LAN_A], 'LAN', { bleIds });
ok('a known BLE hit and its LAN reply are one row, either order', again.length === 1 && foundVia(again[0]).join() === 'LAN,BLE');
const noId = mergeFound([], [{ ...LAN_A, hub_instance_id: '' }, { ...LAN_A, hub_instance_id: '', ip: '127.0.0.2' }], 'LAN');
ok('replies without an id key on their endpoint, port kept', noId.map((r) => r.key).join() === '127.0.0.1:8282,127.0.0.2:8282');

// ---- the shell bundle ------------------------------------------------------------
const SHELL = await buildShellPage();
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch();

// A hub that answers HELLO and SUBSCRIBE, enough for LIVE; counts its opens.
const opens = { 82: 0, 8282: 0 };
function fakeHub(port) {
  return (ws) => {
    opens[port]++;
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
            [K.roles, cbUint(1)], [K.deadman_ms, cbUint(600000)],
            [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.hub_name, cbTstr('bench')],
              [IDENTITY_K.estop_cuts_power, cbBool(true)]])],
          ]));
        } else if (header.type === FRAME.SUBSCRIBE) {
          const m = cbDecodeFull(payload);
          send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray((m.get(K.subscriptions) || []).map((w) => cbMap([
            [K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
            [K.channel_id, cbUint(w.get(K.channel_id))]])))]]));
        } else if (header.type === FRAME.PING) {
          send(FRAME.PONG, header.channel, payload);
        }
      }
    });
  };
}

// `storage` seeds localStorage once; `lan` is what discover_hubs answers.
// The page reports every Bluetooth scan it starts in window.__bleScans.
async function boot(storage, lan) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([seed, etag, catHex]) => {
    try {
      if (!sessionStorage.getItem('booted')) {
        sessionStorage.setItem('booted', '1');
        localStorage.clear();
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: catHex }));
    } catch (e) { /* no storage */ }
  }, [storage, ETAG, Buffer.from(CAT).toString('hex')]);
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(([replies, dev]) => {
    const cbs = new Map();
    let n = 1000;
    const stub = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.transformCallback = (cb) => { cbs.set(++n, cb); return n; };
    window.__bleScans = 0;
    const answers = {
      discover_hubs: () => replies,
      'plugin:blec|check_permissions': () => true,
      'plugin:blec|stop_scan': () => null,
      'plugin:blec|scan': (args) => {
        window.__bleScans++;
        setTimeout(() => cbs.get(args.onDevices.id)?.({ index: 0, message: [dev] }), 50);
        return null;
      },
    };
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => (cmd in answers ? Promise.resolve(answers[cmd](args)) : stub(cmd, args));
  }, [lan, DEV]);
  await ctx.routeWebSocket(/:82\//, fakeHub(82));
  await ctx.routeWebSocket(/:8282\//, fakeHub(8282));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tab-id="shell:hubs"]', { timeout: 15000 });
  await page.click('[data-tab-id="shell:hubs"]');
  await page.waitForSelector('section[aria-labelledby="hp-find"]', { timeout: 5000 });
  return { ctx, page, errors };
}
const hubFact = (page) => page.$eval('section[aria-labelledby="hp-link"] .pane-facts dd', (d) => d.textContent.trim());
const untilLive = (page) => page.waitForFunction(() => /Live on/.test(document.querySelector('section[aria-labelledby="hp-link"] .pane-status')?.textContent || ''), null, { timeout: 15000 });
const foundRows = (page) => page.$$eval('section[aria-labelledby="hp-find"] .rows li', (ls) => ls.map((l) => ({
  text: l.textContent.replace(/\s+/g, ' ').trim(), via: [...l.querySelectorAll('.mark.via')].map((m) => m.textContent.trim()).join() })));
const scanBtn = (page) => page.locator('section[aria-labelledby="hp-find"] button', { hasText: /^Scan$/ });
const savedHub = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.hubs') || '[]')[0]);

console.log('\n--- ph-dwy: a remembered hub on 8282 ---');
{
  const before = { ...opens };
  const { ctx, page, errors } = await boot({
    'phosphor.hubs': JSON.stringify([{ id: ID_A, host: '127.0.0.1', port: 8282, name: 'bench', nickname: '', lastSeen: Date.now() - 60000 }]),
    shell_mode: 'ws',
  }, []);
  await untilLive(page);
  ok('launch redials the saved hub on 8282, never 82', opens[8282] > before[8282] && opens[82] === before[82], JSON.stringify(opens));
  ok('the Hub row reads the dialed port', (await hubFact(page)) === '127.0.0.1:8282', await hubFact(page));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- ph-dwy: the host field keeps the dialed port ---');
{
  const before = { ...opens };
  const { ctx, page, errors } = await boot({
    shell_host: '127.0.0.1', shell_port: '8282', shell_mode: 'ws',
    'phosphor.prefs': JSON.stringify({ v: 1, reconnect: false }),
  }, []);
  const field = await page.inputValue('section[aria-labelledby="hp-find"] .he-host');
  ok('the field shows host:port', field === '127.0.0.1:8282', field);
  await page.click('section[aria-labelledby="hp-find"] .he-go');
  await untilLive(page);
  ok('its Connect dials 8282', opens[8282] > before[8282] && opens[82] === before[82], JSON.stringify(opens));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- Scan: two LAN replies, no Bluetooth; a saved hub follows its move ---');
{
  const before = { ...opens };
  const { ctx, page, errors } = await boot({
    'phosphor.hubs': JSON.stringify([{ id: ID_A, host: '10.0.0.9', port: 82, name: 'bench', nickname: 'Bench', lastSeen: Date.now() - 60000 }]),
    shell_host: '10.0.0.9', shell_mode: 'ws', 'phosphor.prefs': JSON.stringify({ v: 1, reconnect: false }),
  }, [LAN_A, LAN_B]);
  await scanBtn(page).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="hp-find"] .rows li').length === 2, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const r = await foundRows(page);
  ok('two rows, each marked LAN', r.length === 2 && r.every((x) => x.via === 'LAN'), r.map((x) => x.via).join(' | '));
  ok('rows carry name, endpoint, version and the pairing mark', /bench/.test(r[0].text) && /127\.0\.0\.1:8282/.test(r[0].text)
    && /fw 1\.0\.0/.test(r[0].text) && /shop/.test(r[1].text) && /pairing open/.test(r[1].text), r.map((x) => x.text).join(' | '));
  ok('no Bluetooth scan started', (await page.evaluate(() => window.__bleScans)) === 0);
  const moved = await savedHub(page);
  ok('the saved hub follows its id to the new endpoint, port included', moved.host === '127.0.0.1' && moved.port === 8282 && moved.nickname === 'Bench',
    JSON.stringify(moved));
  await page.click('section[aria-labelledby="hp-saved"] li:not(.virtual) button:has-text("Connect")');
  await untilLive(page);
  ok('the saved row\'s Connect dials the moved port', opens[8282] > before[8282] && opens[82] === before[82], JSON.stringify(opens));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- Scan: an empty LAN result falls back to Bluetooth once ---');
{
  const { ctx, page, errors } = await boot({ shell_host: '10.0.0.9', shell_mode: 'ws', 'phosphor.prefs': JSON.stringify({ v: 1, reconnect: false }) }, []);
  await scanBtn(page).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="hp-find"] .rows li').length === 1, null, { timeout: 8000 });
  const r = await foundRows(page);
  ok('the Bluetooth scan ran exactly once', (await page.evaluate(() => window.__bleScans)) === 1);
  ok('its hit lists marked BLE with the advertised pairing flag', r[0].via === 'BLE' && /nucleus-p4/.test(r[0].text)
    && /pairing open/.test(r[0].text) && /AA:BB:CC:DD:EE:01/.test(r[0].text), r[0].via + ': ' + r[0].text);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall passed');
process.exit(fails ? 1 : 0);
