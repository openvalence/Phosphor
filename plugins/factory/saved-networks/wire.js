// saved-networks wire: the RFC-116 draft numbers in one place, and the pure rules over them.
// Constraints: no DOM and no host import (picker.js and slots.js own both). A passphrase is a parameter here,
// never stored, returned or put in a message.

// TODO(RFC-116, RFC-118): draft numbers and field names; the registry replaces them, and roles replace the channel ids.
export const DRAFT = {
  channels: { networks: 0x0017, names: 0x0018, visible: 0x0019, visibleMore: 0x001A },
  // Op 1 (wifi_join) is refused over WebSocket: sent only where the host lends a credential binding (opts.join).
  op: { join: 1, save: 2, remove: 3, move: 4, scan: 5 },
  key: { ssid: 2, passphrase: 3, slot: 6, to: 7, generation: 8 },
  nack: { liveNetwork: 0x0308 },
};

// The hero's claim. The provisioning op is claimed by its role so its generic card leaves the page.
export const SPEC = {
  optional: { op: 'action.provision' },
  channels: { nets: DRAFT.channels.networks },
  optionalChannels: { names: DRAFT.channels.names, vis: DRAFT.channels.visible, more: DRAFT.channels.visibleMore },
};

// The ECHO of a scan means accepted, not done: the rows arrive on STATE with a new counter, or not at all.
export const SCAN_WAIT_MS = 30000;
// A scan refused for motion is asked again on this interval until motion stops.
export const MOTION_RETRY_MS = 4000;

// Registered spec-core NACK codes.
const NACK = { accessDenied: 0x0201, conflict: 0x0300, invalidValue: 0x0302, interlock: 0x0402 };

export const NO_RSSI = -128;
export const NO_LIVE = 255;
export const SSID_MAX_BYTES = 32;

const utf8 = new TextEncoder();

/** '' or why the name cannot be saved: 1 to 32 bytes of UTF-8. */
export function ssidProblem(ssid) {
  const n = utf8.encode(ssid).length;
  return n >= 1 && n <= SSID_MAX_BYTES ? '' : 'Name: 1 to 32 characters';
}

/** '' or why the passphrase cannot be saved: empty (an open network), 8 to 63 printable ASCII, or 64 hex digits. */
export function passphraseProblem(pass) {
  if (pass === '' || /^[\x20-\x7e]{8,63}$/.test(pass) || /^[0-9a-fA-F]{64}$/.test(pass)) return '';
  return 'Passphrase: 8 to 63 characters, or 64 hex digits';
}

/**
 * The saved list as the claimed fields read it. `read(field)` is api.value; `names` is null below
 * configure (no sample). `held` is the last list shown with names. Names pair with the networks sample
 * only when both generations match; while they differ the held list stays (rows do not flash), and with
 * none held the list is counts only.
 */
export function readList(nets, names, read, held = null) {
  const n = (f) => (f ? read(f) : undefined);
  const generation = n(nets.generation), capacity = n(nets.capacity), count = n(nets.count), live = n(nets.live);
  if (![generation, capacity, count, live].every(Number.isInteger)) return held;
  const gen = names ? n(names.generation) : undefined;
  const heard = Number.isInteger(gen);
  if (heard && gen !== generation && held && held.named) return held;
  const paired = heard && gen === generation;
  const open = paired ? n(names.open) | 0 : 0;
  const entries = [];
  for (let i = 0; i < Math.min(count, capacity); i++) {
    const rssi = n(nets['rssi' + i]);
    entries.push({
      slot: i,
      ssid: paired ? String(n(names['ssid' + i]) ?? '') : null,
      open: paired ? !!((open >> i) & 1) : null,
      rssi: Number.isInteger(rssi) && rssi !== NO_RSSI ? rssi : null,
      live: live === i,
    });
  }
  return { generation, capacity, count, entries, named: paired };
}

/** "2 of 4 saved": the only thing a session below configure may know. */
export const occupancy = (list) => list.count + ' of ' + list.capacity + ' saved';

