# Changelog

Newest first. Each entry has two parts: what you will notice, and what changed in the code.

## Unreleased (main)

### For users

- **Phosphor in a browser.** The web app at phosphor.openvalence.org runs Phosphor in a browser tab against Neutrino, the built-in machine. It reaches Neutrino only.
- **The mini demo stores nothing.** phosphor.openvalence.org/mini/ is the Advanced Penetration demo the website embeds. It keeps everything in memory, so a reload or Reset demo starts fresh, and nothing is written to your browser. It starts at speed 25 %, with deep 100 % and shallow 0 % inside a window over the middle half of the rail.
- **Motion.** Drawers, menus, rows and cards slide or rise in instead of popping. Closing stays instant. Set Motion to Reduced, or turn on your system's reduced-motion setting, and nothing animates.
- **The connecting page is never a dead end.** It shows a countdown to the next try with a draining bar, Retry now and Stop, the address you can edit in place, your saved hubs with Neutrino last, a scan of your network, and a Troubleshooting link.
- **Links ask before they leave the app.** Every link that opens a browser shows "Open link?" with the destination first. Escape or back cancels.
- **A new fullscreen for the funscript player.** The control bar has a fixed slot at the bottom and fades in place. The motion preview and the rail window sit above it as one stack, dimmed to 40 % until you point at it. Drag the top edge of the wave to resize it, and drag sideways on the wave to scrub (while playing, it pauses for the drag and plays on when you let go). The wave no longer judders while it scrolls. The playhead stays in the center with a hatch where the script has no actions.
- **The rail's comet keeps up after the phone sleeps.** On Android it could trail the numbers by seconds, or park on an old sample, until the app restarted.
- **Health blames the right thing.** When the page itself stalled (a busy phone, for example), a slow round trip is now reported as this device with "Close other apps", not as the network.
- **Upload firmware.** The machine's System page has a Firmware card. Pick a Nucleus .bin and Phosphor checks it, tells you whether it is an Official release or Unrecognized, then asks you to double-press PAIR on the machine. It shows progress, waits for the restart and tells you whether the new firmware is running or the machine rolled back. Desktop and Android apps only; Wi-Fi only; not for Neutrino.
- **Docs from any page.** Press F1, then F1 again within 3 s, to open the docs for the page you are on. Escape cancels. Key help moved to `?`. The phone menu has a Docs item.
- The Windows installer shows WebView2's own progress window while it installs it, so a slow machine no longer looks stuck.

### Technical

