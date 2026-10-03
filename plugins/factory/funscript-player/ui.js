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
// - Handheld takes data-narrow (a three-row transport, no volume slider) when
//   the two-row transport overflows at the card's width, measured on a width
//   change and on a Look change (the Offset label's box), never on a state
//   change, so the Look scale moves the switch with the text. Its button
//   columns are max-content: an auto column squeezes a button to its 40 px
//   min-width, cutting the label, and never overflows.
// - The speed reading's floor is 10ch of its own font ('20000 mm/s'), never
//   its current text, so the switch does not move with the reading.
// - CSS: tokens only, never --bad or --estop (law 13); 40 px targets (law 12).
// - --warn is a mark, never text: on a light chassis it reads 1.8:1, and it is
//   locked (law 13). Warn text stays --tx beside a --warn bar.
// - The probe exists only while localStorage phosphor.funscript.probe is '1'.

import { parseFunscript, pairFiles, posAt, fmtTime, axisOf, peakSpeed } from './funscript.js';
import { createMediaClock, frameSource } from './clock.js';
import { createScheduler, applyT, strokeSpeed, TRANSIENT } from './scheduler.js';
import { createStash } from './stash.js';
import { mountLibrary } from './library.js';
import { mountTimeline, CSS as TL_CSS } from './timeline.js';
import { readPrefs, writePref } from './prefs.js';
import { shape } from './interp.js';

export const FULL_UP = 960;
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
  mute: 'Mute',
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
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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
 * onChange(); revoke(url).
 */
export function createControl({ api, video, clock, scheduler, submit, now = () => performance.now(),
  probe = () => {}, onChange = () => {}, revoke = (u) => URL.revokeObjectURL(u) }) {
  const prefs = readPrefs(api);
  const state = { phase: 'empty', scene: null, script: null, shaped: null, T: { ...prefs.T }, motion: prefs.motion !== false,
    status: { text: COPY.empty, tone: '', notes: [] }, view: prefs.view === 'library' ? 'library' : 'player', composition: 'full' };
  let fields = null;
  let why = '';          // a fatal refusal or media error; cleared by Play and by a load
  let info = [];         // load facts: no script, repairs, extra axes
  let transient = '';
  let buffering = false, sentSince = false, restart = false, pre = null, url = null, seq = 0, peak = 0;
  let lastM = NaN;      // the previous frame's media time; NaN after a clock reset
  let interp = prefs.interp;
  const trace = [];
  scheduler.setTransform(state.T);

  const gate = () => (state.motion && fields && fields.dur ? api.gate(fields.dur) || '' : '');
  const active = () => state.phase === 'playing' || state.phase === 'preroll';
  const mediaNow = () => (state.phase === 'playing' && clock.ready ? clock.mediaAt(now()) : video.currentTime * 1000);
  const here = () => {
    if (!fields || !fields.pos || api.stale(fields.pos)) return null;
    return windowShare(api.value(fields.pos), fields.lo && api.value(fields.lo), fields.hi && api.value(fields.hi));
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
    if (state.phase === 'playing') hold();
    pre = null;
    buffering = false;
    transient = '';
    why = words;
    state.phase = phase;
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
      if (restart) { scheduler.restart(clock); restart = false; }
      const r = scheduler.tick(clock);
      if (r.sent > 0) sentSince = true;
      if (r.fatal) stop('held', r.reason, true);
      else transient = r.ok ? '' : r.reason;
    }
    if (state.phase === 'playing' && clock.ready && fields && fields.pos) {
      const m = clock.mediaAt(now() - state.T.offsetMs);
      if (Number.isFinite(m)) {
        trace.push({ m, u: windowShare(api.value(fields.pos), fields.lo && api.value(fields.lo), fields.hi && api.value(fields.hi)),
          stale: !!api.stale(fields.pos) });
      }
    }
    const cur = mediaNow();
    while (trace.length && trace[0].m < cur - TRACE_MS) trace.shift();
    if (trace.length && trace[trace.length - 1].m > cur + 1000) trace.length = 0;
    refresh();
  }

  function onFrame(mediaMs, displayMs) {
    if (state.phase !== 'playing' || buffering || video.paused || video.seeking) return;
    probe({ k: 'obs', m: mediaMs, d: displayMs });
    const prev = lastM;
    lastM = mediaMs;
    // Only a frame that advances past one seen since the reset carries the clock: after play()
    // or a seek the first frame often repeats for several vsyncs at one media time.
    if (!(mediaMs > prev)) return;
    if (!clock.ready) { clock.anchor(mediaMs, displayMs, video.playbackRate); restart = true; }
    else if (clock.observe(mediaMs, displayMs) === 'step') restart = true;
  }

  function warm() {
    if (state.motion && state.script && fields && !gate()) submit([]);
  }

  /** The scheduler runs the shaped Script (interp.js): linear with no filters is the Script itself. */
  function reshape() {
    const s = state.script;
    const next = s ? shape(s, interp, { spanMm: fields ? ceilingOf(api, fields).spanMm : 0, lo: state.T.lo, hi: state.T.hi }) : null;
    if (next === state.shaped) return;
    state.shaped = next;
    scheduler.load(next);
    peak = next ? peakSpeed(next) : 0;
    if (state.phase === 'playing' && clock.ready) restart = true;
  }

  /** scene: Scene | LocalScene; script: Script | Promise<Script> | null; none: words when it has no script. */
  function load(scene, script, none, extra = []) {
    if (active()) stop('ready');
    if (url) revoke(url);
    url = String(scene.key).startsWith('file:') ? scene.stream : null;
    const my = ++seq;
    Object.assign(state, { scene, script: null, shaped: null, phase: 'ready' });
    scheduler.load(null);
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
  function seek(ms) { if (Number.isFinite(ms)) video.currentTime = Math.max(0, ms) / 1000; }

  function status() {
    const g = gate();
    if (why) return { text: why, tone: 'warn' };
    if (g && state.scene) return { text: g, tone: 'warn' };
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
    if (state.phase === 'playing' && video.ended) { state.phase = 'ready'; sentSince = false; changed(); }
    else if (active()) stop('ready');
  });
  on('ended', () => { if (state.phase === 'playing') { state.phase = 'ready'; sentSince = false; changed(); } });
  on('waiting', () => { if (state.phase === 'playing') { hold(); buffering = true; changed(); } });
  on('playing', () => { if (state.phase === 'playing') { buffering = false; resetClock(); changed(); } });
  on('seeking', () => { if (state.phase === 'playing') hold(); trace.length = 0; });
  on('ratechange', () => { if (state.phase === 'playing') hold(); });
  on('error', () => { if (state.scene) stop('error', COPY.badFormat); });

  return {
    state, trace, play, tick, onFrame, load, setMotion, setT, setView, seek, mediaNow, here,
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
.fsp { position: relative; height: 100%; min-height: 0; display: grid; gap: 4px; --fsp-detail: 96px;
  grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: var(--tap) minmax(0, 1fr) 124px 20px var(--tap);
  grid-template-areas: "src lib" "stage lib" "tl lib" "st st" "tr tr"; }
.fsp[data-comp=handheld] { --fsp-detail: 72px; grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--tap) minmax(0, 1fr) 100px 20px calc(var(--tap) * 2 + 4px);
  grid-template-areas: "src" "stage" "tl" "st" "tr"; }
