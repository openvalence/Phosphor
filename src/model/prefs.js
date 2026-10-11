/**
 * prefs.js -- app preferences, saved hubs and the settings backup. Browser
 * state, never machine state: nothing here is sent to the hub, so the
 * ground-truth doctrine and the write ladder (RENDERING law 5) do not apply.
 *
 * Constraints:
 * - Pure: no runes, no Tauri, no DOM, so test/prefs.test.mjs runs it under node.
 * - Theme and hi-vis keep their existing homes (theme.js and the `ui_hivis`
 *   key main.js restores before first paint). This file never copies them;
 *   the backup carries their keys.
 * - A saved hub's endpoint is host AND port, redialed exactly (ph-dwy).
 * - Every storage access degrades to in-memory on a throw (private mode,
 *   quota, storage disabled).
 */

import { writable, get } from 'svelte/store';

export const PREFS_KEY = 'phosphor.prefs';
export const HUBS_KEY = 'phosphor.hubs';
/** Bump with a migration in loadPrefs when a field changes meaning. */
export const PREFS_VERSION = 1;
const HUBS_MAX = 32;

export const UNITS = ['metric'];
/** Page fullscreen (App.svelte, model/fullscreen.js): inside the window, or the window itself. */
export const FULLSCREEN = ['window', 'borderless'];
/** Motion override (ui/still.svelte.js): follow the OS, or force stillness or motion. */
export const MOTION = ['system', 'reduced', 'full'];
export const DEFAULTS = Object.freeze({
  autorange: true,    // RFC-086 SI-prefix display autoranging
  units: 'metric',
  reconnect: true,    // redial the last saved hub on launch (shell)
  telemetryHz: null,  // null = the client default; always clamped to the catalog max
  estopDatagram: true, // shell: an e-stop press also broadcasts the RFC-053 datagram (opt-out)
  fullscreen: 'window',
  scrollbars: false,  // recess shadows are the scroll affordance (DESIGN §10.3)
  motion: 'system',   // DESIGN §10.13; theme motion 0 still holds everything still
  railHide: true,     // the hide tab on the rail strip is available (feature switch)
  railHidden: false,  // the rail is hidden right now (state)
  closeIdle: true,    // shell: the window closes with no hold while the machine is idle (DESIGN §10.3)
  openToLan: false,   // desktop shell: the Virtual's hub on the LAN while it runs (shell/lan.svelte.js)
  lanPort: 82,        // its WebSocket port; unbindable, the OS picks one
});

function read(key) {
  try { return JSON.parse(globalThis.localStorage.getItem(key)); } catch (e) { return null; }
}
function write(key, v) {
  try { globalThis.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* in-memory only */ }
}

/** Any stored shape -> a complete prefs object; a bad field takes its default. */
export function loadPrefs(raw = read(PREFS_KEY)) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const hz = Number(p.telemetryHz);
  return {
    autorange: typeof p.autorange === 'boolean' ? p.autorange : DEFAULTS.autorange,
    units: UNITS.includes(p.units) ? p.units : DEFAULTS.units,
    reconnect: typeof p.reconnect === 'boolean' ? p.reconnect : DEFAULTS.reconnect,
    telemetryHz: p.telemetryHz != null && Number.isFinite(hz) && hz > 0 ? hz : null,
    estopDatagram: typeof p.estopDatagram === 'boolean' ? p.estopDatagram : DEFAULTS.estopDatagram,
    fullscreen: FULLSCREEN.includes(p.fullscreen) ? p.fullscreen : DEFAULTS.fullscreen,
    scrollbars: typeof p.scrollbars === 'boolean' ? p.scrollbars : DEFAULTS.scrollbars,
    motion: MOTION.includes(p.motion) ? p.motion : DEFAULTS.motion,
    railHide: typeof p.railHide === 'boolean' ? p.railHide : DEFAULTS.railHide,
    railHidden: typeof p.railHidden === 'boolean' ? p.railHidden : DEFAULTS.railHidden,
    closeIdle: typeof p.closeIdle === 'boolean' ? p.closeIdle : DEFAULTS.closeIdle,
    openToLan: typeof p.openToLan === 'boolean' ? p.openToLan : DEFAULTS.openToLan,
    lanPort: Number.isInteger(p.lanPort) && p.lanPort > 0 && p.lanPort < 65536 ? p.lanPort : DEFAULTS.lanPort,
  };
}