- **Web builds** (ph-zvk7, docs/BUILD.md). Two Vite modes over the same app code: `npm run build:web` (dist-web/, published at /) and `npm run build:mini` (dist-mini/, published at /mini/). `.github/workflows/pages.yml` builds both, runs `test/mini-storage.test.mjs` (localStorage, sessionStorage, IndexedDB, cookies, Cache Storage and service workers empty after two runs of /mini/; / still persists as the control), then deploys with the CNAME phosphor.openvalence.org. `src/web/storage.js` gives the mini build Map-backed storage. Neutrino ships as a separate .wasm (208 KB gzipped). Neutrino's boot moved to `src/model/neutrino-boot.js`; the web builds pause it with the page and the embedded demo pauses off screen. The demo seed is in `src/web/web.js` (window 25 to 75 %, master 25, deep 100, shallow 0). The Pages job checks out ButtplugIO, which AboutPane imports its LICENSE from.
- **The motion system** (DESIGN 10.13, ruled 2026-10-18, ph-kgck). `src/ui/motion.js`: fade, rise, drawer, flipMove, flipFollowers and riseIn, with durations read from the tokens (`--ease-settle` added) and zero under `html.still`. Arrivals animate, dismissals are instant. The desktop right dock slides in over the content, then takes its grid column. View transitions were measured and left out (they take every pointer event in their scope, the e-stop's included). `test/motion-probe.mjs` (`npm run check:motion`) checks the strip and stop pair every frame, an e-stop press mid-transition, Reduced motion and pacing at 4x CPU throttle. The rail and pattern card skip layout and drawing nobody sees.
- **The connecting page** (DESIGN 10.20, ph-u3b2.1, ph-u3b2.2). Countdown line and drain bar, Retry now and Stop in fixed slots, the address editable in place, saved hubs, a LAN scan on arrival, rows animated with the motion primitives. Stop ends this session's redial only.
- **Leave-app confirm** (operator ruling 2026-10-18). One shared confirm in `src/ui/external.js`, then `tauri-plugin-opener` pinned =2.5.3 (2.6 and later need tauri 2.12), `open_url` scoped to `https://*` and `http://*` (LAN Stash servers). ExtLink carries the external mark. Credits, Troubleshooting, the web build's Downloads, plugin `openUrl`, Open in Stash and health reports route through it; a Cancel reaches a plugin as null. Nothing in the shell opens a URL any other way.
- **Funscript fullscreen** (docs/plugins/FUNSCRIPT.md PP7 to PP11, ph-7ri8, ph-10c4, ph-f012). Three layers over the video, none moving another: the bar, the stack (`data-stage-surface`) and the transport (the bar's middle on a fine pointer, the video's center on a coarse one). PP11 is the state table the tests read (`--states`). Pref `fsWave` holds the wave's height. Judder root cause: the moving layers were snapped to whole device pixels every frame (steps of 2, 2, 3 px at 60 Hz); only the still layers are snapped now. A media page's phone fullscreen takes the horizontal quick rail (DESIGN 10.3).
- **Rail comet clock** (ph-owiz). Android stops `performance.now()` during sleep while `Date.now()` keeps going (measured -162 s after 11 minutes). `telebuf.js epochMs()` converts a monotonic instant to `Date.now()` ms and re-anchors when the clocks part by over 2 ms. `test/meteor-sleep.mjs` (`check:meteor-sleep`).
- **Health split** (ph-owiz). `slow-link` is pinned on this device when the round trips that raise it were timed within 1 s of a page stall. CLOCK exchanges in the first 2 s after the page shows no longer count as round trips.
- **Upload firmware** (DESIGN 10.19, ruled 2026-10-19, ph-z6pz, ph-024l). `src/model/firmware.js` reads the ESP image header (magic 0xE9, chip P4, app descriptor, project `flagship_p4`, compiled FIRMWARE_VERSION) and compares the SHA-256 with the Nucleus releases' SHA256SUMS. `src-tauri/src/ota.rs` streams the image (the http plugin's stream feature; Android takes it as a JSON number array) after `POST /ota/arm` and the PAIR double press, under one 120 s deadline, then reads `/diag` for the slot verdict. Hidden for Neutrino and on iOS. Suite `check:flasher`.
- **F1 docs** (ph-fhu8). The page map is `src/ui/docs.js`; the second F1 is the confirm, so it opens with `ask: false`. Key help is on `?` (Shift+/), never from a text field. Covered in keys.test.
- **CI release job.** A `v*` tag's draft gets public file names, the Flatpak, SHA256SUMS.txt, the pre-release flag, title and a notes skeleton; the edit passes `--tag` and checks the draft kept it. Publish is the one manual step. The Windows installer's WebView2 bootstrapper runs with its progress window.

## 0.1.678 (2026-10-18)

### For users

- Windows files are code-signed: the installer, the MSIX and the exe in the portable zip.
- New downloads: an MSIX package (the recommended Windows download), a portable zip that keeps everything in a `PhosphorData` folder beside the exe, and an Android APK (arm64, Android 8 and later).
- On touch, drag controls move only after 8 px along their axis or a 400 ms hold, so a swipe across them scrolls the page.
- A control session can set the stroke window and flip; every limit still needs configure.
- Advanced Penetration moves on the first Start: speed 10 %, max depth 100 %, min depth 0 % by default. A pattern started at speed 0 says "Speed is 0: raise it to move".
- The built-in machine is named Neutrino, with a ν badge, and runs the Nucleus 0.1.57 code.
- An animated mark shows while the app starts (when that takes over 250 ms) and while a hub connects.

### Technical

- Windows signing with Azure Artifact Signing, timestamped. The portable build carries a `phosphor.portable` marker and refuses to write from inside the zip or from a loose exe in Downloads, Desktop, Documents, the user folder or a drive root without asking.
- The Android APK is signed with the project's release key; the certificate's SHA-256 is in the release notes.
- Built against Nucleus 0.1.57 settings. The Wi-Fi picker, saved networks, Bluetooth setup, configure-only settings, window and flip at control and the new Advanced Penetration defaults need Nucleus 0.1.57 on the machine.
- TCode adapter example plugin in `plugins/examples` (TCode v0.4 L0 grammar, D0, D1, D2 and DSTOP); it does not ship in the app.
