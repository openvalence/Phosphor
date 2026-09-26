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
  FULL_UP, FULL_DOWN, GLANCE_UP, GLANCE_DOWN, DRILL_AFTER,
} from '../src/model/rclass.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { decodeCatalog } from '../../Valence/clients/js/index.js';

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
ok('no pointer at 960+ stays full (e-stop split guard)', nextClass(null, 1280, 'none') === 'full');

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

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS — class selection holds its bands and loses nothing.'));
process.exit(fails ? 1 : 0);
