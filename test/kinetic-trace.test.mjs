/**
 * kinetic-trace.test.mjs -- the vendored kinetic.wasm (kinetic/bytes.js) is the machine's Kinetic² planner
 * bit for bit: test/fixtures/kinetic_trace.json is Nucleus test/fixtures/kinetic_trace.json as of Nucleus
 * ff45f6a (kernel Kinetic 540938d, expect_ms 500; written by its native suite test_kinetic_wasm_trace under
 * pio test -e native), replayed the way Nucleus tools/kinetic-wasm/check.mjs replays it.
 *
 * (1) every 1 ms sample of the 60 s script hashes as the native run did (all 64 bytes), p/v/a 0 ULP;
 * (2) renderCore, the worker's own loop, fed the fixture's segments, submits them on the same ticks and
 *     returns the same position_mm at every step.
 *
 * Run: node test/kinetic-trace.test.mjs [kinetic.wasm]   (or KINETIC_WASM=<path>; default bytes.js)
 */
import { readFileSync } from 'node:fs';
import { instantiate, versionOf, renderCore, segmentsOf, LEAD_MS, FREE } from '../plugins/factory/funscript-player/kinetic/kinetic.js';
import { EXPECT_MS } from '../plugins/factory/funscript-player/scheduler.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + extra : ''));
  if (!cond) fails++;
};

const fx = JSON.parse(readFileSync(new URL('./fixtures/kinetic_trace.json', import.meta.url), 'utf8'));
const wasmPath = process.argv[2] || process.env.KINETIC_WASM;
const k = await instantiate(wasmPath ? readFileSync(wasmPath).toString('base64') : undefined);
console.log('kinetic.wasm: ' + versionOf(k));
const SAMPLE = 64, OFFSET = 0xcbf29ce484222325n, PRIME = 0x100000001b3n;

// (1) the replay
const [vmax, amax, jmax, rail, horizon] = fx.create;
const h = k.kinetic_create(vmax, amax, jmax, rail, horizon);
k.kinetic_set_window(h, fx.window[0], fx.window[1]);
k.kinetic_expect(h, fx.expect_ms);
const out = k.malloc(SAMPLE);
const posMm = new Float32Array(fx.steps);
let next = 0, hash = OFFSET, accepted = 0, bad = 0, badTrace = 0, mask = 0;
for (let tick = 0; tick < fx.steps; tick++) {
  for (; next < fx.events.length && fx.events[next][0] === tick; next++) {
    const e = fx.events[next];
    if (k.kinetic_submit_segment(h, e[2], e[3], e[4], e[5]) === 1) accepted++;
  }
  k.kinetic_step(h, fx.dt_s, out);
  const dv = new DataView(k.memory.buffer, out, SAMPLE);
  posMm[tick] = dv.getFloat32(44, true);
  mask |= dv.getUint32(52, true);
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
ok('every 1 ms sample of ' + fx.steps + ' bit-identical to the native run', bad === 0, (fx.hashes.length - bad) + '/' + fx.hashes.length + ' blocks');
ok('p/v/a every ' + fx.trace_every + ' ms: 0 ULP', badTrace === 0, badTrace + ' differ');
ok('accepted segments as native', accepted === fx.summary.accepted, accepted + ' vs ' + fx.summary.accepted);
ok('anomaly mask as native', mask === fx.summary.anomaly_mask, mask + ' vs ' + fx.summary.anomaly_mask);

// (2) the worker's loop on the same input
const segs = fx.events.filter((e) => e[1] === 'seg').map((e) => [e[5] / 1000, e[2], e[3], e[4]]);
const lead = segs[0][0] - fx.events[0][0];
const it = renderCore(k, { limits: { vmax, amax, jmax, rail, horizonMs: horizon }, window: fx.window, tuning: [],
  segs, steps: fx.steps, stepMs: fx.dt_s * 1000, every: 1, leadMs: lead, expectMs: fx.expect_ms });
const t = performance.now();
let r;
do r = it.next(); while (!r.done);
const ms = performance.now() - t;
const r2 = r.value;
let diff = 0;
for (let i = 0; i < fx.steps; i++) if (!Object.is(r2.pos[i], posMm[i])) diff++;
ok('renderCore accepts what the replay accepted', r2.accepted === accepted, r2.accepted + ' vs ' + accepted);
ok('renderCore: position_mm identical at all ' + fx.steps + ' steps', diff === 0, diff + ' differ');
console.log('  [NOTE] renderCore, ' + fx.steps / 1000 + ' s at 1 ms in node: ' + ms.toFixed(0) + ' ms');

// (3) ph-hcof: a reversal is sent at rest, so the twin never renders a trough or crest moving on past its knot
// (a free reversal was carried along the last chord while its successor was beyond the lead). Tolerance kin-554's,
// 0.2 % of the window.
{
  const at = [], pos = [];
  for (let i = 0; i <= 40; i++) { at.push(i * 300); pos.push(i % 2 ? 0.8 : 0.2); }
  const sc = { at, pos, durationMs: at.at(-1) };
  const run = (segs, steps) => {
    const it3 = renderCore(k, { limits: { vmax, amax, jmax, rail, horizonMs: horizon }, window: fx.window, tuning: [], segs, steps,
      every: 1, leadMs: LEAD_MS, expectMs: EXPECT_MS });
    let x;
    do x = it3.next(); while (!x.done);
    return x.value.raw;
  };
  const past = (segs, steps) => {
    const raw = run(segs, steps), pad = segs[1][0];
    let worst = 0;
    for (let i = 1; i < at.length - 1; i++) {
      const c = Math.round(pad + at[i]), up = pos[i] > pos[i - 1];
      for (let s = c - 150; s <= c + 150; s++) worst = Math.max(worst, up ? raw[s] - pos[i] : pos[i] - raw[s]);
    }
    return worst;
  };
  const { segs, steps } = segmentsOf(sc, { offsetMs: 0, lo: 0, hi: 1, invert: false });
  const worst = past(segs, steps);
  const free = past(segs.map((s, i) => (i > 0 && i < segs.length - 1 ? [s[0], s[1], s[2], FREE] : s)), steps);
  ok('reversals at rest: no plan sample past a reversal knot by over 0.2 % of the window (300 ms spans)', worst <= 0.002,
    (worst * 100).toFixed(3) + ' % (all free: ' + (free * 100).toFixed(3) + ' %)');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
