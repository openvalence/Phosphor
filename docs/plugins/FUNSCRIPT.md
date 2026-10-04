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
| plugin | `index.js`, `prefs.js`, `manifest.json` | registration, the settings card (Stash connect, curve, playback), prefs defaults, the factory entry, docs, the fake-hub browser test and the live smoke |
| interp | `interp.js` | ten curves between actions, smoothing and a slew limit; the settings card's curve rows (Interpolation) |
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
action gap carrying the knot's end velocity (Sync item 8), no
`curve_family`, no client feasibility past the handoff bound. Dense scripts are sent as authored
and thinned only after a `RATE_EXCEEDED`, at the grant rate, extrema kept.

## Interpolation

`interp.js` (ph-smvd.10) bends the content between actions: the tangents
the hub draws through and the curve the detail view draws. Linear is the default, and with smoothing and slew off
`wire()` returns the parsed Script itself: everything above holds byte for
byte. Every other setting still sends one segment per action (`wire()`,
SPEC §9.6 item 5): the action's position over its span, ending at the
mode's tangent there (`vel`, Sync item 8; kept at a reversal, so the
mode's overshoot reaches the hub, within 1.5 x the lesser chord), and no
`curve_family`: the hub draws the curve between actions. Smoothing and
slew move each action to the filtered curve's value there and send the
chord rule. The drawn curve (`shape()`, pieces of at most 40 ms,
`STEP_MS`) is display only: the detail view and the speed meter (the heat
reads the file's actions, Look).

| mode | rule | parameter | leaves its two actions |
|---|---|---|---|
| Linear | the authored meaning | | no |
| Step | hold, then the move (drawn); at rest on every action on the wire | | no |
| Smoothstep | `3u^2 - 2u^3`, at rest on every action | | no |
| Cosine | `(1 - cos(pi u)) / 2`, at rest on every action | | no |
| Catmull-Rom | cardinal: `(1 - tension)(y[k+1] - y[k-1]) / (t[k+1] - t[k-1])` | tension 0..1 | yes |
| Hermite | Kochanek-Bartels bias: `((1 + b) d_in + (1 - b) d_out) / 2` | bias -1..1 | yes |
| Monotone | Fritsch-Carlson | | no |
| PCHIP | Fritsch-Butland, MultiFunPlayer's rule | | no |
| Akima | Akima 1970 | | slightly |
| Makima | MATLAB makima, MultiFunPlayer's rule, symmetric second phantom | | slightly |

The cubic modes start and end the script at rest; every value is clamped to
0..1. After any mode, a smoothing window (a centered box, 0 to 500 ms, no
lag) and then a slew limit (0 to 2000 mm/s, causal, over the window's length
in mm times the Range share; off without the length) apply. Prefs key
`interp`, mirrored as `phosphor.funscript.interp`: `{mode, tension, bias,
smoothMs, slewMmS}`; the controls sit on the plugin's settings card. The
detail view draws the shaped curve as intent and the file's actions muted
under it.

Veto-able (ph-smvd.10):

- **I1** One segment per action in every mode, ending at the mode's
  tangent, no curve family (operator ruling 2026-10-04). The 40 ms pieces
  it replaces jittered between waveform and hold on silicon. Measured on
  the machine's planner (Nucleus kinetic-wasm, 500 mm rail, three 60 s
  scripts): 410-930 segments/min down to 109-143 (the action count), the
  error at every action 1-11 mm (step aside) down to 0. Cost: between actions the hub
  draws its quintic through the tangents, not the JS curve: 3-15 mm from it
  where the pieces held 1-20 mm (linear's own: 11-27 mm).
- **I2** Step is offered (the notes advise against it). On the wire it
  rests on every action like smoothstep; a true hold-then-jump would take
  two segments per action.
- **I3** The slew limit is a content transform the operator sets, like
  Range; `limit.input.speed` on the hub stays the bound (SPEC §9.6). Off by
  default.
- **I4** Makima uses the symmetric second phantom, not MFP's `pm2`: it
  matches MFP from the third span on (tested) and rests on the first action.
- **I5** The slew limit reads the window length when the script loads, the
  hero's fields change or the Range commits; a window resize alone does not
  reshape.

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
8. **End velocity on the wire** (ph-t9go). Every segment carries
   `input.end_velocity` (SPEC §9.6 item 5). Left `unspecified`, the hub
   resolves a knot to rest whenever its successor is not yet scheduled
   (RFC-058), and at a 125 ms lead that is every span over 125 ms: the
   carriage stopped at each knot (chunky on silicon). Span k ends at knot
   k's slope: the shaped curve's own (`interp.js` `vel`, step 0) or, for
   linear and filtered curves, the mean of the two chords; 0 at a reversal,
   beside a hold and at the ends; never past `segment_handoff_k` (1.5) x
   the lesser chord, the bound the hub applies only once the successor is
   scheduled, so a slow span never has to arrive fast. In norm/s: slope x
   1000 x rate x (hi - lo), negated under invert. The seek glide ends at
   the chord it lands in; stop, preroll and home end at 0, since nothing is
   scheduled after them and a hub coasts a moving end before it brakes.
   Measured on valencesim (live-playback, 400 to 697 ms spans): non-reversal
   knots at rest 9 of 10, median plan speed 1 % of the span peak, before;
   0 of 9, median 86 %, after.
9. **No knot reads as a hold.** For the dwell rule (5) the scheduler runs on
   `dwellMerge(script, T)`: a knot that moves on in the same direction but
   less than 0.02 of the window (through Range) past the last kept knot is
   dropped, so its neighbors make one span through it. Ends, flat knots,
   reversals and knots the curve rests on stay. With one segment per
   action it rarely fires. Measured
   on the machine's planner (Nucleus kinetic-wasm, the sim's limits),
   before: a 1-4 point random walk dwell-zeroed 36 knots and stopped at 37
   of 79 that are not reversals; 30 ms clock steps every 1.5-4.5 s stopped
   the staircase at 9 knots; makima on the staircase dwell-zeroed 1140 of
   1439 pieces. After: none.
