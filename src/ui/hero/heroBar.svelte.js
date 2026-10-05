/**
 * heroBar.svelte.js: the hero bar's shared form. `form` is 'full' (the rail in
 * the bar) or 'mini' (the 64 px mini stands in for it); `popup` is the
 * handheld vertical rail's open state. Written by TopStrip and MiniRail only.
 */
export const heroBar = $state({ form: 'full', popup: false });
