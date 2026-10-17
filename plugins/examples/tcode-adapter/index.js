// tcode-adapter -- example tier-2 adapter plugin: RFC-044 rung 1, TCode v0.4
// passthrough as a CLIENT-SIDE adapter (docs/PLUGINS.md, Examples).
// Constraints:
// - The hub never sees TCode. Lines arrive from a loopback TCP listener the
//   shell opens (permission net.listen:<port>), are parsed here, and leave as
//   segments through api.submitSegments; a hub without a segments STREAM gets
//   api.submitMotion per segment instead.
// - Only the L0 (stroke) axis moves (RFC-061 item 2). Other axes are ignored.
//   I is the segment duration; S (1000 = one axis length a second, the
//   spec's definition; its own S10 example is 10x off) becomes a duration from
//   the last commanded L0, else the reported position, else a full stroke;
//   G (same unit, signed) is the end velocity; easing (<, >, <>) is
//   tolerated and sends no end velocity. A later L0 in one line overwrites an
//   earlier one.
// - Timing is rebuilt, never stamped at arrival: createTimeline chains each
//   segment onto the previous one's end and a phase-locked loop holds that
//   chain to the arrival times. Each segment starts at its timeline time plus
//   the lead, which must stay under the door's lead cap (api.schedule()).
// - Rate: a segment shorter than the grant allows (1.25 s / rateHz) is merged
//   into the next; the flush timer sends a lone last knot.
// - D0, D1, D2 are answered on the line's own connection when the host hands
//   onLine a reply function. DSTOP sends one braking segment (end velocity 0)
//   starting now from the planned position and drops the timeline. $ saves
//   are ignored.
// - Never re-arms. While the hub reports PAUSE every send is refused with
//   'paused, resume to continue' (counted, logged once, shown below); only
//   the operator's Resume lets lines move the machine again.
// - Port: 8000 (RFC-061 item 1). Loopback only (item 3).

const DEFAULT_PORT = 8000;
export const TCODE_VERSION = 'TCode v0.4';
const SEG_FLOOR_MS = 10;   // the door consumes a shorter segment (src/model/motion.js SEG_FLOOR_MS)

/**
 * Timeline defaults (ms unless named). leadMs must stay above the merge floor
 * plus 10 ms, or every line resyncs. alpha and beta are the loop's phase and
 * frequency gains, critically damped (beta = alpha^2 / 4): about 70 lines to
 * settle, arrival jitter reaches the schedule scaled by alpha. An error
 * counts at most clampMs, so a delay spike moves the schedule by alpha x clampMs.
 */
export const TIMING = Object.freeze({
  leadMs: 80, gapMs: 250, earlyMs: 50, clampMs: 10, alpha: 0.03, beta: 0.000225,
  shortMs: 100, flushMs: 20, brakeMs: 200, rateHz: 50,
});

const TOKEN = /^L0(\d+)(?:([IS])(\d+))?[<>]*(?:G([+-]?\d+))?[<>]*$/i;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * One TCode line: the last L0 command, the device commands in order, whether
 * a $ save was seen. Junk tokens are skipped.
 * l0: {pos 0..1, durationMs (I) | null, speed (S, norm/s) | null, endVel (G, norm/s) | null}
 * @returns {{l0: Object|null, device: string[], save: boolean}}
 */
export function parseLine(line) {
  const out = { l0: null, device: [], save: false };
  for (const tok of String(line).trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok[0] === '$') { out.save = true; continue; }
    const d = /^D(0|1|2|STOP)$/i.exec(tok);
    if (d) { out.device.push('D' + d[1].toUpperCase()); continue; }
    const m = TOKEN.exec(tok);
    if (!m) continue;
    const n = m[3] == null ? 0 : Number(m[3]);
    const ext = n > 0 ? m[2].toUpperCase() : '';   // I0 or S0 is a short command (reference parser)
    out.l0 = {
      pos: Number('0.' + m[1]),
      durationMs: ext === 'I' ? n : null,
      speed: ext === 'S' ? n / 1000 : null,
      endVel: ext && m[4] != null ? Number(m[4]) / 1000 : null,   // G needs I or S
    };
  }
  return out;
}

/**
 * The sender's intended timeline, rebuilt from arrivals. push() takes one
 * L0 command and its arrival time and returns the segments to send now,
 * [{atMs, norm, durationMs, endVel?}], atMs already carrying the lead.
 *
 * Constraints:
 * - Chained: a command starts where the previous one ends. The loop corrects
 *   the END (alpha x error) and the rate (beta), so starts never jump.
 * - Resync, a new chain from the arrival: the first command; an arrival more
 *   than gapMs late (a pause); a second line in a row too late to start in
 *   time (lead less the merge floor less 10 ms) arriving a half cadence or
 *   more after the first (the sender's schedule moved later, a seek); one
 *   more than earlyMs early (it moved earlier). Its bundle supersedes the
 *   sent tail from its start (SPEC 5.4, RFC-087). A stall's burst of late
 *   lines keeps the chain: the door clips their starts, the knots stay on
 *   the sender's grid.
 * - ponytail: a sender whose I runs well past its cadence resyncs every line,
 *   which is arrival stamping; tracking it would need a cadence-locked mode.
 */
