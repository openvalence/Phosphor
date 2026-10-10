/** Cipher: terminal-square glyphs, each with one cut or offset slice like a dropped scanline. Masks in the control's color. */
const dot = (x, y) => '<path d="M' + x + ' ' + y + 'h.01"/>';

export default {
  machine: '<path d="M2 3h12v10H2zM2 6h12"/><path d="M4.6 8.4 6.6 10 4.6 11.6M8 11.6h3"/>',
  generator: '<path d="M1 8h2.4l1.6-5 2.2 10 2.2-10 1.6 5H15"/><path d="M1 13.5h4M8 13.5h7" opacity=".6"/>',
  motion: '<path d="M1.5 8h13M4.6 5 1.6 8l3 3M11.4 5l3 3-3 3"/><path d="M6.5 3.2h3M6.5 12.8h3" opacity=".6"/>',
  safety: '<path d="M8 1.5l5.5 2v4.2c0 3.2-2.3 5.4-5.5 6.8-3.2-1.4-5.5-3.6-5.5-6.8V3.5z"/><path d="M8 5v3.4M8 10.6v.1"/>',
  limits: '<path d="M2.5 3v10M13.5 3v10M2.5 8h4M9.5 8h4"/><path d="M8 5.5v5"/>',
  playback: '<path d="M4 3 12.5 8 4 13z"/><path d="M1.5 3v10" opacity=".6"/>',
  auxiliary: '<path d="M9.5 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>',
  automation: '<circle cx="8" cy="8" r="6"/><path d="M8 4.4V8l2.6 1.6"/>',
  hardware: '<path d="M4.5 4.5h7v7h-7z"/><path d="M6.5 1.5v3M9.5 1.5v3M6.5 11.5v3M9.5 11.5v3M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3"/>',
  network: '<circle cx="8" cy="3.6" r="1.7"/><circle cx="3" cy="12.4" r="1.7"/><circle cx="13" cy="12.4" r="1.7"/><path d="M7 5.2 4 10.8M9 5.2l3 5.6M4.9 12.4h6.2"/>',
  session: '<circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-3 2.2-4.8 5-4.8s5 1.8 5 4.8"/>',
  system: '<path d="M2 4h12M2 8h12M2 12h12"/><path d="M5 2.4v3.2M10.6 6.4v3.2M7 10.4v3.2"/>',
  other: '<path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4z"/><path d="M9.5 11.5h4"/>',
  setup: '<path d="M2 4.2l1.4 1.4L5.8 3M2 9.2l1.4 1.4L5.8 8"/><path d="M8.5 4.5H14M8.5 9.5H14M2 13.5h12"/>',
  pairing: '<circle cx="5" cy="8" r="3"/><path d="M8 8h7M12.2 8v3M14.6 8v2"/>',
  valence: '<circle cx="5.6" cy="8" r="3.6"/><circle cx="10.4" cy="8" r="3.6"/>',
  log: '<path d="M2.5 4h2M6.5 4h7M2.5 8h2M6.5 8h5M2.5 12h2M6.5 12h6"/>',
  display: '<path d="M2 2.5h12v8.5H2z"/><path d="M5.5 13.5h5M8 11v2.5"/>',
  plugins: '<path d="M5.5 1.5v4M10.5 1.5v4M3.5 5.5h9v3a4.5 4.5 0 0 1-9 0z"/><path d="M8 13v2"/>',
  hubs: '<path d="M2 3h12v3.6H2zM2 9.4h12V13H2z"/>' + dot(4.8, 4.8) + dot(4.8, 11.2),
  server: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.4 2.2 2.4 9.8 0 12M8 2c-2.4 2.2-2.4 9.8 0 12"/>',
  settings: '<circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  merge: '<path d="M3 2.5v2.5c0 2.2 2 3.5 5 3.5s5 1.3 5 3.5v1.5M13 2.5v2.5"/>',
  about: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6M8 5v.1"/>',
};
