/**
 * shell-build.mjs -- the Tauri shell's bundle for browser tests: main.js's
 * SHELL branch with the real ShellStrip and Drawer, built as the Tauri CLI
 * would (TAURI_ENV_PLATFORM set). TAURI_STUB stands in for the Rust half:
 * every command rejects, so the shell runs degraded, exactly as it does with
 * a command missing. Test-only; nothing here ships.
 */
import { build } from 'vite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildShellPage() {
  const out = mkdtempSync(join(tmpdir(), 'shell-bundle-'));
  process.env.TAURI_ENV_PLATFORM = 'windows';
  try {
    await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
      build: { outDir: out, emptyOutDir: true } });
    return readFileSync(join(out, 'index.html'));
  } finally {
    delete process.env.TAURI_ENV_PLATFORM;
    rmSync(out, { recursive: true, force: true });
  }
}

// Same shape as @tauri-apps/api/mocks.js mockWindows + mockIPC; an init
// script, so it runs before the bundle.
export function TAURI_STUB() {
  let id = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    invoke: (cmd) => Promise.reject('stub: ' + cmd + ' not available'),
    transformCallback: () => ++id,
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}
