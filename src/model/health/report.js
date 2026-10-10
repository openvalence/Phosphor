/**
 * report.js -- the health report (ph-9t5l.1): one field table feeds both the
 * review screen's rows and the bundle builder, so no field can leave without
 * a row; the issue URL and its budget; Save report; the Sent reports store;
 * the issue lookup.
 *
 * Constraints:
 * - The builder is an allowlist: it walks FIELDS and reads only those paths
 *   from its source, never filters a larger object. Every string has a shape
 *   (`re`) or a fixed set (`values`) and goes null outside it; the only free
 *   strings are the three version strings, and their shapes refuse an
 *   address, a date, a position or a name.
 * - An `opt` field (the media block, the dropped-frame history) is left out
 *   while it has no value, so a report without a video keeps the /1 shape.
 * - No clock time or date in a bundle: every time counts from the incident.
 *   `sentAt` lives in the local store only.
 * - Phosphor sends nothing: Send opens a prefilled public issue the user
 *   submits under their own GitHub account (operator ruling 2026-10-09).
 * - Every localStorage access is wrapped: private mode loses the list, never
 *   the page.
 */

import { CONDITIONS, quantile } from './core.js';

export const REPO = 'openvalence/Phosphor';
export const SCHEMA = 'phosphor.health-report/1';
/** GitHub refuses much longer new-issue URLs; the encoded query stays under this. */
export const URL_BUDGET = 7500;
const ID_RE = /^[A-Z2-7]{8}$/;
/** x.y.z with an optional suffix; this app's build may also be g<short git sha> (health.svelte.js context()) or b<yyyymmddhhmm> (vite.config.js). */
const SEMVER = '\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}([+-][0-9A-Za-z.+_-]{1,24})?';
const FIRMWARE_RE = new RegExp('^' + SEMVER + '$');
const VERSION_RE = new RegExp('^(' + SEMVER + '|g[0-9a-f]{7,12}|b\\d{12})$');
const ENGINE_RE = /^(chromium|webkit|gecko)-\d{1,4}(\.\d{1,4}){0,3}$/;
const FILE_RE = /^diag-report-[A-Z2-7]{8}\.json$/;
const CONDITION_VALUES = ['cutout', ...Object.keys(CONDITIONS).filter((k) => !k.startsWith('cutout-'))];
const STORE = 'phosphor.reports.v1';

const ms = 'ms', n = 'num', s = 'str', b = 'bool';
const SERIES = (unit) => ({ type: 'series', unit });

/**
 * Every field a bundle may carry, in order: path, plain name, what it is, why
 * it helps, type (num | int | str | bool | enum | series | events); opt: left
 * out while it has no value.
 */
