import { color, st } from '../kit.js';

/* Rack: every page is a small unit, a dark faceplate with a steel edge, a screw at each end,
   silkscreen white and one lamp of light. */
const W = '#F1F4F5', G = '#4DF08C', C = '#6CC6FF';
const unit = (glyph) => color(
  '<rect x="1" y="2.5" width="14" height="11" rx="1.4" fill="#2A3036" stroke="#C3CAD0"/>'
  + '<circle cx="2.7" cy="8" r=".6" fill="#C3CAD0"/><circle cx="13.3" cy="8" r=".6" fill="#C3CAD0"/>' + glyph);
const line = (c, w = 1.3) => st(c, w);

export default {
  machine: unit('<rect x="4.4" y="5" width="3" height="2.4" rx=".4" fill="' + G + '"/><rect x="8.6" y="5" width="3" height="2.4" rx=".4" fill="' + W + '" opacity=".75"/><rect x="4.4" y="8.6" width="3" height="2.4" rx=".4" fill="' + W + '" opacity=".75"/><rect x="8.6" y="8.6" width="3" height="2.4" rx=".4" fill="' + W + '" opacity=".75"/>'),
  generator: unit('<path d="M4.3 8c.9-3.3 1.9-3.3 2.9 0s2 3.3 2.9 0 1.3-2 1.6-2"' + line(G, 1.4) + '/>'),
  motion: unit('<path d="M4.5 8h7M6.1 6.3 4.4 8l1.7 1.7M9.9 6.3 11.6 8l-1.7 1.7"' + line(W) + '/>'),
  safety: unit('<circle cx="8" cy="8" r="2.9" fill="none" stroke="' + W + '" stroke-width="1.1"/><rect x="6.4" y="6.4" width="3.2" height="3.2" rx=".4" fill="' + W + '"/>'),
  limits: unit('<path d="M4.6 5.4v5.2M11.4 5.4v5.2M5.4 8h5.2M7 6.6 5.6 8 7 9.4M9 6.6 10.4 8 9 9.4"' + line(W, 1.1) + '/>'),
  playback: unit('<path d="M6.3 5.5v5l4.3-2.5z" fill="' + G + '"/>'),
  auxiliary: unit('<circle cx="8" cy="8.4" r="2.9" fill="#4B535A" stroke="' + W + '" stroke-width="1"/><path d="M8 8.4V5.8"' + line(W, 1.4) + '/>'),
  automation: unit('<path d="M4.2 10.6 6.1 5.6l1.9 2.6h2.4l1.4 2.4"' + line(G, 1.3) + '/>'),
  hardware: unit('<rect x="5.6" y="5.6" width="4.8" height="4.8" rx=".6" fill="#4B535A" stroke="' + W + '" stroke-width=".9"/><path d="M7 4.3v1.3M9 4.3v1.3M7 10.4v1.3M9 10.4v1.3M4.3 7h1.3M4.3 9h1.3M10.4 7h1.3M10.4 9h1.3"' + line(W, .9) + '/>'),
  network: unit('<circle cx="5.5" cy="8" r="1.6" fill="none" stroke="' + W + '" stroke-width="1"/><circle cx="10.5" cy="8" r="1.6" fill="none" stroke="' + W + '" stroke-width="1"/><path d="M7.1 8h1.8"' + line(C, 1.4) + '/>'),
  session: unit('<circle cx="5.9" cy="8" r="1.9" fill="none" stroke="' + W + '" stroke-width="1"/><circle cx="10.1" cy="8" r="1.9" fill="none" stroke="' + W + '" stroke-width="1"/><circle cx="5.9" cy="8" r=".5" fill="' + W + '"/><circle cx="10.1" cy="8" r=".5" fill="' + W + '"/>'),
  system: unit('<path d="M4.1 8.5h2l1-2.7 1.6 4.4 1-1.7h2.2"' + line(G, 1.2) + '/>'),
  other: unit('<circle cx="6" cy="6.3" r="1" fill="' + W + '"/><circle cx="10" cy="6.3" r="1" fill="' + W + '"/><circle cx="6" cy="9.7" r="1" fill="' + W + '"/><circle cx="10" cy="9.7" r="1" fill="' + G + '"/>'),
  setup: unit('<path d="M5.8 4.9v6.2M8 4.9v6.2M10.2 4.9v6.2"' + line('#6D767D', 1) + '/><rect x="4.9" y="6.2" width="1.8" height="1.4" rx=".3" fill="' + W + '"/><rect x="7.1" y="8.6" width="1.8" height="1.4" rx=".3" fill="' + G + '"/><rect x="9.3" y="5.4" width="1.8" height="1.4" rx=".3" fill="' + W + '"/>'),
  pairing: unit('<circle cx="5.9" cy="8" r="1.8" fill="none" stroke="' + W + '" stroke-width="1.1"/><path d="M7.7 8h4.3M10.6 8v1.6"' + line(W, 1.1) + '/>'),
  valence: unit('<path d="M6.9 9.1l2.2-2.2M7.1 5.6l.9-.9a1.8 1.8 0 0 1 2.6 2.6l-.9.9M8.9 10.4l-.9.9a1.8 1.8 0 0 1-2.6-2.6l.9-.9"' + line(W, 1.1) + '/>'),
  log: unit('<path d="M4.4 5.9h7.2M4.4 8h7.2M4.4 10.1h4.4"' + line('#8F989F', 1.1) + '/><path d="M4.4 5.9h2.6"' + line(G, 1.3) + '/>'),
  display: unit('<path d="M4.4 10.4a3.9 3.9 0 0 1 7.2 0"' + line('#8F989F', 1) + '/><path d="M8 10.5 10 6.8"' + line(W, 1.2) + '/><circle cx="8" cy="10.5" r=".7" fill="' + W + '"/>'),
  plugins: unit('<path d="M6.5 4.6v2M9.5 4.6v2"' + line(W, 1.2) + '/><rect x="5.1" y="6.4" width="5.8" height="3" rx="1" fill="#4B535A" stroke="' + W + '" stroke-width=".9"/><path d="M8 9.4v2"' + line(W, 1.2) + '/>'),
  hubs: unit('<rect x="4.2" y="4.9" width="7.6" height="2.6" rx=".5" fill="#4B535A" stroke="' + W + '" stroke-width=".8"/><rect x="4.2" y="8.5" width="7.6" height="2.6" rx=".5" fill="#4B535A" stroke="' + W + '" stroke-width=".8"/><circle cx="5.6" cy="6.2" r=".5" fill="' + G + '"/><circle cx="5.6" cy="9.8" r=".5" fill="' + G + '"/>'),
  server: unit('<circle cx="8" cy="8" r="3.3" fill="none" stroke="' + W + '" stroke-width="1"/><path d="M4.7 8h6.6M8 4.7c-1.6 1.7-1.6 4.9 0 6.6M8 4.7c1.6 1.7 1.6 4.9 0 6.6"' + line(C, .9) + '/>'),
  settings: unit('<path d="M4.4 6h7.2M4.4 10h7.2"' + line('#6D767D', 1) + '/><circle cx="6.2" cy="6" r="1.2" fill="' + W + '"/><circle cx="9.8" cy="10" r="1.2" fill="' + G + '"/>'),
  merge: unit('<path d="M5.4 5.2 8 8v3.2M10.6 5.2 8 8"' + line(W, 1.3) + '/>'),
  about: unit('<circle cx="8" cy="5.9" r=".9" fill="' + W + '"/><path d="M8 8v2.8"' + line(W, 1.5) + '/>'),
};
