/**
 * plugins.test.mjs — the tier-2 plugin host, with no device and no browser.
 *
 * Loads both example plugins through the SAME host and the SAME claim loop
 * the app uses (src/plugins/host.js, roles.js claimAll) against the real
 * fixture catalog, and asserts:
 *   (a) the widget plugin's hero claims its fields by role;
 *   (b) a throwing plugin does not take the kernel down, and its claims fall
 *       back to the generic renderer;
 *   (c) the API object a plugin gets has no session/socket/transport handle,
 *       and its gated methods refuse undeclared permissions;
 *   (d) the TCode parser maps L0 lines to normalized samples, and a line
 *       arriving over the (fake) listener reaches submitMotion;
 *   (e) submitMotion's router sends a samples STREAM when the catalog has one
 *       and the hub grants it, and the command.position setpoint otherwise;
 *   (e2) the segments lookahead door: latch, role lookup, shared lazy grant,
 *       hub-time stamps less the declared latency, late clip, the 10 ms floor,
 *       the 100 us grid, half the horizon (250, 500, 1000); streamGate's
 *       order and railOwners;
 *   (g) every factory plugin validates and activates; Advanced Penetration
 *       substitutes both pattern built-ins on the recorded catalog
 *       (RENDERING §10.2) and every way it can fail (a missing essential
 *       role, advgen.running included, a mount that throws, disabled) leaves the
 *       built-ins to claim; advgen.mode stays generic (RFC-093);
 *   (h) the editor geometry: speed and accel to half width and curvature and
 *       back, handle position to field value on the step grid and bounds;
 *       the speed link's rescale, span and partner rounding; label placement
 *       clear of a line and of a neighbor;
 *   (i) the producer lock: another plugin's motion is refused until the
 *       holder's last sent segment ends plus MOTION_HOLD_MS, and its gate
 *       says so;
 *   (j) net.fetch: the permission, http(s) only, the hub's origins refused,
 *       init passed through; the shell's CSP and http capability, read
 *       statically (the real shell verifies them, C-8).
 *
 * Run: node test/plugins.test.mjs
 */

import { readFileSync } from 'node:fs';
import { decodeCatalog, CHANNEL_CLASS, STREAM_KIND, UNIT_ID, LIMITS, PublishError, CH_CONTROL_OWNER } from '../../Valence/clients/js/index.js';
import { buildSettingsModel, reportedValue, placeableControls, minCells } from '../src/model/settings.js';
import { ROLE, claimAll, ADVGEN_SPEC } from '../src/model/roles.js';
import { motionTarget, createMotionDoor, bundleHead, recordBytes, motionStream, streamGate, filteredHubNowUs, CLOCK_KEEP, CLOCK_HUNT, CLOCK_HUNT_GAP_MS } from '../src/model/motion.js';
import { railOwners, railOwnerName } from '../src/model/actions.js';
import { createPluginHost, validateManifest, MOTION_HOLD_MS, isHubUrl } from '../src/plugins/host.js';
import * as gauge from '../plugins/examples/stroke-gauge/index.js';
import * as tcode from '../plugins/examples/tcode-adapter/index.js';
import { FACTORY } from '../src/plugins/factory.js';
import {
  snap, halfTime, speedInAt, speedOutAt, accelForEase, strokeGeom, strokeValue, onCurve, atDepth, stairGeom, stairValue,
  dwellAt, DWELL_CAP,
  linkedInAt, linkedOutAt, linkSpan, linkPartner, linkRescale, placeLabels, densify,
} from '../plugins/factory/advanced-penetration/index.js';
import { advgenCatalog } from './fixtures/advgen-roles-catalog.mjs';

let fails = 0;
const ok = (name, cond, extra) => {
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
};
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

const entries = decodeCatalog(new Uint8Array(readFileSync(new URL('./fixtures/valencesim-catalog.bin', import.meta.url))));
const model = buildSettingsModel(entries);

function makeHost(over = {}) {
  const logs = [];
  const calls = { write: [], motion: [] };
  const deps = {
    model: () => model,
    sample: () => undefined,
    sampleAge: () => Infinity,
    display: (f, s) => reportedValue(f, s),
    status: () => 'confirmed',
    write: (f, v) => calls.write.push([f, v]),
    submitMotion: (n, d) => { calls.motion.push([n, d]); return { ok: true }; },
    registerTheme: () => {},
    listenTcp: null,
    prefs: null,
    log: (name, level, msg) => logs.push({ name, level, msg }),
    ...over,
  };
  return { host: createPluginHost(deps), logs, calls };
}

// ---- manifests ------------------------------------------------------------
console.log('manifests');
const gaugeManifest = json('../plugins/examples/stroke-gauge/manifest.json');
const tcodeManifest = json('../plugins/examples/tcode-adapter/manifest.json');
ok('stroke-gauge manifest validates', validateManifest(gaugeManifest).length === 0, validateManifest(gaugeManifest).join('; '));
ok('tcode-adapter manifest validates', validateManifest(tcodeManifest).length === 0, validateManifest(tcodeManifest).join('; '));
ok('unknown permission is rejected', validateManifest({ ...gaugeManifest, permissions: ['socket'] }).length === 1);
ok('wrong api version is rejected', validateManifest({ ...gaugeManifest, api: 2 }).length === 1);

// ---- (a) the widget plugin claims its fields ------------------------------
console.log('(a) widget plugin claims by role');
{
  const { host } = makeHost();
  host.add(gaugeManifest, gauge);
  const heroes = host.heroes();
  ok('one hero registered', heroes.length === 1 && heroes[0].id === 'plugin:stroke-gauge:gauge');
  ok('plugin heroes are card zone only', heroes.every((h) => h.zone === 'card'));
  const { widgets, claimed } = claimAll(model.byRole, heroes);
  const w = widgets[0];
  ok('the claim resolves against the fixture catalog', !!w);
  ok('pos is the telemetry.position field', w && w.fields.pos && w.fields.pos.role === ROLE.telemetryPosition);
  ok('optional window roles resolve too', w && w.fields.lo && w.fields.hi);
  ok('absorb:false binds without taking controls from the generic tree', w && !claimed.has(w.fields.lo.uid) && claimed.size === 0);
  host.setEnabled('stroke-gauge', false);
  ok('disabling drops the hero', host.heroes().length === 0);
  host.setEnabled('stroke-gauge', true);
  ok('re-enabling restores it', host.heroes().length === 1);
}

// ---- (b) a throwing plugin never breaks the kernel -------------------------
console.log('(b) throwing plugins are contained');
{
  const { host, logs } = makeHost();
  const boom = {
    activate(api) {
      api.registerHero({ id: 'x', spec: { require: { p: ROLE.telemetryPosition } }, mount() {} });
      throw new Error('boom in activate');
    },
  };
  let threw = false;
  try { host.add({ ...gaugeManifest, name: 'boom' }, boom); } catch (e) { threw = true; }
  ok('activate throw does not propagate', !threw);
  const rec = host.list().find((p) => p.name === 'boom');
  ok('plugin is marked error with the message', rec && rec.status === 'error' && /boom in activate/.test(rec.error));
  ok('its half-registered hero is rolled back', host.heroes().length === 0);
  ok('the error is logged under the plugin name', logs.some((l) => l.name === 'boom' && l.level === 'error'));

  const badMount = {
    activate(api) {
      api.registerHero({
        id: 'm', spec: { require: { p: ROLE.telemetryPosition } },
        mount() { throw new Error('boom in mount'); },
      });
    },
  };
  host.add({ ...gaugeManifest, name: 'badmount' }, badMount);
  host.add(gaugeManifest, gauge);
  const before = claimAll(model.byRole, host.heroes());
  const bad = before.widgets.find((w) => w.plugin === 'badmount');
  const inst = host.mountHero(bad, {}, bad.fields);
  ok('mount throw returns null, not an exception', inst === null);
  const after = claimAll(model.byRole, host.heroes());
  ok('the failed hero is dropped from the claim pass', !after.widgets.some((w) => w.plugin === 'badmount'));
  ok('a default hero absorbs its field; after the fault the field is generic again',
    before.claimed.has(bad.fields.p.uid) && !after.claimed.has(bad.fields.p.uid));
  ok('other plugins keep their heroes', after.widgets.some((w) => w.plugin === 'stroke-gauge'));

  const badUpdate = {
    activate(api) {
      api.registerHero({
        id: 'u', spec: { require: { p: ROLE.telemetryPosition } },
        mount() { return { update() { throw new Error('boom in update'); } }; },
      });
    },
  };
  host.add({ ...gaugeManifest, name: 'badupdate' }, badUpdate);
  const u = claimAll(model.byRole, host.heroes()).widgets.find((w) => w.plugin === 'badupdate');
  const ui = host.mountHero(u, {}, u.fields);
  let t2 = false;
  try { host.updateHero(ui); } catch (e) { t2 = true; }
  ok('update throw is contained and drops the hero', !t2 && !host.heroes().some((h) => h.plugin === 'badupdate'));

  host.add({ ...gaugeManifest, name: 'noentry' }, {});
  ok('a module without activate() is listed as an error', host.list().find((p) => p.name === 'noentry').status === 'error');
  host.add({ name: 'Bad Name!' }, gauge);
  ok('an invalid manifest is listed and never run', host.list().some((p) => p.status === 'invalid'));
}

