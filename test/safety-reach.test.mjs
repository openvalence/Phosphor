/**
 * safety-reach.test.mjs -- is the stop reachable everywhere, whatever the hub?
 *
 * RENDERING §13 law 1 (stop reachable at every rank on every class) and law 12
 * (touch-target floor, reduced motion), measured on the rendered page with no
 * hub: the same Playwright WebSocket route and etag-cache seeding as
 * test/responsive-matrix.mjs, reduced to what the safety region needs (WELCOME,
 * GRANT, PONG, two safety-events edges) plus a small model of the hub's safety
 * latch: each safety-intents op is ECHOed and the 0x0003 snapshot it implies
 * is published, so a control's state is always the hub's (law 4).
 *
 * Two catalogs: the recorded valencesim fixture (claims the rail hero), and the
 * same fixture with every window.min / window.max role stripped (claims NO
 * hero, the unannotated-hub case of ph-vdk.1). At 360x800, 844x390, 1280x720
 * and 1920x1080, each with a mouse and with touch, it asserts:
 *   strip    exactly one e-stop and one pause control in the top strip, each
 *            visible, enabled, on screen, not covered, at least --tap
 *   hero     no-hero catalog: no hero slot rendered (the case is real)
 * At 1280x720, both catalogs: every home module deleted, the strip pair stays
 * (ph-e82.5).
 * Once, at 1280x720 and 360x800:
 *   motion   prefers-reduced-motion: no transition or animation on the pair
 *   edge     the latest safety edge renders with its unread count, opens the
 *            Safety feed and clears the count; the e-stop fires; a dropped
 *            link takes the status slot in words, and back live the edge
 *            reads stale (ph-e82.17: one slot, by priority)
 *   fire     pressing the strip e-stop puts a safety frame on the wire
 * ph-e82.12 (RFC-085), at 1280x720 mouse and 360x800 touch:
 *   label    WELCOME without identity key 6, or with it false: Halt; true: E-Stop
 *   pair     pause sends pause, reads Resume, sends resume; the e-stop latches,
 *            reads Halted, two quick taps and a 1 s hold send nothing, a press
 *            held past 3 s sends release, which lands in pause
 * ph-vdk.41 (RFC-085), at 1280x720:
 *   override the strip carries one Override/Return control beside Home while
 *            a rail is mounted, absent with no rail and on a hub whose op
 *            table lacks override (law 7); paused without override the jog
 *            tape is disabled with its reason on its own label line;
 *            Override confirms, sends override, reads Return, and the tape
 *            jogs over the whole travel; Return sends return_op, no gate
 * ph-vdk.43 (RFC-088), on glance, handheld and full:
 *   flip     a catalog tagging axis.flipped gets one Flip toggle in the top
 *            strip beside Override (ph-e82.21; in the Home popover where the
 *            strip is short), an icon with no text whose state is in its
 *            tooltip; every press confirms first, Cancel sends nothing, and
 *            the hub's NACK reason (SOURCE_CONFLICT) is shown in the
 *            toggle's tooltip and in the strip's refusal surface
 * ph-e82.21, at 1280x720 and 360x800:
 *   home     the snapshot's home_required pulses a red hazard border on the
 *            one Home control (static under reduced motion) until it
 *            clears; no Fix button in the status slot; Force Home is never
 *            inline, only in the Home popover
 * ph-e82.21, at 1280x720:
 *   owner    a foreign-owned control-owner pair: with the hub's source
 *            labels the plan strip reads the owner and a SOURCE_CONFLICT
 *            reads "rail owned by" it; without labels, "plan" and the code
 *   axis     axis.flipped draws the rail reversed: the carriage marker for
 *            travel minus p sits where p sat unflipped, the endcaps swap,
 *            and a tape tap writes the value the reversed axis gives; Flip
 *            reads |-> normal and <-| flipped (ph-vdk.60.13), one chip
 *            width in both states and while a write waits
 * Then ph-vdk.14: out-of-order and post-wrap seq_of_state edges are marked
 * superseded by SPEC §7.3 serial arithmetic and skipped by the strip summary.
 *
 * Build first (`npm run build:only`). Run: node test/safety-reach.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { cbMap, cbArray, cbInt, cbF32, cbTstr, cbBstr, cbBool, cbNull, cbUint, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { decodeCatalog, encodePacked } from '../../Valence/clients/js/catalog.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS, NACK } from '../../Valence/clients/js/frames.js';
import { catalogEtag, toHex } from '../../Valence/clients/js/sha256.js';
import { CORE_CHANNEL, SAFETY_EVENT_KIND, SAFETY_OP } from '../../Valence/clients/js/generated/registry_vocab.js';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const FIXTURE = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));

// ---- the no-hero catalog: strip the rail's window roles, re-encode ---------
// Wire floats are f32 only and map keys are ints, so this round-trips to a
// catalog that decodes identically apart from the dropped roles (`drop`).
const STRIP = new Set(['window.min', 'window.max']);
let stripped = 0;
function enc(v, drop = new Set()) {
  if (v instanceof Map) {
    const pairs = [];
    for (const [k, x] of v) {
      if (k === 13 && drop.has(x)) { stripped++; continue; }
      pairs.push([k, enc(x, drop)]);
    }
    return cbMap(pairs.sort((a, b) => a[0] - b[0]));
  }
  if (Array.isArray(v)) return cbArray(v.map((x) => enc(x, drop)));
  if (v instanceof Uint8Array) return cbBstr(v);
  if (typeof v === 'string') return cbTstr(v);
  if (typeof v === 'boolean') return cbBool(v);
  if (v == null) return cbNull();
  return Number.isInteger(v) ? cbInt(v) : cbF32(v);
}
const NO_HERO = enc(cbDecodeFull(FIXTURE), STRIP);
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
// SPEC §11.1 snapshot: word (bit0 ESTOP, bit3 PAUSE) at byte 0, modes (bit0
// override) at 8. Override carries pause; an e-stop drops override; return
// lands in plain pause.
const PAUSE_BIT = 0x08;
const LATCH = {
  [SAFETY_OP.estop]: (s) => { s.word |= 1; s.modes &= ~1; },
  [SAFETY_OP.release]: (s) => { s.word = (s.word & ~1) | PAUSE_BIT; },
  [SAFETY_OP.pause]: (s) => { s.word |= PAUSE_BIT; },
  [SAFETY_OP.resume]: (s) => { s.word &= ~PAUSE_BIT; },
  [SAFETY_OP.override]: (s) => { s.word |= PAUSE_BIT; s.modes |= 1; },
  [SAFETY_OP.return_op]: (s) => { s.modes &= ~1; },
};
const snapshot = (s) => Uint8Array.of(s.word, 0, 0, 0, 0, 0, 0, 0, s.modes);
function hubFor(cat, wire) {
  return (ws) => {
    wire.socket = ws;
    const send = (type, ch, payload) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload))); } catch (e) { /* closed */ } };
    ws.onMessage((msg) => {
      if (typeof msg === 'string') return;
      for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
        wire.seen.push({ type: header.type, channel: header.channel });
        if (header.type === FRAME.HELLO) {
          const identity = [[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('Safety fixture')]];
          if (wire.cutsPower != null) identity.push([IDENTITY_K.estop_cuts_power, cbBool(wire.cutsPower)]);
          send(FRAME.WELCOME, 0, cbMap([
            [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
            [K.catalog_etag, cbBstr(cat.etag)], [K.cfg_gen, cbUint(1)],
            [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
              [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
            [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
            [K.identity, cbMap(identity)],
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
          for (const [ch, p] of Object.entries(wire.states || {})) send(FRAME.STATE, Number(ch), p);
        } else if (header.type === FRAME.INTENT && header.channel === CORE_CHANNEL.safety_intents) {
          const m = cbDecodeFull(payload);
          const op = m.get(K.value).get(1);
          wire.ops.push(op);
          send(FRAME.ECHO, header.channel, cbMap([[K.cfg_gen, cbUint(1)], [K.intent_id, cbUint(m.get(K.intent_id))],
            [K.applied, cbMap([[1, cbUint(op)]])]]));
          if (LATCH[op]) {
            LATCH[op](wire.latch);
            send(FRAME.STATE, CORE_CHANNEL.safety, snapshot(wire.latch));
          }
        } else if (header.type === FRAME.INTENT) {
          // Any other write: the hub refuses it as a busy rail would (SPEC §9.6).
          wire.writes.push(header.channel);
          wire.values.push([...cbDecodeFull(payload).get(K.value).values()][0]);
          send(FRAME.NACK, header.channel, cbMap([[K.code, cbUint(NACK.SOURCE_CONFLICT)],
            [K.detail, cbTstr('a source owns the rail')], [K.intent_id, cbUint(cbDecodeFull(payload).get(K.intent_id))]]));
        } else if (header.type === FRAME.PING) {
          send(FRAME.PONG, header.channel, payload);
        }
      }
    });
  };
}

async function open(browser, { w, h, touch, catalog, reducedMotion = 'no-preference', edges = false, cutsPower = null,
  states = null }) {
  const cat = CATALOGS[catalog];
  const wire = { seen: [], ops: [], writes: [], values: [], latch: { word: 0, modes: 0 }, socket: null, edges, cutsPower, states };
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
  return {
    tap,
    heroes: document.querySelectorAll('.hero-slot').length,
    counts: [document.querySelectorAll('.topstrip .btn-estop').length, document.querySelectorAll('.topstrip .btn-pause').length],
    estop: box(document.querySelector('.topstrip .btn-estop')),
    pause: box(document.querySelector('.topstrip .btn-pause')),
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
      ok(tag + ': exactly one e-stop and one pause control in the strip', m.counts.join() === '1,1', m.counts.join());
      for (const [name, b] of [['e-stop', m.estop], ['pause', m.pause]]) {
        ok(tag + ': strip ' + name + ' shown, enabled, on screen, uncovered',
          !!b && b.shown && !b.disabled && b.onScreen && b.uncovered, b && JSON.stringify(b));
        ok(tag + ': strip ' + name + ' >= --tap (' + m.tap.toFixed(1) + ')',
          !!b && b.w >= m.tap - 0.5 && b.h >= m.tap - 0.5, size(b));
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
  for (const [name, b] of [['e-stop', m.estop], ['pause', m.pause]]) {
    ok(catalog + ': empty home: strip ' + name + ' shown, enabled, on screen, uncovered, >= --tap',
      !!b && b.shown && !b.disabled && b.onScreen && b.uncovered && b.w >= m.tap - 0.5 && b.h >= m.tap - 0.5, b && JSON.stringify(b));
  }
  await ctx.close();
}

// ---- reduced motion ---------------------------------------------------------
{
  const { ctx, page } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'hero', reducedMotion: 'reduce' });
  const m = await page.evaluate(measurePair);
  for (const [name, b] of [['strip e-stop', m.estop], ['strip pause', m.pause]]) {
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
  const rows = await page.locator('.logpane .feed.active .line').count();
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
  // The hub was released meanwhile: the reconnect adopts a clear latch, so
  // the slot falls through to the edge.
  wire.latch = { word: 0, modes: 0 };
  wire.states = { ...(wire.states || {}), [CORE_CHANNEL.safety]: snapshot(wire.latch) };
  const down = page.waitForSelector('.strip .status[data-kind=fault]', { timeout: 3000 }).then(() => true).catch(() => false);
  if (wire.socket) await wire.socket.close();
  ok(tag + ': the dropped link takes the status slot in words', await down
    && /no hub link/.test(await page.locator('.strip .status').textContent()));
  await line.waitFor({ timeout: 8000 }).catch(() => {});
  const stale = await line.evaluate((el) => el.classList.contains('stale') && /stale/.test(el.textContent)
    && parseFloat(getComputedStyle(el).opacity) < 1).catch(() => false);
  ok(tag + ': back live, the edge dims and says stale', stale);
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
  const rows = page.locator('.logpane .feed.active .line');
  ok('reconciliation: the feed holds both edges', await rows.count() === 2, String(await rows.count()));
  const supersededRows = page.locator('.logpane .feed.active .line.superseded');
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
  const diagLine = page.locator('.logpane .feed.active .line.diag');
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
  const flags = await page.locator('.logpane .feed.active .line')
    .evaluateAll((els) => els.map((el) => el.classList.contains('superseded')));
  ok('wrap: only the edge behind the wrapped seq is superseded',
    JSON.stringify(flags) === '[false,false,true]', JSON.stringify(flags));
  const summary = await page.locator('.topstrip .evline').textContent();
  ok('wrap: the strip summarizes the post-wrap edge', /estop cleared/.test(summary), JSON.stringify(summary.trim()));
  await ctx.close();
}

// ---- ph-e82.12: the label follows estop_cuts_power (law 15) -----------------
for (const [cutsPower, want, why] of [[null, 'Halt', 'no key 6'], [false, 'Halt', 'key 6 false'], [true, 'E-Stop', 'key 6 true']]) {
  const { ctx, page, up } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'none', cutsPower });
  const label = up ? (await page.locator('.topstrip .btn-estop .lbl').textContent()).trim() : '';
  ok('label: ' + why + ' renders ' + want, label === want, JSON.stringify(label));
  await ctx.close();
}

// ---- ph-e82.12: each pair is one control; release is a 3 s hold -------------
for (const [w, h, touch] of [[1280, 720, false], [360, 800, true]]) {
  const tag = w + 'x' + h + (touch ? ' touch' : ' mouse');
  const { ctx, page, wire } = await open(browser, { w, h, touch, catalog: 'none', cutsPower: true });
  const estop = page.locator('.topstrip .btn-estop');
  const pause = page.locator('.topstrip .btn-pause');
  const lbl = async (l) => (await l.locator('.lbl').textContent()).trim();
  const settle = () => page.waitForTimeout(300);
  // A held press: real mouse buttons, or pointer events for a touch screen.
  const hold = async (ms) => {
    if (!touch) {
      await estop.hover();
      await page.mouse.down();
      await page.waitForTimeout(ms);
      await page.mouse.up();
    } else {
      await estop.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
      await page.waitForTimeout(ms);
      await estop.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
      await estop.dispatchEvent('click');
    }
    await settle();
  };

  await pause.click(); await settle();
  ok(tag + ': pause sends pause and reads Resume', wire.ops.join() === String(SAFETY_OP.pause) && await lbl(pause) === 'Resume',
    wire.ops.join() + ' / ' + await lbl(pause));
  await pause.click(); await settle();
  ok(tag + ': a second press sends resume, no gate', wire.ops.at(-1) === SAFETY_OP.resume && await lbl(pause) === 'Pause',
    wire.ops.join());

  await estop.click(); await settle();
  ok(tag + ': the e-stop latches and reads Halted', wire.ops.at(-1) === SAFETY_OP.estop && await lbl(estop) === 'Halted',
    wire.ops.join() + ' / ' + await lbl(estop));
  // Law 13: red is the e-stop's alone; the write ladder's faults moved to amber (ph-xec).
  const red = await estop.evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--bad)';
    document.body.append(probe);
    const bad = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(el).borderTopColor === bad && getComputedStyle(el.querySelector('.lbl')).color === bad;
  });
  ok(tag + ': the latched e-stop still wears --bad red', red);
  const n = wire.ops.length;
  await estop.click(); await estop.click(); await settle();
  ok(tag + ': two quick taps on Halted send nothing', wire.ops.length === n, wire.ops.slice(n).join());
  await hold(1000);
  ok(tag + ': a 1 s hold sends nothing', wire.ops.length === n && await lbl(estop) === 'Halted', wire.ops.slice(n).join());
  await hold(3300);
  ok(tag + ': a hold past 3 s sends release once, and nothing after it',
    wire.ops.slice(n).join() === String(SAFETY_OP.release), wire.ops.slice(n).join());
  ok(tag + ': release lands in pause (E-Stop, Resume)', await lbl(estop) === 'E-Stop' && await lbl(pause) === 'Resume',
    await lbl(estop) + ' / ' + await lbl(pause));
  await ctx.close();
}

