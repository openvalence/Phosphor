/**
 * buttplug-toys.js -- toys the embedded buttplug server finds, as placeable
 * plugin-hero modules on the built-in `buttplug` adapter (DESIGN §10.2, §10.8).
 *
 * Constraints:
 * - Plain JS: test/buttplug-toys.test.mjs drives it with a fake invoke/listen.
 *   The Svelte half (src/ui/hero/ToyModule.svelte) is reached only through
 *   toyModules' `render`.
 * - A shown value is what the server applied: a bp://output observation or an
 *   acked command, never the control's own position (law 4), and nothing until
 *   one arrives (law 9). While a command is in flight the control shows it,
 *   with the ladder saying so in words (law 5).
 * - Toys are not hub safety: the strip e-stop does not reach them. Each module
 *   has its own stop, and bp_stop_all stops every toy. Faults are amber text,
 *   never red (law 13).
 * - Hero ids are the server's stable `key`, never the device index (law 10).
 * See: docs/BUTTPLUG.md
 */

export const ECHO_MS = 4000;
export const READ_MS = 30000;

const CMD = { scalar: 'bp_toy_scalar', rotate: 'bp_toy_rotate', linear: 'bp_toy_linear' };
const msg = (e) => String(e?.message ?? e);

/** Minimum footprint in builder cells: a head row plus one row per control. */
export function toyCells(toy) {
  const n = Math.min(20, Math.max(1, toy.controls.length));
  return { h: [6, 2 + n], v: [4, 2 + 2 * n] };
}

/**
 * Register one hero per connected toy and withdraw it when the server stops
 * listing it. A toy whose listing changes is re-registered (remounted).
 * @param {Object} api the plugin API (registerHero returns a withdraw function)
 * @param {{invoke: Function, listen: Function}} shell
 * @param {(el: Element, toy: Object) => {unmount?: Function}} render
 * @returns {() => void} withdraw everything
 */
export function toyModules(api, shell, render) {
  const live = new Map();   // key -> {sig, off}
  let closed = false;
  let heard = false;
  let unlisten = null;

  function sync(devices) {
    if (closed) return;
    const seen = new Set();
    for (const toy of devices || []) {
      if (toy.kind !== 'toy' || !toy.key || toy.connected === false) continue;
      seen.add(toy.key);
      const sig = JSON.stringify(toy);
      const had = live.get(toy.key);
      if (had && had.sig === sig) continue;
      if (had) had.off();
      const off = api.registerHero({
        id: toy.key, title: toy.name, spec: {}, absorb: false, cells: toyCells(toy),
        mount: (el) => render(el, toy),
      });
      live.set(toy.key, { sig, off });
    }
    for (const [k, v] of live) if (!seen.has(k)) { v.off(); live.delete(k); }
  }

  shell.listen('bp://devices', (e) => { heard = true; sync(e.payload); })
    .then((off) => (closed ? off() : (unlisten = off)))
    .catch((e) => api.log('bp://devices: ' + msg(e), 'error'));
  // An event that beat this reply is newer than it.
  shell.invoke('bp_devices').then((d) => { if (!heard) sync(d); })
    .catch((e) => api.log('bp_devices: ' + msg(e), 'warn'));

  return () => {
    closed = true;
    if (unlisten) unlisten();
    for (const v of live.values()) v.off();
    live.clear();
  };
}

const ctlKey = (c) => c.feature + ':' + c.type;

/** Initial module state: no value until the server reports one. */
export function blankToy(toy) {
  const ctl = {};
  for (const c of toy.controls) {
    ctl[ctlKey(c)] = { value: null, want: null, phase: 'settled', reason: '', stale: false };
  }
  return { ctl, stop: { phase: 'settled', reason: '' } };
}

/** The value a control shows: the in-flight request while pending, else the applied value. */
export function shown(w) {
  return w.phase === 'pending' || w.phase === 'overdue' ? w.want : w.value;
}

