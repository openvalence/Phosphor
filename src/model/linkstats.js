/**
 * linkstats.js -- `machine.stats.link`, the top bar's loss readout. The
 * client half windows the shell's cumulative TCP counters
 * (src-tauri/src/linkstats.rs); the machine half reads the hub's own health
 * roles (Valence RFC-109 draft): `link.resent` (the share of its TCP segments
 * it sent again, trailing window), `link.retries` (its radio's transmit
 * retries, trailing window) and `link.rssi`. Pure; machine.svelte.js owns the
 * 1 Hz tick, which runs only while the link is live.
 *
 * Constraints:
 * - A percent is retransmitted over sent across the last WINDOW samples, never
 *   since boot: a link that was bad an hour ago reads clean now.
 * - Null when unknown: no source, fewer than two samples, nothing sent in the
 *   window, a field the hub does not declare, or its no-reading value. Never
 *   a 0 standing in for "not measured".
 * - A client counter that goes backwards (reconnect, a 32-bit wrap) or a
 *   change of scope or unit restarts the window rather than reading negative.
 * - `clientScope` says what the client figure covers: "connection" (the hub
 *   socket only) or "system" (every TCP connection on this computer, on
 *   Windows); `clientUnit` is "segments" or "bytes" (macOS).
 */

import { ROLE } from './roles.js';

/** Samples per window; at the 1 Hz tick, ten seconds. */
export const WINDOW = 10;

export function blankLink() {
  return { clientLossPct: null, clientScope: null, clientUnit: null, machine: { lossPct: null, retryPct: null, rssiDbm: null } };
}

/** A rolling percent over cumulative {retrans, sent} counters. */
export function lossWindow(n = WINDOW) {
  let ring = [];
  let key = '';
  return {
    push(c) {
      if (!c || !(c.sent >= 0) || !(c.retrans >= 0)) { ring = []; key = ''; return null; }
      const k = (c.scope || '') + '/' + (c.unit || '');
      const last = ring[ring.length - 1];
      if (k !== key || (last && (c.sent < last.sent || c.retrans < last.retrans))) { ring = []; key = k; }
      ring.push(c);
      if (ring.length > n + 1) ring.shift();
      const sent = c.sent - ring[0].sent;
      return sent > 0 ? Math.min(100, (100 * (c.retrans - ring[0].retrans)) / sent) : null;
    },
    reset() { ring = []; key = ''; },
  };
}

function roleValue(model, samples, role) {
  const f = ((model && model.byRole && model.byRole.get(role)) || [])[0];
  const v = f && samples[f.channelId] && samples[f.channelId][f.name];
  return typeof v === 'number' ? v : null;
}

// RFC-109: a share is 0..100 % (wire 0..10000 at scale 100); 655.35 is no reading.
const share = (v) => (v != null && v >= 0 && v <= 100 ? v : null);

/** The hub's half as it stands in the samples, each null when unknown. */
export function machineLink(model, samples) {
  const rssi = roleValue(model, samples, ROLE.linkRssi);
  return {
    lossPct: share(roleValue(model, samples, ROLE.linkResent)),
    retryPct: share(roleValue(model, samples, ROLE.linkRetries)),
    // RFC-109: 0 = no reading.
    rssiDbm: rssi != null && rssi !== 0 ? rssi : null,
  };
}

/** One tick: step(clientCounters | null, machineLink()) -> machine.stats.link. */
export function createLinkStats(n = WINDOW) {
  const client = lossWindow(n);
  return {
    step(c, machine) {
      const clientLossPct = client.push(c);
      return {
        clientLossPct,
        clientScope: clientLossPct == null ? null : c.scope || null,
        clientUnit: clientLossPct == null ? null : c.unit || null,
        machine: machine || blankLink().machine,
      };
    },
    reset() { client.reset(); },
  };
}
