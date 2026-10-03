/**
 * shadow.svelte.js — the Ground Truth Doctrine, implemented once.
 *
 * CLAUDE.md 3: "Optimistic UI state is prohibited: controls reflect confirmed
 * device state... a UI that lies about machine state is a safety defect on this
 * product." This file is the only place a write is allowed to be in flight, and
 * the only place that decides what number a control shows while it is.
 *
 * ── THE THREE ENTRY POINTS, and why there are exactly three ─────────────────
 *
 * The wire has three shapes of outbound INTENT, and this file is now the ONLY
 * place any of them may be fired — `session.sendIntent` must never be called
 * from a component. `grep -rn "sendIntent" src/` outside this file and
 * the Valence protocol client should come back empty.
 *
 *   writeSetting(field, value)   RFC-009 settings   — a STORED value with a
 *                                                      shadow record and an
 *                                                      enabled_mask gate.
 *   runAction(action, value)     RFC-019 verbs       — a momentary op with no
 *                                                      stored value; fires
 *                                                      IMMEDIATELY, never
 *                                                      queued (an e-stop that
 *                                                      waited on a coalescing
 *                                                      timer would be a safety
 *                                                      defect, not a UX nicety).
 *   sendCommand(field, value)    RFC-032 commands    — a value-bearing SETPOINT
 *                                                      (e.g. `command.position`)
 *                                                      with no stored value to
 *                                                      shadow, but the SAME
 *                                                      pending/applied/refused
 *                                                      lifecycle as a setting,
 *                                                      coalesced at the SAME
 *                                                      catalog-declared rate.
 *
 * All three funnel through the same shadow-record machinery (`ensureShadow` /
 * `settle` / `fail`) so every write, of any shape, gets one status vocabulary
 * (`confirmed` / `pending` / `overdue` / `fault`) and — critically — every
 * refusal updates the GLOBAL `lastRefusal` record below, whether or not the
 * control that sent it is still on screen.
 *
 * ── The per-record lifecycle ──────────────────────────────────────────────
 *
 *   confirmed ──write──> pending ──ECHO──> confirmed (value = APPLIED)
 *                          │  │
 *                          │  └─500ms──> overdue  (same value, louder styling)
 *                          │                 └─2s──> fault
 *                          └─NACK────────────────────> fault (value snaps back)
 *
 * While pending we display the REQUESTED value, because a slider that springs
 * back under the user's thumb is unusable. But it is styled unconfirmed the
 * whole time, and the moment the ECHO lands we display the APPLIED value — so
 * if the device clamped 950 to 800, the number visibly changes in front of the
 * operator. That visible snap is the feature, not a glitch: it is the machine
 * correcting the client in public.
 *
 * On NACK or timeout the requested value is DISCARDED and the control returns
 * to the device's reported truth. We never keep a value the machine refused.
 *
 * ── The global refusal surface ───────────────────────────────────────────────
 *
 * A refused write can be invisible: the rail tape has no persistent widget to
 * decorate once the drag ends, and a control can simply be off-screen when its
 * NACK lands. `lastRefusal` is a SINGLE reactive record, updated by every fault
 * of every kind above, that `ui/TopStrip.svelte` (pinned to the viewport)
 * renders unconditionally — so a refusal is visible even from a control that
 * cannot show it itself.
 *
 * ── Writing at the rate the machine accepts ────────────────────────────────
 *
 * Dragging a slider (or the rail tape) can generate 60 changes a second; the
 * catalog says what the INTENT channel will actually take (0x3000 is 10 Hz,
 * 0x3120 is 5 Hz). So each write CHANNEL gets a coalescing queue clocked at its
 * OWN advertised rate, read from the catalog — settings and commands share this
 * queue, keyed by channel id, because both write real INTENT fields subject to
 * the same rate the hub enforces. Exceeding it would earn RATE_LIMITED NACKs
 * and make every control look broken under normal use. This is the write-side
 * twin of "subscribe at the rate you draw".
 */

import { machine, getSession } from './machine.svelte.js';
import { reportedValue, WIDGET } from './settings.js';
import { labelFor } from './format.js';
import { motionTarget, createMotionDoor, latchWords } from './motion.js';
import { NACK_NAME, LOG_LEVEL_NAME } from '../../../Valence/clients/js/index.js';

