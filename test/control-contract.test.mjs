/**
 * control-contract.test.mjs -- ph-e82.4: every presentation of one writable
 * field keeps the universal contract (DESIGN §10.2, RENDERING §8.1, law 5).
 *
 * Builds its own page from test/control-harness (the real model and the real
 * Field/Control/ActionField, no App) into a temp dir; dist/ is untouched.
 *
 * Fake mode (default): Playwright's WebSocket route is the hub, the recorded
 * valencesim catalog is pre-seeded into the etag cache, and every INTENT is
 * answered per the test's chosen mode: echo, hold (echo on release), silent
 * (no answer) or nack. Asserts, per presentation (slider, knob, stepper):
 * pending then confirmed on an echo, overdue past 500 ms, fault on a NACK and
 * on silence, each with its text reason; a newer write survives the silent
 * intent's late session timeout (ph-6i9); display-only presentations write
 * nothing; every presentation keeps one height idle, pending, overdue,
 * confirmed, grayed (enabled_mask), stale (hub silence) and at fault, the
 * words in the head-row slot (ph-vdk.60.1); an aspect flip at w = h swaps
 * orientation without dropping a write
 * in flight; a secret action payload masks and never reaches the status text
 * (ph-vic), and an action press climbs the same ladder with the same stamp
 * rule (ph-vdk.58). The same ladder, height and snap-back after a refusal run on
 * toggle, segmented, select, text and bitfield (a synthetic setting channel
 * appended to the recorded catalog carries the text, bitfield and destructive
 * toggle it lacks), plus RFC-064 index 0, segmented keyboard and the
 * destructive toggle's confirm (ph-vdk.60.5). An Alt-drag of the slider or
 * knob writes once, on release, never on a cancel, with the ring pending and
 * no pulses (ph-vdk.60.11; --shots <dir> saves the held slider). Through a
 * placement look (RFC-080 by ruling, ph-huv): a two-valued toggle on a
 * three-option field writes B then A, and a narrowed slider marks a reported
 * value outside its range, each up the same ladder.
 *
 * Live mode (--live): the same page against a running valencesim; one
 * slider-class field driven through slider, knob and stepper, the two-valued
 * toggle pressed to B and back to A, and the narrowed slider, each value
 * confirmed on a second, raw session (C-8), which then puts every value back.
 * Skips (exit 0) when no sim answers.
 *
 * Run: node test/control-contract.test.mjs
 *      node test/control-contract.test.mjs --live [--host 127.0.0.1] [--port 8882] [--http 8880]
 *        (valencesim --homed --port 8882 --http 8880)
 */
import { chromium } from 'playwright';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull, head, concatBytes } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS, NACK, CBOR_FIELD, SETTING_FLAG } from '../../Valence/clients/js/frames.js';
import { createSession, catalogEtag, toHex } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { buildSettingsModel, placeableControls, WIDGET } from '../src/model/settings.js';
import { precisionFor } from '../src/model/format.js';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const LIVE = args.includes('--live');
const SHOTS = argOf('--shots', null);
const HOST = argOf('--host', '127.0.0.1');
const SIM_PORT = parseInt(argOf('--port', '8882'), 10);
const SIM_HTTP = parseInt(argOf('--http', '8880'), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

// The recorded catalog has no writable text field, no writable named-bit
// bitfield and no unroled toggle, so one synthetic setting channel pair
// carrying them is appended, and the etag is the hash of the bytes served.
const XS = 0x7e00, XI = 0x7e01;
const CAT = withExtras(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
function withExtras(raw) {
  const ai = raw[0] & 0x1f;
  const [n, hl] = ai < 24 ? [ai, 1] : ai === 24 ? [raw[1], 2] : [(raw[1] << 8) | raw[2], 3];
  const lf = (name, type, key, more = []) => cbMap([[1, cbTstr(name)], [2, cbUint(type)], [3, cbTstr('')], [4, cbF32(1)],
    [8, cbUint(key)], ...more].sort((x, y) => x[0] - y[0]));
  const sf = (name, type) => cbMap([[1, cbTstr(name)], [2, cbUint(type)], [3, cbTstr('')]]);
  const off = cbArray([cbTstr('off'), cbTstr('on')]);
  const state = cbMap([[1, cbUint(XS)], [2, cbTstr('fixture-extras')], [3, cbUint(0)], [4, cbUint(0)], [5, cbUint(0)],
    [6, cbF32(0)], [7, cbUint(0)], [8, cbArray([
      lf('label_text', PACKED.str16, 1),
      lf('lamp_bits', PACKED.bitfield8, 2, [[7, cbMap([[0, cbTstr('alpha')], [1, cbTstr('beta')], [2, cbTstr('gamma')]])]]),
      lf('arm', PACKED.u8, 3, [[10, off], [15, cbUint(SETTING_FLAG.destructive)]]),
      lf('lamp', PACKED.u8, 4, [[10, off]]),
      lf('long_advanced_toggle_label', PACKED.u8, 5, [[10, off], [15, cbUint(SETTING_FLAG.advanced)]]),
    ])], [14, cbUint(XI)]]);
  const intent = cbMap([[1, cbUint(XI)], [2, cbTstr('fixture-extras-set')], [3, cbUint(2)], [4, cbUint(1)], [5, cbUint(1)],
    [6, cbF32(5)], [7, cbUint(1)], [9, cbMap([[1, sf('label_text', CBOR_FIELD.tstr_t)], [2, sf('lamp_bits', CBOR_FIELD.uint_t)],
      [3, sf('arm', CBOR_FIELD.uint_t)], [4, sf('lamp', CBOR_FIELD.uint_t)], [5, sf('long_advanced_toggle_label', CBOR_FIELD.uint_t)]])]]);
  return concatBytes([head(4, n + 2), raw.subarray(hl), state, intent]);
}
const ETAG = toHex(catalogEtag(CAT, LIMITS.etag_bytes));
const ENTRIES = decodeCatalog(CAT);
const MODEL = buildSettingsModel(ENTRIES);
// The first writable, unroled slider-class field: no hero claims it anywhere.
const FIELD = MODEL.fields.find((f) => !f.readOnly && !f.role && f.widget === WIDGET.slider && f.step);
const STATE_CH = FIELD.channelId;
const ACTION = MODEL.actions.find((a) => a.payload && a.payload.some((p) => p.type === CBOR_FIELD.tstr_t));

/**
 * In-page WCAG audit: every element with its own text under `sel`, its color
 * blended by its ancestors' opacity over the first opaque background behind
 * it. Inactive controls are exempt (WCAG 1.4.3), and so is a stale value,
 * dimmed on purpose (law 8). Returns the failures in words.
 */
const lowContrast = (sel) => {
  // A color-mix() computes to color(srgb r g b / a) with channels in 0..1.
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c), k = /color\(srgb ([^)]+)\)/.exec(c); if (!m && !k) return null;
    const p = (m || k)[1].split(/[\s,/]+/).filter(Boolean).map(Number), u = m ? 1 : 255;
    return [p[0] * u, p[1] * u, p[2] * u, p.length > 3 ? p[3] : 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor);
    if (c && c[3] > 0.5) return c; } return parse(getComputedStyle(document.documentElement).backgroundColor) || [0, 0, 0, 1]; };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[disabled], .is-disabled, [aria-disabled="true"], .typeable.disabled, .sr-only, .stale')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || !el.getClientRects().length) continue;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    if (o < 0.05) continue;
    const fg = parse(cs.color), bg = bgOf(el), a = fg[3] * o;
    const l1 = lum([0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const need = px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66) ? 3 : 4.5;
    if (ratio < need) out.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2));
  }
  return out;
};

async function probe(host, port) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket('ws://' + host + ':' + port + '/'); } catch (e) { resolve(false); return; }
    const t = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } resolve(false); }, 2000);
    ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
}
if (LIVE && !(await probe(HOST, SIM_PORT))) {
  console.log('SKIP: no valencesim answering on ' + HOST + ':' + SIM_PORT + ' -- start it (see file header) and re-run.');
  process.exit(0);
}

// ---- the harness page -------------------------------------------------------
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUTDIR = mkdtempSync(join(tmpdir(), 'control-harness-'));
await build({
  configFile: false, logLevel: 'error', root: join(HERE, 'control-harness'),
  plugins: [svelte({ configFile: join(HERE, '..', 'svelte.config.js') }), viteSingleFile()],
  build: { outDir: OUTDIR, emptyOutDir: true, assetsInlineLimit: 100 * 1024 },
});
const HTML = readFileSync(join(OUTDIR, 'index.html'));
rmSync(OUTDIR, { recursive: true, force: true });

const TOKEN = JSON.stringify({ ok: true, token: '5a'.repeat(LIMITS.token_bytes) });
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    if (!LIVE) { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(TOKEN); return; }
    fetch('http://' + HOST + ':' + SIM_HTTP + '/uitoken').then(async (r) => {
      s.writeHead(r.status, { 'Content-Type': 'application/json' }); s.end(await r.text());
    }).catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

