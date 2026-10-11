/**
 * builder-edit.test.mjs -- ph-e82.20: editing the builder grid with a pointer
 * and a keyboard, on the built app against a fake hub (WELCOME, GRANT, PING;
 * the recorded valencesim catalog pre-seeded in the etag cache). Interaction
 * only; the placement math is test/grid-model.test.mjs.
 *
 *   resize   every edge and corner resizes with a live ghost showing the
 *            size; under the card's floor it trims and draws red, never
 *            refused, until RESIZE_FLOOR; an orientation flip is announced
 *            (ph-e82.20.1); a resize onto a neighbor overlaps it, both red,
 *            and the neighbor never moves (ph-cxvc)
 *   drag     the dragged card lifts; no sibling moves into free cells while dragging or
 *            after the drop (ph-e82.22, placements are absolute); the ghost
 *            is the committed rect; a card dropped on a nest lights the nest
 *            and joins it; a member dragged out of its nest lands at the top
 *            level (ph-e82.20.2)
 *   select   grip click and Shift+click select; a marquee on empty grid
 *            selects what it crosses; a group moves as one; align left;
 *            duplicate a card (a second placement) and a nest (a copy);
 *            remove as a group, one undo step (ph-e82.20.3)
 *   nest     an empty nest says where controls go; the title edits in place
 *            (Enter commits, Escape restores); no scroll or fold switch
 *            (ph-e82.22); a module's members are previewed, inert ones
 *            named, before Insert (ph-e82.20.4)
 *   keys     on a focused grip: arrows step one cell into free space, never
 *            onto or past a neighbor that would have to move; Shift+arrows
 *            resize; focus stays on the moved grip; Tab meets the grips in
 *            reading order;
 *            Enter opens the look picker; Delete removes (Ctrl+Z restores);
 *            Escape cancels a pointer drag with nothing written (ph-e82.20.5)
 *   layouts  a switch from the sidebar ends edit mode and runs no animation
 *            on the grid; a layout exports as JSON and imports under a free
 *            name (ph-e82.20.6); the dash has no pane head and no toolbar
 *            outside edit mode, and no scale anywhere (ph-rk0)
 *   density  Compact (per layout) shrinks the gutter, card padding and card
 *            label, never a handle or the font floor; a self-labeled card
 *            hides its label outside edit mode and keeps its field label
 *            (ph-e82.20.7)
 *   red      a drop onto a card leaves both in place, overlapping and red
 *            (--warn border and plate, a one-fragment tooltip); the store
 *            keeps the last valid layout, the edit footer names the count
 *            and Done is disabled; resolving clears it and saves at once; a
 *            reload brings back the last valid layout (ph-cxvc)
 *   floor    a card under its measured content floor never grows on load:
 *            it clips at its frame running and is red in edit mode; titles
 *            stay one line; a resize past the floor clears it (ph-e82.25,
 *            ph-cxvc)
 *   chrome   right-click on the grid opens the add menu at the pointer and a
 *            pick lands at that cell; a drag on a card's body moves it while
 *            a control in it keeps its press; a drag across chrome selects
 *            no text; the edit footer sits over the scroll shade (ph-cxvc)
 *   modes    edit mode draws what runs (ph-wia): the grid origin and every
 *            card rect are the same in both modes, the palette and an open
 *            look popover take no room; a self-labeled card is bare until
 *            its label is shown (ph-w4r); edit tools are icon-sized and a
 *            title keeps its room (ph-fhx); a selection is outlined in
 *            --highlight (ph-9lu); a refused look part reads in --warn on
 *            the input it names (ph-5rt); the palette's strip tag is muted,
 *            never red (ph-r2m)
 *
 * Deliberately NOT part of `npm run check` (it launches a browser).
 * Build first (`npm run build:only`). Run: node test/builder-edit.test.mjs
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { buildSettingsModel, placeableControls, minCells, WIDGET } from '../src/model/settings.js';
import { STORE_KEY, RESIZE_FLOOR } from '../src/model/grid.js';

// The sidebar wrench drives edit mode (dashEdit); a layout is picked from the sidebar sub-items.
const editBtn = (page) => page.locator('button[data-tip="Edit layout"]:visible').first();
const doneBtn = (page) => page.locator('button[data-tip="Done editing"]:visible').first();
const pickLayout = (page, name) => page.locator('nav.rail .sub-layout[data-layout="' + name + '"]').click();
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

const HTML = readFileSync(DIST_HTML);
const srv = createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch();
const pageErrors = [];

/** The home, built from `home` ({[key]: {x, y, w, h}}), in edit mode unless `edit` is false. */
async function open(home, { w = 1280, h = 1000, store = null, edit = true } = {}) {
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
  if (edit) {
    await editBtn(page).click();
    await page.waitForSelector('.dash-toolbar');
    // The palette overlays the grid's top right (ph-wia); these cases edit the grid alone.
    await page.locator('.dash-toolbar .palette-toggle').click();
    await page.waitForTimeout(150);
  }
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
/** Red state: per key the card's fault tooltip (null when valid), the footer hint and Done. */
const redState = async (page, keys) => ({
  faults: Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await page.locator('.home .dash-cell[data-id="' + k + '"] > .dash-item')
    .evaluate((el) => (el.classList.contains('fault') ? el.getAttribute('data-tip') : null)).catch(() => 'missing')]))),
  hint: await page.locator('.home .dash-toolbar .dash-hint.red').textContent().catch(() => null),
  done: await page.locator('button[aria-label="Done editing"]:visible').first().isDisabled().catch(() => null),
});
const ghost = (page) => page.$eval('.home .drop-ghost', (g) => ({ text: g.textContent.trim(), refused: g.classList.contains('refused') })).catch(() => null);

