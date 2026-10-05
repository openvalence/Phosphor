/**
 * history.js -- the session's setting writes as a ring, and the revert plan.
 * Pure (no runes, no DOM), so test/history.test.mjs runs it under node.
 *
 * Constraints:
 * - Setting writes only, never moves, actions or commands (DESIGN §10.13).
 * - Values are what the machine reported before and applied after, never a
 *   request. A secret never enters: the caller filters it.
 * - A write to the same field within GESTURE_MS of the newest entry extends
 *   that entry (a drag is one step); an entry back at its before is dropped.
 */
import { sameValue } from './merge.js';

export const MAX = 256;
export const GESTURE_MS = 1000;

/** Add `e` {uid, label, before, after, t, trial} to `list`; returns the entry held for it, or null. */
export function pushEntry(list, e, max = MAX) {
  const last = list[list.length - 1];
  if (last && last.uid === e.uid && e.t - last.t < GESTURE_MS && !!last.trial === !!e.trial) {
    last.after = e.after;
    last.t = e.t;
    if (sameValue(last.before, last.after)) { list.pop(); return null; }
    return last;
  }
  if (sameValue(e.before, e.after)) return null;
  list.push(e);
  while (list.length > max) list.shift();
  return e;
}

/** The baseline (a new one for null) with every item that reports a value and has none yet; an existing value is never replaced. */
export function fillBaseline(baseline, items) {
  const out = baseline || {};
  for (const it of items) if (it.cur !== undefined && !Object.prototype.hasOwnProperty.call(out, it.uid)) out[it.uid] = it.cur;
  return out;
}

/**
 * What a revert does. `items` are { uid, label, cur, hazard(to) }; only a
 * field that differs from the baseline counts. A hazard is skipped and named.
 * @returns {{send: {uid: string, to: *}[], skipped: string[]}}
 */
export function planRevert(baseline, items) {
  const send = [], skipped = [];
  for (const it of items) {
    if (!Object.prototype.hasOwnProperty.call(baseline, it.uid)) continue;
    const to = baseline[it.uid];
    if (it.cur === undefined || sameValue(it.cur, to)) continue;
    if (it.hazard(to)) skipped.push(it.label);
    else send.push({ uid: it.uid, to });
  }
  return { send, skipped };
}
