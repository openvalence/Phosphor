/**
 * machine.svelte.js — the single reactive spine.
 *
 * Owns exactly one Valence session and projects it into Svelte 5 reactive
 * state. Every component reads from here; nothing else opens a socket, and
 * nothing anywhere fabricates a value the machine did not send.
 *
 * ── What "ground truth" means mechanically ─────────────────────────────────
 *
 * `samples[channelId]` is whatever arrived in that channel's last STATE push,
 * decoded by the catalog's own layout. There is no merge with local intent, no
 * optimistic pre-application, no defaulting. A control that wants to know what
 * the machine is doing reads this; a control that wants to know whether its own
 * write landed asks shadow.svelte.js. Keeping those two questions in separate
 * files is what stops the second one from quietly answering the first.
 *
 * ── Two rates that must never be conflated ─────────────────────────────────
 *
 * DRAW rate — how often a widget repaints. Free (it's a couple of floats and
 * a canvas stroke), so it runs at whatever `requestAnimationFrame` gives it —
 * 60 Hz, 120 Hz, 240 Hz, whatever the display refreshes at. Nothing in the
 * render path (RailWidget.svelte, PlanStrip.svelte) may add a fixed-interval
 * timer or a self-imposed fps cap; `prefers-reduced-motion` is the one
 * sanctioned exception (PlanStrip's reduced path drops to a 1 Hz `setInterval`
 * on purpose — that is accessibility, not a performance cap).
 *
 * SUBSCRIBE rate — how often the DEVICE sends a STATE push for a channel.
 * This one is emphatically not free: ESP32 airtime, heap, WS frame count, and
 * the ValenceHubService task's own 5 ms tick budget, shared across every
 * channel ~30 of them subscribed at once. This is the rate `MAX_SUBSCRIBE_HZ`
 * and `TELEMETRY_HZ` below actually govern. A higher DRAW rate cannot make a
 * ragged SUBSCRIBE rate look better — more frames just render the same uneven
 * samples more finely (see telebuf.js's interpolation, which is where
 * smoothness is actually won). Subscribe rate DOES set display latency,
 * though: see TELEMETRY_HZ below.
 */

import {
  createSession, CHANNEL_CLASS, PRIORITY, NACK, LIMITS, acquireToken, getInstanceId, toHex,
} from '../../../Valence/clients/js/index.js';
import { CORE_CHANNEL, CORE_CHANNEL_NAME } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { buildSettingsModel } from './settings.js';
import { ROLE } from './roles.js';

/**
 * Default ceiling for ordinary channels (settings, diagnostics, tuning) —
 * nobody's eye tracks these in real time frame-to-frame, so a modest,
 * unmeasured-but-safe rate is fine. NOT a draw rate; see this file's header.
 * TELEMETRY_HZ below overrides this for the three roles that actually need
 * to be paced well. This is a two-tier policy (telemetry vs everything else),
 * not full per-priority stratification — nothing measured here showed
 * background/diagnostic channels need their own tier, and the override
 * mechanism (telemetryChannelIds()) generalizes to adding one if that changes.
 */
const MAX_SUBSCRIBE_HZ = 30;

/**
 * Subscribe rate for the roles the rail's comet and hero numerals read
 * (TELEMETRY_ROLES); every other channel keeps MAX_SUBSCRIBE_HZ. This is a
 * LATENCY knob: telebuf.js's render delay is sized from the p95 arrival gap,
 * so a shorter period is a shorter display lag.
 *
 * The hub paces a subscription on its 5 ms tick, pushing at the first tick at
 * least 1000/rate ms (truncated to whole ms) after the last push (Valence
 * subscription.hpp dueForPush). 50 Hz is four whole ticks. 60 Hz truncates to
 * 16 ms, which the tick rounds up to 20: 50 Hz delivered under a 60 Hz grant.
 *
 * Never a rate the hub refuses: SUBSCRIBE refuses per wish only on channel,
 * access or subscription count (SPEC §6.7), and a wish above the channel's
 * max_rate_hz is clamped to it, by subscriptionWishes() here and by the hub
 * (SPEC §10.2).
 */
