import icons from './icons.js';

export default {
  id: 'amp', name: 'Amp',
  pitch: 'A music player with a face: bevels, LED digits, a grip-striped title bar',
  swatch: 'repeating-linear-gradient(90deg, #7A86B8 0 1px, transparent 1px 3px) 0 0 / 100% 35% no-repeat, linear-gradient(180deg, #3A4156, #1B1F2B)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'amp',
      name: 'Amp',
      accents: { reality: '#00E85A', intent: '#7FB0FF', highlight: '#E8E8E8' },
      chassis: { hue: 240, tint: 0.6, brightness: 0.17, contrast: 1.1 },
      look: { glow: 0.9, radius: 0, scale: 1.12, numWeight: 500, motion: 3 },
      overrides: { '--line-1': '#3A3F4C', '--line-2': '#5A6070', '--line-3': '#7A8296', '--line-4': '#A8B0C4' },
    },
  ],
};
