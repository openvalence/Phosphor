/**
 * actions.js — confirm posture for verbs and consequential settings.
 *
 * Pure and synchronous, so the rules are testable with no device and no DOM.
 * Every input is registry vocabulary: action tags (RENDERING §7), spec-core
 * safety op numbers on the spec-core safety-intents channel (law 2), and the
 * `source.background_run` role (§10.1). Never a table of machine phrases:
 * confirm COPY comes from the catalog's own label and desc.
 */

import { ACTION_TAG, SAFETY_OP, FIELD_ROLE, CH_SAFETY_INTENTS } from '../../../Valence/clients/js/index.js';
import { STORE_OP } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { ACTION_PREFIX, isActionRole } from './roles.js';
import { labelFor, optionLabel } from './format.js';

/** The `<tag>` of an `action.<tag>` role, or '' for anything else. */
export function actionTag(action) {
  return action && isActionRole(action.role) ? action.role.slice(ACTION_PREFIX.length) : '';
}

// Registered tags whose registry note says confirm (§7: reboot SHOULD always
// confirm; reset is confirm-gated).
const CONFIRM_TAGS = new Set([ACTION_TAG.reboot, ACTION_TAG.reset]);

// Ops that ENGAGE a hazard mode: override lifts the window and soft limits
// (SPEC §11.1). Meaningful only on the spec-core safety-intents channel: the
// same integer on a device channel is another verb. Its pair, return, takes no
// gate (law 14).
const HAZARD_SAFETY_OPS = new Set([SAFETY_OP.override]);

/**
 * SPEC §8.8 (RFC-063): an invocation is destructive iff the field carries the
 * `destructive` flag, the invoked op's `destructive_options` bit is set, or it
 * is an `action.store` delete. action.reboot/action.reset confirm through
 * CONFIRM_TAGS. Never inferred from labels, names or desc.
 */
export function isDestructive(action, value) {
  if (!action) return false;
  if (action.flagBits && action.flagBits.destructive) return true;
  if (action.destructiveOptions && action.destructiveOptions[value]) return true;
  return actionTag(action) === ACTION_TAG.store && value === STORE_OP.delete_item;
}

// Verbs the persistent region draws by identity and tag (TopStrip's strip);
// the generic trigger path never draws them a second time.
const PERSISTENT_TAGS = new Set([ACTION_TAG.safety, ACTION_TAG.home]);

export function isPersistentAction(action) {
  return PERSISTENT_TAGS.has(actionTag(action));
}

/** Must pressing this op go through the confirm layer first? */
export function needsConfirm(action, value) {
  if (!action) return false;
  // Law 14 outranks any catalog flag: on the safety-intents channel only the
  // hazard op waits on a dialog, never estop, pause or their releases.
  if (action.channelId === CH_SAFETY_INTENTS) return HAZARD_SAFETY_OPS.has(value);
  if (CONFIRM_TAGS.has(actionTag(action))) return true;
  return isDestructive(action, value);
}

/**
 * Must this SETTING write confirm first? A `destructive`-flagged setting on
 * every write (SPEC §8.8), and `source.background_run` going false -> true
 * (§10.1 rule 2): "this may keep moving after you leave".
 */
export function settingNeedsConfirm(field, from, to) {
  if (!field) return false;
  if (field.flagBits && field.flagBits.destructive) return true;
  return field.role === FIELD_ROLE.source_background_run && !from && !!to;
}

const firstOf = (byRole, r) => ((byRole && byRole.get(r)) || [])[0];
const isOn = (samples, f) => { const s = f && samples[f.channelId]; return !!(s && s[f.name]); };

/** The pattern generator is running with background_run on: it outlives its session. */
export function runsOnAlone(byRole, samples) {
  return isOn(samples, firstOf(byRole, FIELD_ROLE.pattern_running))
    && isOn(samples, firstOf(byRole, FIELD_ROLE.source_background_run));
}

/**
 * RENDERING §10.1 rule 3: a source with background_run on is running and no
 * session owns a source. Reported values only, never a pending request.
 * control-owner does not say WHICH source is the generator (source ids are not
 * registry vocabulary), so any owned source reads as attended.
 */
// ponytail: any-owner test; per-source once control sources are registry vocabulary.
export function isUnattended(byRole, samples, ownerSample) {
  if (!runsOnAlone(byRole, samples)) return false;
  for (let i = 0; ownerSample && ownerSample['owner' + i] !== undefined; i++) {
    if (ownerSample['owner' + i]) return false;
  }
  return true;
}

/**
 * Does a source own the rail (SPEC §11.4)? A running pattern, or a
 * control-owner slot held by a session other than `self` (this session's own
 * point move owns a slot too). Reported values only.
 */
// ponytail: any foreign owner counts; per-source once source ids are registry vocabulary.
export function railOwned(byRole, samples, ownerSample, self) {
  if (isOn(samples, firstOf(byRole, FIELD_ROLE.pattern_running))) return true;
  for (let i = 0; ownerSample && ownerSample['owner' + i] !== undefined; i++) {
    const o = ownerSample['owner' + i];
    if (o && o !== self) return true;
  }
  return false;
}

/**
 * Confirm-dialog copy, straight from the catalog: the op's own option label
 * (or the field's label) as the title, its `desc` as the body.
 */
export function confirmCopy(item, value) {
  const title = item && item.options ? optionLabel(item, value).replace(/_/g, ' ') : labelFor(item);
  return { title, body: (item && item.desc) || '' };
}
