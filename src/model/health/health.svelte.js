/**
 * health.svelte.js -- the live half of the health system (ph-9t5l, phase 1):
 * samples this device, the link and the machine's role-bound values into a
 * local ring, runs core.js's classifier and tracker, and writes the Log
 * lines, the status slot and the Health cards.
 *
 * Constraints:
 * - Local only: the ring and the last SNAP_KEEP incident snapshots never
 *   leave this device except through a report the user reviews (report.js).
 * - Times are performance.now() ms; wall time names an incident in the list
 *   and the Log only, never a bundle.
 * - The machine is bound by role and core identity only (RENDERING §13 law 6).
 * - The 2 Hz CLOCK while streaming skips while another exchange is recent:
 *   the session has one CLOCK slot, and a second call takes the first's reply
 *   (motion.js's hunt would end early).
 * - Lag, frame rate and freezes are not measured while the page is hidden: a
 *   hidden page's timers and frames are throttled by design.
 * - Phase 1 has no hub-side arrival stamps (the Health roles RFC): NETWORK
 *   and HUB are "likely", CLIENT is decisive.
 */
import { machine, getSession, currentSocket } from '../machine.svelte.js';
import { latchWords } from '../motion.js';
import { ROLE } from '../roles.js';
import { labelFor, formatWithUnit } from '../format.js';
import { reportedValue } from '../settings.js';
import {
  CONDITIONS, CUTOUT, GROWTH, SEV_RANK, LAG_HEALTHY_MS, TICK_MS, classify, createTracker, growth, lineOf, tipLines, quantile, max, min,
} from './core.js';
import { reportId, loadSent, saveSent } from './report.js';
import { CORE_CHANNEL, LOG_LEVEL_NAME, CHANNEL_ROLE } from '../../../../Valence/clients/js/generated/registry_vocab.js';

const RING_S = 600, FINE_N = 1200, INC_KEEP = 20, SNAP_KEEP = 5;
const SNAP_KEY = 'phosphor.health.incidents.v1';
const LEVEL = Object.fromEntries(Object.entries(LOG_LEVEL_NAME).map(([k, v]) => [v, Number(k)]));
const now = () => performance.now();

/** Reactive: what the UI reads. Snapshots stay outside it (snaps). */
export const health = $state({
  /** Newest first: {id, cond, sev, cause, confidence, why, count, durationMs, wallAt, closed, evidence, settings}. */
  incidents: [],
  /** The top strip's line: {id, sev, text, title} or null (warn and act only). */
  slot: null,
  /** The incident the slot opened: the Health view expands it. */
  focus: null,
  link: {}, device: {}, machine: {},
  /** The Link card's 2-minute strip, 1 Hz: {s (seconds ago), rtt, lead, cut (cause|null)}. */
  strip: [],
  /** The incident under review, by id; null shows the cards. */
  review: null,
});

// ---- raw samples (plain arrays; trimmed by age) ------------------------------
const lags = [];      // {t, v}
const rtts = [];      // {t, v}
const owds = [];      // {t, v}
const sends = [];     // {t, lead, gap, lat, horizon}
const posGaps = [];   // {t, v}
const hubLogs = [];   // {t, level}
const anomalies = []; // {t}
const backlogs = [];  // {t, v}
const reconnectsAt = [];
const ring = [];      // 1 Hz rows
const fine = [];      // 10 Hz rows
const floors = [];    // heap floor MB per minute
const workerMins = [];
const snaps = new Map(); // incident id -> {rows, fine, t0}
const trim = (a, age, t) => { while (a.length && t - a[0].t > age) a.shift(); };
const inWin = (a, from, to) => a.filter((x) => x.t >= from && x.t <= to);
const vals = (a) => a.map((x) => x.v);

// ---- device sampling ---------------------------------------------------------
let frames = 0, fps = null, pressure = null, workers = 0, hiddenSince = null, wokeAt = 0;
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const heapMb = () => (globalThis.performance?.memory ? performance.memory.usedJSHeapSize / 1048576 : null);

