/**
 * rain.mjs -- writes the Cipher rain into theme.css between the rain markers: four alpha masks
 * (--rain-a, --rain-ah, --rain-b, --rain-bh: a slow and a fast sheet, each its trails and its bright heads)
 * the thick glyph masks (--gl-1..--gl-5) the labels wear and the 5 x 5 pixel glyph masks (--gx1..--gx8) the heatmap wears. Masks, not colors: the sheets take
 * their hue from --reality and --highlight, so every Variant and a Custom theme rains in its own color.
 *
 * Run: node src/themes/cipher/rain.mjs     (rewrites the block; the tile heights it prints go in theme.css)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Katakana-like strokes on a 10 x 10 box. Drawn here, not cut from a font: no face has to exist.
const GLYPHS = [
  'M1.5 2.5H8.5M8.5 2.5C8 6 6 8 2.5 9.5M5 5.5V9', 'M7.5 1.5 3 6M6 4.5V9.5', 'M5 1V3M1.5 3H8.5V5.5C8.5 8 7 9 3.5 9.5',
  'M2 3H8M5 3V8M1.5 8.5H8.5', 'M1.5 3.5H8.5M5.2 1V9.5L3 9M5 5C4 7 3 8 1.5 8.5', 'M1.5 4H7.5V7.5C7.5 9 7 9.5 5.5 9.5M4 1.5V4C3.5 7 2.5 8.5 1.5 9.5',
  'M5 1.5 2.5 5M3.5 3.5H8.5C8.5 7 7 9 3 9.5', 'M1.5 2.5H8.5V8.5H1.5', 'M1.5 4H8.5M3.5 1.5V6M6.5 1.5V6M5 4C5 7 4 9 2 9.5',
  'M1.5 2.5 3 4M1 5.5 2.5 7M4.5 8.5C7 7.5 8.5 5 8.5 1.5', 'M1.5 2.5H8C7.5 5.5 5.5 8 2 9.5M4.5 5.5 8.5 9', 'M1.5 5H8.5M3.5 1.5V7C3.5 8.5 5 9 8.5 8.5M6.5 2V7',
  'M2 2.5 3.5 4.5M7.5 1.5C7 6 5 8.5 1.5 9.5', 'M5 1.5 2.5 5M3.5 3.5H8.5C8.5 7 7 9 3 9.5M3.5 6.5 6 6', 'M2 2 3 4M4.5 1.5 5.5 4M8.5 1.5C8 6 6 8.5 2 9.5',
  'M2.5 2H7.5M1.5 5H8.5M5 5C5 7.5 4 9 2 9.5', 'M3.5 1.5V9.5M3.5 4.5 7.5 6.5', 'M1.5 4.5H8.5M5.2 1.5C5 6 4 8 2 9.5', 'M2 3H8M1.5 8H8.5',
  'M4 2.5C3.5 6 2.5 8 1.5 9M6 3.5C6.5 6 7.5 8 8.5 9', 'M2.5 1.5V9H8M2.5 5.5 7.5 3.5', 'M1.5 3H8C8 6.5 6 8.5 2.5 9.5', 'M1 6.5 4.5 3 9 7.5',
  'M1.5 4.5H8.5M5 1.5V9.5L3.5 9M2.5 6.5 3.5 8M7.5 6.5 6.5 8', 'M1.5 2.5H8.5C7.5 5 5.5 6.5 2.5 8M5 6 8 9', 'M2.5 2.5 7 3M2 5.5 7.5 6M1.5 8.5 8 9',
  'M5 1.5C4.5 5 3 7.5 1.5 9M1.5 9H8.5M5.5 5.5 8 8', 'M7.5 2 3 9M2.5 3.5C5 5 6.5 6.5 8 8.5', 'M2 2.5H8M1.5 5H8.5M5 1.5V8C5 9 6 9.5 8 9',
  'M2 3.5H8V8.5M1.5 8.5H8.5', 'M2 2.5H8V8.5H2M2 5.5H8', 'M2.5 2.5H7.5M1.5 5H8.5C8 8 6 9 2.5 9.5', 'M3 1.5V6M7 1.5V6C7 8 5.5 9 3.5 9.5',
  'M3 2.5V7C3 8.5 2.5 9 1.5 9.5M6 2V8C6 9 7 9 8.5 7', 'M3 1.5V9L8.5 5', 'M2.5 1.5V4M2.5 3H8.5V5.5C8.5 8 6.5 9 3 9.5', 'M2 2.5H8M5 2.5V9.5M2 9.5H8',
  'M2.5 5H7.5M5 2.5V7.5', 'M2 3.5H8M2 6.5H8', 'M5 1.5V9.5M1.5 5.5H8.5M2.5 2.5 7.5 8.5',
];

// Five-by-five pixel glyphs for the heatmap blocks (a bit a pixel).
const PIX = [
  ['11111', '00100', '01110', '00100', '11111'], ['00100', '11111', '00100', '01010', '10001'], ['11110', '00010', '01110', '10000', '11110'],
  ['10001', '01010', '00100', '01010', '10001'], ['01110', '00001', '11111', '10000', '01110'], ['11111', '10001', '11111', '10001', '10001'],
  ['00100', '01110', '10101', '00100', '00100'], ['11011', '00100', '11111', '00100', '11011'],
];

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const enc = (svg) => 'url("data:image/svg+xml,' + svg.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23') + '")';
const fix = (n) => String(+n.toFixed(1));

/** One sheet: columns of falling glyphs. Returns {w, h, trails, heads} as two mask images. */
function sheet({ cols, pitch, rowH, rows, scale, fill, minLen, maxLen, sd }) {
  seed = sd;
  const w = cols * pitch, h = rows * rowH;
  const defs = GLYPHS.map((d, i) => '<path id="g' + i + '" d="' + d + '"/>').join('');
  const trail = {}, head = [];
  for (let c = 0; c < cols; c++) {
    if (rnd() > fill) continue;
    const len = minLen + Math.floor(rnd() * (maxLen - minLen + 1));
    const r0 = Math.floor(rnd() * rows);
    const x = c * pitch + (pitch - 10 * scale) / 2;
    for (let k = 0; k < len; k++) {
      const row = (r0 + k) % rows, y = row * rowH + (rowH - 10 * scale) / 2;
      const gi = Math.floor(rnd() * GLYPHS.length);
      const place = '<use href="#g' + gi + '" transform="translate(' + fix(x) + ' ' + fix(y) + ') scale(' + scale + ')"/>';
      if (k === len - 1) { head.push(place); continue; }
      const a = Math.max(0.08, Math.pow((k + 1) / len, 1.7));
      const lv = a > 0.7 ? '.9' : a > 0.45 ? '.6' : a > 0.25 ? '.38' : a > 0.14 ? '.22' : '.12';
      (trail[lv] ||= []).push(place);
    }
  }
  const body = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs>' + defs + '</defs>' + inner + '</svg>';
  const t = Object.entries(trail).map(([lv, ps]) => '<g opacity="' + lv + '" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="square">' + ps.join('') + '</g>').join('');
  const hd = '<g fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="square">' + head.join('') + '</g>';
  return { w, h, trails: enc(body(t)), heads: enc(body(hd)) };
}

