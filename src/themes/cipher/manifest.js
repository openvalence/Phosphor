import icons from './icons.js';

export default {
  id: 'cipher', name: 'Cipher',
  pitch: 'Falling green code behind glass-black panels',
  swatch: 'repeating-linear-gradient(90deg, rgba(0, 255, 65, .55) 0 1px, transparent 1px 5px), #010A03',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'cipher',
      name: 'Cipher',
      accents: { reality: '#00FF41', intent: '#5CE1FF', highlight: '#E8FFE8' },
      chassis: { hue: 145, tint: 4, brightness: 0.09, contrast: 1.1 },
      look: { glow: 1.8, radius: 0, scale: 1.12, numWeight: 400, motion: 8 },
    },
  ],
};
