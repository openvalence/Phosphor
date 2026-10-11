/**
 * telebuf-sim.mjs — synthetic replay proving the render-delay fix against
 * REALISTIC arrival jitter (measured on-device via jitter-measure.mjs: mean
 * ~20-45ms, p95 45-55ms, occasional gaps to 120ms). Not part of the app.
 *
 * Simulates constant-velocity motion (10 mm/s) pushed into a telebuf at
 * irregular intervals drawn from the measured distribution, then compares
 * rAF-rendered output (a) sampled at raw "now" (the current/buggy behavior)
 * vs (b) sampled at renderClock.stableRenderTime(now) (the fix). Metric:
 * per-frame velocity implied by consecutive rendered positions — smooth
 * motion should show a tight, low-variance distribution around 10mm/s;
 * snap-and-hold shows alternating ~0 and large spikes (the "jitter").
 *
 * Also carries deterministic pass/fail assertions (below the simulation) for
 * sampleAt()'s monotone cubic (through every sample, no overshoot, slope-
 * continuous), the plan-bounded extrapolation, the comet's tail (sampleTail),
 * and — under clumped arrivals — that the extrapolation slope is measured
 * against the RECONSTRUCTED schedule rather than arrival time (webui.md T18). Exits nonzero on any assertion
 * failure.
 *
 * Run: node test/telebuf-sim.mjs
 */
import { createTelebuf, createRenderClock, chartPath, sampleTail } from '../src/ui/hero/telebuf.js';

const TRUE_VEL_MM_S = 10;
const SIM_MS = 8000;
const RAF_DT = 16.667;

// Jittered arrival intervals: mostly ~20ms, occasional gap to ~120ms,
// matching the on-device WS measurement (mean 19.5ms, p95 55.5ms, max 120ms).
function nextGapMs(rng) {
  const r = rng();
  if (r < 0.85) return 15 + rng() * 15;      // 15-30ms, the common case
  if (r < 0.97) return 30 + rng() * 30;      // 30-60ms, a slower beat
  return 60 + rng() * 60;                     // 60-120ms, a real stall
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `frameGap` is the FRAME clock, separate from the arrival clock above: a
// webview with its own rAF cadence is the only thing that differs between the
// device-served page and the Tauri shell. Defaults to a steady 60 fps.
function simulate(useDelay, frameGap, arrivalGap) {
  const rng = mulberry32(42);
  const tele = createTelebuf();
  const clock = createRenderClock();
  const gapOf = frameGap || (() => RAF_DT);
  const arriveOf = arrivalGap || nextGapMs;

  let simT = 0;       // "true" clock, ms
  let nextPushAt = 0;
  let pos = 0;

  const framePositions = [];
  let lastFrameDt = RAF_DT;

  while (simT < SIM_MS) {
    // Advance real pushes up to current sim time.
    while (nextPushAt <= simT) {
      pos = TRUE_VEL_MM_S * (nextPushAt / 1000);
      clock.noteLate(tele.push(pos, nextPushAt));
      nextPushAt += arriveOf(rng);
    }

    clock.update(lastFrameDt);
    const sampleAtT = useDelay ? clock.stableRenderTime(simT) : simT;
    const r = tele.sampleAt(sampleAtT);
    framePositions.push({ t: simT, v: r.value, holding: r.holding });

    const dt = gapOf(rng, simT);
    simT += dt;
    lastFrameDt = dt;
  }
  return framePositions;
}

function analyze(label, frames) {
  // Skip the first 200ms warm-up (buffer/delay still filling).
  const warm = frames.filter((f) => f.t > 200 && f.v != null);
  const vels = [];
  for (let i = 1; i < warm.length; i++) {
    const dv = warm[i].v - warm[i - 1].v;
    const dt = (warm[i].t - warm[i - 1].t) / 1000;
    vels.push(dv / dt);
  }
  const mean = vels.reduce((a, b) => a + b, 0) / vels.length;
  const variance = vels.reduce((a, b) => a + (b - mean) ** 2, 0) / vels.length;
  const sd = Math.sqrt(variance);
  const holds = vels.filter((v) => Math.abs(v) < 0.01).length;
  const spikes = vels.filter((v) => Math.abs(v) > TRUE_VEL_MM_S * 2).length;
  console.log(`${label}: mean implied vel=${mean.toFixed(2)}mm/s  stdev=${sd.toFixed(2)}mm/s  ` +
    `held-frames=${holds}/${vels.length} (${(100 * holds / vels.length).toFixed(1)}%)  ` +
    `spike-frames(>2x true vel)=${spikes}`);
}

console.log(`True velocity: ${TRUE_VEL_MM_S} mm/s. Arrival jitter drawn from the on-device WS measurement.\n`);
analyze('BEFORE (raw "now", no render delay)', simulate(false));
analyze('AFTER  (adaptive render-delay clock)', simulate(true));

// ---------------------------------------------------------------------------
// Deterministic assertions — the monotone cubic (src/model/interp.js) and the
// comet's tail (sampleTail). The curve passes through every sample, never
// leaves the range of a span's two samples, and is slope-continuous at a
// sample; the tail is the same curve, so it ends at the head, its length
// follows speed and it collapses at rest.
// ---------------------------------------------------------------------------

// The deterministic fixtures below hand-craft TRUSTED timestamps to probe the
// interpolation math itself, so they opt out of the arrival-time rescheduling
// (jitter regression #5) — which has its own burst-replay section further down.
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};

