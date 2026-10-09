<script>
  /**
   * LogPane.svelte -- device log, device-defined events (Anomalies), safety
   * edges, session events.
   *
   * All four rings are decoded EVENT frames (machine.events.*). Per SPEC 8.8,
   * unknown things render generically rather than being dropped: an event's
   * `body` is an open bag of fields, each looked up against the CHANNEL'S OWN
   * catalog schema at render time (an `options` field shows the device's
   * label), anything unrecognized as a plain "key=value". The one exception
   * is the spec-core log channel's `level`/`tag`/`message`, fixed by the
   * Valence library, not by one device's catalog.
   *
   * Constraints:
   * - Each feed is its own scroller, stacked in one grid cell and hidden by
   *   visibility, so a tab switch keeps every feed's scroll position natively.
   * - The toolbar and the status slot are always rendered: filters that do
   *   not apply to a feed are disabled with the reason, never removed.
   * - Scrolling away from the newest line pauses that feed on a snapshot;
   *   Follow resumes it. Rows have no hover styling that changes geometry.
   * - Warn and error read amber, never red: red is the hazard color.
   */
  import { machine } from '../model/machine.svelte.js';
  import {
    CH, SESSION_EVENT_KIND, SAFETY_EVENT_KIND, LOG_EVENT_KIND, LOG_LEVEL_NAME,
  } from '../../../Valence/clients/js/index.js';
  import { optionLabel, formatValue, formatWithUnit } from '../model/format.js';
  import { logView } from './logview.svelte.js';
  import { history, undo, revertAll, revertPlan, fieldOfEntry, say } from '../model/history.svelte.js';
  import { askConfirm } from './confirm.svelte.js';
  import { health } from '../model/health/health.svelte.js';
  import HealthPane from './health/HealthPane.svelte';
  import HealthLine from './health/HealthLine.svelte';
  import './pane.css';

  const TABS = [
    { id: 'log', label: 'Log' },
    { id: 'anomaly', label: 'Anomalies' },
    { id: 'safety', label: 'Safety' },
    { id: 'session', label: 'Session' },
    { id: 'changes', label: 'Changes' },
    { id: 'health', label: 'Health' },
  ];
  // Shared so the top strip can open a feed.
  const tab = $derived(logView.tab);

  // Everything in the Safety feed counts as read while it is on screen.
  $effect(() => {
    if (tab !== 'safety') return;
    void machine.events.safety[machine.events.safety.length - 1];
    logView.safetySeenAt = Date.now();
  });

  const lists = $derived({
    log: machine.events.log,
    anomaly: machine.events.anomaly,
    safety: machine.events.safety,
    session: machine.events.session,
    changes: [...history.entries].reverse(),
    health: health.incidents,
  });

  const EMPTY_TEXT = {
    log: 'No log lines yet',
    anomaly: 'No device events yet',
    safety: 'No safety events this session',
    session: 'No session events yet',
    changes: 'No setting changed this session',
    health: '',
  };

  // ---- generic body decoding -----------------------------------------------

  function invert(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[v] = k;
    return out;
  }
  const KIND_NAMES = {
    [CH.SESSION_EVENTS]: invert(SESSION_EVENT_KIND),
    [CH.SAFETY_EVENTS]: invert(SAFETY_EVENT_KIND),
    [CH.LOG]: invert(LOG_EVENT_KIND),
  };

  /** Decode evt.body generically via the emitting channel's OWN catalog schema. */
  function bodyFields(evt) {
    if (!evt || !evt.body) return [];
    const entry = machine.catalog.entries.find((e) => e.id === evt.channel);
    const byName = new Map(((entry && entry.schema) || []).map((f) => [f.name, f]));
    return Object.keys(evt.body).map((k) => {
      const v = evt.body[k];
      const field = byName.get(k);
      let display;
      if (field && field.options) display = optionLabel(field, v);
      else if (field) display = formatWithUnit(field, v);
      else if (typeof v === 'number') display = formatValue(null, v);
      else display = String(v);
      return { key: k, raw: v, display };
    });
  }

  function levelName(raw) {
    return (typeof raw === 'number' && LOG_LEVEL_NAME[raw]) ? LOG_LEVEL_NAME[raw] : null;
  }

  /** Every top-level field of an event object, generically. */
  function topFields(evt) {
    // `superseded` is a locally-derived reconciliation flag (ph-vdk.14), not
    // a wire field; the safety feed renders it as its own chip.
    const skip = new Set(['at', 'channelName', 'channel', 'body', 'superseded']);
    const kindMap = evt.channel != null ? KIND_NAMES[evt.channel] : null;
    const out = [];
    for (const k of Object.keys(evt)) {
      if (skip.has(k)) continue;
      const v = evt[k];
      let display;
      if (k === 'kind' && typeof v === 'number' && kindMap && kindMap[v]) display = kindMap[v];
      else if (v == null) display = '--';
      else if (typeof v === 'object') display = JSON.stringify(v);
      else display = String(v);
      out.push({ key: k, display });
    }
    out.push(...bodyFields(evt));
    return out;
  }

  function timeOf(evt) {
    try { return new Date(evt.at).toLocaleTimeString(); } catch (e) { return '--'; }
  }
  const chan = (evt, none) => evt.channelName || (evt.channel != null ? 'channel ' + evt.channel : none);

  /** One row's parts; the row snippet and Copy both read this. */
  function parts(t, evt) {
    const p = { time: timeOf(evt), lvl: null, tag: null, text: '', kv: [], diag: false, superseded: false };
    if (t === 'log') {
      const fields = bodyFields(evt);
      const get = (k) => fields.find((f) => f.key === k);
      p.lvl = get('level') ? levelName(get('level').raw) : null;
      p.tag = get('tag') ? get('tag').display : null;
      p.text = get('message') ? get('message').display : chan(evt, 'log');
      p.kv = fields.filter((f) => f.key !== 'level' && f.key !== 'message' && f.key !== 'tag');
    } else if (t === 'anomaly') {
      p.text = chan(evt, 'device');
      p.kv = bodyFields(evt);
    } else if (t === 'safety' && evt.diagnostic) {
      // ph-vdk.14: synthesized locally when the latch changed with no
      // matching edge; it states the gap, never a value the device did not send.
      p.text = 'latch changed, no event received';
      p.diag = true;
    } else {
      p.text = chan(evt, 'session');
      p.kv = topFields(evt);
      p.superseded = !!evt.superseded;
    }
    return p;
  }

  // ---- filters (Log feed only) -----------------------------------------------

  const LEVELS = Object.entries(LOG_LEVEL_NAME).map(([n, name]) => ({ n: Number(n), name }));
  let minLevel = $state(-1);
  let tagFilter = $state('');
  const tagOf = (evt) => (evt.body && evt.body.tag != null ? String(evt.body.tag) : '');
  const tags = $derived([...new Set(machine.events.log.map(tagOf).filter(Boolean))].sort());
  // A line with no level is kept: it is not below any threshold.
  function passes(evt) {
    const lv = evt.body && typeof evt.body.level === 'number' ? evt.body.level : null;
    if (minLevel >= 0 && lv != null && lv < minLevel) return false;
    return !tagFilter || tagOf(evt) === tagFilter;
  }

  // ---- follow / pause, per feed -----------------------------------------------

  const feeds = $state(Object.fromEntries(TABS.map((t) => [t.id, { follow: true, snap: null }])));
  const shown = $derived(Object.fromEntries(TABS.map(({ id }) => {
    const base = feeds[id].snap || lists[id] || [];
    return [id, id === 'log' ? base.filter(passes) : base];
  })));

  function newSince(live, snap) {
    if (!snap.length) return live.length;
    const i = live.lastIndexOf(snap[snap.length - 1]);
    return i < 0 ? live.length : live.length - 1 - i;
  }

  function onScroll(id, el) {
    if (id === 'changes') return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (!atBottom && feeds[id].follow) { feeds[id].follow = false; feeds[id].snap = lists[id].slice(); }
  }
  function toggleFollow() {
    const f = feeds[tab];
    f.follow = !f.follow;
    f.snap = f.follow ? null : lists[tab].slice();
  }
  // Re-runs when the feed's rows or its follow flag change.
  const stick = (id) => (el) => {
    void shown[id].length;
    if (id !== 'changes' && feeds[id].follow) el.scrollTop = el.scrollHeight;
  };

  // ---- copy and the status slot --------------------------------------------------

  let flash = $state('');
  let flashTimer = null;
  async function copyFeed() {
    const rows = shown[tab].map((evt) => {
      const p = parts(tab, evt);
      return [p.time, p.lvl && '[' + p.lvl + ']', p.tag && '[' + p.tag + ']', p.text,
        ...p.kv.map((f) => f.key + '=' + f.display), p.superseded && '(superseded)'].filter(Boolean).join(' ');
    });
    try {
      await navigator.clipboard.writeText(rows.join('\n'));
      flash = 'Copied ' + rows.length + ' line' + (rows.length === 1 ? '' : 's');
    } catch (e) {
      flash = 'Copy failed: ' + ((e && e.message) || 'clipboard refused');
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = ''; }, 2500);
  }

  const val = (e, v) => {
    const f = fieldOfEntry(e.id);
    return !f ? String(v) : f.options ? optionLabel(f, v) : formatWithUnit(f, v);
  };
  // The count is asked before the confirm so a no-op revert says so instead of asking.
  async function revert() {
    logView.tab = 'changes';
    const { send, skipped } = revertPlan(), n = send.length;
    if (!n && !skipped.length) { say('Nothing to revert'); return; }
    if (!n) { revertAll(); return; }
    if (await askConfirm({ title: 'Revert changes', body: 'Writes ' + n + ' setting' + (n === 1 ? '' : 's') + ' back to how they were when you connected.', confirmLabel: 'Revert' })) revertAll();
  }

  const status = $derived.by(() => {
    if (tab === 'changes') return flash || history.msg;
    if (flash || history.msg) return flash || history.msg;
    const f = feeds[tab];
    const live = lists[tab] || [];
    const filtered = tab === 'log' && (minLevel >= 0 || tagFilter)
      ? shown.log.length + ' of ' + (f.snap || live).length + ' shown' : '';
    if (!f.follow) {
      const n = newSince(live, f.snap || []);
      return 'Paused: ' + n + ' new line' + (n === 1 ? '' : 's') + (filtered ? ' · ' + filtered : '');
    }
    // Following is the toggle's own word; the slot only adds what it lacks.
    return filtered;
  });

  function onTabKey(e) {
    const i = TABS.findIndex((t) => t.id === tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length].id;
    logView.tab = next;
    e.currentTarget.querySelector('[data-feed="' + next + '"]')?.focus();
  }
