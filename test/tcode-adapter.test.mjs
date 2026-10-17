/**
 * tcode-adapter.test.mjs -- the TCode v0.4 adapter (plugins/examples/tcode-adapter): the parser, the
 * rebuilt timeline against synthetic jittered arrivals at 50 to 125 Hz (smooth, monotonic, chained,
 * under the grant's rate, robust to a pause, a seek, a stall and clock drift), the device-command
 * replies, S and G, the flush timer and the refusal path. Node only; part of npm run check.
 */
import { parseLine, createTimeline, createAdapter, TIMING, TCODE_VERSION } from '../plugins/examples/tcode-adapter/index.js';

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('parser');
{
  const l0 = (s) => parseLine(s).l0;
  ok('L05 = 0.5, short', eq(l0('L05'), { pos: 0.5, durationMs: null, speed: null, endVel: null }));
  ok('L0500I100: 0.5 over 100 ms', eq(l0('L0500I100'), { pos: 0.5, durationMs: 100, speed: null, endVel: null }));
  ok('lowercase l09999i20', eq(l0('l09999i20\r'), { pos: 0.9999, durationMs: 20, speed: null, endVel: null }));
  ok('S1000 is one axis length a second', l0('L020S1000').speed === 1 && l0('L020S10').speed === 0.01);
  ok('G is the end velocity, signed, same unit', l0('L09999I2000G-1000').endVel === -1 && l0('L05I500G+250').endVel === 0.25);
  ok('easing tolerated, no end velocity', eq(l0('L0999I2000<>'), { pos: 0.999, durationMs: 2000, speed: null, endVel: null })
    && l0('L05I100>').durationMs === 100 && l0('L05I100<G0').endVel === 0);
  ok('G on a short command is ignored; I0 is short', l0('L05G100').endVel === null && l0('L05I0').durationMs === null);
  ok('a later L0 in the line overwrites', l0('L01I10 R05 L09I30').pos === 0.9 && l0('L01I10 R05 L09I30').durationMs === 30);
  ok('other axes ignored', l0('R05 L19 V09 A01') === null);
  ok('junk skipped, the L0 kept', l0('xx L0 L0abc ?? L03I40 L0I5 L05Q9').pos === 0.3);
  const d = parseLine('D0 d1 D2 dstop D9 DSTOPX $L0-0000-9999');
  ok('device commands in order, unknown ones dropped', eq(d.device, ['D0', 'D1', 'D2', 'DSTOP']) && d.save && !d.l0);
  ok('empty line', eq(parseLine(''), { l0: null, device: [], save: false }));
}

// ---- synthetic sender ---------------------------------------------------------
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Arrival delay: 2 ms floor, exponential tail (mean 4 ms), 3 % spikes to +30 ms. TCP keeps order. */
const delayOf = (r) => 2 - 4 * Math.log(1 - r()) + (r() < 0.03 ? 30 * r() : 0);

/**
 * Sends `secs` of a 1 Hz stroke at `hz`, I = the nominal period. `edit(k, s)` may move the k-th
 * intended send time s (a seek, a pause, drift). Returns every line {k, s, ideal knot, arrival} and
 * what the timeline emitted, each emission tagged with the line whose knot it carries.
 */
function run(hz, { secs = 10, seed = 1, edit = (k, s) => s, stall = null, short = false, iOf = null, opts = {} } = {}) {
  const r = rng(seed), P = 1000 / hz, tl = createTimeline(opts), lines = [], out = [];
  let prevA = -Infinity, flushes = 0;
  for (let k = 0; k * P < secs * 1000; k++) {
    const s = 1000 + edit(k, k * P), knot = edit(k + 1, (k + 1) * P) + 1000;
    let a = Math.max(prevA, s + delayOf(r));
    if (stall && s >= stall.at && s < stall.at + stall.ms) a = Math.max(a, stall.at + stall.ms + 1);
    prevA = a;
    const pos = 0.5 + 0.4 * Math.sin(2 * Math.PI * (knot - 1000) / 1000);
    const at = tl.flushAt();
    if (at != null && at <= a) { for (const seg of tl.flush()) out.push({ ...seg, k: k - 1, sentAt: at }); flushes++; }
    const cmd = { pos, durationMs: short ? null : iOf ? iOf(s, knot) : P, speed: null, endVel: null };
    for (const seg of tl.push(cmd, a)) out.push({ ...seg, k, sentAt: a });
    lines.push({ k, s, knot, a });
  }
  return { lines, out, tl, flushes, P };
}

