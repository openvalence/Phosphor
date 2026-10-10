import icons from './icons.js';

export default {
  id: 'notebook', name: 'Notebook',
  pitch: 'Ruled paper, stitched cards and felt-pen icons',
  swatch: 'repeating-linear-gradient(180deg, transparent 0 4px, rgba(80, 120, 170, .45) 4px 5px), #F6F1E3',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'notebook',
      name: 'Notebook',
      accents: { reality: '#1F5FA8', intent: '#8A3D7B', highlight: '#256B43' },
      chassis: { hue: 85, tint: 1.8, brightness: 0.94, contrast: 1 },
      look: { glow: 0, radius: 2, scale: 1.12, numWeight: 400, motion: 3 },
      overrides: { '--line-1': '#D9CDB4', '--line-2': '#B8A988', '--line-3': '#9A8A68', '--line-4': '#6E6046' },
    },
  ],
};
