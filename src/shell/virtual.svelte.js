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
 */
import { createLocalHub } from '../../../Valence/clients/js/index.js';
import builtinUrl from '../../test/fixtures/valencesim-catalog.bin?url';
import { connect, disconnect, machine } from '../model/machine.svelte.js';
import { loadMachine, builtinMachine, hubOptions, catalogStoreFor } from '../model/vault.js';
import { loadStaging, saveStaging, stageEcho } from '../model/merge.js';
import { hubs } from './hubs.svelte.js';

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
