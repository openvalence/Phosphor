/**
 * stamp-menu.test.mjs -- the footer stamp's context menu (src/ui/stampmenu.js, ph-75yn), on the built page with no hub:
 * a right-click and a touch-style contextmenu on the stamp open exactly two items (the shell menu stays out);
 * Copy versions and Copy diagnostics (JSON) put the texts on the clipboard, the status slot says so over the link
 * fault, and neither the footer nor the status slot changes size; Escape closes it; a right-click elsewhere in the
 * footer is not this menu.
 * Run: node test/stamp-menu.test.mjs   (needs npm run build:only)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DIST_HTML } from './dist.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const HTML = readFileSync(DIST_HTML);
const srv = createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(HTML); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();

async function run(width, height) {
  console.log('\n--- ' + width + 'x' + height + ' ---');
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.waitForSelector('.footstrip .fact-ui', { timeout: 20000 });
  const box = () => page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? [b.x, b.y, b.width, b.height].map(Math.round) : null; };
    return { foot: r('.footstrip'), slot: r('.st-text') && r('.st-text'), strip: r('.topstrip') };
  });
  const items = () => page.$$eval('.ui-menu [role=menuitem]', (b) => b.map((x) => x.textContent.trim()));
  const slot = () => page.evaluate(() => document.querySelector('[data-kind] .st-text, .st-text')?.textContent.trim() || '');
  const before = await box();

  const cell = page.locator('.footstrip .fact-ui');
  await cell.click({ button: 'right' });
  await page.waitForSelector('.ui-menu', { timeout: 3000 });
  ok('right-click: exactly the two items', JSON.stringify(await items()) === '["Copy versions","Copy diagnostics (JSON)"]', await items());
  ok('the menu has no header', (await page.locator('.ui-menu .ui-menu-h').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ui-menu'));
  ok('Escape closes it', true);

  await cell.dispatchEvent('contextmenu', { clientX: 100, clientY: 100 });
  await page.waitForSelector('.ui-menu', { timeout: 3000 });
  ok('a bare contextmenu event (the touch long press) opens it too', (await items()).length === 2);

  await page.click('.ui-menu [role=menuitem]:nth-child(1)');
  await page.waitForFunction(() => /Versions copied/.test(document.body.innerText), null, { timeout: 3000 });
  const lines = (await page.evaluate(() => navigator.clipboard.readText())).split(String.fromCharCode(13)).join('');
  ok('Copy versions: three lines, build named', /^Phosphor build \w+\nFirmware --\nValence v\d+ \(.+\)$/.test(lines), lines);
  ok('status slot says so over the fault', (await page.evaluate(() => document.querySelector('.topstrip')?.innerText || '')).includes('Versions copied'));
  const mid = await box();
  ok('no layout shift: footer and top strip hold their boxes', JSON.stringify(mid.foot) === JSON.stringify(before.foot) && JSON.stringify(mid.strip) === JSON.stringify(before.strip), { before, mid });

  await cell.click({ button: 'right' });
  await page.waitForSelector('.ui-menu');
  await page.click('.ui-menu [role=menuitem]:nth-child(2)');
  await page.waitForFunction(() => /Diagnostics copied/.test(document.body.innerText), null, { timeout: 3000 });
  const raw = await page.evaluate(() => navigator.clipboard.readText());
  let d = null; try { d = JSON.parse(raw); } catch { /* reported below */ }
  ok('Copy diagnostics: JSON with the schema', d && d.schema === 'phosphor.diagnostics/1' && d.app.mode === 'app' && d.hub.phase !== undefined, raw.slice(0, 200));
  ok('...build matches the stamp', d && new RegExp('^' + d.app.build).test(await page.locator('.footstrip .fact-ui .v').innerText()));
  ok('...no address, token or session text', !/https?:|ws:|127\.0\.0\.1|token|session_id|instance/i.test(raw), raw);
  const after = await box();
  ok('no layout shift after the second copy', JSON.stringify(after.foot) === JSON.stringify(before.foot) && JSON.stringify(after.strip) === JSON.stringify(before.strip), { before, after });

  await page.locator('.footstrip .foot-end').click({ button: 'right', position: { x: 2, y: 2 } });
  await page.waitForTimeout(150);
  ok('a right-click on the scale group is not the stamp menu', !(await items()).includes('Copy versions'), await items());
  ok('no page errors', errors.length === 0, errors);
  await ctx.close();
}

await run(1428, 900);
await run(420, 860);
await browser.close();
srv.close();
console.log(fails ? 'FAIL: ' + fails : 'stamp-menu: all pass');
process.exit(fails ? 1 : 0);
