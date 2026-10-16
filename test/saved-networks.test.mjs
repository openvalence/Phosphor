/**
 * saved-networks.test.mjs -- the saved Wi-Fi list (factory plugin saved-networks, RFC-116 draft) on
 * the shell bundle against a private native valencesim, which boots with one saved network, "Neutrino",
 * live. Asserts:
 *   configure  names, the live mark and the signal; Add (count 2, the passphrase field cleared and the
 *              secret nowhere on the page, in storage or in the console); drag and the arrows reorder;
 *              a list changed by another session still resolves the entry by name; Remove asks first;
 *              removing the live entry is refused with the hub's reason in the card
 *   below      a control session: "2 of 4 saved", no names and no form
 *   fallback   the plugin disabled: the generic cards for the same channels
 * On a hub that lists networks (RFC-118 draft) the card opens on the picker (test/wifipicker.test.mjs) and
 * the slot list is under Advanced, which this suite opens first.
 * Screenshots: test/evidence/savednets-configure.png and savednets-below.png (1428x900).
 *
 * Needs a valencesim with the saved-network twin (VALENCESIM=<exe>, Nucleus worktree nets); SKIPs without it.
 * Run: node test/saved-networks.test.mjs
 * Constraints: the sim and the page run on private ports; the sim is killed on every exit path. The test
 * passphrase is a fixture string and is asserted absent from everything the page keeps.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createSession, toHex } from '../../Valence/clients/js/index.js';
import { buildShellPage, TAURI_STUB } from './shell-build.mjs';
import { startSim } from './live-sim.mjs';
import { goTab } from './nav.mjs';
import { EVIDENCE } from './dist.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = 'fixture-pass-0042';
// The trust ledger binds a token to the instance that knocked: the configure page presents the same one.
const INSTANCE = new Uint8Array(8).fill(0xd1);

// ---- live ----
const sim = await startSim({ extra: ['--pairing-window'] });
if (!sim) { console.log('SKIP: no valencesim (set VALENCESIM)'); process.exit(fails ? 1 : 0); }

// The first knock in the pairing window is granted configure: its token is what the configure page presents.
const knock = createSession({ host: '127.0.0.1', port: sim.port, clientKind: 'webui', clientName: 'saved-networks test',
  instanceId: INSTANCE, autoReconnect: false });
await new Promise((res) => { knock.on('welcome', res); knock.connect(); });
const grant = await new Promise((res) => { knock.on('pairGrant', res); knock.sendPairReq(); });
knock.close();
ok('the pairing window grants configure', grant.role === 2, grant.role);
const TOKEN = toHex(grant.token);

const SHELL = await buildShellPage();
const srv = createServer((q, s) => {
  if (q.url.startsWith('/uitoken')) {
    fetch('http://127.0.0.1:' + sim.http + '/uitoken').then(async (r) => { s.writeHead(r.status); s.end(await r.text()); })
      .catch(() => { s.writeHead(502); s.end('{}'); });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(SHELL);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PAGE = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch();
process.on('exit', () => { try { srv.close(); } catch (e) { /* gone */ } });

// The shell mints through the Tauri HTTP plugin; serviced with the page's fetch, proxied to the sim.
function HTTP_STUB() {
  const base = window.__TAURI_INTERNALS__.invoke;
  const held = new Map();
  let n = 0;
  window.__TAURI_INTERNALS__.invoke = async (cmd, a) => {
    if (cmd === 'plugin:http|fetch') { held.set(++n, { cfg: a.clientConfig }); return n; }
    if (cmd === 'plugin:http|fetch_send') {
      const h = held.get(a.rid);
      const r = await fetch(/\/uitoken$/.test(h.cfg.url) ? '/uitoken' : h.cfg.url, { method: h.cfg.method });
      h.body = [...new Uint8Array(await r.arrayBuffer())];
      return { status: r.status, statusText: r.statusText, url: h.cfg.url, headers: [...r.headers], rid: a.rid };
    }
    if (cmd === 'plugin:http|fetch_read_body') {
      const h = held.get(a.rid);
      if (h.body) { const b = h.body; h.body = null; return [...b, 0]; }
      return [1];
    }
    if (cmd.startsWith('plugin:http|')) return null;
    return base(cmd, a);
  };
}

