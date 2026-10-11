import icons from './icons.js';

// Every text token is pinned to 7:1 or better on all four surfaces (AAA); the lines are 3:1 or better
// against the page. The tx-faint step is decoration, never a label.
const DARK = {
  '--bg': '#0E0E0E', '--bg-raised': '#171717', '--bg-card': '#0E0E0E', '--bg-sunken': '#1D1D1D', '--shell-bg': '#000000',
  '--tx-hi': '#FFFFFF', '--tx': '#F4F4F4', '--tx-val': '#E6E6E6', '--tx-mut': '#D0D0D0', '--tx-ghost': '#BCBCBC', '--tx-faint': '#7A7A7A',
  '--line-0': '#3C3C3C', '--line-1': '#707070', '--line-2': '#9C9C9C', '--line-3': '#C8C8C8', '--line-4': '#FFFFFF',
};
const LIGHT = {
  '--bg': '#FFFFFF', '--bg-raised': '#F2F2F2', '--bg-card': '#FFFFFF', '--bg-sunken': '#E8E8E8', '--shell-bg': '#FFFFFF',
  '--tx-hi': '#000000', '--tx': '#0A0A0A', '--tx-val': '#1A1A1A', '--tx-mut': '#2C2C2C', '--tx-ghost': '#3C3C3C', '--tx-faint': '#7E7E7E',
  '--line-0': '#C4C4C4', '--line-1': '#858585', '--line-2': '#5C5C5C', '--line-3': '#333333', '--line-4': '#000000',
};
const YELLOW = {
  '--bg': '#000000', '--bg-raised': '#0B0B0B', '--bg-card': '#000000', '--bg-sunken': '#141414', '--shell-bg': '#000000',
  '--tx-hi': '#FFFF00', '--tx': '#F2F200', '--tx-val': '#E4E400', '--tx-mut': '#D0D000', '--tx-ghost': '#BABA00', '--tx-faint': '#707000',
  '--line-0': '#3A3A00', '--line-1': '#767600', '--line-2': '#A4A400', '--line-3': '#D2D200', '--line-4': '#FFFF00',
};
const LOOK = { glow: 0, radius: 0, scale: 1.12, numWeight: 700, motion: 1 };

export default {
  id: 'contrast', name: 'Contrast',
  pitch: 'Bold plates, 7:1 text, thick rings, state by shape',
  swatch: 'linear-gradient(90deg, #0E0E0E 0 40%, #FFFFFF 40% 48%, #00FFFF 48% 56%, #0E0E0E 56% 64%, #FFFF00 64% 72%, #0E0E0E 72%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'contrast',
      name: 'Dark',
      accents: { reality: '#00FFFF', intent: '#E0A0FF', highlight: '#FFFFFF' },
      chassis: { hue: 0, tint: 0, brightness: 0.02, contrast: 1.6 },
      look: LOOK,
      overrides: DARK,
    },
    {
      id: 'contrast-light',
      name: 'Light',
      accents: { reality: '#0000D0', intent: '#6A00A8', highlight: '#000000' },
      chassis: { hue: 0, tint: 0, brightness: 1, contrast: 1.6 },
      look: LOOK,
      overrides: LIGHT,
    },
    {
      id: 'contrast-yellow',
      name: 'Yellow on Black',
      accents: { reality: '#FFFFFF', intent: '#00FFFF', highlight: '#FFFFFF' },
      chassis: { hue: 100, tint: 0, brightness: 0, contrast: 1.6 },
      look: LOOK,
      overrides: YELLOW,
    },
  ],
};
