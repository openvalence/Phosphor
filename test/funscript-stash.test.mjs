/**
 * funscript-stash.test.mjs -- the funscript player's Stash client (ph-smvd.3) under node.
 *
 * Unit: normalizeBase, rebase, withKey, toScene, SCENES_QUERY, library fitGrid and every COPY
 * string, then createStash against test/fixtures/fake-stash.mjs (node http on 127.0.0.1): the
 * request shape and header, the mapping, both caches, and every error in words.
 *
 * Live: `node test/funscript-stash.test.mjs --live <base> --key <key>` prints what assumptions
 * A1..A9 (stash.js) need from a real Stash and exits nonzero when one fails. It never runs in check.
 */
import {
  SCENES_QUERY, SORTS, COPY, normalizeBase, rebase, withKey, toScene, createStash,
} from '../plugins/factory/funscript-player/stash.js';
import { COPY as LIB_COPY, fitGrid } from '../plugins/factory/funscript-player/library.js';
import { startFakeStash } from './fixtures/fake-stash.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};
const rejects = async (p) => { try { await p; return ''; } catch (e) { return e.message; } };

const argv = process.argv.slice(2);
if (argv[0] === '--live') {
  const base = argv[1], key = argv[argv.indexOf('--key') + 1] || '';
  if (!base || argv.indexOf('--key') < 0) { console.log('usage: --live <base> --key <key>'); process.exit(2); }
  await live(normalizeBase(base), key);
  console.log(fails ? '\nFAIL -- ' + fails + ' assumption(s) do not hold' : '\nPASS -- every Stash assumption holds');
  process.exit(fails ? 1 : 0);
}

// ---- pure ---------------------------------------------------------------------------------
console.log('(a) URLs');
ok('normalizeBase table', [
  ['http://host:9999', 'http://host:9999'], ['host:9999/', 'http://host:9999'], ['  https://h/stash//  ', 'https://h/stash'],
  ['http://h:9999/graphql', 'http://h:9999'], ['HTTP://H.local:9999/?x=1#y', 'http://h.local:9999'], ['', ''], ['ftp://h', ''],
  ['http://', ''], [null, ''],
].every(([i, o]) => normalizeBase(i) === o), [['host:9999/'], ['ftp://h']].map(([i]) => normalizeBase(i)).join(' | '));
ok('rebase carries the path and query onto the base origin',
  rebase('http://stash.internal:9999/scene/4/stream?x=1', 'https://me.example:8443') === 'https://me.example:8443/scene/4/stream?x=1');
ok('rebase keeps a base path prefix once', rebase('http://i:9999/scene/4/stream', 'https://h/stash') === 'https://h/stash/scene/4/stream'
  && rebase('http://i:9999/stash/scene/4/stream', 'https://h/stash') === 'https://h/stash/scene/4/stream');
ok('rebase resolves a relative path and passes null', rebase('/scene/1/funscript', 'http://h:1') === 'http://h:1/scene/1/funscript'
  && rebase(null, 'http://h:1') === null && rebase('', 'http://h:1') === null);
ok('withKey sets, replaces, never duplicates', withKey('http://h/s?t=1', 'k') === 'http://h/s?t=1&apikey=k'
  && withKey('http://h/s?apikey=old&t=1', 'k') === 'http://h/s?apikey=k&t=1' && withKey('http://h/s', '') === 'http://h/s'
  && withKey(null, 'k') === null);
ok('withKey encodes the key', withKey('http://h/s', 'a+b/c=') === 'http://h/s?apikey=a%2Bb%2Fc%3D');

console.log('(b) mapping and query');
const raw = {
  id: 7, title: '', date: '2026-01-02', rating100: 80, interactive: true, interactive_speed: 210,
  files: [{ basename: 'my clip.v2.mp4', duration: 12.3456, width: 1280, height: 720 }],
  paths: { screenshot: 'http://int:9999/scene/7/screenshot?t=5', stream: 'http://int:9999/scene/7/stream', funscript: 'http://int:9999/scene/7/funscript' },
  studio: { name: 'S' }, performers: [{ name: 'A' }, { name: 'B' }], tags: [{ name: 't' }],
};
const sc = toScene(raw, 'http://me:1', 'K');
ok('toScene shape', sc.key === 'stash:7' && sc.id === '7' && sc.title === 'my clip.v2' && sc.date === '2026-01-02' && sc.rating === 80
  && sc.durationMs === 12346 && sc.width === 1280 && sc.height === 720 && sc.speed === 210 && sc.studio === 'S'
  && sc.performers.join() === 'A,B' && sc.tags.join() === 't', JSON.stringify(sc));
