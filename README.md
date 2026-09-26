# Phosphor

**Valence Phosphor** — the reference client of the [Valence](../Valence)
protocol. One Svelte 5 app, two deliveries:

- **the page a hub serves.** A hub bundles `dist/index.html` (one file: JS, CSS
  and fonts all inlined, gzipped beside it) into its own flash and serves it
  from its own origin. The page mints its control token from a same-origin
  `/uitoken`, so opening a hub's address is all it takes.
- **the desktop/mobile shell.** The same bundle inside a Tauri 2 window. Here
  the host is the operator's choice, found by the SPEC §13.8 UDP discovery
  probe (`src-tauri/src/discovery.rs`) or typed in, and `/uitoken` is minted by
  the Rust side rather than the browser — no same-origin rule to satisfy, so a
  shell session lands at **control** tier instead of watch. It also speaks BLE
  (`tauri-plugin-blec`), which a browser page cannot.

The seam between the two is `src/main.js` and nothing else. Everything above it
renders whatever catalog the hub sent.

## Zero device knowledge

Phosphor binds to **protocol vocabulary**, never to one machine. No channel-id
literals, no field names lifted from a particular catalog — the UI is built
from the catalog at runtime, and the hub's `field_roles` say which knob is the
speed ceiling. `test/check-device-knowledge.mjs` enforces this mechanically and
gates `npm run build`.

That is why Phosphor is the *reference* client rather than one machine's front
panel: point it at any conformant hub and it renders.

## Run it

```sh
npm install

npm run dev                  # http://localhost:5173
npm run dev                  # then open /?hub=<hub-ip> to drive a real hub
                             #   (watch tier: /uitoken stays same-origin)

npm run build                # runs the checks, then dist/index.html + .gz
npm run build:only           # skip the checks

npm run tauri dev            # the shell, live-reloading against vite
npm run tauri build          # bundled installers under src-tauri/target/release/bundle/
```

### Tests

Plain `node` scripts, no framework. `npm test` runs every device-free suite in
order and stops on the first failure (the `build` gate runs `npm run check`,
its first half):

| command | needs |
|---|---|
| `node test/check-device-knowledge.mjs` | nothing |
| `node test/check-registry-pins.mjs` | nothing |
| `node test/settings-model.test.mjs` | nothing |
| `node test/plugins.test.mjs` | nothing — plugin host, no device, no browser |
| `node test/valence-wire.test.mjs` | nothing — golden bytes + the catalog fixture |
| `node test/telebuf-sim.mjs` | nothing — the T18 timeline regression |

`npm run test:browser` runs the Playwright suites, still with no device:

| command | needs |
|---|---|
| `npm run check:shell` | Playwright (bundled), no device |
| `npm run check:dash` | Playwright (bundled), no device |
| `npm run check:responsive` | Playwright (bundled), no device |

Everything below is a live probe or bench script, run by hand and never part
of `npm test`. None of them carry a baked default host any more (ph-vdk.21) —
name the hub every time.

| command | needs |
|---|---|
| `node test/valence-live.mjs --ip <host> [--port 82]` | a hub at `<host>:82` |
| `node test/valence-auth.mjs --ip <host> [--port 82]` | a hub at `<host>:82` |
| `node test/valence-modes.mjs <host>` | a hub at `<host>:82` — fails against valencesim today (Nucleus val-091.11, motion writes) |
| `node test/valence-tuning.mjs <host>` | a hub at `<host>:82` — fails against valencesim today (val-091.12, pattern engine) |
| `node test/valence-writeplane.mjs <host> [port]` | a hub at `<host>:82` |
| `node test/tap-to-move-live.mjs <host>` | a hub at `<host>:82`, commands real moves |
| `node test/model-vs-device.mjs <host>` | a hub at `<host>:82` |
| `node test/position-jitter-probe.mjs <host> ...` | a hub at `<host>:82`, commands real moves |
| `node test/streamed-outlier-probe.mjs <host> [durationMs]` | a hub at `<host>:82`, commands real moves |
| `node test/rail-probe.mjs <host>` | a hub at `<host>:82`, machine already moving |
| `node test/wire-forensics.mjs <host>` | a hub at `<host>:82`, machine already moving |
| `node test/render-vs-samplerate-probe.mjs` | pre-captured `test/evidence/trace-{30,25}hz.json`, produced by `position-jitter-probe.mjs` against a live hub |
| `node test/browser-check.mjs <host>` | a hub serving the deployed bundle, plus a browser |
| `node test/flagship-render-smoke.mjs <host>` | a hub serving the deployed bundle, plus a browser |
| `node test/jitter-measure.mjs <host> [durationMs]` | a hub serving the page, plus a browser |
| `node test/og-reference-shots.mjs [baseUrl] [outDir]` | a static server for the OG (main-branch) bundle, plus a browser — not a Valence hub |
| `node test/valence-sim.mjs [--host] [--port]` | the device twin, `../Nucleus/sim/valencesim/build/valencesim.exe` — fails today (val-091.11/.12) |
| `node test/pairing-roundtrip.mjs` | the device twin, `../Nucleus/sim/valencesim/build/valencesim.exe` |

`test/fixtures/valencesim-catalog.{bin,etag}` is captured from the device
twin, not hand-copied from Valence: build `../Nucleus/sim/valencesim` (its own
README has the recipe), run it, then `node test/valence-sim.mjs` — its last
step writes both files from that session's real BLOB_CHUNK bytes and the etag
the hub declared. Never hand-edit the `.bin`; re-run the sim to re-capture it.

## Its relatives

| repo | what it is | how Phosphor touches it |
|---|---|---|
| [`../Valence`](../Valence) | the protocol: SPEC, registry, conformance, the JS client | **imported directly** — every `import` of `../../Valence/clients/js/*` is a live relative path to the sibling checkout. Read-only from here; changes there are RFCs. |
| `../Nucleus` | the reference hub (the machine's firmware) | nothing at build time. `test/check-device-knowledge.mjs` reads its catalog header *if present*, to harvest the field names Phosphor must not know. Its `sim/valencesim` is what the device tests talk to. |

Both must sit beside this repo in the same parent directory. There is no
package, no pin and no vendored copy: Phosphor tracks the sibling working tree,
which is the point during development.

Tier-2 plugins (shell-loaded, plus a dev-only `?plugin=` path): [docs/PLUGINS.md](docs/PLUGINS.md).

Carved out of the archived `SlopDrive-32` machine repo (`webui/`), where it was
called SlopDeck. Doctrine lives in `.claude/rules/`; volatile truth lives on the
dev board (`bd`, prefix `ph`).

Design rulings: [`docs/DESIGN.md`](docs/DESIGN.md).
The builder (home page, controls, nests, layouts; 2026-09-26): [`docs/DESIGN.md` §10](docs/DESIGN.md#10-the-builder-operator-rulings-2026-09-26).
