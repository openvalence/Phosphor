/**
 * lan.svelte.js -- Open to LAN: the Virtual's hub on this PC's network. src-tauri/src/lan.rs owns the
 * WebSocket listener and the SPEC 13.8 UDP port; this file carries their bytes to the Neutrino worker
 * (integral-bridge.js) and back. DESKTOP SHELL ONLY, off by default (prefs openToLan, lanPort).
 *
 * Constraints:
 * - A remote is one more session of the Virtual's hub: tiers, pairing and ownership are the hub's, and
 *   discovery replies and ESTOP datagrams are the hub's too (integral_datagram). Nothing here reads a frame.
 * - Up only while the pref is on and the Virtual runs. Going down, lan_stop sends every remote BYE and
 *   closes it first; then, when the hub lives on, each remote's session gets the same BYE, so the hub
 *   runs its full teardown (ownership released) instead of parking the session STALE.
 * - Records to Rust (lan.rs encode/decode): one invoke in flight, the rest coalesced behind it, in order.
 * - Records from Rust arrive on the Channel of the current start only; a stale Channel is ignored.
 */
import { invoke, Channel } from '@tauri-apps/api/core';
import { encodeFrame, FRAME, K, GOODBYE_CODE, WS_SUBPROTOCOL } from '../../../Valence/clients/js/frames.js';
import { cbMap, cbUint } from '../../../Valence/clients/js/cbor.js';
import { DISCOVERY_PORT } from '../../../Valence/clients/js/discover.js';
import { prefs } from '../model/prefs.js';

const DESKTOP = !['android', 'ios'].includes(import.meta.env?.TAURI_ENV_PLATFORM);
const OPEN = 1, MSG = 2, CLOSE = 3, DGRAM = 4, HEAD = 9;
const BYE = encodeFrame(FRAME.GOODBYE, 0, cbMap([[K.code, cbUint(GOODBYE_CODE.NORMAL_CLOSURE)]]));

/** {port, addrs, discovery, remotes, note}: port 0 while closed. */
export const lan = $state({ port: 0, addrs: [], discovery: false, remotes: 0, note: '' });

let bridge = null;      // the running Virtual's bridgeIntegral, else null
let chan = null;        // the current start's Channel
let wanted = { on: false, port: 0 };
let busy = Promise.resolve();
const remotes = new Set();

function record(kind, id, data) {
  const r = new Uint8Array(HEAD + data.length);
  const dv = new DataView(r.buffer);
  dv.setUint8(0, kind);
  dv.setUint32(1, id >>> 0, true);
  dv.setUint32(5, data.length, true);
  r.set(data, HEAD);
  return r;
}

let queue = [], sending = false;
async function toRust(kind, id, data) {
  queue.push(record(kind, id, data));
  if (sending) return;
  sending = true;
  while (queue.length) {
    const parts = queue;
    queue = [];
    const batch = new Uint8Array(parts.reduce((n, r) => n + r.length, 0));
    parts.reduce((o, r) => { batch.set(r, o); return o + r.length; }, 0);
    try { await invoke('lan_send', batch); } catch { /* closed meanwhile */ }
  }
  sending = false;
}

function fromRust(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 0; o + HEAD <= b.length;) {
    const kind = dv.getUint8(o), id = dv.getUint32(o + 1, true), n = dv.getUint32(o + 5, true);
    const data = b.slice(o + HEAD, o + HEAD + n);
    o += HEAD + n;
    if (kind === OPEN) { remotes.add(id); bridge.post({ op: 'open', id }); }
    else if (kind === MSG && remotes.has(id)) bridge.post({ op: 'send', id, data }, [data.buffer]);
    else if (kind === CLOSE && remotes.delete(id)) bridge.post({ op: 'close', id });
    else if (kind === DGRAM) bridge.post({ op: 'dgram', ip: id, port: data[0] | (data[1] << 8), data: data.slice(2), wsPort: lan.port });
  }
  lan.remotes = remotes.size;
}

/** The worker's messages for a remote socket id, and its datagram replies (virtual.svelte.js routes them). */
export function lanFromHost(m) {
  if (m.op === 'dgram') {
    if (lan.port) toRust(DGRAM, m.ip, Uint8Array.of(m.port & 0xff, m.port >> 8, ...m.data));
  } else if (!remotes.has(m.id)) {
    /* not a remote of this start */
  } else if (m.op === 'msg') toRust(MSG, m.id, new Uint8Array(m.data));
  else if (m.op === 'closed') { remotes.delete(m.id); lan.remotes = remotes.size; toRust(CLOSE, m.id, new Uint8Array(0)); }
}

async function start(port) {
  const c = chan = new Channel();
  c.onmessage = (buf) => { if (chan === c && bridge) fromRust(buf); };
  try {
    const up = await invoke('lan_start', { port, udpPort: DISCOVERY_PORT, subprotocol: WS_SUBPROTOCOL, farewell: BYE, events: c });
    if (chan !== c) return;
    Object.assign(lan, { port: up.port, addrs: up.addrs, discovery: up.discovery, note: up.port === port ? '' : port + ' taken' });
  } catch (e) {
    if (chan === c) { chan = null; lan.note = 'Not open: ' + e; }
  }
}

async function stop(endSessions) {
  chan = null;
  const ids = [...remotes];
  remotes.clear();
  Object.assign(lan, { port: 0, addrs: [], discovery: false, remotes: 0 });
  try { await invoke('lan_stop'); } catch { /* never started */ }
  if (endSessions && bridge) {
    for (const id of ids) {
      const bye = BYE.slice();
      bridge.post({ op: 'send', id, data: bye }, [bye.buffer]);
      bridge.post({ op: 'close', id });
    }
  }
}

let lastPort = 0;
// Serialized: a start never overlaps a stop, and a stop always runs before the next start.
function sync() {
  const on = DESKTOP && wanted.on && !!bridge;
  const port = wanted.port;
  busy = busy.then(async () => {
    if (lan.port && (!on || port !== lastPort)) await stop(true);
    if (on && !lan.port && !chan) { lastPort = port; await start(port); }
    if (!on) lan.note = '';
  }).catch((e) => { lan.note = 'Not open: ' + e; });
}

prefs.subscribe((p) => {
  if (p.openToLan === wanted.on && p.lanPort === wanted.port) return;
  wanted = { on: p.openToLan, port: p.lanPort };
  sync();
});

/** The Virtual is up: its bridge (integral-bridge.js), which must expose post(). */
export function lanAttach(b) {
  bridge = b;
  sync();
}

/** The Virtual is stopping: remotes get BYE from Rust; the hub goes with the worker. */
export function lanDetach() {
  bridge = null;
  busy = busy.then(() => (lan.port || chan ? stop(false) : null)).catch(() => {});
}

/** The Virtual's PAIR button, pressed once. */
export function lanPairPress() {
  if (bridge) bridge.post({ op: 'pair' });
}

/** The Virtual's hub boots with its pairing window open unless it will be on the LAN (virtual.svelte.js). */
export const lanWanted = () => DESKTOP && wanted.on;