// ---- resize from every edge (ph-e82.20.1) --------------------------------------
console.log('resize');
{
  const { ctx, page, cell, stored, said, card } = await open({ [SLIDER]: { x: 4, y: 0, w: 12, h: 8 }, [F1]: { x: 24, y: 0, w: 10, h: 8 } });
  const c = card(SLIDER);
  const h0 = 8, f1 = JSON.stringify((await stored())[F1]);
  ok('the fixture loads valid', Object.values((await redState(page, [SLIDER, F1])).faults).every((f) => f === null), await redState(page, [SLIDER, F1]));

  ok('edit mode offers every edge and corner beside the corner handle', await c.locator('.edge').count() === 7);
  const stolen = await page.$$eval('.home .dash-item .tools > *', (els) => els.flatMap((t) => {
    const r = t.getBoundingClientRect();
    return [[1, 1], [r.width - 1, 1], [1, r.height - 1], [r.width - 1, r.height - 1], [r.width / 2, r.height / 2]]
      .map(([x, y]) => document.elementFromPoint(r.left + x, r.top + y))
      .filter((e) => e && !t.contains(e) && e.closest('.edge'))
      .map((e) => (t.getAttribute('aria-label') || t.className) + ' under ' + e.className);
  }));
  ok('no resize edge covers a grip or a head tool, corners included (ph-gbuc)', stolen.length === 0, stolen);
  const g1 = await drag(page, c.locator('.edge-w'), -2 * cell, 0, () => ghost(page));
  ok('west edge: the ghost shows the live size', g1 && g1.text === '14 × ' + h0 && !g1.refused, g1);
  let s = (await stored())[SLIDER];
  ok('west edge: the left edge moves, the right holds', s.x === 2 && s.w === 14, s);
  await drag(page, c.locator('.edge-e'), 3 * cell, 0);
  s = (await stored())[SLIDER];
  ok('east edge: only the width grows', s.x === 2 && s.w === 17 && s.h === h0, s);
  // Under the floor (ph-cxvc): no refusal, the content trims and the card is red; the store keeps the last valid size.
  const g2 = await drag(page, c.locator('.edge-s'), 0, -7 * cell, () => ghost(page));
  ok('past the floor: the ghost follows, no refusal', g2 && g2.text === '17 × 1' && !g2.refused, g2);
  let r = await redState(page, [SLIDER, F1]);
  ok('under its floor the card is red, named in one fragment', r.faults[SLIDER] === 'below its minimum' && r.faults[F1] === null, r);
  ok('the trim is announced', /below its minimum$/.test(await said()), await said());
  ok('nothing is saved, the footer names the count and Done is disabled',
     (await stored())[SLIDER].h === h0 && r.hint === '1 card red, not saved' && r.done === true, [await stored(), r]);
  await drag(page, c.locator('.edge-s'), 0, 7 * cell);
  r = await redState(page, [SLIDER, F1]);
  ok('back over the floor: the red clears at once and the size saves', r.faults[SLIDER] === null && r.hint === null && r.done === false
     && (await stored())[SLIDER].h === h0, r);
  const g3 = await drag(page, c.locator('.edge-n'), 0, 30 * cell, () => ghost(page));
  ok('RESIZE_FLOOR is the one stop, shown on the ghost', g3 && g3.refused && g3.text === '17 × ' + RESIZE_FLOOR[1] + ' · minimum', g3);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok('undo puts it back and saves', (await stored())[SLIDER].h === h0 && (await redState(page, [SLIDER])).faults[SLIDER] === null);
  // Tall enough that it reads taller than wide.
  const g4 = await drag(page, c.locator('.handle.resize'), -14 * cell, 12 * cell, () => ghost(page));
  ok('a corner drag past square flips the orientation, shown on the ghost', g4 && / · vertical$/.test(g4.text), g4);
  ok('the flip is announced', /now vertical/.test(await said()), await said());
  ok('no ghost is left behind', await page.locator('.home .drop-ghost').count() === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  await drag(page, c.locator('.edge-e'), 30 * cell, 0);
  r = await redState(page, [SLIDER, F1]);
  ok('a resize onto a neighbor overlaps it: both red, each naming the other', /^overlaps /.test(r.faults[SLIDER]) && /^overlaps /.test(r.faults[F1])
     && r.hint === '2 cards red, not saved', r);
  s = await stored();
  ok('the neighbor never moves and nothing is saved', JSON.stringify(s[F1]) === f1 && s[SLIDER].w === 17, [s[SLIDER], s[F1], f1]);
  await ctx.close();
}

// ---- a small control keeps its own floor (ph-s7lj.1) -------------------------------------
console.log('small floor');
{
  const { ctx, page, cell, stored, card } = await open({ [SLIDER]: { x: 4, y: 0, w: 3, h: 7, look: { pres: 'knob' } } });
  const k0 = (await stored())[SLIDER];
  ok('a saved 3-wide knob does not grow on load and loads valid', k0.w === 3 && k0.h === 7 && (await redState(page, [SLIDER])).faults[SLIDER] === null,
     [k0, await redState(page, [SLIDER])]);
  await drag(page, card(SLIDER).locator('.edge-e'), 4 * cell, 0);
  await drag(page, card(SLIDER).locator('.edge-e'), -4 * cell, 0);
  const k1 = (await stored())[SLIDER];
  ok('a knob resized back to 3 wide is valid and saved: no field floor binds it', k1.w === 3 && (await redState(page, [SLIDER])).faults[SLIDER] === null, k1);
  await ctx.close();
}

// ---- drag feedback, into and out of a nest (ph-e82.20.2) ----------------------------
console.log('drag');
{
  const { ctx, page, cell, stored, said, card } = await open({
    [F1]: { x: 0, y: 0, w: 8, h: 4 }, [F2]: { x: 8, y: 0, w: 8, h: 4 },
    'nest:1': { x: 16, y: 0, w: 13, h: 16, nest: { title: 'Pump', scroll: false, map: { [F3]: { x: 0, y: 0, w: 8, h: 4 } } } },
  });
  const area = (key) => card(key).evaluate((el) => el.style.gridColumn + ' / ' + el.style.gridRow);
  const areas = () => page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell', (els) => Object.fromEntries(els
    .map((el) => [el.dataset.id, (el.style.gridColumn + ' / ' + el.style.gridRow).replace(/\s+/g, ' ')])));
  const siblingsMoved = (a, b, except) => Object.keys(a).filter((k) => k !== except && k in b && a[k] !== b[k]);
  const before = await areas();
  // Straight down into free rows: the grip sits at the card's right end, so a
  // move right would carry the pointer over the nest.
  const during = await drag(page, card(F1).locator('.handle.grab'), 0, 6 * cell, async () => ({
    all: await areas(),
    lifted: await card(F1).locator('.dash-item').evaluate((el) => { const cs = getComputedStyle(el); return el.classList.contains('dragging') && cs.boxShadow !== 'none' && cs.transform !== 'none'; }),
    ghost: await page.$eval('.home .drop-ghost', (g) => g.style.gridColumn + ' / ' + g.style.gridRow),
    card: await area(F1),
  }));
  ok('the dragged card lifts with a shadow', during.lifted, during);
  ok('no sibling moves while dragging', siblingsMoved(before, during.all, F1).length === 0, siblingsMoved(before, during.all, F1));
  ok('no sibling moves after the drop', siblingsMoved(before, await areas(), F1).length === 0, siblingsMoved(before, await areas(), F1));
  ok('the ghost is the cell rect the release commits', during.ghost === during.card, during);
  const s = await stored();
  ok('the release commits what the ghost showed', during.card.replace(/\s+/g, ' ').startsWith((s[F1].x + 1) + ' / span 8 / ' + (s[F1].y + 1)), JSON.stringify(s[F1]));
  ok('the card moved by the pointer\'s cells: the grabbed cell stays under it (ph-29r)', s[F1].x === 0 && s[F1].y === 6, JSON.stringify(s[F1]));

  const nestBody = card('nest:1').locator('.nest-body');
  const nb = await nestBody.boundingBox();
  const grab = await card(F1).locator('.handle.grab').boundingBox();
  const lit = await drag(page, card(F1).locator('.handle.grab'), nb.x + nb.width / 2 - (grab.x + grab.width / 2), nb.y + nb.height - 10 - (grab.y + grab.height / 2),
    () => page.$eval('.home .dash-cell[data-id="nest:1"] .nest-body .dash-grid', (g) => g.classList.contains('into')));
  ok('a card over a nest lights the nest', lit);
  ok('released there, it joins the nest', await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F1 + '"]').count() === 1
     && /into Pump/.test(await said()), await said());

  const m = card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"] .handle.grab');
  // The member's cells sit under the top grid's columns (ph-nnl), so moving
  // its cell's left edge onto column 2 moves its grabbed cell with it.
  const mc = await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"]').boundingBox();
  const gb = await page.locator('.home > .dash-wrap > .dash-grid').boundingBox();
  const gpad = await page.$eval('.home > .dash-wrap > .dash-grid', (g) => parseFloat(getComputedStyle(g).paddingLeft));
  const mw0 = Math.round(mc.width / cell);
  const out = await drag(page, m, gb.x + gpad - mc.x, 0,
    () => page.$eval('.home > .dash-wrap > .dash-grid > .drop-ghost', (g) => g.style.gridColumn).catch(() => null));
  ok('a member dragged out of its nest shows its landing rect on the top grid', !!out && new RegExp('^1 / span ' + mw0).test(out.replace(/\s+/g, ' ')), out);
  const after = await stored();
  ok('released outside, it lands at the top level at that column, its width kept', after[F3] && after[F3].x === 0 && after[F3].w === mw0
     && !Object.prototype.hasOwnProperty.call(after['nest:1'].nest.map, F3), JSON.stringify(after[F3]));
  ok('and is drawn at the top level only', await page.locator('.home > .dash-wrap > .dash-grid > .dash-cell[data-id="' + F3 + '"]').count() === 1
     && await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"]').count() === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok('one undo puts the member back in its nest', await card('nest:1').locator('.nest-body .dash-cell[data-id="' + F3 + '"]').count() === 1);
  await ctx.close();
}

