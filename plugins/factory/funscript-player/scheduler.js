// scheduler.js -- funscript spans to execution-time segments; the only caller of api.submitSegments
// Contract: CONTRACT.md, module scheduler (ph-smvd.4, playback ph-smvd.12); design: docs/plugins/FUNSCRIPT.md,
// Sync, Safety and Playback.
//
// Constraints:
// - Span k (knot k-1 -> k) is stamped from the clock's one map, so each start is the previous
//   end. The cursor advances by SegResult.sent only: each span is sent once.
// - Never resumes, never sends a safety op: tick, stop, preroll and home are the only motion.
// - setTransform and setLoop are pending until restart; preroll and home read the pending ones
//   (the ones Play runs with).
// - restart and stop read the machine's script time as mediaAt(now - offset): the offset is
//   wall ms, so it scales with the rate. The offset in force is T.offsetMs - compMs.
// - RATE_EXCEEDED thins only the unsent tail from knot cursor-1 on, so the knot already sent
//   keeps its time and the tiling holds. A restart drops the thinning.
// - log(msg, level) is api.log's shape; a repeated reason is logged once.
// - Loop: the clock runs in unrolled media time (clock.js createLoop). The seam span goes from
//   the last knot before b to the first knot after a, so the rail never jumps; it departs from
//   the authored line by that one span.
// - Home is a pause behavior, never a knot while playing: a gap follows the authored line.
//   home() is one segment the caller submits once a pause has lasted afterMs.
// - A seek transition is one segment from now to the script's position transitionMs later;
//   the next span starts at its end, so the tiling holds and no knot moves.
// - Compensation: lag = plan start (arrival - plan.elapsed, the least of a plan's samples)
//   minus the sent atMs. It is measured against the stamp, so it does not depend on compMs:
//   no feedback loop. It includes the STATE frame's one-way transport, which it cannot see.
//   It is never applied below 0: a plan never starts before its stamp, so a negative lag is the plan
//   strip naming the next piece early (Nucleus val-0ep), not lateness to undo.
// - Every knot is free (endVel null): the hub expects successors for EXPECT_MS and carries the tangent
//   (Nucleus val-g62). The sender declares the rests it can see (endVel 0): the last knot, a knot whose
//   successor is over EXPECT_MS of wall time away, a loop's last knot before the wrap and the seek
//   landing. Left free, a real stop is passed moving and braked beyond (FUNSCRIPT.md, I8).
//   Stop, preroll and home end at 0.
// - A restart that changes only timing never re-sends a span the hub holds: the first unsent span
//   joins the end of what was sent and absorbs the shift.

import { posAt, indexAfter, speedAt, thin } from './funscript.js';

export const STOP_MS = 200, PREROLL_MIN_MS = 400, PREROLL_STROKE_MS = 1200, PREROLL_SKIP = 0.05, OFFER_MAX = 32;
export const TRANSIENT = Object.freeze(new Set(['waiting for the stream grant', 'NO_CLOCK', 'NOT_SENT', 'RATE_EXCEEDED']));
export const HOME_MIN_MS = 400;
export const COMP_MAX_MS = 100, COMP_STEP_MS = 2, LAG_WINDOW = 32, LAG_MIN = 8, LAG_MATCH_MS = 100;
// Registry limits.stream_quiet_release_ms (SPEC 11.4), restated: a plugin imports nothing outside its folder.
// The hub expects for the larger of it and the grant's horizon; the plugin API does not publish the horizon.
export const EXPECT_MS = 500;

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

/**
 * Knot j's endVel over accessors t(j) (media ms) and i(j) (its script index) of n knots at the clock rate:
 * 0 (a rest the sender sees) at the last knot, before a successor over EXPECT_MS of wall time away and at a
 * loop wrap (the successor is not the script's next action); else null (free, the hub's tangent).
 */
export const knotVel = (t, i, j, n, rate = 1) =>
  (j >= n - 1 || (t(j + 1) - t(j)) / rate > EXPECT_MS || i(j + 1) !== i(j) + 1 ? 0 : null);

