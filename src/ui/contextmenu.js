/**
 * contextmenu.js -- the shell's one context menu (DESIGN 10.13, ph-kyjd): it
 * replaces the webview's own (Print, Reload, Inspect, its text menu)
 * everywhere, with items for what was clicked, innermost first: a plugin's
 * own element (api.ui.menu), the field, the module or card around it, the
 * page. Text entry lists its edits first. Plugins add items through
 * api.registerMenu and api.ui.menu (docs/PLUGINS.md, Context menus).
 *
 * Constraints:
 * - A surface that takes its own right-click (the Dash's edit-mode add menu,
 *   the node editor) prevents the event first; this menu then stays out.
 * - A dev build keeps the webview's menu behind Shift+right-click; a release
 *   build turns it off in WebView2 itself (src-tauri/src/lib.rs).
 * - A long press is the touch right-click; one that began a drag
 *   ([data-drag]) opens nothing. In text entry a long press keeps the
 *   platform's selection handles and bar.
 * - Every write takes the plugin write door (plugins.svelte.js write): the
 *   confirm, the ladder and the refusal banner a control's own write gets.
 * - Add to Dash is offered on the full class only: the other classes draw
 *   every Dash as its seed (ph-e82.7), so an add there would show nowhere.
 * - Never read the clipboard to draw a menu: a webview read asks the user for
 *   permission (WebView2's prompt). Paste reads once, on the pick; the shell
 *   reads and writes through the native clipboard plugin, which never asks.
 */
import { tick } from 'svelte';
import { menu, ownMenus } from '../plugins/kit.js';
import { machine, specSafetyAction } from '../model/machine.svelte.js';
import { displayValue } from '../model/shadow.svelte.js';
import { resetsToDefault, placeableControls, WIDGET } from '../model/settings.js';
import { fieldByUid, fieldKey, partKeys, pathOf, resolveIdentity, fieldKeysOf, pasteValue } from '../model/identity.js';
import { labelFor } from '../model/format.js';
import { sameValue } from '../model/merge.js';
import { history, say } from '../model/history.svelte.js';
import { heroClaims } from './heroes.js';
import { logView } from './logview.svelte.js';
import { host, pluginHeroes, write, gate, currentHub } from '../plugins/plugins.svelte.js';
import { view } from '../model/viewport.svelte.js';
import { layouts, orderedLayoutNames, addLayout, switchLayout } from '../model/dashboard.svelte.js';
import { baseKey } from '../model/grid.js';
import { seedKeys, dashHolds, addToDash } from './Home.svelte';

/** Field refs sent while no node editor was mounted to take them, oldest first; the editor empties it on mount. */
export const nodeQueue = [];

/**
 * Hand field identities to the node editor: `phosphor-node-add` on window
 * (cancelable, detail {refs: [{kind: 'field', key}]}), which a mounted editor
 * takes by preventDefault(); else they wait in nodeQueue. -> taken
 */
export function sendToNodes(keys) {
  const refs = keys.map((key) => ({ kind: 'field', key }));
  if (!refs.length) return false;
  if (!window.dispatchEvent(new CustomEvent('phosphor-node-add', { cancelable: true, detail: { refs } }))) return true;
  nodeQueue.push(...refs);
  return false;
}

const TEXT = 'input:not([type=range], [type=checkbox], [type=radio], [type=button], [type=submit], [type=color], [type=file]), textarea, [contenteditable]:not([contenteditable=false])';
const MODULE = '[data-menu-key], .dash-cell[data-id], .hero-slot[data-hero], .topstrip .mini';

const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;
const native = (cmd, args) => import('@tauri-apps/api/core').then(({ invoke }) => invoke('plugin:clipboard-manager|' + cmd, args));

let lastCopy = '';
function copy(text, done) {
  lastCopy = text;
  (SHELL ? native('write_text', { text }) : Promise.reject()).catch(() => navigator.clipboard?.writeText(text)).catch(() => {});
  if (done) say(done);
}
/** The clipboard's text, on a pick only; a refused or empty read (no clipboard on a plain-http page) is the last in-app copy. */
const readClip = () => Promise.resolve()
  .then(() => (SHELL ? native('read_text') : navigator.clipboard.readText()))
  .then((t) => (typeof t === 'string' && t ? t : lastCopy), () => lastCopy);

const valueOf = (f) => displayValue(f, machine.samples[f.channelId]);

