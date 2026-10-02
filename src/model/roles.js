/**
 * roles.js — the protocol's SEMANTIC vocabulary, and the claim mechanism that
 * turns it into bespoke widgets.
 *
 * ── Why this is not "device knowledge" ─────────────────────────────────────
 *
 * The rule for the layer above the Valence protocol client is: know nothing about THIS
 * machine. Channel 0x1000, the field name `window_min`, the option label
 * "Half'n'Half" — all of those describe one device and hardcoding them is what
 * made our UI privileged.
 *
 * A ROLE is the opposite kind of fact. `window.min` is defined in
 * the Valence repo's registry.yaml and means the same thing on every
 * conforming hub, forever. Binding a rail widget to `window.min` + `window.max`
 * + `telemetry.position` means it draws correctly on a machine built by someone
 * we have never met, provided they annotated their catalog — and if they did
 * not, the fields still render as ordinary sliders and nothing is lost.
 *
 * That is the whole trick behind "don't gimp our UI, just make it as nice on
 * another machine": the nice widgets are not ours, they are the PROTOCOL's, and
 * any client library can ship the same ones.
 *
 * ── Roles are OPPORTUNITIES, never REQUIREMENTS ────────────────────────────
 *
 * Registry doctrine, verbatim: "nothing is hardcoded as a REQUIREMENT; roles
 * are hardcoded as OPPORTUNITIES." A hero widget that cannot find its roles
 * must decline to render and let the generic path handle those fields. An
 * unknown role must never be an error. Both rules are enforced by claimRoles()
 * below rather than left to each widget's good manners.
 *
 * SOURCE OF TRUTH: the Valence repo's registry.yaml, `field_roles`. This
 * file mirrors it by hand, the same way frames.js mirrors the wire constants.
 * If the two ever disagree, the registry wins.
 */

/** Registry `field_roles` vocabulary. */
export const ROLE = {
  // kinematic limits — CEILINGS, never targets
  limitJogSpeed: 'limit.jog.speed',
  limitJogAccel: 'limit.jog.accel',
  limitInputSpeed: 'limit.input.speed',
  limitInputAccel: 'limit.input.accel',
  limitInputJerk: 'limit.input.jerk',

  // the stroke window
  windowMin: 'window.min',
  windowMax: 'window.max',

  // RFC-041: how far the machine can actually travel, as opposed to
  // window.min/window.max's OWN catalog min/max annotations (which bound the
  // legal WINDOW SETTING VALUE, not the physical rail). Neither field is a
  // substitute for these — see RFC-041 for why. Both are lengths in the
  // window fields' own unit, measured/configured from the low end of travel.
  geometryMaxTravel: 'geometry.max_travel',
  geometryMeasuredTravel: 'geometry.measured_travel',

  // live telemetry
  telemetryPosition: 'telemetry.position',
  telemetryVelocity: 'telemetry.velocity',
  telemetryCurrent: 'telemetry.current',
  telemetryPowerBus: 'telemetry.power.bus',
  telemetryTemp: 'telemetry.temp',
  telemetryUptime: 'telemetry.uptime',
  // RFC-032: where the machine is currently COMMANDED to, as opposed to
  // telemetryPosition (where it is). Neither role says whether its number was
  // measured or computed — that is `provenance` (RFC-048 key 22), per FIELD,
  // and it is the only thing allowed to decide the wording. Lag is
  // deliberately not its own role — a hero widget computes target - position
  // client-side.
  telemetryTarget: 'telemetry.target',

  // identity
  identityName: 'identity.name',

  // RFC-032: value-bearing INTENT fields (as opposed to action.* verbs).
  // A schema field carrying this role is a SETPOINT — render a positional
  // control (rail, tape, slider) and write it via sendIntent, never
  // writeSetting (it is not a RFC-009 setting).
  commandPosition: 'command.position',

  // RFC-035: in-flight motion-plan telemetry.
  planStart: 'plan.start',
  planEnd: 'plan.end',
  planCurrent: 'plan.current',
  planVelocity: 'plan.velocity',
  planElapsed: 'plan.elapsed',
  planDuration: 'plan.duration',
  planStyle: 'plan.style',

  // machinery
  enabledMask: 'meta.enabled_mask',
  resetGen: 'meta.reset_gen',

  // built-in pattern generator
  patternRunning: 'pattern.running',
  patternSelect: 'pattern.select',
  patternSpeed: 'pattern.speed',
  patternDepth: 'pattern.depth',
  patternStroke: 'pattern.stroke',
  patternSensation: 'pattern.sensation',

  // RENDERING §10.1: an autonomous source keeps running after its session ends
  sourceBackgroundRun: 'source.background_run',

  // RFC-088 (SPEC §9.6): the rail's direction flip, a stored setting
  axisFlipped: 'axis.flipped',
};

