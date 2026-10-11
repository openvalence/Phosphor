/**
 * behavior.js -- the Temple theme's live half: the sprite overlay, the title bar's readouts, the
 * oracle (F7) and its optional beeps (docs/THEMES.md, Behavior). Loaded and started by boot.js only
 * while Temple is applied; start() returns the stop that undoes all of it.
 *
 * Constraints (the operator's grant for this theme, 2026-10-10, and the safety rules over it):
 * - The overlay is one canvas, pointer-events none, under the top strip's z-index (30) and drawn
 *   only below its bottom edge: it never covers the stop pair, never takes a click.
 * - Frames run on requestAnimationFrame only while the page is visible, not html.still and not a
 *   fullscreen page; still draws one static frame and requests none. Hidden requests none at all.
 * - The readouts tick once a second while visible; layout is read there and on resize, never per frame.
 * - Keys: F7 only (the oracle). Escape closes the oracle and is never swallowed; boot.js counts it.
 * - Sound is off until the oracle's own toggle turns it on (phosphor.temple.sound).
 * - Nothing here writes to the machine.
 */
import { glyph } from './glyphs.js';

const VGA = ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
  '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'];
// On the white Document variant the light inks swap for dark ones; red and brown are never drawn.
const ON_WHITE = { f: '1', e: '5', b: '3', a: '2', 7: '8', d: '5', 9: '1' };

// Benign words for the oracle: everyday things, weather, colors, small joys. Nothing else belongs here.
const WORDS = ('apple orbit lantern velvet harbor teapot meadow pebble comet willow biscuit marble ' +
  'sunrise kettle feather compass violin glacier honey thimble rainbow cactus lighthouse puzzle ' +
  'acorn breeze candle dolphin ember fern galaxy hammock igloo jasmine kite lemon maple nectar ' +
  'oatmeal paddle quartz ribbon saddle tulip umbrella valley walnut yarn zephyr bicycle cobble ' +
  'drizzle easel fiddle gravel hilltop inkwell jelly koala ladle mitten noodle oyster pinecone ' +
  'quilt radish sparrow thistle unicorn vapor whistle yodel zigzag anchor button clover dusk ' +
  'elbow firefly gumdrop horizon island jigsaw kayak lagoon moonbeam nutmeg otter parsnip ' +
  'raccoon seashell tangerine upbeat voyage waffle yonder blossom cocoa daisy echo fountain ' +
  'garden harmony ivy juniper keystone lullaby mosaic nimbus opal pepper riddle snowflake ' +
  'treble ukulele vanilla wander xylophone yawn zest banjo cinnamon dewdrop elm fable gentle ' +
  'hum indigo jolly kindness laughter melody nest overture patience quiet rhythm sprout ' +
  'thunder unwind verse wonder yes zeal bread river morning circle ladder window garden rocket').split(' ');

const MARQUEE = '*** Phosphor ***  F7 asks the oracle  ***  Escape three times leaves the temple  ***  ' +
  'Settings > Theme picks another  ***  the stop pair never moves  ***  ';

