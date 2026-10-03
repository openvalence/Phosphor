/**
 * grid-model.test.mjs -- the builder grid model (DESIGN §10.5, §10.6),
 * device-free: cell conversion, cell count, the coarse-pointer scale clamp,
 * named layouts, inert absent ids, storage that throws, and the migration of
 * the per-class span maps and the legacy sd32 keys; nests and modules
 * (ph-e82.6): round trip, reinsertion under a different catalog with inert
 * members, and the single-field placement flag both ways; a placement's look
 * (presentation and config) through place, commits and storage; placements
 * are absolute (operator ruling 2026-10-02): no commit, add or remove ever
 * moves a card the user did not move. The content floor (ph-e82.25):
 * measured px to cells, the larger of static and measured, and the grow of
 * an under-floor rect that stops at a neighbor or the edge. Rows are cells
 * (ph-29r): growHeight is growWidth's twin, an unplaced item is packed at its
 * measured height (`fit`), and a commit holds an add never measured.
 *
 * Run: node test/grid-model.test.mjs
 */
import {
  CELL_DEVICE_PX, SCALE_STEPS, STORE_KEY,
  cellCssPx, cellCount, allowedSteps, clampScale, stepScale, place, blocker, commitPin, commitOrder,
  loadStore, saveStore, viewMap, switchLayout, saveLayoutAs, renameLayout, deleteLayout,
  loadScale, saveScale,
  FIELDS_NESTS_ONLY, placeable, isNest, nestsIn, addNest, nestAdd, nestRemove, setNest, removeNest,
  saveModule, insertModule, deleteModule, resetMap, setLook, resizeRect, RESIZE_FLOOR, nestOut,
  arrangePins, instanceKey, baseKey, duplicate, nudgePin, exportLayout, importLayout,
  DENSITY, layoutOpts, setDensity, cellsFor, floorOf, growWidth, growHeight, pack,
} from '../src/model/grid.js';
import { minCells, orientationOf } from '../src/model/settings.js';

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
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

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
  const fresh = place(items('a', 'b', 'c'), {}, 104);
  ok('unsaved items fill the row at any width (ph-e82.15)', fresh.every((p, i) => p.x === 0 && p.y === i && p.w === 104), JSON.stringify(fresh.map((p) => [p.x, p.y, p.w])));
  const early = place(items('a', 'b'), { a: { x: 0, y: 0, w: 8, h: 1 }, b: { look: { pres: 'knob' } } }, 40);
  ok('an entry with a look but no place yet flows as unsaved and keeps its look',
     early[1].id === 'b' && early[1].y === 1 && early[1].w === 40 && early[1].look.pres === 'knob', JSON.stringify(early));
  const narrow = place(items('a', 'b'), {}, 30);
  ok('a narrow window clamps width and stacks', narrow[0].w === 30 && narrow[1].y === 1);
  const saved = { a: { x: 0, y: 5, w: 10, h: 2 }, b: { x: 4, y: 0, w: 10, h: 1 } };
  const p = place(items('a', 'b'), saved, 40);
  ok('saved items keep their rects: no gravity, a gap stays a gap', p[0].id === 'b' && p[1].id === 'a' && p[1].y === 5 && p[1].x === 0,
     JSON.stringify(p.map((q) => [q.id, q.x, q.y])));
  const pinned = place(items('a', 'b'), saved, 40, { id: 'a', x: 4, y: 0, w: 10, h: 2 });
  ok('a pin on a taken rect lands at the first free row below; the sibling stays', pinned.find((q) => q.id === 'a').y === 1
     && pinned.find((q) => q.id === 'b').y === 0, JSON.stringify(pinned.map((q) => [q.id, q.x, q.y])));
  const m = { ...saved };
  commitPin(m, items('a', 'b'), 40, { id: 'a', x: 4, y: 0, w: 10, h: 2 });
  ok('commitPin writes the pin only', m.a.y === 1 && m.a.x === 4 && m.b === saved.b);
  const o = { a: { x: 0, y: 0, w: 40, h: 1 }, b: { x: 0, y: 1, w: 40, h: 1 } };
  commitOrder(o, items('a', 'b'), 40, ['b', 'a']);
  ok('commitOrder swaps reading order', o.b.y === 0 && o.a.y === 1);
  ok('corrupt entries are clamped, not trusted', place(items('a'), { a: { x: -9, y: 'q', w: 999, h: -1 } }, 20)[0].w === 20);

  // The operator's rule: a card keeps the rect the user gave it.
  const holed = { a: { x: 0, y: 0, w: 40, h: 1 }, c: { x: 0, y: 2, w: 40, h: 1 } };
  ok('a removed card leaves a hole', place(items('a', 'c'), holed, 40).find((q) => q.id === 'c').y === 2);
  const room = { a: { x: 0, y: 0, w: 10, h: 2 }, c: { x: 0, y: 3, w: 40, h: 1 }, d: { w: 10, h: 2 } };
  const added = place(items('a', 'c', 'd', 'e'), room, 40);
  const at = (list, id) => list.find((q) => q.id === id);
  ok('an added card takes the first free rect that fits; the rest stay', at(added, 'd').x === 10 && at(added, 'd').y === 0
     && at(added, 'e').y === 2 && at(added, 'a').y === 0 && at(added, 'c').y === 3, JSON.stringify(added.map((q) => [q.id, q.x, q.y])));
  const fix = { a: { x: 0, y: 0, w: 40, h: 1 } };
  commitPin(fix, items('a', 'b'), 40, { id: 'a', x: 0, y: 5, w: 40, h: 1 });
  ok('an unplaced card is fixed where it was drawn, never into the hole the move opened', fix.b.y === 1 && fix.a.y === 5, JSON.stringify(fix));
  const wide = { a: { x: 0, y: 0, w: 20, h: 1 }, b: { x: 20, y: 0, w: 20, h: 1 } };
  const narrowed = place(items('a', 'b'), wide, 30);
  ok('a narrower window draws a clash one row down and keeps the saved rect', at(narrowed, 'b').y === 1 && at(narrowed, 'b').x === 10
     && wide.b.x === 20 && wide.b.y === 0);
  ok('blocker names what a rect would overlap', blocker(place(items('a', 'b'), wide, 40), { x: 15, y: 0, w: 10, h: 1 }, 'a').id === 'b'
     && blocker(place(items('a', 'b'), wide, 40), { x: 0, y: 1, w: 10, h: 1 }, 'a') === null);

  // Property: whatever is pinned, no other card moves (drawn or stored), nothing overlaps.
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let moved = 0, overlapped = 0;
  for (let t = 0; t < 300; t++) {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const map = {};
    for (const id of ids) if (rnd(5)) map[id] = { x: rnd(30), y: rnd(12), w: 1 + rnd(10), h: 1 + rnd(3) };
    // A layout as commits leave it: saved rects never overlap; some cards still unplaced.
    for (const q of place(items(...ids), map, 40)) if (map[q.id]) map[q.id] = { x: q.x, y: q.y, w: q.w, h: q.h };
    const base = place(items(...ids), map, 40);
    const pick = ids.filter(() => rnd(3) === 0).slice(0, 2);
    const pins = (pick.length ? pick : ['a']).map((id) => ({ id, x: rnd(36), y: rnd(14), w: 1 + rnd(8), h: 1 + rnd(3) }));
    const before = JSON.parse(JSON.stringify(map));
    commitPin(map, items(...ids), 40, pins);
    const after = place(items(...ids), map, 40);
    for (const q of base) {
      if (pins.some((x) => x.id === q.id)) continue;
      const r = after.find((x) => x.id === q.id);
      if (r.x !== q.x || r.y !== q.y || r.w !== q.w || r.h !== q.h || (before[q.id] && JSON.stringify(map[q.id]) !== JSON.stringify(before[q.id]))) moved++;
    }
    for (const q of after) for (const r of after) if (q !== r && q.x < r.x + r.w && r.x < q.x + q.w && q.y < r.y + r.h && r.y < q.y + q.h) overlapped++;
  }
  ok('300 random commits: no sibling ever moves, drawn or stored', moved === 0, moved);
  ok('300 random commits: nothing overlaps', overlapped === 0, overlapped);
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
  ok('an absent id is never visited by placement', !place(items('a', 'b'), m, 40).some((p) => p.id === 'ghost'));
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
  const order = ids(place(items('a', 'b', 'c'), m, 48));
  ok('a seeded 12-span map keeps visual order', order === 'c,a,b', order);
  ok('two half spans share a row', m.a.y === m.b.y && m.a.x < m.b.x);
  ok('a full-span card migrates with no w, so it fills the row at DPR 2 (80 cells) too',
     !('w' in m.c) && place(items('a', 'b', 'c'), m, 80).find((p) => p.id === 'c').w === 80);
  ok('an id this catalog lacks migrates and stays inert', !!m.gone && !place(items('a', 'b', 'c'), m, 48).some((p) => p.id === 'gone'));
  ok('migration writes nothing by itself', st.writes.length === 0);

  const legacy = memStorage({ 'sd32.dash.machine': JSON.stringify({ x: { span: 12, order: 1 }, y: { span: 12, order: 0 } }) });
  const L = loadStore(legacy);
  const lo = ids(place(items('x', 'y'), L.layouts.Default['full.machine'], 48));
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

