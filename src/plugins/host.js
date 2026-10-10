/**
 * host.js — the tier-2 plugin host: manifest validation, the API object a
 * plugin is handed, and the error boundary around every call into plugin code.
 *
 * Constraints:
 * - Plain JS, no runes, no Svelte, no Tauri: everything it touches arrives by
 *   injection (createPluginHost's `deps`), so test/plugins.test.mjs runs it
 *   under node against the fixture catalog with the same code the app runs.
 * - The API object carries NO session, socket or transport handle. Reads go
 *   through the model, writes through the shadow entry points. That is the
 *   Prime Rule (docs/PLUGINS.md) in code; a plugin needing more is an RFC.
 * - Isolation is honesty, not sandboxing: plugins run in-page with the page's
 *   full authority. Permission checks here stop honest mistakes and make the
 *   declared surface visible; they do not stop hostile code.
 * - Every call into plugin code goes through guard(). A throw is recorded on
 *   the plugin and logged under its name, and never propagates to the kernel.
 * See: docs/PLUGINS.md
 */

import { NAV_ICONS } from '../ui/navIcons.js';

/** Host API major. Bumped only by a breaking change, which the freeze forbids once one external plugin exists. */
export const API_VERSION = 1;

export const KINDS = ['widget', 'adapter', 'theme'];

/** How long past its last sent motion a plugin keeps the motion input (ph-smvd.2). */
export const MOTION_HOLD_MS = 500;

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PERM_RE = /^(intent|motion|net\.fetch|net\.listen:([1-9][0-9]{0,4}))$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PATH_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]{1,2000}$/;

/** A plugin's Show tab switch, per plugin, '1' or '0'; absent, a factory plugin's pages show. */
export const PAGES_KEY = 'phosphor.plugins.pages.';

/**
 * Validate a manifest. Returns a list of problems; empty means valid.
 * A plugin with problems is listed with them and never executed.
 */
export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  if (typeof m.name !== 'string' || !NAME_RE.test(m.name)) errs.push('name must match ' + NAME_RE);
  if (typeof m.version !== 'string' || !m.version) errs.push('version must be a non-empty string');
  if (m.api !== API_VERSION) errs.push('api ' + m.api + ' is not supported (host speaks ' + API_VERSION + ')');
  if (!KINDS.includes(m.kind)) errs.push('kind must be one of ' + KINDS.join('|'));
  if (m.entry != null && (typeof m.entry !== 'string' || !/^[\w.-]+\.m?js$/.test(m.entry))) {
    errs.push('entry must be a plain .js file name in the plugin directory');
  }
  for (const k of ['roles', 'channels', 'permissions']) {
    if (m[k] != null && !Array.isArray(m[k])) errs.push(k + ' must be an array');
  }
  if (m.credits != null) {
    if (!Array.isArray(m.credits)) errs.push('credits must be an array');
    else for (const c of m.credits) {
      const ok = c && typeof c === 'object'
        && ['name', 'url', 'license'].every((k) => c[k] == null || (typeof c[k] === 'string' && c[k].length <= 120))
        && (c.url == null || /^https?:\/\/\S+$/.test(c.url));
      if (!ok) errs.push('credits entries need short string name/url/license, url http(s)');
    }
  }
  for (const p of m.permissions || []) {
    const hit = typeof p === 'string' && PERM_RE.exec(p);
    if (!hit || (hit[2] && Number(hit[2]) > 65535)) errs.push('unknown permission "' + p + '"');
  }
  return errs;
}

/** Is `u` (a URL) one of the hub's own origins: its host on the default ports or its WS port? */
export function isHubUrl(u, host, port) {
  return !!host && u.hostname.toLowerCase() === String(host).toLowerCase()
    && ['', '80', '443', String(port)].includes(u.port);
}

class PermissionError extends Error {
  constructor(plugin, perm) {
    super('plugin "' + plugin + '" did not declare permission "' + perm + '"');
    this.name = 'PermissionError';
  }
}

