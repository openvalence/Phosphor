<script>
  /**
   * TopStrip.svelte -- the one top strip (DESIGN §10.3): the shell's row
   * (window controls, discovery, transport; shell only), the LinkBar, and
   * the persistent safety region. One sticky box at top 0 in both scroll
   * modes, so there is no reserve to double-count (webui.md T22).
   *
   * Discovers what to render entirely from the catalog: any INTENT action
   * whose RFC-019 role starts with `action.safety` or `action.home` lands
   * here, identified by role — never by channel id (CLAUDE.md 3 / the task
   * contract). The safety-intents channel's `op` field is a single select
   * schema field whose `.options` carries every op the hub knows (RFC-025b):
   * each option is a distinct wire value and renders as its own button.
   *
   * E-STOP REACHABILITY: the strip's fixed pair is the e-stop and pause
   * controls (RFC-085), each ONE two-state control (law 14, SafetyOp.svelte),
   * outside the scrolling op groups at every width and in every state (law 1).
   * This strip is the one surface stop reachability depends on; placed copies
   * are extras. Builder edit mode must never remove the pair (DESIGN §10.3).
   * The spec-core safety-intents channel renders NO op buttons of its own:
   * release and resume are the pair's second states, override and return
   * live on the rail (SPEC §11.1).
   *
   * GLOBAL REFUSAL SURFACE: this strip is pinned to the viewport, so it is the
   * one place a refusal from ANY control (a settings slider, an action
   * button, the rail's move tape — any of shadow.svelte.js's three entry
   * points) is guaranteed to be visible even after the control that sent it
   * has scrolled off or unmounted. `lastRefusal` + `remedyForLastRefusal()`
   * come from shadow.svelte.js, which is also where the NACK-code -> action-
   * role table lives (`NOT_HOMED` -> `action.home`); this component only
   * renders it.
   */
  import { machine, getSession, specSafetyAction } from '../model/machine.svelte.js';
  import { runAction, lastRefusal, remedyForLastRefusal, clearLastRefusal } from '../model/shadow.svelte.js';
  import { SAFETY_OP, HOME_OP, CH_SAFETY_INTENTS } from '../../../Valence/clients/js/index.js';
  import { optionLabel } from '../model/format.js';
  import { needsConfirm, confirmCopy } from '../model/actions.js';
  import { askConfirm } from './confirm.svelte.js';
  import { isUnattended } from '../model/actions.js';
  import { CH_CONTROL_OWNER } from '../../../Valence/clients/js/index.js';
  import { SAFETY_EVENT_KIND_NAME } from '../../../Valence/clients/js/generated/registry_vocab.js';
  import { logView } from './logview.svelte.js';
  import LinkBar from './LinkBar.svelte';
  import SafetyOp from './widgets/SafetyOp.svelte';

  // onopenlog: called after the strip points LogPane at its Safety feed; App
  // switches nav. Shell: the shell's row (main.js), null on the served page.
  let { onopenlog = null, shell: Shell = null } = $props();

  const roleActions = $derived(
    ((machine.catalog.model && machine.catalog.model.actions) || []).filter(
      (a) => typeof a.role === 'string' && (a.role.startsWith('action.safety') || a.role.startsWith('action.home'))
    )
  );

  /**
   * THE E-STOP MUST NOT DEPEND ON AN OPTIONAL ANNOTATION.
   *
   * `action.*` roles are how DEVICE-DEFINED verbs get discovered, and that is
   * the right mechanism for them. But safety-intents is a SPEC-CORE channel:
   * every conforming hub has it, and RFC-025b makes its stop/estop ops
   * role-exempt precisely so anyone connected can halt the machine. Finding it
   * by role alone means a hub that simply never annotated it loses its e-stop
   * button — which is what happened the first time this ran against a
   * simulator whose catalog omitted the role. A missing garnish must never
   * cost the emergency stop.
   *
   * So: locate it by its spec-core channel id (machine.svelte.js
   * specSafetyAction), and treat any role tag as an additional discovery path
   * rather than the only one.
   */
  const specSafety = $derived.by(specSafetyAction);

  // De-duplicate: if the hub DID annotate its safety channel, the role-derived
  // action and the spec-derived one are the same field.
  const actions = $derived(
    specSafety && !roleActions.some((a) => a.uid === specSafety.uid)
      ? [specSafety, ...roleActions]
      : roleActions
  );
  const linkUp = $derived(machine.link.phase === 'live');
  const unattended = $derived(isUnattended(machine.catalog.model && machine.catalog.model.byRole,
    machine.samples, machine.samples[CH_CONTROL_OWNER]));

  const isSafetyRole = (a) => typeof a.role === 'string' && a.role.startsWith('action.safety');
  const isHomeRole = (a) => typeof a.role === 'string' && a.role.startsWith('action.home');

  // ---- latest safety edge ----------------------------------------------------
  // The core safety-events ring only (routed by channel identity in
  // machine.svelte.js). Stale when the link has not been live since the edge:
  // later edges may have been missed, so the line is history, not state.
  // TODO(rfc-x3n): add the device anomaly log once the catalog can say which
  // device EVENT channel it is.
  // ph-vdk.14: a synthesized `diagnostic` record (the client noticing a gap,
  // never device data) and a `superseded` edge (arrived after a newer
  // seq_of_state) are feed-only -- the summary shows the newest real edge.
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
  function kindName(evt) {
    return SAFETY_EVENT_KIND_NAME[evt.kind] || ('kind ' + evt.kind);
  }
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

  /**
   * Group caption from the ROLE that put the action in this strip — registry
   * vocabulary, not device knowledge. An action here by any other role prefix
   * falls back to its own catalog label.
   */
  function groupLabel(a) {
    if (isSafetyRole(a)) return 'safety';
    if (typeof a.role === 'string' && a.role.startsWith('action.home')) return 'home';
    return a.label || a.name || '';
  }

  /**
   * Presentation only: swap the hub's own '_' for a space so multi-word ops
   * ("override_on") wrap and read naturally; CSS text-transform:capitalize
   * does the casing. Not inventing text — this is the catalog's own label
   * string, reformatted for display.
   */
  function displayLabel(label) {
    return String(label).replace(/_/g, ' ');
  }

  /**
   * The remedy for the CURRENT global refusal, if this hub advertises one.
   * Reactive to `lastRefusal` (a new refusal anywhere in the app) and to the
   * catalog (the action has to actually exist on THIS hub) — both reads
   * happen inside remedyForLastRefusal() itself, which is enough for Svelte's
   * fine-grained tracking to pick them up through this $derived.by.
   */
  const remedy = $derived.by(() => remedyForLastRefusal());
  let remedyBusy = $state(false);

  async function fireRemedy() {
    if (!remedy) return;
    remedyBusy = true;
    const result = await runAction(remedy.action, remedy.op);
    remedyBusy = false;
    // Ground truth: only clear the banner once the ECHO confirms the remedy
    // was actually applied — never optimistically on the mere act of tapping.
    if (result.ok) clearLastRefusal();
  }

  /** May THIS session fire this exact op, per the catalog's own access data? */
  function canFire(action, value) {
    // Reading these keeps the check reactive to auth/catalog changes even
    // though the session object itself lives outside Svelte's reactivity.
    void machine.link.roles; void machine.link.phase; void machine.catalog.ready;
    const session = getSession();
    return !!session && session.isLive && session.canUse(action.channelId, action.key, value);
  }

  function reasonFor(action, value) {
    if (!linkUp) return 'no hub link';
    if (!canFire(action, value)) return 'this session is not authorized for this op';
    return '';
  }

  let busy = $state({});
  let lastResult = $state(null); // { ok, label, error, at } — this strip's OWN last press

  async function fire(action, value, label, btnKey) {
    if (needsConfirm(action, value) && !(await askConfirm(confirmCopy(action, value)))) return;
    busy = { ...busy, [btnKey]: true };
    const result = await runAction(action, value);
    busy = { ...busy, [btnKey]: false };
    lastResult = { ok: result.ok, label, error: result.error || null, at: Date.now() };
    // The global refusal banner is driven by shadow.svelte.js's `lastRefusal`
    // — runAction() already updated it on failure, so there is nothing left
    // to do here for that surface.
  }

  /**
   * Order by the access each op REQUIRES, lowest first (option_access, the
   * same data the hub gates on), so exempt ops lead on every hub.
   *
   * WIRE VALUE 0 IS NOT RENDERED. RFC-034 (registry.yaml `field_roles`
   * doctrine) is normative: for a select field carrying an `action.*` role,
   * value 0 is NEVER an operation — every op table numbers its real ops from
   * 1, and 0 exists only to keep the option array index-aligned. This strip
   * used to gray it instead (an index-completeness argument borrowed from
   * listbox semantics), which put a permanently dead button labeled
   * "reserved" in the operator's face — a wire-format alignment artifact
   * rendered as chrome. Operator ruling 2026-07-28: drop it. These are
   * buttons, not an index-addressed listbox; nothing an operator can do
   * refers to option INDEX, so omitting the placeholder loses nothing.
   * Real ops a session merely lacks access to stay GRAYED, never hidden —
   * that doctrine is unchanged.
   *
   * The spec-core safety-intents channel draws nothing here: every op it
   * carries is half of a pair rendered elsewhere (law 14). Home renders in
   * TransportBar. `force_home` is dev-only and stays here, unfiltered, until a
   * dev affordance exists to hide it properly.
   */
  function optionButtons(action) {
    if (action.channelId === CH_SAFETY_INTENTS) return [];
    const floor = action.access | 0;
    const accessOf = (i) => {
      const a = action.optionAccess && action.optionAccess[i];
      return a == null ? floor : a;
    };
    return (action.options || [])
      .map((label, i) => ({ label: label || String(i), value: i, access: accessOf(i) }))
      .filter((o) => o.value !== 0)
      .filter((o) => !(isHomeRole(action) && o.value === HOME_OP.home))
      .sort((a, b) => a.access - b.access);
  }

