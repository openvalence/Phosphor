<script>
  /**
   * ShellBar.svelte — the Tauri shell's own chrome: hub discovery + transport
   * control. SHELL ONLY (mounted by main.js's SHELL branch; never in the
   * embedded bundle).
   *
   * Constraints:
   * - This is SHELL chrome, not kernel UI: it may know about transports and
   *   addresses. It must NEVER touch machine state — it only picks which
   *   transport the one kernel session rides (DOCTRINE: everything through
   *   Valence).
   * - BLE sessions have no HTTP sideband, so no /uitoken: they land at watch
   *   tier by design. Control arrives with the WS upgrade.
   * - A live BLE session hops to WS once, automatically, when WELCOME offers
   *   an endpoint (SPEC 13.1 SHOULD). It hops only after a probe socket
   *   opens, and falls back to BLE if the WS session is not live in time.
   */
  import { untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { startScan, stopScan, checkPermissions } from '@mnlphlp/plugin-blec';
  import { WS_SUBPROTOCOL } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import { machine, connect, disconnect } from '../model/machine.svelte.js';
  import HostEntry from '../ui/HostEntry.svelte';
  import { makeBleWebSocket, BLE_SERVICE, MTU_FLOOR, bleStats, holdForMigration, releaseHeld } from './ble-ws.js';
  import { advFlags, upgradeTarget } from './ble-adv.js';

  let scanning = $state(false);
  let hubs = $state([]);
  let finding = $state(false);
  let found = $state([]);
  // The bar publishes its own MEASURED height as --shell-chrome-top so the
  // page reserves exactly that much top padding (style.css's .app) and the
  // LinkBar sticks below it. clientHeight includes padding, so the notch
  // inset this bar absorbs is already in the number. The kernel reads the var
  // with a 0px default and never knows the shell exists.
  //
  // Zeroing --chrome-inset-top is the other half of that: this bar is now the
  // topmost chrome, so it owns the notch and the LinkBar must not pad for the
  // same inset a second time.
  let barH = $state(0);
  $effect(() => {
    const root = document.documentElement.style;
    root.setProperty('--shell-chrome-top', barH + 'px');
    root.setProperty('--chrome-inset-top', '0px');
    return () => {
      root.removeProperty('--shell-chrome-top');
      root.removeProperty('--chrome-inset-top');
    };
  });
  // No baked-in address: discovery is the front door. The input remembers
  // only a host the operator themselves connected to before.
  const manualHost = localStorage.getItem('shell_host') || '';
  let mode = $state(localStorage.getItem('shell_mode') || 'ws');
  let note = $state('');
  let expanded = $state(true);

  const phase = $derived(machine.link.phase);
  const endpoint = $derived(machine.link.endpoint || null);

  // BLE wire counters, polled — bleStats is a plain module object (the bridge
  // is not reactive code), so a 1 Hz sample into $state is the honest view.
  let stats = $state('');
  $effect(() => {
    if (mode !== 'ble') { stats = ''; return; }
    const t = setInterval(() => {
      stats = 'rx ' + bleStats.rx + ' tx ' + bleStats.tx
        + (bleStats.mtu ? ' mtu ' + bleStats.mtu + (bleStats.mtu < MTU_FLOOR ? ' (<' + MTU_FLOOR + ')' : '') : '')
        + (bleStats.lastError ? ' err ' + bleStats.lastError : '');
    }, 1000);
    return () => clearInterval(t);
  });
  // The scan hit a BLE session rides: its flags gate the upgrade, and it is
  // what a failed upgrade falls back to.
  let bleDev = $state(null);
  const target = $derived(
    upgradeTarget({ mode, phase, endpoint, adv: bleDev && advFlags(bleDev) })
  );
  // Plain, not $state: one automatic attempt per operator-chosen BLE connect,
  // so a fallback cannot loop. The manual button stays for a retry.
  let upgradeTried = false;
  $effect(() => {
    if (target && !upgradeTried) {
      upgradeTried = true;
      untrack(() => upgrade());
    }
  });

  // SPEC 13.8 UDP discovery plus 13.7 mDNS, the WS-side front door (DESIGN.md;
  // operator ruling 2026-07-28). The Rust command owns the sockets and the merge;
  // this only renders candidates and hands a click to connectWs.
  const DISCOVERY_PORT = 22096; // for the empty-result line only; discovery.rs is the home
  async function findHubs() {
    if (finding) return;
    finding = true;
    note = '';
    found = [];
    try {
      found = await invoke('discover_hubs', { timeoutMs: 2500 });
      if (found.length === 0) note = 'no hubs answered on UDP ' + DISCOVERY_PORT + ' or mDNS';
    } catch (e) {
      note = 'discovery failed: ' + e;
    } finally {
      finding = false;
    }
  }
  // Discovery is the front door: with no remembered hub there is nothing else
  // to try, so probe once at mount.
  if (!manualHost) findHubs();

  async function scan() {
    if (scanning) { await stopScan().catch(() => {}); scanning = false; return; }
    note = '';
    hubs = [];
    try {
      await checkPermissions(true);
      scanning = true;
      await startScan((devices) => {
        // A Valence hub advertises the service UUID in its primary payload
        // (fw: ValenceBlePort). Match on that, never on the name.
        hubs = devices.filter((d) =>
          (d.services || []).some((s) => String(s).toLowerCase() === BLE_SERVICE));
      }, 6000);
      setTimeout(() => { scanning = false; }, 6100);
    } catch (e) {
      scanning = false;
      note = 'scan failed: ' + e;
    }
  }

  function pickBle(dev) {
    upgradeTried = false;
    connectBle(dev);
  }

  async function connectBle(dev) {
    // Never GATT-connect with a scan still running: Android's stack handles
    // it badly, and the scan has done its job the moment a hub is chosen.
    if (scanning) { await stopScan().catch(() => {}); scanning = false; }
    disconnect();
    bleDev = dev;
    mode = 'ble';
    localStorage.setItem('shell_mode', 'ble');
    note = 'BLE → ' + (dev.name || dev.address) + ' (watch tier until WS upgrade)';
    connect({ host: dev.address, WebSocketImpl: makeBleWebSocket(dev.address) });
  }

  function connectWs(host, port) {
    if (!host || !host.trim()) { note = 'enter a hub address or scan'; return; }
    host = host.trim();
    disconnect();
    mode = 'ws';
    localStorage.setItem('shell_mode', 'ws');
    localStorage.setItem('shell_host', host);
    note = '';
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
  let upgrading = false;
  async function upgrade() {
    const t = target, dev = bleDev;
    if (!t || !dev || upgrading) return;
    upgrading = true;
    try { await hop(t, dev); } finally { upgrading = false; }
  }

  async function hop(t, dev) {
    const url = 'ws://' + t.host + ':' + t.port;
    note = 'probing ' + url;
    if (!(await wsReachable(t.host, t.port))) { note = url + ' unreachable, staying on BLE'; return; }
    holdForMigration();
    connectWs(t.host, t.port);
    const live = await untilLive(WS_LIVE_MS);
    await releaseHeld();
    if (live) { note = 'upgraded → ' + url; return; }
    note = 'WS upgrade failed, back on BLE';
    connectBle(dev);
  }
</script>

<div class="shellbar" class:collapsed={!expanded} bind:clientHeight={barH}>
  <!-- Hangs from the top now: the glyph points toward where tapping moves
       the bar's free edge — down (▾) when collapsed-and-about-to-expand,
       up (▴) when expanded-and-about-to-collapse. -->
  <button class="sb-toggle mono" onclick={() => (expanded = !expanded)}
          aria-label="toggle shell bar">{expanded ? '▴' : '▾'} shell</button>
  {#if expanded}
    <span class="sb-mode mono" data-mode={mode}>{mode.toUpperCase()}</span>
    <span class="sb-phase mono">{phase}</span>

    <button class="sb-btn" onclick={findHubs} disabled={finding}>
      {finding ? 'finding…' : 'find hubs'}
    </button>
    <!-- mDNS-only hits carry no durable id (discovery.rs), so ip:port keys them. -->
    {#each found as f (f.hub_instance_id ?? f.ip + ':' + f.ws_port)}
      <button class="sb-hub ws mono" onclick={() => connectWs(f.ip, f.ws_port)}>
        <span class="hub-name">{f.hub_name || 'hub'}</span>
        <span class="hub-addr">{f.ip}:{f.ws_port}</span>
        <span class="hub-fw">{f.fw_version || '?'}</span>
        {#if f.pairing_window_open}<span class="hub-pair">pairing</span>{/if}
      </button>
    {/each}

    <button class="sb-btn" onclick={scan}>{scanning ? 'stop' : 'scan BLE'}</button>
    {#each hubs as h (h.address)}
      {@const adv = advFlags(h)}
      <button class="sb-hub mono" onclick={() => pickBle(h)}>
        <span class="hub-name">{h.name || 'hub'}</span>
        <span class="hub-addr">{h.address}</span>
        {#if h.rssi}<span class="hub-rssi">{h.rssi} dBm</span>{/if}
        {#if adv?.pairing}<span class="hub-pair">pairing</span>{/if}
        {#if adv?.ws}<span class="hub-pair">WS</span>{/if}
      </button>
    {/each}
    {#if scanning && hubs.length === 0}<span class="sb-note">scanning…</span>{/if}

    <span class="sb-sep"></span>
    <HostEntry dense recent={false} label="WS" value={manualHost} onpick={connectWs} />

    {#if target}
      <button class="sb-btn sb-upgrade" onclick={upgrade}>
        ↑ WS {target.host}:{target.port}
      </button>
    {/if}
    {#if note}<span class="sb-note">{note}</span>{/if}
    {#if stats}<span class="sb-note mono">{stats}</span>{/if}
  {/if}
</div>

<style>
  .shellbar {
    position: fixed;
    /* TOPMOST chrome. It must be, and the offset must be 0: `.app` reserves
       this bar's measured height as its own padding-top, which pushes the
       LinkBar down by exactly that much. Offsetting the bar as well
       double-counts — it lands over the LinkBar's lower half (drawing behind
       it) with dead space above and below. */
    top: 0;
    left: 0;
    right: 0;
    z-index: 21; /* above the LinkBar's stacking (20): it scrolls under this */
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    /* Topmost chrome owns the notch inset (style.css --chrome-inset-top),
       and the $effect above zeroes that var so the LinkBar stops padding for
       it. No inset-bottom: this never touches the bottom edge, SafetyBar
       owns that exclusively. */
    padding: calc(4px + env(safe-area-inset-top, 0px)) 10px 4px;
    background: color-mix(in srgb, var(--bg-raised) 94%, transparent);
    border-bottom: 1px solid var(--line);
    font-size: 0.72rem;
    color: var(--ink-dim);
  }
  .collapsed {
    padding: 0 10px;
    background: color-mix(in srgb, var(--bg-raised) 70%, transparent);
    border-bottom: none;
  }
  .sb-toggle {
    color: var(--ink-faint);
    font-size: 0.68rem;
    padding: 3px 4px;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .sb-toggle:hover { color: var(--ink); }
  .sb-mode {
    padding: 4px 7px;
    border-radius: var(--radius);
    font-weight: 700;
    background: var(--bg-card);
    border: 1px solid var(--line);
  }
  .sb-mode[data-mode='ws'] {
    border-color: color-mix(in srgb, var(--reality) 45%, var(--line));
    color: var(--reality);
  }
  .sb-mode[data-mode='ble'] {
    border-color: color-mix(in srgb, var(--intent) 45%, var(--line));
    color: var(--intent);
  }
  .sb-phase { color: var(--ink-dim); }
  .sb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 0 12px;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 12.5px;
  }
  .sb-btn:hover { border-color: var(--line-4); }
  .sb-upgrade {
    border-color: color-mix(in srgb, var(--reality) 45%, var(--line));
    background: color-mix(in srgb, var(--reality) 12%, var(--bg-card));
    color: var(--reality);
  }
  .sb-hub {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 12px;
    gap: 7px;
    background: var(--bg-card);
    border: 1px dashed color-mix(in srgb, var(--intent) 55%, var(--line));
    border-radius: var(--radius);
    color: var(--intent);
  }
  .sb-hub .hub-name { font-weight: 600; }
  .sb-hub .hub-addr { color: var(--ink-dim); }
  .sb-hub .hub-rssi { color: var(--ink-faint); }
  .sb-hub .hub-fw { color: var(--ink-faint); }
  .sb-hub .hub-pair { color: var(--reality); font-weight: 600; }
  /* Solid border: a WS candidate from UDP discovery, not a BLE scan hit. */
  .sb-hub.ws { border-style: solid; }
  .sb-sep { flex: 0 0 8px; }
  .sb-note { color: var(--ink-faint); font-style: italic; font-size: 11px; }
</style>
