# Phosphor -- the reference Valence client & widget system

> Home of Phosphor's design rulings. Moved from the archived machine repo
> 2026-09-25; rulings predate the rename and stand.

Wire truth stays in the Valence repo (sibling checkout, pinned by
`valence.pin`); this document is everything above the wire -- the
client/widget architecture (`governance.md` C-1: this is that fact's one
home).

## 1. What Phosphor is

The first-party Valence client -- a Tauri 2 application whose UI core doubles
as a community framework -- plus the widget/plugin system that lets the
experience be upgraded per-capability without ever bloating the standard.

Goals, in priority order:
1. **Compatible with every Valence hub** -- any conformant hub gets a
   complete, correct, safe UI with zero Phosphor knowledge of the machine.
2. **Gold-standard full experience** for capabilities that have earned it
   (Kinetic planning, fray-d's Advanced pattern generator, the Nucleus
   telemetry set).
3. **User-controlled customization** -- widget upgrades are visible, optional,
   swappable, and user-installable.
4. **The standard grows by proof** -- community widgets earn promotion the way
   protocol changes earn RFC numbers.

## 2. The Prime Rule (operator ruling, 2026-07-27)

> **Plugins add features through Valence, not around it. If a plugin needs
> something that isn't part of Valence, that thing gets implemented -- in the
> protocol or the firmware -- at that point.**

Consequences, all deliberate:
- The plugin API surface IS the Valence model: the catalog, the shadow store
  (reported state in, intents out, pending -> echo-confirmed lifecycle), the
  event stream, and roles. No socket access, no side channels, no HTTP
  backdoors.
- Ground-truth doctrine (`.claude/rules/webui.md`) holds structurally: a
  plugin cannot lie about machine state because it never owns state -- it
  renders the shadow store and submits intents like everyone else.
- A plugin hitting a protocol gap is the discovery mechanism for the next
  RFC -- the client-side twin of the spec-gap ritual.

## 3. The three tiers

**Tier 0 -- generic catalog renderer (the floor).** Renders ANY advertised
channel from catalog metadata alone: layout fields -> readouts, schema keys ->
typed setting cards, options -> selects, `option_access` -> role gating, safety
exemptions honored. Never removed, never machine-specific. This tier is the
conformance claim "works with every hub" and is the client-side floor of the
Valence repo's `spec/RENDERING.md` derivation chain (catalog entry ->
category -> rank -> archetype -> widget pattern -> region -> page).

**Tier 1 -- standard widgets (the earned set).** Rich widgets that BIND TO
REGISTERED ROLES, not machines or raw channel ids -- a role (the registry's
`field_roles`, e.g. `window.min`) is ecosystem-wide and never renumbered, so
binding on role is machine-agnostic by construction, and survives a channel
being renumbered or reshaped. **As implemented, this is stronger than the
original channel-id proposal:** Phosphor's heroes (`src/ui/heroes.js`,
`claimRoles()` in `src/model/roles.js`) declare `require`/`optional` role
sets; a hero whose required roles are not all advertised declines silently
and its fields fall through to Tier 0. The standard grows widgets, never
requirements.

