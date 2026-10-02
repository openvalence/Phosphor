/**
 * advanced-penetration.test.mjs -- the factory pattern card in the real shell
 * bundle (shell-build.mjs, stub Tauri runtime) against a fake hub serving the
 * recorded catalog (test/fixtures/advgen-roles-catalog.mjs). Asserts:
 *   load       the card substitutes both pattern built-ins; claimed fields
 *              leave the generic cards; advgen.mode stays generic (RFC-093)
 *   tabs       Advanced and Classic are views, each with its own Start; a
 *              switch writes nothing; without advgen.running the Advanced
 *              Start names what is missing
 *   handles    a held deep drag writes once on release, pending on the
 *              handle, then the echo; snapped and bounded; the numeric twin
 *              shows the same field; a refusal reads on the handle; speed
 *              and accel handles write the right direction; shift+arrow
 *              nudges ten steps in one write
 *   rhythm     the amp fader and a step handle write their fields in whole
 *              strokes; the staircase follows the echo
 *   presets    a dropdown of named slots; choose loads, Save prompts a name
 *              into the first empty slot, Delete confirms, Reset restores
 *              defaults
 *   confirm    background_run enable asks the host; a cancel sends nothing
 *   targets    40 px on a touch pointer (law 12); nothing wears --bad
 *   gate       a watch-tier session disables every handle with the reason
 *   fallback   disabled, the plugin renders nothing
 *
 * Live mode (--live): drags the deep handle against valencesim and checks the
 * echo and the numeric twin; skips (exit 0) unless the sim carries advgen.*.
 * --shot <png> saves the card.
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

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const SHOT = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
const SIM_PORT = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 8882;
const SIM_HTTP = args.includes('--http') ? parseInt(args[args.indexOf('--http') + 1], 10) : 8880;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const { bytes: CAT, etag: ETAG } = advgenCatalog();
const ENTRIES = decodeCatalog(CAT);
const byName = (n) => ENTRIES.find((e) => e.name === n);
const ADV = byName('pattern-advanced');
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

async function open({ disabled = false, roles = 2, coarse = false } = {}) {
  hub.roles = roles;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: SHOT ? 2400 : 1000 }, hasTouch: coarse });
  await ctx.addInitScript(TAURI_STUB);
  if (LIVE) await ctx.addInitScript(HTTP_STUB);
  await ctx.addInitScript(([etag, bytes, live, disabled, port]) => {
    try {
      if (!live) localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes }));
      if (live) localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      else localStorage.setItem('shell_host', '127.0.0.1');
      localStorage.setItem('phosphor.plugins.disabled', JSON.stringify(disabled ? ['advanced-penetration'] : []));
    } catch (e) { /* none */ }
  }, [ETAG, toHex(CAT), LIVE, disabled, SIM_PORT]);
  if (!LIVE) await ctx.routeWebSocket(/:82\//, fakeHub);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) ok('no page error', false, String(e)); });
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  const up = await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 }).then(() => true).catch(() => false);
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
  const adv = page.locator('main.pane .ap .ap-run:visible').first();
  const advNote = await page.locator('main.pane .ap .ap-run:visible').first().locator('xpath=../../p').textContent();
  ok('live: Advanced Start binds advgen.running or names what is missing',
    !(await adv.isDisabled()) || /needs advgen\.running/.test(advNote), advNote);
  if (SHOT) {
    await page.locator('main.pane .ap').first().screenshot({ path: SHOT });
    console.log('  screenshot: ' + SHOT);
  }
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
    ok('load: advgen.mode stays generic (RFC-093)', generic.includes(uidOf(ADV, 'ap_mode')));

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
    ok('map: handles are labeled by value', /^deep \d/.test(await tagOf(handle(page, 'deep'))) && /^in v\d/.test(await tagOf(handle(page, 'vin')))
      && /^a\d/.test(await tagOf(handle(page, 'ain'))));
    const mtabs = await page.$$eval('main.pane .ap .ap-mtabs button', (bs) => bs.map((b) => b.textContent));
    ok('map: one rhythm tab per driven control, in base order', mtabs.join() === 'Max depth,Min depth,In speed,Out speed,In accel,Out accel', mtabs);
    ok('map: Advanced has its own Start, background_run beside it', /Start pattern/.test(await page.locator('main.pane .ap .ap-run:visible').textContent())
      && await page.locator('main.pane .ap .ap-sw:visible', { hasText: 'Run in background' }).isVisible());
    const advNote = await page.locator('main.pane .ap .ap-run:visible').locator('xpath=../../p').textContent();
    ok('map: without advgen.running the Advanced Start says what is missing', await page.locator('main.pane .ap .ap-run:visible').isDisabled()
      && /needs advgen\.running/.test(advNote), advNote);

    // ---- a held deep drag: one write, pending on the handle, then the echo
    const deep = handle(page, 'deep');
    const y0 = (await deep.boundingBox()).y;
    hub.mode = 'hold';
    const sent = await dragBy(page, deep, 0, -60);
    const wrote = sent.filter((i) => i.ch === MAXD.ch && MAXD.key in i.val);
    ok('drag: one write per release, never one per move', sent.length === 1 && wrote.length === 1, sent);
    ok('drag: snapped to the step, inside the bounds', wrote.length === 1 && Number.isInteger(wrote[0].val[MAXD.key])
      && wrote[0].val[MAXD.key] > 10 && wrote[0].val[MAXD.key] <= 100, wrote[0] && wrote[0].val);
    ok('drag: pending on the handle, in words', (await deep.getAttribute('data-status')) === 'pending' && /waiting/.test(await tagOf(deep)), await tagOf(deep));
    await release();
    await page.waitForTimeout(250);
    const v = wrote[0] && wrote[0].val[MAXD.key];
    ok('drag: the echo confirms on the handle', (await deep.getAttribute('data-status')) === 'confirmed' && (await tagOf(deep)) === 'deep ' + v, await tagOf(deep));
    ok('unify: the numeric twin shows the same field', Number(await numIn(page, 'Max depth').inputValue()) === v);
    ok('drag: the handle moved up with the value', (await deep.boundingBox()).y < y0 - 20);

    // ---- a refused drag
    hub.mode = 'nack';
    await dragBy(page, deep, 0, 30);
    await page.waitForTimeout(250);
    hub.mode = 'echo';
    ok('refusal: amber ladder and the word on the handle', (await deep.getAttribute('data-status')) === 'fault' && /refused/.test(await tagOf(deep))
      && (await tagOf(deep)).startsWith('deep ' + v), await tagOf(deep));

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
    ok('keys: shift+arrow nudges ten steps, one write', kv.length === 1 && kv[0].val[MIND.key] === m0 + 10, kv);

    // ---- rhythm: In speed's staircase
    await page.click('main.pane .ap .ap-mtabs button:has-text("In speed")');
    const AMT = settingOf('pattern-adv-mod-speedin', 'amount');
    const RISE = settingOf('pattern-adv-mod-speedin', 'in_step');
    const flat = await page.locator('main.pane .ap .ap-stair path.curve').getAttribute('d');
    const amp = handle(page, 'amp');
    const aw = (await dragBy(page, amp, 0, 50)).filter((i) => i.ch === AMT.ch && AMT.key in i.val);
    ok('rhythm: the amp fader writes amount', aw.length === 1 && aw[0].val[AMT.key] > 0, aw[0] && aw[0].val);
    await page.waitForTimeout(200);
    ok('rhythm: the staircase follows the echoed amount', (await page.locator('main.pane .ap .ap-stair path.curve').getAttribute('d')) !== flat
      && /^amp \d/.test(await tagOf(amp)));
    const rsent = await dragBy(page, handle(page, 'rise'), 120, 0);
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
    const n3 = hub.intents.length;
    await page.click('main.pane .ap .og-btn:has-text("Delete")');
    const dlg = page.locator('[role=alertdialog]');
    ok('presets: delete asks the host confirm first', await dlg.isVisible().catch(() => false) && hub.intents.length === n3);
    await dlg.locator('button.danger').click();
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
    await page.click('main.pane .ap-tabs button:has-text("Classic")');
    await page.locator('main.pane .ap .ap-run:visible').click();
    await page.waitForTimeout(300);
    ok('run: Classic starts on pattern.running', /Stop pattern/.test(await page.locator('main.pane .ap .ap-run:visible').textContent()));
    await page.locator('main.pane .ap .ap-run:visible').click();
    await page.waitForTimeout(300);

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
