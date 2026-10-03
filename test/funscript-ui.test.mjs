/**
 * funscript-ui.test.mjs -- the funscript player's card logic under node
 * (ph-smvd.5): timeline.js's pure drawing math and ui.js's controller over
 * a fake video element, a fake host API, the real media clock and the real
 * scheduler. No DOM, no network.
 *   (a) timeline   curvePoints, seekAt, traceLines, heatLevels, clampRange, zoomStep
 *   (b) helpers    compositionOf, clampOffset, windowShare, ceilingOf, localScene, extraNote
 *   (c) control    nothing before Play but the grant warm-up; preroll then video
 *                  start; tiled segments; a gate pauses in the same tick with one
 *                  hold and never auto-resumes; Pause is one hold then silence;
 *                  waiting holds and continues on playing; a fatal refusal holds
 *                  with its words; a transient preroll retries; a stray play is
 *                  paused; Motion off sends nothing and ignores the gate
 *
 * Run: node test/funscript-ui.test.mjs
 */
import { parseFunscript } from '../plugins/factory/funscript-player/funscript.js';
import { createMediaClock } from '../plugins/factory/funscript-player/clock.js';
import { createScheduler, STOP_MS } from '../plugins/factory/funscript-player/scheduler.js';
import { curvePoints, seekAt, traceLines, heatLevels, clampRange, zoomStep, ZOOMS }
  from '../plugins/factory/funscript-player/timeline.js';
import { createControl, compositionOf, clampOffset, windowShare, ceilingOf, localScene, extraNote, COPY }
  from '../plugins/factory/funscript-player/ui.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  [ok]   ' : '  [FAIL] ') + name + (cond || extra === undefined ? '' : ' -- ' + JSON.stringify(extra)));
  if (!cond) fails++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// 0, 100, 0, 100 ... every 500 ms for 10 s
const script = parseFunscript({ actions: Array.from({ length: 21 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 100 : 0 })) }, 'test');
const T0 = { offsetMs: 0, lo: 0, hi: 1, invert: false };
// 100 s of the same, longer than one OFFER_MAX bundle
const long = parseFunscript({ actions: Array.from({ length: 201 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 100 : 0 })) }, 'long');

console.log('(a) timeline');
{
  const pts = curvePoints(script, 0, 1000, 1000, 100, T0).split(' ');
  ok('curve: ends at the window edges, knots inside', pts[0] === '0.0,100.0' && pts[1] === '500.0,0.0' && pts[pts.length - 1] === '1000.0,100.0', pts);
  const inv = curvePoints(script, 0, 1000, 1000, 100, { ...T0, invert: true, lo: 0.2, hi: 0.6 }).split(' ');
  ok('curve: invert and range applied', inv[0] === '0.0,40.0' && inv[1] === '500.0,80.0', inv);
  ok('curve: none without a script or window', curvePoints(null, 0, 1, 1, 1) === '' && curvePoints(script, 5, 5, 1, 1) === '');
  ok('seekAt: share of the width, clamped', seekAt(250, 1000, 8000) === 2000 && seekAt(-5, 1000, 8000) === 0 && seekAt(2000, 1000, 8000) === 8000 && seekAt(1, 0, 10) === 0);
  const tr = [{ m: 0, u: 0 }, { m: 100, u: 1 }, { m: 200, u: null }, { m: 300, u: 0.5 }, { m: 400, u: 0.5 },
    { m: 500, u: 0.5, stale: true }, { m: 600, u: 0, stale: true }];
  const lines = traceLines(tr, 0, 1000, 1000, 100);
  ok('trace: a null u is a gap, a stale change a new line', lines.length === 3 && !lines[0].stale && lines[2].stale
    && lines[0].points === '0.0,100.0 100.0,0.0' && lines[2].points.startsWith('400.0,50.0'), lines);
  ok('trace: outside the window is dropped', traceLines(tr, 250, 450, 1000, 100).length === 1);
  const hb = heatLevels(Float32Array.from([1, 2, 4]));
  ok('heat: scaled to the loudest bin without a ceiling', near(hb[2].level, 1) && near(hb[0].level, 0.25) && !hb.some((b) => b.over));
  const hc = heatLevels(Float32Array.from([1, 2, 4]), { ...T0, hi: 0.5 }, { vmax: 100, spanMm: 100 });
  ok('heat: a ceiling scales by the range and marks over', near(hc[1].level, 1) && !hc[1].over && hc[2].over && near(hc[0].level, 0.5), hc);
  ok('range: lo kept MIN_SPAN under hi', near(clampRange({ lo: 0, hi: 0.5 }, 'lo', 0.9).lo, 0.45));
  ok('range: hi kept in 0..1 and over lo', clampRange({ lo: 0.2, hi: 1 }, 'hi', 2).hi === 1 && near(clampRange({ lo: 0.2, hi: 1 }, 'hi', 0).hi, 0.25));
  ok('zoom: steps and stops at the ends', zoomStep(10000, 1) === 20000 && zoomStep(10000, -1) === 5000
    && zoomStep(ZOOMS[0], -1) === ZOOMS[0] && zoomStep(60000, 1) === 60000);
}

