/**
 * plugins.svelte.js — the app's one plugin host, wired to the live model, and
 * the two loaders that feed it.
 *
 * Constraints:
 * - The host's dependencies are the model and shadow entry points and
 *   nothing else. Adding a session, socket or transport handle here breaks
 *   the Prime Rule for every plugin at once (docs/PLUGINS.md).
 * - Loading happens only in the Tauri shell (plugins directory under app
 *   data) and, in a `vite dev` build only, from `?plugin=<url>`. The page a
 *   hub serves never loads plugins: the hub serves one file.
 * - Enable state is a browser preference (localStorage), never machine state.
 * See: docs/PLUGINS.md, src/plugins/host.js
 */

import { createPluginHost } from './host.js';
import PluginSlot from './PluginSlot.svelte';
import { machine } from '../model/machine.svelte.js';
import {
  writeSetting, runAction, sendCommand, submitMotion, displayValue, statusOf,
} from '../model/shadow.svelte.js';
import { WIDGET } from '../model/settings.js';
import { registerTheme } from '../model/theme.js';
import { LOG_LEVEL_NAME } from '../../../Valence/clients/js/index.js';

const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
const DISABLED_KEY = 'phosphor.plugins.disabled';
const LOG_MAX = 400;
const LEVEL = Object.fromEntries(Object.entries(LOG_LEVEL_NAME).map(([n, name]) => [name, Number(n)]));

/** Reactive mirror of the host for the pane and the claim pass. */
export const pluginsUi = $state({ gen: 0, list: [], active: false, dir: '' });

function disabledSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]')); } catch (e) { return new Set(); }
}

// Plugin lines ride the device log ring so they appear where an operator
// already looks; the `plugin:<name>` tag says they are client-side.
function logLine(name, level, msg) {
  const ring = machine.events.log;
  ring.push({
    channel: null, channelName: 'plugin', at: Date.now(),
    body: { level: LEVEL[level] ?? LEVEL.info, tag: 'plugin:' + name, message: msg },
  });
  if (ring.length > LOG_MAX) ring.splice(0, ring.length - LOG_MAX);
  (level === 'error' ? console.error : console.log)('[plugin:' + name + '] ' + msg);
}

function write(field, value) {
  if (!field) return;
  if (field.widget === WIDGET.action) return runAction(field, value);
  if (field.isIntentField) return sendCommand(field, value);
  return writeSetting(field, value);
}

async function listenTcp(port, onLine) {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen('plugin-tcp-line', (e) => {
    if (e.payload && e.payload.port === port) onLine(e.payload.line);
  });
  try {
    await invoke('plugin_tcp_listen', { port });
  } catch (e) {
    unlisten();
    throw new Error(String(e));
  }
  return async () => {
    unlisten();
    await invoke('plugin_tcp_close', { port });
  };
}

export const host = createPluginHost({
  model: () => machine.catalog.model,
  sample: (ch) => machine.samples[ch],
  sampleAge: (ch) => (machine.sampleTs[ch] ? Date.now() - machine.sampleTs[ch] : Infinity),
  display: displayValue,
  status: statusOf,
  write,
  submitMotion,
  registerTheme,
  listenTcp: SHELL ? listenTcp : null,
  prefs: typeof localStorage !== 'undefined' ? localStorage : null,
  log: logLine,
});

host.onChange(() => {
  pluginsUi.list = host.list();
  pluginsUi.gen++;
});

/** Active plugin heroes, ready for heroes.js's claim pass. */
export function pluginHeroes() {
  return host.heroes().map((h) => ({ ...h, component: PluginSlot, host }));
}

export function setPluginEnabled(name, on) {
  const off = disabledSet();
  if (on) off.delete(name); else off.add(name);
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify([...off])); } catch (e) { /* private mode */ }
  host.setEnabled(name, on);
}

// A blob: URL is the one import form that needs no file server and no asset
// protocol scope. It cannot resolve relative imports, so a plugin ships as
// one self-contained ES module (docs/PLUGINS.md).
async function importSource(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { return await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
}

async function loadFromShell() {
  const { invoke } = await import('@tauri-apps/api/core');
  const off = disabledSet();
  let found;
  try {
    found = await invoke('plugins_list');
  } catch (e) {
    logLine('host', 'error', 'plugins_list failed: ' + e);
    return;
  }
  pluginsUi.dir = found.dir || '';
  for (const p of found.plugins || []) {
    const manifest = p.manifest || { name: p.dir };
    if (p.error) { host.add(manifest, null, { loadError: p.error, source: p.path }); continue; }
    let mod = null;
    let loadError;
    try { mod = await importSource(p.source); } catch (e) { loadError = 'import: ' + (e && e.message); }
    host.add(manifest, mod, { enabled: !off.has(manifest.name), loadError, source: p.path });
  }
}

// Dev only: `?plugin=<url of the entry module>`, manifest.json beside it.
async function loadFromQuery() {
  const urls = new URLSearchParams(location.search).getAll('plugin');
  for (const u of urls) {
    const entry = new URL(u, location.href);
    let manifest = { name: 'dev' };
    try {
      manifest = await (await fetch(new URL('manifest.json', entry))).json();
      const mod = await import(/* @vite-ignore */ entry.href);
      host.add(manifest, mod, { source: entry.href });
    } catch (e) {
      host.add(manifest, null, { loadError: String(e && e.message), source: entry.href });
    }
  }
}

export async function loadPlugins() {
  const dev = import.meta.env.DEV && typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('plugin');
  if (!SHELL && !dev) return;
  pluginsUi.active = true;
  if (SHELL) await loadFromShell();
  if (dev) await loadFromQuery();
  pluginsUi.list = host.list();
}
