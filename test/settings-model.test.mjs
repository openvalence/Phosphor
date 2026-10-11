/**
 * settings-model.test.mjs — gold-standard claims #2, #3 and #6, tested with no
 * device present.
 *
 * The fixture below is A MACHINE THAT DOES NOT EXIST. It uses channel ids this
 * project has never allocated, field names nothing here publishes, a
 * device-defined category (>=128) whose name only that machine knows, and a
 * string setting no Nucleus has ever shipped.
 *
 * If buildSettingsModel() produces a correct, complete, sensibly-widgeted page
 * for it, then the renderer is genuinely generic — and "a new firmware settings
 * channel needs no client change" stops being a hope and becomes a property
 * with a test behind it.
 *
 * Run: node test/settings-model.test.mjs
 */

import {
  buildSettingsModel, isFieldEnabled, WIDGET, resolveWidget, surfacedFields,
  placeableControls, offeredPresentations, minCells, orientationOf, READ_ONLY_PRESENTATIONS,
  CROSS_ARCHETYPE, placementLook, resetsToDefault, splitGroup,
} from '../src/model/settings.js';
import { claimRoles, claimAll, withoutClaimed, ROLE, AXIS_HERO_SPEC } from '../src/model/roles.js';
import { labelFor, unitOf, precisionFor, statTag, hubSecToWallMs, wallMsToHubSec, armMoment, staleMoment } from '../src/model/format.js';
import { readFileSync } from 'node:fs';
import { NAV_ICONS, navIcon } from '../src/ui/navIcons.js';
import { UI_CATEGORY_NAME } from '../../Valence/clients/js/generated/registry_vocab.js';
import { needsConfirm, settingNeedsConfirm, confirmCopy, actionTag, isUnattended } from '../src/model/actions.js';
import {
  PACKED, CHANNEL_CLASS, UI_CATEGORY, UI_RANK, UI_ARCHETYPE,
  SAFETY_OP, FIELD_ROLE, CH_SAFETY_INTENTS, decodeCatalog,
  VALUE_ASPECT, VALUE_SCOPE, UNIT_ID, CBOR_FIELD,
} from '../../Valence/clients/js/index.js';
import { STORE_OP } from '../../Valence/clients/js/generated/registry_vocab.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};

// ---------------------------------------------------------------------------
// A machine we have never met.
// ---------------------------------------------------------------------------

// `provenanceName` mirrors the decoder, which resolves RFC-048 key 22 for
// EVERY field and falls back to `actual` when the catalog omits it.
const lf = (name, type, extra = {}) => ({
  name, type, typeName: String(type), unit: '', scale: 1,
  provenanceName: 'actual', rank: UI_RANK.detail, aspect: VALUE_ASPECT.live,
  scope: VALUE_SCOPE.session, scopeName: 'session', unitId: null, ...extra,
});

const CATALOG = [
  // --- telemetry, uncategorized: not a settings tab, but carries roles ------
  {
    id: 0x0210, name: 'carriage', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0,
    maxRateHz: 50, priority: 2, category: null, settingChannel: null,
    layout: [
      // PLANNED, not measured: this fixture machine's position is whatever its
      // planner rendered. The label must say so; see the provenance block at
      // the end of this file.
      lf('carriage_mm', PACKED.u16, {
        unit: 'mm', scale: 100, role: ROLE.telemetryPosition,
        provenanceName: 'planned', rank: UI_RANK.hero,
      }),
      lf('carriage_rate', PACKED.i16, { unit: 'mm/s', scale: 10, role: ROLE.telemetryVelocity }),
      lf('carriage_goal', PACKED.u16, { unit: 'mm', scale: 100, role: ROLE.telemetryTarget }),
    ],
    schema: null,
  },

  // --- ui_categories.limits, channel A -------------------------------------
  // `categoryKnown` is what catalog.js sets when the id IS in the registry
  // vocabulary; the fixture mirrors decoder output, so it carries it too.
  {
    id: 0x0211, name: 'travel', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0,
    maxRateHz: 0, priority: 1, category: UI_CATEGORY.limits, categoryKnown: true,
    categoryName: 'limits', settingChannel: 0x0290,
    layout: [
      lf('travel_lo', PACKED.f32, {
        unit: 'mm', min: 0, max: 900, step: 1, settingKey: 1,
        role: ROLE.windowMin, group: 'Travel', desc: 'Lower bound of travel.',
        default: 0,
      }),
      lf('travel_hi', PACKED.f32, {
        unit: 'mm', min: 0, max: 900, step: 1, settingKey: 2,
        role: ROLE.windowMax, group: 'Travel', default: 900,
      }),
      // read-only: no setting_key. Must render as a readout, never an input.
      lf('travel_measured', PACKED.f32, { unit: 'mm', group: 'Travel' }),
      // field-level diagnostic rank inside an ordinary channel
      lf('travel_raw', PACKED.f32, { unit: 'mm', group: 'Travel', rank: UI_RANK.diagnostic }),
      lf('gate', PACKED.bitfield8, {
        role: ROLE.enabledMask,
        bits: ['travel_lo', 'travel_hi', '', '', '', '', '', ''],
      }),
    ],
    schema: null,
  },

  // --- SAME category, DIFFERENT channel ------------------------------------
  // SPEC 8.8: a category spans channels. These must MERGE into one tab.
  {
    id: 0x0212, name: 'ceilings', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0,
    maxRateHz: 0, priority: 1, category: UI_CATEGORY.limits, categoryKnown: true,
    categoryName: 'limits', settingChannel: 0x0290,
    layout: [
      lf('hand_speed', PACKED.f32, {
        unit: 'mm/s', min: 1, max: 400, step: 1, settingKey: 7,
        role: ROLE.limitJogSpeed, group: 'Ceilings', default: 60,
      }),
      // rank=hidden AND a setting: never drawn, but it still CONSUMES mask bit
      // 1, so hand_accel below must land on bit 2. Ordered between two visible
      // settings on purpose — that is the arrangement a naive skip corrupts.
      lf('inert_knob', PACKED.f32, {
        unit: 'mm', min: 0, max: 1, settingKey: 9, group: 'Ceilings',
        rank: UI_RANK.hidden, rankName: 'hidden',
      }),
      lf('hand_accel', PACKED.f32, {
        unit: 'mm/s2', min: 10, max: 9000, step: 10, settingKey: 8,
        role: ROLE.limitJogAccel, group: 'Ceilings', default: 300,
      }),
      // rank=advanced with NO flag bit: the ladder alone must fold it away.
      lf('jerk_trim', PACKED.f32, {
        unit: 'mm/s3', min: 0, max: 100, step: 1, settingKey: 10,
        group: 'Ceilings', rank: UI_RANK.advanced, rankName: 'advanced',
      }),
      lf('gate', PACKED.bitfield8, {
        role: ROLE.enabledMask,
        bits: ['hand_speed', 'inert_knob', 'hand_accel', 'jerk_trim'],
      }),
    ],
    schema: null,
  },

  // --- a DEVICE-DEFINED category (>=128) with a label we cannot know --------
  {
    id: 0x0213, name: 'upkeep', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0,
    maxRateHz: 0, priority: 0, category: 180, categoryLabel: 'Upkeep',
    settingChannel: 0x0290,
    layout: [
      lf('lube_mode', PACKED.u8, {
        settingKey: 20, group: 'Lubrication', default: 1,
        options: ['manual', 'every hour', 'every session'],
        desc: 'How often the machine pumps lubricant.',
      }),
      lf('warm_enable', PACKED.u8, {
        settingKey: 21, group: 'Warmup', default: 0, options: ['off', 'on'],
      }),
      lf('rig_name', PACKED.str16, {
        settingKey: 22, group: 'Identity', role: ROLE.identityName,
        desc: 'Name shown to clients.',
      }),
      // hero rank, no Tier-1 widget binds it: Overview must still surface it
      lf('tank_level', PACKED.u8, { unit: '%', group: 'Lubrication', rank: UI_RANK.hero }),
      lf('gate', PACKED.bitfield8, {
        role: ROLE.enabledMask, bits: ['lube_mode', 'warm_enable', 'rig_name'],
      }),
    ],
    schema: null,
  },

  // --- a diagnostic-rank CHANNEL, authored after a later-sorting category ---
  {
    id: 0x0214, name: 'meter', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0,
    maxRateHz: 1, priority: 0, category: UI_CATEGORY.system, categoryKnown: true,
    categoryName: 'system', settingChannel: null, rank: UI_RANK.diagnostic,
    layout: [
      lf('run_count', PACKED.u32, { group: 'Totals', aspect: VALUE_ASPECT.total,
        scope: VALUE_SCOPE.lifetime, scopeName: 'lifetime', unitId: UNIT_ID.count }),
      lf('top_rate', PACKED.f32, { unit: 'mm/s', group: 'Totals', aspect: VALUE_ASPECT.peak,
        unitId: UNIT_ID.mm_s }),
      lf('rate_now', PACKED.f32, { unit: 'mm/s', group: 'Totals', unitId: UNIT_ID.mm_s }),
    ],
    schema: null,
  },

  // --- the INTENT writer, with an action verb ------------------------------
  {
    id: 0x0290, name: 'apply', cls: CHANNEL_CLASS.INTENT, dir: 1, access: 2,
    maxRateHz: 10, priority: 1, category: null, settingChannel: null,
    layout: null,
    schema: [
      { key: 1, name: 'travel_lo', type: 4, typeName: 'f32' },
      { key: 40, name: 'service_op', type: 1, typeName: 'uint',
        role: 'action.service', options: ['none', 'purge', 'recalibrate'],
        desc: 'Maintenance operations.' },
    ],
  },
];

