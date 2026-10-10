/**
 * chunk-quiet.test.mjs -- NACK CHUNK_UNAVAILABLE in ordinary use (ph-2tjo): the
 * shell bundle against a private native valencesim, every BLOB_REQ and NACK read
 * off the wire through a pass-through socket route.
 *
 *   abort     a catalog transfer the hub aborts (SPEC 8.6: one CHUNK_UNAVAILABLE
 *             at intent_seq 0 after the first chunk, the rest withheld; injected)
 *             restarts and goes LIVE; the Link page lists no refusal, the Log's
 *             Session feed says the transfer restarted
 *   quiet     a cold session start plus 60 s of use draws no CHUNK_UNAVAILABLE:
 *             presets saved, loaded, renamed and deleted down to a hole, every
 *             page visited, the Dash and Generator remounted, a reconnect, the
 *             funscript player streaming; the Link page lists none
 *   relaunch  a new page on the same hub, a hole in the store: the session start
 *             asks no empty slot
 *   grow      a new etag announced on 0x0001 (injected: the sim declares no 0x0001)
 *             asks for the catalog once
 *
 * Needs ../Nucleus/sim/valencesim/build/valencesim.exe; SKIPs without it.
 * Run: node test/chunk-quiet.test.mjs
 * Constraints: the sim and the page run on private ports; the sim is killed on every exit path.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { parseFrames, encodeFrame, FRAME, NACK, K } from '../../Valence/clients/js/frames.js';
import { cbDecodeFull, cbMap, cbUint } from '../../Valence/clients/js/cbor.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { startSim } from './live-sim.mjs';
import { goTab } from './nav.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sim = await startSim();
if (!sim) { console.log('SKIP: no valencesim'); process.exit(0); }
const SHELL = await buildShellPage();
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + sim.http + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch();

// The shell mints through @tauri-apps/plugin-http; serviced here with the page's fetch, every
// /uitoken through the page's own origin (proxied to the sim), so a reconnect keeps its tier.
function HTTP_STUB() {
  const base = window.__TAURI_INTERNALS__.invoke;
  const held = new Map();
  let n = 0;
  window.__TAURI_INTERNALS__.invoke = async (cmd, a) => {
    if (cmd === 'plugin:http|fetch') { held.set(++n, { cfg: a.clientConfig }); return n; }
    if (cmd === 'plugin:http|fetch_send') {
      const h = held.get(a.rid);
      const r = await fetch(/\/uitoken$/.test(h.cfg.url) ? '/uitoken' : h.cfg.url, { method: h.cfg.method });
      h.body = [...new Uint8Array(await r.arrayBuffer())];
      return { status: r.status, statusText: r.statusText, url: h.cfg.url, headers: [...r.headers], rid: a.rid };
    }
    if (cmd === 'plugin:http|fetch_read_body') {
      const h = held.get(a.rid);
      if (h.body) { const b = h.body; h.body = null; return [...b, 0]; }
      return [1];
    }
    if (cmd.startsWith('plugin:http|')) return null;
    return base(cmd, a);
  };
}

// ---- the wire: every BLOB_REQ up, every NACK down, and the two injections ----
const wire = [];   // {t, up, ns, slot, full} up; {t, code, seq, injected} down
// abort: 'armed' -> 'withheld' (ns 0 chunks dropped until the client asks again) -> false
const tap = { abort: false, drop: false, links: [], etag: null };
const blobReq = (p) => {
  const m = cbDecodeFull(p), b = m.get(K.blob);
  return { ns: b && b.get(1) != null ? b.get(1) : 0, slot: b ? b.get(3) : undefined, full: !m.has(K.chunks) };
};
const nackOf = (p) => { const m = cbDecodeFull(p); return { code: m.get(K.code), seq: m.get(K.intent_seq) }; };
const reframe = (fs) => Buffer.concat(fs.map((f) => encodeFrame(f.header.type, f.header.channel, f.payload, f.header.seq, f.header.flags)));
// A route sends a Buffer as binary; any other byte array would go out as text.
const ABORT = Buffer.from(encodeFrame(FRAME.NACK, 0, cbMap([[K.code, cbUint(NACK.CHUNK_UNAVAILABLE)], [K.intent_seq, cbUint(0)]])));

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1428, height: 900 } });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(HTTP_STUB);
  await ctx.addInitScript(([port]) => {
    try {
      if (!localStorage.getItem('phosphor.hubs')) {
        localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      }
    } catch (e) { /* none */ }
  }, [sim.port]);
  await ctx.routeWebSocket(new RegExp(':' + sim.port + '/'), (ws) => {
    const server = ws.connectToServer();
    tap.links.push(ws);
    ws.onMessage((m) => {
      if (typeof m !== 'string') {
        for (const f of parseFrames(new Uint8Array(m))) {
          if (f.header.type !== FRAME.BLOB_REQ) continue;
          const r = blobReq(f.payload);
          wire.push({ t: Date.now(), up: true, ...r });
          if (r.ns === 0 && r.full && tap.abort === 'withheld') tap.abort = false;
        }
      }
      try { server.send(m); } catch (e) { /* closed */ }
    });
    server.onMessage((m) => {
      if (typeof m === 'string') { try { ws.send(m); } catch (e) { /* closed */ } return; }
      const fs = parseFrames(new Uint8Array(m));
      let abortAfter = false;
      const keep = [];
      for (const f of fs) {
        if (f.header.type === FRAME.NACK) wire.push({ t: Date.now(), up: false, ...nackOf(f.payload) });
        if (f.header.type === FRAME.WELCOME) tap.etag = cbDecodeFull(f.payload).get(K.catalog_etag);
        const chunk = f.header.type === FRAME.BLOB_CHUNK;
        if (chunk && f.payload[0] === 0 && tap.abort === 'armed') { tap.abort = 'withheld'; abortAfter = true; keep.push(f); continue; }
        if (chunk && (tap.drop || (f.payload[0] === 0 && tap.abort === 'withheld'))) continue;
        keep.push(f);
      }
      try {
        if (keep.length) ws.send(keep.length === fs.length ? m : reframe(keep));
        if (abortAfter) {
          ws.send(ABORT);
          wire.push({ t: Date.now(), up: false, code: NACK.CHUNK_UNAVAILABLE, seq: 0, injected: true });
        }
      } catch (e) { /* closed */ }
    });
    ws.onClose((c, r) => { try { server.close({ code: c, reason: r }); } catch (e) { /* gone */ } });
    server.onClose((c, r) => { try { ws.close({ code: c, reason: r }); } catch (e) { /* gone */ } });
  });
  return { ctx, page: await ctx.newPage() };
}
const unavailable = (since) => wire.filter((w) => !w.up && w.code === NACK.CHUNK_UNAVAILABLE && w.t >= since && !w.injected);
async function linkNacks(page) {
  await goTab(page, 'valence');
  await page.waitForSelector('#vp-nacks', { timeout: 10000 });
  return page.evaluate(() => document.querySelector('#vp-nacks').closest('section').innerText);
}