const std = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
/** Knot-interval jitter: each knot's interval to the previous, less the intended interval. */
function jitter(pairs) {
  const d = [];
  for (let i = 1; i < pairs.length; i++) d.push((pairs[i].t - pairs[i - 1].t) - (pairs[i].ideal - pairs[i - 1].ideal));
  return { std: std(d), max: Math.max(...d.map(Math.abs)) };
}
const after = (o, ms) => o.filter((x) => x.ideal >= ms);
const emittedKnots = ({ out, lines }) => out.map((x) => ({ t: x.atMs + x.durationMs, ideal: lines[x.k].knot }));
const stampedKnots = ({ lines, P }) => lines.map((l) => ({ t: l.a + P, ideal: l.knot }));   // the 0.1 adapter: arrival + I
function chained(out, from = 0) {
  let bad = 0;
  for (let i = Math.max(1, from); i < out.length; i++) if (!near(out[i].atMs, out[i - 1].atMs + out[i - 1].durationMs, 1e-6)) bad++;
  return bad;
}
/** Each start at or after the previous one, or a resync: a bundle that supersedes the sent tail from its start. */
const backSteps = (out) => out.filter((x, i) => i && x.atMs < out[i - 1].atMs).length;
const monotonic = (out, resyncs = 0) => backSteps(out) <= resyncs;

console.log('timeline: steady jittered streams');
for (const hz of [50, 80, 100, 125]) {
  const res = run(hz, { seed: hz });
  const before = jitter(after(stampedKnots(res), 3000)), now = jitter(after(emittedKnots(res), 3000));
  const rate = res.out.length / 10;
  ok(hz + ' Hz: knot jitter ' + before.std.toFixed(2) + ' -> ' + now.std.toFixed(3) + ' ms std, max ' + before.max.toFixed(1) + ' -> ' + now.max.toFixed(2) + ' ms',
    now.std < before.std / 10 && now.max < 2.5);
  ok(hz + ' Hz: monotonic, chained, no resync', monotonic(res.out) && chained(res.out) === 0 && res.tl.stats.resyncs === 0,
    'resyncs ' + res.tl.stats.resyncs + ', breaks ' + chained(res.out));
  ok(hz + ' Hz: ' + rate.toFixed(1) + ' segments/s, every one at least 10 ms', rate <= 41 && res.out.every((x) => x.durationMs >= 10));
  const late = res.out.filter((x) => x.atMs < x.sentAt + 20).length;
  ok(hz + ' Hz: every segment sent at least 20 ms before it starts', late === 0, late + ' late');
}

console.log('timeline: short commands chain at the measured cadence');
{
  const res = run(60, { seed: 7, short: true });
  const j = jitter(after(emittedKnots(res), 3000));
  // The first short command has no cadence yet (shortMs): the second one resyncs.
  ok('60 Hz short: knot jitter ' + j.std.toFixed(3) + ' ms std, one resync, chained after it', j.std < 0.5 && chained(res.out, 2) === 0 && res.tl.stats.resyncs === 1,
    'resyncs ' + res.tl.stats.resyncs);
}

console.log('timeline: pause');
{
  // 100 Hz, the sender stops 1 s at t = 3 s and resumes where it was.
  const res = run(100, { seed: 3, edit: (k, s) => (s >= 3000 ? s + 1000 : s) });
  const lastBefore = res.lines.filter((l) => l.s < 4000).pop();
  ok('the last knot before the pause was flushed', res.out.some((x) => x.k === lastBefore.k) && res.flushes >= 1);
  ok('one resync, at the resume', res.tl.stats.resyncs === 1);
  const resumed = res.lines.find((l) => l.a > lastBefore.a + 500);
  const first = res.out.find((x) => x.sentAt >= resumed.a);
  ok('the first segment after it starts one lead after the first line back', first && near(first.atMs, resumed.a + TIMING.leadMs, 1e-6));
  ok('monotonic across it', monotonic(res.out));
  const i = res.out.indexOf(first);
  ok('chained again after it', chained(res.out.slice(i)) === 0);
  ok('smooth again after it', jitter(after(emittedKnots(res), 6000)).std < 0.5);
}

console.log('timeline: seek');
{
  // At t = 3 s the sender seeks: its schedule restarts 120 ms later.
  const res = run(100, { seed: 4, edit: (k, s) => (s >= 3000 ? s + 120 : s) });
  ok('one resync', res.tl.stats.resyncs === 1, String(res.tl.stats.resyncs));
  ok('monotonic and chained across it', monotonic(res.out) && chained(res.out, 1) <= 1);
  ok('smooth again after it', jitter(after(emittedKnots(res), 5000)).std < 0.5);
}