// ---------------------------------------------------------------------------

console.log('settings model vs. a machine that does not exist\n');

const model = buildSettingsModel(CATALOG);

// ---- claim: categories become tabs, and a category SPANS channels ---------
const limits = model.categories.find((c) => c.id === UI_CATEGORY.limits);
ok('a categorized channel becomes a tab', !!limits);
ok('two channels sharing a category MERGE into one tab (SPEC 8.8)',
   limits && limits.groups.filter((g) => !g.diagnostic).length === 2,
   limits ? 'groups: ' + limits.groups.map((g) => g.name).join(', ') : 'no tab');
ok('the merged tab holds fields from BOTH channels',
   limits && new Set(limits.groups.flatMap((g) => g.fields.map((f) => f.channelId))).size === 2);

ok('a known category is labeled from the registry vocabulary',
   limits && limits.label === 'Limits' && limits.name === 'limits',
   limits ? limits.label : '');

// ---- claim: the ui_ranks ladder is honored (RENDERING.md §4) --------------
const ceilings = model.fields.filter((f) => f.channelId === 0x0212);
ok('rank=hidden NEVER renders',
   !ceilings.some((f) => f.name === 'inert_knob') && !model.byRole.has('inert_knob'),
   'drawn: ' + ceilings.map((f) => f.name).join(', '));
ok('...but its mask bit is still consumed: hand_accel keeps bit 2',
   ceilings.find((f) => f.name === 'hand_accel').maskBit === 2,
   'maskBit = ' + ceilings.find((f) => f.name === 'hand_accel').maskBit);
ok('...and the field after it too: jerk_trim keeps bit 3',
   ceilings.find((f) => f.name === 'jerk_trim').maskBit === 3);
ok('rank=advanced folds behind the affordance with no flag bit set',
   ceilings.find((f) => f.name === 'jerk_trim').advanced === true &&
   ceilings.find((f) => f.name === 'jerk_trim').flagBits.advanced === false);
ok('an ordinary field is not advanced',
   ceilings.find((f) => f.name === 'hand_speed').advanced === false);
// The absent-rank default (-> detail) is the DECODER's job, pinned in
// Valence's clients/js/test/valence-wire.test.mjs. Asserting it here against
// a hand-built fixture would only prove the fixture.

// ---- claim: RENDERING §12/§3 tab order, §9 diagnostic placement ------------
ok('tabs follow registry order, not authoring order; unknown ids sort as other',
   model.categories.map((c) => c.id).join(',') === [UI_CATEGORY.limits, UI_CATEGORY.system, 180].join(','),
   model.categories.map((c) => c.id).join(','));
ok('a field-ranked diagnostic lands in a trailing diagnostic group',
   limits.groups.at(-1).diagnostic && limits.groups.at(-1).fields.some((f) => f.name === 'travel_raw')
   && !limits.groups.slice(0, -1).some((g) => g.fields.some((f) => f.name === 'travel_raw')));
ok('a diagnostic CHANNEL makes its unranked fields diagnostic',
   model.categories.find((c) => c.id === UI_CATEGORY.system).groups.every((g) => g.diagnostic));

// ---- claim: a device-defined category renders with ITS OWN label ----------
const upkeep = model.categories.find((c) => c.id === 180);
ok('a device-defined category (>=128) still renders', !!upkeep);
ok('and uses the label only that machine knows', upkeep && upkeep.label === 'Upkeep',
   upkeep ? upkeep.label : '');

// ---- claim: widgets come from TYPE + constraints, never from names --------
const byName = new Map(model.fields.map((f) => [f.name, f]));
ok('bounded numeric -> slider', byName.get('travel_lo').widget === WIDGET.slider);
ok('3-option select -> segmented', byName.get('lube_mode').widget === WIDGET.segmented,
   byName.get('lube_mode').widget);
ok('off/on pair -> toggle', byName.get('warm_enable').widget === WIDGET.toggle);
ok('str16 -> text', byName.get('rig_name').widget === WIDGET.text);
ok('no setting_key -> readout, never an input',
   byName.get('travel_measured').widget === WIDGET.readout);
ok('read-only field carries no write target',
   byName.get('travel_measured').writeChannel === null);

// ---- claim: §8.2 rows 9/10 are PINNED, and the pin survives f32 step dust --
// The spec says "range wide enough for a drag gesture" and stops there;
// DRAG_TICKS_MIN is this client's number. These cases are the ones that flip
// if it moves, so they are also the record of what it was chosen to do.
const num = (extra) => resolveWidget(
  { readOnly: false, type: PACKED.f32, scale: 1, flagBits: {}, ...extra });
ok('a 100-tick range drags -> slider', num({ min: 0, max: 100, step: 1 }) === WIDGET.slider);
ok('a 16-tick range does not -> stepper', num({ min: 0, max: 8, step: 0.5 }) === WIDGET.stepper);
ok('exactly DRAG_TICKS_MIN ticks still drags, f32 step dust and all',
   num({ min: 0, max: 1, step: Math.fround(0.05) }) === WIDGET.slider);
ok('an unstepped integer is quantized by its own type: 9 ticks -> stepper',
   num({ type: PACKED.u8, min: 1, max: 10 }) === WIDGET.stepper);
ok('an unstepped float is genuinely continuous -> slider',
   num({ min: 0, max: 20 }) === WIDGET.slider);
ok('an unstepped integer scaled x1000 is finely quantized -> slider',
   num({ type: PACKED.u32, scale: 1000, min: 10, max: 500 }) === WIDGET.slider);
ok('a writable numeric with no bounds cannot be dragged -> stepper',
   num({ type: PACKED.u16 }) === WIDGET.stepper);
ok('an archetype hint is ignored: RFC-083 struck it (§8.2 row 1)',
   num({ min: 0, max: 100, step: 1, archetypeHint: UI_ARCHETYPE.stepper }) === WIDGET.slider);

