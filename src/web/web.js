/**
 * web.js -- the web builds (docs/BUILD.md, Web builds): `vite build --mode web` is Phosphor in a browser tab,
 * `--mode mini` the stripped, memory-only demo the website embeds (at /mini/). Both join Neutrino, the built-in machine, on load.
 *
 * Constraints:
 * - Neutrino is the only machine a web build reaches: an https page cannot open ws:// to a LAN hub, and a
 *   browser has no UDP discovery, Buttplug server or file system. Nothing here dials a network host.
 * - The mini build keeps all state in memory (storage.js): a reload, and so Reset, is a first load.
 * - Embedded (?embed, the website's hero), the page never scrolls on its own, so a swipe over it scrolls the
 *   embedding page; it posts {phosphor: 'ready' | 'failed'} to its parent and takes {phosphor: 'pause' |
 *   'resume'} from it (off screen, or its tab hidden).
 * - Neutrino's clock never runs while this page is hidden or paused: no battery spent on a machine nobody sees.
 * - The page follows the embedding page's scheme (?theme=, then postMessage {theme}), else the system's at load,
 *   only while the applied theme is one of the two defaults: a visitor's own pick stands.
 */
import { connect, machine } from '../model/machine.svelte.js';
import { bootNeutrino, STATE_KEY } from '../model/neutrino-boot.js';
import { BUILTIN_MACHINE_NAME } from '../model/builtin.js';
import { writeSetting, displayValue } from '../model/shadow.svelte.js';
import { applyTheme, currentTheme } from '../model/theme.js';
import { setMinimized } from '../ui/still.svelte.js';

const DEMO = import.meta.env.MODE === 'mini';
const SCHEME = { dark: 'phosphor', light: 'paper' };

export async function startBuiltin() {
  let fresh = true;
  try { fresh = !localStorage.getItem(STATE_KEY); } catch { /* no storage: every load is the first */ }
  const { bridge, up } = bootNeutrino({ homed: true, pairing_window: true });
  machineBridge = bridge;
  sync();
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

// Paused (the embedding page's 'pause', or this page hidden), Neutrino's clock stops. The embed's pause also
// reads as a hidden page, so every hidden-tab rule applies as it is: machine.svelte.js says goodbye and comes
// back with one warm reconnect on resume, Health and the frame-rate probe stand down; the ambient motion stops as
// for a minimized window (still.svelte.js). The goodbye stops the controller's pattern (the hub's rule), so a
// pattern running at the pause is started again on the way back.
let machineBridge = null, embedPaused = false, stopped = false, rerun = false;
const VIS = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
function sync() {
  const want = embedPaused || VIS.get.call(document) !== 'visible';
  if (!machineBridge || want === stopped) return;
  stopped = want;
  if (want) rerun = !!valueOf('advgen.running');
  machineBridge.post({ op: want ? 'pause' : 'resume' });
  setMinimized(want);
  // Embedded and paused, nothing is drawn (WebNote.svelte): the cards' idle redraws cost more than the rest.
  document.documentElement.toggleAttribute('data-paused', want && EMBED);
  if (!want && rerun) whenLive(() => writeSetting(field('advgen.running'), true));
}
// Registered before connect() installs the session's own listener: the clock runs again before the reconnect.
document.addEventListener('visibilitychange', sync);
if (EMBED) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (embedPaused ? 'hidden' : VIS.get.call(document)) });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => document.visibilityState !== 'visible' });
  addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || (e.data.phosphor !== 'pause' && e.data.phosphor !== 'resume')) return;
    const want = e.data.phosphor === 'pause';
    if (want === embedPaused) return;
    embedPaused = want;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
function tell(state) {
  if (EMBED && window.parent !== window) window.parent.postMessage({ phosphor: state }, '*');
}

const field = (role) => machine.catalog.model?.byRole.get(role)?.[0];
const valueOf = (role) => { const f = field(role); return f ? displayValue(f, machine.samples[f.channelId]) : undefined; };
// The rail's length: what homing measured, else the configured travel.
const railMm = () => Number(valueOf('geometry.measured_travel')) || Number(valueOf('geometry.max_travel')) || 0;

/** fn once the session can write and the rail is known (20 s at most). */
function whenLive(fn) {
  const t = setInterval(() => {
    if (!field('advgen.running') || machine.link.phase !== 'live' || !machine.link.roles || !railMm()) return;
    clearInterval(t);
    fn();
  }, 100);
  setTimeout(() => clearInterval(t), 20000);
}

// The demo opens running: Advanced starts once the catalog is in and the session can write. A first load (no
// saved machine, and so after Reset demo) gets a stroke worth watching first: the middle half of the rail as
// the window and the full depth in it (the window, not the depths, makes the stroke smaller). Demo only:
// Neutrino's own defaults stand. Reduced motion: still.
const SEED = [['advgen.master', 50], ['advgen.depth_max', 100], ['advgen.depth_min', 0]];
function autostart(fresh) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  whenLive(() => {
    if (fresh) {
      const mm = railMm();
      writeSetting(field('window.min'), Math.round(mm * 0.25));
      writeSetting(field('window.max'), Math.round(mm * 0.75));
      for (const [role, v] of SEED) writeSetting(field(role), v);
    }
    writeSetting(field('advgen.running'), true);
  });
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

/** Back to the demo's first load: the page's state is memory only, so a reload is one. */
export function resetDemo() {
  location.reload();
}
