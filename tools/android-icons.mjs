// android-icons.mjs -- copies src-tauri/icons/android/ and the activity
// (src-tauri/android/MainActivity.kt) into the generated Android project.
// Run after `tauri android init` (BUILD.md, Android); the android build
// scripts run it. The adaptive foreground is the vector in drawable/, so the
// template vector and any foreground PNG are removed. It also adds WAKE_LOCK to the
// generated manifest (MainActivity's Wi-Fi lock needs it); the manifest itself is not tracked.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const main = root + 'src-tauri/gen/android/app/src/main/';
const res = main + 'res/';
if (!existsSync(res)) { console.error('android-icons: no ' + res + ', run `npx tauri android init --ci` first'); process.exit(1); }
cpSync(root + 'src-tauri/icons/android/', res, { recursive: true });
rmSync(res + 'drawable-v24/ic_launcher_foreground.xml', { force: true });
for (const d of readdirSync(res)) if (d.startsWith('mipmap-')) rmSync(res + d + '/ic_launcher_foreground.png', { force: true });
cpSync(root + 'src-tauri/android/MainActivity.kt', main + 'java/com/phosphor/app/MainActivity.kt');
const mf = main + 'AndroidManifest.xml';
const xml = readFileSync(mf, 'utf8');
if (!xml.includes('android.permission.WAKE_LOCK')) {
  const at = xml.indexOf('<uses-permission');
  if (at < 0) { console.error('android-icons: no uses-permission anchor in ' + mf); process.exit(1); }
  writeFileSync(mf, xml.slice(0, at) + '<uses-permission android:name="android.permission.WAKE_LOCK" />\n    ' + xml.slice(at));
}
const app = root + 'src-tauri/gen/android/app/';
cpSync(root + 'src-tauri/android/signing.gradle.kts', app + 'signing.gradle.kts');
const gradle = app + 'build.gradle.kts';
const kts = readFileSync(gradle, 'utf8');
if (!kts.includes('apply(from = "signing.gradle.kts")')) writeFileSync(gradle, kts.trimEnd() + '\n\napply(from = "signing.gradle.kts")\n');
console.log('android-icons: copied into ' + main);
