/**
 * tier.js -- the access tier a write needs, in the words a session short of it
 * reads (SPEC 12.2, Valence RFC-119: configure sets, control drives, watch
 * halts and pauses).
 *
 * Constraints:
 * - The tier is the catalog's, never a channel list here: the entry's access
 *   raised by the field's access and the option's (Hub::requiredAccessFor).
 * - One ladder fragment (docs/COPY.md 6); a gray control keeps showing (RFC-009.4).
 */
import { NACK } from '../../../Valence/clients/js/index.js';

const NEEDS = ['', 'needs control: Pair this client', 'needs configure: Ask configure, then double-press Pair'];

/** The words for a session that lacks tier `need` (1 control, 2 configure). */
export const needsText = (need) => NEEDS[need] || 'needs access tier ' + need;

/** The tier sending `value` on `key` of INTENT `entry` needs; `key` null reads the entry's floor. */
export function tierOf(entry, key, value) {
  if (!entry) return 0;
  let need = entry.access | 0;
  const f = key == null ? null : (entry.schema || []).find((x) => x.key === key);
  if (!f) return need;
  if (f.access != null) need = Math.max(need, f.access | 0);
  const oa = f.optionAccess;
  if (oa && typeof value === 'number') need = Math.max(need, oa[value] ?? Math.max(...oa));
  return need;
}

/** '' when a session holding `roles` may send it, else the words naming the tier it needs. */
export function tierGate(entry, key, value, roles) {
  const need = tierOf(entry, key, value);
  return (roles | 0) >= need ? '' : needsText(need);
}

/** A refusal's words when the hub said the session's tier is short; '' for any other code. */
export function tierRefusal(code) {
  return code === NACK.ACCESS_DENIED ? NEEDS[2] : code === NACK.NOT_CONTROLLER ? NEEDS[1] : '';
}