console.log('\ntelebuf.js — monotone cubic and tail assertions\n');

// ---- claim: slope is continuous across a shared sample boundary -----------
{
  const tele = createTelebuf({ reschedule: false });
  tele.push(0, 0);     // A
  tele.push(10, 40);   // B
  tele.push(15, 90);   // C
  tele.push(17, 130);  // D
  const d = 0.05;
  const leftSlope = (tele.sampleAt(40).value - tele.sampleAt(40 - d).value) / d;
  const rightSlope = (tele.sampleAt(40 + d).value - tele.sampleAt(40).value) / d;
  ok('slope matches across the shared A-B/B-C boundary', Math.abs(leftSlope - rightSlope) < 0.01,
     `left=${leftSlope.toFixed(4)} right=${rightSlope.toFixed(4)}`);
}

// ---- claim: two samples draw a straight line -------------------------------
{
  const tele = createTelebuf({ reschedule: false });
  tele.push(0, 0);
  tele.push(10, 40);
  const mid = tele.sampleAt(20).value;
  ok('two samples interpolate linearly', Math.abs(mid - 5) < 1e-9, `mid=${mid}`);
}

// ---- claim: through every sample, never past a span's two samples ----------
{
  const tele = createTelebuf({ reschedule: false });
  // A stroke with a reversal, a dwell, an absurd jump and uneven spacing.
  const pts = [[0, 0], [20, 3], [45, 12], [60, 30], [80, 31], [100, 31], [130, 10], [140, 1000], [150, 1001], [190, 5], [200, 4]];
  for (const [t, v] of pts) tele.push(v, t);
  let through = true, inside = true, worst = 0;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(tele.sampleAt(pts[i][0]).value - pts[i][1]) > 1e-9) through = false;
    if (i === 0) continue;
    const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
    for (let t = t0; t <= t1; t += 0.25) {
      const v = tele.sampleAt(t).value;
      const out = Math.max(Math.min(v0, v1) - v, v - Math.max(v0, v1), 0);
      if (out > 1e-9) { inside = false; worst = Math.max(worst, out); }
    }
  }
  ok('the curve passes through every sample', through);
  ok('the curve never overshoots a span (reversal, dwell, absurd jump)', inside, 'worst=' + worst);
}

// ---- claim: extrapolation stops at the plan's end --------------------------
{
  const tele = createTelebuf({ reschedule: false });
  tele.push(0, 0);
  tele.push(10, 10);   // 1 unit/ms toward the plan's end at 15
  ok('extrapolation never passes the limit', tele.sampleAt(40, {}, 15).value === 15);
  ok('extrapolation away from the limit holds at the newest sample', tele.sampleAt(40, {}, 5).value === 10);
  ok('without a limit it runs on the last secant', tele.sampleAt(40).value === 40);
}