const OVERDUE_MS = 500;
const FAULT_MS = 2000;
// Every write stamps its record with the next number; an answer settles or
// faults the record only while it still carries the stamp of the write that
// answer belongs to. A late answer to an older write (the session's own 3 s
// timeout landing after FAULT_MS faulted it and a newer write began) is
// dropped, never applied to the newer write (ph-6i9).
let writeSeq = 0;
const SETTLE_MS = 900;      // how long a confirm flash lingers

/** key -> shadow record. key is `${kind}:${channelId}:${key}` — see keyOf(). */
export const shadows = $state({});

export const STATUS = {
  confirmed: 'confirmed',
  pending: 'pending',
  overdue: 'overdue',
  fault: 'fault',
};

/**
 * `${kind}:${channelId}:${key}` — `kind` namespaces the three write shapes
 * ('set' | 'cmd' | 'act') so a settings write and a command write can never
 * collide even if a device happened to reuse a channel/key pair across both
 * (the settingKey and schema-field-key numbers are drawn from independent
 * per-channel spaces on the wire, so this is defensive, not observed).
 */
function keyOf(kind, channelId, key) {
  return kind + ':' + channelId + ':' + key;
}

// ---------------------------------------------------------------------------
// Global refusal surface
// ---------------------------------------------------------------------------

/**
 * The most recent refused (or otherwise failed) write, from ANY of the three
 * entry points, anywhere in the app. `code`/`detail` are the NACK's own wire
 * data when the failure was a real refusal (null for a timeout/no-link
 * failure, which still updates this record — "the machine said no" and "we
 * never heard back" are both refusals a control must not swallow silently).
 */
export const lastRefusal = $state({
  code: null, text: null, detail: null, channelId: null, label: null, at: 0,
});

const NO_ANSWER = 'no answer from the hub';
/** A fault's words: only a NACK reads as the hub refusing (ph-xec). */
const whyOf = (err) => (err && err.code != null ? 'refused: ' + (err.name || NACK_NAME[err.code]) : NO_ANSWER);

function noteRefusal(err, why, channelId, label) {
  lastRefusal.code = (err && err.code != null) ? err.code : null;
  lastRefusal.text = why;
  lastRefusal.detail = (err && err.detail) || null;
  lastRefusal.channelId = channelId != null ? channelId : null;
  lastRefusal.label = label || null;
  lastRefusal.at = Date.now();
}

/** Clear the global banner — called once the operator's remedy tap is ECHO-confirmed. */
export function clearLastRefusal() {
  lastRefusal.code = null;
  lastRefusal.text = null;
  lastRefusal.detail = null;
  lastRefusal.channelId = null;
  lastRefusal.label = null;
  lastRefusal.at = 0;
}

// ---------------------------------------------------------------------------
// Per-channel coalescing queues (shared by settings AND commands)
// ---------------------------------------------------------------------------

/** channelId -> { pending: Map<key, {value, shadowKey}>, timer, lastSentAt } */
const queues = new Map();

/** The channel's own advertised intent rate, straight from the catalog. */
function intervalFor(channelId) {
  const e = machine.catalog.entries.find((x) => x.id === channelId);
  const hz = e && e.maxRateHz ? e.maxRateHz : 5;
  return Math.max(1000 / hz, 20);
}

function queueFor(channelId) {
  if (!queues.has(channelId)) {
    queues.set(channelId, { pending: new Map(), timer: null, lastSentAt: 0 });
  }
  return queues.get(channelId);
}

/**
 * Flush one channel's coalesced fields as a single INTENT.
 *
 * Coalescing is not just an optimization: sending min and max as two intents
 * lets the hub see a transiently inverted window and clamp against a bound the
 * user was in the middle of moving. One intent carrying both is atomic from
 * the machine's point of view. The same reasoning applies to a command field
 * sharing a channel with another field — whatever is queued when the timer
 * fires goes out together.
 */
