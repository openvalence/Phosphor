/**
 * compare.mjs -- two replay traces of one seed (cluster.mjs --replay), scored against each other: Neutrino
 * against a real hub, or Neutrino against Neutrino (two runs of a seed must score identical).
 *
 *   node test/cluster/compare.mjs A.json B.json [--tol 0.005] [--json OUT]
 *
 * Scorecard rows: the actions sent (kinds, in order), each action's answer (ECHO or the NACK name, in order),
 * refusals (NACK names and stream refusal reasons, as multisets), anomaly kinds and counts (kinetic-diag's
 * counters at the end, and the motion-anomaly events), the plan while a script streams (plan.current from the
 * plan strip, aligned at the first segment's execution start, on a 20 ms grid: the share of points within
 * --tol of the window, default 0.5 %, of the other run within --slack ms, default 25), and the hub-side
 * flags. Exit 0 when every row passes.
 *
 * Constraints: a trace is session-relative milliseconds; both runs must be the same seed with the same
 * hw-safe setting, or the comparison is refused. The slack is the client's own timing: every action lands
 * on a 10 ms step and every play or seek restamps the script from now(), so two runs of one seed run the same
 * path shifted by a few milliseconds per action; a real link adds its latency.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const files = argv.filter((a, i) => !a.startsWith('--') && !['--tol', '--json', '--slack'].includes(argv[i - 1]));
if (files.length !== 2) { console.log('usage: node test/cluster/compare.mjs A.json B.json [--tol 0.005] [--slack 25] [--json OUT]'); process.exit(2); }
const TOL = Number(argOf('--tol', 0.005)), SLACK = Number(argOf('--slack', 25));
const [A, B] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
if (A.seed !== B.seed || A.hwSafe !== B.hwSafe) { console.log(`refused: seed ${A.seed}/${B.seed}, hw-safe ${A.hwSafe}/${B.hwSafe}`); process.exit(2); }

const multiset = (xs) => xs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
function msDiff(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] || 0) !== (b[k] || 0)) out[k] = [a[k] || 0, b[k] || 0];
  return out;
}
const of = (tr, k) => tr.filter((e) => e[1] === k);
const DIAGK = ['failures', 'anomalies', 'anom_settle', 'anom_endvel_clamped', 'anom_knot_trimmed', 'anom_dwell_zeroed', 'anom_knot_refused', 'anom_piece_over_ceiling'];

/** plan.current (window share) samples, time zero at the first plan that starts after the first stream play. */
function series(tr) {
  const play = (tr.find((e) => e[1] === 'act' && e[2][0] === 'stream:play') || [null])[0];
  if (play == null) return { t0: null, pts: [] };
  const first = of(tr, 'plan').find((e) => e[0] >= play && e[2][0] !== 0 && e[0] - e[2][5] / 1000 >= play - 5);
  const t0 = first ? first[0] - first[2][5] / 1000 : play;
  // While a script streams: from a play or seek (after a 300 ms lead-in) to whatever ends or disturbs it. A
  // stop, a latch or a generator lands wherever the clock happened to be, so rest positions are not compared.
  const spans = [];
  let open = null;
  for (const e of tr) {
    const k = e[1] === 'act' ? e[2][0] : e[1] === 'closed' ? 'closed' : null;
    if (!k) continue;
    if (k === 'stream:play' || k === 'stream:seek') { if (open != null) spans.push([open, e[0]]); open = e[0] + 300; }
    else if (open != null && /^(stream:(stop|held|end)|reconnect|refetch|closed|safety:|recover:|home|intent:pattern|samples)/.test(k)) { spans.push([open, e[0]]); open = null; }
  }
  if (open != null) spans.push([open, Infinity]);
  return { t0, spans: spans.map(([a, b]) => [a - t0, b - t0]), pts: of(tr, 'plan').map((e) => [e[0] - t0, e[2][3]]).filter((p) => Number.isFinite(p[1])) };
}
const inSpans = (spans, t) => spans.some(([a, b]) => t >= a && t < b);
function at(pts, t) {
  let lo = 0, hi = pts.length - 1;
  if (!pts.length || t < pts[0][0]) return NaN;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m][0] <= t) lo = m; else hi = m - 1; }
  const a = pts[lo], b = pts[lo + 1];
  return b && b[0] - a[0] < 200 ? a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]) : a[1];
}