// ---- claim: read-only status bits are lamps, not numerals (§8.2 row 14) ----
const ro = (extra) => resolveWidget({ readOnly: true, scale: 1, flagBits: {}, ...extra });
ok('a read-only bitfield -> indicator',
   ro({ type: PACKED.bitfield8, bits: ['armed', 'homed'] }) === WIDGET.indicator);
ok('a read-only off/on pair -> indicator',
   ro({ type: PACKED.u8, min: 0, max: 1 }) === WIDGET.indicator);
ok('a read-only unbounded numeric is still a plain readout',
   ro({ type: PACKED.f32 }) === WIDGET.readout);

// ---- claim: writes are addressed by the catalog, not by our guesswork -----
ok('a setting knows its INTENT channel and key',
   byName.get('hand_speed').writeChannel === 0x0290 && byName.get('hand_speed').settingKey === 7);

// ---- claim: the enabled_mask gates the right field ------------------------
// gate bit 0 -> travel_lo, bit 1 -> travel_hi. Publish only bit 0 set.
const sample = { travel_lo: 10, travel_hi: 800, travel_measured: 812, gate: 0b01 };
ok('mask bit set -> field writable', isFieldEnabled(byName.get('travel_lo'), sample));
ok('mask bit clear -> field grayed', !isFieldEnabled(byName.get('travel_hi'), sample));
ok('the mask field itself is never drawn as a control',
   !model.fields.some((f) => f.role === ROLE.enabledMask));

// SPEC §8.8 "one or more bitfield8 fields": mask k bit i gates setting 8k+i.
{
  const knobs = Array.from({ length: 10 }, (_, i) => lf('k' + i, PACKED.u8, { settingKey: i + 1, min: 0, max: 9 }));
  const twoMasks = buildSettingsModel([{
    id: 0x0218, name: 'twomask', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0, priority: 0,
    category: UI_CATEGORY.generator, categoryKnown: true, categoryName: 'generator', settingChannel: 0x0298,
    layout: [...knobs.slice(0, 8), lf('m1', PACKED.bitfield8, { role: ROLE.enabledMask }),
      ...knobs.slice(8), lf('m2', PACKED.bitfield8, { role: ROLE.enabledMask })],
    schema: null,
  }]);
  const k = (i) => twoMasks.fields.find((f) => f.name === 'k' + i);
  const s2 = { m1: 0xff, m2: 0b10 };
  ok('two masks: the first gates fields 0-7', [0, 1, 2, 3, 4, 5, 6, 7].every((i) => isFieldEnabled(k(i), s2)));
  ok('two masks: the second mask grays field 8 (its bit 0 clear)', !isFieldEnabled(k(8), s2));
  ok('two masks: the second mask opens field 9 (its bit 1 set)', isFieldEnabled(k(9), s2));
  ok('two masks: a clear first mask leaves fields 8 and 9 on the second',
     !isFieldEnabled(k(0), { m1: 0, m2: 0b11 }) && isFieldEnabled(k(8), { m1: 0, m2: 0b11 }));
  ok('two masks: neither mask is drawn', !twoMasks.fields.some((f) => f.role === ROLE.enabledMask));
}

// ---- claim: action verbs are discovered by role ---------------------------
ok('an action.* schema field becomes an action', model.actions.length === 1,
   'found ' + model.actions.length);
ok('the action carries its option list', model.actions[0]
   && model.actions[0].options.length === 3);
ok('a non-action schema field is NOT an action',
   !model.actions.some((a) => a.name === 'travel_lo'));

// ---- claim: heroes claim by role, and decline when roles are absent -------
const railClaim = claimRoles(model.byRole, AXIS_HERO_SPEC);
ok('rail hero claims this unknown machine\'s window by ROLE', !!railClaim);
ok('and binds to fields whose names it could not have known',
   railClaim && railClaim.min.name === 'travel_lo' && railClaim.pos.name === 'carriage_mm');

// Law 7: the axis hero needs window + position + a commanded side, or nothing.
{
  const without = (...drop) => buildSettingsModel(CATALOG.map((e) => ({
    ...e, layout: e.layout && e.layout.filter((f) => !drop.includes(f.role)),
  }))).byRole;
  ok('a window-only hub gets no axis hero',
     claimRoles(without(ROLE.telemetryPosition, ROLE.telemetryTarget), AXIS_HERO_SPEC) === null);
  ok('window + position with no commanded side still declines',
     claimRoles(without(ROLE.telemetryTarget), AXIS_HERO_SPEC) === null);
  ok('the commanded side may be command.position instead of telemetry.target',
     !!claimRoles(new Map([...without(ROLE.telemetryTarget),
       [ROLE.commandPosition, [{ uid: 'x:1', role: ROLE.commandPosition }]]]), AXIS_HERO_SPEC));
  // ph-vdk.43: Flip binds where axis.flipped is present, and its absence
  // costs the rail nothing but the control (RENDERING §8.4 `axis`).
  const flipF = { uid: 'f:1', role: ROLE.axisFlipped };
  ok('Flip: no axis.flipped role, no flip binding, the rail still claims',
     railClaim && railClaim.flip === null);
  const withFlip = claimRoles(new Map([...model.byRole, [ROLE.axisFlipped, [flipF]]]), AXIS_HERO_SPEC);
  ok('Flip: the axis.flipped field binds to the rail and leaves the generic tree',
     withFlip && withFlip.flip === flipF && withFlip.claimed.has('f:1'));
}

const patternClaim = claimRoles(model.byRole, {
  require: { running: ROLE.patternRunning, select: ROLE.patternSelect },
});
ok('a hero whose required roles are ABSENT declines entirely', patternClaim === null,
   'this synthesized machine has no pattern generator, so no generator card is drawn');
{
  // The real hub now carries one (Nucleus val-091.12): the same claim binds.
  const real = buildSettingsModel(decodeCatalog(new Uint8Array(readFileSync(
    new URL('./fixtures/valencesim-catalog.bin', import.meta.url)))));
  const claim = claimRoles(real.byRole, {
    require: { running: ROLE.patternRunning, select: ROLE.patternSelect },
    optional: { bgRun: ROLE.sourceBackgroundRun },
  });
  ok('fixture hub: the pattern generator card IS drawn, background_run bound beside run/stop',
     !!claim && claim.running.name === 'running' && claim.select.name === 'pattern'
       && !!claim.bgRun && claim.bgRun.name === 'background_run');
  const smooth = real.fields.find((f) => f.name === 'smoothness');
  ok('an f32 step reads as authored, so a range reaches its max (ph-ycwg)', smooth.step === 0.05
     && smooth.min + Math.floor((smooth.max - smooth.min) / smooth.step) * smooth.step === smooth.max, smooth.step);
}

// ---- claim: hero rank reaches Overview unless a Tier-1 widget took it -----
{
  const left = surfacedFields(model.fields, railClaim.claimed, 'glance').map((f) => f.name);
  ok('an unclaimed hero-rank field is surfaced', left.includes('tank_level'), left.join(','));
  ok('a hero-rank field a widget claimed is not surfaced twice', !left.includes('carriage_mm'));
}

// ---- claim: claimed fields are not ALSO drawn generically -----------------
const pruned = withoutClaimed(model.categories, railClaim.claimed);
const stillThere = pruned.flatMap((c) => c.groups.flatMap((g) => g.fields))
  .some((f) => railClaim.claimed.has(f.uid));
ok('fields absorbed by a hero vanish from the generic tree', !stillThere);

