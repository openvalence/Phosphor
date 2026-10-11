/**
 * integral-pin.mjs -- the vendored built-in machine (src/model/integral/: integral.js and bytes.js, the wasm)
 * is the Nucleus build named in src/model/integral/integral.pin (docs/BUILD.md, The built-in machine).
 *
 * Always: both files match the pin's sizes and SHA-256, and the machine boots and prints the pinned etag.
 * With --rebuild, emsdk (../.tools/emsdk or $EMSDK) and the sibling Nucleus clean at the pinned sha: rebuilds
 * sim/valencesim/wasm into a temp dir and byte-compares. Otherwise prints why it skipped and passes.
 *
 * Every build compiles Kinetic at the sha in that Nucleus's kinetic.pin, from a temporary detached worktree of
 * the sibling Kinetic ($KINETIC_DIR or ../Kinetic), never its HEAD; a missing pin or sha fails the build.
 *
 * Run: node test/integral-pin.mjs             check
 *      node test/integral-pin.mjs --rebuild   check, then rebuild and compare
 *      node test/integral-pin.mjs --write     build from Nucleus HEAD (clean), Kinetic at its kinetic.pin, and rewrite the vendored files and the pin
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IDIR = join(ROOT, 'src', 'model', 'integral');
const NUCLEUS = process.env.NUCLEUS_DIR || join(ROOT, '..', 'Nucleus');
const EMSDK = process.env.EMSDK || join(ROOT, '..', '.tools', 'emsdk');
const KINETIC = process.env.KINETIC_DIR || join(NUCLEUS, '..', 'Kinetic');
const WRITE = process.argv.includes('--write');
const REBUILD = process.argv.includes('--rebuild');
const fail = (m) => { console.log('integral-pin: FAIL ' + m); process.exit(1); };
const git = (...a) => execFileSync('git', ['-C', NUCLEUS, ...a], { encoding: 'utf8', windowsHide: true }).trim();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
// The board's beads export is never source: a modified .beads/ does not make a build dirty.
const dirty = () => git('status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).beads');

/** The Kinetic sha Nucleus pins; fails when the pin is missing or malformed. */
function kineticPin() {
  let text = '';
  try { text = readFileSync(join(NUCLEUS, 'kinetic.pin'), 'utf8'); } catch { fail('no kinetic.pin in ' + NUCLEUS); }
  const sha = (text.match(/^[0-9a-f]{40}$/m) || [])[0];
  if (!sha) fail('kinetic.pin in ' + NUCLEUS + ' holds no 40-hex sha');
  return sha;
}

function build() {
  const em = join(EMSDK, 'upstream', 'emscripten');
  const exe = process.platform === 'win32' ? '.exe' : '';
  const env = { ...process.env, EMSDK, EM_CONFIG: join(EMSDK, '.emscripten'), PATH: EMSDK + delimiter + em + delimiter + process.env.PATH };
  const kin = kineticPin();
  const out = mkdtempSync(join(tmpdir(), 'integral-pin-'));
  const kdir = join(out, 'kinetic');
  const kgit = (...a) => execFileSync('git', ['-C', KINETIC, ...a], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  try {
    try { kgit('worktree', 'add', '--detach', kdir, kin); } catch (e) {
      fail('cannot check out Kinetic ' + kin.slice(0, 12) + ' (kinetic.pin) from ' + KINETIC + ': ' + String(e.stderr || e.message).trim());
    }
    const run = (cmd, args) => execFileSync(cmd, args, { cwd: NUCLEUS, env, stdio: 'pipe', windowsHide: true });
    run(join(em, 'emcmake' + exe), ['cmake', '-S', 'sim/valencesim/wasm', '-B', join(out, 'build'), '-G', 'Ninja', '-DKINETIC_ROOT=' + kdir]);
    run('cmake', ['--build', join(out, 'build')]);
    return { kin, glue: readFileSync(join(out, 'build', 'integral.js')), wasm: readFileSync(join(out, 'build', 'integral.wasm')) };
  } finally {
    try { kgit('worktree', 'remove', '--force', kdir); } catch { /* never added */ }
    rmSync(out, { recursive: true, force: true });
  }
}

/** Boots the machine from these bytes; the boot banner's etag. */
async function bootEtag(wasm) {
  const lines = [];
  const { default: createIntegral } = await import(pathToFileURL(join(IDIR, 'integral.js')).href);
  const M = await createIntegral({
    print: (l) => lines.push(l), printErr: (l) => lines.push(l),
    instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance)); return {}; },
  });
  const o = M.stringToNewUTF8('{}');
  if (M._integral_create(o, 0, 0) !== 1) fail('integral_create refused');
  return (lines.join('\n').match(/etag ([0-9a-f]+)/) || [])[1] || '';
}