const rows = [];
const row = (client, name, pass, detail) => rows.push({ client, name, pass, detail });
const n = Math.min(A.clients.length, B.clients.length);
if (A.clients.length !== B.clients.length) row('-', 'client count', false, A.clients.length + ' vs ' + B.clients.length);
for (let c = 0; c < n; c++) {
  const ta = A.clients[c].trace, tb = B.clients[c].trace, id = A.clients[c].seed;
  const acts = (tr) => of(tr, 'act').map((e) => e[2][0]);
  const aa = acts(ta), ab = acts(tb);
  const firstDiff = aa.findIndex((k, i) => i < ab.length && k !== ab[i]);
  // A run's last action or two may fall either side of its end.
  row(id, 'actions in order', firstDiff < 0 || firstDiff >= Math.min(aa.length, ab.length) - 2,
    firstDiff < 0 ? aa.length + ' actions' + (aa.length !== ab.length ? ' vs ' + ab.length : '') : `diverge at #${firstDiff}: ${aa[firstDiff]} vs ${ab[firstDiff]}`);
  const res = (tr) => of(tr, 'res').map((e) => e[2][0] + ':' + e[2][1]);
  const ra = res(ta), rb = res(tb);
  const m = Math.min(ra.length, rb.length);
  const bad = [];
  for (let i = 0; i < m; i++) if (ra[i] !== rb[i]) bad.push(`#${i} ${ra[i]} vs ${rb[i]}`);
  row(id, 'answers in order', !bad.length && ra.length === rb.length, `${m - bad.length}/${Math.max(ra.length, rb.length)} alike` + (bad.length ? '; ' + bad.slice(0, 4).join('; ') : ''));
  const nk = msDiff(multiset(of(ta, 'nack').map((e) => e[2][1])), multiset(of(tb, 'nack').map((e) => e[2][1])));
  row(id, 'NACKs by name', !Object.keys(nk).length, Object.keys(nk).length ? JSON.stringify(nk) : 'same');
  const rf = msDiff(multiset(of(ta, 'ref').map((e) => e[2].join(':'))), multiset(of(tb, 'ref').map((e) => e[2].join(':'))));
  row(id, 'stream refusals', !Object.keys(rf).length, Object.keys(rf).length ? JSON.stringify(rf) : 'same');
  const last = (tr) => (of(tr, 'diag').at(-1) || [0, 0, {}])[2];
  const da = last(ta), db = last(tb);
  const dd = {};
  for (const k of DIAGK) if ((da[k] || 0) !== (db[k] || 0)) dd[k] = [da[k] || 0, db[k] || 0];
  const kinds = (d) => DIAGK.filter((k) => k.startsWith('anom_') && d[k] > 0).join(',');
  row(id, 'anomaly kinds', kinds(da) === kinds(db), kinds(da) + ' | ' + kinds(db));
  row(id, 'anomaly counts', !Object.keys(dd).length, Object.keys(dd).length ? JSON.stringify(dd) : 'same');
  const ev = msDiff(multiset(of(ta, 'anom').map((e) => e[2][0])), multiset(of(tb, 'anom').map((e) => e[2][0])));
  row(id, 'anomaly events', !Object.keys(ev).length, Object.keys(ev).length ? JSON.stringify(ev) : 'same');
  const sa = series(ta), sb = series(tb);
  if (sa.t0 == null || sb.t0 == null) row(id, 'plan while streaming', sa.t0 == null && sb.t0 == null, 'no stream played');
  else {
    const end = Math.min(sa.pts.at(-1)?.[0] ?? 0, sb.pts.at(-1)?.[0] ?? 0);
    const errs = [];
    for (let t = 0; t <= end; t += 20) {
      if (!inSpans(sa.spans, t) || !inSpans(sb.spans, t)) continue;
      const x = at(sa.pts, t);
      if (!Number.isFinite(x)) continue;
      let e = Infinity;
      for (let d = -SLACK; d <= SLACK; d++) { const y = at(sb.pts, t + d); if (Number.isFinite(y)) e = Math.min(e, Math.abs(x - y)); }
      if (Number.isFinite(e)) errs.push(e);
    }
    errs.sort((x, y) => x - y);
    const within = errs.filter((e) => e <= TOL).length / Math.max(1, errs.length);
    row(id, 'plan while streaming', errs.length ? within >= 0.99 : true, `${(within * 100).toFixed(2)} % of ${errs.length} points within ${(TOL * 100).toFixed(2)} % (slack ${SLACK} ms), p99 ${((errs[Math.floor(errs.length * 0.99)] || 0) * 100).toFixed(2)} %, max ${((errs.at(-1) || 0) * 100).toFixed(2)} %`);
  }
}
const fa = A.flags.map((f) => f.kind).sort().join(','), fb = B.flags.map((f) => f.kind).sort().join(',');
row('-', 'hub flags', fa === fb, (fa || 'none') + ' | ' + (fb || 'none'));

console.log(`seed ${A.seed}: ${A.target} (${A.version || '?'}) vs ${B.target} (${B.version || '?'})${A.hwSafe ? ', hw-safe' : ''}`);
for (const r of rows) console.log(`  [${r.pass ? 'SAME' : 'DIFF'}] ${String(r.client).padEnd(6)} ${r.name.padEnd(18)} ${r.detail}`);
const score = rows.filter((r) => r.pass).length;
console.log(`score ${score}/${rows.length}${score === rows.length ? ' -- identical' : ''}`);
if (argOf('--json')) writeFileSync(argOf('--json'), JSON.stringify({ seed: A.seed, a: A.target, b: B.target, rows, score, of: rows.length }, null, 1));
process.exit(score === rows.length ? 0 : 1);
