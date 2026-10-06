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
 *   drag       a palette entry dragged onto the grid lands at the drop
 *              column, onto a nest joins it; a look chip adds that look;
 *              Ctrl+Z undoes the last change, one level (ph-e82.15)
 *   surfaces   on the home (reading and edit mode, palette open) and every
 *              category page, every painted box is --bg-card or --bg-sunken,
 *              and none sits directly in a box of its own token; nothing in
 *              the pane scrolls on its own (ph-e82.22)
 *   sections   a " / " group is a card under its section's one header row:
 *              Motion's Tuning holds the eleven former Tuning cards, System's
 *              Library its presets card; the header paints no tint, and the
 *              advanced toggle moves neither it nor anything above it, and
 *              toggling twice lands every card where it began
 *              (DESIGN §10.11)
 *
 * Live mode (--live): the build-and-reload check against a running valencesim
 * (catalog fetched, not seeded). Skips (exit 0) when no sim answers.
 *
 * Build first (`npm run build:only`). Run: node test/home.test.mjs
 *      node test/home.test.mjs --live [--port 8882] [--http 8880]
 *        (valencesim --homed --headless --port 8882 --http 8880)
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS } from '../../Valence/clients/js/frames.js';
import { catalogEtag, toHex } from '../../Valence/clients/js/sha256.js';
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

const HTML = readFileSync(DIST_HTML);
const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = toHex(catalogEtag(CAT, LIMITS.etag_bytes));
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
/**
 * Surface rule (ph-e82.22): every painted box in the pane is a card or a
 * sunken surface, never inside a painted box of its own token, and no element
 * in the pane is its own scroll region. Controls and their parts are not
 * boxes (buttons, inputs, switches, bars and chips under 48 x 32 px).
 */
const surfaceFaults = (page) => page.evaluate(() => {
  const pane = document.querySelector('main.pane');
  const probe = document.body.appendChild(document.createElement('div'));
  const rgb = (v) => { probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
  const CARD = rgb('var(--bg-card)'), SUNK = rgb('var(--bg-sunken)');
  probe.remove();
  const CONTROL = 'button, input, select, textarea, label, svg, canvas, .og-switch';
  const painted = (el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) && cs.visibility !== 'hidden' && r.width >= 48 && r.height >= 32;
  };
  const name = (el) => el.tagName.toLowerCase() + [...el.classList].filter((c) => !c.startsWith('svelte-')).map((c) => '.' + c).join('');
  const out = [];
  for (const el of pane.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) out.push(name(el) + ' scrolls');
    // The page footer is chrome, not a page surface.
    if (el.closest(CONTROL) || el.closest('.page-foot') || !painted(el)) continue;
    const c = cs.backgroundColor;
    if (c !== CARD && c !== SUNK) { out.push(name(el) + ' paints ' + c); continue; }
    let up = el.parentElement;
    while (up && up !== pane && !painted(up)) up = up.parentElement;
    if (up && up !== pane && getComputedStyle(up).backgroundColor === c) out.push(name(el) + ' in ' + name(up) + ', both ' + (c === CARD ? 'card' : 'sunken'));
  }
  return [...new Set(out)];
});
// The sidebar wrench drives edit mode (dashEdit); the dash has no pane head.
const editBtn = (page) => page.locator('button[title="Edit layout"]:visible').first();
const doneBtn = (page) => page.locator('button[title="Done editing"]:visible').first();

