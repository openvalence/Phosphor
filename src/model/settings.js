/**
 * settings.js — the catalog -> renderable model transform (RFC-009).
 *
 * NOTHING HERE KNOWS ANY DEVICE. No channel id, no field name, no option
 * label appears below. The input is a decoded catalog; the output is a tree of
 * tabs -> cards -> fields with a widget already chosen for each. Point it at a
 * machine that does not exist yet and it produces that machine's settings page.
 *
 * The one thing this file DOES know is the PROTOCOL's own vocabulary — packed
 * type numbers, the `role` strings from the registry, the `setting_key`
 * presence rule. That is not device knowledge: a role like `window.min` is
 * defined by the registry and means the same thing on every conforming hub,
 * whereas channel 0x1000 means something only here. Binding to the former is
 * portable; binding to the latter is the disease. See roles.js.
 *
 * Pure and synchronous — no session, no DOM, no reactivity. That makes it
 * testable against a fixture catalog with no device present, which is exactly
 * how the "renders a machine it has never met" claim gets checked in CI.
 */

import {
  PACKED, UI_RANK, UI_ARCHETYPE, VALUE_ASPECT, UI_CATEGORY, SAFETY_OP, FIELD_ROLE, LIMITS,
} from '../../../Valence/clients/js/index.js';
import { ROLE, ROLE_LABEL, isActionRole } from './roles.js';
import { isPersistentAction } from './actions.js';

// ---------------------------------------------------------------------------
// Archetype derivation (RENDERING.md §8.2) and its widget projection
// ---------------------------------------------------------------------------
//
// An ARCHETYPE is the interaction contract — normative, spec-derived, the same
// on every conforming client. A WIDGET is this client's pixels for it. Keeping
// them separate is what lets a `select` draw as a segmented row here and as a
// scroll wheel on a glance-class screen while both stay conformant (§8).

/**
 * WIDGET KINDS — this renderer's projections. Most are an archetype 1:1; the
 * three that are not (`segmented`, `bitfield`, `secret`) are pixel-level
 * variants chosen from facts §8.2 deliberately does not rank: how many options
 * fit on one row, whether the bits are named, whether the value is withheld.
 */
export const WIDGET = {
  readout: 'readout',     // §8.2 rows 12/13: no setting_key, display only
  indicator: 'indicator', // §8.2 row 14: read-only boolean/bitfield status
  toggle: 'toggle',       // row 7
  segmented: 'segmented', // row 8, small option set: all choices worth showing
  select: 'select',       // row 8, larger option set
  bitfield: 'bitfield',   // row 7 composed: named bits -> a toggle per bit
  slider: 'slider',       // row 9
  stepper: 'stepper',     // row 10
  text: 'text',           // row 11
  secret: 'secret',       // row 11 + flags.secret: value never on the wire
  action: 'action',       // row 6 (`trigger`), discovered by role in pass 2
  range: 'range',         // RENDERING §11: a tagged min/max pair, one dual-thumb control
  color: 'color',         // row 16: a group's color.red/green/blue, one picker
  datetime: 'datetime',   // row 17: a datetime.* field, hub time shown as wall time
  // Builder presentations (DESIGN §10.2): never derived, only chosen by a user.
  knob: 'knob',           // a bounded numeric as a rotary control
  bar: 'bar',             // a bounded value as a meter
  numeral: 'numeral',     // a value as a hero numeral
  graph: 'graph',         // a numeric as a time series from the client ring
};

export const NUMERIC_TYPES = new Set([
  PACKED.u8, PACKED.i8, PACKED.u16, PACKED.i16,
  PACKED.u32, PACKED.i32, PACKED.f32,
]);
const STRING_TYPES = new Set([PACKED.str16, PACKED.str32, PACKED.str64]);

/**
 * §8.2 rows 9/10 say a bounded numeric is a `slider` when its range is "wide
 * enough for a drag gesture" and a `stepper` otherwise, without pinning a
 * number. THIS IS THAT PIN: at least 20 distinct positions to drag through.
 *
 * The number is a floor on drag RESOLUTION, not on the span — 0..1 by 0.05 is
 * a fine slider, 1..10 by 1 is not, and both are bounded. Raising it much
 * turns whole cards of 25-tick modulation controls into spinners; lowering it
 * lets a 9-position control pretend a drag can hit its middle value.
 */
export const DRAG_TICKS_MIN = 20;

/** RFC-083: the roles that carry a hub-time moment (unit hub_s). */
export const DATETIME_ROLES = new Set([FIELD_ROLE.datetime_moment, FIELD_ROLE.datetime_start, FIELD_ROLE.datetime_end]);
const COLOR_ROLES = [FIELD_ROLE.color_red, FIELD_ROLE.color_green, FIELD_ROLE.color_blue];

/**
 * How many distinct values the range holds, or null when it has no bounds.
 *
 * An unannotated `step` is not "no quantization": an integer wire type is
 * quantized by its own representation, at 1/scale of a display unit (a u8
 * counting 1..10 has 9 ticks and belongs on a stepper even though it declares
 * no step). Only a float with no step is genuinely continuous — Infinity, so
 * it always reads as drag-worthy.
 */
function ticksOf(f) {
  if (f.min == null || f.max == null) return null;
  const quantum = f.step || (f.type === PACKED.f32 ? 0 : 1 / (f.scale || 1));
  if (!quantum) return Infinity;
  return (f.max - f.min) / quantum;
}

/**
 * Does a 2-option set read as a boolean? Purely a PRESENTATION upgrade — the
 * wire value stays the option index either way, so guessing wrong costs a
 * nicer-looking control, never a wrong value.
 */
const BOOLEAN_PAIRS = [
  ['off', 'on'], ['disabled', 'enabled'], ['no', 'yes'], ['false', 'true'],
];
function looksBoolean(options) {
  if (!options || options.length !== 2) return false;
  const lo = options.map((o) => String(o).trim().toLowerCase());
  return BOOLEAN_PAIRS.some((p) => p[0] === lo[0] && p[1] === lo[1]);
}

