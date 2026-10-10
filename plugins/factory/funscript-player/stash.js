// stash.js -- Stash GraphQL client over an injected fetch; pure, no DOM
// Contract: CONTRACT.md, module stash (ph-smvd.3).
//
// Constraints:
// - Every request goes through the injected fetch (api.net.fetch in the plugin, a fake in tests).
// - Every Stash fact is a marked ASSUMPTION An (docs/plugins/FUNSCRIPT.md, Stash, verdicts on v0.31.1). Recheck
//   them after a Stash upgrade with `node test/funscript-stash.test.mjs --live <file.json>`.
// - Errors are Error(words) from COPY only; the key never reaches a message or a log (this module logs nothing).
// - SCENES_QUERY also selects files.basename (A4): the title of a scene Stash left untitled.
// - toScene sets funscript null when Stash reports interactive false (Stash builds the path regardless).
// - toScene reads interactive_speed 0 as unknown (null): Stash reports 0 for a scripted scene it never measured.
// - rebase keeps a base path prefix (a reverse proxy at /stash) unless the URL already carries it.
// - script() of a scene without a funscript rejects 'no script for this scene'.
// - oscOf() never fetches: it reads the scripts this client already parsed (Stash serves no companion files, A7).

import { parseFunscript, OSC_AXES } from './funscript.js';

export const COPY = Object.freeze({
  notSet: 'Stash not set',
  noAnswer: 'no answer from Stash',
  badKey: 'Stash refused the key',
  refused: 'refused: ',
  says: 'Stash: ',
  notStash: 'not a Stash server',
  noScript: 'no script for this scene',
  untitled: 'Scene ',
});

// ASSUMPTION A8: these sort keys exist on findScenes; direction is ASC or DESC (duration and play_count are in the
// v0.31.1 source, not yet checked live: `node test/funscript-stash.test.mjs --live` sorts by every key both ways).
export const SORTS = Object.freeze([['date', 'Date'], ['created_at', 'Added'], ['title', 'Title'], ['duration', 'Duration'],
  ['play_count', 'Plays'], ['rating', 'Rating'], ['interactive_speed', 'Speed']].map((p) => Object.freeze(p)));

// ASSUMPTION A3: SceneFilterType.interactive is a plain Boolean (not {value, modifier}).
// ASSUMPTION A4: findScenes returns count and these scene fields; files[].duration is in seconds.
export const SCENES_QUERY = `query FindScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) {
    count
    scenes {
      id title date rating100 interactive interactive_speed
      files { basename duration width height }
      paths { screenshot stream funscript }
      studio { name } performers { name } tags { name }
    }
  }
}`;

// ASSUMPTION A9: { version { version } } answers on every Stash.
const VERSION_QUERY = '{ version { version } }';

