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
// - The dash card composes by its own box: full >= 960, handheld 264..959, glance < 264; the page by its
//   class (pageClass). Every row has a fixed height; a state change swaps text only.
// - The player bar (.fsp-tr, PR5) is the card's bottom row: prev, Play, next, elapsed, the heat (timeline.js,
//   placed here), remaining, volume, Motion (PR6), rate, Fullscreen and Settings (the page's), the quick
//   rail (phones, where the host offers it). Phones and the handheld card draw the scrub row (elapsed, heat,
//   remaining) over the buttons; phones leave volume to the hardware keys. Glance keeps Play and the time.
// - The timeline head (.fsp-tlh, PR7): the caret and TIMELINE (collapses the band, pref tlOpen), zoom and
//   its span (the full card; pinch elsewhere), A-B, Offset (ms), Invert, Graph (g). Nothing sits over the
//   wave but the playhead, the range pills and the stroke speed reading at its bottom, right of the pills.
// - Prev and next step the script's chapters (metadata), else its bookmarks, the library's loaded list
//   (library.js step) only when it has neither; Close (the head's) unloads the media and returns to the
//   library. Rate scales the stroke speed shown and checked against the input limit.
// - Fullscreen is one mode (PR8): the shell's page fullscreen, the ask always bare; the bar's button, f and a
//   double-click on the stage ask it. A single click waits DOUBLE_MS so a double never toggles Play. On the phone
//   class a turn to landscape with a video enters it and the turn back leaves it (PR17).
// - The split bar (.fsp-split, between the stage and the timeline head, desktop only; its row is var(--tap) under a coarse
//   pointer, its hit box never past the 4 px gaps otherwise) sizes the wave card: drag, arrows
//   (8 px, Shift 1), double-click for the default; the stage keeps at least MIN_STAGE px (a grid track
//   minimum, so the card's min-height and the page scroll follow). The pref
//   split holds the px, 0 the composition's default. Hiding the library or the page's Settings never
//   shrinks the stage (page.js).
// - The hover bar exists in media fullscreen only (PR9); its row is the player bar's own buttons, moved in on entry
//   and back on exit. m mutes.
// - The top row keeps clear of the Borderless stop pair: the library column (full) starts below it, else
//   the source row pads by the shell's --stop-reserve.
// - Open video and Open script (PR3) sit on the empty stage and in the head (the Media menu on the handheld
//   card); either order attaches to what is loaded.
// - The library caret (full only) is a view switch kept in prefs libOpen, never a write.
// - The speed reading's floor is 10ch of its own font ('20000 mm/s'), never
//   its current text, so the switch does not move with the reading.
// - Motion: every transition rides the shell's duration tokens (--t-quick, --t-move, --ease-out), which are 0ms under html.still.
// - CSS: tokens only, never --bad or --estop (law 13); 40 px targets (law 12).
// - --warn is a mark, never text: on a light chassis it reads 1.8:1, and it is
//   locked (law 13). Warn text stays --tx beside a --warn bar.
// - The probe exists only while localStorage phosphor.funscript.probe is '1'.
// - The analyzer keeps the outer card rect: the video moves to an in-card thumbnail,
//   never picture-in-picture or element fullscreen (law 1: nothing may cover the strip).
// - The hover bar acts through the controller (toggle, seek): it never
//   calls the video's play() or pause() or sets currentTime. Volume and mute are the video's
//   own, stored as prefs audio (the bar's volume, m). Fullscreen is a page mount's only (opts.fullscreen),
//   asked by the cancelable 'phosphor-page-fullscreen' event and ended on 'phosphor-page-fullscreen-change' off.
// - 'Preview: not saved' stands in the slot while any client holds a trial (RFC-099),
//   outranked only by a refusal and the gate.
// - A loop wrap's seek is not a stop: no hold, no clock reset, no trace reset. Every other
//   seek resets the loop's lap; one while playing restarts with the seek transition.
// - With a loop the clock runs in unrolled media time; everything shown is folded back.
// - Changing the loop while playing holds and re-anchors: the unrolled clock cannot jump.
// - Auto Scale (prefs interp scaleAuto): a new script starts at [0, 1]; the analyzer's planner measure
//   of the wire at scale 1 (ctl.fit, analyzer.js fit) sets the map when it lands.
// - A card outside glance frames its analyzer, shown or not: its twin render is the timeline's intent
//   curve and Auto's measure. Glance draws no curve.

import { parseFunscript, pairFiles, posAt, fmtTime, axisOf, peakSpeed, marksOf } from './funscript.js';
import { createMediaClock, frameSource, createLoop, loopSpec } from './clock.js';
import { createScheduler, applyT, strokeSpeed, TRANSIENT } from './scheduler.js';
import { createStash } from './stash.js';
import { mountLibrary } from './library.js';
import { mountTimeline, CSS as TL_CSS } from './timeline.js';
import { mountAnalyzer, CSS as AN_CSS, COPY as AN_COPY } from './analyzer.js';
import { readPrefs, writePref } from './prefs.js';
import { wire, fitMap, mapOf } from './scale.js';
import { rowsBox, sub, sliderRow, switchRow } from './rows.js';

export const FULL_UP = 960;
export const HOVER_IDLE_MS = 2500;
export const GLANCE_UP = 264;
const PROBE_KEY = 'phosphor.funscript.probe';
const PROBE_RING = 5000;
const TRACE_MS = 8000;
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const DOUBLE_MS = 250;
export const SPLIT_MIN = 64, MIN_STAGE = 120;
// The player column the one-row bar needs (eleven items at their floors). A desktop page narrower than that with the
// library open shuts the library for the session (the pref untouched); the caret reopens it, and then the bar wraps.
const BAR_ROW_MIN = 600, LIB_W = 320;
// Registry unit_ids: 0 mm, 1 mm_s.
const UNIT_MM = 0, UNIT_MM_S = 1;

