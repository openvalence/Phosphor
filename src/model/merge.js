/**
 * merge.js -- settings staged in Virtual Valence, offered back to the real
 * machine. Pure (no runes, no DOM), so test/merge.test.mjs runs it under node.
 *
 * Constraints:
 * - Only stored config is staged: a layout field with `setting_key` (SPEC
 *   §8.8, the stored-vs-effective distinction). Never a read-only effective
 *   value, never a secret (the echo carries `true`, not the value), never a
 *   source's run flag (pattern.running, advgen.running): a merge never starts
 *   motion.
 * - The staged value is what the virtual hub ECHOed (post-clamp applied,
 *   SPEC §9.3), never what the client asked for.
 * - Keyed (machine key, field uid); the machine key is vault.js's, so a
 *   merge only ever offers rows to the hub_instance_id it was staged for.
 * - Rows follow the live catalog's order. A field the live catalog lacks,
 *   or whose type, write channel or setting_key changed, is inert.
 * - Nothing is sent without a tick and a press; one intent per row through
 *   the caller's `send`, each awaited before the next.
 */

import { FIELD_ROLE } from '../../../Valence/clients/js/index.js';
import { reportedValue, humanize } from './settings.js';
import { settingNeedsConfirm } from './actions.js';

export const MERGE_KEY = 'phosphor.merge';
const NEVER = new Set([FIELD_ROLE.pattern_running, FIELD_ROLE.advgen_running]);

const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

/** {machineKey: {uid: staged}} from storage; {} on anything unreadable. */
export function loadStaging(storage = store()) {
  try {
    const s = JSON.parse(storage.getItem(MERGE_KEY));
    return s && typeof s === 'object' ? s : {};
  } catch (e) { return {}; }
}

export function saveStaging(staging, storage = store()) {
  try { storage.setItem(MERGE_KEY, JSON.stringify(staging)); } catch (e) { /* in-memory for this page load */ }
}

const stageable = (f) => !f.readOnly && f.settingKey != null && !NEVER.has(f.role)
  && !(f.flagBits && f.flagBits.secret);

/**
 * Stage one virtual ECHO: every applied key that writes a setting field.
 * @param {Object} staging mutated in place
 * @param {string} machineKey vault key of the replayed machine
 * @param {Object[]} fields buildSettingsModel(...).fields of the virtual catalog
 * @param {number} writeChannel the INTENT channel the echo answered
 * @param {Object} applied ECHO applied, {settingKey: value}
 * @returns {number} how many fields were staged
 */
export function stageEcho(staging, machineKey, fields, writeChannel, applied) {
  let n = 0;
  for (const f of fields) {
    if (f.writeChannel !== writeChannel || !stageable(f)) continue;
    if (!Object.prototype.hasOwnProperty.call(applied, f.settingKey)) continue;
    const v = applied[f.settingKey];
    (staging[machineKey] ||= {})[f.uid] = {
      uid: f.uid, name: f.name, group: f.group, typeName: f.typeName,
      writeChannel, settingKey: f.settingKey, value: typeof v === 'bigint' ? Number(v) : v,
    };
    n++;
  }
  return n;
}

/** Drop one staged field; an emptied machine goes too. */
export function unstage(staging, machineKey, uid) {
  const m = staging[machineKey];
  if (!m) return;
  delete m[uid];
  if (!Object.keys(m).length) delete staging[machineKey];
}

/** Equal as the hub would store them: booleans as 0/1, floats to f32 precision. */
export function sameValue(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) === Number(b);
  if (typeof a === 'number' && typeof b === 'number') return Math.fround(a) === Math.fround(b);
  return a === b;
}

/**
 * The merge rows for a live hub, in its catalog order, then staged fields it
 * lacks. `inert` is the reason a row cannot be applied, '' when it can.
 * @param {Object} staged staging[machineKey]
 * @param {Object[]} fields buildSettingsModel(...).fields of the LIVE catalog
 * @param {Object} samples machine.samples of the live session
 */
export function mergeRows(staged, fields, samples) {
  const rows = [];
  const seen = new Set();
  for (const f of fields) {
    const st = staged && staged[f.uid];
    if (!st) continue;
    seen.add(f.uid);
    const fits = stageable(f) && f.writeChannel === st.writeChannel && f.settingKey === st.settingKey
      && f.typeName === st.typeName;
    const current = reportedValue(f, samples[f.channelId]);
    rows.push({
      uid: f.uid, field: f, label: f.label, group: f.group, value: st.value, current,
      inert: fits ? '' : 'not on this hub',
      differs: current === undefined || !sameValue(current, st.value),
      destructive: !!(f.flagBits && f.flagBits.destructive),
      restart: !!(f.flagBits && f.flagBits.restart_required),
      confirm: fits && settingNeedsConfirm(f, current, st.value),
    });
  }
  for (const st of Object.values(staged || {})) {
    if (seen.has(st.uid)) continue;
    rows.push({ uid: st.uid, field: null, label: humanize(st.name), group: st.group || '', value: st.value,
      current: undefined, inert: 'not on this hub', differs: true, destructive: false, restart: false, confirm: false });
  }
  return rows;
}

/** Pre-ticked: every applicable row whose staged value differs from the hub's. */
export function defaultTicks(rows) {
  return new Set(rows.filter((r) => !r.inert && r.differs).map((r) => r.uid));
}

/**
 * Send every ticked, applicable row in order, one intent each, awaiting each
 * ECHO. An applied row leaves staging; a NACK or a declined confirm stays.
 * @param {Object} staging mutated in place
 * @param {string} machineKey
 * @param {Object[]} rows mergeRows output
 * @param {Set<string>} ticked
 * @param {{send: (row) => Promise<{applied: Object}>, confirm: (row) => Promise<boolean>, onResult?: Function}} io
 * @returns {Promise<Object<string, {phase: string, text: string}>>} uid -> outcome
 */
export async function applyRows(staging, machineKey, rows, ticked, { send, confirm, onResult }) {
  const out = {};
  const note = (uid, r) => { out[uid] = r; if (onResult) onResult(uid, r); };
  for (const r of rows) {
    if (r.inert || !ticked.has(r.uid)) continue;
    if (r.confirm && !(await confirm(r))) { note(r.uid, { phase: 'fault', text: 'not confirmed' }); continue; }
    note(r.uid, { phase: 'pending', text: 'sent' });
    try {
      const echo = await send(r);
      const applied = echo && echo.applied && echo.applied[r.field.settingKey];
      if (applied === undefined) { note(r.uid, { phase: 'fault', text: 'not in the echo' }); continue; }
      unstage(staging, machineKey, r.uid);
      note(r.uid, { phase: 'settled', text: 'applied ' + String(applied) });
    } catch (e) {
      const nacked = e && e.code != null;
      note(r.uid, { phase: 'fault', text: nacked ? e.name + (e.detail ? ': ' + e.detail : '') : String((e && e.message) || e) });
    }
  }
  return out;
}