// ---- multi-select (ph-e82.20.3) --------------------------------------------------
console.log('select');
{
  const { ctx, page, cell, stored, said, card } = await open({
    [F1]: { x: 0, y: 0, w: 8, h: 4 }, [F2]: { x: 8, y: 0, w: 8, h: 4 }, [F3]: { x: 0, y: 4, w: 8, h: 4 },
    'nest:1': { x: 16, y: 0, w: 13, h: 16, nest: { title: 'Pump', scroll: false, map: { [SLIDER]: { x: 0, y: 0, w: 8, h: 4 } } } },
  });
  const grip = (key) => card(key).locator(':scope > .dash-item > .dash-head .handle.grab');
  const pressed = async () => (await page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell', (els) => els
    .filter((c) => c.querySelector(':scope > .dash-item > .dash-head .handle.grab')?.getAttribute('aria-pressed') === 'true')
    .map((c) => c.dataset.id))).sort();
  // The selection takes the toolbar's status slot in place (ph-wia).
  const selbar = () => page.locator('.home > .dash-wrap > .dash-toolbar .dash-selbar');
  await grip(F1).click();
  await grip(F2).click({ modifiers: ['Shift'] });
  ok('a grip click selects, Shift+click adds', JSON.stringify(await pressed()) === JSON.stringify([F1, F2].sort())
     && /2 selected/.test(await selbar().textContent()), await pressed());
  await drag(page, grip(F1), 0, 8 * cell);
  let s = await stored();
  ok('dragging one selected card moves the group as one', s[F1].x === 0 && s[F2].x === 8 && s[F1].y === 8 && s[F2].y === 8,
     JSON.stringify([s[F1], s[F2]]));
  ok('the move is announced for the group', /2 cards moved/.test(await said()), await said());
  ok('a drag is not a click: the selection stands', (await pressed()).length === 2);

  await card(F3).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const f3 = await card(F3).boundingBox();
  // Start on empty grid just right of F3, inside its bottom row; end on F3's center.
  await page.mouse.move(f3.x + f3.width + 1.5 * cell, f3.y + f3.height - 10);
  await page.mouse.down();
  await page.mouse.move(f3.x + f3.width / 2, f3.y + f3.height / 2, { steps: 6 });
  const drawn = await page.locator('.home > .dash-wrap > .dash-grid > .marquee').count();
  await page.mouse.up();
  await page.waitForTimeout(100);
  ok('a marquee on empty grid draws and selects what it crosses', drawn === 1 && JSON.stringify(await pressed()) === JSON.stringify([F3]),
     await pressed());
  await grip(F1).click({ modifiers: ['Shift'] });
  await grip(F2).click({ modifiers: ['Shift'] });
  await selbar().locator('button', { hasText: 'Align left' }).click();
  await page.waitForTimeout(100);
  s = await stored();
  const lefts = await Promise.all([F1, F2, F3].map(async (k) => Math.round((await card(k).boundingBox()).x)));
  const ar = await redState(page, [F1, F2, F3]);
  ok('align left puts every selected card on one left edge', new Set(lefts).size === 1, lefts);
  ok('an align that lands a card on another overlaps it, red, and is not saved (ph-cxvc)', /^overlaps /.test(ar.faults[F1]) && /^overlaps /.test(ar.faults[F2])
     && ar.faults[F3] === null && s[F2].x === 8, [ar, s[F2]]);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok('undo resolves it', (await redState(page, [F1, F2])).hint === null);

  await selbar().locator('button', { hasText: 'Clear' }).click();
  await grip('nest:1').click();
  await selbar().locator('button', { hasText: 'Duplicate' }).click();
  await page.waitForTimeout(150);
  s = await stored();
  ok('a nest duplicates whole, below, titled as a copy', s['nest:2'] && s['nest:2'].nest.title === 'Pump copy'
     && Object.keys(s['nest:2'].nest.map).join() === SLIDER, JSON.stringify(s['nest:2']));
  ok('the copy draws its member too', await card('nest:2').locator('.nest-body .dash-cell[data-id="' + SLIDER + '"]').count() === 1);
  await grip(F1).click();
  await selbar().locator('button', { hasText: 'Duplicate' }).click();
  await page.waitForTimeout(150);
  s = await stored();
  ok('a card duplicates as a second placement with its own key', !!s[F1 + '#2'] && await card(F1 + '#2').count() === 1, Object.keys(s));
  ok('the copy is selected', JSON.stringify(await pressed()) === JSON.stringify([F1 + '#2']), await pressed());
  await grip('nest:2').click({ modifiers: ['Shift'] });
  await selbar().locator('button', { hasText: 'Remove' }).click();
  await page.waitForTimeout(150);
  s = await stored();
  ok('remove takes the selection off the home', !s[F1 + '#2'] && !s['nest:2'] && !!s[F1], Object.keys(s));
  ok('a member another nest holds stays in it', await card('nest:1').locator('.nest-body .dash-cell[data-id="' + SLIDER + '"]').count() === 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  s = await stored();
  ok('one undo restores the whole group remove', !!s[F1 + '#2'] && !!s['nest:2'], Object.keys(s));
  await doneBtn(page).click();
  ok('leaving edit mode clears the selection', await page.locator('.home .dash-selbar').count() === 0);
  await ctx.close();
}

