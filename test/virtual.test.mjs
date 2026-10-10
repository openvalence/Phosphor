/**
 * virtual.test.mjs -- Virtual Valence, the built-in machine and the Merge pane on the shell bundle
 * (stub Tauri runtime), ph-6iu.
 *
 * A saved hub with a vault record (written by vault.js's own recorder) is on
 * the Hubs pane beside the always-present built-in machine row. With no
 * network, Sim opens the virtual hub and reaches LIVE; the bar reads virtual
 * and a setting write stages. Then the same hub_instance_id comes up as "the
 * real machine" (Playwright's fake hub): the Merge pane lists the row with
 * the hub's value and the staged one, pre-ticked; Apply sends one intent,
 * the hub echoes, the row settles and staging empties. Last, the built-in
 * machine: Connect boots the real Nucleus twin (wasm, in a worker) and joins
 * it over no socket, the row reads its version and offers Stop, its state
 * blob persists, nothing is remembered, and it boots again from that state.
 *
 * Run: node test/virtual.test.mjs [--shots <dir>]   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, CBOR_FIELD, CHANNEL_CLASS, PACKED, PACKED_SIZE } from '../../Valence/clients/js/frames.js';
import { defaultSnapshot, schemaByKey } from '../../Valence/clients/js/index.js';

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const toHex = (b) => Buffer.from(b).toString('hex');
const ID = 'feedc0de00000001';
const FIELD_UID = '4386:smoothness'; // kinetic-planner, an unroled f32 setting on 0x3120 key 4

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };

// The vault record, written by the module the shell itself records with.
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
} });
const { recorder } = await import('../src/model/vault.js');
const rec = recorder();
rec.welcome({ hub_instance_id: ID, hub_name: 'Bench', product: 'valencesim', estop_cuts_power: false }, '127.0.0.1', 82);
rec.catalog(CAT);
rec.flush();
const SEED = Object.fromEntries(mem);

// ---- the real machine: a fake hub with the same hub_instance_id --------------
const wire = { opens: 0, urls: [], intents: [], snaps: new Map() };
for (const e of ENTRIES) if (e.layout && e.cls === CHANNEL_CLASS.STATE) wire.snaps.set(e.id, defaultSnapshot(e));
function fakeHub(ws) {
  wire.opens++;
  wire.urls.push(ws.url());
  const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
  ws.onMessage((msg) => {
    if (typeof msg === 'string') return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        // §6.2/§6.3: a wish the catalog does not hold (0x0001 on this sim) is not
        // granted, and retained_pending counts only the STATE pushes that follow.
        const subs = (cbDecodeFull(payload).get(K.subscriptions) || []).filter((w) => ENTRIES.some((e) => e.id === w.get(K.channel_id)));
        const grants = subs.map((w) => cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbF32(w.get(K.rate_hz) || 0)],
          [K.channel_id, cbUint(w.get(K.channel_id))]]));
        send(FRAME.WELCOME, 0, cbMap([
          [K.proto_ver, cbUint(1)], [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.retained_pending, cbUint(subs.filter((w) => wire.snaps.has(w.get(K.channel_id))).length)], [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(2000)], [K.grants, cbArray(grants)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('valencesim')], [IDENTITY_K.hub_name, cbTstr('Bench')],
            [IDENTITY_K.hub_instance_id, cbUint(BigInt('0x' + ID))], [IDENTITY_K.estop_cuts_power, cbBool(false)]])],
        ]));
        for (const w of subs) { const ch = w.get(K.channel_id); if (wire.snaps.has(ch)) send(FRAME.STATE, ch, wire.snaps.get(ch)); }
      } else if (header.type === FRAME.SUBSCRIBE) {
        const subs = cbDecodeFull(payload).get(K.subscriptions) || [];
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(subs.map((w) => cbMap([[K.priority, cbUint(0)], [K.granted_rate_hz, cbF32(0)],
          [K.channel_id, cbUint(w.get(K.channel_id))]])))]]));
        for (const w of subs) { const ch = w.get(K.channel_id); if (wire.snaps.has(ch)) send(FRAME.STATE, ch, wire.snaps.get(ch)); }
      } else if (header.type === FRAME.INTENT) {
        const m = cbDecodeFull(payload);
        const ch = m.get(K.channel_id), id = m.get(K.intent_id), val = [...m.get(K.value)].sort((a, b) => a[0] - b[0]);
        wire.intents.push({ ch, val });
        const schema = schemaByKey(ENTRIES.find((e) => e.id === ch));
        const enc = (k, v) => (schema.get(k).type === CBOR_FIELD.f32_t ? cbF32(v) : schema.get(k).type === CBOR_FIELD.bool_t ? cbBool(v) : cbUint(v));
        send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)], [K.applied, cbMap(val.map(([k, v]) => [k, enc(k, v)]))]]));
        const st = ENTRIES.find((e) => e.settingChannel === ch && e.layout.some((f) => f.settingKey === val[0][0]));
        const f = st.layout.find((x) => x.settingKey === val[0][0]);
        const snap = wire.snaps.get(st.id);
        let off = 0;
        for (const x of st.layout) { if (x === f) break; off += PACKED_SIZE[x.type]; }
        if (f.type === PACKED.f32) new DataView(snap.buffer, snap.byteOffset).setFloat32(off, val[0][1], true);
        else snap[off] = val[0][1];
        send(FRAME.STATE, st.id, snap);
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

// ---- the page ------------------------------------------------------------------
const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(([seed, etag, bytes, id]) => {
  try {
    if (sessionStorage.getItem('booted')) return;
    sessionStorage.setItem('booted', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
    localStorage.setItem('phosphor.prefs', JSON.stringify({ v: 1, reconnect: false }));
    localStorage.setItem('phosphor.hubs', JSON.stringify([{ id, host: '127.0.0.1', port: 82, name: 'Bench', nickname: '', lastSeen: Date.now() - 60000 }]));
  } catch (e) { /* no storage */ }
}, [SEED, ETAG, toHex(CAT), ID]);
await ctx.addInitScript(TAURI_STUB);
await ctx.routeWebSocket(/./, fakeHub);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
const openTab = async (id) => {
  await page.waitForSelector('[data-tab-id="' + id + '"]', { timeout: 15000 });
  await page.click('[data-tab-id="' + id + '"]');
  await page.waitForTimeout(250);
};
// The link dot's words: live, virtual, connecting...
const chip = async () => (await page.locator('.linkbar .linkdot .sr').textContent()).replace(/^Link:\s*/, '').toLowerCase();
async function until(fn, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(50)) if (await fn()) return true;
  return false;
}

