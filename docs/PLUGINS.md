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
`activate`:

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
optional `replaces: '<built-in hero id>'` (the id a built-in registers with in
`src/ui/heroes.js`'s `HEROES` array, e.g. `'rail'`). When such a plugin is
enabled and its own claim succeeds, `claimAll` skips the named built-in
entirely for that pass (DESIGN §3: a tier-2 widget "renders instead", by the
operator's explicit choice to enable the plugin). When the plugin's claim
fails, or the plugin is disabled, the built-in claims normally — a `replaces`
plugin can only ever add a substitution, never leave a field unclaimed. An
unrecognized id is simply never matched: no built-in of that name to suppress,
same "opportunity, never requirement" degrade as an unknown role.

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
| `manifest`, `apiVersion`, `log(msg, level)` | identity and the log pane | **freeze candidate** |
| `registerHero`'s `cells: {h: [w, h], v: [w, h]}` | minimum footprint in builder grid cells per orientation (DESIGN §10.2, `ph-e82.4`) | experimental |
| `registerHero` returning `withdraw()` | removes that hero (a device that went away); a saved placement of it stays inert | experimental |
| `registerHero`'s `replaces: '<built-in hero id>'` | tier-2 "renders instead" of the named built-in when this plugin's own claim succeeds (`ph-vdk.29`) | experimental |
| `submitMotion(norm, durationMs)` returning `{ok, reason}` | motion input, 0..1 across the stroke window. Needs `motion` | experimental |
| `net.listenTcp(port, onLine)` returning `close()` | loopback TCP line service, shell only. Needs `net.listen:<port>` | experimental |
| `registerSettings(mount)` | a card on the plugin's row in the Plugins pane | experimental |
| `registerTheme({id, name, reality, intent})` | an accent pair, kind `theme` only | experimental |
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
found by the RFC-071 draft role `input.target` or else by unit `normalized`,
and `durationMs` becomes the sample's timestamp lead (SPEC §5.4: a sample
describes an instant, so "reach X over I ms" is the point at now + I, capped
at `max_future_schedule_ms`). A hub with no such stream, or one that grants
nothing, gets the `command.position` setpoint instead, coalesced at the move
channel's rate, with `durationMs` dropped. The live path and every stream
refusal (with its `PublishError` code) land in the log pane under `motion`.
Timed segments (`{target, duration, end_velocity}`, SPEC §9.6) are the closer
fit and wait on RFC-058 ruling what an absent end velocity encodes.

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
| `roles`, `channels` | what it binds, displayed in the pane. Informational: the claim spec is what binds |
| `permissions` | `intent`, `motion`, `net.listen:<port>`; anything else makes the manifest invalid |

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
be an unauthenticated control path, `ph-vdk.28`).

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
Restart the app to pick up a new or changed plugin. The Plugins tab is a Console tab, so
like the rest of the nav it appears once a hub's catalog is adopted.

**CSP.** `tauri.conf.json` `security.csp` is the home. Its `script-src`
carries `blob:` for this loader; drop it and every plugin shows an `import:`
error on its row. A plugin runs under the page's policy, so `connect-src`
(`ws:` plus Tauri IPC) refuses its `fetch` to any http origin; loopback TCP
is `net.listenTcp`. Plugin files come through the `plugins_list` command, so
no asset-protocol scope is involved.

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

## Testing

`node test/plugins.test.mjs` (part of `npm run check`) loads both examples
through the real host and claim loop against the fixture catalog: hero
claims, containment of throwing plugins, the no-transport API, permission
refusals, the TCode parser, and the window mapping.

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
