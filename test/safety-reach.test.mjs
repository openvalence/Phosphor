/**
 * safety-reach.test.mjs -- is the stop reachable everywhere, whatever the hub?
 *
 * RENDERING §13 law 1 (stop reachable at every rank on every class) and law 12
 * (touch-target floor, reduced motion), measured on the rendered page with no
 * hub: the same Playwright WebSocket route and etag-cache seeding as
 * test/responsive-matrix.mjs, reduced to what the safety region needs (WELCOME,
 * GRANT, PONG, and two safety-events edges). No STATE is sent: nothing asserted
 * here reads a value.
 *
 * Two catalogs: the recorded valencesim fixture (claims the rail hero, so the
 * hero row carries TransportBar), and the same fixture with every window.min /
 * window.max role stripped (claims NO hero, the unannotated-hub case of
 * ph-vdk.1). At 360x800, 844x390, 1280x720 and 1920x1080, each with a mouse and
 * with touch, it asserts:
 *   strip    the top strip's e-stop and stop are visible, enabled, on screen, not
 *            covered, and at least --tap in both axes
 *   hero     no-hero catalog: no hero slot rendered (the case is real)
 *   row      hero catalog, desktop: the hero row's stop/e-stop also >= --tap
 * At 1280x720, both catalogs: every home module deleted, the strip pair stays
 * (ph-e82.5).
 * Once, at 1280x720 and 360x800:
 *   motion   prefers-reduced-motion: no transition or animation on the pair
 *   edge     the latest safety edge renders with its unread count, opens the
 *            Safety feed, clears the count, and dims once the link drops
 *   fire     pressing the strip e-stop puts a safety frame on the wire
 * Then ph-vdk.14: out-of-order and post-wrap seq_of_state edges are marked
 * superseded by SPEC §7.3 serial arithmetic and skipped by the strip summary.
 *
 * Build first (`npm run build:only`). Run: node test/safety-reach.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { cbMap, cbArray, cbInt, cbF32, cbTstr, cbBstr, cbBool, cbNull, cbUint, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS } from '../../Valence/clients/js/frames.js';
import { catalogEtag, toHex } from '../../Valence/clients/js/sha256.js';
import { CORE_CHANNEL, SAFETY_EVENT_KIND } from '../../Valence/clients/js/generated/registry_vocab.js';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const FIXTURE = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));

// ---- the no-hero catalog: strip the rail's window roles, re-encode ---------
// Wire floats are f32 only and map keys are ints, so this round-trips to a
// catalog that decodes identically apart from the dropped roles.
const STRIP = new Set(['window.min', 'window.max']);
let stripped = 0;
function enc(v) {
  if (v instanceof Map) {
    const pairs = [];
    for (const [k, x] of v) {
      if (k === 13 && STRIP.has(x)) { stripped++; continue; }
      pairs.push([k, enc(x)]);
    }
    return cbMap(pairs);
  }
  if (Array.isArray(v)) return cbArray(v.map(enc));
  if (v instanceof Uint8Array) return cbBstr(v);
  if (typeof v === 'string') return cbTstr(v);
  if (typeof v === 'boolean') return cbBool(v);
  if (v == null) return cbNull();
  return Number.isInteger(v) ? cbInt(v) : cbF32(v);
}
const NO_HERO = enc(cbDecodeFull(FIXTURE));
const CATALOGS = {
  hero: { bytes: FIXTURE, etag: catalogEtag(FIXTURE, LIMITS.etag_bytes) },
  none: { bytes: NO_HERO, etag: catalogEtag(NO_HERO, LIMITS.etag_bytes) },
};

// ---- HTTP: the bundle, plus a /uitoken mint so the session is control tier --
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- the fake hub ---------------------------------------------------------
// `seq` is the registry-global seq_of_state (34) when given -- ph-vdk.14's
// reconciliation key, distinct from the device-schema body fields below it.
function safetyEdge(kind, word, seq) {
  const top = [[K.event_kind, cbUint(kind)]];
  if (seq != null) top.push([K.seq_of_state, cbUint(seq)]);
  top.push([K.body, cbMap([[1, cbUint(word)], [2, cbUint(1)], [3, cbUint(7)], [4, cbUint(1)]])]);
  return cbMap(top);
}
function hubFor(cat, wire) {
  return (ws) => {
    wire.socket = ws;
    const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
    ws.onMessage((msg) => {
      if (typeof msg === 'string') return;
      for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
        wire.seen.push({ type: header.type, channel: header.channel });
        if (header.type === FRAME.HELLO) {
          send(FRAME.WELCOME, 0, cbMap([
            [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
            [K.catalog_etag, cbBstr(cat.etag)], [K.cfg_gen, cbUint(1)],
            [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
              [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
            [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
            [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
              [IDENTITY_K.hub_name, cbTstr('Safety fixture')]])],
          ]));
        } else if (header.type === FRAME.SUBSCRIBE) {
          const m = cbDecodeFull(payload);
          const grants = [];
          for (const w of m.get(K.subscriptions) || []) {
            const ch = w.get(K.channel_id);
            grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
              [K.channel_id, cbUint(ch)]]));
            if (ch === CORE_CHANNEL.safety_events && wire.edges) {
              send(FRAME.EVENT, ch, safetyEdge(SAFETY_EVENT_KIND.estop_latched, 1));
              send(FRAME.EVENT, ch, safetyEdge(SAFETY_EVENT_KIND.estop_cleared, 0));
            }
          }
          send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
        } else if (header.type === FRAME.PING) {
          send(FRAME.PONG, header.channel, payload);
        }
      }
    });
  };
}

async function open(browser, { w, h, touch, catalog, reducedMotion = 'no-preference', edges = false }) {
  const cat = CATALOGS[catalog];
  const wire = { seen: [], socket: null, edges };
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: false, reducedMotion });
  await ctx.addInitScript(([etag, bytes]) => {
    try {
      localStorage.clear();
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
    } catch (e) { /* no storage: the boot assertion reports it */ }
  }, [toHex(cat.etag), toHex(cat.bytes)]);
  await ctx.routeWebSocket(/:82\//, hubFor(cat, wire));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok('no page error', false, String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  const up = await page.waitForSelector(w >= 960 ? 'nav.rail [role=tab]' : 'nav.tabs [role=tab]', { timeout: 15000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  return { ctx, page, wire, up };
}

