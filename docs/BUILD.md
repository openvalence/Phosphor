# Building Phosphor

Every platform builds the same three things: the web bundle (`vite`), the
valencesim sidecar (CMake, from Nucleus) and the Tauri shell that bundles both.

## Layout and the sidecar contract

The repos sit side by side in one parent directory:

```
Phosphor/     this repo
Valence/      the JS client Phosphor imports (../../Valence/clients/js)
Nucleus/      sim/valencesim, the sidecar; it compiles Valence's sources too
ButtplugIO/   branch `valence`, Cargo path deps of src-tauri
```

The sidecar is `src-tauri/binaries/valencesim-<target triple>`, plus `.exe` on
Windows, declared as `bundle.externalBin: ["binaries/valencesim"]`. That folder
is gitignored. `npm run sidecar` copies `../Nucleus/sim/valencesim/build/valencesim[.exe]`
there under the host triple (`npm run sidecar -- <path>` for another source).
Bundles install it beside the Phosphor binary with the triple stripped.

## Windows (today)

WinLibs MinGW-w64 GCC for the sim (Nucleus `sim/valencesim/README.md` has the
PATH line), Rust MSVC, Node 22.

```sh
cmake -S ../Nucleus/sim/valencesim -B ../Nucleus/sim/valencesim/build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=g++ -DCMAKE_C_COMPILER=gcc
cmake --build ../Nucleus/sim/valencesim/build
npm ci
npm run sidecar
npx tauri build --bundles nsis
```

## macOS (the M4 Air, aarch64)

Untested: nothing here has run on a Mac yet. The sim builds clean with Clang
and libc++ on Linux, which is the closest stand-in available.

```sh
xcode-select --install                               # Apple Clang, git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install cmake node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # host aarch64-apple-darwin

cmake -S ../Nucleus/sim/valencesim -B ../Nucleus/sim/valencesim/build -DCMAKE_BUILD_TYPE=Release
cmake --build ../Nucleus/sim/valencesim/build --parallel
npm ci
npm run sidecar
npx tauri build --bundles app,dmg
```

A local build is never quarantined, so it opens directly. A CI build is
ad-hoc signed, not notarized: after copying `Phosphor.app` out of the `.dmg`,

Every macOS build is ad-hoc signed by Tauri (`bundle.macOS.signingIdentity` `-`)
so the signature identifier is the bundle identifier. Without that, the linker's
own ad-hoc stamp names the binary `phosphor-<hash>`, macOS keys the Local
Network and Bluetooth permissions by that name, and the grant shown under
`com.phosphor.app` in System Settings never applies to the running process:
the LAN scan and every Rust-side request silently fail (measured on the M4
Air, 2026-10-04). `codesign -dv Phosphor.app` must print
`Identifier=com.phosphor.app`.
open it once with either

```sh
xattr -dr com.apple.quarantine /Applications/Phosphor.app
```

or System Settings > Privacy & Security > Open Anyway after the first refused
launch.

Notarized builds need an Apple Developer Program membership and these
repository secrets, which tauri-action reads: `APPLE_CERTIFICATE` (base64
`.p12` of a Developer ID Application certificate), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific
password) and `APPLE_TEAM_ID`. Then the workflow's `APPLE_SIGNING_IDENTITY: '-'`
becomes `${{ secrets.APPLE_SIGNING_IDENTITY }}` and the other five go into the
same `env`.

Intel and universal Macs are not built: that needs the sim built for x86_64
too and joined with `lipo` into `valencesim-universal-apple-darwin`.

## Linux (WSL archlinux)

```sh
sudo pacman -Syu --needed base-devel cmake ninja git nodejs npm rustup \
  webkit2gtk-4.1 librsvg libappindicator-gtk3 xdotool openssl
rustup default stable
```

Work in a Linux-side copy (`~/ov/Phosphor` and its siblings), never in
`/mnt/c`: `npm ci` there would replace the Windows `node_modules` with Linux
binaries. The WSL root had about 3 GB free on 2026-10-03; a Tauri release
build needs several.

```sh
cmake -S ../Nucleus/sim/valencesim -B ~/valencesim-build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build ~/valencesim-build
npm ci
npm run sidecar -- ~/valencesim-build/valencesim
npx tauri build --bundles deb,appimage
```

