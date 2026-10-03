/**
 * renderer-class.test.mjs — the RFC-062 draft class model, device-free.
 *
 * Thresholds, hysteresis in both sweep directions, the pointer rule, and
 * §12's invariant that a class switch never changes reachable content: for
 * every category of the recorded valencesim catalog, every class projects
 * the same fields, only inline vs drill-in moves. The live half (active tab,
 * scroll anchor, a pending write surviving the remount) is a browser check in
 * test/responsive-matrix.mjs (`--only class`).
 *
 * Run: node test/renderer-class.test.mjs
 */

import { readFileSync } from 'node:fs';
import {
  nextClass, promotes, projectGroups, CLASSES,
  FULL_UP, FULL_DOWN, GLANCE_UP, GLANCE_DOWN, DRILL_AFTER, FLOOR_W, FLOOR_H,
} from '../src/model/rclass.js';
import { buildSettingsModel, surfacedFields } from '../src/model/settings.js';
import { decodeCatalog, UI_RANK, PACKED, CHANNEL_CLASS, UI_CATEGORY } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};

// ---- selection --------------------------------------------------------------
ok('first derivation: 1280 fine is full', nextClass(null, 1280, 'fine') === 'full');
ok('first derivation: 960 is full (matches every 960px media query)', nextClass(null, 960, 'fine') === 'full');
ok('first derivation: 959 is handheld', nextClass(null, 959, 'fine') === 'handheld');
ok('first derivation: 360 coarse is handheld', nextClass(null, 360, 'coarse') === 'handheld');
ok('first derivation: 200 is glance', nextClass(null, 200, 'fine') === 'glance');
ok('a large touch tablet is full: pointer picks primitives, not class', nextClass(null, 1280, 'coarse') === 'full');
ok('no pointer selects glance', nextClass(null, 600, 'none') === 'glance');
ok('no pointer at 960+ is glance too (the e-stop lives in the top strip)', nextClass(null, 1280, 'none') === 'glance');

ok('bands are at least 10 % of their boundary',
   (FULL_UP - FULL_DOWN) / 2 >= 0.1 * (FULL_UP + FULL_DOWN) / 2
   && (GLANCE_UP - GLANCE_DOWN) / 2 >= 0.1 * (GLANCE_UP + GLANCE_DOWN) / 2);
ok('handheld never exists at 960+ (the CSS split stays true)',
   [...Array(3000).keys()].every((w) => w < FULL_UP || nextClass('handheld', w, 'fine') !== 'handheld'));

// ---- hysteresis: sweep down then up, 1 px at a time ---------------------------
function sweep(from, to, start) {
  const seq = [];
  let c = start;
  const step = from < to ? 1 : -1;
  for (let w = from; w !== to + step; w += step) {
    const n = nextClass(c, w, 'fine');
    if (n !== c) seq.push(n + '@' + w);
    c = n;
  }
  return { seq, end: c };
}
const down = sweep(1400, 150, 'full');
ok('sweeping down switches full->handheld->glance once each',
   down.seq.join(' ') === 'handheld@' + (FULL_DOWN - 1) + ' glance@' + (GLANCE_DOWN - 1), down.seq.join(' '));
const up = sweep(150, 1400, 'glance');
ok('sweeping up switches glance->handheld->full once each',
   up.seq.join(' ') === 'handheld@' + GLANCE_UP + ' full@' + FULL_UP, up.seq.join(' '));

// Jitter across a boundary inside the band never flips the class.
let c = 'full';
let flips = 0;
for (let i = 0; i < 200; i++) {
  const n = nextClass(c, 870 + (i % 2 ? 60 : -60), 'fine');
  if (n !== c) flips++;
  c = n;
}
ok('a window dragged back and forth inside the band never flips', flips === 0);

// ---- §11 drill-in promotion ---------------------------------------------------
ok('full never promotes', !promotes('full', 40));
ok('handheld promotes past ' + DRILL_AFTER, promotes('handheld', DRILL_AFTER + 1) && !promotes('handheld', DRILL_AFTER));
ok('glance promotes every subgroup', promotes('glance', 1));

// ---- page tree per class: same reachable content ------------------------------
const entries = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
const model = buildSettingsModel(entries);
const uids = (proj) => proj.flatMap((p) => p.group.fields.map((f) => f.uid)).sort().join(',');
let same = true;
let promoted = 0;
for (const cat of model.categories) {
  const trees = CLASSES.map((k) => projectGroups(cat.groups, k));
  if (new Set(trees.map(uids)).size !== 1) same = false;
  if (trees.some((t) => t.map((p) => p.group).some((g, i) => g !== cat.groups[i]))) same = false;
  promoted += trees[1].filter((p) => p.drill).length;
}
ok('every category reaches the same fields, in catalog order, under every class',
   same && model.categories.length > 0, model.categories.length + ' categories');
ok('the fixture exercises handheld promotion', promoted > 0, promoted + ' promoted group(s)');

// ---- RENDERING §4/§12: rank-driven default surfacing per class ---------------
// One field per rank, plus unranked, an unknown rank, an advanced-bit control
// and a claimed control, declared out of rank order so a sort would show.
{
  const f = (name, rank, extra = {}) => ({ name, type: PACKED.u8, typeName: 'u8', unit: '', scale: 1, rank, ...extra });
  const entries = [{
    id: 0x0f00, name: 'synthetic', cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz: 0, priority: 1,
    category: UI_CATEGORY.generator, categoryKnown: true, categoryName: 'generator', settingChannel: null, schema: null,
    layout: [
      f('c_one', UI_RANK.control), f('d_one', UI_RANK.detail), f('h_one', UI_RANK.hero),
      f('a_one', UI_RANK.advanced), f('g_one', UI_RANK.diagnostic), f('x_one', UI_RANK.hidden),
      f('u_one', undefined), f('k_one', 9), f('c_two', UI_RANK.control),
      f('c_adv', UI_RANK.control, { flagBits: { advanced: true } }), f('c_claimed', UI_RANK.control),
    ],
  }];
  const synth = buildSettingsModel(entries);
  const claimed = new Set(synth.fields.filter((x) => x.name === 'c_claimed').map((x) => x.uid));
  const names = (cls) => surfacedFields(synth.fields, claimed, cls).map((x) => x.name).join(',');
  ok('glance surfaces hero only', names('glance') === 'h_one', names('glance'));
  ok('handheld surfaces hero + control, declaration order', names('handheld') === 'c_one,h_one,c_two', names('handheld'));
  ok('full surfaces hero + control, declaration order', names('full') === 'c_one,h_one,c_two', names('full'));
  const tabbed = synth.categories.flatMap((c) => c.groups.flatMap((g) => g.fields.map((x) => x.name)));
  ok('detail, unranked, unknown-rank and claimed fields stay reachable on the category page',
     ['d_one', 'u_one', 'k_one', 'c_claimed'].every((n) => tabbed.includes(n)) && !tabbed.includes('x_one'), tabbed.join(','));
}

// ---- DESIGN §10.4 states the boundaries and the floor (ph-vdk.48) -----------
{
  const design = readFileSync(new URL('../docs/DESIGN.md', import.meta.url), 'utf8');
  for (const [n, v] of Object.entries({ FULL_UP, FULL_DOWN, GLANCE_UP, GLANCE_DOWN, FLOOR_W, FLOOR_H })) {
    ok('DESIGN states ' + n + ' ' + v, design.includes('`' + n + '` ' + v));
  }
  ok('the floor is glance', nextClass(null, FLOOR_W, 'fine') === 'glance');
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS — class selection holds its bands and loses nothing.'));
process.exit(fails ? 1 : 0);
