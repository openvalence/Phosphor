// ui.js -- the player controller and card: video, transport, status slot, layout tiers
// Contract: CONTRACT.md, module player-ui (ph-smvd.5); design: docs/plugins/FUNSCRIPT.md.
//
// Constraints:
// - Motion leaves only through api.submitSegments: the scheduler's tick once
//   per animation frame, one preroll segment before Play, one hold on a stop.
//   Never a safety op, never resume.
// - The gate is api.gate(fields.dur), read on every update() and every frame.
//   A gate or a fatal refusal pauses the video in that same call and sends
//   nothing: the rail is another source's, latched, gone or refusing, so a
//   hold would land in someone else's stream. Nothing here ever plays except
//   the operator's Play; a 'play' the player did not start is paused at once.
// - The one move outside Play is the pause home (prefs play.home, off by default):
//   one segment once a pause or the end has lasted homeAfterMs, never while gated
//   or after a stop for another reason; Play, a load and Motion cancel it.
// - A hold is sent only for the player's own stops, and only while segments
//   went out since the last restart, so a stop is one hold and silence after.
// - A pause or gate during preroll cancels the video start and sends nothing:
//   the preroll segment already ends at rest within PREROLL_MIN_MS +
//   PREROLL_STROKE_MS.
// - Waiting holds and continues on 'playing'; a hidden page, an unmount of the
//   hosting view and dispose stop playback until the operator's Play.
// - Motion switched on mid-play pauses (Play then prerolls); switched off
//   mid-play holds and the video plays on.
// - Composition follows the card's own box: full >= 960, handheld 264..959,
//   glance < 264. Every row has a fixed height; a state change swaps text only.
// - Handheld takes data-narrow (two strip rows; three beside the analyzer) when
//   the strip overflows at the card's width, measured on a width change, on a
//   Look change (the Offset label's box) and on an analyzer toggle, never on a
//   state change, so the Look scale moves the switch with the text. Its button
//   columns are max-content: an auto column squeezes a button to its 40 px
//   min-width, cutting the label, and never overflows.
// - Play and the time live in the hover bar; the strip shows them only where the
//   bar cannot draw (glance, the handheld analyzer's thumbnail).
// - The library caret (full only) is a view switch kept in prefs libOpen, never a write.
// - The speed reading's floor is 10ch of its own font ('20000 mm/s'), never
//   its current text, so the switch does not move with the reading.
// - CSS: tokens only, never --bad or --estop (law 13); 40 px targets (law 12).
// - --warn is a mark, never text: on a light chassis it reads 1.8:1, and it is
//   locked (law 13). Warn text stays --tx beside a --warn bar.
// - The probe exists only while localStorage phosphor.funscript.probe is '1'.
// - The analyzer keeps the outer card rect: the video moves to an in-card thumbnail,
//   never picture-in-picture or element fullscreen (law 1: nothing may cover the strip).
// - The hover bar acts through the controller (toggle, seek): it never
//   calls the video's play() or pause() or sets currentTime. Volume and mute are the video's
//   own, stored as prefs audio; the bar holds the card's only mute and volume. Its fullscreen
//   is the shell's page fullscreen, bare (the stop
//   pair stays): a page mount only (opts.fullscreen), asked by the cancelable
//   'phosphor-page-fullscreen' event and ended on 'phosphor-page-fullscreen-change' off.
//   Its mode button shows only where the shell sets <html data-fullscreen-mode> (the
//   desktop shell) and asks by 'phosphor-page-fullscreen-mode' {mode}; it never stores the pref.
// - 'Preview: not saved' stands in the slot while any client holds a trial (RFC-099),
//   outranked only by a refusal and the gate.
// - A loop wrap's seek is not a stop: no hold, no clock reset, no trace reset. Every other
//   seek resets the loop's lap; one while playing restarts with the seek transition.
// - With a loop the clock runs in unrolled media time; everything shown is folded back.
// - Changing the loop while playing holds and re-anchors: the unrolled clock cannot jump.
// - Auto Scale (interp scaleAuto): the drawn curve's extent sets the gain at once; the analyzer's
//   planner measure of the wire at scale 1 (ctl.fit, analyzer.js fit) replaces it when it lands. A
//   card frames its analyzer while Auto is on, shown or not; glance keeps the curve's estimate.

import { parseFunscript, pairFiles, posAt, fmtTime, axisOf, peakSpeed } from './funscript.js';
import { createMediaClock, frameSource, createLoop, loopSpec, LOW, FALLBACK_AFTER_MS } from './clock.js';
import { createScheduler, applyT, strokeSpeed, TRANSIENT } from './scheduler.js';
import { createStash } from './stash.js';
import { mountLibrary } from './library.js';
import { mountTimeline, CSS as TL_CSS } from './timeline.js';
import { mountAnalyzer, CSS as AN_CSS, COPY as AN_COPY } from './analyzer.js';
import { readPrefs, writePref } from './prefs.js';
import { shape, wire, fitGain, curveExtent } from './interp.js';

export const FULL_UP = 960;
export const HOVER_IDLE_MS = 2500;
export const GLANCE_UP = 264;
const PROBE_KEY = 'phosphor.funscript.probe';
const PROBE_RING = 5000;
const TRACE_MS = 8000;
// Registry unit_ids: 0 mm, 1 mm_s.
const UNIT_MM = 0, UNIT_MM_S = 1;

