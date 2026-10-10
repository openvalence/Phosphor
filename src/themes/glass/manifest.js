import icons from './icons.js';

export default {
  id: 'glass', name: 'Liquid Glass',
  pitch: 'Capsules, specular rims and layered glass over your wallpaper',
  note: 'Liquid Glass: macOS 26 system glass, Windows Acrylic; elsewhere a blurred in-page backdrop',
  material: 'glass',
  wallpaper: true,
  swatch: 'radial-gradient(circle at 25% 20%, rgba(255, 255, 255, .55), transparent 45%), linear-gradient(135deg, #5E5CE6, #0A84FF 55%, #30D1BE)',
  icons,
  // The first variant is the theme's own palette; its id is the theme's id. docs/THEMES.md, Variants.
  variants: [
    {
      id: 'glass',
      name: 'Liquid Glass',
      accents: { reality: '#5AC8FA', intent: '#D9A0FF', highlight: '#FFFFFF' },
      chassis: { hue: 250, tint: 0.8, brightness: 0.14, contrast: 1.05 },
      look: { glow: 0.7, radius: 14, scale: 1.12, numWeight: 400, motion: 4 },
      overrides: { '--tx-val': '#CBD0DA', '--tx-mut': '#B4BAC6', '--tx-ghost': '#A8AEBB' },
    },
  ],
};
