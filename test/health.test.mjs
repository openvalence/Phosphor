/**
 * health.test.mjs -- the health system's pure half (src/model/health/core.js,
 * ph-9t5l): the cause classifier as a table, the hysteresis tracker on a fake
 * clock, the growth detector on the operator's measured GC sawtooth and on
 * synthetic leaks, and the condition table's copy rules (a measured line with
 * its number, a tooltip that never repeats it).
 * Run: node test/health.test.mjs
 */
import { readFileSync } from 'node:fs';
import { CONDITIONS, CUTOUT, GROWTH, SEV_RANK, classify, createTracker, growth, lineOf, quantile, tipLines } from '../src/model/health/core.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

console.log('\n--- the condition table ---');
ok('28 conditions: 14 link, 8 device, 6 machine', Object.keys(CONDITIONS).length === 28
  && ['link', 'device', 'machine'].map((a) => Object.values(CONDITIONS).filter((c) => c.area === a).length).join() === '14,8,6');
// One incident per condition as the tracker leaves it: its numbers (m) and what the line reads besides.
const M = {
  'send-margin': { leadMs: 40, onMs: 62.5 }, 'slow-link': { p50Ms: 80, p95Ms: 140 }, backlog: { bytes: 1300 }, throttled: { channels: 2 },
  drops: { n: 3 }, 'weak-signal': { dbm: -80 }, 'hub-wifi-drop': { n: 2 }, busy: { p95Ms: 60 }, 'slow-display': { fps: 22 }, 'rail-stalled': { pct: 14 }, 'clock-drift': { ms: 12 },
  growth: { baseMb: 28, nowMb: 168, minutes: 35, slopeMbPerMin: 4 }, workers: { base: 1, now: 5 }, overloaded: { state: 'serious', forMs: 45000 },
  'late-plans': { perMin: 8 }, fault: { label: 'Motor power: inrush' }, 'hub-memory': { dropPct: 25 }, hot: { label: 'Driver', text: '78 °C', max: 85 },
  'log-drops': { n: 12 },
};
const EXTRA = { 'delay-spike': { peakMs: 240 }, 'updates-stalled': { peakMs: 800 }, freeze: { peakMs: 300 } };
/** Yes-or-no conditions: no number to give. */
const QUALITATIVE = ['background', 'fault', 'restarted'];
const incOf = (cond) => {
  const d = CONDITIONS[cond];
  const c = d.cause && classify({ ...{ client: { clip: true, loopLagMaxMs: 690 }, network: { leadSendMinMs: 115, owdUpMaxMs: 300 },
    hub: { starved: true, hubWarn: 3 }, unknown: {} }[d.cause], latMs: 1, rttP50Ms: 10, loopLagMaxMs: d.cause === 'client' ? 690 : 5 });
  return { cond, m: M[cond], count: 1, durationMs: 420, wallAt: Date.UTC(2026, 9, 9, 12), closedAt: null, ...EXTRA[cond], ...(c || {}) };
};
const lines = Object.keys(CONDITIONS).map((id) => [id, lineOf(incOf(id)), tipLines(incOf(id))]);
const bad = lines.filter(([, l]) => !l || l.length > 60 || /\. /.test(l) || /\.$/.test(l));
ok('every line is one fragment under 60 characters (COPY.md)', !bad.length, bad);
const noNum = lines.filter(([id, l]) => !QUALITATIVE.includes(id) && !/\d/.test(l));
ok('every quantitative line carries the number that raised it', !noNum.length, noNum);
ok('no line is a sentence about Phosphor', lines.every(([, l]) => !/phosphor/i.test(l)), lines.map((x) => x[1]));
const echo = lines.filter(([, l, tip]) => !tip.length || tip.join('\n') === l || tip.includes(l));
ok('every tooltip has lines and none repeats the line', !echo.length, echo);
const half = lines.filter(([id, , tip]) => !CONDITIONS[id].logOnly && !CONDITIONS[id].needs && tip.length < 4);
ok('a surfaced tooltip says what was measured, since when, the threshold and the action', !half.length, half);
ok('a line survives an incident with no numbers (a restored one)', Object.keys(CONDITIONS).every((id) => typeof lineOf({ cond: id, count: 1 }) === 'string'));
ok('the growth line: "Memory up 140 MB in 35 min"', lineOf(incOf('growth')) === 'Memory up 140 MB in 35 min', lineOf(incOf('growth')));
ok('the render lines carry their numbers: "Rail stalled on 14% of frames", "Clock drift 12 ms"',
  lineOf(incOf('rail-stalled')) === 'Rail stalled on 14% of frames' && lineOf(incOf('clock-drift')) === 'Clock drift 12 ms',
  [lineOf(incOf('rail-stalled')), lineOf(incOf('clock-drift'))]);
