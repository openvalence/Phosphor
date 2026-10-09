/**
 * health.test.mjs -- the health system's pure half (src/model/health/core.js,
 * ph-9t5l): the cause classifier as a table, the hysteresis tracker on a fake
 * clock, the growth detector on synthetic series, and the condition table's
 * copy rules.
 * Run: node test/health.test.mjs
 */
import { CONDITIONS, CUTOUT, classify, createTracker, growth, quantile } from '../src/model/health/core.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

console.log('\n--- the condition table ---');
ok('26 conditions: 13 link, 7 device, 6 machine', Object.keys(CONDITIONS).length === 26
  && ['link', 'device', 'machine'].map((a) => Object.values(CONDITIONS).filter((c) => c.area === a).length).join() === '13,7,6');
const bad = Object.entries(CONDITIONS).filter(([, c]) => !c.short || c.short.length > 60 || /\. /.test(c.short) || /\.$/.test(c.short));
ok('every short line is one fragment under 60 characters (COPY.md)', !bad.length, bad.map((b) => b[0]));
const silent = Object.entries(CONDITIONS).filter(([id, c]) => !c.logOnly && !['log-drops', 'restarted'].includes(id) && (!c.detail || !c.action));
ok('every surfaced condition has its plain sentence and one action', !silent.length, silent.map((s) => s[0]));
ok('every detail is one sentence', Object.values(CONDITIONS).every((c) => !c.detail || (c.detail.match(/\. |\.$/g) || []).length === 1));
ok('a cutout per cause', Object.values(CUTOUT).every((id) => CONDITIONS[id] && CONDITIONS[id].cause));

console.log('\n--- classify ---');
const base = { latMs: 1, rttP50Ms: 10, loopLagMaxMs: 5, leadSendMinMs: 115, owdUpMaxMs: 5, posGapMaxMs: 20, periodMs: 20, hubWarn: 0 };
const T = [
  ['a move sent after the last ended', { clip: true, leadSendMinMs: -383, loopLagMaxMs: 690 }, 'client', 'decisive'],
  ['sent under the need (lat + tick + rtt/2 = 11 ms)', { leadSendMinMs: 9 }, 'client', 'decisive'],
  ['sent just over the need', { leadSendMinMs: 12 }, 'unknown', 'likely'],
  ['uplink delay ate the lead', { owdUpMaxMs: 300 }, 'network', 'likely'],
  ['uplink delay inside the lead', { owdUpMaxMs: 100 }, 'unknown', 'likely'],
  ['a position gap past 3 periods, this page healthy', { posGapMaxMs: 410 }, 'network', 'likely'],
  ['a position gap, but this page stalled', { posGapMaxMs: 410, loopLagMaxMs: 200 }, 'unknown', 'likely'],
  ['starved, delivered on time, the machine warned', { starved: true, hubWarn: 3 }, 'hub', 'likely'],
  ['starved with no machine word', { starved: true }, 'unknown', 'likely'],
  ['starved 4 s after a measured uplink delay', { starved: true, hubWarn: 3, owdRecentMaxMs: 300 }, 'network', 'likely'],
  ['a 5 s old delay does not explain a send', { owdRecentMaxMs: 300 }, 'unknown', 'likely'],
  ['starved right after this page stalled', { starved: true, loopLagMaxMs: 310, leadSendMinMs: 17 }, 'client', 'likely'],
  ['starved while the page hid', { starved: true, hidden: true }, 'client', 'likely'],
  ['clip wins over a network delay at once', { clip: true, owdUpMaxMs: 300 }, 'client', 'decisive'],
  ['nothing measured', { leadSendMinMs: null, owdUpMaxMs: null, posGapMaxMs: null }, 'unknown', 'likely'],
];
for (const [name, e, cause, conf] of T) {
  const c = classify({ ...base, ...e });
  ok(name + ' -> ' + cause, c.cause === cause && c.confidence === conf && typeof c.why === 'string', c);
}