function installDeviceProbes() {
  const raf = () => { frames++; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  // ponytail: a worker that closes itself is never counted down; terminate() is how this app ends one.
  const W = globalThis.Worker;
  if (W) globalThis.Worker = class extends W {
    constructor(...a) { super(...a); workers++; }
    terminate() { workers = Math.max(0, workers - 1); return super.terminate(); }
  };
  if ('PressureObserver' in globalThis) {
    try {
      const po = new globalThis.PressureObserver((recs) => { pressure = recs[recs.length - 1].state; });
      po.observe('cpu', { sampleInterval: 1000 }).catch(() => {});
    } catch (e) { /* not on this engine: the card says not measured */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (visible()) { hiddenSince = null; wokeAt = now(); } else hiddenSince = now();
    evaluateBackground();
  });
}

// ---- link sampling: session listeners ----------------------------------------
let attached = null;
let exch = [];             // kept CLOCK exchanges {at, offsetUs, rttUs}
let clockInflight = false, mineDoneAt = -1e9, anyClockAt = -1e9;
let posField = null, lastPosAt = 0, lastPos;
let origRate = {}, throttled = new Set(), throttleCuts = 0;
const bootByHost = new Map();
let lastSendAt = -1e9, lastHorizon = null, lastLat = null;
let cover = [];            // spans this session sent, {a, b} in now() ms; a new bundle supersedes what follows its start
let planF = null, idleRun = null, freshAt = -1e9;

function bestOffsetUs(t) {
  if (!exch.length) return null;
  const bound = (k) => k.rttUs / 2 + (t - k.at) * 1000 * 50e-6;
  return exch.reduce((a, b) => (bound(b) < bound(a) ? b : a)).offsetUs;
}

function attach(s) {
  attached = s;
  exch = [];
  cover = [];
  idleRun = null;
  origRate = {};
  throttled = new Set();
  s.on('clock', (c) => {
    const t = now();
    anyClockAt = t;
    exch.push({ at: t, ...c });
    if (exch.length > 32) exch.shift();
    // An exchange that overlaps a stall of this page timed the stall, not the link: no round trip,
    // no uplink sample, no spike and no late arrival from it.
    if (stalledOver(t, c.rttUs / 1000)) return;
    rtts.push({ t, v: c.rttUs / 1000 });
    const best = bestOffsetUs(t);
    // CLOCK's own algebra: t1 - t0 = offset + rtt/2, so the uplink leg is that less the true offset.
    const owd = best == null ? null : (c.offsetUs + c.rttUs / 2 - best) / 1000;
    if (owd != null) owds.push({ t, v: Math.max(0, owd) });
    spikeCheck(t, c.rttUs / 1000, owd);
    if (owd != null && streaming(t)) lateArrivalCheck(t, owd);
  });
  // A position channel pushes at min(grant, change rate): a pause while the value held is a hold, not a gap.
  s.on('state', (ch, sample) => {
    if (planF && ch === planF.dur.channelId) planSample(sample);
    if (!posField || ch !== posField.channelId) return;
    const t = now(), v = reportedValue(posField, sample);
    if (lastPosAt && streaming(t) && v !== lastPos) posGaps.push({ t, v: t - lastPosAt });
    lastPosAt = t;
    lastPos = v;
  });
  s.on('grant', (gs) => {
    const live = machine.link.phase === 'live';
    for (const g of gs || []) {
      if (g.rate == null) continue;
      if (origRate[g.channel] == null || !live) { origRate[g.channel] = Math.max(origRate[g.channel] || 0, g.rate); continue; }
      if (g.rate < origRate[g.channel]) { if (!throttled.has(g.channel)) throttleCuts++; throttled.add(g.channel); }
      else throttled.delete(g.channel);
    }
  });
  s.on('event', (evt) => {
    const t = now();
    if (evt.channel === CORE_CHANNEL.log) {
      const lv = evt.body && evt.body.level;
      if (typeof lv === 'number' && lv >= LEVEL.warn) hubLogs.push({ t, level: lv });
      return;
    }
    const e = machine.catalog.entries.find((x) => x.id === evt.channel);
    if (e && e.role === CHANNEL_ROLE.events_anomaly) anomalies.push({ t });
  });
  s.on('welcome', (w) => {
    const host = machine.link.host;
    const prev = bootByHost.get(host);
    if (w.bootId != null) {
      if (prev != null && prev !== w.bootId) tracker.event('restarted', now());
      bootByHost.set(host, w.bootId);
    }
  });
}

// ---- the stream door (motion.js deps.sent) -------------------------------------
const streaming = (t) => t - lastSendAt < 1000;
const posRate = () => (posField && machine.grants[posField.channelId] ? machine.grants[posField.channelId].rate : null);

/**
 * One segments bundle left: `leadMs` its first start minus now (a tiling
 * continuation only, else null), `gapMs` how long the hub had nothing to run
 * before this bundle could start (null when it did), `latMs` the grant's
 * schedule latency, `horizonMs` its horizon.
 */
export function noteSend({ leadMs, gapMs, latMs, horizonMs, fromMs, toMs, fresh }) {
  const t = now();
  if (fresh) freshAt = t;
  if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
    cover = cover.filter((c) => c.b > t - 5000).map((c) => ({ a: c.a, b: Math.min(c.b, fromMs) })).filter((c) => c.b > c.a);
    cover.push({ a: fromMs, b: toMs });
  }
  lastSendAt = t;
  lastHorizon = horizonMs;
  lastLat = latMs;
  sends.push({ t, lead: leadMs, gap: gapMs });
  if (gapMs > 0) cutout(t, { clip: true }, gapMs);
}

