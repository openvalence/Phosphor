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
   * - `rows` caps the rows in place, in slot order, so nothing moves while
   *   slots read; the rest open in the kit's sheet titled `title` (DESIGN §10.6).
   */
  import { untrack } from 'svelte';
  import { machine, getSession, subscribed } from '../../model/machine.svelte.js';
  import { SLOT, pendingSlots, enumerateStore, storeLocked, rosterCount, slotHint } from './roster.js';
  import { hubKey } from '../../model/prefs.js';
  import { sheet } from '../../plugins/kit.js';

  let { store, roster = null, item = null, rows = null, title = '' } = $props();

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
    const count = roster ? rosterCount(roster, machine.samples[roster.id]) : null;
    // A subscribed roster not yet sampled (a session start, before its GRANT): its
    // arrival re-runs this. Read without a count, every empty slot costs a NACK.
    if (count == null && roster && subscribed(roster.id)) return;
    const c = (ctl = new AbortController());
    enumerateStore(s.fetchBlob, store, {
      role: machine.link.roles, count, signal: c.signal,
      known: slotHint(hubKey(machine.link.hubIdentity, machine.link.host, machine.link.port), store.store.storeId),
      onSlot: (r) => { if (ctl === c) slots[r.slot] = r; },
    });
  }

  $effect(() => {
    void live; void locked; void store;
    void (roster && machine.samples[roster.id]);
    untrack(refresh);
    return () => { if (ctl) ctl.abort(); };
  });

  const shown = $derived(rows != null && slots.length > rows ? slots.slice(0, rows) : slots);
  let all = $state(false);
  let pane = null;
  function showAll(e) {
    pane ??= sheet({ title, onClose: () => (all = false) });
    pane.anchor = e.currentTarget;
    all = true;
  }
  // The whole list lives in the sheet while it is open. Its block's teardown
  // cannot reach a node moved out of its range, so the destroy removes it.
  function intoPane(node) {
    pane.body.append(node);
    pane.open = true;
    return { destroy: () => { node.remove(); all = false; pane.open = false; } };
  }
</script>

{#snippet list(rs)}
  <ul aria-busy={rs.some((r) => r.state === SLOT.pending)}>
    {#each rs as r (r.slot)}
      <li data-state={r.state}>
        <span class="slot">{r.slot}</span>
        <span class="name">{r.state === SLOT.item ? (r.name || 'unnamed') : TEXT[r.state]}</span>
        {#if item}{@render item(r)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="roster">
  {#if reason}
    <p class="hint">{reason}</p>
  {:else}
    {@render list(shown)}
    {#if shown.length < slots.length}
      <button type="button" class="og-btn more" aria-haspopup="dialog" title="Every slot" onclick={showAll}>{slots.length - shown.length} more</button>
    {/if}
    {#if all}<div class="roster all" use:intoPane>{@render list(slots)}</div>{/if}
  {/if}
  {#if !roster && !reason}
    <button type="button" class="og-btn" onclick={refresh}>Re-read</button>
  {/if}
</div>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
  li {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: var(--tap);
    padding: 0 var(--sp-3);
    border-radius: var(--r-s);
    border: 1px solid var(--line);
  }
  .slot { font-family: var(--mono); color: var(--tx-ghost); min-width: 2ch; }
  .name { flex: 1; }
  li[data-state='pending'] .name { color: var(--tx-ghost); font-style: italic; }
  li[data-state='empty'] { border-style: dashed; }
  li[data-state='empty'] .name { color: var(--tx-mut); }
  li[data-state='locked'] .name { color: var(--ink-dim); }
  li[data-state='error'] .name { color: var(--warn-ink); }
  .hint { margin: 0; color: var(--ink-dim); font-size: 0.78rem; }
  .more { margin-top: var(--sp-1); }
</style>
