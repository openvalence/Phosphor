/**
 * nudge.test.mjs -- the Shift / Ctrl modifier rule (src/model/nudge.js).
 *
 * Fails if a decade is off by one, if Shift ever steps more than the plain
 * key, or if Ctrl stops landing on decade multiples.
 *
 * Run: node test/nudge.test.mjs
 */
import { decadeBelow, modStep, dragGain, snap } from '../src/model/nudge.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};
const none = {}, shift = { shiftKey: true }, ctrl = { ctrlKey: true };

ok('decade of 0..1000 is 100', decadeBelow(0, 1000) === 100);
ok('decade of 0..50 is 10', decadeBelow(0, 50) === 10);
ok('decade of 0..1e6 is 1e5', decadeBelow(0, 1e6) === 1e5);
ok('decade of -500..500 is 100', decadeBelow(-500, 500) === 100);
ok('a degenerate range falls back to 1', decadeBelow(5, 5) === 1);

for (const step of [1, 0.01, 5]) {
  ok('Shift never exceeds the plain step (' + step + ')', modStep(shift, step, 0, 1000) <= modStep(none, step, 0, 1000));
}
ok('Shift on a key is the declared step', modStep(shift, 0.5, 0, 10) === 0.5 && modStep(shift, 1, 0, 100) === 1);
ok('Ctrl steps the decade', modStep(ctrl, 1, 0, 1000) === 100);
ok('Ctrl never goes below the step', modStep(ctrl, 500, 0, 1000) === 500);

ok('Shift drag runs at a tenth', dragGain(shift, 1) === 0.1);
ok('plain drag keeps its gain', dragGain(none, 0.5) === 0.5);

ok('Ctrl snaps to a decade multiple', snap(234, ctrl, 0, 1000) === 200);
ok('no Ctrl leaves the value', snap(234, none, 0, 1000) === 234);
ok('Ctrl up from 130 and 150 is 200', snap(130, ctrl, 0, 1000, 1) === 200 && snap(150, ctrl, 0, 1000, 1) === 200);
ok('Ctrl down from 130 and 150 is 100', snap(130, ctrl, 0, 1000, -1) === 100 && snap(150, ctrl, 0, 1000, -1) === 100);
ok('Ctrl from a multiple moves one decade', snap(200, ctrl, 0, 1000, 1) === 300 && snap(200, ctrl, 0, 1000, -1) === 100);
ok('Ctrl on a fractional decade does not stall', Math.abs(snap(0.3, ctrl, 0, 1, 1) - 0.4) < 1e-9);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