// ---- (b2) plugin heroes are placeable controls (DESIGN §10.2, ph-e82.4) -------
console.log('(b2) plugin heroes place, resize and persist like any control');
{
  const { host } = makeHost();
  host.add(gaugeManifest, gauge);
  const sized = {
    activate(api) {
      api.registerHero({ id: 'dial', cells: { h: [5, 3], v: [3, 5] }, spec: { require: { p: ROLE.telemetryPosition } },
        absorb: false, mount() { return {}; } });
    },
  };
  host.add({ ...gaugeManifest, name: 'sized' }, sized);
  const ctls = placeableControls(model, { heroes: claimAll(model.byRole, host.heroes()).widgets });
  const g = ctls.find((c) => c.key === 'hero:plugin:stroke-gauge:gauge');
  ok('a plugin hero is placeable under its stable key hero:plugin:<name>:<id>', g && g.kind === 'plugin');
  ok('it is resizable: a minimum per orientation, the composite default when undeclared',
    g && minCells(g.cells, 'h').length === 2 && minCells(g.cells, 'v').length === 2);
  const d = ctls.find((c) => c.key === 'hero:plugin:sized:dial');
  ok('a declared footprint is honored', d && minCells(d.cells, 'v').join() === '3,5');
  ok('the key is the same on every pass, so a saved layout finds it again',
    placeableControls(model, { heroes: claimAll(model.byRole, host.heroes()).widgets })
      .some((c) => c.key === 'hero:plugin:stroke-gauge:gauge'));
  const badCells = { activate(api) { api.registerHero({ id: 'z', cells: { h: [0, 2] }, spec: {}, mount() {} }); } };
  host.add({ ...gaugeManifest, name: 'badcells' }, badCells);
  ok('malformed cells are refused at registration, never placed',
    host.list().find((p) => p.name === 'badcells').status === 'error'
      && !host.heroes().some((h) => h.plugin === 'badcells'));
  const throwing = { activate(api) { api.registerHero({ id: 't', spec: { require: { p: ROLE.telemetryPosition } },
    mount() { throw new Error('boom'); } }); } };
  host.add({ ...gaugeManifest, name: 'throwing' }, throwing);
  const t = claimAll(model.byRole, host.heroes()).widgets.find((w) => w.plugin === 'throwing');
  host.mountHero(t, {}, t.fields);
  const after = claimAll(model.byRole, host.heroes());
  ok('a throwing plugin hero leaves the palette and its field returns to the generic tree',
    !placeableControls(model, { heroes: after.widgets }).some((c) => c.key === 'hero:plugin:throwing:t')
      && !after.claimed.has(t.fields.p.uid));
}

// ---- (c) the API object has no transport handle -----------------------------
console.log('(c) the plugin API cannot reach the socket');
{
  const { host, calls } = makeHost();
  let api = null;
  host.add({ ...gaugeManifest, name: 'spy' }, { activate(a) { api = a; } });
  ok('plugin received an api', !!api);
  ok('api is frozen', Object.isFrozen(api) && Object.isFrozen(api.net) && Object.isFrozen(api.prefs));
  const FORBIDDEN = /session|socket|^ws$|transport|sendintent|sendframe|sendraw|websocket/i;
  const seen = new Set();
  const leaks = [];
  (function walk(o, path) {
    if (!o || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.getOwnPropertyNames(o)) {
      if (FORBIDDEN.test(k)) leaks.push(path + '.' + k);
      if (typeof o === 'object') walk(o[k], path + '.' + k);
    }
  })(api, 'api');
  ok('no session/socket/transport key anywhere in the api', leaks.length === 0, leaks.join(', '));
  let permErr = null;
  try { api.write(model.byRole.get(ROLE.windowMin)[0], 1); } catch (e) { permErr = e; }
  ok('write without "intent" permission throws PermissionError', permErr && permErr.name === 'PermissionError');
  let motErr = null;
  try { api.submitMotion(0.5, 100); } catch (e) { motErr = e; }
  ok('submitMotion without "motion" permission throws', motErr && motErr.name === 'PermissionError');
  ok('nothing reached the intent path', calls.write.length === 0 && calls.motion.length === 0);
  let netErr = null;
  await api.net.listenTcp(8000, () => {}).catch((e) => { netErr = e; });
  ok('listenTcp without a declared port throws', netErr && netErr.name === 'PermissionError');
}

// ---- (d) TCode L0 parsing and the adapter path ------------------------------
console.log('(d) TCode adapter');
{
  const p = tcode.parseL0;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok('L05 -> 0.5, no interval', eq(p('L05'), [{ pos: 0.5, durationMs: null }]));
  ok('L0500I100 -> 0.5 over 100 ms', eq(p('L0500I100'), [{ pos: 0.5, durationMs: 100 }]));
  ok('lowercase l09999i20 -> 0.9999 over 20 ms', eq(p('l09999i20\r'), [{ pos: 0.9999, durationMs: 20 }]));
  ok('L00 -> 0', eq(p('L00'), [{ pos: 0, durationMs: null }]));
  ok('other axes ignored, S suffix gives no duration', eq(p('R05 L02S100 V09'), [{ pos: 0.2, durationMs: null }]));
  ok('device commands and junk ignored', eq(p('D1'), []) && eq(p('DSTOP'), []) && eq(p('L0'), []) && eq(p('L0abc'), []) && eq(p(''), []));

  let onLine = null;
  let closed = 0;
  const { host, calls } = makeHost({
    listenTcp: async (port, fn) => { onLine = { port, fn }; return () => { closed++; }; },
  });
  host.add(tcodeManifest, tcode);
  await new Promise((r) => setTimeout(r, 0));
  ok('adapter listens on the manifest port (8000)', onLine && onLine.port === 8000);
  onLine.fn('L0250I200');
  ok('a TCP line reaches submitMotion with its duration, (0.25, 200)', eq(calls.motion, [[0.25, 200]]));
  host.setEnabled('tcode-adapter', false);
  ok('disabling closes the listener', closed >= 1);
}

// ---- motion target mapping (the model half of the adapter) ------------------
console.log('motion target');
{
  const lo = model.byRole.get(ROLE.windowMin)[0];
  const hi = model.byRole.get(ROLE.windowMax)[0];
  const samples = {};
  const r0 = motionTarget(model, samples, 0.5);
  ok('an unreported window yields no target (law 9)', r0.field === null && /window/.test(r0.reason));
  samples[lo.channelId] = { ...(samples[lo.channelId] || {}), [lo.name]: 20 };
  samples[hi.channelId] = { ...(samples[hi.channelId] || {}), [hi.name]: 120 };
  const r = motionTarget(model, samples, 0.25);
  ok('0.25 of a 20..120 window -> 45', r.field && r.field.role === ROLE.commandPosition && r.value === 45, String(r.value));
  ok('input is clamped to the window', motionTarget(model, samples, 7).value === 120);
}