// ---- ph-vdk.41: override/return on the rail row; jog only where the hub takes it --
{
  // A hub whose op table stops before override (no rail control, SPEC §11.1).
  const SHORT_OPS = (() => {
    const m = cbDecodeFull(FIXTURE);
    const op = m.find((e) => e.get(1) === CORE_CHANNEL.safety_intents).get(9).get(1);
    op.set(10, op.get(10).slice(0, SAFETY_OP.override));
    op.set(17, op.get(17).slice(0, SAFETY_OP.override));
    return enc(m);
  })();
  CATALOGS.short = { bytes: SHORT_OPS, etag: catalogEtag(SHORT_OPS, LIMITS.etag_bytes) };
  for (const [catalog, why, rails] of [['none', 'no rail', 0], ['short', 'no override op', 1]]) {
    const { ctx, page, up } = await open(browser, { w: 1280, h: 720, touch: false, catalog });
    ok('override: declines with ' + why, up && await page.locator('.rail-hero').count() === rails
      && await page.locator('.btn-override').count() === 0);
    await ctx.close();
  }

  const { ctx, page, wire } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'hero' });
  const ovr = page.locator('.topstrip .dock .ovr .btn-override');
  const tape = page.locator('.rail-hero .rail-tape-track');
  const lbl = async () => (await ovr.locator('.lbl').textContent()).trim();
  ok('override: one control in the strip, beside Home', await ovr.count() === 1
    && await page.locator('.topstrip .dock button.home-btn', { hasText: /home/i }).count() === 1);
  ok('override: unpaused, the tape takes a plain point move', await tape.getAttribute('aria-disabled') === 'false');
  await page.locator('.topstrip .btn-pause').click();
  await page.waitForTimeout(300);
  const reason = (await page.locator('.rail-hero .rail-reason').textContent().catch(() => '')).trim();
  ok('override: paused without override, the jog is disabled with its reason',
    await tape.getAttribute('aria-disabled') === 'true' && /Override to jog/.test(reason), reason);
  const n = wire.ops.length;
  await ovr.click();
  await page.waitForTimeout(200);
  ok('override: confirm-gated, nothing sent before the confirm', wire.ops.length === n
    && await page.locator('.overlay.hazard[role=alertdialog]').count() === 1);
  await page.locator('.overlay.hazard .og-btn.danger').click();
  await page.waitForTimeout(300);
  ok('override: sends override and reads Return', wire.ops.at(-1) === SAFETY_OP.override && await lbl() === 'Return',
    wire.ops.slice(n).join() + ' / ' + await lbl());
  ok('override: the tape is a jog over the whole travel',
    await tape.getAttribute('aria-disabled') === 'false'
    && /jog . travel/.test(await page.locator('.rail-hero .rail-tape-mode').textContent()));
  await ovr.click();
  await page.waitForTimeout(300);
  ok('override: Return sends return_op with no gate and lands in plain pause',
    wire.ops.at(-1) === SAFETY_OP.return_op && await lbl() === 'Override'
    && await tape.getAttribute('aria-disabled') === 'true', wire.ops.slice(n).join());
  await ctx.close();
}

