<script>
  /**
   * SentReports.svelte -- About > Sent reports (ph-9t5l.1; the served page
   * shows it at the foot of Health): id, date sent, size, View, Request
   * removal, Forget.
   *
   * Constraints:
   * - The date is local only, never in a bundle.
   * - An unresolved row is looked up once per view by the title search
   *   (unauthenticated, 10 a minute per address), one at a time; a miss offers
   *   a pasted link instead.
   * - GitHub has no link that prefills a comment: removal copies /remove and
   *   opens the issue; the repo's workflow deletes it when its author posts it.
   */
  import { onMount } from 'svelte';
  import { sent, putSent, dropSent } from '../../model/health/health.svelte.js';
  import { lookupIssue, issueState, parseIssueLink, openUrl } from '../../model/health/report.js';
  import '../pane.css';

  let viewing = $state(null);
  const rowState = $state({}); // id -> 'finding' | 'missing' | 'open' | 'closed' | 'removed' | 'asked'
  const size = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
  const WORD = { finding: 'Finding the issue', missing: 'Issue not found yet', open: 'Open', closed: 'Closed', removed: 'Removed',
    asked: 'Paste /remove as a comment' };

  // Once per view: a write below must not start another round of lookups.
  onMount(() => {
    let live = true;
    (async () => {
      for (const r of $state.snapshot(sent.list).slice(0, 8)) {
        if (!live) return;
        if (!r.issueUrl) {
          rowState[r.id] = 'finding';
          const url = await lookupIssue(r.id);
          if (url) putSent({ id: r.id, issueUrl: url });
          rowState[r.id] = url ? 'open' : 'missing';
        }
        const url = r.issueUrl || sent.list.find((x) => x.id === r.id)?.issueUrl;
        if (url) {
          const s = await issueState(url);
          if (s) rowState[r.id] = s === 'open' && r.removalAsked ? 'asked' : s;
        }
      }
    })();
    return () => { live = false; };
  });

  async function remove(r) {
    await navigator.clipboard?.writeText('/remove').catch(() => {});
    putSent({ id: r.id, removalAsked: true });
    rowState[r.id] = 'asked';
    await openUrl(r.issueUrl);
  }
  function paste(r, text) {
    const url = parseIssueLink(text);
    if (url) { putSent({ id: r.id, issueUrl: url }); rowState[r.id] = 'open'; }
  }
</script>

<section class="pane-sec og-screen" aria-labelledby="sr-head">
  <div class="pane-head"><h2 id="sr-head">Sent reports</h2></div>
  {#if !sent.list.length}
    <p class="pane-empty">No reports sent</p>
  {:else}
    <ul class="pane-list sent">
      {#each sent.list as r (r.id)}
        <li data-id={r.id}>
          <span class="mono">{r.id}</span>
          <span class="when">{new Date(r.sentAt).toLocaleString()}</span>
          <span class="mono dim">{size(r.bytes || 0)}</span>
          <span class="st" data-state={rowState[r.id]}>{WORD[rowState[r.id]] || (r.issueUrl ? 'Sent' : '')}</span>
          <span class="acts">
            <button type="button" class="og-btn sm" aria-expanded={viewing === r.id} onclick={() => (viewing = viewing === r.id ? null : r.id)}>View</button>
            <button type="button" class="og-btn sm" disabled={!r.issueUrl || rowState[r.id] === 'removed'} title={r.issueUrl ? 'Copies /remove, opens the issue' : 'Issue not found yet'}
                    onclick={() => remove(r)}>Request removal</button>
            <button type="button" class="og-btn sm" onclick={() => dropSent(r.id)}>Forget</button>
          </span>
          {#if !r.issueUrl && rowState[r.id] === 'missing'}
            <input class="og-num paste" type="url" placeholder="Paste the issue link" aria-label={'Issue link for ' + r.id}
                   onchange={(e) => paste(r, e.currentTarget.value)} />
          {/if}
          {#if viewing === r.id}<pre class="json">{JSON.stringify(r.bundle, null, 2)}</pre>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .sent .when { font-size: .78rem; }
  .dim { color: var(--tx-mut); font-size: .72rem; }
  .st { font-size: .75rem; color: var(--tx-mut); }
  .st[data-state='asked'] { color: var(--warn-ink, var(--warn)); }
  .st[data-state='removed'] { color: var(--reality); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-left: auto; }
  .paste { flex: 1 1 100%; font-size: .78rem; }
  .json { flex: 1 1 100%; margin: 0; max-height: 40vh; overflow: auto; font-size: .66rem; font-family: var(--mono); color: var(--ink-dim); white-space: pre-wrap; }
</style>
