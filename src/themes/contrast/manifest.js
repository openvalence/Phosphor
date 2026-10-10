import icons from './icons.js';

export default {
  id: 'contrast', name: 'Contrast',
  pitch: 'Black, white and cyan: thick frames, no texture, 7:1 text',
  swatch: 'linear-gradient(90deg, #000 0 50%, #fff 50% 55%, #000 55%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'contrast',
      name: 'Contrast',
      accents: { reality: '#00FFFF', intent: '#E0A0FF', highlight: '#FFFFFF' },
      chassis: { hue: 0, tint: 0, brightness: 0, contrast: 2 },
      look: { glow: 0, radius: 0, scale: 1.12, numWeight: 600, motion: 1 },
      overrides: { '--line-1': '#767676', '--line-2': '#A0A0A0', '--line-3': '#C8C8C8', '--line-4': '#FFFFFF' },
    },
  ],
};
