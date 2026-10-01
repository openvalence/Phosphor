/**
 * ble-ws.js — Valence-over-BLE-GATT as a WebSocket duck (RFC-043).
 *
 * Constraints:
 * - SHELL ONLY. Imports @mnlphlp/plugin-blec (Tauri); never reachable from
 *   the embedded build (main.js's SHELL branch is compiled away there).
 * - Session.js owns the protocol; this file is ONLY framing transport. It
 *   implements the exact WebSocket subset session.js touches (binaryType,
 *   send, close, onopen/onmessage/onclose/onerror, readyState) so it can be
 *   passed as createSession({ WebSocketImpl }).
 * - One GATT notification = one Valence frame; one write = one frame
 *   (SPEC §13.4: no fragmentation — an oversized frame is a hard error,
 *   never split).
 * - Writes are chained on a queue: frame ORDER is protocol-critical and
 *   concurrent plugin calls must not reorder HELLO/SUBSCRIBE/INTENT.
 * - UUIDs are registry `ble_identity` values (same source as the firmware's
 *   ValenceBleTransport.h — transcribed, the codegen does not emit JS).
 */

import {
  connect as blecConnect,
  disconnect as blecDisconnect,
  subscribe as blecSubscribe,
  send as blecSend,
  getMtu,
  setAndroidMtu,
} from '@mnlphlp/plugin-blec';

export const BLE_SERVICE = '56414c45-4e43-4531-8000-000000000001';
const CHAR_C2H_WRITE = '56414c45-4e43-4531-8000-000000000002';
const CHAR_H2C_NOTIFY = '56414c45-4e43-4531-8000-000000000003';

// SPEC §13.4: negotiate MTU >= 250 before catalog transfer. blec requests
// during connect on Android only (desktop stacks negotiate on their own), so
// this must be set before connect. 517 is the ATT maximum; the peer
// negotiates down.
const MTU_REQUEST = 517;
export const MTU_FLOOR = 250;

// Live wire counters for the ShellStrip's diagnostics line — on-device field
// debugging without adb. Reset on each bridge instantiation.
export const bleStats = { rx: 0, tx: 0, mtu: 0, lastError: '' };

// The one duck blec can back: it holds ONE connection at a time.
let current = null;

/**
 * Make the live duck's next close() a migration handoff (SPEC §6.3): no
 * GOODBYE is written and the GATT link stays up, so the hub sees the WS HELLO
 * while BLE is still attached and closes BLE itself, instead of running
 * session-loss teardown on it.
 */
export function holdForMigration() {
  if (current) current._held = true;
}

/** Drop a held GATT link. Normally the hub has already closed it. */
export async function releaseHeld() {
  if (!current?._held) return;
  current._held = false;
  await blecDisconnect().catch(() => {});
}

/**
 * Build a WebSocket-duck class bound to one BLE peripheral address.
 * session.js instantiates it per (re)connect; the url argument is ignored.
 * blec holds ONE connection at a time — fine for a single-hub session.
 */
export function makeBleWebSocket(address) {
  return class BleWebSocket {
    constructor(_url, _protocols) {
      this.binaryType = 'arraybuffer';
      this.readyState = 0; // CONNECTING
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this._dead = false;
      this._writeQ = Promise.resolve();
      this._held = false;
      bleStats.rx = 0;
      bleStats.tx = 0;
      bleStats.mtu = 0;
      bleStats.lastError = '';
      current = this;
      this._open();
    }

    async _open() {
      try {
        await setAndroidMtu(MTU_REQUEST).catch(() => {});
        await blecConnect(address, () => this._dropped());
        await blecSubscribe(CHAR_H2C_NOTIFY, BLE_SERVICE, (data) => {
          if (this._dead || !this.onmessage) return;
          bleStats.rx++;
          this.onmessage({ data: new Uint8Array(data).buffer });
        });
        this.mtu = bleStats.mtu = await getMtu().catch(() => 0);
        if (this._dead) { blecDisconnect().catch(() => {}); return; }
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
      } catch (e) {
        this._fail(e);
      }
    }

    _dropped() {
      if (this._dead) return;
      this._dead = true;
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: 1006, reason: 'ble link lost' });
    }

    _fail(e) {
      if (this._dead) return;
      this._dead = true;
      this.readyState = 3;
      bleStats.lastError = String(e);
      if (this.onerror) this.onerror(e);
      if (this.onclose) this.onclose({ code: 1006, reason: String(e) });
    }

    send(buf) {
      if (this._held || this._dead || this.readyState !== 1) return;
      const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf)
        : ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        : null;
      if (!bytes) { this._fail(new Error('ble-ws: non-binary send')); return; }
      const arr = Array.from(bytes);
      // withoutResponse, deliberately: the firmware's RX char is WRITE|WRITE_NR,
      // and Android's write-WITH-response completion callback proved lossy on
      // real hardware (one lost ATT ack jammed the one-op-in-flight GATT queue
      // forever — 45 retry-failures on a 12-byte frame, phone field test
      // 2026-07-28). Unacked c2h mirrors the unacked h2c NOTIFY (§13.1); frame
      // order is still kept by the ATT bearer + this promise chain.
      this._writeQ = this._writeQ.then(
        () => blecSend(CHAR_C2H_WRITE, arr, 'withoutResponse', BLE_SERVICE),
      ).then(() => { bleStats.tx++; })
        .catch((e) => this._fail(e));
    }

    close() {
      if (this._dead) { return; }
      this._dead = true;
      this.readyState = 2; // CLOSING
      if (!this._held) blecDisconnect().catch(() => {});
      Promise.resolve().then(() => {
        this.readyState = 3;
        if (this.onclose) this.onclose({ code: 1000, reason: 'client close' });
      });
    }
  };
}