async function open({ token = null, disabled = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1428, height: 900 } });
  await ctx.addInitScript(TAURI_STUB);
  await ctx.addInitScript(HTTP_STUB);
  await ctx.addInitScript(([port, tok, off]) => {
    try {
      localStorage.setItem('phosphor.hubs', JSON.stringify([{ id: '127.0.0.1:' + port, host: '127.0.0.1', port }]));
      if (tok) { localStorage.setItem('valence.tok.127.0.0.1:' + port, tok[0]); localStorage.setItem('valence.instance', tok[1]); }
      if (off) localStorage.setItem('phosphor.plugins.disabled', JSON.stringify(['saved-networks']));
    } catch (e) { /* none */ }
  }, [sim.port, token && [token, toHex(INSTANCE)], disabled]);
  // The hub's two network STATE frames can be held back and released in order.
  const hold = { on: false, q: [], release() { this.on = false; for (const f of this.q.splice(0)) f(); } };
  await ctx.routeWebSocket(new RegExp(':' + sim.port + '/'), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      const ch = typeof m !== 'string' && m.length >= 4 ? m[2] | (m[3] << 8) : 0;
      if (hold.on && (ch === 0x17 || ch === 0x18)) hold.q.push(() => ws.send(m)); else ws.send(m);
    });
    ws.onClose(() => server.close());
    server.onClose(() => ws.close());
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(PAGE);
  await goTab(page, 'cat11');
  if (token && !disabled) {
    await page.waitForFunction(() => document.querySelector('.sn .ui-tile')?.offsetParent || document.querySelector('.wp-foot:not([hidden])'), null, { timeout: 20000 });
    const adv = page.locator('.wp-foot:not([hidden]) .og-btn', { hasText: 'Advanced' });
    if (await adv.count()) await adv.click();
  }
  return { ctx, page, logs, hold };
}

const sum = (page) => page.locator('.sn-sum').innerText();
const titles = (page) => page.$$eval('.sn .ui-tile-t', (ts) => ts.map((t) => t.textContent));
const status = (page) => page.locator('.sn-status').innerText();
const waitSum = (page, text) => page.waitForFunction((t) => document.querySelector('.sn-sum')?.textContent === t, text, { timeout: 8000 });
const waitTitles = (page, want) => page.waitForFunction((w) => [...document.querySelectorAll('.sn .ui-tile-t')].map((t) => t.textContent).join() === w, want.join(), { timeout: 8000 });

mkdirSync(EVIDENCE, { recursive: true });

