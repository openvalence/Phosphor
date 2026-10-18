# Building Phosphor

Every platform builds the same two things: the web bundle (`vite`) and the
Tauri shell around it. The built-in machine rides inside the web bundle, so
the exe is standalone.

## Layout

The repos sit side by side in one parent directory:

```
Phosphor/     this repo
Valence/      the JS client Phosphor imports (../../Valence/clients/js)
Nucleus/      Neutrino's sources (sim/neutrino) and the native exe the suites run
Kinetic/      the planner Neutrino compiles in
ButtplugIO/   branch `valence`, Cargo path deps of src-tauri
```

## The built-in machine

The built-in machine, Neutrino in the UI (`src/model/builtin.js`), is
the emulator: the Nucleus hub firmware built to wasm, run in process
in a worker in every build: Windows, macOS, Linux and Android (DESIGN 10.10).

- `src/model/neutrino/` holds the vendored build: `neutrino.js` (the
  emscripten loader, verbatim), `bytes.js` (`neutrino.wasm` as base64; the
  page posts the bytes to the worker) and `neutrino.pin` (the Nucleus sha,
  the boot etag, and the size and SHA-256 of both files). About 660 KB of
  wasm, 881 KB as base64, 207 KB gzipped.
- `node test/neutrino-pin.mjs` (in `npm run check`) checks both files against
  the pin and boots the machine to its pinned etag. `--rebuild` also rebuilds
  from the sibling Nucleus when it sits clean at the pinned sha and
  byte-compares.
- Rebuild after a Nucleus change (Nucleus clean at the commit to pin, `.beads`
  aside; needs the workspace emsdk at `../.tools/emsdk` or `$EMSDK`, plus
  `cmake` and `ninja` on PATH):

  ```sh
  node test/neutrino-pin.mjs --write
  node test/neutrino-twin.mjs --wasm
  ```

  `--write` builds `../Nucleus/sim/neutrino/wasm` in a temp dir and rewrites
  the three files. Commit them together.
- `node test/neutrino-twin.mjs --wasm` (in `npm run check`) runs the
  end-to-end client proof against the vendored wasm through the app's own
  bridge (`src/model/neutrino-bridge.js`) and jogs it.
- The native exe (`Nucleus/sim/neutrino/build/neutrino-sim[.exe]`) is not
  bundled in Phosphor (the Neutrino dev tool, below, bundles its own build).
  It stays for the suites that dial a real WebSocket hub
  (`test/neutrino-twin.mjs` without `--wasm`, the `--live` modes,
  `test/pairing-roundtrip.mjs`, `test/buttplug-estop-sim.mjs`), the bench,
  and recording `test/fixtures/neutrino-catalog.*`. Its build is Nucleus
  `sim/neutrino/README.md`.

## Web builds

Two builds of the same app run in a plain browser and join Neutrino on load
(`src/web/`): `npm run build:web` (to `dist-web/`) is Phosphor in a browser
tab, `npm run build:mini` (to `dist-mini/`) the memory-only demo the
website's home page embeds. Both are code-split pages with relative URLs; `.github/workflows/pages.yml`
publishes the web build at https://phosphor.openvalence.org/ and the mini
build at `/mini/` on every push to main (the repo's Pages source is GitHub Actions, its custom domain
`phosphor.openvalence.org`).

