import { stockIcons } from '../kit.js';

/** Liquid Glass: the stock glyphs heavier, with a faint offset copy for depth. */
export default stockIcons((d) => '<path d="' + d + '" stroke-width="1.9"/><path d="' + d + '" transform="translate(0 .7)" stroke-width="1.9" opacity=".28"/>');
