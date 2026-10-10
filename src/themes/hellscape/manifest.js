import icons from './icons.js';

export default {
  id: 'hellscape', name: 'Hellscape',
  pitch: 'Brick, bevel and a status-bar HUD from the pit',
  swatch: 'linear-gradient(180deg, #7A1E12 0 18%, #2C130D 18% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'hellscape',
      name: 'Hellscape',
      accents: { reality: '#7BE05A', intent: '#6FB4FF', highlight: '#F2EEE6' },
      chassis: { hue: 28, tint: 4, brightness: 0.21, contrast: 1.15 },
      look: { glow: 1.2, radius: 0, scale: 1.12, numWeight: 600, motion: 6 },
      overrides: { '--line-1': '#6B3C2E', '--line-2': '#8A5240', '--line-3': '#A8705A', '--line-4': '#C9A48E' },
    },
  ],
};
