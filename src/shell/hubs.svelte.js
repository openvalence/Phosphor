/**
 * hubs.svelte.js -- the shell's discovery and transport: the Scan, the WS or
 * BLE connect, and the BLE-to-WS upgrade. Module state, so it outlives
 * HubsPane.svelte, which only renders it. SHELL ONLY.
 *
 * Constraints:
 * - Shell code, not kernel UI: it may know transports and addresses, but it
 *   NEVER touches machine state; it only picks which transport the one
 *   kernel session rides (DOCTRINE: everything through Valence).
 * - The Scan is UDP first, Bluetooth fallback (operator ruling 2026-10-02 on
 *   RFC-046): the SPEC 13.8 probe runs and lists every reply; only an empty
 *   LAN result runs the BLE scan. No mDNS (RFC-072 ruling, 2026-10-01). The
 *   launch probe is LAN only: it never raises a Bluetooth permission prompt.
 * - This PC's own Neutrino, Open to LAN (lan.svelte.js), is never a LAN row:
 *   dialing it would stop the Neutrino it reaches.
 * - A LAN reply carrying a saved hub's hub_instance_id moves that saved
 *   endpoint, port included. Discovery never adds a saved hub: a hub is saved
 *   once it is live over WiFi (settings-pane.js).
 * - BLE sessions have no HTTP sideband, so no /uitoken: they land at watch
 *   tier by design. Control arrives with the WS upgrade.
 * - A live BLE session hops to WS once, automatically, when WELCOME offers
 *   an endpoint (SPEC 13.1 SHOULD). It hops only after a probe socket
 *   opens, and falls back to BLE if the WS session is not live in time.
 * - Set up a machine (ble-setup.js) rides the same one session: a BLE connect
 *   with the automatic WS hop off, because the flow hops itself once the hub
 *   has joined WiFi. The wizard collects the credentials; this file never
 *   sees them.
 * - shell_mode and shell_host keep their names, and shell_host stays a bare
 *   host: settings-pane.js reads both. The dialed port rides in shell_port
 *   (ph-dwy).
 */
import { untrack } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { startScan, stopScan, checkPermissions } from '@mnlphlp/plugin-blec';
import { WS_SUBPROTOCOL } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { machine, connect, disconnect, hostLabel, getSession } from '../model/machine.svelte.js';
import { setPairedToken } from '../../../Valence/clients/js/index.js';
import { savedHubs } from '../model/prefs.js';
import { makeBleWebSocket, BLE_SERVICE, MTU_FLOOR, bleStats, holdForMigration, releaseHeld } from './ble-ws.js';
import { upgradeTarget, advFlags } from './ble-adv.js';
import { createSetupFlow, setupFirst, SETUP } from './ble-setup.js';
import { isProvisioning } from '../model/provision.js';
import { mergeFound, learnBleId } from './found.js';
import { lan } from './lan.svelte.js';

const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

// The endpoint the operator last dialed, as the host field shows it.
function lastDialed() {
  const host = stored('shell_host');
  return host ? hostLabel(host, Number(stored('shell_port')) || undefined) : '';
}

class Hubs {
  // No baked-in address: discovery is the front door. The field remembers
  // only an endpoint the operator themselves dialed before.
  manualHost = lastDialed();
  mode = $state(stored('shell_mode') || 'ws');
  note = $state('');
  scanning = $state(false);
  finding = $state(false);
  found = $state([]);
  stats = $state('');
  // The scan hit a BLE session rides: its flags gate the upgrade, and it is
  // what a failed upgrade falls back to.
  bleDev = $state(null);
  target = $derived(upgradeTarget({ mode: this.mode, phase: machine.link.phase,
    endpoint: machine.link.endpoint || null, adv: this.bleDev && advFlags(this.bleDev) }));
}
export const hubs = new Hubs();

// Plain, not $state: one automatic attempt per operator-chosen BLE connect,
// so a fallback cannot loop. The manual button stays for a retry.
let upgradeTried = false;
let upgrading = false;
// BLE address -> hub_instance_id, learned from a live BLE session's WELCOME:
// an advertisement carries no identity (SPEC 13.4).
const bleIds = new Map();

$effect.root(() => {
  $effect(() => {
    if (hubs.target && !upgradeTried) { upgradeTried = true; untrack(upgrade); }
  });
  $effect(() => {
    const id = hubs.mode === 'ble' && machine.link.phase === 'live' && machine.link.hubIdentity?.hub_instance_id;
    const dev = hubs.bleDev;
    if (!id || !dev) return;
    untrack(() => {
      bleIds.set(dev.address, id);
      hubs.found = learnBleId(hubs.found, dev.address, id);
    });
  });
  // BLE wire counters, polled: bleStats is a plain module object (the bridge
  // is not reactive code), so a 1 Hz sample into $state is the honest view.
  $effect(() => {
    if (hubs.mode !== 'ble') { hubs.stats = ''; return; }
    const t = setInterval(() => {
      hubs.stats = 'rx ' + bleStats.rx + ' tx ' + bleStats.tx
        + (bleStats.mtu ? ' mtu ' + bleStats.mtu + (bleStats.mtu < MTU_FLOOR ? ' (<' + MTU_FLOOR + ')' : '') : '')
        + (bleStats.lastError ? ' err ' + bleStats.lastError : '');
    }, 1000);
    return () => clearInterval(t);
  });
});

