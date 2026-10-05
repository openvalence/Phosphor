/**
 * fuzzy.test.mjs -- F3 matching (src/model/fuzzy.js).
 *
 * Fails if unordered words or subsequences stop matching, if a scattered match
 * outranks a contiguous one, or if a miss stops returning null.
 *
 * Run: node test/fuzzy.test.mjs
 */
import { score, rank } from '../src/model/fuzzy.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const labels = ['Stroke length', 'In speed', 'Spindle depth', 'Out speed'];
const order = (q) => labels.map((l) => [score(q, l), l]).filter((x) => x[0] != null).sort((a, b) => b[0] - a[0]).map((x) => x[1]);

ok("'spd in' ranks 'In speed' first", order('spd in')[0] === 'In speed', order('spd in').join(', '));
ok('words match in any order', score('speed in', 'In speed') != null);
ok('contiguous beats scattered', score('speed', 'In speed') > score('sped', 'Spindle depth'));
ok('a tighter subsequence beats a looser one', score('sd', 'sd bar') > score('sd', 'sxxxxd bar'));
ok('no match returns null', score('zzz', 'In speed') === null);
ok('one missing word returns null', score('speed zzz', 'In speed') === null);
const items = [{ label: 'Speed', path: 'Motion limits' }, { label: 'Motion list', path: 'x' }, { label: 'Vmax', path: 'Limits' }];
ok('a label hit outranks a tighter path hit', rank('motion', [{ label: 'Speed', path: 'Motion' }, { label: 'Mxoxtxixoxn', path: 'x' }])[0].label === 'Mxoxtxixoxn');
ok('words span page and label', rank('motion speed', items)[0].label === 'Speed' && rank('limits vmax', items)[0].label === 'Vmax');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
