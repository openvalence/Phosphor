/**
 * fake-stash.mjs -- a Stash stand-in over node http for the funscript player's tests (ph-smvd.3).
 * It answers as plugins/factory/funscript-player/stash.js ASSUMES Stash does (A1..A9); the
 * `--live` mode of test/funscript-stash.test.mjs checks the same facts against a real Stash.
 *
 * Constraints:
 * - No binary is committed: the stream is the caller's `video` (a Buffer or a file path) or
 *   1 KiB of zeros, the screenshot an SVG drawn per scene.
 * - paths.* name the host `stash.internal:9999`, never the URL it listens on (A6), so a client
 *   that forgets to rebase fails.
 * - Every route needs the key (header ApiKey or ?apikey=), else 401. CORS is answered for the
 *   browser tests' dev fetch; a real Stash may not answer a preflight.
 * - Scenes with id % 10 == 0 are not interactive: scene_filter {interactive: true} must drop them.
 * - Scripts of scenes with id % 6 == 1 embed the oscillator axes V8 and V9 (funlib 1.1 axes[]).
 *
 * Use: const s = await startFakeStash({ key: 'k' }); ... s.seen; await s.close();
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const SELF = 'http://stash.internal:9999';
const SORTS = { date: (s) => s.date, created_at: (s) => s.created_at, title: (s) => s.title, rating: (s) => s.rating100,
  interactive_speed: (s) => s.interactive_speed, duration: (s) => s.files[0].duration, play_count: (s) => s.play_count };

function makeScenes(n) {
  return Array.from({ length: n }, (_, i) => {
    const id = String(i + 1);
    return {
      id,
      title: i % 7 === 3 ? '' : 'Scene title ' + id,
      date: '2026-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'),
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(),
      rating100: i % 5 === 0 ? null : (i * 13) % 101,
      interactive: (i + 1) % 10 !== 0,
      interactive_speed: (i + 1) % 10 !== 0 ? 100 + ((i * 37) % 300) : null,
      play_count: (i * 7) % 13,
      files: [{ basename: 'clip_' + id + '.mp4', duration: 60 + i * 1.5, width: 1920, height: 1080 }],
      paths: {
        screenshot: SELF + '/scene/' + id + '/screenshot?t=' + (1000 + i),
        stream: SELF + '/scene/' + id + '/stream',
        funscript: SELF + '/scene/' + id + '/funscript',
      },
      studio: i % 3 ? { name: 'Studio ' + (i % 3) } : null,
      performers: [{ name: 'Performer ' + (i % 4) }],
      tags: [{ name: 'tag' + (i % 2) }],
    };
  });
}

/** A main-axis script: strokes every 400 ms for the scene's length. */
export function fakeScript(id, durationMs) {
  const actions = [];
  for (let at = 0, k = 0; at <= durationMs; at += 400, k++) actions.push({ at, pos: k % 2 ? 90 : 10 });
  const osc = +id % 6 === 1 ? { version: '1.1', axes: ['V8', 'V9'].map((a) => ({ id: a, actions: [{ at: 0, pos: 50 }, { at: durationMs, pos: 60 }] })) } : {};
  return { version: '1.0', inverted: false, range: 100, actions, metadata: { title: 'Script ' + id }, ...osc };
}

/**
 * @param {{key?: string, scenes?: number, video?: Buffer|string|null}} o
 * @returns {Promise<{url: string, seen: Array, close(): Promise<void>, scenes: Array, fail: Object}>}
 *   fail: set fail.status = 500 (or any) to answer that status once to the next /graphql,
 *   fail.text = '...' to answer a non-JSON 200 once.
 */