/**
 * The hub's own word on a starvation, from roles: no plan in flight (plan.duration 0, or elapsed past it)
 * while a span this session sent should be running, the sample taken about half an RTT ago. One run of
 * two or more idle samples is one episode, classified 600 ms after it ends, so the 2 Hz uplink delay
 * has landed.
 */
function planSample(sample) {
  const t = now();
  const du = reportedValue(planF.dur, sample), el = planF.el ? reportedValue(planF.el, sample) : null;
  if (!Number.isFinite(du)) return;
  const idle = du === 0 || (Number.isFinite(el) && el >= du);
  const hubT = t - (quantile(vals(inWin(rtts, t - 60000, t)), 0.5) || 0) / 2;
  const due = cover.some((c) => c.a + TICK_MS <= hubT && hubT < c.b - TICK_MS);
  if (idle && due && streaming(t) && !latchWords(machine.safety)) {
    if (!idleRun) idleRun = { t0: t, last: t };
    idleRun.last = t;
    return;
  }
  if (!idleRun) return;
  const run = idleRun;
  idleRun = null;
  // One idle sample is a plan boundary caught between two plans; a pause shows in two. A run's first
  // second is the hub ramping in from rest, not a stream running dry.
  if (run.last === run.t0 || run.t0 - freshAt < 1000) return;
  const rate = machine.grants[planF.dur.channelId] ? machine.grants[planF.dur.channelId].rate : 0;
  setTimeout(() => cutout(run.t0, { starved: true, overlap: true }, run.last - run.t0 + (rate > 0 ? 1000 / rate : 0)), 600);
}

/** The uplink delay ate the lead: the bundle that left with it reached the hub after its start. */
function lateArrivalCheck(t, owd) {
  const lead = min(inWin(sends, t - 1000, t).map((x) => x.lead));
  if (lead == null || owd <= lead - (lastLat || 0) - TICK_MS) return;
  cutout(t, { overlap: true }, owd - (lead - (lastLat || 0)));
}

function evidenceAt(t) {
  const W = [t - 1000, t];
  // A stall still in progress: the 100 ms tick overdue now (lags hold only the ticks that ran).
  const overdue = visible() && t - wokeAt > 2000 && t - lastTickAt - 100 > 0 ? t - lastTickAt - 100 : null;
  const rtt60 = vals(inWin(rtts, t - 60000, t));
  const pg = vals(inWin(posGaps, ...W));
  const rate = posRate();
  return {
    leadSendMinMs: min(inWin(sends, ...W).map((x) => x.lead)),
    latMs: lastLat,
    rttP50Ms: quantile(rtt60, 0.5),
    rttMaxMs: max(vals(inWin(rtts, t - 10000, t))),
    owdUpMaxMs: max(vals(inWin(owds, t - 1500, t + 500))),
    // A starvation is classified 600 ms after its run ends: every delay landed by then counts.
    owdRecentMaxMs: max(vals(inWin(owds, t - 5000, Math.max(t + 500, now())))),
    posGapMaxMs: max(pg),
    periodMs: rate > 0 ? 1000 / rate : null,
    loopLagMaxMs: max([...vals(inWin(lags, ...W)), overdue]),
    backlogMax: max(vals(inWin(backlogs, ...W))),
    hidden: !visible(),
    hubWarn: inWin(hubLogs, t - 5000, t).length,
    heapMb: heapMb(),
    fps,
    reconnects: machine.stats.reconnects,
  };
}