console.log('(b) helpers');
{
  ok('composition thresholds', compositionOf(1200) === 'full' && compositionOf(960) === 'full' && compositionOf(959) === 'handheld'
    && compositionOf(264) === 'handheld' && compositionOf(263) === 'glance');
  ok('offset: 5 ms grid, -500..500', clampOffset(7) === 5 && clampOffset(8) === 10 && clampOffset(503) === 500
    && clampOffset(-1000) === -500 && clampOffset('x') === 0);
  ok('windowShare: reported window only (law 9)', windowShare(50, 0, 100) === 0.5 && windowShare(150, 0, 100) === 1
    && windowShare(50, undefined, 100) === null && windowShare(50, 100, 100) === null);
  const api = { value: (f) => f.v };
  const c = ceilingOf(api, { lo: { v: 10, unitId: 0 }, hi: { v: 110, unitId: 0 }, vmax: { v: 400, unitId: 1 } });
  ok('ceiling: mm window and mm/s limit', c.spanMm === 100 && c.vmax === 400, c);
  const c2 = ceilingOf(api, { lo: { v: 0, unit: '%' }, hi: { v: 1 }, vmax: { v: 50, unit: '%/s' } });
  ok('ceiling: other units give nulls', c2.spanMm === null && c2.vmax === null, c2);
  const files = [{ name: 'Scene.mp4', type: 'video/mp4', size: 10 }, { name: 'scene.funscript' }, { name: 'scene.roll.funscript' }];
  const ls = localScene(files, (f) => 'blob:' + f.name);
  ok('localScene: key, title, blob stream, paired script, extras', ls.key === 'file:Scene.mp4:10' && ls.title === 'Scene'
    && ls.stream === 'blob:Scene.mp4' && ls.script === files[1] && ls.extra.length === 1 && ls.extra[0] === files[2], ls);
  ok('localScene: null without a video', localScene([{ name: 'a.funscript' }], () => 'x') === null);
  ok('extraNote: axes named', extraNote({ ignored: ['R0'] }, [files[2]]) === COPY.extra + 'R0, roll' && extraNote(script, []) === '');
}

console.log('(c) control');

class FakeVideo extends EventTarget {
  constructor() { super(); Object.assign(this, { paused: true, ended: false, seeking: false, currentTime: 0, duration: NaN, playbackRate: 1, src: '', poster: '' }); this.plays = 0; }
  play() { this.plays++; this.paused = false; this.emit('play'); this.emit('playing'); return Promise.resolve(); }
  pause() { if (this.paused) return; this.paused = true; this.emit('pause'); }
  emit(t) { this.dispatchEvent(new Event(t)); }
  removeAttribute() {}
}

