/**
 * anomaly.test.mjs -- a device EVENT in plain words from its own catalog entry
 * (src/model/anomaly.js, ph- Anomalies pane).
 *
 * Fails if a kind stops reading by its event_kinds label, if a sentence ever
 * needs a kind table or a field name, if a normalized position becomes mm
 * without declaring itself one (unit 0-1 and a position role), or if Copy
 * loses a field as sent. Today's motion-anomaly entry (the Neutrino fixture:
 * one field per meaning, the target in mm in the client frame, t_ms) and two
 * variants of it: the target sent normalized with and without a declared role.
 *
 * Run: node test/anomaly.test.mjs
 */
import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/catalog.js';
import { UNIT_ID } from '../../Valence/clients/js/index.js';
import { describeEvent, windowSpan, bodyRows } from '../src/model/anomaly.js';
import { ROLE } from '../src/model/roles.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (cond ? '' : '  -- ' + extra));
  if (!cond) fails++;
};

const today = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/neutrino-catalog.bin', import.meta.url))))
  .find((e) => e.role === 'events.anomaly');
const ev = (kind, body) => ({ channel: today.id, kind, body });

const withTarget = (over) => ({ ...today, schema: today.schema.map((f) => (f.name === 'target' ? { ...f, ...over } : f)) });
// A declaration that sends the target normalized 0-1 against the window, roled.
const declaredNorm = withTarget({ unit: 'norm', unitId: UNIT_ID.normalized });
// The same with no unit id and no role: nothing says it is a position.
const undeclaredNorm = withTarget({ unit: 'norm', unitId: null, role: undefined });
const win = { name: 'w', channelId: 1, unit: 'mm', unitId: UNIT_ID.mm, step: 1 };
const model = { byRole: new Map([[ROLE.windowMin, [{ ...win, name: 'lo' }]], [ROLE.windowMax, [{ ...win, name: 'hi' }]]]) };
const span = windowSpan(model, { 1: { lo: 0, hi: 500 } });

console.log('window');
ok('the reported window is the span', span && span.lo === 0 && span.hi === 500);
ok('an unreported end gives no span', windowSpan(model, { 1: { lo: 0 } }) === null);
ok('no catalog model gives no span', windowSpan(null, {}) === null);

console.log('\ntoday\'s catalog');
// The value-unit gap is a narrow no-break space on screen.
const sp = (d) => ({ ...d, text: d.text.replace(/ /g, ' '), rawText: d.rawText.replace(/ /g, ' ') });
const t = (e) => sp(describeEvent(e, today, span));
const q = (e) => t(e).text;
let d = t(ev(3, { kind: 3, seq: 18, target: 160, t_ms: 678397, kept: 72 }));
ok('the kind reads by its event_kinds label', d.text.startsWith('Knot trimmed'), d.text);
ok('a target declared in mm reads as sent, no window conversion', d.text === 'Knot trimmed · kept 72 % · at 160.00 mm', d.text);
ok('an id never joins the sentence', !/seq|18/.test(d.text), d.text);
ok('the hub time never joins the sentence', !/678|t ms/.test(d.text), d.text);
ok('Copy carries every field as sent', d.rawText === 'kind=3 seq=18 target=160.00 mm t_ms=678.397 s kept=72 %', d.rawText);
const stamp = d.facts.find((f) => f.display.endsWith(' s'));
ok('the stamp is labeled by what the catalog says it is, in seconds', stamp && stamp.display === '678.397 s' && stamp.label === 'Hub time of the event', JSON.stringify(d.facts));
ok('the detail list leads with the kind and its number', d.facts[0].label === 'Event kind' && d.facts[0].display === 'Knot trimmed (3)', JSON.stringify(d.facts[0]));
ok('an mm target outside the window is not clamped or scaled', q(ev(3, { target: 640 })).endsWith('at 640.00 mm'), q(ev(3, { target: 640 })));
ok('an mm target reads the same with no window reported', sp(describeEvent(ev(3, { target: 160 }), today, null)).text === 'Knot trimmed · at 160.00 mm');
ok('a ratio reads with its own unit', q(ev(6, { target: 160, ceiling_ratio: 12.64 })) === 'Piece over ceiling · ceiling ratio 12.64 x · at 160.00 mm', q(ev(6, { target: 160, ceiling_ratio: 12.64 })));
ok('an option field reads as its label', q(ev(5, { refusal: 1 })) === 'Knot refused · in the past', q(ev(5, { refusal: 1 })));
const settle = q(ev(1, { target: 76.74, v_end: -1170.95 }));
ok('a speed reads with its unit and sign', settle.startsWith('Settle · v end -1') && settle.endsWith('mm/s · at 76.74 mm'), settle);
ok('a zero float is a number, not an id', /^Settle · v end 0[.0]* mm\/s$/.test(q(ev(1, { v_end: 0 }))), q(ev(1, { v_end: 0 })));
const odd = t(ev(3, { detail: 0.72 }));
ok('a field the entry does not declare never joins the sentence, never a guessed meaning', odd.text === 'Knot trimmed', odd.text);
ok('Copy and the detail list carry an undeclared field raw', odd.rawText === 'detail=0.72' && odd.facts.some((f) => f.label === 'detail' && f.display === '0.72'), JSON.stringify(odd));
ok('an unlabeled kind reads as its decimal number', t(ev(9, {})).text === 'motion-anomaly kind 9', t(ev(9, {})).text);
ok('a kind label reads whatever the table says', describeEvent(ev(2, {}), { ...today, eventKinds: { 2: 'piece_over_ceiling' } }, span).text === 'Piece over ceiling');
ok('an event with no kind reads as the channel', describeEvent({ channel: 1, body: {} }, today, span).text === 'motion-anomaly');

console.log('\na target sent normalized');
const qn = (e, s = span) => sp(describeEvent(e, declaredNorm, s)).text;
ok('a declared normalized position becomes mm against the reported window', qn(ev(3, { target: 0.32, kept: 72 })) === 'Knot trimmed · kept 72 % · at 160 mm', qn(ev(3, { target: 0.32, kept: 72 })));
ok('a declared normalized position with no window stays norm', qn(ev(3, { target: 0.32 }), null) === 'Knot trimmed · target 0.32 norm', qn(ev(3, { target: 0.32 }), null));
ok('a normalized position outside the window reads outside it', qn(ev(3, { target: 1.2 })).endsWith('at 600 mm'), qn(ev(3, { target: 1.2 })));
const un = sp(describeEvent(ev(3, { target: 0.3 }), undeclaredNorm, span)).text;
ok('a norm position with no declared role stays norm and says so', un === 'Knot trimmed · target 0.30 norm', un);

console.log('\nbody roles bind within the entry (RFC-122)');
{
  ok('a row carries its field role; an unroled field carries none',
    bodyRows(ev(3, { target: 160, kept: 1 }), today).map((r) => r.role).join() === ROLE.telemetryTarget + ',');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
