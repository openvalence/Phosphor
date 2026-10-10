/**
 * safety-live.mjs -- the RFC-085 safety pairs, the rail's override/return and
 * jog, the motion adapters under PAUSE and the RFC-088 flip, against a REAL
 * valencesim (ph-vdk.55). safety-reach.test.mjs proves the same controls on a
 * modeled hub; this proves the hub agrees. Every press is read back on a
 * second, raw session (C-8).
 *
 *   strip    WELCOME declares estop_cuts_power false and the e-stop reads
 *            Halt; Pause latches PAUSE and reads Resume; Resume clears it;
 *            Halt latches ESTOP and reads Halted; a 3 s hold releases into
 *            PAUSE; Resume
 *   flip     homed and idle with the carriage off center, Flip confirms, the
 *            hub reports travel minus p, the numeral follows and the marker
 *            stays where it was; Flip back
 *   rail     under another session's stream the tape gives way to the plan
 *            strip naming the owner and Flip grays, because the hub refuses
 *            a point move and a flip SOURCE_CONFLICT (read on the raw
 *            session); paused, Override confirms and a jog lands outside the
 *            window; Return comes back to the paused position and leaves
 *            plain PAUSE
 *   adapters the real buttplug and TCode adapters (src/plugins/buttplug.js,
 *            plugins/examples/tcode-adapter, lines fed where the shell's
 *            socket would) on the real motion door: paused, each input is
 *            refused 'paused, resume to continue' and nothing moves, a door
 *            that skips that check is dropped by the hub, and PAUSE stays
 *            latched however long input keeps coming; after the page's Resume
 *            the machine follows
 *
 * The door's `halted` rule mirrors shadow.svelte.js (runes do not load in
 * node); change both together.
 *
 * With no --port it starts its own homed sim (test/live-sim.mjs) and SKIPS
 * (exit 0) without the exe; it rides test:browser as check:safetylive. With
 * --port it COMMANDS MOTION on that sim (valencesim --homed), puts the window
 * and the flip back, and SKIPS when none answers.
 * Build first (npm run build:only). Run:
 *   node test/safety-live.mjs [--port 8882 --http 8880]
 */
import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startSim, SIM } from './live-sim.mjs';
import { createSession, PRIORITY } from '../../Valence/clients/js/index.js';
import { acquireToken } from '../../Valence/clients/js/credentials.js';
import { CORE_CHANNEL } from '../../Valence/clients/js/generated/registry_vocab.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';
import { createMotionDoor } from '../src/model/motion.js';
import { createPluginHost } from '../src/plugins/host.js';
import * as bp from '../src/plugins/buttplug.js';
import * as tcode from '../plugins/examples/tcode-adapter/index.js';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const HOST = '127.0.0.1';
const OWN = argOf('--port', null) === null;
const own = OWN ? await startSim() : null;
if (OWN && !own) { console.log('SKIP: no valencesim at ' + SIM); process.exit(0); }
const PORT = OWN ? own.port : Number(argOf('--port'));
const HTTP = OWN ? own.http : Number(argOf('--http', 8880));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(25); } return !!(await fn()); };

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const answers = await new Promise((resolve) => {
  const ws = new WebSocket('ws://' + HOST + ':' + PORT + '/');
  const t = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } resolve(false); }, 2000);
  ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
  ws.onerror = () => { clearTimeout(t); resolve(false); };
});
if (!answers) { console.log('SKIP: no valencesim answering on ' + HOST + ':' + PORT); process.exit(0); }

// ---- sessions: every one mints its own /uitoken -------------------------------
async function open(name, subs = []) {
  const samples = {};
  const s = createSession({
    host: HOST, port: PORT, clientKind: 'webui', clientName: name, autoReconnect: false,
    token: () => acquireToken(HOST + ':' + HTTP),
    subscriptions: [[CORE_CHANNEL.safety, 0, PRIORITY.critical], [CORE_CHANNEL.control_owner, 0, PRIORITY.critical], ...subs],
  });
  s.on('state', (ch, v) => { samples[ch] = v; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(name + ': no LIVE in 8 s')), 8000);
    s.on('live', () => { clearTimeout(t); resolve(); });
    s.connect();
  });
  return { s, samples, model: buildSettingsModel(s.catalog) };
}
const first = (m, role) => (m.byRole.get(role) || [])[0];