console.log('virtual: Sim from the Hubs pane, then Merge onto the real machine');
await openTab('shell:hubs');
const rows = page.locator('.pane-list.rows').first().locator('li');
ok('the built-in machine is the last saved-hub row, badged virtual',
  (await rows.last().locator('.name').innerText()).startsWith('Virtual') && await rows.last().locator('.mark').innerText() === 'ν virtual');
const sim = page.getByRole('button', { name: 'Sim Bench' });
ok('the saved hub offers Sim from its vault record', await sim.isEnabled());
if (SHOTS) await page.screenshot({ path: join(SHOTS, 'hubs-pane.png') });

await sim.click();
ok('Sim reaches LIVE on the virtual hub', await until(async () => (await chip()).includes('virtual')), await chip());
ok('no socket was opened', wire.opens === 0, wire.opens);
ok('the hub title reads virtual', (await page.locator('.linkbar .wordmark').innerText()) === 'Bench (virtual)');
ok('the safety strip is rendered', await page.locator('.strip').count() > 0);
const remembered = await page.evaluate(() => [localStorage.getItem('shell_host'), JSON.parse(localStorage.getItem('phosphor.hubs')).length]);
ok('the virtual hub is never remembered', remembered[0] === null && remembered[1] === 1, JSON.stringify(remembered));

// Write a setting on whichever category page draws it.
let field = null;
for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
  await page.click('[data-tab-id="' + id + '"]');
  await page.waitForTimeout(150);
  if (await page.locator('.field[data-uid="' + FIELD_UID + '"]').count()) { field = page.locator('.field[data-uid="' + FIELD_UID + '"]'); break; }
}
ok('the setting renders on a category page', !!field);
if (field) {
  await field.locator('input[type=range]').evaluate((el) => { el.value = '0.5'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
}
const staged = await until(async () => {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.merge') || '{}'));
  return s[ID] && s[ID][FIELD_UID] && s[ID][FIELD_UID].value === 0.5;
});
ok('the echoed write staged for the machine', staged,
  await page.evaluate(() => localStorage.getItem('phosphor.merge')));
// ph-6n0: a virtual hub measured nothing; its echo is never the reality voice.
const intentRgb = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--intent-rgb')
  .trim().split(/\s*,\s*/).map(Number).join());
if (field) {
  ok('a virtual echo says virtual in the slot, never confirmed',
    await until(async () => (await field.locator('.ladder').textContent()) === 'virtual', 3000), await field.locator('.ladder').textContent());
  const glowRgb = await field.evaluate((f) => [...getComputedStyle(f, '::after').boxShadow.matchAll(/rgba?\(([^)]+)\)/g)][2][1]
    .split(/[\s,/]+/).slice(0, 3).map(Number).join());
  ok('...and its afterglow wears the intent family', glowRgb === await intentRgb(), glowRgb);
}
await openTab('machine');
const hn = await page.locator('.hero-numerals .hn-primary .hn-val').evaluate((el) => {
  const s = getComputedStyle(el), p = document.body.appendChild(document.createElement('i'));
  p.style.color = 'var(--intent)';
  const intent = getComputedStyle(p).color;
  p.remove();
  return { color: s.color, intent, shadow: s.textShadow };
});
ok('the hero numerals speak in intent, unlit, over the virtual snapshot', hn.color === hn.intent && hn.shadow === 'none', JSON.stringify(hn));
if (SHOTS) await page.screenshot({ path: join(SHOTS, 'home-virtual.png') });
await openTab('shell:merge');
ok('Merge says writes stage while virtual', (await page.locator('.mp .pane-status').innerText()).startsWith('Writes stage for Bench'));