ok('the render tooltips say why in plain words, the threshold and one action', ['rail-stalled', 'clock-drift'].every((id) => tipLines(incOf(id)).length === 4)
  && /late or bunched/.test(tipLines(incOf('rail-stalled'))[0]) && /clocks disagree, so the rail's timing is off/.test(tipLines(incOf('clock-drift'))[0])
  && tipLines(incOf('clock-drift'))[3] === 'Restart Phosphor if it persists', tipLines(incOf('clock-drift')));
ok('no user-facing text says "held" or "skew"', lines.every(([id, l, tip]) => !/\bheld\b|\bskew/i.test(l + tip.join(' ') + CONDITIONS[id].detail)));
ok('a cutout line: the pause and its measured cause', lineOf(incOf('cutout-client')) === 'Motion paused 420 ms · this device stalled 690 ms'
  && lineOf({ ...incOf('cutout-network'), count: 2 }) === 'Motion paused 420 ms · WiFi delay 300 ms (likely) ×2', [lineOf(incOf('cutout-client')), lineOf(incOf('cutout-network'))]);
const silent = Object.entries(CONDITIONS).filter(([id, c]) => !c.logOnly && !['log-drops', 'restarted'].includes(id) && (!c.detail || !c.action));
ok('every surfaced condition has its plain sentence and one action', !silent.length, silent.map((s) => s[0]));
const two = Object.entries(CONDITIONS).filter(([, c]) => /;|, or |, then | then /.test(c.action || ''));
ok('every action is one act', !two.length, two.map((t) => t[0] + ': ' + t[1].action));
ok('no device setting and no jargon in the words', lines.every(([id, l, tip]) => !/stream buffer|smoothness|planner|congest|jitter/i.test(l + tip.join(' ') + CONDITIONS[id].detail)));
ok('every detail is one sentence', Object.values(CONDITIONS).every((c) => !c.detail || (c.detail.match(/\. |\.$/g) || []).length === 1));
ok('a cutout per cause', Object.values(CUTOUT).every((id) => CONDITIONS[id] && CONDITIONS[id].cause));

