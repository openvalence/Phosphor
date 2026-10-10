import { stockIcons } from '../kit.js';

/** Notebook: the stock glyph doubled and offset, as drawn twice with a felt pen. */
export default stockIcons((d) => '<path d="' + d + '" stroke-width="1.9"/><path d="' + d + '" transform="translate(.35 .25) rotate(1.2 8 8)" stroke-width="1" opacity=".55"/>');
