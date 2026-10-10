/**
 * client.mjs -- one seeded headless Valence client (valence-js) with a random personality, for the Neutrino
 * cluster (cluster.mjs) and for a replay against one hub, Neutrino or a real one over WebSocket (ph-ode2).
 *
 * Constraints:
 * - The action list is built FROM THE CATALOG: every control-tier INTENT entry, every c2h motion STREAM, by
 *   role where a role exists (action.safety, action.home, action.trial, action.store, command.position,
 *   window.*, limit.*, osc.*), the rest by schema bounds. A feature the hub adds is covered without an edit.
 * - Determinism: every action draws exactly DRAWS numbers from the seed's stream whatever the hub answered;
 *   an action's own detail comes from a sub-stream seeded by one of them, and every choice that reads the hub's
 *   state reads it at an action, never against a timer (patience is counted in actions). Two lockstep runs of
 *   a seed (cluster.mjs, virtualClock) are identical but for the session ids the hub mints; a real-time run takes
 *   the same branches while the hub answers alike.
 * - Positions and window edges are fractions of the max_rail the hub reports, so a run against a hub with
 *   another rail is comparable in normalized terms (compare.mjs).
 * - hwSafe (implied for a real hub): no force_home, no preset save/delete/rename, every settings write a
 *   trial write (RFC-099: never persisted, reverted when the session ends), and limits and max_rail never
 *   written above the value the session found.
 * - Home is attempted in every state, the oscillator enabled included (operator 2026-10-09: the hub refuses
 *   it while the oscillator is enabled, val-dzf). An accepted home while the reported oscillator is enabled is
 *   recorded as an expected failure (`xfail`), never a fault, until that refusal lands.
 */
import { createSession, CH, PRIORITY, CHANNEL_CLASS, STREAM_KIND, FRAME, decodeFrameHeader } from '../../../Valence/clients/js/index.js';
import { createMotionDoor, latchWords } from '../../src/model/motion.js';
import { createScheduler } from '../../plugins/factory/funscript-player/scheduler.js';
import { parseFunscript } from '../../plugins/factory/funscript-player/funscript.js';

export function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sub = (r) => mulberry32(Math.floor(r * 4294967296));
const DRAWS = 6;

/** What a hub seed boots and who talks to it: Neutrino options and one or two client seeds. */
export function hubPlan(seed, hwSafe = false) {
  const r = mulberry32(seed ^ 0x5eed);
  const opts = { homed: true, home_sense_at_mm: -120, rail_end_at_mm: 380 };
  const ms = r() < 0.3, pd = r() < 0.1, delay = 20 + Math.floor(r() * 180), two = r() < 0.35;
  if (hwSafe) opts.motor_switch = true;
  else {
    if (ms) opts.motor_switch = true;
    if (pd) opts.plan_delay_ms = delay;
  }
  return { opts, clients: two && !hwSafe ? [seed * 2 + 1, seed * 2 + 2] : [seed * 2 + 1] };
}

/** Seeded per-client traits: action pace, kind weights, link impairment. */
export function traits(seed) {
  const r = mulberry32(seed);
  const pace = [[300, 1500], [1000, 4000], [2000, 8000]][Math.floor(r() * 3)];
  const w = (base) => base * (0.2 + r() * 1.6);
  const weights = {
    stream: w(6), samples: w(1.5), jog: w(2), safety: w(1.5), home: w(0.8), trial: w(0.6), store: w(0.4),
    drag: w(1.2), limits: w(1), osc: w(1.5), intent: w(2), reconnect: w(0.3), refetch: w(0.15),
  };
  const lossy = r() < 0.3, slow = r() < 0.5;
  const imp = {
    latMs: slow ? 1 + r() * 40 : 0, jitMs: slow ? r() * 15 : 0,
    loss: lossy ? 0.005 + r() * 0.04 : 0, reorder: r() < 0.2 ? 0.01 + r() * 0.04 : 0,
  };
  return { pace, weights, imp, trialBias: r(), recoverAfter: 1 + Math.floor(r() * 4) };
}

/**
 * A WebSocket class with link impairment on both legs: latency plus jitter in order (TCP-like) on every
 * frame; loss and reorder on c2h STREAM frames only (a bundle that never arrives or arrives late, the cases
 * the hub's ingress must ride). pump(nowMs) delivers what is due; `all` is the live set for the host loop.
 */
