/**
 * anomaly.js -- a device-authored EVENT read in plain words from its
 * channel's own catalog entry (SPEC 9.4, RFC-065).
 *
 * Constraints:
 * - Every word comes from the entry: the kind from `event_kinds`, a field's
 *   words, unit and option labels from its schema. No kind table, no field
 *   name is matched; a field is placed by its declared type, unit and role.
 * - A kind the entry does not label reads as its decimal number, never a guess.
 * - A normalized position becomes mm only when the field declares it: unit
 *   0-1 AND a position role, against the window the machine reported when the
 *   event arrived. Otherwise it stays normalized and says so.
 * - What the catalog does not declare stays raw (`detail 0.72`); Copy and the
 *   detail list always carry every field as sent.
 */
import { UNIT_ID } from '../../../Valence/clients/js/index.js';
import { optionLabel, formatValue, formatWithUnit, unitOf, descLabel } from './format.js';
import { humanize, reportedValue } from './settings.js';
import { ROLE } from './roles.js';

const POSITION_ROLES = new Set([ROLE.commandPosition, ROLE.telemetryTarget, ROLE.telemetryPosition]);
// Seconds per unit, for a stamp or span in a registry time unit.
const TIME_S = { [UNIT_ID.us]: 1e-6, [UNIT_ID.ms]: 1e-3, [UNIT_ID.s]: 1 };

// A unitless integer is a word, a cause or an id: printed as sent, never grouped, never in the sentence.
const isId = (f, v) => Number.isInteger(v) && !unitOf(f) && !(f && /^f/.test(f.typeName));
const word = (name) => humanize(name).toLowerCase();
/** A field's row label: the catalog's own short desc, else its name. */
const labelOf = (f) => descLabel(f) || (f.desc && f.desc.length <= 32 ? f.desc : humanize(f.name));

/** The window the machine reports now, as {lo, hi, field}, or null until both ends are reported. */
export function windowSpan(model, samples) {
  const first = (role) => model && model.byRole && (model.byRole.get(role) || [])[0];
  const lo = first(ROLE.windowMin), hi = first(ROLE.windowMax);
  if (!lo || !hi) return null;
  const a = reportedValue(lo, samples[lo.channelId]), b = reportedValue(hi, samples[hi.channelId]);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? { lo: a, hi: b, field: lo } : null;
}

/** Every body field as sent, decoded by the channel's own schema: [{key, raw, display}]. */
export function bodyRows(evt, entry) {
  if (!evt || !evt.body) return [];
  const byName = new Map(((entry && entry.schema) || []).map((f) => [f.name, f]));
  return Object.keys(evt.body).map((k) => {
    const v = evt.body[k];
    const field = byName.get(k);
    let display;
    if (field && field.options) display = optionLabel(field, v);
    else if (isId(field, v)) display = String(v);
    else if (field) display = formatWithUnit(field, v);
    else if (typeof v === 'number') display = formatValue(null, v);
    else display = String(v);
    return { key: k, raw: v, display };
  });
}

/** The event's kind in words: the entry's label, else the decimal number. */
export function kindWords(evt, entry) {
  const label = entry && entry.eventKinds && entry.eventKinds[evt.kind];
  if (label) return humanize(label);
  return evt.kind == null ? entry.name : entry.name + ' kind ' + evt.kind;
}

/**
 * @param {object} evt   decoded EVENT ({kind, body, ...})
 * @param {object} entry the emitting channel's catalog entry
 * @param {object|null} span windowSpan() at arrival
 * @returns {{text: string, facts: {label: string, display: string}[], rawText: string}}
 *   `text` is the row's sentence, `facts` the detail list, `rawText` every field as sent.
 */
export function describeEvent(evt, entry, span) {
  const rows = bodyRows(evt, entry);
  const byName = new Map(((entry && entry.schema) || []).map((f) => [f.name, f]));
  const phrases = [];
  const where = [];
  const facts = [{ label: 'Event kind', display: kindWords(evt, entry) + (evt.kind == null ? '' : ' (' + evt.kind + ')') }];
  for (const r of rows) {
    const f = byName.get(r.key);
    let shown = r.display;
    if (f && TIME_S[f.unitId] != null && typeof r.raw === 'number') shown = (r.raw * TIME_S[f.unitId]).toFixed(3) + ' s';
    facts.push({ label: f ? labelOf(f) : r.key, display: shown });
    if (!f || typeof r.raw !== 'number') continue;
    if (f.options) phrases.push(r.display);
    else if (TIME_S[f.unitId] != null) continue;
    else if (f.unitId === UNIT_ID.normalized && POSITION_ROLES.has(f.role) && span) {
      where.push('at ' + formatWithUnit(span.field, span.lo + r.raw * (span.hi - span.lo)));
    } else if (isId(f, r.raw)) continue;
    else phrases.push(word(f.name) + ' ' + r.display);
  }
  return {
    text: [kindWords(evt, entry), ...phrases, ...where].join(' · '),
    facts,
    rawText: rows.map((r) => r.key + '=' + r.display).join(' '),
  };
}
