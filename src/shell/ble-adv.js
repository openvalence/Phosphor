/**
 * ble-adv.js — a Valence hub's BLE scan response, and the BLE-to-WS upgrade
 * decision (SPEC §13.1 SHOULD auto-upgrade, §13.4 flags byte, §6.3 ws_port /
 * ipv4 and transport migration).
 *
 * Constraints:
 * - Pure: no Tauri import, so test/ble-adv.test.mjs runs it with no radio.
 * - Advertisements are untrusted input (SPEC §13.7): read, never trusted to
 *   be well formed.
 */

import { BLE_ADV_FLAG } from '../../../Valence/clients/js/generated/registry_vocab.js';

// TODO(RFC-072): the registry pins no company id for the flags record;
// 0xFFFF (the SIG testing id) is what the S3 reference hub sent.
export const ADV_COMPANY_ID = 0xffff;

/**
 * The scan-response flags of one blec scan hit, or null when no Valence MSD
 * record was seen (passive scan, or a platform that drops the scan response).
 * Reserved bits are ignored, never rejected (SPEC §4.3 tolerance).
 */
export function advFlags(dev) {
  const rec = dev?.manufacturerData?.[ADV_COMPANY_ID];
  if (!Array.isArray(rec) || rec.length < 1) return null;
  return {
    pairing: !!(rec[0] & BLE_ADV_FLAG.pairing_window_open),
    ws: !!(rec[0] & BLE_ADV_FLAG.ws_available),
  };
}

/** u32 big-endian (WELCOME key 47) → dotted quad, or null. */
export function ipv4ToString(v) {
  if (!v) return null;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

/**
 * Where a live BLE session should hop to, or null. WELCOME's endpoint is
 * required and 0 means not offered (§6.3). The scan response can only veto:
 * ws_available=0 says no listener right now, while an unread scan response
 * says nothing either way.
 */
export function upgradeTarget({ mode, phase, endpoint, adv }) {
  if (mode !== 'ble' || phase !== 'live' || !endpoint) return null;
  if (!endpoint.ipv4 || !endpoint.wsPort || adv?.ws === false) return null;
  return { host: ipv4ToString(endpoint.ipv4), port: endpoint.wsPort };
}
