// Runs the suite chains in package.json N at a time: `node test/run-suites.mjs check|browser`.
// The serial chains (check:serial, test:browser:serial) are the single source of truth for the
// suite list; this file only schedules them. SUITES_PARALLEL sets N (default min(8, cpus/4)).
// Every suite is independent: browser suites bind ephemeral ports (listen(0)) and own their
// chromium; no check file binds a fixed port or writes a shared path (fake-stash and the
// tmpdir users get unique ones). A suite that does must be named in SERIAL_LANE: it runs
// one at a time, alongside the parallel pool. copy-lint runs last, after everything else.
// PHOSPHOR_DIST=<dir> runs the browser suites against that build (test/dist.mjs).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';

const SERIAL_LANE = []; // substrings of a suite command, e.g. 'responsive-matrix' if it ever contends
const LAST = 'copy-lint';

const set = process.argv[2];
const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const chain = { check: 'check:serial', browser: 'test:browser:serial' }[set];
if (!chain) { console.error('usage: run-suites.mjs check|browser'); process.exit(2); }

// "npm run check:x" resolves to that script's text; "node a b" is spawned directly.
const suites = scripts[chain].split(' && ').map((c) => {
  const m = /^npm run (\S+)$/.exec(c.trim());
  const cmd = (m ? scripts[m[1]] : c).trim().split(/\s+/);
  return { name: m ? m[1] : cmd.find((a) => a.endsWith('.mjs')).replace(/^test\/|\.mjs$/g, ''), cmd };
});

const N = Number(process.env.SUITES_PARALLEL) || Math.max(1, Math.min(8, Math.floor(cpus().length / 4)));
const results = [];
const run = (s) => new Promise((done) => {
  const t0 = Date.now();
  const p = spawn(s.cmd[0] === 'node' ? process.execPath : s.cmd[0], s.cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('error', (e) => { out += String(e); });
  p.on('close', (code) => {
    const sec = (Date.now() - t0) / 1000;
    const r = { name: s.name, pass: code === 0, sec };
    results.push(r);
    console.log(`\n--- ${s.name} (last 15 lines)\n${out.trimEnd().split('\n').slice(-15).join('\n')}\n${r.pass ? 'PASS' : 'FAIL'} ${s.name} ${sec.toFixed(1)}s`);
    done();
  });
});

const pool = async (list, width) => {
  const q = [...list];
  await Promise.all(Array.from({ length: Math.min(width, q.length) }, async () => { while (q.length) await run(q.shift()); }));
};

const t0 = Date.now();
const last = suites.filter((s) => s.cmd.join(' ').includes(LAST));
const rest = suites.filter((s) => !last.includes(s));
const lane = rest.filter((s) => SERIAL_LANE.some((x) => s.cmd.join(' ').includes(x)));
const par = rest.filter((s) => !lane.includes(s));
console.log(`${set}: ${suites.length} suites, ${N} at a time`);
await Promise.all([pool(par, N), pool(lane, 1)]);
await pool(last, 1);

console.log('\nsuite'.padEnd(34) + 'result  seconds');
for (const r of results) console.log(r.name.padEnd(33) + (r.pass ? 'PASS ' : 'FAIL ') + '  ' + r.sec.toFixed(1));
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(bad.length ? 1 : 0);
