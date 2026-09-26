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
 *       and the hub grants it, and the command.position setpoint otherwise.
 *
 * Run: node test/plugins.test.mjs
 */

import { readFileSync } from 'node:fs';
import { decodeCatalog, CHANNEL_CLASS, STREAM_KIND, UNIT_ID, LIMITS, PublishError } from '../../Valence/clients/js/index.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE, claimAll } from '../src/model/roles.js';
import { motionTarget, createMotionDoor } from '../src/model/motion.js';
import { createPluginHost, validateManifest } from '../src/plugins/host.js';
import * as gauge from '../plugins/examples/stroke-gauge/index.js';
import * as tcode from '../plugins/examples/tcode-adapter/index.js';

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
  const e1 = [stream([lay('a', { unitId: UNIT_ID.normalized }), lay('b', { type: 3, typeName: 'i16', scale: 1000 })])];
  const { d: d1, out: o1 } = door(e1, s1);
  const first = d1(0.25, 200);
  ok('first input asks for the grant lazily and is held, not sent as a setpoint',
    !first.ok && s1.asked.length === 1 && s1.asked[0][0][0] === 0x7000 && s1.asked[0][0][1] === 100 && o1.set.length === 0);
  await tick();
  ok('granted: input rides publishSamples', d1(0.25, 200).ok && s1.sent.length === 1 && s1.sent[0].ch === 0x7000);
  ok('target by unit fallback carries the norm, other fields 0', eq(s1.sent[0].sample, { a: 0.25, b: 0 }));
  ok('duration becomes the anchor lead (hubNow + 200 ms)', s1.sent[0].anchor === 1_200_000);
  d1(0.5);
  ok('no duration: anchored at hubNow', s1.sent[1].anchor === 1_000_000);
  d1(2, 5000);
  ok('norm clamped to 1, lead capped at max_future_schedule_ms',
    s1.sent[2].sample.a === 1 && s1.sent[2].anchor === 1_000_000 + LIMITS.max_future_schedule_ms * 1000);
  ok('the live path is logged once', o1.log.filter((l) => /samples STREAM/.test(l.msg)).length === 1);

  const e2 = [stream([lay('x', { unitId: UNIT_ID.normalized }), lay('y', { unitId: UNIT_ID.normalized, role: 'input.target' })])];
  const s2 = fakeSession();
  const { d: d2 } = door(e2, s2);
  d2(0.4); await tick(); d2(0.4, 20);
  ok('role input.target outranks the unit fallback', eq(s2.sent[0].sample, { x: 0, y: 0.4 }));

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

console.log(fails ? '\nFAIL — ' + fails + ' assertion(s)' : '\nPASS — plugin host');
process.exit(fails ? 1 : 0);