export function createTimeline(opts = {}) {
  const k = { ...TIMING, ...opts };
  let locked = false, wasLate = false, end = 0, f = 0, sent = 0, pending = null, last = null, at = null;
  let prevArrival = null, cadence = 0, intervals = 0, rateHz = k.rateHz;
  const plan = [];   // emitted segments in timeline time {t0, t1, x0, x1}, newest last
  const stats = { resyncs: 0 };
  const minSeg = () => Math.max(SEG_FLOOR_MS, 1250 / rateHz);

  function emit(span) {
    // Microsecond grid: end - sent is a float difference (200 can come out 200.00000000000003).
    const durationMs = Math.round(span * 1000) / 1000;
    const seg = { atMs: sent + k.leadMs, norm: pending.norm, durationMs };
    if (pending.endVel != null) seg.endVel = pending.endVel;
    plan.push({ t0: sent, t1: sent + durationMs, x0: at == null ? pending.norm : at, x1: pending.norm });
    if (plan.length > 32) plan.shift();
    sent += durationMs;
    at = pending.norm;
    pending = null;
    return seg;
  }

  return {
    stats,
    get pending() { return !!pending; },
    get leadMs() { return k.leadMs; },
    set leadMs(v) { k.leadMs = v; },
    /** The grant's rate, from submitSegments: sets the merge floor. */
    rate(hz) { if (hz > 0) rateHz = hz; },
    /** When the pending knot must leave if no line follows, or null. */
    flushAt() { return pending ? pending.end + k.flushMs : null; },
    /** @param here the reported position 0..1 or null, for an S command with no previous L0 */
    push(cmd, a, here = null) {
      const spaced = prevArrival == null || a - prevArrival >= cadence / 2;   // not one burst
      if (prevArrival != null && a - prevArrival > 0 && a - prevArrival < k.gapMs) {
        intervals++;
        cadence += Math.max(0.02, 1 / intervals) * (a - prevArrival - cadence);   // a running mean, then slow
      }
      prevArrival = a;
      const from = last != null ? last : here;
      let dur = cmd.durationMs > 0 ? cmd.durationMs
        : cmd.speed > 0 ? (from == null ? 1 : Math.abs(cmd.pos - from)) / cmd.speed * 1000
          : cadence || k.shortMs;
      dur = Math.max(1, dur);
      const e = a - end;
      const late = e > k.leadMs - minSeg() - 10;
      if (!locked || e > k.gapMs || (late && wasLate && spaced) || e < -k.earlyMs) {
        if (locked) stats.resyncs++;
        locked = true;
        wasLate = false;
        f = 0;
        pending = null;
        while (plan.length && plan[plan.length - 1].t0 >= a) plan.pop();   // superseded
        sent = a;
        end = a + dur;
      } else {
        const ec = clamp(e, -k.clampMs, k.clampMs);
        end += dur * (1 + f) + k.alpha * ec;
        f = clamp(f + k.beta * ec / dur, -0.5, 0.5);
        wasLate = late;
      }
      pending = { norm: cmd.pos, endVel: cmd.endVel, end };
      last = cmd.pos;
      return end - sent >= minSeg() ? [emit(end - sent)] : [];
    },
    /** The pending knot as its own segment (no line followed), stretched to the door's floor. */
    flush() {
      if (!pending) return [];
      const seg = emit(Math.max(SEG_FLOOR_MS, pending.end - sent));
      end = Math.max(end, sent);
      return [seg];
    },
    /**
     * DSTOP at t: one segment starting now (the door clips it to the earliest
     * executable instant and it supersedes the sent tail), braking to rest
     * from where the plan has the carriage (timeline time t less the lead),
     * then a fresh timeline. A hold where the plan has not started yet; []
     * when it has ended.
     */
    stop(t) {
      const tau = t - k.leadMs;
      const s = plan.findLast((p) => p.t0 <= tau && tau < p.t1)
        || (plan.length && tau < plan[0].t0 ? { t0: tau, t1: tau + 1, x0: plan[0].x0, x1: plan[0].x0 } : null);
      plan.length = 0;
      locked = false;
      pending = null;
      if (!s) return [];
      const v = (s.x1 - s.x0) / (s.t1 - s.t0);   // norm/ms
      const x = s.x0 + v * (tau - s.t0);
      last = at = clamp(x + v * k.brakeMs / 2, 0, 1);
      return [{ atMs: t, norm: last, durationMs: k.brakeMs, endVel: 0 }];
    },
  };
}

