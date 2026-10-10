import icons from './icons.js';

const BRASS = { '--line-1': '#37352F', '--line-2': '#5A564B', '--line-3': '#8E8365', '--line-4': '#C7B481' };
const STEEL = { '--line-1': '#33363B', '--line-2': '#54585F', '--line-3': '#858B95', '--line-4': '#B9BFCA' };
const FROST = { '--line-1': '#2E3A47', '--line-2': '#4A5B6E', '--line-3': '#7890AA', '--line-4': '#B2CCE6' };
const LOOK = { glow: 0.9, radius: 0, scale: 1.12, numWeight: 400, motion: 3 };

export default {
  id: 'amp', name: 'Amp',
  pitch: 'A 1998 player skin: gunmetal and brass, a green LCD, grip-striped title bar',
  swatch: 'linear-gradient(180deg, #B59B5F 0 1px, transparent 1px), repeating-linear-gradient(90deg, #8A94A0 0 1px, #1B1D20 1px 3px) 0 0 / 100% 30% no-repeat, linear-gradient(180deg, #2E3034 0 55%, #07140C 55%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'amp',
      name: 'Amp',
      accents: { reality: '#3CF27C', intent: '#8FB4FF', highlight: '#E9DBA8' },
      chassis: { hue: 85, tint: 0.25, brightness: 0.27, contrast: 1.1 },
      look: LOOK,
      overrides: BRASS,
    },
    {
      id: 'amp-classic',
      name: 'Classic',
      accents: { reality: '#4CFF3A', intent: '#8FB4FF', highlight: '#F2F2F2' },
      chassis: { hue: 250, tint: 0.2, brightness: 0.25, contrast: 1.1 },
      look: LOOK,
      overrides: STEEL,
    },
    {
      id: 'amp-ice',
      name: 'Ice',
      accents: { reality: '#5FE6FF', intent: '#A9B8FF', highlight: '#E4F4FF' },
      chassis: { hue: 235, tint: 1.1, brightness: 0.27, contrast: 1.1 },
      look: LOOK,
      overrides: FROST,
    },
  ],
};
