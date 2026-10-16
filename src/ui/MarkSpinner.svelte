<script>
  /**
   * MarkSpinner.svelte -- the mark's phosphor loop (ui/mark-anim.js) at text size, beside a
   * status line that says what is loading. Decorative: the text carries the meaning.
   *
   * Constraints:
   * - Only while something is loading: the caller renders it for those phases and no others.
   * - html.still (ui/still.svelte.js) holds the resting mark: no motion, no glow.
   * - Colors are the tokens: --intent the arcs, --reality the core and electrons, --bg decides
   *   whether the glow adds light (dark chassis) or tints (light chassis).
   * - ui/mark-anim.js is a copy of openvalence.github.io/mark-anim.js; edit there first.
   */
  import { onMount } from 'svelte';
  import { phosphor } from './mark-anim.js';
  import { still } from './still.svelte.js';
  import { onTheme } from '../model/theme.js';

  let { size = '1.45em' } = $props();
  let host;
  let anim = $state(null);

  onMount(() => {
    const m = phosphor(host);
    anim = m;
    // a theme's tokens land after its event: read them on the next frame
    const off = onTheme(() => requestAnimationFrame(() => m.refresh()));
    return () => { off(); m.destroy(); };
  });
  $effect(() => {
    if (!anim) return;
    if (still.on) anim.stop(true); else anim.play();
  });
</script>

<span class="mark-spin" bind:this={host} style:--size={size} aria-hidden="true"></span>

<style>
  .mark-spin {
    display: inline-block;
    flex: none;
    width: var(--size);
    height: var(--size);
    vertical-align: middle;
    --mark-ring: var(--intent);
    --mark-core: var(--reality);
    --mark-bg: var(--bg);
  }
</style>
