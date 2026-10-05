/**
 * scrollshade.js -- the scroll recess (DESIGN §10.3): a Svelte action that
 * marks a scroller `data-shade`, plus `data-shade-top` while it can scroll up
 * and `data-shade-bottom` while it can scroll down. style.css draws the
 * shadows and hides the scrollbar unless the `scrollbars` pref is on.
 *
 * Constraints:
 * - `use:scrollshade={on}`: false unmarks the node (a pane that only scrolls
 *   in fullscreen).
 * - Watches the node's direct children only; a child's own growth reaches
 *   it through that child's box.
 */
export function scrollshade(node, on = true) {
  let raf = 0;
  const update = () => {
    raf = 0;
    const { scrollTop, clientHeight, scrollHeight } = node;
    // Hysteresis: on past 2 px, off under 0.5 px, held between, so the last
    // pixel of an edge never flickers.
    const hold = (name, left) => node.toggleAttribute(name, left > 2 || (left >= 0.5 && node.hasAttribute(name)));
    hold('data-shade-top', scrollTop);
    hold('data-shade-bottom', scrollHeight - scrollTop - clientHeight);
  };
  const queue = () => { raf ||= requestAnimationFrame(update); };
  const ro = new ResizeObserver(queue);
  const watch = () => {
    ro.disconnect();
    ro.observe(node);
    for (const c of node.children) ro.observe(c);
    queue();
  };
  const mo = new MutationObserver(watch);
  const set = (v) => {
    node.removeEventListener('scroll', queue);
    mo.disconnect();
    ro.disconnect();
    cancelAnimationFrame(raf);
    raf = 0;
    for (const a of ['data-shade', 'data-shade-top', 'data-shade-bottom']) node.removeAttribute(a);
    if (!v) return;
    node.setAttribute('data-shade', '');
    node.addEventListener('scroll', queue, { passive: true });
    mo.observe(node, { childList: true });
    watch();
  };
  set(on);
  return { update: set, destroy: () => set(false) };
}
