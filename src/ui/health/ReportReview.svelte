<script>
  /**
   * ReportReview.svelte -- the report review (ph-9t5l.1): the exact bundle the
   * issue will carry, one row per field (plain name, what, why, value, raw
   * JSON), what is never included, the privacy text, the size, Hold to send
   * and Save report.
   *
   * Constraints:
   * - Rows come from report.js FIELDS, the table the builder walks: a field
   *   cannot leave without a row here.
   * - Hold to send fires after 1500 ms held (hold.js: pointer, touch, Enter or
   *   Space); a shorter hold opens nothing. Phosphor itself sends nothing:
   *   the user submits on GitHub.
   * - Over the URL budget the review says so before the hold, and Send saves
   *   the full bundle as a file to attach first.
   */
  import { health, snapshot, context, hubLogCounts, putSent } from '../../model/health/health.svelte.js';
  import { FIELDS, NOT_INCLUDED, PRIVACY, PRIVACY_SHORT, URL_BUDGET, fileName, get, issueUrl, openUrl, reportSource, saveFile } from '../../model/health/report.js';
  import { CONDITIONS } from '../../model/health/core.js';
  import { untrack } from 'svelte';
  import { hold } from '../../shell/hold.js';
  import { PROTO_VER } from '../../../../Valence/clients/js/generated/registry_vocab.js';
  import '../pane.css';

  let { id, onback } = $props();

  const inc = $derived(health.incidents.find((i) => i.id === id));
  // Read once: a review is of the incident as it stands when opened.
  const snap = untrack(() => snapshot(id));
  const ctx = context();
  const src = $derived(inc ? reportSource({ inc, snap, ctx, hubLog: hubLogCounts(inc.t0), protocol: PROTO_VER,
    others: health.incidents.filter((o) => o.id !== id) }) : null);
  const out = $derived(src ? issueUrl(src) : null);
  // The bundle as the issue and its file carry it (attachment named when over the budget).
  const bundle = $derived(out ? JSON.parse(out.full) : null);
  const SECTION = { schema: 'Report', id: 'Report', app: 'This app', machine: 'Machine', incident: 'Problem', settings: 'Settings',
    measure: 'What raised it', evidence: 'Measurements', window: 'History', events: 'Events', hub_log: 'Machine log', attachment: 'Attachment' };
  const groups = $derived.by(() => {
    const g = [];
    for (const f of FIELDS) {
      const name = SECTION[f.path.split('.')[0]];
      if (!g.length || g[g.length - 1].name !== name) g.push({ name, rows: [] });
      g[g.length - 1].rows.push({ ...f, value: bundle ? get(bundle, f.path) : null });
    }
    return g;
  });

  function shown(f, v) {
    if (v == null) return 'none';
    if (f.type === 'series') {
      const n = v.filter((x) => x != null);
      return n.length ? n.length + ' points, ' + Math.min(...n) + ' to ' + Math.max(...n) + (f.unit ? ' ' + f.unit : '') : 'none measured';
    }
    if (f.type === 'events') return v.length ? v.length + ' event' + (v.length === 1 ? '' : 's') : 'none';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v) + (f.unit && typeof v === 'number' ? ' ' + f.unit : '');
  }

  let note = $state('');
  let busy = $state(false);
  async function send() {
    if (!out || busy) return;
    busy = true;
    try {
      let saved = '';
      if (out.attach) saved = await saveFile(fileName(id), out.full).catch(() => null);
      const opened = await openUrl(out.url);
      if (!opened) {
        await navigator.clipboard.writeText(out.url).catch(() => {});
        note = 'Link copied: paste it in your browser';
      } else note = out.attach ? 'Opened: attach ' + (saved || fileName(id)) + ', then Submit' : 'Opened in your browser: press Submit there';
      putSent({ id, issueUrl: null, sentAt: Date.now(), bytes: out.full.length, bundle: JSON.parse(out.full) });
    } finally { busy = false; }
  }
  async function save() {
    if (!out) return;
    try {
      const p = await saveFile(fileName(id), out.full);
      note = p ? 'Saved to ' + p : 'Downloaded ' + fileName(id);
    } catch (e) { note = 'Save failed: ' + ((e && e.message) || e); }
  }
