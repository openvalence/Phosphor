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
 * The catalog's own destructive bit (§8.2 row 6, §8.4 trigger row). SPEC §8.8
 * does not define it yet, so nothing on the wire can set it.
 */
// TODO(ph-vdk.31): read the destructive flag here once its RFC lands.
export function isDestructive(action, value) {
  void action; void value;
  return false;
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
  if (CONFIRM_TAGS.has(actionTag(action))) return true;
  if (action.channelId === CH_SAFETY_INTENTS && HAZARD_SAFETY_OPS.has(value)) return true;
  return isDestructive(action, value);
}

/**
 * Must this SETTING write confirm first? Only `source.background_run` going
 * false -> true (§10.1 rule 2): "this may keep moving after you leave".
 */
export function settingNeedsConfirm(field, from, to) {
  return !!field && field.role === FIELD_ROLE.source_background_run && !from && !!to;
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