// ---- nests and modules (ph-e82.6) ----------------------------------------------
console.log('nests');
{
  ok('single fields are placeable anywhere by default (ph-e82.1 item 4, veto-able)', FIELDS_NESTS_ONLY === false
     && placeable('field', false) && placeable('field', true));
  ok('nests-only: a field is refused at the top level, welcome in a nest, other kinds unaffected',
     !placeable('field', false, true) && placeable('field', true, true) && placeable('composite', false, true) && placeable(undefined, false, true));
  ok('a nest never nests, either way', placeable('nest', false) && !placeable('nest', true) && !placeable('nest', true, true));
  ok('a safety op is top level only (law 11; ph-e82.15)', placeable('safety', false) && !placeable('safety', true) && placeable('safety', false, true));

  const st = memStorage();
  const s = loadStore(st);
  const top = viewMap(s, 'full', 'home');
  commitPin(top, items('a', 'b', 'c', 'd'), 40, { id: 'd', x: 0, y: 0, w: 10, h: 2 });
  const id = addNest(top, { title: 'Pump' });
  const first = place([...items('a', 'b', 'c', 'd'), { id }], top, 40).find((p) => p.id === id);
  ok('addNest makes an unplaced nest, drawn at the first free rect', isNest(top[id]) && top[id].y === undefined && id === 'nest:1'
     && first.x === 10 && first.y === 3, JSON.stringify(first));
  ok('a second nest gets its own id', addNest(top) === 'nest:2' && removeNest(top, 'nest:2') && !top['nest:2']);
  ok('members join unplaced', nestAdd(top, id, 'a') && nestAdd(top, id, 'b') && nestAdd(top, id, 'c') && top[id].nest.map.a === null);
  ok('a member cannot join twice, a nest cannot join a nest', !nestAdd(top, id, 'a') && !nestAdd(top, id, 'nest:9'));
  const n = top[id].nest.map;
  commitPin(n, items('a', 'b', 'c'), 12, { id: 'c', x: 0, y: 0, w: 12, h: 3 });
  ok('the subgrid places like any grid: the pin lands below the taken rows, the rest fixed where drawn',
     n.c.y === 2 && n.c.h === 3 && n.a.y === 0 && n.b.y === 1, JSON.stringify(n));
  const topItems = [...items('d'), { id, title: 'Pump' }];
  commitPin(top, topItems, 40, { id, x: 0, y: 0, w: 20, h: 6 });
  ok('moving the nest keeps its contents', isNest(top[id]) && top[id].w === 20 && top[id].nest.map.c.h === 3);
  commitOrder(top, topItems, 40, ['d', id]);
  ok('reordering keeps its contents', isNest(top[id]) && top[id].nest.map.c.h === 3);
  ok('nestsIn lists members, present or not',
     JSON.stringify(nestsIn(top)) === JSON.stringify([{ id, title: 'Pump', keys: ['a', 'b', 'c'] }]));
  ok('setNest renames', setNest(top, id, { title: ' Pump 2 ' }) && nestsIn(top)[0].title === 'Pump 2' && setNest(top, id, { title: 'Pump' }));
  top[id].nest.scroll = true;
  top[id].nest.collapsed = true;
  ok('a stored scroll or fold from an older build is inert', JSON.stringify(nestsIn(top)[0]) === JSON.stringify({ id, title: 'Pump', keys: ['a', 'b', 'c'] })
     && place([{ id }], top, 40)[0].h === top[id].h);
  delete top[id].nest.scroll;
  delete top[id].nest.collapsed;

  // Serialize, deserialize: the module and the nest both survive a reload.
  ok('save as module', saveModule(s, top, id, 'Pump'));
  ok('a taken or empty module name is refused', !saveModule(s, top, id, 'Pump') && !saveModule(s, top, id, ' ') && !saveModule(s, top, 'nest:9', 'X'));
  saveStore(st, s);
  const back = loadStore(st);
  const mod = back.modules.Pump;
  ok('the module round-trips', !!mod && !('scroll' in mod) && mod.w === 20 && mod.h === 6
     && JSON.stringify(mod.members) === JSON.stringify(n), JSON.stringify(mod));
  ok('the nest round-trips in its layout', JSON.stringify(back.layouts.Default['full.home'][id]) === JSON.stringify(top[id]));
  n.c.h = 4;
  ok('the module is a copy, not the live nest', s.modules.Pump.members.c.h === 3);

  // Reinsert under a different catalog: b is absent, x is new.
  const other = viewMap(back, 'handheld', 'cat9');
  const nid = insertModule(back, other, 'Pump');
  const sub = other[nid].nest.map;
  const present = items('a', 'c', 'x').filter((it) => own(sub, it.id));
  ok('reinsertion keeps the inert member', nestsIn(other)[0].keys.join() === 'a,b,c' && JSON.stringify(sub.b) === JSON.stringify(mod.members.b));
  ok('the inert member is never placed, never an error', ids(place(present, sub, 12)) === 'a,c', ids(place(present, sub, 12)));
  commitPin(sub, present, 12, { id: 'a', x: 0, y: 0, w: 6, h: 1 });
  ok('a commit under the other catalog leaves the inert member untouched', JSON.stringify(sub.b) === JSON.stringify(mod.members.b) && sub.a.w === 6);
  ok('an unknown module inserts nothing', insertModule(back, other, 'Nope') === null && nestsIn(other).length === 1);
  ok('the reinserted nest saves again with its inert member', saveModule(back, other, nid, 'Pump B') && own(back.modules['Pump B'].members, 'b'));
  saveStore(st, back);
  const again = loadStore(st);
  ok('and survives another round trip', JSON.stringify(again.modules['Pump B'].members.b) === JSON.stringify(mod.members.b)
     && nestsIn(again.layouts.Default['handheld.cat9'])[0].keys.join() === 'a,b,c');

  // Reset forgets arrangement, never content; ungroup frees present members.
  const r = again.layouts.Default['full.home'];
  resetMap(r);
  ok('reset keeps the nest, its size and members', isNest(r[id]) && r[id].w === 20 && r[id].x === undefined && !r.d && nestsIn(r)[0].keys.length === 3);
  ok('a reset nest is placed again at its own size', JSON.stringify(place([{ id }], r, 40).map((p) => [p.w, p.h])) === '[[20,6]]');
  resetMap(r[id].nest.map, true);
  ok('a nest reset keeps every member, unplaced', Object.keys(r[id].nest.map).length === 3 && Object.values(r[id].nest.map).every((v) => v === null));
  ok('nestRemove drops one member', nestRemove(r, id, 'b') && !own(r[id].nest.map, 'b') && !nestRemove(r, id, 'b'));
  ok('ungroup removes the nest', removeNest(r, id) && !r[id] && !removeNest(r, id));
  ok('delete module', deleteModule(again, 'Pump') && !again.modules.Pump && !deleteModule(again, 'Pump'));
  // A key deleted from a $state proxy still answers hasOwnProperty, reading undefined.
  const ghost = { active: 'A', layouts: { A: {}, B: undefined }, modules: { M: undefined } };
  const gm = { 'nest:1': undefined, 'nest:2': { x: 0, y: 0, w: 4, h: 4, nest: { title: 'N', scroll: true, map: { a: undefined } } } };
  ok('a proxy-deleted key reads as absent', !switchLayout(ghost, 'B') && saveLayoutAs(ghost, 'B') && deleteModule(ghost, 'M') === false
     && addNest(gm) === 'nest:1' && nestAdd(gm, 'nest:2', 'a') && gm['nest:2'].nest.map.a === null);
  ok('a store without modules loads with an empty set',
     JSON.stringify(loadStore(memStorage({ [STORE_KEY]: JSON.stringify({ active: 'A', layouts: { A: {} } }) })).modules) === '{}');
}

