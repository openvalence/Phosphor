/**
 * channel-heat.test.mjs -- the channel heatmap (src/ui/ChannelHeat.svelte, ph-8yga) on the recorded catalog,
 * in a bar of the top bar's 32 px row, at 1428x900, 1024x768 and 420x860:
 *   - full form at the two wide sizes: a block per catalog channel in catalog order, grouped STATE, STREAM,
 *     INTENT, EVENT, STORE with a hairline between groups, then the five link blocks; compact at 420: a block
 *     per class and one for the link
 *   - inside the row at every size, and the same box idle, busy and refusing (no page shifting)
 *   - a fed channel lights, a quiet one stays dark; a refused channel wears the warn tint and the slash and
 *     its tip says refused
 *   - hover or keyboard focus opens ONE panel in the top layer: every block again, larger and labeled,
 *     grouped as the bar is, below the bar and in front of the hero numerals; a block there fills the details
 *     line (name, class, rx and tx, last seen) and a click hands the channel id to onopen; the pointer has a
 *     grace period to reach it; arrows move, Escape closes, Enter opens, one tab stop
 *   - the stalled-updates line is absent while updates are fresh, and speaks and warns only past a real gap
 *   - under a coarse pointer: one button of at least 40x40 whose tap opens the Link page
 * Builds its own page from test/heat-harness into a temp dir; dist/ is untouched.
 * Screenshots with --shots [dir] (default test/evidence/channel-heat): each size, dark and Paper.
 *
 *   node test/channel-heat.test.mjs [--shots [dir]]
 */
import { chromium } from 'playwright';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE } from './dist.mjs';