const TELEMETRY_HZ = 50;
const TELEMETRY_ROLES = new Set([ROLE.telemetryPosition, ROLE.telemetryTarget, ROLE.telemetryVelocity]);

/** Bounded rings — an EVENT channel is a firehose and memory is not free. */
const LOG_MAX = 400;
const ANOM_MAX = 200;
const EVT_MAX = 120;
const SAFETY_MAX = 120;
const NACK_MAX = 60;

/**
 * The device-reported half of the state, in its no-connection shape. These are
 * FUNCTIONS, not constants, because forgetDevice() below installs a fresh copy:
 * one home for "what the page knows before any hub has spoken", used both to
 * seed the state and to return to it.
 */
function blankCatalog() {
  return {
    ready: false,
    entries: [],
    etag: '',               // hex, ready to display
    verified: false,        // etag matched what the hub declared (SPEC 8.3)
    bytes: 0,
    cached: false,          // served from the local cache, not re-fetched
    model: null,            // buildSettingsModel() output
  };
}

function blankEvents() {
  return { log: [], anomaly: [], safety: [], session: [], nacks: [] };
}

function blankStats() {
  return {
    framesIn: 0,
    framesOut: 0,
    bytesIn: 0,
    statePushes: 0,
    // Per-channel arrival counts. A cadence problem is per-CHANNEL: the hub
    // sheds and paces each one separately, so a single total cannot tell
    // "position is stuttering" from "the plan channel is quiet".
    pushesByChannel: {},
    // Published once a second by whatever widget owns the rAF loop, so the
    // link bar can separate a render-cadence problem (the shell's webview)
    // from an arrival-cadence one (the wire). Nulls until a loop runs.
    render: { fps: null, delayMs: null, heldPct: null, skewMs: null },
    lastRxMs: 0,
    clockOffsetUs: null,
    clockRttUs: null,
    reconnects: 0,
  };
}

/**
 * THE reactive machine state. One object, deeply proxied by Svelte.
 */
export const machine = $state({
  /** Connection lifecycle as the UI understands it. */
  link: {
    phase: 'idle',          // idle | connecting | handshaking | live | retrying | failed
    since: 0,
    host: '',               // the hub this page is pointed at; '' = none chosen
    port: 82,
    attempts: 0,            // consecutive failed opens since the last good one
    retryAt: 0,             // ms timestamp of the next automatic attempt; 0 = unknown
    sessionId: null,
    roles: 0,               // access tier granted to THIS session
    error: null,
    willReconnect: false,
    closeReason: '',
    deadmanMs: 0,
    cfgGen: 0,
    hubIdentity: null,      // RFC-016 in-band identity, when the hub sends it
    limits: {},             // the hub's declared ceilings, from WELCOME
    subsDropped: 0,         // channels we had to shed to fit max_subscriptions
    stale: true,            // freshness(): written only by checkFreshness()
    staleTick: 0,           // advances at 1 Hz while stale, so stale ages re-render
    openedAt: 0,            // this socket's open; older samples are a past session's
  },

  /** Catalog + everything derived from it. Replaced wholesale on adoption. */
  catalog: blankCatalog(),

  /** channelId -> last decoded STATE sample. The ONLY source of device values. */
  samples: {},
  /** channelId -> ms timestamp of that sample, for staleness display. */
  sampleTs: {},
  /** channelId -> granted {rate, priority}, so the UI can show what it really gets. */
  grants: {},

  /** Bounded event rings, newest last. */
  events: blankEvents(),

  /** Link quality counters for the Valence pane. */
  stats: blankStats(),
});

let session = null;
let _host = '';
let _lastOpts = {};

