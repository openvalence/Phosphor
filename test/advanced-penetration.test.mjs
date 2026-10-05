/**
 * advanced-penetration.test.mjs -- the factory pattern card in the real shell
 * bundle (shell-build.mjs, stub Tauri runtime) against a fake hub serving the
 * recorded catalog (test/fixtures/advgen-roles-catalog.mjs). Asserts:
 *   load       the card substitutes both pattern built-ins; claimed fields
 *              leave the generic cards
 *   tabs       Advanced and Classic are views, each with its own Start; a
 *              switch writes nothing
 *   sources    Advanced starts on advgen.running, Classic on pattern.running;
 *              each is refused while the other runs, the owner named from
 *              control-owner's labels (stop Advanced first, and the reverse)
 *   handles    a held deep drag writes once on release, pending on the
 *              handle and in words in the plot's note, then the echo;
 *              snapped and bounded; the numeric twin shows the same field;
 *              a refusal reads on the handle and the note; speed and accel
 *              handles write the right direction; shift+arrow nudges ten
 *              steps in one write
 *   rhythm     the amp fader and a step handle write their fields in whole
 *              strokes; the staircase follows the echo
 *   presets    a dropdown of named slots; choose loads, Save prompts a name
 *              into the first empty slot, Delete confirms, Reset restores
 *              defaults
 *   confirm    background_run enable asks the host; a cancel sends nothing
 *   targets    40 px on a touch pointer (law 12); nothing wears --bad
 *   gate       a watch-tier session disables every handle with the reason
 *   fallback   disabled, the plugin renders nothing
 *   link       off by default; on from 40/100/100 writes 80/50/50 in one
 *              intent; a linked drag moves the peak and holds 1/in + 1/out;
 *              unlink writes nothing; at master 100 nothing, and the tooltip
 *   labels     no handle label on the stroke, the staircase or a guide line,
 *              none backed, in six base states
 *   inputs     the toggle right of the preset box, hidden by default and
 *              persisted; the strip above stays; handles keep the keys
 *   mod tabs   the switch writes amount 0 and restores it; the trash resets
 *              all six in one intent; a plus spawns a hold as a vertical pill
 *   dwell      RFC-095: a plus at each bound spawns DWELL_SPAWN (key 46 for
 *              the crest), a vertical pill drags it longer and the flat is
 *              drawn, past DWELL_CAP it is cut (dotted middle), dragged to 0
 *              it collapses; the second enabled_mask grays and ungrays them;
 *              the plan strip reads the owner and hold on a hold sample and
 *              stays live through it
 *   review     (2026-10-02) Speed wears the host's field ring: pending,
 *              overdue and the echo move no box, overdue is amber and never
 *              calmer than pending; a handle label holds its place through
 *              the ladder; a plus sits clear of labels, marks and the curve;
 *              modifier graph texts never overlap at 390 and 844 wide, the
 *              amp handle inside; focus, selection and pressed wear
 *              --highlight (focus ring 3:1 on Paper), handles and tabs
 *              hover; one case per role; the unit as the host draws it; one
 *              switch design; tabs never truncate; the wave says stopped
 *
 * Live mode (--live): against valencesim, the deep drag (echo and numeric
 * twin), the link rescale (one intent, keys 2, 5, 6, echoed), Advanced
 * running with its playhead and told-wave, a 0.5 crest dwell (plan style
 * hold, the playhead parked at the deep bound), and both SOURCE_CONFLICT
 * refusals; skips (exit 0) unless the sim carries advgen.*.
 * --shot <png> saves the card, and each item's shot beside it.
 *
 * Run: node test/advanced-penetration.test.mjs [--shot out.png]
 *      node test/advanced-penetration.test.mjs --live [--port 8882] [--http 8880] [--shot out.png]
 *        (valencesim --homed --headless --port 8882 --http 8880)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { createSession } from '../../Valence/clients/js/index.js';
import { cbMap, cbUint, cbInt, cbF32, cbBool, cbBstr, cbTstr, cbArray, cbDecodeFull } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, PACKED, NACK } from '../../Valence/clients/js/frames.js';
import { toHex } from '../../Valence/clients/js/sha256.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { advgenCatalog } from './fixtures/advgen-roles-catalog.mjs';
import { linkRescale, linkSpan, linkPartner, DWELL_CAP } from '../plugins/factory/advanced-penetration/index.js';
import { THEMES } from '../src/model/theme.js';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const SHOT = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
const SIM_PORT = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 8882;
const SIM_HTTP = args.includes('--http') ? parseInt(args[args.indexOf('--http') + 1], 10) : 8880;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A sibling of --shot named for one item. */
const shot = (name) => SHOT.replace(/[^/\\]+$/, name + '.png');
const BASE_LABELS = ['Max depth', 'Min depth', 'In speed', 'Out speed', 'In accel', 'Out accel'];

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

let { bytes: CAT, etag: ETAG } = advgenCatalog();
const ENTRIES = decodeCatalog(CAT);
const byName = (n) => ENTRIES.find((e) => e.name === n);
const ADV = byName('pattern-advanced');
const runOf = (entryName) => {
  const e = byName(entryName), f = e.layout.find((x) => x.role === (entryName === 'pattern-advanced' ? 'advgen.running' : 'pattern.running'));
  return { ch: e.settingChannel, key: f.settingKey, uid: e.id + ':' + f.name };
};
const ADVRUN = runOf('pattern-advanced'), CLSRUN = runOf('pattern-state');
// control-owner source ids, index-aligned to its option labels {Jog, Stream, Classic, Advanced}
const SRC = { classic: 2, advanced: 3 };
const uidOf = (e, name) => e.id + ':' + name;

// ---- the fake hub -----------------------------------------------------------
const hub = { mode: 'echo', held: [], values: {}, intents: [], roles: 2,
  items: new Map([[0, 'Tease']]), store: byName('pattern-presets').store };
const SIZE = { [PACKED.u8]: 1, [PACKED.i8]: 1, [PACKED.u16]: 2, [PACKED.i16]: 2, [PACKED.u32]: 4,
  [PACKED.i32]: 4, [PACKED.f32]: 4, [PACKED.bitfield8]: 1, [PACKED.str16]: 16, [PACKED.str32]: 32, [PACKED.str64]: 64 };
function fieldValue(e, f) {
  const k = e.id + ':' + f.name;
  if (k in hub.values) return hub.values[k];
  if (f.role === 'meta.enabled_mask') return 0xff;
  if (e.name === 'pattern-presets-roster') return f.name === 'capacity' ? hub.store.capacity : f.name === 'count' ? hub.items.size : 1;
  if (f.default != null) return Number(f.default);
  return 0;
}
function encodePacked(e) {
  const out = new Uint8Array(e.layout.reduce((a, f) => a + (SIZE[f.type] ?? 0), 0));
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const f of e.layout) {
    const v = fieldValue(e, f);
    const raw = f.type === PACKED.f32 ? v : Math.round(v * (f.scale || 1));
    if (f.type === PACKED.u8 || f.type === PACKED.bitfield8) dv.setUint8(off, raw);
    else if (f.type === PACKED.u16) dv.setUint16(off, raw, true);
    else if (f.type === PACKED.i16) dv.setInt16(off, raw, true);
    else if (f.type === PACKED.u32) dv.setUint32(off, raw, true);
    else if (f.type === PACKED.i32) dv.setInt32(off, raw, true);
    else if (f.type === PACKED.f32) dv.setFloat32(off, v, true);
    off += SIZE[f.type] ?? 0;
  }
  return out;
}
const cbAny = (v) => (typeof v === 'string' ? cbTstr(v) : typeof v === 'boolean' ? cbBool(v)
  : !Number.isInteger(v) ? cbF32(v) : v < 0 ? cbInt(v) : cbUint(v));
const sorted = (pairs) => cbMap(pairs.sort((a, b) => a[0] - b[0]));

function fakeHub(ws) {
  const send = (type, ch, payload, seq = 0) => { try { ws.send(Buffer.from(encodeFrame(type, ch, payload, seq))); } catch (e) { /* closed */ } };
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
          [K.roles, cbUint(hub.roles)], [K.deadman_ms, cbUint(600000)],
          [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
            [IDENTITY_K.hub_name, cbTstr('AP fixture')]])],
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
        hub.intents.push({ ch, val: Object.fromEntries(val) });
        const starts = (r) => ch === r.ch && val.some(([k, v]) => k === r.key && v);
        if ((starts(ADVRUN) && hub.values[CLSRUN.uid]) || (starts(CLSRUN) && hub.values[ADVRUN.uid])) {
          send(FRAME.NACK, ch, sorted([[K.code, cbUint(NACK.SOURCE_CONFLICT)], [K.intent_seq, cbUint(header.seq)]]));
          continue;
        }
        const answer = () => {
          const touched = new Set();
          for (const [k, v] of val) {
            for (const st of ENTRIES.filter((e) => e.settingChannel === ch && e.layout)) {
              const f = st.layout.find((x) => x.settingKey === k);
              if (f) { hub.values[st.id + ':' + f.name] = v; touched.add(st.id); }
            }
          }
          const op = Object.fromEntries(val);
          if (ch === byName('pattern-presets-cmd').id) {
            if (op[1] === 1 || op[1] === 4) hub.items.set(op[2], op[3] || hub.items.get(op[2]) || '');
            if (op[1] === 3) hub.items.delete(op[2]);
            touched.add(byName('pattern-presets-roster').id);
          }
          const a = !!hub.values[ADVRUN.uid], c = !!hub.values[CLSRUN.uid];
          hub.values['4:src0'] = a ? SRC.advanced : c ? SRC.classic : 0;
          hub.values['4:owner0'] = a || c ? 7 : 0;
          touched.add(4);
          send(FRAME.ECHO, ch, cbMap([[K.cfg_gen, cbUint(2)], [K.intent_id, cbUint(id)],
            [K.applied, cbMap(val.map(([k, v]) => [k, cbAny(v)]))]]));
          for (const t of touched) pushState(t);
        };
        if (hub.mode === 'hold') hub.held.push(answer);
        else if (hub.mode === 'nack') send(FRAME.NACK, ch, sorted([[K.code, cbUint(NACK.INVALID_VALUE)], [K.intent_seq, cbUint(header.seq)]]));
        else answer();
      } else if (header.type === FRAME.BLOB_REQ) {
        const b = cbDecodeFull(payload).get(K.blob);
        const slot = b.get(3);
        const name = hub.items.get(slot);
        if (name == null) {
          send(FRAME.NACK, 0, sorted([[K.code, cbUint(NACK.CHUNK_UNAVAILABLE)], [K.intent_seq, cbUint(header.seq)]]));
        } else {
          const item = cbMap([[3, cbUint(slot)], [5, cbTstr(name)], [6, cbTstr(hub.store.kind)], [7, cbBstr(new Uint8Array(4))]]);
          const head = new Uint8Array(14);
          const dv = new DataView(head.buffer);
          dv.setUint8(0, 1); dv.setUint8(1, hub.store.storeId); dv.setUint8(2, slot);
          dv.setUint16(8, 1, true); dv.setUint32(10, item.length, true);
          send(FRAME.BLOB_CHUNK, 0, Buffer.concat([head, item]));
        }
      } else if (header.type === FRAME.PING) {
        send(FRAME.PONG, header.channel, payload);
      }
    }
  });
}
async function release() {
  for (let i = 0; i < 100 && !hub.held.length; i++) await sleep(10);
  hub.mode = 'echo';
  for (const a of hub.held.splice(0)) a();
}

// ---- live: the sim's own catalog must carry the roles ------------------------
if (LIVE) {
  const sess = createSession({ host: '127.0.0.1', port: SIM_PORT, clientKind: 'webui', clientName: 'ap probe',
    autoReconnect: false, catalogStore: { load: () => null, save() {}, clear() {} } });
  const live = await new Promise((res) => { setTimeout(() => res(false), 5000); sess.on('live', () => res(true)); sess.connect(); });
  for (let i = 0; i < 50 && live && !sess.catalog; i++) await sleep(100);
  const roled = live && (sess.catalog || []).some((e) => (e.layout || []).some((f) => f.role === 'advgen.master'));
  try { sess.close(); } catch (e) { /* gone */ }
  if (!roled) { console.log('SKIP: no valencesim with advgen.* roles on 127.0.0.1:' + SIM_PORT); process.exit(0); }
}