// ---- nest header and module preview (ph-e82.20.4) ----------------------------------
console.log('nest');
{
  const GHOST = 'uid:999:not-on-this-machine';
  const store = { active: 'Default', layouts: { Default: { 'full.machine': {
    [F1]: { x: 0, y: 0, w: 8, h: 4 }, 'home:built': { x: 0, y: 40, w: 1, h: 1 },
    'nest:1': { x: 10, y: 0, w: 12, h: 6, nest: { title: 'Empty', scroll: true, map: {} } },
  } } }, modules: { Kit: { title: 'Kit', scroll: false, w: 12, h: 4, members: { [F2]: null, [GHOST]: null } } } };
  const { ctx, page, stored, said, card } = await open(null, { store });
  const nest = card('nest:1');
  ok('an empty nest says where controls go', (await nest.locator('.nest-empty').textContent()).trim() === 'Drop controls here');
  const name = nest.locator('input.dash-title-edit');
  await name.fill('Pump');
  await name.press('Enter');
  await page.waitForTimeout(100);
  ok('the nest title edits in place; Enter commits', (await stored())['nest:1'].nest.title === 'Pump' && /renamed to Pump/.test(await said()));
  await name.fill('Oops');
  await name.press('Escape');
  await page.waitForTimeout(100);
  ok('Escape restores the title', (await stored())['nest:1'].nest.title === 'Pump' && await name.inputValue() === 'Pump');
  ok('the bar offers no scroll or fold switch (a nest is fixed and always open)',
     await nest.locator('.nest-fold, .nest-bar button:has-text("Scrolling"), .nest-bar button:has-text("Fixed")').count() === 0);

  await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
  await page.locator('select[aria-label="Module"]').selectOption('Kit');
  const rows = await page.$$eval('.module-preview li', (els) => els.map((e) => [e.textContent.trim(), e.classList.contains('inert')]));
  const sum = (await page.locator('.module-sum').textContent()).replace(/\s+/g, ' ').trim();
  ok('the module preview lists every member before Insert', rows.length === 2 && rows.some(([t, i]) => i && t.includes(GHOST)) && rows.some(([, i]) => !i), rows);
  ok('the preview counts what this view can draw', /^1 of 2 available here$/.test(sum), sum);
  ok('nothing is placed by previewing', !Object.keys(await stored()).includes('nest:2'));
  await page.locator('.dash-menu button', { hasText: 'Insert' }).click();
  await page.waitForTimeout(150);
  ok('Insert places it with the live member drawn and the inert one kept', await card('nest:2').locator('.nest-body .dash-cell').count() === 1
     && Object.keys((await stored())['nest:2'].nest.map).includes(GHOST) && /1 of 2 members/.test(await said()), await said());
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---- a drop onto a card overlaps it, red, and blocks the save (ph-cxvc) -----------------
console.log('red');
{
  const { ctx, page, cell, stored, card } = await open({ [F1]: { x: 0, y: 0, w: 10, h: 8 }, [F2]: { x: 14, y: 0, w: 10, h: 8 } });
  const rect = async (key) => (await card(key).boundingBox());
  const s0 = JSON.stringify(await stored());
  let r = await redState(page, [F1, F2]);
  ok('the fixture loads valid: no red card, Done enabled', r.faults[F1] === null && r.faults[F2] === null && r.done === false, r);
  await drag(page, card(F2).locator('.handle.grab'), -14 * cell, 0);
  const a = await rect(F1), b = await rect(F2);
  ok('a drop onto a card leaves both in place, overlapping', Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1, [a, b]);
  r = await redState(page, [F1, F2]);
  ok('both are red, each naming the other in one fragment', /^overlaps \S/.test(r.faults[F1]) && /^overlaps \S/.test(r.faults[F2]), r);
  const paint = await card(F2).locator(':scope > .dash-item > .dash-body').evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--warn)';
    document.body.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { border: cs.borderTopColor, warn, plate: cs.backgroundImage };
  });
  ok('red is the warn token: border and a tinted plate', paint.border === paint.warn && /gradient/.test(paint.plate), paint);
  ok('the store keeps the last valid layout', JSON.stringify(await stored()) === s0);
  ok('the edit footer names the count; Done is disabled and says why', r.hint === '2 cards red, not saved' && r.done === true
     && await page.locator('button[aria-label="Done editing"]:visible').first().getAttribute('data-tip') === '2 cards red, not saved', r);
  await drag(page, card(F2).locator('.handle.grab'), 14 * cell, 0);
  r = await redState(page, [F1, F2]);
  ok('resolving clears the red at once and Done returns', r.faults[F1] === null && r.faults[F2] === null && r.hint === null && r.done === false, r);
  ok('the resolved layout is saved', (await stored())[F2].x === 14 && (await stored())[F2].y === 0);
  await drag(page, card(F2).locator('.handle.grab'), -14 * cell, 0);
  ok('red again', (await redState(page, [F2])).faults[F2] !== null);
  await page.reload();
  await page.waitForSelector('.home .dash-grid');
  await page.waitForTimeout(500);
  const s2 = await stored();
  ok('a reload brings back the last valid layout', s2[F2].x === 14 && Math.abs((await rect(F2)).x - (await rect(F1)).x) > cell, s2[F2]);
  await editBtn(page).click();
  await page.waitForTimeout(300);
  await drag(page, card(F2).locator('.handle.grab'), -14 * cell, 0);
  await pickLayout(page, 'Default');
  await page.waitForTimeout(300);
  ok('ending edit mode red drops back to the last write', (await stored())[F2].x === 14 && Math.abs((await rect(F2)).x - (await rect(F1)).x) > cell
     && await page.locator('.home .dash-item.fault').count() === 0, (await stored())[F2]);
  await ctx.close();
}

