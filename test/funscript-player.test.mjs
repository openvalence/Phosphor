/**
 * funscript-player.test.mjs -- the funscript player plugin (epic ph-smvd).
 *
 * Node sections (`--unit`, in `npm run check`):
 *   (a) contract   every module exports what CONTRACT.md names; the manifest
 *   (b) prefs      defaults, repair of malformed values, the backup mirror
 *   (c) hero       the spec claims on the valencesim fixture and declines
 *                  without a segments STREAM; the factory entry
 * Browser sections (default, `npm run check:funscript`; needs ffmpeg on
 * PATH): see the header of the browser half below.
 *
 * Constraints:
 * - The node sections touch no DOM: every module imports under node.
 * - The export lists below are CONTRACT.md's; change both in one commit.
 * - Channel ids appear here and in fixtures only, never in the plugin.
 *
 * Run: node test/funscript-player.test.mjs --unit
 *      node test/funscript-player.test.mjs [--shot out.png]
 *      node test/funscript-player.test.mjs --live --port P --http P+7
 */
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/index.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { claimAll } from '../src/model/roles.js';

const args = process.argv.slice(2);
const UNIT = args.includes('--unit');

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!cond) fails++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const P = '../plugins/factory/funscript-player/';
const CONTRACT = {
  [P + 'funscript.js']: ['MAX_SPAN_MS', 'AXES', 'parseFunscript', 'axisOf', 'pairFiles', 'posAt', 'indexAfter',
    'speedAt', 'thin', 'heat', 'fmtTime'],
  [P + 'clock.js']: ['CLOCK_WINDOW', 'SLEW_MS_PER_S', 'STEP_MS', 'FALLBACK_AFTER_MS', 'createMediaClock', 'frameSource'],
  [P + 'scheduler.js']: ['STOP_MS', 'PREROLL_MIN_MS', 'PREROLL_STROKE_MS', 'PREROLL_SKIP', 'OFFER_MAX', 'TRANSIENT',
    'applyT', 'strokeSpeed', 'createScheduler'],
  [P + 'stash.js']: ['SCENES_QUERY', 'SORTS', 'COPY', 'normalizeBase', 'rebase', 'withKey', 'toScene', 'createStash'],
  [P + 'library.js']: ['CSS', 'COPY', 'mountLibrary', 'mountConnect'],
  [P + 'ui.js']: ['CSS', 'COPY', 'createPlayer'],
  [P + 'timeline.js']: ['ZOOMS', 'CSS', 'COPY', 'curvePoints', 'seekAt', 'mountTimeline'],
  [P + 'prefs.js']: ['PREFS', 'readPrefs', 'writePref'],
  [P + 'index.js']: ['activate'],
  '../src/model/motion.js': ['SEG_FLOOR_MS', 'streamGate', 'createMotionDoor', 'bundleHead', 'motionStream'],
  '../src/model/actions.js': ['railOwners', 'railOwnerName'],
  '../src/plugins/host.js': ['MOTION_HOLD_MS', 'createPluginHost', 'validateManifest'],
};

// ---- (a) every module exports what CONTRACT.md names ------------------------
console.log('(a) contract exports');
const mods = {};
for (const [path, names] of Object.entries(CONTRACT)) {
  let m = null;
  try { m = await import(new URL(path, import.meta.url)); } catch (e) { ok(path + ' imports', false, e.message); continue; }
  mods[path] = m;
  const missing = names.filter((n) => !(n in m));
  ok(path.replace(P, ''), missing.length === 0, missing.length ? 'missing ' + missing.join(', ') : undefined);
}

const door = mods['../src/model/motion.js'];
if (door && door.createMotionDoor) {
  const submit = door.createMotionDoor({ session: () => null, entries: () => [], setpoint: () => ({ ok: false }), log: () => {} });
  ok('createMotionDoor(...).segments is a function', typeof submit.segments === 'function');
}

const host = mods['../src/plugins/host.js'];
const manifest = JSON.parse(readFileSync(new URL(P + 'manifest.json', import.meta.url), 'utf8'));
// Ruling R-A (docs/plugins/FUNSCRIPT.md): until the host accepts net.fetch the
// manifest is invalid for that one reason, and the plugin stays out of FACTORY.
const NET_FETCH_PENDING = 'unknown permission "net.fetch"';
const problems = host && host.validateManifest ? host.validateManifest(manifest) : ['no host'];
const RA = !problems.includes(NET_FETCH_PENDING);
ok('manifest validates' + (RA ? '' : ' but for net.fetch (R-A pending)'), problems.filter((p) => p !== NET_FETCH_PENDING).length === 0,
  problems.join('; ') || undefined);
ok('manifest declares motion and net.fetch, never intent',
  manifest.permissions.includes('motion') && manifest.permissions.includes('net.fetch') && !manifest.permissions.includes('intent'));

// ---- (b) prefs ----------------------------------------------------------------
console.log('(b) prefs');
const prefs = mods[P + 'prefs.js'];
if (prefs) {
  const { PREFS, readPrefs, writePref } = prefs;
  const ls = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) } });
  const fakeApi = (seed = {}) => {
    const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
    return { m, prefs: { get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: (k, v) => m.set(k, JSON.stringify(v)) } };
  };
  const want = { T: { offsetMs: 0, lo: 0, hi: 1, invert: false }, motion: true, audio: { vol: 1, muted: false },
    stash: { base: '', key: '' }, lib: { q: '', sort: 'date', direction: 'DESC' }, view: 'player', zoomMs: 10000 };
  ok('PREFS is the contract shape', same(PREFS, want));
  ok('PREFS is frozen to the leaves', Object.isFrozen(PREFS) && Object.isFrozen(PREFS.T) && Object.isFrozen(PREFS.lib));
  ok('an empty store reads the defaults', same(readPrefs(fakeApi()), want));
  const bad = readPrefs(fakeApi({ T: { offsetMs: 'x', lo: 0.9, hi: 0.92, invert: 1 }, motion: 'yes', audio: { vol: 3 },
    stash: { base: 'http://s:9999' }, lib: { direction: 'up', sort: '' }, view: 'grid', zoomMs: -4 }));
  ok('malformed values are replaced, partial objects filled', same(bad, { ...want,
    stash: { base: 'http://s:9999', key: '' } }), bad);
  const t = readPrefs(fakeApi({ T: { offsetMs: 512, lo: 0.2, hi: 0.8, invert: true } })).T;
  ok('offset clamps to 500, a valid range and invert survive', same(t, { offsetMs: 500, lo: 0.2, hi: 0.8, invert: true }), t);
  ok('offset rounds to its 5 ms step', readPrefs(fakeApi({ T: { offsetMs: -12 } })).T.offsetMs === -10);
  ok('an array is not an object pref', same(readPrefs(fakeApi({ audio: [1, 2] })).audio, want.audio));
  const a = fakeApi();
  writePref(a, 'T', { offsetMs: 45, lo: 0.1, hi: 0.9, invert: false });
  writePref(a, 'stash', { base: 'http://s:9999', key: 'secret' });
  ok('writePref stores through api.prefs', same(a.prefs.get('T'), { offsetMs: 45, lo: 0.1, hi: 0.9, invert: false }));
  ok('every key but stash is mirrored under phosphor.funscript.*', ls.has('phosphor.funscript.T') && !ls.has('phosphor.funscript.stash')
    && ![...ls.values()].some((v) => v.includes('secret')));
  ok('a restored backup (mirror only) reads back', readPrefs(fakeApi()).T.offsetMs === 45);
  writePref(a, 'audio', { vol: 7, muted: true });
  ok('writePref stores the repaired value', same(a.prefs.get('audio'), { vol: 1, muted: true }));
  let threw = false;
  try { writePref(a, 'volume', 1); } catch (e) { threw = true; }
  ok('an unknown key throws', threw);
  delete globalThis.localStorage;
  ok('no localStorage: reads still work', same(readPrefs(fakeApi()), want));
}