/** The write's refusal in words for a person; r is api.write's {ok:false, error, code, detail}. */
export function refusalWords(r) {
  if (!r || r.ok) return '';
  if (r.code === DRAFT.nack.liveNetwork) return 'Hub is connected through this network';
  if (r.code === NACK.conflict) return 'List changed, check and retry';
  if (r.code === NACK.accessDenied) return 'Needs configure access';
  if (r.code === NACK.invalidValue) {
    const d = String(r.detail || '');
    if (d === 'list full') return 'List full';
    if (d === 'duplicate ssid') return 'Already saved';
    if (d === 'slot' || d === 'to') return 'No such slot';
    if (d === 'ssid length' || d === 'ssid') return ssidProblem('');
    if (d === 'passphrase length' || d === 'passphrase') return passphraseProblem('x');
    return 'Hub refused: ' + (d || 'invalid value');
  }
  return r.error || 'Not saved';
}

export const isConflict = (r) => !!r && !r.ok && r.code === NACK.conflict;

/** The entry's slot in `list` by SSID identity (a slot number moves between reads), or -1. */
export const slotOf = (list, ssid) => (list && list.named ? list.entries.findIndex((e) => e.ssid === ssid) : -1);

/** RFC-118 detection (MUST): the op select lists scan and the catalog declares the visible-networks channel. */
export const scanSupported = (op, f) => !!(op && f && f.vis && Array.isArray(op.options) && op.options[DRAFT.op.scan] === 'scan');

/** A refused wifi_join in words: the shell already names NETWORK_JOIN_FAILED and ACCESS_DENIED in r.error. */
export const joinWords = (r) => (r && r.code === NACK.invalidValue ? refusalWords(r) : (r && r.error) || 'Join failed');

/** A scan refused INTERLOCK: the machine is moving (detail "motion running"). */
export const isInterlock = (r) => !!r && !r.ok && r.code === NACK.interlock;

/** The scan's refusal in words. */
export const scanRefusal = (r) => (isInterlock(r) ? 'Machine is moving' : refusalWords(r) || 'Scan failed');

/** The finished-scan counter the visible list carries (0: none yet), or null with no sample. */
export function scanOf(f, read) {
  const v = f && f.vis && f.vis.scan ? read(f.vis.scan) : undefined;
  return Number.isInteger(v) ? v : null;
}

/**
 * The visible networks, strongest first, joined across the two halves only when their scan counters
 * are equal (the counter is a change marker: equality only, never order): [{ssid, rssi, secured, saved}]. `saved` also holds for any SSID in `list` (the saved list read
 * by readList), so a save shows before the next scan does. The connected entry of `list` leads, listed
 * by the scan or not: {connected: true}. Null before any sample.
 */
export function readVisible(f, read, list = null) {
  const half = (c) => {
    if (!c) return [];
    const count = read(c.count), sec = read(c.secured) | 0, sav = read(c.saved) | 0;
    if (!Number.isInteger(count)) return [];
    const rows = [];
    for (let i = 0; i < Math.min(count, 7); i++) {
      const ssid = String(read(c['ssid' + i]) ?? '');
      if (ssid) rows.push({ ssid, rssi: read(c['rssi' + i]), secured: !!((sec >> i) & 1), saved: !!((sav >> i) & 1) });
    }
    return rows;
  };
  const scan = scanOf(f, read);
  if (scan == null) return null;
  const more = f.more && read(f.more.scan) === scan ? half(f.more) : [];
  // The hub sorts each half; the halves are sorted again as one list.
  const rows = [...half(f.vis), ...more].sort((a, b) => (b.rssi ?? NO_RSSI) - (a.rssi ?? NO_RSSI));
  const named = list && list.named ? list.entries : [];
  for (const r of rows) r.saved = r.saved || named.some((e) => e.ssid === r.ssid);
  const live = named.find((e) => e.live);
  if (live) {
    const at = rows.findIndex((r) => r.ssid === live.ssid);
    const row = at >= 0 ? rows.splice(at, 1)[0] : { ssid: live.ssid, rssi: live.rssi, secured: !live.open, saved: true };
    rows.unshift({ ...row, saved: true, connected: true });
  }
  return rows;
}

/** Signal bars, 1 to 4, from dBm. */
export const bars = (rssi) => (!Number.isInteger(rssi) || rssi === NO_RSSI ? 0 : rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -78 ? 2 : 1);
