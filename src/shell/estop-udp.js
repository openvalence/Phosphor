/**
 * estop-udp.js -- the shell's RFC-053 datagram e-stop: every e-stop press also
 * broadcasts the §5.5 frame as a UDP datagram on every IPv4 interface
 * (src-tauri/src/estop_udp.rs). SHELL ONLY: main.js installs it; a page
 * cannot send UDP.
 *
 * Constraints:
 * - Opt-out, default on (RFC-053 item 3): the `estopDatagram` pref, read at
 *   each press, Settings > Connection.
 * - Beside the session's own estop, never instead of it: the press hook
 *   fires first and runAction still sends the op (actions.js noteEstopPress).
 * - A broadcast stops every hub on the segment that honors RFC-053, not only
 *   the one this window drives.
 * - A Virtual Valence session never broadcasts: its e-stop belongs to a
 *   replay, not to a machine on the LAN.
 * - Tauri IPC is JSON: the 12 bytes travel as a number array.
 */

import { get } from 'svelte/store';
import { broadcastEstop, SAFETY_CAUSE, ACCESS } from '../../../Valence/clients/js/index.js';
import { prefs } from '../model/prefs.js';
import { setEstopPressHook } from '../model/actions.js';

export const ESTOP_COMMAND = 'estop_broadcast';

/** The command's arguments for one datagram. */
export function estopArgs(bytes) {
  return { datagram: Array.from(bytes) };
}

/**
 * The press hook: one RFC-053 initiation over the whole §11.2 budget.
 * @param {Object} o
 * @param {(cmd: string, args: Object) => Promise<unknown>} o.invoke Tauri's invoke
 * @param {() => boolean} o.isVirtual the live session rides Virtual Valence
 * @param {() => number} [o.origin] the session's access tier
 * @param {() => boolean} [o.enabled] default: the `estopDatagram` pref
 * @param {Function} [o.broadcast] default: valence-js broadcastEstop
 * @returns {() => Promise<Object>|null} null when the press sends nothing
 */
export function createEstopDatagram({
  invoke, isVirtual, origin = () => ACCESS.watch, enabled = () => get(prefs).estopDatagram, broadcast = broadcastEstop,
}) {
  return () => {
    if (!enabled() || isVirtual()) return null;
    return broadcast({
      cause: SAFETY_CAUSE.user,
      origin: origin(),
      send: (bytes) => invoke(ESTOP_COMMAND, estopArgs(bytes)),
    }).then((r) => {
      if (!r.sent) console.warn('e-stop datagram reached no interface');
      return r;
    }, (e) => {
      console.error('e-stop datagram failed', e);
      return null;
    });
  };
}

/** main.js, shell branch only. */
export function installEstopDatagram(deps) {
  setEstopPressHook(createEstopDatagram(deps));
}