const LAN_SCAN_MS = 1500;
const BLE_SCAN_MS = 6000;
const DISCOVERY_PORT = 22096; // for the empty-result line only; discovery.rs is the home

// A saved hub answering from another endpoint (a moved lease): its saved row
// follows, port included.
function followMoves(replies) {
  const at = new Map(replies.filter((r) => r.hub_instance_id).map((r) => [r.hub_instance_id, r]));
  savedHubs.update((a) => a.map((h) => {
    const r = at.get(h.id);
    return r && (r.ip !== h.host || r.ws_port !== h.port) ? { ...h, host: r.ip, port: r.ws_port } : h;
  }));
}

/** The Scan: the UDP probe, then Bluetooth only when the LAN gave nothing. */
export async function scanHubs({ ble = true } = {}) {
  if (hubs.finding || hubs.scanning) return;
  hubs.finding = true;
  hubs.note = '';
  let got = [];
  let failed = null;
  try { got = await invoke('discover_hubs', { timeoutMs: LAN_SCAN_MS }); } catch (e) { failed = e; }
  const own = lan.port && machine.link.hubIdentity && machine.link.hubIdentity.hub_instance_id;
  got = got.filter((h) => !own || h.hub_instance_id !== own);
  hubs.finding = false;
  if (got.length) {
    hubs.found = mergeFound(hubs.found, got, 'LAN', { bleIds });
    followMoves(got);
    hubs.note = got.length + ' on LAN';
    return;
  }
  hubs.note = failed ? 'LAN discovery failed: ' + failed : 'No LAN reply on UDP ' + DISCOVERY_PORT;
  if (ble) await startBle();
}
// With no remembered endpoint there is nothing else to try, so probe once at launch.
if (!hubs.manualHost) scanHubs({ ble: false });

async function startBle() {
  try {
    await checkPermissions(true);
    hubs.scanning = true;
    let seen = 0;
    await startScan((devices) => {
      // A Valence hub advertises the service UUID in its primary payload
      // (SPEC 13.4). Match on that, never on the name.
      const mine = devices.filter((d) => (d.services || []).some((s) => String(s).toLowerCase() === BLE_SERVICE));
      seen += mine.length;
      hubs.found = mergeFound(hubs.found, mine, 'BLE', { bleIds });
    }, BLE_SCAN_MS);
    setTimeout(() => {
      hubs.scanning = false;
      if (!seen) hubs.note = 'No hub on Bluetooth';
    }, BLE_SCAN_MS + 100);
  } catch (e) {
    hubs.scanning = false;
    hubs.note = 'Bluetooth scan failed: ' + e;
  }
}

/** Scan Bluetooth on demand, LAN or not: a hub in config mode is BLE only (SPEC 13.4.1). */
export async function scan() {
  if (hubs.scanning) { await stopScan().catch(() => {}); hubs.scanning = false; return; }
  if (hubs.finding) return;
  hubs.note = '';
  await startBle();
}

export function pickBle(dev) {
  upgradeTried = false;
  connectBle(dev);
}

async function connectBle(dev) {
  // Never GATT-connect with a scan still running: Android's stack handles
  // it badly, and the scan has done its job the moment a hub is chosen.
  if (hubs.scanning) { await stopScan().catch(() => {}); hubs.scanning = false; }
  disconnect();
  hubs.bleDev = dev;
  hubs.mode = 'ble';
  store('shell_mode', 'ble');
  hubs.note = 'Bluetooth: ' + (dev.name || dev.address) + ' (watch tier)';
  connect({ host: dev.address, bleName: dev.name, WebSocketImpl: makeBleWebSocket(dev.address) });
}

export function connectWs(host, port) {
  if (!host || !host.trim()) { hubs.note = 'Enter a hub address'; return; }
  host = host.trim();
  port = port || 82;
  disconnect();
  hubs.mode = 'ws';
  store('shell_mode', 'ws');
  store('shell_host', host);
  store('shell_port', String(port));
  hubs.note = '';
  connect({ host, port });
}

const WS_PROBE_MS = 3000;
const WS_LIVE_MS = 8000;