// ---- the presets row (the factory pattern card) ----
const R = 'main.pane';
const SEL = R + ' select[aria-label="Preset"]';
const live = (page) => page.waitForFunction((q) => { const e = document.querySelector(q); return e && !e.disabled; }, SEL, { timeout: 20000 });
const options = (page) => page.$eval(SEL, (e) => [...e.options].slice(1).map((o) => o.value + ':' + o.text).join(','));
const hasOption = (page, nm, yes = true) => page.waitForFunction(([q, n, y]) =>
  [...document.querySelector(q).options].some((o) => o.text === n) === y, [SEL, nm, yes], { timeout: 5000 });
async function saveAs(page, nm) {
  await live(page);
  await page.locator(R + ' button:text-is("Save")').first().click();
  await page.locator(R + ' input[aria-label="Preset name"]').first().fill(nm);
  await page.locator(R + ' button:text-is("Save as")').first().click();
  await hasOption(page, nm);
}
async function choose(page, label) {
  const v = await page.$eval(SEL, (e, l) => [...e.options].find((o) => o.text === l)?.value, label);
  await page.selectOption(SEL, v);
  await page.waitForTimeout(800);
}
async function remove(page, label) {
  await choose(page, label);
  await page.locator(R + ' button:text-is("Delete")').first().click();
  await page.locator('.overlay button.confirm').click();
  await hasOption(page, label, false);
}
async function dash(page, id = 'machine') { await goTab(page, id); await live(page); await page.waitForTimeout(600); }

// ---- abort: SPEC 8.6, the hub ends a catalog transfer when its etag moves ----
console.log('abort');
{
  const t0 = Date.now();
  tap.abort = 'armed';
  const { ctx, page } = await open();
  await page.goto(PAGE);
  await dash(page);
  const reqs = wire.filter((w) => w.up && w.ns === 0 && w.full && w.t >= t0);
  ok('the injected abort landed during the first catalog transfer', wire.some((w) => w.injected && w.t >= t0));
  ok('the transfer restarted and the session went LIVE: two full catalog requests', reqs.length === 2, reqs.length);
  const text = await linkNacks(page);
  ok('the Link page lists no refusal for the restart', !/CHUNK_UNAVAILABLE/.test(text), text);
  await goTab(page, 'log');
  await page.click('[data-feed="session"]');
  const feed = await page.locator('#lp-feed-session').innerText();
  ok('the Session feed says the catalog transfer restarted', /catalog/i.test(feed), feed.slice(0, 300));
  await ctx.close();
}