ok('toScene keys media, not the funscript', sc.stream === 'http://me:1/scene/7/stream?apikey=K'
  && sc.screenshot === 'http://me:1/scene/7/screenshot?t=5&apikey=K' && sc.funscript === 'http://me:1/scene/7/funscript');
const bare = toScene({ id: '9', paths: { stream: '/scene/9/stream' }, interactive: false }, 'http://me:1', '');
ok('toScene with nothing optional', bare.title === 'Scene 9' && bare.date === null && bare.rating === null && bare.durationMs === null
  && bare.screenshot === null && bare.funscript === null && bare.studio === null && bare.performers.length === 0
  && bare.stream === 'http://me:1/scene/9/stream');
ok('SCENES_QUERY selects what Scene needs', ['findScenes(filter: $filter, scene_filter: $scene_filter)', 'count', 'id title date rating100',
  'interactive interactive_speed', 'files { basename duration width height }', 'paths { screenshot stream funscript }',
  'studio { name }', 'performers { name }', 'tags { name }', '$scene_filter: SceneFilterType'].every((s) => SCENES_QUERY.includes(s)));
ok('SORTS is the contract list', SORTS.map((s) => s[0]).join() === 'date,created_at,title,rating,interactive_speed');

console.log('(c) library fit and copy');
const g = fitGrid(1000, 600);
ok('fitGrid fills a wide box with tiles of at least the minimum', g.cols >= 4 && g.rows >= 2 && g.perPage === g.cols * g.rows, JSON.stringify(g));
ok('fitGrid keeps one tile in a tiny box', fitGrid(80, 40).perPage === 1 && fitGrid(0, 0).perPage === 1);
const tall = fitGrid(300, 1200);
ok('fitGrid stacks rows in a tall box', tall.cols === 1 && tall.rows > 3, JSON.stringify(tall));
const tile = (w) => w * 9 / 16 + 44;
ok('fitGrid rows fit the height', [[1000, 600], [500, 900], [1600, 300]].every(([W, H]) => {
  const f = fitGrid(W, H); const tw = (W - 8 * (f.cols - 1)) / f.cols;
  return f.rows * tile(tw) + 8 * (f.rows - 1) <= H + 0.01 || f.rows === 1;
}));
const copyBad = [...Object.values(COPY), ...Object.values(LIB_COPY), ...SORTS.map((s) => s[1])]
  .filter((t) => typeof t === 'string' && (t.length > 60 || /\. |\.$/.test(t) || t.trim().split(/\s+/).length >= 8));
ok('every COPY string is one fragment under eight words', copyBad.length === 0, copyBad.join(' | '));

