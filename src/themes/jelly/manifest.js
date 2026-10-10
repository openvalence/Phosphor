import icons from './icons.js';

export default {
  id: 'jelly', name: 'Jelly',
  pitch: 'Pinstripes, glossy capsules and blue jelly buttons',
  swatch: 'linear-gradient(180deg, rgba(255, 255, 255, .85), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, #5FA2F5, #1B64D4)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'jelly',
      name: 'Jelly',
      accents: { reality: '#1759C2', intent: '#8E3CC8', highlight: '#126B2F' },
      chassis: { hue: 250, tint: 0.5, brightness: 0.95, contrast: 1 },
      look: { glow: 0.25, radius: 8, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--line-1': '#CBD2DD', '--line-2': '#9AA6B8', '--line-3': '#7C8BA2', '--line-4': '#1B64D4' },
    },
  ],
};
