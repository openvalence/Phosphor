// funscript.js -- funscript parse, validate, interpolate, heat, axes; pure, no DOM, no imports
// Contract: CONTRACT.md, module core (ph-smvd.1). Callers read a Script's arrays; never mutate them.
//
// Constraints:
// - 'range ignored' is noted only when `range` is a number other than 100: 100 is the identity.
// - Further notes: 'N invalid actions dropped', 'N long spans split', 'actions sorted'.
//   Every repair is noted; none is silent.
// - Refused in words, before any expansion: more than MAX_ACTIONS actions, or a
//   last action past MAX_SCRIPT_MS (a 1e12 ms gap split into 60 s spans was
//   16.7 million knots; 1e13 threw the engine's 'Invalid array length').
// - thin(): extrema are slope-sign changes, so hold corners count. Each leg keeps its farthest
//   extremum; a leg shorter than minGapMs absorbs the next reversal instead of committing, so the
//   stroke survives at a slower period. The last action replaces a kept point closer than minGapMs
//   unless that is the first. Notes gain 'N actions thinned'.

export const MAX_SPAN_MS = 60000, MAX_SCRIPT_MS = 24 * 3600000, MAX_ACTIONS = 1000000;

const NAMED = { '': 'L0', stroke: 'L0', surge: 'L1', sway: 'L2', twist: 'R0', roll: 'R1', pitch: 'R2',
  vib: 'V0', valve: 'A0', suck: 'A1', lube: 'A2' };
const TCODE = ['L0', 'L1', 'L2', 'R0', 'R1', 'R2', 'V0', 'A0', 'A1', 'A2'];
// Keys are lowercase; look up with the lowercased suffix.
export const AXES = Object.freeze({ ...NAMED, ...Object.fromEntries(TCODE.map((id) => [id.toLowerCase(), id])) });

const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|ogv|mp3|m4a|wav|ogg|oga|flac|aac|opus)$/i;
const count = (n, word, verb) => n + ' ' + word + (n === 1 ? '' : 's') + ' ' + verb;

function fail(words) { throw new Error(words); }

export function parseFunscript(input, name = '') {
  let doc = input;
  if (typeof input === 'string') { try { doc = JSON.parse(input); } catch { fail('not a funscript'); } }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.actions)) fail('not a funscript');
  if (doc.actions.length > MAX_ACTIONS) fail('more than a million actions');

  const notes = [];
  const raw = [];
  let invalid = 0;
  for (const a of doc.actions) {
    if (a && Number.isFinite(a.at) && a.at >= 0 && Number.isFinite(a.pos)) raw.push(a);
    else invalid++;
  }
  if (!raw.length) fail('no actions');
  if (raw.some((a) => a.at > MAX_SCRIPT_MS)) fail('script longer than 24 hours');
  const unsorted = raw.some((a, i) => i && a.at < raw[i - 1].at);
  if (unsorted) raw.sort((x, y) => x.at - y.at);   // stable

  const keep = [];
  let dups = 0;
  for (const a of raw) {
    if (keep.length && keep[keep.length - 1].at === a.at) { keep[keep.length - 1] = a; dups++; } else keep.push(a);
  }

  const inv = doc.inverted === true;
  let clamped = 0;
  const at = [], pos = [];
  let split = 0;
  for (const a of keep) {
    let p = a.pos;
    if (p < 0 || p > 100) { p = Math.min(100, Math.max(0, p)); clamped++; }
    p /= 100;
    if (inv) p = 1 - p;
    const n = at.length;
    const gap = n ? a.at - at[n - 1] : 0;
    if (gap > MAX_SPAN_MS) {
      const k = Math.ceil(gap / MAX_SPAN_MS), t0 = at[n - 1], p0 = pos[n - 1];
      for (let j = 1; j < k; j++) { at.push(t0 + (gap * j) / k); pos.push(p0 + ((p - p0) * j) / k); }
      split++;
    }
    at.push(a.at);
    pos.push(p);
  }

  if (invalid) notes.push(count(invalid, 'invalid action', 'dropped'));
  if (dups) notes.push(count(dups, 'duplicate', 'dropped'));
  if (clamped) notes.push(count(clamped, 'position', 'clamped'));
  if (split) notes.push(count(split, 'long span', 'split'));
  if (unsorted) notes.push('actions sorted');
  if (typeof doc.range === 'number' && doc.range !== 100) notes.push('range ignored');

  const ignored = Array.isArray(doc.axes)
    ? doc.axes.map((x) => x && (x.id ?? x.name)).filter((s) => typeof s === 'string' && s) : [];
  const metadata = doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata) ? doc.metadata : null;
  const title = metadata && typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : null;

  const A = Float64Array.from(at);
  return { name, title, at: A, pos: Float32Array.from(pos), durationMs: A[A.length - 1], axis: 'L0',
    ignored, notes, metadata };
}