// ---- ph-vdk.32: RENDERING §11 -- a min/max role pair is ONE range control --
{
  // Window-only: strip telemetry.position so the axis hero declines (law 7
  // above) and travel_lo/travel_hi fall all the way to Tier-0.
  const windowOnly = buildSettingsModel(CATALOG.map((e) => ({
    ...e, layout: e.layout && e.layout.filter((f) => f.role !== ROLE.telemetryPosition),
  })));
  ok('a window-only hub still gets no axis hero',
     claimRoles(windowOnly.byRole, AXIS_HERO_SPEC) === null);

  const travel = windowOnly.categories.flatMap((c) => c.groups).find((g) => g.name === 'Travel');
  ok('the Travel group survives with no hero to absorb it', !!travel);
  ok('window.min/window.max merge into ONE range field, not two independent sliders',
     travel && travel.fields.filter((f) => f.widget === WIDGET.range).length === 1
     && !travel.fields.some((f) => f.role === ROLE.windowMin || f.role === ROLE.windowMax));
  const rangeField = travel && travel.fields.find((f) => f.widget === WIDGET.range);
  ok('the merged field keeps both halves, in order',
     rangeField && rangeField.lo.name === 'travel_lo' && rangeField.hi.name === 'travel_hi');
  ok('its label drops the min/max suffix common to both roles',
     rangeField && labelFor(rangeField) === 'Window', rangeField && labelFor(rangeField));
  ok('a read-only companion in the same group is untouched by the merge',
     travel.fields.some((f) => f.name === 'travel_measured' && f.widget === WIDGET.readout));

  // The ordinary CATALOG fixture DOES have a claimable axis hero (railClaim,
  // above), which absorbs window.min/window.max before this pair would ever
  // reach the merge's own group. Either way, `pruned` (the hero-claimed,
  // generic-tree-pruned model from just above) must carry no leftover range
  // control -- a hero absorbing the pair must not leave its Tier-0 sibling
  // drawn a second time underneath it.
  ok('a hero-claimed min/max pair leaves no merged range control behind',
     !pruned.flatMap((c) => c.groups.flatMap((g) => g.fields)).some((f) => f.widget === WIDGET.range));
}

// ---- claim: value axes and units (RENDERING §5, §6) -----------------------
{
  const f = (n) => model.fields.find((x) => x.name === n);
  const sys = model.categories.find((c) => c.id === UI_CATEGORY.system);
  ok('a peak rides its live companion as a marker', f('rate_now').peak === f('top_rate'));
  ok('...and leaves its group, so it is never drawn as a live value',
     !sys.groups.some((g) => g.fields.includes(f('top_rate'))));
  ok('a statistic shows its scope', labelFor(f('run_count')) === 'Run count · lifetime total',
     labelFor(f('run_count')));
  ok('the peak tag names aspect and scope', statTag(f('top_rate')) === 'session peak');
  ok('a live value carries no tag', statTag(f('rate_now')) === '');
  ok('unit_id drives the suffix', unitOf({ unit: 'furlong/s', unitId: UNIT_ID.mm_s }) === 'mm/s');
  ok('no unit_id falls back to the catalog string verbatim',
     unitOf({ unit: 'furlong', unitId: null }) === 'furlong');
  ok('a count unit renders whole', precisionFor(f('run_count')) === 0);
  ok('a CBOR integer with no step renders whole (ph-8l8)',
     precisionFor({ typeName: 'uint_t' }) === 0 && precisionFor({ typeName: 'int_t' }) === 0 && precisionFor({ typeName: 'f32_t' }) === 2);
  const pick = claimRoles(new Map([[ROLE.telemetryVelocity, [
    { uid: 'p', aspect: VALUE_ASPECT.peak }, { uid: 'l', aspect: VALUE_ASPECT.live }]]]),
  { require: { v: ROLE.telemetryVelocity } });
  ok('a hero never binds a peak as the live value', pick && pick.v.uid === 'l');
}

// ---- claim: unknown things degrade, never crash --------------------------
const weird = buildSettingsModel([{
  id: 0x0999, name: 'mystery', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0,
  maxRateHz: 0, priority: 0, category: 250, settingChannel: 0x0998,
  layout: [
    lf('unknown_thing', 99, { settingKey: 1, role: 'some.future.role', group: 'Odd' }),
  ],
  schema: null,
}]);
ok('a field of an unknown packed type still renders (fallback widget)',
   weird.fields.length === 1 && weird.fields[0].widget === WIDGET.stepper,
   weird.fields[0] && weird.fields[0].widget);
ok('an unlabeled device category gets a generated label',
   weird.categories[0] && /250/.test(weird.categories[0].label), weird.categories[0].label);
ok('an unknown role is carried, not rejected', weird.fields[0].role === 'some.future.role');

// ---- provenance decides the wording, never a guess about which field ------
// A label that says "actual" over a planner-rendered position is the UI
// asserting a measurement nobody made. The word comes from RFC-048 key 22,
// so it is right on a machine nobody here has met.
{
  const posF = model.byRole.get(ROLE.telemetryPosition)[0];
  const velF = model.byRole.get(ROLE.telemetryVelocity)[0];
  const minF = model.byRole.get(ROLE.windowMin)[0];
  ok('provenance survives into the settings model', posF.provenanceName === 'planned');
  ok('a planned position is labeled planned, never actual',
     labelFor(posF) === 'Planned position', labelFor(posF));
  ok('an actual-provenance field takes NO qualifier (the wire default)',
     labelFor(velF) === 'Speed', labelFor(velF));
  ok('a setting is untouched by the provenance pass',
     labelFor(minF) === 'Window min', labelFor(minF));
}

// ---- an un-roled field is labeled from its DESC, never its wire name ------
{
  const named = (name, desc) => ({ name, label: name, desc });
  ok('a label-shaped desc clause becomes the label',
     labelFor(named('raw_10um', 'Asked position, as the input sent it.')) === 'Asked position',
     labelFor(named('raw_10um', 'Asked position, as the input sent it.')));
  ok('a prose desc leaves the humanized name alone',
     labelFor(named('log_dropped', 'Log lines dropped since boot.')) === 'log_dropped');
  ok('a one-word desc clause is not a label',
     labelFor(named('blend_mode_reserved', 'Retired. Unused padding now.')) === 'blend_mode_reserved');
}

// ---- confirm posture comes from registry vocabulary (RENDERING §7, §10.1) --
{
  const act = (role, extra = {}) => ({ channelId: 0x0291, key: 1, role, desc: '', ...extra });
  ok('a registered reboot tag confirms', needsConfirm(act('action.reboot'), 1));
  ok('a registered reset tag confirms', needsConfirm(act('action.reset', { options: ['x', 'y'] }), 1));
  ok('an admin tag does not', !needsConfirm(act('action.admin'), 1));
  ok('an unregistered tag falls back to a plain trigger', !needsConfirm(act('action.service'), 2));
  ok('the tag is the role suffix', actionTag(act('action.preset_save')) === 'preset_save');
  const safety = act('action.safety', { channelId: CH_SAFETY_INTENTS });
  ok('override on the spec-core safety channel confirms', needsConfirm(safety, SAFETY_OP.override));
  ok('...but return, pause, resume, estop and release never wait on a dialog (law 14)',
     [SAFETY_OP.return_op, SAFETY_OP.pause, SAFETY_OP.resume, SAFETY_OP.estop, SAFETY_OP.release]
       .every((op) => !needsConfirm(safety, op)));
  ok('the same op number on a device channel is another verb: no confirm',
     !needsConfirm(act('action.safety'), SAFETY_OP.override));
  // RFC-063 (SPEC §8.8): the flag, the per-op mask, and the store delete.
  ok('a destructive-flagged verb confirms', needsConfirm(act('action.admin', { flagBits: { destructive: true } }), 1));
  const ops = act('action.admin', { options: ['reserved', 'clear_fault', 'factory_reset'], destructiveOptions: [false, false, true] });
  ok('destructive_options confirms only its marked op', needsConfirm(ops, 2) && !needsConfirm(ops, 1));
  const store = act('action.store', { options: ['reserved', 'save', 'load', 'delete', 'rename'] });
  ok('an action.store delete confirms by registration', needsConfirm(store, STORE_OP.delete_item));
  ok('...and its save, load and rename do not', [STORE_OP.save, STORE_OP.load, STORE_OP.rename].every((v) => !needsConfirm(store, v)));
  ok('a destructive mark on estop is ignored (law 14)',
     !needsConfirm({ ...safety, flagBits: { destructive: true }, destructiveOptions: [true, true, true, true, true, true, true, true] }, SAFETY_OP.estop));
  const built = buildSettingsModel([{ id: 0x0300, name: 'x', cls: CHANNEL_CLASS.INTENT, dir: 1, access: 1, schema: [
    { key: 1, name: 'op', type: 0, role: 'action.admin', options: ['reserved', 'a', 'b'], destructiveOptions: [false, false, true] }] }]);
  ok('the settings model carries destructive_options onto the action', needsConfirm(built.actions[0], 2) && !needsConfirm(built.actions[0], 1));
  ok('a destructive-flagged setting confirms every write', settingNeedsConfirm({ role: '', flagBits: { destructive: true } }, 1, 0));
  const bg = { role: FIELD_ROLE.source_background_run };
  ok('background_run false->true confirms', settingNeedsConfirm(bg, 0, 1));
  ok('background_run true->false does not', !settingNeedsConfirm(bg, 1, 0));
  ok('an ordinary toggle does not', !settingNeedsConfirm({ role: '' }, 0, 1));
  ok('axis.flipped confirms every write', settingNeedsConfirm({ role: FIELD_ROLE.axis_flipped }, 0, 1) && settingNeedsConfirm({ role: FIELD_ROLE.axis_flipped }, 1, 0));
  const copy = confirmCopy(act('action.reboot', { options: ['reserved', 'warm_reboot'], desc: 'Restart the hub.' }), 1);
  ok('confirm copy is the catalog\'s own option label and desc',
     copy.title === 'warm reboot' && copy.body === 'Restart the hub.', JSON.stringify(copy));
}

