/**
 * logview.svelte.js — which LogPane feed is open, and when Safety was last read.
 *
 * Constraints: LogPane.svelte is the only writer of `safetySeenAt` (it stamps
 * it while the Safety feed is on screen); TopStrip.svelte reads it for the
 * strip's unread count and sets `tab` to open that feed.
 */

export const logView = $state({ tab: 'log', safetySeenAt: 0 });
