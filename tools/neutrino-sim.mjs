/**
 * neutrino-sim.mjs -- the Neutrino dev tool's machine: the native Nucleus device twin, built from the sibling
 * Nucleus checkout at the commit neutrino/neutrino-native.pin names, with Kinetic at that Nucleus's kinetic.pin,
 * and placed where Tauri takes its sidecar (neutrino/src-tauri/binaries/neutrino-sim-<host triple>[.exe]).
 *
 * Run: node tools/neutrino-sim.mjs           the sidecar for the pin: kept when its stamp matches, else built
 *      node tools/neutrino-sim.mjs --write   pin Nucleus HEAD (clean), then build
 *
 * Constraints: a build needs Nucleus clean at the pinned sha (its lib/valence link rules out a worktree); Kinetic
 * comes from a temporary detached worktree of ../Kinetic. Windows builds with WinLibs MinGW (NEUTRINO_MINGW or
 * the WinGet path), CMake and Ninja; macOS and Linux with the system compiler. The build dir persists under
 * neutrino/src-tauri/target/neutrino-sim and reuses the Nucleus build's patched IXWebSocket when present.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The twin's home in Nucleus and its CMake target.
const TWIN = { dir: 'sim/neutrino', target: 'neutrino-sim' };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'neutrino');
const PIN = join(APP, 'neutrino-native.pin');
const NUCLEUS = process.env.NUCLEUS_DIR || join(ROOT, '..', 'Nucleus');
const KINETIC = process.env.KINETIC_DIR || join(NUCLEUS, '..', 'Kinetic');
const VALENCE = process.env.VALENCE_DIR || join(NUCLEUS, '..', 'Valence');
const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';
const MINGW = process.env.NEUTRINO_MINGW || 'C:\\Users\\Atlan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\\mingw64\\bin';

const fail = (m) => { console.log('neutrino-sim: FAIL ' + m); process.exit(1); };
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
// The board's beads export is never source: a modified .beads/ does not make a build dirty.
const dirty = () => git(NUCLEUS, 'status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).beads');

const triple = (execFileSync('rustc', ['-vV'], { encoding: 'utf8', windowsHide: true }).match(/^host: (\S+)/m) || [])[1];
if (!triple) fail('rustc -vV names no host triple');
const BIN_DIR = join(APP, 'src-tauri', 'binaries');
const SIDECAR = join(BIN_DIR, 'neutrino-sim-' + triple + EXE);
const STAMP = join(BIN_DIR, 'neutrino-sim.stamp');

function readPin() {
  try { return (readFileSync(PIN, 'utf8').match(/^nucleus ([0-9a-f]{40})$/m) || [])[1] || ''; } catch { return ''; }
}

function build(sha) {
  if (git(NUCLEUS, 'rev-parse', 'HEAD') !== sha) fail('Nucleus HEAD is not the pin ' + sha.slice(0, 12) + ': check it out, or --write to pin HEAD');
  if (dirty()) fail('Nucleus has uncommitted changes: a dirty build is never pinned');
  const kin = (git(NUCLEUS, 'show', sha + ':kinetic.pin').match(/^[0-9a-f]{40}$/m) || [])[0];
  if (!kin) fail('Nucleus ' + sha.slice(0, 12) + ' has no kinetic.pin sha');
  const tmp = mkdtempSync(join(tmpdir(), 'neutrino-sim-'));
  const kdir = join(tmp, 'kinetic');
  const out = join(APP, 'src-tauri', 'target', 'neutrino-sim');
  try {
    try { git(KINETIC, 'worktree', 'add', '--detach', kdir, kin); } catch (e) {
      fail('cannot check out Kinetic ' + kin.slice(0, 12) + ' from ' + KINETIC + ': ' + String(e.stderr || e.message).trim());
    }
    // A build dir configured from another source (a moved twin, another Nucleus checkout) is refused by CMake.
    const cache = join(out, 'CMakeCache.txt');
    const home = existsSync(cache) && (readFileSync(cache, 'utf8').match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.*)$/m) || [])[1];
    if (home && resolve(home).toLowerCase() !== resolve(NUCLEUS, TWIN.dir).toLowerCase()) rmSync(out, { recursive: true, force: true });
    const env = { ...process.env };
    const args = ['-S', join(NUCLEUS, TWIN.dir), '-B', out, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
      '-DKINETIC_ROOT=' + kdir, '-DVALENCE_ROOT=' + VALENCE];
    if (WIN) {
      env.PATH = MINGW + delimiter + env.PATH;
      args.push('-DCMAKE_CXX_COMPILER=g++', '-DCMAKE_C_COMPILER=gcc');
    }
    const ix = join(NUCLEUS, TWIN.dir, 'build', '_deps', 'ixwebsocket-src');
    if (existsSync(ix)) args.push('-DFETCHCONTENT_SOURCE_DIR_IXWEBSOCKET=' + ix);
    const run = (a) => execFileSync('cmake', a, { env, stdio: 'inherit', windowsHide: true });
    run(args);
    run(['--build', out]);
    mkdirSync(BIN_DIR, { recursive: true });
    copyFileSync(join(out, TWIN.target + EXE), SIDECAR);
    if (!WIN) chmodSync(SIDECAR, 0o755);
    writeFileSync(STAMP, sha + '\n');
  } finally {
    try { git(KINETIC, 'worktree', 'remove', '--force', kdir); } catch { /* never added */ }
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log('neutrino-sim: built Nucleus ' + sha.slice(0, 12) + ' (Kinetic ' + kin.slice(0, 12) + ') -> ' + SIDECAR);
}

if (process.argv.includes('--write')) {
  if (dirty()) fail('Nucleus has uncommitted changes: a dirty build is never pinned');
  const sha = git(NUCLEUS, 'rev-parse', 'HEAD');
  writeFileSync(PIN, '# The Nucleus commit the Neutrino dev tool\'s native machine is built from; bump with node tools/neutrino-sim.mjs --write.\nnucleus ' + sha + '\n');
  build(sha);
  process.exit(0);
}

const sha = readPin();
if (!sha) fail(PIN + ' names no nucleus sha');
const stamped = existsSync(SIDECAR) && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === sha;
if (stamped) console.log('neutrino-sim: sidecar matches the pin, Nucleus ' + sha.slice(0, 12));
else build(sha);
