/**
 * chipalign.js -- a card body's typeable value chips share one width: the
 * widest `input.chip-num[data-chars]` inside, published as --chip-w (ch) so
 * the right-aligned boxes of one card line up (Field.svelte reads it).
 */
export function chipalign(node) {
  const set = () => {
    const n = Math.max(0, ...[...node.querySelectorAll('input.chip-num[data-chars]')].map((i) => Number(i.dataset.chars)));
    node.style.setProperty('--chip-w', n + 'ch');
  };
  const mo = new MutationObserver(set);
  mo.observe(node, { childList: true, subtree: true });
  set();
  return { destroy: () => mo.disconnect() };
}
