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
| R-A | CANON FLAG, DESIGN §2 "no HTTP backdoors" | `api.net.fetch(url, init)`, permission `net.fetch`, through the shell's tauri-plugin-http; refuses the connected hub's own origins, so it never becomes a machine path | no Stash: the CSP refuses a plugin's page fetch (`connect-src`), and Stash is not known to answer a CORS preflight |
| R-B | config | CSP `media-src 'self' blob: http: https:` and `img-src` + `http: https:`; http capability + `https://**` | `media-src` falls back to `default-src 'self'`: not even a local file (blob:) plays in the shell |
| R-C | CANON FLAG, PLUGINS.md "manifest plus one module" | a multi-module factory plugin; Vite bundles the siblings; an override copy in the plugins folder must be bundled into one file first | the plugin builder inlines the modules into `index.js` at the end (the import graph has no cycles and no import-time side effects) |
| R-D | pushback on the computed task | permissions `motion` + `net.fetch`, not `intent`: the player writes no field, and declaring an unused permission defeats the honesty model. The manifest gets no `panes` key: the schema has none; registration is code (`registerHero`, `registerSettings`) | — |

When ruled, R-A and R-C become rows in DESIGN.md's Amendments table and
sentences in PLUGINS.md; R-B is a CSP edit verified in the real shell (C-8).

## Modules

| key | files | brief |
|---|---|---|
| core | `funscript.js` | parse and validate (sort, dedupe, clamp, `inverted`, `range` ignored, notes), linear interpolation, chord speed, thinning that keeps extrema, heat bins, axis naming and file pairing; pure |
| scheduler | `clock.js`, `scheduler.js` | the media clock (rVFC display times, median, slew, step), one segment per funscript span, offset/range/invert, stop and preroll segments, the per-frame submit cadence, refusal classes |
| host | kernel files | `api.submitSegments`, the lookahead door in `motion.js`, `api.gate` on a motion-input field, the producer lock, `api.net.fetch`, the CSP; generic, no funscript knowledge |
| player-ui | `ui.js`, `timeline.js` | the controller and the card: video stage, overview heat and scrub, the automation detail view, transport, status slot, layout tiers |
| stash | `stash.js`, `library.js` | GraphQL client over an injected fetch, caching, URL keying, the library grid and the connect card, the fake Stash |
| plugin | `index.js`, `prefs.js`, `manifest.json` | registration, prefs defaults, the factory entry, docs, the fake-hub browser test and the live smoke |

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
action gap, `input.end_velocity` at its `unspecified` sentinel, no
`curve_family`, no client feasibility. Dense scripts are sent as authored
and thinned only after a `RATE_EXCEEDED`, at the grant rate, extrema kept.

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
4. **Events.** `playing` and `seeked` anchor on the next frame and restart;
   `ratechange` anchors at the new rate and restarts; `pause`, `seeking`,
   `waiting`, `error`, a hidden page and an unmount send one hold; `ended`
   sends nothing (the last segment ends at rest).
5. **Restart is a supersede.** The in-progress span goes first with its
   start in the past (the host clips it, keeping the knot time), then the
   window. The hub drops everything it held from that `t_base` on.
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
8. **Error budget on the sim.** Clock under 0.3 ms, t_off grid 0.1 ms,
   duration rounding 0.5 ms, display map quantized to half a vsync (8 ms at
   60 Hz). Panel lag and Bluetooth audio delay are physical: the offset
   trims them; the Hardware phase measures them with a photodiode and the
   scope.

## Safety

- **The gate.** `api.gate(fields.dur)` on the segments field returns, in
  order: `no hub link`, `session not authorized`, the latch words
  (`e-stop latched`, `paused, resume to continue`), `stop the pattern first`
  (`pattern.running` or `advgen.running` reads on), `rail owned by <label>`
  (control-owner shows a source owned by another session), `motion input in
  use by <plugin>`. Play is grayed with the words in the status slot (law
  3); `PluginSlot` re-runs `update()` on a latch or owner change.
- **Mid-play.** The scheduler re-reads the gate every frame and the door
  refuses under the latch. Any gate or fatal refusal pauses the video in
  the same frame, sends nothing, and shows the words: the rail then
  belongs to a generator, another session, another plugin or the latch,
  and a hold would land in their stream (on valencesim, which accepts both
  sources, it did: G2).
- **A refusal the gate cannot see.** A STREAM bundle has no answer, so a
  `SOURCE_CONFLICT` from a source the gate does not show arrives as a
  NACK after the bundle that drew it. The hub drops that bundle; the
  player pauses on the next frame. Bundles sent inside that round trip
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
- **Containment.** No fullscreen, picture-in-picture or native controls
  (law 1): the strip's e-stop and pause stay on screen. No red (law 13).

## The card (player-ui)

Composition follows the card's own box (ResizeObserver), with the
renderer-class thresholds: full at 960 px and wider (`FULL_UP`), handheld
264 to 959 (`GLANCE_UP`), glance under 264.

```
FULL
+------------------------------------------------+--------------------+
| source bar: Open files, title                   | search, sort, dir  |
| stage 16:9, object-fit contain                  | tiles, paged,      |
|   empty: 'Open a video'                         |   never scrolled   |
| overview 24: whole-script heat, window box,     | page n / m, N      |
|   vertical-pill scrub (40 px hit)               |                    |
| detail 96: automation curve (intent), reality   |                    |
|   trace, fixed center playhead, range pills     |                    |
+------------------------------------------------+--------------------+
| status slot 20, one line, aria-live                                  |
| transport var(--tap): Play | time | Motion | Offset | Invert |        |
|   speed meter | Mute, volume                                          |
+----------------------------------------------------------------------+
```

