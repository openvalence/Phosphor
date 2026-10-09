# Funscript player (factory plugin)

`plugins/factory/funscript-player/`: plays a local or Stash video and drives
the rail from its main (L0) funscript. Epic `ph-smvd`; one child bead per
module. Exact signatures and shared data shapes:
[CONTRACT.md](../../plugins/factory/funscript-player/CONTRACT.md), the one
place they live. This file holds the design and its reasons.

Synthesized 2026-10-03 from three independent designs (sync-first,
operator-UX-first, protocol-strict): the sync strategy is the first, the
card is the second, the motion path is the third, each conflict resolved in
Decisions below.

## Rulings needed before the host lands them

| id | flag | what | without it |
|---|---|---|---|
| R-A | CANON FLAG, DESIGN §2 "no HTTP backdoors" | `api.net.fetch(url, init)`, permission `net.fetch`, through the shell's tauri-plugin-http; refuses the connected hub's own origins, so it never becomes a machine path | no Stash: the CSP refuses a plugin's page fetch (`connect-src`), although Stash answers the preflight (v0.31.1, measured 2026-10-03: allow-origin `*`, allow-headers `Apikey, Content-Type`) |
| R-B | config | CSP `media-src 'self' blob: http: https:` and `img-src` + `http: https:`; http capability + `https://**:*` (`:*`: any port) | `media-src` falls back to `default-src 'self'`: not even a local file (blob:) plays in the shell |
| R-C | CANON FLAG, PLUGINS.md "manifest plus one module" | a multi-module factory plugin; Vite bundles the siblings; an override copy in the plugins folder must be bundled into one file first | the plugin builder inlines the modules into `index.js` at the end (the import graph has no cycles and no import-time side effects) |
| R-D | pushback on the computed task | permissions `motion` + `net.fetch`, not `intent`: the player writes no field, and declaring an unused permission defeats the honesty model. The manifest gets no `panes` key: the schema has none; registration is code (`registerHero`, `registerSettings`). Superseded for `intent` by the analyzer (ph-smvd.11, A1): it writes tuning | — |

When ruled, R-A and R-C become rows in DESIGN.md's Amendments table and
sentences in PLUGINS.md; R-B is a CSP edit verified in the real shell (C-8).

## Modules

| key | files | brief |
|---|---|---|
| core | `funscript.js` | parse and validate (sort, dedupe, clamp, `inverted`, `range` ignored, notes), linear interpolation, chord speed, thinning that keeps extrema, heat bins, axis naming and file pairing; pure |
| scheduler | `clock.js`, `scheduler.js` | the media clock (rVFC display times, median, slew, step), one segment per funscript span, offset/range/invert, stop and preroll segments, the per-frame submit cadence, refusal classes |
| host | kernel files | `api.submitSegments`, the lookahead door in `motion.js`, `api.gate` on a motion-input field, the producer lock, `api.net.fetch`, the CSP; generic, no funscript knowledge |
| player-ui | `ui.js`, `timeline.js` | the controller and the card: video stage, overview heat and scrub, the automation detail view, the strip, status slot, layout tiers |
| stash | `stash.js`, `library.js` | GraphQL client over an injected fetch, caching, URL keying, the library grid and the connect card, the fake Stash |
| plugin | `index.js`, `prefs.js`, `manifest.json` | registration, the settings card (Stash connect, Scale, playback), prefs defaults, the factory entry, docs, the fake-hub browser test and the live smoke |
| scale | `scale.js` | the map every action takes before the wire, Manual or Auto; the settings card's Scale row (Interpolation) |
| analyzer | `analyzer.js` | the expanded detail: lag readouts and the hub's Tuning controls, Live or Preview (Analyzer) |
| kinetic | `kinetic/kinetic.js`, `kinetic/bytes.js`, `kinetic/kinetic.pin` | the machine's planner (Nucleus kinetic.wasm, pinned) in a Worker: the analyzer's motion preview (Kinetic) |

Order: core, host and stash start at once; scheduler follows core's
signatures (not its code); player-ui codes against all contracts; plugin
integrates last. Shared kernel files (`host.js`, `plugins.svelte.js`,
`plugins.test.mjs`, `PLUGINS.md`) are re-read before each edit.

## Motion path

```
<video> frame (rVFC: mediaTime, expectedDisplayTime)
 -> clock.js MediaClock (media ms -> performance.now() ms the frame is shown)
 -> scheduler.tick() once per animation frame: Seg[] from the cursor, up to 32
 -> api.submitSegments(list)          host.js: motion permission, producer lock
 -> shadow.svelte.js submitSegments
 -> motion.js door.segments           latch, segments STREAM by role, lazy grant,
                                      exec time -> hub stamp, half-horizon head
 -> session.publishSegment            library: span, horizon, token bucket
 -> STREAM frame on the segments channel (0x2101 on valencesim, by role)
 -> hub arbiter and planner
```

Nothing else reaches the machine: no setpoint, no samples, no intent, no
safety op, never resume. `api.net.fetch` refuses the hub's origins.

The player speaks execution time only: `{atMs, norm, durationMs}`, `atMs`
an absolute `performance.now()` instant at which the machine should START
the segment. The host owns every protocol timing fact: it reads `hubNowUs()`
and `now()` together, converts, subtracts the grant's
`schedule_latency_us` (RFC-059: execution = stamp + declared latency),
clips a late start to the earliest executable instant keeping its end,
drops what is left under 10 ms, rounds `t_off` to 100 us, and sends only
what starts within half the granted horizon (RFC-087 keeps RFC-014's
"no further ahead than half that budget"; the registry's
`max_future_schedule_ms` note says the same). `sent` tells the player how
far to advance; each segment is sent once.