export const FIELDS = [
  { path: 'schema', name: 'Report format', what: 'The layout version of this report', why: 'Lets a reader decode it', type: 'enum', values: [SCHEMA] },
  { path: 'id', name: 'Report id', what: 'A random code made for this report', why: 'Finds the issue again to take it down', type: s, re: ID_RE },
  { path: 'app.version', name: 'Phosphor version', what: 'The build of Phosphor you run', why: 'Ties the problem to the code', type: s, re: VERSION_RE },
  { path: 'app.platform', name: 'System', what: 'Windows, macOS, Linux, Android or a browser', why: 'Some problems only happen on one system', type: 'enum', values: ['windows', 'macos', 'linux', 'android', 'ios', 'web'] },
  { path: 'app.engine', name: 'Web engine', what: 'The engine that draws Phosphor, and its version', why: 'Timing and memory differ by engine', type: s, re: ENGINE_RE },
  { path: 'app.shell', name: 'Desktop app', what: 'Whether this is the installed app or a web page', why: 'The app and the page run differently', type: b },
  { path: 'machine.firmware', name: 'Machine firmware', what: "The machine's firmware version", why: 'Ties a machine-side cause to its code', type: s, re: FIRMWARE_RE },
  { path: 'machine.protocol', name: "This app's protocol version", what: 'The Valence protocol version Phosphor speaks', why: 'Rules out a version mismatch', type: 'int' },
  { path: 'machine.transport', name: 'Connection', what: 'WiFi (WebSocket) or Bluetooth', why: 'The two links fail differently', type: 'enum', values: ['ws', 'ble'] },
  { path: 'incident.condition', name: 'Problem', what: 'Which health condition this is', why: 'The starting point for the reader', type: 'enum', values: CONDITION_VALUES },
  { path: 'incident.cause', name: 'Cause', what: 'Where the delay came from, as Phosphor judged it', why: 'Points at this device, the WiFi or the machine', type: 'enum', values: ['client', 'network', 'hub', 'unknown'] },
  { path: 'incident.confidence', name: 'Confidence', what: 'Whether the cause was measured or inferred', why: 'An inferred cause needs a second look', type: 'enum', values: ['decisive', 'likely'] },
  { path: 'incident.severity', name: 'Severity', what: 'How serious Phosphor rated it', why: 'Sorts reports', type: 'enum', values: ['info', 'warn', 'act'] },
  { path: 'incident.count', name: 'Times', what: 'How many times it happened in this incident', why: 'Once is a hiccup, often is a pattern', type: 'int' },
  { path: 'incident.lasted_ms', name: 'Duration', what: 'How long it lasted in total', why: 'Sizes the problem', type: 'int', unit: ms },
  { path: 'measure.metric', name: 'What grew', what: 'The reading that raised a growth problem', why: 'Says what to look at', type: 'enum', values: ['heap_floor_mb', 'workers'] },
  { path: 'measure.baseline', name: 'Started at', what: 'That reading where the growth began', why: 'Sizes the growth', type: n },
  { path: 'measure.current', name: 'Now at', what: 'That reading when the problem was raised or last updated', why: 'Sizes the growth', type: n },
  { path: 'measure.window_ms', name: 'Over', what: 'How long it grew', why: 'A fast leak and a slow one differ', type: 'int', unit: ms },
  { path: 'measure.slope_per_min', name: 'Growth rate', what: 'How much it grew per minute', why: 'Points at what leaks', type: n },
  { path: 'settings.stream_buffer_ms', name: 'Look-ahead window', what: 'How far ahead the machine accepts moves', why: 'A longer window rides out delays', type: 'int', unit: ms },
  { path: 'settings.schedule_latency_us', name: 'Machine planning time', what: 'How long the machine says it needs to plan a move', why: 'Sets the deadline moves must meet', type: 'int', unit: 'us' },
  { path: 'settings.lookahead_ms', name: 'Send-ahead time', what: 'How far ahead Phosphor sends moves', why: 'The margin against delays', type: 'int', unit: ms },
  { path: 'evidence.from_ms', name: 'Measured from', what: 'Where the least, typical and worst values below start, from the problem', why: 'Every one is over this same window', type: 'int', unit: ms },
  { path: 'evidence.to_ms', name: 'Measured to', what: 'Where they end, from the problem', why: 'Every one is over this same window', type: 'int', unit: ms },
  { path: 'evidence.lead_send_ms_min', name: 'Sent ahead (least)', what: 'The least time a move left before it was due, in the window', why: 'Low means this device sent late', type: n, unit: ms },
  { path: 'evidence.arrival_lead_ms_min', name: 'Arrived ahead (least)', what: 'The least time a move reached the machine before it was due, in the window', why: 'Low means the network delivered late', type: n, unit: ms },
  { path: 'evidence.rtt_ms_p50', name: 'Round trip (typical)', what: 'The median of the per-second slowest round trips in the window', why: 'High means a slow link', type: n, unit: ms },
  { path: 'evidence.rtt_ms_max', name: 'Round trip (worst)', what: 'The slowest round trip in the window', why: 'Spikes point at WiFi', type: n, unit: ms },
  { path: 'evidence.owd_up_ms_max', name: 'Delay to the machine (worst)', what: 'The slowest one-way trip from this device to the machine, in the window', why: 'The direction moves travel', type: n, unit: ms },
  { path: 'evidence.downlink_gap_ms_max', name: 'Update gap (longest)', what: 'The longest pause in position updates from the machine, in the window', why: 'Gaps point at WiFi', type: n, unit: ms },
  { path: 'evidence.loop_lag_ms_max', name: 'This device stalled (longest)', what: 'The longest time Phosphor waited on this computer, in the window', why: 'High means this device was busy', type: n, unit: ms },
  { path: 'evidence.backlog_bytes_max', name: 'Data waiting (most)', what: 'The most data waiting for the network to take it, in the window', why: 'A jammed link shows here', type: 'int', unit: 'bytes' },
  { path: 'evidence.rssi_dbm', name: 'Machine signal', what: 'How strongly the machine hears the router', why: 'A weak signal causes delays', type: n, unit: 'dBm' },
  { path: 'evidence.wifi_drops', name: 'Machine WiFi drops', what: 'How often the machine lost WiFi', why: 'Drops pause everything', type: 'int' },
  { path: 'evidence.late_plans_per_min', name: 'Late plans', what: 'Moves the machine planned late, per minute', why: 'Points at the machine', type: n },
  { path: 'evidence.reconnects', name: 'Reconnects', what: 'How often the link to the machine broke this session', why: 'Drops point at the network', type: 'int' },
  { path: 'evidence.heap_mb', name: 'Memory in use', what: "Phosphor's memory use on this device at the problem", why: 'One reading; the history shows the trend', type: n, unit: 'MB' },
  { path: 'evidence.fps', name: 'Frame rate', what: 'Screen updates per second at the problem', why: 'Low means this device was busy', type: n },
  { path: 'media.width', name: 'Video width', what: "The playing video's width", why: 'Decoding work grows with size', type: 'int', unit: 'px', opt: true },
  { path: 'media.height', name: 'Video height', what: "The playing video's height", why: 'Decoding work grows with size', type: 'int', unit: 'px', opt: true },
  { path: 'media.video_fps', name: 'Video frame rate', what: 'Video frames per second, its decoded frames over its play time', why: 'A fast video needs a fast decoder and screen', type: n, unit: 'fps', opt: true },
  { path: 'media.display_hz', name: 'Screen refresh', what: 'How often this screen draws, measured here', why: 'A screen slower than the video skips frames by design', type: n, unit: 'Hz', opt: true },
  { path: 'media.rate', name: 'Playback speed', what: 'How fast the video played', why: 'Speed multiplies the frames to show', type: n, opt: true },
  { path: 'media.window_ms', name: 'Video measured over', what: 'Play time the frame counts below cover, in the last 30 s', why: 'Sizes the counts', type: 'int', unit: ms, opt: true },
  { path: 'media.frames_total', name: 'Video frames', what: 'Frames decoded in that time', why: 'With the screen refresh, what could be shown', type: 'int', opt: true },
  { path: 'media.frames_dropped', name: 'Frames dropped', what: "Frames the engine dropped in that time, the screen's own skips included", why: 'Drops past the skips are stutter', type: 'int', opt: true },
  { path: 'media.hdr', name: 'HDR screen', what: 'Whether the screen reports high dynamic range', why: 'HDR video takes another drawing path', type: b, opt: true },
  { path: 'media.fullscreen', name: 'Fullscreen', what: "Whether the video's page was fullscreen", why: "Fullscreen video can bypass the page's drawing", type: b, opt: true },
  { path: 'media.analyzer', name: 'Analyzer open', what: "Whether the player's analyzer was open", why: 'It keeps drawing while the video plays', type: b, opt: true },
  { path: 'window.from_ms', name: 'Window start', what: 'Where the history below starts, from the problem', why: 'Places the series in time', type: 'int', unit: ms },
  { path: 'window.to_ms', name: 'Window end', what: 'Where the history ends, from the problem', why: 'Places the series in time', type: 'int', unit: ms },
  { path: 'window.step_ms', name: 'Window step', what: 'Time between history points', why: 'Places the series in time', type: 'int', unit: ms },
  { path: 'window.series.rtt_ms', name: 'Round trip history', what: 'Round trip times around the problem', why: 'Shows a slow link building up', ...SERIES(ms) },
  { path: 'window.series.lead_send_ms', name: 'Sent ahead history', what: 'How far ahead moves left', why: 'Shows this device falling behind', ...SERIES(ms) },
  { path: 'window.series.arrival_lead_ms', name: 'Arrived ahead history', what: 'How far ahead moves reached the machine', why: 'Shows the network delivering late', ...SERIES(ms) },
  { path: 'window.series.downlink_gap_ms', name: 'Update gap history', what: 'Pauses in position updates', why: 'Shows WiFi gaps', ...SERIES(ms) },
  { path: 'window.series.loop_lag_ms', name: 'Stall history', what: 'How long Phosphor waited on this computer', why: 'Shows this device busy', ...SERIES(ms) },
  { path: 'window.series.fps', name: 'Frame rate history', what: 'Screen updates per second', why: 'Shows this device busy', ...SERIES('fps') },
  { path: 'window.series.heap_mb', name: 'Memory history', what: "Phosphor's memory use", why: 'Shows a leak', ...SERIES('MB') },
  { path: 'window.series.rssi_dbm', name: 'Signal history', what: "The machine's WiFi signal", why: 'Shows a weak signal', ...SERIES('dBm') },
  { path: 'window.series.late_plans', name: 'Late plan history', what: 'Moves the machine planned late', why: 'Shows the machine falling behind', ...SERIES('') },
  { path: 'window.series.video_dropped', name: 'Dropped frame history', what: "Video frames dropped past the screen's own skips", why: 'Tells a steady stutter from one hitch', ...SERIES(''), opt: true },
  { path: 'window.fine.from_ms', name: 'Close-up start', what: 'Where the close-up starts, from the problem', why: 'Places the close-up in time', type: 'int', unit: ms },
  { path: 'window.fine.to_ms', name: 'Close-up end', what: 'Where the close-up ends', why: 'Places the close-up in time', type: 'int', unit: ms },
  { path: 'window.fine.step_ms', name: 'Close-up step', what: 'Time between close-up points', why: 'Places the close-up in time', type: 'int', unit: ms },
  { path: 'window.fine.series.lead_send_ms', name: 'Sent ahead close-up', what: 'How far ahead moves left, 10 times a second', why: 'Pins a late send', ...SERIES(ms) },
  { path: 'window.fine.series.owd_up_ms', name: 'Delay close-up', what: 'One-way delay to the machine, 10 times a second', why: 'Pins a WiFi delay', ...SERIES(ms) },
  { path: 'window.fine.series.downlink_gap_ms', name: 'Update gap close-up', what: 'Pauses in updates, 10 times a second', why: 'Pins a WiFi gap', ...SERIES(ms) },
  { path: 'events', name: 'Events', what: 'Other problems near this one, with their time and cause', why: 'Shows what happened together', type: 'events' },
  { path: 'hub_log.warn', name: 'Machine warnings', what: 'Warning lines in the machine log around the problem (count only)', why: 'Points at the machine', type: 'int' },
  { path: 'hub_log.error', name: 'Machine errors', what: 'Error lines in the machine log around the problem (count only)', why: 'Points at the machine', type: 'int' },
  { path: 'attachment', name: 'Attached file', what: 'The file name holding the full report, when it was too long for the link', why: 'Tells the reader to look for it', type: s, re: FILE_RE },
];