function rig({ motion = true } = {}) {
  let t = 1000;
  const now = () => t;
  const sent = [];
  const st = { gate: '', refuse: null };
  const store = new Map([['motion', motion]]);
  const api = {
    gate: () => st.gate,
    submitSegments: (list) => {
      if (st.refuse) return { ok: false, sent: 0, reason: st.refuse };
      sent.push(list);
      return { ok: true, sent: list.length, rateHz: 50 };
    },
    value: (f) => f.v, stale: () => '', log: () => {},
    prefs: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v) },
  };
  const video = new FakeVideo();
  const clock = createMediaClock();
  const scheduler = createScheduler({ submit: (l) => api.submitSegments(l), now });
  const ctl = createControl({ api, video, clock, scheduler, submit: (l) => api.submitSegments(l), now, revoke: () => {} });
  const fields = { target: {}, dur: {}, pos: { v: 50 }, lo: { v: 0 }, hi: { v: 100 } };
  ctl.setFields(fields);
  // One rendered frame: media advances with wall time while playing; the frame is shown now.
  const frame = (ms = 16) => {
    t += ms;
    if (!video.paused) video.currentTime += ms / 1000;
    ctl.onFrame(video.currentTime * 1000, t);
    ctl.tick();
  };
  // Play, then frames until the preroll (if any) has started the video.
  const playThrough = () => { ctl.play(); for (let i = 0; i < 200 && ctl.state.phase === 'preroll'; i++) frame(); };
  return { api, video, ctl, sent, st, fields, frame, now, playThrough, set: (v) => { t = v; }, motion: store };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const real = (sent) => sent.filter((l) => l.length);

{
  const r = rig();
  r.ctl.load({ key: 'stash:1', title: 'One', stream: 'http://x/1' }, script, COPY.noScriptScene);
  ok('load: ready, Play waits for the script', r.ctl.state.phase === 'ready' && !r.ctl.canPlay());
  await flush();
  ok('load: script in, Play enabled', r.ctl.state.script === script && r.ctl.canPlay());
  for (let i = 0; i < 5; i++) r.frame();
  ok('nothing sent before Play but the empty warm-up', r.sent.length >= 1 && real(r.sent).length === 0 && r.video.paused, r.sent);

  r.ctl.play();
  const pre = real(r.sent);
  ok('Play: one preroll segment, video still paused', r.ctl.state.phase === 'preroll' && pre.length === 1 && pre[0].length === 1
    && near(pre[0][0].durationMs, 400 + 1200 * 0.5) && pre[0][0].norm === 0 && r.video.paused, pre);
  ok('preroll: status says Positioning', r.ctl.state.status.text === COPY.positioning);
  r.frame(500);
  ok('preroll: nothing more before its end', real(r.sent).length === 1 && r.video.paused);
  r.frame(600);
  ok('preroll end: the video starts', r.ctl.state.phase === 'playing' && !r.video.paused && r.video.plays === 1);
  for (let i = 0; i < 4; i++) r.frame();
  const segs = real(r.sent).slice(1).flat();
  ok('playing: segments flow after the anchor', segs.length > 2, segs.length);
  ok('playing: spans tile', segs.every((s, i) => i === 0 || near(segs[i - 1].atMs + segs[i - 1].durationMs, s.atMs, 1e-6)), segs);

  // A gate mid-play: paused in the same tick, nothing sent (the rail is not the player's); never auto-resumes.
  const before = real(r.sent).length;
  r.st.gate = 'stop the pattern first';
  r.frame();
  const after = real(r.sent).slice(before);
  ok('gate: paused in the same tick', r.video.paused && r.ctl.state.phase === 'held');
  ok('gate: no hold into a rail another source owns', after.length === 0, after);
  r.st.gate = 'paused, resume to continue';
  r.ctl.update();
  ok('gate: the words in the slot, warn', r.ctl.state.status.text === 'paused, resume to continue' && r.ctl.state.status.tone === 'warn');
  ok('gate: Play grayed', !r.ctl.canPlay());
  r.st.gate = '';
  for (let i = 0; i < 30; i++) r.frame();
  ok('gate cleared: nothing restarts, nothing sent', r.video.paused && r.ctl.state.phase === 'held' && real(r.sent).length === before);
  ok('gate cleared: Play enabled, slot clear', r.ctl.canPlay() && r.ctl.state.status.text === '');
}