Measured on valencesim 0.1.6-p4hub (design 2's probe): the segments grant
is rate 50, `schedule_latency_us` 1000, no horizon key (250).

Why segments, not 20 ms samples through `submitMotion` (numbers at the
default 250 ms horizon):

| | segments (chosen) | samples via submitMotion |
|---|---|---|
| lead | 125 ms of scheduled motion | none: each point is chased on arrival |
| stall tolerance | about 105 ms before a knot moves | the chase budget, then a lurch |
| frames/s | the action rate, 2 to 6 typical | 50 |
| knot timing | t_off 0.1 ms, duration 1 ms | on a 20 ms grid |
| seek | one superseding bundle, one RTT | no flush |

A larger hub horizon (500, 1000 for poor WiFi) widens the lead to 250 or
500 ms; seek latency does not change, because a new bundle supersedes
everything from its `t_base` (RFC-087 item 5).

Content goes as authored (SPEC §9.6 clauses 2, 4, 5): one segment per
action gap, every knot free but the rests the player sees (Sync item 8),
the grant declaring no curve family (the hub's
`smoothness` shapes a free knot, Interpolation), no client feasibility past the handoff bound. Dense scripts are sent as authored
and thinned only after a `RATE_EXCEEDED`, at the grant rate, extrema kept.

## Interpolation

Retired 2026-10-08 (ph-1qs5.1; operator: "retire now, re-write the funscript
settings to work with [the K2 set] ... trim the surface"; RFC-106, RFC-108).
The hub shapes the curve between actions: its `smoothness` on the Tuning card
(0 crisp, 1 smooth), with its handle floor and maximum trim; the analyzer
lists them when the hub carries them (it binds the Tuning rows by catalog).
The player sends one segment per action and declares no curve family; the
client modes, tension, bias, Smoothing and the slew limit are gone. A saved
`interp` pref keeps `scale` and `scaleAuto` and drops the rest. The detail
view draws the twin's render of the wire (Kinetic) as the intent curve and
the actions as dots; without the twin, or during a Range drag, straight lines
between the actions. Scale stays.

**Scale** (ph-6e36, ph-bk6h). A curve the hub renders above `smoothness` 0
overshoots by construction (RFC-106 item 3), so a stroke that touches the
window's end is cut there by the hub: its wall guard trims the end velocity
and the clamp holds the position (RFC-100 `clamped`). Every action takes the
affine map `p' = (p - lower) / (upper - lower)` before the wire (`scale.js`
`wire()`): the scheduler, the drawn curve and the Kinetic preview all run on
the mapped actions. Prefs key `interp`, mirrored as
`phosphor.funscript.interp`: `{scale, scaleAuto}`; the row sits on the
plugin's settings card (and the page's Settings section, the same card).

- **Manual**: one symmetric gain g, 0.25 to 1.00 (`scale`, default 1.00):
  `lower = 0.5 - 0.5 / g`, `upper = 0.5 + 0.5 / g`, so every action moves
  about the window center. There is one slider, not one per end.
- **Auto** (`scaleAuto`, default on; a stored `false` stays off) fits each
  end on its own from the whole script's extent `[min, max]` at scale 1:
  `lower = min(0, min)`, `upper = max(1, max)`, each rounded outward to the
  0.01 grid (`fitMap`; an end within 1e-4 of the grid stays on it, the
  planner's own e4 and float32 noise), at most the 0.25 gain's reach
  (`[-1.5, 2.5]`). A script that overshoots only the top keeps its bottom
  actions where they are, and the reverse.

The row: an Auto toggle (`Fit the curve to the window`), the slider
(`Scale`) and a typed value. Under Auto the slider grays at the overall
gain `1 / (upper - lower)` and the value reads where the script's 0 and 1
land, `0.01–0.97`. A new script starts at `[0, 1]`; the extent then comes,
in script units (the curve fits the Range, the whole window at the default
Range), from the machine's planner when its measure lands (analyzer.js
`fit`, `wideExtent`): the wire at scale 1 rendered by Kinetic with the same
mm geometry in the middle half of a window twice as wide, so the wall guards
never bend it and the extent is the hub's own render, read back through the
Range and invert. The guards are why the preview's own render cannot be
measured: at the real window they already trimmed the overshoot. Every card
outside glance frames its analyzer, shown or not; without rail room for the
doubled window, in glance or in the fallback the map stays `[0, 1]`.

The fit needs the whole script, so it stays in Phosphor: the hub never sees
the whole script.

Measured 2026-10-08 (window 0-100 mm, the vendored twin at Nucleus cc4888b,
Kinetic 04c1439, which renders `smoothness`): Auto reads `0.00–1.00` on the
browser test's real-shaped script. At `smoothness` 0 and 1 the twin's
unclamped plan stays inside `[0, 1]` (to 1e-4) on a top-only 100-70-100
tease, on rises through a same-direction knot to the top and on an 80-knot
seeded script, while `smoothness` moves the plan by up to 0.24 of the
window on the last: Kinetic² renders a reversal flat at every
`smoothness`, so these scripts give the fit no overshoot to measure.

- **I1** One segment per action (operator ruling 2026-10-04) stays; "ending
  at the mode's tangent" is superseded by the retirement above (2026-10-08):
  the tangent is the hub's (I8).
- **I6** Auto measures in script units against the Range, not the window:
  a narrow Range scales an overshoot the window would still hold. Veto:
  fit the window (the Range's center then moves with it).
- **I7** A knot between two chords of one sign carries their mean (at most
  1.5 x the lesser); a reversal, a hold edge, the
  ends and the seek glide's landing are free. A free knot rests until its
  successor is scheduled (SPEC §9.6, RFC-058), and at the 125 ms lead the
  hub then re-shapes only the last 125 ms of the piece toward it. Measured
  on the twin (Nucleus 91243d4; 400 to 697 ms staircase spans; vmax 1200
  mm/s, amax 100000, jerk 2e7): left free, the carriage passed
  same-direction knots at 0.52 of the chord speed (least 0.43; 0.81 at a
  240 ms lead); with the mean, 0.97 (least 0.95). On valencesim 0.1.30
  (`--live-playback`) the plan's speed through non-reversal knots read 0.28
  of the span peak free and 0.94 to 0.97 with the mean. Cost: `smoothness`
  does not reach a same-direction knot (RFC-108 item 6: an authored knot
  keeps its angle), only reversals, hold edges and ends. Superseded by I8
  (2026-10-08, ph-hcof).
- **I8** The hub carries the tangent; the sender declares the rests it can
  see. Nucleus 0.1.32 (val-g62) arms Kinetic `Engine::expect` on every stream
  segment for the larger of `stream_quiet_release_ms` (500) and the grant's
  horizon: the newest free knot renders through toward a provisional
  successor at chord speed instead of at rest. So every same-direction knot
  is free (`endVel` null), and the sender declares the rests it can see:
  ends, gaps, loop wraps, seek landings, reversals and hold edges
  (scheduler.js `knotVel`, `endVel` 0, has_v): the script's last action, an
  action whose successor is over `EXPECT_MS` (500) of wall time away (media
  ms / rate), the A-B loop's last action before the wrap (the successor is
  not the script's next action), a seek's landing, a reversal (the chord's
  sign flips) and a hold edge (a flat chord on either side). Amended
  2026-10-08 (`ph-hcof`): on the machine a free reversal whose span outlasts
  the 125 ms lead was rendered moving on along the last chord before its
  successor arrived (the plan dipped past a trough and came back).
  `EXPECT_MS` restates the registry's `stream_quiet_release_ms`: the plugin
  API publishes no grant horizon, and the hub's window is never shorter.
  The expectation is fixed at solve time, so a stream that stops passes
  its last free knot moving and brakes past it by v²/2a of the chord speed
  (5 mm at 1000 mm/s and 100000 mm/s²); the hub cannot see the end, the
  player can. Measured on the twin (Nucleus 74ff1cb, Kinetic 540938d; vmax
  1200 mm/s, amax 100000, jerk 2e7, window 100-400 mm; staircase 20..80 by
  15 and back, 400 to 500 ms spans, 3 laps, 18 same-direction knots): knot
  speed over the chords' mean 1.07 (least 0.84, max 1.36) with the
  expectation, 0.60 (least 0.56) without it. The least is the second knot
  after the start from rest; on a 10..90 by 10 staircase the knots inside a
  run read 0.99 mean (least 0.84); at uniform 450 ms spans the middle knot
  of a 4-knot run reads 0.935. The hub's curve sets these, not the wire:
  the speed overshoots the chord after a reversal and settles under it
  mid-run. A fast run to the end (20, 50, 80 at 200 ms): rested, 0.13 mm
  past the last action; left free, 2.28 mm. A knot before a 1.5 s
  successor is reached at 0.02 mm/s. Left free, the real-shaped browser
  script's 260 ms flicks' top reversal read 1.0e-4 of the window high in
  the Auto measure; sent at rest it reads 1.0000000 and Auto reads
  `0.00–1.00` (a rest landing on the window edge still reads f32 noise,
  1e-7, as `clamped` for a few ms). The vendored twin renders a free reversal flat on a 300 ms
  sine (`test/kinetic-trace.test.mjs` (3)), so the machine's dip is not
  reproduced there; the test guards the rest. Veto: the I7 mean on
  same-direction knots (0.97, least 0.95), which keeps `smoothness` off them.

## Sync

1. **Three clocks, one map.** Media time is the master. One affine map
   per anchor, `displayAt(m) = c0 + (m - m0) / rate`, from
   requestVideoFrameCallback's `(mediaTime, expectedDisplayTime)`, so a
   stamp targets the instant the frame is SHOWN, not `currentTime` (1 to 2
   vsyncs early). Client-to-hub conversion happens in the host at send
   time; no anchor is ever cached in hub time.
2. **Jitter and drift.** Residual = observed display time minus
   `displayAt`, median over 32 frames. Until 32 frames after an anchor,
   correct by the whole median; then slew at most 5 ms/s (audio-clock drift
   is 0.01 to 0.1 ms/s). A median of the last 8 past 25 ms, or a settling
   correction past 25 ms, re-anchors and restarts the schedule. Only a
   frame that advances the media time anchors or observes. Without rVFC
   frames for 250 ms (audio only, hidden video, glance) the clock reads
   `currentTime` on rAF; that bias is the offset's to trim.
3. **Tiling.** Span k becomes `atMs = displayAt(at[k-1]) + offset`,
   `durationMs = (at[k] - at[k-1]) / rate`, `norm = applyT(pos[k])`. All
   spans come from one map, so each start is the previous end and the hub
   hands off at each successor's start (SPEC §9.6). Per-frame re-anchoring
   (design 3) was rejected: it puts plus or minus half a vsync of jitter
   into every stamp and breaks the tiling.
4. **Events.** `playing` and `seeked` anchor on the next frame and restart (a
   seek while playing restarts with the glide, Playback; a loop wrap is no seek);
   `ratechange` anchors at the new rate and restarts; `pause`, `seeking`,
   `waiting`, `error`, a hidden page and an unmount send one hold; `ended`
   sends nothing (the last segment ends at rest).
5. **Restart is a supersede.** The in-progress span goes first with its
   start in the past (the host clips it, keeping the knot time), then the
   window. The hub drops everything it held from that `t_base` on. A restart
   that changes only timing (a clock step, the compensation) while the sent
   schedule still runs is the exception: re-sending the in-progress span
   repeats the target the hub just took, and the hub's dwell rule (SPEC §9.6,
   `segment_dwell_span` 0.02) reads a repeated target as a hold, zeroes its
   end velocity and stops the machine mid-stroke. So nothing sent is re-sent:
   the first unsent span starts at the end of what was sent and absorbs the
   shift, when the shift is at most half that span.
6. **Offset.** One global trim, -500 to +500 ms in 5 ms steps (Shift 50),
   + = machine later. Zero means the declared latency is already applied
   (RFC-059 allows a user trim whose zero is the declared value). Applied by
   one restart on release.
7. **Hub clock.** The library resyncs from one CLOCK exchange every 10 s and
   adopts each one, so an asymmetric RTT moves the offset by up to RTT/2.
   Measured on valencesim (localhost RTT 1 to 16 ms): plan lag against the
   knot followed the adopted offset (slope 0.92, r 0.99), stepping at each
   resync, and pass A's adherence spread p95 read 3.1 to 7.1 ms. On this
   sim the error is one-sided: the hub stamps t1 when its tick reads the
   frame, so offset = truth + RTT/2 within 0.5 ms across RTT 1 to 17 ms,
   and back-to-back exchanges phase-lock to that tick (20 of 20 at 14 to
   18 ms). The plan lag is therefore a stable floor plus half the chosen
   exchange's RTT, and which exchanges a session happened to draw set its
   whole level (round 1 runs: 10.8 to 20.4 ms). The door
   (`motion.js` `filteredHubNowUs`) keeps the last 32 exchanges and
   stamps from the one with the least bound, RTT/2 plus age x 50 ppm
   (`CLOCK_DRIFT`, an assumed crystal error), so a fast exchange stays
   chosen until a fresher one's bound beats its age; it hunts 16
   exchanges at random gaps up to 250 ms on first use (the player's warm
   call at load, before Play) and on every `live`, and drops them on a
   close. Measured after it: 12 passes in 6 sessions, medians 14.0 to
   15.9 ms (each the floor plus half its best RTT), first-half vs
   second-half step under 1.5 ms. A count window (the last 4) evicted the
   hunt's best exchange at the first resync and stepped a run +4.2 ms
   mid-play. The filter belongs in Valence's `clients/js` `syncClock`
   (SPEC §7.1), where every consumer shares it; the door's copy goes when
   that lands.
8. **End velocity on the wire** (ph-t9go, ph-1qs5.1, ph-hcof). Every knot
   is `unspecified` (`input.end_velocity` absent, SPEC §9.6 item 5): the
   hub expects successors on a stream and its `smoothness` shapes the knot.
   The rests the player can see are sent at 0: the script's last action, an
   action whose successor is over `EXPECT_MS` (500 ms) of wall time away,
   the loop's last action before the wrap and the seek glide's landing
   (Interpolation, I8, with the measurement). Stop, preroll and home end at
   0, since nothing is scheduled after them.
9. **Every knot is sent.** A same-direction step under
   `segment_dwell_span` (0.02 of the window) is a knot like any other: the
   hub zeroes no declared velocity on it. Measured on the twin (a 1 to 4
   point random walk, 120 knots at 200 ms, the I7 mean on same-direction
   knots): no anomaly, no non-reversal knot at rest, 0.07 mm at the knots;
   merging those steps into their neighbors' span cost 7.4 mm there.
10. **Error budget on the sim.** Clock under 0.3 ms, t_off grid 0.1 ms,
   duration rounding 0.5 ms, display map quantized to half a vsync (8 ms at
   60 Hz). Panel lag and Bluetooth audio delay are physical: the offset
   trims them; the Hardware phase measures them with a photodiode and the
   scope.
11. **Untrusted frame metadata** (ph-epej). WebKit reports rVFC's
   `expectedDisplayTime` off the document time origin, and the map
   extrapolated the gap into media time (the readout ran hours past a 37 s
   video). The wall side is the callback's `now` (`performance.now()` when
   they differ by over a frame); `expectedDisplayTime` counts only within
   100 ms of it. A `mediaTime` that is not finite, over 1 s from
   `currentTime` or outside the duration yields to `currentTime`.
   `mediaAt()` never leads the last frame by more than one frame, and the
   readout never passes the duration. The first trip logs one warning with
   the raw fields. Sane metadata (Chromium) passes unchanged.

## Safety

- **The gate.** `api.gate(fields.dur)` on the segments field returns, in
  order: `no hub link`, `session not authorized`, the latch words
  (`e-stop latched`, `paused, resume to continue`), `stop the pattern first`
  (`pattern.running` or `advgen.running` reads on, `railOwned`), `motion
  input in use by <plugin>`. Play is grayed with the words in the status
  slot (law 3); `PluginSlot` re-runs `update()` on a latch or owner change.
  Control-owner is never read (rail ruling, operator 2026-10-03): a slot
  stays held for its session's life, so a foreign stream is the hub's
  `SOURCE_CONFLICT` to say.
- **Mid-play.** The scheduler re-reads the gate every frame and the door
  refuses under the latch. Any gate or fatal refusal pauses the video in
  the same frame, sends nothing, and shows the words: the rail then
  belongs to a generator, another session, another plugin or the latch,
  and a hold would land in their stream (on valencesim, which accepts both
  sources, it did: G2).
- **A refusal the gate cannot see.** A STREAM bundle has no answer, so a
  `SOURCE_CONFLICT` from a source the gate does not show arrives as a
  NACK after the bundle that drew it. The hub drops that bundle; the
  player pauses on the next frame (during preroll an empty call each frame
  surfaces it before the video starts) and the status slot reads `refused:
  rail owned by <label>` (`another source` when the hub labels none). Play
  re-enables; nothing retries. Bundles sent inside that round trip
  (one, measured on the fake hub) are refused the same way; none follow.
- **Never auto-resume.** When a gate clears, Play re-enables and nothing
  restarts. The strip's Resume re-arms the hub only (SPEC §11.1); the
  card's Play is the operator's act. Design 2's continue-on-PAUSE-clear was
  rejected for that reason.
- **Every stop of the player's own is a command.** Pause, seek, a stall, a
  media error, a hidden page, an unmount and deactivate send one hold: the script
  continues `min(200 ms, to the next action)` and ends at rest. A vanished
  client leaves at most half a horizon of scheduled motion, which then
  rests (RFC-058; SPEC §11.5 invariant 1).
- **Preroll.** On Play, a machine more than 5 % of the stroke from the
  script's position first gets one positioning segment of
  `400 + 1200 x |delta|` ms ending at rest; the video starts at its end.
  Unknown position counts as delta 1.
