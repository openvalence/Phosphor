// saved-networks wire: the RFC-116 draft numbers in one place, and the pure rules over them.
// Constraints: no DOM and no host import (index.js owns both). A passphrase is a parameter here,
// never stored, returned or put in a message.

// TODO(RFC-116): draft numbers and field names; the registry replaces them, and roles replace the channel ids.
export const DRAFT = {
  channels: { networks: 0x0017, names: 0x0018 },
  // Op 1 (wifi_join) is refused over WebSocket and never sent from here.
  op: { save: 2, remove: 3, move: 4 },
  key: { ssid: 2, passphrase: 3, slot: 6, to: 7, generation: 8 },
  nack: { liveNetwork: 0x0308 },
};

// Registered spec-core NACK codes.
const NACK = { accessDenied: 0x0201, conflict: 0x0300, invalidValue: 0x0302 };

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