/**
 * One toy module's commands and echoes. `s` (from blankToy) is mutated in
 * place: a $state proxy in ToyModule, a plain object in the test.
 */
export function createToy(s, toy, { invoke, listen }, { echoMs = ECHO_MS, readMs = READ_MS } = {}) {
  const timers = new Map();
  const queued = new Map();
  const offs = [];
  let disposed = false;
  let poll = null;
  const ctls = new Map(toy.controls.map((c) => [ctlKey(c), c]));

  function overdueAfter(k, w) {
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => {
      if (w.phase === 'pending') Object.assign(w, { phase: 'overdue', reason: 'no answer from the server after ' + echoMs / 1000 + ' s' });
    }, echoMs));
  }

  function args(c, value, ms) {
    const a = { index: toy.index, feature: c.feature };
    if (c.kind === 'rotate') a.speed = value;
    else if (c.kind === 'linear') Object.assign(a, { position: value, ms });
    else a.value = value;
    return a;
  }

  async function fire(c, value, ms) {
    const k = ctlKey(c);
    const w = s.ctl[k];
    Object.assign(w, { want: value, phase: 'pending', reason: 'sent, waiting for the server' });
    overdueAfter(k, w);
    try {
      await invoke(CMD[c.kind], args(c, value, ms));
    } catch (e) {
      clearTimeout(timers.get(k));
      queued.delete(k);
      Object.assign(w, { want: null, phase: 'fault', reason: 'refused: ' + msg(e) });
      return;
    }
    clearTimeout(timers.get(k));
    if (disposed) return;
    w.value = value;
    const next = queued.get(k);
    queued.delete(k);
    if (next) fire(c, ...next);
    else Object.assign(w, { want: null, phase: 'settled', reason: 'applied' });
  }

  /** Command one control. Latest wins: one request in flight, one queued. */
  function send(c, value, ms) {
    const k = ctlKey(c);
    const w = s.ctl[k];
    if (w.phase === 'pending' || w.phase === 'overdue') { w.want = value; queued.set(k, [value, ms]); return; }
    fire(c, value, ms);
  }

  async function stop() {
    queued.clear();
    const w = s.stop;
    Object.assign(w, { phase: 'pending', reason: 'stopping' });
    overdueAfter('stop', w);
    try {
      await invoke('bp_toy_stop', { index: toy.index });
      Object.assign(w, { phase: 'settled', reason: 'stopped' });
    } catch (e) {
      Object.assign(w, { phase: 'fault', reason: 'stop refused: ' + msg(e) });
    }
    clearTimeout(timers.get('stop'));
  }

  async function read(c) {
    const w = s.ctl[ctlKey(c)];
    try {
      w.value = await invoke('bp_toy_read', { index: toy.index, feature: c.feature, input: c.type });
      Object.assign(w, { stale: false, phase: 'settled', reason: '' });
    } catch (e) {
      // The last reading stays on screen, dimmed: freshness is part of truth (law 8).
      Object.assign(w, { stale: true, phase: 'fault', reason: 'read failed: ' + msg(e) });
    }
  }

  const readAll = () => { for (const c of toy.controls) if (c.kind === 'sensor') read(c); };

  // Applied outputs from any client (an app, a stop, this module).
  function onOutput(p) {
    if (!p || p.index !== toy.index) return;
    const c = ctls.get(p.feature + ':' + p.type);
    if (c) s.ctl[ctlKey(c)].value = p.value;
  }

  async function init() {
    try {
      const off = await listen('bp://output', (e) => onOutput(e.payload));
      if (disposed) off(); else offs.push(off);
    } catch (e) { /* no event bus: acks still settle each command */ }
    if (disposed || !toy.controls.some((c) => c.kind === 'sensor')) return;
    readAll();
    poll = setInterval(readAll, readMs);
  }

  return {
    init, send, stop, read,
    dispose() {
      disposed = true;
      clearInterval(poll);
      for (const t of timers.values()) clearTimeout(t);
      offs.splice(0).forEach((off) => off());
    },
  };
}
