/**
 * saved-networks-wire.test.mjs -- the pure rules of the saved-networks card (RFC-116 draft): the
 * credential rules, the list read with names paired by generation, each refusal's words; the RFC-118 draft
 * visible list (detection, the two halves joined by scan counter, the connected row first, saved marks).
 * Run: node test/saved-networks-wire.test.mjs
 */
import { DRAFT, SPEC, passphraseProblem, ssidProblem, readList, occupancy, refusalWords, isConflict, slotOf, scanSupported, scanRefusal, joinWords, readVisible, scanOf, isInterlock, bars } from '../plugins/factory/saved-networks/wire.js';

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

// ---- RFC-118 draft: the visible networks ----
const op = (opts) => ({ options: opts });
const OPS = ['reserved', 'wifi_join', 'save', 'remove', 'move', 'scan'];
ok('detection: scan in the op select AND the visible channel declared',
  scanSupported(op(OPS), { vis: {} }) && !scanSupported(op(OPS.slice(0, 5)), { vis: {} }) && !scanSupported(op(OPS), { vis: null }) && !scanSupported(null, { vis: {} }));
ok('the claim takes the provisioning op by role and both halves', SPEC.optional.op === 'action.provision'
  && SPEC.optionalChannels.vis === 0x19 && SPEC.optionalChannels.more === 0x1a && SPEC.channels.nets === DRAFT.channels.networks);

const half = (scan, rows, over = {}) => {
  const o = { scan, count: rows.length, secured: 0, saved: 0 };
  rows.forEach(([ssid, rssi, sec, sav], i) => { o['ssid' + i] = ssid; o['rssi' + i] = rssi; if (sec) o.secured |= 1 << i; if (sav) o.saved |= 1 << i; });
  return wrap({ ...o, ...over });
};
const first = [['virtual', -42, 1, 1], ['Workshop', -48, 1, 0], ['Workshop-Lab', -55, 1, 0], ['Guest', -61, 0, 0], ['Neighbor', -67, 1, 0], ['Printer-Direct', -72, 1, 0], ['Cafe', -75, 0, 0]];
const second = [['Upstairs', -78, 1, 0], ['Linksys', -83, 1, 0], ['Garage', -88, 1, 0]];
const liveList = readList(nets(7, { count: 1 }), names(7, { ssid1: '' }), read);
const fv = { vis: half(3, first), more: half(3, second) };
const vis = readVisible(fv, read, liveList);
ok('matching halves join: 10 rows, the connected one first and saved', vis.length === 10 && vis[0].ssid === 'virtual' && vis[0].connected && vis[0].saved
  && vis[3].ssid === 'Guest' && !vis[3].secured && vis[9].ssid === 'Garage' && vis[1].secured && !vis[1].saved, vis);
ok('halves of different scans: the first half only', readVisible({ vis: half(4, first), more: half(3, second) }, read, liveList).length === 7);
ok('scan 0 (none yet): no rows, the connected network still shows', (() => { const r = readVisible({ vis: half(0, []), more: null }, read, liveList); return r.length === 1 && r[0].connected && r[0].ssid === 'virtual'; })());
ok('the connected network the scan missed leads the list', (() => { const r = readVisible({ vis: half(5, first.slice(1)) }, read, liveList); return r[0].ssid === 'virtual' && r[0].connected && r.length === 7; })());
ok('a saved name marks its row before the next scan does', readVisible({ vis: half(5, [['cafe', -70, 1, 0]]) }, read, readList(nets(7), names(7), read))
  .find((r) => r.ssid === 'cafe').saved);
ok('no visible sample: null; the counter reads', readVisible({ vis: wrap({}) }, read) === null && scanOf(fv, read) === 3 && scanOf({ vis: null }, read) === null);
ok('bars from dBm', bars(-42) === 4 && bars(-61) === 3 && bars(-75) === 2 && bars(-88) === 1 && bars(-128) === 0 && bars(undefined) === 0);
ok('a scan refused INTERLOCK in motion reads as the machine moving', scanRefusal({ ok: false, code: 0x402, detail: 'motion running' }) === 'Machine is moving'
  && isInterlock({ ok: false, code: 0x402 }) && !isInterlock({ ok: false, code: 0x100 }) && !isInterlock({ ok: true }));
ok('a scan counter that wrapped to 0 still lists its rows (equality, not order)', readVisible({ vis: half(0, first.slice(0, 2)), more: null }, read, null).length === 2);
ok('join refusals: the shell words, a bad passphrase as the rule', joinWords({ ok: false, code: 0x304, error: 'Wrong password' }) === 'Wrong password'
  && joinWords({ ok: false, code: 0x302, detail: 'passphrase length' }) === passphraseProblem('x') && joinWords({ ok: false }) === 'Join failed');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
