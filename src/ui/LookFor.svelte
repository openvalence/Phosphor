<script>
  /**
   * LookFor.svelte -- F3 (and Ctrl+F): find a control by name and go to it.
   *
   * Constraints:
   * - F3 and Ctrl+F are bound here, on the window, with preventDefault so the
   *   webview's find bar never opens. Escape closes and returns focus.
   * - The index is a $derived over what App already holds (`tabs`: category
   *   pages with their groups and heroes, the Valence and Phosphor panes,
   *   each with its tier's `section`, a plugin page with its own `path`, its
   *   claimed fields and its `search` entries), every saved Dash layout with
   *   its controls (dashboard.svelte.js) and the sources registered through
   *   searchIndex.js, so it rebuilds whenever any of them changes.
   * - A jump switches page through `go` (App's selectTab), reveals a hidden
   *   advanced or diagnostic field or a drill-in group with the page's own
   *   buttons, focuses the control and asks its Field for the locate sweep.
   *   The home never scrolls for it; a category page may.
   * - A home placement the catalog lacks lists inert, "not on this hub".
   * - Same overlay band as KeyHelp: no scrim, below the top strip. One
   *   overlay at a time: opening announces 'phosphor-overlay', and a pending
   *   confirm blocks F3.
   */
  import { tick } from 'svelte';
  import { machine, specSafetyAction, estopLabel } from '../model/machine.svelte.js';
  import { layouts, layoutNames, switchLayout } from '../model/dashboard.svelte.js';
  import { searchEntries } from './searchIndex.js';
  import { confirmUi } from './confirm.svelte.js';
  import { isNest, nestsIn, baseKey } from '../model/grid.js';
  import { placeableControls } from '../model/settings.js';
  import { labelFor } from '../model/format.js';
  import { view } from '../model/viewport.svelte.js';
  import { rank } from '../model/fuzzy.js';
  import { pluginsUi } from '../plugins/plugins.svelte.js';

  let { tabs = [], go = () => {} } = $props();

  let open = $state(false);
  let q = $state('');
  let at = $state(0);
  let inputEl = $state(null);
  let listEl = $state(null);
  let opener = null;

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const esc = (s) => CSS.escape(s);

  const index = $derived.by(() => {
    pluginsUi.gen;
    const out = [];
    for (const t of tabs) {
      out.push({ label: t.label, path: t.path || t.section, go: () => goTab(t.id) });
      if (t.page) {
        for (const f of Object.values(t.page.fields || {})) {
          if (f && f.uid) out.push({ label: labelFor(f), path: t.label, go: () => goKey(t, '[data-uid="' + esc(f.uid) + '"]') });
        }
        for (const e of t.page.search || []) out.push({ label: e.label, path: t.label, go: () => goKey(t, '[data-search-key="' + esc(e.key) + '"]') });
      }
      if (!t.cat) continue;
      for (const g of t.cat.groups) {
        const path = t.label + (g.name ? ' › ' + g.name : '');
        for (const f of g.fields) out.push({ label: labelFor(f), path, go: () => goField(t, g, f) });
      }
      for (const h of t.cat.heroes) {
        out.push({ label: h.title || cap(h.id), path: t.label, go: () => goCell(t.id, 'hero:' + h.id) });
      }
    }
    // Every saved layout's placements, nests named in the path. A seed home
    // (no placements built) is the category pages' fields, already listed.
    const model = machine.catalog.model;
    if (model) {
      const names = new Map();
      for (const c of placeableControls(model, { safety: specSafetyAction() })) {
        const label = c.kind === 'field' ? labelFor(c.field) : c.kind === 'safety' ? (c.key === 'safety:estop' ? estopLabel() : 'Pause') : null;
        if (!label) continue;
        names.set(c.key, label);
        if (c.alias) names.set(c.alias, label);
      }
      for (const t of tabs) for (const h of t.cat?.heroes || []) names.set('hero:' + h.id, h.title || cap(h.id));
      const MODULES = { 'widget:hero-rank': 'Machine', 'widget:telemetry': 'Telemetry', 'widget:actions': 'Actions' };
      for (const ln of layoutNames()) {
        const map = layouts.layouts[ln]?.[view.cls + '.machine'] || {};
        const dash = ln === layouts.active ? 'Dash' : 'Dash › ' + ln;
        out.push({ label: ln, path: 'Dash › layouts', go: () => { switchLayout(ln); return goTab('machine'); } });
        if (!Object.keys(map).some((k) => !isNest(map[k]) && !k.startsWith('home:'))) continue;
        const add = (key, nest) => {
          const b = baseKey(key);
          const label = names.get(b) || MODULES[b];
          const path = dash + (nest ? ' › ' + nest.title : '');
          if (label) out.push({ label, path, go: () => goCell('machine', key, nest && nest.id, ln) });
          else if (/^(uid|role):/.test(b)) out.push({ label: b.replace(/^\w+:/, ''), path, inert: true });
        };
        for (const k of Object.keys(map)) if (!isNest(map[k]) && !k.startsWith('home:')) add(k, null);
        for (const n of nestsIn(map)) {
          out.push({ label: n.title, path: dash, go: () => goCell('machine', n.id, null, ln) });
          for (const k of n.keys) add(k, n);
        }
      }
    }
    out.push(...searchEntries());
    return out;
  });

  const results = $derived(q.trim() ? rank(q, index) : index);
  $effect(() => { void q; at = 0; });

  let top = $state(0);
  async function show() {
    if (confirmUi.req) return;
    window.dispatchEvent(new CustomEvent('phosphor-overlay', { detail: 'look' }));
    opener = document.activeElement;
    top = document.querySelector('.topstrip')?.getBoundingClientRect().bottom ?? 0;
    q = '';
    open = true;
    await tick();
    inputEl?.focus();
  }
  function hide(restore = true) {
    open = false;
    if (restore && opener && opener.isConnected) opener.focus();
    opener = null;
  }
  function jump(it) {
    if (!it || it.inert) return;
    hide(false);
    it.go();
  }

  function onWindowKey(e) {
    const ctrlF = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
    if (e.key !== 'F3' && !ctrlF) return;
    e.preventDefault();
    if (open) hide(); else show();
  }
  function onInputKey(e) {
    const n = results.length;
    if (e.key === 'Escape') { e.preventDefault(); hide(); }
    else if (e.key === 'Enter') { e.preventDefault(); jump(results[at]); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault();
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      tick().then(() => listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    }
  }

  // ---- landing -------------------------------------------------------------
  const pane = () => document.querySelector('main.pane');
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // Up to ten frames for the page to mount what `find` looks for.
  async function settle(find = null) {
    await tick();
    for (let i = 0; i < 10; i++) { await frame(); if (!find || find()) return; }
  }

  function land(el, scroll) {
    if (!el) return;
    const f = el.querySelector('input[type=range]:not(:disabled), [role=slider][tabindex="0"], [role=radio][tabindex="0"], [role=switch]:not(:disabled), select:not(:disabled)')
      || el.querySelector('input:not(:disabled), textarea:not(:disabled), button:not(:disabled):not(.info), [tabindex="0"]');
    if (f) f.focus({ preventScroll: !scroll });
    if (scroll) el.scrollIntoView({ block: 'nearest' });
    const field = el.matches('.field') ? el : el.querySelector('.field[data-uid]');
    field?.dispatchEvent(new CustomEvent('locate'));
  }

  async function goTab(id) {
    go(id);
    await settle();
    document.querySelector('[role=tab][data-tab-id="' + esc(id) + '"]')?.focus();
  }

  async function goKey(t, sel) {
    go(t.id);
    const find = () => pane()?.querySelector(sel);
    await settle(find);
    land(find(), true);
  }

  async function goCell(tabId, key, nestId = null, layout = null) {
    if (layout && layout !== layouts.active) switchLayout(layout);
    go(tabId);
    await settle(() => pane()?.querySelector('.dash-cell[data-id="' + esc(nestId || key) + '"]'));
    const scope = nestId ? pane()?.querySelector('.dash-cell[data-id="' + esc(nestId) + '"]') : pane();
    const cells = [...(scope?.querySelectorAll('.dash-cell[data-id="' + esc(key) + '"]') || [])];
    land(cells.find((c) => nestId || !c.parentElement.closest('.nest')) || cells[0], tabId !== 'machine');
  }

  async function goField(t, g, f) {
    const find = () => pane()?.querySelector('.field[data-uid="' + esc(f.uid) + '"]');
    go(t.id);
    await settle(find);
    // Hidden by the page's own toggles, or promoted to a drill-in page: open
    // it the way the operator would.
    const reveal = [
      () => (g.diagnostic ? [...document.querySelectorAll('.page-foot .adv-toggle[aria-expanded="false"]')]
        .find((b) => /diagnostic/.test(b.textContent)) : null),
      () => (f.advanced ? [...document.querySelectorAll('.page-foot .adv-toggle[aria-expanded="false"]')]
        .find((b) => /advanced/.test(b.textContent)) : null),
      () => pane()?.querySelector('.dash-cell[data-id="' + esc((g.diagnostic ? 'diag:' : 'group:') + t.cat.id + ':'
        + (g.name || 'ungrouped')) + '"] .drill-open'),
    ];
    for (const r of reveal) {
      if (find()) break;
      const b = r();
      if (b) { b.click(); await settle(find); }
    }
    land(find(), true);
  }
</script>

<svelte:window onkeydown={onWindowKey} onphosphor-overlay={(e) => { if (open && e.detail !== 'look') hide(); }} />

{#if open}
  <div class="ov-band" style="--ov-top: {top}px">
    <div class="lf" role="dialog" aria-label="Look for a control">
      <input bind:this={inputEl} bind:value={q} class="lf-q" type="search" placeholder="Look for a control"
             role="combobox" aria-expanded="true" aria-controls="lf-list" aria-autocomplete="list"
             aria-activedescendant={results.length ? 'lf-' + at : undefined}
             onkeydown={onInputKey} />
      <ul class="lf-list" id="lf-list" role="listbox" aria-label="Controls" bind:this={listEl}>
        {#each results as it, i (i)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li id={'lf-' + i} role="option" aria-selected={i === at} aria-disabled={it.inert || undefined}
              class:on={i === at} class:inert={it.inert}
              onpointermove={() => (at = i)} onclick={() => jump(it)}>
            <span class="lf-label">{it.label}</span>
            <span class="lf-path">· {it.inert ? 'not on this hub' : it.path}</span>
          </li>
        {:else}
          <li class="lf-none" role="presentation">No match</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  /* The band under the top strip (z 30, measured at open): the stop stays
     reachable. The panel is centered in it, fixed size; the band itself
     takes no pointer. */
  .ov-band {
    position: fixed;
    inset: var(--ov-top) 0 0 0;
    z-index: 29;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    place-items: center;
    padding: var(--gap);
    pointer-events: none;
  }
  .lf {
    pointer-events: auto;
    width: min(100%, 560px);
    height: min(100%, 440px);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(var(--shade-rgb), .6);
  }
  .lf-q {
    flex: none;
    min-height: var(--tap);
    padding: 0 var(--sp-3);
    font: inherit;
    color: var(--ink-hi);
    background: var(--bg-sunken);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
  }
  .lf-q:focus-visible { outline: 1px solid var(--intent); outline-offset: 1px; }
  .lf-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
  li {
    display: flex;
    gap: var(--sp-2);
    align-items: baseline;
    min-height: 28px;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--radius);
    font-size: .82rem;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
  }
  li.on { background: var(--line-soft); box-shadow: inset 2px 0 0 var(--intent); }
  li.inert { cursor: default; opacity: .6; }
  .lf-label { color: var(--ink); flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; }
  .lf-path { color: var(--ink-dim); overflow: hidden; text-overflow: ellipsis; }
  .lf-none { color: var(--ink-faint); cursor: default; }
  @media (pointer: coarse) { li { min-height: var(--tap); } }
  .lf { animation: lf-rise var(--t-quick) ease-out; }
  @keyframes lf-rise { from { opacity: 0; } to { opacity: 1; } }
</style>
