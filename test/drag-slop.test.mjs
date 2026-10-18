/**
 * drag-slop.test.mjs -- src/plugins/kit.js drag(), the one touch-intent
 * helper (DESIGN 10.13, Touch), against a fake element: a touch claims only
 * past INTENT_PX along its axis (the drag starting from that point), a move
 * across first gives it to the page for good, a hold claims, a cancel ends
 * with ok false, a mouse begins at once, and an axis picked per press.
 * Run: node test/drag-slop.test.mjs
 */
import { drag, INTENT_PX, HOLD_MS } from '../src/plugins/kit.js';

let fail = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -- ' + JSON.stringify(extra))); if (!cond) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeEl() {
  const L = new Map();
  return {
    style: {}, attrs: new Set(), captured: null,
    addEventListener: (t, f) => L.set(t, f),
    removeEventListener: (t) => L.delete(t),
    setPointerCapture(id) { this.captured = id; },
    setAttribute(k) { this.attrs.add(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    fire(t, e) { const ev = { pointerId: 1, pointerType: 'touch', button: 0, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...e, type: t }; if (L.has(t)) L.get(t)(ev); return ev; },
    count: () => L.size,
  };
}
function rig(o = {}) {
  const el = fakeEl(), log = [];
  const off = drag(el, {
    onStart: (d, e) => log.push(['start', e.clientX, e.clientY]),
    onMove: (e, dx, dy) => log.push(['move', dx, dy]),
    onEnd: (e, okk) => log.push(['end', okk]),
    ...o,
  });
  return { el, log, off, starts: () => log.filter((x) => x[0] === 'start') };
}

{
  const { el, log, starts } = rig();
  ok('a horizontal drag is pan-y: the page keeps its vertical scroll', el.style.touchAction === 'pan-y');
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  el.fire('pointermove', { clientX: 100 + INTENT_PX - 1, clientY: 101 });
  ok('inside the slop nothing starts and nothing moves', log.length === 0, log);
  ok('...and the pointer is not captured', el.captured === null);
  el.fire('pointermove', { clientX: 100 + INTENT_PX + 1, clientY: 101 });
  ok('past the slop along the axis it claims, from the point it claimed at', starts().length === 1 && starts()[0][1] === 100 + INTENT_PX + 1, log);
  ok('...captured', el.captured === 1 && el.attrs.has('data-drag'));
  const tm = el.fire('touchmove', {});
  ok('a claimed drag owns its touch: touchmove is prevented', tm.defaultPrevented);
  el.fire('pointerup', { clientX: 130, clientY: 101 });
  ok('release ends ok', log[log.length - 1][0] === 'end' && log[log.length - 1][1] === true, log);
}
{
  const { el, log } = rig();
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  el.fire('pointermove', { clientX: 102, clientY: 100 + INTENT_PX + 2 });
  el.fire('pointermove', { clientX: 160, clientY: 112 });
  ok('across the axis first gives the gesture to the page for good', log.length === 0, log);
  const tm = el.fire('touchmove', {});
  ok('...its touchmove is never prevented', !tm.defaultPrevented);
  el.fire('pointercancel', {});
  ok('...and the scroll\'s cancel reports nothing', log.length === 0, log);
}
{
  const { el, log } = rig();
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  el.fire('pointermove', { clientX: 100 + INTENT_PX + 2, clientY: 100 + INTENT_PX + 2 });
  ok('a diagonal tie is the page\'s (along must beat across)', log.length === 0, log);
}
{
  const { el, log } = rig();
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  el.fire('pointermove', { clientX: 120, clientY: 100 });
  el.fire('pointercancel', {});
  ok('a cancel after the claim ends with ok false', log[log.length - 1][0] === 'end' && log[log.length - 1][1] === false, log);
}
{
  const { el, log } = rig();
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  el.fire('pointerup', { clientX: 101, clientY: 100 });
  ok('a tap neither starts nor ends a drag', log.length === 0, log);
}
{
  const { el, starts } = rig();
  el.fire('pointerdown', { pointerType: 'mouse', clientX: 50, clientY: 50 });
  ok('a mouse begins at its press', starts().length === 1 && el.captured === 1);
}
{
  const { el, starts } = rig();
  el.fire('pointerdown', { pointerType: 'mouse', button: 2, clientX: 50, clientY: 50 });
  ok('a secondary button is ignored', starts().length === 0);
}
{
  const { el, starts } = rig({ axis: 'y' });
  ok('a vertical drag is pan-x', el.style.touchAction === 'pan-x');
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  el.fire('pointermove', { clientX: 100, clientY: 100 - INTENT_PX - 1 });
  ok('...and claims on vertical intent', starts().length === 1);
}
{
  let pick = 'x';
  const { el, starts } = rig({ axis: () => pick });
  ok('an axis per press leaves touch-action to the caller', el.style.touchAction === undefined);
  pick = 'y';
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  pick = 'x';
  el.fire('pointermove', { clientX: 100, clientY: 100 + INTENT_PX + 1 });
  ok('...read once at the press', starts().length === 1);
}
{
  const { el, starts } = rig({ filter: () => false });
  el.fire('pointerdown', { pointerType: 'mouse', clientX: 50, clientY: 50 });
  ok('filter false ignores the press', starts().length === 0);
}
{
  const { el, starts, log } = rig();
  el.fire('pointerdown', { clientX: 100, clientY: 100 });
  await sleep(HOLD_MS + 60);
  ok('a hold claims without movement, at the press', starts().length === 1 && starts()[0][1] === 100, log);
}
{
  const { el, off } = rig();
  off();
  ok('off() removes every listener', el.count() === 0);
}

if (fail) { console.log(fail + ' failed'); process.exit(1); }
console.log('drag-slop: all passed');
