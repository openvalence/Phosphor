import icons from './icons.js';

/** The four LCD tones of a variant, darkest first, pinned onto the engine's tokens: ink, frames, page, window. */
const lcd = (l0, l1, l2, l3, rgb) => ({
  '--bg': l2,
  '--bg-raised': l3,
  '--bg-card': l3,
  '--bg-sunken': l2,
  '--shell-bg': l2,
  '--line-0': l2,
  '--line-1': l0,
  '--line-2': l1,
  '--line-3': l1,
  '--line-4': l0,
  '--tx-hi': l0,
  '--tx': l0,
  '--tx-val': l0,
  '--tx-mut': l0,
  '--tx-ghost': l0,
  '--tx-faint': l1,
  '--shade-rgb': rgb,
});

const look = { glow: 0, radius: 0, scale: 1.12, numWeight: 500, motion: 2 };

export default {
  id: 'dmg', name: 'DMG',
  pitch: 'A 1989 handheld: four-tone LCD, pixel type, a gray bezel',
  swatch: 'linear-gradient(#0F380F 0 25%, #306230 25% 50%, #8BAC0F 50% 75%, #9BBC0F 75%)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'dmg',
      name: 'DMG',
      accents: { reality: '#0F380F', intent: '#5E1240', highlight: '#1F2F7A' },
      chassis: { hue: 125, tint: 4, brightness: 0.72, contrast: 1 },
      look,
      overrides: lcd('#0F380F', '#306230', '#8BAC0F', '#9BBC0F', '15,56,15'),
    },
    {
      id: 'dmg-pocket',
      name: 'Pocket',
      accents: { reality: '#141414', intent: '#4A1040', highlight: '#18286A' },
      chassis: { hue: 100, tint: 0, brightness: 0.72, contrast: 1 },
      look,
      overrides: lcd('#141414', '#585858', '#A4A4A0', '#CFCFC8', '20,20,20'),
    },
    {
      id: 'dmg-light',
      name: 'Light',
      accents: { reality: '#03302C', intent: '#4A1048', highlight: '#1A2A78' },
      chassis: { hue: 185, tint: 4, brightness: 0.72, contrast: 1 },
      look,
      overrides: lcd('#03302C', '#0F7568', '#36C7AD', '#74F2D4', '3,48,44'),
    },
  ],
};
