/**
 * home.test.mjs -- ph-e82.5: the home page replaces Overview (DESIGN §10.1).
 *
 * Renders the built app (dist/index.html) against a fake hub: Playwright's
 * WebSocket route answers HELLO, SUBSCRIBE and PING, pushes STATE from the
 * recorded valencesim catalog's layouts, and answers each INTENT with an echo,
 * or holds it (hub.mode 'hold') until the test releases it. Asserts:
 *   tabs       no Overview tab; the first machine tab is Home
 *   seed       a home the user never built shows what Overview showed
 *   reach      every field, action and hero card in test/fixtures/
 *              overview-before.json (captured from Overview before the
 *              change) is reachable from the derived category pages alone,
 *              drill-ins included; Telemetry is a home module
 *   palette    lists every fixture-catalog field exactly once plus every
 *              claimed composite and the safety ops; full class only
 *   handles    edit mode toggles the drag handles; outside it none exist
 *   inflight   a held write stays pending, on the same element, across
 *              entering and leaving edit mode, then confirms
 *   build      deleting every module leaves an empty home (never reseeded)
 *              and the strip e-stop; a home built from the palette survives
 *              a reload
 *
 * Live mode (--live): the build-and-reload check against a running valencesim
 * (catalog fetched, not seeded). Skips (exit 0) when no sim answers.
 *
 * Build first (`npm run build:only`). Run: node test/home.test.mjs
 *      node test/home.test.mjs --live [--port 8882] [--http 8880]
 *        (valencesim --homed --headless --port 8882 --http 8880)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS } from '../../Valence/clients/js/frames.js';
import { buildSettingsModel, placeableControls, WIDGET } from '../src/model/settings.js';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const LIVE = args.includes('--live');
const SIM_PORT = parseInt(argOf('--port', '8882'), 10);
const SIM_HTTP = parseInt(argOf('--http', '8880'), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/overview-before.json', import.meta.url), 'utf8'));
const ENTRIES = decodeCatalog(CAT);
const MODEL = buildSettingsModel(ENTRIES);
const FIELD_KEYS = placeableControls(MODEL).map((c) => c.key);
// A key names a field by role or by uid (settings.js controlKey); compare fields, not spellings.
const keyUid = (k) => k.split('+').map((p) => (p.startsWith('role:') ? (MODEL.byRole.get(p.slice(5)) || [{}])[0].uid
  : p.startsWith('uid:') ? p.slice(4) : p)).join('+');
const FIELD_UIDS = FIELD_KEYS.map(keyUid);

if (LIVE) {
  const up = await new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket('ws://127.0.0.1:' + SIM_PORT + '/'); } catch (e) { resolve(false); return; }
    const t = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } resolve(false); }, 2000);
    ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
  if (!up) { console.log('SKIP: no valencesim answering on 127.0.0.1:' + SIM_PORT); process.exit(0); }
}

// ---- HTTP: the bundle, plus /uitoken (minted here, or proxied to the sim) --
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    if (!LIVE) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
    fetch('http://127.0.0.1:' + SIM_HTTP + '/uitoken').then(async (r) => {
      s.writeHead(r.status, { 'Content-Type': 'application/json' }); s.end(await r.text());
    }).catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- the fake hub -----------------------------------------------------------
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
            [IDENTITY_K.hub_name, cbTstr('Home fixture')]])],
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
        if (hub.mode === 'hold') hub.held.push(answer);
        else answer();
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}
async function release() {
  for (let i = 0; i < 100 && !hub.held.length; i++) await sleep(10);
  hub.mode = 'echo';
  for (const a of hub.held.splice(0)) a();
}

// ---- the page ---------------------------------------------------------------
const browser = await chromium.launch();
// The catalog is seeded once per context: a reload must keep the saved home.
async function open(w, h, store = null) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([etag, hex, live, store]) => {
    try {
      if (sessionStorage.getItem('home.seeded')) return;
      localStorage.clear();
      if (!live) localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: hex }));
      if (store) localStorage.setItem('phosphor.layouts', store);
      sessionStorage.setItem('home.seeded', '1');
    } catch (e) { /* no storage: the boot assertion reports it */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), LIVE, store && JSON.stringify(store)]);
  if (!LIVE) await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok('no page error', false, String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/' + (LIVE ? '?hub=127.0.0.1:' + SIM_PORT : ''));
  const up = await boot(page, w);
  return { ctx, page, up };
}
async function boot(page, w) {
  const sel = w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]';
  const up = await page.waitForSelector(sel, { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  return up;
}
const topIds = (page) => page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell', (els) => els.map((e) => e.dataset.id));
const topTitles = (page) => page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell .dash-title',
  (els) => els.filter((e) => !e.closest('.nest-body')).map((e) => e.textContent.trim()));
