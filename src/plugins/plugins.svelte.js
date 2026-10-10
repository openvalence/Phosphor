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

import { createPluginHost, isHubUrl } from './host.js';
import PluginSlot from './PluginSlot.svelte';
import { machine, getSession, freshness, staleReason } from '../model/machine.svelte.js';
import {
  writeSetting, runAction, sendCommand, submitMotion, submitSegments, submitSamples, displayValue, statusOf, shadowOf, shadows,
} from '../model/shadow.svelte.js';
import { bumpAll, seq, watch } from '../model/changes.js';
import { WIDGET, isFieldEnabled, modTargetUid } from '../model/settings.js';
import { needsConfirm, settingNeedsConfirm, confirmCopy, railOwners, railOwned } from '../model/actions.js';
import { streamGate, conflictWords, latchWords } from '../model/motion.js';
import { askConfirm } from '../ui/confirm.svelte.js';
import { pendingSlots, enumerateStore, storeOfRoster, rosterOfStore, rosterCount } from '../ui/widgets/roster.js';
import { registerTheme } from '../model/theme.js';
import { FACTORY } from './factory.js';
import { KIT } from './kit.js';
import { hubKey } from '../model/prefs.js';
import { view } from '../model/viewport.svelte.js';
import {
  LOG_LEVEL_NAME, CHANNEL_CLASS, CH_CONTROL_OWNER, CH_SETTINGS_TRIAL, FIELD_ROLE, TRIAL_OP,
} from '../../../Valence/clients/js/index.js';
import { STORE_OP } from '../../../Valence/clients/js/generated/registry_vocab.js';

const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
const DISABLED_KEY = 'phosphor.plugins.disabled';
const LOG_MAX = 400;
const LEVEL = Object.fromEntries(Object.entries(LOG_LEVEL_NAME).map(([n, name]) => [name, Number(n)]));

/** Reactive mirror of the host for the pane and the claim pass; `docks` counts dock registrations (Dock.svelte). */
export const pluginsUi = $state({ gen: 0, docks: 0, list: [], active: false, dir: '' });

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

// RENDERING §10.2 items 2 and 4: a plugin requests, the host confirms.
const CANCELED = { ok: false, error: 'canceled' };
/** The write door every plugin write and the context menu take: confirm first where the host would. */
export async function write(field, value, payload) {
  if (!field) return { ok: false, error: 'no field' };
  if (field.widget === WIDGET.action) {
    if (needsConfirm(field, value) && !(await askConfirm(confirmCopy(field, value)))) return CANCELED;
    const roster = rosterOf(field);
    const before = roster && machine.samples[roster.id];
    const r = await runAction(field, value, payload || null);
    if (roster && r && r.ok && value !== STORE_OP.load) storeOpRoster.set(roster.id, before);
    return r;
  }
  if (field.isIntentField) return sendCommand(field, value);
  const from = displayValue(field, machine.samples[field.channelId]);
  if (settingNeedsConfirm(field, from, value) && !(await askConfirm(confirmCopy(field, value)))) return CANCELED;
  return writeSetting(field, value);
}

// Law 3: the reasons Field.svelte and ActionField.svelte name, in their order.
// A c2h STREAM field is motion input: streamGate's reasons, `busy` last.
export function gate(field, busy = '') {
  const se = entryOf(field.channelId);
  if (se && se.cls === CHANNEL_CLASS.STREAM && se.dirName === 'c2h') {
    return streamGate({
      live: machine.link.phase === 'live', roles: machine.link.roles, access: se.access,
      halted: latchWords(machine.safety), running: railOwned(machine.catalog.model?.byRole, machine.samples), busy,
    });
  }
  if (machine.link.phase !== 'live') return 'no hub link';
  const s = getSession();
  if (field.widget === WIDGET.action) {
    return s && s.canUse(field.channelId, field.key) ? '' : 'session not authorized';
  }
  if (field.readOnly) return 'read-only: the machine reports this, it is not a setting';
  const e = entryOf(field.isIntentField ? field.channelId : field.writeChannel);
  if (!e || (machine.link.roles | 0) < (e.access | 0)) return 'session not authorized';
  if (!field.isIntentField && !isFieldEnabled(field, machine.samples[field.channelId])) {
    return 'disabled by the machine';
  }
  return '';
}

