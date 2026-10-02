// bp-server.js -- the embedded buttplug server's client side: the Tauri IPC
// contract (docs/BUTTPLUG.md), the write lifecycle for its two toggles, and the
// degrade when the commands are missing. SHELL ONLY; plain JS so the node test
// drives it with a fake invoke/listen.
//
// Constraints:
// - Ground truth: `running` and `scanning` change ONLY from bp_status or a
//   bp://status event. A request is pending until that echo agrees (RENDERING
//   §8.1 ladder: pending, overdue, fault, settled, each with a text reason).
// - A command with no status echo (stop all, settings) is confirmed by its own
//   answer: settings show what bp_settings_set saved, never what was asked.
// - A missing command (Rust side not built in, or no Tauri at all) degrades
//   to `ready: false` with a reason. Nothing here throws to the caller.

export const BP_PORT = 12345;
export const ECHO_MS = 4000;
const LOG_KEEP = 50;

export const blank = () => ({
  ready: false,
  reason: 'asking the shell for the server…',
  running: false,
  port: BP_PORT,
  clients: 0,
  scanning: false,
  devices: [],
  log: [],
  run: { want: null, phase: 'settled', reason: '' },
  scan: { want: null, phase: 'settled', reason: '' },
  stopAll: { phase: 'settled', reason: '' },
  settings: null,
  set: { phase: 'settled', reason: '' },
});

const msg = (e) => String(e?.message ?? e);

// `s` is mutated in place: a $state proxy in ServerPane, a plain object in
// the test.
export function createBp(s, { invoke, listen }, { echoMs = ECHO_MS } = {}) {
  const timers = {};
  const unlisten = [];
  let disposed = false;

  function settle(k, actual) {
    const w = s[k];
    if (w.want === null || w.want !== actual) return;
    clearTimeout(timers[k]);
    Object.assign(w, { want: null, phase: 'settled', reason: '' });
  }

  function applyStatus(st) {
    if (!st) return;
    s.running = !!st.running;
    if (st.port) s.port = st.port;
    s.clients = st.clients | 0;
    s.scanning = !!st.scanning;
    settle('run', s.running);
    settle('scan', s.scanning);
  }

  async function request(k, want, cmd, args) {
    if (!s.ready || s[k].phase === 'pending') return;
    const w = s[k];
    Object.assign(w, { want, phase: 'pending', reason: 'waiting for the server to confirm' });
    clearTimeout(timers[k]);
    timers[k] = setTimeout(() => {
      if (w.want === want && w.phase === 'pending') {
        Object.assign(w, { phase: 'overdue', reason: 'no confirmation after ' + echoMs / 1000 + ' s' });
      }
    }, echoMs);
    try {
      await invoke(cmd, args);
    } catch (e) {
      clearTimeout(timers[k]);
      Object.assign(w, { want: null, phase: 'fault', reason: cmd + ' failed: ' + msg(e) });
      return;
    }
    // The command returning is not the echo; a fresh status read is.
    try { applyStatus(await invoke('bp_status')); } catch (e) { /* the event may still confirm */ }
  }

  // A command whose own answer is the confirmation. A rejection, or a resolved
  // string, is a fault with that text. Resolves to the answer, or undefined.
  async function ack(w, key, pending, cmd, args, fail, done = '') {
    if (!s.ready || w.phase === 'pending') return undefined;
    Object.assign(w, { phase: 'pending', reason: pending });
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      if (w.phase === 'pending') Object.assign(w, { phase: 'overdue', reason: 'no answer after ' + echoMs / 1000 + ' s' });
    }, echoMs);
    let r, err = null;
    try { r = await invoke(cmd, args); if (typeof r === 'string') err = r; } catch (e) { err = msg(e); }
    clearTimeout(timers[key]);
    if (err != null) { Object.assign(w, { phase: 'fault', reason: fail + ': ' + err }); return undefined; }
    Object.assign(w, { phase: 'settled', reason: done });
    return r ?? null;
  }

  // The server's ack (every device's write acknowledged, bounded at 1 s
  // server-side) is the confirmation.
  const stopAll = () => s.running
    ? ack(s.stopAll, 'stopAll', 'stopping every toy', 'bp_stop_all', undefined, 'stop all failed', 'all toys stopped')
    : undefined;

  async function saveSettings(patch) {
    if (!s.settings) return;
    const r = await ack(s.set, 'set', 'saving ' + Object.keys(patch).join(', ').replaceAll('_', ' '),
      'bp_settings_set', { settings: { ...s.settings, ...patch } }, 'not saved');
    if (r) s.settings = r;
  }

  async function init() {
    try {
      applyStatus(await invoke('bp_status'));
    } catch (e) {
      s.ready = false;
      s.reason = 'server not available in this build: ' + msg(e);
      return;
    }
    s.ready = true;
    s.reason = '';
    try { s.devices = await invoke('bp_devices'); } catch (e) { /* bp://devices fills it */ }
    try { s.settings = await invoke('bp_settings'); } catch (e) { s.set.reason = 'settings unavailable: ' + msg(e); }
    const on = {
      'bp://status': applyStatus,
      'bp://devices': (d) => { s.devices = d || []; },
      'bp://log': (l) => { s.log = [...s.log, l].slice(-LOG_KEEP); },
    };
    for (const [ev, fn] of Object.entries(on)) {
      try {
        const off = await listen(ev, (e) => fn(e.payload));
        if (disposed) off(); else unlisten.push(off);
      } catch (e) { /* no event bus: the status re-read after each command still settles */ }
    }
  }

  return {
    init,
    start: (port = s.settings?.port ?? BP_PORT) => request('run', true, 'bp_start', { port }),
    stop: () => request('run', false, 'bp_stop'),
    scan: (on) => request('scan', on, on ? 'bp_scan_start' : 'bp_scan_stop'),
    stopAll,
    saveSettings,
    dispose() {
      disposed = true;
      Object.values(timers).forEach(clearTimeout);
      unlisten.splice(0).forEach((off) => off());
    },
  };
}
