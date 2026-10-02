/**
 * format-units.test.mjs -- RFC-086 unit ids (deg, us, hub_s) and the one
 * value formatter (format.js formatParts): autorange boundaries, display-only
 * rescaling, and hub-time stamps through a fixture CLOCK reference.
 *
 * Fails if a unit id renders its raw name, if µs stops autoranging (or ever
 * rescales the value written back), or if a hub-time round trip is not exact,
 * picks the wrong 71.6-minute wrap, or invents a wall time with no uptime.
 *
 * Run: node test/format-units.test.mjs
 */

import {
  formatParts, formatWithUnit, unitOf, setAutorange, hubSecToWallMs, wallMsToHubSec, setHubClock,
} from '../src/model/format.js';
import { UNIT_ID } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const f = (unitId, extra = {}) => ({ unitId, unit: '', typeName: 'u32', ...extra });
const us = f(UNIT_ID.us);

console.log('unit ids');
ok('deg renders as °', unitOf(f(UNIT_ID.deg)) === '°');
ok('us renders as µs', unitOf(us) === 'µs');
ok('hub_s renders as hub s when no clock is known', unitOf(f(UNIT_ID.hub_s)) === 'hub s');

console.log('\nautorange (display only)');
setAutorange(true);
const parts = (v) => formatParts(us, v).join(' ');
ok('999 µs stays µs', parts(999) === '999 µs', parts(999));
ok('1000 µs reads 1.000 ms', parts(1000) === '1.000 ms', parts(1000));
ok('999999 µs reads ms', parts(999999) === '999.999 ms', parts(999999));
ok('1000000 µs reads s', /^1\.0+ s$/.test(parts(1e6)), parts(1e6));
ok('seconds never become ks', /^5000\.0+ s$/.test(parts(5e9)), parts(5e9));
ok('0 µs stays µs', parts(0) === '0 µs', parts(0));
const field = { ...us };
formatParts(field, 123456);
ok('formatting never touches the field (the write stays in µs)', field.unitId === UNIT_ID.us && field.unit === '');
setAutorange(false);
ok('autorange off: µs as declared', parts(123456) === '123 456 µs', parts(123456));
setAutorange(true);

console.log('\nhub time (SPEC §7.1, RFC-083/086)');
const WRAP_S = 2 ** 32 / 1e6;
// A hub up 3 h 10 min: well past two hub-µs wraps.
const upS = 3 * 3600 + 600.25;
const ref = { hubUs: Math.round(upS * 1e6) % 2 ** 32, wallMs: 1_800_000_000_000, uptimeS: Math.floor(upS) };
ok('now converts to the reference wall time', Math.abs(hubSecToWallMs(upS, ref) - ref.wallMs) < 1);
ok('the CLOCK fraction survives a coarse uptime', Math.abs(hubSecToWallMs(Math.floor(upS), ref) - (ref.wallMs - 250)) < 1);
ok('two hours ahead is two hours ahead (wrap picked by uptime)',
   Math.abs(hubSecToWallMs(upS + 7200, ref) - (ref.wallMs + 7200e3)) < 1);
let exact = true;
for (const s of [0, 1, 4295, 4296, 12345, Math.floor(upS) + 86400, 2 ** 31]) {
  if (wallMsToHubSec(hubSecToWallMs(s, ref), ref) !== s) exact = false;
}
ok('round trip hub s -> wall -> hub s is exact', exact);
ok('uptime alone (no CLOCK) still converts at 1 s resolution',
   hubSecToWallMs(ref.uptimeS + 60, { ...ref, hubUs: null }) === ref.wallMs + 60e3);
ok('no uptime: no wall time is guessed', hubSecToWallMs(100, { hubUs: ref.hubUs, wallMs: ref.wallMs, uptimeS: null }) === null
   && hubSecToWallMs(100, null) === null);
ok('a wrap off by one would be 71.6 min wrong: it is not',
   Math.abs(hubSecToWallMs(upS - WRAP_S / 2 + 1, ref) - (ref.wallMs - (WRAP_S / 2 - 1) * 1000)) < 1);
setHubClock(() => ref);
const hs = f(UNIT_ID.hub_s);
ok('formatParts renders a hub stamp as wall time with no unit',
   formatParts(hs, upS + 60)[1] === '' && formatParts(hs, upS + 60)[0] === new Date(ref.wallMs + 60e3).toLocaleString());
setHubClock(() => null);
ok('...and as raw hub seconds when the clock is unknown', formatWithUnit(hs, 42) === '42 hub s', formatWithUnit(hs, 42));

console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS -- unit ids, autorange, hub time');
process.exit(fails ? 1 : 0);
