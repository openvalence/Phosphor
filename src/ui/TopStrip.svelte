<script>
  /**
   * TopStrip.svelte -- the one top strip (DESIGN §10.3): the top bar
   * (LinkBar, with the shell's window buttons at its end) over the strip, the
   * hero row of the persistent safety region. One sticky box at top 0 in both
   * scroll modes, so there is no reserve to double-count (webui.md T22).
   *
   * Constraints:
   * - NO PAGE SHIFT (operator 2026-10-02). The bar and the strip are fixed
   *   heights that depend on the viewport only: never on the hub name, a
   *   reason, a refusal or whether a rail is mounted. Nothing here adds a
   *   line; a long text ellipsizes and carries its full form in `title`.
   * - The strip: the rail's numerals left (railReadout(), the rail's own rAF
   *   instant), ONE status slot in the middle, the controls right, mirrored
   *   so the e-stop is outermost (operator 2026-10-02): Home (every
   *   action.home / action.safety op the catalog advertises), then Flip and
   *   override/return while a rail is mounted (SPEC §9.6, §11.1), then the
   *   pause and e-stop pair (law 14, SafetyOp.svelte). The pair never
   *   scrolls or shrinks, at every width and in every state (law 1); placed
   *   copies are extras.
   * - Home is ONE control. With more than one op it opens a popover (Home,
   *   Force Home, whatever else the hub offers); no other op is inline.
   *   While home is required (the snapshot's home_required, or a NOT_HOMED
   *   refusal until a home echoes) it pulses a red hazard border: a
   *   safety-adjacent required act (DESIGN §10.3, operator 2026-10-02).
   * - Nothing in the strip scrolls sideways (ph-b5d). Short of width the
   *   secondary numerals clip first; past the group's measured budget, in
   *   order: the Home control drops its label and Flip joins its popover,
   *   the strip stacks into two rows, and last override/return joins the
   *   popover. The pair never shrinks and is never in the popover.
   * - The numeral's glow paints to the strip's edges, never past them: the
   *   numerals cell clips at the strip box, not at its own.
   * - The status slot shows ONE thing, by priority: link fault, unattended
   *   (RENDERING §10.1 rule 3), refusal, the typed jog's clamp note, latch
   *   notice, latest safety edge,
   *   virtual hub.
   *   The refusal is shadow.svelte.js's `lastRefusal`, written by all three
   *   write paths, so a refusal is visible after its control has scrolled
   *   off or unmounted.
   * - `bare` (App's page fullscreen, bar hidden): the pair alone, top right,
   *   half opacity at rest and full on any pointer activity or focus; never
   *   hidden (RENDERING §8.4 row 11). The bar is hidden, never unmounted: the
   *   shell's close gate lives in it. It publishes --stop-reserve on <html>
   *   (the pair's reach from the right edge) and --stop-reserve-h (its bottom edge)
   *   for pages to keep their top row clear of.
   * - The safety-intents channel is found by spec-core identity
   *   (specSafetyAction, law 2), a role tag being one more discovery path,
   *   never the only one: a hub that never annotated it keeps its e-stop.
   */
  import { untrack } from 'svelte';
  import { machine, getSession, specSafetyAction, estopLabel, retryNow } from '../model/machine.svelte.js';
  import { runAction, lastRefusal, clearLastRefusal } from '../model/shadow.svelte.js';
  import { SAFETY_OP, HOME_OP, CH_SAFETY_INTENTS, CH_CONTROL_OWNER, NACK } from '../../../Valence/clients/js/index.js';
  import { needsConfirm, confirmCopy, isUnattended, railOwnerName, foreignOwner, anyOwner } from '../model/actions.js';
  import { askConfirm } from './confirm.svelte.js';
  import { SAFETY_EVENT_KIND_NAME } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import { logView } from './logview.svelte.js';
  import LinkBar from './LinkBar.svelte';
  import SafetyOp from './widgets/SafetyOp.svelte';
  import HeroNumerals from './hero/HeroNumerals.svelte';
  import PlanStrip from './widgets/PlanStrip.svelte';
  import { railReadout } from './hero/RailWidget.svelte';
  import MiniRail from './hero/MiniRail.svelte';
  import { heroBar, budgetOf, isCollapsed } from './hero/heroBar.svelte.js';
  import { view } from '../model/viewport.svelte.js';
  import { history } from '../model/history.svelte.js';
  import { prefs, setPref } from '../model/prefs.js';

  // onopenlog: called after the strip points LogPane at its Safety feed; App
  // switches nav. shell: the shell's window buttons (main.js), null on the
  // served page.
  // compact: App's compactHero page in buckets 1 and 2 (DESIGN §10.3): one row,
  // the numeral without its label line, the mini, all five strip buttons.
  let { onopenlog = null, shell = null, bare = false, compact = false } = $props();

  let woke = $state(false);
  // Latched or paused: the pair never dims (RENDERING §8.4 row 11).
  const held = $derived(!!(machine.safety && (machine.safety.estopLatched || machine.safety.paused)));
  $effect(() => {
    if (!bare) return;
    let t;
    const wake = () => { woke = true; clearTimeout(t); t = setTimeout(() => { woke = false; }, 1500); };
    for (const ev of ['pointermove', 'pointerdown']) window.addEventListener(ev, wake);
    return () => {
      clearTimeout(t);
      woke = false;
      for (const ev of ['pointermove', 'pointerdown']) window.removeEventListener(ev, wake);
    };
  });

  // Borderless: the pair's reach from the window's right edge, for a page to keep its top row clear of.
  $effect(() => {
    const pair = bare && stripEl?.querySelector('.pair');
    if (!pair) return;
    const root = document.documentElement;
    const set = () => {
      const r = pair.getBoundingClientRect();
      root.style.setProperty('--stop-reserve', Math.ceil(window.innerWidth - r.left) + 'px');
      root.style.setProperty('--stop-reserve-h', Math.ceil(r.bottom) + 'px');
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(pair);
    return () => { ro.disconnect(); root.style.removeProperty('--stop-reserve'); root.style.removeProperty('--stop-reserve-h'); };
  });

  const isSafetyRole = (a) => typeof a.role === 'string' && a.role.startsWith('action.safety');
  const isHomeRole = (a) => typeof a.role === 'string' && a.role.startsWith('action.home');

  const roleActions = $derived(
    ((machine.catalog.model && machine.catalog.model.actions) || []).filter((a) => isSafetyRole(a) || isHomeRole(a))
  );
  const specSafety = $derived.by(specSafetyAction);
  // De-duplicate: an annotated safety channel is found both ways.
  const actions = $derived(
    specSafety && !roleActions.some((a) => a.uid === specSafety.uid) ? [specSafety, ...roleActions] : roleActions
  );

  const rail = $derived(railReadout());
  // The hide tab (Settings: Rail hide tab) and, while hidden, the mini rail.
  const handheld = $derived(view.bucket <= 2);
  const tab = $derived(!!rail && $prefs.railHide && !handheld);
  const railHidden = $derived(!!rail && isCollapsed($prefs));
  // A user act: shows the rail even over the budget, until the next resize.
  const showRail = () => {
    if (handheld) { heroBar.popup = !heroBar.popup; return; }
    heroBar.userShow = true;
    setPref('railHidden', false);
  };
  const toggleRail = () => (railHidden ? showRail() : setPref('railHidden', true));
  // Override/return is the rail's (RENDERING §8.4 `axis`): only with a rail,
  // and never on a hub whose op table lacks it (law 7).
  const hasOverride = $derived(!!rail && !!(specSafety && (specSafety.options || [])[SAFETY_OP.override]));
  const flip = $derived(rail ? rail.flip : null);
  const railCtl = $derived(hasOverride || !!flip);

  // ---- latest safety edge ----------------------------------------------------
  // The core safety-events ring only. Stale when the link has not been live
  // since the edge: later edges may have been missed. Diagnostic and
  // superseded records are feed-only (ph-vdk.14).
  // TODO(rfc-x3n): add the device anomaly log once the catalog can say which
  // device EVENT channel it is.
  const latestSafety = $derived(
    machine.events.safety.findLast((e) => !e.diagnostic && !e.superseded) || null
  );
  const unreadSafety = $derived(machine.events.safety.filter((e) => e.at > logView.safetySeenAt).length);
  const safetyStale = $derived(!!latestSafety && (machine.link.phase !== 'live' || machine.link.stale
    || latestSafety.at < machine.link.openedAt));
  let now = $state(Date.now());
  $effect(() => {
    if (!latestSafety) return;
    now = Date.now();
    const t = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(t);
  });
  function ageText(ms) {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return sec + ' s ago';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    return Math.floor(sec / 3600) + ' h ago';
  }
  function openSafetyLog() {
    logView.tab = 'safety';
    if (onopenlog) onopenlog();
  }

  // The hero budget (DESIGN §10.12): link bar + strip + rail fit a share of
  // the window height. Order of giving way: the numeral shrinks to its floor
  // (--num-cap), then the rail takes its mini form. Pure in viewport, prefs
  // and the user's taps (userShow, cleared by a resize); never of history.
  let winH = $state(0), winW = $state(0);
  let chromeH = $state(34), tapPx = $state(49), padV = $state(6), gapV = $state(4);
  $effect(() => { void winH; void winW; heroBar.userShow = false; compactFits = true; });
  $effect(() => {
    if (!winH) return;
    heroBar.budget = budgetOf(winH, view.bucket);
    const numMin = (winW >= 1024 ? 54 : 42) * .95 + 20;
    const row = stacked ? numMin + gapV + tapPx + 2 * padV : Math.max(numMin, tapPx) + 2 * padV;
    const over = chromeH + row + heroBar.railH > heroBar.budget;
    // Handheld: the mini is the rail's permanent form; its pop-up is the rail.
    heroBar.form = handheld || ($prefs.railHide && !heroBar.userShow && over) ? 'mini' : 'full';
  });
  $effect(() => { if ((!handheld || !rail) && !(rail && rail.busy)) heroBar.popup = false; });
  // Outside tap closes a pop-up unless a scrub or window drag is live; a
  // quick-rail icon ([data-quick-rail-toggle]) toggles it itself.
  function onPopupAway(e) {
    if (!(heroBar.popup || heroBar.quick) || (rail && rail.busy)) return;
    if (e.target.closest?.('.hero-inner.popup, .hero-inner.quick, .mini, [data-quick-rail-toggle]')) return;
    heroBar.popup = false;
    heroBar.quick = false;
  }

  // The phone tab strip sticks just below this strip (App.svelte .tabs).
  let stripH = $state(0);
  $effect(() => {
    document.documentElement.style.setProperty('--strip-h', stripH + 'px');
    return () => document.documentElement.style.removeProperty('--strip-h');
  });

  /** The hub's own '_' as a space; CSS capitalizes. Presentation only. */
  function displayLabel(label) {
    return String(label).replace(/_/g, ' ');
  }

  // ---- the status slot ---------------------------------------------------------
  const PHASE_WORD = { idle: 'Idle', connecting: 'Connecting', handshaking: 'Handshaking', retrying: 'Reconnecting',
    failed: 'Failed' };
  const unattended = $derived(isUnattended(machine.catalog.model && machine.catalog.model.byRole,
    machine.samples, machine.samples[CH_CONTROL_OWNER]));
  // HeroNumerals' typed-jog note ("clamped to window"); it clears its own.
  let jogNote = $state('');
  const slot = $derived.by(() => {
    const link = machine.link;
    const latch = machine.safety;
    if (link.error) return { kind: 'fault', text: 'Link error: ' + link.error };
    if (link.phase !== 'live') {
      return { kind: 'fault', text: (PHASE_WORD[link.phase] || link.phase) + ': no hub link'
        + (link.closeReason ? ' (' + link.closeReason + ')' : '') };
    }
    if (unattended) return { kind: 'unattended', text: 'Unattended: no session in control' };
    if (lastRefusal.at) return { kind: 'refusal' };
    if (jogNote) return { kind: 'notice', text: jogNote };
    if (history.msg) return { kind: 'notice', text: history.msg };
    if (latch && latch.estopLatched) return { kind: 'notice', text: 'Halted: hold ' + estopLabel() + ' 3 s' };
    if (latch && latch.override) return { kind: 'notice', text: 'Override: full-travel jog' };
    if (latch && latch.paused) return { kind: 'notice', text: latch.homeRequired ? 'Paused: home required' : 'Paused' };
    if (latestSafety) return { kind: 'edge' };
    if (link.virtual) return { kind: 'virtual', text: 'Virtual: nothing moves' };
    return { kind: 'idle' };
  });
  // A SOURCE_CONFLICT names the source holding the rail when the hub labels it.
  const ownerName = $derived(railOwnerName(machine.catalog.entries.find((e) => e.id === CH_CONTROL_OWNER),
    machine.samples[CH_CONTROL_OWNER]));
  // RFC-098: the holding session in words, "<client kind> on <client name>".
  const ownerBy = $derived(foreignOwner(machine.samples[CH_CONTROL_OWNER], machine.link.sessionId));
  const ownerText = $derived(ownerName && ownerBy ? ownerName + ' (' + ownerBy + ')' : ownerName || ownerBy);
  const refusalText = $derived((lastRefusal.code === NACK.SOURCE_CONFLICT && ownerText
    ? 'refused: rail owned by ' + ownerText : lastRefusal.text) + (lastRefusal.label ? ' (' + lastRefusal.label + ')' : ''));
  // The hub freed every slot (quiet release, RFC-098): the conflict is over.
  $effect(() => {
    const o = machine.samples[CH_CONTROL_OWNER];
    if (o && !anyOwner(o)) untrack(() => { if (lastRefusal.code === NACK.SOURCE_CONFLICT) clearLastRefusal(); });
  });
  const refusalTitle = $derived(refusalText + (lastRefusal.detail ? ' · ' + lastRefusal.detail : ''));
  const edgeText = $derived(latestSafety
    ? displayLabel(SAFETY_EVENT_KIND_NAME[latestSafety.kind] || ('kind ' + latestSafety.kind)) : '');

  // The hub's home_required is the truth; a NOT_HOMED refusal stands in for
  // a hub that never sets it, until a home op echoes (fire below).
  const homeNeeded = $derived(!!(machine.safety && machine.safety.homeRequired) || lastRefusal.code === NACK.NOT_HOMED);

  // ---- the ops -----------------------------------------------------------------
  /** May THIS session fire this exact op, per the catalog's own access data? */
  function canFire(action, value) {
    // These reads keep the check reactive; the session lives outside Svelte.
    void machine.link.roles; void machine.link.phase; void machine.catalog.ready;
    const session = getSession();
    return !!session && session.isLive && session.canUse(action.channelId, action.key, value);
  }
  function reasonFor(action, value) {
    if (machine.link.phase !== 'live') return 'no hub link';
    if (!canFire(action, value)) return 'session not authorized';
    return '';
  }

  /**
   * One button per op, lowest required access first (option_access, the
   * data the hub gates on), Home leading. Wire value 0 is never an op
   * (RFC-034): every op table numbers real ops from 1. Ops a session lacks
   * access to stay GRAYED, never hidden. The spec-core safety-intents
   * channel draws nothing here: its ops are halves of the pairs (law 14).
   */
  const ops = $derived.by(() => {
    const out = [];
    for (const action of [...actions].sort((a, b) => isHomeRole(b) - isHomeRole(a))) {
      if (action.channelId === CH_SAFETY_INTENTS) continue;
      if (!(action.options && action.options.length)) {
        out.push({ action, value: 1, label: action.label, key: action.uid });
        continue;
      }
      const floor = action.access | 0;
      const accessOf = (i) => (action.optionAccess && action.optionAccess[i] != null ? action.optionAccess[i] : floor);
      action.options
        .map((label, i) => ({ action, value: i, label: label || String(i), access: accessOf(i), key: action.uid + ':' + i }))
        .filter((o) => o.value !== 0)
        .sort((a, b) => a.access - b.access)
        .forEach((o) => out.push(o));
    }
    return out;
  });

  // ---- the measured budget (ph-b5d) --------------------------------------------
  // Every width below is measured from something the decision does not
  // change (the off-layout measuring row, the pair, the primary numeral, the
  // strip box), so a level never feeds back into its own inputs. Levels:
  // 0 Home inline (labeled popover when the hub offers more than Home), 1
  // that control icon-only and Flip in its popover, 2 override in the
  // popover too. One row while level 1 or less fits beside the primary
  // numeral and the status floor, else two rows.
  const homeOp = $derived(ops.find((o) => isHomeRole(o.action) && o.value === HOME_OP.home) || null);
  let stripEl = $state(null), measureEl = $state(null), pairEl = $state(null), ovrEl = $state(null);
  let level = $state(0);
  let compactFits = $state(true);
  const cmp = $derived(compact && compactFits);
  let stacked = $state(false);
  let smallNums = $state(false);
  let menuOpen = $state(false);
  let menuEl = $state(null);
  let flipW = 0, ovrW = 0;   // kept from when each was last inline (the popover unmounts them)
  function measure() {
    if (!stripEl || !measureEl || bare) return;
    const cs = getComputedStyle(stripEl);
    const content = stripEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const prim = stripEl.querySelector('.hn-primary')?.offsetWidth || 0;
    // The secondaries need three 11 px rows (num-h >= 3.4 x 11 + 20); short of that they go (ph-kl5u).
    smallNums = (stripEl.querySelector('.nums')?.offsetHeight || 999) < 58;
    padV = parseFloat(cs.paddingTop) || padV;
    gapV = parseFloat(cs.rowGap) || gapV;
    chromeH = (stripEl.parentElement?.offsetHeight || 0) - stripEl.offsetHeight;
    tapPx = measureEl.querySelector('[data-k=tap]')?.offsetHeight || tapPx;
    // Stacked is decided at the numeral's design size, so the budget's shrink
    // never feeds back into it (and a missing hub reads like a live one).
    const W = innerWidth, F = W >= 1024 ? Math.min(80, Math.max(54, W * .062)) : Math.min(54, Math.max(42, W * .085));
    const valEl = stripEl.querySelector('.hn-primary .hn-val');
    const curF = valEl ? parseFloat(getComputedStyle(valEl).fontSize) : 0;
    const primD = valEl && curF ? Math.max(stripEl.querySelector('.hn-primary .hn-label')?.offsetWidth || 0, valEl.offsetWidth * F / curF) : 3.5 * F;
    const dCol = Math.min(21.6, (F * .95) / 3.4), colEl = stripEl.querySelector('.hn-col .hn-val');
    const cCol = colEl ? parseFloat(getComputedStyle(colEl).fontSize) : 0;
    stripEl.style.setProperty('--prim-w', prim + 'px');
    const w = (k) => [...measureEl.querySelectorAll('[data-k=' + k + ']')].reduce((a, el) => a + el.offsetWidth + GAP, 0);
    const GAP = 6;
    const fEl = ovrEl && ovrEl.querySelector('.rw-flip'), oEl = ovrEl && ovrEl.querySelector('.safety-op');
    if (fEl) flipW = fEl.offsetWidth + GAP;
    if (oEl) ovrW = oEl.offsetWidth + GAP;
    const pair = pairEl ? pairEl.offsetWidth : 0;
    // Home, Flip and Override slots count whether or not the hub offers them,
    // so the row choice never follows link state (ph-t4ge).
    const slot = (pairEl ? pairEl.offsetWidth / 2 : 0) + GAP;
    const ovr = ovrW || slot, fl = flipW || slot;
    const homeW = ops.length > 1 ? w('menu') : ops.length ? w('op') : slot;
    const iconW = ops.length ? w('icon') : slot;
    const needs = [pair + ovr + fl + homeW, pair + ovr + iconW, pair + iconW];
    const colW = stripEl.querySelector('.hn-col')?.offsetWidth;
    const colD = colW && cCol ? colW * dCol / cCol : 11 * dCol + 40;
    const oneRow = content - primD - colD - 18 - Math.min(240, content * 0.25) - 24;
    stacked = !needs.slice(0, 2).some((n) => n <= oneRow);
    const budget = stacked ? content : oneRow;
    const fit = needs.findIndex((n) => n <= budget);
    level = fit < 0 ? 2 : fit;
    if (cmp) {
      // Short of width for the one row (the 200 px floor), the full hero stands until the next resize.
      if (stripEl.scrollWidth > stripEl.clientWidth + 1) compactFits = false;
      else { stacked = false; level = 0; }
    }
  }
  $effect(() => {
    if (!stripEl || !measureEl) return;
    const ro = new ResizeObserver(() => measure());
    for (const el of [stripEl, measureEl, stripEl.querySelector('.nums')]) if (el) ro.observe(el);
    return () => ro.disconnect();
  });
  // A rail mounting or the op set changing moves the budget too.
  $effect(() => { void rail; void ops.length; void railCtl; void cmp; queueMicrotask(measure); });
  // Compact keeps Flip and Override inline and Home as its icon.
  const iconHome = $derived(level >= 1 || (cmp && ops.length > 0));
  const menuShown = $derived(ops.length > 1 || iconHome);
  const flipInMenu = $derived(level >= 1 && !!flip && !cmp);
  const ovrInMenu = $derived(level === 2 && hasOverride && !cmp);
  function onDocClick(e) {
    if (menuOpen && menuEl && !e.composedPath().includes(menuEl)) menuOpen = false;
  }
  function onWindowKey(e) {
    // Prevented, so page fullscreen stays (App.svelte onFullKey).
    if (e.key === 'Escape' && (heroBar.popup || heroBar.quick) && !(rail && rail.busy)) {
      e.preventDefault();
      if (heroBar.popup) document.querySelector('.topstrip .mini')?.focus();
      heroBar.popup = false;
      heroBar.quick = false;
    }
    if (e.key === 'Escape' && menuOpen) {
      menuOpen = false;
      menuEl?.querySelector('.home-btn')?.focus();
    }
  }
  // Home's icon (Lucide, MIT; the OG ui.js ICONS entry).
  const HOME_ICON = '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>';

  let busy = $state({});
  async function fire(op) {
    menuOpen = false;
    if (needsConfirm(op.action, op.value) && !(await askConfirm(confirmCopy(op.action, op.value)))) return;
    busy = { ...busy, [op.key]: true };
    const r = await runAction(op.action, op.value);
    busy = { ...busy, [op.key]: false };
    // A NOT_HOMED refusal clears on the ECHO of a home op, never on the tap.
    if (r.ok && isHomeRole(op.action) && lastRefusal.code === NACK.NOT_HOMED) clearLastRefusal();
  }
  function toggleFlip() {
    menuOpen = false;
    flip.toggle();
  }
</script>

{#snippet homeFace()}
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true">{@html HOME_ICON}</svg>
  <span class="lbl">{homeOp ? displayLabel(homeOp.label) : 'More'}</span>
{/snippet}

{#snippet opButton(op)}
  <button type="button" class="btn" class:hazard={homeNeeded && op === homeOp} disabled={!canFire(op.action, op.value)}
          title={reasonFor(op.action, op.value) || (homeNeeded && op === homeOp ? 'Home required' : undefined)}
          onclick={() => fire(op)}>
    <span class="lbl">{busy[op.key] ? '…' : displayLabel(op.label)}</span>
  </button>
{/snippet}

{#snippet flipButton()}
  <!-- The glyph shows what the press does, never the state (two arrows around
       a struck 0, the left one gray); the state is in the tooltip. -->
  <!-- The ladder wears the fields' ring outside the box (docs/EFFECTS.md A,
       ph-vdk.65), never the inset one. -->
  <button type="button" class="rw-flip field" aria-pressed={flip.on} aria-label="Flip" disabled={!flip.enabled}
          data-shadow={flip.status} data-glow={flip.glow || undefined} title={flip.text} onclick={toggleFlip}
          onanimationend={(e) => { if (e.target === e.currentTarget && e.animationName.startsWith('fx-glow')) flip.glowEnd(); }}>
    <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true">
      <text class="zero" x="12" y="17" text-anchor="middle">0</text>
      <path d="M17.5 12H22M20 9.5L22 12l-2 2.5"/>
      <path class="gray" d="M6.5 12H2M4 9.5L2 12l2 2.5"/>
    </svg>
    <span class="lbl">Flip</span>
  </button>
{/snippet}

<svelte:window onkeydown={onWindowKey} bind:innerHeight={winH} bind:innerWidth={winW} />
<svelte:document onclick={onDocClick} onpointerdown={onPopupAway} />

<div class="topstrip" style:--hb={heroBar.budget ? (heroBar.budget - (railHidden ? 0 : heroBar.railH)) + 'px' : null} class:bare class:woke={woke || held} bind:offsetHeight={stripH}>
  <LinkBar {shell} />
  <div class="strip" class:stacked class:compact={cmp} class:small-nums={smallNums} role="group" aria-label="Safety controls" bind:this={stripEl}>
    <div class="measure" aria-hidden="true" inert bind:this={measureEl}>
      {#each ops as op (op.key)}<span class="btn" data-k="op"><span class="lbl">{displayLabel(op.label)}</span></span>{/each}
      <span class="btn home-btn" data-k="menu">{@render homeFace()}</span>
      <span class="btn home-btn icon-only" data-k="icon">{@render homeFace()}</span>
      <span data-k="tap" style="height: var(--tap)"></span>
    </div>
    <div class="nums">
      {#if rail && rail.posField}
        <HeroNumerals
          posField={rail.posField} velField={rail.velField} targetField={rail.targetField}
          posVal={rail.posVal} speedVal={rail.speedVal} targetVal={rail.targetVal}
          moving={rail.moving} fresh={rail.fresh} targetFresh={rail.targetFresh}
          extentHi={rail.extentHi} jog={rail.jog} onnote={(t) => (jogNote = t)}
        />
      {/if}
    </div>
    <!-- The plan readback (ph-ryi7), on the primary label's line from the
         secondaries rightward: out of flow, above every control's box, so
         nothing moves when it fills. -->
    {#if rail && !cmp}<div class="readback"><PlanStrip readback playing={rail.playing} /></div>{/if}

    <div class="status" class:hastab={tab || railHidden} data-kind={slot.kind}>
      {#if slot.kind === 'refusal'}
        <!-- The text is its own dismiss button: one target, no extra width. -->
        <div class="recovery" role="alert">
          <button type="button" class="st-dismiss" title={refusalTitle} aria-label={'Dismiss: ' + refusalTitle}
                  onclick={clearLastRefusal}>
            <span class="st-text">{refusalText}</span><span class="st-x" aria-hidden="true">×</span>
          </button>
        </div>
      {:else if slot.kind === 'edge'}
        <!-- The latest safety edge, its age and unread count; opens the
             Safety feed (LogPane). Dimmed AND worded when stale (laws 5, 8). -->
        <button type="button" class="evline" class:stale={safetyStale} onclick={openSafetyLog}
                title={edgeText + ' · ' + ageText(now - latestSafety.at) + (unreadSafety ? ' · ' + unreadSafety + ' new' : '')
                  + (safetyStale ? ' · stale, later edges may be missing' : '')}>
          <span class="evkind">{edgeText}</span>
          <span class="evage">{ageText(now - latestSafety.at)}</span>
          {#if safetyStale}<span class="evtag">stale</span>{/if}
          {#if unreadSafety}<span class="evtag">{unreadSafety}<span class="evword">{' new'}</span></span>{/if}
        </button>
      {:else if slot.text}
        <span class="st-text" class:unattended={slot.kind === 'unattended'}
              role={slot.kind === 'notice' ? 'status' : 'alert'} title={slot.text}>{slot.text}</span>
        {#if slot.kind === 'fault' && (machine.link.phase === 'retrying' || machine.link.phase === 'failed')}
          <button type="button" class="btn" onclick={retryNow}>Retry</button>
        {/if}
      {/if}
    {#if tab || railHidden}
      <div class="railtab">
        {#if railHidden}<MiniRail onshow={showRail} />{/if}
        {#if tab}
          <button type="button" class="tab" aria-label={railHidden ? 'Show rail' : 'Hide rail'} title={railHidden ? 'Show rail' : 'Hide rail'}
                  aria-expanded={!railHidden} onclick={toggleRail}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d={railHidden ? 'M2.5 4.5l3.5 3.5 3.5-3.5' : 'M2.5 7.5l3.5-3.5 3.5 3.5'}/></svg>
          </button>
        {/if}
      </div>
    {/if}
    </div>

    <div class="dock">
      {#if !menuShown}
        <div class="ops">{#each ops as op (op.key)}{@render opButton(op)}{/each}</div>
      {:else}
        <div class="home-menu" bind:this={menuEl}>
          <button type="button" class="btn home-btn" class:icon-only={iconHome} class:hazard={homeNeeded}
                  aria-haspopup="true" aria-expanded={menuOpen}
                  aria-label={homeOp ? displayLabel(homeOp.label) : 'More'}
                  title={homeNeeded ? 'Home required' : homeOp ? 'Home and machine ops' : 'Machine ops'}
                  onclick={() => (menuOpen = !menuOpen)}>{@render homeFace()}</button>
          {#if menuOpen}
            <div class="menu-pop" role="group" aria-label="Home and machine ops">
              {#each ops as op (op.key)}{@render opButton(op)}{/each}
              {#if flipInMenu}{@render flipButton()}{/if}
              {#if ovrInMenu}<SafetyOp action={specSafety} op={SAFETY_OP.override} />{/if}
            </div>
          {/if}
        </div>
      {/if}
      {#if (flip && !flipInMenu) || (hasOverride && !ovrInMenu)}
        <div class="ovr" bind:this={ovrEl}>
          {#if flip && !flipInMenu}{@render flipButton()}{/if}
          {#if hasOverride && !ovrInMenu}<SafetyOp action={specSafety} op={SAFETY_OP.override} />{/if}
        </div>
      {/if}
      <!-- Bound by spec-core identity alone (law 2), never by a role tag.
           The e-stop is outermost. -->
      <div class="pair" bind:this={pairEl}>
        <SafetyOp action={specSafety} op={SAFETY_OP.pause} />
        <SafetyOp action={specSafety} op={SAFETY_OP.estop} />
      </div>
    </div>
  </div>
</div>

<style>
  /* Desktop: the first row of .app's 100dvh flex column, where sticky is
     inert. Phone: the page scrolls and this sticks at the viewport top.
     Full bleed through .app's side padding (DESIGN §10.4). ConfirmLayer sits
     at z 29, under this. */
  .topstrip {
    position: sticky;
    top: 0;
    z-index: 30;
    flex: none;
    margin: 0 calc(var(--app-pad, var(--gap)) * -1);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line);
  }

  /* ---- the strip: fixed height from the viewport alone ----------------------
     --num-h mirrors HeroNumerals' primary clamp (.hn-primary .hn-val, line
     height .95, plus its label line): change both together. */
  .strip {
    /* The hero budget caps the numeral (DESIGN §10.12): link bar, padding and, stacked, the control row come off it. */
    --num-min: calc(54px * .95 + 20px);
    --num-cap: max(var(--num-min), calc(var(--hb, 999px) - 46px));
    --num-h: min(calc(clamp(54px, 6.2vw, 80px) * .95 + 20px), var(--num-cap));
    /* One box for Home, Flip, Override, Pause, Halt: icon above the word. */
    --sb-w: 63px;
    --sb-h: min(51px, max(var(--num-h), var(--tap)));
    --sico: clamp(12px, calc(var(--sb-h) - 33px), 17px);
    display: flex;
    align-items: center;
    gap: var(--sp-2) var(--sp-4);
    --pad-v: calc(var(--sp-2) * 1.5);
    height: calc(max(var(--num-h), var(--tap)) + 2 * var(--pad-v));
    padding: var(--pad-v) var(--gap);
    position: relative;
  }
  /* Off-layout: the ops at their inline width, for the budget only. */
  .measure {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    width: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }
  .measure > * { flex: none; }
  @media (max-width: 1023px) {
    .strip { --num-min: calc(42px * .95 + 20px); --num-h: min(calc(clamp(42px, 8.5vw, 54px) * .95 + 20px), var(--num-cap)); }
  }
  /* Stacked (the measured budget says one row cannot hold the group): the
     primary numeral and the status on one row, the controls on a second the
     grid guarantees (a wrapping flex row once pushed the pair onto a third,
     clipped line). */
  .strip.stacked {
    --num-cap: max(var(--num-min), calc(var(--hb, 999px) - 52px - var(--tap)));
    --sb-h: var(--tap);
    display: grid;
    grid-template: "num status" var(--num-h) "dock dock" var(--tap) / min-content minmax(0, 1fr);
    height: calc(var(--num-h) + var(--pad-v) + var(--tap) + 2 * var(--pad-v));
  }
  .stacked .nums { grid-area: num; }
  .stacked .status { grid-area: status; }
  .strip.stacked .dock { grid-area: dock; display: flex; justify-content: flex-end; gap: var(--sp-2); min-width: 0; }
  /* Watch-sized: no room beside the numeral. A current condition covers
     the numeral in its own cell; the edge history stays in the Log. */
  @media (max-width: 300px) {
    .strip.stacked { grid-template-columns: minmax(0, 1fr); grid-template-areas: "num" "dock"; }
    .strip .status { grid-area: num; z-index: 1; justify-content: flex-start; background: var(--bg-raised); }
    .strip .status:is([data-kind=idle], [data-kind=edge]) { display: none; }
  }

  /* The only thing on the row that shrinks: its secondary numerals wrap
     below the primary and clip rather than grow the strip. The clip box is
     the strip's own edges (the 6px padding above and below, the gutter on
     the left) and, on the right, the numerals' own 18px gap, so the glow is
     never cut short and a clipped neighbor never peeks in. Stacked, it
     reaches 12px into the row gap and the dock row; a wrapped row starts
     past the 18px row gap, outside either box. */
  .small-nums .nums :global(.hn-col), .small-nums .readback { display: none; }
  .nums {
    flex: 0 1 auto;
    height: var(--num-h);
    clip-path: inset(-6px -18px -6px calc(var(--gap) * -1));
  }
  .stacked .nums { clip-path: inset(-6px -18px -12px calc(var(--gap) * -1)); }
  .nums :global(.hn-label) { white-space: nowrap; }
  /* Handheld: no room beside the numeral; the column stays measurable but unseen. */
  @media (max-width: 640px) { .stacked .nums :global(.hn-col) { position: absolute; visibility: hidden; } }
  /* The strip's top 6 px plus one label line is clear of the status slot
     and the dock (both centered, a --tap tall). Stacked, a condition in the
     status slot outranks it. */
  .readback {
    position: absolute;
    top: var(--sp-2);
    left: calc(var(--gap) + var(--prim-w, 0px) + var(--sp-5));
    right: var(--gap);
    pointer-events: none;
  }
  .stacked:has(.status:not([data-kind=idle])) .readback { display: none; }
  /* The phone's mini rides the status slot's right end: the readback stops short of it. */
  .stacked:has(:global(.mini)) .readback { right: calc(var(--gap) + 64px + var(--sp-3)); }

  /* Compact (DESIGN §10.3): one row at the tap height. The numeral loses its
     label line and the planned stack; a current condition takes the
     numeral's place (the watch-size rule), so the mini and the controls never
     move; the safety-edge history stays in the Log. */
  /* Buttons at the 40 px floor (law 12), the row's gaps tight: the row
     returns 40 px or more at 860x420, where the full hero is already one row. */
  .strip.compact { --tap: max(40px, calc(var(--s) * 40px)); --num-h: var(--tap); --num-cap: var(--tap); --pad-v: 0px; gap: var(--sp-2); }
  .compact .nums { flex: none; clip-path: none; }
  /* Each button as wide as its word, never under the target: a label is never clipped. */
  .compact .dock :global(:is(.safety-op .btn, .rw-flip)) { width: auto; min-width: var(--tap); }
  .compact .nums :global(:is(.hn-primary .hn-label, .hn-col)) { display: none; }
  .compact .nums :global(.hn-primary .hn-val) { font-size: 1.35rem; }
  .compact .status { min-width: calc(64px + var(--sp-3)); }
  .compact .status[data-kind=edge] .evline { display: none; }
  .compact:has(.status:not([data-kind=idle], [data-kind=edge], [data-kind=virtual])) .nums { display: none; }

  .status {
    flex: 1 1 0;
    align-self: stretch;
    min-width: min(240px, 25%);
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    justify-content: center;
    font-size: 12.5px;
  }
  /* Two lines at most, inside the slot's fixed box. */
  .st-text {
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    line-height: 1.3;
    color: var(--ink-dim);
  }
  [data-kind='fault'] .st-text, .recovery .st-text,
  [data-kind='unattended'] .st-text, [data-kind='notice'] .st-text, [data-kind='virtual'] .st-text { color: var(--warn-ink, var(--warn)); }

  .recovery {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }

  .dock { display: contents; }

  /* Rides the status slot's right end: no width of its own in the strip's budget. */
  .status { position: relative; }
  .status.hastab { padding-right: calc(var(--tap) + var(--sp-3)); }
  .railtab { position: absolute; right: 0; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: var(--sp-2); }
  .status.hastab:has(.mini) { padding-right: calc(var(--tap) + 64px + var(--sp-3) + var(--sp-2)); }
  @media (max-width: 300px) { .railtab { display: none; } .status.hastab { padding-right: 0; } }
  .tab {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap);
    min-height: var(--tap);
    background: transparent;
    border: 0;
    color: var(--ink-dim);
  }
  .tab:hover { color: var(--ink); }
  .tab svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  /* Bare: out of flow at the window's top right, the pair alone. */
  .topstrip.bare { position: fixed; top: 0; right: 0; margin: 0; background: none; border: 0; }
  .topstrip.bare :global(.linkbar), .bare :is(.nums, .status, .ops, .home-menu, .ovr) { display: none; }
  .topstrip.bare .strip { display: flex; height: auto; padding: var(--sp-2); }
  .bare .pair { opacity: .5; background: var(--bg-raised); border-radius: var(--r-s); transition: opacity var(--t-quick); }
  .bare .pair:is(:hover, :focus-within), .woke .pair { opacity: 1; }
  /* The fixed pair; each control sizes itself (SafetyOp.svelte, law 12). */
  .pair {
    flex: none;
    display: flex;
    gap: var(--sp-2);
  }
  /* Never shrink, never scroll: the budget decides what is inline. */
  .ovr, .ops, .home-menu { flex: none; display: flex; gap: var(--sp-2); }
  .ops:empty { display: none; }

  .home-menu { position: relative; }
  .btn.home-btn {
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    min-width: var(--sb-w, 63px);
    height: var(--sb-h, auto);
    padding: var(--sp-1) var(--sp-2);
    font-size: max(11px, .54rem);
    line-height: 1;
  }
  /* One icon box and one drawn stroke for every strip glyph. */
  .ico { width: var(--sico, 28px); height: var(--sico, 28px); }
  .ico :global(*) { vector-effect: non-scaling-stroke; }
  .home-btn[aria-expanded='true'] { border-color: var(--line-4); }
  /* Overlay: out of flow under its button, above the rail; moves nothing.
     Opens toward the pair, mirrored with the dock. */
  .menu-pop {
    position: absolute;
    top: calc(100% + var(--sp-2));
    left: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-2);
    min-width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .6);
  }
  .menu-pop .btn { justify-content: flex-start; }
  .menu-pop :global(.safety-op) { height: auto; }

  /* Law 12 floor; a quiet chip like the safety ops, warn-bordered while on. Same
     box as the ops (--sb-w, --sb-h). */
  .rw-flip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-height: var(--tap);
    min-width: var(--sb-w, 63px);
    height: var(--sb-h, auto);
    padding: var(--sp-1) var(--sp-2);
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    color: var(--ink);
    font-weight: 500;
    font-size: max(11px, .54rem);
    line-height: 1;
  }
  .rw-flip .gray { stroke: var(--tx-ghost); }
  /* The hero numerals' face and its slashed zero. */
  .rw-flip .zero { font: 500 15px var(--mono); fill: currentColor; stroke: none; }
  .rw-flip[aria-pressed='true'] { border-color: var(--warn); }
  .rw-flip:disabled { opacity: .4; }
  .rw-flip:is([data-shadow='pending'], [data-shadow='overdue']) .ico { opacity: .5; }
  .rw-flip:is([data-shadow='overdue'], [data-shadow='fault']) { color: var(--warn-ink, var(--warn)); }

  /* Home required (DESIGN §10.3): the safety red, pulsing; still at rest
     under reduced motion (law 12). */
  .btn.hazard { border-color: var(--bad); animation: home-need 1.2s ease-in-out infinite; }
  @keyframes home-need {
    50% { box-shadow: 0 0 0 2px rgba(var(--bad-rgb), .45), 0 0 10px rgba(var(--bad-rgb), .35); }
  }

  /* Phone: the safety ops drop their idle hint line and narrow to 64 px
     (--tap still holds, law 12); a live status line still shows. */
  @media (max-width: 479px) {
    .strip { --sb-w: var(--tap); }
    .dock :global(.safety-op .btn) { padding: var(--sp-1) var(--sp-1) var(--sp-1); }
    .dock :global(.safety-op :is(.state.hint, .hints)) { display: none; }
  }
  @media (max-width: 300px) {
    .dock :global(.safety-op .btn) { padding: var(--sp-1) var(--sp-2); }
    .dock :global(.safety-op .ico) { display: none; }
  }
  .home-btn.icon-only { min-width: var(--tap); }
  .home-btn.icon-only .lbl { display: none; }

  .btn {
    /* Never shrink: flex would clip the labels mid-word. */
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    min-width: max(var(--tap), 56px);
    padding: 0 var(--sp-4);
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    color: var(--ink);
    font-weight: 500;
    font-size: .72rem;
    white-space: nowrap;
    transition: border-color var(--t-quick), color var(--t-quick);
  }
  .btn:disabled { opacity: 0.4; }
  .btn:not(:disabled):hover { border-color: var(--line-4); }
  .btn:not(:disabled):active { border-color: var(--highlight); color: var(--highlight); }
  /* Labels are the hub's own catalog strings: capitalize is presentation. */
  .btn .lbl { text-transform: capitalize; }

  .st-dismiss {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    min-height: var(--tap);
    padding: 0 var(--sp-2);
    text-align: left;
    border-radius: var(--r-s);
  }
  .st-dismiss:hover { background: var(--line-soft); }
  .st-x { flex: none; font-size: 1rem; color: var(--ink-dim); }

  .evline {
    min-width: 0;
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: var(--tap);
    padding: 0 var(--sp-3);
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    font-size: 12px;
    color: var(--ink);
    overflow: hidden;
    white-space: nowrap;
    transition: border-color var(--t-quick);
  }
  .evline:hover { border-color: var(--line-4); }
  .evline.stale { opacity: .55; }
  /* Sentence case, and the event word keeps its width longest: the age and
     the tags yield first (ph-44q). */
  .evkind { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .evkind::first-letter { text-transform: uppercase; }
  .evage, .evtag { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .evtag { flex: 0 0 auto; }
  /* Handheld keeps the count, drops the word. */
  @media (max-width: 479px) { .evword { display: none; } }
  .evage { font-family: var(--mono); font-size: 11px; color: var(--tx-mut); }
  .evtag {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-dim);
    border: 1px solid var(--line-2);
    padding: 0 var(--sp-2);
  }

  :global(html.still) .btn.hazard { animation: none; }
</style>