// ---- (c) the hero spec: claims with a segments STREAM, declines without ------
console.log('(c) hero spec');
const index = mods[P + 'index.js'];
const ENTRIES = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
const SEG_CH = 0x2101;   // valencesim motion-segment (registry 0x2101), test-side only
if (index) {
  const h = index.HERO;   // activate itself creates the <video>: the browser half drives it
  ok('one hero, id player, title, absorb false, cells', !!h && h.id === 'player' && h.title === 'Funscript player'
    && h.absorb === false && same(h.cells, { h: [16, 12], v: [8, 16] }));
  ok('spec requires input.target and input.duration', !!h && same(h.spec.require, { target: 'input.target', dur: 'input.duration' }));
  ok('spec binds the six optional roles', !!h && same(h.spec.optional, { pos: 'telemetry.position', lo: 'window.min', hi: 'window.max',
    vmax: 'limit.input.speed', patRun: 'pattern.running', advRun: 'advgen.running' }));
  if (h) {
    const claim = (entries) => claimAll(buildSettingsModel(entries).byRole, [{ id: 'p', spec: h.spec, absorb: false }]);
    const w = claim(ENTRIES).widgets[0];
    ok('claims on the valencesim fixture, dur on the segments STREAM', !!w && w.fields.dur.channelId === SEG_CH);
    ok('every optional role binds there', !!w && ['pos', 'lo', 'hi', 'vmax', 'patRun', 'advRun'].every((k) => w.fields[k]));
    ok('absorb false claims nothing away', claim(ENTRIES).claimed.size === 0);
    ok('declines without a segments STREAM (D1)', claim(ENTRIES.filter((e) => e.id !== SEG_CH)).widgets.length === 0);
  }
}
{
  let factory = null;
  try { factory = await import('../src/plugins/factory.js'); } catch (e) { ok('factory.js imports', false, e.message); }
  const f = factory && factory.FACTORY.find((x) => x.manifest.name === 'funscript-player');
  if (RA) ok('listed in FACTORY with its manifest', !!f && same(f.manifest, manifest) && f.module.activate === (index && index.activate));
  else ok('not in FACTORY while net.fetch is refused (test (g) validates every entry)', !f);
}

if (UNIT || fails) {
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
}

// =============================================================================
// Browser half: the shell bundle (shell-build.mjs, stub Tauri runtime) with
// the factory plugin, against a fake hub on the valencesim fixture catalog
// (CLOCK answered, PUBLISH granted at latency 1000 us, STREAM bundles decoded)
// and the fake Stash; the clip is generated at run time by ffmpeg.
//   claim      the card renders on the fixture, and nowhere without a
//              segments STREAM
//   idle       nothing is sent before Play
//   preroll    one positioning segment, the video starts at its end
//   timing     every start lies within half the horizon (250, 1000) of its arrival;
//              starts tile; each segment once; the host lands each start on
//              the instant the player asked for; the knots land on the
//              frames they belong to
//   seek       the first segment after a seek starts at now
//   offset     +50 moves every start 50 ms later
//   rate       1.5 divides every duration
//   pause      one hold, then silence
//   latch      a pushed PAUSE pauses the video within 100 ms with the latch
//              words, nothing is sent after; clearing it plays nothing
//   gates      advgen.running grays Play; a second plugin reads the busy words
//   layout     identical rects across states; 40 px targets under a coarse
//              pointer; nothing wears --bad; copy within docs/COPY.md;
//              glance at 220 px
//   stash      the connect card, tiles keyed with apikey, a pick fetching the
//              script with the ApiKey header
// Live (--live): valencesim on spare ports plays 8 s: bundles, no NACK, the
// plan strip moving, the strip's Pause pauses the video and Resume leaves it
// paused, an Advanced start grays Play.
//
// The fake hub's clock is epoch microseconds (node's timeOrigin + now), so a
// segment's execution start reads directly in the page's epoch ms
// (performance.timeOrigin + now): both count the same wall clock.
// =============================================================================
const { chromium } = await import('playwright');
const { createServer } = await import('node:http');
const { execFileSync } = await import('node:child_process');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { cbMap, cbUint, cbF32, cbBstr, cbTstr, cbArray, cbDecodeFull } = await import('../../Valence/clients/js/cbor.js');
const { decodePacked, encodePacked } = await import('../../Valence/clients/js/catalog.js');
const { encodeFrame, parseFrames, FRAME, K, WELCOME_LIMITS_K, IDENTITY_K, LIMITS, NACK } = await import('../../Valence/clients/js/frames.js');
const { CORE_CHANNEL } = await import('../../Valence/clients/js/generated/registry_vocab.js');
const { toHex } = await import('../../Valence/clients/js/sha256.js');
const { buildShellPage, TAURI_STUB } = await import('./shell-build.mjs');
const { advgenCatalog } = await import('./fixtures/advgen-roles-catalog.mjs');
const { startFakeStash } = await import('./fixtures/fake-stash.mjs');

const LIVE = args.includes('--live');
const SHOT = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
const SIM_PORT = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 8882;
const SIM_HTTP = args.includes('--http') ? parseInt(args[args.indexOf('--http') + 1], 10) : SIM_PORT + 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const PAUSE_BIT = 0x08;   // registry: safety word bit3
const LAT_US = 1000;      // the fake grant's schedule_latency_us (valencesim, measured)
const HORIZON_MS = 250;
const KEY = 'test-key-1';
// Fixture channel ids, test-side only (registry.yaml / valencesim catalog).
const CH = { config: 0x1000, motion: 0x1100, advgen: 0x1210, segments: 0x2101 };