// ---- keyboard (ph-e82.20.5) ----------------------------------------------------------
console.log('keys');
{
  const { ctx, page, cell, stored, said, card } = await open({
    [F1]: { x: 0, y: 0, w: 10, h: 4 }, [F2]: { x: 0, y: 4, w: 10, h: 4 }, [SLIDER]: { x: 12, y: 0, w: 10, h: 4 },
  });
  const grip = (key) => card(key).locator('.handle.grab');
  const focusedId = () => page.evaluate(() => document.activeElement?.closest('.dash-cell')?.dataset.id || null);
  await grip(F2).focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  let s = await stored();
  ok('ArrowUp onto a neighbor moves nothing and says so', s[F2].y === 4 && s[F1].y === 0 && /nothing free above/.test(await said()),
     [s[F1], s[F2], await said()]);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  s = await stored();
  ok('ArrowDown steps one cell into free space; the card above stays', s[F2].y === 5 && s[F1].y === 0, JSON.stringify([s[F1], s[F2]]));
  ok('focus stays on the moved grip', await focusedId() === F2 && await page.evaluate(() => document.activeElement.classList.contains('grab')));
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  s = await stored();
  ok('ArrowUp steps back up one cell', s[F2].y === 4 && s[F1].y === 0, JSON.stringify([s[F1], s[F2]]));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(100);
  s = await stored();
  ok('ArrowRight nudges a cell, Shift+ArrowRight grows a cell', s[F2].x === 1 && s[F2].w === 11, JSON.stringify(s[F2]));

  const reading = Object.entries(await stored()).filter(([k, e]) => e && e.y != null && k !== 'home:built')
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([k]) => k);
  await doneBtn(page).focus();
  const seen = [];
  for (let i = 0; i < 120 && seen.length < reading.length; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => (document.activeElement?.classList.contains('grab') ? document.activeElement.closest('.dash-cell').dataset.id : null));
    if (id && !seen.includes(id)) seen.push(id);
  }
  ok('Tab meets the grips in reading order', JSON.stringify(seen) === JSON.stringify(reading), seen);

  await grip(SLIDER).focus();
  await page.keyboard.press('Enter');
  ok('Enter on a grip opens its look picker', await page.evaluate(() => !!document.activeElement?.matches('[data-look] select'))
     && await focusedId() === SLIDER);
  await page.keyboard.press('Escape');

  const before = JSON.stringify((await stored())[F1]);
  await grip(F1).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await grip(F1).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 6 * cell, b.y + b.height / 2 + 2 * cell, { steps: 6 });
  const mid = await page.locator('.home .drop-ghost').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const gone = await page.locator('.home .drop-ghost').count();
  await page.mouse.up();
  await page.waitForTimeout(120);
  ok('Escape cancels a pointer drag: the ghost goes, nothing is written', mid === 1 && gone === 0
     && JSON.stringify((await stored())[F1]) === before && /canceled/.test(await said()), await said());

  await grip(F1).focus();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  ok('Delete on a grip removes the card', !(await stored())[F1] && await card(F1).count() === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok('Ctrl+Z brings it back', JSON.stringify((await stored())[F1]) === before);
  await ctx.close();
}

// ---- layout switching, export and import (ph-e82.20.6) -------------------------------
console.log('layouts');
{
  const built = { 'home:built': { x: 0, y: 40, w: 1, h: 1 } };
  const store = { active: 'Default', modules: {}, layouts: {
    Default: { 'full.machine': { [F1]: { x: 0, y: 0, w: 10, h: 4 }, ...built } },
    Night: { 'full.machine': { [F2]: { x: 4, y: 0, w: 12, h: 4 }, ...built } },
  } };
  const { ctx, page, said, card } = await open(null, { store });
  const all = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
  await card(F1).locator('.handle.grab').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  await pickLayout(page, 'Night');
  await page.waitForTimeout(150);
  const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.dash-grid') && !/fade-in/.test(a.animationName || '')).length);
  const still = await page.$$eval('.home .dash-cell, .home .dash-item', (els) => els.every((e) => getComputedStyle(e).transitionDuration.split(',').every((d) => parseFloat(d) === 0)));
  let s = await all();
  ok('a switch from the sidebar ends edit mode and shows the other layout, the edit kept', s.active === 'Night'
     && s.layouts.Default['full.machine'][F1].x === 1 && await card(F2).count() === 1 && await card(F1).count() === 0
     && await page.locator('.dash-toolbar').count() === 0, JSON.stringify(s.layouts.Default['full.machine'][F1]));
  ok('a switch moves nothing on the grid (no transition; only the opacity fade-in)', moving === 0 && still, { moving, still });
  await pickLayout(page, 'Default');
  await page.waitForTimeout(150);
  ok('and back at once', (await all()).active === 'Default' && await card(F1).count() === 1);
  ok('the dash has no pane head: no toolbar outside edit mode, the grid starts at the top of its wrap', await page.locator('.home .dash-toolbar, .home select[aria-label="Layout"]').count() === 0
     && await page.evaluate(() => { const w = document.querySelector('.home > .dash-wrap'); return w.firstElementChild.classList.contains('dash-grid')
       && w.firstElementChild.getBoundingClientRect().top === w.getBoundingClientRect().top; }));
  await editBtn(page).click();
  await page.waitForSelector('.dash-toolbar');
  ok('the scale is not on the toolbar, and not in the Layout menu either (ph-rk0)', await page.locator('.dash-toolbar .scale, .dash-menu .scale').count() === 0);
  await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
  ok('the Layout menu holds density, export, import, no scale', await page.locator('.dash-menu .view-row .density').count() === 1
     && await page.locator('.dash-menu .scale').count() === 0);
  await page.locator('.dash-menu button', { hasText: 'Export' }).click();
  const text = await page.locator('.dash-menu textarea[aria-label="Layout JSON"]').inputValue();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* reported below */ }
  ok('Export writes the active layout as JSON', parsed && parsed.app === 'phosphor' && parsed.layout === 'Default'
     && parsed.views['full.machine'][F1].w === 10, text.slice(0, 80));
  await page.locator('.dash-menu button', { hasText: 'Import' }).click();
  await page.waitForTimeout(100);
  s = await all();
  ok('Import adds it under a free name and switches to it', s.active === 'Default 2'
     && JSON.stringify(s.layouts['Default 2']) === JSON.stringify(s.layouts.Default) && /Imported layout Default 2/.test(await said()), s.active);
  await page.locator('.dash-menu textarea[aria-label="Layout JSON"]').fill('{"app":"other"}');
  await page.locator('.dash-menu button', { hasText: 'Import' }).click();
  ok('a foreign text is refused, named, and adds nothing', /Not imported: not a Phosphor layout/.test(await said())
     && Object.keys((await all()).layouts).length === 3, await said());
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---- density and hidden labels (ph-e82.20.7) --------------------------------------------
console.log('density');
{
  const built = { 'home:built': { x: 0, y: 40, w: 1, h: 1 } };
  const store = { active: 'Default', modules: {}, layouts: {
    // The pattern card unplaced: it is drawn and written at its own content height.
    Default: { 'full.machine': { [SLIDER]: { x: 0, y: 0, w: 12, h: 6 }, 'hero:pattern': {}, ...built } },
    Spare: { 'full.machine': { [SLIDER]: { x: 0, y: 0, w: 12, h: 6 }, ...built } },
  } };
  const { ctx, page, said, card } = await open(null, { store });
  const all = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
  // The slider card is bare (ph-w4r): the card label is measured on the titled pattern card.
  const metrics = () => page.evaluate(([a, b]) => {
    const c = document.querySelector('.dash-cell[data-id="' + a + '"]'), t = document.querySelector('.dash-cell[data-id="' + b + '"] .dash-title');
    return { pad: parseFloat(getComputedStyle(c).paddingTop), title: t && parseFloat(getComputedStyle(t).fontSize),
      handle: Math.min(...[...c.querySelectorAll('.handle')].map((h) => Math.min(h.getBoundingClientRect().width, h.getBoundingClientRect().height))) };
  }, [SLIDER, 'hero:pattern']);
  const roomy = await metrics();
  await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
  await page.locator('.dash-menu label.density').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const tight = await metrics();
  ok('Compact is stored on the layout', (await all()).layouts.Default.opts?.density === 'compact' && /is compact/.test(await said()));
  ok('Compact shrinks the gutter and the card label', tight.pad < roomy.pad && tight.title < roomy.title, { roomy, tight });
  ok('the label keeps the 11 px floor and handles keep 40 px (law 12)', tight.title >= 11 && tight.handle >= 39.5, tight);
  await pickLayout(page, 'Spare');
  await page.waitForTimeout(150);
  ok('density is per layout: another layout stays comfortable', (await metrics()).pad === roomy.pad && !(await all()).layouts.Spare.opts);
  await pickLayout(page, 'Default');
  await page.waitForTimeout(150);
  await editBtn(page).click();
  await page.waitForSelector('.dash-toolbar');

  ok('only a self-labeled card offers its label', await card(SLIDER).locator('.label-btn').count() === 1
     && await card('hero:pattern').locator('.label-btn').count() === 0);
  ok('a self-labeled card is bare by default (ph-w4r)', await card(SLIDER).locator('.label-btn').getAttribute('aria-pressed') === 'false'
     && !('label' in ((await all()).layouts.Default['full.machine'][SLIDER].look || {})));
  ok('in edit mode a bare card can still be grabbed', await card(SLIDER).locator('.handle.grab').count() === 1);
  await card(SLIDER).locator('.label-btn').click();
  await page.waitForTimeout(100);
  ok('showing the label is stored on the placement look', (await all()).layouts.Default['full.machine'][SLIDER].look?.label === true
     && await card(SLIDER).locator('.label-btn').getAttribute('aria-pressed') === 'true');
  await doneBtn(page).click();
  await page.waitForTimeout(100);
  ok('outside edit mode a shown label heads the card', await card(SLIDER).locator('.dash-head .dash-title').count() === 1);
  await editBtn(page).click();
  await card(SLIDER).locator('.label-btn').click();
  await page.waitForTimeout(100);
  ok('hiding it again clears the option', !('label' in ((await all()).layouts.Default['full.machine'][SLIDER].look || {})));
  await doneBtn(page).click();
  await page.waitForTimeout(100);
  ok('outside edit mode a bare card has no head and the field names itself once',
     await card(SLIDER).locator('.dash-head').count() === 0 && await card(SLIDER).locator('.field-label').count() === 1);
  await ctx.close();
}

