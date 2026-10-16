/**
 * wifipicker.test.mjs -- the network picker (factory plugin saved-networks, picker.js; RFC-118 draft).
 *
 *   join binding  the module alone in a page over the real kit, with a fake API standing in for the BLE
 *                 setup flow's credential binding: wifi_join carries the SSID and password, reports start
 *                 and done to the flow, success says Joined, the hub's "authentication failed" and
 *                 "network not found" read in words through provision.js, the field is cleared at send;
 *                 rows pushed at the grant are greyed and untappable until the scan counter changes; the
 *                 on-screen order is held under a press and under an open sheet and patched by SSID; a
 *                 saved row opens a sheet (passphrase again, move, remove) and sends nothing on the tap;
 *                 a scan refused INTERLOCK reads "Machine is moving" and is asked again until it lands;
 *                 a scan that never lands times out at 30 s
 *   Network card  the shell bundle against a private valencesim with the scan twin (VALENCESIM=<exe>):
 *                 the list strongest first with the connected check, locks and Saved marks; no generic
 *                 cards for 0x000F/0x0017..0x001A; a short password refused by the hub in words; Save
 *                 for a secured and an open network; Other network for a hidden SSID; a saved row opens its sheet
 *                 and sends nothing on the tap; Scan; Advanced reveals the slot card; the password nowhere the page keeps
 * Screenshots: test/evidence/wifipicker-<list|password|advanced>-<1428|420>.png.
 *
 * Run: node test/wifipicker.test.mjs   (the Network card part SKIPs without a valencesim that lists networks)
 * Constraints: the sim and the pages run on private ports; the sim is killed on every exit path. The
 * passwords are fixture strings and are asserted absent from everything the page keeps.
 */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createSession, toHex } from '../../Valence/clients/js/index.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { startSim } from './live-sim.mjs';
import { goTab } from './nav.mjs';
import { EVIDENCE } from './dist.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const RIGHT = 'correct-horse-42';
const WRONG = 'wrong-horse-0042';
const INSTANCE = new Uint8Array(8).fill(0xd2);
mkdirSync(EVIDENCE, { recursive: true });
const browser = await chromium.launch();

// Everything the page keeps: its text, both storages, every IndexedDB record, and the console.
async function kept(page) {
  return page.evaluate(async () => {
    const dbs = [];
    for (const d of (await indexedDB.databases?.()) || []) {
      dbs.push(await new Promise((res) => {
        const q = indexedDB.open(d.name);
        q.onerror = () => res('');
        q.onsuccess = () => {
          const db = q.result, names = [...db.objectStoreNames], out = [];
          if (!names.length) { db.close(); res(''); return; }
          const tx = db.transaction(names, 'readonly');
          for (const n of names) tx.objectStore(n).getAll().onsuccess = (e) => out.push(JSON.stringify(e.target.result));
          tx.oncomplete = () => { db.close(); res(out.join()); };
          tx.onerror = () => res(out.join());
        };
      }));
    }
    const inputs = [...document.querySelectorAll('input')].map((i) => i.value);
    return JSON.stringify([document.documentElement.outerHTML, inputs, { ...localStorage }, { ...sessionStorage }, dbs]);
  });
}

