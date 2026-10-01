/**
 * grid-model.test.mjs -- the builder grid model (DESIGN §10.5, §10.6),
 * device-free: cell conversion, cell count, the coarse-pointer scale clamp,
 * named layouts, inert absent ids, storage that throws, and the migration of
 * the per-class span maps and the legacy sd32 keys.
 *
 * Run: node test/grid-model.test.mjs
 */
import {
  CELL_DEVICE_PX, SCALE_STEPS, DEFAULT_W, STORE_KEY,
  cellCssPx, cellCount, allowedSteps, clampScale, stepScale, pack, commitPin, commitOrder,
  loadStore, saveStore, viewMap, switchLayout, saveLayoutAs, renameLayout, deleteLayout,
  loadScale, saveScale,
} from '../src/model/grid.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  const writes = [];
  return {
    writes,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { writes.push(k); m.set(k, String(v)); },
    removeItem: (k) => { writes.push('-' + k); m.delete(k); },
  };
}
const throwing = {
  get length() { throw new Error('denied'); },
  key() { throw new Error('denied'); },
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};
const items = (...ids) => ids.map((id) => ({ id, title: id }));
const ids = (list) => list.map((p) => p.id).join(',');

// ---- device px -> CSS px ------------------------------------------------------
console.log('cells');
ok('default edge sits in the 32 to 40 device px band', CELL_DEVICE_PX >= 32 && CELL_DEVICE_PX <= 40);
for (const dpr of [1, 1.25, 1.5, 2]) {
  const css = cellCssPx(CELL_DEVICE_PX, dpr);
  ok('DPR ' + dpr + ': ' + CELL_DEVICE_PX + ' device px is ' + css + ' CSS px', Math.abs(css * dpr - CELL_DEVICE_PX) < 1e-9);
}
ok('scale multiplies the edge, rounded to whole device px', cellCssPx(36, 1.25, 1.1) * 1.25 === 40);

// ---- cell count follows the window ----------------------------------------------
const c125 = cellCssPx(CELL_DEVICE_PX, 1.25);
ok('3840x2160 at 125%: 3072 CSS px holds ' + cellCount(3072, c125) + ' cells', cellCount(3072, c125) === Math.floor(3072 / c125));
ok('1440 at DPR 1 holds 40 cells', cellCount(1440, cellCssPx(36, 1)) === 40);
ok('a cell-exact width does not lose a cell to float error', cellCount(36 * 7 / 1.25, c125) === 7);
ok('a zero-width grid still has one cell', cellCount(0, 36) === 1);
ok('wider window, more cells', cellCount(1920, 36) > cellCount(1280, 36));

// ---- scale clamp ------------------------------------------------------------------
console.log('scale');
const fine = allowedSteps({ coarse: false, viewportPx: 1920 });
ok('a fine pointer may use every step on a wide window', fine.length === SCALE_STEPS.length);
const coarse = allowedSteps({ coarse: true, viewportPx: 1920 });
ok('a coarse pointer drops every step that shrinks a target (law 12)', coarse[0] === 1 && coarse.length < SCALE_STEPS.length, coarse.join(','));
ok('coarse: a wish for the smallest step clamps to 1', clampScale(0.67, coarse) === 1);
const phone = allowedSteps({ coarse: true, viewportPx: 360 });
ok('a 360 px phone never scales the layout narrower than 320', phone.every((s) => s === 1 || 360 / s >= 320), phone.join(','));
ok('scale 1 is always allowed', allowedSteps({ coarse: true, viewportPx: 100 }).includes(1));
ok('step up and down walk the allowed list and stop at the ends',
   stepScale(1, 1, fine) === 1.1 && stepScale(1, -1, fine) === 0.9 && stepScale(2, 1, fine) === 2 && stepScale(0.67, -1, fine) === 0.67);
ok('garbage scale reads as 1', clampScale('x', fine) === 1);