// The real machine, same hub_instance_id.
await openTab('shell:hubs');
await page.locator('.pane-list.rows').first().locator('li').first().getByRole('button', { name: 'Connect' }).click();
ok('the real machine reaches LIVE', await until(async () => (await chip()) === 'live'), await chip());
ok('one socket, to the fake hub', wire.opens === 1, wire.opens);
await openTab('shell:merge');
const row = page.locator('.mrows li[data-uid="' + FIELD_UID + '"]');
ok('the merge row is listed', await until(async () => (await row.count()) === 1));
ok('it shows the hub value and the staged value', (await row.locator('.old').innerText()) === '0.00' && (await row.locator('.new').innerText()) === '0.50',
  (await row.locator('.old').innerText()) + ' -> ' + (await row.locator('.new').innerText()));
ok('it is pre-ticked', await row.locator('input[type=checkbox]').isChecked());
if (SHOTS) await page.screenshot({ path: join(SHOTS, 'merge-pane.png') });
await page.getByRole('button', { name: 'Apply ticked' }).click();
ok('the row settles on the echo', await until(async () => (await row.getAttribute('data-phase')) === 'settled'), await row.locator('.state').innerText());
ok('one intent, the staged value, on the setting channel',
  wire.intents.length === 1 && wire.intents[0].ch === 0x3120 && wire.intents[0].val[0][0] === 4 && wire.intents[0].val[0][1] === 0.5,
  JSON.stringify(wire.intents));
ok('staging is empty', await page.evaluate((id) => !JSON.parse(localStorage.getItem('phosphor.merge') || '{}')[id], ID));
ok('the hub value now reads the applied one', await until(async () => (await row.locator('.old').innerText()) === '0.50'));

console.log('virtual: the built-in machine (Nucleus twin as wasm, in a worker)');
await openTab('shell:hubs');
const vrow = () => page.locator('.pane-list.rows').first().locator('li.virtual');
ok('the last row is the built-in machine', (await vrow().locator('.name').innerText()).startsWith('Virtual'), await vrow().locator('.name').innerText());
const opensBefore = wire.opens;
await vrow().getByRole('button', { name: 'Connect' }).click();
ok('Connect boots it and reaches LIVE', await until(async () => (await chip()) === 'live', 15000), await chip());
ok('...over no socket', wire.opens === opensBefore, wire.opens);
ok('the Transport reads In app', await until(() => page.evaluate(() => document.querySelector('.pane-facts')?.innerText.includes('In app'))),
  await page.locator('.pane-facts').first().innerText());
ok('the row reads the Nucleus version', /^Nucleus \d/.test(await vrow().locator('.meta').innerText()), await vrow().locator('.meta').innerText());
ok('the row offers Stop', await vrow().getByRole('button', { name: 'Stop' }).isVisible());
ok('its state blob persists', await until(() => page.evaluate(() => !!localStorage.getItem('phosphor.builtin.state'))));
const simKept = await page.evaluate(() => [localStorage.getItem('shell_host'), JSON.parse(localStorage.getItem('phosphor.hubs')).length]);
ok('the built-in machine is never remembered', simKept[0] !== 'builtin' && simKept[1] === 1, JSON.stringify(simKept));
await vrow().getByRole('button', { name: 'Stop' }).click();
ok('Stop ends the session', await until(async () => vrow().getByRole('button', { name: 'Connect' }).isVisible()));
await vrow().getByRole('button', { name: 'Connect' }).click();
ok('a second boot from the saved state reaches LIVE', await until(async () => (await chip()) === 'live', 15000), await chip());
await vrow().getByRole('button', { name: 'Stop' }).click();
ok('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall passed');
process.exit(fails ? 1 : 0);