// By id, per catalog (a new catalog is a new entries array): gate() runs on
// every plugin tick, and a find() walks the catalog's state proxies (ph-3w4u).
const entryIds = new WeakMap();
function entryOf(id) {
  const entries = machine.catalog.entries || [];
  let m = entryIds.get(entries);
  if (!m) entryIds.set(entries, (m = new Map(entries.map((e) => [e.id, e]))));
  return m.get(id) || null;
}

// RFC-066: the modulator entry's mod_target, as a uid (settings.js).
const modTarget = (field) => modTargetUid(machine.catalog.entries || [], field.channelId);

const storeOf = (field) => storeOfRoster(machine.catalog.entries || [], entryOf(field.channelId));
const rosterOf = (field) => rosterOfStore(machine.catalog.entries || [], storeOf(field));

// A store op's ECHO lands before the hub's roster push, so a read right after
// one waits for the roster to move instead of trusting the old count.
const storeOpRoster = new Map();   // roster id -> its sample before the op

// RFC-070: the writer's store_id names the STORE; slots read as roster.js
// reads them (pending, locked and empty stay distinct). Null when unlinked.
async function storeSlots(field) {
  const store = storeOf(field);
  if (!store) return null;
  const slots = pendingSlots(store);
  const s = getSession();
  if (!s || machine.link.phase !== 'live') return slots;
  const roster = rosterOf(field);
  if (roster && storeOpRoster.has(roster.id)) {
    const before = storeOpRoster.get(roster.id);
    storeOpRoster.delete(roster.id);
    // ponytail: a 20 ms poll capped at 1 s; a reactive wait if this ever shows.
    for (let i = 0; i < 50 && machine.samples[roster.id] === before; i++) await new Promise((r) => setTimeout(r, 20));
  }
  const count = roster ? rosterCount(roster, machine.samples[roster.id]) : null;
  // A granted roster not yet sampled: stay pending, the caller reads again.
  if (count == null && roster && machine.grants[roster.id]) return slots;
  await enumerateStore(s.fetchBlob, store, { role: machine.link.roles, count, onSlot: (r) => { slots[r.slot] = r; } });
  return slots;
}

