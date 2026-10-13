// ble-setup.test.mjs -- the "Set up a machine" flow (src/shell/ble-setup.js)
// against a fake session, a fake clock and fake transports; no radio, no hub.
// Credentials never appear: the flow only sees the wizard's reported result.
// Run: node test/ble-setup.test.mjs

import assert from 'node:assert/strict';
import { ACCESS, NACK } from '../../Valence/clients/js/index.js';
import { PAIRING_EVENT_KIND } from '../../Valence/clients/js/frames.js';
import { CORE_CHANNEL } from '../../Valence/clients/js/generated/registry_vocab.js';
import {
  createSetupFlow, needsSetup, setupFirst, SETUP, ASK_EXPIRE_MS, ASK_GRACE_MS, HANDOVER_MS,
} from '../src/shell/ble-setup.js';
import { joinFailure } from '../src/model/provision.js';

const ME = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const RIVAL_A = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 1]);
const RIVAL_B = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 2]);
const TOKEN = new Uint8Array(16).fill(7);

function fakeSession() {
  const handlers = {};
  return {
    origin: { host: 'AA:BB:CC:DD:EE:FF', port: 82 },
    asks: [],
    open: true,
    on(name, fn) { (handlers[name] ||= new Set()).add(fn); return () => handlers[name].delete(fn); },
    emit(name, ...a) { for (const fn of [...(handlers[name] || [])]) fn(...a); },
    sendPairReq(o) { this.asks.push(o); return this.open; },
  };
}

function fakeClock() {
  let t = 0;
  let q = [];
  return {
    now: () => t,
    after(ms, fn) { const e = { at: t + ms, fn }; q.push(e); return () => { q = q.filter((x) => x !== e); }; },
    // Fires due callbacks in order, yielding to the event loop so awaited
    // transports settle between timer ticks.
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await new Promise((r) => setImmediate(r));
        const next = q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        q = q.filter((e) => e !== next);
        t = next.at;
        next.fn();
      }
      t = end;
      await new Promise((r) => setImmediate(r));
    },
  };
}

function rig(over = {}) {
  const clock = fakeClock();
  const session = fakeSession();
  const steps = [];
  const tokens = [];
  const deps = {
    clock,
    instanceId: ME,
    onChange: (s) => steps.push(s.step),
    setToken: (origin, token) => tokens.push({ origin, token }),
    reach: async () => true,
    connect: async () => true,
    hubId: () => 'abcd',
    ...over,
  };
  const flow = createSetupFlow(deps);
  return { clock, session, steps, tokens, flow, deps };
}

const pairEvt = (kind, id, role = ACCESS.configure) => ({
  channel: CORE_CHANNEL.pairing_events, kind, body: { instance_id: id, role },
});

// ---- the hub list's mark and order ----------------------------------------
assert.equal(needsSetup({ pairing: false, ws: false, configMode: true }), true, 'config mode');
assert.equal(needsSetup({ pairing: false, ws: false, configMode: false }), true, 'RFC-117: no WS, no config mode');
assert.equal(needsSetup({ pairing: false, ws: true, configMode: false }), false);
assert.equal(needsSetup({ configMode: false }), false, 'ws unknown is not offline');
assert.equal(needsSetup(null), false, 'an unread scan response is unknown, not offline');
const flagsOf = (d) => d.adv;
const scan = [{ n: 'a', adv: { ws: true } }, { n: 'b', adv: { ws: false } }, { n: 'c', adv: null }, { n: 'd', adv: { configMode: true, ws: false } }];
assert.deepEqual(setupFirst(scan, flagsOf).map((d) => d.n), ['b', 'd', 'a', 'c'], 'needs-setup first, order kept');

// ---- config mode: the window is open, the grant is immediate ---------------
{
  const { session, flow, steps, tokens } = rig();
  flow.attach(session);
  assert.deepEqual(session.asks, [{ role: ACCESS.configure }], 'a bare ask naming configure');
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  assert.deepEqual(steps, ['asking', 'granted'], 'no press prompt on an immediate grant');
  assert.equal(tokens.length, 1, 'the token is persisted for the BLE origin');
  assert.deepEqual(tokens[0].origin, session.origin);
}