/**
 * There is no `bool` packed type, so a boolean arrives wearing one of two
 * disguises: an off/on option pair, or an integer bounded to exactly [0,1].
 * Both are what §8.2 rows 7 and 14 mean by "bool field".
 */
function looksBooleanField(f) {
  if (f.options && f.options.length) return looksBoolean(f.options);
  return f.min === 0 && f.max === 1 && f.type !== PACKED.f32 && NUMERIC_TYPES.has(f.type);
}

/**
 * RENDERING.md §8.2's decision table, evaluated top to bottom, first match
 * wins. Returns a `UI_ARCHETYPE` code.
 *
 * Rows 2-5 are absent BY DESIGN, not by omission: `stop` is bound to
 * safety-op identity (row 2) and lives in the safety UI; `axis`, `pad2d` and
 * `list` are claimed by hero widgets from roles before a field reaches here
 * (roles.js). Row 16 (`color`) is a group of three fields, merged per card
 * group by mergeComposites below; row 17 (`datetime`) binds by role here
 * (RFC-083: no archetype hint exists). Row 6 is the action pass at the bottom
 * of this file.
 */
export function resolveArchetype(f) {
  // Read-only wins over everything below it: a field with no setting_key is
  // effective truth and must never render as something you can push, no matter
  // how invitingly typed it is.
  if (f.readOnly) {
    if (f.aspect === VALUE_ASPECT.rate) return UI_ARCHETYPE.chart;         // row 15
    if (looksBooleanField(f) || f.type === PACKED.bitfield8) return UI_ARCHETYPE.indicator;  // row 14
    return UI_ARCHETYPE.readout;                                           // rows 12/13
  }

  if (DATETIME_ROLES.has(f.role)) return UI_ARCHETYPE.datetime;           // row 17
  if (looksBooleanField(f)) return UI_ARCHETYPE.toggle;                    // row 7
  if (f.options && f.options.length) return UI_ARCHETYPE.select;           // row 8
  // A writable named-bit bitfield8 is a SET of booleans — row 7 composed the
  // way §8.4 composes pad2d out of sliders. §8.2 has no row of its own for it;
  // if one ever lands, this line is where it goes.
  if (f.type === PACKED.bitfield8) return UI_ARCHETYPE.toggle;
  if (STRING_TYPES.has(f.type)) return UI_ARCHETYPE.text;                  // row 11

  // Rows 9/10, plus the case neither row names: a writable numeric with no
  // bounds at all. It cannot be dragged against a range it never published, so
  // it lands on the stepper with the rest of the type-in controls.
  const ticks = ticksOf(f);
  // `step` rides the wire as an f32, so an exactly-N-tick range computes a hair
  // under N (0..1 by 0.05 gives 19.9999997). Compare with float slack or every
  // round-decimal step lands on the wrong side of the pin.
  return (ticks != null && ticks >= DRAG_TICKS_MIN * (1 - 1e-6))
    ? UI_ARCHETYPE.slider
    : UI_ARCHETYPE.stepper;
}

/**
 * Project a derived archetype onto this renderer's controls.
 *
 * `chart` has no generic control — the only time-series drawing we own is a
 * hero widget with a subscription behind it, and a lone catalog field has
 * neither. §14d's fallback rule and §8.4's "glance degrades to sparkline/value"
 * both make the plain numeral a conformant answer, so it takes one.
 */
