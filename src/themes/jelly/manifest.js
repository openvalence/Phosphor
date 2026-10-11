import icons from './icons.js';

const look = { glow: 0.25, radius: 8, scale: 1.12, numWeight: 400, motion: 3 };

export default {
  id: 'jelly', name: 'Jelly',
  pitch: 'Gel capsules, pinstripes and three jelly spheres',
  swatch: 'radial-gradient(circle at 20% 50%, #FF6B5B 0 9%, transparent 10%), radial-gradient(circle at 34% 50%, #F6B72C 0 9%, transparent 10%), radial-gradient(circle at 48% 50%, #4CC63A 0 9%, transparent 10%), linear-gradient(180deg, rgba(255, 255, 255, .9), rgba(255, 255, 255, 0) 52%), linear-gradient(180deg, #8CC0FF, #2F7BE8)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'jelly',
      name: 'Aqua',
      accents: { reality: '#0F46A8', intent: '#8E3CC8', highlight: '#0A5FCB' },
      chassis: { hue: 250, tint: 0.5, brightness: 0.95, contrast: 1 },
      look,
      overrides: { '--line-1': '#CBD2DD', '--line-2': '#9AA6B8', '--line-3': '#7C8BA2', '--line-4': '#1B64D4' },
    },
    {
      id: 'jelly-graphite',
      name: 'Graphite',
      accents: { reality: '#2F3E58', intent: '#7B3FA0', highlight: '#3A5A94' },
      chassis: { hue: 245, tint: 0.12, brightness: 0.94, contrast: 1 },
      look,
      overrides: { '--line-1': '#CDCFD4', '--line-2': '#A2A7B2', '--line-3': '#7E8594', '--line-4': '#4B5568' },
    },
    {
      id: 'jelly-metal',
      name: 'Brushed Metal',
      accents: { reality: '#0A3283', intent: '#7B3FA0', highlight: '#0845A0' },
      chassis: { hue: 245, tint: 0.1, brightness: 0.86, contrast: 1 },
      look,
      overrides: { '--line-1': '#A9AFB8', '--line-2': '#8D94A0', '--line-3': '#6A7280', '--line-4': '#1B4E9E' },
    },
  ],
};
