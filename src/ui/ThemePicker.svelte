<script module>
  import { prefs } from '../model/prefs.js';
  import { setAutorange } from '../model/format.js';

  // Module scope: the preference applies from first load in both deliveries,
  // not only once this pane has been opened.
  prefs.subscribe((p) => setAutorange(p.autorange));
</script>

<script>
  /**
   * ThemePicker.svelte -- the Display pane: the theme editor, legibility,
   * unit display, and the renderer class this window is drawn in. The
   * shell's Settings pane hosts the same component.
   *
   * Constraints:
   * - Every control here is a BROWSER preference, never device state: nothing
   *   is sent to the machine, so there is no write ladder (RENDERING law 5
   *   binds hub writes). Theme, hi-vis and terse persist to localStorage;
   *   autorange and units live in prefs.js.
   * - Driven by theme.js (presets, KNOBS, TOKENS, LOCKED), never a local
   *   list: a new knob or token appears here without an edit.
   * - Safety colors render locked, never editable (RENDERING law 13).
   * - Nothing shifts: the ratio readout (each ratio a label over its number,
   *   then the safety hue note), the active name, the status line and every
   *   Advanced row are fixed slots; a refused pin speaks in its own row.
   *   Advanced is closed by default and never scrolls on its own.
   * - No <select>: test/console-panes.test.mjs reads units as a fact.
   * - The class readout is measured, never configured (RENDERING §12.1).
   */
  import { untrack } from 'svelte';
  import {
    KNOBS, TOKENS, LOCKED, SAFETY, DEFAULT_THEME,
    applyTheme, currentTheme, editTheme, onTheme, deriveTokens, presetList,
    saveAsPreset, deletePreset, exportTheme, importTheme, validOverride,
  } from '../model/theme.js';
  import { setPref } from '../model/prefs.js';
  import { formatWithUnit } from '../model/format.js';
  import { view } from '../model/viewport.svelte.js';
  import { FULL_UP, GLANCE_UP } from '../model/rclass.js';
  import './pane.css';

  let theme = $state(currentTheme());
  let presets = $state(presetList());
  $effect(() => onTheme((t) => { theme = t; presets = presetList(); }));
  const d = $derived(deriveTokens(theme));
  const chips = $derived(presets.map((p) => ({ p, bg: deriveTokens(p).base['--bg'] })));

  const ACCENTS = [
    ['reality', 'Reality', 'Measured truth'],
    ['intent', 'Intent', 'Requested, not yet confirmed'],
    ['highlight', 'Highlight', 'Focus, selection, hover'],
  ];
  // The host's value-and-unit rule (format.js), never a local one.
  const unit = (u) => (v) => formatWithUnit({ unit: u, step: Number.isInteger(v) ? 1 : 0.1 }, v);
  const pct = (v) => unit('%')(Math.round(v * 100));
  const KNOB_COPY = {
    hue: ['Hue', 'Chassis hue', unit('°')],
    tint: ['Tint', 'Chassis color strength', pct],
    brightness: ['Brightness', 'Page lightness', pct],
    contrast: ['Contrast', 'Ramp spread', pct],
    glow: ['Glow', 'Glow strength', pct],
    radius: ['Radius', 'Corner radius', unit('px')],
    scale: ['Scale', 'Control scale', (v) => pct(v / KNOBS.look.scale[3])],
    numWeight: ['Numerals', 'Readout numeral weight', (v) => String(v)],
    motion: ['Motion', 'Echo afterglow; 0 holds still', (v) => (v ? unit('s')(v) : 'still')],
  };
  const RAMP = ['--bg-sunken', '--bg', '--bg-raised', '--bg-card', '--line-0', '--line-1', '--line-2', '--line-3', '--line-4',
    '--tx-faint', '--tx-ghost', '--tx-mut', '--tx-val', '--tx', '--tx-hi'];

  const near = $derived(ACCENTS.filter(([k]) => d.near[k]).map(([k, label]) => label + ' near safety ' + d.near[k]).join(' · '));

  const setAccent = (k, v) => editTheme((t) => { t.accents[k] = v.toUpperCase(); });
  const setKnob = (g, k, v) => editTheme((t) => { t[g][k] = v; });

  // ---- presets ----
  let saveName = $state('');
  function save() {
    saveAsPreset(saveName);
    saveName = '';
  }
  function remove(id) {
    deletePreset(id);
    presets = presetList();
  }

  // ---- advanced: pinned tokens ----
  let refused = $state(null);
  function pin(k, raw) {
    const v = raw.trim();
    refused = v && !validOverride(k, v) ? k : null;
    if (!refused) editTheme((t) => { if (v) t.overrides[k] = v; else delete t.overrides[k]; });
  }

  // ---- export / import ----
  let paste = $state('');
  let ioNote = $state('');
  let ioPhase = $state(null);
  async function copy() {
    paste = exportTheme();
    try {
      await navigator.clipboard.writeText(paste);
      ioNote = 'Copied';
    } catch (e) {
      ioNote = 'Clipboard blocked; copy from the field';
    }
    ioPhase = null;
  }
  function load() {
    try {
      importTheme(paste);
      ioNote = 'Imported';
      ioPhase = 'settled';
    } catch (e) {
      ioNote = 'Not imported: ' + e.message;
      ioPhase = 'fault';
    }
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
  const ratio = (v) => (v == null ? '--' : v.toFixed(1) + ':1');
</script>

<div class="pane-stack theme-picker">
  <section class="pane-sec og-panel" aria-labelledby="tp-theme">
    <div class="pane-head"><h2 id="tp-theme">Theme</h2><span class="tp-active" data-testid="theme-active">{theme.name}</span></div>
    <div class="swatches" role="group" aria-label="Theme presets">
      {#each chips as { p, bg } (p.id)}
        <span class="preset">
          <button type="button" class="swatch" class:active={theme.id === p.id} aria-pressed={theme.id === p.id}
                  data-theme-id={p.id} onclick={() => applyTheme(p)}>
            <span class="chassis" style="background:{bg}" aria-hidden="true">
              <span class="dot" style="background:{p.accents.reality};box-shadow:0 0 6px {p.accents.reality}"></span>
              <span class="dot" style="background:{p.accents.intent}"></span>
            </span>
            <span class="name">{p.name}</span>
          </button>
          {#if p.id.startsWith('user-')}
            <button type="button" class="og-btn sm del" aria-label={'Delete ' + p.name} title="Delete preset" onclick={() => remove(p.id)}>×</button>
          {/if}
        </span>
      {/each}
    </div>
    <div class="row">
      <input class="og-num name-in" placeholder="Preset name" aria-label="Preset name" maxlength="40" bind:value={saveName} />
      <button type="button" class="og-btn" onclick={save}>Save as preset</button>
      <button type="button" class="og-btn" disabled={theme.id === DEFAULT_THEME.id} onclick={() => applyTheme(DEFAULT_THEME.id)}>Reset</button>
    </div>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-accents">
    <div class="pane-head"><h2 id="tp-accents">Accents</h2></div>
    <div class="accents">
      {#each ACCENTS as [k, label, tip] (k)}
        {@const v = k === 'highlight' ? (theme.accents.highlight || theme.accents.reality) : theme.accents[k]}
        <label class="accent" title={tip}>
          <span class="color-input"><input type="color" value={v.toLowerCase()} aria-label={label + ' color'}
                 oninput={(e) => setAccent(k, e.currentTarget.value)} /></span>
          <span class="accent-name">{label}</span><span class="mono hex">{v}</span>
        </label>
      {/each}
    </div>
    <div class="locked" role="group" aria-label="Safety colors">
      {#each SAFETY as k (k)}
        <span class="lock" title={'Locked: ' + LOCKED[k]}><i style="background:var({k})" aria-hidden="true"></i><span class="mono">{k}</span></span>
      {/each}
      <span class="pane-note">Locked: safety colors (law 13)</span>
    </div>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-chassis">
    <div class="pane-head"><h2 id="tp-chassis">Chassis</h2></div>
    <div class="knobs">
      {#each Object.entries(KNOBS.chassis) as [k, [min, max, step]] (k)}
        <label class="knob-row" title={KNOB_COPY[k][1]}>
          <span class="knob-name">{KNOB_COPY[k][0]}</span>
          <input type="range" {min} {max} {step} value={theme.chassis[k]} aria-label={KNOB_COPY[k][1]}
                 data-knob={'chassis.' + k} oninput={(e) => setKnob('chassis', k, Number(e.currentTarget.value))} />
          <output class="mono">{KNOB_COPY[k][2](theme.chassis[k])}</output>
        </label>
      {/each}
    </div>
    <div class="ramp" aria-hidden="true">
      {#each RAMP as k (k)}<i style="background:var({k})" title={k}></i>{/each}
    </div>
    <div class="ratios" data-testid="theme-ratios">
      <div class="ratio-grid">
        <span class="ratio"><span class="rk">Text</span> <span class="mono">{ratio(d.ratios.text)}</span></span>
        <span class="ratio"><span class="rk">Labels</span> <span class="mono">{ratio(d.ratios.labels)}</span></span>
        <span class="ratio"><span class="rk">Reality</span> <span class="mono">{ratio(d.ratios.reality)}</span></span>
        <span class="near" data-testid="theme-near" title={near}>{near}</span>
      </div>
    </div>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-look">
    <div class="pane-head"><h2 id="tp-look">Look</h2></div>
    <div class="knobs">
      {#each Object.entries(KNOBS.look) as [k, [min, max, step]] (k)}
        <label class="knob-row" title={KNOB_COPY[k][1]}>
          <span class="knob-name">{KNOB_COPY[k][0]}</span>
          <input type="range" {min} {max} {step} value={theme.look[k]} aria-label={KNOB_COPY[k][1]}
                 data-knob={'look.' + k} oninput={(e) => setKnob('look', k, Number(e.currentTarget.value))} />
          <output class="mono">{KNOB_COPY[k][2](theme.look[k])}</output>
        </label>
      {/each}
    </div>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-adv">
    <details class="adv">
      <summary><h2 id="tp-adv">Advanced</h2><span class="pane-note">{Object.keys(theme.overrides).length} pinned</span></summary>
      <ul class="tokens">
        {#each TOKENS as k (k)}
          {@const v = refused === k ? 'Not a single CSS value' : d.base[k]}
          <li class:pinned={k in theme.overrides}>
            <span class="mono tk">{k}</span>
            <span class="mono derived" id={'tp-v' + k} data-phase={refused === k ? 'fault' : null} title={v}>{v}</span>
            <input class="og-num mono" placeholder="Derived" aria-label={'Pin ' + k} aria-describedby={'tp-v' + k}
                   aria-invalid={refused === k} spellcheck="false"
                   value={theme.overrides[k] ?? ''} onchange={(e) => pin(k, e.currentTarget.value)} />
            <button type="button" class="og-btn sm" disabled={!(k in theme.overrides)} aria-label={'Reset ' + k}
                    onclick={() => pin(k, '')}>Reset</button>
          </li>
        {/each}
      </ul>
    </details>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-io">
    <div class="pane-head"><h2 id="tp-io">Export / import</h2></div>
    <label class="sr-only" for="tp-json">Theme JSON</label>
    <textarea id="tp-json" class="mono" rows="3" spellcheck="false" placeholder="Paste theme JSON" bind:value={paste}></textarea>
    <div class="row">
      <button type="button" class="og-btn" onclick={copy}>Copy theme</button>
      <button type="button" class="og-btn" disabled={!paste.trim()} onclick={load}>Import</button>
    </div>
    <p class="pane-status" role="status" data-phase={ioPhase}>{ioNote}</p>
    <p class="pane-note">Browser preference; never sent to the hub</p>
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
    <p class="pane-note">Hides card hints; descriptions move to info buttons</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-units">
    <div class="pane-head"><h2 id="tp-units">Units</h2></div>
    <label class="og-switch">
      <input type="checkbox" role="switch" checked={$prefs.autorange} onchange={(e) => setPref('autorange', e.currentTarget.checked)} />
      <span class="track"></span>Autorange: 85 mV, not 0.085 V
    </label>
    <dl class="pane-facts">
      <dt>System</dt><dd>{$prefs.units}</dd>
    </dl>
    <p class="pane-note">Display only</p>
  </section>

  <section class="pane-sec og-panel" aria-labelledby="tp-class">
    <div class="pane-head"><h2 id="tp-class">Renderer class</h2></div>
    <dl class="pane-facts">
      <dt>Class</dt><dd class="cls">{view.cls}</dd>
      <dt>Viewport</dt><dd class="mono">{vw} × {vh} CSS px, {dpr}× pixel ratio</dd>
      <dt>Pointer</dt><dd>{POINTER[view.pointer] || view.pointer}</dd>
      <dt>Boundaries</dt><dd class="mono">glance below {GLANCE_UP} px or no pointer, full from {FULL_UP} px</dd>
    </dl>
    <p class="pane-note">Measured from the window size</p>
  </section>
</div>

<style>
  .tp-active { font-size: .76rem; color: var(--ink-hi); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 24ch; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .name-in { width: 22ch; max-width: 100%; min-height: var(--tap); font-size: .8rem; }

  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .preset { display: inline-flex; align-items: center; gap: 2px; }
  .swatch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--tap);
    padding: 0 10px 0 6px;
    border-radius: var(--r-s);
    border: 1px solid var(--line-2);
    color: var(--ink-dim);
    font-size: .76rem;
    font-weight: 500;
    white-space: nowrap;
    transition: border-color .12s, color .12s;
  }
  .swatch:hover { border-color: var(--line-4); }
  .swatch.active { color: var(--ink-hi); border-color: var(--highlight); box-shadow: 0 0 10px rgba(var(--highlight-rgb), .35); }
  .chassis {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px;
    border-radius: var(--r-s);
    border: 1px solid var(--line-1);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .name { text-transform: uppercase; letter-spacing: .03em; }
  .del { min-width: 30px; padding: 4px; }

  .accents { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .accent { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; max-width: 100%; font-size: .8rem; color: var(--tx); }
  .hex { color: var(--tx-mut); font-size: .72rem; }
  .color-input {
    display: inline-flex;
    width: var(--tap);
    height: var(--tap);
    border-radius: var(--r-s);
    border: 1px solid var(--line-2);
  }
  /* The input IS the hit box (law 12): it fills the 40 px+ box. */
  .color-input input { width: 100%; height: 100%; border: none; background: none; padding: 2px; cursor: pointer; }

  .locked { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
  .lock { display: inline-flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--tx-mut); }
  .lock i { width: 14px; height: 14px; border-radius: var(--r-s); outline: 1px dashed var(--line-3); outline-offset: 2px; }

  .knobs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 0 28px; }
  .knob-row { display: grid; grid-template-columns: 10ch minmax(0, 1fr) 7ch; align-items: center; gap: 10px; font-size: .8rem; color: var(--tx-mut); }
  .knob-row output { text-align: right; color: var(--tx-val); font-size: .74rem; }

  .ramp { display: grid; grid-template-columns: repeat(15, minmax(0, 1fr)); height: 18px; border: 1px solid var(--line-1); }
  /* A fixed slot that never wraps or clips: each ratio a label over its
     number, then the safety hue note across the slot. Its shape follows the
     slot's width only, never the digits: under 15em the three ratios cannot
     sit side by side and take one line each. */
  .ratios { container-type: inline-size; line-height: 1.45; font-size: .74rem; color: var(--tx-val); }
  .ratio-grid {
    display: grid;
    grid-template-columns: repeat(3, max-content) minmax(0, 1fr);
    column-gap: 20px;
    height: calc(3 * 1.45em);
  }
  .ratio { display: flex; flex-direction: column; white-space: nowrap; }
  .rk { color: var(--tx-mut); }
  .near { grid-column: 1 / -1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @container (max-width: 15em) {
    .ratio-grid { grid-template-columns: max-content minmax(0, 1fr); column-gap: 8px; height: calc(4 * 1.45em); }
    .ratio { display: contents; }
  }

  .adv summary { display: flex; align-items: center; gap: 10px; min-height: var(--tap); cursor: pointer; }
  .adv summary h2 { margin: 0; font-size: .8rem; font-weight: 500; text-transform: uppercase; letter-spacing: .12em; color: var(--tx-val); }
  .tokens { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: .72rem; }
  .tokens li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
  .tokens .tk { flex: 0 0 18ch; color: var(--tx-val); overflow-wrap: anywhere; }
  /* One line per row: a long value ellipsizes and rides its title. */
  .tokens .derived { flex: 1 1 14ch; min-width: 0; color: var(--tx-mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tokens .derived[data-phase='fault'] { color: var(--warn-ink); }
  .tokens li.pinned .tk { color: var(--highlight); }
  .tokens input { flex: 1 1 14ch; min-width: 12ch; padding: 4px 6px; font-size: .72rem; }

  textarea {
    width: 100%;
    min-height: var(--tap);
    padding: 6px 8px;
    border-radius: var(--r-s);
    border: 1px solid var(--line-1);
    background: var(--bg-sunken);
    box-shadow: inset 0 2px 5px rgba(var(--shade-rgb), .6);
    color: var(--tx-val);
    resize: vertical;
    font-size: .72rem;
  }
  textarea:focus { outline: none; border-color: var(--highlight); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }

  .og-switch { min-height: var(--tap); font-size: .8rem; align-self: flex-start; }
  .cls { color: var(--reality); text-transform: uppercase; letter-spacing: .06em; }
</style>
