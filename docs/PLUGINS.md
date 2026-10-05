# Phosphor plugins (tier 2)

The home for the plugin contract: module shape, manifest schema, loader,
permission model, what is frozen, and how a plugin becomes standard. The
rulings behind it (Prime Rule, the three tiers, the widget contract, the
framework-neutral ABI) live in [DESIGN.md](DESIGN.md) §2, §3, §4 and §9 and
are not restated here. Status (what is verified, what is open) lives on the
dev board, epic `ph-vdk`.

## The one rule

A plugin adds features **through Valence, never around it**. It reads the
model (catalog, reported values, write status) and writes through the shadow
entry points, the same doors every built-in control uses, so a plugin write
gets the same pending, echo, fault lifecycle and the same refusal banner. The
API object has no session, socket or transport handle, and
`test/plugins.test.mjs` fails if one appears. A plugin that needs something
the protocol lacks is an RFC in Valence, not a workaround.

## Module shape

One self-contained ES module (the shell imports it from a `blob:` URL, so
relative imports cannot resolve; bundle your dependencies in). It exports
`activate`. A factory plugin may split into sibling modules its entry
imports relatively, because Vite bundles them into the app; a same-named
override in the plugins folder must still be one bundled file (ruling R-C,
pending, docs/plugins/FUNSCRIPT.md):

```js
export function activate(api) {
  api.registerHero({
    id: 'gauge',
    title: 'Stroke gauge',
    spec: { require: { pos: 'telemetry.position' },
            optional: { lo: 'window.min', hi: 'window.max' } },
    mount(el, fields) {          // el: a bare <div>; fields: the claimed fields
      // draw into el with anything, or nothing: no framework is assumed
      return {
        update() { /* a claimed field's value or write status changed */ },
        unmount() { /* release what mount made */ },
      };
    },
  });
  return () => { /* optional deactivate */ };
}
```

A hero plugs into the **same claim pass** as the built-in heroes
(`src/model/roles.js` `claimAll`, called from `src/ui/heroes.js`): built-ins
first, then active plugins. `require` must all resolve or the hero declines
and its fields stay generic; claimed fields leave the generic tree unless the
hero sets `absorb: false` (a read-only view that must not take a control
away; the stroke-gauge example does). Plugin
heroes are **card zone only**: they render as home modules and as cards on
their category page, which DashGrid lays out, reorders and persists under the
stable id
`hero:plugin:<name>:<hero id>`. Pinned instrument chrome stays first-party.