// ---- in-page measurement --------------------------------------------------
function measurePair() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;height:var(--tap);width:1px';
  document.body.appendChild(probe);
  const tap = probe.getBoundingClientRect().height;
  probe.remove();
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      w: r.width, h: r.height, disabled: el.disabled,
      shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0,
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
      uncovered: !!hit && el.contains(hit),
      transition: cs.transitionDuration, animation: cs.animationName,
    };
  };
  const row = (sel) => [...document.querySelectorAll('.transportbar ' + sel)].find((b) => getComputedStyle(b).display !== 'none') || null;
  return {
    tap,
    heroes: document.querySelectorAll('.hero-slot').length,
    estop: box(document.querySelector('.topstrip .btn-estop')),
    stop: box(document.querySelector('.topstrip .btn-stop')),
    rowEstop: box(row('.btn-estop')),
    rowStop: box(row('.btn-stop')),
  };
}

let fails = 0;
function ok(n, c, extra) {
  console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : ''));
  if (!c) fails++;
}
const size = (b) => b ? Math.round(b.w) + 'x' + Math.round(b.h) : 'absent';

console.log('no-hero catalog: ' + stripped + ' window roles stripped, ' + NO_HERO.length + ' B');
ok('the no-hero catalog really dropped the rail roles', stripped === 2);

const browser = await chromium.launch();
const SIZES = [[360, 800], [844, 390], [1280, 720], [1920, 1080]];