const argv = process.argv.slice(2);
const SHOT = argv.includes('--shots');
const given = argv[argv.indexOf('--shots') + 1];
const SHOTS = SHOT && given && !given.startsWith('-') ? given : join(EVIDENCE, 'channel-heat');
let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = mkdtempSync(join(tmpdir(), 'heat-harness-'));
await build({
  configFile: false, logLevel: 'error', root: join(HERE, 'heat-harness'),
  plugins: [svelte({ configFile: join(HERE, '..', 'svelte.config.js') }), viteSingleFile()],
  build: { outDir: OUT, emptyOutDir: true, assetsInlineLimit: 100 * 1024 },
});
const HTML = readFileSync(join(OUT, 'index.html'));
rmSync(OUT, { recursive: true, force: true });
const CATALOG = readFileSync(join(HERE, 'fixtures', 'neutrino-catalog.bin'));
const srv = createServer((q, s) => {
  if (q.url === '/catalog.bin') { s.writeHead(200, { 'Content-Type': 'application/octet-stream' }); s.end(CATALOG); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL_ = 'http://127.0.0.1:' + srv.address().port + '/';
if (SHOT) mkdirSync(SHOTS, { recursive: true });

const CLASSES = ['STATE', 'STREAM', 'INTENT', 'EVENT', 'STORE'];
const LINKS = ['Link traffic', 'Round trip', 'Late samples', 'Frame budget', 'Health'];
const browser = await chromium.launch();
try {
  for (const [w, h] of [[1428, 900], [1024, 768], [420, 860]]) {
    const tag = w + 'x' + h;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL_);
    await page.waitForFunction(() => window.__ready && document.querySelector('.heat'));
    const entries = await page.evaluate(() => window.__entries());
    const compact = w < 768;
    const labels = () => page.$$eval('.heat .grp', (gs) => gs.map((g) => [...g.querySelectorAll('.blk')].map((b) => b.getAttribute('aria-label'))));
    const groups = await labels();

    if (!compact) {
      const want = [...CLASSES.map((c) => entries.filter((e) => e.cls === c).map((e) => e.name + ', ' + c)).filter((g) => g.length),
        LINKS.map((n) => n + ', link')];
      ok(tag + ': a block per channel in catalog order, grouped by class, then the link blocks',
        JSON.stringify(groups) === JSON.stringify(want), groups.map((g) => g.length));
    } else {
      ok(tag + ': compact, a block per class and one for the link',
        JSON.stringify(groups) === JSON.stringify([CLASSES.map((c) => c + ', ' + c), ['Link, link']]), groups);
    }
    const hair = await page.$$eval('.heat .grp', (gs) => gs.slice(1).every((g) => getComputedStyle(g).borderLeftWidth === '1px'));
    ok(tag + ': a hairline between groups', hair);

    const box = () => page.evaluate(() => {
      const r = document.querySelector('.heat').getBoundingClientRect(), b = document.getElementById('bar').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, inside: r.top >= b.top && r.bottom <= b.bottom, bar: b.height };
    });
    const idle = await box();
    ok(tag + ': inside the 32 px row', idle.inside && idle.bar === 32, idle);

    // Busy: every channel fed as one bundle at 20 Hz, then a refusal on the first STATE channel.
    const first = entries.find((e) => e.cls === 'STATE');
    const bg = (i) => page.$$eval('.heat .blk', (bs, j) => getComputedStyle(bs[j]).backgroundColor, i);
    const quietBg = await bg(0);
    await page.evaluate((ids) => { window.__fed = window.__run('rx', ids, 20, 2000); }, compact ? entries.map((e) => e.id) : [first.id]);
    await page.waitForTimeout(1200);
    const busyBg = await bg(0);
    await page.evaluate(() => window.__fed);
    ok(tag + ': a fed channel lights', busyBg !== quietBg, [quietBg, busyBg]);
    if (!compact) {
      const darkIdx = groups[0].length;   // the first STREAM block, never fed
      ok(tag + ': an unfed channel stays dark', (await bg(darkIdx)) === quietBg);
    }
    await page.evaluate((id) => window.__nack(id, 'NOT_HOMED'), first.id);
    await page.waitForTimeout(50);
    const warn = await page.$eval('.heat .blk', (b) => ({ warn: b.classList.contains('warn'),
      slash: getComputedStyle(b).backgroundImage !== 'none', label: b.getAttribute('aria-label') }));
    ok(tag + ': a refused channel: warn tint, the slash, and said in its name', warn.warn && warn.slash && /warning/.test(warn.label), warn);
    const busy = await box();
    ok(tag + ': the same box idle, busy and refusing', ['x', 'y', 'w', 'h'].every((k) => busy[k] === idle[k]), [idle, busy]);

    // Hover: ONE panel in the top layer, every block again with its label, in front of the hero.
    await page.hover('.heat .bar .blk');
    await page.waitForSelector('.heat .panel:popover-open');
    const probe = () => page.evaluate(() => {
      const p = document.querySelector('.heat .panel'), r = p.getBoundingClientRect(), hero = document.getElementById('hero').getBoundingClientRect();
      const x = Math.max(r.left, hero.left) + 20, y = Math.max(r.top, hero.top) + 20;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2), hit2 = document.elementFromPoint(x, y);
      const tiles = [...p.querySelectorAll('.tile')], sw = tiles[0] && tiles[0].querySelector('.sw').getBoundingClientRect();
      return { open: p.matches(':popover-open'), tiles: tiles.length, bar: document.querySelectorAll('.heat .bar .blk').length,
        labeled: tiles.every((t) => t.querySelector('.lbl').textContent.trim().length > 0),
        caps: [...p.querySelectorAll('.cap')].map((c) => c.textContent), swatch: sw && sw.width,
        inFront: !!hit && p.contains(hit), overHero: r.bottom > hero.top && !!hit2 && p.contains(hit2),
        below: r.top >= document.getElementById('bar').getBoundingClientRect().bottom, inView: r.left >= 0 && r.right <= innerWidth,
        panels: document.querySelectorAll('.heat .panel').length, tooltips: document.querySelectorAll('.heat [role=tooltip]').length };
    });
    const pn = await probe();
    ok(tag + ': hover opens one panel in the top layer with every block, labeled and bigger', pn.open && pn.panels === 1 && pn.tooltips === 0
      && pn.tiles === pn.bar && pn.labeled && pn.swatch >= 15 && pn.swatch <= 20, pn);
    ok(tag + ': the panel groups the blocks as the bar does',
      JSON.stringify(pn.caps) === JSON.stringify(compact ? ['Classes', 'Link'] : [...CLASSES.filter((c) => entries.some((e) => e.cls === c)), 'Link']), pn.caps);
    ok(tag + ': the panel hangs below the bar and in front of the hero numerals (not occluded)', pn.below && pn.inView && pn.inFront && pn.overHero, pn);
    const detail = () => page.$eval('.heat .panel .detail', (d) => d.innerText);
    const d0 = await detail();
    ok(tag + ': the details line reads the hovered block', compact
      ? new RegExp('^STATE\\n' + entries.filter((e) => e.cls === 'STATE').length + ' channels · busiest: ').test(d0) && /refused: NOT_HOMED/.test(d0)
      : new RegExp('^' + first.name + '\\nSTATE · 0x[0-9A-F]{4} · rx [0-9.]+/s · [0-9.]+ [KM]?B/s · tx -- · seen \\d+s ago\\nrefused: NOT_HOMED$').test(d0), d0);
    ok(tag + ': the panel moves nothing', JSON.stringify(await box()) === JSON.stringify(busy));
    // A block in the panel: highlight, details, click.
    const second = compact ? 'STREAM' : entries.filter((e) => e.cls === 'STATE')[1].name;
    await page.hover('.heat .panel .tile >> nth=1');
    const h1 = await page.evaluate(() => ({ on: [...document.querySelectorAll('.heat .panel .tile.on .lbl')].map((l) => l.textContent), dn: document.querySelector('.heat .panel .dn').textContent,
      bar: document.querySelectorAll('.heat .bar .blk.on').length, tooltips: document.querySelectorAll('[role=tooltip]').length }));
    ok(tag + ': hovering a panel block highlights it and fills the details line, no second tooltip', h1.on.length === 1 && h1.on[0] === second && h1.dn === second && h1.bar === 1 && h1.tooltips === 0, h1);
    await page.evaluate(() => { window.__opened.length = 0; });
    await page.click('.heat .panel .tile >> nth=1');
    const routed = await page.evaluate(() => [window.__opened.slice(), document.querySelector('.heat .panel').matches(':popover-open')]);
    ok(tag + ': clicking a panel block routes as the bar block does, and closes the panel',
      JSON.stringify(routed) === JSON.stringify([[compact ? null : entries.filter((e) => e.cls === 'STATE')[1].id], false]), routed);
    await page.evaluate(() => { window.__opened.length = 0; });

    // Open intent: passing over the map opens nothing; resting on it 300 ms does.
    await page.mouse.move(w - 5, h - 5);
    await page.waitForTimeout(500);
    await page.hover('.heat .bar .blk');
    await page.waitForTimeout(150);
    const early = await page.$eval('.heat .panel', (p) => p.matches(':popover-open'));
    await page.mouse.move(w - 5, h - 5);
    await page.waitForTimeout(500);
    const passed = await page.$eval('.heat .panel', (p) => p.matches(':popover-open'));
    ok(tag + ': passing over the map for 150 ms opens nothing', !early && !passed, [early, passed]);
    await page.hover('.heat .bar .blk');
    await page.waitForTimeout(450);
    ok(tag + ': resting on the map opens the panel', await page.$eval('.heat .panel', (p) => p.matches(':popover-open')));

    // The grace period: leaving the bar for the panel within it keeps the panel; leaving both closes it.
    await page.mouse.move(w - 5, h - 5);
    await page.waitForTimeout(500);
    await page.hover('.heat .bar .blk');
    await page.waitForSelector('.heat .panel:popover-open');
    await page.mouse.move(w / 2, 20);
    await page.waitForTimeout(120);
    await page.hover('.heat .panel .tile >> nth=2');
    await page.waitForTimeout(600);
    ok(tag + ': the pointer crosses into the panel inside the grace period', await page.$eval('.heat .panel', (p) => p.matches(':popover-open')));
    await page.mouse.move(w - 5, h - 5);
    await page.waitForTimeout(700);
    ok(tag + ': leaving both closes the panel', !(await page.$eval('.heat .panel', (p) => p.matches(':popover-open'))));

    if (SHOT) {
      for (const theme of ['default', 'paper']) {
        await page.evaluate((id) => window.__theme(id), theme);
        await page.hover('.heat .bar .blk');
        await page.waitForSelector('.heat .panel:popover-open');
        await page.hover('.heat .panel .tile >> nth=1');
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(SHOTS, tag + '-' + (theme === 'paper' ? 'paper' : 'dark') + '.png'), clip: { x: 0, y: 0, width: Math.min(w, 800), height: Math.min(h, 640) } });
        await page.mouse.move(w - 5, h - 5);
        await page.waitForTimeout(600);
      }
      await page.evaluate(() => window.__theme('default'));
    }

    // Keyboard: one tab stop, the panel on focus, arrows move, Escape closes, Enter opens.
    await page.keyboard.press('Tab');
    const f0 = await page.evaluate(() => [document.activeElement.getAttribute('aria-label'), document.querySelector('.heat .panel').matches(':popover-open'),
      document.activeElement.getAttribute('aria-describedby') === document.querySelector('.heat .detail')?.id]);
    ok(tag + ': Tab lands on the first block and opens the panel on it',
      f0[0] === (compact ? 'STATE, STATE, warning' : first.name + ', STATE, warning') && f0[1] && f0[2], f0);
    await page.keyboard.press('ArrowRight');
    const f1 = await page.evaluate(() => [document.activeElement.getAttribute('aria-label'), document.activeElement.tabIndex,
      document.querySelectorAll('.heat .bar .blk[tabindex="0"]').length, [...document.querySelectorAll('.heat .panel .tile.on .lbl')].map((l) => l.textContent),
      document.querySelector('.heat .panel .dn')?.textContent]);
    ok(tag + ': ArrowRight moves to the next block, the panel follows, still one tab stop',
      f1[0] === (compact ? 'STREAM, STREAM' : second + ', STATE') && f1[1] === 0 && f1[2] === 1 && f1[3].join() === second && f1[4] === second, f1);
    await page.keyboard.press('Escape');
    ok(tag + ': Escape closes the panel', !(await page.$eval('.heat .panel', (p) => p.matches(':popover-open'))));
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => window.__opened);
    ok(tag + ': Enter hands the key to onopen', JSON.stringify(opened) === JSON.stringify([compact ? null : entries.filter((e) => e.cls === 'STATE')[1].id]), opened);
    await page.keyboard.press('Tab');
    ok(tag + ': one Tab leaves the heatmap', !(await page.evaluate(() => !!document.activeElement.closest('.heat'))));

    // The stalled-updates line: absent while updates are fresh, warn only past a real gap, in the gap's own length.
    if (w === 1428) {
      const late = async () => {
        await page.mouse.move(w - 5, h - 5);
        await page.waitForTimeout(500);
        await page.hover('.heat .bar .blk[aria-label^="Late samples"]');
        await page.waitForSelector('.heat .panel:popover-open');
        await page.waitForTimeout(150);
        return page.evaluate(() => ({ label: document.querySelector('.heat .bar .blk[aria-label^="Late samples"]').getAttribute('aria-label'),
          detail: document.querySelector('.heat .panel .detail').innerText, why: document.querySelectorAll('.heat .panel .detail .why').length }));
      };
      await page.evaluate(() => { window.__gap(0); window.__stalled(true); });
      await page.waitForTimeout(100);
      const fresh = await late();
      ok(tag + ': fresh updates: no stalled-updates line, no warning', !/No machine updates/.test(fresh.detail) && fresh.why === 0 && !/warning/.test(fresh.label), fresh);
      await page.evaluate(() => window.__gap(600));
      await page.waitForTimeout(100);
      const jit = await page.$eval('.heat .panel .detail', (d) => d.innerText);
      ok(tag + ': a jitter-sized silence stays silent too', !/No machine updates/.test(jit), jit);
      await page.evaluate(() => window.__gap(3000));
      await page.waitForTimeout(100);
      const gap = await late();
      ok(tag + ': a real gap warns, and says how long', /No machine updates for 3\.\d s/.test(gap.detail) && gap.why === 1 && /warning/.test(gap.label), gap);
      await page.evaluate(() => { window.__stalled(false); window.__gap(0); });
      await page.mouse.move(w - 5, h - 5);
    }
    ok(tag + ': no page errors', errors.length === 0, errors);
    await page.close();
  }

  // A coarse pointer: one 40 px target to the Link page, the blocks drawn only.
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.waitForFunction(() => window.__ready && document.querySelector('.heat'));
  const one = await page.$eval('.heat', (h) => ({ tag: h.tagName, h: h.getBoundingClientRect().height, w: h.getBoundingClientRect().width,
    inner: h.querySelectorAll('button').length, blocks: h.querySelectorAll('.blk').length, label: h.getAttribute('aria-label') }));
  ok('coarse: one button of at least 40x40, its blocks drawn only', one.tag === 'BUTTON' && one.h >= 39.5 && one.w >= 39.5
    && one.inner === 0 && one.blocks === 6 && one.label === 'Channel activity', one);
  await page.tap('.heat');
  ok('coarse: a tap opens the Link page', JSON.stringify(await page.evaluate(() => window.__opened)) === '[null]');
  await ctx.close();
} finally {
  await browser.close();
  srv.close();
}
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
