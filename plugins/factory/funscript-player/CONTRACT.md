# Funscript player: module contract

The binding interface for the six builders of `ph-smvd`. Code against this
file blind; the reasons live in [docs/plugins/FUNSCRIPT.md](../../../docs/plugins/FUNSCRIPT.md).
A change to a signature or shape here is a contract change: edit this file
in its own commit, comment on the epic, and tell the owners of every caller.

Rules for every module:

- Plain ES modules, no framework. Plugin files import only their siblings,
  never the kernel. Pure modules touch no DOM, and no module touches the
  DOM or `window` at import time: `test/funscript-player.test.mjs` imports
  every one under node.
- Bind by registry role only (one exception: `kinetic/kinetic.js` binds the
  Tuning rows by `kinetic_tuning` member name, FUNSCRIPT.md K2). Channel ids
  appear in tests and fixtures only.
- Comments state constraints (C-12), American English (C-11).
- UI copy is one fragment under eight words, no ". " (docs/COPY.md). Each UI
  module exports a frozen `COPY` of every literal it renders.
- CSS uses tokens only: no hex, no `rgb(` literal except
  `rgba(var(--x-rgb), a)`, never `--bad` or `--estop` (law 13). Classes are
  prefixed `fsp-`.

| key | bead | files |
|---|---|---|
| core | ph-smvd.1 | `funscript.js`, `test/funscript-core.test.mjs` |
| host | ph-smvd.2 | `src/model/motion.js`, `src/model/actions.js`, `src/model/shadow.svelte.js`, `src/plugins/host.js`, `src/plugins/plugins.svelte.js`, `src/plugins/PluginSlot.svelte`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `test/plugins.test.mjs`, `docs/PLUGINS.md` (API rows) |
| stash | ph-smvd.3 | `stash.js`, `library.js`, `test/funscript-stash.test.mjs`, `test/fixtures/fake-stash.mjs` |
| scheduler | ph-smvd.4 | `clock.js`, `scheduler.js`, `test/funscript-scheduler.test.mjs`, `test/funscript-sync-live.mjs` |
| player-ui | ph-smvd.5 | `ui.js`, `timeline.js` |
| plugin | ph-smvd.6 | `index.js`, `prefs.js`, `manifest.json`, `src/plugins/factory.js`, `package.json`, `docs/PLUGINS.md` (Shipped, Module shape), `test/funscript-player.test.mjs` |
| scale | ph-smvd.10, ph-1qs5.1 | `scale.js`, `test/funscript-core.test.mjs` (the scale section) |
| analyzer | ph-smvd.11 | `analyzer.js`; the playhead and the expand in `ui.js`, `timeline.js`; sections (c2), (g) and the live analyzer checks of `test/funscript-player.test.mjs` |
| kinetic | ph-ge35 | `kinetic/kinetic.js`, `kinetic/bytes.js`, `kinetic/kinetic.pin`, `test/kinetic-trace.test.mjs`, `test/kinetic-pin.mjs`, `test/fixtures/kinetic_trace.json`; the render glue in `analyzer.js`, `timeline.js`; sections (c2) and (k) of `test/funscript-player.test.mjs` |
| integration | ph-smvd.13, ph-smvd.14 | the playback wiring in `ui.js`, `timeline.js`, `index.js`; sections (h) and (p) `--live-playback` of `test/funscript-player.test.mjs`; the fixture |

Bare file names live in `plugins/factory/funscript-player/`. Import graph,
no cycles: `index -> ui, prefs, library, scale`; `ui -> funscript, clock,
scheduler, stash, library, timeline, prefs, scale, analyzer`; `analyzer -> funscript, scheduler, kinetic`;
`kinetic -> scheduler, bytes`; `scheduler -> funscript`;
`timeline -> funscript`; `library -> stash`; `stash -> funscript`;
`prefs -> scale`.

---

## Shared shapes

```js
// Script: parseFunscript's result. Typed arrays: scripts run to 50k actions.
{
  name: string,               // file or scene name given to the parser
  title: string | null,       // metadata.title when present
  at: Float64Array,           // ms, >= 0, strictly increasing (duplicate at: the last wins)
  pos: Float32Array,          // 0..1, the file's `inverted` already applied, clamped
  durationMs: number,         // at[n-1]; n >= 1
  axis: 'L0',                 // only the main axis drives the rail
  ignored: string[],          // other axes seen ('R0', 'roll', ...), never driven
  notes: string[],            // terse facts: 'range ignored', '3 duplicates dropped', '12 positions clamped'
  metadata: object | null,    // the file's metadata object, untouched
}

// Transform T: client content transforms, global (prefs key 'T').
{ offsetMs: number,           // -500..500, step 5; + = machine later; 0 = the hub's declared latency already applied
  lo: number, hi: number,     // 0..1 share of the hub's window, hi - lo >= 0.05
  invert: boolean }           // XOR with the file's own flag (already applied in Script.pos)

// Seg: the ONLY motion currency between the player and the host.
{ atMs: number,               // performance.now() ms at which the machine STARTS EXECUTING it
  norm: number,               // 0..1 across the hub's stroke window (submitMotion's meaning)
  durationMs: number,         // > 0, wall ms
  endVel?: number | null }    // velocity at its end, norm/s (input.end_velocity, SPEC 9.6); null or absent: unspecified,
                              // a free knot the hub's smoothness shapes (RFC-106, RFC-108), at rest until its successor arrives

// SegResult: api.submitSegments(list)
{ ok: true,  sent: number, rateHz: number }             // sent = leading items consumed (packed, or dropped as short or colliding)
{ ok: false, sent: 0, reason: string, rateHz?: number } // reason: the host's words or a PublishError code

// TickResult: scheduler.tick / stop
{ ok: boolean, sent: number, reason: string, fatal: boolean } // fatal: the caller pauses the video and shows reason

// Scene: stash.js toScene
{ key: 'stash:<id>', id: string, title: string, date: string | null, rating: number | null, // rating 0..100
  durationMs: number | null, width: number | null, height: number | null,
  screenshot: string | null,  // rebased onto base, apikey appended
  stream: string,             // rebased onto base, apikey appended
  funscript: string | null,   // rebased onto base; fetched with the ApiKey header
  speed: number | null,       // interactive_speed
  studio: string | null, performers: string[], tags: string[] }

// LocalScene: ui.js from pairFiles
{ key: 'file:<name>:<size>', title: string, stream: string, // stream is a blob: URL
  script: File | null, extra: File[] }

// Page
{ count: number, page: number, perPage: number, scenes: Scene[] }

// Prefs: api.prefs keys, stored as plugin.funscript-player.<key>; prefs.js owns the defaults
{ T: {offsetMs: 0, lo: 0, hi: 1, invert: false}, motion: true, audio: {vol: 1, muted: false},
  stash: {base: '', key: ''}, lib: {q: '', sort: 'date', direction: 'DESC'}, view: 'player', zoomMs: 10000, settingsOpen: false, libOpen: true,
  interp: {scale: 1, scaleAuto: true},   // Scale (scale.js); any other stored field is dropped on read
  play: {loop: false, loopCount: 0, home: false, homeAfterMs: 5000, homePoint: 0.5, homeSpeed: 0.33,   // ph-smvd.12
         seekMs: 500, autoLatency: false} }   // a stored lowLatency is dropped on read
// play repairs: loopCount 0..99 integer (0 = forever), homeAfterMs 1000..60000 step 500, homePoint 0..1,
// homeSpeed 0.05..2 norm/s, seekMs 0..3000 step 50 (0 = jump).
// Every key but stash is also mirrored to localStorage phosphor.funscript.<key> (the prefix the prefs
// backup carries) and read from there when api.prefs has none. stash holds the API key: never mirrored.
```