10. **Error budget on the sim.** Clock under 0.3 ms, t_off grid 0.1 ms,
   duration rounding 0.5 ms, display map quantized to half a vsync (8 ms at
   60 Hz). Panel lag and Bluetooth audio delay are physical: the offset
   trims them; the Hardware phase measures them with a photodiode and the
   scope.

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

Composition follows the card's own box (ResizeObserver), with the
renderer-class thresholds: full at 960 px and wider (`FULL_UP`), handheld
264 to 959 (`GLANCE_UP`), glance under 264.

```
FULL
+------------------------------------------------+--------------------+
| source 24: Open files (compact), title, caret > | search, sort, dir  |
| stage 16:9, object-fit contain, the hover bar   | tiles, paged,      |
|   (Play, mute, volume, time, mode, Fullscreen)  |   never scrolled   |
|   empty: 'Open a video'                         |                    |
| strip 28: Motion | Offset | Invert | speed      | page n / m, N      |
| detail 96: automation curve (intent), reality   |                    |
|   trace, plan, range pills, zoom, A-B,          |                    |
|   Analyzer, Settings (page only)                |                    |
| overview 24: whole-script heat, window box,     |                    |
|   vertical-pill scrub (40 px hit); its line     |                    |
|   runs up through the detail: one playhead bar  |                    |
+------------------------------------------------+--------------------+
| status slot 20, one line, aria-live                                  |
+----------------------------------------------------------------------+
```

- **Strip and source row** (operator ruling 2026-10-03, `ph-n4t7`): Motion,
  Offset, Invert and the speed reading sit in one fixed 28 px row under the
  video, left-aligned; Play and the time are the hover bar's, and the strip
  draws them only where the bar cannot (glance, and the handheld analyzer's
  thumbnail, three rows as before). The source row is 24 px with a compact
  Open files. Under a coarse pointer both rows are `var(--tap)` (law 12).
