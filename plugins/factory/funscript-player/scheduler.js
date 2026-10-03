// scheduler.js -- funscript spans to execution-time segments; the only caller of api.submitSegments
// Contract: CONTRACT.md, module scheduler (ph-smvd.4, playback ph-smvd.12); design: docs/plugins/FUNSCRIPT.md,
// Sync, Safety and Playback.
//
// Constraints:
// - Span k (knot k-1 -> k) is stamped from the clock's one map, so each start is the previous
//   end. The cursor advances by SegResult.sent only: each span is sent once.
// - Never resumes, never sends a safety op: tick, stop and preroll are the only motion.
// - setTransform, setHome and setLoop are pending until restart; preroll reads the pending ones
//   (the ones Play runs with).
// - restart and stop read the machine's script time as mediaAt(now - offset): the offset is
//   wall ms, so it scales with the rate. The offset in force is T.offsetMs - compMs.
// - RATE_EXCEEDED thins only the unsent tail from knot cursor-1 on, so the knot already sent
//   keeps its time and the tiling holds. A restart drops the thinning.
// - log(msg, level) is api.log's shape; a repeated reason is logged once.
// - Loop: the clock runs in unrolled media time (clock.js createLoop). The seam span goes from
//   the last knot before b to the first knot after a, so the rail never jumps; it departs from
//   the authored line by that one span.
// - Home inserts knots into the script copy the scheduler sends, never into the shown Script,
//   and only while playing: a pause stays a hold ending at rest (never motion the operator did
//   not start). Every home move is a plain segment through submit.
// - A seek transition is one segment from now to the script's position transitionMs later;
//   the next span starts at its end, so the tiling holds and no knot moves.
// - Compensation: lag = plan start (arrival - plan.elapsed, the least of a plan's samples)
//   minus the sent atMs. It is measured against the stamp, so it does not depend on compMs:
//   no feedback loop. It includes the STATE frame's one-way transport, which it cannot see.
// - The low latency lead caps the offer at LEAD_LOW_MS (RFC-087 item 3: a low-latency client
//   stamps 50 ms ahead under the same horizon); it shrinks the stall tolerance to about 30 ms.

import { posAt, indexAfter, speedAt, thin } from './funscript.js';

export const STOP_MS = 200, PREROLL_MIN_MS = 400, PREROLL_STROKE_MS = 1200, PREROLL_SKIP = 0.05, OFFER_MAX = 32;
export const TRANSIENT = Object.freeze(new Set(['waiting for the stream grant', 'NO_CLOCK', 'NOT_SENT', 'RATE_EXCEEDED']));
export const HOME_MIN_MS = 400, LEAD_LOW_MS = 50;
export const COMP_MAX_MS = 100, COMP_STEP_MS = 2, LAG_WINDOW = 32, LAG_MIN = 8, LAG_MATCH_MS = 100;

const T0 = Object.freeze({ offsetMs: 0, lo: 0, hi: 1, invert: false });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function applyT(norm, T) {
  return T.lo + (T.invert ? 1 - norm : norm) * (T.hi - T.lo);
}

/** Display only (SPEC §9.6): the authored chord speed scaled by the range. */
export function strokeSpeed(script, mediaMs, T, spanMm) {
  const s = speedAt(script, mediaMs) * (T.hi - T.lo);
  return spanMm > 0 ? { v: s * spanMm, unit: 'mm/s' } : { v: s * 100, unit: '%/s' };
}

/**
 * The script with home moves: a gap of at least afterMs + both moves follows the line for afterMs,
 * moves to point, waits, and returns to land on the next action at its time. Before the first action
 * the gap runs from 0; after the last, one move home. A move takes |delta| / speed s, at least
 * HOME_MIN_MS. home: {afterMs, point: 0..1 of the script, speed: norm/s} | null.
 * actions: the Script whose actions define the gaps (the parsed file when `script` is a shaped copy,
 * interp.js); its every action must be a knot of `script`. Knots of `script` inside a homed gap after
 * afterMs are replaced.
 */