const canExec = (cmd) => { try { return document.queryCommandEnabled(cmd); } catch { return true; } };
/** Undo, Cut, Copy, Paste and Select all on a text entry, enabled by its state; Paste reads the clipboard on the pick. */
function editItems(el) {
  el.focus({ preventScroll: true });
  const locked = !el.isContentEditable && (el.readOnly || el.disabled) ? 'read only' : '';
  const hidden = el.type === 'password' ? 'hidden text' : '';
  const sel = el.selectionStart != null ? el.value.slice(el.selectionStart, el.selectionEnd) : String(getSelection() || '');
  const none = sel ? '' : 'nothing selected';
  const exec = (cmd, arg) => { el.focus({ preventScroll: true }); document.execCommand(cmd, false, arg); };
  return [
    { label: 'Undo', disabled: locked || (canExec('undo') ? '' : 'nothing to undo'), run: () => exec('undo') },
    { label: 'Cut', disabled: locked || hidden || none, run: () => { copy(sel); exec('delete'); } },
    { label: 'Copy', disabled: hidden || none, run: () => copy(sel) },
    { label: 'Paste', disabled: locked, run: async () => {
      const text = await readClip();
      if (text) exec('insertText', text); else say('Paste: the clipboard is empty');
    } },
    { label: 'Select all', disabled: (el.isContentEditable ? el.textContent : el.value) ? '' : 'empty', run: () => exec('selectAll') },
  ];
}