// ---- a placement's look (DESIGN §10.2; operator ruling 2026-10-01) ----------
{
  // An entry saved before `look` existed is still valid: derived presentation, catalog bounds.
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const map = { a: { x: 0, y: 0, w: 8, h: 2 }, b: { x: 8, y: 0, w: 8, h: 2 } };
  const p0 = place(items, map, 48);
  ok('look: an entry without one packs as before, with no look on the item', p0.every((p) => !('look' in p))
     && JSON.stringify(p0.map(({ id, x, y, w, h }) => [id, x, y, w, h])) === '[["a",0,0,8,2],["b",8,0,8,2],["c",0,2,48,1]]');
  const look = { pres: 'knob', min: 10, max: 40, step: 2, default: 20 };
  setLook(map, 'a', look);
  ok('look: setLook keeps the place and stores a copy', map.a.x === 0 && map.a.w === 8 && JSON.stringify(map.a.look) === JSON.stringify(look) && map.a.look !== look);
  ok('look: place hands it to the placed item', place(items, map, 48).find((p) => p.id === 'a').look.pres === 'knob');
  const c = place(items, map, 48).find((p) => p.id === 'c');
  setLook(map, 'c', { pres: 'toggle', a: 0, b: 5 }, c);
  ok('look: an unsaved item is written where it is drawn, so it does not move',
     map.c.x === c.x && map.c.y === c.y && map.c.w === c.w && map.c.look.b === 5);
  commitPin(map, items, 48, { id: 'b', x: 20, y: 0, w: 6, h: 2 });
  commitOrder(map, items, 48, ['c', 'a', 'b']);
  ok('look: survives a drag and a reorder', map.a.look.min === 10 && map.c.look.b === 5 && !map.b.look);
  ok('look: the pinned item keeps its look mid-drag',
     place(items, map, 48, { id: 'a', x: 30, y: 4, w: 8, h: 2 }).find((p) => p.id === 'a').look.max === 40);
  setLook(map, 'a', null);
  setLook(map, 'c', {});
  ok('look: null or {} clears it, the place stays', !('look' in map.a) && !('look' in map.c) && Number.isFinite(map.a.x));

  const st = memStorage();
  const store = loadStore(st);
  setLook(viewMap(store, 'full', 'machine'), 'uid:9:x', { pres: 'bar', min: 1 }, { x: 0, y: 0, w: 4, h: 1 });
  saveStore(st, store);
  ok('look: survives a store round trip', loadStore(st).layouts.Default['full.machine']['uid:9:x'].look.min === 1);
  const n = {};
  const nid = addNest(n);
  nestAdd(n, nid, 'k');
  setLook(n[nid].nest.map, 'k', { pres: 'numeral' }, { x: 0, y: 0, w: 3, h: 3 });
  commitPin(n, [{ id: nid }], 48, { id: nid, x: 0, y: 2, w: 16, h: 6 });
  ok('look: a nest member keeps its own look in the nest map when the nest moves', n[nid].nest.map.k.look.pres === 'numeral');
}