for (const catalog of ['none', 'hero']) {
  for (const [w, h] of SIZES) {
    for (const touch of [false, true]) {
      const tag = catalog + ' ' + w + 'x' + h + (touch ? ' touch' : ' mouse');
      const { ctx, page, up } = await open(browser, { w, h, touch, catalog });
      ok(tag + ': catalog adopted', up);
      if (!up) { await ctx.close(); continue; }
      const m = await page.evaluate(measurePair);
      if (catalog === 'none') ok(tag + ': no hero claims', m.heroes === 0, m.heroes + ' hero slot(s)');
      for (const [name, b] of [['e-stop', m.estop], ['stop', m.stop]]) {
        ok(tag + ': strip ' + name + ' shown, enabled, on screen, uncovered',
          !!b && b.shown && !b.disabled && b.onScreen && b.uncovered, b && JSON.stringify(b));
        ok(tag + ': strip ' + name + ' >= --tap (' + m.tap.toFixed(1) + ')',
          !!b && b.w >= m.tap - 0.5 && b.h >= m.tap - 0.5, size(b));
      }
      if (catalog === 'hero' && w >= 960) {
        for (const [name, b] of [['e-stop', m.rowEstop], ['stop', m.rowStop]]) {
          ok(tag + ': hero-row ' + name + ' >= --tap', !!b && b.w >= m.tap - 0.5 && b.h >= m.tap - 0.5, size(b));
        }
      }
      await ctx.close();
    }
  }
}

// ---- ph-e82.5: an emptied home still leaves the strip's stop pair ------------
for (const catalog of ['none', 'hero']) {
  const { ctx, page } = await open(browser, { w: 1280, h: 720, touch: false, catalog });
  await page.locator('.home .dash-toolbar button', { hasText: 'Edit layout' }).click();
  for (let i = 0; i < 20 && await page.locator('.home .home-remove').count(); i++) {
    await page.locator('.home .home-remove').first().click();
  }
  const left = await page.locator('.home .dash-cell').count();
  ok(catalog + ': every home module deleted', left === 0, left + ' left');
  const m = await page.evaluate(measurePair);
  for (const [name, b] of [['e-stop', m.estop], ['stop', m.stop]]) {
    ok(catalog + ': empty home: strip ' + name + ' shown, enabled, on screen, uncovered, >= --tap',
      !!b && b.shown && !b.disabled && b.onScreen && b.uncovered && b.w >= m.tap - 0.5 && b.h >= m.tap - 0.5, b && JSON.stringify(b));
  }
  await ctx.close();
}

// ---- reduced motion ---------------------------------------------------------
{
  const { ctx, page } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'hero', reducedMotion: 'reduce' });
  const m = await page.evaluate(measurePair);
  for (const [name, b] of [['strip e-stop', m.estop], ['strip stop', m.stop], ['row e-stop', m.rowEstop], ['row stop', m.rowStop]]) {
    ok('reduced motion: ' + name + ' has no transition or animation',
      !!b && /^0s(, 0s)*$/.test(b.transition) && b.animation === 'none', b && (b.transition + ' / ' + b.animation));
  }
  await ctx.close();
}

// ---- the latest safety edge, and firing the e-stop ------------------------
for (const [w, h, touch] of [[1280, 720, false], [360, 800, true]]) {
  const tag = w + 'x' + h;
  const { ctx, page, wire } = await open(browser, { w, h, touch, catalog: 'none', edges: true });
  const line = page.locator('.topstrip .evline');
  const text = await line.textContent({ timeout: 5000 }).catch(() => '');
  ok(tag + ': strip shows the latest edge with its unread count',
    /estop cleared/.test(text) && /\d+ s ago/.test(text) && /2 new/.test(text), JSON.stringify(text.trim()));
  await line.click();
  await page.waitForTimeout(300);
  const sel = await page.locator('.logpane [role=tab][aria-selected=true]').textContent().catch(() => '');
  ok(tag + ': the edge opens the Safety feed', /Safety/.test(sel), JSON.stringify(sel.trim()));
  const rows = await page.locator('.logpane .feed .line').count();
  ok(tag + ': the feed holds both edges', rows === 2, rows + ' row(s)');
  const after = await line.textContent();
  ok(tag + ': viewing the feed clears the unread count', !/new/.test(after), JSON.stringify(after.trim()));

  const before = wire.seen.length;
  await page.locator('.topstrip .btn-estop').click();
  await page.waitForTimeout(300);
  const fired = wire.seen.slice(before).some((f) => f.type === FRAME.ESTOP
    || (f.type === FRAME.INTENT && f.channel === CORE_CHANNEL.safety_intents));
  ok(tag + ': the strip e-stop puts a safety frame on the wire', fired);

  await page.evaluate(() => { document.querySelectorAll('.content').forEach((c) => { c.scrollTop = 0; }); });
  wire.edges = false;   // a reconnect must not re-send them as fresh edges
  if (wire.socket) await wire.socket.close();
  await page.waitForTimeout(800);
  const stale = await line.evaluate((el) => el.classList.contains('stale') && /stale/.test(el.textContent)
    && parseFloat(getComputedStyle(el).opacity) < 1);
  ok(tag + ': the edge dims and says stale once the link drops', stale);
  await ctx.close();
}

