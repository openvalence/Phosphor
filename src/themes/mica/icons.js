import { stockIcons } from '../kit.js';

/** Mica: outline glyphs on the 16 grid, a 1.1 stroke, 1.25 corner rounding, one filled dot where the shape has a point. */
const g = (inner) => '<g stroke-width="1.1">' + inner + '</g>';
const dot = (cx, cy, r = 0.8) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#000" stroke="none"/>';
const rect = (x, y, w, h, r = 1.25) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '"/>';

const drawn = {
  machine: g(rect(2, 2, 5, 7) + rect(9, 2, 5, 4) + rect(9, 8, 5, 6) + rect(2, 11, 5, 3)),
  generator: g('<path d="M1.5 8q2.17-6 4.33 0t4.33 0t4.33 0"/>'),
  motion: g('<path d="M2 8h12M4.5 5.5L2 8l2.5 2.5M11.5 5.5L14 8l-2.5 2.5"/>'),
  safety: g('<path d="M8 1.75l5 1.75v4c0 3-2.1 5-5 6-2.9-1-5-3-5-6v-4z"/><path d="M5.8 8l1.6 1.6 3-3.2"/>'),
  limits: g('<path d="M2.5 2.5v11M13.5 2.5v11M5.5 8h5M7.2 6.3L5.5 8l1.7 1.7M8.8 6.3L10.5 8 8.8 9.7"/>'),
  playback: g('<path d="M5.2 3.4v9.2c0 .5.5.8.9.5l6.8-4.6c.4-.3.4-.8 0-1.1L6.1 2.9c-.4-.3-.9 0-.9.5z"/>'),
  auxiliary: g('<path d="M8 2c2.4 3 4 5 4 7a4 4 0 0 1-8 0c0-2 1.6-4 4-7z"/><path d="M6.2 9.6a2 2 0 0 0 1.4 1.7"/>'),
  automation: g('<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.4 1.5"/>'),
  hardware: g(rect(4.5, 4.5, 7, 7) + '<path d="M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14"/>') + '<rect x="6.6" y="6.6" width="2.8" height="2.8" rx=".5" fill="#000" stroke="none"/>',
  network: g('<path d="M2 6.2a8.2 8.2 0 0 1 12 0M4.2 8.8a5.2 5.2 0 0 1 7.6 0M6.4 11.2a2.2 2.2 0 0 1 3.2 0"/>') + dot(8, 13.2, 0.9),
  session: g('<circle cx="8" cy="5.2" r="2.7"/><path d="M2.8 13.8c.4-2.6 2.5-4.1 5.2-4.1s4.8 1.5 5.2 4.1"/>'),
  system: g('<path d="M1.5 8.5h3l1.7-4.5 3 7.5 1.8-3h3.5"/>'),
  other: g(rect(2.25, 2.25, 4.5, 4.5) + rect(9.25, 2.25, 4.5, 4.5) + rect(2.25, 9.25, 4.5, 4.5) + rect(9.25, 9.25, 4.5, 4.5)),
  setup: g('<path d="M2.5 4.2l1.2 1.2 2.1-2.4M2.5 10.2l1.2 1.2 2.1-2.4M8.5 4.5h5M8.5 10.5h5"/>'),
  pairing: g('<circle cx="5" cy="8" r="2.9"/><path d="M7.9 8H14M11.8 8v2.3M13.8 8v1.7"/>') + dot(5, 8, 0.7),
  valence: g('<path d="M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5"/>'),
  log: g('<path d="M4 1.75h5l3.25 3.25v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z"/><path d="M9 1.75V5h3.25M5.5 8h5M5.5 10.5h5"/>'),
  display: g(rect(1.75, 2.5, 12.5, 8.5, 1.5) + '<path d="M5.5 13.75h5M8 11v2.75"/>'),
  plugins: g('<path d="M6 2v3M10 2v3M8 11.5V14M4.75 5.25h6.5v2.75a3.25 3.25 0 0 1-6.5 0z"/>'),
  hubs: g(rect(2, 2.75, 12, 4.25) + rect(2, 9, 12, 4.25)) + dot(4.6, 4.9) + dot(4.6, 11.1),
  server: g('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2.2 2.2-2.2 9.8 0 12M8 2c2.2 2.2 2.2 9.8 0 12"/>'),
  settings: g('<path d="M2 4h4.5M9.5 4H14M2 8h1.5M6.5 8H14M2 12h6.5M11.5 12H14"/><circle cx="8" cy="4" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="10" cy="12" r="1.5"/>'),
  merge: g('<path d="M4 2.5V6c0 2 4 2 4 4v3.5M12 2.5V6c0 2-4 2-4 4"/>'),
  about: g('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6"/>') + dot(8, 4.9),
};

// A name added to the registry later keeps its stock glyph at the Theme's weight until drawn here.
export default { ...stockIcons((d) => '<path d="' + d + '" stroke-width="1.1"/>'), ...drawn };
