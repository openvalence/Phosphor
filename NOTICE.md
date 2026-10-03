# Notices

Phosphor is Copyright (c) 2026 AtlanticTM and licensed Apache-2.0 (see `LICENSE`),
except `plugins/factory/advanced-penetration/`, which is CERN-OHL-S-2.0 (see its
`LICENSE` and `NOTICE.md`). The Apache-2.0 core is an Available Component
relative to that plugin (CERN-OHL-S-2.0 section 3.3(d)).

Third-party software Phosphor depends on directly:

| component | license | role |
|---|---|---|
| Svelte | MIT | UI framework |
| Tauri (`tauri`, `tauri-build`, `@tauri-apps/api`) | Apache-2.0 OR MIT | desktop shell |
| Tauri plugins (`tauri-plugin-log`, `tauri-plugin-http`, `@tauri-apps/plugin-http`) | Apache-2.0 OR MIT | log, Rust-side fetch |
| `tauri-plugin-blec`, `@mnlphlp/plugin-blec` | MIT OR Apache-2.0 | BLE central (patched copy in `src-tauri/vendor/`) |
| serde, serde_json, log, async-trait, futures | MIT OR Apache-2.0 | Rust |
| tokio, tokio-tungstenite | MIT | Rust async runtime, WebSocket tests |
| if-addrs | MIT OR BSD-3-Clause | interface list for the datagram e-stop |
| Playwright | Apache-2.0 | dev only |
| Valence JS client (`../Valence/clients/js`) | MIT | protocol client, imported by relative path |
| ButtplugIO fork (`../ButtplugIO`, embedded server) | BSD-3-Clause; its Joycon support carries Joycon-rs, Apache-2.0 | buttplug server |

Apache-2.0 section 4(d): the NOTICE content of Phosphor is this file. Retain it,
and the copyright notices above, in any redistribution of Phosphor or a work
derived from it.
