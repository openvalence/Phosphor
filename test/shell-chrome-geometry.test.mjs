/**
 * shell-chrome-geometry.test.mjs -- does the top strip stack flush (T22)?
 *
 * One strip (ui/TopStrip.svelte) holds every top bar and sits in flow, sticky
 * at top 0, so there is no reserve to double-count. The shell's row is not in
 * the device bundle, so this simulates it: a 34px block prepended inside the
 * strip, which is exactly where TopStrip mounts ShellStrip.
 *
 * Deliberately NOT part of `npm run check`: that script runs inside every
 * firmware build (build_webui.py), and launching a browser there would put a
 * headless Chromium in the path of `pio run`. Run it via `npm run check:shell`
 * when chrome layout, the LinkBar, or the safe-area insets move.
 *
 * Run: node test/shell-chrome-geometry.test.mjs   (no device needed)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const srv = createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.topstrip .linkbar', { timeout: 15000 });

const ROW = 34;   // a plausible shell row height

const geom = () => page.evaluate(() => {
  const strip = document.querySelector('.topstrip').getBoundingClientRect();
  const lb = document.querySelector('.linkbar').getBoundingClientRect();
  const fake = document.querySelector('#fake-shell');
  const app = document.querySelector('.app').getBoundingClientRect();
  const bottomFixed = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return cs.position === 'fixed' && cs.pointerEvents !== 'none' && b.height > 0 && b.bottom >= innerHeight - 1;
  }).length;
  return { stripTop: strip.top, stripL: strip.left, stripW: strip.width, lbTop: lb.top,
           fakeBottom: fake ? fake.getBoundingClientRect().bottom : null,
           appH: app.height, vw: document.documentElement.clientWidth, vh: innerHeight, bottomFixed,
           scrolls: document.scrollingElement.scrollHeight > innerHeight + 2 };
});

// ---- served page: no shell row ---------------------------------------------
let g = await geom();
ok('no shell: strip flush at the viewport top', Math.abs(g.stripTop) < 1, 'top=' + g.stripTop);
ok('no shell: strip spans the window', Math.abs(g.stripL) < 1 && Math.abs(g.stripW - g.vw) < 1, g.stripL + '+' + g.stripW + ' vs ' + g.vw);
ok('no shell: LinkBar is the strip\'s first row', Math.abs(g.lbTop - g.stripTop) < 1);
ok('no shell: desktop column is exactly one viewport', Math.abs(g.appH - g.vh) < 2, g.appH + ' vs ' + g.vh);
ok('no shell: page does not scroll', !g.scrolls);
ok('nothing fixed to the bottom edge', g.bottomFixed === 0, g.bottomFixed + ' element(s)');

// ---- with a simulated shell row ----------------------------------------------
await page.evaluate((h) => {
  const row = document.createElement('div');
  row.id = 'fake-shell';
  row.style.cssText = 'height:' + h + 'px;background:#123';
  document.querySelector('.topstrip').prepend(row);
}, ROW);
await page.waitForTimeout(300);
g = await geom();
ok('shell: the row is flush at the top', Math.abs(g.stripTop) < 1 && Math.abs(g.fakeBottom - ROW) < 1, 'rowBottom=' + g.fakeBottom);
ok('shell: LinkBar starts exactly where the row ends', Math.abs(g.lbTop - g.fakeBottom) < 1, 'lbTop=' + g.lbTop);
ok('shell: desktop column still exactly one viewport', Math.abs(g.appH - g.vh) < 2, g.appH + ' vs ' + g.vh);
ok('shell: page still does not scroll', !g.scrolls);

// ---- phone: the page scrolls; the strip sticks, the tabs park under it --------
await page.setViewportSize({ width: 420, height: 800 });
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(300);
g = await geom();
const tabs = await page.evaluate(() => {
  const t = document.querySelector('nav.tabs');
  return t && getComputedStyle(t).position === 'sticky' ? t.getBoundingClientRect().top : null;
});
ok('phone scrolled: strip stays at the top', Math.abs(g.stripTop) < 1, 'top=' + g.stripTop);
ok('phone scrolled: shell row still leads the strip', Math.abs(g.fakeBottom - ROW) < 1);
const stripBottom = await page.evaluate(() => document.querySelector('.topstrip').getBoundingClientRect().bottom);
ok('phone scrolled: tab strip never slides under the strip', tabs == null || tabs >= stripBottom - 0.5,
   'tabsTop=' + tabs + ' stripBottom=' + stripBottom);
ok('phone: nothing fixed to the bottom edge', g.bottomFixed === 0, g.bottomFixed + ' element(s)');

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the top strip stacks.'));
process.exit(fails ? 1 : 0);
