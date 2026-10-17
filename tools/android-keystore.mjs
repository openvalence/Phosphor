// android-keystore.mjs -- creates the Android release keystore once (docs/BUILD.md,
// Android release). Run it once, keep the folder backed up off this machine:
// a lost key means no update can install over the released app.
//   node tools/android-keystore.mjs [folder]
// folder defaults to ~/Documents/phosphor-android-signing and must be outside the repo.
// Writes phosphor-release.jks, keystore.properties (read by the Gradle build)
// and github-secrets.env (the CI secrets, for gh secret set -f). Prints no secret:
// only paths, the certificate's SHA-256 fingerprint and the gh command.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = resolve(process.argv[2] || join(homedir(), 'Documents', 'phosphor-android-signing'));
const rel = relative(root, dir);
if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error('android-keystore: ' + dir + ' is inside the repo; pick a folder outside it'); process.exit(1); }
const jks = join(dir, 'phosphor-release.jks');
if (existsSync(jks)) { console.error('android-keystore: ' + jks + ' exists; never replace a release key'); process.exit(1); }

const exe = process.platform === 'win32' ? 'keytool.exe' : 'keytool';
const keytool = process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', exe)) ? join(process.env.JAVA_HOME, 'bin', exe) : 'keytool';
const pass = randomBytes(32).toString('base64url');
// The password reaches keytool through its environment, never the command line.
const run = (args, stdout) => execFileSync(keytool, args, {
  env: { ...process.env, PHOSPHOR_KS_PASS: pass }, encoding: 'utf8', windowsHide: true, stdio: ['ignore', stdout, 'ignore'],
});

mkdirSync(dir, { recursive: true });
run(['-genkeypair', '-keystore', jks, '-storetype', 'PKCS12', '-alias', 'phosphor', '-keyalg', 'RSA', '-keysize', '4096',
  '-validity', '10000', '-dname', 'CN=Phosphor, O=OpenValence', '-storepass:env', 'PHOSPHOR_KS_PASS', '-keypass:env', 'PHOSPHOR_KS_PASS'], 'ignore');
const sha = (run(['-list', '-v', '-keystore', jks, '-alias', 'phosphor', '-storepass:env', 'PHOSPHOR_KS_PASS'], 'pipe')
  .match(/SHA256:\s*([0-9A-F:]{95})/) || [])[1];
if (!sha) { console.error('android-keystore: keytool listed no SHA-256 fingerprint for ' + jks); process.exit(1); }

const secret = { mode: 0o600 };
writeFileSync(join(dir, 'keystore.properties'), `storeFile=${jks.replaceAll('\\', '/')}\npassword=${pass}\nkeyAlias=phosphor\n`, secret);
writeFileSync(join(dir, 'github-secrets.env'), `ANDROID_KEYSTORE_B64=${readFileSync(jks).toString('base64')}\nANDROID_KEYSTORE_PASSWORD=${pass}\n`, secret);

console.log(`android-keystore: wrote ${jks}
  and keystore.properties, github-secrets.env beside it.
certificate SHA-256: ${sha}
  (record it in docs/BUILD.md and the website downloads page)

GitHub secrets for CI (read from the file, never typed):
  gh secret set -f "${join(dir, 'github-secrets.env')}" -R openvalence/Phosphor

Back up ${dir} off this machine. Local release builds read keystore.properties
from the default folder, or from the file ANDROID_KEYSTORE_PROPERTIES names.`);