/** The targets under `node`, innermost first: a plugin's own elements, the field and the module in DOM order, then the page. */
function chainAt(node, tab, heroes, at) {
  const model = machine.catalog.model, hub = currentHub();
  const out = [];
  const fe = node.closest('.field[data-uid]');
  const f = fe && fieldByUid(model, fe.dataset.uid);
  if (f) out.push({ kind: 'field', el: fe, key: fieldKey(model, f), title: labelFor(f), desc: f.desc || '', field: f });
  const me = node.closest(MODULE);
  if (me && model) {
    const raw = me.dataset.menuKey || me.dataset.id || 'hero:' + (me.dataset.hero || 'rail');
    const found = resolveIdentity(model, heroes, raw, specSafetyAction());
    const key = found && (found.control ? found.control.key : raw.replace(/#\d+$/, ''));
    if (found && !(out[0] && out[0].key === key)) out.push({ kind: 'module', el: me, key, title: found.title, found });
  }
  for (const o of ownMenus(node, at)) out.push({ kind: 'own', ...o });
  out.sort((a, b) => (a.el.contains(b.el) ? 1 : b.el.contains(a.el) ? -1 : 0));
  if (tab) out.push({ kind: 'page', key: tab.id, title: tab.label });
  for (const t of out) if (t.kind !== 'own') { t.hub = hub; t.path = hub ? pathOf(hub, t.key) : ''; }
  return out;
}

function fieldItems(t, nav) {
  const f = t.field, model = machine.catalog.model;
  const single = f.widget !== WIDGET.action && !f.lo && !f.r && f.widget !== WIDGET.secret;
  const items = [{ label: 'Copy path', disabled: t.path ? '' : 'no hub', run: () => copy(t.path, 'Path copied') }];
  if (single) items.push({ label: 'Copy value', disabled: valueOf(f) == null ? 'no value yet' : '', run: () => copy(String(valueOf(f)), 'Value copied') });
  if (single && !f.readOnly) {
    items.push({ label: 'Paste value', disabled: gate(f), run: async () => {
      const v = pasteValue(f, await readClip());
      if (v === undefined) say('Paste: no fitting value on the clipboard');
      else write(f, v);
    } });
  }
  if (resetsToDefault(f)) {
    items.push({ label: 'Reset to default', disabled: gate(f) || (sameValue(valueOf(f), f.dflt) ? 'at default' : ''), run: () => write(f, f.dflt) });
  }
  if (f.widget !== WIDGET.action) items.push({ label: 'Send to node editor', run: () => nodes(partKeys(model, f)) });
  if (history.entries.some((e) => e.uid === f.uid)) items.push({ label: 'Show in history', run: () => { logView.tab = 'changes'; nav.go('log'); } });
  return items;
}

function moduleItems(t) {
  const keys = fieldKeysOf(machine.catalog.model, t.found);
  const items = [{ label: 'Copy path', disabled: t.path ? '' : 'no hub', run: () => copy(t.path, 'Path copied') }];
  if (keys.length) items.push({ label: 'Send fields to node editor', run: () => nodes(keys) });
  return items;
}

const nodes = (keys) => say(sendToNodes(keys) ? 'Sent to the node editor' : 'Queued for the node editor');

const FOCUSABLE = 'input, button, select, [tabindex]:not([tabindex="-1"])';

/** Open Dash `n` and bring its first card placing any of `ids` into view. */
async function showOnDash(nav, n, ids) {
  nav.dash(n);
  await tick();
  await new Promise(requestAnimationFrame);
  const cell = [...document.querySelectorAll('.dash-cell[data-id]')].find((c) => ids.includes(baseKey(c.dataset.id)));
  if (!cell) return;
  cell.scrollIntoView({ block: 'center' });
  // Each in turn until one takes focus: a hidden or inert match refuses it.
  for (const el of cell.querySelectorAll(FOCUSABLE)) {
    el.focus({ preventScroll: true });
    if (document.activeElement === el) break;
  }
}

/**
 * Add to Dash: every layout, then New Dash... A layout that holds the target
 * is checked and opens on it; any other takes it at the first free rect and
 * the page stays. A new layout holds only the target: its seed was never seen.
 */
function dashItems(t, heroes, nav) {
  const model = machine.catalog.model;
  const c = !model || view.cls !== 'full' ? null : t.key.startsWith('widget:') ? { key: t.key }
    : placeableControls(model, { heroes: heroes.widgets, safety: specSafetyAction() }).find((x) => x.key === t.key);
  if (!c) return [];
  const ids = [c.key, c.alias].filter(Boolean), seed = seedKeys(heroes);
  const add = (n, s) => { if (addToDash(n, c.key, s)) say('Added to ' + n); };
  return [{ label: 'Add to Dash', items: [
    ...orderedLayoutNames().map((n) => (dashHolds(n, ids, seed)
      ? { label: n, checked: true, title: 'Show it there', run: () => showOnDash(nav, n, ids) }
      : { label: n, checked: false, run: () => add(n, seed) })),
    { label: 'New Dash…', ask: { label: 'New Dash name', placeholder: 'Dash name', commit: (name) => {
      const was = layouts.active;
      if (!addLayout(name)) return 'Name taken';
      switchLayout(was);
      add(name, []);
      return '';
    } } },
  ] }];
}

/**
 * Take over the context menu. `nav`: {tab() -> the page on screen {id, label},
 * go(tabId), dash(layout) opens the Dash on a layout, items(target, chain) ->
 * the page's own items for a target}. -> uninstall()
 */
export function installContextMenu(nav) {
  let open = null, kb = { at: 0, el: null }, pointer = 'mouse';
  const show = (node, x, y, keyboard) => {
    if (open) open.close();
    const model = machine.catalog.model;
    const heroes = model ? heroClaims(model.byRole, pluginHeroes()) : null;
    const entry = node.closest(TEXT);
    let chain = chainAt(node, nav.tab(), heroes, { x, y, keyboard, target: node });
    // Text entry: its edits, then the field's items when it is a field's own input.
    if (entry && (!chain[0] || chain[0].kind !== 'field')) chain = [];
    const items = entry ? editItems(entry) : [];
    chain.forEach((t) => {
      let list = t.items || [];
      if (t.kind !== 'own') {
        const own = t.kind === 'field' ? [...fieldItems(t, nav), ...dashItems(t, heroes, nav)]
          : t.kind === 'module' ? [...moduleItems(t), ...dashItems(t, heroes, nav)] : [];
        const mine = Object.freeze({ kind: t.kind, key: t.key, hub: t.hub, title: t.title, path: t.path });
        list = [...own, ...nav.items(t, chain), ...host.menus(mine)];
      }
      if (list.length && items.length) list = [{ ...list[0], section: t.title }, ...list.slice(1)];
      items.push(...list);
    });
    if (!items.length) return;
    const top = entry ? null : chain[0];
    const el = open = menu({ title: top ? top.title : '', desc: (top && top.desc) || '', items, x, y, onClose: () => { if (open === el) open = null; } });
  };
  const onDown = (e) => { pointer = e.pointerType; };
  const onMenu = (e) => {
    if (e.defaultPrevented || !(e.target instanceof Element)) return;
    if (import.meta.env.DEV && e.shiftKey) return;
    const entry = e.target.closest(TEXT);
    if (entry && (e.pointerType || pointer) === 'touch') return;
    e.preventDefault();
    // Inside an open menu (its New Dash name field) nothing opens over it.
    if (e.target.closest('.ui-menu')) return;
    // A modal (a confirm) owns the screen: nothing to act on behind it but its own text entry.
    if (!entry && e.target.closest('[aria-modal="true"], dialog[open]')) return;
    // The webview's own contextmenu after the menu key's keydown, and a long press that began a drag, open nothing.
    if ((e.target === kb.el && performance.now() - kb.at < 300) || document.querySelector('[data-drag]')) return;
    show(e.target, e.clientX, e.clientY, false);
  };
  // The menu key and Shift+F10 open it on the focused element, at its corner.
  const onKey = (e) => {
    if (e.defaultPrevented || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    const t = document.activeElement instanceof Element && document.activeElement !== document.body ? document.activeElement : null;
    if (!t || t.closest('.ui-menu')) return;
    e.preventDefault();
    kb = { at: performance.now(), el: t };
    const r = t.getBoundingClientRect();
    show(t, r.left, r.bottom, true);
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('contextmenu', onMenu);
  window.addEventListener('keydown', onKey);
  return () => {
    if (open) open.close();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('contextmenu', onMenu);
    window.removeEventListener('keydown', onKey);
  };
}
