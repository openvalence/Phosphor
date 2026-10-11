import icons from './icons.js';

const BRASS = { '--line-1': '#37352F', '--line-2': '#5A564B', '--line-3': '#8E8365', '--line-4': '#C7B481' };
const STEEL = { '--line-1': '#33363B', '--line-2': '#54585F', '--line-3': '#858B95', '--line-4': '#B9BFCA' };
const FROST = { '--line-1': '#BFD0DD', '--line-2': '#9DB4C6', '--line-3': '#7B97AE', '--line-4': '#3F6384' };
const LOOK = { glow: 0.9, radius: 0, scale: 1.12, numWeight: 400, motion: 3 };

export default {
  id: 'amp', name: 'Amp',
  pitch: 'A 1998 player skin: gunmetal and brass, a green LCD, grip-striped title bar',
  swatch: 'repeating-linear-gradient(90deg, #8A94A0 0 1px, #1B1D20 1px 3px) 0 0 / 100% 28% no-repeat, linear-gradient(180deg, #B59B5F 0 1px, transparent 1px), linear-gradient(180deg, #34353A 0 52%, #07140C 52% 78%, #3A3B40 78%)',
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
      accents: { reality: '#06577F', intent: '#4A3FC8', highlight: '#0B3B6B' },
      chassis: { hue: 232, tint: 2.6, brightness: 0.9, contrast: 1.1 },
      look: LOOK,
      overrides: FROST,
    },
  ],
};
