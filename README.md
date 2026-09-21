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

Plain `node` scripts, no framework. `npm run check` (the `build` gate) runs the
two that need nothing but the repo:

| command | needs |
|---|---|
| `npm run check` | nothing — device-knowledge scan + settings model |
| `node test/valence-wire.test.mjs` | nothing — golden bytes + the catalog fixture |
| `node test/telebuf-sim.mjs` | nothing — the T18 timeline regression |
| `npm run check:shell` / `check:dash` | Playwright (bundled), no device |
| `node test/valence-live.mjs <host>` and friends | a hub at `<host>:82` |
| `node test/pairing-roundtrip.mjs` | the device twin, `../ValenceDrive/sim/valencesim` |

`test/fixtures/valencesim-catalog.{bin,etag}` is a byte copy of Valence's own
(`../Valence/clients/js/test/fixtures/`) — a real hub's real catalog bytes, so
the JS SHA-256 is checked against the C++ one. Never hand-edit it; re-copy it.

## Its relatives

| repo | what it is | how Phosphor touches it |
|---|---|---|
| [`../Valence`](../Valence) | the protocol: SPEC, registry, conformance, the JS client | **imported directly** — every `import` of `../../Valence/clients/js/*` is a live relative path to the sibling checkout. Read-only from here; changes there are RFCs. |
| `../ValenceDrive` | the reference hub (the machine's firmware) | nothing at build time. `test/check-device-knowledge.mjs` reads its catalog header *if present*, to harvest the field names Phosphor must not know. Its `sim/valencesim` is what the device tests talk to. |

Both must sit beside this repo in the same parent directory. There is no
package, no pin and no vendored copy: Phosphor tracks the sibling working tree,
which is the point during development.

Carved out of the archived `SlopDrive-32` machine repo (`webui/`), where it was
called SlopDeck. Doctrine lives in `.claude/rules/`; volatile truth lives on the
dev board (`bd`, prefix `ph`).