export function axisOf(fileName) {
  const file = String(fileName).split(/[\\/]/).pop();
  const m = /^(.*)\.funscript$/i.exec(file);
  if (!m) return null;
  const dot = m[1].lastIndexOf('.');
  const suffix = dot < 0 ? '' : m[1].slice(dot + 1).toLowerCase();
  if (dot >= 0 && suffix in AXES) return { base: m[1].slice(0, dot), axis: AXES[suffix] };
  return { base: m[1], axis: 'L0' };
}

const isMedia = (f) => /^(video|audio)\//.test(f.type || '') || MEDIA_EXT.test(f.name);
const stem = (name) => name.replace(/\.[^.]*$/, '').toLowerCase();

export function pairFiles(files) {
  const list = Array.from(files || []);
  const video = list.find(isMedia) || null;
  const scripts = list.map((f) => [f, axisOf(f.name)]).filter(([, ax]) => ax);
  const l0 = scripts.filter(([, ax]) => ax.axis === 'L0');
  const base = video ? stem(video.name) : null;
  const script = (l0.find(([, ax]) => ax.base.toLowerCase() === base) || l0[0] || [null])[0];
  return { video, script, extra: scripts.map(([f]) => f).filter((f) => f !== script) };
}

export function indexAfter(script, tMs) {
  const at = script.at;
  let lo = 0, hi = at.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] > tMs) hi = mid; else lo = mid + 1; }
  return lo;
}

export function posAt(script, tMs) {
  const { at, pos } = script, n = at.length;
  if (!(tMs > at[0])) return pos[0];
  if (tMs >= at[n - 1]) return pos[n - 1];
  const i = indexAfter(script, tMs);
  return pos[i - 1] + ((pos[i] - pos[i - 1]) * (tMs - at[i - 1])) / (at[i] - at[i - 1]);
}

const chord = (at, pos, i) => (Math.abs(pos[i] - pos[i - 1]) * 1000) / (at[i] - at[i - 1]);

/** The fastest chord in the script, norm/s. */
export function peakSpeed(script) {
  let v = 0;
  for (let i = 1; i < script.at.length; i++) v = Math.max(v, chord(script.at, script.pos, i));
  return v;
}

export function speedAt(script, tMs) {
  const i = indexAfter(script, tMs);
  return i === 0 || i === script.at.length ? 0 : chord(script.at, script.pos, i);
}

export function thin(script, minGapMs) {
  const { at, pos } = script, n = at.length;
  const kept = [0];
  const sgn = (a, b) => Math.sign(pos[b] - pos[a]);
  let pend = -1;
  for (let i = 1; i < n - 1; i++) {
    if (sgn(i - 1, i) === sgn(i, i + 1)) continue;   // not an extremum
    if (pend < 0) { pend = i; continue; }
    const top = kept[kept.length - 1], d = sgn(pend, i);
    if (d !== 0 && d === sgn(top, pend)) pend = i;
    else if (at[pend] - at[top] >= minGapMs) { kept.push(pend); pend = i; }
    else if (d === 0) pend = i;
  }
  const end = n - 1;
  if (pend >= 0 && at[pend] - at[kept[kept.length - 1]] >= minGapMs && at[end] - at[pend] >= minGapMs) kept.push(pend);
  if (end > 0) {
    if (kept.length > 1 && at[end] - at[kept[kept.length - 1]] < minGapMs) kept[kept.length - 1] = end;
    else kept.push(end);
  }
  const A = Float64Array.from(kept, (k) => at[k]);
  const dropped = n - kept.length;
  return { ...script, at: A, pos: Float32Array.from(kept, (k) => pos[k]), durationMs: A[A.length - 1],
    ignored: [...script.ignored], notes: dropped ? [...script.notes, count(dropped, 'action', 'thinned')] : [...script.notes] };
}

export function heat(script, bins, fromMs = 0, toMs = script.durationMs) {
  const out = new Float32Array(Math.max(0, bins | 0));
  if (!out.length || !(toMs > fromMs)) return out;
  const { at, pos } = script, n = at.length, w = (toMs - fromMs) / out.length;
  for (let i = Math.max(1, indexAfter(script, fromMs)); i < n && at[i - 1] < toMs; i++) {
    const s0 = Math.max(at[i - 1], fromMs), s1 = Math.min(at[i], toMs), v = chord(at, pos, i);
    if (!(s1 > s0) || !v) continue;
    for (let b = Math.floor((s0 - fromMs) / w), t = s0; t < s1 && b < out.length; b++) {
      const e = Math.min(s1, fromMs + (b + 1) * w);
      if (e > t) { out[b] += ((e - t) * v) / w; t = e; }
    }
  }
  return out;
}

const pad = (v) => String(v).padStart(2, '0');

export function fmtTime(ms) {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (t >= 3600000) {
    const s = Math.floor(t / 1000);
    return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }
  const d = Math.floor(t / 100);
  return Math.floor(d / 600) + ':' + pad(Math.floor(d / 10) % 60) + '.' + (d % 10);
}
