/**
 * wishes.test.mjs -- the SUBSCRIBE policy (src/model/wishes.js) against a
 * synthetic catalog: the telemetry rate preference (ph-vdk.54) and the caps.
 *
 * Fails if the preference is ignored, if it ever wishes past a channel's
 * max_rate_hz, if on-change channels gain a rate, or if shedding forgets the
 * HELLO slots or drops safety before diagnostics.
 *
 * Run: node test/wishes.test.mjs
 */

import { subscriptionWishes, telemetryChannelIds, TELEMETRY_HZ, MAX_SUBSCRIBE_HZ } from '../src/model/wishes.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';
import { CHANNEL_CLASS, PACKED, PRIORITY } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const ch = (id, maxRateHz, layout = [], extra = {}) => ({
  id, name: 'c' + id, cls: CHANNEL_CLASS.STATE, dir: 0, access: 0, maxRateHz, priority: PRIORITY.normal, layout, ...extra,
});
const entries = [
  ch(0x0003, 0, [], { priority: PRIORITY.critical }),
  ch(0x1000, 100, [{ name: 'p', role: ROLE.telemetryPosition, type: PACKED.u16 }]),
  ch(0x1001, 40, [{ name: 'v', role: ROLE.telemetryVelocity, type: PACKED.i16 }]),
  ch(0x1002, 200, [{ name: 'diag', type: PACKED.u16 }], { priority: PRIORITY.background }),
  ch(0x1003, 0, [{ name: 'cfg', type: PACKED.u8 }]),
  { ...ch(0x4000, 0), cls: CHANNEL_CLASS.EVENT },
];
const telemetryIds = telemetryChannelIds(buildSettingsModel(entries));
const rateOf = (r, id) => (r.wishes.find((w) => w[0] === id) || [])[1];
const wish = (telemetryHz, o = {}) => subscriptionWishes(entries, { telemetryIds, pref: { telemetryHz }, ...o });

console.log('telemetry rate preference');
ok('telemetry channels found by role', telemetryIds.has(0x1000) && telemetryIds.has(0x1001) && telemetryIds.size === 2);
ok('no preference: the client default', rateOf(wish(null), 0x1000) === TELEMETRY_HZ);
ok('a 25 Hz preference wishes 25', rateOf(wish(25), 0x1000) === 25 && rateOf(wish(25), 0x1001) === 25);
ok('a 200 Hz preference wishes the channel max', rateOf(wish(200), 0x1000) === 100 && rateOf(wish(200), 0x1001) === 40);
ok('other channels keep MAX_SUBSCRIBE_HZ', rateOf(wish(200), 0x1002) === MAX_SUBSCRIBE_HZ);
ok('on-change STATE and EVENT stay 0', rateOf(wish(200), 0x1003) === 0 && rateOf(wish(200), 0x4000) === 0);

console.log('\ncaps');
const capped = wish(null, { maxSubs: 4, skip: new Set([0x0003]), reserved: 1 });
ok('HELLO ids are not wished twice', !capped.wishes.some((w) => w[0] === 0x0003));
ok('the HELLO slots count against the cap', capped.wishes.length === 3 && capped.dropped === 2, JSON.stringify(capped));
ok('shedding drops the least important first', !capped.wishes.some((w) => w[0] === 0x1002));

console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS -- subscription wishes');
process.exit(fails ? 1 : 0);
