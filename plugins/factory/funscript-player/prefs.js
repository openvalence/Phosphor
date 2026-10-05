/**
 * prefs.js -- the player's operator prefs: frozen defaults, a read that
 * repairs, a write. Contract: CONTRACT.md, module plugin (ph-smvd.6).
 *
 * Constraints:
 * - api.prefs is the store (plugin.funscript-player.<key>). Every key but
 *   'stash' is also mirrored to localStorage phosphor.funscript.<key>, the
 *   prefix the prefs backup carries (src/model/prefs.js BACKUP_KEY), and
 *   read from there when api.prefs has none (a restored backup). 'stash'
 *   holds the Stash API key: never mirrored, so never in a backup file.
 * - No DOM or window at import time: node imports this module.
 */

import { INTERP, cleanInterp } from './interp.js';

export const PREFS = deepFreeze({
  T: { offsetMs: 0, lo: 0, hi: 1, invert: false },
  motion: true,
  audio: { vol: 1, muted: false },
  stash: { base: '', key: '' },
  lib: { q: '', sort: 'date', direction: 'DESC' },
  view: 'player',
  zoomMs: 10000,
  settingsOpen: false, // the page's Settings section (page.js)
  libOpen: true, // the full card's library column (ui.js caret)
  split: 0, // the wave card's height in px; 0 = the composition's default (ui.js layout button)
  interp: INTERP,
  // Playback (ph-smvd.12): loopCount 0 = forever; home point 0..1 of the script, speed norm/s;
  // seekMs 0 = jump; lowLatency and autoLatency per scheduler.js setLatency.
  play: { loop: false, loopCount: 0, home: false, homeAfterMs: 5000, homePoint: 0.5, homeSpeed: 0.33,
    seekMs: 500, lowLatency: false, autoLatency: false },
});

const MIRROR = 'phosphor.funscript.';
const UNMIRRORED = new Set(['stash']);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

function mirrorGet(k) {
  try { const v = store() && store().getItem(MIRROR + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; }
}
function mirrorSet(k, v) {
  if (UNMIRRORED.has(k)) return;
  try { if (store()) store().setItem(MIRROR + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
}

/** A value of the default's own type, field by field; anything else becomes the default. */
function fit(def, v) {
  if (def && typeof def === 'object') {
    const src = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return Object.fromEntries(Object.keys(def).map((k) => [k, fit(def[k], src[k])]));
  }
  if (typeof def === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : def;
  return typeof v === typeof def ? v : def;
}

// Ranges the card's controls enforce (FUNSCRIPT.md, Handles): a stored value outside them is repaired here.
const REPAIR = {
  T(t) {
    t.offsetMs = clamp(Math.round(t.offsetMs / 5) * 5, -500, 500);
    t.lo = clamp(t.lo, 0, 1);
    t.hi = clamp(t.hi, 0, 1);
    if (t.hi - t.lo < 0.05) { t.lo = PREFS.T.lo; t.hi = PREFS.T.hi; }
    return t;
  },
  audio: (a) => ({ ...a, vol: clamp(a.vol, 0, 1) }),
  lib: (l) => ({ ...l, sort: l.sort || PREFS.lib.sort, direction: l.direction === 'ASC' ? 'ASC' : 'DESC' }),
  view: (v) => (v === 'library' ? v : 'player'),
  split: (v) => (v >= 48 ? Math.min(Math.round(v), 480) : 0),
  zoomMs: (z) => (z > 0 ? z : PREFS.zoomMs),
  interp: cleanInterp,
  play: (p) => ({ ...p, loopCount: clamp(Math.round(p.loopCount), 0, 99), homeAfterMs: clamp(Math.round(p.homeAfterMs / 500) * 500, 1000, 60000),
    homePoint: clamp(p.homePoint, 0, 1), homeSpeed: clamp(p.homeSpeed, 0.05, 2), seekMs: clamp(Math.round(p.seekMs / 50) * 50, 0, 3000) }),
};

/** Merged over the key's default and repaired. */
function clean(k, v) {
  const out = fit(PREFS[k], v);
  return REPAIR[k] ? REPAIR[k](out) : out;
}

function readOne(api, k) {
  let v = api.prefs.get(k);
  if (v == null) v = mirrorGet(k);
  else mirrorSet(k, v);
  return clean(k, v);
}

/** @returns {Object} the Prefs shape, every key present and well formed */
export function readPrefs(api) {
  return Object.fromEntries(Object.keys(PREFS).map((k) => [k, readOne(api, k)]));
}

/** Stores one key, repaired as readPrefs would; an unknown key throws (a typo must not persist silently). */
export function writePref(api, key, value) {
  if (!(key in PREFS)) throw new Error('unknown pref ' + key);
  const v = clean(key, value);
  api.prefs.set(key, v);
  mirrorSet(key, v);
}
