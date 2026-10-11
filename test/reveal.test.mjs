// reveal.test.mjs -- the pointer reveal (src/ui/reveal.js, docs/THEMES.md Chrome hooks): the hovered control gets
// --mx/--my, a touch or a move off any control writes nothing, and the listener lives only under a Theme with reveal.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { move, installReveal } = await import('../src/ui/reveal.js');
const { applyTheme, STYLES } = await import('../src/model/theme.js');

let fails = 0;
const ok = (n, c, x) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (x ? '  -- ' + x : '')); if (!c) fails++; };
const el = { style: { v: {}, setProperty(k, v) { this.v[k] = v; } }, getBoundingClientRect: () => ({ left: 100, top: 40 }) };
const child = { closest: () => el };
move({ pointerType: 'mouse', target: child, clientX: 130, clientY: 52 });
ok('a mouse over a control writes its --mx and --my', el.style.v['--mx'] === '30px' && el.style.v['--my'] === '12px', JSON.stringify(el.style.v));
el.style.v = {};
move({ pointerType: 'touch', target: child, clientX: 1, clientY: 1 });
move({ pointerType: 'mouse', target: { closest: () => null }, clientX: 1, clientY: 1 });
ok('a touch, or a pointer over no control, writes nothing', Object.keys(el.style.v).length === 0);

const listeners = new Set();
const doc = { addEventListener: (t, f) => listeners.add(t), removeEventListener: (t, f) => listeners.delete(t) };
installReveal(doc);
const plain = STYLES.find((s) => !s.reveal && s.id !== 'phosphor');
applyTheme(plain.id, { persist: false });
ok('a Theme without reveal installs no listener', listeners.size === 0);
// No shipped Theme asks for it yet: one is lent the flag (themeMeta reads the manifest object).
const withReveal = STYLES.find((s) => s.reveal) || Object.assign(STYLES.find((s) => s.id === 'mica'), { reveal: true });
applyTheme(withReveal.id, { persist: false });
ok(withReveal.id + ' (reveal) listens to pointermove', listeners.has('pointermove'));
applyTheme(plain.id, { persist: false });
ok('leaving it removes the listener', listeners.size === 0);
console.log(fails ? 'FAILURES: ' + fails : 'ALL PASS');
process.exit(fails ? 1 : 0);