export const COPY = Object.freeze({
  play: 'Play',
  pause: 'Pause',
  openVideo: 'Open video',
  openScript: 'Open script',
  media: 'Media',
  motionOnly: 'Motion only',
  noVideo: 'No video',
  library: 'Library',
  player: 'Player',
  settings: 'Settings',
  timeline: 'Timeline',
  rail: 'Rail',
  motion: 'Motion',
  offset: 'Offset',
  offsetTip: 'Machine later (+) or earlier (-)',
  offsetUnit: 'ms',
  prev: 'Previous',
  next: 'Next',
  rate: 'Rate',
  graph: 'Graph (g)',
  close: 'Close',
  split: 'Resize',
  invert: 'Invert',
  volume: 'Volume',
  speed: 'Stroke speed',
  speedOver: 'Past the input speed limit',
  empty: 'No scene loaded',
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
  playKey: 'Play (k)',
  pauseKey: 'Pause (k)',
  muteKey: 'Mute (m)',
  unmuteKey: 'Unmute (m)',
  seek: 'Seek',
  full: 'Fullscreen (f)',
  fullExit: 'Exit fullscreen (f)',
  auto: 'Auto latency',
  autoTip: 'Offset from the plan strip',

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
  caret: ['', 'M6.5 5l3 3-3 3'],
  lib: ['', 'M2 2.5h5v5H2zM9 2.5h5v5H9zM2 9.5h5v4H2zM9 9.5h5v4H9z'],
  prev: ['M13 3v10L6 8z', 'M3 3v10'],
  next: ['M3 3v10l7-5z', 'M13 3v10'],
  graph: ['', 'M2.5 2.5h11v11h-11zM4 8Q5 5 6 5T8 8T10 11T12 8'],
  close: ['', 'M4 4l8 8M12 4l-8 8'],
  gear: ['', 'M2 4h6.5M11.5 4H14M11.5 4a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M2 8h1.5M6.5 8H14M6.5 8a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0'
    + 'M2 12h5.5M10.5 12H14M10.5 12a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0'],
  vid: ['', 'M1.5 4.5h9v7h-9zM10.5 7l4-2v6l-4-2'],
  scr: ['', 'M1 11l2.5-6 2.5 6 2.5-6 2.5 6 2.5-6'],
  more: ['M2.5 7h2v2h-2zM7 7h2v2H7zM11.5 7h2v2h-2z', ''],
};
// Open video (PR3): video, the audio a webview plays (no audio/* wildcard: it offers MIDI), and .funscript to pair by base name.
const VIDEO_ACCEPT = 'video/*,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/flac,audio/webm,'
  + '.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.weba,.funscript';

// ---- pure helpers -----------------------------------------------------------

export function compositionOf(width) {
  return width >= FULL_UP ? 'full' : width >= GLANCE_UP ? 'handheld' : 'glance';
}

/** The page's class (PR1-PR4): buckets 1 and 2 are the phone, landscape when wider than tall; 3 and up the desktop. */
export function pageClass(bucket, w, h) {
  return bucket >= 3 ? 'desktop' : w > h ? 'landscape' : 'portrait';
}

// The modifier rule (DESIGN 10.5), inlined as plugins do: a key takes the declared step (Shift included),
// Ctrl the adjacent multiple of the decade below the range's span; a drag's Shift is a tenth of its gain.
export const OFFSET_STEP = 5, OFFSET_MAX = 500;
const OFFSET_DECADE = 100;   // decade below the 1000 ms span
/** Offset after one key press: dir +1/-1, the 5 ms step, Ctrl the adjacent 100 ms multiple. */
export function offsetKey(v, dir, e = {}) {
  if (!e.ctrlKey) return clampOffset(v + dir * OFFSET_STEP);
  const q = v / OFFSET_DECADE;
  return clampOffset((dir > 0 ? Math.floor(q + 1e-9) + 1 : Math.ceil(q - 1e-9) - 1) * OFFSET_DECADE);
}
/** Offset after a label drag of dx px from v0: 5 ms per 4 px, a tenth with Shift, Ctrl rounds to 100 ms. */
export function offsetDrag(v0, dx, e = {}) {
  const raw = v0 + (dx / 4) * OFFSET_STEP * (e.shiftKey ? 0.1 : 1);
  return clampOffset(e.ctrlKey ? Math.round(raw / OFFSET_DECADE) * OFFSET_DECADE : raw);
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
  let autoMap = [0, 1], autoFor = null;
  const trace = [];
  scheduler.setTransform(state.T);

  const gate = () => (state.motion && fields && fields.dur ? api.gate(fields.dur) || '' : '');
  const active = () => state.phase === 'playing' || state.phase === 'preroll';
  /** Unrolled loop time back to media time. */
  const fold = (u) => (loop.spec && loop.lap ? u - loop.lap * (loop.spec.b - loop.spec.a) : u);
  /** Never past durMs(): the hover readout and the seek keys read it. */
  const mediaNow = () => Math.min(durMs(), state.phase === 'playing' && clock.ready ? fold(clock.mediaAt(now())) : video.currentTime * 1000);
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
    scheduler.setLatency({ auto: p.autoLatency });
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

  /** The scheduler, the timeline and the Kinetic preview run wire() (one knot per action); shaped is the same Script. */
  function reshape() {
    const s = state.script;
    if (s !== autoFor) { autoFor = s; autoMap = [0, 1]; }
    const next = s ? wire(s, interp.scaleAuto ? { ...interp, map: autoMap } : interp) : null;
    if (next === state.shaped) return;
    state.shaped = wired = next;
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
    if (script) attach(script, extra, my);
    changed();
  }

  /** A script for the loaded scene (Open script on a video, PR3): the media stays. */
  function attach(script, extra = [], my = ++seq) {
    if (active()) stop('ready');
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

  /** Close: the media and its script unloaded, the card back to its empty state. */
  function unload() {
    if (active()) stop('ready');
    homeAt = Infinity;
    if (url) revoke(url);
    url = null;
    seq++;
    Object.assign(state, { scene: null, script: null, shaped: null, phase: 'empty', ab: { a: null, b: null } });
    scheduler.load(null);
    wired = null;
    loop.set(null);
    scheduler.setLoop(null);
    peak = 0;
    why = '';
    info = [];
    if (video.removeAttribute) { video.removeAttribute('src'); video.removeAttribute('poster'); }
    if (video.load) video.load();
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
    if (ceil.vmax && ceil.spanMm && peak * (state.T.hi - state.T.lo) * ceil.spanMm * (video.playbackRate || 1) > ceil.vmax) return { text: COPY.overLimit, tone: 'warn' };
    if (info.length) return { text: info[0] + (info.length > 1 ? ' (+' + (info.length - 1) + ' ' + COPY.more + ')' : ''), tone: '' };
    return { text: !state.scene ? COPY.empty : state.scene.stream ? '' : COPY.motionOnly, tone: '' };
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
    state, trace, play, tick, onFrame, load, attach, unload, setMotion, setT, setView, seek, mediaNow, here, setPlay, markAB,
    get wire() { return wired; },
    /** The map in force, [lower, upper] (scale.js mapOf): Auto's fit or the operator's gain. */
    get scale() { return interp.scaleAuto ? autoMap : mapOf(interp); },
    /** Under Auto, the Script the analyzer measures (the wire at scale 1: the script itself); else null. */
    get fit() { return interp.scaleAuto ? state.script : null; },
    /** The analyzer's measure of fit: e the planner's [min, max] (analyzer.js wideExtent); null keeps the map. */
    fitKinetic(sc, e) {
      if (!interp.scaleAuto || !sc || sc !== state.script || e == null) return;
      const m = fitMap(e);
      if (m[0] !== autoMap[0] || m[1] !== autoMap[1]) { autoMap = m; reshape(); changed(); }
    },
    pause: () => { if (active()) stop('ready'); },
    toggle: () => (active() ? stop('ready') : play()),
    halt: () => { if (active()) stop('held'); },
    canPlay,
    setFields(f) { fields = f; reshape(); warm(); changed(); },
    setInterp(v) { interp = v; reshape(); changed(); },
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
.fsp { position: relative; height: 100%; min-height: 0; display: grid; gap: var(--sp-2); --fsp-detail: 96px; --fsp-src: 30px; --fsp-bar: 30px; --fsp-sp: var(--sp-2);
  --fsp-stage-min: 120px; --fsp-detail-min: 64px; --fsp-trh: var(--fsp-bar);
  min-height: calc(var(--fsp-src) + var(--fsp-sp) + var(--fsp-bar) + var(--fsp-trh) + var(--fsp-detail-min) + 20px + 6 * var(--sp-2) + var(--fsp-stage-min) + var(--fsp-pad, 0px));
  grid-template-columns: minmax(0, 1fr) 320px;
  grid-template-rows: var(--fsp-src) minmax(var(--fsp-stage-min), 1fr) var(--fsp-trh) var(--fsp-sp) var(--fsp-bar) minmax(var(--fsp-detail-min), var(--fsp-detail)) 20px;
  grid-template-areas: "src lib" "stage lib" "tr lib" "sp lib" "tlh lib" "tl lib" "st lib"; }
/* The desktop (the full card) draws the bar under the stage (review 2026-10-08); phones keep it at the bottom. */
.fsp[data-comp=full][data-cls=landscape]:not([data-an]) {
  grid-template-rows: var(--fsp-src) minmax(var(--fsp-stage-min), 1fr) var(--fsp-sp) var(--fsp-bar) minmax(var(--fsp-detail-min), var(--fsp-detail)) var(--fsp-trh) 20px;
  grid-template-areas: "src lib" "stage lib" "sp lib" "tlh lib" "tl lib" "tr lib" "st lib"; }
@media (pointer: coarse) { .fsp { --fsp-src: var(--tap); --fsp-bar: var(--tap); --fsp-sp: var(--tap); } }
/* PR5: one player bar; on phones and the handheld card its scrub row over its button row (data-rows2). */
.fsp[data-rows2] { --fsp-trh: calc(var(--fsp-bar) * 2 + var(--sp-2)); }
/* PR7: the timeline band collapses to its head (pref tlOpen); the stage row takes the room. */
.fsp[data-tlshut] { --fsp-detail: 0px; --fsp-detail-min: 0px; }
.fsp[data-tlshut] :is(.fsp-tlbox, .fsp-split) { display: none; }
.fsp[data-comp=full][data-libshut]:not([data-an]) { grid-template-columns: minmax(0, 1fr); grid-template-areas: "src" "stage" "tr" "sp" "tlh" "tl" "st"; }
.fsp[data-comp=full][data-cls=landscape][data-libshut]:not([data-an]) { grid-template-areas: "src" "stage" "sp" "tlh" "tl" "tr" "st"; }
.fsp[data-comp=full][data-libshut] .fsp-libbox { display: none; }
.fsp[data-comp=handheld] { grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--tap) minmax(var(--fsp-stage-min), 1fr) var(--fsp-sp) var(--fsp-bar) minmax(var(--fsp-detail-min), var(--fsp-detail)) var(--fsp-trh) 20px;
  min-height: calc(var(--tap) + var(--fsp-sp) + var(--fsp-bar) + var(--fsp-trh) + var(--fsp-detail-min) + 20px + 6 * var(--sp-2) + var(--fsp-stage-min) + var(--fsp-pad, 0px));
  grid-template-areas: "src" "stage" "sp" "tlh" "tl" "tr" "st"; }
.fsp[data-comp=glance] { min-height: 0; --fsp-bar: var(--tap); grid-template-columns: minmax(0, 1fr); grid-template-rows: 20px 24px var(--tap) 20px;
  grid-template-areas: "src" "meter" "tr" "st"; }
.fsp [hidden] { display: none !important; }
:where(.fsp button, .fsp input) { font: inherit; }
.fsp[data-comp=full]:not([data-libshut]) .fsp-libbox { box-sizing: border-box; padding-top: max(0px, calc(var(--stop-reserve-h, 0px) - var(--caret-h, 0px) + var(--sp-2))); }
.fsp:is([data-comp=handheld], [data-comp=glance], [data-libshut]) .fsp-src { padding-right: var(--stop-reserve, 0px); }
/* The page's shell cards (PR1): the Player card is a frame behind its column, its rows inset by the card padding;
   the library column is the Library card. Inside a dash card there is no frame: the dash card is the card. */
.fsp[data-page] { --fsp-pad: calc(2 * var(--sp-3)); column-gap: var(--gap); }
.fsp-pframe { grid-area: 1 / 1 / -1 / 2; }
.fsp[data-an] .fsp-pframe { grid-column: 1 / -1; }
.fsp[data-page] > :is(.fsp-src, .fsp-stage, .fsp-split, .fsp-tlh, .fsp-tr, .fsp-tlbox, .fsp-slot, .fsp-anbox) { margin-inline: var(--sp-4); }
.fsp[data-page] > .fsp-src { margin-top: var(--sp-3); }
.fsp[data-page] > .fsp-slot { margin-bottom: var(--sp-3); }
.fsp[data-page][data-comp=full]:not([data-libshut], [data-an]) .fsp-libbox { display: flex; flex-direction: column; gap: var(--sp-3);
  background: var(--bg-card); border: 1px solid var(--line-1); border-radius: var(--radius);
  padding: max(var(--sp-3), calc(var(--stop-reserve-h, 0px) - var(--caret-h, 0px) + var(--sp-2))) var(--sp-4) var(--sp-3); }
.fsp[data-page][data-comp=full] .fsp-lib { flex: 1 1 auto; min-height: 0; }
.fsp-libbox > .fsp-h { display: none; }
.fsp[data-page][data-comp=full] .fsp-libbox > .fsp-h { display: flex; }
.fsp-h { flex: none; display: flex; align-items: baseline; gap: var(--sp-3); margin: 0; font: 500 .8rem/30px var(--font); letter-spacing: .12em;
  text-transform: uppercase; color: var(--tx-val); white-space: nowrap; }
.fsp-ix { font: 400 .62rem var(--mono); letter-spacing: normal; color: var(--tx-faint); }
.fsp-ic svg { flex: none; width: 16px; height: 16px; fill: currentColor; }
.fsp-ic svg .s { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.fsp-ic:not(:has(span)) { width: 30px; padding: 0; }
@media (pointer: coarse) { .fsp-ic:not(:has(span)) { width: var(--tap); } }
.fsp-src > .og-btn { flex: none; }
.fsp-src > :is(.fsp-openv, .fsp-opens, .fsp-close), .fsp-media { display: none; }
.fsp[data-comp=full] .fsp-src > :is(.fsp-openv, .fsp-opens, .fsp-close), .fsp[data-comp=handheld] .fsp-media { display: inline-flex; }
.fsp-menu:popover-open { position: fixed; inset: auto; margin: 0; display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2);
  background: var(--bg-raised); border: 1px solid var(--line-2); border-radius: var(--r-s); color: var(--tx); }
.fsp-menu .og-btn { justify-content: flex-start; }
.fsp-src { grid-area: src; display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.fsp-libcaret { display: none; flex: none; place-items: center; width: 30px; height: var(--fsp-src); padding: 0; color: var(--tx-mut);
  background: none; border: 1px solid var(--line-2); border-radius: var(--r-s); cursor: pointer; }
@media (pointer: coarse) { .fsp-libcaret { width: var(--tap); } }
.fsp[data-comp=full]:not([data-an]) .fsp-libcaret { display: grid; }
.fsp-libcaret:hover { color: var(--tx-hi); }
.fsp-libcaret:focus-visible { outline: 2px solid var(--highlight); outline-offset: -2px; }
.fsp-libcaret svg { width: 14px; height: 14px; fill: none; }
.fsp-libcaret svg .s { stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.fsp-libcaret svg { transition: transform var(--t-move, 200ms) var(--ease-out, ease); }
.fsp[data-libshut] .fsp-libcaret svg { transform: rotate(180deg); }
.fsp-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); font-size: .85rem; }
.fsp[data-page] .fsp-title { margin-left: auto; text-align: right; }
.fsp-src > [role=tablist] { display: flex; flex: none; gap: var(--sp-2); }
.fsp-tab { display: none; }
/* The open tab wears --highlight (the advpen precedent, finding 1). */
.fsp-tab[aria-selected=true] { color: var(--highlight); border-color: var(--highlight); }
.fsp[data-comp=handheld] .fsp-tab { display: inline-flex; }
.fsp[data-comp=glance] .fsp-title { font-size: .75rem; line-height: 20px; }
.fsp-stage { grid-area: stage; position: relative; min-height: 0; overflow: hidden; }
.fsp-stage::before { content: ''; display: block; aspect-ratio: 16 / 9; max-height: 240px; }
.fsp-vbox { position: absolute; inset: 0; background: var(--screen); border-radius: var(--r-s); overflow: hidden; }
.fsp-vbox:has(> .fsp-empty:not([hidden])) { border: 1px dashed var(--line-3); }
.fsp-vbox video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
/* Phone portrait (PR2): the stage at the video's aspect, capped by its row; empty or motion only, a 120 px strip. */
/* The split bar is the desktop's (PR7). */
.fsp:is([data-cls=portrait], [data-cls=landscape]) { --fsp-sp: 0px; }
.fsp:is([data-cls=portrait], [data-cls=landscape]) .fsp-split { display: none; }
.fsp[data-cls=portrait]:not([data-an]) .fsp-stage::before { display: none; }
.fsp[data-cls=portrait]:not([data-an]) .fsp-vbox { bottom: auto; height: var(--fsp-stage-min); }
.fsp[data-cls=portrait][data-ar]:not([data-an], [data-mo]) .fsp-vbox { right: auto; width: 100%; height: auto; aspect-ratio: var(--fsp-ar); max-height: 100%; }
.fsp-empty { position: absolute; inset: 0; display: flex; flex-wrap: wrap; align-content: center; align-items: center; justify-content: center; gap: var(--sp-3); }
.fsp[data-an] .fsp-empty > * { display: none; }
.fsp-mo { position: absolute; inset: 0; display: grid; grid-template: "k b" auto "m m" 24px / minmax(0, 1fr) auto; align-content: center; align-items: center;
  gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); }
.fsp-mo-k { grid-area: k; font-size: .8rem; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--tx-val); }
.fsp-mo .fsp-meter { grid-area: m; display: block; height: 24px; box-shadow: inset 0 0 0 1px var(--line-2); }
.fsp[data-an] .fsp-mo > :not(.fsp-meter) { display: none; }
.fsp-tlbox { grid-area: tl; min-width: 0; }
.fsp-split { grid-area: sp; position: relative; cursor: ns-resize; touch-action: none; outline: none; }
.fsp-split::before { content: ''; position: absolute; inset: -4px 0; }
.fsp-split::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 4px; translate: 0 -2px; background: var(--line-2); }
@media (pointer: coarse) { .fsp-split::before { inset: 0; } }
.fsp-split::after { transition: background var(--t-quick, 120ms); }
.fsp-split:hover::after, .fsp-split[data-drag]::after, .fsp-split:focus-visible::after { background: var(--highlight); }
.fsp[data-an] .fsp-split, .fsp[data-comp=glance] .fsp-split { display: none; }
.fsp-libbox { grid-area: lib; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.fsp[data-comp=full] .fsp-lib { min-height: 400px; }
.fsp[data-comp=handheld] .fsp-libbox { grid-area: 2 / 1 / 7 / 2; }
.fsp[data-comp=handheld][data-view=library] :is(.fsp-stage, .fsp-split, .fsp-tlh, .fsp-tlbox, .fsp-tr) { visibility: hidden; }
.fsp[data-comp=handheld][data-view=player] .fsp-libbox { visibility: hidden; }
.fsp[data-comp=glance] .fsp-libbox, .fsp[data-comp=glance] .fsp-tlbox { display: none; }
.fsp[data-comp=glance] .fsp-stage { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.fsp-meter { grid-area: meter; position: relative; display: none; background: var(--screen); border-radius: var(--r-s); }
.fsp[data-comp=glance] .fsp-meter { display: block; }
.fsp-tick { position: absolute; top: 2px; bottom: 2px; width: 3px; translate: -1.5px 0; }
.fsp-tick.int { background: var(--intent); }
.fsp-tick.real { background: var(--reality); }
.fsp-tick.stale { opacity: .4; }
.fsp-slot { grid-area: st; height: 20px; line-height: 20px; font-size: .78rem; color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-left: 3px solid var(--line-3); padding-left: var(--sp-3); }
.fsp-slot[data-tone=warn] { border-left-color: var(--warn); }
.fsp-tr { grid-area: tr; display: flex; align-items: center; gap: var(--sp-2); min-width: 0; container-type: inline-size; }
@container (max-width: 22em) { .fsp-tr .fsp-vol { display: none; } }
.fsp-tr > * { flex: none; min-width: 0; }
.fsp-tr > .og-btn { min-height: var(--fsp-bar); }
.fsp-tr > .fsp-ov { flex: 1 1 60px; }
.fsp-tr .fsp-rate { min-width: 5ch; padding-inline: var(--sp-2); font: .75rem var(--mono); }
.fsp-el, .fsp-rem { font: .75rem var(--mono); color: var(--tx-val); white-space: nowrap; overflow: hidden; }
.fsp-vol { flex: 0 1 96px; min-width: 48px; height: var(--fsp-bar); margin: 0; cursor: pointer; }
.fsp-brk { display: none; }
.fsp[data-rows2] .fsp-tr { flex-wrap: wrap; align-content: space-between; row-gap: var(--sp-2); }
.fsp[data-rows2] .fsp-tr > :is(.fsp-el, .fsp-ov, .fsp-rem, .fsp-brk) { order: -1; }
.fsp[data-rows2] .fsp-brk { display: block; flex: 0 0 100%; height: 0; }
.fsp[data-rows2] .fsp-tr > .og-btn { flex: 1 1 auto; width: auto; min-width: 30px; }
@media (pointer: coarse) { .fsp[data-rows2] .fsp-tr > .og-btn { min-width: 40px; } }
.fsp-tr > .fsp-motion { min-width: max-content; }
/* Phones: volume is the hardware keys' (and Settings', ph-1qs5.5). */
.fsp:is([data-cls=portrait], [data-cls=landscape]) .fsp-vol { display: none; }
.fsp[data-comp=glance] .fsp-tr > :not(.fsp-play, .fsp-time) { display: none; }
.fsp[data-comp=glance] .fsp-time { flex: 1 1 auto; }
/* PR7: the timeline band's head: caret and TIMELINE, zoom and its span (the full card), A-B, Offset, Invert, Graph. */
.fsp-tlh { grid-area: tlh; display: flex; align-items: center; gap: var(--sp-2); min-width: 0; container-type: inline-size; }
/* A narrow head drops words before controls: the unit, then TIMELINE (the caret stays). */
@container (max-width: 20em) { .fsp-tlh .fsp-offu { display: none; } }
@container (max-width: 18.5em) { .fsp-tlcaret > span { display: none; } }
.fsp-tlh > * { flex: none; }
.fsp-tlh > .og-btn { min-height: var(--fsp-bar); }
.fsp-tlgap { flex: 1 1 0; }
.fsp-tlcaret { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--fsp-bar); padding: 0 var(--sp-2) 0 0; background: none; border: 0;
  color: var(--tx-val); font: 500 .8rem/1 var(--font); letter-spacing: .12em; text-transform: uppercase; cursor: pointer; }
.fsp-tlcaret svg { width: 14px; height: 14px; fill: none; transition: transform var(--t-move, 200ms) var(--ease-out, ease); }
.fsp-tlcaret svg .s { stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.fsp-tlcaret[aria-expanded=true] svg { transform: rotate(90deg); }
.fsp-tlcaret:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
.fsp:is([data-comp=handheld], [data-cls=portrait], [data-cls=landscape]) .fsp-tlh .fsp-zoom { display: none; }
.fsp[data-comp=glance] :is(.fsp-tlh, .fsp-tlbox) { display: none; }
.fsp[data-comp=glance] .fsp-speed { display: none; }
.fsp[data-comp=glance] .fsp-time { font-size: .7rem; }
.fsp-off { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--fsp-bar); }
.fsp-offu { color: var(--tx-mut); font-size: .76rem; }
.fsp-offk { cursor: ew-resize; touch-action: none; user-select: none; color: var(--tx-mut); font-size: .76rem; font-weight: 500; letter-spacing: .04em;
  text-transform: lowercase; min-height: var(--fsp-bar); display: grid; align-items: center; }
.fsp[data-rows2] :is(.fsp-offk, .fsp-zoom output) { display: none; }
.fsp-off input.og-num { width: 7ch; min-height: var(--fsp-bar); padding-block: 0; }
.fsp[data-comp=handheld] .fsp-off input.og-num { width: 6ch; }
.fsp-speed { position: absolute; left: calc(var(--tap) * 2 + 4px); bottom: 3px; z-index: 1; height: 18px; min-width: 10ch; font: .75rem var(--mono); display: grid; align-items: center;
  pointer-events: none; }
.fsp-speed i { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--intent); max-width: 100%; }
.fsp-speed[data-over] i { background: var(--warn); }
.fsp-speed span { color: var(--tx-mut); white-space: nowrap; overflow: hidden; }
.fsp-speed[data-over] span { color: var(--tx); }
.fsp-slot[data-tone=intent] { border-left-color: var(--intent); }
.fsp-anbox { grid-area: an; min-width: 0; min-height: 0; display: none; }
.fsp[data-an]:not([data-comp=glance]) .fsp-anbox { display: block; contain: size; }
.fsp[data-an]:not([data-comp=glance]) .fsp-libbox { display: none; }
.fsp[data-an]:not([data-comp=glance]) .fsp-tlbox { position: relative; min-height: 0; }
.fsp[data-an]:not([data-comp=glance]) .fsp-tlbox::before { content: ''; display: block; aspect-ratio: 16 / 9; max-height: 240px; margin-bottom: calc(var(--fsp-detail) + var(--sp-4)); }
.fsp[data-an]:not([data-comp=glance]) .fsp-tl { position: absolute; inset: 0; }
.fsp[data-an]:not([data-comp=glance]) .fsp-dt { height: auto; flex: 1 1 0; min-height: 0; }
.fsp[data-an][data-comp=full] { grid-template-columns: minmax(0, 1fr) clamp(320px, 40%, 560px);
  grid-template-rows: var(--fsp-src) var(--fsp-bar) calc(180px - var(--fsp-src) - var(--fsp-bar) - 2 * var(--sp-2)) minmax(0, 1fr) var(--fsp-trh) 20px;
  grid-template-areas: "src stage" "tlh stage" "tl stage" "tl an" "tr tr" "st st"; }
