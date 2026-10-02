<script>
  /**
   * Roster.svelte -- RENDERING §8.4 `list` / §10 `roster`: every slot of one
   * STORE entry, read over the blob verb. Usable by any STORE entry (a preset
   * store, the trust ledger); the caller pairs it with its roster.
   *
   * Constraints:
   * - Slot states come from roster.js only: pending, locked and empty never
   *   collapse into each other (§8.4 row 9).
   * - With a roster, a change of its STATE re-reads (SPEC §8.7 generation).
   *   Without one nothing signals a change, so a manual re-read is offered.
   * - `item` (snippet, optional) draws per-row actions; the list owns none.
   */
  import { untrack } from 'svelte';
  import { machine, getSession } from '../../model/machine.svelte.js';
  import { SLOT, pendingSlots, enumerateStore, storeLocked } from './roster.js';

  let { store, roster = null, item = null } = $props();

  const TEXT = { pending: 'reading', empty: 'empty', locked: 'locked', error: 'read failed' };

  let slots = $state([]);
  let ctl = null;

  const live = $derived(machine.link.phase === 'live');
  const locked = $derived(storeLocked(store, machine.link.roles));
  const reason = $derived(!live ? 'no hub link'
    : locked ? 'session not authorized' : '');

  function refresh() {
    if (ctl) ctl.abort();
    slots = pendingSlots(store);
    const s = getSession();
    if (!s || !live || locked) return;
    const c = (ctl = new AbortController());
    enumerateStore(s.fetchBlob, store, {
      role: machine.link.roles, signal: c.signal,
      onSlot: (r) => { if (ctl === c) slots[r.slot] = r; },
    });
  }

  $effect(() => {
    void live; void locked; void store;
    void (roster && machine.samples[roster.id]);
    untrack(refresh);
    return () => { if (ctl) ctl.abort(); };
  });
</script>

<div class="roster">
  {#if reason}
    <p class="hint">{reason}</p>
  {:else}
    <ul aria-busy={slots.some((r) => r.state === SLOT.pending)}>
      {#each slots as r (r.slot)}
        <li data-state={r.state}>
          <span class="slot">{r.slot}</span>
          <span class="name">{r.state === SLOT.item ? (r.name || 'unnamed') : TEXT[r.state]}</span>
          {#if item}{@render item(r)}{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if !roster && !reason}
    <button type="button" class="og-btn" onclick={refresh}>Re-read</button>
  {/if}
</div>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--tap);
    padding: 0 8px;
    border-radius: var(--r-s);
    border: 1px solid var(--line);
  }
  .slot { font-family: var(--mono); color: var(--tx-ghost); min-width: 2ch; }
  .name { flex: 1; }
  li[data-state='pending'] .name { color: var(--tx-ghost); font-style: italic; }
  li[data-state='empty'] { border-style: dashed; }
  li[data-state='empty'] .name { color: var(--tx-mut); }
  li[data-state='locked'] .name { color: var(--ink-dim); }
  li[data-state='error'] .name { color: var(--warn); }
  .hint { margin: 0; color: var(--ink-dim); font-size: 0.78rem; }
</style>
