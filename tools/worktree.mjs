// Lane worktrees for multi-agent passes (docs/BUILD.md, "Lanes"):
//   node tools/worktree.mjs create <lane> | remove <lane> | list
// A lane is ../Phosphor-lp-<lane> on branch lp/<lane> from main, node_modules junctioned
// from the main checkout. remove refuses a dirty lane or a branch not merged into main.
import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
const MAIN = dirname(git(process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir'));
const [cmd, lane] = process.argv.slice(2);
const die = (msg) => { console.error(msg); process.exit(1); };

if (cmd === 'list') {
  const lanes = git(MAIN, 'worktree', 'list').split('\n').filter((l) => l.includes('[lp/'));
  console.log(lanes.join('\n') || 'no lanes');
  process.exit(0);
}
if (!['create', 'remove'].includes(cmd) || !/^[\w-]+$/.test(lane || '')) die('usage: node tools/worktree.mjs create <lane> | remove <lane> | list');

const dir = join(dirname(MAIN), 'Phosphor-lp-' + lane);
const branch = 'lp/' + lane;
const nm = join(dir, 'node_modules');

if (cmd === 'create') {
  if (existsSync(dir)) die(dir + ' already exists');
  git(MAIN, 'worktree', 'add', '-b', branch, dir, 'main');
  symlinkSync(join(MAIN, 'node_modules'), nm, 'junction');
  // Self-ignoring: lane evidence never reaches a commit; files already tracked stay tracked.
  writeFileSync(join(dir, 'test', 'evidence', '.gitignore'), '*\n');
  console.log(`lane ${lane}: ${dir} on ${branch}`);
} else {
  if (!existsSync(dir)) die(dir + ' does not exist');
  const dirty = git(dir, 'status', '--porcelain');
  if (dirty) die(`refusing: ${dir} has uncommitted changes:\n${dirty}`);
  try { git(MAIN, 'merge-base', '--is-ancestor', branch, 'main'); } catch {
    die(`refusing: ${branch} is not fully merged into main; merge it first (lane left in place)`);
  }
  // The junction goes first so nothing deletes through it into the main checkout's node_modules.
  try { unlinkSync(nm); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  git(MAIN, 'worktree', 'remove', dir);
  git(MAIN, 'branch', '-D', branch);
  console.log(`lane ${lane}: removed ${dir} and ${branch}`);
}
