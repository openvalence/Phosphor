/**
 * external.js -- the one door out of the app: every link that leaves it asks
 * first (the shared confirm, ConfirmLayer.svelte), then opens in the system
 * browser (the shell's opener plugin) or a new tab (a browser build).
 *
 * Constraints:
 * - Nothing else opens an external URL: ExtLink.svelte, the plugins' openUrl,
 *   the reports and the credits all route here.
 * - https only in the shell (capabilities/default.json scopes the opener).
 * - The confirm names the destination as host and path, no query or hash.
 */
// confirm.svelte.js loads on the first open: this file stays plain JS for the node suites that import its callers.

const SHELL = !!import.meta.env?.TAURI_ENV_PLATFORM;

/** "Open link?" with the destination: true once handed to the browser, null on Cancel, false when it could not open.
 *  `target` is a browser build's window name. */
export async function openExternal(url, target = '_blank') {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const where = u.host + u.pathname.replace(/\/$/, '');
  const { askConfirm } = await import('./confirm.svelte.js');
  if (!(await askConfirm({ title: 'Open link?', body: where, confirmLabel: 'Open link' }))) return null;
  if (SHELL) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('plugin:opener|open_url', { url: u.href }).then(() => true, () => false);
  }
  // noopener makes window.open return null even when it opened: no failure to read here.
  window.open(u.href, target, target === '_blank' ? 'noopener' : undefined);
  return true;
}