// ---- the page ---------------------------------------------------------------
const SHELL = await buildShellPage();
// Live: /uitoken is same-origin to the page (credentials.js mintUrl), so it is proxied to the sim.
const srv = createServer((q, s) => {
  if (LIVE && q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + SIM_HTTP + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});

// The shell mints through @tauri-apps/plugin-http; the stub rejects every
// command, so live mode services that plugin's four commands with fetch.
function HTTP_STUB() {
  const base = window.__TAURI_INTERNALS__.invoke;
  const held = new Map();
  let n = 0;
  window.__TAURI_INTERNALS__.invoke = async (cmd, a) => {
    if (cmd === 'plugin:http|fetch') { held.set(++n, { cfg: a.clientConfig }); return n; }
    if (cmd === 'plugin:http|fetch_send') {
      const h = held.get(a.rid);
      const r = await fetch(h.cfg.url, { method: h.cfg.method });
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
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();

// Every intent the page sends, decoded off the socket (fake hub and live alike).
const wire = [];
async function open({ disabled = false, roles = 2, coarse = false, inputs = true, size = null, theme = null } = {}) {
  hub.roles = roles;
  const ctx = await browser.newContext({ viewport: size || { width: 1440, height: SHOT ? 2400 : 1000 }, hasTouch: coarse });
  await ctx.addInitScript(TAURI_STUB);
  if (LIVE) await ctx.addInitScript(HTTP_STUB);
  await ctx.addInitScript(([etag, bytes, live, disabled, port, inputs, theme]) => {
    try {
      if (inputs && !sessionStorage.getItem('ap.seeded')) { localStorage.setItem('phosphor.advpen.inputs', '1'); sessionStorage.setItem('ap.seeded', '1'); }
      if (!live) localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      if (live) localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      else localStorage.setItem('shell_host', '127.0.0.1');
      localStorage.setItem('phosphor.plugins.disabled', JSON.stringify(disabled ? ['advanced-penetration'] : []));
      if (theme) localStorage.setItem('phosphor.theme', JSON.stringify(theme));
    } catch (e) { /* none */ }
  }, [ETAG, toHex(CAT), LIVE, disabled, SIM_PORT, inputs, theme]);
  if (!LIVE) await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('websocket', (ws) => ws.on('framesent', ({ payload }) => {
    if (typeof payload === 'string') return;
    for (const { header, payload: p } of parseFrames(new Uint8Array(payload))) {
      if (header.type !== FRAME.INTENT) continue;
      const m = cbDecodeFull(p);
      wire.push({ ch: m.get(K.channel_id), val: Object.fromEntries(m.get(K.value)) });
    }
  }));
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) ok('no page error', false, String(e)); });
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  // A phone width has no rail: its category tabs carry the same ids.
  const up = await page.waitForSelector(size ? '[role=tab][data-tab-id^="cat"]' : 'nav.rail [role=tab]', { timeout: 15000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  return { ctx, page, up };
}

/** The category tab whose page carries the pattern's base fields; plugins load after the catalog. */
async function toPatternPage(page, wantPlugin = true) {
  const sel = wantPlugin ? 'main.pane .ap' : 'main.pane label.field-label[data-uid="' + uidOf(ADV, 'master') + '"]';
  for (let pass = 0; pass < 10; pass++) {
    for (const id of await page.$$eval('[role=tab][data-tab-id^="cat"]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
      await page.click('[data-tab-id="' + id + '"]');
      await page.waitForTimeout(150);
      if (await page.$(sel)) return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}
const setRange = (loc, v) => loc.evaluate((el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const handle = (page, key) => page.locator('main.pane .ap .ap-h[data-key="' + key + '"]:visible').first();
const numIn = (page, label) => page.locator('main.pane .ap .ap-num input[aria-label="' + label + '"]:visible').first();
/** Drag a handle by (dx, dy) CSS px with the mouse; returns the intents it sent. */
async function dragBy(page, loc, dx, dy) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const n0 = hub.intents.length;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + dx * i / 5, y + dy * i / 5);
  await page.mouse.up();
  await page.waitForTimeout(150);
  return hub.intents.slice(n0);
}
const settingOf = (entryName, field) => {
  const e = byName(entryName);
  return { ch: e.settingChannel, key: e.layout.find((f) => f.name === field).settingKey, uid: uidOf(e, field) };
};
const tagOf = async (loc) => (await loc.locator('.ap-tag').textContent()).trim();
const toAdvanced = async (page) => { const t = page.locator('main.pane .ap-tabs button', { hasText: 'Advanced' }); if (await t.count()) await t.click(); };

if (LIVE) {
  console.log('Advanced Penetration, live (valencesim on ' + SIM_PORT + ')');
  const { ctx, page, up } = await open();
  ok('live: the shell adopted the sim catalog', up);
  ok('live: the pattern card renders on the sim', await toPatternPage(page));
  await toAdvanced(page);
  await page.waitForTimeout(500);
  const deep = handle(page, 'deep');
  const before = Number(await numIn(page, 'Max depth').inputValue());
  const intents = await dragBy(page, deep, 0, before > 50 ? 30 : -30);
  const want = Number((await tagOf(deep)).replace(/^deep\s+/, '').split(' ')[0]);
  void intents;
  ok('live: a deep drag moves the value', Number.isFinite(want) && want !== before, { before, want });
  ok('live: the echo confirms on the handle', await page.waitForFunction(() => {
    const e = document.querySelector('main.pane .ap .ap-h[data-key="deep"]');
    return e && e.dataset.status === 'confirmed';
  }, null, { timeout: 5000 }).then(() => true).catch(() => false), await deep.getAttribute('data-status'));
  ok('live: the numeric twin followed the echoed value', Number(await numIn(page, 'Max depth').inputValue()) === want,
    await numIn(page, 'Max depth').inputValue());
  // Link on: master x k and both halves / k in one intent, three keys, echoed; then put the sim back.
  const spIn = numIn(page, 'In speed'), spOut = numIn(page, 'Out speed');
  const speedR = page.locator('main.pane .ap input[type=range][aria-label="Speed"]');
  const link = page.locator('main.pane .ap .ap-link');
  const typeIn = async (inp, v) => { await inp.fill(String(v)); await inp.press('Enter'); await page.waitForTimeout(400); };
  const keep = [Number(await speedR.inputValue()), await spIn.inputValue(), await spOut.inputValue()];
  ok('live: the link is off by default', (await link.getAttribute('aria-pressed')) === 'false');
  await setRange(speedR, 40);
  await page.waitForTimeout(400);
  await typeIn(spIn, 100);
  await typeIn(spOut, 100);
  const w0 = wire.length;
  await link.click();
  const linkEcho = await page.waitForFunction(() => {
    const v = (l) => document.querySelector('main.pane .ap .ap-num input[aria-label="' + l + '"]').value;
    return document.querySelector('main.pane .ap input[type=range][aria-label="Speed"]').value === '80' && v('In speed') === '50' && v('Out speed') === '50'
      && ['vin', 'vout'].every((k) => document.querySelector('main.pane .ap .ap-h[data-key="' + k + '"]').dataset.status === 'confirmed');
  }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  const lw = wire.slice(w0);
  const resc = linkRescale(40, 100, 100, 100, 1, 100);
  ok('live: link on sends one intent with master, in and out (keys 2, 5, 6)', lw.length === 1
    && Object.keys(lw[0].val).sort().join() === '2,5,6' && lw[0].val[2] === resc.master && lw[0].val[5] === resc.in && lw[0].val[6] === resc.out, lw);
  ok('live: the sim echoes 80/50/50 onto the slider, both halves confirmed', linkEcho);
  if (SHOT) await page.locator('main.pane .ap').first().screenshot({ path: shot('6-live-link') });
  await link.click();
  await setRange(speedR, keep[0]);
  await page.waitForTimeout(400);
  await typeIn(spIn, keep[1]);
  await typeIn(spOut, keep[2]);
  const runBtn = () => page.locator('main.pane .ap .ap-run:visible');
  const runNote = async () => (await runBtn().locator('xpath=../../p').textContent()).trim();
  const tab = (t) => page.click('main.pane .ap-tabs button:has-text("' + t + '")');
  const speed = page.locator('main.pane .ap input[type=range][aria-label="Speed"]');
  const m0 = Number(await speed.inputValue());
  await setRange(speed, 40);
  await page.waitForTimeout(400);
  await runBtn().click();
  ok('live: Advanced Start accepted with Classic stopped', await page.waitForFunction(() =>
    /Stop pattern/.test(document.querySelector('main.pane .ap .ap-run').textContent), null, { timeout: 5000 }).then(() => true).catch(() => false),
  await runNote());
  await page.waitForTimeout(1500);
  const p1 = await page.locator('main.pane .ap .ap-play').evaluate((e) => !e.hidden && e.style.left + ',' + e.style.top);
  // The sim can still sit at the shallow end here; wait for it to leave, not a fixed window.
  const p2 = await page.waitForFunction((p) => { const e = document.querySelector('main.pane .ap .ap-play'); const q = !e.hidden && e.style.left + ',' + e.style.top; return q && q !== p && q; },
    p1, { timeout: 5000, polling: 50 }).then((h) => h.jsonValue()).catch(() => p1);
  ok('live: a playhead rides the curve while Advanced runs', !!p1 && !!p2 && p1 !== p2, [p1, p2]);
  if (SHOT) {
    await page.waitForFunction(() => { const e = document.querySelector('main.pane .ap .ap-play'); const x = parseFloat(e.style.left); return !e.hidden && x > 25 && x < 75; },
      null, { timeout: 5000, polling: 16 }).catch(() => {});
    await page.locator('main.pane .ap').first().screenshot({ path: SHOT });
    console.log('  screenshot: ' + SHOT);
  }
  // RFC-095: a 0.5 crest dwell holds at the deep bound for half a stroke (the two moving halves).
  const crest = numIn(page, 'Crest dwell');
  const depthKeep = [await numIn(page, 'Max depth').inputValue(), await numIn(page, 'Min depth').inputValue()];
  await typeIn(numIn(page, 'Max depth'), 50);
  await typeIn(numIn(page, 'Min depth'), 0);
  await setRange(speed, 80);
  await typeIn(crest, 0.5);
  ok('live: the sim holds the 0.5 crest dwell', await page.waitForFunction(() => {
    const e = document.querySelector('main.pane .ap .ap-h[data-key="crest"]');
    return e && e.getAttribute('aria-valuenow') === '0.5' && !/pending|overdue|fault/.test(e.dataset.status);
  }, null, { timeout: 5000 }).then(() => true).catch(() => false));
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(() => new Promise((res) => {
    const out = [], t0 = performance.now();
    const tick = () => {
      const e = document.querySelector('main.pane .ap .ap-play'), m = document.querySelector('.topstrip .readback .plan-mode');
      out.push([performance.now() - t0, m ? m.textContent.trim() : '', e.hidden ? null : parseFloat(e.style.left), e.hidden ? null : parseFloat(e.style.top)]);
      if (performance.now() - t0 < 8000) setTimeout(tick, 10); else res(out);
    };
    tick();
  }));
  // Runs of samples whose plan style reads hold, and the moving time between them.
  const runs = [];
  rec.forEach(([t, m], i) => {
    const hold = /hold$/.test(m), prev = i && /hold$/.test(rec[i - 1][1]);
    if (hold && !prev) runs.push({ a: t, b: t, at: [] });
    if (hold) { runs[runs.length - 1].b = t; runs[runs.length - 1].at.push(rec[i].slice(2)); }
  });
  const whole = runs.slice(1, -1);
  const holdMs = whole.map((r) => r.b - r.a), moveMs = runs.slice(1).map((r, i) => r.a - runs[i].b);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const ratio = avg(holdMs) / avg(moveMs);
  ok('live: the plan style reads hold during the dwell', runs.length >= 3, [...new Set(rec.map(([, m]) => m))]);
  ok('live: each hold lasts about half a stroke (hold / moving time)', whole.length >= 1 && ratio > 0.35 && ratio < 0.65,
    { holdMs: holdMs.map(Math.round), moveMs: moveMs.map(Math.round), ratio: +ratio.toFixed(2) });
  const deepTop = Math.min(...rec.filter((r) => r[3] != null).map((r) => r[3]));
  const parked = whole.every((r) => r.at.slice(3, -3).every(([l, t]) => t != null && Math.abs(t - deepTop) < 1.5
    && Math.abs(l - r.at[3][0]) < 0.5));
  ok('live: the playhead parks at the deep bound through each hold', parked,
    { deepTop, runs: whole.map((r) => [...new Set(r.at.slice(3, -3).map((q) => q.join(',')))]) });
  if (SHOT) {
    await page.waitForFunction(() => /hold$/.test(document.querySelector('.topstrip .readback .plan-mode')?.textContent || ''), null, { timeout: 3000, polling: 5 }).catch(() => {});
    await page.locator('main.pane .ap').first().screenshot({ path: shot('9-live-hold') });
  }
  await typeIn(crest, 0);
  await typeIn(numIn(page, 'Max depth'), depthKeep[0]);
  await typeIn(numIn(page, 'Min depth'), depthKeep[1]);
  await tab('Classic');
  await runBtn().click();
  ok('live: Classic refused while Advanced runs: stop Advanced first', await page.waitForFunction(() => {
    const b = document.querySelector('main.pane .ap .ap-run');
    return b && /stop Advanced first/.test(b.parentElement.parentElement.querySelector('p').textContent);
  }, null, { timeout: 5000 }).then(() => true).catch(() => false), await runNote());
  await tab('Advanced');
  await runBtn().click();
  ok('live: Advanced stops', await page.waitForFunction(() =>
    /Start pattern/.test(document.querySelector('main.pane .ap .ap-run').textContent), null, { timeout: 5000 }).then(() => true).catch(() => false));
  await tab('Classic');
  await page.waitForTimeout(300);
  await runBtn().click();
  ok('live: Classic starts once Advanced stopped', await page.waitForFunction(() =>
    /Stop pattern/.test(document.querySelector('main.pane .ap .ap-run').textContent), null, { timeout: 5000 }).then(() => true).catch(() => false),
  await runNote());
  await tab('Advanced');
  await runBtn().click();
  ok('live: Advanced refused while Classic runs: stop Classic first', await page.waitForFunction(() => {
    const b = document.querySelector('main.pane .ap .ap-run');
    return b && /stop Classic first/.test(b.parentElement.parentElement.querySelector('p').textContent);
  }, null, { timeout: 5000 }).then(() => true).catch(() => false), await runNote());
  await tab('Classic');
  await runBtn().click();
  await page.waitForTimeout(800);
  await tab('Advanced');
  await setRange(speed, m0);
  await dragBy(page, deep, 0, before > 50 ? -30 : 30);   // put the sim's depth back near where it was
  await page.waitForTimeout(500);
  await ctx.close();
} else {
  console.log('Advanced Penetration (shell bundle, recorded catalog ' + ETAG + ')');
  const MAXD = settingOf('pattern-advanced', 'max_depth');
  const MIND = settingOf('pattern-advanced', 'min_depth');
  const SPIN = settingOf('pattern-advanced', 'in_speed');
  const ACIN = settingOf('pattern-advanced', 'in_accel');
  {
    const { ctx, page, up } = await open();
    ok('boot: the shell adopted the fixture catalog', up);
    ok('load: the pattern card is on the pattern page', await toPatternPage(page));
    const generic = await page.$$eval('main.pane label.field-label[data-uid]', (els) => els.map((e) => e.dataset.uid));
    const claimedUids = [ADV, ...ENTRIES.filter((e) => e.modTarget)].flatMap((e) => e.layout
      .filter((f) => f.role && !['meta.enabled_mask', 'advgen.mode'].includes(f.role)).map((f) => uidOf(e, f.name)));
    ok('load: claimed fields leave the generic cards', claimedUids.every((u) => !generic.includes(u)), claimedUids.filter((u) => generic.includes(u)));

    // ---- tabs: a view switch that writes nothing
    const n0 = hub.intents.length;
    const tabs = await page.$$eval('main.pane .ap-tabs button', (bs) => bs.map((b) => b.textContent + ':' + b.getAttribute('aria-selected')));
    ok('tabs: Advanced and Classic, Advanced open', tabs.join() === 'Advanced:true,Classic:false', tabs);
    await page.click('main.pane .ap-tabs button:has-text("Classic")');
    ok('tabs: Classic shows the pattern select and its own Start', await page.locator('main.pane .ap select[aria-label="Pattern"]').isVisible()
      && (await page.locator('main.pane .ap .ap-run:visible').count()) === 1);
    await toAdvanced(page);
    ok('tabs: switching writes nothing', hub.intents.length === n0);

    // ---- map
    const keys = await page.$$eval('main.pane .ap .ap-stroke .ap-h:not([hidden])', (hs) => hs.map((e) => e.dataset.key));
    ok('map: the stroke editor carries deep, shallow, in v, out v and both accel diamonds',
      ['deep', 'shallow', 'vin', 'vout', 'ain', 'aout'].every((k) => keys.includes(k)), keys);
    const forms = {};
    for (const k of ['deep', 'shallow', 'vin', 'vout', 'ain', 'aout']) forms[k] = await tagOf(handle(page, k));
    ok('map: one label form, name then value (deep, shallow, in, out, in accel, out accel)', /^deep \d+$/.test(forms.deep)
      && /^shallow \d+$/.test(forms.shallow) && /^in \d+$/.test(forms.vin) && /^out \d+$/.test(forms.vout)
      && /^in accel \d+$/.test(forms.ain) && /^out accel \d+$/.test(forms.aout), forms);
    const mtabs = await page.$$eval('main.pane .ap .ap-mtabs [role=tab]', (bs) => bs.map((b) => b.textContent));
    ok('map: one rhythm tab per driven control, in base order, the dwells last', mtabs.join()
      === 'Max depth,Min depth,In speed,Out speed,In accel,Out accel,Crest dwell,Trough dwell', mtabs);
    ok('map: Advanced has its own Start, background_run beside it', /Start pattern/.test(await page.locator('main.pane .ap .ap-run:visible').textContent())
      && await page.locator('main.pane .ap .ap-sw:visible', { hasText: 'Run in background' }).isVisible());
    ok('map: the Advanced Start binds advgen.running', !(await page.locator('main.pane .ap .ap-run:visible').isDisabled()));

    // ---- a held deep drag: one write, pending on the handle, then the echo
    const deep = handle(page, 'deep');
    const y0 = (await deep.boundingBox()).y;
    hub.mode = 'hold';
    const sent = await dragBy(page, deep, 0, -60);
    const wrote = sent.filter((i) => i.ch === MAXD.ch && MAXD.key in i.val);
    ok('drag: one write per release, never one per move', sent.length === 1 && wrote.length === 1, sent);
    ok('drag: snapped to the step, inside the bounds', wrote.length === 1 && Number.isInteger(wrote[0].val[MAXD.key])
      && wrote[0].val[MAXD.key] > 10 && wrote[0].val[MAXD.key] <= 100, wrote[0] && wrote[0].val);
    const strokeNote = page.locator('main.pane .ap .ap-stroke + .ap-note');
    const v = wrote[0] && wrote[0].val[MAXD.key];
    ok('drag: pending on the handle, in words in the plot\'s note', (await deep.getAttribute('data-status')) === 'pending'
      && (await strokeNote.textContent()) === 'deep ' + v + ' · waiting' && (await tagOf(deep)) === 'deep ' + v, [await strokeNote.textContent(), await tagOf(deep)]);
    await release();
    await page.waitForTimeout(250);
    ok('drag: the echo confirms on the handle, the note clears', (await deep.getAttribute('data-status')) === 'confirmed' && (await tagOf(deep)) === 'deep ' + v
      && (await strokeNote.textContent()) === '', await tagOf(deep));
    ok('unify: the numeric twin shows the same field', Number(await numIn(page, 'Max depth').inputValue()) === v);
    ok('drag: the handle moved up with the value', (await deep.boundingBox()).y < y0 - 20);

    // ---- a refused drag
    hub.mode = 'nack';
    await dragBy(page, deep, 0, 30);
    await page.waitForTimeout(250);
    hub.mode = 'echo';
    ok('refusal: amber on the handle, the word in the note, the label keeps the value', (await deep.getAttribute('data-status')) === 'fault'
      && /^deep \d+ · refused$/.test(await strokeNote.textContent()) && (await strokeNote.getAttribute('data-slot')) === 'fault'
      && (await tagOf(deep)) === 'deep ' + v, [await strokeNote.textContent(), await tagOf(deep)]);

    // ---- speed and accel handles
    const vin = handle(page, 'vin');
    const s0 = Number(await numIn(page, 'In speed').inputValue());
    const sv = (await dragBy(page, vin, 40, 0)).filter((i) => i.ch === SPIN.ch && SPIN.key in i.val);
    ok('speed: a longer in half writes a slower in speed', sv.length === 1 && sv[0].val[SPIN.key] < s0
      && sv[0].val[SPIN.key] <= 100, sv[0] && sv[0].val);
    const ain = handle(page, 'ain');
    const a0 = Number(await numIn(page, 'In accel').inputValue());
    const av = (await dragBy(page, ain, -25, 0)).filter((i) => i.ch === ACIN.ch && ACIN.key in i.val);
    ok('accel: pulling the diamond to the foot writes a harder in accel', av.length === 1 && av[0].val[ACIN.key] > a0, av[0] && av[0].val);

    // ---- keyboard
    const sh = handle(page, 'shallow');
    const m0 = Number(await numIn(page, 'Min depth').inputValue());
    const n1 = hub.intents.length;
    await sh.focus();
    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(200);
    const kv = hub.intents.slice(n1);
    ok('keys: shift+arrow is the declared step, one write', kv.length === 1 && kv[0].val[MIND.key] === m0 + 1, kv);
    const nCtl = hub.intents.length;
    await page.keyboard.press('Control+ArrowUp');
    await page.waitForTimeout(250);
    const cv = hub.intents.slice(nCtl);
    ok('keys: ctrl+arrow goes to the next decade multiple, one write', cv.length === 1 && cv[0].val[MIND.key] === (Math.floor((m0 + 1) / 10) + 1) * 10, [cv, m0]);

    // ---- rhythm: In speed's staircase
    const apEl = await page.locator('main.pane .ap').first().elementHandle();
    await page.click('main.pane .ap .ap-mtabs button:has-text("In speed")');
    const AMT = settingOf('pattern-adv-mod-speedin', 'amount');
    const RISE = settingOf('pattern-adv-mod-speedin', 'in_step');
    const flat = await page.locator('main.pane .ap .ap-stair path.curve').getAttribute('d');
    const amp = handle(page, 'amp');
    const aw = (await dragBy(page, amp, 0, 50)).filter((i) => i.ch === AMT.ch && AMT.key in i.val);
    ok('rhythm: the amp fader writes amount', aw.length === 1 && aw[0].val[AMT.key] > 0, aw[0] && aw[0].val);
    await page.waitForTimeout(200);
    // The tab's taller content regrows the card; the plugin keeps its element and state (PluginSlot).
    ok('rhythm: the card regrowing never remounts the plugin', await apEl.evaluate((el) => el.isConnected));
    ok('rhythm: the staircase follows the echoed amount', (await page.locator('main.pane .ap .ap-stair path.curve').getAttribute('d')) !== flat
      && /^amp \d/.test(await tagOf(amp)));
    const rsent = await dragBy(page, handle(page, 'rise'), 240, 0);
    const rw = rsent.filter((i) => i.ch === RISE.ch && RISE.key in i.val);
    ok('rhythm: a step handle writes whole strokes', rw.length === 1 && Number.isInteger(rw[0].val[RISE.key]) && rw[0].val[RISE.key] > 1, rw[0] && rw[0].val);
    ok('rhythm: segments are labeled with their strokes', /to min \d+/.test(await page.locator('main.pane .ap .ap-seg').first().textContent()));

    // ---- presets: a dropdown over the store
    const cmd = byName('pattern-presets-cmd').id;
    const sel = page.locator('main.pane .ap select[aria-label="Preset"]');
    await page.waitForFunction(() => [...document.querySelectorAll('main.pane .ap select[aria-label="Preset"] option')].some((o) => o.textContent === 'Tease'),
      null, { timeout: 5000 }).catch(() => {});
    const opts = await sel.locator('option').allTextContents();
    ok('presets: named slots only, empty ones unlisted', opts.join() === 'Apply a preset,Tease', opts);
    const n2 = hub.intents.length;
    await sel.selectOption({ label: 'Tease' });
    await page.waitForTimeout(200);
    ok('presets: choosing one loads it through action.store', hub.intents.slice(n2).some((i) => i.ch === cmd && i.val[1] === 2 && i.val[2] === 0));
    await sel.selectOption({ value: '' });
    await page.click('main.pane .ap .og-btn:has-text("Save")');
    await page.fill('main.pane .ap input[aria-label="Preset name"]', 'Mine');
    await page.click('main.pane .ap .og-btn:has-text("Save as")');
    await page.waitForTimeout(500);
    const saved = hub.intents.filter((i) => i.ch === cmd && i.val[1] === 1).pop();
    ok('presets: Save with nothing chosen prompts a name, saves to the first empty slot', saved && saved.val[2] === 1 && saved.val[3] === 'Mine', saved);
    ok('presets: the list re-reads', (await sel.locator('option').allTextContents()).includes('Mine'));
    await sel.selectOption({ label: 'Mine' });
    const nR = hub.intents.length;
    await sel.focus();
    await page.keyboard.press('F2');
    const nameIn = page.locator('main.pane .ap input[aria-label="Preset name"]');
    ok('presets: F2 opens the name input prefilled with the chosen name', (await nameIn.isVisible()) && (await nameIn.inputValue()) === 'Mine');
    await nameIn.fill('Mine 2');
    await nameIn.press('Enter');
    await page.waitForTimeout(500);
    const ren = hub.intents.slice(nR).find((i) => i.ch === cmd && i.val[1] === 4);
    ok('presets: Enter renames the same slot (op 4), and no save goes out', ren && ren.val[2] === 1 && ren.val[3] === 'Mine 2' && !(await nameIn.isVisible())
      && !hub.intents.slice(nR).some((i) => i.ch === cmd && i.val[1] === 1), hub.intents.slice(nR));
    await sel.selectOption({ label: 'Mine 2' });
    const nD = hub.intents.length;
    await sel.dblclick();
    const opened = await nameIn.isVisible();
    await nameIn.press('Escape');
    ok('presets: a double-click opens it too, Escape cancels with no write', opened && !(await nameIn.isVisible()) && hub.intents.length === nD);
    await sel.focus();
    await page.keyboard.press('F2');
    await nameIn.fill('Mine 3');
    const nB = hub.intents.length;
    await page.locator('main.pane .ap h4').first().click();
    await page.waitForTimeout(400);
    ok('presets: blur keeps the name', hub.intents.slice(nB).some((i) => i.ch === cmd && i.val[1] === 4 && i.val[3] === 'Mine 3'));
    await sel.selectOption({ label: 'Mine 3' });
    const n3 = hub.intents.length;
    await page.click('main.pane .ap .og-btn:has-text("Delete")');
    const dlg = page.locator('[role=alertdialog]');
    ok('presets: delete asks the host confirm first', await dlg.isVisible().catch(() => false) && hub.intents.length === n3);
    await dlg.locator('button.confirm').click();
    await page.waitForTimeout(400);
    ok('presets: delete sent after the confirm', hub.intents.slice(n3).some((i) => i.ch === cmd && i.val[1] === 3 && i.val[2] === 1));
    const n4 = hub.intents.length;
    await page.click('main.pane .ap .og-btn:has-text("Reset")');
    await page.waitForTimeout(300);
    ok('presets: Reset writes the moved controls back to their defaults',
      hub.intents.slice(n4).some((i) => i.ch === MAXD.ch && i.val[MAXD.key] === 10));

    // ---- confirm and run
    const n5 = hub.intents.length;
    await page.locator('main.pane .ap .ap-sw:visible').click();
    ok('confirm: background_run enable asks the host confirm', await dlg.locator('button', { hasText: 'Cancel' }).isVisible().catch(() => false));
    await dlg.locator('button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(200);
    ok('confirm: a cancel sends nothing', hub.intents.length === n5);
    const runBtn = () => page.locator('main.pane .ap .ap-run:visible');
    const runNote = async () => (await runBtn().locator('xpath=../../p').textContent()).trim();
    const tab = (t) => page.click('main.pane .ap-tabs button:has-text("' + t + '")');
    await toAdvanced(page);
    let n6 = hub.intents.length;
    await runBtn().click();
    await page.waitForTimeout(300);
    ok('sources: Advanced starts on advgen.running', /Stop pattern/.test(await runBtn().textContent())
      && hub.intents.slice(n6).some((i) => i.ch === ADVRUN.ch && i.val[ADVRUN.key]));
    await tab('Classic');
    await runBtn().click();
    await page.waitForTimeout(300);
    ok('sources: Classic refused while Advanced runs, the owner named from the labels', (await runNote()) === 'stop Advanced first', await runNote());
    await tab('Advanced');
    await runBtn().click();
    await page.waitForTimeout(300);
    await tab('Classic');
    await runBtn().click();
    await page.waitForTimeout(300);
    ok('sources: Classic starts on pattern.running once Advanced stopped', /Stop pattern/.test(await runBtn().textContent()));
    await tab('Advanced');
    await runBtn().click();
    await page.waitForTimeout(300);
    ok('sources: and the reverse reads stop Classic first', (await runNote()) === 'stop Classic first', await runNote());
    await tab('Classic');
    await runBtn().click();
    await page.waitForTimeout(300);
    ok('sources: Classic stops', /Start pattern/.test(await runBtn().textContent()));

    const red = await page.evaluate(() => {
      const bad = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim();
      const probe = document.createElement('i'); probe.style.color = bad; document.body.append(probe);
      const rgb = getComputedStyle(probe).color; probe.remove();
      return [...document.querySelectorAll('main.pane .ap *')].filter((e) => {
        const cs = getComputedStyle(e);
        return [cs.color, cs.borderTopColor, cs.backgroundColor, cs.fill, cs.stroke].includes(rgb);
      }).length;
    });
    ok('colors: nothing in the card wears --bad', red === 0, red);
    if (SHOT) { await toAdvanced(page); await page.locator('main.pane .ap').first().screenshot({ path: SHOT }); }
    await ctx.close();
  }

  {
    // ---- live redraw, a fixed time axis, and the in/out speed link
    const SPOUT = settingOf('pattern-advanced', 'out_speed');
    const MAST = settingOf('pattern-advanced', 'master');
    const { ctx, page } = await open();
    await toPatternPage(page);
    await toAdvanced(page);
    const curve = () => page.$$eval('main.pane .ap .ap-stroke path.curve', (ps) => ps.map((p) => p.getAttribute('d')).join('|'));
    const intentLook = () => page.$$eval('main.pane .ap .ap-stroke path.curve', (ps) => ps.every((p) => p.classList.contains('intent')));
    const extent = () => page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll('main.pane .ap .ap-stroke path.curve')].map((p) => p.getBBox());
      return [+a.x.toFixed(2), +(b.x + b.width).toFixed(2)];
    });
    const link = page.locator('main.pane .ap .ap-link');
    const speed = page.locator('main.pane .ap input[type=range][aria-label="Speed"]');
    const spIn = numIn(page, 'In speed'), spOut = numIn(page, 'Out speed');
    const typeIn = async (inp, v) => { await inp.fill(String(v)); await inp.press('Enter'); await page.waitForTimeout(250); };
    ok('link: a chain beside the preset box, off by default', (await link.getAttribute('aria-pressed')) === 'false');

    // Typing redraws before any write or echo; Enter writes the one key.
    hub.mode = 'hold';
    const c0 = await curve(), vx0 = (await handle(page, 'vin').boundingBox()).x, n0 = hub.intents.length;
    const out0 = await spOut.inputValue();
    await spIn.fill('30');
    await page.waitForTimeout(100);
    ok('live: typing In speed redraws the curve and moves its handle before any write', (await curve()) !== c0
      && Math.abs((await handle(page, 'vin').boundingBox()).x - vx0) > 5 && hub.intents.length === n0);
    ok('live: the draft wears the intent look', await intentLook());
    ok('unlinked: the out half stays while typing', (await spOut.inputValue()) === out0);
    await spIn.press('Enter');
    await page.waitForTimeout(200);
    const uw = hub.intents.slice(n0);
    ok('unlinked: an edit writes its own key only', uw.length === 1 && uw[0].val[SPIN.key] === 30 && !(SPOUT.key in uw[0].val), uw);
    ok('live: pending stays in the intent look until the echo', await intentLook());
    await release();
    await page.waitForTimeout(250);
    ok('live: the echo returns the curve to the reality look', !(await intentLook()));

    // A held drag keeps the time axis: the stroke spans the same x at every step.
    for (const key of ['deep', 'vin', 'ain']) {
      const b = await handle(page, key).boundingBox();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      const seen = [await extent()];
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 5; i++) {
        await page.mouse.move(x + (key === 'deep' ? 0 : 8 * i), y - (key === 'deep' ? 12 * i : 0));
        seen.push(await extent());
      }
      await page.mouse.up();
      await page.waitForTimeout(200);
      ok('drag: ' + key + ' keeps the time axis (x extent fixed mid-drag)', seen.every(([a, z]) => a === seen[0][0] && z === seen[0][1]), seen);
    }

    // Link on at master 40, halves 100/100: one intent, master 80, halves 50/50.
    await setRange(speed, 40);
    await typeIn(spIn, 100);
    await typeIn(spOut, 100);
    const n1 = hub.intents.length;
    await link.click();
    await page.waitForTimeout(300);
    const lw = hub.intents.slice(n1);
    ok('link: on from 40/100/100 writes 80/50/50 in one intent', lw.length === 1 && lw[0].ch === MAST.ch
      && lw[0].val[MAST.key] === 80 && lw[0].val[SPIN.key] === 50 && lw[0].val[SPOUT.key] === 50, lw);
    ok('link: the echo lands on the slider and both halves', Number(await speed.inputValue()) === 80
      && (await spIn.inputValue()) === '50' && (await spOut.inputValue()) === '50');
    ok('link: the tooltip says the peak shifts', /peak shifts/.test(await link.getAttribute('title')), await link.getAttribute('title'));
    if (SHOT) await page.locator('main.pane .ap').first().screenshot({ path: shot('1-link-on') });

    // A linked drag moves the peak and holds 1/in + 1/out, both halves in one intent.
    const T = 1 / 50 + 1 / 50;
    const peak0 = (await handle(page, 'deep').boundingBox()).x;
    const n2 = hub.intents.length;
    const dw = (await dragBy(page, handle(page, 'vin'), 60, 0)).filter((i) => i.ch === SPIN.ch);
    const [a, b] = [Number(await spIn.inputValue()), Number(await spOut.inputValue())];
    ok('link: a linked drag writes both halves in one intent', hub.intents.length - n2 === 1 && dw.length === 1
      && SPIN.key in dw[0].val && SPOUT.key in dw[0].val, dw);
    ok('link: the drag moved the peak and held 1/in + 1/out within rounding', Math.abs((await handle(page, 'deep').boundingBox()).x - peak0) > 20
      && a < 50 && Math.abs(1 / a + 1 / b - T) <= 1 / b - 1 / (b + 1), { a, b, err: 1 / a + 1 / b - T });
    const T2 = 1 / a + 1 / b, [lo] = linkSpan(T2, 1, 100);
    await spIn.fill(String(lo + 4));
    await page.waitForTimeout(100);
    ok('link: typing previews the partner from the constant', (await spOut.inputValue()) === String(linkPartner(T2, lo + 4, 1, 100)),
      [await spOut.inputValue(), linkPartner(T2, lo + 4, 1, 100)]);
    await spIn.fill(String(lo - 10));
    await page.waitForTimeout(100);
    ok('link: a value past the partner range stops at the edge', (await spOut.inputValue()) === String(linkPartner(T2, lo, 1, 100))
      && Number(await page.locator('main.pane .ap .ap-h[data-key="vin"]').getAttribute('aria-valuenow')) === lo,
    [lo, await spOut.inputValue(), await page.locator('main.pane .ap .ap-h[data-key="vin"]').getAttribute('aria-valuenow')]);
    await spIn.evaluate((e) => e.blur());
    await page.waitForTimeout(250);
    if (SHOT) await page.locator('main.pane .ap').first().screenshot({ path: shot('1-link-drag') });

    // Unlink writes nothing, and the choice persists.
    const n3 = hub.intents.length;
    await link.click();
    await page.waitForTimeout(200);
    ok('link: unlinking writes nothing', hub.intents.length === n3 && (await link.getAttribute('aria-pressed')) === 'false');
    await page.reload();
    await toPatternPage(page);
    await toAdvanced(page);
    ok('link: the choice survives a reload', (await link.getAttribute('aria-pressed')) === 'false');

    // Master at its top and halves at 100: linking writes nothing and says why.
    await setRange(speed, 100);
    await typeIn(spIn, 100);
    await typeIn(spOut, 100);
    const n4 = hub.intents.length;
    await link.click();
    await page.waitForTimeout(250);
    ok('link: at master 100 with 100/100, linking writes nothing and says lower master', hub.intents.length === n4
      && (await link.getAttribute('title')) === 'Lower master to shift the peak', await link.getAttribute('title'));
    await link.click();
    await setRange(speed, 0);
    await page.waitForTimeout(250);
    await ctx.close();
  }

  // ---- labels clear of the line, in every fixture state, at the widths the dash seeds the card (1428x900, 1024x768:
  // a backed label is allowed only where it overlaps nothing) and at a wide plot (none backed)
  for (const { name, size, wide } of [{ name: '1428x900', size: { width: 1428, height: 900 } }, { name: '1024x768', size: { width: 1024, height: 768 } },
    { name: 'wide plot', size: { width: 1428, height: 900 }, wide: true }]) {
    const { ctx, page } = await open({ size });
    await toPatternPage(page);
    await toAdvanced(page);
    if (wide) await page.addStyleTag({ content: 'main.pane .ap { width: 1184px !important; }' });
    const typeIn = async (label, v) => { const i = numIn(page, label); await i.fill(String(v)); await i.press('Enter'); await page.waitForTimeout(150); };
    const onLine = () => page.evaluate((strict) => {
      const hits = [];
      const R = (e) => e.getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      for (const ed of document.querySelectorAll('main.pane .ap .ap-ed:is(.ap-stroke, .ap-stair)')) {
        if (!ed.offsetParent) continue;
        const pts = [];
        for (const p of ed.querySelectorAll('path.curve[d]:not([d=""])')) {
          const m = p.getScreenCTM(), L = p.getTotalLength();
          for (let s = 0; s <= L; s += 1) { const q = p.getPointAtLength(s); pts.push([m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f]); }
        }
        // The guides (0 and 100, the stair's top, axis and track) are lines a label keeps off too.
        for (const l of ed.querySelectorAll('line:is(.guide, .grid):not([hidden])')) {
          const m = l.getScreenCTM(), [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => +l.getAttribute(a));
          const a = [m.a * x1 + m.c * y1 + m.e, m.b * x1 + m.d * y1 + m.f], b = [m.a * x2 + m.c * y2 + m.e, m.b * x2 + m.d * y2 + m.f];
          const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
          for (let i = 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
        }
        const dots = [...ed.querySelectorAll(':scope > .ap-plus:not([hidden]) > i')].map(R);
        const caps = [...ed.querySelectorAll(':scope > .ap-cap:not([hidden])')].map(R);
        for (const t of ed.querySelectorAll('.ap-h:not([hidden]) .ap-tag')) {
          if (!t.textContent) continue;
          const r = R(t);
          const n = pts.filter(([x, y]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom).length;
          const over = dots.filter((d) => hit(r, d)).length + caps.filter((c) => hit(r, c)).length;
          if (n || over || (strict && t.classList.contains('bg'))) hits.push({ tag: t.textContent, n, over, bg: t.classList.contains('bg') });
        }
      }
      return hits;
    }, !!wide);
    // The review state (shallow 10 just above the 0 guide) among them.
    const STATES = [null, [85, 0, 100, 50, 40, 40], [50, 30, 20, 100, 0, 100], [100, 0, 1, 100, 100, 0], [30, 25, 100, 5, 0, 0], [85, 10, 70, 45, 30, 60]];
    for (const st of STATES) {
      if (st) for (const [i, l] of BASE_LABELS.entries()) await typeIn(l, st[i]);
      await page.waitForTimeout(200);
      const hits = await onLine();
      ok('labels ' + name + ': none on the line, a plus or a caption' + (wide ? ', none backed' : '') + ' (' + (st ? st.join('/') : 'as found') + ')', hits.length === 0, hits);
      if (SHOT && st && st[0] === 85 && !size.height - 900) await page.locator('main.pane .ap').first().screenshot({ path: shot('2-labels') });
    }
    await page.click('main.pane .ap .ap-mtabs [role=tab]:has-text("Max depth")');
    await typeIn('Amp', 100);
    await page.waitForTimeout(200);
    ok('labels ' + name + ': the staircase labels clear its line at full amp', (await onLine()).length === 0, await onLine());
    await ctx.close();
  }

  {
    // ---- the Inputs toggle: default hidden, persisted, nothing above it moves
    const { ctx, page } = await open({ inputs: false });
    await toPatternPage(page);
    await toAdvanced(page);
    const tog = page.locator('main.pane .ap .ap-inputs');
    const rows = () => page.$$eval('main.pane .ap .ap-nums', (els) => els.filter((e) => e.offsetParent !== null).length);
    const sel = page.locator('main.pane .ap select[aria-label="Preset"]');
    const right = async () => { const a = await sel.boundingBox(), b = await tog.boundingBox(); return b.x >= a.x + a.width && Math.abs(b.y - a.y) < 4; };
    ok('inputs: a toggle right of the preset box', await right());
    ok('inputs: hidden by default, not rendered', (await tog.getAttribute('aria-pressed')) === 'false' && (await rows()) === 0
      && (await page.locator('main.pane .ap .ap-num input:visible').count()) === 0);
    if (SHOT) await page.locator('main.pane .ap').first().screenshot({ path: shot('3-inputs-hidden') });
    const strokeY = (await page.locator('main.pane .ap .ap-stroke').boundingBox()).y;
    const rhythmY = (await page.locator('main.pane .ap .ap-rhythm').boundingBox()).y;
    await tog.click();
    await page.waitForTimeout(150);
    ok('inputs: shown on toggle, the strip above stays, the sections below move down',
      (await rows()) >= 2 && (await page.locator('main.pane .ap .ap-stroke').boundingBox()).y === strokeY
      && (await page.locator('main.pane .ap .ap-rhythm').boundingBox()).y > rhythmY + 20);
    ok('inputs: the tooltip is terse', (await tog.getAttribute('title')) === 'Hide inputs');
    if (SHOT) await page.locator('main.pane .ap').first().screenshot({ path: shot('3-inputs-shown') });
    await page.reload();
    await toPatternPage(page);
    await toAdvanced(page);
    ok('inputs: the choice persists (phosphor.advpen.inputs)', (await tog.getAttribute('aria-pressed')) === 'true'
      && await page.evaluate(() => localStorage.getItem('phosphor.advpen.inputs')) === '1');
    await tog.click();
    const n0 = hub.intents.length;
    const vin = handle(page, 'vin');
    await vin.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    ok('inputs: hidden, a focused handle still steps on the arrow keys, one write', hub.intents.length - n0 === 1
      && SPIN.key in hub.intents[n0].val, hub.intents.slice(n0));
    ok('shapes: up-down handles are horizontal pills, left-right ones vertical pills', (await handle(page, 'deep').getAttribute('data-shape')) === 'hpill'
      && (await handle(page, 'vin').getAttribute('data-shape')) === 'vpill' && (await handle(page, 'amp').getAttribute('data-shape')) === 'hpill'
      && (await handle(page, 'rise').getAttribute('data-shape')) === 'vpill');
    await ctx.close();
  }

  {
    // ---- modifier tabs: enable switch and reset trash; holds on the graph
    const { ctx, page } = await open();
    await toPatternPage(page);
    await toAdvanced(page);
    const AMT = settingOf('pattern-adv-mod-speedin', 'amount');
    const HOLD = settingOf('pattern-adv-mod-speedin', 'in_wait');
    const REST = settingOf('pattern-adv-mod-speedin', 'out_wait');
    const MODKEYS = ['amount', 'in_step', 'in_wait', 'out_step', 'out_wait', 'offset'].map((n) => settingOf('pattern-adv-mod-speedin', n).key);
    const tab = page.locator('main.pane .ap .ap-mtab', { has: page.locator('[role=tab]', { hasText: 'In speed' }) });
    await tab.locator('[role=tab]').click();
    const sw = tab.locator('.ap-mon'), trash = tab.locator('.ap-mtrash');
    const typeIn = async (label, v) => { const i = numIn(page, label); await i.fill(String(v)); await i.press('Enter'); await page.waitForTimeout(250); };
    const order = await tab.evaluate((t) => [...t.children].map((c) => c.className || c.getAttribute('role')).join());
    ok('mod tab: the host switch left, name with its dot, trash right', order === 'og-switch ap-mon,tab,ap-mtrash', order);
    const isOn = () => sw.locator('input[role=switch]').isChecked();
    ok('mod tab: at the defaults, off and no trash', !(await isOn())
      && (await trash.evaluate((e) => getComputedStyle(e).visibility)) === 'hidden');
    let n = hub.intents.length;
    await sw.click();
    await page.waitForTimeout(250);
    ok('mod switch: on with nothing kept writes 100', hub.intents.length - n === 1 && hub.intents[n].val[AMT.key] === 100
      && await isOn(), hub.intents.slice(n));
    await typeIn('Amp', 60);
    n = hub.intents.length;
    await sw.click();
    await page.waitForTimeout(250);
    ok('mod switch: off writes amount 0', hub.intents.length - n === 1 && hub.intents[n].val[AMT.key] === 0
      && (await tab.locator('[role=tab]').getAttribute('data-on')) === 'false');
    n = hub.intents.length;
    await sw.click();
    await page.waitForTimeout(250);
    ok('mod switch: on restores the kept amount', hub.intents.length - n === 1 && hub.intents[n].val[AMT.key] === 60);

    // Holds on the graph: a guide and a plus at each corner while 0; the plus spawns one stroke with a vertical pill.
    const plusMin = page.locator('main.pane .ap .ap-stair .ap-plus[aria-label="Add at min"]');
    const plusMax = page.locator('main.pane .ap .ap-stair .ap-plus[aria-label="Add at max"]');
    ok('holds: at 0, a plus at each corner and no hold handle', await plusMin.isVisible() && await plusMax.isVisible()
      && !(await handle(page, 'hold').count()) && !(await handle(page, 'rest').count()));
    const guides = await page.$$eval('main.pane .ap .ap-stair:not([hidden]) line.vguide', (ls) => ls.filter((l) => l.closest('.ap-mview').isConnected)
      .map((l) => [+l.getAttribute('y1'), +l.getAttribute('y2')]));
    ok('holds: gray guides span the plot, the top gap equal to the bottom one', guides.length === 2 && guides.every(([a, b]) => a === 180 - b), guides);
    if (SHOT) await page.locator('main.pane .ap .ap-rhythm').screenshot({ path: shot('5-holds-plus') });
    n = hub.intents.length;
    await plusMin.click();
    await page.waitForTimeout(250);
    ok('holds: the plus spawns at min at one stroke', hub.intents.length - n === 1 && hub.intents[n].val[HOLD.key] === 1, hub.intents.slice(n));
    const pill = handle(page, 'hold');
    ok('holds: the hold carries a vertical pill, the plus gone', (await pill.getAttribute('data-shape')) === 'vpill' && !(await plusMin.isVisible()));
    const k = await page.evaluate(() => { const e = document.querySelector('main.pane .ap .ap-stair'); return e.getBoundingClientRect().width * 880 / 1000 / 8; });
    let dw = (await dragBy(page, pill, 4 * k, 0)).filter((i) => HOLD.key in i.val);
    ok('holds: dragging the pill right lengthens the hold', dw.length === 1 && dw[0].val[HOLD.key] === 3, dw);
    await plusMax.click();
    await page.waitForTimeout(250);
    if (SHOT) await page.locator('main.pane .ap .ap-rhythm').screenshot({ path: shot('5-holds-pills') });
    dw = (await dragBy(page, handle(page, 'hold'), -30 * k, 0)).filter((i) => HOLD.key in i.val);
    ok('holds: dragging it back to 0 collapses the segment, the plus returns', dw.length === 1 && dw[0].val[HOLD.key] === 0
      && await plusMin.isVisible() && !(await handle(page, 'hold').count()), dw);
    ok('holds: at max spawned the same way', hub.values[settingOf('pattern-adv-mod-speedin', 'out_wait').uid] === 1 && (await handle(page, 'rest').count()) === 1);
    void REST;

    // Trash: shown once any value leaves its default, resets all six in one intent.
    ok('mod trash: shown once a value leaves its default', (await trash.evaluate((e) => getComputedStyle(e).visibility)) === 'visible');
    if (SHOT) await page.locator('main.pane .ap .ap-rhythm').screenshot({ path: shot('4-mod-tab') });
    n = hub.intents.length;
    await trash.click();
    await page.waitForTimeout(300);
    const tw = hub.intents.slice(n);
    ok('mod trash: one intent with all six keys at their defaults', tw.length === 1 && MODKEYS.every((key) => key in tw[0].val)
      && tw[0].val[AMT.key] === 0 && tw[0].val[HOLD.key] === 0, tw);
    ok('mod trash: hidden again, the switch off', (await trash.evaluate((e) => getComputedStyle(e).visibility)) === 'hidden'
      && !(await isOn()));
    await ctx.close();
  }

  {
    // ---- RFC-095 dwells on the stroke picture
    const { ctx, page } = await open();
    await toPatternPage(page);
    await toAdvanced(page);
    const CREST = settingOf('pattern-advanced', 'dwell_crest'), TROUGH = settingOf('pattern-advanced', 'dwell_trough');
    const MASK2 = uidOf(ADV, ADV.layout.filter((f) => f.role === 'meta.enabled_mask')[1].name);
    const plus = (w) => page.locator('main.pane .ap .ap-stroke .ap-plus[aria-label="Add ' + w + ' dwell"]');
    const flat = (w) => page.locator('main.pane .ap .ap-stroke path[data-dwell="' + w + '"]');
    const flatW = (w) => flat(w).evaluate((p) => p.getBBox().width);
    const cutDots = (w) => page.$$eval('main.pane .ap .ap-stroke line.cut[data-dwell="' + w + '"]', (ls) => ls.filter((l) => !l.hasAttribute('hidden')).length);
    const plotW = 960 - 70;
    await numIn(page, 'Max depth').fill('85');
    await numIn(page, 'Max depth').press('Enter');
    await page.waitForTimeout(250);
    ok('dwell: at 0, a plus at each bound, no dwell pill, no flat', await plus('crest').isVisible() && await plus('trough').isVisible()
      && !(await handle(page, 'crest').count()) && !(await handle(page, 'trough').count()) && (await flat('crest').getAttribute('d')) === '');
    ok('dwell: the numeric twins carry both dwells', await numIn(page, 'Crest dwell').isVisible() && await numIn(page, 'Trough dwell').isVisible());

    // The second enabled_mask gates settings 8 and 9 (SPEC §8.8): clear grays both, set ungrays them.
    hub.values[MASK2] = 0;
    hub.push(ADV.id);
    await page.waitForTimeout(250);
    ok('mask: the second enabled_mask grays both dwells', await plus('crest').isDisabled() && await numIn(page, 'Trough dwell').isDisabled()
      && !(await numIn(page, 'Max depth').isDisabled()));
    hub.values[MASK2] = 0b11;
    hub.push(ADV.id);
    await page.waitForTimeout(250);
    ok('mask: set, the second enabled_mask ungrays them', !(await plus('crest').isDisabled()) && !(await numIn(page, 'Trough dwell').isDisabled()));

    let n = hub.intents.length;
    await plus('crest').click();
    await page.waitForTimeout(250);
    ok('dwell: the crest plus writes key 46 at ' + 0.01 + ' strokes, one intent', hub.intents.length - n === 1
      && hub.intents[n].ch === CREST.ch && CREST.key === 46 && Math.abs(hub.intents[n].val[46] - 0.01) < 1e-6, hub.intents.slice(n));
    const pill = handle(page, 'crest');
    ok('dwell: a vertical pill on a guide, the plus gone, the flat drawn to scale', (await pill.getAttribute('data-shape')) === 'vpill'
      && !(await plus('crest').isVisible()) && Math.abs(await flatW('crest') / plotW - 0.01 / 1.01) < 0.01, await flatW('crest'));
    await plus('trough').click();
    await page.waitForTimeout(250);
    if (SHOT) await page.locator('main.pane .ap .ap-stroke').screenshot({ path: shot('7-dwell-short') });
    const w0 = await flatW('crest');
    const bw = (await page.locator('main.pane .ap .ap-stroke').boundingBox()).width;
    let dw = (await dragBy(page, pill, 0.015 * bw, 0)).filter((i) => CREST.key in i.val);
    const v1 = dw.length && dw[0].val[CREST.key];
    ok('dwell: dragging the pill right lengthens the crest dwell, one write', dw.length === 1 && v1 > 0.01 && v1 < 0.5, dw);
    ok('dwell: the flat follows, still whole', (await flatW('crest')) > w0 && (await cutDots('crest')) === 0, [w0, await flatW('crest')]);
    dw = (await dragBy(page, pill, 0.5 * bw, 0)).filter((i) => CREST.key in i.val);
    const v2 = dw.length && dw[0].val[CREST.key];
    ok('dwell: past the cap the value keeps growing, the flat holds the cap, its middle dotted', dw.length === 1 && v2 > 1
      && Math.abs(await flatW('crest') - DWELL_CAP * plotW) < 1 && (await cutDots('crest')) === 6, { v2, w: await flatW('crest') });
    if (SHOT) await page.locator('main.pane .ap .ap-stroke').screenshot({ path: shot('7-dwell-cut') });
    const labelHits = await page.evaluate(() => {
      const ed = document.querySelector('main.pane .ap .ap-stroke'), pts = [];
      for (const p of ed.querySelectorAll('path.curve[d]:not([d=""])')) {
        const m = p.getScreenCTM(), L = p.getTotalLength();
        for (let s = 0; s <= L; s += 1) { const q = p.getPointAtLength(s); pts.push([m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f]); }
      }
      return [...ed.querySelectorAll('.ap-h:not([hidden]) .ap-tag')].filter((t) => t.textContent).map((t) => {
        const r = t.getBoundingClientRect();
        return { tag: t.textContent, n: pts.filter(([x, y]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom).length, bg: t.classList.contains('bg') };
      }).filter((h) => h.n);
    });
    ok('dwell: labels clear of the line and the flats', labelHits.length === 0, labelHits);
    dw = (await dragBy(page, pill, -0.6 * bw, 0)).filter((i) => CREST.key in i.val);
    ok('dwell: dragged back to 0 it collapses, the plus returns', dw.length === 1 && dw[0].val[CREST.key] === 0
      && await plus('crest').isVisible() && !(await handle(page, 'crest').count()) && (await flat('crest').getAttribute('d')) === '', dw);
    n = hub.intents.length;
    await page.click('main.pane .ap .og-btn:has-text("Reset")');
    await page.waitForTimeout(300);
    ok('dwell: preset Reset returns the trough dwell to its default', hub.intents.slice(n).some((i) => i.val[TROUGH.key] === 0));
    const mtab = page.locator('main.pane .ap .ap-mtab', { has: page.locator('[role=tab]', { hasText: 'Crest dwell' }) });
    ok('dwell: the Crest dwell modifier tab carries the switch and the trash', (await mtab.locator('.ap-mon').count()) === 1
      && (await mtab.locator('.ap-mtrash').count()) === 1);
    await mtab.locator('[role=tab]').click();
    ok('dwell: its tab draws the modifier graph', await page.locator('main.pane .ap .ap-stair:visible').count() === 1);

    // The plan strip: a hold sample reads the owner and hold, and stays live past the stall window.
    // Owned by another session (the rail shows the plan strip only then): Advanced, held by session 9.
    await page.locator('main.pane .ap .ap-run:visible').click();
    await page.waitForTimeout(300);
    hub.values['4:owner0'] = 9;
    hub.push(4);
    const PLAN = byName('plan-strip');
    const plan = (o) => { for (const [k, v] of Object.entries(o)) hub.values[uidOf(PLAN, k)] = v; hub.push(PLAN.id); };
    const strip = page.locator('.rail-swap .plan-strip');
    plan({ flags: 1, style: 1, start_norm: 0.1, end_norm: 0.85, cur_norm: 0.5, duration_us: 400000, elapsed_us: 100000 });
    await page.waitForTimeout(150);
    const lit = await strip.evaluate((e) => e.classList.contains('on'));
    await page.waitForTimeout(1800);
    ok('plan: a moving sample lights the strip, and with no successor dims after the stall window', lit
      && !(await strip.evaluate((e) => e.classList.contains('on'))));
    plan({ flags: 1, style: 4, start_norm: 0.85, end_norm: 0.85, cur_norm: 0.85, duration_us: 5000000, elapsed_us: 1000000 });
    await page.waitForTimeout(300);
    const mode = (await page.locator('.topstrip .readback .plan-mode').textContent()).trim();
    ok('plan: a hold sample reads the owner and hold', mode === 'Advanced · Style hold', mode);
    await page.waitForTimeout(2000);
    ok('plan: a hold stays live with no new sample inside its duration (no stall)', await strip.evaluate((e) => e.classList.contains('on')));
    if (SHOT) await page.locator('.rail-swap').screenshot({ path: shot('8-plan-hold') });
    plan({ flags: 0, style: 0, start_norm: 0, end_norm: 0, cur_norm: 0, duration_us: 0, elapsed_us: 0 });
    await page.locator('main.pane .ap .ap-run:visible').click();
    await page.waitForTimeout(250);
    await ctx.close();
  }

  // ---- review fixes (2026-10-02 design review) -----------------------------
  // The review's state: deep 85, shallow 10, in 70, out 45, accel 30/60, a 0.5 crest dwell, a Max depth rhythm.
  const MD = byName('pattern-adv-mod-depth1');
  const REVIEW = { [uidOf(ADV, 'master')]: 60, [uidOf(ADV, 'max_depth')]: 85, [uidOf(ADV, 'min_depth')]: 10, [uidOf(ADV, 'in_speed')]: 70,
    [uidOf(ADV, 'out_speed')]: 45, [uidOf(ADV, 'in_accel')]: 30, [uidOf(ADV, 'out_accel')]: 60, [uidOf(ADV, 'dwell_crest')]: 0.5,
    [uidOf(ADV, 'dwell_trough')]: 0, [uidOf(MD, 'amount')]: 40, [uidOf(MD, 'in_wait')]: 2, [uidOf(MD, 'in_step')]: 1, [uidOf(MD, 'out_step')]: 2 };
  /** The hub at the catalog defaults, then `vals` on top. */
  const hubAt = (vals = {}) => {
    for (const k of Object.keys(hub.values)) if ([ADV.id, MD.id].some((id) => k.startsWith(id + ':')) && !k.endsWith(':running')) delete hub.values[k];
    Object.assign(hub.values, vals);
  };
  /** A token's computed color, through a probe. */
  const tok = (page, name) => page.evaluate((n) => {
    const p = document.createElement('i'); p.style.color = 'var(' + n + ')'; document.body.append(p);
    const c = getComputedStyle(p).color; p.remove(); return c;
  }, name);
  /** WCAG contrast of two computed rgb() colors. */
  const contrast = (a, b) => {
    const lum = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  {
    // ph-rvq: Speed wears the host's field ring; pending, overdue and the echo move no box. ph-8qc: a label holds its place.
    hubAt(REVIEW);
    const { ctx, page } = await open({ inputs: false });
    await toPatternPage(page);
    await toAdvanced(page);
    const ctl = page.locator('main.pane .ap .ap-ctl').first();
    // Boxes against the card's own top, so a pane scroll is not a move.
    const boxes = () => page.evaluate(() => {
      const o = document.querySelector('main.pane .ap').getBoundingClientRect();
      return ['.ap-ctl', 'select[aria-label="Preset"]', '.ap-stroke', '.ap-run', '.ap-planbox'].map((s) => {
        const r = document.querySelector('main.pane .ap ' + s).getBoundingClientRect();
        return [r.x - o.x, r.y - o.y, r.width, r.height].map(Math.round).join();
      }).join(' | ');
    });
    // The ring's three 1 px shadows, in style.css order: amber, intent, reality.
    const look = () => ctl.evaluate((f) => {
      const n = f.querySelector('.ap-note'), cs = getComputedStyle(f);
      const a = [...getComputedStyle(f, '::after').boxShadow.matchAll(/rgba?\(([^)]+)\)/g)].slice(0, 3)
        .map((m) => { const v = m[1].split(/[\s,/]+/).map(Number); return v.length > 3 ? v[3] : 1; });
      return { st: f.dataset.shadow, amber: a[0], intent: a[1], reality: a[2], note: n.textContent, color: getComputedStyle(n).color,
        border: cs.borderTopStyle + ' ' + cs.borderTopWidth };
    });
    const [INTENT, WARN] = [await tok(page, '--intent'), await tok(page, '--warn')];
    const b0 = await boxes(), rest = await look();
    hub.mode = 'hold';
    await setRange(page.locator('main.pane .ap input[type=range][aria-label="Speed"]'), 30);
    await page.waitForTimeout(400);
    const b1 = await boxes(), pend = await look();
    if (SHOT) await ctl.screenshot({ path: shot('r1-speed-pending') });
    await page.waitForTimeout(900);
    const b2 = await boxes(), over = await look();
    if (SHOT) await ctl.screenshot({ path: shot('r1-speed-overdue') });
    await release();
    await page.waitForTimeout(400);
    const b3 = await boxes(), done = await look();
    ok('speed: pending, overdue and the echo move no box (the control, the preset row, the plots, Start)', b1 === b0 && b2 === b0 && b3 === b0, [b0, b1, b2, b3]);
    ok('speed: no state draws a border on the borderless control', [rest, pend, over, done].every((s) => /^none|0px$/.test(s.border)),
      [rest.border, pend.border, over.border]);
    ok('speed: pending wears the field ring in intent and says waiting in intent', pend.st === 'pending' && pend.intent > 0.2
      && pend.note === 'waiting' && pend.color === INTENT, pend);
    ok('speed: overdue turns the ring and the words amber, never calmer than pending', over.st === 'overdue' && over.amber > 0.3
      && over.amber >= pend.intent && over.note === 'still waiting' && over.color === WARN, over);
    ok('speed: the echo lights the afterglow and says confirmed', done.st === 'confirmed' && done.reality > 0.2 && done.note === 'confirmed', done);
    // ph-e31: the value then the unit, the host's Field chip (format.js): no space glyph, a 3 px gap, padded off the edge.
    const unit = await ctl.locator('output').evaluate((o) => ({ text: o.firstChild.textContent, unit: o.querySelector('.unit')?.textContent,
      gap: getComputedStyle(o.querySelector('.unit')).marginLeft, pad: getComputedStyle(o).paddingRight }));
    ok('unit: Speed reads the value, then the unit 3 px off, inside a padded chip', unit.text === '30' && unit.unit === '%' && unit.gap === '3px'
      && unit.pad === '6px', unit);

    // ph-8qc: the deep label holds its place through pending, overdue and the echo; the words ride the note.
    const deep = handle(page, 'deep');
    const tagBox = () => deep.locator('.ap-tag').evaluate((t) => { const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); });
    const note = page.locator('main.pane .ap .ap-stroke + .ap-note');
    hub.mode = 'hold';
    await dragBy(page, deep, 0, -30);
    const t1 = await tagBox(), n1 = await note.textContent();
    ok('handles: pending draws no box around a handle', (await deep.evaluate((e) => getComputedStyle(e).borderTopStyle)) === 'none'
      && (await deep.getAttribute('data-status')) === 'pending');
    await page.waitForTimeout(900);
    const t2 = await tagBox(), n2 = await note.textContent(), s2 = await note.getAttribute('data-slot');
    await release();
    await page.waitForTimeout(300);
    const t3 = await tagBox(), n3 = await note.textContent();
    ok('labels: a handle label holds its place through pending, overdue and the echo', t1 === t2 && t2 === t3, [t1, t2, t3]);
    ok('labels: the ladder words ride the plot\'s note, amber once overdue, cleared by the echo', /^deep \d+ · waiting$/.test(n1)
      && /^deep \d+ · still waiting$/.test(n2) && s2 === 'overdue' && n3 === '', [n1, n2, n3]);

    // ph-mdqo.8: the strip plans motion whether or not Advanced runs; a run moves no box.
    await page.locator('main.pane .ap .ap-run:visible').click();
    await page.waitForTimeout(300);
    await page.locator('main.pane .ap .ap-run:visible').click();
    await page.waitForTimeout(300);
    const b4 = await boxes();
    ok('plan: starting and stopping Advanced moves no box', b4 === b0, { b0, b4 });
    await ctx.close();
  }

  {
    // ph-mdqo.8: sunk plates, the planned-motion strip and its window stepper, the relative drag.
    const MC = byName('machine-config');
    hubAt(REVIEW);
    Object.assign(hub.values, { [uidOf(MC, 'input_speed')]: 400, [uidOf(MC, 'window_min')]: 0, [uidOf(MC, 'window_max')]: 200 });
    const { ctx, page } = await open({ inputs: false });
    await toPatternPage(page);
    await toAdvanced(page);
    const strip = page.locator('main.pane .ap .ap-planbox');
    const winN = () => page.locator('main.pane .ap .ap-win output').textContent();
    ok('plan: no wave scope or told caption remains', !(await page.locator('main.pane .ap .ap-wave').count())
      && !/wave · told|stopped/.test(await page.locator('main.pane .ap').first().innerText()));
    const d0 = await strip.locator('path.curve').getAttribute('d');
    const xs = [...d0.matchAll(/[ML]([\d.]+) /g)].map((m) => +m[1]);
    ok('plan: 11 grid lines for the 10 s window, the path spans it', (await strip.locator('line.grid').count()) === 11
      && xs[0] === 0 && xs[xs.length - 1] === 1000, { n: await strip.locator('line.grid').count(), a: xs[0], z: xs[xs.length - 1] });
    ok('plan: sits under the stroke and above the rhythm section', await page.evaluate(() => {
      const y = (q) => document.querySelector('main.pane .ap ' + q).getBoundingClientRect().top;
      return y('.ap-stroke') < y('.ap-planbox') && y('.ap-planbox') < y('.ap-rhythm');
    }));
    const up = page.locator('main.pane .ap .ap-win button[aria-label="Longer window"]');
    const down = page.locator('main.pane .ap .ap-win button[aria-label="Shorter window"]');
    await up.click(); const w15 = await winN();
    await up.click(); const w20 = await winN();
    ok('plan: the stepper goes 10, 15, 20 and redraws the grid', w15 === '15' && w20 === '20' && (await strip.locator('line.grid').count()) === 21, [w15, w20]);
    await down.click(); await down.click(); await down.click();
    ok('plan: down steps 15, 10, 9', (await winN()) === '9');
    await up.click(); await up.click(); await up.click(); await up.click(); await up.click();   // 10, 15, 20, 25, 30
    for (let i = 0; i < 3; i++) await up.click();   // 40, 50, 60
    ok('plan: the stepper stops at 60 with up disabled', (await winN()) === '60' && await up.isDisabled() && !(await down.isDisabled()));
    for (let i = 0; i < 3; i++) await down.click();   // 50, 40, 30
    ok('plan: down steps 60, 50, 40, 30', (await winN()) === '30');
    await page.reload();
    await toPatternPage(page);
    await toAdvanced(page);
    ok('plan: the window persists across a reload', (await winN()) === '30', await winN());
    const labels = await strip.locator('.ap-gl').evaluateAll((es) => es.map((e) => e.getBoundingClientRect()));
    const band = await page.evaluate(() => {
      const b = document.querySelector('main.pane .ap .ap-planbox'), p = b.querySelector('path.curve').getBoundingClientRect();
      const tops = [...b.querySelectorAll('.ap-gl')].map((e) => e.getBoundingClientRect().top);
      return { pathBottom: p.bottom, labelTop: Math.min(...tops) };
    });
    ok('plan: the curve stays out of the label band', band.pathBottom <= band.labelTop, band);
    ok('plan: grid labels never collide', labels.length > 1 && labels.every((r, i) => !i || r.left >= labels[i - 1].right - 0.5), labels.length);
    const plates = await page.evaluate(() => {
      const bg = (q) => getComputedStyle(document.querySelector(q)).backgroundColor;
      const probe = document.createElement('i'); probe.style.color = 'var(--screen)'; document.body.append(probe);
      const screen = getComputedStyle(probe).color; probe.remove();
      return { screen, ed: bg('main.pane .ap .ap-stroke'), stair: bg('main.pane .ap .ap-planbox'), h: getComputedStyle(document.querySelector('main.pane .ap .ap-h'), '::after').backgroundColor };
    });
    ok('plates: editors and handles compute --screen', plates.ed === plates.screen && plates.stair === plates.screen && plates.h === plates.screen, plates);
    // Relative drag: 60 px of pointer moves the deep value about half of the old absolute mapping; Shift a tenth.
    const box = await page.locator('main.pane .ap .ap-stroke').boundingBox();
    const MAXD = settingOf('pattern-advanced', 'max_depth');
    const range = byName('pattern-advanced').layout.find((f) => f.name === 'max_depth');
    const DY = 150;   // far enough that a tenth of the gain is still several whole values
    const absDelta = DY * (240 / box.height) / 180 * (range.max - range.min);
    const dd = async (mod) => {
      if (mod) await page.keyboard.down(mod);
      const w = (await dragBy(page, handle(page, 'deep'), 0, DY)).filter((i) => MAXD.key in i.val);
      if (mod) await page.keyboard.up(mod);
      return w.length ? 85 - w[0].val[MAXD.key] : NaN;
    };
    const full = await dd();
    hubAt(REVIEW); hub.push(ADV.id); await page.waitForTimeout(300);
    const fine = await dd('Shift');
    hubAt(REVIEW); hub.push(ADV.id); await page.waitForTimeout(300);
    const snapped = 85 - (await dd('Control'));
    ok('drag: 150 px moves the value half as far as the absolute mapping, Shift a tenth of that', Math.abs(full / absDelta - 0.5) < 0.05 && Math.abs(fine / absDelta - 0.05) < 0.02,
      { full, fine, absDelta });
    ok('drag: Ctrl rounds the written value to the decade below the range', snapped % 10 === 0 && snapped !== 85, snapped);
    await ctx.close();
  }

  {
    // Without limit.input.speed there is nothing to scale: no strip at all.
    const keep = [CAT, ETAG];
    ({ bytes: CAT, etag: ETAG } = advgenCatalog({ drop: ['limit.input.speed'] }));
    hubAt(REVIEW);
    const { ctx, page } = await open({ inputs: false });
    await toPatternPage(page);
    await toAdvanced(page);
    ok('plan: no limit.input.speed role hides the whole strip', (await page.locator('main.pane .ap .ap-stroke').count()) === 1
      && (await page.locator('main.pane .ap .ap-plan').count()) === 0);
    await ctx.close();
    [CAT, ETAG] = keep;
  }

  {
    // ph-0fby: the modifier switch and trash clear 40 px under a coarse pointer.
    hubAt(REVIEW);
    const { ctx, page } = await open({ inputs: false, coarse: true, size: { width: 390, height: 844 } });
    await toPatternPage(page);
    await toAdvanced(page);
    const ws = await page.$$eval('main.pane .ap .ap-mon, main.pane .ap .ap-mtrash', (es) => es.filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => Math.round(e.getBoundingClientRect().width)));
    ok('targets: the modifier switch and trash are at least 40 px wide on a touch pointer', ws.length > 0 && ws.every((w) => w >= 40), ws);
    await ctx.close();
  }

  {
    // ph-ojt: a dwell plus never sits on a label, a handle or the curve (catalog defaults, then the review state).
    const plusClear = (page) => page.evaluate(() => {
      const ed = document.querySelector('main.pane .ap .ap-stroke');
      const R = (e) => e.getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const dots = [...ed.querySelectorAll(':scope > .ap-plus:not([hidden]) > i')].map((i) => [i.parentElement.getAttribute('aria-label'), R(i)]);
      const tags = [...ed.querySelectorAll('.ap-h:not([hidden]) .ap-tag')].filter((t) => t.textContent).map((t) => [t.textContent, R(t)]);
      const marks = [...ed.querySelectorAll('.ap-h:not([hidden])')].map((h) => {
        const r = R(h), x = r.left + r.width / 2, y = r.top + r.height / 2;
        return [h.dataset.key, { left: x - 10, right: x + 10, top: y - 10, bottom: y + 10 }];
      });
      const pts = [];
      for (const p of ed.querySelectorAll('path.curve[d]:not([d=""])')) {
        const m = p.getScreenCTM(), L = p.getTotalLength();
        for (let s = 0; s <= L; s += 1) { const q = p.getPointAtLength(s); pts.push([m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f]); }
      }
      return { n: dots.length, hits: dots.flatMap(([l, d]) => [...tags.filter(([, t]) => hit(d, t)).map(([t]) => l + ' x ' + t),
        ...marks.filter(([, m]) => hit(d, m)).map(([k]) => l + ' x handle ' + k),
        ...(pts.some(([x, y]) => x >= d.left && x <= d.right && y >= d.top && y <= d.bottom) ? [l + ' x curve'] : [])]) };
    });
    hubAt();
    let { ctx, page } = await open({ inputs: false });
    await toPatternPage(page);
    await toAdvanced(page);
    const atDefaults = await plusClear(page);
    if (SHOT) await page.locator('main.pane .ap .ap-stroke').screenshot({ path: shot('r2-plus-defaults') });
    ok('plus: at the catalog defaults both pluses sit clear of the labels, the handles and the curve', atDefaults.n === 2 && atDefaults.hits.length === 0, atDefaults);
    await ctx.close();
    hubAt(REVIEW);
    ({ ctx, page } = await open({ inputs: false, theme: THEMES.find((t) => t.id === 'paper') }));
    await toPatternPage(page);
    await toAdvanced(page);
    const atReview = await plusClear(page);
    ok('plus: in the review state the trough plus sits clear of the in-accel diamond and its label', atReview.n === 1 && atReview.hits.length === 0, atReview);

    // ph-ckg, ph-1fo on Paper: focus, selection and pressed wear --highlight; the focus ring clears 3:1; handles and tabs hover.
    const HL = await tok(page, '--highlight'), LINE4 = await tok(page, '--line-4');
    const card = await page.locator('main.pane .ap').first().evaluate((e) => getComputedStyle(e.closest('.surface-card') || document.body).backgroundColor);
    const css = (sel, prop, pseudo = null) => page.locator(sel).first().evaluate((e, [p, ps]) => getComputedStyle(e, ps)[p], [prop, pseudo]);
    const sel = [await css('main.pane .ap-tabs button[aria-selected=true]', 'borderTopColor'),
      await css('main.pane .ap .ap-mtab:has([aria-selected=true])', 'borderTopColor')];
    ok('highlight: the open tab and the open modifier tab wear --highlight', sel.every((c) => c === HL), [sel, HL]);
    await page.locator('main.pane .ap .ap-inputs').click();
    await page.waitForTimeout(150);
    ok('highlight: a pressed tool wears --highlight', (await css('main.pane .ap .ap-inputs[aria-pressed=true]', 'borderTopColor')) === HL);
    await page.locator('main.pane .ap .ap-inputs').click();
    await handle(page, 'deep').focus();
    await page.keyboard.press('Shift');
    const ring = { w: await css('main.pane .ap .ap-h[data-key="deep"]', 'outlineWidth', '::after'),
      s: await css('main.pane .ap .ap-h[data-key="deep"]', 'outlineStyle', '::after'),
      c: await css('main.pane .ap .ap-h[data-key="deep"]', 'outlineColor', '::after') };
    ok('focus: a handle wears the house ring, 2 px solid --highlight, at least 3:1 on the Paper card', ring.w === '2px' && ring.s === 'solid'
      && ring.c === HL && contrast(ring.c, card) >= 3, { ...ring, card, ratio: +contrast(ring.c, card).toFixed(2) });
    if (SHOT) await page.locator('main.pane .ap .ap-stroke').screenshot({ path: shot('r3-focus-paper') });
    await handle(page, 'vin').hover();
    await page.waitForTimeout(100);
    ok('hover: a handle shows a 1 px --highlight ring', (await css('main.pane .ap .ap-h[data-key="vin"]', 'outlineWidth', '::after')) === '1px'
      && (await css('main.pane .ap .ap-h[data-key="vin"]', 'outlineColor', '::after')) === HL);
    const mt = page.locator('main.pane .ap .ap-mtab').nth(2);
    const restB = await mt.evaluate((e) => getComputedStyle(e).borderTopColor);
    await mt.hover();
    await page.waitForTimeout(100);
    const hovB = await mt.evaluate((e) => getComputedStyle(e).borderTopColor);
    ok('hover: a modifier tab takes the house hover edge (--line-4)', restB !== hovB && hovB === LINE4, [restB, hovB, LINE4]);

    // ph-ytq: one case per role, as the shell dresses it.
    const tt = async (s) => css(s, 'textTransform');
    const cases = { tab: await tt('main.pane .ap-tabs button'), mtab: await tt('main.pane .ap .ap-mtab [role=tab]'), run: await tt('main.pane .ap .ap-run'),
      head: await tt('main.pane .ap h4'), label: await tt('main.pane .ap .ap-ctl label > span') };
    ok('case: controls sentence case, the section head uppercase, field labels lowercase', cases.tab === 'none' && cases.mtab === 'none'
      && cases.run === 'none' && cases.head === 'uppercase' && cases.label === 'lowercase', cases);

    // ph-avq: the modifier switch is the host's og-switch track, compact.
    const sw = await page.evaluate(() => {
      const t = (s) => { const e = document.querySelector(s), cs = getComputedStyle(e); return { w: e.offsetWidth, r: cs.borderTopLeftRadius, c: cs.borderTopColor }; };
      return { mod: t('main.pane .ap .ap-mtab .og-switch.ap-mon .track'), bg: t('main.pane .ap .ap-sw .track') };
    });
    ok('switch: the modifier switch is the og-switch track, compact, on in --reality', sw.mod.r === sw.bg.r && sw.mod.w < sw.bg.w
      && sw.mod.c === await tok(page, '--reality'), sw);
    await ctx.close();
  }

  {
    // ph-baq, ph-1tl: the modifier graph at phone widths; ph-20a: no tab truncates at desktop widths.
    hubAt(REVIEW);
    for (const [w, h] of [[390, 844], [844, 390], [1280, 800], [1920, 1080]]) {
      const { ctx, page, up } = await open({ inputs: false, size: { width: w, height: h } });
      await toPatternPage(page);
      await toAdvanced(page);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const ed = document.querySelector('main.pane .ap .ap-stair'), b = ed.getBoundingClientRect();
        const R = (e) => e.getBoundingClientRect();
        const hit = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
        const texts = [...[...ed.querySelectorAll('.ap-h:not([hidden]) .ap-tag')].filter((t) => t.textContent),
          ...ed.querySelectorAll(':scope > .ap-seg:not([hidden])')].map((t) => [t.textContent, R(t)]);
        const clash = texts.flatMap(([s, a], i) => texts.slice(i + 1).filter(([, c]) => hit(a, c)).map(([u]) => s + ' x ' + u));
        const amp = R(ed.querySelector('.ap-h[data-key="amp"]'));
        const spans = [...document.querySelectorAll('main.pane .ap .ap-mtab [role=tab] > span')];
        const lh = (e) => parseFloat(getComputedStyle(e).lineHeight);
        const tabs = [...document.querySelectorAll('main.pane .ap .ap-mtab')].map(R);
        const sel = document.querySelector('main.pane .ap .ap-mtab:has([aria-selected=true])');
        return { clash, ampIn: amp.left >= b.left && amp.right <= b.right && amp.top >= b.top && amp.bottom <= b.bottom,
          cut: spans.filter((s) => s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent),
          lines: Math.max(...spans.map((s) => Math.round(s.clientHeight / lh(s)))),
          hint: getComputedStyle(document.querySelector('main.pane .ap .ap-hint')).display,
          head: (() => { const rg = document.createRange(); rg.selectNodeContents(document.querySelector('main.pane .ap h4'));
            return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; })(),
          paired: tabs.length > 1 && Math.round(tabs[0].top) === Math.round(tabs[1].top),
          gap: Math.round(b.top - R(sel).bottom) };
      });
      const tag = w + 'x' + h;
      if (SHOT) await page.locator('main.pane .ap .ap-rhythm').screenshot({ path: shot('r4-rhythm-' + tag) });
      ok('stair ' + tag + ': no two texts overlap, the amp handle inside the plot', up && r.clash.length === 0 && r.ampIn, r);
      ok('tabs ' + tag + ': no modifier tab name truncates' + (w >= 1280 ? ', each on one line' : ''), r.cut.length === 0
        && (w < 1280 || r.lines === 1), r);
      if (w === 390) {
        ok('narrow 390: the heading on one line, the hint dropped, the tabs paired, the graph close under them', r.head === 1
          && r.hint === 'none' && r.paired && r.gap < 260, r);
      }
      await ctx.close();
    }
    hubAt();
  }

  {
    // The house floor applies on a touch pointer (style.css, pointer: coarse).
    const { ctx, page } = await open({ coarse: true });
    const shown = await toPatternPage(page);
    const small = await page.$$eval('main.pane .ap .ap-h:not([hidden]), main.pane .ap button, main.pane .ap select, main.pane .ap input:not([type=checkbox])', (els) => els
      .filter((e) => e.offsetParent !== null).map((e) => ({ t: e.className || e.tagName, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }))
      .filter((r) => r.h < 40 || (r.t.includes('ap-h') && r.w < 40)));
    ok('targets: every handle and control at least 40 px on a touch pointer (law 12)', shown && small.length === 0, small.slice(0, 5));
    await ctx.close();
  }

  {
    const { ctx, page } = await open({ roles: 0 });
    await toPatternPage(page);
    const hs = await page.$$eval('main.pane .ap .ap-stroke .ap-h:not([hidden])', (els) => els.map((e) => e.getAttribute('aria-disabled')));
    const note = await page.locator('main.pane .ap .ap-stroke + .ap-note').textContent();
    ok('gate: a watch-tier session disables every handle and names why', hs.length > 0 && hs.every((x) => x === 'true')
      && /not authorized/.test(note), { hs, note });
    await ctx.close();
  }

  {
    const { ctx, page } = await open({ disabled: true });
    const found = await toPatternPage(page, false);
    ok('fallback: disabled, nothing of the plugin renders', found && !(await page.$('main.pane .ap')));
    ok('fallback: the base fields render as generic settings again',
      !!(await page.$('main.pane label.field-label[data-uid="' + uidOf(ADV, 'master') + '"]')));
    await ctx.close();
  }
}

await browser.close();
srv.close();
console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS -- Advanced Penetration');
process.exit(fails ? 1 : 0);