// ---- RFC-083: color and datetime bind by role, never by an archetype hint --
{
  const lf = (name, role, settingKey, extra = {}) => ({ name, role, settingKey, type: PACKED.u8, typeName: 'u8',
    unit: '', scale: 1, min: 0, max: 255, rank: UI_RANK.control, group: 'Glow', ...extra });
  const ch = (layout) => ({ id: 0x7a00, name: 'lamp', cls: CHANNEL_CLASS.STATE, dir: 0, access: 1, maxRateHz: 0,
    priority: 2, category: UI_CATEGORY.hardware, categoryKnown: true, categoryName: 'hardware', settingChannel: 0x7a01, layout });
  const rgb = [lf('r', FIELD_ROLE.color_red, 1), lf('g', FIELD_ROLE.color_green, 2), lf('b', FIELD_ROLE.color_blue, 3)];
  const m = buildSettingsModel([ch([...rgb, lf('at', FIELD_ROLE.datetime_moment, 4, { type: PACKED.u32, typeName: 'u32',
    unitId: UNIT_ID.hub_s, max: 4e9 }), lf('plain', '', 5, { archetype: UI_ARCHETYPE.color })])]);
  const fields = m.categories.flatMap((c) => c.groups.flatMap((g) => g.fields));
  const color = fields.find((f) => f.widget === WIDGET.color);
  ok('color.red/green/blue in one group project to one color control', !!color && color.r && color.g && color.b
    && !fields.some((f) => f.role === FIELD_ROLE.color_red));
  ok('datetime.moment projects to the datetime archetype', fields.some((f) => f.role === FIELD_ROLE.datetime_moment
    && f.archetype === UI_ARCHETYPE.datetime && f.widget === WIDGET.datetime));
  ok('an archetype hint is never read (RFC-083 struck it)', fields.find((f) => f.name === 'plain').widget !== WIDGET.color);
  const two = buildSettingsModel([ch(rgb.slice(0, 2))]).categories[0].groups[0].fields;
  ok('two of three color roles stay ordinary controls', two.length === 2 && two.every((f) => f.widget === WIDGET.slider));
  const ro = buildSettingsModel([{ ...ch(rgb), settingChannel: null }]).categories[0].groups[0].fields;
  ok('a read-only triple is not a picker', !ro.some((f) => f.widget === WIDGET.color));

  // A fixed CLOCK reference: hub up 5000.5 s, the CLOCK hub-us wrapped once.
  const ref = { hubUs: Math.round(5000.5e6) % 2 ** 32, wallMs: 1_900_000_000_000, uptimeS: 5000 };
  const wall = hubSecToWallMs(12345, ref);
  ok('datetime round trip through a fixed CLOCK offset is exact', wallMsToHubSec(wall, ref) === 12345
    && wall === ref.wallMs + (12345 - 5000.5) * 1000);
  armMoment('0x7a00:at', 111, 12345, wall);
  ok('same boot_id: the armed moment holds', staleMoment('0x7a00:at', 111, 12345) === null);
  ok('boot_id change: the armed moment is stale, with the wall time to re-arm',
     staleMoment('0x7a00:at', 222, 12345)?.wallMs === wall);
  ok('a moment the hub already changed is not flagged', staleMoment('0x7a00:at', 222, 999) === null);
}

// ---- generic triggers (§8.2 row 6): every non-persistent verb is reachable --
{
  const intent = (id, category, schema) => ({
    id, name: 'x' + id, cls: CHANNEL_CLASS.INTENT, dir: 1, access: 1, maxRateHz: 2,
    priority: 1, category, categoryKnown: category != null, categoryName: 'hardware',
    settingChannel: null, layout: null, schema,
  });
  const m = buildSettingsModel([
    intent(0x0301, UI_CATEGORY.hardware, [{ key: 1, name: 'op', type: 0, role: 'action.admin',
      options: ['reserved', 'clear_fault', 'warm_reboot'] }]),
    intent(0x0302, UI_CATEGORY.hardware, [{ key: 1, name: 'op', type: 0, role: 'action.home',
      options: ['reserved', 'seek'] }]),
    intent(0x0303, null, [
      { key: 1, name: 'op', type: 0, role: 'action.preset', options: ['reserved', 'keep', 'drop'] },
      { key: 2, name: 'slot', type: 0, min: 0, max: 31 },
      { key: 3, name: 'title', type: 4 },
    ]),
    intent(0x0304, UI_CATEGORY.hardware, [{ key: 1, name: 'restart', type: 3, role: 'action.reboot' }]),
  ]);
  const hw = m.categories.find((c) => c.id === UI_CATEGORY.hardware);
  const inHw = hw ? hw.groups.flatMap((g) => g.fields) : [];
  ok('a categorized action.* verb renders as a trigger in its own category',
     inHw.some((f) => f.channelId === 0x0301 && f.widget === WIDGET.action));
  ok('a categorized payload-less reboot trigger lands there too, confirm-gated',
     inHw.some((f) => f.channelId === 0x0304) && needsConfirm(inHw.find((f) => f.channelId === 0x0304), true));
  ok('an admin op does not confirm', !needsConfirm(inHw.find((f) => f.channelId === 0x0301), 1));
  ok('home stays with the persistent region, never drawn twice',
     !inHw.some((f) => f.channelId === 0x0302) && !m.looseActions.some((a) => a.channelId === 0x0302));
  const loose = m.looseActions.find((a) => a.channelId === 0x0303);
  ok('an uncategorized verb is a loose action (Overview card), never dropped', !!loose);
  ok('its sibling schema fields ride as the op payload',
     loose && loose.payload.map((p) => p.key).join(',') === '2,3', loose && JSON.stringify(loose.payload.map((p) => p.name)));
  ok('the fixture machine\'s own action.service verb is reachable too',
     model.looseActions.some((a) => a.role === 'action.service'));
}
{
  // A real hub's bytes: safety and home (both persistent), settings-trial's
  // commit/revert op (RFC-099; only the sender's own trials, which the generic
  // renderer never makes) plus the preset store's CRUD verb, which is
  // uncategorized and so rides Overview until a generator-advanced widget
  // claims it (ph-vdk.11).
  const real = buildSettingsModel(decodeCatalog(new Uint8Array(readFileSync(
    new URL('./fixtures/valencesim-catalog.bin', import.meta.url)))));
  const generic = real.categories.flatMap((c) => c.groups.flatMap((g) => g.fields))
    .filter((f) => f.widget === WIDGET.action);
  const drawn = generic.map((f) => f.role).concat(real.looseActions.map((a) => a.role));
  ok('fixture hub: safety/home verbs are not duplicated onto settings tabs',
     !drawn.some((r) => r !== 'action.store'), drawn.join(',') || 'none');
  ok('fixture hub: the settings-trial verb is never a generic trigger',
     real.actions.some((a) => a.role === 'action.trial') && !drawn.includes('action.trial'), drawn.join(',') || 'none');
  ok('fixture hub: the preset store verb is reachable exactly once',
     drawn.filter((r) => r === 'action.store').length === 1, drawn.join(',') || 'none');
}

