/**
 * format.js — value presentation, driven entirely by catalog metadata.
 *
 * No unit table, no per-field precision map. The catalog says a field is in
 * `mm` with step 1, or `mm/s3` with step 1000, and that is enough to render it
 * sensibly on a machine we have never met.
 */

import { createSubscriber } from 'svelte/reactivity';
import { ROLE_LABEL } from './roles.js';
import { UNIT_ID, VALUE_ASPECT, VALUE_SCOPE_NAME } from '../../../Valence/clients/js/index.js';

/**
 * RENDERING §6: conventional suffix per registry unit id. An id missing here
 * (or null: absent/unrecognized on the wire) falls back to the catalog's own
 * unit string, never a guess.
 */
const UNIT_SUFFIX = {
  [UNIT_ID.mm]: 'mm', [UNIT_ID.mm_s]: 'mm/s', [UNIT_ID.mm_s2]: 'mm/s²', [UNIT_ID.mm_s3]: 'mm/s³',
  [UNIT_ID.normalized]: '', [UNIT_ID.percent]: '%', [UNIT_ID.hz]: 'Hz', [UNIT_ID.ms]: 'ms',
  [UNIT_ID.s]: 's', [UNIT_ID.v]: 'V', [UNIT_ID.a]: 'A', [UNIT_ID.w]: 'W', [UNIT_ID.wh]: 'Wh',
  [UNIT_ID.deg_c]: '°C', [UNIT_ID.count]: '', [UNIT_ID.bytes]: 'B', [UNIT_ID.db]: 'dB',
  [UNIT_ID.n]: 'N', [UNIT_ID.kpa]: 'kPa', [UNIT_ID.ml]: 'mL', [UNIT_ID.ml_min]: 'mL/min',
  [UNIT_ID.rpm]: 'rpm', [UNIT_ID.bpm]: 'bpm', [UNIT_ID.deg]: '°', [UNIT_ID.us]: 'µs',
  [UNIT_ID.hub_s]: 'hub s',
};

/** Aspects that are a statistic over some span, so their scope must show (§5.4). */
const STAT_ASPECTS = new Set([VALUE_ASPECT.peak, VALUE_ASPECT.min, VALUE_ASPECT.mean, VALUE_ASPECT.total]);

/**
 * "session peak", "lifetime total": the aspect and scope a statistic must
 * carry on screen (RENDERING §5.4 honesty). '' for a live value.
 */
export function statTag(field) {
  if (!field || !STAT_ASPECTS.has(field.aspect)) return '';
  const scope = VALUE_SCOPE_NAME[field.scope] || VALUE_SCOPE_NAME[0];
  return field.aspect === VALUE_ASPECT.total ? scope + ' total' : scope + ' ' + (
    field.aspect === VALUE_ASPECT.peak ? 'peak' : field.aspect === VALUE_ASPECT.min ? 'min' : 'mean');
}

/**
 * PROVENANCE (RFC-048 key 22) -> the adjective that goes in front of a label.
 *
 * Registry vocabulary, so this is protocol wording, not device knowledge:
 * `demand` is what was asked for, `planned` is what the planner is aiming at,
 * `actual` is what was measured. `actual` maps to NOTHING on purpose — it is
 * the wire default, so qualifying every unannotated field with "actual" would
 * put a measurement claim on machines that never made one, which is the exact
 * lie this table exists to prevent in the other direction.
 */
const PROVENANCE_QUALIFIER = { demand: 'Demand', planned: 'Planned' };