</script>

<div class="pane-stack logpane">
  <div class="og-seg tabs" role="tablist" aria-label="Event feed" tabindex="-1" onkeydown={onTabKey}>
    {#each TABS as t (t.id)}
      <button type="button" role="tab" data-feed={t.id} id={'lp-tab-' + t.id} aria-controls={'lp-feed-' + t.id}
              aria-selected={tab === t.id} tabindex={tab === t.id ? 0 : -1} class:active={tab === t.id}
              onclick={() => (logView.tab = t.id)}>
        {t.label} <span class="count mono">{lists[t.id].length}</span>
      </button>
    {/each}
  </div>

  <div class="tools">
    <label class="tool">
      <span>Level</span>
      <select bind:value={minLevel} disabled={tab !== 'log'} title={tab !== 'log' ? 'Log feed only' : ''}>
        <option value={-1}>all levels</option>
        {#each LEVELS as l (l.n)}<option value={l.n}>{l.name} and above</option>{/each}
      </select>
    </label>
    <label class="tool">
      <span>Tag</span>
      <select bind:value={tagFilter} disabled={tab !== 'log'} title={tab !== 'log' ? 'Log feed only' : ''}>
        <option value="">all tags</option>
        {#each tags as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </label>
    <button type="button" class="og-btn sm" disabled={tab === 'changes' || tab === 'health'} class:on={feeds[tab].follow} aria-pressed={feeds[tab].follow} onclick={toggleFollow}>
      {feeds[tab].follow ? 'Following' : 'Follow'}
    </button>
    <button type="button" class="og-btn sm" disabled={tab === 'changes' || tab === 'health' || !shown[tab].length} onclick={copyFeed}>Copy</button>
    <button type="button" class="og-btn sm" disabled={!history.baselined || history.busy} title="Return settings to how they were when you connected"
            onclick={revert}>Revert changes</button>
  </div>
  <p class="pane-status" role="status" data-phase={flash ? 'settled' : null} title={status}>{status}</p>

  {#if tab === 'health'}<div id="lp-feed-health" role="tabpanel" aria-labelledby="lp-tab-health"><HealthPane /></div>{/if}
  <div class="stack" class:gone={tab === 'health'}>
    {#each TABS.filter((x) => x.id !== 'health') as t (t.id)}
      <div class="feed og-screen" id={'lp-feed-' + t.id} role="tabpanel" aria-labelledby={'lp-tab-' + t.id}
           class:active={tab === t.id} inert={tab !== t.id} tabindex={tab === t.id ? 0 : -1}
           onscroll={(e) => onScroll(t.id, e.currentTarget)} {@attach stick(t.id)}>
        {#if !shown[t.id].length}
          <p class="pane-empty">{(t.id === 'log' && lists.log.length) ? 'No line matches the filters' : EMPTY_TEXT[t.id]}</p>
        {:else}
          {#each shown[t.id] as evt (evt)}
            {#if t.id === 'changes'}
            <div class="line change">
              <time class="mono">{new Date(evt.t).toLocaleTimeString()}</time>
              <span class="text">{evt.label}</span>
              <span class="kv">{val(evt, evt.before)} &rarr; {val(evt, evt.after)}</span>
              <button type="button" class="og-btn sm undo" aria-label={'Undo ' + evt.label} disabled={history.busy} onclick={() => undo(evt.id)}>Undo</button>
            </div>
            {:else}
            {@const p = parts(t.id, evt)}
            <div class="line" class:lvl-warn={p.lvl === 'warn' || p.lvl === 'error' || p.lvl === 'fatal'}
                 class:superseded={p.superseded} class:diag={p.diag}>
              <time class="mono">{p.time}</time>
              {#if p.lvl}<span class="chip lvl-{p.lvl}">{p.lvl}</span>{/if}
              {#if p.tag}<span class="chip tag">{p.tag}</span>{/if}
              <span class="text">{p.text}</span>
              {#each p.kv as f}<span class="kv">{f.key}={f.display}</span>{/each}
              {#if p.superseded}<span class="chip">superseded</span>{/if}
              {#if evt.health}<HealthLine id={evt.health} />{/if}
            </div>
            {/if}
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .logpane { gap: var(--sp-3); }
  /* One width per tab; wrap rather than squeeze, so a tab never clips its
     label or count. */
  .tabs button { flex: 1 1 0; min-width: max-content; }
  .count { color: var(--ink-faint); font-size: .68rem; margin-left: var(--sp-2); }

  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
  .tool { display: inline-flex; align-items: center; gap: var(--sp-2); min-width: 0; font-size: .75rem; color: var(--tx-mut); }
  /* Fixed width: a new tag arriving never resizes the toolbar. */
  .tool select { width: 16ch; min-width: 0; flex: 0 1 auto; }

  /* All feeds share one cell; only the active one is visible. */
  .stack { display: grid; }
  .stack.gone { display: none; }
  .feed {
    grid-area: 1 / 1;
    visibility: hidden;
    height: 52vh;
    min-height: 240px;
    padding: var(--sp-3) var(--sp-3);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
  }
  .feed.active { visibility: visible; }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--sp-2);
    font-size: .78rem;
    line-height: 1.5;
    padding: var(--sp-1) 0;
    border-bottom: 1px solid var(--line-soft);
    flex: 0 0 auto;
  }
  .line time { color: var(--ink-faint); font-size: .68rem; flex: 0 0 auto; }
  .line .text { color: var(--ink); overflow-wrap: anywhere; }
  .line.lvl-warn .text { color: var(--warn-ink, var(--warn)); }
  /* Reconciliation states (ph-vdk.14), neither a hazard: an out-of-order
     edge dims; a synthesized diagnostic reads as muted italic. */
  .line.superseded { opacity: .55; }
  .line.diag .text { color: var(--ink-faint); font-style: italic; }

  .chip {
    font-size: .68rem;
    padding: 1px var(--sp-2);
    border-radius: var(--r-s);
    background: var(--bg-card);
    border: 1px solid var(--line);
    color: var(--ink-dim);
    text-transform: uppercase;
    letter-spacing: .03em;
    flex: 0 0 auto;
  }
  .chip.lvl-warn, .chip.lvl-error, .chip.lvl-fatal { color: var(--warn-ink, var(--warn)); border-color: color-mix(in srgb, var(--warn) 50%, var(--line)); }
  .chip.tag { text-transform: none; }

  .change .undo { margin-left: auto; }
  .kv { font-family: var(--mono); font-size: .68rem; color: var(--ink-faint); flex: 0 0 auto; }
</style>
