/**
 * rename.js -- the one rename gesture for every user-given name (DESIGN §10.6):
 * F2 on a focused name or a double-click on it opens its input with the text
 * selected; Enter keeps, Escape reverts and writes nothing, blur keeps.
 *
 * Constraints:
 * - `nameInput` goes on the input; the commit stays the input's own `change`
 *   handler, so a reverted or unchanged name fires nothing.
 * - `opensName` goes on the name's host; `find` returns the input (or null).
 */
export function nameInput(node) {
  let was = node.value;
  const arm = () => { was = node.value; };
  const key = (e) => {
    if (e.key === 'Enter') node.blur();
    else if (e.key === 'Escape') { e.stopPropagation(); node.value = was; node.blur(); }
  };
  node.addEventListener('focus', arm);
  node.addEventListener('keydown', key);
  return { destroy() { node.removeEventListener('focus', arm); node.removeEventListener('keydown', key); } };
}

export function opensName(node, find) {
  const open = (e) => {
    const input = find(node, e);
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  };
  const key = (e) => { if (e.key === 'F2' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) open(e); };
  node.addEventListener('keydown', key);
  node.addEventListener('dblclick', open);
  return { destroy() { node.removeEventListener('keydown', key); node.removeEventListener('dblclick', open); } };
}
