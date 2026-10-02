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
| Safety bar + anomaly log | safety STATE, motion-anomaly EVENT (`TopStrip.svelte`, `LogPane.svelte`'s anomaly tab) |
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
embedded controllers. The phased plan is epic `ph-e82`; status lives there,
never here (C-2). The phases landed on 2026-10-01 in these commits:

- (a) top strip, full width: `72203c4`.
- (b) grid, scale, named layouts: `e25b83c`.
- (c) control contract: `64796b7`; per-placement look (§10.2): `204480e`.
- (d) home page: `72f0b6a`.
- (e) nests and modules: `3af57d2`.
- (f) is the mobile ruling (`ph-e82.7`, §10.9), not code; nothing landed.
- (g) buttplug embed: `5e8d81d` (server pane), `5976718` (server and
  machine), `53fadf3` (toys as modules), `ee49622` (stop all toys),
  `185bc64` (per-device toy stop).

Rulings still owed are marked OPEN below (`ph-e82.7`; the relationship
question in §10.8).

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
- Rests on RENDERING §12 and law 10. CLOSED (operator ruling 2026-09-26,
  `ph-e82.1` item 1): saved layouts, including the home page, are NOT the
  catalog-built UI (§10.2). The catalog-built UI stays and earns its keep on
  hardware remote controls and embedded processors with screens and buttons;
  every field stays reachable through it regardless of any saved layout. The
  home is additional, never a replacement, which is what keeps §11 ("pages
  are derived, never designed per app") and §9 ("region assignment is never a
  per-app choice") true of the derived tree. Confirmed as coded (operator
  ruling 2026-10-01).
- As coded (`72f0b6a`): card-zone heroes (pattern, limits, plugin heroes)
  are home modules AND cards at the top of the category page their claimed
  fields came from (the `other` page when none is categorized); loose
  actions are a home module AND join the `other` overflow page (RENDERING
  §3), so nothing Overview showed is reachable only from the home. Home
  membership is the key set of the active layout's `<class>.machine`
  placement map plus every nest's members; a map with no plain key shows
  the seed. The view id stays `machine`, the id the migrated Default layout
  already holds. Telemetry is a home module only: it is not a field, and its
  lanes' fields are reachable elsewhere.

### 10.2 The control contract

- A CONTROL is one catalog field plus one presentation. The ARCHETYPE is
  picked by the catalog (RENDERING §8.2) and is NOT user-editable. Within it
  the user picks a presentation by READ/WRITE CLASS (operator ruling
  2026-09-26): any writable field may take any writable presentation (knob,
  slider, stepper, segmented, toggle, and so on); any read-only field may
  take any read-only presentation (number, bar, bulb, graph, hero numeral). A
  writable field may ALSO be placed as a read-only presentation, a
  display-only instance: the set speed inside a pattern shown as a hero
  numeral rather than a small control, for example.
- The offered set comes from the field's archetype (RENDERING §8.2, §8.4) and
  its facts: bar needs bounds, toggle and bulb need a bool, graph needs a
  client-side history (gaps, never zeros: law 9). The user chooses how a
  field looks, never what it binds to (laws 6, 7).
- Range presentations (knob, slider, stepper, bar) take PER-PLACEMENT min,
  max, step, default (operator ruling 2026-09-26). A placement may NARROW the
  catalog's bounds, never widen them; the default must lie inside the
  narrowed range. This narrowing rule is the orchestrator's reading of Ground
  Truth (law 4) and law 7: a placement never claims more range than the
  field's own essential binding supports, and it never hides a live value
  that falls outside the narrowed display window.
- A toggle placement is configured as two discrete values, each an ordinary
  echo-confirmed write (law 4). A momentary override-and-return mode was
  considered and WITHDRAWN (operator ruling 2026-09-26): a client-side
  restore that depends on the client surviving the press runs against the
  Valence principle that policy lives on the hub, and it does not earn its
  place. If a hold-to-run ever matters (an accessory pump held on), it is a
  hub-side write that reverts unless refreshed, and it rides an RFC.
- Seam: `src/model/settings.js` (`resolveArchetype`, `resolveWidget`,
  `WIDGET`, whose `segmented`/`bitfield`/`secret` already are presentations
  inside one archetype) and `src/ui/Field.svelte`.
- Every presentation keeps the universal contract: the four-state ladder with
  a text reason (law 5), graying with the gate named (law 3), stale dimming
  (law 8). An echo pair travels as one control and a tagged min/max pair is
  one range control (RENDERING §11; `mergeRangePairs` in `settings.js`).
- CLOSED (operator ruling 2026-09-26, `ph-e82.1`): resolved by the
  read/write-class rule above, not by §8.2's first-match row. Slider vs
  stepper and readout vs graph are both presentations inside one read/write
  class; the archetype §8.2 assigns is a catalog fact the user never edits.
- Role-claiming composites are controls: rail hero, plan strip (nested in
  the rail per RENDERING §10 `plan-view`), pattern panel, limits. They place,
  resize and save like any control. Claim-or-decline is unchanged
  (`claimAll`, `src/model/roles.js`; law 7).
- Plugin widgets use the same contract. `registerHero`'s card-only zone
  (`src/plugins/host.js`) is superseded; §4's `renders` zones describe today's
  code only. The plugin API freeze (`ph-vdk.30`, §4) waits for this contract.
- Persisted keys are stable ids (law 10): a role when the field has one,
  else its uid; composites as `hero:<id>`. An id the catalog lacks stays
  inert in storage (`src/model/grid.js`). A uid is channel id plus field
  name, which law 10 calls wire vocabulary; the Valence RFC-080 draft
  ("User-authored surfaces and presentation choice", item 6) carries the
  carve-out: the uid key is allowed for USER-AUTHORED SURFACES ONLY, never
  for the conformant derived baseline. RULED (operator, 2026-10-01,
  `ph-e82.1` item 3): uid keys stand as coded, `uid:<channel>:<field>` for
  a field with no role, inert when absent, never rebound. A role field's
  uid-form key (written by builds before `ph-e82.9`) resolves to the same
  control as its role key. Codes against the draft by ruling, as below.
- RULED (operator, 2026-10-01, `ph-e82.1` items 2 and 4): design as though
  RFC-080 is accepted.
  - `CROSS_ARCHETYPE` is true (`src/model/settings.js`): the palette offers
    the read/write-class set above, display-only instances included.
  - Per-placement narrowing (RFC-080 item 4) and two-valued toggles (item 5)
    are coded. A placement entry in the layout store carries an optional
    `look` {pres, min, max, step, default, a, b} beside {x, y, w, h}
    (`src/model/grid.js` `setLook`; the home's edit mode sets it,
    `src/ui/LookEditor.svelte`). An entry without `look` is valid and means
    the derived presentation on the catalog's bounds, so no saved layout
    migrates. `settings.js` `placementLook` is the one rule: narrow, never
    widen; a step is a whole multiple of the catalog step; the default lies
    inside the placement's range; a toggle's two values differ and lie inside
    the field's range (a bool, two or more options, or bounds); a refused part
    keeps the catalog's value and is named in words. A reported value outside
    a narrowed range is shown as it is and marked, never pinned (law 4).
  - Single fields: RFC-080 leaves placement open (its open question 3), so
    fields stay placeable anywhere (`FIELDS_NESTS_ONLY` false in `grid.js`).
  - C-5 flag, recorded: this codes against a DRAFT RFC (RFC-080, ruling
    pending as `rfc-94c`), against the never-code-against-an-unaccepted-clause
    rule, by operator ruling. If RFC-080 is rejected or amended, the builder
    follows it.

### 10.3 The top strip: safety and window chrome

- All safety controls live at the TOP. The bottom edge sits against the
  Windows taskbar, where a missed click is jarring; at the top there is
  nothing to hit by accident. Supersedes the bottom dock; the strip is
  `src/ui/TopStrip.svelte`.
- NON-NEGOTIABLE: the top strip always carries the e-stop and pause controls
  the user cannot remove (RENDERING law 1, RFC-085). Each is ONE control with
  two states (law 14; `src/ui/widgets/SafetyOp.svelte`): pause/resume, and
  estop/release, where release is the same control held 3 s and the latched
  state reads Halted. The e-stop reads E-Stop only on a hub whose WELCOME
  declares `estop_cuts_power` true, else Halt (law 15). Bound by safety-op
  identity (law 2), never scrolled or hidden (laws 1, 11; RENDERING §9
  `persistent`). No separate clear, release or resume button exists anywhere.
- Each strip pair is also a placeable module (`safety:estop`,
  `safety:pause`). A second e-stop on the grid is fine; the strip's copy is
  the one that cannot go. Override/return is not a module: it is the rail's
  (SPEC §11.1).
- Order, operator ruling 2026-10-02 (`ph-e82.21`): the e-stop is outermost
  at the far right, then Pause, Override, Flip and Home inward. Flip (SPEC
  §9.6) rides the strip beside Override, not the rail row, so the jog tape
  spans the rail edge for edge.
- Home is one control; any other home op (Force Home, where the hub offers
  it) lives in its popover, and the status slot carries no remedy button.
  While home is required (the snapshot's `home_required`, or a `NOT_HOMED`
  refusal until a home op echoes) Home pulses a `--bad` border. AMENDMENT to
  law 13's reading here, same ruling: red marks the e-stop AND this one
  safety-adjacent required act, nothing else; static under reduced motion.
- The global refusal surface and the unattended chip (RENDERING §10.1 rule 3)
  stay in the strip, because it is the one surface always on screen.
- Phosphor replaces the OS title bar with its own decorations, and the shell
  bar merges into the strip. Seams: `src-tauri/tauri.conf.json` (window
  decorations), `src-tauri/capabilities/default.json` (window permissions),
  `src/shell/ShellStrip.svelte`. Windows first; Android has no frame; the
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

- A NEST is a control holding a fixed subgrid that grows to fit its members.
  Nothing on the home or a category page scrolls or zooms on its own: no
  scrolling or folding nest, and a module that takes its own pointer and
  wheel (the node editor) is a still preview in the grid with Open (operator
  ruling 2026-10-02, `ph-e82.22`). A nest with its contents is saveable as a
  reusable module; members the current catalog lacks stay inert.
- The node editor's typed nodes, chains and add menu: [GRAPH.md](GRAPH.md).
- A nest's frame carries the in-flight count, as `drillCard` does in
  `App.svelte` (RENDERING §9, law 9), though every member is in view.
- Placements are absolute (same ruling): a card keeps the rect the user gave
  it, an add takes the first free rect, a remove leaves a hole, and nothing
  moves unless the user moves it. Compaction is gone; the flow survives only
  as the first-run seed (`src/model/grid.js` `place`, `pack`).
- Surfaces (same ruling): a card is one `--bg-card` surface with one frame, a
  nest one `--bg-sunken` surface holding cards, no third tint; titles are
  text on the page. `src/style.css` `.surface-card`, `.surface-nest`.
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
- RULED (operator, 2026-10-01): an app's stop or disconnect leaves the
  machine holding its last target; the hub e-stop stays the only latch. A
  client stop submits nothing and never maps to a safety op
  (`src/plugins/buttplug.js`; [BUTTPLUG.md](BUTTPLUG.md), Stop): apps stop
  on every disconnect, and a latched stop would need an operator clear each
  time.
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
| 2026-09-26 | §10.1, §10.2 | Presentation-by-read/write-class rule, range-narrowing rule recorded; a momentary toggle mode was considered and withdrawn the same day (toggles are two-valued). Home-vs-derived-pages question closed: the home is additional, the catalog-built UI stays canonical. Law 10 uid carve-out and the presentation rule handed to a draft Valence RFC ("User-authored surfaces and presentation choice"). | operator |
| 2026-10-01 | §10.2 | Design as though RFC-080 is accepted: read/write-class presentations on (`CROSS_ARCHETYPE`), per-placement `look` (range narrowing, two-valued toggles) carried in the layout store, single fields placeable anywhere (RFC-080 leaves it open). Codes against a DRAFT RFC by ruling; C-5 flag recorded in §10.2. | operator |
| 2026-10-01 | §10.8 | An app's stop or disconnect leaves the machine holding its last target; the hub e-stop stays the only latch. | operator |
| 2026-10-01 | §10, §10.1, §10.2 | `ph-e82.1` items 1 (the home is an additional surface) and 3 (uid keys for unroled fields, inert when absent) confirmed as coded; the "nothing coded yet" note replaced by the per-phase commit list; §10.1 records the home's coded decisions. | operator |
| 2026-10-02 | §10.6 | Nests are fixed and grow to fit (scroll and fold retired); nothing on the home or a category page scrolls on its own; placements are absolute; two surfaces, card and sunken nest; the scale control moves into the edit-mode Layout menu (`ph-e82.22`). | operator |
| 2026-10-02 | §10.3 | RFC-085: the strip's mandatory pair is e-stop plus pause, each one two-state control (hold-to-release, Halted, Halt label without `estop_cuts_power`); stop, hold and every clear button retired; modules are one per pair (`ph-e82.12`). | operator (RFC-085 ruling) |