// ---- the content floor (ph-e82.25) ----------------------------------------------------------
// The operator squeezed an action card (op, slot, name, four buttons) to one
// column: the controls spilled right of the frame and the title stacked one
// letter per line. A card is never sized below its measured content.
console.log('floor');
{
  const ACT = (CONTROLS.find((c) => c.key === 'role:action.store') || CONTROLS.find((c) => c.kind === 'field' && c.field.widget === WIDGET.action)).key;
  const NEST_TITLE = 'A nest title far longer than its card';
  const fix = {
    // Labels shown (ph-w4r makes a field bare by default): the title's one line is under test.
    [ACT]: { x: 0, y: 0, w: 1, h: 16, look: { label: true } },
    'nest:1': { x: 0, y: 18, w: 2, h: 8, nest: { title: NEST_TITLE, map: {} } },
  };
  const { ctx, page, cell, stored, said, card } = await open(fix, { edit: false });
  // Px any element of the body pokes past the body's frame; the title's lines.
  const fit = (key) => card(key).evaluate((c) => {
    const body = c.querySelector('.dash-body');
    const b = body.getBoundingClientRect();
    let out = 0;
    for (const e of body.querySelectorAll('*')) {
      const r = e.getBoundingClientRect();
      if (r.width && r.height && getComputedStyle(body).overflowX !== 'clip') out = Math.max(out, r.right - b.right, b.left - r.left);
    }
    const t = c.querySelector('.dash-title');
    return { out: Math.round(out), titleH: t.getBoundingClientRect().height, font: parseFloat(getComputedStyle(t).fontSize),
      clip: getComputedStyle(body).overflowX, cut: t.scrollWidth > t.clientWidth };
  });
  let s = await stored();
  ok('a saved rect under its floor never grows on load', s[ACT].w === 1 && s[ACT].h === 16 && s['nest:1'].w === 2, [s[ACT], s['nest:1']]);
  let f = await fit(ACT);
  ok('running, it clips at its frame: nothing spills', f.clip === 'clip' && f.out <= 0, f);
  ok('the title keeps one line', f.titleH < 2 * f.font, f);
  f = await fit('nest:1');
  ok('a long title truncates on one line', f.titleH < 2 * f.font && f.cut, f);
  await editBtn(page).click();
  await page.waitForSelector('.dash-toolbar');
  await page.locator('.dash-toolbar .palette-toggle').click();
  await page.waitForTimeout(200);
  let r = await redState(page, [ACT, 'nest:1']);
  ok('in edit mode both are red, below their minimum; Done is disabled', r.faults[ACT] === 'below its minimum' && r.faults['nest:1'] === 'below its minimum'
     && r.hint === '2 cards red, not saved' && r.done === true, r);
  await drag(page, card(ACT).locator('.edge-e'), 15 * cell, 0);
  r = await redState(page, [ACT, 'nest:1']);
  ok('a resize past its floor clears that card; the other still blocks the save', r.faults[ACT] === null && r.hint === '1 card red, not saved'
     && (await stored())[ACT].w === 1, [r, (await stored())[ACT]]);
  await drag(page, card('nest:1').locator(':scope > .dash-item > .edge-e'), 12 * cell, 0);
  r = await redState(page, [ACT, 'nest:1']);
  s = await stored();
  ok('the last red cleared: Done returns and the layout saves at once', r.hint === null && r.done === false && s[ACT].w === 16 && s['nest:1'].w === 14,
     [r, s[ACT], s['nest:1']]);
  await ctx.close();
}

// A shorter drag than the content trims it and draws red; the store keeps the last valid height.
{
  const ACT = (CONTROLS.find((c) => c.key === 'role:action.store') || CONTROLS.find((c) => c.kind === 'field' && c.field.widget === WIDGET.action)).key;
  const { ctx, page, cell, stored, card } = await open({ [ACT]: { x: 0, y: 0, w: 8, h: 16 } });
  const gh = await drag(page, card(ACT).locator('.edge-s'), 0, -12 * cell, () => ghost(page));
  ok('a shorter drag follows the pointer, no refusal', gh && !gh.refused && /^8 × [2-5]( · horizontal)?$/.test(gh.text), gh);
  ok('it is red and the store keeps 16 rows', (await redState(page, [ACT])).faults[ACT] === 'below its minimum' && (await stored())[ACT].h === 16);
  await ctx.close();
}