console.log('\n--- the tracker (fake clock) ---');
{
  const log = [];
  const tr = createTracker({ open: (i) => log.push(['open', i.cond, i.sev, i.count]), update: (i) => log.push(['update', i.cond, i.sev, i.count]),
    close: (i) => log.push(['close', i.cond]) });
  // slow-link: hold 10 s, clear 30 s.
  for (let t = 0; t <= 9000; t += 1000) tr.level('slow-link', 'warn', t);
  ok('a level condition waits out its hold', !log.length, log);
  tr.level('slow-link', 'warn', 10000);
  ok('...and opens at it', log.length === 1 && log[0][0] === 'open', log);
  for (let t = 11000; t <= 39000; t += 1000) tr.level('slow-link', null, t);
  ok('clears only after its clear hold', !log.some((l) => l[0] === 'close'), log);
  tr.level('slow-link', null, 41000);
  ok('...then closes', log.some((l) => l[0] === 'close'), log);
  for (let t = 50000; t <= 60000; t += 1000) tr.level('slow-link', 'warn', t);
  ok('re-entry within 60 s reopens the same incident, count 2', log[log.length - 1].join() === 'update,slow-link,warn,2', log);
  tr.level('slow-link', 'act', 61000);
  ok('severity rises inside an incident', tr.incidents['slow-link'].sev === 'act');
  tr.level('slow-link', 'warn', 62000);
  ok('...and never falls while open', tr.incidents['slow-link'].sev === 'act');
  // background: hold 0, clear 0.
  tr.level('background', 'warn', 70000);
  tr.level('background', null, 70100);
  ok('hold 0 / clear 0: opens and closes on the signal', tr.incidents.background.closedAt === 70100);
}
{
  const opened = [], updated = [];
  const tr = createTracker({ open: (i) => opened.push(i.count), update: (i) => updated.push(i.count) });
  tr.event('cutout-client', 0, { sizeMs: 400 });
  tr.event('cutout-client', 3000, { sizeMs: 200 });
  const i = tr.incidents['cutout-client'];
  ok('episodes 3 s apart merge into one (10 s window), sizes add', i.count === 1 && i.durationMs === 600, i);
  tr.event('cutout-client', 20000, { sizeMs: 100 });
  ok('an episode 17 s later counts again', i.count === 2 && i.durationMs === 700, i);
  ok('warn below the rate', i.sev === 'warn');
  tr.event('cutout-client', 35000, { sizeMs: 100 });
  ok('3 episodes in 60 s escalate to act', i.count === 3 && i.sev === 'act', i);
  tr.tick(64000);
  ok('an episodic incident stays open inside its clear hold', i.closedAt == null);
  tr.tick(65001);
  ok('...and closes 30 s after its last episode', i.closedAt === 65001);
  tr.event('cutout-network', 0, { sizeMs: 190, overlap: true });
  tr.event('cutout-network', 500, { sizeMs: 210, overlap: true });
  tr.event('cutout-network', 1000, { sizeMs: 180, overlap: true });
  ok('overlapping samples of one episode size it by the largest', tr.incidents['cutout-network'].durationMs === 210, tr.incidents['cutout-network']);
  tr.event('cutout-client', 90000, { sizeMs: 400, confidence: 'decisive', why: 'sent late' });
  tr.event('cutout-client', 90300, { sizeMs: 30, overlap: true, confidence: 'likely', why: 'ran out after a stall' });
  ok('a measured cause is not overwritten by an inferred one', tr.incidents['cutout-client'].confidence === 'decisive'
    && tr.incidents['cutout-client'].why === 'sent late', tr.incidents['cutout-client']);
}

console.log('\n--- growth ---');
const flat = Array.from({ length: 30 }, (_, i) => 80 + (i % 3));
const lagFlat = Array.from({ length: 30 }, () => 6);
ok('a flat floor is no growth', !growth(flat, lagFlat));
const leak = Array.from({ length: 21 }, (_, i) => 80 + i * 1.8);
ok('+9 MB per 5 min for 3 windows is growth', growth(leak, lagFlat.slice(0, 21)));
const slowLeak = Array.from({ length: 21 }, (_, i) => 80 + i * 1.2);
ok('+6 MB per 5 min is not', !growth(slowLeak, lagFlat.slice(0, 21)));
const rising = Array.from({ length: 12 }, (_, i) => 80 + i * 0.5);
const lagUp = [6, 6, 6, 6, 6, 6, 6, 14, 15, 16, 17, 18];
ok('lag at twice the baseline for 5 min while the floor rises is growth', growth(rising, lagUp));
ok('lag up with a flat floor is not', !growth(Array(12).fill(80), lagUp));
ok('quantile', quantile([5, 1, 3, null, 4, 2], 0.5) === 3 && quantile([], 0.5) === null);

console.log('\n' + (fails ? 'FAIL -- ' + fails : 'PASS -- health core'));
process.exit(fails ? 1 : 0);