- **One producer.** The host refuses another plugin's motion until the
  holder's last sent segment ends plus 500 ms, so buttplug or TCode never
  interleave with the player in one stream source.
- **Bounded output.** Targets clamp to 0..1 of the hub's window and the hub
  clamps again. Speed is not clamped here: durations are the script's and
  the hub's planner holds `limit.input.speed` (valencesim: a script asking
  8333 mm/s peaked at its 1000 mm/s limit). The meter, the heat and the
  status slot (`Script past the input speed limit`) say so.
- **Malformed scripts.** Unparseable JSON, no actions array, no valid
  action, more than a million actions or an action past 24 hours are
  refused in words with Play grayed; the 24 hour cap runs before the 60 s
  span split, which once expanded one gap to 16.7 million knots. Repairs
  (sorted, deduplicated, positions clamped, invalid actions dropped, long
  spans split, `range` ignored) play and are each named: the slot shows
  the first with a count of the rest (`1 invalid action dropped (+4
  more)`), its tooltip lists them all, one per line. A gate, a refusal or
  the over-limit words outrank them in the slot; the tooltip keeps them.
- **Containment.** No element fullscreen, picture-in-picture or native
  controls (law 1): the strip's e-stop and pause stay on screen. Media
  fullscreen is the shell's page fullscreen, bare, so the stop pair floats
  over the video (Hover controls). No red (law 13).
  The analyzer's expand keeps it: the video goes to an in-card thumbnail,
  not to picture-in-picture (A2).

## The card (player-ui)

### The page redesign (operator rulings 2026-10-08, `ph-1qs5`, `ph-5u0g`)

Accepted as drawn ("yes, I like this") on the redesign mockup, with three
amendments: on phones fullscreen is a real fullscreen (Android immersive,
DESIGN §10.3); the quick rail is one design, vertical on phones and
horizontal on the desktop; the quick rail is reachable inside fullscreen on
both. Same day: the desktop has no bottom dock; its quick rail exists only in
fullscreen. Operator, peeve 8: "this is where a portion of users will spend a
significant amount of time." Merges the ten style findings (`ph-1qs5` notes)
and Android peeves 5 to 9 (`ph-5u0g` notes). The ids PR1 to PR18 follow the
mockup's callout numbers. Superseded rulings below are marked in place.

The page has three classes, read from the shell's bucket (DESIGN §10.12):
PHONE PORTRAIT and PHONE LANDSCAPE are buckets 1 and 2 (landscape when the
window is wider than tall), DESKTOP is bucket 3 and up. The Dash card keeps
its own box-driven compositions (full, handheld, glance, below); its full
and handheld compositions take the player bar (PR5) and the timeline head
(PR7) too, because they are one code path, and glance is unchanged.

```
PHONE PORTRAIT (420 x 860)          DESKTOP (1428 x 900)
+------------------------------+    +--------------------------------------+--------------+
| 01 PLAYER  title  [Player|Library]| 01 PLAYER  title   Open video  Open  | 02 LIBRARY   |
| stage: video aspect, or the  |    |   script  Close                      | search, sort |
|   120 px strip (open buttons,|    | stage, fill (ph-yuce)                | rows, paged  |
|   or the stroke meter)       |    | split bar                            |   (or 03     |
| TIMELINE head: A-B offset Inv|    | TIMELINE head: zoom - + span, A-B,   |   SETTINGS   |
|   Graph (collapsible)        |    |   Offset, Invert, Graph              |   in this    |
| wave screen                  |    | wave screen                          |   slot)      |
| scrub: 0:41  heat  -3:01     |    | bar: prev Play next 0:41 heat -3:01  |              |
| bar: prev Play next Motion   |    |   volume Motion rate Fullscreen Sett.|              |
|   rate Fullscreen Rail Sett. |    | status row, 3 px tone bar            | page n / m   |
+------------------------------+    +--------------------------------------+--------------+
| page footer: status slot     |
+------------------------------+
```

- **PR1 Shell card chrome.** Player (01), Library (02) and Settings (03) are
  shell cards (`.surface-card`) under numbered uppercase heads; the Player
  head's title slot carries the media name (the old source row goes). No
  private frame inside: no framed status box, no shadowed overlay, no boxed
  meter or stage. The `--screen` plates of the wave and the heat stay.
  Resolves finding 7.
- **PR2 Stage.** On phones the stage follows the video's aspect: its height
  is the width over the aspect, capped by the room above the fixed rows, so
  a portrait video stands tall and a landscape one is a strip. Empty, it is
  a 120 px strip. The desktop keeps the filled stage row (`ph-yuce`).
- **PR3 Open video and Open script**, either order: on the empty stage and
  in the Player head, with Close beside them once something is loaded (on
  phones the head holds a Media menu: Open video, Open script, Close). A
  video opened later attaches to the loaded script and a script to the
  loaded video. Open video's picker is `multiple` and also takes
  `.funscript`, so a pair picked together still pairs by base name
  (`pairFiles`); Open script takes `.funscript` only. Peeve 7.
- **PR4 Motion only.** A script with no video plays against the clock and
  the stage strip shows the stroke meter (an intent tick for the script, a
  reality tick for the measured position, glance's look). Fullscreen is
  grayed with the reason `No video`. Peeve 7.
- **As built, PR1 to PR4 (`ph-1qs5.2`, where it differs from the text):**
  Close is always drawn in the desktop head and grayed while nothing is
  loaded (fixed geometry: a state change never moves a control); on phones
  it is the Media menu's third row, grayed the same way. The Media menu is
  a popover (a tap outside or Escape closes it). Open video's picker takes
  `video/*`, the audio a webview plays (`audio/mpeg`, `audio/mp4`,
  `audio/aac`, `audio/ogg`, `audio/wav`, `audio/flac`, `audio/webm` and the
  extensions `.mp3 .m4a .aac .ogg .oga .opus .wav .flac .weba`) and
  `.funscript`; never `audio/*`, which lets the OS picker offer MIDI
  (operator ruling 2026-10-08). The library head has no Open files. Phone
  landscape without a video is the full composition (stage left, library
  right) until the compact hero lands. Phone portrait: the split bar is
  not drawn and the wave keeps 96 px, so the stage row has the room PR2
  needs; the page fills to the window's bottom from its own top (the host
  fills pages on the desktop only; `ph-1qs5.8` hands that to the host's
  phone footer). Motion only: a script picked alone is a scene with no
  stream; the controller runs a silent clock over the script's duration
  (play, pause, seek, rate and end as a video's). The motion-only meter is
  horizontal at every class. The 120 px strip and the stroke meter's track
  are `--screen`; the empty stage wears a dashed `--line-3` edge.
- **PR5 One player bar.** Desktop: directly under the stage, above the
  timeline head (as the mockup draws it; review 2026-10-08). Phones: at the
  bottom of the Player card, directly above the footer: loading a video or
  collapsing the timeline never moves it, the stage and the gap above absorb
  the change. Phones: a full-width scrub row
  (elapsed, heat, remaining) over a button row: previous, Play, next,
  Motion, rate, Fullscreen, quick rail, Settings. Desktop: one row:
  previous, Play, next, elapsed, heat, remaining, volume, Motion, rate,
  Fullscreen, Settings (no quick rail inline on the desktop, PR11). Every
  target is at least 40 px under a coarse pointer (law 12). Graph moves to
  the timeline head, Close to the Player head, volume into Settings on
  phones (the hardware keys work as well).
- **PR6 Motion beside Play,** in the shell's on look (`.og-btn.on`, reality
  and its glow): the switch that lets Play move the machine. Resolves
  finding 1.
- **PR7 Timeline head row.** The timeline band has its own head: a caret and
  TIMELINE, then (desktop) zoom − + with its span, A-B, Offset (`.og-num`,
  ms), Invert, Graph. The wave screen sits under it with nothing over it.
  On phones the band collapses to its head by the user's own tap (kept as
  pref `tlOpen`) and zoom is pinch. The split bar stays on the desktop only.
- **As built, PR5 to PR7 (`ph-1qs5.3`, where it differs from the text):**
  the bar takes its two rows (scrub over buttons) on phones and on the
  handheld dash card. A desktop page whose player column would drop under
  600 px (`BAR_ROW_MIN`) beside the 320 px library shuts the library for
  the session so the bar keeps its one row (1024 x 768: the column is about
  450 px; the row needs about 520); the pref `libOpen` is not written, and
  the caret reopens it (the bar then wraps). The media name shows in the
  phone head too, ellipsized. Phones hide the bar's volume
  (hardware keys; its Settings row comes with `ph-1qs5.5`). A narrow bar
  (under 22 em) drops volume; a narrow head drops the `ms` unit (under 20
  em), then the word TIMELINE (under 18.5 em; the caret stays). The zoom
  group shows on the full card only; the handheld card and phones pinch.
  The stroke speed reading stays at the wave's foot, right of the range
  pills, as the mockup draws it: it is the screen's own readout
  (`pointer-events: none`), not a control over the wave. The caret
  collapses the band on the desktop too (one rule, pref `tlOpen`). Opening
  a file switches a handheld card to its Player tab. The quick rail button
  is in the bar's markup and shows only where the host publishes
  `api.icons.quickRail` and `<html data-quick-rail>` (phones; `ph-1qs5.8`
  wires the host). The dash card has no Fullscreen or Settings in its bar
  (page fullscreen and the settings section are the page's).
- **PR8 Fullscreen or not.** Fullscreen is one mode, a player-bar button: the
  shell's page fullscreen, bare (DESIGN §10.3). The window goes fullscreen
  on the desktop; Android is immersive. No In window / Borderless mode and
  no mode glyph; the page never sends `bare: false` or
  `phosphor-page-fullscreen-mode`. Peeve 9.
- **PR9 The hover bar is fullscreen only.** It keeps the `ph-mcfe` shape,
  the round seek dot and the idle timer; its bottom row is the player bar
  (previous, Play, next, time, Motion, rate, timeline toggle, quick rail,
  Settings, Exit fullscreen). The timeline toggle shows a 72 px wave over
  the video, above the scrub. Inline there is no overlay: a tap on the video
  toggles Play, a double-tap goes fullscreen. The under-130 px rule goes
  with the inline bar.
- **PR10 Stop pair** top right in fullscreen at full hit size and half
  opacity at rest, the caret above (DESIGN §10.3; RENDERING §8.4 row 11).
  Restated, unchanged. No floating collapse chevrons.
- **As built, PR8 to PR10 and PR17 (`ph-1qs5.4`):** the hover bar's row is
  the player bar's own buttons, moved into it on entry and back on exit
  (one set of controls and listeners); it has no mute or volume (`m` mutes,
  volume is the bar's or the hardware keys'). On a narrow fullscreen (a
  phone upright, under 34 em) the time takes its own line above the
  buttons. Only a rotation enters or leaves fullscreen on the phone class,
  so an Exit in landscape holds until the next turn with no extra state; a
  window resized from the desktop into a phone class is not a rotation.
  A click that a control's own button made never toggles Play (an Exit
  fullscreen moves its button out of the stage before the click reaches it).
  The center Play (operator ruling 2026-10-08): a large Play glyph on a
  translucent disc (`--shade-rgb`) over the paused stage, the video or the
  motion-only meter, never the empty stage; a tap anywhere on the stage
  toggles Play (inline and in fullscreen, after the 250 ms double-tap
  wait, so a double-tap still enters fullscreen) and flashes the glyph
  briefly. The glyph is decorative (`aria-hidden`); the bar's Play is the
  control. A tap outside an open Settings sheet or library drawer only
  closes it: its click is swallowed however long the tap is held (the
  guard ends at the next pointerdown, never on a timer), so it never
  reaches the stage.
