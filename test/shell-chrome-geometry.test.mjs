/**
 * shell-chrome-geometry.test.mjs -- does the top strip stack flush (T22)?
 *
 * One strip (ui/TopStrip.svelte) holds every top bar and sits in flow, sticky
 * at top 0, so there is no reserve to double-count. The shell's row is not in
 * the device bundle, so this simulates it: a 34px block prepended inside the
 * strip, which is exactly where TopStrip mounts ShellStrip.
 *
 * Then the REAL shell bundle (shell-build.mjs, stub Tauri runtime, no hub):
 * the drawer opens on first run, pushes the LinkBar and the safety pair down
 * on desktop and opens below the whole strip on a phone; the shell chrome is
 * darker than the content in default, hi-vis and high-contrast, its text
 * keeps 4.5:1; tabs follow the WAI-ARIA keys; Escape and a click outside
 * close it; open state and pane survive a reload (ph-e82.14).
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
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';

const HTML = readFileSync(new URL('../dist/index.html', import.meta.url));
const SHELL = await buildShellPage();
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(q.url.startsWith('/shell') ? SHELL : HTML); });
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
// ph-wks: the notch inset must not depend on html.hivis.
const inset = await page.evaluate(() => [document.documentElement.classList.contains('hivis'),
  getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset-top').trim()]);
ok('--chrome-inset-top is defined without html.hivis', !inset[0] && inset[1] !== '', JSON.stringify(inset));
ok('served page: no shell chrome at all', await page.evaluate(() => !document.querySelector('.shell, #shell-drawer, .sb-handle')));

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

// ---- the real shell row and its drawer (ph-e82.14) ----------------------------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(TAURI_STUB);
const sp = await ctx.newPage();
await sp.goto('http://127.0.0.1:' + PORT + '/shell', { waitUntil: 'domcontentloaded' });
await sp.waitForSelector('.topstrip .shell .sb-handle', { timeout: 15000 });
await sp.waitForTimeout(300);
const rect = (sel) => sp.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; }, sel);
const drawerOpen = () => sp.evaluate(() => [!!document.querySelector('#shell-drawer'), document.querySelector('.sb-handle').getAttribute('aria-expanded')]);

ok('first run: the drawer opens on Hubs', JSON.stringify(await drawerOpen()) === '[true,"true"]'
   && await sp.getAttribute('#dt-hubs', 'aria-selected') === 'true');
let row = await rect('.shellrow'), dr = await rect('#shell-drawer'), lb = await rect('.linkbar'), es = await rect('.topstrip .btn-estop');
ok('desktop: the row is flush at the top, the drawer drops from it', Math.abs(row.top) < 1 && Math.abs(dr.top - row.bottom) < 1, JSON.stringify([row, dr]));
ok('desktop: the drawer pushes the LinkBar and the safety pair down', Math.abs(lb.top - dr.bottom) < 1 && es.top >= dr.bottom, JSON.stringify([dr, lb, es]));
ok('desktop: the e-stop stays on screen with the drawer open', es.bottom <= 900);
g = await sp.evaluate(() => ({ appH: document.querySelector('.app').getBoundingClientRect().height, vh: innerHeight,
  scrolls: document.scrollingElement.scrollHeight > innerHeight + 2 }));
ok('desktop: the column is still one viewport and the page does not scroll', Math.abs(g.appH - g.vh) < 2 && !g.scrolls, g.appH + ' vs ' + g.vh);

// Shading: the shell is darker than every content surface around it, and its
// text keeps 4.5:1, in default, hi-vis and high-contrast.
const shade = () => sp.evaluate(() => {
  const ctx2d = document.createElement('canvas').getContext('2d');
  const rgb = (c) => { ctx2d.clearRect(0, 0, 1, 1); ctx2d.fillStyle = '#000'; ctx2d.fillStyle = c; ctx2d.fillRect(0, 0, 1, 1); return [...ctx2d.getImageData(0, 0, 1, 1).data]; };
  const lum = (c) => { const [r, g, b] = rgb(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bgOf = (el) => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (rgb(c)[3] === 255) return c; } return getComputedStyle(document.body).backgroundColor; };
  const shell = lum(getComputedStyle(document.querySelector('.shell')).backgroundColor);
  const drawer = lum(getComputedStyle(document.querySelector('#shell-drawer')).backgroundColor);
  const content = [lum(getComputedStyle(document.body).backgroundColor), lum(bgOf(document.querySelector('.linkbar')))];
  let worst = 99, at = '';
  const walker = document.createTreeWalker(document.querySelector('.shell'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.data.trim() || el.closest(':disabled') || !el.getBoundingClientRect().width) continue;
    const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
    const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (cr < worst) { worst = cr; at = n.data.trim().slice(0, 20); }
  }
  return { shell, drawer, content, worst: Math.round(worst * 100) / 100, at };
});
for (const [label, setup] of [['default', null], ['hi-vis', () => document.documentElement.classList.add('hivis')]]) {
  if (setup) await sp.evaluate(setup);
  const s = await shade();
  ok(label + ': shell and drawer darker than the content', s.content.every((c) => s.shell < c && s.drawer < c), JSON.stringify(s));
  ok(label + ': shell text keeps 4.5:1', s.worst >= 4.5, s.worst + ' at "' + s.at + '"');
}
await sp.emulateMedia({ contrast: 'more' });
{
  const s = await shade();
  ok('high contrast: shell darker than the content, text keeps 4.5:1', s.content.every((c) => s.shell < c) && s.worst >= 4.5, JSON.stringify(s));
}
await sp.emulateMedia({ contrast: 'no-preference' });
await sp.evaluate(() => document.documentElement.classList.remove('hivis'));

// Tabs: roving focus, arrows and End move selection; the pane survives a reload.
await sp.focus('#dt-hubs');
await sp.keyboard.press('ArrowRight');
ok('ArrowRight selects and focuses the next tab', await sp.evaluate(() => document.activeElement.id === 'dt-server'
  && document.activeElement.getAttribute('aria-selected') === 'true'));
await sp.keyboard.press('End');
const about = await sp.textContent('#dr-panel');
ok('End reaches About: hub identity, versions, UI build', /Hub/.test(about) && /Firmware/.test(about) && /UI build/.test(about), about.replace(/\s+/g, ' ').slice(0, 80));
await sp.reload();
await sp.waitForSelector('#shell-drawer', { timeout: 15000 });
ok('the drawer and its pane survive a reload', await sp.getAttribute('#dt-about', 'aria-selected') === 'true');

// Escape returns focus to the handle; the closed state survives a reload.
await sp.focus('#dt-about');
await sp.keyboard.press('Escape');
await sp.waitForTimeout(100);
ok('Escape closes the drawer and focuses the handle', JSON.stringify(await drawerOpen()) === '[false,"false"]'
  && await sp.evaluate(() => document.activeElement.classList.contains('sb-handle')));
await sp.reload();
await sp.waitForSelector('.sb-handle', { timeout: 15000 });
await sp.waitForTimeout(200);
ok('closed survives a reload', JSON.stringify(await drawerOpen()) === '[false,"false"]');
await sp.click('.sb-handle');
await sp.waitForSelector('#shell-drawer');
await sp.mouse.click(720, 860);
await sp.waitForTimeout(100);
ok('a click outside closes the drawer', JSON.stringify(await drawerOpen()) === '[false,"false"]');

// Phone: below the whole strip, full width; the e-stop does not move.
await sp.setViewportSize({ width: 360, height: 640 });
await sp.waitForTimeout(200);
const esClosed = await rect('.topstrip .btn-estop');
await sp.click('.sb-handle');
await sp.waitForSelector('#shell-drawer');
dr = await rect('#shell-drawer');
const strip = await rect('.topstrip');
es = await rect('.topstrip .btn-estop');
ok('phone: the drawer opens below the whole strip, full width', Math.abs(dr.top - strip.bottom) < 1.5 && Math.abs(dr.width - 360) < 1, JSON.stringify([dr, strip]));
ok('phone: the e-stop does not move', Math.abs(es.top - esClosed.top) < 0.5, esClosed.top + ' -> ' + es.top);
ok('phone: the drawer ends above the viewport bottom', dr.bottom < 640, 'bottom=' + dr.bottom);
await ctx.close();

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the top strip stacks.'));
process.exit(fails ? 1 : 0);
