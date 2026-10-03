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
- Bind by registry role only. Channel ids appear in tests and fixtures only.
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
| interp | ph-smvd.10 | `interp.js`, `test/funscript-core.test.mjs` (the interp section) |

Bare file names live in `plugins/factory/funscript-player/`. Import graph,
no cycles: `index -> ui, prefs, library, interp`; `ui -> funscript, clock,
scheduler, stash, library, timeline, prefs, interp`; `scheduler -> funscript`;
`timeline -> funscript`; `library -> stash`; `stash -> funscript`;
`prefs -> interp`; `interp -> funscript`.

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
  durationMs: number }        // > 0, wall ms

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
  stash: {base: '', key: ''}, lib: {q: '', sort: 'date', direction: 'DESC'}, view: 'player', zoomMs: 10000,
  interp: {mode: 'linear', tension: 0, bias: 0, smoothMs: 0, slewMmS: 0} }
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

// scheduler.js
export const STOP_MS = 200, PREROLL_MIN_MS = 400, PREROLL_STROKE_MS = 1200, PREROLL_SKIP = 0.05, OFFER_MAX = 32;
export const TRANSIENT;   // frozen Set: 'waiting for the stream grant', 'NO_CLOCK', 'NOT_SENT', 'RATE_EXCEEDED'
export function applyT(norm, T);   // -> T.lo + (T.invert ? 1 - norm : norm) * (T.hi - T.lo)
export function strokeSpeed(script, mediaMs, T, spanMm);   // spanMm: number | null -> {v, unit: 'mm/s' | '%/s'};
                                                           // at rate 1; the caller scales it by the rate
export function createScheduler({ submit, now = () => performance.now(), log = () => {} });   // -> Scheduler
// log(msg, level), api.log's shape; a repeated reason is logged once.
// submit: (Seg[]) -> SegResult, i.e. api.submitSegments.
// Scheduler = {
//   load(script | null),        resets the cursor; with null every call returns {ok: true, sent: 0}
//   setTransform(T),            takes effect at the next restart
//   restart(clock),             cursor = max(1, indexAfter(script, mediaAt(now - T.offsetMs))); the
//                               in-progress span goes first with its start in the past (the host clips it)
//   tick(clock) -> TickResult,  skips spans whose end passed (skipped++), offers up to OFFER_MAX segments
//                               from the cursor, advances by result.sent only.
//                               Span k (knot k-1 -> k): atMs = clock.displayAt(at[k-1]) + T.offsetMs,
//                               durationMs = (at[k] - at[k-1]) / clock.rate, norm = applyT(pos[k], T).
//                               A TRANSIENT reason is fatal false (retry next tick); RATE_EXCEEDED first
//                               re-thins the unsent script at 1000 / rateHz ms, once per rate. Any other
//                               reason is fatal true. The thinning covers the unsent tail from knot
//                               cursor - 1 on; a restart drops it.
//   stop(clock) -> TickResult,  one hold: atMs = now(), d = min(STOP_MS, ms to the next action),
//                               norm = applyT(posAt(script, m + d * rate), T), durationMs = d,
//                               m = mediaAt(now - T.offsetMs);
//                               it has no successor, so it ends at rest
//   preroll(mediaMs, hereNorm) -> Seg | null,
//                               hereNorm: 0..1 | null. null when |hereNorm - target| <= PREROLL_SKIP;
//                               else {atMs: now(), norm: target, durationMs: PREROLL_MIN_MS +
//                               PREROLL_STROKE_MS * |delta|}, target = applyT(posAt(script, mediaMs), T),
//                               delta = 1 when hereNorm is null. The caller submits it and plays at its end.
//   cursor: number, skipped: number }
```

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
export const CSS, COPY, FULL_UP = 960, GLANCE_UP = 264;
export function createPlayer(api);   // -> Player
export function createControl(deps);   // the controller without DOM: every boundary injected, for the node test
export function compositionOf(width), clampOffset(v), windowShare(v, lo, hi), ceilingOf(api, fields),
  localScene(files, createURL), extraNote(script, extra);   // pure helpers, node-tested
// Player = {
//   mount(el, fields) -> { update(), unmount() },
//       fields: {target, dur, pos?, lo?, hi?, vmax?, patRun?, advRun?} from the hero spec
//   dispose(),   hold, pause, revoke object URLs, stop the frame source; deactivate calls it
//   setInterp(interp),   reshape the loaded Script (interp.js shape) and restart a playing scheduler
//   state }      PlayerState, read-only to everyone else
// PlayerState = { phase: 'empty'|'ready'|'preroll'|'playing'|'held'|'error', scene: Scene|LocalScene|null,
//   script: Script|null, T, motion: boolean, status: {text, tone: ''|'warn', notes: string[]}, view: 'player'|'library',
//   composition: 'full'|'handheld'|'glance' }

// timeline.js
export const ZOOMS = [5000, 10000, 20000, 60000], HEAT_BINS = 200, TRACE_MS = 8000, MIN_SPAN = 0.05;
export const CSS, COPY;
export function curvePoints(script, fromMs, toMs, W, H, T);   // -> 'x,y ...'
export function seekAt(x, W, durationMs);                     // -> ms
export function heatLevels(bins, T, ceiling), traceLines(trace, fromMs, toMs, W, H),
  clampRange(T, key, v), zoomStep(ms, dir);                   // pure, node-tested
export function mountTimeline(el, { onSeek, onScrub, onRange, zoomMs = 10000, onZoom });
  // zoomMs: the starting window; onZoom(ms) on each zoom step (persisted as prefs zoomMs).
  // timeline.js may import only funscript.js, so its tf() restates applyT; the two must agree.
  // onSeek(ms); onScrub('start'|'move'|'end', ms); onRange(partialT, commit: boolean)
  // -> { setScript(script, T, ceiling, raw?), frame(mediaMs, trace), unmount() }
  // script: the shaped Script (intent curve, heat); raw: the parsed one, drawn muted when it differs
  // ceiling: {vmax: number | null, spanMm: number | null}
  // trace: Array<{m: media ms, u: 0..1 | null, stale: boolean}>, telemetry.position on the media axis, last 8 s
```

