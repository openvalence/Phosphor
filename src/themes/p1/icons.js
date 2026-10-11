/** Vector-display line art: straight strokes, square ends, mitered corners, drawn on the 16-unit grid. */
const L = (d) => '<path d="' + d + '" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="8"/>';
const R = (x, y, w, h) => 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h) + 'H' + x + 'Z';

export default {
  machine: L(R(2, 2, 12, 8) + 'M5 14H11M8 10V14'),
  generator: L('M1 11H4V5H8V11H12V5H15'),
  motion: L('M1 8H15M4 5L1 8L4 11M12 5L15 8L12 11'),
  safety: L('M8 1L14 3V8L8 15L2 8V3Z M8 5V9M8 11V12'),
  limits: L('M2 3V13M14 3V13M5 8H11M7 6L5 8L7 10M9 6L11 8L9 10'),
  playback: L('M4 2L13 8L4 14Z'),
  auxiliary: L(R(2, 2, 12, 12) + 'M8 5V11M5 8H11'),
  automation: L('M9 1L3 9H8L7 15L13 7H8Z'),
  hardware: L(R(4, 4, 8, 8) + 'M6 1V4M10 1V4M6 12V15M10 12V15M1 6H4M1 10H4M12 6H15M12 10H15'),
  network: L('M2 14V11M6 14V8M10 14V5M14 14V2'),
  session: L('M5 2H11L14 5V11L11 14H5L2 11V5Z M8 5V8L11 8'),
  system: L('M2 4H14M2 8H14M2 12H14M5 2V6M10 6V10M6 10V14'),
  other: L(R(2, 2, 5, 5) + R(9, 2, 5, 5) + R(2, 9, 5, 5) + R(9, 9, 5, 5)),
  setup: L('M2 3H4M7 3H14M2 8H4M7 8H14M2 13H4M7 13H14'),
  pairing: L(R(1, 5, 6, 6) + R(9, 5, 6, 6) + 'M7 8H9'),
  valence: L('M2 3L8 13L14 3M5 3H11'),
  log: L('M2 3H14M2 7H14M2 11H9'),
  display: L(R(1, 2, 14, 9) + 'M5 14H11M8 11V14'),
  plugins: L('M5 1V5M11 1V5M3 5H13V9L10 12H6L3 9Z M8 12V15'),
  hubs: L(R(6, 1, 4, 4) + R(1, 11, 4, 4) + R(11, 11, 4, 4) + 'M8 5V8M3 11V8H13V11'),
  server: L(R(2, 2, 12, 5) + R(2, 9, 12, 5) + 'M4.5 4.5H5.5M4.5 11.5H5.5'),
  settings: L('M4 2V14M8 2V14M12 2V14M2 5H6M6 10H10M10 6H14'),
  merge: L('M2 2L8 8L14 2M8 8V14'),
  about: L(R(2, 2, 12, 12) + 'M8 7V11M8 4.5V5'),
};