// ---- generated media: a 30 fps VP8 clip with a tone, never committed ---------
const TMP = mkdtempSync(join(tmpdir(), 'fsp-'));
const CLIP_S = 30;
let VIDEO = null;
try {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=' + CLIP_S,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + CLIP_S, '-c:v', 'libvpx', '-b:v', '200k', '-g', '15',
    '-c:a', 'libopus', '-shortest', join(TMP, 'clip.webm')], { windowsHide: true, stdio: 'pipe' });
  VIDEO = readFileSync(join(TMP, 'clip.webm'));
} catch (e) {
  ok('ffmpeg on PATH generates the test clip', false, String(e.message).split('\n')[0]);
  process.exit(1);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

// The script: each span a distinct length (300..597 ms) between alternating
// ends, so a captured segment names its knot by its duration alone.
const ACTIONS = [];
for (let at = 0, k = 0; at <= CLIP_S * 1000 - 600; k++) { ACTIONS.push({ at, pos: k % 2 ? 85 : 15 }); at += 300 + ((k * 37) % 298); }
const SCRIPT = { version: '1.0', inverted: false, range: 100, actions: ACTIONS };
/** The knot k whose span (k-1 -> k) lasts durMs at this rate, or -1. */
function knotOf(durMs, rate = 1) {
  let best = -1, err = Infinity;
  for (let k = 1; k < ACTIONS.length; k++) {
    const e = Math.abs((ACTIONS[k].at - ACTIONS[k - 1].at) / rate - durMs);
    if (e < err) { err = e; best = k; }
  }
  return err <= 1 ? best : -1;
}

// ---- the fake hub -----------------------------------------------------------
const hubUs = () => Math.round((performance.timeOrigin + performance.now()) * 1000);
/** The full value nearest `near` whose low 32 bits are u32. */
const unwrap = (u32, near) => near + ((u32 - (near >>> 0)) | 0);

function makeHub(cat, { horizonMs = HORIZON_MS } = {}) {
  const hub = { bundles: [], publishes: [], values: {}, latch: 0, socket: null, roles: 2, timer: null, nackStream: 0 };
  const entry = (id) => cat.entries.find((e) => e.id === id);
  const valuesOf = (e) => Object.fromEntries(e.layout.map((f) => [f.name,
    hub.values[e.id + ':' + f.name] ?? (f.role === 'meta.enabled_mask' ? 0xff : Number(f.default) || 0)]));
  hub.send = (type, ch, payload, seq = 0) => { try { hub.socket.send(Buffer.from(encodeFrame(type, ch, payload, seq))); } catch (e) { /* closed */ } };
  hub.state = (id) => {
    if (!hub.socket) return;
    if (id === CORE_CHANNEL.safety) { hub.send(FRAME.STATE, id, Uint8Array.of(hub.latch, 0, 0, 0, 0, 0, 0, 0, 0)); return; }
    const e = entry(id);
    if (!e || !e.layout || e.dirName === 'c2h') return;
    let bytes;
    try { bytes = encodePacked(valuesOf(e), e.layout); } catch (x) { return; }   // a string layout: never pushed here
    hub.send(FRAME.STATE, id, bytes);
  };
  hub.set = (id, name, v) => { hub.values[id + ':' + name] = v; hub.state(id); };
  hub.setLatch = (w) => { hub.latch = w; hub.state(CORE_CHANNEL.safety); };
  hub.route = (ws) => {
    hub.socket = ws;
    clearInterval(hub.timer);
    hub.timer = setInterval(() => hub.state(CH.motion), 50);   // keeps telemetry.position fresh (law 8)
    ws.onMessage((msg) => {
      if (typeof msg === 'string') return;
      for (const { header, payload } of parseFrames(new Uint8Array(msg))) {
        const t = header.type;
        if (t === FRAME.HELLO) {
          hub.send(FRAME.WELCOME, 0, cbMap([
            [K.session_id, cbUint(7)], [K.boot_id, cbUint(0x5eed)],
            [K.catalog_etag, cbBstr(Uint8Array.from(Buffer.from(cat.etag, 'hex')))], [K.cfg_gen, cbUint(1)],
            [K.limits, cbMap([[WELCOME_LIMITS_K.max_frame, cbUint(4096)], [WELCOME_LIMITS_K.max_subscriptions, cbUint(64)],
              [WELCOME_LIMITS_K.max_subscriptions_per_frame, cbUint(16)]])],
            [K.roles, cbUint(hub.roles)], [K.deadman_ms, cbUint(600000)],
            [K.identity, cbMap([[IDENTITY_K.product, cbTstr('fixture')], [IDENTITY_K.fw_version, cbTstr('0.0.0-fixture')],
              [IDENTITY_K.hub_name, cbTstr('FSP fixture')]])],
          ]));
        } else if (t === FRAME.SUBSCRIBE) {
          const grants = [];
          for (const w of cbDecodeFull(payload).get(K.subscriptions) || []) {
            const ch = w.get(K.channel_id);
            grants.push(cbMap([[K.priority, cbUint(w.get(K.priority) || 0)], [K.granted_rate_hz, cbUint(w.get(K.rate_hz) || 0)],
              [K.channel_id, cbUint(ch)]]));
            hub.state(ch);
          }
          hub.send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray(grants)]]));
        } else if (t === FRAME.CLOCK) {
          const now = hubUs() >>> 0;
          const out = new Uint8Array(12);
          const dv = new DataView(out.buffer);
          dv.setUint32(0, new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, true), true);
          dv.setUint32(4, now, true);
          dv.setUint32(8, now, true);
          hub.send(FRAME.CLOCK, 0, out);
        } else if (t === FRAME.PUBLISH) {
          const pubs = [];
          for (const w of cbDecodeFull(payload).get(K.publishes) || []) {
            const ch = w.get(K.channel_id);
            hub.publishes.push({ ch, rate: w.get(K.rate_hz) });
            const pairs = [[K.granted_rate_hz, cbF32(Math.min(w.get(K.rate_hz), 50))], [K.channel_id, cbUint(ch)],
              [K.schedule_latency_us, cbUint(LAT_US)]];
            if (ch === CH.segments) pairs.push([K.schedule_horizon_ms, cbUint(horizonMs)]);
            pubs.push(cbMap(pairs));
          }
          hub.send(FRAME.GRANT, 0, cbMap([[K.grants, cbArray([])], [K.granted_publishes, cbArray(pubs)]]));
        } else if (t === FRAME.STREAM) {
          const arrival = hubUs();
          const e = entry(header.channel);
          const dv = new DataView(payload.buffer, payload.byteOffset, payload.length);
          const n = dv.getUint8(4);
          const base = unwrap(dv.getUint32(0, true), arrival);
          const size = (payload.length - 6 - 2 * n) / n;
          const tgt = e.layout.find((f) => f.role === 'input.target'), dur = e.layout.find((f) => f.role === 'input.duration');
          const segs = [];
          for (let i = 0; i < n; i++) {
            const stamp = base + dv.getUint16(6 + 2 * i, true) * LIMITS.segment_t_off_unit_us;
            const r = decodePacked(payload.subarray(6 + 2 * n + size * i, 6 + 2 * n + size * (i + 1)), e.layout);
            segs.push({ exec: stamp + LAT_US, norm: r[tgt.name], dur: r[dur.name], arrival });
          }
          hub.bundles.push({ ch: header.channel, arrival, segs, latch: hub.latch });
          if (hub.nackStream) hub.send(FRAME.NACK, header.channel, cbMap([[K.code, cbUint(hub.nackStream)]]), header.seq);
        } else if (t === FRAME.PING) {
          hub.send(FRAME.PONG, header.channel, payload);
        }
      }
    });
  };
  /** Every segment of the bundles since index i0, flat. */
  hub.segs = (i0 = 0) => hub.bundles.slice(i0).flatMap((b) => b.segs);
  return hub;
}

