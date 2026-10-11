/**
 * arcade.test.mjs -- the arcade's motion (plugins/factory/arcade/drive.js) driven by its real games
 * against a stub api: no consent no motion, every segment inside the limits, Pause stops it and it
 * never resumes on its own, a refusal stops it, input loss runs out within the quiet window, a stop
 * brakes and holds. Node only (no DOM); part of npm run check.
 */
import { createDrive, CAPS } from '../plugins/factory/arcade/drive.js';
import { GAMES } from '../plugins/factory/arcade/games.js';

let fails = 0;
const ok = (n, c, extra) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (extra ? '  -- ' + extra : '')); if (!c) fails++; };

/** A hub as the plugin sees it: fields by role, values, a gate and the motion door, all recorded. */
function stubApi({ pos = 30, lo = 10, hi = 110, vmax = null, amax = null, target = true } = {}) {
  const f = (role, unit, unitId) => ({ role, unit, unitId });
  const fields = {
    target: target ? f('input.target', '', null) : null, pos: f('telemetry.position', 'mm', 0),
    lo: f('window.min', 'mm', 0), hi: f('window.max', 'mm', 0),
    vmax: vmax ? f('limit.input.speed', 'mm/s', 1) : null, amax: amax ? f('limit.input.accel', 'mm/s²', 2) : null,
  };
  const values = new Map([[fields.pos, pos], [fields.lo, lo], [fields.hi, hi], [fields.vmax, vmax], [fields.amax, amax]]);
  const api = {
    sent: [], calls: 0, gateWords: '', refuse: null,
    field: (role) => Object.values(fields).find((x) => x && x.role === role) || null,
    value: (x) => values.get(x),
    gate: () => api.gateWords,
    submitSegments(list) {
      api.calls++;
      if (api.refuse) return { ok: false, sent: 0, reason: api.refuse };
      api.sent.push(...list);
      return { ok: true, sent: list.length, rateHz: 50 };
    },
  };
  return api;
}

/** Plays `game` for `secs` at 60 frames a second with wandering input; returns the drive and the clock. */
function play(game, api, { secs = 20, allow = true, onFrame = () => {} } = {}) {
  let t = 1000;
  const drive = createDrive(api, { now: () => t });
  const refused = allow ? drive.allow(true) : null;
  let s = game.create();
  const codes = { road: ['ArrowLeft', 'ArrowRight'], bat: ['Space'], song: ['ArrowUp', 'ArrowDown', 'Digit3', 'Digit9'] }[game.id];
  for (let i = 0; i < secs * 60; i++) {
    t += 1000 / 60;
    if (i % 20 === 0) { const c = codes[Math.floor(Math.random() * codes.length)]; game.key(s, c, true); if (Math.random() < 0.5) game.key(s, c, false); }
    if (s.over) s = game.create();
    drive.tick(game.step(s, 1 / 60));
    onFrame(i, drive, () => t);
  }
  return { drive, t, refused };
}

/** Every segment's speed and the speed change between back-to-back segments, against caps. */
function limits(sent, start, caps) {
  let prev = start, vPrev = 0, end = 0, worstV = 0, worstA = 0;
  for (const x of sent) {
    const v = (x.norm - prev) / (x.durationMs / 1000);
    worstV = Math.max(worstV, Math.abs(v));
    if (Math.abs(x.atMs - end) < 1e-6) worstA = Math.max(worstA, Math.abs(v - vPrev) / (x.durationMs / 1000));
    else worstA = Math.max(worstA, Math.abs(v) / (x.durationMs / 1000));   // from rest
    prev = x.norm; vPrev = x.endVel === 0 ? 0 : v; end = x.atMs + x.durationMs;
  }
  return { worstV, worstA, inWindow: sent.every((x) => x.norm >= 0 && x.norm <= 1) };
}

console.log('\n--- no consent ---');
for (const g of GAMES) {
  const api = stubApi();
  play(g, api, { secs: 5, allow: false });
  ok(g.name + ': without Allow motion no segment is ever offered', api.calls === 0, api.calls + ' calls');
}
{
  const api = stubApi({ pos: NaN });
  const d = createDrive(api, { now: () => 0 });
  ok('no reported position refuses Allow motion', d.allow(true) === 'the machine reports no position' && !d.allowed && api.calls === 0);
  const a2 = stubApi({ target: false });
  ok('no motion input refuses it', createDrive(a2, { now: () => 0 }).allow(true) === 'this machine takes no motion input');
  const a3 = stubApi();
  a3.gateWords = 'e-stop latched';
  ok('a latched e-stop refuses it in the gate\'s words', createDrive(a3, { now: () => 0 }).allow(true) === 'e-stop latched' && a3.calls === 0);
}

