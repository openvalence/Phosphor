/**
 * hubs.test.mjs -- the Hubs pane's Scan and endpoints: found.js under node,
 * then the shell bundle with the stub Tauri runtime.
 *
 * - The Scan is UDP first, Bluetooth fallback (operator ruling 2026-10-02 on
 *   RFC-046): two LAN replies list as two LAN rows and no BLE scan starts; an
 *   empty LAN result starts the BLE scan exactly once and its hit lists BLE.
 * - Scan Bluetooth works on its own beside LAN rows (restated 2026-10-03).
 * - A hub found both ways is one row, connecting over LAN (found.js).
 * - RFC-121: a config-mode BLE hit is "needs setup" and its one button is Set
 *   up; a normal-mode hit dials its advertised endpoint over WS; WiFi clear
 *   outside config mode reads offline, reconnecting, Connect off. Set up a
 *   machine lists config-mode hubs only.
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
// Flags 0x05: pairing window open, config mode (SPEC 13.4).
const DEV = { address: 'AA:BB:CC:DD:EE:01', name: 'nucleus-p4', rssi: -60, services: [BLE_SERVICE], manufacturerData: { 65535: [5] } };
// ws_available with the endpoint tail 10.0.0.7:8282; and an offline one (ws_available clear, not config mode).
const DEV_ON = { address: 'AA:BB:CC:DD:EE:02', name: 'online-hub', rssi: -55, services: [BLE_SERVICE], manufacturerData: { 65535: [2, 10, 0, 0, 7, 0x5a, 0x20] } };
const DEV_OFF = { address: 'AA:BB:CC:DD:EE:03', name: 'offline-hub', rssi: -70, services: [BLE_SERVICE], manufacturerData: { 65535: [0] } };

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
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/neutrino-catalog.etag', import.meta.url), 'utf8').trim();
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
async function boot(storage, lan, { hubsTab = true, viewport = { width: 1440, height: 900 }, devs = [DEV] } = {}) {
  const ctx = await browser.newContext({ viewport });
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
  await ctx.addInitScript(([replies, found]) => {
    const cbs = new Map();
    let n = 1000;
    const stub = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.transformCallback = (cb) => { cbs.set(++n, cb); return n; };
    window.__bleScans = 0;
    const answers = {
      discover_hubs: () => replies,
      'plugin:opener|open_url': (a) => { window.__opened = a.url; return null; },
      'plugin:blec|check_permissions': () => true,
      'plugin:blec|stop_scan': () => null,
      'plugin:blec|scan': (args) => {
        window.__bleScans++;
        setTimeout(() => cbs.get(args.onDevices.id)?.({ index: 0, message: found }), 50);
        return null;
      },
    };
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => (cmd in answers ? Promise.resolve(answers[cmd](args)) : stub(cmd, args));
  }, [lan, devs]);
  await ctx.routeWebSocket(/:82\//, fakeHub(82));
  await ctx.routeWebSocket(/:8282\//, fakeHub(8282));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  if (!hubsTab) return { ctx, page, errors };
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

console.log('\n--- ph-mdqo.10: a saved hub renames on F2 and double-click ---');
{
  const { ctx, page, errors } = await boot({
    'phosphor.hubs': JSON.stringify([{ id: '127.0.0.1:8282', host: '127.0.0.1', port: 8282, name: 'bench', nickname: 'Bench', lastSeen: Date.now() - 60000 }]),
    shell_mode: 'ws',
  }, []);
  await untilLive(page);
  const nick = 'section[aria-labelledby="hp-saved"] .nick input';
  const sel = () => page.evaluate(() => { const a = document.activeElement; return a.matches('.nick input') ? [a.selectionStart, a.selectionEnd, a.value] : null; });
  await page.focus('section[aria-labelledby="hp-saved"] li button:not([disabled])');
  await page.keyboard.press('F2');
  ok('F2 on the row opens the nickname with its text selected', JSON.stringify(await sel()) === '[0,5,"Bench"]', JSON.stringify(await sel()));
  await page.keyboard.type('Rig');
  await page.keyboard.press('Escape');
  ok('Escape reverts and stores nothing', (await savedHub(page)).nickname === 'Bench' && await page.inputValue(nick) === 'Bench', await page.inputValue(nick));
  await page.dblclick('section[aria-labelledby="hp-saved"] .meta');
  ok('a double-click on the row opens it too', JSON.stringify(await sel()) === '[0,5,"Bench"]', JSON.stringify(await sel()));
  await page.keyboard.type('Rig');
  await page.keyboard.press('Enter');
  ok('Enter keeps the new name', (await savedHub(page)).nickname === 'Rig', (await savedHub(page)).nickname);
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
  ok('a config-mode hit is needs setup, its one button Set up', /needs setup/.test(r[0].text) && /Set up$/.test(r[0].text), r[0].text);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- RFC-121: a normal-mode advertisement is an endpoint hint; offline reads offline ---');
{
  const before = { ...opens };
  // The pre-RFC-121 cache at the advertised host: migrated at start, so the WS session takes the etag fast path.
  const { ctx, page, errors } = await boot({ shell_host: '10.0.0.9', shell_mode: 'ws', 'phosphor.prefs': JSON.stringify({ v: 1, reconnect: false }),
    'valence.catalog.10.0.0.7': JSON.stringify({ etag: ETAG, bytes: Buffer.from(CAT).toString('hex') }) }, [], { devs: [DEV_ON, DEV_OFF] });
  await scanBtn(page).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="hp-find"] .rows li').length === 2, null, { timeout: 8000 });
  const r = await foundRows(page);
  ok('the online hit shows its advertised endpoint', /online-hub/.test(r[0].text) && /at 10\.0\.0\.7:8282/.test(r[0].text) && !/needs setup/.test(r[0].text), r[0].text);
  ok('the offline hit reads offline, reconnecting', /offline-hub/.test(r[1].text) && /offline, reconnecting/.test(r[1].text), r[1].text);
  const off = page.locator('section[aria-labelledby="hp-find"] .rows li').nth(1).locator('button');
  ok('the offline hit offers no connect', (await off.count()) === 1 && await off.isDisabled());
  await page.locator('section[aria-labelledby="hp-find"] .rows li').nth(0).locator('button:has-text("Connect")').click();
  await untilLive(page);
  ok('Connect dials the advertised endpoint over WS, never Bluetooth', opens[8282] > before[8282] && (await hubFact(page)) === '10.0.0.7:8282',
    await hubFact(page));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- Scan Bluetooth on its own: a config-mode hub beside a WiFi hub ---');
{
  const { ctx, page, errors } = await boot({ shell_host: '10.0.0.9', shell_mode: 'ws', 'phosphor.prefs': JSON.stringify({ v: 1, reconnect: false }) }, [LAN_A, LAN_B]);
  await scanBtn(page).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="hp-find"] .rows li').length === 2, null, { timeout: 5000 });
  await page.locator('section[aria-labelledby="hp-find"] button', { hasText: /^Scan Bluetooth$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="hp-find"] .rows li').length === 3, null, { timeout: 8000 });
  const r = await foundRows(page);
  ok('the button runs one Bluetooth scan after a LAN hit', (await page.evaluate(() => window.__bleScans)) === 1);
  ok('its row appends after the LAN rows, marked BLE', r.map((x) => x.via).join() === 'LAN,LAN,BLE', r.map((x) => x.via).join(' | '));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- Set up a machine: the overlay lists config-mode hubs only, marked, and closes ---');
{
  const { ctx, page, errors } = await boot({ shell_host: '10.0.0.9', shell_mode: 'ws', 'phosphor.prefs': JSON.stringify({ v: 1, reconnect: false }) }, [],
    { devs: [DEV_ON, DEV, DEV_OFF] });
  await page.locator('section[aria-labelledby="hp-find"] button', { hasText: /^Set up a machine$/ }).click();
  await page.waitForSelector('.su .pane-list li', { timeout: 8000 });
  const row = await page.$eval('.su .pane-list li', (l) => l.textContent.replace(/\s+/g, ' ').trim());
  ok('the Bluetooth hit lists with the needs-setup mark', /nucleus-p4/.test(row) && /needs setup/.test(row), row);
  ok('only the config-mode hub is listed', (await page.locator('.su .pane-list li').count()) === 1);
  await page.click('.su .pane-list li button');
  await page.waitForFunction(() => /nucleus-p4/.test(document.querySelector('.su .pane-status')?.textContent || ''), null, { timeout: 5000 });
  ok('Set up moves to connecting, the hub named', true);
  await page.click('.su .acts button:has-text("Close")');
  await page.waitForSelector('.su', { state: 'detached', timeout: 3000 }).catch(() => {});
  ok('Close removes the overlay', (await page.locator('.su').count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- DESIGN 10.20: the connecting page is never a dead end (ph-u3b2.1, ph-u3b2.2) ---');
for (const viewport of [{ width: 1428, height: 900 }, { width: 1024, height: 768 }, { width: 420, height: 860 }]) {
  // A saved hub that no longer answers (no route on 8383): the launch redial lands on the connecting page.
  const before = { ...opens };
  const { ctx, page, errors } = await boot({
    'phosphor.hubs': JSON.stringify([{ id: 'stale', host: '127.0.0.1', port: 8383, name: 'stale', nickname: 'Old rig', lastSeen: Date.now() - 86400000 }]),
    shell_host: '127.0.0.1', shell_port: '8383', shell_mode: 'ws',
  }, [LAN_A], { hubsTab: false, viewport });
  const P = '.picker';
  await page.waitForSelector(P + ' .pk-block[data-phase=retrying]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.picker .cp-rows').length === 2, null, { timeout: 5000 });
  const v = viewport.width + 'x' + viewport.height + ': ';
  const txt = (await page.textContent(P)).replace(/\s+/g, ' ');
  ok(v + 'redialing, a countdown line, Retry now and Stop on the page', /Redialing 127\.0\.0\.1:8383/.test(txt) && /Next try in \d+ s/.test(txt)
    && await page.locator(P + ' button:has-text("Stop")').isEnabled(), txt.slice(0, 160));
  ok(v + 'the address field holds the dialed address', (await page.inputValue(P + ' .he-host')) === '127.0.0.1:8383');
  const machines = await page.$$eval(P + ' .cp-rows', (u) => [...u[0].children].map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  ok(v + 'machines: the saved hub marked dialing, Neutrino last', machines.length === 2 && /Old rig/.test(machines[0]) && /Dialing/.test(machines[0])
    && /^Neutrino/.test(machines[1]), machines.join(' | '));
  const found = await page.$$eval(P + ' .cp-rows', (u) => [...u[1].children].map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  ok(v + 'found: the LAN scan on arrival lists the hub it heard', found.length === 1 && /bench/.test(found[0]) && /127\.0\.0\.1:8282/.test(found[0]), found.join(' | '));
  ok(v + 'troubleshooting links to the find section, marked as leaving the app', (await page.getAttribute(P + ' .pk-docs', 'href')) === 'https://openvalence.org/phosphor/docs/troubleshooting/#s-find'
    && (await page.getAttribute(P + ' .pk-docs', 'data-tip')) === 'Open link' && await page.locator(P + ' .pk-docs .ext-mark').count() === 1);
  // The shared confirm before leaving the app: the destination, Open link and Cancel; Escape cancels; never over the stop pair.
  await page.click(P + ' .pk-docs');
  const ask = await page.waitForSelector('.overlay[role=alertdialog]', { timeout: 3000 }).then(() => page.evaluate(() => {
    const o = document.querySelector('.overlay').getBoundingClientRect(), p = document.querySelector('.topstrip .pair')?.getBoundingClientRect();
    return { text: document.querySelector('.overlay').textContent.replace(/\s+/g, ' ').trim(),
      clear: !p || o.bottom <= p.top || o.top >= p.bottom || o.right <= p.left || o.left >= p.right };
  }), () => null);
  if (viewport.width === 420) { await page.waitForTimeout(400); await page.screenshot({ path: 'test/evidence/connect-confirm-420x860.png' }); }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ open: !!document.querySelector('.overlay'), opened: window.__opened || null }));
  ok(v + 'the link asks first: "Open link?" with the destination, Open link and Cancel, clear of the stop pair; Escape cancels and opens nothing',
    !!ask && /Open link\?/.test(ask.text) && /openvalence\.org\/phosphor\/docs\/troubleshooting/.test(ask.text) && /Cancel/.test(ask.text) && ask.clear
      && !after.open && !after.opened, { ask, after });
  await page.click(P + ' .pk-docs');
  await page.click('.overlay button:has-text("Open link")');
  await page.waitForTimeout(200);
  ok(v + 'Open link hands the URL to the opener', (await page.evaluate(() => window.__opened)) === 'https://openvalence.org/phosphor/docs/troubleshooting/#s-find');
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  ok(v + 'no horizontal overflow', fits);
  await page.screenshot({ path: 'test/evidence/connect-' + viewport.width + 'x' + viewport.height + '.png' });
  if (viewport.width === 1428) {
    const acts = () => page.$$eval(P + ' .pk-acts button, ' + P + ' .he-host', (b) => b.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); }).join(' '));
    const acts0 = await acts();
    await page.click(P + ' button:has-text("Stop")');
    await page.waitForFunction(() => /Stopped/.test(document.querySelector('.picker .pk-status')?.textContent || ''), null, { timeout: 3000 });
    const acts1 = await acts();
    ok(v + 'Stop: the status reads Stopped and Retry now and Stop stay in place, disabled', !(await page.locator(P + ' button:has-text("Stop")').isEnabled())
      && !(await page.locator(P + ' button:has-text("Retry now")').isEnabled()) && acts0 === acts1, acts0 + ' | ' + acts1);
    await page.fill(P + ' .he-host', '127.0.0.1:8282');
    await page.click(P + ' .he-go');
    await page.waitForFunction(() => !document.querySelector('.picker'), null, { timeout: 15000 });
    ok(v + 'the edited address connects in place', opens[8282] > before[8282], JSON.stringify(opens));
  }
  ok(v + 'no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall passed');
process.exit(fails ? 1 : 0);
