/**
 * virtual.svelte.js -- Virtual Valence: a machine replayed from the vault on
 * an in-page hub (Valence createLocalHub), and the merge staging its setting
 * writes feed. SHELL ONLY.
 *
 * Constraints:
 * - Rides the normal connect() with WebSocketImpl set to the local hub, so
 *   every pane, the builder, plugins, the graph and the strip work unchanged
 *   (the Prime Rule: through Valence, never around it). Opens no socket.
 * - Never remembered, never auto-connected, never the reconnect target: no
 *   shell_host or shell_mode write, and settings-pane.js saves no virtual hub.
 * - Staging takes only what the virtual hub ECHOed (merge.js).
 * - The built-in machine is the Nucleus twin compiled to wasm (integral.worker.js), on every platform. It
 *   is a full hub joined by the normal connect over an in-page socket; only its host marks it (onSim). It
 *   stops on any disconnect; its state blob persists in localStorage under STATE_KEY.
 */
import { untrack } from 'svelte';
import { createLocalHub } from '../../../Valence/clients/js/index.js';
import IntegralWorker from '../model/integral.worker.js?worker&inline';
import { WASM } from '../model/integral/bytes.js';
import { bridgeIntegral } from '../model/integral-bridge.js';
import { BUILTIN_MACHINE_NAME } from '../model/builtin.js';
import { connect, disconnect, machine } from '../model/machine.svelte.js';
import { loadMachine, hubOptions, catalogStoreFor } from '../model/vault.js';
import { loadStaging, saveStaging, stageEcho } from '../model/merge.js';
import { hubs } from './hubs.svelte.js';

const HOST = 'builtin';
const STATE_KEY = 'phosphor.builtin.state';

/** The running built-in machine: {version, etag}, else null. */
export const sim = $state({ info: null });
let worker = null;

/** The live link is the built-in machine. */
export function onSim() {
  const l = machine.link;
  return !!sim.info && l.phase !== 'idle' && l.host === HOST;
}

function stopSim() {
  if (worker) worker.terminate();
  worker = null;
  sim.info = null;
}

$effect.root(() => {
  $effect(() => {
    const l = machine.link;
    if (sim.info && (l.phase === 'idle' || l.host !== HOST)) untrack(stopSim);
  });
});

const LEVEL = { T: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };   // registry log_levels
function logLine(line) {
  const m = /^\[([TDIWEF])\] ?(.*)$/.exec(line) || [null, 'I', line];
  const ring = machine.events.log;
  ring.push({ channel: null, channelName: BUILTIN_MACHINE_NAME, at: Date.now(), body: { level: LEVEL[m[1]], tag: BUILTIN_MACHINE_NAME, message: m[2] } });
  if (ring.length > 400) ring.splice(0, ring.length - 400);
}

function loadState() {
  try {
    const b = localStorage.getItem(STATE_KEY);
    return b ? Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) : null;
  } catch { return null; }
}
function saveState(blob) {
  let s = '';
  for (const b of blob) s += String.fromCharCode(b);
  try { localStorage.setItem(STATE_KEY, btoa(s)); } catch { /* no storage: the next boot is a new hub */ }
}

// Homed with the pairing window open at boot (the twin has no PAIR button): the shell's knock lands as
// push-to-pair and the pairing persists in the state blob.
async function openSim() {
  disconnect();
  stopSim();
  const w = worker = new IntegralWorker();
  let bridge;
  const up = new Promise((resolve, reject) => {
    w.onerror = (e) => reject(new Error(e.message || 'worker failed'));
    bridge = bridgeIntegral(w, (m) => {
      if (m.op === 'up') resolve(m);
      else if (m.op === 'down') reject(new Error(m.error));
      else if (m.op === 'log') logLine(m.line);
      else if (m.op === 'state') saveState(m.blob);
    });
  });
  bridge.boot(Uint8Array.from(atob(WASM), (c) => c.charCodeAt(0)), loadState(), { homed: true, pairing_window: true });
  let info;
  try { info = await up; } catch (e) {
    if (worker === w) stopSim();
    hubs.note = BUILTIN_MACHINE_NAME + ' failed: ' + e.message;
    return;
  }
  if (worker !== w) return;
  hubs.mode = 'ws';
  hubs.note = '';
  connect({ host: HOST, label: BUILTIN_MACHINE_NAME, WebSocketImpl: bridge.WebSocket, token: bridge.token });
  sim.info = { version: info.version, etag: info.etag };
}

/** {machineKey: {uid: staged}}, persisted under merge.js MERGE_KEY. */
export const staging = $state(loadStaging());

export function persistStaging() {
  saveStaging($state.snapshot(staging));
}

/**
 * Open Virtual Valence on a remembered machine's vault record, or the
 * built-in machine when `key` is null.
 * @param {string|null} key vault.js key (prefs.js hubKey)
 * @param {string} [name] the name the picker shows for it
 */
export async function openVirtual(key = null, name = '') {
  if (!key) return openSim();
  const m = loadMachine(key);
  if (!m) { hubs.note = 'No cached catalog for that hub'; return; }
  disconnect();
  hubs.mode = 'virtual';
  hubs.note = '';
  const hub = createLocalHub(hubOptions(m));
  connect({
    host: 'virtual.' + m.key,
    virtual: { key: m.key, name: name || m.name || m.key },
    WebSocketImpl: hub.WebSocket,
    catalogStore: catalogStoreFor(m),
    onEcho: (ch, echo) => {
      const fields = (machine.catalog.model && machine.catalog.model.fields) || [];
      if (stageEcho(staging, m.key, fields, ch, (echo && echo.applied) || {})) persistStaging();
    },
  });
}