export function impairedSocket(Base, imp, rng, url) {
  const live = new Set();
  const plain = !imp.latMs && !imp.jitMs && !imp.loss && !imp.reorder;
  class Impaired {
    constructor(u, protocols) {
      this.inner = new Base(url || u, protocols);
      this.inner.binaryType = 'arraybuffer';
      this.binaryType = 'arraybuffer';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.out = []; this.inq = []; this.lastOut = 0; this.lastIn = 0;
      this.inner.onopen = (e) => this.onopen && this.onopen(e);
      this.inner.onerror = (e) => this.onerror && this.onerror(e);
      this.inner.onclose = (e) => { live.delete(this); if (this.onclose) this.onclose(e); };
      this.inner.onmessage = (e) => {
        if (plain) { if (this.onmessage) this.onmessage(e); return; }
        const at = Math.max(this.lastIn, performance.now() + imp.latMs + rng() * imp.jitMs);
        this.lastIn = at;
        this.inq.push([at, e]);
      };
      live.add(this);
    }
    get readyState() { return this.inner.readyState; }
    get protocol() { return this.inner.protocol; }
    get bufferedAmount() { return this.inner.bufferedAmount || 0; }
    send(data) {
      if (plain) { this.inner.send(data); return; }
      const b = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
      const h = decodeFrameHeader(b);
      const stream = h && h.type === FRAME.STREAM;
      if (stream && rng() < imp.loss) { Impaired.lost++; return; }
      let at = Math.max(this.lastOut, performance.now() + imp.latMs + rng() * imp.jitMs);
      if (stream && rng() < imp.reorder) { at += 30 + rng() * 60; Impaired.reordered++; } else this.lastOut = at;
      this.out.push([at, b]);
      if (stream) this.out.sort((x, y) => x[0] - y[0]);
    }
    close(code, reason) {
      live.delete(this);
      // A close flushes what was sent first (the GOODBYE among it), as TCP does.
      for (const [, b] of this.out) if (this.inner.readyState === 1) this.inner.send(b);
      this.out.length = 0; this.inq.length = 0;
      this.inner.close(code, reason);
    }
    pump(now) {
      while (this.out.length && this.out[0][0] <= now) { const [, b] = this.out.shift(); if (this.inner.readyState === 1) this.inner.send(b); }
      while (this.inq.length && this.inq[0][0] <= now) { const [, e] = this.inq.shift(); if (this.onmessage) this.onmessage(e); }
    }
  }
  Impaired.lost = 0; Impaired.reordered = 0; Impaired.all = live;
  return Impaired;
}

/** A synthetic funscript: strokes of varied speed, rapid sections, holds at reversals, a few long gaps. */
function synthScript(rng) {
  const actions = [];
  const len = 20000 + rng() * 100000;
  let at = 0, pos = 50, up = true;
  while (at < len) {
    const sec = rng();
    const n = 4 + Math.floor(rng() * 20);
    const dur = sec < 0.15 ? [60, 120] : sec < 0.6 ? [150, 450] : [400, 1500];
    for (let i = 0; i < n && at < len; i++) {
      const amp = 10 + rng() * 90;
      pos = Math.max(0, Math.min(100, up ? pos + amp : pos - amp));
      up = !up;
      at += dur[0] + rng() * (dur[1] - dur[0]);
      actions.push({ at: Math.round(at), pos: Math.round(pos) });
      if (rng() < 0.12) { at += 200 + rng() * 1500; actions.push({ at: Math.round(at), pos: Math.round(pos) }); }
    }
    if (rng() < 0.08) at += 600 + rng() * 3000;
  }
  return parseFunscript({ version: '1.0', actions });
}

const NAME_OK = (l) => l && l !== 'reserved' && l !== 'retired';
const CORE = [
  [CH.SAFETY, 0, PRIORITY.critical], [CH.CONTROL_OWNER, 0, PRIORITY.critical], [CH.MACHINE_CONFIG, 0, PRIORITY.elevated],
  [CH.MOTION, 20, PRIORITY.elevated], [CH.MOTION_DIAG, 1, PRIORITY.background], [CH.MOTION_ANOMALY, 0, PRIORITY.normal],
  [CH.LOG, 0, PRIORITY.normal], [CH.HUB_STATUS, 1, PRIORITY.background], [CH.SESSION_EVENTS, 0, PRIORITY.background],
];

/**
 * @param {Object} o {seed, WebSocketImpl, token, host, port, record, hwSafe, planHz, motionHz, hub: shared per-hub
 *   record {diag, flags[]} for counters and faults}
 */