</script>

<!-- "deep": empty strip space drags the undecorated shell window; buttons
     and other clickables opt out on their own (Tauri drag.js). -->
<div class="topstrip" data-tauri-drag-region="deep" bind:offsetHeight={stripH}>
  {#if Shell}<Shell />{/if}
  <LinkBar />
  <div class="safety" role="group" aria-label="Safety controls">
    {#if unattended}
      <!-- RENDERING §10.1 rule 3: moving with nobody attached is shown in words,
           never inferred. Clears when a session owns a source again. -->
      <div class="unattended" role="status">Unattended: moving with no session in control</div>
    {/if}
    {#if lastRefusal.code != null}
      <!-- THE GLOBAL REFUSAL SURFACE. Any of shadow.svelte.js's three write
           paths — a settings slider, an action button, the rail's move tape —
           lands here the instant the hub refuses it, whether or not the
           control that sent it is still on screen (CLAUDE.md 3, Ground Truth
           Doctrine: a swallowed refusal misrepresents machine state). The
           remedy button only appears when THIS hub's catalog actually
           advertises the action that clears it. -->
      <div class="recovery" role="alert">
        <span>
          refused{lastRefusal.label ? ' (' + lastRefusal.label + ')' : ''}:
          {lastRefusal.codeName}{lastRefusal.detail ? ' — ' + lastRefusal.detail : ''}
        </span>
        {#if remedy}
          <button
            type="button"
            class="btn recover"
            disabled={!canFire(remedy.action, remedy.op)}
            title={reasonFor(remedy.action, remedy.op)}
            onclick={fireRemedy}
          >
            {remedyBusy ? '…' : 'Fix: ' + optionLabel(remedy.action, remedy.op)}
          </button>
        {/if}
      </div>
    {/if}

    {#if latestSafety}
      <!-- Tier-1 anomaly surface: the latest safety edge, its age, and how many
           arrived unread. Opens the Safety feed (LogPane), which is the history. -->
      <button type="button" class="evline" class:stale={safetyStale} onclick={openSafetyLog}
              title={safetyStale ? 'stale: the link has not been live since this edge, later edges may be missing'
                                 : 'open the safety event history'}>
        <span class="evkind">{displayLabel(kindName(latestSafety))}</span>
        <span class="evage">{ageText(now - latestSafety.at)}</span>
        {#if safetyStale}<span class="evtag">stale</span>{/if}
        {#if unreadSafety}<span class="evtag">{unreadSafety} new</span>{/if}
      </button>
    {/if}

    <div class="dock">
      <!-- Bound by spec-core identity alone (law 2), never by a role tag. -->
      <div class="pair">
        <SafetyOp action={specSafety} op={SAFETY_OP.estop} />
        <SafetyOp action={specSafety} op={SAFETY_OP.pause} />
      </div>

      {#if !machine.catalog.ready}
        <p class="empty">No catalog yet.</p>
      {:else if !actions.length}
        <p class="empty">This hub advertises no safety or home actions.</p>
      {:else}
        <div class="groups">
          {#each actions as action (action.uid)}
            {#if action.options && action.options.length}
              {@const opts = optionButtons(action)}
              {#if opts.length}
                <div class="grp">
                  <span class="grp-lbl">{groupLabel(action)}</span>
                  <div class="grp-btns">
                    {#each opts as opt (action.uid + ':' + opt.value)}
                      {@const key = action.uid + ':' + opt.value}
                      <button
                        type="button"
                        class="btn"
                        disabled={!canFire(action, opt.value)}
                        title={reasonFor(action, opt.value) || opt.label}
                        onclick={() => fire(action, opt.value, opt.label, key)}
                      >
                        <span class="lbl">{busy[key] ? '…' : displayLabel(opt.label)}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            {:else}
              <div class="grp">
                <span class="grp-lbl">{groupLabel(action)}</span>
                <div class="grp-btns">
                  <button
                    type="button"
                    class="btn"
                    disabled={!canFire(action, 1)}
                    title={reasonFor(action, 1) || action.label}
                    onclick={() => fire(action, 1, action.label, action.uid)}
                  >
                    <span class="lbl">{busy[action.uid] ? '…' : displayLabel(action.label)}</span>
                  </button>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      {/if}

      {#if lastResult && !lastResult.ok}
        <p class="err" role="status">refused ({lastResult.label}): {lastResult.error}</p>
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
  .safety {
    padding: 6px var(--gap);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .unattended {
    padding: 4px 8px;
    border: 1px solid var(--warn);
    color: var(--warn);
    font-size: .8rem;
  }
  .dock {
    display: flex;
    align-items: stretch;
    gap: 12px;
  }

  /* The fixed pair; each control sizes itself (SafetyOp.svelte, law 12). */
  .pair {
    flex: 0 0 auto;
    display: flex;
    gap: 6px;
  }

  /* ---- op groups: labeled clusters, one scrolling row --------------------
     ONE ROW, always. A wrapping strip grows as the machine advertises more
     ops, and a strip that grows downward covers the page. Scrolling keeps the
     height constant; the e-stop sits outside this scroll area entirely. */
  .groups {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
  }
  .groups::-webkit-scrollbar { display: none; }

  .grp {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .grp-lbl {
    /* OG .pidx-label voice (CSS-diff audit 2026-07-29): quiet mono, no
       uppercase shouting — the label is a waypoint, not a heading. */
    font-family: var(--mono);
    font-size: .62rem;
    letter-spacing: .08em;
    color: var(--tx-faint);
    padding-left: 1px;
  }
  .grp-btns {
    display: flex;
    gap: 6px;
  }

  .btn {
    /* Never shrink: flex would otherwise squeeze the labels and clip them
       mid-word ("estop_cle"). */
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    min-height: 36px;
    min-width: 56px;
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
  @media (pointer: coarse) {
    .btn { min-height: 40px; }
  }
  /* Short screens (landscape phone, laptop window): the group labels are
     waypoints and the buttons carry their own names, so the strip gives the
     labels' row back to the page. */
  @media (max-height: 500px), (min-width: 960px) and (max-height: 860px) {
    .grp-lbl { display: none; }
  }
  .btn:disabled { opacity: 0.4; }
  .btn:not(:disabled):hover { border-color: var(--line-4); }
  .btn:not(:disabled):active { border-color: var(--reality); color: var(--reality); }

  /* Labels are the hub's own catalog strings: capitalize is presentation
     only (see displayLabel()), never a hardcoded string. */
  .btn .lbl { text-transform: capitalize; }

  .recovery {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-s);
    background: color-mix(in srgb, var(--bad) 14%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--bad) 45%, var(--line));
    font-size: 12.5px;
    color: var(--ink);
  }
  .btn.recover {
    background: var(--bad);
    border-color: var(--bad);
    color: var(--bg);
    font-weight: 700;
  }
  .btn.recover:disabled { opacity: 0.5; }

  .empty {
    align-self: center;
    font-size: 12.5px;
    color: var(--ink-faint);
    margin: 0;
  }

  /* ---- latest safety edge ---------------------------------------------------
     One line, never a second row of buttons. Dimmed AND worded when stale
     (law 8; law 5: never color alone). */
  .evline {
    align-self: flex-start;
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    font-size: 12px;
    color: var(--ink);
    text-align: left;
    min-width: 0;
    transition: border-color .12s;
  }
  @media (pointer: coarse) {
    .evline { min-height: 40px; }
  }
  .evline:hover { border-color: var(--line-4); }
  .evline.stale { opacity: .55; }
  .evkind { text-transform: capitalize; white-space: nowrap; }
  .evage { font-family: var(--mono); font-size: 11px; color: var(--tx-mut); white-space: nowrap; }
  .evtag {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-dim);
    border: 1px solid var(--line-2);
    padding: 0 5px;
    white-space: nowrap;
  }

  .err {
    margin: 0;
    align-self: center;
    font-size: 12px;
    color: var(--bad);
  }

  @media (prefers-reduced-motion: reduce) {
    .btn, .evline { transition: none; }
  }
</style>