// ---- edit mode draws what runs (ph-wia, ph-w4r, ph-fhx, ph-9lu, ph-5rt, ph-r2m) -------------
console.log('modes');
{
  const DEPTH = (CONTROLS.find((c) => c.key === 'role:pattern.depth') || CONTROLS.find((c) => c.kind === 'field' && c.field.widget === WIDGET.slider
    && ![SLIDER, F1, F2, F3].includes(c.key))).key;
  const FMAX = CONTROLS.find((c) => c.key === SLIDER).field.max;
  for (const [w, h] of [[1920, 1080], [1280, 800]]) {
    const tag = w + 'x' + h + ': ';
    const { ctx, page, card, cell, stored } = await open({
      [SLIDER]: { x: 0, y: 0, w: 8, h: 3 },
      [DEPTH]: { x: 8, y: 0, w: 6, h: 6, look: { pres: 'knob', label: true } },
      [F2]: { x: 14, y: 0, w: 6, h: 4 },
      'hero:pattern': { x: 0, y: 7, w: 12, h: 8 },
      'nest:1': { x: 13, y: 7, w: 14, h: 6, nest: { title: 'Pump', map: { [F3]: { x: 0, y: 0, w: 6, h: 3 } } } },
    }, { w, h, edit: false });
    const geo = () => page.evaluate(() => {
      const g = document.querySelector('main.pane .home > .dash-wrap > .dash-grid');
      const r = (el, pad = 0) => { const b = el.getBoundingClientRect(); return [b.left + pad, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10); };
      return { grid: r(g, parseFloat(getComputedStyle(g).paddingLeft)), cards: Object.fromEntries([...g.querySelectorAll('.dash-cell')].map((c) => [c.dataset.id, r(c)])) };
    });
    const run = await geo();
    // Rows are cells (ph-29r): every card's box is its stored rect times the cell pitch.
    const s0 = await stored();
    const off = Object.keys(s0).filter((k) => k !== 'home:built' && run.cards[k]).filter((k) => {
      const [l, t, wd, ht] = run.cards[k], e = s0[k], near = (a, b) => Math.abs(a - b) <= 1;
      return !(near(l - run.grid[0], e.x * cell) && near(t - run.grid[1], e.y * cell) && near(wd, e.w * cell) && near(ht, e.h * cell));
    });
    ok(tag + 'every card is its cells: stored rect x cell pitch (ph-29r)', off.length === 0, off.map((k) => [k, s0[k], run.cards[k]]));
    const sub = await card('nest:1').locator('.nest-body .dash-grid').evaluate((g) => Number(g.style.getPropertyValue('--cols')));
    const m = s0['nest:1'].nest.map[F3];
    ok(tag + 'a nest member sits at its stored cells, on the top grid\'s columns (ph-nnl)', sub === s0['nest:1'].w
       && Math.abs(run.cards[F3][0] - run.grid[0] - (s0['nest:1'].x + m.x) * cell) <= 1 && Math.abs(run.cards[F3][2] - m.w * cell) <= 1,
       [sub, s0['nest:1'].w, m, run.cards[F3]]);
    await editBtn(page).click();
    await page.waitForTimeout(300);
    const edit = await geo();
    // Origin and width; the height may grow by the palette's reserve below the cards.
    ok(tag + 'edit mode keeps the grid origin', JSON.stringify(run.grid.slice(0, 3)) === JSON.stringify(edit.grid.slice(0, 3)), [run.grid, edit.grid]);
    const moved = Object.keys(run.cards).filter((k) => JSON.stringify(run.cards[k]) !== JSON.stringify(edit.cards[k]));
    ok(tag + 'every card, a nest member too, keeps its rect in edit mode', moved.length === 0 && Object.keys(run.cards).length === 6,
       moved.map((k) => [k, run.cards[k], edit.cards[k]]));
    ok(tag + 'the palette overlays the grid, out of flow', await page.$eval('main.pane .palette', (p) => getComputedStyle(p).position) === 'absolute');

    const tone = (v) => page.evaluate((x) => { const p = document.body.appendChild(document.createElement('i')); p.style.color = x;
      const c = getComputedStyle(p).color; p.remove(); return c; }, v);
    const [HL, WARN, MUT, LINE2, BAD] = [await tone('var(--highlight)'), await tone('var(--warn)'), await tone('var(--tx-mut)'), await tone('var(--line-2)'), await tone('var(--bad)')];
    const tools = await card(SLIDER).locator('.dash-head .ico').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.width, b.height]; }));
    ok(tag + 'edit tools are icon-sized (ph-fhx)', tools.length >= 2 && tools.every(([a, b]) => a <= 24.5 && b <= 24.5), tools);
    const cut = await card(DEPTH).locator('.dash-title').evaluate((t) => ({ cut: t.scrollWidth > t.clientWidth + 1, text: t.textContent.trim(), w: t.clientWidth }));
    ok(tag + 'a six-cell titled card (look, label, remove, grip) keeps its whole title in edit mode (ph-fhx)', !cut.cut, cut);

    // The look popover: no room taken, anchored to its card.
    const cardBox = () => card(SLIDER).evaluate((c) => { const b = c.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10); });
    await card(SLIDER).locator('.look-btn').click();
    await page.waitForTimeout(150);
    const pop = await card(SLIDER).evaluate((c) => {
      const p = c.querySelector('[data-look] [popover]'), r = p.getBoundingClientRect(), b = c.firstElementChild.getBoundingClientRect();
      return { open: p.matches(':popover-open'), dx: Math.round(r.left - b.left), dy: Math.round(r.top - b.top) };
    });
    ok(tag + 'the look opens as a popover anchored under its card\'s head', pop.open && Math.abs(pop.dx) <= 2 && pop.dy > 0 && pop.dy < 40, pop);
    ok(tag + 'an open look takes no room in its card', JSON.stringify(await cardBox()) === JSON.stringify(edit.cards[SLIDER]), [await cardBox(), edit.cards[SLIDER]]);
    const max = card(SLIDER).locator('input[aria-label^="Max of"]');
    await max.fill(String(FMAX * 10));
    await max.dispatchEvent('change');
    await page.waitForTimeout(120);
    const ref = await card(SLIDER).evaluate((c, warn) => {
      const p = c.querySelector('[data-look] [popover]'), msg = p.querySelector('.look-warn'), inp = p.querySelector('input[aria-label^="Max of"]');
      const cs = getComputedStyle(msg);
      return { text: msg.textContent.trim(), warn: cs.color === warn, line: msg.getBoundingClientRect().height < 2 * parseFloat(cs.fontSize),
        invalid: inp.getAttribute('aria-invalid'), border: getComputedStyle(inp).borderTopColor === warn, named: inp.getAttribute('aria-describedby') === msg.id,
        others: [...p.querySelectorAll('input[aria-invalid="true"]')].map((e) => e.getAttribute('aria-label').split(' ')[0]) };
    }, WARN);
    ok(tag + 'a refused look part reads in --warn, one line, on the inputs it names (ph-5rt)',
       /range must lie inside/.test(ref.text) && ref.warn && ref.line && ref.invalid === 'true' && ref.border && ref.named
       && JSON.stringify(ref.others) === '["Min","Max"]', ref);
    await page.keyboard.press('Escape');

    await card(SLIDER).locator('.handle.grab').click();
    await page.waitForTimeout(80);
    ok(tag + 'a selection is outlined in --highlight (ph-9lu)',
       await card(SLIDER).locator(':scope > .dash-item').evaluate((el) => getComputedStyle(el).outlineColor) === HL);
    await page.keyboard.press('Escape');

    await page.$$eval('main.pane .palette details', (els) => els.forEach((d) => { d.open = true; }));
    const tagTone = await page.$eval('main.pane .palette li[data-key^="safety:"] .palette-tag', (t) => [getComputedStyle(t).color, getComputedStyle(t).borderTopColor]);
    ok(tag + 'the strip tag is muted text on a quiet line, never red (ph-r2m)', tagTone[0] === MUT && tagTone[1] === LINE2 && !tagTone.includes(BAD), tagTone);
    await ctx.close();
  }
}

