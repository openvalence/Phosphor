/**
 * material.svelte.js -- the OS material under the window for the Mica and Liquid Glass
 * Themes (docs/THEMES.md, Materials). The shell gives it the Rust command
 * (src-tauri/src/material.rs); the served page never installs it and stays opaque.
 *
 * Constraints:
 * - The window is created transparent on Windows and macOS; this chooses what shows
 *   through. Every other Theme paints an opaque body, so no other theme changes.
 * - `html[data-material]` is set only while the OS material is really there, so a Theme's
 *   transparent rules never meet a bare transparent window: Windows 10 (no Mica), Linux,
 *   Android and the browser answer "none" and keep the opaque look.
 * - Page fullscreen, the OS's reduced-transparency setting, a theme without a
 *   material and the wallpaper layer (html[data-wall]: opaque, so the material would
 *   only cost Acrylic's slow drags) all take the material away; fullscreen media never plays over a see-through
 *   window.
 * - Browser or desktop preference only: nothing here reaches the hub.
 */
import { onTheme, currentTheme, themeMeta } from './theme.js';

/** What is applied right now: 'mica', 'mica-light', 'mica-alt', 'acrylic', 'glass', 'vibrancy' or 'none'. */
export const material = $state({ applied: 'none', wanted: null });

let invoke = null;
let busy = Promise.resolve();
let last = '';

const root = () => document.documentElement;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches;

/** The material the active Variant asks for (its own `material`, else its Theme's), or null. */
function asked() {
  const t = currentTheme(), m = themeMeta(t.style);
  const v = m && t.variant ? m.variants.find((x) => x.id === t.variant) : null;
  return (v && 'material' in v ? v.material : m?.material) || null;
}

/** What to ask the window for: none while fullscreen, on the wallpaper or when the OS asks for less. */
function wanted() {
  if (root().hasAttribute('data-page-full') || root().hasAttribute('data-wall') || reduced()) return null;
  return asked();
}

function sync() {
  const want = wanted();
  material.wanted = asked();
  if (!invoke || want === last) return;
  last = want;
  busy = busy.then(async () => {
    let got = 'none';
    try { got = await invoke('window_material', { kind: want || 'none' }); } catch (e) { got = 'none'; }
    if (want !== last) return;
    material.applied = got;
    if (want && got !== 'none') root().dataset.material = got; else delete root().dataset.material;
  });
}

/** Shell only: `invoke` is Tauri's. Re-reads on every theme, fullscreen and transparency change. */
export function installMaterial(tauriInvoke) {
  invoke = tauriInvoke;
  onTheme(sync);
  new MutationObserver(sync).observe(root(), { attributes: true, attributeFilter: ['data-page-full', 'data-wall'] });
  if (typeof matchMedia === 'function') matchMedia('(prefers-reduced-transparency: reduce)').addEventListener('change', sync);
  sync();
}