function cutout(t, { overlap, ...extra }, sizeMs) {
  const ev = { ...evidenceAt(t), ...extra };
  const c = classify(ev);
  tracker.event(CUTOUT[c.cause], t, { sizeMs: Math.max(0, sizeMs), overlap, cause: c.cause, confidence: c.confidence, why: c.why, fact: c.fact, evidence: ev });
}

/** One RTT or uplink sample over 4x the median and 100 ms: a Log-only spike. */
function spikeCheck(t, rtt, owd) {
  const med = quantile(vals(inWin(rtts, t - 60000, t - 1)), 0.5);
  const v = Math.max(rtt, owd || 0);
  if (med != null && v > 4 * med && v > 100) tracker.event('delay-spike', t, { sizeMs: 0, peakMs: Math.round(v), evidence: evidenceAt(t) });
}

// ---- incidents: Log lines, the list, snapshots ----------------------------------
const logRefs = new Map(); // incident id -> its Log ring record

function view(inc) {
  return {
    id: inc.id, cond: inc.cond, sev: inc.sev, cause: inc.cause || CONDITIONS[inc.cond].cause || null,
    confidence: inc.confidence || null, why: inc.why || '', count: inc.count, durationMs: Math.round(inc.durationMs),
    wallAt: inc.wallAt, closed: inc.closedAt != null, text: lineOf(inc), tip: tipLines(inc), m: inc.m || null, evidence: inc.evidence || null,
    settings: { horizonMs: lastHorizon, latMs: lastLat },
    episodes: inc.episodes.map((e) => e - inc.t0), t0: inc.t0,
  };
}

function publish(inc) {
  const v = view(inc);
  const i = health.incidents.findIndex((x) => x.id === inc.id);
  if (i >= 0) health.incidents[i] = v;
  else {
    health.incidents.unshift(v);
    if (health.incidents.length > INC_KEEP) health.incidents.length = INC_KEEP;
  }
  const rec = logRefs.get(inc.id);
  if (rec) rec.body.message = v.text;
}

const tracker = createTracker({
  open(inc) {
    inc.id = reportId();
    inc.wallAt = Date.now();
    inc.evidence = inc.evidence || evidenceAt(inc.t0);
    publish(inc);
    const ring = machine.events.log;
    ring.push({ channel: null, channelName: 'client', at: inc.wallAt, health: inc.id,
      body: { level: inc.sev === 'info' ? LEVEL.info : LEVEL.warn, tag: 'health', message: lineOf(inc) } });
    logRefs.set(inc.id, ring[ring.length - 1]);
    if (ring.length > 400) ring.splice(0, ring.length - 400);
    const id = inc.id, t0 = inc.t0;
    setTimeout(() => keepSnap(id, t0), 31000);
  },
  update: publish,
  close: publish,
});

/** The ring around an incident: 1 Hz rows over [-60, +30] s, 10 Hz rows over [-2, +0.5] s. */
function snapOf(t0) {
  return { t0, rows: inWin(ring, t0 - 61000, t0 + 31000).map((r) => ({ ...r, t: r.t - t0 })),
    fine: inWin(fine, t0 - 2100, t0 + 600).map((r) => ({ ...r, t: r.t - t0 })) };
}
export function snapshot(id) {
  const inc = health.incidents.find((x) => x.id === id);
  return snaps.get(id) || (inc && inc.t0 != null && !inc.restored ? snapOf(inc.t0) : null);
}

function keepSnap(id, t0) {
  snaps.set(id, snapOf(t0));
  while (snaps.size > INC_KEEP) snaps.delete(snaps.keys().next().value);
  persist();
}

function persist() {
  try {
    const keep = health.incidents.filter((i) => snaps.has(i.id)).slice(0, SNAP_KEEP)
      .map((i) => ({ ...$state.snapshot(i), snap: snaps.get(i.id) }));
    localStorage.setItem(SNAP_KEY, JSON.stringify(keep));
  } catch (e) { /* private mode: snapshots last until reload */ }
}