export function withHome(script, home, actions = script) {
  if (!script || !home || !(home.afterMs > 0) || !(home.speed > 0)) return script;
  const move = (d) => Math.max(HOME_MIN_MS, Math.abs(d) * 1000 / home.speed);
  const src = script.at[0] > 0 ? { at: [0, ...script.at], pos: [script.pos[0], ...script.pos] } : script;
  const A = actions.at[0] > 0 ? [0, ...actions.at] : actions.at;
  const gaps = [];
  for (let k = 1; k < A.length; k++) {
    const w = A[k - 1] + home.afterMs, t1 = A[k];
    const line = posAt(src, w), p1 = posAt(src, t1);
    const tIn = w + move(home.point - line), tOut = t1 - move(p1 - home.point);
    if (tOut >= tIn) gaps.push({ w, line, tIn, tOut, t1 });
  }
  const at = [], pos = [];
  const n = src.at.length;
  for (let i = 0, g = 0; i < n;) {
    if (g < gaps.length && src.at[i] >= gaps[g].w) {
      const q = gaps[g++];
      at.push(q.w, q.tIn); pos.push(q.line, home.point);
      if (q.tOut > q.tIn) { at.push(q.tOut); pos.push(home.point); }
      while (i < n && src.at[i] < q.t1) i++;
    } else { at.push(src.at[i]); pos.push(src.pos[i]); i++; }
  }
  const last = at[at.length - 1], pl = pos[pos.length - 1];
  at.push(last + home.afterMs, last + home.afterMs + move(home.point - pl));
  pos.push(pl, home.point);
  return { ...script, at: Float64Array.from(at), pos: Float32Array.from(pos), durationMs: at[at.length - 1] };
}

/** Knots in unrolled time: lap 0 runs to b, each later lap repeats the knots inside (a, b), the last plays on. */
function timeline(src, loop) {
  const { at, pos } = src, n = at.length;
  const plain = { n, t: (j) => at[j], p: (j) => pos[j], idx: (j) => j, after: (u) => indexAfter(src, u) };
  if (!loop) return plain;
  const L = loop.b - loop.a, iA = indexAfter(src, loop.a);
  let iB = indexAfter(src, loop.b);
  if (iB > 0 && at[iB - 1] === loop.b) iB--;
  const len = iB - iA, c = loop.count;
  if (len < 1) return plain;
  const total = c ? iB + (c - 2) * len + (n - iA) : Infinity;
  const at_ = (j) => {
    if (j < iB) return [0, j];
    const r = j - iB, lap = 1 + Math.floor(r / len);
    return c && lap >= c - 1 ? [c - 1, iA + r - (c - 2) * len] : [lap, iA + (r % len)];
  };
  return {
    n: total,
    t: (j) => { const [lap, i] = at_(j); return at[i] + lap * L; },
    p: (j) => pos[at_(j)[1]],
    idx: (j) => at_(j)[1],
    after(u) {
      if (u < loop.b) return indexAfter(src, u);
      const lap = 1 + Math.floor((u - loop.b) / L);
      if (c && lap >= c - 1) return iB + (c - 2) * len + indexAfter(src, u - (c - 1) * L) - iA;
      return iB + (lap - 1) * len + indexAfter(src, u - lap * L) - iA;
    },
  };
}