// ---- pattern-panel: background_run bound by role (RENDERING §10.1) --------
{
  const gen = buildSettingsModel([{
    id: 0x0220, name: 'gen', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0,
    priority: 1, category: UI_CATEGORY.generator, categoryKnown: true, categoryName: 'generator',
    settingChannel: 0x0292,
    layout: [
      lf('go', PACKED.u8, { min: 0, max: 1, settingKey: 1, role: ROLE.patternRunning }),
      lf('which', PACKED.u8, { settingKey: 2, role: ROLE.patternSelect, options: ['a', 'b'] }),
      lf('linger', PACKED.u8, { min: 0, max: 1, settingKey: 3, role: FIELD_ROLE.source_background_run,
        desc: 'Keep going after the session ends.' }),
    ],
    schema: null,
  }]);
  const claim = claimRoles(gen.byRole, {
    require: { running: ROLE.patternRunning, select: ROLE.patternSelect },
    optional: { bgRun: ROLE.sourceBackgroundRun },
  });
  ok('the pattern hero finds background_run by ROLE, whatever it is named',
     claim && claim.bgRun && claim.bgRun.name === 'linger');
  ok('...and consumes it, so it is never also a buried settings-card toggle',
     !withoutClaimed(gen.categories, claim.claimed).some((c) => c.groups.some((g) =>
       g.fields.some((f) => f.role === FIELD_ROLE.source_background_run))));
  ok('its label names the quantity from the role', labelFor(claim.bgRun) === 'Run in background');
  const s = (go, linger) => ({ [0x0220]: { go, which: 0, linger } });
  const owners = (...o) => Object.fromEntries(o.flatMap((v, i) => [['src' + i, i], ['owner' + i, v]]));
  ok('running + background_run + nobody owning a source -> unattended',
     isUnattended(gen.byRole, s(1, 1), owners(0, 0, 0, 0)));
  ok('a session owning a source again clears it',
     !isUnattended(gen.byRole, s(1, 1), owners(0, 0, 77, 0)));
  ok('background_run off is never unattended', !isUnattended(gen.byRole, s(1, 0), owners(0, 0)));
  ok('stopped is never unattended', !isUnattended(gen.byRole, s(0, 1), owners(0, 0)));
  ok('no control-owner report yet reads as unattended (the safe side)',
     isUnattended(gen.byRole, s(1, 1), undefined));
  ok('a hub without the role never shows the chip', !isUnattended(model.byRole, {}, undefined));
}

// ---- ph-vdk.60.8: RENDERING §5.4 reset linkage ------------------------------
// A counter group's reset verb sits in that group's card (SPEC §8.8: a group
// spans channels by category and name) and confirms first (§8.4 trigger).
{
  const m = buildSettingsModel([{
    id: 0x0230, name: 'tally', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 1,
    priority: 3, category: 201, categoryKnown: false, categoryName: 'odometer', settingChannel: null,
    layout: [
      lf('strokes', PACKED.u32, { group: 'Counts', aspect: VALUE_ASPECT.total }),
      lf('gen', PACKED.u16, { group: 'Counts', role: ROLE.resetGen }),
    ],
    schema: null,
  }, {
    id: 0x0231, name: 'tally-clear', cls: CHANNEL_CLASS.INTENT, dir: 1, access: 1, maxRateHz: 1,
    priority: 3, category: 201, categoryKnown: false, categoryName: 'odometer', settingChannel: null, layout: null,
    schema: [{ key: 1, name: 'op', type: CBOR_FIELD.uint_t, role: 'action.reset', group: 'Counts', options: ['', 'clear'] }],
  }]);
  const card = m.categories.flatMap((c) => c.groups).find((g) => g.fields.some((f) => f.role === ROLE.resetGen));
  const verb = card && card.fields.find((f) => f.role === 'action.reset');
  ok('reset linkage: the reset verb sits in its counter group\'s card', !!verb,
     card && card.fields.map((f) => f.name).join(','));
  ok('reset linkage: it confirms first', !!verb && needsConfirm(verb, 1));
}

// ---- ph-2hw: Page Reset never writes a motion-starting field ---------------
{
  const gen = buildSettingsModel([{
    id: 0x0221, name: 'gen', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0,
    priority: 1, category: 200, categoryKnown: false, categoryName: 'mill',
    settingChannel: 0x0293,
    layout: [
      lf('go', PACKED.u8, { min: 0, max: 1, settingKey: 1, role: ROLE.patternRunning, default: 1 }),
      lf('adv', PACKED.u8, { min: 0, max: 1, settingKey: 2, role: ROLE.advgenRunning, default: 1 }),
      lf('linger', PACKED.u8, { min: 0, max: 1, settingKey: 3, role: ROLE.sourceBackgroundRun, default: 1 }),
      lf('grit', PACKED.u8, { min: 0, max: 9, settingKey: 4, default: 3 }),
    ],
    schema: [{ key: 1, name: 'op', type: CBOR_FIELD.uint_t, role: 'action.start', options: ['', 'go'], default: 1 }],
  }]);
  const all = [...gen.fields, ...gen.actions];
  const reset = all.filter(resetsToDefault).map((f) => f.name);
  ok('reset: a running default of true is never written', !reset.includes('go') && !reset.includes('adv'), reset.join(','));
  ok('reset: background_run and verbs are never written', !reset.includes('linger') && !reset.includes('op'), reset.join(','));
  ok('reset: a plain value still resets', reset.join(',') === 'grit', reset.join(','));
}