/**
 * The display label for ANY field, anywhere in the UI. Resolution order:
 *   1. ROLE_LABEL[field.role] when the field carries a known registry role
 *      (roles.js) — a human-standardized label for machine vocabulary.
 *   2. descLabel(field): the catalog author's own words, used VERBATIM.
 *   3. field.label, which buildSettingsModel already set to
 *      humanize(field.name) at construction time — the honest fallback for a
 *      field this project has no opinion about.
 * The field's own PROVENANCE is composed onto a ROLE label only. A role label
 * names a generic quantity, so demand/planned is what says which pipeline
 * stage the number is; a desc label already carries the author's wording, and
 * qualifying it reads "Demand asked position".
 *
 * The provenance half is not decoration. A hub whose planner renders position
 * publishes `telemetry.position` with provenance `planned`, and a label that
 * read "Actual" over it would be the UI asserting a measurement nobody made —
 * a ground-truth defect, not a wording preference. The word comes from the
 * catalog every time; nothing here assumes anything about which field is
 * measured on which machine.
 *
 * This is the ONLY function in the UI layer that may special-case a role for
 * display text; every component reads through it rather than field.label
 * directly, so a role gets its human label wherever it appears (hero
 * numerals, the rail, the generic Field control, the hero widgets) and an
 * unroled field keeps today's behavior everywhere too.
 */
export function labelFor(field) {
  const tag = statTag(field);
  return baseLabel(field) + (tag ? ' · ' + tag : '');
}

function baseLabel(field) {
  if (!field) return '';
  const role = field.role && ROLE_LABEL[field.role];
  if (!role) return descLabel(field) || (field.label != null ? field.label : '');
  const q = PROVENANCE_QUALIFIER[field.provenanceName];
  if (!q) return role;
  return q + ' ' + role.charAt(0).toLowerCase() + role.slice(1);
}

/**
 * A wire name is machine vocabulary: `raw_10um` humanizes to "Raw 10um",
 * which names nothing a human asked about. A catalog `desc` is written for a
 * human, so its leading clause (everything before the first `.,;:`) is
 * preferred, but only while it is shaped like a label: 2-3 words, at most 30
 * characters. Longer is prose, and prose in a label column is worse than the
 * raw name. Never a per-device name table: the catalog author owns the words.
 */
function descLabel(field) {
  if (!field.desc) return '';
  const clause = String(field.desc).split(/[.,;:]/)[0].trim();
  if (!clause || clause.length > 30) return '';
  const words = clause.split(/\s+/);
  if (words.length < 2 || words.length > 3) return '';
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}

/** Decimal places implied by a step. step 0.05 -> 2, step 1 -> 0, absent -> 2. */
export function precisionFor(field) {
  if (field && (field.unitId === UNIT_ID.count || field.unitId === UNIT_ID.bytes)) return 0;
  const step = field && field.step;
  if (step == null || !isFinite(step) || step <= 0) {
    // No step published. Integers read better without a false ".00"; floats
    // need some precision or every value looks quantized.
    return field && field.typeName && /^(u|i)\d/.test(field.typeName) ? 0 : 2;
  }
  if (step >= 1) return 0;
  const d = Math.ceil(-Math.log10(step));
  return Math.min(Math.max(d, 0), 4);
}

/** Format a numeric value for display, without the unit. */
export function formatValue(field, value) {
  if (value == null || value === '') return '--';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return value;
  if (!isFinite(value)) return '--';
  // Large magnitudes get thin-space grouping so 2000000 is readable at a glance.
  const p = precisionFor(field);
  const n = Number(value).toFixed(p);
  return Math.abs(value) >= 10000 ? groupThousands(n) : n;
}

function groupThousands(s) {
  const [i, f] = String(s).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? '.' + f : '');
}

/** Unit suffix, or '' when the catalog gave none. An id with no suffix (count) yields to the free string. */
export function unitOf(field) {
  if (field && field.unitId != null && UNIT_SUFFIX[field.unitId]) return UNIT_SUFFIX[field.unitId];
  const u = field && field.unit;
  if (!u || u === 'flag' || u === 'count' || u === '-') return '';
  return u;
}

/**
 * [text, unit] for display, the one value formatter: a hub-time stamp as wall
 * time, else autoranged when enabled, else the plain value and suffix.
 */
export function formatParts(field, value) {
  if (isHubTime(field) && typeof value === 'number') {
    const ms = hubSecToWallMs(value, hubClock && hubClock());
    if (ms != null) return [new Date(ms).toLocaleString(), ''];
  }
  const u = unitOf(field);
  return autorange(field, value, u) || [formatValue(field, value), u];
}

/** Full "value unit" string. */
export function formatWithUnit(field, value) {
  const [v, u] = formatParts(field, value);
  return u ? v + ' ' + u : v;
}

