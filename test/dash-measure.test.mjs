/**
 * dash-measure.test.mjs -- does a dashboard card's body follow the field floor?
 *
 * DESIGN 10.12: a card body's columns are at least --field-floor (16rem, 8
 * layout columns) wide and the remainder stretches, so no card ends in a
 * gutter. This reads the .card-body rule out of the stylesheet, applies it to
 * a probe element at the pane widths a full-row card gets, and checks the
 * column count, the floor and the no-gutter fit.
 *
 * Second half (ph-e82.3): the grid's cell edge, measured from the rendered
 * track at deviceScaleFactor 1.25 and 2, is CELL_DEVICE_PX device px, and the
 * scale control multiplies it.
 *
 * No device is needed and none is used. A change to the rule changes the
 * measurement.
 *
 * Deliberately NOT part of `npm run check`, same reason as
 * shell-chrome-geometry.test.mjs: that script runs inside every firmware
 * build and must not launch a browser.
 *
 * Third half (ph-e82.13.10): an opened card hands its full height to its
 * application region. In the shell bundle (plugins load there only) the node
 * editor's card is opened: the canvas fills the card body below the editor's
 * own toolbar, nothing runs past the window, and Full size spans the strip's
 * bottom edge to the window's.
 *
 * Run: node test/dash-measure.test.mjs   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { CELL_DEVICE_PX, SCALE_KEY } from '../src/model/grid.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';

const CAT = readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)).toString('hex');
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();

// The same fake hub test/a11y-basics.test.mjs boots against: WELCOME with the
// fixture etag (the catalog is pre-seeded in the cache), GRANT whatever is asked.
function fakeHub(ws) {
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
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('dash fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = (cbDecodeFull(payload).get(K.subscriptions) || []).map((w) => cbMap([[K.priority, cbUint(w.get(K.priority) || 0)],
          [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)], [K.channel_id, cbUint(w.get(K.channel_id))]]));
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const srv = createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.linkbar', { timeout: 15000 });
await page.waitForTimeout(500);

// A 12-span card's own content width, from the layout constants each term
// comes from: .app padding (--gap each side), the nav rail plus its gap,
// .dash-grid padding, the card border, and .dash-body padding.
const RAIL_PX = 188;
const paneCases = [
  { label: '1440', appW: 1440 },
  { label: '1920', appW: 1920 },
];

const res = await page.evaluate(({ cases, railPx }) => {
  let tpl = null, sel = null;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (r.selectorText && /\.card-body\b/.test(r.selectorText)
          && r.style && r.style.gridTemplateColumns) {
        tpl = r.style.gridTemplateColumns;
        sel = r.selectorText;
      }
    }
  }
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 12;
  const probeFloor = document.createElement('div');
  probeFloor.style.cssText = 'position:absolute;visibility:hidden;width:var(--field-floor)';
  document.body.appendChild(probeFloor);
  const floorPx = probeFloor.getBoundingClientRect().width;
  probeFloor.remove();

  const out = [];
  for (const c of cases) {
    const inner = c.appW - 2 * gap - railPx - gap - 10 - 2 - 2 * gap;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;display:grid;gap:' + gap
      + 'px;width:' + inner + 'px;grid-template-columns:' + tpl;
    const cell = document.createElement('div');
    probe.appendChild(cell);
    document.body.appendChild(probe);
    const trackPx = cell.getBoundingClientRect().width;
    const tracks = getComputedStyle(probe).gridTemplateColumns.split(' ').length;
    probe.remove();
    out.push({ label: c.label, inner, trackPx, tracks });
  }
  return { tpl, sel, floorPx, gap, out };
}, { cases: paneCases, railPx: RAIL_PX });

ok('the .card-body rule constrains its columns', !!res.tpl,
   res.sel + ' { grid-template-columns: ' + res.tpl + ' }');

for (const r of res.out) {
  console.log('  at ' + r.label + ': card content ' + r.inner.toFixed(0) + 'px -> '
    + r.tracks + ' column(s) of ' + r.trackPx.toFixed(0) + 'px');
  ok('at ' + r.label + ': as many columns as the floor allows',
     r.tracks === Math.floor((r.inner + res.gap) / (res.floorPx + res.gap)), r.tracks + ' columns, floor ' + res.floorPx + 'px');
  ok('at ' + r.label + ': no column under the field floor', r.trackPx >= res.floorPx - 0.5, r.trackPx.toFixed(1) + 'px');
  ok('at ' + r.label + ': the columns span the card, no gutter at the end',
     Math.abs(r.tracks * r.trackPx + (r.tracks - 1) * res.gap - r.inner) < 1.5, r.tracks + ' x ' + r.trackPx.toFixed(1) + 'px in ' + r.inner.toFixed(0) + 'px');
}

// A narrow card must collapse to ONE column, never overflow its own box.
const narrow = await page.evaluate((tpl) => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;display:grid;width:300px;grid-template-columns:' + tpl;
  const cell = document.createElement('div');
  probe.appendChild(cell);
  document.body.appendChild(probe);
  const w = cell.getBoundingClientRect().width;
  const n = getComputedStyle(probe).gridTemplateColumns.split(' ').length;
  probe.remove();
  return { w, n };
}, res.tpl);
ok('a 300px card is one column and does not overflow', narrow.n === 1 && narrow.w <= 300.5,
   narrow.n + ' x ' + narrow.w.toFixed(0) + 'px');

// ---- the cell edge in device px ------------------------------------------
for (const [dpr, scale] of [[1.25, 1], [2, 1], [1.25, 1.25]]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  await ctx.addInitScript(([k, v, etag, bytes]) => {
    try { localStorage.setItem(k, v); localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* none */ }
  }, [SCALE_KEY, String(scale), ETAG, CAT]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const pg = await ctx.newPage();
  await pg.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.dash-grid', { timeout: 15000 });
  await pg.waitForTimeout(300);
  const m = await pg.evaluate(() => {
    const g = document.querySelector('.dash-grid');
    const tracks = getComputedStyle(g).gridTemplateColumns.split(' ').map(parseFloat);
    return { track: tracks[0], n: tracks.length, width: g.clientWidth, dpr: devicePixelRatio };
  });
  const want = Math.round(CELL_DEVICE_PX * scale);
  ok('DPR ' + dpr + ' scale ' + scale + ': cell edge is ' + want + ' device px',
     Math.abs(m.track * m.dpr - want) < 0.05, (m.track * m.dpr).toFixed(2) + ' device px, ' + m.n + ' cells in ' + m.width + ' CSS px');
  ok('DPR ' + dpr + ' scale ' + scale + ': cell count follows the grid width', m.n === Math.floor(m.width / m.track + 1e-6));
  await ctx.close();
}

