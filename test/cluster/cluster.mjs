/**
 * cluster.mjs -- the Neutrino cluster (ph-ode2): N worker threads x K Neutrino hubs (one wasm instance each,
 * from one compiled module per worker), each hammered by one or two seeded headless Valence clients
 * (client.mjs), metered per hub per minute; a ramp over hub counts finds the knee. How it works: README.md,
 * "The Neutrino cluster".
 *
 *   node test/cluster/cluster.mjs --ramp 32,64,128,256,512,1024 [--minutes 5] [--long 30] [--per-worker 32]
 *                                [--max-workers physical cores] [--seed 1]
 *   node test/cluster/cluster.mjs --hubs 64 [--minutes 2]
 *   node test/cluster/cluster.mjs --hubs 2048 --lockstep [--minutes 10]   every hub as --replay runs it, on a virtual
 *                                1 ms clock per worker, as fast as the worker goes (--ramp and --long take it too)
 *   node test/cluster/cluster.mjs --replay SEED [--minutes 3] [--hw-safe] [--realtime] [--out FILE]   one hub alone,
 *                                traced, in lockstep on a virtual clock unless --realtime
 *   node test/cluster/cluster.mjs --replay SEED --target ws://HUB:PORT/ [--http 80] [--out FILE]   a real hub
 *   node test/cluster/cluster.mjs --replay SEED --hw-safe --like HW.json [--out FILE]   Neutrino from that hub's settings
 *
 * Results land in test/evidence/cluster/ (gitignored): per step a JSON with every minute and every flagged hub,
 * summary.json across the ramp; a replay writes its trace for compare.mjs.
 *
 * Constraints:
 * - One tick loop per worker: setImmediate polled against an hrtime deadline every --tick-us (1000), so it
 *   never sleeps through a deadline and never spins in a while loop; lateness is now minus the deadline.
 *   The loop polls, so a worker's thread reads 100 % CPU whatever its load: `work %` (time inside ticks,
 *   drains and client steps) is the load figure.
 * - A hub's seed reproduces it alone: --replay SEED boots the same options and the same client seeds.
 * - --lockstep runs each hub exactly as --replay SEED does: the replay's subscription rates, the seed's own
 *   Math.random stream, the hub's work and timers inside its own async context. A seed it flags replays alone
 *   to the same per-minute counters and flags. It measures no timing: no tick-lateness fields, and its output
 *   and summary say lockstep.
 * - --target never runs from the cluster: it is one hub, the operator's, run by the operator.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bootNeutrino, wasmBytes } from './neutrino.mjs';
import { createClient, hubPlan, mulberry32 } from './client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVID = join(HERE, '..', 'evidence', 'cluster');
const BUCKET_US = 10, BUCKETS = 5000; // lateness histogram: 10 us bins to 50 ms, then overflow
const HEALTHY_P99_MS = 4;            // under the hub's own 5 ms tick
const REPLAY_RATES = { planHz: 45, motionHz: 60 }; // --replay and --lockstep subscribe alike, or a seed runs differently
const als = new AsyncLocalStorage(); // lockstep: the hub whose code is running, {rand}
const hubRand = (seed) => mulberry32(seed ^ 0x7a11);

// ---- a worker (or a replay): hubs, clients, the loop ---------------------------------------------------------
function quantile(hist, over, q) {
  let n = over.length;
  for (let i = 0; i < BUCKETS; i++) n += hist[i];
  if (!n) return 0;
  let k = Math.ceil(q * n);
  for (let i = 0; i < BUCKETS; i++) { k -= hist[i]; if (k <= 0) return (i + 1) * BUCKET_US / 1000; }
  over.sort((a, b) => a - b);
  return over[Math.min(over.length - 1, over.length + k - 1)] / 1000;
}

const sum = (a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; };
const diff = (a, b) => { const o = {}; for (const k in a) if (a[k] - (b[k] || 0)) o[k] = a[k] - (b[k] || 0); return o; };
const DIAG = ['plans', 'failures', 'anomalies', 'anom_settle', 'anom_endvel_clamped', 'anom_knot_trimmed', 'anom_dwell_zeroed',
  'anom_knot_refused', 'anom_piece_over_ceiling', 'sync_bundles', 'sync_samples', 'sync_enqueued', 'sync_dropped', 'sync_seg_bundles'];

/** One hub: its Neutrino (null for a real target), its clients, its counters. */
async function makeHub(seed, module, { hwSafe = false, record = false, target = null, planHz, motionHz, preset = null } = {}) {
  const plan = hubPlan(seed, hwSafe || !!target);
  const rec = { seed, opts: plan.opts, flags: [], diag: null, logs: {} };
  let n = null;
  if (!target) {
    n = await bootNeutrino(module, plan.opts, (line) => {
      // Warn and error lines by kind; a "(suppressed N)" tail counts the N lines it stands for.
      const m = /^\[([WE])\]\s*(?:\d+\s+)?(.*?)(?:\s*\(suppressed (\d+)\))?$/.exec(line);
      if (m) { const k = m[1] + ' ' + m[2].replace(/\s+/g, ' ').replace(/-?\d+(\.\d+)?/g, '#').slice(0, 90); rec.logs[k] = (rec.logs[k] || 0) + 1 + Number(m[3] || 0); }
    });
  }
  const seeds = target ? plan.clients.slice(0, 1) : plan.clients;
  const clients = seeds.map((cs) => createClient(target ? {
    seed: cs, WebSocketImpl: globalThis.WebSocket, url: target.url, host: target.host, port: target.port, token: target.token,
    record, hwSafe: true, planHz, motionHz, hub: rec,
  } : { seed: cs, WebSocketImpl: n.WebSocket, token: n.token, record, hwSafe, planHz, motionHz, hub: rec, preset }));
  return { seed, n, clients, rec, prev: null };
}

