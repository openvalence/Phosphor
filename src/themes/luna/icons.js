import { color, st } from '../kit.js';

/** Luna: small flat icons in a blue, green, yellow and steel palette. */
export default {
  machine: color('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#fff" stroke="#2158C8"/><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 14.5 4v1.5h-13z" fill="#2F6FE0"/><rect x="3.5" y="7.2" width="4" height="2.4" fill="#4BA33A"/><rect x="8.5" y="7.2" width="4" height="2.4" fill="#F2C230"/><rect x="3.5" y="10.4" width="4" height="1.8" fill="#2F6FE0"/><rect x="8.5" y="10.4" width="4" height="1.8" fill="#7F8A99"/>'),
  generator: color('<rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="#E8F1FF" stroke="#2158C8"/><path d="M3 8.5q1.3-4 2.6 0t2.6 0t2.6 0t2.6 0"' + st('#2F6FE0', 1.6) + '/>'),
  motion: color('<path d="M2 8h12M5 5L2 8l3 3M11 5l3 3-3 3"' + st('#2F6FE0', 1.9) + '/>'),
  safety: color('<path d="M8 1.5l5.5 2v4.2c0 3.3-2.4 5.5-5.5 6.8-3.1-1.3-5.5-3.5-5.5-6.8V3.5z" fill="#2F6FE0" stroke="#123E96"/><path d="M5.5 8l1.8 1.8L10.8 6"' + st('#fff', 1.6) + '/>'),
  limits: color('<rect x="1.5" y="5" width="13" height="6" rx="1" fill="#F2C230" stroke="#9A7A12"/><path d="M4 5v2.5M6.5 5v1.8M9 5v2.5M11.5 5v1.8" stroke="#6B520C"/>'),
  playback: color('<circle cx="8" cy="8" r="6.5" fill="#4BA33A" stroke="#2E7A22"/><path d="M6.4 4.9v6.2L11.4 8z" fill="#fff"/>'),
  auxiliary: color('<path d="M8 1.8C10.4 5 12.2 7 12.2 9.4a4.2 4.2 0 0 1-8.4 0C3.8 7 5.6 5 8 1.8z" fill="#5AA2F0" stroke="#2158C8"/>'),
  automation: color('<circle cx="8" cy="8" r="6.3" fill="#fff" stroke="#2158C8" stroke-width="1.4"/><path d="M8 4.2V8l2.6 1.6"' + st('#123E96', 1.5) + '/>'),
  hardware: color('<rect x="4" y="4" width="8" height="8" rx="1" fill="#6F7B8A" stroke="#3E4856"/><path d="M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2" stroke="#3E4856" stroke-width="1.3"/><rect x="6" y="6" width="4" height="4" fill="#C9D3E0"/>'),
  network: color('<path d="M1.8 6.2a9 9 0 0 1 12.4 0M4.1 8.8a5.7 5.7 0 0 1 7.8 0"' + st('#2F6FE0') + '/><circle cx="8" cy="11.8" r="1.4" fill="#4BA33A"/>'),
  session: color('<circle cx="8" cy="5" r="2.8" fill="#F2C99A" stroke="#9A6B3A"/><path d="M2.8 14c.4-3 2.4-4.6 5.2-4.6s4.8 1.6 5.2 4.6z" fill="#2F6FE0" stroke="#123E96"/>'),
  system: color('<rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="#173A23" stroke="#3E4856"/><path d="M2.5 8.5h3l1.2-3 2.2 6 1.3-3h3.3"' + st('#5CF08A', 1.4) + '/>'),
  other: color('<rect x="2" y="2" width="5.5" height="5.5" rx="1" fill="#2F6FE0"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="1" fill="#4BA33A"/><rect x="2" y="8.5" width="5.5" height="5.5" rx="1" fill="#F2C230"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" fill="#7F8A99"/>'),
  setup: color('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6F7B8A"/><path d="M4.4 5l1 1 1.8-2M4.4 9l1 1 1.8-2"' + st('#4BA33A', 1.4) + '/><path d="M8.6 5h3.2M8.6 9h3.2" stroke="#7F8A99" stroke-width="1.3"/>'),
  pairing: color('<circle cx="5" cy="8" r="3" fill="#F2C230" stroke="#9A7A12"/><circle cx="5" cy="8" r="1" fill="#fff"/><path d="M8 8h6M12 8v2.4M14 8v1.8"' + st('#9A7A12', 1.5) + '/>'),
  valence: color('<path d="M6.5 9.5l3-3M7 4.75L8.25 3.5a2.65 2.65 0 0 1 3.75 3.75L10.75 8.5M9 11.25L7.75 12.5A2.65 2.65 0 0 1 4 8.75L5.25 7.5"' + st('#2F6FE0', 1.8) + '/>'),
  log: color('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#FFFBE6" stroke="#6F7B8A"/><rect x="2.5" y="1.5" width="11" height="3" fill="#2F6FE0" stroke="#2158C8"/><path d="M4.5 7h7M4.5 9.5h7M4.5 12h4" stroke="#7F8A99" stroke-width="1.2"/>'),
  display: color('<rect x="1.5" y="2" width="13" height="9" rx="1" fill="#2F6FE0" stroke="#3E4856"/><rect x="3" y="3.5" width="10" height="6" fill="#9CC4FA"/><path d="M5.5 14h5M8 11v3" stroke="#3E4856" stroke-width="1.5"/>'),
  plugins: color('<path d="M6 2v3M10 2v3M8 11.5V14"' + st('#6F7B8A', 1.6) + '/><path d="M4.5 5h7v3a3.5 3.5 0 0 1-7 0z" fill="#4BA33A" stroke="#2E7A22"/>'),
  hubs: color('<rect x="2" y="2.5" width="12" height="4.5" rx="1" fill="#C9D3E0" stroke="#3E4856"/><rect x="2" y="9" width="12" height="4.5" rx="1" fill="#C9D3E0" stroke="#3E4856"/><circle cx="4.5" cy="4.75" r=".9" fill="#4BA33A"/><circle cx="4.5" cy="11.25" r=".9" fill="#4BA33A"/>'),
  server: color('<circle cx="8" cy="8" r="6.3" fill="#5AA2F0" stroke="#2158C8"/><path d="M1.8 8h12.4M8 1.7c-2.6 2.4-2.6 10.2 0 12.6M8 1.7c2.6 2.4 2.6 10.2 0 12.6" fill="none" stroke="#fff"/>'),
  settings: color('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#ECE9D8" stroke="#6F7B8A"/><path d="M4.5 4.5v7M8 4.5v7M11.5 4.5v7" stroke="#B5B2A0"/><rect x="3.4" y="6" width="2.2" height="2" fill="#2F6FE0"/><rect x="6.9" y="8.5" width="2.2" height="2" fill="#4BA33A"/><rect x="10.4" y="5" width="2.2" height="2" fill="#7F8A99"/>'),
  merge: color('<path d="M4 2.5V6c0 2 4 2 4 4v3.5M12 2.5V6c0 2-4 2-4 4"' + st('#2F6FE0', 1.8) + '/>'),
  about: color('<circle cx="8" cy="8" r="6.3" fill="#2F6FE0" stroke="#123E96"/><path d="M8 7.2v4"' + st('#fff', 1.8) + '/><circle cx="8" cy="4.9" r="1" fill="#fff"/>'),
};