// ---- the fake hub -----------------------------------------------------------
const hub = { mode: 'echo', held: [], values: { [XS + ':label_text']: 'alpha' }, mute: false, push: null, log: [] };
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
      case PACKED.str16: case PACKED.str32: case PACKED.str64:
        out.set(new TextEncoder().encode(String(v || '')).subarray(0, SIZE[f.type] - 1), off); break;
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
  hub.push = pushState;
  ws.onMessage((msg) => {
    if (typeof msg === 'string') return;
    for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(2000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('Control contract fixture')]])],
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
        hub.log.push({ ch, val });
        // One INTENT channel may set fields of several STATE channels.
        const sts = ENTRIES.filter((e) => e.settingChannel === ch && e.layout);
        const answer = () => {
          for (const [k, v] of val) {
            for (const st of sts) {
              const f = st.layout.find((x) => x.settingKey === k);
              if (f) hub.values[st.id + ':' + f.name] = v;
            }
          }
          send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)],
            [K.applied, cbMap(val.map(([k, v]) => [k, cbAny(v)]))]]));
          for (const st of sts) pushState(st.id);
        };
        if (hub.mode === 'echo') answer();
        else if (hub.mode === 'hold') hub.held.push(answer);
        else if (hub.mode === 'nack') {
          send(FRAME.NACK, ch, cbMap([[K.code, cbUint(NACK.INVALID_VALUE)], [K.detail, cbTstr('fixture refusal')],
            [K.intent_id, cbUint(id)]]));
        }
      } else if (header.type === FRAME.PING) {
        if (!hub.mute) send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}
// Writes leave at the channel's catalog rate (shadow.svelte.js), so the intent
// may not have reached the hub yet when the test wants to answer it.
async function release() {
  for (let i = 0; i < 100 && !hub.held.length; i++) await sleep(10);
  for (const a of hub.held.splice(0)) a();
}

// ---- the page ---------------------------------------------------------------
const WRITERS = ['slider', 'knob', 'stepper'];
const PRES = [...WRITERS, 'numeral', 'bar', 'graph'];
// A small bounded integer field (under four digits) for the numeral's padding.
const SMALL = MODEL.fields.find((f) => f.uid !== FIELD.uid && !f.options && f.min === 0 && f.max >= 100 && f.max < 1000
  && f.step === 1 && f.maskFieldName);
// One writable field per remaining writing presentation (ph-vdk.60.5).
const unroled = (w) => MODEL.fields.filter((f) => !f.readOnly && !f.role && f.widget === w && f.channelId !== XS);
const CHOICES = unroled(WIDGET.segmented);
const LADDER = {
  toggle: MODEL.fields.find((f) => f.uid === XS + ':lamp'),
  segmented: CHOICES[0],
  select: CHOICES[1],
  text: MODEL.fields.find((f) => f.uid === XS + ':label_text'),
  bitfield: MODEL.fields.find((f) => f.uid === XS + ':lamp_bits'),
};
const ARM = MODEL.fields.find((f) => f.uid === XS + ':arm');
// ph-0h8: a writable f32 with a fractional step, shown in a stepper.
const F32 = MODEL.fields.find((f) => !f.readOnly && f.type === PACKED.f32 && f.step > 0 && f.step < 1 && f.min != null && f.max != null);
// ph-62w: a merged min/max pair; ph-z5o: a long advanced toggle label.
const RANGE = placeableControls(MODEL).find((c) => c.field && c.field.widget === WIDGET.range);
const LONG = MODEL.fields.find((f) => f.uid === XS + ':long_advanced_toggle_label');
// Placement looks (RFC-080 by ruling, ph-huv), drawn through Control: a toggle
// writing options 1 and 2 of a three-option field, and a slider narrowed to
// the middle half of another field's range, on its step grid.
const TWO = CHOICES.find((f) => f.options.length >= 3);
const NARROW = MODEL.fields.find((f) => !f.readOnly && !f.role && f.channelId !== XS && f.uid !== FIELD.uid
  && f.widget === WIDGET.slider && f.step);
const onGrid = (f, frac) => f.min + Math.round((f.max - f.min) * frac / f.step) * f.step;
const [NLO, NHI] = [onGrid(NARROW, 0.25), onGrid(NARROW, 0.75)];
const TWO_KEY = 'toggle@' + TWO.uid + '@a=1;b=2';
const NARROW_KEY = 'slider@' + NARROW.uid + '@min=' + NLO + ';max=' + NHI;
const MORE = [...(SMALL ? ['numeral@' + SMALL.uid] : []),
  ...Object.entries(LADDER).filter(([, f]) => f).map(([p, f]) => p + '@' + f.uid), 'toggle@' + ARM.uid, TWO_KEY, NARROW_KEY,
  ...(F32 ? ['stepper@' + F32.uid] : []), ...(RANGE ? ['range@' + RANGE.key] : []), ...(LONG ? ['toggle@' + LONG.uid] : [])];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