// ---- resize from every edge (ph-e82.20.1) -------------------------------------
console.log('resize');
{
  const s = { x: 10, y: 4, w: 8, h: 4 };
  const r = (edge, c, min) => { const o = resizeRect(s, edge, c, 40, min); return [o.x, o.y, o.w, o.h, o.refused].join(','); };
  ok('east and south move only their own edge', r('e', { x: 21, y: 0 }) === '10,4,12,4,false' && r('s', { x: 0, y: 9 }) === '10,4,8,6,false');
  ok('west keeps the right edge', r('w', { x: 6, y: 0 }) === '6,4,12,4,false' && r('w', { x: 14, y: 0 }) === '14,4,4,4,false');
  ok('north keeps the bottom edge', r('n', { x: 0, y: 2 }) === '10,2,8,6,false' && r('n', { x: 0, y: 6 }) === '10,6,8,2,false');
  ok('a corner moves both of its edges', r('nw', { x: 8, y: 3 }) === '8,3,10,5,false' && r('se', { x: 19, y: 9 }) === '10,4,10,6,false');
  ok('past the floor: clamped at the floor, refused, the anchored edge holds',
     r('w', { x: 30, y: 0 }) === [18 - RESIZE_FLOOR[0], 4, RESIZE_FLOOR[0], 4, true].join(',')
     && r('n', { x: 0, y: 30 }) === [10, 8 - RESIZE_FLOOR[1], 8, RESIZE_FLOOR[1], true].join(','));
  ok('exactly at the floor is not a refusal', r('e', { x: 10 + RESIZE_FLOOR[0] - 1, y: 0 }).endsWith(',false'));
  ok('west stops at the grid edge, east at the last column', r('w', { x: -5, y: 0 }) === '0,4,18,4,false' && r('e', { x: 99, y: 0 }) === '10,4,30,4,false');
  // A slider's floor depends on orientation: [6, 2] wide, [2, 6] tall.
  const slider = (w, h) => minCells('slider', orientationOf(w, h));
  ok('an edge drag stops at the nearest legal size of its own dimension', r('e', { x: 12, y: 0 }, slider) === '10,4,6,4,true',
     r('e', { x: 12, y: 0 }, slider));
  ok('a corner drag may flip the orientation, under the new floor', r('se', { x: 11, y: 9 }, slider) === '10,4,2,6,false'
     && r('se', { x: 11, y: 8 }, slider) === '10,4,2,6,true', r('se', { x: 11, y: 8 }, slider));
  ok('a flip is visible in the result', orientationOf(8, 4) === 'h' && orientationOf(2, 6) === 'v');
  ok('the keyboard step is a south-east resize', JSON.stringify(resizeRect(s, 'se', { x: 18, y: 7 }, 40)) === '{"x":10,"y":4,"w":9,"h":4,"refused":false}');
}

