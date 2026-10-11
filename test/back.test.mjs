/**
 * back.test.mjs -- the Android back press's precedence (src/model/back.js): what is on top
 * closes first, then page fullscreen, then the drawer while there is a page to return to, then a
 * drill-in page, then the previous page, then the menu opens; at the root with the menu open the
 * first press arms and a second inside EXIT_ARM_MS exits (through the close gate, App.svelte).
 * Run: node test/back.test.mjs
 */
import { backAction, EXIT_ARM_MS } from '../src/model/back.js';

let fails = 0;
const ok = (n, c, x) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (c ? '' : '  -- ' + x)); if (!c) fails++; };
const base = { overlay: false, full: false, menuOpen: false, drill: false, history: 0, armedAt: 0, now: 10000 };
const is = (name, over, want) => { const got = backAction({ ...base, ...over }); ok(name + ': ' + want, got === want, got); };

is('an overlay outranks everything', { overlay: true, full: true, menuOpen: true, drill: true, history: 3, armedAt: 9000 }, 'dismiss');
is('page fullscreen outranks the drawer and the pages', { full: true, menuOpen: true, drill: true, history: 3 }, 'unfull');
is('the drawer closes while there is a page to return to', { menuOpen: true, history: 1 }, 'close-menu');
is('...or a drill-in page to leave', { menuOpen: true, drill: true }, 'close-menu');
is('a drill-in page leaves before the previous page', { drill: true, history: 2 }, 'undrill');
is('the previous page', { history: 1 }, 'previous');
is('at the root the menu opens', {}, 'menu');
is('at the root with the menu open the first press arms', { menuOpen: true }, 'arm');
is('a second press inside the window exits', { menuOpen: true, armedAt: 10000 - EXIT_ARM_MS + 1 }, 'exit');
is('a press after the window arms again', { menuOpen: true, armedAt: 10000 - EXIT_ARM_MS }, 'arm');
is('armed, an overlay still closes first', { menuOpen: true, armedAt: 9999, overlay: true }, 'dismiss');

// The handler's walk from a drilled page two pages deep with the drawer open, applied as App applies it.
const s = { ...base, menuOpen: true, drill: true, history: 2 };
const walk = [];
for (let i = 0; i < 8; i++) {
  const a = backAction(s);
  walk.push(a);
  if (a === 'close-menu') s.menuOpen = false;
  else if (a === 'undrill') s.drill = false;
  else if (a === 'previous') s.history--;
  else if (a === 'menu') s.menuOpen = true;
  else if (a === 'arm') { s.armedAt = s.now; s.now += 500; }
  else break;
}
const want = ['close-menu', 'undrill', 'previous', 'previous', 'menu', 'arm', 'exit'];
ok('the whole walk: ' + want.join(' > '), walk.join() === want.join(), walk.join(' > '));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
