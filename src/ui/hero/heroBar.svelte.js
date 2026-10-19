/**
 * heroBar.svelte.js: the hero bar's shared form. `form` is 'full' (the rail in
 * the bar) or 'mini' (the 64 px mini stands in for it); `popup` is the
 * handheld vertical rail's open state; `quick` a page fullscreen's
 * horizontal pop-up (the quick rail, DESIGN §10.3), `quickBottom` its lift
 * off the window's bottom edge. Written by TopStrip, MiniRail and openQuick.
 */
// `stacked`: the horizontal one sits above a page's anchor, part of its fullscreen (ph-7ri8): Escape, back and a tap
// outside leave it to the page.
export const heroBar = $state({ form: 'full', popup: false, quick: false, stacked: false, quickBottom: 0, budget: 0, railH: 0, slotH: 0, userShow: false });

/** The quick rail: one rail instance, opened as the vertical pop-up or the horizontal one above `from` (the page's bar). */
export function openQuick(form, open, from, stacked = false) {
  if (form === 'vertical') { heroBar.popup = open; return; }
  heroBar.stacked = open && stacked;
  // Above `from`, never past the stop pair's bottom edge (--stop-reserve-h, TopStrip).
  // Stacked, it is the compact band at the bottom edge, far below the pair: the hero's own rail height (railH, a phone's
  // full rail) would lift it off the edge.
  if (open && from) {
    const pair = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stop-reserve-h')) || 0;
    const lift = innerHeight - from.getBoundingClientRect().top;
    heroBar.quickBottom = Math.round(Math.max(0, stacked ? lift : Math.min(lift, innerHeight - pair - heroBar.railH - 24)));
  }
  heroBar.quick = open;
}

/** Collapsed: the budget (form) or the user's hide (pref) put the rail away. */
export const isCollapsed = (p) => heroBar.form === 'mini' || (p.railHide && p.railHidden);

/** Away: collapsed and in no pop-up, so the rail is not drawn (HeroStrip hides it, RailWidget skips its canvases). */
export const railAway = (p) => isCollapsed(p) && !heroBar.popup && !heroBar.quick;

/** The hero bar's share of the window height (DESIGN §10.12). */
export const budgetOf = (innerHeight, bucket) => innerHeight * (bucket <= 2 ? 0.45 : 0.33);
