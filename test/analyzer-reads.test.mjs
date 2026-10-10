/**
 * analyzer-reads.test.mjs -- the funscript analyzer reads the host only when api.changed moves
 * (plugins/factory/funscript-player/analyzer.js, ph-uve3), and api.onChanged's watchers
 * (src/model/changes.js) ask it for a frame when the machine is parked (ph-vo56). Node only: a minimal element stub
 * stands in for the DOM, a counting fake for the plugin api, the valencesim catalog fixture
 * for the rows.
 *
 * Run: node test/analyzer-reads.test.mjs
 */
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/index.js';
import { buildSettingsModel } from '../src/model/settings.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

// ---- the element stub: what analyzer.js touches ----
class El {
  constructor(tag) { this.tag = tag; this.kids = []; this.attrs = {}; this.on = {}; this.textContent = ''; this.dataset = {}; this.disabled = false; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  get classList() { return { toggle: () => {} }; }
  append(...k) { this.kids.push(...k); }
  replaceChildren(...k) { this.kids = k; }
  remove() {}
  addEventListener(t, fn) { (this.on[t] ||= []).push(fn); }
  fire(t) { for (const fn of this.on[t] || []) fn(); }
  *walk() { yield this; for (const k of this.kids) if (k instanceof El) yield* k.walk(); }
}
globalThis.document = { createElement: (t) => new El(t), activeElement: null };
const { mountAnalyzer } = await import('../plugins/factory/funscript-player/analyzer.js');

// ---- the fake api: counts every host read; api.changed is a plain sequence per channel ----
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url)));
const model = buildSettingsModel(decodeCatalog(bytes));
const per = {}, vals = {}, gates = {};
let all = 0;
const calls = {};
const counted = (k, fn) => (...a) => { calls[k] = (calls[k] || 0) + 1; return fn(...a); };
const reads = () => Object.entries(calls).reduce((s, [, n]) => s + n, 0);
const api = {
  catalog: counted('catalog', () => model),
  field: counted('field', (role) => (model.byRole.get(role) || [])[0] || null),
  value: counted('value', (f) => (f ? vals[f.uid] ?? 1 : undefined)),
  status: counted('status', () => 'confirmed'),
  gate: counted('gate', (f) => gates[f.uid] || ''),
  reason: counted('reason', () => ''),
  stale: counted('stale', () => ''),
  get trialPending() { calls.trialPending = (calls.trialPending || 0) + 1; return false; },
  changed: (x) => (typeof x === 'string' ? 0 : per[x] || 0) + all,
  write() {}, writeTrial() { return { ok: true }; }, commitTrial: async () => ({ ok: true }), revertTrial: async () => ({ ok: true }),
};
const el = new El('div');
const an = mountAnalyzer(el, { api });
const rowOf = (label) => [...el.walk()].find((e) => e.className === 'fsa-row' && e.kids[0].textContent === label);
const outOf = (label) => rowOf(label).kids[2];
const inputOf = (label) => rowOf(label).kids[1].kids[0];
const smooth = model.byRole.get('meta.trial_pending') && [...el.walk()].some((e) => e.className === 'fsa-row') && rowOf('Smoothness');
ok('the fixture gives the analyzer its rows, Smoothness among them', !!smooth);

an.frame(true);
const first = reads();
ok('the first open frame reads the host', first > 0, calls);
for (const k in calls) calls[k] = 0;
for (let i = 0; i < 20; i++) an.frame(true);
for (let i = 0; i < 20; i++) an.frame(false);
ok('an idle analyzer, open or shut, makes no host read on 40 frames (only api.changed)', reads() === 0, calls);

// Another client's write: a STATE on the row's channel moves its sequence; the next frame shows the value.
const sm = model.byRole.get('meta.trial_pending') && [...model.byRole.values()].flat().find((f) => f.name === 'smoothness')
  || model.categories.flatMap((c) => c.groups.flatMap((g) => g.fields)).find((f) => f.name === 'smoothness');
an.frame(true);
vals[sm.uid] = 0.35;
an.frame(true);
ok('a value changed elsewhere without a sequence move is not read', outOf('Smoothness').textContent !== '0.35', outOf('Smoothness').textContent);
per[sm.channelId] = (per[sm.channelId] || 0) + 1;
an.frame(true);
ok('another client\'s write shows on the next frame', outOf('Smoothness').textContent === '0.35', outOf('Smoothness').textContent);

// A gate change (a link loss, the machine's mask): every sequence moves; the next frame greys the row.
gates[sm.uid] = 'no hub link';
all++;
an.frame(true);
ok('a gate change greys the row on the next frame', inputOf('Smoothness').disabled === true && rowOf('Smoothness').dataset.tip === 'no hub link',
  { disabled: inputOf('Smoothness').disabled, tip: rowOf('Smoothness').dataset.tip });