Wire record on valencesim and Nucleus (0x2101 `motion-segment`, found by
role, never by id): `target_norm` u16 x10000 (`input.target`), `duration_ms`
u16 (`input.duration`), `end_vel_norm` i16 (`input.end_velocity`, always its
`unspecified` sentinel -32768). Bundle: `t_base` u32 hub us is the first
segment's stamp, `t_off` u16 in `segment_t_off_unit_us` (100 us), at most 32
records and one `min_transport_payload` (29 of this layout).

---

## core: `funscript.js` (pure)

```js
export const MAX_SPAN_MS = 60000;   // a longer span is split along its line (u16 ms duration, with margin)
export const MAX_SCRIPT_MS = 86400000, MAX_ACTIONS = 1000000;   // past either, refused before any expansion
export const AXES;                  // frozen {suffix -> axis}: '' and 'stroke' -> 'L0', surge L1, sway L2,
                                    // twist R0, roll R1, pitch R2, vib V0, valve A0, suck A1, lube A2;
                                    // bare TCode ids map to themselves
export function parseFunscript(input, name = '');   // input: string | object -> Script
  // throws Error('not a funscript') (bad JSON, no actions array) | Error('no actions') (none survive)
  //   | Error('more than a million actions') | Error('script longer than 24 hours') (an action past MAX_SCRIPT_MS)
  // keeps finite at >= 0 and finite pos; stable sort; duplicate at keeps the last; pos clamped 0..100, /100;
  // inverted (exactly true): pos = 1 - pos; a numeric range other than 100 is noted 'range ignored';
  // an `axes` array (multi-axis) is listed in `ignored`. Further notes: 'N invalid actions dropped',
  // 'N long spans split', 'actions sorted'; thin() adds 'N actions thinned'.
export function axisOf(fileName);   // -> {base: string, axis: string} | null (null when not *.funscript);
                                    // directory parts are stripped
export function pairFiles(files);   // Array<{name, type?}> -> {video, script, extra: []}; media by MIME type,
                                    // else by file extension
  // video: the first video or audio file; script: the L0 script of the same base (case-insensitive),
  // else the first L0 script; every other *.funscript goes to extra (named, never driven)
export function posAt(script, tMs);       // -> 0..1, linear between actions (the authored meaning); holds outside
export function indexAfter(script, tMs);  // -> first i with at[i] > tMs; n when none (binary search)
export function speedAt(script, tMs);     // -> |chord speed| in norm/s of the span holding tMs; 0 outside
export function peakSpeed(script);        // -> the fastest chord in norm/s
export function thin(script, minGapMs);   // -> Script keeping first, last and local extrema, minGapMs apart
export function heat(script, bins, fromMs = 0, toMs = script.durationMs);
  // -> Float32Array, time-weighted mean |speed| per bin in norm/s (raw; the view scales it)
export function fmtTime(ms);              // -> 'm:ss.t' under an hour, else 'h:mm:ss'
```

`test/funscript-core.test.mjs` (node): parse variants (object, text,
unsorted, duplicates, clamp, non-finite, inverted, range note, axes array,
garbage, empty), the 60 s split, the axisOf table, pairFiles, posAt at and
between knots, indexAfter edges, thin keeps reversals, heat bins, fmtTime.

---

## scheduler: `clock.js` and `scheduler.js`