One `Player` per activation owns the single `<video>` (no `controls`,
`playsinline`, `disablePictureInPicture`, never fullscreen), the
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
`'1'`.

---

## interp: `interp.js`

```js
export const STEP_MS = 40;            // the longest piece a curved span is cut into (25 segments/s, under the 50 Hz grant)
export const MODES;                   // frozen {id -> its parameter key | null}: linear, step, smoothstep, cosine,
                                      // catmull 'tension', hermite 'bias', monotone, pchip, akima, makima
export const RANGES;                  // frozen {tension 0..1, bias -1..1, smoothMs 0..500, slewMmS 0..2000} with steps
export const INTERP;                  // frozen default {mode: 'linear', tension: 0, bias: 0, smoothMs: 0, slewMmS: 0}
export function cleanInterp(v);       // -> a well-formed interp; prefs.js repairs the key 'interp' with it
export function sample(script, interp, tMs);   // -> 0..1, the mode alone; linear is posAt exactly
export function shape(script, interp, ctx);    // ctx {spanMm, lo, hi} -> Script: every action kept, pieces <= STEP_MS,
  // collinear pieces merged (<= MAX_SPAN_MS), then smoothing (centered box) and slew (mm/s over spanMm x (hi - lo),
  // off without spanMm); linear with both off returns `script` itself, so the scheduler runs byte-identical
export const COPY, CSS;
export function mountInterp(el, { value, onChange });   // -> unmount(); the settings card rows, onChange(interp) on commit
```

The controller schedules `shape(script)` and keeps it as `PlayerState.shaped`: the scheduler, posAt, preroll,
stop, thinning, the speed meter and the heat all read the shaped Script,
and each piece is one segment with end velocity `unspecified` and no
`curve_family`. Tests: `test/funscript-core.test.mjs` (interp section).

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
//                         vmax: 'limit.input.speed', patRun: 'pattern.running', advRun: 'advgen.running' } },
//     mount: (el, fields) => player.mount(el, fields) });
//   api.registerSettings((el) => mountConnect(el, { api }));
//   return () => player.dispose();

// prefs.js
export const PREFS;                    // frozen defaults: the Prefs shape above
export function readPrefs(api);        // -> Prefs, each key merged over its default, malformed values replaced
export function writePref(api, key, value);
```

`manifest.json`: kind `widget`, permissions `["motion", "net.fetch"]`, no
`intent` (the player writes no field). It is listed in
`src/plugins/factory.js` because the host accepts `net.fetch` (ruling R-A,
pending: a veto reverts the host's `net.fetch` and the FACTORY entry
together, since test (g) validates every factory manifest).
`test/funscript-player.test.mjs`: `--unit` (in `npm run check`) checks every
export named here, the prefs and the hero spec; the default run is the
fake-hub browser test (`npm run check:funscript`, in `test:browser`); `--live
--port P --http P+7` runs the card against valencesim on spare ports.
