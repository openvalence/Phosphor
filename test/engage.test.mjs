/**
 * engage.test.mjs -- src/ui/engage.js against a fake document (ph-n18c): a
 * click inside engages, an outside pointerdown or wheel disengages without
 * being consumed, Escape disengages unless something else took it.
 * Run: node test/engage.test.mjs
 */
import { engage } from '../src/ui/engage.js';

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) fail++; };

const L = new Map();
const doc = {
  addEventListener: (t, f) => L.set(t, f),
  removeEventListener: (t, f) => { if (L.get(t) === f) L.delete(t); },
};
const inner = {}, outer = {};
const el = { ownerDocument: doc, contains: (t) => t === inner };
const fire = (t, e) => {
  const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...e };
  L.get(t)(ev);
  return ev;
};

const seen = [];
const off = engage(el, (v) => seen.push(v));
const state = () => seen[seen.length - 1] === true;

fire('pointerdown', { target: inner });
ok('a pointerdown inside alone does not engage (a swipe may follow)', !state());
fire('click', { target: inner });
ok('a click inside engages', state());
fire('wheel', { target: inner });
ok('wheel inside keeps it engaged', state());
const pd = fire('pointerdown', { target: outer });
ok('a pointerdown outside disengages', !state());
ok('...and is not consumed', !pd.defaultPrevented);
fire('click', { target: inner });
const wh = fire('wheel', { target: outer });
ok('wheel outside disengages, not consumed', !state() && !wh.defaultPrevented);
fire('click', { target: inner });
fire('keydown', { key: 'Escape', defaultPrevented: true });
ok('an Escape the surface took keeps it engaged', state());
fire('keydown', { key: 'Escape' });
ok('a free Escape disengages', !state());
ok('each change reported once', seen.join() === 'true,false,true,false,true,false');
off();
ok('teardown removes every listener', L.size === 0);

if (fail) { console.log(fail + ' failed'); process.exit(1); }
console.log('engage: all passed');
