import icons from './icons.js';

export default {
  id: 'dmg', name: 'DMG',
  pitch: 'Four shades of pea-green LCD behind a pixel grid',
  swatch: 'linear-gradient(#0F380F 0 25%, #306230 25% 50%, #8BAC0F 50% 75%, #9BBC0F 75%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'dmg',
      name: 'DMG',
      accents: { reality: '#0F380F', intent: '#5E1240', highlight: '#1F2F7A' },
      chassis: { hue: 125, tint: 4, brightness: 0.72, contrast: 1 },
      look: { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 2 },
      overrides: {
        '--bg': '#9BBC0F',
        '--bg-raised': '#9BBC0F',
        '--bg-card': '#A7C714',
        '--bg-sunken': '#8BAC0F',
        '--shell-bg': '#8BAC0F',
        '--line-0': '#8FB10D',
        '--line-1': '#4F7A14',
        '--line-2': '#306230',
        '--line-3': '#1D4A14',
        '--line-4': '#0F380F',
        '--tx-hi': '#0F380F',
        '--tx': '#0F380F',
        '--tx-val': '#0F380F',
        '--tx-mut': '#123B0F',
        '--tx-ghost': '#0F380F',
        '--tx-faint': '#5F8A1A',
        '--shade-rgb': '15,56,15',
      },
    },
  ],
};
