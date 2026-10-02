/**
 * wishes.test.mjs -- the SUBSCRIBE policy (src/model/wishes.js) against a
 * synthetic catalog: the telemetry rate preference (ph-vdk.54) and the caps.
 *
 * Fails if the preference is ignored, if it ever wishes past a channel's
 * max_rate_hz, if on-change channels gain a rate, or if shedding forgets the
 * HELLO slots or drops safety before diagnostics, or if a catalog grown
 * mid-session (RFC-077) re-wishes a survivor or loses track of what vanished.
 *
 * Run: node test/wishes.test.mjs
 */

import { subscriptionWishes, telemetryChannelIds, regrow, TELEMETRY_HZ, MAX_SUBSCRIBE_HZ } from '../src/model/wishes.js';
import { buildSettingsModel } from '../src/model/settings.js';
import { ROLE } from '../src/model/roles.js';
import { CHANNEL_CLASS, PACKED, PRIORITY, decodeCatalog } from '../../Valence/clients/js/index.js';
import { readFileSync } from 'node:fs';

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

console.log('\nlive catalog growth (RFC-077)');
{
  const rec = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
  const opts = { maxSubs: 64, telemetryIds: telemetryChannelIds(buildSettingsModel(rec)), skip: new Set(), reserved: 0 };
  const first = regrow([], rec, new Set(), opts);
  const held = new Set(first.fresh.map((w) => w[0]));
  ok('first adoption: everything is fresh, nothing removed', first.removed.length === 0 && first.fresh.length > 0);
  // The replay: one accessory channel appears in user space, one leaves.
  const gone = rec.find((e) => e.dir === 0 && e.cls === CHANNEL_CLASS.STATE && e.id >= 0x1000);
  const joined = { ...ch(0x8010, 10, [{ name: 'lvl', type: PACKED.u8 }]), category: 1 };
  const next = [...rec.filter((e) => e !== gone), joined];
  const g = regrow(rec, next, held, opts);
  ok('only the appeared channel is wished', g.fresh.length === 1 && g.fresh[0][0] === 0x8010, JSON.stringify(g.fresh));
  ok('the vanished channel is reported removed, nothing else', g.removed.length === 1 && g.removed[0] === gone.id);
  ok('survivors are neither re-wished nor removed (their samples and shadows stay)',
     !g.fresh.some((w) => held.has(w[0])) && !g.removed.some((id) => next.some((e) => e.id === id)));
  const cat = { ...ch(0x0001, 0), priority: PRIORITY.background };
  const tight = subscriptionWishes([cat, ...entries], { maxSubs: 1, telemetryIds });
  ok('catalog 0x0001 is never shed (RFC-077 MUST)', tight.wishes.length === 1 && tight.wishes[0][0] === 0x0001);
}

console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS -- subscription wishes');
process.exit(fails ? 1 : 0);
