// ble-adv.test.mjs -- scan-response parsing: the flags byte and the RFC-121 endpoint tail, with its
// private-address rule, against synthetic advertisements; no radio. Run: node test/ble-adv.test.mjs

import assert from 'node:assert/strict';
import { advFlags, advEndpoint, ipv4ToString, privateIpv4, ADV_COMPANY_ID } from '../src/shell/ble-adv.js';

// Shaped like @mnlphlp/plugin-blec's BleDevice after the IPC JSON hop, where
// manufacturerData's numeric keys arrive as strings.
const hub = (msd) => ({
  address: 'AA:BB:CC:DD:EE:FF',
  name: 'Bench',
  services: ['56414c45-4e43-4531-8000-000000000001'],
  manufacturerData: msd,
});

assert.deepEqual(advFlags(hub({ [ADV_COMPANY_ID]: [0x03] })), { pairing: true, ws: true, configMode: false });
assert.deepEqual(advFlags(hub({ '65535': [0x02] })), { pairing: false, ws: true, configMode: false });
assert.deepEqual(advFlags(hub({ '65535': [0x04] })), { pairing: false, ws: false, configMode: true }, 'config mode');
assert.deepEqual(advFlags(hub({ '65535': [0xf8] })), { pairing: false, ws: false, configMode: false }, 'reserved bits ignored');
assert.deepEqual(advFlags(hub({ '65535': [0x02, 192, 168, 1, 229, 0x50, 0x00] })), { pairing: false, ws: true, configMode: false },
  'the tail never changes the flags');
assert.equal(advFlags(hub({ '76': [0x02] })), null, 'another company id is not ours');
assert.equal(advFlags(hub({ '65535': [] })), null);
assert.equal(advFlags(hub(undefined)), null);
assert.equal(advFlags(null), null);

assert.equal(ipv4ToString(0xc0a80164), '192.168.1.100');
assert.equal(ipv4ToString(0), null);

// SPEC 13.4's own example: 192.168.1.229 port 80 appends C0 A8 01 E5 50 00.
assert.deepEqual(advEndpoint(hub({ '65535': [0x02, 0xc0, 0xa8, 0x01, 0xe5, 0x50, 0x00] })), { host: '192.168.1.229', port: 80 });
assert.deepEqual(advEndpoint(hub({ '65535': [0x02, 10, 0, 0, 7, 82, 0, 0xaa] })), { host: '10.0.0.7', port: 82 },
  'bytes past the tail are ignored');
assert.deepEqual(advEndpoint(hub({ '65535': [0x03, 172, 20, 1, 2, 0x56, 0x1f] })), { host: '172.20.1.2', port: 8022 });
assert.deepEqual(advEndpoint(hub({ '65535': [0x02, 169, 254, 3, 4, 82, 0] })), { host: '169.254.3.4', port: 82 }, 'link-local');
assert.equal(advEndpoint(hub({ '65535': [0x02] })), null, 'no tail');
assert.equal(advEndpoint(hub({ '65535': [0x02, 192, 168, 1, 229, 0x50] })), null, 'a short tail');
assert.equal(advEndpoint(hub({ '65535': [0x00, 192, 168, 1, 229, 0x50, 0x00] })), null, 'ws_available clear');
assert.equal(advEndpoint(hub({ '65535': [0x02, 0, 0, 0, 0, 0x50, 0x00] })), null, 'ipv4 0');
assert.equal(advEndpoint(hub({ '65535': [0x02, 192, 168, 1, 229, 0, 0] })), null, 'port 0');
for (const ip of [[8, 8, 8, 8], [172, 32, 0, 1], [172, 15, 0, 1], [192, 169, 0, 1], [127, 0, 0, 1], [224, 0, 0, 1], [255, 255, 255, 255], [100, 64, 0, 1]]) {
  assert.equal(advEndpoint(hub({ '65535': [0x02, ...ip, 82, 0] })), null, ip.join('.') + ' is not private');
}
assert.equal(privateIpv4(0x0a000001), true);
assert.equal(privateIpv4(0xac1f0001), true, '172.31/12 edge');
assert.equal(advEndpoint(hub({ '76': [0x02, 192, 168, 1, 2, 82, 0] })), null, 'another company id');

console.log('PASS -- ble-adv: scan-response flags and the endpoint tail');