.fsp[data-an][data-comp=full] .fsa-row { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 9ch; }
.fsp[data-page][data-an][data-comp=full] { grid-template-columns: minmax(0, 1fr) calc(clamp(320px, 40%, 560px) + 2 * var(--sp-4)); }
.fsp[data-media] > .fsp-stage { margin: 0; }
.fsp[data-media] { min-height: 0 !important; }
.fsp[data-page][data-an][data-comp=full] > .fsp-stage { margin-top: var(--sp-3); }
.fsp[data-media] .fsp-vbox { border: 0; border-radius: 0; }
.fsp[data-an][data-comp=handheld] { --fsp-an: 55%; grid-template-rows: var(--tap) var(--fsp-bar) minmax(0, 1fr) var(--fsp-trh) 20px;
  grid-template-areas: "src" "tlh" "tl" "tr" "st"; }
.fsp[data-an][data-comp=handheld] .fsp-tlbox::before { margin-bottom: calc(var(--fsp-detail) + var(--sp-4)); }
.fsp[data-an][data-comp=handheld] .fsp-tl { bottom: calc(var(--fsp-an) + 4px); }
.fsp[data-an][data-comp=handheld] .fsp-anbox { grid-area: tl; align-self: end; height: var(--fsp-an); }
.fsp[data-an][data-comp=handheld] .fsp-stage { grid-area: src; justify-self: end; width: calc(var(--tap) * 16 / 9); height: var(--tap); }
.fsp[data-an][data-comp=handheld] .fsp-stage::before { display: none; }
.fsp[data-an][data-comp=handheld] .fsp-tab { display: none; }
.fsp[data-an][data-comp=handheld] :is(.fsp-stage, .fsp-tlh, .fsp-tlbox, .fsp-tr) { visibility: visible; }
.fsp[data-an] .fsp-empty { font-size: .7rem; }
.fsp-hov { position: absolute; inset: 0; z-index: 1; pointer-events: none; container-type: size; }
.fsp-hb { position: absolute; left: 0; right: 0; bottom: 0; display: grid; grid-template-rows: 16px auto; padding: var(--sp-5) var(--sp-2) 0;
  background: linear-gradient(to top, color-mix(in srgb, var(--bg-raised) 92%, transparent), color-mix(in srgb, var(--bg-raised) 55%, transparent) 60%, transparent);
  opacity: 0; transition: opacity var(--t-move, 200ms) var(--ease-out, ease); pointer-events: none; }