// ---- drag preview and drag-out (ph-e82.20.2) ------------------------------------
console.log('drag');
{
  const its = items('a', 'b', 'c');
  const map = { a: { x: 0, y: 0, w: 10, h: 2 }, b: { x: 0, y: 2, w: 10, h: 2, look: { pres: 'knob' } }, c: { x: 10, y: 0, w: 6, h: 1 } };
  const pin = { id: 'a', x: 20, y: 5, w: 10, h: 2 };
  const pre = place(its, map, 40, pin);
  const m2 = JSON.parse(JSON.stringify(map));
  commitPin(m2, its, 40, pin);
  ok('the preview is exactly what the commit writes', pre.every((p) => p.x === m2[p.id].x && p.y === m2[p.id].y && p.w === m2[p.id].w && p.h === m2[p.id].h),
     JSON.stringify(pre.map(({ id, x, y, w, h }) => [id, x, y, w, h])));
  ok('the preview moves the dragged card only: it lands where dropped, the siblings keep their rects',
     pre.find((p) => p.id === 'a').y === 5 && pre.find((p) => p.id === 'a').x === 20 && pre.find((p) => p.id === 'b').y === 2
     && pre.find((p) => p.id === 'c').x === 10, JSON.stringify(pre.map(({ id, x, y }) => [id, x, y])));
  ok('the preview keeps looks', pre.find((p) => p.id === 'b').look.pres === 'knob');
  ok('the preview writes nothing', JSON.stringify(map.a) === '{"x":0,"y":0,"w":10,"h":2}');

  const top = { k: { x: 3, y: 9, w: 5, h: 2 } };
  const nid = addNest(top);
  nestAdd(top, nid, 'm');
  nestAdd(top, nid, 'k');
  top[nid].nest.map.m = { x: 0, y: 0, w: 4, h: 3, look: { pres: 'bar' } };
  top[nid].nest.map.k = { x: 4, y: 0, w: 4, h: 1, look: { pres: 'numeral' } };
  ok('nestOut: a member with no top-level entry flows unplaced at its size, look kept',
     nestOut(top, nid, 'm') && JSON.stringify(top.m) === '{"w":4,"h":3,"look":{"pres":"bar"}}' && !own(top[nid].nest.map, 'm'));
  ok('nestOut: a top-level entry keeps its place and takes the member look',
     nestOut(top, nid, 'k') && top.k.x === 3 && top.k.y === 9 && top.k.look.pres === 'numeral');
  ok('nestOut: a non-member is refused', !nestOut(top, nid, 'm') && !nestOut(top, 'nest:9', 'k'));
  ok('nestOut: an unplaced member leaves an unplaced entry', nestAdd(top, nid, 'q') && nestOut(top, nid, 'q') && JSON.stringify(top.q) === '{}'
     && place(items('q'), top, 40)[0].w === 40);
}

