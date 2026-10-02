<script>
  /**
   * TransportBar.svelte -- Home, in the instrument zone where the OG's
   * `.spine-transport` sat (operator ruling 2026-07-28).
   *
   * Constraints:
   * - Home only. The e-stop and pause pairs are the top strip's (law 14: one
   *   control per pair, SafetyOp.svelte); override/return and Flip are the
   *   rail's own row (RailWidget). Nothing about stop reachability depends on
   *   this bar being mounted (RENDERING §13 law 1).
   * - HOME_OP numbers a DEVICE channel's ops, found by the `action.home` role.
   */
  import { machine, getSession } from '../model/machine.svelte.js';
  import { runAction } from '../model/shadow.svelte.js';
  import { HOME_OP } from '../../../Valence/clients/js/index.js';

  const homeCtl = $derived.by(() => {
    for (const a of (machine.catalog.model && machine.catalog.model.actions) || []) {
      if (typeof a.role !== 'string' || !a.role.startsWith('action.home') || !a.options) continue;
      if (HOME_OP.home < a.options.length) {
        return { action: a, value: HOME_OP.home, label: a.options[HOME_OP.home] || 'home', key: a.uid + ':' + HOME_OP.home };
      }
    }
    return null;
  });
  // OG ui.js ICONS `home` (Lucide, MIT).
  const HOME_ICON = '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>';

  /** May THIS session fire this exact op, per the catalog's own access data? */
  function canFire(action, value) {
    void machine.link.roles; void machine.link.phase; void machine.catalog.ready;
    const session = getSession();
    return !!session && session.isLive && session.canUse(action.channelId, action.key, value);
  }

  function reasonFor(action, value) {
    if (machine.link.phase !== 'live') return 'no hub link';
    if (!canFire(action, value)) return 'this session is not authorized for this op';
    return '';
  }

  let busy = $state(false);

  async function fire() {
    busy = true;
    await runAction(homeCtl.action, homeCtl.value);
    busy = false;
    // Refusals surface globally via shadow.svelte.js's `lastRefusal`.
  }
</script>

<div class="transportbar" role="group" aria-label="Transport controls">
  {#if homeCtl}
    <button
      type="button"
      class="tbtn"
      disabled={!canFire(homeCtl.action, homeCtl.value)}
      title={reasonFor(homeCtl.action, homeCtl.value) || homeCtl.label}
      onclick={fire}
    >
      <span class="row">
        <span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">{@html HOME_ICON}</svg></span>
        <span class="lbl">{busy ? '…' : homeCtl.label}</span>
      </span>
      <small>seek home</small>
    </button>
  {/if}
</div>

<style>
  .transportbar {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  /* ---- OG transport button (tag webui-prerefactor's .spine-transport) ----
     Two-line layout verified pixel-for-pixel against
     test/evidence/og-ref/og-full.png and the OG's src/style.css
     `.transport .tbtn` / `.transport .tbtn small` rules: column flex, the
     icon+label on one row, a tiny muted subtitle line below. */
  .tbtn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    min-height: 36px;
    min-width: 48px;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    color: var(--ink);
    font-family: var(--font);
    font-size: .72rem;
    font-weight: 500;
    white-space: nowrap;
    transition: border-color .12s, color .12s;
  }
  .tbtn:disabled { opacity: .45; }
  .tbtn:not(:disabled):hover { border-color: var(--line-4); }
  .tbtn:not(:disabled):active { border-color: var(--reality); color: var(--reality); }

  .tbtn .row { display: flex; align-items: center; gap: 4px; }
  /* Labels are catalog wire values (lowercase) — capitalize is presentation
     only, never a hardcoded string. Subtitles stay as authored (lowercase,
     per the reference image) so this rule targets .lbl, not the button. */
  .tbtn .lbl { text-transform: capitalize; }
  .tbtn .ico { width: 14px; height: 14px; display: inline-grid; }
  .tbtn .ico :global(svg) { width: 14px; height: 14px; }
  .tbtn small {
    font-size: max(11px, .56rem);
    color: var(--tx-mut);
    font-weight: 400;
  }

  @media (prefers-reduced-motion: reduce) {
    .tbtn { transition: none; }
  }
</style>
