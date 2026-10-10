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
 *   review    2026-10-02 design review: live inputs at 4.5:1 per theme, no
 *             tools in the grid preview, a one-row toolbar at 390 px, an
 *             11 px text floor Fit keeps at 9 px, sentence-case menu, opened
 *             categories scrolled in, backward links clear of their nodes,
 *             the hint centered, SVG head icons, --highlight for focus
 *   ph-5wo6   the add menu groups as the pages do (hub, category, section,
 *             card, then ButtplugIO and the node families); F3 in the editor
 *             is the node search, ranked by the shell's matcher, Enter adds
 *             at the pointer, Shift+Enter or the show button finds the node
 *             on the canvas, the shell's look-for stays outside; a node
 *             names its card (device first once two are drawn), desc, range,
 *             what its sockets do and its live state (pending, gated,
 *             stale); one card, one accent. Screenshots at 1428x900 and
 *             420x860, dark and Paper, in test/evidence/ph-5wo6/
 *
 * Deliberately NOT part of `npm run check` (it launches a browser).
 * Run: node test/graph-editor.test.mjs [--shot <png>]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED } from '../../Valence/clients/js/frames.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { STORAGE_KEY } from '../src/model/graph.js';
import { deriveTokens, THEMES, THEME_KEY } from '../src/model/theme.js';

const SHOT = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
let fails = 0;
let previews = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

/** The worst text contrast among `sel` on its own opaque background, under each preset's tokens. */
async function inkUnder(page, sel, ids = ['phosphor', 'ember', 'paper']) {
  const out = {};
  for (const id of ids) {
    const d = deriveTokens(THEMES.find((t) => t.id === id));
    out[id] = await page.evaluate(([sel, base, dark]) => {
      const root = document.documentElement.style;
      const prev = Object.keys(base).map((k) => [k, root.getPropertyValue(k)]);
      const scheme = root.colorScheme;
      for (const [k, v] of Object.entries(base)) root.setProperty(k, v);
      root.colorScheme = dark ? 'dark' : 'light';
      const c2d = document.createElement('canvas').getContext('2d');
      const rgb = (c) => { c2d.clearRect(0, 0, 1, 1); c2d.fillStyle = '#000'; c2d.fillStyle = c; c2d.fillRect(0, 0, 1, 1); return [...c2d.getImageData(0, 0, 1, 1).data]; };
      const lum = (c) => { const [r, g, b] = rgb(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (el) => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (rgb(c)[3] === 255) return c; } return getComputedStyle(document.body).backgroundColor; };
      let worst = 99;
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
        worst = Math.min(worst, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
      }
      for (const [k, v] of prev) { if (v) root.setProperty(k, v); else root.removeProperty(k); }
      root.colorScheme = scheme;
      return els.length ? Math.round(worst * 100) / 100 : 0;
    }, [sel, d.base, d.dark]);
  }
  return out;
}
const scaleOf = (page) => page.locator('.glayer').evaluate((el) => Number((/scale\(([\d.]+)\)/.exec(el.style.transform) || [])[1]));

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

// hub.down refuses every socket; hub.hold keeps every ECHO (a write stays pending).
const hub = { down: false, hold: false, sockets: new Set() };
function fakeHub(ws) {
  if (hub.down) { ws.close(); return; }
  hub.sockets.add(ws);
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
        if (hub.hold) continue;
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

async function open({ coarse = false, seed = null, before = null, viewport = { width: 1440, height: 1000 }, store = {} } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: coarse });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(BP_STUB);
  await ctx.addInitScript(([etag, bytes, seed, store]) => {
    try {
      localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      localStorage.setItem('shell_host', '127.0.0.1');
      if (seed) localStorage.setItem(seed[0], seed[1]);
      for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v);
    } catch (e) { /* none */ }
  }, [ETAG, Buffer.from(CAT).toString('hex'), seed, store]);
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
  if (SHOTS) await page.locator('.dash-item:has(.graph)').screenshot({ path: SHOTS + '/preview-' + (++previews) + '.png' });
  const drawn = () => page.$eval('.graph', (g) => [...g.querySelectorAll('.gtool, .gnote')].map((e) => e.getClientRects().length));
  const tools = await drawn();
  ok('the preview draws no toolbar and no edges line until Open (ph-eg2)', tools.length === 2 && tools.every((n) => n === 0), tools);
  // A click engages it in place with the focus ring, tools still Open-only; a wheel outside lets go (ph-n18c).
  const [gx, gy] = await center(page.locator('.dash-item:has(.graph) .gview'));
  await page.mouse.click(gx, gy);
  await page.waitForTimeout(50);
  const eng = () => page.$eval('.graph', (g) => ({ live: !g.inert, ring: getComputedStyle(g.closest('.dash-item')).outlineStyle }));
  const on = await eng();
  if (SHOTS) await page.screenshot({ path: SHOTS + '/engaged-' + previews + '.png' });
  ok('a click in the preview engages it in place, ringed, no tools', on.live && on.ring === 'solid' && (await drawn()).every((n) => n === 0), on);
  const [rx, ry] = await center(page.locator('nav.rail'));
  await page.mouse.move(rx, ry);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(50);
  const off = await eng();
  ok('...a wheel outside disengages it', !off.live && off.ring !== 'solid', off);
  if (before) await before(page);
  await page.locator('.dash-item:has(.graph) .dash-open').click();
  ok('Open makes it live, full window below the strip', await page.$eval('.graph', (g) => !g.inert && getComputedStyle(g.closest('.dash-item')).position === 'fixed'));
  ok('...with its toolbar and edges line', (await drawn()).every((n) => n > 0));
  await page.waitForTimeout(100);
  return { ctx, page, errors };
}

