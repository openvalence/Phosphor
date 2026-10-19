/**
 * flasher-browser.test.mjs -- the Firmware card on the System page (DESIGN
 * §10.19) in the shell bundle, the Rust half and the machine stubbed: pick,
 * the press wait, the upload, the restart, done; a refusal and a rollback;
 * the card's height in every state.
 *
 * Screenshots: test/evidence/flasher/ at 1428x900, 1024x768 and 420x860.
 * Run: node test/flasher-browser.test.mjs   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { cbMap, cbUint, cbBstr, cbTstr, cbBool, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K } from '../../Valence/clients/js/frames.js';

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };
const SHOTS = fileURLToPath(new URL('./evidence/flasher/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const BENCH = new URL('../../Nucleus/flagship_p4/.pio/build/flagship_p4_bench/firmware.bin', import.meta.url);
function fixtureImage() {
  const b = new Uint8Array(200 * 1024);
  const dv = new DataView(b.buffer);
  b[0] = 0xe9; dv.setUint16(12, 0x12, true); dv.setUint32(32, 0xabcd5432, true);
  const put = (o, s) => b.set(new TextEncoder().encode(s), o);
  put(48, 'abc1234'); put(80, 'flagship_p4'); put(128, 'Oct 18 2026'); put(4000, '0.1.60-p4hub');
  return Buffer.from(b);
}
const IMAGE = existsSync(BENCH) ? { name: 'firmware.bin', buffer: readFileSync(BENCH) } : { name: 'firmware.bin', buffer: fixtureImage() };
const S3 = (() => { const b = fixtureImage(); b.writeUInt16LE(9, 12); return { name: 's3.bin', buffer: b }; })();

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/neutrino-catalog.etag', import.meta.url), 'utf8').trim();
const SHELL = await buildShellPage();
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch();

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
          [K.roles, cbUint(1)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.hub_name, cbTstr('bench')],
            [IDENTITY_K.estop_cuts_power, cbBool(true)]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const m = cbDecodeFull(payload);
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray((m.get(K.subscriptions) || []).map((w) => cbMap([
          [K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
          [K.channel_id, cbUint(w.get(K.channel_id))]])))]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

// The machine and the Rust half, in the page. window.__fw steers it: arm (status, text), press, upload (status),
// release (the upload finishes), after ('done' | 'rollback').
function MACHINE_STUB() {
  const fw = window.__fw = { arm: [202, '{"id":"0badf00d","window_s":60}'], press: false, upload: 200, release: false, after: 'done', uploaded: false, polls: 0 };
  const cbs = new Map();
  let n = 5000, rid = 0;
  const reqs = new Map();
  const HEAD = (ver, slot, up) => `# nucleus-p4 ${ver} git=x slot=${slot} img=valid boot=1 reset=software up=${up}s\n# archive`;
  const answer = (method, url) => {
    if (url.includes('api.github.com')) return [200, '[]'];
    if (url.includes('/diag')) {
      if (!fw.uploaded) return [200, HEAD('0.1.58-p4hub-bench', 'ota_0', 900)];
      return fw.after === 'rollback' ? [200, HEAD('0.1.58-p4hub-bench', 'ota_0', 3)] : [200, HEAD('0.1.60-p4hub', 'ota_1', 3)];
    }
    if (url.includes('/ota/arm?id=')) { fw.polls++; return [200, JSON.stringify({ state: fw.press ? 'approved' : 'pending' })]; }
    if (method === 'POST' && url.endsWith('/ota/arm')) return fw.arm;
    return [404, ''];
  };
  const stub = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.transformCallback = (cb) => { cbs.set(++n, cb); return n; };
  const listeners = new Map();
  const handlers = {
    'plugin:http|fetch': ({ clientConfig: c }) => { reqs.set(++rid, answer(c.method, c.url)); return rid; },
    'plugin:http|fetch_send': ({ rid: r }) => ({ status: reqs.get(r)[0], statusText: '', url: '', headers: [], rid: r }),
    'plugin:http|fetch_read_body': ({ rid: r }) => {
      const q = reqs.get(r);
      if (q[1] == null) return new Uint8Array([1]).buffer;
      const b = new TextEncoder().encode(q[1]); q[1] = null;
      const out = new Uint8Array(b.length + 1); out.set(b); return out.buffer;
    },
    'plugin:http|fetch_cancel_body': () => null,
    'plugin:event|listen': ({ event, handler }) => { listeners.set(handler, event); return handler; },
    'plugin:event|unlisten': ({ eventId }) => { listeners.delete(eventId); return null; },
    ota_upload: async (bytes, opts) => {
      fw.id = opts.headers['x-ota-id']; fw.host = opts.headers['x-ota-host']; fw.bytes = bytes.byteLength;
      const emit = (p) => { for (const [h, ev] of listeners) if (ev === 'ota-progress') cbs.get(h)?.({ event: ev, id: h, payload: p }); };
      emit(Math.floor(bytes.byteLength * 0.4));
      while (!fw.release) await new Promise((r) => setTimeout(r, 50));
      fw.uploaded = fw.upload === 200;
      return fw.upload === 200 ? [200, 'ok slot=ota_1'] : [fw.upload, 'not approved: POST /ota/arm, then double-press PAIR on the machine'];
    },
  };
  window.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => (cmd in handlers ? Promise.resolve(handlers[cmd](args, opts)) : stub(cmd, args, opts));
}

// The System tab is clicked at desktop width (a phone keeps it in its menu), then the viewport is set.
async function boot(viewport = { width: 1428, height: 900 }) {
  const ctx = await browser.newContext({ viewport: { width: 1428, height: 900 } });
  await ctx.addInitScript(([etag, catHex]) => {
    try {
      if (!sessionStorage.getItem('booted')) {
        sessionStorage.setItem('booted', '1');
        localStorage.clear();
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1', host: '127.0.0.1', port: 82, name: 'bench', nickname: '', lastSeen: Date.now() }]));
        localStorage.setItem('shell_mode', 'ws');
      }
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes: catHex }));
    } catch (e) { /* no storage */ }
  }, [ETAG, Buffer.from(CAT).toString('hex')]);
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(MACHINE_STUB);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  const sys = page.locator('[data-tab-id^="cat"]', { hasText: /^\s*System\s*$/ }).first();
  await sys.waitFor({ timeout: 20000 });
  await sys.click();
  await page.setViewportSize(viewport);
  await page.waitForSelector('.fw', { timeout: 5000 });
  await page.waitForFunction(() => /ota_0/.test(document.querySelector('.fw dd')?.textContent || ''), null, { timeout: 5000 });
  return { ctx, page, errors };
}
const status = (page) => page.$eval('.fw .pane-status', (p) => p.textContent.trim());
const until = (page, re, timeout = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.fw .pane-status')?.textContent || ''), re.source, { timeout });
const fwBox = (page) => page.$eval('.fw', (e) => Math.round(e.getBoundingClientRect().height));
const shot = async (page, name) => {
  await page.locator('.fw').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, name + '.png') });
};

