import icons from './icons.js';

// Mica's hairline lines and text steps, pinned so the strokes read as white (dark) or black (light) at the stated alpha.
const DARK_PINS = {
  '--line-0': '#FFFFFF0D',
  '--line-1': '#FFFFFF17',
  '--line-2': '#FFFFFF26',
  '--line-3': '#FFFFFF40',
  '--line-4': '#FFFFFF66',
  '--tx-val': '#C9CDD6',
  '--tx-mut': '#AEB3BF',
  '--tx-ghost': '#A0A6B3',
};
const LIGHT_PINS = {
  '--line-0': '#0000000A',
  '--line-1': '#00000012',
  '--line-2': '#0000001F',
  '--line-3': '#00000033',
  '--line-4': '#00000066',
  '--tx-val': '#3D3D3D',
  '--tx-mut': '#5C5C5C',
  '--tx-ghost': '#6B6B6B',
};

export default {
  id: 'mica', name: 'Mica',
  pitch: 'Fluent: Windows 11 Mica, layered surfaces and hairline strokes',
  note: 'Mica: Windows 11 (Light and Mica Alt use the dark Mica under a tint); elsewhere an opaque look',
  material: 'mica',
  wallpaper: false,
  swatch: 'linear-gradient(135deg, #5A6070 0 18%, #2B2E36 18% 60%, #60CDFF 60% 66%, #2B2E36 66%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'mica',
      name: 'Dark',
      accents: { reality: '#60CDFF', intent: '#CBA6FF', highlight: '#8AB4FF' },
      chassis: { hue: 255, tint: 0.5, brightness: 0.24, contrast: 1.05 },
      look: { glow: 0.5, radius: 4, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: DARK_PINS,
    },
    {
      id: 'mica-light',
      name: 'Light',
      accents: { reality: '#005FB8', intent: '#6B4FBB', highlight: '#0067C0' },
      chassis: { hue: 255, tint: 0.3, brightness: 0.955, contrast: 1 },
      look: { glow: 0.3, radius: 4, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: LIGHT_PINS,
    },
    {
      id: 'mica-alt',
      name: 'Mica Alt',
      accents: { reality: '#76B9ED', intent: '#CBA6FF', highlight: '#8AB4FF' },
      chassis: { hue: 250, tint: 0.35, brightness: 0.24, contrast: 1.1 },
      look: { glow: 0.5, radius: 4, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: DARK_PINS,
    },
  ],
};