const raw = await open('safety-live raw');
const M = raw.model;
const POS = first(M, ROLE.telemetryPosition), TGT = first(M, ROLE.telemetryTarget);
const WMIN = first(M, ROLE.windowMin), WMAX = first(M, ROLE.windowMax);
const FLIP = first(M, ROLE.axisFlipped), CMD = first(M, ROLE.commandPosition);
raw.s.subscribe([...new Set([POS.channelId, WMIN.channelId, FLIP.channelId])].map((ch) => [ch, 50, PRIORITY.elevated]));
const val = (f, src = raw) => reportedValue(f, src.samples[f.channelId]);
const pos = () => val(POS);
const safety = () => raw.samples[CORE_CHANNEL.safety] || {};
const bit = (b) => !!(safety().word_bits && safety().word_bits[b]);
const mode = (b) => !!(safety().modes_bits && safety().modes_bits[b]);
const owners = () => { const o = raw.samples[CORE_CHANNEL.control_owner] || {}; return [0, 1, 2, 3].map((i) => o['owner' + i] || 0); };
await until(() => Number.isFinite(pos()) && Number.isFinite(val(WMIN)) && val(FLIP) != null, 4000);
const window0 = [val(WMIN), val(WMAX)];
if (bit('estop') || bit('pause') || mode('override')) {
  // Never cleared on the operator's behalf: a latch is the operator's to release.
  console.log('FAIL: the hub starts latched ' + JSON.stringify([safety().word_bits, safety().modes_bits]) + '; clear it and re-run');
  raw.s.close();
  process.exit(1);
}
let streaming = false;
const settle = async (ms = 3000) => { let a = pos(); await sleep(150); for (let t = 0; t < ms; t += 150) { const b = pos(); if (Math.abs(b - a) < 0.05) return b; a = b; await sleep(150); } return pos(); };

// A setpoint from a session that leaves at once: nothing owns the rail after.
async function moveTo(mm) {
  const m = await open('safety-live mover');
  await m.s.sendIntent(CMD.channelId, { [CMD.key]: mm });
  await until(() => Math.abs(pos() - mm) < 0.2, 8000);
  m.s.close();
  await sleep(300);
}