.fsp[data-comp=handheld][data-narrow] { grid-template-rows: var(--tap) minmax(0, 1fr) 100px 20px calc(var(--tap) * 3 + 8px); }
.fsp[data-comp=glance] { grid-template-columns: minmax(0, 1fr); grid-template-rows: 20px 24px var(--tap) 20px;
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
.fsp-libbox { grid-area: lib; min-width: 0; min-height: 0; overflow: hidden; }
.fsp[data-comp=handheld] .fsp-libbox { grid-area: 2 / 1 / 4 / 2; }
.fsp[data-comp=handheld][data-view=library] :is(.fsp-stage, .fsp-tlbox) { visibility: hidden; }
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
  border-left: 3px solid transparent; padding-left: 6px; }
.fsp-slot[data-tone=warn] { color: var(--tx); border-left-color: var(--warn); }
.fsp-tr { grid-area: tr; display: grid; gap: 4px; align-items: center; min-width: 0;
  grid-template-columns: auto 16ch auto auto auto minmax(auto, 1fr) auto minmax(60px, 110px);
  grid-template-areas: "play time motion off inv speed mute vol"; }
.fsp[data-comp=handheld] .fsp-tr { grid-template-columns: max-content 16ch minmax(auto, 1fr) max-content minmax(50px, 90px);
  grid-template-rows: var(--tap) var(--tap);
  grid-template-areas: "play time speed mute vol" "motion off off inv inv"; }
.fsp[data-comp=handheld][data-narrow] .fsp-tr { grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: var(--tap) var(--tap) var(--tap);
  grid-template-areas: "play time time" "motion off off" "inv speed mute"; }
