// rows.js -- the settings rows' one form (PR18): label | control | value chip, Field's voice
// Contract: CONTRACT.md, module player-ui; design: docs/plugins/FUNSCRIPT.md, PR18.
//
// Constraints:
// - No DOM at import time (node imports this module).
// - Field's label and value look are scoped to Field.svelte, so they are restated here, tokens only; the switch
//   is the shell's global .og-switch, the group head the global .card-sub.
// - A row with no setting is not drawn: callers pass a control for every row.

export const CSS = `
.fsp-rows { display: grid; grid-template-columns: minmax(0, 96px) minmax(0, 1fr) max-content; gap: var(--sp-2) var(--sp-3);
  align-items: center; min-width: 0; }
.fsp-rows > .card-sub { grid-column: 1 / -1; margin-top: var(--sp-2); }
.fsp-rl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 .76rem var(--font); letter-spacing: .04em;
  text-transform: lowercase; color: var(--tx-mut); }
.fsp-rows > .og-switch { min-width: 0; min-height: var(--tap); margin: 0; }
.fsp-rows > input[type=range] { width: 100%; min-width: 0; margin: 0; }
.fsp-rows > .og-switch { grid-column: 2 / -1; justify-self: end; }
.fsp-rv { min-width: 8ch; padding: var(--sp-2) var(--sp-2); box-sizing: border-box; font: .76rem var(--mono); font-variation-settings: 'wdth' 90;
  color: var(--tx-hi); text-align: right; white-space: nowrap; background: var(--screen); border: 1px solid var(--line-1); border-radius: var(--r-s); }
`;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

/** The rows' grid with its style; group heads are .card-sub. */
export function rowsBox(label) {
  return h('div', { class: 'fsp-rows', role: 'group', 'aria-label': label }, h('style', { text: CSS }));
}

/** A group head inside the rows. */
export const sub = (text) => h('h4', { class: 'card-sub', text });

/** A slider row: label, range, value chip. -> {input, out} */
export function sliderRow(box, label, { min, max, step, tip = '' }) {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label, ...(tip ? { title: tip } : {}) });
  const out = h('output', { class: 'fsp-rv' });
  box.append(h('span', { class: 'fsp-rl', text: label, ...(tip ? { title: tip } : {}) }), input, out);
  return { input, out };
}

/** A switch row: label, the shell's switch spanning the control and value cells. -> the checkbox */
export function switchRow(box, label, { tip = '' } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  box.append(h('span', { class: 'fsp-rl', text: label, ...(tip ? { title: tip } : {}) }), h('label', { class: 'og-switch', ...(tip ? { title: tip } : {}) }, input, h('span', { class: 'track' })));
  return input;
}
