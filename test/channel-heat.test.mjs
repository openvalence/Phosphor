/**
 * channel-heat.test.mjs -- the channel heatmap (src/ui/ChannelHeat.svelte, ph-8yga) on the recorded catalog,
 * in a bar of the top bar's 32 px row, at 1428x900, 1024x768 and 420x860:
 *   - full form at the two wide sizes: a block per catalog channel in catalog order, grouped STATE, STREAM,
 *     INTENT, EVENT, STORE with a hairline between groups, then the five link blocks; compact at 420: a block
 *     per class and one for the link
 *   - inside the row at every size, and the same box idle, busy and refusing (no page shifting)
 *   - a fed channel lights, a quiet one stays dark; a refused channel wears the warn tint and the slash and
 *     its tip says refused
 *   - hover and keyboard focus show the tip (name, class, rx and tx, last seen); arrows move, Escape hides,
 *     one tab stop; a click hands the channel id to onopen
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
const CATALOG = readFileSync(join(HERE, 'fixtures', 'valencesim-catalog.bin'));
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

    // Hover: the tip, out of flow.
    await page.hover('.heat .blk');
    const tip = await page.$eval('.heat [role=tooltip]', (t) => t.innerText);
    ok(tag + ': hover shows the tip', compact
      ? /^STATE\n26 channels\nbusiest: /.test(tip) && /refused: NOT_HOMED/.test(tip)
      : new RegExp('^' + first.name + '\\nSTATE · 0x[0-9A-F]{4}\\nrx [0-9.]+/s · [0-9.]+ [KM]?B/s\\ntx --\\nseen \\d+s ago\\nrefused: NOT_HOMED$').test(tip), tip);
    ok(tag + ': the tip moves nothing', JSON.stringify(await box()) === JSON.stringify(busy));

    if (SHOT) {
      for (const theme of ['default', 'paper']) {
        await page.evaluate((id) => window.__theme(id), theme);
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(SHOTS, tag + '-' + (theme === 'paper' ? 'paper' : 'dark') + '.png'), clip: { x: 0, y: 0, width: Math.min(w, 520), height: 200 } });
      }
      await page.evaluate(() => window.__theme('default'));
    }
    await page.mouse.move(w - 5, h - 5);

    // Keyboard: one tab stop, the tip on focus, arrows move, Escape hides, Enter opens.
    await page.keyboard.press('Tab');
    const f0 = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
    ok(tag + ': Tab lands on the first block and shows its tip',
      f0 === (compact ? 'STATE, STATE, warning' : first.name + ', STATE, warning') && await page.$('.heat [role=tooltip]') !== null, f0);
    await page.keyboard.press('ArrowRight');
    const f1 = await page.evaluate(() => [document.activeElement.getAttribute('aria-label'), document.activeElement.tabIndex,
      document.querySelectorAll('.heat .blk[tabindex="0"]').length]);
    ok(tag + ': ArrowRight moves to the next block, still one tab stop', f1[0] === (compact ? 'STREAM, STREAM' : entries.filter((e) => e.cls === 'STATE')[1].name + ', STATE')
      && f1[1] === 0 && f1[2] === 1, f1);
    await page.keyboard.press('Escape');
    ok(tag + ': Escape hides the tip', await page.$('.heat [role=tooltip]') === null);
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => window.__opened);
    ok(tag + ': Enter hands the key to onopen', JSON.stringify(opened) === JSON.stringify([compact ? null : entries.filter((e) => e.cls === 'STATE')[1].id]), opened);
    await page.keyboard.press('Tab');
    ok(tag + ': one Tab leaves the heatmap', !(await page.evaluate(() => !!document.activeElement.closest('.heat'))));
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
