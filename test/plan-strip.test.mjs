/**
 * plan-strip.test.mjs -- the plan roles on the recorded catalog (test/fixtures/valencesim-catalog.bin) carry a plan
 * outside the travel window: plan.start, plan.end and plan.current are declared i32 at scale 10000 (Nucleus val-vik,
 * 0.1.39) and valence-js decodes the hub's bytes by that declaration, a share below 0 or past 6.5535 included.
 *
 *   node test/plan-strip.test.mjs   (in npm run check)
 */
import { readFileSync } from 'node:fs';
import { decodeCatalog, decodePacked, PACKED } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

const entries = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
const plan = entries.find((e) => (e.layout || []).some((f) => f.role === 'plan.current'));
ok('the fixture has a plan strip', !!plan);
const roles = ['plan.start', 'plan.end', 'plan.current'];
const fields = roles.map((r) => plan.layout.find((f) => f.role === r));
ok('plan.start, plan.end and plan.current are i32 at scale 10000', fields.every((f) => f && f.type === PACKED.i32 && f.scale === 10000),
  fields.map((f) => f && [f.name, f.typeName, f.scale]));

// The hub's own bytes (Nucleus ValenceDevice.cpp publishPlanStrip): flags, style, the three positions, the velocity,
// duration, elapsed, plan.flags, little-endian; the carriage of the Neutrino cluster's replay 388, parked at 7.5 window shares.
const b = new DataView(new ArrayBuffer(25));
b.setUint8(0, 1);
b.setUint8(1, 1);
b.setInt32(2, -2500, true);
b.setInt32(6, 75000, true);
b.setInt32(10, 66000, true);
b.setInt16(14, -1500, true);
b.setUint32(16, 400000, true);
b.setUint32(20, 1000, true);
b.setUint8(24, 0);
const v = decodePacked(new Uint8Array(b.buffer), plan.layout);
const got = fields.map((f) => v[f.name]);
ok('a plan below the window and past 6.5535 decodes whole', Math.abs(got[0] + 0.25) < 1e-9 && Math.abs(got[1] - 7.5) < 1e-9
  && Math.abs(got[2] - 6.6) < 1e-9, got);

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
