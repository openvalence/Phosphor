/**
 * bp-pace.js -- one update-rate window per buttplug device, shared by every
 * sender (the node graph, the toy modules). Upstream batches a device's
 * commands in its message gap and keeps the newest per feature
 * (device_task.rs); this does the same on the client, so a sender that holds
 * its newest value and asks again at the window never floods the link.
 *
 * Constraints:
 * - `when` calls `fn` at once when the window is open, else at its next
 *   opening; every fn queued for a device runs together. The caller reads its
 *   newest value inside fn (newest wins) and queues at most one fn per output.
 * - A ceiling only: it never speeds anything up.
 * See: docs/BUTTPLUG.md
 */

/** Used when the device config names no message gap: the BLE manager's own (btleplug_hardware.rs). */
export const DEFAULT_GAP_MS = 75;

/** A device's message gap in ms: its config's, else the default. */
export const gapOf = (d) => (d && d.message_gap_ms > 0 ? d.message_gap_ms : DEFAULT_GAP_MS);

export function createPacer({ now = () => performance.now(), later = setTimeout } = {}) {
  const dev = new Map();
  function open(d) {
    d.timer = null;
    d.last = now();
    for (const f of d.q.splice(0)) f();
  }
  return {
    when(key, gap, fn) {
      let d = dev.get(key);
      if (!d) dev.set(key, (d = { last: -Infinity, q: [], timer: null }));
      if (!d.timer && now() - d.last >= gap) { d.last = now(); fn(); return; }
      d.q.push(fn);
      if (!d.timer) d.timer = later(() => open(d), Math.max(0, d.last + gap - now()));
    },
  };
}

export const pace = createPacer();
