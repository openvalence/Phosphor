/**
 * wallpaper.js -- the desktop wallpaper as the Liquid Glass backdrop (docs/THEMES.md, the
 * wallpaper layer). The shell hands it Tauri's `invoke`; the served page never installs it.
 *
 * Constraints:
 * - Reads the wallpaper FILE through src-tauri/src/wallpaper.rs, never a screen capture.
 * - The layer exists, and html[data-wall] is set, only while the picture is really placed. A
 *   slideshow, no path, a failed decode, a theme without `wallpaper`, reduced transparency,
 *   reduced motion (html.still) and a fullscreen page all remove both: the Theme then draws its
 *   material or its opaque look.
 * - Follows the window with a throttled call (move, resize, scale, focus), never per frame; the
 *   image bytes are fetched again only when the file's key changes.
 * - The dim is the layer's own ::after in theme.css (a black overlay, not a filter): a white
 *   wallpaper must still leave the text 4.5:1.
 * - Browser or desktop preference only: nothing here reaches the hub.
 */
import { onTheme, currentTheme, themeMeta } from '../../model/theme.js';
import { place } from './place.js';

const root = document.documentElement;
const THROTTLE_MS = 60;

let invoke = null;
let layer = null;
let key = '';
let url = '';
let size = null;
let gen = 0;
let timer = 0;

const mq = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
const wanted = () => !!themeMeta(currentTheme().style)?.wallpaper
  && !root.hasAttribute('data-page-full') && !root.classList.contains('still')
  && !mq('(prefers-reduced-transparency: reduce)') && !mq('(prefers-reduced-motion: reduce)');

function off() {
  gen++;
  delete root.dataset.wall;
  layer?.remove();
  layer = null;
  if (url) URL.revokeObjectURL(url);
  key = url = '';
  size = null;
}

function paint(info) {
  const p = place(info, size);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'ph-wall';
    layer.setAttribute('aria-hidden', 'true');
    document.body.prepend(layer);
  }
  const s = layer.style;
  s.setProperty('--wurl', 'url(' + url + ')');
  s.setProperty('--wx', p.x + 'px');
  s.setProperty('--wy', p.y + 'px');
  s.setProperty('--ww', p.w + 'px');
  s.setProperty('--wh', p.h + 'px');
  s.setProperty('--wsize', p.size);
  s.setProperty('--wrep', p.repeat);
  s.setProperty('--wpos', p.pos);
  root.dataset.wall = '';
}

const decode = (blobUrl) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight });
  i.onerror = () => no(new Error('wallpaper does not decode'));
  i.src = blobUrl;
});

async function refresh() {
  if (!invoke) return;
  if (!wanted()) { if (layer) off(); return; }
  const mine = ++gen;
  try {
    const info = await invoke('wallpaper_info');
    if (mine !== gen) return;
    if (!info) { off(); return; }
    if (info.key !== key) {
      const bytes = await invoke('wallpaper_image');
      const next = URL.createObjectURL(new Blob([bytes], { type: info.mime }));
      let dims;
      try { dims = await decode(next); } catch (e) { URL.revokeObjectURL(next); throw e; }
      if (mine !== gen) { URL.revokeObjectURL(next); return; }
      if (url) URL.revokeObjectURL(url);
      url = next;
      size = dims;
      key = info.key;
    }
    paint(info);
  } catch (e) {
    if (mine === gen) off();
  }
}

/** A burst of window events becomes a call every THROTTLE_MS, with the last one always made. */
function soon() {
  if (timer) return;
  timer = setTimeout(() => { timer = 0; refresh(); }, THROTTLE_MS);
}

/** Shell only: `tauriInvoke` is Tauri's. */
export async function installWallpaper(tauriInvoke) {
  invoke = tauriInvoke;
  onTheme(refresh);
  new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-page-full', 'class'] });
  for (const q of ['(prefers-reduced-transparency: reduce)', '(prefers-reduced-motion: reduce)']) {
    if (typeof matchMedia === 'function') matchMedia(q).addEventListener('change', refresh);
  }
  addEventListener('focus', soon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    await Promise.all([w.onMoved(soon), w.onResized(soon), w.onScaleChanged(soon)]);
  } catch (e) { /* no window events: the layer still places itself on theme, focus and visibility */ }
  refresh();
}
