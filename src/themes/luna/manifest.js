import icons from './icons.js';

export default {
  id: 'luna', name: 'Luna',
  pitch: 'Blue title bars and beige windows on a green hill',
  swatch: 'radial-gradient(ellipse 90% 55% at 25% 125%, #4FA634 0 70%, transparent 71%), linear-gradient(180deg, #0A5AE8 0 24%, #ECE9D8 24% 62%, #8FC1F2 62%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'luna',
      name: 'Luna',
      accents: { reality: '#0A4FC0', intent: '#7B2FB8', highlight: '#1F6E1F' },
      chassis: { hue: 100, tint: 1.2, brightness: 0.94, contrast: 1 },
      look: { glow: 0.3, radius: 3, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--line-1': '#B8C6DA', '--line-2': '#8AA3C6', '--line-3': '#6D8FBF', '--line-4': '#2F62C8' },
    },
    {
      id: 'luna-olive',
      name: 'Olive Green',
      accents: { reality: '#4A6B12', intent: '#7B2FB8', highlight: '#1F6E1F' },
      chassis: { hue: 120, tint: 1.6, brightness: 0.93, contrast: 1 },
      look: { glow: 0.3, radius: 3, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--line-1': '#CFD3B2', '--line-2': '#A8B07E', '--line-3': '#8A9460', '--line-4': '#5E6B2A' },
    },
    {
      id: 'luna-silver',
      name: 'Silver',
      accents: { reality: '#4A5470', intent: '#7B2FB8', highlight: '#1F6E1F' },
      chassis: { hue: 270, tint: 0.5, brightness: 0.93, contrast: 1 },
      look: { glow: 0.3, radius: 3, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--line-1': '#CACBD4', '--line-2': '#A4A6B8', '--line-3': '#858AA4', '--line-4': '#4F587A' },
    },
  ],
};
