/**
 * found.js -- the Hubs pane's found list: one row per hub across the LAN
 * probe (SPEC 13.8) and the Bluetooth scan (SPEC 13.4).
 *
 * Constraints:
 * - Pure: no runes, no Tauri, so test/hubs.test.mjs runs it under node.
 * - A row keys on the hub's durable hub_instance_id. A LAN reply carries it;
 *   a BLE advertisement does not (13.4), so a BLE row keys on the id a live
 *   BLE session's WELCOME taught (`bleIds`, address -> id), else its address.
 * - A hub found both ways is one row, and its connect target is LAN.
 * - Rows keep first-seen order and their last-seen time; a row never moves.
 */

const lanKey = (r) => r.hub_instance_id || r.ip + ':' + r.ws_port;
const bleKey = (d, bleIds) => (bleIds && bleIds.get(d.address)) || 'ble:' + d.address;

/** `items` from one path ('LAN' replies or 'BLE' devices) merged into `rows`. */
export function mergeFound(rows, items, via, { bleIds = null, now = Date.now() } = {}) {
  const out = rows.slice();
  for (const it of items) {
    const key = via === 'LAN' ? lanKey(it) : bleKey(it, bleIds);
    const i = out.findIndex((r) => r.key === key);
    const prev = i < 0 ? null : out[i];
    const row = { key, lan: via === 'LAN' ? it : prev?.lan || null, ble: via === 'BLE' ? it : prev?.ble || null, seenAt: now };
    if (i < 0) out.push(row); else out[i] = row;
  }
  return out;
}

/**
 * A BLE address just learned its hub_instance_id: its row takes the id as its
 * key, folding into the LAN row of that hub when there is one.
 */
export function learnBleId(rows, address, id) {
  const i = rows.findIndex((r) => r.key === 'ble:' + address);
  if (i < 0 || !id) return rows;
  const j = rows.findIndex((r) => r.key === id);
  if (j < 0) return rows.map((r, k) => (k === i ? { ...r, key: id } : r));
  const ble = rows[i].ble;
  return rows.flatMap((r, k) => (k === i ? [] : k === j ? [{ ...r, ble }] : [r]));
}

/** The marks a row shows, in a fixed order. */
export const foundVia = (row) => [row.lan && 'LAN', row.ble && 'BLE'].filter(Boolean);