delete gates[sm.uid];
all++;
an.frame(true);
ok('...and ungreys it on the next frame after it clears', inputOf('Smoothness').disabled === false);

// No poll: time passing alone never reads.
for (const k in calls) calls[k] = 0;
const t0 = Date.now();
while (Date.now() - t0 < 300) an.frame(true);
ok('300 ms of frames with nothing changed read nothing (no poll)', reads() === 0, calls);

// A draft reads on the next frame; a write reads at once on its frame.
for (const k in calls) calls[k] = 0;
const sl = inputOf('Smoothness');
sl.value = '0.5';
sl.fire('input');
an.frame(true);
ok('a draft re-reads on the next frame', calls.value > 0 && outOf('Smoothness').textContent === '0.5', outOf('Smoothness').textContent);

// Without api.changed every frame reads, as before.
const el2 = new El('div');
const an2 = mountAnalyzer(el2, { api: { ...api, changed: undefined } });
an2.frame(false);
for (const k in calls) calls[k] = 0;
an2.frame(false);
an2.frame(false);
ok('without api.changed every frame reads', calls.value > 0 && calls.catalog === 2, calls);
an.unmount(); an2.unmount();

// ---- the push (ph-vo56): src/model/changes.js's watchers behind api.onChanged ----
const { bump, bumpAll, seq, watch } = await import('../src/model/changes.js');
const frames = [];
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
const nextFrame = () => { const q = frames.splice(0); q.forEach((fn) => fn(performance.now())); };
const tick = () => new Promise((r) => queueMicrotask(r));
{
  let n = 0;
  const off = watch((ch) => ch === 7, () => n++);
  bump(8);
  await tick();
  ok('watch: a move on another channel is not told', n === 0);
  bump(7); bump(7); bump(7);
  await tick();
  ok('watch: a burst is told once, on a microtask', n === 1, n);
  bump(7);
  await tick();
  ok('watch: a move later in the same frame waits for the next frame', n === 1, n);
  nextFrame();
  ok('...and is told then, once', n === 2, n);
  nextFrame();
  bumpAll();
  await tick();
  ok('watch: a move of every channel (bumpAll) is told', n === 3, n);
  nextFrame(); nextFrame();
  ok('watch: idle, nothing asks for frames', frames.length === 0, frames.length);
  off();
  bump(7);
  await tick();
  nextFrame();
  ok('watch: after the unwatch, nothing', n === 3, n);
}
{
  // Parked: no player loop, no claimed field moving; the only frames are the ones the analyzer asks for.
  const roles = new Map([...model.byRole].map(([r, fs]) => [r, [...new Set(fs.map((f) => f.channelId))]]));
  const live = new Set();
  let asked = 0;
  const papi = { ...api,
    changed: (x) => seq(typeof x === 'string' ? roles.get(x) || [] : x),
    onChanged: (list, fn) => {
      const off = watch((ch) => list.some((x) => (typeof x === 'string' ? (roles.get(x) || []).includes(ch) : x === ch)), fn);
      live.add(off);
      return () => { off(); live.delete(off); };
    },
  };
  const el3 = new El('div');
  const an3 = mountAnalyzer(el3, { api: papi, onRender: () => { asked++; } });
  an3.frame(true);
  await tick(); nextFrame(); await tick(); nextFrame();
  asked = 0;
  const row3 = (l) => [...el3.walk()].find((e) => e.className === 'fsa-row' && e.kids[0].textContent === l);
  ok('parked: one watch while mounted', live.size === 1, live.size);
  vals[sm.uid] = 0.65;
  bump(sm.channelId);   // another client's write lands
  await tick();
  ok('parked: another client\'s write asks for a frame on a microtask', asked === 1, asked);
  an3.frame(true);      // the frame it asked for
  ok('...and that frame shows it', row3('Smoothness').kids[2].textContent === '0.65', row3('Smoothness').kids[2].textContent);
  nextFrame();
  bump(0xfff0);
  await tick(); nextFrame();
  ok('parked: a channel the analyzer does not read asks nothing', asked === 1, asked);
  const m2 = buildSettingsModel(decodeCatalog(bytes));
  papi.catalog = () => m2;
  bumpAll();
  await tick(); nextFrame();
  an3.frame(true);
  ok('a new catalog renews the watch: still one', live.size === 1, live.size);
  an3.unmount();
  ok('unmount drops the watch, no leak', live.size === 0, live.size);
  const a0 = asked;
  bump(sm.channelId);
  bumpAll();
  await tick(); nextFrame();
  ok('...and nothing is asked after it', asked === a0, asked - a0);
}

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
