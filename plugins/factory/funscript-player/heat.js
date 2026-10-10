// heat.js -- the library's script heat: a speed strip per scene, cached on this machine; no DOM
// Contract: CONTRACT.md, module heat; the browser: docs/plugins/FUNSCRIPT.md, Library, Script heat.
//
// Constraints:
// - Phosphor's own heat only: the strip is heatStops (timeline.js) squeezed to BUCKETS speeds. Stash's heatmap PNG is
//   never asked (its colors are not the card's tokens, law 13).
// - A cache entry holds the bucket speeds (units/s), not colors and not the script: heatCss() turns them into
//   `var(--token)` colors at draw time, so a theme switch repaints without a fetch.
// - Entry key: scene id; its change marker is Stash's (toScene.marker). A matching marker is a hit with no request. A
//   changed marker asks the funscript with its validators; a 304 or an equal CRC keeps the strip.
// - A hover revalidates one entry once per session (`checked`): a conditional GET on the funscript URL (ETag or
//   Last-Modified); where the URL answers neither, the bytes' CRC32 is compared with the stored one.
// - Prefetch is the visible page and the next one only, LIMIT at a time, and holds while playing() is true.
// - The store keeps CAP entries (least recently seen out) and none unseen for MAX_AGE_MS; sweep() runs at a library
//   load, never on a timer. One Stash server per store: another base empties it.
// - A failed request leaves the entry as it was and shows nothing new; a hover that fails or is left may retry.
// - Never fetches a scene without a funscript.

import { parseFunscript } from './funscript.js';
import { heatStops, heatColor } from './timeline.js';

export const BUCKETS = 96;
export const CAP = 2000;
export const DAY_MS = 86400000;
export const MAX_AGE_MS = 30 * DAY_MS;
export const LIMIT = 3;
export const HOVER_MS = 250;
const SERVER = '::server';

let table = null;
/** CRC32 (IEEE) of a Uint8Array. */
export function crc32(bytes) {
  if (!table) table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** The script's speed per bucket, units/s rounded: the fastest action span in each share of its length. */
export function heatBuckets(script, n = BUCKETS) {
  const out = new Array(n).fill(0), d = script.durationMs;
  if (!(d > 0)) return out;
  for (const r of heatStops(script)) {
    const a = Math.max(0, Math.floor(r.from / d * n)), b = Math.min(n, Math.max(a + 1, Math.ceil(r.to / d * n)));
    for (let i = a; i < b; i++) out[i] = Math.max(out[i], Math.round(r.ups));
  }
  return out;
}

/** A CSS background for the bucket speeds: hard-edged runs in the timeline's token colors; equal neighbors merged. */
export function heatCss(ups) {
  const n = ups.length, stops = [];
  for (let i = 0; i < n; i++) {
    const c = heatColor(ups[i]), last = stops[stops.length - 1];
    if (last && last.c === c) last.b = i + 1; else stops.push({ c, a: i, b: i + 1 });
  }
  return 'linear-gradient(90deg, ' + stops.map((s) => s.c + ' ' + (s.a / n * 100).toFixed(2) + '% ' + (s.b / n * 100).toFixed(2) + '%').join(', ') + ')';
}

/** An in-memory store (tests, and a host without IndexedDB). Records: {k, t?, ...}; a record without t never ages out. */
export function memStore() {
  const m = new Map();
  const aged = () => [...m.values()].filter((r) => r.t != null);
  return {
    async get(k) { return m.get(k) || null; },
    async put(r) { m.set(r.k, r); },
    async clear() { m.clear(); },
    async evictBefore(t) { let n = 0; for (const r of aged()) if (r.t < t) { m.delete(r.k); n++; } return n; },
    async trim(cap) {
      const old = aged().sort((a, b) => a.t - b.t), over = old.length - cap;
      for (let i = 0; i < over; i++) m.delete(old[i].k);
      return Math.max(0, over);
    },
    async count() { return aged().length; },
  };
}

/** An IndexedDB store with the memStore's calls; null where there is no IndexedDB. */
export function idbStore(name = 'fsp-heat', idb = globalThis.indexedDB) {
  if (!idb) return null;
  const opened = new Promise((ok, no) => {
    const rq = idb.open(name, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('e', { keyPath: 'k' }).createIndex('t', 't');
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => no(rq.error);
  });
  const run = (mode, fn) => opened.then((db) => new Promise((ok, no) => {
    const tx = db.transaction('e', mode), st = tx.objectStore('e');
    let out;
    tx.oncomplete = () => ok(out);
    tx.onerror = tx.onabort = () => no(tx.error);
    out = fn(st, (v) => { out = v; });
  }));
  const req = (r, set) => { r.onsuccess = () => set(r.result); };
  // Walks the t index from the oldest, deleting while keep(record, index) says so.
  const eat = (st, set, keep) => {
    let n = 0;
    const rq = st.index('t').openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c || !keep(c.value, n)) return set(n);
      c.delete();
      n++;
      c.continue();
    };
  };
  return {
    get: (k) => run('readonly', (st, set) => req(st.get(k), (v) => set(v || null))),
    put: (r) => run('readwrite', (st) => { st.put(r); }),
    clear: () => run('readwrite', (st) => { st.clear(); }),
    evictBefore: (t) => run('readwrite', (st, set) => eat(st, set, (r) => r.t < t)),
    count: () => run('readonly', (st, set) => req(st.index('t').count(), set)),
    async trim(cap) {
      const over = (await this.count()) - cap;
      return over > 0 ? run('readwrite', (st, set) => eat(st, set, (_, n) => n < over)) : 0;
    },
  };
}

