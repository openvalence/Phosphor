/**
 * ble-adv.js -- a Valence hub's BLE scan response (SPEC §13.4): the flags byte and, while ws_available is set,
 * the endpoint tail (RFC-121).
 *
 * Constraints:
 * - Pure: no Tauri import, so test/ble-adv.test.mjs runs it with no radio.
 * - Advertisements are untrusted input (SPEC §13.7): read, never trusted to be well formed. The endpoint is a
 *   hint: private (RFC 1918) and link-local addresses only, and the hub's identity comes from WELCOME's
 *   hub_instance_id, never from the advertisement.
 */

import { BLE_ADV_FLAG } from '../../../Valence/clients/js/generated/registry_vocab.js';

// Registry ble_identity.msd_company_id (RFC-072): the record is company_id:u16le + flags:u8, then
// ipv4 (4 B, network order) + ws_port:u16le while ws_available is set (SPEC 13.4). Hand-copied: codegen omits it.
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
    // Booted into config mode (SPEC 13.4.1): the only hub a BLE session reaches.
    configMode: !!(rec[0] & BLE_ADV_FLAG.config_mode),
  };
}

/** u32 big-endian (WELCOME key 47) → dotted quad, or null. */
export function ipv4ToString(v) {
  if (!v) return null;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

/** 10/8, 172.16/12, 192.168/16 (RFC 1918) or 169.254/16 (link-local). */
export function privateIpv4(v) {
  const a = (v >>> 24) & 255, b = (v >>> 16) & 255;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** The advertised WebSocket endpoint {host, port}, or null: ws_available set, both fields nonzero, a private address. */
export function advEndpoint(dev) {
  const rec = dev?.manufacturerData?.[ADV_COMPANY_ID];
  if (!Array.isArray(rec) || rec.length < 7 || !(rec[0] & BLE_ADV_FLAG.ws_available)) return null;
  const ip = ((rec[1] << 24) | (rec[2] << 16) | (rec[3] << 8) | rec[4]) >>> 0;
  const port = rec[5] | (rec[6] << 8);
  if (!ip || !port || !privateIpv4(ip)) return null;
  return { host: ipv4ToString(ip), port };
}