/** 'http(s)://host[:port][/path]' without a trailing slash, or ''. A pasted /graphql is dropped. */
export function normalizeBase(text) {
  let t = String(text ?? '').trim();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'http://' + t;
  let u;
  try { u = new URL(t); } catch { return ''; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return '';
  const path = u.pathname.replace(/\/+$/, '').replace(/\/graphql$/i, '');
  return u.origin + path;
}

// ASSUMPTION A6: paths.* carry Stash's own idea of its host (often an internal name); carry them onto base.
/** url carried onto base's origin, keeping base's path prefix; null for an empty or unparsable url. */
export function rebase(url, base) {
  if (!url) return null;
  const b = new URL(base + '/');
  let u;
  try { u = new URL(url, b); } catch { return null; }
  const prefix = b.pathname.replace(/\/$/, '');
  const path = prefix && !u.pathname.startsWith(prefix + '/') ? prefix + u.pathname : u.pathname;
  return b.origin + path + u.search + u.hash;
}

// ASSUMPTION A2: media URLs (stream, screenshot) accept ?apikey=<key>.
/** apikey=key set on url (replaced, never duplicated); unchanged for key ''. */
export function withKey(url, key) {
  if (!url || !key) return url;
  const u = new URL(url);
  u.searchParams.set('apikey', key);
  return u.href;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const names = (list) => (Array.isArray(list) ? list.map((x) => x && x.name).filter(Boolean) : []);

/** One findScenes scene as the player's Scene. */
export function toScene(raw, base, key) {
  const f = (raw.files && raw.files[0]) || {};
  const p = raw.paths || {};
  const dur = num(f.duration);
  return {
    key: 'stash:' + raw.id,
    id: String(raw.id),
    title: raw.title || (f.basename ? f.basename.replace(/\.[^.]+$/, '') : COPY.untitled + raw.id),
    date: raw.date || null,
    rating: num(raw.rating100),
    durationMs: dur == null ? null : Math.round(dur * 1000),
    width: num(f.width),
    height: num(f.height),
    screenshot: withKey(rebase(p.screenshot, base), key),
    // ASSUMPTION A5: paths.stream is the original file, direct and Range-capable (direct streams only in v1).
    stream: withKey(rebase(p.stream, base), key),
    // ASSUMPTION A7: paths.funscript serves the main (L0) script JSON with the ApiKey header; no companions.
    funscript: raw.interactive === false ? null : rebase(p.funscript, base),
    speed: num(raw.interactive_speed) || null,
    studio: (raw.studio && raw.studio.name) || null,
    performers: names(raw.performers),
    tags: names(raw.tags),
  };
}

const fail = (words) => { throw new Error(words); };

/**
 * @param {{fetch: Function, base: string, key: string, timeoutMs?: number}} o
 * @returns {{version(): Promise<string>, scenes(q): Promise<Object>, script(scene): Promise<Object>, clear(): void}}
 */
export function createStash({ fetch, base, key, timeoutMs = 8000 }) {
  const root = normalizeBase(base);
  key = key || '';
  const pages = new Map();
  const scripts = new Map();
  const osc = new Map();

  // ASSUMPTION A1: the ApiKey header authenticates every route; no session cookie is used.
  const headers = (extra) => (key ? { ...extra, ApiKey: key } : { ...extra });
  const scrub = (s) => (key ? String(s).split(key).join('***') : String(s));

  /** fetch plus the body read under one timeout; a throw, an abort or the timer is 'no answer'. */
  async function call(url, init, read) {
    if (!root) fail(COPY.notSet);
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const late = new Promise((_, no) => { timer = setTimeout(() => { if (ac) ac.abort(); no(new Error(COPY.noAnswer)); }, timeoutMs); });
    const go = (async () => {
      let res;
      // The host's own refusals (api.net.fetch: scheme, hub origin, no shell) keep their words.
      try { res = await fetch(url, ac ? { ...init, signal: ac.signal } : init); } catch (e) {
        const m = (e && e.message) || '';
        fail(/^net\.fetch/.test(m) ? m : COPY.noAnswer + (m ? ' (' + scrub(m).slice(0, 80) + ')' : ''));
      }
      if (res.status === 401 || res.status === 403) fail(COPY.badKey);
      if (!res.ok) fail(COPY.refused + res.status);
      try { return await res.text(); } catch { fail(COPY.noAnswer); }
    })();
    try {
      return read(await Promise.race([go, late]));
    } finally {
      clearTimeout(timer);
      go.catch(() => {});
    }
  }

  // ASSUMPTION A1: GraphQL answers at <base>/graphql to a POST of {query, variables}.
  const gql = (query, variables) => call(root + '/graphql', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(variables ? { query, variables } : { query }),
  }, (text) => {
    let body;
    try { body = JSON.parse(text); } catch { fail(COPY.notStash); }
    const err = body && Array.isArray(body.errors) && body.errors[0];
    if (err) fail(COPY.says + scrub(err.message || 'error').slice(0, 50));
    if (!body || !body.data) fail(COPY.notStash);
    return body.data;
  });

  /** A cached promise; a rejection leaves the cache so the next call asks again. */
  function cached(map, k, make) {
    if (!map.has(k)) {
      const p = make();
      map.set(k, p);
      p.catch(() => { if (map.get(k) === p) map.delete(k); });
    }
    return map.get(k);
  }

  return {
    async version() {
      const d = await gql(VERSION_QUERY);
      if (!d.version || typeof d.version !== 'object') fail(COPY.notStash);
      return String(d.version.version || 'dev');
    },

    scenes({ q = '', page = 1, perPage = 20, sort = 'date', direction = 'DESC', scripted = true } = {}) {
      const filter = {
        q: String(q || ''),
        page: Math.max(1, Math.floor(page) || 1),
        per_page: Math.max(1, Math.floor(perPage) || 1),
        sort,
        direction: direction === 'ASC' ? 'ASC' : 'DESC',
      };
      const sceneFilter = scripted === false ? {} : { interactive: true };
      return cached(pages, JSON.stringify([filter, sceneFilter]), async () => {
        const d = await gql(SCENES_QUERY, { filter, scene_filter: sceneFilter });
        const r = d.findScenes;
        if (!r || !Array.isArray(r.scenes)) fail(COPY.notStash);
        return { count: num(r.count) ?? r.scenes.length, page: filter.page, perPage: filter.per_page,
          scenes: r.scenes.map((s) => toScene(s, root, key)) };
      });
    },

    script(scene) {
      if (!scene || !scene.funscript) return Promise.reject(new Error(COPY.noScript));
      return cached(scripts, scene.id, () => call(scene.funscript, { method: 'GET', headers: headers({ Accept: 'application/json' }) },
        (text) => {
          const s = parseFunscript(text, scene.title || scene.key);
          osc.set(scene.id, OSC_AXES.filter((a) => s.axes && s.axes[a]));
          return s;
        }));
    },

    /** The oscillator axes (V8, V9) of a script this client parsed; null until then. */
    oscOf(scene) { return (scene && osc.get(scene.id)) || null; },

    clear() { pages.clear(); scripts.clear(); osc.clear(); },
  };
}
