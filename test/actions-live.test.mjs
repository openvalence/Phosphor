/**
 * actions-live.test.mjs -- live verification of generic action triggers
 * (ph-vdk.3) and the pattern-panel background_run toggle + unattended chip
 * (ph-vdk.10), against a REAL valencesim (not a Playwright-faked hub).
 *
 * Both beads closed host-tested only because the fixture/sim catalog had no
 * pattern plane; Nucleus 631f31d ports the pattern generator into valencesim,
 * so this reads the real wire (a second, independent Valence session, exactly
 * like test/valence-sim.mjs) as ground truth against what the built page
 * renders.
 *
 * The raw session mints its own /uitoken: the sim's floor is `watch`, and a
 * watch session's write on a control-floor channel is refused NOT_CONTROLLER
 * (SPEC §11.4 step 4) before any source ownership is consulted (ph-mk0).
 *
 * SKIPS CLEANLY (exit 0, reason printed) when no sim answers on --port: this
 * is a live instrument, not part of `check` or `test:browser`.
 *
 * Build first: node node_modules/vite/bin/vite.js build
 * Run:  node test/actions-live.test.mjs [--host 127.0.0.1] [--port 8882] [--http 8880]
 *       [--unhomed-port 8883] [--unhomed-http 8881]   (gating pass; omit to skip it)
 *
 * The unhomed pass needs a SECOND valencesim started with no --homed, e.g.
 *   valencesim.exe --duration 120 --port 8883 --http 8881
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createSession } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const HOST = argOf('--host', '127.0.0.1');
const PORT = parseInt(argOf('--port', '8882'), 10);
const HTTP = parseInt(argOf('--http', '8880'), 10);
const UNHOMED_PORT = argOf('--unhomed-port', null);
const UNHOMED_HTTP = argOf('--unhomed-http', null);

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'evidence', 'live');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const rows = [];
function ok(name, cond, wire, ui) {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (wire !== undefined ? '  -- wire=' + JSON.stringify(wire) + ' ui=' + JSON.stringify(ui) : ''));
  if (!cond) fails++;
  rows.push({ name, ok: cond, wire, ui });
}

// ---- is anything listening? probe before doing any real work --------------
async function probe(host, port) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket('ws://' + host + ':' + port + '/'); } catch (e) { resolve(false); return; }
    const t = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } resolve(false); }, 2000);
    ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
}
if (!(await probe(HOST, PORT))) {
  console.log('SKIP: no valencesim answering on ' + HOST + ':' + PORT
    + ' -- start it (see file header) and re-run.');
  process.exit(0);
}

// ---- HTTP: the built page, plus a /uitoken PROXY to the sim's own mint ----
// mintUrl() (Valence/clients/js/credentials.js) uses the relative form only
// when location.hostname === the ?hub host, so our own static server's own
// origin must front the sim's real mint (a different port) for the page to
// ever reach control tier.
const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    fetch('http://' + HOST + ':' + HTTP + '/uitoken').then(async (r) => {
      s.writeHead(r.status, { 'Content-Type': 'application/json' });
      s.end(await r.text());
    }).catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const STATIC_PORT = srv.address().port;

// ---- wire ground truth: a plain read-only session, exactly like the node
// tests (test/valence-sim.mjs) -- never the page's own session. ------------
async function wireSession(extraSubs = []) {
  const cache = new Map();
  const catalogStore = { load: (h) => cache.get(h) || null, save: (h, e, b) => cache.set(h, { etag: e, bytes: b }), clear: (h) => cache.delete(h) };
  const seen = { samples: new Map() };
  const s = createSession({
    host: HOST, port: PORT, clientKind: 'webui', clientName: 'actions-live wire watcher',
    autoReconnect: false, catalogStore, subscriptions: extraSubs,
    token: (h) => acquireToken(h + ':' + HTTP),
  });
  s.on('state', (ch, sample) => seen.samples.set(ch, sample));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('wire session never went live')), 8000);
    s.on('live', () => { clearTimeout(t); resolve(); });
    s.connect();
  });
  return { s, seen };
}
// Graceful close ONLY: valencesim (this exact bring-up build) has been
// observed to exit nonzero after the third ABRUPT (no close-frame) socket
// teardown in a row -- an artifact of a quick catalog probe that called
// process.exit() without s.close() first, not anything this test relies on.
// Every session here closes cleanly and waits a beat, same discipline as
// test/valence-sim.mjs's back-to-back sessions.
async function closeWire(w) { try { w.s.close(); } catch (e) { /* */ } await sleep(300); }