console.log('timeline: schedule jumps earlier');
{
  // At t = 3 s the sender's schedule moves 100 ms earlier: the lines bunch, then run early.
  const res = run(100, { seed: 8, edit: (k, s) => (s >= 3000 ? s - 100 : s) });
  ok('one resync', res.tl.stats.resyncs === 1, String(res.tl.stats.resyncs));
  ok('one step back, where the resync supersedes the sent tail', backSteps(res.out) === 1 && chained(res.out) === 1);
  ok('smooth again after it', jitter(after(emittedKnots(res), 5000)).std < 0.5);
}

console.log('timeline: cadence change');
{
  // 100 Hz with I 10, then 50 Hz with I 20 from t = 3 s.
  const res = run(100, { seed: 9, edit: (k, s) => (s >= 3000 ? 3000 + 2 * (s - 3000) : s), iOf: (s, knot) => knot - s });
  ok('no resync: I still matches the cadence', res.tl.stats.resyncs === 0);
  ok('smooth through it', jitter(after(emittedKnots(res), 2000)).std < 0.5 && chained(res.out) === 0);
}

console.log('timeline: stalls');
{
  const short = run(100, { seed: 5, stall: { at: 4000, ms: 40 } });
  ok('40 ms, then a burst: no resync, the knots stay on the sender grid', short.tl.stats.resyncs === 0 && chained(short.out) === 0);
  ok('smooth after it', jitter(after(emittedKnots(short), 4500)).std < 0.5);
  const long = run(100, { seed: 5, stall: { at: 4000, ms: 150 } });
  ok('150 ms (past the lead), then a burst: no resync either; the door clips what is late', long.tl.stats.resyncs === 0 && chained(long.out) === 0,
    'resyncs ' + long.tl.stats.resyncs);
  ok('smooth again after it', jitter(after(emittedKnots(long), 6000)).std < 0.5);
}

console.log('timeline: clock drift');
{
  // The sender's I says 10 ms, it sends every 10.1 ms (1 % slow).
  const res = run(100, { seed: 6, edit: (k, s) => s * 1.01 });
  const k = after(emittedKnots(res), 4000), e = k.map((x) => x.t - x.ideal);
  const half = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const walk = half(e.slice(e.length / 2)) - half(e.slice(0, e.length / 2));
  ok('locked: no resync, phase holds (' + walk.toFixed(2) + ' ms between halves), knot jitter ' + jitter(k).std.toFixed(3) + ' ms std',
    res.tl.stats.resyncs === 0 && Math.abs(walk) < 1 && jitter(k).std < 0.5);
}

console.log('timeline: DSTOP');
{
  const tl = createTimeline({ rateHz: 1000 / 8 });
  tl.push({ pos: 0.2, durationMs: 100 }, 0);
  tl.push({ pos: 0.6, durationMs: 100 }, 100);
  const [b] = tl.stop(150 + TIMING.leadMs);
  // executing now: timeline 150, halfway 0.2 -> 0.6 (0.4) moving 0.004/ms; braking over 200 ms adds 0.4
  ok('one brake to rest from the planned position, starting now', b && near(b.norm, 0.8) && b.endVel === 0 && b.durationMs === TIMING.brakeMs && near(b.atMs, 150 + TIMING.leadMs));
  tl.push({ pos: 0.3, durationMs: 100 }, 5000);
  const [h] = tl.stop(5000);
  ok('nothing executing yet: a hold where the plan starts', h && near(h.norm, 0.8) && h.endVel === 0 && h.atMs === 5000);
  ok('nothing planned: no brake', tl.stop(10000).length === 0);
  const [s] = tl.push({ pos: 0.5, durationMs: 50 }, 10050);
  ok('the next line resyncs', s && near(s.atMs, 10050 + TIMING.leadMs));
}