/** Display only (SPEC §9.6): the authored chord speed scaled by the range. */
export function strokeSpeed(script, mediaMs, T, spanMm) {
  const s = speedAt(script, mediaMs) * (T.hi - T.lo);
  return spanMm > 0 ? { v: s * spanMm, unit: 'mm/s' } : { v: s * 100, unit: '%/s' };
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
  let script = null, src = null, tl = null, T = T0, next = T0, thinnedFor = 0, thinFrom = Infinity, lastReason = '';
  let nextHome = null, loop = null, nextLoop = null, auto = false, comp = 0;
  let lead = null, joinAt = null, lastEnd = null, builtFor = null, builtKey = '';
  const sentLog = [], lags = [];
  let plan = null;
  const sch = { cursor: 0, skipped: 0 };

  const done = (sent = 0) => ({ ok: true, sent, reason: '', fatal: false });
  const off = () => T.offsetMs - comp;
  const scriptNow = (clock) => clock.mediaAt(now() - off());

  const keyOf = () => JSON.stringify([T.lo, T.hi, T.invert, loop]);
  function build() {
    src = script;
    tl = src ? timeline(src, loop) : null;
    thinnedFor = 0; thinFrom = Infinity;
    builtFor = script; builtKey = keyOf();
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
    load(s) {
      script = s || null;
      build();
      sch.cursor = 1; sch.skipped = 0; lastReason = ''; lead = null; joinAt = null; lastEnd = null;
    },
    setTransform(t) { next = { ...T0, ...t }; },
    /** {point: 0..1 of the script, speed: norm/s} | null; afterMs is the caller's. */
    setHome(h) { nextHome = h || null; },
    /** loopSpec(...) | null, in the clock's unrolled media time */
    setLoop(l) { nextLoop = l || null; },
    /** {auto}: feeds the measured lag into the offset. */
    setLatency(o = {}) { auto = !!o.auto; },
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
      const was = { script: builtFor, key: builtKey, sentTo: sch.cursor, end: lastEnd, clean: !lead && !thinnedFor };
      T = next; loop = nextLoop;
      build();
      lead = null; joinAt = null; lastEnd = null;
      if (!script) return;
      const u = clock.ready ? scriptNow(clock) : NaN;
      if (!Number.isFinite(u)) { sch.cursor = 1; return; }
      const k = Math.max(1, tl.after(u)), j = was.sentTo;
      // Timing only (same knots, the sent schedule still running): the first unsent span joins its end.
      const shift = !(transitionMs > 0) && was.clean && was.script === script && was.key === builtKey && j > k && j < tl.n
        && was.end > now() ? clock.displayAt(tl.t(j - 1)) + off() - was.end : NaN;
      if (Math.abs(shift) <= (tl.t(j) - tl.t(j - 1)) / clock.rate / 2) {
        sch.cursor = j; joinAt = lastEnd = was.end;
        return;
      }
      supersede(now());
      if (transitionMs > 0) {
        const t = now(), uEnd = clock.mediaAt(t + transitionMs - off());
        const k = tl.after(uEnd);
        lead = { atMs: t, norm: applyT(posV(uEnd), T), durationMs: transitionMs, endVel: 0 };
        sch.cursor = Math.max(1, k);
        joinAt = t + transitionMs;
      } else sch.cursor = k;
    },
    tick(clock) {
      if (!src) return done();
      if (!clock.ready) return result({ ok: false, reason: 'NO_CLOCK' });
      const lag = sch.lagMs;
      const want = auto && Number.isFinite(lag) ? clamp(lag, 0, COMP_MAX_MS) : 0;
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
        list.push({ atMs, norm: applyT(tl.p(k), T), durationMs: join ? clock.displayAt(tl.t(k)) + o - joinAt : (tl.t(k) - tl.t(k - 1)) / clock.rate,
          endVel: knotVel(tl.t, tl.idx, k, tl.n, clock.rate) });
      }
      if (!list.length) return done();
      const r = submit(list);
      if (r.ok) {
        for (const g of list.slice(0, r.sent)) if (g.atMs >= t + 2) sentLog.push({ atMs: g.atMs, durationMs: g.durationMs });
        while (sentLog.length > 512 || (sentLog.length && sentLog[0].atMs < t - 5000)) sentLog.shift();
        let k = r.sent;
        if (lead && k > 0) { lead = null; k--; }
        if (k > 0) { sch.cursor += k; joinAt = null; }
        if (r.sent > 0) lastEnd = list[r.sent - 1].atMs + list[r.sent - 1].durationMs;
      } else if (r.reason === 'RATE_EXCEEDED' && r.rateHz > 0 && (r.rateHz !== thinnedFor || tl.idx(sch.cursor - 1) < thinFrom)) rethin(r.rateHz);
      return result(r);
    },
    stop(clock) {
      if (!script) return done();
      if (!clock.ready) return result({ ok: false, reason: 'NO_CLOCK' });
      const t = now();
      supersede(t);
      lead = null; joinAt = null; lastEnd = null;
      const m = scriptNow(clock);
      const k = tl.after(m);
      const d = k < tl.n ? Math.min(STOP_MS, (tl.t(k) - m) / clock.rate) : STOP_MS;
      return result(submit([{ atMs: t, norm: applyT(posV(m + d * clock.rate), T), durationMs: d, endVel: 0 }]));
    },
    preroll(mediaMs, hereNorm) {
      if (!script) return null;
      lastEnd = null;
      const target = applyT(posAt(script, mediaMs), next);
      const delta = Number.isFinite(hereNorm) ? Math.abs(hereNorm - target) : 1;
      if (Number.isFinite(hereNorm) && delta <= PREROLL_SKIP) return null;
      return { atMs: now(), norm: target, durationMs: PREROLL_MIN_MS + PREROLL_STROKE_MS * delta, endVel: 0 };
    },
    /** One move to the home point, |delta| / speed s and at least HOME_MIN_MS; null when off or already there. */
    home(hereNorm) {
      if (!script || !nextHome || !(nextHome.speed > 0)) return null;
      lastEnd = null;
      const target = applyT(nextHome.point, next);
      const delta = Number.isFinite(hereNorm) ? Math.abs(hereNorm - target) : 1;
      if (Number.isFinite(hereNorm) && delta <= PREROLL_SKIP) return null;
      return { atMs: now(), norm: target, durationMs: Math.max(HOME_MIN_MS, delta * 1000 / nextHome.speed), endVel: 0 };
    },
  });
  // Object.assign would copy a getter's value once: these stay live.
  Object.defineProperties(sch, {
    lagMs: { get: () => (lags.length >= LAG_MIN ? median(lags) : NaN) },
    compMs: { get: () => comp },
  });
  return sch;
}
