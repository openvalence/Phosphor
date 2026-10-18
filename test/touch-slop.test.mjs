/**
 * touch-slop.test.mjs -- the touch-intent rule (DESIGN 10.13, Touch) on the
 * built app at 390x844 with touch emulation, against a fake hub that counts
 * every INTENT: a vertical swipe that starts on a slider, the stroke window,
 * a knob and the Flip switch scrolls the pane and writes nothing; a sideways
 * drag on a slider moves it from where it was; a tap on a slider's track
 * writes nothing; Flip toggles on a clean tap; Halt fires on its tap; a mouse
 * wheel over a slider scrolls the page and writes nothing.
 *
 * Deliberately NOT part of `npm run check` (it launches a browser).
 * Build first (`npm run build:only`). Run: node test/touch-slop.test.mjs
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS, CH_SAFETY_INTENTS } from '../../Valence/clients/js/frames.js';
import { STORE_KEY } from '../src/model/grid.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/neutrino-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);

const HTML = readFileSync(DIST_HTML);
const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- the fake hub: STATE from the catalog, INTENT echoed now or held ----------
const hub = { mode: 'echo', held: [], values: {}, log: [] };
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
      hub.log.push({ type: header.type, ch: header.channel });
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
const writes = () => hub.log.filter((f) => f.type === FRAME.INTENT && f.ch !== CH_SAFETY_INTENTS).length;
const safety = () => hub.log.filter((f) => f.type === FRAME.INTENT && f.ch === CH_SAFETY_INTENTS).length;

// A knob exists on a built home only, the full class (a phone's home is the seed): it is tested on a
// touch laptop, a stored home holding the knob above the advanced generator (so the document scrolls).
const KNOB = 'uid:4144:home_speed';
const store = { active: 'Default', modules: {}, layouts: { Default: { 'full.machine': {
  [KNOB]: { x: 0, y: 0, w: 6, h: 6, look: { pres: 'knob' } },
  'hero:advanced-generator': { x: 0, y: 6, w: 20, h: 80 },
  'home:built': { x: 0, y: 200, w: 1, h: 1 },
} } } };

const browser = await chromium.launch();
async function open({ w, h, mobile, home }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  await ctx.addInitScript(([etag, bytes, k, v]) => {
    try {
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      if (v) localStorage.setItem(k, v);
    } catch (e) { /* none */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), STORE_KEY, home ? JSON.stringify(home) : '']);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/');
  await page.waitForSelector('.dash-grid input[type=range]:not([disabled])', { timeout: 15000 });
  await sleep(800);
  // Raw touches through the browser's input pipeline (gesture detection, scrolling, touch-action).
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}
const pageErrors = [];
let { page, cdp } = await open({ w: 390, h: 844, mobile: true });
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
async function swipe(x, y, dx, dy, { n = 14, ms = 16, sample = null } = {}) {
  const seen = [];
  await touch('touchStart', x, y);
  if (sample) seen.push(await sample());
  for (let i = 1; i <= n; i++) {
    await touch('touchMove', x + (dx * i) / n, y + (dy * i) / n);
    await sleep(ms);
    if (sample) seen.push(await sample());
  }
  await touch('touchEnd');
  await sleep(250);
  return seen;
}
const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(40); await touch('touchEnd'); await sleep(250); };
// The scroll offset of the document and every pane in it (the phone scrolls the document, the desktop its pane).
const scrollY = () => page.evaluate(() => window.scrollY + [...document.querySelectorAll('*')].reduce((a, el) => a + el.scrollTop, 0));
const scrollTo = async (y) => {
  await page.evaluate((v) => { window.scrollTo(0, v); for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0; }, y);
  await sleep(150);
};
// An element brought to the middle of the screen; its box after.
async function center(sel) {
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(200);
  return page.locator(sel).first().boundingBox();
}
const SLIDER = '.dash-cell[data-id="hero:advanced-generator"] input[type=range]:not([disabled])';
const KNOBSEL = '.dash-cell[data-id="' + KNOB + '"] .knob';
const value = (sel) => page.locator(sel).first().evaluate((el) => (el instanceof HTMLInputElement ? el.value : el.getAttribute('aria-valuenow')));
const fracOf = (sel) => page.locator(sel).first().evaluate((el) => (el.value - el.min) / (el.max - el.min));
const confirmOpen = () => page.locator('[role=alertdialog] .og-btn.confirm').isVisible().catch(() => false);

console.log('\n[a vertical swipe that starts on a control scrolls and writes nothing]');
for (const [name, at] of [['slider thumb', (f) => f], ['slider track', (f) => (f > 0.5 ? 0.1 : 0.9)]]) {
  const b = await center(SLIDER);
  const v0 = await value(SLIDER), w0 = writes(), y0 = await scrollY();
  const f = at(await fracOf(SLIDER));
  await swipe(b.x + 8 + f * (b.width - 16), b.y + b.height / 2, 0, -240);
  ok(name + ': the page scrolled', (await scrollY()) > y0 + 100, [y0, await scrollY()]);
  ok(name + ': value unchanged, nothing written', (await value(SLIDER)) === v0 && writes() === w0, [v0, await value(SLIDER), writes() - w0]);
}
// The strip's stroke window and Flip, at the top of the document, swiped up.
for (const [name, sel, read] of [['stroke window', '.rail-band', () => value('.rail-band')], ['Flip', '.rw-flip', confirmOpen]]) {
  await scrollTo(0);
  const b = await page.locator(sel).boundingBox();
  const v0 = await read(), w0 = writes();
  await swipe(b.x + b.width / 2, b.y + b.height / 2, 0, -200);
  ok(name + ': the page scrolled', (await scrollY()) > 100, await scrollY());
  ok(name + ': unchanged, nothing written' + (name === 'Flip' ? ', no confirm' : ''), (await read()) === v0 && writes() === w0, [v0, await read(), writes() - w0]);
}

