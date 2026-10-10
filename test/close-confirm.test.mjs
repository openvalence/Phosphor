/**
 * close-confirm.test.mjs -- the shell's close gate (src/shell/close-confirm.js)
 * against a fake window and a fake clock: every OS close request is prevented
 * and asks; a hold shorter than HOLD_MS destroys nothing; a full hold
 * destroys once, and the close request that destroy raises goes through.
 * Close immediately when idle: an idle machine closes at once from the X and
 * the OS; moving, a held source, a generator, the oscillator, a trial, a
 * stale or absent reading, or the setting off keeps the hold.
 *
 * The real OS paths (Alt+F4, the taskbar, the X) need the by-hand Tauri check
 * on ph-e82.17. Run: node test/close-confirm.test.mjs
 */
import { createCloseGate, closeConsequences, closesAtOnce, HOLD_MS } from '../src/shell/close-confirm.js';
import { FIELD_ROLE, CH_CONTROL_OWNER, SOURCE_KIND } from '../../Valence/clients/js/index.js';

let fails = 0;
const ok = (n, c, x) => { console.log('  [' + (c ? 'PASS' : 'FAIL') + '] ' + n + (x ? '  -- ' + x : '')); if (!c) fails++; };

function fakeClock() {
  let now = 0, seq = 0;
  const due = new Map();
  return {
    setTimeout: (fn, ms) => { due.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (id) => { due.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...due]) if (t.at <= now) { due.delete(id); t.fn(); }
    },
  };
}
function fakeWindow() {
  const w = { handler: null, destroyed: 0, unlistened: 0, raised: 0, focused: 0 };
  w.unminimize = async () => { w.raised++; };
  w.setFocus = async () => { w.focused++; };
  w.onCloseRequested = async (h) => { w.handler = h; return () => { w.unlistened++; }; };
  w.destroy = () => { w.destroyed++; };
  w.request = () => { let prevented = false; w.handler({ preventDefault: () => { prevented = true; } }); return prevented; };
  return w;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

ok('HOLD_MS is about a second', HOLD_MS >= 800 && HOLD_MS <= 1500, String(HOLD_MS));

{
  const win = fakeWindow(), clock = fakeClock();
  let asked = 0;
  const gate = createCloseGate(win, () => asked++, { timers: clock });
  await settle();
  ok('an OS close request is prevented and asks', win.request() === true && asked === 1);
  await settle();
  ok('the request raises the window so the popover is seen (taskbar close)', win.raised === 1 && win.focused === 1);
  gate.hold(); clock.advance(HOLD_MS - 1); gate.release(); clock.advance(5000);
  ok('a hold one ms short destroys nothing', win.destroyed === 0);
  gate.hold(); clock.advance(HOLD_MS / 2); gate.hold(); clock.advance(HOLD_MS / 2);
  ok('a second press mid-hold does not restart or double the timer', win.destroyed === 1, String(win.destroyed));
  ok('after the hold, the close request destroy raises is not prevented', win.request() === false && asked === 1);
  gate.hold(); clock.advance(HOLD_MS * 2);
  ok('nothing destroys twice', win.destroyed === 1);
  await gate.dispose();
  ok('dispose unlistens', win.unlistened === 1);
}

{
  const win = fakeWindow();
  win.onCloseRequested = async () => { throw new Error('event permission missing'); };
  const gate = createCloseGate(win, () => {}, { timers: fakeClock() });
  await gate.dispose();
  ok('a shell without the event permission degrades without throwing', true);
}

{
  const win = fakeWindow();
  let asked = 0, idle = true;
  const gate = createCloseGate(win, () => asked++, { timers: fakeClock(), idle: () => idle });
  await settle();
  ok('idle: an OS close request goes through unasked', win.request() === false && asked === 0 && win.raised === 0);
  idle = false;
  gate.request();
  ok('idle: once closing, the X asks nothing more', asked === 0 && win.destroyed === 0);
}
{
  const win = fakeWindow();
  let asked = 0, idle = false;
  const gate = createCloseGate(win, () => asked++, { timers: fakeClock(), idle: () => idle });
  await settle();
  gate.request();
  ok('busy: the X asks and destroys nothing', asked === 1 && win.destroyed === 0);
  idle = true;
  gate.request();
  ok('idle: the X destroys at once, read at the press', asked === 1 && win.destroyed === 1);
  gate.request();
  ok('idle: the X destroys once', win.destroyed === 1);
}

// closesAtOnce on a fake catalog: roles on their own channels, every reading quiet and fresh.
{
  const F = (role, ch, name) => ({ role, channelId: ch, name });
  const fields = [F(FIELD_ROLE.telemetry_position, 10, 'pos'), F(FIELD_ROLE.telemetry_velocity, 10, 'vel'),
    F(FIELD_ROLE.pattern_running, 11, 'run'), F(FIELD_ROLE.advgen_running, 12, 'adv'),
    F(FIELD_ROLE.osc_active, 13, 'osc'), F(FIELD_ROLE.meta_trial_pending, 14, 'trial')];
  const byRoleOf = (fs) => fs.reduce((m, f) => m.set(f.role, [...(m.get(f.role) || []), f]), new Map());
  const quiet = () => ({ 10: { pos: 42.5, vel: 0 }, 11: { run: false }, 12: { adv: 0 }, 13: { osc: false }, 14: { trial: 0 },
    [CH_CONTROL_OWNER]: { src0: 0, owner0: 0, kind0: SOURCE_KIND.reserved } });
  const at = (o = {}) => closesAtOnce({ on: true, heard: true, byRole: byRoleOf(fields), samples: quiet(), fresh: () => true, ...o });
  const with_ = (edit) => { const s = quiet(); edit(s); return at({ samples: s }); };

  ok('idle machine, setting on: closes at once', at() === true);
  ok('setting off: always the hold', at({ on: false }) === false && at({ on: false, heard: false }) === false);
  ok('never heard from (not connected): idle', at({ heard: false, byRole: null, samples: {} }) === true);
  ok('moving: the hold', with_((s) => { s[10].vel = 12.5; }) === false && with_((s) => { s[10].vel = -0.1; }) === false);
  ok('streaming (a held stream slot): the hold', with_((s) => { Object.assign(s[CH_CONTROL_OWNER], { owner0: 7, kind0: SOURCE_KIND.stream }); }) === false);
  ok('pattern or advanced generator running: the hold', with_((s) => { s[11].run = true; }) === false && with_((s) => { s[12].adv = 1; }) === false);
  ok('oscillating: the hold', with_((s) => { s[13].osc = true; }) === false);
  ok('a trial pending: the hold', with_((s) => { s[14].trial = 0b10; }) === false);
  ok('stale link: the hold', at({ fresh: () => false }) === false);
  ok('one stale channel: the hold', at({ fresh: (ch) => ch !== 13 }) === false);
  ok('a declared reading never reported: the hold', with_((s) => { delete s[13]; }) === false && with_((s) => { delete s[CH_CONTROL_OWNER]; }) === false);
  ok('heard but no catalog yet: the hold', at({ byRole: null }) === false);
  ok('a position with no speed: the hold', at({ byRole: byRoleOf(fields.filter((f) => f.role !== FIELD_ROLE.telemetry_velocity)) }) === false);
  ok('no carriage at all: idle', at({ byRole: byRoleOf(fields.slice(2)) }) === true);
}

ok('consequences: nothing to say', closeConsequences({}).length === 0);
ok('consequences: this session drives', /Motion settles/.test(closeConsequences({ ownsSource: true }).join()));
ok('consequences: background run outranks the settle line',
  closeConsequences({ runsOnAlone: true, ownsSource: true }).length === 1
  && /keeps running/.test(closeConsequences({ runsOnAlone: true, ownsSource: true })[0]));
ok('consequences: the server line', /connected apps will drop/.test(closeConsequences({ serverRunning: true }).join()));

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- only a full hold closes, or an idle machine.'));
process.exit(fails ? 1 : 0);
