/**
 * kinetic-pin.mjs -- the vendored kinetic.wasm (plugins/factory/funscript-player/kinetic/bytes.js)
 * is the Nucleus build named in kinetic/kinetic.pin (docs/plugins/FUNSCRIPT.md, Kinetic).
 *
 * Always: the vendored bytes instantiate and report the pinned version string, a Kinetic² build, never -dirty.
 * With --rebuild, emsdk (../.tools/emsdk or $EMSDK) and the sibling Nucleus clean at the pinned sha: rebuilds
 * tools/kinetic-wasm into a temp dir and byte-compares. Otherwise prints why it skipped and passes.
 *
 * Run: node test/kinetic-pin.mjs           check
 *      node test/kinetic-pin.mjs --rebuild check, then rebuild and compare
 *      node test/kinetic-pin.mjs <wasm>    check that file in place of bytes.js (or KINETIC_WASM=<wasm>)
 *      node test/kinetic-pin.mjs --write   build from Nucleus HEAD (clean) and rewrite bytes.js and kinetic.pin
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KDIR = join(ROOT, 'plugins', 'factory', 'funscript-player', 'kinetic');
const NUCLEUS = process.env.NUCLEUS_DIR || join(ROOT, '..', 'Nucleus'); // a clean worktree when the checkout's beads export dirties it
const EMSDK = process.env.EMSDK || join(ROOT, '..', '.tools', 'emsdk');
const WRITE = process.argv.includes('--write');
const REBUILD = process.argv.includes('--rebuild');
const WASM_PATH = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.KINETIC_WASM;
const KERNEL = / kinetic2 /;
const fail = (m) => { console.log('kinetic-pin: FAIL ' + m); process.exit(1); };
const git = (...a) => execFileSync('git', ['-C', NUCLEUS, ...a], { encoding: 'utf8', windowsHide: true }).trim();

async function versionOf(bytes) {
  const k = (await WebAssembly.instantiate(bytes, {})).instance.exports;
  k._initialize();
  const m = new Uint8Array(k.memory.buffer), p = k.kinetic_version();
  let e = p;
  while (m[e]) e++;
  return new TextDecoder().decode(m.subarray(p, e));
}

function build() {
  const em = join(EMSDK, 'upstream', 'emscripten');
  const exe = process.platform === 'win32' ? '.exe' : '';
  const env = { ...process.env, EMSDK, PATH: EMSDK + delimiter + em + delimiter + process.env.PATH };
  const out = mkdtempSync(join(tmpdir(), 'kinetic-pin-'));
  try {
    const run = (cmd, args) => execFileSync(cmd, args, { cwd: NUCLEUS, env, stdio: 'pipe', windowsHide: true });
    run(join(em, 'emcmake' + exe), ['cmake', '-S', 'tools/kinetic-wasm', '-B', out, '-G', 'Ninja']);
    run('cmake', ['--build', out]);
    return new Uint8Array(readFileSync(join(out, 'kinetic.wasm')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const pinText = existsSync(join(KDIR, 'kinetic.pin')) ? readFileSync(join(KDIR, 'kinetic.pin'), 'utf8') : '';
const pin = Object.fromEntries(pinText.split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]));
const hasEmsdk = existsSync(join(EMSDK, 'upstream', 'emscripten'));

if (WRITE) {
  if (!hasEmsdk) fail('--write needs emsdk at ' + EMSDK);
  if (git('status', '--porcelain', '--untracked-files=no')) fail('Nucleus has uncommitted changes: a -dirty build is never vendored');
  const sha = git('rev-parse', 'HEAD');
  const bytes = build();
  const version = await versionOf(bytes);
  if (/dirty|unknown/.test(version) || !KERNEL.test(version)) fail('built ' + version);
  writeFileSync(join(KDIR, 'bytes.js'), '// kinetic.wasm from Nucleus ' + sha + ' (kinetic.pin). Written by test/kinetic-pin.mjs --write; never edit.\n'
    + 'export const WASM = \'' + Buffer.from(bytes).toString('base64') + '\';\n');
  writeFileSync(join(KDIR, 'kinetic.pin'), '# The Nucleus commit kinetic.wasm (bytes.js) was built from; bump with node test/kinetic-pin.mjs --write.\n'
    + 'nucleus ' + sha + '\nversion ' + version + '\nbytes ' + bytes.length + '\n');
  console.log('kinetic-pin: wrote ' + bytes.length + ' B, ' + version);
  process.exit(0);
}

if (!pin.nucleus || !pin.version) fail('kinetic.pin lacks nucleus or version');
const vendored = WASM_PATH ? new Uint8Array(readFileSync(WASM_PATH))
  : new Uint8Array(Buffer.from((await import('../plugins/factory/funscript-player/kinetic/bytes.js')).WASM, 'base64'));
const version = await versionOf(vendored);
if (!KERNEL.test(version)) fail('"' + version + '" is not a Kinetic² build');
if (version !== pin.version) fail('bytes.js reports "' + version + '", kinetic.pin says "' + pin.version + '"');
if (!version.includes(pin.nucleus.slice(0, 12)) || /dirty/.test(version)) fail('version "' + version + '" is not a clean build of ' + pin.nucleus);
if (Number(pin.bytes) !== vendored.length) fail('bytes.js holds ' + vendored.length + ' B, kinetic.pin says ' + pin.bytes);
console.log('kinetic-pin: bytes.js is ' + version + ' (' + vendored.length + ' B)');

if (!REBUILD) process.exit(0);
if (!hasEmsdk) { console.log('kinetic-pin: rebuild skipped: no emsdk'); process.exit(0); }
let head = '';
try { head = git('rev-parse', 'HEAD'); } catch { console.log('kinetic-pin: rebuild skipped: no Nucleus checkout'); process.exit(0); }
if (head !== pin.nucleus) { console.log('kinetic-pin: rebuild skipped: Nucleus HEAD ' + head.slice(0, 12) + ' is not the pin'); process.exit(0); }
if (git('status', '--porcelain', '--untracked-files=no')) { console.log('kinetic-pin: rebuild skipped: Nucleus is dirty'); process.exit(0); }
const rebuilt = build();
if (rebuilt.length !== vendored.length || rebuilt.some((b, i) => b !== vendored[i])) fail('the rebuild differs from bytes.js');
console.log('kinetic-pin: PASS, the rebuild at ' + head.slice(0, 12) + ' is byte-identical');
