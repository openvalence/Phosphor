/** Outrun's icon set: mask glyphs on a 16-unit viewBox, drawn open at the engine's 1.5 stroke; theme.css gives them a neon bloom. */
const dot = (cx, cy, r) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#000" stroke="none"/>';
const ring = (cx, cy, r) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>';

export default {
  // the machine is a wedge car, wheels filled
  machine: '<path d="M1.5 11.5V9.5l2.2-.9L6 6h4.2l2.6 2.6 1.7.6v2.3H1.5z"/>' + dot(4.7, 12, 1.5) + dot(11.5, 12, 1.5),
  generator: '<path d="M1.5 12L6 4v8l4.5-8v8l4-8"/>',
  motion: '<path d="M2 4l5 4-5 4M8.5 4l5 4-5 4"/>',
  safety: '<path d="M8 1.5l5.5 2v4.5c0 3-2.4 5.2-5.5 6.5C4.9 13.2 2.5 11 2.5 8V3.5z"/><path d="M5.5 8l2 2 3-4"/>',
  limits: '<path d="M2 3v10M14 3v10M5 8h6M5 8l2-2M5 8l2 2M11 8l-2-2M11 8l-2 2"/>',
  playback: '<path d="M4.5 3l8.5 5-8.5 5z"/>',
  auxiliary: '<path d="M8 1.5c.5 3.5 1.5 5 6.5 6.5-5 1.5-6 3-6.5 6.5C7.5 11 6.5 9.5 1.5 8 6.5 6.5 7.5 5 8 1.5z"/>',
  automation: ring(8, 8.5, 5.5) + '<path d="M8 5.5v3l2 1.5M6.5 1.5h3"/>',
  hardware: '<path d="M4 4h8v8H4zM6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5"/>',
  network: '<path d="M8 14V8.5M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3 3.2a7 7 0 0 0 0 9.6M13 3.2a7 7 0 0 1 0 9.6"/>' + dot(8, 7.2, 1.3),
  // the driver: a head with shades over the shoulders
  session: ring(8, 5.5, 2.8) + '<path d="M2.5 14c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5M6 5.2h4"/>',
  // a dashboard gauge: arc, needle, three ticks
  system: '<path d="M2.2 12a5.8 5.8 0 1 1 11.6 0M8 12l3.2-3.6M4.3 7.6l.7.7M8 5v1M11.7 7.6l-.7.7"/>',
  other: '<path d="M8 1l2.5 2.5L8 6 5.5 3.5zM12.5 5.5L15 8l-2.5 2.5L10 8zM3.5 5.5L6 8l-2.5 2.5L1 8zM8 10l2.5 2.5L8 15l-2.5-2.5z"/>',
  // a race-start flag: the checks are the setup
  setup: '<path d="M3 14.5V2M3 3h10v6H3M6.3 3v6M9.6 3v6M3 6h10"/>',
  pairing: ring(5.5, 8, 3.5) + ring(10.5, 8, 3.5),
  valence: '<ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(35 8 8)"/><ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(-35 8 8)"/>' + dot(8, 8, 1.3),
  log: '<path d="M2.5 4l4 3.5-4 3.5M8 12h5.5"/>',
  display: '<path d="M1.5 2.5h13v9h-13zM5.5 14h5M8 11.5V14M4.5 9a3.5 3.5 0 0 1 7 0"/>',
  plugins: '<path d="M1.5 4h13v8h-13z"/>' + ring(5.5, 8, 1.5) + ring(10.5, 8, 1.5) + '<path d="M5.5 12l1-1.5h3l1 1.5"/>',
  hubs: ring(8, 3.5, 1.8) + ring(3.5, 12.5, 1.8) + ring(12.5, 12.5, 1.8) + '<path d="M7 5.2l-2.5 5.6M9 5.2l2.5 5.6M5.4 12.5h5.2"/>',
  server: '<path d="M2 2.5h12v4H2zM2 9.5h12v4H2zM8 4.5h5M8 11.5h5"/>' + dot(4.5, 4.5, .9) + dot(4.5, 11.5, .9),
  settings: ring(8, 8, 3) + '<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>',
  merge: '<path d="M2.5 2.5L8 8.5l5.5-6M8 8.5v5.5"/>',
  about: ring(8, 8, 6.3) + '<path d="M8 7.2v4M8 4.8v.01"/>',
};
