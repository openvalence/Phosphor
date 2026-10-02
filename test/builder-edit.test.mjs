/**
 * builder-edit.test.mjs -- ph-e82.20: editing the builder grid with a pointer
 * and a keyboard, on the built app against a fake hub (WELCOME, GRANT, PING;
 * the recorded valencesim catalog pre-seeded in the etag cache). Interaction
 * only; the placement math is test/grid-model.test.mjs.
 *
 *   resize   every edge and corner resizes with a live ghost showing the
 *            size; the minimum is refused visibly; an orientation flip is
 *            announced (ph-e82.20.1)
 *   drag     the dragged card lifts; siblings reflow into the predicted
 *            layout while dragging; the ghost is the committed rect; a card
 *            dropped on a nest lights the nest and joins it; a member dragged
 *            out of its nest lands at the top level (ph-e82.20.2)
 *
 * Deliberately NOT part of `npm run check` (it launches a browser).
 * Build first (`npm run build:only`). Run: node test/builder-edit.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { buildSettingsModel, placeableControls, minCells, WIDGET } from '../src/model/settings.js';
import { STORE_KEY } from '../src/model/grid.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const CAT = readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const CONTROLS = placeableControls(buildSettingsModel(decodeCatalog(new Uint8Array(CAT))));
const SLIDER = CONTROLS.find((c) => c.kind === 'field' && c.field.widget === WIDGET.slider && !c.field.readOnly).key;
const [F1, F2, F3] = CONTROLS.filter((c) => c.kind === 'field' && c.key !== SLIDER && c.field.widget !== WIDGET.action).map((c) => c.key);

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
            [IDENTITY_K.hub_name, cbTstr('builder fixture')]])],
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
const browser = await chromium.launch();
const pageErrors = [];

/** The home, built from `home` ({[key]: {x, y, w, h}}), in edit mode. */
async function open(home, { w = 1280, h = 1000, store = null } = {}) {
  const st = store || { active: 'Default', modules: {}, layouts: { Default: { 'full.machine': { ...home, 'home:built': { x: 0, y: 40, w: 1, h: 1 } } } } };
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([etag, hex, k, v]) => {
    try {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: hex }));
      localStorage.setItem(k, v);
      sessionStorage.setItem('seeded', '1');
    } catch (e) { /* none */ }
  }, [ETAG, CAT.toString('hex'), STORE_KEY, JSON.stringify(st)]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await page.waitForSelector('.home .dash-grid', { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' }).click();
  await page.waitForTimeout(150);
  const grid = page.locator('.home > .dash-wrap > .dash-grid');
  const cell = await grid.evaluate((el) => parseFloat(el.style.getPropertyValue('--cell')));
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).layouts.Default['full.machine'], STORE_KEY);
  const said = () => page.$eval('.home > .dash-wrap > [aria-live]', (el) => el.textContent.trim());
  const card = (key) => page.locator('.home .dash-cell[data-id="' + key + '"]');
  return { ctx, page, grid, cell, stored, said, card };
}

/** Press on `loc`'s center, move by (dx, dy) px in steps, call `during`, release. */
async function drag(page, loc, dx, dy, during = null) {
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.waitForTimeout(80);
  const seen = during ? await during() : null;
  await page.mouse.up();
  await page.waitForTimeout(120);
  return seen;
}
const ghost = (page) => page.$eval('.home .drop-ghost', (g) => ({ text: g.textContent.trim(), refused: g.classList.contains('refused') })).catch(() => null);

// ---- resize from every edge (ph-e82.20.1) --------------------------------------
console.log('resize');
{
  const { ctx, page, cell, stored, said, card } = await open({ [SLIDER]: { x: 4, y: 0, w: 12, h: 3 } });
  const c = card(SLIDER);

  ok('edit mode offers every edge and corner beside the corner handle', await c.locator('.edge').count() === 7);
  const g1 = await drag(page, c.locator('.edge-w'), -2 * cell, 0, () => ghost(page));
  ok('west edge: the ghost shows the live size', g1 && g1.text === '14 × 3' && !g1.refused, g1);
  let s = (await stored())[SLIDER];
  ok('west edge: the left edge moves, the right holds', s.x === 2 && s.w === 14, s);
  await drag(page, c.locator('.edge-e'), 3 * cell, 0);
  s = (await stored())[SLIDER];
  ok('east edge: only the width grows', s.x === 2 && s.w === 17 && s.h === 3, s);
  const [mw] = minCells(WIDGET.slider, 'h');
  const g2 = await drag(page, c.locator('.edge-e'), -15 * cell, 0, () => ghost(page));
  ok('past the minimum: the ghost refuses visibly', g2 && g2.refused && g2.text === mw + ' × 3 · minimum', g2);
  ok('the refusal is announced', /its minimum$/.test(await said()), await said());
  s = (await stored())[SLIDER];
  ok('the release commits the minimum, never smaller', s.w === mw && s.x === 2, s);
  const g3 = await drag(page, c.locator('.handle.resize'), -(mw - 2) * cell, 6 * cell, () => ghost(page));
  ok('a corner drag past square flips the orientation, shown on the ghost', g3 && / · vertical$/.test(g3.text), g3);
  ok('the flip is announced', /now vertical/.test(await said()), await said());
  s = (await stored())[SLIDER];
  ok('the vertical size is committed', s.w === 2 && s.h >= minCells(WIDGET.slider, 'v')[1], s);
  ok('no ghost is left behind', await page.locator('.home .drop-ghost').count() === 0);
  await ctx.close();
}