// ---- claim: the tail is the recent path; length follows speed; rest collapses
{
  const out = new Float64Array(33);
  const tailLen = (vel, until) => {
    const tele = createTelebuf({ reschedule: false });
    for (let t = 0; t <= 1000; t += 20) tele.push(t < until ? vel * t : vel * until, t);
    const n = sampleTail(tele, 990, 150, out);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < n; k++) { lo = Math.min(lo, out[k]); hi = Math.max(hi, out[k]); }
    return { span: hi - lo, n, head: out[0], at: tele.sampleAt(990).value };
  };
  const slow = tailLen(0.1, 2000), fast = tailLen(0.3, 2000), rest = tailLen(0.3, 500);
  ok('the tail ends at the head', slow.head === slow.at);
  ok('the tail covers the last 150 ms of path', Math.abs(slow.span - 15) < 1e-6 && slow.n === 33, 'span=' + slow.span);
  ok('its length scales with speed', Math.abs(fast.span / slow.span - 3) < 1e-6, slow.span + ' -> ' + fast.span);
  ok('at rest it collapses to the head', rest.span === 0, 'span=' + rest.span);

  const tele = createTelebuf({ reschedule: false });
  tele.push(0, 0); tele.push(10, 20); tele.push(50, 420); tele.push(60, 440);
  const n = sampleTail(tele, 440, 150, out, null, 250);
  ok('the tail stops at a dropout, never a guessed curve across it', n > 0 && n < 33 && out[n - 1] >= 50, 'points=' + n);
}

// ---------------------------------------------------------------------------
// Burst replay — jitter regression #5 (arrival-time stamping).
//
// Reproduces the on-device measurement of 2026-07-28: the hub samples evenly
// (~30ms) but the network delivers CLUMPS — three samples land with one
// identical Date.now() stamp, then nothing for ~90ms. The old push() dropped
// the duplicates (~18% of all motion) and the display snapped/froze (107
// snap frames + 17 freezes in 719 rendered). With rescheduling (the default),
// every sample must survive and the rendered output must be smooth.
// ---------------------------------------------------------------------------
{
  const tele = createTelebuf();
  const clock = createRenderClock();
  const VEL = 10 / 1000;               // 10 mm/s in mm per ms
  const BURST_EVERY = 90, PER_BURST = 3, SIM = 6000;

  let pushed = 0;
  const frames = [];
  let nextBurst = 0;
  for (let now = 0; now < SIM; now += RAF_DT) {
    while (nextBurst <= now) {
      const arrive = nextBurst;        // all three share ONE arrival stamp
      for (let k = PER_BURST - 1; k >= 0; k--) {
        const sampledAt = arrive - k * (BURST_EVERY / PER_BURST); // hub's even sampling instants
        clock.noteLate(tele.push(VEL * sampledAt, arrive));
        pushed++;
      }
      nextBurst += BURST_EVERY;
    }
    clock.update(RAF_DT);
    const r = tele.sampleAt(clock.stableRenderTime(now));
    frames.push(r.value);
  }

  ok('burst replay keeps every sample (duplicates no longer dropped)',
     tele.length === Math.min(pushed, 256), 'kept=' + tele.length + ' pushed=' + pushed);

  const warm = frames.filter((v, i) => v != null && i > 30);
  const vels = [];
  for (let i = 1; i < warm.length; i++) vels.push((warm[i] - warm[i - 1]) / (RAF_DT / 1000));
  const spikes = vels.filter((v) => Math.abs(v) > 2 * 10).length;
  const holds = vels.filter((v) => Math.abs(v) < 0.01).length;
  const mean = vels.reduce((a, b) => a + b, 0) / vels.length;
  ok('burst replay renders zero snap frames (implied vel never >2x true)',
     spikes === 0, 'spikes=' + spikes + '/' + vels.length);
  ok('burst replay renders (almost) zero held frames', holds <= vels.length * 0.02,
     'held=' + holds + '/' + vels.length);
  ok('burst replay mean implied velocity tracks truth', Math.abs(mean - 10) < 1,
     'mean=' + mean.toFixed(2) + 'mm/s');
  ok('burst replay: the delay buffers the clumps, not their 90 ms gaps', clock.getDelayMs() < 50,
     'delay=' + clock.getDelayMs().toFixed(1) + ' ms');
}