Founding set (operator-ratified 2026-07-27), current implementation:
| Widget | Binds to |
|---|---|
| Rail hero + telemetry chart | motion telemetry/window/command roles (`RailWidget.svelte`) + motion STATE channel (`TelemetryChart.svelte`) |
| Safety bar + anomaly log | safety STATE, motion-anomaly EVENT (`SafetyBar.svelte`, `LogPane.svelte`'s anomaly tab) |
| Plan strip | plan-strip channel (`PlanStrip.svelte`); Kinetic tuning itself still renders through the generic Tier-0 settings cards -- no dedicated tuning widget exists yet |
| fray-d Advanced generator panel | pattern role family (running/select/speed/depth/stroke/sensation) + preset store (`PatternWidget.svelte`) |

*(A Tier-1 binding is to a role or channel's registered IDENTITY, which
survives renumbering, not to a number restated here. The machine's own
channel-map doc has not been re-created since the Nucleus/P4 rebuild; it
lived at `docs/slopsync/CHANNEL-MAP.md` on the archived S3 machine.)*

```mermaid
flowchart TB
    start(["Start: client connects,\nfetches the catalog"]):::startNode
    core["Valence core\ncatalog + shadow store -- the Prime Rule boundary\n(§2: plugins reach the machine ONLY through this)"]
    t0["Tier 0 renders the channel\ngeneric: metadata alone, never machine-specific"]
    check1{"Does a Tier-1 widget\nbind this channel's identity?"}
    t1["Tier 1 widget replaces\nthe generic rendering for that channel"]
    check2{"Shell present, and a\nTier-2 plugin claims it?"}
    t2["Tier 2 plugin widget renders instead\n(user's explicit choice)"]
    absent["Tier-1/2 widget absents itself\ngracefully -- costs nothing"]
    promo["Promotion PR:\nplugin proven in the community list"]

    start --> core --> t0
    t0 --> check1
    check1 -->|"yes"| t1
    check1 -->|"no: channel not advertised"| absent
    t1 --> check2
    check2 -->|"yes"| t2
    check2 -->|"no"| t1
    t2 -.->|"community-proven, becomes standard"| promo
    promo -.->|"folds into"| t1
    absent -.->|"catalog gains the channel later"| check1

    classDef startNode fill:#2b6cb0,color:#fff,stroke:#2b6cb0,stroke-width:2px
```

Reading the diagram: the two decision diamonds are re-evaluated per channel,
not once per session -- a page with ten advertised channels walks this flow
ten times, independently, every catalog refresh. The dashed edges are the two
loops that close the system: a plugin earning its way into the standard
(bottom), and a channel that was absent showing up in a later firmware and
being picked up automatically (left).

## 4. The widget contract

A widget declares:
- `binds`: registered role(s) and/or channel id(s) it upgrades (`require` /
  `optional` in `heroes.js`'s registry);
- `renders`: the slot it fills -- realized in code as `zone: 'instrument' |
  'card'` (`heroes.js`): `instrument` is pinned chrome in the hero strip,
  `card` is an ordinary dashboard card the generic grid lays out and
  reorders. Tier 2 plugins compose into the same slots Tier 0 already builds
  instead of fighting it;
  *(Superseded 2026-09-26 by §10.2: every widget, plugin widgets included, is a
  placeable control on the builder grid. The two zones describe today's code
  until phase (c) lands.)*
- what it receives: a scoped view of the shadow store for its channels/roles
  + the catalog entries it bound;
- what it may do: submit intents (queued through the core's pending->echo
  lifecycle), subscribe to events, persist per-widget user settings.

Trust model: plugins run as trusted code (community-review culture), but the
API is deliberately narrow enough -- store-scoped, no socket, no global DOM
contract -- that sandboxing can be added later without breaking conformant
plugins. Anything a plugin "needs" beyond this is a Prime Rule event (§2).

**Freeze discipline:** the moment the first external plugin exists, the
widget API is frozen the way Valence's `hub.hpp`/`client.hpp` are frozen
(governance C-6): additive evolution only, versioned, never breaking. Design
it small and boring. The v1 contract, with the freeze candidate marked,
is [PLUGINS.md](PLUGINS.md); the trigger is tracked on the board.
*(Re-timed 2026-09-26: the freeze also waits for the builder's control
contract, §10.2, because plugin widgets change shape under it.)*

## 5. Compliance testing -- the sim modes

History: the sim's catalog was previously reduced/diverged from the device
specifically to exercise the UI's generic rendering. Ruling: that was the
wrong mechanism -- it left the primary test surface permanently degraded and
let the committed fixture drift from reality (dev board ruling, 2026-07-27).

The replacement -- **catalog profiles as a sim flag**:
- `--profile device` (DEFAULT): full device fidelity -- the complete Nucleus
  catalog incl. plan-strip, power, kinetic-diag, motion-anomaly, and
  `raw_10um`. What Phosphor develops against; what the committed fixture is
  captured from.
- `--profile alien`: a deliberately weird conformant hub -- unknown vendor
  channels, odd units, sparse metadata, missing niceties, hostile-but-legal
  catalog shapes. Tier 0 proves genericity here; Tier 1 proves graceful
  absence here.
- `--profile minimal`: the smallest conformant catalog -- the "any hub at
  all" floor.

Test mapping: fixture + Tier-1 tests <-> `device`; genericity/compliance
tests <-> `alien` + `minimal`.

**(planned)** These three profiles described the old `slopsim` harness.
`Nucleus/sim/valencesim`, its successor, is being ported now and does not
exist on disk yet as of this writing -- treat the profile flags and the
per-channel sim-coverage gap they used to document as unverified until the
port lands. Current state: the dev board (`bd`, prefix `ph-` here;
Nucleus's own board for the sim side).

> DEMO-CANDIDATE: `Nucleus/sim/valencesim --profile minimal` next to
> `--profile device`, same client, to show the "any hub at all" floor and the
> full reference machine side by side -- the portability claim made concrete.

## 6. Architecture notes

- **Verified against the current tree (2026-09-25):** there is no `core/`
  kernel directory. `src/model/` (the shadow store, connection, roles,
  settings) imports the protocol layer directly and live from the sibling
  checkout (`../Valence/clients/js/index.js` and friends) -- there is no
  local copy or package boundary between the two. The existing widgets
  (`src/ui/`, `src/ui/hero/`, `src/ui/widgets/`) are the Tier-1 exemplars.
- Tauri 2 shell owns: plugin discovery/loading ([PLUGINS.md](PLUGINS.md)),
  the community plugin list (planned), updates, multi-hub connections
  (SPEC §13.8 UDP discovery -- `src-tauri/src/discovery.rs` -- + manual host entry; **not
  mDNS**, corrected from the original SlopDeck-era text), and whatever the
  embedded-UI ruling (§8) leaves to it.
- The UI kernel stays publishable as the community "webui framework" project
  regardless of §8's outcome.

## 7. Sequencing

The ladder, description only -- status for each item lives on the dev board
(`bd`, prefix `ph-`), never restated here:

1. **Sim fidelity** -- `--profile device` at full catalog; fixture capture;
   `alien`/`minimal` profiles (§5).
2. **Widget interface extraction** -- formalize the contract from the
   founding widgets; Tier 0/1 split explicit in the codebase.
3. **Tauri 2 shell** -- shell ships (`src-tauri/`, vendored
   `tauri-plugin-blec` at `src-tauri/vendor/tauri-plugin-blec/`, Android
   target), plugin loader and two example Tier-2 plugins
   ([PLUGINS.md](PLUGINS.md)).
4. **API freeze + docs** -- widget contract documented, versioned, frozen;
   community plugin list opened. *(Re-timed 2026-09-26: after the builder's
   control contract, §10.2.)*
5. Embedded-UI ruling (§8) executed wherever it lands.

## 8. RULED (operator, 2026-07-27) -- delivery vehicles

**Serving a UI is a hub capability, never a requirement** (Valence RFC-043).
One Svelte client kernel, three delivery vehicles, tiers orthogonal to
delivery:

- **Embedded (hubs with the capability):** a thin client exposing ALL
  controls at Tier 0+1 -- the machine-served page, zero-install from any
  browser on the LAN, doubles as the emergency surface (tokenless e-stop is
  role-exempt by design). SlopDrive-32 (archived, S3, 16 MB) shipped this
  first; Nucleus (P4) inherits the role.
  *(Amended 2026-09-26, §10.7: the hub-served page is the BACKUP delivery;
  parity with the shell may break. "ALL controls" now means every field
  stays reachable per RENDERING §12, not that every shell feature ships.)*
- **Hosted (the universal path):** a canonical community-hosted instance of
  the same client, served over **plain http** (deliberate -- see landmine
  below), for hubs that cannot or should not serve assets. The
  underpowered-reference-hardware hub is the motivating first-class target:
  limited, mediocre, fully legitimate -- "just because you don't have the
  capability to host HTTP doesn't mean you should suffer."
- **Shell (Tauri 2, the premium tier):** same bundle in a native frame,
  buying back what browsers confiscate: UDP hub discovery (SPEC §13.8,
  `src-tauri/src/discovery.rs` -- no web page can ever do this), no
  mixed-content wall, Tier 2 plugin loading from disk, and non-WS transports
  (Valence over BLE GATT, presented to the shared session code as a
  WebSocket-shaped transport -- `src/shell/ble-ws.js`, RFC-043's hub-side
  twin).

**Recorded landmine -- PWA is NOT a delivery vehicle.** PWAs require https to
install, and an https origin cannot open `ws://` to a LAN hub
(mixed-content). Until/unless hubs speak wss (TLS on ESP32-class hardware =
cert pain, explicitly not planned), the browser story is the plain-http
hosted page and the embedded page -- both of which work everywhere, including
iOS Safari. Nobody promises a PWA. If browsers eventually strangle
plain-http pages, the Shell is the pre-built exit.

```mermaid
flowchart TB
    start(["Start: a conformant Valence hub\n(WS live; BLE GATT + UDP discovery\nare the shell's transport story)"]):::startNode

    q1{"Can/should this hub\nserve UI assets?"}
    embedded["Embedded delivery\nTier 0+1, WS-only\nserved from the hub's own flash\ndoubles as the e-stop surface"]
    hosted["Hosted delivery\nTier 0+1, WS-only, plain http\none community URL\n(hubs with no serving capability)"]
    shell["Shell delivery (Tauri 2)\nTier 0+1+2\nWS or BLE GATT (ble-ws.js)\nUDP discovery, disk-loaded plugins"]

    start --> q1
    q1 -->|"yes"| embedded
    q1 -->|"no"| hosted
    start -.->|"premium tier,\nworks against ANY hub"| shell

    embedded -->|"QR code"| shell
    hosted -->|"QR code"| shell

    pwa["PWA"]:::deadend
    shell -.->|"https install requirement blocks\nws:// to a LAN hub (mixed-content)"| pwa

    classDef startNode fill:#2b6cb0,color:#fff,stroke:#2b6cb0,stroke-width:2px
    classDef deadend fill:#742a2a,color:#fff,stroke:#742a2a,stroke-dasharray: 4 3
```

Reading the diagram: the dashed edge into Shell says it is reachable
independent of the embedded/hosted decision -- any hub, WS or BLE, can be
opened directly from the Shell without going through a web page first. The
dashed edge into PWA is the recorded dead end: not a delivery path, a
landmine to not step on.

**The delivery accord (operator-blessed, 2026-07-27):** one Svelte kernel,
shipped two ways. The Phosphor app (Tauri; Android APK -- confirmed live in
this tree, `src-tauri/tauri.conf.json`'s `android` block + `src-tauri/icons/
android/` -- plus desktop installers; Play Store bans adult apps,
distribution is direct) is the canonical, feature-complete client:
BLE+WS, UDP discovery, Tier 2 plugins (planned), mobile-first per the
audience map (mainstream = mobile app; power users = desktop + MFP;
Intiface/VR = desktop streamer + mobile/hardware remote; owners of
underpowered reference hardware = the audience Valence exists to serve). The
embedded/hosted page is the same bundle built WS-only at Tier 0+1 -- served
from capable hubs' flash and from one community URL; it is the zero-install
onramp, guest/iOS surface, and emergency stop. The faces cross-promote (page
-> QR -> app). Divergence between targets is build configuration, never
code. The bar: discovery just works, the mobile app just works -- and if an
iOS store listing ever becomes possible, it just works too (the Tauri iOS
target stays buildable; no promises on Apple).
*(Amended 2026-09-26, §10.7: "divergence is build configuration, never code"
no longer binds where the served page lacks the host capability: window
chrome, the builder, the embedded buttplug server and plugins may be shell
code. "Mobile-first" is under review while the mobile layout is unresolved,
§10.9.)*

**Transport doctrine (same ruling):** Valence is the only protocol that
matters and is transport-agnostic (Valence SPEC.md §13); every hub SHOULD
expose both WS and BLE GATT on ESP32-class hardware. The legacy OSSM BLE
masquerade is EOL -- Valence-over-BLE replaces it, and Phosphor's Shell is
what speaks it client-side (browsers can't, portably). See
`../Nucleus/.claude/rules/transport.md` (transport doctrine) + Valence
RFC-043.

## 9. Framework ruling -- Svelte 5, with one piece of insurance

Svelte 5 is confirmed as the kernel framework (operator + agent concurrence,
2026-07-27). Rationale: the framework compiles away -- smallest runtime of
the mainstream options, which the flash-budgeted embedded build hard-requires;
fine-grained rune reactivity fits high-rate telemetry (25-60 Hz updates
without VDOM diffing); the existing catalog-driven client is already Svelte 5
and proven. React fails the embedded budget and the update model; Solid would
be a lateral move not worth a rewrite; Lit/web-components would tax Tier-1
widget DX.

**The insurance (binding on the Tier-2 API):** plugins are NOT Svelte
components. The plugin ABI is framework-neutral -- a plugin exports
`mount(slotEl, api)` / `unmount()` and ships self-contained; the kernel
treats it as a black box in its slot. This is what makes the C-6-style API
freeze survivable: Phosphor can upgrade Svelte majors without breaking one
plugin, and plugin authors can use any framework or none. Svelte's internals
never become public API. Realized as `activate(api)` plus a hero's
`mount(el, fields)` returning `{update, unmount}`, the api reaching the
mount by closure; see [PLUGINS.md](PLUGINS.md).

> DEMO-CANDIDATE: a minimal vanilla-JS plugin (`mount`/`unmount`, no
> framework at all) rendering one live-updating card, to prove the ABI
> insurance concretely -- no Svelte required to build a Tier-2 widget.

## 10. The builder (operator rulings 2026-09-26)

Phosphor is a UI builder. Valence is the framework behind it, optimized for
embedded controllers. Nothing below is coded yet. The phased plan is epic
`ph-e82`; status lives there, never here (C-2). Rulings still owed are on
`ph-e82.1` and `ph-e82.7` and are marked OPEN below.

### 10.1 The home page replaces Overview

- The home page is a user-arranged grid. It replaces the Overview tab
  (`src/App.svelte`: the `machine` tab and `machineItems`).
- Everything that lived only on Overview becomes a module or is deleted with
  C-9 proof: hero-rank leftovers, telemetry, card-zone heroes, loose actions.
- The derived category pages stay. Every field remains reachable without the
  home page (RENDERING §12: classes differ in projection, never in reachable
  content). The home is an additional surface, never the only path to a
  field.
- A home the user has not built is seeded from rank (RENDERING §4, hero
  surfaced; `ph-vdk.36`) plus the migrated layout of §10.6.
- Edit mode places, moves, resizes and deletes from a palette of every
  placeable control. Outside edit mode nothing drags (`DashItem.svelte`: the
  grab handle is the only draggable surface).
- Rests on RENDERING §12 and law 10. OPEN: it strains §11 ("pages are
  derived, never designed per app") and §9 ("region assignment is never a
  per-app choice"); reconciliation is `ph-e82.1`.

### 10.2 The control contract

- A CONTROL is one catalog field plus one presentation. Writable fields offer
  knob, slider, stepper, toggle; readouts offer number, bar, bulb, graph.
- The offered set comes from the field's archetype (RENDERING §8.2, §8.4) and
  its facts: bar needs bounds, toggle and bulb need a bool, graph needs a
  client-side history (gaps, never zeros: law 9). The user chooses how a
  field looks, never what it binds to (laws 6, 7).
- Seam: `src/model/settings.js` (`resolveArchetype`, `resolveWidget`,
  `WIDGET`, whose `segmented`/`bitfield`/`secret` already are presentations
  inside one archetype) and `src/ui/Field.svelte`.
- Every presentation keeps the universal contract: the four-state ladder with
  a text reason (law 5), graying with the gate named (law 3), stale dimming
  (law 8). An echo pair travels as one control and a tagged min/max pair is
  one range control (RENDERING §11; `mergeRangePairs` in `settings.js`).
- OPEN (`ph-e82.1`): a choice that crosses an archetype boundary (slider vs
  stepper, §8.2 rows 9/10; readout vs graph, rows 12/13 vs 15) against §8.2's
  first-match rule.
- Role-claiming composites are controls: rail hero, plan strip (nested in
  the rail per RENDERING §10 `plan-view`), pattern panel, limits. They place,
  resize and save like any control. Claim-or-decline is unchanged
  (`claimAll`, `src/model/roles.js`; law 7).
- Plugin widgets use the same contract. `registerHero`'s card-only zone
  (`src/plugins/host.js`) is superseded; §4's `renders` zones describe today's
  code only. The plugin API freeze (`ph-vdk.30`, §4) waits for this contract.
- Persisted keys are stable ids (law 10): a role when the field has one,
  else its uid; composites as `hero:<id>`. An id the catalog lacks stays
  inert in storage (`src/model/dashboard.svelte.js`). OPEN (`ph-e82.1`): a
  uid is channel id plus field name, which law 10 calls wire vocabulary.
- OPEN (`ph-e82.1`): single fields placeable anywhere, or only inside nests.

### 10.3 The top strip: safety and window chrome

- All safety controls live at the TOP. The bottom edge sits against the
  Windows taskbar, where a missed click is jarring; at the top there is
  nothing to hit by accident. Supersedes the bottom dock
  (`src/ui/SafetyBar.svelte`, `.safetydock`).
- NON-NEGOTIABLE: the top strip always carries an e-stop the user cannot
  remove. It is bound by safety-op identity (law 2; `fixedCtls` in
  `SafetyBar.svelte`), never scrolled or hidden (laws 1, 11; RENDERING §9
  `persistent`).
- Every safety op is also a placeable module. A second e-stop on the grid is
  fine; the strip's copy is the one that cannot go.
- The global refusal surface and the unattended chip (RENDERING §10.1 rule 3)
  stay in the strip, because it is the one surface always on screen.
- Phosphor replaces the OS title bar with its own decorations, and the shell
  bar merges into the strip. Seams: `src-tauri/tauri.conf.json` (window
  decorations), `src-tauri/capabilities/default.json` (window permissions),
  `src/shell/ShellBar.svelte`. Windows first; Android has no frame; the
  served page draws the strip without window controls.
- One strip, one top reserve, one safe-area owner (`.claude/rules/webui.md`
  T22). Safety colors stay unthemeable in the new chrome (law 13).

### 10.4 Full width

16:9-class windows use the full width. The `.app` cap (`max-width: 1680px`,
`src/style.css`) goes; prose keeps its measure. Absorbs `ph-gf8`'s width
half.

### 10.5 Grid, scale, resize

- Cells are square and sized in device pixels, about 32 to 40 at 3840x2160
  and 125 percent Windows scale, converted through `devicePixelRatio`. Cell
  count follows the window. Replaces the 12-column span model
  (`dashboard.svelte.js`, `DashItem.svelte`).
- A browser-style scale control multiplies the cell edge. It scales cells and
  tokens, never CSS `zoom` on a subtree holding a positional control, until a
  test proves `RailWidget`'s pointer mapping survives (`ph-gf8`).
- Under a coarse pointer the scale clamps so no hit target falls below the
  40 CSS px floor (law 12).
- Each control is resizable in cells and switches between vertical and
  horizontal control layout by its own aspect.
- Renderer-class selection (`src/model/rclass.js`, `viewport.svelte.js`) stays
  in CSS px and is independent of the grid.

### 10.6 Nests and layouts

- A NEST is a control holding a subgrid, scrolling or fixed. A nest with its
  contents is saveable as a reusable module; members the current catalog
  lacks stay inert.
- A scrolling nest never hides pending or degraded state (RENDERING §9): its
  frame carries the in-flight count, as `drillCard` does in `App.svelte`.
- LAYOUTS are named and saved per user per client, stored locally, with the
  try/catch degrade `dashboard.svelte.js` already uses. Sync is a later
  maybe, not planned.
- Migration: today's `phosphor.dash.<class>.<view>` maps and the legacy
  `sd32.dash.*` keys seed a layout named Default. Legacy keys are read, never
  written or deleted.

### 10.7 Delivery: the hub-served page is the backup

The shell is the primary delivery. The hub-served page is the BACKUP: the
zero-install onramp, the guest surface, the emergency stop. Parity with the
shell may break; the served page still meets every RENDERING §13 law and
keeps every field reachable. Amends §8's embedded ruling and its "divergence
is build configuration, never code" clause (amendments below). Seam:
`src/main.js`, the one delivery seam.

### 10.8 buttplug, embedded

- Phosphor embeds a buttplug server in the shell, not Intiface. Games and
  apps connect to Phosphor as an Intiface-compatible server.
- The machine is a buttplug device whose commands enter the kernel intent
  path (`submitMotion`, `src/plugins/host.js`, the TCode adapter's door).
  The Prime Rule holds on the machine side: one Valence session, no side
  channel. The buttplug fork's own Valence hardware manager
  (`buttplug_server_hwmgr_slopsync`, its own session) is not linked.
- Toys buttplug supports appear as modules under §10.2 and as relationship
  targets. OPEN, raised to the operator: relationships are hub policy that
  survives Phosphor closing (accessory rulings, same date), and a toy
  connected to Phosphor cannot be evaluated on the hub.
- The listener binds loopback. LAN exposure is `ph-vdk.28`'s ruling, the same
  question the TCode listener (`src-tauri/src/plugins.rs`) already raised.

### 10.9 Mobile: unresolved

OPEN (`ph-e82.7`). Likely the handheld class keeps an auto-built layout and
desktop gets the builder. Top-strip safety applies on phones unless the
operator rules otherwise.

## Amendments

| Date | Section | Change | Approved by |
|---|---|---|---|
| 2026-09-26 | §4 | `renders` zones (instrument, card) superseded by grid placement; plugin widgets are placeable controls (§10.2). | operator |
| 2026-09-26 | §4, §7 | Plugin API freeze re-timed behind the control contract (§10.2). | operator |
| 2026-09-26 | §8 | Hub-served page is the backup delivery; parity may break (§10.7). | operator |
| 2026-09-26 | §8 | "Divergence is build configuration, never code" no longer binds shell-only capabilities; "mobile-first" under review (§10.7, §10.9). | operator |
| 2026-09-26 | §10 | The builder rulings (§10.1 to §10.9) established. | operator |
