/**
 * web.js -- the web builds (docs/BUILD.md, Web builds): `vite build --mode web` is Phosphor in a browser tab,
 * `--mode demo` the stripped demo the website embeds. Both join Neutrino, the built-in machine, on load.
 *
 * Constraints:
 * - Neutrino is the only machine a web build reaches: an https page cannot open ws:// to a LAN hub, and a
 *   browser has no UDP discovery, Buttplug server or file system. Nothing here dials a network host.
 * - The demo keeps its browser state under DEMO_PREFIX (storage.js), so Reset clears only the demo's keys.
 * - Embedded (?embed, the website's hero), the page never scrolls on its own, so a swipe over it scrolls the
 *   embedding page; it posts {phosphor: 'ready' | 'failed'} to its parent.
 * - The page follows the embedding page's scheme (?theme=, then postMessage {theme}), else the system's at load,
 *   only while the applied theme is one of the two defaults: a visitor's own pick stands.
 */
import { connect, machine } from '../model/machine.svelte.js';
import { bootNeutrino, STATE_KEY } from '../model/neutrino-boot.js';
import { BUILTIN_MACHINE_NAME } from '../model/builtin.js';
import { writeSetting } from '../model/shadow.svelte.js';
import { applyTheme, currentTheme } from '../model/theme.js';
import { demoStorage } from './storage.js';

const DEMO = import.meta.env.MODE === 'demo';
const SCHEME = { dark: 'phosphor', light: 'paper' };

export async function startBuiltin() {
  let fresh = true;
  try { fresh = !localStorage.getItem(STATE_KEY); } catch { /* no storage: every load is the first */ }
  const { bridge, up } = bootNeutrino({ homed: true, pairing_window: true });
  try { await up; } catch (e) {
    tell('failed');
    machine.events.log.push({ channel: null, channelName: BUILTIN_MACHINE_NAME, at: Date.now(), body: { level: 4, tag: BUILTIN_MACHINE_NAME, message: 'failed to start: ' + e.message } });
    return;
  }
  connect({ host: 'builtin', label: BUILTIN_MACHINE_NAME, WebSocketImpl: bridge.WebSocket, token: bridge.token });
  if (DEMO) autostart(fresh);
  const t = setInterval(() => {
    if (!machine.catalog.ready) return;
    clearInterval(t);
    requestAnimationFrame(() => requestAnimationFrame(() => tell('ready')));
  }, 100);
}

// The embedding page (the website's hero, ?embed) shows the page over its poster on 'ready' and keeps the
// poster on 'failed'. Nothing else leaves the page.
const EMBED = new URLSearchParams(location.search).has('embed');
if (EMBED) document.documentElement.classList.add('embed');
function tell(state) {
  if (EMBED && window.parent !== window) window.parent.postMessage({ phosphor: state }, '*');
}

// The demo opens running: Advanced starts once the catalog is in and the session can write. A first load (no
// saved machine) gets a stroke worth watching first. Reduced motion: still.
const SEED = [['advgen.master', 50], ['advgen.depth_max', 85], ['advgen.depth_min', 15]];
function autostart(fresh) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const field = (role) => machine.catalog.model?.byRole.get(role)?.[0];
  const t = setInterval(() => {
    const run = field('advgen.running');
    if (!run || machine.link.phase !== 'live' || !machine.link.roles) return;
    clearInterval(t);
    if (fresh) for (const [role, v] of SEED) writeSetting(field(role), v);
    writeSetting(run, true);
  }, 100);
  setTimeout(() => clearInterval(t), 20000);
}

/** The embedding page's (or the system's) light or dark, onto the default themes only. */
export function followScheme() {
  const set = (s) => {
    if (SCHEME[s] && Object.values(SCHEME).includes(currentTheme().id)) applyTheme(SCHEME[s], { persist: false });
  };
  const sys = matchMedia('(prefers-color-scheme: light)');
  set(new URLSearchParams(location.search).get('theme') || (sys.matches ? 'light' : 'dark'));
  addEventListener('message', (e) => { if (e.data && typeof e.data.theme === 'string') set(e.data.theme); });
}

/** Back to the demo's first load: its keys gone, Neutrino booted fresh. */
export function resetDemo() {
  demoStorage?.clear();
  location.reload();
}