export async function startFakeStash({ key = '', scenes = 30, video = null } = {}) {
  const all = makeScenes(scenes);
  const bytes = video == null ? Buffer.alloc(1024) : Buffer.isBuffer(video) ? video : readFileSync(video);
  const vtype = typeof video === 'string' && /\.webm$/i.test(video) ? 'video/webm' : 'video/mp4';
  const seen = [];
  const fail = {};

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: req.url, headers: req.headers, body });
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'ApiKey, Content-Type, Range',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length' };
      const send = (status, type, data, extra = {}) => {
        res.writeHead(status, { ...cors, 'Content-Type': type, ...extra });
        res.end(data);
      };
      if (req.method === 'OPTIONS') return send(204, 'text/plain', '');
      if (key && req.headers.apikey !== key && u.searchParams.get('apikey') !== key) return send(401, 'text/plain', 'Unauthorized');

      if (u.pathname === '/graphql' && req.method === 'POST') {
        if (fail.status) { const s = fail.status; delete fail.status; return send(s, 'text/plain', 'boom'); }
        if (fail.text) { const t = fail.text; delete fail.text; return send(200, 'text/html', t); }
        let q;
        try { q = JSON.parse(body); } catch { return send(400, 'application/json', JSON.stringify({ errors: [{ message: 'bad json' }] })); }
        const out = (data) => send(200, 'application/json', JSON.stringify(data));
        if (/findScenes/.test(q.query)) {
          const v = q.variables || {};
          const sf = v.scene_filter || {};
          if (sf.interactive != null && typeof sf.interactive !== 'boolean') {
            return out({ errors: [{ message: 'Expected type "Boolean", found ' + JSON.stringify(sf.interactive) + '.' }] });
          }
          const f = v.filter || {};
          const field = SORTS[f.sort];
          if (f.sort && !field) return out({ errors: [{ message: 'invalid sort: ' + f.sort }] });
          let list = all.filter((s) => (sf.interactive == null || s.interactive === sf.interactive)
            && (!f.q || (s.title || s.files[0].basename).toLowerCase().includes(String(f.q).toLowerCase())));
          if (field) {
            const dir = f.direction === 'ASC' ? 1 : -1;
            list = [...list].sort((a, b) => ((field(a) ?? -1) > (field(b) ?? -1) ? 1 : (field(a) ?? -1) < (field(b) ?? -1) ? -1 : 0) * dir);
          }
          const per = f.per_page > 0 ? f.per_page : 25, page = f.page > 0 ? f.page : 1;
          return out({ data: { findScenes: { count: list.length, scenes: list.slice((page - 1) * per, page * per) } } });
        }
        if (/version/.test(q.query)) return out({ data: { version: { version: 'v0.27.2' } } });
        return out({ errors: [{ message: 'unknown query' }] });
      }

      const m = /^\/scene\/(\d+)\/(funscript|stream|screenshot)$/.exec(u.pathname);
      const s = m && all.find((x) => x.id === m[1]);
      if (!s) return send(404, 'text/plain', 'not found');
      if (m[2] === 'funscript') {
        if (!s.interactive) return send(404, 'text/plain', 'not found');
        return send(200, 'application/json', JSON.stringify(fakeScript(s.id, s.files[0].duration * 1000)));
      }
      if (m[2] === 'screenshot') {
        return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#333"/>'
          + '<text x="80" y="50" font-size="24" text-anchor="middle" fill="#ccc">' + s.id + '</text></svg>');
      }
      const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (!r) return send(200, vtype, bytes, { 'Accept-Ranges': 'bytes', 'Content-Length': bytes.length });
      const a = r[1] ? +r[1] : bytes.length - +r[2];
      const b = r[1] && r[2] ? Math.min(+r[2], bytes.length - 1) : bytes.length - 1;
      if (a >= bytes.length || a > b) return send(416, 'text/plain', '', { 'Content-Range': 'bytes */' + bytes.length });
      return send(206, vtype, bytes.subarray(a, b + 1),
        { 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + a + '-' + b + '/' + bytes.length, 'Content-Length': b - a + 1 });
    });
  });

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + server.address().port;
  return {
    url, seen, fail, scenes: all,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
