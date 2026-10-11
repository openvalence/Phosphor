import icons from './icons.js';

const look = { glow: 1, radius: 0, scale: 1.12, numWeight: 700, motion: 6 };

export default {
  id: 'hellscape', name: 'Hellscape',
  pitch: 'A pit from 1993: brick, iron, a face in the HUD',
  swatch: 'linear-gradient(180deg, #7A3A24 0 16%, #1C0F0C 16% 100%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'hellscape',
      name: 'Hellscape',
      accents: { reality: '#86E05A', intent: '#6FB4FF', highlight: '#F2E6C8' },
      chassis: { hue: 26, tint: 3.6, brightness: 0.19, contrast: 1.2 },
      look,
      overrides: {
        '--line-1': '#6B4131', '--line-2': '#8A5A44', '--line-3': '#A8785C', '--line-4': '#CDA07C',
        '--tx-hi': '#FBF1DC', '--tx': '#E6D6B6', '--tx-val': '#CDB892', '--tx-mut': '#B39C74', '--tx-ghost': '#9C8761',
      },
    },
    {
      id: 'hellscape-brimstone',
      name: 'Brimstone',
      accents: { reality: '#C6EE3C', intent: '#52D6E4', highlight: '#ECE4D4' },
      chassis: { hue: 12, tint: 4.4, brightness: 0.16, contrast: 1.25 },
      look: { ...look, glow: 1.2 },
      overrides: {
        '--line-1': '#5E2D33', '--line-2': '#7E414A', '--line-3': '#A05A63', '--line-4': '#C98891',
        '--tx-hi': '#FFF0DA', '--tx': '#EBD3BA', '--tx-val': '#D3B497', '--tx-mut': '#B99A7C', '--tx-ghost': '#A28365',
      },
    },
    {
      id: 'hellscape-nightmare',
      name: 'Nightmare',
      accents: { reality: '#5CF2B0', intent: '#FF6FD0', highlight: '#F2D6FF' },
      chassis: { hue: 335, tint: 3.2, brightness: 0.12, contrast: 1.3 },
      look: { ...look, glow: 1.5, motion: 3 },
      overrides: {
        '--line-1': '#4F2F47', '--line-2': '#6E4363', '--line-3': '#8F5E85', '--line-4': '#BB8BB0',
        '--tx-hi': '#FFF0FB', '--tx': '#EBD6E7', '--tx-val': '#D3B5CE', '--tx-mut': '#B592AE', '--tx-ghost': '#9E7A98',
      },
    },
  ],
};
