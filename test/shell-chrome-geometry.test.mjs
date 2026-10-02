/**
 * shell-chrome-geometry.test.mjs -- does the top strip stack flush (T22)?
 *
 * One strip (ui/TopStrip.svelte) holds every top bar and sits in flow, sticky
 * at top 0, so there is no reserve to double-count. The shell's row is not in
 * the device bundle, so this simulates it: a 34px block prepended inside the
 * strip, which is exactly where TopStrip mounts ShellStrip.
 *
 * Then the REAL shell bundle (shell-build.mjs, stub Tauri runtime, no hub):
 * the sidebar ends in a Phosphor section holding the shell's panes, which the
 * served page never shows; first run selects Hubs; a Phosphor tab renders its
 * pane in the content area, desktop and phone; the shell chrome (row and
 * Phosphor section) is darker than the content in default, hi-vis and
 * high-contrast, its text keeps 4.5:1 (ph-e82.16).
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
ok('served page: no shell chrome at all', await page.evaluate(() => !document.querySelector('.shell, .rail-sec.shell, [data-tab-id^="shell:"]')));

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

// ---- the real shell bundle: the sidebar's Phosphor section (ph-e82.16) ------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(TAURI_STUB);
const sp = await ctx.newPage();
await sp.goto('http://127.0.0.1:' + PORT + '/shell', { waitUntil: 'domcontentloaded' });
await sp.waitForSelector('nav.rail .rail-sec.shell [role=tab]', { timeout: 15000 });
await sp.waitForTimeout(300);
const rect = (sel) => sp.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; }, sel);
const PANES = ['Hubs', 'Server', 'Settings', 'About'];

const sec = await sp.evaluate(() => {
  const secs = [...document.querySelectorAll('nav.rail .rail-sec')];
  const ph = document.querySelector('nav.rail .rail-sec.shell');
  return { last: secs.at(-1) === ph, label: ph.querySelector('.rail-lbl')?.textContent.trim(),
    tabs: [...ph.querySelectorAll('[role=tab] .rail-name')].map((t) => t.textContent.trim()),
    gap: document.querySelector('nav.rail').getBoundingClientRect().bottom - ph.getBoundingClientRect().bottom };
});
ok('shell: the sidebar ends in a Phosphor section with every shell pane', sec.last && sec.label === 'Phosphor'
   && PANES.every((p) => sec.tabs.includes(p)), JSON.stringify(sec));
ok('shell: the Phosphor section sits at the rail foot', sec.gap >= 0 && sec.gap < 12, 'gap=' + sec.gap);
ok('shell: no top drawer and no menu handle', await sp.evaluate(() => !document.querySelector('#shell-drawer, .sb-handle')));
ok('first run: Hubs is selected and its pane fills the content area',
   await sp.getAttribute('[data-tab-id="shell:hubs"]', 'aria-selected') === 'true'
   && await sp.evaluate(() => !!document.querySelector('.content main.pane .hp')));

for (const [id, sel] of [['about', 'dl.about'], ['settings', '.set'], ['server', '.sp-entry']]) {
  await sp.click('[data-tab-id="shell:' + id + '"]');
  await sp.waitForTimeout(100);
  ok('Phosphor > ' + id + ' renders in the content area', await sp.evaluate((s) => !!document.querySelector('.content main.pane ' + s), sel));
}
await sp.click('[data-tab-id="shell:about"]');
await sp.waitForTimeout(100);
const about = await sp.textContent('.content dl.about');
ok('About: hub identity, versions, UI build', /Hub/.test(about) && /Firmware/.test(about) && /UI build/.test(about), about.replace(/\s+/g, ' ').slice(0, 80));
await sp.focus('[data-tab-id="shell:hubs"]');
await sp.keyboard.press('ArrowDown');
ok('ArrowDown moves focus and selection to the next Phosphor tab', await sp.evaluate(() => document.activeElement.dataset.tabId === 'shell:server'
  && document.activeElement.getAttribute('aria-selected') === 'true'));

// Shading: the shell row and the Phosphor section are darker than every
// content surface around them, and their text keeps 4.5:1, in default, hi-vis
// and high-contrast.
const shade = () => sp.evaluate(() => {
  const ctx2d = document.createElement('canvas').getContext('2d');
  const rgb = (c) => { ctx2d.clearRect(0, 0, 1, 1); ctx2d.fillStyle = '#000'; ctx2d.fillStyle = c; ctx2d.fillRect(0, 0, 1, 1); return [...ctx2d.getImageData(0, 0, 1, 1).data]; };
  const lum = (c) => { const [r, g, b] = rgb(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bgOf = (el) => { for (; el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (rgb(c)[3] === 255) return c; } return getComputedStyle(document.body).backgroundColor; };
  const roots = [...document.querySelectorAll('.shell, .rail-sec.shell')];
  const shell = roots.map((el) => lum(getComputedStyle(el).backgroundColor));
  const content = [lum(getComputedStyle(document.body).backgroundColor), lum(bgOf(document.querySelector('nav.rail'))), lum(bgOf(document.querySelector('.content')))];
  let worst = 99, at = '';
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.data.trim() || el.closest(':disabled') || !el.getBoundingClientRect().width) continue;
      const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
      const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (cr < worst) { worst = cr; at = n.data.trim().slice(0, 20); }
    }
  }
  return { shell, content, worst: Math.round(worst * 100) / 100, at };
});
for (const [label, setup] of [['default', null], ['hi-vis', () => document.documentElement.classList.add('hivis')]]) {
  if (setup) await sp.evaluate(setup);
  const s = await shade();
  ok(label + ': shell row and Phosphor section darker than the content', s.content.every((c) => s.shell.every((x) => x < c)), JSON.stringify(s));
  ok(label + ': shell text keeps 4.5:1', s.worst >= 4.5, s.worst + ' at "' + s.at + '"');
}
await sp.emulateMedia({ contrast: 'more' });
{
  const s = await shade();
  ok('high contrast: shell darker than the content, text keeps 4.5:1', s.content.every((c) => s.shell.every((x) => x < c)) && s.worst >= 4.5, JSON.stringify(s));
}
await sp.emulateMedia({ contrast: 'no-preference' });
await sp.evaluate(() => document.documentElement.classList.remove('hivis'));

// Phone: the Phosphor tabs ride the same tab strip; the e-stop stays put.
await sp.setViewportSize({ width: 360, height: 640 });
await sp.waitForSelector('nav.tabs [data-tab-id="shell:settings"]');
const esBefore = await rect('.topstrip .btn-estop');
const phoneTabs = await sp.$$eval('nav.tabs [data-tab-id^="shell:"]', (els) => els.map((e) => e.textContent.trim()));
ok('phone: the Phosphor tabs ride the tab strip', PANES.every((p) => phoneTabs.includes(p)), JSON.stringify(phoneTabs));
await sp.click('nav.tabs [data-tab-id="shell:settings"]');
await sp.waitForTimeout(150);
ok('phone: Phosphor > Settings renders in the page', await sp.evaluate(() => !!document.querySelector('main.pane .set')));
await sp.evaluate(() => window.scrollTo(0, 0));
await sp.waitForTimeout(100);
const esAfter = await rect('.topstrip .btn-estop');
ok('phone: the e-stop does not move', Math.abs(esAfter.top - esBefore.top) < 0.5, esBefore.top + ' -> ' + esAfter.top);
await ctx.close();

await browser.close();
srv.close();
console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- the top strip stacks.'));
process.exit(fails ? 1 : 0);
