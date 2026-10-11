/**
 * games.js -- three small games in the spirit of the TempleOS demos, drawn on a 640 x 480 canvas in
 * the sixteen VGA colors (red and brown left out) and the Temple theme's 8 x 8 face. Written fresh.
 *
 * A game is { id, name, help, map, create(), key(s, code, down), point(s, x, y, down), step(s, dt), draw(g, s) }.
 * step returns where the game wants the carriage, 0..1 (drive.js limits and sends it), and sets s.over.
 * Pure but for the canvas: no timers, no DOM, no audio (index.js owns those).
 */
export const VGA = { black: '#000000', blue: '#0000AA', green: '#00AA00', cyan: '#00AAAA', purple: '#AA00AA', ltgray: '#AAAAAA',
  dkgray: '#555555', ltblue: '#5555FF', ltgreen: '#55FF55', ltcyan: '#55FFFF', ltpurple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF' };
export const W = 640, H = 480;
const FONT = "12px 'Temple Sys', 'Lucida Console', monospace";
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function text(g, s, x, y, color = VGA.white, scale = 1) {
  g.font = scale === 1 ? FONT : (12 * scale) + "px 'Temple Sys', 'Lucida Console', monospace";
  g.textBaseline = 'top';
  g.fillStyle = color;
  g.fillText(s, x, y);
}
/** Pixel art: one character a pixel, a key of VGA, '.' clear. */
function sprite(g, rows, x, y, px, inks) {
  rows.forEach((row, r) => { for (let k = 0; k < row.length; k++) { const c = row[k]; if (c !== '.') { g.fillStyle = inks[c]; g.fillRect(x + k * px, y + r * px, px, px); } } });
}

// ---- Road: a pseudo-3D road; the car's place across it is the carriage's place in the window --------
const CAR = ['..yyyy..', '.yccccy.', 'yyyyyyyy', 'yywwwwyy', 'kk....kk'];
const CAR_INK = { y: VGA.yellow, c: VGA.ltcyan, w: VGA.white, k: VGA.black };
const road = {
  id: 'road', name: 'Road', map: 'the car across the road is the carriage across the stroke',
  help: 'Left and Right steer, or point. Stay on the road; checkpoints add time.',
  create: () => ({ x: 0, speed: 0, dist: 0, time: 45, next: 2000, steer: 0, keys: {}, over: false, score: 0 }),
  key(s, code, down) {
    if (['ArrowLeft', 'KeyA'].includes(code)) s.keys.l = down;
    else if (['ArrowRight', 'KeyD'].includes(code)) s.keys.r = down;
    else return false;
    return true;
  },
  point(s, x, y, down) { s.aim = down ? clamp((x - W / 2) / (W * 0.35), -1, 1) : null; },
  curve: (z) => Math.sin(z / 900) * 0.9 + Math.sin(z / 370 + 1) * 0.5,
  step(s, dt) {
    if (s.over) return (s.x + 1) / 2;
    const steer = s.aim != null ? clamp((s.aim - s.x) * 3, -1, 1) : (s.keys.r ? 1 : 0) - (s.keys.l ? 1 : 0);
    const off = Math.abs(s.x) > 1;
    s.speed = clamp(s.speed + (off ? -260 : 90) * dt, 60, off ? 160 : 420);
    s.x += steer * 1.5 * dt - road.curve(s.dist) * s.speed / 420 * 0.9 * dt;
    s.x = clamp(s.x, -1.6, 1.6);
    s.dist += s.speed * dt;
    s.time -= dt;
    if (s.dist >= s.next) { s.next += 2000; s.time += 12; }
    s.score = Math.floor(s.dist / 10);
    if (s.time <= 0) { s.time = 0; s.over = true; }
    return clamp((s.x + 1) / 2, 0, 1);
  },
  draw(g, s) {
    const hz = 200;
    g.fillStyle = VGA.blue; g.fillRect(0, 0, W, hz);
    g.fillStyle = VGA.yellow; g.fillRect(500, 60, 40, 40);
    for (let y = H - 2; y >= hz; y -= 2) {
      const p = (y - hz) / (H - hz), z = s.dist + 18 / Math.max(p, 0.02);
      const bend = road.curve(z) * (1 - p) * (1 - p) * 260;
      const cx = W / 2 + bend - s.x * 180 * p, w = 30 + p * 520;
      const band = Math.floor(z / 40) & 1;
      g.fillStyle = band ? VGA.green : VGA.ltgreen; g.fillRect(0, y, W, 2);
      g.fillStyle = band ? VGA.white : VGA.ltgray; g.fillRect(cx - w / 2 - w * 0.08, y, w * 1.16, 2);
      g.fillStyle = VGA.dkgray; g.fillRect(cx - w / 2, y, w, 2);
      if (band) { g.fillStyle = VGA.white; g.fillRect(cx - w * 0.01, y, w * 0.02, 2); }
    }
    sprite(g, CAR, W / 2 - 32, H - 70, 8, CAR_INK);
    text(g, 'Time ' + Math.ceil(s.time), 8, 8, VGA.yellow, 2);
    text(g, 'Dist ' + s.score, W - 200, 8, VGA.white, 2);
    if (s.over) text(g, 'Time is up. Score ' + s.score, 120, 220, VGA.yellow, 2);
  },
};

// ---- Bat: flap through the towers; the bat's height is the carriage's place ---------------------------
const BAT = [['p.....p', 'pp...pp', 'ppp.ppp', '.ppppp.', '..pyp..'], ['.......', '.......', 'ppppppp', 'ppppppp', '..pyp..']];
const BAT_INK = { p: VGA.ltpurple, y: VGA.yellow };
const bat = {
  id: 'bat', name: 'Bat', map: 'the bat\'s height is the carriage\'s place in the stroke',
  help: 'Space, Up or a click flaps. Fly through the gaps.',
  create: () => ({ y: H / 2, vy: 0, towers: [], t: 0, over: false, score: 0, flap: 0 }),
  key(s, code, down) {
    if (!['Space', 'ArrowUp', 'KeyW'].includes(code)) return false;
    if (down && !s.over) { s.vy = -300; s.flap = 0.15; }
    return true;
  },
  point(s, x, y, down) { if (down && !s.over) { s.vy = -300; s.flap = 0.15; } },
  step(s, dt) {
    if (s.over) return clamp(1 - s.y / H, 0, 1);
    s.t += dt;
    s.flap = Math.max(0, s.flap - dt);
    s.vy = Math.min(420, s.vy + 800 * dt);
    s.y += s.vy * dt;
    if (!s.towers.length || s.towers[s.towers.length - 1].x < W - 260) s.towers.push({ x: W + 40, gap: 120 + Math.random() * (H - 300), done: false });
    for (const t of s.towers) {
      t.x -= 130 * dt;
      if (!t.done && t.x + 60 < 120) { t.done = true; s.score++; }
      if (t.x < 150 && t.x + 60 > 100 && (s.y < t.gap || s.y + 20 > t.gap + 150)) s.over = true;
    }
    s.towers = s.towers.filter((t) => t.x > -80);
    if (s.y < 0 || s.y > H - 24) { s.y = clamp(s.y, 0, H - 24); s.over = true; }
    return clamp(1 - s.y / H, 0, 1);
  },
  draw(g, s) {
    g.fillStyle = VGA.blue; g.fillRect(0, 0, W, H);
    g.fillStyle = VGA.white; g.beginPath(); g.arc(540, 80, 30, 0, 7); g.fill();
    g.fillStyle = VGA.blue; g.beginPath(); g.arc(528, 72, 28, 0, 7); g.fill();
    for (const t of s.towers) {
      for (const [y0, y1] of [[0, t.gap], [t.gap + 150, H]]) {
        g.fillStyle = VGA.ltgray; g.fillRect(t.x, y0, 60, y1 - y0);
        g.fillStyle = VGA.dkgray;
        for (let y = y0; y < y1; y += 12) for (let x = ((y / 12) & 1) * 10; x < 60; x += 20) g.fillRect(t.x + x, y, 2, 12), g.fillRect(t.x, y, 60, 2);
      }
    }
    sprite(g, BAT[s.flap > 0 ? 1 : 0], 110, s.y, 4, BAT_INK);
    text(g, 'Score ' + s.score, 8, 8, VGA.yellow, 2);
    if (s.over) text(g, 'The bat rests. Score ' + s.score, 100, 220, VGA.yellow, 2);
  },
};

// ---- Song: an endless square-wave tune; each note's pitch is the carriage's place -----------------------
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];   // two pentatonic octaves
const song = {
  id: 'song', name: 'Song', map: 'each note\'s pitch is the carriage\'s place in the stroke',
  help: 'Up and Down move the tune\'s register; Space starts a new tune; 1 to 0 play a note next.',
  create: () => ({ notes: [], at: 0, t: 0, bias: 0, over: false, score: 0, queued: null, sounded: -1 }),
  key(s, code, down) {
    if (!down) return ['ArrowUp', 'ArrowDown', 'Space'].includes(code) || /^Digit\d$/.test(code);
    if (code === 'ArrowUp') s.bias = Math.min(3, s.bias + 1);
    else if (code === 'ArrowDown') s.bias = Math.max(-3, s.bias - 1);
    else if (code === 'Space') { s.notes = s.notes.slice(0, s.at + 1); }
    else if (/^Digit\d$/.test(code)) s.queued = (Number(code.slice(5)) + 9) % 10;
    else return false;
    return true;
  },
  point(s, x, y, down) { if (down) s.queued = clamp(Math.floor((1 - y / H) * SCALE.length), 0, SCALE.length - 1); },
  next(s) {
    const prev = s.notes.length ? s.notes[s.notes.length - 1].deg : 4;
    const deg = s.queued != null ? s.queued : clamp(prev + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)] + Math.sign(s.bias) * (Math.random() < Math.abs(s.bias) / 6 ? 1 : 0), 0, SCALE.length - 1);
    s.queued = null;
    s.notes.push({ deg, beats: [0.5, 0.5, 1, 1, 1, 2][Math.floor(Math.random() * 6)] });
  },
  step(s, dt) {
    const beat = 60 / 96;
    while (s.notes.length < s.at + 12) song.next(s);
    s.t += dt;
    while (s.t >= s.notes[s.at].beats * beat) { s.t -= s.notes[s.at].beats * beat; s.at++; s.score++; while (s.notes.length < s.at + 12) song.next(s); }
    if (s.at > 64) { s.notes = s.notes.slice(s.at - 8); s.at = 8; }
    return s.notes[s.at].deg / (SCALE.length - 1);
  },
  /** The note sounding now, as a frequency, once per note: index.js beeps it when sound is on. */
  sounding(s) {
    if (s.sounded === s.score) return 0;
    s.sounded = s.score;
    return 262 * 2 ** (SCALE[s.notes[s.at].deg] / 12);
  },
  draw(g, s) {
    g.fillStyle = VGA.blue; g.fillRect(0, 0, W, H);
    g.fillStyle = VGA.white;
    for (let i = 0; i < 5; i++) g.fillRect(0, 140 + i * 40, W, 2);
    g.fillStyle = VGA.ltcyan; g.fillRect(160, 60, 2, 380);
    let x = 160 - s.t / (60 / 96) * 48;
    for (let i = s.at; i < s.notes.length && x < W; i++) {
      const n = s.notes[i], y = 420 - n.deg * 34;
      g.fillStyle = i === s.at ? VGA.yellow : VGA.ltgreen;
      g.fillRect(x, y, Math.max(8, n.beats * 48 - 6), 16);
      x += n.beats * 48;
    }
    text(g, 'Notes ' + s.score + '   Register ' + (s.bias > 0 ? '+' : '') + s.bias, 8, 8, VGA.yellow, 2);
  },
};

export const GAMES = [road, bat, song];
