import icons from './icons.js';

const look = { glow: 0, radius: 3, scale: 1.12, numWeight: 400, motion: 3 };

export default {
  id: 'notebook', name: 'Notebook',
  pitch: 'Ruled paper, felt-pen boxes and masking tape',
  swatch: 'repeating-linear-gradient(180deg, transparent 0 5px, rgba(60, 100, 170, .5) 5px 6px), linear-gradient(90deg, #F6F1E3 0 30%, #E8A5A5 30% 33%, #F6F1E3 33%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'notebook',
      name: 'Ruled',
      accents: { reality: '#1F5FA8', intent: '#8A3D7B', highlight: '#256B43' },
      chassis: { hue: 85, tint: 1.8, brightness: 0.94, contrast: 1.15 },
      look,
      overrides: { '--line-1': '#D9CDB4', '--line-2': '#B8A988', '--line-3': '#9A8A68', '--line-4': '#6E6046' },
    },
    {
      id: 'notebook-graph',
      name: 'Graph Paper',
      accents: { reality: '#0E5A7A', intent: '#8C2F6B', highlight: '#1F6B4A' },
      chassis: { hue: 172, tint: 1.1, brightness: 0.95, contrast: 1.15 },
      look,
      overrides: { '--line-1': '#C7D6D1', '--line-2': '#A9BDB6', '--line-3': '#8CA29B', '--line-4': '#5F7872' },
    },
    {
      id: 'notebook-night',
      name: 'Night',
      accents: { reality: '#9CCBFF', intent: '#D8BDFF', highlight: '#B5EBAA' },
      chassis: { hue: 160, tint: 2.2, brightness: 0.28, contrast: 1 },
      look,
    },
  ],
};