// ---------------------------------------------------------------------------
// Dwell/resume replay — the "random position for one tick on first movement
// or direction change" report (operator, 2026-07-28). A pattern dwells at a
// stroke end; the hub sheds the unchanging channel (gaps of ~600ms); motion
// resumes with a burst. The period estimator must NOT learn from the dwell
// gaps, and the schedule must resync across the hole — no wild frame on
// resume.
// ---------------------------------------------------------------------------
{
  const tele = createTelebuf();
  const clock = createRenderClock();
  const VEL = 20 / 1000; // mm per ms while moving
  let t = 0, pos = 0;
  const push = (p2, at) => clock.noteLate(tele.push(p2, at));

  // Phase 1: steady streaming, 30ms cadence, 2s.
  for (; t < 2000; t += 30) { pos = VEL * t; push(pos, t); }
  // Phase 2: dwell — value frozen, shed to one push each 600ms for 3s.
  const dwellPos = pos;
  for (; t < 5000; t += 600) push(dwellPos, t);
  // Phase 3: resume — direction REVERSED, bursty 3-at-a-time clumps every 90ms.
  const t0 = t;
  for (; t < 8000; t += 90) {
    for (let k = 2; k >= 0; k--) push(dwellPos - VEL * ((t - t0) - k * 30), t);
  }

  // Render Phase 3 (plus a short settle) and hunt wild frames.
  const frames = [];
  for (let now = t0 + 200; now < t; now += RAF_DT) {
    clock.update(RAF_DT);
    const r = tele.sampleAt(clock.stableRenderTime(now));
    if (r.value != null) frames.push(r.value);
  }
  const vels = [];
  for (let i = 1; i < frames.length; i++) vels.push(Math.abs((frames[i] - frames[i - 1]) / (RAF_DT / 1000)));
  const wild = vels.filter((v) => v > 2 * 20).length;
  ok('dwell/resume replay: no wild frame after motion resumes', wild === 0,
     'wild=' + wild + '/' + vels.length + ' maxVel=' + Math.max(...vels).toFixed(1) + 'mm/s');
}

// ---------------------------------------------------------------------------
// Clumped arrivals — the stored TANGENT must come from the reconstructed
// schedule, not the arrival delta (webui.md T18).
//
// The hub samples evenly; TCP delivers clumps that share ONE arrival stamp,
// then a gap. push() reschedules the STORED timestamps onto an even,
// future-anchored timeline, so a tangent measured against arrival time sits in
// a different time base than the span sampleAt() divides it by: inside a clump
// the arrival delta is zero or negative (the schedule already leads arrival),
// which yields no usable tangent at all — the interpolator silently
// drops to linear and the extrapolation velocity stays stale at whatever it
// was before the clumping started. Neither symptom shows on a still frame, so
// assert on the numbers: every tangent finite, and the extrapolation velocity
// consistent with the spacing the ring actually stored.
// ---------------------------------------------------------------------------
{
  const tele = createTelebuf();
  const VEL = 10 / 1000;                 // 10 mm/s, in mm per ms
  const HUB_PERIOD = 30, PER_CLUMP = 3, CLUMP_EVERY = 90;

  let arrive = 0;
  let sampled = 0;
  // Steady clumped delivery: three evenly-sampled points share one arrival.
  for (; arrive < 3000; arrive += CLUMP_EVERY) {
    for (let k = 0; k < PER_CLUMP; k++) {
      tele.push(VEL * sampled, arrive);
      sampled += HUB_PERIOD;
    }
  }
  // ...then a real gap (a shed channel), then clumped delivery resumes.
  arrive += 250; sampled += 250;
  for (let n = 0; n < 10; n++, arrive += CLUMP_EVERY) {
    for (let k = 0; k < PER_CLUMP; k++) {
      tele.push(VEL * sampled, arrive);
      sampled += HUB_PERIOD;
    }
  }

  // The curve's own average slope across the newest buffered span, in the
  // ring's stored time base — this is what the tangents must agree with.
  const probe = [];
  for (let t = arrive - 400; t <= arrive + 40; t += 5) {
    const r = tele.sampleAt(t);
    if (r.value != null) probe.push({ t, v: r.value, vel: r.velPerMs, extra: r.extrapolating });
  }
  ok('clumped arrivals: every interpolated value and tangent is finite',
     probe.every((x) => isFinite(x.v) && isFinite(x.vel)), 'probes=' + probe.length);

  const first = probe[0], last = probe[probe.length - 1];
  const curveVel = (last.v - first.v) / (last.t - first.t);   // mm per ms, stored time base
  const tail = probe.filter((x) => x.extra);
  const extrapVel = tail.length ? tail[tail.length - 1].vel : NaN;
  ok('clumped arrivals: the extrapolation tangent is finite and non-zero',
     isFinite(extrapVel) && Math.abs(extrapVel) > 1e-6, 'velPerMs=' + extrapVel);
  ok('clumped arrivals: the tangent matches the reconstructed spacing, not the arrival delta',
     isFinite(extrapVel) && Math.abs(extrapVel - curveVel) <= 0.3 * Math.abs(curveVel),
     'tangent=' + extrapVel.toFixed(5) + ' curve=' + curveVel.toFixed(5) + ' mm/ms');
}

