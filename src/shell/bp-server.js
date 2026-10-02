// bp-server.js -- the embedded buttplug server's client side: the Tauri IPC
// contract (docs/BUTTPLUG.md), the write lifecycle for every command, and the
// degrade when the commands are missing. SHELL ONLY; plain JS so the node test
// drives it with a fake invoke/listen.
//
// Constraints:
// - Ground truth: `running` and `scanning` change ONLY from bp_status or a
//   bp://status event. A request is pending until that echo agrees (RENDERING
//   §8.1 ladder: pending, overdue, fault, settled, each with a text reason).
// - A command with no status echo (stop all, settings) is confirmed by its own
//   answer: settings show what bp_settings_set saved, never what was asked.
// - A device-config command (rename, disconnect, forget) or a client
//   disconnect is pending until the device or client list agrees with it,
//   whichever list (event or re-read) arrives.
// - A missing command (Rust side not built in, or no Tauri at all) degrades
//   to `ready: false` with a reason. Nothing here throws to the caller.

export const BP_PORT = 12345;
export const ECHO_MS = 4000;
/** A scan the pane starts stops itself after this long. */
export const SCAN_S = 30;
const LOG_KEEP = 500;

export const LEVELS = ['error', 'warn', 'info', 'debug'];
/** The lines at `level` or more severe. */
export const logAt = (log, level) => log.filter((l) => LEVELS.indexOf(l.level) <= LEVELS.indexOf(level));
/** Plain text for the clipboard: ISO time (when the line has one), level, message. */
export const logText = (lines) =>
  lines.map((l) => (l.time != null ? new Date(l.time).toISOString() + ' ' : '') + l.level.toUpperCase() + ' ' + l.msg).join('\n');

const count = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');

/** The status line: unavailable, off, or where it listens with its client and connected-device counts. */
export function statusLine(s) {
  if (!s.ready) return 'unavailable';
  if (!s.running) return 'off';
  return 'on 127.0.0.1:' + s.port + ' · ' + count(s.clients, 'client') + ' · '
    + count(s.devices.filter((d) => d.connected).length, 'device');
}

export const blank = () => ({
  ready: false,
  reason: 'asking the shell for the server…',
  running: false,
  port: BP_PORT,
  clients: 0,
  scanning: false,
  devices: [],
  conns: [],
  log: [],
  // The latest error-level log line since the last start request.
  fault: '',
  copy: { phase: 'settled', reason: '' },
  run: { want: null, phase: 'settled', reason: '' },
  scan: { want: null, phase: 'settled', reason: '' },
  stopAll: { phase: 'settled', reason: '' },
  settings: null,
  set: { phase: 'settled', reason: '' },
  // Per-device ladders and sensor readings, keyed by op id.
  ops: {},
  reads: {},
});

const msg = (e) => String(e?.message ?? e);