{
  const r = rig();
  r.ctl.load({ key: 'stash:1', title: 'One', stream: 'http://x/1' }, long);
  await flush();
  r.fields.pos.v = 0;                       // at the script's start: no preroll
  r.ctl.play();
  ok('Play at the script position: no preroll', r.ctl.state.phase === 'playing' && !r.video.paused && real(r.sent).length === 0);
  for (let i = 0; i < 5; i++) r.frame();
  const n = real(r.sent).length;
  {
    // After a start the first frame can repeat for several vsyncs at one media time: no anchor
    // until the media time advances, then every span sits on the steady frames' map.
    const q = rig();
    q.ctl.load({ key: 'stash:2', title: 'Two', stream: 'http://x/2' }, long);
    await flush();
    q.fields.pos.v = 0;
    q.ctl.play();
    for (let i = 0; i < 5; i++) { q.set(q.now() + 16); q.ctl.onFrame(0, q.now()); q.ctl.tick(); }
    const stuck = real(q.sent).length;
    for (let i = 0; i < 3; i++) q.frame();
    const lead = q.now() - q.video.currentTime * 1000;   // the steady map: shown = media + lead
    const first = real(q.sent).flat();
    ok('a repeated start frame never anchors; spans sit on the steady map',
      stuck === 0 && first.length > 0 && first.every((s) => long.at.some((a) => near(s.atMs, a + lead, 1e-6))), first.slice(0, 2));
  }
  r.ctl.pause();
  const holds = real(r.sent).slice(n);
  ok('Pause: one hold, paused', r.video.paused && r.ctl.state.phase === 'ready' && holds.length === 1 && holds[0].length === 1, holds);
  for (let i = 0; i < 10; i++) r.frame();
  ok('Pause: silence after', real(r.sent).length === n + 1);

  // waiting holds and continues on playing
  r.playThrough();
  for (let i = 0; i < 5; i++) r.frame();
  const w = real(r.sent).length;
  r.video.emit('waiting');
  ok('waiting: one hold, Buffering', real(r.sent).length === w + 1 && r.ctl.state.status.text === COPY.buffering);
  for (let i = 0; i < 5; i++) { r.set(r.now() + 16); r.ctl.tick(); }
  ok('waiting: nothing sent while stalled', real(r.sent).length === w + 1);
  r.video.emit('playing');
  for (let i = 0; i < 3; i++) r.frame();
  ok('playing again: segments resume, still playing', real(r.sent).length > w + 1 && r.ctl.state.phase === 'playing' && !r.video.paused);

  // hidden page / unmount
  const hh = real(r.sent).length;
  r.ctl.halt();
  ok('halt: paused and held, one hold, no words', r.video.paused && r.ctl.state.phase === 'held' && real(r.sent).length === hh + 1
    && r.ctl.state.status.text === '');
  for (let i = 0; i < 10; i++) r.frame();
  ok('halt: never auto-resumes', r.video.paused && r.video.plays === 2);

  // a play the player did not start
  r.video.play();
  ok('a stray play is paused at once', r.video.paused && r.ctl.state.phase === 'held');
}

{
  const r = rig();
  r.ctl.load({ key: 'stash:1', title: 'One', stream: 'http://x/1' }, long);
  await flush();
  r.fields.pos.v = 0;
  r.ctl.play();
  r.frame();
  r.st.refuse = 'SOURCE_CONFLICT';
  r.frame();
  ok('fatal refusal: paused, held, the words', r.video.paused && r.ctl.state.phase === 'held'
    && r.ctl.state.status.text === 'SOURCE_CONFLICT' && r.ctl.state.status.tone === 'warn');
  const nf = r.sent.length;
  r.st.refuse = null;
  for (let i = 0; i < 5; i++) r.frame();
  ok('fatal refusal: no hold after it, no auto-resume', r.video.paused && r.sent.length === nf, r.sent.slice(nf));

  r.fields.pos.v = 100;
  r.st.refuse = 'waiting for the stream grant';
  r.ctl.play();
  ok('transient preroll: still prerolling', r.ctl.state.phase === 'preroll' && r.video.paused);
  r.st.refuse = null;
  r.frame();
  const last = real(r.sent).at(-1);
  ok('transient preroll: retried next frame', last.length === 1 && last[0].durationMs > 400, last);
}