**Placement (builder, DESIGN §10.2).** A claimed plugin hero is a placeable
control like any built-in one: `src/model/settings.js` `placeableControls`
lists it under the same `hero:plugin:<name>:<hero id>` key, and a saved layout
finds it again by that key (an absent plugin's key stays inert). It places,
resizes and persists the way a composite does. `registerHero` accepts an
optional `cells: {h: [w, h], v: [w, h]}`, the minimum footprint in grid cells
for a horizontal (w >= h) and a vertical placement; absent, the composite
default applies, and a malformed value fails registration. `el` sits inside the
placed cell, so a hero that cares about its orientation reads its own
box. A hero that throws leaves the palette with its claims, exactly as above.

**Replace mode (experimental, `ph-vdk.29`).** `registerHero` accepts an
optional `replaces: '<built-in hero id>'`, or a list of them, each
suppressed when the claim succeeds (the id a built-in registers with in
`src/ui/heroes.js`'s `HEROES` array, e.g. `'rail'`). When such a plugin is
enabled and its own claim succeeds, `claimAll` skips the named built-in
entirely for that pass (DESIGN §3: a tier-2 widget "renders instead", by the
operator's explicit choice to enable the plugin). When the plugin's claim
fails, or the plugin is disabled, the built-in claims normally — a `replaces`
plugin can only ever add a substitution, never leave a field unclaimed. An
unrecognized id is simply never matched: no built-in of that name to suppress,
same "opportunity, never requirement" degrade as an unknown role.

**Substituting a §10 pattern (RENDERING §10.2, RFC-068).** A plugin that
replaces a built-in pattern puts every one of the pattern's essential
bindings in its own `require`, so the host can never mount it with less
(item 1). It draws only into the `el` it is given (item 2), writes only
through `api.write`, which renders the host's confirm (item 4), and a
binding its spec cannot express (a conditional essential) is checked in
`mount`, which throws: the hero is dropped and the built-in, or the
settings cards, render instead (item 5).

**Pages.** `api.registerPage({id, label, icon, spec, mount})` gives a plugin a
tab of its own: listed indented under Plugins in the sidebar's Phosphor
section, selectable like any tab, found by F3 as `<label> · Phosphor ›
Plugins`, its page region the plugin's to fill full width. `mount(el,
fields)` is a hero's mount, returning `{update, unmount}`, and PluginSlot
drives it the same way, so a plugin that already has a hero passes that
hero's mount and the card and the page are two views of one instance. `spec`
is optional and resolves like a hero's but **claims nothing**: a page never
takes a field from a card or the generic tree. A spec the hub cannot meet
leaves the tab in place with the note `Not on this hub`. `id` follows the
name rule, `label` is one Blender-terse word or two (at most 24 characters;
docs/COPY.md), `icon` is one SVG path `d` on a 16-unit viewBox drawn open
at 1.5 stroke (src/ui/navIcons.js's style; absent, the Plugins glyph).
Registering returns `withdraw()`; a page whose mount throws is dropped like a
hero. The Plugins pane gives each plugin with a page a **Show tab** switch,
persisted per plugin as `phosphor.plugins.pages.<name>` (`'1'` or `'0'`,
in the prefs backup); absent, a factory plugin's pages show and an installed
plugin's do not. The sidebar follows the switch at once. Host side:
`src/plugins/host.js` `pages`, `pageShown`, `setPageShown`. Every page gets
the shell's Fullscreen in its footer (DESIGN §10.3); the plugin draws
nothing for it, and a mount that fills its element's height fills the window.
A page registered with `mediaFullscreen: true` offers fullscreen itself and
gets no footer button (F11 still works); its mode control dispatches
`phosphor-page-fullscreen-mode` (`detail: {mode: 'window' | 'borderless'}`)
and the shell stores pref `fullscreen`. The desktop shell keeps
`<html data-fullscreen-mode>` at the current mode; absent, there is no
Borderless. A page registered with `fill: true` (experimental, `ph-yuce`)
is laid out as a column filling the desktop content pane's width and
height (`main.pane.fill`, the page fullscreen geometry in place): a mount
whose root is `height: 100%` gets a definite height and no bottom gap.
Other pages keep their flow; the phone layout scrolls the window and is
not filled.
A page may also ask for it (experimental): a `phosphor-page-fullscreen`
event dispatched from inside the page (bubbles, cancelable, `detail: {on}`).
The shell takes it only for the page on screen, and `preventDefault()` is
its yes; `on` enters bare (bar and strip hidden, the stop pair floating),
false leaves. Every change is announced on `window` as
`phosphor-page-fullscreen-change` (`detail: {on}`), so a view a page draws
for it (the funscript player's media fullscreen) ends with the shell's
(Escape, the caret, F11, a page switch). Seam: `src/App.svelte`.

## The API (v1)

| member | what | status |
|---|---|---|
| `activate(api)` returning optional `deactivate()` | module entry | **freeze candidate** |
| `registerHero({id, title, spec, absorb, mount})`, `mount(el, fields)` returning `{update, unmount}` | the widget seam | **freeze candidate** |
| `field(role)` | first field carrying a registry role, or null | **freeze candidate** |
| `value(field)` | the value a control must show (reported, or the in-flight request while pending) | **freeze candidate** |
| `status(field)` | `confirmed` / `pending` / `overdue` / `fault` | **freeze candidate** |
| `age(field)` | ms since the field's channel last reported (dim when stale, RENDERING §13 law 8) | **freeze candidate** |
| `catalog()` | the whole settings model (categories, `byRole`, `fields`, `actions`) for channel-bound plugins | **freeze candidate** |
| `write(field, value)` | routes to `writeSetting` / `sendCommand` / `runAction` by field shape. Needs `intent` | **freeze candidate** |
| `write`'s third argument `payload` and its confirm | an action's other schema keys, `{key: value}`. The host renders the confirm first (`source.background_run` enable, a confirm-tagged or destructive op, an `action.store` delete) and a cancel resolves `{ok: false, error: 'canceled'}` | experimental |
| `writeTrial(field, value)` | a setting applied live and not stored until `commitTrial()` (Valence RFC-099, SPEC §9.3); same shadow lifecycle as `write`. `{ok: false, error}` on a hub without settings-trial or a field that is not a setting. Needs `intent` | experimental |
| `commitTrial()` / `revertTrial()` | a Promise of `{ok, error?}`: store, or put back, every trial value this client holds. Needs `intent` | experimental |
| `trialPending` | read-only property: true while any client holds a trial value on this hub, from the machine's `meta.trial_pending` fields | experimental |
| `gate(field)` | `''` or why the field cannot be written now, in words (law 3: no link, not authorized, refused by the machine's mask, read-only). On a motion-input field (a c2h STREAM's, e.g. `input.duration`), in order: `no hub link`, `session not authorized`, the latch words, `stop the pattern first` (a generator runs), `motion input in use by <plugin>`. A foreign-held control-owner slot never gates; a stream holding the rail is the hub's `SOURCE_CONFLICT`, which `submitSegments` returns as `refused: rail owned by <source>` | experimental |
| `stale(field)` | `''` or the stale reason in words, by the host's one freshness rule (law 8). `age` is raw and grows on an on-change channel that is simply quiet | experimental |
| `reason(field)` | `''` or the last refusal of the field's write, as the host's ladder words it (`refused: SOURCE_CONFLICT`) | experimental |
| `modTarget(field)` | uid of the field the field's modulator entry rides (RFC-066 `mod_target`), or null | experimental |
| `storeSlots(field)` | for an `action.store` writer: a Promise of every slot of the store its `store_id` names (RFC-070), `{slot, state, name}` with `state` one of `pending`, `item`, `empty`, `locked`, `error` (RENDERING §8.4 row 9); null when unlinked | experimental |
| `manifest`, `apiVersion`, `log(msg, level)` | identity and the log pane | **freeze candidate** |
| `registerHero`'s `cells: {h: [w, h], v: [w, h]}` | minimum footprint in builder grid cells per orientation (DESIGN §10.2, `ph-e82.4`) | experimental |
| `registerHero` returning `withdraw()` | removes that hero (a device that went away); a saved placement of it stays inert | experimental |
| `registerHero`'s `replaces: '<built-in hero id>'` | tier-2 "renders instead" of the named built-in when this plugin's own claim succeeds (`ph-vdk.29`) | experimental |
| `submitMotion(norm, durationMs)` returning `{ok, reason}` | motion input, 0..1 across the stroke window. Needs `motion` | experimental |
| `submitSegments(list)` returning `{ok, sent, rateHz, reason}` | lookahead motion input: `[{atMs, norm, durationMs, endVel?}]`, `atMs` the `performance.now()` instant the machine starts each, ascending, `endVel` its end velocity in norm/s (absent: `unspecified`, rest without a scheduled successor); advance by `sent`. Needs `motion` (`ph-smvd.2`) | experimental |
| `net.listenTcp(port, onLine)` returning `close()` | loopback TCP line service, shell only. Needs `net.listen:<port>` | experimental |
| `net.fetch(url, init)` returning a `Promise<Response>` | HTTP(S) to a non-machine service (a media library), CORS-free through the shell's HTTP plugin; vite dev uses the page's `fetch`. Refuses other schemes and the connected hub's own origins (its host on 80, 443 or its WS port). Needs `net.fetch` (ruling R-A, `ph-smvd.2`) | experimental |
| `registerSettings(mount)` | a card on the plugin's row in the Plugins pane | experimental |
| `registerPage({id, label, icon, spec, mount, mediaFullscreen, fill})` returning `withdraw()` | a tab under Plugins in the sidebar; `mount(el, fields)` as a hero's, `spec` resolved without claiming (Pages, above) | experimental |
| `registerTheme(theme)` | a preset, kind `theme` only: the full object `{id, name, accents, chassis, look, overrides}` (docs/THEMES.md) or the old `{id, name, reality, intent}` pair. The id is namespaced; safety tokens are dropped (RENDERING law 13) | experimental |
| `prefs.get(k)` / `prefs.set(k, v)` | per-plugin JSON in localStorage (browser state, never machine state) | experimental |

**Freeze.** Operator ruling (DESIGN §4): the widget API freezes the moment the
first external plugin exists, the way Valence's public headers are frozen:
additive only, `apiVersion` stays 1, nothing removed or changed in meaning.
The **freeze candidate** rows are what freezes at that trigger; the
experimental rows may still change until they are promoted by a later
ruling. Tracked as `ph-vdk.30`.

**Motion input.** `submitMotion` publishes on the hub's samples-kind c2h
STREAM when the catalog has one: the grant is asked for on the first call
(that call returns `{ok: false}` while it is in flight), the target field is
found by the registered role `input.target` only (RFC-071; every field it has
no value for rides its `unspecified` sentinel, RFC-058),
and `durationMs` becomes the sample's timestamp lead (SPEC §5.4: a sample
describes an instant, so "reach X over I ms" is the point at now + I, capped
at `max_future_schedule_ms`). A hub with no such stream, or one that grants
nothing, gets the `command.position` setpoint instead, coalesced at the move
channel's rate, with `durationMs` dropped. The live path and every stream
refusal (with its `PublishError` code) land in the log pane under `motion`.
A call with `durationMs` > 0 prefers the hub's segments-kind STREAM (SPEC §9.6,
RFC-087): one segment `{input.target, input.duration}` with the end velocity
`unspecified`, started at hub now plus the grant's `schedule_latency_us`
(RFC-059; no lead constant in Phosphor) and held inside the grant's schedule
horizon. Each new bundle supersedes the not-yet-started tail, so a newer line
or a seek needs no flush.

`submitSegments(list)` is the lookahead door (RFC-087), segments STREAM only,
never a fallback. The host owns every timing fact: it reads hub now (from
the kept CLOCK exchange with the least RTT/2 plus age x 50 ppm, SPEC §7.1) and
`performance.now()` together, converts each execution start to hub time and
stamps it `schedule_latency_us` earlier (RFC-059: execution = stamp +
latency). A start already past the earliest executable instant is clipped
there, keeping its end; anything left under 10 ms is consumed, not sent.
Offsets round to 100 us. One bundle carries what starts within HALF the
granted horizon (RFC-014's SHOULD, kept by RFC-087), at most 32 records and
one transport payload, end velocity `unspecified`. `sent` counts the leading
items done with through the last one packed; offer each once and advance by
it, and a later bundle supersedes from its first start. An empty list warms
the grant and takes nothing.

**One producer.** An ok `submitSegments` with `sent > 0` holds the motion
input for its plugin until the latest sent end plus `MOTION_HOLD_MS` (500);
an ok `submitMotion` until now plus its duration plus 500. Another plugin's
`submitMotion` or `submitSegments` meanwhile returns `{ok: false, sent: 0,
reason: 'motion input in use by <plugin>'}` without reaching the door, and its
`gate` on a motion-input field says the same.

**Trial writes.** The hub keeps each trial key's stored value and owns the
undo: `revertTrial()`, a closed tab and a lost link all put it back, and
nothing reaches the machine's flash until `commitTrial()`. A key one client
has on trial refuses every other client's write, trial or not, with
`TRIAL_CONFLICT` (it lands in `reason(field)`). The flip, the schedule horizon
and the chase interval are refused as trials on the reference hub: each is
gated on live state, so its revert could be refused too.

## Manifest (`manifest.json`, beside the module)

```json
{
  "name": "tcode-adapter",
  "version": "0.1.0",
  "api": 1,
  "kind": "adapter",
  "entry": "index.js",
  "description": "one line",
  "roles": ["command.position"],
  "channels": [],
  "permissions": ["motion", "net.listen:8000"]
}
```

| key | rule |
|---|---|
| `name` | `[a-z0-9][a-z0-9-]{0,39}`, unique; the enable list and `prefs` key on it |
| `version` | any non-empty string |
| `api` | must equal the host's `API_VERSION` (1) |
| `kind` | `widget`, `adapter` or `theme` |
| `entry` | a plain `.js`/`.mjs` file name in the plugin folder (default `index.js`); a path is refused |
| `description` | shown in the Plugins pane; one fragment per `docs/COPY.md` |
| `credits` | optional array of `{name, url, license}`, each a string of at most 120 characters, `url` http(s) only; shown on the Plugins row and in About's Notices, where the link is copied (the shell has no opener) |
| `roles`, `channels` | what it binds, displayed in the pane. Informational: the claim spec is what binds |
| `permissions` | `intent`, `motion`, `net.fetch`, `net.listen:<port>`; anything else makes the manifest invalid |

Validation lives in one place, `src/plugins/host.js` `validateManifest`. An
invalid manifest is listed with its problems and its code is never run.

## Permissions: honesty, not a sandbox

A plugin runs in the page with the page's full authority. The manifest
declares what it means to do, the Plugins pane shows it before and after
enabling, and the API refuses a gated call the manifest did not declare
(`PermissionError`). That stops honest mistakes and makes the surface
reviewable. It does **not** stop hostile code: nothing prevents a module from
opening its own WebSocket. Install plugins you would install as any program.

Reading needs no permission. `intent` covers every settings/action/command
write, `motion` covers motion input, and `net.listen:<port>` opens a TCP
listener on **127.0.0.1 only** (`src-tauri/src/plugins.rs`; a LAN bind would
be an unauthenticated control path, `ph-vdk.28`). `net.fetch` reaches HTTP(S)
services that are not the machine; the hub's own origins are refused, so it
never becomes a side channel around Valence (DESIGN §2).

Every call into plugin code (activate, deactivate, mount, update, unmount,
settings, TCP line callbacks) is wrapped: a throw is recorded on the plugin,
shown on its row in the Plugins pane, and logged to the Log pane tagged
`plugin:<name>`. A hero that throws is dropped and its fields return to the
generic renderer; a plugin whose `activate` throws has everything it
registered rolled back. Nothing a plugin throws reaches the kernel.

## Loading

**Shell (Tauri).** One folder per plugin under the app data directory:
`<app_data_dir>/plugins/<folder>/manifest.json` plus its entry module (the
Plugins pane prints the real path). On start the Rust command `plugins_list`
reads each folder (manifest up to 64 KiB, module up to 2 MiB); JS imports the
module text from a `blob:` URL. Enable state is a localStorage list
(`phosphor.plugins.disabled`); plugins are enabled by default once installed.
Restart the app to pick up a new or changed plugin. The Plugins tab sits in the sidebar's Phosphor
section (DESIGN §10.11) and appears once a hub's catalog is adopted.

**CSP.** `tauri.conf.json` `security.csp` is the home. Its `script-src`
carries `blob:` for this loader; drop it and every plugin shows an `import:`
error on its row. It also carries `'wasm-unsafe-eval'` (WebAssembly compile only, not `eval`): the funscript player compiles the machine's planner in a worker, and without it the analyzer reads `Kinetic: fallback` (docs/plugins/FUNSCRIPT.md, Kinetic). A plugin runs under the page's policy, so `connect-src`
(`ws:` plus Tauri IPC) refuses its `fetch` to any http origin; HTTP goes
through `net.fetch` (the `http:default` capability allows `http://**:*` and
`https://**:*`; the `:*` is load-bearing, a URLPattern without a port
matches only the scheme's default port, so `http://**` refused Stash on
30198) and loopback TCP through `net.listenTcp`. `img-src` and
`media-src` take `blob:`, `http:` and `https:`, so a plugin plays a local file
from an object URL or media from a library by URL (ruling R-B); `media-src`
otherwise falls back to `default-src 'self'` and nothing plays. Plugin files
come through the `plugins_list` command, so no asset-protocol scope is
involved.

**The hub-served page never loads plugins.** A hub serves one file and
nothing else. For development only, a `vite dev` build accepts
`?plugin=<url of the entry module>` (repeatable) and fetches `manifest.json`
beside it, e.g.
`http://localhost:5173/?hub=<hub>&plugin=/plugins/examples/stroke-gauge/index.js`.
Production builds compile that path out.

## The examples

- `plugins/examples/stroke-gauge/`: a read-only widget. Claims
  `telemetry.position` (window roles optional) and draws an SVG gauge, dimmed
  when stale. Proves the hero seam works from outside the bundle, no
  framework.
- `plugins/examples/tcode-adapter/`: RFC-044 rung 1 as an adapter. The shell
  listens on 127.0.0.1:8000 (MultiFunPlayer's default endpoint port; the
  spec pins none, drafted as Valence RFC-061), each line is parsed for `L0`
  (`L0500I100` = 0.5 over 100 ms; other axes, `S` and device commands are
  ignored) and submitted with `submitMotion`, the `I` interval as its
  duration. The hub never sees TCode.

## Factory plugins

A factory plugin ships with Phosphor. It lives in `plugins/factory/<name>/`
(manifest plus its modules, the same shape as any plugin) and is listed in
`src/plugins/factory.js`, which bundles it. How it differs from an example:

- **Enabled by default in the shell.** It loads before the plugins directory
  is read, with no install step. The hub-served page still loads none.
- **Removable.** Disabling it in the Plugins pane persists on the same
  `phosphor.plugins.disabled` list as any plugin. A folder of the same
  `name` in the plugins directory loads after it and replaces it.
- **Same contract.** Same manifest rules, API, permission checks and error
  boundary; no kernel imports, so the module still loads unchanged from a
  `blob:` URL. It ships to every hub the shell meets, so it binds by role
  only, as a tier-1 widget must.

An example is documentation: never loaded by default, installed by copying
its folder.

Shipped:

- `plugins/factory/advanced-penetration/`: the pattern card. It substitutes
  both RENDERING §10 `generator-advanced` and `pattern-panel` (`replaces:
  ['advanced-generator', 'pattern']`) as a direct-manipulation editor after
  fray-d's OSSM-Lite. Advanced and Classic are two SPEC §11.4 sources in two
  tabs, each with its own Start (RFC-093 `advgen.running`,
  `pattern.running`); a tab switch writes nothing. Advanced: master speed, a
  presets dropdown over the store (RFC-067, RFC-070; F2 or a double-click
  renames the chosen slot through the store's rename op, Enter or blur keeps
  the name, Escape cancels), the stroke editor (deep and shallow on the
  window, in and out speed as the width of each half, accel as a bezier
  diamond at each foot), a rhythm staircase per modulator (amp fader, step
  handles in whole strokes, offset marker), a planned-motion strip, and a
  numeric twin for every handle. A handle and its twin read one effective
  value (the card's draft while edited, else `api.value`): a drag, nudge or
  keystroke redraws at once in the intent look, and release, Enter or blur
  writes once through `api.write`; arrows nudge, Shift is the declared step,
  Ctrl the adjacent decade multiple. The stroke picture's x axis is the
  share of one stroke's time, so the curve always spans the plot, mid-drag
  included. A handle's shape is its drag axis: a dot moves any direction, a
  vertical pill left-right only, a horizontal pill up-down only. A label
  reads name then value (`deep 85`, `shallow 10`, `in 70`, `out 45`, `in
  accel 30`, `out accel 60`, `dwell 0.5`, `amp 40`, `offset 0`). It sits
  beside its handle on the side square to the curve's tangent, clear of
  every drawn line (the stroke, the 0 and 100 guides, the modifier graph's
  top guide, amp axis and offset track), of the handles and of a plus's dot;
  it tries one and two label heights further out before giving up, the most
  hemmed-in label places first, a three-word label with no clear side drops
  its side word (`accel 100`, the half shows the side), and only then does a
  label wear a backing. The numeric rows hide behind an Inputs toggle right
  of the preset box (default hidden, `phosphor.advpen.inputs`); hidden, they
  are not rendered and the handles carry the arrow keys.

  **The ladder, the house way.** The master and Classic sliders are host
  fields: `.field` with `data-shadow` (style.css GROUND TRUTH, the ring
  and line of docs/EFFECTS.md, the afterglow on each echo) and the host's
  value chip, value then unit (format.js `formatParts`). Start, the preset
  select and Run in background's track carry `data-shadow`, the inset ring
  of a surface without one. A handle shows its state by color only; the
  words ride the plot's one-line note (`deep 51 · waiting`, amber for
  `still waiting` and `refused`), never the label, so no state change
  moves a label or a box. Focus, the open tab and a pressed tool wear
  `--highlight` (a handle's focus ring is the house 2 px outline, its
  hover 1 px); tabs hover with the house edge (`--line-4`). Controls are
  sentence case, the section head is the shell's uppercase head, field
  labels the shell's lowercase.

  **The in/out link** (chain toggle beside it, off by default,
  `phosphor.advpen.speedLink`). Linked, an edit holds `1/in + 1/out`, the
  stroke period at a fixed master, so dragging one half moves the peak and
  the other half follows; a handle stops where its partner would leave
  1..100, and both keys go out in the same tick, one intent. Switching it on
  rescales once so the halves have room: `master' = master x k`,
  `in' = in / k`, `out' = out / k`, `k = min(2, 100 / master)`, the three keys
  in one intent (halves rounded to the pair with the least period error).
  At master 100 or 0 nothing is written and the tooltip says what to do.
  Switching it off writes nothing. The rescale keeps the physical stroke:
  the hub's speed is master % x half % x the input ceiling, linear in both.

  **Modifier tabs.** Each tab carries an enable switch on the left (the
  host's `og-switch`, compact; off writes `mod.amount` 0, RFC-066's no
  modulation, and keeps the amount in the card to restore; on with none
  kept writes 100) and a trash on the right, shown once any of the six
  values leaves its catalog default, which writes all six defaults in one
  intent. A tab name wraps to a second line before it truncates. At min and
  at max (`mod.hold`, `mod.rest`) are reached on the graph: at 0, a gray
  guide and a plus sit at the corner where the hold would start, the plus
  off the corner so it never covers the corner's handle; the plus spawns
  it at one stroke with a vertical pill on the guide, and dragging the pill
  back to 0 collapses it. A segment caption wider than its segment shows
  its number only, else nothing, and one a label cannot avoid yields the
  same way. The amp axis sits at least half a handle in from the plot's
  edge and the staircase half a handle and a gap past it, so the amp
  handle stays inside at any width; the offset label sits under the
  track. The dwells'
  modulators get tabs like the other six. The registry names no role for a
  store op's slot and name, so it tells them apart by schema type.

  **Narrow** (the card under 480 px, a phone or a two-cell placement): the
  hint and the depth ticks drop and the modifier tabs pair up.

  **Planned motion** (`planMotion`, pure): under the stroke editor and
  above the rhythm section, the current parameters to scale over a fixed
  window (default 10 s, 2 to 60, a stepper right of the strip: up, number,
  down; steps 1, 5 or 10; kept in `api.prefs`) on a 1 s grid with thinned
  labels in a band under the plot and no caption. It runs the way the
  firmware does (`AdvancedGenerator`): half-strokes from the in half, each
  from where the last landed, v = master x half x `limit.input.speed`
  (floor 1 mm/s), a = v^2/d x (1 + 9 knob), d from `window.min`/`window.max`;
  a dwell holds dwell x (this half + the one before, the run's first
  counting twice); a half under 0.25 mm is a 50 ms rest that owes no dwell.
  Every modulator applies per stroke through `BaseControl::modifiedValue`:
  value - (value - ref) x amount x `dropAt`, ref the control's minimum, and
  for the depth pair the other depth (max pulls toward min, min toward max),
  so a depth swing is amount of (max - min). The cycle index is
  (stroke / 2 + offset) mod steps. Without the ceiling or the window fields
  the strip is not shown. Editors, handle
  plates and numeric twins sit on the sunk `--screen` plate.

  **Dwells** (RFC-095, optional `advgen.dwell_crest` and
  `advgen.dwell_trough`; absent, nothing is drawn and nothing declines). The
  stroke reads trough flat, in half, crest flat, out half, left to right. A
  dwell's clock is one stroke, the two moving halves, so a flat is drawn to
  scale beside them until it would pass `DWELL_CAP` (25 %) of the plot; past
  it the flat is drawn at the cap with its middle 40 % as dots fading out
  and back in. At 0, a thin guide and a plus sit at the bound (the trough
  start, the deep turn), centered where the pill will ride, off the curve
  and the diamonds; the plus writes `DWELL_SPAWN` (0.01 strokes) and a
  vertical pill rides the guide at the flat's end, off the curve, in the
  plus's place. Dragging the pill right lengthens the dwell: under the cap
  the pill follows the pointer, past it the flat holds the cap and the value
  keeps growing toward the plot's right edge, where it asks for the field's
  own max (the UI sets none). Dragging back to the bound collapses it to 0
  and the plus returns. The numeric twins carry both dwells behind the
  Inputs toggle, and preset Reset returns them to their defaults. The
  playhead follows the told target's half and holds while the position sits
  at a bound, so through a hold it parks on that bound. A handle drag is
  relative to the grab at gain 0.5 (Shift 0.05, Ctrl rounds to the decade)
  through the same geometry, so it never jumps on pickup.
- `plugins/factory/funscript-player/`: plays a local or Stash video and
  drives the rail from its main (L0) funscript. One hero, `player`
  (`absorb: false`), requires `input.target` and `input.duration`, so it
  renders only where the hub has a segments STREAM (D1); the window, the
  position, `limit.input.speed`, both generator run roles and the plan
  strip's elapsed and duration (automatic latency) are optional.
  Motion leaves only through `submitSegments`, one segment per funscript
  span on the media clock, and every stop of its own sends one hold; a
  gate or a hub refusal pauses it with no hold. The card's Play is the
  only start, and a latch, a running generator or another producer grays
  it with the gate's words. Stash rides `net.fetch`, its connect card
  in the Plugins pane and in the library's place. The detail's expand
  button opens the analyzer in the card's own box: the hub's Tuning
  controls (and `limit.input.*`), written Live through `api.write` or as a
  Preview through `api.writeTrial` with Apply and Discard, so the manifest
  declares `intent`. Its settings card holds the Stash connect card, the
  motion curve and the playback rows (loop, auto-home, seek glide, low and
  automatic latency); the detail's A-B button loops a section. Operator values persist
  through `api.prefs`; all but the Stash key are mirrored under
  `phosphor.funscript.*` for the prefs backup. Its page, `Funscript` under
  Plugins (`page.js`), mounts the same card full width. Design and decisions:
  [docs/plugins/FUNSCRIPT.md](plugins/FUNSCRIPT.md); module signatures:
  `plugins/factory/funscript-player/CONTRACT.md`.

## Testing

`node test/plugins.test.mjs` (part of `npm run check`) loads both examples
through the real host and claim loop against the fixture catalog: hero
claims, containment of throwing plugins, the no-transport API, permission
refusals, the TCode parser, and the window mapping. It also loads every
factory plugin and checks Advanced Penetration's substitution and each way
it falls back. `node test/advanced-penetration.test.mjs` drives it in the
shell bundle against a fake hub (`--live` against valencesim).
`node test/funscript-player.test.mjs --unit` (in `npm run check`) checks the
player's contract exports, prefs and hero spec; without `--unit`
(`npm run check:funscript`, needs ffmpeg) it plays a generated clip in the
shell bundle against a fake hub and the fake Stash, and `--live --port P
--http P+7` against valencesim on spare ports; `--live-playback` there plays
loop, auto-home, the seek glide, both latency settings and a Preview write.

`plugins/` sits outside `src/`, so `test/check-device-knowledge.mjs` never
scans it: a plugin may know one machine's channel ids and field names. The
host under `src/plugins/` is scanned like the rest of the kernel.

## Promotion to tier 1

A plugin that proves itself becomes standard by PR (DESIGN §3):

1. Rebind it to registry roles only. Any channel id or device field name has
   to go; `check-device-knowledge.mjs` will fail the build otherwise, which
   is the point.
2. If it needed a role the registry lacks, that is a Valence RFC first.
3. Port the widget into `src/ui/hero/` and register it in `src/ui/heroes.js`
   beside the built-ins, with a zone and its `cells`.
4. It now ships to every hub, served page included, so it meets the
   RENDERING.md §13 conformance laws there.