// `s` is mutated in place: a $state proxy in ServerPane, a plain object in
// the test.
export function createBp(s, { invoke, listen }, { echoMs = ECHO_MS } = {}) {
  const timers = {};
  const unlisten = [];
  const waits = new Map();   // op id -> (s) => agrees
  let disposed = false;

  function ladder(map, id) {
    if (!map[id]) map[id] = { phase: 'settled', reason: '' };
    return map[id];
  }

  function overdue(w, key, what) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      if (w.phase === 'pending') Object.assign(w, { phase: 'overdue', reason: 'no ' + what + ' after ' + echoMs / 1000 + ' s' });
    }, echoMs);
  }

  function checkWaits() {
    for (const [id, agrees] of waits) {
      if (!agrees(s)) continue;
      waits.delete(id);
      clearTimeout(timers['op:' + id]);
      Object.assign(s.ops[id], { phase: 'settled', reason: '' });
    }
  }
  function setDevices(d) { s.devices = d || []; checkWaits(); }
  function setConns(c) { s.conns = c || []; checkWaits(); }

  async function op(id, pending, cmd, args, fail, agrees, [reread, set] = ['bp_devices', setDevices]) {
    const w = ladder(s.ops, id);
    if (!s.ready || !s.running || w.phase === 'pending') return;
    Object.assign(w, { phase: 'pending', reason: pending });
    overdue(w, 'op:' + id, 'confirmation');
    waits.set(id, agrees);
    try {
      await invoke(cmd, args);
    } catch (e) {
      waits.delete(id);
      clearTimeout(timers['op:' + id]);
      Object.assign(w, { phase: 'fault', reason: fail + ': ' + msg(e) });
      return;
    }
    try { set(await invoke(reread)); } catch (e) { /* the event may still confirm */ }
  }

  const find = (d, key) => d.find((x) => x.key === key);

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
    overdue(w, key, 'answer');
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

  // A reading is a fresh answer each time; a failed one keeps the last value
  // with the reason (law 8).
  async function read(dev, c) {
    const id = dev.key + ':' + c.feature + ':' + c.type;
    const w = ladder(s.reads, id);
    if (!s.running) return;
    const v = await ack(w, 'read:' + id, 'reading ' + c.type.toLowerCase(), 'bp_toy_read',
      { index: dev.index, feature: c.feature, input: c.type }, 'read failed');
    if (typeof v === 'number') w.value = v;
  }

  async function copyLog(level, clip = globalThis.navigator?.clipboard) {
    const w = s.copy;
    const lines = logAt(s.log, level);
    if (!clip?.writeText) { Object.assign(w, { phase: 'fault', reason: 'copy failed: no clipboard here' }); return; }
    Object.assign(w, { phase: 'pending', reason: 'copying' });
    try {
      await clip.writeText(logText(lines));
      Object.assign(w, { phase: 'settled', reason: 'copied ' + lines.length + (lines.length === 1 ? ' line' : ' lines') });
    } catch (e) {
      Object.assign(w, { phase: 'fault', reason: 'copy failed: ' + msg(e) });
    }
  }

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
    try { setDevices(await invoke('bp_devices')); } catch (e) { /* bp://devices fills it */ }
    try { setConns(await invoke('bp_clients')); } catch (e) { /* bp://clients fills it */ }
    try { s.settings = await invoke('bp_settings'); } catch (e) { s.set.reason = 'settings unavailable: ' + msg(e); }
    const on = {
      'bp://status': applyStatus,
      'bp://devices': setDevices,
      'bp://clients': setConns,
      'bp://log': (l) => {
        s.log = [...s.log, l].slice(-LOG_KEEP);
        if (l?.level === 'error') s.fault = l.msg;
      },
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
    start(port = s.settings?.port ?? BP_PORT) {
      s.fault = '';
      return request('run', true, 'bp_start', { port });
    },
    stop: () => request('run', false, 'bp_stop'),
    scan: (on) => (on ? request('scan', true, 'bp_scan_start', { seconds: SCAN_S }) : request('scan', false, 'bp_scan_stop')),
    rename(key, name) {
      const want = String(name ?? '').trim() || null;
      return op('rename:' + key, want ? 'saving the name ' + want : 'going back to the protocol name',
        'bp_device_rename', { key, name: want }, 'rename failed', (x) => (find(x.devices, key)?.display_name ?? null) === want);
    },
    disconnect: (dev) => op('disconnect:' + dev.key, 'disconnecting', 'bp_device_disconnect', { index: dev.index },
      'disconnect failed', (x) => !find(x.devices, dev.key)?.connected),
    forget: (key) => op('forget:' + key, 'forgetting', 'bp_device_forget', { key }, 'forget failed', (x) => !find(x.devices, key)),
    kick: (c) => op('kick:' + c.id, 'disconnecting ' + (c.name ?? c.address), 'bp_client_disconnect', { id: c.id },
      'disconnect failed', (x) => !x.conns.some((y) => y.id === c.id), ['bp_clients', setConns]),
    read,
    stopAll,
    saveSettings,
    copyLog,
    dispose() {
      disposed = true;
      Object.values(timers).forEach(clearTimeout);
      unlisten.splice(0).forEach((off) => off());
    },
  };
}