const hasEmsdk = existsSync(join(EMSDK, 'upstream', 'emscripten'));

if (WRITE) {
  if (!hasEmsdk) fail('--write needs emsdk at ' + EMSDK);
  if (dirty()) fail('Nucleus has uncommitted changes: a dirty build is never vendored');
  const sha = git('rev-parse', 'HEAD');
  const { kin, glue, wasm } = build();
  writeFileSync(join(IDIR, 'integral.js'), glue);
  writeFileSync(join(IDIR, 'bytes.js'), '// integral.wasm from Nucleus ' + sha + ' (integral.pin). Written by test/integral-pin.mjs --write; never edit.\n'
    + 'export const WASM = \'' + wasm.toString('base64') + '\';\n');
  const etag = await bootEtag(wasm);
  writeFileSync(join(IDIR, 'integral.pin'), '# The Nucleus commit integral.js and integral.wasm (bytes.js) were built from; bump with node test/integral-pin.mjs --write.\n'
    + 'nucleus ' + sha + '\nkinetic ' + kin + '\netag ' + etag + '\nwasm ' + wasm.length + ' ' + sha256(wasm) + '\nglue ' + glue.length + ' ' + sha256(glue) + '\n');
  console.log('integral-pin: wrote ' + wasm.length + ' B wasm, ' + glue.length + ' B glue, etag ' + etag + ', Nucleus ' + sha.slice(0, 12) + ', Kinetic ' + kin.slice(0, 12) + ' (kinetic.pin)');
  process.exit(0);
}

const pin = Object.fromEntries(readFileSync(join(IDIR, 'integral.pin'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1).split(' ')]));
if (!pin.nucleus || !pin.etag || !pin.wasm || !pin.glue) fail('integral.pin lacks nucleus, etag, wasm or glue');
const wasm = Buffer.from((await import('../src/model/integral/bytes.js')).WASM, 'base64');
const glue = readFileSync(join(IDIR, 'integral.js'));
for (const [name, b] of [['wasm', wasm], ['glue', glue]]) {
  if (Number(pin[name][0]) !== b.length || pin[name][1] !== sha256(b)) fail(name + ' is ' + b.length + ' B ' + sha256(b) + ', integral.pin says ' + pin[name].join(' '));
}
const etag = await bootEtag(wasm);
if (etag !== pin.etag[0]) fail('the machine boots with etag ' + etag + ', integral.pin says ' + pin.etag[0]);
console.log('integral-pin: PASS, ' + wasm.length + ' B wasm and the glue match the pin, boots with etag ' + etag);

if (!REBUILD) process.exit(0);
if (!hasEmsdk) { console.log('integral-pin: rebuild skipped: no emsdk'); process.exit(0); }
let head = '';
try { head = git('rev-parse', 'HEAD'); } catch { console.log('integral-pin: rebuild skipped: no Nucleus checkout'); process.exit(0); }
if (head !== pin.nucleus[0]) { console.log('integral-pin: rebuild skipped: Nucleus HEAD ' + head.slice(0, 12) + ' is not the pin'); process.exit(0); }
if (dirty()) { console.log('integral-pin: rebuild skipped: Nucleus is dirty'); process.exit(0); }
const re = build();
if (!re.wasm.equals(wasm) || !re.glue.equals(glue)) fail('the rebuild differs from the vendored files');
console.log('integral-pin: PASS, the rebuild at ' + head.slice(0, 12) + ' is byte-identical');