- **PR11 Quick rail icon** on the player bar, from the host (DESIGN §10.3,
  PLUGINS.md Pages `phosphor-quick-rail`): on phones in the page and in
  fullscreen (the vertical pop-up on the right); on the desktop only in
  fullscreen (the horizontal pop-up at the bottom), absent inline.
- **PR12 Settings.** Phone portrait: a bottom sheet, at most 65 % of the
  height, scrolling inside, dismissed by a tap outside or a drag down, the
  stage visible above it. Landscape fullscreen: a drawer from the right,
  like the library. Desktop: a card in the library column's slot
  (`ph-mdqo.7`'s slot rule stands), no shadow. It never covers the wave.
  Peeves 5 and 8.
- **As built, PR12 and PR18 (`ph-1qs5.5`):** the sheet is at most 65 % of
  the height and stops under the stage, so on a phone upright it covers the
  timeline band and the bar while open (the mockup's P5 does the same; the
  "never covers the wave" holds on the desktop slot and the drawer, whose
  wave is off unless the timeline toggle is on). Any fullscreen (desktop
  too) puts Settings in the drawer, which starts under the stop pair. With
  the library collapsed, the section sits below the card (`ph-mdqo.7`); the
  1024 x 768 desktop's session-collapsed library counts as collapsed. A
  tap outside the sheet or drawer closes it (the bar's Settings toggles
  itself). The rows are `rows.js` (label, control, value chip; Fit to
  window and the toggles are the shell's switch); the typed Scale field
  goes, the chip shows the value or Auto's readout. The volume row is drawn
  on phones only. The Stash fields come after Scale and Playback. Ruled
  2026-10-08 (operator): the phone sheet covering the timeline and bar while
  open is accepted (mockup P5 is the ruling; "never covers the wave" meant
  no floating overlay); at 1024 x 768 with the library shut, Settings below
  the card (`ph-mdqo.7`) is accepted; the fullscreen drawers on the desktop
  too are accepted.
- **PR13 Library.** Phone portrait: a tab (Player | Library in the head,
  D19 stands) with rows (title, duration · actions), paged and never
  scrolled, and a now-playing row at the bottom (title, position, Pause).
  Landscape fullscreen: a drawer from the right under the stop pair (which
  never moves), closed by a pick or a tap outside. Desktop: the side column
  with its caret (`ph-n4t7`'s caret stands there).
- **As built, PR13 (`ph-1qs5.6`):** a row is the 16:9 thumbnail 56 px
  high beside the title and `duration · speed` (the mockup's P6; no other
  actions), one per line, as many as fit (`ROW_H`). The now-playing row
  holds Play or Pause, the title and the position; on the tab the head
  reads 02 LIBRARY. The fullscreen drawer opens from a Library button at
  the start of the hover bar's row, on any fullscreen (desktop too), and
  closes on a pick, a tap outside or the end of fullscreen. The Stash
  connect card is rows.js's form (label, the field across the control and
  value cells).
- **PR14 Status.** Phones: the page footer's status slot (DESIGN §10.3, the
  page registers `status`). Desktop: the Player card's last row, unframed.
  Both carry the 3 px tone bar; the text is `--tx`, never `--warn`.
  Findings 7 and 9.
- **As built, PR11, PR14 and the compact hero (`ph-1qs5.8`):** the page
  registers `compactHero` and `status`. On the phone class the card sends
  `phosphor-page-status` on every change (`tone` `warn` or null; the notes
  as `title`) and draws no status row; the dash card keeps its own row.
  The Rail button shows wherever the host publishes `data-quick-rail` (the
  phone inline, any bare fullscreen in the hover row). The compact hero is
  the shell's to draw: at 420 x 860 with five strip operations its one row
  does not fit and the shell keeps the full hero (its own fallback). The
  shell still fills a page on the desktop only (docs/PLUGINS.md, `fill`),
  so the phone page keeps filling itself to the window's bottom (now
  measured past the shell's phone footer) until the host fills buckets 1
  and 2.
- **PR15 Shell controls by construction.** Every button is `.og-btn` (`.sm`
  in the 28 px rows, its min-height reconciled with the bar) and the private
  button blocks go (finding 2); persistent on-states (Motion, Invert, the
  switches, the analyzer's Preview) take `.on`, and `--highlight` stays for
  focus, the momentary press and the open tab (finding 1); Offset is
  `.og-num` and the selects take the global rule (finding 3); ranges take
  the global square thumb, the private thumbs and the dead `accent-color`
  go (finding 4); section heads are `.card-sub` and the analyzer's group
  header loses its band (finding 5); button words and status prose use the
  body face, mono stays for numerals (finding 6); bars and markers read
  `var(--r-s)` or 0 (finding 8); the library's warn text takes `--warn-ink`
  and its gaps the spacing scale, and `test/spacing-lint.mjs` learns
  `${...}px` (finding 9). Kept as ruled: the timeline's scrub and range
  pills (advpen vocabulary), the fullscreen seek dot (`ph-mcfe`), the open
  tab in `--highlight`. Text inputs (search, Stash URL, API key) stay mono
  until the operator rules the text-input face for shell and player alike.
- **As built, PR15 (`ph-1qs5.7`):** the tabs, the analyzer's modes and
  controls and every bar and head button are `.og-btn` (`.sm`); the
  analyzer's pressed buttons wear `.on` (the open tab keeps `--highlight`);
  its ranges take the global thumb, its selects the global rule; its group
  header is a sub-group title without the band; its Lag/Plan/Kinetic lines
  are in the body face. Ticks, the speed bar, the split bar and the
  analyzer's state markers are square. The library's grid gaps are
  `var(--sp-3)`, and the grid math reads the drawn gap (`fitGrid`'s third
  argument); the row height is the CSS var `--fsp-row-h` (`ROW_H` agrees).
  `test/spacing-lint.mjs` flags `${...}px` on spacing properties.
- **PR17 Landscape with a video is fullscreen.** On the phone class, turning
  to landscape with a video loaded enters fullscreen and turning back leaves
  it; an Exit fullscreen in landscape holds until the next rotation. With no
  video (empty or motion only) landscape stays a page: stage left, library
  or controls right, the hero in its compact row. Peeve 8.
- **PR18 Native settings rows:** label, control, value chip (Field's form);
  Auto scale is a switch row, not a button in the slider track; a row with
  no setting is not drawn. Row labels are lowercase (`.field-label`).
  Resolves finding 10.
- **Compact hero.** The page registers `compactHero` and `status`
  (docs/PLUGINS.md, Pages), so on phones the hero is one row and the page
  has a footer with the status slot.

Out of scope: the analyzer's contents (only its toggle moves), the
scheduler, Scale math, Kinetic, Stash protocol and the keyboard map.

### The card before the redesign

The rulings below stand except where marked superseded.

Composition follows the card's own box (ResizeObserver), with the
renderer-class thresholds: full at 960 px and wider (`FULL_UP`), handheld
264 to 959 (`GLANCE_UP`), glance under 264.

*(The FULL diagram is superseded 2026-10-08 by the redesign diagram above.)*

```
FULL
+------------------------------------------------+--------------------+
| source 24: title, caret >                       | head: search, sort,|
| stage 16:9, object-fit contain, the hover bar   |   dir, Open files  |
|   (Play, mute, volume, time, mode, Fullscreen)  | tiles, paged,      |
|   empty: 'Open a video' (click opens files)     |   never scrolled   |
| transport 28: prev play next | 0:00 | heat |    |                    |
|   -0:30 | volume | rate | graph (g) | close   |    |                    |
| wave card 96 (draggable): automation curve,     |                    |
|   reality trace, plan, range pills, speed;      |                    |
|   corner plate: Motion | Offset ms | Invert |   |                    |
|   zoom, A-B, Settings (page only)               | page n / m, N      |
+------------------------------------------------+--------------------+
| status slot 20, one line, aria-live                                  |
+----------------------------------------------------------------------+
```

- **Transport row** (operator ruling 2026-10-05, `ph-mdqo.7`): one fixed row
  under the stage, ten items in order: previous, Play, next, elapsed, the
  whole-script heat (the scrub), remaining, volume, rate (0.5x to 2x), graph
  (the analyzer, key `g`), close. Previous and next step the script's
  chapters (`metadata.chapters` start times), else its bookmarks, and walk
  the library's loaded list (across its pages) only when the script has
  neither; previous within 1.5 s of a mark goes to the one before. Close
  unloads the media and returns to the library. No screenshot and no layout
  button (operator ruling 2026-10-05). Rate scales the stroke speed shown and
  checked against the input limit (the heat's stripes too). Outside media
  fullscreen the hover bar holds only Fullscreen and its mode (the row has
  the rest; `m` mutes); in media fullscreen it is the whole bar.
  *(Superseded 2026-10-08 by PR5 (one player bar; Close to the head, Graph to the timeline head) and PR9 (the hover bar only in fullscreen).)*
- **Fullscreen**: a double-click on the stage (or `f`, or the bar's button)
  asks the shell for page fullscreen with the video alone. Borderless is no
  chrome at all; In window fills the window and keeps only the hero rail
  (the ask carries `bare: false`, `ph-mdqo.7` SEAM NEEDED: the shell honors
  it). The mode is the bar's button and the shell's pref. A single click
  waits 250 ms so a double never toggles Play; the stage fades in on the
  duration tokens, still under `html.still`.
  *(Superseded 2026-10-08 by PR8: one bare mode, no In window, no `bare: false`; the double-click stays.)*
- **Wave bundle**: Motion, Offset (labeled `ms`) and Invert sit with zoom,
  A-B and Settings on a raised plate flush with the wave card's top right
  corner. The wave card and the heat sit on `--screen` with the advanced
  generator's inset shadow. The stroke speed reading rides the card's
  bottom, right of the range pills. Under a coarse pointer the rows are
  `var(--tap)` (law 12).
  *(Superseded 2026-10-08 by PR6 (Motion beside Play) and PR7 (the timeline head row replaces the corner plate; Settings to the player bar). The `--screen` plates stay.)*
- **F3 look-for** (`ph-mdqo.12`): the page registers `search` entries Motion, Offset, Invert, Open files, Graph, Split; each key is a `data-search-key` on its control, and the shell opens the page, scrolls to it and focuses its first enabled control.
  *(Superseded 2026-10-08 by PR3: the entries read Open video and Open script for Open files; the rest stand.)*
- **Open files** lives in the library head; an empty stage is a click
  target for it.
  *(Superseded 2026-10-08 by PR3.)*
- **Page fill** (`ph-yuce`): the page registers `fill` (docs/PLUGINS.md,
  Pages), so on the desktop it is a column filling the content pane: the
  stage row grows (the video contained, letterboxed in the stage's dark),
  the strip, timeline and status keep their fixed heights, the library
  column keeps 320 px. An open Settings section takes the library column's
  slot (320 px, the analyzer column's width beside the analyzer; scrolling
  within) while the card is full, so the card keeps its size and composition;
  under 960 px of page width it sits below the card, reached by scrolling.
  The section never covers a control: it takes the library column's slot
  while that column is open, the analyzer column's (above the transport and
  status rows) while the analyzer is open, and goes below the card when the
  library is collapsed. The card never loses height to it (`ph-mdqo.7`); its
  min-height is its fixed rows plus the 120 px stage, so a shorter page
  scrolls. The phone layout is not filled.
  *(Stands on the desktop; the phone stage is PR2 and the Settings slot keeps this rule, PR12.)*
- **Split bar** (`ph-mdqo.7`): a 4 px bar between the stage and the transport
  sizes the wave card: drag (up grows it), arrows 8 px (Shift 1), double-click
  for the default, never leaving the stage under 120 px, stored as pref
  `split` in px (0 is the composition's default). The stage's 120 px and the
  wave card's 64 px are grid track minimums, so a stored height yields to a
  short window instead of squeezing the stage. Hiding the library or the Settings section never shrinks the
  stage. Not drawn in glance or beside the analyzer.
  *(Stands on the desktop, between the stage and the timeline band; PR7.)*
- **Library caret** (`ph-n4t7`): a tab at the source row's right end, on the
  library column's edge, `Library`: it closes the column and the player
  takes the width, open again from the card's edge; a view switch kept in
  pref `libOpen`. Full only: handheld has its tabs.
  *(Stands on the desktop; the phone forms are PR13.)*

- **Handheld:** tabs Player | Library (shown only here; in full the library
  is the side column) swap the one main region in place (a view switch,
  never a write; the video keeps playing under the library); the wave card two
  bundle rows plus 48 px (112 px; three rows under a coarse pointer);
  the transport is one fixed row. Where it
  overflows the card (measured on a width change, a Look change and an
  analyzer toggle; at or under 412 px at the default Look, 454 at 1.4),
  `data-narrow` gives two fixed rows: prev, play, next, elapsed, heat,
  remaining / volume, rate, graph, close.
  *(Superseded 2026-10-08 by PR5 for the transport and its `data-narrow` rows; the tabs stand.)*
- **Glance:** title, a 24 px stroke meter (an intent tick for the script,
  a reality tick for the measured position; ticks, not handles), Play,
  time, status. The video element stays mounted and visually hidden; the
  clock falls back to `currentTime`.
- **Fixed geometry.** Every row has a fixed height; state changes swap
  text and icons only; empty, loading, error and refusal states render
  inside the same boxes. The browser test asserts identical rects across
  states.
- **Look.** Script curve and intent tick `--intent`; measured
  `telemetry.position` (as a share of `window.min/max`, drawn only when the
  window is reported, law 9; dimmed when stale, law 8) `--reality`;
  playhead, selected tile and focus `--highlight`; gates and over-cap
  `--warn`, as a mark only: the status slot's 3 px bar, the speed bar,
  striped heat. Text stays `--tx`: `--warn` is locked (law 13) and reads
  1.8:1 on Paper's white card. Muted text (title, the Offset label, zoom
  glyphs, connect labels) rides the shell's `--tx-mut`, held to 3:1 by
  `theme.test.mjs` (3.5:1 on the Ember and Phosphor cards); 4.5:1 would
  be a shell token change, not the player's. Heat past the limit is
  striped, not only recolored, because Ember's `--intent` and `--warn`
  sit 13.6 Delta E apart. The reality trace is drawn at `mediaAt(t - offset)`, so a
  machine in sync draws on the curve: offset can be set by eye. It is a
  scope, not a measurement (ponytail; arrival-stamped).
- **Heat** (ph-rsb5): the speed heatmap funscript users know. Each span
  between two of the file's actions is painted at its stroke speed,
  `|dpos| / dt` in units/s (pos 0..100), as one hard-edged run of a
  full-height band: no blur across actions (one SVG linearGradient with a
  stop pair per run, equal neighbors merged). The ramp runs through the
  theme, mixed in oklab: `--bg-sunken` at rest, `--reality` at 200 units/s
  (`HEAT_MID_UPS`), `--highlight` from 400 units/s (`HEAT_TOP_UPS`) up.
  Never red: RENDERING law 13 keeps red for hazards, so the common
  black-blue-green-yellow-red ramp is out. The heat ignores Range and
  Scale (the file's own speeds, as other players show them); a run whose
  chord speed through the Range passes `limit.input.speed` is striped
  `--warn` over it. Under the default theme `--highlight` is `--reality`,
  so the top half of the ramp is one color there.
- **Handles** (Advanced Penetration's vocabulary): the scrub playhead is a
  vertical pill on the heat, the bottom band, whose line runs up through
  the detail as one bar (left-right; arrows 5 s, Shift 30 s, Home, End;
  the detail window holds the playhead at the same share of its width as
  the heat, so the two never disagree); range low
  and high are horizontal pills at the detail's left edge, high one tap to
  the right of low so close values never stack (up-down; arrows 1 %, Shift
  the same, Ctrl the adjacent 10 %). A pill's hit box stays inside the detail, which clips, and only
  the drawn pill rides the value to the edge (a clipped box took touches
  over 60 % of itself). They preview in the intent look and commit on release.
  Offset is a number field in the bundle (drag 5 ms per 4 px, type, arrows 5 ms;
  Shift: a drag at a tenth of the gain, a key the same 5 ms; Ctrl: the adjacent 100 ms multiple, DESIGN 10.5). Zoom is two buttons (5, 10, 20, 60 s); the wheel is never
  captured. Keys: Hover controls.
- **Hover controls** (ph-mcfe, ruling 2026-10-03: familiar, YouTube's
  shape). Over the video in the card and the page: a bottom gradient bar
  with the seek bar (played in `--highlight`, buffered lighter, a dot and a
  time tooltip under the pointer), then Play/Pause, Mute, volume, current /
  total time and, on the page only, the mode and Fullscreen at the right.
  The mode is a two-state glyph, `In window / Borderless`, in the desktop
  shell only: it asks the shell to set its pref `fullscreen` (docs/PLUGINS.md,
  Pages) and stores nothing itself; under 440 px of stage it yields with the
  volume slider. Outside media fullscreen only the mode and Fullscreen are
  drawn. It shows on
  pointer movement and hides after `HOVER_IDLE_MS` (2.5 s) idle and on
  pointer leave; it stays while the pointer rests on it, a seek drags or a
  control holds keyboard focus. A touch on the video while it is hidden
  shows it without toggling; a click on the video toggles Play. Keys while
  the card has focus: Space or K play/pause, J and L 10 s back and on,
  arrows 5 s, M mute, F fullscreen (page). Every act goes through the
  controller (`toggle`, `seek`): Play prerolls, a seek
  holds and glides; the bar never calls the video's `play()` or `pause()`
  or sets `currentTime`. Volume and mute are the video's own, stored in
  pref `audio` (`phosphor.funscript.audio`); they are the card's only
  mute and volume. The bar is its own size container: under 130 px of stage
  height it is not drawn (the analyzer's handheld thumbnail), under 440 px
  of width the volume slider yields so the time stays whole.
  *(Superseded 2026-10-08 by PR9 for the inline bar, and PR8 for the mode glyph; the shape, seek dot, idle timer and keys stand.)*
- **Media fullscreen.** The bar's Fullscreen asks the shell for page
  fullscreen, bare (docs/PLUGINS.md, Pages): the window holds the video
  alone, the hover bar over it, the stop pair floating top right and the
  caret above; the timeline, strip, analyzer and the page's Settings
  are hidden until fullscreen ends (Escape, F, the bar's button, F11, a
  page switch, or the caret's bar). The bar's mode applies. Never element fullscreen:
  it would cover the stop pair (RENDERING §8.4 row 11). The page registers
  `mediaFullscreen`, so its footer has no Fullscreen (`ph-n4t7`); F11
  still takes the whole page; the dash hero has no Fullscreen
  (page fullscreen is for pages).
  *(Superseded 2026-10-08 by PR8 for "the bar's mode applies"; the rest stands, with the quick rail and drawers of PR11 to PR13.)*
- **Speed meter.** The current stroke's speed in mm/s when the window's
  unit allows, else %/s, against `limit.input.speed` with `--warn` past it.
  Display only (SPEC §9.6: limits are for display and optional
  pre-adaptation); the hub's planned peak runs higher (1.875 x for a
  quintic), so it under-warns.
- **Motion switch.** Off, the video plays and nothing is sent. On by
  default: Play is the act that moves the machine.
  *(Placement superseded 2026-10-08 by PR6; the behavior stands.)*
- **Targets.** Every control is at least `var(--tap)` (40 px floor under a
  coarse pointer, law 12).
- **Copy** (COPY.md): Play, Pause, Open files, Library, Player, Motion,
  Offset, Invert; the hover bar's `Play (k)`, `Pause (k)`, `Mute
  (m)`, `Unmute (m)`, `Seek`, `Fullscreen (f)`, `Exit fullscreen (f)`,
  `In window / Borderless`; the transport's `Previous`, `Next`, `Rate`, `Graph (g)`,
  `Close`; the timeline's `Settings` (sliders); the caret's `Library`;
  `Machine later (+) or earlier (-)`; `Search scenes`;
  `No scene loaded`, `No script for this video`, `No script for this
  scene`, `Positioning`, `Buffering`, `Format not playable here`,
  `Script past the input speed limit`, `Extra axes ignored: roll,
  twist`; the parse notes (`2 positions clamped`, `range ignored`,
  `actions sorted`, ` (+N more)` after the first) and
  refusals (`script longer than 24 hours`); the host's gate and door
  words as sent.
  *(2026-10-08: Open files, `In window / Borderless` and the transport's Close are superseded; added: Open video, Open script, Close, Media, Motion only, Timeline, Settings, Exit fullscreen, Rail (the quick rail icon's title) and the gate reason `No video`.)*
- **Local files.** One `input type=file multiple` (video, audio,
  `.funscript`); `pairFiles` matches by base name; the video gets an object
  URL, revoked on replace and dispose. No drag and drop: Tauri intercepts
  drops, and turning that off risks the builder palette.
  *(Superseded 2026-10-08 by PR3: two pickers, Open video (multiple, pairs by base name; video, the webview's audio types, never `audio/*`) and Open script (`.funscript`); no drag and drop stands.)*

### Queue and Autoplay (operator 2026-10-08, `ph-1qs5.9`)

Operator: "add a queue and an autoplay option which plays the next video in
the queue, a tab to manage the queue". Design (Fable, veto-able), as built:

- **Where.** The queue lives where the library lives: on the phone a third
  tab, Player | Queue | Library, in the head (the head reads 02 QUEUE); on
  the desktop and in the fullscreen drawer a Library | Queue switch at the
  head of the column (a session view switch, never stored).
- **Rows.** The library's row form (a 56 px thumbnail, the title, the
  duration), paged and never scrolled (D19), each with Play next (↑, to the
  top) and Remove (×). A drag reorders (a mouse at once, a touch after a
  400 ms hold, so the page still scrolls). A tap on a row plays it now and
  takes it off the queue. Library tiles and rows carry Add to queue (+).
  Several videos picked in one Open video: the first plays, the others are
  queued, each with its same-named script.
- **Autoplay.** A switch in Settings, Playback (pref `autoplay`) and a chip
  on the now-playing row. When a scene ends with Autoplay on, the queue's
  first loadable scene (a file not yet reopened stays queued) loads, leaves
  the queue and plays once it can (its script loaded, the gate open); Motion
  follows the Motion switch as for any Play, and the preroll and pause-home
  rules apply between scenes. The pending Play belongs to that scene and is
  dropped, never deferred, when anything else happens first: another scene
  or Close, any Play, Pause or stop, a gate (a Halt or latch), a refusal or a
  warning in the status, or 10 s without the script; so a Halt released
  between scenes starts nothing. The queue's end stops. Loop (per scene)
  and an A-B section win while on: a looping scene never ends.
- **Stored.** Pref `queue` (`phosphor.funscript.queue`): a Stash scene with
  its URLs stored without the API key (the key in force is added when read
  back, so the key never reaches the prefs backup); a local file by name
  only. A File cannot be stored, so after a launch a file's row reads
  Reopen, and Open video given a file of that name resolves it.

## Stash

Configuration: a connect card (Stash URL, API key as a password field,
Save, Test) in the Plugins pane via `registerSettings`, and the same card
in the library's place while no base is set; stored in `api.prefs`
`stash`. Every request goes through `api.net.fetch` (CORS-free in the
shell; vite dev uses `window.fetch`, so Stash must allow the dev origin).
Media loads by URL under the R-B CSP.

Browse: `findScenes(filter {q, page, per_page = tiles that fit, sort,
direction}, scene_filter {interactive: true})`, search debounced 300 ms,
sorts Date, Added, Title, Rating, Speed, pages instead of scrolling.
Pages and scripts are cached for the session. Load: hold, fetch and parse
the funscript, set `video.src` to the direct stream and the poster to the
screenshot. A scene without a script loads video only, Play stays grayed.

Assumptions (each marked `ASSUMPTION An` in `stash.js`). Verdicts from the
operator's Stash v0.31.1 on the LAN, 2026-10-03, read-only (queries and
GET), 188 interactive scenes: `node test/funscript-stash.test.mjs --live
<file.json>` (a local `{base, apiKey}`, never committed; or `--live <base>
--key <key>`) and, in the browser, `node test/funscript-player.test.mjs
--stash-live <file.json>`.

- **A1** verified. GraphQL at `<base>/graphql`, POST JSON, header
  `ApiKey: <key>`; no cookie needed; no key or a wrong key is 401. CORS
  answers any origin (the vite dev path works).
- **A2** verified. `?apikey=<key>` opens `stream`, `screenshot` and
  `funscript`; without it each is a 302 to `/login`. Stash already writes
  the key into `paths.stream` (not `screenshot`); `withKey` replaces it.
- **A3** verified. `interactive` is a Boolean: `{value, modifier}` is
  refused with `cannot use map as Boolean`.
- **A4** verified. The selection answers as written (plus
  `files { basename }`); `duration` is seconds. Every title on this server
  is empty, so the basename fallback is the title in practice; four scenes
  carry two files, `files[0]` is the primary. `interactive_speed` is 0 on
  three scripted scenes Stash never measured: the client reads 0 as
  unknown.
- **A5** verified. `stream` is the original file, 206 to a Range, with
  `accept-ranges: bytes`. Primary files: WebM VP8/VP9 114, MP4 H.264 65,
  MP4 AV1 8, Matroska VP9 with PCM audio 1 (the one Chromium may refuse).
  In the browser harness, under the shell CSP's `img-src` and `media-src`
  (`http: https:` covers a LAN Stash; the shell's origin is
  `http://tauri.localhost`, so no mixed content), every tile's screenshot
  loads and a scene plays from its direct stream.
- **A6** verified. `paths.*` are absolute and carry the host the request
  used; rebasing onto the base is then a no-op, kept for a proxy.
- **A7** verified. `paths.funscript` serves the main script (text/plain
  JSON) to the ApiKey header; `ScenePathsType` has no companion path
  (`screenshot preview stream webp vtt sprite funscript
  interactive_heatmap caption`).
- **A8** verified. All five keys sort both ways; an unknown key is refused
  (`invalid sort`), so a pass is meaningful.
- **A9** verified. `{ version { version } }` answers `v0.31.1`.

Out of v1: transcodes, HLS and `sceneStreams` (a transcode restarts
`currentTime` at the seek point, which the clock would need to model),
markers, write-back (play count), Stash's heatmap PNG (its red ramp breaks
law 13; the card draws its own token heat).

## Playback (ph-smvd.12)

Loop, pause home, seek transition and latency, in `clock.js` and
`scheduler.js`; signatures and the card's wiring (ph-smvd.13) in CONTRACT.md,
module scheduler. MFP's behavior for each: FUNSCRIPT-MFP-NOTES.md. Prefs
key `play`. Each choice below is veto-able.

- **Loop without a gap.** MFP treats a loop as a seek (a hold, a re-anchor,
  a 4 s chase). Here the clock runs in unrolled media time (lap L adds
  L x (b - a)), so the map stays one line across the wrap and the scheduler
  stamps the next lap before the video jumps. The seam is one span from the
  last knot before b to the first after a: the rail never jumps, and that
  span departs from the authored line (which would jump from the script at
  b to the script at a). The video is sent back `WRAP_EARLY_MS` (one 30 fps
  frame) before b, so a whole-media loop never reaches `ended`; the seek's
  landing delay is a clock residual, stepped past 25 ms. A-B points are the
  timeline's runtime state, not prefs (they belong to one video); a seek
  past b clears them, as MFP does. Count 0 plays forever; N plays the
  section N times, then plays on.
- **Home on pause** (ph-hanh, ruling 2026-10-03: auto home happens when
  paused only). Never inside the script while playing: a gap plays as its
  one authored span. Once a pause or the end has lasted `homeAfterMs`,
  one segment moves to the home point (through the pending range) at
  `homeSpeed`, norm/s of the window from the measured position (a whole
  stroke when there is none), at least `HOME_MIN_MS`; none when already
  within 0.05. Play, a load and a Motion change cancel a pending home; a
  gate at the due time drops it; a transient refusal retries next frame.
  A stop for any other reason (gate, refusal, hidden page) never homes.
  Off by default: the operator's Pause is what starts it.
- **Seek transition.** MFP bends the output for 4 s with a per-sample
  chase, which segments cannot carry. A seek here is one segment from now
  to where the script will be `seekMs` later, then the script from that
  instant: knots keep their times, the tiling holds, and the knots inside
  the delay are passed over. 500 ms by default, 0 jumps as before. The
  hub's input speed limit still bounds a short delay.
- **Low latency** retired 2026-10-08 (ph-1qs5.1). It capped the offer at
  50 ms, narrowed the clock ring to 8 frames and raised the slew to 15 ms/s.
  It moved no alignment (stamps are absolute: the felt latency is the
  offset), and measured worse on every axis but one, so the one clock
  filter (32 frames, 5 ms/s) and the 125 ms lead stay; a stored
  `lowLatency` is dropped. Measured against the default (node, seeded; the
  twin at Nucleus 91243d4):

  | | default | low latency |
  |---|---|---|
  | clock map error p95, 30 fps on 60 Hz with +-2 ms compositor jitter | 0.72 ms | 1.09 ms |
  | stamp change frame to frame, p95 | 0.17 ms | 0.51 ms |
  | a 12 ms display change followed to 11 ms | 2.7 s | 0.86 s |
  | stall tolerance | about 105 ms | about 30 ms |
  | twin render, max off a 240 ms lead render: real-shaped script | 6.5 mm | 11.1 mm |
  | the same, staircase | 5.8 mm | 7.2 mm |

  A 3:2 pulldown and a single late frame moved neither filter.
- **Automatic compensation** (off by default). The scheduler reads the plan
  strip the way `test/funscript-sync-live.mjs` does (start = arrival -
  `plan.elapsed`, the least of a plan's samples), matches each plan to the
  sent segment of its duration, and takes the median of the last 32 start
  minus `atMs`. It is measured against the stamp, so applying it changes
  nothing it measures: no loop to hunt. It is applied as `T.offsetMs -
  compMs`, by one restart, when it moves 2 ms or more, bounded to 100 ms.
  Its known bias: the arrival includes the STATE frame's one-way transport,
  and the 14 ms floor on the sim (Tests, what the sync bars do not cover) is not split between hub
  lateness and observation, so it can make the machine early by that much.
  It sits on top of the declared `schedule_latency_us` (RFC-059 forbids
  bidding that down) and beside the operator's offset. It is never applied
  below 0 (ph-1qs5.1): a plan cannot start before its stamp, so a negative
  lag is the strip's misreport. A Kinetic² hub's plan strip names the next
  piece early once a submit lands in the later half of a piece (Nucleus
  val-0ep): elapsed 0 and an arrival before that piece starts. On valencesim
  0.1.30 (`--live-playback`, 2026-10-08) the lag read -30 to -56 ms with an
  authored end velocity on the staircase (held at 0; applied, it made the
  machine that much late) and 14.6 ms with every knot free. Keep it off on a
  Kinetic² hub until val-0ep lands; it stays because nothing else aligns the
  hub's own lateness.

The card (ph-smvd.13):

- **Controls.** The plugin's settings card carries eight Playback rows under
  the Scale row: Loop (the whole video), Loop count (`forever` at 0), Pause
  home, After pause, Home point, Home speed (%/s), Seek glide (`jump` at 0),
  Auto latency; toggles read On or Off in a fixed box, sliders
  wear the analyzer's vertical-pill thumb. A change applies at once: the
  loop at the next restart (a playing card restarts), home and latency in
  force.
  The Funscript page opens the same card (the one registerSettings
  function) in a Settings section below the card, from the Settings
  button at the right end of the timeline's cluster (`ph-n4t7`), open or
  closed kept in pref `settingsOpen`; the dash hero gets no button (P3).
- **A-B.** One button in the detail's cluster, `A-B`: the first press sets A
  at the playhead, the second B (the loop starts; B at the playhead wraps at
  once), the third clears. The section is a selection: a `--highlight` band
  on the heat and dashed lines in the detail. With no B the Loop row loops
  the whole video.
- **Plan strip.** `plan.elapsed` and `plan.duration` are optional hero
  roles; each new STATE (its age drops) is one `observePlan` sample.
- **Shown time** is the unrolled clock folded back, so the readout, the
  playhead and the trace stay in media time across laps.
- **Measured** on valencesim 0.1.7-p4hub (etag d8c8e522322810a2, a private
  `--state`, spare ports; `--live-playback`, 2026-10-03): with auto latency on,
  the lag median came after 6 s of play and compensation settled at
  14.55 ms (lag 14.44 ms) in one step, the sim's known floor; the lead
  stayed within 125.6 ms (half the 250 ms horizon). A seek to 16 s while
  playing sent one hold, then a 500 ms glide 109 ms later
  whose target sat on the script 500 ms on (error under 0.0001). Home on
  pause (rerun on the same harness after ph-hanh, valencesim on spare ports,
  2026-10-03): the 14.17 s gap went out as its one span with nothing homed;
  a Pause sent the home move 5046 ms later (`homeAfterMs` 5000), 691 ms
  long, and the measured position read 0.5 of the window (54 samples, every
  one on it). An A-B loop of 4.05 s wrapped 4
  times with no hole in the schedule and no NACK; on two of the three wraps the seek
  landed late enough to step the clock, so the seam span was re-sent 48.9 ms later
  (a cut, not a hole; an adaptive wrap lead is open), and the largest position change between samples was 0.0883 of the
  window against 0.0935 in plain play.

## Analyzer (ph-smvd.11)

The graph button in the transport row (tooltip `Graph (g)`) turns the heat into a tuning bench: the script with the hub's plan
(`plan.current`, `--intent` at reduced weight) and the measured position
(`telemetry.position`, `--reality`) overlaid on a taller detail, a lag
readout, and every tuning control the hub exposes. The card's outer rect
does not move: in full the library column becomes the analyzer column,
two fifths of the card held between 320 and 560 px (`clamp(320px, 40%,
560px)`, ph-tz5t: at 1280 a 320 px column squeezed its row labels to
`Overshoot ...`), the graph taking the rest, under a 180 px tall thumbnail
of the video at the column's width; in handheld the thumbnail sits one tap
high in the source row and the analyzer takes the lower 55 % of the
timeline's box. Collapsing restores the card as it was.

- **Controls.** Bound by the catalog, never by channel: the writable
  fields of every group whose first segment is the registry's `Tuning`
  subgroup (RFC-094; on valencesim: motion behavior, streaming, sample
  streams, curve, ceilings, re-planning), the writable fields that
  share a write channel with those (the kinetic ceiling overrides), and
  `limit.input.*` by role. Each row draws the field's derived
  presentation: slider (a vertical-pill thumb, one write on release),
  stepper, toggle, two-option segmented, else a select. A 3 px bar shows
  the write ladder (`--intent` pending, `--warn` overdue or fault); the
  gate, the refusal or the stale words ride the row tooltip.
- **Live or Preview.** Live writes through `api.write`. Preview (the
  default where the hub declares `action.trial`) writes through
  `api.writeTrial`; Apply is `api.commitTrial()`, Discard
  `api.revertTrial()`. `Preview: not saved` stands in the status slot,
  with an `--intent` bar, while `api.trialPending` (any client's trial),
  outranked only by a refusal and the gate. A mode switch writes nothing.
- **Lag.** `Lag n ms` is the shift that best lays the measured position
  over the script (after Offset, Range and Invert), `Plan n ms` the same
  for `plan.current`, both over the trace's last 8 s, every 500 ms,
  between -100 and 400 ms. A scope like the trace, not a measurement:
  telemetry arrives on its own cadence (ph-smvd.12's compensation is the
  measured path).
- **Legend.** The detail's lines: the Kinetic render as the intent curve
  `--intent` (2 px; straight lines between the actions without it), the
  actions as `--intent` dots, `plan.current` `--intent` at reduced weight and
  the measured position `--reality`; the `--intent` swatch before the Kinetic
  readout names the curve.

Decisions (veto-able):

- **A1** The manifest declares `intent`: the analyzer is a writer, so R-D's
  reason no longer holds. Veto: the analyzer shows values read-only and
  the tuning stays on the settings page.
- **A2** Pushback on the brief: no Document Picture-in-Picture or
  `requestPictureInPicture`. Both open an always-on-top OS window that can
  sit over the top strip, which law 1 and Containment forbid; the brief's
  own fallback, an in-card thumbnail, is the only path. Veto: a ruling that
  amends law 1 for a floating video, then the PiP call where available.
- **A3** No host Field presentations: the plugin API has no member that
  mounts a host field, so the rows are the plugin's own controls over
  `api.value`, `api.status`, `api.gate`, `api.reason` and `api.stale`,
  without Field.svelte's afterglow. The host member (`mountField(el, field,
  {write})`, a write override for trials) is a host bead. Veto: wait for it.
- **A4** Preview is the default on a trial-capable hub, so an exploratory
  drag is never stored by accident; the mode is not persisted.
- **A5** Diagnostics stay on the settings page: the analyzer lists the
  writable fields only (anomaly counts are readouts the generic renderer
  already shows).
- **A6** A trace point's plan share treats `plan.current` as a window share
  (the plan roles are window-relative, PlanStrip and ph-t2jn), scaled by
  the field's own min and max when it declares them.

Tests: `--unit` (c2) checks the groups on the recording itself (valencesim
0.1.7-p4hub, etag d8c8e522322810a2: `Tuning / ` groups, `trial_mask` and
settings-trial) and on a model with the `Tuning` prefix stripped
(limit.input.* only), and lagOf on a synthetic 42 ms and 14 ms
lag. The browser run (g), under a coarse pointer: the playhead bar spans
the detail and the heat at the grip's x and the time's share; expand keeps
the outer rect (full and handheld) with the video in the thumbnail and
the library out; one row per field; 40 px targets, nothing outside the
card; a Live write is a durable INTENT on the field's write channel, a
Preview write the same with `trial`; the notice stands while the hub marks
the trial; Apply sends settings-trial op 1, Discard op 2, each clearing
it; rects unchanged across Live, Preview and a pending trial; collapse
restores the card. `--live`: on valencesim a Preview write raises the
notice and Discard clears it and restores the stored value.

## Kinetic (ph-ge35)

Operator ruling 2026-10-03: the player loads the machine's own planner and
renders the motion async, so tuning runs against a deterministic system that
behaves the same on the machine, without rendering anything on the hub.

- **What runs where.** The planner is Kinetic². Nucleus
  `tools/kinetic-wasm` compiles the P4's `MotionArbiter.cpp` and the
  Kinetic² kernel (`Kinetic/include/kinetic2`; the same sources, not a
  model) into one standalone `kinetic.wasm`, zero imports.
  The plugin carries it base64 in `kinetic/bytes.js`: an override copy is one
  file (R-C) and `connect-src` refuses a plugin's fetch, so the module is the
  artifact everywhere (dev, the shell, an override). `kinetic/kinetic.js`
  starts one Worker from a blob URL per open analyzer, instantiates the wasm
  once and answers render requests; the page thread never runs the planner.
- **Input.** The wire Script's segments (`ctl.wire`, scale.js `wire()`,
  through `segmentsOf`) as the host sends them: one per span ending at the
  same end velocity (free, or 0 at a rest, I8), no curve family, each
  submitted `LEAD_MS` (125, half the 250 ms horizon) before its start, after
  a 1200 ms preroll from rest at 0 mm to the first knot at media 0. Limits
  (`limit.input.*`), the rail (`geometry.max_travel`) and the window
  (`window.min`, `window.max`) by role; the Tuning rows by `kinetic_tuning`
  member name (K2; 32 B). Kinetic² reads the ceiling overrides,
  `smoothness`, `handle_floor`, `trim_max` and `react_us`; `chase_dense_us`
  is bound and ignored (on the board it is the samples grant's latency). The values are the ones the analyzer shows: in Preview
  the hub's trial values, during a drag the draft, before anything is
  written. Every render calls `kinetic_expect` with the scheduler's
  `EXPECT_MS`, so the preview and the Auto fit render the hub's expectation.
  Any change re-renders; a newer render supersedes the older, which
  frees its handle at its next 8192-step chunk.
- **Output.** 1 ms steps, kept every 5 ms (more on scripts past 1000 s, at
  most `KIN_MAX_SAMPLES`): `position_mm` (what an on-time LP core renders),
  velocity and accel, the flags ORed per kept sample, and counts over every
  step. The detail draws the position as the intent curve (`--intent`); the
  analyzer's Kinetic line reads `Kinetic: wasm  n anomalies` and each nonzero
  flag time: `clamped` (the raw plan outside the window) and `shaped` (a
  knot trimmed toward its predecessor). Its tooltip holds
  the version string, the render time and the anomaly kinds (`knot refused`
  among them: a knot not after the newest is refused, never replaced; and
  `piece over ceiling`: a span no trim keeps inside a limit renders at its
  least-over trim, never a drop).
- **The card's picture.** The render is the intent curve; the limit is
  judged by chord speed against `limit.input.speed` (timeline.js
  `heatStops`, the speed meter's `strokeSpeed`).
- **Fallback.** When the worker cannot start or the compile is refused, the
  line reads `Kinetic: fallback` and the intent curve is straight lines
  between the actions. A planner refusal is not a fallback: `Kinetic: wasm  window
  refused`; without the limits, window or rail: `no limits, window or rail`.
  A module whose `kinetic_version()` does not name `kinetic2` is refused at
  start (`not a Kinetic² build: <version>` in the tooltip): a fallback.
- **Pin rule.** `kinetic/kinetic.pin` names the Nucleus commit, the
  `kinetic_version()` string (`nucleus <sha12> kinetic2 <x.y.z>`) and the
  size. The bytes are "the machine" only for firmware built from that
  commit; a `-dirty` build is never vendored. Bump with `node
  test/kinetic-pin.mjs --write` (Nucleus clean at the new commit, emsdk at
  `../.tools/emsdk` or `$EMSDK`; `NUCLEUS_DIR=<dir>` builds from a clean
  worktree at that commit, beside `../Kinetic` and `../Valence`, when the
  checkout's beads export dirties it); a plain run checks bytes.js against the
  pin and, when Nucleus HEAD is the pin, rebuilds and byte-compares;
  `node test/kinetic-pin.mjs <wasm>` checks that file instead of bytes.js.
  `KINETIC_WASM=<wasm>` runs `kinetic-trace.test.mjs` and
  `funscript-player.test.mjs --unit` against that build.
- **Determinism.** `test/kinetic-trace.test.mjs` (in `npm run check`)
  replays Nucleus' native Kinetic² fixture (`test/fixtures/kinetic_trace.json`,
  copied from Nucleus c72bb35 `test/fixtures/kinetic_trace.json`, kernel
  Kinetic 920836b, `expect_ms` 500) through bytes.js:
  600 of 600 blocks of 1 ms samples bit-identical, p/v/a 0 ULP, the
  accepted count and the anomaly mask (10) as native; `renderCore` on the
  same segments with the same expectation returns the same `position_mm` at
  all 60,000 steps.
- **CSP.** Compiling wasm needs `'wasm-unsafe-eval'` in `script-src`
  (PLUGINS.md); section (k) shows the compile refused without it.
- **Measured** 2026-10-06 (Chromium, section (k), Kinetic²): 60 s at 1 ms
  with every sample kept, 18.8 ms in the worker, 18.9 ms to the page; the
  30 s test clip in the analyzer, 10 ms. The shell bundle grows by about
  82 KB raw, about 35 KB gzipped (the wasm was about 62 KB then; `kinetic.pin`
  holds the current size); the hub-served build carries
  no factory plugin and does not grow (`npm run build:only`: no wasm in it).
- **What it is not.** The emitter is ideal and the tick exact: the board's
  task jitter and edge quantization are absent (Nucleus
  tools/kinetic-wasm/README.md).

Decisions (veto-able):

- **K1** bytes.js only, no separate `.wasm` file: one artifact for every
  load path, and a second copy could only drift. Cost: base64's third in the
  shell bundle (35 KB gzipped against 26 KB for the raw wasm).
- **K2** The Tuning rows bind `kinetic_tuning` by member name (the 0x3120
  card's fields carry the struct's names; an `_ms` row binds its `_us`
  member): the contract's one binding that is not a role. Every member has
  a row on valencesim (kinetic-limits 0x1120, kinetic-planner 0x1122);
  `schedule_horizon` is not bound (the render uses 250 ms). Veto: registry roles for the
  tuning members, an RFC.
- **K3** The render starts from rest at 0 mm with a preroll, not from the
  measured position: the same script renders the same motion every time.
- **K4** It renders whenever the card is not in glance, shown or not: it is the intent curve (ph-1qs5.1).

## Tests

- **Node, in `npm run check`:** `test/funscript-core.test.mjs`,
  `test/funscript-scheduler.test.mjs`, `test/funscript-stash.test.mjs`,
  `test/kinetic-trace.test.mjs` (Kinetic), and the host sections (e2), (i),
  (j) of `test/plugins.test.mjs`. Items:
  CONTRACT.md, per module.
- **Browser, `npm run check:funscript` in `test:browser`:**
  `test/funscript-player.test.mjs`, the shell bundle against a fake hub on
  the valencesim fixture catalog (CLOCK answered, PUBLISH granted with
  latency 1000 us and horizon 250 or 1000 per scenario, STREAM bundles
  decoded) and the fake Stash; media generated at run time (no media file
  committed). Asserts: the claim on the fixture and the decline without a
  segments STREAM; nothing sent before Play; preroll then video start;
  every start within half the horizon of its send; starts tile; seek
  re-stamps from now; Pause sends exactly one hold then silence; offset
  +50 moves stamps by 50 ms; rate 1.5 divides durations; a pushed PAUSE
  pauses the video within 100 ms with the latch words and nothing is sent
  after, clearing it does not play; `advgen.running` on grays Play; a
  second plugin gets the busy words; `advgen.running` mid-play pauses with
  no hold; a SOURCE_CONFLICT is drawn by exactly one bundle and no hold
  follows; identical rects across states; 40 px targets under a coarse
  pointer, and every slider taking touches over 85 % of its box; no
  control outside the card and no cut label (full, glance, handheld from
  264 to 959 px, the Stash grid); no computed `--bad`; no text in `--warn`;
  runtime copy
  within the COPY rules; glance at 220 px; a SOURCE_CONFLICT NACK reads
  `refused: rail owned by` in the status slot; Stash settings, tiles with
  apikey, a pick fetching the
  script with the header and playing it. Section (m), the hover bar on the
  page at 1280 x 800: hidden at rest, shown on a pointer move, hidden after
  `HOVER_IDLE_MS` idle and on leave; its Play prerolls through the
  controller and its pause, seek (a press at half the bar lands at half the
  clip, the tooltip reading that time) and the keys K, J, M likewise: every
  `play()`, `pause()` and `currentTime` set on the video follows the
  controller's own probe mark; volume and mute stored and back after a
  launch; Fullscreen enters page fullscreen bare with the media flag (the
  video alone, the stop pair on screen), Escape and F leave, the foot has
  no Fullscreen and F11 keeps the whole page; the mode toggle beside
  Fullscreen sets the shell's pref both ways; the library caret closes the
  column (the stage takes the card width) and is remembered; the analyzer column at
  `clamp(320px, 40%, 560px)` at 1280 and 1920 with no row label cut; at
  390 x 844 the bar inside the stage, the time uncut. Screenshots with
  `--shots <dir>`.
- **Live smoke (bare-minimum floor):** `--live --port P --http P+7`
  against valencesim on spare ports, started from Bash and stopped after:
  plays 8 s, asserts bundles, no NACK, striped heat and the over-limit
  words (the test script peaks past valencesim's 1000 mm/s), the plan strip moving, the strip's
  Pause pauses the video and Resume leaves it paused, a seek on the
  overview plays on from the new time with bundles flowing, an Advanced
  start grays Play, and last the strip's E-stop pauses the video with the
  latch words and nothing is sent after.
- **Playback, browser (h):** on the fake hub the A-B button reads its next
  press, the second press starts the loop with a band on the heat, the video
  wraps at least twice inside the section with no hold, the schedule has no
  hole past 30 ms across any seam, and the third press clears it. Section
  (a)'s seek checks expect the glide: one hold, a 500 ms segment to the
  script 500 ms on, then one joining span and the knots.
- **Live playback:** `--live-playback --port P --http P+7 [--shots dir]`
  against valencesim on spare ports with a private `--state`: a 60 s clip
  and script (400 to 697 ms spans of 25 to 75, inside the sim's speed limit,
  so plans keep their durations, and a 14 s gap), auto latency on, a seek
  glide, the gap sent as its one span with nothing homed, a pause that homes
  once after `homeAfterMs`, an A-B loop, and a
  Preview write the sim must show with its trial mark and then drop on
  Discard; one `PB-RESULT` JSON line. After it the caller restarts the sim on
  the same `--state`: the previewed field must read its stored value
  (Playback, measured; Chase gain: stored 0.9, trial 0.95,
  after the restart 0.9, no pb.cfg written).
- **The sync measurement:** `node test/funscript-sync-live.mjs --port P
  --http P+7 [--horizon 250|500|1000]`, never in `check`, skips when no sim
  answers or the hub has no segments STREAM, prints the hub_instance_id
  (two sims bound one port on Windows once). A node session with a control
  token runs the real door and scheduler over a synthetic feasible script
  (60 s: strokes, a fast section, a five-knot same-direction run, a 2 s
  hold, seeded random) with a perfect clock (pass A) and 24 fps on 60 Hz,
  3:2 pulldown (pass B: each frame shows 0 or 8.3 ms past its ideal instant;
  30 fps on 60 Hz is two vsyncs per frame, a constant with no jitter),
  including a seek, a rate change and a pause. For each observed
  plan: start = arrival - elapsed, end = start + duration, matched by
  duration and start. First bars, recorded on the epic and tightened later:
  hub adherence spread p95 at most 5 ms around its median, median at most
  30 ms (the plan strip publishes every 50 ms; design 2 read 20 to 23 ms);
  script-timeline spread p95 at most 5 ms (A) and 6 ms (B); coverage 98 %;
  seek and pause clean. The same-direction run's interior speed ratio is
  printed; under 0.3 prints WARN for G3, never FAIL. Each seek, rate change
  and pause waits until a sent segment is pending, and the pass fails when
  none was superseded (round 1 often read `0 of 0`). The adherence
  medians of a pass's first and second halves agree within 2 ms (a CLOCK
  choice that steps mid-play). The CLOCK exchanges' RTT range is printed.
- **What the sync bars do not cover.** The script holds every chord to half
  the hub's input speed limit. Content past it is stretched by the hub's
  planner (`limit.input.speed`, SPEC §9.6): plans start on time but end
  late, so the next segment hands off early and the stroke shrinks. Measured
  on valencesim at 2 norm/s: 100 ms full-range swings planned 3.55 x their
  commanded duration; 100 ms swings of 0.08 stretched 1.22 x in about half
  the segments (a quintic peaks at 1.875 x its chord). The player sends as
  authored (D11); the meter, the heat and the status slot flag it. A
  floor of about 14.0 ms remains against the knot (13.5 to 14.5 in
  sessions whose best exchange was 1 to 2 ms); STATE frames carry no hub
  stamp, so how much is the plan strip's observation (it publishes every
  50 ms on the 5 ms hub tick) and how much hub lateness is not measured.
  The horizon does not move it: 250, 500 and 1000 read alike. Each bar
  measures spread around its own run's median, so the floor's level is
  covered only by the halves bar and the printed medians; an offset trim
  carries between sessions within about 2 ms on this sim.
- **Hardware phase:** the same measurement against the P4 (192.168.1.118,
  `--port 82 --http 80`, no motor), owned by that phase only.

## Decisions (veto-able)

- **D1** Segments only, through one new host member. The hero requires
  `input.target` and `input.duration` and declines elsewhere (law 7). No
  samples fallback (designs 2 and 3's samples paths dropped: no
  samples-only hub exists). Veto: samples at 50 Hz through `submitMotion`.
- **D2** Lookahead is half the granted horizon, enforced in the host; the
  player offers up to 32 and advances by `sent`. Veto: fill toward the
  horizon minus a margin (RFC-087's "fill toward" sentence).
- **D3** The host owns time; `atMs` is an absolute `performance.now()`
  execution start (designs 1 and 2; design 3's relative ms dropped:
  ambiguous across the call). The existing `submitMotion` segment stamp
  (`now + latency`, executing at now + 2 x latency) is flagged for its
  owner, not changed here.
- **D4** Every knot free but the rests the player sees (Sync item 8, I8),
  no curve family (SPEC §9.6 clauses 2 and 5;
  RFC-108: the hub's `smoothness` shapes a free knot).
- **D5** Design 1's clock: rVFC, median, 5 ms/s slew, 25 ms step (between
  one 60 Hz vsync, slewed, and one dropped 30 fps frame, stepped: a 40 ms
  step slewed a dropped frame out over 6 s). Design 2's EMA is weaker on
  outliers; design 3's per-frame anchor breaks tiling.
- **D6** One map, spans tile, each sent once; every change is a restart that
  supersedes.
- **D7** Stop is a hold `min(200 ms, next action)` ending at rest, never the
  safety PAUSE (design 2's next-action bound on design 1's length).
  Preroll per design 1.
- **D8** Gates ride `api.gate` on the segments field (design 3): no new
  query member, no event bus, and it fixes that field reading
  `read-only` today. Designs 1 and 2's `motionGate`/`motionState` dropped.
- **D9** One producer per session; the hold ends 500 ms after the holder's
  last sent segment (design 3), not a flat 1 or 2 s.
- **D10** Offset, Range and Invert are client content transforms in global
  prefs; the window is never written; they need no `intent` (the
  analyzer's tuning writes do, A1).
- **D11** Speed meter and heat are display only.
- **D12** Thinning only after `RATE_EXCEEDED` (design 3).
- **D13** Stash: direct streams only, Boolean filter per A3 (design 2's
  schema read over design 3's retry), connect card in the Plugins pane and
  in the library's place.
- **D14** No `releaseMotion`: PUBLISH rate 0 releases no source (measured);
  the real release is G1.
- **D15** The door filters CLOCK (least RTT/2 + age x 50 ppm of the last
  32, a 16-exchange hunt at random gaps) because the sim showed the RTT/2
  error as the dominant spread and level term (Sync 7). The
  owed fix is in Valence's `clients/js`; the door's copy is removed then.
  Veto: drop the door filter and wait for Valence.
- **D16** A hidden page, an unmount, deactivate and a link loss stop
  playback until the operator's Play; a stall holds and continues on
  `playing` (Play is still in force).
- **D17** Local files by file input only; no drag and drop.
- **D18** Funscript literal semantics: the hub's curve between actions (Interpolation),
  `range` ignored, `inverted` honored, only L0 drives the rail, other axes
  named in the status.
- **D19** Library pages, never scrolls (DESIGN §10.6); the library is a side
  column in full and a tab in handheld (design 3's threshold, the renderer
  class's `FULL_UP`).
- **D20** The sync test's pass A script-timeline bar is 5 ms, not 2: with a
  perfect clock that spread is the hub adherence spread, whose bar is 5 ms,
  and the plan strip (start = arrival - elapsed, 2 to 9 samples per plan on
  a 22 ms cadence) cannot resolve 2 ms. Veto: a hub-stamped plan start
  event, then 2 ms.
- **P1** (ph-smvd.13) One A-B button that cycles start, end, clear, not two
  buttons or draggable points on the heat: one 40 px target fits the
  detail's cluster beside the range pills at 264 px. Veto: A and B pills on
  the heat (a drag vocabulary the heat does not have yet).
- **P2** A loop change while playing holds and re-anchors at lap 0: the
  unrolled clock cannot jump laps, so pressing B costs one hold (at most
  200 ms) before the wrap. Veto: keep the lap and re-base the clock (more
  state, same motion).
- **P3** The playback controls sit on the settings card, not the transport:
  the transport has no free fixed column at 264 px, and these are set once
  per session, not per scene. Veto: a transport Loop toggle in the
  handheld third row.
- **P4** The fixture re-record brought settings-trial's commit/revert op to
  the Home page as a generic loose action (an Actions card). The settings
  model now keeps `action.trial` out of the generic triggers: the op acts
  only on the sender's own trials, the generic renderer makes none, and the
  analyzer's Apply and Discard are its only callers. Veto: a generic trial
  verb, after RENDERING says how a trial value is marked (RFC-099 left it open).
- **P5** `createLoop` counts a lap on a frame in the section's first half
  while a wrap is pending, not on a backward jump from the last frame: a
  loop set at the playhead wraps before any frame, and the jump rule never
  fired (found by browser section (h)).

## Protocol gaps and risks

- **G1 (Valence RFC owed)** A stream source stays owned until the session
  ends: SPEC §11.4 names "an explicit release intent" that the registry
  never defined, and PUBLISH rate 0 does not release it. Measured on
  valencesim: after playback the jog is refused `SOURCE_CONFLICT` even from
  the owning session. The buttplug and TCode paths share it. Proposal
  direction: dropping a source-mapped publication releases its source.
- **G2 (Valence RFC plus Nucleus bead owed)** Stream versus generator
  exclusion is arbiter policy (§11.4 leaves cross-type priority to the
  machine); on valencesim an Advanced start and a segments bundle were each
  accepted while the other owned the rail. The player's generator gate is a
  client stopgap.
- **G3 (closed, ph-t9go)** With an unspecified end velocity and no
  successor scheduled when a long span starts, the hub resolves rest
  (RFC-058): same-direction knots stopped. The player sends the end
  velocity (Sync item 8); `--live-playback` checks no non-reversal knot
  rests.
- A live segments grant makes Nucleus refuse its horizon setting
  (INTERLOCK) until the session ends; `submitMotion` already does the same.
- The shell's CSP is not present in the browser tests: R-B is verified in
  `npm run tauri dev` only.
- The Stash key sits in localStorage in plain text, outside the
  `phosphor.*` prefs backup, and rides media URLs as `?apikey`.
- A minimized or occluded WebView2 throttles timers; the player pauses on
  a hidden page instead of streaming in bursts.
- Host files `shadow.svelte.js` and `actions.js` carry uncommitted hunks in
  the main checkout (handoff `ph-yozw`): the host builder keeps its hunks
  small and append-only there.
- The pre-existing `e-stop latched` wording shows on Halt hubs too (law
  15); a separate bead, not this work.
