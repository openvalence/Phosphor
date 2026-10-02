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
 * on silence, each with its text reason; display-only presentations write
 * nothing; an aspect flip at w = h swaps orientation without dropping a write
 * in flight; a secret action payload masks and never reaches the status text
 * (ph-vic).
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
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, LIMITS, NACK, CBOR_FIELD } from '../../Valence/clients/js/frames.js';
import { createSession } from '../../Valence/clients/js/index.js';
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

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);
const MODEL = buildSettingsModel(ENTRIES);
// The first writable, unroled slider-class field: no hero claims it anywhere.
const FIELD = MODEL.fields.find((f) => !f.readOnly && !f.role && f.widget === WIDGET.slider && f.step);
const STATE_CH = FIELD.channelId;
const ACTION = MODEL.actions.find((a) => a.payload && a.payload.some((p) => p.type === CBOR_FIELD.tstr_t));

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
const hub = { mode: 'echo', held: [], values: {} };
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
      if (header.type === FRAME.HELLO) {
        send(FRAME.WELCOME, 0, cbMap([
          [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
          [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(ETAG, 'hex')))], [K.cfg_gen, cbUint(1)],
          [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
            [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
          [K.roles, cbUint(2)], [K.deadman_ms, cbUint(600000)],
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
        if (hub.mode === 'echo') answer();
        else if (hub.mode === 'hold') hub.held.push(answer);
        else if (hub.mode === 'nack') {
          send(FRAME.NACK, ch, cbMap([[K.code, cbUint(NACK.INVALID_VALUE)], [K.detail, cbTstr('fixture refusal')],
            [K.intent_id, cbUint(id)]]));
        }
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
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
const PRES = [...WRITERS, 'numeral', 'bar'];
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
  + '&pres=' + PRES.join(',') + (ACTION && !LIVE ? '&action=' + encodeURIComponent(ACTION.uid) : ''));
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
    ok(p + ': fault gives the reason', /refused: no echo/.test(await cell(p).locator('.field-error').textContent()));
    // The unanswered intent's own session timeout (3 s) lands later on the same
    // shadow record; let it drain so it cannot touch the next write (ph-6i9).
    await sleep(1200);

    hub.mode = 'nack';
    await drive(p);
    ok(p + ': fault on a NACK', await waitShadow(p, 'fault', 1500));
    ok(p + ': the NACK code is the reason', /INVALID_VALUE/.test(await cell(p).locator('.field-error').textContent()),
      await cell(p).locator('.field-error').textContent());
    hub.mode = 'echo';
    await sleep(100);
  }

  console.log('\n[display-only]');
  for (const p of ['numeral', 'bar']) {
    ok(p + ': a read-only presentation of a writable field has no control',
      await page.locator('.cell[data-pres=' + p + '] :is(input, button.info.reset, [role=slider])').count() === 0);
    ok(p + ': ...and no gate reason, because nothing is gated', await cell(p).locator('.field-reason').count() === 0);
  }

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
