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
 *       arriving over the (fake) listener reaches submitMotion.
 *
 * Run: node test/plugins.test.mjs
 */

import { readFileSync } from 'node:fs';
import { decodeCatalog } from '../../Valence/clients/js/index.js';
import { buildSettingsModel, reportedValue } from '../src/model/settings.js';
import { ROLE, claimAll } from '../src/model/roles.js';
import { motionTarget } from '../src/model/motion.js';
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
  ok('a TCP line reaches submitMotion as (0.25, 200)', eq(calls.motion, [[0.25, 200]]));
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

console.log(fails ? '\nFAIL — ' + fails + ' assertion(s)' : '\nPASS — plugin host');
process.exit(fails ? 1 : 0);