/** What a report never holds, said on the review screen. */
export const NOT_INCLUDED = ['Script and video names', 'Positions and targets', 'Times of day and dates', 'The machine name',
  'Addresses', 'Session and device ids', 'Tokens', 'Log text'];

export const PRIVACY_SHORT = 'Public issue under your GitHub account';
export const PRIVACY = 'Send report opens a new public issue on github.com/openvalence/Phosphor in your browser, filled in with the report shown above. '
  + 'Nothing is sent until you press Submit there. It is posted under your own GitHub account, so anyone can read it and see who posted it, '
  + 'and GitHub shows when. The report holds no script or video names, no positions and no times of day: its times count from the moment of the problem. '
  + 'To take it down, comment /remove on the issue and it is deleted; only you, its author, can do that. '
  + 'No GitHub account? Save report keeps it as a file you can share any way you like.';

const round = (v, dp = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
const EVENT_KINDS = new Set(CONDITION_VALUES);

function clean(f, v) {
  switch (f.type) {
    case 'str': return typeof v === 'string' && f.re.test(v) ? v : null;
    case 'enum': return f.values.includes(v) ? v : null;
    case 'bool': return typeof v === 'boolean' ? v : null;
    case 'int': return round(v);
    case 'num': return round(v, 1);
    case 'series': return Array.isArray(v) ? v.slice(0, 120).map((x) => round(x, 1)) : [];
    case 'events': return Array.isArray(v) ? v.slice(0, 40).map((e) => ({
      t_ms: round(e && e.t_ms), kind: EVENT_KINDS.has(e && e.kind) ? e.kind : null,
      cause: ['client', 'network', 'hub', 'unknown'].includes(e && e.cause) ? e.cause : null })) : [];
    default: return null;
  }
}

function put(o, path, v) {
  const k = path.split('.');
  let at = o;
  for (const p of k.slice(0, -1)) at = at[p] || (at[p] = {});
  at[k[k.length - 1]] = v;
}
export function get(o, path) {
  return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}

/**
 * The bundle from `src`, a map of FIELDS paths to raw values (anything else
 * in it is never read). `summary` drops the history for the URL fallback.
 */
export function buildBundle(src, { summary = false } = {}) {
  const out = {};
  for (const f of FIELDS) {
    if (summary && (f.path.startsWith('window.') || f.path === 'events')) continue;
    const v = f.path === 'schema' ? SCHEMA : clean(f, src[f.path]);
    if (f.opt && (v == null || (Array.isArray(v) && v.every((x) => x == null)))) continue;
    put(out, f.path, v);
  }
  return out;
}

/** Every leaf path of a bundle (arrays are leaves), for the coverage check. */
export function leafPaths(o, pre = '') {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? leafPaths(v, pre + k + '.') : [pre + k]));
}