const A = sheet({ cols: 26, pitch: 19, rowH: 17, rows: 46, scale: 1.25, fill: 0.8, minLen: 8, maxLen: 26, sd: 11 });
const B = sheet({ cols: 22, pitch: 23, rowH: 20, rows: 40, scale: 1.55, fill: 0.7, minLen: 6, maxLen: 18, sd: 29 });

const pix = (rows) => enc('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" shape-rendering="crispEdges">'
  + rows.flatMap((r, y) => [...r.matchAll(/1+/g)].map((m) => '<rect x="' + m.index + '" y="' + y + '" width="' + m[0].length + '" height="1"/>')).join('') + '</svg>');

const gl = (i) => enc('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="square"><path d="' + GLYPHS[i] + '"/></svg>');

const block = [
  '/* rain:begin  (node src/themes/cipher/rain.mjs rewrites this block) */',
  'html:root[data-style="cipher"] {',
  '  --rain-a: ' + A.trails + ';',
  '  --rain-ah: ' + A.heads + ';',
  '  --rain-a-w: ' + A.w + 'px; --rain-a-h: ' + A.h + 'px;',
  '  --rain-b: ' + B.trails + ';',
  '  --rain-bh: ' + B.heads + ';',
  '  --rain-b-w: ' + B.w + 'px; --rain-b-h: ' + B.h + 'px;',
  ...[0, 9, 22, 19, 10].map((g, i) => '  --gl-' + (i + 1) + ': ' + gl(g) + ';'),
  ...PIX.map((p, i) => '  --gx' + (i + 1) + ': ' + pix(p) + ';'),
  '}',
  '/* rain:end */',
].join('\n');

const file = fileURLToPath(new URL('./theme.css', import.meta.url));
const css = readFileSync(file, 'utf8');
const out = css.replace(/\/\* rain:begin[\s\S]*?\/\* rain:end \*\//, () => block);
if (out === css && !css.includes('rain:begin')) throw new Error('theme.css has no rain markers');
writeFileSync(file, out, 'utf8');
console.log('sheet A', A.w + 'x' + A.h, 'sheet B', B.w + 'x' + B.h, 'bytes', block.length);