async function flush(channelId) {
  const q = queueFor(channelId);
  q.timer = null;
  if (!q.pending.size) return;

  const session = getSession();
  const entries = [...q.pending.entries()]; // [key, {value, shadowKey}]
  const fields = {};
  for (const [k, rec] of entries) fields[k] = rec.value;
  q.pending.clear();
  q.lastSentAt = Date.now();

  const mine = (rec) => {
    const sh = shadows[rec.shadowKey];
    return sh && sh.seq === rec.seq ? sh : null;
  };
  if (!session || !session.isLive) {
    for (const [, rec] of entries) {
      const sh = mine(rec);
      if (sh) fail(sh, 'no link');
    }
    return;
  }

  try {
    // sendIntent encodes each value using the CBOR type the catalog publishes
    // for that key — no local type table, so a machine whose field is a float
    // where ours is an int is encoded correctly without any client change.
    const echo = await session.sendIntent(channelId, fields);
    const applied = (echo && echo.applied) || {};
    for (const [k, rec] of entries) {
      const sh = mine(rec);
      if (!sh) continue;
      // The ECHO is the post-clamp APPLIED value. If the key is missing from
      // the echo the machine did not tell us what it did, and we must not
      // pretend it agreed — fall back to reported truth.
      if (Object.prototype.hasOwnProperty.call(applied, k)) {
        sh.applied = applied[k];
        settle(sh);
      } else {
        fail(sh, 'no applied value in echo');
      }
    }
    if (echo && echo.cfgGen != null) machine.link.cfgGen = echo.cfgGen;
  } catch (err) {
    const msg = whyOf(err);
    for (const [, rec] of entries) {
      const sh = mine(rec);
      if (sh) fail(sh, msg, err);
    }
  }
}

function schedule(channelId) {
  const q = queueFor(channelId);
  if (q.timer) return;
  const interval = intervalFor(channelId);
  const wait = Math.max(0, q.lastSentAt + interval - Date.now());
  q.timer = setTimeout(() => flush(channelId), wait);
}

// ---------------------------------------------------------------------------
// Shadow record transitions — shared by all three entry points
// ---------------------------------------------------------------------------

function clearTimers(sh) {
  if (sh._t1) { clearTimeout(sh._t1); sh._t1 = null; }
  if (sh._t2) { clearTimeout(sh._t2); sh._t2 = null; }
  if (sh._t3) { clearTimeout(sh._t3); sh._t3 = null; }
}

/** Get-or-create a shadow record, refreshing its display metadata (a hub can
 *  rebuild the catalog between writes, so the label attached at creation time
 *  is not necessarily still current). */
function ensureShadow(shadowKey, channelId, label) {
  let sh = shadows[shadowKey];
  if (!sh) {
    // Read back through `shadows`: `a = obj[k] = {...}` yields the RAW object,
    // and writes to it bypass the $state proxy, so a first press never re-renders.
    shadows[shadowKey] = {
      status: STATUS.confirmed, requested: undefined, applied: undefined,
      error: null, settled: false, channelId, label,
    };
    sh = shadows[shadowKey];
  } else {
    sh.channelId = channelId;
    sh.label = label;
  }
  return sh;
}

function settle(sh) {
  clearTimers(sh);
  sh.status = STATUS.confirmed;
  sh.settled = true;
  sh.error = null;
  sh.requested = undefined;
  sh._t3 = setTimeout(() => { sh.settled = false; }, SETTLE_MS);
}

/**
 * Move a record to `fault`, discard the requested value, and update the
 * GLOBAL refusal surface. `err` is whatever session.sendIntent's promise
 * rejected with — a NACK-shaped Error (has `.code`/`.detail`) for a real
 * refusal, a plain Error (message only) for a timeout/no-link/no-echo
 * failure. Both are refusals a control must not swallow, so both land here.
 */
function fail(sh, why, err) {
  // A rejection with no NACK code (the session's own timeout) after the
  // ladder already faulted or settled this write changes nothing (ph-xec).
  if (err && err.code == null && sh.status !== STATUS.pending && sh.status !== STATUS.overdue) return;
  clearTimers(sh);
  sh.status = STATUS.fault;
  sh.error = why;
  // Discard the request. The control snaps back to what the machine reports,
  // because that is what is true.
  sh.requested = undefined;
  noteRefusal(err, why, sh.channelId, sh.label);
  sh._t3 = setTimeout(() => {
    if (sh.status === STATUS.fault) { sh.status = STATUS.confirmed; sh.error = null; }
  }, FAULT_MS * 2);
}

/**
 * Start a write on its record: pending, stamped, overdue at OVERDUE_MS and
 * fault at FAULT_MS (law 5). Every entry point starts here, so no write shape
 * can skip a rung. The timers live on the record and the next write clears
 * them, so they never touch a newer write. Returns the stamp.
 */
