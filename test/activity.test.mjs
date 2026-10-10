/**
 * activity.test.mjs -- src/model/activity.js against a synthetic feed (ph-8yga): rates and bytes per channel
 * and direction, levels normalized to each channel's own rate, a steady 1 Hz channel and a bundle of channels
 * holding one level through their arrivals (operator 2026-10-10: no flashing), the fall after silence, the
 * grant cap, and no timer at all while idle. The clock and the timers are faked; nothing waits.
 *
 *   node test/activity.test.mjs   (in npm run check)
 */
import { encodeFrame, encodeEstopFrame, FRAME } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

// ---- fake clock and timers, installed before the module loads -----------------------------------
let now = 1_000_000;
Date.now = () => now;
const timers = new Map();
let nextId = 1, started = 0, rafs = 0;
globalThis.setInterval = (fn, ms) => { started++; timers.set(nextId, { fn, ms, at: now + ms }); return nextId++; };
globalThis.clearInterval = (id) => { timers.delete(id); };
globalThis.requestAnimationFrame = () => { rafs++; return 0; };
/** Advance the clock to `t`, running due intervals in order. */
function advance(t) {
  for (;;) {
    let due = null;
    for (const x of timers.values()) if (x.at <= t && (!due || x.at < due.at)) due = x;
    if (!due) break;
    now = due.at;
    due.at += due.ms;
    due.fn();
  }
  now = t;
}

