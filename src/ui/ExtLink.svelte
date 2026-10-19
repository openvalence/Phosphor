<script>
  /**
   * ExtLink.svelte -- a link that leaves the app: its text, the external mark,
   * the tip "Open link", and a click that asks first (external.js).
   *
   * Constraints:
   * - Every external link renders through this; nothing navigates directly.
   */
  import { openExternal } from './external.js';

  let { href, text, target = '_blank', class: cls = '' } = $props();
</script>

<a class={'ext ' + cls} {href} {target} rel="noopener" data-tip="Open link"
   onclick={(e) => { e.preventDefault(); openExternal(href, target); }}>{text}<svg class="ext-mark" viewBox="0 0 12 12" aria-hidden="true"><path d="M5 2H2v8h8V7M7 2h3v3M10 2 5.5 6.5" /></svg></a>

<style>
  .ext { display: inline-flex; align-items: center; gap: .3em; color: var(--intent); }
  @media (pointer: coarse) { .ext { min-height: var(--tap); } }
  .ext-mark { width: .8em; height: .8em; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; flex: none; }
</style>