.fsp-hov[data-show] > .fsp-hb, .fsp-hb:has(:focus-visible) { opacity: 1; pointer-events: auto; }
@media (pointer: coarse) { .fsp-hb { grid-template-rows: var(--tap) auto; padding-top: var(--sp-3); } }
/* A narrow fullscreen (a phone upright) puts the time on its own line above the buttons. */
@container (max-width: 34em) { .fsp-hb-row { flex-wrap: wrap; } .fsp-hb-time { order: -1; flex: 0 0 100%; } .fsp-hb-row > .fsp-hb-gap { display: none; } }
.fsp-hb-seek { position: relative; display: grid; align-items: center; margin: 0 var(--sp-2); cursor: pointer; touch-action: none; outline: none; }
.fsp-hb-seek:focus-visible .fsp-hb-track { outline: 2px solid var(--highlight); outline-offset: 3px; }
.fsp-hb-track { position: relative; height: 3px; border-radius: 1.5px; background: color-mix(in srgb, var(--tx) 22%, transparent); transition: height var(--t-quick, 120ms) var(--ease-out, ease); }
.fsp-hb-seek:is(:hover, [data-drag]) .fsp-hb-track { height: 5px; }
.fsp-hb-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; }
.fsp-hb-buf { background: color-mix(in srgb, var(--tx) 40%, transparent); }
.fsp-hb-played { background: var(--highlight); }
.fsp-hb-played::after { content: ''; position: absolute; right: -6px; top: 50%; width: 12px; height: 12px; translate: 0 -6px; border-radius: 50%;
  background: var(--highlight); transform: scale(0); transition: transform var(--t-quick, 120ms) var(--ease-out, ease); }
.fsp-hb-seek:is(:hover, [data-drag], :focus-visible) .fsp-hb-played::after { transform: none; }
.fsp-hb-tip { position: absolute; bottom: calc(50% + 10px); transform: translateX(-50%); padding: var(--sp-1) var(--sp-2); font: .75rem var(--mono); color: var(--tx);
  background: var(--bg-raised); border: 1px solid var(--line); border-radius: var(--r-s); white-space: nowrap; pointer-events: none; }
