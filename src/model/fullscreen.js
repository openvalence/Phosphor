/**
 * fullscreen.js -- page fullscreen (docs/DESIGN.md §10.3): a plugin page
 * takes the window below the top strip; the caret hides the bar and strip,
 * never the stop pair (RENDERING §8.4 row 11; TopStrip's `bare`).
 *
 * Constraints:
 * - Pure, so test/prefs.test.mjs runs it under node.
 * - The state is never persisted; the mode is (prefs.js `fullscreen`).
 */
export const OFF = Object.freeze({ on: false, bare: false });
/** Enter In window, or bare for a media page (mediaFullscreen: one mode, DESIGN §10.3). */
export const toggle = (s, bare = false) => (s.on ? OFF : { on: true, bare: !!bare });
export const toggleBar = (s) => (s.on ? { on: true, bare: !s.bare } : s);
/** The window itself goes fullscreen: borderless mode, desktop shell only. */
export const osFullscreen = (s, mode, desktopShell) => s.on && mode === 'borderless' && !!desktopShell;