function restore() {
  try {
    const a = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
    for (const x of Array.isArray(a) ? a : []) {
      if (!x || typeof x.id !== 'string' || !CONDITIONS[x.cond]) continue;
      snaps.set(x.id, x.snap);
      health.incidents.push({ ...x, snap: undefined, closed: true, restored: true, t0: null });
    }
  } catch (e) { /* none kept */ }
}

// ---- the status slot: act and warn, a 5 s minimum dwell --------------------------
let slotAt = 0;
function updateSlot(t) {
  // An open incident's numbers move while its signal holds: its row and Log line follow.
  for (const i of Object.values(tracker.incidents)) {
    const v = i.closedAt == null && health.incidents.find((x) => x.id === i.id);
    if (v && v.text !== lineOf(i)) publish(i);
  }
  const open = Object.values(tracker.incidents).filter((i) => i.closedAt == null && SEV_RANK[i.sev] >= 1 && !CONDITIONS[i.cond].logOnly)
    .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || b.lastAt - a.lastAt);
  const top = open[0];
  const cur = health.slot;
  if (cur && (!top || top.id !== cur.id) && t - slotAt < 5000 && !(top && SEV_RANK[top.sev] > SEV_RANK[cur.sev])) return;
  const next = top ? { id: top.id, sev: top.sev, text: lineOf(top), title: [...tipLines(top), 'Click to open this incident'].join('\n') } : null;
  if ((next && next.id) !== (cur && cur.id) || (next && cur && next.sev !== cur.sev)) slotAt = t;
  if (JSON.stringify(next) !== JSON.stringify(cur)) health.slot = next;
}

// ---- level conditions, once a second ---------------------------------------------
const isOpen = (id) => { const i = tracker.incidents[id]; return !!i && i.closedAt == null; };
/** Hysteresis by threshold: `on` enters, `off` clears, between them the condition holds. */
const band = (id, on, off, sev) => (on ? sev : off ? null : isOpen(id) ? (tracker.incidents[id].sev || sev) : null);
let seriousSince = null, criticalSince = null, minuteRows = [];

function evaluateBackground() {
  const t = now();
  tracker.level('background', !visible() && t - lastSendAt < 2000 ? 'warn' : null, t);
  updateSlot(t);
}

function evaluate(t, row) {
  const live = machine.link.phase === 'live';
  // send-margin: least lead under a quarter of the horizon for 5 s, clear at a third.
  const H = lastHorizon || 250;
  const lead1 = row.lead;
  tracker.level('send-margin', streaming(t) ? band('send-margin', lead1 != null && lead1 < H / 4, lead1 != null && lead1 >= H / 3, 'info') : null, t,
    lead1 != null ? { m: { leadMs: lead1, onMs: H / 4 } } : undefined);
  // slow-link: RTT p50 and jitter over the last minute.
  const r = vals(inWin(rtts, t - 60000, t));
  if (r.length >= 3) {
    const p50 = quantile(r, 0.5), jit = quantile(r, 0.95) - p50;
    tracker.level('slow-link', band('slow-link', p50 > 50 || jit > 30, p50 < 30 && jit < 15, 'warn'), t, { m: { p50Ms: p50, p95Ms: p50 + jit } });
  } else tracker.level('slow-link', isOpen('slow-link') ? 'warn' : null, t);
  // updates-stalled: no inbound frame for 500 ms on a live link while this page ran.
  const gap = Date.now() - machine.stats.lastRxMs;
  tracker.level('updates-stalled', live && gap >= 500 && (row.lag || 0) < LAG_HEALTHY_MS ? 'warn' : null, t, { peakMs: Math.round(gap) });
  tracker.level('backlog', live && row.backlog > 0 ? 'act' : null, t, { m: { bytes: row.backlog } });
  tracker.level('throttled', live && throttled.size ? 'info' : null, t, { m: { channels: throttled.size } });
  const rc = reconnectsAt.filter((x) => t - x < 300000).length;
  tracker.level('drops', band('drops', rc >= 2, !reconnectsAt.some((x) => t - x < 600000), 'warn'), t, { m: { n: rc } });

  // This device.
  if (visible() && t - wokeAt > 2000) {
    const p95 = quantile(vals(inWin(lags, t - 60000, t)), 0.95);
    tracker.level('busy', band('busy', p95 > 25, p95 != null && p95 < 15, p95 > 100 ? 'act' : 'warn'), t, { m: { p95Ms: p95 } });
    tracker.level('slow-display', band('slow-display', fps != null && fps < 30, fps >= 45, 'info'), t, { m: { fps } });
  } else tracker.level('slow-display', null, t);
  if (pressure === 'critical') criticalSince ??= t; else criticalSince = null;
  if (pressure === 'serious' || pressure === 'critical') seriousSince ??= t; else seriousSince = null;
  const ov = criticalSince != null && t - criticalSince >= 10000 ? 'act' : seriousSince != null && t - seriousSince >= 30000 ? 'warn' : null;
  const pFor = criticalSince != null ? t - criticalSince : seriousSince != null ? t - seriousSince : null;
  tracker.level('overloaded', ov || (pressure === 'nominal' || pressure === 'fair' ? null : isOpen('overloaded') ? 'warn' : null), t,
    { m: { state: pressure, forMs: pFor } });
  evaluateBackground();

  // The machine, by role.
  const hot = tempFields().find((x) => x.hot);
  tracker.level('hot', hot ? 'warn' : null, t, hot && { m: { label: hot.label, text: hot.text, max: hot.max } });
  tracker.tick(t);
}