// ---- ph-vdk.14: safety-events reconciled against the 0x0003 latch ---------
{
  const { ctx, page, wire } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'none' });
  const send = (type, ch, payload) => { try { wire.socket.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };

  // Two edges delivered in ARRIVAL order but out of SEQ order: a resend or a
  // relay hop can still land a stale edge after a fresher one.
  send(FRAME.EVENT, CORE_CHANNEL.safety_events, safetyEdge(SAFETY_EVENT_KIND.estop_latched, 1, 5));
  await page.waitForTimeout(150);
  send(FRAME.EVENT, CORE_CHANNEL.safety_events, safetyEdge(SAFETY_EVENT_KIND.estop_cleared, 0, 3));
  await page.waitForTimeout(150);
  await page.click('.topstrip .evline');
  await page.waitForTimeout(150);
  const rows = page.locator('.logpane .feed .line');
  ok('reconciliation: the feed holds both edges', await rows.count() === 2, String(await rows.count()));
  const supersededRows = page.locator('.logpane .feed .line.superseded');
  ok('reconciliation: the older-seq edge is marked superseded', await supersededRows.count() === 1, String(await supersededRows.count()));
  const acceptedText = await rows.nth(0).textContent();
  ok('reconciliation: the higher-seq edge (received first) is not superseded',
    !(await rows.nth(0).evaluate((el) => el.classList.contains('superseded'))), acceptedText.trim());
  const summary = await page.locator('.topstrip .evline').textContent();
  ok('reconciliation: the strip summarizes the newest seq, not the last arrival',
    /estop latched/.test(summary) && !/cleared/.test(summary), JSON.stringify(summary.trim()));

  // The latch changes -- two different 9-byte `safety` STATE snapshots, the
  // second an adoption baseline that will not count as a real value change,
  // the third and fourth what the bead means by a transition -- with no
  // matching edge on 0x000E at all: a diagnostic, never a fabricated event.
  send(FRAME.STATE, CORE_CHANNEL.safety, new Uint8Array(9));
  await page.waitForTimeout(100);
  send(FRAME.STATE, CORE_CHANNEL.safety, new Uint8Array(9).fill(1));
  await page.waitForTimeout(600);
  const diagLine = page.locator('.logpane .feed .line.diag');
  const diagText = await diagLine.textContent().catch(() => '');
  ok('reconciliation: a latch change with no edge shows the diagnostic line',
    /latch changed, no event received/.test(diagText), JSON.stringify(diagText.trim()));
  await ctx.close();
}

// ---- ph-vdk.14: seq_of_state is a u16 compared by SPEC §7.3 serial arithmetic
{
  const { ctx, page, wire } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'none' });
  const send = (seq, kind, word) => wire.socket.send(Buffer.from(encodeFrame(FRAME.EVENT, CORE_CHANNEL.safety_events,
    safetyEdge(kind, word, seq))));
  send(65534, SAFETY_EVENT_KIND.estop_latched, 1);
  await page.waitForTimeout(150);
  send(1, SAFETY_EVENT_KIND.estop_cleared, 0);       // newer across the wrap
  await page.waitForTimeout(150);
  send(65533, SAFETY_EVENT_KIND.estop_latched, 1);   // older than both
  await page.waitForTimeout(150);
  await page.click('.topstrip .evline');
  await page.waitForTimeout(150);
  const flags = await page.locator('.logpane .feed .line')
    .evaluateAll((els) => els.map((el) => el.classList.contains('superseded')));
  ok('wrap: only the edge behind the wrapped seq is superseded',
    JSON.stringify(flags) === '[false,false,true]', JSON.stringify(flags));
  const summary = await page.locator('.topstrip .evline').textContent();
  ok('wrap: the strip summarizes the post-wrap edge', /estop cleared/.test(summary), JSON.stringify(summary.trim()));
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the stop is reachable at every size, with or without a hero.'));
process.exit(fails ? 1 : 0);
