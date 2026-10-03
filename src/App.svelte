<script>
  /**
   * App.svelte — the composition root.
   *
   * Reads the settings model, lets hero widgets CLAIM the fields they can draw
   * better, and hands everything left over to the generic renderer. The nav
   * set is the machine's own category list, so a hub with categories we have
   * never heard of gets nav entries we have never written.
   *
   * The sharpest test of this refactor lives here: there is no per-channel code
   * below. Add a settings channel to the firmware and it appears.
   *
   * ONE NAV MODEL, TWO RENDERINGS. The same tabs array (and the same `active`
   * id) drives a sidebar rail in the `full` renderer class and a horizontal
   * tab strip in `handheld` and `glance` (model/viewport.svelte.js, RFC-062
   * draft). A class switch mid-session must never lose the operator's place
   * or a pending write, and never forks the nav logic.
   */
  import Field from './ui/Field.svelte';
  import ActionField from './ui/ActionField.svelte';
  import FootStrip from './ui/FootStrip.svelte';
  import PageFoot from './ui/PageFoot.svelte';
  import TopStrip from './ui/TopStrip.svelte';
  import ConfirmLayer from './ui/ConfirmLayer.svelte';
  import KeyHelp from './ui/KeyHelp.svelte';
  import LookFor from './ui/LookFor.svelte';
  import { askConfirm } from './ui/confirm.svelte.js';
  import ValencePane from './ui/ValencePane.svelte';
  import LogPane from './ui/LogPane.svelte';
  import PairingPane from './ui/PairingPane.svelte';
  import ThemePicker from './ui/ThemePicker.svelte';
  import HeroStrip from './ui/HeroStrip.svelte';
  import Home from './ui/Home.svelte';
  import DashGrid from './ui/dash/DashGrid.svelte';
  import HubPicker from './ui/HubPicker.svelte';
  import { untrack } from 'svelte';
  import { view } from './model/viewport.svelte.js';
  import { projectGroups } from './model/rclass.js';
  import { machine } from './model/machine.svelte.js';
  import { isFieldEnabled, resetsToDefault, WIDGET } from './model/settings.js';
  import { UI_CATEGORY, UI_CATEGORY_TIER, UI_NAV_TIER } from '../../Valence/clients/js/index.js';
  import { navIcon } from './ui/navIcons.js';
  import { writeSetting, statusOf, STATUS } from './model/shadow.svelte.js';
  import { withoutClaimed } from './model/roles.js';
  import { heroClaims } from './ui/heroes.js';
  import PluginsPane from './plugins/PluginsPane.svelte';
  import { pluginsUi, pluginHeroes } from './plugins/plugins.svelte.js';
  import { panes as shellPanes } from './shell/panes.js';
  import './ui/select.css';

  // shell: the Tauri shell's strip row from main.js, null on the served page.
  let { shell = null } = $props();
  // main.js's shell signal; the served page never shows the Phosphor group.
  const SHELL = !!import.meta.env.TAURI_ENV_PLATFORM;

  const model = $derived(machine.catalog.model);

  // Hero widgets get first refusal on the fields they understand. Whatever they
  // take is removed from the generic tree so no value is drawn twice.
  // Tier-2 plugin heroes claim through the same pass, after the built-ins;
  // pluginsUi.gen re-runs it when a plugin is enabled, disabled or faults.
  const heroes = $derived(model
    ? heroClaims(model.byRole, (pluginsUi.gen, pluginHeroes()))
    : { widgets: [], claimed: new Set() });

  // The derived tree carries every field without the home (DESIGN §10.1,
  // RENDERING §12): a card-zone hero sits on the page of the category its
  // claimed fields came from, and uncategorized triggers join the `other`
  // overflow page (RENDERING §3).
  const categories = $derived.by(() => {
    if (!model) return [];
    const kept = new Map(withoutClaimed(model.categories, heroes.claimed).map((c) => [c.key, c]));
    const homeOf = (h) => {
      const uids = new Set(h.fields.claimed);
      const c = model.categories.find((c) => c.groups.some((g) => g.fields.some((f) =>
        uids.has(f.uid) || (f.lo && uids.has(f.lo.uid)) || (f.hi && uids.has(f.hi.uid)))));
      return c ? c.key : null;
    };
    const cards = heroes.widgets.filter((h) => h.zone === 'card');
    const cats = model.categories.map((c) => ({
      ...(kept.get(c.key) || { ...c, groups: [] }),
      heroes: cards.filter((h) => homeOf(h) === c.key),
    }));
    const loose = model.looseActions.filter((a) => !heroes.claimed.has(a.uid));
    const strays = cards.filter((h) => homeOf(h) == null);
    if (loose.length || strays.length) {
      const groups = loose.length ? [{ name: 'Actions', title: 'Actions', diagnostic: false, fields: loose }] : [];
      const other = cats.find((c) => c.known && c.id === UI_CATEGORY.other);
      if (other) { other.groups = [...other.groups, ...groups]; other.heroes = [...other.heroes, ...strays]; }
      else cats.push({ key: 'other', id: UI_CATEGORY.other, label: 'Other', known: true, writable: true, groups, heroes: strays });
    }
    return cats.filter((c) => c.groups.length || c.heroes.length);
  });

  // heroes.js's zone split: 'instrument' heroes are pinned chrome (the hero
  // strip, below); 'card' heroes are home modules and category-page cards.
  const instrumentHeroes = $derived(heroes.widgets.filter((h) => h.zone === 'instrument'));

  // Nav: the registry's three tiers in order (RENDERING §3, RFC-094), each a
  // section: the machine's categories by their registry tier, plus our own
  // fixed views placed by tier membership (DESIGN §10.11). The fixed ones are
  // the only hardcoded entries in the page. Tab ids are storage keys: 'machine'
  // is the Dash's layout view id (Home.svelte), 'valence' the Link pane's.
  const ready = $derived(machine.catalog.ready);
  const tierOf = (c) => (c.known && UI_CATEGORY_TIER[c.id]) || UI_NAV_TIER.machine;
  const catTabs = (tier) => categories.filter((c) => tierOf(c) === tier)
    .map((c) => ({ id: 'cat' + c.key, label: c.label, cat: c }));
  const machineTabs = $derived([{ id: 'machine', label: 'Dash' }, ...catTabs(UI_NAV_TIER.machine)]);
  const linkTabs = $derived(ready ? [
    { id: 'pairing', label: 'Pairing' },
    { id: 'valence', label: 'Link' },
    { id: 'log', label: 'Log' },
    ...catTabs(UI_NAV_TIER.link),
  ] : []);
  // The shell's Settings pane hosts the Display pane's editor, so the shell
  // draws one of the two. Shell panes (shell/panes.js) stand before any
  // catalog, since Hubs is how one arrives.
  const shellPaneTabs = $derived(SHELL
    ? $shellPanes.map((p) => ({ id: 'shell:' + p.id, label: p.label, pane: p }))
    : []);
  const clientTabs = $derived([
    ...(ready && !shellPaneTabs.some((t) => t.pane.id === 'settings') ? [{ id: 'display', label: 'Display' }] : []),
    ...(ready && pluginsUi.active ? [{ id: 'plugins', label: 'Plugins' }] : []),
    ...shellPaneTabs,
  ]);
  const TIER_LABEL = { [UI_NAV_TIER.machine]: 'Machine', [UI_NAV_TIER.link]: 'Valence', [UI_NAV_TIER.client]: 'Phosphor' };
  const navSections = $derived([
    { tier: UI_NAV_TIER.machine, tabs: machineTabs },
    { tier: UI_NAV_TIER.link, tabs: linkTabs },
    { tier: UI_NAV_TIER.client, tabs: clientTabs, shell: SHELL },
  ].filter((s) => s.tabs.length).map((s) => ({ ...s, label: TIER_LABEL[s.tier] })));
  const tabs = $derived(navSections.flatMap((s) => s.tabs.map((t) => ({ ...t, section: s.label }))));

  // First run in the shell (no hub dialed at launch) opens on Hubs.
  let active = $state(SHELL && !machine.link.host ? 'shell:hubs' : 'machine');
  const current = $derived(tabs.find((t) => t.id === active) || tabs[0]);

  // The renderer class decides WHICH rendering of the nav mounts (rail vs tab
  // strip). RFC-062 draft: re-derived live with hysteresis, and never while a
  // pointer is down (model/viewport.svelte.js).
  const isDesktop = $derived(view.cls === 'full');

  // Scroll anchor across a class switch: the card at the top of the view
  // before the remount is brought back into view after it.
  let anchor = null;
  $effect.pre(() => {
    view.cls;
    anchor = untrack(topCardId);
  });
  $effect(() => {
    view.cls;
    const id = anchor;
    anchor = null;
    if (!id) return;
    for (const el of document.querySelectorAll('.dash-cell[data-id]')) {
      if (el.dataset.id === id) { el.scrollIntoView({ block: 'center' }); break; }
    }
  });
  function topCardId() {
    for (const el of document.querySelectorAll('.dash-cell[data-id]')) {
      const top = el.closest('.content')?.getBoundingClientRect().top ?? 0;
      if (el.getBoundingClientRect().bottom > top) return el.dataset.id;
    }
    return null;
  }

  // NAV-SWITCH VISIBILITY. A tab switch must always produce visible change
  // (operator-reported defect: a pane switched below the fold, with nothing
  // on screen indicating anything had happened).
  //
  // Desktop needs no scrollIntoView: .content is the scroll container and a
  // freshly rendered pane starts at its own top by construction. It DOES
  // need its scroll position reset on every switch, though, or a pane opened
  // while scrolled halfway down the previous one inherits that scroll offset.
  let contentEl = $state(null);
  $effect(() => {
    active; // dependency: re-run this on every tab switch, NOT on a class switch
    untrack(() => { if (isDesktop && contentEl) contentEl.scrollTop = 0; });
  });

  // Mobile: the tab strip itself must scroll to the top of the viewport on
  // activation, since the page (not a bounded region) is what scrolls here.
  let tabsNav = $state(null);
  // The promoted group page open in the active category (RENDERING §11).
  let drill = $state(null);
  function selectTab(id) {
    active = id;
    drill = null;
    tabsNav?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  // Rail collapse is a browser preference. Icons come from the registry
  // category id or our own pane id (ui/navIcons.js), never a device label.
  let railMini = $state(loadRailPref());
  function loadRailPref() {
    try { return localStorage.getItem('sd32.navMini') === '1'; } catch (e) { return false; }
  }
  function toggleRail() {
    railMini = !railMini;
    try { localStorage.setItem('sd32.navMini', railMini ? '1' : '0'); } catch (e) { /* private mode */ }
  }
  // WAI-ARIA tabs pattern: roving tabindex (only the active tab is in the Tab
  // order; ArrowUp/Down or Left/Right move focus AND selection between tabs
  // within the strip, so a plain Tab key leaves the whole tablist in one
  // step instead of stepping through every tab). Vertical for the desktop
  // rail, horizontal for the phone strip — same handler, one axis argument.
  function onTablistKeydown(e, vertical) {
    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
    if (e.key !== nextKey && e.key !== prevKey) return;
    e.preventDefault();
    const list = [...e.currentTarget.querySelectorAll('[role=tab]')];
    const idx = list.indexOf(document.activeElement);
    if (idx < 0) return;
    const next = list[(idx + (e.key === nextKey ? 1 : -1) + list.length) % list.length];
    next.focus();
    active = next.dataset.tabId;
  }

  // Card-zone hero titles come from OUR registry ids (heroes.js), never a
  // device string — a plain first-letter capitalization is all that needs.
  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /**
   * ADVANCED DISCLOSURE.
   *
   * A setting is advanced when it says so EITHER way — the RFC-009 flag bit or
   * ui_ranks.advanced, which RENDERING.md §4 defines as that bit's migration
   * into the rank ladder. settings.js resolves both into one `f.advanced`.
   *
   * That stopped being cosmetic once this machine started advertising 44
   * advanced pattern-modifier settings on top of 20 advanced tuning knobs: the
   * honest generic rendering of that is a wall of sliders that buries the six
   * controls anyone actually reaches for.
   *
   * Collapsed by default, per page, with the hidden count stated plainly.
   * Nothing is removed and nothing is hidden silently.
   *
   * Browser preference. Never sent to the machine.
   */
  let showAdvanced = $state(loadAdvancedPref());

  function loadAdvancedPref() {
    try { return localStorage.getItem('sd32.showAdvanced') === '1'; } catch (e) { return false; }
  }
  function toggleAdvanced() {
    showAdvanced = !showAdvanced;
    try { localStorage.setItem('sd32.showAdvanced', showAdvanced ? '1' : '0'); } catch (e) { /* private mode */ }
  }

  // RENDERING §9: diagnostic-rank groups come last (settings.js) and stay
  // collapsed until asked for, with the count stated. Browser-local.
  let showDiagnostic = $state(false);

  // `adv` and `diagAll` count whether shown or not, so the footer's toggles
  // keep one label width in both states.
  const visibleGroups = $derived.by(() => {
    if (!current || !current.cat) return { groups: [], hidden: 0, diag: 0, adv: 0, diagAll: 0 };
    let hidden = 0, diag = 0, adv = 0, diagAll = 0;
    const groups = [];
    for (const g of current.cat.groups) {
      if (g.diagnostic) diagAll += g.fields.length;
      if (g.diagnostic && !showDiagnostic) { diag += g.fields.length; continue; }
      const fields = g.fields.filter((f) => {
        if (f.advanced) adv++;
        if (showAdvanced || !f.advanced) return true;
        hidden++;
        return false;
      });
      if (fields.length) groups.push({ ...g, fields, total: g.fields.length });
    }
    return { groups, hidden, diag, adv, diagAll };
  });

  /**
   * RESET THIS PAGE TO DEFAULTS.
   *
   * Writes each field's OWN catalog-declared default as an ordinary intent,
   * one per field, and lets every echo confirm separately. Never a bulk
   * "restore factory" verb the machine did not advertise, and never a
   * client-side guess: a field whose catalog published no default is not
   * touched, and neither is one the mask, the tier or the link has closed.
   * Confirmed through the overlay layer because it moves many settings at once.
   */
  // Scoped to what is on screen: the open drill-in page, else the page.
  // `hasDefaults` is the catalog fact that keeps the button in its place.
  // A page's card heroes count with their claimed fields (ph-jgq).
  const heroFields = $derived.by(() => {
    const uids = new Set((current?.cat?.heroes || []).flatMap((h) => [...h.fields.claimed]));
    return model ? [...model.fields, ...model.actions].filter((f) => uids.has(f.uid)) : [];
  });
  const onScreen = $derived(drillItem ? drillItem.group.fields
    : [...visibleGroups.groups.flatMap((g) => g.fields), ...heroFields]);
  const hasDefaults = $derived([...(current?.cat?.groups || []).flatMap((g) => g.fields), ...heroFields]
    .some(resetsToDefault));
  const resettable = $derived(onScreen.filter((f) => resetsToDefault(f)
    && isFieldEnabled(f, machine.samples[f.channelId])));
  const resetWhy = $derived(machine.link.phase !== 'live' ? 'no hub link'
    : !resettable.length ? 'nothing to reset' : '');
  // The category branch of pane() below: its controls ride the footer.
  const catPage = $derived(!current.pane && ready && current.id !== 'machine' && !!current.cat);
  // Writes in flight on this page, in the footer's fixed slot (law 5).
  const pageBusy = $derived(onScreen.filter((f) => statusOf(f) !== STATUS.confirmed).length);
  async function resetCategory() {
    const n = resettable.length;
    const ok = await askConfirm({
      title: 'Reset ' + n + ' setting' + (n === 1 ? '' : 's') + ' to defaults',
    });
    if (ok) for (const f of resettable) writeSetting(f, f.dflt);
  }

  /**
   * Dashboard items.
   *
   * `id` is a STABLE STRING built from the machine's own category id and group
   * name — never an array index. That is what lets a saved arrangement survive
   * a firmware update that adds a card, and lets the same browser talk to a
   * different machine without scrambling either layout.
   */
  // RENDERING §11 per class: a group past the class's density budget is a
  // card that opens its own page, never a hidden one. A section's cards
  // follow one header row (settings.js orders them together, DESIGN §10.11).
  const settingItems = $derived([
    ...(current && current.cat ? current.cat.heroes : []).map((h) =>
      ({ id: 'hero:' + h.id, title: h.title || capitalize(h.id), snippet: heroCard, hero: h })),
    ...projectGroups(visibleGroups.groups, view.cls).flatMap(({ group: g, drill: promoted }, i, all) => [
      ...(g.section && g.section !== all[i - 1]?.group.section
        ? [{ id: 'section:' + current.cat.id + ':' + g.section, kind: 'section', title: g.section }] : []),
      {
        id: (g.diagnostic ? 'diag:' : 'group:') + current.cat.id + ':' + (g.name || 'ungrouped'),
        title: g.title || (g.diagnostic ? 'Diagnostics' : 'Settings'),
        snippet: promoted ? drillCard : groupCard,
        group: g,
        promoted,
      },
    ]),
  ]);
  // The open drill-in page, while its group is still promoted under this
  // class; `full` shows every section inline instead.
  const drillItem = $derived(settingItems.find((it) => it.promoted && it.id === drill) || null);
</script>

{#snippet groupCard(item)}
  <div class="card-body">
    {#each item.group.fields as f (f.uid)}
      {#if f.widget === WIDGET.action}<ActionField action={f} />{:else}<Field field={f} />{/if}
    {/each}
  </div>
{/snippet}

<!-- A promoted group's card. Its writes in flight are counted in the card
     head (DashItem, law 5); the controls rendering them are one tap away. -->
{#snippet drillCard(item)}
  <button type="button" class="og-btn drill-open" onclick={() => (drill = item.id)}>
    <span>{item.group.fields.length} settings</span>
    <span aria-hidden="true">›</span>
  </button>
{/snippet}

{#snippet heroCard(item)}
  <item.hero.component fields={item.hero.fields} hero={item.hero} />
{/snippet}

{#snippet pane()}
  <main class="pane">
    <div class="pane-main">
      {#if current.pane}
        {#if current.pane.component}<current.pane.component />{:else}{@render current.pane.snippet?.()}{/if}
      {:else if !ready}
        <HubPicker />
      {:else if current.id === 'machine'}
        <HubPicker mode="tier" onpair={() => selectTab('pairing')} />
        {#if model}<Home {model} {heroes} />{/if}
      {:else if current.cat}
        {#if drillItem}
          <button type="button" class="og-btn drill-back" onclick={() => (drill = null)}>‹ {current.label}</button>
          <section class="og-panel drill-page" aria-label={drillItem.title}>
            <h3 class="drill-title">{drillItem.title}</h3>
            {@render groupCard(drillItem)}
          </section>
        {:else if settingItems.length}
          <DashGrid viewId={current.id} items={settingItems} />
        {:else}
          <!-- ph-vdk.37: a category can be genuinely empty for THIS hub (no
               fields survived rank/class projection) rather than broken; say
               which, using the same counts the advanced/diagnostic toggles
               below already carry. -->
          <p class="cat-empty">
            {#if visibleGroups.diag}
              {visibleGroups.diag} diagnostic field{visibleGroups.diag === 1 ? '' : 's'} hidden
            {:else if visibleGroups.hidden}
              {visibleGroups.hidden} advanced field{visibleGroups.hidden === 1 ? '' : 's'} hidden
            {:else}
              No fields at this rank or class
            {/if}
          </p>
        {/if}
      {:else if current.id === 'pairing'}
        <PairingPane />
      {:else if current.id === 'valence'}
        <ValencePane />
      {:else if current.id === 'log'}
        <LogPane />
      {:else if current.id === 'display'}
        <ThemePicker />
      {:else if current.id === 'plugins'}
        <PluginsPane />
      {/if}
    </div>
    <PageFoot page={!isDesktop}>
      {#if catPage}
        {#if visibleGroups.adv}
          <button class="og-btn sm adv-toggle" type="button" onclick={toggleAdvanced} aria-expanded={showAdvanced}
                  title={showAdvanced ? 'Hide advanced' : 'Show advanced'}>{visibleGroups.adv} advanced</button>
        {/if}
        {#if visibleGroups.diagAll}
          <button class="og-btn sm adv-toggle" type="button" onclick={() => (showDiagnostic = !showDiagnostic)} aria-expanded={showDiagnostic}
                  title={showDiagnostic ? 'Hide diagnostic' : 'Show diagnostic'}>{visibleGroups.diagAll} diagnostic</button>
        {/if}
        {#if hasDefaults}
          <button class="og-btn sm reset-cat" type="button" disabled={!!resetWhy}
                  title={resetWhy || (drillItem ? 'Reset group to defaults' : 'Reset page to defaults')}
                  onclick={resetCategory}>Reset</button>
        {/if}
        <span class="cat-busy" role="status">{pageBusy ? pageBusy + ' in flight' : ''}</span>
      {/if}
    </PageFoot>
  </main>
{/snippet}

<div class="app">
  <TopStrip {shell} onopenlog={() => selectTab('log')} />

  <!-- Only INSTRUMENT-zone heroes (heroes.js) render here, pinned above every
       view's PANE and never inside one: losing sight of the carriage because
       you opened a settings tab would be a regression from the old page. On
       desktop they run full width above the nav+pane frame; on a phone they
       sit above the tab strip. CARD-zone heroes are home modules and cards on
       their category's page instead. -->
  {#if !ready && !SHELL}
    <!-- Deliberately no fallback control path: a page with no hub link
         genuinely cannot drive anything. The picker says where the link
         stands and how to point the page at a hub. -->
    <HubPicker />
  {:else if isDesktop}
    {#if ready}<HeroStrip heroes={instrumentHeroes} />{/if}
    <div class="frame">
      <!-- The tablist role lives on an inner div: <nav> is a landmark, and ARIA
           forbids giving a non-interactive landmark an interactive role. -->
      <nav class="rail" class:mini={railMini} aria-label="Sections">
        <button type="button" class="rail-collapse" onclick={toggleRail}
                aria-expanded={!railMini}
                aria-label={railMini ? 'Expand navigation' : 'Collapse navigation'}
                title={railMini ? 'Expand navigation' : 'Collapse navigation'}>
          <span aria-hidden="true">{railMini ? '»' : '«'}</span>
        </button>
        <div role="tablist" aria-orientation="vertical" tabindex="-1" onkeydown={(e) => onTablistKeydown(e, true)}>
          {#each navSections as sec (sec.label)}
            <div class="rail-sec" class:shell={sec.shell}>
              {#if !railMini}<span class="rail-lbl">{sec.label}</span>{/if}
              {#each sec.tabs as t (t.id)}
                <button role="tab" class="rail-tab" data-tab-id={t.id}
                        aria-selected={current && current.id === t.id}
                        tabindex={current && current.id === t.id ? 0 : -1}
                        class:on={current && current.id === t.id}
                        title={t.label}
                        onclick={() => selectTab(t.id)}>
                  <span class="rail-glyph" aria-hidden="true"><svg viewBox="0 0 16 16"><path d={navIcon(t)} /></svg></span>
                  {#if !railMini}<span class="rail-name">{t.label}</span>{/if}
                </button>
              {/each}
            </div>
          {/each}
        </div>
      </nav>
      <div class="content" bind:this={contentEl}>
        {@render pane()}
      </div>
    </div>
  {:else}
    {#if ready}<HeroStrip heroes={instrumentHeroes} />{/if}
    <nav class="tabs" aria-label="Sections" bind:this={tabsNav}>
      <div role="tablist" tabindex="-1" onkeydown={(e) => onTablistKeydown(e, false)}>
        {#each tabs as t (t.id)}
          <button role="tab" data-tab-id={t.id}
                  aria-selected={current && current.id === t.id}
                  tabindex={current && current.id === t.id ? 0 : -1}
                  class:shell={!!t.pane}
                  class:on={current && current.id === t.id}
                  onclick={() => selectTab(t.id)}>{t.label}</button>
        {/each}
      </div>
    </nav>
    {@render pane()}
  {/if}

  <FootStrip />
  <ConfirmLayer onreview={() => selectTab('pairing')} knocksShown={current?.id === 'pairing'} />
  <KeyHelp />
  <LookFor {tabs} go={selectTab} />
</div>

<style>
  .cat-empty {
    color: var(--ink-faint);
    font-size: 12.5px;
    padding: var(--gap) 0;
    margin: 0;
  }

  /* ---- desktop frame: rail + pane ----------------------------------------
     The one non-scrolling row of the desktop column (style.css's .app):
     bounded to whatever height is left after TopStrip/hero-strip/FootStrip,
     with no overflow of its own — .content is the only region
     that scrolls. min-height:0 is required for a flex child to shrink below
     its content's natural height instead of forcing the column to overflow. */
  .frame {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--gap);
    padding-top: var(--gap);
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
  }
  /* position: a pane's absolutely positioned descendants (sr-only labels)
     must scroll with it, never overflow the non-scrolling column. */
  .content {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }

  .rail {
    width: 188px;
    /* No longer sticky: its container (.frame) doesn't scroll on desktop —
       only .content does — so sticky positioning had nothing to stick
       against. Grid's default stretch gives it the frame's full height. */
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: var(--bg-raised);
    border: 1px solid var(--line-0);
    border-radius: var(--radius);
    /* Independent scroll for a catalog with many categories. */
    overflow-y: auto;
  }
  .rail.mini { width: 56px; }

  .rail-collapse {
    align-self: flex-end;
    min-width: 28px;
    min-height: 28px;
    color: var(--ink-faint);
    border-radius: var(--radius);
    font-size: 13px;
  }
  .rail-collapse:hover,
  .rail-collapse:focus-visible { color: var(--ink); background: var(--line-soft); }

  .rail-sec {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 8px;
  }
  .rail-sec + .rail-sec {
    border-top: 1px solid var(--line-0);
    padding-top: 8px;
  }
  /* Phosphor: shell chrome, shaded as the shell row is (style.css --shell-*),
     pinned to the rail's foot. */
  .rail > [role=tablist] {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  .rail-sec.shell {
    margin-top: auto;
    padding: 6px;
    background: var(--shell-bg);
    color: var(--shell-fg);
    border: 1px solid var(--shell-border);
    border-radius: var(--radius);
  }
  .rail-sec.shell .rail-tab:not(.on),
  .rail-sec.shell .rail-lbl { color: var(--shell-fg); }
  .rail-sec.shell .rail-glyph { color: var(--shell-fg); }
  .rail-lbl {
    padding: 2px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--ink-faint);
  }

  .rail-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 8px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    color: var(--ink-dim);
    font-size: .85rem;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
  }
  .rail-tab:hover { color: var(--ink); background: var(--line-soft); }
  .rail-tab.on {
    color: var(--ink-hi);
    background: var(--bg-card);
    border-color: var(--line-1);
  }
  /* Active marker: a reality-blue tick on the leading edge — the same accent
     that means "what the machine reports" everywhere else marks "you are
     here". */
  .rail-tab.on .rail-glyph { color: var(--reality); }

  .rail-glyph {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 24px;
    color: var(--ink-faint);
  }
  .rail-glyph svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .rail-name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Touch: a >=960px touch tablet still gets the desktop rail, so its own
     controls need the fingertip floor same as every other coarse-pointer
     control (law 12). Grown for real rather than via a hit-area pseudo: both
     sit inside `.rail`'s scrolling box, where an overflowing pseudo-element
     would be clipped by the scrollport before it reached 40px. */
  @media (pointer: coarse) {
    .rail-collapse { min-width: 40px; min-height: 40px; }
    .rail-tab { min-height: 40px; }
  }

  /* ---- phone: horizontal tab strip ---------------------------------------
     Sticky just below the top strip, because on a phone the settings list is
     long and losing the tab bar means scrolling all the way back up to change
     section. Horizontally scrollable rather than wrapping: a machine may
     publish more categories than fit, and a wrapping tab bar that grows to
     three rows pushes the actual content off-screen. */
  .tabs {
    position: sticky;
    top: var(--strip-h, 0px);
    z-index: 15;
    margin: 0 calc(var(--gap) * -1);
    padding: 6px var(--gap);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line-0);
  }
  /* Landscape phone: the top strip plus the tab strip would pin half of a
     390px screen. The tab strip gives way; the top strip (phase, tier,
     e-stop) stays. */
  @media (max-height: 500px) {
    .tabs { position: static; }
  }
  .tabs > div {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs > div::-webkit-scrollbar { display: none; }
  .tabs button {
    flex: 0 0 auto;
    min-height: var(--tap);
    padding: 0 14px;
    border-radius: var(--radius);
    color: var(--ink-dim);
    font-weight: 500;
    white-space: nowrap;
    border: 1px solid transparent;
  }
  .tabs button.shell {
    background: var(--shell-bg);
    color: var(--shell-fg);
    border-color: var(--shell-border);
  }
  .tabs button.on {
    color: var(--ink-hi);
    background: var(--bg-card);
    border-color: var(--line-1);
  }

  .pane { padding: var(--gap) 0; min-width: 0; }

  /* Columns capped at the reading measure, never one stretched row: a
     full-width card is 1180px of pane at 1440 and 1420px at 1920, which is
     140 and 169 characters of label-to-value travel. */
  .card-body {
    display: grid;
    grid-template-columns: repeat(auto-fill, min(100%, var(--measure)));
    gap: 14px var(--gap);
  }

  /* ---- §11 drill-in (handheld, glance) ---------------------------------- */
  .drill-open {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: 12px;
  }
  .drill-back { margin-bottom: var(--gap); }
  .drill-page { padding: 12px; }
  .drill-title {
    margin: 0 0 12px;
    font-size: .8rem;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--ink-dim);
  }

  /* ---- the page footer (PageFoot) ----------------------------------------
     Desktop: the page fills .content, so the footer's sticky bottom always
     has the bottom edge to sit at. */
  .content > .pane {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding-bottom: 0;
  }
  .pane-main { flex: 1 0 auto; min-width: 0; }
</style>