{
  const r = rig({ motion: false });
  r.ctl.load({ key: 'stash:1', title: 'One', stream: 'http://x/1' }, long);
  await flush();
  r.st.gate = 'e-stop latched';
  ok('Motion off: Play ignores the gate', r.ctl.canPlay());
  r.ctl.play();
  for (let i = 0; i < 10; i++) r.frame();
  ok('Motion off: video plays, nothing sent', !r.video.paused && r.sent.length === 0, r.sent);
  r.ctl.setMotion(true);
  ok('Motion on mid-play: paused, Play prerolls later', r.video.paused && r.ctl.state.phase === 'ready' && r.motion.get('motion') === true);
}

{
  // Repairs and the speed limit reach the status slot.
  const r = rig();
  const fixed = parseFunscript({ actions: [{ at: 500, pos: 250 }, { at: 0, pos: -5 }, { at: 'x', pos: 1 }, { at: 1000, pos: 50 }] });
  r.ctl.load({ key: 'stash:3', title: 'Three', stream: 'http://x/3' }, fixed);
  await flush();
  ok('parse notes: the first in the slot with a count of the rest, all in its notes',
    r.ctl.state.status.text === '1 invalid action dropped (+2 more)' && r.ctl.state.status.tone === ''
    && r.ctl.state.status.notes.join('; ') === '1 invalid action dropped; 2 positions clamped; actions sorted', r.ctl.state.status);
  const words = (t) => t.split(/s+/).filter(Boolean).length;
  const messy = parseFunscript({ range: 90, axes: [{ id: 'R1' }, { id: 'R0' }],
    actions: [{ at: 0, pos: 1 }, { at: 'x', pos: 1 }, { at: 0, pos: 2 }, { at: 70000, pos: 120 }, { at: 69000, pos: 5 }] });
  r.ctl.load({ key: 'stash:5', title: 'Five', stream: 'http://x/5' }, messy, '', [{ name: 'Five.twist.funscript' }]);
  await flush();
  const st = r.ctl.state.status;
  ok('a messy script: the slot stays one fragment under 8 words, every note one fragment',
    words(st.text) < 8 && st.notes.length === 7 && st.notes.every((n) => words(n) < 8 && !n.includes(', 1 ')), st);
  r.ctl.load({ key: 'stash:6', title: 'Six', stream: 'http://x/6' }, parseFunscript({ actions: [{ at: 600, pos: 90 }, { at: 0, pos: 10 }, { at: 300, pos: 50 }] }));
  await flush();
  ok('an unsorted script names the repair in the slot', r.ctl.state.status.text === 'actions sorted', r.ctl.state.status.text);
  // script: 0 <-> 100 every 500 ms = 2 norm/s; 100 mm window: 200 mm/s
  r.ctl.load({ key: 'stash:4', title: 'Four', stream: 'http://x/4' }, script);
  await flush();
  r.fields.lo = { v: 0, unitId: 0 }; r.fields.hi = { v: 100, unitId: 0 }; r.fields.vmax = { v: 150, unitId: 1 };
  r.ctl.update();
  ok('over the speed limit: words in the slot, warn', r.ctl.state.status.text === COPY.overLimit && r.ctl.state.status.tone === 'warn');
  r.ctl.setT({ lo: 0, hi: 0.7 });
  ok('a range that brings it under clears it', r.ctl.state.status.text === '' && r.ctl.canPlay(), r.ctl.state.status.text);
}

console.log(fails ? '\nFAIL -- ' + fails + ' check(s)' : '\nPASS -- funscript card logic');
process.exit(fails ? 1 : 0);
