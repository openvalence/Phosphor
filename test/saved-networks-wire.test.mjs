/**
 * saved-networks-wire.test.mjs -- the pure rules of the saved-networks card (RFC-116 draft): the
 * credential rules, the list read with names paired by generation, each refusal's words.
 * Run: node test/saved-networks-wire.test.mjs
 */
import { DRAFT, passphraseProblem, ssidProblem, readList, occupancy, refusalWords, isConflict, slotOf } from '../plugins/factory/saved-networks/wire.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

ok('an open network and an 8-char passphrase pass', passphraseProblem('') === '' && passphraseProblem('12345678') === '');
ok('63 printable ASCII passes, 64 of them does not', passphraseProblem('a'.repeat(63)) === '' && passphraseProblem('g'.repeat(64)) !== '');
ok('64 hex digits pass; 64 with a non-hex does not', passphraseProblem('0'.repeat(64)) === '' && passphraseProblem('0'.repeat(63) + 'g') !== '');
ok('7 characters and non-ASCII fail', passphraseProblem('1234567') !== '' && passphraseProblem('pässword1') !== '');
ok('a name is 1 to 32 bytes of UTF-8', ssidProblem('') !== '' && ssidProblem('a'.repeat(32)) === '' && ssidProblem('a'.repeat(33)) !== '' && ssidProblem('é'.repeat(17)) !== '');

const wrap = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));
const read = (f) => f.v;
const nets = (generation, over = {}) => wrap({ generation, capacity: 4, count: 2, live: 0, rssi0: -42, rssi1: -128, rssi2: -128, rssi3: -128, ...over });
const names = (generation, over = {}) => wrap({ generation, open: 0b10, ssid0: 'virtual', ssid1: 'cafe', ssid2: '', ssid3: '', ...over });

const paired = readList(nets(7), names(7), read);
ok('equal generations: names, open bits, signal and the live entry',
  paired.named && paired.generation === 7 && paired.entries.length === 2 && paired.entries[0].live && paired.entries[0].rssi === -42
  && paired.entries[1].rssi === null && paired.entries[1].open === true && paired.entries[0].ssid === 'virtual', paired);

const ahead = readList(nets(8, { count: 1 }), names(7), read, paired);
ok('generations differ: the last matched list stays whole', ahead === paired);
ok('generations differ with none held: counts only, no names', !readList(nets(8), names(7), read, null).named);
const bare = readList(nets(7), null, read);
ok('below configure there are no names and the occupancy reads', !bare.named && bare.entries[0].ssid === null && occupancy(bare) === '2 of 4 saved', bare);
ok('no networks sample yet: the held list, or null', readList(wrap({}), null, read, null) === null && readList(wrap({}), null, read, paired) === paired);
ok('names without a sample (no generation) read as counts only', !readList(nets(7), wrap({}), read, null).named);
ok('a newer matched pair replaces the held list', readList(nets(8, { count: 1 }), names(8), read, paired).count === 1);

ok('an entry is found again by name, not by slot', slotOf(paired, 'cafe') === 1 && slotOf(paired, 'gone') === -1 && slotOf(bare, 'cafe') === -1);

ok('refusals read in words',
  refusalWords({ code: DRAFT.nack.liveNetwork }) === 'Hub is connected through this network'
  && refusalWords({ code: 0x300, detail: 'list changed' }) === 'List changed, check and retry'
  && refusalWords({ code: 0x302, detail: 'list full' }) === 'List full'
  && refusalWords({ code: 0x302, detail: 'duplicate ssid' }) === 'Already saved'
  && refusalWords({ code: 0x302, detail: 'slot' }) === 'No such slot' && refusalWords({ code: 0x302, detail: 'to' }) === 'No such slot'
  && refusalWords({ code: 0x302, detail: 'ssid length' }) === ssidProblem('')
  && refusalWords({ code: 0x302, detail: 'passphrase' }) === passphraseProblem('x')
  && refusalWords({ code: 0x201 }) === 'Needs configure access'
  && refusalWords({ ok: true }) === '' && refusalWords({ ok: false, error: 'no link' }) === 'no link');
ok('only a CONFLICT refusal retries', isConflict({ ok: false, code: 0x300 }) && !isConflict({ ok: false, code: 0x302 }) && !isConflict({ ok: true }));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
