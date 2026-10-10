import icons from './icons.js';

export default {
  id: 'mica', name: 'Mica',
  pitch: 'Fluent: Windows 11 Mica behind 8 px cards and hairline strokes',
  note: 'Mica: Windows 11; elsewhere an opaque look',
  material: 'mica',
  wallpaper: false,
  swatch: 'linear-gradient(135deg, #3A3F4B, #1E2026)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'mica',
      name: 'Mica',
      accents: { reality: '#60CDFF', intent: '#CBA6FF', highlight: '#8AB4FF' },
      chassis: { hue: 255, tint: 0.5, brightness: 0.17, contrast: 1.05 },
      look: { glow: 0.5, radius: 4, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: {
        '--line-0': '#FFFFFF0D',
        '--line-1': '#FFFFFF17',
        '--line-2': '#FFFFFF26',
        '--line-3': '#FFFFFF40',
        '--line-4': '#FFFFFF66',
        '--tx-val': '#C9CDD6',
        '--tx-mut': '#AEB3BF',
        '--tx-ghost': '#A0A6B3',
      },
    },
  ],
};
