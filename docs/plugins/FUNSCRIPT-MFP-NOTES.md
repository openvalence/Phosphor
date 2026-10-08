# MultiFunPlayer notes for the funscript player

What MultiFunPlayer (MFP) does for interpolation, auto-home, seek smoothing,
latency and looping, read from its source, and what of it maps onto the
player's segments lookahead (docs/plugins/FUNSCRIPT.md). Reference only:
nothing here is a decision. Board: ph-smvd.7.

Source read: https://github.com/Yoooi0/MultiFunPlayer at
`36c08fbb99ac9398a63ff1cca1bbf68cd2228a94` (2025-01-11), MIT. Files:
`Common/KeyframeCollection.cs`, `Common/Utils/MathUtils.cs`,
`Common/Extensions.cs` (`SleepPrecise`), `Common/IDeviceAxisValueProvider.cs`,
`UI/Controls/ViewModels/ScriptViewModel.cs` (the update thread, settings
classes, seek detection, media loop), `OutputTarget/AbstractOutputTarget.cs`,
`OutputTarget/IUpdateContext.cs`, `OutputTarget/ViewModels/*`,
`MediaSource/ViewModels/InternalMediaSource.cs`,
`MotionProvider/ViewModels/LoopingScriptMotionProvider.cs`.

Units below: MFP positions are media seconds, values 0..1. The player's
`at` is media ms and `pos` is 0..1.

## The shape of MFP's pipeline (read this first)

MFP is a sampled pipeline. One background thread (`UpdateThread`, normal
priority) evaluates every axis every 2 ms while playing (10 ms when paused
and idle) at `axisPosition = MediaPosition - GlobalOffset - axis.Offset`,
then applies, in order: script value, motion provider blend, external
transition, auto-home, sync (seek smoothing), smart limit, speed limit.
The result is one number per axis in `AxisState.Value`.

Output targets read that number on their own clock:

- **Fixed update** (default for serial, TCP, UDP, pipe, WebSocket): a
  thread or task reads `GetValue(axis)` every `UpdateInterval` ms
  (default 10 ms, range 3 to 33; WebSocket 16, range 16 to 200; Buttplug
  50, range 16 to 200; file 20) and sends TCode `L0xxxxI<elapsed ms>`.
- **Polled update** (opt in per target): one event per keyframe crossing,
  `DeviceAxisScriptEvent(From, To)` carrying `To.Value` and
  `To.Position - From.Position`, sent when the span STARTS. The device
  moves linearly over the span. No lookahead, so the transport latency is
  uncompensated, and the interpolation type, sync and auto-home curve
  never reach the device (auto-home sends one event: target, duration).

The player is closer to polled than to fixed: one segment per span. It
differs in two ways that matter: it sends each span before it starts
(half the granted horizon, stamped in execution time), and the machine's
planner, not the client, turns the span into a curve (SPEC §9.6).

## 1. Interpolation

### Algorithm

`KeyframeCollection.Interpolate(index, x, type)` evaluates the span from
keyframe `p0 = k[index]` to `p1 = k[index + 1]` at media time `x`. The
index is found once by binary search (`SearchForIndexBefore`) and then
walked forward (`AdvanceIndex`: while `k[i+1].pos <= x`, `i++`); it
re-searches only on invalidation or when `x` moves backward past the
current knot. Values are clamped to 0..1 after evaluation. Keyframes are
sorted and deduplicated by position on load.

**Linear.** `t = (x - x0) / (x1 - x0)`, `y = y0 + (y1 - y0) * clamp(t, 0, 1)`.

**Step.** `y = y0` for the whole span; the jump happens at `x1`.

**Cubic Hermite** (shared by Pchip and Makima). With `d = x1 - x0`,
`t = (x - x0) / d`, `r = 1 - t` and end slopes `s0`, `s1` (value per
second):

```
y = r^2 * (y0 * (1 + 2t) + s0 * (x - x0)) + t^2 * (y1 * (3 - 2t) - d * s1 * r)
```

which is the standard `h00 y0 + h10 d s0 + h01 y1 + h11 d s1`.

**Pchip** (Fritsch-Butland weighted harmonic mean, the MATLAB `pchip`
interior rule). Slope at an interior knot `k` with chords
`delta_{k-1} = (y_k - y_{k-1}) / h_{k-1}`, `delta_k = (y_{k+1} - y_k) / h_k`:

```
w1 = 2 h_k + h_{k-1}
w2 = h_k + 2 h_{k-1}
s_k = (w1 + w2) / (w1 / delta_{k-1} + w2 / delta_k)
s_k = 0 if delta_{k-1} * delta_k < 0, or if s_k is not finite
```