// ---- hub time (SPEC §7.1, RFC-083, RFC-086) ---------------------------------

const WRAP_S = 2 ** 32 / 1e6;   // hub-µs wraps every ~71.6 min (SPEC §7.2)
let hubClock = null;

/** machine.svelte.js installs its hub-clock reference here (format.js stays pure). */
export function setHubClock(fn) { hubClock = fn; }

/** The current reference, or null (no uptime yet). */
export const hubClockNow = () => (hubClock ? hubClock() : null);

/** A hub-time stamp: unit hub_s, or a datetime.* role, which carries it by definition (RFC-083). */
export function isHubTime(field) {
  return !!field && (field.unitId === UNIT_ID.hub_s || /^datetime\./.test(field.role || ''));
}

// ponytail: only moments THIS page armed are tracked, in memory; persist per
// hub instance if a reload across a hub reboot must still flag them.
const armed = new Map();   // field uid -> {bootId, hubSec, wallMs}

/** Record a moment this client wrote, under the hub boot it was written in. */
export function armMoment(uid, bootId, hubSec, wallMs) { armed.set(uid, { bootId, hubSec, wallMs }); }

/**
 * SPEC §7.2: a moment armed under another boot_id is void. Returns the armed
 * record (its wall time is what a re-arm writes) when the hub still reports
 * that stale value, else null. Never shifted silently: the caller re-arms.
 */
export function staleMoment(uid, bootId, value) {
  const a = armed.get(uid);
  return a && bootId != null && a.bootId !== bootId && a.hubSec === value ? a : null;
}

/**
 * Hub seconds since boot, now, from a reference {hubUs, wallMs, uptimeS}:
 * the CLOCK offset's hub-µs (wrapping) gives the fraction, a coarse uptime
 * picks the wrap. Without CLOCK the uptime alone (1 s resolution); without
 * uptime null: the wrap cannot be told and a guessed wall time would lie.
 */
function hubNowS(ref) {
  if (!ref || ref.uptimeS == null) return null;
  if (ref.hubUs == null) return ref.uptimeS;
  const fine = (ref.hubUs >>> 0) / 1e6;
  return fine + Math.round((ref.uptimeS - fine) / WRAP_S) * WRAP_S;
}

/** A hub-time stamp (whole seconds since hub boot) as wall-clock epoch ms, or null. */
export function hubSecToWallMs(hubSec, ref) {
  const n = hubNowS(ref);
  return n == null || !isFinite(hubSec) ? null : ref.wallMs + (hubSec - n) * 1000;
}

/** Wall-clock epoch ms as whole hub seconds (the write half), or null. */
export function wallMsToHubSec(wallMs, ref) {
  const n = hubNowS(ref);
  return n == null || !isFinite(wallMs) ? null : Math.round(n + (wallMs - ref.wallMs) / 1000);
}

/**
 * RFC-086 (RENDERING §6): SI prefixes for DISPLAY only; the wire unit and
 * scale never change. Exponent bounds per base unit, where a prefix reads
 * naturally (no kiloseconds). formatParts is the caller; µs is `s` with a
 * prefix, so it autoranges to ms and s by magnitude.
 */
const SI_RANGE = { V: [-6, 3], A: [-6, 3], W: [-3, 6], Wh: [0, 6], s: [-6, 0], Hz: [0, 6], N: [-3, 3] };
const SI_PREFIX = { '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M' };
const SI_EXP = { µ: -6, m: -3, k: 3, M: 6 };
let autorangeOn = true;
// autorange() must call trackAutorange() before reading the switch: that
// subscription is what re-renders a shown value the moment it flips.
let autorangeChanged = () => {};
const trackAutorange = createSubscriber((update) => {
  autorangeChanged = update;
  return () => { autorangeChanged = () => {}; };
});

/** The Settings pane's switch (prefs.js `autorange`). */
export function setAutorange(on) {
  if (autorangeOn === !!on) return;
  autorangeOn = !!on;
  autorangeChanged();
}