const editBtn = (page) => page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' });
const doneBtn = (page) => page.locator('.home .dash-toolbar .done-btn');

/** Everything a derived category page shows: field uids, action labels, card titles. */
async function harvestDerived(page) {
  const seen = { uids: new Set(), actions: new Set(), titles: new Set() };
  const collect = async () => {
    const r = await page.evaluate(() => {
      const pane = document.querySelector('main.pane');
      return {
        uids: [...pane.querySelectorAll('label.field-label[for]')].map((l) => l.getAttribute('for')),
        actions: [...pane.querySelectorAll('.field.action .field-label')].map((l) => l.textContent.trim()),
        titles: [...pane.querySelectorAll('.dash-title')].map((t) => t.textContent.trim()),
      };
    });
    r.uids.forEach((u) => seen.uids.add(u));
    r.actions.forEach((a) => seen.actions.add(a));
    r.titles.forEach((t) => seen.titles.add(t));
  };
  const cats = await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => [...new Set(els.map((e) => e.dataset.tabId))]);
  for (const id of cats) {
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(150);
    for (const b of await page.locator('main.pane .adv-toggle', { hasText: /^\s*Show/ }).all()) await b.click();
    await page.waitForTimeout(100);
    await collect();
    const drills = await page.locator('main.pane .drill-open').count();
    for (let j = 0; j < drills; j++) {
      await page.locator('main.pane .drill-open').nth(j).click();
      await page.waitForTimeout(100);
      await collect();
      await page.click('main.pane .drill-back');
      await page.waitForTimeout(100);
    }
  }
  return seen;
}

function checkReach(tag, before, seen) {
  for (const card of before) {
    if (card.title === 'Telemetry') continue;   // a scope over role-bound fields, a home module only
    const lostUids = card.uids.filter((u) => !seen.uids.has(u));
    const lostActions = card.actions.filter((a) => !seen.actions.has(a));
    ok(tag + ': ' + card.title + ' fields reachable from the category pages', !lostUids.length && !lostActions.length,
      [...lostUids, ...lostActions]);
  }
  for (const t of ['Pattern', 'Limits']) ok(tag + ': the ' + t + ' card is on a category page', seen.titles.has(t));
}

