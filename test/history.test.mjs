/**
 * history.test.mjs -- the history ring and the revert plan (src/model/history.js).
 *
 * Fails if the ring stops at 256 or keeps the wrong end, if a drag becomes
 * many entries, if a baseline value is ever replaced, or if a revert sends a
 * hazard or an unchanged field.
 *
 * Run: node test/history.test.mjs
 */
import { pushEntry, fillBaseline, planRevert, MAX, GESTURE_MS } from '../src/model/history.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const list = [];
for (let i = 0; i < MAX + 10; i++) pushEntry(list, { uid: 'u' + i, label: 'L' + i, before: 0, after: 1, t: i * 5000 });
ok('the ring caps at 256', list.length === 256 && MAX === 256, list.length);
ok('...and drops the oldest', list[0].uid === 'u10' && list.at(-1).uid === 'u265');

const e = { uid: 'a', label: 'A', before: 1, after: 2, t: 1000 };
const g = [];
pushEntry(g, e);
ok('an entry records uid, label, before, after, time', g[0].uid === 'a' && g[0].label === 'A' && g[0].before === 1 && g[0].after === 2 && g[0].t === 1000);
pushEntry(g, { uid: 'a', label: 'A', before: 2, after: 3, t: 1000 + GESTURE_MS - 1 });
ok('a drag is one entry, from its first before to its last after', g.length === 1 && g[0].before === 1 && g[0].after === 3);
pushEntry(g, { uid: 'a', label: 'A', before: 3, after: 1, t: 4000 });
ok('a write after the gesture window is its own entry', g.length === 2);
pushEntry(g, { uid: 'a', label: 'A', before: 1, after: 3, t: 4010 });
ok('a gesture that ends where it began is dropped', g.length === 1 && g[0].after === 3);
ok('a no-change write is not recorded', pushEntry(g, { uid: 'b', before: 5, after: 5, t: 9e6 }) === null && g.length === 1);
pushEntry(g, { uid: 'b', before: 0, after: 1, t: 9e6, trial: true });
pushEntry(g, { uid: 'b', before: 1, after: 0, t: 9e6 + 1 });
ok('a trial and a durable write never share an entry', g.length === 3);

const b0 = fillBaseline(null, [{ uid: 'x', cur: 1 }, { uid: 'y', cur: undefined }]);
ok('the baseline takes reported values only', b0.x === 1 && !('y' in b0));
const b1 = fillBaseline(b0, [{ uid: 'x', cur: 9 }, { uid: 'y', cur: 4 }]);
ok('a later fill adds missing fields and never replaces one', b1 === b0 && b1.x === 1 && b1.y === 4);

const item = (uid, cur, haz = false) => ({ uid, label: uid.toUpperCase(), cur, hazard: () => haz });
const plan = planRevert({ a: 1, b: 2, c: 3, d: 4, e: 5 }, [
  item('a', 1), item('b', 9), item('c', 0, true), item('d', undefined), item('f', 7)]);
ok('revert sends only changed non-hazard fields', JSON.stringify(plan.send) === '[{"uid":"b","to":2}]', JSON.stringify(plan.send));
ok('...and names the skipped hazard', plan.skipped.join() === 'C', plan.skipped.join());
ok('a float equal at f32 precision is unchanged', planRevert({ a: 0.1 }, [item('a', Math.fround(0.1))]).send.length === 0);

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- history'));
process.exit(fails ? 1 : 0);
