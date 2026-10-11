// back.js -- what one Android back press does (DESIGN §10.12, operator 2026-10-11), first match wins:
// close what is on top (an overlay, then page fullscreen, then the menu drawer while there is a
// page to return to), leave a drill-in page, return to the previous page, open the menu, arm the
// exit with a notice, exit through the close gate.
//
// Constraints:
// - Pure: App reads the state and runs the action; node tests drive it directly.
// - Never a motion command and never a release of the stop pair: no action here writes to the
//   machine, and 'exit' goes through the shell's close gate (the hold while it is busy).

export const EXIT_ARM_MS = 2000;

/**
 * s: { overlay, full, menuOpen, drill, history (pages to return to), armedAt (ms or 0), now (ms) }.
 * Returns 'dismiss' | 'unfull' | 'close-menu' | 'undrill' | 'previous' | 'menu' | 'exit' | 'arm'.
 */
export function backAction(s) {
  if (s.overlay) return 'dismiss';
  if (s.full) return 'unfull';
  const root = !s.drill && !s.history;
  if (s.menuOpen && !root) return 'close-menu';
  if (s.drill) return 'undrill';
  if (s.history) return 'previous';
  if (!s.menuOpen) return 'menu';
  return s.armedAt && s.now - s.armedAt < EXIT_ARM_MS ? 'exit' : 'arm';
}
