import { NAMES } from '../kit.js';

/**
 * Material: the registry drawn at the weight and roundness of Material Symbols Rounded, in
 * our own paths: 1.7 strokes with round caps, solid fills where the symbol is solid (play,
 * the drop, a person, the dots). Masks, painted in the control's text color.
 */
const S = (d, w = 1.7) => '<path d="' + d + '" stroke-width="' + w + '"/>';
const F = (inner) => '<g fill="#000" stroke="none">' + inner + '</g>';
const dot = (cx, cy, r = 1) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>';

const SET = {
  machine: F('<rect x="2" y="2" width="5" height="7" rx="1.3"/><rect x="9" y="2" width="5" height="4" rx="1.3"/><rect x="2" y="11" width="5" height="3" rx="1.3"/><rect x="9" y="8" width="5" height="6" rx="1.3"/>'),
  generator: S('M2.5 6.5v3M5.25 4v8M8 2.5v11M10.75 5v6M13.5 7v2', 1.8),
  motion: S('M2.5 5.5h10M10 3l2.7 2.5L10 8M13.5 10.5h-10M6 8l-2.7 2.5L6 13'),
  safety: S('M8 1.9l5 1.9v3.8c0 3-2.1 5.1-5 6.5-2.9-1.4-5-3.5-5-6.5V3.8z') + S('M5.7 8l1.7 1.7 3-3.3', 1.6),
  limits: S('M3 2.5h10M3 13.5h10M8 5.2v5.6M6.1 7.1L8 5.2l1.9 1.9M6.1 8.9L8 10.8l1.9-1.9'),
  playback: F('<path d="M5 3.5v9c0 .62.68 1 1.2.64l6.6-4.5c.44-.3.44-.98 0-1.28L6.2 2.86C5.68 2.5 5 2.88 5 3.5z"/>'),
  auxiliary: F('<path d="M8 1.6c2.7 3.1 4.3 5.1 4.3 7.3a4.3 4.3 0 0 1-8.6 0c0-2.2 1.6-4.2 4.3-7.3z"/>'),
  automation: S('M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2z') + S('M8 4.9V8l2.1 1.5'),
  hardware: S('M5 4.5h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z', 1.6) + S('M6.8 2v2.5M9.2 2v2.5M6.8 11.5V14M9.2 11.5V14M2 6.8h2.5M2 9.2h2.5M11.5 6.8H14M11.5 9.2H14', 1.6) + F('<rect x="6.6" y="6.6" width="2.8" height="2.8" rx=".6"/>'),
  network: S('M1.9 6.2a8.6 8.6 0 0 1 12.2 0M4.1 8.6a5.4 5.4 0 0 1 7.8 0M6.3 11a2.2 2.2 0 0 1 3.4 0') + F(dot(8, 12.6, 1.1)),
  session: F(dot(8, 5, 2.7) + '<path d="M2.8 13.4c0-2.4 2.3-3.9 5.2-3.9s5.2 1.5 5.2 3.9v.2H2.8z"/>'),
  system: S('M1.5 8.6h3l1.6-4.6 3 7.6 1.6-3h3.8'),
  other: F([3.5, 8, 12.5].flatMap((x) => [3.5, 8, 12.5].map((y) => dot(x, y, 1.15))).join('')),
  setup: S('M2.4 4.5l1.3 1.3 2.4-2.6M2.4 10.5l1.3 1.3 2.4-2.6M8.6 4.8h5M8.6 10.8h5'),
  pairing: S('M5 5.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z') + S('M7.7 8h6.6M12 8v2.3M14 8v1.7'),
  valence: S('M6.7 9.3l2.6-2.6M7.2 5L8.5 3.7a2.6 2.6 0 0 1 3.8 3.8L11 8.8M8.8 11L7.5 12.3a2.6 2.6 0 0 1-3.8-3.8L5 7.2'),
  log: S('M2.5 4h11M2.5 8h11M2.5 12h7', 1.8),
  display: S('M3.6 2.8h8.8c.9 0 1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6H3.6c-.9 0-1.6-.7-1.6-1.6V4.4c0-.9.7-1.6 1.6-1.6z') + S('M5.5 13.6h5M8 11.2v2.4'),
  plugins: S('M6 2v3M10 2v3M4.5 5h7v2.8A3.5 3.5 0 0 1 8 11.3 3.5 3.5 0 0 1 4.5 7.8zM8 11.3V14'),
  hubs: S('M3.6 2.8h8.8c.7 0 1.3.6 1.3 1.3v1.5c0 .7-.6 1.3-1.3 1.3H3.6c-.7 0-1.3-.6-1.3-1.3V4.1c0-.7.6-1.3 1.3-1.3zM3.6 9.2h8.8c.7 0 1.3.6 1.3 1.3V12c0 .7-.6 1.3-1.3 1.3H3.6c-.7 0-1.3-.6-1.3-1.3v-1.5c0-.7.6-1.3 1.3-1.3z', 1.6) + F(dot(5, 4.85, .9) + dot(5, 11.25, .9)),
  server: S('M4.9 12.6h6.2a2.8 2.8 0 0 0 .6-5.5 3.9 3.9 0 0 0-7.4-.7A3.1 3.1 0 0 0 4.9 12.6z'),
  settings: S('M2.5 4.5h5.8M11.9 4.5h1.6M2.5 11.5h1.6M7.7 11.5h5.8') + S('M10.1 2.9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM5.9 9.9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z', 1.6),
  merge: S('M4 2.5V6c0 2 4 2 4 4v3.5M12 2.5V6c0 2-4 2-4 4'),
  about: S('M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2z') + S('M8 7.3v3.4', 1.8) + F(dot(8, 5.2, 1)),
};

export default Object.fromEntries(NAMES.filter((n) => SET[n]).map((n) => [n, SET[n]]));