/** 8 random base32 characters. */
export function reportId(rand = (a) => crypto.getRandomValues(a)) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return [...rand(new Uint8Array(8))].map((x) => A[x & 31]).join('');
}

export const fileName = (id) => 'diag-report-' + id + '.json';

/**
 * The new-issue URL for a bundle. Over URL_BUDGET the full bundle goes in a
 * file to attach and the URL carries the summary with `attachment` set.
 * @returns {{url: string, attach: boolean, full: string}} full = the compact JSON of the whole bundle
 */
export function issueUrl(src) {
  const id = ID_RE.test(src.id) ? src.id : 'unknown';
  const head = 'template=diag-report.yml&title=' + encodeURIComponent('Diagnostic report ' + id) + '&bundle=';
  let full = JSON.stringify(buildBundle(src));
  let q = head + encodeURIComponent(full);
  const attach = q.length > URL_BUDGET;
  if (attach) {
    // The file and the link both name the file, so the review shows what the issue will say.
    full = JSON.stringify(buildBundle({ ...src, attachment: fileName(id) }));
    q = head + encodeURIComponent(JSON.stringify(buildBundle({ ...src, attachment: fileName(id) }, { summary: true })));
  }
  return { url: 'https://github.com/' + REPO + '/issues/new?' + q, attach, full };
}

