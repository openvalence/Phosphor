<script>
  /**
   * ConfirmLayer.svelte — the overlay region (RENDERING §9): confirms and
   * pairing knocks, nothing persistent.
   *
   * Constraints:
   * - Never covers or disables the stop affordance or the persistent region
   *   (§8.4 stop row): no page-wide scrim, no `inert`, no aria-modal. The card
   *   is bounded to the middle of the viewport so the top strip and the top
   *   transport row stay visible and clickable mid-confirm.
   * - Tab is trapped inside the card; Escape cancels from anywhere. Focus
   *   returns to the control that opened it.
   * - Copy is whatever the caller passed from the catalog; this file adds only
   *   the two button words, and never re-cases the title.
   * - The confirm button is neutral: red is the e-stop's and Home required's
   *   alone (DESIGN §10.3), and neither ever asks first (law 14).
   * - No knock prompt while `knocksShown`: the Pairing pane's own rows carry
   *   approve and deny, and a second prompt over them would only cover them.
   */
  import { tick } from 'svelte';
  import { confirmUi, answerConfirm } from './confirm.svelte.js';
  import { machine } from '../model/machine.svelte.js';
  import { CH_PENDING_PAIRING } from '../../../Valence/clients/js/frames.js';

  let { onreview = null, knocksShown = false } = $props();

  // Pending knocks: the spec-core pending-pairing roster (§12.2), readable only
  // by a `configure` session, so a lower tier simply never sees this prompt.
  const knockSample = $derived(machine.samples[CH_PENDING_PAIRING]);
  const knockCount = $derived(knockSample ? (knockSample.count | 0) : 0);
  let dismissedGen = $state(null);
  const knockOpen = $derived(!knocksShown && knockCount > 0 && knockSample.generation !== dismissedGen);

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
        <button type="button" class="og-btn confirm" onclick={() => answerConfirm(true)}>
          {confirmUi.req.confirmLabel || 'Confirm'}
        </button>
      </div>
    {:else}
      <h2 id="overlay-title">Pairing request{knockCount === 1 ? '' : 's'} waiting</h2>
      <p id="overlay-body">
        {knockCount === 1 ? (knockSample.name0 || 'A device') + ' is' : knockCount + ' devices are'}
        asking to pair
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
  /* Below the top strip (z 30) and bounded to the middle band of the
     viewport, so neither the strip nor the top transport row is ever under it. */
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
  }
  /* Sentence case: catalog labels arrive lowercase (docs/COPY.md rule 3). */
  h2::first-letter { text-transform: uppercase; }
  p { margin: 0; color: var(--ink); font-size: .9rem; }
  p:empty { display: none; }
  .acts { display: flex; gap: 8px; justify-content: flex-end; }
  .acts button { min-height: var(--tap); min-width: var(--tap); padding: 0 16px; }
  .acts .confirm { border-color: var(--line-4); color: var(--ink-hi); }
  @media (prefers-reduced-motion: no-preference) {
    .overlay { animation: rise .14s ease-out; }
  }
  @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
</style>
