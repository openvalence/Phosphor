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

// The shell's datagram e-stop (RFC-053, src/shell/estop-udp.js). The served
// page never sets a hook, so there noteEstopPress does nothing.
let estopPressHook = null;

/** Shell only: called on every e-stop assertion, before the intent leaves. */
export function setEstopPressHook(fn) {
  estopPressHook = typeof fn === 'function' ? fn : null;
}

/**
 * runAction's first call: fires the hook when this invocation asserts the
 * e-stop (law 2: op identity). Never throws: the session's own estop must
 * leave whatever the hook does.
 */
export function noteEstopPress(action, value) {
  if (!estopPressHook || !action || action.channelId !== CH_SAFETY_INTENTS || value !== SAFETY_OP.estop) return;
  try {
    estopPressHook();
  } catch (e) {
    console.error('e-stop datagram hook failed', e);
  }
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
 * Does a source own the rail (SPEC §11.4)? A generator owns it from start to
 * stop (RFC-093): pattern.running or advgen.running, reported values only.
 * Never read control-owner here: a slot stays held for its session's life
 * (a stopped generator, a finished jog or stream), so it cannot say the rail
 * is busy now. A stream holding the rail is the hub's SOURCE_CONFLICT to say.
 */
// ponytail: generators only; a live stream joins once source ids are registry vocabulary.
export function railOwned(byRole, samples) {
  return isOn(samples, firstOf(byRole, FIELD_ROLE.pattern_running))
    || isOn(samples, firstOf(byRole, FIELD_ROLE.advgen_running));
}

/**
 * The name of the source holding the rail. control-owner is {source,
 * owner} pairs (SPEC §11.4); an owned pair's source id reads through that
 * source field's own `options` (index-aligned to the source id, the hub's
 * labels). '' when no pair is owned or the catalog labels no sources.
 */
// ponytail: first owned, labeled pair wins; ask the hub for one active source if two can own at once.
export function railOwnerName(ownerEntry, ownerSample) {
  const layout = (ownerEntry && ownerEntry.layout) || [];
  for (let k = 0; ownerSample && k + 1 < layout.length; k += 2) {
    const src = layout[k], owner = layout[k + 1];
    const name = ownerSample[owner.name] && src.options && src.options[ownerSample[src.name]];
    if (name) return name;
  }
  return '';
}

/**
 * Confirm-dialog copy, straight from the catalog: the op's own option label
 * (or the field's label) as the title, its `desc` as the body.
 */
export function confirmCopy(item, value) {
  const title = item && item.options ? optionLabel(item, value).replace(/_/g, ' ') : labelFor(item);
  return { title, body: (item && item.desc) || '' };
}