const center = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
/** The fixture hub's name: WELCOME hub_name, the menu's top group and a card label's device. */
const HUB = 'Graph fixture';
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
/**
 * Right-click the canvas at a viewport fraction and pick the first item of a
 * group: by opening its header (a path, ' › ' between names) when `search` is
 * empty, else from the flattened search results whose path holds `group`.
 */
async function place(page, fx, fy, search, group) {
  const vp = await page.locator('.graph .gview').boundingBox();
  await page.mouse.click(vp.x + vp.width * fx, vp.y + vp.height * fy, { button: 'right' });
  let btn;
  if (search) {
    await page.locator('.gpal input').fill(search);
    btn = page.locator('.gpal .gpal-item', { has: page.locator('.gpal-count', { hasText: group }) }).first();
  } else {
    await page.locator('.gpal .gpal-head[data-group="' + group + '"]').click();
    btn = page.locator('.gpal .gpal-item[data-nested][data-group="' + group + '"]').first();
  }
  const label = (await btn.evaluate((el) => el.firstChild.textContent)).trim();
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
  const tops = await page.$$eval('.gtool .og-btn', (els) => els.filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('a wide window holds all eleven tools in one row', tops.length === 11 && new Set(tops).size === 1, tops);
  await page.waitForTimeout(300);

  const src = await place(page, 0.15, 0.3, '', HUB + ' › Motion');
  const toy = await place(page, 0.7, 0.3, 'Lush', 'ButtplugIO');
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
  const mapInk = await inkUnder(page, '.gnode .gparams input:not([type=checkbox])');
  ok('map node fields read as live values, 4.5:1 or better per theme (ph-6uf)', Object.values(mapInk).every((x) => x >= 4.5), mapInk);
  const ladderInk = await page.evaluate(() => {
    const p = document.querySelector('.gnode[data-kind=rel] .gline[data-phase=disarmed]');
    const d = document.createElement('i');
    d.style.color = 'var(--warn-ink)';
    document.body.append(d);
    const warn = getComputedStyle(d).color;
    d.remove();
    return p ? [getComputedStyle(p).color, warn] : null;
  });
  ok('a map node\'s disarmed ladder line is amber, not --ink-dim (ph-3pl)', !!ladderInk && ladderInk[0] === ladderInk[1], ladderInk);

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

// ---- typed nodes and the add menu (docs/GRAPH.md) -------------------------------
{
  const shot = (name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);
  const noSel = (page) => page.evaluate(() => (window.getSelection() || '').toString() === '');
  const sweep = async (page, x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
  };
  let gridClean = null;
  const { ctx, page, errors } = await open({
    before: async (p) => {
      const vb = p.viewportSize();
      await sweep(p, 40, vb.height * 0.3, vb.width - 40, vb.height * 0.8);
      gridClean = await noSel(p);
    },
  });
  ok('a drag across the grid selects no text', gridClean === true);
  const us = await page.evaluate(() => [getComputedStyle(document.body).userSelect, getComputedStyle(document.querySelector('input') || document.createElement('input')).userSelect]);
  ok('text selection is off app-wide and on in fields', us[0] === 'none' && us[1] === 'text', us);
  const hint = await page.evaluate(() => {
    const v = document.querySelector('.gview').getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('.gempty'));
    const t = r.getBoundingClientRect();
    return Math.round(t.left + t.width / 2 - (v.left + v.width / 2));
  });
  ok('the empty-canvas hint is centered on the canvas (ph-3y4)', Math.abs(hint) < 2, hint);
  // Zoomed out so a five-node chain fits the card's canvas.
  await page.click('.gtool button[aria-label="Zoom out"]');
  await page.click('.gtool button[aria-label="Zoom out"]');
  const vp = await page.locator('.graph .gview').boundingBox();
  const inside = async () => {
    const m = await page.locator('.gpal').boundingBox({ timeout: 2000 }).catch(() => null);
    if (!m && SHOTS) await page.screenshot({ path: SHOTS + '/debug-menu.png' });
    return !!m && m.x >= vp.x - 0.5 && m.y >= vp.y - 0.5 && m.x + m.width <= vp.x + vp.width + 0.5 && m.y + m.height <= vp.y + vp.height + 0.5;
  };

  // Categories, collapsed; keyboard places a Value node.
  await page.mouse.click(vp.x + vp.width * 0.55, vp.y + vp.height * 0.8, { button: 'right' });
  const heads = await page.locator('.gpal .gpal-head').allTextContents();
  ok('the add menu lists categories collapsed, one header each', heads.length >= 7 && await page.locator('.gpal .gpal-item').count() === 0
    && ['Input', 'Math', 'Logic', 'Converter', 'Maps', 'ButtplugIO', 'Motion'].every((c) => heads.some((h) => h.includes(c))), heads.map((h) => h.trim()));
  await shot('menu-categories');
  // Left closes the open hub; Down walks the headers to Input; Right opens it.
  await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 8 && await page.locator('.gpal [data-cur]').getAttribute('data-group') !== 'Input'; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  ok('Left closes the open hub, Right opens the highlighted category', await page.locator('.gpal .gpal-item[data-nested]').count() === 3
    && await page.locator('.gpal .gpal-head[aria-expanded=true]').getAttribute('data-group') === 'Input');
  const mt = await page.evaluate(() => {
    const cs = (s) => getComputedStyle(document.querySelector(s));
    return { head: parseFloat(cs('.gpal .gpal-head').fontSize), item: parseFloat(cs('.gpal .gpal-item').fontSize),
      search: parseFloat(cs('.gpal input').fontSize), transform: cs('.gpal .gpal-head').textTransform };
  });
  ok('add menu: headers in sentence case at the row size, search text near it (ph-kiq)', mt.transform === 'none' && mt.head === mt.item && mt.search <= mt.item * 1.15, mt);
  const headInk = await inkUnder(page, '.gpal .gpal-head:not([data-cur])');
  ok('...headers at 4.5:1 or better per theme', Object.values(headInk).every((x) => x >= 4.5), headInk);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const V = page.locator('.gnode[data-kind=op]', { has: page.locator('.gname', { hasText: 'Value' }) });
  ok('Down and Enter place the item: a Value node', await V.count() === 1);
  const vin = V.locator('input[type=number]');
  await vin.fill('0.8');
  await vin.press('Enter');
  await page.waitForTimeout(50);
  await page.locator('.graph .gview').click({ position: { x: vp.width - 30, y: vp.height / 2 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok('editing a node value is one undo step', await vin.inputValue() === '0.5', await vin.inputValue());
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  ok('...and redo puts it back', await vin.inputValue() === '0.8');
  await V.locator('.ghead').click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  ok('Delete removes an op node', await V.count() === 0);

  // Search flattens across categories.
  await page.mouse.click(vp.x + vp.width * 0.5, vp.y + vp.height * 0.5, { button: 'right' });
  await page.locator('.gpal input').fill('cl');
  const found = await page.locator('.gpal .gpal-item').allTextContents();
  ok('typing searches every category and flattens the results', await page.locator('.gpal .gpal-head').count() === 0
    && found.some((t) => /^Clamp\s*Math/.test(t.trim())) && found.some((t) => /^Linear clamp\s*Maps/.test(t.trim())), found);
  await shot('menu-search');
  await page.keyboard.press('Escape');

  // Clamped by measured size at all four corners, and again after its content grows.
  const corners = [[4, 4], [vp.width - 4, 4], [4, vp.height - 4], [vp.width - 4, vp.height - 4]];
  const clamped = [];
  for (const [cx, cy] of corners) {
    await page.mouse.click(vp.x + cx, vp.y + cy, { button: 'right' });
    await page.waitForTimeout(80);
    clamped.push(await inside());
    await page.keyboard.press('Escape');
  }
  ok('the add menu stays inside the editor at all four corners', clamped.every(Boolean), clamped);
  await page.mouse.click(vp.x + vp.width - 4, vp.y + vp.height - 4, { button: 'right' });
  for (const h of ['Math', 'Logic', 'Converter', 'Maps']) await page.locator('.gpal .gpal-head', { hasText: h }).first().click();
  await page.waitForTimeout(80);
  ok('...and re-clamps when opened categories grow it', await inside());
  await page.keyboard.press('Escape');
  await page.mouse.move(vp.x + vp.width * 0.6, vp.y + vp.height * 0.15);
  await page.keyboard.press('Shift+A');
  await page.waitForTimeout(80);
  const sa = await page.locator('.gpal').boundingBox();
  ok('Shift+A opens the menu at the pointer', !!sa && Math.abs(sa.x - (vp.x + vp.width * 0.6)) < 2 && sa.y <= vp.y + vp.height * 0.15 + 2, sa);
  await page.keyboard.press('Escape');

  // An opened category below the fold scrolls into view; a long one keeps its header (ph-hui).
  await page.mouse.click(vp.x + vp.width * 0.5, vp.y + vp.height * 0.3, { button: 'right' });
  const inList = (sel, last) => page.evaluate(([s, last]) => {
    const l = document.querySelector('.gpal-list').getBoundingClientRect();
    const els = [...document.querySelectorAll(s)];
    const e = last ? els[els.length - 1] : els[0];
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return b.top >= l.top - 0.5 && b.bottom <= l.bottom + 0.5;
  }, [sel, last]);
  await page.locator('.gpal .gpal-head[data-group="Maps"]').click();
  await page.waitForTimeout(100);
  ok('opening the last category scrolls its items into view (ph-hui)', await inList('.gpal .gpal-item[data-nested]', true));
  await page.locator('.gpal .gpal-head[data-group="' + HUB + ' › Generator"]').click();
  await page.waitForTimeout(100);
  ok('...and a long one keeps its header on screen', await inList('.gpal .gpal-head[aria-expanded=true][data-group="' + HUB + ' › Generator"]', false));
  await page.keyboard.press('Escape');

  // Link-drag-search: a source's wire dropped on empty canvas near a corner.
  const src = await place(page, 0.05, 0.3, '', HUB + ' › Motion');
  const S = nodeBy(page, src);
  const so = await center(sock(S, 'out'));
  await sweep(page, so[0], so[1], vp.x + vp.width - 6, vp.y + vp.height - 6);
  await page.waitForTimeout(80);
  const offered = await page.locator('.gpal .gpal-item').allTextContents();
  // The Planner card is read-only counters: nothing there takes an input.
  ok('a wire dropped on empty canvas opens the menu there, flat and filtered to inputs', await page.locator('.gpal .gpal-head').count() === 0
    && offered.length > 0 && !offered.some((t) => /^(Value|Integer|Boolean)Input$/.test(t.trim())) && !offered.some((t) => /Tuning › Planner$/.test(t))
    && offered.some((t) => /^Math/.test(t.trim())) && offered.some((t) => t.includes(HUB + ' › ')), offered.length);
  ok('...clamped inside the editor at the corner', await inside());
  const names = await page.$$eval('.gpal .gpal-item', (els) => els.map((e) => [e.firstChild.textContent.trim(), (e.querySelector('.gpal-count') || {}).textContent]));
  const own = names.filter(([, g]) => ['Input', 'Math', 'Logic', 'Converter', 'Maps'].includes(g));
  ok('op and map names share one case: sentence case (ph-kiq)', own.length > 10 && own.every(([n]) => /^[A-Z][^A-Z]*$/.test(n)), own.filter(([n]) => !/^[A-Z][^A-Z]*$/.test(n)));
  await shot('menu-link-drag-search');
  await page.locator('.gpal input').fill('thresh');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  const Th = page.locator('.gnode[data-kind=op]', { has: page.locator('.gname', { hasText: 'Threshold' }) });
  ok('placing from it wires the new node to the dragged socket', await Th.count() === 1
    && await page.locator('.gwire[data-link]').count() === 1 && await sock(Th, 'in').first().getAttribute('data-port') === 'v');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  ok('place and wire undo as one step', await Th.count() === 0 && await page.locator('.gwire[data-link]').count() === 0);

  // A small graph: source -> Math -> Compare, source -> Threshold -> Switch, Compare -> Switch's True arm, Switch -> toy.
  const dropFrom = async (node, port, fx, fy, search) => {
    const s0 = await center(port ? node.locator(':scope > [data-sock][data-side=out]') : sock(node, 'out'));
    await sweep(page, s0[0], s0[1], vp.x + vp.width * fx, vp.y + vp.height * fy);
    await page.waitForTimeout(80);
    await page.locator('.gpal input').fill(search);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  };
  const op = (name) => page.locator('.gnode[data-kind=op]', { has: page.locator('.gname', { hasText: name }) }).first();
  await dropFrom(S, false, 0.25, 0.05, 'math');
  await op('Add').locator('select').selectOption('multiply');
  await page.waitForTimeout(80);
  await op('Multiply').locator('.grow[data-port=b] input').fill('0.02');
  await op('Multiply').locator('.grow[data-port=b] input').press('Enter');
  await dropFrom(op('Multiply'), true, 0.42, 0.05, 'compare');
  await dropFrom(S, false, 0.25, 0.55, 'threshold');
  await dropFrom(op('Threshold'), true, 0.42, 0.55, 'switch');
  const toyLabel = await place(page, 0.62, 0.35, 'Lush', 'ButtplugIO');
  const Toy = nodeBy(page, toyLabel);
  await dragTo(page, op('Switch').locator(':scope > [data-sock][data-side=out]'), sock(Toy, 'in'));
  await dragTo(page, op('Greater than').locator(':scope > [data-sock][data-side=out]'), op('Switch').locator('[data-sock][data-port=t]'));
  await page.waitForTimeout(150);
  ok('the graph has Math, Compare, Threshold and Switch nodes', await page.locator('.gnode[data-kind=op]').count() === 4);
  ok('six links join them', await page.locator('.gwire[data-link]').count() === 6, await page.locator('.gwire[data-link]').count());
  ok('a bool into a float arm shows a conversion mark on its wire', await page.locator('.gconv').count() >= 1);
  const sw = await op('Switch').locator('[data-sock][data-port=s]').getAttribute('data-vt');
  ok('the Threshold wired to the Switch\'s bool input (the matching type)', sw === 'bool' && await page.locator('.gwire[data-link]').count() === 6);
  ok('the toy says where its chain runs, in one word', (await Toy.locator('.gbadge').textContent()).trim() === 'client');
  const loop = await dragTo(page, op('Switch').locator(':scope > [data-sock][data-side=out]'), op('Multiply').locator('[data-sock][data-port=b]'),
    () => page.locator('.gcursor').textContent().catch(() => ''));
  ok('a link closing a loop is refused in words', /would loop/.test(loop || ''), loop);
  const onSock = await page.evaluate(() => {
    const socks = [...document.querySelectorAll('[data-sock]')].map((s) => { const r = s.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    return [...document.querySelectorAll('.gwire[data-link]')].every((p) => {
      const m = p.getScreenCTM();
      return [0, p.getTotalLength()].map((t) => { const q = p.getPointAtLength(t); return new DOMPoint(q.x, q.y).matrixTransform(m); })
        .every((q) => socks.some(([x, y]) => Math.hypot(x - q.x, y - q.y) < 2));
    });
  });
  ok('every link ends on its socket, op input rows included', onSock);

  // 2026-10-02 design review, typed nodes.
  const opInk = await inkUnder(page, '.gnode .grow input:not([type=checkbox])');
  ok('op node values read as live fields, 4.5:1 or better per theme (ph-6uf)', Object.values(opInk).every((x) => x >= 4.5), opInk);
  const icons = await page.$$eval('.gnode .ghead > .gicon', (els) => els.map((e) => [e.tagName.toLowerCase(), e.textContent.trim()]));
  ok('node heads draw one SVG icon set, no text glyphs, no "?" (ph-2ud)', icons.length >= 6 && icons.every(([t, s]) => t === 'svg' && s === ''), icons);
  const through = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.gnode')].map((n) => n.getBoundingClientRect());
    const bad = [];
    for (const p of document.querySelectorAll('.gwire[data-link]')) {
      const m = p.getScreenCTM();
      const L = p.getTotalLength();
      const pt = (t) => { const q = p.getPointAtLength(t); return new DOMPoint(q.x, q.y).matrixTransform(m); };
      const a = pt(0), b = pt(L);
      const ends = nodes.filter((r) => (Math.abs(a.x - r.right) < 2 && a.y >= r.top && a.y <= r.bottom) || (Math.abs(b.x - r.left) < 2 && b.y >= r.top && b.y <= r.bottom));
      for (let i = 1; i < 80; i++) {
        const q = pt(L * i / 80);
        if (Math.hypot(q.x - a.x, q.y - a.y) < 6 || Math.hypot(q.x - b.x, q.y - b.y) < 6) continue;
        if (ends.some((r) => q.x > r.left + 2 && q.x < r.right - 2 && q.y > r.top + 2 && q.y < r.bottom - 2)) { bad.push(p.dataset.wire); break; }
      }
    }
    return bad;
  });
  ok('a backward link exits right and re-enters left, clear of its own two nodes (ph-23p)', through.length === 0, through);
  const HL = 'rgb(1, 160, 2)';
  await page.evaluate((c) => document.documentElement.style.setProperty('--highlight', c), HL);
  await S.focus();
  await page.keyboard.press('Tab');
  const fSock = await page.evaluate(() => { const e = document.activeElement; return [e.matches(':focus-visible'), getComputedStyle(e).outlineColor, 'sock' in e.dataset]; });
  await page.keyboard.press('Shift+Tab');
  const fNode = await page.evaluate(() => { const e = document.activeElement; return [e.matches(':focus-visible'), getComputedStyle(e).outlineColor, e.classList.contains('gnode'), getComputedStyle(e).boxShadow]; });
  await page.click('.gtool button:has-text("Box select")');
  await page.waitForTimeout(250);   // .og-btn eases its border over .12s
  const pressed = await page.locator('.gtool button:has-text("Box select")').evaluate((e) => getComputedStyle(e).borderColor);
  await page.click('.gtool button:has-text("Box select")');
  await page.evaluate(() => document.documentElement.style.removeProperty('--highlight'));
  ok('focus rings, node selection and a pressed tool ride --highlight (ph-ckg)', fSock[0] && fSock[2] && fSock[1] === HL && fNode[0] && fNode[2] && fNode[1] === HL
    && fNode[3].includes(HL) && pressed === HL, [fSock, fNode, pressed]);
  await page.click('.gtool button:has-text("Fit")');
  await page.waitForTimeout(100);
  const type = await page.evaluate(() => {
    const k = Number((/scale\(([\d.]+)\)/.exec(document.querySelector('.glayer').style.transform) || [])[1]);
    const px = [];
    for (const el of document.querySelectorAll('.gnode *, .gval')) {
      if (el.matches('input, select') || [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) px.push(parseFloat(getComputedStyle(el).fontSize));
    }
    return { k, css: Math.min(...px), screen: Math.round(Math.min(...px) * k * 100) / 100 };
  });
  ok('node text is 11 px or more and Fit keeps it at 9 px or more on screen (ph-6e1)', type.css >= 11 && type.screen >= 9 - 0.01, type);
  if (SHOTS) {
    // Screenshot only: a taller canvas than the card gives, then Fit.
    await page.addStyleTag({ content: '.gview { min-height: 640px !important; }' });
    await page.click('.gtool button:has-text("Fit")');
    await page.waitForTimeout(400);
    await page.locator('.graph').screenshot({ path: SHOTS + '/graph-math-compare-switch-threshold.png' });
  }

  // No text selection on a canvas drag through nodes, nor on the strip.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await sweep(page, vp.x + 6, vp.y + vp.height * 0.5, vp.x + vp.width - 6, vp.y + vp.height * 0.52);
  ok('a drag across the canvas and its nodes selects no text', await noSel(page));
  const stripH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 0);
  if (stripH) {
    await sweep(page, 10, stripH / 2, 1400, stripH / 2);
    ok('a drag across the top strip selects no text', await noSel(page));
  }
  ok('no page errors (typed nodes)', errors.length === 0, errors);
  await ctx.close();
}

// ---- F3, the menu as the pages group it, node context (ph-5wo6) -----------------
{
  const EVID = fileURLToPath(new URL('./evidence/ph-5wo6/', import.meta.url));
  mkdirSync(EVID, { recursive: true });
  const PAPER = THEMES.find((t) => t.id === 'paper');
  const W = { width: 1428, height: 900 };
  const { ctx, page, errors } = await open({ viewport: W });
  const vp = await page.locator('.graph .gview').boundingBox();
  const at = (fx, fy) => [vp.x + vp.width * fx, vp.y + vp.height * fy];
  const node = (name) => page.locator('.gnode[data-kind=node]', { has: page.locator('.gname', { hasText: new RegExp('^' + name + '$') }) });
  const opNode = (name) => page.locator('.gnode[data-kind=op]', { has: page.locator('.gname', { hasText: new RegExp('^' + name + '$') }) });
  const pal = page.locator('.gpal');
  /** F3 at a canvas fraction, a query, then Enter (or Shift+Enter); returns the first result's [label, path]. */
  async function f3(fx, fy, query, key = 'Enter') {
    await page.mouse.move(...at(fx, fy));
    await page.locator('.graph .gview').focus();
    await page.keyboard.press('F3');
    await pal.locator('input').fill(query);
    const first = await pal.locator('.gpal-item').first().evaluate((e) => [e.querySelector('.gpal-label').textContent, (e.querySelector('.gpal-count') || {}).textContent]);
    if (!key) return first;
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    return first;
  }
  const accentOf = (loc) => loc.evaluate((e) => getComputedStyle(e, '::before').backgroundColor);

  // The add menu: the hub open on its categories in the rail's order, sections and cards nested.
  const rail = await page.$$eval('nav.rail [role=tab][data-tab-id^="cat"]', (els) => els.map((e) => e.title));
  await page.mouse.click(...at(0.6, 0.1), { button: 'right' });
  const level = (n) => pal.locator('.gpal-head[aria-level="' + n + '"]').evaluateAll((els) => els.map((e) => e.querySelector('.gpal-label').textContent));
  const cats = await level(2);
  const tops = await level(1);
  const common = rail.filter((c) => cats.includes(c));
  ok('the add menu opens on the hub, its categories in the rail\'s order (ph-5wo6)', tops[0] === HUB
    && await pal.locator('.gpal-head').first().getAttribute('aria-expanded') === 'true' && common.length >= 4
    && JSON.stringify(cats.filter((c) => rail.includes(c))) === JSON.stringify(common), { tops, cats, rail });
  ok('...then ButtplugIO and the node families, in that order', JSON.stringify(tops.slice(-6)) === JSON.stringify(['ButtplugIO', 'Input', 'Math', 'Logic', 'Converter', 'Maps']), tops);
  await pal.locator('.gpal-head[data-group="' + HUB + ' › Motion"]').click();
  const mHeads = await pal.locator('.gpal-head').evaluateAll((els) => els.map((e) => [e.dataset.group, e.getAttribute('aria-level')]));
  const ix = (g) => mHeads.findIndex(([x]) => x === HUB + ' › Motion › ' + g);
  ok('...a category holds its cards, then its sections (Motion: Oscillator before Tuning)', ix('Oscillator') > 0 && ix('Tuning') > ix('Oscillator')
    && mHeads[ix('Oscillator')][1] === '3' && mHeads[ix('Tuning')][1] === '3', mHeads.slice(0, 12));
  await pal.locator('.gpal-head[data-group="' + HUB + ' › Motion › Tuning"]').click();
  ok('...a section holds its cards (Tuning › Planner, level 4)', await pal.locator('.gpal-head[data-group="' + HUB + ' › Motion › Tuning › Planner"][aria-level="4"]').count() === 1);
  await pal.locator('.gpal-head[data-group="' + HUB + ' › Motion › Oscillator"]').click();
  ok('...a card lists its fields as the page labels them', JSON.stringify(await pal.locator('.gpal-item[data-group="' + HUB + ' › Motion › Oscillator"] .gpal-label').allTextContents())
    .includes('"Cycles a second"'));
  await page.screenshot({ path: EVID + 'menu-1428x900-dark.png' });
  await page.keyboard.press('Escape');

  // F3: the node search, ranked by the shell's matcher; the shell's look-for stays outside the editor.
  await page.mouse.move(...at(0.3, 0.35));
  await page.locator('.graph .gview').focus();
  await page.keyboard.press('F3');
  await page.waitForTimeout(80);
  ok('F3 in the editor opens the node search, never the shell look-for', await page.locator('.gpal[aria-label="Find a node"]').count() === 1
    && await page.locator('.lf').count() === 0);
  const pb = await pal.boundingBox();
  ok('...at the pointer (raised only to stay inside the canvas)', Math.abs(pb.x - at(0.3, 0.35)[0]) < 2 && pb.y <= at(0.3, 0.35)[1] + 1, [pb.x, pb.y, at(0.3, 0.35)]);
  const keys = await pal.locator('.gpal-item').evaluateAll((els) => els.map((e) => e.querySelector('.gpal-label').textContent + ' · ' + e.querySelector('.gpal-count').textContent));
  ok('...listing every source, op and map flat, each with its path', await pal.locator('.gpal-head').count() === 0 && keys.length > 100);
  ok('...each source once, under its page path even when a plugin module claims it', !keys.some((k) => k.includes('Plugin modules')) && keys.includes('Speed · ' + HUB + ' › Generator › Pattern'));
  await page.keyboard.press('F3');
  ok('...and F3 again closes it', await pal.count() === 0 && await page.locator('.lf').count() === 0);
  const r1 = await f3(0.3, 0.35, 'oscillator cycles');
  ok('words in any order hit the label and the path: "oscillator cycles" finds the Oscillator card\'s field', r1[0] === 'Cycles a second' && /Motion › Oscillator$/.test(r1[1]), r1);
  const C = node('Cycles a second');
  const cb = await C.boundingBox();
  ok('...and Enter adds it at the pointer', await C.count() === 1 && Math.abs(cb.x - at(0.3, 0.35)[0]) < 24 && Math.abs(cb.y - at(0.3, 0.35)[1]) < 24, [cb.x, cb.y]);
  await f3(0.3, 0.62, 'peak displacement');
  const r3 = await f3(0.62, 0.35, 'pattern speed');
  ok('"pattern speed" finds Speed on the Pattern card', r3[0] === 'Speed' && r3[1] === HUB + ' › Generator › Pattern', r3);
  const A = node('Peak displacement');
  const Sp = node('Speed');
  ok('three hub fields placed', await C.count() === 1 && await A.count() === 1 && await Sp.count() === 1);

  // Node context: card, desc, range and what each socket does; one card, one accent.
  ok('a node names its card above its name', await C.locator('.gcard').textContent() === 'Oscillator' && await Sp.locator('.gcard').textContent() === 'Pattern');
  ok('...the card path in full on hover', await C.locator('.gcard').getAttribute('title') === HUB + ' › Motion › Oscillator');
  const desc = await C.locator('.gdesc').textContent();
  ok('...its catalog desc on one line, in full on hover', desc.length > 0 && await C.locator('.gdesc').getAttribute('title') === desc, desc);
  ok('...its range, unit and what the sockets do', await C.locator('.gspec').textContent() === '0 to 20 Hz · in sets, out reads', await C.locator('.gspec').textContent());
  ok('...and each socket says it in its tooltip', await C.locator(':scope > [data-sock][data-side=in]').getAttribute('title') === 'Input: sets Cycles a second (float)'
    && await C.locator(':scope > [data-sock][data-side=out]').getAttribute('title') === 'Output: reads Cycles a second (float)');
  ok('nodes of one card share its key and accent; another card gets another', await C.getAttribute('data-card') === await A.getAttribute('data-card')
    && await accentOf(C) === await accentOf(A) && await Sp.getAttribute('data-card') !== await C.getAttribute('data-card') && await accentOf(Sp) !== await accentOf(C),
  [await accentOf(C), await accentOf(A), await accentOf(Sp)]);
  const r4 = await f3(0.62, 0.62, 'lush motor');
  const T = node('Motor');
  ok('a toy control is found by its device: "lush motor"', r4[0] === 'Motor' && /^ButtplugIO › Lush$/.test(r4[1]) && await T.count() === 1, r4);
  ok('...the toy node names its device as its card, range and sockets', await T.locator('.gcard').textContent() === 'Lush'
    && await T.locator('.gspec').textContent() === '0 to 20 · in drives, out from apps', await T.locator('.gspec').textContent());
  ok('...and with two devices drawn, a hub card names its hub after the card', await C.locator('.gcard').textContent() === 'Oscillator · ' + HUB);
  await f3(0.12, 0.35, 'math');
  ok('an op placed by F3', await opNode('Add').count() === 1);

  // Shift+Enter, Enter on a placed field, and the show button find the node on the canvas.
  const centered = async (loc) => {
    const [b, v] = [await loc.boundingBox(), await page.locator('.graph .gview').boundingBox()];
    return Math.hypot(b.x + b.width / 2 - (v.x + v.width / 2), b.y + b.height / 2 - (v.y + v.height / 2)) < 4;
  };
  const panAway = async () => {
    await page.mouse.move(...at(0.95, 0.95));
    await page.mouse.down();
    await page.mouse.move(...at(0.55, 0.6), { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  await panAway();
  await f3(0.5, 0.5, 'cycles', 'Shift+Enter');
  ok('Shift+Enter shows the node already on the canvas: centered, selected, focused', await centered(C) && await C.getAttribute('data-sel') === ''
    && await C.evaluate((e) => document.activeElement === e) && await node('Cycles a second').count() === 1);
  await panAway();
  await f3(0.5, 0.5, 'peak displacement');
  ok('Enter on a field already placed shows it instead of adding a second', await A.count() === 1 && await centered(A) && await A.getAttribute('data-sel') === '');
  await panAway();
  await f3(0.5, 0.5, 'math', 'Shift+Enter');
  ok('...an op family too: Shift+Enter shows its node', await centered(opNode('Add')) && await opNode('Add').getAttribute('data-sel') === '');
  await panAway();
  await page.mouse.click(...at(0.5, 0.5), { button: 'right' });
  await pal.locator('input').fill('pattern speed');
  const go = pal.locator('.gpal-row', { has: page.locator('.gpal-label', { hasText: /^Speed$/ }) }).first().locator('.gpal-go');
  await go.click();
  await page.waitForTimeout(80);
  ok('a row whose node is placed carries a show button, for touch', await centered(Sp) && await Sp.getAttribute('data-sel') === '');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('F3');
  await page.waitForTimeout(80);
  ok('outside the editor F3 is still the shell\'s look-for', await page.locator('.lf').count() === 1 && await pal.count() === 0);
  await page.keyboard.press('Escape');

  // Live state: a write in flight reads pending on its node.
  await page.click('.gtool button:has-text("Fit")');
  await page.waitForTimeout(200);
  await page.screenshot({ path: EVID + 'graph-1428x900-dark.png' });
  await f3(0.3, 0.3, 'oscillator', null);
  await page.screenshot({ path: EVID + 'f3-1428x900-dark.png' });
  await page.keyboard.press('Escape');
  hub.hold = true;
  await page.locator('.dash-item:has(.graph) .dash-open').click();
  await page.click('nav.rail [role=tab][title="Motion"]');
  const slider = page.locator('.field[data-uid="4416:frequency"] input[type=range]').first();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => els.map((e) => e.dataset.tabId))) {
    await page.click('[data-tab-id="' + id + '"]');
    await page.waitForTimeout(120);
    if (await page.$('.dash-item:has(.graph) .dash-open')) break;
  }
  await page.locator('.dash-item:has(.graph) .dash-open').click();
  await page.waitForTimeout(150);
  const pend = await C.locator('.gline[data-phase=pending]').textContent().catch(() => '');
  ok('a write in flight reads on its node: pending (or overdue), in words', /^(pending|overdue): waiting for the hub$/.test(pend), pend);
  await page.screenshot({ path: EVID + 'pending-1428x900-dark.png' });
  hub.hold = false;

  // Gated and stale: the link gone, a settable field says why it cannot be set and its value dims.
  hub.down = true;
  for (const s of hub.sockets) s.close();
  hub.sockets.clear();
  await page.waitForTimeout(400);
  const gate = await C.locator('.gline[data-phase=gated]').textContent().catch(() => '');
  const stale = await C.locator('.gline[data-stale]').getAttribute('title').catch(() => '');
  ok('without a link a settable node says it is gated, in words (law 3)', gate === 'gated: no hub link', gate);
  ok('...and its value dims as stale, the age on hover (law 8)', /^stale: /.test(stale || ''), stale);
  await page.screenshot({ path: EVID + 'gated-stale-1428x900-dark.png' });
  hub.down = false;
  const graph = await stored(page);
  ok('no page errors (ph-5wo6)', errors.length === 0, errors);
  await ctx.close();

  // The same graph at 1428x900 Paper and 420x860 dark and Paper.
  for (const [name, theme, size] of [['1428x900-paper', PAPER, W], ['420x860-dark', null, { width: 420, height: 860 }], ['420x860-paper', PAPER, { width: 420, height: 860 }]]) {
    const store = { [STORAGE_KEY]: JSON.stringify(graph), ...(theme ? { [THEME_KEY]: JSON.stringify(theme) } : {}) };
    const o = await open({ viewport: W, store });
    if (size !== W) {
      await o.page.setViewportSize(size);
      await o.page.waitForTimeout(300);
      if (await o.page.$eval('.graph', (g) => g.inert).catch(() => false)) {
        await o.page.locator('.dash-item:has(.graph) .dash-open').scrollIntoViewIfNeeded();
        await o.page.locator('.dash-item:has(.graph) .dash-open').click();
        await o.page.waitForTimeout(200);
      }
    }
    await o.page.click('.gtool button:has-text("Fit")');
    await o.page.waitForTimeout(200);
    await o.page.screenshot({ path: EVID + 'graph-' + name + '.png' });
    const v = await o.page.locator('.graph .gview').boundingBox();
    await o.page.mouse.move(v.x + 12, v.y + 12);
    await o.page.locator('.graph .gview').focus();
    await o.page.keyboard.press('F3');
    await o.page.locator('.gpal input').fill('oscillator');
    await o.page.waitForTimeout(80);
    await o.page.screenshot({ path: EVID + 'f3-' + name + '.png' });
    const inside = await o.page.evaluate(() => {
      const [m, c] = [document.querySelector('.gpal'), document.querySelector('.gview')].map((e) => e.getBoundingClientRect());
      return m.left >= c.left - 0.5 && m.right <= c.right + 0.5 && m.top >= c.top - 0.5 && m.bottom <= c.bottom + 0.5;
    });
    ok('the node search fits inside the editor at ' + name, inside);
    await o.page.keyboard.press('Escape');
    await o.page.mouse.click(v.x + 12, v.y + 12, { button: 'right' });
    await o.page.waitForTimeout(80);
    await o.page.screenshot({ path: EVID + 'menu-' + name + '.png' });
    const cards = await o.page.locator('.gnode[data-card] .gcard').allTextContents();
    ok('cards read on every node after a reload at ' + name, cards.length === 4 && cards.includes('Lush'), cards);
    ok('no page errors (' + name + ')', o.errors.length === 0, o.errors);
    await o.ctx.close();
  }
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
  // The lowest row where both fingers land on bare canvas, 40 px clear all
  // round (Chrome snaps a touch to a nearby target): a finger on a node
  // belongs to that node, and the opened card's fit puts nodes anywhere.
  const cy = await page.evaluate(([x, top, bottom]) => {
    const bare = (px, y) => { const e = document.elementFromPoint(px, y); return !!e && !!e.closest('.gview') && !e.closest('[data-gid], [data-sock], .gwire-hit'); };
    const clear = (px, y) => [-40, 0, 40].every((dx) => [-40, 0, 40].every((dy) => bare(px + dx, y + dy)));
    for (let y = bottom - 48; y > top + 48; y -= 8) if (clear(x - 20, y) && clear(x + 20, y)) return y;
    return bottom - 24;
  }, [cx, vb.y, vb.y + vb.height]);
  const touch = (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] });
  await touch('touchStart', 20);
  for (const d of [30, 45, 60, 80]) await touch('touchMove', d);
  await touch('touchEnd', 0);
  await page.waitForTimeout(100);
  ok('two fingers spreading on the canvas zoom in', await scale() > k0, [k0, await scale()]);

  // Phone width: one toolbar row, the rest under More, Fit from the graph's top-left (ph-18q).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  // The phone renderer class lays out its own grid; its card comes back as a preview.
  const card = await page.$eval('.graph', (g) => ({ inert: g.inert })).catch(() => null);
  if (card && card.inert) {
    await page.locator('.dash-item:has(.graph) .dash-open').scrollIntoViewIfNeeded();
    await page.locator('.dash-item:has(.graph) .dash-open').click();
    await page.waitForTimeout(200);
  }
  ok('the editor opens at 390 px', !!(await page.$('.graph:not([inert])')), card);
  const row = await page.$$eval('.gtool > .og-btn', (els) => els.filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('at 390 px the toolbar is one row: + Add, Fit, More (ph-18q)', row.length === 3 && new Set(row).size === 1, row);
  await page.click('.gtool .gmore-btn');
  const rest = await page.$$eval('.gmore .og-btn', (els) => els.map((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; }));
  ok('...More opens the other nine tools, on screen', rest.length === 9 && rest.every(Boolean), rest);
  await page.keyboard.press('Escape');
  ok('...and Escape closes it, leaving the editor open', !(await page.$eval('.gmore', (e) => e.getClientRects().length)) && !!(await page.$('.graph:not([inert])')));
  await page.click('.gtool button:has-text("Fit")');
  await page.waitForTimeout(100);
  if (SHOTS) await page.screenshot({ path: SHOTS + '/phone-fit.png' });
  const phone = await page.evaluate(() => {
    const v = document.querySelector('.gview').getBoundingClientRect();
    const seen = [...document.querySelectorAll('.gnode')].map((n) => n.getBoundingClientRect())
      .filter((b) => b.right > v.left && b.left < v.right && b.bottom > v.top && b.top < v.bottom);
    return { seen: seen.length, cut: seen.filter((b) => b.left < v.left - 0.5 || b.top < v.top - 0.5).length };
  });
  ok('...Fit at the zoom floor starts at the graph\'s top-left: nodes in view, none cut at the left or top', await scaleOf(page) >= 1 && phone.seen > 0 && phone.cut === 0, phone);
  ok('no page errors (touch)', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the node editor wires, refuses, undoes and keeps its wires through pan and zoom.'));
process.exit(fails ? 1 : 0);
