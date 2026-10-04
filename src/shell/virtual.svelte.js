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
 * - Desktop: the built-in machine is valencesim, a sidecar the shell runs
 *   (src-tauri/src/virtual_sim.rs). It is a real hub on loopback, joined by
 *   the normal WS connect; only its origin marks it (onSim). It stops on any
 *   disconnect. Without the sidecar (mobile, a build without it) the
 *   built-in machine is the replay below.
 */
import { untrack } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createLocalHub } from '../../../Valence/clients/js/index.js';
import builtinUrl from '../../test/fixtures/valencesim-catalog.bin?url';
import { connect, disconnect, machine } from '../model/machine.svelte.js';
import { loadMachine, builtinMachine, hubOptions, catalogStoreFor } from '../model/vault.js';
import { loadStaging, saveStaging, stageEcho } from '../model/merge.js';
import { hubs } from './hubs.svelte.js';

/** The running sidecar: {host, port, http, version, etag}, else null. */
export const sim = $state({ info: null });

/** The live link is the sidecar's endpoint. */
export function onSim() {
  const l = machine.link, i = sim.info;
  return !!i && l.phase !== 'idle' && l.host === i.host && l.port === i.port;
}

$effect.root(() => {
  $effect(() => {
    const l = machine.link, i = sim.info;
    if (i && (l.phase === 'idle' || l.host !== i.host || l.port !== i.port)) {
      untrack(() => { sim.info = null; invoke('virtual_stop').catch(() => {}); });
    }
  });
});

const LEVEL = { T: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };   // registry log_levels
listen('virtual-log', ({ payload }) => {
  const m = /^\[([TDIWEF])\] ?(.*)$/.exec(payload) || [null, 'I', payload];
  const ring = machine.events.log;
  ring.push({ channel: null, channelName: 'sim', at: Date.now(), body: { level: LEVEL[m[1]], tag: 'sim', message: m[2] } });
  if (ring.length > 400) ring.splice(0, ring.length - 400);
}).catch(() => {});
// The sim ended on its own: drop its session rather than retry a dead port.
listen('virtual-exit', () => { if (onSim()) disconnect(); sim.info = null; }).catch(() => {});

// Desktop: start the sidecar and dial it like a LAN hub. False when there is
// no sidecar to start.
async function openSim() {
  let info;
  try { info = await invoke('virtual_start'); } catch (e) {
    console.warn('valencesim sidecar unavailable, replaying the catalog:', e);
    return false;
  }
  disconnect();
  hubs.mode = 'ws';
  hubs.note = '';
  connect({ host: info.host, port: info.port, http: info.http });
  sim.info = info;
  return true;
}

/** {machineKey: {uid: staged}}, persisted under merge.js MERGE_KEY. */
export const staging = $state(loadStaging());

export function persistStaging() {
  saveStaging($state.snapshot(staging));
}

// The build inlines the fixture as a data URL; the shell's CSP has no data:
// in connect-src, so it is decoded here, never fetched. Dev serves a path.
async function builtinBytes() {
  if (builtinUrl.startsWith('data:')) {
    const b = atob(builtinUrl.slice(builtinUrl.indexOf(',') + 1));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(await (await fetch(builtinUrl)).arrayBuffer());
}

/**
 * Open Virtual Valence on a remembered machine's vault record, or on the
 * built-in machine when `key` is null.
 * @param {string|null} key vault.js key (prefs.js hubKey)
 * @param {string} [name] the name the picker shows for it
 */
export async function openVirtual(key = null, name = '') {
  if (!key && await openSim()) return;
  const m = key ? loadMachine(key) : builtinMachine(await builtinBytes());
  if (!m) { hubs.note = 'No cached catalog for that hub'; return; }
  disconnect();
  hubs.mode = 'virtual';
  hubs.note = '';
  const hub = createLocalHub(hubOptions(m));
  connect({
    host: 'virtual.' + m.key,
    virtual: { key: m.key, name: key ? (name || m.name || m.key) : '' },
    WebSocketImpl: hub.WebSocket,
    catalogStore: catalogStoreFor(m),
    onEcho: (ch, echo) => {
      const fields = (machine.catalog.model && machine.catalog.model.fields) || [];
      if (stageEcho(staging, m.key, fields, ch, (echo && echo.applied) || {})) persistStaging();
    },
  });
}
