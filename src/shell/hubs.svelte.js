/**
 * hubs.svelte.js -- the shell's discovery and transport: UDP discovery, BLE
 * scan, the WS or BLE connect, and the BLE-to-WS upgrade. Module state, so it
 * outlives HubsPane.svelte, which only renders it. SHELL ONLY.
 *
 * Constraints:
 * - Shell code, not kernel UI: it may know transports and addresses, but it
 *   NEVER touches machine state; it only picks which transport the one
 *   kernel session rides (DOCTRINE: everything through Valence).
 * - BLE sessions have no HTTP sideband, so no /uitoken: they land at watch
 *   tier by design. Control arrives with the WS upgrade.
 * - A live BLE session hops to WS once, automatically, when WELCOME offers
 *   an endpoint (SPEC 13.1 SHOULD). It hops only after a probe socket
 *   opens, and falls back to BLE if the WS session is not live in time.
 * - shell_mode and shell_host keep their names: settings-pane.js reads them.
 */
import { untrack } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { startScan, stopScan, checkPermissions } from '@mnlphlp/plugin-blec';
import { WS_SUBPROTOCOL } from '../../../Valence/clients/js/generated/registry_vocab.js';
import { machine, connect, disconnect } from '../model/machine.svelte.js';
import { makeBleWebSocket, BLE_SERVICE, MTU_FLOOR, bleStats, holdForMigration, releaseHeld } from './ble-ws.js';
import { advFlags, upgradeTarget } from './ble-adv.js';

const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

class Hubs {
  // No baked-in address: discovery is the front door. The field remembers
  // only a host the operator themselves connected to before.
  manualHost = stored('shell_host') || '';
  mode = $state(stored('shell_mode') || 'ws');
  note = $state('');
  scanning = $state(false);
  ble = $state([]);
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

$effect.root(() => {
  $effect(() => {
    if (hubs.target && !upgradeTried) { upgradeTried = true; untrack(upgrade); }
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

// SPEC 13.8 UDP discovery, the WS-side front door (operator ruling
// 2026-07-28). The Rust command owns the socket and the dedupe.
const DISCOVERY_PORT = 22096; // for the empty-result line only; discovery.rs is the home
export async function findHubs() {
  if (hubs.finding) return;
  hubs.finding = true;
  hubs.note = '';
  hubs.found = [];
  try {
    hubs.found = await invoke('discover_hubs', { timeoutMs: 2500 });
    if (hubs.found.length === 0) hubs.note = 'no hubs answered on UDP ' + DISCOVERY_PORT;
  } catch (e) {
    hubs.note = 'discovery failed: ' + e;
  } finally {
    hubs.finding = false;
  }
}
// With no remembered hub there is nothing else to try, so probe once at launch.
if (!hubs.manualHost) findHubs();

export async function scan() {
  if (hubs.scanning) { await stopScan().catch(() => {}); hubs.scanning = false; return; }
  hubs.note = '';
  hubs.ble = [];
  try {
    await checkPermissions(true);
    hubs.scanning = true;
    await startScan((devices) => {
      // A Valence hub advertises the service UUID in its primary payload
      // (fw: ValenceBlePort). Match on that, never on the name.
      hubs.ble = devices.filter((d) =>
        (d.services || []).some((s) => String(s).toLowerCase() === BLE_SERVICE));
    }, 6000);
    setTimeout(() => { hubs.scanning = false; }, 6100);
  } catch (e) {
    hubs.scanning = false;
    hubs.note = 'scan failed: ' + e;
  }
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
  hubs.note = 'BLE → ' + (dev.name || dev.address) + ' (watch tier until WS upgrade)';
  connect({ host: dev.address, bleName: dev.name, WebSocketImpl: makeBleWebSocket(dev.address) });
}

export function connectWs(host, port) {
  if (!host || !host.trim()) { hubs.note = 'enter a hub address or scan'; return; }
  host = host.trim();
  disconnect();
  hubs.mode = 'ws';
  store('shell_mode', 'ws');
  store('shell_host', host);
  hubs.note = '';
  connect({ host, port: port || 82 });
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
  hubs.note = 'probing ' + url;
  if (!(await wsReachable(t.host, t.port))) { hubs.note = url + ' unreachable, staying on BLE'; return; }
  holdForMigration();
  connectWs(t.host, t.port);
  const live = await untilLive(WS_LIVE_MS);
  await releaseHeld();
  if (live) { hubs.note = 'upgraded → ' + url; return; }
  hubs.note = 'WS upgrade failed, back on BLE';
  connectBle(dev);
}
