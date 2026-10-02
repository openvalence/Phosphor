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
   *   instant), ONE status slot in the middle, the controls right: the e-stop
   *   and pause pair (law 14, SafetyOp.svelte), override/return while a rail
   *   is mounted (SPEC §11.1), then every action.home / action.safety op the
   *   catalog advertises (Home first). The pair never scrolls or shrinks, at
   *   every width and in every state (law 1); placed copies are extras.
   * - Nothing in the strip scrolls sideways (ph-b5d). Short of width the
   *   secondary numerals clip first; past the group's measured budget, in
   *   order: the ops collapse into ONE Home control with a popover (Home,
   *   Force Home, whatever else the hub offers), that control drops its
   *   label, the strip stacks into two rows, and last override/return joins
   *   the popover. The pair never shrinks and is never in the popover.
   * - The status slot shows ONE thing, by priority: link fault, unattended
   *   (RENDERING §10.1 rule 3), refusal, latch notice, latest safety edge.
   *   The refusal is shadow.svelte.js's `lastRefusal`, written by all three
   *   write paths, so a refusal is visible after its control has scrolled
   *   off or unmounted; the remedy table (`NOT_HOMED` -> `action.home`) lives
   *   there too, this file only renders it.
   * - The safety-intents channel is found by spec-core identity
   *   (specSafetyAction, law 2), a role tag being one more discovery path,
   *   never the only one: a hub that never annotated it keeps its e-stop.
   */
  import { machine, getSession, specSafetyAction, estopLabel, retryNow } from '../model/machine.svelte.js';
  import { runAction, lastRefusal, remedyForLastRefusal, clearLastRefusal } from '../model/shadow.svelte.js';
  import { SAFETY_OP, HOME_OP, CH_SAFETY_INTENTS, CH_CONTROL_OWNER } from '../../../Valence/clients/js/index.js';
  import { optionLabel } from '../model/format.js';
  import { needsConfirm, confirmCopy, isUnattended } from '../model/actions.js';
  import { askConfirm } from './confirm.svelte.js';
  import { SAFETY_EVENT_KIND_NAME } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import { logView } from './logview.svelte.js';
  import LinkBar from './LinkBar.svelte';
  import SafetyOp from './widgets/SafetyOp.svelte';
  import HeroNumerals from './hero/HeroNumerals.svelte';
  import { railReadout } from './hero/RailWidget.svelte';

  // onopenlog: called after the strip points LogPane at its Safety feed; App
  // switches nav. shell: the shell's window buttons (main.js), null on the
  // served page.
  let { onopenlog = null, shell = null } = $props();

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
  // Override/return is the rail's (RENDERING §8.4 `axis`): only with a rail,
  // and never on a hub whose op table lacks it (law 7).
  const hasOverride = $derived(!!rail && !!(specSafety && (specSafety.options || [])[SAFETY_OP.override]));

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
  const PHASE_WORD = { idle: 'idle', connecting: 'connecting', handshaking: 'handshaking', retrying: 'reconnecting',
    failed: 'no link' };
  const unattended = $derived(isUnattended(machine.catalog.model && machine.catalog.model.byRole,
    machine.samples, machine.samples[CH_CONTROL_OWNER]));
  const slot = $derived.by(() => {
    const link = machine.link;
    const latch = machine.safety;
    if (link.error) return { kind: 'fault', text: 'link error: ' + link.error };
    if (link.phase !== 'live') {
      return { kind: 'fault', text: (PHASE_WORD[link.phase] || link.phase) + ': no hub link, nothing here can drive '
        + 'the machine' + (link.closeReason ? ' (' + link.closeReason + ')' : '') };
    }
    if (unattended) return { kind: 'unattended', text: 'unattended: moving with no session in control' };
    if (lastRefusal.at) return { kind: 'refusal' };
    if (latch && latch.estopLatched) return { kind: 'notice', text: 'halted: hold ' + estopLabel() + ' 3 s to release' };
    if (latch && latch.override) return { kind: 'notice', text: 'override: jog over the whole travel, Return when done' };
    if (latch && latch.paused) {
      return { kind: 'notice', text: latch.homeRequired ? 'paused: home required' : 'paused: resume to continue' };
    }
    if (latestSafety) return { kind: 'edge' };
    return { kind: 'idle' };
  });
  const refusalText = $derived(lastRefusal.text + (lastRefusal.label ? ' (' + lastRefusal.label + ')' : ''));
  const refusalTitle = $derived(refusalText + (lastRefusal.detail ? ' · ' + lastRefusal.detail : ''));
  const edgeText = $derived(latestSafety
    ? displayLabel(SAFETY_EVENT_KIND_NAME[latestSafety.kind] || ('kind ' + latestSafety.kind)) : '');

  const remedy = $derived.by(() => remedyForLastRefusal());
  let remedyBusy = $state(false);
  async function fireRemedy() {
    if (!remedy) return;
    remedyBusy = true;
    const result = await runAction(remedy.action, remedy.op);
    remedyBusy = false;
    // Cleared on the ECHO of the remedy, never on the tap.
    if (result.ok) clearLastRefusal();
  }

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
    if (!canFire(action, value)) return 'this session is not authorized for this op';
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
  // 0 every op inline, 1 the ops in the Home popover, 2 that control
  // icon-only, 3 override in the popover too. One row while level 2 or less
  // fits beside the primary numeral and the status floor, else two rows.
  const homeOp = $derived(ops.find((o) => isHomeRole(o.action) && o.value === HOME_OP.home) || null);
  let stripEl = $state(null), measureEl = $state(null), pairEl = $state(null), ovrEl = $state(null);
  let level = $state(0);
  let stacked = $state(false);
  let menuOpen = $state(false);
  let menuEl = $state(null);
  let ovrW = 0;   // kept from when override was last inline (level 3 unmounts it)
  function measure() {
    if (!stripEl || !measureEl) return;
    const cs = getComputedStyle(stripEl);
    const content = stripEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const prim = stripEl.querySelector('.hn-primary')?.offsetWidth || 0;
    const w = (k) => [...measureEl.querySelectorAll('[data-k=' + k + ']')].reduce((a, el) => a + el.offsetWidth + GAP, 0);
    const GAP = 6;
    if (ovrEl) ovrW = ovrEl.offsetWidth + GAP;
    const pair = pairEl ? pairEl.offsetWidth : 0;
    const ovr = hasOverride ? ovrW : 0;
    const menuFull = w('menu'), menuIcon = w('icon');
    const many = ops.length > 1;
    const needs = [pair + ovr + w('op'), pair + ovr + (many ? menuFull : w('op')),
      pair + ovr + (ops.length ? menuIcon : 0), pair + (ops.length || hasOverride ? menuIcon : 0)];
    const oneRow = content - prim - Math.min(240, content * 0.25) - 24;
    stacked = !needs.slice(0, 3).some((n) => n <= oneRow);
    const budget = stacked ? content : oneRow;
    const fit = needs.findIndex((n) => n <= budget);
    level = fit < 0 ? 3 : fit;
  }
  $effect(() => {
    if (!stripEl || !measureEl) return;
    const ro = new ResizeObserver(() => measure());
    for (const el of [stripEl, measureEl, stripEl.querySelector('.nums')]) if (el) ro.observe(el);
    return () => ro.disconnect();
  });
  // A rail mounting or the op set changing moves the budget too.
  $effect(() => { void rail; void ops.length; void hasOverride; queueMicrotask(measure); });
  const menuShown = $derived(level >= 1 && (ops.length > 1 || level >= 2));
  const ovrInMenu = $derived(level === 3 && hasOverride);
  function onDocClick(e) {
    if (menuOpen && menuEl && !e.composedPath().includes(menuEl)) menuOpen = false;
  }
  function onWindowKey(e) {
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
    await runAction(op.action, op.value);
    busy = { ...busy, [op.key]: false };
  }