/**
 * DRAFT vocabulary for RENDERING §10 `generator-advanced`: no hub may emit
 * these until the RFCs are accepted, so a widget binding them declines on
 * every catalog today and its fields stay Tier 0. Never fall back to field
 * names (law 6). Move each into ROLE when the registry carries it.
 */
// TODO(rfc-bf4): RFC-081 master roles; run/stop is ROLE.patternRunning.
// TODO(rfc-0sm): RFC-066 lane roles, one complete set per STATE channel.
// TODO(rfc-2n5): RFC-067 store op select.
export const DRAFT_ROLE = {
  advgenMode: 'advgen.mode',
  advgenMaster: 'advgen.master',
  advgenDepthMax: 'advgen.depth_max',
  advgenDepthMin: 'advgen.depth_min',
  advgenSpeedIn: 'advgen.speed_in',
  advgenSpeedOut: 'advgen.speed_out',
  advgenAccelIn: 'advgen.accel_in',
  advgenAccelOut: 'advgen.accel_out',
  laneAmplitude: 'lane.amplitude',
  laneInStep: 'lane.in_step',
  laneInWait: 'lane.in_wait',
  laneOutStep: 'lane.out_step',
  laneOutWait: 'lane.out_wait',
  laneOffset: 'lane.offset',
  actionStore: 'action.store',
};

/**
 * ROLE -> HUMAN DISPLAY LABEL.
 *
 * A role is registry vocabulary (the Valence repo's registry.yaml,
 * `field_roles`) — it means the same thing on every conforming hub, so a
 * label keyed off it is not device knowledge any more than the role string
 * itself is. This is the ONLY place a field's wire NAME may be overridden for
 * display; see `labelFor()` in format.js for the resolution order (role label
 * first, then the catalog desc's leading clause, then `humanize(field.name)`;
 * never a per-device name table).
 *
 * Wording prefers the pre-refactor UI's own choices where it had one
 * (`git show webui-prerefactor:webui/index.html` / `style.css` — "Input
 * jerk" etc for the limit sliders; RFC-085 renamed the manual set to jog) so this reads as a relabel,
 * not a redesign.
 *
 * A LABEL HERE NAMES THE QUANTITY AND NOTHING ELSE. It must never assert
 * where the number came from: `telemetry.position` is "Position", never
 * "Actual", because on a machine whose planner renders position the reported
 * value is PLANNED and calling it actual is the UI claiming a measurement
 * nobody made. The demand/planned/actual word comes from the field's own
 * `provenance` and is composed onto this label in format.js's labelFor().
 *
 * Every entry in ROLE above SHOULD have a mapping here — a role with no label
 * just falls through to humanize(), which is a safe, correct default, not a
 * bug, so this is a courtesy for readability, not something claimRoles()
 * enforces.
 */
export const ROLE_LABEL = {
  [ROLE.limitJogSpeed]: 'Jog speed',
  [ROLE.limitJogAccel]: 'Jog accel',
  [ROLE.limitInputSpeed]: 'Input speed',
  [ROLE.limitInputAccel]: 'Input accel',
  [ROLE.limitInputJerk]: 'Input jerk',

  [ROLE.windowMin]: 'Window min',
  [ROLE.windowMax]: 'Window max',

  [ROLE.geometryMaxTravel]: 'Max travel',
  [ROLE.geometryMeasuredTravel]: 'Measured travel',

  [ROLE.telemetryPosition]: 'Position',
  [ROLE.telemetryTarget]: 'Target',
  [ROLE.telemetryVelocity]: 'Speed',
  [ROLE.telemetryCurrent]: 'Current',
  [ROLE.telemetryPowerBus]: 'Bus power',
  [ROLE.telemetryTemp]: 'Temperature',
  [ROLE.telemetryUptime]: 'Uptime',

  [ROLE.identityName]: 'Machine name',

  [ROLE.enabledMask]: 'Enabled mask',
  [ROLE.resetGen]: 'Reset counter',

  [ROLE.commandPosition]: 'Move to',

  [ROLE.planStart]: 'Plan start',
  [ROLE.planEnd]: 'Plan end',
  [ROLE.planCurrent]: 'Plan position',
  [ROLE.planVelocity]: 'Plan speed',
  [ROLE.planElapsed]: 'Elapsed',
  [ROLE.planDuration]: 'Duration',
  [ROLE.planStyle]: 'Style',

  [ROLE.patternRunning]: 'Running',
  [ROLE.patternSelect]: 'Pattern',
  [ROLE.patternSpeed]: 'Speed',
  [ROLE.patternDepth]: 'Depth',
  [ROLE.patternStroke]: 'Stroke',
  [ROLE.patternSensation]: 'Sensation',

  [ROLE.sourceBackgroundRun]: 'Run in background',

  [ROLE.axisFlipped]: 'Flip',
};