// ---------------------------------------------------------------------------
// FRAME-CLOCK cadence, against the reported "position telemetry jitters in the
// Tauri shell but not the device-served page".
//
// Both shells run the same WS, the same decode and the same one-epoch
// stamping, so arrivals were not obviously the variable and the webview's
// frame clock was the suspect. This falsifies that: `holding` (the render
// instant outran the newest sample past the extrapolate window, so the frame
// repeats a value and the next arrival snaps) is a function of the ARRIVAL
// gap against the render delay, not of how fast or how evenly frames land.
// A late frame samples a buffer that took the intervening arrivals with it.
//
// So a shell that jitters more is either receiving a different arrival
// cadence or reading a different clock. Neither is measurable from here:
// LinkBar's `render` chip reports fps, buffer delay, held percentage and
// epoch skew off a live shell, and the channel heatmap's blocks report each
// channel's arrival rate (hover). Read those, do not guess.
// ---------------------------------------------------------------------------
{
  const heldPct = (frames) => {
    const warm = frames.filter((f) => f.t > 400 && f.v != null);
    return 100 * warm.filter((f) => f.holding).length / Math.max(1, warm.length);
  };
  const steady60 = heldPct(simulate(true));
  const steady30 = heldPct(simulate(true, () => 33.333));
  // A webview that pauses compositing (unfocused, occluded, a busy main
  // thread) delivers the same average frame count, off the beat.
  const stalling = heldPct(simulate(true, (rng) => (rng() < 0.02 ? 250 : 16.667)));
  // The variable that DOES move it: arrivals stopping while frames continue.
  const starved = heldPct(simulate(true, null, (rng) => (rng() < 0.05 ? 400 : nextGapMs(rng))));

  console.log('\nheld frames vs the two candidate variables');
  console.log('  steady 60 fps:              ' + steady60.toFixed(1) + '% held');
  console.log('  steady 30 fps:              ' + steady30.toFixed(1) + '% held');
  console.log('  60 fps with 250 ms stalls:  ' + stalling.toFixed(1) + '% held');
  console.log('  60 fps, arrivals starved:   ' + starved.toFixed(1) + '% held');

  ok('a slower frame clock does not add held frames',
     Math.abs(steady30 - steady60) < 2, steady30.toFixed(1) + '% vs ' + steady60.toFixed(1) + '%');
  ok('a stalling frame clock does not add them either (the frame-cadence hypothesis fails)',
     Math.abs(stalling - steady60) < 2, stalling.toFixed(1) + '% vs ' + steady60.toFixed(1) + '%');
  ok('starved ARRIVALS do, which is what the held counter is for',
     starved > steady60 + 2, starved.toFixed(1) + '% vs ' + steady60.toFixed(1) + '%');
}

// ---------------------------------------------------------------------------
// Display latency on an even stream (ph-6vh). Arrivals every 35-45 ms with a
// few ms of jitter, the P4 hub's measured cadence at a 25 Hz grant. Lag is
// how far the rendered position trails the true one, in ms: the render delay
// (the p95 lateness) plus the schedule's lead on arrival. With the
// period untrimmed, EMA noise ratchets the lead up to SCHEDULE_MAX_LEAD_MS and
// it never comes back, which is the failure this guards.
// ---------------------------------------------------------------------------
{
  const even = (rng) => (rng() < 0.7 ? 35 : rng() < 0.83 ? 40 : 45) + (rng() - 0.5) * 6;
  const lags = simulate(true, null, even)
    .filter((f) => f.t > 4000 && f.v != null)
    .map((f) => f.t - f.v * (1000 / TRUE_VEL_MM_S))
    .sort((a, b) => a - b);
  const p95 = lags[Math.floor(lags.length * 0.95)];
  console.log('\neven-stream display lag p95: ' + p95.toFixed(0) + ' ms');
  ok('the schedule does not ratchet ahead of arrival', p95 < 70, p95.toFixed(0) + ' ms');
}

