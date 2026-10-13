/**
 * provision.js -- the words for a refused provisioning `wifi_join` (SPEC
 * §13.9). Pure, so shadow.svelte.js and the setup flow share one table.
 *
 * Constraints:
 * - NETWORK_JOIN_FAILED's `detail` names a reason and never a credential
 *   (§13.9); it is matched, never echoed.
 * - ACCESS_DENIED on the provisioning channel means no presence: the gate is
 *   configure plus an open window (§13.9), and the window is the machine's.
 * - Keyed on the core channel id and registry NACK codes, never a name.
 */
import { NACK } from '../../../Valence/clients/js/index.js';
import { CORE_CHANNEL } from '../../../Valence/clients/js/generated/registry_vocab.js';

// detail token -> words. Order matters only for tokens that contain another.
const JOIN_WHY = {
  auth: 'Wrong password',
  not_found: 'Network not found',
  no_address: 'Joined but got no address',
  timeout: 'Timed out',
  timed_out: 'Timed out',   // the reference hub's words (Nucleus ValenceProvisioning.h)
  station_down: 'Radio not ready',
};
export const JOIN_FAILED = 'Join failed';
export const NEEDS_PRESS = 'Press Pair on the machine, then try again';

/** {reason, text} for a NETWORK_JOIN_FAILED detail; reason is the matched token or 'unknown'. */
export function joinFailure(detail) {
  const d = String(detail || '').toLowerCase().replace(/[\s-]+/g, '_');
  const reason = Object.keys(JOIN_WHY).find((k) => d.includes(k));
  return reason ? { reason, text: JOIN_WHY[reason] } : { reason: 'unknown', text: JOIN_FAILED };
}

/**
 * The refusal of a provisioning intent in plain words, or null when `err` is
 * not one this table knows: {reason, text}.
 */
export function provisionRefusal(err) {
  if (!err) return null;
  if (err.code === NACK.NETWORK_JOIN_FAILED) return joinFailure(err.detail);
  if (err.code === NACK.ACCESS_DENIED) return { reason: 'access_denied', text: NEEDS_PRESS };
  return null;
}

export const isProvisioning = (channelId) => channelId === CORE_CHANNEL.provisioning;
