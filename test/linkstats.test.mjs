/**
 * linkstats.test.mjs -- machine.stats.link's pure half (src/model/linkstats.js):
 * the client's rolling loss window, the hub half found by role, and the step that
 * joins both sources, null wherever a number is unknown.
 * Run: node test/linkstats.test.mjs
 */
import { WINDOW, blankLink, createLinkStats, lossWindow, machineLink } from '../src/model/linkstats.js';
import { ROLE } from '../src/model/roles.js';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra !== undefined && !cond ? '  -- ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};

console.log('\n--- lossWindow ---');
{
  const w = lossWindow(3);
  ok('one sample is not a rate', w.push({ retrans: 5, sent: 100 }) === null);
  ok('2 resent of 100 sent is 2 %', w.push({ retrans: 7, sent: 200 }) === 2);
  ok('nothing sent in the window is null, not 0', lossWindow().push({ retrans: 0, sent: 0 }) === null);
  w.push({ retrans: 7, sent: 300 });
  w.push({ retrans: 7, sent: 400 });
  const v = w.push({ retrans: 7, sent: 500 });
  ok('the window forgets: the old resends slide out', v === 0, v);
  ok('counters going backwards restart the window (reboot, reconnect, wrap)', w.push({ retrans: 1, sent: 10 }) === null);
  ok('then it measures again', w.push({ retrans: 2, sent: 60 }) === 2);
  const s = lossWindow();
  s.push({ retrans: 0, sent: 100, scope: 'connection', unit: 'segments' });
  ok('a scope change restarts the window', s.push({ retrans: 50, sent: 5000, scope: 'system', unit: 'segments' }) === null);
  ok('null clears it', s.push(null) === null && s.push({ retrans: 0, sent: 1 }) === null);
  const big = lossWindow(2);
  big.push({ retrans: 0, sent: 10 });
  ok('never above 100 %', big.push({ retrans: 50, sent: 20 }) === 100);
  ok('ten samples a window by default', WINDOW === 10);
}

console.log('\n--- machineLink ---');
const model = {
  byRole: new Map([
    [ROLE.linkResent, [{ channelId: 6, name: 'a' }]],
    [ROLE.linkRetries, [{ channelId: 6, name: 'b' }]],
    [ROLE.linkRssi, [{ channelId: 6, name: 'c' }]],
  ]),
};
{
  const r = machineLink(model, { 6: { a: 1.25, b: 7.5, c: -61 } });
  ok('found by role, decoded percent and dBm', r.lossPct === 1.25 && r.retryPct === 7.5 && r.rssiDbm === -61, r);
  const none = machineLink(model, { 6: { a: 655.35, b: 655.35, c: 0 } });
  ok('the no-reading values read null (65535 at scale 100, rssi 0)', none.lossPct === null && none.retryPct === null && none.rssiDbm === null, none);
  ok('0 % is a real reading', machineLink(model, { 6: { a: 0, b: 0, c: -50 } }).lossPct === 0);
  const absent = machineLink({ byRole: new Map() }, {});
  ok('a hub without the roles (wired, BLE-only, older) reads all null', absent.lossPct === null && absent.retryPct === null && absent.rssiDbm === null, absent);
  ok('no catalog yet reads all null', machineLink(null, {}).lossPct === null);
  ok('no sample yet reads null', machineLink(model, {}).lossPct === null);
}

console.log('\n--- createLinkStats ---');
{
  ok('blank: every number null', JSON.stringify(blankLink()) === JSON.stringify({ clientLossPct: null, clientScope: null, clientUnit: null, machine: { lossPct: null, retryPct: null, rssiDbm: null } }));
  const ls = createLinkStats();
  const c0 = { retrans: 0, sent: 1000, scope: 'system', unit: 'segments' };
  const m = { lossPct: 2, retryPct: null, rssiDbm: -70 };
  let r = ls.step(c0, m);
  ok('first tick: no client rate yet, the hub half at once', r.clientLossPct === null && r.machine.lossPct === 2 && r.machine.rssiDbm === -70, r);
  ok('a scope is only claimed with a number', r.clientScope === null && r.clientUnit === null);
  r = ls.step({ ...c0, retrans: 10, sent: 2000 }, m);
  ok('client 10 of 1000 is 1 %, labeled system segments', r.clientLossPct === 1 && r.clientScope === 'system' && r.clientUnit === 'segments', r);
  r = ls.step(null, m);
  ok('no client source: client null, hub half kept', r.clientLossPct === null && r.clientScope === null && r.machine.lossPct === 2, r);
  r = ls.step(null, null);
  ok('no hub half: every machine number null', r.machine.lossPct === null && r.machine.retryPct === null && r.machine.rssiDbm === null, r);
  ls.reset();
  r = ls.step({ ...c0, retrans: 10, sent: 3000 }, m);
  ok('after reset the client window starts over', r.clientLossPct === null, r);
}

console.log('\n--- machine.svelte.js wiring ---');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/model/machine.svelte.js', import.meta.url), 'utf8');
  ok('the tick lives inside an effect gated on live, cleared on the way out',
    /\$effect\(\(\) => \{\s*if \(machine\.link\.phase !== 'live'\) return;[\s\S]*?setInterval\(\(\) => linkTick\(s\), LINK_TICK_MS\);[\s\S]*?clearInterval\(timer\);[\s\S]*?machine\.stats\.link = blankLink\(\);/.test(src));
  ok('blankStats carries the blank link', /link: blankLink\(\),/.test(src));
  ok('only the webview\'s own socket asks the OS', /!_lastOpts\.WebSocketImpl && !_lastOpts\.virtual/.test(src));
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