// ---- drag feedback, into and out of a nest (ph-e82.20.2) ----------------------------
console.log('drag');
{
  const { ctx, page, cell, stored, said, card } = await open({
    [F1]: { x: 0, y: 0, w: 10, h: 2 }, [F2]: { x: 0, y: 2, w: 10, h: 2 },
    'nest:1': { x: 20, y: 0, w: 14, h: 6, nest: { title: 'Pump', scroll: false, map: { [F3]: { x: 0, y: 0, w: 6, h: 2 } } } },
  });
  const area = (key) => card(key).evaluate((el) => el.style.gridColumn + ' / ' + el.style.gridRow);
  const during = await drag(page, card(F1).locator('.handle.grab'), 10 * cell, 3 * cell, async () => ({
    lifted: await card(F1).locator('.dash-item').evaluate((el) => { const cs = getComputedStyle(el); return el.classList.contains('dragging') && cs.boxShadow !== 'none' && cs.transform !== 'none'; }),
    sibling: await area(F2),
    ghost: await page.$eval('.home .drop-ghost', (g) => g.style.gridColumn + ' / ' + g.style.gridRow),
    card: await area(F1),
  }));
  ok('the dragged card lifts with a shadow', during.lifted, during);
  ok('a sibling reflows into the predicted layout while dragging', /^1 \/ span 10 \/ 1 \/ span 2$/.test(during.sibling.replace(/\s+/g, ' ')), during.sibling);
  ok('the ghost is the cell rect the release commits', during.ghost === during.card, during);
  const s = await stored();
  ok('the release commits what the ghost showed', during.card.replace(/\s+/g, ' ').startsWith((s[F1].x + 1) + ' / span 10 / ' + (s[F1].y + 1)), JSON.stringify(s[F1]));

  const nestBody = card('nest:1').locator('.nest-body');
  const nb = await nestBody.boundingBox();
  const grab = await card(F1).locator('.handle.grab').boundingBox();
  const lit = await drag(page, card(F1).locator('.handle.grab'), nb.x + nb.width / 2 - (grab.x + grab.width / 2), nb.y + nb.height - 10 - (grab.y + grab.height / 2),
    () => page.$eval('.home .dash-cell[data-id="nest:1"] .nest-body .dash-grid', (g) => g.classList.contains('into')));
  ok('a card over a nest lights the nest', lit);
  ok('released there, it joins the nest', await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F1 + '"]').count() === 1
     && /into Pump/.test(await said()), await said());

  const m = card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"] .handle.grab');
  const mb = await m.boundingBox();
  const gb = await page.locator('.home > .dash-wrap > .dash-grid').boundingBox();
  const out = await drag(page, m, gb.x + 2.5 * cell - (mb.x + mb.width / 2), 0,
    () => page.$eval('.home > .dash-wrap > .dash-grid > .drop-ghost', (g) => g.style.gridColumn).catch(() => null));
  ok('a member dragged out of its nest shows its landing rect on the top grid', !!out && /^3 \/ span 6/.test(out.replace(/\s+/g, ' ')), out);
  const after = await stored();
  ok('released outside, it lands at the top level at that column, its size kept', after[F3] && after[F3].x === 2 && after[F3].w === 6
     && !Object.prototype.hasOwnProperty.call(after['nest:1'].nest.map, F3), JSON.stringify(after[F3]));
  ok('and is drawn at the top level only', await page.locator('.home > .dash-wrap > .dash-grid > .dash-cell[data-id="' + F3 + '"]').count() === 1
     && await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"]').count() === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok('one undo puts the member back in its nest', await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"]').count() === 1);
  await ctx.close();
}

ok('no page errors', pageErrors.length === 0, pageErrors);
await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the builder grid edits as drawn.'));
process.exit(fails ? 1 : 0);
