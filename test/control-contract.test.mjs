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
 * destructive toggle's confirm (ph-vdk.60.5).
 *
 * Live mode (--live): the same page against a running valencesim; one
 * slider-class field driven through slider, knob and stepper, each value
 * confirmed on a second, raw session (C-8). Skips (exit 0) when no sim answers.
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
import { buildSettingsModel, WIDGET } from '../src/model/settings.js';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const LIVE = args.includes('--live');
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
// bitfield and no destructive toggle, so one synthetic setting channel pair
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
    ])], [14, cbUint(XI)]]);
  const intent = cbMap([[1, cbUint(XI)], [2, cbTstr('fixture-extras-set')], [3, cbUint(2)], [4, cbUint(1)], [5, cbUint(1)],
    [6, cbF32(5)], [7, cbUint(1)], [9, cbMap([[1, sf('label_text', CBOR_FIELD.tstr_t)], [2, sf('lamp_bits', CBOR_FIELD.uint_t)],
      [3, sf('arm', CBOR_FIELD.uint_t)]])]]);
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
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
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
const hub = { mode: 'echo', held: [], values: { [XS + ':label_text']: 'alpha' }, mute: false, push: null };
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
  toggle: unroled(WIDGET.toggle).find((f) => !(f.flagBits && f.flagBits.destructive)),
  segmented: CHOICES[0],
  select: CHOICES[1],
  text: MODEL.fields.find((f) => f.uid === XS + ':label_text'),
  bitfield: MODEL.fields.find((f) => f.uid === XS + ':lamp_bits'),
};
const ARM = MODEL.fields.find((f) => f.uid === XS + ':arm');
const MORE = [...(SMALL ? ['numeral@' + SMALL.uid] : []),
  ...Object.entries(LADDER).filter(([, f]) => f).map(([p, f]) => p + '@' + f.uid), 'toggle@' + ARM.uid];
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
  const xheight = async (p) => (await xcell(p).boundingBox()).height;
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
    const h0 = await xheight(p);
    const sameH = async (st) => ok(p + ': the same height ' + st, Math.abs(await xheight(p) - h0) < 0.5, [h0, await xheight(p)]);
    hub.mode = 'hold';
    const [read, want] = await xdrive(p);
    ok(p + ': pending while the hub holds the echo', await xwait(p, 'pending', 1000));
    ok(p + ': pending names itself in words', (await xladder(p)).includes('waiting'), await xladder(p));
    await sameH('pending');
    ok(p + ': overdue past 500 ms', await xwait(p, 'overdue', 1500));
    await sameH('overdue');
    await release();
    ok(p + ': confirmed on the echo, in words', await xwait(p, 'confirmed') && (await xladder(p)) === 'confirmed', await xladder(p));
    ok(p + ': the control shows the applied value', await read() === want, [await read(), want]);
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
  await dialog.locator('button.danger').click();
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

  // Every transient has one fixed home (laws 3, 5, 8): the field's height is
  // the same idle, pending, overdue, fault, grayed and stale.
  console.log('\n[anatomy]');
  const heights = () => page.evaluate((ps) => Object.fromEntries(ps.map((p) =>
    [p, document.querySelector('.cell[data-pres=' + p + '] .field').getBoundingClientRect().height])), PRES);
  const idle = await heights();
  const same = async (state) => {
    const h = await heights();
    for (const p of PRES) ok(p + ': the same height ' + state, Math.abs(h[p] - idle[p]) < 0.5, [idle[p], h[p]]);
  };
  hub.mode = 'hold';
  await drive('slider');
  ok('a write is pending', await waitShadow('slider', 'pending', 1000));
  await same('pending');
  ok('...then overdue', await waitShadow('slider', 'overdue', 1500));
  await same('overdue');
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
  hub.mode = 'echo';

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
  ok('its press shows pending, in words', await so.locator('.state', { hasText: 'waiting for the machine' })
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
    ok('action: overdue names itself in words', /still waiting/.test(await act.locator('.hint.state').textContent()));
    ok('action: fault when the echo never comes', await actWait('fault', 3000));
    ok('action: fault gives the reason', (await act.locator('.hint.state').textContent()).includes(NO_ANSWER));
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
    const confirmed = await a.locator('.hint.state', { hasText: 'confirmed' }).waitFor({ timeout: 4000 })
      .then(() => true).catch(() => false);
    ok('the press reaches confirmed', confirmed);
    ok('the status text never carries the secret', !(await a.textContent()).includes(SECRET));
    ok('the secret draft is cleared after the press', await pw.first().inputValue() === '');
  }
} else {
  // ---- live: each presentation confirmed on a second, raw session (C-8) ------
  const cache = new Map();
  const seen = new Map();
  const wire = createSession({
    host: HOST, port: SIM_PORT, clientKind: 'webui', clientName: 'control-contract wire watcher', autoReconnect: false,
    catalogStore: { load: (h) => cache.get(h) || null, save: (h, e, b) => cache.set(h, { etag: e, bytes: b }), clear: (h) => cache.delete(h) },
    subscriptions: [[STATE_CH, 0, 1]],
  });
  wire.on('state', (ch, sample) => seen.set(ch, sample));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('wire session never went live')), 8000);
    wire.on('live', () => { clearTimeout(t); resolve(); });
    wire.connect();
  });
  for (const p of WRITERS) {
    const want = await drive(p);
    const settled = await cell(p).locator('.ladder', { hasText: 'confirmed' }).waitFor({ timeout: 4000 })
      .then(() => true).catch(() => false);
    ok(p + ': the page reaches confirmed (post-ECHO)', settled, await ladderOf(p));
    let onWire;
    for (let i = 0; i < 40; i++) { onWire = seen.get(STATE_CH) && seen.get(STATE_CH)[FIELD.name]; if (near(onWire, want)) break; await sleep(50); }
    ok(p + ': the second session sees ' + FIELD.name + ' = ' + want, near(onWire, want), onWire);
    await sleep(1000);
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
