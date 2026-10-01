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

/** Host API major. Bumped only by a breaking change, which the freeze forbids once one external plugin exists. */
export const API_VERSION = 1;

export const KINDS = ['widget', 'adapter', 'theme'];

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PERM_RE = /^(intent|motion|net\.listen:([1-9][0-9]{0,4}))$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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
  for (const p of m.permissions || []) {
    const hit = typeof p === 'string' && PERM_RE.exec(p);
    if (!hit || (hit[2] && Number(hit[2]) > 65535)) errs.push('unknown permission "' + p + '"');
  }
  return errs;
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
 *   write(field, value)           -> routes to the right shadow entry point
 *   submitMotion(norm, durationMs)-> {ok, reason?}
 *   registerTheme(theme)          -> adds an accent pair to the theme table
 *   listenTcp(port, onLine)       -> Promise<close()>  (absent outside the shell)
 *   prefs                         -> Storage-like {getItem, setItem} or null
 *   log(pluginName, level, msg)   -> the log pane
 */
export function createPluginHost(deps) {
  /** name -> record */
  const plugins = new Map();
  const listeners = new Set();

  function changed() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { /* a kernel listener, not plugin code */ }
    }
  }

  function record(manifest, source) {
    return {
      manifest, source, status: 'loaded', error: null,
      heroes: [], settings: null, closers: [], deactivate: null,
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

      // ---- write: the shadow entry points, gated by the manifest ----
      write: (field, value) => { need(rec, 'intent'); return deps.write(field, value); },
      submitMotion: (norm, durationMs) => { need(rec, 'motion'); return deps.submitMotion(norm, durationMs); },

      // ---- contributions ----
      registerHero: (def) => {
        if (!def || typeof def.id !== 'string' || typeof def.mount !== 'function' || !def.spec) {
          throw new Error('registerHero needs {id, spec, mount}');
        }
        if (def.replaces != null && typeof def.replaces !== 'string') {
          throw new Error('registerHero: replaces must be a built-in hero id string');
        }
        const cellPair = (c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n) && n > 0 && n <= 64);
        if (def.cells != null && !(cellPair(def.cells.h) && cellPair(def.cells.v))) {
          throw new Error('registerHero: cells must be {h: [w, h], v: [w, h]} in whole grid cells');
        }
        rec.heroes.push({ def, failed: false });
        if (rec.status === 'active') changed();
      },
      registerSettings: (mount) => {
        if (typeof mount !== 'function') throw new Error('registerSettings needs a mount function');
        rec.settings = mount;
        if (rec.status === 'active') changed();
      },
      registerTheme: (t) => {
        if (rec.manifest.kind !== 'theme') throw new Error('registerTheme is for kind "theme"');
        if (!t || !NAME_RE.test(t.id || '') || !HEX_RE.test(t.reality || '') || !HEX_RE.test(t.intent || '')) {
          throw new Error('registerTheme needs {id, name, reality: #rrggbb, intent: #rrggbb}');
        }
        // Accent pair only: the neutral chassis and the safety colors are not
        // reachable from here, by construction (webui.md, house look).
        deps.registerTheme({ id: name + '-' + t.id, name: String(t.name || t.id), reality: t.reality, intent: t.intent });
      },

      // ---- services ----
      net: Object.freeze({
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
      source: r.source,
      status: r.status,
      error: r.error,
      heroes: r.heroes.map((h) => ({ id: h.def.id, failed: h.failed })),
      hasSettings: !!r.settings,
    }));
  }

  return {
    add, remove, setEnabled, heroes, mountHero, updateHero, unmountHero, mountSettings, list,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