// ---- the Sent reports store -------------------------------------------------

export function loadSent() {
  try {
    const a = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(a) ? a.filter((r) => r && typeof r.id === 'string') : [];
  } catch (e) { return []; }
}
export function saveSent(list) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (e) { /* private mode: the list is a convenience */ }
}

/** The issue for report `id` by the unauthenticated title search (10 per minute per address), or null. */
export async function lookupIssue(id, f = apiFetch) {
  try {
    const q = encodeURIComponent('repo:' + REPO + ' label:diag-report in:title ' + id);
    const r = await f('https://api.github.com/search/issues?q=' + q, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const hit = ((await r.json()).items || []).find((i) => String(i.title).includes(id));
    return hit ? hit.html_url : null;
  } catch (e) { return null; }
}

/** 'removed' when the issue was deleted (410), 'open' or 'closed', null when unknown. */
export async function issueState(url, f = apiFetch) {
  const m = /^https:\/\/github\.com\/openvalence\/Phosphor\/issues\/(\d+)$/.exec(url || '');
  if (!m) return null;
  try {
    const r = await f('https://api.github.com/repos/' + REPO + '/issues/' + m[1], { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 410 || r.status === 404) return 'removed';
    return r.ok ? (await r.json()).state || null : null;
  } catch (e) { return null; }
}

/** A pasted issue link, or null when it is not one of this repo's issues. */
export function parseIssueLink(text) {
  const m = /^\s*(https:\/\/github\.com\/openvalence\/Phosphor\/issues\/\d+)\s*$/.exec(text || '');
  return m ? m[1] : null;
}

// ---- the OS acts (shell: src-tauri/src/report.rs; served page: the browser) ----

const SHELL = !!import.meta.env?.TAURI_ENV_PLATFORM;
const invoke = async (cmd, args) => (await import('@tauri-apps/api/core')).invoke(cmd, args);
/** The shell's CSP refuses the page's fetch to api.github.com; its HTTP plugin answers (plugins.svelte.js shellFetch). */
async function apiFetch(url, init) {
  return SHELL ? (await import('@tauri-apps/plugin-http')).fetch(url, init) : fetch(url, init);
}

/** Opens url in the system browser. false when nothing could (the caller copies it instead). */
export async function openUrl(url) {
  if (SHELL) return invoke('open_report_url', { url }).then(() => true, () => false);
  const w = window.open(url, '_blank');
  if (w) try { w.opener = null; } catch (e) { /* cross-origin already */ }
  return !!w;
}

/** Writes text as `name`: the shell's Downloads folder, the browser's download. The saved path, or '' for a download. */
export async function saveFile(name, text) {
  if (SHELL) return invoke('save_report', { name, text });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return '';
}

// ---- the bundle's source, from an incident and its snapshot -------------------

/** A condition as the bundle names it: the cutouts are one condition with a cause. */
export const kindOf = (cond) => (cond.startsWith('cutout-') ? 'cutout' : cond);
const maxOf = (a) => (a.length ? Math.max(...a) : null);
const sumOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) : null);
const minOf = (a) => (a.length ? Math.min(...a) : null);
/** A condition without a classifier: where it was measured, and whether that pins it. */
const AREA_CAUSE = { device: ['client', 'decisive'], link: ['network', 'likely'], machine: ['hub', 'decisive'] };
/** A growth incident's own numbers (m) as [metric, baseline, current, window ms, slope per minute]. */
const MEASURE = {
  growth: (m) => ['heap_floor_mb', m.baseMb, m.nowMb, m.minutes * 60000, m.slopeMbPerMin],
  workers: (m) => ['workers', m.base, m.now, 300000, null],
};