/** Open convention (RFC-019): `action.<name>` marks an INTENT field as a verb. */
export const ACTION_PREFIX = 'action.';

/** @param {string} role @returns {boolean} */
export function isActionRole(role) {
  return typeof role === 'string' && role.startsWith(ACTION_PREFIX);
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/**
 * Attempt to satisfy a hero widget's role requirements against the live model.
 *
 * A claim spec looks like:
 *   { require: { min: ROLE.windowMin, max: ROLE.windowMax },
 *     optional: { pos: ROLE.telemetryPosition, move: ROLE.commandPosition },
 *     requireOne: [['pos', 'move']] }
 *
 * Returns null if ANY required role is missing — the caller then renders
 * nothing bespoke and the generic path picks the fields up as normal controls.
 * That "return null" is the load-bearing line in this file: it is what stops a
 * hero widget from half-rendering against a machine that does not have what it
 * needs, which is how a UI ends up lying.
 *
 * @param {Map<string, Array>} byRole from buildSettingsModel
 * @param {{require?: Object, optional?: Object}} spec
 * @returns {Object|null} { key: field, ... , claimed: Set<uid> }
 */
export function claimRoles(byRole, spec) {
  const out = { claimed: new Set() };
  const take = (role) => {
    const list = byRole.get(role);
    if (!list || !list.length) return null;
    // Ambiguity is possible in principle (two channels both claiming
    // window.min). First-authored wins, deterministically, rather than
    // guessing which one is "the real" one. A peak/total/min/mean companion
    // is never a live binding (RENDERING §5.4).
    return list.find((f) => !f.aspect) || null;
  };

  for (const [name, role] of Object.entries(spec.require || {})) {
    const f = take(role);
    if (!f) return null;                  // requirement unmet -> decline entirely
    out[name] = f;
    out.claimed.add(f.uid);
  }
  for (const [name, role] of Object.entries(spec.optional || {})) {
    const f = take(role);
    if (f) {
      out[name] = f;
      out.claimed.add(f.uid);
    } else {
      out[name] = null;
    }
  }
  // Law 7: each `requireOne` list names optional keys of which at least one
  // must resolve, or the hero declines like any unmet requirement.
  for (const keys of spec.requireOne || []) {
    if (!keys.some((k) => out[k])) return null;
  }
  // `instances: { key: { roles: {k: role}, min } }`: a role set repeated once
  // per channel (RFC-066 lanes). An instance is a channel carrying EVERY role
  // in the set; partial channels are left to Tier 0. The count is whatever
  // the catalog declares, in ascending channel id; fewer than `min` declines.
  for (const [name, inst] of Object.entries(spec.instances || {})) {
    const byCh = new Map();
    for (const [k, role] of Object.entries(inst.roles)) {
      for (const f of byRole.get(role) || []) {
        if (f.aspect) continue;
        if (!byCh.has(f.channelId)) byCh.set(f.channelId, { channelId: f.channelId });
        const m = byCh.get(f.channelId);
        if (!m[k]) m[k] = f;             // first in the entry wins
      }
    }
    const keys = Object.keys(inst.roles);
    const list = [...byCh.values()].filter((m) => keys.every((k) => m[k]))
      .sort((a, b) => a.channelId - b.channelId);
    if (list.length < (inst.min ?? 1)) return null;
    out[name] = list;
    for (const m of list) for (const k of keys) out.claimed.add(m[k].uid);
  }
  return out;
}

/**
 * RENDERING §10 `axis-hero`: window, live position, and the commanded side of
 * the §8.4 overlay (telemetry.target or command.position). Anything less
 * declines (law 7); the window fields then render as Tier-0 controls.
 */
export const AXIS_HERO_SPEC = {
  require: { min: ROLE.windowMin, max: ROLE.windowMax, pos: ROLE.telemetryPosition },
  requireOne: [['move', 'target']],
  optional: {
    vel: ROLE.telemetryVelocity,
    move: ROLE.commandPosition, target: ROLE.telemetryTarget,
    // RFC-041 travel extent; absent means the rail falls back to the window
    // fields' own bounds.
    extentMeasured: ROLE.geometryMeasuredTravel,
    extentMax: ROLE.geometryMaxTravel,
    // RFC-088: absent means no Flip control, never a dead one.
    flip: ROLE.axisFlipped,
  },
};

/**
 * RENDERING §10 `generator-advanced`, on DRAFT_ROLE only: declines on every
 * catalog until RFC-081/066 are ruled and a hub adopts them (law 7).
 */
export const ADVGEN_SPEC = {
  require: {
    running: ROLE.patternRunning,
    master: DRAFT_ROLE.advgenMaster,
    depthMax: DRAFT_ROLE.advgenDepthMax,
    depthMin: DRAFT_ROLE.advgenDepthMin,
    speedIn: DRAFT_ROLE.advgenSpeedIn,
    speedOut: DRAFT_ROLE.advgenSpeedOut,
    accelIn: DRAFT_ROLE.advgenAccelIn,
    accelOut: DRAFT_ROLE.advgenAccelOut,
  },
  optional: {
    bgRun: ROLE.sourceBackgroundRun,
    mode: DRAFT_ROLE.advgenMode,
    presetOp: DRAFT_ROLE.actionStore,
  },
  // At least one lane, not RFC-066's four nor the reference hub's six:
  // the count is an open ruling (rfc-0sm).
  instances: {
    lanes: {
      min: 1,
      roles: {
        amplitude: DRAFT_ROLE.laneAmplitude,
        inStep: DRAFT_ROLE.laneInStep,
        inWait: DRAFT_ROLE.laneInWait,
        outStep: DRAFT_ROLE.laneOutStep,
        outWait: DRAFT_ROLE.laneOutWait,
        offset: DRAFT_ROLE.laneOffset,
      },
    },
  },
};

/**
 * Resolve an ordered list of hero specs against the live role index. The ONE
 * claim loop: built-in heroes (heroes.js) and tier-2 plugin heroes
 * (plugins/host.js) both pass through here, so a plugin claims exactly the
 * way a built-in does. Each hero's own fields are returned alongside it.
 *
 * DESIGN §3 tier-2 "renders instead": a hero descriptor may carry
 * `replaces: '<built-in hero id>'` (plugins/host.js's `registerHero`). Its
 * OWN claim is resolved first, independent of list order, so a built-in
 * earlier in `heroes` is skipped outright rather than claimed and then
 * discarded. When the replacer declines (roles absent, plugin disabled) the
 * built-in is never suppressed and claims normally in the pass below —
 * fields are never left unclaimed just because a replacement was requested.
 *
 * @param {Map<string, Array>} byRole from buildSettingsModel
 * @param {Array<{spec: Object, replaces?: string}>} heroes in render order
 * @returns {{widgets: Array, claimed: Set<string>}}
 */
export function claimAll(byRole, heroes) {
  const widgets = [];
  const claimed = new Set();
  if (!byRole) return { widgets, claimed };

  const claimOne = (h) => {
    const fields = claimRoles(byRole, h.spec);
    if (!fields) return false;         // machine lacks the roles: decline
    widgets.push({ ...h, fields });
    // `absorb: false` is a read-only view: it binds the fields without
    // taking their controls away from the generic tree.
    if (h.absorb !== false) for (const uid of fields.claimed) claimed.add(uid);
    return true;
  };

  const suppressed = new Set();
  for (const h of heroes) {
    if (!h.replaces) continue;
    if (claimOne(h)) suppressed.add(h.replaces);
  }
  for (const h of heroes) {
    if (h.replaces || suppressed.has(h.id)) continue;   // already resolved above, or superseded
    claimOne(h);
  }
  return { widgets, claimed };
}

/**
 * Remove claimed fields from the generic settings tree.
 *
 * A field drawn twice — once inside the rail widget and again as a loose
 * slider below it — is two controls fighting over one truth, and the loser
 * shows a stale value. So a hero widget CONSUMES its fields.
 *
 * Groups and categories that end up empty are dropped, which is what makes the
 * page shrink honestly when a hero absorbs a whole card.
 *
 * @param {Array<Object>} categories from buildSettingsModel
 * @param {Set<string>} claimedUids
 * @returns {Array<Object>} a new category array; the input is not mutated
 */
export function withoutClaimed(categories, claimedUids) {
  if (!claimedUids || !claimedUids.size) return categories;
  const out = [];
  for (const cat of categories) {
    const groups = [];
    for (const g of cat.groups) {
      // settings.js's WIDGET.range merges a min/max pair into one field with
      // no uid of its own a hero would ever claim (`lo.uid+'+'+hi.uid`); drop
      // it too when EITHER half is claimed, same "consumed, not half-shown"
      // rule as an ordinary field, so a hero absorbing window.min/window.max
      // cannot leave its merged sibling drawn a second time underneath it.
      const fields = g.fields.filter((f) => !claimedUids.has(f.uid)
        && !(f.lo && claimedUids.has(f.lo.uid))
        && !(f.hi && claimedUids.has(f.hi.uid)));
      if (fields.length) groups.push({ ...g, fields });
    }
    if (groups.length) out.push({ ...cat, groups });
  }
  return out;
}
