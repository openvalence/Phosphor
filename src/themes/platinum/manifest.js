import icons from './icons.js';

export default {
  id: 'platinum', name: 'Platinum',
  pitch: 'Pinstripe title bars and gray bevels, 1999 style',
  swatch: 'repeating-linear-gradient(0deg, #fff 0 1px, #B8B8BC 1px 2px) 0 0 / 100% 45% no-repeat, #D6D6D8',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'platinum',
      name: 'Platinum',
      accents: { reality: '#2F4F9E', intent: '#6A2E92', highlight: '#3C3CAA' },
      chassis: { hue: 270, tint: 0.5, brightness: 0.86, contrast: 1 },
      look: { glow: 0, radius: 4, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--line-1': '#A6A6AA', '--line-2': '#7C7C82', '--line-3': '#5E5E64', '--line-4': '#2A2A2E' },
    },
  ],
};
