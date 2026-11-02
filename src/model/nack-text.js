/**
 * nack-text.js -- each NACK code's meaning in the user's words, read before the
 * registry note (registry-tables.js, generated: never edit that one).
 *
 * Constraints:
 * - Protocol meaning only, never one hub's behavior (governance.md: a client).
 * - A code set to null falls back to the registry note on purpose; a code the
 *   table lacks fails test/nack-text.test.mjs until it gets text or a null.
 * - Voice and limits: Nucleus .claude/rules/strings.md, docs/COPY.md.
 */
import { NACK_MEANING } from './registry-tables.js';

export const NACK_TEXT = {
  0x0: 'Hub could not decode a frame from Phosphor',
  0x1: 'Hub does not serve this protocol version',
  0x2: 'Frame larger than the size agreed with the hub',
  0x3: 'Frame not encoded in deterministic CBOR',
  0x100: 'Hub busy with other requests; retry later',
  0x101: 'Pairing token invalid or revoked',
  0x102: 'Needs control; this session has less',
  0x103: 'Control needs pairing; the pairing window is closed',
  0x104: 'Wrong pairing PIN, or the pairing window closed',
  0x105: 'An admin closed this session',
  0x106: 'This client connected again; the older session closed',
  0x107: 'Session closed normally; not an error',
  0x108: 'Hub closed the session: silent past the link-loss timeout',
  0x109: 'Hub closed every session to reboot and apply a change',
  0x10a: 'Hub closed the session: catalog not confirmed in time',
  0x10b: 'Refused until the session confirms the catalog',
  0x10c: 'Hub closed a silent session that owned no motion source',
  0x10d: 'Hub was full; this stale session closed to make room',
  0x10e: 'Hub refused the connection: every session slot is in use; retry later',
  0x10f: 'Hub refused the connection to protect itself; retry later',
  0x200: 'Channel id not in the hub\'s catalog',
  0x201: 'Channel needs a higher access tier than this session has',
  0x202: 'Operation does not fit the channel\'s class',
  0x203: 'This session reached its subscription limit',
  0x204: 'Hub could not process the whole subscribe request',
  0x205: 'User channel removed; its subscription or publish grant ended',
  0x300: 'Settings changed since this write was prepared',
  0x301: 'Commands sent faster than the hub accepts',
  0x302: 'Value out of range or the wrong type, or a store import the hub refuses',
  0x303: 'This hub does not support that command',
  0x304: 'Wi-Fi join failed; the previous network stays in effect',
  0x305: 'Accessory not reachable right now; its channels stay listed',
  0x306: 'Hub has no room for another accessory',
  0x307: 'Another session has these settings on trial; retry after it commits or reverts',
  0x400: 'Refused while the e-stop is latched',
  0x401: 'Motion refused until the machine is homed',
  0x402: 'A hub safety interlock blocks this',
  0x403: 'Another source owns the rail',
  0x404: 'Another session has control; retry with takeover',
  0x405: 'E-stop release refused: the fault remains or the machine is moving',
  0x500: 'Requested item or chunk does not exist on the hub',
  0x501: 'Transfer abandoned: its parts did not arrive within 5 s',
  0x502: 'Built-in catalog does not match the hub\'s',
  0x503: 'Transfer refused: larger than the receiver\'s buffer',
  0x504: 'Requested store is not registered on the hub',
};

/** The words for `code`: user text, else the registry note, else ''. */
export const nackMeaning = (code) => NACK_TEXT[code] || NACK_MEANING[code] || '';
