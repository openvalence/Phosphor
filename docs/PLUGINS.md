# Phosphor plugins (tier 2)

The home for the plugin contract: module shape, manifest schema, loader,
permission model, what is frozen, and how a plugin becomes standard. The
rulings behind it (Prime Rule, the three tiers, the widget contract, the
framework-neutral ABI) live in [DESIGN.md](DESIGN.md) §2, §3, §4 and §9 and
are not restated here. Status (what is verified, what is open) lives on the
dev board, epic `ph-vdk`.

## Prime Rule

A plugin adds features **through Valence, never around it**. It reads the
model (catalog, reported values, write status) and writes through the shadow
entry points, the ones every built-in control uses, so a plugin write
gets the same pending, echo, fault lifecycle and the same refusal banner. The
API object has no session, socket or transport handle, and
`test/plugins.test.mjs` fails if one appears. When a plugin needs something
the protocol lacks, the change is a Valence RFC.

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
box. A hero that throws leaves the palette with its claims, as above.

**Replace mode (experimental, `ph-vdk.29`).** `registerHero` accepts an
optional `replaces: '<built-in hero id>'`, or a list of them, each
suppressed when the claim succeeds (the id a built-in registers with in
`src/ui/heroes.js`'s `HEROES` array, e.g. `'rail'`). When such a plugin is
enabled and its own claim succeeds, `claimAll` skips the named built-in
entirely for that pass (DESIGN §3: a tier-2 widget "renders instead", by the
operator's explicit choice to enable the plugin). When the plugin's claim
fails, or the plugin is disabled, the built-in claims normally. A `replaces`
plugin adds a substitution and never leaves a field unclaimed. An
unrecognized id matches nothing and suppresses nothing, the same way an
unknown role is ignored.

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
Plugins`, its page region the plugin's to fill full width.

- **Registration fields.** `mount(el, fields)` is a hero's mount, returning
  `{update, unmount}`, and PluginSlot drives it the same way, so a plugin that
  already has a hero passes that hero's mount and the card and the page are two
  views of one instance. `spec` is optional and resolves like a hero's but
  **claims nothing**: a page never takes a field from a card or the generic
  tree. A spec the hub cannot meet leaves the tab in place with the note `Not
  on this hub`. `id` follows the name rule, `label` is one or two words (at
  most 24 characters; docs/COPY.md), `icon` is one SVG path `d` on a 16-unit
  viewBox drawn open at 1.5 stroke (src/ui/navIcons.js's style; absent, the
  Plugins glyph). Registering returns `withdraw()`; a page whose mount throws
  is dropped like a hero.
- **Show tab.** The Plugins pane gives each plugin with a page a **Show tab**
  switch, persisted per plugin as `phosphor.plugins.pages.<name>` (`'1'` or
  `'0'`, in the prefs backup); absent, a factory plugin's pages show and an
  installed plugin's do not. The sidebar follows the switch at once. Host
  side: `src/plugins/host.js` `pages`, `pageShown`, `setPageShown`.
- **Fullscreen footer.** Every page gets the shell's Fullscreen in its footer
  (DESIGN §10.3); the plugin draws nothing for it, and a mount that fills its
  element's height fills the window.
- **`mediaFullscreen: true`.** The page offers fullscreen itself and gets no
  footer button (F11 still works). Its fullscreen is one mode, always bare:
  the page alone under the stop pair, and in the desktop shell the window
  fullscreen too, whatever pref `fullscreen` says (DESIGN §10.3, "fullscreen
  or not", `ph-5u0g.6`). `bare: false` in its ask is not honored and there is
  no mode event for it. Footer pages keep In window / Borderless; the
  desktop shell keeps `<html data-fullscreen-mode>` at that pref. On a phone
  the bare page owns the screen's edges: keep its own edge rows out of the
  rounded corners and the top cutout with `--corner-tl`, `-tr`, `-bl`, `-br`,
  `--corner-r` (the largest of the four) and `--cutout-l`, `-w`, `-h` on
  `<html>` (CSS px, 0 where absent; DESIGN §10.3, The screen's shape).
- **`compactHero: true`** (experimental, `ph-5u0g.6`). In buckets 1 and 2,
  while the page is on screen, the hero is one row: the position numeral
  without its label line or the planned target, lag and speed, the mini
  rail, and the five strip buttons at the 40 px target; a status condition
  takes the numeral's place. At least 40 px return to the page at 420x860
  and 860x420. Other
  buckets draw the hero as usual.
- **`status: true`** (experimental, `ph-5u0g.3`, `ph-5u0g.16`). The page's
  status shows in the top strip's status slot on every class; the page
  draws no status row and gets no footer for it. The page dispatches
  `phosphor-page-status` from inside its element (bubbles, `detail: {text,
  tone, title?}`, `tone` one of `null`, `'ok'`, `'warn'`, `'bad'`); the shell
  keeps the latest per page and shows it while the page is on screen, in the
  slot's fixed box (at most two lines, `title`, else the text, on hover), so
  a change moves nothing. One slot, by priority (DESIGN §10.3): a `'warn'` or
  `'bad'` status ranks under an act health condition and over the latest
  safety edge, in the warn ink; any other status ranks under a warn health
  condition and over the virtual mark, in the slot's quiet ink, and in the
  compact hero sits beside the numeral instead of taking its place. Send
  conditions only (a refusal, an error, a limit, a standing note); never what
  the page already shows (empty, playing, paused). An empty `text` clears it.
  A hero's card on the Dash or a category page sends the same event from
  its element and draws no status row either; the shell takes it as that
  page's status, ranked the same. Each source keeps its latest; the slot
  shows one per page: the newest `'warn'` or `'bad'`, else the newest
  other. Seams: `src/App.svelte` (per page), `src/ui/TopStrip.svelte` (the
  slot).
- **The quick rail** (experimental, `ph-5u0g.5`; DESIGN §10.3). The hero's
  own rail opened from the page's bar: on the phone class the vertical pop-up
  on the right edge (in the page and in page fullscreen), on the desktop the
  horizontal pop-up along the bottom in a bare page fullscreen only (inline
  and In window the hero rail is on screen). The page draws the icon itself:
  - `api.icons.quickRail` is the glyph, one SVG path `d` on a 16-unit viewBox
    drawn open at 1.5 stroke, so every page draws the same icon. Title
    `Rail`.
  - `<html data-quick-rail="vertical" | "horizontal">` is present only while
    the quick rail exists for the page on screen (and a rail is mounted);
    draw the icon only then. `<html data-quick-rail-open>` is present while
    it is open.
  - Ask: dispatch `phosphor-quick-rail` from the icon (bubbles, cancelable,
    `detail: {open: true | false | 'toggle'}`). The shell takes it only for
    the page on screen and only while `data-quick-rail` is present, calling
    `preventDefault()`. The horizontal pop-up opens above the element that
    asked (the page's bar), never past the stop pair.
  - Mark the icon `data-quick-rail-toggle`: the pop-up's outside-tap close
    skips it, so a tap toggles instead of closing and reopening, and the
    footer's own icon hides while the page shows one (one per screen). A
    page hides its icon with the `hidden` attribute; any other hiding counts
    as shown.
  - State: `phosphor-quick-rail-change` on `window`, `detail: {available,
    open, form}` (`form` `'vertical'`, `'horizontal'` or null), fired on every
    change of availability (bucket, fullscreen, page switch) or open state;
    the icon's `aria-expanded` follows `open`.
  - Escape and a tap outside close it; a scrub or window drag holds it open.
  Seams: `src/App.svelte`, `src/ui/hero/heroBar.svelte.js` `openQuick`.
- **`fill: true`** (experimental, `ph-yuce`). The page is laid out as a column
  filling the desktop content pane's width and height (`main.pane.fill`, the
  page fullscreen geometry in place): a mount whose root is `height: 100%`
  gets a definite height and no bottom gap. Other pages keep their flow; the
  phone layout scrolls the window and is not filled.
- **Page-requested fullscreen** (experimental). A `phosphor-page-fullscreen`
  event dispatched from inside the page (bubbles, cancelable, `detail: {on,
  bare}`). The shell takes it only for the page on screen, and
  calling `preventDefault()` accepts it. `on` enters; `bare` (default true) hides the
  bar and strip with the stop pair floating (Borderless); `bare: false` keeps
  the hero bar and its rail and hides only the sidebar and pane chrome (In
  window); `on` false leaves. Every change is announced on `window` as
  `phosphor-page-fullscreen-change` (`detail: {on}`), so a view a page draws
  for it (the funscript player's media fullscreen) ends with the shell's
  (Escape, the caret, F11, a page switch). Seam: `src/App.svelte`.

**Page layout by bucket** (DESIGN §10.12, `ph-cqz6`). The host publishes the
window's width bucket, 1 (watch) to 5 (wide), as `<html data-bucket>`, with
`--cols` (the width in 2 rem layout columns); a page reads
`document.documentElement.dataset.bucket` (or styles `:root[data-bucket="1"]`
in its CSS) and never `innerWidth`. It declares a layout per bucket, or takes
the host's stacked default: buckets 1 and 2 (under 24 columns, about 860 px
at 100 % scale; the edges are 12, 24, 48 and 96 columns, and the phone class,
a coarse pointer with a shortest side under 500 px, is never past 2) are one column, 3 the
page's handheld layout else stacked, 4 and 5 its full layout. In buckets 1 and
2 the host makes the page's root a full-width column and caps its children at
the pane width; a page that lays itself out marks its root `data-layout` and
keeps what it declares. The host also holds the page to no horizontal overflow
and 40 px targets in 1 and 2 (law 12). The bucket can change while the page stays mounted (resize, scale, theme, text
size), so a page watches `data-bucket` (a `MutationObserver`) or lets CSS
do it.

**Search** (experimental). `registerPage({..., search: [{label, key}]})`
lists the page's controls in F3 as `<label> · <page label>`. `key` names a
`[data-search-key="<key>"]` element in the mount; choosing the entry opens
the page, scrolls to that element and focuses its first enabled control. A malformed list
throws like any bad `registerPage` field; absent, the page is found by
name only. Seam: `registerPage` in `src/plugins/host.js`, `src/ui/LookFor.svelte`.

**Density rungs** (DESIGN §10.5). A widget or hero has two rungs, compact and
normal, picked by the width its card gives it: compact under 18rem, normal
above, the line the built-in fields use (`src/ui/Field.svelte`); a widget
whose content turns at another width may place its own line. The host sets
no container on a plugin's element: the mount makes its root
`container-type: inline-size` and writes `@container (max-width: 18rem)` for
the compact form, or measures its own width (the reference plugin turns its
narrow form at 480 px of its root). Compact never goes under the 40 px
target and never hides the four-state reason (law 5).

**Modifier keys** (DESIGN §10.5). Every number the UI kit draws carries the
host's rule (The UI kit, below); a plugin that draws its own handle inlines
it, since plugins do not import app modules. Shift = fine: a drag at a
tenth of its gain, a key at the declared step and never under it (an
off-grid value is refused). Ctrl snaps to the decade below the range's
magnitude (1000 snaps at 100, 50 at 10): a key goes to the adjacent
multiple in its direction, one notch per press, and a drag rounds to the
multiple. Alt: a drag may hold its write to the release while `e.altKey` is down;
it has no other meaning. The advanced-penetration
plugin is the reference (`nudge` and the pointer handlers in its
`makeEditor`).

**Identities and paths** (`ph-kyjd`). A control's identity is the builder's
placement key (DESIGN §10.2, law 10): `role:<role>` for the first field
carrying a role, else `uid:<channel>:<field>`; a merged pair is its two keys
joined by `+` (`role:window.min+role:window.max`); a composite is
`hero:<id>` (a plugin hero `hero:plugin:<name>:<id>`), a safety pair
`safety:estop` or `safety:pause`, a category page's card
`group:<category id>:<group name>` (`diag:` for a diagnostic group), a Dash
summary `widget:hero-rank`, `widget:telemetry` or `widget:actions`. A Dash
duplicate's `#<n>` suffix names the same control. An identity never names a
position, so it survives a catalog etag change while its control exists; one
the catalog lacks resolves to nothing. A card whose fields a hero claimed is
not on the page and resolves to nothing too.

The **Valence path** is `valence://<hub>/<identity>`: `<hub>` is the hub's key
(WELCOME identity `hub_instance_id`, else the dialed `host:port`, as
`api.hub()` returns it), and the identity runs to the end of the string, a
slash included (`valence://a1b2c3d4e5f60718/role:pattern.speed`,
`valence://192.168.1.40:82/uid:4416:frequency`). The menu's Copy path writes
it. Category and card are not part of it: they are presentation. Seam:
`src/model/identity.js` (`pathOf`, `parsePath`, `resolveIdentity`).

**Context menus** (experimental, `ph-kyjd`). The shell has one context menu
(DESIGN §10.13); the webview's own (Print, Reload, Inspect) never shows outside
text entry, where cut, copy and paste stay, and a dev build keeps it behind
Shift+right-click. A right-click, a long press on touch, the menu key or
Shift+F10 on the focused control opens it at the pointer or the control's
corner, in the top layer, below the top strip and the stop pair; it moves
nothing. Arrows, Home and End move, Enter picks, Escape, Tab, a scroll and a
tap outside close it, and focus returns where it was. A submenu (Add to
Dash) opens beside it on hover, a click, ArrowRight or Enter, and ArrowLeft
or Escape closes it back to its opener; a tap opens it inline. It lists the
targets under the pointer, innermost first, each after a caption: the **field**
(headed by its label and the hub's description), the **module** or card
around it, and the **page**. A surface that takes its own right-click (the
Dash's edit-mode add menu, the node editor) prevents the event first, and the
shell stays out.

- Built-in field items: Copy path; Copy value (the reported value as text);
  Paste value (enabled only while the clipboard holds a fitting value: a
  number inside the field's bounds, an option's index, any text for a text
  field; never a secret); Reset to default (where the catalog declares one,
  disabled at it); Send to node editor; Show in history (once this session
  wrote the field); Add to Dash. Module items: Copy path; Send fields to node
  editor; Add to Dash. Add to Dash is on the full class only and opens a
  submenu of the Dashes (DESIGN §10.13): a check on each that holds the
  control, which opens it there; any other takes it; New Dash… names a new
  one in place. Page
  items: Edit layout on the Dash; Show advanced, Show diagnostic and Reset
  page to defaults on a category page (Show advanced on a card instead when
  one was clicked). Writes take the plugin write door: the host's confirm,
  the ladder and the refusal banner; a gated item is disabled with the gate's
  words as its title (law 3).
- **Send to node editor** dispatches `phosphor-node-add` on `window`
  (cancelable, `detail: {refs: [{kind: 'field', key}]}`, a merged pair as its
  parts). A mounted node editor takes it with `preventDefault()`; untaken,
  the refs wait in `nodeQueue` (`src/ui/contextmenu.js`), oldest first, for
  the editor to empty when it mounts.
- `api.registerMenu({id, targets, label, run})` adds an item; it returns
  `withdraw()` and needs the `menu` permission. `targets` lists `'field'`,
  `'module'` and `'page'`; `label` is a string of 1 to 40 characters or a
  function of the target returning one, or null to leave the item out for
  that target. `run(target)` runs after the menu closes. The target is frozen
  `{kind, key, hub, title, path}`: `key` the identity (a page's is its tab
  id), `hub` the hub's key, `path` the Valence path. A label or run that
  throws is recorded on the plugin and never reaches the shell. Items follow
  the built-ins of their target, in plugin load order. A plugin item is one
  row: it never opens a submenu.
- Seams: `src/ui/contextmenu.js`, `kit.js` `menu`, `src/App.svelte`
  (`menuItems`, the page's items), `host.js` `menus`.

**The dock** (experimental, `ph-kyjd`). `api.registerDock({id, label, icon,
mount})` returns `withdraw()`: a panel in the shell's right dock. `id` follows
the name rule, `label` is 1 to 24 characters, `icon` one SVG path `d` as a
page's; `mount(el)` is a page's mount with no fields, driven the same way
(`update()` on link and safety changes). The dock is closed until the user
opens it from the top bar (the toggle at the bar's right end, named by the
dock's label), and the toggle exists only while a dock is registered. On the
desktop the open dock is a column right of the content, which it narrows
(a user's act, DESIGN §10.3); its open state persists (`phosphor.dock`). On
the phone class it is a drawer from the right edge under the top strip, over
the page, never over the stop pair; Escape and a tap outside close it (the
tap swallowed, the strip's never), and the quick rail's pop-up and its
toggles work over it. With several docks a tab row picks one. Registering or
withdrawing a dock reruns no claim pass, so no plugin hero remounts.
Seams: `src/ui/Dock.svelte`, the toggle in `src/ui/LinkBar.svelte`,
`host.js` `docks`.

**The worked example**: `plugins/factory/quick-access/` builds the quick
access tray on these three capabilities and nothing else. Its `registerMenu`
item reads Pin to quick access, or Unpin from quick access, in module and
field menus; a pin is `{key, kind, title}` stored per hub in `api.prefs`
(`pins`, keyed by `api.hub()`). It registers its dock, Quick access, once
anything is pinned on any hub, so a user who never pins sees no toggle; each
pin is a kit card with a grip (drag, or ArrowUp and ArrowDown) and an Unpin
button around `ui.field(pin)` or `ui.module(pin)`. A row is built once per pin
and moved on a reorder, so a control keeps its in-flight write.

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
| `changed(channelOrRole)` | a plain number that moves whenever `value`, `status`, `gate`, `stale`, `reason` or `trialPending` could read differently for that channel id (or any channel carrying that role): its STATE landed, or a link, tier, latch, write, freshness or catalog change, or the motion lock. Compare it each frame and read only when it moved; reading it costs no reactive state. `NaN` where the host has no signal: read every frame | experimental |
| `onChanged(channelsOrRoles, fn)` | calls `fn()` after `changed()` moves for any listed channel id or role: on a microtask, then at most once a frame while moves keep coming; idle it costs nothing. Returns the unsubscribe; deactivating the plugin drops what is left. Not told of the motion lock's lapse (`changed()` reads it). A no-op where the host has no signal. Use it to ask for a frame when nothing else would draw one | experimental |
| `gate(field)` | `''` or why the field cannot be written now, in words (law 3: no link, not authorized, refused by the machine's mask, read-only). On a motion-input field (a c2h STREAM's, e.g. `input.duration`), in order: `no hub link`, `session not authorized`, the latch words, `stop the pattern first` (a generator runs), `motion input in use by <plugin>`. A foreign-held control-owner slot never gates; a stream holding the rail is the hub's `SOURCE_CONFLICT`, which `submitSegments` returns as `refused: rail owned by <source>` | experimental |
| `stale(field)` | `''` or the stale reason in words, by the host's one freshness rule (law 8). `age` is raw and grows on an on-change channel that is quiet | experimental |
| `reason(field)` | `''` or the last refusal of the field's write, as the host's ladder words it (`refused: SOURCE_CONFLICT`) | experimental |
| `modTarget(field)` | uid of the field the field's modulator entry rides (RFC-066 `mod_target`), or null | experimental |
| `storeSlots(field)` | for an `action.store` writer: a Promise of every slot of the store its `store_id` names (RFC-070), `{slot, state, name}` with `state` one of `pending`, `item`, `empty`, `locked`, `error` (RENDERING §8.4 row 9); null when unlinked | experimental |
| `manifest`, `apiVersion`, `log(msg, level)` | identity and the log pane | **freeze candidate** |
| `registerHero`'s `cells: {h: [w, h], v: [w, h]}` | minimum footprint in builder grid cells per orientation (DESIGN §10.2, `ph-e82.4`) | experimental |
| `registerHero` returning `withdraw()` | removes that hero (a device that went away); a saved placement of it stays inert | experimental |
| `registerHero`'s `replaces: '<built-in hero id>'` | tier-2 "renders instead" of the named built-in when this plugin's own claim succeeds (`ph-vdk.29`) | experimental |
| `submitMotion(norm, durationMs)` returning `{ok, reason}` | motion input, 0..1 across the stroke window. Needs `motion` | experimental |
| `submitSegments(list)` returning `{ok, sent, rateHz, reason}` | lookahead motion input: `[{atMs, norm, durationMs, endVel?}]`, `atMs` the `performance.now()` instant the machine starts each, ascending, `endVel` its end velocity in norm/s (absent: `unspecified`, a free knot the hub shapes and, on a stream, passes moving while it expects a successor; 0 for a real stop); advance by `sent`. Needs `motion` (`ph-smvd.2`) | experimental |
| `submitSamples(role, list)` returning `{ok, sent, rateHz, latencyMs, reason}` | a c2h `samples` STREAM found by channel role (e.g. SPEC 9.7's `osc.drive`): `[{atMs, values}]`, `atMs` the `performance.now()` instant each sample describes, ascending, `values` in the role's layout order; one bundle per call, advance by `sent`; `latencyMs` the grant's `schedule_latency_us`, the least notice a point needs (RFC-110 item 4): send each that far ahead or more, never past the 250 ms lead cap; `reason` `NO_STREAM` when the hub has no such entry. Not motion input: no producer lock. Needs `motion` (`ph-6dr6`) | experimental |
| `net.listenTcp(port, onLine)` returning `close()` | loopback TCP line service, shell only. Needs `net.listen:<port>` | experimental |
| `net.fetch(url, init)` returning a `Promise<Response>` | HTTP(S) to a non-machine service (a media library), CORS-free through the shell's HTTP plugin; vite dev uses the page's `fetch`. Refuses other schemes and the connected hub's own origins (its host on 80, 443 or its WS port). Needs `net.fetch` (ruling R-A, `ph-smvd.2`) | experimental |
| `registerSettings(mount)` | a card on the plugin's row in the Plugins pane | experimental |
| `icons.quickRail` | the quick rail's glyph, one SVG path `d` (Pages, The quick rail) | experimental |
| `registerPage({id, label, icon, spec, mount, mediaFullscreen, fill, search, status, compactHero})` returning `withdraw()` | a tab under Plugins in the sidebar; `mount(el, fields)` as a hero's, `spec` resolved without claiming (Pages, above) | experimental |
| `registerTheme(theme)` | a preset, kind `theme` only: the full object `{id, name, accents, chassis, look, overrides}` (docs/THEMES.md) or the old `{id, name, reality, intent}` pair. The id is namespaced; safety tokens are dropped (RENDERING law 13) | experimental |
| `prefs.get(k)` / `prefs.set(k, v)` | per-plugin JSON in localStorage (browser state, never machine state) | experimental |
| `hub()` | the connected hub's key (`hub_instance_id`, else `host:port`), null before a catalog: per-hub plugin state keys on it (Identities and paths) | experimental |
| `registerMenu({id, targets, label, run})` returning `withdraw()` | an item in the shell's context menu of a field, a module or a page (Context menus). Needs `menu` | experimental |
| `registerDock({id, label, icon, mount})` returning `withdraw()` | a panel in the right dock, closed until the user opens it (The dock) | experimental |
| `ui` | the shell's controls and layout primitives in plain DOM, `ui.version` 1 (The UI kit, below) | **the kit only grows**: v1 is a contract; additive only |

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

`submitSegments(list)` is the lookahead entry point (RFC-087), segments STREAM only,
never a fallback. The host computes all timing: it reads hub now (from
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

`submitSamples(role, list)` is the same door for a c2h `samples` STREAM that
a channel role names (the oscillator's `osc.drive`, SPEC 9.7): found by
class, direction, stream_kind and role, never motion input, never a
fallback. Each stamp is the described instant in hub time, never less
`schedule_latency_us`: on `osc.drive` that latency is the least notice a
point needs to land on its stamp (RFC-110 item 4, draft), so the caller
sends each point at least `latencyMs` ahead and that send-ahead is its only
lead. One bundle carries the leading samples within `bundle_max_span_ms`
(20 ms) and the 250 ms lead cap, at most 32 and one transport payload,
values filling the layout in order. Samples are not superseded.

**One producer.** An ok `submitSegments` with `sent > 0` holds the motion
input for its plugin until the latest sent end plus `MOTION_HOLD_MS` (500);
an ok `submitMotion` until now plus its duration plus 500. Another plugin's
`submitMotion` or `submitSegments` meanwhile returns `{ok: false, sent: 0,
reason: 'motion input in use by <plugin>'}` without being sent, and its
`gate` on a motion-input field says the same.

**Trial writes.** The hub keeps each trial key's stored value and owns the
undo: `revertTrial()`, a closed tab and a lost link all put it back, and
nothing reaches the machine's flash until `commitTrial()`. A key one client
has on trial refuses every other client's write, trial or not, with
`TRIAL_CONFLICT` (it lands in `reason(field)`). The flip, the schedule horizon
and the chase interval are refused as trials on the reference hub: each is
gated on live state, so its revert could be refused too. A trial NACKed
`UNSUPPORTED_OP` marks that channel and key as not trialable for the session
(Valence RFC-107, draft): `writeTrial` never retries it, the field's status reads
`not trialable here, write directly`, and the next `writeTrial` on it returns
`{ ok: false }` without sending: a preview never writes durably in a trial's
place; the operator writes the key from the settings page. A new session
starts the marks over.

## The UI kit (`api.ui`)

Operator ruling 2026-10-09 (`ph-5wsk`): "make it EASY for plugin developers,
otherwise nobody makes a plugin". A plugin builds its UI from the shell's own
controls and layout primitives, so the shell's layout rules hold by
construction. Plain DOM, no framework (DESIGN §9). `api.ui.version` is 1 and
v1 is a contract: the kit only grows (new factories, options and handle
properties), nothing is removed or changes meaning. Seam:
`src/plugins/kit.js`, handed to every plugin by the host.

**Shape.** A factory takes one options object and returns the live element,
ready to append. Its handle is properties on that element (`value`,
`disabled`, `label`, ...): a setter redraws in place and never calls back. A
callback option (`onChange(value, event)`, `onClick(event)`) fires on the
user's act only. Every control takes `disabled` at creation too. `class`
adds the plugin's own class names, for its CSS and its tests. An unknown
option or an unknown icon name throws, so a typo fails at mount.

**Teardown needs nothing.** Kit elements live inside the plugin's mount and
go with it; a window listener a kit element holds removes itself once the
element has left the document, and an open sheet that leaves it closes its
outside rule and its key rule. Put a sheet anywhere in the mount (it shows
in the top layer); one never appended is borrowed into `<body>` while open.

**Rules carried by every element** (nothing for the plugin to remember):

- One look: the elements wear the shell's global classes from
  `src/style.css` (`og-btn`, `og-seg`, `og-switch`, `og-num`, the select and
  range rules, `surface-card`, `card-sub`, `field-label`, `field-value`,
  `stepper`, `dash-title`, `foot-status`). The shell's own components wear
  the same classes, so a theme reaches both. A plugin never restates them.
- No page shifting (DESIGN §10.3): every slot a state can fill is reserved;
  a state change swaps text, never a box.
- Targets: 40 px on a coarse pointer (law 12); a `bar` row is the tap height
  there.
- Touch never adjusts by accident (`ph-5u0g` peeve 14): a slider, a scrub
  and a number's drag take a touch drag only after horizontal intent (8 px,
  more across than down) or a 400 ms hold; a tap never changes them and a
  vertical swipe scrolls the page. A stepper's hold-repeat stops at the
  first movement.
- Modifier keys (DESIGN §10.5) on every number the kit draws: Shift fine,
  Ctrl the decade snap (`src/model/nudge.js`, the shell's rule).
- Overlays (`sheet` in every form) live in the top layer, so no ancestor's
  containment or overflow clips them; they start below the top strip and
  never cover the stop pair. Escape closes one. A tap outside closes it and
  is swallowed, so it never reaches the page beneath (a stage tap starts
  motion), except a tap on the top strip or the stop pair: a safety control
  always takes its tap.
- Screen corners: the Android activity publishes `--corner-r` inline on
  `<html>` (the largest of its four corners, beside `--corner-tl`, `-tr`,
  `-bl`, `-br`; `ph-5u0g` peeve 16); elsewhere the kit's default is 0, and
  the tests assume 48 px. A kit surface on a screen edge (a sheet, a drawer,
  a fullscreen stage's bars) keeps its content `--corner-inset` (0.3 r)
  clear of each corner.

**Icons.** `ui.icons` is the shell's glyph set by name (the sidebar's and
the media glyphs: `play`, `pause`, `prev`, `next`, `full`, `unfull`,
`close`, `gear`, `more`, `caret`, `library`, `volume`, `muted`, `graph`,
`video`, `script`, `quickRail`, ...), each a `[fill, stroke]` pair of path
`d`s on a 16-unit viewBox, the stroke drawn open at 1.5. `ui.icon(nameOrD)`
returns the `<svg>`; an `icon` option takes a name or a stroke path `d`.

**Controls.** Each returns the element; its handle is the listed properties.

| factory | options | handle |
|---|---|---|
| `button` | `label`, `icon`, `title` (an icon-only button's name), `tone` (`'primary'`, `'danger'`), `pressed` (a boolean makes it a toggle: `aria-pressed` and the shell's on look; it flips before `onClick`), `onClick` | `label`, `icon`, `title`, `pressed`, `disabled` |
| `files` | `accept`, `multiple`, `onFiles(files)` (an array) | a hidden file input: `open()` shows the picker; append it anywhere in the mount |
| `segmented` | `options: [{value, label, icon, title}]`, `value`, `tabs` (a tab list: `role=tab`, the open tab in `--highlight`), `onChange` | `value`, `disabled`, `options` (settable: the buttons are rebuilt) |
| `switch` | `label` (beside the track), `value`, `onChange` | `value`, `disabled` |
| `slider` | `min`, `max`, `step`, `value`, `label` (accessible name), `format(v)` (its value chip, `el.chip`, as wide as its widest reading), `onInput` (live), `onChange` (on release) | `value`, `disabled`, `chip`, `input` |
| `stepper` | `min`, `max`, `step`, `value`, `unit`, `label`, `buttons` (default true: minus, number, plus with hold-repeat; false: the number box alone), `drag` (the box drags sideways, one step per 4 px; a press without a drag types), `onChange` | `value`, `disabled`, `input` |
| `select` | `options: [{value, label}]`, `value`, `label`, `onChange` | `value` (the option's own value, a number stays a number), `disabled`, `options` (settable: the list is rebuilt, the chosen value kept when it is still there) |
| `text` | `type` (`text`, `search`, `url`, `password`), `value`, `placeholder`, `label`, `onInput`, `onChange` | `value`, `disabled` |

**Layout.**

| factory | options | handle |
|---|---|---|
| `page` | `main` and `aside` (element lists), `fill` (the page fills to the window's bottom on every class, the phone class included) | `main`, `aside` (their boxes), `asideOpen`. Bucket 3 and up: `aside` is a 320 px column at the right; buckets 1 and 2: one column. |
| `card` | `index` (`'01'`), `title`, `actions` (elements at the head's right), `caret` (the title collapses the body), `open`, `onToggle` | `body` (append here), `head`, `actions` (the head's right end: append more there), `title`, `index`, `open` |
| `rows` | `title` (its `card-sub` head) | the grid `row`s go in |
| `row` | `label`, `control`, `chip` (default: the control's own `chip`), `tip` | label, control and chip on one line (the settings row) |
| `bar` | `left`, `center`, `right` (element lists), `drop` (elements in the order they leave) | `left`, `center`, `right` (the groups), `refit()` (after a group's content changes width; a resize refits by itself). One row while it fits; else `center` takes its own row above; else the `drop` elements leave in order. A target never shrinks. |
| `stage` | `overlay` (`'fullscreen'`, the default: the overlay exists in fullscreen only; `'always'`), `rotate` (on the phone class a turn to landscape enters fullscreen while `aspect` is set, and the turn back leaves), `onTap` (a single tap once the double window passes; a tap that only wakes a hidden overlay is none), `onDouble` (default: fullscreen), `onFullscreen(on)` | `media` (the video goes here, letterboxed), `empty` (a slot over the box; the plugin shows and hides what it puts there), `overlay` (hides after 2.5 s idle, kept while hovered, dragged or holding keyboard focus), `dock` (shown while the overlay hides), `aspect` (width / height; the stage sizes to it, at most `--ui-stage-max`, 60 % of the window height by default; null keeps 16:9), `fullscreen` (get/set: the shell's bare page fullscreen), `flash(icon)`, `center(icon or null)`, `poke()` (shows the overlay) |
| `scrub` | `max`, `value`, `buffered`, `step` (the arrows' step, default 1 % of `max`), `label`, `format(v)` (the hover readout and `aria-valuetext`), `onSeek(v, phase)` (`'start'`, `'move'`, `'end'`) | `value` (ignored mid-drag), `max`, `buffered`, `track` (paint a background here, e.g. a heat map) |
| `split` | `min`, `max`, `value` (px of the region after the bar, or null), `size()` (that region's height while `value` is null), `label`, `onChange(px, commit)` | a horizontal resize bar: drag, arrows (8 px, Shift 1), a double-click asks for null |
| `sheet` | `title`, `index`, `form` (`'auto'`, `'sheet'`, `'drawer'`, `'popover'`, `'slot'`), `slot` (an element of the plugin's: the slot form is a card there), `anchor` (its toggle: a popover opens under it, a tap on it is no outside tap; settable later), `onClose` (a user's close) | `body`, `open` (get/set), `form`, `anchor`; `data-open` while open. Auto: the right drawer in page fullscreen, the bottom sheet on a phone upright, else the slot when one is given, else the drawer; it follows a turn or a fullscreen while open, its content moving with it. The sheet drags down to close; the slot card closes on its close button. |
| `status` | none | `set({text, tone, title})`, `tone` null, `'ok'`, `'warn'` or `'intent'` (sent as null). Inside the shell's pane (a page that registers `status`, a hero's card on the Dash or a category page), on every class, it is the top strip's status slot (Pages, above) and draws nothing in place; elsewhere it is a one-line row where the plugin placed it. Set conditions only; `{text: ''}` clears it. |
| `quickRail` | none | the Rail button: it opens and closes the quick rail; `shown` (default true): it is hidden (the `hidden` attribute, so the shell counts it out and shows the footer's own icon) while the host offers no rail or `shown` is false |
| `list` | `form` (`'grid'`, `'rows'`), `paged` (default true: as many whole items as fit, and a page foot; false: it scrolls with the shell's recess shades and asks for everything once), `tile: {min, max}` (grid tile widths in px), `row: {min}` (rows fill side-by-side columns at least `min` px wide; one column with `onMove`), `count(total)` (the foot's count words), `onPage(page, perPage)` (show that page: call `show`), `onMove(from, to)` (rows drag to reorder: a mouse at once, a touch after a hold; the drag is no pick; one column) | `show(items, total)`, `note(text, tone)` (loading, empty or an error, over the body), `busy`, `page`, `perPage`, `form` (settable: the page refits), `refit()` (measure the page size again); a refit keeps the page's first item in view |
| `tile` | `image`, `title`, `meta`, `current`, `actions` (kit buttons over the shot, or at a row's end), `onClick` | `current`, `button` (the tile's own button); the parent `list`'s form draws it as a tile or a row |

**Helpers** for a plugin's own drawing, each returning `off()`:

- `ui.drag(el, {axis, intent, hold, filter, onStart, onMove, onEnd})`: the
  touch rule above for a handle the plugin draws itself. `axis` `'x'` or
  `'y'`. With `intent` (default true) a mouse begins at once and a touch or
  pen after 8 px more along the axis than across, or the 400 ms `hold`
  (default true); with `intent` false a mouse begins after 8 px of movement
  (a plain click still clicks) and a touch only by the hold.
  `filter(downEvent)` returning false ignores that press.
  `onStart(down, e)` (the press and the event that began the drag),
  `onMove(e, dx, dy)` (from the press), `onEnd(e, ok, down)` (`ok` false on
  a cancel).
- `ui.gestures(el, {tap, double, hold, pinch, filter})`: a tap once the
  double window passes, a double, a 400 ms hold, and a two-finger pinch
  reporting its scale since the last call.
- `ui.outside(el, onOutside, except)`: the overlays' outside-tap rule for a
  plugin's own overlay; the `except` elements (its toggle), or selectors,
  count as inside.
- `ui.shade(el)`: the shell's scroll recess shades (DESIGN §10.3) on a
  scroller of the plugin's own.

**Field-bound controls** (`ph-5wsk.6`). `ui.field(identity)` and
`ui.module(identity)` return an element that draws the shell's own control for
an identity (Identities and paths): `field` one field, `module` anything a
card holds (a field, a composite, a category card's fields, a Dash summary;
the rail as its mini, whose press opens the hero's own rail, never a second
rail). `identity` is the key or `{key, title}`, a menu target included. It is
the component the pages draw, so every RENDERING law comes with it (the
four-state ladder in words, the gate's words and graying, stale dimming, the
refusal), and a write goes through the shell's normal path and confirm. It
follows the catalog live; a key the catalog lacks draws one quiet row,
`<title> · not on this machine`, and the element carries `data-missing`. Both
need the `intent` permission. The handle is `key`. The rendering mounts while
the element is in the document and is released after it leaves; moving it
within one task (a reorder) keeps it. Seams: `kit.js` `field`, `module`,
`src/ui/BoundControl.svelte`.

**Example** (`plugins/examples/kit-demo/`): a settings card, and a page with
a card, a bar, a sheet and a warning in the status (Count past 8), in about
40 lines.

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
| `permissions` | `intent`, `motion`, `menu`, `net.fetch`, `net.listen:<port>`; anything else makes the manifest invalid |

Validation lives in one place, `src/plugins/host.js` `validateManifest`. An
invalid manifest is listed with its problems and its code is never run.

## Permissions

A plugin runs in the page with
the page's full authority. The manifest declares what it means to do, the
Plugins pane shows it before and after enabling, and the API refuses a gated
call the manifest did not declare (`PermissionError`). This catches undeclared
calls from a well-behaved plugin and makes each plugin's surface reviewable.
It does **not** contain hostile code: a module can open its own WebSocket.
Install a plugin only from a source you would trust with a program.

Reading needs no permission. `intent` covers every settings/action/command
write and the field-bound controls (`ui.field`, `ui.module`), `motion` covers
motion input, `menu` adds items to the shell's context menus, and `net.listen:<port>` opens a TCP
listener on **127.0.0.1 only** (`src-tauri/src/plugins.rs`; a LAN bind would
be an unauthenticated control path, `ph-vdk.28`). `net.fetch` reaches HTTP(S)
services that are not the machine; the hub's own origins are refused, so it
is not a side channel around Valence (DESIGN §2).

Every call into plugin code (activate, deactivate, mount, update, unmount,
settings, TCP line callbacks) is wrapped: a throw is recorded on the plugin,
shown on its row in the Plugins pane, and logged to the Log pane tagged
`plugin:<name>`. A hero that throws is dropped and its fields return to the
generic renderer; a plugin whose `activate` throws has everything it
registered rolled back. No exception from plugin code propagates into the kernel.

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
error on its row. It also carries `'wasm-unsafe-eval'` (WebAssembly compile only, not
`eval`): the funscript player compiles the machine's planner in a worker, and
without it the analyzer reads `Kinetic: fallback` (docs/plugins/FUNSCRIPT.md,
Kinetic). A plugin runs under the page's policy, so `connect-src` (`ws:` plus
Tauri IPC) refuses its `fetch` to any http origin; HTTP goes
through `net.fetch` (the `http:default` capability allows `http://**:*` and
`https://**:*`; `:*` is required, because a URLPattern without a port
matches only the scheme's default port, so `http://**` refused Stash on
30198) and loopback TCP through `net.listenTcp`.
`img-src` and `media-src` take `blob:`, `http:` and `https:`, so a plugin
plays a local file from an object URL or media from a library by URL (ruling R-B); `media-src`
otherwise falls back to `default-src 'self'` and nothing plays. Plugin files
come through the `plugins_list` command, so no asset-protocol scope is
involved.

**Hub-served page.** A hub serves only the one bundled file, and that page
loads no plugins. For development only, a `vite dev` build accepts
`?plugin=<url of the entry module>` (repeatable) and fetches `manifest.json`
beside it, e.g.
`http://localhost:5173/?hub=<hub>&plugin=/plugins/examples/stroke-gauge/index.js`.
Production builds compile that path out.

## The examples

- `plugins/examples/stroke-gauge/`: a read-only widget. Claims
  `telemetry.position` (window roles optional) and draws an SVG gauge, dimmed
  when stale. It shows the hero seam working from outside the bundle without a
  framework.
- `plugins/examples/kit-demo/`: the UI kit (`api.ui`) in about 40 lines: a
  settings card of rows (a switch, a slider, a select) and a page with a
  card, a bar, a sheet and a warning in the status. It draws nothing of its
  own.
- `plugins/examples/tcode-adapter/`: RFC-044 rung 1 as an adapter. The shell
  listens on 127.0.0.1:8000 (MultiFunPlayer's default endpoint port; the
  spec pins none, drafted as Valence RFC-061), each line is parsed for `L0`
  (`L0500I100` = 0.5 over 100 ms; other axes, `S` and device commands are
  ignored) and submitted with `submitMotion`, the `I` interval as its
  duration. The hub receives Valence motion input only, never TCode.

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

An example is documentation. It is never loaded by default; install one by
copying its folder.

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
  accel 30`, `out accel 60`, `dwell 0.5`, `amp 40`, `offset 0`). A label
  sits beside its handle on the side square to the curve's tangent, clear of
  every drawn line (the stroke, the 0 and 100 guides, the modifier graph's
  top guide, amp axis and offset track), of the handles and of a plus's dot.
  It tries one and two label heights further out before giving up, the most
  hemmed-in label places first, a three-word label with no clear side drops
  its side word (`accel 100`, the half shows the side), and only then does a
  label get a backing. The numeric rows hide behind an Inputs toggle right
  of the preset box (default hidden, `phosphor.advpen.inputs`); hidden, they
  are not rendered and the handles carry the arrow keys.

  **Styling.** The master and Classic sliders are host
  fields: `.field` with `data-shadow` (style.css GROUND TRUTH, the ring
  and line of docs/EFFECTS.md, the afterglow on each echo) and the host's
  value chip, value then unit (format.js `formatParts`). Start, the preset
  select and Run in background's track carry `data-shadow`, the inset ring
  of a surface without one. A handle shows its state by color only; the
  state text appears in the plot's one-line note (`deep 51 · waiting`, amber for
  `still waiting` and `refused`), not in the label, so a state change
  does not move a label or a box. Focus, the open tab and a pressed tool use
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
  modulators get tabs like the other six. A store op's slot and name are
  found by their RFC-089 roles (`store.slot`, `store.name`), on a hub
  without them by schema type.

  **Narrow** (the card under 480 px, a phone or a two-cell placement): the
  hint and the depth ticks drop and the modifier tabs pair up.

  **Planned motion** (`planMotion`, pure) under the stroke editor and
  above the rhythm section, the current parameters to scale over a fixed
  window (default 10 s, 2 to 60, a stepper right of the strip: up, number,
  down; steps 1, 5 or 10; kept in `api.prefs`) on a 1 s grid with thinned
  labels in a band under the plot and no caption. It runs the way the
  firmware does (`AdvancedGenerator`): half-strokes from the in half, each
  from where the last landed, v = master x half x `limit.input.speed`
  (floor 1 mm/s), a = v^2/d x (1 + 9 knob), d from `window.min`/`window.max`;
  a dwell holds dwell x (this half + the one before, the run's first
  counting twice); a half under 0.25 mm is a 50 ms rest that owes no dwell.
  Every modulator applies per stroke through `BaseControl::modifiedValue`,
  the firmware's modulator rule:
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
- `plugins/factory/quick-access/`: the quick access tray, the worked example
  of Context menus, The dock and Field-bound controls (above). Enabled by
  default; its dock exists once something is pinned and opens only when the
  user opens it. Declares `intent` and `menu`.
- `plugins/factory/funscript-player/`: plays a local or Stash video and
  drives the rail from its main (L0) funscript. One hero, `player`
  (`absorb: false`), requires `input.target` and `input.duration`, so it
  renders only where the hub has a segments STREAM (FUNSCRIPT.md D1); the window, the
  position, `limit.input.speed`, both generator run roles and the plan
  strip's elapsed and duration (automatic latency) are optional.
  Motion leaves only through `submitSegments`, one segment per funscript
  span on the media clock, and every stop of its own sends one hold; the
  script's V8 and V9 axes ride `submitSamples('osc.drive', ...)` while it
  plays, where the hub offers the role (FUNSCRIPT.md, Multi-axis); a
  gate or a hub refusal pauses it with no hold. The card's Play is the
  only start, and a latch, a running generator or another producer grays
  it with the gate's words. Stash rides `net.fetch`, its connect card
  in the Plugins pane and in the library's place. The detail's expand
  button opens the analyzer in the card's own box: the hub's Tuning
  controls (and `limit.input.*`), written Live through `api.write` or as a
  Preview through `api.writeTrial` with Apply and Discard, so the manifest
  declares `intent`. Its settings card holds the Stash connect card,
  Scale and the playback rows (loop, auto-home, seek glide, automatic
  latency); the hub shapes the curve between actions. The detail's A-B button loops a section. Operator values persist
  through `api.prefs`; all but the Stash key are mirrored under
  `phosphor.funscript.*` for the prefs backup. Its page, `Funscript` under
  Plugins (`page.js`), mounts the same card full width. Every control,
  overlay, list and the stage are the UI kit's (`api.ui`); the player keeps
  its composition, the timeline wave and the analyzer. Design and decisions:
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
`node test/quick-access.test.mjs` drives the context menu, the dock, the
field-bound controls and the quick-access plugin in the shell bundle against a
fake hub at 1428x900, 1024x768 and 420x860. `plugins.test.mjs` also checks
every identity's path round trip and the three capabilities' checks.
`node test/funscript-player.test.mjs --unit` (in `npm run check`) checks the
player's contract exports, prefs and hero spec; without `--unit`
(`npm run check:funscript`, needs ffmpeg) it plays a generated clip in the
shell bundle against a fake hub and the fake Stash, and `--live --port P
--http P+7` against valencesim on spare ports; `--live-playback` there plays
loop, auto-home, the seek glide, auto latency and a Preview write.

`plugins/` sits outside `src/`, so `test/check-device-knowledge.mjs` never
scans it: a plugin may know one machine's channel ids and field names. The
host under `src/plugins/` is scanned like the rest of the kernel.

## Promotion to tier 1

A plugin is promoted to standard (tier 1) by PR (DESIGN §3):

1. Rebind it to registry roles only. Any channel id or device field name has
   to go; `check-device-knowledge.mjs` will fail the build otherwise.
2. If it needed a role the registry lacks, that is a Valence RFC first.
3. Port the widget into `src/ui/hero/` and register it in `src/ui/heroes.js`
   beside the built-ins, with a zone and its `cells`.
4. It now ships to every hub, served page included, so it meets the
   RENDERING.md §13 conformance laws there.
