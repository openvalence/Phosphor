/**
 * graph-editor.test.mjs -- the node editor (ph-e82.13.7) in the real shell
 * bundle (shell-build.mjs, stub Tauri runtime answering bp_devices with one
 * toy) against a fake hub serving the recorded valencesim catalog. Asserts:
 *   place     the add menu (right-click) places a source field and a toy
 *             output at the cursor
 *   connect   a drag from the field's output socket to the toy's input
 *             socket makes a client edge with its map node and two wires,
 *             and the source's live value rides the wire
 *   refuse    the toy driving itself through a map shows the loop refusal
 *             at the cursor while hovering and again on the drop, in amber,
 *             never --bad (law 13); nothing is wired
 *   delete    a selected map node goes with Delete; Ctrl+Z brings it back;
 *             a clicked wire is selected and Delete cuts it, leaving a draft
 *   view      wheel zoom and a drag pan keep every wire end on its socket
 *   keyboard  Enter on two sockets wires them with no mouse
 *   select    Shift+drag box-selects; Duplicate copies a map, unwired
 *   full      full size fills the window below the top strip
 *   touch     the stored graph comes back; law 12 (40 px sockets) under a
 *             touch pointer; two fingers pinch-zoom
 *
 * Deliberately NOT part of `npm run check` (it launches a browser).
 * Run: node test/graph-editor.test.mjs [--shot <png>]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED } from '../../Valence/clients/js/frames.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { STORAGE_KEY } from '../src/model/graph.js';

const SHOT = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const CAT = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const ETAG = readFileSync(new URL('./fixtures/valencesim-catalog.etag', import.meta.url), 'utf8').trim();
const ENTRIES = decodeCatalog(CAT);

// ---- the fake hub: STATE from the catalog, INTENT echoed ----------------------
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
function fieldValue(f) {
  if (f.role === 'meta.enabled_mask') return 0xff;
  if (f.default != null) return Number(f.default);
  if (f.min != null && f.max != null) return f.min + (f.max - f.min) * 0.4;
  return 0;
}
function encodePacked(e) {
  const out = new Uint8Array(e.layout.reduce((a, f) => a + (SIZE[f.type] ?? f.declaredSize ?? 0), 0));
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of e.layout) {
    const v = fieldValue(f);
    const raw = f.type === PACKED.f32 || f.type === PACKED.bitfield8 ? v : Math.round(v * (f.scale || 1));
    if (f.type === PACKED.u8 || f.type === PACKED.bitfield8) dv.setUint8(off, raw);
    else if (f.type === PACKED.i8) dv.setInt8(off, raw);
    else if (f.type === PACKED.u16) dv.setUint16(off, raw, true);
    else if (f.type === PACKED.i16) dv.setInt16(off, raw, true);
    else if (f.type === PACKED.u32) dv.setUint32(off, raw, true);
    else if (f.type === PACKED.i32) dv.setInt32(off, raw, true);
    else if (f.type === PACKED.f32) dv.setFloat32(off, v, true);
    off += SIZE[f.type] ?? f.declaredSize ?? 0;
  }
  return out;
}
const cbAny = (v) => (typeof v === 'string' ? cbTstr(v) : typeof v === 'boolean' ? cbBool(v)
  : !Number.isInteger(v) ? cbF32(v) : v < 0 ? cbInt(v) : cbUint(v));

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
            [IDENTITY_K.hub_name, cbTstr('Graph fixture')]])],
        ]));
      } else if (header.type === FRAME.SUBSCRIBE) {
        const grants = [];
        for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
          const ch = w.get(K.channel_id);
          grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
            [K.channel_id, cbUint(ch)]]));
          const e = ENTRIES.find((x) => x.id === ch);
          if (e && e.layout) send(FRAME.STATE, ch, encodePacked(e));
        }
        send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
      } else if (header.type === FRAME.INTENT) {
        const m = cbDecodeFull(payload);
        const val = [...m.get(K.value)].sort((a, b) => a[0] - b[0]);
        send(FRAME.ECHO, m.get(K.channel_id), cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(m.get(K.intent_id))],
          [K.applied, cbMap(val.map(([k, v]) => [k, cbAny(v)]))]]));
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}

// One toy on the embedded server; every other command falls through to the stub.
function BP_STUB() {
  const base = window.__TAURI_INTERNALS__.invoke;
  window.__bp = [];
  window.__TAURI_INTERNALS__.invoke = async (cmd, a) => {
    if (cmd === 'bp_devices') {
      return [{ index: 1, key: 'lovense-aa-bb', name: 'Lush', kind: 'toy', connected: true,
        controls: [{ feature: 0, description: 'Motor', kind: 'scalar', type: 'Vibrate', range: [0, 20] }] }];
    }
    if (cmd.startsWith('bp_toy_')) { window.__bp.push([cmd, a]); return null; }
    return base(cmd, a);
  };
}

const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();

async function open({ coarse = false, seed = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: coarse });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(BP_STUB);
  await ctx.addInitScript(([etag, bytes, seed]) => {
    try {
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      localStorage.setItem('shell_host', '127.0.0.1');
      if (seed) localStorage.setItem(seed[0], seed[1]);
    } catch (e) { /* none */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), seed]);
  await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) errors.push(String(e)); });
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 });
  // The editor is a card on the overflow page until it is placed on the home.
  for (let pass = 0; pass < 10 && !(await page.$('.graph .gview')); pass++) {
    for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
      await page.click('[data-tab-id="' + id + '"]');
      await page.waitForTimeout(120);
      if (await page.$('.graph .gview')) break;
    }
  }
  await page.locator('.graph .gview').scrollIntoViewIfNeeded().catch(() => {});
  // In a grid the editor is a still preview (ph-e82.22); Open gives it the window below the strip.
  const still = await page.$eval('.graph', (g) => ({ inert: g.inert, open: !!g.closest('.dash-item')?.querySelector('.dash-open') })).catch(() => null);
  ok('in the grid the editor is an inert preview with Open (no scroll or zoom of its own)', !!still && still.inert && still.open, still);
  await page.locator('.dash-item:has(.graph) .dash-open').click();
  ok('Open makes it live, full window below the strip', await page.$eval('.graph', (g) => !g.inert && getComputedStyle(g.closest('.dash-item')).position === 'fixed'));
  await page.waitForTimeout(100);
  return { ctx, page, errors };
}

