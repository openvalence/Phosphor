<script>
  /**
   * LogPane.svelte -- the Log page: device log, device-defined events
   * (Anomalies), safety edges, session events, setting changes and Health.
   *
   * The event feeds are decoded EVENT frames (machine.events.*). Per SPEC 8.8,
   * unknown things render generically rather than being dropped: an event's
   * `body` is an open bag of fields, each looked up against the CHANNEL'S OWN
   * catalog schema at decode time (an `options` field shows the device's
   * label), anything unrecognized as a plain "key=value". The one exception
   * is the spec-core log channel's `level`/`tag`/`message`, fixed by the
   * Valence library, not by one device's catalog.
   *
   * Constraints:
   * - The page fits the window (App.svelte `.pane.fit`): the tabs and tools
   *   never scroll and the open feed is the one scroller, filling what is
   *   left at every size. Nothing inside a feed scrolls on its own.
   * - Each feed is its own scroller, stacked in one grid cell and hidden by
   *   visibility, so a tab switch keeps every feed's scroll position natively.
   * - The toolbar and the status slot are always rendered: a tool that does
   *   not apply to a feed is disabled with the reason, never removed.
   * - Log and Anomalies fold repeats (logfold.js); Safety and Session keep
   *   one row per event, each edge being evidence. Folded feeds render on a
   *   tick bumped at most once a frame, and never while nothing arrives.
   * - Following keeps the newest row in view; scrolling up or Pause freezes
   *   the feed on a snapshot and the pill counts what arrived since.
   * - Time, level, source and count are fixed columns, so a count or a time
   *   changing never reflows a message. Rows have no hover styling that
   *   changes geometry.
   * - A level is an icon and a color, never a color alone. Warn and error
   *   read amber, never red: red is the hazard color.
   * - F3 focuses the search; a second F3 goes on to LookFor.
   */
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { machine } from '../model/machine.svelte.js';
  import {
    CH, SESSION_EVENT_KIND, SAFETY_EVENT_KIND, LOG_EVENT_KIND, LOG_LEVEL_NAME,
  } from '../../../Valence/clients/js/index.js';
  import { BUILTIN_MACHINE_NAME } from '../model/builtin.js';
  import { optionLabel, formatValue, formatWithUnit, unitOf, compact } from '../model/format.js';
  import { logView } from './logview.svelte.js';
  import { folds, ingest, clearFold } from './logfold.js';
  import { history, undo, revertAll, revertPlan, fieldOfEntry, say } from '../model/history.svelte.js';
  import { askConfirm, confirmUi } from './confirm.svelte.js';
  import { health } from '../model/health/health.svelte.js';
  import HealthPane from './health/HealthPane.svelte';
  import './pane.css';

  const TABS = [
    { id: 'log', label: 'Log' },
    { id: 'anomaly', label: 'Anomalies' },
    { id: 'safety', label: 'Safety' },
    { id: 'session', label: 'Session' },
    { id: 'changes', label: 'Changes' },
    { id: 'health', label: 'Health' },
  ];
  const EVENT_FEEDS = ['log', 'anomaly', 'safety', 'session'];
  // Shared so the top strip can open a feed.
  const tab = $derived(logView.tab);
  const isEvents = $derived(EVENT_FEEDS.includes(tab));

  // Everything in the Safety feed counts as read while it is on screen.
  $effect(() => {
    if (tab !== 'safety') return;
    void machine.events.safety[machine.events.safety.length - 1];
    logView.safetySeenAt = Date.now();
  });

  const lists = $derived({
    safety: machine.events.safety,
    session: machine.events.session,
    changes: [...history.entries].reverse(),
  });

  const EMPTY_TEXT = {
    log: 'No log lines yet',
    anomaly: 'No device events yet',
    safety: 'No safety events this session',
    session: 'No session events yet',
    changes: 'No setting changed this session',
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
      // A unitless integer is a word, a cause or an id: printed as sent, never grouped.
      if (field && field.options) display = optionLabel(field, v);
      else if (Number.isInteger(v) && !unitOf(field)) display = String(v);
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

  const chan = (evt, none) => evt.channelName || (evt.channel != null ? 'channel ' + evt.channel : none);

  // Registry log_levels: four toggles; trace files under debug, fatal under
  // error, a line with no level under info (it is below no threshold).
  const BUCKETS = [
    { id: 'error', label: 'Errors' },
    { id: 'warn', label: 'Warnings' },
    { id: 'info', label: 'Info' },
    { id: 'debug', label: 'Debug' },
  ];
  const bucketOf = (lvl) => (lvl === 'error' || lvl === 'fatal' ? 'error' : lvl === 'warn' ? 'warn'
    : lvl === 'debug' || lvl === 'trace' ? 'debug' : 'info');
  const SOURCES = ['hub', 'client', 'plugin', 'health'];
  // The built-in machine is a hub; a plugin's lines carry `plugin:<name>`; the rest is this client.
  function sourceOf(evt, tag) {
    if (evt.health || tag === 'health') return 'health';
    if (evt.channel != null || evt.channelName === BUILTIN_MACHINE_NAME) return 'hub';
    return tag && tag.startsWith('plugin:') ? 'plugin' : 'client';
  }

  /** One event's parts; a row, its detail, Copy and the fold key all read this. */
  function parts(t, evt) {
    const p = { src: 'hub', bucket: 'info', lvl: null, tag: null, id: null, text: '', kv: [], diag: false, superseded: false, health: evt.health || null };
    if (t === 'log') {
      const fields = bodyFields(evt);
      const get = (k) => fields.find((f) => f.key === k);
      p.lvl = get('level') ? levelName(get('level').raw) : null;
      p.tag = get('tag') ? get('tag').display : null;
      p.text = get('message') ? get('message').display : chan(evt, 'log');
      p.kv = fields.filter((f) => f.key !== 'level' && f.key !== 'message' && f.key !== 'tag');
      p.src = sourceOf(evt, p.tag);
      p.bucket = bucketOf(p.lvl);
    } else if (t === 'anomaly') {
      // Two channels never fold together, whatever their names read.
      p.id = evt.channel;
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
    p.kvText = p.kv.map((f) => f.key + '=' + f.display).join(' ');
    p.hay = [p.src, p.tag, p.text, p.kvText].filter(Boolean).join(' ').toLowerCase();
    return p;
  }

  // ---- rows ------------------------------------------------------------------

  // Folded feeds render on this tick: at most one per frame, none while idle.
  let tick = $state(0);
  let raf = 0;
  const bump = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; tick++; }); };
  $effect(() => () => cancelAnimationFrame(raf));
  for (const id of ['log', 'anomaly']) {
    $effect(() => {
      const ring = machine.events[id];
      void ring.length;
      void ring[ring.length - 1];
      untrack(() => {
        // A new ring is a new session (machine.svelte.js forgetDevice): nothing from the old one
        // stays, a paused Safety or Session snapshot included.
        if (folds[id].ring && folds[id].ring !== ring) { EVENT_FEEDS.forEach(resume); open.clear(); }
        if (ingest(folds[id], ring, (e) => parts(id, e))) bump();
      });
    });
  }

  // Safety and Session: one row per event, made once per event.
  const rowCache = new WeakMap();
  function rowOf(t, evt) {
    let r = rowCache.get(evt);
    if (!r) rowCache.set(evt, (r = { key: evt, n: 1, first: evt.at, last: evt.at, evt, p: parts(t, evt), items: [evt] }));
    return r;
  }
  function live(id) {
    if (folds[id]) { void tick; return folds[id].rows; }
    return (lists[id] || []).map((e) => rowOf(id, e));
  }
  // A health line's text follows its incident (health.svelte.js rewrites the ring record).
  const textOf = (r) => (r.p.health ? (r.evt.body?.message ?? r.p.text) : r.p.text);

  // ---- filters ---------------------------------------------------------------

  const lv = $state({ error: true, warn: true, info: true, debug: true });
  let src = $state('');
  let q = $state('');
  const words = $derived(q.toLowerCase().split(/\s+/).filter(Boolean));
  function passes(id, r) {
    if (id === 'log' && (!lv[r.p.bucket] || (src && r.p.src !== src))) return false;
    return words.every((w) => r.p.hay.includes(w));
  }
  const counts = $derived.by(() => { void tick; return { ...folds.log.counts }; });

  // ---- follow / pause, per feed ---------------------------------------------

  const ff = $state(Object.fromEntries(EVENT_FEEDS.map((id) => [id, { follow: true, held: false, at: 0 }])));
  let snaps = $state.raw({});
  const shown = $derived(Object.fromEntries(EVENT_FEEDS.map((id) => [id, (snaps[id] || live(id)).filter((r) => passes(id, r))])));

  function pause(id, held) {
    Object.assign(ff[id], { follow: false, held, at: folds[id] ? folds[id].total : 0 });
    snaps = { ...snaps, [id]: live(id).slice() };
  }
  function resume(id) {
    Object.assign(ff[id], { follow: true, held: false });
    snaps = { ...snaps, [id]: null };
  }
  function newSince(rows, snap) {
    if (!snap.length) return rows.length;
    const i = rows.lastIndexOf(snap[snap.length - 1]);
    return i < 0 ? rows.length : rows.length - 1 - i;
  }
  const fresh = $derived.by(() => {
    if (!isEvents || ff[tab].follow) return 0;
    if (folds[tab]) { void tick; return folds[tab].total - ff[tab].at; }
    return newSince(live(tab), snaps[tab] || []);
  });

  const lastTop = {};
  function onScroll(id, el) {
    if (id === 'changes') return;
    const top = el.scrollTop, bottom = el.scrollHeight - top - el.clientHeight < 32;
    const f = ff[id];
    if (f.follow && !bottom && top < (lastTop[id] ?? 0) - 1) pause(id, false);
    else if (!f.follow && !f.held && bottom) resume(id);
    lastTop[id] = el.scrollTop;
  }
  // Re-runs when the feed's rows or its follow flag change.
  const stick = (id) => (el) => {
    if (id === 'changes') return;
    void shown[id];
    if (ff[id].follow) { el.scrollTop = el.scrollHeight; lastTop[id] = el.scrollTop; }
  };

  function clearFeed() {
    if (!folds[tab]) return;
    clearFold(folds[tab]);
    open.clear();
    resume(tab);
    tick++;
  }

  // ---- rows: expand, keys, time ---------------------------------------------

  const open = new SvelteSet();
  // An opened row brings its detail into view.
  function toggle(key, el) {
    if (open.has(key)) { open.delete(key); return; }
    open.add(key);
    requestAnimationFrame(() => el.isConnected && el.scrollIntoView({ block: 'nearest' }));
  }

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const hms = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const stamp = (ms) => hms(ms) + '.' + pad(new Date(ms).getMilliseconds(), 3);
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? s + ' s ago' : s < 3600 ? Math.floor(s / 60) + ' min ago' : Math.floor(s / 3600) + ' h ago';
  }
  // Relative time is worked out on hover only: nothing ticks while the page sits.
  function onOver(e) {
    const t = e.target.closest && e.target.closest('time[data-at]');
    if (t) t.title = ago(+t.dataset.at);
  }

  // A repeat moves its row to the tail and a DOM move drops focus to the body: the row's
  // head takes it back after the render, unless focus went elsewhere (a focus or a click).
  let focusRow = null;
  $effect(() => {
    const onFocus = (e) => { focusRow = e.target.closest?.('.logpane .feed .head') || null; };
    const onDown = (e) => { if (!e.target.closest?.('.logpane .feed .head')) focusRow = null; };
    window.addEventListener('focusin', onFocus);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('focusin', onFocus); window.removeEventListener('pointerdown', onDown, true); };
  });
  $effect(() => {
    void shown;
    untrack(() => { if (focusRow?.isConnected && document.activeElement === document.body) focusRow.focus({ preventScroll: true }); });
  });

  function onFeedKey(e) {
    const k = e.key;
    if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Home' && k !== 'End') return;
    const heads = [...e.currentTarget.querySelectorAll(':scope > .line > .head')];
    if (!heads.length) return;
    e.preventDefault();
    // From a row's detail (Copy row, Incident) the walk goes on from that row.
    const i = heads.findIndex((h) => h.parentElement.contains(document.activeElement)), last = heads.length - 1;
    const n = k === 'Home' ? 0 : k === 'End' ? last
      : i < 0 ? (k === 'ArrowDown' ? 0 : last) : Math.max(0, Math.min(last, i + (k === 'ArrowDown' ? 1 : -1)));
    heads[n].focus();
  }

  let searchEl = $state();
  $effect(() => {
    const onKey = (e) => {
      if (e.key !== 'F3' || !searchEl || searchEl.disabled || confirmUi.req) return;
      const a = document.activeElement;
      if (a === searchEl || (a && a.closest('[role=dialog]'))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      searchEl.focus();
      searchEl.select();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  function onSearchKey(e) {
    if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); q = ''; }
    else if (e.key === 'ArrowDown') {
      const h = document.querySelector('#lp-feed-' + tab + ' > .line > .head');
      if (h) { e.preventDefault(); h.focus(); }
    }
  }

  function openIncident(id) {
    health.focus = id;
    health.review = null;
    logView.tab = 'health';
  }
  const incOf = (id) => (id ? health.incidents.find((i) => i.id === id) : null);
  const hasIncident = (id) => !!incOf(id);
  // A health line's tooltip is its detail (docs/COPY.md rule 11).
  const tipOf = (id) => incOf(id)?.tip?.join('\n') || null;

  // ---- copy and the status slot --------------------------------------------------

  function lineOf(r) {
    const p = r.p;
    return [stamp(r.last), p.lvl && '[' + p.lvl + ']', p.src !== 'hub' && p.src !== p.tag && '[' + p.src + ']', p.tag && '[' + p.tag + ']',
      textOf(r), p.kvText, p.superseded && '(superseded)', r.n > 1 && '×' + r.n + ' since ' + stamp(r.first)].filter(Boolean).join(' ');
  }

  let flash = $state('');
  let flashWhy = $state('');
  let flashTimer = null;
  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      flash = 'Copied ' + what;
      flashWhy = '';
    } catch (e) {
      flash = 'Copy failed';
      flashWhy = (e && e.message) || 'clipboard refused';
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = ''; flashWhy = ''; }, 2500);
  }
  const copyFeed = () => copy(shown[tab].map(lineOf).join('\n'), shown[tab].length + ' row' + (shown[tab].length === 1 ? '' : 's'));

  const val = (e, v) => {
    const f = fieldOfEntry(e.id);
    return !f ? String(v) : f.options ? optionLabel(f, v) : formatWithUnit(f, v);
  };
  // The count is asked before the confirm so a no-op revert says so instead of asking.
  async function revert() {
    const { send, skipped } = revertPlan(), n = send.length;
    if (!n && !skipped.length) { say('Nothing to revert'); return; }
    if (!n) { revertAll(); return; }
    if (await askConfirm({ title: 'Revert changes', body: 'Writes ' + n + ' setting' + (n === 1 ? '' : 's') + ' back to how they were when you connected.', confirmLabel: 'Revert' })) revertAll();
  }

  const status = $derived.by(() => {
    if (flash) return flash;
    if (tab === 'changes' || history.msg) return history.msg;
    if (!isEvents) return '';
    const n = shown[tab].length, of = (snaps[tab] || live(tab)).length;
    return n < of ? n + ' of ' + of + ' shown' : '';
  });
  const tabCount = (id) => (folds[id] ? (void tick, folds[id].total) : id === 'health' ? health.incidents.length : lists[id].length);

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
  <svg class="defs" aria-hidden="true">
    <symbol id="lp-error" viewBox="0 0 16 16"><path d="M5.5 1.5h5l4 4v5l-4 4h-5l-4-4v-5zM6 6l4 4M10 6l-4 4" /></symbol>
    <symbol id="lp-warn" viewBox="0 0 16 16"><path d="M8 1.8l6.6 12.4H1.4zM8 6.5v3.6M8 11.9v.6" /></symbol>
    <symbol id="lp-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" /><path d="M8 7.2v4.4M8 4.5v.7" /></symbol>
    <symbol id="lp-debug" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" /><path d="M5.5 6h5M5.5 8h5M5.5 10h3" /></symbol>
  </svg>

  <div class="og-seg tabs" role="tablist" aria-label="Event feed" tabindex="-1" onkeydown={onTabKey}>
    {#each TABS as t (t.id)}
      <button type="button" role="tab" data-feed={t.id} id={'lp-tab-' + t.id} aria-controls={'lp-feed-' + t.id}
              aria-selected={tab === t.id} tabindex={tab === t.id ? 0 : -1} class:active={tab === t.id}
              onclick={() => (logView.tab = t.id)}>
        {t.label} <span class="count mono">{compact(tabCount(t.id))}</span>
      </button>
    {/each}
  </div>

  <div class="tools">
    <input bind:this={searchEl} bind:value={q} class="q" type="search" placeholder="Search (F3)" aria-label="Search the feed"
           disabled={!isEvents} onkeydown={onSearchKey} />
    <div class="lvls" role="group" aria-label="Levels">
      {#each BUCKETS as b (b.id)}
        <button type="button" class="og-btn sm lvt" data-b={b.id} aria-pressed={lv[b.id]} aria-label={b.label}
                title={tab !== 'log' ? b.label + ', Log only' : b.label} disabled={tab !== 'log'}
                onclick={() => (lv[b.id] = !lv[b.id])}><svg aria-hidden="true"><use href={'#lp-' + b.id} /></svg><b class="mono">{compact(counts[b.id] || 0)}</b></button>
      {/each}
    </div>
    <select class="srcsel" aria-label="Source" bind:value={src} disabled={tab !== 'log'} title={tab !== 'log' ? 'Log only' : ''}>
      <option value="">all sources</option>
      {#each SOURCES as s (s)}<option value={s}>{s}</option>{/each}
    </select>
    <button type="button" class="og-btn sm" class:on={isEvents && !ff[tab].follow} aria-pressed={isEvents && !ff[tab].follow}
            disabled={!isEvents} onclick={() => (ff[tab].follow ? pause(tab, true) : resume(tab))}>Pause</button>
    <button type="button" class="og-btn sm" disabled={!folds[tab] || !tabCount(tab)} title={folds[tab] ? '' : 'Log and Anomalies only'}
            onclick={clearFeed}>Clear</button>
    <button type="button" class="og-btn sm" disabled={!isEvents || !shown[tab].length} onclick={copyFeed}>Copy</button>
    <p class="pane-status" role="status" data-phase={flash ? (flashWhy ? 'fault' : 'settled') : null} title={flashWhy || status}>{status}</p>
  </div>

  {#if tab === 'health'}
    <div class="hpanel" id="lp-feed-health" role="tabpanel" aria-labelledby="lp-tab-health" tabindex="0"><HealthPane /></div>
  {/if}
  <div class="stack" class:gone={tab === 'health'}>
    {#each TABS.filter((x) => x.id !== 'health') as t (t.id)}
      <div class="feed og-screen" class:nosrc={t.id !== 'log'} id={'lp-feed-' + t.id} role="tabpanel" aria-labelledby={'lp-tab-' + t.id}
           class:active={tab === t.id} inert={tab !== t.id} tabindex={tab === t.id ? 0 : -1}
           onscroll={(e) => onScroll(t.id, e.currentTarget)} onkeydown={onFeedKey} onpointerover={onOver} {@attach stick(t.id)}>
        {#if t.id === 'changes'}
          <div class="chead">
            <button type="button" class="og-btn sm" disabled={!history.baselined || history.busy} title="Return settings to how they were when you connected"
                    onclick={revert}>Revert changes</button>
          </div>
          {#each lists.changes as evt (evt)}
            <div class="line change">
              <time class="mono" data-at={evt.t}>{hms(evt.t)}</time>
              <span class="text">{evt.label}</span>
              <span class="kv">{val(evt, evt.before)} &rarr; {val(evt, evt.after)}</span>
              <button type="button" class="og-btn sm undo" aria-label={'Undo ' + evt.label} disabled={history.busy} onclick={() => undo(evt.id)}>Undo</button>
            </div>
          {:else}
            <p class="pane-empty">{EMPTY_TEXT.changes}</p>
          {/each}
        {:else}
          {#each shown[t.id] as r (r.key)}
            {@const x = open.has(r.key)}
            <div class="line" data-b={r.p.lvl ? r.p.bucket : null} class:superseded={r.p.superseded} class:diag={r.p.diag} class:open={x}>
              <button type="button" class="head" tabindex="-1" aria-expanded={x} title={tipOf(r.p.health)} onclick={(e) => toggle(r.key, e.currentTarget.parentElement)}>
                <time class="mono" data-at={r.last}>{hms(r.last)}</time>
                <span class="lvl">{#if r.p.lvl}<svg aria-hidden="true"><use href={'#lp-' + r.p.bucket} /></svg><span class="sr">{r.p.lvl}</span>{/if}</span>
                <span class="src mono">{r.p.src}</span>
                <span class="msg">{#if r.p.tag}<span class="chip tag">{r.p.tag}</span>{/if}<span class="text">{textOf(r)}</span>{#if r.p.kvText}<span class="kv">{r.p.kvText}</span>{/if}{#if r.p.superseded}<span class="chip">superseded</span>{/if}</span>
                <span class="n mono" title={r.n > 1 ? 'first ' + hms(r.first) : null}>{r.n > 1 ? '×' + compact(r.n) : ''}</span>
              </button>
              {#if x}
                <div class="detail">
                  <dl class="pane-facts">
                    {#if r.p.lvl}<dt>Level</dt><dd>{r.p.lvl}</dd>{/if}
                    {#if t.id === 'log'}<dt>Source</dt><dd>{r.p.src}{r.p.tag ? ' · ' + r.p.tag : ''}</dd>{/if}
                    <dt>{r.n > 1 ? 'First' : 'Time'}</dt><dd class="mono">{stamp(r.first)} · {ago(r.first)}</dd>
                    {#if r.n > 1}<dt>Last</dt><dd class="mono">{stamp(r.last)} · {ago(r.last)} · ×{r.n}</dd>{/if}
                    {#each r.p.kv as f}<dt>{f.key}</dt><dd class="mono">{f.display}</dd>{/each}
                  </dl>
                  {#if r.n > 1}
                    <ol class="inst" aria-label="Instances">
                      {#each [...r.items].reverse() as e, k (k)}
                        {@const ip = parts(t.id, e)}
                        <li><time class="mono">{stamp(e.at)}</time><span>{ip.health ? e.body?.message ?? ip.text : ip.text}{ip.kvText && ip.kvText !== r.p.kvText ? ' ' + ip.kvText : ''}</span>
                          {#if hasIncident(ip.health)}<button type="button" class="og-btn sm" onclick={() => openIncident(ip.health)}>Incident</button>{/if}</li>
                      {/each}
                      {#if r.n > r.items.length}<li class="older">{r.n - r.items.length} older not kept</li>{/if}
                    </ol>
                  {/if}
                  <div class="acts">
                    <button type="button" class="og-btn sm" onclick={() => copy(lineOf(r), 'row')}>Copy row</button>
                    {#if r.n === 1 && hasIncident(r.p.health)}<button type="button" class="og-btn sm" onclick={() => openIncident(r.p.health)}>Incident</button>{/if}
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <p class="pane-empty">{live(t.id).length ? 'No row matches the filters' : EMPTY_TEXT[t.id]}</p>
          {/each}
        {/if}
      </div>
    {/each}
    {#if fresh > 0}
      <button type="button" class="og-btn sm pill" onclick={() => resume(tab)}>{compact(fresh)} new &darr;</button>
    {/if}
  </div>
</div>

<style>
  .logpane { gap: var(--sp-3); }
  .defs { position: absolute; width: 0; height: 0; overflow: hidden; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

  /* One width per tab; wrap rather than squeeze, so a tab never clips its
     label or count. */
  .tabs { flex: none; }
  .tabs button { flex: 1 1 0; min-width: max-content; }
  .count { color: var(--ink-faint); font-size: .68rem; margin-left: var(--sp-2); }

  .tools { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-3); }
  .q {
    flex: 1 1 6rem;
    min-width: 0;
    min-height: 30px;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--tx);
    font: inherit;
    font-size: .78rem;
  }
  .q:focus { outline: none; border-color: var(--highlight); }
  .q:disabled { opacity: .45; }
  .lvls { display: flex; flex-wrap: wrap; gap: var(--sp-2); min-width: 0; }
  /* Fixed width: a count growing never moves the tools after it. */
  .lvt { width: 7.5ch; padding-inline: var(--sp-2); justify-content: flex-start; gap: var(--sp-2); }
  .lvt b { font-weight: 400; font-size: .68rem; }
  .lvt[aria-pressed='false'] { color: var(--ink-faint); border-style: dashed; }
  .lvt[aria-pressed='true'][data-b='error'] svg, .lvt[aria-pressed='true'][data-b='warn'] svg { color: var(--warn-ink, var(--warn)); }
  .srcsel { width: 15ch; min-height: 30px; padding-block: var(--sp-2); font-size: .75rem; }
  /* Last on the tools row; it takes a line of its own only under 4 rem. */
  .tools .pane-status { flex: 1 1 0; min-width: 4rem; }

  /* All feeds share one cell; only the active one is visible. */
  /* The list's floor: under it the window scrolls instead (App.svelte .pane.fit). */
  .stack { position: relative; flex: 1 1 0; min-height: 6rem; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
  .stack.gone { display: none; }
  .feed {
    grid-area: 1 / 1;
    visibility: hidden;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-2) var(--sp-3);
  }
  .feed.active { visibility: visible; }
  .hpanel { flex: 1 1 0; min-height: 6rem; overflow-y: auto; overscroll-behavior: contain; }
  /* The panel is the one scroller: a sent report's JSON grows in it. */
  .hpanel :global(.json) { max-height: none; overflow: visible; overflow-wrap: anywhere; }

  .line {
    border-bottom: 1px solid var(--line-soft);
    font-size: .78rem;
    line-height: 1.45;
    /* Off-screen rows skip layout and paint: thousands of rows stay smooth. */
    content-visibility: auto;
    contain-intrinsic-size: auto 1.9rem;
  }
  .head {
    display: grid;
    grid-template-columns: 8ch 14px 6.5ch minmax(0, 1fr) 6ch;
    align-items: baseline;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-2) var(--sp-1);
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .nosrc .head { grid-template-columns: 8ch 14px minmax(0, 1fr) 6ch; }
  .nosrc .src { display: none; }
  .head:hover { background: var(--line-soft); }
  .head:focus-visible { outline: 1px solid var(--highlight); outline-offset: -1px; }
  .head time { color: var(--ink-faint); font-size: .68rem; }
  .lvl { align-self: start; display: flex; padding-top: .15em; color: var(--ink-dim); }
  .src { color: var(--ink-faint); font-size: .66rem; overflow: hidden; text-overflow: ellipsis; }
  .msg { min-width: 0; overflow-wrap: anywhere; }
  .msg > :not(:last-child) { margin-right: var(--sp-2); }
  .text { color: var(--ink); }
  .n { color: var(--ink-dim); font-size: .68rem; text-align: right; }
  .line[data-b='error'] .lvl, .line[data-b='warn'] .lvl, .line[data-b='error'] .text, .line[data-b='warn'] .text { color: var(--warn-ink, var(--warn)); }
  .line[data-b='error'] .text { font-weight: 600; }
  .line[data-b='debug'] .lvl, .line[data-b='debug'] .text { color: var(--ink-faint); }
  /* Reconciliation states (ph-vdk.14), neither a hazard: an out-of-order
     edge dims; a synthesized diagnostic reads as muted italic. */
  .line.superseded { opacity: .55; }
  .line.diag .text { color: var(--ink-faint); font-style: italic; }

  .chip {
    font-size: .66rem;
    padding: 0 var(--sp-2);
    border-radius: var(--r-s);
    background: var(--bg-card);
    border: 1px solid var(--line);
    color: var(--ink-dim);
    text-transform: uppercase;
    letter-spacing: .03em;
  }
  .chip.tag { text-transform: none; }
  .kv { font-family: var(--mono); font-size: .68rem; color: var(--ink-faint); overflow-wrap: anywhere; }

  .detail { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3) var(--sp-4); border-left: 2px solid var(--line); margin-left: var(--sp-2); }
  .detail .pane-facts { font-size: .72rem; gap: var(--sp-1) var(--sp-4); }
  .inst { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-1); font-size: .72rem; color: var(--ink-dim); }
  .inst li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-1) var(--sp-3); }
  .inst span { overflow-wrap: anywhere; min-width: 0; }
  .inst time { color: var(--ink-faint); font-size: .66rem; }
  .inst .older { color: var(--ink-faint); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--sp-2); }

  .change { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2) var(--sp-3); padding: var(--sp-2) var(--sp-1); content-visibility: visible; }
  .change time { color: var(--ink-faint); font-size: .68rem; }
  .change .undo { margin-left: auto; }
  .chead { display: flex; justify-content: flex-end; padding-bottom: var(--sp-2); }

  .pill { position: absolute; bottom: var(--sp-4); left: 50%; transform: translateX(-50%); z-index: 1; background: var(--bg-raised); color: var(--reality); border-color: var(--reality); }

  /* 44 px fingertip targets on the page's own controls and rows. */
  @media (pointer: coarse) {
    .tabs button, .q, .srcsel, .lvt, .tools .og-btn, .head, .detail .og-btn, .chead .og-btn, .change .og-btn, .pill { min-height: 44px; }
    .head { align-content: center; }
  }
</style>
