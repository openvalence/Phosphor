/**
 * kinetic-trace.test.mjs -- the vendored kinetic.wasm (kinetic/bytes.js) is the machine's Kinetic² planner
 * bit for bit: test/fixtures/kinetic_trace.json is Nucleus test/fixtures/kinetic_trace.json as of Nucleus
 * 9216e08 (kernel Kinetic 4b991cb; written by its native suite test_kinetic_wasm_trace under
 * pio test -e native), replayed the way Nucleus tools/kinetic-wasm/check.mjs replays it.
 *
 * (1) every 1 ms sample of the 60 s script hashes as the native run did (all 64 bytes), p/v/a 0 ULP;
 * (2) renderCore, the worker's own loop, fed the fixture's segments before its tuning change, submits
 *     them on the same ticks and returns the same position_mm at every step.
 *
 * Run: node test/kinetic-trace.test.mjs [kinetic.wasm]   (or KINETIC_WASM=<path>; default bytes.js)
 */
import { readFileSync } from 'node:fs';
import { instantiate, versionOf, renderCore } from '../plugins/factory/funscript-player/kinetic/kinetic.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const fx = JSON.parse(readFileSync(new URL('./fixtures/kinetic_trace.json', import.meta.url), 'utf8'));
const wasmPath = process.argv[2] || process.env.KINETIC_WASM;
const k = await instantiate(wasmPath ? readFileSync(wasmPath).toString('base64') : undefined);
console.log('kinetic.wasm: ' + versionOf(k));
const SAMPLE = 64, TUNE = 64, TUNE_POLICY = 48, OFFSET = 0xcbf29ce484222325n, PRIME = 0x100000001b3n;
const TUNED_AT = fx.events.find((e) => e[1] === 'tune')[0];

// (1) the replay
const [vmax, amax, jmax, rail, horizon] = fx.create;
const h = k.kinetic_create(vmax, amax, jmax, rail, horizon);
k.kinetic_set_window(h, fx.window[0], fx.window[1]);
const out = k.malloc(SAMPLE), tune = k.malloc(TUNE);
const posMm = new Float32Array(TUNED_AT);
let next = 0, hash = OFFSET, accepted = 0, acceptedBefore = 0, bad = 0, badTrace = 0;
for (let tick = 0; tick < fx.steps; tick++) {
  for (; next < fx.events.length && fx.events[next][0] === tick; next++) {
    const e = fx.events[next];
    if (e[1] === 'tune') {
      k.kinetic_default_tuning(tune);
      new Uint8Array(k.memory.buffer)[tune + TUNE_POLICY] = e[2];
      k.kinetic_set_tuning(h, tune);
    } else if (k.kinetic_submit_segment(h, e[2], e[3], e[4], e[5], e[6]) === 1) {
      accepted++;
      if (tick < TUNED_AT) acceptedBefore++;
    }
  }
  k.kinetic_step(h, fx.dt_s, out);
  const dv = new DataView(k.memory.buffer, out, SAMPLE);
  if (tick < TUNED_AT) posMm[tick] = dv.getFloat32(44, true);
  for (const b of new Uint8Array(k.memory.buffer, out, SAMPLE)) hash = BigInt.asUintN(64, (hash ^ BigInt(b)) * PRIME);
  if ((tick + 1) % fx.block === 0) {
    if (hash.toString(16).padStart(16, '0') !== fx.hashes[(tick + 1) / fx.block - 1]) bad++;
    hash = OFFSET;
  }
  if ((tick + 1) % fx.trace_every === 0) {
    const want = fx.trace[(tick + 1) / fx.trace_every - 1];
    [8, 16, 24].forEach((o, j) => { if (!Object.is(dv.getFloat64(o, true), want[j])) badTrace++; });
  }
}
k.kinetic_destroy(h);
k.free(out);
k.free(tune);
ok('every 1 ms sample of ' + fx.steps + ' bit-identical to the native run', bad === 0, (fx.hashes.length - bad) + '/' + fx.hashes.length + ' blocks');
ok('p/v/a every ' + fx.trace_every + ' ms: 0 ULP', badTrace === 0, badTrace + ' differ');
ok('accepted segments as native', accepted === fx.summary.accepted, accepted + ' vs ' + fx.summary.accepted);

// (2) the worker's loop on the same input
const segs = fx.events.filter((e) => e[1] === 'seg' && e[0] < TUNED_AT).map((e) => [e[5] / 1000, e[2], e[3], e[4], e[6]]);
const lead = segs[0][0] - fx.events[0][0];
const it = renderCore(k, { limits: { vmax, amax, jmax, rail, horizonMs: horizon }, window: fx.window, tuning: [],
  segs, steps: TUNED_AT, stepMs: fx.dt_s * 1000, every: 1, leadMs: lead });
const t = performance.now();
let r;
do r = it.next(); while (!r.done);
const ms = performance.now() - t;
const r2 = r.value;
let diff = 0;
for (let i = 0; i < TUNED_AT; i++) if (!Object.is(r2.pos[i], posMm[i])) diff++;
ok('renderCore accepts what the replay accepted before the tuning change', r2.accepted === acceptedBefore, r2.accepted + ' vs ' + acceptedBefore);
ok('renderCore: position_mm identical at all ' + TUNED_AT + ' steps', diff === 0, diff + ' differ');
console.log('  [NOTE] renderCore, ' + TUNED_AT / 1000 + ' s at 1 ms in node: ' + ms.toFixed(0) + ' ms');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