```js
// clock.js
export const CLOCK_WINDOW = 32, SLEW_MS_PER_S = 5, STEP_MS = 25, FALLBACK_AFTER_MS = 250;
export function createMediaClock();   // -> MediaClock
// MediaClock = {
//   ready: boolean,                        false until the first anchor
//   rate: number,                          playbackRate of the current anchor
//   anchor(mediaMs, displayMs, rate),      hard set; clears the residual ring
//   reset(),                               ready = false
//   observe(mediaMs, displayMs) -> '' | 'step',
//       residual r = displayMs - displayAt(mediaMs), median of the last CLOCK_WINDOW. Until the ring
//       fills after an anchor, correct by the whole median; then by at most SLEW_MS_PER_S x elapsed s.
//       |median of the last 8| > STEP_MS re-anchors there and returns 'step'; so does a whole-median
//       correction past STEP_MS before the ring fills. STEP_MS sits between one 60 Hz vsync (slewed)
//       and one dropped 30 fps frame (stepped). A correction is subtracted from every residual.
//       The caller anchors and observes only frames whose media time advances past the last one
//       seen since the reset: after play() or a seek the first frame repeats for several vsyncs.
//   displayAt(mediaMs) -> performance.now() ms the frame is SHOWN (NaN before ready),
//   mediaAt(displayMs) -> media ms (NaN before ready) }
export function frameSource(video, onFrame, now = () => performance.now());   // -> stop()
  // onFrame(mediaMs, displayMs). requestVideoFrameCallback when present: (md.mediaTime * 1000,
  // md.expectedDisplayTime). A rAF loop reports (video.currentTime * 1000, now()) only while no
  // rVFC frame came for FALLBACK_AFTER_MS (audio only, hidden video, glance).
// Playback (ph-smvd.12):
export const WRAP_EARLY_MS = 34;
export function loopSpec(a, b, count = 0, durationMs = Infinity);   // -> {a, b, count} | null
  // media ms; null when b - a < 1000 or count is 1; b bounded by durationMs. count 0 = forever, N = the
  // a..b section plays N times in all, then plays on.
export function createLoop();   // -> Loop, the video side of a loop
// Loop = { lap, spec, set(spec | null), reset(), more(), wrapping,
//   due(mediaMs) -> true from b - WRAP_EARLY_MS to b + 1000 while the section still repeats and no wrap is pending,
//   wrap() -> a: marks a wrap pending; the caller seeks there,
//   unroll(mediaMs) -> mediaMs + lap x (b - a); a frame in the section's first half while a wrap is pending counts a lap
//       (no frame before the wrap is needed: a loop set at the playhead wraps at once),
//   seeked(mediaMs) -> spec | null: lap 0 again; a landing at or past b clears the loop }

// scheduler.js
export const STOP_MS = 200, PREROLL_MIN_MS = 400, PREROLL_STROKE_MS = 1200, PREROLL_SKIP = 0.05, OFFER_MAX = 32;
export const TRANSIENT;   // frozen Set: 'waiting for the stream grant', 'NO_CLOCK', 'NOT_SENT', 'RATE_EXCEEDED'
export function applyT(norm, T);   // -> T.lo + (T.invert ? 1 - norm : norm) * (T.hi - T.lo)
export function strokeSpeed(script, mediaMs, T, spanMm);   // spanMm: number | null -> {v, unit: 'mm/s' | '%/s'};
                                                           // at rate 1; the caller scales it by the rate
export const HANDOFF_K = 1.5;   // registry limits.segment_handoff_k, restated (a plugin imports nothing outside its folder)
export function knotSlope(t, p, j, n);   // knot j's slope, pos per media ms, over accessors t(j), p(j): between two
  // chords of one sign their mean, at most HANDOFF_K x the lesser; null (free) at either end, a reversal and beside a hold
export function wireVel(slope, T, rate = 1);   // -> norm/s: slope x 1000 x rate x (hi - lo), negated under invert; null stays null
export function createScheduler({ submit, now = () => performance.now(), log = () => {} });   // -> Scheduler
// log(msg, level), api.log's shape; a repeated reason is logged once.
// submit: (Seg[]) -> SegResult, i.e. api.submitSegments.
// Scheduler = {
//   load(script | null),        resets the cursor; with null every call returns {ok: true, sent: 0}
//   setTransform(T),            takes effect at the next restart
//   restart(clock),             cursor = max(1, indexAfter(script, mediaAt(now - T.offsetMs))); the
//                               in-progress span goes first with its start in the past (the host clips it).
//                               Same knots, no transition and the sent schedule still running: nothing sent
//                               is re-sent; the first unsent span starts at the last sent end and absorbs the
//                               shift when it is at most half that span (FUNSCRIPT.md Sync 5)
//   tick(clock) -> TickResult,  skips spans whose end passed (skipped++), offers up to OFFER_MAX segments
//                               from the cursor, advances by result.sent only.
//                               Span k (knot k-1 -> k): atMs = clock.displayAt(at[k-1]) + T.offsetMs,
//                               durationMs = (at[k] - at[k-1]) / clock.rate, norm = applyT(pos[k], T),
//                               endVel = wireVel(knotSlope(knot k), T, clock.rate), null where the knot is free.
//                               A TRANSIENT reason is fatal false (retry next tick); RATE_EXCEEDED first
//                               re-thins the unsent script at 1000 / rateHz ms, once per rate. Any other
//                               reason is fatal true. The thinning covers the unsent tail from knot
//                               cursor - 1 on; a restart drops it.
//   stop(clock) -> TickResult,  one hold: atMs = now(), d = min(STOP_MS, ms to the next action),
//                               norm = applyT(posAt(script, m + d * rate), T), durationMs = d,
//                               m = mediaAt(now - T.offsetMs);
//                               it has no successor, so it ends at rest: endVel 0
//   preroll(mediaMs, hereNorm) -> Seg | null,
//                               hereNorm: 0..1 | null. null when |hereNorm - target| <= PREROLL_SKIP;
//                               else {atMs: now(), norm: target, durationMs: PREROLL_MIN_MS +
//                               PREROLL_STROKE_MS * |delta|}, target = applyT(posAt(script, mediaMs), T),
//                               delta = 1 when hereNorm is null, endVel 0 (the video start is not
//                               scheduled). The caller submits it and plays at its end.
//   cursor: number, skipped: number }
//
// Playback (ph-smvd.12). The offset in force everywhere above is T.offsetMs - compMs. A transform or
// loop change is pending until restart; preroll and home read the pending ones.
export const HOME_MIN_MS = 400;
export const COMP_MAX_MS = 100, COMP_STEP_MS = 2, LAG_WINDOW = 32, LAG_MIN = 8, LAG_MATCH_MS = 100;
// Scheduler gains:
//   setHome(home | null)        home: {point: 0..1 script space, speed: norm/s}; in force at once
//   home(hereNorm) -> Seg | null   the pause home (never a knot while playing): null when off or when
//                               |hereNorm - target| <= PREROLL_SKIP; else {atMs: now(), norm: target,
//                               durationMs: max(HOME_MIN_MS, |delta| / speed s)}, target = applyT(point, T),
//                               delta = 1 when hereNorm is null, endVel 0. The caller submits it once a
//                               pause has lasted afterMs
//   setLoop(loopSpec | null)    pending until restart
//   setLatency({auto})          in force at once. auto: when |clamp(lagMs, 0, COMP_MAX_MS) - compMs| >= COMP_STEP_MS the next
//                               tick sets compMs and restarts; off (or no lag yet) returns compMs to 0
//   restart(clock, transitionMs = 0)   transitionMs > 0 (a seek): the first segment is {atMs: now,
//                               norm: applyT(script at mediaAt(now + transitionMs - offset)), durationMs:
//                               transitionMs, endVel: null}; that span
//                               follows from its end, the knots
//                               inside are passed over
//   observePlan(arrivalMs, elapsedMs, durationMs)   one plan strip sample (plan.elapsed, plan.duration in ms;
//                               arrival in performance.now() ms, now() - api.age(field)). Samples of one
//                               duration within 15 ms of one start are one plan, start = the least
//                               arrival - elapsed; a closed plan matches the sent segment of its duration
//                               (+-1 ms) with the nearest atMs within LAG_MATCH_MS, sent at least 2 ms ahead
//                               and not superseded; its lag is start - atMs
//   lagMs                       median of the last LAG_WINDOW lags, NaN under LAG_MIN; compMs: applied
// With a loop the clock runs in unrolled media time (createLoop.unroll) and the cursor walks lap 0 to b,
// then the knots inside (a, b) once per lap, then the last lap plays on: the seam span is the last knot
// before b to the first after a, (at[iA] - at[iB-1]) + (b - a) long.
```

Playback wiring (ph-smvd.13), done by `ui.js` and `index.js`; the scheduler
and clock do none of it:

- Hero spec optional has `planEl: 'plan.elapsed', planDur: 'plan.duration'`;
  each playing tick a new sample (its `api.age` dropped, or its elapsed
  changed) goes to `observePlan(now() - api.age(planEl), elapsed ms,
  duration ms)`, converted from the field's unit (us, ms, s).
- `scheduler.load(wire)`: scale.js `wire()`, one knot per action.
- Pause home: Pause (a stop to ready from playing) or the end arms it at
  `now() + homeAfterMs`; each tick past that while ready submits
  `scheduler.home(here())` once (a transient refusal retries next tick),
  unless `play.home` is off, Motion is off or the gate reads; Play, a load
  and a Motion change disarm it. Probe mark `home` when it went out.
