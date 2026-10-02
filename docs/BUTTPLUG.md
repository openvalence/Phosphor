# Embedded buttplug server

Implementation notes for the buttplug server inside the shell. The ruling
(embed, the machine through the intent path, loopback only, toys as modules)
is [DESIGN.md](DESIGN.md) §10.8 and is not restated here. Status lives on
the dev board (`ph-e82.8`).

## Pieces

| piece | where | what |
|---|---|---|
| server | `src-tauri/src/buttplug.rs` | buttplug's `ButtplugServer` over the fork's websocket server transport, one client at a time (as Intiface), JSON message spec v0 to v4 |
| machine | same file, `Machine*` | an in-process hardware manager presenting exactly one device while the webview reports a live hub |
| protocol | fork, `protocol_impl/valence.rs` + `protocols/valence.yml` | the machine as one linear axis: LinearCmd (v3) / HwPositionWithDuration (v4), position steps 0..`POSITION_STEPS`, duration 0..65535 ms |
| toys | fork's btleplug, serial and hid managers | found on scan, listed as kind `toy`; commanded through `Run::op`, an in-process server over the same device manager. Relationships wait on the DESIGN §10.8 flag |
| toy modules | `src/plugins/buttplug-toys.js`, `src/ui/hero/ToyModule.svelte` | one plugin hero per toy on the `buttplug` adapter, placeable as `hero:plugin:buttplug:<key>` |
| bridge | `src/plugins/buttplug.js` | a built-in adapter on the plugin host: `bp://motion` into `api.submitMotion` under the `motion` permission, hub presence into `bp_machine_present` |

The fork is a path dependency (`../../ButtplugIO`, branch `valence`). Its
own Valence hardware manager (`buttplug_server_hwmgr_valence`, a second
session) is not linked. Desktop only: the buttplug crates are not built for
Android or iOS.

## IPC contract

Commands (all async):

| command | returns |
|---|---|
| `bp_status()` | `{running: bool, port: u16, clients: u32, scanning: bool}` |
| `bp_start(port: u16)` | binds `127.0.0.1:port` (12345, Intiface Central's default, is the expected value); errors if the port is taken or 0. Restarts if already running |
| `bp_stop()` | closes the listener, disconnects every device |
| `bp_scan_start()`, `bp_scan_stop()` | toy scanning; errors if the server is not running |
| `bp_devices()` | `[{index, key, name, kind: "machine" \| "toy", connected: bool, features: [string], controls: [control]}]`, `[]` when stopped. `features` are buttplug output/input type names, e.g. `HwPositionWithDuration`. `key` is protocol plus address in `[a-z0-9-]`, stable across sessions on one host (BLE addresses differ per platform) |
| `bp_machine_present(present: bool)` | the webview's hub link went live (true) or away (false) |
| `bp_toy_scalar(index, feature, value: i32)` | the feature's scalar output (vibrate, oscillate, constrict, spray, temperature, led, position) to `value` steps |
| `bp_toy_rotate(index, feature, speed: i32)` | rotate at `speed` steps; the sign is the direction |
| `bp_toy_linear(index, feature, position: u32, ms: u32)` | HwPositionWithDuration: reach `position` steps over `ms` |
| `bp_toy_stop(index)` | upstream StopCmd for that toy alone, outputs only (sensor subscriptions survive), write acknowledged (bounded at 1 s) |
| `bp_toy_read(index, feature, input: string)` | one reading (`Battery`, `Rssi`, `Button`, `Pressure`) as an integer |
| `bp_stop_all()` | upstream StopCmd for every device, each write acknowledged (bounded at 1 s) |
| `bp_settings()` | the saved settings: `{port: u16, start_on_launch: bool, ble: bool, serial: bool, hid: bool, machine: bool, log_level: "error" | "warn" | "info" | "debug"}` |
| `bp_settings_set(settings)` | saves the whole record and returns it as saved. Errors (nothing saved) on port 0, an unknown level, a failed write, or a changed port or manager while running |

The `bp_toy_*` commands resolve on the server's answer: `null` (or the
reading) on its Ok, its error message as a string otherwise (not running, no
such device or feature, the wrong kind for that feature, a value outside the
range, the device gone). All of them refuse the machine.

