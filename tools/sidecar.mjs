// sidecar.mjs -- copies valencesim to the name Tauri's externalBin wants:
// src-tauri/binaries/valencesim-<host triple>[.exe] (tauri.conf.json).
// Run: npm run sidecar [-- <path to valencesim(.exe)>]
// Default source: ../Nucleus/sim/valencesim/build/.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const exe = process.platform === 'win32' ? '.exe' : '';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = process.argv[2] || root + '../Nucleus/sim/valencesim/build/valencesim' + exe;
const triple = execSync('rustc -vV', { encoding: 'utf8' }).match(/^host: (\S+)/m)[1];
const dst = root + 'src-tauri/binaries/valencesim-' + triple + exe;
if (!existsSync(src)) {
  console.error('sidecar: no valencesim at ' + src + '; build it (Nucleus/sim/valencesim) or pass its path');
  process.exit(1);
}
mkdirSync(root + 'src-tauri/binaries', { recursive: true });
copyFileSync(src, dst);
console.log('sidecar: ' + src + ' -> ' + dst);