.fsp:not([data-media]) .fsp-hov { display: none; }
.fsp[data-fswave] .fsp-hb { grid-template-rows: 72px 16px auto; --fsp-detail: 72px; }
@media (pointer: coarse) { .fsp[data-fswave] .fsp-hb { grid-template-rows: 72px var(--tap) auto; } }
.fsp-hb > .fsp-tl { margin: 0 var(--sp-2) var(--sp-2); }
.fsp-hb-row > .og-btn { flex: none; min-height: var(--tap); }
.fsp-hb-row { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.fsp-hb-time { flex: 0 1 auto; min-width: 0; padding: 0 var(--sp-2) 0 var(--sp-3); font: .78rem var(--mono); color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fsp-hb-gap { flex: 1 1 0; }
.fsp[data-media][data-comp] { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: minmax(0, 1fr) !important; grid-template-areas: "stage" !important; }
.fsp[data-media] > :not(.fsp-stage, style) { display: none !important; }
.fsp-cplay { position: absolute; left: 50%; top: 50%; width: 72px; height: 72px; translate: -50% -50%; display: none; place-items: center;
  border-radius: 50%; background: rgba(var(--shade-rgb), .55); color: var(--tx-hi); pointer-events: none; z-index: 1; }
.fsp-cplay svg { width: 32px; height: 32px; fill: currentColor; }
.fsp-cplay svg .s { fill: none; stroke: currentColor; stroke-width: 1.5; }
.fsp[data-paused]:not([data-an], [data-comp=glance]) .fsp-cplay, .fsp:not([data-comp=glance]) .fsp-cplay[data-flash] { display: grid; }
@keyframes fsp-flash { from { opacity: 1; scale: 1; } to { opacity: 0; scale: 1.3; } }
.fsp-cplay[data-flash] { animation: fsp-flash 500ms var(--ease-out, ease) forwards; }
html.still .fsp-cplay[data-flash] { animation-duration: 1ms; }
/* PR13: the fullscreen library drawer, under the stop pair; the phone tab's now-playing row. */
.fsp[data-media][data-libdrawer] > .fsp-libbox { display: flex !important; flex-direction: column; gap: var(--sp-3); position: fixed; top: var(--stop-reserve-h, 0px);
  right: 0; bottom: 0; width: min(400px, 60vw); z-index: 20; padding: var(--sp-3) var(--sp-4); visibility: visible; box-sizing: border-box;
  background: var(--bg-card); border: 1px solid var(--line-1); border-radius: var(--radius); }
.fsp[data-media][data-libdrawer] .fsp-libbox > .fsp-h { display: flex; }
.fsp-libb { display: none; }
.fsp[data-media] .fsp-libb { display: inline-flex; }
.fsp-now { display: none; flex: none; align-items: center; gap: var(--sp-3); min-height: var(--tap); padding-top: var(--sp-2); border-top: 1px solid var(--line-1); }
.fsp[data-comp=handheld][data-view=library]:not([data-media]) .fsp-now { display: flex; }
.fsp-nowt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; }
.fsp-nowm { flex: none; font: .76rem var(--mono); color: var(--tx-val); }
.fsp[data-comp=handheld] .fsp-libbox { display: flex; flex-direction: column; }
.fsp[data-comp=handheld] .fsp-lib { flex: 1 1 auto; min-height: 0; }
.fsp[data-media][data-comp] .fsp-stage { grid-area: stage; position: relative; width: auto; height: auto; clip-path: none; justify-self: stretch;
  visibility: visible; border-radius: 0; }
.fsp[data-media] .fsp-stage::before { display: none; }
@keyframes fsp-enter { from { opacity: 0; } }
.fsp[data-media] .fsp-stage { animation: fsp-enter var(--t-move, 200ms) var(--ease-out, ease); }
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
/** The click that follows a pointerdown which closed a sheet or drawer: swallowed, so the tap outside never reaches
 *  the stage (a stage click toggles Play, which moves the machine). The guard lapses after DOUBLE_MS without one. */
export function swallowClick() {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', eat, { capture: true }), DOUBLE_MS);
}
// A meter tick's left at share u, its 3 px inside the meter at either end.
const tickAt = (u) => 'calc(1.5px + (100% - 3px) * ' + u + ')';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The controller's media: the video element while a scene has a stream, else a silent clock over
 * durationMs() (motion only, PR4) with the element's events, play/pause/seek and rate semantics.
 * Silent mode has no frames: the caller feeds frames and calls poll() once per animation frame.
 */
function createMedia(el, durationMs, now = () => performance.now()) {
  const et = new EventTarget();
  const fire = (t) => et.dispatchEvent(new Event(t));
  let silent = false, base = 0, t0 = 0, run = false, ended = false, rate = 1;
  for (const t of ['play', 'pause', 'ended', 'waiting', 'playing', 'seeking', 'durationchange', 'ratechange', 'error', 'loadedmetadata', 'resize']) {
    el.addEventListener(t, () => { if (!silent) fire(t); });
  }
  const at = () => (run ? Math.min(durationMs(), base + (now() - t0) * rate) : base);
  const m = {
    el,
    get silent() { return silent; },
    addEventListener: (t, fn) => et.addEventListener(t, fn),
    set src(v) {
      if (v) { silent = false; el.src = v; return; }
      if (run) { base = at(); run = false; }
      silent = true; base = 0; ended = false;
      el.removeAttribute('src'); el.removeAttribute('poster'); el.load();
      fire('durationchange');
    },
    get src() { return silent ? '' : el.src; },
    set poster(v) { el.poster = v; },
    removeAttribute(k) { if (k === 'src') silent = false; el.removeAttribute(k); },
    load() { el.load(); },
    play() {
      if (!silent) return el.play();
      if (ended || at() >= durationMs()) base = 0;
      ended = false; run = true; t0 = now();
      fire('play'); fire('playing');
      return Promise.resolve();
    },
    pause() {
      if (!silent) return el.pause();
      if (run) { base = at(); run = false; fire('pause'); }
    },
    /** Silent mode: the end of the script ends playback as a video's end does. */
    poll() {
      if (silent && run && at() >= durationMs()) { base = durationMs(); run = false; ended = true; fire('pause'); fire('ended'); }
    },
    get paused() { return silent ? !run : el.paused; },
    get ended() { return silent ? ended : el.ended; },
    get seeking() { return silent ? false : el.seeking; },
    get currentTime() { return silent ? at() / 1000 : el.currentTime; },
    set currentTime(s) {
      if (!silent) { el.currentTime = s; return; }
      base = Math.max(0, Math.min(durationMs(), s * 1000)); t0 = now(); ended = false;
      fire('seeking');
    },
    get duration() { return silent ? durationMs() / 1000 : el.duration; },
    get playbackRate() { return silent ? rate : el.playbackRate; },
    set playbackRate(v) {
      el.playbackRate = v;
      if (silent) { base = at(); t0 = now(); rate = v; fire('ratechange'); }
    },
    set defaultPlaybackRate(v) { el.defaultPlaybackRate = v; },
    get buffered() { return silent ? null : el.buffered; },
    get volume() { return el.volume; },
    set volume(v) { el.volume = v; },
    get muted() { return el.muted; },
    set muted(v) { el.muted = v; },
  };
  return m;
}

export function createPlayer(api) {
  let probeRing = null;
  try { if (localStorage.getItem(PROBE_KEY) === '1') probeRing = window.__funscriptProbe = []; } catch (e) { /* private mode */ }
  const probe = (x) => {
    if (!probeRing) return;
    probeRing.push(x);
    if (probeRing.length > PROBE_RING) probeRing.splice(0, probeRing.length - PROBE_RING);
  };

  const vel = document.createElement('video');
  vel.controls = false;
  vel.playsInline = true;
  vel.disablePictureInPicture = true;
  vel.disableRemotePlayback = true;
  vel.preload = 'auto';
  for (const a of ['playsinline', 'disablepictureinpicture', 'disableremoteplayback']) vel.setAttribute(a, '');
  const video = createMedia(vel, () => (ctl.state.script ? ctl.state.script.durationMs : NaN));
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
  const stopFrames = frameSource(vel, ctl.onFrame);

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
  const parse = (f) => f.text().then((t) => parseFunscript(t, f.name));
  function openLocal(files) {
    const scene = localScene([...files]);
    if (!scene) return;
    const sc = scene.script;
    ctl.load(scene, sc ? parse(sc) : null, COPY.noScriptVideo, scene.extra);
  }
  /** Open video (PR3): a video alone attaches to a loaded script without one; a .funscript picked with it pairs by base name. */
  function openVideo(files) {
    const { video: v, script } = pairFiles([...files]);
    const st = ctl.state;
    if (st.view !== 'player') ctl.setView('player');
    if (!v) { if (script) openScript(script); return; }
    if (!script && st.script && st.scene && !st.scene.stream) ctl.load(localScene([v]), st.script, COPY.noScriptVideo);
    else openLocal(files);
  }
  /** Open script (PR3): attaches to a loaded video, else plays motion only (PR4). */
  function openScript(f) {
    const st = ctl.state;
    if (st.view !== 'player') ctl.setView('player');
    if (st.scene && st.scene.stream) ctl.attach(parse(f));
    else ctl.load({ key: 'script:' + f.name + ':' + f.size, title: f.name.replace(/\.funscript$/i, ''), stream: null }, parse(f), '');
  }

  let raf = 0;
  const loop = () => {
    if (video.silent) { video.poll(); if (!video.paused) ctl.onFrame(video.currentTime * 1000, performance.now()); }
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
    let comp = '', prevCls = '';
    const picker = (accept, multiple, fn) => {
      const f = h('input', { type: 'file', accept, hidden: '', ...(multiple ? { multiple: '' } : {}) });
      f.addEventListener('change', () => { if (f.files && f.files.length) fn(f.files); f.value = ''; });
      return f;
    };
    const fileV = picker(VIDEO_ACCEPT, true, openVideo), fileS = picker('.funscript', false, (fl) => openScript(fl[0]));
    fileV.className = 'fsp-filev';
    fileS.className = 'fsp-files';
    const btn = (cls, text, attrs = {}) => h('button', { type: 'button', class: 'og-btn sm ' + cls, text, ...attrs });
    const tabP = btn('fsp-tab', COPY.player, { role: 'tab' });
    const tabL = btn('fsp-tab', COPY.library, { role: 'tab' });
    tabP.addEventListener('click', () => ctl.setView('player'));
    tabL.addEventListener('click', () => ctl.setView('library'));
    const title = h('span', { class: 'fsp-title' });
    const icon = () => {
      const s = document.createElementNS(SVG_NS, 'svg');
      s.setAttribute('viewBox', '0 0 16 16');
      s.setAttribute('aria-hidden', 'true');
      const k = document.createElementNS(SVG_NS, 'path');
      k.setAttribute('class', 's');
      s.append(document.createElementNS(SVG_NS, 'path'), k);
      return s;
    };
    // Open video, Open script and Close (PR3): shell buttons, an icon and a word; the Media menu holds them on phones.
    const ogBtn = (cls, ic, text, tip = text, attrs = {}) => {
      const b = h('button', { type: 'button', class: 'og-btn sm fsp-ic ' + cls, title: tip, 'aria-label': tip, ...attrs });
      b.append(icon());
      b.firstChild.children[0].setAttribute('d', ic[0]);
      b.firstChild.children[1].setAttribute('d', ic[1]);
      if (text) b.append(h('span', { text }));
      return b;
    };
    const openV = (cls, attrs) => { const b = ogBtn(cls, ICON.vid, COPY.openVideo, COPY.openVideo, attrs); b.addEventListener('click', () => fileV.click()); return b; };
    const openS = (cls, attrs) => { const b = ogBtn(cls, ICON.scr, COPY.openScript, COPY.openScript, attrs); b.addEventListener('click', () => fileS.click()); return b; };
    const closeH = ogBtn('fsp-close', ICON.close, '', COPY.close);
    const doClose = () => { ctl.unload(); ctl.setView('library'); };
    closeH.addEventListener('click', doClose);
    // The phones' Media menu: a popover (light dismiss: a tap outside or Escape closes it), closed by a pick.
    const menu = h('div', { class: 'fsp-menu', popover: 'auto', role: 'menu', 'aria-label': COPY.media });
    const mClose = ogBtn('fsp-mclose', ICON.close, COPY.close);
    mClose.addEventListener('click', doClose);
    menu.append(openV('fsp-mopenv', { role: 'menuitem' }), openS('fsp-mopens', { role: 'menuitem' }), mClose);
    menu.addEventListener('click', (e) => { if (e.target.closest('button') && menu.hidePopover) menu.hidePopover(); });
    const mediaB = ogBtn('fsp-media', ICON.more, '', COPY.media, { 'aria-haspopup': 'menu' });
    mediaB.addEventListener('click', () => {
      if (!menu.showPopover) return;
      if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
      menu.showPopover();
      const r = mediaB.getBoundingClientRect();
      menu.style.top = r.bottom + 4 + 'px';
      menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
    });
    const head = opts.page ? h('h3', { class: 'fsp-h' }, h('span', { class: 'fsp-ix', text: '01' }), h('span', { text: COPY.player })) : '';
    // PR13: the phone's Library tab ends in a now-playing row: Play or Pause, the title, the position.
    const nowB = h('button', { type: 'button', class: 'og-btn sm fsp-ic fsp-nowb' });
    nowB.append(icon());
    nowB.addEventListener('click', () => ctl.toggle());
    const nowT = h('span', { class: 'fsp-nowt' }), nowM = h('output', { class: 'fsp-nowm' });
    const now = h('div', { class: 'fsp-now' }, nowB, nowT, nowM);
    const src = h('div', { class: 'fsp-src' }, head, title, openV('fsp-openv', { 'data-search-key': 'openVideo' }),
      openS('fsp-opens', { 'data-search-key': 'openScript' }), closeH, mediaB, menu, h('span', { role: 'tablist' }, tabP, tabL), fileV, fileS);

    const empty = h('div', { class: 'fsp-empty' }, openV('fsp-eopenv'), openS('fsp-eopens'));
    const tickI = h('i', { class: 'fsp-tick int' });
    const tickR = h('i', { class: 'fsp-tick real' });
    const meter = h('div', { class: 'fsp-meter', role: 'img', 'aria-label': COPY.meter }, tickI, tickR);
    // Motion only (PR4): the stroke meter in glance's look, and the way to attach a video.
    const moI = h('i', { class: 'fsp-tick int' }), moR = h('i', { class: 'fsp-tick real' });
    const mo = h('div', { class: 'fsp-mo' }, h('span', { class: 'fsp-mo-k', text: COPY.motionOnly }), openV('fsp-moopenv'),
      h('div', { class: 'fsp-meter', role: 'img', 'aria-label': COPY.meter }, moI, moR));
    // The center Play (operator 2026-10-08, PR9): a large glyph over the paused stage (video or motion only, never the
    // empty stage) and a brief glyph flash when a tap on the stage toggles. Decorative: the stage's own click acts.
    const cplay = h('div', { class: 'fsp-cplay', 'aria-hidden': 'true' });
    cplay.append(icon());
    const flash = () => {
      setIcon(cplay, ctl.state.phase === 'playing' || ctl.state.phase === 'preroll' ? ICON.play : ICON.pause, '');
      cplay.removeAttribute('data-flash');
      void cplay.offsetWidth;
      cplay.setAttribute('data-flash', '');
    };
    cplay.addEventListener('animationend', () => cplay.removeAttribute('data-flash'));
    const vbox = h('div', { class: 'fsp-vbox' }, empty, mo, cplay);
    const stage = h('div', { class: 'fsp-stage' }, vbox);
    const tlbox = h('div', { class: 'fsp-tlbox' });
    const lib = h('div', { class: 'fsp-libbox' });
    const anbox = h('div', { class: 'fsp-anbox' });
    const status = h('div', { class: 'fsp-slot', 'aria-live': 'polite' });
    const pframe = opts.page ? h('div', { class: 'fsp-pframe surface-card', 'aria-hidden': 'true' }) : '';

    const setIcon = (b, [f, k], tip) => {
      const [pf, pk] = b.firstChild.children;
      if (pf.getAttribute('d') !== f || pk.getAttribute('d') !== k) { pf.setAttribute('d', f); pk.setAttribute('d', k); }
      if (b.title !== tip) { b.title = tip; b.setAttribute('aria-label', tip); }
    };
    const attr = (e, k, v) => { if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
    const trBtn = (cls, ic, tip) => { const b = h('button', { type: 'button', class: 'og-btn sm fsp-ic ' + cls }); b.append(icon()); setIcon(b, ic, tip); return b; };
    const prevB = trBtn('fsp-prev', ICON.prev, COPY.prev), nextB = trBtn('fsp-next', ICON.next, COPY.next);
    const play = trBtn('fsp-play', ICON.play, COPY.playKey);
    play.addEventListener('click', () => ctl.toggle());
    const marks = () => (st.script ? marksOf(st.script) : []);
    prevB.addEventListener('click', () => {
      const m = marks(), t = ctl.mediaNow();
      if (!m.length) { if (library) library.step(-1); return; }
      const before = m.filter((x) => x < t - 1500);
      ctl.seek(before.length ? before[before.length - 1] : 0);
    });
    nextB.addEventListener('click', () => {
      const m = marks(), t = ctl.mediaNow();
      if (!m.length) { if (library) library.step(1); return; }
      const after = m.find((x) => x > t + 250);
      if (after != null) ctl.seek(after);
    });
    const time = h('output', { class: 'fsp-el fsp-time' }), rem = h('output', { class: 'fsp-rem' });
    const vol = h('input', { class: 'fsp-vol', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': COPY.volume, title: COPY.volume });
    vol.addEventListener('input', () => { video.volume = clamp(+vol.value, 0, 1); if (video.volume > 0) video.muted = false; });
    vol.addEventListener('change', () => saveAudio());
    const rate = h('button', { type: 'button', class: 'og-btn sm fsp-rate', title: COPY.rate, 'aria-label': COPY.rate });
    rate.addEventListener('click', () => { video.defaultPlaybackRate = video.playbackRate = RATES[(RATES.indexOf(video.playbackRate) + 1) % RATES.length]; render(); });
    const graph = trBtn('fsp-expand', ICON.graph, COPY.graph);
    graph.setAttribute('data-search-key', 'graph');
    graph.setAttribute('aria-pressed', 'false');
    graph.addEventListener('click', () => expand(!root.hasAttribute('data-an')));
    let split = readPrefs(api).split;
    // The stage's 120 px and the wave card's 64 px floors are grid track minimums (CSS); the pref is the card's wanted height.
    const applySplit = () => { if (split > 0) root.style.setProperty('--fsp-detail', split + 'px'); else root.style.removeProperty('--fsp-detail'); };
    const sp = h('div', { class: 'fsp-split', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', 'data-search-key': 'split', 'aria-label': COPY.split,
      'aria-valuemin': String(SPLIT_MIN), 'aria-valuemax': '480' });
    const detailH = () => Math.round(dtEl().getBoundingClientRect().height);
    const dtEl = () => tlbox.querySelector('.fsp-dt');
    const setSplit = (px, save) => {
      split = clamp(Math.round(px), SPLIT_MIN, 480);
      applySplit();
      sp.setAttribute('aria-valuenow', String(split));
      if (save) writePref(api, 'split', split);
    };
    let spDrag = null;
    sp.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.setAttribute('data-drag', '');
      const h0 = detailH();
      spDrag = { id: e.pointerId, y: e.clientY, h: h0, max: Math.max(h0, h0 + stage.getBoundingClientRect().height - MIN_STAGE) };
    });
    sp.addEventListener('pointermove', (e) => {
      if (spDrag && e.pointerId === spDrag.id) setSplit(clamp(spDrag.h - (e.clientY - spDrag.y), SPLIT_MIN, spDrag.max), false);
    });
    const spUp = (e) => {
      if (!spDrag || e.pointerId !== spDrag.id) return;
      spDrag = null;
      sp.removeAttribute('data-drag');
      writePref(api, 'split', split);
    };
    sp.addEventListener('pointerup', spUp);
    sp.addEventListener('pointercancel', spUp);
    sp.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = detailH();
      setSplit(clamp(cur + d * (e.shiftKey ? 1 : 8), SPLIT_MIN, Math.max(cur, cur + stage.getBoundingClientRect().height - MIN_STAGE)), true);
    });
    sp.addEventListener('dblclick', () => { split = 0; applySplit(); sp.removeAttribute('aria-valuenow'); writePref(api, 'split', 0); });
    sp.addEventListener('focus', () => sp.setAttribute('aria-valuenow', String(split || detailH())));

    // PR6: Motion beside Play, the switch that lets Play move the machine, in the shell's on look.
    const motion = h('button', { type: 'button', class: 'og-btn sm fsp-motion', text: COPY.motion, 'data-search-key': 'motion' });
    motion.addEventListener('click', () => ctl.setMotion(!st.motion));
    const offIn = h('input', { class: 'og-num', type: 'number', min: '-500', max: '500', step: '5', 'aria-label': COPY.offset, title: COPY.offsetTip });
    const offK = h('span', { class: 'fsp-offk', text: COPY.offset, title: COPY.offsetTip });
    const off = h('label', { class: 'fsp-off', 'data-search-key': 'offset' }, offK, offIn, h('span', { class: 'fsp-offu', text: COPY.offsetUnit }));
    const commitOff = (v) => { if (clampOffset(v) !== st.T.offsetMs) ctl.setT({ offsetMs: clampOffset(v) }); offIn.value = String(st.T.offsetMs); };
    offIn.addEventListener('change', () => commitOff(offIn.value));
    offIn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      offIn.value = String(offsetKey(+offIn.value || 0, e.key === 'ArrowUp' ? 1 : -1, e));
    });
    offIn.addEventListener('keyup', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') commitOff(offIn.value); });
    let offDrag = null;
    offK.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      offK.setPointerCapture(e.pointerId);
      offDrag = { id: e.pointerId, x: e.clientX, v: st.T.offsetMs };
    });
    offK.addEventListener('pointermove', (e) => {
      if (offDrag && e.pointerId === offDrag.id) offIn.value = String(offsetDrag(offDrag.v, e.clientX - offDrag.x, e));
    });
    const offUp = (e) => { if (offDrag && e.pointerId === offDrag.id) { offDrag = null; commitOff(offIn.value); } };
    offK.addEventListener('pointerup', offUp);
    offK.addEventListener('pointercancel', offUp);
    const inv = h('button', { type: 'button', class: 'og-btn sm fsp-inv', text: COPY.invert, 'data-search-key': 'invert' });
    inv.addEventListener('click', () => ctl.setT({ invert: !st.T.invert }));
    const speedBar = h('i');
    const speedTxt = h('span');
    const speed = h('div', { class: 'fsp-speed', title: COPY.speed }, speedBar, speedTxt);
    const saveAudio = () => writePref(api, 'audio', { vol: video.volume, muted: video.muted });
    const setMuted = (m) => { video.muted = m; saveAudio(); render(); };
    // The bar's Fullscreen and Settings are the page's (the dash card's hero has neither).
    const fullB = trBtn('fsp-full', ICON.full, COPY.full);
    fullB.hidden = !opts.fullscreen;
    fullB.addEventListener('click', () => fullscreen());
    const setB = trBtn('fsp-set', ICON.gear, COPY.settings);
    setB.hidden = !opts.settings;
    // Pressed from the page's own state (opts.settings.open), which the sheet's close and outside tap also change.
    setB.addEventListener('click', () => { opts.settings.toggle(!opts.settings.open); render(); });
    // Host seam (PR11, wired by ph-1qs5.8): the quick rail icon shows only where the host offers one.
    const railB = trBtn('fsp-rail', ['', ''], COPY.rail);
    railB.setAttribute('data-quick-rail-toggle', '');
    railB.setAttribute('aria-expanded', 'false');
    const onRail = (e) => { railB.setAttribute('aria-expanded', String(!!(e.detail && e.detail.open))); render(); };
    window.addEventListener('phosphor-quick-rail-change', onRail);
    railB.addEventListener('click', () => railB.dispatchEvent(new CustomEvent('phosphor-quick-rail', { bubbles: true, cancelable: true, detail: { open: 'toggle' } })));
    const railPath = () => (api.icons && api.icons.quickRail && document.documentElement.dataset.quickRail ? api.icons.quickRail : '');
    const brk = h('span', { class: 'fsp-brk' });
    const tr = h('div', { class: 'fsp-tr' }, prevB, play, nextB, time, rem, brk, vol, motion, rate, fullB, railB, setB);
    const tlCaret = h('button', { type: 'button', class: 'fsp-tlcaret', 'aria-expanded': 'true' });
    tlCaret.append(icon(), h('span', { text: COPY.timeline }));
    tlCaret.firstChild.children[1].setAttribute('d', ICON.caret[1]);
    const setTl = (on) => { root.toggleAttribute('data-tlshut', !on); tlCaret.setAttribute('aria-expanded', String(on)); };
    tlCaret.addEventListener('click', () => { const on = root.hasAttribute('data-tlshut'); setTl(on); writePref(api, 'tlOpen', on); });
    const tlh = h('div', { class: 'fsp-tlh' }, tlCaret, h('span', { class: 'fsp-tlgap' }), off, inv, graph);

    const root = h('div', { class: 'fsp', tabindex: '-1' }, h('style', { text: CSS + TL_CSS + AN_CSS }),
      pframe, src, stage, sp, tlh, tlbox, lib, anbox, meter, status, tr);
    setTl(readPrefs(api).tlOpen);
    root.toggleAttribute('data-page', !!opts.page);
    // The video's aspect for the phone stage (PR2); unknown (no picture yet, audio) keeps the strip.
    const onMeta = () => {
      const ok = !!(st.scene && st.scene.stream && vel.videoWidth && vel.videoHeight);
      root.toggleAttribute('data-ar', ok);
      if (ok) root.style.setProperty('--fsp-ar', vel.videoWidth + ' / ' + vel.videoHeight);
    };
    const META = ['loadedmetadata', 'resize', 'emptied'];
    for (const t of META) vel.addEventListener(t, onMeta);
    applySplit();
    // ---- the hover bar over the video ----
    // PR9: the timeline toggle shows a 72 px wave over the video, above the scrub (fullscreen only).
    const tlTog = trBtn('fsp-tltog', ICON.scr, COPY.timeline);
    tlTog.setAttribute('aria-pressed', 'false');
    const libCaret = h('button', { type: 'button', class: 'fsp-libcaret', title: COPY.library, 'aria-label': COPY.library });
    libCaret.append(icon());
    libCaret.firstChild.children[1].setAttribute('d', ICON.caret[1]);
    let libTouched = false, libAuto = false;
    libCaret.addEventListener('click', () => { const on = root.hasAttribute('data-libshut'); libTouched = true; libAuto = false; setLib(on); writePref(api, 'libOpen', on); });
    const setLib = (on) => { root.toggleAttribute('data-libshut', !on); libCaret.setAttribute('aria-expanded', String(on)); if (comp) recompose(); };
    setLib(readPrefs(api).libOpen);
    src.append(libCaret);
    const hbTime = h('span', { class: 'fsp-hb-time' });
    const hbBuf = h('i', { class: 'fsp-hb-buf' }), hbPlayed = h('i', { class: 'fsp-hb-played' });
    const hbTip = h('span', { class: 'fsp-hb-tip', hidden: '' });
    const seek = h('div', { class: 'fsp-hb-seek', role: 'slider', tabindex: '0', 'aria-label': COPY.seek, 'aria-valuemin': '0' },
      h('div', { class: 'fsp-hb-track' }, hbBuf, hbPlayed), hbTip);
    // PR9: the hover bar exists in fullscreen only; its row is the player bar's own buttons, moved in on entry and
    // back on exit (one set of controls, one set of listeners): prev, Play, next, time, Motion, rate, the timeline
    // toggle, the quick rail, Settings, Exit fullscreen.
    // PR13: in fullscreen the library is a drawer from the right under the stop pair, closed by a pick or a tap outside.
    const libB = trBtn('fsp-libb', ICON.lib, COPY.library);
    libB.setAttribute('aria-pressed', 'false');
    const setDrawer = (on) => { root.toggleAttribute('data-libdrawer', on); libB.setAttribute('aria-pressed', String(on)); libB.classList.toggle('on', on); };
    libB.addEventListener('click', () => setDrawer(!root.hasAttribute('data-libdrawer')));
    const drawerOut = (e) => { if (root.hasAttribute('data-libdrawer') && !lib.contains(e.target) && !libB.contains(e.target)) { setDrawer(false); swallowClick(); } };
    document.addEventListener('pointerdown', drawerOut, true);
    const hbRow = h('div', { class: 'fsp-hb-row' }, libB, hbTime, h('span', { class: 'fsp-hb-gap' }), tlTog);
    const hb = h('div', { class: 'fsp-hb' }, seek, hbRow);
    const hov = h('div', { class: 'fsp-hov' }, hb);
    vbox.append(hov);
    const trKids = () => [prevB, play, nextB, time, tr.querySelector('.fsp-ov'), rem, brk, vol, motion, rate, fullB, railB, setB].filter(Boolean);
    const toBar = (on) => {
      if (on) {
        hbTime.before(prevB, play, nextB);
        tlTog.before(motion, rate);
        tlTog.after(railB, setB, fullB);
      } else tr.append(...trKids());
    };
    const fsWave = (on) => {
      const w = tlbox.querySelector('.fsp-tl') || hb.querySelector('.fsp-tl');
      if (on) hb.prepend(w); else tlbox.append(w);
      root.toggleAttribute('data-fswave', on);
      tlTog.setAttribute('aria-pressed', String(on));
      tlTog.classList.toggle('on', on);
    };
    tlTog.addEventListener('click', () => fsWave(!root.hasAttribute('data-fswave')));
    // Inline there is no overlay: a click or tap toggles Play (DOUBLE_MS apart from a double, which is fullscreen).
    // In fullscreen the bar shows on pointer movement and hides after HOVER_IDLE_MS idle and on leave, kept while the
    // pointer rests on it or drags the seek; a touch on the hidden bar's video shows it without toggling.
    let idle = 0, drag = null, tapShow = false, clickT = 0;
    const hide = () => { if (drag == null && !hb.matches(':hover')) hov.removeAttribute('data-show'); };
    const poke = () => { hov.setAttribute('data-show', ''); clearTimeout(idle); idle = setTimeout(hide, HOVER_IDLE_MS); };
    stage.addEventListener('pointermove', poke);
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && drag == null) { clearTimeout(idle); hov.removeAttribute('data-show'); } });
    stage.addEventListener('pointerdown', (e) => { tapShow = media && e.pointerType !== 'mouse' && !hov.hasAttribute('data-show'); poke(); });
    stage.addEventListener('click', (e) => {
      if (!st.scene) { tapShow = false; return; }
      clearTimeout(clickT);
      // A control's click is not the video's (an Exit fullscreen has already moved its button out of the stage).
      if (!tapShow && vbox.contains(e.target) && !e.target.closest('.fsp-hb, button') && e.detail < 2) clickT = setTimeout(() => { ctl.toggle(); flash(); }, DOUBLE_MS);
      tapShow = false;
    });
    stage.addEventListener('dblclick', (e) => { if (vbox.contains(e.target) && !e.target.closest('.fsp-hb, button') && opts.fullscreen) { clearTimeout(clickT); fullscreen(); } });
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
    // PR8: one mode, the shell's page fullscreen, always bare.
    let media = false;
    const setMedia = (on) => {
      if (on === media) return;
      media = on;
      if (!on && root.hasAttribute('data-fswave')) fsWave(false);
      if (!on) setDrawer(false);
      toBar(on);
      root.toggleAttribute('data-media', on);
      render();
    };
    const fullscreen = () => {
      if (!media && st.scene && !st.scene.stream) return;
      const ask = new CustomEvent('phosphor-page-fullscreen', { bubbles: true, cancelable: true, detail: { on: !media, bare: true } });
      if (!root.dispatchEvent(ask)) setMedia(!media);
    };
    const onFull = (e) => { if (media && !(e.detail && e.detail.on)) setMedia(false); };
    if (opts.fullscreen) window.addEventListener('phosphor-page-fullscreen-change', onFull);

    const KEY_SEEK = { j: -10000, l: 10000, ArrowLeft: -5000, ArrowRight: 5000 };
    root.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, select, textarea, [role=slider]:not(.fsp-hb-seek)')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ((k === ' ' && !e.target.closest('button')) || k === 'k') ctl.toggle();
      else if (k in KEY_SEEK) ctl.seek(Math.max(0, ctl.mediaNow() + KEY_SEEK[k]));
      else if (k === 'm') setMuted(!video.muted);
      else if (k === 'g' && comp !== 'glance') expand(!root.hasAttribute('data-an'));
      else if (k === 'f' && opts.fullscreen) fullscreen();
      else return;
      e.preventDefault();
      poke();
    });
    el.append(root);

    let zoomMs = readPrefs(api).zoomMs;
    const tl = mountTimeline(tlbox, {
      ovHost: tr,
      ovBefore: rem,
      overlay: [speed],
      zoomMs,
      onZoom: (z) => { zoomMs = z; writePref(api, 'zoomMs', z); },
      onLoop: () => ctl.markAB(),
      onSeek: (ms) => ctl.seek(ms),
      onScrub: (phase, ms) => ctl.seek(ms),
      onRange: (partial, commit) => { if (commit) ctl.setT(partial); },
    });
    tlCaret.after(tl.zoomEl);
    off.before(tl.abEl);
    let library = null, analyzer = null;
    function expand(on) {
      root.toggleAttribute('data-an', on);
      graph.setAttribute('aria-pressed', String(on));
      graph.classList.toggle('on', on);
      recompose();
      if (on) anMount();
    }
    function anMount() {
      if (!analyzer) analyzer = mountAnalyzer(anbox, { api, trace: () => ctl.trace, script: () => ctl.wire, T: () => st.T, fit: () => ctl.fit });
    }
    let fitSeen = null;
    const libPrefs = { get: (k) => readPrefs(api)[k], set: (k, v) => writePref(api, k, v) };

    const recompose = () => {
      const cls = opts.page ? pageClass(+document.documentElement.dataset.bucket || 3, innerWidth, innerHeight) : '';
      if (cls) attr(root, 'data-cls', cls);
      // PR17: on the phone class a turn to landscape with a video enters fullscreen and the turn back leaves it; only a
      // rotation does, so an Exit in landscape holds until the next one.
      if (opts.fullscreen && prevCls && cls !== prevCls && (prevCls === 'portrait' || prevCls === 'landscape')) {
        if (cls === 'landscape' && !media && st.scene && st.scene.stream) fullscreen();
        else if (cls === 'portrait' && media) fullscreen();
      }
      if (library && cls !== prevCls) library.fit();
      prevCls = cls;
      const c = cls === 'portrait' ? (root.clientWidth < GLANCE_UP ? 'glance' : 'handheld') : cls ? 'full' : compositionOf(root.clientWidth);
      if (c !== comp) {
        comp = c;
        root.dataset.comp = c;
        if (hosting()) st.composition = c;
        if (c !== 'glance' && !library) {
          library = mountLibrary(lib, { getStash, prefs: libPrefs, fetch: (u, i) => api.net.fetch(u, i),
            onPick: (s) => { pick(s); setDrawer(false); }, rows: () => root.dataset.cls === 'portrait' && !media });
          lib.append(now);
          if (opts.page) lib.prepend(h('h3', { class: 'fsp-h' }, h('span', { class: 'fsp-ix', text: '02' }), COPY.library));
        }
      }
      const gapPx = parseFloat(getComputedStyle(root).columnGap) || 0;
      if (cls === 'desktop' && !libTouched) {
        const narrow = root.clientWidth - LIB_W - gapPx < BAR_ROW_MIN;
        if (narrow && !root.hasAttribute('data-libshut')) { libAuto = true; root.setAttribute('data-libshut', ''); libCaret.setAttribute('aria-expanded', 'false'); }
        else if (!narrow && libAuto) { libAuto = false; setLib(true); }
      }
      const lib1 = c === 'full' && !root.hasAttribute('data-libshut') && !root.hasAttribute('data-an');
      const col = root.clientWidth - (lib1 ? LIB_W + gapPx : 0);
      root.toggleAttribute('data-rows2', c !== 'glance' && (c === 'handheld' || cls === 'portrait' || cls === 'landscape' || col < BAR_ROW_MIN));
      applySplit();
    };
    const ro = new ResizeObserver(recompose);
    if (opts.page) window.addEventListener('resize', recompose);
    ro.observe(root);

    let tlKey = null, durSeen = -1;
    function render() {
      const ceil = ceilingOf(api, fields);
      const rt = video.playbackRate || 1, key = [st.script, st.shaped, st.T, ceil.vmax, ceil.spanMm, rt];
      if (!tlKey || key.some((k, i) => k !== tlKey[i])) { tlKey = key; tl.setScript(st.shaped || st.script, st.T, { ...ceil, vmax: ceil.vmax && ceil.vmax / rt }, st.script); }
      tl.setLoop(st.ab);
      const act = st.phase === 'playing' || st.phase === 'preroll';
      setIcon(play, act ? ICON.pause : ICON.play, act ? COPY.pauseKey : COPY.playKey);
      play.disabled = !act && !ctl.canPlay();
      const mk = marks(), mt = ctl.mediaNow();
      prevB.disabled = mk.length ? !st.scene : !(library && library.canStep(-1));
      nextB.disabled = mk.length ? !mk.some((x) => x > mt + 250) : !(library && library.canStep(1));
      closeH.disabled = mClose.disabled = !st.scene;
      const noVid = !!st.scene && !st.scene.stream;
      root.toggleAttribute('data-mo', noVid);
      root.toggleAttribute('data-paused', !!st.scene && !act);
      if (!cplay.hasAttribute('data-flash')) setIcon(cplay, ICON.play, '');
      setText(rate, (video.playbackRate || 1) + 'x');
      if (document.activeElement !== vol) vol.value = String(video.muted ? 0 : video.volume);
      const so = !!(opts.settings && opts.settings.open);
      attr(setB, 'aria-pressed', String(so));
      setB.classList.toggle('on', so);
      attr(motion, 'aria-pressed', String(st.motion));
      motion.classList.toggle('on', st.motion);
      attr(inv, 'aria-pressed', String(st.T.invert));
      inv.classList.toggle('on', st.T.invert);
      fullB.disabled = noVid;
      setIcon(fullB, media ? ICON.unfull : ICON.full, media ? COPY.fullExit : noVid ? COPY.noVideo : COPY.full);
      const rp = railPath();
      railB.hidden = !rp || !/^(portrait|landscape)$/.test(root.dataset.cls || '');
      if (rp && railB.firstChild.children[1].getAttribute('d') !== rp) railB.firstChild.children[1].setAttribute('d', rp);
      if (document.activeElement !== offIn && !offDrag) offIn.value = String(st.T.offsetMs);
      root.dataset.view = st.view;
      // F3's Open video and Open script land on the head's buttons, or the Media menu's button where it holds them.
      const inMenu = comp === 'handheld';
      for (const [b, k] of [[src.querySelector('.fsp-openv'), 'openVideo'], [src.querySelector('.fsp-opens'), 'openScript']]) {
        if (inMenu) b.removeAttribute('data-search-key'); else attr(b, 'data-search-key', k);
      }
      if (inMenu) attr(mediaB, 'data-search-key', 'openVideo'); else mediaB.removeAttribute('data-search-key');
      tabP.setAttribute('aria-selected', String(st.view === 'player'));
      tabL.setAttribute('aria-selected', String(st.view === 'library'));
      setText(title, st.scene ? st.scene.title : '');
      setText(nowT, st.scene ? st.scene.title : '');
      setIcon(nowB, act ? ICON.pause : ICON.play, act ? COPY.pause : COPY.play);
      nowB.disabled = play.disabled;
      if (head) {
        const libTab = comp === 'handheld' && st.view === 'library';
        setText(head.firstChild, libTab ? '02' : '01');
        setText(head.lastChild, libTab ? COPY.library : COPY.player);
      }
      empty.hidden = !!st.scene;
      mo.hidden = !noVid;
      setText(status, st.status.text);
      status.dataset.tone = st.status.tone;
      const tip = st.status.notes.join('\n');
      if (status.title !== tip) status.title = tip;
    }
    function frame() {
      const m = ctl.mediaNow();
      const d = Number.isFinite(video.duration) ? video.duration * 1000 : st.script ? st.script.durationMs : 0;
      const tt = fmtTime(m) + ' / ' + fmtTime(d);
      setText(time, comp === 'glance' ? tt.replace(/\.\d/g, '') : fmtTime(m));
      setText(rem, '-' + fmtTime(Math.max(0, d - m)));
      if (d !== durSeen) { durSeen = d; time.style.minWidth = fmtTime(d).length + 'ch'; rem.style.minWidth = fmtTime(d).length + 1 + 'ch'; }
      setText(hbTime, tt);
      setText(nowM, fmtTime(m));
      let buf = 0;
      for (let i = 0, b = video.buffered; b && i < b.length; i++) if (b.start(i) * 1000 <= m + 500) buf = Math.max(buf, b.end(i) * 1000);
      hbPlayed.style.width = (d > 0 ? clamp(m / d, 0, 1) * 100 : 0) + '%';
      hbBuf.style.width = (d > 0 ? clamp(buf / d, 0, 1) * 100 : 0) + '%';
      attr(seek, 'aria-valuemax', String(Math.round(d)));
      attr(seek, 'aria-valuenow', String(Math.round(m)));
      attr(seek, 'aria-valuetext', tt);
      if (comp && comp !== 'glance') anMount();
      if (comp !== 'glance') tl.frame(m, ctl.trace, analyzer && analyzer.kinetic);
      if (analyzer && comp !== 'glance') {
        analyzer.frame();
        const fr = analyzer.fit;
        if (fr && fr !== fitSeen) { fitSeen = fr; ctl.fitKinetic(fr.sc, fr.extent); }
      }
      const ceil = ceilingOf(api, fields);
      if (st.script) {
        const sp = strokeSpeed(st.shaped || st.script, m, st.T, ceil.spanMm), rt = video.playbackRate || 1;
        sp.v *= rt;
        const cap = sp.unit === 'mm/s' && ceil.vmax ? ceil.vmax : 0;
        setText(speedTxt, Math.round(sp.v) + ' ' + sp.unit);
        speedBar.style.width = cap ? clamp(sp.v / cap, 0, 1) * 100 + '%' : '0';
        speed.toggleAttribute('data-over', !!cap && sp.v > cap);
        speed.title = cap && sp.v > cap ? COPY.speedOver : COPY.speed;
        const at = tickAt(applyT(posAt(st.shaped || st.script, m), st.T));
        for (const t of [tickI, moI]) { t.hidden = false; t.style.left = at; }
      } else {
        setText(speedTxt, '');
        speedBar.style.width = '0';
        tickI.hidden = moI.hidden = true;
      }
      const pu = fields.pos ? windowShare(api.value(fields.pos), fields.lo && api.value(fields.lo), fields.hi && api.value(fields.hi)) : null;
      for (const t of [tickR, moR]) {
        t.hidden = pu == null;
        if (pu != null) t.style.left = tickAt(pu);
        t.classList.toggle('stale', !!(fields.pos && api.stale(fields.pos)));
      }
      render();
    }
    const hosting = () => vel.parentNode === vbox;
    render();
    return {
      fields, render, frame, hosting,
      host() { vbox.prepend(vel); st.composition = comp || st.composition; },
      destroy() {
        clearTimeout(idle);
        clearTimeout(clickT);
        window.removeEventListener('phosphor-page-fullscreen-change', onFull);
        window.removeEventListener('resize', recompose);
        document.removeEventListener('pointerdown', drawerOut, true);
        window.removeEventListener('phosphor-quick-rail-change', onRail);
        for (const t of META) vel.removeEventListener(t, onMeta);
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
    /** The video's volume, the settings card's phone row (PR12): a set unmutes and is stored as prefs audio. */
    volume: {
      get: () => (video.muted ? 0 : video.volume),
      set(x) { video.volume = clamp(+x || 0, 0, 1); video.muted = false; writePref(api, 'audio', { vol: video.volume, muted: false }); views.forEach((w) => w.render()); },
    },
    get scale() { return ctl.scale; },
    get state() { return ctl.state; },
  };
}

