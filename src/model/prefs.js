/**
 * prefs.js -- app preferences. Browser state, never machine state: nothing
 * here is sent to the hub, so the ground-truth doctrine and the write ladder
 * (RENDERING law 5) do not apply.
 *
 * Constraints:
 * - Pure: no runes, no Tauri, no DOM, so test/prefs.test.mjs runs it under node.
 * - Theme and hi-vis keep their existing homes (theme.js and the `ui_hivis`
 *   key main.js restores before first paint). This file never copies them.
 * - Every storage access degrades to in-memory on a throw (private mode,
 *   quota, storage disabled).
 */

import { writable, get } from 'svelte/store';

export const PREFS_KEY = 'phosphor.prefs';
/** Bump with a migration in loadPrefs when a field changes meaning. */
export const PREFS_VERSION = 1;

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