export function createClient(o) {
  const T = traits(o.seed);
  const rng = mulberry32(o.seed ^ 0xa11ce);
  const linkRng = mulberry32(o.seed ^ 0x11e);
  // hwSafe runs clean: a real link cannot be impaired the same way, so a comparable Neutrino run is not either.
  const W = impairedSocket(o.WebSocketImpl, o.hwSafe ? { latMs: 0, jitMs: 0, loss: 0, reorder: 0 } : T.imp, linkRng, o.url);
  const hub = o.hub || { flags: [] };
  const cache = new Map();
  const store = { load: (h) => cache.get(h) || null, save: (h, etag, bytes) => cache.set(h, { etag, bytes }), clear: (h) => cache.delete(h) };
  const stats = { actions: {}, results: {}, nacks: {}, refusals: {}, anoms: {}, segs: 0, bundles: 0, samples: 0, timeouts: 0,
    reconnects: 0, reaps: {}, stuck: 0, stalls: 0, watch: 0, xfail: [], homeOsc: { tried: 0, refused: 0, accepted: 0 } };
  const trace = [];
  const t0 = performance.now();
  const rec = o.record ? (k, d) => trace.push([Math.round(performance.now() - t0), k, d]) : () => {};
  const bump = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; };

  let outSince = 0, heldActs = 0;
  let s = null, live = false, connectAt = 0, lastStateAt = 0, closing = false, reopenAt = 0, nextAt = 0, cold = false;
  let entries = [], byId = new Map(), acts = [], builtFor = '';
  const twin = new Map(); // STATE channel -> latest sample
  const lastNack = new Map();
  let door = null, play = null, samples = null, drag = null;
  const startVals = new Map(); // `${intentCh}:${key}` -> value the session first found (hwSafe caps)

  // ---- the session ------------------------------------------------------------------------------------------
  function open() {
    if (cold) { cache.clear(); cold = false; }
    live = false; connectAt = performance.now(); lastStateAt = connectAt;
    const ses = createSession({ host: o.host || 'neutrino', port: o.port || 1, clientKind: 'webui', clientName: 'cluster ' + o.seed,
      autoReconnect: false, WebSocketImpl: W, token: o.token, catalogStore: store, subscriptions: CORE.map((w) =>
        w[0] === CH.MOTION ? [w[0], o.motionHz || 20, w[2]] : w) });
    s = ses;
    door = createMotionDoor({ session: () => (live && s === ses ? ses : null), entries: () => ses.catalog || [],
      setpoint: () => ({ ok: false, reason: 'no STREAM' }), log: () => {}, halted: () => latchWords(ses.state.safety),
      lastNack: (ch) => lastNack.get(ch) || null });
    ses.on('live', () => {
      if (s !== ses) return;
      live = true;
      if (ses.state.roles < 1) { stats.watch++; rec('watch', ses.state.roles); }
      build(ses);
      rec('live', { roles: ses.state.roles, ms: Math.round(performance.now() - connectAt) });
      if (o.preset) { const p = o.preset; o.preset = null; applyPreset(ses, p); }
    });
    ses.on('state', (ch, v) => onState(ch, v));
    ses.on('nack', (n) => {
      bump(stats.nacks, n.name);
      lastNack.set(n.channel, { name: n.name, at: performance.now() });
      rec('nack', [n.channel, n.name]);
    });
    ses.on('event', (e) => {
      if (e.channel === CH.MOTION_ANOMALY) {
        const k = (byId.get(e.channel)?.eventKinds || [])[e.kind] || String(e.kind);
        bump(stats.anoms, k);
        rec('anom', [k, e.body && e.body.target]);
      } else if (e.channel === CH.LOG && e.body && e.body.level >= 3) rec('log', [e.body.level, String(e.body.message).replace(/[\d.]+/g, '#')]);
    });
    ses.on('close', (c) => {
      if (s !== ses) return;
      lastDiag = null;
      stopActivities();
      live = false;
      if (!closing) { bump(stats.reaps, String(c && c.code)); rec('closed', c && c.code); }
      closing = false;
      reopenAt = performance.now() + 500;
    });
    ses.connect();
  }

  function onState(ch, v) {
    lastStateAt = performance.now();
    twin.set(ch, v);
    if (ch === CH.MOTION) {
      if (o.record) rec('pos', [round(v.pos_10um, 2), v.flags]);
      const rail = railMm();
      // Outside the rail for 5 s with nothing latched: the hub left the carriage where no motion can reach.
      const sf = s.state.safety || {};
      const out = rail > 0 && (v.pos_10um < -1 || v.pos_10um > rail + 12) && !sf.estopLatched && !sf.paused && !sf.override && !(v.flags_bits || {}).homing;
      if (!out) outSince = 0;
      else if (!outSince) outSince = performance.now();
      else if (performance.now() - outSince > 5000) flag('stuck-outside-rail', v.pos_10um + ' mm, max_rail ' + round(rail, 1));
    } else if (ch === CH.PLAN_STRIP && o.record) {
      rec('plan', [v.style, round(v.start_norm, 4), round(v.end_norm, 4), round(v.cur_norm, 4), v.duration_us, v.elapsed_us]);
    } else if (ch === CH.MACHINE_CONFIG) {
      // SPEC 9.6: a write of geometry.max_travel holds the travel window inside it.
      const wmax = stateOfRole('window.max'), rail = railMm();
      if (rail > 0 && wmax > rail + 0.5) flag('window-past-rail', 'window_max ' + round(wmax, 1) + ' > max_rail ' + round(rail, 1));
      if (o.record) rec('cfg', [ch, v]);
    } else if (ch === CH.MOTION_DIAG) {
      diagCheck(v);
      rec('diag', v);
    } else if (ch === CH.SAFETY) {
      rec('safety', s.state.safety);
    } else if (o.record && byId.get(ch)?.settingChannel != null) rec('cfg', [ch, v]);
  }

  // Against this session's own last sample: two clients of one hub see its samples through their own link
  // delays, so across clients an older sample can land after a newer one.
  let lastDiag = null;
  function diagCheck(v) {
    const p = lastDiag;
    if (p && p.reset_gen === v.reset_gen) {
      for (const k of ['plans', 'failures', 'anomalies', 'sync_bundles', 'sync_samples', 'sync_seg_bundles', 'sync_dropped'])
        if (v[k] < p[k]) flag('non-monotonic ' + k, p[k] + ' -> ' + v[k]);
    }
    lastDiag = v;
    if (!hub.diag || hub.diag.reset_gen !== v.reset_gen || v.sync_bundles >= hub.diag.sync_bundles) hub.diag = v;
  }

  function flag(kind, detail) {
    if (hub.flags.some((f) => f.kind === kind)) return;
    hub.flags.push({ kind, detail, seed: o.seed, t: Math.round(performance.now() - t0) });
    rec('flag', [kind, detail]);
  }

  const round = (x, d) => (Number.isFinite(x) ? +x.toFixed(d) : x);
  function stateOfRole(role) {
    for (const e of entries) {
      if (e.cls !== CHANNEL_CLASS.STATE) continue;
      const f = (e.layout || []).find((x) => x.role === role);
      if (f) { const v = twin.get(e.id); return v ? v[f.name] : undefined; }
    }
    return undefined;
  }
  const railMm = () => stateOfRole('geometry.max_travel') || 0;
  /** The reported osc.enabled: the STATE twin's field for the osc.enabled intent key. */
  const oscEnabled = () => {
    const e = entries.find((x) => x.cls === CHANNEL_CLASS.INTENT && (x.schema || []).some((f) => f.role === 'osc.enabled'));
    return !!(e && current(e.id, e.schema.find((f) => f.role === 'osc.enabled').key));
  };

  /**
   * --like: the settings another run found at its first LIVE (its 'cfg' records), written once as durable
   * intents before the first action, so a Neutrino reference starts from a real hub's rail, window and limits.
   */
  function applyPreset(ses, preset) {
    for (const [ch, v] of preset) {
      const st = byId.get(ch);
      const intent = st && byId.get(st.settingChannel);
      if (!intent) continue;
      const vals = {};
      for (const f of st.layout || []) {
        // Settings only: nothing that starts motion (a generator's running, the oscillator, background_run).
        const x = (intent.schema || []).find((k) => k.key === f.settingKey);
        if (f.settingKey == null || !(f.name in v) || !x || /running|^osc\.|background_run/.test((f.role || '') + ' ' + (x.role || '')) || /running/.test(x.name)) continue;
        vals[f.settingKey] = v[f.name];
      }
      // Eight keys a frame, as actGeneric: a long one is refused MALFORMED.
      const keys = Object.keys(vals);
      for (let i = 0; i < keys.length; i += 8) {
        const part = Object.fromEntries(keys.slice(i, i + 8).map((k) => [k, vals[k]]));
        ses.sendIntent(intent.id, part).then(() => rec('preset', [intent.id, 'ok']), (e) => rec('preset', [intent.id, e.name || e.message]));
      }
    }
  }

  // ---- the action list, from the catalog -----------------------------------------------------------------
  function build(ses) {
    entries = ses.catalog || [];
    byId = new Map(entries.map((e) => [e.id, e]));
    const key = entries.length + ':' + (ses.catalogBytes ? ses.catalogBytes.length : 0);
    // Every STATE and EVENT the catalog declares beyond the HELLO set: settings twins on change, the plan strip.
    const wishes = entries.filter((e) => e.dirName === 'h2c' && (e.cls === CHANNEL_CLASS.STATE || e.cls === CHANNEL_CLASS.EVENT)
      && !CORE.some((w) => w[0] === e.id) && e.access <= (ses.state.roles | 0))
      .map((e) => [e.id, e.id === CH.PLAN_STRIP ? (o.planHz || 10) : Math.min(e.maxRateHz || 0, 2), PRIORITY.normal]);
    for (let i = 0; i < wishes.length; i += 16) ses.subscribe(wishes.slice(i, i + 16));
    if (key === builtFor) return;
    builtFor = key;
    const roles = ses.state.roles | 0;
    const intents = entries.filter((e) => e.cls === CHANNEL_CLASS.INTENT && e.dirName === 'c2h' && e.access <= Math.max(1, roles) && e.access < 2);
    const hasRole = (e, r) => (e.schema || []).some((f) => f.role === r);
    const settingsCh = new Set(entries.filter((e) => e.cls === CHANNEL_CLASS.STATE && e.settingChannel != null).map((e) => e.settingChannel));
    acts = [];
    const add = (kind, w, fn, ch) => acts.push({ kind, w, fn, ch });
    const seg = entries.find((e) => e.cls === CHANNEL_CLASS.STREAM && e.dirName === 'c2h' && e.streamKind === STREAM_KIND.segments);
    const smp = entries.find((e) => e.cls === CHANNEL_CLASS.STREAM && e.dirName === 'c2h' && e.streamKind === STREAM_KIND.samples);
    if (seg) add('stream', T.weights.stream, actStream);
    if (smp) add('samples', T.weights.samples, actSamples);
    for (const e of intents) {
      if (hasRole(e, 'action.safety')) add('safety', T.weights.safety, (r) => actSafety(e, r), e.id);
      else if (hasRole(e, 'action.home')) add('home', T.weights.home, (r) => actHome(e, r), e.id);
      else if (hasRole(e, 'action.trial')) add('trial', T.weights.trial, (r) => actTrial(e, r), e.id);
      else if (hasRole(e, 'action.store')) add('store', T.weights.store, (r) => actStore(e, r), e.id);
      else if (hasRole(e, 'command.position')) add('jog', T.weights.jog, (r) => actJog(e, r), e.id);
      else if (hasRole(e, 'osc.enabled')) add('osc', T.weights.osc, (r) => actOsc(e, r), e.id);
      else add('intent:' + e.name, T.weights.intent / Math.max(1, intents.length / 4), (r) => actGeneric(e, r, settingsCh.has(e.id)), e.id);
      if (settingsCh.has(e.id) && twinOf(e.id) && fieldsByRole(e.id, /^window\./).length === 2) add('drag', T.weights.drag, (r) => actDrag(e, r), e.id);
      if (settingsCh.has(e.id) && fieldsByRole(e.id, /^limit\./).length) add('limits', T.weights.limits, (r) => actLimits(e, r), e.id);
    }
    const safe = intents.find((e) => hasRole(e, 'action.safety')), homeE = intents.find((e) => hasRole(e, 'action.home'));
    if (safe) acts.push({ kind: 'recover', w: 0, fn: () => recover(safe, homeE) });
    add('reconnect', T.weights.reconnect, () => reconnect(false));
    add('refetch', T.weights.refetch, () => reconnect(true));
    rec('acts', acts.map((a) => a.kind));
  }
  const twinOf = (intentCh) => entries.find((e) => e.cls === CHANNEL_CLASS.STATE && e.settingChannel === intentCh);
  /** The intent keys of a settings channel whose STATE twin field carries a role matching re, with that field. */
  function fieldsByRole(intentCh, re) {
    const t = twinOf(intentCh);
    return t ? (t.layout || []).filter((f) => f.settingKey != null && f.role && re.test(f.role)) : [];
  }
  function current(intentCh, key) {
    const t = twinOf(intentCh);
    const f = t && (t.layout || []).find((x) => x.settingKey === key);
    const v = f && twin.get(t.id);
    return v ? v[f.name] : undefined;
  }

  // ---- sending, with results -------------------------------------------------------------------------------
  function send(kind, ch, vals, opt = {}, detail) {
    bump(stats.actions, kind);
    const trial = opt.trial || false;
    rec('act', [kind, ch, vals, trial || undefined]);
    if (!live) { bump(stats.results, kind + ':not-live'); return Promise.resolve('not-live'); }
    return s.sendIntent(ch, vals, opt).then(
      (r) => { bump(stats.results, kind + ':ok'); rec('res', [kind, 'ok', r.applied]); return 'ok'; },
      (e) => {
        const why = /timeout/.test(e.message) ? 'timeout' : e.code != null ? e.name : 'error';
        if (why === 'timeout') { stats.timeouts++; if (s && s.state.phase === 'LIVE') flag('intent-timeout', kind); }
        bump(stats.results, kind + ':' + why);
        if (why !== 'timeout' && e.code != null) bump(stats.refusals, kind + ':' + why);
        rec('res', [kind, why, e.detail || (why === 'error' ? e.message : undefined)]);
        return why;
      });
  }
  function value(f, r, intentCh) {
    if (f.options) {
      const ok = f.options.map((l, i) => [l, i]).filter(([l, i]) => NAME_OK(l) && (!f.optionAccess || f.optionAccess[i] <= Math.max(1, s.state.roles | 0)));
      return ok.length ? ok[Math.floor(r() * ok.length)][1] : undefined;
    }
    if (f.typeName === 'bool_t') return r() < 0.5;
    if (f.typeName === 'tstr_t') return 'cluster' + Math.floor(r() * 1000);
    if (!Number.isFinite(f.min) || !Number.isFinite(f.max)) return undefined;
    let lo = f.min, hi = f.max;
    if (f.unit === 'mm' && railMm() > 0) hi = Math.min(hi, railMm() * 1.05);
    if (o.hwSafe && intentCh != null) {
      const cur = current(intentCh, f.key);
      if (Number.isFinite(cur)) {
        const k = intentCh + ':' + f.key;
        if (!startVals.has(k)) startVals.set(k, cur);
        hi = Math.min(hi, Math.max(lo, startVals.get(k)));
      }
    }
    const x = lo + r() * (hi - lo);
    return f.typeName === 'uint_t' || f.typeName === 'int_t' ? Math.round(x) : +x.toFixed(3);
  }
  const trialFor = (r, settings) => settings && (o.hwSafe || r() < T.trialBias * 0.6);

  function actGeneric(e, r, settings) {
    // At most 8 keys: the hub library's per-INTENT cap (Valence rfc-zvh9); more is refused MALFORMED.
    const fs = (e.schema || []).filter(() => r() < 0.5).slice(0, 8);
    const pick = fs.length ? fs : (e.schema || []).slice(0, 1);
    const vals = {};
    for (const f of pick) { const v = value(f, r, settings ? e.id : null); if (v !== undefined) vals[f.key] = v; }
    if (!Object.keys(vals).length) return;
    return send('intent:' + e.name, e.id, vals, { trial: trialFor(r, settings) });
  }
  function actSafety(e, r) {
    const f = e.schema.find((x) => x.role === 'action.safety');
    const op = (n) => f.options.indexOf(n);
    const sf = (s && s.state.safety) || {};
    const x = r();
    let name;
    if (sf.estopLatched) name = x < 0.8 ? 'release' : x < 0.9 ? 'resume' : 'estop';
    else if (sf.override) name = x < 0.5 ? 'return' : x < 0.7 ? 'resume' : x < 0.85 ? 'estop' : 'pause';
    else if (sf.paused) name = x < 0.6 ? 'resume' : x < 0.8 ? 'override' : x < 0.9 ? 'estop' : 'pause';
    else name = x < 0.5 ? 'pause' : x < 0.65 ? 'override' : x < 0.85 ? 'estop' : 'resume';
    if (op(name) < 0) return;
    return send('safety:' + name, e.id, { [f.key]: op(name) });
  }
  function recover(safe, homeE) {
    const f = safe.schema.find((x) => x.role === 'action.safety');
    const sf = (s && s.state.safety) || {};
    heldActs = 0;
    if (sf.estopLatched) return send('recover:release', safe.id, { [f.key]: f.options.indexOf('release') });
    if (sf.override) return send('recover:return', safe.id, { [f.key]: f.options.indexOf('return') });
    if (sf.homeRequired && homeE) {
      const h = homeE.schema.find((x) => x.role === 'action.home');
      return home('recover:home', homeE.id, { [h.key]: h.options.indexOf('home') });
    }
    if (sf.paused) return send('recover:resume', safe.id, { [f.key]: f.options.indexOf('resume') });
  }
  function actHome(e, r) {
    const f = e.schema.find((x) => x.role === 'action.home');
    const force = f.options.indexOf('force_home');
    const vals = {};
    if (force > 0 && !o.hwSafe && r() < 0.25) {
      vals[f.key] = force;
      const st = e.schema.find((x) => x.key !== f.key && x.unit === 'mm');
      if (st && railMm() > 0) vals[st.key] = railMm();
      return send('home:force', e.id, vals);
    }
    vals[f.key] = f.options.indexOf('home');
    return home('home', e.id, vals);
  }
  /** A home cycle; while the reported oscillator is enabled the hub owes a refusal (val-dzf), so an ECHO is an xfail. */
  function home(kind, ch, vals) {
    if (!oscEnabled()) return send(kind, ch, vals);
    stats.homeOsc.tried++;
    rec('osc-on', kind);
    return send(kind, ch, vals).then((why) => {
      if (why === 'ok') {
        stats.homeOsc.accepted++;
        stats.xfail.push({ case: 'home accepted while the oscillator is enabled (val-dzf)', seed: o.seed, t: Math.round(performance.now() - t0) });
      } else if (why !== 'not-live') stats.homeOsc.refused++;
      return why;
    });
  }
  function actTrial(e, r) {
    const f = e.schema.find((x) => x.role === 'action.trial');
    const name = r() < 0.5 && !o.hwSafe ? 'commit' : 'revert';
    return send('trial:' + name, e.id, { [f.key]: f.options.indexOf(name) });
  }
  function actStore(e, r) {
    const f = e.schema.find((x) => x.role === 'action.store');
    const ops = f.options.filter((l) => NAME_OK(l) && (!o.hwSafe || l === 'load'));
    const name = ops[Math.floor(r() * ops.length)];
    const vals = { [f.key]: f.options.indexOf(name) };
    for (const x of e.schema) if (x.key !== f.key) { const v = value(x, r); if (v !== undefined) vals[x.key] = v; }
    return send('store:' + name, e.id, vals);
  }
  function actJog(e, r) {
    const f = e.schema.find((x) => x.role === 'command.position');
    const sf = (s && s.state.safety) || {};
    const lo = stateOfRole('window.min'), hi = stateOfRole('window.max'), rail = railMm();
    const outside = sf.override && rail > 0;
    const a = outside ? 0 : Number.isFinite(lo) ? lo : 0, b = outside ? rail : Number.isFinite(hi) ? hi : rail || f.max;
    return send(outside ? 'jog:override' : 'jog', e.id, { [f.key]: +(a + r() * (b - a)).toFixed(2) });
  }
  function actOsc(e, r) {
    const vals = {};
    const en = e.schema.find((x) => x.role === 'osc.enabled');
    for (const f of e.schema) {
      if (f === en) vals[f.key] = r() < 0.65;
      // At most 8 keys, as actGeneric.
      else if (r() < 0.7 && Object.keys(vals).length < 8) { const v = value(f, r); if (v !== undefined) vals[f.key] = f.role === 'osc.frequency' ? Math.min(v, 0.5 + r() * 12) : v; }
    }
    return send(vals[en.key] ? 'osc:on' : 'osc:off', e.id, vals);
  }
  function actLimits(e, r) {
    const fs = fieldsByRole(e.id, /^limit\./);
    const f = fs[Math.floor(r() * fs.length)];
    const sf = (e.schema || []).find((x) => x.key === f.settingKey);
    const v = sf && value(sf, r, e.id);
    if (v === undefined) return;
    return send('limits', e.id, { [f.settingKey]: v }, { trial: trialFor(r, true) });
  }
  function actDrag(e, r) {
    if (drag) return;
    const ws = fieldsByRole(e.id, /^window\./);
    const fa = ws.find((x) => x.role === 'window.min'), fb = ws.find((x) => x.role === 'window.max');
    if (!fa || !fb) return;
    const rail = railMm();
    if (!(rail > 0)) return;
    const a0 = (current(e.id, fa.settingKey) ?? 0) / rail, b0 = (current(e.id, fb.settingKey) ?? rail) / rail;
    const a1 = r() * 0.45, b1 = 0.55 + r() * 0.45, n = 4 + Math.floor(r() * 10), trial = trialFor(r, true);
    bump(stats.actions, 'drag');
    rec('act', ['drag', e.id, [a1, b1, n]]);
    drag = { i: 0, n, at: performance.now(), fn: (i) => {
      const k = (i + 1) / n;
      return send('drag:step', e.id, { [fa.settingKey]: +((a0 + (a1 - a0) * k) * rail).toFixed(2), [fb.settingKey]: +((b0 + (b1 - b0) * k) * rail).toFixed(2) }, { trial });
    } };
  }

  // ---- motion streams --------------------------------------------------------------------------------------
  function actStream(r) {
    if (play) {
      const x = r();
      if (x < 0.4) { bump(stats.actions, 'stream:stop'); rec('act', ['stream:stop']); play.sch.stop(play.clock); play = null; return; }
      if (x < 0.8) {
        bump(stats.actions, 'stream:seek');
        const to = r() * play.script.durationMs;
        rec('act', ['stream:seek', Math.round(to)]);
        play.clock.t0 = performance.now() - to;
        play.sch.restart(play.clock, 200 + r() * 400);
        return;
      }
    }
    // One motion door, one stream at a time, as a client's player: a samples stream beside the segments one
    // only feeds the planner knots behind its own timeline (refused, counted as knot_refused).
    if (samples) { rec('act', ['samples:stop']); samples = null; }
    const sr = sub(r());
    const script = synthScript(sr);
    const lo = sr() * 0.3, hi = 0.7 + sr() * 0.3;
    const sch = createScheduler({ submit: (l) => door.segments(l), now: () => performance.now() });
    const clock = { ready: true, rate: 1, t0: performance.now(), mediaAt(t) { return (t - this.t0) * this.rate; }, displayAt(u) { return this.t0 + u / this.rate; } };
    sch.load(script);
    sch.setTransform({ lo, hi });
    sch.restart(clock);
    bump(stats.actions, 'stream:play');
    rec('act', ['stream:play', script.at.length, Math.round(script.durationMs), +lo.toFixed(3), +hi.toFixed(3)]);
    play = { sch, clock, script, last: '' };
  }
  function tickStream(now) {
    if (!play) return;
    if (play.clock.mediaAt(now) > play.script.durationMs + 1000) { rec('act', ['stream:end']); play = null; return; }
    const r = play.sch.tick(play.clock);
    if (r.sent > 0) { stats.segs += r.sent; stats.bundles++; }
    if (!r.ok && r.reason !== play.last) { bump(stats.refusals, 'stream:' + r.reason); rec('ref', ['stream', r.reason]); }
    play.last = r.ok ? '' : r.reason;
    if (r.fatal) { rec('act', ['stream:held', r.reason]); play = null; }
  }
  function actSamples(r) {
    if (samples) { bump(stats.actions, 'samples:stop'); rec('act', ['samples:stop']); samples = null; return; }
    const hz = 0.3 + r() * 3, amp = 0.1 + r() * 0.4, dur = 2000 + r() * 10000;
    if (play) { rec('act', ['stream:stop']); play.sch.stop(play.clock); play = null; }
    bump(stats.actions, 'samples');
    rec('act', ['samples', +hz.toFixed(2), +amp.toFixed(2), Math.round(dur)]);
    samples = { t0: performance.now(), hz, amp, dur, last: '' };
  }
  function tickSamples(now) {
    if (!samples) return;
    const t = (now - samples.t0) / 1000;
    if (t * 1000 > samples.dur) { samples = null; return; }
    const r = door(0.5 + samples.amp * Math.sin(2 * Math.PI * samples.hz * t));
    if (r.ok) stats.samples++;
    else if (r.reason !== samples.last) { bump(stats.refusals, 'samples:' + r.reason); rec('ref', ['samples', r.reason]); }
    samples.last = r.ok ? '' : r.reason;
  }
  function stopActivities() { play = null; samples = null; drag = null; }

  function reconnect(refetch) {
    bump(stats.actions, refetch ? 'refetch' : 'reconnect');
    rec('act', [refetch ? 'refetch' : 'reconnect']);
    stats.reconnects++;
    cold = refetch;
    closing = true;
    if (s) s.close();
    live = false;
    reopenAt = performance.now() + 300;
  }

  // ---- the host's step ---------------------------------------------------------------------------------------
  let lastStream = 0, lastSamples = 0;
  function step(now) {
    if (!s) { open(); nextAt = now + 1500; return; }
    if (!live) {
      if (reopenAt && now >= reopenAt) { reopenAt = 0; open(); return; }
      if (!reopenAt && now - connectAt > 15000) {
        stats.stuck++; flag('stuck-session', 'no LIVE in 15 s (phase ' + s.state.phase + ')');
        closing = true; s.close(); reopenAt = now + 1000;
      }
      return;
    }
    if (now - lastStateAt > 5000) { stats.stalls++; flag('stalled-session', 'no STATE for 5 s'); lastStateAt = now; }
    if (now - lastStream >= 25) { lastStream = now; tickStream(now); }
    if (now - lastSamples >= 20) { lastSamples = now; tickSamples(now); }
    if (drag && now >= drag.at) { drag.fn(drag.i++); drag.at += 120; if (drag.i >= drag.n) drag = null; }
    if (now < nextAt) return;
    const r = [];
    for (let i = 0; i < DRAWS; i++) r.push(rng());
    nextAt = now + T.pace[0] + r[0] * (T.pace[1] - T.pace[0]);
    const total = acts.reduce((n, a) => n + a.w, 0);
    let x = r[1] * total, a = acts[0];
    for (const c of acts) { if ((x -= c.w) < 0) { a = c; break; } }
    // Held past this client's patience, counted in actions so a replay takes the same branch: the next action
    // is the way out (release, return, home, resume).
    const sf = (s && s.state.safety) || {};
    heldActs = sf.estopLatched || sf.paused || sf.override ? heldActs + 1 : 0;
    if (heldActs > T.recoverAfter) a = acts.find((c) => c.kind === 'recover') || a;
    if (!a) return;
    const sr = sub(r[2]);
    try { const p = a.fn(sr); if (p && p.catch) p.catch(() => {}); } catch (e) { flag('client-error', a.kind + ': ' + e.message); }
  }

  return {
    seed: o.seed, stats, trace, traits: T, W,
    step,
    get live() { return live; },
    get session() { return s; },
    close() { closing = true; stopActivities(); if (s) s.close(); },
  };
}
