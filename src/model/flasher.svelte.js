/**
 * flasher.svelte.js -- the one flasher (DESIGN §10.19): its state and its
 * shell transport. The flow is firmware.js's.
 *
 * Constraints:
 * - The state lives here, not in the card: the link drops while the machine
 *   restarts and the System page may re-render under the flow.
 * - Shell only. The page's fetch cannot reach a hub (CSP, CORS); the HTTP
 *   plugin's fetch carries arm, status, /diag and GitHub, and
 *   `ota_upload` (src-tauri/src/ota.rs) streams the image with progress.
 */
import { blank, createFlasher } from './firmware.js';

export const flash = $state(blank());

const pluginFetch = async (url, method) => {
  const { fetch } = await import('@tauri-apps/plugin-http');
  const r = await fetch(url, { method, signal: AbortSignal.timeout(8000) });
  return { status: r.status, text: await r.text() };
};

const net = {
  get: (url) => pluginFetch(url, 'GET'),
  post: (url) => pluginFetch(url, 'POST'),
  async upload(host, id, bytes, onSent) {
    const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
    const unlisten = await listen('ota-progress', (e) => onSent(e.payload));
    try {
      const [status, text] = await invoke('ota_upload', bytes, { headers: { 'x-ota-host': host, 'x-ota-id': id } });
      return { status, text };
    } finally { unlisten(); }
  },
};

export const flasher = createFlasher(flash, net);
