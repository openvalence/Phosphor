<script>
  /**
   * CreditLine.svelte -- one credit: "<lead><name> . <license>", the name a
   * link to its source when it has one (Plugins pane row, About notices).
   *
   * Constraints:
   * - The link leaves the app through ExtLink (the shared confirm, then the
   *   system browser); nothing here navigates.
   */
  import ExtLink from '../ui/ExtLink.svelte';

  let { credit, lead = '' } = $props();
</script>

<span class="credit">{lead}{#if credit.url}<ExtLink href={credit.url} text={credit.name} />{:else}{credit.name}{/if}{#if credit.license}{' · ' + credit.license}{/if}</span>

<style>
  .credit { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0 var(--sp-2); }
</style>
