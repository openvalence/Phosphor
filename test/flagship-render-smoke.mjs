/**
 * flagship-render-smoke.mjs — NO-MOTION render verification of the flagship
 * UI frame against the real device (or any live hub serving the bundle).
 *
 * Asserts, at a desktop viewport:
 *   - the nav rail renders with a Dash tab plus machine-derived entries,
 *     switching tabs swaps the pane, and the mini-rail collapse works;
 *   - the top strip holds the safety pair (pause, then the e-stop outermost),
 *     visible and fireable, with one e-stop on the page and no TransportBar
 *     or bottom safety dock (RFC-085, DESIGN §10.3);
 *   - NO strip control is the RFC-034 value-0 placeholder;
 *   - Dash handles are hidden until the sidebar wrench's Edit layout and hide
 *     again on its Done editing; the edit bar's Layout menu offers Reset layout;
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
 * /uitoken is same-origin-only; a localhost origin gets watch tier). With no
 * host it runs against its own private valencesim (test/live-sim.mjs: the
 * built page, /uitoken proxied to the sim's mint; build first: npm run
 * build:only) and SKIPS (exit 0) without the exe; it rides test:browser as
 * check:flagship.
 *
 * Run: node test/flagship-render-smoke.mjs [host]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE } from './dist.mjs';
import { catalogTabs } from './nav.mjs';
import { startSim, serveBundle, SIM } from './live-sim.mjs';

const HOST = process.argv[2];
const own = HOST ? null : await startSim();
if (!HOST && !own) { console.log('SKIP: no host given and no valencesim at ' + SIM); process.exit(0); }
const PAGE_URL = HOST ? 'http://' + HOST + '/' : await serveBundle(own.port, own.http);
const OUT = EVIDENCE;
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
const railTabs = await catalogTabs(page);
ok('nav rail renders (catalog adopted)', railTabs.length > 0);
ok('rail has Dash + machine categories + console entries', railTabs.length >= 6 && railTabs[0].label === 'Dash',
   railTabs.map((t) => t.label).join(' | '));
ok('no legacy top tab strip at desktop width', (await page.$('nav.tabs')) == null);
const sections = page.getByRole('navigation', { name: 'Sections' });
const tab = (name) => sections.getByRole('tab', { name, exact: true });

// Switching to the first category must swap the pane to a settings grid.
const firstCat = railTabs.find((t) => t.id.startsWith('cat'));
if (firstCat) {
  await tab(firstCat.label).click();
  const grid = await page.waitForSelector('main.pane .dash-grid', { timeout: 5000 }).then(() => true).catch(() => false);
  ok('category tab renders a dashboard grid', grid, firstCat.label);
}

// Collapse to the mini rail and back — names hide, glyphs stay.
await page.getByRole('button', { name: 'Collapse navigation' }).click();
ok('mini rail hides names', (await page.$$('nav.rail .rail-name')).length === 0);
ok('mini rail keeps glyphs', (await page.$$('nav.rail .rail-glyph')).length >= 6);
await page.getByRole('button', { name: 'Expand navigation' }).click();
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
// The sidebar wrench drives edit mode; the edit bar rides under the Dash (ph-mdqo.9).
await tab('Dash').click();
await page.waitForSelector('.home .dash-grid', { timeout: 5000 });
// An unbuilt Dash is the seed: rank-surfaced fields, telemetry and the
// card-zone heroes (pattern, limits); the instrument zone holds only the rail.
ok('the seeded Dash holds telemetry + card-zone hero modules', (await page.$$('.home .dash-item')).length >= 3,
   (await page.$$('.home .dash-item')).length + ' modules');
const grips = page.getByRole('button', { name: /^Move / });
ok('handles hidden while reading', (await grips.count()) === 0);
await page.getByRole('button', { name: 'Edit layout' }).click();
ok('handles appear in edit mode', (await grips.count()) > 0);
await page.getByRole('button', { name: 'Layout…' }).click();
const resetUp = await page.getByRole('button', { name: 'Reset layout' }).isVisible();
await page.keyboard.press('Escape');
ok('edit mode offers Reset layout + Done editing', resetUp && await page.getByRole('button', { name: 'Done editing' }).isVisible());
await page.getByRole('button', { name: 'Done editing' }).click();
ok('handles hide again on Done', (await grips.count()) === 0);

// ---- terse mode -------------------------------------------------------------
await tab('Display').click();
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
await tab('Motion').click();
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

// ---- the channel heatmap lights what arrives (ph-8yga) -----------------------
await page.waitForTimeout(1500);
const lit = await page.$$eval('.linkbar .heat .blk', (bs) => bs.filter((b) => parseFloat(b.style.getPropertyValue('--lv')) > 0).length);
ok('the channel heatmap lights the channels that arrive', lit > 0, lit + ' blocks lit');

await tab('Dash').click();                             // back to the Dash for the shot
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
