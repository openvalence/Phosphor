<script>
  /**
   * FootStrip.svelte — the persistent footer link/diagnostic strip.
   *
   * Restores the pre-refactor page's full-width "▶ LINK" footer identity, but
   * carries only what this refactor's contracts actually have: link-quality
   * counters from machine.stats, the catalog's own identity, the deadman
   * window the hub granted this session, and the shipped UI build id. There
   * is no WiFi RSSI/BSSID/heap surface here — that lived in the retired HTTP
   * plane (docs/http-plane-retirement.md) and machine.stats does not carry it,
   * so showing it would mean fabricating a number nobody sent.
   *
   * Read-only and quiet on purpose: this bar never offers a control, only
   * tells the operator what the Valence link is doing. Ground truth applies
   * here too — every value is `--` until the machine (or the session itself)
   * has actually produced it.
   *
   * No props — reads the one machine spine directly. Wire it in bare:
   *   <FootStrip />
   *
   * Constraints:
   * - A live value never moves its neighbors: each holds a slot sized to
   *   its widest honest reading (--w, in ch of the mono face) (ph-rt1).
   * - Phones get a grid of whole facts, never a ragged wrap.
   */
  import { machine } from '../model/machine.svelte.js';
  import { since, clock } from '../model/format.js';

  // A page full of "since" readouts needs its own clock, or the age freezes
  // the instant this component last happened to re-render.
  let sessionMs = $state(false);
  let nowTick = $state(Date.now());
  $effect(() => {
    // Reading sessionMs here is deliberate: it makes this effect re-run on
    // the toggle and re-install the interval. A millisecond digit stepping
    // once a second would be a readout that lies about its own resolution.
    const id = setInterval(() => { nowTick = Date.now(); }, sessionMs ? 50 : 1000);
    return () => clearInterval(id);
  });
  function ageLabel(ms, _tick) { return since(ms); }

  const etagShort = $derived(
    machine.catalog.etag && machine.catalog.etag.length ? machine.catalog.etag.slice(0, 10) : '--'
  );
  const deadman = $derived(machine.link.deadmanMs ? machine.link.deadmanMs + ' ms' : '--');
  const clockOffset = $derived(machine.stats.clockOffsetUs != null ? machine.stats.clockOffsetUs + ' µs' : '--');
  const clockRtt = $derived(machine.stats.clockRttUs != null ? machine.stats.clockRttUs + ' µs' : '--');
  const rxAge = $derived(ageLabel(machine.stats.lastRxMs, nowTick));

  // Session age off machine.link.since, which the link sets when the phase
  // last changed. Milliseconds are behind a click: the digit changes 1000x a
  // second and is only wanted when someone is timing something.
  const sessionAge = $derived(
    machine.link.phase === 'live' && machine.link.since
      ? clock(nowTick - machine.link.since, sessionMs)
      : '--'
  );

  // Vite global (vite.config.js `define`) — short git hash, or a UTC build
  // timestamp in a repo-less checkout. Never a hand-maintained literal.
  const buildId = typeof __UI_BUILD__ !== 'undefined' ? __UI_BUILD__ : '--';
</script>

<footer class="footstrip" aria-label="Link diagnostics">
  <span class="fs-label" aria-hidden="true">&#9656; LINK</span>

  <div class="facts">
    <span class="fact"><span class="k">reconnects</span><span class="v mono" style="--w: 3ch">{machine.stats.reconnects}</span></span>
    <span class="fact"><span class="k">state pushes</span><span class="v mono" style="--w: 7ch">{machine.stats.statePushes}</span></span>
    <span class="fact"><span class="k">clock offset</span><span class="v mono" style="--w: 13ch">{clockOffset}</span></span>
    <span class="fact"><span class="k">clock rtt</span><span class="v mono" style="--w: 8ch">{clockRtt}</span></span>
    <span class="fact"><span class="k">catalog etag</span><span class="v mono" title={machine.catalog.etag || undefined}>{etagShort}</span></span>
    <span class="fact"><span class="k">deadman</span><span class="v mono" >{deadman}</span></span>
    <span class="fact"><span class="k">last rx</span><span class="v mono" style="--w: 7ch">{rxAge}</span></span>
    <button type="button" class="fact fact-btn" onclick={() => (sessionMs = !sessionMs)}
            title={sessionMs ? 'Hide milliseconds' : 'Show milliseconds'}>
      <span class="k">session</span><span class="v mono" style="--w: 11ch">{sessionAge}</span>
    </button>
    <span class="fact"><span class="k">ui build</span><span class="v mono">{buildId}</span></span>
  </div>
</footer>

<style>
  .footstrip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 8px var(--gap);
    background: var(--bg-raised);
    border-top: 1px solid var(--line);
    color: var(--ink-faint);
    font-size: 11px;
  }

  .fs-label {
    flex: 0 0 auto;
    color: var(--ink-faint);
    letter-spacing: .08em;
    font-weight: 600;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .fact {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    white-space: nowrap;
  }
  /* A fact that happens to be clickable stays a fact: same metrics, no button
     chrome, so the strip does not grow a control that looks like a control. */
  .fact-btn {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
  }
  .fact-btn:hover .v { color: var(--ink); }

  .k {
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: .05em;
    font-size: 11px;
  }
  .v {
    min-width: var(--w, 0);
    color: var(--ink-dim);
    font-size: 11px;
    white-space: nowrap;
  }

  /* Desktop: whole facts in rows, never a sideways scroller (ph-rt1); one
     row from about 1280 px, two below it. */
  @media (min-width: 960px) {
    .footstrip { flex-wrap: nowrap; }
  }

  /* Touch: a clickable fact grows a real 40px hit box. An invisible
     pseudo-element extension (the usual T24 preference) does not survive
     here: FootStrip sits flush against the bottom of the desktop `.app`
     shell (style.css: a fixed-height flex column, `overflow: hidden`), so
     anything the pseudo-element grows downward is clipped away before it
     reaches the floor. */
  @media (pointer: coarse) {
    .fact-btn { min-height: 40px; align-items: center; }
  }
  /* Phones: a grid of key-over-value cells, every fact in its column. */
  @media (max-width: 959px) {
    .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 104px), 1fr)); gap: 6px 14px; }
    .facts .fact { flex-direction: column; align-items: flex-start; justify-content: center; gap: 0; }
  }
</style>