.fsp[data-comp=handheld][data-narrow] .fsp-vol { display: none; }
.fsp[data-comp=handheld][data-narrow] .fsp-time { font-size: .7rem; }
.fsp[data-comp=glance] .fsp-tr { grid-template-columns: auto 1fr; grid-template-areas: "play time"; }
.fsp[data-comp=glance] :is(.fsp-motion, .fsp-off, .fsp-inv, .fsp-speed, .fsp-mute, .fsp-vol) { display: none; }
.fsp-play { grid-area: play; min-width: 72px; }
.fsp-time { grid-area: time; font: .8rem var(--mono); color: var(--tx-val); white-space: nowrap; overflow: hidden; }
.fsp[data-comp=glance] .fsp-time { font-size: .7rem; }
.fsp-motion { grid-area: motion; }
.fsp-inv { grid-area: inv; }
.fsp-mute { grid-area: mute; }
.fsp-off { grid-area: off; display: flex; align-items: center; gap: 6px; min-height: var(--tap); }
.fsp-offk { cursor: ew-resize; touch-action: none; user-select: none; color: var(--tx-mut); font-size: .8rem; min-height: var(--tap); display: grid; align-items: center; }
.fsp-off input { width: 7ch; min-height: var(--tap); font-family: var(--mono); }
.fsp-speed { grid-area: speed; position: relative; height: var(--tap); min-width: 10ch; font: .75rem var(--mono); display: grid; align-items: center; }
.fsp-speed i { position: absolute; left: 0; bottom: 6px; height: 3px; border-radius: 1.5px; background: var(--intent); max-width: 100%; }
.fsp-speed[data-over] i { background: var(--warn); }
.fsp-speed span { color: var(--tx-mut); white-space: nowrap; overflow: hidden; }
.fsp-speed[data-over] span { color: var(--tx); }
.fsp-vol { grid-area: vol; min-width: 0; margin: 0; }
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
  const stopFrames = frameSource(video, ctl.onFrame);

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

  function mount(el, fields) {
    const view = makeView(el, fields);
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

  function makeView(el, fields) {
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
    stage.addEventListener('click', () => ctl.toggle());
    const tlbox = h('div', { class: 'fsp-tlbox' });
    const lib = h('div', { class: 'fsp-libbox' });
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
    const mute = btn('fsp-mute', COPY.mute);
    const vol = h('input', { class: 'fsp-vol', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': COPY.volume, title: COPY.volume });
    const saveAudio = () => writePref(api, 'audio', { vol: video.volume, muted: video.muted });
    mute.addEventListener('click', () => { video.muted = !video.muted; saveAudio(); render(); });
    vol.addEventListener('input', () => { video.volume = clamp(+vol.value, 0, 1); });
    vol.addEventListener('change', saveAudio);
    const tr = h('div', { class: 'fsp-tr' }, play, time, motion, off, inv, speed, mute, vol);

    const root = h('div', { class: 'fsp', tabindex: '-1' }, h('style', { text: CSS + TL_CSS }),
      src, stage, tlbox, lib, meter, status, tr);
    root.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || e.target.closest('input, button, select, textarea, [role=slider]')) return;
      e.preventDefault();
      ctl.toggle();
    });
    el.append(root);

    let zoomMs = readPrefs(api).zoomMs;
    const tl = mountTimeline(tlbox, {
      zoomMs,
      onZoom: (z) => { zoomMs = z; writePref(api, 'zoomMs', z); },
      onSeek: (ms) => ctl.seek(ms),
      onScrub: (phase, ms) => ctl.seek(ms),
      onRange: (partial, commit) => { if (commit) ctl.setT(partial); },
    });
    let library = null;
    const libPrefs = { get: (k) => readPrefs(api)[k], set: (k, v) => writePref(api, k, v) };

    let comp = '';
    const ro = new ResizeObserver(() => {
      const c = compositionOf(root.clientWidth);
      if (c !== comp) {
        comp = c;
        root.dataset.comp = c;
        if (hosting()) st.composition = c;
        if (c !== 'glance' && !library) library = mountLibrary(lib, { getStash, prefs: libPrefs, onPick: pick, onLocal: openLocal,
          fetch: (u, i) => api.net.fetch(u, i) });
      }
      root.removeAttribute('data-narrow');
      if (c === 'handheld' && tr.scrollWidth > tr.clientWidth) root.setAttribute('data-narrow', '');
    });
    ro.observe(root);
    ro.observe(offK);

    let tlKey = null;
    function render() {
      const ceil = ceilingOf(api, fields);
      const key = [st.script, st.shaped, st.T, ceil.vmax, ceil.spanMm];
      if (!tlKey || key.some((k, i) => k !== tlKey[i])) { tlKey = key; tl.setScript(st.shaped || st.script, st.T, ceil, st.script); }
      const act = st.phase === 'playing' || st.phase === 'preroll';
      setText(play, act ? COPY.pause : COPY.play);
      play.disabled = !act && !ctl.canPlay();
      motion.setAttribute('aria-pressed', String(st.motion));
      inv.setAttribute('aria-pressed', String(st.T.invert));
      mute.setAttribute('aria-pressed', String(video.muted));
      if (document.activeElement !== offIn && !offDrag) offIn.value = String(st.T.offsetMs);
      if (document.activeElement !== vol) vol.value = String(video.volume);
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
      setText(time, fmtTime(m) + ' / ' + fmtTime(d));
      if (comp !== 'glance') tl.frame(m, ctl.trace);
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
        ro.disconnect();
        tl.unmount();
        if (library) library.unmount();
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
    get state() { return ctl.state; },
  };
}