// Sprites: one character a pixel, a hex digit the VGA ink, '.' clear. Two frames each.
const SPRITES = {
  bird: [['f.........f', 'ff.......ff', '.ff.....ff.', '..fffffff..', '...fffffee.', '....fff....'],
    ['...........', '...........', '...fffffee.', '.fffffffff.', 'ff..fff..ff', 'f.........f']],
  walker: [['..ee....', '..ee....', '...f....', '.fffff..', 'f.fff.f.', '..fff...', '..f.f...', '.f...f..'],
    ['..ee....', '..ee....', '...f....', '.fffff..', '.ffff.f.', '..fff...', '...f....', '...ff...']],
  fish: [['...bbbb..b', '.bbbbbbbbb', 'bb0bbbbbb.', '.bbbbbbbbb', '...bbbb..b'],
    ['...bbbb...', '.bbbbbbb.b', 'bb0bbbbbbb', '.bbbbbbb.b', '...bbbb...']],
  star: [['...e...', '...e...', 'eeeeeee', '..eee..', '.ee.ee.', 'e.....e'],
    ['...e...', '..eee..', 'eeeeeee', '..eee..', '.e...e.', '.......']],
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function start({ leave }) {
  const root = document.documentElement;
  const off = [];   // undo list
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

  // ---- the overlay ----------------------------------------------------------------------------
  const cv = document.createElement('canvas');
  cv.className = 'temple-fx';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  off.push(() => cv.remove());
  const g = cv.getContext('2d');
  let W = 0, H = 0, top = 0, bottom = 0;
  const white = () => (root.dataset.variant === 'temple-doc');
  const ink = (c) => VGA[parseInt(white() && ON_WHITE[c] ? ON_WHITE[c] : c, 16)];

  const atlases = new Map();
  const atlas = (color) => {
    let a = atlases.get(color);
    if (a) return a;
    a = document.createElement('canvas');
    a.width = 256 * 8; a.height = 8;
    const x = a.getContext('2d');
    x.fillStyle = color;
    for (let c = 0; c < 256; c++) glyph(c).forEach((row, r) => { for (let k = 0; k < 8; k++) if (row >> k & 1) x.fillRect(c * 8 + k, r, 1, 1); });
    atlases.set(color, a);
    return a;
  };
  const text = (s, x, y, color, shadow) => {
    if (shadow) text(s, x + 1, y + 1, shadow);
    const a = atlas(color);
    for (let i = 0; i < s.length; i++) {
      const cx = x + i * 8;
      if (cx > -8 && cx < W) g.drawImage(a, (s.charCodeAt(i) & 255) * 8, 0, 8, 8, Math.round(cx), Math.round(y), 8, 8);
    }
  };
  const line = (x0, y0, x1, y1) => {   // Bresenham, one logical pixel: no smoothing on a pixel screen
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let n = 0; n < 2000; n++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  };

  const measure = () => {
    W = Math.ceil(innerWidth / 2); H = Math.ceil(innerHeight / 2);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    // Below the top strip and the rail scope: the stop pair and the live position stay clear.
    top = Math.ceil(Math.max(0, ...[...document.querySelectorAll('[data-part="top"], [data-part="hero"]')].map((e) => e.getBoundingClientRect().bottom)) / 2) + 2;
    const foot = document.querySelector('[data-part="status-row"]')?.getBoundingClientRect().top;
    bottom = Math.floor((foot && foot > 0 ? foot : innerHeight) / 2) - 2;
  };

  // The cast: sprites that bounce, two worms, a cube, a squirming banner, the marquee.
  const cast = Object.keys(SPRITES).concat(['bird', 'fish']).map((k) => ({ k, x: rnd(0, 600), y: rnd(0, 400), vx: rnd(14, 34) * pick([1, -1]), vy: rnd(8, 22) * pick([1, -1]) }));
  const worms = [0, 1].map((i) => ({ a: rnd(0, 6.3), x: rnd(50, 500), y: rnd(150, 350), body: [], c: i ? 'a' : 'd' }));
  const banner = { word: 'PHOSPHOR', x: 40, y: 0, vx: 18, vy: 9 };
  let marqueeText = MARQUEE;
  let frames = 0, calls = 0;
  let last = 0;

  const step = (dt, t) => {
    const lo = top, hi = Math.max(top + 10, bottom);
    for (const s of cast) {
      const f = SPRITES[s.k][0], w = f[0].length * 2, h = f.length * 2;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx); } else if (s.x > W - w) { s.x = W - w; s.vx = -Math.abs(s.vx); }
      if (s.y < lo) { s.y = lo; s.vy = Math.abs(s.vy); } else if (s.y > hi - h) { s.y = hi - h; s.vy = -Math.abs(s.vy); }
    }
    for (const m of worms) {
      m.a += rnd(-0.5, 0.5);
      m.x += Math.cos(m.a) * 30 * dt; m.y += Math.sin(m.a) * 30 * dt;
      if (m.x < 4 || m.x > W - 4) m.a = Math.PI - m.a;
      if (m.y < lo + 4 || m.y > hi - 4) m.a = -m.a;
      m.x = Math.min(W - 4, Math.max(4, m.x)); m.y = Math.min(hi - 4, Math.max(lo + 4, m.y));
      m.body.unshift([m.x | 0, m.y | 0]);
      m.body.length = Math.min(m.body.length, 40);
    }
    const bw = banner.word.length * 16;
    banner.x += banner.vx * dt; banner.y += banner.vy * dt;
    if (banner.x < 0) banner.vx = Math.abs(banner.vx); else if (banner.x > W - bw) banner.vx = -Math.abs(banner.vx);
    if (banner.y < lo + 6) banner.vy = Math.abs(banner.vy); else if (banner.y > hi - 24) banner.vy = -Math.abs(banner.vy);
    banner.y = Math.min(Math.max(banner.y, lo + 6), Math.max(lo + 6, hi - 24));
  };

  const draw = (t) => {
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.rect(0, top, W, Math.max(0, bottom - top)); g.clip();   // nothing above the top strip's edge
    // the worms
    for (const m of worms) { g.fillStyle = ink(m.c); m.body.forEach(([x, y], i) => { if (i % 2 === 0) g.fillRect(x, y + Math.round(Math.sin(t * 6 + i * 0.7)), 2, 2); }); }
    // the sprites, two frames each
    for (const s of cast) {
      const f = SPRITES[s.k][Math.floor(t * 4 + s.x / 50) & 1];
      const flip = s.vx < 0;
      f.forEach((row, r) => { for (let k = 0; k < row.length; k++) { const c = row[flip ? row.length - 1 - k : k]; if (c !== '.') { g.fillStyle = ink(c); g.fillRect((s.x | 0) + k * 2, (s.y | 0) + r * 2, 2, 2); } } });
    }
    // the cube: a wireframe on a Lissajous path, the demos' favorite
    const cx = W * (0.5 + 0.35 * Math.sin(t * 0.21)), cy = top + (bottom - top) * (0.5 + 0.3 * Math.sin(t * 0.33 + 1)), sz = 14;
    const pts = [];
    for (let i = 0; i < 8; i++) {
      let x = i & 1 ? sz : -sz, y = i & 2 ? sz : -sz, z = i & 4 ? sz : -sz;
      const a = t * 0.9, b = t * 0.6;
      [x, z] = [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
      [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];
      const p = 90 / (90 + z);
      pts.push([cx + x * p, cy + y * p]);
    }
    g.fillStyle = ink('b');
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) line(...pts[i], ...pts[i | bit]);
    // the banner: every pixel column squirms on its own
    banner.word.split('').forEach((ch, i) => {
      g.fillStyle = ink('9abdef'[(i + Math.floor(t * 3)) % 6]);
      glyph(ch.charCodeAt(0)).forEach((row, r) => {
        for (let k = 0; k < 8; k++) if (row >> k & 1) {
          const col = i * 8 + k;
          g.fillRect((banner.x | 0) + col * 2, (banner.y | 0) + r * 2 + Math.round(Math.sin(t * 5 + col * 0.45) * 3), 2, 2);
        }
      });
    });
    g.restore();
    // the marquee, just above the status row
    const mw = marqueeText.length * 8;
    const mx = W - ((t * 40) % (mw + W));
    text(marqueeText, mx, bottom - 10, ink('e'), white() ? null : '#000000');
  };

  const still = () => root.classList.contains('still');
  // The arcade's page (plugins/factory/arcade) gets a clear screen: no sprites over a game.
  let quiet = false;
  const live = () => document.visibilityState === 'visible' && !still() && !quiet && !root.hasAttribute('data-page-full');
  let raf = 0, t0 = performance.now();
  const tick = (now) => {
    raf = 0;
    calls++;
    if (!live()) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 33) return;   // ~30 frames a second is plenty for a 1990s screen
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    if (frames++ % 15 === 0) { measure(); quiet = !!document.querySelector('.arc-page'); }   // the strip's edge, twice a second: layout is never read per frame
    step(dt, (now - t0) / 1000);
    draw((now - t0) / 1000);
  };
  const kick = () => {
    if (live()) { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } return; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (document.visibilityState === 'visible') { measure(); step(0, 0); draw(0); }   // still: one static frame
  };
  on(document, 'visibilitychange', () => { kick(); tickBar(); });
  on(window, 'resize', () => { measure(); if (!raf) kick(); });
  const mo = new MutationObserver(kick);
  mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-page-full', 'data-variant'] });
  off.push(() => mo.disconnect());
  off.push(() => { if (raf) cancelAnimationFrame(raf); raf = 0; });

  // ---- the title bar's readouts: date, time, CPU, memory, tasks (one string, once a second) ------
  let busy = 0, lastBar = performance.now();
  let po = null;
  try {
    po = new PerformanceObserver((l) => { for (const e of l.getEntries()) busy += e.duration; });
    po.observe({ type: 'longtask', buffered: false });
    off.push(() => po.disconnect());
  } catch (e) { po = null; }
  const tickBar = () => {
    if (document.visibilityState !== 'visible') return;
    const now = performance.now(), span = Math.max(1, now - lastBar);
    const cpu = Math.min(99, Math.round(busy / span * 100 + Math.max(0, span - 1000) / 10));
    busy = 0; lastBar = now;
    const d = new Date();
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'M' : '--';
    const tasks = document.querySelectorAll('[data-part="card"], [data-part="nest"], [data-part="panel"]').length;
    const s = DAYS[d.getDay()] + ' ' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
      + '  CPU ' + String(cpu).padStart(2, ' ') + '%  Mem ' + mem + '  Tasks ' + tasks;
    root.style.setProperty('--temple-wm', JSON.stringify(s));
    measure();
    const q = !!document.querySelector('.arc-page');
    if (q !== quiet) { quiet = q; kick(); }
    if (!raf) draw(0);   // still: the static frame follows the layout
  };
  const iv = setInterval(tickBar, 1000);
  off.push(() => { clearInterval(iv); root.style.removeProperty('--temple-wm'); });

  // ---- sound: square-wave beeps, off until asked for -------------------------------------------
  let sound = false;
  try { sound = localStorage.getItem('phosphor.temple.sound') === '1'; } catch (e) { /* off */ }
  let ac = null;
  const beep = (n) => {
    if (!sound) return;
    try {
      ac = ac || new AudioContext();
      const at = ac.currentTime;
      for (let i = 0; i < n; i++) {
        const o = ac.createOscillator(), v = ac.createGain();
        o.type = 'square';
        o.frequency.value = 262 * 2 ** (pick([0, 2, 4, 7, 9, 12]) / 12);
        v.gain.value = 0.035;
        o.connect(v).connect(ac.destination);
        o.start(at + i * 0.14); o.stop(at + i * 0.14 + 0.11);
      }
    } catch (e) { /* no audio here */ }
  };
  off.push(() => { try { ac?.close(); } catch (e) { /* closed */ } });

  // ---- the oracle (F7) --------------------------------------------------------------------------
  let win = null;
  const say = () => {
    const words = Array.from({ length: 12 }, () => pick(WORDS));
    banner.word = words[0].toUpperCase().slice(0, 10);
    marqueeText = 'God says: ' + words.join(' ') + '  ***  ' + MARQUEE;
    return words.join(' ');
  };
  const close = () => { win?.remove(); win = null; };
  const oracle = () => {
    if (!win) {
      win = document.createElement('div');
      win.className = 'temple-win temple-oracle';
      win.setAttribute('role', 'dialog');
      win.setAttribute('aria-label', 'God says');
      win.innerHTML = '<div class="temple-tb"><span class="temple-title">God says</span>'
        + '<button type="button" class="temple-x" aria-label="Close">[X]</button></div>'
        + '<p class="temple-words"></p>'
        + '<div class="temple-links"><button type="button" class="temple-lk" data-do="again">Again (F7)</button>'
        + '<button type="button" class="temple-lk" data-do="sound"></button></div>';
      win.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.classList.contains('temple-x')) close();
        else if (b.dataset.do === 'again') oracle();
        else if (b.dataset.do === 'sound') {
          sound = !sound;
          try { localStorage.setItem('phosphor.temple.sound', sound ? '1' : '0'); } catch (err) { /* this session only */ }
          paint();
          beep(3);
        }
      });
      document.body.appendChild(win);
    }
    measure();
    win.style.top = (top * 2 + 24) + 'px';
    win.querySelector('.temple-words').textContent = say();
    paint();
    beep(6);
  };
  const paint = () => {
    const b = win?.querySelector('[data-do="sound"]');
    if (b) { b.textContent = 'Sound: ' + (sound ? 'On' : 'Off'); b.setAttribute('aria-pressed', String(sound)); }
  };
  off.push(close);
  on(window, 'keydown', (e) => {
    if (e.key === 'F7') { e.preventDefault(); oracle(); }
    else if (e.key === 'Escape' && win) close();
  });

  measure();
  tickBar();
  kick();
  // Test and console hooks: counters and a way to pin a sprite (test/theme-temple.test.mjs).
  window.__temple = { get frames() { return frames; }, get calls() { return calls; }, cast, oracle, leave,
    place: (i, x, y) => { const s = cast[i % cast.length]; s.x = x / 2; s.y = y / 2; s.vx = s.vy = 0; draw((performance.now() - t0) / 1000); } };
  off.push(() => { delete window.__temple; });
  return () => { for (const f of off.reverse()) { try { f(); } catch (e) { /* best effort */ } } };
}