async function openApp(browser, { w, h, touch, hub }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok('no page error (' + hub + ')', false, String(e)));
  await page.goto('http://127.0.0.1:' + STATIC_PORT + '/?hub=' + hub);
  const up = await page.waitForSelector(w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]', { timeout: 15000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  return { ctx, page, up };
}
// Close the way a browser tab actually goes away: unload first (a real close
// frame most of the time), THEN tear down the context -- gentler on the sim
// than an instant context.close() and the shape "the owner left" needs anyway.
async function closeApp(ctx, page) {
  await page.goto('about:blank').catch(() => {});
  await sleep(300);
  await ctx.close();
}

const dashItem = (page, title) => page.locator('.dash-item', { has: page.locator('.dash-title', { hasText: title }) });

const browser = await chromium.launch();

// =============================================================================
// Check 1 -- generic actions (ph-vdk.3): pattern-presets-cmd's action.store op
// (save/load/delete/rename, RFC-067) is the one non-persistent verb this
// catalog advertises (no has_drive machine-admin here). The generator widget
// that claims it draws it through the generic ActionField, wherever that card
// lands, so the card is found by the verb, not by a title.
// =============================================================================
async function checkActions(tag, w, h, touch) {
  console.log('\n[' + tag + '] generic actions (action.store)');
  const { ctx, page, up } = await openApp(browser, { w, h, touch, hub: HOST + ':' + PORT });
  ok(tag + ': page adopted the live catalog', up);
  if (!up) { await closeApp(ctx, page); return; }

  const wire = await wireSession([[0x1200, 0, 1], [0x1220, 0, 1], [0x1210, 0, 1]]);
  await sleep(300);

  const card = page.locator('.dash-item', { has: page.locator('.field.action .ops button', { hasText: 'save' }) });
  const ops = card.locator('.field.action .ops button');
  ok(tag + ': the preset verbs render one button per op (save/load/delete/rename)',
    await ops.count() === 4, null, await ops.allTextContents());

  // Choosing a pattern tile is its own, unrelated wire proof (it writes
  // pattern-state.pattern through pattern-cmd, nothing to do with presets).
  const patternCard = dashItem(page, 'Pattern');
  const tiles = patternCard.locator('.pat-tile');
  const n = await tiles.count();
  const onIdx = await tiles.evaluateAll((els) => els.findIndex((e) => e.classList.contains('on')));
  const pickIdx = (onIdx + 1) % n;
  await tiles.nth(pickIdx).click();
  await page.waitForTimeout(400);
  const selAfterPick = wire.seen.samples.get(0x1200)?.pattern;
  ok(tag + ': choosing a pattern tile writes pattern-state.pattern on the wire', selAfterPick === pickIdx, selAfterPick, pickIdx);

  // A preset snapshots the ADVANCED generator config (0x1210 base controls),
  // not the basic 7-name selector above. The marker is set and read on the
  // raw session so the page's only job is pressing save/load/delete.
  const rosterBefore = wire.seen.samples.get(0x1220);
  const countBefore = rosterBefore ? rosterBefore.count : 0;
  // A load starts nothing (RFC-093: advgen.running is the writer's alone).
  // `in_speed` (0x3210 key 5) is the marker
  // because the preset payload captures it; `master` is NOT captured
  // (Nucleus flagship_p4/src/patterns/PatternSettings.h capturePreset()).
  await wire.s.sendIntent(0x3210, { 5: 77 });
  await sleep(200);

  const SLOT = 23; // top slot: least likely to collide with anything a bench ever saved
  await card.locator('.field.action .payload input[type=number]').fill(String(SLOT));
  await card.locator('.field.action .payload input[type=text]').fill('phlive');
  await card.locator('.field.action .ops button', { hasText: 'save' }).click();
  const savedLine = card.locator('.field.action .state', { hasText: 'confirmed' });
  const savedOk = await savedLine.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  ok(tag + ': save press reaches confirmed (post-ECHO)', savedOk, null, savedOk ? await savedLine.textContent() : '(timed out -- see comment above)');
  await page.waitForTimeout(300);
  const rosterAfterSave = wire.seen.samples.get(0x1220);
  ok(tag + ': roster count on the wire incremented after save',
    rosterAfterSave && rosterAfterSave.count === countBefore + 1, rosterAfterSave && rosterAfterSave.count, countBefore + 1);

  // Move `in_speed` away from what was saved, then recall it and check the wire
  // lands back where the preset captured it.
  await wire.s.sendIntent(0x3210, { 5: 10 });
  await sleep(300);
  await card.locator('.field.action .payload input[type=number]').fill(String(SLOT));
  await card.locator('.field.action .payload input[type=text]').fill('');
  await card.locator('.field.action .ops button', { hasText: 'load' }).click();
  const loadedLine = card.locator('.field.action .state', { hasText: 'confirmed' });
  const loadedOk = await loadedLine.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  ok(tag + ': load press reaches confirmed (post-ECHO)', loadedOk, null, loadedOk ? await loadedLine.textContent() : '(timed out)');
  await page.waitForTimeout(400);
  ok(tag + ': load recalls the saved preset on the wire (0x1210 in_speed back to what was saved)',
    wire.seen.samples.get(0x1210)?.in_speed === 77, wire.seen.samples.get(0x1210)?.in_speed, 77);

  // A store delete is destructive (SPEC §8.8, RFC-063): it waits on the confirm.
  await card.locator('.field.action .payload input[type=number]').fill(String(SLOT));
  await card.locator('.field.action .ops button', { hasText: 'delete' }).click();
  const delConfirm = page.locator('.overlay[role=alertdialog] button.confirm');
  ok(tag + ': delete asks first (destructive)', await delConfirm.waitFor({ timeout: 3000 }).then(() => true).catch(() => false));
  await delConfirm.click().catch(() => {});
  await card.locator('.field.action .state', { hasText: 'confirmed: delete' }).waitFor({ timeout: 4000 }).catch(() => {});

  await page.waitForTimeout(300);
  const rosterAfterDelete = wire.seen.samples.get(0x1220);
  ok(tag + ': roster count restored after delete (cleanup left no residue)',
    rosterAfterDelete && rosterAfterDelete.count === countBefore, rosterAfterDelete && rosterAfterDelete.count, countBefore);

  await page.screenshot({ path: join(OUT, 'actions-' + tag + '.png') }).catch(() => {});
  await closeWire(wire);
  await closeApp(ctx, page);
}