// ---- an opened card's application region fills it (ph-e82.13.10) ------------
{
  const SHELL = await buildShellPage();
  const shell = createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
  await new Promise((r) => shell.listen(0, '127.0.0.1', r));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(([etag, bytes]) => {
    try {
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      localStorage.setItem('shell_host', '127.0.0.1');
    } catch (e) { /* none */ }
  }, [ETAG, CAT]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const pg = await ctx.newPage();
  await pg.goto('http://127.0.0.1:' + shell.address().port + '/');
  await pg.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  // The editor is a card on a category page until it is placed on the home.
  for (let pass = 0; pass < 10 && !(await pg.$('.graph .gview')); pass++) {
    for (const id of await pg.$$eval('[role=tab][data-tab-id^="cat"]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
      await pg.click('[data-tab-id="' + id + '"]');
      await pg.waitForTimeout(120);
      if (await pg.$('.graph .gview')) break;
    }
  }
  ok('the node editor card is on a page', await pg.waitForSelector('.graph .gview', { timeout: 5000 }).then(() => true, () => false));
  await pg.locator('.dash-item:has(.graph) .dash-open').click();
  await pg.waitForTimeout(150);
  const geo = await pg.$eval('.graph', (g) => {
    const body = g.closest('.dash-body'), cs = getComputedStyle(body), b = body.getBoundingClientRect();
    const v = g.querySelector('.gview').getBoundingClientRect(), r = g.getBoundingClientRect();
    const it = g.closest('.dash-item').getBoundingClientRect();
    return { top: b.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth),
      bottom: b.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth),
      graphTop: r.top, header: v.top - r.top, view: v.height, viewBottom: v.bottom, item: it.bottom, win: innerHeight };
  });
  ok('opened: the canvas is the card body minus the editor header',
     Math.abs(geo.graphTop - geo.top) < 1 && Math.abs(geo.view - (geo.bottom - geo.top - geo.header)) < 1 && geo.view > 320, JSON.stringify(geo));
  ok('opened: nothing runs past the window', geo.item <= geo.win + 0.5 && geo.viewBottom <= geo.win, JSON.stringify(geo));
  await pg.click('.gtool button:has-text("Full size")');
  await pg.waitForTimeout(150);
  const full = await pg.$eval('.graph.full', (g) => {
    const r = g.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, win: innerHeight, strip: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 0 };
  });
  ok('Full size in an opened card spans the strip to the window bottom', Math.abs(full.top - full.strip) < 1 && Math.abs(full.bottom - full.win) < 1, JSON.stringify(full));
  await ctx.close();
  shell.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- card bodies follow the field floor.'));
process.exit(fails ? 1 : 0);
