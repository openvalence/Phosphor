import { color, st } from '../kit.js';

/** Luna: small glossy icons, a light top fading into a saturated bottom, a dark blue or green edge. */
const lg = (id, a, b) => '<linearGradient id="lu-' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient>';
const defs = (...g) => '<defs>' + g.join('') + '</defs>';
const f = (id) => 'url(#lu-' + id + ')';
const BLUE = lg('bl', '#8DBBFF', '#1F5FD8');
const GREEN = lg('gr', '#A6E37E', '#2F8F1F');
const YELLOW = lg('ye', '#FFE98A', '#E3B320');
const STEEL = lg('st', '#F1F5FB', '#8D9CB3');
const PALE = lg('pa', '#FFFFFF', '#CFDCF3');
/** The white sheen across the top half of a round or rounded shape. */
const GLOSS = '<ellipse cx="8" cy="4.6" rx="4.6" ry="2.4" fill="#fff" opacity=".45"/>';

export default {
  machine: color(defs(BLUE, PALE) + '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="' + f('pa') + '" stroke="#2158C8"/><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 14.5 4v1.5h-13z" fill="' + f('bl') + '"/><rect x="3.5" y="7.2" width="4" height="2.4" fill="#4BA33A"/><rect x="8.5" y="7.2" width="4" height="2.4" fill="#F2C230"/><rect x="3.5" y="10.4" width="4" height="1.8" fill="#2F6FE0"/><rect x="8.5" y="10.4" width="4" height="1.8" fill="#7F8A99"/>'),
  generator: color(defs(PALE) + '<rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="' + f('pa') + '" stroke="#2158C8"/><path d="M3 8.5q1.3-4 2.6 0t2.6 0t2.6 0t2.6 0"' + st('#2F6FE0', 1.6) + '/>'),
  motion: color(defs(BLUE) + '<path d="M1.5 8l4-4v2.4h5V4l4 4-4 4V9.6h-5V12z" fill="' + f('bl') + '" stroke="#123E96" stroke-linejoin="round"/>'),
  safety: color(defs(BLUE) + '<path d="M8 1.5l5.5 2v4.2c0 3.3-2.4 5.5-5.5 6.8-3.1-1.3-5.5-3.5-5.5-6.8V3.5z" fill="' + f('bl') + '" stroke="#123E96"/><path d="M5.5 8l1.8 1.8L10.8 6"' + st('#fff', 1.7) + '/>'),
  limits: color(defs(YELLOW) + '<rect x="1.5" y="5" width="13" height="6" rx="1" fill="' + f('ye') + '" stroke="#9A7A12"/><path d="M4 5v2.5M6.5 5v1.8M9 5v2.5M11.5 5v1.8" stroke="#6B520C"/>'),
  playback: color(defs(GREEN) + '<circle cx="8" cy="8" r="6.5" fill="' + f('gr') + '" stroke="#2E7A22"/>' + GLOSS + '<path d="M6.4 4.9v6.2L11.4 8z" fill="#fff"/>'),
  auxiliary: color(defs(BLUE) + '<path d="M8 1.8C10.4 5 12.2 7 12.2 9.4a4.2 4.2 0 0 1-8.4 0C3.8 7 5.6 5 8 1.8z" fill="' + f('bl') + '" stroke="#123E96"/><path d="M6 9.6a2.2 2.2 0 0 0 1.6 2" fill="none" stroke="#fff" stroke-linecap="round" opacity=".8"/>'),
  automation: color(defs(PALE) + '<circle cx="8" cy="8" r="6.3" fill="' + f('pa') + '" stroke="#2158C8" stroke-width="1.5"/><path d="M8 4.2V8l2.6 1.6"' + st('#123E96', 1.5) + '/>'),
  hardware: color(defs(STEEL) + '<rect x="4" y="4" width="8" height="8" rx="1" fill="' + f('st') + '" stroke="#3E4856"/><path d="M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2" stroke="#3E4856" stroke-width="1.3"/><rect x="6" y="6" width="4" height="4" fill="#2F6FE0" stroke="#123E96" stroke-width=".6"/>'),
  network: color('<path d="M1.8 6.2a9 9 0 0 1 12.4 0M4.1 8.8a5.7 5.7 0 0 1 7.8 0"' + st('#2F6FE0') + '/><circle cx="8" cy="11.8" r="1.5" fill="#4BA33A" stroke="#2E7A22" stroke-width=".6"/>'),
  session: color(defs(BLUE) + '<circle cx="8" cy="5" r="2.8" fill="#F6D2A8" stroke="#9A6B3A"/><path d="M2.8 14c.4-3 2.4-4.6 5.2-4.6s4.8 1.6 5.2 4.6z" fill="' + f('bl') + '" stroke="#123E96"/>'),
  system: color(defs(STEEL) + '<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="#173A23" stroke="#3E4856"/><path d="M2.5 8.5h3l1.2-3 2.2 6 1.3-3h3.3"' + st('#5CF08A', 1.4) + '/>'),
  other: color(defs(BLUE, GREEN, YELLOW, STEEL) + '<rect x="2" y="2" width="5.5" height="5.5" rx="1" fill="' + f('bl') + '"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="1" fill="' + f('gr') + '"/><rect x="2" y="8.5" width="5.5" height="5.5" rx="1" fill="' + f('ye') + '"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" fill="' + f('st') + '"/>'),
  setup: color(defs(PALE) + '<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="' + f('pa') + '" stroke="#6F7B8A"/><path d="M4.4 5l1 1 1.8-2M4.4 9l1 1 1.8-2"' + st('#2F8F1F', 1.5) + '/><path d="M8.6 5h3.2M8.6 9h3.2" stroke="#7F8A99" stroke-width="1.3"/>'),
  pairing: color(defs(YELLOW) + '<circle cx="5" cy="8" r="3" fill="' + f('ye') + '" stroke="#9A7A12"/><circle cx="5" cy="8" r="1" fill="#fff"/><path d="M8 8h6M12 8v2.4M14 8v1.8"' + st('#9A7A12', 1.5) + '/>'),
  valence: color('<path d="M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5"' + st('#2F6FE0', 1.8) + '/>'),
  log: color(defs(BLUE) + '<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#FFFBE6" stroke="#6F7B8A"/><rect x="2.5" y="1.5" width="11" height="3" fill="' + f('bl') + '" stroke="#2158C8"/><path d="M4.5 7h7M4.5 9.5h7M4.5 12h4" stroke="#7F8A99" stroke-width="1.2"/>'),
  display: color(defs(BLUE, STEEL) + '<rect x="1.5" y="2" width="13" height="9" rx="1" fill="' + f('st') + '" stroke="#3E4856"/><rect x="3" y="3.5" width="10" height="6" fill="' + f('bl') + '"/><path d="M5.5 14h5M8 11v3" stroke="#3E4856" stroke-width="1.5"/>'),
  plugins: color(defs(GREEN) + '<path d="M6 2v3M10 2v3M8 11.5V14"' + st('#6F7B8A', 1.6) + '/><path d="M4.5 5h7v3a3.5 3.5 0 0 1-7 0z" fill="' + f('gr') + '" stroke="#2E7A22"/>'),
  hubs: color(defs(STEEL) + '<rect x="2" y="2.5" width="12" height="4.5" rx="1" fill="' + f('st') + '" stroke="#3E4856"/><rect x="2" y="9" width="12" height="4.5" rx="1" fill="' + f('st') + '" stroke="#3E4856"/><circle cx="4.5" cy="4.75" r=".9" fill="#4BA33A"/><circle cx="4.5" cy="11.25" r=".9" fill="#4BA33A"/>'),
  server: color(defs(BLUE) + '<circle cx="8" cy="8" r="6.3" fill="' + f('bl') + '" stroke="#123E96"/><path d="M4.2 5.2c1.2-.9 2.4-.6 2.8.4.4 1-.8 1.6-.4 2.6.4 1-1 1.4-1.6.6-.7-1-1.7-2.6-.8-3.6zM9.4 9c1.2-.4 2.4.2 2.2 1.4-.2 1.2-1.6 1.8-2.4 1-.6-.6-.8-2 .2-2.4z" fill="#5CC03A" stroke="none"/>' + GLOSS),
  settings: color(defs(PALE, BLUE, GREEN, STEEL) + '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#ECE9D8" stroke="#6F7B8A"/><path d="M4.5 4.5v7M8 4.5v7M11.5 4.5v7" stroke="#B5B2A0"/><rect x="3.4" y="6" width="2.2" height="2" fill="' + f('bl') + '"/><rect x="6.9" y="8.5" width="2.2" height="2" fill="' + f('gr') + '"/><rect x="10.4" y="5" width="2.2" height="2" fill="' + f('st') + '"/>'),
  merge: color('<path d="M4 2.5V6c0 2 4 2 4 4v3.5M12 2.5V6c0 2-4 2-4 4"' + st('#2F6FE0', 1.8) + '/>'),
  about: color(defs(BLUE) + '<circle cx="8" cy="8" r="6.3" fill="' + f('bl') + '" stroke="#123E96"/>' + GLOSS + '<path d="M8 7.2v4"' + st('#fff', 1.8) + '/><circle cx="8" cy="4.9" r="1" fill="#fff"/>'),
};
