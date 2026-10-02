// hub-identity.test.mjs: the LinkBar header and HUB chip text, driven by a
// fake WELCOME through the real session decoder (ph-0oo). No hub, no browser.
// Run: node test/hub-identity.test.mjs

import assert from 'node:assert/strict';
import { createSession } from '../../Valence/clients/js/index.js';
import { cbMap, cbUint, cbBstr, cbTstr } from '../../Valence/clients/js/cbor.js';
import { encodeFrame, parseFrames, FRAME, K, IDENTITY_K } from '../../Valence/clients/js/frames.js';
import { hubTitle, endpointLabel } from '../src/model/format.js';

// WELCOME from a fake socket, decoded by the same session.js the app runs.
async function welcomeIdentity(identity) {
  let ws;
  class FakeWs {
    constructor(url) { this.url = url; this.readyState = 1; ws = this; queueMicrotask(() => this.onopen()); }
    send(buf) {
      for (const { header } of parseFrames(new Uint8Array(buf))) {
        if (header.type !== FRAME.HELLO) continue;
        const w = [[K.session_id, cbUint(1)], [K.boot_id, cbUint(1)],
          [K.catalog_etag, cbBstr(new Uint8Array(8))], [K.cfg_gen, cbUint(1)], [K.roles, cbUint(1)]];
        if (identity) w.push([K.identity, cbMap(identity)]);
        const f = encodeFrame(FRAME.WELCOME, 0, cbMap(w));
        queueMicrotask(() => this.onmessage({ data: f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) }));
      }
    }
    close() {}
  }
  const s = createSession({ host: '127.0.0.1', port: 8282, WebSocketImpl: FakeWs, autoReconnect: false, log: () => {} });
  const got = new Promise((r) => s.on('welcome', (w) => r(w.identity)));
  s.connect();
  const id = await got;
  s.close();
  assert.equal(ws.url, 'ws://127.0.0.1:8282/');
  return id;
}

const named = await welcomeIdentity([[IDENTITY_K.product, cbTstr('Nucleus')], [IDENTITY_K.hub_name, cbTstr('bench-rig')]]);
assert.equal(hubTitle(named, ''), 'bench-rig', 'hub_name leads');
assert.equal(hubTitle(named, 'renamed'), 'bench-rig', 'hub_name outranks the identity.name setting');

const unnamed = await welcomeIdentity([[IDENTITY_K.product, cbTstr('Nucleus')]]);
assert.equal(hubTitle(unnamed, 'rig-from-setting'), 'rig-from-setting', 'identity.name setting before product');
assert.equal(hubTitle(unnamed, undefined), 'Nucleus', 'product is the last fallback');

const bare = await welcomeIdentity(null);
assert.equal(bare, null, 'SPEC §6.3: identity may be absent');
assert.equal(hubTitle(bare, ''), '--', 'no identity: no invented name');

// HUB chip: the endpoint the session dialed, whatever the page origin is.
assert.equal(endpointLabel('127.0.0.1', 8282, null), '127.0.0.1:8282', 'WS host:port');
assert.equal(endpointLabel('192.168.1.40', 82, null), '192.168.1.40:82', 'served page: the hub it dialed');
assert.equal(endpointLabel('AA:BB:CC:DD:EE:FF', 82, 'Nucleus-1F'), 'Nucleus-1F', 'BLE: device name');
assert.equal(endpointLabel('AA:BB:CC:DD:EE:FF', 82, ''), 'AA:BB:CC:DD:EE:FF', 'BLE without a name: address');
assert.equal(endpointLabel('', 82, null), '--', 'not connected');

console.log('PASS: hub-identity: header name order and HUB chip endpoint');
