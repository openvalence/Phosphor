import icons from './icons.js';

export default {
  id: 'rack', name: 'Rack',
  pitch: 'Brushed-metal rack gear with LED readouts',
  swatch: 'linear-gradient(180deg, #3A4146, #1E2326 55%, #111517)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'rack',
      name: 'Rack',
      accents: { reality: '#37F26B', intent: '#5AB8FF', highlight: '#FFFFFF' },
      chassis: { hue: 230, tint: 0.8, brightness: 0.22, contrast: 1.1 },
      look: { glow: 1.3, radius: 2, scale: 1.12, numWeight: 500, motion: 4 },
    },
  ],
};
