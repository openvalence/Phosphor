/**
 * actions.js — confirm posture for verbs and consequential settings.
 *
 * Pure and synchronous, so the rules are testable with no device and no DOM.
 * Every input is registry vocabulary: action tags (RENDERING §7), spec-core
 * safety op numbers on the spec-core safety-intents channel (law 2), and the
 * `source.background_run` role (§10.1). Never a table of machine phrases:
 * confirm COPY comes from the catalog's own label and desc.
 */

import { ACTION_TAG, SAFETY_OP, FIELD_ROLE, CH_SAFETY_INTENTS, SOURCE_KIND } from '../../../Valence/clients/js/index.js';
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
 * every write (SPEC §8.8), `source.background_run` going false -> true
 * (§10.1 rule 2): "this may keep moving after you leave", and `axis.flipped`
 * on every write (RENDERING §8.2 row 7).
 */
export function settingNeedsConfirm(field, from, to) {
  if (!field) return false;
  if (field.flagBits && field.flagBits.destructive) return true;
  if (field.role === FIELD_ROLE.axis_flipped) return true;
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
 * Any held control-owner slot reads as attended: the hub frees a slot on
 * release (RFC-098).
 */
// ponytail: any-owner test; match the generator's slot kind if a held jog or stream must not count.
export function isUnattended(byRole, samples, ownerSample) {
  return runsOnAlone(byRole, samples) && !anyOwner(ownerSample);
}

// control-owner's slots by their SPEC §11.4 names (src<i>, owner<i>, and the
// RFC-098 kind<i>, client_kind<i>, client_name<i>), in slot order.
function slotsOf(o) {
  const out = [];
  for (let i = 0; o && o['owner' + i] !== undefined; i++) {
    out.push({ i, src: o['src' + i], owner: o['owner' + i], kind: o['kind' + i],
      clientKind: o['client_kind' + i] || '', client: o['client_name' + i] || '' });
  }
  return out;
}

/**
 * Does a source own the rail (SPEC §11.4)? A generator owns it from start to
 * stop (RFC-093): pattern.running or advgen.running, reported values only. A
 * stream, classic or advanced slot owns it while held: the hub releases a
 * stream once it goes quiet (RFC-098). Without `ownerSample`, generators only.
 */
const PLAN_KINDS = [SOURCE_KIND.stream, SOURCE_KIND.classic, SOURCE_KIND.advanced];
export function railOwned(byRole, samples, ownerSample) {
  return isOn(samples, firstOf(byRole, FIELD_ROLE.pattern_running))
    || isOn(samples, firstOf(byRole, FIELD_ROLE.advgen_running))
    || slotsOf(ownerSample).some((s) => s.owner && PLAN_KINDS.includes(s.kind));
}

/**
 * The first owner that is not `self`, in words (SPEC §11.4, RFC-098):
 * "<client_kind> on <client_name>", the client kind alone when unnamed, or ''
 * (none, or an older hub).
 */
export function foreignOwner(ownerSample, self) {
  const s = slotsOf(ownerSample).find((x) => x.owner && x.owner !== self);
  if (!s) return '';
  if (s.client) return (s.clientKind ? s.clientKind + ' on ' : '') + s.client;
  return s.clientKind;
}

/** Any control-owner slot held (SPEC §11.4); a slot freed by quiet release reads unheld. */
export function anyOwner(ownerSample) {
  return slotsOf(ownerSample).some((s) => s.owner);
}

/**
 * The name of the source holding the rail. control-owner is {source,
 * owner} pairs (SPEC §11.4); an owned pair's source id reads through that
 * source field's own `options` (index-aligned to the source id, the hub's
 * labels). '' when no pair is owned or the catalog labels no sources.
 */
// ponytail: first owned, labeled pair wins; ask the hub for one active source if two can own at once.
export function railOwnerName(ownerEntry, ownerSample) {
  const o = railOwners(ownerEntry, ownerSample).find((x) => x.name);
  return o ? o.name : '';
}

/**
 * Confirm-dialog copy, straight from the catalog: the op's own option label
 * (or the field's label) as the title, its `desc` as the body.
 */
export function confirmCopy(item, value) {
  if (item && item.role === FIELD_ROLE.axis_flipped) {
    const on = !!Number(value);
    return { title: on ? 'Flip the rail' : 'Unflip the rail', body: 'Home moves to the ' + (on ? 'right' : 'left') + ' end', confirmLabel: on ? 'Flip' : 'Unflip' };
  }
  const title = item && item.options ? optionLabel(item, value).replace(/_/g, ' ') : labelFor(item);
  return { title, body: (item && item.desc) || '' };
}

/**
 * Every owned control-owner pair (SPEC §11.4), in slot order: the source's
 * label through its `options` ('' when the catalog labels none) and the
 * owning session. railOwnerName is the first labeled one.
 */
export function railOwners(ownerEntry, ownerSample) {
  const layout = (ownerEntry && ownerEntry.layout) || [];
  return slotsOf(ownerSample).filter((s) => s.owner).map((s) => {
    const f = layout[2 * s.i]; // the pairs lead the layout: {src, owner} per slot
    return { name: (f && f.options && f.options[s.src]) || '', session: s.owner };
  });
}
