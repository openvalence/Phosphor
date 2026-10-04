// icons.mjs -- regenerates every Phosphor and site icon from the sources in
// ../Valence/assets/icons (README there names the variants and sizes).
// Run: npm run icons
// Writes src-tauri/icons/, flatpak/org.openvalence.Phosphor.svg and
// ../openvalence.github.io/icons/ (site.webmanifest there is hand-written).
// Layers at 16 to 32 px come from icon-16.svg and icon-small.svg, never a
// downscale of the 1024.
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = root + '../Valence/assets/icons/';
const site = root + '../openvalence.github.io/icons/';
const out = root + 'src-tauri/icons/';
const CHASSIS = '#111318';
const tmp = mkdtempSync(join(tmpdir(), 'phosphor-icons-'));

const browser = await chromium.launch();
const page = await browser.newPage();

// pad: clear edge in px (the Windows ladder wants 1). mac: Apple's 824 px
// rounded square with its shadow inside the 1024 canvas. bg: fills the whole
// canvas (opaque icons: apple-touch, org avatar).
async function render(svg, size, file, { pad = 0, mac = false, bg = 'transparent' } = {}) {
  const uri = 'data:image/svg+xml;base64,' + readFileSync(src + svg).toString('base64');
  let body;
  if (mac) {
    const k = size / 1024, w = 824 * k, o = 100 * k;
    body = `<div style="position:absolute;left:${o}px;top:${o}px;width:${w}px;height:${w}px;border-radius:${185.4 * k}px;overflow:hidden;box-shadow:0 ${10 * k}px ${20 * k}px rgba(0,0,0,.3)"><img src="${uri}" style="display:block;width:${w}px;height:${w}px"></div>`;
  } else {
    body = `<img src="${uri}" style="position:absolute;left:${pad}px;top:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">`;
  }
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:${bg}">${body}</body>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: file, omitBackground: bg === 'transparent' });
  return file;
}

// ICO with PNG-encoded entries (Vista and later).
function writeIco(file, pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, data], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size & 255, e);
    head.writeUInt8(size & 255, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  writeFileSync(file, Buffer.concat([head, ...pngs.map(([, d]) => d)]));
}

const app = await render('icon-app.svg', 1024, join(tmp, 'app.png'));
const mac = await render('icon-app.svg', 1024, join(tmp, 'mac.png'), { mac: true });
execSync(`npx tauri icon "${app}" --ios-color "${CHASSIS}"`, { cwd: root, stdio: 'inherit' });
execSync(`npx tauri icon "${mac}" -o "${join(tmp, 'mac')}"`, { cwd: root, stdio: 'inherit' });
copyFileSync(join(tmp, 'mac', 'icon.icns'), out + 'icon.icns');

await render('icon-small.svg', 32, out + '32x32.png', { pad: 1 });
await render('icon-small.svg', 30, out + 'Square30x30Logo.png', { pad: 1 });
const layers = [];
for (const s of [16, 24, 32, 48, 64, 256]) {
  const svg = s === 16 ? 'icon-16.svg' : s <= 32 ? 'icon-small.svg' : 'icon-app.svg';
  const f = await render(svg, s, join(tmp, `ico-${s}.png`), { pad: 1 });
  layers.push([s, readFileSync(f)]);
}
writeIco(out + 'icon.ico', layers);

copyFileSync(src + 'icon-app.svg', root + 'flatpak/org.openvalence.Phosphor.svg');

mkdirSync(site, { recursive: true });
copyFileSync(src + 'icon-16.svg', site + 'favicon.svg');
await render('icon-small.svg', 32, site + 'favicon-32.png');
await render('icon-app.svg', 180, site + 'apple-touch-icon.png', { bg: CHASSIS });
await render('icon-app.svg', 512, site + 'icon-512.png');

await browser.close();
rmSync(tmp, { recursive: true, force: true });