export function createScheduler({ submit, now = () => performance.now(), log = () => {} }) {
  let script = null, acts = null, src = null, tl = null, T = T0, next = T0, thinnedFor = 0, thinFrom = Infinity, lastReason = '';
  let home = null, nextHome = null, loop = null, nextLoop = null, low = false, auto = false, comp = 0;
  let lead = null, joinAt = null, pre = null;
  const sentLog = [], lags = [];
  let plan = null;
  const sch = { cursor: 0, skipped: 0 };

  const done = (sent = 0) => ({ ok: true, sent, reason: '', fatal: false });
  const off = () => T.offsetMs - comp;
  const scriptNow = (clock) => clock.mediaAt(now() - off());

  function build() {
    src = withHome(script, home, acts);
    tl = src ? timeline(src, loop) : null;
    thinnedFor = 0; thinFrom = Infinity;
  }
  function posV(u) {
    const j = tl.after(u);
    if (j <= 0) return tl.p(0);
    if (j >= tl.n) return tl.p(tl.n - 1);
    const t0 = tl.t(j - 1), t1 = tl.t(j);
    return tl.p(j - 1) + (tl.p(j) - tl.p(j - 1)) * ((u - t0) / (t1 - t0));
  }
  function supersede(t) {
    for (let i = sentLog.length - 1; i >= 0; i--) if (sentLog[i].atMs >= t) sentLog.splice(i, 1);
  }

  function result(r) {
    if (r.ok) { lastReason = ''; return done(r.sent); }
    const reason = r.reason || 'refused';
    const fatal = !TRANSIENT.has(reason);
    if (reason !== lastReason) log('motion: ' + reason, fatal ? 'warn' : 'info');
    lastReason = reason;
    return { ok: false, sent: 0, reason, fatal };
  }

  function rethin(rateHz) {
    const tPrev = tl.t(sch.cursor - 1);
    const c = tl.idx(sch.cursor - 1);
    const tail = thin({ ...src, at: src.at.subarray(c), pos: src.pos.subarray(c) }, 1000 / rateHz);
    const at = new Float64Array(c + tail.at.length);
    const pos = new Float32Array(c + tail.pos.length);
    at.set(src.at.subarray(0, c)); at.set(tail.at, c);
    pos.set(src.pos.subarray(0, c)); pos.set(tail.pos, c);
    log('motion: thinned to ' + rateHz + ' Hz, ' + (src.at.length - at.length) + ' actions dropped', 'info');
    src = { ...src, at, pos };
    tl = timeline(src, loop);
    sch.cursor = Math.max(1, tl.after(tPrev));
    thinnedFor = rateHz; thinFrom = c;
  }

  function closePlan(p) {
    let best = -1, bd = LAG_MATCH_MS;
    sentLog.forEach((g, i) => {
      const d = Math.abs(p.start - g.atMs);
      if (Math.abs(g.durationMs - p.dur) <= 1 && d < bd) { bd = d; best = i; }
    });
    if (best < 0) return;
    lags.push(p.start - sentLog[best].atMs);
    if (lags.length > LAG_WINDOW) lags.shift();
    sentLog.splice(best, 1);
  }

  Object.assign(sch, {
    /** actions: the parsed Script when s is a shaped copy (interp.js); home finds its gaps there. */
    load(s, actions = s) {
      script = s || null; acts = script && actions ? actions : script;
      build();
      sch.cursor = 1; sch.skipped = 0; lastReason = ''; lead = null; joinAt = null; pre = null;
    },
    setTransform(t) { next = { ...T0, ...t }; },
    /** {afterMs, point, speed} | null */
    setHome(h) { nextHome = h || null; pre = null; },
    /** loopSpec(...) | null, in the clock's unrolled media time */
    setLoop(l) { nextLoop = l || null; },
    /** {low, auto}: low caps the offer at LEAD_LOW_MS; auto feeds the measured lag into the offset. */
    setLatency(o = {}) { low = !!o.low; auto = !!o.auto; },
    /** One plan strip sample: arrival performance.now() ms, plan.elapsed and plan.duration in ms. */
    observePlan(arrivalMs, elapsedMs, durationMs) {
      if (![arrivalMs, elapsedMs, durationMs].every(Number.isFinite) || durationMs <= 0) return;
      const start = arrivalMs - elapsedMs;
      if (plan && Math.abs(plan.dur - durationMs) < 0.01 && Math.abs(plan.start - start) < 15) {
        plan.start = Math.min(plan.start, start);
        return;
      }
      if (plan) closePlan(plan);
      plan = { start, dur: durationMs };
    },
    /** transitionMs > 0 (a seek): one segment to where the script is transitionMs from now, then on. */
    restart(clock, transitionMs = 0) {
      T = next; home = nextHome; loop = nextLoop;
      build();
      lead = null; joinAt = null;
      supersede(now());
      if (!script) return;
      const u = clock.ready ? scriptNow(clock) : NaN;
      if (!Number.isFinite(u)) { sch.cursor = 1; return; }
      if (transitionMs > 0) {
        const t = now(), uEnd = clock.mediaAt(t + transitionMs - off());
        lead = { atMs: t, norm: applyT(posV(uEnd), T), durationMs: transitionMs };
        sch.cursor = Math.max(1, tl.after(uEnd));
        joinAt = t + transitionMs;
      } else sch.cursor = Math.max(1, tl.after(u));
    },
    tick(clock) {
      if (!src) return done();
      if (!clock.ready) return result({ ok: false, reason: 'NO_CLOCK' });
      const lag = sch.lagMs;
      const want = auto && Number.isFinite(lag) ? clamp(lag, -COMP_MAX_MS, COMP_MAX_MS) : 0;
      if (Math.abs(want - comp) >= COMP_STEP_MS || (want === 0 && comp !== 0)) {
        log('motion: latency compensation ' + want.toFixed(1) + ' ms', 'info');
        comp = want;
        sch.restart(clock);
      }
      const t = now(), o = off(), n = tl.n;
      if (lead && lead.atMs + lead.durationMs <= t) lead = null;
      while (!lead && sch.cursor < n && clock.displayAt(tl.t(sch.cursor)) + o <= t) { sch.cursor++; sch.skipped++; joinAt = null; }
      const list = lead ? [lead] : [];
      for (let k = sch.cursor; k < n && list.length < OFFER_MAX; k++) {
        const join = k === sch.cursor && joinAt != null;
        const atMs = join ? joinAt : clock.displayAt(tl.t(k - 1)) + o;
        if (low && atMs > t + LEAD_LOW_MS) break;
        list.push({ atMs, norm: applyT(tl.p(k), T),
          durationMs: join ? clock.displayAt(tl.t(k)) + o - joinAt : (tl.t(k) - tl.t(k - 1)) / clock.rate });
      }
      if (!list.length) return done();
      const r = submit(list);
      if (r.ok) {
        for (const g of list.slice(0, r.sent)) if (g.atMs >= t + 2) sentLog.push({ atMs: g.atMs, durationMs: g.durationMs });
        while (sentLog.length > 512 || (sentLog.length && sentLog[0].atMs < t - 5000)) sentLog.shift();
        let k = r.sent;
        if (lead && k > 0) { lead = null; k--; }
        if (k > 0) { sch.cursor += k; joinAt = null; }
      } else if (r.reason === 'RATE_EXCEEDED' && r.rateHz > 0 && (r.rateHz !== thinnedFor || tl.idx(sch.cursor - 1) < thinFrom)) rethin(r.rateHz);
      return result(r);
    },
    stop(clock) {
      if (!script) return done();
      if (!clock.ready) return result({ ok: false, reason: 'NO_CLOCK' });
      const t = now();
      supersede(t);
      lead = null; joinAt = null;
      const m = scriptNow(clock);
      const k = tl.after(m);
      const d = k < tl.n ? Math.min(STOP_MS, (tl.t(k) - m) / clock.rate) : STOP_MS;
      return result(submit([{ atMs: t, norm: applyT(posV(m + d * clock.rate), T), durationMs: d }]));
    },
    preroll(mediaMs, hereNorm) {
      if (!script) return null;
      if (!pre) pre = withHome(script, nextHome, acts);
      const target = applyT(posAt(pre, mediaMs), next);
      const delta = Number.isFinite(hereNorm) ? Math.abs(hereNorm - target) : 1;
      if (Number.isFinite(hereNorm) && delta <= PREROLL_SKIP) return null;
      return { atMs: now(), norm: target, durationMs: PREROLL_MIN_MS + PREROLL_STROKE_MS * delta };
    },
  });
  // Object.assign would copy a getter's value once: these stay live.
  Object.defineProperties(sch, {
    lagMs: { get: () => (lags.length >= LAG_MIN ? median(lags) : NaN) },
    compMs: { get: () => comp },
  });
  return sch;
}
