/**
 * defer.js -- Alt held during a pointer drag defers a continuous control's
 * write to the release (docs/EFFECTS.md, "Alt-drag").
 *
 * Constraints:
 * - Read at every move, so pressing or releasing Alt mid-drag switches
 *   from that moment. Keyboard input never defers.
 * - A touch pointer never defers: touch has no Alt.
 * - Window capture phase: a control that stops propagation still updates it.
 */
let alt = false;
if (typeof window !== 'undefined') {
  const track = (e) => { alt = e.altKey; };
  for (const t of ['keydown', 'keyup', 'pointerdown', 'pointermove']) window.addEventListener(t, track, true);
  window.addEventListener('blur', () => { alt = false; });
}

/** Should a move of this pointer hold its value instead of writing it? */
export const deferring = (e) => !!e && e.pointerType !== 'touch' && alt;