// RFC-099: the hub keeps a trial unstored iff it declares settings-trial.
const trialCapable = () => (machine.catalog.entries || []).some((e) => e.id === CH_SETTINGS_TRIAL);
// The ops act on this session's own trials; the op key is the channel's one field.
const TRIAL_ACTION = { channelId: CH_SETTINGS_TRIAL, key: 1, label: 'Trial' };
// Any session's trial, as the machine reports it on its meta.trial_pending fields. By the role index, never a
// catalog walk: the player's status reads this every tick (ph-3w4u).
function trialPending() {
  const bits = machine.catalog.model?.byRole.get(FIELD_ROLE.meta_trial_pending) || [];
  return bits.some((f) => { const s = machine.samples[f.channelId]; return !!(s && s[f.name]); });
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

// The shell's HTTP plugin answers without CORS; vite dev uses the page's fetch.
async function shellFetch(url, init) {
  const { fetch } = await import('@tauri-apps/plugin-http');
  return fetch(url, init);
}

// api.changed: what gate(), statusOf(), displayValue()'s shadow, freshness() and a write refusal read beyond a
// channel's own samples (which bump in machine.svelte.js). A change bumps every channel. An effect: it runs on a
// change, never per frame. roleChannels is the catalog's role -> channel ids, plain, for api.changed(role).
let roleChannels = new Map(), roleSrc = null;
const NO_CHANNELS = Object.freeze([]);
$effect.root(() => {
  const owned = $derived(railOwned(machine.catalog.model?.byRole, machine.samples));
  $effect(() => {
    const l = machine.link;
    void l.phase; void l.roles; void l.stale; void l.staleTick; void l.openedAt; void l.sessionId;
    void machine.safety; void owned;
    for (const k in shadows) { const s = shadows[k]; void s.status; void s.requested; void s.error; }
    const byRole = machine.catalog.model?.byRole;
    if (byRole !== roleSrc) {
      roleSrc = byRole;
      roleChannels = new Map([...(byRole || [])].map(([r, fs]) => [r, [...new Set(fs.map((f) => f.channelId))]]));
    }
    bumpAll();
  });
});

export const host = createPluginHost({
  model: () => machine.catalog.model,
  sample: (ch) => machine.samples[ch],
  sampleAge: (ch) => (machine.sampleTs[ch] ? Date.now() - machine.sampleTs[ch] : Infinity),
  changed: (x) => seq(typeof x === 'string' ? roleChannels.get(x) || NO_CHANNELS : x),
  // Roles resolve at each move, so a new catalog's channels count without a new watch.
  onChanged: (list, fn) => watch((ch) => {
    for (const x of list) if (typeof x === 'string' ? (roleChannels.get(x) || NO_CHANNELS).includes(ch) : x === ch) return true;
    return false;
  }, fn),
  display: displayValue,
  status: statusOf,
  write,
  trialCapable,
  writeTrial: (field, value, noTrial) => writeSetting(field, value, { trial: true, noTrial }),
  session: () => machine.link.sessionId,
  trialOp: (op) => runAction(TRIAL_ACTION, TRIAL_OP[op]),
  trialPending,
  gate,
  stale: (field) => staleReason(freshness(field.channelId)) || '',
  reason: (field) => (shadowOf(field) || {}).error || '',
  modTarget,
  storeSlots,
  submitMotion,
  // A SOURCE_CONFLICT NACK names the foreign owner: the gate never reads control-owner.
  submitSegments: (list) => {
    const r = submitSegments(list);
    return r.ok ? r : { ...r, reason: conflictWords(r.reason,
      railOwners(entryOf(CH_CONTROL_OWNER), machine.samples[CH_CONTROL_OWNER]), machine.link.sessionId) };
  },
  submitSamples,
  now: () => performance.now(),
  registerTheme,
  listenTcp: SHELL ? listenTcp : null,
  fetch: SHELL ? shellFetch : (import.meta.env.DEV && typeof window !== 'undefined' ? window.fetch.bind(window) : null),
  isHub: (u) => isHubUrl(u, machine.link.host, machine.link.port),
  hub: currentHub,
  prefs: typeof localStorage !== 'undefined' ? localStorage : null,
  ui: KIT,
  // No right dock on the phone class (DESIGN §10.13); read inside Dock's derived, so it tracks.
  dockable: () => !view.phone,
  log: logLine,
});

// Every add consults the disabled set unless the caller decides, so a plugin
// added outside the loaders below (buttplug.js, graph.js) keeps its disable
// across launches.
const addRaw = host.add;
host.add = (manifest, mod, opts = {}) => addRaw(manifest, mod,
  { enabled: !disabledSet().has(manifest && manifest.name), ...opts });

host.onChange(() => {
  pluginsUi.list = host.list();
  pluginsUi.gen++;
});
host.onDocks(() => { pluginsUi.docks++; });

/** The connected hub's key (prefs.js hubKey), null before a catalog: per-hub plugin state keys on it. */
export function currentHub() {
  return machine.link.host && machine.catalog.ready ? hubKey(machine.link.hubIdentity, machine.link.host, machine.link.port) : null;
}

/** Active plugin heroes, ready for heroes.js's claim pass. */
export function pluginHeroes() {
  return host.heroes().map((h) => ({ ...h, component: PluginSlot, host }));
}

/** Active plugin docks, mounted through PluginSlot like a page (Dock.svelte). */
export function pluginDocks() {
  return host.docks().map((d) => ({ ...d, component: PluginSlot, host }));
}

/** Shown plugin pages, mounted through PluginSlot like a hero. */
export function pluginPages() {
  return host.pages().map((p) => ({ ...p, component: PluginSlot, host }));
}

/** The operator's choice, not the status: an enabled plugin may be in error. */
export function isPluginDisabled(name) {
  return disabledSet().has(name);
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

// Factory plugins ship inside the bundle; a same-named plugin folder loaded
// after them replaces one (host.add keys on the name).
function loadFactory() {
  for (const p of FACTORY) host.add(p.manifest, p.module, { source: 'factory' });
}

async function loadFromShell() {
  const { invoke } = await import('@tauri-apps/api/core');
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
    host.add(manifest, mod, { loadError, source: p.path });
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
  if (SHELL) { loadFactory(); await loadFromShell(); }
  if (dev) await loadFromQuery();
  await import('./graph.js').then((m) => m.loadGraph(host)).catch((e) => logLine('graph', 'error', 'load: ' + (e && e.message)));
  pluginsUi.list = host.list();
}