A control is `{feature, description, kind, type, range?, ms?}`, one per
feature with an output, plus one per readable input:

| kind | type | range | command |
|---|---|---|---|
| `linear` | `HwPositionWithDuration` | position steps; `ms` the duration range | `bp_toy_linear` |
| `rotate` | `Rotate` | signed speed steps | `bp_toy_rotate` |
| `scalar` | the output type name | steps | `bp_toy_scalar` |
| `sensor` | the input type name | none | `bp_toy_read` |

A feature with several outputs gets one control: linear over rotate over
scalar, scalar in upstream's stop order. Steps are the device-list step
ranges; upstream maps them onto the hardware.

Events:

| event | payload |
|---|---|
| `bp://status` | same as `bp_status` |
| `bp://devices` | same as `bp_devices` |
| `bp://log` | `{level, msg}` |
| `bp://motion` | `{position: f64 0..1, ms: u32}` or `{stop: true}` |
| `bp://output` | `{index, feature, type, value}`: an output a toy applied, from any client (an app, a stop, a module); never the machine |

The server starts with the shell only when `start_on_launch` is saved;
otherwise the shell calls `bp_start`. `port` in `bp_status` reads the saved
port until a start says otherwise. `clients` is 0 or 1.

Settings live in `settings.json` under the app config dir (`buttplug/`); an
unreadable or out-of-range file starts from the defaults (port 12345, every
manager on, `info`, no start on launch) with a warning in the log. The
managers (`ble`, `serial`, `hid`, `machine`) are the ones the next start
builds; the port and the managers are refused while the server runs, so the
saved settings always describe the running server. `log_level` and
`start_on_launch` apply at once. `bp://log` carries the server's own lines
and, where Phosphor owns the process logger (release builds; tauri-plugin-log
owns it in debug builds), upstream's `buttplug*` log lines, both filtered at
`log_level`.

Not offered: Intiface's "allow raw messages". The server speaks buttplug
spec v4, and neither it nor the fork implements raw read/write commands in
any spec version, so the setting would drive nothing.

## Behavior notes

- **Position.** Upstream turns a LinearCmd float into a device step by
  rounding UP (`calculate_scaled_float`), so a position arrives within one
  step (1/10000) of what the app sent; TCode-representable values (up to
  four digits) arrive exactly or one step high. `bp://motion` carries the
  fraction of the full stroke window; the motion door maps it onto the
  window and the hub clamps it, as for TCode.
- **Duration.** `ms` is the app's transit time. The motion door turns it
  into the stream sample's lead, capped by the hub's
  `max_future_schedule_ms`, or drops it on the setpoint fallback
  ([PLUGINS.md](PLUGINS.md), Motion input).
- **Stop.** buttplug sends no hardware write to stop a position-only device,
  so the server reads stops off the client stream: StopDeviceCmd for the
  machine, StopAllDevices, a v4 StopCmd, and a client disconnect each emit
  `{stop: true}`. The bridge submits nothing for it, so the machine holds at
  its last target. A stop is NOT a Valence safety op: apps send stops on
  every disconnect, and a latched `stop` would need an operator clear each
  time. Ruled (operator, 2026-10-01, [DESIGN §10.8](DESIGN.md)): an app's
  stop or disconnect never maps to a safety op. The operator's strip pause
  and e-stop are the only latches (RFC-085).
- **Pause and e-stop.** The hub's latch (safety 0x0003) is the gate: under
  PAUSE it drops stream bundles, counted and never NACKed (SPEC §11.1). So
  that the drop is never silent, the motion door also refuses every payload
  while the REPORTED latch shows PAUSE or ESTOP, with "paused, resume to
  continue", logged once (ph-vdk.42). Nothing re-arms on its own: no app
  command and no stream data sends `resume`; motion flows again only after
  the operator's Resume on the strip. `test/buttplug-bridge.test.mjs` (e)
  covers the local refusal; `test/buttplug-estop-sim.mjs` builds its door
  without it and proves the hub latch alone stops a live stream in
  valencesim.
