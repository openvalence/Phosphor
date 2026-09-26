<script>
  /**
   * ConfirmLayer.svelte — the overlay region (RENDERING §9): confirms and
   * pairing knocks, nothing persistent.
   *
   * Constraints:
   * - Never covers or disables the stop affordance or the persistent region
   *   (§8.4 stop row): no page-wide scrim, no `inert`, no aria-modal. The card
   *   is bounded to the middle of the viewport so the top transport row and the
   *   bottom safety dock stay visible and clickable mid-confirm.
   * - Tab is trapped inside the card; Escape cancels from anywhere. Focus
   *   returns to the control that opened it.
   * - Copy is whatever the caller passed from the catalog; this file adds only
   *   the two button words.
   */
  import { tick } from 'svelte';
  import { confirmUi, answerConfirm } from './confirm.svelte.js';
  import { machine } from '../model/machine.svelte.js';
  import { CH_PENDING_PAIRING } from '../../../Valence/clients/js/frames.js';

  let { onreview = null } = $props();

  // Pending knocks: the spec-core pending-pairing roster (§12.2), readable only
  // by a `configure` session, so a lower tier simply never sees this prompt.
  const knockSample = $derived(machine.samples[CH_PENDING_PAIRING]);
  const knockCount = $derived(knockSample ? (knockSample.count | 0) : 0);
  let dismissedGen = $state(null);
  const knockOpen = $derived(knockCount > 0 && knockSample.generation !== dismissedGen);

  const open = $derived(!!confirmUi.req || knockOpen);

  let card = $state(null);
  let opener = null;

  $effect(() => {
    if (!open) return;
    opener = document.activeElement;
    tick().then(() => card?.querySelector('[data-autofocus]')?.focus());
    return () => { if (opener && opener.isConnected) opener.focus(); };
  });

  function focusables() {
    return card ? [...card.querySelectorAll('button:not(:disabled)')] : [];
  }

  function onkeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function cancel() {
    if (confirmUi.req) answerConfirm(false);
    else dismissedGen = knockSample ? knockSample.generation : null;
  }

  function review() {
    dismissedGen = knockSample ? knockSample.generation : null;
    onreview?.();
  }
</script>

<svelte:window onkeydown={open ? onkeydown : null} />

{#if open}
  <div class="overlay" class:hazard={!!confirmUi.req} bind:this={card} role="alertdialog"
       aria-labelledby="overlay-title" aria-describedby="overlay-body" tabindex="-1">
    {#if confirmUi.req}
      <h2 id="overlay-title">{confirmUi.req.title}</h2>
      <p id="overlay-body">{confirmUi.req.body}</p>
      <div class="acts">
        <button type="button" class="og-btn" data-autofocus onclick={() => answerConfirm(false)}>Cancel</button>
        <button type="button" class="og-btn danger" onclick={() => answerConfirm(true)}>
          {confirmUi.req.confirmLabel || 'Confirm'}
        </button>
      </div>
    {:else}
      <h2 id="overlay-title">Pairing request{knockCount === 1 ? '' : 's'} waiting</h2>
      <p id="overlay-body">
        {knockCount === 1 ? (knockSample.name0 || 'A device') + ' is' : knockCount + ' devices are'}
        asking to pair with this machine.
      </p>
      <div class="acts">
        <button type="button" class="og-btn" onclick={cancel}>Later</button>
        {#if onreview}
          <button type="button" class="og-btn primary" data-autofocus onclick={review}>Review</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Below the fixed safety dock (z 30) and bounded to the middle band of the
     viewport, so neither the dock nor the top transport row is ever under it. */
  .overlay {
    position: fixed;
    z-index: 29;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(calc(100vw - 2 * var(--gap)), 420px);
    max-height: 50dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(0, 0, 0, .6);
  }
  .overlay.hazard { border-color: var(--warn); }
  h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--ink-hi);
    text-transform: capitalize;
  }
  p { margin: 0; color: var(--ink); font-size: .9rem; }
  p:empty { display: none; }
  .acts { display: flex; gap: 8px; justify-content: flex-end; }
  .acts button { min-height: var(--tap); min-width: var(--tap); padding: 0 16px; }
  @media (prefers-reduced-motion: no-preference) {
    .overlay { animation: rise .14s ease-out; }
  }
  @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
</style>