/**
 * ph-vdk.14: reconciling the safety-events (0x000E) history against the
 * safety (0x0003) latch via `seq_of_state`, without ever reading a device
 * catalog field name (RENDERING §13 law 6; also what keeps this off
 * check-device-knowledge.mjs's list -- the latch's own packed fields, e.g.
 * its per-INITIATION sequence counter, are THIS device's schema, not
 * registry vocabulary). `seqOfState` (registry global key 34) is the one
 * comparable number a client actually has, so "the current STATE seq" is
 * tracked as the highest seqOfState any accepted edge has carried -- an edge
 * older than that already-seen value is superseded by construction.
 * `safetyLastLatch` is compared OPAQUELY (never by field) purely to notice
 * THAT the snapshot changed, for the separate no-edge-received diagnostic.
 * Reset in forgetDevice(); untouched by an in-place reconnect, matching the
 * events ring it feeds.
 */
let safetyMaxSeq = -1;
let safetyLastLatch;
let safetyEdgeSeen = false;

/** The live session handle, for the write plane. Null until connect(). */
export function getSession() {
  return session;
}

/** Is the hub plane usable for writes right now? */
export function isLive() {
  return !!session && session.isLive;
}

// ---- freshness (RENDERING Â§13 law 8) --------------------------------------

/**
 * Link silence past this makes every value stale: the deadman window the hub
 * declared in WELCOME (SPEC Â§6.6), the silence after which the hub parks this
 * session too. The session PINGs at 0.6x it and every PONG stamps
 * `stats.lastRxMs`, so a healthy link always lands a frame inside it.
 * Per-channel age against the grant rate cannot decide this: a granted rate is
 * a ceiling and a periodic channel pushes at min(grant, change rate) (SPEC
 * Â§9.1), so a parked machine's position is silent AND true.
 */
export function staleAfterMs() {
  return machine.link.deadmanMs || LIMITS.deadman_default_ms;
}

/**
 * The one freshness rule every value surface uses. `stale` when the link is not
 * live, has been silent past staleAfterMs(), or this value predates the current
 * session (a reconnect re-pushes every retained value, Â§9.1, so an older stamp
 * is unconfirmed). Null when the channel never reported: absent, not stale.
 * `ageMs` is read only on the stale path so fresh readouts never re-render on
 * the tick.
 */
export function freshness(channelId) {
  const ts = machine.sampleTs[channelId];
  if (!ts) return null;
  if (!machine.link.stale && ts >= machine.link.openedAt) return { stale: false, ageMs: 0 };
  return { stale: true, ageMs: Math.max(0, (machine.link.staleTick || Date.now()) - ts) };
}

/** Hover text for a stale value: its age in words (law 5: never color alone). */
export function staleReason(fr) {
  if (!fr || !fr.stale) return undefined;
  const s = fr.ageMs / 1000;
  return 'stale: last update ' + (s < 60 ? s.toFixed(1) + ' s' : Math.round(s / 60) + ' min') + ' ago';
}

function checkFreshness() {
  const now = Date.now();
  const stale = machine.link.phase !== 'live' || now - machine.stats.lastRxMs > staleAfterMs();
  if (stale !== machine.link.stale) { machine.link.stale = stale; machine.link.staleTick = now; }
  else if (stale && now - machine.link.staleTick >= 1000) machine.link.staleTick = now;
}
if (typeof setInterval === 'function') setInterval(checkFreshness, 100);

/**
 * Every inbound frame, PING and PONG included, is proof of life (SPEC Â§6.5).
 * The session answers those internally and emits nothing, so the activity
 * clock is stamped at the socket. The platform WebSocket takes a listener; the
 * shell's BLE duck exposes only a plain `onmessage`, which gets wrapped.
 */
function stampingSocket(Impl) {
  const Base = Impl || globalThis.WebSocket;
  if (!Base) return undefined;
  return function StampingSocket(url, protocols) {
    const ws = new Base(url, protocols);
    const stamp = () => { machine.stats.lastRxMs = Date.now(); };
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', stamp);
    } else {
      let handler = null;
      Object.defineProperty(ws, 'onmessage', {
        configurable: true,
        get: () => handler && ((ev) => { stamp(); handler(ev); }),
        set: (fn) => { handler = fn; },
      });
    }
    return ws;
  };
}

