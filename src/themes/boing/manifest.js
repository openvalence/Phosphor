import icons from './icons.js';

export default {
  id: 'boing', name: 'Boing',
  pitch: 'Gray gadgets and blue copper bars from a 1990 workstation',
  swatch: 'linear-gradient(180deg, #2A4F9C 0 40%, #AAAAAA 40% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'boing',
      name: 'Boing',
      accents: { reality: '#12306E', intent: '#44106A', highlight: '#123A58' },
      chassis: { hue: 230, tint: 1.2, brightness: 0.8, contrast: 1 },
      look: { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 2 },
      overrides: {
        '--line-1': '#8A8A92',
        '--line-2': '#5A5A64',
        '--line-3': '#2E2E36',
        '--line-4': '#000000',
        '--tx-val': '#2F3338',
        '--tx-mut': '#43484D',
        '--tx-ghost': '#3A3F45',
      },
    },
  ],
};
