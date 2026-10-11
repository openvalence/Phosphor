import icons from './icons.js';

// Lines are pinned per palette: the card and nest tubes are drawn by theme.css, so the line
// tokens only carry dividers and control edges, and --line-4 (every hover edge) is the lit color.
export default {
  id: 'outrun', name: 'Outrun',
  pitch: 'A striped sun sinking into a neon grid',
  swatch: 'linear-gradient(180deg, #1B0838 0 38%, #FF6EC4 38% 46%, #9B2CE0 46% 54%, #3A0C5E 54% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'outrun',
      name: 'Outrun',
      accents: { reality: '#00E5FF', intent: '#FF4FD8', highlight: '#F6EEFF' },
      chassis: { hue: 300, tint: 4, brightness: 0.16, contrast: 1 },
      look: { glow: 1.8, radius: 2, scale: 1.12, numWeight: 500, motion: 7 },
      overrides: { '--line-1': '#2E1760', '--line-2': '#5A2DA0', '--line-3': '#A23FC0', '--line-4': '#00C8E0' },
    },
    {
      id: 'outrun-midnight',
      name: 'Midnight',
      accents: { reality: '#35F0FF', intent: '#8F6BFF', highlight: '#FF4FD8' },
      chassis: { hue: 258, tint: 3, brightness: 0.12, contrast: 1 },
      look: { glow: 1.6, radius: 2, scale: 1.12, numWeight: 500, motion: 7 },
      overrides: { '--line-1': '#16204A', '--line-2': '#26398A', '--line-3': '#4A5FD0', '--line-4': '#35F0FF' },
    },
    {
      id: 'outrun-vice',
      name: 'Vice',
      accents: { reality: '#006B65', intent: '#B0206A', highlight: '#5B3FD0' },
      chassis: { hue: 350, tint: 3, brightness: 0.95, contrast: 1 },
      look: { glow: 0.4, radius: 3, scale: 1.12, numWeight: 500, motion: 5 },
      overrides: { '--line-1': '#F0BFD8', '--line-2': '#E39BC0', '--line-3': '#6FD3C8', '--line-4': '#00897E' },
    },
  ],
};
