import icons from './icons.js';

export default {
  id: 'p1', name: 'P1 Terminal',
  pitch: 'Green phosphor, scanlines and a blinking cursor',
  swatch: 'repeating-linear-gradient(0deg, rgba(0, 0, 0, .5) 0 1px, transparent 1px 3px), #03200E',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'p1',
      name: 'P1 Terminal',
      accents: { reality: '#3BFF7A', intent: '#8FE8F0', highlight: '#D4FFD8' },
      chassis: { hue: 150, tint: 4, brightness: 0.14, contrast: 1.1 },
      look: { glow: 1.7, radius: 0, scale: 1.12, numWeight: 400, motion: 8 },
    },
  ],
};
