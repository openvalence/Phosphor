import { stockIcons } from '../kit.js';

/** Liquid Glass: each stock glyph as a thin line inside a wide, faint copy of itself: a glass tube with a lit core. */
export default stockIcons((d) => '<path d="' + d + '" stroke-width="3.6" opacity=".22"/><path d="' + d + '" stroke-width="1.5"/>');