function perMinute(t) {
  minuteRows.push({ heap: heapMb(), workers });
  if (minuteRows.length < 60) return;
  // A minute is 60 one-second rows; on the 60th, fold it.
  const m = minuteRows.splice(0);
  const f = min(m.map((x) => x.heap));
  if (f != null) floors.push(f);
  workerMins.push(max(m.map((x) => x.workers)) || 0);
  if (floors.length > 120) floors.shift();
  if (workerMins.length > 120) workerMins.shift();
  // D4: once raised it holds, from the same base, while the floor stays half the alarm's rise above it.
  const g = growth(floors);
  const was = isOpen('growth') ? tracker.incidents.growth.m : null;
  const nowMb = min(floors.slice(-GROWTH.blockMin));
  const gm = was && nowMb - was.baseMb >= GROWTH.riseMb / 2
    ? { ...was, nowMb, minutes: Math.round((t - was.from) / 60000), slopeMbPerMin: (nowMb - was.baseMb) / ((t - was.from) / 60000) }
    : g && { ...g, from: t - g.minutes * 60000 };
  tracker.level('growth', gm ? 'warn' : null, t, gm && { m: gm, durationMs: gm.minutes * 60000 });
  // D6: workers past the session's first minutes + 2, for 5 minutes.
  const base = workerMins.length >= 6 ? quantile(workerMins.slice(1, 6), 0.5) : null;
  const last = workerMins.slice(-5);
  const extra = base != null && last.length === 5 && last.every((w) => w > base + 2);
  tracker.level('workers', extra ? 'warn' : null, t, extra && { m: { base, now: last[4] } });
}

function tempFields() {
  const model = machine.catalog.model;
  return ((model && model.byRole.get(ROLE.telemetryTemp)) || []).map((f) => {
    const v = reportedValue(f, machine.samples[f.channelId]);
    const hot = Number.isFinite(v) && Number.isFinite(f.max) && v > f.max - 0.1 * Math.abs(f.max);
    return { label: labelFor(f), text: Number.isFinite(v) ? formatWithUnit(f, v) : null, hot, max: f.max };
  });
}

// ---- the 100 ms tick ------------------------------------------------------------
let due = 0, tickN = 0, lastReconnects = 0, fineAcc = null, lastTickAt = 0;
/** This page stalled within `span` ms before t: a recorded lag, or the 100 ms tick overdue right now. */
function stalledOver(t, span) {
  return max(vals(inWin(lags, t - span - 100, t))) > LAG_HEALTHY_MS || t - lastTickAt > 100 + LAG_HEALTHY_MS;
}