// ---- selection: group pins, align, duplicate (ph-e82.20.3) ----------------------
console.log('selection');
{
  const its = items('a', 'b', 'c', 'd');
  const map = { a: { x: 0, y: 0, w: 4, h: 2 }, b: { x: 6, y: 0, w: 4, h: 2 }, c: { x: 0, y: 2, w: 10, h: 1 }, d: { x: 20, y: 0, w: 4, h: 1 } };
  const group = [{ id: 'a', x: 12, y: 0, w: 4, h: 2 }, { id: 'b', x: 18, y: 0, w: 4, h: 2 }];
  const g = place(its, map, 40, group);
  const at = (id) => g.find((p) => p.id === id);
  ok('a group pins every member where asked; one landing on d moves down', at('a').x === 12 && at('a').y === 0 && at('b').x === 18 && at('b').y === 1,
     JSON.stringify(g.map(({ id, x, y }) => [id, x, y])));
  ok('the rest never yields: d and c keep their rects', at('d').x === 20 && at('d').y === 0 && at('c').y === 2);
  const clash = place(its, map, 40, [{ id: 'a', x: 0, y: 0, w: 4, h: 2 }, { id: 'b', x: 0, y: 0, w: 4, h: 2 }]);
  const cb = clash.find((p) => p.id === 'b');
  ok('a pin that lands on an earlier pin moves down, never overlaps', cb.y === 3 && !clash.some((q) => q !== cb
     && q.x < cb.x + cb.w && cb.x < q.x + q.w && q.y < cb.y + cb.h && cb.y < q.y + q.h), cb);
  const m2 = JSON.parse(JSON.stringify(map));
  commitPin(m2, its, 40, group);
  ok('a group commit writes the group and nothing else', m2.a.x === 12 && m2.b.x === 18 && JSON.stringify(m2.d) === JSON.stringify(map.d)
     && JSON.stringify(m2.c) === JSON.stringify(map.c));

  const sel = [{ id: 'a', x: 2, y: 1, w: 4, h: 2 }, { id: 'b', x: 9, y: 3, w: 2, h: 2 }, { id: 'c', x: 20, y: 0, w: 6, h: 1 }];
  ok('align left takes the smallest x', arrangePins(sel, 'left').every((p) => p.x === 2));
  ok('align top takes the smallest y', arrangePins(sel, 'top').every((p) => p.y === 0));
  const sp = arrangePins(sel, 'spread');
  ok('spread keeps the outer two and spaces the middle evenly', sp[0].x === 2 && sp[2].x === 20 && sp[1].x === 12,
     JSON.stringify(sp.map((p) => p.x)));
  ok('spread of two changes nothing', JSON.stringify(arrangePins(sel.slice(0, 2), 'spread').map((p) => p.x)) === '[2,9]');

  ok('instance keys count up from 2 and skip taken ones', instanceKey(new Set(), 'role:x') === 'role:x#2'
     && instanceKey(new Set(['uid:1:y#2']), 'uid:1:y') === 'uid:1:y#3');
  ok('baseKey strips an instance suffix only', baseKey('uid:1:y#3') === 'uid:1:y' && baseKey('role:a.b') === 'role:a.b' && baseKey('nest:2') === 'nest:2');
  const dm = { a: { x: 3, y: 4, w: 5, h: 2, look: { pres: 'knob' } } };
  ok('duplicate copies size and look, unplaced', duplicate(dm, 'a', 'a#2') === 'a#2' && JSON.stringify(dm['a#2']) === '{"w":5,"h":2,"look":{"pres":"knob"}}');
  ok('duplicate refuses a taken id or a missing entry', duplicate(dm, 'a', 'a#2') === null && duplicate(dm, 'zz', 'q') === null);
  dm['a#2'].look.pres = 'bar';
  ok('the copy is independent', dm.a.look.pres === 'knob');
  const nid = addNest(dm, { title: 'Pump', members: { a: { x: 0, y: 0, w: 4, h: 1, look: { pres: 'numeral' } } } });
  const cid = duplicate(dm, nid);
  ok('a nest duplicates whole under the next nest id, titled as a copy', cid === 'nest:2' && isNest(dm[cid]) && dm[cid].nest.title === 'Pump copy'
     && dm[cid].nest.map.a.look.pres === 'numeral' && dm[cid].w === dm[nid].w && dm[cid].x === undefined);
  ok('a plain entry needs an explicit id', duplicate(dm, 'a') === null);
}

