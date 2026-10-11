/**
 * index.js -- the arcade: three small games (games.js) on a page that exists only while the Temple
 * theme is applied (docs/THEMES.md, Hidden themes), each able to move the machine through drive.js.
 *
 * Constraints (operator 2026-10-10):
 * - The page registers while <html data-style="temple"> and withdraws when it leaves; no theme, no tab.
 * - Every game plays with no machine. Motion needs the "Allow motion" switch, off on every mount, and
 *   leaves only through drive.js (api.submitSegments). Pause or Halt drops the consent and pauses the game.
 * - Keys are the canvas's own (it takes focus): Space or Enter on a focused stop button never reaches a game.
 * - Losing input stops motion: the window blurred or hidden, the page left, the game over or stopped.
 * - The loop runs on requestAnimationFrame only while a game plays and the page is visible.
 * - Sound is off until the card's Sound button turns it on (api.prefs 'sound').
 * - Never writes a setting.
 */
import { GAMES, W, H, VGA, text } from './games.js';
import { createDrive } from './drive.js';

export const COPY = Object.freeze({
  title: 'Arcade', allow: 'Allow motion', play: 'Play', stop: 'Stop', sound: 'Sound',
  warn: 'Allow motion lets the game move the machine, well inside its limits; Pause or Halt stops it.',
  paused: (why) => 'Motion stopped: ' + why + '. Allow motion again to drive it.',
});
const ICON = 'M3 5.5h10v6H3zM5.5 7.5v2M4.5 8.5h2M10 8h.5M11.5 9.5h.5';
const CSS = `
.arc-page .arc-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
.arc-page .arc-warn { margin: 0; color: var(--tx-mut); font-size: .82rem; }
.arc-page .arc-note { margin: 0; min-height: 1.4em; color: var(--tx); font-size: .82rem; }
.arc-page .arc-map { margin: 0; color: var(--tx-mut); font-size: .82rem; }
.arc-page canvas { display: block; width: min(100%, max(320px, calc((100dvh - 480px) * 4 / 3))); aspect-ratio: 4 / 3;
  image-rendering: pixelated; background: #0000AA; outline: none; touch-action: none; }
.arc-page canvas:focus-visible { outline: 2px dotted var(--highlight); outline-offset: 2px; }
`;