export function resolveWidget(f) {
  const a = f.archetype != null ? f.archetype : resolveArchetype(f);
  switch (a) {
    case UI_ARCHETYPE.indicator:
      return WIDGET.indicator;
    case UI_ARCHETYPE.toggle:
      return (f.type === PACKED.bitfield8 && f.bits) ? WIDGET.bitfield : WIDGET.toggle;
    case UI_ARCHETYPE.select:
      return f.options.length <= 4 ? WIDGET.segmented : WIDGET.select;
    case UI_ARCHETYPE.slider:
      return WIDGET.slider;
    case UI_ARCHETYPE.stepper:
      return WIDGET.stepper;
    case UI_ARCHETYPE.text:
      // `secret` beats `text`: never render a value the wire deliberately
      // withholds (RFC-009.4).
      return (f.flagBits && f.flagBits.secret) ? WIDGET.secret : WIDGET.text;
    case UI_ARCHETYPE.trigger:
      return WIDGET.action;
    case UI_ARCHETYPE.datetime:
      return WIDGET.datetime;
    default:
      return WIDGET.readout;
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Humanize a wire field name for display. The catalog gives us machine names
 * (`window_min`, `chase_dense_ms`); `desc` carries the prose. We are NOT
 * translating known names to pretty ones — that would be a device-knowledge
 * table by another name, and it would leave an unknown machine's fields
 * looking second-class next to ours. Same treatment for everybody.
 */
export function humanize(name) {
  if (!name) return '';
  const s = String(name)
    .replace(/_/g, ' ')
    .replace(/\bovr\b/g, 'override')
    .replace(/\bcfg\b/g, 'config')
    .replace(/\bff\b/g, 'feedforward')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Category display name: device label if it shipped one, else the registry name
 * catalog.js already resolved.
 *
 * The resolution (including unknown -> `other`) lives in catalog.js, not here —
 * this only decides how to WRITE it. An unrecognized id with no label falls
 * back to its number rather than "Other", because the raw id is what actually
 * distinguishes two untaught categories from each other; either way the tab
 * renders and its settings are never dropped on the floor (SPEC 8.8 item 8).
 */
function categoryLabel(entry) {
  if (entry.categoryLabel) return entry.categoryLabel;
  if (entry.categoryKnown && entry.categoryName) {
    return entry.categoryName.charAt(0).toUpperCase() + entry.categoryName.slice(1);
  }
  return 'Category ' + entry.category;
}

// ---------------------------------------------------------------------------
// Field construction
// ---------------------------------------------------------------------------

/**
 * Every enabled_mask field of a layout, in layout order, found by ROLE, not
 * by name (SPEC §8.8: "one or more bitfield8 fields"). Mask k gates setting
 * fields 8k..8k+7.
 *
 * `meta.enabled_mask` is registry vocabulary, so this works on a machine that
 * calls its mask something else entirely. If a hub ships a mask without the
 * role we simply do not gate — graying nothing is a safe failure; graying the
 * WRONG control because we pattern-matched a name would not be. A setting
 * field past the last mask's eighth bit is likewise ungated.
 */
function findMaskFields(layout) {
  return layout ? layout.filter((f) => f.role === ROLE.enabledMask) : [];
}

function makeField(entry, f, settingIndex, masks) {
  const maskField = settingIndex == null ? null : masks[settingIndex >> 3] || null;
  const readOnly = f.settingKey == null || entry.settingChannel == null;
  const out = {
    uid: entry.id + ':' + f.name,
    channelId: entry.id,
    channelName: entry.name,
    name: f.name,
    label: humanize(f.name),
    type: f.type,
    typeName: f.typeName,
    unit: f.unit || '',
    scale: f.scale || 1,
    min: f.min,
    max: f.max,
    // An f32 step carries float noise (0.05 arrives as 0.0500000007, and a range's last stop falls short of
    // max): seven significant digits are all an f32 holds.
    step: f.step && +f.step.toPrecision(7),
    dflt: f.default,
    options: f.options || null,
    desc: f.desc || '',
    group: f.group || '',
    role: f.role || '',
    flags: f.flags || 0,
    flagBits: f.flagBits || { advanced: false, restart_required: false, secret: false },
    rank: f.rank,
    rankName: f.rankName,
    aspect: f.aspect,
    scope: f.scope,
    // RENDERING §6: format.js prefers this over the free `unit` string.
    unitId: f.unitId ?? null,
    // RFC-048 key 22. Which pipeline stage this number is: demand / planned /
    // actual. Absent on the wire means `actual` (the codec resolves that), so
    // this is always set and labelFor() can qualify a label without asking
    // whether the device bothered to say. Load-bearing here: this machine's
    // position field is PLANNED (the motion coprocessor's rendered position),
    // and a label reading "actual" over it would be the UI asserting a
    // measurement nobody made.
    provenance: f.provenance,
    provenanceName: f.provenanceName,
    // ONE truth for the disclosure affordance. RENDERING.md §4 calls ui_ranks
    // `advanced` the migration of the setting_flags.advanced BIT into the rank
    // ladder, so both spellings mean the same thing and a machine may ship
    // either. Deciding it once here keeps every consumer from re-ORing it.
    advanced: f.rank === UI_RANK.advanced || !!(f.flagBits && f.flagBits.advanced),
    // RENDERING §9: diagnostic material goes last, collapsed. A diagnostic
    // CHANNEL makes its unranked (detail-default) fields diagnostic too; a
    // field that ranks itself anything else keeps its own rank.
    diagnostic: f.rank === UI_RANK.diagnostic
      || (entry.rank === UI_RANK.diagnostic && (f.rank ?? UI_RANK.detail) === UI_RANK.detail),
    bits: f.bits || null,
    settingKey: readOnly ? null : f.settingKey,
    writeChannel: readOnly ? null : entry.settingChannel,
    // RFC-009 item 3: bit i of mask k gates the (8k+i)-th SETTING-annotated
    // field of this layout, in layout order. Read-only fields do not consume a bit.
    maskFieldName: (!readOnly && maskField) ? maskField.name : null,
    maskBit: readOnly ? null : settingIndex & 7,
    readOnly,
  };
  out.archetype = resolveArchetype(out);
  out.widget = resolveWidget(out);
  return out;
}

// ---------------------------------------------------------------------------
// RENDERING §11: min/max role pairs -> one dual-thumb range control
// ---------------------------------------------------------------------------

/**
 * Registry role pairs that name a [min, max] of the same tagged quantity.
 * `window.min`/`window.max` is the one pair the registry defines today; a
 * future pair of the same shape is added here, never pattern-matched off a
 * field NAME (that would be device knowledge, see roles.js's own doctrine).
 */
const MIN_MAX_ROLE_PAIRS = [[ROLE.windowMin, ROLE.windowMax]];

/**
 * Within one card group, replace a min/max role pair with one merged `range`
 * field carrying both halves (`lo`/`hi`), when both are present, writable and
 * still ordinary sliders. Declines per-pair otherwise (missing half, either
 * side read-only or not a slider) and leaves the fields untouched — an
 * opportunity, never a requirement, the same rule every role binding in this
 * codebase already follows (roles.js).
 */
function mergeRangePairs(fields) {
  let out = fields;
  for (const [minRole, maxRole] of MIN_MAX_ROLE_PAIRS) {
    const lo = out.find((f) => f.role === minRole && f.widget === WIDGET.slider && !f.readOnly);
    const hi = out.find((f) => f.role === maxRole && f.widget === WIDGET.slider && !f.readOnly);
    if (!lo || !hi) continue;
    const loL = ROLE_LABEL[minRole] || lo.label;
    const hiL = ROLE_LABEL[maxRole] || hi.label;
    const stripLo = loL.replace(/\bmin\b/i, '').replace(/\s+/g, ' ').trim();
    const stripHi = hiL.replace(/\bmax\b/i, '').replace(/\s+/g, ' ').trim();
    const label = (stripLo && stripLo.toLowerCase() === stripHi.toLowerCase()) ? stripLo : loL + ' / ' + hiL;
    const range = {
      uid: lo.uid + '+' + hi.uid,
      widget: WIDGET.range,
      label,
      group: lo.group,
      // Both halves are the SAME channel in every case the registry defines
      // today (window.min/window.max are settings of one channel); carried
      // here only so a channel census over the generic tree (grouping,
      // per-channel counts) still finds this merged field's channel.
      channelId: lo.channelId,
      advanced: lo.advanced || hi.advanced,
      flagBits: { restart_required: !!(lo.flagBits && lo.flagBits.restart_required)
                        || !!(hi.flagBits && hi.flagBits.restart_required) },
      lo, hi,
    };
    out = [range, ...out.filter((f) => f !== lo && f !== hi)];
  }
  return out;
}

/**
 * RENDERING §8.2 row 16 (RFC-083): a group's writable numeric color.red,
 * color.green and color.blue become one `color` field carrying `r`/`g`/`b`.
 * A missing, read-only or unbounded channel leaves the three as they are.
 * The roles repeat once per group (SPEC §8.8), so callers pass one group.
 */
function mergeColor(fields) {
  const [r, g, b] = COLOR_ROLES.map((role) => fields.find((f) => f.role === role && !f.readOnly
    && f.min != null && f.max != null && f.max > f.min && NUMERIC_TYPES.has(f.type)));
  if (!r || !g || !b) return fields;
  const color = {
    uid: r.uid + '+' + g.uid + '+' + b.uid,
    widget: WIDGET.color,
    archetype: UI_ARCHETYPE.color,
    label: r.group || 'Color',
    group: r.group,
    channelId: r.channelId,
    writeChannel: r.writeChannel,
    readOnly: false,
    advanced: r.advanced || g.advanced || b.advanced,
    flagBits: { restart_required: [r, g, b].some((f) => f.flagBits && f.flagBits.restart_required) },
    r, g, b,
  };
  return [color, ...fields.filter((f) => f !== r && f !== g && f !== b)];
}

/** Every composite one card group draws as a single control: §11 ranges, §8.2 row 16 colors. */
const mergeComposites = (fields) => mergeColor(mergeRangePairs(fields));

/**
 * A group string as {section, title}: the first LIMITS.group_section_separator
 * splits the section from the card title; none is a card with no section
 * (RENDERING §3, RFC-096; DESIGN §10.11). The wire string is unchanged; `name`
 * stays the card's key.
 */
export function splitGroup(name) {
  const sep = LIMITS.group_section_separator;
  const i = name.indexOf(sep);
  return i < 0 ? { section: '', title: name } : { section: name.slice(0, i), title: name.slice(i + sep.length) };
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Build the full renderable settings model from a decoded catalog.
 *
 * @param {Array<Object>} entries decoded catalog entries
 * @returns {{
 *   categories: Array<Object>,   // tabs, each with groups -> fields
 *   actions: Array<Object>,      // INTENT verbs discovered by role
 *   byRole: Map<string, Array>,  // role -> fields, for hero widgets to claim
 *   fields: Array<Object>,       // flat list of every field, settings + readouts
 * }}
 */
export function buildSettingsModel(entries) {
  const fields = [];
  const byRole = new Map();
  const actions = [];

  const addRole = (role, item) => {
    if (!role) return;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(item);
  };

  // ---- pass 1: every layout field of every CATEGORIZED channel -----------
  //
  // Categorization is the device's own statement that a channel belongs on the
  // settings surface. An uncategorized channel is protocol plumbing (safety,
  // control-owner, the session/trust channels) and is rendered by purpose-built
  // UI, not by the generic settings renderer.
  for (const entry of entries) {
    if (!entry.layout) continue;
    const masks = findMaskFields(entry.layout);
    let settingIndex = 0;
    for (const f of entry.layout) {
      // A mask is machinery, not a setting. It gates other fields; it is
      // never drawn.
      if (masks.includes(f)) continue;
      const isSetting = f.settingKey != null && entry.settingChannel != null;
      const field = makeField(entry, f, isSetting ? settingIndex : null, masks);
      // COUNT BEFORE SKIPPING. The enabled_mask's bit i gates the i-th
      // SETTING-annotated field in layout order (RFC-009 item 3) — a rank the
      // client chose not to draw does not remove the field from the hub's own
      // numbering. Skipping before this increment shifts every later field's
      // bit by one and grays the WRONG controls, silently: the reference device
      // ships exactly this shape (a rank=hidden field holding settingKey 4).
      if (isSetting) settingIndex++;
      // rank=hidden: carried on the wire for compatibility, NEVER rendered
      // (RENDERING.md §4). Dropped before it reaches `fields` OR `byRole`, so a
      // hero widget cannot resurrect it by claiming its role either. This is
      // the machine's own statement that a released-but-inert field should stop
      // showing up — do not add an "unhide" affordance, that defeats the point.
      if (f.rank === UI_RANK.hidden) continue;
      // Roles are indexed for EVERY field, categorized or not — a hero widget
      // wants `telemetry.position` from the motion channel, which carries no
      // category because it is not a setting.
      addRole(field.role, field);
      fields.push(field);
    }
  }

  // RENDERING §5.4 companions: a peak readout rides its live twin (same
  // channel and group, same role, else same unit) as a marker, and leaves
  // the group. No twin: it stays a standalone readout, labeled as a peak.
  const sameUnit = (a, b) => (a.unitId != null ? a.unitId === b.unitId : !!a.unit && a.unit === b.unit);
  for (const p of fields) {
    if (p.aspect !== VALUE_ASPECT.peak || !p.readOnly) continue;
    const live = fields.find((f) => f.channelId === p.channelId && f.group === p.group
      && f.readOnly && !f.aspect && !f.peak
      && (p.role ? f.role === p.role : sameUnit(f, p)));
    if (live) { live.peak = p; p.companionOf = live.uid; }
  }

  // ---- pass 2: INTENT schema fields that are ACTIONS ----------------------
  //
  // RFC-019: `action.<name>` is an open role convention. A schema field tagged
  // with one is a verb — home, clear fault, save — and renders as a button
  // rather than a value editor. Without this, actions are undiscoverable and
  // every client hardcodes them, which is precisely what we are killing.
  for (const entry of entries) {
    if (!entry.schema) continue;
    for (const f of entry.schema) {
      if (f.rank === UI_RANK.hidden) continue;   // same law as pass 1
      // Index EVERY roled schema field, not just the verbs.
      //
      // An INTENT field can carry a role that names a VALUE rather than an
      // action — the target position of a move, say. Those are not buttons and
      // must not become actions, but a widget still has to be able to FIND
      // them: without this, the rail's tap-to-move had no generic way to reach
      // the move channel and correctly refused to guess one, leaving the
      // instrument read-only on every machine.
      if (f.role && !isActionRole(f.role)) {
        addRole(f.role, {
          uid: entry.id + ':' + f.key,
          channelId: entry.id,
          channelName: entry.name,
          key: f.key,
          name: f.name,
          label: humanize(f.name),
          desc: f.desc || '',
          role: f.role,
          unit: f.unit || '',
          unitId: f.unitId ?? null,
          min: f.min,
          max: f.max,
          access: f.access != null ? f.access : entry.access,
          isIntentField: true,      // write with sendIntent, NOT writeSetting
        });
        continue;
      }
      if (!isActionRole(f.role)) continue;
      const act = {
        uid: entry.id + ':' + f.key,
        channelId: entry.id,
        channelName: entry.name,
        key: f.key,
        name: f.name,
        label: humanize(f.name),
        desc: f.desc || '',
        role: f.role,
        options: f.options || null,
        optionAccess: f.optionAccess || null,
        // RFC-063: actions.js isDestructive reads these two.
        flagBits: f.flagBits || null,
        destructiveOptions: f.destructiveOptions || null,
        access: f.access != null ? f.access : entry.access,
        group: f.group || '',
        type: f.type,
        // The other schema fields of the same INTENT ride with the op (a
        // preset's slot and name, say). Roled value fields are claimed by
        // their own widgets and never ride here.
        payload: entry.schema.filter((p) => p !== f && !p.role && p.rank !== UI_RANK.hidden)
          .map((p) => ({ key: p.key, name: p.name, label: humanize(p.name), desc: p.desc || '',
                         type: p.type, unit: p.unit || '', min: p.min, max: p.max,
                         secret: !!(p.flagBits && p.flagBits.secret) })),
        archetype: UI_ARCHETYPE.trigger,   // §8.2 row 6
        widget: WIDGET.action,
      };
      addRole(act.role, act);
      actions.push(act);
    }
  }

  // ---- pass 3: group into tabs and cards ----------------------------------
  //
  // SPEC 8.8: a CATEGORY SPANS CHANNELS. Two channels sharing a category merge
  // into one tab. That is what lets 20 tuning knobs live across three channels
  // (each capped at 8 settings by its bitfield8 mask) and still present as one
  // Tuning section of one tab. Keying the map on the category NUMBER is what makes the
  // merge happen; keying it on the channel would draw three unrelated tabs.
  const catMap = new Map();
  const place = (field) => {
    const entry = entries.find((e) => e.id === field.channelId);
    if (entry.category == null) return false;   // uncategorized: not a settings tab
    const key = entry.category;
    if (!catMap.has(key)) {
      catMap.set(key, {
        key,
        id: entry.category,
        name: entry.categoryKnown ? entry.categoryName : ('category' + entry.category),
        label: categoryLabel(entry),
        known: !!entry.categoryKnown,
        groups: new Map(),
        diagGroups: new Map(),
        // A category is writable if ANY of its channels names a settingChannel.
        // A purely read-only category (diagnostics) still gets a tab — telemetry
        // is worth showing — it just contains no inputs.
        writable: false,
      });
    }
    const cat = catMap.get(key);
    if (!field.readOnly) cat.writable = true;
    const gname = field.group || '';
    const bucket = field.diagnostic ? cat.diagGroups : cat.groups;
    if (!bucket.has(gname)) {
      bucket.set(gname, { name: gname, ...splitGroup(gname), diagnostic: field.diagnostic, fields: [] });
    }
    bucket.get(gname).fields.push(field);
    return true;
  };
  // A client-to-hub stream is what a client sends; the hub never reports it,
  // so it has no value a page could show (law 9). Heroes still bind it by role.
  const sentOnly = (f) => { const e = entries.find((x) => x.id === f.channelId); return e.clsName === 'STREAM' && e.dirName === 'c2h'; };
  for (const field of fields) if (!sentOnly(field)) place(field);

  // Generic triggers (§8.2 row 6) join their channel's category like any
  // field. Uncategorized ones are `looseActions`: a home module and the
  // `other` overflow page (RENDERING §3; App.svelte). The
  // persistent region's verbs (safety, home) are drawn there, never twice.
  // settings-trial's op (RFC-099) is never a generic trigger: it acts only on
  // the sender's own trials, and the generic renderer makes none.
  const looseActions = actions.filter((a) => !isPersistentAction(a) && a.role !== 'action.trial' && !place(a));

  // Tabs in registry order (RENDERING §12). An unrecognized or vendor id sorts
  // where `other` does (§3), keeping its own tab and label; never dropped.
  // Within a tab, catalog declaration order, diagnostic groups last (§9);
  // cards with no section first, then each section's cards together, sections
  // in order of first appearance (DESIGN §10.11).
  const rankOf = (c) => (c.known ? c.id : UI_CATEGORY.other);
  const categories = [...catMap.values()]
    .sort((a, b) => (rankOf(a) - rankOf(b)) || (a.id - b.id))
    .map(({ diagGroups, ...c }) => {
      // A peak drawn on its live twin leaves its group.
      const groups = [...c.groups.values(), ...diagGroups.values()]
        .map((g) => ({ ...g, fields: mergeComposites(g.fields.filter((f) => !f.companionOf)) }))
        .filter((g) => g.fields.length);
      const order = [...new Set(['', ...groups.map((g) => g.section)])];
      return { ...c, groups: groups.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section)) };
    });

  return { categories, actions, looseActions, byRole, fields };
}

/**
 * The home screen's default surfacing under a renderer class, minus what a
 * Tier-1 widget claimed. RENDERING §4/§12: hero on every class, control on
 * handheld and full, one navigation step away (its category page) on glance.
 * Detail and below are never surfaced here; they stay reachable on their
 * category page, so this adds a surface and never gates one. Unranked and
 * unknown ranks are detail (§4) and fail the bound.
 */
export function surfacedFields(fields, claimed, cls) {
  const max = cls === 'glance' ? UI_RANK.hero : UI_RANK.control;
  return mergeComposites(fields.filter((f) =>
    f.rank <= max && !f.advanced && !f.companionOf && !claimed.has(f.uid)));
}

// ---------------------------------------------------------------------------
// The control contract (DESIGN §10.2): presentation registry and placement
// ---------------------------------------------------------------------------

/**
 * ph-e82.1 item 2. true: the read/write-class rule of the RFC-080 draft, item
 * 3 (any writable presentation for a writable field, plus display-only
 * read-only ones). false: only the derived archetype's own projections (the
 * conservative read of RENDERING §8.2 first match). true codes against a
 * DRAFT RFC by operator ruling 2026-10-01 (DESIGN §10.2); if RFC-080 is
 * rejected or amended, this follows it.
 */
export const CROSS_ARCHETYPE = true;

/** Each archetype's projections, keyed by UI_ARCHETYPE code. */
export const PRESENTATIONS = {
  [UI_ARCHETYPE.readout]: [WIDGET.readout, WIDGET.bar, WIDGET.numeral],
  [UI_ARCHETYPE.indicator]: [WIDGET.indicator],
  [UI_ARCHETYPE.chart]: [WIDGET.graph, WIDGET.readout, WIDGET.numeral],
  [UI_ARCHETYPE.toggle]: [WIDGET.toggle, WIDGET.bitfield],
  [UI_ARCHETYPE.select]: [WIDGET.segmented, WIDGET.select],
  [UI_ARCHETYPE.slider]: [WIDGET.slider, WIDGET.knob],
  [UI_ARCHETYPE.stepper]: [WIDGET.stepper, WIDGET.knob],
  [UI_ARCHETYPE.text]: [WIDGET.text, WIDGET.secret],
  [UI_ARCHETYPE.trigger]: [WIDGET.action],
  [UI_ARCHETYPE.color]: [WIDGET.color],
  [UI_ARCHETYPE.datetime]: [WIDGET.datetime, WIDGET.readout],
};

/** Presentations that write nothing: on a writable field, a display-only instance. */
export const READ_ONLY_PRESENTATIONS = new Set([
  WIDGET.readout, WIDGET.indicator, WIDGET.bar, WIDGET.numeral, WIDGET.graph,
]);
const WRITABLE_PRESENTATIONS = [
  WIDGET.slider, WIDGET.knob, WIDGET.stepper, WIDGET.segmented, WIDGET.select,
  WIDGET.toggle, WIDGET.bitfield, WIDGET.text, WIDGET.secret,
];

const bounded = (f) => f.min != null && f.max != null && f.max > f.min;
const plainNumber = (f) => NUMERIC_TYPES.has(f.type) && !(f.options && f.options.length);
const isSecret = (f) => !!(f.flagBits && f.flagBits.secret);

/** The field facts each presentation needs. A presentation absent here needs none. */
const NEEDS = {
  [WIDGET.bar]: (f) => bounded(f) && plainNumber(f),
  [WIDGET.knob]: (f) => bounded(f) && plainNumber(f),
  [WIDGET.slider]: (f) => bounded(f) && plainNumber(f),
  [WIDGET.stepper]: plainNumber,
  [WIDGET.toggle]: (f) => looksBooleanField(f) || (f.type === PACKED.bitfield8 && !f.bits),
  [WIDGET.indicator]: (f) => looksBooleanField(f) || f.type === PACKED.bitfield8,
  [WIDGET.bitfield]: (f) => f.type === PACKED.bitfield8 && !!f.bits,
  [WIDGET.segmented]: (f) => !!(f.options && f.options.length),
  [WIDGET.select]: (f) => !!(f.options && f.options.length),
  [WIDGET.text]: (f) => STRING_TYPES.has(f.type) && !isSecret(f),
  [WIDGET.secret]: (f) => STRING_TYPES.has(f.type) && isSecret(f),
  // The history ring is the graph presentation's own (Field.svelte).
  [WIDGET.graph]: (f) => plainNumber(f) && !looksBooleanField(f),
  [WIDGET.numeral]: (f) => NUMERIC_TYPES.has(f.type) && !isSecret(f),
};

/** A field a toggle can write two values of: a bool, two or more options, or bounds (RFC-080 draft item 5). */
const twoValued = (f) => NEEDS[WIDGET.toggle](f) || (bounded(f) && plainNumber(f)) || !!(f.options && f.options.length >= 2);

/**
 * The presentations a user may pick for one field, its derived widget first.
 * The user chooses how a field looks, never what it binds (laws 6, 7).
 */
export function offeredPresentations(f, crossArchetype = CROSS_ARCHETYPE) {
  if (f.widget === WIDGET.range || f.widget === WIDGET.action || f.widget === WIDGET.color) return [f.widget];
  if (f.widget === WIDGET.datetime) return [f.widget, WIDGET.readout];
  const pool = !crossArchetype ? (PRESENTATIONS[f.archetype] || [])
    : f.readOnly ? [...READ_ONLY_PRESENTATIONS]
    : [...WRITABLE_PRESENTATIONS, ...READ_ONLY_PRESENTATIONS];
  const out = [f.widget];
  for (const p of pool) {
    const need = crossArchetype && p === WIDGET.toggle ? twoValued : NEEDS[p];
    if (!out.includes(p) && (!need || need(f))) out.push(p);
  }
  return out;
}

/** Range presentations: a placement may narrow min, max, step and default (RFC-080 draft item 4). */
export const RANGE_PRESENTATIONS = new Set([WIDGET.slider, WIDGET.knob, WIDGET.stepper, WIDGET.bar]);

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const whole = (x) => Math.abs(x - Math.round(x)) < 1e-9;
const toggleDefaults = (f) => (NEEDS[WIDGET.toggle](f) || f.options ? [0, 1] : [f.min, f.max]);
const toggleFits = (f, v) => (f.options && f.options.length ? whole(v) && v >= 0 && v < f.options.length
  : NEEDS[WIDGET.toggle](f) ? v === 0 || v === 1
  : bounded(f) && v >= f.min && v <= f.max);

/**
 * A placement's look applied to its field (DESIGN §10.2; RFC-080 draft items 3
 * to 5). `look` is the placement entry's {pres, min, max, step, default, a, b};
 * every part is optional. Returns {pres, field, kind, toggle, errors}:
 * - pres: the look's presentation when the field still offers it, else the
 *   derived widget.
 * - field: the field narrowed for display and the write clamp only (the hub
 *   stays the referee). `narrowed` marks a placement range tighter than the
 *   catalog's; `toggle` {a, b} marks a toggle that is not plain off/on.
 * - kind: 'range' or 'toggle' when the presentation takes per-placement
 *   config, else null.
 * - errors: a refused part in words; that part keeps the catalog's value.
 * A placement narrows, never widens; a step is a whole multiple of the
 * catalog step; the default lies inside the placement's range; a toggle's
 * two values differ and lie inside the field's range.
 */
export function placementLook(f, look, crossArchetype = CROSS_ARCHETYPE) {
  const l = look && typeof look === 'object' ? look : {};
  const offered = offeredPresentations(f, crossArchetype);
  const pres = offered.includes(l.pres) ? l.pres : offered[0];
  const errors = [];
  let field = f, kind = null, toggle = null;
  if (RANGE_PRESENTATIONS.has(pres) && bounded(f) && plainNumber(f)) {
    kind = 'range';
    let min = num(l.min) ?? f.min, max = num(l.max) ?? f.max;
    if (!(min >= f.min && max <= f.max && min < max)) {
      errors.push('range must lie inside ' + f.min + ' to ' + f.max);
      min = f.min; max = f.max;
    }
    let step = num(l.step) ?? f.step;
    if (step != null && !(step > 0 && (!f.step || whole(step / f.step)))) {
      errors.push('step must be a whole multiple of ' + f.step);
      step = f.step;
    }
    let dflt = num(l.default) ?? f.dflt;
    if (dflt != null && !(dflt >= min && dflt <= max)) {
      if (num(l.default) != null) errors.push('default must lie inside the range');
      dflt = f.dflt != null && f.dflt >= min && f.dflt <= max ? f.dflt : null;
    }
    if (min !== f.min || max !== f.max || step !== f.step || dflt !== f.dflt) {
      field = { ...f, min, max, step, dflt, narrowed: min !== f.min || max !== f.max, ownDefault: dflt !== f.dflt };
    }
  } else if (pres === WIDGET.toggle && !f.readOnly) {
    kind = 'toggle';
    const [da, db] = toggleDefaults(f);
    let a = num(l.a) ?? da, b = num(l.b) ?? db;
    if (!(a !== b && toggleFits(f, a) && toggleFits(f, b))) {
      errors.push('toggle needs two distinct in-range values');
      a = da; b = db;
    }
    toggle = { a, b };
    if (!NEEDS[WIDGET.toggle](f) || a !== 0 || b !== 1) field = { ...f, toggle };
  }
  return { pres, field, kind, toggle, errors };
}

/**
 * Minimum footprint in grid cells, [w, h], per orientation. Starting values,
 * tuned on the grid, not derived.
 */
const MIN_CELLS = {
  [WIDGET.readout]: { h: [4, 1], v: [2, 2] },
  [WIDGET.indicator]: { h: [3, 1], v: [2, 2] },
  [WIDGET.toggle]: { h: [3, 1], v: [2, 2] },
  [WIDGET.segmented]: { h: [6, 1], v: [3, 4] },
  [WIDGET.select]: { h: [4, 1], v: [3, 2] },
  [WIDGET.bitfield]: { h: [6, 2], v: [3, 4] },
  [WIDGET.slider]: { h: [6, 2], v: [2, 6] },
  [WIDGET.stepper]: { h: [5, 1], v: [2, 4] },
  [WIDGET.text]: { h: [6, 1], v: [4, 2] },
  [WIDGET.secret]: { h: [6, 1], v: [4, 2] },
  [WIDGET.action]: { h: [4, 2], v: [3, 3] },
  [WIDGET.range]: { h: [8, 2], v: [8, 2] },   // one layout: a dual-thumb track stays horizontal
  [WIDGET.knob]: { h: [3, 3], v: [3, 3] },
  [WIDGET.bar]: { h: [4, 1], v: [1, 4] },
  [WIDGET.numeral]: { h: [4, 2], v: [3, 3] },
  [WIDGET.graph]: { h: [6, 3], v: [4, 4] },
  [WIDGET.color]: { h: [4, 2], v: [3, 3] },
  [WIDGET.datetime]: { h: [6, 1], v: [4, 2] },
};
const COMPOSITE_CELLS = { h: [8, 4], v: [4, 8] };
const SMALL_CONTROLS = new Set([WIDGET.knob, WIDGET.toggle, WIDGET.indicator, WIDGET.action]);

/** True when a field's presentation is text or a number row: the 16 rem field floor binds it. A knob, toggle, indicator or action keeps its measured minimum. */
export const textFloored = (presentation) => !SMALL_CONTROLS.has(presentation);
const SAFETY_CELLS = { h: [3, 2], v: [2, 3] };

/** Orientation follows a control's own aspect: w >= h is horizontal. */
export function orientationOf(w, h) {
  return w >= h ? 'h' : 'v';
}

/** [w, h] in cells for a presentation (or a control's declared `cells`). */
export function minCells(presentationOrCells, orientation = 'h') {
  const c = typeof presentationOrCells === 'string' ? MIN_CELLS[presentationOrCells] : presentationOrCells;
  return (c || COMPOSITE_CELLS)[orientation === 'v' ? 'v' : 'h'];
}

/**
 * Persisted key for a single-field control (law 10): its registry role when
 * it is that role's first-authored field, else its uid. The uid (channel id
 * plus field name) is the RFC-080 draft's user-surface carve-out
 * (ph-e82.1 item 3); a key the catalog no longer resolves stays inert.
 * Compares uids, never object identity: in the app `fields` are $state
 * proxies while `byRole` (a Map) holds the raw objects (ph-e82.9).
 */
export function controlKey(f, byRole) {
  if (f.lo && f.hi) return controlKey(f.lo, byRole) + '+' + controlKey(f.hi, byRole);
  const first = f.role && byRole && byRole.get(f.role);
  return first && first[0].uid === f.uid ? 'role:' + f.role : uidKey(f);
}

/** The all-uid key. Builds before ph-e82.9 saved role fields under it; placements accept it as an alias. */
const uidKey = (f) => (f.lo && f.hi ? uidKey(f.lo) + '+' + uidKey(f.hi) : 'uid:' + f.uid);

/**
 * Everything a builder palette may place, one entry per control:
 *   {key, kind: 'field'|'composite'|'plugin'|'safety', cells, ...}
 * field: `field`, `presentations` (default first), and `alias`, the uid-form
 * key a role field also answers to (null when the key is already uid-form). composite/plugin: the
 * claimed `hero` from heroClaims (claim-or-decline unchanged, law 7).
 * safety: the safety-intents `action` and one pair's first `op` (estop or
 * pause: one control per pair, law 14), bound by identity (law 2); the top
 * strip's own pair is not one of these and never moves. override/return is
 * the rail's (SPEC §11.1), never a module.
 *
 * @param {Object} model buildSettingsModel output
 * @param {{heroes?: Array, safety?: Object|null}} [o] claimed hero widgets;
 *        machine.svelte.js specSafetyAction()
 */
export function placeableControls(model, { heroes = [], safety = null } = {}) {
  if (!model) return [];
  const out = [];
  const singles = mergeComposites(model.fields.filter((f) => !f.companionOf));
  for (const f of [...singles, ...model.actions]) {
    const key = controlKey(f, model.byRole);
    out.push({ key, alias: key === uidKey(f) ? null : uidKey(f), kind: 'field', field: f,
      presentations: offeredPresentations(f) });
  }
  for (const h of heroes) {
    out.push({ key: 'hero:' + h.id, kind: h.plugin ? 'plugin' : 'composite', hero: h,
      cells: h.cells || COMPOSITE_CELLS });
  }
  const ops = (safety && safety.options) || [];
  for (const [name, op] of [['estop', SAFETY_OP.estop], ['pause', SAFETY_OP.pause]]) {
    if (ops[op]) out.push({ key: 'safety:' + name, kind: 'safety', action: safety, op, cells: SAFETY_CELLS });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live-state helpers
// ---------------------------------------------------------------------------

/**
 * Is this field currently writable, per the device's own live enabled_mask?
 *
 * Ground truth, not a guess: the mask arrives in the same retained STATE
 * snapshot as the values, so the client grays from exactly what the hub would
 * refuse. RFC-009 item 3.
 *
 * @param {Object} field from buildSettingsModel
 * @param {Object} sample the decoded STATE sample for field.channelId
 * @returns {boolean}
 */
export function isFieldEnabled(field, sample) {
  if (field.readOnly) return false;
  if (!field.maskFieldName || field.maskBit == null) return true;
  if (!sample) return false;            // no snapshot yet: not yet writable
  const mask = sample[field.maskFieldName];
  if (typeof mask !== 'number') return true;   // machine did not publish it
  return (mask & (1 << field.maskBit)) !== 0;
}

/** Roles whose write starts motion; a run flag is not a value to reset. */
const MOTION_ROLES = new Set([ROLE.patternRunning, ROLE.advgenRunning, ROLE.sourceBackgroundRun,
  ROLE.commandPosition]);

/**
 * May Page Reset write this field's catalog default? Never a verb or a
 * motion-starting role, whatever the hub declared as its default (ph-2hw).
 */
export function resetsToDefault(field) {
  return !field.readOnly && field.dflt != null && !isActionRole(field.role) && !MOTION_ROLES.has(field.role);
}

/**
 * The device's reported value for a field, straight from its channel's
 * retained STATE. This is the ONLY source a control may display — never a
 * locally remembered request. CLAUDE.md 3, Ground Truth Doctrine.
 */
export function reportedValue(field, sample) {
  if (!sample) return undefined;
  return sample[field.name];
}

/**
 * RFC-066: the uid of the field a modulator entry rides, from its entry-level
 * mod_target (SPEC §8.1: a layout index on STATE/STREAM, a schema key on
 * INTENT), in buildSettingsModel's uid form. Null when the entry has none or
 * it names no field in this catalog.
 */
export function modTargetUid(entries, channelId) {
  const byId = (id) => entries.find((e) => e.id === id);
  const mt = (byId(channelId) || {}).modTarget;
  const t = mt && byId(mt.channel);
  if (!t) return null;
  if (t.layout) return t.layout[mt.field] ? t.id + ':' + t.layout[mt.field].name : null;
  return (t.schema || []).some((f) => f.key === mt.field) ? t.id + ':' + mt.field : null;
}
