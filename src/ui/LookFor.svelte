<script>
  /**
   * LookFor.svelte -- F3 (and Ctrl+F): find a control by name and go to it.
   *
   * Constraints:
   * - F3 and Ctrl+F are bound here, on the window, with preventDefault so the
   *   webview's find bar never opens. Escape closes and returns focus.
   * - The index is built at open time from what App already holds (`tabs`:
   *   category pages with their groups and heroes, the console and shell
   *   panes) plus the saved home layout (dashboard.svelte.js); no store.
   * - A jump switches page through `go` (App's selectTab), reveals a hidden
   *   advanced or diagnostic field or a drill-in group with the page's own
   *   buttons, focuses the control and asks its Field for the locate sweep.
   *   The home never scrolls for it; a category page may.
   * - A home placement the catalog lacks lists inert, "not on this hub".
   * - Same overlay band as KeyHelp: no scrim, below the top strip.
   */
  import { tick } from 'svelte';
  import { machine, specSafetyAction, estopLabel } from '../model/machine.svelte.js';
  import { layouts } from '../model/dashboard.svelte.js';
  import { viewMap, isNest, nestsIn, baseKey } from '../model/grid.js';
  import { placeableControls } from '../model/settings.js';
  import { labelFor } from '../model/format.js';
  import { view } from '../model/viewport.svelte.js';

  let { tabs = [], go = () => {} } = $props();

  let open = $state(false);
  let q = $state('');
  let at = $state(0);
  let index = $state([]);
  let inputEl = $state(null);
  let listEl = $state(null);
  let opener = null;

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const sectionOf = (t) => (t.id === 'machine' || t.cat ? 'Machine' : t.pane ? 'Phosphor' : 'Console');
  const esc = (s) => CSS.escape(s);

  function build() {
    const out = [];
    for (const t of tabs) {
      out.push({ label: t.label, path: sectionOf(t), go: () => goTab(t.id) });
      if (!t.cat) continue;
      for (const g of t.cat.groups) {
        const path = t.label + (g.name ? ' › ' + g.name : '');
        for (const f of g.fields) out.push({ label: labelFor(f), path, go: () => goField(t, g, f) });
      }
      for (const h of t.cat.heroes) {
        out.push({ label: h.title || cap(h.id), path: t.label, go: () => goCell(t.id, 'hero:' + h.id) });
      }
    }
    // The built home's placements, nests named in the path. The seed home is
    // the category pages' fields, already listed.
    const model = machine.catalog.model;
    const map = view.cls === 'full' ? viewMap(layouts, view.cls, 'machine', false) : {};
    if (model && Object.keys(map).some((k) => !isNest(map[k]) && !k.startsWith('home:'))) {
      const names = new Map();
      for (const c of placeableControls(model, { safety: specSafetyAction() })) {
        const label = c.kind === 'field' ? labelFor(c.field) : c.kind === 'safety' ? (c.key === 'safety:estop' ? estopLabel() : 'Pause') : null;
        if (!label) continue;
        names.set(c.key, label);
        if (c.alias) names.set(c.alias, label);
      }
      for (const t of tabs) for (const h of t.cat?.heroes || []) names.set('hero:' + h.id, h.title || cap(h.id));
      const MODULES = { 'widget:hero-rank': 'Machine', 'widget:telemetry': 'Telemetry', 'widget:actions': 'Actions' };
      const add = (key, nest) => {
        const b = baseKey(key);
        const label = names.get(b) || MODULES[b];
        const path = 'Home' + (nest ? ' › ' + nest.title : '');
        if (label) out.push({ label, path, go: () => goCell('machine', key, nest && nest.id) });
        else if (/^(uid|role):/.test(b)) out.push({ label: b.replace(/^\w+:/, ''), path, inert: true });
      };
      for (const k of Object.keys(map)) if (!isNest(map[k]) && !k.startsWith('home:')) add(k, null);
      for (const n of nestsIn(map)) {
        out.push({ label: n.title, path: 'Home', go: () => goCell('machine', n.id) });
        for (const k of n.keys) add(k, n);
      }
    }
    return out;
  }

  // Ranked by where the match starts: in the label first, then in the path.
  const results = $derived.by(() => {
    const s = q.trim().toLowerCase();
    if (!s) return index;
    const scored = [];
    for (const it of index) {
      const i = it.label.toLowerCase().indexOf(s);
      const j = i < 0 ? it.path.toLowerCase().indexOf(s) : -1;
      if (i >= 0 || j >= 0) scored.push([i >= 0 ? i : 1000 + j, it]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label)).map((x) => x[1]);
  });
  $effect(() => { void q; at = 0; });

  let top = $state(0);
  async function show() {
    opener = document.activeElement;
    top = document.querySelector('.topstrip')?.getBoundingClientRect().bottom ?? 0;
    index = build();
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

  async function goCell(tabId, key, nestId = null) {
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
      () => (g.diagnostic ? [...document.querySelectorAll('.cat-bar .adv-toggle[aria-expanded="false"]')]
        .find((b) => /diagnostic/.test(b.textContent)) : null),
      () => (f.advanced ? [...document.querySelectorAll('.cat-bar .adv-toggle[aria-expanded="false"]')]
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

<svelte:window onkeydown={onWindowKey} />

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
    gap: 8px;
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(var(--shade-rgb), .6);
  }
  .lf-q {
    flex: none;
    min-height: var(--tap);
    padding: 0 10px;
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
    gap: 6px;
    align-items: baseline;
    min-height: 28px;
    padding: 4px 8px;
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
  @media (prefers-reduced-motion: no-preference) {
    .lf { animation: lf-rise .14s ease-out; }
  }
  @keyframes lf-rise { from { opacity: 0; } to { opacity: 1; } }
</style>