// ---- against the fake ---------------------------------------------------------------------
console.log('(d) client against the fake Stash');
const KEY = 'sekret-key-123';
const fake = await startFakeStash({ key: KEY, scenes: 30 });
try {
  const st = createStash({ fetch, base: fake.url + '/', key: KEY });
  ok('version', (await st.version()) === 'v0.27.2');
  const v = fake.seen.at(-1);
  ok('POST /graphql with the ApiKey header and JSON', v.method === 'POST' && v.path === '/graphql' && v.headers.apikey === KEY
    && /application\/json/.test(v.headers['content-type']));

  fake.seen.length = 0;
  const pg = await st.scenes({ q: '', page: 2, perPage: 5, sort: 'title', direction: 'ASC' });
  const body = JSON.parse(fake.seen[0].body);
  ok('findScenes variables', body.variables.scene_filter.interactive === true
    && JSON.stringify(body.variables.filter) === JSON.stringify({ q: '', page: 2, per_page: 5, sort: 'title', direction: 'ASC' }),
  JSON.stringify(body.variables));
  ok('Page shape: only interactive scenes count', pg.count === 27 && pg.page === 2 && pg.perPage === 5 && pg.scenes.length === 5);
  ok('scenes rebased onto the configured base with the key', pg.scenes.every((s) => s.stream.startsWith(fake.url + '/scene/')
    && s.stream.endsWith('apikey=' + KEY) && s.screenshot.startsWith(fake.url) && s.funscript === fake.url + '/scene/' + s.id + '/funscript'));

  await st.scenes({ q: '', page: 2, perPage: 5, sort: 'title', direction: 'ASC' });
  ok('a repeated query is cached', fake.seen.length === 1);
  await st.scenes({ q: 'title 1', page: 1, perPage: 5, sort: 'title', direction: 'ASC' });
  ok('another query asks again', fake.seen.length === 2);

  const pick = pg.scenes[0];
  fake.seen.length = 0;
  const scr = await st.script(pick);
  const fs = fake.seen[0];
  ok('script: GET the funscript with the header, no key in the URL', fs.method === 'GET' && fs.path === '/scene/' + pick.id + '/funscript'
    && fs.headers.apikey === KEY);
  ok('script parses to a Script', scr && scr.at instanceof Float64Array && scr.at.length > 10 && scr.axis === 'L0' && scr.pos[1] > 0.85);
  await st.script(pick);
  ok('script is cached per scene id', fake.seen.length === 1);
  st.clear();
  await st.script(pick);
  await st.scenes({ q: '', page: 2, perPage: 5, sort: 'title', direction: 'ASC' });
  ok('clear drops both caches', fake.seen.length === 3);

  const stream = await fetch(pick.stream, { headers: { Range: 'bytes=0-99' } });
  ok('the keyed stream URL plays a Range', stream.status === 206 && (await stream.arrayBuffer()).byteLength === 100);
  const shot = await fetch(pick.screenshot);
  ok('the keyed screenshot URL loads', shot.status === 200 && /svg/.test(shot.headers.get('content-type')));

  console.log('(e) errors in words');
  const errs = [];
  const say = (m) => { errs.push(m); return m; };
  ok('no base: Stash not set', say(await rejects(createStash({ fetch, base: '', key: KEY }).version())) === 'Stash not set');
  ok('wrong key: Stash refused the key', say(await rejects(createStash({ fetch, base: fake.url, key: 'nope' }).version())) === 'Stash refused the key');
  ok('no key: Stash refused the key', say(await rejects(createStash({ fetch, base: fake.url, key: '' }).version())) === 'Stash refused the key');
  fake.fail.status = 500;
  ok('a 500: refused: 500', say(await rejects(createStash({ fetch, base: fake.url, key: KEY }).version())) === 'refused: 500');
  fake.fail.text = '<html>router</html>';
  ok('HTML: not a Stash server', say(await rejects(createStash({ fetch, base: fake.url, key: KEY }).version())) === 'not a Stash server');
  const badSort = say(await rejects(st.scenes({ sort: 'nope' + KEY + 'x'.repeat(80) })));
  ok('a GraphQL error: Stash: message, cut to 50, key scrubbed', badSort.startsWith('Stash: invalid sort: nope***')
    && badSort.length === 'Stash: '.length + 50 && !badSort.includes(KEY), badSort);
  const after = fake.seen.length;
  await rejects(st.scenes({ sort: 'nope' }));
  await rejects(st.scenes({ sort: 'nope' }));
  ok('a failed query is not cached', fake.seen.length === after + 2);
  ok('no script: words', say(await rejects(st.script({ id: '10', funscript: null }))) === 'no script for this scene');
  ok('a missing funscript: refused: 404', say(await rejects(createStash({ fetch, base: fake.url, key: KEY })
    .script({ id: '10', funscript: fake.url + '/scene/10/funscript' }))) === 'refused: 404');
  const garbage = createStash({ fetch: async () => new Response('{"nope":1}'), base: fake.url, key: KEY });
  ok('a non-funscript body: the parser words', say(await rejects(garbage.script({ id: '1', funscript: fake.url + '/x' }))) === 'not a funscript');
  ok('JSON without data: not a Stash server', say(await rejects(garbage.version())) === 'not a Stash server');

  const t0 = Date.now();
  const hang = createStash({ fetch: () => new Promise(() => {}), base: fake.url, key: KEY, timeoutMs: 60 });
  ok('a hung fetch: no answer from Stash at the timeout', say(await rejects(hang.version())) === 'no answer from Stash' && Date.now() - t0 < 1000);
  let signalled = false;
  const abortable = createStash({ fetch: (u, i) => new Promise((_, no) => i.signal.addEventListener('abort', () => { signalled = true; no(new Error('aborted ' + u)); })),
    base: fake.url, key: KEY, timeoutMs: 30 });
  ok('the timeout aborts the request', say(await rejects(abortable.version())) === 'no answer from Stash' && signalled);
  const dead = createStash({ fetch: () => Promise.reject(new TypeError('fetch failed ' + KEY)), base: 'http://127.0.0.1:1', key: KEY });
  ok('a refused connection: no answer from Stash', say(await rejects(dead.version())) === 'no answer from Stash');
  const hub = createStash({ fetch: async () => { throw new Error('net.fetch: the hub is reached through Valence'); }, base: fake.url, key: KEY });
  ok('the host refusal keeps its words', say(await rejects(hub.version())) === 'net.fetch: the hub is reached through Valence');
  ok('the key reaches no error message', errs.every((m) => !m.includes(KEY)));
} finally {
  await fake.close();
}

