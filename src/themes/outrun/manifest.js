import icons from './icons.js';

export default {
  id: 'outrun', name: 'Outrun',
  pitch: 'Neon pink and cyan over a sunset grid',
  swatch: 'linear-gradient(180deg, #0B0420 0 45%, #6A1B7A 72%, #FF4FD8 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'outrun',
      name: 'Outrun',
      accents: { reality: '#00E5FF', intent: '#FF4FD8', highlight: '#9BFF4D' },
      chassis: { hue: 300, tint: 4, brightness: 0.16, contrast: 1 },
      look: { glow: 1.8, radius: 2, scale: 1.12, numWeight: 500, motion: 7 },
    },
  ],
};