// ---- the adapter with a stub api ----------------------------------------------
function stubApi({ segments = true, position = 0.25, refuse = null } = {}) {
  const f = (role) => ({ role });
  const fields = { 'telemetry.position': f('telemetry.position'), 'window.min': f('window.min'), 'window.max': f('window.max') };
  const values = new Map([[fields['telemetry.position'], position == null ? undefined : 10 + 100 * position], [fields['window.min'], 10], [fields['window.max'], 110]]);
  const prefs = new Map();
  const api = {
    manifest: { name: 'tcode-adapter', version: '0.2.0' }, sent: [], motion: [], logs: [], refuse,
    field: (role) => fields[role] || null,
    value: (x) => values.get(x),
    schedule: () => ({ horizonMs: 250, leadMs: 150 }),
    prefs: { get: (k) => (prefs.has(k) ? prefs.get(k) : null), set: (k, v) => prefs.set(k, v) },
    log: (msg, level = 'info') => api.logs.push({ msg, level }),
    submitSegments(list) {
      if (api.refuse) return { ok: false, sent: 0, reason: api.refuse };
      if (!segments) return { ok: false, sent: 0, reason: 'hub has no segments STREAM' };
      api.sent.push(...list);
      return { ok: true, sent: list.length, rateHz: 50 };
    },
    submitMotion(n, d) { api.motion.push([n, d]); return { ok: true }; },
  };
  return api;
}
function adapterOn(api) {
  let t = 1000;
  const timers = [];
  const ad = createAdapter(api, { now: () => t, setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); } });
  const replies = [];
  const at = (ms) => { t = ms; for (const x of timers.filter((y) => y.at <= t)) { timers.splice(timers.indexOf(x), 1); x.fn(); } };
  return { ad, replies, line: (l) => ad.onLine(l, (s) => replies.push(s)), at, timers };
}

console.log('adapter: device commands');
{
  const api = stubApi();
  const { replies, line } = adapterOn(api);
  line('D0'); line('D1'); line('D2');
  ok('D0, D1, D2 answered', eq(replies, ['Phosphor TCode adapter 0.2.0', TCODE_VERSION, 'L0 0 9999 Stroke']), JSON.stringify(replies));
  ok('D1 is the v0.4 string', TCODE_VERSION === 'TCode v0.4');
  line('$L0-0100-9000'); line('$L0-0000-9999');
  ok('$ saves ignored, logged once', api.logs.filter((l) => l.msg.startsWith('$')).length === 1 && api.sent.length === 0);
  line('L02I100'); line('L06I100');
  const n = api.sent.length;
  line('DSTOP');
  ok('DSTOP: one brake to rest, replies STOP', api.sent.length === n + 1 && api.sent[n].endVel === 0 && replies[replies.length - 1] === 'STOP');
  const quiet = stubApi(), q = adapterOn(quiet);
  q.ad.onLine('L02I100'); q.ad.onLine('DSTOP');
  ok('a host without a reply path still runs the command', quiet.sent.length === 2 && quiet.sent[1].endVel === 0);
}

console.log('adapter: S, G and the flush');
{
  const api = stubApi({ position: 0.2 });
  const { line, at } = adapterOn(api);
  line('L07S500');
  ok('S from the reported position: 0.2 -> 0.7 at 0.5/s is 1000 ms', near(api.sent[0].durationMs, 1000));
  at(2000);
  line('L03S1000');
  ok('S from the last L0: 0.7 -> 0.3 at 1/s is 400 ms', near(api.sent[1].durationMs, 400));
  const none = stubApi({ position: null }), x = adapterOn(none);
  x.line('L05S250');
  ok('no position known: a full stroke at that speed (4000 ms)', near(none.sent[0].durationMs, 4000));
  at(5000);
  line('L09I300G-500');
  ok('G rides as the end velocity in norm/s', api.sent[2].endVel === -0.5);
  at(6000);
  line('L04I8');   // under the merge floor: held for the next line, or the timer
  ok('a short segment waits', api.sent.length === 3);
  at(6000 + 8 + TIMING.flushMs);
  ok('the flush timer sends it, stretched to the floor', api.sent.length === 4 && api.sent[3].norm === 0.4 && api.sent[3].durationMs === 10);
}

console.log('adapter: refusals and the fallback');
{
  const api = stubApi({ refuse: 'paused, resume to continue' });
  const { line } = adapterOn(api);
  line('L02I50'); line('L04I50'); line('L06I50');
  ok('paused: refused, logged once', api.logs.filter((l) => l.msg === 'motion refused: paused, resume to continue').length === 1 && api.sent.length === 0);
  const old = stubApi({ segments: false });
  adapterOn(old).line('L0250I200');
  ok('no segments STREAM: submitMotion with the duration', eq(old.motion, [[0.25, 200]]));
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- tcode-adapter'));
process.exit(fails ? 1 : 0);