// Opens and closes a bare socket: proves the endpoint answers before the
// live BLE session is touched.
function wsReachable(host, port) {
  return new Promise((resolve) => {
    let ws = null;
    const done = (ok) => {
      clearTimeout(timer);
      try { ws?.close(); } catch (e) { /* already closed */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), WS_PROBE_MS);
    try { ws = new WebSocket('ws://' + host + ':' + port + '/', [WS_SUBPROTOCOL]); } catch (e) { done(false); return; }
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
  });
}

async function untilLive(ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    if (machine.link.phase === 'live') return true;
  }
  return false;
}

// Same instance_id on the new transport (the session client persists it),
// so the hub treats the HELLO as a migration (SPEC 6.3), not a newcomer.
export async function upgrade() {
  const t = hubs.target, dev = hubs.bleDev;
  if (!t || !dev || upgrading) return;
  upgrading = true;
  try { await hop(t, dev); } finally { upgrading = false; }
}

async function hop(t, dev) {
  const url = 'ws://' + t.host + ':' + t.port;
  hubs.note = 'Probing ' + url;
  if (!(await wsReachable(t.host, t.port))) { hubs.note = url + ' unreachable, staying on Bluetooth'; return; }
  holdForMigration();
  connectWs(t.host, t.port);
  const live = await untilLive(WS_LIVE_MS);
  await releaseHeld();
  if (live) { hubs.note = 'Upgraded to ' + url; return; }
  hubs.note = 'WiFi upgrade failed, back on Bluetooth';
  connectBle(dev);
}

// ---- Set up a machine (ble-setup.js) ----------------------------------------

const SETUP_WELCOME_MS = 20000;

/** The setup overlay's state: open flag, the chosen hub, and the flow's state. */
export const setup = $state({ open: false, dev: null, st: null, devs: [] });

const flow = createSetupFlow({
  onChange: (s) => { setup.st = s; },
  setToken: (origin, token) => { setPairedToken(origin, token); },
  reach: wsReachable,
  connect: async ({ host, port }) => {
    if (hubs.mode === 'ble' && machine.link.phase === 'live') holdForMigration();
    connectWs(host, port);
    const live = await untilLive(WS_LIVE_MS);
    await releaseHeld();
    return live;
  },
  hubId: () => machine.link.hubIdentity?.hub_instance_id || null,
  rediscover: async (id) => {
    const hit = (await invoke('discover_hubs', { timeoutMs: LAN_SCAN_MS })).find((h) => h.hub_instance_id === id);
    return hit ? { host: hit.ip, port: hit.ws_port } : null;
  },
});
setup.st = flow.state;

$effect.root(() => {
  // Needs-setup hubs first; rows keep scan order inside each group.
  $effect(() => {
    setup.devs = setupFirst(hubs.found.filter((f) => f.ble).map((f) => f.ble), (d) => advFlags(d));
  });
  // A link that never reaches WELCOME or gives up mid-ceremony is the flow's failure.
  $effect(() => {
    const p = machine.link.phase;
    if (!setup.open || setup.st.step !== SETUP.connecting) return;
    if (p === 'retrying' || p === 'failed') untrack(() => flow.failLink('Bluetooth connect failed'));
  });
});

/** Open the overlay and start a Bluetooth scan for hubs. */
export async function openSetup() {
  setup.open = true;
  flow.scanning();
  if (!hubs.scanning && !hubs.finding) await scan();
}

/** Close the overlay; a ceremony that did not finish drops its Bluetooth link. */
export function closeSetup() {
  const step = setup.st.step;
  flow.stop();
  setup.open = false;
  setup.dev = null;
  if (step !== SETUP.done && step !== SETUP.handingOver && step !== SETUP.joined) disconnect();
}

/** Connect to one hub over Bluetooth and ask configure once WELCOME lands. */
export async function startSetup(dev) {
  setup.open = true;
  setup.dev = dev;
  flow.stop();
  flow.connecting(dev.name || dev.address);
  upgradeTried = true;
  await connectBle(dev);
  const s = getSession();
  if (!s) return;
  const timer = setTimeout(() => {
    off();
    if (flow.state.step === SETUP.connecting) flow.failLink('No answer over Bluetooth');
  }, SETUP_WELCOME_MS);
  const off = s.on('welcome', () => {
    clearTimeout(timer);
    off();
    flow.attach(s);
  });
}

/** The failed state's retry; a dropped link reconnects to the same hub. */
export function retrySetup() {
  if (flow.retry() === 'connect' && setup.dev) startSetup(setup.dev);
}

/** Back to the hub list from a failed or finished state. */
export function backToList() {
  flow.stop();
  setup.dev = null;
  disconnect();
  flow.scanning();
}

/** The wizard's action presses: only the provisioning op belongs to the flow. */
export function setupAct(e) {
  if (!isProvisioning(e.action.channelId)) return;
  if (e.phase === 'start') flow.joinBegin(); else flow.joinResult(e);
}
