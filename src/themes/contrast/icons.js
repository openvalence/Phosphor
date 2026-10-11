/** Contrast: wayfinding pictograms, a 2.4 stroke and solid fills, one color (the control's text). */
const S = (inner, w = 2.4) => '<g stroke-width="' + w + '">' + inner + '</g>';
const F = (inner) => '<g fill="#000" stroke="none">' + inner + '</g>';

export default {
  machine: F('<rect x="2" y="2" width="5.5" height="7"/><rect x="8.5" y="2" width="5.5" height="4"/><rect x="8.5" y="7" width="5.5" height="7"/><rect x="2" y="10.5" width="5.5" height="3.5"/>'),
  generator: S('<path d="M1.5 8q2.25-7 4.5 0t4.5 0t4.5 0"/>'),
  motion: S('<path d="M2 8h12M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>'),
  safety: S('<path d="M8 1.75l5.5 2.25v4c0 3-2.3 5-5.5 6.5C4.8 13 2.5 11 2.5 8V4z"/><path d="M5.5 8l2 2 3.2-4"/>', 2.2),
  limits: S('<path d="M2.5 3v10M13.5 3v10M5 8h6M7 5.8L5 8l2 2.2M9 5.8l2 2.2-2 2.2"/>', 2.2),
  playback: F('<path d="M4 2.5v11l9.5-5.5z"/>'),
  auxiliary: F('<path d="M8 1.5c2.8 3.2 4.5 5.5 4.5 7.8a4.5 4.5 0 0 1-9 0C3.5 7 5.2 4.7 8 1.5z"/>'),
  automation: S('<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.8"/>'),
  hardware: S('<rect x="4.5" y="4.5" width="7" height="7"/><path d="M6.5 1.5v3M9.5 1.5v3M6.5 11.5v3M9.5 11.5v3M1.5 6.5h3M1.5 9.5h3M11.5 6.5h3M11.5 9.5h3"/>', 2),
  network: S('<path d="M1.5 6.2a9 9 0 0 1 13 0M4 9a5.5 5.5 0 0 1 8 0"/>') + F('<circle cx="8" cy="12" r="1.9"/>'),
  session: F('<circle cx="8" cy="4.8" r="3"/><path d="M2 14.2c.4-3.6 2.6-5.2 6-5.2s5.6 1.6 6 5.2z"/>'),
  system: S('<path d="M1 8.5h3.5l2-5 3 9 2-4H15"/>', 2.2),
  other: F('<rect x="2" y="2" width="5.5" height="5.5"/><rect x="8.5" y="2" width="5.5" height="5.5"/><rect x="2" y="8.5" width="5.5" height="5.5"/><rect x="8.5" y="8.5" width="5.5" height="5.5"/>'),
  setup: S('<path d="M2 4.2l1.6 1.6L6.2 3M2 10.2l1.6 1.6L6.2 9M9 4.5h5M9 10.5h5"/>', 2.2),
  pairing: S('<circle cx="4.7" cy="8" r="3"/><path d="M7.7 8H14.5M11.5 8v2.8M14 8v2.2"/>'),
  valence: S('<path d="M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5"/>'),
  log: S('<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h6.5"/>'),
  display: S('<rect x="1.8" y="2.5" width="12.4" height="8.5"/><path d="M5.5 14h5M8 11v3"/>', 2.2),
  plugins: S('<path d="M5.8 1.5v3.5M10.2 1.5v3.5M4 5h8v2.5a4 4 0 0 1-8 0zM8 11.5v3"/>', 2.2),
  hubs: S('<rect x="2" y="2.5" width="12" height="4.5"/><rect x="2" y="9" width="12" height="4.5"/>', 2.2) + F('<rect x="4" y="4" width="2" height="1.6"/><rect x="4" y="10.5" width="2" height="1.6"/>'),
  server: S('<rect x="1.8" y="2.5" width="12.4" height="11"/><path d="M4.8 6.2l2.4 1.8-2.4 1.8M8.8 10.2h2.6"/>', 2.1),
  settings: S('<path d="M3 2v12M8 2v12M13 2v12"/>', 2) + F('<rect x="1" y="3.5" width="4" height="3"/><rect x="6" y="9" width="4" height="3"/><rect x="11" y="5.5" width="4" height="3"/>'),
  merge: S('<path d="M3.5 2.5v3.5c0 2.5 4.5 2.5 4.5 5.5V14M12.5 2.5v3.5c0 2.5-4.5 2.5-4.5 5.5"/>'),
  about: S('<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11.5"/>') + F('<circle cx="8" cy="4.8" r="1.2"/>'),
};
