// scheduler.js -- funscript spans to execution-time segments; the only caller of api.submitSegments
// Contract: CONTRACT.md, module scheduler (ph-smvd.4); design: docs/plugins/FUNSCRIPT.md, Sync and Safety.
//
// Constraints:
// - Span k (knot k-1 -> k) is stamped from the clock's one map, so each start is the previous
//   end. The cursor advances by SegResult.sent only: each span is sent once.
// - Never resumes, never sends a safety op: tick, stop and preroll are the only motion.
// - setTransform is pending until restart; preroll reads the pending T (the one Play runs with).
// - restart and stop read the machine's script time as mediaAt(now - offsetMs): the offset is
//   wall ms, so it scales with the rate.
// - RATE_EXCEEDED thins only the unsent tail from knot cursor-1 on, so the knot already sent
//   keeps its time and the tiling holds. A restart drops the thinning.
// - log(msg, level) is api.log's shape; a repeated reason is logged once.

import { posAt, indexAfter, speedAt, thin } from './funscript.js';

export const STOP_MS = 200, PREROLL_MIN_MS = 400, PREROLL_STROKE_MS = 1200, PREROLL_SKIP = 0.05, OFFER_MAX = 32;
export const TRANSIENT = Object.freeze(new Set(['waiting for the stream grant', 'NO_CLOCK', 'NOT_SENT', 'RATE_EXCEEDED']));

const T0 = Object.freeze({ offsetMs: 0, lo: 0, hi: 1, invert: false });

export function applyT(norm, T) {
  return T.lo + (T.invert ? 1 - norm : norm) * (T.hi - T.lo);
}

/** Display only (SPEC §9.6): the authored chord speed scaled by the range. */
export function strokeSpeed(script, mediaMs, T, spanMm) {
  const s = speedAt(script, mediaMs) * (T.hi - T.lo);
  return spanMm > 0 ? { v: s * spanMm, unit: 'mm/s' } : { v: s * 100, unit: '%/s' };
}

export function createScheduler({ submit, now = () => performance.now(), log = () => {} }) {
  let script = null, src = null, T = T0, next = T0, thinnedFor = 0, lastReason = '';
  const sch = { cursor: 0, skipped: 0 };

  const done = (sent = 0) => ({ ok: true, sent, reason: '', fatal: false });
  const scriptNow = (clock) => clock.mediaAt(now() - T.offsetMs);

  function result(r) {
    if (r.ok) { lastReason = ''; return done(r.sent); }
    const reason = r.reason || 'refused';
    const fatal = !TRANSIENT.has(reason);
    if (reason !== lastReason) log('motion: ' + reason, fatal ? 'warn' : 'info');
    lastReason = reason;
    return { ok: false, sent: 0, reason, fatal };
  }

  function rethin(rateHz) {
    const c = sch.cursor - 1;
    const tail = thin({ ...src, at: src.at.subarray(c), pos: src.pos.subarray(c) }, 1000 / rateHz);
    const at = new Float64Array(c + tail.at.length);
    const pos = new Float32Array(c + tail.pos.length);
    at.set(src.at.subarray(0, c)); at.set(tail.at, c);
    pos.set(src.pos.subarray(0, c)); pos.set(tail.pos, c);
    log('motion: thinned to ' + rateHz + ' Hz, ' + (src.at.length - at.length) + ' actions dropped', 'info');
    src = { ...src, at, pos };
    thinnedFor = rateHz;
  }

  Object.assign(sch, {
    load(s) {
      script = src = s || null;
      sch.cursor = 1; sch.skipped = 0; thinnedFor = 0; lastReason = '';
    },
    setTransform(t) { next = { ...T0, ...t }; },
    restart(clock) {
      T = next;
      src = script; thinnedFor = 0;
      if (!script) return;
      const m = clock.ready ? scriptNow(clock) : NaN;
      sch.cursor = Number.isFinite(m) ? Math.max(1, indexAfter(script, m)) : 1;
    },
    tick(clock) {
      if (!src) return done();
      if (!clock.ready) return result({ ok: false, reason: 'NO_CLOCK' });
      const { at, pos } = src;
      const n = at.length;
      const t = now();
      while (sch.cursor < n && clock.displayAt(at[sch.cursor]) + T.offsetMs <= t) { sch.cursor++; sch.skipped++; }
      const list = [];
      for (let k = sch.cursor; k < n && list.length < OFFER_MAX; k++) {
        list.push({ atMs: clock.displayAt(at[k - 1]) + T.offsetMs, norm: applyT(pos[k], T),
          durationMs: (at[k] - at[k - 1]) / clock.rate });
      }
      if (!list.length) return done();
      const r = submit(list);
      if (r.ok) sch.cursor += r.sent;
      else if (r.reason === 'RATE_EXCEEDED' && r.rateHz > 0 && r.rateHz !== thinnedFor) rethin(r.rateHz);
      return result(r);
    },
    stop(clock) {
      if (!script) return done();
      if (!clock.ready) return result({ ok: false, reason: 'NO_CLOCK' });
      const m = scriptNow(clock);
      const k = indexAfter(script, m);
      const d = k < script.at.length ? Math.min(STOP_MS, (script.at[k] - m) / clock.rate) : STOP_MS;
      return result(submit([{ atMs: now(), norm: applyT(posAt(script, m + d * clock.rate), T), durationMs: d }]));
    },
    preroll(mediaMs, hereNorm) {
      if (!script) return null;
      const target = applyT(posAt(script, mediaMs), next);
      const delta = Number.isFinite(hereNorm) ? Math.abs(hereNorm - target) : 1;
      if (Number.isFinite(hereNorm) && delta <= PREROLL_SKIP) return null;
      return { atMs: now(), norm: target, durationMs: PREROLL_MIN_MS + PREROLL_STROKE_MS * delta };
    },
  });
  return sch;
}
