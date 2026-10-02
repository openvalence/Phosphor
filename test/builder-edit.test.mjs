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
 *   select   grip click and Shift+click select; a marquee on empty grid
 *            selects what it crosses; a group moves as one; align left;
 *            duplicate a card (a second placement) and a nest (a copy);
 *            remove as a group, one undo step (ph-e82.20.3)
 *   nest     an empty nest says where controls go; the title edits in place
 *            (Enter commits, Escape restores); scroll/fixed in the bar; a
 *            collapsed nest packs two rows and keeps its height; a module's
 *            members are previewed, inert ones named, before Insert
 *            (ph-e82.20.4)
 *   keys     on a focused grip: Up/Down pass the card above or below in its
 *            columns, Left/Right nudge a cell, Shift+arrows resize, focus
 *            stays on the moved grip; Tab meets the grips in reading order;
 *            Enter opens the look picker; Delete removes (Ctrl+Z restores);
 *            Escape cancels a pointer drag with nothing written (ph-e82.20.5)
 *   layouts  a switch with changes since editing began asks Keep, Discard
 *            or Stay; a switch runs no animation on the grid; a layout
 *            exports as JSON and imports under a free name (ph-e82.20.6)
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

// ---- multi-select (ph-e82.20.3) --------------------------------------------------
console.log('select');
{
  const { ctx, page, cell, stored, said, card } = await open({
    [F1]: { x: 0, y: 0, w: 8, h: 2 }, [F2]: { x: 10, y: 0, w: 8, h: 2 }, [F3]: { x: 0, y: 2, w: 8, h: 2 },
    'nest:1': { x: 20, y: 0, w: 12, h: 4, nest: { title: 'Pump', scroll: false, map: { [SLIDER]: { x: 0, y: 0, w: 8, h: 2 } } } },
  });
  const grip = (key) => card(key).locator(':scope > .dash-item > .dash-head > .handle.grab');
  const pressed = async () => (await page.$$eval('.home > .dash-wrap > .dash-grid > .dash-cell', (els) => els
    .filter((c) => c.querySelector(':scope > .dash-item > .dash-head > .handle.grab')?.getAttribute('aria-pressed') === 'true')
    .map((c) => c.dataset.id))).sort();
  const selbar = () => page.locator('.home > .dash-wrap > .dash-selbar');
  await grip(F1).click();
  await grip(F2).click({ modifiers: ['Shift'] });
  ok('a grip click selects, Shift+click adds', JSON.stringify(await pressed()) === JSON.stringify([F1, F2].sort())
     && /2 selected/.test(await selbar().textContent()), await pressed());
  await drag(page, grip(F1), 3 * cell, 0);
  let s = await stored();
  ok('dragging one selected card moves the group as one', s[F1].x === 3 && s[F2].x === 13 && s[F1].y === 0 && s[F2].y === 0,
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
  ok('align left puts every selected card on one left edge', s[F1].x === 0 && s[F2].x === 0 && s[F3].x === 0, JSON.stringify([s[F1].x, s[F2].x, s[F3].x]));
  ok('aligned cards never overlap', new Set([F1, F2, F3].map((k) => s[k].y)).size === 3);

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
  await page.locator('.home .dash-toolbar .done-btn').click();
  ok('leaving edit mode clears the selection', await page.locator('.home .dash-selbar').count() === 0);
  await ctx.close();
}

// ---- nest header and module preview (ph-e82.20.4) ----------------------------------
console.log('nest');
{
  const GHOST = 'uid:999:not-on-this-machine';
  const store = { active: 'Default', layouts: { Default: { 'full.machine': {
    [F1]: { x: 0, y: 0, w: 8, h: 2 }, 'home:built': { x: 0, y: 40, w: 1, h: 1 },
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
  await nest.locator('.nest-bar button', { hasText: 'Scrolling' }).click();
  ok('scroll and fixed switch from the bar', (await stored())['nest:1'].nest.scroll === false
     && await nest.locator('.nest-bar button', { hasText: 'Fixed' }).getAttribute('aria-pressed') === 'false');
  await nest.locator('.nest-fold').click();
  await page.waitForTimeout(100);
  const folded = await nest.evaluate((el) => el.style.gridRow.replace(/\s+/g, ' '));
  ok('a collapsed nest packs two rows and keeps its own height', /span 2$/.test(folded) && (await stored())['nest:1'].h === 6
     && (await stored())['nest:1'].nest.collapsed === true, folded);
  ok('the fold button says what it does', await nest.locator('.nest-fold').getAttribute('aria-expanded') === 'false');
  await nest.locator('.nest-fold').click();

  await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
  await page.locator('select[aria-label="Module"]').selectOption('Kit');
  const rows = await page.$$eval('.module-preview li', (els) => els.map((e) => [e.textContent.trim(), e.classList.contains('inert')]));
  const sum = (await page.locator('.module-sum').textContent()).replace(/\s+/g, ' ').trim();
  ok('the module preview lists every member before Insert', rows.length === 2 && rows.some(([t, i]) => i && t.includes(GHOST)) && rows.some(([, i]) => !i), rows);
  ok('the preview counts what this view can draw', /^1 of 2 available here; the rest stay inert/.test(sum), sum);
  ok('nothing is placed by previewing', !Object.keys(await stored()).includes('nest:2'));
  await page.locator('.dash-menu button', { hasText: 'Insert' }).click();
  await page.waitForTimeout(150);
  ok('Insert places it with the live member drawn and the inert one kept', await card('nest:2').locator('.nest-body .dash-cell').count() === 1
     && Object.keys((await stored())['nest:2'].nest.map).includes(GHOST) && /1 of 2 members/.test(await said()), await said());
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---- keyboard (ph-e82.20.5) ----------------------------------------------------------
console.log('keys');
{
  const { ctx, page, cell, stored, said, card } = await open({
    [F1]: { x: 0, y: 0, w: 10, h: 2 }, [F2]: { x: 0, y: 2, w: 10, h: 2 }, [SLIDER]: { x: 12, y: 0, w: 10, h: 3 },
  });
  const grip = (key) => card(key).locator('.handle.grab');
  const focusedId = () => page.evaluate(() => document.activeElement?.closest('.dash-cell')?.dataset.id || null);
  await grip(F2).focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  let s = await stored();
  ok('ArrowUp passes the card above in its columns', s[F2].y === 0 && s[F1].y === 2, JSON.stringify([s[F1], s[F2]]));
  ok('focus stays on the moved grip', await focusedId() === F2 && await page.evaluate(() => document.activeElement.classList.contains('grab')));
  await page.keyboard.press('ArrowUp');
  ok('at the top it says so and moves nothing', /top of its columns/.test(await said()) && (await stored())[F2].y === 0, await said());
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  s = await stored();
  ok('ArrowDown passes the card below', s[F2].y === 2 && s[F1].y === 0, JSON.stringify([s[F1], s[F2]]));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(100);
  s = await stored();
  ok('ArrowRight nudges a cell, Shift+ArrowRight grows a cell', s[F2].x === 1 && s[F2].w === 11, JSON.stringify(s[F2]));

  const reading = Object.entries(await stored()).filter(([k, e]) => e && e.y != null && k !== 'home:built')
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([k]) => k);
  await page.locator('.home .dash-toolbar .done-btn').focus();
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
    Default: { 'full.machine': { [F1]: { x: 0, y: 0, w: 10, h: 2 }, ...built } },
    Night: { 'full.machine': { [F2]: { x: 4, y: 0, w: 12, h: 2 }, ...built } },
  } };
  const { ctx, page, said, card } = await open(null, { store });
  const all = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
  const picker = page.locator('.home .dash-toolbar select[aria-label="Layout"]');
  const bar = page.locator('.home .dash-switchbar');
  await card(F1).locator('.handle.grab').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  await picker.selectOption('Night');
  await page.waitForTimeout(100);
  ok('a switch with changes since editing began asks first', await bar.count() === 1 && (await all()).active === 'Default'
     && await picker.inputValue() === 'Default', await said());
  await bar.locator('button', { hasText: 'Stay' }).click();
  ok('Stay keeps the layout and its change', (await all()).active === 'Default' && (await all()).layouts.Default['full.machine'][F1].x === 1
     && await bar.count() === 0);
  await picker.selectOption('Night');
  await page.waitForTimeout(50);
  await bar.locator('button', { hasText: 'Discard and switch' }).click();
  const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.dash-grid')).length);
  const still = await page.$$eval('.home .dash-cell, .home .dash-item', (els) => els.every((e) => getComputedStyle(e).transitionDuration.split(',').every((d) => parseFloat(d) === 0)));
  await page.waitForTimeout(100);
  let s = await all();
  ok('Discard puts the old layout back and switches', s.active === 'Night' && s.layouts.Default['full.machine'][F1].x === 0
     && await card(F2).count() === 1 && await card(F1).count() === 0, JSON.stringify(s.layouts.Default['full.machine'][F1]));
  ok('a switch animates nothing on the grid (no transition, no animation)', moving === 0 && still, { moving, still });
  await picker.selectOption('Default');
  await page.waitForTimeout(100);
  ok('a switch with no changes goes at once', (await all()).active === 'Default' && await bar.count() === 0);

  await page.locator('.home .dash-toolbar button', { hasText: 'Layout…' }).click();
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

ok('no page errors', pageErrors.length === 0, pageErrors);
await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the builder grid edits as drawn.'));
process.exit(fails ? 1 : 0);
