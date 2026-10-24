/**
 * stamp.js -- the footer stamp menu's two texts (ph-75yn): the version lines
 * and the diagnostics object. Pure: the caller (ui/stampmenu.js) hands in a
 * plain snapshot of the app.
 *
 * Constraints:
 * - The diagnostics builder is an allowlist: it reads only the paths below
 *   from the snapshot, never spreads or filters a larger object, and every
 *   string must match its shape or goes null. A new field is a new line here
 *   and a new assertion in test/stamp.test.mjs.
 * - Never in either text: tokens, session or instance ids, the hub's name,
 *   network names and addresses (the dialed endpoint included).
 * - Absent values read `--` in the lines and null in the object (ground truth:
 *   nothing is invented).
 */

export const SCHEMA = 'phosphor.diagnostics/1';
/** The status slot's words for a copy; TopStrip shows them over a link fault. */
export const STAMP_SAYS = ['Versions copied', 'Diagnostics copied'];

const VER = /^\d{1,4}\.\d{1,4}\.\d{1,4}([+-][0-9A-Za-z.+_-]{1,24})?$/;
const BUILD = /^([0-9a-f]{7,12}|b\d{12})$/;
const SHA = /^[0-9a-f]{7,40}$/;
const WORD = /^[a-z0-9_.-]{1,24}$/;
const PRODUCT = /^[\w .+-]{1,32}$/;
const ENGINE = /^(chromium|webkit|gecko)-\d{1,4}(\.\d{1,4}){0,3}$/;
const ETAG = /^[0-9a-f]{8,32}$/;
const PROTO = /^[\w.-]{1,24}$/;

const str = (re, v) => (typeof v === 'string' && re.test(v) ? v : null);
const num = (v, dp = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
const one = (v) => (v == null ? '--' : v);

/** The stamp's human-readable lines: Phosphor version and build, firmware, the Valence spec version. */
export function versionLines(c) {
  const v = str(VER, c.shell), b = str(BUILD, c.build);
  return [
    'Phosphor ' + (v ? v + ' ' : '') + 'build ' + one(b),
    'Firmware ' + one(str(VER, c.firmware)),
    'Valence v' + one(num(c.proto)) + ' (' + one(str(PROTO, c.subprotocol)) + ')',
  ].join('\n');
}

/** The support object (JSON-ready) from a snapshot; see the constraints above. */
export function diagnostics(c) {
  const h = c.health || {}, l = c.stats || {};
  const area = (a, f) => ({ sev: str(WORD, a && a.sev), ...f(a || {}) });
  return {
    schema: SCHEMA,
    app: {
      version: str(VER, c.shell), build: str(BUILD, c.build), mode: c.mode === 'mini' || c.mode === 'web' ? c.mode : 'app',
      platform: str(WORD, c.platform), engine: str(ENGINE, c.engine),
      neutrino: str(SHA, c.neutrino),
    },
    hub: {
      phase: str(WORD, c.phase), transport: str(WORD, c.transport),
      product: str(PRODUCT, c.product), firmware: str(VER, c.firmware),
      proto_ver: num(c.proto), subprotocol: str(PROTO, c.subprotocol),
      catalog_etag: str(ETAG, c.etag), boot_id: num(c.bootId),
      tier: num(c.tier), deadman_ms: num(c.deadmanMs),
    },
    link: {
      reconnects: num(l.reconnects), state_pushes: num(l.statePushes),
      clock_offset_us: num(l.clockOffsetUs), clock_rtt_us: num(l.clockRttUs),
    },
    health: {
      link: area(h.link, (a) => ({ rtt_ms: num(a.rttMs, 1), reconnects: num(a.reconnects) })),
      device: area(h.device, (a) => ({ fps: num(a.fps), heap_mb: num(a.heapMb, 1), lag_p95_ms: num(a.lagP95Ms, 1) })),
      machine: area(h.machine, (a) => ({ restarts: num(a.restarts), warn_per_min: num(a.warnPerMin) })),
      incidents: (Array.isArray(h.incidents) ? h.incidents : []).slice(0, 20)
        .map((i) => ({ cond: str(WORD, i && i.cond), sev: str(WORD, i && i.sev), count: num(i && i.count) })),
    },
  };
}