A zero chord makes `1/delta` infinite and the slope 0, so a flat neighbor
and a reversal both give rest at the knot. Uses 4 knots: `k[i-1]..k[i+2]`.
Monotone: never overshoots its two knots.

**Makima** (modified Akima, the MATLAB `makima` rule). Slope at knot `k`
from the four chords around it, `m0 = delta_{k-2}`, `m1 = delta_{k-1}`,
`m2 = delta_k`, `m3 = delta_{k+1}`:

```
w1 = |m3 - m2| + |m3 + m2| / 2
w2 = |m1 - m0| + |m1 + m0| / 2
s_k = (w1 * m1 + w2 * m2) / (w1 + w2)
s_k = 0 if not finite (only when all four chords are 0)
```

Uses 6 knots: `k[i-2]..k[i+3]`. Not monotone: can overshoot slightly
(values are clamped to 0..1 afterward, the overshoot inside 0..1 is kept).

### Boundaries

Missing neighbors are synthesized by `TakeOrExtrapolate(j, a, b)`: a
phantom keyframe at position `3 b.pos - 2 a.pos` (two spans beyond `b`)
with `b`'s value, i.e. a flat extension. Effects:

- Before the first and after the last keyframe the phantom chord is 0, so
  Pchip and Makima start and end the script at rest.
- **Quirk, do not port as is:** Makima's `pm2` is built as
  `TakeOrExtrapolate(i - 2, pm1, p1)`, which places the phantom at
  `3 p1.pos - 2 pm1.pos`, AFTER `p1`, with `p1`'s value. In the first two
  spans this makes `m0` a third of the chord from `pm1` to `p1` instead of
  a flat chord. The symmetric call is `TakeOrExtrapolate(i - 2, p0, pm1)`.
  `pp2` is built correctly.
- Outside the script (`index` before the first or after the last
  keyframe) nothing is interpolated; the axis keeps its last value until
  auto-home takes it.
- A "gap" is a span with `|dy| < 0.001` or `|dx| < 0.001` s; gaps only
  matter to motion providers and auto-skip.

### Sampling and rate

Evaluated every 2 ms while playing (`SleepPrecise(2)`), 10 ms when paused
and nothing changed. The device sees it at the output rate (default
100 Hz TCode with `I<elapsed>` so the firmware ramps linearly between
ticks). Default type: **Pchip** (`AxisSettings.InterpolationType`); the
looping-script motion provider also defaults to Pchip.

### Mapping onto the segments lookahead

Superseded 2026-10-08: the player has no client curve modes; the hub's
`smoothness` shapes the curve (FUNSCRIPT.md, Interpolation).

- **Linear** is what the player sent then: one segment per span, end
  velocity `unspecified`, no `curve_family` (D4). The hub derives each
  boundary velocity from the adjoining chords when the successor is
  scheduled and resolves to rest when it is not (SPEC §9.6, RFC-058).
- **Pchip and Makima map exactly, without sampling**, and the protocol
  already has the fields: `{target, duration, end_velocity}` determines a
  cubic Hermite, so span `k` is a segment whose `end_velocity` is the
  Pchip or Makima slope at knot `k`, plus a `curve_family` wish of
  `c1_cubic` (registry `curve_families` 1, which names Pchip and Makima).
  The start slope is the predecessor's end slope, which is how MFP's
  per-span Hermite is continuous. This is D4's veto alternative. Cost: the
  player's `submitSegments` list and the host's packer gain an end
  velocity (the host packs `input.end_velocity` in the layout's unit and
  scale; it is a registered role, not an invented field) and the door
  carries the `curve_family` wish on PUBLISH. Slope conversion for the
  player: `s` in pos per media ms becomes
  `s * (hi - lo) * (invert ? -1 : 1) * 1000 * rate` norm per wall second.
  The hub bounds `|end_vel| <= 1.5 * min(|chord_in|, |chord_out|)`
  (`segment_handoff_k`) and surfaces each bound as an anomaly; Pchip
  slopes can exceed that near uneven spacing, so expect bounded handoffs
  on dense content. The slope at knot `k` needs `k+1` (Pchip) or `k+2`
  (Makima): the lookahead already holds them.
- **Step does not map.** Its jump is zero-duration; the host drops
  segments under 10 ms and `curve_family` `step` is reserved (rendered as
  `c2_quintic`). Do not offer it.
- MFP's 0..1 clamp after Makima overshoot is the hub's job here
  ("bounded output": the hub clamps to the window).