// ---- offline hub: pending, then the owner presses Pair once ---------------
{
  const { session, flow, clock, steps } = rig();
  flow.attach(session);
  await clock.advance(ASK_GRACE_MS + 10);
  assert.equal(flow.state.step, SETUP.waiting);
  assert.equal(flow.state.text, 'Press Pair on the machine');
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.knocked, ME));
  assert.equal(flow.state.step, SETUP.waiting, 'own knocked event keeps waiting');
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  assert.equal(flow.state.step, SETUP.granted);
  assert.deepEqual(steps.filter((s, i) => s !== steps[i - 1]), ['asking', 'waiting', 'granted']);
  await clock.advance(ASK_EXPIRE_MS * 2);
  assert.equal(flow.state.step, SETUP.granted, 'a grant cancels the expiry');
}

// ---- ask expiry: say so, offer to ask again --------------------------------
{
  const { session, flow, clock } = rig();
  flow.attach(session);
  await clock.advance(ASK_EXPIRE_MS + 10);
  assert.equal(flow.state.step, SETUP.failed);
  assert.equal(flow.state.reason, 'expired');
  assert.equal(flow.state.text, 'Ask expired');
  assert.equal(flow.state.retry, 'ask');
  assert.equal(flow.retry(), 'ask');
  assert.equal(session.asks.length, 2, 'asking again sends a second ask');
  assert.equal(flow.state.step, SETUP.asking);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  assert.equal(flow.state.step, SETUP.granted);
}
{
  const { session, flow, clock } = rig();
  flow.attach(session);
  await clock.advance(ASK_GRACE_MS + 10);
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.expired, ME));
  assert.equal(flow.state.reason, 'expired', 'the hub expiring the ask ends it too');
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  assert.equal(flow.state.step, SETUP.granted, 'a late grant is still the answer');
}

// ---- several asks pending: the hub refuses the press ----------------------
{
  const { session, flow, clock } = rig();
  flow.attach(session);
  await clock.advance(ASK_GRACE_MS + 10);
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.knocked, RIVAL_A));
  assert.equal(flow.state.blocked, true);
  assert.match(flow.state.text, /Another ask is pending/);
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.knocked, RIVAL_B));
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.denied, RIVAL_A));
  assert.equal(flow.state.blocked, true, 'one rival still pending');
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.expired, RIVAL_B));
  assert.equal(flow.state.blocked, false);
  assert.equal(flow.state.text, 'Press Pair on the machine', 'the prompt returns once no rival is left');
  session.emit('event', pairEvt(PAIRING_EVENT_KIND.knocked, RIVAL_A, ACCESS.control));
  assert.equal(flow.state.blocked, false, 'a control ask is not a configure ask');
}

// ---- refusals and a lesser tier -------------------------------------------
{
  const { session, flow } = rig();
  flow.attach(session);
  session.emit('nack', { code: NACK.PAIRING_DENIED });
  assert.equal(flow.state.reason, 'denied');
  const b = rig();
  b.flow.attach(b.session);
  b.session.emit('pairGrant', { token: TOKEN, role: ACCESS.control });
  assert.equal(b.flow.state.reason, 'tier', 'control is not enough to provision');
  assert.equal(b.flow.state.text, 'Granted control, not configure');
  const c = rig();
  c.session.open = false;
  c.flow.attach(c.session);
  assert.equal(c.flow.state.reason, 'link', 'an ask that never left is a link fault');
  const d = rig();
  d.flow.attach(d.session);
  d.session.emit('close', { code: 1006 });
  assert.equal(d.flow.state.retry, 'connect', 'a dropped link is the host to reconnect');
}

// ---- NETWORK_JOIN_FAILED reasons in plain words ---------------------------
const WORDS = {
  auth: 'Wrong password',
  not_found: 'Network not found',
  no_address: 'Joined but got no address',
  timeout: 'Timed out',
  station_down: 'Radio not ready',
};
for (const [detail, text] of Object.entries(WORDS)) {
  const { session, flow } = rig();
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  flow.joinBegin();
  assert.equal(flow.state.step, SETUP.provisioning);
  await flow.joinResult({ ok: false, error: 'refused', code: NACK.NETWORK_JOIN_FAILED, detail });
  assert.equal(flow.state.step, SETUP.failed);
  assert.equal(flow.state.text, text, detail);
  assert.equal(flow.state.reason, detail);
  assert.equal(flow.state.retry, 'join');
  assert.equal(flow.retry(), 'join');
  assert.equal(flow.state.step, SETUP.granted, 'a failed join returns to the wizard');
}
assert.equal(joinFailure('Auth failed').text, 'Wrong password', 'matched inside a longer detail');
assert.equal(joinFailure('rejected by AP').reason, 'unknown', 'a word the table does not know');
assert.equal(joinFailure(null).text, 'Join failed');
{
  const { session, flow } = rig();
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  await flow.joinResult({ ok: false, error: 'refused: ACCESS_DENIED', code: NACK.ACCESS_DENIED });
  assert.equal(flow.state.text, 'Press Pair on the machine, then try again');
  assert.equal(flow.state.reason, 'access_denied');
  assert.equal(flow.state.retry, 'join');
  flow.retry();
  await flow.joinResult({ ok: false, error: 'no answer from the hub' });
  assert.equal(flow.state.text, 'No answer from the hub', 'a timeout with no NACK');
}