- Prefs `play` map to `setHome(home ? {point, speed} : null)`,
  `setLatency({auto: autoLatency})`, and a
  `seeked` restart as `restart(clock, seekMs)`; every other restart passes 0.
- Loop: `loop.set(loopSpec(a, b, loopCount, video.duration * 1000))` and
  `setLoop(loop.spec)` (a, b the timeline's A-B points, else 0 and the
  duration while `play.loop`). `onFrame` feeds the clock `loop.unroll(mediaMs)`; each tick
  `if (loop.due(video.currentTime * 1000)) video.currentTime = loop.wrap() / 1000`.
  The `seeking`, `waiting` and `playing` a wrap starts are not a stop: no
  hold, no clock reset (the clock steps on the landing frame when the seek
  took over `STEP_MS`). Any other seek calls `loop.seeked(ms)`, then
  `setLoop(loop.spec)` and a seek restart; one that clears the loop clears
  the A-B points. A loop change while playing holds and re-anchors (lap 0).
- Displayed media time (the time readout, the playhead, the trace) is the
  unrolled clock folded back by `lap x (b - a)`; the trace reads the machine's
  script time at `mediaAt(now - T.offsetMs + compMs)`.
- The probe (localStorage `phosphor.funscript.probe`) adds `{k: 'mark', name:
  'wrap', lap}` per wrap and `{k: 'lat', t, lag, comp}` every 500 ms while playing.

The cadence: the player calls `tick` once per animation frame while
playing; nothing else submits motion.

`test/funscript-scheduler.test.mjs` (node): synthetic 29.97 fps PTS on a
60 Hz vsync at a random phase gives a median |displayAt error| <= 4 ms after
1 s; 100 ppm drift is tracked within 3 ms over 120 s; a 60 ms jump returns
'step' within 8 observations; spans tile within 0.001 ms; each segment is
sent once; restart order; skipped counted; offset +40 shifts every atMs by
exactly 40; rate 1.5 divides durations; stop and preroll shapes; TRANSIENT
vs fatal; RATE_EXCEEDED thins once. `test/funscript-sync-live.mjs` is the
sync measurement against valencesim (FUNSCRIPT.md, Tests).

---

## host: kernel additions (generic, no funscript knowledge)

### `src/model/motion.js`

```js
export const SEG_FLOOR_MS = 10, CLOCK_KEEP = 32, CLOCK_HUNT = 16, CLOCK_HUNT_GAP_MS = 250, CLOCK_DRIFT = 50e-6;
export function latchWords(safety);   // -> 'e-stop latched' | 'paused, resume to continue' | ''
export function filteredHubNowUs(s, nowMs = performance.now());
                                      // -> hub now from the kept CLOCK exchange (last CLOCK_KEEP) with the
                                      // least RTT/2 + age x CLOCK_DRIFT; CLOCK_HUNT at random gaps on first
                                      // use (submitSegments' warm call) and on 'live'; a close
                                      // voids them; hubNowUs() for a session without on() or syncClock()
// createMotionDoor(deps): call shape unchanged; deps gain optional now() (default () => performance.now())
// and lastNack(ch) -> the newest NACK record {name} the link saw on channel ch, or null.
// The returned submit function gains a member:
submit.segments(list);   // Seg[] -> SegResult
export function streamGate({ live, roles, access, halted, running, busy });   // -> words | ''
export function conflictWords(reason, owners, self);   // -> 'refused: rail owned by <label>' for SOURCE_CONFLICT, else reason
```

`segments(list)`, in order:

1. `deps.halted()` non-empty: `{ok: false, sent: 0, reason}`; nothing sent.
2. `st = motionStream(entries, STREAM_KIND.segments)`; none:
   `'hub has no segments STREAM'`. Never a setpoint fallback.
   A STREAM bundle has no answer, so a hub NACK on that channel (for
   example `SOURCE_CONFLICT` while a generator owns the rail, SPEC §11.4)
   comes back through `deps.lastNack(ch)`: the first call per channel takes
   the baseline, and a newer record refuses the next call once with its
   name, `{ok: false, sent: 0, reason: name}`. It is not TRANSIENT, so the
   player pauses and shows it.
3. No session: `'not connected'`.
4. The grant, through one inner `grantFor(s, st)` shared with `submit` (same
   `asked` map): `'waiting for the stream grant'` while in flight,
   `'publish refused'` once refused. The wish stays `[ch, entry.maxRateHz || 50]`.
5. An empty list: `{ok: true, sent: 0, rateHz}` (warms the grant; acquires no source).
6. Any item without finite `atMs`, finite `norm` and `durationMs > 0`, or
   with `atMs` descending: `'bad segment'`.
7. `hubNow = filteredHubNowUs(s); p = deps.now(); lat = grant.scheduleLatencyUs || 0`
   (`submit` stamps from it too).
   Per item: execution start `E = hubNow + (atMs - p) * 1000`, end
   `X = E + durationMs * 1000`. `E < hubNow + lat` moves to `hubNow + lat`
   keeping `X`; then `X - E < SEG_FLOOR_MS * 1000` is consumed, not packed.
   Stamp `S = E - lat` (RFC-059: execution = stamp + declared latency).
8. Offsets `round((S - S0) / unit) * unit`, `unit = LIMITS.segment_t_off_unit_us`;
   an offset not above the previous one is consumed, not packed.
   `bundleHead(packed, hubNow, grant.scheduleHorizonMs / 2, recordBytes(layout))`
   takes the head: half the horizon, at most 32, one payload.
9. `record()` fills `input.target` (clamped 0..1) and `input.duration` in its
   unit (clamped to the type range); every other field rides `unspecified`.
   `s.publishSegment(ch, recs, {anchor: S0 >>> 0, offsetsUs})`.
10. A `PublishError`: `{ok: false, sent: 0, reason: e.code, rateHz}`, logged
    once per code. Success: `{ok: true, sent, rateHz: grant.rate}`, `sent`
    counting every leading item packed or consumed through the last one
    packed. Nothing in reach: `{ok: true, sent: 0}` (the first start lies
    past half the horizon).

