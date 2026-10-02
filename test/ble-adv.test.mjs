// ble-adv.test.mjs — scan-response parsing and the BLE-to-WS upgrade decision
// against synthetic advertisements; no radio. Run: node test/ble-adv.test.mjs

import assert from 'node:assert/strict';
import { advFlags, upgradeTarget, ipv4ToString, ADV_COMPANY_ID } from '../src/shell/ble-adv.js';

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
assert.deepEqual(advFlags(hub({ '65535': [0x04] })), { pairing: false, ws: false, configMode: true }, 'RFC-079 config mode');
assert.deepEqual(advFlags(hub({ '65535': [0xf8] })), { pairing: false, ws: false, configMode: false }, 'reserved bits ignored');
assert.equal(advFlags(hub({ '76': [0x02] })), null, 'another company id is not ours');
assert.equal(advFlags(hub({ '65535': [] })), null);
assert.equal(advFlags(hub(undefined)), null);
assert.equal(advFlags(null), null);

assert.equal(ipv4ToString(0xc0a80164), '192.168.1.100');
assert.equal(ipv4ToString(0), null);

const live = { mode: 'ble', phase: 'live', endpoint: { ipv4: 0xc0a80164, wsPort: 82 } };
assert.deepEqual(upgradeTarget({ ...live, adv: { ws: true } }), { host: '192.168.1.100', port: 82 });
assert.deepEqual(upgradeTarget({ ...live, adv: null }), { host: '192.168.1.100', port: 82 },
  'an unread scan response does not block the upgrade');
assert.equal(upgradeTarget({ ...live, adv: { ws: false } }), null, 'ws_available=0 vetoes');
assert.equal(upgradeTarget({ ...live, endpoint: { ipv4: 0xc0a80164, wsPort: 0 } }), null, 'port 0 is absent');
assert.equal(upgradeTarget({ ...live, endpoint: { ipv4: 0, wsPort: 82 } }), null, 'ipv4 0 is absent');
assert.equal(upgradeTarget({ ...live, endpoint: { ipv4: null, wsPort: null } }), null);
assert.equal(upgradeTarget({ ...live, endpoint: null }), null);
assert.equal(upgradeTarget({ ...live, phase: 'handshaking' }), null, 'only a live session hops');
assert.equal(upgradeTarget({ ...live, mode: 'ws' }), null, 'already on WS');

console.log('PASS — ble-adv: scan-response flags (config mode included) and upgrade decision');
