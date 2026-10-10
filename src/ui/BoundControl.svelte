<script module>
  import { mount, unmount } from 'svelte';
  import BoundControl from './BoundControl.svelte';
  /** kit.js bindControls (main.js): the rendering behind api.ui.field and api.ui.module. */
  export function mountBound(el, spec) {
    const c = mount(BoundControl, { target: el, props: { el, ...spec } });
    return () => unmount(c);
  }
</script>

<script>
  /**
   * BoundControl.svelte -- api.ui.field and api.ui.module (kit.js, ph-5wsk.6):
   * the control an identity names (model/identity.js), drawn by the same
   * components the pages use, so every RENDERING law and the normal write
   * path come with it.
   *
   * Constraints:
   * - Resolved live: a catalog change re-resolves. A key the catalog lacks
   *   draws one quiet row and marks the element data-missing.
   * - The rail is never a second copy (DESIGN 10.3): an instrument hero draws
   *   the mini rail, and a press opens the hero's own rail.
   * - kind 'field' draws a field only; any other identity reads as missing.
   */
  import Control from './widgets/Control.svelte';
  import Field from './Field.svelte';
  import ActionField from './ActionField.svelte';
  import TelemetryChart from './widgets/TelemetryChart.svelte';
  import MiniRail from './hero/MiniRail.svelte';
  import { cardbody } from './cardbody.js';
  import { heroClaims } from './heroes.js';
  import { heroBar } from './hero/heroBar.svelte.js';
  import { machine, specSafetyAction } from '../model/machine.svelte.js';
  import { WIDGET } from '../model/settings.js';
  import { resolveIdentity } from '../model/identity.js';
  import { view } from '../model/viewport.svelte.js';
  import { setPref } from '../model/prefs.js';
  import { pluginsUi, pluginHeroes } from '../plugins/plugins.svelte.js';

  let { el, key, kind = 'module', title = '' } = $props();
  const model = $derived(machine.catalog.model);
  const heroes = $derived(model ? heroClaims(model.byRole, (pluginsUi.gen, pluginHeroes())) : null);
  const found = $derived.by(() => {
    const r = resolveIdentity(model, heroes, key, specSafetyAction());
    return r && (kind !== 'field' || r.kind === 'field') ? r : null;
  });
  $effect(() => { el.toggleAttribute('data-missing', !found); });

  // TopStrip showRail: the vertical pop-up on a handheld, else the hidden rail shown in the bar.
  function showRail() {
    if (view.bucket <= 2) { heroBar.popup = !heroBar.popup; return; }
    heroBar.userShow = true;
    setPref('railHidden', false);
  }
</script>

{#if !found}
  <p class="bound-missing">{title ? title + ' · ' : ''}not on this machine</p>
{:else if found.kind === 'telemetry'}
  <TelemetryChart />
{:else if found.kind === 'fields'}
  <div class="card-body" use:cardbody>
    {#each found.fields as f (f.uid)}
      {#if f.widget === WIDGET.action}<ActionField action={f} />{:else}<Field field={f} />{/if}
    {/each}
  </div>
{:else if found.control.hero && found.control.hero.zone === 'instrument'}
  <div class="bound-rail"><MiniRail onshow={showRail} /></div>
{:else}
  <Control control={found.control} w={8} h={2} />
{/if}

<style>
  .bound-missing {
    margin: 0;
    min-height: var(--tap);
    display: flex;
    align-items: center;
    font-size: .78rem;
    color: var(--tx-mut);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* The mini rail spans the tray: one live strip, a press opens the hero rail. */
  .bound-rail :global(.mini) { width: 100%; }
</style>