// ---- chrome: right-click add, a card body moves its card, no text selection, the footer over the shade (ph-cxvc) ----
console.log('chrome');
{
  const { ctx, page, cell, stored, card, grid } = await open({ [F1]: { x: 0, y: 0, w: 10, h: 8 }, [SLIDER]: { x: 14, y: 8, w: 12, h: 8 } }, { h: 700 });
  const gb = await grid.boundingBox();
  const gpad = await grid.evaluate((g) => parseFloat(getComputedStyle(g).paddingLeft));
  const px = gb.x + gpad + 14.5 * cell, py = gb.y + 2.5 * cell;
  await page.mouse.click(px, py, { button: 'right' });
  await page.waitForTimeout(150);
  const menu = page.locator('.palette.menu');
  const mb = await menu.boundingBox().catch(() => null);
  ok('right-click on the grid opens the add menu at the pointer', !!mb && Math.abs(mb.x - px) < 2 && Math.abs(mb.y - py) < 2, [mb, px, py]);
  ok('the menu lists what the palette lists', await menu.locator('li[data-key]').count() === await page.locator('.palette:not(.menu) li[data-key]').count()
     || await page.locator('.palette:not(.menu)').count() === 0);
  await menu.evaluate((m) => m.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await menu.locator('li[data-key="' + F2 + '"] > button').first().click();
  await page.waitForTimeout(400);
  let s = await stored();
  ok('a pick lands at the right-clicked cell, valid, and the menu closes', s[F2] && s[F2].x === 14 && s[F2].y === 2 && await menu.count() === 0
     && (await redState(page, [F2])).faults[F2] === null, [s[F2], await redState(page, [F2])]);
  await page.mouse.click(px, py + 20 * cell > gb.y + gb.height ? py : py + 20 * cell, { button: 'right' });
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  ok('Escape closes the menu', await menu.count() === 0);

  // (4) A press on the card's own surface that travels moves the card; a press on a control in it does not.
  // A point on the card's own surface: no control, no resize zone under it.
  const spot = await card(F1).locator(':scope > .dash-item > .dash-body').evaluate((b) => {
    const r = b.getBoundingClientRect();
    for (let y = r.top + 20; y < r.bottom - 20; y += 6) for (let x = r.left + 20; x < r.right - 20; x += 6) {
      const t = document.elementFromPoint(x, y);
      if (t && b.contains(t) && !t.closest('input, select, textarea, button, a, summary, [role=slider], [role=button], [role=switch], [tabindex="0"], .edge')) return { x, y };
    }
    return null;
  });
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x, spot.y + 12 * cell, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  s = await stored();
  ok('a drag on the card body moves the card', s[F1].x === 0 && s[F1].y === 12, s[F1]);
  // A control the pointer really reaches (a dual range's track is the card; its inputs are not).
  await card(SLIDER).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const sl = JSON.stringify((await stored())[SLIDER]);
  const hit = await card(SLIDER).locator(':scope > .dash-item > .dash-body').evaluate((b) => {
    for (const c of b.querySelectorAll('input, select, button, [role=slider], [role=switch]')) {
      const r = c.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (t && t.closest('input, select, button, [role=slider], [role=switch]')) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (hit) {
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x + 3 * cell, hit.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    ok('a press on a control in the card keeps it: the card stays', JSON.stringify((await stored())[SLIDER]) === sl, (await stored())[SLIDER]);
  } else ok('the field card holds a control to press', false);

  // (2) A drag across chrome selects no text; inputs stay selectable.
  const hint = await page.locator('.home .dash-toolbar .dash-hint').boundingBox();
  const pill = await page.locator('nav.rail .sub-layout[data-layout="Default"]').boundingBox();
  await page.mouse.move(pill.x + 4, pill.y + pill.height / 2);
  await page.mouse.down();
  await page.mouse.move(hint.x + hint.width - 2, hint.y + hint.height / 2, { steps: 10 });
  await page.mouse.up();
  const sel = await page.evaluate(() => [String(window.getSelection()), getComputedStyle(document.querySelector('.home .dash-toolbar')).userSelect,
    getComputedStyle(document.querySelector('.home .dash-head')).userSelect, getComputedStyle(document.querySelector('nav.rail')).userSelect,
    getComputedStyle(document.querySelector('.home .layout-json')).userSelect]);
  ok('a drag from a sidebar pill across cards to the footer selects no text; chrome is user-select none, inputs text',
     sel[0] === '' && sel[1] === 'none' && sel[2] === 'none' && sel[3] === 'none' && sel[4] === 'text', sel);

  // (3) The edit footer sits over the scroll shade and casts its own.
  await page.evaluate(() => document.querySelector('.home').closest('[data-shade]')?.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const foot = await page.evaluate(() => {
    const sc = document.querySelector('.home').closest('[data-shade]');
    const t = document.querySelector('.home .dash-toolbar');
    return { bottom: sc && sc.hasAttribute('data-shade-bottom'), shade: sc && Number(getComputedStyle(sc, '::after').zIndex),
      bar: Number(getComputedStyle(t).zIndex), cast: getComputedStyle(t).boxShadow };
  });
  ok('the footer stacks over the scroll shade and casts its own while the page scrolls on', foot.bottom && foot.bar > foot.shade && foot.cast !== 'none', foot);
  await ctx.close();
}

ok('no page errors', pageErrors.length === 0, pageErrors);
await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the builder grid edits as drawn.'));
process.exit(fails ? 1 : 0);
