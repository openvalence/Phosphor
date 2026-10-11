# Phosphor

**Valence Phosphor** is the reference client of the [Valence](../Valence)
protocol. It is one Svelte 5 app, delivered two ways:

- **the page a hub serves.** A hub bundles `dist/index.html` (one file: JS, CSS
  and fonts all inlined, gzipped beside it) into its own flash and serves it
  from its own origin. The page mints its control token from a same-origin
  `/uitoken`, so the page needs no other setup.
- **the desktop/mobile shell.** The same bundle inside a Tauri 2 window. Here
  the host is the operator's choice, found by the SPEC §13.8 UDP discovery
  probe (`src-tauri/src/discovery.rs`) or typed in, and `/uitoken` is minted by
  the Rust side rather than the browser. There is no same-origin rule to satisfy, so a
  shell session lands at the **control** access tier instead of watch. It also speaks BLE
  (`tauri-plugin-blec`), which a browser page cannot.

The two deliveries differ only in `src/main.js`. The rest of the app renders
the catalog the hub sends.

## Device independence

Phosphor binds only to **protocol vocabulary**. Its source contains no
channel-id literals and no field names taken from a particular catalog. The UI is built
from the catalog at runtime, and the hub's `field_roles` say which knob is the
speed ceiling. `test/check-device-knowledge.mjs` enforces this mechanically and
gates `npm run build`.

## Development

```sh
npm install

npm run dev                  # http://localhost:5173
npm run dev                  # then open /?hub=<hub-ip> to drive a real hub
                             #   (watch access tier: /uitoken stays same-origin)

npm run build                # runs the checks, then dist/index.html + .gz
npm run build:only           # skip the checks

npm run tauri dev            # the shell, live-reloading against vite
npm run tauri build          # bundled installers under src-tauri/target/release/bundle/
```

Neutrino, the built-in machine (the hub firmware as wasm), is vendored in
`src/model/integral/`; [docs/BUILD.md](docs/BUILD.md) has its pin and rebuild.

### Tests

The tests are plain `node` scripts with no test framework. `npm test` runs every device-free suite in
order and stops on the first failure (the `build` gate runs `npm run check`,
its first half):

| command | needs |
|---|---|
| `node test/check-device-knowledge.mjs` | nothing |
| `node test/check-registry-pins.mjs` | nothing |
| `node test/settings-model.test.mjs` | nothing |
| `node test/plugins.test.mjs` | nothing -- plugin host, no device, no browser |
| `node test/valence-wire.test.mjs` | nothing -- golden bytes + the catalog fixture |
| `node test/telebuf-sim.mjs` | nothing -- the T18 timeline regression |

`npm run test:browser` runs the Playwright suites, still with no device.

| command | needs |
|---|---|
| `npm run check:shell` | Playwright (bundled), no device |
| `npm run check:dash` | Playwright (bundled), no device |
| `npm run check:responsive` | Playwright (bundled), no device |

`npm run check` and `npm run test:browser` run their suites in parallel
(`SUITES_PARALLEL` sets the width, default 8). `check:serial` and
`test:browser:serial` are the one-at-a-time chains and the suite lists the
runner reads.

Everything below is a live probe or bench script, run by hand and never part
of `npm test`. None has a default host (ph-vdk.21): pass the hub
every time.

| command | needs |
|---|---|
| `node test/valence-live.mjs --ip <host> [--port 82]` | a hub at `<host>:82` |
| `node test/valence-auth.mjs --ip <host> [--port 82]` | a hub at `<host>:82` |
| `node test/valence-modes.mjs <host>` | a hub at `<host>:82` -- fails against valencesim today (Nucleus val-091.11, motion writes) |
| `node test/valence-tuning.mjs <host>` | a hub at `<host>:82` -- fails against valencesim today (val-091.12, pattern engine) |
| `node test/valence-writeplane.mjs <host> [port]` | a hub at `<host>:82` |
| `node test/tap-to-move-live.mjs <host>` | a hub at `<host>:82`, commands real moves; with no host, its own sim (`check:taptomove` in `test:browser`) |
| `node test/model-vs-device.mjs <host>` | a hub at `<host>:82` |
| `node test/position-jitter-probe.mjs <host> ...` | a hub at `<host>:82`, commands real moves |
| `node test/streamed-outlier-probe.mjs <host> [durationMs]` | a hub at `<host>:82`, commands real moves |
| `node test/rail-probe.mjs <host>` | a hub at `<host>:82`, machine already moving |
| `node test/wire-forensics.mjs <host>` | a hub at `<host>:82`, machine already moving |
| `node test/render-vs-samplerate-probe.mjs` | pre-captured `test/evidence/trace-{30,25}hz.json`, produced by `position-jitter-probe.mjs` against a live hub |
| `node test/browser-check.mjs <host>` | a hub serving the deployed bundle, plus a browser; with no host, its own sim (`check:browsercheck` in `test:browser`) |
| `node test/flagship-render-smoke.mjs <host>` | a hub serving the deployed bundle, plus a browser; with no host, its own sim (`check:flagship` in `test:browser`) |
| `node test/jitter-measure.mjs <host> [durationMs]` | a hub serving the page, plus a browser |
| `node test/og-reference-shots.mjs [baseUrl] [outDir]` | a static server for the OG (main-branch) bundle, plus a browser -- not a Valence hub |
| `node test/valence-sim.mjs [--host] [--port]` | the simulator (valencesim), `../Nucleus/sim/valencesim/build/valencesim.exe` -- fails today (val-091.11/.12) |

