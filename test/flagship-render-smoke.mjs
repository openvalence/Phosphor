/**
 * flagship-render-smoke.mjs — NO-MOTION render verification of the flagship
 * UI frame against the real device (or any live hub serving the bundle).
 *
 * Asserts, at a desktop viewport:
 *   - the nav rail renders with a Home tab plus machine-derived entries,
 *     switching tabs swaps the pane, and the mini-rail collapse works;
 *   - the top strip holds the safety pair (pause, then the e-stop outermost),
 *     visible and fireable, with one e-stop on the page and no TransportBar
 *     or bottom safety dock (RFC-085, DESIGN §10.3);
 *   - NO strip control is the RFC-034 value-0 placeholder;
 *   - dashboard handles are hidden until "Edit layout" and hide again on Done;
 *   - the phosphor ring (docs/EFFECTS.md) draws outside the field and wears
 *     each ladder state without moving the box;
 * and at a phone viewport, that the sections move into the phone menu's
 * drawer (no rail, no tab strip) and the strip keeps the pair.
 *
 * FIRES NO INTENTS AND COMMANDS NO MOTION — tab clicks and layout-edit
 * toggles only. Safe to run unattended against a live machine (motion
 * verification is a bench activity, DOCTRINE build/test rules).
 *
 * The page must be loaded FROM THE DEVICE (same reason as browser-check.mjs:
 * /uitoken is same-origin-only; a localhost origin gets watch tier). With
 * --sim the bundle is dist/index.html served here, /uitoken proxied to a
 * running valencesim (build first: npm run build:only).
 *
 * Run: node test/flagship-render-smoke.mjs <host>
 *      node test/flagship-render-smoke.mjs --sim [--port 8882] [--http 8880]
 *        (valencesim --homed --port 8882 --http 8880)
 */

import { DIST_HTML } from './dist.mjs';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { catalogTabs } from './nav.mjs';

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const HOST = args.includes('--sim') ? await serveBundle(argOf('--port', '8882'), argOf('--http', '8880')) : args[0];
if (!HOST) { console.error('usage: node test/flagship-render-smoke.mjs <host> | --sim [--port N] [--http N] -- no baked default, name the hub'); process.exit(1); }
const PAGE_URL = 'http://' + HOST + (HOST.includes('/') ? '' : '/');