console.log('\n--- the whole flow at 1428x900 ---');
{
  const { ctx, page, errors } = await boot();
  const heights = [await fwBox(page)];
  ok('the card heads the System page and reads what runs', (await page.$eval('.fw dd', (d) => d.textContent)) === '0.1.58-p4hub-bench · ota_0');
  ok('Update waits for a file', await page.isDisabled('.fw button.primary'));
  await shot(page, '1428-empty');
  await page.setInputFiles('.fw input[type=file]', S3);
  await until(page, /Built for ESP32-S3/);
  ok('a wrong chip is refused at pick, Update stays off', await page.isDisabled('.fw button.primary'), await status(page));
  heights.push(await fwBox(page));
  await page.setInputFiles('.fw input[type=file]', { ...IMAGE, mimeType: 'application/octet-stream' });
  await page.waitForFunction(() => /Can't check/.test(document.querySelector('.fw dd[data-kind]')?.textContent || ''), null, { timeout: 5000 });
  const facts = await page.$$eval('.fw dd', (ds) => ds.map((d) => d.textContent.trim()));
  ok('the image facts and the origin show', /^\d+\.\d+\.\d+-p4hub\S* · flagship_p4 · /.test(facts[2]) && facts[3] === "Can't check: no published checksums", facts.join(' | '));
  ok('Update is ready', !(await page.isDisabled('.fw button.primary')));
  heights.push(await fwBox(page));
  await shot(page, '1428-picked');
  await page.click('.fw button.primary');
  await until(page, /^Double-press PAIR on the machine · \d+ s$/);
  heights.push(await fwBox(page));
  await shot(page, '1428-press');
  await page.evaluate(() => { window.__fw.press = true; });
  await until(page, /^Sending$/);
  await page.waitForFunction(() => document.querySelector('.fw [role=progressbar]')?.getAttribute('aria-valuenow') === '40');
  ok('the upload carries the armed id to the hub', await page.evaluate(() => window.__fw.id === '0badf00d' && window.__fw.host === '127.0.0.1'));
  heights.push(await fwBox(page));
  await shot(page, '1428-sending');
  await page.evaluate(() => { window.__fw.release = true; });
  await until(page, /^Updated to 0\.1\.60-p4hub$/, 20000);
  ok('done reads the new version and the new slot', (await page.$eval('.fw dd', (d) => d.textContent)) === '0.1.60-p4hub · ota_1');
  heights.push(await fwBox(page));
  await shot(page, '1428-done');
  ok('no state changes the card height', new Set(heights).size === 1, heights.join(','));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- refusals at 1024x768 ---');
{
  const { ctx, page, errors } = await boot({ width: 1024, height: 768 });
  await page.evaluate(() => { window.__fw.arm = [409, 'motor power is on: latch the E-stop first']; });
  await page.setInputFiles('.fw input[type=file]', IMAGE);
  await page.waitForFunction(() => !document.querySelector('.fw button.primary')?.disabled);
  await page.click('.fw button.primary');
  await until(page, /^Motor power is on: latch the E-stop first$/);
  ok('409 on arm says the one action', (await page.$eval('.fw .pane-status', (p) => p.dataset.phase)) === 'fault');
  await shot(page, '1024-refused');
  await page.evaluate(() => { window.__fw.arm = [202, '{"id":"0badf00d","window_s":60}']; window.__fw.press = true; window.__fw.release = true; window.__fw.after = 'rollback'; });
  await page.click('.fw button.primary');
  await until(page, /^The new firmware failed to start: back on 0\.1\.58-p4hub-bench$/, 20000);
  ok('a rollback is said plainly', true);
  await shot(page, '1024-rollback');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n--- phone at 420x860 ---');
{
  const { ctx, page, errors } = await boot({ width: 420, height: 860 });
  await page.setInputFiles('.fw input[type=file]', IMAGE);
  await page.waitForFunction(() => !document.querySelector('.fw button.primary')?.disabled);
  await shot(page, '420-picked');
  await page.click('.fw button.primary');
  await until(page, /^Double-press PAIR/);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow', over <= 0, over);
  await shot(page, '420-press');
  await page.click('.fw button:has-text("Cancel")');
  ok('Cancel ends the wait at once', (await status(page)) === 'Cancelled');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
