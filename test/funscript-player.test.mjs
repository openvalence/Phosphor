/**
 * funscript-player.test.mjs -- the funscript player plugin (epic ph-smvd).
 *
 * Section (a) is the contract stub: it imports every module the contract
 * names and fails on any missing export, so a builder who drifts from
 * plugins/factory/funscript-player/CONTRACT.md fails fast. The plugin builder
 * (ph-smvd.6) grows this file into the fake-hub browser test and the --live
 * smoke; it joins package.json only then.
 *
 * Constraints:
 * - Section (a) runs under plain node: no module may touch the DOM at import time.
 * - The export lists below are CONTRACT.md's; change both in one commit.
 */
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};

const P = '../plugins/factory/funscript-player/';
const CONTRACT = {
  [P + 'funscript.js']: ['MAX_SPAN_MS', 'AXES', 'parseFunscript', 'axisOf', 'pairFiles', 'posAt', 'indexAfter',
    'speedAt', 'thin', 'heat', 'fmtTime'],
  [P + 'clock.js']: ['CLOCK_WINDOW', 'SLEW_MS_PER_S', 'STEP_MS', 'FALLBACK_AFTER_MS', 'createMediaClock', 'frameSource'],
  [P + 'scheduler.js']: ['STOP_MS', 'PREROLL_MIN_MS', 'PREROLL_STROKE_MS', 'PREROLL_SKIP', 'OFFER_MAX', 'TRANSIENT',
    'applyT', 'strokeSpeed', 'createScheduler'],
  [P + 'stash.js']: ['SCENES_QUERY', 'SORTS', 'COPY', 'normalizeBase', 'rebase', 'withKey', 'toScene', 'createStash'],
  [P + 'library.js']: ['CSS', 'COPY', 'mountLibrary', 'mountConnect'],
  [P + 'ui.js']: ['CSS', 'COPY', 'createPlayer'],
  [P + 'timeline.js']: ['ZOOMS', 'CSS', 'COPY', 'curvePoints', 'seekAt', 'mountTimeline'],
  [P + 'prefs.js']: ['PREFS', 'readPrefs', 'writePref'],
  [P + 'index.js']: ['activate'],
  '../src/model/motion.js': ['SEG_FLOOR_MS', 'streamGate', 'createMotionDoor', 'bundleHead', 'motionStream'],
  '../src/model/actions.js': ['railOwners', 'railOwnerName'],
  '../src/plugins/host.js': ['MOTION_HOLD_MS', 'createPluginHost', 'validateManifest'],
};

// ---- (a) every module exports what CONTRACT.md names ------------------------
console.log('(a) contract exports');
const mods = {};
for (const [path, names] of Object.entries(CONTRACT)) {
  let m = null;
  try { m = await import(new URL(path, import.meta.url)); } catch (e) { ok(path + ' imports', false, e.message); continue; }
  mods[path] = m;
  const missing = names.filter((n) => !(n in m));
  ok(path.replace(P, ''), missing.length === 0, missing.length ? 'missing ' + missing.join(', ') : '');
}

const door = mods['../src/model/motion.js'];
if (door && door.createMotionDoor) {
  const submit = door.createMotionDoor({ session: () => null, entries: () => [], setpoint: () => ({ ok: false }), log: () => {} });
  ok('createMotionDoor(...).segments is a function', typeof submit.segments === 'function');
}

const host = mods['../src/plugins/host.js'];
const manifest = JSON.parse(readFileSync(new URL(P + 'manifest.json', import.meta.url), 'utf8'));
if (host && host.validateManifest) {
  const problems = host.validateManifest(manifest);
  ok('manifest validates', problems.length === 0, problems.join('; '));
}
ok('manifest declares motion and net.fetch, never intent',
  manifest.permissions.includes('motion') && manifest.permissions.includes('net.fetch') && !manifest.permissions.includes('intent'));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