/**
 * A spec-core channel's catalog entry, found by its registry id
 * (`CORE_CHANNEL.*`), never by name (RENDERING §13 law 6). Null when this hub
 * does not declare it.
 */
export function coreEntry(id) {
  return machine.catalog.entries.find((e) => e.id === id) || null;
}

/**
 * The safety-intents op select as an action, bound to spec-core identity so a
 * hub that never role-tagged it keeps its e-stop (RENDERING §13 law 2). The one
 * discovery path for TopStrip and TransportBar.
 */
export function specSafetyAction() {
  const e = coreEntry(CORE_CHANNEL.safety_intents);
  if (!e || !e.schema) return null;
  const f = e.schema.find((x) => x.options && x.options.length);
  if (!f) return null;
  return {
    uid: e.id + ':' + f.key, channelId: e.id, channelName: e.name,
    key: f.key, name: f.name, label: f.name, desc: f.desc || '',
    role: 'action.safety', options: f.options,
    optionAccess: f.optionAccess || null,
    access: f.access != null ? f.access : e.access,
  };
}

// ---------------------------------------------------------------------------
// Subscription policy
// ---------------------------------------------------------------------------

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
 * `telemetryChanIds` (from the telemetryChannelIds() helper below) gets
 * TELEMETRY_HZ instead of MAX_SUBSCRIBE_HZ — see that constant's header for why.
 */
