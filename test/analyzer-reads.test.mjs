/**
 * analyzer-reads.test.mjs -- the funscript analyzer reads the host only when api.changed moves
 * (plugins/factory/funscript-player/analyzer.js, ph-uve3). Node only: a minimal element stub
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
  constructor(tag) { this.tag = tag; this.kids = []; this.attrs = {}; this.on = {}; this.textContent = ''; this.title = ''; this.disabled = false; this.className = ''; }
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
ok('a gate change greys the row on the next frame', inputOf('Smoothness').disabled === true && rowOf('Smoothness').title === 'no hub link',
  { disabled: inputOf('Smoothness').disabled, title: rowOf('Smoothness').title });
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

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