export const COPY = Object.freeze({
  play: 'Play',
  pause: 'Pause',
  openFiles: 'Open files',
  library: 'Library',
  player: 'Player',
  motion: 'Motion',
  offset: 'Offset',
  offsetTip: 'Machine later (+) or earlier (-)',
  invert: 'Invert',
  volume: 'Volume',
  speed: 'Stroke speed',
  speedOver: 'Past the input speed limit',
  empty: 'No scene loaded',
  openVideo: 'Open a video',
  noScriptVideo: 'No script for this video',
  noScriptScene: 'No script for this scene',
  positioning: 'Positioning',
  buffering: 'Buffering',
  badFormat: 'Format not playable here',
  extra: 'Extra axes ignored: ',
  overLimit: 'Script past the input speed limit',
  more: 'more',
  meter: 'Stroke',
  playHeading: 'Playback',
  loop: 'Loop',
  loopTip: 'Loop the whole video',
  loopCount: 'Loop count',
  forever: 'forever',
  home: 'Pause home',
  homeTip: 'Move home once paused this long',
  homeAfter: 'After pause',
  homePoint: 'Home point',
  homeSpeed: 'Home speed',
  seekMs: 'Seek glide',
  seekTip: 'Glide to a seek target',
  jump: 'jump',
  low: 'Low latency',
  lowTip: '50 ms lead, faster clock',
  playKey: 'Play (k)',
  pauseKey: 'Pause (k)',
  muteKey: 'Mute (m)',
  unmuteKey: 'Unmute (m)',
  seek: 'Seek',
  full: 'Fullscreen (f)',
  mode: 'In window / Borderless',
  fullExit: 'Exit fullscreen (f)',
  auto: 'Auto latency',
  autoTip: 'Offset from the plan strip',
  on: 'On',
  off: 'Off',
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Hover bar icons on a 16-unit box: [filled path, stroked path].
const ICON = {
  play: ['M5 3l9 5-9 5z', ''],
  pause: ['M4 3h3v10H4zM9 3h3v10H9z', ''],
  vol: ['M2 6h3l4-3.5v11L5 10H2z', 'M11.5 5.5a3.5 3.5 0 010 5'],
  muted: ['M2 6h3l4-3.5v11L5 10H2z', 'M11 6l4 4M15 6l-4 4'],
  full: ['', 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'],
  unfull: ['', 'M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4'],
  win: ['', 'M2 3.5h12v9H2zM2 6h12'],
  bdl: ['', 'M1.5 2.5h13v9h-13zM6 14h4M8 11.5V14'],
  caret: ['', 'M6.5 5l3 3-3 3'],
};

// ---- pure helpers -----------------------------------------------------------

export function compositionOf(width) {
  return width >= FULL_UP ? 'full' : width >= GLANCE_UP ? 'handheld' : 'glance';
}

/** Offset ms on the 5 ms grid inside -500..500. */
export function clampOffset(v) {
  return Number.isFinite(+v) ? clamp(Math.round(+v / 5) * 5, -500, 500) : 0;
}

/** A position as a share of the reported window; null unless all three are reported (law 9). */
export function windowShare(v, lo, hi) {
  v = Number(v); lo = Number(lo); hi = Number(hi);
  return Number.isFinite(v) && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : null;
}

const isUnit = (f, id, text) => !!f && (f.unitId === id || f.unit === text);

/** {vmax, spanMm} for the speed meter and heat: each null unless its unit is mm/s, mm. */
export function ceilingOf(api, fields) {
  const lo = fields.lo && api.value(fields.lo), hi = fields.hi && api.value(fields.hi);
  const spanMm = isUnit(fields.lo, UNIT_MM, 'mm') && isUnit(fields.hi, UNIT_MM, 'mm') && Number(hi) > Number(lo)
    ? Number(hi) - Number(lo) : null;
  const v = fields.vmax ? Number(api.value(fields.vmax)) : NaN;
  return { vmax: isUnit(fields.vmax, UNIT_MM_S, 'mm/s') && v > 0 ? v : null, spanMm };
}

/** A LocalScene from picked files (pairFiles), or null without a video or audio file. */
export function localScene(files, createURL = (f) => URL.createObjectURL(f)) {
  const { video, script, extra } = pairFiles(files);
  if (!video) return null;
  return { key: 'file:' + video.name + ':' + video.size, title: video.name.replace(/\.[^.]+$/, ''),
    stream: createURL(video), script: script || null, extra: extra || [] };
}

/** 'Extra axes ignored: roll, twist' from the script's ignored axes and the extra files; '' when none. */
export function extraNote(script, extra = []) {
  const names = [...((script && script.ignored) || []), ...extra.map((f) => {
    const ax = axisOf(f.name);
    return ax && ax.axis !== 'L0' ? f.name.slice(ax.base.length + 1).replace(/\.funscript$/i, '') : f.name;
  })];
  const uniq = [...new Set(names)];
  return uniq.length ? COPY.extra + uniq.join(', ') : '';
}

// ---- the controller: no DOM, every boundary injected ------------------------

/**
 * deps: api; video (an HTMLMediaElement or a fake: play(), pause(), paused,
 * ended, seeking, currentTime, duration, playbackRate, src, poster,
 * addEventListener); clock (MediaClock); scheduler; submit (Seg[] ->
 * SegResult, the probe-wrapped api.submitSegments); now; probe(entry);
 * onChange(); revoke(url); loop (clock.js createLoop).
 */
export function createControl({ api, video, clock, scheduler, submit, now = () => performance.now(),
  probe = () => {}, onChange = () => {}, revoke = (u) => URL.revokeObjectURL(u), loop = createLoop() }) {
  const prefs = readPrefs(api);
  const state = { phase: 'empty', scene: null, script: null, shaped: null, T: { ...prefs.T }, motion: prefs.motion !== false,
    status: { text: COPY.empty, tone: '', notes: [] }, view: prefs.view === 'library' ? 'library' : 'player', composition: 'full',
    ab: { a: null, b: null }, play: prefs.play };
  let fields = null;
  let why = '';          // a fatal refusal or media error; cleared by Play and by a load
  let info = [];         // load facts: no script, repairs, extra axes
  let transient = '';
  let buffering = false, sentSince = false, restart = false, pre = null, url = null, seq = 0, peak = 0, wired = null;
  let lastM = NaN;      // the previous frame's media time; NaN after a clock reset
  let interp = prefs.interp;
  let seekT = 0;        // the seek transition the next restart carries
  let homeAt = Infinity; // the pause home's due time
  let planAge = Infinity, planEl = NaN, latAt = -Infinity;
  let autoGain = 1, autoFor = null, autoKey = '', autoWire = null;
  const trace = [];
  scheduler.setTransform(state.T);

  const gate = () => (state.motion && fields && fields.dur ? api.gate(fields.dur) || '' : '');
  const active = () => state.phase === 'playing' || state.phase === 'preroll';
  /** Unrolled loop time back to media time. */
  const fold = (u) => (loop.spec && loop.lap ? u - loop.lap * (loop.spec.b - loop.spec.a) : u);
  const mediaNow = () => (state.phase === 'playing' && clock.ready ? fold(clock.mediaAt(now())) : video.currentTime * 1000);
  const durMs = () => (Number.isFinite(video.duration) ? video.duration * 1000 : state.script ? state.script.durationMs : Infinity);
  /** A plan role's value in ms from its unit. */
  const msOf = (f) => { const v = Number(api.value(f)); return f.unit === 'us' ? v / 1000 : f.unit === 's' ? v * 1000 : v; };

  /** A-B points, else the whole video when the loop pref is on. A change while playing holds and re-anchors. */
  function setLoopSpec() {
    const { a, b } = state.ab, p = state.play;
    const d = durMs();
    const spec = b != null ? loopSpec(a, b, p.loopCount, d) : p.loop && Number.isFinite(d) ? loopSpec(0, d, p.loopCount, d) : null;
    const was = loop.spec;
    if (JSON.stringify(spec) === JSON.stringify(was)) return;
    if (state.phase === 'playing') hold();
    loop.set(spec);
    scheduler.setLoop(spec);
  }
  function applyPlay() {
    const p = state.play;
    scheduler.setHome(p.home ? { point: p.homePoint, speed: p.homeSpeed } : null);
    scheduler.setLatency({ low: p.lowLatency, auto: p.autoLatency });
    if (clock.tune) clock.tune(p.lowLatency ? LOW : {});
    setLoopSpec();
    if (state.phase === 'playing' && clock.ready) restart = true;
  }
  const here = () => {
    if (!fields || !fields.pos || api.stale(fields.pos)) return null;
    return windowShare(api.value(fields.pos), fields.lo && api.value(fields.lo), fields.hi && api.value(fields.hi));
  };
  /** plan.current as a window share (the plan roles are window-relative), or null. */
  const planShare = () => {
    const f = api.field && api.field('plan.current');
    const v = f && !api.stale(f) ? Number(api.value(f)) : NaN;
    if (!Number.isFinite(v)) return null;
    return f.min != null && f.max > f.min ? clamp((v - f.min) / (f.max - f.min), 0, 1) : clamp(v, 0, 1);
  };

  function hold() {
    if (sentSince && clock.ready) {
      probe({ k: 'mark', t: now(), name: 'hold' });
      scheduler.stop(clock);
    }
    sentSince = false;
    resetClock();
  }
  function resetClock() { clock.reset(); lastM = NaN; }
  /** Every stop: one hold when owed (never on a yield), the video paused in the same call. */
  function stop(phase, words = '', yieldRail = false) {
    if (yieldRail) sentSince = false;
    homeAt = phase === 'ready' && state.phase === 'playing' ? now() + state.play.homeAfterMs : Infinity;
    if (state.phase === 'playing') hold();
    if (loop.wrapping) loop.reset();
    pre = null;
    buffering = false;
    transient = '';
    why = words;
    state.phase = phase;
    probe({ k: 'mark', t: now(), name: 'stop' });
    video.pause();
    changed();
  }

  function canPlay() {
    return (state.phase === 'ready' || state.phase === 'held') && !!state.script && !gate();
  }
  function start() {
    state.phase = 'playing';
    pre = null;
    buffering = false;
    sentSince = false;
    resetClock();
    probe({ k: 'mark', t: now(), name: 'play' });
    const p = video.play();
    if (p && p.catch) p.catch((e) => { if (e && e.name !== 'AbortError' && state.phase === 'playing') stop('error', COPY.badFormat); });
    changed();
  }
  function prerollStep() {
    const seg = scheduler.preroll(video.currentTime * 1000, here());
    if (!seg) return start();
    const r = submit([seg]);
    if (r.ok && r.sent > 0) {
      pre.playAt = seg.atMs + seg.durationMs;
      transient = '';
    } else if (!r.ok && !TRANSIENT.has(r.reason)) stop('held', r.reason);
    else transient = r.reason || '';
  }
  function play() {
    if (!canPlay()) return;
    homeAt = Infinity;
    why = '';
    transient = '';
    scheduler.setTransform(state.T);
    if (!state.motion) return start();
    state.phase = 'preroll';
    pre = { playAt: null };
    probe({ k: 'mark', t: now(), name: 'preroll' });
    prerollStep();
    changed();
  }

  function tick() {
    const g = gate();
    if (g && active()) stop('held', '', true);
    else if (state.phase === 'preroll') {
      if (pre.playAt == null) prerollStep();
      else {
        // The preroll bundle's NACK arrives later; an empty call surfaces it before the video starts.
        const r = submit([]);
        if (!r.ok && !TRANSIENT.has(r.reason)) stop('held', r.reason);
        else if (now() >= pre.playAt) start();
      }
    } else if (state.phase === 'playing' && state.motion && clock.ready && !buffering) {
      if (restart) { scheduler.restart(clock, seekT); restart = false; seekT = 0; }
      const r = scheduler.tick(clock);
      if (r.sent > 0) sentSince = true;
      if (r.fatal) stop('held', r.reason, true);
      else transient = r.ok ? '' : r.reason;
      observePlan();
    } else if (state.phase === 'ready' && now() >= homeAt) goHome();
    if (state.phase === 'playing' && !video.seeking && loop.due(video.currentTime * 1000)) {
      probe({ k: 'mark', t: now(), name: 'wrap', lap: loop.lap });
      video.currentTime = loop.wrap() / 1000;
    }
    if (state.phase === 'playing' && clock.ready && fields && fields.pos) {
      const m = fold(clock.mediaAt(now() - state.T.offsetMs + scheduler.compMs));
      if (Number.isFinite(m)) {
        trace.push({ m, u: windowShare(api.value(fields.pos), fields.lo && api.value(fields.lo), fields.hi && api.value(fields.hi)),
          stale: !!api.stale(fields.pos), p: planShare() });
      }
    }
    const cur = mediaNow();
    while (trace.length && trace[0].m < cur - TRACE_MS) trace.shift();
    if (trace.length && trace[trace.length - 1].m > cur + 1000) trace.length = 0;
    refresh();
  }

  /** One plan strip sample per new STATE (its age drops) to the scheduler's compensation. */
  function observePlan() {
    if (!fields || !fields.planEl || !fields.planDur) return;
    const age = api.age(fields.planEl), el = msOf(fields.planEl);
    if (age < planAge || el !== planEl) scheduler.observePlan(now() - age, el, msOf(fields.planDur));
    planAge = age; planEl = el;
    if (now() - latAt >= 500) { latAt = now(); probe({ k: 'lat', t: latAt, lag: scheduler.lagMs, comp: scheduler.compMs }); }
  }

  function onFrame(mediaMs, displayMs) {
    if (state.phase !== 'playing' || buffering || video.paused || video.seeking) return;
    mediaMs = loop.unroll(mediaMs);
    probe({ k: 'obs', m: mediaMs, d: displayMs });
    const prev = lastM;
    lastM = mediaMs;
    // Only a frame that advances past one seen since the reset carries the clock: after play()
    // or a seek the first frame often repeats for several vsyncs at one media time.
    if (!(mediaMs > prev)) return;
    if (!clock.ready) { clock.anchor(mediaMs, displayMs, video.playbackRate); restart = true; }
    else if (clock.observe(mediaMs, displayMs) === 'step') restart = true;
  }

  /** The pause home: one move, retried while the refusal is transient. */
  function goHome() {
    if (!state.play.home || !state.motion || !fields || gate()) { homeAt = Infinity; return; }
    const seg = scheduler.home(here());
    const r = seg ? submit([seg]) : { ok: true };
    if (r.ok || !TRANSIENT.has(r.reason)) homeAt = Infinity;
    if (seg && r.ok) probe({ k: 'mark', t: now(), name: 'home' });
  }

  function warm() {
    if (state.motion && state.script && fields && !gate()) submit([]);
  }

  /** The scheduler and the Kinetic preview run wire() (one knot per action); shaped is display only. */
  function reshape() {
    const s = state.script, ctx = { spanMm: fields ? ceilingOf(api, fields).spanMm : 0, lo: state.T.lo, hi: state.T.hi };
    if (s && interp.scaleAuto) {
      const key = JSON.stringify([interp, ctx]);
      if (s !== autoFor || key !== autoKey) {
        autoFor = s; autoKey = key;
        autoWire = wire(s, { ...interp, scale: 1 }, ctx);
        autoGain = fitGain(curveExtent(s, interp));
      }
    }
    const I = { ...interp, scale: interp.scaleAuto ? autoGain : interp.scale };
    const next = s ? shape(s, I, ctx) : null;
    if (next === state.shaped) return;
    state.shaped = next;
    wired = s ? wire(s, I, ctx) : null;
    scheduler.load(wired);
    peak = next ? peakSpeed(next) : 0;
    if (state.phase === 'playing' && clock.ready) restart = true;
  }

  /** scene: Scene | LocalScene; script: Script | Promise<Script> | null; none: words when it has no script. */
  function load(scene, script, none, extra = []) {
    if (active()) stop('ready');
    homeAt = Infinity;
    if (url) revoke(url);
    url = String(scene.key).startsWith('file:') ? scene.stream : null;
    const my = ++seq;
    Object.assign(state, { scene, script: null, shaped: null, phase: 'ready', ab: { a: null, b: null } });
    scheduler.load(null);
    wired = null;
    loop.set(null);
    scheduler.setLoop(null);
    peak = 0;
    why = '';
    info = !script && none ? [none] : [];
    video.src = scene.stream;
    if (scene.screenshot) video.poster = scene.screenshot; else video.removeAttribute && video.removeAttribute('poster');
    if (script) {
      Promise.resolve(script).then((s) => {
        if (my !== seq) return;
        state.script = s;
        reshape();
        setLoopSpec();
        info = [...s.notes, extraNote(s, extra)].filter(Boolean);
        warm();
        changed();
      }, (e) => {
        if (my !== seq) return;
        why = (e && e.message) || String(e);
        changed();
      });
    }
    changed();
  }

  function setMotion(on) {
    if (on === state.motion) return;
    homeAt = Infinity;
    if (state.phase === 'preroll' || (state.phase === 'playing' && on)) stop('ready');
    else if (state.phase === 'playing') hold();
    state.motion = on;
    writePref(api, 'motion', on);
    warm();
    changed();
  }
  function setT(partial) {
    const T = { ...state.T, ...partial };
    T.offsetMs = clampOffset(T.offsetMs);
    T.lo = clamp(+T.lo || 0, 0, 0.95);
    T.hi = clamp(+T.hi || 0, T.lo + 0.05, 1);
    T.invert = !!T.invert;
    state.T = T;
    writePref(api, 'T', T);
    scheduler.setTransform(T);
    reshape();
    if (state.phase === 'playing' && clock.ready) restart = true;
    changed();
  }
  function setView(v) { state.view = v; writePref(api, 'view', v); changed(); }
  /** The play prefs (prefs.js 'play'), stored and in force. */
  function setPlay(p) {
    writePref(api, 'play', { ...state.play, ...p });
    state.play = readPrefs(api).play;
    applyPlay();
    changed();
  }
  /** One A-B press: sets A at the playhead, then B (the loop starts), then clears. */
  function markAB() {
    const m = mediaNow(), { a, b } = state.ab;
    state.ab = a == null ? { a: m, b: null } : b == null && m > a ? { a, b: m } : { a: null, b: null };
    setLoopSpec();
    if (state.ab.b != null && !loop.spec) state.ab = { a: null, b: null };
    changed();
  }
  function seek(ms) {
    if (!Number.isFinite(ms)) return;
    probe({ k: 'mark', t: now(), name: 'seek' });
    video.currentTime = Math.max(0, ms) / 1000;
  }

  function status() {
    const g = gate();
    if (why) return { text: why, tone: 'warn' };
    if (g && state.scene) return { text: g, tone: 'warn' };
    if (api.trialPending) return { text: AN_COPY.trial, tone: 'intent' };
    if (state.phase === 'preroll') return { text: COPY.positioning, tone: '' };
    if (buffering) return { text: COPY.buffering, tone: '' };
    if (transient) return { text: transient, tone: '' };
    const ceil = fields ? ceilingOf(api, fields) : {};
    if (ceil.vmax && ceil.spanMm && peak * (state.T.hi - state.T.lo) * ceil.spanMm > ceil.vmax) return { text: COPY.overLimit, tone: 'warn' };
    if (info.length) return { text: info[0] + (info.length > 1 ? ' (+' + (info.length - 1) + ' ' + COPY.more + ')' : ''), tone: '' };
    return { text: state.scene ? '' : COPY.empty, tone: '' };
  }
  function refresh() { state.status = { ...status(), notes: info }; }
  function changed() { refresh(); onChange(); }

  const on = (ev, fn) => video.addEventListener(ev, fn);
  on('play', () => { if (state.phase !== 'playing') video.pause(); });
  on('pause', () => {
    if (state.phase === 'playing' && video.ended) { state.phase = 'ready'; sentSince = false; homeAt = now() + state.play.homeAfterMs; changed(); }
    else if (active()) stop('ready');
  });
  on('ended', () => { if (state.phase === 'playing') { state.phase = 'ready'; sentSince = false; homeAt = now() + state.play.homeAfterMs; changed(); } });
  on('waiting', () => { if (state.phase === 'playing' && !loop.wrapping) { hold(); buffering = true; changed(); } });
  on('playing', () => { if (state.phase === 'playing' && !loop.wrapping) { buffering = false; resetClock(); changed(); } });
  on('seeking', () => {
    if (loop.wrapping) return;
    if (state.phase === 'playing') { hold(); seekT = state.play.seekMs; }
    trace.length = 0;
    const was = loop.spec;
    scheduler.setLoop(loop.seeked(video.currentTime * 1000));
    if (was && !loop.spec) { state.ab = { a: null, b: null }; changed(); }
  });
  on('durationchange', () => setLoopSpec());
  on('ratechange', () => { if (state.phase === 'playing') hold(); });
  on('error', () => { if (state.scene) stop('error', COPY.badFormat); });
  applyPlay();

  return {
    state, trace, play, tick, onFrame, load, setMotion, setT, setView, seek, mediaNow, here, setPlay, markAB,
    get low() { return !!state.play.lowLatency; },
    get wire() { return wired; },
    /** The scale in force: Auto's fit or the operator's. */
    get scale() { return interp.scaleAuto ? autoGain : interp.scale; },
    /** Under Auto, the Script the analyzer measures (the wire at scale 1); else null. */
    get fit() { return interp.scaleAuto && state.script ? autoWire : null; },
    /** The analyzer's measure of fit: e the planner's widest excursion (analyzer.js wideExtent); null keeps the estimate. */
    fitKinetic(sc, e) {
      if (!interp.scaleAuto || sc !== autoWire || e == null) return;
      const g = fitGain(e);
      if (g !== autoGain) { autoGain = g; reshape(); changed(); }
    },
    pause: () => { if (active()) stop('ready'); },
    toggle: () => (active() ? stop('ready') : play()),
    halt: () => { if (active()) stop('held'); },
    canPlay,
    setFields(f) { fields = f; reshape(); warm(); changed(); },
    setInterp(v) { interp = v; if (!v.scaleAuto) autoFor = null; reshape(); changed(); },
    update() { if (gate() && active()) stop('held', '', true); else changed(); },
    dispose() {
      if (active()) stop('held');
      if (url) revoke(url);
      url = null;
    },
  };
}

// ---- the card ---------------------------------------------------------------

// The stage row is the only flexible row and may shrink to 0, so the fixed rows always fit the card.
// Its 16:9 spacer, capped at 240 px, gives it height where the card has none of its own (a category page).
export const CSS = `
.fsp { position: relative; height: 100%; min-height: 0; display: grid; gap: 4px; --fsp-detail: 96px; --fsp-src: 24px; --fsp-bar: 28px;
  grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: var(--fsp-src) minmax(0, 1fr) var(--fsp-bar) 124px 20px;
  grid-template-areas: "src lib" "stage lib" "tr lib" "tl lib" "st st"; }
@media (pointer: coarse) { .fsp { --fsp-src: var(--tap); --fsp-bar: var(--tap); } }
.fsp[data-comp=full][data-libshut]:not([data-an]) { grid-template-columns: minmax(0, 1fr); grid-template-areas: "src" "stage" "tr" "tl" "st"; }
.fsp[data-comp=full][data-libshut] .fsp-libbox { display: none; }
.fsp[data-comp=handheld] { --fsp-detail: 72px; grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--tap) minmax(0, 1fr) var(--fsp-bar) 100px 20px;
  grid-template-areas: "src" "stage" "tr" "tl" "st"; }
.fsp[data-comp=handheld][data-narrow] { grid-template-rows: var(--tap) minmax(0, 1fr) calc(var(--fsp-bar) * 2 + 4px) 100px 20px; }
.fsp[data-comp=glance] { --fsp-bar: var(--tap); grid-template-columns: minmax(0, 1fr); grid-template-rows: 20px 24px var(--tap) 20px;
  grid-template-areas: "src" "meter" "tr" "st"; }
.fsp [hidden] { display: none !important; }
.fsp button, .fsp input { font: inherit; }
.fsp-btn { min-height: var(--tap); min-width: var(--tap); padding: 0 10px; background: none; color: var(--tx); border: 1px solid var(--line-2);
  border-radius: var(--r-s); cursor: pointer; white-space: nowrap; }
.fsp-btn:hover { border-color: var(--line-4); }
.fsp-btn:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
.fsp-btn[aria-pressed=true], .fsp-btn[aria-selected=true] { color: var(--highlight); border-color: var(--highlight); }
.fsp-btn:disabled { opacity: .4; cursor: default; }
.fsp-src { grid-area: src; display: flex; align-items: center; gap: 6px; min-width: 0; }
.fsp-open { min-height: 0; height: var(--fsp-src); padding: 0 8px; font-size: .8rem; }
.fsp-libcaret { display: none; flex: none; place-items: center; width: 18px; height: var(--fsp-src); padding: 0; color: var(--tx-mut);
  background: var(--bg-raised); border: 1px solid var(--line); border-right: 0; border-radius: var(--r-s) 0 0 var(--r-s); cursor: pointer; }
@media (pointer: coarse) { .fsp-libcaret { width: var(--tap); } }
.fsp[data-comp=full]:not([data-an]) .fsp-libcaret { display: grid; }
.fsp-libcaret:hover { color: var(--tx-hi); }
.fsp-libcaret:focus-visible { outline: 2px solid var(--highlight); outline-offset: -2px; }
.fsp-libcaret svg { width: 14px; height: 14px; fill: none; }
.fsp-libcaret svg .s { stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.fsp[data-libshut] .fsp-libcaret svg { transform: rotate(180deg); }
.fsp-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); font-size: .85rem; }
.fsp-src > [role=tablist] { display: flex; flex: none; gap: 4px; }
.fsp-tab { display: none; }
.fsp[data-comp=handheld] .fsp-tab { display: inline-block; }
.fsp[data-comp=handheld] .fsp-title, .fsp[data-comp=glance] .fsp-open, .fsp[data-comp=full] .fsp-lib-open { display: none; }
.fsp[data-comp=handheld][data-view=library] .fsp-open { visibility: hidden; }
.fsp[data-comp=glance] .fsp-title { font-size: .75rem; line-height: 20px; }
.fsp-stage { grid-area: stage; position: relative; min-height: 0; background: var(--bg-sunken); border-radius: var(--r-s); overflow: hidden; }
.fsp-stage::before { content: ''; display: block; aspect-ratio: 16 / 9; max-height: 240px; }
.fsp-stage video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.fsp-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--tx-mut); font-size: .85rem; pointer-events: none; }
.fsp-tlbox { grid-area: tl; min-width: 0; }
.fsp-libbox { grid-area: lib; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.fsp[data-comp=full] .fsp-lib { min-height: 400px; }
.fsp[data-comp=handheld] .fsp-libbox { grid-area: 2 / 1 / 5 / 2; }
.fsp[data-comp=handheld][data-view=library] :is(.fsp-stage, .fsp-tlbox, .fsp-tr) { visibility: hidden; }
.fsp[data-comp=handheld][data-view=player] .fsp-libbox { visibility: hidden; }
.fsp[data-comp=glance] .fsp-libbox, .fsp[data-comp=glance] .fsp-tlbox { display: none; }
.fsp[data-comp=glance] .fsp-stage { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.fsp-meter { grid-area: meter; position: relative; display: none; border: 1px solid var(--line); border-radius: var(--r-s); }
.fsp[data-comp=glance] .fsp-meter { display: block; }
.fsp-tick { position: absolute; top: 2px; bottom: 2px; width: 3px; margin-left: -1.5px; border-radius: 1.5px; }
.fsp-tick.int { background: var(--intent); }
.fsp-tick.real { background: var(--reality); }
.fsp-tick.stale { opacity: .4; }
.fsp-slot { grid-area: st; height: 20px; line-height: 20px; font-size: .78rem; color: var(--tx-mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-left: 3px solid transparent; padding-left: 6px; background: var(--bg-sunken); border-radius: var(--r-s); box-shadow: inset 0 0 0 1px var(--line); }
.fsp-slot[data-tone=warn] { color: var(--tx); border-left-color: var(--warn); }
.fsp-tr { grid-area: tr; display: grid; gap: 4px; align-items: center; min-width: 0;
  grid-template-columns: max-content max-content max-content minmax(auto, 1fr);
  grid-template-areas: "motion off inv speed"; }
.fsp-tr .fsp-btn { min-height: var(--fsp-bar); }
.fsp[data-comp=handheld][data-narrow] .fsp-tr { grid-template-columns: max-content minmax(auto, 1fr);
  grid-template-rows: var(--fsp-bar) var(--fsp-bar); grid-template-areas: "motion off" "inv speed"; }
.fsp:not([data-comp=glance], [data-an][data-comp=handheld]) :is(.fsp-play, .fsp-time) { display: none; }
.fsp[data-an][data-comp=handheld] .fsp-tr { --fsp-bar: var(--tap); grid-template-columns: max-content 16ch minmax(auto, 1fr) max-content;
  grid-template-rows: var(--tap) var(--tap);
  grid-template-areas: "play time speed speed" "motion off off inv"; }
.fsp[data-an][data-comp=handheld][data-narrow] .fsp-tr { grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: var(--tap) var(--tap) var(--tap);
  grid-template-areas: "play time time" "motion off off" "inv speed speed"; }
.fsp[data-an][data-comp=handheld][data-narrow] .fsp-time { font-size: .7rem; }
.fsp[data-comp=glance] .fsp-tr { grid-template-columns: auto 1fr; grid-template-areas: "play time"; }
.fsp[data-comp=glance] :is(.fsp-motion, .fsp-off, .fsp-inv, .fsp-speed) { display: none; }
.fsp-play { grid-area: play; min-width: 72px; }
.fsp-time { grid-area: time; font: .8rem var(--mono); color: var(--tx-val); white-space: nowrap; overflow: hidden; }
.fsp[data-comp=glance] .fsp-time { font-size: .7rem; }
.fsp-motion { grid-area: motion; }
.fsp-inv { grid-area: inv; }
.fsp-off { grid-area: off; display: flex; align-items: center; gap: 6px; min-height: var(--fsp-bar); }
.fsp-offk { cursor: ew-resize; touch-action: none; user-select: none; color: var(--tx-mut); font-size: .8rem; min-height: var(--fsp-bar); display: grid; align-items: center; }
.fsp-off input { width: 7ch; height: var(--fsp-bar); min-height: var(--fsp-bar); font-family: var(--mono); }
.fsp-speed { grid-area: speed; position: relative; height: var(--fsp-bar); min-width: 10ch; font: .75rem var(--mono); display: grid; align-items: center; }
.fsp-speed i { position: absolute; left: 0; bottom: 3px; height: 3px; border-radius: 1.5px; background: var(--intent); max-width: 100%; }
.fsp-speed[data-over] i { background: var(--warn); }
.fsp-speed span { color: var(--tx-mut); white-space: nowrap; overflow: hidden; }
.fsp-speed[data-over] span { color: var(--tx); }
.fsp-slot[data-tone=intent] { border-left-color: var(--intent); }
.fsp-anbox { grid-area: an; min-width: 0; min-height: 0; display: none; }
.fsp[data-an]:not([data-comp=glance]) .fsp-anbox { display: block; contain: size; }
.fsp[data-an]:not([data-comp=glance]) .fsp-libbox { display: none; }
.fsp[data-an]:not([data-comp=glance]) .fsp-tlbox { position: relative; min-height: 0; }
.fsp[data-an]:not([data-comp=glance]) .fsp-tlbox::before { content: ''; display: block; aspect-ratio: 16 / 9; max-height: 240px; margin-bottom: 128px; }
.fsp[data-an]:not([data-comp=glance]) .fsp-tl { position: absolute; inset: 0; }
.fsp[data-an]:not([data-comp=glance]) .fsp-dt { height: auto; flex: 1 1 0; min-height: 0; }
.fsp[data-an][data-comp=full] { grid-template-columns: minmax(0, 1fr) clamp(320px, 40%, 560px); grid-template-rows: var(--fsp-src) calc(180px - var(--fsp-src) - 4px) minmax(0, 1fr) 20px var(--fsp-bar);
  grid-template-areas: "src stage" "tl stage" "tl an" "st st" "tr tr"; }
.fsp[data-an][data-comp=full] .fsa-row { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 9ch; }
.fsp[data-an][data-comp=handheld] { --fsp-an: 55%; grid-template-rows: var(--tap) minmax(0, 1fr) 20px calc(var(--tap) * 2 + 4px);
  grid-template-areas: "src" "tl" "st" "tr"; }
.fsp[data-an][data-comp=handheld][data-narrow] { grid-template-rows: var(--tap) minmax(0, 1fr) 20px calc(var(--tap) * 3 + 8px); }
.fsp[data-an][data-comp=handheld] .fsp-tlbox::before { margin-bottom: calc(var(--fsp-bar) + 100px - var(--tap) * 2); }
.fsp[data-an][data-comp=handheld][data-narrow] .fsp-tlbox::before { margin-bottom: calc(var(--fsp-bar) * 2 + 100px - var(--tap) * 3); }
.fsp[data-an][data-comp=handheld] .fsp-tl { bottom: calc(var(--fsp-an) + 4px); }
.fsp[data-an][data-comp=handheld] .fsp-anbox { grid-area: tl; align-self: end; height: var(--fsp-an); }
.fsp[data-an][data-comp=handheld] .fsp-stage { grid-area: src; justify-self: end; width: calc(var(--tap) * 16 / 9); height: var(--tap); }
.fsp[data-an][data-comp=handheld] .fsp-stage::before { display: none; }
.fsp[data-an][data-comp=handheld] .fsp-tab { display: none; }
.fsp[data-an][data-comp=handheld] :is(.fsp-stage, .fsp-tlbox, .fsp-tr) { visibility: visible; }
.fsp[data-an] .fsp-empty { font-size: .7rem; }
.fsp-hov { position: absolute; inset: 0; z-index: 1; pointer-events: none; container-type: size; }
.fsp-hb { position: absolute; left: 0; right: 0; bottom: 0; display: grid; grid-template-rows: 16px var(--tap); padding: 20px 6px 0;
  background: linear-gradient(to top, color-mix(in srgb, var(--bg-raised) 92%, transparent), color-mix(in srgb, var(--bg-raised) 55%, transparent) 60%, transparent);
  opacity: 0; transition: opacity .2s; pointer-events: none; }
.fsp-hov[data-show] > .fsp-hb, .fsp-hb:has(:focus-visible) { opacity: 1; pointer-events: auto; }
@media (pointer: coarse) { .fsp-hb { grid-template-rows: var(--tap) var(--tap); padding-top: 8px; } }
@container (max-height: 129px) { .fsp-hb { display: none; } }
@container (max-width: 439px) { .fsp-hb-vol, .fsp-hov .fsp-hb-mode { display: none; } }
.fsp-hb-seek { position: relative; display: grid; align-items: center; margin: 0 6px; cursor: pointer; touch-action: none; outline: none; }
.fsp-hb-seek:focus-visible .fsp-hb-track { outline: 2px solid var(--highlight); outline-offset: 3px; }
.fsp-hb-track { position: relative; height: 3px; border-radius: 1.5px; background: color-mix(in srgb, var(--tx) 22%, transparent); transition: height .1s; }
.fsp-hb-seek:is(:hover, [data-drag]) .fsp-hb-track { height: 5px; }
.fsp-hb-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; }
.fsp-hb-buf { background: color-mix(in srgb, var(--tx) 40%, transparent); }
.fsp-hb-played { background: var(--highlight); }
.fsp-hb-played::after { content: ''; position: absolute; right: -6px; top: 50%; width: 12px; height: 12px; margin-top: -6px; border-radius: 50%;
  background: var(--highlight); transform: scale(0); transition: transform .1s; }
.fsp-hb-seek:is(:hover, [data-drag], :focus-visible) .fsp-hb-played::after { transform: none; }
.fsp-hb-tip { position: absolute; bottom: calc(50% + 10px); transform: translateX(-50%); padding: 2px 6px; font: .75rem var(--mono); color: var(--tx);
  background: var(--bg-raised); border: 1px solid var(--line); border-radius: var(--r-s); white-space: nowrap; pointer-events: none; }
.fsp-hb-row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.fsp-hb-b { flex: none; display: grid; place-items: center; width: var(--tap); height: var(--tap); padding: 0; color: var(--tx); background: none;
  border: 0; border-radius: var(--r-s); cursor: pointer; }
.fsp-hb-b:hover { color: var(--tx-hi); }
.fsp-hb-b:focus-visible { outline: 2px solid var(--highlight); outline-offset: -2px; }
.fsp-hb-b:disabled { opacity: .4; cursor: default; }
.fsp-hb-b svg { width: 20px; height: 20px; fill: currentColor; }
.fsp-hb-b svg .s { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.fsp-hb-vol { flex: 0 1 80px; min-width: 48px; height: var(--tap); margin: 0; accent-color: var(--highlight); cursor: pointer; }
.fsp-hb-time { flex: 0 1 auto; min-width: 0; padding: 0 6px 0 10px; font: .78rem var(--mono); color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsp-hb-gap { flex: 1 1 0; }
.fsp[data-media][data-comp] { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: minmax(0, 1fr) !important; grid-template-areas: "stage" !important; }
.fsp[data-media] > :not(.fsp-stage, style) { display: none !important; }
.fsp[data-media][data-comp] .fsp-stage { grid-area: stage; position: relative; width: auto; height: auto; clip-path: none; justify-self: stretch;
  visibility: visible; border-radius: 0; }
.fsp[data-media] .fsp-stage::before { display: none; }
.fsp[data-media] .fsp-stage:has(.fsp-hov:not([data-show])) { cursor: none; }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const setText = (e, t) => { if (e.textContent !== t) e.textContent = t; };
const SVG_NS = 'http://www.w3.org/2000/svg';

export function createPlayer(api) {
  let probeRing = null;
  try { if (localStorage.getItem(PROBE_KEY) === '1') probeRing = window.__funscriptProbe = []; } catch (e) { /* private mode */ }
  const probe = (x) => {
    if (!probeRing) return;
    probeRing.push(x);
    if (probeRing.length > PROBE_RING) probeRing.splice(0, probeRing.length - PROBE_RING);
  };

  const video = document.createElement('video');
  video.controls = false;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.preload = 'auto';
  for (const a of ['playsinline', 'disablepictureinpicture', 'disableremoteplayback']) video.setAttribute(a, '');
  const audio = readPrefs(api).audio;
  video.volume = clamp(Number(audio.vol) || 0, 0, 1);
  video.muted = !!audio.muted;

  const clock = createMediaClock();
  const submit = (list) => {
    const r = api.submitSegments(list);
    if (list.length) probe({ k: 'seg', t: performance.now(), list: list.slice(0, r.sent || 0), ok: r.ok, reason: r.reason || '' });
    return r;
  };
  const scheduler = createScheduler({ submit, log: (m, l) => api.log(m, l) });
  const views = [];
  const ctl = createControl({ api, video, clock, scheduler, submit, probe, onChange: () => views.forEach((v) => v.render()) });
  const stopFrames = frameSource(video, ctl.onFrame, undefined, () => (ctl.low ? LOW.fallbackMs : FALLBACK_AFTER_MS));

  let stash = null, stashId = '';
  const getStash = () => {
    const { base, key } = readPrefs(api).stash || {};
    if (!base) return null;
    if (stashId !== base + '\n' + key) {
      stash = createStash({ fetch: (u, i) => api.net.fetch(u, i), base, key });
      stashId = base + '\n' + key;
    }
    return stash;
  };
  function pick(scene) {
    const client = getStash();
    ctl.load(scene, scene.funscript && client ? client.script(scene) : null, COPY.noScriptScene);
  }
  function openLocal(files) {
    const scene = localScene([...files]);
    if (!scene) return;
    const sc = scene.script;
    ctl.load(scene, sc ? sc.text().then((t) => parseFunscript(t, sc.name)) : null, COPY.noScriptVideo, scene.extra);
  }

  let raf = 0;
  const loop = () => {
    ctl.tick();
    for (const v of views) v.frame();
    raf = views.length ? requestAnimationFrame(loop) : 0;
  };
  const onVis = () => { if (document.hidden) ctl.halt(); };
  document.addEventListener('visibilitychange', onVis);

  /** opts.fullscreen: the hover bar offers page fullscreen (a page mount). */
  function mount(el, fields, opts = {}) {
    const view = makeView(el, fields, opts);
    views.push(view);
    view.host();
    ctl.setFields(fields);
    if (!raf) raf = requestAnimationFrame(loop);
    return {
      update() { ctl.update(); view.render(); },
      unmount() {
        const i = views.indexOf(view);
        if (i < 0) return;
        views.splice(i, 1);
        if (view.hosting()) {
          ctl.halt();
          const last = views[views.length - 1];
          if (last) { last.host(); ctl.setFields(last.fields); }
        }
        view.destroy();
        if (!views.length && raf) { cancelAnimationFrame(raf); raf = 0; }
      },
    };
  }

  function makeView(el, fields, opts) {
    const st = ctl.state;
    const file = h('input', { type: 'file', multiple: '', accept: 'video/*,audio/*,.funscript', hidden: '' });
    file.addEventListener('change', () => { if (file.files && file.files.length) openLocal(file.files); file.value = ''; });
    const btn = (cls, text, attrs = {}) => h('button', { type: 'button', class: 'fsp-btn ' + cls, text, ...attrs });
    const tabP = btn('fsp-tab', COPY.player, { role: 'tab' });
    const tabL = btn('fsp-tab', COPY.library, { role: 'tab' });
    tabP.addEventListener('click', () => ctl.setView('player'));
    tabL.addEventListener('click', () => ctl.setView('library'));
    const open = btn('fsp-open', COPY.openFiles);
    open.addEventListener('click', () => file.click());
    const title = h('span', { class: 'fsp-title' });
    const src = h('div', { class: 'fsp-src' }, h('span', { role: 'tablist' }, tabP, tabL), open, title, file);

    const empty = h('div', { class: 'fsp-empty', text: COPY.openVideo });
    const stage = h('div', { class: 'fsp-stage' }, empty);
    const tlbox = h('div', { class: 'fsp-tlbox' });
    const lib = h('div', { class: 'fsp-libbox' });
    const anbox = h('div', { class: 'fsp-anbox' });
    const tickI = h('i', { class: 'fsp-tick int' });
    const tickR = h('i', { class: 'fsp-tick real' });
    const meter = h('div', { class: 'fsp-meter', role: 'img', 'aria-label': COPY.meter }, tickI, tickR);
    const status = h('div', { class: 'fsp-slot', 'aria-live': 'polite' });

    const play = btn('fsp-play', COPY.play);
    play.addEventListener('click', () => ctl.toggle());
    const time = h('output', { class: 'fsp-time' });
    const motion = btn('fsp-motion', COPY.motion);
    motion.addEventListener('click', () => ctl.setMotion(!st.motion));
    const offIn = h('input', { type: 'number', min: '-500', max: '500', step: '5', 'aria-label': COPY.offset, title: COPY.offsetTip });
    const offK = h('span', { class: 'fsp-offk', text: COPY.offset, title: COPY.offsetTip });
    const off = h('label', { class: 'fsp-off' }, offK, offIn);
    const commitOff = (v) => { if (clampOffset(v) !== st.T.offsetMs) ctl.setT({ offsetMs: clampOffset(v) }); offIn.value = String(st.T.offsetMs); };
    offIn.addEventListener('change', () => commitOff(offIn.value));
    offIn.addEventListener('keydown', (e) => {
      if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      offIn.value = String(clampOffset(+offIn.value + (e.key === 'ArrowUp' ? 50 : -50)));
    });
    offIn.addEventListener('keyup', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') commitOff(offIn.value); });
    let offDrag = null;
    offK.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      offK.setPointerCapture(e.pointerId);
      offDrag = { id: e.pointerId, x: e.clientX, v: st.T.offsetMs };
    });
    offK.addEventListener('pointermove', (e) => {
      if (offDrag && e.pointerId === offDrag.id) offIn.value = String(clampOffset(offDrag.v + Math.round((e.clientX - offDrag.x) / 2) * 5));
    });
    const offUp = (e) => { if (offDrag && e.pointerId === offDrag.id) { offDrag = null; commitOff(offIn.value); } };
    offK.addEventListener('pointerup', offUp);
    offK.addEventListener('pointercancel', offUp);
    const inv = btn('fsp-inv', COPY.invert);
    inv.addEventListener('click', () => ctl.setT({ invert: !st.T.invert }));
    const speedBar = h('i');
    const speedTxt = h('span');
    const speed = h('div', { class: 'fsp-speed', title: COPY.speed }, speedBar, speedTxt);
    const saveAudio = () => writePref(api, 'audio', { vol: video.volume, muted: video.muted });
    const setMuted = (m) => { video.muted = m; saveAudio(); render(); };
    const tr = h('div', { class: 'fsp-tr' }, play, time, motion, off, inv, speed);

    const root = h('div', { class: 'fsp', tabindex: '-1' }, h('style', { text: CSS + TL_CSS + AN_CSS }),
      src, stage, tlbox, lib, anbox, meter, status, tr);
    // ---- the hover bar over the video ----
    const icon = () => {
      const s = document.createElementNS(SVG_NS, 'svg');
      s.setAttribute('viewBox', '0 0 16 16');
      s.setAttribute('aria-hidden', 'true');
      const k = document.createElementNS(SVG_NS, 'path');
      k.setAttribute('class', 's');
      s.append(document.createElementNS(SVG_NS, 'path'), k);
      return s;
    };
    const hbBtn = (cls) => { const b = h('button', { type: 'button', class: 'fsp-hb-b ' + cls }); b.append(icon()); return b; };
    const setIcon = (b, [f, k], tip) => {
      const [pf, pk] = b.firstChild.children;
      if (pf.getAttribute('d') !== f || pk.getAttribute('d') !== k) { pf.setAttribute('d', f); pk.setAttribute('d', k); }
      if (b.title !== tip) { b.title = tip; b.setAttribute('aria-label', tip); }
    };
    const attr = (e, k, v) => { if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
    const hbPlay = hbBtn('fsp-hb-play'), hbMute = hbBtn('fsp-hb-mute'), hbFull = hbBtn('fsp-hb-full'), hbMode = hbBtn('fsp-hb-mode');
    hbFull.hidden = !opts.fullscreen;
    const fsMode = () => document.documentElement.dataset.fullscreenMode || '';
    hbMode.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phosphor-page-fullscreen-mode',
      { detail: { mode: fsMode() === 'borderless' ? 'window' : 'borderless' } })));
    const libCaret = h('button', { type: 'button', class: 'fsp-libcaret', title: COPY.library, 'aria-label': COPY.library });
    libCaret.append(icon());
    libCaret.firstChild.children[1].setAttribute('d', ICON.caret[1]);
    libCaret.addEventListener('click', () => { const on = root.hasAttribute('data-libshut'); setLib(on); writePref(api, 'libOpen', on); });
    const setLib = (on) => { root.toggleAttribute('data-libshut', !on); libCaret.setAttribute('aria-expanded', String(on)); };
    setLib(readPrefs(api).libOpen);
    src.append(libCaret);
    const hbVol = h('input', { class: 'fsp-hb-vol', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': COPY.volume, title: COPY.volume });
    const hbTime = h('span', { class: 'fsp-hb-time' });
    const hbBuf = h('i', { class: 'fsp-hb-buf' }), hbPlayed = h('i', { class: 'fsp-hb-played' });
    const hbTip = h('span', { class: 'fsp-hb-tip', hidden: '' });
    const seek = h('div', { class: 'fsp-hb-seek', role: 'slider', tabindex: '0', 'aria-label': COPY.seek, 'aria-valuemin': '0' },
      h('div', { class: 'fsp-hb-track' }, hbBuf, hbPlayed), hbTip);
    const hb = h('div', { class: 'fsp-hb' }, seek,
      h('div', { class: 'fsp-hb-row' }, hbPlay, hbMute, hbVol, hbTime, h('span', { class: 'fsp-hb-gap' }), hbMode, hbFull));
    const hov = h('div', { class: 'fsp-hov' }, hb);
    stage.append(hov);
    hbPlay.addEventListener('click', () => ctl.toggle());
    hbMute.addEventListener('click', () => setMuted(!video.muted));
    hbVol.addEventListener('input', () => { video.volume = clamp(+hbVol.value, 0, 1); if (video.volume > 0) video.muted = false; });
    hbVol.addEventListener('change', saveAudio);
    // Shown on pointer movement, hidden after HOVER_IDLE_MS idle and on leave, kept while the pointer
    // rests on the bar or drags the seek. A touch on the hidden bar's video shows it without toggling.
    let idle = 0, drag = null, tapShow = false;
    const hide = () => { if (drag == null && !hb.matches(':hover')) hov.removeAttribute('data-show'); };
    const poke = () => { hov.setAttribute('data-show', ''); clearTimeout(idle); idle = setTimeout(hide, HOVER_IDLE_MS); };
    stage.addEventListener('pointermove', poke);
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && drag == null) { clearTimeout(idle); hov.removeAttribute('data-show'); } });
    stage.addEventListener('pointerdown', (e) => { tapShow = e.pointerType !== 'mouse' && !hov.hasAttribute('data-show'); poke(); });
    stage.addEventListener('click', (e) => { if (!tapShow && !e.target.closest('.fsp-hb')) ctl.toggle(); tapShow = false; });
    const dur = () => (Number.isFinite(video.duration) ? video.duration * 1000 : st.script ? st.script.durationMs : 0);
    const msAt = (x) => { const r = seek.getBoundingClientRect(); return r.width ? clamp((x - r.left) / r.width, 0, 1) * dur() : 0; };
    seek.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      root.focus({ preventScroll: true });
      seek.setPointerCapture(e.pointerId);
      drag = e.pointerId;
      seek.setAttribute('data-drag', '');
      ctl.seek(msAt(e.clientX));
    });
    seek.addEventListener('pointermove', (e) => {
      const r = seek.getBoundingClientRect();
      hbTip.hidden = false;
      setText(hbTip, fmtTime(msAt(e.clientX)));
      const w2 = hbTip.offsetWidth / 2;
      hbTip.style.left = clamp(e.clientX - r.left, w2, r.width - w2) + 'px';
      if (drag === e.pointerId) ctl.seek(msAt(e.clientX));
    });
    const endDrag = (e) => { if (drag === e.pointerId) { drag = null; seek.removeAttribute('data-drag'); } };
    seek.addEventListener('pointerup', endDrag);
    seek.addEventListener('pointercancel', endDrag);
    seek.addEventListener('pointerleave', () => { if (drag == null) hbTip.hidden = true; });
    // Media fullscreen: the shell's page fullscreen, bare, with the video alone until it ends.
    let media = false;
    const setMedia = (on) => { media = on; root.toggleAttribute('data-media', on); render(); };
    const fullscreen = () => {
      const ask = new CustomEvent('phosphor-page-fullscreen', { bubbles: true, cancelable: true, detail: { on: !media } });
      if (!root.dispatchEvent(ask)) setMedia(!media);
    };
    const onFull = (e) => { if (media && !(e.detail && e.detail.on)) setMedia(false); };
    if (opts.fullscreen) window.addEventListener('phosphor-page-fullscreen-change', onFull);
    hbFull.addEventListener('click', fullscreen);

    const KEY_SEEK = { j: -10000, l: 10000, ArrowLeft: -5000, ArrowRight: 5000 };
    root.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, select, textarea, [role=slider]:not(.fsp-hb-seek)')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ((k === ' ' && !e.target.closest('button')) || k === 'k') ctl.toggle();
      else if (k in KEY_SEEK) ctl.seek(Math.max(0, ctl.mediaNow() + KEY_SEEK[k]));
      else if (k === 'm') setMuted(!video.muted);
      else if (k === 'f' && opts.fullscreen) fullscreen();
      else return;
      e.preventDefault();
      poke();
    });
    el.append(root);

    let zoomMs = readPrefs(api).zoomMs;
    const tl = mountTimeline(tlbox, {
      zoomMs,
      onZoom: (z) => { zoomMs = z; writePref(api, 'zoomMs', z); },
      onExpand: (on) => expand(on),
      onLoop: () => ctl.markAB(),
      onSeek: (ms) => ctl.seek(ms),
      onScrub: (phase, ms) => ctl.seek(ms),
      onRange: (partial, commit) => { if (commit) ctl.setT(partial); },
      onSettings: opts.settings ? (on) => opts.settings.toggle(on) : null,
      settingsOpen: !!(opts.settings && opts.settings.open),
    });
    let library = null, analyzer = null;
    function expand(on) {
      root.toggleAttribute('data-an', on);
      tl.setExpanded(on);
      measure();
      if (on) anMount();
    }
    function anMount() {
      if (!analyzer) analyzer = mountAnalyzer(anbox, { api, trace: () => ctl.trace, script: () => ctl.wire, T: () => st.T, fit: () => ctl.fit });
    }
    let fitSeen = null;
    const libPrefs = { get: (k) => readPrefs(api)[k], set: (k, v) => writePref(api, k, v) };

    let comp = '';
    const measure = () => {
      root.removeAttribute('data-narrow');
      if (comp === 'handheld' && tr.scrollWidth > tr.clientWidth) root.setAttribute('data-narrow', '');
    };
    const ro = new ResizeObserver(() => {
      const c = compositionOf(root.clientWidth);
      if (c !== comp) {
        comp = c;
        root.dataset.comp = c;
        if (hosting()) st.composition = c;
        if (c !== 'glance' && !library) library = mountLibrary(lib, { getStash, prefs: libPrefs, onPick: pick, onLocal: openLocal,
          fetch: (u, i) => api.net.fetch(u, i) });
      }
      measure();
    });
    ro.observe(root);
    ro.observe(offK);

    let tlKey = null;
    function render() {
      const ceil = ceilingOf(api, fields);
      const key = [st.script, st.shaped, st.T, ceil.vmax, ceil.spanMm];
      if (!tlKey || key.some((k, i) => k !== tlKey[i])) { tlKey = key; tl.setScript(st.shaped || st.script, st.T, ceil, st.script); }
      tl.setLoop(st.ab);
      const act = st.phase === 'playing' || st.phase === 'preroll';
      setText(play, act ? COPY.pause : COPY.play);
      play.disabled = !act && !ctl.canPlay();
      setIcon(hbPlay, act ? ICON.pause : ICON.play, act ? COPY.pauseKey : COPY.playKey);
      hbPlay.disabled = play.disabled;
      setIcon(hbMute, video.muted ? ICON.muted : ICON.vol, video.muted ? COPY.unmuteKey : COPY.muteKey);
      setIcon(hbFull, media ? ICON.unfull : ICON.full, media ? COPY.fullExit : COPY.full);
      const fm = fsMode();
      hbMode.hidden = !opts.fullscreen || !fm;
      setIcon(hbMode, fm === 'borderless' ? ICON.bdl : ICON.win, COPY.mode);
      attr(hbMode, 'aria-pressed', String(fm === 'borderless'));
      if (document.activeElement !== hbVol) hbVol.value = String(video.muted ? 0 : video.volume);
      motion.setAttribute('aria-pressed', String(st.motion));
      inv.setAttribute('aria-pressed', String(st.T.invert));
      if (document.activeElement !== offIn && !offDrag) offIn.value = String(st.T.offsetMs);
      root.dataset.view = st.view;
      tabP.setAttribute('aria-selected', String(st.view === 'player'));
      tabL.setAttribute('aria-selected', String(st.view === 'library'));
      setText(title, st.scene ? st.scene.title : '');
      empty.hidden = !!st.scene;
      setText(status, st.status.text);
      status.dataset.tone = st.status.tone;
      const tip = st.status.notes.join('\n');
      if (status.title !== tip) status.title = tip;
    }
    function frame() {
      const m = ctl.mediaNow();
      const d = Number.isFinite(video.duration) ? video.duration * 1000 : st.script ? st.script.durationMs : 0;
      const tt = fmtTime(m) + ' / ' + fmtTime(d);
      setText(time, tt);
      setText(hbTime, tt);
      let buf = 0;
      for (let i = 0, b = video.buffered; b && i < b.length; i++) if (b.start(i) * 1000 <= m + 500) buf = Math.max(buf, b.end(i) * 1000);
      hbPlayed.style.width = (d > 0 ? clamp(m / d, 0, 1) * 100 : 0) + '%';
      hbBuf.style.width = (d > 0 ? clamp(buf / d, 0, 1) * 100 : 0) + '%';
      attr(seek, 'aria-valuemax', String(Math.round(d)));
      attr(seek, 'aria-valuenow', String(Math.round(m)));
      attr(seek, 'aria-valuetext', tt);
      if (comp !== 'glance') tl.frame(m, ctl.trace, analyzer && root.hasAttribute('data-an') ? analyzer.kinetic : null);
      if (ctl.fit && comp && comp !== 'glance') anMount();
      if (analyzer && comp !== 'glance' && (root.hasAttribute('data-an') || ctl.fit)) {
        analyzer.frame();
        const fr = analyzer.fit;
        if (fr && fr !== fitSeen) { fitSeen = fr; ctl.fitKinetic(fr.sc, fr.extent); }
      }
      const ceil = ceilingOf(api, fields);
      if (st.script) {
        const sp = strokeSpeed(st.shaped || st.script, m, st.T, ceil.spanMm);
        const cap = sp.unit === 'mm/s' && ceil.vmax ? ceil.vmax : 0;
        setText(speedTxt, Math.round(sp.v) + ' ' + sp.unit);
        speedBar.style.width = cap ? clamp(sp.v / cap, 0, 1) * 100 + '%' : '0';
        speed.toggleAttribute('data-over', !!cap && sp.v > cap);
        speed.title = cap && sp.v > cap ? COPY.speedOver : COPY.speed;
        tickI.hidden = false;
        tickI.style.left = applyT(posAt(st.shaped || st.script, m), st.T) * 100 + '%';
      } else {
        setText(speedTxt, '');
        speedBar.style.width = '0';
        tickI.hidden = true;
      }
      const pu = fields.pos ? windowShare(api.value(fields.pos), fields.lo && api.value(fields.lo), fields.hi && api.value(fields.hi)) : null;
      tickR.hidden = pu == null;
      if (pu != null) tickR.style.left = pu * 100 + '%';
      tickR.classList.toggle('stale', !!(fields.pos && api.stale(fields.pos)));
      render();
    }
    const hosting = () => video.parentNode === stage;
    render();
    return {
      fields, render, frame, hosting,
      host() { stage.append(video); st.composition = comp || st.composition; },
      destroy() {
        clearTimeout(idle);
        window.removeEventListener('phosphor-page-fullscreen-change', onFull);
        ro.disconnect();
        tl.unmount();
        if (library) library.unmount();
        if (analyzer) analyzer.unmount();
        root.remove();
      },
    };
  }

  return {
    mount,
    dispose() {
      ctl.dispose();
      stopFrames();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('visibilitychange', onVis);
      video.removeAttribute('src');
      video.load();
    },
    setInterp(v) { ctl.setInterp(v); },
    setPlay(v) { ctl.setPlay(v); },
    get scale() { return ctl.scale; },
    get state() { return ctl.state; },
  };
}

// ---- the settings card's playback rows -------------------------------------

export const PLAY_CSS = `
.fsp-pset { display: grid; grid-template-columns: 12ch minmax(0, 1fr) 9ch; grid-auto-rows: var(--tap); gap: 4px 8px; align-items: center; margin-top: 8px; }
.fsp-pset h4 { grid-column: 1 / -1; margin: 0; font-size: .85rem; color: var(--tx-mut); font-weight: 600; }
.fsp-pset label { color: var(--tx-mut); font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsp-pset input { min-height: var(--tap); margin: 0; min-width: 0; font: inherit; }
.fsp-pset input:focus-visible, .fsp-pset button:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
.fsp-pset button { justify-self: start; min-height: var(--tap); min-width: calc(var(--tap) * 2); padding: 0 10px; background: none; color: var(--tx);
  border: 1px solid var(--line-2); border-radius: var(--r-s); cursor: pointer; font: inherit; }
.fsp-pset button[aria-pressed=true] { color: var(--highlight); border-color: var(--highlight); }
.fsp-pset output { font: .8rem var(--mono); color: var(--tx-val); text-align: right; white-space: nowrap; }
.fsp-pset input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: var(--tap); background: none; cursor: ew-resize; }
.fsp-pset input[type=range]::-webkit-slider-runnable-track { height: 2px; background: var(--line-2); }
.fsp-pset input[type=range]::-moz-range-track { height: 2px; background: var(--line-2); }
.fsp-pset input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 20px; margin-top: -9px; border-radius: 4.5px;
  border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
.fsp-pset input[type=range]::-moz-range-thumb { width: 9px; height: 20px; border-radius: 4.5px; border: 2px solid var(--intent); background: var(--bg-card); box-sizing: border-box; }
`;

// [key, label, tip, min, max, step, format]: ranges are prefs.js's repairs.
const PLAY_ROWS = [
  ['loop', COPY.loop, COPY.loopTip],
  ['loopCount', COPY.loopCount, '', 0, 99, 1, (v) => (v ? v + 'x' : COPY.forever)],
  ['home', COPY.home, COPY.homeTip],
  ['homeAfterMs', COPY.homeAfter, '', 1000, 60000, 500, (v) => (v / 1000).toFixed(1) + ' s'],
  ['homePoint', COPY.homePoint, '', 0, 1, 0.05, (v) => Math.round(v * 100) + ' %'],
  ['homeSpeed', COPY.homeSpeed, '', 0.05, 2, 0.05, (v) => Math.round(v * 100) + ' %/s'],
  ['seekMs', COPY.seekMs, COPY.seekTip, 0, 3000, 50, (v) => (v ? v + ' ms' : COPY.jump)],
  ['lowLatency', COPY.low, COPY.lowTip],
  ['autoLatency', COPY.auto, COPY.autoTip],
];

/** Settings card rows for the play prefs, one var(--tap) row each; -> unmount(). onChange(partial) on commit. */
export function mountPlay(el, { value, onChange }) {
  let v = { ...value };
  const root = h('div', { class: 'fsp-pset', role: 'group', 'aria-label': COPY.playHeading }, h('style', { text: PLAY_CSS }),
    h('h4', { text: COPY.playHeading }));
  const draws = PLAY_ROWS.map(([key, label, tip, min, max, step, fmt]) => {
    const lab = h('label', { text: label, ...(tip ? { title: tip } : {}) });
    const out = h('output');
    if (min == null) {
      const b = h('button', { type: 'button', 'aria-label': label, ...(tip ? { title: tip } : {}) });
      b.addEventListener('click', () => { v = { ...v, [key]: !v[key] }; draw(); onChange({ [key]: v[key] }); });
      root.append(lab, b, out);
      return () => { b.setAttribute('aria-pressed', String(!!v[key])); setText(b, v[key] ? COPY.on : COPY.off); };
    }
    const i = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
    i.addEventListener('input', () => setText(out, fmt(+i.value)));
    i.addEventListener('change', () => { v = { ...v, [key]: +i.value }; draw(); onChange({ [key]: v[key] }); });
    root.append(lab, i, out);
    return () => { if (document.activeElement !== i) i.value = String(v[key]); setText(out, fmt(v[key])); };
  });
  const draw = () => draws.forEach((d) => d());
  el.append(root);
  draw();
  return () => root.remove();
}
