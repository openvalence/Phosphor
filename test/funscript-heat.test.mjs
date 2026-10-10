/**
 * funscript-heat.test.mjs -- the library's script heat cache (heat.js) under node, against the fake Stash.
 *
 * Page load fills the cache for scripted scenes only; a reload with the same change markers asks nothing; a changed
 * marker asks that one scene; a playing video holds the prefetch; a hover revalidates once per session (ETag or
 * Last-Modified, else the CRC32); the store ages out at 30 days and caps at its size; another server empties it.
 * The DOM side (the strip on a tile, IndexedDB across a reload, a theme switch) is section (L2) of
 * funscript-player.test.mjs.
 */
import { createStash } from '../plugins/factory/funscript-player/stash.js';
import { createHeat, memStore, crc32, heatBuckets, heatCss, DAY_MS, BUCKETS } from '../plugins/factory/funscript-player/heat.js';
import { parseFunscript } from '../plugins/factory/funscript-player/funscript.js';
import { startFakeStash, fakeScript } from './fixtures/fake-stash.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (!cond && extra ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'k';

console.log('(a) pure');
ok('crc32 of "123456789" is CBF43926', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
const script = parseFunscript(JSON.stringify(fakeScript('2', 20000)), 't');
const ups = heatBuckets(script);
ok('heatBuckets: BUCKETS speeds, the stroke speed throughout', ups.length === BUCKETS && ups.every((u) => u === ups[1]) && ups[1] > 0, ups.slice(0, 4));
const css = heatCss([0, 0, 50, 50, 400]);
ok('heatCss: hard-edged runs in tokens, neighbors merged, no literal color', /^linear-gradient\(90deg, /.test(css) && (css.match(/[0-9.]+% [0-9.]+%/g) || []).length === 3
  && /var\(--bg-sunken\)/.test(css) && /var\(--highlight\)/.test(css) && !/#[0-9a-f]{3}|rgb\(/i.test(css), css);

console.log('(b) the cache against the fake');
const fake = await startFakeStash({ key: KEY, scenes: 30 });
const funscriptReqs = (from = 0) => fake.seen.slice(from).filter((r) => /\/funscript$/.test(r.path.split('?')[0]));
const mark = () => fake.seen.length;
const client = (o = {}) => createStash({ fetch: o.fetch || globalThis.fetch, base: fake.url, key: KEY });
const scenesOf = async (st, o = {}) => (await st.scenes({ perPage: 12, ...o })).scenes;
const mk = (st, o = {}) => createHeat(st, { hoverMs: 15, now: () => clock, ...o });
let clock = Date.UTC(2026, 9, 10);
const store = memStore();

// First load: page 1 of scripted scenes (ids 1..9, 11..13 by date order is the fake's; any 12 scripted).
let st = client(), page = await scenesOf(st);
const got = new Map();
let h = mk(st, { store });
h.onStrip = (id, u) => got.set(id, u);
let m0 = mark();
h.prime(page);
await h.whenIdle();
let reqs = funscriptReqs(m0);
ok('a page load fetches each scripted scene once and fills the cache', reqs.length === page.length && got.size === page.length
  && (await store.count()) === page.length, { reqs: reqs.length, got: got.size, n: page.length });
const all = await scenesOf(st, { scripted: false, perPage: 30 });
const unscripted = all.filter((s) => !s.funscript);
m0 = mark();
h.prime(all);
await h.whenIdle();
ok('unscripted scenes are never asked and never stored', unscripted.length > 0 && funscriptReqs(m0).every((r) => !unscripted.some((s) => r.path.includes('/scene/' + s.id + '/')))
  && (await Promise.all(unscripted.map((s) => store.get(s.id)))).every((r) => !r), unscripted.map((s) => s.id));
ok('no request ever names Stash\'s own heatmap', fake.seen.every((r) => !/heatmap/.test(r.path + r.body)));

// Reload: a new client and heat over the same store, same markers.
st = client(); page = await scenesOf(st);
h = mk(st, { store });
m0 = mark();
h.prime(page);
await h.whenIdle();
ok('a reload with the same markers makes zero funscript requests, and the strips are known', funscriptReqs(m0).length === 0 && page.every((s) => h.strip(s.id)));

// A changed marker, an unchanged file: one conditional request, a 304, the strip kept.
const target = page[2], other = page[3];
fake.scenes.find((s) => s.id === target.id).updated_at = '2026-10-09T00:00:00.000Z';
st = client(); page = await scenesOf(st);
h = mk(st, { store });
const before = (await store.get(target.id)).ups;
m0 = mark();
h.prime(page);
await h.whenIdle();
reqs = funscriptReqs(m0);
ok('a changed updated_at asks that one scene, with its Last-Modified', reqs.length === 1 && reqs[0].path.includes('/scene/' + target.id + '/')
  && !!reqs[0].headers['if-modified-since'], reqs.map((r) => r.path));
const rec = await store.get(target.id);
ok('the 304 keeps the strip and takes the new marker', rec.ups === before || JSON.stringify(rec.ups) === JSON.stringify(before)
  && rec.marker === page.find((s) => s.id === target.id).marker, rec.marker);

// A changed marker and a changed script: the strip is replaced.
const ts = fake.scenes.find((s) => s.id === other.id);
ts.updated_at = '2026-10-09T01:00:00.000Z'; ts.rev = 1;
st = client(); page = await scenesOf(st);
h = mk(st, { store });
m0 = mark();
h.prime(page);
await h.whenIdle();
const rec2 = await store.get(other.id);
ok('a changed marker and script: one 200, a different strip stored', funscriptReqs(m0).length === 1 && JSON.stringify(rec2.ups) !== JSON.stringify(before)
  && rec2.lm !== (await store.get(target.id)).lm, funscriptReqs(m0).length);

// Playback holds the prefetch.
let playing = true;
const store2 = memStore();
st = client(); page = await scenesOf(st);
h = mk(st, { store: store2 });
h.playing = () => playing;
m0 = mark();
h.prime(page);
await sleep(120);
ok('while a video plays nothing is fetched', funscriptReqs(m0).length === 0);
playing = false;
h.resume();
await h.whenIdle();
ok('when it stops the prefetch runs', funscriptReqs(m0).length === page.length);

// Concurrency.
let flight = 0, peak = 0;
const slow = async (u, i) => { flight++; peak = Math.max(peak, flight); await sleep(25); try { return await globalThis.fetch(u, i); } finally { flight--; } };
st = createStash({ fetch: slow, base: fake.url, key: KEY });
page = await scenesOf(st);
h = mk(st, { store: memStore() });
flight = 0; peak = 0;
h.prime(page);
await h.whenIdle();
ok('at most three requests at a time', peak > 1 && peak <= 3, peak);

console.log('(c) hover revalidation');
async function seeded(validators) {
  fake.state.validators = validators;
  for (const s of fake.scenes) { s.rev = 0; s.updated_at = new Date(Date.UTC(2026, 0, 1)).toISOString(); }
  const stx = client(), pg = await scenesOf(stx), sx = memStore(), hx = mk(stx, { store: sx });
  hx.onStrip = () => {};
  hx.prime(pg);
  await hx.whenIdle();
  // The next session: same store, a client and heat that have checked nothing yet.
  const st2 = client(), pg2 = await scenesOf(st2), h2 = mk(st2, { store: sx });
  h2.onStrip = () => {};
  return { st: st2, page: pg2, store: sx, heat: h2, scene: pg2[0] };
}
const dwell = async (hx, s, ms = 80) => { const leave = hx.hover(s); await sleep(ms); leave(); };

for (const [mode, header] of [['lm', 'if-modified-since'], ['etag', 'if-none-match']]) {
  const x = await seeded(mode);
  const first = await x.store.get(x.scene.id);
  ok(mode + ': the prefetch stored the validator', !!(mode === 'lm' ? first.lm : first.etag) && first.crc === null, first);
  let m = mark();
  await dwell(x.heat, x.scene);
  reqs = funscriptReqs(m);
  const kept = await x.store.get(x.scene.id);
  ok(mode + ': a hover sends ' + header + ' and a 304 keeps the entry', reqs.length === 1 && !!reqs[0].headers[header]
    && JSON.stringify(kept.ups) === JSON.stringify(first.ups) && kept.t >= first.t, reqs.map((r) => r.headers));
  m = mark();
  await dwell(x.heat, x.scene);
  ok(mode + ': a second hover in the session makes no request', funscriptReqs(m).length === 0);

  const y = await seeded(mode);
  const old = await y.store.get(y.scene.id);
  fake.scenes.find((s) => s.id === y.scene.id).rev = 1;      // the script changed; updated_at did not
  const seen = [];
  y.heat.onStrip = (id, u) => seen.push(id);
  m = mark();
  await dwell(y.heat, y.scene);
  const now2 = await y.store.get(y.scene.id);
  ok(mode + ': a changed validator is a 200 and replaces the strip', funscriptReqs(m).length === 1 && JSON.stringify(now2.ups) !== JSON.stringify(old.ups)
    && (mode === 'lm' ? now2.lm !== old.lm : now2.etag !== old.etag) && seen.includes(y.scene.id), now2);
}

{
  const x = await seeded('none');
  const first = await x.store.get(x.scene.id);
  ok('no validators: the prefetch stored the CRC32', typeof first.crc === 'number' && !first.etag && !first.lm, first);
  let m = mark();
  await dwell(x.heat, x.scene);
  reqs = funscriptReqs(m);
  const same = await x.store.get(x.scene.id);
  ok('no validators: a hover downloads, the same CRC keeps the entry', reqs.length === 1 && !reqs[0].headers['if-modified-since'] && !reqs[0].headers['if-none-match']
    && same.crc === first.crc && JSON.stringify(same.ups) === JSON.stringify(first.ups));

  const y = await seeded('none');
  const old = await y.store.get(y.scene.id);
  fake.scenes.find((s) => s.id === y.scene.id).rev = 1;
  m = mark();
  await dwell(y.heat, y.scene);
  const diff = await y.store.get(y.scene.id);
  ok('no validators: a different CRC replaces the strip', funscriptReqs(m).length === 1 && diff.crc !== old.crc && JSON.stringify(diff.ups) !== JSON.stringify(old.ups));
  m = mark();
  await dwell(y.heat, y.scene);
  ok('no validators: the second hover is free too', funscriptReqs(m).length === 0);
}

{
  fake.state.validators = 'lm';
  for (const s of fake.scenes) { s.rev = 0; }
  const stx = client(), pg = await scenesOf(stx), hx = mk(stx, { store: memStore() });
  let n = 0;
  hx.onStrip = () => { n++; };
  let m = mark();
  hx.hover(pg[0])();
  await sleep(80);
  ok('leaving before the delay fetches nothing', funscriptReqs(m).length === 0 && n === 0 && !hx.checked.has(pg[0].id));
  const unscr = (await scenesOf(stx, { scripted: false, perPage: 30 })).find((s) => !s.funscript);
  await dwell(hx, unscr);
  ok('a scene without a script does nothing', funscriptReqs(m).length === 0 && n === 0);
  await dwell(hx, pg[0]);
  ok('a hover on a scene with no entry fetches once and draws', funscriptReqs(m).length === 1 && n === 1 && !!hx.strip(pg[0].id));
  m = mark();
  await dwell(hx, pg[0]);
  ok('the second hover is cached', funscriptReqs(m).length === 0 && n === 1);

  // Left while the request is in progress: cancelled, nothing stored, a later hover may try again.
  const slowSt = createStash({ fetch: async (u, i) => { await sleep(150); return globalThis.fetch(u, i); }, base: fake.url, key: KEY });
  const sp = await scenesOf(slowSt), sx = memStore(), hy = mk(slowSt, { store: sx });
  const leave = hy.hover(sp[1]);
  await sleep(60);
  leave();
  await sleep(250);
  ok('leaving mid-request cancels it: nothing stored, the next hover may retry', !(await sx.get(sp[1].id)) && !hy.checked.has(sp[1].id) && !hy.strip(sp[1].id));
}

console.log('(d) lifespan and server');
{
  const owned = async () => { const m = memStore(); await m.put({ k: '::server', server: fake.url }); return m; };
  const s = await owned();
  const rec = (k, days) => ({ k, t: clock - days * DAY_MS, marker: 'm', ups: [1], etag: null, lm: null, crc: 1 });
  await s.put(rec('old', 31)); await s.put(rec('young', 29)); await s.put(rec('now', 0));
  const hx = mk(client(), { store: s });
  await hx.sweep();
  ok('a 31-day-old entry is evicted, a 29-day-old one kept', !(await s.get('old')) && !!(await s.get('young')) && !!(await s.get('now')));
  const s2 = await owned();
  for (let i = 0; i < 6; i++) await s2.put(rec('e' + i, i));
  await mk(client(), { store: s2, cap: 4 }).sweep();
  ok('beyond the cap the least recently seen go first', (await s2.count()) === 4 && !(await s2.get('e5')) && !(await s2.get('e4')) && !!(await s2.get('e0')));
  const s3 = memStore();
  const a = mk(client(), { store: s3 });
  await a.sweep();
  await s3.put(rec('x', 1));
  const other = await startFakeStash({ key: KEY, scenes: 3 });
  const hb = mk(createStash({ fetch: globalThis.fetch, base: other.url, key: KEY }), { store: s3 });
  await hb.sweep();
  ok('another Stash server empties the store', !(await s3.get('x')) && (await s3.get('::server')).server === other.url);
  const hc = mk(createStash({ fetch: globalThis.fetch, base: other.url, key: KEY }), { store: s3 });
  await s3.put(rec('y', 1));
  await hc.sweep();
  ok('the same server keeps it', !!(await s3.get('y')));
  await other.close();
}

await fake.close();
console.log(fails ? '\nFAIL -- ' + fails : '\nPASS');
process.exit(fails ? 1 : 0);