function begin(sh, value) {
  clearTimers(sh);
  sh.status = STATUS.pending;
  sh.requested = value;
  sh.error = null;
  sh.settled = false;
  sh.seq = ++writeSeq;
  sh._t1 = setTimeout(() => {
    if (sh.status === STATUS.pending) sh.status = STATUS.overdue;
  }, OVERDUE_MS);
  sh._t2 = setTimeout(() => {
    if (sh.status === STATUS.pending || sh.status === STATUS.overdue) fail(sh, NO_ANSWER);
  }, FAULT_MS);
  return sh.seq;
}

// ---------------------------------------------------------------------------
// Entry point 1 of 3: RFC-009 settings
// ---------------------------------------------------------------------------

/**
 * Write one setting. Returns immediately; the shadow carries the outcome.
 *
 * @param {Object} field a field from buildSettingsModel (must not be readOnly)
 * @param {number|string|boolean} value the value the operator chose
 */
export function writeSetting(field, value) {
  if (!field || field.readOnly || field.writeChannel == null) return;
  const shadowKey = keyOf('set', field.writeChannel, field.settingKey);
  const sh = ensureShadow(shadowKey, field.writeChannel, labelFor(field));
  const seq = begin(sh, value);
  queueFor(field.writeChannel).pending.set(field.settingKey, { value, shadowKey, seq });
  schedule(field.writeChannel);
}

// ---------------------------------------------------------------------------
// Entry point 2 of 3: RFC-019 action verbs
// ---------------------------------------------------------------------------

/**
 * Fire an INTENT verb (RFC-019 `action.*`). Actions are not settings: there is
 * no value to shadow long-term, only a success or a refusal — but they still
 * get a shadow record (so `shadowOf`/`statusOf` work on them exactly like any
 * other field) and every refusal updates `lastRefusal` exactly like the other
 * two entry points. Fired IMMEDIATELY, never through the coalescing queue: a
 * queued e-stop is a safety defect, not a UX nicety.
 *
 * @param {Object} action {channelId, key, label, ...} — either a discovered
 *        RFC-019 action from buildSettingsModel's `actions[]`, or an ad-hoc
 *        object of the same shape for a spec-core admin op that is not itself
 *        a device-chosen `action.*` role (e.g. PairingPane's session-admin).
 * @param {number} [value] the op/value written to `action.key`
 * @param {Object<number, *>} [extraFields] additional {key: value} pairs on
 *        the SAME intent (e.g. session-admin's `instance_id`/`role` alongside
 *        `op` — an admin decision is one atomic intent, not three).
 * @returns {Promise<{ok: boolean, error?: string, applied?: Object}>}
 */