console.log('\n--- limits ---');
for (const g of GAMES) {
  for (const ceil of [{}, { vmax: 100, amax: 400 }]) {
    const api = stubApi(ceil);
    const { drive } = play(g, api, { secs: 30 });
    const caps = drive.caps();
    const segs = api.sent.filter((x) => x.durationMs > 0);
    const m = limits(segs, 0.2, caps);
    const tag = g.name + (ceil.vmax ? ' under a 100 mm/s, 400 mm/s² machine on 100 mm' : ' with no ceilings reported');
    ok(tag + ': it moves', segs.length > 100 && drive.allowed, segs.length + ' segments');
    ok(tag + ': speed stays at or under ' + caps.v.toFixed(2) + ' of the window a second', m.worstV <= caps.v + 1e-9, m.worstV.toFixed(3));
    ok(tag + ': acceleration stays at or under ' + caps.a.toFixed(2), m.worstA <= caps.a + 1e-9, m.worstA.toFixed(3));
    ok(tag + ': every target sits in the window', m.inWindow);
    if (ceil.vmax) ok(tag + ': 40 % of the machine\'s ceilings', Math.abs(caps.v - 0.4) < 1e-9 && Math.abs(caps.a - 1.6) < 1e-9, JSON.stringify(caps));
  }
}

console.log('\n--- pause ---');
for (const g of GAMES) {
  const api = stubApi();
  let at = -1;
  play(g, api, { secs: 10, onFrame: (i) => { if (i === 300) { api.gateWords = 'paused, resume to continue'; at = api.calls; } if (i === 420) api.gateWords = ''; } });
  ok(g.name + ': Pause stops its motion at once and it never resumes on its own', at > 0 && api.calls === at, at + ' then ' + api.calls);
}
{
  const api = stubApi();
  let t = 0;
  const d = createDrive(api, { now: () => t });
  d.allow(true);
  api.gateWords = 'paused, resume to continue';
  d.check();
  api.gateWords = '';
  t += 500;
  d.tick(0.9);
  ok('a Pause between games drops the consent too', !d.allowed && api.calls === 1 && d.reason.startsWith('paused'), d.reason);
}
{
  const api = stubApi();
  play(GAMES[1], api, { secs: 6, onFrame: (i) => { if (i === 120) api.refuse = 'motion input in use by funscript-player'; } });
  const after = api.calls;
  ok('a refusal at the door stops it with no hold', api.sent.every((x) => x.endVel !== 0), after + ' calls');
}

console.log('\n--- input loss and stop ---');
{
  const api = stubApi();
  let ahead = 0;
  const { t } = play(GAMES[0], api, { secs: 10, onFrame: (i, d, now) => { const last = api.sent[api.sent.length - 1]; if (last) ahead = Math.max(ahead, last.atMs + last.durationMs - now()); } });
  const last = api.sent[api.sent.length - 1];
  ok('the queue never reaches past ' + (CAPS.leadMs + CAPS.segMs) + ' ms: a lost game runs out of motion inside it', ahead <= CAPS.leadMs + CAPS.segMs, ahead.toFixed(0) + ' ms');
  ok('when the frames stop, the last segment ends within that window', last.atMs + last.durationMs - t <= CAPS.leadMs + CAPS.segMs);
}
{
  const api = stubApi();
  const { drive } = play(GAMES[1], api, { secs: 3 });
  const n = api.sent.length;
  drive.stop('game over');
  const hold = api.sent[n];
  ok('stop sends one hold that ends at rest', api.sent.length === n + 1 && hold.endVel === 0, JSON.stringify(hold));
  const prevV = (api.sent[n - 1].norm - (api.sent[n - 2]?.norm ?? 0.2)) / 0.1;
  ok('the hold brakes no harder than the cap', Math.abs(prevV) / (hold.durationMs / 1000) <= CAPS.a + 1e-9, prevV.toFixed(3) + ' over ' + hold.durationMs.toFixed(0) + ' ms');
  drive.tick(0.5);
  ok('and nothing after it', api.sent.length === n + 1 && !drive.allowed);
}

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- arcade'));
process.exit(fails ? 1 : 0);
