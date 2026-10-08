// version.mjs -- the build version (docs/BUILD.md, "Versioning").
//   MAJOR.MINOR come from src-tauri/tauri.conf.json, whose committed patch is
//   always 0. PATCH is the number of commits since the tag base/MAJOR.MINOR
//   (the whole history when the tag is absent), so every build has its own
//   patch and nobody edits a number by hand.
// node tools/version.mjs             print it
// node tools/version.mjs --write     stamp tauri.conf.json, package.json and
//                                    the metainfo release (CI, before the
//                                    bundle; never commit the result)
// node tools/version.mjs --check     the committed bases agree (npm run check)
// node tools/version.mjs --tauri -- <args>   npx tauri build with the version
// node tools/version.mjs --android -- <args> npx tauri android build, same
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = {
  tauri: root + 'src-tauri/tauri.conf.json',
  pkg: root + 'package.json',
  meta: root + 'flatpak/org.openvalence.Phosphor.metainfo.xml',
};
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const base = () => JSON.parse(readFileSync(files.tauri, 'utf8')).version;

export function buildVersion() {
  const [major, minor] = base().split('.');
  let patch;
  try { patch = git('rev-list', '--count', `base/${major}.${minor}..HEAD`); }
  catch { patch = git('rev-list', '--count', 'HEAD'); }
  return `${major}.${minor}.${patch}`;
}

const argv = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (argv[0] === '--check') {
    const b = base();
    const pkg = JSON.parse(readFileSync(files.pkg, 'utf8')).version;
    const meta = (readFileSync(files.meta, 'utf8').match(/<release version="([^"]+)"/) || [])[1];
    const bad = [];
    if (!/^\d+\.\d+\.0$/.test(b)) bad.push(`tauri.conf.json version ${b}: the committed patch is 0, builds compute it`);
    if (pkg !== b) bad.push(`package.json ${pkg} != tauri.conf.json ${b}`);
    if (meta !== b) bad.push(`metainfo release ${meta} != tauri.conf.json ${b}`);
    if (bad.length) { console.error('version: ' + bad.join('; ')); process.exit(1); }
    console.log('version: base ' + b + ', next build ' + buildVersion());
  } else if (argv[0] === '--write') {
    const v = buildVersion();
    const stamp = (f, re, to) => writeFileSync(f, readFileSync(f, 'utf8').replace(re, to));
    stamp(files.tauri, /"version": "[^"]+"/, `"version": "${v}"`);
    stamp(files.pkg, /"version": "[^"]+"/, `"version": "${v}"`);
    stamp(files.meta, /<release version="[^"]+" date="[^"]+"\/>/, `<release version="${v}" date="${new Date().toISOString().slice(0, 10)}"/>`);
    console.log('version: ' + v);
  } else if (argv[0] === '--tauri' || argv[0] === '--android') {
    const v = buildVersion();
    const rest = argv.slice(argv[1] === '--' ? 2 : 1);
    console.log('version: ' + v);
    // A file, not inline JSON: the Windows shell strips the quotes from an argument.
    const cfg = root + 'src-tauri/target/version.conf.json';
    mkdirSync(root + 'src-tauri/target', { recursive: true });
    writeFileSync(cfg, JSON.stringify({ version: v }));
    const cmd = argv[0] === '--android' ? ['android', 'build'] : ['build'];
    execFileSync('npx', ['tauri', ...cmd, '--config', cfg, ...rest], { cwd: root, stdio: 'inherit', shell: true });
  } else {
    console.log(buildVersion());
  }
}