/** Cumulative counters of a hub, for per-minute deltas. */
function snapshot(h) {
  const c = { nacks: {}, refusals: {}, anoms: {}, reaps: {}, results: {}, actions: {}, segs: 0, bundles: 0, samples: 0, timeouts: 0, stuck: 0, stalls: 0, watch: 0, reconnects: 0 };
  for (const cl of h.clients) {
    const s = cl.stats;
    for (const k of ['nacks', 'refusals', 'anoms', 'reaps', 'results', 'actions']) sum(c[k], s[k]);
    for (const k of ['segs', 'bundles', 'samples', 'timeouts', 'stuck', 'stalls', 'watch', 'reconnects']) c[k] += s[k];
  }
  const d = h.rec.diag || {};
  c.diag = Object.fromEntries(DIAG.map((k) => [k, d[k] || 0]));
  c.logs = { ...h.rec.logs };
  return c;
}

function minuteOf(h) {
  const cur = snapshot(h), p = h.prev || snapshot({ clients: [], rec: { logs: {} } });
  h.prev = cur;
  const d = h.rec.diag || {};
  const out = { seed: h.seed, diag: diff(cur.diag, p.diag), plan_us_max: d.plan_us_max || 0, nacks: diff(cur.nacks, p.nacks),
    refusals: diff(cur.refusals, p.refusals), reaps: diff(cur.reaps, p.reaps), logs: diff(cur.logs, p.logs) };
  for (const k of ['segs', 'bundles', 'samples', 'timeouts', 'stuck', 'stalls', 'watch', 'reconnects']) out[k] = cur[k] - p[k];
  out.actions = Object.values(diff(cur.actions, p.actions)).reduce((a, b) => a + b, 0);
  if (h.n) { out.memMB = +(h.n.memBytes() / 1048576).toFixed(1); out.ringDrops = h.n.ringDrops; out.trap = h.n.trap ? String(h.n.trap) : null; }
  return out;
}

