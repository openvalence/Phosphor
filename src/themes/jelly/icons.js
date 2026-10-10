import { color, st, stockIcons } from '../kit.js';

/** Jelly: each glyph in white on a glossy blue blob with a specular arc. */
export default stockIcons((d) => color(
  '<defs><linearGradient id="j" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DB8FF"/><stop offset=".5" stop-color="#2F7BE8"/><stop offset="1" stop-color="#1448B8"/></linearGradient></defs>'
  + '<circle cx="8" cy="8" r="7.4" fill="url(#j)" stroke="#0F3C94" stroke-width=".6"/>'
  + '<ellipse cx="8" cy="4.4" rx="5" ry="2.6" fill="#fff" opacity=".42"/>'
  + '<g transform="translate(2.8 2.8) scale(.65)"><path d="' + d + '"' + st('#fff', 2) + '/></g>'));