/** dist/index.html on an ephemeral port, /uitoken proxied to the sim; returns the page's host, path and query. */
async function serveBundle(wsPort, httpPort) {
  const html = readFileSync(DIST_HTML);
  const srv = createServer((q, s) => {
    if (!q.url.startsWith('/uitoken')) { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(html); return; }
    fetch('http://127.0.0.1:' + httpPort + '/uitoken').then(async (r) => {
      s.writeHead(r.status, { 'Content-Type': 'application/json' }); s.end(await r.text());
    }).catch(() => { s.writeHead(502); s.end('{}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  return '127.0.0.1:' + srv.address().port + '/?hub=127.0.0.1:' + wsPort;
}
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'evidence');
mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

console.log('flagship render smoke @ ' + PAGE_URL);
await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

// ---- desktop: nav rail ------------------------------------------------------
const railUp = await page.waitForSelector('nav.rail [role="tab"]', { timeout: 25000 })
  .then(() => true).catch(() => false);
ok('nav rail renders (catalog adopted)', railUp);

const railTabs = await page.$$eval('nav.rail [role="tab"]', (els) => els.map((e) => e.textContent.trim()));
ok('rail has Home + machine categories + console entries', railTabs.length >= 6 && /home/i.test(railTabs[0]),
   railTabs.join(' | '));
ok('no legacy top tab strip at desktop width', (await page.$('nav.tabs')) == null);

// Switching to the second rail entry must swap the pane to a settings grid.
const second = (await page.$$('nav.rail [role="tab"]'))[1];
if (second) {
  await second.click();
  const grid = await page.waitForSelector('.dash-grid', { timeout: 5000 }).then(() => true).catch(() => false);
  ok('category tab renders a dashboard grid', grid);
}

// Collapse to the mini rail and back — names hide, glyphs stay.
await page.click('.rail-collapse');
ok('mini rail hides names', (await page.$$('nav.rail .rail-name')).length === 0);
ok('mini rail keeps glyphs', (await page.$$('nav.rail .rail-glyph')).length >= 6);
await page.click('.rail-collapse');
ok('rail expands again', (await page.$$('nav.rail .rail-name')).length >= 6);

// ---- the top strip -----------------------------------------------------------
// One strip holds the safety pair, bound by safety-op identity: pause, then the
// e-stop outermost. TransportBar and the bottom safety dock are retired.
const pairUp = await page.waitForSelector('.topstrip .pair .safety-op button', { timeout: 10000 })
  .then(() => true).catch(() => false);
ok('the top strip renders the safety pair', pairUp);
const pairOf = () => page.$$eval('.topstrip .pair .safety-op button', (els) => els.map((b) => {
  const r = b.getBoundingClientRect();
  return { cls: b.className, enabled: !b.disabled, shown: r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight };
}));
const pair = await pairOf();
ok('the pair is pause then e-stop, the e-stop outermost',
   pair.length === 2 && /\bbtn-pause\b/.test(pair[0].cls) && /\bbtn-estop\b/.test(pair[1].cls), JSON.stringify(pair));
ok('both are on screen and fireable for this session', pair.length === 2 && pair.every((b) => b.shown && b.enabled),
   JSON.stringify(pair));
ok('one e-stop on the page', (await page.$$('.btn-estop')).length === 1);
ok('no TransportBar and no bottom safety dock', (await page.$$('.transportbar, .safetydock')).length === 0);
const stripLabels = await page.$$eval('.topstrip button', (els) => els.map((e) => e.textContent.trim().toLowerCase()));
ok('no value-0 "reserved" placeholder rendered', !stripLabels.some((t) => /reserved|unused|none/.test(t)),
   stripLabels.join(' | '));

// ---- fixed-viewport architecture (UX maturity pass) ------------------------
// Desktop must never scroll as a page: the pane region is the only scroll
// area, so the strip and footer are on screen by construction.
const pageScrolls = await page.evaluate(() =>
  document.scrollingElement.scrollHeight > window.innerHeight + 2);
ok('desktop page does not scroll (fixed-viewport column)', !pageScrolls);
const dockBox = await page.$eval('.topstrip', (el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.height > 0;
});
ok('the strip is fully on screen without scrolling', dockBox);

// ---- edit-layout mode -------------------------------------------------------
await page.click('nav.rail [role="tab"]');            // back to Home
await page.waitForSelector('.home .dash-grid', { timeout: 5000 });
// An unbuilt home is the seed: rank-surfaced fields, telemetry and the
// card-zone heroes (pattern, limits); the instrument zone holds only the rail.
ok('the seeded home holds telemetry + card-zone hero modules', (await page.$$('.home .dash-item')).length >= 3,
   (await page.$$('.home .dash-item')).length + ' modules');
ok('handles hidden while reading', (await page.$$('.dash-item .handle')).length === 0);
{ const bar = page.locator('.home .dash-toolbar button:has-text("Edit layout")'); await (await bar.count() ? bar : page.locator('button[title="Edit layout"]:visible')).first().click(); }
ok('handles appear in edit mode', (await page.$$('.dash-item .handle')).length > 0);
const editButtons = await page.$$eval('.dash-toolbar button', (els) => els.map((e) => e.textContent.trim()));
ok('edit mode offers Reset + Done', editButtons.join(',').includes('Reset') && editButtons.join(',').includes('Done'));
await page.click('.home .dash-toolbar .done-btn');
ok('handles hide again on Done', (await page.$$('.dash-item .handle')).length === 0);

// ---- terse mode -------------------------------------------------------------
const railTabsEls = await page.$$('nav.rail [role="tab"]');
await railTabsEls[railTabsEls.length - 1].click();     // Display (last console entry)
const TERSE = 'label.og-switch:has-text("Terse instruments")';
await page.waitForSelector(TERSE, { timeout: 5000 });
const terseOn = () => page.evaluate(() => document.documentElement.classList.contains('terse'));
const terseWas = await terseOn();
await page.click(TERSE);
ok('the Terse switch flips the page mode', (await terseOn()) !== terseWas);
await page.click(TERSE);
ok('...and back', (await terseOn()) === terseWas);

// ---- settings descriptions: terse MOVES them, never drops them -------------
// Field.svelte: verbose prints a field's description inline under the control,
// terse holds it on the info button's hover tip. Exactly one carrier is ever
// live — both at once is the duplicate truth the density pass exists to stop.
const fieldTabs = await page.$$('nav.rail [role="tab"]');
const tabText = await Promise.all(fieldTabs.map(async (t) => (await t.textContent()).trim().toLowerCase()));
await fieldTabs[tabText.findIndex((t) => t.includes('motion'))].click();
// The affordance only renders in TERSE, so it has to be measured there. A
// display:none element reports an all-zero rect, which would make the
// centering check below pass without measuring anything.
await page.evaluate(() => document.documentElement.classList.add('terse'));
const infoUp = await page.waitForSelector('.field .info-wrap .info', { state: 'visible', timeout: 15000 })
  .then(() => true).catch(() => false);
ok('described settings fields render an info affordance', infoUp);

// Centering regression guard: a `button` carries UA padding, and under
// border-box that shrinks this 18px control's content box below the glyph's
// own width — which pins the glyph to the content edge instead of centering
// it. Measured 3.5px off before `padding: 0` landed.
const glyph = await page.$eval('.field .info-wrap .info', (el) => {
  const b = el.getBoundingClientRect(), g = el.querySelector('.glyph').getBoundingClientRect();
  return { w: b.width, h: b.height,
           off: Math.max(Math.abs((g.x + g.width / 2) - (b.x + b.width / 2)),
                         Math.abs((g.y + g.height / 2) - (b.y + b.height / 2))) };
});
ok('info button is actually laid out (guards a vacuous zero)', glyph.w > 0 && glyph.h > 0,
   glyph.w + 'x' + glyph.h);
ok('info glyph is centered in its button', glyph.off < 0.51, glyph.off.toFixed(3) + 'px off');

// Verbose hides the button outright — the description is already on screen,
// so there is nothing for it to reveal. Only terse can be hovered, and the
// hover must come AFTER the mode switch: terse hides every inline description
// at once, and that reflow slides the button out from under a pointer parked
// at fixed viewport coordinates.
const setTerse = async (on) => {
  await page.evaluate((v) => document.documentElement.classList.toggle('terse', v), on);
  if (on) await page.hover('.field .info-wrap .info');
  await page.waitForTimeout(220);            // clear the .12s tip transition
  return page.evaluate(() => {
    const d = document.querySelector('.field .field-desc');
    const t = document.querySelector('.field .info-wrap .tip');
    const w = document.querySelector('.field .info-wrap');
    return { inline: d ? getComputedStyle(d).display !== 'none' : null,
             tip: t ? getComputedStyle(t).visibility : null,
             affordance: w ? getComputedStyle(w).display !== 'none' : null };
  });
};
const verbose = await setTerse(false);
ok('verbose prints the description inline', verbose.inline === true, JSON.stringify(verbose));
ok('verbose hides the info button entirely', verbose.affordance === false, JSON.stringify(verbose));
ok('verbose does not also pop the hover tip', verbose.tip === 'hidden', JSON.stringify(verbose));
const terseMode = await setTerse(true);
ok('terse drops the inline description', terseMode.inline === false, JSON.stringify(terseMode));
ok('terse shows the info button', terseMode.affordance === true, JSON.stringify(terseMode));
ok('terse reveals the tip on hover', terseMode.tip === 'visible', JSON.stringify(terseMode));
await setTerse(false);

// ---- slider values are typeable --------------------------------------------
// A slider carries no numerals of its own, so its chip is the only place an
// exact value can be entered. A readout must never gain one: no setting_key
// means it is effective truth, not a control.
const typeable = await page.evaluate(() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  return {
    sliders: q('.field[data-widget="slider"]').length,
    typeableSliders: q('.field[data-widget="slider"] .field-value .chip-num').length,
    typeableReadouts: q('.field[data-widget="readout"] .chip-num').length,
    spinners: getComputedStyle(document.querySelector('.chip-num') || document.body).appearance,
  };
});
ok('every slider chip is typeable', typeable.sliders > 0 && typeable.sliders === typeable.typeableSliders,
   typeable.typeableSliders + '/' + typeable.sliders);
ok('no readout became typeable', typeable.typeableReadouts === 0);
ok('typeable chip keeps native spinners stripped', typeable.spinners === 'textfield', typeable.spinners);

// ---- the phosphor ring (docs/EFFECTS.md) ------------------------------------
// Drives the ladder by setting data-shadow directly: fires NO intent and
// writes nothing to the machine. The wiring dies silently when Svelte renames
// scoped @keyframes or an --fx-* property goes unregistered (webui.md T25).
const ringStates = await page.evaluate(() => {
  const f = document.querySelector('.field[data-widget="slider"]');
  if (!f) return null;
  const anims = () => f.getAnimations().filter((a) => a instanceof CSSAnimation).map((a) => a.animationName).sort().join(',');
  const box = () => { const r = f.getBoundingClientRect(); return [r.width, r.height].join('x'); };
  const shadow = f.getAttribute('data-shadow'), glow = f.getAttribute('data-glow');
  const res = { fxg: getComputedStyle(f).getPropertyValue('--fx-g').trim(),
                inset: parseFloat(getComputedStyle(f, '::after').top), boxes: [box()] };
  for (const st of ['pending', 'overdue', 'fault']) { f.setAttribute('data-shadow', st); res[st] = anims(); res.boxes.push(box()); }
  f.setAttribute('data-shadow', 'confirmed');
  f.setAttribute('data-glow', '1');
  res.confirmed = anims();
  res.boxes.push(box());
  for (const [k, v] of [['data-shadow', shadow], ['data-glow', glow]]) {
    if (v == null) f.removeAttribute(k); else f.setAttribute(k, v);
  }
  return res;
});
ok('a slider field exists to carry the ring', ringStates !== null);
if (ringStates) {
  ok('T25: --fx-g is registered (an unregistered one computes to empty)', ringStates.fxg !== '', ringStates.fxg);
  ok('the ring draws outside the field, never inward', ringStates.inset < 0, String(ringStates.inset));
  ok('pending breathes and its pulses travel', ringStates.pending === 'fx-breath,fx-run', ringStates.pending);
  ok('overdue breathes and travels too (amber, slower)', ringStates.overdue === 'fx-breath,fx-run', ringStates.overdue);
  ok('fault is steady: a refused write has finished failing', ringStates.fault === '', ringStates.fault);
  ok('the echo lights the afterglow', ringStates.confirmed === 'fx-glow', ringStates.confirmed);
  ok('no state moves the box', new Set(ringStates.boxes).size === 1, ringStates.boxes.join(' '));
}

// ---- activity heatmap keeps its scroll history -----------------------------
// A reactive read made SYNCHRONOUSLY inside LinkBar's $effect becomes that
// effect's dependency, so a telemetry frame re-runs the body and refills the
// history buffer with zeros ~25x a second: the grid still scrolls, with
// nothing in it. Signature of that bug is every column but the newest sitting
// at the v=0 baseline alpha, so that is what this counts.
await page.waitForTimeout(3600);            // ~16 ticks at 220ms
const staleCols = await page.$eval('canvas.act-grid', (c) => {
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const dpr = c.width / parseFloat(c.style.width);
  const cols = 14, cell = 4, gap = 1;
  const rows = Math.round(parseFloat(c.style.height) / (cell + gap + 1));
  const y = Math.round(((rows - 1) * (cell + gap + 1) + 1) * dpr);   // link-activity row
  let atBaseline = 0;
  for (let col = 0; col < cols; col++) {
    const x = Math.round((col * (cell + gap) + 1) * dpr);
    if (d[(y * c.width + x) * 4 + 3] <= 16) atBaseline++;            // alpha of v=0
  }
  return atBaseline;
});
ok('activity grid retains scroll history', staleCols <= 2,
   staleCols + '/14 columns at the empty baseline');

await page.click('nav.rail [role="tab"]');             // back to Home for the shot
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: join(OUT, 'flagship-desktop.png'), fullPage: false });

// ---- phone viewport: the phone menu, no rail ---------------------------------
// Under 960 px the sections live in the phone menu's drawer, mounted only while open (DESIGN §10.12, ph-5u0g.4).
await page.setViewportSize({ width: 390, height: 844 });
const menuUp = await page.getByRole('button', { name: 'Menu' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
ok('phone width renders the menu button', menuUp);
ok('phone width drops the rail and the tab strip', (await page.getByRole('navigation', { name: 'Sections' }).count()) === 0);
const phoneTabs = await catalogTabs(page, 5000);
ok('the menu opens the sections with the machine categories', phoneTabs.length >= 6, phoneTabs.map((t) => t.label).join(' | '));
ok('phone width keeps the strip pair', (await pairOf()).length === 2);
await page.screenshot({ path: join(OUT, 'flagship-phone.png'), fullPage: false });

ok('no page errors', pageErrors.length === 0, pageErrors.join(' ; '));

await browser.close();
console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