/** rows ({t relative ms, ...}) bucketed from..to by step, `key` folded by agg; null where none. */
export function series(rows, key, agg, from, to, step) {
  const out = [];
  for (let tk = from; tk <= to; tk += step) {
    const v = rows.filter((r) => r.t >= tk - step / 2 && r.t < tk + step / 2 && Number.isFinite(r[key])).map((r) => r[key]);
    out.push(agg(v));
  }
  return out;
}

/**
 * The FIELDS-path map for one incident. inc: a health incident view; snap:
 * {rows, fine} with t relative to the incident; ctx: {app, machine} from
 * health.svelte.js context(); others: incidents for the events list.
 */
export function reportSource({ inc, snap, ctx, hubLog = null, protocol = null, others = [] }) {
  const e = inc.evidence || {};
  const hl = hubLog || {};
  const st = inc.settings || {};
  const rows = (snap && snap.rows) || [];
  const fine = (snap && snap.fine) || [];
  const W = [-60000, 30000, 2000], F = [-2000, 500, 100];
  // Every least, typical and worst value is over W, from the rows the series below are made of.
  const inW = rows.filter((r) => r.t >= W[0] - W[2] / 2 && r.t < W[1] + W[2] / 2);
  const col = (k) => inW.map((r) => r[k]).filter(Number.isFinite);
  const d = CONDITIONS[inc.cond] || {};
  const [cause, confidence] = d.cause ? [inc.cause, inc.confidence] : AREA_CAUSE[d.area] || [null, null];
  const [metric, baseline, current, windowMs, slope] = MEASURE[inc.cond] && inc.m ? MEASURE[inc.cond](inc.m) : [];
  // The video at the problem; a video-drops incident's own numbers, refreshed while it held.
  const md = (inc.cond === 'video-drops' && inc.m && inc.m.frames != null ? inc.m : e.media) || {};
  const events = [];
  for (const o of [inc, ...others]) {
    if (o.t0 == null || inc.t0 == null) continue;
    for (const ep of o.episodes || []) {
      const t = o.t0 + ep - inc.t0;
      if (t >= W[0] && t <= W[1]) events.push({ t_ms: t, kind: kindOf(o.cond), cause: o.cause || null });
    }
  }
  events.sort((a, b) => a.t_ms - b.t_ms);
  return {
    id: inc.id,
    'app.version': ctx.app && ctx.app.version, 'app.platform': ctx.app && ctx.app.platform,
    'app.engine': ctx.app && ctx.app.engine, 'app.shell': ctx.app && ctx.app.shell,
    'machine.firmware': ctx.machine && ctx.machine.firmware, 'machine.protocol': protocol,
    'machine.transport': ctx.machine && ctx.machine.transport,
    'incident.condition': kindOf(inc.cond), 'incident.cause': cause,
    'incident.confidence': confidence, 'incident.severity': inc.sev, 'incident.count': inc.count,
    'incident.lasted_ms': inc.durationMs,
    'measure.metric': metric, 'measure.baseline': baseline, 'measure.current': current, 'measure.window_ms': windowMs,
    'measure.slope_per_min': slope,
    'settings.stream_buffer_ms': st.horizonMs, 'settings.schedule_latency_us': st.latMs != null ? st.latMs * 1000 : null,
    'settings.lookahead_ms': st.horizonMs != null ? st.horizonMs / 2 : null,
    'evidence.from_ms': W[0], 'evidence.to_ms': W[1],
    'evidence.lead_send_ms_min': minOf(col('lead')), 'evidence.arrival_lead_ms_min': minOf(col('arr')),
    'evidence.rtt_ms_p50': quantile(col('rtt'), 0.5), 'evidence.rtt_ms_max': maxOf(col('rtt')), 'evidence.owd_up_ms_max': maxOf(col('owd')),
    'evidence.downlink_gap_ms_max': maxOf(col('gap')), 'evidence.loop_lag_ms_max': maxOf(col('lag')),
    'evidence.backlog_bytes_max': maxOf(col('backlog')), 'evidence.rssi_dbm': null, 'evidence.wifi_drops': null,
    'evidence.late_plans_per_min': null, 'evidence.reconnects': e.reconnects, 'evidence.heap_mb': e.heapMb, 'evidence.fps': e.fps,
    'media.width': md.w, 'media.height': md.h, 'media.video_fps': md.fps, 'media.display_hz': md.hz, 'media.rate': md.rate,
    'media.window_ms': md.wallS != null ? md.wallS * 1000 : null, 'media.frames_total': md.frames, 'media.frames_dropped': md.dropped,
    'media.hdr': md.hdr, 'media.fullscreen': md.full, 'media.analyzer': md.an,
    'window.from_ms': W[0], 'window.to_ms': W[1], 'window.step_ms': W[2],
    'window.series.rtt_ms': series(rows, 'rtt', maxOf, ...W),
    'window.series.lead_send_ms': series(rows, 'lead', minOf, ...W),
    'window.series.arrival_lead_ms': series(rows, 'arr', minOf, ...W),
    'window.series.downlink_gap_ms': series(rows, 'gap', maxOf, ...W),
    'window.series.loop_lag_ms': series(rows, 'lag', maxOf, ...W),
    'window.series.fps': series(rows, 'fps', minOf, ...W),
    'window.series.heap_mb': series(rows, 'heap', maxOf, ...W),
    'window.series.rssi_dbm': series(rows, 'rssi', minOf, ...W),
    'window.series.late_plans': series(rows, 'late', maxOf, ...W),
    'window.series.video_dropped': series(rows, 'vdrop', sumOf, ...W),
    'window.fine.from_ms': F[0], 'window.fine.to_ms': F[1], 'window.fine.step_ms': F[2],
    'window.fine.series.lead_send_ms': series(fine, 'lead', minOf, ...F),
    'window.fine.series.owd_up_ms': series(fine, 'owd', maxOf, ...F),
    'window.fine.series.downlink_gap_ms': series(fine, 'gap', maxOf, ...F),
    events,
    'hub_log.warn': hl.warn, 'hub_log.error': hl.error,
    attachment: null,
  };
}
