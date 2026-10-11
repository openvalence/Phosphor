import icons from './icons.js';

export default {
  id: 'material', name: 'Material',
  pitch: 'Material 3: tonal surfaces, state layers, pill buttons',
  note: 'Takes your wallpaper colors on Android 12 and later',
  swatch: 'linear-gradient(135deg, #D0BCFF 0 34%, #4A4458 34% 62%, #2B2733 62% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  // None pins a surface or a line: the system palette (model/dynamicColor.js) derives the Baseline's chassis and accents,
  // and every token under them follows.
  variants: [
    {
      id: 'material',
      name: 'Baseline',
      accents: { reality: '#D0BCFF', intent: '#9BD6E8', highlight: '#EADDFF' },
      chassis: { hue: 300, tint: 1.8, brightness: 0.2, contrast: 1.3 },
      look: { glow: 0, radius: 12, scale: 1.12, numWeight: 400, motion: 4 },
    },
    {
      id: 'material-expressive',
      name: 'Expressive',
      accents: { reality: '#FFAFD2', intent: '#C8EB5C', highlight: '#FFD6E6' },
      chassis: { hue: 330, tint: 2.4, brightness: 0.19, contrast: 1.4 },
      look: { glow: 0, radius: 20, scale: 1.12, numWeight: 500, motion: 6 },
    },
    {
      id: 'material-light',
      name: 'Baseline light',
      accents: { reality: '#6750A4', intent: '#00696B', highlight: '#625B71' },
      chassis: { hue: 300, tint: 1.4, brightness: 0.99, contrast: 1.2 },
      look: { glow: 0, radius: 12, scale: 1.12, numWeight: 400, motion: 4 },
    },
  ],
};