// ---- the page ---------------------------------------------------------------
const SHELL = await buildShellPage();
const srv = createServer((q, s) => {
  if (LIVE && q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + SIM_HTTP + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch();

// The shell's @tauri-apps/plugin-http commands, served by node's fetch (no
// CORS, as in the shell). plugins_list hands over BUSY_PROBE when asked.
function SHELL_STUB(probe) {
  const base = window.__TAURI_INTERNALS__.invoke;
  const held = new Map();
  let n = 0;
  window.__TAURI_INTERNALS__.invoke = async (cmd, a) => {
    if (cmd === 'plugins_list' && probe) return { dir: 'test', plugins: [probe] };
    if (cmd === 'plugin:http|fetch') { held.set(++n, { cfg: a.clientConfig }); return n; }
    if (cmd === 'plugin:http|fetch_send') {
      const h = held.get(a.rid);
      const r = await window.__nodeFetch(h.cfg.url, h.cfg.method, h.cfg.headers, h.cfg.data);
      h.body = r.body;
      return { status: r.status, statusText: r.statusText, url: h.cfg.url, headers: r.headers, rid: a.rid };
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
async function nodeFetch(url, method, headers, data) {
  const r = await fetch(url, { method, headers: headers || [], body: data ? Buffer.from(data) : undefined });
  return { status: r.status, statusText: r.statusText, headers: [...r.headers], body: [...new Uint8Array(await r.arrayBuffer())] };
}

// A second motion plugin: its card shows its own gate on the segments field;
// once window.__probeSubmit is set it submits too, window.__busy its answer.
const BUSY_PROBE = {
  dir: 'busy-probe', path: 'test/busy-probe',
  manifest: { name: 'busy-probe', version: '0', api: 1, kind: 'widget', entry: 'index.js', permissions: ['motion'] },
  source: `export function activate(api) {
    api.registerHero({ id: 'p', title: 'Busy probe', absorb: false, spec: { require: { dur: 'input.duration' } },
      mount(el, f) {
        const o = document.createElement('output'); o.id = 'busy-probe'; el.append(o);
        const t = setInterval(() => {
          o.textContent = api.gate(f.dur);
          if (window.__probeSubmit) window.__busy = api.submitSegments([{ atMs: performance.now() + 50, norm: 0.5, durationMs: 100 }]);
        }, 100);
        return { update() {}, unmount() { clearInterval(t); } };
      } });
  }`,
};

async function open({ cat = advgenCatalog(), hub = null, coarse = false, width = 1440, probe = null, prefs = {}, onPage = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: coarse });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(SHELL_STUB, probe);
  await ctx.exposeFunction('__nodeFetch', nodeFetch);
  await ctx.addInitScript(([etag, bytes, live, port, prefs]) => {
    try {
      if (sessionStorage.getItem('fsp.seeded')) return;
      sessionStorage.setItem('fsp.seeded', '1');
      localStorage.setItem('phosphor.funscript.probe', '1');
      if (live) localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      else { localStorage.setItem('valence.catalog.127.0.0.1', JSON.stringify({ etag, bytes })); localStorage.setItem('shell_host', '127.0.0.1'); }
      for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* none */ }
  }, [cat.etag, toHex(cat.bytes), LIVE, SIM_PORT, prefs]);
  if (hub) await ctx.routeWebSocket(/:82\//, hub.route);
  const page = await ctx.newPage();
  if (onPage) onPage(page);
  const errors = [];
  page.on('pageerror', (e) => { if (!/stub: /.test(String(e))) errors.push(String(e)); });
  await page.goto(PAGE + '/');
  const up = await page.waitForSelector('nav.rail [role=tab]', { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  return { ctx, page, up, errors };
}

/** Finds the card: home first, then each category page. */
async function toCard(page, sel = 'main.pane .fsp') {
  for (let pass = 0; pass < 6; pass++) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    for (const id of await page.$$eval('[role=tab][data-tab-id]', (els) => [...new Set(els.map((e) => e.dataset.tabId))])) {
      await page.click('[data-tab-id="' + id + '"]').catch(() => {});
      await page.waitForTimeout(150);
      if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

const C = 'main.pane .fsp';
const statusText = (page) => page.locator(C + ' > .fsp-slot').textContent().then((t) => t.trim());
const playBtn = (page) => page.locator(C + ' .fsp-play');
async function loadClip(page) {
  await page.setInputFiles(C + ' .fsp-src input[type=file]', [
    { name: 'clip.webm', mimeType: 'video/webm', buffer: VIDEO },
    { name: 'clip.funscript', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(SCRIPT)) },
  ]);
  return page.waitForFunction((c) => !document.querySelector(c + ' .fsp-play').disabled, C, { timeout: 5000 }).then(() => true).catch(() => false);
}
const video = (page, fn) => page.locator(C + ' .fsp-stage video').evaluate(fn);
/**
 * Page epoch minus node epoch, ms: the two processes' timeOrigins disagree by
 * a few ms. The tightest of 20 bracketed reads.
 */
async function epochSkew(page) {
  let best = null;
  for (let i = 0; i < 20; i++) {
    const a = performance.timeOrigin + performance.now();
    const p = await page.evaluate(() => performance.timeOrigin + performance.now());
    const b = performance.timeOrigin + performance.now();
    if (!best || b - a < best.rtt) best = { rtt: b - a, skew: p - (a + b) / 2 };
  }
  return best.skew;
}
/** The probe's segments and clock observations, their instants in node epoch ms. */
const probeSegs = (page, skew) => page.evaluate((k) => (window.__funscriptProbe || []).filter((x) => x.k === 'seg')
  .flatMap((x) => x.list.map((s) => ({ ...s, at: performance.timeOrigin + s.atMs - k }))), skew);
const probeObs = (page, skew) => page.evaluate((k) => (window.__funscriptProbe || []).filter((x) => x.k === 'obs')
  .map((x) => ({ m: x.m, d: performance.timeOrigin + x.d - k })), skew);
/** The hub's schedule: each bundle supersedes what it held from its first start on (RFC-087 item 5). */
function schedule(bundles) {
  let out = [];
  for (const b of bundles) out = [...out.filter((s) => s.exec < b.segs[0].exec), ...b.segs.map((s, i) => ({ ...s, first: i === 0 }))];
  return out;
}
/**
 * A start clipped to now by the host (its duration is no longer its span's):
 * it leads its arrival by the latency alone, net of the page's hub clock
 * error once measured.
 */
let clockErrUs = 0;
const clipped = (s) => s.exec - s.arrival - clockErrUs <= LAT_US + 25000;   // CLOCK re-syncs move the error by a few ms

/** Rects of the card's fixed chrome: every row and every child of a row. */
const chrome = (page) => page.evaluate((c) => {
  const root = document.querySelector(c);
  const o = root.getBoundingClientRect();
  const out = {};
  for (const sel of [':scope > :not(style)', '.fsp-tr > *', '.fsp-src > *', '.fsp-tlbox > *']) {
    root.querySelectorAll(sel).forEach((e, i) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return;
      out[sel + ' ' + (e.className || e.tagName) + '#' + i] = [r.x - o.x, r.y - o.y, r.width, r.height].map((v) => Math.round(v * 2) / 2);
    });
  }
  return out;
}, C);
function sameChrome(a, b) {
  const diff = Object.keys(a).filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return { ok: diff.length === 0 && Object.keys(a).length > 4, diff: diff.map((k) => k + ' ' + a[k] + ' -> ' + b[k]) };
}

/** Display epoch ms of media ms m, from the clock's own observations around m. */
function displayAt(obs, m, rate = 1) {
  let best = null;
  for (const o of obs) if (!best || Math.abs(o.m - m) < Math.abs(best.m - m)) best = o;
  return best && Math.abs(best.m - m) < 200 ? best.d + (m - best.m) / rate : NaN;
}
/** For each asked segment at one rate: its start minus the display time of its knot, ms. */
function intended(asked, obs, rate) {
  const out = [];
  for (const s of asked) {
    const k = knotOf(s.durationMs, rate);
    if (k < 0) continue;
    const d = displayAt(obs, ACTIONS[k - 1].at, rate);
    if (Number.isFinite(d)) out.push(s.at - d);
  }
  return out;
}

const BAD_WORDS = [/\. /, /\bso that\b/i, /\ballows you\b/i, /\bsimply\b/i, /\bjust\b/i, /\bin order to\b/i];
const copyOk = (t) => t.length <= 60 && t.split(/\s+/).filter(Boolean).length <= 8 && !BAD_WORDS.some((b) => b.test(t));

if (!LIVE) {
  console.log('(d) the card on a fake hub');
  const cat = advgenCatalog();
  cat.entries = decodeCatalog(cat.bytes);
  {
    const noseg = advgenCatalog({ drop: ['input.duration'] });
    noseg.entries = decodeCatalog(noseg.bytes);
    const { ctx, page, up } = await open({ cat: noseg, hub: makeHub(noseg) });
    ok('claim: without a segments STREAM no card renders (D1)', up && !(await toCard(page)));
    await ctx.close();
  }

  const hub = makeHub(cat);
  hub.values[CH.config + ':window_min'] = 0;
  hub.values[CH.config + ':window_max'] = 100;
  hub.values[CH.motion + ':pos_10um'] = 80;
  const { ctx, page, up, errors } = await open({ cat, hub, probe: BUSY_PROBE });
  ok('claim: the shell adopted the fixture', up);
  ok('claim: the card renders on the fixture', await toCard(page));
  const stageH = await page.locator(C + ' .fsp-stage').evaluate((e) => Math.round(e.getBoundingClientRect().height));
  ok('claim: the video stage gets real height on its page (at least 120 px)', stageH >= 120, stageH);
  const rects = { empty: await chrome(page) };
  ok('empty: the status reads No scene loaded', (await statusText(page)) === 'No scene loaded', await statusText(page));
  ok('empty: Play is grayed', await playBtn(page).isDisabled());

  ok('load: a local clip and its script enable Play', await loadClip(page));
  await page.waitForTimeout(500);
  rects.ready = await chrome(page);
  ok('idle: nothing is sent before Play', hub.bundles.length === 0, hub.bundles.length);

  // ---- preroll, then play ----
  await playBtn(page).click();
  await page.waitForTimeout(150);
  const pre = hub.bundles[0];
  const preDur = 400 + 1200 * Math.abs(0.8 - 0.15);
  ok('preroll: one segment to the script start, 400 + 1200 x |delta| ms', !!pre && pre.segs.length === 1
    && Math.abs(pre.segs[0].norm - 0.15) < 0.002 && Math.abs(pre.segs[0].dur - preDur) <= 1, pre && pre.segs);
  ok('preroll: Positioning in the status, the video holds', (await statusText(page)) === 'Positioning'
    && await video(page, (v) => v.paused && v.currentTime === 0), await statusText(page));
  rects.preroll = await chrome(page);
  await page.waitForTimeout(preDur + 300);
  ok('preroll: the video starts at its end', await video(page, (v) => !v.paused && v.currentTime > 0.05));
  await page.waitForTimeout(3500);
  rects.playing = await chrome(page);
  if (SHOT) await page.locator(C).screenshot({ path: SHOT });
  if (process.env.FSP_DEBUG) console.log(await page.locator(C).evaluate((e) => [e, e.parentElement, e.parentElement.parentElement, ...e.children]
    .map((x) => x.className + ' ' + JSON.stringify(x.getBoundingClientRect()) + ' ' + getComputedStyle(x).overflow)));

  // ---- timing ----
  const played = hub.segs(1);
  ok('timing: segments flow while playing', played.length > 8, played.length);
  const ahead = played.map((s) => (s.exec - s.arrival) / 1000);
  ok('timing: every start within half the horizon of its arrival', ahead.every((a) => a <= HORIZON_MS / 2 + 2), Math.max(...ahead));
  // The clock corrects by its whole median until its ring fills (clock.js), so
  // the first second may leave a hole; past it the schedule must tile.
  const sched = schedule(hub.bundles.slice(1));
  // A restart (a clock step) cuts over: its first start is clipped to now, inside the previous span.
  const gaps = sched.slice(1).map((s, i) => ({ at: (s.exec - sched[0].exec) / 1000, g: (s.exec - (sched[i].exec + sched[i].dur * 1000)) / 1000,
    cut: s.first && clipped(s) }));
  const settled = gaps.filter((x) => x.at > 1500 && !(x.cut && x.g < 0));
  ok('timing: once the clock settles (1.5 s) starts tile, each within 3 ms of the previous end',
    settled.length > 3 && settled.every((x) => Math.abs(x.g) <= 3), settled.filter((x) => Math.abs(x.g) > 3));
  console.log('  [NOTE] restarts while playing: ' + gaps.filter((x) => x.cut).length);
  console.log('  [NOTE] holes before the clock settles: ' + JSON.stringify(gaps.filter((x) => x.at <= 1500 && Math.abs(x.g) > 3)
    .map((x) => Math.round(x.g * 10) / 10)) + ' ms');
  ok('timing: each segment is sent once', new Set(played.map((s) => Math.round(s.exec / 100))).size === played.length);
  const skew = await epochSkew(page);
  const asked = await probeSegs(page, skew);
  // exec minus asked = the session's CLOCK estimate error (Playwright's routed
  // socket is asymmetric), one constant; the host's own part must not spread.
  const conv = played.filter((s) => !clipped(s)).map((s) => {
    const p = asked.find((x) => Math.abs(x.durationMs - s.dur) <= 1 && Math.abs(x.norm - s.norm) < 0.002 && Math.abs(x.at - s.exec / 1000) < 50);
    return p ? s.exec / 1000 - p.at : NaN;
  }).filter(Number.isFinite);
  const spread = Math.max(...conv) - Math.min(...conv);
  ok('timing: the host converts every start by one offset (spread within 1 ms)', conv.length > 5 && spread <= 1,
    { n: conv.length, spread, clockError: median(conv) });
  ok('timing: the hub clock estimate is within 25 ms (harness CLOCK over a routed socket)', Math.abs(median(conv)) <= 25, median(conv));
  clockErrUs = median(conv) * 1000;
  const obs0 = await probeObs(page, skew);
  const lag0 = intended(asked, obs0, 1);
  ok('sync: the player asks each knot at the instant its frame shows (median within 5 ms)', lag0.length > 5 && Math.abs(median(lag0)) <= 5,
    { n: lag0.length, median: median(lag0) });

  // ---- the second plugin ----
  await page.evaluate(() => { window.__probeSubmit = true; });
  await page.waitForTimeout(300);
  const busyGate = await page.locator('#busy-probe').first().textContent().catch(() => null);
  const busy = await page.evaluate(() => window.__busy);
  ok('gates: a second plugin reads the busy words', busyGate === 'motion input in use by funscript-player', busyGate);
  ok('gates: and its submitSegments is refused with them', !!busy && !busy.ok && busy.reason === 'motion input in use by funscript-player', busy);
  await page.evaluate(() => { window.__probeSubmit = false; });

  // ---- seek ----
  const n0 = hub.bundles.length;
  await video(page, (v) => { v.currentTime = 15; });
  await page.waitForTimeout(1500);
  const after = hub.bundles.slice(n0);
  // A tick may still go out between the seek and its 'seeking' event.
  const hi = after.findIndex((b) => b.segs.length === 1 && b.segs[0].dur <= 200 && clipped(b.segs[0]));
  const hold = after[hi];
  const resumed = after[hi + 1];
  ok('seek: one hold first', !!hold && hold.segs.length === 1 && hold.segs[0].dur <= 200);
  ok('seek: the next bundle starts at now (clipped to the earliest start)', !!resumed && clipped(resumed.segs[0]),
    resumed && (resumed.segs[0].exec - resumed.arrival) / 1000);
  const later = after.slice(hi + 1).flatMap((b) => b.segs).filter((s) => !clipped(s));
  ok('seek: its knots lie past 15 s', later.length > 2 && later.every((s) => ACTIONS[knotOf(s.dur) - 1]?.at >= 14000));

  // ---- offset ----
  const asked1 = (await probeSegs(page, skew)).length;
  const obs1 = (await probeObs(page, skew)).length;
  const off = page.locator(C + ' .fsp-off input');
  await off.fill('50');
  await off.press('Enter');
  await off.dispatchEvent('change');
  await page.waitForTimeout(4000);
  const lag50 = intended((await probeSegs(page, skew)).slice(asked1), (await probeObs(page, skew)).slice(obs1), 1);
  ok('offset: +50 moves every start 50 ms later (median within 5 ms)', lag50.length > 5 && Math.abs(median(lag50) - median(lag0) - 50) <= 5,
    { before: median(lag0), after: median(lag50) });
  await off.fill('0');
  await off.dispatchEvent('change');

  // ---- rate ----
  const n2 = hub.bundles.length;
  await video(page, (v) => { v.playbackRate = 1.5; });
  await page.waitForTimeout(2500);
  // ratechange sends one hold, then the restart; a segment sent before the event fired is superseded.
  const rb = hub.bundles.slice(n2);
  const h = rb.findIndex((b) => b.segs.length === 1 && b.segs[0].dur <= 200);
  const fast = rb.slice(h + 1).flatMap((b) => b.segs.filter((x, i) => !(i === 0 && clipped(x))));
  ok('rate: 1.5 divides every duration', fast.length > 3 && fast.every((s) => knotOf(s.dur, 1.5) > 0),
    fast.filter((s) => knotOf(s.dur, 1.5) < 0).map((s) => s.dur));
  await video(page, (v) => { v.playbackRate = 1; });
  await page.waitForTimeout(800);

  // ---- pause ----
  const n3 = hub.bundles.length;
  await playBtn(page).click();
  await page.waitForTimeout(1200);
  const stops = hub.bundles.slice(n3);
  ok('pause: exactly one hold, then silence', stops.length === 1 && stops[0].segs.length === 1 && stops[0].segs[0].dur <= 200,
    stops.map((b) => b.segs.map((s) => s.dur)));
  ok('pause: the video is paused, Play offered', await video(page, (v) => v.paused) && (await playBtn(page).textContent()) === 'Play');
  rects.paused = await chrome(page);

  // ---- latch ----
  hub.set(CH.motion, 'pos_10um', 15);   // at the script: no preroll
  await playBtn(page).click();
  await page.waitForTimeout(1500);
  ok('latch: playing again', await video(page, (v) => !v.paused));
  const n4 = hub.bundles.length;
  const t0 = Date.now(), latchedAt = hubUs();
  hub.setLatch(PAUSE_BIT);
  const pausedIn = await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 2000, polling: 5 })
    .then(() => Date.now() - t0).catch(() => Infinity);
  ok('latch: a pushed PAUSE pauses the video within 100 ms', pausedIn <= 100, pausedIn);
  ok('latch: the latch words in the status', (await statusText(page)) === 'paused, resume to continue', await statusText(page));
  await page.waitForTimeout(800);
  const late = hub.bundles.slice(n4).filter((b) => b.arrival - latchedAt > 60000);
  ok('latch: nothing is sent once the latch is seen (60 ms for it to arrive)', late.length === 0, late.length);
  rects.held = await chrome(page);
  hub.setLatch(0);
  await page.waitForTimeout(1000);
  ok('latch: clearing it plays nothing, Play is offered', await video(page, (v) => v.paused) && !(await playBtn(page).isDisabled()));

  // ---- the generator gate ----
  hub.set(CH.advgen, 'running', 1);
  await page.waitForTimeout(400);
  ok('gates: advgen.running grays Play with its words', await playBtn(page).isDisabled()
    && (await statusText(page)) === 'stop the pattern first', await statusText(page));
  rects.gated = await chrome(page);
  hub.set(CH.advgen, 'running', 0);
  await page.waitForTimeout(400);

  // ---- a hub refusal: SOURCE_CONFLICT on the segments STREAM (a generator the gate did not see) ----
  hub.nackStream = NACK.SOURCE_CONFLICT;
  const nRef = hub.bundles.length;
  await playBtn(page).click();
  const refused = await page.waitForFunction((c) => /SOURCE_CONFLICT/.test(document.querySelector(c + ' > .fsp-slot').textContent), C, { timeout: 4000 })
    .then(() => true).catch(() => false);
  ok('refusal: a SOURCE_CONFLICT NACK shows its name in the status slot', refused, await statusText(page));
  ok('refusal: the video pauses and Play is offered again', await video(page, (v) => v.paused) && !(await playBtn(page).isDisabled()));
  await page.waitForTimeout(300);
  const nAfter = hub.bundles.length;
  await page.waitForTimeout(600);
  ok('refusal: nothing more is sent after it', hub.bundles.length === nAfter && nAfter > nRef, [nRef, nAfter, hub.bundles.length]);
  rects.refused = await chrome(page);
  if (SHOT) await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'refusal.png') });
  hub.nackStream = 0;

  // ---- layout ----
  for (const s of ['ready', 'preroll', 'playing', 'paused', 'held', 'gated', 'refused']) {
    const r = sameChrome(rects.empty, rects[s]);
    ok('layout: chrome rects in ' + s + ' match empty', r.ok, r.diff.slice(0, 4));
  }
  const red = await page.evaluate((c) => {
    const probe = document.createElement('i');
    for (const t of ['--bad', '--estop']) probe.style.color = 'var(' + t + ')';
    document.body.append(probe);
    const bad = ['--bad', '--estop'].map((t) => { probe.style.color = 'var(' + t + ')'; return getComputedStyle(probe).color; });
    probe.remove();
    return [...document.querySelectorAll(c + ' *')].filter((e) => {
      const cs = getComputedStyle(e);
      return [cs.color, cs.borderTopColor, cs.backgroundColor, cs.fill, cs.stroke].some((x) => bad.includes(x));
    }).length;
  }, C);
  ok('layout: nothing in the card wears --bad or --estop (law 13)', red === 0, red);
  const texts = await page.evaluate((c) => {
    const root = document.querySelector(c);
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (n.parentElement.tagName !== 'STYLE' && n.textContent.trim()) out.push(n.textContent.trim());
    for (const e of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
      for (const a of ['title', 'aria-label', 'placeholder']) if (e.getAttribute(a)) out.push(e.getAttribute(a));
    }
    return out;
  }, C);
  const badCopy = texts.filter((t) => !copyOk(t) && !/^[\d:.\s/]+$/.test(t));
  ok('copy: every rendered string is one short fragment (docs/COPY.md)', badCopy.length === 0, badCopy);
  const tables = Object.entries(mods).filter(([, m]) => m.COPY).flatMap(([p, m]) => Object.values(m.COPY).map((t) => [p.replace(P, ''), t]));
  const badTables = tables.filter(([, t]) => !copyOk(t.trim()));
  ok('copy: every COPY table entry is one short fragment', tables.length > 20 && badTables.length === 0, badTables);

  // ---- glance ----
  await page.locator(C).evaluate((e) => { e.parentElement.style.width = '220px'; });
  await page.waitForTimeout(300);
  const glance = await page.locator(C).evaluate((e) => ({
    comp: e.dataset.comp, video: !!e.querySelector('.fsp-stage video'),
    meter: getComputedStyle(e.querySelector('.fsp-meter')).display !== 'none',
    play: e.querySelector('.fsp-play').getBoundingClientRect().width > 0, w: e.getBoundingClientRect().width }));
  ok('glance: at 220 px the card composes glance, meter and Play shown, the video still mounted',
    glance.comp === 'glance' && glance.video && glance.meter && glance.play, glance);
  if (SHOT) await page.locator(C).screenshot({ path: SHOT.replace(/[^/\\]+$/, 'glance.png') });
  await page.locator(C).evaluate((e) => { e.parentElement.style.width = ''; });
  ok('no page error', errors.length === 0, errors.slice(0, 3));
  clearInterval(hub.timer);
  await ctx.close();

  // ---- targets on a coarse pointer; a 1000 ms horizon ----
  {
    const h2 = makeHub(cat, { horizonMs: 1000 });
    h2.values[CH.config + ':window_min'] = 0;
    h2.values[CH.config + ':window_max'] = 100;
    h2.values[CH.motion + ':pos_10um'] = 15;
    const { ctx: c2, page: p2 } = await open({ cat, hub: h2, coarse: true });
    await toCard(p2);
    await loadClip(p2);
    const small = await p2.evaluate((c) => [...document.querySelectorAll(c + ' :is(button, input:not([type=file]), select, [role=slider])')]
      .map((e) => [e.className || e.getAttribute('aria-label') || e.tagName, e.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.width < 39.5 || r.height < 39.5)).map(([n, r]) => n + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)), C);
    ok('targets: every control is at least 40 px under a coarse pointer (law 12)', small.length === 0, small);
    await p2.locator(C + ' .fsp-play').click();
    await p2.waitForTimeout(3000);
    await p2.locator(C + ' .fsp-play').click();
    const ahead = h2.segs().filter((x) => !clipped(x)).map((x) => (x.exec - x.arrival) / 1000);
    ok('horizon 1000: every start within 500 ms of its arrival, the lead widened past 250',
      ahead.length > 3 && ahead.every((a) => a <= 502) && Math.max(...ahead) > 250, { n: ahead.length, max: Math.max(...ahead) });
    clearInterval(h2.timer);
    await c2.close();
  }

  // ---- stash ----
  console.log('(e) Stash');
  {
    const stash = await startFakeStash({ key: KEY, video: VIDEO });
    const h3 = makeHub(cat);
    const { ctx: c3, page: p3 } = await open({ cat, hub: h3 });
    await toCard(p3);
    const libTab = p3.locator(C + ' .fsp-tab', { hasText: 'Library' });
    if (await libTab.isVisible()) await libTab.click();
    const url = p3.locator(C + ' .fsp-connect input[type=url]');
    ok('stash: with no base the connect card fills the library', await url.isVisible().catch(() => false));
    await url.fill(stash.url);
    await p3.locator(C + ' .fsp-connect input[type=password]').fill(KEY);
    await p3.locator(C + ' .fsp-connect button', { hasText: 'Save' }).click();
    const tiles = await p3.waitForSelector(C + ' .fsp-tile img', { timeout: 5000 }).then(() => true).catch(() => false);
    ok('stash: Save shows interactive tiles', tiles);
    const src = await p3.locator(C + ' .fsp-tile img').first().getAttribute('src').catch(() => '');
    ok('stash: tile screenshots are rebased and keyed with apikey', src.startsWith(stash.url) && src.includes('apikey=' + KEY), src);
    const gql = stash.seen.find((r) => r.path.startsWith('/graphql'));
    ok('stash: GraphQL carries the ApiKey header', !!gql && gql.headers.apikey === KEY);
    await p3.locator(C + ' .fsp-tile').first().click();
    await p3.waitForTimeout(800);
    const fs = stash.seen.find((r) => /\/scene\/\d+\/funscript/.test(r.path));
    ok('stash: a pick fetches the script with the ApiKey header', !!fs && fs.headers.apikey === KEY, fs && fs.headers);
    const vsrc = await p3.locator(C + ' .fsp-stage video').getAttribute('src');
    ok('stash: the video streams from the rebased URL with apikey', !!vsrc && vsrc.startsWith(stash.url) && vsrc.includes('apikey=' + KEY), vsrc);
    ok('stash: the key never sits in the backup prefix', !(await p3.evaluate(() => Object.keys(localStorage)
      .some((k) => k.startsWith('phosphor.') && localStorage.getItem(k).includes('test-key-1')))));
    clearInterval(h3.timer);
    await c3.close();
    await stash.close();
  }
}

if (LIVE) {
  console.log('(f) live: valencesim on ' + SIM_PORT + ' (http ' + SIM_HTTP + ')');
  const { createSession } = await import('../../Valence/clients/js/index.js');
  const sess = createSession({ host: '127.0.0.1', port: SIM_PORT, clientKind: 'webui', clientName: 'fsp probe',
    autoReconnect: false, catalogStore: { load: () => null, save() {}, clear() {} } });
  const live = await new Promise((res) => { setTimeout(() => res(false), 5000); sess.on('live', () => res(true)); sess.connect(); });
  for (let i = 0; i < 50 && live && !sess.catalog; i++) await sleep(100);
  const segEntry = live && (sess.catalog || []).find((e) => e.dirName === 'c2h' && (e.layout || []).some((f) => f.role === 'input.duration'));
  const seg = !!segEntry;
  try { sess.close(); } catch (e) { /* gone */ }
  if (!seg) { console.log('SKIP: no valencesim with a segments STREAM on 127.0.0.1:' + SIM_PORT); process.exit(0); }

  const frames = { bundles: 0, nacks: [] };
  const { ctx, page, up, errors } = await open({ onPage: (page) => page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      for (const { header } of parseFrames(new Uint8Array(payload))) if (header.type === FRAME.STREAM) frames.bundles++;
    });
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      for (const { header, payload: p } of parseFrames(new Uint8Array(payload))) {
        if (header.type === FRAME.NACK && header.channel === segEntry.id) frames.nacks.push(cbDecodeFull(p).get(K.code));
      }
    });
  }) });
  ok('live: the shell adopted the sim', up);
  ok('live: the card renders', await toCard(page));
  ok('live: the clip loads', await loadClip(page));
  await playBtn(page).click();
  await page.waitForTimeout(2500);
  const plan = async () => page.evaluate(() => document.querySelector('.plan-strip')?.textContent || '');
  const p1 = await plan();
  await page.waitForTimeout(5500);
  const p2 = await plan();
  ok('live: segments bundles flow', frames.bundles > 8, frames.bundles);
  ok('live: no NACK on the segments STREAM', frames.nacks.length === 0, frames.nacks);
  ok('live: the plan strip moves', !!p1 && p1 !== p2, [p1, p2]);
  const pauseBtn = page.locator('.topstrip .btn-pause');
  await pauseBtn.click();
  const paused = await page.waitForFunction((c) => document.querySelector(c + ' .fsp-stage video').paused, C, { timeout: 2000 })
    .then(() => true).catch(() => false);
  ok('live: the strip Pause pauses the video', paused, await statusText(page));
  ok('live: the strip offers Resume', /Resume/.test(await pauseBtn.textContent()), await pauseBtn.textContent());
  await pauseBtn.click();
  await page.waitForTimeout(1500);
  ok('live: Resume leaves it paused', await video(page, (v) => v.paused));
  // An Advanced start (the pattern card's Start) grays Play with the generator words.
  const run = page.locator('main.pane .ap .ap-run:visible');
  const toAp = async () => { if (await run.count()) return true; return toCard(page, 'main.pane .ap'); };
  if (await toAp()) {
    const adv = page.locator('main.pane .ap-tabs button', { hasText: 'Advanced' });
    if (await adv.count()) await adv.click();
    await run.click();
    await page.waitForTimeout(800);
    await toCard(page);
    await page.waitForTimeout(400);
    ok('live: an Advanced start grays Play', await playBtn(page).isDisabled() && (await statusText(page)) === 'stop the pattern first',
      await statusText(page));
    await toCard(page, 'main.pane .ap');
    if (await adv.count()) await adv.click();
    await run.click();
    await page.waitForTimeout(500);
  } else ok('live: the pattern card renders', false);
  ok('live: no page error', errors.length === 0, errors.slice(0, 3));
  if (SHOT) await page.locator(C).screenshot({ path: SHOT });
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