// ---- ph-vdk.43: Flip on the rail row, confirm-gated, refusals in the hub's words --
{
  // The fixture's machine-modes channel tags axis.flipped (RFC-088). Its
  // snapshot: every byte 0 (not flipped) but the enabled mask.
  const flipCh = cbDecodeFull(FIXTURE).find((e) => (e.get(8) || []).some((f) => f.get(13) === 'axis.flipped'));
  const states = { [flipCh.get(1)]: Uint8Array.from(flipCh.get(8), (f) => (f.get(13) === 'meta.enabled_mask' ? 0xff : 0)) };
  for (const [w, h, touch, cls] of [[1280, 720, false, 'full'], [360, 800, true, 'handheld'], [220, 480, true, 'glance']]) {
    const { ctx, page, wire, up } = await open(browser, { w, h, touch, catalog: 'hero', states });
    const flip = page.locator('.topstrip .rw-flip');
    // Short of width, Flip rides the Home popover: open it first.
    const reach = async () => {
      if (!await flip.count() && await page.locator('.topstrip button.home-btn').count()) await page.locator('.topstrip button.home-btn').click();
      return flip;
    };
    const n = up ? await (await reach()).count() : 0;
    ok(cls + ': one Flip toggle in the strip', n === 1 && await page.locator('.rail-hero .rw-flip').count() === 0, n + ' found');
    if (n !== 1) { await ctx.close(); continue; }
    ok(cls + ': Flip is an icon, no text, its state in the tooltip', await flip.locator('svg path').count() === 1
      && (await flip.textContent()).trim() === '' && await flip.getAttribute('title') === 'Normal: home at left'
      && await flip.getAttribute('aria-pressed') === 'false', await flip.getAttribute('title'));
    await flip.click();
    await page.waitForTimeout(200);
    const asked = await page.locator('.overlay.hazard[role=alertdialog]').count() === 1;
    await page.locator('.overlay.hazard .og-btn').first().click();
    await page.waitForTimeout(300);
    ok(cls + ': a press asks first; Cancel sends nothing', asked && wire.writes.length === 0, wire.writes.join());
    await (await reach()).click();
    await page.waitForTimeout(200);
    await page.locator('.overlay.hazard .og-btn.danger').click();
    await page.waitForTimeout(600);
    const text = (await (await reach()).getAttribute('title')).trim();
    const banner = (await page.locator('.topstrip .recovery').textContent().catch(() => '')).trim();
    ok(cls + ': confirmed, the write goes out and the hub refusal is shown in its words',
      wire.writes.length === 1 && /SOURCE_CONFLICT/.test(text) && /SOURCE_CONFLICT/.test(banner),
      JSON.stringify([text, banner]));
    ok(cls + ': a refused flip still reads off', await flip.getAttribute('aria-pressed') === 'false');
    await ctx.close();
  }
}

