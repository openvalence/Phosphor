/**
 * external.js -- the one door out of the app: every link that leaves it asks
 * first (the shared confirm, ConfirmLayer.svelte; F1 twice is its own ask,
 * docs.js), then opens in the system
 * browser (the shell's opener plugin) or a new tab (a browser build).
 *
 * Constraints:
 * - Nothing else opens an external URL: ExtLink.svelte, the plugins' openUrl,
 *   the reports and the credits all route here.
 * - http and https only (capabilities/default.json scopes the opener; the confirm is the safeguard).
 * - The confirm names the destination as host and path, no query or hash.
 * - Never over another confirm: with one pending, the link is not asked (null).
 */
// confirm.svelte.js loads on the first open: this file stays plain JS for the node suites that import its callers.

const SHELL = !!import.meta.env?.TAURI_ENV_PLATFORM;

/** "Open link?" with the destination: true once handed to the browser, null on Cancel, false when it could not open.
 *  `target` is a browser build's window name; `ask: false` only where the user already confirmed (docs.js, F1 twice). */
export async function openExternal(url, target = '_blank', { ask = true } = {}) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (ask) {
    const where = u.host + u.pathname.replace(/\/$/, '');
    // A link never displaces a pending confirm (a hazard write's): it waits for that answer, and this ask is dropped.
    const { askConfirm, confirmUi } = await import('./confirm.svelte.js');
    if (confirmUi.req) return null;
    if (!(await askConfirm({ title: 'Open link?', body: where, confirmLabel: 'Open link' }))) return null;
  }
  if (SHELL) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('plugin:opener|open_url', { url: u.href }).then(() => true, () => false);
  }
  // noopener makes window.open return null even when it opened: no failure to read here.
  window.open(u.href, target, target === '_blank' ? 'noopener' : undefined);
  return true;
}