export const prefs = writable(loadPrefs());
prefs.subscribe((p) => write(PREFS_KEY, { v: PREFS_VERSION, ...p }));

export function setPref(key, value) {
  prefs.update((p) => loadPrefs({ ...p, [key]: value }));
}

/**
 * The telemetry rate to wish for: the preference, else `fallbackHz`, never
 * above the channel's catalog max_rate_hz (SPEC §10.2). 0 max = on-change.
 */
export function telemetryRate(maxHz, fallbackHz, p = get(prefs)) {
  if (!maxHz) return 0;
  return Math.min(maxHz, p.telemetryHz ?? fallbackHz);
}

// ---- saved hubs ----------------------------------------------------------

/** WELCOME identity hub_instance_id (16 hex digits), else the dialed endpoint. */
export function hubKey(identity, host, port) {
  const id = identity && identity.hub_instance_id;
  return typeof id === 'string' && /^[0-9a-f]{16}$/i.test(id) ? id.toLowerCase() : host + ':' + port;
}

function loadHubs(raw = read(HUBS_KEY)) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h) => h && typeof h.id === 'string' && typeof h.host === 'string' && h.host
    && Number.isInteger(h.port) && h.port > 0 && h.port < 65536);
}

/** Most recently seen first. */
export const savedHubs = writable(loadHubs());
savedHubs.subscribe((a) => write(HUBS_KEY, a));

/**
 * Record a live WS session. A hub that reports an id replaces any entry
 * keyed on the same endpoint, keeping its nickname, so a hub first saved
 * by address is not listed twice once its firmware sends the id.
 */
export function rememberHub({ identity, host, port, now = Date.now() }) {
  if (!host || !port) return;
  const id = hubKey(identity, host, port);
  const ep = host + ':' + port;
  savedHubs.update((a) => {
    const old = a.find((h) => h.id === id) || a.find((h) => h.id === ep);
    const hub = {
      id, host, port,
      name: (identity && identity.hub_name) || (old && old.name) || '',
      nickname: (old && old.nickname) || '',
      lastSeen: now,
    };
    return [hub, ...a.filter((h) => h.id !== id && h.id !== ep)].slice(0, HUBS_MAX);
  });
}

export function renameHub(id, nickname) {
  savedHubs.update((a) => a.map((h) => (h.id === id ? { ...h, nickname: String(nickname || '').trim() } : h)));
}

export function forgetHub(id) {
  savedHubs.update((a) => a.filter((h) => h.id !== id));
}

/** What a list row shows. */
export function hubLabel(h) {
  return h.nickname || h.name || h.host + ':' + h.port;
}

/**
 * The endpoint to dial on launch, or null. Only when the preference is on and
 * the last session was WS; a saved list that predates this file falls back to
 * the old port-less `legacyHost` (default port).
 */
export function launchTarget({ reconnect, mode, hubs, legacyHost }) {
  if (!reconnect || (mode || 'ws') !== 'ws') return null;
  if (hubs[0]) return { host: hubs[0].host, port: hubs[0].port };
  return legacyHost ? { host: legacyHost } : null;
}

// ---- backup --------------------------------------------------------------

/** Client-owned keys: prefs, hubs, layouts, chart lanes, plugins, theme, legibility. */
const BACKUP_KEY = /^(phosphor\.|sd32\.theme|ui_hivis$|ui_terse$)/;

export function exportBackup(storage = globalThis.localStorage) {
  const keys = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (BACKUP_KEY.test(k)) keys[k] = storage.getItem(k);
    }
  } catch (e) { /* nothing readable: an empty backup */ }
  return JSON.stringify({ app: 'phosphor', v: PREFS_VERSION, keys }, null, 2);
}

/** Writes only client-owned string keys; returns how many. Throws on a non-backup. */
export function importBackup(text, storage = globalThis.localStorage) {
  const b = JSON.parse(text);
  if (!b || b.app !== 'phosphor' || !b.keys || typeof b.keys !== 'object') throw new Error('not a Phosphor backup');
  let n = 0;
  for (const [k, v] of Object.entries(b.keys)) {
    if (BACKUP_KEY.test(k) && typeof v === 'string') { storage.setItem(k, v); n++; }
  }
  return n;
}
