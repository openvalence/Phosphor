<script module>
  import { prefs } from '../model/prefs.js';
  import { setAutorange } from '../model/format.js';

  // Module scope: the preference applies from first load in both deliveries,
  // not only once this pane has been opened.
  prefs.subscribe((p) => setAutorange(p.autorange));
</script>

<script>
  /**
   * ThemePicker.svelte -- the Display pane: accent theme, legibility, unit
   * display, and the renderer class this window is drawn in. The shell's
   * Settings pane hosts the same component.
   *
   * Constraints:
   * - Every control here is a BROWSER preference, never device state: nothing
   *   is sent to the machine, so there is no write ladder (RENDERING law 5
   *   binds hub writes). Theme, hi-vis and terse persist to localStorage;
   *   autorange and units live in prefs.js.
   * - Driven by theme.js's THEMES table, never a hardcoded list. The custom
   *   pair goes through setCustomColors(), which the canvas renderers read.
   * - Units is a readout while prefs.js offers one system: a selector with
   *   one choice would drive nothing.
   * - The class readout is measured, never configured (RENDERING §12.1).
   */
  import { untrack } from 'svelte';
  import { THEMES, applyTheme, currentThemeId, setCustomColors, customColors } from '../model/theme.js';
  import { setPref, UNITS } from '../model/prefs.js';
  import { view } from '../model/viewport.svelte.js';
  import { FULL_UP, GLANCE_UP } from '../model/rclass.js';
  import './pane.css';

  let current = $state(currentThemeId());
  let custom = $state(customColors());

  function pick(id) {
    applyTheme(id);
    current = id;
  }
  function setColor(kind, e) {
    custom = { ...custom, [kind]: e.target.value };
    setCustomColors(custom.reality, custom.intent);
    current = 'custom';
  }
  function pickCustom() {
    setCustomColors(custom.reality, custom.intent);
    current = 'custom';
  }

  // Hi-vis and terse: classes on <html>, restored by main.js before first
  // paint from `ui_hivis` / `ui_terse` ('1'/'0'); this only flips them.
  const htmlHas = (c) => typeof document !== 'undefined' && document.documentElement.classList.contains(c);
  let hivis = $state(htmlHas('hivis'));
  let terse = $state(htmlHas('terse'));
  function flip(cls, key, on) {
    document.documentElement.classList.toggle(cls, on);
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* private mode: preference only */ }
  }

  // The measured viewport, for the class readout.
  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 0);
  let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 0);
  let dpr = $state(typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  $effect(() => untrack(() => {
    const measure = () => { vw = window.innerWidth; vh = window.innerHeight; dpr = window.devicePixelRatio; };
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }));
  const POINTER = { fine: 'fine (mouse or pen)', coarse: 'coarse (touch)', none: 'none (no pointer)' };
</script>

<div class="pane-stack theme-picker">
  <section class="pane-sec og-panel" aria-labelledby="tp-theme">
    <div class="pane-head"><h2 id="tp-theme">Theme</h2></div>
    <div class="swatches" role="group" aria-label="Accent theme">
      {#each THEMES as t (t.id)}
        <button type="button" class="swatch" class:active={current === t.id} aria-pressed={current === t.id}
                title={t.name + ' · reality ' + t.reality + ' / intent ' + t.intent} onclick={() => pick(t.id)}>
          <span class="dot" style="background:{t.reality};box-shadow:0 0 6px {t.reality}" aria-hidden="true"></span>
          <span class="dot" style="background:{t.intent}" aria-hidden="true"></span>
          <span class="name">{t.name}</span>
        </button>
      {/each}
      <span class="custom-swatch">
        <button type="button" class="swatch" class:active={current === 'custom'} aria-pressed={current === 'custom'}
                title="Your own accent pair" onclick={pickCustom}>
          <span class="dot" style="background:{custom.reality};box-shadow:0 0 6px {custom.reality}" aria-hidden="true"></span>
          <span class="dot" style="background:{custom.intent}" aria-hidden="true"></span>
          <span class="name">Custom</span>
        </button>
        <label class="color-input" title="Reality: what the machine reports">
          <input type="color" value={custom.reality} oninput={(e) => setColor('reality', e)} aria-label="Reality accent color" />
        </label>
        <label class="color-input" title="Intent: what it was asked for, and the window band">
          <input type="color" value={custom.intent} oninput={(e) => setColor('intent', e)} aria-label="Intent accent color" />
        </label>
      </span>
    </div>
    <p class="pane-note">Accent colors only: safety amber and red are the same in every theme. A browser preference; the machine is unaffected.</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-legibility">
    <div class="pane-head"><h2 id="tp-legibility">Legibility</h2></div>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={hivis} onchange={(e) => flip('hivis', 'ui_hivis', (hivis = e.currentTarget.checked))} />
      <span class="track"></span>High legibility: brighter text, heavier numerals
    </label>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={terse} onchange={(e) => flip('terse', 'ui_terse', (terse = e.currentTarget.checked))} />
      <span class="track"></span>Terse instruments
    </label>
    <p class="pane-note">Terse hides usage hints on instrument cards; on settings pages a field's description moves onto its info button.</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-units">
    <div class="pane-head"><h2 id="tp-units">Units</h2></div>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={$prefs.autorange} onchange={(e) => setPref('autorange', e.currentTarget.checked)} />
      <span class="track"></span>Autorange: 85 mV, not 0.085 V
    </label>
    <dl class="pane-facts">
      <dt>System</dt><dd>{$prefs.units}{UNITS.length === 1 ? ', the only system today' : ''}</dd>
    </dl>
    <p class="pane-note">Display only: what is sent to the machine never changes.</p>
  </section>

  <section class="pane-sec og-screen" aria-labelledby="tp-class">
    <div class="pane-head"><h2 id="tp-class">Renderer class</h2></div>
    <dl class="pane-facts">
      <dt>Class</dt><dd class="cls">{view.cls}</dd>
      <dt>Viewport</dt><dd class="mono">{vw} × {vh} CSS px, {dpr}× pixel ratio</dd>
      <dt>Pointer</dt><dd>{POINTER[view.pointer] || view.pointer}</dd>
      <dt>Boundaries</dt><dd class="mono">glance below {GLANCE_UP} px or no pointer, full from {FULL_UP} px</dd>
    </dl>
    <p class="pane-note">Measured from this window, never set: resize it and the class follows.</p>
  </section>
</div>

<style>
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .swatch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--tap);
    padding: 0 10px;
    border-radius: var(--r-s);
    border: 1px solid var(--line-2);
    color: var(--ink-dim);
    font-size: .76rem;
    font-weight: 500;
    white-space: nowrap;
    transition: border-color .12s, color .12s;
  }
  .swatch:hover { border-color: var(--line-4); }
  .swatch.active { color: var(--ink-hi); border-color: var(--reality); box-shadow: var(--glow-reality); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .name { text-transform: uppercase; letter-spacing: .03em; }

  .custom-swatch { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .color-input {
    display: inline-flex;
    width: var(--tap);
    height: var(--tap);
    align-items: center;
    justify-content: center;
    border-radius: var(--r-s);
    border: 1px solid var(--line-2);
  }
  /* The input IS the hit box (law 12): it fills the 40 px+ label. */
  .color-input input { width: 100%; height: 100%; border: none; background: none; padding: 2px; cursor: pointer; }

  .og-switch { min-height: var(--tap); font-size: .8rem; align-self: flex-start; }
  .cls { color: var(--reality); text-transform: uppercase; letter-spacing: .06em; }
</style>