// ---- join binding: the module on the real kit, a fake API for the setup flow's binding ----
console.log('join binding');
{
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const LANE = fileURLToPath(new URL('..', import.meta.url)).replace(ROOT, '').replace(/\\/g, '/').replace(/\/$/, '');
  const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css' };
  const PAGE_HTML = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/${LANE}/src/style.css"><body><div id="host" style="width:420px"></div>
<script type="module">
import * as KIT from '/${LANE}/src/plugins/kit.js';
import { provisionRefusal } from '/${LANE}/src/model/provision.js';
import { NACK } from '/Valence/clients/js/index.js';
import { mountPicker, pickerReady } from '/${LANE}/plugins/factory/saved-networks/picker.js';
const F = (v) => ({ v });
const Q = new URLSearchParams(location.search);
const row = (o, rows) => { o.count = F(rows.length); let sec = 0, sav = 0; rows.forEach(([s, r, k, v], i) => { o['ssid' + i] = F(s); o['rssi' + i] = F(r); if (k) sec |= 1 << i; if (v) sav |= 1 << i; }); o.secured = F(sec); o.saved = F(sav); return o; };
const DEFAULT = [['Workshop', -48, 1], ['Guest', -61, 0], ['Cafe', -75, 0, 1]];
const f = {
  nets: { generation: F(1), capacity: F(4), count: F(1), live: F(255), rssi0: F(-75), rssi1: F(-128), rssi2: F(-128), rssi3: F(-128) },
  names: { generation: F(1), open: F(1), ssid0: F('Cafe'), ssid1: F(''), ssid2: F(''), ssid3: F('') },
  vis: Q.get('pre') ? row({ scan: F(7) }, DEFAULT) : row({ scan: F(0) }, []), more: null, prov: {},
};
const op = { channelId: 15, key: 1, options: ['reserved', 'wifi_join', 'save', 'remove', 'move', 'scan'] };
const sent = [], events = [];
let inst;
// mode: auto lands the rows 50 ms after the ask; manual and hang accept and land nothing (land() is the test's);
// interlock refuses the ask as the hub does in motion.
const T = { sent, events, mode: Q.get('scan') || 'auto',
  land: (spec = DEFAULT) => { const n = f.vis.scan.v + 1; row(f.vis, spec); f.vis.scan = F(n); inst.update(); } };
window.T = T;
const api = {
  ui: KIT, field: () => op, value: (x) => x && x.v, gate: () => '',
  write: async (o, value, payload) => {
    sent.push({ value, payload: { ...payload } });
    if (value === 5) {
      if (T.mode === 'interlock') return { ok: false, error: 'Refused', code: 0x402, detail: 'motion running' };
      if (T.mode === 'auto') setTimeout(() => T.land(), 50);
      return { ok: true, applied: { 8: 1 } };
    }
    if (value === 3 || value === 4) return { ok: true, applied: { 8: 2 } };
    await new Promise((r) => setTimeout(r, 80));
    const ssid = payload[2], pass = payload[3];
    // The right password is written reversed: the page's own source must not hold it.
    const hub = ssid === 'Nowhere' ? 'network not found' : ssid === 'Guest' || [...pass].reverse().join('') === '${[...RIGHT].reverse().join('')}' ? '' : 'authentication failed';
    if (!hub) return { ok: true, applied: { 1: 1, 4: 0xc0a80164, 5: 82 } };
    const err = { code: NACK.NETWORK_JOIN_FAILED, detail: hub };
    return { ok: false, error: provisionRefusal(err).text, code: err.code, detail: err.detail };
  },
};
// ?card=1: the Network card (no credential binding), mounted out of view until T.reveal().
const hostEl = document.getElementById('host');
if (Q.get('card')) { hostEl.hidden = true; T.reveal = () => { hostEl.hidden = false; }; }
inst = mountPicker(api, hostEl, f, Q.get('card') ? {} : { join: (e) => events.push({ phase: e.phase, channel: e.action.channelId, ok: e.ok, code: e.code, detail: e.detail, applied: e.applied }) });
T.ready = pickerReady(api, f);
</script>`;
  const srv = createServer((q, s) => {
    const url = decodeURIComponent(q.url.split('?')[0]);
    if (url === '/') { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(PAGE_HTML); return; }
    try {
      const p = join(ROOT, url);
      if (!p.startsWith(ROOT) || !statSync(p).isFile()) throw new Error('no');
      s.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
      s.end(readFileSync(p));
    } catch (e) { s.writeHead(404); s.end(); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const ctx = await browser.newContext({ viewport: { width: 480, height: 800 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.waitForFunction(() => window.T, null, { timeout: 10000 });
  ok('detected: the op lists scan and the visible channel is claimed', await page.evaluate(() => window.T.ready));
  await page.waitForFunction(() => document.querySelectorAll('.wp-row').length === 3, null, { timeout: 5000 });
  ok('opening asks one scan, the rows arrive on STATE', (await page.evaluate(() => window.T.sent.map((x) => x.value))).join() === '5');
  ok('the act reads Join on a credential binding', await page.evaluate(() => { document.querySelector('.wp-row[data-ssid="Workshop"]').click(); return document.querySelector('.wp-join .og-btn.primary').innerText; }) === 'Join');
  const status = () => page.locator('.wp-status').innerText();
  const joinWith = async (pass) => {
    await page.fill('.wp-join input[type=password]', pass);
    await page.click('.wp-join .og-btn.primary');
    ok('the password field is cleared at send', await page.inputValue('.wp-join input[type=password]') === '');
    await page.waitForFunction(() => !/Joining/.test(document.querySelector('.wp-status').textContent), null, { timeout: 5000 });
  };
  await joinWith(WRONG);
  ok('wrong password: the hub\'s "authentication failed" in words, the form stays', await status() === 'Wrong password' && await page.locator('.wp-join').isVisible(), await status());
  let ev = await page.evaluate(() => window.T.events);
  ok('the flow hears start, then done with the refusal (provisioning channel)',
    ev.length === 2 && ev[0].phase === 'start' && ev[1].phase === 'done' && ev[1].ok === false && ev[1].detail === 'authentication failed' && ev.every((e) => e.channel === 15), ev);
  let last = await page.evaluate(() => window.T.sent.at(-1));
  ok('wifi_join carries the SSID and the password', last.value === 1 && last.payload[2] === 'Workshop' && last.payload[3] === WRONG && !(8 in last.payload), last.value);
  await joinWith(RIGHT);
  ok('right password: Joined, back on the list', await status() === 'Joined' && await page.locator('.wp-pick').isVisible(), await status());
  ev = await page.evaluate(() => window.T.events);
  ok('done carries the applied address for the handover', ev.at(-1).ok === true && ev.at(-1).applied[5] === 82, ev.at(-1));
  await page.click('.wp-row[data-ssid="Guest"]');
  await page.waitForFunction(() => document.querySelector('.wp-status').textContent === 'Joined', null, { timeout: 5000 });
  last = await page.evaluate(() => window.T.sent.at(-1));
  ok('an open network joins at once with an empty password', last.value === 1 && last.payload[2] === 'Guest' && last.payload[3] === '');
  await page.click('.wp-foot .og-btn >> text=Other network…');
  await page.fill('.wp-join input[aria-label="Name"]', 'Nowhere');
  await joinWith(RIGHT);
  ok('Other network: a name the hub cannot find reads "Network not found"', await status() === 'Network not found', await status());
  const k = await kept(page);
  ok('no password on the page, in storage or in the console', ![RIGHT, WRONG].some((s) => k.includes(s) || logs.some((l) => l.includes(s))));
  ok('no page errors', !logs.some((l) => l.startsWith('pageerror')), logs);
  await page.close();

  // Rows pushed at the grant: stale until the scan counter changes.
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const order = (pg) => pg.$$eval('.wp-row', (rs) => rs.map((r) => r.dataset.ssid).join());
  const p1 = await ctx.newPage();
  p1.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await p1.goto(base + '?pre=1&scan=manual');
  await p1.waitForFunction(() => window.T && document.querySelectorAll('.wp-row').length === 3, null, { timeout: 10000 });
  ok('stale: the rows of the grant are greyed and untappable', await p1.locator('.wp-list[data-stale]').count() === 1
    && await p1.$$eval('.wp-row', (rs) => rs.every((r) => r.disabled)));
  ok('stale: the status reads Scanning', await p1.locator('.wp-status').innerText() === 'Scanning');
  await p1.evaluate(() => window.T.land());
  ok('a fresh scan clears the stale mark and the rows answer', await p1.locator('.wp-list[data-stale]').count() === 0
    && await p1.$$eval('.wp-row', (rs) => rs.every((r) => !r.disabled)) && await p1.locator('.wp-status').innerText() === '');

  // The order is held while the user interacts; rows are patched by SSID, never by position.
  const REORDER = [['Cafe', -40, 0, 1], ['Workshop', -60, 1], ['Guest', -80, 0]];
  const BACK = [['Workshop', -48, 1], ['Guest', -61, 0], ['Cafe', -75, 0, 1]];
  ok('order before: strongest first', await order(p1) === 'Workshop,Guest,Cafe');
  const gb = await p1.locator('.wp-row[data-ssid="Guest"]').boundingBox();
  await p1.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await p1.mouse.down();
  await p1.evaluate((r) => window.T.land(r), REORDER);
  await p1.waitForTimeout(200);
  ok('a press holds the order', await order(p1) === 'Workshop,Guest,Cafe', await order(p1));
  ok('a held row still takes its new signal, found by SSID', await p1.locator('.wp-row[data-ssid="Cafe"]').getAttribute('data-tip') === '-40 dBm'
    && await p1.locator('.wp-row[data-ssid="Guest"]').getAttribute('data-tip') === '-80 dBm');
  await p1.mouse.move(2, 2);
  await p1.mouse.up();
  await p1.waitForFunction(() => [...document.querySelectorAll('.wp-row')].map((r) => r.dataset.ssid).join() === 'Cafe,Workshop,Guest', null, { timeout: 3000 });
  ok('on release the rows sort again', true);
  await p1.click('.wp-row[data-ssid="Workshop"]');
  await p1.evaluate((r) => window.T.land(r), BACK);
  await p1.waitForTimeout(200);
  ok('an open sheet holds the order', await order(p1) === 'Cafe,Workshop,Guest', await order(p1));
  await p1.click('.wp-join .og-btn >> text=Cancel');
  await p1.waitForFunction(() => [...document.querySelectorAll('.wp-row')].map((r) => r.dataset.ssid).join() === 'Workshop,Guest,Cafe', null, { timeout: 3000 });
  ok('closing the sheet sorts again', true);

  // A saved row: no one-tap join; passphrase again, move, remove.
  const sentBefore = await p1.evaluate(() => window.T.sent.length);
  await p1.click('.wp-row[data-ssid="Cafe"]');
  ok('a saved row opens its sheet and sends nothing on the tap', await p1.locator('.wp-join').isVisible()
    && await p1.evaluate(() => window.T.sent.length) === sentBefore && await p1.locator('.wp-manage').isVisible());
  ok('the sheet offers move and remove; the only entry cannot move',
    await p1.locator('.wp-manage .og-btn', { hasText: 'Move up' }).isDisabled() && await p1.locator('.wp-manage .og-btn', { hasText: 'Move down' }).isDisabled()
    && await p1.locator('.wp-manage .og-btn', { hasText: 'Remove' }).isEnabled());
  const rmBtn = p1.locator('.wp-manage .og-btn', { hasText: /Remove|Confirm/ });
  await rmBtn.click();
  ok('Remove asks first', await rmBtn.innerText() === 'Confirm' && await p1.evaluate(() => window.T.sent.length) === sentBefore);
  await rmBtn.click();
  await p1.waitForFunction(() => document.querySelector('.wp-status').textContent === 'Removed', null, { timeout: 3000 });
  last = await p1.evaluate(() => window.T.sent.at(-1));
  ok('Remove sends op 3 with the slot and the generation read', last.value === 3 && last.payload[6] === 0 && last.payload[8] === 1, last);
  await p1.close();

  // Scan refused in motion: INTERLOCK in plain words, asked again until it lands.
  const clocked = async (qs) => {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
    await pg.clock.install();
    await pg.goto(base + qs);
    await pg.waitForTimeout(800);
    return pg;
  };
  const p2 = await clocked('?scan=interlock');
  ok('INTERLOCK: "Machine is moving", not a failure', await p2.locator('.wp-status').innerText() === 'Machine is moving', await p2.locator('.wp-status').innerText());
  await p2.evaluate(() => { window.T.mode = 'auto'; });
  await p2.clock.runFor(4200);
  await p2.clock.runFor(200);
  ok('asked again once motion stops: the rows land', (await p2.evaluate(() => window.T.sent.map((x) => x.value))).join() === '5,5'
    && await p2.locator('.wp-row').count() === 3 && await p2.locator('.wp-status').innerText() === '');
  await p2.close();

  // A scan that never lands: the ECHO meant accepted, so it times out at 30 s.
  const p3 = await clocked('?scan=hang');
  ok('waiting: Scanning', await p3.locator('.wp-status').innerText() === 'Scanning');
  await p3.clock.runFor(29000);
  ok('29 s: still waiting', await p3.locator('.wp-status').innerText() === 'Scanning');
  await p3.clock.runFor(1500);
  ok('30 s: a plain timeout, Scan answers again', await p3.locator('.wp-status').innerText() === 'Scan timed out' && await p3.locator('.wp-scan').isEnabled());
  await p3.close();

  // The card sends no scan until it is on screen: a hub that declares 0x000F, granted and updated, hears nothing.
  const pc = await ctx.newPage();
  pc.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await pc.goto(base + '?card=1');
  await pc.waitForFunction(() => window.T, null, { timeout: 10000 });
  await pc.evaluate(() => { window.T.land(); });
  await pc.waitForTimeout(600);
  ok('out of view: no scan intent on mount, grant or a catalog update', (await pc.evaluate(() => window.T.sent.length)) === 0, await pc.evaluate(() => window.T.sent));
  await pc.evaluate(() => window.T.reveal());
  await pc.waitForFunction(() => window.T.sent.length === 1, null, { timeout: 5000 });
  ok('opened: the first scan is asked then, once', (await pc.evaluate(() => window.T.sent.map((x) => x.value))).join() === '5');
  await pc.close();
  ok('no page errors in the rows rules', !logs.some((l) => l.startsWith('pageerror')), logs);
  await ctx.close();
  srv.close();
}

// ---- the Network card against valencesim ----
console.log('Network card');
const sim = await startSim({ extra: ['--pairing-window'] });
if (!sim) {
  console.log('SKIP: no valencesim (set VALENCESIM)');
} else {
  const knock = createSession({ host: '127.0.0.1', port: sim.port, clientKind: 'webui', clientName: 'wifipicker test', instanceId: INSTANCE, autoReconnect: false });
  await new Promise((res) => { knock.on('welcome', res); knock.connect(); });
  const grant = await new Promise((res) => { knock.on('pairGrant', res); knock.sendPairReq(); });
  knock.close();
  ok('the pairing window grants configure', grant.role === 2, grant.role);
  const TOKEN = toHex(grant.token);
  const SHELL = await buildShellPage();
  const srv = createServer((q, s) => {
    if (q.url.startsWith('/uitoken')) {
      fetch('http://127.0.0.1:' + sim.http + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
        .catch(() => { s.writeHead(502); s.end('{}'); });
      return;
    }
    s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.on('exit', () => { try { srv.close(); } catch (e) { /* gone */ } });

  const open = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(TAURI_STUB);
    await ctx.addInitScript(([port, tok, inst]) => {
      try {
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
        localStorage.setItem('valence.tok.127.0.0.1:' + port, tok);
        localStorage.setItem('valence.instance', inst);
      } catch (e) { /* none */ }
    }, [sim.port, TOKEN, toHex(INSTANCE)]);
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    await goTab(page, 'cat11');
    return { ctx, page, logs };
  };
  const ssids = (page) => page.$$eval('.wp-row', (rs) => rs.map((r) => r.dataset.ssid));
  const status = (page) => page.locator('.wp-status').innerText();
  const settle = (page, from) => page.waitForFunction((t) => { const s = document.querySelector('.wp-status').textContent; return s && s !== t; }, from, { timeout: 10000 });
  const shot = (page, view, w) => page.screenshot({ path: join(EVIDENCE, 'wifipicker-' + view + '-' + w + '.png') });

  const { ctx, page, logs } = await open(1428, 900);
  const listed = await page.waitForFunction(() => document.querySelectorAll('.wp-row').length >= 10, null, { timeout: 30000 }).then(() => true, () => false);
  if (!listed && !await page.locator('.wp-row').count()) {
    console.log('SKIP: this valencesim lists no networks (RFC-118 twin absent)');
  } else {
    const NEIGHBORS = ['Neutrino', 'Workshop', 'Workshop-Lab', 'Guest', 'Neighbor', 'Printer-Direct', 'Cafe', 'Upstairs', 'Attic', 'Garage'];
    ok('the list: both halves, strongest first', (await ssids(page)).join() === NEIGHBORS.join(), await ssids(page));
    const first = page.locator('.wp-row').first();
    ok('the connected network leads with its check and Connected', await first.getAttribute('aria-current') === 'true'
      && await first.locator('.wp-ok').count() === 1 && /Connected/.test(await first.innerText()));
    ok('locks on secured rows only', await page.locator('.wp-row[data-ssid="Guest"] .wp-lock').count() === 0
      && await page.locator('.wp-row[data-ssid="Workshop"] .wp-lock').count() === 1 && await page.locator('.wp-row[data-ssid="Cafe"] .wp-lock').count() === 0);
    ok('signal bars: four on the strongest, one on the weakest',
      await page.locator('.wp-row[data-ssid="Neutrino"] .wp-bars path:not(.off)').count() === 4 && await page.locator('.wp-row[data-ssid="Garage"] .wp-bars path:not(.off)').count() === 1);
    ok('the hidden and enterprise networks are not listed', (await ssids(page)).length === 10);
    ok('a fresh scan has landed: no stale mark', await page.locator('.wp-list[data-stale]').count() === 0);
    ok('the default view: no slot card, no generic cards for the network channels',
      await page.locator('.sn').isHidden() && await page.locator('[data-uid^="15:"], [data-uid^="23:"], [data-uid^="24:"], [data-uid^="25:"], [data-uid^="26:"]').count() === 0);
    ok('Other network… and Advanced at the bottom', await page.locator('.wp-foot .og-btn', { hasText: 'Other network…' }).isVisible()
      && await page.locator('.wp-foot .og-btn', { hasText: 'Advanced' }).isVisible());
    await page.waitForFunction(() => !document.querySelector('.wp-scan')?.disabled, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    await shot(page, 'list', 1428);

    // A short password: the hub refuses it in words.
    await page.click('.wp-row[data-ssid="Workshop"]');
    ok('a secured row asks one password field, the act reads Save', await page.locator('.wp-join input[type=password]').isVisible()
      && await page.locator('.wp-join input[aria-label="Name"]').isHidden() && await page.locator('.wp-join .og-btn.primary').innerText() === 'Save');
    await page.fill('.wp-join input[type=password]', RIGHT);
    await shot(page, 'password', 1428);
    await page.fill('.wp-join input[type=password]', 'short');
    await page.click('.wp-join .og-btn.primary');
    ok('the password field is cleared at send', await page.inputValue('.wp-join input[type=password]') === '');
    await settle(page, 'Saving');
    ok('a short password: the hub\'s refusal in words', /8 to 63 characters/.test(await status(page)), await status(page));
    await page.fill('.wp-join input[type=password]', RIGHT);
    await page.click('.wp-join .og-btn.primary');
    await settle(page, 'Saving');
    ok('Save: Saved, with the join-at-next-connect tip', await status(page) === 'Saved'
      && /next connect/.test(await page.locator('.wp-status').getAttribute('data-tip') || ''), await status(page));
    await page.waitForFunction(() => /Saved/.test(document.querySelector('.wp-row[data-ssid="Workshop"]')?.innerText || ''), null, { timeout: 8000 });
    ok('the saved row is marked Saved', true);

    await page.click('.wp-row[data-ssid="Guest"]');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('.wp-row[data-ssid="Guest"]')?.innerText || ''), null, { timeout: 8000 });
    ok('an open network saves at once, nothing typed', await page.locator('.wp-join').isHidden());

    await page.click('.wp-row[data-ssid="Workshop"]');
    ok('a saved row opens its sheet: passphrase again, move, remove; nothing is sent', await page.locator('.wp-join').isVisible()
      && await page.locator('.wp-manage').isVisible() && await page.locator('.wp-join .og-btn.primary').isDisabled() && await status(page) === '');
    await page.click('.wp-join .og-btn >> text=Cancel');

    // The hub paces its STATE pushes: the next save reads the generation the picker has, so wait for Workshop and Guest in the list.
    await page.waitForFunction(() => document.querySelectorAll('.sn .ui-tile').length === 3, null, { timeout: 15000 });
    await page.locator('.wp-foot .og-btn', { hasText: 'Other network…' }).click();
    await page.fill('.wp-join input[aria-label="Name"]', 'Attic');
    await page.fill('.wp-join input[type=password]', RIGHT);
    await page.click('.wp-join .og-btn.primary');
    await settle(page, 'Saving');
    ok('Other network: the hidden Attic saved by hand', await status(page) === 'Saved', await status(page));

    await page.locator('.wp-scan').click();
    const scanning = await status(page);
    await page.waitForFunction(() => document.querySelector('.wp-status').textContent !== 'Scanning', null, { timeout: 16000 }).catch(() => {});
    ok('Scan: a progress mark, cleared by a newer scan', scanning === 'Scanning' && await status(page) === '' && (await ssids(page)).length === 10, [scanning, await status(page)]);

    await page.locator('.wp-foot .og-btn', { hasText: 'Advanced' }).click();
    await page.waitForSelector('.sn .ui-tile', { timeout: 5000 });
    const titles = await page.$$eval('.sn .ui-tile-t', (ts) => ts.map((t) => t.textContent));
    ok('Advanced reveals the slot card: the four saved, in order', titles.join() === 'Neutrino,Workshop,Guest,Attic', titles);
    await page.locator('.sn').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'advanced', 1428);

    await goTab(page, 'cat15');
    await page.waitForTimeout(500);
    ok('the Setup page draws no generic provisioning card', await page.locator('[data-uid^="15:"]').count() === 0);

    const k = await kept(page);
    ok('no password on the page, in storage or in the console', !k.includes(RIGHT) && !logs.some((l) => l.includes(RIGHT) || l.includes('short')));
    ok('no page errors', !logs.some((l) => l.startsWith('pageerror')), logs.filter((l) => l.startsWith('pageerror')));

    // The phone class.
    const ph = await open(420, 860);
    await ph.page.waitForFunction(() => document.querySelectorAll('.wp-row').length >= 10, null, { timeout: 30000 }).catch(() => {});
    await ph.page.locator('.wp-row').first().scrollIntoViewIfNeeded();
    ok('phone: no sideways scroll', await ph.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await ph.page.waitForTimeout(300);
    await shot(ph.page, 'list', 420);
    await ph.page.click('.wp-row[data-ssid="Neighbor"]');
    await ph.page.locator('.wp-join').scrollIntoViewIfNeeded();
    await shot(ph.page, 'password', 420);
    await ph.page.click('.wp-join .og-btn >> text=Cancel');
    await ph.page.locator('.wp-foot .og-btn', { hasText: 'Advanced' }).click();
    await ph.page.waitForSelector('.sn .ui-tile', { timeout: 5000 });
    await ph.page.locator('.sn').scrollIntoViewIfNeeded();
    await ph.page.waitForTimeout(300);
    await shot(ph.page, 'advanced', 420);
    await ph.ctx.close();
  }
  await ctx.close();
}

await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