// ---- quiet: a cold session start plus 60 s of use ----
console.log('quiet');
const { ctx: ctx2, page } = await open();
{
  const t0 = Date.now();
  await page.goto(PAGE);
  await dash(page);
  const tLive = Date.now();
  for (const n of ['A', 'B', 'C']) await saveAs(page, n);
  await choose(page, 'B');
  await choose(page, 'C');
  await page.focus(SEL);
  await page.keyboard.press('F2');
  await page.locator(R + ' input[aria-label="Preset name"]').first().fill('C2');
  await page.keyboard.press('Enter');
  await hasOption(page, 'C2');
  await remove(page, 'B');
  await dash(page, 'cat1');
  await dash(page);
  await remove(page, 'A');
  await saveAs(page, 'D');
  ok('the presets read back where they are: D in the freed slot 0, C2 in 2, a hole at 1',
    await options(page) === '0:D,2:C2', await options(page));
  const tabs = await page.$$eval('[role=tab][data-tab-id]', (ts) => [...new Set(ts.map((t) => t.dataset.tabId))]);
  for (const id of tabs) { await goTab(page, id).catch(() => {}); await page.waitForTimeout(500); }
  await dash(page, 'cat1');
  await dash(page);
  // A reconnect: the hub side of the link drops, the page redials.
  for (const l of tap.links.splice(0)) await l.close({ code: 1001, reason: 'test drop' }).catch(() => {});
  await page.waitForTimeout(1500);
  await dash(page);
  ok('after the reconnect the presets read back the same', await options(page) === '0:D,2:C2', await options(page));
  // The funscript player streams while the Dash and Generator remount.
  const C = 'main.pane .fsp', TAB = 'plugin:funscript-player:player';
  for (let i = 0; i < 4 && !await page.locator(C).first().isVisible().catch(() => false); i++) {
    await goTab(page, TAB).catch(() => {});
    await page.waitForTimeout(800);
  }
  const actions = [];
  for (let at = 0, k = 0; at < 60000; k++, at += 300) actions.push({ at, pos: 45 + (k % 2) * 10 });
  await page.setInputFiles(C + ' .fsp-files', [{ name: 'gentle.funscript', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: '1.0', range: 100, actions })) }]);
  await page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 15000 });
  await page.locator(C + ' .fsp-play').evaluate((e) => e.click());
  await page.waitForTimeout(5000);
  await dash(page);
  await dash(page, 'cat1');
  await goTab(page, TAB);
  await page.waitForTimeout(3000);
  await page.locator(C + ' .fsp-play').evaluate((e) => e.click()).catch(() => {});
  while (Date.now() - tLive < 60000) await sleep(500);
  const bad = unavailable(t0);
  ok('a cold session start plus 60 s of use: zero CHUNK_UNAVAILABLE', bad.length === 0, bad);
  ok('... over real store reads', wire.filter((w) => w.up && w.ns === 1 && w.t >= t0).length > 0);
  const text = await linkNacks(page);
  ok('the Link page lists no CHUNK_UNAVAILABLE', !/CHUNK_UNAVAILABLE/.test(text), text);
  await page.close();
}

// ---- relaunch: a new page, the same hub, a hole in the store ----
console.log('relaunch');
const page3 = await ctx2.newPage();
{
  const t0 = Date.now();
  await page3.goto(PAGE);
  await dash(page3);
  await page3.waitForFunction((q) => document.querySelector(q).options.length === 3, SEL, { timeout: 10000 });
  ok('the relaunched page reads the presets', await options(page3) === '0:D,2:C2', await options(page3));
  await dash(page3, 'cat1');
  const bad = unavailable(t0);
  ok('the session start asks no empty slot', bad.length === 0, bad);
}

// ---- grow: a new etag announced mid-session ----
console.log('grow');
{
  ok('the WELCOME etag was seen', !!tap.etag);
  // The registry's 0x0001 layout: the 8 etag bytes, chunk_count u16, entry_count u16.
  const meta = (etag) => { const p = new Uint8Array(12); p.set(etag.subarray(0, 8)); return p; };
  const announce = (p, seq) => { for (const l of tap.links) l.send(Buffer.from(encodeFrame(FRAME.STATE, 1, p, seq))); };
  announce(meta(tap.etag), 1);   // the etag this session holds: nothing to fetch
  await sleep(300);
  const moved = Uint8Array.from(tap.etag);
  moved[0] ^= 0xff;
  const t0 = Date.now();
  tap.drop = true;   // no transfer completes inside the window, so nothing restarts in it
  announce(meta(moved), 2);
  await sleep(400);
  const reqs = wire.filter((w) => w.up && w.ns === 0 && w.full && w.t >= t0);
  tap.drop = false;
  ok('the held etag announced again asks for nothing', wire.filter((w) => w.up && w.ns === 0 && w.t >= t0 - 300 && w.t < t0).length === 0);
  ok('a new etag asks for the catalog once', reqs.length === 1, reqs.length);
}

await browser.close();
console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS');
process.exit(fails ? 1 : 0);