// ---- keyboard nudge (ph-e82.20.5) ---------------------------------------------------
console.log('nudge');
{
  const its = items('a', 'b', 'c');
  const map = { a: { x: 0, y: 0, w: 10, h: 2 }, b: { x: 0, y: 4, w: 10, h: 1 }, c: { x: 20, y: 0, w: 6, h: 1 } };
  const step = (id, dx, dy) => { const p = nudgePin(place(its, map, 40), id, dx, dy, 40); if (p) commitPin(map, its, 40, p); return !!p; };
  ok('up is one cell into free space', step('b', 0, -1) && map.b.y === 3 && step('b', 0, -1) && map.b.y === 2 && map.a.y === 0, JSON.stringify(map));
  ok('up with only taken cells above goes nowhere and moves nothing', !step('b', 0, -1) && map.b.y === 2 && map.a.y === 0);
  map.a = { x: 0, y: 3, w: 10, h: 2 };
  ok('down passes the card below to the first free rect; that card stays', step('b', 0, 1) && map.b.y === 5 && map.a.y === 3, JSON.stringify(map));
  ok('a card at the top has nowhere to go up', !step('c', 0, -1));
  ok('sideways is one cell, clamped at the edges', step('c', 1, 0) && map.c.x === 21 && !nudgePin(place(its, { ...map, c: { x: 34, y: 0, w: 6, h: 1 } }, 40), 'c', 1, 0, 40)
     && !nudgePin(place(its, map, 40), 'b', -1, 0, 40));
  ok('an unknown id gives no pin', nudgePin(place(its, map, 40), 'zz', 1, 0, 40) === null);
}

// ---- layout export and import (ph-e82.20.6) -------------------------------------------
console.log('export');
{
  const s = loadStore(memStorage());
  viewMap(s, 'full', 'machine').a = { x: 1, y: 0, w: 4, h: 1, look: { pres: 'knob' } };
  addNest(viewMap(s, 'full', 'machine'), { title: 'Pump', members: { b: null } });
  const text = exportLayout(s);
  const b = JSON.parse(text);
  ok('export is the prefs-backup shape with the layout name and its views', b.app === 'phosphor' && b.layout === 'Default'
     && b.views['full.machine'].a.look.pres === 'knob' && isNest(b.views['full.machine']['nest:1']));
  ok('import never overwrites: a taken name gets a number', importLayout(s, text) === 'Default 2' && importLayout(s, text) === 'Default 3');
  ok('the import is a copy', JSON.stringify(s.layouts['Default 2']) === JSON.stringify(s.layouts.Default) && s.layouts['Default 2'] !== s.layouts.Default);
  ok('import does not switch by itself', s.active === 'Default');
  const bad = (t) => { try { importLayout(s, t); return null; } catch (e) { return e.message; } };
  ok('garbage, a foreign app and a views array are refused by name', bad('{') === 'not JSON' && bad('{"app":"x","views":{}}') === 'not a Phosphor layout'
     && bad('{"app":"phosphor","views":[]}') === 'not a Phosphor layout');
  ok('a nameless layout imports as Imported; junk views are dropped',
     importLayout(s, '{"app":"phosphor","views":{"full.x":{"q":{"x":0,"y":0,"w":2,"h":1}},"nodot":{},"full.y":7}}') === 'Imported'
     && JSON.stringify(Object.keys(s.layouts.Imported)) === '["full.x"]');
  ok('a prototype name is not a name', importLayout(s, '{"app":"phosphor","layout":"__proto__","views":{}}') === 'Imported 2');
}

// ---- density per layout (ph-e82.20.7) ---------------------------------------------------
console.log('density');
{
  const st = memStorage();
  const s = loadStore(st);
  viewMap(s, 'full', 'machine').a = { x: 0, y: 0, w: 4, h: 1 };
  ok('a layout is comfortable by default', layoutOpts(s).density === DENSITY[0] && DENSITY.includes('compact'));
  ok('setDensity stores compact on the active layout', setDensity(s, 'compact') && layoutOpts(s).density === 'compact' && s.layouts.Default.opts.density === 'compact');
  ok('an unknown density is refused', !setDensity(s, 'tiny') && layoutOpts(s).density === 'compact');
  ok('the option is no view: placement never sees it', JSON.stringify(Object.keys(viewMap(s, 'full', 'machine'))) === '["a"]'
     && place(items('a'), viewMap(s, 'full', 'machine'), 40).length === 1);
  saveLayoutAs(s, 'Copy');
  ok('save as carries it', layoutOpts(s, 'Copy').density === 'compact');
  ok('comfortable is stored as no option at all', setDensity(s, 'comfortable') && !('opts' in s.layouts.Copy) && layoutOpts(s, 'Default').density === 'compact');
  ok('export and import carry it', layoutOpts(s, importLayout(s, exportLayout(s, 'Default'))).density === 'compact');
  saveStore(st, s);
  ok('it survives a reload', layoutOpts(loadStore(st), 'Default').density === 'compact');
  ok('a corrupt option reads as the default', layoutOpts({ active: 'X', layouts: { X: { opts: { density: 9 } } } }).density === DENSITY[0]);
}