Ubuntu and Debian take the packages CI installs:
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libudev-dev
libusb-1.0-0-dev libdbus-1-dev`, plus a C++23 compiler (GCC 13 or newer) for
the sim.

## Flatpak

`flatpak/org.openvalence.Phosphor.yml` packages the `.deb` (Tauri binary and
sidecar) on the GNOME 50 runtime. GNOME, not bare freedesktop, because only the
GNOME runtime ships webkit2gtk-4.1. Verified by hand on WSL2 Arch under WSLg,
2026-10-04: CI's bundle and a local build both reach a live Virtual Valence
session at control tier with the catalog adopted.

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

- App data (logs, plugins, the sim's state) lives in
  `~/.var/app/org.openvalence.Phosphor/data/com.phosphor.app/`, the Tauri
  identifier nested under the Flatpak app id. A `.deb` install's
  `~/.local/share/com.phosphor.app/` is not visible to the Flatpak.
- The sidecar runs as `/app/bin/valencesim` inside the sandbox and exits on a
  normal close. A hard kill of `phosphor` leaves it running in the sandbox
  until `flatpak kill org.openvalence.Phosphor` (ph-y853).
- `fallback-x11` grants X11 only when there is no Wayland socket: forcing
  `GDK_BACKEND=x11` on a Wayland session panics with "Failed to initialize
  GTK" unless the run adds `--socket=x11`.

## Android (Pixel over adb)

Android Studio's SDK with build-tools, platform-tools, cmdline-tools and NDK
29, JDK 17 for Gradle (`JAVA_HOME` on it, whatever `java` is on PATH), and the four Rust Android targets
(`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`).
Set `ANDROID_HOME`, `NDK_HOME` (the `ndk/<version>` folder) and `JAVA_HOME`.

```sh
npx tauri android init --ci
npx tauri android build --apk --target aarch64 --debug --ci
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

- `src-tauri/gen/android` is generated from `tauri.conf.json` and gitignored.
  `init` never overwrites an existing project: after a config change, delete
  `src-tauri/gen/android` and run `init` again.
- `bundle.android.minSdkVersion` is 26, the BLE plugin's floor. Its Bluetooth
  and location permissions merge in from the plugin's own manifest; Tauri's
  template carries `INTERNET`. The debug app id is `com.phosphor.app.debug`.
- No sidecar on Android: `src-tauri/tauri.android.conf.json` drops
  `bundle.externalBin`, and Virtual Valence falls back to the catalog replay.
- A debug APK is debug-signed (about 230 MB, symbols kept). A release needs a
  keystore and a signing config in `gen/android/app/build.gradle.kts`, and
  `usesCleartextTraffic` set to true there: the template allows cleartext
  only in debug, and hubs speak plain `ws://` and `http://`.

## CI (`.github/workflows/build.yml`)

Runs on every push to `main`, every pull request, every `v*` tag and by hand.

| job | runner | produces (artifact) |
|---|---|---|
| `x86_64-pc-windows-msvc` | windows-latest | NSIS installer (`phosphor-x86_64-pc-windows-msvc`) |
| `aarch64-apple-darwin` | macos-latest | `.dmg` holding the ad-hoc signed `.app` (`phosphor-aarch64-apple-darwin`) |
| `x86_64-unknown-linux-gnu` | ubuntu-22.04 | `.deb` and `.AppImage` (`phosphor-x86_64-unknown-linux-gnu`) |
| `flatpak` | ubuntu-24.04, GNOME 50 container | `phosphor-x86_64.flatpak` |

Each bundle job checks out Phosphor, Nucleus (`main`), Valence at the sha in
Nucleus's `valence.pin` and ButtplugIO (`valence`), builds the sim (MinGW-w64
from MSYS2 on Windows, Apple Clang, GCC 13 on Ubuntu), names it for Tauri,
then runs tauri-action, whose `beforeBuildCommand` runs `npm run check`
first. A `v*` tag also opens one draft release with every bundle.

Before the first run can pass, the remote needs what the workflow checks out:

- `openvalence/ButtplugIO` with branch `valence` (the fork's `valence` branch
  exists only locally today; its `origin` is upstream buttplug).
- The `valence.pin` sha on `openvalence/Valence`, and the Nucleus sim
  portability commit on `openvalence/Nucleus` `main`.

Trigger: push the workflow (`git push` in Phosphor), or with the GitHub CLI
`gh workflow run build.yml -R openvalence/Phosphor`.
