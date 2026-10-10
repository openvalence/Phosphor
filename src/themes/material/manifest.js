import icons from './icons.js';

export default {
  id: 'material', name: 'Material',
  pitch: 'Material 3: tonal surfaces, state layers, pill buttons; Material You colors on Android',
  note: 'Material: on Android 12 and later the colors come from your wallpaper; elsewhere the baseline palette',
  swatch: 'linear-gradient(135deg, #D0BCFF 0 34%, #2B2733 34% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'material',
      name: 'Material',
      accents: { reality: '#D0BCFF', intent: '#9BD6E8', highlight: '#EADDFF' },
      chassis: { hue: 300, tint: 1.8, brightness: 0.2, contrast: 1.3 },
      look: { glow: 0, radius: 12, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: { '--line-1': '#49454F', '--line-2': '#79747E', '--line-3': '#938F99', '--line-4': '#CAC4D0' },
    },
  ],
};