if (!LIVE) {
  // ---- full class ------------------------------------------------------------
  console.log('\n[full 1280x900]');
  const { ctx, page, up } = await open(1280, 900);
  ok('catalog adopted', up);

  const labels = await page.$$eval('nav.rail [role=tab]', (els) => els.map((e) => e.getAttribute('title')));
  ok('no Overview tab', !labels.includes('Overview'), labels);
  ok('the first machine tab is Home', labels[0] === 'Home', labels[0]);

  ok('an unbuilt home shows what Overview showed', JSON.stringify(await topTitles(page)) === JSON.stringify(BEFORE.full.map((c) => c.title)),
    await topTitles(page));
  ok('outside edit mode nothing drags', await page.locator('.home .handle').count() === 0);
  ok('no palette outside edit mode', await page.locator('.palette').count() === 0);

  // inflight: a held write survives entering and leaving edit mode
  const slider = page.locator('.home .dash-cell[data-id="widget:hero-rank"] .field[data-widget=slider]').first();
  const field = await slider.elementHandle();
  hub.mode = 'hold';
  await slider.locator('input[type=range]').evaluate((el) => {
    const step = Number(el.step) || 1;
    el.value = String(Number(el.value) + step * 3 <= Number(el.max) ? Number(el.value) + step * 3 : Number(el.value) - step * 3);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const busy = () => field.evaluate((el) => el.isConnected && /pending|overdue/.test(el.dataset.shadow));
  await page.waitForTimeout(150);
  ok('inflight: the write is pending', await busy());
  await editBtn(page).click();
  await page.waitForTimeout(150);
  ok('inflight: still pending, same element, in edit mode', await busy());
  ok('handles: edit mode shows one grab handle per module',
    await page.locator('.home .handle.grab').count() === (await topIds(page)).length, await page.locator('.home .handle.grab').count());
  await doneBtn(page).click();
  await page.waitForTimeout(150);
  ok('inflight: still pending, same element, after leaving edit mode', await busy());
  ok('handles: leaving edit mode removes them', await page.locator('.home .handle').count() === 0);
  await release();
  const t0 = Date.now();
  let confirmed = false;
  while (!confirmed && Date.now() - t0 < 3000) { confirmed = await field.evaluate((el) => el.dataset.shadow === 'confirmed'); await sleep(30); }
  ok('inflight: the echo confirms it', confirmed);

  // palette
  await editBtn(page).click();
  await page.waitForTimeout(150);
  const keys = await page.$$eval('.palette li[data-key]', (els) => els.map((e) => e.dataset.key));
  const count = (k) => keys.filter((x) => x === k).length;
  const uids = keys.map(keyUid);
  const badFields = FIELD_UIDS.filter((u) => uids.filter((x) => x === u).length !== 1);
  ok('palette: every fixture-catalog field exactly once (' + FIELD_UIDS.length + ')', !badFields.length, badFields);
  ok('palette: no key listed twice', new Set(keys).size === keys.length);
  for (const k of ['hero:rail', 'hero:pattern', 'hero:limits']) ok('palette: claimed composite ' + k, count(k) === 1);
  ok('palette: the safety ops are modules', keys.some((k) => k.startsWith('safety:')), keys.filter((k) => k.startsWith('safety:')));
  ok('palette: Overview\'s summaries are modules', ['widget:hero-rank', 'widget:telemetry', 'widget:actions'].every((k) => count(k) === 1));

  // build: delete everything, then place from the palette
  for (let i = 0; i < 20 && await page.locator('.home .home-remove').count(); i++) {
    await page.locator('.home .home-remove').first().click();
    await page.waitForTimeout(80);
  }
  ok('build: every module deleted', (await topIds(page)).length === 0, await topIds(page));
  const estop = await page.locator('.topstrip .btn-estop').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return !el.disabled && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
  });
  ok('build: the strip e-stop survives', estop);
  const sliderUid = MODEL.fields.find((f) => f.widget === WIDGET.slider && !f.readOnly && FIELD_UIDS.includes(f.uid)).uid;
  const fieldKey = keys.find((k) => keyUid(k) === sliderUid);
  const safetyKey = keys.find((k) => k.startsWith('safety:'));
  const want = ['hero:pattern', fieldKey, safetyKey, 'widget:telemetry'];
  for (const k of want) await page.$eval('.palette li[data-key="' + k + '"] button', (b) => b.click());
  await page.waitForTimeout(200);
  ok('build: placed from the palette', JSON.stringify((await topIds(page)).sort()) === JSON.stringify([...want].sort()), await topIds(page));
  ok('build: placed entries offer Remove', await page.$eval('.palette li[data-key="hero:pattern"] button', (b) => b.textContent.trim()) === 'Remove');
  // into a nest: the palette's target, then nestAdd
  await page.locator('.home .dash-toolbar button', { hasText: 'New nest' }).click();
  await page.waitForTimeout(150);
  const nestId = (await topIds(page)).find((id) => id.startsWith('nest:'));
  const nested = keys.find((k) => k.startsWith('uid:') && !want.includes(k));
  await page.selectOption('.palette select[aria-label="Place into"]', nestId);
  await page.$eval('.palette li[data-key="' + nested + '"] button', (b) => b.click());
  await page.waitForTimeout(200);
  const inNest = () => page.$$eval('.home .dash-cell[data-id="' + nestId + '"] .nest-body .dash-cell', (els) => els.map((e) => e.dataset.id));
  ok('build: the palette places into a chosen nest', JSON.stringify(await inNest()) === JSON.stringify([nested]), await inNest());
  ok('build: a nested control is not also at the top level', !(await topIds(page)).includes(nested));
  await doneBtn(page).click();
  await page.reload();
  await boot(page, 1280);
  ok('build: the home survives a reload', JSON.stringify((await topIds(page)).sort()) === JSON.stringify([...want, nestId].sort()), await topIds(page));
  ok('build: the nest keeps its member across the reload', JSON.stringify(await inNest()) === JSON.stringify([nested]), await inNest());

  // an emptied home stays empty across a reload (never reseeded)
  await editBtn(page).click();
  await page.locator('.home .dash-cell[data-id="' + nestId + '"] button', { hasText: 'Ungroup' }).click();
  for (let i = 0; i < 10 && await page.locator('.home .home-remove').count(); i++) await page.locator('.home .home-remove').first().click();
  await page.reload();
  await boot(page, 1280);
  ok('build: an emptied home is not reseeded', (await topIds(page)).length === 0, await topIds(page));

  checkReach('full', BEFORE.full, await harvestDerived(page));
  await ctx.close();

  // ---- a home saved before ph-e82.9 keyed a role field by uid ------------------
  console.log('\n[full 1280x900, pre-ph-e82.9 home]');
  const roled = placeableControls(MODEL).find((c) => c.alias && !c.key.includes('+'));
  const old = await open(1280, 900, { active: 'Default', modules: {},
    layouts: { Default: { 'full.machine': { [roled.alias]: { x: 0, y: 0, w: 12, h: 2 }, 'home:built': { x: 0, y: 9, w: 1, h: 1 } } } } });
  ok('alias: the uid-form key still draws its control', JSON.stringify(await topIds(old.page)) === JSON.stringify([roled.alias]),
    await topIds(old.page));
  await editBtn(old.page).click();
  await old.page.waitForTimeout(150);
  ok('alias: the palette shows the role key as placed', await old.page.$eval('.palette li[data-key="' + roled.key + '"] button',
    (b) => b.textContent.trim()) === 'Remove');
  await old.page.$eval('.palette li[data-key="' + roled.key + '"] button', (b) => b.click());
  await old.page.waitForTimeout(150);
  ok('alias: Remove by the role key drops the uid-form entry', (await topIds(old.page)).length === 0, await topIds(old.page));
  await old.ctx.close();

  // ---- handheld ---------------------------------------------------------------
  console.log('\n[handheld 390x844]');
  const hh = await open(390, 844);
  ok('catalog adopted', hh.up);
  const hl = await hh.page.$$eval('nav.tabs [role=tab]', (els) => els.map((e) => e.textContent.trim()));
  ok('no Overview tab', !hl.includes('Overview') && hl[0] === 'Home', hl);
  ok('the home is today\'s auto-built page', JSON.stringify(await topTitles(hh.page)) === JSON.stringify(BEFORE.handheld.map((c) => c.title)),
    await topTitles(hh.page));
  await editBtn(hh.page).click();
  ok('no palette outside the full class (ph-e82.7)', await hh.page.locator('.palette').count() === 0);
  await doneBtn(hh.page).click();
  checkReach('handheld', BEFORE.handheld, await harvestDerived(hh.page));
  await hh.ctx.close();
} else {
  // ---- live: build a home from the palette, reload, it restores ---------------
  console.log('\n[live valencesim 127.0.0.1:' + SIM_PORT + ']');
  const { ctx, page, up } = await open(1280, 900);
  ok('catalog adopted from the sim', up);
  await editBtn(page).click();
  await page.waitForTimeout(150);
  for (let i = 0; i < 20 && await page.locator('.home .home-remove').count(); i++) await page.locator('.home .home-remove').first().click();
  const keys = await page.$$eval('.palette li[data-key]', (els) => els.map((e) => e.dataset.key));
  const want = [keys.find((k) => k.startsWith('hero:')), keys.find((k) => k.startsWith('safety:')),
    keys.find((k) => k.startsWith('role:') || k.startsWith('uid:'))].filter(Boolean);
  ok('live: the palette offers a composite, a safety op and a field', want.length === 3, want);
  for (const k of want) await page.$eval('.palette li[data-key="' + k + '"] button', (b) => b.click());
  await doneBtn(page).click();
  await page.reload();
  await boot(page, 1280);
  ok('live: the home restores after a reload', JSON.stringify((await topIds(page)).sort()) === JSON.stringify([...want].sort()), await topIds(page));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
