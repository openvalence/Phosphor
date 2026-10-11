import icons from './icons.js';

const look = { glow: 1.8, radius: 0, scale: 1.12, numWeight: 400, motion: 8 };

export default {
  id: 'cipher', name: 'Cipher',
  pitch: 'Falling glyph rain behind black glass',
  swatch: 'repeating-linear-gradient(90deg, rgba(0, 255, 65, .7) 0 1px, transparent 1px 4px), linear-gradient(180deg, #E8FFE8 0 3px, transparent 3px), #010A03',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'cipher',
      name: 'Cipher',
      accents: { reality: '#00FF41', intent: '#5CE1FF', highlight: '#E8FFE8' },
      chassis: { hue: 145, tint: 4, brightness: 0.09, contrast: 1.1 },
      look,
    },
    {
      id: 'cipher-redpill',
      name: 'Red Pill',
      // Crimson at OKLCH hue 357: the engine keeps accents 20 degrees clear of the safety red.
      accents: { reality: '#EE3491', intent: '#5CA8FF', highlight: '#FFE3EE' },
      chassis: { hue: 355, tint: 3.4, brightness: 0.09, contrast: 1.1 },
      look,
    },
    {
      id: 'cipher-construct',
      name: 'Construct',
      accents: { reality: '#00701F', intent: '#00587A', highlight: '#0A0A0A' },
      chassis: { hue: 145, tint: 0.35, brightness: 0.975, contrast: 1 },
      look: { ...look, glow: 0 },
    },
  ],
};
