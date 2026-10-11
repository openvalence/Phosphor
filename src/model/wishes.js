/**
 * wishes.js -- the SUBSCRIBE policy: which hub-to-client channels this client
 * asks for, at what rate, within the hub's declared caps. Pure, so the policy
 * is testable with no hub; machine.svelte.js owns the session that sends it.
 * Rates here are SUBSCRIBE rates, never draw rates (machine.svelte.js header).
 */

import { CHANNEL_CLASS, PRIORITY } from '../../../Valence/clients/js/index.js';
import { CORE_CHANNEL } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { ROLE } from './roles.js';
import { telemetryRate } from './prefs.js';

/**
 * Default ceiling for ordinary channels (settings, diagnostics, tuning) —
 * nobody's eye tracks these in real time frame-to-frame, so a modest,
 * unmeasured-but-safe rate is fine. NOT a draw rate; see machine.svelte.js's header.
 * TELEMETRY_HZ below overrides this for the three roles that actually need
 * to be paced well. This is a two-tier policy (telemetry vs everything else),
 * not full per-priority stratification — nothing measured here showed
 * background/diagnostic channels need their own tier, and the override
 * mechanism (telemetryChannelIds()) generalizes to adding one if that changes.
 */
export const MAX_SUBSCRIBE_HZ = 30;

/**
 * Subscribe rate for the roles the rail's comet and hero numerals read
 * (TELEMETRY_ROLES); every other channel keeps MAX_SUBSCRIBE_HZ. This is a
 * LATENCY knob: telebuf.js's render delay is sized from the p95 arrival gap,
 * so a shorter period is a shorter display lag.
 *
 * The hub paces a subscription on a schedule that advances one grant period
 * per push, checked on its 5 ms tick (Valence subscription.hpp markPushed),
 * so the grant is met on average and never exceeded; each gap is whole ticks.
 * 60 Hz gains little: its 20, 15, 15 ms gaps leave the p95 gap at 20 ms.
 *
 * Never a rate the hub refuses: SUBSCRIBE refuses per wish only on channel,
 * access or subscription count (SPEC §6.7), and a wish above the channel's
 * max_rate_hz is clamped to it, by subscriptionWishes() below and by the hub
 * (SPEC §10.2).
 */
export const TELEMETRY_HZ = 50;
const TELEMETRY_ROLES = new Set([ROLE.telemetryPosition, ROLE.telemetryTarget, ROLE.telemetryVelocity]);

/**
 * Build SUBSCRIBE wishes from the catalog itself — every hub-to-client channel
 * it advertises, at a rate the DEVICE can pace, not a rate the browser draws.
 *
 * Generic on purpose: a machine with channels we have never heard of gets
 * subscribed to anyway, and its data shows up in the diagnostics surface even
 * though no bespoke widget knows what it means. That is the difference between
 * a client and OUR client.
 *
 * ONE combined wish list — STATE and EVENT wishes mixed in the same frame.
 * RFC-033 settled this: mixing classes in one SUBSCRIBE is, and always was,
 * legal. See subscribeInBatches() for the field bug this used to be blamed on.
 *
 * `telemetryIds` (telemetryChannelIds() below) get the operator's telemetry
 * rate preference (prefs.js telemetryRate, default TELEMETRY_HZ) instead of
 * MAX_SUBSCRIBE_HZ, always within the channel's max_rate_hz. `skip` holds the
 * ids already wished in HELLO, whose slots `reserved` counts against the cap.
 * `role` (the session's tier) drops entries whose `access` is above it: the hub
 * would answer each with NACK ACCESS_DENIED.
 *
 * @returns {{wishes: Array, dropped: number}}
 */
export function subscriptionWishes(entries, { maxSubs, telemetryIds, skip = new Set(), reserved = 0, pref, role = null } = {}) {
  const wishes = [];
  for (const e of entries) {
    if (e.dir !== 0) continue;                       // h2c only; we do not publish
    if (skip.has(e.id)) continue;                    // wished in HELLO
    if (e.cls !== CHANNEL_CLASS.STATE && e.cls !== CHANNEL_CLASS.EVENT) continue;
    if (role != null && (e.access | 0) > role) continue;
    // EVENTs are edge-driven; a rate on them is meaningless. On-change STATE
    // channels advertise 0 and mean it.
    let rate = (e.cls === CHANNEL_CLASS.EVENT || !e.maxRateHz)
      ? 0
      : Math.min(e.maxRateHz, MAX_SUBSCRIBE_HZ);
    if (telemetryIds && telemetryIds.has(e.id) && e.maxRateHz) {
      rate = telemetryRate(e.maxRateHz, TELEMETRY_HZ, pref);
    }
    // RFC-077: every client MUST hold catalog 0x0001, so shedding never takes it.
    const pri = e.id === CORE_CHANNEL.catalog ? PRIORITY.critical : e.priority ?? PRIORITY.background;
    wishes.push([e.id, rate, pri]);
  }

  // ---- RESPECT THE HUB'S SUBSCRIPTION CAP --------------------------------
  //
  // FIELD BUG, found by pointing this client at the real machine: it advertises
  // 33 channels, this wanted 21 of them, and the hub's per-session cap is
  // smaller than that. Over-subscribing did NOT earn a NACK — the SUBSCRIBE was
  // dropped WHOLESALE, so the session went LIVE with zero grants and zero STATE,
  // and every readout on every tab rendered `--`. It looked like a rendering
  // bug and was a protocol-etiquette bug. The simulator hid it by advertising
  // fewer channels.
  //
  // The cap is whatever the hub declared in WELCOME, so this adapts to any
  // machine rather than hardcoding a number. When we have to drop some, drop
  // the LEAST important: sorting by priority descending keeps safety and motion
  // and sheds background diagnostics, which is the same ordering the hub itself
  // uses when it sheds under congestion (SPEC 10.4).
  // The HELLO wishes hold their own slots of the session cap.
  const cap = (typeof maxSubs === 'number' && maxSubs > 0) ? Math.max(0, maxSubs - reserved) : wishes.length;
  if (wishes.length <= cap) return { wishes, dropped: 0 };
  const ranked = wishes.slice().sort((a, b) => b[2] - a[2]);
  return { wishes: ranked.slice(0, cap), dropped: wishes.length - cap };
}

/**
 * RFC-077 (SPEC §8.6): a catalog adopted again inside one session. Survivors
 * are byte-identical, so only the channels that vanished (`removed`, ids) and
 * the wishes not already held (`fresh`, of the full policy for the new
 * catalog) change. `held` is the set of ids this session subscribed.
 * @returns {{removed: number[], fresh: Array, dropped: number}}
 */
export function regrow(prevEntries, nextEntries, held, opts) {
  const ids = new Set(nextEntries.map((e) => e.id));
  const { wishes, dropped } = subscriptionWishes(nextEntries, opts);
  return {
    removed: prevEntries.filter((e) => !ids.has(e.id)).map((e) => e.id),
    fresh: wishes.filter((w) => !held.has(w[0])),
    dropped,
  };
}

/** Channel ids carrying any of TELEMETRY_ROLES on this machine, by role — never a hardcoded id. */
export function telemetryChannelIds(model) {
  const ids = new Set();
  if (!model || !model.byRole) return ids;
  for (const role of TELEMETRY_ROLES) {
    const list = model.byRole.get(role);
    if (list) for (const f of list) ids.add(f.channelId);
  }
  return ids;
}