// ---- the settings card's playback rows -------------------------------------

// The rows' grid is rows.js's (PR18); this is the playback card's own: the volume row shows on phones only (PR5, PR12).
export const PLAY_CSS = `
:root:not([data-bucket='1'], [data-bucket='2']) .fsp-pset > .fsp-volrow { display: none; }
`;

// [key, label, tip, min, max, step, format]: ranges are prefs.js's repairs; a row without a range is a switch.
const PLAY_ROWS = [
  ['loop', COPY.loop, COPY.loopTip],
  ['loopCount', COPY.loopCount, '', 0, 99, 1, (v) => (v ? v + 'x' : COPY.forever)],
  ['home', COPY.home, COPY.homeTip],
  ['homeAfterMs', COPY.homeAfter, '', 1000, 60000, 500, (v) => (v / 1000).toFixed(1) + ' s'],
  ['homePoint', COPY.homePoint, '', 0, 1, 0.05, (v) => Math.round(v * 100) + ' %'],
  ['homeSpeed', COPY.homeSpeed, '', 0.05, 2, 0.05, (v) => Math.round(v * 100) + ' %/s'],
  ['seekMs', COPY.seekMs, COPY.seekTip, 0, 3000, 50, (v) => (v ? v + ' ms' : COPY.jump)],
  ['autoLatency', COPY.auto, COPY.autoTip],
];