- What is gone, by build flag (`import.meta.env.MODE`, dead code in every
  other build): the shell path (Hubs, Buttplug, BLE, LAN, saved hubs, plugin
  install, window chrome), the hub address entry (HubPicker), the node graph.
  Neutrino is the only machine: an https page cannot open `ws://` to a LAN
  hub (mixed content, and Chrome's Private Network Access), and a browser has
  no UDP discovery, Buttplug server or file system. The top bar's note
  (`src/web/WebNote.svelte`) says so.
- The web build persists like the app (localStorage): the visitor opened it.
- The mini build keeps all state in memory: `src/web/storage.js` puts
  Map-backed stand-ins in place of localStorage and sessionStorage, and
  nothing in it uses IndexedDB, cookies, Cache Storage or a service worker,
  so a reload is a first load and the site embeds it with no consent prompt.
  `test/mini-storage.test.mjs` checks the built page holds nothing after a run.
- The mini build also drops every factory plugin but Advanced Penetration
  (`src/plugins/factory-mini.js`, swapped in by `vite.config.js`), hides the
  Plugins page, opens on the Advanced Penetration card's page and starts
  Advanced (not under reduced motion). A first load, and Reset demo, seed the
  window to the middle half of the rail (read from the catalog), master 50 and
  the full depth in it (deep 100, shallow 0: the window, not the depths, makes
  the stroke smaller); Neutrino's own defaults stand.
- Both follow the light or dark of the embedding page (`?theme=light|dark`,
  then `postMessage({theme})`), else the system's, while the applied theme is
  one of the two defaults.
- Hidden, the page pauses Neutrino (no tick, and no time passes for the
  machine: `pause`/`resume` in `src/model/neutrino-bridge.js`). Embedded, the
  site's hero also sends `{phosphor: 'pause' | 'resume'}` when it leaves or
  comes back on screen; the paused page reads as hidden (one goodbye, one warm
  reconnect, the pattern started again if it ran), draws nothing and stills
  its ambient motion.
- Neutrino ships as a `.wasm` file beside the page there (`wasmAsset` in
  `vite.config.js`), not the base64 string the bundles inline; Theme sheets
  load when applied.

## Neutrino, the dev tool

`neutrino/` is a second Tauri app in this repo (DESIGN 10.17): one window
drawing one native Neutrino, the machine the suites dial, with its physical
buttons and network faults. It shares `src/style.css`, the themes and
`src/ui/tip.js`; its page is `neutrino/` (`App.svelte`, `Rail.svelte`,
`Scope.svelte`), its shell `neutrino/src-tauri` (crate `neutrino`, its own
`Cargo.lock`, seeded from Phosphor's so the Tauri crates match the npm
packages).

- The machine is the native exe built from the sibling Nucleus at the commit
  `neutrino/neutrino-native.pin` names, with Kinetic at that commit's
  `kinetic.pin`, by `tools/neutrino-sim.mjs`, into
  `neutrino/src-tauri/binaries/neutrino-sim-<host triple>[.exe]` (Tauri's
  `externalBin`; gitignored, rebuilt when its stamp misses the pin). Nucleus
  must sit clean at the pinned sha; `node tools/neutrino-sim.mjs --write`
  pins Nucleus HEAD and builds. The build dir persists under
  `neutrino/src-tauri/target/neutrino-sim`.
- `npm run neutrino:dev`: the sidecar, then `tauri dev` from `neutrino/`
  (vite on port 5183).
- `npm run neutrino:build`: the sidecar, then a release build without an
  installer. The portable app is the two files side by side in
  `neutrino/src-tauri/target/release/`: `neutrino[.exe]` and
  `neutrino-sim[.exe]`; copy both.
- Run: `neutrino` takes the first free WebSocket port from 82, `/uitoken` on
  80 when free (else the WebSocket port plus 8000), the dev tool channel on
  an ephemeral loopback port, and keeps the machine's state per port under the
  app's local data dir (`machine-<port>/`). Arguments after `--` go to the
  machine (`neutrino -- --motor-switch`; `-- --bind 127.0.0.1 --no-discovery`
  keeps it off the LAN and the firewall prompt away). Launch another starts a
  second window on the next free port; only the first gets port 80, so a
  later one's clients start at `watch` and pair with its PAIR button.
- Windows asks about the firewall the first time the machine binds the LAN.
- macOS and Linux: the same two npm scripts with a C++23 GCC or Clang, CMake,
  Ninja and git (Nucleus `sim/neutrino/README.md`); ports under 1024 need
  privileges on Linux, so pass `-- --port 8082 --http 8080` there. Untried on
  both.
- Not in CI yet. Adding it: a job per OS that checks out Nucleus at
  `neutrino-native.pin` (not `main`) with Valence and Kinetic, installs CMake
  and Ninja (and WinLibs MinGW on Windows, or teaches `tools/neutrino-sim.mjs`
  an MSVC or clang-cl toolchain), runs `npm run neutrino:build` and uploads
  the two files as one zip; signing and a macOS `.app` carrying the sidecar
  come after.

## Windows

Rust MSVC, Node 22.

```sh
npm ci
npm run build:app -- --bundles nsis
```

## Windows signing (Azure Artifact Signing)

Windows ships three files: the MSIX package (recommended), the NSIS installer
(standard) and the portable zip. Once the settings below exist, a `v*` tag
signs all of them with Azure Artifact Signing (formerly Trusted Signing;
operator ruling, 2026-10-18), certificate in the operator's own name. Until then every Windows file is unsigned and the MSIX
stays out of releases. The Microsoft Store route is retired (operator
ruling, 2026-10-08): the Store does not let OpenValence distribute the MSIX
itself. The MSIX is a plain sideload package with no update URI.

Cost: the Basic plan, $9.99 a month.

### One-time setup (operator)

1. An Azure subscription (pay-as-you-go), with the resource provider
   `Microsoft.CodeSigning` registered (Subscriptions > Resource providers).
2. An Artifact Signing account (Basic) in a supported region, for example
   East US. Its Overview page shows the Account URI, the endpoint CI needs
   (East US: `https://eus.codesigning.azure.net/`).
3. Assign yourself the role `Artifact Signing Identity Verifier` on the
   account, then Identity validation > New identity > Public > Individual.
   The certificate subject is your legal name as validated.
4. A certificate profile of type Public Trust on that validated identity.
   Its page shows the subject, for example
   `CN=<legal name>, O=<legal name>, L=<city>, S=<state>, C=US`; copy it
   exactly. The certificates are short-lived and renewed by the service; the
   subject stays the same.
5. A Microsoft Entra app registration (`phosphor-signing`), no client secret.
   Certificates & secrets > Federated credentials > Add > GitHub Actions
   deploying Azure resources: organization `openvalence`, repository
   `Phosphor`, entity Environment, name `windows-signing`. Entra does not take
   a wildcard such as `refs/tags/v*` in a subject, so the environment carries
   the tag rule. If the repository uses GitHub's immutable OIDC subjects, the
   subject holds the owner and repository ids; a failed login prints the one
   GitHub sent.
6. On the Artifact Signing account, Access control (IAM): role
   `Artifact Signing Certificate Profile Signer` for that app registration.
7. In `openvalence/Phosphor` > Settings > Environments: `windows-signing`,
   deployment branches and tags limited to the tag pattern `v*`.
8. In `openvalence/Phosphor` > Settings > Secrets and variables > Actions >
   Variables (repository level, none of them is a secret):

   | variable | value |
   |---|---|
   | `AZURE_CLIENT_ID` | the app registration's Application (client) ID |
   | `AZURE_TENANT_ID` | Directory (tenant) ID |
   | `AZURE_SUBSCRIPTION_ID` | the subscription holding the account |
   | `AZURE_ARTIFACT_SIGNING_ENDPOINT` | the Account URI (step 2) |
   | `AZURE_ARTIFACT_SIGNING_ACCOUNT` | the Artifact Signing account name; setting it turns signing on |
   | `AZURE_ARTIFACT_SIGNING_PROFILE` | the certificate profile name |
   | `MSIX_PUBLISHER` | the certificate subject from step 4, character for character |

   Windows refuses an MSIX whose manifest Publisher differs from its
   signer's subject, and signing one fails; `tools/msix/pack.mjs` takes the
   Publisher from `MSIX_PUBLISHER` and falls back to
   `tools/msix/identity.json`.

### What CI does

- Every build: the Windows job builds `phosphor.exe` (`tauri build
  --no-bundle`), then the NSIS installer (`tauri bundle`), the portable zip
  and the MSIX around the same exe, as artifacts
  (`phosphor-x86_64-pc-windows-msvc`, `...-portable`, `...-msix`). Pull
  requests and pushes to `main` never sign.
- `v*` tag pushes with `AZURE_ARTIFACT_SIGNING_ACCOUNT` set: the job runs in the
  `windows-signing` environment with `id-token: write`, logs in to Azure
  with OIDC (`azure/login`, no stored secret) right after the build, and
  signs in this order:
  1. While `tauri bundle` packs NSIS: Tauri writes the bundle type into
     `phosphor.exe`, so its `signCommand` (`tools/sign-windows.ps1`, the
     `ArtifactSigning` module) signs that patched exe, the uninstaller and
     the setup exe. Signing the exe before `tauri bundle` would not survive
     the patch.
  2. `phosphor.exe` itself (`azure/artifact-signing-action`), restored
     unpatched by Tauri: the portable zip and the MSIX carry it.
  3. The MSIX.

  SHA-256 digests, timestamped by `http://timestamp.acs.microsoft.com`.
  The job then runs `signtool verify /pa` on the exe, the setup exe, the exe
  unpacked from the setup exe and the MSIX, and prints each signer subject
  and timestamp; any failure fails the job.
- Without `AZURE_ARTIFACT_SIGNING_ACCOUNT` the signing steps are skipped, not
  failed. With it set, a signing or verification failure fails the job.
- `windows-release` (a `v*` tag, after every bundle job): the installer and
  portable zip into the draft release, and the MSIX when signing is on.

The portable zip, `Phosphor_<version>_x64-portable.zip`, holds one folder
so Extract here and Extract all both leave one folder (docs/DESIGN.md
10.18):

```
Phosphor/
  phosphor.exe        the exe (signed on a release)
  phosphor.portable   one line: Phosphor portable mode: all data stays in PhosphorData beside phosphor.exe.
```

The marker file turns portable mode on; the app creates `PhosphorData`
beside the exe.

### Release checklist

1. `git tag vX.Y.Z && git push origin vX.Y.Z`.
2. When every job is green, open the draft release
   `Phosphor X.Y.Z (pre-release CI build)` and check the installer and
   MSIX are signed and, after extracting the portable zip, that
   `Phosphor/phosphor.exe` is (Properties > Digital
   Signatures, or `signtool verify /pa <file>`); the Windows job's log
   prints the same. The zip holds exactly the `Phosphor/` folder with
   `phosphor.exe` and `phosphor.portable`.
3. The `release` job has already given the draft its public shape: the
   public file names (`Phosphor-<version>-windows-x64-setup.exe`,
   `-windows-x64-portable.zip`, `-windows-x64.msix`, `-macos-arm64.dmg`,
   `-linux-x86_64.AppImage`, `-linux-amd64.deb`, `-linux-x86_64.flatpak`,
   `-android-arm64.apk`), `SHA256SUMS.txt`, the pre-release flag, the title
   `Phosphor <version> (pre-release CI build)` and a notes skeleton. Rewrite
   its TODO lines from the "Changes since" list, then delete that list.
4. Publish the release. The website's downloads page reads the newest
   published release from the GitHub API on the next page load.

## Windows MSIX (local packages)

`node tools/msix/pack.mjs` builds an MSIX. CI runs it on every Windows
build (signing above); locally it is for testing. It turns a release build into
`src-tauri/target/msix/phosphor-x86_64.msix`. It needs `npm run build:app`
first, and the Windows SDK's `makeappx.exe` (the newest
`Windows Kits\10\bin\<version>\x64` that has it). The package is a full-trust
desktop app (`runFullTrust`), so UDP broadcast, loopback and Bluetooth
behave as in the NSIS install. The layout holds `phosphor.exe`, four tile and
logo PNGs from `src-tauri/icons` under
`Assets/`, and the manifest filled from `tools/msix/AppxManifest.xml`.
The package version is the `tauri.conf.json` version plus `.0`.
`tools/msix/identity.json` holds the package identity (`name`, `publisher`,
`publisherDisplay`).

