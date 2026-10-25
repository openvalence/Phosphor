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
 * - The built-in machine is the Nucleus twin compiled to wasm (neutrino.worker.js), on every platform. It
 *   is a full hub joined by the normal connect over an in-page socket; only its host marks it (onSim). It
 *   stops on any disconnect, never on a hidden page; its state blob persists (model/neutrino-boot.js).
 * - Open to LAN (lan.svelte.js) shares this hub while it runs. Opened to the LAN, it boots with its pairing
 *   window closed: the Pairing window button is the gesture, never a stranger's race to the boot window.
 */
import { untrack } from 'svelte';
import { createLocalHub } from '../../../Valence/clients/js/index.js';
import { bootNeutrino } from '../model/neutrino-boot.js';
import { BUILTIN_MACHINE_NAME } from '../model/builtin.js';
import { connect, disconnect, getSession, machine } from '../model/machine.svelte.js';
import { loadMachine, hubOptions, catalogStoreFor } from '../model/vault.js';
import { catalogCache } from '../model/catalog-cache.js';
import { loadStaging, saveStaging, stageEcho } from '../model/merge.js';
import { hubs } from './hubs.svelte.js';
import { lanAttach, lanDetach, lanFromHost, lanWanted } from './lan.svelte.js';

const HOST = 'builtin';

/** The running built-in machine: {version, etag}, else null. */
export const sim = $state({ info: null });
let worker = null;

/** The live link is the built-in machine. */
export function onSim() {
  const l = machine.link;
  return !!sim.info && l.phase !== 'idle' && l.host === HOST;
}

function stopSim() {
  lanDetach();
  if (worker) worker.terminate();
  worker = null;
  sim.info = null;
}

$effect.root(() => {
  $effect(() => {
    const l = machine.link;
    // A hidden page's idle keeps its session (machine.svelte.js, the alt-tab problem) and comes back to this machine.
    if (sim.info && (l.host !== HOST || (l.phase === 'idle' && !getSession()))) untrack(stopSim);
  });
});

// Homed with the pairing window open at boot (the twin has no PAIR button): the shell's knock lands as
// push-to-pair and the pairing persists in the state blob.
async function openSim() {
  disconnect();
  stopSim();
  const { worker: w, bridge, up } = bootNeutrino({ homed: true, pairing_window: !lanWanted() }, lanFromHost);
  worker = w;
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
  lanAttach(bridge);
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
  await catalogCache.ready;
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
