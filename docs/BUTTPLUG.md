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
| toys | fork's btleplug, serial and hid managers | found on scan, listed as kind `toy`; modules and relationships wait on part 2 of `ph-e82.8` |
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
| `bp_devices()` | `[{index, name, kind: "machine" \| "toy", connected: bool, features: [string]}]`, `[]` when stopped. `features` are buttplug output/input type names, e.g. `HwPositionWithDuration` |
| `bp_machine_present(present: bool)` | the webview's hub link went live (true) or away (false) |

Events:

| event | payload |
|---|---|
| `bp://status` | same as `bp_status` |
| `bp://devices` | same as `bp_devices` |
| `bp://log` | `{level, msg}` |
| `bp://motion` | `{position: f64 0..1, ms: u32}` or `{stop: true}` |

The server does not start by itself; the shell calls `bp_start`. `port` in
`bp_status` reads 12345 until a start says otherwise. `clients` is 0 or 1.

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
  time. Whether an app stop should map to `safety_intent_ops::stop` is an
  open operator ruling.
- **E-stop.** No client-side gate: the hub's latch (safety 0x0003) refuses
  the motion, whoever sends it. `test/buttplug-estop-sim.mjs` streams
  through the real adapter and motion door into valencesim, asserts an
  e-stop mid-stream, and checks the machine stops moving while payloads
  keep arriving.
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

## Tests

- `cargo test` in `src-tauri`: `linear_cmd_maps_like_the_tcode_adapter`
  (LinearCmd over loopback lands as the TCode adapter's mapping of the same
  L0/I input), `loopback_client_reaches_the_fake_kernel` (JSON v3 client:
  handshake, RequestDeviceList returns the machine, LinearCmd and
  StopDeviceCmd reach the event sink, hub loss removes the machine).
- `node test/buttplug-bridge.test.mjs`: the webview half through the real
  plugin host.
- `node test/buttplug-estop-sim.mjs`: the e-stop latch over a live stream,
  against valencesim.
- Fork: `cargo test -p buttplug_server valence` (payload round trip, the
  yml range equals `POSITION_STEPS`).
