/**
 * kit.js -- what a theme folder may import (docs/THEMES.md, The kit). Pure data and small
 * functions, no DOM: node tests import it with the registry.
 *
 * - variant(): a palette entry for a manifest, compact.
 * - color(), st(): a whole-color icon document and a stroke attribute string.
 * - stockIcons(fn): one icon per registry name from the stock glyph paths, as fn(path, name) returns.
 * - pixelIcons(): the 8 x 8 pixel set, one square a pixel.
 * Copy and change a set in your own icons.js; nothing here is shared state.
 */
import { NAV_PATHS } from '../ui/navIcons.js';

/** The icon registry names a theme may draw (ui/navIcons.js ICON_NAMES, less the quick rail). */
export const NAMES = Object.keys(NAV_PATHS).filter((n) => n !== 'quickRail');
export { NAV_PATHS };

/** A palette: partial chassis and look fill from the engine's defaults. */
export const variant = (id, name, reality, intent, chassis = {}, extra = {}) => ({
  id, name,
  accents: { reality, intent, highlight: extra.highlight || null },
  chassis, look: extra.look || {}, overrides: extra.overrides || {},
});

/** A whole-color icon: a complete SVG document on a 16-unit viewBox. */
export const color = (inner) => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' + inner + '</svg>' });
/** Stroke attributes for a colored icon's open path. */
export const st = (c, w = 1.7) => ' fill="none" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"';

/** One mask icon per registry name from the stock glyph paths. */
export const stockIcons = (fn) => Object.fromEntries(NAMES.map((n) => [n, fn(NAV_PATHS[n], n)]));

const bitmap = (rows) => rows.map((r, y) => [...r.matchAll(/#+/g)]
  .map((m) => '<rect x="' + m.index * 2 + '" y="' + y * 2 + '" width="' + m[0].length * 2 + '" height="2" fill="#000" stroke="none"/>').join('')).join('');

const PIXEL_ROWS = {
  machine: ['###.####', '###.####', '###.####', '........', '####.###', '####.###', '####.###', '........'],
  generator: ['........', '........', '..##....', '.#..#..#', '#....##.', '........', '........', '........'],
  motion: ['........', '..#..#..', '.#....#.', '########', '.#....#.', '..#..#..', '........', '........'],
  safety: ['.######.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],
  limits: ['........', '#......#', '#..##..#', '#.####.#', '#..##..#', '#......#', '........', '........'],
  playback: ['.#......', '.###....', '.#####..', '.#######', '.#####..', '.###....', '.#......', '........'],
  auxiliary: ['...##...', '...##...', '..####..', '.######.', '.######.', '.######.', '..####..', '........'],
  automation: ['..####..', '.#....#.', '#..#...#', '#..##..#', '#......#', '.#....#.', '..####..', '........'],
  hardware: ['..#..#..', '.######.', '########', '#.####.#', '########', '.######.', '..#..#..', '........'],
  network: ['..####..', '.#....#.', '#..##..#', '.#....#.', '...##...', '........', '...##...', '........'],
  session: ['..####..', '..####..', '..####..', '...##...', '.######.', '########', '########', '........'],
  system: ['........', '...#....', '...#....', '##.#.#..', '..##.#.#', '...#..##', '........', '........'],
  other: ['###.###.', '###.###.', '###.###.', '........', '###.###.', '###.###.', '###.###.', '........'],
  setup: ['##.#####', '........', '##.#####', '........', '##.####.', '........', '........', '........'],
  pairing: ['.###....', '#...#...', '#...#...', '.###....', '...#....', '...####.', '...#.#..', '...#.#..'],
  valence: ['.####...', '#....#..', '#..#.###', '#..#.#..', '.####.#.', '....#..#', '.....##.', '........'],
  log: ['........', '########', '........', '########', '........', '######..', '........', '........'],
  display: ['########', '#......#', '#......#', '#......#', '########', '...##...', '..####..', '.######.'],
  plugins: ['.#..#...', '.#..#...', '.####...', '.####...', '..##....', '..##....', '..##....', '........'],
  hubs: ['########', '#.#....#', '########', '........', '########', '#.#....#', '########', '........'],
  server: ['..####..', '.#.##.#.', '#..##..#', '########', '#..##..#', '.#.##.#.', '..####..', '........'],
  settings: ['.#..#..#', '.#..#..#', '###.#..#', '.#.###.#', '.#..#.##', '.#..#..#', '.#..#..#', '........'],
  merge: ['#.....#.', '#.....#.', '.#...#..', '..#.#...', '...#....', '...#....', '...#....', '........'],
  about: ['..####..', '.#....#.', '#..##..#', '#......#', '#..##..#', '#..##..#', '.#....#.', '..####..'],
};

/** Pixel icons on an 8 x 8 grid, one square a pixel. */
export const pixelIcons = () => Object.fromEntries(Object.entries(PIXEL_ROWS).map(([k, rows]) => [k, bitmap(rows)]));
