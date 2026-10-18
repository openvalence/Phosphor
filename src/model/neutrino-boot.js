/**
 * neutrino-boot.js -- starts Neutrino, the built-in machine, in its worker and resolves once it is up. The shell's
 * Virtual Valence (shell/virtual.svelte.js) and the web builds (web/web.js) both start it here.
 *
 * Constraints:
 * - Its log lines go to the device log ring under BUILTIN_MACHINE_NAME; its state blob persists in localStorage
 *   under STATE_KEY.
 * - `on` receives every host message other than up, down, log and state (Open to LAN's, shell/lan.svelte.js).
 * - The caller owns the returned worker: stopping the machine is terminating it.
 */
import NeutrinoWorker from './neutrino.worker.js?worker&inline';
import { WASM } from './neutrino/bytes.js';
import { bridgeNeutrino } from './neutrino-bridge.js';
import { BUILTIN_MACHINE_NAME } from './builtin.js';
import { machine } from './machine.svelte.js';

export const STATE_KEY = 'phosphor.builtin.state';

const LEVEL = { T: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };   // registry log_levels
function logLine(line) {
  const m = /^\[([TDIWEF])\] ?(.*)$/.exec(line) || [null, 'I', line];
  const ring = machine.events.log;
  ring.push({ channel: null, channelName: BUILTIN_MACHINE_NAME, at: Date.now(), body: { level: LEVEL[m[1]], tag: BUILTIN_MACHINE_NAME, message: m[2] } });
  if (ring.length > 400) ring.splice(0, ring.length - 400);
}

function loadState() {
  try {
    const b = localStorage.getItem(STATE_KEY);
    return b ? Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) : null;
  } catch { return null; }
}
function saveState(blob) {
  let s = '';
  for (const b of blob) s += String.fromCharCode(b);
  try { localStorage.setItem(STATE_KEY, btoa(s)); } catch { /* no storage: the next boot is a new hub */ }
}

/**
 * @param {object} opts neutrino_create options ({homed, pairing_window})
 * @param {(m: object) => void} [on]
 * @returns {{worker: Worker, bridge: object, up: Promise<{version: string, etag: string}>}}
 */
export function bootNeutrino(opts, on = () => {}) {
  const worker = new NeutrinoWorker();
  let bridge;
  const up = new Promise((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || 'worker failed'));
    bridge = bridgeNeutrino(worker, (m) => {
      if (m.op === 'up') resolve(m);
      else if (m.op === 'down') reject(new Error(m.error));
      else if (m.op === 'log') logLine(m.line);
      else if (m.op === 'state') saveState(m.blob);
      else on(m);
    });
  });
  // WASM: the bundles' base64 string, or the web builds' promise of the fetched file (vite.config.js wasmAsset).
  // A copy each boot: boot transfers the buffer to the worker.
  const wasm = typeof WASM === 'string' ? Promise.resolve(Uint8Array.from(atob(WASM), (c) => c.charCodeAt(0)))
    : WASM.then((b) => new Uint8Array(b.slice(0)));
  const booted = wasm.then((w) => bridge.boot(w, loadState(), opts));
  return { worker, bridge, up: booted.then(() => up) };
}