function tick() {
  const t = now();
  const lag = Math.max(0, t - due);
  lastTickAt = t;
  due = t + 100;
  setTimeout(tick, 100);
  const vis = visible();
  if (vis && t - wokeAt > 2000) {
    lags.push({ t, v: lag });
    if (lag >= 250) tracker.event('freeze', t, { sizeMs: lag, peakMs: lag, evidence: evidenceAt(t) });
  }
  const s = getSession();
  if (s && s !== attached) attach(s);
  const model = machine.catalog.model;
  const pf = model && model.byRole.get(ROLE.telemetryPosition);
  posField = pf && pf.length ? pf[0] : null;
  const pd = model && model.byRole.get(ROLE.planDuration);
  const pe = pd && pd.length ? (model.byRole.get(ROLE.planElapsed) || []).find((f) => f.channelId === pd[0].channelId) : null;
  planF = pd && pd.length ? { dur: pd[0], el: pe || null } : null;
  const ws = currentSocket();
  const bl = ws && ws.readyState === 1 ? ws.bufferedAmount || 0 : 0;
  backlogs.push({ t, v: bl });
  // CLOCK at 2 Hz while streaming (the uplink delay), never over another exchange.
  if (s && s.isLive && streaming(t) && !clockInflight && t - mineDoneAt >= 500 && !(anyClockAt > mineDoneAt && t - anyClockAt < 600)) {
    clockInflight = true;
    s.syncClock(1000).finally(() => { clockInflight = false; mineDoneAt = now(); });
  }
  // The fine row: the last 100 ms.
  const recent = (a) => inWin(a, t - 100, t);
  fine.push({ t, lead: min(recent(sends).map((x) => x.lead)), owd: max(vals(recent(owds))), gap: max(vals(recent(posGaps))) });
  if (fine.length > FINE_N) fine.shift();
  fineAcc = fineAcc || { lag: 0, bl: 0 };
  fineAcc.lag = Math.max(fineAcc.lag, vis ? lag : 0);
  fineAcc.bl = Math.max(fineAcc.bl, bl);
  if (++tickN % 10) return;

  // Once a second.
  fps = vis ? frames : null;
  frames = 0;
  if (machine.stats.reconnects > lastReconnects) reconnectsAt.push(t);
  lastReconnects = machine.stats.reconnects;
  const sec = (a) => inWin(a, t - 1000, t);
  const row = {
    t, rtt: max(vals(sec(rtts))), lead: min(sec(sends).map((x) => x.lead)), arr: null,
    gap: max(vals(sec(posGaps))), lag: fineAcc.lag, fps, heap: heapMb(), rssi: null, late: null,
    owd: max(vals(sec(owds))), backlog: fineAcc.bl,
  };
  fineAcc = null;
  ring.push(row);
  if (ring.length > RING_S) ring.shift();
  for (const a of [lags, owds, sends, posGaps, backlogs, anomalies]) trim(a, 120000, t);
  trim(rtts, 600000, t);
  trim(hubLogs, 600000, t);
  while (reconnectsAt.length && t - reconnectsAt[0] > 600000) reconnectsAt.shift();
  evaluate(t, row);
  perMinute(t);
  updateSlot(t);
  cards(t);
}

