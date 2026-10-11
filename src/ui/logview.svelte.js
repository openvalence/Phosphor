/**
 * logview.svelte.js — which LogPane feed is open, and when Safety was last read.
 *
 * Constraints: LogPane.svelte is the only writer of `safetySeenAt` (it stamps
 * it while the Safety feed is on screen); TopStrip.svelte reads it for the
 * strip's unread count and sets `tab` to open that feed. `find` is a search
 * to open the page with (ValencePane.svelte's Log link sets a NACK code
 * name); LogPane.svelte takes it into its search and empties it.
 */

export const logView = $state({ tab: 'log', safetySeenAt: 0, find: '' });
