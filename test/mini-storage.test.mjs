/**
 * mini-storage.test.mjs -- the mini build (/mini/, the website's embed) stores nothing on the device; the web
 * build (/) does (docs/BUILD.md, Web builds).
 *
 * Serves dist-web at / and dist-mini at /mini/ on one origin, as Pages does. /mini/ loads, Advanced runs, the page
 * reloads and runs again; then the origin's real localStorage, sessionStorage, IndexedDB, cookies and Cache Storage
 * are all empty, read past the page's stand-ins and through Playwright's storage state. Control: / run the same way
 * leaves Neutrino's state in localStorage, so the check sees storage when there is some.
 *
 * Run: npm run build:web && npm run build:mini && node test/mini-storage.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOUNTS = [['/mini/', join(ROOT, 'dist-mini')], ['/', join(ROOT, 'dist-web')]];
for (const [, dir] of MOUNTS) if (!existsSync(join(dir, 'index.html'))) { console.error('missing ' + dir + ': npm run build:web && npm run build:mini'); process.exit(1); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const srv = createServer(async (q, s) => {
  const path = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const [mount, dir] = MOUNTS.find(([m]) => path.startsWith(m));
  const file = normalize(join(dir, path.slice(mount.length) || 'index.html'));
  if (!file.startsWith(dir)) { s.writeHead(403); return s.end(); }
  try { s.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); s.end(await readFile(file)); }
  catch { s.writeHead(404); s.end(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(info))); if (!cond) fails++; };

// Advanced running: the card's playhead rides the curve.
const running = (page) => page.waitForFunction(() => { const e = document.querySelector('.ap .ap-play'); return e && !e.hidden; }, null, { timeout: 30000 })
  .then(() => true, () => false);

// The origin's real storage, past any stand-in on window: a fresh same-origin frame's own.
const realStorage = (page) => page.evaluate(async () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  const local = f.contentWindow.localStorage.length, session = f.contentWindow.sessionStorage.length;
  f.remove();
  return {
    local, session, cookie: document.cookie,
    idb: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
    sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  };
});

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/mini/');
  ok('mini: Advanced runs on load', await running(page));
  await page.waitForTimeout(2000);
  await page.reload();
  ok('mini: Advanced runs again after a reload', await running(page));
  await page.waitForTimeout(2000);
  ok('mini: Neutrino state is held, in memory', await page.evaluate(() => !!localStorage.getItem('phosphor.builtin.state')));
  const st = await realStorage(page);
  ok('mini: localStorage empty', st.local === 0, st);
  ok('mini: sessionStorage empty', st.session === 0, st);
  ok('mini: no IndexedDB databases', st.idb.length === 0, st);
  ok('mini: no cookies', st.cookie === '' && (await ctx.cookies()).length === 0, st);
  ok('mini: Cache Storage empty', st.caches.length === 0, st);
  ok('mini: no service worker', st.sw === 0, st);
  const state = await ctx.storageState({ indexedDB: true });
  ok('mini: storage state empty', state.cookies.length === 0 && state.origins.every((o) => !o.localStorage.length && !(o.indexedDB || []).length), state);
  ok('mini: no page errors', errors.length === 0, errors);
  await ctx.close();

  // Control: the web build persists.
  const wctx = await browser.newContext();
  const wpage = await wctx.newPage();
  await wpage.goto(BASE + '/');
  await wpage.waitForFunction(() => !!localStorage.getItem('phosphor.builtin.state'), null, { timeout: 30000 }).catch(() => {});
  const wst = await realStorage(wpage);
  ok('web: Neutrino state persists in localStorage (the check sees storage)', wst.local > 0, wst);
  await wctx.close();
} finally {
  await browser.close();
  srv.close();
}
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('mini-storage: all passed');
