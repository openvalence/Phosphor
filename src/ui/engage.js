/**
 * engage.js -- tap to engage a surface that takes its own wheel, keys and
 * drags (the node editor in a grid card; operator ruling 2026-10-03,
 * ph-n18c, DESIGN 10.6).
 *
 * Constraints:
 * - A click inside engages, not a pointerdown: a touch swipe that scrolls
 *   the page past the surface never engages it.
 * - A pointerdown or wheel outside, or an Escape nothing else took,
 *   disengages. Outside events are never consumed: the click that leaves
 *   still does its own job, with no extra click.
 * - Document capture phase: a control that stops propagation still counts.
 */

/** Calls onchange(true | false) on each change; returns the teardown. */
export function engage(el, onchange) {
  let on = false;
  const set = (v) => { if (v !== on) onchange((on = v)); };
  const inside = (e) => el.contains(e.target);
  const ev = [
    ['click', (e) => { if (inside(e)) set(true); }, true],
    ['pointerdown', (e) => { if (!inside(e)) set(false); }, true],
    ['wheel', (e) => { if (!inside(e)) set(false); }, true],
    ['keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) set(false); }, false],
  ];
  const doc = el.ownerDocument;
  for (const [t, f, capture] of ev) doc.addEventListener(t, f, { capture, passive: true });
  return () => { for (const [t, f, capture] of ev) doc.removeEventListener(t, f, { capture }); };
}
