import { color, st } from '../kit.js';

/* Platinum: 16-unit icons with a one-pixel black outline, a white top-left edge and a gray
   bottom-right edge on every body, and a few soft colors (lavender, green, gold, sky). Lines sit on
   half units so they stay crisp. Drawn here; no one else's artwork. */
const K = '#000';
const G1 = '#E6E6EA';   // lit gray
const G2 = '#C4C4CC';   // body gray
const G3 = '#8C8C94';   // shade
const LV = '#A9A9D8';   // lavender
const LVd = '#6E6EB0';
const GN = '#7CC07C';
const GNd = '#3E8A3E';
const GD = '#F0D468';
const GDd = '#B8932A';
const SK = '#86AEE6';
const SKd = '#3F6DB5';
const RD = '#D86A5A';

/** A bevelled body: outline, face, white edge top-left, shade bottom-right. */
const body = (x, y, w, h, fill = G2, r = 0) =>
  '<rect x="' + (x + .5) + '" y="' + (y + .5) + '" width="' + (w - 1) + '" height="' + (h - 1) + '" rx="' + r + '" fill="' + fill + '" stroke="' + K + '"/>'
  + '<path d="M' + (x + 1.5) + ' ' + (y + h - 1.5) + 'V' + (y + 1.5) + 'H' + (x + w - 1.5) + '" fill="none" stroke="#fff"/>'
  + '<path d="M' + (x + 1.5) + ' ' + (y + h - 1.5) + 'H' + (x + w - 1.5) + 'V' + (y + 1.5) + '" fill="none" stroke="' + G3 + '" stroke-opacity=".7"/>';