console.log('\n[a sideways drag adjusts from where the value was]');
{
  const b = await center(SLIDER);
  const el = page.locator(SLIDER).first();
  const { min, max, v } = await el.evaluate((x) => ({ min: +x.min, max: +x.max, v: +x.value }));
  // Started on the track away from the thumb: the value must not jump to the finger.
  const frac = (v - min) / (max - min);
  const x0 = b.x + (frac > 0.5 ? 0.15 : 0.55) * b.width;
  const w0 = writes();
  const seen = await swipe(x0, b.y + b.height / 2, 80, 0, { n: 16, sample: () => el.evaluate((x) => +x.value) });
  const after = await el.evaluate((x) => +x.value);
  const want = v + ((80 - 8) / b.width) * (max - min);
  const steps = seen.slice(1).map((x, i) => x - seen[i]);
  ok('the value moved up by about the drag past the slop, not to the finger', after > v && Math.abs(after - want) <= 0.12 * (max - min),
    { v, after, want: +want.toFixed(2), x0: +x0.toFixed(0) });
  ok('no step jumps: each move adds at most its own share', steps.every((d) => d >= 0 && d <= 0.08 * (max - min)), seen);
  ok('nothing moved before the slop', seen.slice(0, 2).every((x) => x === v), seen.slice(0, 3));
  ok('the drag wrote', writes() > w0, writes() - w0);
}

console.log('\n[a tap on a slider track changes nothing]');
{
  await sleep(600);
  const b = await center(SLIDER);
  const el = page.locator(SLIDER).first();
  const f = await fracOf(SLIDER);
  const v0 = await value(SLIDER), w0 = writes();
  await tap(b.x + (f > 0.5 ? 0.1 : 0.9) * b.width, b.y + b.height / 2);
  await sleep(300);
  ok('tap on the track: value unchanged, nothing written', (await value(SLIDER)) === v0 && writes() === w0, [v0, await value(SLIDER), writes() - w0]);
  ok('the tap focused the slider', await el.evaluate((x) => document.activeElement === x));
}

console.log('\n[a clean tap fires a button; Halt at once]');
{
  await scrollTo(0);
  const b = await page.locator('.rw-flip').boundingBox();
  await tap(b.x + b.width / 2, b.y + b.height / 2);
  ok('Flip: a tap asks to flip', await confirmOpen());
  const w0 = writes();
  const c = await page.locator('[role=alertdialog] .og-btn.confirm').boundingBox();
  await tap(c.x + c.width / 2, c.y + c.height / 2);
  await sleep(300);
  ok('Flip: confirmed, it writes', writes() > w0, writes() - w0);
  const h = await page.locator('.btn-estop').boundingBox();
  const s0 = safety();
  await touch('touchStart', h.x + h.width / 2, h.y + h.height / 2);
  await sleep(30);
  await touch('touchEnd');
  await sleep(150);
  ok('Halt: a tap sends the e-stop', safety() > s0, safety() - s0);
}

console.log('\n[the wheel scrolls the page over an unfocused slider]');
for (const sel of [SLIDER]) {
  const b = await center(sel);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const v0 = await value(sel), w0 = writes(), y0 = await scrollY();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 300);
  await sleep(400);
  ok(sel.split(' ').pop() + ': the wheel scrolled the page, nothing written', (await scrollY()) > y0 + 100 && (await value(sel)) === v0 && writes() === w0,
    [y0, await scrollY(), v0, await value(sel), writes() - w0]);
}

console.log('\n[touch laptop: a knob on a built home]');
({ page, cdp } = await open({ w: 1280, h: 800, mobile: false, home: store }));
{
  await page.waitForSelector(KNOBSEL, { timeout: 15000 });
  await scrollTo(0);
  const b = await page.locator(KNOBSEL).boundingBox();
  const v0 = await value(KNOBSEL), w0 = writes(), y0 = await scrollY();
  await swipe(b.x + b.width / 2, b.y + b.height / 2, 0, -200);
  ok('knob: a vertical swipe scrolled the page', (await scrollY()) > y0 + 100, [y0, await scrollY()]);
  ok('knob: value unchanged, nothing written', (await value(KNOBSEL)) === v0 && writes() === w0, [v0, await value(KNOBSEL), writes() - w0]);
  const c = await center(KNOBSEL);
  const v1 = Number(await value(KNOBSEL)), w1 = writes();
  await swipe(c.x + c.width / 2, c.y + c.height / 2, 60, 0);
  ok('knob: a sideways drag writes and turns it up', writes() > w1 && Number(await value(KNOBSEL)) > v1, [v1, await value(KNOBSEL), writes() - w1]);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const d = await center(KNOBSEL);
  const v2 = await value(KNOBSEL), w2 = writes(), y2 = await scrollY();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.wheel(0, 300);
  await sleep(400);
  ok('knob: the wheel over it unfocused scrolls the page, nothing written', (await scrollY()) > y2 + 100 && (await value(KNOBSEL)) === v2 && writes() === w2,
    [y2, await scrollY(), v2, await value(KNOBSEL), writes() - w2]);
}

ok('no page errors', pageErrors.length === 0, pageErrors);
await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- touch adjusts only on intent.'));
process.exit(fails ? 1 : 0);