- WebView2 is not bundled. Windows 11 and current Windows 10 ship it.
- App data: files under `%APPDATA%` and `%LOCALAPPDATA%` that already exist
  (an earlier NSIS install's `com.phosphor.app`) are read and written in
  place; new ones go to `%LOCALAPPDATA%\Packages\<family name>\LocalCache` and
  leave with the package.

### Local test install

```sh
node tools/msix/pack.mjs --test-sign
```

On first use, `--test-sign` creates a self-signed certificate whose Subject
equals `publisher` (so a changed identity needs the old `test.pfx` deleted),
and leaves `test.pfx` and `test.cer` in `src-tauri/target/msix/` (never
committed; `cargo clean` deletes them, so trust the new `.cer` after one).
Windows installs only packages whose signer
is trusted machine-wide. Run once, from an elevated PowerShell:

```powershell
Import-Certificate -FilePath src-tauri\target\msix\test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

Then double-click the `.msix` or run
`Add-AppxPackage src-tauri\target\msix\phosphor-x86_64.msix`.

Or run `install-test-cert.ps1`, which `--test-sign` copies beside the package.
It elevates itself, imports the `.cer` next to it into
`LocalMachine\TrustedPeople`, and installs the `.msix` beside it (`-NoInstall`
to trust only). `remove-test-cert.ps1` undoes it: it uninstalls the package
signed by that certificate and removes the certificate from the store
(`-KeepApp`, `-KeepCert` for one or the other). Ship the four files together
when handing a test build to someone.

The current user's TrustedPeople store is not enough (0x800B0109). Without
admin but with Developer Mode on,
`Add-AppxPackage -Register src-tauri\target\msix\layout\AppxManifest.xml`
installs the unsigned layout in place; a rebuild replaces that folder, so copy
it elsewhere first. `Get-AppxPackage OpenValence.OpenValencePhosphor | Remove-AppxPackage`
uninstalls either one.

## macOS (the M4 Air, aarch64)

Untested: nothing here has run on a Mac yet.

```sh
xcode-select --install                               # Apple Clang, git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # host aarch64-apple-darwin

npm ci
npx tauri build --bundles app,dmg
```

A local build is never quarantined, so it opens directly. A CI build is
ad-hoc signed, not notarized: after copying `Phosphor.app` out of the `.dmg`,
open it once with either

```sh
xattr -dr com.apple.quarantine /Applications/Phosphor.app
```

or System Settings > Privacy & Security > Open Anyway after the first refused
launch.

Every macOS build is ad-hoc signed by Tauri (`bundle.macOS.signingIdentity`
`-`) so the signature identifier is the bundle identifier. Without that, the
linker's own ad-hoc stamp names the binary `phosphor-<hash>`, macOS keys the
Local Network and Bluetooth permissions by that name, and the grant shown under
`com.phosphor.app` in System Settings never applies to the running process:
the LAN scan and every Rust-side request fail without an error (measured on the M4 Air,
2026-10-04).
`codesign -dv Phosphor.app` must print `Identifier=com.phosphor.app`.

Notarized builds need an Apple Developer Program membership and these
repository secrets, which tauri-action reads: `APPLE_CERTIFICATE` (base64
`.p12` of a Developer ID Application certificate), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific
password) and `APPLE_TEAM_ID`. Then the workflow's `APPLE_SIGNING_IDENTITY: '-'`
becomes `${{ secrets.APPLE_SIGNING_IDENTITY }}` and the other five go into the
same `env`.

Intel and universal Macs are not built (`--target universal-apple-darwin`
is untried).

## Linux (Arch on WSL)

```sh
sudo pacman -Syu --needed base-devel git nodejs npm rustup \
  webkit2gtk-4.1 librsvg libappindicator-gtk3 xdotool openssl
rustup default stable
```

Work in a Linux-side copy (`~/ov/Phosphor` and its siblings), never in
`/mnt/c`: `npm ci` there would replace the Windows `node_modules` with Linux
binaries. The WSL root had about 3 GB free on 2026-10-03; a Tauri release
build needs several.

```sh
npm ci
npx tauri build --bundles deb,appimage
```

Ubuntu and Debian take the packages CI installs:
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libudev-dev
libusb-1.0-0-dev libdbus-1-dev`.

## Flatpak

`flatpak/org.openvalence.Phosphor.yml` packages the `.deb` (the Tauri
binary) on the GNOME 50 runtime. GNOME, not bare freedesktop, because only the
GNOME runtime ships webkit2gtk-4.1. Verified by hand on WSL2 Arch under WSLg,
2026-10-04: CI's bundle and a local build both reach a live session at the
control access tier with the catalog adopted.

By hand, with CI's `.deb` (built on ubuntu-22.04, so its glibc is older than
any runtime's):

```sh
sudo pacman -S --needed flatpak flatpak-builder xdg-desktop-portal xdg-desktop-portal-gtk
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
cp Phosphor_*_amd64.deb flatpak/phosphor.deb
flatpak-builder --user --install-deps-from=flathub --force-clean --repo=repo build-flatpak flatpak/org.openvalence.Phosphor.yml
flatpak build-bundle repo phosphor.flatpak org.openvalence.Phosphor
flatpak install --user phosphor.flatpak
```

- App data (logs, plugins) lives in
  `~/.var/app/org.openvalence.Phosphor/data/com.phosphor.app/`, the Tauri
  identifier nested under the Flatpak app id. A `.deb` install's
  `~/.local/share/com.phosphor.app/` is not visible to the Flatpak.
- `fallback-x11` grants X11 only when there is no Wayland socket: forcing
  `GDK_BACKEND=x11` on a Wayland session panics with "Failed to initialize
  GTK" unless the run adds `--socket=x11`.

### Flathub policy

Flathub's [generative AI policy](https://docs.flathub.org/docs/for-app-authors/requirements)
binds the submission, and this repo is built with coding agents (org README,
"How it's built"). Constraints:

- `flatpak/org.openvalence.Phosphor.yml` is the CI manifest and was written by
  an agent. It is never submitted. The Flathub manifest in the
  `flathub/org.openvalence.Phosphor` repo is written by the maintainer by hand,
  from the Flathub docs; agents may explain fields, never draft, edit or review
  that file (manifests must not contain AI-generated or AI-assisted content,
  disclosure does not exempt them).
- No agent opens, automates or replies on the Flathub submission pull request,
  and no agent writes its commit messages or description. The maintainer does
  not request an agent review there.
- The submission discloses the agent-generated material: the application
  (nearly all code and docs), `flatpak/*.metainfo.xml`, `.desktop` and the
  icon, with the approximate extent. Reviewers may reject on that basis.
- Verification: `https://openvalence.org/.well-known/org.flathub.VerifiedApps.txt`
  (the app id is under the openvalence.org domain).

## Android (Pixel over adb)

The build needs Android Studio's SDK with build-tools, platform-tools,
cmdline-tools and NDK 29, JDK 17 for Gradle (`JAVA_HOME` on it, whatever `java`
is on PATH), and the four Rust Android targets
(`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`).
Set `ANDROID_HOME`, `NDK_HOME` (the `ndk/<version>` folder) and `JAVA_HOME`.

```sh
npx tauri android init --ci
npm run build:android -- --apk --target aarch64 --debug --ci
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

- `src-tauri/gen/android` is generated from `tauri.conf.json` and gitignored.
  `init` never overwrites an existing project: after a config change, delete
  `src-tauri/gen/android` and run `init` again.
- `bundle.android.minSdkVersion` is 26, the BLE plugin's floor. Its Bluetooth
  and location permissions merge in from the plugin's own manifest; Tauri's
  template carries `INTERNET`. The debug app id is `com.phosphor.app.debug`.
- `build:android` copies the launcher icon and the activity into the
  generated project (`tools/android-icons.mjs`) and builds with the computed version
  (Versioning, below). The icon sources live in `src-tauri/icons/android/`:
  the adaptive icon is the solid chassis color behind a vector foreground
  (`drawable/ic_launcher_foreground.xml`, also the themed-icon monochrome
  layer), the whole mark on the 52 dp circle keyline of the 108 dp canvas
  (Android asks 48 to 66 dp).
  The activity's source is `src-tauri/android/MainActivity.kt` (immersive
  mode and the screen's shape, DESIGN §10.3); edit it there, never in `gen/android`, which the copy
  overwrites.
  `npm run icons` regenerates the mipmap PNGs (unused at minSdk 26, kept
  for the template) and reapplies the copy.
  On a build tree from before the vector, Gradle's incremental resource merge
  loses `drawable/ic_launcher_foreground` (AAPT: not found): delete
  `gen/android/app/build/intermediates/incremental` once.
- The built-in machine runs on Android as everywhere else (The built-in
  machine, above).
- The embedded buttplug server builds for Android too, with BLE toys through
  btleplug's Android backend ([BUTTPLUG.md](BUTTPLUG.md), Android: permissions
  and the server's lifetime). Its Java is compiled by the Gradle module
  `src-tauri/android/btleplug` from cargo's copy of the btleplug sources at
  the `Cargo.lock` version, so the module fails the build with a message when
  `$CARGO_HOME/registry/src` lacks them. `build.rs` adds the module to the
  generated project on every Android build; an existing `gen/android` needs
  no new `init`.
- Delete the old APK before a rebuild: the Gradle debug build updates it in
  place without compacting, so the file doubles (448 MB seen 2026-10-08).
- A debug APK is debug-signed (about 355 MB with the buttplug server,
  symbols kept). A release APK is about 38 MB (arm64, R8, symbols stripped).

### Android release (signed APK)

```sh
npm run build:android -- --apk --target aarch64 --ci
# src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

- Signing lives in `src-tauri/android/signing.gradle.kts`, which
  `tools/android-icons.mjs` copies into `gen/android/app` and applies from its
  `build.gradle.kts`. It also sets `usesCleartextTraffic` true for release:
  the template allows cleartext only in debug, and hubs speak plain `ws://`
  and `http://`.
- The keystore comes from `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`
  and `ANDROID_KEY_ALIAS` (default `phosphor`), else from a
  `keystore.properties` (`storeFile`, `password`, `keyAlias`) at
  `ANDROID_KEYSTORE_PROPERTIES` or
  `~/Documents/phosphor-android-signing/keystore.properties`. Store and key
  share one password (PKCS12).
- Without a keystore a release build fails with a message.
  `PHOSPHOR_ANDROID_UNSIGNED=1` builds `app-universal-release-unsigned.apk`
  on purpose (CI without the secrets).
- No keystore, password or `keystore.properties` ever enters the repo;
  `.gitignore` covers `*.jks`, `*.keystore` and `keystore.properties`.
- arm64-v8a only: every phone sold in years is arm64, and each extra ABI
  adds about 35 MB of native code. `--target armv7` (or `x86_64`) adds one.

One time, the maintainer creates the release key:

```sh
node tools/android-keystore.mjs [folder]   # default ~/Documents/phosphor-android-signing
gh secret set -f <folder>/github-secrets.env -R openvalence/Phosphor
```

The script refuses a folder inside the repo or one that already holds
`phosphor-release.jks`, writes the keystore (RSA 4096, 10000 days, a random
password), `keystore.properties` and `github-secrets.env`
(`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`), and prints only paths,
the certificate's SHA-256 fingerprint and the `gh` command. Back the folder up
off the machine: an APK signed with another key cannot update an installed
Phosphor, and Android's only way out is an uninstall, which deletes the app's
data.

Release certificate SHA-256 (verify a download with
`apksigner verify --print-certs Phosphor_<version>_android-arm64.apk`):

```
1F:D3:62:C0:8B:EE:8A:19:33:26:F1:E5:9E:4C:D6:48:73:98:4E:D6:B8:3F:75:FD:D6:A1:3A:35:00:FF:98:74
```

## Versioning

Version numbers follow Valence RFC-102 for the whole stack (operator ruling,
2026-10-04):

- MAJOR is the compatibility line. Every 1.x.y hub, client and library work
  together; a break inside a major is a bug on one side and ships as a patch.
- MINOR versions add features. A feature from x.2 may not work against an x.1
  peer; nothing outside that feature may break.
- PATCH carries no compatibility meaning and increments on every build, not
  only on submissions.

Mechanics: `src-tauri/tauri.conf.json` holds MAJOR.MINOR.0 and is the only
file edited by hand (`package.json` and the metainfo release mirror it;
`npm run check` fails when they drift or the committed patch is not 0).
`tools/version.mjs` computes PATCH as the commit count since the tag
`base/MAJOR.MINOR` (`git tag base/0.2 && git push origin base/0.2` when the
minor moves). CI stamps the three files before every bundle; locally
`npm run build:app -- --bundles nsis` and `npm run build:android` do the same
through `--config`, and
`tools/msix/pack.mjs` uses the computed version too. No step commits a
stamped file. Android's versionCode is major*1e6 + minor*1e3 + patch, so a
minor must move before the patch reaches 1000.

## CI (`.github/workflows/build.yml`)

Runs on every push to `main`, every pull request, every `v*` tag and by hand.

| job | runner | produces (artifact) |
|---|---|---|
| `x86_64-pc-windows-msvc` | windows-latest | NSIS installer (`phosphor-x86_64-pc-windows-msvc`), portable zip (`...-portable`), MSIX (`...-msix`); signed on a `v*` tag once Windows signing is configured |
| `windows-release` | ubuntu-24.04 | on a `v*` tag, after `bundle`: the Windows installer, portable zip and (signed only) MSIX into the draft release |
| `aarch64-apple-darwin` | macos-latest | `.dmg` holding the ad-hoc signed `.app` (`phosphor-aarch64-apple-darwin`) |
| `x86_64-unknown-linux-gnu` | ubuntu-22.04 | `.deb` and `.AppImage` (`phosphor-x86_64-unknown-linux-gnu`) |
| `flatpak` | ubuntu-24.04, GNOME 50 container | `phosphor-x86_64.flatpak` |
| `android` | ubuntu-24.04 | `Phosphor_<version>_android-arm64.apk` (`phosphor-android-arm64`), signed with the `ANDROID_KEYSTORE_*` secrets, else `..._android-arm64-unsigned.apk` |
| `android-release` | ubuntu-24.04 | on a `v*` tag, after `bundle`: the signed APK into the draft release; an unsigned APK fails it |
| `release` | ubuntu-24.04 | on a `v*` tag, after `windows-release`, `android-release` and `flatpak`: renames the draft's files to the public names, drops the `.app.tar.gz`, adds the Flatpak and `SHA256SUMS.txt`, sets the pre-release flag, the title and a notes skeleton with the commit subjects since the newest published release (Release checklist) |

Each bundle job checks out Phosphor, Nucleus (`main`), Valence and Kinetic at
the shas in Nucleus's `valence.pin` and `kinetic.pin`, and ButtplugIO
(`valence`), then runs tauri-action (Windows: `tauri build --no-bundle`, then
`tauri bundle`), whose `beforeBuildCommand` runs
`npm run check` first, the built-in machine's pin among it. CI never builds
the wasm: it is vendored. A `v*` tag also opens one draft release with every bundle; the
Windows files reach it through `windows-release` (Windows signing, above).

Before the first run can pass, the remote needs what the workflow checks out:

- `openvalence/ButtplugIO` with branch `valence` (the fork's `valence` branch
  exists only locally today; its `origin` is upstream buttplug).
- The `valence.pin` sha on `openvalence/Valence` and the `kinetic.pin` sha on
  `openvalence/Kinetic`.

Trigger: push the workflow (`git push` in Phosphor), or with the GitHub CLI
`gh workflow run build.yml -R openvalence/Phosphor`.

## Lanes and parallel suites

A multi-agent pass gives each lane its own worktree:

```sh
node tools/worktree.mjs create <lane>   # ../Phosphor-lp-<lane> on lp/<lane> from main
node tools/worktree.mjs list
node tools/worktree.mjs remove <lane>   # refuses a dirty lane or an lp/<lane> not merged into main
```

`node_modules` in a lane is a junction to the main checkout's, so `npm ci`
runs only in the main checkout. Each lane gets an untracked, self-ignoring
`test/evidence/.gitignore`, so its screenshots never reach a commit.

Two browser runs can share one checkout when each loads its own build. The
suites that load the web bundle read `dist/index.html` unless `PHOSPHOR_DIST`
names another build folder; that run then writes its evidence to
`<folder>/evidence`. The shell suites build their own bundle from `src/`, and
every suite binds an ephemeral port. `dist*/` is gitignored, so:

```sh
npm run build:only -- --outDir dist-b
PHOSPHOR_DIST=dist-b npm run test:browser
```
