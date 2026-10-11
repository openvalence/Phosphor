/** Blueprint: single-weight draftsman symbols, square caps and mitered corners, one stroke. docs/THEMES.md, Icons. */
const g = (inner) => '<g stroke-linecap="square" stroke-linejoin="miter">' + inner + '</g>';

export default {
  machine: g('<path d="M1.5 12h13M3 12v2M13 12v2"/><rect x="5" y="6" width="6" height="4.5"/><path d="M8 6V2.5M5.8 4.2L8 2l2.2 2.2"/>'),
  generator: g('<path d="M1.5 8h13" stroke-width="1" stroke-dasharray="1.5 1.5"/><path d="M1.5 8c1.3-5 2.7-5 4 0s2.7 5 4 0 2.7-5 4 0" stroke-linecap="butt"/>'),
  motion: g('<path d="M1.5 8h13M4 5.5L1.5 8 4 10.5M12 5.5L14.5 8 12 10.5M1.5 3.5v9M14.5 3.5v9"/>'),
  safety: g('<path d="M8 1.5l5.5 2v4.3c0 3-2.3 5-5.5 6.7-3.2-1.7-5.5-3.7-5.5-6.7V3.5z"/><path d="M5.5 8l2 2 3-3.5"/>'),
  limits: g('<path d="M2.5 2.5v11M13.5 2.5v11M5 8h6M7 5.8L4.8 8 7 10.2M9 5.8L11.2 8 9 10.2"/>'),
  playback: g('<rect x="2" y="2.5" width="12" height="11"/><path d="M6.5 5.5v5l4-2.5z"/>'),
  auxiliary: g('<circle cx="8" cy="8" r="3.3"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>'),
  automation: g('<circle cx="8" cy="8" r="2.3"/><circle cx="8" cy="8" r="5.6" stroke-width="2.4" stroke-dasharray="2.2 2.1" stroke-linecap="butt"/>'),
  hardware: g('<rect x="4.5" y="4.5" width="7" height="7"/><path d="M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14"/>'),
  network: g('<circle cx="8" cy="3.6" r="1.7"/><circle cx="3.6" cy="12" r="1.7"/><circle cx="12.4" cy="12" r="1.7"/><path d="M7.2 5.2L4.5 10.4M8.8 5.2l2.7 5.2M5.4 12h5.2"/>'),
  session: g('<circle cx="8" cy="5.3" r="2.6"/><path d="M2.8 14c.4-3 2.4-4.5 5.2-4.5s4.8 1.5 5.2 4.5z"/>'),
  system: g('<path d="M1.5 8.5h3l1.5-4.5 2.5 8 1.5-3.5h4.5" stroke-linecap="butt"/>'),
  other: g('<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>'),
  setup: g('<path d="M2.5 4.2l1.5 1.5L6.6 3M2.5 9.2l1.5 1.5L6.6 8M8.8 4.5h4.7M8.8 9.5h4.7M2.5 13.5h11"/>'),
  pairing: g('<circle cx="4.8" cy="8" r="2.8"/><path d="M7.6 8h6.4M12 8v2.5M14 8v1.7"/>'),
  valence: g('<circle cx="5.8" cy="8" r="4"/><circle cx="10.2" cy="8" r="4"/>'),
  log: g('<path d="M3 1.5h7l3 3v10H3zM10 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 6h2"/>'),
  display: g('<rect x="1.5" y="2.5" width="13" height="8.5"/><path d="M5.5 14h5M8 11v3"/>'),
  plugins: g('<path d="M5.5 2v3M10.5 2v3M4 5h8v2.5a4 4 0 0 1-8 0zM8 11.5v3"/>'),
  hubs: g('<rect x="2" y="2.5" width="12" height="4.5"/><rect x="2" y="9" width="12" height="4.5"/><path d="M4.5 4.75h1M4.5 11.25h1M9 4.75h3M9 11.25h3"/>'),
  server: g('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2.5 2.2-2.5 9.8 0 12M8 2c2.5 2.2 2.5 9.8 0 12"/>'),
  settings: g('<path d="M3.5 2v12M8 2v12M12.5 2v12"/><rect x="2" y="9" width="3" height="2.4" fill="#000"/><rect x="6.5" y="4" width="3" height="2.4" fill="#000"/><rect x="11" y="7" width="3" height="2.4" fill="#000"/>'),
  merge: g('<path d="M3.5 2v3.5c0 2.3 4.5 2 4.5 4.5v4M12.5 2v3.5c0 2.3-4.5 2-4.5 4.5M5.8 12l2.2 2.4 2.2-2.4"/>'),
  about: g('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4"/><rect x="7.4" y="4.2" width="1.2" height="1.2" fill="#000" stroke="none"/>'),
};