// ---- success: the endpoint is the handover target --------------------------
{
  const reached = [];
  const connected = [];
  const { session, flow, tokens, steps } = rig({
    reach: async (h, p) => { reached.push([h, p]); return true; },
    connect: async (t) => { connected.push(t); return true; },
  });
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  flow.joinBegin();
  await flow.joinResult({ ok: true, applied: { 1: 1, 2: true, 3: true, 4: 0xc0a80164, 5: 82 } });
  assert.deepEqual(connected, [{ host: '192.168.1.100', port: 82 }]);
  assert.deepEqual(reached, [['192.168.1.100', 82]]);
  assert.equal(flow.state.step, SETUP.done);
  assert.deepEqual(flow.state.target, { host: '192.168.1.100', port: 82 });
  assert.deepEqual(steps.filter((s, i) => s !== steps[i - 1]), ['asking', 'granted', 'provisioning', 'joined', 'handing-over', 'done']);
  assert.deepEqual(tokens.map((t) => t.origin), [session.origin, { host: '192.168.1.100', port: 82 }],
    'the token is also stored for the WS origin, so the WS session is configure too');
}

// ---- config-mode reboot: the endpoint is dead for a while ------------------
{
  let up = false;
  const calls = [];
  const { session, flow, clock } = rig({
    reach: async () => { calls.push(1); return up; },
    connect: async () => true,
  });
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  const p = flow.joinResult({ ok: true, applied: { 4: 0xc0a80164, 5: 82 } });
  await clock.advance(9000);
  assert.equal(flow.state.step, SETUP.handingOver, 'still retrying while the hub reboots');
  assert.ok(calls.length >= 4, 'retried, not one probe: ' + calls.length);
  up = true;
  await clock.advance(2000);
  await p;
  assert.equal(flow.state.step, SETUP.done);
}
{
  const { session, flow, clock } = rig({ reach: async () => false });
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  const p = flow.joinResult({ ok: true, applied: { 4: 0xc0a80164, 5: 82 } });
  await clock.advance(HANDOVER_MS + 5000);
  await p;
  assert.equal(flow.state.step, SETUP.failed, 'gives up after the window');
  assert.equal(flow.state.reason, 'handover');
  assert.equal(flow.state.retry, 'handover');
  assert.deepEqual(flow.state.target, { host: '192.168.1.100', port: 82 });
}

// ---- discovery by hub_instance_id when the address is wrong or absent ------
{
  const moved = { host: '192.168.1.222', port: 82 };
  const connected = [];
  const { session, flow, clock, tokens } = rig({
    reach: async (h) => h === moved.host,
    connect: async (t) => { connected.push(t); return true; },
    rediscover: async (id) => (id === 'abcd' ? moved : null),
  });
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  const p = flow.joinResult({ ok: true, applied: { 4: 0xc0a80164, 5: 82 } });
  await clock.advance(10000);
  await p;
  assert.deepEqual(connected, [moved], 'the discovered endpoint, not the stale one');
  assert.equal(flow.state.step, SETUP.done);
  assert.ok(tokens.some((t) => t.origin.host === moved.host), 'the token follows the discovered endpoint');
}
{
  const connected = [];
  const { session, flow, clock } = rig({
    reach: async () => true,
    connect: async (t) => { connected.push(t); return true; },
    rediscover: async () => ({ host: '10.0.0.9', port: 82 }),
  });
  flow.attach(session);
  session.emit('pairGrant', { token: TOKEN, role: ACCESS.configure });
  await flow.joinResult({ ok: true, applied: { 4: 0, 5: 0 } });
  assert.deepEqual(connected, [{ host: '10.0.0.9', port: 82 }], 'no reported endpoint: discovery only');
  void clock;
}

console.log('PASS -- ble-setup: grant paths, expiry, rival asks, join and access refusals in words, handover with retry');