// ---- placement --------------------------------------------------------------------
console.log('placement');
{
  const fresh = pack(items('a', 'b', 'c'), {}, 104);
  ok('unsaved items flow left to right at DEFAULT_W', fresh[0].x === 0 && fresh[1].x === DEFAULT_W && fresh[2].y === 1, JSON.stringify(fresh.map((p) => [p.x, p.y])));
  const narrow = pack(items('a', 'b'), {}, 30);
  ok('a narrow window clamps width and stacks', narrow[0].w === 30 && narrow[1].y === 1);
  const saved = { a: { x: 0, y: 5, w: 10, h: 2 }, b: { x: 4, y: 0, w: 10, h: 1 } };
  const p = pack(items('a', 'b'), saved, 40);
  ok('saved items compact upward and never overlap', p[0].id === 'b' && p[1].id === 'a' && p[1].y === 1, JSON.stringify(p.map((q) => [q.id, q.x, q.y])));
  const pinned = pack(items('a', 'b'), saved, 40, { id: 'a', x: 4, y: 0, w: 10, h: 2 });
  ok('a pin wins its cell and pushes the other down', pinned[0].id === 'a' && pinned[0].y === 0 && pinned[1].y === 2);
  const m = { ...saved };
  commitPin(m, items('a', 'b'), 40, { id: 'a', x: 4, y: 0, w: 10, h: 2 });
  ok('commitPin writes the compacted result', m.a.y === 0 && m.b.y === 2);
  const o = { a: { x: 0, y: 0, w: 40, h: 1 }, b: { x: 0, y: 1, w: 40, h: 1 } };
  commitOrder(o, items('a', 'b'), 40, ['b', 'a']);
  ok('commitOrder swaps reading order', o.b.y === 0 && o.a.y === 1);
  ok('corrupt entries are clamped, not trusted', pack(items('a'), { a: { x: -9, y: 'q', w: 999, h: -1 } }, 20)[0].w === 20);
}

// ---- named layouts, inert ids, round trip --------------------------------------
console.log('layouts');
{
  const st = memStorage();
  const s = loadStore(st);
  ok('a fresh client has one layout named Default', s.active === 'Default' && Object.keys(s.layouts).join() === 'Default');
  const m = viewMap(s, 'full', 'machine');
  m.ghost = { x: 3, y: 0, w: 4, h: 1 };   // an id this catalog lacks
  commitPin(m, items('a', 'b'), 40, { id: 'a', x: 0, y: 0, w: 8, h: 1 });
  ok('an absent id is never visited by placement', !pack(items('a', 'b'), m, 40).some((p) => p.id === 'ghost'));
  ok('an absent id survives a commit untouched', JSON.stringify(m.ghost) === '{"x":3,"y":0,"w":4,"h":1}');
  ok('save as copies and switches', saveLayoutAs(s, 'Evening') && s.active === 'Evening' && viewMap(s, 'full', 'machine').a.w === 8);
  viewMap(s, 'full', 'machine').a.w = 20;
  ok('the copy is independent', s.layouts.Default['full.machine'].a.w === 8);
  ok('a taken or empty name is refused', !saveLayoutAs(s, 'Default') && !saveLayoutAs(s, '  ') && !saveLayoutAs(s, '__proto__'));
  ok('rename moves the active name', renameLayout(s, 'Evening', 'Night') && s.active === 'Night' && !s.layouts.Evening);
  ok('switch selects another layout', switchLayout(s, 'Default') && viewMap(s, 'full', 'machine').a.w === 8);
  ok('switch to an unknown name is refused', !switchLayout(s, 'Nope') && s.active === 'Default');
  saveStore(st, s);
  const back = loadStore(st);
  ok('the store survives a reload', back.active === 'Default' && back.layouts.Night['full.machine'].a.w === 20);
  ok('the absent id survives the reload', JSON.stringify(back.layouts.Default['full.machine'].ghost) === '{"x":3,"y":0,"w":4,"h":1}');
  ok('delete the active layout falls back to another', deleteLayout(back, 'Default') && back.active === 'Night');
  ok('the last layout cannot be deleted', !deleteLayout(back, 'Night'));
  saveScale(st, 1.25);
  ok('scale persists', loadScale(st) === 1.25);
  st.setItem('phosphor.scale', '7');
  ok('an off-list stored scale reads as 1', loadScale(st) === 1);
}