export default {
  machine: color(
    body(1, 4, 9, 8, G2) + '<rect x="3" y="6" width="5" height="4" fill="' + LV + '" stroke="' + K + '"/>'
    + '<path d="M10.5 8h4.5" stroke="' + K + '" stroke-width="2"/><path d="M10.5 8h4.5" stroke="#fff" stroke-width=".6"/>'
    + '<path d="M10.5 5.5v5" stroke="' + K + '"/><path d="M3 13h2v1.5H3zM7 13h2v1.5H7z" fill="' + G3 + '" stroke="' + K + '" stroke-width=".8"/>'),
  generator: color(
    body(1, 2, 14, 12, '#fff') + '<path d="M2.5 8c1.1-3.6 2.2-3.6 3.3 0s2.2 3.6 3.3 0 2.2-3.6 3.3 0 1.1 1.8 1.6 1.8"' + st(SKd, 1.4) + '/>'),
  motion: color(
    '<path d="M1.5 8l3.5-3.5v2h6v-2L14.5 8 11 11.5v-2H5v2z" fill="' + LV + '" stroke="' + K + '" stroke-linejoin="miter"/>'
    + '<path d="M5.5 7.5h5" stroke="#fff"/>'),
  safety: color(
    '<path d="M8 1.5l5.5 2v4.3c0 3.1-2.3 5.3-5.5 6.7-3.2-1.4-5.5-3.6-5.5-6.7V3.5z" fill="' + SK + '" stroke="' + K + '"/>'
    + '<path d="M8 2.6l4.5 1.6v3.6c0 2.4-1.7 4.2-4.5 5.5z" fill="' + SKd + '" fill-opacity=".45"/>'
    + '<path d="M5.4 8.2l1.9 1.9 3.5-4"' + st('#fff', 1.7) + '/><path d="M5.4 8.2l1.9 1.9 3.5-4" fill="none" stroke="' + K + '" stroke-width=".5" transform="translate(0 .7)"/>'),
  limits: color(
    body(1, 4, 14, 8, GD) + '<path d="M4.5 4.5v3M7.5 4.5v2M10.5 4.5v3M13.5 4.5v2" stroke="' + K + '"/><path d="M3 10h10" stroke="' + GDd + '"/>'),
  playback: color(
    '<circle cx="8" cy="8" r="6.5" fill="' + G2 + '" stroke="' + K + '"/><path d="M4.4 6.4A4.5 4.5 0 0 1 8 3.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>'
    + '<path d="M6.5 5.2v5.6L11 8z" fill="' + GNd + '" stroke="' + K + '" stroke-linejoin="miter"/>'),
  auxiliary: color(
    '<path d="M8 1.5C10.5 4.6 12.5 6.8 12.5 9.5a4.5 4.5 0 0 1-9 0C3.5 6.8 5.5 4.6 8 1.5z" fill="' + SK + '" stroke="' + K + '"/>'
    + '<path d="M5.6 9.6a2.4 2.4 0 0 0 1.6 2.3" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>'),
  automation: color(
    '<circle cx="8" cy="8" r="6.5" fill="#fff" stroke="' + K + '"/><circle cx="8" cy="8" r="5.2" fill="none" stroke="' + G2 + '"/>'
    + '<path d="M8 4v4l2.8 1.7"' + st(K, 1.3) + '/><circle cx="8" cy="8" r=".9" fill="' + K + '"/>'),
  hardware: color(
    '<path d="M5.5 2v2.5M8 2v2.5M10.5 2v2.5M5.5 11.5V14M8 11.5V14M10.5 11.5V14M2 5.5h2.5M2 8h2.5M2 10.5h2.5M11.5 5.5H14M11.5 8H14M11.5 10.5H14" stroke="' + K + '"/>'
    + body(3, 3, 10, 10, '#4A4A56') + '<rect x="6" y="6" width="4" height="4" fill="' + G1 + '" stroke="' + K + '"/>'),
  network: color(
    '<path d="M2 6.4a8.6 8.6 0 0 1 12 0M4.3 8.9a5.4 5.4 0 0 1 7.4 0"' + st(SKd, 1.7) + '/>'
    + '<path d="M2 6.4a8.6 8.6 0 0 1 12 0M4.3 8.9a5.4 5.4 0 0 1 7.4 0" fill="none" stroke="' + K + '" stroke-width=".5"/>'
    + '<circle cx="8" cy="12" r="1.6" fill="' + GN + '" stroke="' + K + '"/>'),
  session: color(
    '<circle cx="8" cy="5" r="2.8" fill="#F4D2B0" stroke="' + K + '"/>'
    + '<path d="M2.5 14c.3-3.2 2.5-4.9 5.5-4.9s5.2 1.7 5.5 4.9z" fill="' + LV + '" stroke="' + K + '"/>'),
  system: color(
    body(1, 2, 14, 12, '#1E2A22') + '<path d="M2.5 8.5h3l1.2-3.2 2.1 6.2 1.4-3h3.3"' + st('#6EF08A', 1.3) + '/>'),
  other: color(
    body(1, 1, 6, 6, LV) + body(9, 1, 6, 6, GN) + body(1, 9, 6, 6, GD) + body(9, 9, 6, 6, SK)),
  setup: color(
    body(2, 1, 12, 14, '#fff') + '<path d="M4.4 5l1.1 1.1 2-2.3M4.4 9.2l1.1 1.1 2-2.3"' + st(GNd, 1.3) + '/><path d="M9 5.2h3M9 9.4h3" stroke="' + G3 + '" stroke-width="1.3"/><path d="M4.6 12.3h6.5" stroke="' + G3 + '" stroke-width="1.3"/>'),
  pairing: color(
    '<circle cx="5" cy="8" r="3.2" fill="' + GD + '" stroke="' + K + '"/><circle cx="5" cy="8" r="1.1" fill="#fff" stroke="' + K + '" stroke-width=".7"/>'
    + '<path d="M8 8h6.5M12.5 8v2.6M14.5 8v2" fill="none" stroke="' + K + '" stroke-width="1.8"/><path d="M8 8h6.5" stroke="' + GD + '" stroke-width=".8"/>'),
  valence: color(
    '<path d="M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5"' + st(K, 3.1) + '/>'
    + '<path d="M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5"' + st(LV, 1.5) + '/>'),
  log: color(
    body(2, 1, 12, 14, '#fff') + '<path d="M4.5 4.5h7M4.5 7h7M4.5 9.5h7M4.5 12h4" stroke="' + G3 + '"/><path d="M3.5 2.5h9" stroke="' + SKd + '" stroke-width="1.4"/>'),
  display: color(
    body(1, 2, 14, 10, G2) + '<rect x="3" y="4" width="10" height="6" fill="' + SK + '" stroke="' + K + '"/><path d="M3.5 4.5h4" stroke="#fff"/>'
    + '<path d="M5.5 14.5h5M8 12v2.5" stroke="' + K + '" stroke-width="1.6"/>'),
  plugins: color(
    '<path d="M5.5 1.5v3M10.5 1.5v3M8 11v3.5" stroke="' + K + '" stroke-width="1.6"/>'
    + '<path d="M3.5 4.5h9v3.2a4.5 4.5 0 0 1-9 0z" fill="' + GN + '" stroke="' + K + '"/><path d="M4.6 5.6h6.8" stroke="#fff"/>'),
  hubs: color(
    body(1, 2, 14, 5, G2) + body(1, 9, 14, 5, G2)
    + '<circle cx="4.5" cy="4.5" r="1" fill="' + GN + '" stroke="' + K + '" stroke-width=".6"/><circle cx="4.5" cy="11.5" r="1" fill="' + GN + '" stroke="' + K + '" stroke-width=".6"/>'
    + '<path d="M7.5 4.5h5M7.5 11.5h5" stroke="' + G3 + '"/>'),
  server: color(
    '<circle cx="8" cy="8" r="6.5" fill="' + SK + '" stroke="' + K + '"/>'
    + '<path d="M1.8 8h12.4M8 1.6c-2.8 2.4-2.8 10.4 0 12.8M8 1.6c2.8 2.4 2.8 10.4 0 12.8" fill="none" stroke="' + K + '" stroke-opacity=".7"/>'
    + '<path d="M3.4 4.6c1.2.6 2 .3 2.6-.7l-.6-1.2M9 12.2c.2-1.2 1.2-1.4 2.2-1.2l.9-1.6" fill="none" stroke="' + GN + '" stroke-width="1.5"/>'),
  settings: color(
    body(1, 2, 14, 12, G2) + '<path d="M5 4v8M8 4v8M11 4v8" stroke="' + G3 + '"/>'
    + '<rect x="3.7" y="5.5" width="2.6" height="2.2" fill="#fff" stroke="' + K + '"/><rect x="6.7" y="8.5" width="2.6" height="2.2" fill="#fff" stroke="' + K + '"/><rect x="9.7" y="4.6" width="2.6" height="2.2" fill="#fff" stroke="' + K + '"/>'),
  merge: color(
    '<path d="M4 2.5V6c0 2.2 4 2.2 4 4.4V13M12 2.5V6c0 2.2-4 2.2-4 4.4"' + st(K, 3) + '/>'
    + '<path d="M4 2.5V6c0 2.2 4 2.2 4 4.4V13M12 2.5V6c0 2.2-4 2.2-4 4.4"' + st(LV, 1.4) + '/><path d="M5.8 11.3L8 14l2.2-2.7z" fill="' + K + '"/>'),
  about: color(
    '<circle cx="8" cy="8" r="6.5" fill="' + SKd + '" stroke="' + K + '"/><path d="M4.2 6A4.6 4.6 0 0 1 8 3.4" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/>'
    + '<path d="M8 7.2v4" stroke="#fff" stroke-width="1.9"/><circle cx="8" cy="4.9" r="1.1" fill="#fff"/>'),
};