console.log('\n--- the render conditions on the tracker ---');
{
  // health.svelte.js feeds these once a second from the rail's census: stalled over 10 % (clear at 5 %), drift over 2 ms (clear at 1 ms).
  for (const id of ['rail-stalled', 'clock-drift']) {
    const log = [];
    const tr = createTracker({ open: () => log.push('open'), update: () => log.push('update'), close: () => log.push('close') });
    for (let t = 0; t < 10000; t += 1000) tr.level(id, 'warn', t, { m: {} });
    ok(id + ': nothing before its 10 s hold', !log.length, log);
    tr.level(id, 'warn', 10000, { m: {} });
    ok(id + ': fires at the hold as a warn, so the status slot shows it', log.join() === 'open' && SEV_RANK[tr.incidents[id].sev] >= 1, log);
    for (let t = 11000; t < 40000; t += 1000) tr.level(id, null, t);
    ok(id + ': stays open inside its 30 s clear hold', !log.includes('close'), log);
    tr.level(id, null, 41000);
    ok(id + ': clears after it', log.includes('close'), log);
  }
}

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
  ['measured: a stall here inflates the uplink and the gap, never WiFi', { latMs: 1, rttP50Ms: 14, leadSendMinMs: 35, owdUpMaxMs: 95,
    loopLagMaxMs: 92, posGapMaxMs: 140, periodMs: 20 }, 'unknown', 'likely'],
  ['a 5 s old delay does not explain a send', { owdRecentMaxMs: 300 }, 'unknown', 'likely'],
  ['starved right after this page stalled', { starved: true, loopLagMaxMs: 310, leadSendMinMs: 17 }, 'client', 'likely'],
  ['starved while the page hid', { starved: true, hidden: true }, 'client', 'likely'],
  ['clip wins over a network delay at once', { clip: true, owdUpMaxMs: 300 }, 'client', 'decisive'],
  ['nothing measured', { leadSendMinMs: null, owdUpMaxMs: null, posGapMaxMs: null }, 'unknown', 'likely'],
];
for (const [name, e, cause, conf] of T) {
  const c = classify({ ...base, ...e });
  ok(name + ' -> ' + cause, c.cause === cause && c.confidence === conf && typeof c.why === 'string' && typeof c.fact === 'string', c);
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
// The operator's report KMCBXOPP (2026-10-09, the shell on Windows): a healthy GC sawtooth, 28 to 49 MB every 10 to 20 s,
// that the old detector called growth. Its 2 s points replay as 1 Hz samples, looped; health.svelte.js folds 60 into a floor.
const fx = JSON.parse(readFileSync(new URL('./fixtures/diag-report-growth-sawtooth.json', import.meta.url), 'utf8'));
const saw = fx.window.series.heap_mb.flatMap((v) => [v, v]);
const sawAt = (s) => saw[s % saw.length];
/** Minutes of 1 Hz heap samples through the minute floors and the detector, as perMinute runs it; every minute it fired. */
function replay(heapAt, minutes) {
  const floors = [], fired = [];
  for (let m = 0; m < minutes; m++) {
    floors.push(Math.min(...Array.from({ length: 60 }, (_, s) => heapAt(m * 60 + s))));
    if (floors.length > 120) floors.shift();
    const g = growth(floors);
    if (g) fired.push({ m: m + 1, ...g });
  }
  return fired;
}
ok('the fixture is the sawtooth: 28 to 49 MB, ending lower than it started', Math.min(...saw) === 28.1 && Math.max(...saw) === 48.8 && saw[saw.length - 1] < saw[0]);
ok("the operator's sawtooth looped for 4 h never fires", !replay(sawAt, 240).length, replay(sawAt, 240)[0]);
ok('...nor with a 0.5 MB a minute creep for 2 h (60 MB: tens of MB never trip it)', !replay((s) => sawAt(s) + Math.min(s, 7200) / 120, 240).length);
ok('...nor with one 150 MB step (a big script loaded)', !replay((s) => sawAt(s) + (s > 3600 ? 150 : 0), 240).length);
ok('...nor with 1 MB a minute for 50 min, then flat', !replay((s) => sawAt(s) + Math.min(s, 3000) / 60, 240).length);
const leak5 = replay((s) => sawAt(s) + s / 12, 60);
ok('a 5 MB a minute leak on the same sawtooth fires at 30 min, with its numbers', leak5.length && leak5[0].m === 30
  && Math.abs(leak5[0].slopeMbPerMin - 5) < 0.6 && leak5[0].minutes === 25 && leak5[0].nowMb - leak5[0].baseMb >= GROWTH.riseMb, leak5[0]);
const leak2 = replay((s) => sawAt(s) + s / 30, 120);
ok('a 2 MB a minute leak fires once it is 100 MB up, about 55 min in', leak2.length && leak2[0].m >= 50 && leak2[0].m <= 60, leak2[0]);
ok('a leak that stops rising breaks the run: no new fire after it levels off', !replay((s) => sawAt(s) + Math.min(s, 2400) / 12, 240).filter((f) => f.m > 50).length);
ok('quantile', quantile([5, 1, 3, null, 4, 2], 0.5) === 3 && quantile([], 0.5) === null);

console.log('\n--- the Machine card power readings (RFC-109) ---');
{
  const { reportedReading } = await import('../src/model/settings.js');
  const { PACKED } = await import('../../Valence/clients/js/index.js');
  const bus = { name: 'bus_mV', role: 'telemetry.power.bus', type: PACKED.u16, scale: 1000 };
  const draw = { name: 'draw_w10', role: 'telemetry.power.draw', type: PACKED.u16, scale: 10 };
  ok('a reading reads as itself, 0 W included', reportedReading(bus, { bus_mV: 36.012 }) === 36.012 && reportedReading(draw, { draw_w10: 0 }) === 0);
  ok('65535 on the wire is no reading, never 65.535 V or 6553.5 W', reportedReading(bus, { bus_mV: 65.535 }) === null && reportedReading(draw, { draw_w10: 6553.5 }) === null);
  ok('the saturated top is a reading', reportedReading(bus, { bus_mV: 65.534 }) === 65.534);
  ok('a field of another role keeps its top', reportedReading({ ...bus, role: 'telemetry.position' }, { bus_mV: 65.535 }) === 65.535);
  ok('no sample is no reading', reportedReading(bus, undefined) === null);
}

console.log('\n' + (fails ? 'FAIL -- ' + fails : 'PASS -- health core'));
process.exit(fails ? 1 : 0);
