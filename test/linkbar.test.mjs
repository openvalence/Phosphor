/**
 * linkbar.test.mjs -- src/model/linkbar.js against a synthetic byte feed (operator 2026-10-10): the data
 * rate is the average of four 250 ms samples and the shown number lerps to it, the socket totals count raw
 * bytes by direction, the formats never invent a number, and the dot's state follows the link phase.
 *
 *   node test/linkbar.test.mjs   (in npm run check)
 */
import { encodeFrame, encodeEstopFrame, FRAME } from '../../Valence/clients/js/index.js';
import { totals, countFrames } from '../src/model/activity.js';
import { SAMPLE_MS, rateMeter, fmtNum, fmtRate, dotState, lossName, lossTip } from '../src/model/linkbar.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ---- the 1 s average of four 250 ms samples --------------------------------------------------
ok('the sample period is 250 ms', SAMPLE_MS === 250);
{
  const m = rateMeter();
  let t = 0, rx = 0, tx = 0;
  const step = (drx, dtx) => { t += SAMPLE_MS; rx += drx; tx += dtx; return m.sample(t, rx, tx); };
  m.sample(t, rx, tx);   // the baseline point
  // 1000 B in per 250 ms (4000 B/s), 250 B out (1000 B/s): the average is exact from the first interval on.
  const r1 = step(1000, 250);
  ok('one interval: the average is bytes over elapsed time', near(r1.avg.rx, 4000) && near(r1.avg.tx, 1000), r1.avg);
  step(1000, 250); step(1000, 250);
  const r4 = step(1000, 250);
  ok('four intervals: still 4000 B/s in, 1000 B/s out', near(r4.avg.rx, 4000) && near(r4.avg.tx, 1000), r4.avg);
  // The step to silence: the average falls one quarter per sample, reaching zero after four.
  const falls = [step(0, 0).avg.rx, step(0, 0).avg.rx, step(0, 0).avg.rx, step(0, 0).avg.rx];
  ok('silence: the 1 s average falls 3000, 2000, 1000, 0', falls.every((v, i) => near(v, 3000 - 1000 * i)), falls);
  // A burst is spread over the window, not shown at once.
  const b = step(8000, 0);
  ok('a burst of 8000 B reads as 8000 B/s across the 1 s window', near(b.avg.rx, 8000), b.avg);
}
{
  // A late tick: 500 ms between samples counts 500 ms, not 250.
  const m = rateMeter();
  m.sample(0, 0, 0);
  const r = m.sample(500, 2000, 0);
  ok('a late tick divides by the real elapsed time', near(r.avg.rx, 4000), r.avg);
}
{
  // The lerp: constant 8 KB/s in, the shown number rises toward it without overshoot and converges.
  const m = rateMeter();
  let t = 0, rx = 0, last = 0, mono = true, over = false, r = null;
  m.sample(t, 0, 0);
  for (let i = 0; i < 40; i++) {
    t += SAMPLE_MS; rx += 2000;
    r = m.sample(t, rx, 0);
    if (r.rx < last - 1e-9) mono = false;
    if (r.rx > 8000 + 1e-9) over = true;
    last = r.rx;
    if (i === 0) ok('the first sample moves the shown number only part way', r.rx > 0 && r.rx < r.avg.rx, r.rx);
  }
  ok('the shown number rises monotonically, never past the average', mono && !over);
  ok('and converges on the average', near(r.rx, 8000, 1), r.rx);
}