- **Handheld:** tabs Player | Library (shown only here; in full the library
  is the side column) swap the one main region in place (a view switch,
  never a write; the video keeps playing under the library); detail 72 px;
  transport in two fixed rows. Their button columns are `max-content`
  and the speed reading's floor is 10ch (`20000 mm/s`), so a label never
  squeezes: an `auto` column shrank a button to its 40 px min-width and
  cut `Mute` at 426 to 433 px without ever overflowing. Where the rows
  overflow the card (measured on a width change and on a Look change; at
  or under 480 px at the default Look, 572 at 1.4), `data-narrow` gives
  three fixed rows, Play and time /
  Motion and Offset / Invert, speed and Mute, and drops the volume slider
  (the device's own volume stays). A 390 px phone's 326 px card spilled
  101 px before this. The floor scales with the Look while the tier
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
- **Look.** Script curve, heat and intent tick `--intent`; measured
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
- **Handles** (Advanced Penetration's vocabulary): the scrub playhead is a
  vertical pill (left-right; arrows 5 s, Shift 30 s, Home, End); range low
  and high are horizontal pills at the detail's left edge, high one tap to
  the right of low so close values never stack (up-down; arrows 1 %, Shift
  10 %). A pill's hit box stays inside the detail, which clips, and only
  the drawn pill rides the value to the edge (a clipped box took touches
  over 60 % of itself). They preview in the intent look and commit on release.
  Offset is a transport number field (drag 5 ms per 2 px, type, arrows 5 ms,
  Shift 50 ms). Zoom is two buttons (5, 10, 20, 60 s); the wheel is never
  captured. Space toggles Play while the card has focus.
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
  Offset, Invert, Mute; `Machine later (+) or earlier (-)`; `Search scenes`;
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

Assumptions (each marked `ASSUMPTION An` in `stash.js`; verified by
`node test/funscript-stash.test.mjs --live <base> --key <key>` once the
operator gives a URL and key):

- **A1** GraphQL at `<base>/graphql`, POST JSON, header `ApiKey: <key>`;
  no session cookie is used.
- **A2** Media URLs (`stream`, `screenshot`) accept `?apikey=<key>`.
- **A3** `SceneFilterType.interactive` is a plain Boolean (design 2 read
  Stash's develop schema 2026-10-02). The brief's
  `{value: true, modifier: EQUALS}` form would fail validation.
- **A4** findScenes returns `count` and `scenes { id title date rating100
  interactive interactive_speed files { duration width height } paths {
  screenshot stream funscript } studio { name } performers { name } tags {
  name } }`; `files[].duration` is in seconds.
- **A5** `paths.stream` is the original file, direct and Range-capable;
  WebView2 plays mp4 (H.264/AAC) and WebM, not every HEVC or MKV.
- **A6** `paths.*` carry Stash's own idea of its host; the client rebases
  them onto the configured base.
- **A7** `paths.funscript` (`<base>/scene/<id>/funscript`) serves the main
  script JSON with the ApiKey header; Stash serves no multi-axis companions.
- **A8** Sort keys `date`, `created_at`, `title`, `rating`,
  `interactive_speed` exist; direction is ASC or DESC.
- **A9** `{ version { version } }` exists for Test.

Out of v1: transcodes, HLS and `sceneStreams` (a transcode restarts
`currentTime` at the seek point, which the clock would need to model),
markers, write-back (play count), Stash's heatmap PNG (its red ramp breaks
law 13; the card draws its own token heat).

## Tests

- **Node, in `npm run check`:** `test/funscript-core.test.mjs`,
  `test/funscript-scheduler.test.mjs`, `test/funscript-stash.test.mjs`,
  and the host sections (e2), (i), (j) of `test/plugins.test.mjs`. Items:
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
  within the COPY rules; glance at 220 px; a SOURCE_CONFLICT NACK in the
  status slot; Stash settings, tiles with apikey, a pick fetching the
  script with the header and playing it.
- **Live smoke (bare-minimum floor):** `--live --port P --http P+7`
  against valencesim on spare ports, started from Bash and stopped after:
  plays 8 s, asserts bundles, no NACK, striped heat and the over-limit
  words (the test script peaks past valencesim's 1000 mm/s), the plan strip moving, the strip's
  Pause pauses the video and Resume leaves it paused, a seek on the
  overview plays on from the new time with bundles flowing, an Advanced
  start grays Play, and last the strip's E-stop pauses the video with the
  latch words and nothing is sent after.
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
- **D4** As authored: end velocity unspecified, no `curve_family`
  (design 3, SPEC §9.6 clauses 2 and 5). Design 1's client PCHIP end
  velocities are the veto alternative; if the live test shows stop-start at
  same-direction knots (G3), the first fix is a Nucleus bead.
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
  prefs; the window is never written; no `intent` permission (R-D).
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
- **D18** Funscript literal semantics: linear between actions for display,
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
- **G3 (hub behavior, measured by the sync test)** With an unspecified end
  velocity and no successor scheduled when a long span starts, the hub
  resolves rest (RFC-058): a slow same-direction run may stop at each
  knot. Reversals, most funscript actions, are unaffected.
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
