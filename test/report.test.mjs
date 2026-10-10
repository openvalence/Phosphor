/**
 * report.test.mjs -- the health report (src/model/health/report.js,
 * ph-9t5l.1): the field table covers every field the builder emits, nothing
 * outside the allowlist leaves even when seeded into the ring, the URL budget
 * and its attachment fallback, the issue lookups, the two GitHub files, and
 * against the operator's report KMCBXOPP: every least, typical and worst value
 * over its stated window, a growth incident's own numbers, event kinds.
 * Run: node test/report.test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  FIELDS, URL_BUDGET, buildBundle, fileName, issueState, issueUrl, kindOf, leafPaths, lookupIssue, parseIssueLink, reportId, reportSource,
} from '../src/model/health/report.js';
import { CONDITIONS, quantile } from '../src/model/health/core.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const ROOT = new URL('..', import.meta.url);

// A ring and incident salted with everything a report must never carry.
const SECRET = ['MySecretScene.funscript', 'holiday.mp4', 'bedroom-ossm', '192.168.1.118', 'sess-48151623', 'tok_AbCdEf123',
  'LATE PLAN strip ended', '2026-10-09', '21:47', '0.4242'];
const row = (t, k) => ({ t, rtt: 10 + k, lead: 110 - k, arr: null, gap: 50, lag: 4, fps: 60, heap: 84.5, rssi: null, late: null, owd: 5,
  backlog: 0, script: SECRET[0], video: SECRET[1], pos: 0.4242, hub: SECRET[2], ip: SECRET[3], at: '2026-10-09T21:47:00Z' });
const rows = Array.from({ length: 91 }, (_, k) => row(-60000 + k * 1000, k % 7));
const fine = Array.from({ length: 26 }, (_, k) => ({ t: -2000 + k * 100, lead: 115, owd: 4, gap: 48, target: 0.4242, session: SECRET[4] }));
const inc = { id: reportId(), cond: 'cutout-client', sev: 'warn', cause: 'client', confidence: 'decisive', why: 'a move left after the last one ended',
  count: 2, durationMs: 565, t0: 1000, episodes: [0, 12000], wallAt: Date.now(), text: SECRET[6], session: SECRET[4], token: SECRET[5],
  evidence: { leadSendMinMs: -383, latMs: 1, rttP50Ms: 12.8, owdUpMaxMs: 3.3, posGapMaxMs: 51.2, loopLagMaxMs: 690, backlogMax: 0,
    heapMb: 19.7, fps: 64, reconnects: 0, hubName: SECRET[2], script: SECRET[0] },
  settings: { horizonMs: 250, latMs: 1 } };
const ctx = { app: { version: '0.1.0+233', platform: 'windows', engine: 'chromium-141', shell: true, host: SECRET[3] },
  machine: { firmware: '0.1.33-p4hub-bench', transport: 'ws', name: SECRET[2] } };
const others = [{ cond: 'freeze', t0: 400, episodes: [0], cause: null, text: SECRET[6] }];
const src = reportSource({ inc, snap: { rows, fine }, ctx, hubLog: { warn: 14, error: 0, lines: [SECRET[6]] }, protocol: 1, others });
const b = buildBundle(src);
const json = JSON.stringify(b);

console.log('\n--- the field table ---');
const paths = new Set(FIELDS.map((f) => f.path));
const extra = leafPaths(b).filter((p) => !paths.has(p));
ok('every field the builder emits has a row in FIELDS', !extra.length, extra);
const missing = [...paths].filter((p) => get(b, p) === undefined);
ok('every row in FIELDS is in the bundle', !missing.length, missing);
ok('every row has a plain name, what and why', FIELDS.every((f) => f.name && f.what && f.why));
ok('a field the table lacks never leaves: an unknown source key is not read', !('surprise' in buildBundle({ ...src, surprise: 1 })));
function get(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }

console.log('\n--- the allowlist ---');
const leaked = SECRET.filter((s) => json.includes(s));
ok('no script or video name, position, hub name, address, session id, token, log text, date or time of day', !leaked.length, leaked);
// The fuzz: every source path the builder reads x every secret, in the shape that path takes.
const FUZZ = [...SECRET, '192.168.1.118:82', 'ossm.local', '2026-10-09T21:47:03Z', '21:47:03', 'Bedroom OSSM', 'C:/Users/me/Videos/a.mp4',
  '0.42', '-0.4242', '48151623', 'e3b0c442-98fc-1c14-9afb-f4c8996fb924'];
const shaped = (f, sec) => (f.type === 'series' ? [sec, sec] : f.type === 'events' ? [{ t_ms: sec, kind: sec, cause: sec }] : sec);
const leaks = [];
for (const f of FIELDS) {
  for (const sec of FUZZ) if (JSON.stringify(buildBundle({ ...src, [f.path]: shaped(f, sec) })).includes(sec)) leaks.push(f.path + ' <- ' + sec);
}
ok('fuzz: no secret leaves through any of the ' + FIELDS.length + ' paths (' + FIELDS.length * FUZZ.length + ' cases)', !leaks.length, leaks);
const free = FIELDS.filter((f) => f.type === 'str'
  && JSON.stringify(buildBundle({ ...src, [f.path]: 'g0324780' })).includes('g0324780')).map((f) => f.path);
ok('the only free string is the app build id (g<sha>, so a digit-only sha passes and a digit run does not); ids, file names and conditions are shapes and sets',
  free.join() === 'app.version' && buildBundle({ ...src, id: 'abcdefgh' }).id === null
  && buildBundle({ ...src, attachment: 'notes.json' }).attachment === null
  && buildBundle({ ...src, 'incident.condition': 'my-script' }).incident.condition === null, free);
ok('free strings match the pattern or go null', buildBundle({ ...src, 'machine.firmware': 'fw 1.0; rm -rf' }).machine.firmware === null);
ok('an enum outside its values goes null', buildBundle({ ...src, 'incident.cause': 'aliens' }).incident.cause === null);
ok('times count from the incident: the window spans -60 s to +30 s at 2 s', b.window.from_ms === -60000 && b.window.series.rtt_ms.length === 46
  && b.window.fine.series.lead_send_ms.length === 26);
ok('the cutout reads as cutout with its cause', b.incident.condition === 'cutout' && b.incident.cause === 'client' && b.incident.count === 2);
ok('events carry kind and cause only', b.events.length === 3 && b.events.every((e) => Object.keys(e).join() === 't_ms,kind,cause'), b.events);
ok('hub log: counts only', JSON.stringify(b.hub_log) === '{"warn":14,"error":0}');

console.log('\n--- the operator\'s report KMCBXOPP: windows, growth, kinds ---');
{
  const fx = JSON.parse(readFileSync(new URL('./fixtures/diag-report-growth-sawtooth.json', import.meta.url), 'utf8'));
  const S = fx.window.series;
  // Its 2 s history as the ring rows it was made of, one per point.
  const KEY = { rtt_ms: 'rtt', lead_send_ms: 'lead', arrival_lead_ms: 'arr', downlink_gap_ms: 'gap', loop_lag_ms: 'lag', fps: 'fps', heap_mb: 'heap' };
  const fxRows = S.heap_mb.map((_, i) => Object.fromEntries([['t', fx.window.from_ms + i * fx.window.step_ms],
    ...Object.entries(KEY).map(([k, r]) => [r, S[k][i]])]));
  const g = { id: reportId(), cond: 'growth', sev: 'warn', count: 1, durationMs: 35 * 60000, t0: 1000, episodes: [0],
    m: { baseMb: 28, nowMb: 168, minutes: 35, slopeMbPerMin: 4, from: -2099000 }, evidence: { heapMb: 28.1, fps: 236, reconnects: 0 } };
  const gb = buildBundle(reportSource({ inc: g, snap: { rows: fxRows, fine: [] }, ctx, protocol: 1 }));
  const fin = (a) => a.filter(Number.isFinite);
  const want = { loop_lag_ms_max: Math.max(...fin(S.loop_lag_ms)), rtt_ms_max: Math.max(...fin(S.rtt_ms)), rtt_ms_p50: quantile(S.rtt_ms, 0.5),
    lead_send_ms_min: Math.min(...fin(S.lead_send_ms)), downlink_gap_ms_max: Math.max(...fin(S.downlink_gap_ms)), backlog_bytes_max: null };
  ok('every least, typical and worst value is over the stated window, the one the history shows (loop lag 33.9, round trip 38)',
    gb.evidence.from_ms === fx.window.from_ms && gb.evidence.to_ms === fx.window.to_ms
    && Object.entries(want).every(([k, v]) => gb.evidence[k] === v) && want.loop_lag_ms_max === 33.9 && want.rtt_ms_max === 38,
  { got: gb.evidence, want });
  ok('...and the history it states round-trips', JSON.stringify(gb.window.series.loop_lag_ms) === JSON.stringify(S.loop_lag_ms)
    && JSON.stringify(gb.window.series.heap_mb) === JSON.stringify(S.heap_mb));
  const sum = buildBundle(reportSource({ inc: g, snap: { rows: fxRows, fine: [] }, ctx }), { summary: true });
  ok('the summary (the link without history) still states the window', !sum.window && sum.evidence.from_ms === -60000 && sum.evidence.to_ms === 30000, sum.evidence);
  ok('a growth incident carries its own numbers: what grew, from, to, over, how fast', gb.measure.metric === 'heap_floor_mb'
    && gb.measure.baseline === 28 && gb.measure.current === 168 && gb.measure.window_ms === 2100000 && gb.measure.slope_per_min === 4, gb.measure);
  ok('...its cause is this device, measured, and it lasted its growth window', gb.incident.condition === 'growth' && gb.incident.cause === 'client'
    && gb.incident.confidence === 'decisive' && gb.incident.lasted_ms === 2100000, gb.incident);
  ok('a cutout carries no growth numbers', b.measure.metric === null && b.measure.baseline === null);
  const kinds = Object.keys(CONDITIONS).map((cond) => {
    const e = buildBundle(reportSource({ inc: { ...g, cond, m: null }, snap: null, ctx })).events;
    return [cond, e.length === 1 && e[0].kind];
  });
  const off = kinds.filter(([cond, k]) => k !== (cond.startsWith('cutout-') ? 'cutout' : cond));
  ok('every condition\'s event kind is the condition (the cutouts are "cutout"), never "other"', !off.length && kindOf('cutout-hub') === 'cutout', off);
}

console.log('\n--- the URL ---');
const u = issueUrl(src);
const q = u.url.split('?')[1];
const sp = new URLSearchParams(q);
ok('new issue on openvalence/Phosphor with the diag-report form', u.url.startsWith('https://github.com/openvalence/Phosphor/issues/new?template=diag-report.yml&'));
ok('title "Diagnostic report <id>"', sp.get('title') === 'Diagnostic report ' + inc.id);
ok('the compact bundle rides the bundle field and fits', !u.attach && sp.get('bundle') === json && q.length <= URL_BUDGET, q.length);
const big = { ...src, events: Array.from({ length: 40 }, (_, k) => ({ t_ms: -59000 + k * 1234, kind: 'cutout', cause: 'network' })) };
for (const k of Object.keys(big)) if (k.startsWith('window.') && Array.isArray(big[k])) big[k] = big[k].map((_, i) => 1234.5 + i);
const ub = issueUrl(big);
const sb = JSON.parse(new URLSearchParams(ub.url.split('?')[1]).get('bundle'));
ok('over the budget: the full bundle goes to a file, the URL carries the summary', ub.attach && ub.url.split('?')[1].length <= URL_BUDGET
  && sb.attachment === fileName(inc.id) && !sb.window && !sb.events && sb.evidence && JSON.parse(ub.full).window
  && JSON.parse(ub.full).attachment === fileName(inc.id), ub.url.length);
ok('ids are 8 base32 characters, the file name follows', /^[A-Z2-7]{8}$/.test(reportId()) && /^diag-report-[A-Z2-7]{8}\.json$/.test(fileName(reportId())));

console.log('\n--- the issue lookups ---');
const fake = (status, body) => async (url) => { fake.last = url; return { ok: status === 200, status, json: async () => body }; };
const found = await lookupIssue(inc.id, fake(200, { items: [{ title: 'Diagnostic report ' + inc.id, html_url: 'https://github.com/openvalence/Phosphor/issues/7' }] }));
ok('the title search finds the issue', found === 'https://github.com/openvalence/Phosphor/issues/7' && /label%3Adiag-report/.test(fake.last), fake.last);
ok('no hit is null', await lookupIssue(inc.id, fake(200, { items: [] })) === null);
ok('rate-limited is null, never a throw', await lookupIssue(inc.id, fake(403, {})) === null);
ok('a deleted issue reads removed (410)', await issueState('https://github.com/openvalence/Phosphor/issues/7', fake(410, {})) === 'removed');
ok('an open one reads open', await issueState('https://github.com/openvalence/Phosphor/issues/7', fake(200, { state: 'open' })) === 'open');
ok('a pasted link must be this repo\'s issue', parseIssueLink(' https://github.com/openvalence/Phosphor/issues/12 ') === 'https://github.com/openvalence/Phosphor/issues/12'
  && parseIssueLink('https://evil.example/openvalence/Phosphor/issues/1') === null);

console.log('\n--- the GitHub files ---');
const form = new URL('.github/ISSUE_TEMPLATE/diag-report.yml', ROOT);
const flow = new URL('.github/workflows/diag-report-remove.yml', ROOT);
ok('the issue form exists', existsSync(form));
ok('the removal workflow exists', existsSync(flow));
if (existsSync(form)) {
  const f = readFileSync(form, 'utf8');
  ok('the form: labels diag-report, a required json textarea with id bundle, an optional "happened"', /labels:\s*\[\s*diag-report\s*\]/.test(f)
    && /id:\s*bundle[\s\S]*render:\s*json[\s\S]*required:\s*true/.test(f) && /id:\s*happened/.test(f));
}
if (existsSync(flow)) {
  const w = readFileSync(flow, 'utf8');
  const runs = w.split('\n').filter((l) => /^\s*run:|^\s{8,}\S/.test(l)).join('\n');
  ok('the workflow: issue_comment created, GITHUB_TOKEN with no permissions', /issue_comment:\s*\n\s*types:\s*\[created\]/.test(w) && /^permissions:\s*\{\}/m.test(w));
  ok('the workflow: author only, diag-report only, /remove only, all in if:', /if:[\s\S]*diag-report[\s\S]*comment\.user\.login == github\.event\.issue\.user\.login[\s\S]*\/remove/.test(w));
  ok('the workflow: comment text never reaches a shell', !/comment\.body/.test(w.split(/\n\s*steps:/)[1] || ''));
  ok('the workflow: the token is secrets.DIAG_REMOVE_TOKEN, deleteIssue by node id', /secrets\.DIAG_REMOVE_TOKEN/.test(w) && /deleteIssue/.test(w) && /issue\.node_id/.test(w));
  void runs;
}

console.log('\n' + (fails ? 'FAIL -- ' + fails : 'PASS -- health report'));
process.exit(fails ? 1 : 0);