// ---- ph-e82.21: home required pulses the one Home control ---------------------
for (const [w, h, touch, motion] of [[1280, 720, false, 'no-preference'], [360, 800, true, 'reduce']]) {
  const tag = w + 'x' + h + (motion === 'reduce' ? ' reduced motion' : '');
  const { ctx, page, wire } = await open(browser, { w, h, touch, catalog: 'hero', reducedMotion: motion });
  const home = page.locator('.topstrip .dock button.home-btn, .topstrip .dock .ops button').first();
  const look = () => home.evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--bad)';
    document.body.append(probe);
    const bad = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { hazard: el.classList.contains('hazard'), red: cs.borderTopColor === bad, anim: cs.animationName };
  });
  const latch = (modes) => wire.socket.send(Buffer.from(encodeFrame(FRAME.STATE, CORE_CHANNEL.safety, Uint8Array.of(0x08, 0, 0, 0, 0, 0, 0, 0, modes))));
  ok(tag + ': at rest the Home control is not a hazard', !(await look()).hazard);
  latch(0x02);
  await page.waitForTimeout(300);
  const on = await look();
  ok(tag + ': home_required pulses a red border on Home' + (motion === 'reduce' ? ' (static)' : ''),
    on.hazard && on.red && (motion === 'reduce' ? on.anim === 'none' : on.anim !== 'none'), JSON.stringify(on));
  ok(tag + ': no Fix button, Force Home never inline', await page.locator('.topstrip .status button', { hasText: /fix/i }).count() === 0
    && await page.locator('.topstrip .dock > .ops button', { hasText: /force/i }).count() === 0);
  latch(0);
  await page.waitForTimeout(300);
  ok(tag + ': a completed home clears the pulse', !(await look()).hazard);
  await ctx.close();
}