// ---- ph-e82.4: the control contract (DESIGN §10.2) -------------------------
{
  const real = buildSettingsModel(decodeCatalog(new Uint8Array(readFileSync(
    new URL('./fixtures/valencesim-catalog.bin', import.meta.url)))));
  const isBool = (f) => (f.options ? f.options.length === 2 && /^(off|disabled|no|false)$/i.test(f.options[0])
    : f.min === 0 && f.max === 1 && f.type !== PACKED.f32) || (f.type === PACKED.bitfield8 && !f.bits);
  const hasBounds = (f) => f.min != null && f.max != null && f.max > f.min;
  for (const [name, m] of [['fixture machine', model], ['valencesim', real]]) {
    const ctls = placeableControls(m);
    const fields = ctls.filter((c) => c.kind === 'field');
    const bad = (pred) => fields.filter((c) => !pred(c)).map((c) => c.key);
    ok(name + ': every field is placeable (minus companions and merged halves)',
       fields.length === m.fields.filter((f) => !f.companionOf).length + m.actions.length
         - fields.filter((c) => c.field.widget === WIDGET.range).length);
    ok(name + ': every offered set is non-empty and leads with the derived widget',
       !bad((c) => c.presentations.length && c.presentations[0] === c.field.widget).length);
    ok(name + ': no bar, knob or slider without bounds',
       !bad((c) => c.presentations.every((p) => ![WIDGET.bar, WIDGET.knob, WIDGET.slider].includes(p) || hasBounds(c.field))).length);
    const twoValues = (f) => isBool(f) || !!(f.options && f.options.length >= 2) || (hasBounds(f) && !f.options);
    ok(name + ': no toggle on a field without two values to write (bool, options or bounds), none read-only',
       !bad((c) => c.presentations.every((p) => p !== WIDGET.toggle || (twoValues(c.field) && !c.field.readOnly))).length,
       bad((c) => c.presentations.every((p) => p !== WIDGET.toggle || (twoValues(c.field) && !c.field.readOnly))).join(','));
    ok(name + ': no bulb for a non-bool',
       !bad((c) => c.presentations.every((p) => p !== WIDGET.indicator || isBool(c.field) || c.field.type === PACKED.bitfield8)).length);
    ok(name + ': conservative read (flag off): no toggle for a non-bool, no graph unless the archetype is chart',
       fields.every((c) => offeredPresentations(c.field, false).every((p) =>
         (p !== WIDGET.toggle || isBool(c.field)) && (p !== WIDGET.graph || c.field.archetype === UI_ARCHETYPE.chart))));
    const keys = ctls.map((c) => c.key);
    ok(name + ': every placement key is unique', new Set(keys).size === keys.length);
    ok(name + ': every presentation has a minimum footprint per orientation',
       fields.every((c) => c.presentations.every((p) => minCells(p, 'h').length === 2 && minCells(p, 'v').length === 2)));
  }

  const ctls = placeableControls(real);
  const slider = ctls.find((c) => c.kind === 'field' && c.field.widget === WIDGET.slider && !c.field.role);
  ok('CROSS_ARCHETYPE is on by operator ruling 2026-10-01 (RFC-080 draft item 3)', CROSS_ARCHETYPE === true);
  ok('a slider-class field takes the read/write class: stepper, toggle and display-only instances join',
     slider && ['slider', 'knob', 'stepper', 'toggle', 'numeral', 'bar'].every((p) => slider.presentations.includes(p)),
     slider && slider.presentations.join());
  ok('with the flag off it keeps its archetype\'s projections only',
     slider && offeredPresentations(slider.field, false).join() === 'slider,knob');

  // Per-placement look (RFC-080 draft items 4, 5; operator ruling 2026-10-01).
  const f = slider.field, span = f.max - f.min;
  const lo = f.min + span / 4, hi = f.max - span / 4;
  const none = placementLook(f, null);
  ok('look: none is the derived widget on the catalog field', none.pres === f.widget && none.field === f && !none.errors.length);
  ok('look: a presentation the field does not offer falls back to the derived widget',
     placementLook(f, { pres: WIDGET.secret }).pres === f.widget);
  const nar = placementLook(f, { pres: WIDGET.knob, min: lo, max: hi });
  ok('look: a range presentation narrows min and max and marks it',
     nar.pres === WIDGET.knob && nar.kind === 'range' && nar.field.min === lo && nar.field.max === hi && nar.field.narrowed
       && !nar.errors.length && f.min !== lo);
  const wide = placementLook(f, { min: f.min - 1, max: f.max + 1 });
  ok('look: widening is refused in words and keeps the catalog range',
     wide.errors.length === 1 && wide.field.min === f.min && wide.field.max === f.max && !wide.field.narrowed);
  const dflt = placementLook(f, { min: lo, max: hi, default: f.max });
  ok('look: a default outside the placement range is refused', dflt.errors.length === 1 && dflt.field.dflt !== f.max);
  ok('look: a default inside it is the placement\'s own', placementLook(f, { min: lo, max: hi, default: lo }).field.ownDefault === true);
  if (f.step) {
    ok('look: a step that is not a whole multiple of the catalog step is refused',
       placementLook(f, { step: f.step * 1.5 }).errors.length === 1 && placementLook(f, { step: f.step * 2 }).field.step === f.step * 2);
  }
  const tog = placementLook(f, { pres: WIDGET.toggle, a: f.min, b: hi });
  ok('look: a toggle on a non-bool writes two values inside the range',
     tog.kind === 'toggle' && tog.field.toggle.a === f.min && tog.field.toggle.b === hi && !tog.errors.length);
  ok('look: equal or out-of-range toggle values are refused',
     placementLook(f, { pres: WIDGET.toggle, a: lo, b: lo }).errors.length === 1
       && placementLook(f, { pres: WIDGET.toggle, a: f.min, b: f.max + 1 }).errors.length === 1);
  const boolF = ctls.find((c) => c.kind === 'field' && c.field.widget === WIDGET.toggle && !c.field.readOnly);
  ok('look: a plain bool toggle keeps the catalog field (off writes 0, on writes 1)',
     boolF && placementLook(boolF.field, { pres: WIDGET.toggle }).field === boolF.field);
  const roF = ctls.find((c) => c.kind === 'field' && c.field.readOnly && c.field.widget === WIDGET.readout);
  ok('look: a read-only field never takes a toggle', roF && placementLook(roF.field, { pres: WIDGET.toggle }).pres === roF.field.widget);
  const ro = ctls.find((c) => c.kind === 'field' && c.field.readOnly && c.field.widget === WIDGET.readout);
  ok('...and a read-only field never gains a writing presentation under it',
     ro && offeredPresentations(ro.field, true).every((p) => READ_ONLY_PRESENTATIONS.has(p)));
  ok('a range pair is one control keyed by both roles',
     ctls.some((c) => c.key === 'role:' + ROLE.windowMin + '+role:' + ROLE.windowMax && c.presentations.join() === 'range'));
  ok('an unroled field keys on its uid (ph-e82.1 item 3)', slider && slider.key === 'uid:' + slider.field.uid);
  ok('a key the catalog lacks resolves to nothing: inert, never rebound',
     !ctls.find((c) => c.key === 'uid:' + slider.field.channelId + ':renamed_away'));
  // ph-e82.9: in the app `machine` is deep $state, so fields arrive as proxies
  // while byRole (a Map) holds the raw objects. A fresh Proxy per read mimics it.
  const wrap = (o) => (o && typeof o === 'object' ? new Proxy(o, { get: (t, k) => wrap(Reflect.get(t, k)) }) : o);
  const proxied = placeableControls({ ...real, fields: wrap(real.fields), actions: wrap(real.actions) });
  const roleKeys = (cs) => cs.filter((c) => c.kind === 'field' && c.key.includes('role:')).map((c) => c.key).sort().join();
  ok('proxied fields still key role fields by role (ph-e82.9)',
     roleKeys(ctls) !== '' && roleKeys(proxied) === roleKeys(ctls), roleKeys(proxied));
  const roled = ctls.find((c) => c.kind === 'field' && c.key.startsWith('role:') && !c.key.includes('+'));
  ok('a role field answers to its uid-form key as an alias (saved homes from before ph-e82.9)',
     roled && roled.alias === 'uid:' + roled.field.uid);
  ok('an unroled field has no alias', slider && slider.alias === null);
  ok('orientation follows aspect: w >= h is horizontal', orientationOf(4, 4) === 'h' && orientationOf(3, 4) === 'v');
  ok('minimum cells differ per orientation', minCells(WIDGET.slider, 'h').join() !== minCells(WIDGET.slider, 'v').join());

  const claim = claimAll(real.byRole, [{ id: 'rail', spec: AXIS_HERO_SPEC, cells: { h: [10, 4], v: [4, 10] } },
    { id: 'nope', spec: { require: { x: 'no.such.role' } } }]);
  const withHeroes = placeableControls(real, { heroes: claim.widgets, safety: {
    channelId: 9, key: 1, options: ['', 'release', '', '', 'pause', 'resume', 'estop', 'override', 'return_op',
      'vendor_op'] } });
  const rail = withHeroes.find((c) => c.key === 'hero:rail');
  ok('a claiming composite is placeable with its own minimum cells',
     rail && rail.kind === 'composite' && minCells(rail.cells, 'v').join() === '4,10');
  ok('a declining composite is not placeable (law 7)', !withHeroes.some((c) => c.key === 'hero:nope'));
  const safety = withHeroes.filter((c) => c.kind === 'safety').map((c) => c.key);
  ok('one module per strip pair (law 14): estop/release and pause/resume, nothing else',
     safety.join() === 'safety:estop,safety:pause', safety.join(','));
}

