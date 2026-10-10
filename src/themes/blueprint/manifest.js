import icons from './icons.js';

export default {
  id: 'blueprint', name: 'Blueprint',
  pitch: 'White lines on drafting blue, grid paper and dashed frames',
  swatch: 'linear-gradient(rgba(255, 255, 255, .22) 1px, transparent 1px) 0 0 / 6px 6px, linear-gradient(90deg, rgba(255, 255, 255, .22) 1px, transparent 1px) 0 0 / 6px 6px, #0F3A68',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'blueprint',
      name: 'Blueprint',
      accents: { reality: '#BFF0FF', intent: '#FFB8E6', highlight: '#FFFFFF' },
      chassis: { hue: 245, tint: 4, brightness: 0.3, contrast: 1.2 },
      look: { glow: 0.6, radius: 0, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: {
        '--bg': '#0C3260',
        '--bg-raised': '#103C69',
        '--bg-card': '#10416F',
        '--bg-sunken': '#08254A',
        '--shell-bg': '#061D3A',
        '--line-0': '#0E3A6A',
        '--line-1': '#3A6FA6',
        '--line-2': '#5C90C4',
        '--line-3': '#7DB0E0',
        '--line-4': '#A9D2F5',
        '--tx-hi': '#FFFFFF',
        '--tx': '#DDEEFF',
        '--tx-val': '#BCDAF2',
        '--tx-mut': '#A8CDEE',
        '--tx-ghost': '#9CC4E8',
        '--tx-faint': '#2D5C8F',
      },
    },
  ],
};
