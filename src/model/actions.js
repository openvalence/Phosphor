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

// Ops that ENGAGE a hazard mode (RFC-025c). Meaningful only on the spec-core
// safety-intents channel: the same integer on a device channel is another verb.
const HAZARD_SAFETY_OPS = new Set([SAFETY_OP.override_on, SAFETY_OP.bypass_on]);

/**
 * The catalog's own destructive bit (§8.2 row 6, §8.4 trigger row). SPEC §8.8
 * does not define it yet, so nothing on the wire can set it.
 */
// TODO(ph-vdk.31): read the destructive flag here once its RFC lands.
export function isDestructive(action, value) {
  void action; void value;
  return false;
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

/**
 * Confirm-dialog copy, straight from the catalog: the op's own option label
 * (or the field's label) as the title, its `desc` as the body.
 */
export function confirmCopy(item, value) {
  const title = item && item.options ? optionLabel(item, value).replace(/_/g, ' ') : labelFor(item);
  return { title, body: (item && item.desc) || '' };
}