// ---- socket totals: the hub session's bytes, both directions ---------------------------------
{
  const f = (n) => encodeFrame(FRAME.STATE, 0x0100, new Uint8Array(n)).buffer;   // 8 + n on the wire
  const rx0 = totals.rx, tx0 = totals.tx;
  countFrames('rx', f(20));
  countFrames('rx', f(12));
  countFrames('tx', f(4));
  ok('rx and tx bytes are counted apart, header included', totals.rx - rx0 === 28 + 20 && totals.tx - tx0 === 12, [totals.rx - rx0, totals.tx - tx0]);
  const e = encodeEstopFrame ? encodeEstopFrame() : new Uint8Array([0xe5, 0xe5, 0xe5, 0xe5, 0, 0, 0, 0]);
  countFrames('tx', e.buffer ? e : new Uint8Array(e));
  ok('a frame the heatmap skips still counts as socket bytes', totals.tx - tx0 > 12);
  const before = totals.rx;
  countFrames('rx', 'a text message');
  ok('a text message is not counted', totals.rx === before);
}

// ---- formats: never a number the source did not give -----------------------------------------
ok('no reading is --', fmtNum(null) === '--' && fmtNum(undefined) === '--' && fmtNum(NaN) === '--' && fmtRate(null) === '--');
ok('under 10: one decimal; from 10: whole', fmtNum(0) === '0.0' && fmtNum(3.44) === '3.4' && fmtNum(9.96) === '10' && fmtNum(12.4) === '12' && fmtNum(100) === '100', [fmtNum(9.96), fmtNum(12.4)]);
ok('a rate is KB/s, 1 KB = 1000 B', fmtRate(4000) === '4.0' && fmtRate(250000) === '250' && fmtRate(0) === '0.0');
ok('a rate past three digits says so', fmtRate(20_000_000) === '999+' && fmtRate(999_000) === '999' && fmtRate(1_000_000) === '999+');

// ---- the dot's state per link phase -----------------------------------------------------------
{
  const want = { live: 'live', connecting: 'connecting', handshaking: 'connecting', retrying: 'connecting', idle: 'offline', failed: 'offline' };
  for (const [phase, s] of Object.entries(want)) ok('phase ' + phase + ' -> ' + s, dotState(phase, false) === s);
  ok('a live link gone silent is stale', dotState('live', true) === 'stale');
  ok('staleness never upgrades a link that is not live', dotState('failed', true) === 'offline' && dotState('retrying', true) === 'connecting');
  ok('an unknown phase reads offline, never live', dotState('bogus', false) === 'offline');
}

// ---- the loss chip's words: what each figure measures, from the fields the model gives -------------
{
  const win = { clientLossPct: 0.42, clientScope: 'system', clientUnit: 'segments', machine: { lossPct: 1.5, retryPct: null, rssiDbm: -58 } };
  const t = lossTip(win).split('\n');
  ok('Windows: the client line says all TCP on this PC, in segments', t[0] === 'This PC: 0.4% of TCP segments sent again, all TCP on this PC', t[0]);
  ok('the machine line is its TCP segments sent again; no radio reading says so', t[1] === 'Machine: 1.5% of its TCP segments sent again' && t[2] === 'Machine radio: no reading', t.slice(1, 3));
  ok('the signal is in dBm', t[3] === 'Machine Wi-Fi: -58 dBm');
  ok('the name carries the scope', lossName(win) === 'Resent: this PC 0.4%, machine 1.5%', lossName(win));
  const mac = lossTip({ ...win, clientUnit: 'bytes' }).split('\n')[0];
  ok('macOS: the unit is bytes', mac === 'This PC: 0.4% of TCP bytes sent again, all TCP on this PC', mac);
  const conn = lossTip({ ...win, clientScope: 'connection' }).split('\n')[0];
  ok('a connection scope says this connection, not this PC', conn === 'This connection: 0.4% of TCP segments sent again', conn);
  const virt = { clientLossPct: null, clientScope: null, clientUnit: null, machine: { lossPct: null, retryPct: null, rssiDbm: null } };
  ok('nothing reported: every line says no reading', lossTip(virt).split('\n').every((l) => /no reading$/.test(l)) && lossName(virt) === 'Resent: this app no reading, machine no reading', lossTip(virt));
  ok('no model at all reads the same, never a number', lossTip(undefined).split('\n').every((l) => /no reading$/.test(l)));
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