/** Everything a derived category page shows: field uids, action labels, card titles. */
async function harvestDerived(page) {
  const seen = { uids: new Set(), actions: new Set(), titles: new Set() };
  const collect = async () => {
    const r = await page.evaluate(() => {
      const pane = document.querySelector('main.pane');
      return {
        uids: [...pane.querySelectorAll('label.field-label[data-uid]')].map((l) => l.dataset.uid),
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
    // Each click shrinks the match set, so click the first until none is left.
    const shut = page.locator(OPS).locator('button[title="Show advanced"], button[title="Show diagnostic"]');
    for (let i = 0; i < 40 && await shut.count(); i++) await shut.first().click();
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

// A page's operations live in the selected page's rail pill; a narrow shell keeps them in the page foot.
const OPS = 'main.pane .page-foot, nav.rail .rail-ops';
if (!LIVE) {
  // ---- full class ------------------------------------------------------------
  console.log('\n[full 1280x900]');
  const { ctx, page, up } = await open(1280, 900);
  ok('catalog adopted', up);

  const labels = await page.$$eval('nav.rail [role=tab]', (els) => els.map((e) => e.getAttribute('title')));
  ok('no Overview tab', !labels.includes('Overview'), labels);
  ok('the first machine tab is Dash', labels[0] === 'Dash', labels[0]);

  ok('an unbuilt home shows what Overview showed', JSON.stringify(await topTitles(page)) === JSON.stringify(BEFORE.full.map((c) => c.title)),
    await topTitles(page));
  ok('outside edit mode nothing drags', await page.locator('.home .handle').count() === 0);
  ok('no palette outside edit mode', await page.locator('.palette').count() === 0);
  ok('surfaces: the home reads as cards and nests only', (await surfaceFaults(page)).length === 0, await surfaceFaults(page));
  // A card far taller than wide at its floor (the built-in advanced generator) takes the full row, leaving no hole beside it.
  const tallFill = await page.$$eval('main.pane .dash-grid[data-view] > .dash-cell', (els) => {
    const g = els[0].parentElement.getBoundingClientRect(), r = els.find((e) => e.dataset.id === 'hero:advanced-generator').getBoundingClientRect();
    return { w: Math.round(r.width), grid: Math.round(g.width) };
  });
  ok('a card taller than 6 times its floor width seeds at the full row', tallFill.grid - tallFill.w < 36 && tallFill.w <= tallFill.grid, tallFill);
  // The cell remainder splits evenly: the outermost cards sit as far from the left edge as from the right.
  for (const [w, h] of [[1428, 900], [1024, 768]]) {
    const cz = await open(w, h);
    await cz.page.waitForTimeout(600);
    const gap = await cz.page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell', (els) => {
      const g = els[0].parentElement.parentElement.getBoundingClientRect(), r = els.map((e) => e.getBoundingClientRect());
      return { left: Math.min(...r.map((q) => q.left)) - g.left, right: g.right - Math.max(...r.map((q) => q.right)) };
    });
    ok('centered: ' + w + ' wide, left and right gaps agree within 1 px', gap.left > 0 && Math.abs(gap.left - gap.right) <= 1, gap);
    await cz.ctx.close();
  }
  await editBtn(page).click();
  await page.$$eval('.palette details', (els) => els.forEach((d) => { d.open = true; }));
  await page.waitForTimeout(150);
  ok('surfaces: the home in edit mode, palette open, too', (await surfaceFaults(page)).length === 0, await surfaceFaults(page));
  await doneBtn(page).click();
  const catFaults = [];
  for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(150);
    // Each click shrinks the match set, so click the first until none is left.
    const shut = page.locator(OPS).locator('button[title="Show advanced"], button[title="Show diagnostic"]');
    for (let i = 0; i < 40 && await shut.count(); i++) await shut.first().click();
    await page.waitForTimeout(100);
    catFaults.push(...(await surfaceFaults(page)).map((f) => id + ': ' + f));
  }
  ok('surfaces: every category page reads as cards and nests only', catFaults.length === 0, catFaults);

  // sections (DESIGN §10.11; Valence RFC-096 draft): every toggle is open here.
  const sectionRuns = () => page.evaluate(() => {
    const cells = [...document.querySelectorAll('main.pane .dash-grid[data-view] > .dash-cell')];
    const runs = [];
    for (const c of cells) {
      const h = c.querySelector(':scope > .dash-section');
      if (h) runs.push({ head: h.textContent.trim(), cards: [] });
      else if (runs.length) runs.at(-1).cards.push(c.querySelector('.dash-title')?.textContent.trim());
    }
    return runs;
  });
  const cellGeo = () => page.$$eval('main.pane .dash-grid[data-view] > .dash-cell', (els) => Object.fromEntries(els.map((c) => {
    const r = c.getBoundingClientRect();
    return [c.dataset.id, [r.x, r.y, r.width, r.height].map(Math.round)];
  })));
  await page.click('nav.rail [role=tab][title="System"]');
  await page.waitForTimeout(150);
  ok('sections: System shows a Library section over its Pattern presets card',
     JSON.stringify(await sectionRuns()) === JSON.stringify([{ head: 'Library', cards: ['Pattern presets'] }]), await sectionRuns());
  await page.click('nav.rail [role=tab][title="Motion"]');
  await page.waitForTimeout(150);
  const TUNING = ['Motion behavior', 'Streaming', 'Sample streams', 'Curve', 'Infeasible moves', 'Settling',
    'Active plan', 'Planner', 'Anomalies', 'Plan time', 'Stream ingress'];
  ok('sections: Motion shows one Tuning section header with its eleven cards under it',
     JSON.stringify(await sectionRuns()) === JSON.stringify([{ head: 'Tuning', cards: TUNING }]), await sectionRuns());
  const headTint = await page.$eval('main.pane .dash-section', (h) => {
    const out = [];
    for (let el = h; el && !el.matches('main.pane'); el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) out.push(el.tagName.toLowerCase() + '.' + el.className + ' ' + c);
    }
    return out;
  });
  ok('sections: the header is text on the page, no tint under it (no third surface)', headTint.length === 0, headTint);
  await page.waitForTimeout(600);
  const geo0 = await cellGeo();
  const advBtn = page.locator(OPS).locator('button[title$=" advanced"]');
  await advBtn.click();
  await page.waitForTimeout(600);
  const geoHidden = await cellGeo();
  await advBtn.click();
  await page.waitForTimeout(600);
  const geoBack = await cellGeo();
  const headId = Object.keys(geo0).find((id) => id.startsWith('section:'));
  const still = Object.keys(geo0).filter((id) => geo0[id][1] <= geo0[headId][1]);
  ok('sections: the advanced toggle moves neither the header nor any card above it',
     still.length > 1 && still.every((id) => JSON.stringify(geoHidden[id]) === JSON.stringify(geo0[id])), still);
  // A page that does not come back the same after hide/show is a defect: the seed's inputs are canonical.
  ok('sections: hiding and showing the advanced cards lands every card where it began', JSON.stringify(geoBack) === JSON.stringify(geo0), [geo0, geoBack]);
  // The same holds across a resize: 1428 -> 1024 equals a fresh 1024 load.
  const geoOf = (pg) => pg.$$eval('main.pane .dash-grid[data-view] > .dash-cell', (els) => Object.fromEntries(els.map((c) => {
    const r = c.getBoundingClientRect();
    return [c.dataset.id, [r.x, r.y, r.width, r.height].map(Math.round)];
  })));
  await page.setViewportSize({ width: 1428, height: 900 });
  await page.waitForTimeout(900);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(1200);
  const resized = await geoOf(page);
  const fr = await open(1024, 768);
  await fr.page.click('nav.rail [role=tab][title="Motion"]');
  await fr.page.waitForTimeout(150);
  const shutFresh = fr.page.locator(OPS).locator('button[title="Show advanced"], button[title="Show diagnostic"]');
  for (let i = 0; i < 40 && await shutFresh.count(); i++) await shutFresh.first().click();
  await fr.page.waitForTimeout(1500);
  const fresh = await geoOf(fr.page);
  ok('sections: a 1428 -> 1024 resize lays out the same as a fresh 1024 load', JSON.stringify(resized) === JSON.stringify(fresh), [resized, fresh]);
  await fr.ctx.close();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(600);
  // A category page never edits and lays out from the seed; a placement saved for it is inert and survives untouched.
  ok('a category page has no toolbar, no grip and no edit entry', await page.locator('main.pane .dash-toolbar, main.pane .handle.grab').count() === 0);
  const inert = JSON.stringify({ active: 'Default', modules: {}, layouts: { Default: { 'full.cat2': { 'group:2:ungrouped': { x: 9, y: 9, w: 5, h: 5 } } } } });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), ['phosphor.layouts', inert]);
  await page.reload();
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  await page.click('nav.rail [role=tab][title="Motion"]');
  await page.waitForTimeout(1200);
  const seededAt = (await geoOf(page))['group:2:ungrouped'];
  ok('a saved category placement is ignored: the card sits where the seed puts it', !!seededAt && seededAt[1] < 600, seededAt);
  ok('and the store is left as it was', await page.evaluate((k) => localStorage.getItem(k), 'phosphor.layouts') === inert);
  await page.click('nav.rail [role=tab] >> nth=0');
  await page.waitForTimeout(150);

  // inflight: a held write survives entering and leaving edit mode
  const slider = page.locator('.home .dash-cell .field[data-widget=slider]').first();
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
  for (const k of ['hero:rail', 'hero:pattern', 'hero:limits', 'hero:advanced-generator']) ok('palette: claimed composite ' + k, count(k) === 1);
  ok('palette: the safety ops are modules', keys.some((k) => k.startsWith('safety:')), keys.filter((k) => k.startsWith('safety:')));
  ok('palette: Overview\'s summaries are modules', count('widget:telemetry') === 1);

  // build: delete everything, then place from the palette. The palette
  // overlays the grid's top right (ph-wia); Modules puts it away so the cards
  // under it are reached, and brings it back.
  const paletteToggle = page.locator('.home .dash-toolbar .palette-toggle');
  await paletteToggle.click();
  ok('palette: Modules puts it away', await page.locator('.palette').count() === 0 && await paletteToggle.getAttribute('aria-pressed') === 'false');
  for (let i = 0; i < 20 && await page.locator('.home .home-remove').count(); i++) {
    await page.locator('.home .home-remove').first().click();
    await page.waitForTimeout(80);
  }
  ok('build: every module deleted', (await topIds(page)).length === 0, await topIds(page));
  await paletteToggle.click();
  ok('palette: Modules brings it back', await page.locator('.palette').count() === 1);
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
  const tones = await page.$eval('.home .dash-cell[data-id="' + nestId + '"]', (c) => {
    const bg = (el) => el && getComputedStyle(el).backgroundColor;
    const probe = document.body.appendChild(document.createElement('div'));
    const rgb = (v) => { probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
    const want = { card: rgb('var(--bg-card)'), sunk: rgb('var(--bg-sunken)') };
    probe.remove();
    return { nest: bg(c.querySelector(':scope > .dash-item > .dash-body')) === want.sunk,
      member: bg(c.querySelector('.nest-body .dash-body')) === want.card };
  });
  ok('surfaces: a nest is one sunken surface holding cards', tones.nest && tones.member, tones);
  ok('surfaces: the home with a nest passes the rule', (await surfaceFaults(page)).length === 0, await surfaceFaults(page));
  await doneBtn(page).click();
  await page.reload();
  await boot(page, 1280);
  ok('build: the home survives a reload', JSON.stringify((await topIds(page)).sort()) === JSON.stringify([...want, nestId].sort()), await topIds(page));
  ok('build: the nest keeps its member across the reload', JSON.stringify(await inNest()) === JSON.stringify([nested]), await inNest());

  // look (DESIGN §10.2, RFC-080 draft items 3, 4 by operator ruling): a placement
  // narrows its range above the reported value and takes another presentation.
  await editBtn(page).click();
  await paletteToggle.click();
  await page.waitForTimeout(150);
  const cell = page.locator('.home .dash-cell[data-id="' + fieldKey + '"]');
  const fld = MODEL.fields.find((f) => f.uid === sliderUid);
  const cur = Number(await cell.locator('.field input[type=range]').inputValue());
  // The look is a popover opened from the card head's look tool (ph-wia).
  await cell.locator('.look-btn').click();
  const edge = cur < fld.max ? ['Min', (cur + fld.max) / 2] : ['Max', (fld.min + cur) / 2];
  await cell.locator('input[aria-label^="' + edge[0] + ' of"]').fill(String(edge[1]));
  await cell.locator('input[aria-label^="' + edge[0] + ' of"]').dispatchEvent('change');
  await cell.locator('select[aria-label^="Presentation of"]').selectOption('knob');
  await page.waitForTimeout(200);
  await doneBtn(page).click();
  await page.reload();
  await boot(page, 1280);
  const knob = cell.locator('.field[data-widget=knob]');
  ok('look: the chosen presentation survives a reload', await knob.count() === 1);
  ok('look: a reported value outside the narrowed range is marked, not pinned',
    await cell.locator('.out-of-range').count() === 1 && (await cell.locator('.knob-val').textContent()).includes(String(Math.round(cur))),
    await cell.locator('.knob-val').textContent());
  ok('look: the knob reads the narrowed bounds', Number(await knob.locator('.knob').getAttribute('aria-value' + edge[0].toLowerCase())) === edge[1]);

  // an emptied home stays empty across a reload (never reseeded)
  await editBtn(page).click();
  await paletteToggle.click();
  await page.locator('.home .dash-cell[data-id="' + nestId + '"] button', { hasText: 'Ungroup' }).click();
  for (let i = 0; i < 10 && await page.locator('.home .home-remove').count(); i++) await page.locator('.home .home-remove').first().click();
  await page.reload();
  await boot(page, 1280);
  ok('build: an emptied home is not reseeded', (await topIds(page)).length === 0, await topIds(page));

  checkReach('full', BEFORE.full, await harvestDerived(page));

  // bar (ph-jgq): a composite's claimed fields count in its page's bar, and a
  // card of fields the hub never reports is not drawn.
  for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => els.map((e) => e.dataset.tabId))) {
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(150);
    if (await page.locator('main.pane .dash-cell[data-id="hero:pattern"]').count()) break;
  }
  ok('bar: the Pattern page offers Reset', await page.locator('nav.rail .rail-ops .reset').count() === 1);
  ok('bar: no card of send-only fields', await page.locator('main.pane .dash-cell[data-id$=":ungrouped"]').count() === 0,
    await page.$$eval('main.pane .dash-cell', (els) => els.map((e) => e.dataset.id)));
  hub.mode = 'hold';
  await page.locator('main.pane .dash-cell[data-id="hero:pattern"] .field[data-widget=slider] input[type=range]').first().evaluate((el) => {
    const step = Number(el.step) || 1;
    el.value = String(Number(el.value) + step * 3 <= Number(el.max) ? Number(el.value) + step * 3 : Number(el.value) - step * 3);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const busyText = () => page.locator('main.pane .dash-cell[data-id="hero:pattern"] .dash-busy').first().textContent({ timeout: 1000 }).catch(() => '');
  ok('bar: a held write inside the Pattern card is counted in flight', (await busyText()).trim() === '1 in flight', await busyText());
  await release();
  await page.waitForFunction(() => !document.querySelector('main.pane .dash-cell[data-id="hero:pattern"] .dash-busy'), null, { timeout: 3000 }).catch(() => {});
  ok('bar: the echo clears the count', !(await busyText()).trim(), await busyText());

  // roster (ph-zri, ph-6a2): the hub's pattern in reality, intent only while a
  // pick is out; 11 px labels on equal tiles; the hint under the roster; the
  // shared switch for background run.
  const pat = page.locator('main.pane .dash-cell[data-id="hero:pattern"]');
  const tok = (name) => page.evaluate((n) => {
    const p = document.body.appendChild(document.createElement('span'));
    p.style.color = 'var(' + n + ')';
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, name);
  const onColor = () => pat.locator('.pat-tile.on .pat-tile-label').evaluate((el) => getComputedStyle(el).color);
  ok('roster: the current pattern reads in reality at rest (ph-zri)', await onColor() === await tok('--reality'), await onColor());
  hub.mode = 'hold';
  await pat.locator('.pat-tile:not(.on)').first().click();
  await page.waitForTimeout(250);
  ok('roster: the picked pattern reads in intent while its write is out', await onColor() === await tok('--intent'), await onColor());
  await release();
  await page.waitForTimeout(400);
  ok('roster: ...and in reality once the hub echoes', await onColor() === await tok('--reality'), await onColor());
  const tiles = await pat.locator('.pat-tile').evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().height * 2) / 2,
    parseFloat(getComputedStyle(e.querySelector('.pat-tile-label')).fontSize)]));
  ok('roster: tile labels at 11 px or more, every tile one height (ph-6a2)',
    tiles.length > 1 && tiles.every(([h, px]) => px >= 11 && Math.abs(h - tiles[0][0]) < 0.5), tiles);
  ok('roster: the select hint sits right under the roster', await pat.evaluate((c) => {
    const n = c.querySelector('.pattern-grid').nextElementSibling;
    return !!n && n.matches('p.hint');
  }));
  ok('roster: background run is the shared switch', await pat.locator('.field[data-widget=toggle] .og-switch').count() === 1);

  // advanced generator (ph-55r): base controls in one grid, the modulators in
  // one block after it, one adv tag for the block and none per field.
  for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => els.map((e) => e.dataset.tabId))) {
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(150);
    if (await page.locator('main.pane .dash-cell[data-id="hero:advanced-generator"]').count()) break;
  }
  const advShape = await page.locator('main.pane .dash-cell[data-id="hero:advanced-generator"] .advgen').evaluate((el) => ({
    gridHasMods: !!el.querySelector(':scope > .card-body .card-sub'),
    mods: el.querySelectorAll(':scope > .mods .field').length,
    fieldTags: [...el.querySelectorAll(':scope > .mods .field .tag.adv')].filter((t) => getComputedStyle(t).display !== 'none').length,
    blockTag: !!el.querySelector(':scope > .mods h4 .tag'),
  }));
  ok('advanced generator: modulators in their own block, one adv tag for it (ph-55r)',
    !advShape.gridHasMods && advShape.mods > 0 && advShape.fieldTags === 0 && advShape.blockTag, advShape);
  ok('advanced generator: its card reads its title (ph-c46)', await page.locator('main.pane .dash-cell[data-id="hero:advanced-generator"] .dash-title')
    .first().textContent().then((t) => t.trim()) === 'Advanced generator');
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

  // ---- palette drag-to-place, looks, undo (ph-e82.15) ---------------------------
  console.log('\n[full 1280x1400, palette drag and undo]');
  // Tall, so the palette entry and its drop target are on screen below the pinned rail hero.
  const ux = await open(1280, 1400, { active: 'Default', modules: {},
    layouts: { Default: { 'full.machine': { 'home:built': { x: 0, y: 9, w: 1, h: 1 } } } } });
  const stored = () => ux.page.evaluate(() => JSON.parse(localStorage.getItem('phosphor.layouts')).layouts.Default['full.machine']);
  await editBtn(ux.page).click();
  await ux.page.waitForTimeout(150);
  const looks = await ux.page.$$eval('.palette li[data-key]:has(.palette-looks)', (els) => els.map((e) => e.dataset.key));
  ok('palette: field entries list their presentations', looks.length > 1, looks.length);
  ok('palette: a safety op is marked as strip-bound', await ux.page.locator('.palette li[data-key^="safety:"] .palette-tag').count() > 0);
  const [dragKey, lookKey] = looks;
  const grid = ux.page.locator('.home > .dash-wrap > .dash-grid');
  const cellPx = await grid.evaluate((el) => parseFloat(el.style.getPropertyValue('--cell')));
  // A real HTML5 drag from the entry's title (searched to the top, centered),
  // released only after the target has seen a dragover: Chromium paces them.
  async function dragEntry(page, key, target, dx, dy) {
    const entry = page.locator('.palette li[data-key="' + key + '"]');
    await page.fill('.palette-filter', await entry.locator('.palette-title').textContent());
    await entry.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const src = await entry.locator('.palette-title').boundingBox();
    const dst = await target.boundingBox();
    await page.mouse.move(src.x + 5, src.y + 5);
    await page.mouse.down();
    await page.mouse.move(dst.x + dx, dst.y + dy, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.move(dst.x + dx + 2, dst.y + dy);
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.fill('.palette-filter', '');
  }
  await dragEntry(ux.page, dragKey, grid, cellPx * 5.5, cellPx * 1.5);
  ok('drag: a palette entry dropped on the grid is placed', (await topIds(ux.page)).includes(dragKey), await topIds(ux.page));
  ok('drag: it lands at the drop column', (await stored())[dragKey]?.x === 5, JSON.stringify((await stored())[dragKey]));
  ok('drag: no drop target is left behind', await ux.page.locator('.drop-ghost').count() === 0);
  await ux.page.$$eval('.palette details', (els) => els.forEach((d) => { d.open = true; }));
  const lookPres = (await ux.page.$$eval('.palette li[data-key="' + lookKey + '"] .look-chip', (els) => els.map((e) => e.textContent.trim())))[1];
  await ux.page.locator('.palette li[data-key="' + lookKey + '"] .look-chip', { hasText: lookPres }).click();
  await ux.page.waitForTimeout(150);
  ok('looks: a look chip adds the field with that presentation', (await stored())[lookKey]?.look?.pres === lookPres,
    JSON.stringify((await stored())[lookKey]));
  ok('undo: offered after a change', await ux.page.locator('.home .dash-toolbar button', { hasText: 'Undo' }).isEnabled());
  await ux.page.keyboard.press('Control+z');
  await ux.page.waitForTimeout(150);
  ok('undo: Ctrl+Z takes back the last add only', !(await topIds(ux.page)).includes(lookKey) && (await topIds(ux.page)).includes(dragKey),
    await topIds(ux.page));
  ok('undo: one level, then disabled', await ux.page.locator('.home .dash-toolbar button', { hasText: 'Undo' }).isDisabled());
  await ux.page.locator('.home .dash-toolbar button', { hasText: 'New nest' }).click();
  await ux.page.waitForTimeout(150);
  const uxNest = (await topIds(ux.page)).find((id) => id.startsWith('nest:'));
  await dragEntry(ux.page, lookKey, ux.page.locator('.dash-cell[data-id="' + uxNest + '"] .nest-body .dash-grid'), 20, 20);
  ok('drag: a drop on a nest joins the nest', await ux.page.locator('.dash-cell[data-id="' + uxNest + '"] .nest-body .dash-cell[data-id="' + lookKey + '"]').count() === 1);
  ok('drag: a safety op cannot be dragged into a nest', await ux.page.selectOption('.palette select[aria-label="Place into"]', uxNest)
    .then(() => ux.page.locator('.palette li[data-key^="safety:"]').first().getAttribute('draggable')) === 'false');
  await ux.ctx.close();

  // ---- handheld ---------------------------------------------------------------
  console.log('\n[handheld 390x844]');
  const hh = await open(390, 844);
  ok('catalog adopted', hh.up);
  const hl = await hh.page.$$eval('nav.tabs [role=tab]', (els) => els.map((e) => e.textContent.trim()));
  ok('no Overview tab', !hl.includes('Overview') && hl[0] === 'Dash', hl);
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