function subscriptionWishes(entries, maxSubs, telemetryChanIds) {
  const wishes = [];
  for (const e of entries) {
    if (e.dir !== 0) continue;                       // h2c only; we do not publish
    if (e.cls !== CHANNEL_CLASS.STATE && e.cls !== CHANNEL_CLASS.EVENT) continue;
    // EVENTs are edge-driven; a rate on them is meaningless. On-change STATE
    // channels advertise 0 and mean it.
    let rate = (e.cls === CHANNEL_CLASS.EVENT || !e.maxRateHz)
      ? 0
      : Math.min(e.maxRateHz, MAX_SUBSCRIBE_HZ);
    if (telemetryChanIds && telemetryChanIds.has(e.id) && e.maxRateHz) {
      rate = Math.min(e.maxRateHz, TELEMETRY_HZ);
    }
    wishes.push([e.id, rate, e.priority != null ? e.priority : PRIORITY.background]);
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
  const cap = (typeof maxSubs === 'number' && maxSubs > 0) ? maxSubs : wishes.length;
  if (wishes.length <= cap) return wishes;
  const ranked = wishes.slice().sort((a, b) => b[2] - a[2]);
  const kept = ranked.slice(0, cap);
  machine.link.subsDropped = wishes.length - cap;
  return kept;
}


/**
 * Send SUBSCRIBE in batches that fit the hub's declared per-frame wish cap.
 *
 * ── Two field bugs, and the corrected diagnosis (RFC-033) ──────────────────
 *
 * FIELD BUG #1: the real machine advertises `max_frame: 512` bytes. This
 * client wanted 21 channels in one SUBSCRIBE; the hub dropped it WHOLESALE —
 * no NACK, no grants, no STATE. The session sat happily LIVE while every
 * readout on every tab rendered `--`, which reads exactly like a rendering
 * bug and is not one.
 *
 * FIELD BUG #2 (the one that actually mattered): the byte-size math above was
 * the wrong model entirely. A conservative fixed batch of 8 was shipped as
 * the fix, tuned down from an estimate that regressed the moment the catalog
 * grew from 33 to 44 entries. Both "mixed STATE+EVENT frame" drops that were
 * blamed on class-mixing at the time were actually this: the hub was silently
 * dropping any SUBSCRIBE over its UNDECLARED wish-count cap (16, on this
 * hub), which nobody could see without binary-searching a live machine.
 *
 * THE FIX, now that the cap is advertised (WELCOME `limits` key 4,
 * `max_subscriptions_per_frame`): batch by COUNT, sized from that value
 * directly. No byte estimate, no class split — mixing STATE and EVENT wishes
 * in one frame is, and always was, legal (RFC-033's ruling). Fall back to 8
 * only when the hub is old enough not to advertise key 4 at all; a hub that
 * DOES advertise it is trusted completely, because overflow now answers
 * `SUBSCRIBE_REJECTED` (0x0204) instead of silence — see the `nack` handler
 * below, which treats that code as a loud client-bug error rather than
 * routine congestion shedding.
 */
function subscribeInBatches(wishes) {
  const perFrame = machine.link.limits.max_subscriptions_per_frame;
  const budget = (typeof perFrame === 'number' && perFrame > 0) ? perFrame : 8;
  for (let i = 0; i < wishes.length; i += budget) {
    session.subscribe(wishes.slice(i, i + budget));
  }
}

/** Channel ids carrying any of TELEMETRY_ROLES on this machine, by role — never a hardcoded id. */
function telemetryChannelIds(model) {
  const ids = new Set();
  if (!model || !model.byRole) return ids;
  for (const role of TELEMETRY_ROLES) {
    const list = model.byRole.get(role);
    if (list) for (const f of list) ids.add(f.channelId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Ring helpers
// ---------------------------------------------------------------------------

function push(ring, item, max) {
  ring.push(item);
  if (ring.length > max) ring.splice(0, ring.length - max);
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

/**
 * Open the one session.
 *
 * The token is passed as a PROVIDER, not a value: credentials are re-resolved
 * on every reconnect, so a token that expired while we were away is replaced
 * instead of being retried forever. This is also the entire Tauri seam — a
 * desktop shell overrides host + setHttpGet() and changes nothing else.
 */
export function connect(opts = {}) {
  if (session) return session;
  const host = opts.host || (typeof location !== 'undefined' ? location.hostname : '');
  // A different hub is a different machine. Whatever the last one reported is
  // not evidence about this one, and rendering it while the new session is
  // still connecting is the UI stating a value the device never sent.
  if (host !== _host) forgetDevice();
  _host = host;
  _lastOpts = opts;
  machine.link.host = host;
  machine.link.port = opts.port || 82;
  machine.link.attempts = 0;
  machine.link.retryAt = 0;

  machine.link.phase = 'connecting';
  machine.link.since = Date.now();

  let s = null;
  s = createSession({
    host: _host,
    port: opts.port || 82,
    clientKind: 'webui',
    clientName: opts.clientName || 'Phosphor',
    instanceId: getInstanceId(),
    token: (h) => acquireToken(h),
    autoReconnect: true,
    // Shell seam: a non-WS binding (BLE GATT) rides in as a WebSocket duck.
    // undefined = the platform WebSocket, which is every non-shell build.
    WebSocketImpl: stampingSocket(opts.WebSocketImpl),
    // The close event carries no delay, so the library's own log line is the
    // only place the backoff it chose is visible. If that wording changes the
    // countdown disappears and the attempt count still shows.
    log: (level, msg, delayMs) => {
      if (msg === 'reconnect in' && s === session) machine.link.retryAt = Date.now() + delayMs;
    },
  });
  session = s;

  session.on('open', () => {
    machine.link.openedAt = Date.now();
    machine.link.phase = 'handshaking';
    machine.link.error = null;
    machine.link.retryAt = 0;
  });

  session.on('welcome', (w) => {
    machine.link.sessionId = w.sessionId;
    machine.link.roles = w.roles || 0;
    machine.link.deadmanMs = w.deadmanMs || 0;
    machine.link.cfgGen = w.cfgGen || 0;
    machine.link.hubIdentity = w.identity || null;
    // RFC-046: where the WS upgrade lives, for a session that arrived over
    // BLE. null on hubs that advertise none.
    machine.link.endpoint = w.endpoint || null;
    // The hub's own declared ceilings. max_subscriptions is the one that bites:
    // exceeding it drops the whole SUBSCRIBE silently. See subscriptionWishes().
    machine.link.limits = w.limits || {};
  });

  session.on('catalog', (entries, _map, meta) => {
    // Rebuild the entire renderable model. Anything the machine dropped or
    // added between connections is picked up here with no per-channel code —
    // which is the claim this whole refactor exists to make true.
    // The session emits { cached, verified, etag } and the etag is RAW BYTES —
    // rendering it directly would print a garbled array. Hex it once here so
    // every consumer gets something displayable.
    machine.catalog = {
      ready: true,
      entries,
      etag: (meta && meta.etag) ? toHex(meta.etag) : '',
      verified: !!(meta && meta.verified),
      bytes: session.catalogBytes ? session.catalogBytes.length : 0,
      cached: !!(meta && meta.cached),
      model: buildSettingsModel(entries),
    };
    // Subscribe only once we know what exists. Wishing for channels before the
    // catalog is how a client ends up hardcoding ids.
    // ONE combined wish list, STATE and EVENT together — RFC-033 settled that
    // mixing classes in a SUBSCRIBE is legal; the only real constraint is the
    // per-frame wish count, which subscribeInBatches() sizes from the hub's
    // own advertised cap. See that function's header for the corrected story.
    const lim = machine.link.limits.max_subscriptions;
    subscribeInBatches(subscriptionWishes(entries, lim, telemetryChannelIds(machine.catalog.model)));
  });

  session.on('grant', (grants) => {
    for (const g of grants || []) {
      machine.grants[g.channel] = { rate: g.rate, priority: g.priority };
    }
  });

  // A PAIR_GRANT upgrades this session's tier IN PLACE — the hub does not
  // require a reconnect, so neither may we. Without mirroring it here, every
  // widget outside the pairing pane keeps rendering the OLD tier and grays
  // configure-only controls that the machine would now accept: the UI would be
  // lying about what this session can do, in the direction that hides working
  // controls. PairingPane tracks session.state.roles directly and so was
  // already correct; this makes the rest of the page agree with it.
  session.on('pairGrant', (g) => {
    if (g && g.role != null) machine.link.roles = g.role | 0;
  });

  session.on('live', () => {
    machine.link.phase = 'live';
    machine.link.since = Date.now();
    machine.link.attempts = 0;
    // BLE addresses are not hosts a page can dial; only WS hubs are remembered.
    if (!opts.WebSocketImpl) rememberHub(hostLabel(host, opts.port));
  });

  session.on('state', (channelId, sample, tsMs) => {
    machine.samples[channelId] = sample;
    machine.sampleTs[channelId] = tsMs || Date.now();
    machine.stats.statePushes++;
    machine.stats.pushesByChannel[channelId] = (machine.stats.pushesByChannel[channelId] || 0) + 1;
    machine.stats.lastRxMs = Date.now();

    // ph-vdk.14: did the safety latch actually change, with nothing on its
    // EVENT twin (0x000E) to say so? Compared OPAQUELY -- this never reads a
    // field, only asks whether the snapshot differs from the last one.
    if (channelId === CORE_CHANNEL.safety) {
      const prev = safetyLastLatch;
      safetyLastLatch = sample;
      const changed = prev !== undefined && JSON.stringify(sample) !== JSON.stringify(prev);
      if (changed) {
        safetyEdgeSeen = false;
        // ponytail: a fixed grace window, not a real join with the edge that
        // may still be in flight on the same wire. Generous against ordinary
        // jitter; a hub that reliably reorders its own STATE/EVENT pair would
        // need a real correlation id instead of this timer.
        setTimeout(() => {
          if (session !== s) return;   // this session has since been torn down
          if (!safetyEdgeSeen) push(machine.events.safety, { diagnostic: true, at: Date.now() }, SAFETY_MAX);
        }, 250);
      }
    }
  });

  session.on('event', (evt) => {
    machine.stats.lastRxMs = Date.now();
    // Routed by spec-core IDENTITY (RENDERING §13 law 6), never by name. The
    // name rides along for display only. Every unrouted EVENT still lands in a
    // visible ring; none is dropped.
    const entry = machine.catalog.entries.find((e) => e.id === evt.channel);
    const name = entry ? entry.name : ('channel ' + evt.channel);
    const rec = { ...evt, channelName: name, at: Date.now() };
    if (evt.channel === CORE_CHANNEL.log) push(machine.events.log, rec, LOG_MAX);
    else if (evt.channel === CORE_CHANNEL.safety_events) {
      // ph-vdk.14: an edge older than the newest one already accepted is
      // superseded -- it describes a 0x0003 frame a later edge has already
      // moved past. A hub that omits seq_of_state gets no verdict either way
      // (Ground Truth: absence of the number is not evidence of staleness).
      if (rec.seqOfState != null) {
        rec.superseded = rec.seqOfState < safetyMaxSeq;
        if (!rec.superseded) safetyMaxSeq = rec.seqOfState;
      }
      safetyEdgeSeen = true;
      push(machine.events.safety, rec, SAFETY_MAX);
    }
    else if (evt.channel in CORE_CHANNEL_NAME) push(machine.events.session, rec, EVT_MAX);
    // TODO(rfc-x3n): no catalog key says which device EVENT channel is the
    // anomaly log, so every device-tier EVENT shares this ring.
    else push(machine.events.anomaly, rec, ANOM_MAX);
  });

  session.on('sessionEvent', (evt) => {
    push(machine.events.session, { ...evt, at: Date.now() }, EVT_MAX);
  });

  session.on('nack', (n) => {
    push(machine.events.nacks, { ...n, at: Date.now() }, NACK_MAX);
    // SUBSCRIBE_REJECTED (0x0204) means a client bug — this client sent a
    // SUBSCRIBE the hub could not process (RFC-033: usually more wishes than
    // max_subscriptions_per_frame). Every other NACK the link surfaces via
    // the events ring alone; this one is loud enough to earn a standing
    // link-level error, because it means the batching logic above regressed,
    // not that the operator did anything wrong.
    if (n.code === NACK.SUBSCRIBE_REJECTED) {
      machine.link.error = 'SUBSCRIBE_REJECTED' + (n.detail ? ': ' + n.detail : '') + ' — client bug, see machine.svelte.js';
    }
  });

  session.on('clock', (c) => {
    machine.stats.clockOffsetUs = c.offsetUs;
    machine.stats.clockRttUs = c.rttUs;
  });

  session.on('close', (c) => {
    // A session replaced by retryNow()/disconnect() closes asynchronously;
    // its late close must not overwrite the successor's phase.
    if (s !== session) return;
    if (c.willReconnect) machine.link.attempts++;
    machine.link.phase = c.willReconnect ? 'retrying' : 'failed';
    machine.link.willReconnect = !!c.willReconnect;
    machine.link.closeReason = c.reason || '';
    machine.link.sessionId = null;
    // Roles are a property of the session, not of the machine. Dropping them
    // here is what makes every write control gray the instant the link dies,
    // instead of looking usable until the user tries.
    machine.link.roles = 0;
    if (c.willReconnect) machine.stats.reconnects++;
  });

  session.connect();
  installVisibilityRecovery();
  return session;
}

// ---------------------------------------------------------------------------
// The alt-tab problem
// ---------------------------------------------------------------------------

/**
 * Browsers throttle background tabs to roughly one timer callback per minute.
 * The hub's deadman is 600 ms. So a backgrounded tab stops PINGing, gets torn
 * down as a dead session, and — because the RECONNECT backoff timer is
 * throttled too — does not come back until the tab is focused again. To the
 * operator this reads as "alt-tabbing kills the page", which is exactly what
 * was reported.
 *
 * There is no client-side fix for the throttling itself. What we can do is
 * treat regaining visibility as an explicit signal to re-establish now rather
 * than waiting for a timer that may be minutes away.
 *
 * ...and CLOSE ON THE WAY OUT, which is the other half. Left to itself a hidden
 * tab keeps the socket open with frozen timers, so the hub sees 20 s of RX
 * silence, idle-reaps the slot, and the (throttled) backoff timer reconnects to
 * be reaped again — measured live on fw 2.1.88 as 19 sessions in 100 s. Each
 * cycle briefly overlaps two sessions' buffers because the hub defers detach to
 * its own task, and the resulting internal-heap fragmentation dropped the
 * largest free block under the page-serve floor, so the machine served 503 to
 * every new tab until the churn stopped. One backgrounded phone did that.
 *
 * A clean close hands the slot back immediately instead of costing a reap, and
 * reconnect is cheap: the catalog is etag-cached, so coming back is a warm
 * session with zero transfer frames. Releasing control while hidden is also the
 * honest posture — the hub's 600 ms deadman has already stopped motion by then.
 */
let _visibilityInstalled = false;
function installVisibilityRecovery() {
  if (_visibilityInstalled || typeof document === 'undefined') return;
  _visibilityInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (!session) return;
    if (document.visibilityState !== 'visible') {
      // Deliberate teardown, not a drop: the hub gets a GOODBYE and frees the
      // slot now. Do not "optimize" this into a delay — a throttled timer is
      // exactly what cannot be relied on here.
      try { session.close(); } catch (e) { /* already closing: harmless */ }
      machine.link.phase = 'idle';
      return;
    }
    if (!session.isLive) {
      machine.link.phase = 'connecting';
      try { session.connect(); } catch (e) { /* already connecting: harmless */ }
    }
  });
}

/**
 * Drop everything the hub told us, back to the pre-connection shape.
 *
 * GROUND TRUTH: with no session there is no device truth, so the page must
 * read "unknown", never the previous machine's catalog, samples, grants or
 * counters still rendering as current.
 */
function forgetDevice() {
  machine.catalog = blankCatalog();
  machine.samples = {};
  machine.sampleTs = {};
  machine.grants = {};
  machine.events = blankEvents();
  machine.stats = blankStats();
  machine.link.hubIdentity = null;
  machine.link.limits = {};
  machine.link.subsDropped = 0;
  safetyMaxSeq = -1;
  safetyLastLatch = undefined;
  safetyEdgeSeen = false;
}

/** Tear down (used by tests and by the Tauri shell on host change). */
export function disconnect() {
  if (!session) return;
  try { session.close(); } catch (e) { /* ignore */ }
  session = null;
  machine.link.phase = 'idle';
  forgetDevice();
}

/**
 * Skip the backoff wait: a fresh session to the same hub, keeping whatever
 * the page shows (it stays dimmed stale until the hub re-pushes, law 8).
 */
export function retryNow() {
  if (!session || session.isLive) return;
  const s = session;
  session = null;
  try { s.close(); } catch (e) { /* already closed */ }
  connect(_lastOpts);
}

/**
 * Point this page at another hub (the hosted-page picker). `port` defaults
 * to the Valence WS port. The page URL gains ?hub= so a reload keeps it.
 */
export function switchHub(host, port) {
  disconnect();
  try {
    const u = new URL(location.href);
    u.searchParams.set('hub', hostLabel(host, port));
    history.replaceState(null, '', u);
  } catch (e) { /* file:// or a sandboxed frame: the picker still works */ }
  connect({ host, port });
}

// ---- remembered hubs (browser convenience, never machine state) -----------

const RECENT_KEY = 'hub_recent';
const RECENT_MAX = 5;

/** `host` or `host:port` when the port is not the default. */
export function hostLabel(host, port) {
  return port && port !== 82 ? host + ':' + port : host;
}

/** Split `host[:port]`; a bare IPv6 literal keeps its colons. */
export function parseHost(text) {
  const t = String(text || '').trim();
  const m = /^([^:]+):(\d{1,5})$/.exec(t);
  return m ? { host: m[1], port: +m[2] } : { host: t, port: undefined };
}

/** Hubs this browser reached before, most recent first. */
export function recentHubs() {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((h) => typeof h === 'string' && h) : [];
  } catch (e) { return []; }
}

function rememberHub(label) {
  if (!label) return;
  try {
    const a = [label, ...recentHubs().filter((h) => h !== label)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(a));
  } catch (e) { /* private mode: the list is a convenience */ }
}
