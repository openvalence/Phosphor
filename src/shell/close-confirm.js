// close-confirm.js -- the shell's close gate: the X and every OS close
// request (Alt+F4, the taskbar) land on one popover, and only a deliberate
// hold closes. SHELL ONLY; plain JS so a node test drives it with a fake
// window and fake timers.
//
// Constraints:
// - Every close request is prevented until the hold completes; the hold then
//   destroys the window (close() would only raise the request again).
// - A hold shorter than HOLD_MS closes nothing, so a stray click never quits.

export const HOLD_MS = 1000;

/**
 * `win`: { onCloseRequested(handler) -> Promise<unlisten>, destroy() }.
 * `ask()` opens the popover. Returns { hold(), release(), dispose() }.
 */
export function createCloseGate(win, ask, { holdMs = HOLD_MS, timers = globalThis } = {}) {
  let timer = null;
  let closing = false;
  const unlisten = Promise.resolve()
    .then(() => win.onCloseRequested((e) => {
      if (closing) return;
      e.preventDefault();
      ask();
    }))
    // No event permission (a degraded shell): the OS close goes through
    // unconfirmed, the X still asks.
    .catch(() => null);

  function release() {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
  }
  function hold() {
    if (timer != null || closing) return;
    timer = timers.setTimeout(() => {
      timer = null;
      closing = true;
      win.destroy();
    }, holdMs);
  }
  async function dispose() {
    release();
    const off = await unlisten;
    if (off) off();
  }
  return { hold, release, dispose };
}

/** The one-line consequences of closing now, from live state; empty when none. */
export function closeConsequences({ runsOnAlone, ownsSource, serverRunning }) {
  const out = [];
  if (runsOnAlone) out.push('Pattern keeps running (run in background)');
  else if (ownsSource) out.push('Motion settles: this session drives it');
  if (serverRunning) out.push('Server running: connected apps will drop');
  return out;
}
