/**
 * nest.test.mjs -- ph-e82.6: a scrolling nest never hides a write in flight
 * (RENDERING §9 placement invariant, DESIGN §10.6).
 *
 * The built app on a fake hub (Playwright's WebSocket route; the recorded
 * valencesim catalog pre-seeded in the etag cache). A category page's cards
 * are put into one scrolling nest through the stored layout, a write is made
 * on the last member while the hub holds its echo, the nest is scrolled back
 * to the top so that member is out of view, and the nest's frame must carry
 * the in-flight count outside the scroll region. The count clears on echo.
 *
 * Deliberately NOT part of `npm run check` (it launches a browser).
 * Build first (`npm run build:only`); this builds nothing.
 * Run: node test/nest.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS } from '../../Valence/clients/js/frames.js';
import { STORE_KEY } from '../src/model/grid.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- the fake hub: STATE from the catalog, INTENT echoed now or held ----------
const hub = { mode: 'echo', held: [], values: {} };
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
            [IDENTITY_K.hub_name, cbTstr('Nest fixture')]])],
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
        const st = ENTRIES.find((e) => e.settingChannel === ch);
        const answer = () => {
          for (const [k, v] of val) {
            const f = st && st.layout.find((x) => x.settingKey === k);
            if (f) hub.values[st.id + ':' + f.name] = v;
          }
          send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)],
            [K.applied, cbMap(val.map(([k, v]) => [k, cbAny(v)]))]]));
          if (st) pushState(st.id);
        };
        if (hub.mode === 'echo') answer(); else hub.held.push(answer);
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}
// Writes leave at the channel's catalog rate, so the intent may not be held yet.
async function release() {
  for (let i = 0; i < 100 && !hub.held.length; i++) await sleep(10);
  for (const a of hub.held.splice(0)) a();
}

// ---- the page ---------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([etag, bytes]) => {
  try { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* none */ }
}, [ETAG, Buffer.from(CAT).toString('hex')]);
await ctx.routeWebSocket(/:82\//, fakeHub);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto('http://127.0.0.1:' + PORT + '/');
await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
await page.waitForTimeout(400);

// A category page with at least three cards, one of them holding a writable range.
const tabs = page.locator('nav.rail [role=tab]');
let tab = -1, viewKey = '', cards = [];
for (let i = 1; i < await tabs.count() && tab < 0; i++) {
  await tabs.nth(i).click();
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const g = document.querySelector('.dash-grid[data-view]');
    if (!g) return null;
    const ids = [...g.children].map((c) => c.getAttribute('data-id'));
    return { key: g.getAttribute('data-view'), ids, range: !!g.querySelector('input[type=range]:not([disabled])') };
  });
  if (r && r.range && r.ids.length >= 3) { tab = i; viewKey = r.key; cards = r.ids; }
}
ok('found a category page with three or more cards and a writable range', tab > 0, viewKey + ' ' + cards.length);
if (tab < 0) { await browser.close(); srv.close(); process.exit(1); }

// Every card into one short scrolling nest, through the stored layout.
const store = { active: 'Default', modules: {}, layouts: { Default: { [viewKey]: {
  'nest:1': { x: 0, y: 0, w: 20, h: 5, nest: { title: 'Test nest', scroll: true, map: Object.fromEntries(cards.map((id) => [id, null])) } },
} } } };
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE_KEY, JSON.stringify(store)]);
await page.reload();
await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
await tabs.nth(tab).click();
await page.waitForTimeout(400);

const nest = page.locator('.dash-cell[data-id="nest:1"]');
const geo = await nest.evaluate((cell) => {
  const body = cell.querySelector('.nest-body');
  const top = [...cell.closest('.dash-grid').children].map((c) => c.getAttribute('data-id'));
  return { scrolls: !!cell.querySelector('.nest.scrolls'), sh: body.scrollHeight, ch: body.clientHeight,
    members: body.querySelectorAll('.dash-cell').length, top };
});
ok('the nest renders, scrolling, with every card inside it', geo.scrolls && geo.members === cards.length && geo.top.join() === 'nest:1', geo);
ok('the nest body is a scroll region shorter than its content', geo.sh > geo.ch + 20, geo);