const heats = new WeakMap();

/**
 * One heat per Stash client, so the session's revalidations are counted once however often the library mounts.
 * @param {Object} stash createStash's client
 * @param {{store?: Object, cap?: number, maxAgeMs?: number, now?: () => number, limit?: number, hoverMs?: number}} [o]
 */
export function heatOf(stash, o = {}) {
  if (!heats.has(stash)) heats.set(stash, createHeat(stash, o));
  return heats.get(stash);
}

export function createHeat(stash, { store = idbStore() || memStore(), cap = CAP, maxAgeMs = MAX_AGE_MS, now = Date.now, limit = LIMIT, hoverMs = HOVER_MS } = {}) {
  const mem = new Map();          // id -> bucket speeds, this session
  const checked = new Set();      // ids validated against Stash this session
  const flying = new Map();       // id -> promise of a request in progress
  const hovers = new Set();
  let queue = [], active = 0, gen = 0, dead = false, idle = [];
  const ready = (async () => {
    const rec = await store.get(SERVER);
    if (!rec || rec.server !== stash.base) { await store.clear(); await store.put({ k: SERVER, server: stash.base }); }
  })().catch(() => {});

  const heat = {
    /** () => bool: true holds the prefetch (a video plays). Set by the library. */
    playing: () => false,
    /** (id, ups) => void: a strip is known. Set by the library. */
    onStrip: () => {},
    strip: (id) => mem.get(id) || null,
    /** Ids whose strips were validated against Stash this session. */
    checked,

    /** Drops what no entry is worth keeping: unseen for maxAgeMs, then the least recently seen beyond cap. */
    async sweep() {
      await ready;
      try { await store.evictBefore(now() - maxAgeMs); await store.trim(cap); } catch { /* a store that fails keeps nothing to sweep */ }
    },

    /** Queues the scripted scenes; a new list (append false) drops what the last one still queued. */
    prime(scenes, append = false) {
      if (!append) { queue = []; gen++; }
      for (const s of scenes) if (s && s.funscript && !mem.has(s.id)) queue.push(s);
      heat.resume();
    },
    /** Starts queued scenes up to the limit unless playing. Call when a video stops. */
    resume() {
      while (!dead && active < limit && queue.length && !heat.playing()) {
        const s = queue.shift(), g = gen;
        active++;
        settle(s, g).catch(() => {}).finally(() => { active--; heat.resume(); });
      }
      if (!active && !queue.length) idle.splice(0).forEach((f) => f());
    },

    /** The pointer or focus is on a scene: after hoverMs, revalidate its entry once per session. Returns leave(). */
    hover(s) {
      if (!s || !s.funscript || dead) return () => {};
      const ac = new AbortController();
      const timer = setTimeout(async () => {
        if (checked.has(s.id)) return;
        checked.add(s.id);
        try {
          if (flying.has(s.id)) await flying.get(s.id);
          else {
            const rec = await get(s.id);
            if (!ac.signal.aborted) await fetchStrip(s, rec, ac.signal);
          }
        } catch { checked.delete(s.id); }
        if (ac.signal.aborted) checked.delete(s.id);
      }, hoverMs);
      hovers.add(ac);
      return () => { clearTimeout(timer); ac.abort(); hovers.delete(ac); };
    },

    /** Resolves once nothing is queued or in progress (never while playing() holds a queue). */
    whenIdle() { return new Promise((ok) => { if (!active && !queue.length) ok(); else idle.push(ok); }); },

    dispose() { dead = true; queue = []; for (const ac of hovers) ac.abort(); hovers.clear(); },
  };

  async function get(id) { await ready; try { return await store.get(id); } catch { return null; } }
  async function put(r) { try { await store.put(r); } catch { /* the strip still shows this session */ } }
  const show = (id, ups) => { mem.set(id, ups); heat.onStrip(id, ups); };

  /** Prefetch of one scene: the entry if its marker holds, else one request. */
  async function settle(s, g) {
    const rec = await get(s.id);
    if (g !== gen || dead) return;
    if (rec && rec.ups) show(s.id, rec.ups);
    if (rec && s.marker && rec.marker === s.marker) {
      if (now() - rec.t > DAY_MS) await put({ ...rec, t: now() });
      return;
    }
    if (flying.has(s.id)) return;
    await fetchStrip(s, rec, null);
    checked.add(s.id);
  }

  /** One funscript request, conditional on rec's validators; writes the entry. A failure leaves it as it was. */
  function fetchStrip(s, rec, signal) {
    if (flying.has(s.id)) return flying.get(s.id);
    const p = (async () => {
      const cond = rec && (rec.etag || rec.lm) ? { etag: rec.etag, lm: rec.lm } : null;
      const r = await stash.asset(s, { cond, signal });
      if (r.notModified) { if (rec) await put({ ...rec, marker: s.marker, t: now() }); return; }
      const crc = r.etag || r.lm ? null : crc32(new TextEncoder().encode(r.text));
      if (rec && rec.ups && crc != null && rec.crc === crc) { await put({ ...rec, marker: s.marker, t: now() }); return; }
      const ups = heatBuckets(parseFunscript(r.text, s.title || s.key));
      await put({ k: s.id, t: now(), marker: s.marker, ups, etag: r.etag || null, lm: r.lm || null, crc });
      show(s.id, ups);
    })();
    flying.set(s.id, p);
    const done = () => { if (flying.get(s.id) === p) flying.delete(s.id); };
    p.then(done, done);
    return p;
  }

  return heat;
}