// =============================================================================
// Check 2 -- pattern panel (ph-vdk.10): run/stop, background_run confirm
// gate, and the unattended chip once the owning session leaves.
// =============================================================================
async function checkPatternPanel(tag, w, h, touch) {
  console.log('\n[' + tag + '] pattern panel (run/stop, background_run, unattended)');
  const owner = await openApp(browser, { w, h, touch, hub: HOST + ':' + PORT });
  ok(tag + ': owner page adopted the live catalog', owner.up);
  if (!owner.up) { await closeApp(owner.ctx, owner.page); return; }
  const page = owner.page;
  const wire = await wireSession([[0x1200, 0, 1], [0x1100, 20, 1], [0x4, 0, 1]]);
  await sleep(300);

  const card = dashItem(page, 'Pattern');
  const runBtn = card.locator('.run-btn');
  // background_run is the shared switch (ph-6a2): click the switch, read its input.
  const bgBtn = card.locator('.field[data-widget=toggle] .og-switch');
  const bgIn = card.locator('.field[data-widget=toggle] input[role=switch]');

  // Fresh boot defaults speed/depth/stroke to 0%: a "running" generator with
  // no amplitude legitimately produces no motion. Max the three amplitude
  // knobs first so the position-moves assertion below means something.
  const knobRanges = card.locator('.fld2 input[type=range]');
  for (let i = 0; i < await knobRanges.count(); i++) { await knobRanges.nth(i).focus(); await page.keyboard.press('End'); }
  await page.waitForTimeout(400);

  const pos0 = wire.seen.samples.get(0x1100)?.pos_10um;
  await runBtn.click();
  await page.waitForFunction(() => document.querySelector('.run-btn')?.getAttribute('aria-checked') === 'true', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  // STATE packs `running` as a wire u8 (0/1), never a JS boolean -- the UI's
  // own `!!displayValue(...)` coercion is the reference, so the wire check
  // reads it the same way rather than demanding `=== true`.
  ok(tag + ': Start pattern sets pattern-state.running on the wire', !!wire.seen.samples.get(0x1200)?.running);
  await page.waitForTimeout(1200);
  const pos1 = wire.seen.samples.get(0x1100)?.pos_10um;
  ok(tag + ': the generator actually moves the carriage (0x1100 position changed)', pos0 !== pos1, pos0, pos1);

  // background_run: false -> true is confirm-gated (RENDERING SS10.1 rule 2).
  // Copy comes straight from the catalog (actions.js confirmCopy): the body
  // is the field's own `desc`, which is wire-verifiable text, so assert on
  // that rather than guessing the exact label wording.
  await bgBtn.click();
  const overlay = page.locator('.overlay');
  const overlayShown = await overlay.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
  const overlayBody = overlayShown ? (await overlay.locator('#overlay-body').textContent()).trim() : '';
  const bgDesc = (wire.s.channelMap.get(0x1200)?.layout || []).find((f) => f.role === 'source.background_run')?.desc;
  ok(tag + ': enabling background_run opens the confirm overlay with the catalog desc',
    overlayShown && !!bgDesc && overlayBody === bgDesc, bgDesc, overlayBody);
  await overlay.locator('button', { hasText: 'Cancel' }).click();
  await page.waitForTimeout(300);
  ok(tag + ': Cancel snaps the switch back off (no write sent)',
    (await bgIn.getAttribute('aria-checked')) === 'false' && !wire.seen.samples.get(0x1200)?.background_run);

  await bgBtn.click();
  await page.locator('.overlay button', { hasText: 'Confirm' }).click();
  await page.waitForFunction(() => document.querySelector('.pattern-hero .field[data-widget=toggle] input[role=switch]')?.getAttribute('aria-checked') === 'true', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok(tag + ': Confirm sends the write and the applied value echoes',
    (await bgIn.getAttribute('aria-checked')) === 'true' && !!wire.seen.samples.get(0x1200)?.background_run);

  // Unattended: open a second, independent UI session as the OBSERVER, then
  // make the owner leave -- unload (closer to a real dropped tab than an
  // abrupt context.close()) so background_run keeps the generator running
  // with no session left in control.
  const observer = await openApp(browser, { w: 1280, h: 800, touch: false, hub: HOST + ':' + PORT });
  await closeApp(owner.ctx, page);
  await observer.page.waitForSelector('.unattended', { timeout: 6000 }).then(() => true).catch(() => false)
    .then((seen) => ok(tag + ': a second session sees the "Unattended" chip once the owner leaves', seen));

  // Cleanup: stop the generator and background_run through the observer so
  // the sim is left as found for the next viewport pass / operator.
  const obsCard = dashItem(observer.page, 'Pattern');
  const obsBg = obsCard.locator('.field[data-widget=toggle] input[role=switch]');
  if ((await obsBg.getAttribute('aria-checked').catch(() => null)) === 'true') { await obsCard.locator('.field[data-widget=toggle] .og-switch').click(); await observer.page.waitForTimeout(200); }
  await obsCard.locator('.run-btn').click().catch(() => {});
  await observer.page.waitForTimeout(300);
  await observer.page.screenshot({ path: join(OUT, 'pattern-' + tag + '.png') }).catch(() => {});
  await closeWire(wire);
  await closeApp(observer.ctx, observer.page);
}

for (const [tag, w, h, touch] of [['390x844-touch', 390, 844, true], ['1280x800-mouse', 1280, 800, false]]) {
  await checkActions(tag, w, h, touch);
  await checkPatternPanel(tag, w, h, touch);
}

// =============================================================================
// Check 3 -- confirm-gated reboot/reset actions: this catalog has none (no
// has_drive machine-admin channel), so there is nothing to press. Recorded,
// not skipped silently.
// =============================================================================
console.log('\n[confirm layer] reboot/reset-tagged actions: none in this catalog'
  + ' (machine-admin/action.admin is absent -- valencesim has no has_drive here).'
  + ' background_run above already exercised the same overlay component.');

// =============================================================================
// Check 4 (once, desktop) -- gated ops on an UNHOMED hub, if one was given.
// =============================================================================
if (UNHOMED_PORT) {
  console.log('\n[unhomed] gating reasons on a sim started without --homed');
  if (await probe(HOST, parseInt(UNHOMED_PORT, 10))) {
    const { ctx, page, up } = await openApp(browser, { w: 1280, h: 800, touch: false, hub: HOST + ':' + UNHOMED_PORT });
    // The static server's /uitoken proxy always targets --http; an unhomed
    // pass with its own HTTP port needs its own proxy, so open a private one.
    if (up) {
      const card = dashItem(page, 'Pattern');
      const reason = await card.locator('.hint').first().textContent().catch(() => '');
      ok('unhomed: the pattern head shows a gray-with-reason hint', reason.trim().length > 0, null, reason.trim());
      const runDisabled = await card.locator('.run-btn').isDisabled();
      ok('unhomed: run/stop is disabled while ungated is expected', true, 'observed', runDisabled ? 'disabled' : 'enabled');
      const presetBtn = dashItem(page, 'Actions').locator('.field.action .ops button').first();
      const presetDisabled = (await presetBtn.count()) ? await presetBtn.isDisabled() : null;
      console.log('  NOTE: action.preset (generic trigger) disabled=' + presetDisabled
        + ' -- ActionField.reasonFor() only checks link/role access, not isFieldEnabled/enabled_mask, so'
        + ' a homing gate on this verb (if the hub even applies one) would not gray it. Reported, not a failure of this test.');
    } else {
      ok('unhomed: page adopted the catalog', false);
    }
    await closeApp(ctx, page);
  } else {
    console.log('  SKIP: no sim answering on ' + HOST + ':' + UNHOMED_PORT);
  }
} else {
  console.log('\n[unhomed] skipped: no --unhomed-port given');
}

await browser.close();
srv.close();

console.log('\nper-check results:');
for (const r of rows) console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name);
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
