/**
 * motion.js — where a normalized motion input (0 = one end of the stroke,
 * 1 = the other) lands on this machine, resolved by ROLE.
 *
 * Constraints:
 * - Binds to registry roles only (`command.position`, `window.min/max`),
 *   never to a channel id or field name.
 * - Never fabricates a bound (RENDERING.md §13 law 9): a machine that
 *   publishes a window but has not reported it yet gets null, not the
 *   command field's full range.
 * - The hub still clamps every target into its own window. This mapping only
 *   decides what "halfway" means, the same way the rail tape does
 *   (RailWidget's tapeLo/tapeHi).
 */

import { ROLE } from './roles.js';
import { reportedValue } from './settings.js';

const first = (byRole, role) => {
  const l = byRole && byRole.get(role);
  return l && l.length ? l[0] : null;
};

/**
 * @param {Object|null} model buildSettingsModel output
 * @param {Object} samples channelId -> decoded STATE sample
 * @param {number} norm 0..1 (clamped)
 * @returns {{field: Object, value: number}|{field: null, reason: string}}
 */
export function motionTarget(model, samples, norm) {
  if (!model || !model.byRole) return { field: null, reason: 'no catalog' };
  if (!Number.isFinite(norm)) return { field: null, reason: 'position is not a number' };
  const cmd = first(model.byRole, ROLE.commandPosition);
  if (!cmd) return { field: null, reason: 'machine publishes no command.position' };
  const n = Math.min(1, Math.max(0, norm));

  const lo = first(model.byRole, ROLE.windowMin);
  const hi = first(model.byRole, ROLE.windowMax);
  let a;
  let b;
  if (lo && hi && lo.unit === cmd.unit && hi.unit === cmd.unit) {
    a = reportedValue(lo, samples[lo.channelId]);
    b = reportedValue(hi, samples[hi.channelId]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      return { field: null, reason: 'stroke window not reported yet' };
    }
  } else {
    a = cmd.min;
    b = cmd.max;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      return { field: null, reason: 'command.position publishes no bounds' };
    }
  }
  return { field: cmd, value: a + n * (b - a) };
}
