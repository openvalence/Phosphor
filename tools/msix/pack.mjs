// pack.mjs -- builds phosphor-x86_64.msix from a Tauri release build.
// Run: node tools/msix/pack.mjs [--exe-dir <dir>] [--test-sign]
//   --exe-dir   where phosphor.exe is (default src-tauri/target/release)
//   --test-sign sign with a local self-signed cert (created on first use)
// Output and layout: src-tauri/target/msix/. docs/BUILD.md, MSIX section.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVersion } from '../version.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const here = root + 'tools/msix/';
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
const exeDir = (opt('--exe-dir') || root + 'src-tauri/target/release').replace(/[\/]$/, '') + '/';
const out = root + 'src-tauri/target/msix/';
const layout = out + 'layout/';
const msix = out + 'phosphor-x86_64.msix';

const id = JSON.parse(readFileSync(here + 'identity.json', 'utf8'));
const conf = JSON.parse(readFileSync(root + 'src-tauri/tauri.conf.json', 'utf8'));
const semver = buildVersion();
// The Store wants a.b.c.0: the fourth field is reserved for it.
const version = semver.split(/[-+]/)[0] + '.0';

const kits = 'C:/Program Files (x86)/Windows Kits/10/bin/';
const sdk = existsSync(kits) && readdirSync(kits).filter((v) => existsSync(kits + v + '/x64/makeappx.exe'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
if (!sdk) { console.error('msix: no makeappx.exe under ' + kits + '; install the Windows SDK'); process.exit(1); }
const tool = (name) => kits + sdk + '/x64/' + name;
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit', windowsHide: true });

const sidecar = root + 'src-tauri/binaries/valencesim-x86_64-pc-windows-msvc.exe';
for (const f of [exeDir + 'phosphor.exe', sidecar]) {
  if (!existsSync(f)) { console.error('msix: missing ' + f + '; run npx tauri build (and npm run sidecar) first'); process.exit(1); }
}

rmSync(layout, { recursive: true, force: true });
mkdirSync(layout + 'Assets', { recursive: true });
copyFileSync(exeDir + 'phosphor.exe', layout + 'phosphor.exe');
// Tauri's sidecar lookup is <exe dir>/valencesim.exe, the name the NSIS bundle installs.
copyFileSync(sidecar, layout + 'valencesim.exe');
for (const a of ['StoreLogo', 'Square44x44Logo', 'Square71x71Logo', 'Square150x150Logo']) {
  copyFileSync(root + 'src-tauri/icons/' + a + '.png', layout + 'Assets/' + a + '.png');
}
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
writeFileSync(layout + 'AppxManifest.xml', readFileSync(here + 'AppxManifest.xml', 'utf8')
  .replace('{{IDENTITY_NAME}}', xml(id.name)).replace('{{PUBLISHER}}', xml(id.publisher))
  .replace('{{PUBLISHER_DISPLAY}}', xml(id.publisherDisplay)).replace('{{VERSION}}', version));

run(tool('makeappx.exe'), ['pack', '/o', '/d', layout, '/p', msix]);

if (argv.includes('--test-sign')) {
  // Local trust only: never commit the .pfx. Its Subject must equal the manifest Publisher.
  const pfx = out + 'test.pfx', cer = out + 'test.cer', pass = 'phosphor-test';
  if (!existsSync(pfx)) {
    run('pwsh.exe', ['-NoProfile', '-Command',
      `$c = New-SelfSignedCertificate -Type Custom -Subject '${id.publisher.replace(/'/g, "''")}' -KeyUsage DigitalSignature ` +
      `-FriendlyName 'Phosphor MSIX test' -CertStoreLocation Cert:/CurrentUser/My ` +
      `-TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}'); ` +
      `Export-PfxCertificate -Cert $c -FilePath '${pfx}' -Password (ConvertTo-SecureString '${pass}' -AsPlainText -Force) | Out-Null; ` +
      `Export-Certificate -Cert $c -FilePath '${cer}' | Out-Null`]);
  }
  run(tool('signtool.exe'), ['sign', '/fd', 'SHA256', '/f', pfx, '/p', pass, msix]);
}
console.log('msix: ' + msix + ' (' + version + ', SDK ' + sdk + ')');
