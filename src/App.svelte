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
   * ONE NAV MODEL, THREE RENDERINGS. The same tabs array (and the same
   * `active` id) drives a sidebar rail in the `full` renderer class, the phone
   * menu's drawer (the rail's own content) in buckets 1 and 2, and a
   * horizontal tab strip otherwise (model/viewport.svelte.js, RFC-062 draft;
   * DESIGN §10.12). A class switch mid-session must never lose the
   * operator's place or a pending write, and never forks the nav logic.
   */
  import Field from './ui/Field.svelte';
  import { cardbody } from './ui/cardbody.js';
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
  import QuickRail from './ui/QuickRail.svelte';
  import PhoneMenu, { phoneMenu } from './ui/PhoneMenu.svelte';
  import Dock from './ui/Dock.svelte';
  import { installContextMenu } from './ui/contextmenu.js';
  import { railReadout } from './ui/hero/RailWidget.svelte';
  import { heroBar, openQuick } from './ui/hero/heroBar.svelte.js';
  import { untrack, tick } from 'svelte';
  import { view } from './model/viewport.svelte.js';
  import { projectGroups } from './model/rclass.js';
  import { machine } from './model/machine.svelte.js';
  import { isFieldEnabled, resetsToDefault, WIDGET } from './model/settings.js';
  import { UI_CATEGORY, UI_CATEGORY_TIER, UI_NAV_TIER } from '../../Valence/clients/js/index.js';
  import { navIcon } from './ui/navIcons.js';
  import { writeSetting, inFlight } from './model/shadow.svelte.js';
  import { withoutClaimed, claimRoles } from './model/roles.js';
  import { heroClaims } from './ui/heroes.js';
  import PluginsPane from './plugins/PluginsPane.svelte';
  import { pluginsUi, pluginHeroes, pluginPages } from './plugins/plugins.svelte.js';
  import { panes as shellPanes } from './shell/panes.js';
  import { prefs, setPref } from './model/prefs.js';
  import { OFF, toggle, toggleBar, osFullscreen } from './model/fullscreen.js';
  import { scrollshade } from './ui/scrollshade.js';
  import RailLayouts from './shell/RailLayouts.svelte';
  import { hold } from './shell/hold.js';
  import { resetNeedsModal } from './shell/resetGate.js';
  import { settingsEntries } from './shell/settingsSearch.js';
  import { presetList } from './model/theme.js';
  import { registerSearch } from './ui/searchIndex.js';
  import { layouts, orderedLayoutNames, switchLayout, addLayout, dashEdit, redHint } from './model/dashboard.svelte.js';
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
  // Plugin pages sit indented under Plugins (docs/PLUGINS.md, Pages). A
  // page's spec resolves without claiming; null fields: the hub lacks a role.
  const pageTabs = $derived((pluginsUi.gen, pluginPages()).map((p) => ({
    id: p.id, label: p.label, sub: true, path: 'Phosphor › Plugins',
    page: { ...p, fields: model ? claimRoles(model.byRole, p.spec) : null },
  })));
  const clientTabs = $derived([
    ...(ready && !shellPaneTabs.some((t) => t.pane.id === 'settings') ? [{ id: 'display', label: 'Display' }] : []),
    ...(ready && pluginsUi.active ? [{ id: 'plugins', label: 'Plugins' }, ...pageTabs] : []),
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

  // Page fullscreen (DESIGN §10.3): plugin pages only; any page switch
  // leaves it. The mode persists (prefs.js), the state never does.
  const OS_SHELL = SHELL && !['android', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM);
  let full = $state(OFF);
  const isFull = $derived(full.on && !!current?.page);
  const currentId = $derived(current?.id);
  $effect(() => { currentId; untrack(() => { full = OFF; }); });
  let osFull = false;
  $effect(() => {
    const show = () => { if (full.bare) full = toggleBar(full); };
    window.addEventListener('phosphor-close-ask', show);
    return () => window.removeEventListener('phosphor-close-ask', show);
  });
  $effect(() => {
    // A media page's fullscreen is always bare and Borderless (DESIGN §10.3, "fullscreen or not").
    const want = osFullscreen({ on: isFull }, current?.page?.mediaFullscreen ? 'borderless' : $prefs.fullscreen, OS_SHELL);
    if (!OS_SHELL || want === osFull) return;
    osFull = want;
    import('@tauri-apps/api/window').then((m) => m.getCurrentWindow().setFullscreen(want)).catch(() => {});
  });
  // In-window page fullscreen keeps the hero bar (its rail): the page starts
  // where the hero bar ends, --hero-b.
  $effect(() => {
    if (!isFull || full.bare) return;
    const root = document.documentElement;
    const strip = document.querySelector('.hero-strip');
    const put = () => root.style.setProperty('--hero-b', Math.round(strip ? strip.getBoundingClientRect().bottom : 0) + 'px');
    put();
    const ro = new ResizeObserver(put);
    if (strip) ro.observe(strip);
    ro.observe(document.querySelector('.topstrip'));
    addEventListener('resize', put);
    return () => { ro.disconnect(); removeEventListener('resize', put); root.style.removeProperty('--hero-b'); };
  });
  // A page's own request (docs/PLUGINS.md, Pages): cancelable, so the page
  // knows it was taken. Borderless (detail.bare) is the page alone under the
  // stop pair; In window keeps the hero rail; a media page is always bare.
  // The change event tells it the end.
  $effect(() => {
    const ask = (e) => {
      if (!current?.page?.fields) return;
      e.preventDefault();
      full = e.detail?.on ? { on: true, bare: current.page.mediaFullscreen || e.detail.bare !== false } : OFF;
    };
    window.addEventListener('phosphor-page-fullscreen', ask);
    return () => window.removeEventListener('phosphor-page-fullscreen', ask);
  });
  $effect(() => { if (OS_SHELL) document.documentElement.dataset.fullscreenMode = $prefs.fullscreen; });
  // The page status (docs/PLUGINS.md, Pages, `status`): per page, the latest
  // phosphor-page-status of each source in the pane (a plugin page, or a card
  // on the Dash or a category page), newest last. TopStrip's status slot shows
  // one: the newest warn or bad, else the newest other.
  const TONES = ['ok', 'warn', 'bad'];
  let pageStatus = $state.raw({});
  $effect(() => {
    const put = (e) => {
      const src = e.target;
      if (!current || !src?.closest?.('main.pane .pane-main')) return;
      const d = e.detail || {};
      const list = (pageStatus[current.id] || []).filter((s) => s.src !== src && s.src.isConnected);
      if (d.text) list.push({ src, text: String(d.text), tone: TONES.includes(d.tone) ? d.tone : null, title: d.title == null ? '' : String(d.title) });
      pageStatus = { ...pageStatus, [current.id]: list };
    };
    window.addEventListener('phosphor-page-status', put);
    return () => window.removeEventListener('phosphor-page-status', put);
  });
  // The quick rail (DESIGN §10.3; docs/PLUGINS.md, Pages): where a rail is
  // mounted, the vertical pop-up on the phone class, the horizontal one in a
  // bare page fullscreen on the desktop (In window keeps the hero rail on
  // screen); absent otherwise.
  const rail = $derived(railReadout());
  const quickForm = $derived(!rail ? null : view.bucket <= 2 ? 'vertical' : isFull && full.bare ? 'horizontal' : null);
  const quickOpen = $derived(quickForm === 'vertical' ? heroBar.popup : quickForm === 'horizontal' ? heroBar.quick : false);
  function askQuick(open, from) {
    if (!quickForm) return false;
    openQuick(quickForm, open === 'toggle' ? !quickOpen : !!open, from);
    return true;
  }
  $effect(() => { if (quickForm !== 'horizontal' && !untrack(() => rail?.busy)) heroBar.quick = false; });
  $effect(() => {
    const root = document.documentElement;
    if (quickForm) root.dataset.quickRail = quickForm; else delete root.dataset.quickRail;
    root.toggleAttribute('data-quick-rail-open', quickOpen);
    window.dispatchEvent(new CustomEvent('phosphor-quick-rail-change', { detail: { available: !!quickForm, open: quickOpen, form: quickForm } }));
  });
  $effect(() => {
    const ask = (e) => {
      if (!current?.page || !e.target?.closest?.('main.pane .pane-main.plugin')) return;
      const o = e.detail?.open;
      if ((o === true || o === false || o === 'toggle') && askQuick(o, e.target)) e.preventDefault();
    };
    window.addEventListener('phosphor-quick-rail', ask);
    return () => window.removeEventListener('phosphor-quick-rail', ask);
  });
  // ponytail: a card unmounted with the page on screen (a Dash edit) keeps its status until that page's next one or a page switch.
  const statusSlot = $derived.by(() => {
    if (!current || (current.page && !current.page.status)) return null;
    const all = (pageStatus[current.id] || []).filter((s) => s.src.isConnected);
    const warn = all.filter((s) => s.tone === 'warn' || s.tone === 'bad');
    return (warn.length ? warn : all).at(-1) || null;
  });
  $effect(() => { window.dispatchEvent(new CustomEvent('phosphor-page-fullscreen-change', { detail: { on: isFull } })); });
  // Scrollbars are a pref, off by default; style.css switches on this one attribute.
  $effect(() => { document.documentElement.toggleAttribute('data-scrollbars', $prefs.scrollbars); });
  function onFullKey(e) {
    if (e.key === 'F11' && current?.page?.fields) { e.preventDefault(); full = toggle(full, current.page.mediaFullscreen); }
    // After every listener: an overlay's own Escape (F1, F3) prevents it.
    else if (e.key === 'Escape' && full.on) setTimeout(() => { if (!e.defaultPrevented) full = OFF; });
  }

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

  // Mobile: a tab switch scrolls the page to its top, since the page (not a
  // bounded region) is what scrolls here.
  // The phone menu (DESIGN §10.12): buckets 1 and 2 replace the tab strip
  // with a hamburger and a drawer of the sidebar's content.
  const menuMode = $derived(!isDesktop && view.bucket <= 2);
  $effect(() => { phoneMenu.shown = menuMode; if (!menuMode) phoneMenu.open = false; });
  // The promoted group page open in the active category (RENDERING §11).
  let drill = $state(null);
  // Set by a user page switch; the page fade (style.css) runs only then.
  let switching = $state(false);
  function selectTab(id) {
    if (id !== active) switching = true;
    active = id;
    drill = null;
    phoneMenu.open = false;
    if (!isDesktop) window.scrollTo({ top: 0, behavior: 'auto' });
  }
  // A saved dash layout is a view of the Dash tab: the store holds which one.
  function pickLayout(n) {
    phoneMenu.open = false;
    if (layouts.active !== n) dashEdit.on = false;
    switchLayout(n);
    selectTab('machine');
  }
  $effect(() => { if (active !== 'machine') dashEdit.on = false; });
  // F3 lists every Display and Settings entry and lands on its row.
  const settingsTab = $derived(tabs.find((t) => t.id === 'shell:settings') || tabs.find((t) => t.id === 'display'));
  $effect(() => registerSearch('settings', () => (settingsTab ? settingsEntries(presetList())
    .filter((e) => !e.shell || settingsTab.id === 'shell:settings')
    .map((e) => ({ label: e.label, path: settingsTab.id === 'display' ? 'Display' : 'Phosphor › Settings', go: async () => {
      selectTab(settingsTab.id);
      await tick();
      const el = document.querySelector('[data-search-key="' + e.key + '"]');
      el?.scrollIntoView({ block: 'center' });
      el?.querySelector('input, button')?.focus();
    } })) : [])));
  // The tab strip's Add layout (the rail has RailLayouts' own).
  let stripAdding = $state(false);
  let stripName = $state('');
  let stripBad = $state(false);
  const focusNode = (n) => n.focus();
  function stripCommit() {
    const n = stripName.trim();
    if (!n) { stripAdding = false; return; }
    if (addLayout(n)) { stripAdding = false; pickLayout(n); } else stripBad = true;
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
    if (next.dataset.tabId === 'machine') pickLayout('Default');
    else active = next.dataset.tabId;
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

  // A built-in card hero's advanced bindings follow the same disclosure: its
  // optional ones and its wholly advanced instances. A required binding stays,
  // the hero cannot draw without it; a plugin hero presents its own.
  function heroAdv(h) {
    if (h.plugin) return [];
    const f = h.fields, s = h.spec || {};
    return [
      ...Object.keys(s.optional || {}).map((k) => f[k]),
      ...Object.keys(s.instances || {}).flatMap((k) => (f[k] || []).map((m) => Object.values(m).filter((x) => x?.uid))
        .filter((ms) => ms.every((x) => x.advanced)).flat()),
    ].filter((x) => x?.advanced);
  }
  const heroAdvUids = $derived(new Set((current?.cat?.heroes || []).flatMap(heroAdv).map((f) => f.uid)));
  function heroShown(h) {
    if (showAdvanced) return h;
    const f = { ...h.fields };
    for (const k of Object.keys(h.spec?.optional || {})) if (heroAdvUids.has(f[k]?.uid)) f[k] = null;
    for (const k of Object.keys(h.spec?.instances || {})) f[k] = (f[k] || []).filter((m) => !Object.values(m).some((x) => heroAdvUids.has(x?.uid)));
    return { ...h, fields: f };
  }

  // `adv` and `diagAll` count whether shown or not, so the footer's toggles
  // keep one label width in both states.
  const visibleGroups = $derived.by(() => {
    if (!current || !current.cat) return { groups: [], hidden: 0, diag: 0, adv: 0, diagAll: 0 };
    let hidden = showAdvanced ? 0 : heroAdvUids.size, diag = 0, adv = heroAdvUids.size, diagAll = 0;
    const groups = [];
    // A card's total is every field of its name, live and diagnostic, shown or not.
    const totalOf = (name) => current.cat.groups.reduce((n, x) => n + (x.name === name ? x.fields.length : 0), 0);
    for (const g of current.cat.groups) {
      // A diagnostic group named like a shown live group is that card's tail, never a card of its own.
      const host = g.diagnostic ? groups.find((x) => !x.diagnostic && x.name === g.name) : null;
      if (g.diagnostic) diagAll += g.fields.length;
      if (g.diagnostic && !showDiagnostic) { diag += g.fields.length; continue; }
      const fields = g.fields.filter((f) => {
        if (f.advanced) adv++;
        if (showAdvanced || !f.advanced) return true;
        hidden++;
        return false;
      });
      if (host) host.fields = [...host.fields, ...fields];
      else if (fields.length) groups.push({ ...g, fields, total: totalOf(g.name) });
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
    : [...visibleGroups.groups.flatMap((g) => g.fields), ...heroFields.filter((f) => showAdvanced || !heroAdvUids.has(f.uid))]);
  const hasDefaults = $derived([...(current?.cat?.groups || []).flatMap((g) => g.fields), ...heroFields]
    .some(resetsToDefault));
  const resettable = $derived(onScreen.filter((f) => resetsToDefault(f)
    && isFieldEnabled(f, machine.samples[f.channelId])));
  const resetWhy = $derived(machine.link.phase !== 'live' ? 'no hub link'
    : !resettable.length ? 'nothing to reset' : '');
  // The category branch of pane() below: its controls ride the footer.
  const catPage = $derived(!current.pane && ready && current.id !== 'machine' && !!current.cat);
  // Writes in flight on this page, in the footer's fixed slot (law 5).
  const pageBusy = $derived(inFlight(onScreen));
  const applyReset = () => { for (const f of resettable) writeSetting(f, f.dflt); };
  async function resetCategory() {
    const n = resettable.length;
    const ok = await askConfirm({
      title: 'Reset ' + n + ' setting' + (n === 1 ? '' : 's') + ' to defaults',
    });
    if (ok) applyReset();
  }
  // The context menu's own items for the page and its cards (src/ui/contextmenu.js): the footer's and the pill's operations.
  // The advanced toggle once per menu: on a card when one was clicked, else on the page.
  function menuItems(t, chain) {
    const out = [];
    if (t.kind === 'page' && current.id === 'machine' && isDesktop) {
      out.push({ label: dashEdit.on ? 'Done editing' : 'Edit layout', disabled: dashEdit.on ? redHint() : '', run: () => { dashEdit.on = !dashEdit.on; } });
    }
    const card = (x) => x.kind === 'module' && /^(group|diag):/.test(x.key);
    const cat = catPage && (t.kind === 'page' || card(t));
    if (cat && visibleGroups.adv && (card(t) || !chain.some(card))) {
      out.push({ label: showAdvanced ? 'Hide advanced' : 'Show advanced', run: toggleAdvanced });
    }
    if (cat && t.kind === 'page' && visibleGroups.diagAll) {
      out.push({ label: showDiagnostic ? 'Hide diagnostic' : 'Show diagnostic', run: () => { showDiagnostic = !showDiagnostic; } });
    }
    if (cat && t.kind === 'page' && hasDefaults) {
      out.push({ label: drillItem ? 'Reset group to defaults' : 'Reset page to defaults', disabled: resetWhy, run: resetCategory });
    }
    // A plugin page: the footer's Fullscreen (a media page carries its own), then the Plugins pane.
    if (t.kind === 'page' && current.page) {
      if (current.page.fields && !current.page.mediaFullscreen) out.push({ label: isFull ? 'Exit fullscreen' : 'Fullscreen', run: () => { full = toggle(full); } });
      out.push({ label: 'Manage plugins', run: () => selectTab('plugins') });
    }
    return out;
  }
  $effect(() => installContextMenu({ tab: () => current, go: selectTab, dash: pickLayout, items: menuItems }));

  // The expanded rail carries the page operations in the selected page's pill
  // (DESIGN §10.11); PageFoot keeps them on the mini rail and the tab strip.
  const railOps = $derived(isDesktop && !railMini && catPage);
  // Reset on the rail is a 1 s hold (shell/hold.js) and the hold is the
  // confirmation, except where a resettable field is confirm-gated (a flip, a
  // destructive flag): then the whole reset takes the modal (RENDERING §8.3).
  let resetDone = $state(false);
  function holdReset() {
    if (resetNeedsModal(resettable, machine.samples)) { resetCategory(); return; }
    applyReset();
    resetDone = true;
    setTimeout(() => (resetDone = false), 1200);
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
  // follow one header row (settings.js orders them together, DESIGN §10.11);
  // the diagnostic cards with no section, last, follow a Diagnostics row.
  const DIAG_HEAD = {};
  const headOf = (g) => (g ? g.section || (g.diagnostic ? DIAG_HEAD : '') : '');
  const settingItems = $derived([
    ...(current && current.cat ? current.cat.heroes : []).map((h) =>
      ({ id: 'hero:' + h.id, title: h.title || capitalize(h.id), snippet: heroCard, hero: heroShown(h),
         fields: heroFields.filter((f) => h.fields.claimed.has(f.uid) && (showAdvanced || !heroAdvUids.has(f.uid))) })),
    ...projectGroups(visibleGroups.groups, view.cls).flatMap(({ group: g, drill: promoted }, i, all) => [
      ...(headOf(g) && headOf(g) !== headOf(all[i - 1]?.group)
        ? [{ id: 'section:' + current.cat.id + ':' + (g.section || '~diagnostic'), kind: 'section', title: g.section || 'Diagnostics' }] : []),
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
  <div class="card-body" use:cardbody>
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

{#snippet stripWrench()}
  <button type="button" class="strip-wrench" aria-pressed={dashEdit.on} aria-label={dashEdit.on ? 'Done editing' : 'Edit layout'}
          disabled={dashEdit.on && !!redHint()} title={dashEdit.on ? redHint() || 'Done editing' : 'Edit layout'} onclick={() => (dashEdit.on = !dashEdit.on)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 1.5a4 4 0 0 0-4.6 5.2L1.5 11.1a1.5 1.5 0 0 0 2.1 2.1l4.4-4.4A4 4 0 0 0 13.3 4.2L11 6.5 9.5 5l2.3-2.3a4 4 0 0 0-1.3-1.2z"/></svg>
  </button>
{/snippet}

{#snippet railTab(t, mini)}
  <button role="tab" class="rail-tab" class:sub={t.sub} data-tab-id={t.id}
          aria-selected={current && current.id === t.id}
          tabindex={current && current.id === t.id ? 0 : -1}
          class:on={current && current.id === t.id}
          title={t.label}
          onclick={() => (t.id === 'machine' ? pickLayout('Default') : selectTab(t.id))}>
    <span class="rail-glyph" aria-hidden="true"><svg viewBox="0 0 16 16"><path d={navIcon(t)} /></svg></span>
    {#if !mini}<span class="rail-name">{t.label}</span>{/if}
  </button>
{/snippet}

<!-- The sidebar's content: the desktop rail and the phone menu's drawer. -->
{#snippet sideTabs(mini, ops)}
    <div role="tablist" aria-orientation="vertical" tabindex="-1" onkeydown={(e) => onTablistKeydown(e, true)}>
      {#each navSections as sec (sec.label)}
        <div class="rail-sec" class:shell={sec.shell}>
          {#if !mini}<span class="rail-lbl">{sec.label}</span>{/if}
          {#each sec.tabs as t (t.id)}
            {@const here = ops && current.id === t.id}
            {@render railTab(t, mini)}
            {#if here}
              <div class="rail-ops" role="group" aria-label="Page operations"
                   style:--n={(visibleGroups.diagAll ? 1 : 0) + (visibleGroups.adv ? 1 : 0) + (hasDefaults ? 1 : 0)}>
                {#if visibleGroups.diagAll}
                  <button type="button" aria-pressed={showDiagnostic} onclick={() => (showDiagnostic = !showDiagnostic)}
                          title={showDiagnostic ? 'Hide diagnostic' : 'Show diagnostic'}><b>{visibleGroups.diagAll}</b> diag</button>
                {/if}
                {#if visibleGroups.adv}
                  <button type="button" aria-pressed={showAdvanced} onclick={toggleAdvanced}
                          title={showAdvanced ? 'Hide advanced' : 'Show advanced'}><b>{visibleGroups.adv}</b> adv</button>
                {/if}
                {#if hasDefaults}
                  <button type="button" class="reset" class:done={resetDone} disabled={!!resetWhy}
                          use:hold={{ ms: 1000, onfire: holdReset, key: current.id + drill }}
                          title={resetWhy || 'Hold 1 s to reset ' + (drillItem ? 'this group' : 'this page') + ' to defaults'}
                          >{resetDone ? 'reset ✓' : 'reset'}</button>
                {/if}
              </div>
            {/if}
            {#if t.id === 'machine' && !mini}<RailLayouts dashActive={active === 'machine'} onpick={pickLayout} />{/if}
          {/each}
        </div>
      {/each}
    </div>
{/snippet}

{#snippet pane()}
  <main class="pane" class:full={isFull} class:bare={isFull && full.bare} class:fill={!!current?.page?.fill} class:fit={current?.id === 'log'} use:scrollshade={isFull}>
    <div class="pane-main" class:switching class:plugin={!!current?.page} onanimationend={() => (switching = false)}>
      {#key current.id}
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
          <h3 class="drill-title">{drillItem.title}</h3>
          <section class="surface-card drill-page" aria-label={drillItem.title}>
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
      {:else if current.page}
        {#if current.page.fields}
          <current.page.component fields={current.page.fields} hero={current.page} />
        {:else}
          <p class="cat-empty">Not on this hub</p>
        {/if}
      {:else if current.id === 'pairing'}
        <PairingPane />
      {:else if current.id === 'valence'}
        <ValencePane onopenlog={() => selectTab('log')} />
      {:else if current.id === 'log'}
        <LogPane />
      {:else if current.id === 'display'}
        <ThemePicker />
      {:else if current.id === 'plugins'}
        <PluginsPane />
      {/if}
      {/key}
    </div>
    <PageFoot page={!isDesktop && !isFull}>
      <!-- Only in a footer the page has anyway: the hero's mini opens the same pop-up. -->
      {#if quickForm && ((current.page?.fields && !current.page.mediaFullscreen) || (catPage && !railOps))}
        <QuickRail open={quickOpen} onclick={(e) => askQuick('toggle', e.currentTarget)} />
      {/if}
      {#if current.page?.fields && !current.page.mediaFullscreen}
        <button class="og-btn sm" class:on={isFull} type="button" aria-pressed={isFull} title="Fullscreen, F11"
                onclick={() => (full = toggle(full))}>Fullscreen</button>
        {#if OS_SHELL}
          <select class="og-btn sm" aria-label="Fullscreen mode" title="In window / Borderless" value={$prefs.fullscreen}
                  onchange={(e) => setPref('fullscreen', e.currentTarget.value)}>
            <option value="window">In window</option>
            <option value="borderless">Borderless</option>
          </select>
        {/if}
      {/if}
      {#if catPage && !railOps}
        {#if visibleGroups.diagAll}
          <button class="og-btn sm adv-toggle" type="button" onclick={() => (showDiagnostic = !showDiagnostic)} aria-expanded={showDiagnostic}
                  aria-label={visibleGroups.diagAll + ' diagnostic'}
                  title={showDiagnostic ? 'Hide diagnostic' : 'Show diagnostic'}>{visibleGroups.diagAll} {view.bucket <= 2 ? 'diag' : 'diagnostic'}</button>
        {/if}
        {#if visibleGroups.adv}
          <button class="og-btn sm adv-toggle" type="button" onclick={toggleAdvanced} aria-expanded={showAdvanced}
                  aria-label={visibleGroups.adv + ' advanced'}
                  title={showAdvanced ? 'Hide advanced' : 'Show advanced'}>{visibleGroups.adv} {view.bucket <= 2 ? 'adv' : 'advanced'}</button>
        {/if}
        {#if hasDefaults}
          <button class="og-btn sm reset-cat" type="button" disabled={!!resetWhy}
                  title={resetWhy || (drillItem ? 'Reset group to defaults' : 'Reset page to defaults')}
                  onclick={resetCategory}>Reset</button>
        {/if}
        <!-- Handheld: an icon and the count in a fixed chip, so the one 48 px row holds (DESIGN §10.3). -->
        <span class="cat-busy" class:chip={view.bucket <= 2} class:idle={!pageBusy.n} class:overdue={pageBusy.overdue} role="status">
          {#if view.bucket <= 2}<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg
          ><b>{pageBusy.n || ''}</b><span class="sr">{pageBusy.n ? ' in flight' : ''}</span>{:else}{pageBusy.n ? pageBusy.n + ' in flight' : ''}{/if}
        </span>
      {/if}
    </PageFoot>
  </main>
{/snippet}

<div class="app">
  <TopStrip {shell} bare={isFull && full.bare} compact={!!current?.page?.compactHero && view.bucket <= 2} page={statusSlot} onopenlog={() => selectTab('log')} />

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
      <nav class="rail" class:mini={railMini} aria-label="Sections" use:scrollshade>
        <button type="button" class="rail-collapse" onclick={toggleRail}
                aria-expanded={!railMini}
                aria-label={railMini ? 'Expand navigation' : 'Collapse navigation'}
                title={railMini ? 'Expand navigation' : 'Collapse navigation'}>
          <span aria-hidden="true">{railMini ? '»' : '«'}</span>
        </button>
        {@render sideTabs(railMini, railOps)}
      </nav>
      <div class="content" bind:this={contentEl} use:scrollshade>
        {@render pane()}
      </div>
      <Dock />
    </div>
  {:else}
    {#if ready}<HeroStrip heroes={instrumentHeroes} />{/if}
    {#if menuMode}
      <PhoneMenu><nav class="rail drawer-nav" aria-label="Sections">{@render sideTabs(false, catPage)}</nav></PhoneMenu>
    {:else}
    <nav class="tabs" aria-label="Sections">
      <div role="tablist" tabindex="-1" onkeydown={(e) => onTablistKeydown(e, false)}>
        {#each tabs as t (t.id)}
          <button role="tab" data-tab-id={t.id}
                  aria-selected={current && current.id === t.id}
                  tabindex={current && current.id === t.id ? 0 : -1}
                  class:shell={!!t.pane}
                  class:on={current && current.id === t.id && (t.id !== 'machine' || layouts.active === 'Default')}
                  onclick={() => (t.id === 'machine' ? pickLayout('Default') : selectTab(t.id))}>{t.label}</button>
          {#if t.id === 'machine'}
            {#if active === 'machine' && layouts.active === 'Default'}{@render stripWrench()}{/if}
            {#each orderedLayoutNames().slice(1) as n (n)}
              {@const sel = active === 'machine' && layouts.active === n}
              <button type="button" data-layout={n} aria-current={sel ? 'page' : undefined}
                      class:on={sel} onclick={() => pickLayout(n)}>{n}</button>
              {#if sel}{@render stripWrench()}{/if}
            {/each}
            {#if stripAdding}
              <input class="strip-add" aria-label="New layout name" aria-invalid={stripBad} placeholder="Layout name" bind:value={stripName}
                     use:focusNode onkeydown={(e) => { if (e.key === 'Enter') stripCommit(); else if (e.key === 'Escape') { e.stopPropagation(); stripAdding = false; } }}
                     onblur={() => (stripAdding = false)} />
            {:else}
              <button type="button" aria-label="Add layout" title="Add layout" onclick={() => { stripName = ''; stripBad = false; stripAdding = true; }}>+</button>
            {/if}
          {/if}
        {/each}
      </div>
    </nav>
    {/if}
    {@render pane()}
    <Dock drawer />
  {/if}

  {#if isFull}
    <button type="button" class="full-caret" class:bare={full.bare} aria-expanded={!full.bare}
            aria-label={full.bare ? 'Show bar' : 'Hide bar'} title={full.bare ? 'Show bar' : 'Hide bar'}
            onclick={() => (full = toggleBar(full))}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5l3-3 3 3"/></svg>
    </button>
  {/if}
  <FootStrip pinned={!isDesktop} />
  <ConfirmLayer onreview={() => selectTab('pairing')} knocksShown={current?.id === 'pairing'} />
  <KeyHelp />
  <LookFor {tabs} go={selectTab} />
</div>

<svelte:window onkeydown={onFullKey} />

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
    /* rail | gap | content | gap: the sidebar is flush on the window's left
       edge, one --gap under the hero bar and above the status row. */
    padding: var(--gap) var(--gap) var(--gap) 0;
    /* With the scrollbars pref on, the content's track sits inside the right
       gap (style.css [data-shade]). */
    --track: 0px;
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
  }
  :global(:root[data-scrollbars]) .frame { --track: 4px; }
  /* The right dock, opened by the user: a third column that narrows the content (Dock.svelte). */
  .frame:has(> :global(.side-dock)) { grid-template-columns: auto minmax(0, 1fr) auto; }
  /* position: a pane's absolutely positioned descendants (sr-only labels)
     must scroll with it, never overflow the non-scrolling column. */
  .content {
    position: relative;
    margin-right: calc(var(--track) * -1);
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
    background: var(--bg-raised);
    border: 1px solid var(--line-0);
    border-left: 0;
    border-radius: 0 var(--radius) var(--radius) 0;
    /* Independent scroll for a catalog with many categories. */
    overflow-y: auto;
  }
  .rail.mini { width: 56px; }
  /* The phone menu's drawer holds the rail's content at the drawer's width. */
  .rail.drawer-nav { width: auto; flex: 1 0 auto; border: 0; border-radius: 0; background: none; overflow: visible; padding-top: var(--sp-3); }
  /* No padding on the rail itself: the recess shades (style.css [data-shade])
     span its whole scrollport, so the inset lives on its children. */
  .rail-collapse {
    align-self: flex-end;
    margin: var(--sp-2) var(--sp-2) var(--sp-1);
    min-width: 28px;
    min-height: 28px;
    color: var(--ink-dim);
    border-radius: var(--radius);
    font-size: 13px;
  }
  .rail-collapse:hover,
  .rail-collapse:focus-visible { color: var(--ink); background: var(--line-soft); }

  .rail-sec {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    padding-bottom: var(--sp-3);
  }
  .rail-sec + .rail-sec {
    border-top: 1px solid var(--line-0);
    padding-top: var(--sp-3);
  }
  /* Phosphor: shell chrome, shaded as the shell row is (style.css --shell-*),
     pinned to the rail's foot. */
  .rail > [role=tablist] {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    padding: 0 var(--sp-2) var(--sp-2);
  }
  /* The selected page's pill grows to hold its operations: inset, not
     indented, one row of two or three buttons. */
  :global(.rail-tab.on):has(+ .rail-ops) { border-bottom-color: transparent; border-radius: var(--radius) var(--radius) 0 0; }
  .rail-ops {
    margin-top: calc(var(--sp-1) * -1);
    background: var(--bg-card);
    border: 1px solid var(--line-1);
    border-top: 0;
    border-radius: 0 0 var(--radius) var(--radius);
    display: grid;
    grid-template-columns: repeat(var(--n, 3), 1fr);
    gap: var(--sp-1);
    padding: 0 var(--sp-2) var(--sp-2);
  }
  .rail-ops button {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-1);
    min-height: 24px;
    padding: 0 var(--sp-1);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    color: var(--ink-dim);
    font-size: .62rem;
    font-weight: 500;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .rail-ops button b { font: 400 .68rem var(--mono); color: var(--ink); letter-spacing: 0; }
  .rail-ops button:hover:not(:disabled) { border-color: var(--highlight); }
  .rail-ops button[aria-pressed='true'] { color: var(--highlight); border-color: var(--highlight); }
  .rail-ops button:disabled { opacity: .4; }
  .rail-ops .reset { color: var(--warn-ink); }
  .rail-ops .reset::before { content: ''; position: absolute; inset: 0; width: 0; background: color-mix(in srgb, var(--warn) 30%, transparent); }
  .rail-ops .reset:global(.holding)::before { width: 100%; transition: width 1s linear; }
  .rail-ops .reset.done { border-color: var(--warn); }
  @media (pointer: coarse) { .rail-ops button { min-height: 40px; } }
  .rail-sec.shell {
    margin-top: auto;
    padding: var(--sp-2);
    background: var(--shell-bg);
    color: var(--shell-fg);
    border: 1px solid var(--shell-border);
    border-radius: var(--radius);
  }
  /* Collapsed, the section's tabs keep the others' width (law 12). */
  .rail.mini .rail-sec.shell { padding-inline: 0; }
  .rail-sec.shell :global(.rail-tab:not(.on)),
  .rail-sec.shell .rail-lbl { color: var(--shell-fg); }
  .rail-sec.shell .rail-glyph { color: var(--shell-fg); }
  .rail-lbl {
    padding: var(--sp-1) var(--sp-3) var(--sp-2);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--tx-val);
  }

  :global(.rail-tab) {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 34px;
    padding: 0 var(--sp-3);
    border-radius: var(--radius);
    border: 1px solid transparent;
    color: var(--tx-val);
    font-size: .85rem;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
    transition: color var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out);
  }
  :global(.rail-tab:hover) { color: var(--ink); background: var(--line-soft); }
  /* A plugin page: indented under Plugins; the collapsed rail keeps the column. */
  .rail:not(.mini) :global(.rail-tab.sub) { padding-left: calc(var(--sp-5) + var(--sp-2)); }
  :global(.rail-tab.on) {
    color: var(--ink-hi);
    background: var(--bg-card);
    border-color: var(--line-1);
  }
  /* Active marker: a reality-blue tick on the leading edge — the same accent
     that means "what the machine reports" everywhere else marks "you are
     here". */
  :global(.rail-tab.on) .rail-glyph { color: var(--reality); }

  .rail-glyph {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 24px;
    color: var(--ink-dim);
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
  :global(.rail-name) {
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
    :global(.rail-tab) { min-height: 40px; }
  }

  /* ---- bucket 3 below `full`: horizontal tab strip --------------------------
     Sticky just below the top strip, because on a phone the settings list is
     long and losing the tab bar means scrolling all the way back up to change
     section. Horizontally scrollable rather than wrapping: a machine may
     publish more categories than fit, and a wrapping tab bar that grows to
     three rows pushes the actual content off-screen. */
  .tabs {
    position: sticky;
    top: var(--strip-h, 0px);
    z-index: 15;
    margin: 0 calc(var(--app-pad) * -1);
    padding: var(--sp-2) var(--gap);
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
    gap: var(--sp-2);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs > div::-webkit-scrollbar { display: none; }
  .tabs button {
    flex: 0 0 auto;
    min-height: var(--tap);
    min-width: var(--tap);
    padding: 0 var(--sp-4);
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
  .tabs .strip-wrench { display: grid; place-items: center; min-width: var(--tap); padding: 0; }
  .tabs .strip-wrench svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .tabs .strip-wrench[aria-pressed='true'] { color: var(--highlight); border-color: var(--highlight); }
  /* Done blocked while a card is red (DESIGN §10.6). */
  .tabs .strip-wrench:disabled { color: var(--warn-ink); border-color: var(--warn); cursor: not-allowed; }
  .tabs .strip-add { flex: 0 0 auto; width: 10rem; min-height: var(--tap); padding: 0 var(--sp-4); background: var(--bg-sunken); border: 1px solid var(--highlight); border-radius: var(--radius); color: var(--ink); font: inherit; outline: none; }
  .tabs .strip-add[aria-invalid='true'] { border-color: var(--warn); }
  .tabs button.on {
    color: var(--ink-hi);
    background: var(--bg-card);
    border-color: var(--line-1);
  }

  .pane { padding: var(--gap) 0; min-width: 0; }

  /* ---- §11 drill-in (handheld, glance) ---------------------------------- */
  .drill-open {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: var(--sp-4);
  }
  .drill-back { margin-bottom: var(--gap); }
  .drill-page { padding: var(--sp-4); }
  .drill-title {
    margin: 0 0 var(--sp-4);
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
    padding-block: 0;
  }
  .pane-main { flex: 1 0 auto; min-width: 0; }
  /* The host's stacked default (docs/PLUGINS.md, Pages): in buckets 1 and 2 a
     plugin page is one full-width column of children at most the pane wide,
     unless its root declares its own layout with a data-layout attribute. */
  :global(:root[data-bucket='1']) .pane-main.plugin > :global(:not([data-layout])),
  :global(:root[data-bucket='2']) .pane-main.plugin > :global(:not([data-layout])) {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }
  :global(:root[data-bucket='1']) .pane-main.plugin > :global(:not([data-layout])) > :global(*),
  :global(:root[data-bucket='2']) .pane-main.plugin > :global(:not([data-layout])) > :global(*) { max-width: 100%; min-width: 0; }
  /* A page registered with `fill` (docs/PLUGINS.md, Pages): its mount takes
     the content pane's whole height, as in page fullscreen. Desktop only. */
  .content > .pane.fill:not(.full) { height: 100%; }
  /* A page that fits the window at every class (the Log page, DESIGN
     Amendments 2026-10-10): its own list is the one scroller and takes what
     the chrome leaves. The scrolling layout becomes a window-tall column
     while it is on screen. Flex items keep their content minimum, so a
     window too short for the page's floor scrolls as before. */
  :global(html:not([data-rc=full])) .app:has(> .pane.fit) { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
  .app:has(> .pane.fit) > :not(.pane) { flex-shrink: 0; }
  .app > .pane.fit { flex: 1 1 0; display: flex; flex-direction: column; }
  .pane.fit > .pane-main { flex: 1 1 0; display: flex; flex-direction: column; }
  .pane.fit > .pane-main > :global(*) { flex: 1 1 auto; }

  /* ---- page fullscreen (DESIGN §10.3) -------------------------------------
     In window: the page fills the window below the hero bar, so only the
     hero rail stays (sidebar and pane chrome hidden); bare (Borderless): the
     whole window, under the stop pair and the caret. */
  .app { --caret-h: 18px; }
  @media (pointer: coarse) { .app { --caret-h: var(--tap); } }
  .pane.full {
    position: fixed;
    inset: var(--hero-b, var(--strip-h, 0px)) 0 0 0;
    transition: top var(--t-move) var(--ease-out);
    z-index: 20;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: var(--caret-h) var(--gap) 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
  }
  .pane.full.bare { top: 0; }
  .pane.full.bare > :global(.page-foot) { display: none; }
  /* The window's height reaches the plugin's mount. */
  .content > .pane.fill > .pane-main, .pane.full > .pane-main { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
  .content > .pane.fill > .pane-main > :global(*), .pane.full > .pane-main > :global(*) { flex: 1 1 auto; min-height: 0; }
  .full-caret {
    position: fixed;
    top: var(--hero-b, var(--strip-h, 0px));
    transition: top var(--t-move) var(--ease-out);
    left: 50%;
    z-index: 31;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: max(48px, var(--caret-h));
    height: var(--caret-h);
    padding: 0;
    color: var(--ink-dim);
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-top: 0;
    border-radius: 0 0 var(--r-s) var(--r-s);
  }
  .full-caret:hover { color: var(--ink-hi); }
  .full-caret.bare { top: 0; }
  :global(:root[data-cutout-top]) .full-caret.bare { left: auto; right: calc(var(--cutout-r) + var(--cutout-w) + var(--sp-3)); transform: none; }
  .full-caret svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .full-caret.bare svg { transform: rotate(180deg); }
</style>
