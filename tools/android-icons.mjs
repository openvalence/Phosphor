// android-icons.mjs -- copies src-tauri/icons/android/ into the generated
// Android project. Run after `tauri android init` (BUILD.md, Android); the
// android build scripts run it. The adaptive foreground is the vector in
// drawable/, so the template vector and any foreground PNG are removed.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = root + 'src-tauri/gen/android/app/src/main/res/';
if (!existsSync(res)) { console.error('android-icons: no ' + res + ', run `npx tauri android init --ci` first'); process.exit(1); }
cpSync(root + 'src-tauri/icons/android/', res, { recursive: true });
rmSync(res + 'drawable-v24/ic_launcher_foreground.xml', { force: true });
for (const d of readdirSync(res)) if (d.startsWith('mipmap-')) rmSync(res + d + '/ic_launcher_foreground.png', { force: true });
console.log('android-icons: copied into ' + res);