// ---- storage that throws ------------------------------------------------------
console.log('degrade');
{
  let s, threw = false;
  try {
    s = loadStore(throwing);
    commitPin(viewMap(s, 'full', 'x'), items('a'), 10, { id: 'a', x: 2, y: 0, w: 3, h: 1 });
    saveLayoutAs(s, 'B');
    saveStore(throwing, s);
    saveScale(throwing, 2);
  } catch (e) { threw = true; }
  ok('throwing storage never throws out of the model', !threw);
  ok('and the in-memory store still works', s && s.active === 'B' && s.layouts.B['full.x'].a.x === 2);
  ok('scale falls back to 1', loadScale(throwing) === 1);
}

// ---- migration -----------------------------------------------------------------
console.log('migration');
{
  // Twelve-span map with visual order c, a, b; a and b share a row at span 6.
  const spans = { a: { span: 6, order: 1 }, b: { span: 6, order: 2 }, c: { span: 12, order: 0 }, gone: { span: 3, order: 3 } };
  const st = memStorage({ 'phosphor.dash.full.cat2': JSON.stringify(spans), 'phosphor.dash.handheld.cat2': JSON.stringify({ a: { span: 12, order: 0 } }) });
  const s = loadStore(st);
  const m = s.layouts.Default['full.cat2'];
  ok('per-class maps seed Default', !!m && !!s.layouts.Default['handheld.cat2']);
  const order = ids(pack(items('a', 'b', 'c'), m, 48));
  ok('a seeded 12-span map keeps visual order', order === 'c,a,b', order);
  ok('two half spans share a row', m.a.y === m.b.y && m.a.x < m.b.x);
  ok('an id this catalog lacks migrates and stays inert', !!m.gone && !pack(items('a', 'b', 'c'), m, 48).some((p) => p.id === 'gone'));
  ok('migration writes nothing by itself', st.writes.length === 0);

  const legacy = memStorage({ 'sd32.dash.machine': JSON.stringify({ x: { span: 12, order: 1 }, y: { span: 12, order: 0 } }) });
  const L = loadStore(legacy);
  const lo = ids(pack(items('x', 'y'), L.layouts.Default['full.machine'], 48));
  ok('a legacy sd32 key seeds the full class and keeps order', lo === 'y,x', lo);
  commitPin(viewMap(L, 'full', 'machine'), items('x', 'y'), 48, { id: 'x', x: 0, y: 0, w: 4, h: 1 });
  saveStore(legacy, L);
  ok('the legacy key is never written or deleted', !legacy.writes.some((k) => k.includes('sd32')) && legacy.getItem('sd32.dash.machine') !== null
     && legacy.writes.every((k) => k === STORE_KEY), legacy.writes.join());

  const reset = memStorage({ 'sd32.dash.machine': JSON.stringify({ x: { span: 4, order: 0 } }), 'phosphor.dash.full.machine': '{}' });
  ok('a reset per-class map wins over the legacy key', Object.keys(loadStore(reset).layouts.Default['full.machine']).length === 0);

  const existing = memStorage({ [STORE_KEY]: JSON.stringify({ active: 'A', layouts: { A: { 'full.v': { q: { x: 1, y: 0, w: 2, h: 1 } } } } }), 'sd32.dash.v': '{}' });
  ok('an existing store is loaded as is, migration skipped', loadStore(existing).layouts.A['full.v'].q.x === 1 && !loadStore(existing).layouts.Default);
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- grid model holds.'));
process.exit(fails ? 1 : 0);