</script>

<div class="pane-stack review">
  <div class="top">
    <button type="button" class="og-btn sm" onclick={onback}>‹ Health</button>
    <h2>Report <span class="mono">{id}</span></h2>
  </div>
  {#if !inc}
    <p class="pane-empty">This incident is no longer kept</p>
  {:else}
    <section class="pane-sec og-screen" aria-labelledby="rr-what">
      <div class="pane-head"><h2 id="rr-what">{inc.text}</h2></div>
      {#if CONDITIONS[inc.cond].detail}<p class="lead">{CONDITIONS[inc.cond].detail}</p>{/if}
      <p class="size mono" data-over={out?.attach || null}>{out ? out.full.length + ' characters' : '--'} · {out?.attach
        ? 'too long for the link: Send saves ' + fileName(id) + ' to attach on GitHub'
        : 'fits the link (' + URL_BUDGET + ' max)'}</p>
    </section>

    {#each groups as g (g.name)}
      <section class="pane-sec og-screen" aria-label={g.name}>
        <div class="pane-head"><h3>{g.name}</h3></div>
        <dl class="fields">
          {#each g.rows as f (f.path)}
            <div class="row" data-path={f.path}>
              <dt>{f.name}</dt>
              <dd class="val">{shown(f, f.value)}</dd>
              <dd class="what">{f.what}. {f.why}.</dd>
              <dd class="raw"><code>{f.path}: {JSON.stringify(f.value)}</code></dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}

    <section class="pane-sec og-screen" aria-labelledby="rr-not">
      <div class="pane-head"><h3 id="rr-not">Not included</h3></div>
      <ul class="not">{#each NOT_INCLUDED as n (n)}<li>{n}</li>{/each}</ul>
    </section>

    <section class="pane-sec og-screen" aria-labelledby="rr-priv">
      <div class="pane-head"><h3 id="rr-priv">{PRIVACY_SHORT}</h3></div>
      <p class="priv">{PRIVACY}</p>
      <div class="acts">
        <button type="button" class="og-btn primary send" disabled={busy}
                use:hold={{ ms: 1500, onfire: send, key: id }}>Hold to send</button>
        <button type="button" class="og-btn" onclick={save}>Save report</button>
      </div>
      <p class="pane-status" role="status" data-phase={note ? 'settled' : null} data-tip={note}>{note}</p>
    </section>
  {/if}
</div>

<style>
  .top { display: flex; align-items: center; gap: var(--sp-3); }
  .top h2 { margin: 0; font-size: .9rem; font-weight: 500; }
  .lead { margin: 0; font-size: .82rem; }
  .size { margin: 0; font-size: .72rem; color: var(--tx-mut); }
  .size[data-over] { color: var(--warn-ink, var(--warn)); }
  .fields { margin: 0; display: flex; flex-direction: column; }
  .row { display: grid; grid-template-columns: minmax(12ch, 1fr) minmax(0, 1.4fr); gap: var(--sp-1) var(--sp-3); padding: var(--sp-2) 0; border-bottom: 1px solid var(--line-soft); font-size: .78rem; }
  .row dt { color: var(--ink); }
  .row dd { margin: 0; min-width: 0; }
  .val { font-family: var(--mono); color: var(--tx-val); overflow-wrap: anywhere; }
  .what { grid-column: 1 / -1; color: var(--tx-mut); font-size: .72rem; }
  .raw { grid-column: 1 / -1; }
  .raw code { font-family: var(--mono); font-size: .66rem; color: var(--ink-faint); overflow-wrap: anywhere; word-break: break-all; }
  .not { margin: 0; padding-left: var(--sp-4); font-size: .78rem; color: var(--ink-dim); columns: 2 14ch; }
  .priv { margin: 0; font-size: .78rem; line-height: 1.5; color: var(--ink-dim); }
  .acts { display: flex; flex-wrap: wrap; gap: var(--sp-3); }
  .send { position: relative; overflow: hidden; }
  .send::before { content: ''; position: absolute; inset: 0; width: 0; background: color-mix(in srgb, var(--reality) 30%, transparent); }
  .send:global(.holding)::before { width: 100%; transition: width 1.5s linear; }
</style>