## 2. Auto-home

### Algorithm

Per axis, every tick, in `CalculateFinalValue`:

1. **Allowed** when all hold: the axis has a finite value, `AutoHomeEnabled`,
   NOT (inside the script AND playing) unless `AutoHomeInsideScript`, the
   script value and the motion-provider value did not change this tick
   (epsilon 1e-6), and no external transition is driving an invalid axis.
   In plain words: the output has gone still, and the script is not
   running it.
2. Not allowed: reset `AutoHomeTime = 0`, forget the start value, stop
   homing.
3. Allowed: `AutoHomeTime += dt`, then

```
t = 1                                   if delay < 1 ms and duration < 1 ms
t = AutoHomeTime / duration             if delay < 1 ms
t = AutoHomeTime <= delay ? 0 : 1       if duration < 1 ms
t = (AutoHomeTime - delay) / duration   otherwise
```

   `t < 0` (still in the delay): not homing, the value holds. Otherwise
   the start value is latched once (last output, else the axis default)
   and

```
value = lerp(start, target, smoothstep(clamp(t, 0, 1)))    smoothstep(t) = t^2 (3 - 2t)
```

   Once `t >= 1` and the value is within 1e-5 of the target it stays
   there, still "homing" until something moves.

### Defaults

| Setting | Default |
|---|---|
| `AutoHomeEnabled` | true |
| `AutoHomeDelay` | 5 s (V axes 0 s) |
| `AutoHomeDuration` | 3 s (V axes 1 s) |
| `AutoHomeTargetValue` | the axis default: 0.5 for L0..L2 and R0..R2, 0 for V, A and L3 |
| `AutoHomeInsideScript` | false |
| `SyncOnAutoHomeStartEnd` | true |

### Triggers and the blend back

- Paused anywhere, or playing outside the script (before the first or
  after the last keyframe), or playing in a long flat span when
  `AutoHomeInsideScript` is on: after the delay the axis eases home.
- Resume: the script value changes, auto-home is disallowed and resets
  immediately, and because homing just ended (`SyncOnAutoHomeStartEnd`),
  a sync starts (section 3): the output chases from where homing left it
  back onto the script over the sync duration instead of jumping.
- Play or pause also start a sync (`SyncOnMediaPlayPause`).
- Polled targets get one `DeviceAxisAutoHomeEvent(target, duration)` at
  homing start: a single linear move, not the smoothstep.

### Mapping onto the segments lookahead

- **Maps as one segment**, the same shape as the player's preroll and
  hold: `{atMs: start, norm: target, durationMs: duration}`. The hub's
  planner shapes the ease; the smoothstep does not need to be sampled.
  The player only sends motion while playing, so "idle" for the player
  means: playing with no span for `delay` (before the first action, after
  the last, or a long gap). It is NOT paused: Pause is a hold and the
  player must stay silent after it (never auto-resume, the hold ends at
  rest). A home while paused would be motion the operator did not start.
- The player already schedules ahead, so a home inside a gap is
  schedulable in advance: if span `k` ends at `at[k]` and the next span
  starts more than `delay + duration + return` later, insert a home
  segment at `at[k] + delay` and a return segment (preroll-shaped,
  `400 + 1200 x |delta|` ms) ending at the next knot's start. Before the
  first action and after the last this is a single segment. These are
  ordinary segments through `api.submitSegments`.
- Target: the player has no axis default. 0..1 of the operator's Range
  (`applyT(target)`) keeps it inside the window the operator set; the
  window itself is the hub's.
- `AutoHomeInsideScript` false means MFP never homes in a gap while
  playing. Match that by default.

## 3. Seek handling (MFP "sync")

### Algorithm

MFP has no seek-specific path: a seek starts a **sync**, a timed chase
from the last output toward the live script value. `ResetSync` sets
`SyncTime = Duration` on the axis; each tick:

```
g = 2^(-10 * clamp(SyncTime / Duration, 0, 1))      (easeOutExpo: ~0.001 at start, 1 at end)
SyncTime -= dt
value = lerp(lastValue, value, g)                    (skipped while auto-homing)
```

It is a first-order chase whose gain rises as the sync runs: each tick
closes fraction `g` of the remaining error. Residual after time `tau`,
in the continuous approximation:

```
e(tau) / e(0) = exp(-(D / (10 ln 2 * dt)) * (2^(-10 (1 - tau / D)) - 2^-10))
```

With `D = 4 s`: at the 2 ms tick the error falls to 1/e at about 0.87 s
and to 1 % at about 1.65 s; at the 10 ms idle tick, 1.7 s and 2.55 s. The
feel depends on the tick rate; a port should use the closed form, not a
per-tick gain.

