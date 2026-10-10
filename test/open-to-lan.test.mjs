/**
 * open-to-lan.test.mjs -- Open to LAN end to end on the real desktop shell (ph-li30): the built exe with its
 * own WebView2 profile, driven over CDP, and valence-js in node as the phone on the PC's LAN address.
 *
 * - The requested port is held by a plain TCP server: Open to LAN falls back and the status names it.
 * - Discovery answers only while Open to LAN is up: not before the Virtual runs, not after it is turned off.
 *   While up, the reply is the Virtual's: name, the bound port, the remote's own WELCOME hub_instance_id.
 * - The remote lands at watch; its knock is not granted before the Pairing window press, and is after it.
 * - The remote subscribes and jogs; the local session's Pairing pane lists the remote's session as the owner.
 * - Latency: the remote's CLOCK round trips against the PC's own session's, over 20 s.
 * - Off: the remote gets GOODBYE NORMAL_CLOSURE and its socket closes; the local session sees the owner
 *   released. Back on, a remote is connected and the window destroyed: it gets the GOODBYE too.
 *
 * Opens a Phosphor window for about a minute; Windows may ask about the firewall the first time this exe
 * listens. Never touches the operator's profile or a running Phosphor.
 *
 * Run: node test/open-to-lan.test.mjs [--exe src-tauri/target/release/phosphor.exe] [--port P] [--shots <dir>]
 *      SKIPS (exit 0) off Windows or without the exe. Needs UDP 22096 free.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSession, encodeDiscoverProbe, decodeDiscoverReply, DISCOVERY_PORT, CH_CONTROL_OWNER, CH_MOTION, PRIORITY,
  ACCESS, GOODBYE_CODE,
} from '../../Valence/clients/js/index.js';

const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const EXE = argOf('--exe', fileURLToPath(new URL('../src-tauri/target/release/phosphor.exe', import.meta.url)));
const HELD = Number(argOf('--port', 20000 + Math.floor(Math.random() * 20000)));
const CDP = HELD + 1;
const SHOTS = argOf('--shots', null);
if (process.platform !== 'win32' || !existsSync(EXE)) {
  console.log('[SKIP] open-to-lan: needs Windows and the built shell at ' + EXE);
  process.exit(0);
}

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra !== undefined ? '  -- ' + extra : '')); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true;
  return false;
}
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

// One DISCOVER_PROBE; the decoded reply or null. A hub answers a source once per second (SPEC 13.8).
let nonce = 1;
async function probe(ip) {
  await sleep(1200);
  const s = createSocket('udp4');
  const n = nonce++;
  const got = new Promise((res) => {
    s.on('message', (b) => { const r = decodeDiscoverReply(b); if (r && r.nonce === n) res(r); });
    setTimeout(() => res(null), 1500);
  });
  s.send(encodeDiscoverProbe(n), DISCOVERY_PORT, ip);
  const r = await got;
  s.close();
  return r;
}

const held = createServer().listen(HELD, '0.0.0.0');
await new Promise((r) => held.once('listening', r));
ok('nothing else answers DISCOVER_PROBE here', (await probe('127.0.0.1')) === null, 'UDP ' + DISCOVERY_PORT);

const UDF = mkdtempSync(join(tmpdir(), 'open-to-lan-'));
const app = spawn(EXE, [], {
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: UDF, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + CDP },
});
let browser = null, remote = null;
const lanRtt = [];
try {
  ok('the shell exposes CDP', await until(() => fetch('http://127.0.0.1:' + CDP + '/json/version').then((r) => r.ok, () => false), 30000));
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('[data-tab-id="shell:settings"]', { timeout: 30000 });
  await page.evaluate((p) => localStorage.setItem('phosphor.prefs', JSON.stringify({ v: 1, reconnect: false, openToLan: true, lanPort: p })), HELD);
  await page.reload();
  const openTab = async (id) => { await page.waitForSelector('[data-tab-id="' + id + '"]', { timeout: 15000 }); await page.click('[data-tab-id="' + id + '"]'); await sleep(250); };
  const status = () => page.locator('[aria-labelledby="set-lan"] .pane-status').innerText().catch(() => '');

  await openTab('shell:settings');
  ok('on with no Virtual: waits for it', await until(async () => (await status()) === 'Starts with the Virtual'), await status());
  ok('no discovery before the Virtual runs', (await probe('127.0.0.1')) === null);

  await openTab('shell:hubs');
  await page.locator('.pane-list.rows').first().locator('li.virtual').getByRole('button', { name: 'Connect' }).click();
  await openTab('shell:settings');
  const UP = /^Open to LAN · ([\d.]+|no LAN address):(\d+) · (\d+) connected/;
  ok('the Virtual runs: Open to LAN is up', await until(async () => UP.test(await status()), 20000), await status());
  const [, addr, portText] = UP.exec(await status()) || [];
  const IP = addr && addr !== 'no LAN address' ? addr : '127.0.0.1';
  const PORT = Number(portText);
  ok('a taken port falls back and says so', PORT && PORT !== HELD && (await status()).includes(HELD + ' taken'), await status());

  const r1 = await probe(IP);
  ok('discovery answers with the Virtual on the bound port', !!r1 && r1.hub_name === 'Virtual' && r1.ws_port === PORT, JSON.stringify(r1));
  ok('its pairing window is closed (opened to the LAN)', !!r1 && !r1.pairing_window_open);

  // ---- the phone ------------------------------------------------------------------------------
  const events = { goodbye: null, close: null, grant: null, owner: null, motion: 0 };
  remote = createSession({
    host: IP, port: PORT, clientKind: 'webui', clientName: 'LAN phone', instanceId: new Uint8Array(8).fill(0xd1),
    autoReconnect: false, subscriptions: [[CH_CONTROL_OWNER, 0, PRIORITY.critical], [CH_MOTION, 30, PRIORITY.elevated]],
  });
  remote.on('sessionEvent', (e) => { if (e.kind === 'goodbye') events.goodbye = e; });
  remote.on('close', (e) => { events.close = e; });
  remote.on('pairGrant', (g) => { events.grant = g; });
  remote.on('state', (ch, v) => { if (ch === CH_CONTROL_OWNER) events.owner = v; if (ch === CH_MOTION) events.motion++; });
  let welcome = null, live = false;
  remote.on('welcome', (w) => { welcome = w; });
  remote.on('live', () => { live = true; });
  remote.connect();
  ok('the remote reaches LIVE over the LAN socket', await until(() => live, 20000));
  ok('...at watch, the hub floor', welcome && (welcome.roles | 0) === ACCESS.watch, welcome && 'roles=' + welcome.roles);
  ok('discovery names the hub the remote joined', !!r1 && !!welcome && welcome.identity && r1.hub_instance_id === welcome.identity.hub_instance_id,
    welcome && welcome.identity && welcome.identity.hub_instance_id);
  ok('Settings counts it', await until(async () => / · 1 connected/.test(await status())), await status());
  if (SHOTS) await page.locator('[aria-labelledby="set-lan"]').screenshot({ path: join(SHOTS, 'open-to-lan.png') });

  remote.sendPairReq();
  await sleep(1500);
  ok('a knock before the Pairing window is not granted', !events.grant);
  await page.getByRole('button', { name: 'Pairing window' }).click();
  const r2 = await probe(IP);
  ok('the Pairing window button opens the hub\'s window', !!r2 && r2.pairing_window_open, JSON.stringify(r2 && r2.flags));
  remote.sendPairReq();
  ok('the knock in the window is granted', await until(() => !!events.grant, 5000), events.grant && 'role=' + events.grant.role);
  ok('...at control or above, in place', (remote.state.roles | 0) >= ACCESS.control, 'roles=' + remote.state.roles);

  // ---- ownership seen from the PC -------------------------------------------------------------------
  const move = (remote.catalog || []).find((e) => e.name === 'move');
  ok('the remote sees motion telemetry', await until(() => events.motion > 0, 5000), events.motion);
  if (move) await remote.sendIntent(move.id, { 1: 60 }).catch((e) => ok('jog accepted', false, e.message));
  const sid = welcome && welcome.sessionId;
  const ownsIt = (o) => !!o && [0, 1, 2, 3].some((i) => o['owner' + i] === sid);
  ok('the remote owns the rail (its control-owner)', await until(() => ownsIt(events.owner), 5000), JSON.stringify(events.owner));
  await openTab('pairing');
  const ownerRow = page.locator('[aria-labelledby="pp-owners"] li', { hasText: 'session ' + sid });
  ok('the PC\'s session lists the remote as owner, not itself', await until(async () => (await ownerRow.count()) === 1
    && !(await ownerRow.innerText()).includes('this session'), 8000), await page.locator('[aria-labelledby="pp-owners"]').innerText().catch(() => ''));

  // ---- latency: the remote's CLOCK round trips; the in-app baseline runs after the shell exits -------------
  for (let end = Date.now() + 10000; Date.now() < end; await sleep(50)) {
    const c = await remote.syncClock(1000);
    if (c) lanRtt.push(c.rttUs / 1000);
  }
  ok('round trips measured over the LAN', lanRtt.length > 100, lanRtt.length);

  // ---- off ------------------------------------------------------------------------------------------
  await openTab('shell:settings');
  await page.locator('[data-search-key="open-to-lan"]').click();
  ok('off: the remote gets GOODBYE NORMAL_CLOSURE', await until(() => !!events.goodbye, 5000), JSON.stringify(events.goodbye));
  ok('...from the hub side, code NORMAL_CLOSURE', events.goodbye && events.goodbye.code === GOODBYE_CODE.NORMAL_CLOSURE);
  ok('...and its socket closes', await until(() => !!events.close, 5000), JSON.stringify(events.close));
  ok('Settings reads off', (await status()) === '', await status());
  ok('no discovery while off', (await probe(IP)) === null);
  await openTab('pairing');
  ok('the hub released the remote\'s ownership', await until(async () => (await ownerRow.count()) === 0, 5000),
    await page.locator('[aria-labelledby="pp-owners"]').innerText().catch(() => ''));

  // ---- back on, then the window goes away -------------------------------------------------------------
  await openTab('shell:settings');
  await page.locator('[data-search-key="open-to-lan"]').click();
  ok('back on', await until(async () => UP.test(await status()), 10000), await status());
  const PORT2 = Number((UP.exec(await status()) || [])[2]);
  const quit = { goodbye: null, close: null };
  remote = createSession({ host: IP, port: PORT2, clientKind: 'webui', clientName: 'LAN phone 2', instanceId: new Uint8Array(8).fill(0xd2), autoReconnect: false });
  remote.on('sessionEvent', (e) => { if (e.kind === 'goodbye') quit.goodbye = e; });
  remote.on('close', (e) => { quit.close = e; });
  let live2 = false;
  remote.on('live', () => { live2 = true; });
  remote.connect();
  ok('a second remote reaches LIVE', await until(() => live2, 15000));
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: 'main' })).catch(() => {});
  ok('quitting Phosphor sends the remote GOODBYE', await until(() => !!quit.goodbye, 5000), JSON.stringify(quit.goodbye));
  ok('...then a clean close (1001), not a reset', await until(() => !!quit.close, 5000) && quit.close.code === 1001, JSON.stringify(quit.close));
  ok('the shell exits', await until(() => app.exitCode !== null, 10000), app.exitCode);
} catch (e) {
  ok('ran without a harness error', false, String(e && e.stack || e));
} finally {
  if (remote) remote.close();
  if (browser) await browser.close().catch(() => {});
  if (app.exitCode === null) app.kill();
  held.close();
  await sleep(1500);
  try { rmSync(UDF, { recursive: true, force: true }); } catch { /* WebView2 still holds it */ }
}
// The same hub the way the PC's own session reaches it: the app's worker file and bridge in Chromium, the
// files served as they are (a node host is no baseline: node's timers on Windows tick at 15.6 ms).
if (lanRtt.length) {
  const WS_ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const LANE = basename(fileURLToPath(new URL('..', import.meta.url)));
  const srv = createHttpServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8">'); return; }
    try { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(join(WS_ROOT, path))); }
    catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const cr = await chromium.launch();
  const pg = await cr.newPage();
  await pg.goto('http://127.0.0.1:' + srv.address().port + '/');
  const inApp = await pg.evaluate(async (lane) => {
    const { bridgeIntegral } = await import('/' + lane + '/src/model/integral-bridge.js');
    const { WASM } = await import('/' + lane + '/src/model/integral/bytes.js');
    const { createSession } = await import('/Valence/clients/js/index.js');
    const w = new Worker('/' + lane + '/src/model/integral.worker.js', { type: 'module' });
    let bridge;
    const up = new Promise((res) => { bridge = bridgeIntegral(w, (m) => (m.op === 'up' ? res() : null)); });
    bridge.boot(Uint8Array.from(atob(WASM), (c) => c.charCodeAt(0)), null, { homed: true });
    await up;
    const s = createSession({ host: 'builtin', port: 0, clientKind: 'webui', clientName: 'in app', autoReconnect: false, WebSocketImpl: bridge.WebSocket });
    await new Promise((res) => { s.on('live', res); s.connect(); });
    const out = [];
    for (let end = Date.now() + 10000; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
      const c = await s.syncClock(1000);
      if (c) out.push(c.rttUs / 1000);
    }
    s.close();
    w.terminate();
    return out;
  }, LANE).catch((e) => { ok('in-app baseline ran', false, String(e)); return []; });
  await cr.close();
  srv.close();
  const f = (a) => 'p50 ' + pct(a, 0.5).toFixed(2) + ' ms, p95 ' + pct(a, 0.95).toFixed(2) + ' ms (n=' + a.length + ')';
  if (inApp.length) {
    console.log('  latency, CLOCK rtt: over the LAN ' + f(lanRtt) + '; in app ' + f(inApp) + '; added p50 '
      + (pct(lanRtt, 0.5) - pct(inApp, 0.5)).toFixed(2) + ' ms, p95 ' + (pct(lanRtt, 0.95) - pct(inApp, 0.95)).toFixed(2) + ' ms');
  }
  ok('in-app round trips measured', inApp.length > 100, inApp.length);
}
console.log(fails ? '\nFAILURES: ' + fails : '\nALL PASS -- Open to LAN');
process.exit(fails ? 1 : 0);