// ---- ph-e82.21: the rail's owner by the hub's own source labels -------------
// A snapshot of one channel, by role: every other field 0 (the enabled mask
// 0xff, so a setting is writable).
const ENTRIES = decodeCatalog(FIXTURE);
const byRole = (role) => ENTRIES.find((e) => (e.layout || []).some((f) => f.role === role));
function stateOf(e, roles) {
  const v = {};
  for (const f of e.layout) v[f.name] = f.role === 'meta.enabled_mask' ? 0xff : (roles[f.role] ?? 0);
  return encodePacked(v, e.layout);
}
const OWNER = Uint8Array.of(0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 99, 0, 0, 0, 3, 0, 0, 0, 0);   // pair 2 owned by session 99
const SOURCES = ['Manual', 'Stream', 'Pattern', 'Other'];
// Both cases built from the fixture, whichever the recording carries: the
// source fields' options (key 10) set, or dropped.
const withSources = (labels) => {
  const m = cbDecodeFull(FIXTURE);
  for (const f of m.find((e) => e.get(1) === CORE_CHANNEL.control_owner).get(8)) {
    if (!/^src/.test(f.get(1))) continue;
    if (labels) f.set(10, labels); else f.delete(10);
  }
  return enc(m);
};
for (const [k, bytes] of [['labeled', withSources(SOURCES)], ['unlabeled', withSources(null)]]) {
  CATALOGS[k] = { bytes, etag: catalogEtag(bytes, LIMITS.etag_bytes) };
}
{
  const flipE = byRole('axis.flipped'), planE = byRole('plan.current');
  const states = { [flipE.id]: stateOf(flipE, {}), [planE.id]: stateOf(planE, {}), [CORE_CHANNEL.control_owner]: OWNER };
  for (const [catalog, plan, refusal] of [['unlabeled', /^plan/, /SOURCE_CONFLICT/], ['labeled', /^Pattern/, /rail owned by Pattern/]]) {
    const { ctx, page } = await open(browser, { w: 1280, h: 720, touch: false, catalog, states });
    const mode = (await page.locator('.rail-swap .plan-mode').textContent({ timeout: 5000 }).catch(() => '')).trim();
    ok('owner (' + catalog + '): the plan strip names the owner from the labels, else "plan"', plan.test(mode), JSON.stringify(mode));
    await page.locator('.topstrip .rw-flip').click();
    await page.locator('.overlay.hazard .og-btn.danger').click();
    await page.waitForTimeout(600);
    const banner = (await page.locator('.topstrip .recovery').textContent().catch(() => '')).trim();
    ok('owner (' + catalog + '): a SOURCE_CONFLICT names the owner from the labels, else the code', refusal.test(banner), JSON.stringify(banner));
    await ctx.close();
  }
}