- **Page fill** (`ph-yuce`): the page registers `fill` (docs/PLUGINS.md,
  Pages), so on the desktop it is a column filling the content pane: the
  stage row grows (the video contained, letterboxed in the stage's dark),
  the strip, timeline and status keep their fixed heights, the library
  column keeps 320 px. An open Settings section takes at most half the page
  and scrolls within; the card yields height above it but never under
  340 px (a 120 px stage). The phone layout is not filled.
- **Library caret** (`ph-n4t7`): a tab at the source row's right end, on the
  library column's edge, `Library`: it closes the column and the player
  takes the width, open again from the card's edge; a view switch kept in
  pref `libOpen`. Full only: handheld has its tabs.

- **Handheld:** tabs Player | Library (shown only here; in full the library
  is the side column) swap the one main region in place (a view switch,
  never a write; the video keeps playing under the library); detail 72 px;
  the strip one fixed row. Its button columns are `max-content`
  and the speed reading's floor is 10ch (`20000 mm/s`), so a label never
  squeezes: an `auto` column shrank a button to its 40 px min-width and
  cut a label without ever overflowing. Where the row overflows the card
  (measured on a width change, a Look change and an analyzer toggle; at or
  under 386 px at the default Look, 468 at 1.4), `data-narrow` gives two
  fixed rows, Motion and Offset / Invert and speed; beside the analyzer,
  three, Play and time / Motion and Offset / Invert and speed. The floor scales with the Look while the tier
  thresholds stay the shell's px: at Look 1.4 the source row (tabs and
  Open files) needs 304 px and cuts `Open files` below it.
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
  playhead, selected tile, focus and the analyzer's Kinetic line `--highlight`; gates and over-cap
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
  10 %). A pill's hit box stays inside the detail, which clips, and only
  the drawn pill rides the value to the edge (a clipped box took touches
  over 60 % of itself). They preview in the intent look and commit on release.
  Offset is a strip number field (drag 5 ms per 2 px, type, arrows 5 ms,
  Shift 50 ms). Zoom is two buttons (5, 10, 20, 60 s); the wheel is never
  captured. Keys: Hover controls.
- **Hover controls** (ph-mcfe, ruling 2026-10-03: familiar, YouTube's
  shape). Over the video in the card and the page: a bottom gradient bar
  with the seek bar (played in `--highlight`, buffered lighter, a dot and a
  time tooltip under the pointer), then Play/Pause, Mute, volume, current /
  total time and, on the page only, the mode and Fullscreen at the right.
  The mode is a two-state glyph, `In window / Borderless`, in the desktop
  shell only: it asks the shell to set its pref `fullscreen` (docs/PLUGINS.md,
  Pages) and stores nothing itself; under 440 px of stage it yields with the
  volume slider. It shows on
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
- **Speed meter.** The current stroke's speed in mm/s when the window's
  unit allows, else %/s, against `limit.input.speed` with `--warn` past it.
  Display only (SPEC §9.6: limits are for display and optional
  pre-adaptation); the hub's planned peak runs higher (1.875 x for a
  quintic), so it under-warns.
- **Motion switch.** Off, the video plays and nothing is sent. On by
  default: Play is the act that moves the machine.
- **Targets.** Every control is at least `var(--tap)` (40 px floor under a
  coarse pointer, law 12).
