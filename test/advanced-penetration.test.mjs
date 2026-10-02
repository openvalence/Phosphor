/**
 * advanced-penetration.test.mjs -- the factory plugin in the real shell
 * bundle (shell-build.mjs, stub Tauri runtime) against a fake hub serving the
 * role-carrying fixture (test/fixtures/advgen-roles-catalog.mjs). Asserts:
 *   load       the factory plugin loads by default and substitutes the
 *              pattern: its card renders and the claimed fields leave the
 *              generic settings cards
 *   map        run/stop beside background_run, the stroke picture, the seven
 *              base controls, each modulator under the control its
 *              mod_target names
 *   ladder     a held write reads pending in words on the same control, then
 *              confirms with the echoed value; a modulator write round-trips
 *              and its cycle preview follows the reported values
 *   confirm    background_run enable and a preset delete go through the
 *              host's confirm; a cancel sends nothing
 *   presets    the store's slots read over the blob verb; save carries the
 *              slot and name and the list re-reads
 *   gate       a watch-tier session grays every control with the reason
 *   targets    law 12 (40 px) on every control under a touch pointer;
 *              nothing wears --bad
 *   fallback   disabled, the plugin renders nothing and the fields are
 *              generic again
 *
 * Live mode (--live): against a running valencesim, skips (exit 0) unless the
 * sim's catalog carries advgen.* roles.
 *
 * Run: node test/advanced-penetration.test.mjs
 *      node test/advanced-penetration.test.mjs --live [--port 8882] [--http 8880]
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: coarse });
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
const setRange = (loc, v) => loc.evaluate((el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const ctlByLabel = (page, text) => page.locator('main.pane .ap .ap-ctl', { has: page.locator('label', { hasText: new RegExp('^' + text) }) }).first();

if (LIVE) {
  console.log('Advanced Penetration, live (valencesim on ' + SIM_PORT + ')');
  const { ctx, page, up } = await open();
  ok('live: the shell adopted the sim catalog', up);
  ok('live: the plugin card renders on the sim', await toPatternPage(page));
  const seq = await page.$$eval('main.pane .ap section', (ss) => ss.map((s) => s.querySelector('h4').textContent + ': '
    + [...s.querySelectorAll(':scope > .ap-ctl label > span:first-child, :scope > details > summary > span:first-child')].map((x) => x.textContent).join(' | ')));
  ok('live: every modulator sits under the control it rides, none loose',
    seq.join('\n').split('modifier').length - 1 === 6 && seq.every((x) => !/^Other modulators/.test(x)), seq);
  const master = ctlByLabel(page, 'Master speed');
  const before = Number(await master.locator('input[type=range]').inputValue());
  const to = before === 23 ? 24 : 23;
  await setRange(master.locator('input[type=range]'), to);
  ok('live: a master write confirms with the echoed value', await page.waitForFunction((t) => {
    const c = [...document.querySelectorAll('main.pane .ap .ap-ctl')].find((e) => /^Master speed/.test((e.querySelector('label') || {}).textContent));
    return c && c.dataset.status === 'confirmed' && c.querySelector('output').textContent.startsWith(String(t));
  }, to, { timeout: 5000 }).then(() => true).catch(() => false));
  await setRange(master.locator('input[type=range]'), before);
  const det = page.locator('main.pane .ap details.ap-mod').first();
  await det.locator('summary').click();
  const rise = det.locator('.ap-ctl', { has: page.locator('label', { hasText: /^Rise/ }) });
  const r0 = Number(await rise.locator('input[type=range]').inputValue());
  const r1 = r0 === 3 ? 4 : 3;
  await setRange(rise.locator('input[type=range]'), r1);
  await page.waitForTimeout(800);
  ok('live: a modulator write confirms on its own channel', (await rise.getAttribute('data-status')) === 'confirmed'
    && (await rise.locator('output').textContent()).startsWith(String(r1)), await rise.locator('.ap-note').textContent());
  await setRange(rise.locator('input[type=range]'), r0);
  ok('live: the preset store reads every slot (none left pending)', await page.waitForFunction(() =>
    document.querySelectorAll('.ap-slots button').length > 0 && !document.querySelector('.ap-slots button[data-state=pending]'),
  null, { timeout: 15000 }).then(() => true).catch(() => false));
  // Run/stop: the pattern starts on the sim (no hardware); a commissioning
  // gate refusal (RFC-079 first run) must read as a fault in words instead.
  const run = page.locator('main.pane .ap .ap-head .ap-ctl').first();
  await run.locator('button').click();
  await page.waitForTimeout(1200);
  const runNote = await run.locator('.ap-note').textContent();
  const started = (await run.locator('button').textContent()) === 'Stop';
  ok('live: Start confirms running, or a refusal reads as a fault in words', started || /refused/.test(runNote), runNote);
  if (started) {
    await run.locator('button').click();
    ok('live: Stop confirms stopped', await page.waitForFunction(() =>
      document.querySelector('main.pane .ap .ap-head button').textContent === 'Start', null, { timeout: 5000 }).then(() => true).catch(() => false));
  }
  // Save into the first empty slot, load it, then delete it: the sim's store ends as it began.
  const rows = page.locator('main.pane .ap .ap-slots button');
  const empty = await rows.evaluateAll((bs) => bs.findIndex((b) => b.dataset.state === 'empty'));
  ok('live: the store has an empty slot to save into', empty >= 0);
  if (empty >= 0) {
    await rows.nth(empty).click();
    await page.locator('main.pane .ap input[aria-label="Preset name"]').fill('AP live');
    await page.locator('main.pane .ap .og-btn', { hasText: 'Save' }).click();
    ok('live: save through action.store lands in the slot and the list re-reads', await page.waitForFunction((i) =>
      /AP live/.test(document.querySelectorAll('.ap-slots button')[i].textContent), empty, { timeout: 10000 }).then(() => true).catch(() => false));
    await rows.nth(empty).click();
    await page.locator('main.pane .ap .og-btn', { hasText: 'Load' }).click();
    const presets = page.locator('main.pane .ap section', { has: page.locator('h4', { hasText: 'Presets' }) });
    ok('live: load through action.store is confirmed by the hub', await page.waitForFunction(() => {
      const s = [...document.querySelectorAll('main.pane .ap section')].find((x) => x.querySelector('h4').textContent === 'Presets');
      return s && s.dataset.status === 'confirmed';
    }, null, { timeout: 5000 }).then(() => true).catch(() => false), await presets.locator('.ap-note').textContent());
    await page.locator('main.pane .ap .og-btn', { hasText: 'Delete' }).click();
    await page.locator('[role=alertdialog] button.danger').click();
    ok('live: delete (after the host confirm) empties the slot again', await page.waitForFunction((i) =>
      document.querySelectorAll('.ap-slots button')[i].dataset.state === 'empty', empty, { timeout: 10000 }).then(() => true).catch(() => false),
      await presets.locator('.ap-note').textContent());
  }
  await ctx.close();
} else {
console.log('Advanced Penetration (shell bundle, role fixture ' + ETAG + ')');
{
  const { ctx, page, up } = await open();
  ok('boot: the shell adopted the fixture catalog', up);
  ok('load: the plugin card is on the pattern page', await toPatternPage(page) && !!(await page.$('main.pane .ap')));
  const generic = await page.$$eval('main.pane label.field-label[data-uid]', (els) => els.map((e) => e.dataset.uid));
  const claimedUids = [ADV, ...ENTRIES.filter((e) => e.modTarget)].flatMap((e) => e.layout.filter((f) => f.role && f.role !== 'meta.enabled_mask').map((f) => uidOf(e, f.name)));
  ok('load: claimed fields leave the generic cards', claimedUids.every((u) => !generic.includes(u)), claimedUids.filter((u) => generic.includes(u)));

  // ---- map
  const head = await page.$$eval('main.pane .ap .ap-head > *', (els) => els.map((e) => e.textContent.trim()));
  ok('map: run/stop first, background_run beside it, then the mode', /^(Start|Stop)/.test(head[0]) && /Run in background/.test(head[1])
    && /Advanced program/.test(head[2]), head);
  ok('map: the stroke picture draws both halves', await page.$$eval('main.pane .ap .ap-pic path', (ps) => ps.filter((p) => p.style.display !== 'none' && p.getAttribute('d')).length) === 2);
  const sections = await page.$$eval('main.pane .ap section', (ss) => ss.map((s) => ({
    title: s.querySelector('h4').textContent,
    seq: [...s.querySelectorAll(':scope > .ap-ctl label > span:first-child, :scope > details > summary > span:first-child')].map((x) => x.textContent),
  })));
  const seqOf = (t) => (sections.find((s) => s.title === t) || { seq: [] }).seq.join(' | ');
  ok('map: master alone', seqOf('Master') === 'Master speed', seqOf('Master'));
  ok('map: depth window, each depth with its own modulator under it',
    seqOf('Depth window') === 'Max depth | Depth 1 modifier | Min depth | Depth 2 modifier', seqOf('Depth window'));
  ok('map: in stroke half', seqOf('In stroke') === 'In speed | Speed in modifier | In accel | Accel in modifier', seqOf('In stroke'));
  ok('map: out stroke half', seqOf('Out stroke') === 'Out speed | Speed out modifier | Out accel | Accel out modifier', seqOf('Out stroke'));
  ok('map: presets section present', sections.some((s) => s.title === 'Presets'));

  // ---- ladder: a held master write
  const master = ctlByLabel(page, 'Master speed');
  hub.mode = 'hold';
  await setRange(master.locator('input[type=range]'), 37);
  await page.waitForTimeout(150);
  ok('ladder: held write reads pending in words', (await master.getAttribute('data-status')) === 'pending'
    && /waiting for the machine/.test(await master.locator('.ap-note').textContent()));
  await release();
  await page.waitForTimeout(300);
  ok('ladder: the echo confirms on the same control', (await master.getAttribute('data-status')) === 'confirmed'
    && (await master.locator('output').textContent()).startsWith('37'), await master.locator('output').textContent());
  ok('ladder: the hub holds the value', hub.values[uidOf(ADV, 'master')] === 37);
  hub.mode = 'nack';
  await setRange(master.locator('input[type=range]'), 80);
  await page.waitForTimeout(400);
  hub.mode = 'echo';
  ok('ladder: a refusal reads as a fault in words and shows the reported value',
    (await master.getAttribute('data-status')) === 'fault' && /refused/.test(await master.locator('.ap-note').textContent())
    && (await master.locator('output').textContent()).startsWith('37'), await master.locator('.ap-note').textContent());
  if (SHOT) {
    console.log('    cell', JSON.stringify(await page.evaluate(() => { const a = document.querySelector('main.pane .ap'); const c = a.closest('.dash-cell'); return { ap: a.scrollHeight, cell: c && c.getBoundingClientRect().height, ov: c && getComputedStyle(c).overflow }; })));
    await page.screenshot({ path: SHOT, fullPage: true });
  }

  // ---- modulator write and its preview
  const det = page.locator('main.pane .ap details.ap-mod', { hasText: 'Depth 1 modifier' });
  const flat = await det.locator('polyline').getAttribute('points');
  await det.locator('summary').click();
  const amt = det.locator('.ap-ctl', { has: page.locator('label', { hasText: /^Amount/ }) });
  await setRange(amt.locator('input[type=range]'), 60);
  await setRange(det.locator('.ap-ctl', { has: page.locator('label', { hasText: /^Rise/ }) }).locator('input[type=range]'), 4);
  await page.waitForTimeout(300);
  const depth1 = byName('pattern-adv-mod-depth1');
  ok('modulator: amount round-trips to its own channel', hub.values[uidOf(depth1, 'amount')] === 60);
  ok('modulator: the summary and preview follow the reported values',
    /amount 60/.test(await det.locator('summary').textContent()) && (await det.locator('polyline').getAttribute('points')) !== flat);

  // ---- confirm: background_run enable, cancel sends nothing
  const n0 = hub.intents.length;
  await page.locator('main.pane .ap .ap-head label.og-switch', { hasText: 'Run in background' }).click();
  const dlg = page.locator('[role=alertdialog]');
  ok('confirm: background_run enable asks the host confirm', await dlg.locator('button', { hasText: 'Cancel' }).isVisible().catch(() => false));
  await dlg.locator('button', { hasText: 'Cancel' }).click();
  await page.waitForTimeout(200);
  ok('confirm: a cancel sends nothing and the switch shows the machine', hub.intents.length === n0
    && !(await page.locator('main.pane .ap .ap-head input[type=checkbox]').first().isChecked()));

  // ---- presets
  const rows = page.locator('main.pane .ap .ap-slots button');
  await page.waitForFunction(() => document.querySelectorAll('.ap-slots button[data-state=empty]').length > 0, null, { timeout: 5000 }).catch(() => {});
  ok('presets: slots read over the blob verb (item named, empties distinct)',
    (await rows.count()) === hub.store.capacity && /Tease/.test(await rows.nth(0).textContent())
    && (await rows.nth(1).getAttribute('data-state')) === 'empty');
  await rows.nth(3).click();
  await page.locator('main.pane .ap input[aria-label="Preset name"]').fill('Mine');
  await page.locator('main.pane .ap .og-btn', { hasText: 'Save' }).click();
  await page.waitForTimeout(500);
  const last = hub.intents[hub.intents.length - 1];
  ok('presets: save carries op, slot and name', last && last.val[1] === 1 && last.val[2] === 3 && last.val[3] === 'Mine', last);
  ok('presets: the list re-reads after the echo', /Mine/.test(await rows.nth(3).textContent()));
  await rows.nth(0).click();
  const n1 = hub.intents.length;
  await page.locator('main.pane .ap .og-btn', { hasText: 'Delete' }).click();
  ok('confirm: a preset delete asks the host confirm first', await dlg.isVisible().catch(() => false) && hub.intents.length === n1);
  await dlg.locator('button.danger').click();
  await page.waitForTimeout(500);
  ok('presets: delete sent after the confirm', hub.intents.length === n1 + 1 && hub.intents[n1].val[1] === 3
    && (await rows.nth(0).getAttribute('data-state')) === 'empty');

  // ---- targets and colors
  const red = await page.evaluate(() => {
    const bad = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim();
    const probe = document.createElement('i'); probe.style.color = bad; document.body.append(probe);
    const rgb = getComputedStyle(probe).color; probe.remove();
    return [...document.querySelectorAll('main.pane .ap *')].filter((e) => {
      const cs = getComputedStyle(e);
      return [cs.color, cs.borderTopColor, cs.backgroundColor, cs.fill, cs.stroke].includes(rgb);
    }).length;
  });
  ok('colors: nothing in the widget wears --bad', red === 0, red);
  await ctx.close();
}

{
  // The house floor applies on a touch pointer (style.css, pointer: coarse).
  const { ctx, page } = await open({ coarse: true });
  const shown = await toPatternPage(page);
  await page.$$eval('main.pane .ap details', (ds) => ds.forEach((d) => { d.open = true; }));
  const small = await page.$$eval('main.pane .ap button, main.pane .ap .ap-sw, main.pane .ap input:not([type=checkbox]), main.pane .ap summary', (els) => els
    .filter((e) => e.offsetParent !== null).map((e) => ({ t: e.tagName + (e.type ? ':' + e.type : ''), h: e.getBoundingClientRect().height }))
    .filter((r) => r.h < 40));
  ok('targets: every visible control is at least 40 px tall on a touch pointer (law 12)', shown && small.length === 0, small.slice(0, 5));
  await ctx.close();
}

{
  const { ctx, page } = await open({ roles: 0 });
  await toPatternPage(page);
  const notes = await page.$$eval('main.pane .ap .ap-ctl', (els) => els.filter((e) => e.offsetParent !== null).map((e) => ({
    dis: !!e.querySelector('input:disabled, button:disabled'), note: e.querySelector('.ap-note').textContent })));
  ok('gate: a watch-tier session grays every control, with the reason in words',
    notes.length > 0 && notes.every((n) => n.dis && /not authorized/.test(n.note)), notes.slice(0, 3));
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