/**
 * @param {Object} deps injected kernel surface:
 *   model()                       -> settings model or null
 *   sample(channelId)             -> last decoded STATE sample or undefined
 *   sampleAge(channelId)          -> ms since that sample, or Infinity
 *   display(field, sample)        -> shadow-aware display value
 *   status(field)                 -> confirmed|pending|overdue|fault
 *   write(field, value, payload)  -> routes to the right shadow entry point,
 *                                    behind the host-rendered confirm
 *   trialCapable()                -> the hub declares settings-trial (RFC-099)
 *   writeTrial(field, value, noTrial) -> the setting shadow's trial write; it calls
 *                                    noTrial() when the hub NACKs it UNSUPPORTED_OP
 *   session()                     -> id of the live link session, null when none
 *   trialOp('commit'|'revert')    -> Promise<{ok, error?}>, this session's trials
 *   trialPending()                -> some meta.trial_pending bit is set
 *   gate(field, busy)             -> '' or why the field cannot be written (law 3);
 *                                    `busy` is the producer lock's words for this plugin
 *   stale(field)                  -> '' or the stale reason in words (law 8)
 *   reason(field)                 -> '' or the last refusal of the field's write
 *   modTarget(field)              -> uid of the field this modulator rides, or null
 *   storeSlots(field)             -> Promise<slot records | null> for an action.store writer
 *   submitMotion(norm, durationMs)-> {ok, reason?}
 *   submitSegments(list)          -> {ok, sent, rateHz?, reason?} (motion.js submit.segments)
 *   submitSamples(role, list)     -> {ok, sent, rateHz?, reason?} (motion.js submit.samples)
 *   now()                         -> ms clock of submitSegments' atMs (default performance.now)
 *   registerTheme(theme)          -> adds a preset to the theme table
 *   listenTcp(port, onLine)       -> Promise<close()>  (absent outside the shell)
 *   fetch(url, init)              -> Promise<Response>, CORS-free in the shell; null where none
 *   isHub(URL)                    -> true for the connected hub's own origins
 *   prefs                         -> Storage-like {getItem, setItem} or null
 *   ui                            -> the plugin UI kit (kit.js KIT), one frozen object; null where none
 *   log(pluginName, level, msg)   -> the log pane
 */