// ---- the page --------------------------------------------------------------------
const HTML = readFileSync(DIST_HTML);
const srv = createServer((q, r) => {
  if (q.url.startsWith('/uitoken')) {
    fetch('http://' + HOST + ':' + HTTP + '/uitoken').then(async (x) => { r.writeHead(x.status, { 'Content-Type': 'application/json' }); r.end(await x.text()); })
      .catch(() => { r.writeHead(502); r.end('{}'); });
    return;
  }
  r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto('http://127.0.0.1:' + srv.address().port + '/?hub=' + HOST + ':' + PORT);
const up = await page.waitForSelector('.topstrip .pair .safety-op button:not([disabled])', { timeout: 15000 }).then(() => true).catch(() => false)
  // Over the hero budget (DESIGN §10.12, TopStrip.svelte: a third of the window height) the rail is the mini; Show rail is the user's ask for it.
  && await page.getByRole('button', { name: 'Show rail' }).first().click({ timeout: 3000 }).then(() => true, () => true)
  && await page.waitForSelector('.rail-hero .rail-tape-track', { timeout: 5000 }).then(() => true).catch(() => false);
ok('the page adopted the live catalog and the rail', up);
if (!up) { await browser.close(); srv.close(); raw.s.close(); process.exit(1); }
await page.waitForTimeout(800);

const estop = page.locator('.topstrip .btn-estop'), pause = page.locator('.topstrip .btn-pause');
const ovr = page.locator('.topstrip .dock .ovr .btn-override'), flip = page.locator('.topstrip .rw-flip');
const tape = page.locator('.rail-hero .rail-tape-track');
const jog = page.getByRole('slider', { name: /^Jog:/ });
const lbl = async (l) => (await l.locator('.lbl').textContent()).trim();
const numeral = async () => Number(await page.locator('.hn-primary .hn-val').textContent());
const confirmHazard = () => page.locator('.overlay[role=alertdialog] .og-btn.confirm').click();
const tapAt = async (frac) => { const b = await tape.boundingBox(); await page.mouse.click(b.x + b.width * frac, b.y + b.height / 2); };

try {
  // ---- strip -----------------------------------------------------------------------
  console.log('\n[strip] the safety pairs on the hub');
  ok('strip: WELCOME declares estop_cuts_power false', raw.s.state.identity && raw.s.state.identity.estop_cuts_power === false,
    raw.s.state.identity && raw.s.state.identity.estop_cuts_power);
  ok('strip: so the e-stop reads Halt', await lbl(estop) === 'Halt', await lbl(estop));
  await pause.click();
  ok('strip: Pause latches PAUSE on the hub and reads Resume', await until(() => bit('pause')) && await until(async () => await lbl(pause) === 'Resume'),
    safety().word_bits);
  await pause.click();
  ok('strip: Resume clears it', await until(() => !bit('pause')) && await until(async () => await lbl(pause) === 'Pause'), safety().word_bits);
  await estop.click();
  ok('strip: Halt latches ESTOP and reads Halted', await until(() => bit('estop')) && await until(async () => await lbl(estop) === 'Halted'),
    safety().word_bits);
  await estop.hover();
  await page.mouse.down();
  await page.waitForTimeout(1000);
  ok('strip: a 1 s hold releases nothing', bit('estop'));
  await page.waitForTimeout(2300);
  await page.mouse.up();
  ok('strip: held past 3 s, release lands in PAUSE', await until(() => !bit('estop') && bit('pause')), safety().word_bits);
  ok('strip: ...the pair reads Halt and Resume', await until(async () => await lbl(estop) === 'Halt' && await lbl(pause) === 'Resume'),
    [await lbl(estop), await lbl(pause)]);
  await pause.click();
  ok('strip: Resume', await until(() => !bit('pause')), safety().word_bits);

  // ---- flip --------------------------------------------------------------------------
  console.log('\n[flip] homed and idle');
  const p0 = 120;
  await moveTo(p0);
  ok('flip: the carriage sits off center and nothing owns the rail', Math.abs(pos() - p0) < 0.5 && owners().every((o) => !o),
    [pos(), owners()]);
  await page.evaluate(() => { window.__railProbe = []; });
  await page.waitForTimeout(400);
  const px0 = await page.evaluate(() => window.__railProbe.at(-1)[5]);
  const flipped0 = val(FLIP);
  // SPEC §9.6: the hub mirrors against the homed travel.
  const measured = val(first(M, ROLE.geometryMeasuredTravel)), maxRail = val(first(M, ROLE.geometryMaxTravel));
  const travel = measured > 0 ? measured : maxRail;
  await flip.click();
  await confirmHazard();
  ok('flip: the hub takes the flip', await until(() => val(FLIP) !== flipped0, 3000), val(FLIP));
  ok('flip: position reads travel minus p', await until(() => Math.abs(pos() - (travel - p0)) < 0.5, 3000),
    { pos: pos(), p0, measured, maxRail });
  ok('flip: the numeral follows the hub', await until(async () => Math.abs(await numeral() - pos()) < 0.15), [await numeral(), pos()]);
  await page.evaluate(() => { window.__railProbe = []; });
  await page.waitForTimeout(400);
  const px1 = await page.evaluate(() => window.__railProbe.at(-1)[5]);
  ok('flip: the marker stays where the carriage is', Math.abs(px1 - px0) < 2, { px0, px1 });
  await flip.click();
  await confirmHazard();
  ok('flip: back, the hub reads p again', await until(() => val(FLIP) === flipped0 && Math.abs(pos() - p0) < 0.5, 3000), [val(FLIP), pos()]);

  // ---- rail ----------------------------------------------------------------------------
  console.log('\n[rail] a stream owns the rail; override and return');
  const st = await open('safety-live streamer');
  const stDoor = createMotionDoor({ session: () => st.s, entries: () => st.s.catalog, setpoint: () => ({ ok: false, reason: 'off' }), log: () => {} });
  streaming = true;
  const streamLoop = (async () => { const t0 = Date.now(); while (streaming) { stDoor(0.5 + 0.1 * Math.sin((Date.now() - t0) / 400)); await sleep(20); } })();
  ok('rail: the stream owns the rail on the hub', await until(() => owners().some((o) => o), 3000), owners());
  // A jog never takes the rail from a source (SPEC §11.4): the tape gives way
  // to the plan strip, which names the owner.
  const planFace = page.locator('.rail-hero .swap-face:has(.plan-strip)');
  // The readback names the source kind and, since RFC-098, the owning client (PlanStrip.svelte: two .plan-owner spans).
  ok('rail: the tape gives way to the plan strip, naming the owner',
    await until(async () => !(await planFace.getAttribute('class')).includes('off')
      && (await page.locator('.topstrip .readback').textContent().catch(() => '')).includes('owned by webui on safety-live streamer')),
    (await page.locator('.topstrip .readback').textContent().catch(() => '')).trim());
  // ...because the hub refuses both from anyone else (SOURCE_CONFLICT), and
  // grays the flip ahead of time through its enabled_mask. A throwaway
  // session asks: a refused move still takes the Jog source (Nucleus val-u8a),
  // and leaving is what gives it back.
  const pr = await open('safety-live prober');
  const nackOf = (p) => p.then(() => 'ECHO', (e) => e.name || e.message);
  ok('rail: the hub refuses another session\'s point move SOURCE_CONFLICT',
    await nackOf(pr.s.sendIntent(CMD.channelId, { [CMD.key]: 100 })) === 'SOURCE_CONFLICT');
  ok('rail: and a flip SOURCE_CONFLICT', await nackOf(pr.s.sendIntent(FLIP.writeChannel, { [FLIP.settingKey]: flipped0 ? 0 : 1 })) === 'SOURCE_CONFLICT');
  ok('rail: the page grays Flip while the stream owns the rail', await until(() => flip.isDisabled()), await flip.getAttribute('title'));
  pr.s.close();
  streaming = false;
  await streamLoop;
  st.s.close();
  ok('rail: the streaming session leaves and the rail is free', await until(() => owners().every((o) => !o), 5000), owners());
  await page.evaluate(() => { const b = document.querySelector('.topstrip .st-dismiss'); if (b) b.click(); });

  const narrow = [Math.round(window0[0] + (window0[1] - window0[0]) * 0.3), Math.round(window0[0] + (window0[1] - window0[0]) * 0.7)];
  await raw.s.sendIntent(WMIN.writeChannel, { [WMIN.settingKey]: narrow[0], [WMAX.settingKey]: narrow[1] });
  ok('rail: the window narrows to ' + narrow.join('..'), await until(() => val(WMIN) === narrow[0] && val(WMAX) === narrow[1]), [val(WMIN), val(WMAX)]);
  await settle();
  await pause.click();
  ok('rail: paused', await until(() => bit('pause')));
  const pausedAt = await settle();
  await ovr.click();
  await confirmHazard();
  ok('rail: Override confirms, the hub latches override, the control reads Return',
    await until(() => mode('override')) && await until(async () => await lbl(ovr) === 'Return'), safety().modes_bits);
  // The jog slider's own bounds say it spans the travel (RailWidget.svelte tapeLo/tapeHi).
  const jogSpan = async () => [Number(await jog.getAttribute('aria-valuemin')), Number(await jog.getAttribute('aria-valuemax'))];
  ok('rail: the tape is a jog over the whole travel', await until(async () => { const [a, b] = await jogSpan(); return a < narrow[0] && b > narrow[1]; }),
    await jogSpan());
  await tapAt(0.05);
  ok('rail: a jog lands outside the window', await until(() => pos() < narrow[0] - 5, 8000),
    { pos: pos(), window: narrow, strip: (await page.locator('.topstrip .st-text').textContent().catch(() => '')).trim(), owners: owners() });
  await settle();
  await ovr.click();
  ok('rail: Return comes back to the paused position', await until(() => Math.abs(pos() - pausedAt) < 0.5, 10000), { pos: pos(), pausedAt });
  ok('rail: ...and leaves plain PAUSE', await until(() => !mode('override') && bit('pause')) && await lbl(ovr) === 'Override',
    [safety().word_bits, safety().modes_bits]);

  // ---- adapters --------------------------------------------------------------------------
  console.log('\n[adapters] buttplug and TCode under PAUSE');
  const ad = await open('safety-live adapters');
  const adSafety = () => ad.samples[CORE_CHANNEL.safety] || {};
  const door = createMotionDoor({
    session: () => ad.s, entries: () => ad.s.catalog, setpoint: () => ({ ok: false, reason: 'off' }), log: () => {},
    halted: () => { const w = adSafety().word_bits || {}; return w.estop ? 'e-stop latched' : w.pause ? 'paused, resume to continue' : ''; },
  });
  let tcodeLine = null;
  const logs = [];
  const host = createPluginHost({
    model: () => ad.model, sample: (ch) => ad.samples[ch], sampleAge: () => 0, display: reportedValue, status: () => 'confirmed',
    write: () => {}, submitMotion: door, registerTheme: () => {}, prefs: null, log: (name, level, msg) => logs.push(name + ': ' + msg),
    listenTcp: async (port, onLine) => { tcodeLine = onLine; return () => {}; },
  });
  let bpApi = null;
  host.add(bp.manifest, { activate: (a) => { bpApi = a; } });
  let tcApi = null;
  host.add(JSON.parse(readFileSync(new URL('../plugins/examples/tcode-adapter/manifest.json', import.meta.url))),
    { activate: (a) => { tcApi = a; return tcode.activate(a); } });
  await until(() => !!tcodeLine, 2000);
  ok('adapters: both adapters are up on the host', !!bpApi && !!tcApi && !!tcodeLine);
  const results = [];
  const feed = async (ms) => {
    const seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hi = Math.floor((Date.now() - t0) / 600) % 2;
      results.push(bp.onMotion(bpApi, { position: hi ? 0.7 : 0.3, ms: 300 }));
      tcodeLine('L0' + (hi ? '300' : '700') + 'I300');
      seen.push(pos());
      await sleep(30);
    }
    const v = seen.filter(Number.isFinite);
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
  };
  ok('adapters: the machine is still paused', bit('pause'));
  results.length = 0;
  const pausedSpread = await feed(2500);
  const reasons = [...new Set(results.map((r) => r && (r.ok ? 'ok' : r.reason)))];
  ok("adapters: paused, every buttplug input is refused 'paused, resume to continue'",
    reasons.length === 1 && reasons[0] === 'paused, resume to continue', reasons);
  ok('adapters: ...and the TCode adapter says the same, once',
    logs.filter((l) => /^tcode-adapter: motion refused/.test(l)).join() === 'tcode-adapter: motion refused: paused, resume to continue', logs);
  ok('adapters: ...and nothing moves', pausedSpread < 0.2, pausedSpread);
  const bypass = createMotionDoor({ session: () => ad.s, entries: () => ad.s.catalog, setpoint: () => ({ ok: false, reason: 'off' }), log: () => {} });
  const during = [];
  for (let i = 0; i < 80; i++) { bypass(i % 20 < 10 ? 0.3 : 0.7); during.push(pos()); await sleep(30); }
  const bypassSpread = Math.max(...during) - Math.min(...during);
  ok('adapters: a door that skips the check is dropped by the hub (SPEC §11.1)', bypassSpread < 0.2, bypassSpread);
  ok('adapters: no automatic resume: PAUSE holds through all that input', bit('pause'), safety().word_bits);
  await pause.click();
  ok('adapters: the page resumes', await until(() => !bit('pause')));
  results.length = 0;
  const liveSpread = await feed(3000);
  ok('adapters: after Resume the machine follows the adapters', liveSpread > 5, liveSpread);
  ok('adapters: and they report accepted', results.some((r) => r && r.ok), results.filter((r) => r && r.ok).length);
  ad.s.close();
} catch (e) {
  ok('run', false, e.stack);
} finally {
  // Put back what this run changed; never resume on the operator's behalf.
  streaming = false;
  try {
    if (val(FLIP) !== 0) await raw.s.sendIntent(FLIP.writeChannel, { [FLIP.settingKey]: 0 }).catch(() => {});
    if (val(WMIN) !== window0[0] || val(WMAX) !== window0[1]) {
      await raw.s.sendIntent(WMIN.writeChannel, { [WMIN.settingKey]: window0[0], [WMAX.settingKey]: window0[1] }).catch(() => {});
    }
  } catch (e) { /* the sim may be gone */ }
  ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3));
  await page.goto('about:blank').catch(() => {});
  await browser.close();
  srv.close();
  raw.s.close();
}
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- safety live'));
process.exit(fails ? 1 : 0);