const { countFrames, read, level, watch, LINK, TICK_MS } = await import('../src/model/activity.js');
const frame = (type, ch, n = 4) => encodeFrame(type, ch, new Uint8Array(n));
const join = (parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---- idle: nothing runs ----------------------------------------------------------------------
const seen = [];
const unwatch = watch((t) => seen.push(t));
ok('a watcher with nothing arriving starts no timer', started === 0 && timers.size === 0, { started });

// ---- rates -------------------------------------------------------------------------------------
// 60 Hz STATE on 0x0100 (a 20-byte payload, 28 on the wire) and 1 Hz STATE on 0x0101 for 3 s; 20 Hz writes on 0x0200.
const t0 = now;
const FAST = 0x0100, SLOW = 0x0101, OUT = 0x0200;
for (let i = 0; i <= 180; i++) {
  const t = t0 + Math.round(i * 1000 / 60);
  advance(t);
  countFrames('rx', frame(FRAME.STATE, FAST, 20).buffer, t);
  if (i % 60 === 0) countFrames('rx', frame(FRAME.STATE, SLOW), t);
  if (i % 3 === 0) countFrames('tx', frame(FRAME.INTENT, OUT, 12), t);
}
ok('one timer runs while frames arrive', started === 1 && timers.size === 1, { started, timers: timers.size });
const tEnd = t0 + 3000;
const f = read(FAST, tEnd);
ok('60 Hz channel: ~60 frames/s', Math.abs(f.rx.hz - 60) < 1.5, f.rx.hz);
ok('60 Hz channel: ~60 x 28 bytes/s', Math.abs(f.rx.bps - 60 * 28) < 60, f.rx.bps);
ok('60 Hz channel: nothing sent', f.tx.hz === 0);
const o = read(OUT, tEnd);
ok('20 Hz writes count as tx, not rx', Math.abs(o.tx.hz - 20) < 1 && o.rx.hz === 0, o);
ok('a 60 Hz and a 1 Hz channel both read full at their own rate',
  level(FAST, tEnd) > 0.95 && level(SLOW, tEnd) > 0.95, [level(FAST, tEnd), level(SLOW, tEnd)]);
const all = read(LINK, tEnd);
ok('LINK counts every frame in both directions', all.rx.hz > 59 && all.tx.hz > 19, [all.rx.hz, all.tx.hz]);
ok('an unknown channel reads zero', read(0x7777, tEnd).rx.hz === 0 && level(0x7777, tEnd) === 0);

// ---- a NACK, a control frame and the ESTOP frame are never channel traffic ------------------------
countFrames('rx', frame(FRAME.NACK, 0x0300), tEnd);
countFrames('rx', frame(FRAME.PING, 0x0301), tEnd);
countFrames('tx', encodeEstopFrame(1, 1, 0), tEnd);
ok('a NACK or a PING on a channel counts toward LINK only', read(0x0300, tEnd).last === 0 && read(0x0301, tEnd).last === 0);
ok('the ESTOP frame is skipped whole', read(0xe5e5, tEnd).last === 0);

// ---- steady 1 Hz: one level through its arrivals (lerp, no flashing) ----------------------------
const S1 = 0x0400, base = now + 5;
let lo = 1, hi = 0;
for (let i = 0; i <= 30; i++) {
  const ta = base + i * 1000 + (i % 2 ? 15 : -15);   // +-15 ms jitter
  if (i >= 3) for (let t = ta - 1000; t < ta; t += 5) { const l = level(S1, t); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  advance(ta);
  countFrames('rx', frame(FRAME.STATE, S1), ta);
}
ok('a steady 1 Hz channel varies by under 0.05 across arrivals', hi - lo < 0.05, { lo, hi });

// ---- a bundle of N channels in one message: no step in any of them -------------------------------
const N = 12, B0 = 0x0500, bb = now + 7;
let worstStep = 0, worstSpan = 0;
const lvB = (t) => Array.from({ length: N }, (_, j) => level(B0 + j, t));
for (let i = 0; i <= 20; i++) {
  const tb = bb + i * 1000;
  advance(tb);
  const before = lvB(tb - 1);
  countFrames('rx', join(Array.from({ length: N }, (_, j) => frame(FRAME.STATE, B0 + j, 8 + j))), tb);
  const after = lvB(tb + 1);
  if (i >= 3) {
    worstStep = Math.max(worstStep, ...after.map((a, j) => Math.abs(a - before[j])));
    worstSpan = Math.max(worstSpan, Math.max(...after) - Math.min(...after));
  }
}
ok('a bundle of ' + N + ' channels steps none of them', worstStep < 0.02, worstStep);
ok('the bundle reads one level across its channels', worstSpan < 0.02, worstSpan);

// ---- silence: the level falls smoothly, then reads zero ----------------------------------------
const quiet = now;
const fall = [0, 500, 1000, 2000, 4000, 8000, 9900, 10100].map((d) => level(B0, quiet + d));
ok('after silence the level never rises', fall.every((v, i) => !i || v <= fall[i - 1] + 1e-9), fall);
ok('it holds through one interval, falls as 1 / the silence and reads zero past 10 s',
  fall[0] === 1 && fall[2] > 0.95 && Math.abs(fall[3] - 0.5) < 0.02 && Math.abs(fall[6] - 0.101) < 0.01 && fall[7] === 0, fall);

// ---- a lone arrival: full, then the same fall --------------------------------------------------
const LONE = 0x0600, tl = now + 50000;
advance(tl);
countFrames('rx', frame(FRAME.EVENT, LONE), tl);
ok('a lone EVENT reads full, half at 2 s, zero past 10 s',
  level(LONE, tl) === 1 && Math.abs(level(LONE, tl + 2000) - 0.5) < 0.01 && level(LONE, tl + 10100) === 0,
  [level(LONE, tl), level(LONE, tl + 2000), level(LONE, tl + 10100)]);

// ---- the grant caps the peak: a burst above it never dims the steady rate after it ---------------
const G = 0x0700, tg = now + 20000;
for (let i = 0; i < 40; i++) countFrames('rx', frame(FRAME.STATE, G), tg + i * 5);          // 200 Hz burst
for (let i = 1; i <= 40; i++) countFrames('rx', frame(FRAME.STATE, G), tg + 200 + i * 100);  // then 10 Hz
const te = tg + 200 + 40 * 100;
ok('after a burst, 10 Hz reads dim against its own peak', level(G, te) < 0.5, level(G, te));
ok('capped at a 10 Hz grant it reads full', level(G, te, 10) > 0.95, level(G, te, 10));

// ---- idle again: the timer stops ---------------------------------------------------------------------
advance(te + 10000 + 2 * TICK_MS);
ok('after 10 s of silence the timer has stopped', timers.size === 0, timers.size);
const ticks = seen.length;
advance(now + 60000);
ok('idle: no tick, no timer, no frame callback', seen.length === ticks && timers.size === 0 && rafs === 0, { ticks, rafs });
ok('the last tick came after everything read zero', ticks > 0 && read(G, seen[ticks - 1]).rx.hz === 0);
countFrames('rx', frame(FRAME.STATE, G), now);
ok('an arrival restarts the timer', timers.size === 1);
unwatch();
ok('unwatching the last watcher stops it', timers.size === 0);
countFrames('rx', frame(FRAME.STATE, G), now + 100);
ok('with no watcher, arrivals start no timer', timers.size === 0);

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
