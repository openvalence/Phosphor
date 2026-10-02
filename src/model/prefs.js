/**
 * prefs.js -- app preferences and saved hubs. Browser state, never machine
 * state: nothing here is sent to the hub, so the ground-truth doctrine and
 * the write ladder (RENDERING law 5) do not apply.
 *
 * Constraints:
 * - Pure: no runes, no Tauri, no DOM, so test/prefs.test.mjs runs it under node.
 * - Theme and hi-vis keep their existing homes (theme.js and the `ui_hivis`
 *   key main.js restores before first paint). This file never copies them.
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
export const DEFAULTS = Object.freeze({
  autorange: true,    // RFC-086 SI-prefix display autoranging
  units: 'metric',
  reconnect: true,    // redial the last saved hub on launch (shell)
  telemetryHz: null,  // null = the client default; always clamped to the catalog max
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