</script>

{#snippet homeFace()}
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true">{@html HOME_ICON}</svg>
  <span class="lbl">{homeOp ? displayLabel(homeOp.label) : 'More'}</span>
  <svg class="caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>
{/snippet}

{#snippet opButton(op)}
  <button type="button" class="btn" disabled={!canFire(op.action, op.value)}
          title={reasonFor(op.action, op.value) || op.label} onclick={() => fire(op)}>
    <span class="lbl">{busy[op.key] ? '…' : displayLabel(op.label)}</span>
  </button>
{/snippet}

<svelte:window onkeydown={onWindowKey} />
<svelte:document onclick={onDocClick} />

<div class="topstrip" bind:offsetHeight={stripH}>
  <LinkBar {shell} />
  <div class="strip" class:stacked role="group" aria-label="Safety controls" bind:this={stripEl}>
    <div class="measure" aria-hidden="true" inert bind:this={measureEl}>
      {#each ops as op (op.key)}<span class="btn" data-k="op"><span class="lbl">{displayLabel(op.label)}</span></span>{/each}
      <span class="btn home-btn" data-k="menu">{@render homeFace()}</span>
      <span class="btn home-btn icon-only" data-k="icon">{@render homeFace()}</span>
    </div>
    <div class="nums">
      {#if rail && rail.posField}
        <HeroNumerals
          posField={rail.posField} velField={rail.velField} targetField={rail.targetField}
          posVal={rail.posVal} speedVal={rail.speedVal} targetVal={rail.targetVal}
          moving={rail.moving} fresh={rail.fresh} targetFresh={rail.targetFresh}
          extentHi={rail.extentHi}
        />
      {/if}
    </div>

    <div class="status" data-kind={slot.kind}>
      {#if slot.kind === 'refusal'}
        <!-- The text is its own dismiss button: one target, no extra width. -->
        <div class="recovery" role="alert">
          <button type="button" class="st-dismiss" title={refusalTitle + ' (tap to dismiss)'}
                  onclick={clearLastRefusal}>
            <span class="st-text">{refusalText}</span><span class="st-x" aria-hidden="true">×</span>
          </button>
          {#if remedy}
            <button type="button" class="btn recover" disabled={!canFire(remedy.action, remedy.op)}
                    title={reasonFor(remedy.action, remedy.op)} onclick={fireRemedy}>
              {remedyBusy ? '…' : 'Fix: ' + optionLabel(remedy.action, remedy.op)}
            </button>
          {/if}
        </div>
      {:else if slot.kind === 'edge'}
        <!-- The latest safety edge, its age and unread count; opens the
             Safety feed (LogPane). Dimmed AND worded when stale (laws 5, 8). -->
        <button type="button" class="evline" class:stale={safetyStale} onclick={openSafetyLog}
                title={edgeText + ', ' + ageText(now - latestSafety.at) + (unreadSafety ? ', ' + unreadSafety + ' new' : '')
                  + (safetyStale ? ' (stale: the link has not been live since this edge, later edges may be missing)'
                                 : ': open the safety event history')}>
          <span class="evkind">{edgeText}</span>
          <span class="evage">{ageText(now - latestSafety.at)}</span>
          {#if safetyStale}<span class="evtag">stale</span>{/if}
          {#if unreadSafety}<span class="evtag">{unreadSafety} new</span>{/if}
        </button>
      {:else if slot.text}
        <span class="st-text" class:unattended={slot.kind === 'unattended'}
              role={slot.kind === 'notice' ? 'status' : 'alert'} title={slot.text}>{slot.text}</span>
        {#if slot.kind === 'fault' && (machine.link.phase === 'retrying' || machine.link.phase === 'failed')}
          <button type="button" class="btn" onclick={retryNow}>Retry now</button>
        {/if}
      {/if}
    </div>

    <div class="dock">
      <!-- Bound by spec-core identity alone (law 2), never by a role tag. -->
      <div class="pair" bind:this={pairEl}>
        <SafetyOp action={specSafety} op={SAFETY_OP.estop} />
        <SafetyOp action={specSafety} op={SAFETY_OP.pause} />
      </div>
      {#if hasOverride && !ovrInMenu}<div class="ovr" bind:this={ovrEl}><SafetyOp action={specSafety} op={SAFETY_OP.override} /></div>{/if}
      {#if !menuShown}
        <div class="ops">{#each ops as op (op.key)}{@render opButton(op)}{/each}</div>
      {:else}
        <div class="home-menu" bind:this={menuEl}>
          <button type="button" class="btn home-btn" class:icon-only={level >= 2} aria-haspopup="true" aria-expanded={menuOpen}
                  aria-label={homeOp ? displayLabel(homeOp.label) : 'More'}
                  title={(homeOp ? 'Home' : 'More') + ': ' + [...(ovrInMenu ? ['override'] : []), ...ops.map((o) => displayLabel(o.label))].join(', ')}
                  onclick={() => (menuOpen = !menuOpen)}>{@render homeFace()}</button>
          {#if menuOpen}
            <div class="menu-pop" role="group" aria-label="Home and machine ops">
              {#if ovrInMenu}<SafetyOp action={specSafety} op={SAFETY_OP.override} />{/if}
              {#each ops as op (op.key)}{@render opButton(op)}{/each}
            </div>
          {/if}
        </div>
      {/if}
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
    margin: 0 calc(var(--gap) * -1);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line);
  }

  /* ---- the strip: fixed height from the viewport alone ----------------------
     --num-h mirrors HeroNumerals' primary clamp (.hn-primary .hn-val, line
     height .95, plus its label line): change both together. */
  .strip {
    --num-h: calc(clamp(54px, 6.2vw, 80px) * .95 + 20px);
    display: flex;
    align-items: center;
    gap: 6px 12px;
    height: calc(max(var(--num-h), var(--tap)) + 12px);
    padding: 6px var(--gap);
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
    .strip { --num-h: calc(clamp(42px, 8.5vw, 54px) * .95 + 20px); }
  }
  /* Stacked (the measured budget says one row cannot hold the group): the
     primary numeral and the status on one row, the controls on a second the
     grid guarantees (a wrapping flex row once pushed the pair onto a third,
     clipped line). */
  .strip.stacked {
    display: grid;
    grid-template: "num status" var(--num-h) "dock dock" var(--tap) / min-content minmax(0, 1fr);
    height: calc(var(--num-h) + 6px + var(--tap) + 12px);
  }
  .stacked .nums { grid-area: num; }
  .stacked .status { grid-area: status; align-self: center; }
  .strip.stacked .dock { grid-area: dock; display: flex; gap: 6px; min-width: 0; }
  /* Watch-sized: no room beside the numeral. A current condition covers
     the numeral in its own cell; the edge history stays in the Log. */
  @media (max-width: 300px) {
    .strip.stacked { grid-template-columns: minmax(0, 1fr); grid-template-areas: "num" "dock"; }
    .strip .status { grid-area: num; z-index: 1; justify-content: flex-start; background: var(--bg-raised); }
    .strip .status:is([data-kind=idle], [data-kind=edge]) { display: none; }
  }

  /* The secondary numerals wrap below the primary and clip rather than grow
     the strip; the primary is the cell's minimum width. */
  /* The only thing on the row that shrinks: its secondary numerals clip. */
  .nums {
    flex: 0 1 auto;
    height: var(--num-h);
    overflow: clip;
  }
  .nums :global(.hn-label) { white-space: nowrap; }

  .status {
    flex: 1 1 0;
    min-width: min(240px, 25%);
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 8px;
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
  [data-kind='unattended'] .st-text, [data-kind='notice'] .st-text { color: var(--warn); }

  .recovery {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dock { display: contents; }
  /* The fixed pair; each control sizes itself (SafetyOp.svelte, law 12). */
  .pair {
    flex: none;
    display: flex;
    gap: 6px;
  }
  /* Never shrink, never scroll: the budget decides what is inline. */
  .ovr, .ops, .home-menu { flex: none; display: flex; gap: 6px; }
  .ops:empty { display: none; }

  .home-menu { position: relative; }
  .home-btn { gap: 6px; }
  .home-btn .ico { width: 14px; height: 14px; }
  .home-btn .caret { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.4; }
  .home-btn[aria-expanded='true'] { border-color: var(--line-4); }
  /* Overlay: out of flow under its button, above the rail; moves nothing. */
  .menu-pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    min-width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .6);
  }
  .menu-pop .btn { justify-content: flex-start; }

  /* Phone: the safety ops drop their idle hint line and the 96 px floor
     (--tap still holds, law 12); a live status line still shows. */
  @media (max-width: 479px) {
    .dock :global(.safety-op .btn) { min-width: var(--tap); padding: 2px 8px; }
    .dock :global(.safety-op .state.hint) { display: none; }
  }
  @media (max-width: 300px) {
    .dock :global(.safety-op .btn) { padding: 2px 4px; }
    .dock :global(.safety-op .ico) { display: none; }
  }
  .home-btn.icon-only { padding: 0 8px; min-width: var(--tap); }
  .home-btn.icon-only .lbl { display: none; }

  .btn {
    /* Never shrink: flex would clip the labels mid-word. */
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    min-width: max(var(--tap), 56px);
    padding: 0 12px;
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    color: var(--ink);
    font-weight: 500;
    font-size: .72rem;
    white-space: nowrap;
    transition: border-color .12s, color .12s;
  }
  .btn:disabled { opacity: 0.4; }
  .btn:not(:disabled):hover { border-color: var(--line-4); }
  .btn:not(:disabled):active { border-color: var(--reality); color: var(--reality); }
  /* Labels are the hub's own catalog strings: capitalize is presentation. */
  .btn .lbl { text-transform: capitalize; }

  .btn.recover {
    background: var(--bad);
    border-color: var(--bad);
    color: var(--bg);
    font-weight: 700;
  }
  .btn.recover:disabled { opacity: 0.5; }
  .st-dismiss {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: var(--tap);
    padding: 0 4px;
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
    gap: 8px;
    min-height: var(--tap);
    padding: 0 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    font-size: 12px;
    color: var(--ink);
    overflow: hidden;
    white-space: nowrap;
    transition: border-color .12s;
  }
  .evline:hover { border-color: var(--line-4); }
  .evline.stale { opacity: .55; }
  .evkind { text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; }
  .evage { font-family: var(--mono); font-size: 11px; color: var(--tx-mut); }
  .evtag {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-dim);
    border: 1px solid var(--line-2);
    padding: 0 5px;
  }

  @media (prefers-reduced-motion: reduce) {
    .btn, .evline { transition: none; }
  }
</style>