// ---- claim: a hub-dated sample is stored at its own time, lateness from its arrival ----
// The rescheduling telebuf takes {value, sample time, arrival} (machine.sampleRxTs,
// RFC-113 draft): samples taken every 20 ms that arrive clumped keep their 20 ms
// spacing, a repeat of the newest is dropped, and lateness is the arrival past the
// newest stored sample.
{
  const tele = createTelebuf();
  const late = [];
  const rx = [25, 25, 25, 85, 85, 85, 145];   // three per clump
  for (let i = 0; i < rx.length; i++) late.push(tele.push(i * 2, i * 20, rx[i]));
  const ts = [];
  tele.forEach((t) => ts.push(t));
  ok('hub-dated samples keep their own spacing under clumped arrival', ts.join() === '0,20,40,60,80,100,120', ts.join());
  ok('lateness is the arrival past the newest stored sample', late[1] === 25 && late[3] === 45 && late[6] === 45, late.join());
  ok('a repeat of the newest sample time is dropped', Number.isNaN(tele.push(12, 120, 150)) && tele.length === 7);
}

// ---------------------------------------------------------------------------
// TelemetryChart path (RENDERING Â§13 laws 8, 9). The chart stores arrivals in a
// rescheduling telebuf and cuts its line at link-stale spans. The span is built
// the way the model's freshness rule opens and closes one: from the last proof
// of life to the first frame back. A 1 s hole exceeds the default 600 ms
// deadman window (registry LIMITS.deadman_default_ms), so the model marks it.
// ---------------------------------------------------------------------------
console.log('\nchartPath â€” gaps, never fabricated points\n');
{
  const tele = createTelebuf({ capacity: 420 });
  const arrivals = [];
  for (let t = 0; t < 2000; t += 40) arrivals.push(t);
  for (let t = 3000; t <= 4000; t += 40) arrivals.push(t);
  for (const t of arrivals) tele.push(t / 100, t);
  const pts = [];
  tele.forEach((t, v) => pts.push({ t, v }));
  const lastBefore = pts.filter((p) => p.v < 20).pop();
  const firstAfter = pts.find((p) => p.v >= 30);
  const gaps = [{ from: 1960, to: 3000 }];
  const { ops, marker } = chartPath(pts, gaps, 4100, 160);
  const inside = ops.filter((o) => o.t > lastBefore.t && o.t < firstAfter.t);
  ok('a 1 s arrival hole renders zero points inside the hole', inside.length === 0,
     inside.length + ' inside (' + lastBefore.t.toFixed(0) + '..' + firstAfter.t.toFixed(0) + ' ms)');
  const resume = ops.findIndex((o) => o.t === firstAfter.t);
  ok('the first arrival after the hole starts a new segment', resume > 0 && ops[resume].pen === 'M');
  ok('every op is a real sample or its hold, never an interpolated value',
     ops.every((o) => pts.some((p) => p.v === o.v)));
  ok('no marker once the link is back', marker === null);

  // Still dead at render time: the line stops at the last proof of life and
  // the last real sample becomes the (dimmed) marker.
  const dead = chartPath(pts.filter((p) => p.v < 20), [{ from: 1960, to: null }], 3500, 160);
  const tail = dead.ops[dead.ops.length - 1];
  ok('a dead link draws nothing past the last proof of life', tail.t <= Math.max(1960, lastBefore.t),
     'tail at ' + tail.t.toFixed(0) + ' ms');
  ok('the last real sample is returned as the stale marker',
     dead.marker && dead.marker.t === lastBefore.t && dead.marker.v === lastBefore.v);

  // Live link, silent channel (on-change, SPEC Â§9.1): the value was unchanged
  // until the next push, so it holds and steps; it never slopes across.
  const idle = chartPath([{ t: 0, v: 1 }, { t: 5000, v: 2 }], [], 6000, 160);
  const mid = idle.ops.filter((o) => o.t > 0 && o.t < 5000);
  ok('an idle channel on a live link holds then steps, no invented slope',
     mid.length === 0 && idle.ops[1].v === 1 && idle.ops[2].v === 2 && idle.ops[1].t === 5000);
  ok('a live link holds the newest sample to now, unmarked',
     idle.ops[idle.ops.length - 1].t === 6000 && idle.marker === null);
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS'));
process.exit(fails ? 1 : 0);