// ---- ph-vdk.60: presentation cases the Field anatomy relies on ----------------
{
  const sf = (name, type, key, extra = {}) => lf(name, type, { settingKey: key, group: 'Kit', ...extra });
  const kit = buildSettingsModel([
    { id: 0x0d10, name: 'kit', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0, priority: 1,
      category: UI_CATEGORY.motion, categoryKnown: true, categoryName: 'motion', settingChannel: 0x0d90,
      layout: [
        sf('mode', PACKED.u8, 1, { options: ['none', 'low', 'high'] }),
        sf('preset', PACKED.u8, 2, { options: ['a', 'b', 'c', 'd', 'e', 'f'] }),
        sf('word', PACKED.str16, 3),
        sf('key', PACKED.str16, 4, { flags: 4, flagBits: { secret: true } }),
        sf('lamps', PACKED.bitfield8, 5, { bits: ['x', 'y', '', '', '', '', '', ''] }),
        sf('tick', PACKED.u8, 6, { min: 0, max: 9, step: 1 }),
        sf('spin', PACKED.f32, 7, { min: 0, max: 1, step: 0.01 }),
      ] },
    { id: 0x0d90, name: 'kit-set', cls: CHANNEL_CLASS.INTENT, dir: 1, access: 1, maxRateHz: 5, priority: 1,
      layout: null, schema: ['mode', 'preset', 'word', 'key', 'lamps', 'tick', 'spin'].map((name, i) =>
        ({ key: i + 1, name, type: CBOR_FIELD.uint_t, unit: '', rank: UI_RANK.detail })) },
  ]);
  const by = (n) => kit.fields.find((f) => f.name === n);
  const offered = (n) => offeredPresentations(by(n));
  ok('RFC-064: a settings select keeps index 0 as a real option, in both choice presentations',
     by('mode').options.length === 3 && by('mode').options[0] === 'none' && by('mode').widget === WIDGET.segmented
       && offered('mode').includes(WIDGET.select) && by('preset').widget === WIDGET.select && offered('preset').includes(WIDGET.segmented),
     offered('mode').join());
  ok('a plain string offers text and never secret; a secret offers secret and never text',
     offered('word').includes(WIDGET.text) && !offered('word').includes(WIDGET.secret)
       && by('key').widget === WIDGET.secret && !offered('key').includes(WIDGET.text), offered('key').join());
  ok('a secret never offers a numeral, which would print what the wire withholds', !offered('key').includes(WIDGET.numeral));
  ok('a named-bit bitfield is the bitfield presentation and may show as lamps',
     by('lamps').widget === WIDGET.bitfield && offered('lamps').includes(WIDGET.indicator), offered('lamps').join());
  ok('a nine-position integer is a stepper that may also turn as a knob or show as a bar',
     by('tick').widget === WIDGET.stepper && [WIDGET.knob, WIDGET.slider, WIDGET.bar].every((p) => offered('tick').includes(p)),
     offered('tick').join());
  ok('a bounded float offers the graph (a client history ring) and the numeral',
     [WIDGET.graph, WIDGET.numeral].every((p) => offered('spin').includes(p)), offered('spin').join());
  ok('no choice field offers a graph or a knob (no ordered numeric scale to draw)',
     ['mode', 'preset'].every((n) => !offered(n).includes(WIDGET.graph) && !offered(n).includes(WIDGET.knob)));
  ok('every offered presentation of every kit field has a minimum footprint',
     kit.fields.every((f) => offeredPresentations(f).every((p) => minCells(p, 'h').length === 2)));
}

// ---- ph-vic: a secret action payload is flagged so ActionField masks it -----
{
  const m = buildSettingsModel([{
    id: 0x0399, name: 'net', cls: CHANNEL_CLASS.INTENT, dir: 1, access: 2, maxRateHz: 0, priority: 1,
    category: null, settingChannel: null, layout: null,
    schema: [
      { key: 1, name: 'op', type: CBOR_FIELD.uint_t, role: 'action.join', options: ['', 'join'], rank: UI_RANK.detail },
      { key: 2, name: 'ssid', type: CBOR_FIELD.tstr_t, rank: UI_RANK.detail },
      { key: 3, name: 'pass', type: CBOR_FIELD.tstr_t, rank: UI_RANK.detail, flags: 4, flagBits: { secret: true } },
    ],
  }]);
  const act = m.actions[0];
  ok('a secret schema payload field reaches the action as secret',
     act && act.payload.find((p) => p.name === 'pass').secret === true
       && act.payload.find((p) => p.name === 'ssid').secret === false);
}

// ---- DESIGN §10.11: one nav icon per registry category, `other` for the rest
{
  const other = NAV_ICONS[UI_CATEGORY.other];
  ok('every registry category has its own nav icon',
     Object.keys(UI_CATEGORY_NAME).every((id) => NAV_ICONS[id] && (NAV_ICONS[id] !== other || +id === UI_CATEGORY.other)));
  ok('an untaught or vendor category id draws the `other` icon',
     navIcon({ cat: { id: 0x64, known: false } }) === other && navIcon({ cat: { id: 9, known: false } }) === other);
  ok('a pane draws its own icon; an unknown pane draws `other`',
     navIcon({ id: 'valence' }) === NAV_ICONS.valence && navIcon({ id: 'x', pane: { id: 'nope' } }) === other);
}

// ---- DESIGN §10.11: " / " in a group names a section (Valence RFC-096 draft)
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok('a prefixed group splits into section and card title',
     eq(splitGroup('Upkeep / Belts'), { section: 'Upkeep', title: 'Belts' }));
  ok('an unprefixed group is a card with no section',
     eq(splitGroup('Belts'), { section: '', title: 'Belts' }) && eq(splitGroup(''), { section: '', title: '' }));
  ok('two separators keep the first split', eq(splitGroup('A / B / C'), { section: 'A', title: 'B / C' }));
  ok('a slash without its spaces is not a separator', eq(splitGroup('In/out'), { section: '', title: 'In/out' }));

  const ch = (id, rank, groups) => ({
    id, name: 'sec' + id, cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0, priority: 1,
    category: 0x70, categoryKnown: false, categoryName: 'shop', categoryLabel: 'Shop', settingChannel: null, rank,
    layout: groups.map((g, i) => lf('f' + id + '_' + i, PACKED.u8, { group: g, rank })),
    schema: null,
  });
  const page = buildSettingsModel([
    ch(0x0a01, UI_RANK.detail, ['Upkeep / Belts', 'Loose']),
    ch(0x0a02, UI_RANK.diagnostic, ['Upkeep / Hours', 'Probe']),
    ch(0x0a03, UI_RANK.detail, ['', 'Upkeep / Oil', 'Feed / Rate']),
  ]).categories[0].groups;
  ok('cards with no section first, then each section together, diagnostic last within it, then diagnostic cards with no section (ph-vrg)',
     eq(page.map((g) => g.name + (g.diagnostic ? '*' : '')),
        ['Loose', '', 'Upkeep / Belts', 'Upkeep / Oil', 'Upkeep / Hours*', 'Feed / Rate', 'Probe*']),
     page.map((g) => g.name).join(', '));
  ok('a card carries its section and title; its name stays the wire string',
     eq(page.map((g) => [g.section, g.title]).slice(2, 4), [['Upkeep', 'Belts'], ['Upkeep', 'Oil']]));
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS — the renderer is machine-agnostic.'));
process.exit(fails ? 1 : 0);