// ---- (e) the motion door: STREAM when granted, setpoint otherwise ----------
console.log('(e) motion door routing');
{
  // Synthetic hub: names deliberately unlike any device's, so only class,
  // direction, stream_kind, role and unit can find the fields.
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const lay = (name, extra) => ({ name, type: 2, typeName: 'u16', scale: 10000, unitId: null, ...extra });
  const stream = (layout, kind = STREAM_KIND.samples) => ({
    id: 0x7000, cls: CHANNEL_CLASS.STREAM, dirName: 'c2h', streamKind: kind, maxRateHz: 100, layout,
  });
  function fakeSession({ grant = true } = {}) {
    const s = {
      sent: [], asked: [],
      state: { sessionId: 1, grantedPublishes: new Map() },
      hubNowUs: () => 1_000_000,
      publish(w) {
        s.asked.push(w);
        if (grant) s.state.grantedPublishes.set(w[0][0], { channel: w[0][0], rate: w[0][1] });
        return Promise.resolve(grant ? [{ channel: w[0][0], rate: w[0][1] }] : []);
      },
      publishSamples(ch, sample, o) { s.sent.push({ ch, sample, anchor: o.anchor }); return { seq: 0, n: 1 }; },
    };
    return s;
  }
  function door(entries, s) {
    const out = { set: [], log: [] };
    const d = createMotionDoor({
      session: () => s, entries: () => entries,
      setpoint: (n) => { out.set.push(n); return { ok: true }; },
      log: (level, msg) => out.log.push({ level, msg }),
    });
    return { d, out };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const s1 = fakeSession();
  const e1 = [stream([lay('a', { unitId: UNIT_ID.normalized, role: 'input.target' }), lay('b', { type: 3, typeName: 'i16', scale: 1000 })])];
  const { d: d1, out: o1 } = door(e1, s1);
  const first = d1(0.25, 200);
  ok('first input asks for the grant lazily and is held, not sent as a setpoint',
    !first.ok && s1.asked.length === 1 && s1.asked[0][0][0] === 0x7000 && s1.asked[0][0][1] === 100 && o1.set.length === 0);
  await tick();
  ok('granted: input rides publishSamples', d1(0.25, 200).ok && s1.sent.length === 1 && s1.sent[0].ch === 0x7000);
  ok('target by input.target carries the norm, the untagged i16 its unspecified sentinel (RFC-058/071)',
    eq(s1.sent[0].sample, { a: 0.25, b: LIMITS.segment_end_vel_unspecified / 1000 }));
  ok('duration becomes the anchor lead (hubNow + 200 ms)', s1.sent[0].anchor === 1_200_000);
  d1(0.5);
  ok('no duration: anchored at hubNow', s1.sent[1].anchor === 1_000_000);
  d1(2, 5000);
  ok('norm clamped to 1, lead capped at max_future_schedule_ms',
    s1.sent[2].sample.a === 1 && s1.sent[2].anchor === 1_000_000 + LIMITS.max_future_schedule_ms * 1000);
  ok('the live path is logged once', o1.log.filter((l) => /samples STREAM/.test(l.msg)).length === 1);

  const s0 = fakeSession();
  const { d: d0, out: o0 } = door([stream([lay('x', { unitId: UNIT_ID.normalized })])], s0);
  ok('unit normalized without input.target is not motion: setpoint, nothing asked',
    d0(0.4, 20).ok && eq(o0.set, [0.4]) && !s0.asked.length);

  const e2 = [stream([lay('x', { unitId: UNIT_ID.normalized }), lay('y', { unitId: UNIT_ID.normalized, role: 'input.target' })])];
  const s2 = fakeSession();
  const { d: d2 } = door(e2, s2);
  d2(0.4); await tick(); d2(0.4, 20);
  ok('the input.target field binds, an untagged unsigned field rides 0', eq(s2.sent[0].sample, { x: 0, y: 0.4 }));

  s2.publishSamples = () => { throw new PublishError('RATE_EXCEEDED', 0x7000, 'too fast'); };
  const { d: d2b, out: o2b } = door(e2, s2);
  const r1 = d2b(0.4, 20);
  d2b(0.4, 20);
  ok('a PublishError returns its code and is logged once per code',
    !r1.ok && r1.reason === 'RATE_EXCEEDED' && o2b.log.filter((l) => /RATE_EXCEEDED/.test(l.msg)).length === 1);

  const { d: d3, out: o3 } = door([stream([lay('a', { unitId: UNIT_ID.normalized })], STREAM_KIND.segments)], fakeSession());
  ok('no samples-kind STREAM: setpoint path, logged', d3(0.3, 100).ok && eq(o3.set, [0.3]) && /setpoint/.test(o3.log[0].msg));

  const s4 = fakeSession({ grant: false });
  const { d: d4, out: o4 } = door(e1, s4);
  d4(0.3); await tick();
  ok('hub grants nothing: setpoint path, logged', d4(0.6).ok && eq(o4.set, [0.6]) && /publish refused/.test(o4.log[0].msg));
  d4(0.7);
  ok('a refusal is asked once per session', s4.asked.length === 1);

  // ph-vdk.49 (RFC-087, RFC-059): timed input rides the segments STREAM,
  // stamped at hub now + the grant's schedule_latency_us, inside its horizon.
  const segLay = [lay('pos', { unitId: UNIT_ID.normalized, role: 'input.target' }),
    lay('len', { unitId: UNIT_ID.ms, role: 'input.duration', scale: 1 }),
    lay('ev', { type: 3, typeName: 'i16', scale: 1000, role: 'input.end_velocity' })];
  const both = [stream([lay('a', { unitId: UNIT_ID.normalized, role: 'input.target' })]),
    { ...stream(segLay, STREAM_KIND.segments), id: 0x7001 }];
  const s6 = fakeSession();
  s6.publish = (w) => {
    s6.asked.push(w);
    s6.state.grantedPublishes.set(w[0][0], { channel: w[0][0], rate: w[0][1], scheduleLatencyUs: 61000, scheduleHorizonMs: 500 });
    return Promise.resolve([{ channel: w[0][0] }]);
  };
  s6.publishSegment = (ch, segs, o) => { s6.sent.push({ ch, segs, anchor: o.anchor }); return { seq: 0, n: segs.length }; };
  const { d: d6, out: o6 } = door(both, s6);
  d6(0.6, 120); await tick();
  ok('a timed input asks for the segments STREAM', s6.asked[0][0][0] === 0x7001);
  ok('it rides publishSegment', d6(0.6, 120).ok && s6.sent.length === 1 && s6.sent[0].ch === 0x7001);
  ok('one segment: target, duration in the field unit, end velocity unspecified (RFC-058)',
    eq(s6.sent[0].segs, [{ pos: 0.6, len: 120, ev: LIMITS.segment_end_vel_unspecified / 1000 }]));
  ok('lead equals the grant\'s schedule_latency_us, no constant', s6.sent[0].anchor === 1_000_000 + 61000);
  ok('the path names the horizon and lead once', o6.log.filter((l) => /segments STREAM.*500 ms.*61000 us/.test(l.msg)).length === 1);
  d6(0.2); await tick();
  ok('an untimed point rides the samples STREAM', d6(0.2).ok && s6.sent.at(-1).ch === 0x7000);

  const recB = recordBytes(segLay);
  const segs = Array.from({ length: 80 }, (_, i) => ({ atUs: 1_000_000 + i * 10_000 }));
  let fine = true;
  for (const hz of [250, 500, 1000]) {
    let rest = segs, now = 1_000_000;
    while (rest.length) {
      const { head, rest: r } = bundleHead(rest, now, hz, recB);
      if (!head.length) { now += 10_000; continue; }
      if (head.length > LIMITS.bundle_max_samples || head.at(-1).atUs > now + hz * 1000
        || 6 + head.length * (2 + recB) > LIMITS.min_transport_payload) fine = false;
      rest = r;
    }
  }
  ok('bundles never pass the horizon, 32 records or one transport payload', fine);
  ok('a 1000 ms horizon fills a bundle to its payload cap',
    bundleHead(segs, 1_000_000, 1000, recB).head.length === Math.min(32, Math.floor((LIMITS.min_transport_payload - 6) / (2 + recB))));
  ok('a 250 ms horizon stops at the horizon', bundleHead(segs, 1_000_000, 250, recB).head.length === 26);

  // ph-vdk.42: the reported latch refuses every input and nothing leaves;
  // the door never resumes, so only the latch clearing lets input flow.
  let held = 'paused, resume to continue';
  const s5 = fakeSession();
  const set5 = [];
  const d5 = createMotionDoor({
    session: () => s5, entries: () => e1, log: () => {}, halted: () => held,
    setpoint: (n) => { set5.push(n); return { ok: true }; },
  });
  const r5 = d5(0.3, 50);
  ok('paused: refused with the reason, nothing asked, published or set',
    !r5.ok && r5.reason === held && !s5.asked.length && !s5.sent.length && !set5.length);
  held = '';
  d5(0.3); await tick();
  ok('after the operator resumes, input flows', d5(0.3, 50).ok && s5.sent.length === 1);
}

// ---- (e2) the lookahead door: submit.segments (ph-smvd.2, RFC-087, RFC-059) --
console.log('(e2) segments lookahead door, streamGate, railOwners');
{
  const segSt = motionStream(entries, STREAM_KIND.segments);
  const CH = segSt.entry.id;
  const [TN, DN, EV] = [segSt.target.name, segSt.duration.name,
    segSt.entry.layout.find((f) => f.role === 'input.end_velocity').name];
  const H = 50_000_000;            // hub now, us
  const UNIT = LIMITS.segment_t_off_unit_us;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  function fakeSeg({ grant = true, horizon = 250, latency = 1000 } = {}) {
    const s = {
      sent: [], asked: [], throwCode: '',
      state: { sessionId: 3, grantedPublishes: new Map() },
      hubNowUs: () => H,
      publish(w) {
        s.asked.push(w);
        return Promise.resolve().then(() => {
          if (!grant) return [];
          s.state.grantedPublishes.set(w[0][0], { channel: w[0][0], rate: w[0][1], scheduleLatencyUs: latency, scheduleHorizonMs: horizon });
          return [{ channel: w[0][0] }];
        });
      },
      publishSegment(ch, recs, o) {
        if (s.throwCode) throw new PublishError(s.throwCode, ch, 'test');
        s.sent.push({ ch, recs, anchor: o.anchor, offs: o.offsetsUs });
        return { seq: 0, n: recs.length };
      },
      publishSamples() { throw new Error('samples path used'); },
    };
    return s;
  }
  const T = 10_000;                // client now(), ms
  function segDoor(s, { ents = entries, halted = '', nacks = [] } = {}) {
    const out = { set: [], log: [] };
    const d = createMotionDoor({
      session: () => s, entries: () => ents, now: () => T, halted: () => halted,
      lastNack: (ch) => nacks.findLast((n) => n.channel === ch) || null,
      setpoint: (n) => { out.set.push(n); return { ok: true }; },
      log: (level, msg) => out.log.push({ level, msg }),
    });
    return { d, out };
  }
  const seg = (dt, dur, norm = 0.5) => ({ atMs: T + dt, norm, durationMs: dur });
  const starts = (b) => b.offs.map((o) => b.anchor + o);

  const sh = fakeSeg();
  ok('latched: refused with the latch words, nothing asked', (({ d }) => {
    const r = d.segments([seg(20, 100)]);
    return !r.ok && r.sent === 0 && r.reason === 'paused, resume to continue' && !sh.asked.length;
  })(segDoor(sh, { halted: 'paused, resume to continue' })));
  {
    const smpOnly = entries.filter((e) => e.id !== CH);
    const { d, out } = segDoor(fakeSeg(), { ents: smpOnly });
    const r = d.segments([seg(20, 100)]);
    ok('no segments STREAM: refused by name, never a samples or setpoint fallback',
      !r.ok && r.reason === 'hub has no segments STREAM' && !out.set.length);
  }
  ok('no session: not connected', (({ d }) => d.segments([seg(20, 100)]).reason === 'not connected')(segDoor(null)));

  const s1 = fakeSeg();
  const { d: d1, out: o1 } = segDoor(s1);
  d1(0.5, 100);
  const w = d1.segments([seg(20, 100)]);
  ok('the grant is shared with submit: one ask, the wish [ch, maxRateHz || 50]', !w.ok && w.reason === 'waiting for the stream grant'
    && s1.asked.length === 1 && s1.asked[0][0][0] === CH && s1.asked[0][0][1] === (segSt.entry.maxRateHz || 50));
  await tick();
  const e0 = d1.segments([]);
  ok('an empty list warms the grant: ok, sent 0, the rate, nothing published', e0.ok && e0.sent === 0 && e0.rateHz === s1.asked[0][0][1] && !s1.sent.length);
  ok('a bad segment is refused whole', ['atMs', 'norm'].every((k) => d1.segments([{ ...seg(20, 100), [k]: NaN }]).reason === 'bad segment')
    && d1.segments([seg(20, 0)]).reason === 'bad segment' && d1.segments([seg(60, 50), seg(20, 50)]).reason === 'bad segment'
    && !s1.sent.length);

  const r1 = d1.segments([seg(20, 100, 0.25), seg(120, 100, 0.75), seg(220, 100, 0.5)]);
  const b1 = s1.sent[0];
  ok('stamp = execution start - schedule_latency_us (RFC-059), in hub time', b1 && b1.anchor === H + 20_000 - 1000, b1 && b1.anchor);
  ok('half of 250 ms: the third start (219 ms) waits', r1.ok && r1.sent === 2 && b1.recs.length === 2 && r1.rateHz === 50);
  ok('records: target, duration in ms, end velocity unspecified', b1.recs[0][TN] === 0.25 && b1.recs[0][DN] === 100
    && b1.recs[0][EV] === LIMITS.segment_end_vel_unspecified / 1000 && b1.recs[1][TN] === 0.75);
  ok('offsets on the 100 us grid', b1.offs[0] === 0 && b1.offs[1] === 100_000);
  ok('the path is logged once', o1.log.filter((l) => /segments STREAM.*250 ms.*1000 us/.test(l.msg)).length === 1);

  for (const horizon of [250, 500, 1000]) {
    const s = fakeSeg({ horizon });
    const { d } = segDoor(s);
    d.segments([]); await tick();
    const tiles = Array.from({ length: 120 }, (_, i) => seg(i * 12, 12, (i % 2) * 1));
    const r = d.segments(tiles);
    const b = s.sent[0];
    const st = starts(b);
    const cap = Math.min(LIMITS.bundle_max_samples, Math.floor((LIMITS.min_transport_payload - 6) / (2 + recordBytes(segSt.entry.layout))));
    const inReach = tiles.filter((x, i) => i && (H + (x.atMs - T) * 1000 - 1000) - H <= horizon * 500).length + 1;
    ok('horizon ' + horizon + ': every start within half of it, at most ' + cap + ' per bundle, sent = packed',
      st.every((u) => u - H <= horizon * 500) && b.recs.length === Math.min(cap, inReach) && r.sent === b.recs.length
      && b.offs.every((o) => o % UNIT === 0), r.sent + ' of ' + inReach);
  }

  const s2 = fakeSeg();
  const { d: d2 } = segDoor(s2);
  d2.segments([]); await tick();
  const r2 = d2.segments([seg(-30, 100), seg(70, 50)]);
  const b2 = s2.sent[0];
  ok('a late start is clipped to hub now + latency keeping its end', b2.anchor === H && b2.recs[0][DN] === 69 && b2.offs[1] === 69_000 && r2.sent === 2,
    JSON.stringify(b2));
  const r3 = d2.segments([seg(-95, 100), seg(5, 5), seg(10, 100)]);
  const b3 = s2.sent[1];
  ok('under 10 ms left (clipped or short) is consumed, not packed, and counted in sent',
    r3.ok && r3.sent === 3 && b3.recs.length === 1 && b3.anchor === H + 9000);
  const r4 = d2.segments([seg(20, 50), seg(20, 50), seg(70, 50)]);
  ok('a start colliding on the grid is consumed', r4.sent === 3 && s2.sent[2].recs.length === 2 && s2.sent[2].offs[1] === 50_000);
  const r5 = d2.segments([seg(20, 50), seg(70, 5)]);
  ok('a consumed item after the last packed one is not counted', r5.sent === 1);
  const r6 = d2.segments([seg(20.04, 33.37), seg(53.41, 40)]);
  ok('t_off rounds to 100 us', s2.sent.at(-1).offs[1] === 33_400 && r6.sent === 2, s2.sent.at(-1).offs);
  const n0 = s2.sent.length;
  const r7 = d2.segments([seg(200, 100)]);
  ok('nothing in reach: ok, sent 0, nothing published', r7.ok && r7.sent === 0 && s2.sent.length === n0);
  d2.segments([seg(20, 70_000, 1.5)]);
  ok('target clamped to 1, duration clamped to its type range', s2.sent.at(-1).recs[0][TN] === 1 && s2.sent.at(-1).recs[0][DN] === 65535);

  s2.throwCode = 'RATE_EXCEEDED';
  const { d: d3, out: o3 } = segDoor(s2);
  const r8 = d3.segments([seg(20, 50)]);
  d3.segments([seg(20, 50)]);
  ok('a PublishError returns its code with the rate, logged once', !r8.ok && r8.sent === 0 && r8.reason === 'RATE_EXCEEDED'
    && r8.rateHz === 50 && o3.log.filter((l) => /RATE_EXCEEDED/.test(l.msg)).length === 1);

  const s4 = fakeSeg({ grant: false });
  const { d: d4 } = segDoor(s4);
  d4.segments([]); await tick();
  ok('a refused grant reads publish refused, asked once', d4.segments([seg(20, 50)]).reason === 'publish refused' && s4.asked.length === 1);

  {
    const nacks = [{ channel: CH, name: 'SOURCE_CONFLICT' }];
    const s = fakeSeg();
    const { d } = segDoor(s, { nacks });
    d.segments([]); await tick();
    const before = d.segments([seg(20, 50)]);
    nacks.push({ channel: CH + 1, name: 'ACCESS_DENIED' });
    const other = d.segments([seg(20, 50)]);
    nacks.push({ channel: CH, name: 'SOURCE_CONFLICT' });
    const r = d.segments([seg(20, 50)]);
    const again = d.segments([seg(20, 50)]);
    ok('a hub NACK on the segments channel refuses the next call once with its name; an older one or another channel never',
      before.ok && other.ok && !r.ok && r.sent === 0 && r.reason === 'SOURCE_CONFLICT' && again.ok && s.sent.length === 3,
      JSON.stringify([before, other, r, again]));
  }

  {
    // The door's hub clock: the kept exchange with the least RTT/2 + age x drift (SPEC §7.1).
    const ls = {}, fired = [], at = [];
    const s = {
      state: { clockOffsetUs: 7000 },
      hubNowUs: () => H + s.state.clockOffsetUs,
      on: (n, cb) => { (ls[n] ||= []).push(cb); },
      clock(offsetUs, rttUs, atMs) { s.state.clockOffsetUs = offsetUs; for (const cb of ls.clock || []) cb({ offsetUs, rttUs, ...(atMs != null && { atMs }) }); },
      syncClock() { at.push(performance.now()); const n = fired.push(1); return Promise.resolve().then(() => (s.clock(5000 + n, 9000), {})); },
    };
    const before = filteredHubNowUs(s);
    for (let i = 0; i < CLOCK_HUNT * CLOCK_HUNT_GAP_MS / 20 + 10 && fired.length < CLOCK_HUNT; i++) await new Promise((r) => setTimeout(r, 20));
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    ok('first use hunts CLOCK_HUNT exchanges at random gaps, the raw offset until one lands',
      before === H + 7000 && fired.length === CLOCK_HUNT && new Set(gaps.map((g) => Math.round(g / 10))).size > 1, fired.length + ' ' + gaps.map(Math.round));
    // The refutation's case: a fast hunt exchange, then slower resyncs, must not move the stamp.
    const t0 = performance.now();
    s.clock(2000, 1000, t0);
    s.clock(9000, 15000, t0);
    ok('stamps ride the least-bound exchange, not the newest', filteredHubNowUs(s, t0) === H + 2000, filteredHubNowUs(s, t0) - H);
    for (let i = 0; i < 10; i++) s.clock(4000, 3000, t0);
    ok('a fast exchange is not evicted by a count of newer slower ones', filteredHubNowUs(s, t0) === H + 2000, filteredHubNowUs(s, t0) - H);
    s.clock(4500, 3000, t0 + 10_000);
    ok('a fresh slower exchange does not displace a fast one 10 s old', filteredHubNowUs(s, t0 + 10_000) === H + 2000, filteredHubNowUs(s, t0 + 10_000) - H);
    s.clock(4700, 3000, t0 + 30_000);
    ok('a fast exchange yields once its drift bound passes a fresh one', filteredHubNowUs(s, t0 + 30_000) === H + 4700, filteredHubNowUs(s, t0 + 30_000) - H);
    for (let i = 0; i < CLOCK_KEEP; i++) s.clock(6000, 5000, t0 + 30_000);
    ok('CLOCK_KEEP newer exchanges evict the rest', filteredHubNowUs(s, t0 + 30_000) === H + 6000, filteredHubNowUs(s, t0 + 30_000) - H);
    for (const cb of ls.close) cb({});
    s.state.clockOffsetUs = 123;
    ok('a close voids the kept exchanges: the session offset again', filteredHubNowUs(s) === H + 123);
    const s2 = { ...fakeSeg(), hubNowUs: () => 42 };
    ok('a session without on() or syncClock() reads hubNowUs()', filteredHubNowUs(s2) === 42);
  }

  // streamGate: the first that applies, in order.
  const all = { live: false, roles: 0, access: 1, halted: 'e-stop latched', running: true,
    owners: [{ name: 'Advanced', session: 9 }], self: 3, busy: 'motion input in use by x' };
  const order = [];
  let g = { ...all };
  for (const fix of [{ live: true }, { roles: 1 }, { halted: '' }, { running: false }, { owners: [{ name: '', session: 3 }] }, { busy: '' }]) {
    order.push(streamGate(g));
    g = { ...g, ...fix };
  }
  order.push(streamGate(g));
  ok('streamGate order: link, tier, latch, generator, owner, busy, clear', JSON.stringify(order) === JSON.stringify(['no hub link',
    'session not authorized', 'e-stop latched', 'stop the pattern first', 'rail owned by Advanced', 'motion input in use by x', '']), order);
  ok('streamGate: an unlabeled foreign owner still gates', streamGate({ ...g, owners: [{ name: '', session: 4 }] }) === 'rail owned by another session');

  const ownerEntry = entries.find((e) => e.id === CH_CONTROL_OWNER);
  const smp = { src0: 1, owner0: 7, src1: 2, owner1: 0, src2: 9, owner2: 8, src3: 0, owner3: 0 };
  ok('railOwners: every owned pair, labeled through options', JSON.stringify(railOwners(ownerEntry, smp))
    === JSON.stringify([{ name: ownerEntry.layout[0].options[1], session: 7 }, { name: '', session: 8 }]));
  ok('railOwnerName keeps its meaning: the first labeled pair, else empty', railOwnerName(ownerEntry, smp) === ownerEntry.layout[0].options[1]
    && railOwnerName(ownerEntry, { ...smp, owner0: 0 }) === '' && railOwners(ownerEntry, null).length === 0);
}

// ---- (i) the producer lock (ph-smvd.2) -------------------------------------
console.log('(i) one motion producer at a time');
{
  let now = 0;
  const durField = model.byRole.get('input.duration')[0];
  const segs = [];
  const { host, calls } = makeHost({
    now: () => now,
    submitSegments: (list) => { segs.push(list); return { ok: true, sent: list.length, rateHz: 50 }; },
    gate: (f, busy) => streamGate({ live: true, roles: 1, access: 1, busy }),
  });
  const apis = {};
  for (const n of ['alpha', 'beta']) {
    host.add({ ...gaugeManifest, name: n, permissions: ['motion'] }, { activate(a) { apis[n] = a; } });
  }
  let spy = null;
  host.add({ ...gaugeManifest, name: 'nomotion' }, { activate(a) { spy = a; } });
  let pe = null;
  try { spy.submitSegments([]); } catch (e) { pe = e; }
  ok('submitSegments without "motion" throws PermissionError', pe && pe.name === 'PermissionError' && !segs.length);

  const { alpha: A, beta: B } = apis;
  ok('an empty list never takes the lock', A.submitSegments([]).ok && B.submitSegments([{ atMs: 0, norm: 0, durationMs: 50 }]).ok);
  now = 600;
  const ra = A.submitSegments([{ atMs: 700, norm: 0.2, durationMs: 200 }, { atMs: 900, norm: 0.8, durationMs: 100 }]);
  ok('the holder sends', ra.ok && ra.sent === 2);
  now = 1499;
  const n0 = segs.length;
  const rb = B.submitSegments([{ atMs: 1500, norm: 0.5, durationMs: 50 }]);
  const rm = B.submitMotion(0.5, 100);
  ok('another plugin is refused until the last sent end + MOTION_HOLD_MS, without reaching the door',
    !rb.ok && rb.sent === 0 && rb.reason === 'motion input in use by alpha' && !rm.ok && rm.reason === rb.reason
    && segs.length === n0 && !calls.motion.length);
  ok('gate shows the busy words to the other plugin only', B.gate(durField) === 'motion input in use by alpha' && A.gate(durField) === '');
  now = 1500;
  ok('released at the end + 500 ms', B.submitMotion(0.5, 100).ok && calls.motion.length === 1);
  now = 2099;
  ok('submitMotion holds for its duration + 500 ms', A.submitSegments([{ atMs: 2100, norm: 0, durationMs: 50 }]).reason === 'motion input in use by beta'
    && A.gate(durField) === 'motion input in use by beta');
  now = 2100;
  ok('... then frees it', A.submitSegments([{ atMs: 2100, norm: 0, durationMs: 50 }]).ok && B.gate(durField) === 'motion input in use by alpha');
  ok('MOTION_HOLD_MS is 500', MOTION_HOLD_MS === 500);
}

// ---- (j) net.fetch and the shell's media policy (ph-smvd.2; rulings R-A, R-B) --
console.log('(j) net.fetch, CSP and the http capability');
{
  ok('net.fetch is a known permission, a near miss is not', validateManifest({ ...gaugeManifest, permissions: ['net.fetch'] }).length === 0
    && validateManifest({ ...gaugeManifest, permissions: ['net.fetchx'] }).length === 1);
  const seen = [];
  const res = { ok: true, status: 200 };
  const hub = (u) => isHubUrl(u, '192.168.1.50', 82);
  const { host } = makeHost({ fetch: async (u, i) => { seen.push([u, i]); return res; }, isHub: hub });
  const apis = {};
  host.add({ ...gaugeManifest, name: 'fetcher', permissions: ['net.fetch'] }, { activate(a) { apis.f = a; } });
  host.add({ ...gaugeManifest, name: 'nofetch' }, { activate(a) { apis.n = a; } });
  const why = async (p) => { try { await p; return ''; } catch (e) { return e.name === 'PermissionError' ? 'perm' : e.message; } };
  ok('without "net.fetch": PermissionError', await why(apis.n.net.fetch('http://stash.lan:9999/graphql')) === 'perm' && !seen.length);
  ok('only http and https', (await Promise.all(['ftp://x/a', 'file:///c:/a', 'data:text/plain,a', 'ws://stash.lan/']
    .map((u) => why(apis.f.net.fetch(u))))).every((m) => m === 'net.fetch: http or https only') && !seen.length);
  ok('the hub\'s own origins are refused', (await Promise.all(['http://192.168.1.50/uitoken', 'http://192.168.1.50:82/',
    'https://192.168.1.50/x', 'http://192.168.1.50:80/x'].map((u) => why(apis.f.net.fetch(u)))))
    .every((m) => m === 'net.fetch: the hub is reached through Valence') && !seen.length);
  const init = { method: 'POST', headers: { ApiKey: 'k' }, body: '{}' };
  const r = await apis.f.net.fetch('http://192.168.1.50:9999/graphql', init);
  ok('another port on the hub host, and the init, pass through', r === res && seen.length === 1
    && seen[0][0] === 'http://192.168.1.50:9999/graphql' && seen[0][1] === init);
  ok('isHubUrl: host case-insensitive, default ports and the WS port only', isHubUrl(new URL('http://HUB.local/'), 'hub.local', 82)
    && isHubUrl(new URL('http://hub.local:82/'), 'hub.local', 82) && !isHubUrl(new URL('http://hub.local:8080/'), 'hub.local', 82)
    && !isHubUrl(new URL('http://other/'), 'hub.local', 82) && !isHubUrl(new URL('http://x/'), '', 82));
  const { host: bare } = makeHost();
  let b = null;
  bare.add({ ...gaugeManifest, name: 'bare', permissions: ['net.fetch'] }, { activate(a) { b = a; } });
  ok('without the shell: refused in words', await why(b.net.fetch('https://stash.example/graphql')) === 'net.fetch needs the shell');

  const conf = json('../src-tauri/tauri.conf.json');
  const csp = Object.fromEntries(conf.app.security.csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
  ok('CSP: media-src and img-src take http(s) and blob:, connect-src unchanged',
    csp['media-src'] === "'self' blob: http: https:" && csp['img-src'] === "'self' data: blob: http: https:"
    && csp['connect-src'] === "'self' ipc: http://ipc.localhost ws:", JSON.stringify(csp));
  const cap = json('../src-tauri/capabilities/default.json').permissions.find((p) => p.identifier === 'http:default');
  ok('the http capability allows http and https', ['http://**', 'https://**'].every((u) => cap.allow.some((a) => a.url === u)));
}

// ---- (f) tier-2 replace mode (ph-vdk.29, DESIGN §3 "renders instead") -----
console.log('(f) tier-2 replace mode');
{
  // A synthetic built-in, standing in for a real heroes.js entry -- claimAll
  // does not care where a hero descriptor came from, only its shape.
  const builtins = [{ id: 'gauge-builtin', zone: 'card', spec: { require: { p: ROLE.telemetryPosition } } }];

  // A replacer whose own claim succeeds: the built-in is skipped entirely.
  const { host } = makeHost();
  host.add({ ...gaugeManifest, name: 'replacer' }, {
    activate(api) {
      api.registerHero({
        id: 'gauge', replaces: 'gauge-builtin',
        spec: { require: { p: ROLE.telemetryPosition } }, mount() {},
      });
    },
  });
  const heroesA = [...builtins, ...host.heroes()];
  ok('the plugin descriptor carries replaces',
     heroesA.some((h) => h.id === 'plugin:replacer:gauge' && h.replaces === 'gauge-builtin'));
  const claimA = claimAll(model.byRole, heroesA);
  ok('the plugin claims the fields', claimA.widgets.some((w) => w.id === 'plugin:replacer:gauge'));
  ok('the built-in it replaces never renders alongside it',
     !claimA.widgets.some((w) => w.id === 'gauge-builtin'));
  ok('the field is claimed once, by the plugin', claimA.widgets.filter((w) => w.fields.p).length === 1);

  // Disabling the plugin must never leave the field unclaimed: the built-in
  // returns the moment nothing replaces it.
  host.setEnabled('replacer', false);
  const claimB = claimAll(model.byRole, [...builtins, ...host.heroes()]);
  ok('a disabled replacer is gone from the claim list',
     !host.heroes().some((h) => h.id === 'plugin:replacer:gauge'));
  ok('the built-in claims normally once nothing replaces it',
     claimB.widgets.some((w) => w.id === 'gauge-builtin'));

  // A replacer whose OWN claim fails (roles absent): same rule, the built-in
  // is never suppressed on the strength of an unmet plugin alone.
  const { host: host2 } = makeHost();
  host2.add({ ...gaugeManifest, name: 'failing' }, {
    activate(api) {
      api.registerHero({
        id: 'nope', replaces: 'gauge-builtin',
        spec: { require: { none: 'some.role.nobody.has' } }, mount() {},
      });
    },
  });
  const claimC = claimAll(model.byRole, [...builtins, ...host2.heroes()]);
  ok('a replacer that cannot claim never suppresses the built-in',
     !claimC.widgets.some((w) => w.id === 'plugin:failing:nope')
     && claimC.widgets.some((w) => w.id === 'gauge-builtin'));

  // An unrecognized replaces target degrades silently -- no built-in of that
  // name to suppress, same "opportunity, never requirement" rule as an
  // unknown role.
  const { host: host3 } = makeHost();
  host3.add({ ...gaugeManifest, name: 'stray' }, {
    activate(api) {
      api.registerHero({
        id: 'stray', replaces: 'no-such-builtin',
        spec: { require: { p: ROLE.telemetryPosition } }, mount() {},
      });
    },
  });
  const claimD = claimAll(model.byRole, [...builtins, ...host3.heroes()]);
  ok('an unrecognized replaces target is a no-op, not an error',
     claimD.widgets.some((w) => w.id === 'plugin:stray:stray')
     && claimD.widgets.some((w) => w.id === 'gauge-builtin'));
}

// ---- (g) factory plugins; the pattern-card substitute ----------------------
console.log('(g) factory plugins: Advanced Penetration substitutes the pattern card');
{
  ok('every factory manifest validates', FACTORY.length > 0
    && FACTORY.every((f) => validateManifest(f.manifest).length === 0 && typeof f.module.activate === 'function'));
  const ap = FACTORY.find((f) => f.manifest.name === 'advanced-penetration');
  // Stand-ins for the two built-ins it substitutes: each claims wherever the
  // run role exists, so "the built-in renders" is observable on every catalog.
  const BUILTINS = ['advanced-generator', 'pattern'].map((id) => ({ id, spec: { require: { running: ROLE.patternRunning } } }));
  const isAp = (w) => w.plugin === 'advanced-penetration';
  const builtins = (r) => BUILTINS.every((b) => r.widgets.some((w) => w.id === b.id));
  const pass = (m, host) => claimAll(m.byRole, [...BUILTINS, ...host.heroes()]);
  function load(opts) {
    const m = buildSettingsModel(decodeCatalog(advgenCatalog(opts).bytes));
    const { host } = makeHost({ model: () => m });
    host.add(ap.manifest, ap.module, { source: 'factory' });
    return { m, host, ...pass(m, host) };
  }

  const a = load();
  const spec = a.host.heroes()[0];
  ok('it substitutes both pattern built-ins', !!spec && ['advanced-generator', 'pattern'].every((id) => spec.replaces.includes(id)));
  const bound = spec ? [...Object.values(spec.spec.require), ...Object.values(spec.spec.optional)] : [];
  ok('it binds every generator-advanced essential, base roles required (RENDERING §10, RFC-081)', !!spec
    && Object.values(ADVGEN_SPEC.require).every((r) => bound.includes(r))
    && ['advgen.master', 'advgen.depth_max', 'advgen.accel_out'].every((r) => Object.values(spec.spec.require).includes(r)));
  ok('advgen.running is required (RFC-093), pattern.running optional',
    !!spec && spec.spec.require.advRun === 'advgen.running' && spec.spec.optional.running === 'pattern.running');
  const w = a.widgets.find(isAp);
  ok('claims on the recorded catalog', !!w);
  ok('neither built-in renders beside it', !a.widgets.some((x) => BUILTINS.some((b) => b.id === x.id)));
  ok('pattern-panel essentials ride along (select claimed)', !!w && !!w.fields.select && a.claimed.has(w.fields.select.uid));
  ok('all eight modulators claimed, ascending by channel id', !!w && w.fields.mods.length === 8
    && w.fields.mods.every((x, i, l) => !i || l[i - 1].channelId < x.channelId));
  ok('RFC-095: both dwells bound as optional roles', !!w && w.fields.dwellCrest?.role === 'advgen.dwell_crest'
    && w.fields.dwellTrough?.role === 'advgen.dwell_trough' && !Object.values(spec.spec.require).some((r) => /dwell/.test(r)));
  {
    const nd = load({ drop: ['advgen.dwell_crest', 'advgen.dwell_trough'] });
    const x = nd.widgets.find(isAp);
    ok('RFC-095: absent dwell roles decline nothing', !!x && !x.fields.dwellCrest && !x.fields.dwellTrough);
  }
  for (const r of ['advgen.running', 'advgen.master', 'advgen.depth_max', 'advgen.depth_min', 'advgen.speed_in',
    'advgen.speed_out', 'advgen.accel_in', 'advgen.accel_out']) {
    const b = load({ drop: [r] });
    ok('missing ' + r + ': declines, the built-ins claim', !b.widgets.some(isAp) && builtins(b));
  }
  const c = load();
  const wc = c.widgets.find(isAp);
  ok('advgen.mode is not bound (RFC-093 retires it): it stays a generic field', !!wc && !('mode' in wc.fields)
    && !c.claimed.has((c.m.byRole.get('advgen.mode') || [{}])[0].uid));
  wc.slot.def.mount = () => { throw new Error('boom'); };   // this load's copy of the plugin only
  ok('a mount that throws is dropped (RENDERING §10.2 item 5)', c.host.mountHero(wc, {}, wc.fields) === null);
  ok('... and the next pass renders the built-ins', builtins(pass(c.m, c.host)) && !pass(c.m, c.host).widgets.some(isAp));
  a.host.setEnabled('advanced-penetration', false);
  ok('disabled: the built-ins claim', builtins(pass(a.m, a.host)) && !pass(a.m, a.host).widgets.some(isAp));
}

// ---- (h) the editor geometry: field values to handles and back ------------
console.log('(h) editor geometry');
{
  const near = (x, y, e = 1e-6) => Math.abs(x - y) <= e;
  const pct = { min: 0, max: 100, step: 1 }, spd = { min: 1, max: 100, step: 1 };
  ok('snap: step grid and bounds', snap(spd, 37.6) === 38 && snap(spd, 150) === 100 && snap(spd, -4) === 1
    && snap({ min: 0, max: 1, step: 0.1 }, 0.26) === 0.3);
  ok('accel to control offset share and back', [0, 0.25, 1].every((A) => near(accelForEase(1 / (2 + 9 * A)), A)));
  ok('no window or no speed: no stroke', halfTime(0, 0.5, 0) === null && halfTime(0.5, 0, 0) === null);
  const L = { X0: 70, XR: 960, YT: 30, YB: 210 };
  const p = { lo: 0.1, hi: 0.8, sIn: 0.5, sOut: 0.25, aIn: 0.4, aOut: 0.6 };
  const g = strokeGeom(p, L);
  ok('the halves span the plot, each as wide as its stroke time', near(g.x2, L.XR)
    && near((g.x1 - g.x0) / (g.x2 - g.x1), halfTime(0.7, 0.5, 0.4) / halfTime(0.7, 0.25, 0.6)));
  ok('deep and shallow handles sit at the window', near(g.deep.y, L.YB - 0.8 * 180) && near(g.shallow.y, L.YB - 0.1 * 180));
  ok('depth handle to value', snap(pct, strokeValue.depth(pct, g, 0, g.deep.y)) === 80
    && snap(pct, strokeValue.depth(pct, g, 0, g.shallow.y)) === 10);
  ok('in and out speed handles to value', snap(spd, strokeValue.speedIn(spd, g, g.vIn.x)) === 50
    && snap(spd, strokeValue.speedOut(spd, g, g.vOut.x)) === 25);
  ok('accel diamonds to value', snap(pct, strokeValue.accelIn(pct, g, g.aIn.x)) === 40
    && snap(pct, strokeValue.accelOut(pct, g, g.aOut.x)) === 60);
  ok('a diamond rides its curve', near(onCurve(g.inC, g.aIn.x).y, g.aIn.y, 1e-3));
  ok('a wider in half is a slower in speed', strokeValue.speedIn(spd, g, g.vIn.x + 40) < 50);
  const share = (q) => { const a = halfTime(0.7, q.sIn, q.aIn); return a / (a + halfTime(0.7, q.sOut, q.aOut)); };
  ok('unlinked: the turn share solves one speed, the other half kept',
    near(share({ ...p, sIn: speedInAt(p, 0.3) }), 0.3) && near(share({ ...p, sOut: speedOutAt(p, 0.3) }), 0.3));
  const U = 1 / p.sIn + 1 / p.sOut, li = linkedInAt(p, 0.3, U), lo = linkedOutAt(p, 0.3, U);
  ok('linked: 1/in + 1/out held and the turn at the share', near(1 / li + 1 / lo, U) && near(share({ ...p, sIn: li, sOut: lo }), 0.3));

  // The link in whole percent: T = 1/in + 1/out, master x half the physical speed.
  const r = linkRescale(40, 100, 100, 100, 1, 100);
  ok('link: 40/100/100 rescales to 80/50/50, the physical halves unchanged', r && r.master === 80 && r.in === 50 && r.out === 50
    && 40 * 100 === r.master * r.in, r);
  ok('link: master at its top, or 0, rescales nothing', linkRescale(100, 100, 100, 100, 1, 100) === null && linkRescale(0, 100, 100, 100, 1, 100) === null);
  ok('link: k = top / master past 50', (({ master, in: i, out: o }) => master === 100 && i === 70 && o === 70)(linkRescale(70, 100, 100, 100, 1, 100)));
  const r2 = linkRescale(45, 100, 75, 100, 1, 100);
  ok('link: rounding takes the pair with the least period error (45/100/75 -> 90/50/38)', r2.in === 50 && r2.out === 38
    && Math.abs(1 / 50 + 1 / 38 - 2 * (1 / 100 + 1 / 75)) < Math.abs(1 / 50 + 1 / 37 - 2 * (1 / 100 + 1 / 75)), r2);
  ok('link: 100/100 has no room, 50/50 has room both ways', linkSpan(0.02, 1, 100).join() === '100,100' && linkSpan(0.04, 1, 100).join() === '34,100');
  const T = 1 / 50 + 1 / 50;
  ok('link: every partner holds T within one step of rounding', [34, 40, 50, 63, 80, 100].every((v) => {
    const b = linkPartner(T, v, 1, 100);
    return b >= 1 && b <= 100 && Math.abs(1 / v + 1 / b - T) <= Math.abs(1 / b - 1 / (b + 1)) + 1e-12;
  }));

  // Labels clear of the line: a rising diagonal, a label on its mid point.
  const diag = [densify([[0, 200], [400, 0]])];
  const lab = placeLabels([{ x: 200, y: 100, w: 60, h: 14 }], diag, [[200, 100]], 400, 200);
  const rect = { x: 200 + lab[0].dx, y: 100 + lab[0].dy, w: 60, h: 14 };
  const inside = (q) => q[0] >= rect.x && q[0] <= rect.x + rect.w && q[1] >= rect.y && q[1] <= rect.y + rect.h;
  ok('labels: beside the handle on the side away from the tangent, clear of the line', !lab[0].bg && !diag[0].some(inside)
    && ((lab[0].dx > 0 && lab[0].dy > 0) || (lab[0].dx < 0 && lab[0].dy < 0)), lab);
  const two = placeLabels([{ x: 100, y: 50, w: 60, h: 14 }, { x: 110, y: 50, w: 60, h: 14 }], [densify([[0, 50], [400, 50]])], [[100, 50], [110, 50]], 400, 200);
  const ra = { x: 100 + two[0].dx, y: 50 + two[0].dy, w: 60, h: 14 }, rb = { x: 110 + two[1].dx, y: 50 + two[1].dy, w: 60, h: 14 };
  ok('labels: a neighbor flips side rather than overlap', !(ra.x < rb.x + 60 && rb.x < ra.x + 60 && ra.y < rb.y + 14 && rb.y < ra.y + 14) && !two[1].bg, two);
  const boxed = placeLabels([{ x: 20, y: 20, w: 60, h: 14 }], [densify([[0, 0], [40, 40]]), densify([[0, 40], [40, 0]]), densify([[0, 20], [40, 20]]), densify([[20, 0], [20, 40]])], [], 40, 40);
  ok('labels: no clear side, the clearest wears a backing', boxed[0].bg);
  // Boxed in at the near gap by two guides and two posts: one label height further out, unbacked.
  const fence = [[[0, 82], [400, 82]], [[0, 118], [400, 118]], [[165, 85], [165, 115]], [[235, 85], [235, 115]]].map((l) => densify(l));
  const out = placeLabels([{ x: 200, y: 100, w: 60, h: 14 }], fence, [[200, 100]], 400, 200)[0];
  ok('labels: boxed in at the near gap, a label steps one label height out, unbacked', !out.bg && out.dy === -36 && out.dx === -30, out);
  // A mark's own clearance (a plus dot) holds a label further off than a handle's default 8 px.
  const offMark = (r) => placeLabels([{ x: 100, y: 100, w: 40, h: 14 }], [], [[100, 100], r], 400, 200)[0];
  ok('labels: a mark with a clearance radius keeps a label off it', offMark([100, 66]).dy < 0 && offMark([100, 66, 14]).dy > 0,
    [offMark([100, 66]), offMark([100, 66, 14])]);
  ok('any stroke spans the plot: the time axis never stretches', [{ ...p, hi: 0.95 }, { ...p, sIn: 0.05 }, { ...p, aOut: 1 }]
    .every((q) => { const h = strokeGeom(q, L); return near(h.x0, L.X0) && near(h.x2, L.XR); }));
  ok('playhead: a depth share maps onto the half', near(atDepth(g.inC, 0.5).y, (g.ylo + g.yhi) / 2, 1e-6));

  // RFC-095 dwells: trough flat first, crest flat after the deep turn, on the moving halves' clock.
  const W = L.XR - L.X0;
  const dg = strokeGeom({ ...p, dt: 0.2, dc: 0.1 }, L);
  ok('dwell: flats to scale, one stroke = the two moving halves', near((dg.x0 - dg.xt) / dg.mw, 0.2) && near((dg.xc - dg.x1) / dg.mw, 0.1)
    && near(dg.xt, L.X0) && near(dg.x2, L.XR) && !dg.cut.trough && !dg.cut.crest);
  ok('dwell: the halves keep their ratio', near((dg.x1 - dg.x0) / (dg.x2 - dg.xc), halfTime(0.7, 0.5, 0.4) / halfTime(0.7, 0.25, 0.6)));
  ok('dwell: speed, accel and dwell handles invert with flats in the picture',
    snap(spd, strokeValue.speedIn(spd, dg, dg.vIn.x)) === 50 && snap(spd, strokeValue.speedOut(spd, dg, dg.vOut.x)) === 25
    && snap(pct, strokeValue.accelOut(pct, dg, dg.aOut.x)) === 60
    && near(dwellAt('trough', dg, dg.pill.trough.x), 0.2) && near(dwellAt('crest', dg, dg.pill.crest.x), 0.1));
  const thr = DWELL_CAP / (1 - DWELL_CAP);   // the lone dwell whose flat is exactly the cap
  ok('dwell: a flat at the cap is whole, past it is cut at the cap', !strokeGeom({ ...p, dc: thr - 0.01 }, L).cut.crest
    && (({ cut, x1, xc }) => cut.crest && near(xc - x1, DWELL_CAP * W))(strokeGeom({ ...p, dc: thr + 0.01 }, L)));
  const big = strokeGeom({ ...p, dt: 5, dc: 8 }, L);
  ok('dwell: two long dwells both cut, the stroke still spans the plot', big.cut.trough && big.cut.crest && near(big.x2, L.XR)
    && near(big.x0 - big.xt, DWELL_CAP * W) && near(big.xc - big.x1, DWELL_CAP * W));
  ok('dwell: a cut pill keeps its value at the grab point, 0 at the flat start, more to the right',
    near(dwellAt('crest', big, big.pill.crest.x), 8) && dwellAt('crest', big, big.x1) === 0
    && dwellAt('crest', big, big.pill.crest.x + 40) > 8 && dwellAt('trough', big, big.pill.trough.x - 40) < 5);
  ok('dwell: no UI maximum: the right edge asks for more than any field holds', dwellAt('trough', dg, L.XR + 10) === Infinity);

  const ML = { X0: 90, XR: 970, YT: 28, YB: 120, AX: 40, TRACK: 152 };
  const c = { amount: 50, rise: 3, hold: 2, fall: 4, rest: 1, phase: 12 };
  const st = stairGeom(c, 100, ML);
  ok('staircase: one bar per stroke of the cycle', st.bars.length === 10 && near(st.rest.x, ML.XR));
  ok('staircase: rise steps down, hold sits low, fall climbs, rest at base',
    near(st.bars[0], ML.YT + 46 / 3) && near(st.bars[3], ML.YT + 46) && near(st.bars[8], ML.YT) && near(st.bars[9], ML.YT));
  ok('staircase: corner handles to whole strokes', ['rise', 'hold', 'fall', 'rest'].every((k) => near(stairValue[k](pct, st, st[k].x), c[k])));
  ok('staircase: amp fader to amount', near(stairValue.amount(pct, st, 0, st.amp.y), 50));
  ok('staircase: phase marker wraps the cycle', near(stairValue.phase(pct, st, st.phase.x), 2));
  ok('staircase: amount 0 is flat', stairGeom({ ...c, amount: 0 }, 100, ML).bars.every((y) => y === ML.YT));
}

console.log(fails ? '\nFAIL — ' + fails + ' assertion(s)' : '\nPASS — plugin host');
process.exit(fails ? 1 : 0);
