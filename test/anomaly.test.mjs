/**
 * anomaly.test.mjs -- a device EVENT in plain words from its own catalog entry
 * (src/model/anomaly.js, ph- Anomalies pane).
 *
 * Fails if a kind stops reading by its event_kinds label, if a sentence ever
 * needs a kind table or a field name, if a normalized position becomes mm
 * without declaring itself one (unit 0-1 and a position role), or if Copy
 * loses a field as sent. Two catalogs: today's motion-anomaly entry (the
 * Neutrino fixture) and the same entry with per-meaning fields declared.
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

// The same entry as a firmware declares it with one field per meaning: the target in mm, the client frame (RFC-122).
const field = (key, name, typeName, extra) => ({ key, name, typeName, unit: '', desc: '', ...extra });
const declared = {
  ...today,
  schema: [
    ...today.schema.map((f) => (f.name === 'target' ? { ...f, unit: 'mm', unitId: UNIT_ID.mm, role: ROLE.telemetryTarget } : f)),
    field(6, 'kept', 'f32_t', { unit: '%', unitId: UNIT_ID.percent, step: 1 }),
    field(7, 'ceiling_ratio', 'f32_t', { unit: 'x' }),
    field(8, 'refusal', 'uint_t', { options: ['non-finite', 'in the past', 'timeline full'] }),
  ],
};
// A declaration that still sends the target normalized 0-1 against the window.
const declaredNorm = { ...declared, schema: declared.schema.map((f) => (f.name === 'target' ? { ...today.schema.find((t) => t.name === 'target'), unitId: UNIT_ID.normalized, role: ROLE.telemetryTarget } : f)) };
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
let d = t(ev(3, { kind: 3, seq: 18, target: 0.3, detail: 0.72, t_us: 678397000 }));
ok('the kind reads by its event_kinds label', d.text.startsWith('Knot trimmed'), d.text);
ok('a norm position with no declared role stays norm and says so', d.text.includes('target 0.30 norm') && !d.text.includes(' mm'), d.text);
ok('an undeclared detail stays raw, never a guessed meaning', d.text.includes('detail 0.72'), d.text);
ok('an id never joins the sentence', !/seq|18/.test(d.text), d.text);
ok('a zero float is a number, not an id', t(ev(1, { detail: 0 })).text === 'Settle · detail 0.00', t(ev(1, { detail: 0 })).text);
ok('Copy carries every field as sent', d.rawText === 'kind=3 seq=18 target=0.30 norm detail=0.72 t_us=678.3970 s', d.rawText);
const stamp = d.facts.find((f) => f.label === 'Motion core time of the event');
ok('the stamp is labeled by what the catalog says it is, in seconds', stamp && stamp.display === '678.397 s', JSON.stringify(d.facts));
ok('the detail list leads with the kind and its number', d.facts[0].label === 'Event kind' && d.facts[0].display === 'Knot trimmed (3)', JSON.stringify(d.facts[0]));
ok('an unlabeled kind reads as its decimal number', t(ev(9, {})).text === 'motion-anomaly kind 9', t(ev(9, {})).text);
ok('a kind label reads whatever the table says', describeEvent(ev(2, {}), { ...today, eventKinds: { 2: 'piece_over_ceiling' } }, span).text === 'Piece over ceiling');
ok('an event with no kind reads as the channel', describeEvent({ channel: 1, body: {} }, today, span).text === 'motion-anomaly');

console.log('\nper-meaning fields declared');
const q = (e) => sp(describeEvent(e, declared, span)).text;
const qn = (e) => sp(describeEvent(e, declaredNorm, span)).text;
ok('a target declared in mm reads as sent, no window conversion', q(ev(3, { target: 160, kept: 72 })) === 'Knot trimmed · kept 72 % · at 160.00 mm', q(ev(3, { target: 160, kept: 72 })));
ok('an mm target outside the window is not clamped or scaled', q(ev(3, { target: 640 })).endsWith('at 640.00 mm'), q(ev(3, { target: 640 })));
ok('an mm target reads the same with no window reported', sp(describeEvent(ev(3, { target: 160 }), declared, null)).text === 'Knot trimmed · at 160.00 mm');
console.log('  a declaration that still sends it normalized');
ok('a declared normalized position becomes mm against the reported window', qn(ev(3, { target: 0.32, kept: 72 })) === 'Knot trimmed · kept 72 % · at 160 mm', q(ev(3, { target: 0.32, kept: 72 })));
ok('a declared normalized position with no window stays norm', sp(describeEvent(ev(3, { target: 0.32 }), declaredNorm, null)).text === 'Knot trimmed · target 0.32 norm');
ok('a ratio reads with its own unit', q(ev(6, { target: 160, ceiling_ratio: 12.64 })) === 'Piece over ceiling · ceiling ratio 12.64 x · at 160.00 mm', q(ev(6, { target: 160, ceiling_ratio: 12.64 })));
ok('an option field reads as its label', q(ev(5, { refusal: 1 })) === 'Knot refused · in the past', q(ev(5, { refusal: 1 })));
ok('a normalized position outside the window reads outside it', qn(ev(3, { target: 1.2 })).endsWith('at 600 mm'), qn(ev(3, { target: 1.2 })));

console.log('\nbody roles bind within the entry (RFC-122)');
{
  ok('a row carries its field role; an unroled field carries none',
    bodyRows(ev(3, { target: 160, detail: 1 }), declared).map((r) => r.role).join() === ROLE.telemetryTarget + ',');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