**Seek detection.** The media player's reported position is compared
with MFP's own dead-reckoned position (section 4): `|error| > 1.0 s`, or a
source that flags the change as a seek (`ForceSeek`), is a seek: snap both
positions to the report, start a sync if `SyncOnSeek`, and clear the A-B
loop if the new position is more than 1 s outside it. Smaller errors are
drift and are corrected smoothly.

### Defaults (`SyncSettings`)

| Setting | Default |
|---|---|
| `Duration` | 4 s |
| `SyncOnSeek` | true |
| `SyncOnMediaPlayPause` | true |
| `SyncOnMediaResourceChanged` | true |
| `SyncOnScriptResourceChanged` | true |
| `SyncOnScriptStart` | true (entering the script from before the first keyframe) |
| `SyncOnScriptEnd` | true |
| `SyncOnAutoHomeStartEnd` | true |

Also: `AutoSkipToScriptStartEnabled` true with offset -5 s: 1 s after a
new media duration arrives, seek to 5 s before the first non-gap keyframe
if the media is before it.

### Mapping onto the segments lookahead

- **The chase itself does not map.** It is a per-sample output filter
  that bends the script for up to 4 s after every seek; segments carry
  knots, not samples, and SPEC §9.6 puts feasibility on the hub (the hub's
  `limit.input.speed` already stops a seek from becoming a slam: on
  valencesim an 8333 mm/s ask peaked at 1000 mm/s).
- **What does map: blend at the knots.** On a restart after `seeked`,
  the scheduler may replace the targets of the knots inside the first
  `D` ms with `norm_k' = lerp(here, norm_k, w(tau_k))`, `tau_k` the knot's
  wall time since the restart and `w` the closed-form ease above (or
  smoothstep). Each knot keeps its time, so the tiling, the one map and
  "each span sent once" hold; only the content is softened. `here` is the
  measured position (reality), never a guess. The knot times stay
  intent; the blend is the player's content transform like Range and
  Invert (D10).
- **Simpler alternative, already in the player:** the Play preroll
  (`400 + 1200 x |delta|` ms positioning segment, video waits). A seek
  that lands more than 5 % of the stroke away could take the same path:
  hold the video for the preroll, then start. MFP keeps the video running
  and bends the motion; preroll keeps the motion true and delays the
  video. Which one is an operator ruling.
- MFP's `SyncOnScriptStart` and `SyncOnScriptEnd` have no analog: the
  player's first span starts from the machine's position by
  construction (the hub plans from actual), and the last ends at rest.

## 4. Latency

### What MFP has