function portFrom(manifest) {
  for (const p of manifest.permissions || []) {
    const m = /^net\.listen:(\d+)$/.exec(p);
    if (m) return Number(m[1]);
  }
  return DEFAULT_PORT;
}

/** The reported position as a window fraction, or null (arcade/drive.js reads it the same way). */
function here(api) {
  const p = Number(api.value(api.field('telemetry.position')));
  const lo = Number(api.value(api.field('window.min')));
  const hi = Number(api.value(api.field('window.max')));
  return Number.isFinite(p) && hi > lo ? clamp((p - lo) / (hi - lo), 0, 1) : null;
}

/**
 * The adapter behind activate(): onLine(line, reply?) per TCP line. `now` is
 * submitSegments' clock; `setTimer`/`clearTimer` run the flush.
 */
export function createAdapter(api, { now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const tl = createTimeline({ leadMs: api.prefs.get('leadMs') ?? TIMING.leadMs });
  const stats = { lines: 0, l0: 0, segments: 0, refused: 0, lastReason: '' };
  let timer = null;
  let saveLogged = false;

  function submit(segs) {
    if (!segs.length) return;
    const g = api.schedule();
    if (g && tl.leadMs > g.leadMs) tl.leadMs = g.leadMs;   // past the cap the door never sends
    let r = api.submitSegments(segs);
    if (r && r.ok) tl.rate(r.rateHz);
    else if (r && r.reason === 'hub has no segments STREAM') {
      for (const s of segs) r = api.submitMotion(s.norm, s.durationMs);
    }
    if (r && r.ok) {
      stats.segments += segs.length;
      stats.lastReason = '';
      return;
    }
    const reason = (r && r.reason) || 'refused';
    stats.refused++;
    if (reason !== stats.lastReason) api.log('motion refused: ' + reason, 'warn');
    stats.lastReason = reason;
  }

  function arm() {
    if (timer != null) clearTimer(timer);
    timer = null;
    const t = tl.flushAt();
    if (t != null) timer = setTimer(() => { timer = null; submit(tl.flush()); }, Math.max(0, t - now()));
  }

  const answers = {
    D0: () => 'Phosphor TCode adapter ' + api.manifest.version,
    D1: () => TCODE_VERSION,
    // L0 0..1 already spans the hub's window: the full range, or the window would apply twice.
    D2: () => 'L0 0 9999 Stroke',
    DSTOP: () => { submit(tl.stop(now())); arm(); return 'STOP'; },
  };

  return {
    stats,
    timeline: tl,
    onLine(line, reply) {
      stats.lines++;
      const p = parseLine(line);
      if (p.l0) {
        stats.l0++;
        submit(tl.push(p.l0, now(), p.l0.speed ? here(api) : null));
        arm();
      }
      for (const d of p.device) {
        const text = answers[d]();
        if (typeof reply === 'function') reply(text);
      }
      if (p.save && !saveLogged) { saveLogged = true; api.log('$ save commands are ignored'); }
    },
    setLead(ms) { tl.leadMs = ms; api.prefs.set('leadMs', ms); },
    close() { if (timer != null) clearTimer(timer); timer = null; },
  };
}

export function activate(api) {
  const port = portFrom(api.manifest);
  const ad = createAdapter(api);
  const { stats } = ad;
  let close = null;
  let closed = false;

  api.net.listenTcp(port, (line, reply) => ad.onLine(line, reply)).then((c) => {
    close = c;
    if (closed) c();
    else api.log('listening on 127.0.0.1:' + port);
  }).catch((e) => api.log('listen failed: ' + e.message, 'error'));

  api.registerSettings((el) => {
    const p = document.createElement('p');
    p.style.cssText = 'font-family: var(--mono); font-size: 12px; margin: 0;';
    const draw = () => {
      p.textContent = 'tcp 127.0.0.1:' + port + '  lines ' + stats.lines + '  L0 ' + stats.l0
        + '  segments ' + stats.segments + '  resyncs ' + ad.timeline.stats.resyncs
        + '  refused ' + stats.refused + (stats.lastReason ? '  (' + stats.lastReason + ')' : '');
    };
    draw();
    if (api.ui) {
      const rows = api.ui.rows({ title: 'TCode' });
      rows.append(api.ui.row({ label: 'Lead', tip: 'Added latency that absorbs arrival jitter',
        control: api.ui.stepper({ min: 50, max: 140, step: 5, unit: 'ms', value: ad.timeline.leadMs, onChange: (v) => ad.setLead(v) }) }));
      el.append(rows);
    }
    el.append(p);
    const t = setInterval(draw, 1000);
    return () => { clearInterval(t); el.replaceChildren(); };
  });

  return () => {
    closed = true;
    ad.close();
    if (close) close();
  };
}
