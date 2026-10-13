// ble-frag.test.mjs — SPEC §5.6 fragmentation and reassembly, no radio.
// Run: node test/ble-frag.test.mjs

import assert from 'node:assert/strict';
import { fragmentFrame, Reassembler } from '../src/shell/ble-frag.js';
import { FRAME } from '../../Valence/clients/js/frames.js';

const START = 1;
const MORE = 2;

function frame(type, seq, payloadLen, flags = 0, channel = 0x3000) {
  const b = new Uint8Array(8 + payloadLen);
  const v = new DataView(b.buffer);
  b[0] = type; b[1] = flags;
  v.setUint16(2, channel, true); v.setUint16(4, seq, true); v.setUint16(6, payloadLen, true);
  for (let i = 0; i < payloadLen; i++) b[8 + i] = (i * 7 + seq) & 0xff;
  return b;
}
const flagsOf = (f) => f[1];
const feed = (r, frags, now = 0) => frags.map((f) => r.accept(f, now));

for (const mtu of [185, 247]) {
  const max = mtu - 3;
  const budget = max - 10;
  for (const n of [2, 3]) {
    const whole = frame(FRAME.ECHO, 9, budget * (n - 1) + 17);
    const frags = fragmentFrame(whole, max);
    assert.equal(frags.length, n, `mtu ${mtu}: ${n} fragments`);
    assert.ok(frags.every((f) => f.length <= max));
    assert.equal(flagsOf(frags[0]), START | MORE);
    for (let i = 1; i < n - 1; i++) assert.equal(flagsOf(frags[i]), MORE);
    assert.equal(flagsOf(frags[n - 1]), 0);
    const r = new Reassembler();
    const out = feed(r, frags);
    assert.deepEqual(out.slice(0, -1), Array(n - 1).fill(null));
    assert.deepEqual(out.at(-1).frame, whole, `mtu ${mtu}, ${n} fragments round trip`);
    assert.equal(r.stats.completed, 1);
  }
}

// A frame that fits, and the ESTOP frame, are never touched.
const small = frame(FRAME.INTENT, 1, 20);
assert.deepEqual(fragmentFrame(small, 182), [small]);
const estop = new Uint8Array(12).fill(0xe5);
assert.deepEqual(fragmentFrame(estop, 5), [estop], 'ESTOP never fragments');
assert.deepEqual(new Reassembler().accept(estop, 0), { frame: estop }, 'ESTOP passes the reassembler');

// Single fragment (START alone) completes at once.
{
  const r = new Reassembler();
  const one = new Uint8Array([FRAME.ECHO, START, 0, 0, 3, 0, 5, 0, 0, 0, 1, 2, 3]);
  assert.deepEqual([...r.accept(one, 0).frame], [FRAME.ECHO, 0, 0, 0, 3, 0, 3, 0, 1, 2, 3]);
}

// Out of order and duplicates.
{
  const whole = frame(FRAME.ECHO, 4, 400);
  const f = fragmentFrame(whole, 182);
  assert.equal(f.length, 3);
  const r = new Reassembler();
  assert.equal(r.accept(f[1], 0), null);
  assert.equal(r.accept(f[1], 0), null, 'duplicate is idempotent');
  assert.equal(r.accept(f[2], 0)?.frame, undefined, 'last fragment before first');
  assert.deepEqual(r.accept(f[0], 0).frame, whole);
  assert.equal(r.accept(f[0], 0), null, 'a fresh open after completion starts a new slot');
}

// Timeout: the slot is gone after 5000 ms, a late last fragment is just a frame.
{
  const f = fragmentFrame(frame(FRAME.ECHO, 4, 400), 182);
  const r = new Reassembler();
  r.accept(f[0], 0);
  const late = r.accept(f[2], 5000);
  assert.deepEqual(late, { frame: f[2] });
  assert.equal(r.stats.timeouts, 1);
}

// Two concurrent reassemblies; a third evicts the oldest.
{
  const wa = frame(FRAME.ECHO, 1, 400);
  const wb = frame(FRAME.ECHO, 2, 400);
  const wc = frame(FRAME.ECHO, 3, 400);
  const [a, b, c] = [wa, wb, wc].map((w) => fragmentFrame(w, 182));
  const r = new Reassembler();
  r.accept(a[0], 0); r.accept(b[0], 10); r.accept(c[0], 20);
  assert.equal(r.stats.evictions, 1);
  r.accept(b[1], 30);
  assert.deepEqual(r.accept(b[2], 30).frame, wb);
  r.accept(c[1], 30);
  assert.deepEqual(r.accept(c[2], 30).frame, wc);
}

// STATE and STREAM refuse to fragment; a control frame of the same size does not.
assert.equal(fragmentFrame(frame(FRAME.STATE, 1, 400), 182), null);
assert.equal(fragmentFrame(frame(FRAME.STREAM, 1, 400), 182), null);
assert.notEqual(fragmentFrame(frame(FRAME.HELLO, 1, 400), 182), null);

// A whole frame with flags 0 is not swallowed, even while another (type, seq) is open.
{
  const r = new Reassembler();
  r.accept(fragmentFrame(frame(FRAME.ECHO, 4, 400), 182)[0], 0);
  const whole = frame(FRAME.EVENT, 4, 30);
  assert.deepEqual(r.accept(whole, 1), { frame: whole });
  const sameType = frame(FRAME.ECHO, 5, 30);
  assert.deepEqual(r.accept(sameType, 1), { frame: sameType });
}

// Capacity: an over-512 transfer is refused and its slot discarded.
{
  const r = new Reassembler();
  const f = fragmentFrame(frame(FRAME.ECHO, 6, 600), 182);
  const out = feed(r, f);
  assert.ok(out.some((o) => o?.error), 'over-capacity reassembly refused');
  assert.equal(r.slots.length, 0);
}

console.log('ble-frag: ok');
