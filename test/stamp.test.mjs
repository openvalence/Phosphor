/**
 * stamp.test.mjs -- the footer stamp menu's texts (src/model/stamp.js, ph-75yn): the version lines, the
 * diagnostics object's shape, and that nothing seeded into the snapshot that the allowlist does not name
 * (tokens, ids, the hub's name, addresses) leaves in either text.
 * Run: node test/stamp.test.mjs
 */
import { diagnostics, versionLines, SCHEMA } from '../src/model/stamp.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const SECRET = ['tok_AbCdEf123', 'sess-48151623', '192.168.1.118', 'bedroom-ossm', 'MyHomeWifi', 'inst-9f3a2c', 'ws://10.0.0.7:82'];
const snap = {
  shell: '0.1.55', build: 'de7d388', mode: undefined, platform: 'windows', engine: 'chromium-141', neutrino: null,
  phase: 'live', transport: 'ws', product: 'Nucleus', firmware: '0.1.50', proto: 1, subprotocol: 'valence.v1',
  etag: 'c19dff891e8d042d', bootId: 7, tier: 2, deadmanMs: 1000,
  stats: { reconnects: 3, statePushes: 12345, clockOffsetUs: -420, clockRttUs: 8123.4, token: SECRET[0], session: SECRET[1] },
  health: {
    link: { sev: 'warn', rttMs: 12.34, reconnects: 3, text: SECRET[2] }, device: { sev: null, fps: 60, heapMb: 84.56, lagP95Ms: 4.04, user: SECRET[3] },
    machine: { sev: null, restarts: 0, warnPerMin: 1, ssid: SECRET[4] },
    incidents: [{ cond: 'freeze', sev: 'act', count: 2, why: SECRET[2], session: SECRET[1] }],
  },
  // Not on the allowlist: must never surface.
  token: SECRET[0], sessionId: SECRET[1], dialed: SECRET[6], hubName: SECRET[3], ssid: SECRET[4], instance_id: SECRET[5], hubIdentity: { instance_id: SECRET[5], hub_name: SECRET[3] },
};

const d = diagnostics(snap);
const text = JSON.stringify(d, null, 2) + '\n' + versionLines(snap);
ok('schema named', d.schema === SCHEMA);
ok('app block', d.app.version === '0.1.55' && d.app.build === 'de7d388' && d.app.mode === 'app' && d.app.platform === 'windows' && d.app.engine === 'chromium-141' && d.app.neutrino === null, d.app);
ok('hub block', d.hub.phase === 'live' && d.hub.transport === 'ws' && d.hub.product === 'Nucleus' && d.hub.firmware === '0.1.50' && d.hub.proto_ver === 1
  && d.hub.subprotocol === 'valence.v1' && d.hub.catalog_etag === 'c19dff891e8d042d' && d.hub.boot_id === 7 && d.hub.tier === 2 && d.hub.deadman_ms === 1000, d.hub);
ok('link block', d.link.reconnects === 3 && d.link.state_pushes === 12345 && d.link.clock_offset_us === -420 && d.link.clock_rtt_us === 8123, d.link);
ok('health readouts', d.health.link.rtt_ms === 12.3 && d.health.device.heap_mb === 84.6 && d.health.machine.warn_per_min === 1
  && d.health.incidents.length === 1 && d.health.incidents[0].cond === 'freeze' && d.health.incidents[0].count === 2, d.health);
ok('key set is exactly the allowlist', JSON.stringify(Object.keys(d)) === '["schema","app","hub","link","health"]'
  && JSON.stringify(Object.keys(d.hub)) === '["phase","transport","product","firmware","proto_ver","subprotocol","catalog_etag","boot_id","tier","deadman_ms"]'
  && JSON.stringify(Object.keys(d.health.incidents[0])) === '["cond","sev","count"]');
ok('it is JSON', JSON.parse(JSON.stringify(d)).hub.tier === 2);
for (const s of SECRET) ok('never in the texts: ' + s, !text.includes(s));
ok('no key named for a secret', !/"(token|session\w*|instance_id|dialed|ssid|hub_name|address)"/i.test(JSON.stringify(d)))

ok('lines: version, firmware, spec', versionLines(snap) === 'Phosphor 0.1.55 build de7d388\nFirmware 0.1.50\nValence v1 (valence.v1)', versionLines(snap));

// Shapes: a string outside its shape goes null, never through.
const bad = diagnostics({ ...snap, shell: 'v1 ' + SECRET[2], build: SECRET[3], engine: SECRET[4], etag: SECRET[0], platform: SECRET[6], firmware: '1.0.0 ' + SECRET[1], product: SECRET[6] });
ok('off-shape strings go null', bad.app.version === null && bad.app.build === null && bad.app.engine === null && bad.hub.catalog_etag === null && bad.app.platform === null
  && bad.hub.firmware === null && bad.hub.product === null, bad);
ok('off-shape strings never reach the text', !JSON.stringify(bad).match(/192\.168|bedroom|MyHomeWifi|tok_|sess-|ws:\/\//));

// Nothing known yet: `--` in the lines, null in the object.
const none = { build: 'b202610230000', mode: 'web', phase: 'idle' };
ok('idle lines read --', versionLines(none) === 'Phosphor build b202610230000\nFirmware --\nValence v-- (--)', versionLines(none));
const dn = diagnostics(none);
ok('idle object is nulls, mode kept', dn.app.mode === 'web' && dn.hub.firmware === null && dn.hub.catalog_etag === null && dn.hub.transport === null && dn.link.reconnects === null
  && dn.health.incidents.length === 0 && dn.health.link.sev === null);
ok('mini mode kept', diagnostics({ mode: 'mini' }).app.mode === 'mini');

console.log(fails ? 'FAIL: ' + fails : 'stamp: all pass');
process.exit(fails ? 1 : 0);