**Precise sleep** (`UsePreciseSleep`, per fixed-update output target,
default off; tooltip: "Sacrifices processor time in exchange for more
consistent update ticks (lower jitter)"). It is the only CPU-for-timing
trade in MFP. It changes how the output thread waits for its next tick:

- Off: `Thread.Sleep(max(1, interval - workMs))`. Windows rounds a sleep
  up to the system timer period (15.6 ms unless some process raised it),
  so a 10 ms interval can tick at 15.6 ms or worse.
- On: `SleepPrecise(interval)`, a hybrid wait against the Stopwatch
  (QueryPerformanceCounter):

```
loop:
  remaining = interval - elapsed
  if remaining <= 0:  break
  if remaining <= 2:  SpinWait.SpinOnce(-1)    busy-spin with yields, never Sleep(1)
  elif remaining < 5:  Sleep(1)
  elif remaining < 15: Sleep(5)
  else:                Sleep(10)
```

  The last 2 ms are burned on a core, which is the CPU cost. The script
  evaluation thread always uses `SleepPrecise` (2 ms playing, 10 ms idle).

What it does NOT do (searched the whole tree): no `timeBeginPeriod` or
`NtSetTimerResolution`, no thread or process priority change, no
multimedia or waitable timer. Threads are plain background threads.

The UI reports `AverageUpdateRate` and `UpdateRateJitter` (worst
`|1000/interval - 1/elapsed|` in Hz over 0.25 s) for fixed targets, and
`AverageUpdateError` (mean over the last 25 events of
`elapsed - previous event's duration`, ms) for polled targets. Display only.

**Offload elapsed time** (TCode targets, default off): off sends
`I<elapsed ms>` (the measured time since the previous tick) so the
firmware ramps over exactly the real tick; on sends no `I` and lets the
firmware time it. Either way the device reaches each value one tick late.

**Automatic latency compensation: there is none.** Latency is a manual
trim: `GlobalOffset` (default 0 s) and a per-axis `Offset` (default 0 s),
applied as `scriptTime = mediaPosition - GlobalOffset - axisOffset`, so
positive means the machine moves later. The Handy target measures round
trip at connect (30 `servertime` GETs, sorted, the 3 fastest and 3
slowest dropped, the mean of the rest) and only logs it: the result is not
applied.

**Media position smoothing** (the jitter handling MFP does have). Media
players report position coarsely. MFP keeps its own clock:

```
each tick while playing:
  internal += dt * speed
  MediaPosition += clamp(internal - MediaPosition, 0.9 * dt * speed, 1.1 * dt * speed)
each report (not a seek):
  internal += 0.33 * (reported - internal)
```

The script clock never runs backward and never runs outside 90 to 110 %
of playback speed; a report pulls the internal clock a third of the way.

### Mapping onto the segments lookahead

- **Precise sleep has no browser analog and needs none.** A page has no
  thread priority, no timer resolution, no spin that the browser would
  not throttle, and the host owns time (D3). The player's timing does not
  ride a client tick at all: each segment carries an absolute execution
  start (`t_base + t_off`, 0.1 ms grid) and the hub executes it on its
  own clock. Client jitter only has to stay inside the lead (half the
  horizon, 125 ms at 250), which `requestAnimationFrame` meets with a
  wide margin. MFP's jitter problem is a sampled-pipeline problem.
- **Offload elapsed time** has no analog: no per-tick ramps exist.
- **Compensation is already more than MFP's.** The player stamps from
  the frame's display time (rVFC), the host subtracts the hub's declared
  `schedule_latency_us` (RFC-059), and the door's CLOCK filter removes the
  RTT/2 error (D15). The user trim is MFP's `GlobalOffset` with the same
  sign (+ = machine later) and a zero that means "declared latency
  applied". A per-axis offset is out of scope while the player is L0 only.
- An automatic trim from measurement (the hub's `plan.latency` role, or a
  photodiode in the Hardware phase) would be new work; MFP offers
  nothing to port there. RFC-059 forbids bidding the declared value down,
  so any auto trim sits on top of it.
- MFP's media smoothing is the player's clock (`clock.js`) in a cruder
  form: the player's median, 5 ms/s slew and 25 ms step re-anchor already
  cover it and do not need the 90 to 110 % rate clamp, because the map is
  affine in media time, not chased.

## 5. Looping

MFP loops in three places:

- **A-B media loop** (`MediaLoopSegment`): start and end positions set by
  shortcut actions (from the current position, from the current chapter,
  explicit). Checked at 10 Hz on the update thread: when
  `MediaPosition >= end`, seek the media to `start`. The seek is detected
  like any other (error > 1 s), so it starts a 4 s sync. Setting either
  end seeks to the start; a user seek more than 1 s outside the loop
  clears it.
- **Internal player playlist loop** (`InternalMediaSource.IsLooping`, the
  script-only player): when the position passes the duration it is set to
  0 with `forceSeek`, which again starts a sync. Exclusive with shuffle.
- **Looping-script motion provider**: plays a separate funscript from its
  first to its last keyframe at `Speed`, then jumps back to the first
  keyframe with no blend (a step if the first and last values differ,
  caught only by the speed limit when enabled).

### Mapping onto the segments lookahead

- A media loop is a seek, and the player already handles a seek: hold on
  `seeking`, anchor and supersede on `seeked`. An A-B loop is the video's
  job (`currentTime = start` at `end`, checked per frame, not at 10 Hz)
  plus that path. A seamless wrap (scheduling the span from the last
  knot before `end` to the first knot after `start` ahead of the jump)
  would need the clock to model the seek's landing frame, which D5 does
  not; not worth it before an operator asks.
- `<video loop>` wraps through the HTML seek algorithm, so `seeking` and
  `seeked` fire and the same path applies (spec reading, not measured in
  WebView2; if a wrap ever arrives without them, rVFC media time going
  backward is the tell).
- The motion-provider loop is a generator, not a player feature; the
  pattern generator owns that surface.

## MIT attribution block (put in any file that ports MFP code)

```js
// Portions ported from MultiFunPlayer (https://github.com/Yoooi0/MultiFunPlayer),
// <source file>, commit 36c08fbb99ac9398a63ff1cca1bbf68cd2228a94.
// Copyright (c) 2020 Yoooi. MIT License:
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
```

Formulas restated in this document from their published definitions
(MATLAB `pchip`, `makima`, smoothstep, easeOutExpo) need no attribution;
code transcribed from MFP's files does.