/** [text, unit] rescaled to the prefix that fits `value`, or null to leave it. */
export function autorange(field, value, unit) {
  trackAutorange();
  const m = autorangeOn && typeof value === 'number' && value && isFinite(value)
    && /^(µ|m|k|M)?(V|A|Wh|W|s|Hz|N)$/.exec(unit);
  if (!m) return null;
  const e0 = SI_EXP[m[1]] || 0;
  const [lo, hi] = SI_RANGE[m[2]];
  const e = Math.min(hi, Math.max(lo, Math.floor((Math.floor(Math.log10(Math.abs(value))) + e0) / 3) * 3));
  if (e === e0) return null;
  const p = Math.min(4, Math.max(0, precisionFor(field) + e - e0));
  return [(value * 10 ** (e0 - e)).toFixed(p), SI_PREFIX[e] + m[2]];
}

/**
 * Option label for a select-ish field. Falls back to the raw index rather than
 * inventing a name — an unlabeled option is the machine's omission to show,
 * not ours to paper over.
 */
export function optionLabel(field, value) {
  // No value yet is NOT the zeroth option. Rendering String(undefined) put the
  // literal text "undefined" in front of the operator where a setting's state
  // belonged; showing option 0 instead would have been worse, because it would
  // have asserted a machine state nobody reported.
  if (value == null || value === '' || Number.isNaN(Number(value))) return '--';
  if (!field || !field.options) return String(value);
  const i = Number(value);
  const l = field.options[i];
  return (l == null || l === '') ? String(value) : l;
}

/** Humane elapsed time from a ms epoch. */
export function since(ms) {
  if (!ms) return '--';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

/** Elapsed ms -> h:mm:ss, or h:mm:ss.mmm when `withMs`. */
export function clock(ms, withMs) {
  if (ms == null || !isFinite(ms) || ms < 0) return '--';
  const t = Math.floor(ms / 1000);
  const two = (n) => String(n).padStart(2, '0');
  const base = Math.floor(t / 3600) + ':' + two(Math.floor((t % 3600) / 60)) + ':' + two(t % 60);
  return withMs ? base + '.' + String(Math.floor(ms % 1000)).padStart(3, '0') : base;
}

/** Seconds -> compact uptime. */
export function uptime(sec) {
  if (sec == null || !isFinite(sec)) return '--';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm ' + Math.floor(sec % 60) + 's';
}

/** Counter -> at most 3 significant digits and a k/M/G suffix: 999, 3.25k, 55.1k, 1.20M. */
export function compact(n) {
  if (n == null || !isFinite(n)) return '--';
  let x = Math.abs(n), i = 0;
  while (x >= 999.5 && i < 3) { x /= 1000; i++; }
  if (!i) return String(n);
  const r = Number(x.toPrecision(3));
  return (n < 0 ? '-' : '') + r.toFixed(r < 10 ? 2 : r < 100 ? 1 : 0) + 'kMG'[i - 1];
}

/** Microseconds -> "-1605.299 s": three decimals, compact past 10000 s. */
export function seconds(us) {
  if (us == null || !isFinite(us)) return '--';
  const s = us / 1e6;
  return (Math.abs(s) < 1e4 ? s.toFixed(3) : compact(s)) + ' s';
}

/** Bytes -> KB/MB with one decimal. */
export function bytes(n) {
  if (n == null || !isFinite(n)) return '--';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * The machine header: the live identity.name setting (ground truth after a
 * rename, RENDERING law 4), then WELCOME identity hub_name (SPEC §6.3,
 * RFC-016, sent once), then product. Never a client-side name.
 * `virtual` (machine.link.virtual): a replay always reads as one, never as
 * the machine it replays.
 */
export function hubTitle(identity, liveName, virtual = null) {
  if (virtual) return virtual.name ? virtual.name + ' (virtual)' : 'Virtual Valence';
  return liveName || (identity && identity.hub_name) || (identity && identity.product) || '--';
}

/**
 * The HUB chip: the endpoint this session dialed (WS host:port, or the BLE
 * device name). Never location.hostname: in the shell that is the page's own
 * origin, not the hub.
 */
export function endpointLabel(host, port, bleName) {
  if (!host) return '--';
  return bleName != null ? (bleName || host) : host + ':' + port;
}