export function createPluginHost(deps) {
  /** name -> record */
  const plugins = new Map();
  const listeners = new Set();
  const now = deps.now || (() => performance.now());
  // One motion producer at a time: interleaved inputs from two plugins would
  // share one stream source on the hub.
  let lock = { name: '', until: -Infinity };
  // RFC-107 (draft): the channel:key pairs the hub refused as trials this session.
  let noTrial = new Set();
  let noTrialSid = null;
  const busyFor =(name) => (lock.name && lock.name !== name && now() < lock.until
    ? 'motion input in use by ' + lock.name : '');

  function changed() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { /* a kernel listener, not plugin code */ }
    }
  }

  function record(manifest, source) {
    return {
      manifest, source, status: 'loaded', error: null,
      heroes: [], pages: [], settings: null, closers: [], deactivate: null,
    };
  }

  /** Run plugin code. A throw lands on the plugin, the log, and nowhere else. */
  function guard(rec, where, fn) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') {
        return r.catch((e) => { fault(rec, where, e); return undefined; });
      }
      return r;
    } catch (e) {
      fault(rec, where, e);
      return undefined;
    }
  }

  function fault(rec, where, e) {
    const msg = where + ': ' + ((e && e.message) || String(e));
    rec.error = msg;
    deps.log(rec.manifest.name, 'error', msg);
    changed();
  }

  function need(rec, perm) {
    if (!(rec.manifest.permissions || []).includes(perm)) throw new PermissionError(rec.manifest.name, perm);
  }

  function makeApi(rec) {
    const name = rec.manifest.name;
    const prefix = 'plugin.' + name + '.';
    const api = {
      apiVersion: API_VERSION,
      // One glyph per shell surface a page draws itself (docs/PLUGINS.md, Pages).
      icons: Object.freeze({ quickRail: NAV_ICONS.quickRail }),
      // The shell's controls and layout primitives (docs/PLUGINS.md, The UI kit).
      ui: deps.ui || null,
      manifest: Object.freeze(JSON.parse(JSON.stringify(rec.manifest))),

      // ---- read: the model, never the wire ----
      catalog: () => deps.model(),
      field: (role) => {
        const m = deps.model();
        const list = m && m.byRole && m.byRole.get(role);
        return list && list.length ? list[0] : null;
      },
      value: (field) => (field ? deps.display(field, deps.sample(field.channelId)) : undefined),
      status: (field) => (field ? deps.status(field) : 'confirmed'),
      age: (field) => (field ? deps.sampleAge(field.channelId) : Infinity),
      gate: (field) => (field && deps.gate ? deps.gate(field, busyFor(name)) : ''),
      stale: (field) => (field && deps.stale ? deps.stale(field) : ''),
      reason: (field) => (field && deps.reason ? deps.reason(field) : ''),
      modTarget: (field) => (field && deps.modTarget ? deps.modTarget(field) : null),
      storeSlots: async (field) => (field && deps.storeSlots ? deps.storeSlots(field) : null),

      // ---- write: the shadow entry points, gated by the manifest ----
      write: (field, value, payload) => { need(rec, 'intent'); return deps.write(field, value, payload); },
      // RFC-099: live, never stored until commitTrial(); revertTrial() or this
      // client's session ending puts the stored value back.
      writeTrial: (field, value) => {
        need(rec, 'intent');
        if (!deps.trialCapable || !deps.trialCapable()) return { ok: false, error: 'hub has no trial writes' };
        if (!field || field.readOnly || field.writeChannel == null) return { ok: false, error: 'not a setting' };
        const sid = deps.session ? deps.session() : null;
        if (sid !== noTrialSid) { noTrial = new Set(); noTrialSid = sid; }
        const key = field.writeChannel + ':' + field.settingKey;
        // A refused trial is never retried and never turned into a durable write
        // by the preview (RFC-107 item 4): the operator writes it from the
        // settings page, where the write is their own action.
        if (noTrial.has(key)) return { ok: false, error: 'not trialable here, write it from the settings page' };
        return deps.writeTrial(field, value, () => noTrial.add(key));
      },
      commitTrial: () => {
        need(rec, 'intent');
        if (!deps.trialCapable || !deps.trialCapable()) return Promise.resolve({ ok: false, error: 'hub has no trial writes' });
        return deps.trialOp('commit');
      },
      revertTrial: () => {
        need(rec, 'intent');
        if (!deps.trialCapable || !deps.trialCapable()) return Promise.resolve({ ok: false, error: 'hub has no trial writes' });
        return deps.trialOp('revert');
      },
      // Any session's trial: the machine's meta.trial_pending fields, not this client's memory.
      get trialPending() { return !!(deps.trialPending && deps.trialPending()); },
      submitMotion: (norm, durationMs) => {
        need(rec, 'motion');
        const busy = busyFor(name);
        if (busy) return { ok: false, sent: 0, reason: busy };
        const r = deps.submitMotion(norm, durationMs);
        if (r && r.ok) lock = { name, until: now() + (durationMs || 0) + MOTION_HOLD_MS };
        return r;
      },
      submitSegments: (list) => {
        need(rec, 'motion');
        const busy = busyFor(name);
        if (busy) return { ok: false, sent: 0, reason: busy };
        const r = deps.submitSegments(list);
        if (r && r.ok && r.sent > 0) {
          const end = Math.max(...list.slice(0, r.sent).map((x) => x.atMs + x.durationMs));
          lock = { name, until: end + MOTION_HOLD_MS };
        }
        return r;
      },

      // A c2h samples STREAM found by channel role (SPEC 9.7 osc.drive). Not motion input: no producer lock.
      submitSamples: (role, list) => {
        need(rec, 'motion');
        if (typeof role !== 'string' || !role) return { ok: false, sent: 0, reason: 'no role' };
        return deps.submitSamples ? deps.submitSamples(role, list) : { ok: false, sent: 0, reason: 'NO_STREAM' };
      },

      // ---- contributions ----
      registerHero: (def) => {
        if (!def || typeof def.id !== 'string' || typeof def.mount !== 'function' || !def.spec) {
          throw new Error('registerHero needs {id, spec, mount}');
        }
        const ids = def.replaces == null ? [] : [].concat(def.replaces);
        if (def.replaces != null && (!ids.length || !ids.every((x) => typeof x === 'string'))) {
          throw new Error('registerHero: replaces must be a built-in hero id or a list of them');
        }
        const cellPair = (c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n) && n > 0 && n <= 64);
        if (def.cells != null && !(cellPair(def.cells.h) && cellPair(def.cells.v))) {
          throw new Error('registerHero: cells must be {h: [w, h], v: [w, h]} in whole grid cells');
        }
        const slot = { def, failed: false };
        rec.heroes.push(slot);
        if (rec.status === 'active') changed();
        // Withdraw this hero (a device that went away); its placement key stays inert.
        return () => {
          const i = rec.heroes.indexOf(slot);
          if (i < 0) return;
          rec.heroes.splice(i, 1);
          changed();
        };
      },
      // A tab under Plugins in the sidebar. `mount` is a hero's mount; `spec`
      // resolves without claiming, so a page never takes a field from a card.
      registerPage: (def) => {
        if (!def || typeof def.id !== 'string' || !NAME_RE.test(def.id) || typeof def.mount !== 'function') {
          throw new Error('registerPage needs {id, label, mount}');
        }
        if (typeof def.label !== 'string' || !def.label.trim() || def.label.length > 24) {
          throw new Error('registerPage: label must be 1 to 24 characters');
        }
        if (def.icon != null && !(typeof def.icon === 'string' && PATH_RE.test(def.icon))) {
          throw new Error('registerPage: icon must be one SVG path d on a 16-unit viewBox');
        }
        if (def.search != null && !(Array.isArray(def.search) && def.search.every((e) => e && typeof e.label === 'string' && typeof e.key === 'string'))) {
          throw new Error('registerPage: search must be [{label, key}]');
        }
        if (rec.pages.some((p) => p.def.id === def.id)) throw new Error('registerPage: id "' + def.id + '" is taken');
        const slot = { def, failed: false };
        rec.pages.push(slot);
        if (rec.status === 'active') changed();
        return () => {
          const i = rec.pages.indexOf(slot);
          if (i < 0) return;
          rec.pages.splice(i, 1);
          changed();
        };
      },
      registerSettings: (mount) => {
        if (typeof mount !== 'function') throw new Error('registerSettings needs a mount function');
        rec.settings = mount;
        if (rec.status === 'active') changed();
      },
      registerTheme: (t) => {
        if (rec.manifest.kind !== 'theme') throw new Error('registerTheme is for kind "theme"');
        const a = t && (t.accents || t);
        if (!t || !NAME_RE.test(t.id || '') || !HEX_RE.test(a.reality || '') || !HEX_RE.test(a.intent || '')) {
          throw new Error('registerTheme needs {id, name, accents: {reality, intent}} as #rrggbb');
        }
        // Safety colors are unreachable: theme.js normalizes and drops any
        // LOCKED override (RENDERING law 13).
        deps.registerTheme({ ...t, id: name + '-' + t.id, name: String(t.name || t.id) });
      },

      // ---- services ----
      net: Object.freeze({
        // Never a machine path (Prime Rule): the hub's own origins are refused.
        fetch: async (url, init) => {
          need(rec, 'net.fetch');
          const u = new URL(String(url));
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('net.fetch: http or https only');
          if (deps.isHub && deps.isHub(u)) throw new Error('net.fetch: the hub is reached through Valence');
          if (!deps.fetch) throw new Error('net.fetch needs the shell');
          return deps.fetch(u.href, init);
        },
        listenTcp: async (port, onLine) => {
          need(rec, 'net.listen:' + port);
          if (!deps.listenTcp) throw new Error('TCP listen is only available in the Tauri shell');
          let close;
          try {
            close = await deps.listenTcp(port, (line) => guard(rec, 'tcp line', () => onLine(line)));
          } catch (e) {
            fault(rec, 'listenTcp ' + port, e);
            throw e;
          }
          rec.closers.push(close);
          return close;
        },
      }),
      prefs: Object.freeze({
        get: (k) => {
          try { const v = deps.prefs && deps.prefs.getItem(prefix + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; }
        },
        set: (k, v) => {
          try { if (deps.prefs) deps.prefs.setItem(prefix + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
        },
      }),
      log: (msg, level = 'info') => deps.log(name, level, String(msg)),
    };
    return Object.freeze(api);
  }

  /**
   * Register a plugin: validate, then (if `enabled`) activate. A module whose
   * manifest fails validation is listed with its problems and never run.
   * @param {Object} manifest the parsed manifest.json
   * @param {Object|null} mod the imported ES module (null when import failed)
   * @param {{enabled?: boolean, source?: string, loadError?: string}} opts
   */
  function add(manifest, mod, opts = {}) {
    const rec = record(manifest, opts.source || '');
    const key = (manifest && manifest.name) || ('invalid-' + plugins.size);
    const old = plugins.get(key);
    if (old) remove(key);
    plugins.set(key, rec);
    rec.module = mod;
    const problems = validateManifest(manifest);
    if (problems.length) {
      rec.status = 'invalid';
      rec.error = problems.join('; ');
      if (manifest) deps.log(key, 'error', 'manifest: ' + rec.error);
    } else if (opts.loadError) {
      rec.status = 'error';
      rec.error = opts.loadError;
      deps.log(key, 'error', 'load: ' + opts.loadError);
    } else if (!mod || typeof mod.activate !== 'function') {
      rec.status = 'error';
      rec.error = 'module has no exported activate(api)';
      deps.log(key, 'error', rec.error);
    } else if (opts.enabled === false) {
      rec.status = 'disabled';
    } else {
      activate(rec);
    }
    changed();
    return rec;
  }

  function activate(rec) {
    rec.error = null;
    rec.heroes = [];
    rec.pages = [];
    rec.settings = null;
    rec.status = 'activating';
    const api = makeApi(rec);
    let failed = false;
    try {
      const r = rec.module.activate(api);
      if (typeof r === 'function') rec.deactivate = r;
    } catch (e) {
      failed = true;
      fault(rec, 'activate', e);
    }
    if (failed) {
      // Roll back whatever it registered before throwing: a half-activated
      // plugin must not keep claims on fields the generic tree then loses.
      rec.heroes = [];
      rec.pages = [];
      rec.settings = null;
      closeAll(rec);
      rec.status = 'error';
    } else {
      rec.status = 'active';
    }
  }

  function closeAll(rec) {
    for (const c of rec.closers.splice(0)) {
      try { Promise.resolve(c && c()).catch(() => {}); } catch (e) { /* already closed */ }
    }
  }

  function deactivate(rec) {
    if (rec.status !== 'active') return;
    if (rec.deactivate) guard(rec, 'deactivate', rec.deactivate);
    closeAll(rec);
    rec.deactivate = null;
    rec.heroes = [];
    rec.pages = [];
    rec.settings = null;
    rec.status = 'disabled';
  }

  function remove(name) {
    const rec = plugins.get(name);
    if (!rec) return;
    deactivate(rec);
    plugins.delete(name);
    changed();
  }

  function setEnabled(name, on) {
    const rec = plugins.get(name);
    if (!rec || rec.status === 'invalid') return;
    if (on && (rec.status === 'disabled' || rec.status === 'error') && rec.module && typeof rec.module.activate === 'function') {
      activate(rec);
    } else if (!on) {
      deactivate(rec);
    }
    changed();
  }

  /**
   * Hero specs from active plugins, in the shape heroes.js's claim loop takes.
   * Card zone only: pinned instrument chrome stays first-party (RENDERING.md
   * §13 law 11 is about safety facts, and plugin code is not reviewed chrome).
   * On the builder grid each is a placeable control keyed
   * `hero:plugin:<name>:<id>` (settings.js placeableControls, DESIGN §10.2).
   */
  function heroes() {
    const out = [];
    for (const rec of plugins.values()) {
      if (rec.status !== 'active') continue;
      for (const h of rec.heroes) {
        if (h.failed) continue;
        out.push({
          id: 'plugin:' + rec.manifest.name + ':' + h.def.id,
          zone: 'card',
          title: String(h.def.title || h.def.id),
          spec: h.def.spec,
          absorb: h.def.absorb !== false,
          // DESIGN §3 tier-2 "renders instead": the built-in hero id (from
          // heroes.js's HEROES) this plugin takes over when its own claim
          // succeeds. roles.js's claimAll resolves it; a name that matches no
          // current built-in is simply never suppressed (opportunity, never a
          // requirement).
          replaces: h.def.replaces || null,
          // Builder minimum footprint per orientation; absent takes the composite default.
          cells: h.def.cells || null,
          plugin: rec.manifest.name,
          slot: h,
        });
      }
    }
    return out;
  }

  /** The operator's Show tab choice; absent, a factory plugin's pages show and an installed one's do not. */
  function pageShown(name) {
    let v = null;
    try { v = deps.prefs && deps.prefs.getItem(PAGES_KEY + name); } catch (e) { /* private mode */ }
    if (v === '1' || v === '0') return v === '1';
    const rec = plugins.get(name);
    return !!rec && rec.source === 'factory';
  }

  function setPageShown(name, on) {
    try { if (deps.prefs) deps.prefs.setItem(PAGES_KEY + name, on ? '1' : '0'); } catch (e) { /* private mode */ }
    changed();
  }

  /**
   * Shown pages of active plugins, shaped as heroes so mountHero, updateHero,
   * unmountHero and PluginSlot drive them unchanged. Id `plugin:<name>:<page id>`.
   */
  function pages() {
    const out = [];
    for (const rec of plugins.values()) {
      if (rec.status !== 'active' || !pageShown(rec.manifest.name)) continue;
      for (const p of rec.pages) {
        if (p.failed) continue;
        out.push({
          id: 'plugin:' + rec.manifest.name + ':' + p.def.id,
          label: p.def.label.trim(),
          icon: p.def.icon || null,
          spec: p.def.spec || {},
          fill: !!p.def.fill,
          search: (p.def.search || []).map((e) => ({ label: e.label, key: e.key })),
          mediaFullscreen: !!p.def.mediaFullscreen,
          status: !!p.def.status,
          compactHero: !!p.def.compactHero,
          plugin: rec.manifest.name,
          slot: p,
        });
      }
    }
    return out;
  }

  // A hero that throws is dropped, its claims released, and the fields it
  // held return to the generic renderer on the next claim pass.
  function heroFault(name, slot, where, e) {
    const rec = plugins.get(name);
    if (!rec) return;
    slot.failed = true;
    fault(rec, where + ' (' + slot.def.id + ')', e);
  }

  /** Mount a claimed hero into `el`. Returns an instance handle or null. */
  function mountHero(hero, el, fields) {
    try {
      const inst = hero.slot.def.mount(el, fields) || {};
      return { hero, inst };
    } catch (e) {
      heroFault(hero.plugin, hero.slot, 'mount', e);
      return null;
    }
  }

  function updateHero(h) {
    if (!h || typeof h.inst.update !== 'function' || h.hero.slot.failed) return;
    try { h.inst.update(); } catch (e) { heroFault(h.hero.plugin, h.hero.slot, 'update', e); }
  }

  function unmountHero(h) {
    if (!h || typeof h.inst.unmount !== 'function') return;
    try { h.inst.unmount(); } catch (e) { heroFault(h.hero.plugin, h.hero.slot, 'unmount', e); }
  }

  /** Mount a plugin's settings card; returns an unmount function. */
  function mountSettings(name, el) {
    const rec = plugins.get(name);
    if (!rec || !rec.settings) return () => {};
    const r = guard(rec, 'settings', () => rec.settings(el));
    return () => { if (typeof r === 'function') guard(rec, 'settings unmount', r); };
  }

  /** A plain snapshot for the Plugins pane. */
  function list() {
    return [...plugins.entries()].map(([key, r]) => ({
      key,
      name: (r.manifest && r.manifest.name) || key,
      version: r.manifest && r.manifest.version,
      kind: r.manifest && r.manifest.kind,
      description: (r.manifest && r.manifest.description) || '',
      roles: (r.manifest && r.manifest.roles) || [],
      channels: (r.manifest && r.manifest.channels) || [],
      permissions: (r.manifest && r.manifest.permissions) || [],
      credits: (r.manifest && Array.isArray(r.manifest.credits) && r.manifest.credits) || [],
      source: r.source,
      status: r.status,
      error: r.error,
      heroes: r.heroes.map((h) => ({ id: h.def.id, failed: h.failed })),
      pages: r.pages.map((p) => ({ id: p.def.id, label: p.def.label, failed: p.failed })),
      pageShown: pageShown(key),
      hasSettings: !!r.settings,
    }));
  }

  return {
    add, remove, setEnabled, heroes, pages, pageShown, setPageShown, mountHero, updateHero, unmountHero, mountSettings, list,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