- **Copy** (COPY.md): Play, Pause, Open files, Library, Player, Motion,
  Offset, Invert; the hover bar's `Play (k)`, `Pause (k)`, `Mute
  (m)`, `Unmute (m)`, `Seek`, `Fullscreen (f)`, `Exit fullscreen (f)`,
  `In window / Borderless`; the timeline's `Analyzer` (a sine in a box) and
  `Settings` (sliders); the caret's `Library`;
  `Machine later (+) or earlier (-)`; `Search scenes`;
  `No scene loaded`, `No script for this video`, `No script for this
  scene`, `Positioning`, `Buffering`, `Format not playable here`,
  `Script past the input speed limit`, `Extra axes ignored: roll,
  twist`; the parse notes (`2 positions clamped`, `range ignored`,
  `actions sorted`, ` (+N more)` after the first) and
  refusals (`script longer than 24 hours`); the host's gate and door
  words as sent.
- **Local files.** One `input type=file multiple` (video, audio,
  `.funscript`); `pairFiles` matches by base name; the video gets an object
  URL, revoked on replace and dispose. No drag and drop: Tauri intercepts
  drops, and turning that off risks the builder palette.

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
- **Low latency** (off by default). RFC-087 item 3 names no 100 ms horizon:
  a low-latency segments client stamps 50 ms ahead under the same 250 ms
  horizon. So the setting caps the offer at `LEAD_LOW_MS` (50), narrows the
  clock ring to 8 frames and raises the slew to 15 ms/s (a display-latency
  change followed in about 0.9 s instead of 2.7), and lets the rAF fallback
  take over after 100 ms without a frame. It does not move the alignment:
  stamps are absolute, so a lookahead player's felt latency is the offset,
  not the lead. What it costs is stall tolerance (about 105 ms down to 30)
  and more vsync jitter in the stamps; the CPU cost is nil in a page, where
  the rAF loop already runs every frame (MFP's precise sleep has no
  analog).
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
  bidding that down) and beside the operator's offset.

The card (ph-smvd.13):

- **Controls.** The plugin's settings card carries nine Playback rows under
  the curve rows: Loop (the whole video), Loop count (`forever` at 0), Pause
  home, After pause, Home point, Home speed (%/s), Seek glide (`jump` at 0),
  Low latency, Auto latency; toggles read On or Off in a fixed box, sliders
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
  window against 0.0935 in plain play. Low latency kept every offer within
  49.5 ms with 19 bundles in 7.5 s and no NACK; compensation held
  14.55 ms (lag 14.26 ms).

## Analyzer (ph-smvd.11)

The expand button on the detail (Blender's maximize glyph, tooltip
`Analyzer`) turns the heat into a tuning bench: the script with the hub's plan
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
  streams, curve, infeasible moves, settling), the writable fields that
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
- **Legend.** The detail's lines: the shaped script curve `--intent` (2 px),
  the file's actions muted (`--line-4`) under it, `plan.current` `--intent`
  at reduced weight, the measured position `--reality`, and the Kinetic
  preview `--highlight`, named by the swatch before the Kinetic readout.

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

- **What runs where.** Nucleus `tools/kinetic-wasm` compiles the P4's
  `MotionArbiter.cpp`, `kinetic.hpp` and the vendored Ruckig (the same
  sources, not a model) into one standalone `kinetic.wasm`, zero imports.
  The plugin carries it base64 in `kinetic/bytes.js`: an override copy is one
  file (R-C) and `connect-src` refuses a plugin's fetch, so the module is the
  artifact everywhere (dev, the shell, an override). `kinetic/kinetic.js`
  starts one Worker from a blob URL per open analyzer, instantiates the wasm
  once and answers render requests; the page thread never runs the planner.
- **Input.** The wire Script's segments (`ctl.wire`, interp.js `wire()`,
  through `segmentsOf`) as the host sends them: one per span ending at the
  same end velocity, no curve family, each
  submitted `LEAD_MS` (125, half the 250 ms horizon) before its start, after
  a 1200 ms preroll from rest at 0 mm to the first knot at media 0. Limits
  (`limit.input.*`), the rail (`geometry.max_travel`) and the window
  (`window.min`, `window.max`) by role; the Tuning rows by `kinetic_tuning`
  member name (K2). The values are the ones the analyzer shows: in Preview
  the hub's trial values, during a drag the draft, before anything is
  written. Any change re-renders; a newer render supersedes the older, which
  frees its handle at its next 8192-step chunk.
- **Output.** 1 ms steps, kept every 5 ms (more on scripts past 1000 s, at
  most `KIN_MAX_SAMPLES`): `position_mm` (what an on-time LP core renders),
  velocity and accel, the flags ORed per kept sample, and counts over every
  step. The detail draws the position `--highlight` under the script curve; the
  analyzer's Kinetic line reads `Kinetic: wasm  n anomalies` and each nonzero
  flag time: `clamped`, `guard` (the fallback bit: the Ruckig guard or a
  stretched deadline) and `shaped` (Blend spent amplitude or shape). Its
  tooltip holds the version string, the render time and the anomaly kinds.
- **What it replaces.** There was no JS planner model. The analyzer's only
  picture of the machine was the shaped script itself (interp.js `shape()`
  through `applyT`, the intent curve) with the limit judged by chord speed
  against `limit.input.speed` (timeline.js `heatStops`, the speed meter's
  `strokeSpeed`). That stays the card's picture, and the analyzer's fallback.
- **Fallback.** When the worker cannot start or the compile is refused, the
  line reads `Kinetic: fallback` and nothing is drawn over the shaped curve
  and the heat. A planner refusal is not a fallback: `Kinetic: wasm  window
  refused`; without the limits, window or rail: `no limits, window or rail`.
- **Pin rule.** `kinetic/kinetic.pin` names the Nucleus commit, the
  `kinetic_version()` string (`nucleus <sha12> kinetic <x.y.z>`) and the
  size. The bytes are "the machine" only for firmware built from that
  commit; a `-dirty` build is never vendored. Bump with `node
  test/kinetic-pin.mjs --write` (Nucleus clean at the new commit, emsdk at
  `../.tools/emsdk` or `$EMSDK`); a plain run checks bytes.js against the
  pin and, when Nucleus HEAD is the pin, rebuilds and byte-compares.
- **Determinism.** `test/kinetic-trace.test.mjs` (in `npm run check`)
  replays Nucleus' native fixture (`test/fixtures/kinetic_trace.json`,
  copied from Nucleus c9e9aee, unchanged through the pin) through bytes.js:
  600 of 600 blocks of 1 ms samples bit-identical, p/v/a 0 ULP; `renderCore`
  on the same segments returns the same `position_mm` at all 50,000 steps
  before the fixture's tuning change.
- **CSP.** Compiling wasm needs `'wasm-unsafe-eval'` in `script-src`
  (PLUGINS.md); section (k) shows the compile refused without it.
- **Measured** 2026-10-03 (Chromium, section (k)): 60 s at 1 ms with every
  sample kept, 11 to 16 ms in the worker, 16 to 23 ms to the page; the 30 s
  test clip in the analyzer, 3 ms. The shell bundle grows by 202,022 B raw,
  about 79 KB gzipped (the wasm is 151,394 B); the hub-served build carries
  no factory plugin and does not grow (`npm run build:only`: no wasm in it).
- **What it is not.** The emitter is ideal and the tick exact: the board's
  task jitter and edge quantization are absent (Nucleus
  tools/kinetic-wasm/README.md).

Decisions (veto-able):

- **K1** bytes.js only, no separate `.wasm` file: one artifact for every
  load path, and a second copy could only drift. Cost: base64's third in the
  shell bundle (79 KB gzipped against 58 KB for the raw wasm).
- **K2** The Tuning rows bind `kinetic_tuning` by member name (the 0x3120
  card's fields carry the struct's names; an `_ms` row binds its `_us`
  member): the contract's one binding that is not a role. `overshoot_guard`
  has no row on valencesim and keeps the factory value; `schedule_horizon`
  is not bound (the render uses 250 ms). Veto: registry roles for the
  tuning members, an RFC.
- **K3** The render starts from rest at 0 mm with a preroll, not from the
  measured position: the same script renders the same motion every time.
- **K4** It renders only while the analyzer is open.

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
  once after `homeAfterMs`, an A-B loop, low latency through the settings card, and a
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
- **D4** As authored: the knot's end velocity (Sync item 8), no
  `curve_family` (SPEC §9.6 clauses 2 and 5). `unspecified` was the first
  ruling; it stopped at same-direction knots on silicon (G3, ph-t9go).
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
- **D18** Funscript literal semantics: linear between actions by default (Interpolation),
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
