<script>
  /**
   * HeroStrip.svelte — thin layout container for hero widgets.
   *
   * Knows nothing about what a "hero" is beyond {id, component, fields}: the
   * registry in heroes.js decides which components exist and what roles they
   * claimed, this file only arranges whatever it is handed. If a machine
   * publishes none of the roles any hero wants, `heroes` arrives empty and this
   * renders nothing — a bare settings page is the correct, honest result for
   * that machine, not an error state.
   */
  // `accessory` is a layout snippet forwarded to the FIRST hero only — the
  // instrument hero's row carries the transport controls (OG .hero-row).
  // This strip stays ignorant of what the snippet contains.
  import { prefs } from '../model/prefs.js';
  import { heroBar, isCollapsed } from './hero/heroBar.svelte.js';

  let { heroes, accessory = null } = $props();
  // The rail stays mounted while hidden: railReadout() keeps feeding the numerals.
  const collapsed = $derived(isCollapsed($prefs));
  // The rail's natural height, whatever the collapse is doing: the slots' own
  // boxes plus the bar's padding. The budget reads it, never the animated box.
  let inner = $state(null);
  $effect(() => {
    if (!inner) return;
    const measure = () => {
      if (heroBar.popup) return;   // the pop-up sets the slot's own box
      const kids = [...inner.children], g = parseFloat(getComputedStyle(inner).rowGap) || 0;
      heroBar.slotH = kids.reduce((a, e) => a + e.offsetHeight, 0);
      heroBar.railH = kids.reduce((a, e) => a + e.offsetHeight, 0) + Math.max(0, kids.length - 1) * g + 2 * g + 1;
    };
    const ro = new ResizeObserver(measure);
    for (const k of inner.children) ro.observe(k);
    measure();
    return () => ro.disconnect();
  });
</script>

{#if heroes && heroes.length}
  <div class="hero-strip" class:collapsed>
    <div class="hero-inner" class:popup={heroBar.popup} inert={collapsed && !heroBar.popup} style:--rh={heroBar.slotH + 'px'} bind:this={inner}>
      {#each heroes as hero, i (hero.id)}
        <div class="hero-slot" data-hero={hero.id}>
          <hero.component fields={hero.fields} accessory={i === 0 ? accessory : null} />
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .hero-strip {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows var(--t-move);
    /* One surface with the top bar, whose bottom border is the divider; full
       bleed through .app's side padding like .topstrip. */
    margin: 0 calc(var(--app-pad, var(--gap)) * -1);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line);
  }
  .hero-inner { min-height: 0; display: grid; grid-template-columns: 1fr; gap: var(--gap); padding: var(--gap); }
  /* Collapsed: no height, no divider (the top bar's border stays). */
  .hero-strip.collapsed { grid-template-rows: 0fr; border-bottom-width: 0; }
  .collapsed .hero-inner { overflow: hidden; visibility: hidden; padding-block: 0; }
  /* Handheld pop-up (buckets 1-2): the one rail instance, rotated so travel
     runs top to bottom, in a box under the top bar. */
  .hero-inner.popup, .collapsed .hero-inner.popup {
    position: fixed;
    top: calc(var(--strip-h, 0px) + var(--gap));
    right: var(--gap);
    z-index: 40;
    display: block;
    visibility: visible;
    overflow: visible;
    box-sizing: content-box;
    --pl: min(440px, calc(100dvh - var(--strip-h, 0px) - 4 * var(--gap)));
    width: var(--rh);
    height: var(--pl);
    padding: var(--gap);
    background: var(--bg-raised);
    border: 1px solid var(--line-2);
    border-radius: var(--r-s);
    box-shadow: 0 8px 24px rgba(0, 0, 0, .6);
  }
  .popup .hero-slot {
    width: var(--pl);
    height: var(--rh);
    transform-origin: 0 0;
    transform: translateX(var(--rh)) rotate(90deg);
  }

  .hero-slot {
    min-width: 0; /* let sliders/rails shrink instead of forcing horizontal scroll */
  }

  /* ONE column at every width — do not reintroduce a multi-column grid here.
     The OG had no hero grid at all: every instrument was a full-bleed row
     (og style.css .hero-strip/.hero-row), and a hero is an instrument you read
     across, not a dashboard tile that tolerates being a third as wide. */
</style>
