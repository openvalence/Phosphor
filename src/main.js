/**
 * main.js — the entry point, and the whole Tauri seam.
 *
 * Everything device-specific about "how do I reach the machine and prove who I
 * am" is decided in this file and nowhere else. The device-hosted bundle infers
 * the host from location and mints a token over same-origin HTTP; a Tauri shell
 * overrides those two things and gets an identical UI. That is the "~15 lines
 * apart" promise, and it only holds because everything above this file is
 * generic — the page renders whatever catalog the hub sends, so it has no other
 * reason to care which machine it is talking to.
 */

import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';
import { connect, machine, parseHost, recentHubs } from './model/machine.svelte.js';
import { applyStoredTheme } from './model/theme.js';
import './ui/still.svelte.js';
import { loadPlugins } from './plugins/plugins.svelte.js';
import { bindControls } from './plugins/kit.js';
import { mountBound } from './ui/BoundControl.svelte';

// api.ui.field and api.ui.module draw the shell's own controls (docs/PLUGINS.md, Field-bound controls).
bindControls(mountBound);

// Client preferences, applied before first paint so the page never flashes the
// default palette. These are BROWSER state, not machine state — the
// ground-truth doctrine does not apply and nothing here is sent to the device.
applyStoredTheme();
try {
  if (localStorage.getItem('ui_hivis') === '1') document.documentElement.classList.add('hivis');
  if (localStorage.getItem('ui_terse') === '1') document.documentElement.classList.add('terse');
} catch (e) { /* private mode: preferences are an optimization, never a requirement */ }

// Whatever served this bundle IS the machine's front door: the hub hosts
// this page and /uitoken, and its Valence WS lives on the same host. So both
// URLs derive from `location`: the host from location.hostname here, the WS
// port from connect()'s default 82, and the mint from a SAME-ORIGIN relative
// /uitoken (the protocol client's mintUrl() picks the relative form whenever
// host === location.hostname, which is exactly this case). Nothing about a
// particular device is baked in — a literal IP here would work on one bench
// and nowhere else.
//
// Except inside the Tauri shell, where the host is the operator's choice and
// /uitoken minting runs through the shell's Rust-side fetch (no browser
// same-origin rules). TAURI_ENV_PLATFORM is set only by the Tauri CLI's
// build, so the embedded bundle compiles this branch away entirely.
const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;

// A boot step's failure lands in the device log ring (the Log tab) so the
// shell shows it; console.error alone is invisible in the exe.
function bootFault(step, e) {
  const msg = step + ' failed to load: ' + ((e && e.message) || String(e));
  console.error(msg, e);
  const ring = machine.events.log;
  ring.push({ channel: null, channelName: 'plugin', at: Date.now(), body: { level: 4, tag: 'shell', message: msg } });   // 4 = error (registry log_levels)
}

async function boot() {
  // ?hub=<host> points THIS page at a hub other than its own origin. It is
  // the DEV override and the only one: `vite dev` serves from localhost, so
  // `?hub=<device>` is how a dev session reaches a real machine (/uitoken
  // stays same-origin-only, so such a session lands at watch tier, which is
  // honest). Harmless on the served page: absent parameter, origin rules as
  // always. It is also what the hub picker (ui/HubPicker.svelte) writes, so a
  // hosted page reloads onto the hub its operator chose. No hardcoded
  // fallback: an empty hostname (a file:// open) falls back only to a hub
  // this browser itself reached before, else to the picker, never to a guess
  // about someone else's network.
  const hubOverride = new URLSearchParams(location.search).get('hub');
  const { host, port } = parseHost(hubOverride || location.hostname || recentHubs()[0] || '');
  if (SHELL) {
    // Each shell step fails on its own: one failed import costs that step and
    // a log line, never the window chrome below (seen twice on 2026-10-03).
    await Promise.all([import('@tauri-apps/plugin-http'), import('../../Valence/clients/js/index.js')])
      .then(([{ fetch: tauriFetch }, { setHttpGet }]) => setHttpGet(async (url) => {
        const r = await tauriFetch(url, { method: 'GET' });
        return r.ok ? await r.text() : null;
      }))
      .catch((e) => bootFault('http get', e));
    // RFC-053: every e-stop press also broadcasts the ESTOP datagram on the
    // LAN, before any connect, so the first press is covered.
    await Promise.all([import('@tauri-apps/api/core'), import('./shell/estop-udp.js'), import('./shell/virtual.svelte.js')])
      .then(([{ invoke }, m, v]) => m.installEstopDatagram({
        invoke, isVirtual: () => !!machine.link.virtual || v.onSim(), origin: () => machine.link.roles,
      }))
      .catch((e) => bootFault('datagram e-stop', e));
    // NO baked-in host: discovery IS the shell's front door (operator ruling,
    // 2026-07-28). Auto-connect only re-joins a saved hub, at its saved
    // host:port, when the reconnect preference is on (shell/settings-pane.js).
    await import('./shell/settings-pane.js').catch((e) => bootFault('saved hubs', e));
    // Shell chrome (the window buttons at the end of the kernel's top bar)
    // is handed in from here so the served bundle never carries it. One
    // retry: a chunk fetch that fails on a cold start usually succeeds at once.
    return import('./shell/ShellStrip.svelte')
      .catch(() => import('./shell/ShellStrip.svelte'))
      .then((m) => m.default);
  }
  if (host) connect({ host, port });
  return null;
}
// Tier-2 plugins: shell plugins folder, or ?plugin= in a dev build; a no-op on
// the page a hub serves. See docs/PLUGINS.md.
loadPlugins();
// The embedded buttplug server's machine rides the same host (docs/BUTTPLUG.md).
if (SHELL) import('./plugins/buttplug.js').then((m) => m.loadButtplug()).catch((e) => console.error('buttplug bridge failed to load', e));

// Shell: the webview's errors reach the Rust log file (lib.rs js_log), so a
// field failure on any platform is readable without devtools.
if (SHELL) {
  import('@tauri-apps/api/core').then(({ invoke }) => {
    // Re-entrancy guard plus a swallowed rejection: a failing js_log must never
    // become the next console.error or unhandled rejection it would forward.
    let busy = false;
    const send = (level, parts) => {
      if (busy) return;
      busy = true;
      try {
        const msg = parts.map((p) => (p instanceof Error ? (p.stack || p.message) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ').slice(0, 2000);
        Promise.resolve(invoke('js_log', { level, msg })).catch(() => {}).finally(() => { busy = false; });
      } catch { busy = false; }
    };
    for (const level of ['error', 'warn']) { const orig = console[level].bind(console); console[level] = (...a) => { orig(...a); send(level, a); }; }
    window.addEventListener('error', (e) => send('error', ['uncaught:', e.message, e.filename + ':' + e.lineno]));
    window.addEventListener('unhandledrejection', (e) => send('error', ['unhandled rejection:', e.reason]));
  }).catch(() => {});
}

// The page mounts whatever boot() does: a failed shell import costs the
// window controls, never the strip's e-stop.
boot()
  .catch((e) => { bootFault('shell chrome', e); return null; })
  .then((shell) => mount(App, { target: document.getElementById('app'), props: { shell } }));