if (!LIVE) {
  await ctx.addInitScript(([etag, bytes]) => {
    try { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* none */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
}
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const hubArg = LIVE ? HOST + ':' + SIM_PORT : '127.0.0.1';
await page.goto('http://127.0.0.1:' + PORT + '/?hub=' + hubArg + '&uid=' + encodeURIComponent(FIELD.uid)
  + '&pres=' + PRES.join(',') + (ACTION && !LIVE ? '&action=' + encodeURIComponent(ACTION.uid) : '')
  + '&more=' + encodeURIComponent(MORE.join(',')));
const up = await page.waitForSelector('.cell[data-pres=slider] input[type=range]:not([disabled])', { timeout: 15000 })
  .then(() => true).catch(() => false);
ok('the harness adopted the catalog and the field is writable (' + FIELD.label + ')', up);
if (!up) { await browser.close(); srv.close(); process.exit(1); }

const cell = (p) => page.locator('.cell[data-pres=' + p + '] .field');
const shadowOf = (p) => cell(p).getAttribute('data-shadow');
const ladderOf = (p) => cell(p).locator('.ladder').textContent();
async function waitShadow(p, want, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await shadowOf(p) === want) return true; await sleep(20); }
  return false;
}
const current = () => page.locator('.cell[data-pres=slider] input[type=range]').evaluate((el) => Number(el.value));

/** Drive one presentation; returns the value it should write. */
async function drive(p) {
  const before = await current();
  const step = FIELD.step;
  if (p === 'slider') {
    const v = before + step * 3 <= FIELD.max ? before + step * 3 : before - step * 3;
    await page.locator('.cell[data-pres=slider] input[type=range]').evaluate((el, v) => {
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    return v;
  }
  if (p === 'knob') {
    await page.locator('.cell[data-pres=knob] .knob').focus();
    await page.keyboard.press(before + step <= FIELD.max ? 'ArrowUp' : 'ArrowDown');
    return before + step <= FIELD.max ? before + step : before - step;
  }
  const up = before + step <= FIELD.max;
  await page.locator('.cell[data-pres=stepper] .stepper button').nth(up ? 1 : 0).click();
  return up ? before + step : before - step;
}
const near = (a, b) => Math.abs(a - b) <= FIELD.step / 1000;
/** A field's box and its control's box (offset inside the field, size): no
 *  ladder state may move either (law 5, ph-vdk.62). */
const CTL = 'input[type=range], .knob, .stepper, .og-seg, .og-switch, select, input[type=text], .bitfield, .numeral, .meter, .graph';
const geoOf = (cellSel) => page.evaluate(([sel, ctl]) => {
  const f = document.querySelector(sel + ' .field'), c = f.querySelector(ctl);
  const r = f.getBoundingClientRect(), b = c ? c.getBoundingClientRect() : r;
  return [r.width, r.height, b.left - r.left, b.top - r.top, b.width, b.height].map((v) => Math.round(v * 2) / 2);
}, [cellSel, CTL]);
const sameGeo = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.5);
const NO_ANSWER = 'no answer from the hub';
/** Does anything at `sel` (box, border or text) paint in --bad? Red is the e-stop's alone (law 13). */
const wearsBad = (sel) => page.evaluate((sel) => {
  const probe = document.createElement('i');
  probe.style.color = 'var(--bad)';
  document.body.append(probe);
  const bad = getComputedStyle(probe).color;
  probe.remove();
  return [...document.querySelectorAll(sel)].flatMap((el) => [el, ...el.querySelectorAll('*')]).some((el) => {
    const s = getComputedStyle(el);
    return [s.boxShadow, s.color, s.borderTopColor].some((v) => v.includes(bad));
  });
}, sel);
/** A token's computed color, e.g. tokColor('--intent'). */
const tokColor = (name) => page.evaluate((name) => {
  const p = document.body.appendChild(document.createElement('span'));
  p.style.color = 'var(' + name + ')';
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
}, name);
/** End a field's afterglow now: the at-rest look. */
const finishGlow = (loc) => loc.evaluate((f) => f.getAnimations().filter((a) => (a.animationName || '').startsWith('fx-glow'))
  .forEach((a) => a.finish()));

if (!LIVE) {
  for (const p of WRITERS) {
    console.log('\n[' + p + ']');
    hub.mode = 'hold';
    const want = await drive(p);
    ok(p + ': pending while the hub holds the echo', await waitShadow(p, 'pending', 1000));
    ok(p + ': pending names itself in words', (await ladderOf(p)).includes('waiting'), await ladderOf(p));
    await release();
    ok(p + ': confirmed on the echo', await waitShadow(p, 'confirmed'));
    ok(p + ': the confirm is said in words', (await ladderOf(p)) === 'confirmed', await ladderOf(p));
    ok(p + ': the control shows the applied value', near(await current(), want), [await current(), want]);

    hub.mode = 'silent';
    await drive(p);
    ok(p + ': overdue past 500 ms with no echo', await waitShadow(p, 'overdue', 1500));
    ok(p + ': overdue names itself in words', (await ladderOf(p)).includes('still waiting'), await ladderOf(p));
    ok(p + ': fault when the echo never comes', await waitShadow(p, 'fault', 3000));
    ok(p + ': fault gives the reason', (await ladderOf(p)).includes(NO_ANSWER), await ladderOf(p));
    // The unanswered intent's session timeout (3 s) lands about 1 s after the
    // fault, on the same shadow record; a newer write must not feel it (ph-6i9).
    hub.mode = 'hold';
    const again = await drive(p);
    await sleep(1300);
    const mid = await shadowOf(p);
    ok(p + ': a write in flight survives the silent intent timing out', mid === 'pending' || mid === 'overdue', mid);
    await release();
    ok(p + ': ...and confirms on its own echo', await waitShadow(p, 'confirmed'));
    ok(p + ': ...with its own value', near(await current(), again), [await current(), again]);

    hub.mode = 'nack';
    await drive(p);
    ok(p + ': fault on a NACK', await waitShadow(p, 'fault', 1500));
    ok(p + ': the NACK code is the reason', /INVALID_VALUE/.test(await ladderOf(p)), await ladderOf(p));
    ok(p + ': a fault wears amber, never the e-stop red', !(await wearsBad('.cell[data-pres=' + p + '] .field')));
    if (p === WRITERS[0]) {
      // ph-xec: the session's own 3 s timeout lands after the 2 s fault and must not rewrite it.
      hub.mode = 'silent';
      await drive(p);
      await waitShadow(p, 'fault', 3000);
      await sleep(1300);
      ok(p + ': after a silent hub the final words are the no-answer wording', await shadowOf(p) === 'fault'
        && (await ladderOf(p)).trim() === NO_ANSWER, await ladderOf(p));
    }
    hub.mode = 'echo';
    await sleep(100);
  }

  // ---- the same ladder on every other writing presentation ---------------
  const xcell = (p) => page.locator('.cell[data-pres="' + p + '@' + LADDER[p].uid + '"] .field');
  const xshadow = (p) => xcell(p).getAttribute('data-shadow');
  const xladder = (p) => xcell(p).locator('.ladder').textContent();
  const xgeo = (p) => geoOf('.cell[data-pres="' + p + '@' + LADDER[p].uid + '"]');
  async function xwait(p, want, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await xshadow(p) === want) return true; await sleep(20); }
    return false;
  }
  /** Drive one write; returns a reader and the value it should read back. */
  async function xdrive(p) {
    const c = xcell(p);
    if (p === 'toggle') {
      const want = !(await c.locator('input[type=checkbox]').isChecked());
      await c.locator('.og-switch').click();
      return [() => c.locator('input[type=checkbox]').isChecked(), want];
    }
    if (p === 'segmented') {
      const radios = c.locator('[role=radio]');
      const i = await radios.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-checked') !== 'true'));
      await radios.nth(i).click();
      return [() => radios.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-checked') === 'true')), i];
    }
    if (p === 'select') {
      const sel = c.locator('select');
      const want = String((Number(await sel.inputValue()) + 1) % LADDER.select.options.length);
      await sel.selectOption(want);
      return [() => sel.inputValue(), want];
    }
    if (p === 'text') {
      const inp = c.locator('input[type=text]');
      const want = (await inp.inputValue()) === 'alpha' ? 'beta' : 'alpha';
      await inp.fill(want);
      await inp.dispatchEvent('change');
      return [() => inp.inputValue(), want];
    }
    const bit = c.locator('.bit input[type=checkbox]').first();
    const want = !(await bit.isChecked());
    await bit.click();
    return [() => bit.isChecked(), want];
  }
  for (const p of Object.keys(LADDER)) {
    console.log('\n[' + p + ']');
    if (!LADDER[p]) { ok(p + ': the fixture has a writable field for it', false); continue; }
    const g0 = await xgeo(p);
    const sameH = async (st) => { const g = await xgeo(p); ok(p + ': the same boxes ' + st, sameGeo(g, g0), [g0, g]); };
    hub.mode = 'hold';
    const [read, want] = await xdrive(p);
    ok(p + ': pending while the hub holds the echo', await xwait(p, 'pending', 1000));
    ok(p + ': pending names itself in words', (await xladder(p)).includes('waiting'), await xladder(p));
    const c0 = xcell(p);
    const segPaint = () => c0.locator('[role=radio][aria-checked=true]').evaluate((b) => {
      const s = getComputedStyle(b);
      return { color: s.color, shadow: s.boxShadow };
    });
    if (p === 'segmented') {
      await sleep(200);
      const pnt = await segPaint();
      ok('segmented: the commanded option wears intent until the echo, unlit (ph-ufb)',
        pnt.color === await tokColor('--intent') && pnt.shadow === 'none', pnt);
    }
    await sameH('pending');
    ok(p + ': overdue past 500 ms', await xwait(p, 'overdue', 1500));
    await sameH('overdue');
    await release();
    ok(p + ': confirmed on the echo, in words', await xwait(p, 'confirmed') && (await xladder(p)) === 'confirmed', await xladder(p));
    ok(p + ': the control shows the applied value', await read() === want, [await read(), want]);
    if (p === 'segmented') {
      await finishGlow(c0);
      await sleep(250);
      const pnt = await segPaint();
      ok('segmented: at rest the chosen option is plain reality, no glow (ph-ufb)',
        pnt.color === await tokColor('--reality') && pnt.shadow === 'none', pnt);
    }
    hub.mode = 'silent';
    await xdrive(p);
    ok(p + ': fault when the echo never comes', await xwait(p, 'fault', 4000));
    ok(p + ': ...with its reason in the slot', (await xladder(p)).includes(NO_ANSWER), await xladder(p));
    await sameH('at fault');
    hub.mode = 'nack';
    const before = await read();
    await xdrive(p);
    ok(p + ': fault on a NACK, the code in words', await xwait(p, 'fault', 1500) && /INVALID_VALUE/.test(await xladder(p)),
      await xladder(p));
    ok(p + ': ...and the control shows what the machine reports again', await read() === before, [await read(), before]);
    hub.mode = 'echo';
  }

  console.log('\n[choices] index 0 and the keyboard');
  if (LADDER.segmented && LADDER.select) {
    const seg = xcell('segmented');
    const radios = seg.locator('[role=radio]');
    ok('segmented: index 0 is a real, enabled option (RFC-064)', await radios.count() === LADDER.segmented.options.length
      && !(await radios.nth(0).isDisabled()));
    ok('select: index 0 is a real option (RFC-064)', await xcell('select').locator('option[value="0"]').count() === 1);
    ok('segmented: one tab stop', (await radios.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length)) === 1);
    const at = await radios.evaluateAll((els) => els.findIndex((e) => e.tabIndex === 0));
    await radios.nth(at).focus();
    await page.keyboard.press('ArrowRight');
    const moved = await page.evaluate(() => document.activeElement.getAttribute('aria-checked'));
    await sleep(300);
    ok('segmented: an arrow moves focus and writes nothing', moved === 'false' && await xshadow('segmented') !== 'pending'
      && await xshadow('segmented') !== 'overdue');
    await page.keyboard.press('Space');
    const to = (at + 1) % LADDER.segmented.options.length;
    ok('segmented: Space writes the focused option', await xwait('segmented', 'confirmed')
      && (await radios.nth(to).getAttribute('aria-checked')) === 'true');
    await radios.nth(0).click();
    ok('segmented: index 0 writes and confirms', await xwait('segmented', 'confirmed')
      && (await radios.nth(0).getAttribute('aria-checked')) === 'true');
  }

  console.log('\n[toggle confirm] a destructive setting asks first');
  const arm = page.locator('.cell[data-pres="toggle@' + ARM.uid + '"] .field');
  const armBox = arm.locator('input[type=checkbox]');
  const was = await armBox.isChecked();
  await arm.locator('.og-switch').click();
  const dialog = page.locator('.overlay[role=alertdialog]');
  ok('toggle: a destructive flag opens the confirm', await dialog.waitFor({ timeout: 2000 }).then(() => true).catch(() => false));
  await dialog.locator('button', { hasText: 'Cancel' }).click();
  await sleep(300);
  ok('toggle: Cancel writes nothing and the switch shows the machine again',
    await armBox.isChecked() === was && await arm.getAttribute('data-shadow') === 'confirmed');
  await arm.locator('.og-switch').click();
  await dialog.locator('button.confirm').click();
  ok('toggle: Confirm writes, and the echo settles it', await page.waitForFunction((u) =>
    document.querySelector('.cell[data-pres="toggle@' + u + '"] input[type=checkbox]').checked !== undefined
    && document.querySelector('.cell[data-pres="toggle@' + u + '"] .field').dataset.shadow === 'confirmed', ARM.uid,
    { timeout: 3000 }).then(() => true).catch(() => false) && await armBox.isChecked() === !was);

  console.log('\n[display-only]');
  for (const p of ['numeral', 'bar']) {
    ok(p + ': a read-only presentation of a writable field has no control',
      await page.locator('.cell[data-pres=' + p + '] :is(input, button.info.reset, [role=slider])').count() === 0);
    ok(p + ': ...and no gate reason, because nothing is gated', await cell(p).locator('.ladder[data-slot=gate]').count() === 0);
  }

  const chipFace = (sel) => page.$eval(sel, (el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, shadow: s.boxShadow }; });
  const bareChip = await chipFace('.cell[data-pres=bar] .field-value');
  const typedChip = await chipFace('.cell[data-pres=slider] .field-value.typeable');
  ok('a read-only value is bare digits; only the typeable chip wears the recess (ph-5y6)',
    bareChip.bg === 'rgba(0, 0, 0, 0)' && bareChip.shadow === 'none' && typedChip.bg !== 'rgba(0, 0, 0, 0)'
    && typedChip.shadow.includes('inset'), [bareChip, typedChip]);

  console.log('\n[stepper] the value at the precision of the step (ph-0h8)');
  if (F32) {
    const v = F32.min + (F32.max - F32.min) * 0.37;
    hub.values[F32.channelId + ':' + F32.name] = v;
    hub.push(F32.channelId);
    await sleep(200);
    const shown = await page.locator('.cell[data-pres="stepper@' + F32.uid + '"] .og-num').inputValue();
    ok('stepper: an f32 reads at the precision of its step, not its float noise', shown === Math.fround(v).toFixed(precisionFor(F32)),
      [shown, Math.fround(v)]);
  } else ok('the fixture has a writable f32 with a fractional step', false);

  console.log('\n[range] the chip of the pair in the head row; its echo lights the afterglow (ph-62w)');
  if (RANGE) {
    const rg = page.locator('.cell[data-pres="range@' + RANGE.key + '"] .field');
    ok('range: the value chip rides the head row', await rg.evaluate((f) => {
      const h = f.querySelector('.field-head').getBoundingClientRect(), c = f.querySelector('.field-head .field-value');
      const r = c && c.getBoundingClientRect();
      return !!r && r.top >= h.top - 0.5 && r.bottom <= h.bottom + 0.5 && !f.querySelector(':scope > .field-value');
    }));
    hub.mode = 'hold';
    // No scroll: the drag checks below aim the mouse at the first row.
    await rg.locator('input.range-hi').evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.press('ArrowLeft');
    ok('range: pending while the hub holds the echo', await page.waitForFunction((k) =>
      document.querySelector('.cell[data-pres="range@' + k + '"] .field').dataset.shadow === 'pending', RANGE.key, { timeout: 1000 })
      .then(() => true).catch(() => false));
    ok('in flight: the model counts the pair as one write in flight (ph-sbu)',
      (await page.evaluate((k) => window.__inFlight([k]), RANGE.key)).n === 1);
    await release();
    ok('range: the echo says confirmed and lights the afterglow', await page.waitForFunction((k) => {
      const f = document.querySelector('.cell[data-pres="range@' + k + '"] .field');
      return f.dataset.shadow === 'confirmed' && !!f.dataset.glow && f.querySelector('.ladder').textContent === 'confirmed';
    }, RANGE.key, { timeout: 3000 }).then(() => true).catch(() => false), await rg.locator('.ladder').textContent());
    hub.mode = 'echo';
  } else ok('the fixture has a min/max pair', false);

  console.log('\n[head] a narrow label ellipsizes on one line, its tag after it (ph-z5o)');
  if (LONG) {
    const lc = page.locator('.cell[data-pres="toggle@' + LONG.uid + '"]');
    const h0 = await lc.locator('.field-head').evaluate((e) => e.getBoundingClientRect().height);
    await lc.evaluate((c) => { c.style.width = '150px'; });
    await sleep(50);
    const head = await lc.evaluate((c) => {
      const f = c.querySelector('.field').getBoundingClientRect(), h = c.querySelector('.field-head').getBoundingClientRect();
      const t = c.querySelector('.tag.adv').getBoundingClientRect(), x = c.querySelector('.field-label-text');
      return { h: h.height, tagIn: t.right <= f.right + 0.5 && t.top >= h.top - 0.5 && t.bottom <= h.bottom + 0.5,
        cut: x.scrollHeight > x.clientHeight + 1 || x.scrollWidth > x.clientWidth, title: x.title };
    });
    await lc.evaluate((c) => { c.style.width = ''; });
    ok('a narrow head stays one line', Math.abs(head.h - h0) < 0.5, [h0, head.h]);
    ok('...the label ellipsizes with its full text in the title, the adv tag in the row',
      head.cut && head.tagIn && head.title === LONG.label, head);
  } else ok('the fixture has an advanced toggle', false);

  // Every transient has one fixed home (laws 3, 5, 8): the field's box and
  // its control's box are the same idle, pending, overdue, confirmed, fault,
  // grayed and stale.
  console.log('\n[anatomy]');
  const heights = async () => Object.fromEntries(await Promise.all(PRES.map(async (p) => [p, await geoOf('.cell[data-pres=' + p + ']')])));
  const idle = await heights();
  const same = async (state) => {
    const h = await heights();
    for (const p of PRES) ok(p + ': the same boxes ' + state, sameGeo(h[p], idle[p]), [idle[p], h[p]]);
  };
  hub.mode = 'hold';
  await drive('slider');
  ok('a write is pending', await waitShadow('slider', 'pending', 1000));
  await same('pending');
  const fl = () => page.evaluate((u) => window.__inFlight([u]), FIELD.uid);
  ok('in flight: pending counts, not overdue (ph-sbu)', JSON.stringify(await fl()) === '{"n":1,"overdue":false}', await fl());
  ok('...then overdue', await waitShadow('slider', 'overdue', 1500));
  await same('overdue');
  ok('in flight: overdue counts and says so', JSON.stringify(await fl()) === '{"n":1,"overdue":true}', await fl());
  await release();
  ok('...then confirmed', await waitShadow('slider', 'confirmed'));
  await same('confirmed');
  hub.mode = 'echo';
  const MASK = STATE_CH + ':' + FIELD.maskFieldName;
  hub.values[MASK] = 0;
  hub.push(STATE_CH);
  ok('the machine closes the field (enabled_mask)', await page.locator('.cell[data-pres=slider] input[type=range][disabled]')
    .waitFor({ timeout: 2000 }).then(() => true).catch(() => false));
  ok('...and the gate is named in the slot', /disabled by the machine/.test(await ladderOf('slider')), await ladderOf('slider'));
  await same('grayed');
  hub.values[MASK] = 0xff;
  hub.push(STATE_CH);
  await page.locator('.cell[data-pres=slider] input[type=range]:not([disabled])').waitFor({ timeout: 2000 });
  hub.mute = true;
  ok('silence dims the field as stale (law 8)', await page.locator('.cell[data-pres=slider] .field.stale')
    .waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  await same('stale');
  hub.mute = false;
  await page.locator('.cell[data-pres=slider] .field:not(.stale)').waitFor({ timeout: 3000 });
  hub.mode = 'nack';
  await drive('slider');
  ok('a refused write faults', await waitShadow('slider', 'fault', 1500));
  await same('at fault, its reason in the slot');
  ok('in flight: a refused write is not in flight (ph-sbu)',
    (await page.evaluate((u) => window.__inFlight([u]), FIELD.uid)).n === 0);
  hub.mode = 'echo';

  // The write-feedback effect (docs/EFFECTS.md, ph-vdk.62): the ring and the
  // line carry the ladder, the echo's afterglow decays, reduced motion holds
  // it still. The decay is sampled by seeking the glow's own animation.
  console.log('\n[effect] the phosphor ring and the line (ph-vdk.62)');
  const SL = '.cell[data-pres=slider] .field';
  const alphas = (bs) => [...bs.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
    const v = m[1].split(/[\s,/]+/).map(Number);
    return v.length > 3 ? v[3] : 1;
  });
  // Ring layers in style.css order: amber line, intent line, afterglow line, ...
  const [AMBER, INTENT] = [0, 1];
  const ring = async () => alphas(await page.evaluate((sel) => getComputedStyle(document.querySelector(sel), '::after').boxShadow, SL));
  /** Highest alpha the slider's track paints in one accent (an rgb triple token). */
  const trackAlpha = (tok) => page.evaluate(([sel, tok]) => {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue(tok).trim().split(/\s*,\s*/).join(', ');
    const bg = getComputedStyle(document.querySelector(sel + ' input[type=range]')).backgroundImage;
    return Math.max(0, ...[...bg.matchAll(new RegExp('rgba?\\(' + rgb + '(?:, ([\\d.]+))?\\)', 'g'))]
      .map((m) => (m[1] == null ? 1 : Number(m[1]))));
  }, [SL, tok]);
  const paintOf = () => page.evaluate(() => ({
    knob: getComputedStyle(document.querySelector('.cell[data-pres=knob] .knob-track')).stroke,
    stepper: getComputedStyle(document.querySelector('.cell[data-pres=stepper] .og-num')).borderTopColor,
  }));
  /** Pause the slider field's afterglow at `ms` and read the ring's glow line and the level. */
  const glowAt = (ms) => page.evaluate(([sel, ms]) => {
    const f = document.querySelector(sel);
    const a = f.getAnimations().find((x) => (x.animationName || '').startsWith('fx-glow'));
    if (!a) return null;
    a.pause();
    a.currentTime = ms;
    const v = [...getComputedStyle(f, '::after').boxShadow.matchAll(/rgba?\(([^)]+)\)/g)][2][1].split(/[\s,/]+/).map(Number);
    return { ring: v.length > 3 ? v[3] : 1, g: Number(getComputedStyle(f).getPropertyValue('--fx-g')) };
  }, [SL, ms]);
  const endGlow = () => page.evaluate((sel) => {
    for (const a of document.querySelectorAll('.cell .field')) {
      const x = a.getAnimations().find((y) => (y.animationName || '').startsWith('fx-glow'));
      if (x) x.finish();
    }
  }, SL);
  const cssAnims = () => page.evaluate((sel) => document.querySelector(sel).getAnimations()
    .filter((a) => a instanceof CSSAnimation).map((a) => a.animationName).sort(), SL);
  const glowLit = () => page.waitForFunction((sel) => !!document.querySelector(sel).dataset.glow, SL, { timeout: 3000 })
    .then(() => true).catch(() => false);

  hub.mode = 'echo';
  await waitShadow('slider', 'confirmed', 6000);
  await endGlow();
  await sleep(250);
  const rest = await paintOf();
  ok('at rest the ring is dark and the track carries nothing', (await ring()).every((a) => a < 0.01)
    && await trackAlpha('--intent-rgb') < 0.01 && await trackAlpha('--reality-rgb') < 0.01, await ring());
  hub.mode = 'hold';
  await drive('slider');
  await sleep(420);
  ok('pending: the ring wears intent', (await ring())[INTENT] > 0.2, await ring());
  ok('pending: the track carries intent at the handle', await trackAlpha('--intent-rgb') > 0.5, await trackAlpha('--intent-rgb'));
  const busy = await paintOf();
  ok('pending: the knob\'s arc and the stepper\'s box carry it too', busy.knob !== rest.knob && busy.stepper !== rest.stepper,
    [rest, busy]);
  ok('pending is alive: it breathes and its pulses travel', JSON.stringify(await cssAnims()) === '["fx-breath","fx-run"]',
    await cssAnims());
  await waitShadow('slider', 'overdue', 1500);
  await sleep(250);
  ok('overdue: the ring and the track turn amber', (await ring())[AMBER] > 0.3 && await trackAlpha('--warn-rgb') > 0.5,
    [await ring(), await trackAlpha('--warn-rgb')]);
  await release();
  ok('the echo lights the afterglow', await glowLit());
  await sleep(200);
  ok('confirmed: the track carries the afterglow', await trackAlpha('--reality-rgb') > 0.3, await trackAlpha('--reality-rgb'));
  const g05 = await glowAt(500), g3 = await glowAt(3000), g5 = await glowAt(5000);
  ok('the afterglow decays: ring at 0.5 s > at 3 s > at 5 s, and dark at 5 s',
    !!(g05 && g3 && g5) && g05.ring > g3.ring && g3.ring > g5.ring && g3.ring > 0.05 && g5.ring < 0.02, [g05, g3, g5]);
  ok('T25: the glow level is registered and interpolates (a real mid-flight number)', !!g3 && g3.g > 0.05 && g3.g < 0.95, g3);
  await endGlow();
  ok('...and when it has faded the word goes with it', await page.waitForFunction((sel) => {
    const f = document.querySelector(sel);
    return !f.dataset.glow && f.querySelector('.ladder').textContent === '';
  }, SL, { timeout: 2000 }).then(() => true).catch(() => false), await ladderOf('slider'));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await drive('slider');
  await sleep(300);
  ok('reduced motion: pending holds still (no animation) and still shows', (await cssAnims()).length === 0
    && (await ring())[INTENT] > 0.2, [await cssAnims(), await ring()]);
  await release();
  await glowLit();
  await sleep(250);
  const r05 = await glowAt(500), r3 = await glowAt(3000), r5 = await glowAt(5000);
  ok('reduced motion: the afterglow is a steady glow that clears at the end', !!(r05 && r3 && r5)
    && Math.abs(r05.ring - r3.ring) < 0.01 && r05.ring > 0.3 && r5.ring < 0.02, [r05, r3, r5]);
  await endGlow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  hub.mode = 'echo';

  // Alt-drag (ph-vdk.60.11, docs/EFFECTS.md): a held drag follows the
  // pointer, writes nothing until release, and runs no pulses.
  console.log('\n[defer] Alt-drag sends on release (ph-vdk.60.11)');
  await page.evaluate(() => addEventListener('pointerdown', (e) => { window.__pid = e.pointerId; }, true));
  const SLI = page.locator('.cell[data-pres=slider] input[type=range]');
  const writes = () => hub.log.filter((w) => w.ch === FIELD.writeChannel);
  const lastWrite = () => { const w = writes().at(-1); const kv = w && w.val.find(([k]) => k === FIELD.settingKey); return kv && kv[1]; };
  const sb = await SLI.boundingBox();
  const sy = sb.y + sb.height / 2, sx = (f) => sb.x + sb.width * f;
  const sweep = async (f0, f1, n = 8) => { for (let i = 1; i <= n; i++) { await page.mouse.move(sx(f0 + (f1 - f0) * i / n), sy); await sleep(70); } };
  const fxRun = () => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).getPropertyValue('--fx-run').trim(), SL);
  const intentColor = () => page.evaluate(() => {
    const p = document.body.appendChild(document.createElement('span'));
    p.style.color = 'var(--intent)';
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  hub.mode = 'echo';
  await waitShadow('slider', 'confirmed', 6000);
  let w0 = writes().length;
  await page.mouse.move(sx(0.2), sy);
  await page.mouse.down();
  await sweep(0.2, 0.8);
  await page.mouse.up();
  await sleep(500);
  ok('a plain drag writes as it goes, more than once', writes().length - w0 > 1, writes().length - w0);

  await waitShadow('slider', 'confirmed', 3000);
  w0 = writes().length;
  await page.keyboard.down('Alt');
  await page.mouse.move(sx(0.8), sy);
  await page.mouse.down();
  await sweep(0.8, 0.3);
  await sleep(400);
  const mid = { n: writes().length - w0, shadow: await shadowOf('slider'), defer: await cell('slider').getAttribute('data-defer'),
    anims: await cssAnims(), ring: (await ring())[INTENT], slot: await ladderOf('slider') };
  const runs = [];
  for (let i = 0; i < 4; i++) { runs.push(await fxRun()); await sleep(120); }
  ok('Alt-drag: nothing is written while it is held', mid.n === 0, mid.n);
  ok('Alt-drag: the ring is pending and breathes in intent', mid.shadow === 'pending' && mid.defer === ''
    && mid.anims.includes('fx-breath') && mid.ring > 0.2, mid);
  ok('Alt-drag: no pulses run (nothing is in flight)', runs.every((x) => Number(x) === 0), runs);
  ok('Alt-drag: the slot says it sends on release', mid.slot === 'sends on release', mid.slot);
  const chip = page.locator('.cell[data-pres=slider] .chip-num');
  ok('Alt-drag: the readout holds the pending number in intent',
    await chip.evaluate((el) => getComputedStyle(el).color) === await intentColor()
    && Number(await chip.inputValue()) === Number(await SLI.inputValue()), [await chip.inputValue(), await SLI.inputValue()]);
  if (SHOTS) await page.locator('.cell[data-pres=slider]').screenshot({ path: join(SHOTS, 'shift-drag-slider.png') });
  const heldV = Number(await SLI.inputValue());
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await sleep(500);
  ok('Alt-drag: exactly one write, on release, with the final value', writes().length - w0 === 1 && lastWrite() === heldV,
    [writes().length - w0, lastWrite(), heldV]);
  ok('Alt-drag: the control settles on the written value', await waitShadow('slider', 'confirmed') && await current() === heldV);

  w0 = writes().length;
  await page.mouse.move(sx(0.3), sy);
  await page.mouse.down();
  await sweep(0.3, 0.5);
  await page.keyboard.down('Alt');
  await sleep(600);
  const w1 = writes().length;
  await sweep(0.5, 0.9);
  ok('Alt pressed mid-drag: no write from that moment', writes().length === w1 && w1 > w0, [w0, w1, writes().length]);
  const held2 = Number(await SLI.inputValue());
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await sleep(500);
  ok('...and the release writes the held value once', writes().length === w1 + 1 && lastWrite() === held2,
    [writes().length - w1, lastWrite(), held2]);
  await waitShadow('slider', 'confirmed', 3000);

  w0 = writes().length;
  const v0c = await current();
  await page.keyboard.down('Alt');
  await page.mouse.move(sx(0.2), sy);
  await page.mouse.down();
  await sweep(0.2, 0.7);
  await SLI.evaluate((el) => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__pid, bubbles: true })));
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await sleep(500);
  ok('a cancelled Alt-drag writes nothing and puts the control back', writes().length === w0 && await current() === v0c
    && await shadowOf('slider') === 'confirmed', [writes().length - w0, await current(), v0c]);

  const KN = page.locator('.cell[data-pres=knob] .knob');
  const kb0 = await KN.boundingBox();
  w0 = writes().length;
  await page.mouse.move(kb0.x + kb0.width / 2, kb0.y + kb0.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(kb0.x + kb0.width / 2, kb0.y + kb0.height / 2 - 6 * i); await sleep(70); }
  const knobMid = writes().length - w0;
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await sleep(500);
  ok('knob: an Alt-drag writes once, on release', knobMid === 0 && writes().length - w0 === 1, [knobMid, writes().length - w0]);
  await waitShadow('knob', 'confirmed', 3000);

  console.log('\n[presentations]');
  const setReported = async (f, v) => {
    hub.values[f.channelId + ':' + f.name] = v;
    hub.push(f.channelId);
    await sleep(150);
  };
  const settle = async (p) => { await sleep(50); return waitShadow(p, 'confirmed'); };
  const step = FIELD.step;
  await setReported(FIELD, FIELD.min + Math.round((FIELD.max - FIELD.min) * 0.3 / step) * step);
  const knob = page.locator('.cell[data-pres=knob] .knob');
  const page10 = Math.max(10, Math.round((FIELD.max - FIELD.min) / 10 / step));
  const notch = Math.max(1, Math.round(page10 / 10));
  await page.mouse.click(2, 2);
  let v0 = await current();
  await knob.hover();
  await page.mouse.wheel(0, -100);
  await sleep(400);
  ok('knob: the wheel writes nothing until the knob holds focus', await current() === v0 && !['pending', 'overdue'].includes(await shadowOf('knob')));
  await knob.focus();
  await page.mouse.wheel(0, -100);
  await settle('knob');
  ok('knob: a wheel notch turns it a tenth of a page', near(await current(), v0 + notch * step), [v0, await current(), notch]);
  v0 = await current();
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Shift');
  await settle('knob');
  ok('knob: Shift makes a notch one step', near(await current(), v0 + step), [v0, await current()]);
  v0 = await current();
  await page.keyboard.press('PageUp');
  await settle('knob');
  ok('knob: PageUp moves a tenth of the range', near(await current(), v0 + page10 * step), [v0, await current(), page10]);
  v0 = await current();
  await page.keyboard.press('ArrowUp');
  await settle('knob');
  const plainStep = (await current()) - v0;
  v0 = await current();
  await page.keyboard.press('Shift+ArrowUp');
  await settle('knob');
  ok('knob: Shift+Arrow never steps more than Arrow', Math.abs((await current()) - v0) <= Math.abs(plainStep) + 1e-9, [plainStep, (await current()) - v0]);
  const decade = Math.pow(10, Math.ceil(Math.log10(FIELD.max - FIELD.min)) - 1);
  await page.keyboard.press('Control+ArrowUp');
  await settle('knob');
  const span = FIELD.max - FIELD.min;
  const from30 = FIELD.min + Math.round(span * 0.34 / step) * step;
  const up = Math.min(FIELD.max, (Math.floor(from30 / decade + 1e-9) + 1) * decade);
  const down = Math.max(FIELD.min, (Math.ceil(from30 / decade - 1e-9) - 1) * decade);
  const ctrlFrom = async (act) => {
    await setReported(FIELD, from30);
    await knob.focus();
    await page.keyboard.down('Control');
    await act();
    await page.keyboard.up('Control');
    await settle('knob');
    return current();
  };
  ok('knob: Ctrl+ArrowUp goes to the adjacent multiple above', near(await ctrlFrom(() => page.keyboard.press('ArrowUp')), up), [from30, up]);
  ok('knob: Ctrl+ArrowDown goes to the adjacent multiple below', near(await ctrlFrom(() => page.keyboard.press('ArrowDown')), down), [from30, down]);
  ok('knob: Ctrl+PageUp is one decade, not the range', near(await ctrlFrom(() => page.keyboard.press('PageUp')), up), [from30, up]);
  ok('knob: Ctrl+wheel is one decade, not the range', near(await ctrlFrom(() => page.mouse.wheel(0, -100)), up), [from30, up]);
  await setReported(FIELD, from30);
  ok('knob: its value in words carries the unit (aria-valuetext)', /\S/.test(await knob.getAttribute('aria-valuetext') || ''),
    await knob.getAttribute('aria-valuetext'));
  const kb = await knob.boundingBox();
  const drag = async (dy, shift) => {
    v0 = await current();
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
    await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    for (let i = 1; i <= 4; i++) await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 - dy * i / 4);
    if (shift) await page.keyboard.up('Shift');
    await page.mouse.up();
    await settle('knob');
    return (await current()) - v0;
  };
  const coarse = await drag(16, false);
  const fine = await drag(16, true);
  ok('knob: a drag turns it, Shift drags ten times finer', coarse > 0 && near(fine * 10, coarse), [coarse, fine]);
  await setReported(FIELD, FIELD.min + Math.round(span * 0.2 / step) * step);
  const half = await drag(160, false);
  ok('knob: 160 px turns it about half the span', Math.abs(half - span / 2) <= span * 0.03, [half, span / 2]);

  // Slider: Shift or Ctrl at pointerdown drags relative to the start value.
  await setReported(FIELD, FIELD.min + Math.round(span * 0.5 / step) * step);
  const sl = await SLI.boundingBox();
  const slx = (f) => sl.x + sl.width * f, sly = sl.y + sl.height / 2;
  const slDrag = async (key, f0, f1, mid) => {
    await page.mouse.move(slx(f0), sly);
    await page.keyboard.down(key);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(slx(f0 + (f1 - f0) * i / 5), sly); await sleep(40); }
    if (mid) await mid();
    await page.mouse.up();
    await page.keyboard.up(key);
    await settle('slider');
    return current();
  };
  const sv0 = await current();
  const sShift = await slDrag('Shift', 0.2, 0.3);
  ok('slider: Shift+drag does not jump the thumb and moves about a tenth', Math.abs(sShift - sv0 - span * 0.01) <= Math.max(2 * step, span * 0.004), [sv0, sShift]);
  await setReported(FIELD, sv0);
  const sCtrl = await slDrag('Control', 0.2, 0.35);
  ok('slider: Ctrl+drag lands on decade multiples', near(Math.round(sCtrl / decade) * decade, sCtrl), [sCtrl, decade]);
  await setReported(FIELD, sv0);
  let beforeRel = null;
  const sRel = await slDrag('Shift', 0.2, 0.3, async () => {
    beforeRel = await current();
    await page.keyboard.up('Shift');
    await page.mouse.move(slx(0.3) + 3, sly);
    await page.keyboard.down('Shift');
  });
  ok('slider: releasing Shift mid-drag does not jump', Math.abs(sRel - sv0) <= span * 0.05, [sv0, beforeRel, sRel]);

  const plus = page.locator('.cell[data-pres=stepper] .stepper button').nth(1);
  const pb = await plus.boundingBox();
  v0 = await current();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await sleep(1100);
  await page.mouse.up();
  await settle('stepper');
  const held = Math.round(((await current()) - v0) / step);
  ok('stepper: a long press repeats the step', held >= 3, held);
  v0 = await current();
  await plus.click();
  await settle('stepper');
  ok('stepper: a click is one step', near(await current(), v0 + step), [v0, await current()]);

  const gpath = () => page.locator('.cell[data-pres=graph] .graph path').getAttribute('d');
  ok('graph: a held value is drawn on to now', /H100(\.00)?$/.test(await gpath()), (await gpath()).slice(-24));
  hub.mute = true;
  await page.locator('.cell[data-pres=graph] .field.stale').waitFor({ timeout: 5000 });
  await sleep(600);
  ok('graph: link silence ends the line (a gap, never a held guess)', !/H100(\.00)?$/.test(await gpath()), (await gpath()).slice(-24));
  hub.mute = false;
  await page.locator('.cell[data-pres=graph] .field:not(.stale)').waitFor({ timeout: 3000 });
  await plus.click();
  await settle('stepper');
  await sleep(300);
  ok('graph: the line resumes after the gap as a new segment', ((await gpath()).match(/M/g) || []).length >= 2, await gpath());

  if (SMALL) {
    const num = page.locator('.cell[data-pres="numeral@' + SMALL.uid + '"] .numeral-digits');
    const digits = String(SMALL.max).length;
    await setReported(SMALL, 5);
    const t5 = await num.textContent(), w5 = (await num.boundingBox()).width;
    await setReported(SMALL, SMALL.max);
    const tm = await num.textContent(), wm = (await num.boundingBox()).width;
    ok('numeral: zero-padded to the bound\'s digits', t5 === '5'.padStart(digits, '0') && tm === String(SMALL.max), [t5, tm]);
    ok('numeral: the column keeps its width as the value changes', Math.abs(w5 - wm) < 0.5, [w5, wm]);
  } else ok('the fixture has a small bounded field for the numeral', false);

  console.log('\n[hi-vis and tokens]');
  await page.evaluate(() => document.documentElement.classList.add('hivis'));
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(150);
    const bad = await page.evaluate(lowContrast, '.cell .field *');
    ok(width + 'w hi-vis: every presentation\'s text clears WCAG AA', bad.length === 0, bad.slice(0, 6));
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => document.documentElement.classList.remove('hivis'));
  // Value marks read the accent token, so a theme reaches every presentation.
  const marks = { '.knob-fill': 'stroke', '.graph path': 'stroke', '.meter-fill': 'background-color' };
  const paint = () => page.evaluate((m) => Object.fromEntries(Object.entries(m).map(([sel, prop]) => {
    const el = document.querySelector('.cell ' + sel);
    return [sel, el ? getComputedStyle(el).getPropertyValue(prop) : null];
  })), marks);
  await page.evaluate(() => document.documentElement.style.setProperty('--reality', 'rgb(1, 2, 3)'));
  const themed = await paint();
  await page.evaluate(() => document.documentElement.style.removeProperty('--reality'));
  ok('tokens: every value mark follows the reality accent', Object.values(themed).every((v) => v === 'rgb(1, 2, 3)'), themed);

  console.log('\n[aspect]');
  const ctl = page.locator('.cell[data-pres=control] .field');
  await page.evaluate(() => window.__size(4, 4));
  ok('w = h is horizontal', await ctl.getAttribute('data-orient') === 'h');
  hub.mode = 'hold';
  const input = page.locator('.cell[data-pres=control] input[type=range]');
  await input.evaluate((el) => { el.dataset.mark = 'same'; });
  const before = await current();
  const target = before - FIELD.step * 2 >= FIELD.min ? before - FIELD.step * 2 : before + FIELD.step * 2;
  await input.evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, target);
  ok('a write is in flight before the flip', await waitShadow('control', 'pending', 1000));
  await page.evaluate(() => window.__size(2, 6));
  ok('w < h flips to vertical', await ctl.getAttribute('data-orient') === 'v');
  ok('the flip kept the same control (no remount)', await input.evaluate((el) => el.dataset.mark) === 'same');
  ok('the write is still in flight after the flip', ['pending', 'overdue'].includes(await shadowOf('control')));
  const box = await input.boundingBox();
  ok('the vertical slider runs along the long side', box && box.height > box.width, box);
  await release();
  ok('the in-flight write confirms after the flip', await waitShadow('control', 'confirmed'));
  ok('...at the applied value', near(await current(), target), [await current(), target]);
  hub.mode = 'echo';

  console.log('\n[safety module]');
  const so = page.locator('.cell[data-pres=safety] .safety-op');
  ok('a safety pair places as a module bound by identity', await so.locator('.lbl').textContent() === 'Pause');
  hub.mode = 'hold';
  await so.locator('button').click();
  ok('its press shows pending, in words', await so.locator('.state', { hasText: 'Waiting' })
    .waitFor({ timeout: 3000 }).then(() => true).catch(() => false));
  await release();
  ok('...and settles once the hub echoes', await page.waitForFunction(() => {
    const el = document.querySelector('.cell[data-pres=safety] .safety-op');
    return el.dataset.shadow === 'confirmed' && !/waiting|refused/.test(el.textContent);
  }, null, { timeout: 3000 }).then(() => true).catch(() => false));
  hub.mode = 'echo';

  if (ACTION) {
    console.log('\n[action ladder] (ph-vdk.58)');
    const act = page.locator('.cell[data-pres=action] .field.action');
    const actState = () => act.getAttribute('data-shadow');
    const actWait = async (want, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await actState() === want) return true; await sleep(20); }
      return false;
    };
    hub.mode = 'silent';
    await act.locator('.ops button').first().click();
    ok('action: pending on the press', await actWait('pending', 1000));
    ok('action: overdue past 500 ms with no echo', await actWait('overdue', 1500));
    ok('action: overdue names itself in words', /still waiting/.test(await act.locator('.state').textContent()));
    ok('action: fault when the echo never comes', await actWait('fault', 3000));
    ok('action: fault gives the reason', (await act.locator('.state').textContent()).includes(NO_ANSWER));
    ok('action: the fault wears amber, never the e-stop red', !(await wearsBad('.cell .field.action')));
    // The silent intent's session timeout lands about 1 s after the fault; a newer press must not feel it.
    hub.mode = 'hold';
    await act.locator('.ops button').first().click();
    await sleep(1300);
    const mid = await actState();
    ok('action: a press in flight survives the silent intent timing out', mid === 'pending' || mid === 'overdue', mid);
    await release();
    ok('action: ...and confirms on its own echo', await actWait('confirmed', 3000));
    hub.mode = 'echo';

    console.log('\n[secret action payload] (ph-vic)');
    const SECRET = 'hunter2-not-on-screen';
    const a = page.locator('.cell[data-pres=action] .field.action');
    const pw = a.locator('.payload input[type=password]');
    ok('a secret text payload is masked', await pw.count() >= 1 && await a.locator('.payload input[type=text]').count() === 0);
    await pw.first().fill(SECRET);
    const num = a.locator('.payload input[type=number]');
    if (await num.count()) await num.first().fill('23');
    await a.locator('.ops button').first().click();
    const confirmed = await a.locator('.state', { hasText: 'confirmed' }).waitFor({ timeout: 4000 })
      .then(() => true).catch(() => false);
    ok('the press reaches confirmed', confirmed);
    ok('the status text never carries the secret', !(await a.textContent()).includes(SECRET));
    ok('the secret draft is cleared after the press', await pw.first().inputValue() === '');
  }

  // The same ladder through a placement look (RFC-080 by ruling, ph-huv).
  console.log('\n[look] a two-valued toggle and a narrowed range');
  const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(20); } return false; };
  const lk = (key) => page.locator('.cell[data-pres="' + key + '"] .field');
  const lkIs = (key, want, re) => async () => await lk(key).getAttribute('data-shadow') === want
    && (!re || re.test(await lk(key).locator('.ladder').textContent()));
  const lkSlot = (key) => lk(key).locator('.ladder').textContent();
  const wroteTo = (f) => { const w = hub.log.filter((x) => x.ch === f.writeChannel).at(-1); const kv = w && w.val.find(([k]) => k === f.settingKey); return kv && kv[1]; };

  hub.mode = 'echo';
  const tg = lk(TWO_KEY), tgBox = tg.locator('input[type=checkbox]');
  await setReported(TWO, 1);
  ok('two-valued toggle: off while the machine reports A', !(await tgBox.isChecked()));
  hub.mode = 'hold';
  await tg.locator('.og-switch').click();
  ok('two-valued toggle: pending in words', await until(lkIs(TWO_KEY, 'pending', /waiting/), 1000), await lkSlot(TWO_KEY));
  ok('two-valued toggle: overdue past 500 ms', await until(lkIs(TWO_KEY, 'overdue'), 1500));
  await release();
  ok('two-valued toggle: the press writes B', wroteTo(TWO) === 2, wroteTo(TWO));
  ok('two-valued toggle: confirmed on the echo, on at B', await until(lkIs(TWO_KEY, 'confirmed')) && await tgBox.isChecked());
  hub.mode = 'echo';
  await tg.locator('.og-switch').click();
  ok('two-valued toggle: a second press writes A and confirms off', await until(async () => wroteTo(TWO) === 1
    && await lkIs(TWO_KEY, 'confirmed')() && !(await tgBox.isChecked())), wroteTo(TWO));
  hub.mode = 'silent';
  await tg.locator('.og-switch').click();
  ok('two-valued toggle: fault when the echo never comes, in words', await until(lkIs(TWO_KEY, 'fault', new RegExp(NO_ANSWER)), 4000),
    await lkSlot(TWO_KEY));
  hub.mode = 'nack';
  const tgWas = await tgBox.isChecked();
  await tg.locator('.og-switch').click();
  ok('two-valued toggle: fault on a NACK, the code in words', await until(lkIs(TWO_KEY, 'fault', /INVALID_VALUE/), 1500), await lkSlot(TWO_KEY));
  ok('two-valued toggle: ...and the switch shows the machine again', await until(async () => await tgBox.isChecked() === tgWas));

  hub.mode = 'echo';
  const nr = lk(NARROW_KEY), nrIn = nr.locator('input[type=range]');
  const nrSet = (v) => nrIn.evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const onStep = (a, b) => Math.abs(a - b) <= NARROW.step / 2;
  ok('narrowed: the slider spans the placement range', onStep(Number(await nrIn.getAttribute('min')), NLO)
    && onStep(Number(await nrIn.getAttribute('max')), NHI), [await nrIn.getAttribute('min'), await nrIn.getAttribute('max'), NLO, NHI]);
  await setReported(NARROW, NARROW.min);
  ok('narrowed: a reported value outside the range is marked in the slot, never pinned',
    /out of range/.test(await lkSlot(NARROW_KEY)) && onStep(Number(await nr.locator('.chip-num').inputValue()), NARROW.min),
    [await lkSlot(NARROW_KEY), await nr.locator('.chip-num').inputValue()]);
  hub.mode = 'hold';
  const nMid = NLO + Math.round((NHI - NLO) / 2 / NARROW.step) * NARROW.step;
  await nrSet(nMid);
  ok('narrowed: pending in words', await until(lkIs(NARROW_KEY, 'pending', /waiting/), 1000), await lkSlot(NARROW_KEY));
  ok('narrowed: overdue past 500 ms', await until(lkIs(NARROW_KEY, 'overdue'), 1500));
  await release();
  ok('narrowed: confirmed on the echo, the written value inside the range', await until(lkIs(NARROW_KEY, 'confirmed'))
    && onStep(wroteTo(NARROW), nMid) && wroteTo(NARROW) >= NLO - NARROW.step / 2 && wroteTo(NARROW) <= NHI + NARROW.step / 2,
    [wroteTo(NARROW), nMid]);
  hub.mode = 'silent';
  await nrSet(NLO);
  ok('narrowed: fault when the echo never comes, in words', await until(lkIs(NARROW_KEY, 'fault', new RegExp(NO_ANSWER)), 4000),
    await lkSlot(NARROW_KEY));
  hub.mode = 'nack';
  await nrSet(NHI);
  ok('narrowed: fault on a NACK, the code in words', await until(lkIs(NARROW_KEY, 'fault', /INVALID_VALUE/), 1500), await lkSlot(NARROW_KEY));
  hub.mode = 'echo';

  // ---- density rungs and targets (ph-z50z, ph-46yw, ph-1ggd, ph-3z96) ----------
  // Compact below 18rem, normal above; the ladder slot keeps the width of
  // 'still waiting' at a 10-cell field (a 4-cell one holds the chip alone); under a coarse pointer
  // every hit target in both rungs is 40 px, the reset button and bit rows too.
  const setW = (pg, px) => pg.evaluate((w) => document.querySelectorAll('.cell').forEach((c) => { c.style.width = w + 'px'; }), px);
  const slotW = (p) => cell(p).locator('.ladder').evaluate((e) => e.getBoundingClientRect().width);
  // Head children that overlap, as label pairs; hit boxes count (a tap must land on one thing).
  const OVERLAPS = () => [...document.querySelectorAll('.field-head')].flatMap((h) => {
    const kids = [...h.querySelectorAll('.field-label-text, button.info, .ladder, .field-value')].filter((e) => e.getClientRects().length)
      .map((e) => [e.className || e.tagName, e.getBoundingClientRect()]);
    const out = [];
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i][1], b = kids[j][1];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(kids[i][0] + ' x ' + kids[j][0] + ' ' + [a.left, a.right, b.left, b.right].map(Math.round));
    }
    return out;
  });
  const gapOf = (p) => cell(p).evaluate((e) => getComputedStyle(e.querySelector('.field-head')).columnGap);
  for (const [cells, px] of [[4, 4 * 36 + 16], [10, 10 * 36 + 16]]) {
    await setW(page, px);
    if (SHOTS) await page.locator('.row').first().screenshot({ path: join(SHOTS, 'rung-' + cells + '-cells.png') });
    if (cells > 4) for (const p of WRITERS) ok(p + ' at ' + cells + ' cells: the status slot holds a still-waiting word', await slotW(p) >= 70, await slotW(p));
    if (cells === 4) {
      const labW = await page.$$eval('.field-label-text', (els) => els.filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().width)));
      const clipped = await page.$$eval('.chip-num', (els) => els.filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth).length);
      ok('4 cells: no typeable chip clips its number', clipped === 0, clipped);
      ok('4 cells: every label keeps 3em', labW.length > 0 && labW.every((w) => w >= 34), labW);
    }
    ok(cells + ' cells: no head children overlap', (await page.evaluate(OVERLAPS)).length === 0, await page.evaluate(OVERLAPS));
    ok(cells + ' cells: ' + (cells < 8 ? 'compact' : 'normal') + ' rung head gap',
      Math.abs(parseFloat(await gapOf('slider')) - (cells < 8 ? 4.48 : 8.96)) < 0.05, await gapOf('slider'));
  }
  await setW(page, 280);
  const ctxT = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true });
  await ctxT.addInitScript(([etag, bytes]) => {
    try { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); } catch (e) { /* none */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await ctxT.routeWebSocket(/:82\//, fakeHub);
  const pt = await ctxT.newPage();
  await pt.goto(page.url());
  await pt.waitForSelector('.cell[data-pres=slider] input[type=range]:not([disabled])', { timeout: 15000 });
  for (const px of [4 * 36 + 16, 10 * 36 + 16]) {
    await setW(pt, px);
    const small = await pt.$$eval('.field :is(button.info, .bitfield .bit, input[type=range], select, .og-switch, .stepper button)', (els) =>
      els.filter((e) => e.getClientRects().length).map((e) => {
        const r = e.getBoundingClientRect();
        return { c: String(e.className || e.tagName), w: Math.round(r.width), h: Math.round(r.height) };
      }).filter((r) => r.h < 39.5 || (r.c.includes('info') && r.w < 39.5)));
    ok('coarse at ' + px + ' px: every hit target is 40 px, .info.reset included', small.length === 0, small);
    ok('coarse at ' + px + ' px: no head hit box overlaps another', (await pt.evaluate(OVERLAPS)).length === 0, await pt.evaluate(OVERLAPS));
  }
  ok('coarse: a reset button is on the page to measure', await pt.locator('.field button.info.reset').count() > 0);
  await ctxT.close();
} else {
  // ---- live: each presentation confirmed on a second, raw session (C-8) ------
  // The raw session holds a /uitoken only to put back what this pass wrote.
  const cache = new Map();
  const seen = new Map();
  const wire = createSession({
    host: HOST, port: SIM_PORT, clientKind: 'webui', clientName: 'control-contract wire watcher', autoReconnect: false,
    catalogStore: { load: (h) => cache.get(h) || null, save: (h, e, b) => cache.set(h, { etag: e, bytes: b }), clear: (h) => cache.delete(h) },
    subscriptions: [...new Set([STATE_CH, TWO.channelId, NARROW.channelId])].map((ch) => [ch, 0, 1]),
    token: (h) => acquireToken(h + ':' + SIM_HTTP),
  });
  wire.on('state', (ch, sample) => seen.set(ch, sample));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('wire session never went live')), 8000);
    wire.on('live', () => { clearTimeout(t); resolve(); });
    wire.connect();
  });
  const wireVal = (f) => seen.get(f.channelId) && seen.get(f.channelId)[f.name];
  const found = Object.fromEntries([FIELD, TWO, NARROW].map((f) => [f.uid, wireVal(f)]));
  const wireSees = async (f, want, eq = (a, b) => a === b) => {
    for (let i = 0; i < 40 && !eq(wireVal(f), want); i++) await sleep(50);
    return eq(wireVal(f), want);
  };
  const tg = page.locator('.cell[data-pres="' + TWO_KEY + '"] .field');
  const press = () => tg.locator('.og-switch').click();
  if (wireVal(TWO) === 2) { await press(); await wireSees(TWO, 1); }   // start from off
  for (const [want, ab] of [[2, 'B'], [1, 'A']]) {
    await press();
    ok('two-valued toggle: a press shows ' + ab + ' applied on the second session', await wireSees(TWO, want), wireVal(TWO));
    let agrees = false;
    for (let i = 0; i < 40 && !agrees; i++) { agrees = await tg.locator('input[type=checkbox]').isChecked() === (want === 2); if (!agrees) await sleep(50); }
    ok('two-valued toggle: ...and the switch agrees', agrees);
  }
  const nr = page.locator('.cell[data-pres="' + NARROW_KEY + '"] .field');
  const nMid = NLO + Math.round((NHI - NLO) / 2 / NARROW.step) * NARROW.step;
  await nr.locator('input[type=range]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, nMid);
  ok('narrowed: the second session sees the value written inside the placement range',
    await wireSees(NARROW, nMid, (a, b) => Math.abs(a - b) <= NARROW.step / 2), wireVal(NARROW));
  for (const p of WRITERS) {
    const want = await drive(p);
    // The slot's text, not its visibility: below ~345 px the slider's slot is
    // 0 px wide (ph-46yw), which is a layout bead, not this contract.
    let settled = false;
    for (let i = 0; i < 80 && !settled; i++) {
      settled = await shadowOf(p) === 'confirmed' && near(await current(), want);
      if (!settled) await sleep(50);
    }
    ok(p + ': the page reaches confirmed (post-ECHO)', settled, await ladderOf(p));
    let onWire;
    for (let i = 0; i < 40; i++) { onWire = seen.get(STATE_CH) && seen.get(STATE_CH)[FIELD.name]; if (near(onWire, want)) break; await sleep(50); }
    ok(p + ': the second session sees ' + FIELD.name + ' = ' + want, near(onWire, want), onWire);
    await sleep(1000);
  }
  for (const f of [FIELD, TWO, NARROW]) {
    if (found[f.uid] == null) continue;
    await wire.sendIntent(f.writeChannel, { [f.settingKey]: found[f.uid] })
      .catch((e) => ok('restore ' + f.uid + ' to ' + found[f.uid], false, e.message));
  }
  try { wire.close(); } catch (e) { /* */ }
  await sleep(300);
}

ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3));
await page.goto('about:blank').catch(() => {});
await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- control contract'));
process.exit(fails ? 1 : 0);