export function createArcade(api) {
  return function mount(el) {
    const ui = api.ui;
    let game = GAMES[0], s = game.create(), playing = false, raf = 0, last = 0, ac = null;
    let sound = api.prefs.get('sound') === true;
    const note = Object.assign(document.createElement('p'), { className: 'arc-note' });
    const map = Object.assign(document.createElement('p'), { className: 'arc-map' });
    const warn = Object.assign(document.createElement('p'), { className: 'arc-warn', textContent: COPY.warn });
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H, tabIndex: 0 });
    cv.setAttribute('aria-label', 'Game screen');
    const g = cv.getContext('2d');

    const drive = createDrive(api, { onStop: (why) => {
      allowSw.value = false;
      if (why) { note.textContent = COPY.paused(why); pause(); }
    } });
    const allowSw = ui.switch({ label: COPY.allow, value: false, onChange: (on) => {
      const why = drive.allow(on);
      if (on && why) { allowSw.value = false; note.textContent = 'Not allowed: ' + why + '.'; return; }
      const mm = on && drive.mmPerS();
      note.textContent = !on ? '' : 'Motion allowed, at most ' + (mm ? Math.round(mm) + ' mm/s' : Math.round(drive.caps().v * 100) + ' % of the stroke a second') + '.';
    } });
    const playBtn = ui.button({ label: COPY.play, tone: 'primary', onClick: () => (playing ? pause() : play()) });
    const pick = ui.segmented({ options: GAMES.map((x) => ({ value: x.id, label: x.name })), value: game.id, onChange: (id) => {
      pause(); drive.stop();
      game = GAMES.find((x) => x.id === id); s = game.create(); intro();
    } });
    const soundBtn = ui.button({ label: COPY.sound, pressed: sound, onClick: () => { sound = soundBtn.pressed; api.prefs.set('sound', sound); } });

    const beep = (hz, ms = 120) => {
      if (!sound || !hz) return;
      try {
        ac = ac || new AudioContext();
        const o = ac.createOscillator(), v = ac.createGain();
        o.type = 'square'; o.frequency.value = hz; v.gain.value = 0.04;
        o.connect(v).connect(ac.destination);
        o.start(); o.stop(ac.currentTime + ms / 1000);
      } catch (e) { /* no audio here */ }
    };
    const intro = () => {
      map.textContent = game.name + ': ' + game.map + '.';
      game.draw(g, s);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 180, W, 120);
      text(g, game.name, 24, 196, VGA.yellow, 3);
      text(g, game.help, 24, 250, VGA.white);
      text(g, 'Click here, then Play or Space.', 24, 270, VGA.ltcyan);
    };
    const frame = (t) => {
      raf = 0;
      if (!playing || document.visibilityState !== 'visible') return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - (last || t)) / 1000);
      last = t;
      const want = game.step(s, dt);
      drive.tick(want);
      if (game.sounding) beep(game.sounding(s));
      game.draw(g, s);
      if (s.over) { beep(131, 300); stop('game over'); }
    };
    function play() {
      if (s.over) s = game.create();
      playing = true; last = 0;
      playBtn.label = COPY.stop;
      cv.focus({ preventScroll: true });
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function pause() {
      playing = false;
      playBtn.label = COPY.play;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function stop(why) { pause(); drive.stop(why); }

    const KEYS = (e) => {
      const down = e.type === 'keydown';
      if (!playing) { if (down && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); play(); } return; }
      if (game.key(s, e.code, down)) e.preventDefault();
    };
    cv.addEventListener('keydown', KEYS);
    cv.addEventListener('keyup', KEYS);
    const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    cv.addEventListener('pointerdown', (e) => { cv.focus({ preventScroll: true }); if (playing) game.point(s, ...at(e), true); });
    cv.addEventListener('pointermove', (e) => { if (playing && e.buttons) game.point(s, ...at(e), true); });
    cv.addEventListener('pointerup', (e) => { if (playing) game.point(s, ...at(e), false); });
    // Input lost: the window or the page goes away, motion stops with it.
    const lost = () => { if (playing || drive.allowed) { stop('input lost'); note.textContent = COPY.paused('input lost'); } };
    const onVis = () => { if (document.visibilityState !== 'visible') lost(); };
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', onVis);

    const card = ui.card({ index: '01', title: COPY.title, actions: [soundBtn] });
    const row = Object.assign(document.createElement('div'), { className: 'arc-row' });
    row.append(allowSw, warn);
    card.body.append(ui.bar({ left: [pick], right: [playBtn] }), row, cv, map, note);
    // A Pause, a Halt or a lost link while allowed drops the consent even between games.
    const offChanged = api.onChanged(['input.target'], () => drive.check());
    const root = ui.page({ main: [card], fill: true, class: 'arc-page' });
    root.prepend(Object.assign(document.createElement('style'), { textContent: CSS }));
    el.append(root);
    intro();

    return {
      update() {},
      unmount() {
        stop('page left');
        if (typeof offChanged === 'function') offChanged();
        window.removeEventListener('blur', lost);
        document.removeEventListener('visibilitychange', onVis);
        try { ac?.close(); } catch (e) { /* closed */ }
        root.remove();
      },
    };
  };
}

export function activate(api) {
  if (typeof document === 'undefined') return undefined;
  const mount = createArcade(api);
  let withdraw = null;
  const sync = () => {
    const on = document.documentElement.dataset.style === 'temple';
    if (on && !withdraw) withdraw = api.registerPage({ id: 'arcade', label: COPY.title, icon: ICON, fill: true, mount });
    else if (!on && withdraw) { withdraw(); withdraw = null; }
  };
  const mo = new MutationObserver(sync);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-style'] });
  sync();
  return () => { mo.disconnect(); if (withdraw) withdraw(); };
}