`test/fixtures/valencesim-catalog.{bin,etag}` is captured from the simulator
(valencesim), not hand-copied from Valence: build `../Nucleus/sim/valencesim` (its own
README has the recipe), run it, then `node test/valence-sim.mjs`. Its last
step writes both files from that session's real BLOB_CHUNK bytes and the etag
the hub declared. Never hand-edit the `.bin`; re-run the sim to re-capture it.

### The Neutrino cluster

`test/cluster/cluster.mjs` runs many Neutrinos at once against scripted
clients, by hand, never in `npm test`; its head has the usage. The two
oscillator suites beside it (`home-osc`, `player-osc`) run in `test:browser`.

How the Neutrino cluster works: `node test/cluster/cluster.mjs` starts worker
threads, at most one per physical core (`--max-workers`, default half the
logical cores), and spreads its hubs across them, `--per-worker` (default 32)
each until that cap, then more per worker. Each hub is one Neutrino wasm
instance (one compiled module per worker). Each worker ticks all its hubs on a
real-time 1 ms tick (`--tick-us`) polled against the wall clock or, with
`--lockstep`, on a virtual 1 ms clock as fast as it can. Each hub gets one
scripted client (about a third get two): a headless valence-js session with a
seeded personality that picks random actions from the hub's catalog (streams,
jogs, safety, home, trial writes, limits, the oscillator, reconnects) over an
impaired link, with latency and jitter on every frame and loss and reorder on
motion STREAM frames, all on the worker's clock. It measures, per worker, the
tick lateness (p50, p99, max) and the loop's work share in real time, or the
speed in sim-minutes per wall-minute in lockstep; for the process, CPU, host
CPU, RSS and wasm memory; per hub per minute, the plans, anomalies by kind,
failures, NACKs, refusals, reaps, stalls, timeouts, traps and the hub's warn
and error lines. A real-time step is healthy while its median minute's p99
lateness stays at or under 4 ms with no trap, and the first unhealthy step is
the knee; a lockstep step is healthy with no trap and has no knee. Results go
to `test/evidence/cluster/<time>/` (gitignored): `step-<hubs>.json` per step,
`long-<hubs>.json` for `--long`, and `summary.json` (its `mode` is `realtime`
or `lockstep`), which also names the clean hubs with the most of each anomaly
kind, the candidates for a hardware replay. `--replay SEED` reruns one hub
alone with the same options and client seeds, in lockstep (the same run every
time, but for the session ids the hub mints) unless `--realtime`, and writes
its trace to `test/evidence/cluster/replay-*.json`.
To compare a seed against hardware, the operator runs
`--replay SEED --target ws://HUB:PORT/` on the real hub (hw-safe: trial writes
only, no force home), then `--replay SEED --hw-safe --like HW.json` on
Neutrino from that hub's settings, and
`node test/cluster/compare.mjs NEUTRINO.json HW.json` scores the two traces
(exit 0 when every row passes).

Real time or lockstep:

- Real time is the timing stress, the only mode whose tick lateness means
  anything. It holds up to about 1,500 hubs on a 16-core, 32-thread PC; past
  that a worker's work outgrows its core, and more workers than physical cores
  lose the 1 ms tick.
- Lockstep is for logic bugs at any hub count. Every hub runs exactly as
  `--replay SEED` runs it (the replay's 45 Hz plan and 60 Hz motion
  subscriptions, the seed's own Math.random stream and async context), so a
  seed it flags replays alone to the same per-minute counters and flags. More
  hubs only make it slower: 2048 hubs on 16 workers run about 0.5 sim-minutes
  per wall-minute. Its counters do not compare with a real-time run's, which
  subscribes at 10 Hz plan and 20 Hz motion.

## Builds

Windows, macOS (aarch64) and Linux bundles, plus a Flatpak, an Android build and the SignPath-signed Windows installer: local recipes, what CI
(`.github/workflows/build.yml`) produces and what it needs on the remote are
in [docs/BUILD.md](docs/BUILD.md).

## Sibling repos

| repo | what it is | how Phosphor touches it |
|---|---|---|
| [`../Valence`](../Valence) | the protocol: SPEC, registry, conformance, the JS client | **imported directly**: every `import` of `../../Valence/clients/js/*` is a live relative path to the sibling checkout. Read-only from here; changes there are RFCs. |
| `../Nucleus` | the reference hub (the machine's firmware) | nothing at build time. `test/check-device-knowledge.mjs` reads its catalog header *if present*, to harvest the field names Phosphor must not know. Its `sim/valencesim` is what the device tests talk to. |

Both must sit beside this repo in the same parent directory. Phosphor uses the sibling working trees directly, with no package, pin or
vendored copy (CI uses Nucleus's `valence.pin`; see docs/BUILD.md).

Plugins (tier 2, DESIGN §3; shell-loaded, plus a dev-only `?plugin=` path): [docs/PLUGINS.md](docs/PLUGINS.md).

Doctrine lives in `.claude/rules/`; volatile truth lives on the dev board
(`bd`, prefix `ph`).

Design rulings: [`docs/DESIGN.md`](docs/DESIGN.md).
The builder (home page, controls, nests, layouts; 2026-09-26): [`docs/DESIGN.md` §10](docs/DESIGN.md#10-the-builder-operator-rulings-2026-09-26).

## License

Apache-2.0 ([`LICENSE`](LICENSE)), except the Advanced Penetration plugin
(`plugins/factory/advanced-penetration/`, a port of fray-d's OSSM-Lite), which
stays CERN-OHL-S-2.0 as its own component. Third-party notices: [`NOTICE.md`](NOTICE.md).
