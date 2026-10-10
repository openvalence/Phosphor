<script>
  /**
   * CreditLine.svelte -- one credit: "<lead><name> . <license>" and a Copy
   * link button (Plugins pane row, About notices).
   *
   * Constraints:
   * - No link opens from here: the shell has no opener permission, so the
   *   URL is copied, never navigated. Add the Tauri opener plugin before
   *   turning the name into an anchor.
   * - The button keeps one width across Copy link and Copied.
   */
  let { credit, lead = '' } = $props();
  let done = $state(false);
  function copy() {
    navigator.clipboard?.writeText(credit.url).then(() => {
      done = true;
      setTimeout(() => { done = false; }, 1500);
    }, () => {});
  }
</script>

<span class="credit">{lead}{credit.name}{#if credit.license}{' · ' + credit.license}{/if}
  {#if credit.url}<button type="button" class="og-btn sm copy" data-tip={credit.url} onclick={copy}>{done ? 'Copied' : 'Copy link'}</button>{/if}</span>

<style>
  .credit { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
  .copy { min-width: 8ch; }
</style>
