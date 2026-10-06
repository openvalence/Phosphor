/**
 * cardbody.js -- the card body's two measured rules (style.css .card-body):
 * - the typeable value chips inside share one width: the widest
 *   `input.chip-num[data-chars]`, published as --chip-w (ch, Field.svelte);
 * - the last field of each run stretches across the tracks its row leaves
 *   empty, so no card ends in a gutter. Sub-heads (.card-sub) end a run.
 */
export function cardbody(node) {
  const fill = () => {
    const cols = getComputedStyle(node).gridTemplateColumns.split(' ').length;
    const kids = [...node.children];
    for (const k of kids) if (!k.classList.contains('card-sub')) k.style.gridColumn = '';
    if (cols < 2) return;
    let run = 0;
    kids.forEach((k, i) => {
      if (k.classList.contains('card-sub')) { run = 0; return; }
      run++;
      const next = kids[i + 1];
      if (next && !next.classList.contains('card-sub')) return;
      const left = (cols - (run % cols)) % cols;
      if (left) k.style.gridColumn = 'span ' + (left + 1);
    });
  };
  const set = () => {
    const n = Math.max(0, ...[...node.querySelectorAll('input.chip-num[data-chars]')].map((i) => Number(i.dataset.chars)));
    node.style.setProperty('--chip-w', n + 'ch');
    fill();
  };
  const mo = new MutationObserver(set);
  mo.observe(node, { childList: true, subtree: true });
  const ro = new ResizeObserver(fill);
  ro.observe(node);
  set();
  return { destroy: () => { mo.disconnect(); ro.disconnect(); } };
}
