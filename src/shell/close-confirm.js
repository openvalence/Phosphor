// close-confirm.js -- the shell's close gate: the X and every OS close
// request (Alt+F4, the taskbar) land on one popover, and only a deliberate
// hold closes. SHELL ONLY; plain JS so a node test drives it with a fake
// window and fake timers.
//
// Constraints:
// - Every close request is prevented until the hold completes; the hold then
//   destroys the window (close() would only raise the request again).
// - A hold shorter than HOLD_MS closes nothing, so a stray click never quits.
// - A close request raises the window first (unminimize, focus): a taskbar
//   close must show the popover, not leave it behind another window.
// - `idle()` true skips the hold (DESIGN §10.3); it is read at each request,
//   never cached.

import { FIELD_ROLE, CH_CONTROL_OWNER } from '../../../Valence/clients/js/index.js';
import { anyOwner } from '../model/actions.js';

export const HOLD_MS = 1000;

/**
 * `win`: { onCloseRequested(handler) -> Promise<unlisten>, destroy() }.
 * `ask()` opens the popover. Returns { request(), hold(), release(), dispose() };
 * request() is the X.
 */
export function createCloseGate(win, ask, { holdMs = HOLD_MS, timers = globalThis, idle = () => false } = {}) {
  let timer = null;
  let closing = false;
  const unlisten = Promise.resolve()
    .then(() => win.onCloseRequested((e) => {
      if (closing) return;
      // Not prevented: the window API destroys.
      if (idle()) { closing = true; return; }
      e.preventDefault();
      ask();
      raise_(win);
    }))
    // No event permission (a degraded shell): the OS close goes through
    // unconfirmed, the X still asks.
    .catch(() => null);

  function raise_(w) {
    Promise.resolve()
      .then(() => w.unminimize && w.unminimize())
      .then(() => w.setFocus && w.setFocus())
      .catch(() => null);   // no window permission: the popover still opens
  }
  function request() {
    if (closing) return;
    if (!idle()) { ask(); return; }
    closing = true;
    win.destroy();
  }
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
  return { request, hold, release, dispose };
}

/** The one-line consequences of closing now, from live state; empty when none. */
export function closeConsequences({ runsOnAlone, ownsSource, serverRunning }) {
  const out = [];
  if (runsOnAlone) out.push('Pattern keeps running (run in background)');
  else if (ownsSource) out.push('Motion settles: this session drives it');
  if (serverRunning) out.push('Server running: connected apps will drop');
  return out;
}

// A field under one of these reading nonzero is the machine doing something.
const BUSY = [FIELD_ROLE.telemetry_velocity, FIELD_ROLE.pattern_running, FIELD_ROLE.advgen_running,
  FIELD_ROLE.osc_active, FIELD_ROLE.meta_trial_pending];

/**
 * Close with no hold (DESIGN §10.3): the setting on, and the machine never
 * heard from since it was chosen, or idle on fresh samples: no control-owner
 * slot held (a stream, the player, a jog, a remote), every BUSY field zero,
 * and a carriage that reports its position reports its speed too.
 * `fresh(channelId)` is the model's freshness rule; absent reads busy.
 */
// ponytail: homing has no registry identity, so a cycle reads idle in its still moments (queued, at a datum); bind its role once one is ratified.
export function closesAtOnce({ on, heard, byRole, samples, fresh }) {
  if (!on) return false;
  if (!heard) return true;
  const owner = samples[CH_CONTROL_OWNER];
  if (!byRole || !owner || !fresh(CH_CONTROL_OWNER) || anyOwner(owner)) return false;
  if (byRole.get(FIELD_ROLE.telemetry_position) && !byRole.get(FIELD_ROLE.telemetry_velocity)) return false;
  return BUSY.every((r) => (byRole.get(r) || []).every((f) => {
    const v = samples[f.channelId] && samples[f.channelId][f.name];
    return (v === 0 || v === false) && fresh(f.channelId);
  }));
}
