/**
 * Amp: the rail's glyphs as a player's button faces, square-cornered and a little chunky.
 * Mask icons on the 16-unit grid (stroke 1.5, a filled shape names fill="#000" stroke="none").
 */
const f = ' fill="#000" stroke="none"';
const bars = (xs, hs) => xs.map((x, i) => '<rect x="' + x + '" y="' + (14 - hs[i]) + '" width="2" height="' + hs[i] + '"' + f + '/>').join('');

export default {
  machine: '<rect x="1.5" y="3.5" width="13" height="9"/><path d="M4 8.2h3.5M10.5 6.2v4M12.5 6.2v4"/>',
  generator: bars([1.5, 4.5, 7.5, 10.5, 13.5], [5, 9, 12, 8, 4]),
  motion: '<path d="M1.8 3.2v9.6L7.4 8zM8.6 3.2v9.6L14.2 8z"' + f + '/>',
  safety: '<path d="M8 1.8l5.2 1.8v4.3c0 3-2.2 5-5.2 6.3-3-1.3-5.2-3.3-5.2-6.3V3.6z"/><path d="M5.5 8l2 2 3.5-4"/>',
  limits: '<path d="M4 2v12M8 2v12M12 2v12"/><rect x="2" y="9" width="4" height="2.6"' + f + '/><rect x="6" y="4.4" width="4" height="2.6"' + f + '/><rect x="10" y="7" width="4" height="2.6"' + f + '/>',
  playback: '<path d="M4 2.4v11.2L13.4 8z"' + f + '/>',
  auxiliary: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8"' + f + '/>',
  automation: '<path d="M3 7V5.8A1.8 1.8 0 014.8 4H12M9.8 1.6L12.4 4 9.8 6.4M13 9v1.2A1.8 1.8 0 0111.2 12H4M6.2 9.6L3.6 12l2.6 2.4"/>',
  hardware: '<rect x="4.2" y="4.2" width="7.6" height="7.6"/><path d="M6.5 1.5v2.7M9.5 1.5v2.7M6.5 11.8v2.7M9.5 11.8v2.7M1.5 6.5h2.7M1.5 9.5h2.7M11.8 6.5h2.7M11.8 9.5h2.7"/>',
  network: '<rect x="1.8" y="10.5" width="2.4" height="3.5"' + f + '/><rect x="5.4" y="7.5" width="2.4" height="6.5"' + f + '/><rect x="9" y="4.5" width="2.4" height="9.5"' + f + '/><rect x="12.6" y="1.8" width="2.2" height="12.2"' + f + '/>',
  session: '<circle cx="8" cy="9" r="5.2"/><path d="M8 5.8V9l2.2 1.4M6.2 1.8h3.6"/>',
  system: '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.4 3.4L5 5M11 11l1.6 1.6M3.4 12.6L5 11M11 5l1.6-1.6"/>',
  other: '<rect x="2" y="2" width="5" height="5"' + f + '/><rect x="9" y="2" width="5" height="5"' + f + '/><rect x="2" y="9" width="5" height="5"' + f + '/><rect x="9" y="9" width="5" height="5"' + f + '/>',
  setup: '<circle cx="8" cy="8.5" r="5.2"/><path d="M8 8.5l2.6-3.4"/><circle cx="8" cy="8.5" r="1"' + f + '/>',
  pairing: '<rect x="1.5" y="5.5" width="7.4" height="5" rx="2.5"/><rect x="7.1" y="5.5" width="7.4" height="5" rx="2.5"/>',
  valence: '<circle cx="8" cy="8" r="1.5"' + f + '/><ellipse cx="8" cy="8" rx="6.4" ry="2.7" transform="rotate(-35 8 8)"/><ellipse cx="8" cy="8" rx="6.4" ry="2.7" transform="rotate(35 8 8)"/>',
  log: '<path d="M2 3.5h12M2 6.8h8.5M2 10.1h12M2 13.4h6"/>',
  display: '<rect x="1.5" y="2" width="13" height="9"/><path d="M4.5 9V7.2M7 9V5M9.5 9V6.2M12 9V4.2M5 14h6M8 11v3"/>',
  plugins: '<path d="M5.2 1.8v3.6M10.8 1.8v3.6"/><path d="M3.4 5.4h9.2V8a4.6 4.6 0 01-9.2 0z"/><path d="M8 12.6v1.8"/>',
  hubs: '<rect x="1.5" y="2.2" width="13" height="4.4"/><rect x="1.5" y="9.4" width="13" height="4.4"/><path d="M4 4.4h1.2M4 11.6h1.2"/>',
  server: '<rect x="3" y="1.5" width="10" height="13"/><path d="M5.4 4.6h5.2M5.4 8h5.2M5.4 11.4h2.4"/>',
  settings: '<path d="M2 4.6h12M2 11.4h12"/><rect x="9.4" y="2.8" width="3" height="3.6"' + f + '/><rect x="3.6" y="9.6" width="3" height="3.6"' + f + '/>',
  merge: '<path d="M3 2.4L8 8M13 2.4L8 8M8 8v5.6"/>',
  about: '<rect x="1.8" y="1.8" width="12.4" height="12.4"/><path d="M8 7v4.8"/><circle cx="8" cy="4.8" r="1"' + f + '/>',
};
