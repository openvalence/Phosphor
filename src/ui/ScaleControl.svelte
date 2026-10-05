<script>
  /**
   * ScaleControl.svelte -- the UI scale control, right end of the status row
   * (FootStrip). Operator ruling 2026-10-03; DESIGN §10.3.
   *
   * Constraints:
   * - Always mounted (FootStrip is), so Ctrl+=, Ctrl+-, Ctrl+0 and Ctrl+wheel
   *   work on every page, fullscreen included.
   * - Compact: the row keeps its text height. Every label is one width in
   *   both states, so a flip moves nothing; Reset keeps its slot while hidden.
   * - The scale is theme.js's look.scale, one value with the Display pane's
   *   slider, persisted with the theme. The readout is relative to the
   *   knob's default, which reads 100%. Ctrl+wheel over a surface that
   *   takes the wheel itself (it prevented the default, a range, a canvas)
   *   never scales, and never zooms the webview either.
   */
  import { KNOBS, currentTheme, onTheme, setScale } from '../model/theme.js';

  const [MIN, MAX, , DEF] = KNOBS.look.scale;
  let scale = $state(currentTheme().look.scale);
  $effect(() => onTheme((t) => { scale = t.look.scale; }));
  const pct = $derived(Math.round(scale / DEF * 100));

  /** One 10% step of the default, snapped to the decade, inside the knob's range. */
  function target(dir) {
    const p = dir > 0 ? Math.floor(pct / 10) * 10 + 10 : Math.ceil(pct / 10) * 10 - 10;
    const v = DEF * p / 100;
    return v < MIN - 1e-9 || v > MAX + 1e-9 ? null : v;
  }
  function step(dir) {
    const v = target(dir);
    if (v != null) setScale(v);
  }

  function onkeydown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const dir = e.key === '=' || e.key === '+' ? 1 : e.key === '-' ? -1 : e.key === '0' ? 0 : null;
    if (dir == null) return;
    e.preventDefault();
    if (dir) step(dir); else setScale(DEF);
  }
  let acc = 0;
  function onwheel(e) {
    if (!e.ctrlKey || e.defaultPrevented) return;
    e.preventDefault();
    if (e.target.closest?.('input[type=range], canvas')) return;
    acc += e.deltaMode ? e.deltaY * 40 : e.deltaY;
    if (Math.abs(acc) < 100) return;
    step(acc < 0 ? 1 : -1);
    acc = 0;
  }
  $effect(() => {
    window.addEventListener('wheel', onwheel, { passive: false });
    return () => window.removeEventListener('wheel', onwheel);
  });
</script>

<svelte:window {onkeydown} />

<div class="foot-scale" role="group" aria-label="UI scale">
  <button type="button" class="og-btn sm" aria-label="Smaller" title="Smaller, Ctrl+-"
          disabled={target(-1) == null} onclick={() => step(-1)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>
  </button>
  <output class="mono" title="UI scale">{pct}%</output>
  <button type="button" class="og-btn sm" aria-label="Larger" title="Larger, Ctrl+="
          disabled={target(1) == null} onclick={() => step(1)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg>
  </button>
  <button type="button" class="og-btn sm reset" class:off={pct === 100} aria-label="Reset scale"
          title="Reset scale, Ctrl+0" onclick={() => setScale(DEF)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6.5A5 5 0 1 1 3 9"/><path d="M3 3v3.5h3.5"/></svg>
  </button>
</div>

<style>
  /* The negative block margin nets the 20 px buttons to the row's text height. */
  .foot-scale { flex: none; display: flex; align-items: center; gap: var(--sp-2); margin: calc(var(--sp-1) * -1) 0 calc(var(--sp-1) * -1) auto; }
  .foot-scale .og-btn { min-height: 0; height: 20px; min-width: 24px; padding: 0; color: var(--ink-dim); }
  .foot-scale svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .foot-scale output { min-width: 4ch; text-align: center; font-size: 11px; color: var(--ink-dim); }
  .reset.off { visibility: hidden; }
  @media (pointer: coarse) {
    .foot-scale .og-btn { min-height: 40px; min-width: 40px; }
  }
</style>