/**
 * The settings card's playback rows (PR18: label, control, value chip; switches for the toggles); -> unmount().
 * onChange(partial) on commit. volume: {get(), set(v)}, the player's, drawn as the phones' volume row.
 */
export function mountPlay(el, { value, onChange, volume = null }) {
  let v = { ...value };
  const box = rowsBox(COPY.playHeading);
  box.classList.add('fsp-pset');
  box.prepend(h('style', { text: PLAY_CSS }));
  box.append(sub(COPY.playHeading));
  const draws = PLAY_ROWS.map(([key, label, tip, min, max, step, fmt]) => {
    if (min == null) {
      const s = switchRow(box, label, { tip });
      s.addEventListener('change', () => { v = { ...v, [key]: s.checked }; onChange({ [key]: v[key] }); });
      return () => { s.checked = !!v[key]; };
    }
    const { input: i, out } = sliderRow(box, label, { min, max, step, tip });
    i.addEventListener('input', () => setText(out, fmt(+i.value)));
    i.addEventListener('change', () => { v = { ...v, [key]: +i.value }; draw(); onChange({ [key]: v[key] }); });
    return () => { if (document.activeElement !== i) i.value = String(v[key]); setText(out, fmt(v[key])); };
  });
  if (volume) {
    const n = box.children.length;
    const { input: i, out } = sliderRow(box, COPY.volume, { min: 0, max: 1, step: 0.05 });
    [...box.children].slice(n).forEach((e) => e.classList.add('fsp-volrow'));
    const fmt = (x) => Math.round(x * 100) + ' %';
    i.addEventListener('input', () => { volume.set(+i.value); setText(out, fmt(+i.value)); });
    draws.push(() => { const x = volume.get(); if (document.activeElement !== i) i.value = String(x); setText(out, fmt(x)); });
  }
  const draw = () => draws.forEach((d) => d());
  el.append(box);
  draw();
  return () => box.remove();
}