// ---- the content floor (ph-e82.25) -------------------------------------------------------
console.log('floor');
{
  ok('measured px round UP to whole cells', cellsFor(200, 36) === 6 && cellsFor(216, 36) === 6 && cellsFor(216.5, 36) === 7);
  ok('a float error at an exact multiple does not cost a cell', cellsFor(36 * 3 + 1e-9, 36) === 3);
  ok('no measurement is no floor', cellsFor(0, 36) === 0 && cellsFor(undefined, 36) === 0);
  ok('the floor is the larger of static and measured, per dimension',
     JSON.stringify(floorOf([6, 2], [9, 1])) === '[9,2]' && JSON.stringify(floorOf([6, 2], [])) === '[6,2]'
     && JSON.stringify(floorOf(RESIZE_FLOOR, [1, 4])) === '[2,4]');
  const at = (rects) => rects.map(([id, x, y, w, h]) => ({ id, x, y, w, h }));
  ok('grows east into free cells', JSON.stringify(growWidth(at([['a', 0, 0, 1, 8]]), 'a', 6, 40)) === '{"id":"a","x":0,"y":0,"w":6,"h":8}');
  ok('stops at an east neighbor, then grows west',
     JSON.stringify(growWidth(at([['a', 10, 0, 1, 2], ['b', 13, 1, 4, 1]]), 'a', 6, 40)) === '{"id":"a","x":7,"y":0,"w":6,"h":2}');
  ok('a neighbor in any of its rows stops it', JSON.stringify(growWidth(at([['a', 10, 0, 1, 4], ['b', 12, 3, 4, 1], ['c', 7, 2, 2, 1]]), 'a', 6, 40))
     === '{"id":"a","x":9,"y":0,"w":3,"h":4}');
  ok('the grid edge stops it', JSON.stringify(growWidth(at([['a', 38, 0, 1, 1], ['b', 30, 0, 7, 1]]), 'a', 6, 40)) === '{"id":"a","x":37,"y":0,"w":3,"h":1}');
  const wedged = at([['l', 0, 0, 10, 2], ['a', 10, 0, 1, 2], ['r', 11, 0, 9, 2]]);
  ok('no room: null, nothing moves', growWidth(wedged, 'a', 6, 40) === null
     && JSON.stringify(wedged) === JSON.stringify(at([['l', 0, 0, 10, 2], ['a', 10, 0, 1, 2], ['r', 11, 0, 9, 2]])));
  ok('wide enough or unknown: null', growWidth(at([['a', 0, 0, 6, 1]]), 'a', 6, 40) === null && growWidth([], 'a', 6, 40) === null);
  const map = { a: { x: 10, y: 0, w: 1, h: 2 }, b: { x: 13, y: 1, w: 4, h: 1 } };
  const items = [{ id: 'a' }, { id: 'b' }];
  commitPin(map, items, 40, growWidth(place(items, map, 40), 'a', 6, 40));
  ok('a grow commits like a resize: the neighbor keeps its rect', JSON.stringify(map) === '{"a":{"x":7,"y":0,"w":6,"h":2},"b":{"x":13,"y":1,"w":4,"h":1}}', JSON.stringify(map));

  // Rows are cells (ph-29r): the height floor grows a card the same way.
  ok('grows south into free cells', JSON.stringify(growHeight(at([['a', 0, 0, 8, 3]]), 'a', 5)) === '{"id":"a","x":0,"y":0,"w":8,"h":5}');
  ok('stops at a south neighbor, then grows north',
     JSON.stringify(growHeight(at([['a', 0, 4, 8, 3], ['b', 2, 8, 4, 2]]), 'a', 6)) === '{"id":"a","x":0,"y":2,"w":8,"h":6}');
  ok('a neighbor under any of its columns stops it', growHeight(at([['a', 0, 0, 8, 3], ['b', 7, 3, 4, 2]]), 'a', 5) === null);
  ok('no room: null, nothing moves; tall enough: null', growHeight(at([['t', 0, 0, 8, 2], ['a', 0, 2, 8, 3], ['u', 0, 5, 8, 2]]), 'a', 5) === null
     && growHeight(at([['a', 0, 0, 8, 5]]), 'a', 5) === null);
  const fit = (it, w) => ({ a: 4, b: null }[it.id] ?? null) && (w === 40 ? 4 : 9);
  const packed = pack([{ id: 'a' }, { id: 'b' }], {}, 40, [], fit);
  ok('an unplaced item is packed at its measured height; an unmeasured one at the default',
     JSON.stringify(packed.map((p) => [p.id, p.y, p.h])) === '[["a",0,4],["b",4,1]]', JSON.stringify(packed));
  ok('a module hundreds of rows tall is drawn whole (12 px cells at 2x)', pack([{ id: 'a' }], {}, 40, [], () => 400)[0].h === 400);
  ok('a stored height above the measured one stands', pack([{ id: 'a' }], { a: { h: 6 } }, 40, [], fit)[0].h === 6);
  ok('the fit sees the entry\'s look', pack([{ id: 'a' }], { a: { look: { pres: 'knob' } } }, 40, [],
     (it) => (it.look && it.look.pres === 'knob' ? 7 : 1))[0].h === 7);
  const held = { a: { x: 0, y: 0, w: 8, h: 3 } };
  const ids = commitPin(held, [{ id: 'a' }, { id: 'n' }, { id: 'm' }], 40, null, (it) => (it.id === 'm' ? 2 : it.id === 'a' ? 3 : null));
  ok('a commit holds an add never measured (entered, no rect), writes a measured one', JSON.stringify(ids) === '["n"]' && JSON.stringify(held.n) === '{}'
     && JSON.stringify(held.m) === '{"x":0,"y":4,"w":40,"h":2}' && JSON.stringify(held.a) === '{"x":0,"y":0,"w":8,"h":3}', JSON.stringify(held));
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- grid model holds.'));
process.exit(fails ? 1 : 0);
