/**
 * effect-lab.mjs -- serves test/effect-lab.html and screenshots each
 * candidate at fixed moments (ph-vdk.62, docs/EFFECTS.md). Not a gate.
 *
 * Constraints:
 * - Moments are frozen through the Web Animations API (window.lab.at), so a
 *   shot is the same on every run whatever the machine's speed.
 * - Shots go to --out (default: the OS temp dir), never into the repo.
 *
 * Run: node test/effect-lab.mjs [--out <dir>] [--theme "FF8A4D FFD24D"]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const OUT = argOf('--out', join(tmpdir(), 'effect-lab'));
const THEME = argOf('--theme', '');
mkdirSync(OUT, { recursive: true });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = createServer((q, s) => {
  const p = normalize(join(ROOT, decodeURIComponent(q.url.split('?')[0])));
  if (!p.startsWith(normalize(ROOT))) { s.writeHead(403); s.end(); return; }
  try { s.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); s.end(readFileSync(p)); }
  catch { s.writeHead(404); s.end(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:' + srv.address().port + '/test/effect-lab.html');
await page.evaluate(() => document.fonts.ready);
if (THEME) await page.evaluate((t) => window.lab.theme(t), THEME);
const tag = THEME ? '-' + THEME.split(' ')[0] : '';
const shots = [];
for (const [ms, name] of [[120, 't0'], [2000, 't2s'], [5000, 't5s']]) {
  await page.evaluate((ms) => window.lab.at(ms), ms);
  for (const id of ['A', 'B', 'C']) {
    const file = join(OUT, 'fx-' + id + tag + '-' + name + '.png');
    await page.locator('.cand[data-fx=' + id + ']').screenshot({ path: file });
    shots.push(file);
  }
}
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.evaluate(() => document.documentElement.classList.add('rm'));
await page.evaluate(() => window.lab.at(2000));
for (const id of ['A', 'B', 'C']) {
  const file = join(OUT, 'fx-' + id + tag + '-reduced.png');
  await page.locator('.cand[data-fx=' + id + ']').screenshot({ path: file });
  shots.push(file);
}
console.log(shots.join('\n'));
await browser.close();
srv.close();
