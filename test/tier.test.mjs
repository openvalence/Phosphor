// tier.test.mjs -- tier.js against the hub's raise rule (Hub::requiredAccessFor, Valence RFC-119):
// the entry's floor, raised by a field's access and an option's, never lowered; the words a short session reads.
// Run: node test/tier.test.mjs
import { tierOf, tierGate, tierRefusal, needsText } from '../src/model/tier.js';
import { NACK } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  ok   ' : '  FAIL ') + name); if (!cond) fails++; };

const settings = { access: 2, schema: [{ key: 1 }, { key: 2, access: 0 }] };
const home = { access: 1, schema: [{ key: 1, optionAccess: [2, 1, 2] }, { key: 2, access: 2 }] };
const safety = { access: 0, schema: [{ key: 1, optionAccess: [1, 1, 1, 1, 0, 1, 0] }] };

ok('a configure entry needs configure on every key', tierOf(settings, 1) === 2);
ok('a field access below the floor never lowers it', tierOf(settings, 2) === 2);
ok('an option raises the floor', tierOf(home, 1, 2) === 2 && tierOf(home, 1, 1) === 1);
ok('an unknown option takes the strictest declared', tierOf(home, 1, 9) === 2);
ok('a field access raises it', tierOf(home, 2) === 2);
ok('pause and estop stay watch', tierOf(safety, 1, 4) === 0 && tierOf(safety, 1, 6) === 0 && tierOf(safety, 1, 1) === 1);
ok('no entry gates nothing', tierOf(undefined, 1) === 0);
ok('control is short of a configure key, in words', tierGate(settings, 1, undefined, 1) === needsText(2)
  && /^needs configure/.test(needsText(2)));
ok('configure passes', tierGate(settings, 1, undefined, 2) === '');
ok('watch is short of control, in words', /^needs control/.test(tierGate(home, 1, 1, 0)));
ok('ACCESS_DENIED and NOT_CONTROLLER read as the tier', tierRefusal(NACK.ACCESS_DENIED) === needsText(2)
  && tierRefusal(NACK.NOT_CONTROLLER) === needsText(1) && tierRefusal(NACK.CONFLICT) === '');

console.log(fails ? '\nFAIL (' + fails + ')' : '\nALL PASS');
process.exit(fails ? 1 : 0);