`streamGate` (pure) returns the first that applies: `'no hub link'`,
`'session not authorized'` (roles below access), `halted`,
`'stop the pattern first'` (running), `busy`, else `''`. It never reads
control-owner (main's rail ruling, 6052b5f, operator 2026-10-03): a slot
stays held for its session's life, so a foreign stream holding the rail is
the hub's `SOURCE_CONFLICT` to say. `conflictWords` (pure) turns that code
into `'refused: rail owned by <label>'`, the first labeled owner whose
session differs from `self` (`'another source'` when none is labeled); any
other reason passes through.

The existing `submit` stamps `now + lat` (execution at now + 2 x lat): flagged
on the host bead for its owner, not changed by this work.

### `src/model/actions.js`

```js
export function railOwners(ownerEntry, ownerSample);   // -> Array<{name: string, session: number}>, every
                                                       // owned pair, name '' when the source has no label
// railOwnerName keeps its meaning, now railOwners(...)[0]?.name || ''. Append-only hunk:
// Phosphor main carries uncommitted edits in this file.
export function railOwned(byRole, samples);   // -> boolean: pattern.running or advgen.running on (main's 6052b5f,
                                              // copied exactly); never control-owner
```

### `src/model/shadow.svelte.js`

```js
export function submitSegments(list);   // -> motionDoor.segments(list); one added export, nothing else
```

### `src/plugins/host.js`

```js
// validateManifest: PERM_RE = /^(intent|motion|net\.fetch|net\.listen:([1-9][0-9]{0,4}))$/   (ruling R-A)
export const MOTION_HOLD_MS = 500;
export function isHubUrl(u, host, port);   // deps.isHub's rule, exported for the node test
api.submitSegments(list);   // need('motion'); producer lock; -> SegResult
api.gate(field);            // unchanged signature; calls deps.gate(field, busy), busy the lock's words
                            // 'motion input in use by <plugin>' for every plugin but the holder, or '';
                            // streamGate places it last (plugins.svelte.js computes the rest)
api.net.fetch(url, init);   // -> Promise<Response>; need('net.fetch'). Throws Error('net.fetch: http or https only'),
                            // Error('net.fetch: the hub is reached through Valence') when deps.isHub(u),
                            // Error('net.fetch needs the shell') without deps.fetch; else deps.fetch(u.href, init)
// deps gain: submitSegments(list), now() (default performance.now), fetch(url, init) | null, isHub(URL) -> boolean
```

The producer lock is one `{name, until}` per host. An ok `submitSegments`
with `sent > 0` sets `until` to the latest end (`atMs + durationMs`) among
the sent items plus `MOTION_HOLD_MS`; an ok `submitMotion` sets
`until = now + (durationMs || 0) + MOTION_HOLD_MS`. Another plugin's
`submitSegments` or `submitMotion` before `until` returns
`{ok: false, sent: 0, reason: 'motion input in use by <name>'}` without
reaching the door. An empty list never takes the lock. Test (c) still
finds no transport name on the API object.

### `src/plugins/plugins.svelte.js`

- `deps.submitSegments`: the shadow's, with a refused result's `reason`
  through `conflictWords` over `railOwners` (the `control-owner` entry and
  its sample) and the link's session id. `deps.now = () => performance.now()`.
- `gate(field)`: BEFORE the read-only branch, when the field's entry is a
  c2h STREAM, return `streamGate` over: `live` (link phase), `roles`,
  `access` (the entry's), `halted` (the shadow's halted words), `running`
  (`railOwned(byRole, samples)`: `pattern.running` or `advgen.running` on).
  Never an owner rung: a foreign-held slot leaves Play live and the hub
  answers.
  Today such a field reads `'read-only: ...'`.
- `deps.fetch`: in the shell `(u, i) => import('@tauri-apps/plugin-http').then((m) => m.fetch(u, i))`,
  in vite dev `window.fetch` (ruling R-A).
- `deps.isHub(u)`: the hostname is the connected hub's and the port is
  empty, 80, 443 or the hub's WS port.

### `src/plugins/PluginSlot.svelte`

The watch effect also reads `machine.safety` and the control-owner sample,
so a latch or owner change re-runs a hero's `update()`.

### `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json` (ruling R-B)

CSP: `img-src 'self' data: blob: http: https:`; add
`media-src 'self' blob: http: https:`. `connect-src` unchanged. The
`http:default` allow list gains `{"url": "https://**"}`.

### Tests and docs

`test/plugins.test.mjs`: (e2) the segments door, every step above, against
a fake session with grants of latency 1000 us and horizons 250, 500 and
1000; `streamGate` order; a foreign-held slot never grays Play, a running
generator does, a `SOURCE_CONFLICT` reads `refused: rail owned by <label>`
with no lock taken; `railOwners`. (i) the producer lock with an
injected `now`; `submitSegments` without `motion` throws `PermissionError`;
`gate` shows the busy words to the other plugin only. (j) `net.fetch`
permission, scheme and hub refusals, init passed through, and a static CSP
and capability assertion. `docs/PLUGINS.md`: experimental API rows for
`submitSegments` and `net.fetch`, the permission row, the gate row's motion
input words, the CSP paragraph, and the Motion input paragraph's lookahead
rules.

---

## stash: `stash.js` (pure, injected fetch) and `library.js`

```js
// stash.js
export const SCENES_QUERY;   // GraphQL text: findScenes(filter, scene_filter) selecting what Scene needs,
                             // plus files.basename: the title of an untitled scene, else 'Scene <id>'
export const SORTS;          // [['date','Date'], ['created_at','Added'], ['title','Title'], ['rating','Rating'],
                             //  ['interactive_speed','Speed']]
export const COPY;
export function normalizeBase(text);   // -> 'http(s)://host[:port][/path]' without a trailing slash, or ''
export function rebase(url, base);     // -> url carried onto base's origin
export function withKey(url, key);     // -> apikey=key set (replaced, never duplicated); unchanged for key ''
export function toScene(raw, base, key);   // -> Scene
export function createStash({ fetch, base, key, timeoutMs = 8000 });   // -> StashClient
// StashClient = {
//   version() -> Promise<string>,                                        { version { version } }
//   scenes({q, page, perPage, sort, direction}) -> Promise<Page>,        scene_filter {interactive: true}; cached per query
//   script(scene) -> Promise<Script>,                                    GET scene.funscript with ApiKey; cached per id
//   clear() }                                                            drops both caches
// Errors are Error(words): 'Stash not set', 'no answer from Stash', 'Stash refused the key' (401, 403),
// 'refused: <status>', 'Stash: <errors[0].message cut to 50 chars>', 'not a Stash server'.
// The key never reaches a log line.

// library.js
export const CSS, COPY;
export function fitGrid(W, H);   // -> {cols, rows, perPage}: tiles 150..300 px wide that fit, at least one
export function mountLibrary(el, { getStash, prefs, onPick, onLocal, fetch });   // -> { refresh(), unmount() }
  // getStash: () -> StashClient | null, the same client until base or key change (it holds the caches);
  // prefs: {get(k), set(k, v)}; onPick(scene); onLocal(FileList); fetch: api.net.fetch, for the Test of
  // the connect card shown in its place (without it, Test stores the fields and tests getStash())
export function mountConnect(el, { api, onSaved, client });   // -> unmount(); client(v) -> StashClient
  // builds the client its Test asks; default createStash over api.net.fetch
```

`mountLibrary` fills its box: a head row of `var(--tap)` (search, 300 ms
debounce; sort; direction; Open files, `.fsp-lib-open`, which the player's
full layout hides because its source row carries one), a tile grid that
never scrolls (per page = cols x rows fitted by a ResizeObserver), and a
foot row (`←` Previous page, `page n / m`, `→` Next page, `N scenes`). Tiles are buttons: a fixed 16:9
box with a lazy screenshot, a one-line title, `duration · speed`. With no
base set it renders `mountConnect` in its place. `mountConnect`: Stash URL
(placeholder `http://host:9999`), API key (password), Save and Test
(`Stash v<version>` or the error words), stored in `api.prefs` `stash`.

`test/fixtures/fake-stash.mjs`:
`startFakeStash({ key, scenes = 30, video = null })` resolves
`{ url, seen: Array<{method, path, headers, body}>, close() }`: POST /graphql
(findScenes, version), GET /scene/:id/funscript, /scene/:id/stream with
Range, /scene/:id/screenshot as SVG; 401 without the key; no binary
committed. `test/funscript-stash.test.mjs` (node): request shape, header,
mapping, rebase and withKey, caching, every error in words;
`--live <base> --key <key>` prints what the assumptions need.

---

## player-ui: `ui.js` and `timeline.js`

```js
// ui.js
export const CSS, COPY, FULL_UP = 960, GLANCE_UP = 264, HOVER_IDLE_MS = 2500;
export function createPlayer(api);   // -> Player
export function createControl(deps);   // the controller without DOM: every boundary injected, for the node test
export function compositionOf(width), clampOffset(v), windowShare(v, lo, hi), ceilingOf(api, fields),
  localScene(files, createURL), extraNote(script, extra);   // pure helpers, node-tested
// Player = {
//   mount(el, fields, opts = {}) -> { update(), unmount() },
//       fields: {target, dur, pos?, lo?, hi?, vmax?, patRun?, advRun?, planEl?, planDur?} from the hero spec;
//       opts.fullscreen: the hover bar offers media fullscreen and the shell's mode (the page mount, page.js)
//       opts.settings: {open, toggle(on)}: the timeline's Settings button (the page mount)
//   dispose(),   hold, pause, revoke object URLs, stop the frame source; deactivate calls it
//   setInterp(scale),    re-map the loaded Script (scale.js wire) and restart a playing scheduler
//   setPlay(partial),    merge into prefs play, store it, apply it (setHome, setLatency, the loop)
//   scale,               the map in force, [lower, upper] (Auto's fit or scale.js mapOf), read by the settings card's Scale row
//   state }      PlayerState, read-only to everyone else
// createControl deps gain loop (clock.js createLoop, injected for the node test); the controller gains
//   setPlay(partial), markAB() (one A-B press: A at the playhead, then B, then clear) and get wire;
//   Auto Scale: get scale, get fit (under scaleAuto the script itself, the wire at scale 1, for the analyzer to
//   measure; else null), fitKinetic(sc, extent) (the analyzer's measure of fit, [min, max]; sets the map to
//   fitMap(extent)). A new script starts at [0, 1] until the measure lands.
export const PLAY_CSS;
export function mountPlay(el, { value, onChange });   // -> unmount(); the settings card's playback rows:
  // Loop, Loop count, Pause home, After pause, Home point, Home speed, Seek glide, Auto latency;
  // one var(--tap) row each, toggles On/Off, sliders over prefs.js's repair ranges; onChange(partial) on commit
// PlayerState = { phase: 'empty'|'ready'|'preroll'|'playing'|'held'|'error', scene: Scene|LocalScene|null,
//   script: Script|null, T, motion: boolean, status: {text, tone: ''|'warn'|'intent', notes: string[]}, view: 'player'|'library',
//   composition: 'full'|'handheld'|'glance', ab: {a, b} (media ms | null, runtime only), play: Prefs.play }

// timeline.js
export const ZOOMS = [5000, 10000, 20000, 60000], HEAT_BINS = 200, TRACE_MS = 8000, MIN_SPAN = 0.05;
export const HEAT_MID_UPS = 200, HEAT_TOP_UPS = 400;          // heat speeds, units/s: --reality, then --highlight
export const CSS, COPY;
export function curvePoints(script, fromMs, toMs, W, H, T);   // -> 'x,y ...'
export function dotPath(script, fromMs, toMs, W, H, T);      // -> 'Mx,yh0...': the actions as round-capped dots
export function kinPoints(render, fromMs, toMs, W, H);        // -> 'x,y ...', at most 2000; '' without pos
export function seekAt(x, W, durationMs);                     // -> ms
export function heatColor(ups);   // -> CSS color: --bg-sunken at rest, color-mix in oklab to --reality at HEAT_MID_UPS,
  // on to --highlight at HEAT_TOP_UPS and above; never red (law 13)
export function heatStops(script, T, ceiling);   // -> [{from, to (ms), ups, color, over}]: one run per action span by
  // |dpos| / dt in units/s (pos 0..100), equal neighbors merged, the lead-in before the first action at rest; over:
  // the chord speed through T's Range past ceiling.vmax
export function traceLines(trace, fromMs, toMs, W, H), clampRange(T, key, v), zoomStep(ms, dir);   // pure, node-tested
export function mountTimeline(el, { onSeek, onScrub, onRange, zoomMs = 10000, onZoom, onExpand, onLoop, onSettings, settingsOpen });
  // onExpand(on): the analyzer button (hidden without it); setExpanded(on) shows the answer.
  // onSettings(on): the Settings button at the cluster's right end (hidden without it), pressed from settingsOpen.
  // onLoop(): the A-B button (hidden without it); setLoop({a, b}) draws the points: a --highlight band on
  // the heat, dashed lines in the detail; the button's tooltip reads the next press (start, end, clear).
  // The playhead is one bar: its grip on the heat (the bottom band) and its line up through the
  // detail at the same x; the detail window is [m - s x zoom, m + (1 - s) x zoom], s = m / duration.
  // zoomMs: the starting window; onZoom(ms) on each zoom step (persisted as prefs zoomMs).
  // timeline.js may import only funscript.js, so its tf() restates applyT; the two must agree.
  // onSeek(ms); onScrub('start'|'move'|'end', ms); onRange(partialT, commit: boolean)
  // -> { setScript(script, T, ceiling, raw?), frame(mediaMs, trace, kin?), setExpanded(on), setLoop({a, b}), unmount() }
  // kin: the analyzer's Kinetic render (analyzer.kinetic) or null: the intent curve (--intent, data-kin), moved back by
  // T.offsetMs; without it or during a Range drag, straight lines between the actions
  // script: the wire (scale.js wire()), its actions drawn as --intent dots; raw: the parsed one; the heat
  // is heatStops(raw or script) as one linearGradient of hard stops over the overview, over-limit runs striped --warn
  // ceiling: {vmax: number | null, spanMm: number | null}
  // trace: Array<{m: media ms, u: 0..1 | null, stale: boolean, p?: 0..1 | null}>, telemetry.position on the
  //   media axis, last 8 s; p is plan.current as a window share (null when stale or absent), drawn under the script
```

One `Player` per activation owns the single `<video>` (no `controls`,
`playsinline`, `disablePictureInPicture`, never element fullscreen), the
`MediaClock`, the `Scheduler` and the rAF loop. The last mounted view hosts
the video; when it unmounts, the player holds and pauses. The gate is read
through `api.gate(fields.dur)` on every `update()` and every tick; a gate
or a fatal refusal pauses and sends no hold (the rail is not the player's
to command then). While preroll waits for its segment's end, each tick
calls `submit([])` so the preroll bundle's NACK (`refused: rail owned by
<label>`) ends it before the video starts; Play re-enables, nothing
retries. The status slot reads, first that applies: a fatal
refusal or media error, the gate, Positioning, Buffering, a transient
refusal, `overLimit` (warn: the script's peak chord, scaled by the range,
past `limit.input.speed`), then the first parse note or extra-axes note with
` (+N more)`; `status.notes` holds them all, the slot's tooltip one per line. The
library is mounted with `prefs` as `{get, set}` over `readPrefs` and
`writePref`, and `fetch: api.net.fetch`. Probe:
`window.__funscriptProbe` (a ring of 5000: sent segments, clock
observations, marks) only while localStorage `phosphor.funscript.probe` is
`'1'`. The controller marks `play` right before `video.play()`, `stop`
before `video.pause()` and `seek` before a `currentTime` set (`wrap` for a
loop), so a test can prove no other path drives the video.

Hover bar (ph-mcfe), in the stage of every view: the seek bar (role slider,
played and buffered fill, a time tooltip), Play/Pause, Mute, volume, the
time and, with `opts.fullscreen`, the mode and Fullscreen. The mode shows
where the shell sets `<html data-fullscreen-mode>` and dispatches
`phosphor-page-fullscreen-mode` (`detail: {mode}`); the shell stores it. Shown on pointer movement,
hidden after `HOVER_IDLE_MS` idle and on pointer leave; not drawn under 130
px of stage height. Play/Pause is `ctl.toggle()`, a seek `ctl.seek(ms)`;
volume and mute set the video's own and store pref `audio`; they are the
card's only mute and volume. Play and the time are the bar's; the strip
under the video (Motion, Offset, Invert, speed) draws its own only at glance
and beside the handheld analyzer. Keys on the
card root: Space and K toggle, J/L 10 s, arrows 5 s, M mute, F fullscreen.
Fullscreen dispatches `phosphor-page-fullscreen` (bubbles, cancelable,
`detail: {on}`) from the card; the shell's `preventDefault()` is the
yes, and the card takes `data-media` (the stage alone; page.js hides the
Settings section) until `phosphor-page-fullscreen-change` reads
`{on: false}`.

The trial notice `Preview: not saved` (tone `intent`, an `--intent` bar)
follows the gate in the slot order and stands while `api.trialPending`.

---

## analyzer: `analyzer.js`

```js
export const TUNING = 'Tuning', LIMIT_ROLES = ['limit.input.speed', 'limit.input.accel', 'limit.input.jerk'];
export const LAG_MIN_MS = -100, LAG_MAX_MS = 400, LAG_STEP_MS = 2, LAG_MIN_POINTS = 30, LAG_EVERY_MS = 500;
export const KIN_MAX_SAMPLES = 200000;   // a render keeps at most this many display samples (every >= EVERY)
export const WIDE_AT = 0.25, WIDE_SPAN = 0.5;   // the wall-free measure: window share p sits at WIDE_AT + p x WIDE_SPAN
export const CSS, COPY;
export function tuningGroups(model);   // -> [{name, fields}]: writable slider, stepper, toggle, segmented and
  // select fields of every group whose first ' / ' segment is 'Tuning' (RFC-094), named by the rest; then
  // writable fields sharing a write channel with those (the kinetic ceilings); then limit.input.* by role
export function lagOf(trace, script, T, key = 'u');   // -> ms in LAG_MIN_MS..LAG_MAX_MS minimizing the mean
  // |trace[key] - applyT(posAt(script, m - d))|, or null under LAG_MIN_POINTS fresh points or 0.1 of motion
export function toggled(f, v), fmtValue(f, v);   // pure, node-tested
export function wideExtent(raw, t0, dtMs, fromMs, toMs, T);   // -> [min, max] in script units of a wall-free render's
  // raw (wide-window shares from media t0, one per dtMs) over [fromMs, toMs], back through WIDE_*, T's Range and invert
export function kinText(state: 'wasm'|'fallback', render | {error} | null);   // -> 'Kinetic: wasm  n anomalies  stretched 250 ms'
export function mountAnalyzer(el, { api, trace, script, T, fit });   // trace(), script() (the wire Script, ctl.wire),
  // T(): the player's; fit(): ctl.fit
  // -> { frame(), mode: 'live'|'preview', kinetic: KineticRender | null, fit: {sc, key, extent} | null, unmount() }
  // kinetic: the latest render of the current script() (null while a newer script renders) through kinetic.wasm with limit.input.*, geometry.max_travel and
  // window.min/max by role and the Tuning rows as shown (drafts included), plus {t0, dtMs, lo, hi}
  // fit: once kinetic is current and fit() is a Script, one render of it with the same mm geometry in the middle
  // half of a window twice as wide (pos_e4 and endVelE3 through WIDE_*), the wall guards out of reach: extent is
  // wideExtent over the script's span; null without rail room for that window or on a refusal
```

The expand button on the detail opens it in place: the outer card rect is
unchanged (the tl box carries the stage's 16:9 spacer), the library leaves,
the video moves to an in-card thumbnail (full: the analyzer column's width,
`clamp(320px, 40%, 560px)` of the card, by 180 at the top right; handheld:
one tap high in the source row), never picture-in-picture (law 1).
Head: Live | Preview, Apply, Discard; a 20 px line with `Lag n ms  Plan n ms`
(or the last refusal); a 20 px Kinetic line (`kinText` after an `--intent` swatch, the legend of the
timeline's intent curve, the render itself; the version, the render time and
the anomaly kinds in its tooltip); then the rows, one `var(--tap)` each, in a list that
scrolls inside its box. Live writes through `api.write`; Preview through
`api.writeTrial`, Apply `api.commitTrial()`, Discard `api.revertTrial()`;
Preview is the default and is grayed on a hub without `action.trial`. A
segmented field of more than two options renders as a select.

---

## kinetic: `kinetic/kinetic.js`, `kinetic/bytes.js`, `kinetic/kinetic.pin`

```js
// bytes.js: export const WASM;   // base64 kinetic.wasm, written by node test/kinetic-pin.mjs --write; never edited
export const LEAD_MS = 125, PREROLL_MS = 1200, TAIL_MS = 1000, EVERY = 5, FREE = -32768;
export const TUNING;      // [[member, byte offset, 'f'|'u'|'b']]: kinetic_tuning (64 B, Kinetic²), Nucleus tools/kinetic-wasm/README.md
export const FLAGS = ['busy', 'shaped', 'fallback', 'clamped', 'refused'];   // kinetic_sample.flags bits 0..4
export const ANOMALIES;   // kinetic2::AnomalyKind names by value 0..12 ('' for none and the reserved kinds; 12 renders, never a drop)
export function tuningOf(pairs: [field, value][]);   // -> [[member, offset, type, value]]: by member name, an
  // _ms field to its _us member times 1000; non-numbers skipped
export function segmentsOf(script, T);   // -> { segs: [startMs, pos_e4, durMs, endVelE3, family][], t0, steps }
  // engine clock: a preroll to the first knot (start 2 x LEAD_MS, PREROLL_MS long) arriving at media 0, then one
  // segment per span at pad + at[k-1], endVelE3 the scheduler's endVel at rate 1 packed as the host packs it, FREE
  // (-32768, registry segment_end_vel_unspecified) where the knot is free (the preroll 0); t0 = T.offsetMs - pad is the media ms of engine 0; steps runs TAIL_MS past
export function* renderCore(k, q);   // k: the wasm exports; q: {limits: {vmax, amax, jmax, rail, horizonMs},
  // window: [lo, hi] mm, tuning: tuningOf(), segs, steps, stepMs = 1, every = 1, leadMs = LEAD_MS}; yields every
  // 8192 steps; returns KineticRender. Self-contained: the worker runs its source.
export async function instantiate(b64 = WASM);   // -> the exports, _initialize() called; the worker refuses a non-Kinetic² build
export function versionOf(k);                    // -> kinetic_version(), 'nucleus <sha12> kinetic2 <x.y.z>'
export function createKinetic();   // -> { ready: Promise<version>, render(q) -> Promise<KineticRender | {error}
  // | null>, close() }: one Worker from a blob URL; null when a newer render superseded it, {error} when the
  // planner refused the limits or the window; ready and render reject once the worker or the compile fails

// KineticRender, one sample every `every` 1 ms steps:
{ pos: Float32Array /* position_mm */, vel: Float32Array /* velocity_mm_s */, acc: Float32Array /* accel_mm_s2 */,
  raw: Float32Array /* the plan's p, a window share before the window clamp */,
  flags: Uint8Array /* ORed over the samples' steps */, anomalies: Uint32Array(32) /* steps with bit k */,
  counts: Uint32Array(5) /* steps with FLAGS[b] */, accepted, refused, plans, ms /* worker render time */ }
```

`kinetic.pin` holds `nucleus <sha>`, `version <kinetic_version()>` and
`bytes <n>`; `test/kinetic-pin.mjs` checks bytes.js against it and, with
emsdk and Nucleus clean at that sha, rebuilds and byte-compares.

---

## scale: `scale.js`

```js
export const RANGES;                  // frozen {scale: {min 0.25, max 1, step 0.01}}
export const SCALE;                   // frozen default {scale: 1, scaleAuto: true}
export function cleanScale(v);        // -> {scale, scaleAuto, map?}; prefs.js repairs the key 'interp' with it: scale clamped,
                                      // scaleAuto a stored boolean else true, map kept only as a fit (never stored)
export function mapOf(I);             // -> [lower, upper]: I.map, else [0.5 - 0.5 / scale, 0.5 + 0.5 / scale]
export function fitMap([min, max]);   // -> [min(0, min) floored, max(1, max) ceiled] on the 0.01 grid (1e-4 slack),
                                      // within [-1.5, 2.5] (the 0.25 gain's reach); [0, 1] when inside the window
export function wire(script, I);      // -> the Script the scheduler sends: every action p' = (p - lower) / (upper - lower);
                                      // `script` itself at [0, 1], so the scheduler runs byte-identical
export const COPY, CSS;
export function mountScale(el, { value, onChange, gain });   // -> unmount(); the settings card's Scale row, onChange(scale)
  // on commit: Auto toggle, slider and typed value 0.25..1 (manual), or the readout '0.01–0.97' (where 0 and 1 land)
  // from gain() ([lower, upper], polled at 4 Hz) with the slider disabled at the overall gain (Auto)
```

The controller schedules `wire(script)` (`ctl.wire`, `PlayerState.shaped`, the Kinetic preview's script too): one
segment per action, a same-direction knot at its chords' mean, every other knot free; the segments grant declares
no curve family (RFC-108: the hub's `smoothness` shapes a free knot). Tests: `test/funscript-core.test.mjs` (scale
section), `test/funscript-scheduler.test.mjs` (the end velocity).

---

## plugin: `index.js`, `prefs.js`, `manifest.json`

```js
// index.js
export const HERO;               // the frozen registration below without mount, so node checks the spec
export function activate(api);   // -> deactivate()
//   const player = createPlayer(api);
//   api.registerHero({ id: 'player', title: 'Funscript player', absorb: false,
//     cells: { h: [16, 12], v: [8, 16] },
//     spec: { require: { target: 'input.target', dur: 'input.duration' },
//             optional: { pos: 'telemetry.position', lo: 'window.min', hi: 'window.max',
//                         vmax: 'limit.input.speed', patRun: 'pattern.running', advRun: 'advgen.running',
//                         planEl: 'plan.elapsed', planDur: 'plan.duration' } },
//     mount: (el, fields) => player.mount(el, fields) });
//   api.registerSettings((el) => mountConnect + mountScale (gain: player.scale) + mountPlay, one unmount for the three);
//   registerPlayerPage(api, player, HERO.spec, that same function);   // page.js: the card, then a Settings section mounting it;
//     registered fill and mediaFullscreen (docs/PLUGINS.md, Pages): the card takes the pane, the section at most half
//   return () => player.dispose();

// prefs.js
export const PREFS;                    // frozen defaults: the Prefs shape above
export function readPrefs(api);        // -> Prefs, each key merged over its default, malformed values replaced
export function writePref(api, key, value);
```

`manifest.json`: kind `widget`, permissions `["motion", "net.fetch", "intent"]`
(`intent` for the analyzer's tuning writes; R-D superseded). It is listed in
`src/plugins/factory.js` because the host accepts `net.fetch` (ruling R-A,
pending: a veto reverts the host's `net.fetch` and the FACTORY entry
together, since test (g) validates every factory manifest).
`test/funscript-player.test.mjs`: `--unit` (in `npm run check`) checks every
export named here, the prefs and the hero spec; the default run is the
fake-hub browser test (`npm run check:funscript`, in `test:browser`); `--live
--port P --http P+7` runs the card against valencesim on spare ports, and
`--live-playback --port P --http P+7 [--shots dir]` plays a 60 s clip there
with auto latency, a seek glide, a 14 s gap held as one span, a pause home, an A-B loop and a
Preview write, printing one `PB-RESULT` JSON line.
