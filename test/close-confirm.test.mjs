/**
 * close-confirm.test.mjs -- the shell's close gate (src/shell/close-confirm.js)
 * against a fake window and a fake clock: every OS close request is prevented
 * and asks; a hold shorter than HOLD_MS destroys nothing; a full hold
 * destroys once, and the close request that destroy raises goes through.
 *
 * The real OS paths (Alt+F4, the taskbar, the X) need the by-hand Tauri check
 * on ph-e82.17. Run: node test/close-confirm.test.mjs
 */
import { createCloseGate, closeConsequences, HOLD_MS } from '../src/shell/close-confirm.js';

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

ok('consequences: nothing to say', closeConsequences({}).length === 0);
ok('consequences: this session drives', /Motion settles/.test(closeConsequences({ ownsSource: true }).join()));
ok('consequences: background run outranks the settle line',
  closeConsequences({ runsOnAlone: true, ownsSource: true }).length === 1
  && /keeps running/.test(closeConsequences({ runsOnAlone: true, ownsSource: true })[0]));
ok('consequences: the server line', /connected apps will drop/.test(closeConsequences({ serverRunning: true }).join()));

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS -- only a full hold closes.'));
process.exit(fails ? 1 : 0);
