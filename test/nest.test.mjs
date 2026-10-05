/**
 * nest.test.mjs -- ph-e82.6, ph-e82.22: a nest is a fixed subgrid that grows
 * to fit its members, never a scroll region, and its frame still carries the
 * in-flight count (RENDERING §9 placement invariant, law 9; DESIGN §10.6).
 *
 * The built app on a fake hub (Playwright's WebSocket route; the recorded
 * valencesim catalog pre-seeded in the etag cache). A category page's cards
 * are put into one short nest through the stored layout, with the scroll flag
 * an older build wrote (inert now). Every member must be inside the nest's
 * visible surface with nothing to scroll; a write is made on the last member
 * while the hub holds its echo and the frame shows the in-flight count until
 * the echo clears it. The member's own card head carries the same count after
 * its title, and its appearing moves nothing (ph-vdk.60.7).
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

// A category page with at least two group cards, one of them holding a writable range.
// A section header row (DESIGN §10.11) is not a card: it never joins a nest.
const notSection = (id) => !id.startsWith('section:');
const tabs = page.locator('nav.rail [role=tab]');
let tab = -1, viewKey = '', cards = [];
for (let i = 1; i < await tabs.count() && tab < 0; i++) {
  await tabs.nth(i).click();
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const g = document.querySelector('.dash-grid[data-view]');
    if (!g) return null;
    const ids = [...g.children].map((c) => c.getAttribute('data-id')).filter((id) => !id.startsWith('section:'));
    return { key: g.getAttribute('data-view'), ids, range: !!g.querySelector('input[type=range]:not([disabled])') };
  });
  if (r && r.range && r.ids.filter((id) => id.startsWith('group:')).length >= 2) { tab = i; viewKey = r.key; cards = r.ids; }
}
ok('found a category page with two or more group cards and a writable range', tab > 0, viewKey + ' ' + cards.length);
if (tab < 0) { await browser.close(); srv.close(); process.exit(1); }

// Every card into one short nest, through the stored layout; scroll and
// collapsed are what an older build wrote, inert now.
const store = { active: 'Default', modules: {}, layouts: { Default: { [viewKey]: {
  'nest:1': { x: 0, y: 0, w: 20, h: 5, nest: { title: 'Test nest', scroll: true, collapsed: true, map: Object.fromEntries(cards.map((id) => [id, null])) } },
} } } };
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE_KEY, JSON.stringify(store)]);
await page.reload();
await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
await tabs.nth(tab).click();
await page.waitForTimeout(400);

const nest = page.locator('.dash-cell[data-id="nest:1"]');
const geo = await nest.evaluate((cell) => {
  const body = cell.querySelector('.nest-body');
  const surface = cell.querySelector(':scope > .dash-item > .dash-body').getBoundingClientRect();
  const top = [...cell.closest('.dash-grid').children].map((c) => c.getAttribute('data-id')).filter((id) => !id.startsWith('section:'));
  const scrollers = [...cell.querySelectorAll('*')].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY)
    && el.scrollHeight > el.clientHeight + 1).length;
  // A member's card, not its cell: the cell's gutter reaches over the frame's padding (ph-nnl).
  const outside = [...body.querySelectorAll('.dash-cell')].filter((m) => {
    const r = m.firstElementChild.getBoundingClientRect();
    return r.top < surface.top - 1 || r.bottom > surface.bottom + 1 || r.left < surface.left - 1 || r.right > surface.right + 1;
  }).map((m) => m.getAttribute('data-id'));
  return { scrollers, outside, sh: body.scrollHeight, ch: body.clientHeight, members: body.querySelectorAll('.dash-cell').length, top,
    tall: surface.height };
});
ok('the nest renders every card inside it, unfolded', geo.members === cards.length && geo.top.join() === 'nest:1', geo);
ok('nothing in the nest scrolls on its own', geo.scrollers === 0 && geo.sh <= geo.ch + 1, geo);
ok('the nest grows to fit: every member is inside its surface', geo.outside.length === 0 && geo.tall > 5 * 30, geo);
ok('the nest offers no scroll or fold switch', await nest.locator('.nest-fold, button:has-text("Scrolling"), button:has-text("Fixed")').count() === 0);

// ph-mdqo.10: a nest renames in place outside edit mode, by double-click or F2.
const nestTitle = nest.locator(':scope > .dash-item > .dash-head .dash-title');
const nestName = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).layouts.Default, STORE_KEY).then((l) => Object.values(l).flatMap((m) => Object.values(m)).find((e) => e && e.nest)?.nest.title);
await nestTitle.dblclick();
const rn = nest.locator(':scope > .dash-item > .dash-head input.dash-title-edit');
ok('double-click opens the name input outside edit mode, focused', await rn.count() === 1 && await rn.evaluate((el) => document.activeElement === el));
await rn.fill('Escaped'); await rn.press('Escape');
ok('Escape reverts and leaves no input', await rn.count() === 0 && (await nestTitle.textContent()).trim() === 'Test nest');
await nestTitle.focus(); await page.keyboard.press('F2');
ok('F2 on the focused title opens it too', await rn.count() === 1);
await rn.fill('Renamed'); await rn.press('Enter');
ok('Enter keeps the new name', await rn.count() === 0 && (await nestTitle.textContent()).trim() === 'Renamed', await nestName());

// F2 on the grip in edit mode focuses the name input (ph-mdqo.10).
await page.click('button:has-text("Edit layout")');
await nest.locator(':scope > .dash-item > .dash-head .handle.grab').focus();
await page.keyboard.press('F2');
ok('edit mode: F2 on the grip focuses the name input', await rn.evaluate((el) => document.activeElement === el));
await page.click('button:has-text("Done")');

// The last member with a writable range: write it while the hub holds the echo.
const target = await nest.evaluate((cell) => {
  const withRange = [...cell.querySelectorAll('.nest-body .dash-cell')].filter((c) => c.querySelector('input[type=range]:not([disabled])'));
  return withRange[withRange.length - 1].getAttribute('data-id');
});
const member = nest.locator('.nest-body .dash-cell[data-id="' + target + '"]');
const range = member.locator('input[type=range]').first();
// ph-vdk.60.7: the member's own head counts it too, after its title, and moves nothing.
const headGeo = () => member.evaluate((c) => ({ card: c.getBoundingClientRect().toJSON(),
  body: c.querySelector('.dash-body').getBoundingClientRect().toJSON(),
  head: [...c.querySelectorAll('.dash-head > :not(.dash-name)')].map((e) => e.getBoundingClientRect().toJSON()),
  titleTop: c.querySelector('.dash-title').getBoundingClientRect().top, titleH: c.querySelector('.dash-title').getBoundingClientRect().height }));
const geo0 = await headGeo(), store0 = await page.evaluate((k) => localStorage.getItem(k), STORE_KEY);
ok('idle: no count in the card head', await member.locator('.dash-busy').count() === 0);
hub.mode = 'hold';
await range.evaluate((el) => {
  const step = Number(el.step) || 1, v = Number(el.value);
  el.value = String(v + step <= Number(el.max) ? v + step : v - step);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(100);

const busy = nest.locator('.nest-busy');
const shown = await busy.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
const text = shown ? (await busy.textContent()).trim() : '';
ok('the nest frame shows the in-flight count', shown && /^1 in flight$/.test(text), text);
ok('the count sits in the frame, outside the subgrid', shown && await busy.evaluate((el) => !el.closest('.nest-body')));
const own = member.locator('.dash-head .dash-busy');
ok('the card head shows its own count after the title', await own.count() === 1 && (await own.textContent()).trim() === '1 in flight'
   && await own.evaluate((el) => el.previousElementSibling?.classList.contains('dash-title')));
await page.waitForTimeout(150);
const geo1 = await headGeo();
ok('the count moves nothing: card, body, head controls, title', JSON.stringify(geo1) === JSON.stringify(geo0), [geo0, geo1]);
ok('the count raises no floor: the stored layout holds', await page.evaluate((k) => localStorage.getItem(k), STORE_KEY) === store0);

await release();
const cleared = await busy.waitFor({ state: 'detached', timeout: 3000 }).then(() => true).catch(() => false);
ok('the count clears on echo', cleared && await own.count() === 0);

// ph-sbu: an overdue write still counts, in amber, words only; a faulted one never counts.
hub.mode = 'hold';
await range.evaluate((el) => {
  const step = Number(el.step) || 1, v = Number(el.value);
  el.value = String(v + step <= Number(el.max) ? v + step : v - step);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(700);
const warn = await page.evaluate(() => {
  const p = document.body.appendChild(document.createElement('i'));
  p.style.color = 'var(--warn)';
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
});
const tone = (loc) => loc.evaluate((el, w) => ({ text: el.textContent.trim(), amber: el.classList.contains('overdue') && getComputedStyle(el).color === w,
  ring: getComputedStyle(el).boxShadow !== 'none' || getComputedStyle(el).borderTopStyle !== 'none' }), warn);
const odNest = await tone(busy), odOwn = await tone(own);
ok('overdue: the frame and the head still count it, in amber, no ring box', odNest.text === '1 in flight' && odNest.amber && !odNest.ring
   && odOwn.text === '1 in flight' && odOwn.amber && !odOwn.ring, [odNest, odOwn]);
await page.waitForTimeout(1800);
const faulted = await range.evaluate((el) => el.closest('[data-shadow]')?.dataset.shadow);
ok('a faulted write is not in flight: no count on the frame or the head', faulted === 'fault' && await busy.count() === 0 && await own.count() === 0,
   [faulted, await busy.count(), await own.count()]);
hub.mode = 'echo';
hub.held.splice(0);

// ---- edit flow: new nest, add, save, insert, out, ungroup --------------------
const topIds = () => page.$$eval('.dash-grid[data-view] > .dash-cell', (els) => els.map((e) => e.getAttribute('data-id')))
  .then((ids) => ids.filter(notSection));
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
await nest2.locator('.nest-body .dash-cell[data-id="' + cards[0] + '"] button.out').click();
await page.waitForTimeout(150);
ok('Out returns a member to the top level', (await membersOf(fresh)).join() === cards[1] && (await topIds()).includes(cards[0]));
await nest2.locator('select').first().selectOption(cards[0]);
await page.waitForTimeout(150);
ok('a member moved out can be added back (a $state delete is not a ghost)', (await membersOf(fresh)).includes(cards[0]));
await nest2.locator('.nest-body .dash-cell[data-id="' + cards[0] + '"] button.out').click();
await page.waitForTimeout(150);
await page.click('button:has-text("Layout…")');
await page.locator('select[aria-label="Module"]').selectOption('Nest');
await page.click('button:has-text("Insert")');
await page.waitForTimeout(150);
const nests = (await topIds()).filter((id) => id.startsWith('nest:'));
const placedMod = nests.find((id) => id !== fresh);
ok('Insert places the module as a new nest with its members', nests.length === 2 && (await membersOf(placedMod)).join() === cards.slice(0, 2).join(), nests);
await page.click('button:has-text("Done")');

// ph-e82.10: a view whose map does not exist yet still draws its first nest.
let bare = -1, bareKey = '';
for (let i = 1; i < await tabs.count() && bare < 0; i++) {
  if (i === tab) continue;
  await tabs.nth(i).click();
  await page.waitForTimeout(200);
  const k = await page.evaluate(() => document.querySelector('.dash-grid[data-view]')?.getAttribute('data-view'));
  if (k && !Object.prototype.hasOwnProperty.call((await stored()).layouts.Default, k)) { bare = i; bareKey = k; }
}
ok('found a category page with no stored map', bare > 0, bareKey);
await page.click('button:has-text("Edit layout")');
await page.click('button:has-text("New nest")');
await page.waitForTimeout(150);
ok('New nest on a view with no map draws at once (ph-e82.10)', (await topIds()).some((id) => id.startsWith('nest:')), await topIds());
await page.click('button:has-text("Done")');
ok('no page errors', pageErrors.length === 0, pageErrors);

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- a nest shows every member and what it holds in flight.'));
process.exit(fails ? 1 : 0);