// ---- the cards, once a second ------------------------------------------------------
let prevIo = null;
function cards(t) {
  const r = vals(inWin(rtts, t - 60000, t));
  const p50 = quantile(r, 0.5);
  const lead2 = min(inWin(sends, t - 120000, t).map((x) => x.lead));
  const rate = posRate();
  const gapFloor = Math.max(3 * (rate > 0 ? 1000 / rate : 0), 100);
  const gaps = vals(inWin(posGaps, t - 120000, t)).filter((g) => g >= gapFloor);
  const worst = (area) => Object.values(tracker.incidents).filter((i) => i.closedAt == null && CONDITIONS[i.cond].area === area && !CONDITIONS[i.cond].logOnly)
    .sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || b.lastAt - a.lastAt)[0];
  const status = (area) => { const w = worst(area); return w ? { sev: w.sev, text: lineOf(w) } : { sev: null, text: 'Good' }; };
  const io = machine.stats;
  const perS = prevIo && io.framesIn >= prevIo.in ? { in: io.framesIn - prevIo.in, out: io.framesOut - prevIo.out } : {};
  prevIo = { in: io.framesIn, out: io.framesOut };
  health.link = {
    status: status('link'),
    rttMs: p50, rttSlowMs: r.length >= 3 ? quantile(r, 0.95) : null,
    leadMinMs: lead2, gaps: gaps.length, longestGapMs: max(gaps), backlog: (ring[ring.length - 1] || {}).backlog || 0,
    inPerS: perS.in ?? null, outPerS: perS.out ?? null, reconnects: io.reconnects, cuts: throttleCuts,
    streaming: streaming(t),
  };
  const m10 = inWin(ring, t - 600000, t).map((x) => x.heap).filter(Number.isFinite);
  health.device = {
    status: status('device'),
    lagP95Ms: quantile(vals(inWin(lags, t - 60000, t)), 0.95), fps, heapMb: heapMb(),
    heapTrendMb: m10.length >= 60 ? m10[m10.length - 1] - m10[0] : null, pressure, workers,
    growth: isOpen('growth') ? lineOf(tracker.incidents.growth) : null, visible: visible(),
  };
  const model = machine.catalog.model;
  const bus = ((model && model.byRole.get(ROLE.telemetryPowerBus)) || []).map((f) => {
    const v = reportedValue(f, machine.samples[f.channelId]);
    return { label: labelFor(f), text: Number.isFinite(v) ? formatWithUnit(f, v) : null };
  });
  health.machine = {
    status: status('machine'),
    temps: tempFields(), bus,
    warnPerMin: inWin(hubLogs, t - 60000, t).length,
    anomaliesPerMin: inWin(anomalies, t - 60000, t).length,
    restarts: tracker.incidents.restarted ? tracker.incidents.restarted.count : 0,
    live: machine.link.phase === 'live',
  };
  const cuts = health.incidents.filter((i) => CONDITIONS[i.cond].cause && i.t0 != null);
  health.strip = inWin(ring, t - 120000, t).map((x) => ({
    s: (x.t - t) / 1000, rtt: x.rtt, lead: x.lead,
    cut: (cuts.find((c) => c.episodes.some((e) => Math.abs(c.t0 + e - x.t) < 500)) || {}).cause || null,
  }));
}

/** The bundle's settings and context, read now. */
export function context() {
  const id = machine.link.hubIdentity;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const plat = import.meta.env?.TAURI_ENV_PLATFORM;
  const eng = /Chrome\/(\d+)/.exec(ua) ? 'chromium-' + /Chrome\/(\d+)/.exec(ua)[1]
    : /AppleWebKit\/([\d.]+)/.exec(ua) ? 'webkit-' + /AppleWebKit\/([\d.]+)/.exec(ua)[1] : /Firefox\/(\d+)/.test(ua) ? 'gecko-' + /Firefox\/(\d+)/.exec(ua)[1] : null;
  return {
    // A bare git sha goes out as g<sha>, so the version shape never has to admit a run of digits.
    app: { version: typeof __UI_BUILD__ === 'undefined' ? null : /^[0-9a-f]{7,12}$/.test(__UI_BUILD__) ? 'g' + __UI_BUILD__ : __UI_BUILD__,
      platform: plat === 'windows' || plat === 'macos' || plat === 'linux' || plat === 'android' || plat === 'ios' ? plat : 'web',
      engine: eng, shell: !!plat },
    machine: { firmware: id && id.fw_version,
      transport: machine.link.virtual ? null : currentSocket() instanceof globalThis.WebSocket ? 'ws' : 'ble' },
  };
}

/** Hub log warn and error counts around an incident (counts only, never the text); null when unknown (a restored incident). */
export function hubLogCounts(t0) {
  if (t0 == null) return null;
  const a = inWin(hubLogs, t0 - 60000, t0 + 30000);
  return { warn: a.filter((x) => x.level === LEVEL.warn).length, error: a.filter((x) => x.level > LEVEL.warn).length };
}

/** The Sent reports list (report.js store), reactive for the About and Health views. */
export const sent = $state({ list: loadSent() });
export function putSent(row) {
  const i = sent.list.findIndex((r) => r.id === row.id);
  if (i >= 0) sent.list[i] = { ...sent.list[i], ...row }; else sent.list.unshift(row);
  saveSent($state.snapshot(sent.list));
}
export function dropSent(id) {
  sent.list = sent.list.filter((r) => r.id !== id);
  saveSent($state.snapshot(sent.list));
}

/** Forgets one incident here (the Log line stays). */
export function forgetIncident(id) {
  health.incidents = health.incidents.filter((i) => i.id !== id);
  snaps.delete(id);
  persist();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  restore();
  installDeviceProbes();
  due = now() + 100;
  setTimeout(tick, 100);
}
