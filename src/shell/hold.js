/**
 * hold.js -- the press-and-hold gesture for destructive rail controls (page
 * reset, layout delete). `use:hold={{ ms, onfire, disabled, key }}`.
 *
 * Constraints:
 * - Primary button, finger, or Enter/Space held only; a release, leave,
 *   blur, a changed `key` or the node leaving the page before `ms` fires
 *   nothing (WebKit does not blur a removed node, so destroy() clears the
 *   timer itself).
 * - Sets `holding` on the node for the fill; no context menu, no selection.
 */
export function hold(node, opts) {
  let o = opts;
  let timer = 0;
  const stop = () => { clearTimeout(timer); timer = 0; node.classList.remove('holding'); };
  const start = () => {
    if (timer || o.disabled) return;
    node.classList.add('holding');
    timer = setTimeout(() => { stop(); o.onfire(); }, o.ms ?? 1000);
  };
  const down = (e) => { if (e.button === 0) start(); };
  const key = (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } };
  const keyup = (e) => { if (e.key === 'Enter' || e.key === ' ') stop(); };
  const menu = (e) => e.preventDefault();
  node.style.userSelect = 'none';
  node.style.webkitTouchCallout = 'none';
  const on = [['pointerdown', down], ['pointerup', stop], ['pointerleave', stop], ['pointercancel', stop],
    ['blur', stop], ['keydown', key], ['keyup', keyup], ['contextmenu', menu]];
  for (const [t, f] of on) node.addEventListener(t, f);
  return {
    update(n) { if (n.key !== o.key) stop(); o = n; },
    destroy() { stop(); for (const [t, f] of on) node.removeEventListener(t, f); },
  };
}