// The last member with a writable range: write it while the hub holds the echo.
const target = await nest.evaluate((cell) => {
  const withRange = [...cell.querySelectorAll('.nest-body .dash-cell')].filter((c) => c.querySelector('input[type=range]:not([disabled])'));
  const m = withRange[withRange.length - 1];
  m.querySelector('input[type=range]').scrollIntoView({ block: 'nearest' });
  return m.getAttribute('data-id');
});
const range = nest.locator('.nest-body .dash-cell[data-id="' + target + '"] input[type=range]').first();
hub.mode = 'hold';
await range.evaluate((el) => {
  const step = Number(el.step) || 1, v = Number(el.value);
  el.value = String(v + step <= Number(el.max) ? v + step : v - step);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(100);
await nest.evaluate((cell) => { cell.querySelector('.nest-body').scrollTop = 0; });
await page.waitForTimeout(100);
const away = await nest.evaluate((cell, id) => {
  const body = cell.querySelector('.nest-body').getBoundingClientRect();
  const r = cell.querySelector('.nest-body .dash-cell[data-id="' + id + '"] input[type=range]').getBoundingClientRect();
  return r.top >= body.bottom || r.bottom <= body.top;
}, target);
ok('the written member is scrolled out of the nest\'s view', away, target);

const busy = nest.locator('.nest-busy');
const shown = await busy.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
const text = shown ? (await busy.textContent()).trim() : '';
ok('the nest frame shows the in-flight count', shown && /^1 in flight$/.test(text), text);
ok('the count sits outside the scroll region', shown && await busy.evaluate((el) => !el.closest('.nest-body')));

await release();
const cleared = await busy.waitFor({ state: 'detached', timeout: 3000 }).then(() => true).catch(() => false);
ok('the count clears on echo', cleared);

// ---- edit flow: new nest, add, save, insert, out, ungroup --------------------
const topIds = () => page.$$eval('.dash-grid[data-view] > .dash-cell', (els) => els.map((e) => e.getAttribute('data-id')));
const membersOf = (id) => page.$$eval('.dash-cell[data-id="' + id + '"] .nest-body .dash-cell', (els) => els.map((e) => e.getAttribute('data-id')));
const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
await page.click('button:has-text("Edit layout")');
await nest.locator('button:has-text("Ungroup")').click();
await page.waitForTimeout(150);
ok('ungroup returns every card to the top level', (await topIds()).sort().join() === [...cards].sort().join(), await topIds());
await page.click('button:has-text("New nest")');
await page.waitForTimeout(150);
const fresh = (await topIds()).find((id) => id.startsWith('nest:'));
ok('New nest places an empty nest', !!fresh && (await membersOf(fresh)).length === 0, fresh);
const nest2 = page.locator('.dash-cell[data-id="' + fresh + '"]');
await nest2.locator('select').first().selectOption(cards[0]);
await nest2.locator('select').first().selectOption(cards[1]);
await page.waitForTimeout(150);
ok('Add moves a card into the nest and off the top level', (await membersOf(fresh)).join() === cards.slice(0, 2).join()
   && !(await topIds()).includes(cards[0]), await membersOf(fresh));
await nest2.locator('button:has-text("Save module")').click();
await page.waitForTimeout(100);
ok('Save module stores the nest by its members\' ids', JSON.stringify(Object.keys((await stored()).modules.Nest.members)) === JSON.stringify(cards.slice(0, 2)));
await nest2.locator('.nest-body .dash-cell[data-id="' + cards[0] + '"] button:has-text("Out")').click();
await page.waitForTimeout(150);
ok('Out returns a member to the top level', (await membersOf(fresh)).join() === cards[1] && (await topIds()).includes(cards[0]));
await nest2.locator('select').first().selectOption(cards[0]);
await page.waitForTimeout(150);
ok('a member moved out can be added back (a $state delete is not a ghost)', (await membersOf(fresh)).includes(cards[0]));
await nest2.locator('.nest-body .dash-cell[data-id="' + cards[0] + '"] button:has-text("Out")').click();
await page.waitForTimeout(150);
await page.locator('select[aria-label="Module"]').selectOption('Nest');
await page.click('button:has-text("Insert")');
await page.waitForTimeout(150);
const nests = (await topIds()).filter((id) => id.startsWith('nest:'));
const placedMod = nests.find((id) => id !== fresh);
ok('Insert places the module as a new nest with its members', nests.length === 2 && (await membersOf(placedMod)).join() === cards.slice(0, 2).join(), nests);
await page.click('button:has-text("Done")');
ok('no page errors', pageErrors.length === 0, pageErrors);

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- a scrolling nest shows what it holds in flight.'));
process.exit(fails ? 1 : 0);