- **Hub presence** is the webview's link phase (`live`), polled at 2 Hz.
  Disabling the `buttplug` adapter in the Plugins pane withdraws the
  machine. That toggle is not yet persisted across restarts for this
  built-in.
- **Machine identity.** The device is protocol `valence`, websocket
  specifier name `valence`, address `phosphor-machine`, display name
  `Valence Machine` (from `valence.yml`).
- **Device config version.** The fork's device-config build bumps
  `version.yaml` only when a protocol file changes; a consumer build with
  unchanged protocols leaves the fork clean.

- **Toy modules.** Each toy in `bp_devices` registers a plugin hero on the
  `buttplug` adapter with id `key`, so it places, resizes and persists
  like any plugin hero, and an absent toy's placement stays inert. A toy the
  list drops is withdrawn (`registerHero` returns the withdraw function); a
  changed listing re-registers. The heroes ride the claim pass, so they appear
  only while a hub catalog is adopted.
- **Toy ladder.** A module command is pending (showing the request) until the
  command resolves: applied on Ok, fault with the error text, overdue after 4
  s. One command per control is in flight, the latest queued. Ok means the
  server range-checked and applied it; toys report no state, so the shown
  value follows `bp://output`, which also carries what an app or a stop did
  to the toy. A value the server never reported reads `no value yet` (law
  9). `bp://output` carries the device value: a toy whose user config
  narrows its range shows a value offset from the steps the module sent.
- **Toy stops.** The strip e-stop is hub safety and does not reach toys. Each
  module has its own Stop (`bp_toy_stop`, which also drops a queued
  command), and `bp_stop_all` stops every toy. Both are upstream's stop
  set (a zero per stoppable feature; position outputs hold). A StopCmd
  naming one device stopping only that device needs the fork at 36110484
  or later; before it, any one-device stop, an app's StopDeviceCmd
  included, stopped every device.
- **Sensors** are read on mount and every 30 s; a failed read keeps the last
  value dimmed, with the reason (law 8).

## Tests

- `cargo test` in `src-tauri`: `linear_cmd_maps_like_the_tcode_adapter`
  (LinearCmd over loopback lands as the TCode adapter's mapping of the same
  L0/I input), `loopback_client_reaches_the_fake_kernel` (JSON v3 client:
  handshake, RequestDeviceList returns the machine, LinearCmd and
  StopDeviceCmd reach the event sink, hub loss removes the machine).
- `cargo test` toys: upstream simulated devices (2-motor vibrator, rotator,
  stroker) stand in for BLE hardware, all three and the machine connecting
  in one scan (distinct indices, fork b898a4d1). `scalar_toy_commands_and_stops`,
  `rotate_toy_and_stop_all`, `linear_toy_takes_position_and_duration`:
  each command lands as the device's applied output on `bp://output`,
  refusals resolve as errors, the machine is refused, a toy stop zeroes that
  toy and leaves a running rotator alone, stop-all zeroes every toy. No simulated device has a sensor; reads are covered on the JS side.
- `cargo test` settings: `settings_persist_and_gate_the_managers` (saved to
  and read back from the file, refusals change nothing, the machine manager
  off leaves the machine out, port and managers refused while running, lines
  below the level dropped).
- `node test/buttplug-bridge.test.mjs`: the webview half through the real
  plugin host.
- `node test/buttplug-toys.test.mjs`: module registration and withdrawal
  through the real plugin host, the command mapping and ladder, echoes,
  stop and sensors, with a fake invoke/listen.
- `node test/buttplug-estop-sim.mjs`: the e-stop latch over a live stream,
  against valencesim.
- Fork: `cargo test -p buttplug_server valence` (payload round trip, the
  yml range equals `POSITION_STEPS`).