/** The loop: tick every hub to now, deliver, pump the links, step the clients; meter lateness and work. */
function runLoop(hubs, { minutes, tickUs = 1000, onMinute, onEnd }) {
  const hr = () => Number(process.hrtime.bigint() / 1000n);
  const epoch = hr() - 1e6;
  const start = performance.now();
  let deadline = hr(), nextStep = 0, nextMinute = start + 60000, minute = 0;
  const endAt = start + minutes * 60000;
  let hist = new Uint32Array(BUCKETS), over = [], workMs = 0, wallAt = performance.now(), skipped = 0, maxLate = 0;
  const clients = hubs.flatMap((h) => h.clients);
  const flush = (final) => {
    const now = performance.now();
    const m = { minute, p50: quantile(hist, over, 0.5), p99: quantile(hist, over, 0.99), max: maxLate / 1000,
      work: +(workMs / (now - wallAt) * 100).toFixed(1), skipped, hubs: hubs.map(minuteOf) };
    hist = new Uint32Array(BUCKETS); over = []; workMs = 0; wallAt = now; skipped = 0; maxLate = 0; minute++;
    onMinute(m, final);
  };
  const loop = () => {
    const now = hr();
    if (now >= deadline) {
      const late = now - deadline;
      if (late < BUCKETS * BUCKET_US) hist[Math.floor(late / BUCKET_US)]++; else over.push(late);
      if (late > maxLate) maxLate = late;
      const a = performance.now();
      for (const h of hubs) if (h.n && !h.n.trap) { h.n.tick(now - epoch); h.n.drain(); if (h.n.trap) h.rec.flags.push({ kind: 'trap', detail: String(h.n.trap), seed: h.seed }); }
      const ms = performance.now();
      for (const c of clients) for (const s of c.W.all) s.pump(ms);
      if (ms >= nextStep) { nextStep = ms + 10; for (const c of clients) c.step(ms); }
      workMs += performance.now() - a;
      deadline += tickUs;
      if (deadline < now) { skipped += Math.floor((now - deadline) / tickUs); deadline = now + tickUs; }
    }
    const t = performance.now();
    if (t < endAt && t >= nextMinute) { nextMinute += 60000; flush(false); }
    if (t >= endAt) { flush(true); for (const h of hubs) for (const c of h.clients) c.close(); setTimeout(onEnd, 200); return; }
    setImmediate(loop);
  };
  setImmediate(loop);
}

if (!isMainThread) {
  const { seeds, minutes, tickUs, planHz, lockstep: ls } = workerData;
  const vc = ls ? virtualClock(seeds[0]) : null;
  const module = new WebAssembly.Module(wasmBytes());
  const hubs = [];
  for (const seed of seeds) {
    if (!ls) { hubs.push(await makeHub(seed, module, { planHz })); continue; }
    const ctx = { rand: hubRand(seed) };
    hubs.push(Object.assign(await als.run(ctx, () => makeHub(seed, module, REPLAY_RATES)), { ctx }));
  }
  parentPort.postMessage({ op: 'up', hubs: hubs.length });
  const onMinute = (m) => parentPort.postMessage({ op: 'minute', m });
  const onEnd = () => {
    parentPort.postMessage({ op: 'done', hubs: hubs.map((h) => ({ seed: h.seed, opts: h.rec.opts, flags: h.rec.flags,
      xfail: h.clients.flatMap((c) => c.stats.xfail), homeOsc: h.clients.reduce((a, c) => sum(a, c.stats.homeOsc), {}),
      actions: h.clients.reduce((a, c) => sum(a, c.stats.actions), {}), results: h.clients.reduce((a, c) => sum(a, c.stats.results), {}),
      diag: h.rec.diag, clean: !h.rec.opts.plan_delay_ms && h.clients.every((c) => !c.traits.imp.latMs && !c.traits.imp.loss && !c.traits.imp.reorder),
      clients: h.clients.length })) });
    process.exit(0);
  };
  if (ls) lockstep(vc, hubs, minutes, onMinute).then(onEnd);
  else runLoop(hubs, { minutes, tickUs, onMinute, onEnd });
}

