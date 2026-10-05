<script>
  /**
   * MiniRail.svelte: the rail's 64 px stand-in while it is hidden. Display
   * only: the band and the live position, never jog input. Pressing it asks
   * for the rail back (`onshow`).
   */
  import { railReadout } from './RailWidget.svelte';

  let { onshow } = $props();
  const r = $derived(railReadout());
  const l = $derived(r && r.haveWindow ? r.bandL * 100 : 0);
  const w = $derived(r && r.haveWindow ? (r.bandR - r.bandL) * 100 : 100);
  const at = $derived(r ? r.posFrac : null);
</script>

<button type="button" class="mini" aria-label="Show rail" title={onshow ? 'Show rail' : 'Window too short for the rail'} disabled={!onshow} onclick={onshow}>
  <span class="plate">
    <span class="band" style="left:{l}%; width:{w}%"></span>
    {#if at != null}<span class="pos" style="left:{at * 100}%"></span>{/if}
  </span>
</button>

<style>
  .mini {
    flex: none;
    width: 64px;
    min-height: var(--tap);
    padding: 0;
    display: flex;
    align-items: center;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .plate {
    position: relative;
    width: 100%;
    height: 28px;
    background: var(--screen);
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    overflow: hidden;
  }
  .band {
    position: absolute;
    top: 6px;
    bottom: 6px;
    background: rgba(var(--intent-deep-rgb), .16);
    border-left: 1px solid var(--intent);
    border-right: 1px solid var(--intent);
  }
  .pos {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-1px);
    background: var(--intent);
    box-shadow: 0 0 6px rgba(var(--intent-rgb), .7);
  }
  .mini:focus-visible { outline: 2px solid var(--intent); outline-offset: 2px; }
</style>