export async function runAction(action, value = 1, extraFields = null) {
  const shadowKey = keyOf('act', action.channelId, action.key);
  const sh = ensureShadow(shadowKey, action.channelId, labelFor(action));
  const seq = begin(sh, value);

  const session = getSession();
  if (!session || !session.isLive) {
    fail(sh, 'no link');
    return { ok: false, error: 'no link' };
  }
  const fields = extraFields ? { ...extraFields, [action.key]: value } : { [action.key]: value };
  try {
    const echo = await session.sendIntent(action.channelId, fields);
    const applied = (echo && echo.applied) || {};
    if (sh.seq === seq) {
      sh.applied = Object.prototype.hasOwnProperty.call(applied, action.key) ? applied[action.key] : value;
      settle(sh);
    }
    return { ok: true, applied };
  } catch (err) {
    const msg = whyOf(err);
    if (sh.seq === seq) fail(sh, msg, err);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Entry point 3 of 3: RFC-032 value-bearing commands
// ---------------------------------------------------------------------------

/**
 * Write a value-bearing INTENT command field (RFC-032 `command.*`, e.g.
 * `command.position` — a setpoint, not a stored setting and not a verb). No
 * `settingKey`/`writeChannel`: a command field lives directly on its own
 * INTENT channel (`field.channelId`/`field.key`), the way `buildSettingsModel`
 * pass 2 constructs `isIntentField` descriptors. It goes through the SAME
 * pending -> ECHO -> confirmed / NACK -> fault lifecycle as a setting, and the
 * SAME catalog-rate coalescing queue — a control that fires a command on every
 * pointermove (the rail tape, dragging) gets rate-limited for free instead of
 * hand-rolling a client-side throttle against a guessed interval.
 *
 * @param {Object} field an `isIntentField` descriptor from buildSettingsModel
 * @param {number|string|boolean} value the setpoint the operator chose
 * @param {Object} [opts] reserved (precondition/takeover passthrough, unused today)
 */
export function sendCommand(field, value, opts = {}) {
  void opts; // reserved, unused today
  if (!field || field.channelId == null || field.key == null) return;
  const shadowKey = keyOf('cmd', field.channelId, field.key);
  const sh = ensureShadow(shadowKey, field.channelId, labelFor(field));
  const seq = begin(sh, value);
  queueFor(field.channelId).pending.set(field.key, { value, shadowKey, seq });
  schedule(field.channelId);
}

const LOG_LEVEL = Object.fromEntries(Object.entries(LOG_LEVEL_NAME).map(([n, name]) => [name, Number(n)]));
const motionDoor = createMotionDoor({
  session: getSession,
  entries: () => machine.catalog.entries,
  halted: () => latchWords(machine.safety),
  lastNack: (ch) => machine.events.nacks.findLast((n) => n.channel === ch) || null,
  setpoint: (norm) => {
    const t = motionTarget(machine.catalog.model, machine.samples, norm);
    if (!t.field) return { ok: false, reason: t.reason };
    sendCommand(t.field, t.value);
    return { ok: true };
  },
  // Client-side lines ride the device log ring, tagged, the way plugin lines do.
  log: (level, message) => {
    const ring = machine.events.log;
    ring.push({ channel: null, channelName: 'client', at: Date.now(), body: { level: LOG_LEVEL[level], tag: 'motion', message } });
    if (ring.length > 400) ring.splice(0, ring.length - 400);
  },
});

/**
 * Submit a normalized motion input (0..1 across the stroke window) — the
 * model's motion-input door, used by tier-2 adapters (RFC-044 rung 1).
 *
 * Routed by motion.js createMotionDoor: a timed input to the hub's segments
 * STREAM, an untimed one to its samples STREAM (grants asked for on first
 * use); with neither, entry point 3, a `command.position` setpoint that drops
 * `durationMs`. Which path is live, and
 * every stream refusal, lands in the log pane under the `motion` tag.
 *
 * @param {number} norm 0..1
 * @param {number} [durationMs] the source's requested transit time
 * @returns {{ok: boolean, reason?: string}}
 */
export function submitMotion(norm, durationMs) {
  return motionDoor(norm, durationMs);
}

/** The RFC-087 lookahead door (motion.js submit.segments): [{atMs, norm, durationMs}] -> {ok, sent, rateHz, reason}. */
export function submitSegments(list) {
  return motionDoor.segments(list);
}

// ---------------------------------------------------------------------------
// Public read API — shared by all three entry points
// ---------------------------------------------------------------------------

/** Resolve a field/action descriptor to its shadow key, or null. */
function shadowKeyForField(field) {
  if (!field) return null;
  if (field.widget === WIDGET.action) {
    if (field.channelId == null || field.key == null) return null;
    return keyOf('act', field.channelId, field.key);
  }
  if (field.isIntentField) {
    if (field.channelId == null || field.key == null) return null;
    return keyOf('cmd', field.channelId, field.key);
  }
  if (field.writeChannel == null) return null;
  return keyOf('set', field.writeChannel, field.settingKey);
}

/** Current shadow record for a field/action, or null if it has never been written. */
export function shadowOf(field) {
  const k = shadowKeyForField(field);
  return k ? (shadows[k] || null) : null;
}

/** Status string for styling: confirmed | pending | overdue | fault. */
export function statusOf(field) {
  const sh = shadowOf(field);
  return sh ? sh.status : STATUS.confirmed;
}

/**
 * The value a control must display.
 *
 * In flight -> the requested value (so the control tracks the operator's hand).
 * Otherwise -> the device's reported value, always. Never a remembered request,
 * never a default, never a guess.
 */
export function displayValue(field, sample) {
  const sh = shadowOf(field);
  if (sh && (sh.status === STATUS.pending || sh.status === STATUS.overdue)
      && sh.requested !== undefined) {
    return sh.requested;
  }
  return reportedValue(field, sample);
}

/** True while any write is outstanding — drives the global "unconfirmed" hint. */
export function anyPending() {
  for (const k in shadows) {
    const s = shadows[k].status;
    if (s === STATUS.pending || s === STATUS.overdue) return true;
  }
  return false;
}