// ---- main ---------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

async function runStep(n, minutes, { perWorker, seed0, tickUs, label, lockstep: ls }) {
  // Never more polling workers than physical cores (half the logical ones, SMT assumed): a poller on a
  // shared core, or preempted, waits out a 15.6 ms Windows quantum. Measured 2026-10-10 on 16C/32T: 1024 hubs
  // on 30 workers p99 23 ms, on 16 workers p99 1.4 ms; past that cap a worker hosts more hubs instead.
  const W = Math.min(Math.ceil(n / perWorker), Number(argOf('--max-workers', Math.max(1, availableParallelism() >> 1))));
  const workers = [];
  const minutesAgg = [];
  const done = [];
  const byMinute = new Map();
  // The whole machine's CPU too: other work on this host (another agent's suites) shows as sys minus ours.
  const sysTimes = () => cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
  let cpu0 = process.cpuUsage(), t0 = performance.now(), sys0 = sysTimes();
  const cores = availableParallelism();
  let simMs = 0;
  console.log(`\n== Neutrino cluster: ${label || n + ' hubs'}, ${W} workers x ~${Math.ceil(n / W)}, ${minutes} min${ls ? ', LOCKSTEP (virtual 1 ms clock, no tick lateness)' : ''}`);
  console.log('  min  hubs' + (ls ? '  sim/wall' : '  p50ms  p99ms  maxms  work%') + '  cpu%  sys%   rssMB  wasmMB  plans/s  anoms  fails  nacks  reaps  stalls  flags');
  await new Promise((resolve) => {
    let ended = 0;
    for (let w = 0; w < W; w++) {
      const seeds = [];
      for (let i = w; i < n; i += W) seeds.push(seed0 + i);
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds, minutes, tickUs, planHz: 10, lockstep: ls } });
      workers.push(wk);
      wk.on('message', (msg) => {
        if (msg.op === 'minute') {
          const list = byMinute.get(msg.m.minute) || [];
          list.push(msg.m);
          byMinute.set(msg.m.minute, list);
          if (list.length === W) report(msg.m.minute, list);
        } else if (msg.op === 'done') done.push(...msg.hubs);
      });
      wk.on('error', (e) => { console.log('  worker ' + w + ' error: ' + (e.stack || e)); });
      wk.on('exit', () => { if (++ended === W) resolve(); });
    }
  });
  function report(minute, list) {
    const now = performance.now(), cu = process.cpuUsage(cpu0);
    cpu0 = process.cpuUsage(); const wall = now - t0; t0 = now;
    const sys1 = sysTimes(), sysCpu = +((sys1.busy - sys0.busy) / (sys1.all - sys0.all) * 100).toFixed(1); sys0 = sys1;
    const hubs = list.flatMap((m) => m.hubs);
    const agg = { minute, workers: list.map((m) => ({ p50: m.p50, p99: m.p99, max: m.max, work: m.work, skipped: m.skipped })),
      p50: Math.max(...list.map((m) => m.p50)), p99: Math.max(...list.map((m) => m.p99)), max: Math.max(...list.map((m) => m.max)),
      work: +(list.reduce((a, m) => a + m.work, 0) / list.length).toFixed(1),
      cpu: +(((cu.user + cu.system) / 1000) / wall / cores * 100).toFixed(1), sysCpu, rssMB: Math.round(process.memoryUsage().rss / 1048576),
      wasmMB: Math.round(hubs.reduce((a, h) => a + (h.memMB || 0), 0)),
      diag: hubs.reduce((a, h) => sum(a, h.diag), {}), nacks: hubs.reduce((a, h) => sum(a, h.nacks), {}),
      refusals: hubs.reduce((a, h) => sum(a, h.refusals), {}), reaps: hubs.reduce((a, h) => sum(a, h.reaps), {}),
      logs: hubs.reduce((a, h) => sum(a, h.logs), {}),
      planUsMax: Math.max(0, ...hubs.map((h) => h.plan_us_max)),
      stalls: hubs.reduce((a, h) => a + h.stalls + h.stuck, 0), timeouts: hubs.reduce((a, h) => a + h.timeouts, 0),
      segs: hubs.reduce((a, h) => a + h.segs, 0), actions: hubs.reduce((a, h) => a + h.actions, 0),
      ringDrops: hubs.reduce((a, h) => a + (h.ringDrops || 0), 0), traps: hubs.filter((h) => h.trap).map((h) => h.seed), perHub: hubs };
    // Lockstep: sim-minutes per wall-minute in place of lateness, and rates per simulated second.
    const secs = ls ? (list[0].simMs - simMs) / 1000 : wall / 1000, A = agg.diag;
    if (ls) { agg.speed = +(secs * 1000 / wall).toFixed(2); simMs = list[0].simMs; for (const k of ['p50', 'p99', 'max', 'work']) delete agg[k]; }
    minutesAgg.push(agg);
    console.log('  ' + [String(minute).padStart(3), String(n).padStart(5), ...(ls ? [String(agg.speed).padStart(8)] : [agg.p50.toFixed(2).padStart(6),
      agg.p99.toFixed(2).padStart(6), agg.max.toFixed(1).padStart(6), String(agg.work).padStart(6)]), String(agg.cpu).padStart(5), String(agg.sysCpu).padStart(5), String(agg.rssMB).padStart(7),
      String(agg.wasmMB).padStart(7), ((A.plans || 0) / secs).toFixed(0).padStart(8), String(A.anomalies || 0).padStart(6),
      String(A.failures || 0).padStart(6), String(Object.values(agg.nacks).reduce((a, b) => a + b, 0)).padStart(6),
      String(Object.values(agg.reaps).reduce((a, b) => a + b, 0)).padStart(6), String(agg.stalls).padStart(7),
      String(agg.traps.length).padStart(6)].join(' '));
  }
  const steady = minutesAgg.filter((m) => m.minute > 0);
  const med = (k) => { const v = (steady.length ? steady : minutesAgg).map((m) => m[k]).sort((a, b) => a - b); return v[v.length >> 1] ?? NaN; };
  const flagged = done.filter((h) => h.flags.length);
  const xfail = done.flatMap((h) => h.xfail.map((x) => ({ ...x, hub: h.seed })));
  const homeOsc = done.reduce((a, h) => sum(a, h.homeOsc), {});
  const kinds = {};
  for (const h of flagged) for (const f of h.flags) (kinds[f.kind] = kinds[f.kind] || []).push(h.seed);
  const coverage = done.reduce((a, h) => sum(a, h.actions), {});
  // Anomalies by kind on clean hubs (no injected latency, loss, reorder or plan delay, one client): what a
  // real hub should reproduce, so the candidates for a replay on the P4, most of each kind first.
  const KINDS = ['anom_settle', 'anom_endvel_clamped', 'anom_knot_trimmed', 'anom_dwell_zeroed', 'anom_knot_refused', 'anom_piece_over_ceiling', 'failures'];
  const cleanHubs = done.filter((h) => h.clean && h.clients === 1 && h.diag);
  const candidates = Object.fromEntries(KINDS.map((k) => [k, cleanHubs.filter((h) => h.diag[k] > 0).sort((a, b) => b.diag[k] - a.diag[k]).slice(0, 5).map((h) => [h.seed, h.diag[k]])]));
  const anomBy = (hs) => hs.reduce((a, h) => sum(a, Object.fromEntries(KINDS.map((k) => [k, (h.diag || {})[k] || 0]))), {});
  const split = { clean: { hubs: cleanHubs.length, ...anomBy(cleanHubs) }, impaired: { hubs: done.length - cleanHubs.length, ...anomBy(done.filter((h) => !cleanHubs.includes(h))) } };
  const step = { mode: ls ? 'lockstep' : 'realtime', hubs: n, workers: W, perWorker, minutes,
    ...(ls ? { speed: med('speed') } : { p50: med('p50'), p99: med('p99'), work: med('work') }), cpu: med('cpu'), sysCpu: med('sysCpu'),
    rssMB: Math.max(0, ...minutesAgg.map((m) => m.rssMB)), wasmMB: Math.max(0, ...minutesAgg.map((m) => m.wasmMB)),
    healthy: (ls || med('p99') <= HEALTHY_P99_MS) && !kinds.trap, flags: kinds, xfailCount: xfail.length, homeOsc, coverage, split, candidates,
    minutes_detail: minutesAgg.map(({ perHub, ...m }) => m), flagged, xfail: xfail.slice(0, 200),
    results: done.reduce((a, h) => sum(a, h.results), {}) };
  console.log('  -> ' + (ls ? `LOCKSTEP, ${step.speed} sim-min per wall-min (median minute)` : `p99 ${step.p99} ms (median minute, worst worker), work ${step.work} %`)
    + `, cpu ${step.cpu} % (host ${step.sysCpu} %), rss ${step.rssMB} MB, ${step.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  console.log('     flags: ' + (Object.entries(kinds).map(([k, v]) => k + ' x' + v.length + ' (seed ' + v.slice(0, 5).join(',') + ')').join('; ') || 'none'));
  const logs = minutesAgg.reduce((a, m) => sum(a, m.logs), {});
  step.hubLog = Object.fromEntries(Object.entries(logs).sort((a, b) => b[1] - a[1]));
  console.log('     hub warn/error lines: ' + Object.entries(step.hubLog).filter(([k]) => !/valencesim:/.test(k)).slice(0, 10).map(([k, v]) => v + ' x ' + k).join(' | '));
  console.log('     anomalies, clean hubs: ' + JSON.stringify(split.clean));
  console.log('     anomalies, impaired hubs: ' + JSON.stringify(split.impaired));
  console.log(`     home while oscillating: ${homeOsc.tried || 0} tried, ${homeOsc.refused || 0} refused, ${homeOsc.accepted || 0} accepted (xfail, val-dzf)`);
  return { step, perHubMinutes: minutesAgg.map((m) => ({ minute: m.minute, hubs: m.perHub })) };
}

/**
 * Lockstep: one virtual millisecond per pass, and the clock every caller reads (performance.now, Date.now,
 * setTimeout, setInterval, Math.random seeded) is that one. The hub ticks to it, the links pump, due timers
 * fire, the clients step, and every promise settles before the next millisecond: a seed replays the same run,
 * but for the session ids the hub mints from its own entropy.
 * Installed before anything that reads the time is built. A timer runs in the async context that set it, and
 * Math.random draws from that context's hub's stream (--lockstep), or the clock's own outside any (--replay).
 */
function virtualClock(seed) {
  const realImmediate = globalThis.setImmediate, base = Date.now();
  const timers = new Map();
  let id = 1;
  const vc = { now: 0, rand: hubRand(seed), settle: () => new Promise((r) => realImmediate(r)) };
  const add = (fn, ms, a, every) => { const i = id++; timers.set(i, { at: vc.now + Math.max(0, Number(ms) || 0), fn, a, every, ctx: als.getStore() }); return i; };
  performance.now = () => vc.now;
  Date.now = () => base + vc.now;
  Math.random = () => (als.getStore() || vc).rand();
  globalThis.setTimeout = (fn, ms, ...a) => add(fn, ms, a, 0);
  globalThis.setInterval = (fn, ms, ...a) => add(fn, ms, a, Math.max(1, Number(ms) || 1));
  globalThis.clearTimeout = globalThis.clearInterval = (i) => timers.delete(i);
  vc.fire = () => {
    const due = [...timers].filter(([, t]) => t.at <= vc.now).sort((x, y) => x[1].at - y[1].at || x[0] - y[0]);
    for (const [i, t] of due) {
      if (!timers.has(i)) continue;
      if (t.every) t.at += t.every; else timers.delete(i);
      if (t.ctx) als.run(t.ctx, t.fn, ...t.a); else t.fn(...t.a);
    }
  };
  return vc;
}

/** Each hub's work runs in its own context (h.ctx; none for --replay), in the order a lone hub's would. */
async function lockstep(vc, hubs, minutes, onMinute) {
  const tickHub = (h, t) => {
    if (h.n && !h.n.trap) { h.n.tick(t * 1000 + 1e6); h.n.drain(); if (h.n.trap) h.rec.flags.push({ kind: 'trap', detail: String(h.n.trap), seed: h.seed }); }
    for (const c of h.clients) for (const s of c.W.all) s.pump(t);
  };
  const stepHub = (h, t) => { for (const c of h.clients) c.step(t); };
  const closeHub = (h) => { for (const c of h.clients) c.close(); };
  const end = minutes * 60000;
  for (let t = 1; t <= end; t++) {
    vc.now = t;
    for (const h of hubs) als.run(h.ctx, tickHub, h, t);
    vc.fire();
    if (t % 10 === 0) for (const h of hubs) als.run(h.ctx, stepHub, h, t);
    await vc.settle();
    if (t % 60000 === 0 || t === end) onMinute({ minute: Math.ceil(t / 60000) - 1, simMs: t, hubs: hubs.map(minuteOf) });
  }
  for (const h of hubs) als.run(h.ctx, closeHub, h);
  for (let i = 0; i < 50; i++) { vc.now++; vc.fire(); await vc.settle(); }
}

async function replay(seed) {
  const minutes = Number(argOf('--minutes', 3));
  const hwSafe = argv.includes('--hw-safe');
  const t = argOf('--target', null);
  let target = null;
  if (t) {
    const u = new URL(t);
    const { mintUiToken } = await import('../../../Valence/clients/js/credentials.js');
    const http = Number(argOf('--http', 80));
    target = { url: u.href, host: u.hostname, port: Number(u.port || 80), token: () => mintUiToken({ host: u.hostname, http }) };
  }
  const module = target ? null : new WebAssembly.Module(wasmBytes());
  const vc = target || argv.includes('--realtime') ? null : virtualClock(seed);
  // --like TRACE: start from the settings that run found (its first 'cfg' record per channel), see compare.mjs.
  let preset = null;
  if (argOf('--like')) {
    const like = JSON.parse(readFileSync(argOf('--like'), 'utf8'));
    preset = new Map();
    for (const e of like.clients[0].trace) if (e[1] === 'cfg' && !preset.has(e[2][0])) preset.set(e[2][0], e[2][1]);
  }
  const h = await makeHub(seed, module, { hwSafe, record: true, target, ...REPLAY_RATES, preset });
  console.log(`Neutrino cluster replay: seed ${seed} on ${t || 'Neutrino ' + (h.n.version || '')}: options ${JSON.stringify(h.rec.opts)}, clients ${h.clients.map((c) => c.seed).join(',')}${hwSafe || t ? ', hw-safe' : ''}, ${minutes} min`);
  const mins = [];
  const onMinute = (m) => { mins.push(m); console.log(`  minute ${m.minute}: ${vc ? 'lockstep' : 'p99 ' + m.p99 + ' ms'}, plans ${m.hubs[0].diag.plans || 0}, anomalies ${m.hubs[0].diag.anomalies || 0}, nacks ${JSON.stringify(m.hubs[0].nacks)}`); };
  if (vc) await lockstep(vc, [h], minutes, onMinute);
  else await new Promise((res) => runLoop([h], { minutes, onMinute, onEnd: res }));
  const out = argOf('--out', join(EVID, `replay-${seed}-${t ? 'hw' : hwSafe ? 'neutrino-hwsafe' : 'neutrino'}-${Date.now()}.json`));
  mkdirSync(dirname(out), { recursive: true });
  const doc = { seed, target: t || 'neutrino', version: h.n ? h.n.version : null, hwSafe: hwSafe || !!t, lockstep: !!vc, opts: h.rec.opts, minutes,
    flags: h.rec.flags, logs: h.rec.logs, perMinute: mins.map((m) => m.hubs[0]),
    clients: h.clients.map((c) => ({ seed: c.seed, traits: c.traits, stats: c.stats, trace: c.trace })) };
  writeFileSync(out, JSON.stringify(doc));
  console.log('flags: ' + (h.rec.flags.map((f) => f.kind + ' (' + f.detail + ')').join('; ') || 'none'));
  console.log('xfail: ' + (h.clients.flatMap((c) => c.stats.xfail).map((x) => x.case + ' @' + x.t + ' ms').join('; ') || 'none'));
  console.log('trace: ' + out);
  process.exit(0);
}

if (isMainThread) {
  if (argv.includes('--replay')) await replay(Number(argOf('--replay')));
  const perWorker = Number(argOf('--per-worker', 32));
  const minutes = Number(argOf('--minutes', 5));
  const seed0 = Number(argOf('--seed', 1));
  const tickUs = Number(argOf('--tick-us', 1000));
  const ls = argv.includes('--lockstep');
  const ramp = argOf('--ramp', null) ? argOf('--ramp').split(',').map(Number) : [Number(argOf('--hubs', 32))];
  const dir = join(EVID, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const steps = [];
  for (const n of ramp) {
    const { step, perHubMinutes } = await runStep(n, minutes, { perWorker, seed0, tickUs, lockstep: ls });
    steps.push(step);
    writeFileSync(join(dir, `step-${n}.json`), JSON.stringify({ ...step, perHubMinutes }));
  }
  const healthy = steps.filter((s) => s.healthy);
  const knee = ls ? null : steps.find((s) => !s.healthy);
  const long = Number(argOf('--long', 0));
  let longRun = null;
  if (long && healthy.length) {
    const n = Math.max(...healthy.map((s) => s.hubs));
    const { step, perHubMinutes } = await runStep(n, long, { perWorker, seed0, tickUs, label: `LONG ${n} hubs`, lockstep: ls });
    longRun = step;
    writeFileSync(join(dir, `long-${n}.json`), JSON.stringify({ ...step, perHubMinutes }));
  }
  const strip = ({ minutes_detail, flagged, xfail, ...s }) => s;
  const summary = { at: new Date().toISOString(), mode: ls ? 'lockstep' : 'realtime', cores: availableParallelism(),
    healthyP99Ms: ls ? null : HEALTHY_P99_MS, steps: steps.map(strip),
    knee: knee ? knee.hubs : null, largestHealthy: healthy.length ? Math.max(...healthy.map((s) => s.hubs)) : null, long: longRun && strip(longRun) };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(ls ? '\nNeutrino cluster ramp, LOCKSTEP: virtual time, no tick lateness; sim/wall is sim-minutes per wall-minute\n hubs  workers  sim/wall  cpu%  host%   rssMB  healthy  flags'
    : '\nNeutrino cluster ramp\n hubs  workers  p50ms  p99ms  work%  cpu%  host%   rssMB  healthy  flags');
  for (const s of [...steps, ...(longRun ? [longRun] : [])]) console.log(' ' + [String(s.hubs).padStart(4), String(s.workers).padStart(8),
    ...(ls ? [String(s.speed).padStart(8)] : [s.p50.toFixed(2).padStart(6), s.p99.toFixed(2).padStart(6), String(s.work).padStart(6)]),
    String(s.cpu).padStart(5), String(s.sysCpu).padStart(6), String(s.rssMB).padStart(7), (s.healthy ? 'yes' : 'NO').padStart(8),
    ' ' + (Object.entries(s.flags).map(([k, v]) => k + ' x' + v.length).join(', ') || '-')].join(' '));
  console.log((ls ? 'lockstep: no timing knee' : 'knee: ' + (knee ? knee.hubs + ' hubs' : 'none up to ' + ramp.at(-1))) + '; results: ' + dir);
  process.exit(0);
}