// ---- ph-e82.21: a flipped axis draws reversed --------------------------------
{
  const flipE = byRole('axis.flipped'), posE = byRole('telemetry.position'), cfgE = byRole('window.min');
  const T = 500, P = 150;
  const cfg = stateOf(cfgE, { 'window.min': 0, 'window.max': T, 'geometry.max_travel': T, 'geometry.measured_travel': T });
  const seen = {};
  for (const flipped of [0, 1]) {
    const states = { [flipE.id]: stateOf(flipE, { 'axis.flipped': flipped }), [cfgE.id]: cfg };
    const { ctx, page, wire } = await open(browser, { w: 1280, h: 720, touch: false, catalog: 'hero', states });
    // The hub reports travel minus position while flipped (RFC-088).
    const pos = stateOf(posE, { 'telemetry.position': flipped ? T - P : P });
    const tick = setInterval(() => { try { wire.socket.send(Buffer.from(encodeFrame(FRAME.STATE, posE.id, pos))); } catch (e) { /* closed */ } }, 30);
    await page.evaluate(() => { window.__railProbe = []; });
    await page.waitForTimeout(800);
    const x = await page.evaluate(() => { const p = window.__railProbe.filter((f) => f[4] && f[5] != null); return p.length ? p.at(-1)[5] : null; });
    clearInterval(tick);
    const caps = await page.locator('.rail-endcap').allTextContents();
    const chip = page.locator('.topstrip .rw-flip');
    const face = { title: await chip.getAttribute('title'), d: await chip.locator('svg path').getAttribute('d'),
      text: (await chip.textContent()).trim(), w: (await chip.boundingBox()).width };
    const strip = await page.locator('.rail-hero .rail-tape').boundingBox();
    await page.mouse.click(strip.x + strip.width * 0.25, strip.y + strip.height / 2);
    await page.waitForTimeout(400);
    const sent = wire.values.at(-1);
    // A write in flight dims the icon in the same box.
    await chip.click();
    await page.locator('.overlay.hazard .og-btn.danger').click();
    face.waitW = await chip.evaluate((el) => (el.dataset.shadow === 'pending' || el.dataset.shadow === 'overdue' || el.dataset.shadow === 'fault'
      ? el.getBoundingClientRect().width : null));
    seen[flipped] = { x, caps: caps.map((c) => c.trim()), sent, face };
    await ctx.close();
  }
  ok('axis: the marker for travel minus p sits where p sat unflipped', seen[0].x != null && Math.abs(seen[1].x - seen[0].x) < 1,
    JSON.stringify(seen));
  ok('axis: flipped, the endcaps read travel then 0', seen[0].caps.join() === [...seen[1].caps].reverse().join()
    && parseFloat(seen[1].caps[0]) > parseFloat(seen[1].caps[1]), JSON.stringify([seen[0].caps, seen[1].caps]));
  // The bar is home's end: left normal (|->), right flipped (<-|).
  const [n, f] = [seen[0].face, seen[1].face];
  ok('flip icon: normal is a bar at left, arrow right; flipped a bar at right, arrow left',
    /^M3 3v10/.test(n.d) && /l3 3-3 3$/.test(n.d) && /^M13 3v10/.test(f.d) && /L2 8l3 3$/.test(f.d), JSON.stringify([n.d, f.d]));
  ok('flip icon: no text, the state in words in the tooltip', !n.text && !f.text
    && n.title === 'Normal: home at left' && f.title === 'Flipped: home at right', JSON.stringify([n.title, f.title]));
  ok('flip icon: one chip width normal, flipped and waiting', n.w === f.w && [n.waitW, f.waitW].every((v) => v == null || v === n.w),
    JSON.stringify([n.w, f.w, n.waitW, f.waitW]));
  // Wire units are the move field's own scale: compare the two taps' ratio.
  ok('axis: a tap a quarter in writes the reversed axis value (3x the unflipped)', seen[0].sent > 0 && Math.abs(seen[1].sent / seen[0].sent - 3) < 0.02,
    JSON.stringify([seen[0].sent, seen[1].sent]));
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the stop is reachable at every size, with or without a hero.'));
process.exit(fails ? 1 : 0);