const center = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
async function dragTo(page, from, to, hover) {
  const [x1, y1] = await center(from);
  const [x2, y2] = await center(to);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 });
  await page.mouse.move(x2, y2, { steps: 6 });
  const seen = hover ? await hover() : null;
  await page.mouse.up();
  return seen;
}
/** Right-click the canvas at a viewport fraction, search, and pick the first match in a group. */
async function place(page, fx, fy, search, group) {
  const vp = await page.locator('.graph .gview').boundingBox();
  await page.mouse.click(vp.x + vp.width * fx, vp.y + vp.height * fy, { button: 'right' });
  await page.locator('.gpal input').fill(search);
  const btn = page.locator('.gpal .gpal-group', { has: page.locator('.gpal-name', { hasText: group }) }).locator('.gpal-item').first();
  const label = (await btn.textContent()).trim();
  await btn.click();
  await page.waitForTimeout(100);
  return label;
}
const nodeBy = (page, label) => page.locator('.gnode[data-kind=node]', { has: page.locator('.gname', { hasText: label }) }).first();
const sock = (node, side) => node.locator(':scope > [data-sock][data-side=' + side + ']');
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORAGE_KEY);

// ---- desktop ------------------------------------------------------------------
let saved = null;
{
  const { ctx, page, errors } = await open();
  ok('the editor renders as a canvas with a toolbar', !!(await page.$('.graph .gview')) && !!(await page.$('.graph .gtool')));
  await page.waitForTimeout(300);

  const src = await place(page, 0.15, 0.3, '', 'Sources: Motion');
  const toy = await place(page, 0.7, 0.3, 'Lush', 'Targets: Toy outputs');
  const S = nodeBy(page, src);
  const T = nodeBy(page, toy);
  ok('the add menu places a source and a toy output at the cursor', await S.count() === 1 && await T.count() === 1, [src, toy]);
  const vp = await page.locator('.graph .gview').boundingBox();
  const sb = await S.boundingBox();
  ok('a placed node lands where the menu was opened', Math.abs(sb.x - (vp.x + vp.width * 0.15)) < 30 && Math.abs(sb.y - (vp.y + vp.height * 0.3)) < 30,
    [sb.x - vp.x, sb.y - vp.y]);
  ok('the toy node carries a toy-control input and an app-command output', await sock(T, 'in').getAttribute('data-type') === 'toy'
    && await sock(T, 'out').getAttribute('data-type') === 'app');

  // connect: drag from the field's output socket to the toy's input socket.
  const hint = await dragTo(page, sock(S, 'out'), sock(T, 'in'), () => page.locator('.gcursor').textContent().catch(() => ''));
  ok('hovering an acceptable socket says so at the cursor', /release to connect/.test(hint || ''), hint);
  await page.waitForTimeout(150);
  const rels = page.locator('.gnode[data-kind=rel]');
  ok('the drag made one client edge with its map node', await rels.count() === 1 && await rels.first().getAttribute('data-home') === 'client');
  ok('two wires join source, map and target', await page.locator('.gwire[data-wire]').count() === 2);
  await page.waitForTimeout(400);
  ok('the source\'s live value rides its wire', await page.locator('.gval').count() >= 1);
  const st = await stored(page);
  ok('the edge and the node positions persist in the local graph store', st && st.rels.length === 1 && st.nodes.length === 2);

  // refuse: the toy's own output into a map, the map's output back into the toy.
  const mapLabel = await place(page, 0.45, 0.65, 'linear', 'Maps');
  const D = page.locator('.gnode[data-kind=draft]').first();
  ok('a placed map is a draft node', await D.count() === 1, mapLabel);
  await dragTo(page, sock(T, 'out'), sock(D, 'in'));
  await page.waitForTimeout(100);
  const why = await dragTo(page, sock(D, 'out'), sock(T, 'in'), () => page.locator('.gcursor').textContent().catch(() => ''));
  ok('closing a loop is refused at the cursor while hovering', /feedback loop/.test(why || ''), why);
  await page.waitForTimeout(100);
  const fl = page.locator('.gflash');
  ok('...and again on the drop', /feedback loop/.test((await fl.textContent().catch(() => '')) || ''));
  ok('nothing was wired', await page.locator('.gnode[data-kind=draft]').count() === 1 && await rels.count() === 1);
  const warn = await fl.evaluate((el) => getComputedStyle(el).color);
  const bad = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--bad)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  ok('a refusal is amber, never the hub-safety red (law 13)', warn !== bad, [warn, bad]);

  // view: zoom and pan; every wire end stays on its socket.
  const ends = () => page.evaluate(() => {
    const out = [];
    for (const p of document.querySelectorAll('.gwire[data-wire]')) {
      const m = p.getScreenCTM();
      const L = p.getTotalLength();
      const [a, b] = [p.getPointAtLength(0), p.getPointAtLength(L)].map((q) => new DOMPoint(q.x, q.y).matrixTransform(m));
      out.push([a.x, a.y, b.x, b.y]);
    }
    const socks = [...document.querySelectorAll('[data-sock]')].map((s) => { const r = s.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    return out.every(([ax, ay, bx, by]) => [[ax, ay], [bx, by]].every(([x, y]) => socks.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 2)));
  });
  ok('wire ends sit on their sockets', await ends());
  const box = await page.locator('.graph .gview').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.85);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  const k1 = await page.locator('.glayer').evaluate((el) => el.style.transform);
  ok('the wheel zooms', /scale\((?!1\))/.test(k1), k1);
  await page.mouse.move(box.x + 30, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + box.height - 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  ok('after zoom and pan the wire ends still sit on their sockets', await ends());
  await page.waitForTimeout(400);
  const v = (await stored(page)).view;
  ok('the view persists', v && v.k !== 1, v);

  // delete and undo, after Fit brings everything back into view.
  await page.click('.gtool button:has-text("Fit")');
  await page.waitForTimeout(100);
  const fitted = await page.evaluate(() => { const v = document.querySelector('.gview').getBoundingClientRect();
    return [...document.querySelectorAll('.gnode')].every((n) => { const b = n.getBoundingClientRect(); return b.left >= v.left && b.right <= v.right && b.top >= v.top && b.bottom <= v.bottom; }); });
  ok('Fit brings every node into view', fitted);
  await rels.first().locator('.ghead').click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  ok('Delete removes the selected map node and its wires', await rels.count() === 0 && await page.locator('.gwire[data-wire]').count() === 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ok('Ctrl+Z brings it back', await rels.count() === 1 && await page.locator('.gwire[data-wire]').count() === 3);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  ok('Ctrl+Shift+Z deletes it again', await rels.count() === 0);

  // a wire: click selects it, Delete cuts it, Ctrl+Z restores it.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const hit = await page.evaluate(() => { const p = document.querySelector('.gwire[data-wire$=":out"]'); const q = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM(); const o = new DOMPoint(q.x, q.y).matrixTransform(m); return [o.x, o.y]; });
  await page.mouse.click(hit[0], hit[1]);
  ok('clicking a wire selects it', await page.locator('.gwire[data-sel]').count() === 1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  ok('Delete cuts the selected wire; its map stays as a draft', await rels.count() === 0 && await page.locator('.gnode[data-kind=draft]').count() === 2);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  ok('redo replays the cut', await rels.count() === 0 && await page.locator('.gnode[data-kind=draft]').count() === 2);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  await rels.first().locator('.ghead').click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);

  // keyboard: Enter on the source output, Enter on the draft input.
  await sock(S, 'out').focus();
  await page.keyboard.press('Enter');
  await sock(D, 'in').focus();
  ok('focusing the other end says what Enter will do', /Enter connects|refused/.test(await page.locator('.gsr').textContent()));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  ok('Enter on two sockets wires them; a map input takes its new source in place of the old one',
    await page.locator('.gwire[data-home=draft]').count() === 1 && /connected/.test(await page.locator('.gsr').textContent()));
  await sock(D, 'out').focus();
  await page.keyboard.press('Enter');
  await sock(T, 'in').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  ok('...and two more make the edge, all without a mouse', await rels.count() === 1 && await page.locator('.gwire[data-home=client]').count() === 2);

  // marquee and duplicate.
  await page.click('.gtool button:has-text("Fit")');
  const vb = await page.locator('.graph .gview').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(vb.x + 4, vb.y + 4);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width - 4, vb.y + vb.height - 4, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const all = await page.locator('.gnode').count();
  ok('Shift+drag on the canvas box-selects every node it covers', all > 1 && await page.locator('.gnode[data-sel]').count() === all);
  await page.keyboard.press('Escape');
  await rels.first().locator('.ghead').click();
  await page.click('.gtool button:has-text("Duplicate")');
  await page.waitForTimeout(100);
  ok('Duplicate makes an unwired copy of a map', await page.locator('.gnode[data-kind=draft]').count() === 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok('...which Ctrl+Z takes back', await page.locator('.gnode[data-kind=draft]').count() === 0);

  if (SHOT) { await page.click('.gtool button:has-text("Fit")'); await page.waitForTimeout(300); await page.locator('.graph').screenshot({ path: SHOT }); }

  // Fit and full size: still under the top strip.
  await page.click('.gtool button:has-text("Full size")');
  await page.waitForTimeout(100);
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-full.png') });
  const g = await page.locator('.graph.full').boundingBox();
  const stripH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 0);
  ok('full size fills the window below the top strip (RENDERING section 9)', g && Math.abs(g.y - stripH) < 2 && g.height > 800, [g && g.y, stripH]);
  const strip = await page.evaluate((h) => { const el = document.elementFromPoint(400, Math.max(1, h / 2)); return !!el && !el.closest('.graph'); }, stripH);
  ok('the top strip stays on top of it', strip);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  ok('Escape leaves full size', !(await page.$('.graph.full')));
  ok('no page errors', errors.length === 0, errors);
  saved = JSON.stringify(await stored(page));
  await ctx.close();
}

// ---- touch ---------------------------------------------------------------------
{
  const { ctx, page, errors } = await open({ coarse: true, seed: [STORAGE_KEY, saved] });
  await page.waitForTimeout(300);
  const sizes = await page.$$eval('[data-sock]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  ok('the stored graph comes back in a new session', sizes.length >= 4, sizes.length);
  ok('every socket is at least 40 px under a touch pointer (law 12)', sizes.length > 0 && sizes.every((s) => s >= 39.5), sizes);
  const scale = () => page.locator('.glayer').evaluate((el) => Number((/scale\(([\d.]+)\)/.exec(el.style.transform) || [])[1]));
  const k0 = await scale();
  const cdp = await ctx.newCDPSession(page);
  const vb = await page.locator('.graph .gview').boundingBox();
  const cx = vb.x + vb.width / 2;
  const cy = vb.y + vb.height - 24;
  const touch = (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] });
  await touch('touchStart', 20);
  for (const d of [30, 45, 60, 80]) await touch('touchMove', d);
  await touch('touchEnd', 0);
  await page.waitForTimeout(100);
  ok('two fingers spreading on the canvas zoom in', await scale() > k0, [k0, await scale()]);
  ok('no page errors (touch)', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the node editor wires, refuses, undoes and keeps its wires through pan and zoom.'));
process.exit(fails ? 1 : 0);