console.log(fails ? '\nFAIL -- ' + fails + ' assertion(s)' : '\nPASS -- funscript Stash client');
process.exit(fails ? 1 : 0);

// ---- live: the assumptions against a real Stash -------------------------------------------
async function live(base, key) {
  console.log('live Stash at ' + base + (key ? ' with a key' : ' without a key'));
  const st = createStash({ fetch, base, key, timeoutMs: 15000 });
  const post = async (query, variables) => {
    const r = await fetch(base + '/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { ApiKey: key } : {}) },
      body: JSON.stringify({ query, variables }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    ok('A1 + A9 GraphQL with the ApiKey header, version', true, await st.version());
  } catch (e) { ok('A1 + A9 GraphQL with the ApiKey header, version', false, e.message); return; }
  const obj = await post('query($f: SceneFilterType) { findScenes(scene_filter: $f) { count } }', { f: { interactive: { value: true, modifier: 'EQUALS' } } });
  ok('A3 interactive is a Boolean: the {value, modifier} form is refused', !!(obj.body && obj.body.errors), JSON.stringify(obj.body).slice(0, 120));
  let pg;
  try { pg = await st.scenes({ page: 1, perPage: 5 }); ok('A3 + A4 findScenes with the Boolean filter and the full selection', true, pg.count + ' interactive scenes'); }
  catch (e) { ok('A3 + A4 findScenes with the Boolean filter and the full selection', false, e.message); return; }
  for (const [s] of SORTS) {
    for (const d of ['ASC', 'DESC']) {
      try { await st.scenes({ page: 1, perPage: 1, sort: s, direction: d }); ok('A8 sort ' + s + ' ' + d, true); }
      catch (e) { ok('A8 sort ' + s + ' ' + d, false, e.message); }
    }
  }
  const rawq = await post(SCENES_QUERY, { filter: { per_page: 1 }, scene_filter: { interactive: true } });
  const r0 = rawq.body && rawq.body.data && rawq.body.data.findScenes.scenes[0];
  if (!r0) { console.log('  no interactive scene: A2, A5, A6, A7 not checked'); return; }
  console.log('  first scene raw paths: ' + JSON.stringify(r0.paths));
  console.log('  A4 files[0]: ' + JSON.stringify(r0.files[0]) + ' (duration should be seconds)');
  ok('A4 files[].duration reads as seconds', r0.files[0] && r0.files[0].duration > 1 && r0.files[0].duration < 36000);
  ok('A6 paths carry an absolute URL (rebased onto the base)', /^https?:\/\//.test(r0.paths.stream), r0.paths.stream);
  const sc0 = toScene(r0, base, key);
  try {
    const s = await st.script(sc0);
    ok('A7 the funscript with the ApiKey header parses', true, s.at.length + ' actions, notes: ' + (s.notes.join(', ') || 'none'));
  } catch (e) { ok('A7 the funscript with the ApiKey header parses', false, e.message); }
  const bare = await fetch(sc0.stream.replace(/[?&]apikey=[^&]*/, ''), { headers: { Range: 'bytes=0-1' } }).then((r) => r.status, () => 0);
  console.log('  stream without the key answers ' + bare + (key ? ' (401 means the key is required and A2 matters)' : ''));
  const sr = await fetch(sc0.stream, { headers: { Range: 'bytes=0-1023' } }).catch((e) => ({ status: 0, headers: new Headers(), e }));
  ok('A2 + A5 the keyed stream answers a Range', sr.status === 206, 'status ' + sr.status + ', ' + sr.headers.get('content-type')
    + ', accept-ranges ' + sr.headers.get('accept-ranges'));
  console.log('  A5 container: ' + sr.headers.get('content-type') + ' (WebView2 plays mp4 H.264/AAC and WebM)');
  if (sr.body) await sr.body.cancel().catch(() => {});
  const ss = await fetch(sc0.screenshot).then((r) => r.status + ' ' + r.headers.get('content-type'), (e) => e.message);
  ok('A2 the keyed screenshot loads', /^200 image\//.test(ss), ss);
}
