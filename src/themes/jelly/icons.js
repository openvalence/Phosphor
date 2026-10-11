import { color, st, stockIcons } from '../kit.js';

/** Jelly: each glyph in white on a blue gel orb with a specular cap and a bright bounce. */
export default stockIcons((d) => color(
  '<defs>'
  + '<radialGradient id="b" cx=".5" cy=".92" r=".95"><stop offset="0" stop-color="#8FC6FF"/><stop offset=".45" stop-color="#3F8AEE"/><stop offset="1" stop-color="#1650BA"/></radialGradient>'
  + '<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>'
  + '</defs>'
  + '<circle cx="8" cy="8.3" r="7.2" fill="#0B2E78" opacity=".25"/>'
  + '<circle cx="8" cy="8" r="7.2" fill="url(#b)" stroke="#0E3F96" stroke-width=".6"/>'
  + '<path d="M2.9 6.3C3.4 3.7 5.4 2.1 8 2.1s4.6 1.6 5.1 4.2C11.7 5.2 9.9 4.7 8 4.7S4.3 5.2 2.9 6.3Z" fill="url(#h)"/>'
  + '<g transform="translate(3 3.3) scale(.62)"><path d="' + d + '"' + st('#fff', 2.1) + '/></g>'));