console.log('configure');
const cfg = await open({ token: TOKEN });
{
  const { page, logs, hold } = cfg;
  await page.waitForSelector('.sn .ui-tile', { timeout: 20000 });
  ok('the list shows the occupancy and the hub\'s one network, marked live',
    await sum(page) === '1 of 4 saved' && (await titles(page)).join() === 'Neutrino'
    && /connected/.test(await page.locator('.sn .ui-tile-m').first().innerText()) && /dBm/.test(await page.locator('.sn .ui-tile-m').first().innerText()));
  ok('the generic cards for these channels yield to it', await page.locator('[data-uid^="15:"], [data-uid^="23:"], [data-uid^="24:"], [data-uid^="25:"], [data-uid^="26:"]').count() === 0);

  await page.fill('.sn-form input[aria-label="Name"]', 'cafe');
  await page.fill('.sn-form input[aria-label="Passphrase"]', SECRET);
  ok('Add is on with a valid name and passphrase', await page.locator('.sn-form button').isEnabled());
  await page.click('.sn-form button');
  await waitSum(page, '2 of 4 saved');
  await waitTitles(page, ['Neutrino', 'cafe']);
  ok('Add: the hub took it, count 2', await sum(page) === '2 of 4 saved' && (await titles(page)).join() === 'Neutrino,cafe');
  ok('the passphrase field is cleared after the send', await page.inputValue('.sn-form input[aria-label="Passphrase"]') === '');
  ok('the name field is cleared after a save', await page.inputValue('.sn-form input[aria-label="Name"]') === '');
  ok('the signal shows for the new entry', /dBm/.test(await page.locator('.sn .ui-tile-m').nth(1).innerText()));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(EVIDENCE, 'savednets-configure.png') });

  // The below-configure page, while the list holds both entries.
  const low = await open();
  {
    await low.page.waitForSelector('.sn-sum', { timeout: 20000 });
    await waitSum(low.page, '2 of 4 saved');
    const text = await low.page.locator('.sn').innerText();
    ok('below configure: occupancy only, no names, no form',
      !/Neutrino|cafe/.test(text) && await low.page.locator('.sn-form').isHidden() && await low.page.locator('.sn .ui-tile').count() === 0, text);
    await low.page.waitForTimeout(300);
    await low.page.screenshot({ path: join(EVIDENCE, 'savednets-below.png') });
    await low.ctx.close();
  }

  // Drag the second row above the first, then back.
  const drag = async (from, toBelow) => {
    const rows = page.locator('.sn .ui-tile-b');
    // Under the picker the slot list can sit below the fold: the pointer needs it on screen.
    await page.locator('.sn-list').scrollIntoViewIfNeeded();
    const a = await rows.nth(from).boundingBox(), b = await rows.nth(toBelow).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, (a.y + b.y) / 2 + (from < toBelow ? b.height : 0) / 2, { steps: 6 });
    await page.mouse.move(b.x + b.width / 2, b.y + (from < toBelow ? b.height - 2 : 2), { steps: 6 });
    await page.mouse.up();
  };
  await drag(1, 0);
  await waitTitles(page, ['cafe', 'Neutrino']);
  ok('drag: cafe moved above Neutrino', (await titles(page)).join() === 'cafe,Neutrino');
  await drag(0, 1);
  await waitTitles(page, ['Neutrino', 'cafe']);
  ok('drag: and back', (await titles(page)).join() === 'Neutrino,cafe');

  const arrow = (i, name) => page.locator('.sn .ui-tile').nth(i).locator('.ui-tile-act .og-btn[aria-label="' + name + '"]');
  ok('the first row cannot move up, the last cannot move down',
    await arrow(0, 'Move up').isDisabled() && await arrow(1, 'Move down').isDisabled() && await arrow(0, 'Move down').isEnabled());
  await arrow(0, 'Move down').click();
  await waitTitles(page, ['cafe', 'Neutrino']);
  ok('Move down: Neutrino moved below cafe', (await titles(page)).join() === 'cafe,Neutrino');
  await arrow(1, 'Move up').click();
  await waitTitles(page, ['Neutrino', 'cafe']);
  ok('Move up: and back', (await titles(page)).join() === 'Neutrino,cafe');

  // The click lands on a stale list or a fresh one; either way the entry named cafe is the one removed
  // (found again by name after a CONFLICT).
  const ask = page.locator('.overlay[role=alertdialog]');
  // The page's list goes stale: the hub's two network STATE frames are held back while Move down
  // changes the list, so the next Remove carries an old generation and an old slot. The hub refuses it
  // (CONFLICT); the card waits for the newer list, finds cafe again by name and removes it.
  hold.on = true;
  await arrow(0, 'Move down').click();
  await sleep(800);
  await arrow(0, 'Move down').waitFor();
  await page.waitForFunction(() => !document.querySelector('.sn .ui-tile-act .og-btn.rm[disabled]'), null, { timeout: 8000 });
  ok('the held page still shows the old order', (await titles(page)).join() === 'Neutrino,cafe');
  await page.locator('.sn .ui-tile', { hasText: 'cafe' }).locator('.ui-tile-act .og-btn.rm').click();
  await ask.locator('button.confirm').click();
  await sleep(500);
  hold.release();
  // After a CONFLICT the retried remove asks the host's confirm once more.
  let asked = 0;
  for (let i = 0; i < 60 && await sum(page) !== '1 of 4 saved'; i++) {
    if (await ask.count()) { await ask.locator('button.confirm').click(); asked++; }
    await sleep(100);
  }
  ok('the hub refused the stale generation and the card retried once', asked === 1, asked);
  await waitSum(page, '1 of 4 saved');
  ok('stale list: cafe is removed by name, Neutrino stays, no error shown',
    (await titles(page)).join() === 'Neutrino' && (await status(page)) === '', await status(page));
  await page.fill('.sn-form input[aria-label="Name"]', 'cafe');
  await page.fill('.sn-form input[aria-label="Passphrase"]', SECRET);
  await page.click('.sn-form button');
  await waitTitles(page, ['Neutrino', 'cafe']);

  const removeBtn = (i) => page.locator('.sn .ui-tile').nth(i).locator('.ui-tile-act .og-btn.rm');
  await removeBtn(1).click();
  await ask.waitFor();
  await ask.locator('button:not(.confirm)').click();
  await ask.waitFor({ state: 'hidden' });
  ok('Remove asks first (the hub flags the op destructive); Cancel leaves the list', await sum(page) === '2 of 4 saved' && (await titles(page)).join() === 'Neutrino,cafe');
  await removeBtn(1).click();
  await ask.locator('button.confirm').click();
  await waitSum(page, '1 of 4 saved');
  ok('Remove: confirmed, cafe is gone', (await titles(page)).join() === 'Neutrino');

  await removeBtn(0).click();
  await ask.locator('button.confirm').click();
  await page.waitForFunction(() => document.querySelector('.sn-status')?.textContent, null, { timeout: 8000 });
  ok('the live entry\'s removal is refused with the hub\'s reason', await status(page) === 'Hub is connected through this network' && await sum(page) === '1 of 4 saved', await status(page));

  // A bad passphrase is stopped before the wire, with the rule in the tip.
  await page.fill('.sn-form input[aria-label="Name"]', 'cafe');
  await page.fill('.sn-form input[aria-label="Passphrase"]', 'short');
  ok('a 5-character passphrase leaves Add off, the rule in its tip',
    await page.locator('.sn-form button').isDisabled() && /8 to 63/.test(await page.locator('.sn-form button').getAttribute('data-tip') || ''));

  // The secret is nowhere the page keeps.
  const kept = await page.evaluate(() => JSON.stringify([document.documentElement.innerText, { ...localStorage }, { ...sessionStorage }]));
  ok('the passphrase is not on the page, in storage or in the console', !kept.includes(SECRET) && !logs.some((l) => l.includes(SECRET)));
  ok('no page errors', !logs.some((l) => l.startsWith('pageerror')), logs.filter((l) => l.startsWith('pageerror')));
  await cfg.ctx.close();
}

console.log('fallback');
{
  const { ctx, page } = await open({ token: TOKEN, disabled: true });
  await page.waitForSelector('[data-uid="23:generation"]', { timeout: 20000 });
  ok('with the plugin off the generic cards show the channels', await page.locator('.sn').count() === 0
    && await page.locator('[data-uid="24:ssid0"]').count() > 0);
  await ctx.close();
}

await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
